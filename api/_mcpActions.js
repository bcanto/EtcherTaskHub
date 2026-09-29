// Pure logic for the MCP connector's three tools (list_actions / create_action / update_action).
// No HTTP, no fetch, no crypto — just plain functions over a DB-blob-shaped object, so this can
// be unit-tested directly with plain objects. api/mcp.js does the read/CAS-write/JSON-RPC framing
// and calls into here. Leading underscore = shared module, not a Vercel route.
//
// Everything this creates lives on one fixed, well-known board ("Email Triage", id b-email-triage)
// so it shows up as an ordinary board in the app the user already uses — Main Table, Kanban,
// Gantt — rather than a walled-off list nobody else on the team can see. Nothing here ever
// touches any other board.
const crypto = require('crypto');

const BOARD_ID = 'b-email-triage';
const GROUP_ID = 'g-email-triage';
const BOARD_NAME = 'Email Triage';

// Open/Waiting/Done (the user's spec) map onto three of the app's existing plain internal
// statuses (index.html's STATUS_META) rather than inventing new ones the rest of the UI (status
// filters, board colour rules, etc.) doesn't know about. "Waiting" has no exact internal
// equivalent — 'blocked' ("can't move right now") is the closest existing meaning.
const STATUS_IN = { open: 'todo', waiting: 'blocked', done: 'done' };
const STATUS_OUT = { todo: 'Open', blocked: 'Waiting', done: 'Done' };
// Accept either the friendly name or the raw internal value (update_action may be called with
// either, e.g. by something that already read a status back from list_actions).
function normalizeStatus(s, fallback) {
  if (!s) return fallback;
  const key = String(s).trim().toLowerCase();
  if (STATUS_IN[key]) return STATUS_IN[key];
  if (Object.prototype.hasOwnProperty.call(STATUS_OUT, key)) return key;
  return fallback;
}
function friendlyStatus(status) {
  return STATUS_OUT[status] || status;
}

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}

// Idempotent: creates the board + its default group only if missing, and never touches them
// again once they exist. `ownerId` is only used the first time (board owner / group colour).
function ensureBoard(data, ownerId) {
  data.boards = data.boards || [];
  data.groups = data.groups || [];
  if (!data.boards.some(b => b.id === BOARD_ID)) {
    const now = new Date().toISOString();
    data.boards.push({
      id: BOARD_ID, name: BOARD_NAME, color: '#f59e0b', clientId: null,
      ownerId: ownerId || null, visibility: 'all_internal', archived: false,
      description: 'Action items pulled out of email by the morning triage connector.',
      excludeFromReports: false, createdAt: now, updatedAt: now,
    });
    data.groups.push({
      id: GROUP_ID, clientId: null, boardId: BOARD_ID, workboardId: BOARD_ID,
      name: 'Inbox', order: 0, color: '#f59e0b', collapsed: false, createdAt: now, updatedAt: now,
    });
  }
  data.workboards = data.boards; // same alias reconciliation the rest of the app relies on
  return { boardId: BOARD_ID, groupId: GROUP_ID };
}

// Best-effort match of a free-text owner (name or email) to an existing staff account.
// Returns { id, name, matched }. Falls back to the caller (the one allowed account) rather
// than leaving a task unowned, and always says whether it actually matched something.
function resolveOwner(data, ownerText, fallbackUser) {
  const users = data.users || data.staff || [];
  const q = String(ownerText || '').trim().toLowerCase();
  if (q) {
    const byEmail = users.find(u => (u.email || '').toLowerCase() === q);
    if (byEmail) return { id: byEmail.id, name: byEmail.name, matched: true };
    const byName = users.find(u => (u.name || '').toLowerCase() === q);
    if (byName) return { id: byName.id, name: byName.name, matched: true };
    const byPartial = users.find(u => (u.name || '').toLowerCase().includes(q));
    if (byPartial) return { id: byPartial.id, name: byPartial.name, matched: true };
  }
  return { id: fallbackUser.id, name: fallbackUser.name, matched: false };
}

function findExisting(data, outlookMessageId, task) {
  if (!outlookMessageId) return null;
  return (data.tasks || []).find(t => t.outlookMessageId === outlookMessageId && t.name === task) || null;
}

// caller = { id, name } — the authenticated (allow-listed) TaskHub user, used as fallback owner
// and as createdBy. Returns { task, created }.
function createOrUpdateAction(data, input, caller) {
  const task = String(input.task || '').trim();
  if (!task) throw Object.assign(new Error('task is required'), { code: 'invalid_params' });
  const outlookMessageId = input.outlookMessageId ? String(input.outlookMessageId) : null;

  const existing = findExisting(data, outlookMessageId, task);
  const { groupId } = ensureBoard(data, caller.id);
  const owner = resolveOwner(data, input.owner, caller);
  const status = normalizeStatus(input.status, existing ? existing.status : 'todo');
  const now = new Date().toISOString();

  if (existing) {
    existing.status = status;
    if (input.owner) { existing.ownerId = owner.id; existing.currentlyWithUserId = owner.id; }
    if (input.dueDate !== undefined) existing.endDate = input.dueDate || '';
    if (input.emailSubject) existing.emailSubject = input.emailSubject;
    if (input.emailLink) existing.emailLink = input.emailLink;
    existing.updatedAt = now;
    return { task: existing, created: false, ownerMatched: owner.matched };
  }

  const created = {
    id: newId('t'), groupId, boardId: BOARD_ID, workboardId: BOARD_ID, clientId: null,
    name: task, status, priority: input.priority || 'med',
    ownerId: owner.id, currentlyWith: 'internal', currentlyWithType: 'none', currentlyWithUserId: owner.id,
    percentComplete: 0, startDate: '', endDate: input.dueDate || '',
    hourBudget: '', description: input.notes || '', dependencies: [], tags: [], archived: false,
    source: 'Email triage', outlookMessageId, emailSubject: input.emailSubject || '', emailLink: input.emailLink || '',
    createdBy: caller.id, createdAt: now, updatedAt: now, completedAt: null,
  };
  data.tasks = data.tasks || [];
  data.tasks.push(created);
  return { task: created, created: true, ownerMatched: owner.matched };
}

function applyUpdate(data, input) {
  const task = (data.tasks || []).find(t => t.id === input.id);
  if (!task) throw Object.assign(new Error('No action with that id'), { code: 'not_found' });
  if (task.boardId !== BOARD_ID) {
    // Guard rail, not an expected path: update_action is scoped to this connector's own
    // board, never a general "edit any task" backdoor.
    throw Object.assign(new Error('That item is not part of the Email Triage board'), { code: 'forbidden' });
  }
  if (input.status !== undefined) task.status = normalizeStatus(input.status, task.status);
  if (input.dueDate !== undefined) task.endDate = input.dueDate || '';
  if (input.owner !== undefined) {
    const owner = resolveOwner(data, input.owner, { id: task.ownerId, name: task.ownerId });
    task.ownerId = owner.id; task.currentlyWithUserId = owner.id;
  }
  task.updatedAt = new Date().toISOString();
  return task;
}

function listActions(data, filter) {
  filter = filter || {};
  let tasks = (data.tasks || []).filter(t => t.boardId === BOARD_ID && !t.archived);
  if (filter.status) {
    const want = normalizeStatus(filter.status, null);
    if (want) tasks = tasks.filter(t => t.status === want);
  }
  if (filter.owner) {
    const q = String(filter.owner).trim().toLowerCase();
    const users = data.users || data.staff || [];
    const match = users.find(u => (u.email || '').toLowerCase() === q || (u.name || '').toLowerCase() === q);
    tasks = tasks.filter(t => t.ownerId === (match ? match.id : filter.owner));
  }
  if (filter.dueBefore) tasks = tasks.filter(t => t.endDate && t.endDate < filter.dueBefore);
  if (filter.dueAfter) tasks = tasks.filter(t => t.endDate && t.endDate > filter.dueAfter);
  return tasks.map(t => toPublic(data, t));
}

function toPublic(data, t) {
  const users = data.users || data.staff || [];
  const owner = users.find(u => u.id === t.ownerId);
  return {
    id: t.id, task: t.name, status: friendlyStatus(t.status),
    owner: owner ? owner.name : null, dueDate: t.endDate || null,
    emailSubject: t.emailSubject || null, emailLink: t.emailLink || null,
    outlookMessageId: t.outlookMessageId || null, source: t.source || null,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

module.exports = {
  BOARD_ID, GROUP_ID, BOARD_NAME, normalizeStatus, friendlyStatus,
  ensureBoard, resolveOwner, findExisting, createOrUpdateAction, applyUpdate, listActions, toPublic,
};
