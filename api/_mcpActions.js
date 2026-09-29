// Pure logic for the MCP connector's three tools (list_actions / create_action / update_action).
// No HTTP, no fetch, no crypto — just plain functions over a DB-blob-shaped object, so this can
// be unit-tested directly with plain objects. api/mcp.js does the read/CAS-write/JSON-RPC framing
// and calls into here. Leading underscore = shared module, not a Vercel route.
//
// create_action never creates a task directly and never auto-creates a board — it drops a pending
// item into the same DB.emailIntake review queue Task Hub's own Dashboard already renders (the
// "Email Triage" panel). A person picks the real board/client/group/owner there (the existing
// Route dialog), so the task is born on the correct board the first time — there is no "move it
// off the wrong board afterward" problem to solve, because nothing is created until routing.
// Once routed, the resulting task is tagged 'email-intake' and carries emailSource.originalEmailId
// — that tag, not a fixed board id, is what scopes update_action/list_actions to "things this
// connector is allowed to touch," now that those tasks can live on any board.
const crypto = require('crypto');

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

// Best-effort match of a free-text owner (name or email) to an existing staff account.
// Returns { id, name, matched }. Falls back to the caller (the one allow-listed account) rather
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
  return fallbackUser ? { id: fallbackUser.id, name: fallbackUser.name, matched: false } : { id: null, name: null, matched: false };
}

// A task belongs to this connector only if it was actually routed here (tagged by
// triageConfirmRoute()/the bulk-route equivalent in the Dashboard) — never by board id, since
// routed tasks can now land on any board.
function isEmailIntakeTask(t) {
  return !!t && Array.isArray(t.tags) && t.tags.includes('email-intake');
}

// Dedup key is the (outlookMessageId, task text) pair, not the message id alone — one email
// can produce several distinct action items, and those must stay separate.
function findExistingPending(data, originalEmailId, taskText) {
  if (!originalEmailId) return null;
  return (data.emailIntake || []).find(x => x.originalEmailId === originalEmailId && x.suggestedTitle === taskText && x.status === 'pending') || null;
}
function findExistingRouted(data, originalEmailId, taskText) {
  if (!originalEmailId) return null;
  return (data.tasks || []).find(t => isEmailIntakeTask(t) && t.emailSource && t.emailSource.originalEmailId === originalEmailId && (t.name === taskText || t.title === taskText)) || null;
}

// caller = { id, name, email } — the authenticated (allow-listed) TaskHub user. Returns
// { task, created, routed, ownerMatched }. `task` is either the already-routed real task (when
// the same email was routed by a person earlier — routed:true) or the pending queue item
// (created or updated in place) — never a brand-new task, and never a new board.
function createOrUpdateAction(data, input, caller) {
  const task = String(input.task || '').trim();
  if (!task) throw Object.assign(new Error('task is required'), { code: 'invalid_params' });
  const originalEmailId = input.outlookMessageId ? String(input.outlookMessageId) : null;
  const now = new Date().toISOString();

  const routedTask = findExistingRouted(data, originalEmailId, task);
  if (routedTask) {
    if (input.status !== undefined) routedTask.status = normalizeStatus(input.status, routedTask.status);
    if (input.owner) {
      const o = resolveOwner(data, input.owner, null);
      if (o.id) { routedTask.ownerId = o.id; routedTask.currentlyWithUserId = o.id; }
    }
    if (input.dueDate !== undefined) routedTask.endDate = input.dueDate || '';
    if (input.notes !== undefined) routedTask.description = input.notes;
    routedTask.updatedAt = now;
    return { task: routedTask, created: false, routed: true, ownerMatched: null };
  }

  data.emailIntake = data.emailIntake || [];
  const existingPending = findExistingPending(data, originalEmailId, task);
  if (existingPending) {
    existingPending.subject = input.emailSubject || task;
    existingPending.suggestedTitle = task;
    if (input.notes !== undefined) { existingPending.snippet = input.notes.slice(0, 250); existingPending.suggestedDescription = input.notes; }
    if (input.dueDate !== undefined) existingPending.suggestedDueDate = input.dueDate || null;
    if (input.priority) existingPending.suggestedPriority = input.priority;
    if (input.emailLink) existingPending.emailLink = input.emailLink;
    existingPending.updatedAt = now;
    return { task: existingPending, created: false, routed: false, ownerMatched: null };
  }

  const ownerGuess = resolveOwner(data, input.owner, null);
  const created = {
    id: newId('ei_'), status: 'pending',
    from: caller.email || '', fromName: caller.name || 'Email triage connector',
    subject: input.emailSubject || task, body: input.notes || '', snippet: (input.notes || '').slice(0, 250),
    attachments: [], receivedAt: now,
    suggestedTitle: task, suggestedDescription: input.notes || '',
    suggestedBoardId: null, suggestedGroupId: null, suggestedDueDate: input.dueDate || null,
    suggestedOwnerId: ownerGuess.matched ? ownerGuess.id : null, suggestedPriority: input.priority || 'med',
    extractedDates: [], actionItems: [],
    routedToTaskId: null, routedAt: null, routedBy: null,
    discardedAt: null, discardedBy: null,
    originalEmailId, emailLink: input.emailLink || '', emailHeaders: {}, isTest: false,
    createdBy: caller.id, createdAt: now, updatedAt: now,
  };
  data.emailIntake.push(created);
  return { task: created, created: true, routed: false, ownerMatched: ownerGuess.matched };
}

function applyUpdate(data, input) {
  const routed = (data.tasks || []).find(t => t.id === input.id && isEmailIntakeTask(t));
  if (routed) {
    if (input.status !== undefined) routed.status = normalizeStatus(input.status, routed.status);
    if (input.dueDate !== undefined) routed.endDate = input.dueDate || '';
    if (input.owner !== undefined) {
      const owner = resolveOwner(data, input.owner, { id: routed.ownerId, name: routed.ownerId });
      routed.ownerId = owner.id; routed.currentlyWithUserId = owner.id;
    }
    routed.updatedAt = new Date().toISOString();
    return routed;
  }
  const pending = (data.emailIntake || []).find(x => x.id === input.id && x.status === 'pending');
  if (pending) {
    // Routing (and the fields that only make sense once routed, like status/owner) is a
    // person's decision made in the Dashboard's Route dialog, not something the connector
    // does on their behalf — so this fails loudly instead of guessing a board.
    throw Object.assign(new Error('This item is still pending review in the Task Hub dashboard — route it to a WorkBoard there before updating its status or owner.'), { code: 'not_yet_routed' });
  }
  throw Object.assign(new Error('No action with that id'), { code: 'not_found' });
}

function listActions(data, filter) {
  filter = filter || {};
  const wantPending = filter.status && String(filter.status).trim().toLowerCase() === 'pending';

  let routed = (data.tasks || []).filter(isEmailIntakeTask);
  if (wantPending) {
    routed = [];
  } else if (filter.status) {
    const want = normalizeStatus(filter.status, null);
    routed = want ? routed.filter(t => t.status === want) : routed;
  }
  if (filter.owner) {
    const q = String(filter.owner).trim().toLowerCase();
    const users = data.users || data.staff || [];
    const match = users.find(u => (u.email || '').toLowerCase() === q || (u.name || '').toLowerCase() === q);
    routed = routed.filter(t => t.ownerId === (match ? match.id : filter.owner));
  }
  if (filter.dueBefore) routed = routed.filter(t => t.endDate && t.endDate < filter.dueBefore);
  if (filter.dueAfter) routed = routed.filter(t => t.endDate && t.endDate > filter.dueAfter);

  let pending = (data.emailIntake || []).filter(x => x.status === 'pending');
  if (filter.status && !wantPending) pending = [];
  if (filter.owner || filter.dueBefore || filter.dueAfter) pending = [];

  return [...pending.map(toPublicPending), ...routed.map(t => toPublicTask(data, t))];
}

function toPublicTask(data, t) {
  const users = data.users || data.staff || [];
  const owner = users.find(u => u.id === t.ownerId);
  const board = (data.boards || data.workboards || []).find(b => b.id === t.boardId);
  return {
    id: t.id, task: t.name || t.title, status: friendlyStatus(t.status),
    owner: owner ? owner.name : null, dueDate: t.endDate || null, board: board ? board.name : null,
    emailSubject: (t.emailSource && t.emailSource.subject) || null, emailLink: t.emailLink || null,
    outlookMessageId: (t.emailSource && t.emailSource.originalEmailId) || null, source: t.source || 'Email triage',
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}
function toPublicPending(item) {
  return {
    id: item.id, task: item.suggestedTitle || item.subject, status: 'Pending review',
    owner: null, dueDate: item.suggestedDueDate || null, board: null,
    emailSubject: item.subject || null, emailLink: item.emailLink || null,
    outlookMessageId: item.originalEmailId || null, source: 'Email triage',
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}
// Dispatches on shape: a routed task always has a boardId, a still-pending queue item never does.
function toPublic(data, record) {
  return (record && record.boardId) ? toPublicTask(data, record) : toPublicPending(record);
}

module.exports = {
  normalizeStatus, friendlyStatus, resolveOwner, isEmailIntakeTask,
  createOrUpdateAction, applyUpdate, listActions, toPublic,
};
