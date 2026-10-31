// Pure logic for the MCP connector's write tools (create_task, create_tasks, update_task, list_groups,
// create_group, add_comment, route_action). Same convention as _mcpBoards.js and _mcpActions.js: no HTTP,
// no fetch, plain functions over the DB blob, so it can be unit-tested with plain objects. The route
// (api/oauth/[...path].js) does the read, the compare-and-swap write and the JSON-RPC framing.
// Leading underscore = shared module, not a Vercel route.
//
// Every rule mirrors index.html, so a task Claude makes is the same record a person makes in the app:
//   who may write      canEditTask (admin and staff; restricted and client logins only read) AND
//                      canViewBoard (no writes to a board the caller cannot see); never an archived board or task
//   new task           _wsBuildNewTask (top level) and wsSaveInlineSubtask (subitem)
//   new group          wsSaveInlineGroup: the board's client and colour, ordered last
//   default group      getWbGroups()[0], the board's first group by order
//   owner              _wsOwnerChoices: active staff, never a client login
//   owner change       _wsApplyField('ownerId'): the old and new lead leave the co-assignees, owner_changed
//   status / progress  _applyStatusProgress (api/_portal.js applyStatusProgress); a subitem's status rolls up
//                      into its parent's stored progress (getEffectiveTaskPct)
//   history            _taskAudit (task.auditTrail, the latest 30) for changes, writeAuditEvent for created
//   notifications      notify(): never the caller, never someone inactive or who cannot see the task
//   routing an email   triageConfirmRoute
// What is new: every record and history entry written here carries via:'claude' (the app shows "via Claude"),
// and task.rank, an optional whole number for a person's own order of work.
const crypto = require('crypto');
const { canViewBoard, canViewTask, resolveTaskBoardId, boardClientId, getTaskForUser, taskUrl } = require('./_mcpBoards');
const { applyStatusProgress } = require('./_portal');

const arr = x => (Array.isArray(x) ? x : []);
function boardsOf(data) { return data.boards || data.workboards || []; }
function usersOf(data) { return data.users || data.staff || []; }
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function newId(prefix) { return prefix + crypto.randomBytes(6).toString('hex'); }

// index.html STATUS_META / getAllStatuses and PRIO_META / getAllPriorities. Labels can be renamed in the app
// (labelConfig), and custom ones added (cst_ / cp_ keys), so both are read from the record too.
const BUILTIN_STATUSES = ['todo', 'ready-to-start', 'in-progress', 'waiting-client', 'review', 'needs-changes', 'blocked',
  'ready-approval', 'approved-client', 'change-requested', 'declined-client', 'completed-approved', 'done', 'cancelled'];
const STATUS_LABELS = { 'not-started': 'Not Started', todo: 'Not Started', 'ready-to-start': 'Ready to Start', 'in-progress': 'In Progress',
  'waiting-client': 'Waiting on Client', review: 'In Review', 'waiting-review': 'In Review', 'needs-changes': 'Needs Changes', blocked: 'Blocked',
  'ready-approval': 'Sent for Approval', 'approved-client': 'Client Approved', 'change-requested': 'Change Requested by Client',
  'declined-client': 'Declined by Client', 'completed-approved': 'Completed & Approved', done: 'Completed', completed: 'Completed', cancelled: 'Cancelled' };
const BUILTIN_PRIORITIES = ['low', 'med', 'high', 'crit'];
const PRIORITY_LABELS = { low: 'Low', med: 'Medium', high: 'High', crit: 'Critical' };
const DONE = ['done', 'completed', 'completed-approved'];

function statusLabel(data, key) {
  const ov = ((data.labelConfig || {}).statuses || {})[key];
  return (ov && ov.label) || STATUS_LABELS[key] || key;
}
function priorityLabel(data, key) {
  const ov = ((data.labelConfig || {}).priorities || {})[key];
  return (ov && ov.label) || PRIORITY_LABELS[key] || key;
}
function allStatuses(data) {
  return BUILTIN_STATUSES.concat(Object.keys((data.labelConfig || {}).statuses || {}).filter(k => /^cst_[A-Za-z0-9_-]{1,40}$/.test(k)));
}
function allPriorities(data) {
  return BUILTIN_PRIORITIES.concat(Object.keys((data.labelConfig || {}).priorities || {}).filter(k => /^cp_[A-Za-z0-9_-]{1,40}$/.test(k)));
}
// A value or its label, any case: "done", "Completed" and "completed" are all Completed.
function resolveEnum(keys, labelOf, raw, what) {
  const q = String(raw).trim().toLowerCase();
  const hit = keys.find(k => k.toLowerCase() === q) || keys.find(k => String(labelOf(k)).toLowerCase() === q);
  if (hit) return hit;
  throw fail('invalid_params', `Unknown ${what} "${raw}". Valid ${what} values: ${keys.map(k => `${k} (${labelOf(k)})`).join(', ')}.`);
}
const resolveStatus = (data, raw) => resolveEnum(allStatuses(data), k => statusLabel(data, k), raw, 'status');
const resolvePriority = (data, raw) => resolveEnum(allPriorities(data), k => priorityLabel(data, k), raw, 'priority');

function validDate(raw, what) {
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw fail('invalid_params', `${what} must be a real date written YYYY-MM-DD (got "${raw}").`);
  }
  return s;
}
// The app's "today" is the person's own day; Etcher works on Perth time.
function todayStr(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

// ── Who may write ───────────────────────────────────────────────────────────────────────
function assertCanWrite(user) {
  if (!user || !(user.role === 'admin' || user.role === 'staff')) {
    throw fail('forbidden', `Your TaskHub role (${(user && user.role) || 'unknown'}) can view tasks but not change them. Ask an admin if you need to.`);
  }
}

// ── Boards ──────────────────────────────────────────────────────────────────────────────
// A board by id, or by name in any case (an exact name first, then a name that contains the words). A board the
// caller cannot see is never found, so its name never leaks. forWrite refuses a board in Archive & Bin.
function findBoard(data, user, ref, forWrite) {
  const s = String(ref == null ? '' : ref).trim();
  const visible = boardsOf(data).filter(b => b && canViewBoard(user, b, data));
  const live = visible.filter(b => !b.archived).map(b => b.name);
  if (!s) throw fail('invalid_params', `board is required: a board id or name. Boards you can see: ${live.join(', ')}.`);
  let b = visible.find(x => x.id === s);
  if (!b) {
    const q = s.toLowerCase();
    let hits = visible.filter(x => String(x.name || '').trim().toLowerCase() === q);
    if (!hits.length) hits = visible.filter(x => String(x.name || '').toLowerCase().includes(q));
    if (hits.some(x => !x.archived)) hits = hits.filter(x => !x.archived);
    if (hits.length > 1) throw fail('ambiguous', `More than one board matches "${s}": ${hits.map(x => `${x.name} (id ${x.id})`).join(', ')}. Use the board's full name or its id.`);
    if (!hits.length) throw fail('not_found', `No board you can see is called "${s}". Boards you can see: ${live.join(', ')}.`);
    b = hits[0];
  }
  if (forWrite && b.archived) throw fail('archived', `The board "${b.name}" is archived (Archive & Bin). Restore it in TaskHub before adding or changing its tasks.`);
  return b;
}
function taskBoardId(data, t) {
  const own = resolveTaskBoardId(data, t);
  if (own || !t || !t.parentTaskId) return own;
  return resolveTaskBoardId(data, arr(data.tasks).find(x => x.id === t.parentTaskId));
}
// A task the caller may change: there, not archived, on a live board they can see.
function findWritableTask(data, user, id, what) {
  const t = id ? arr(data.tasks).find(x => x && x.id === String(id)) : null;
  const bId = t ? taskBoardId(data, t) : null;
  const board = bId ? boardsOf(data).find(b => b.id === bId) : null;
  if (!t || !board || !canViewBoard(user, board, data)) throw fail('not_found', `No ${what || 'task'} you can change has the id "${id}". Use list_tasks or get_task to find it.`);
  if (t.archived) throw fail('archived', `"${t.name || t.title}" is archived. Restore it in TaskHub first.`);
  // Archiving a task in the app leaves its subitems' own flag alone; they go with their parent.
  const parent = t.parentTaskId ? arr(data.tasks).find(x => x.id === t.parentTaskId) : null;
  if (parent && parent.archived) throw fail('archived', `"${t.name || t.title}" is a subitem of the archived task "${parent.name || parent.title}". Restore that task in TaskHub first.`);
  if (board.archived) throw fail('archived', `"${t.name || t.title}" is on the archived board "${board.name}". Restore the board in TaskHub first.`);
  return { task: t, board };
}

// ── Groups ──────────────────────────────────────────────────────────────────────────────
// getWbGroups: by order; a group made before ordering existed takes its place among the board's own groups.
function groupsOf(data, boardId) {
  return arr(data.groups).filter(g => g && (g.boardId || g.workboardId) === boardId).map((g, i) => ({ g, i }))
    .sort((a, b) => ((a.g.order != null ? +a.g.order : a.i) - (b.g.order != null ? +b.g.order : b.i)) || a.i - b.i).map(x => x.g);
}
function newGroup(data, board, name, ctx) {
  const nm = String(name || '').trim();
  if (!nm) throw fail('invalid_params', 'A group name is required.');
  if (nm.length > 80) throw fail('invalid_params', 'A group name can be at most 80 characters.');
  const existing = groupsOf(data, board.id);
  const clientId = boardClientId(data, board) || null;
  const client = clientId ? arr(data.clients).find(c => c.id === clientId) : null;
  const g = { id: newId('g_'), workboardId: board.id, boardId: board.id, clientId, name: nm,
    color: (client && client.color) || board.color || '#97bcbd',
    order: existing.reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1,
    createdAt: ctx.now, updatedAt: ctx.now, createdBy: ctx.user.id, createdVia: 'claude' };
  if (!data.groups) data.groups = [];
  data.groups.push(g);
  logEvent(data, ctx, 'Group', g.id, 'created', null, { name: nm, boardId: board.id });
  return g;
}
// A named group on the board (any case), made when it is not there yet; no name = the board's first group.
function groupFor(data, board, name, ctx) {
  const list = groupsOf(data, board.id);
  if (name == null || String(name).trim() === '') {
    if (list.length) return { group: list[0], created: false };
    return { group: newGroup(data, board, 'Tasks', ctx), created: true };
  }
  const q = String(name).trim().toLowerCase();
  const hit = list.find(g => String(g.name || '').trim().toLowerCase() === q);
  if (hit) return { group: hit, created: false };
  return { group: newGroup(data, board, name, ctx), created: true };
}
function nextOrder(data, groupId) {
  let max = -1;
  arr(data.tasks).forEach(t => { if (t && t.groupId === groupId && !t.parentTaskId) { const o = Number(t.order) || 0; if (o > max) max = o; } });
  return max + 1;
}

// ── People ──────────────────────────────────────────────────────────────────────────────
function ownerChoices(data) { return usersOf(data).filter(u => u && u.role !== 'client' && u.active !== false); }
// An email or a full name (any case), else a unique part of a name ("Sam"). Never a client login or someone
// who has left: the app's owner picker does not offer them either.
function resolveOwner(data, raw) {
  const q = String(raw == null ? '' : raw).trim().toLowerCase();
  const staff = ownerChoices(data);
  const names = staff.map(u => u.name).join(', ');
  if (!q) throw fail('invalid_params', `owner must be a staff name or email. Staff: ${names}.`);
  const exact = staff.find(u => String(u.email || '').toLowerCase() === q) || staff.find(u => String(u.name || '').toLowerCase() === q);
  if (exact) return exact;
  const other = usersOf(data).find(u => u && (String(u.email || '').toLowerCase() === q || String(u.name || '').toLowerCase() === q));
  if (other) throw fail('invalid_params', `${other.name} ${other.role === 'client' ? 'is a client login' : 'is no longer active'} and cannot own tasks. Staff: ${names}.`);
  const part = staff.filter(u => String(u.name || '').toLowerCase().includes(q));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw fail('ambiguous', `More than one person matches "${raw}": ${part.map(u => `${u.name} (${u.email || 'no email'})`).join(', ')}. Use the full name or email.`);
  throw fail('not_found', `No staff member matches "${raw}". Staff: ${names}.`);
}
function personName(data, id) {
  const u = id ? usersOf(data).find(x => x.id === id) : null;
  return u ? u.name : (id ? 'someone' : 'none');
}

// ── History and notifications ───────────────────────────────────────────────────────────
// _taskAuditShow: what a change reads like in the task's Audit trail.
function show(data, field, v) {
  if (v == null || v === '' || v === 'none') return 'none';
  if (field === 'status') return statusLabel(data, v);
  if (field === 'priority') return priorityLabel(data, v);
  if (field === 'ownerId') return personName(data, v);
  if (field === 'endDate') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : String(v);
  if (field === 'groupId') { const g = arr(data.groups).find(x => x.id === v); return g ? g.name : 'another group'; }
  if (field === 'boardId') { const b = boardsOf(data).find(x => x.id === v); return b ? b.name : 'another board'; }
  if (field === 'description') return 'edited';
  return String(v).slice(0, 120);
}
const FIELD_LABELS = { status: 'Status', priority: 'Priority', ownerId: 'Owner', endDate: 'Due date', groupId: 'Group', name: 'Name',
  description: 'Description', boardId: 'Board', rank: 'Rank' };
// One entry per changed field on the task (the app keeps the latest 30), plus the permanent copy the route sends to
// public.audit_log once the write has landed. Both say who and that it came through Claude.
function recordChange(data, ctx, t, field, before, after) {
  const label = FIELD_LABELS[field] || field;
  const from = show(data, field, before), to = show(data, field, after);
  const tr = t.auditTrail = Array.isArray(t.auditTrail) ? t.auditTrail : [];
  tr.push({ id: newId('ta'), at: ctx.now, by: ctx.user.id, via: 'claude', field, label, raw: field === 'description' ? null : (before === undefined ? null : before), from, to });
  if (tr.length > 30) t.auditTrail = tr.slice(-30);
  // The permanent table keys people by their sign-in id (profiles.id), not the record's user id.
  ctx.audits.push({ entityType: 'Task', entityId: t.id, actorId: ctx.actorUid || null, action: 'updated:' + field,
    before: { field, label, displayValue: from, via: 'claude' }, after: { field, label, displayValue: to, via: 'claude' } });
}
// writeAuditEvent: the shared log (capped at 1,000 like the app) and the permanent copy.
function logEvent(data, ctx, entityType, entityId, action, before, after) {
  if (!data.auditLog) data.auditLog = [];
  const b = before ? Object.assign({}, before, { via: 'claude' }) : null, a = after ? Object.assign({}, after, { via: 'claude' }) : null;
  data.auditLog.push({ id: newId('ae'), entityType, entityId, actorId: ctx.user.id, action, via: 'claude',
    beforeValueJson: b ? JSON.stringify(b) : null, afterValueJson: a ? JSON.stringify(a) : null, createdAt: ctx.now });
  if (data.auditLog.length > 1000) data.auditLog = data.auditLog.slice(-1000);
  ctx.audits.push({ entityType, entityId, actorId: ctx.actorUid || null, action, before: b, after: a });
}
function notify(data, ctx, recipientId, t, type, message) {
  if (!recipientId || recipientId === ctx.user.id) return;
  const who = usersOf(data).find(u => u.id === recipientId);
  if (!who || who.active === false || !canViewTask(who, t, data)) return;
  if (!data.notifications) data.notifications = [];
  data.notifications.push({ id: newId('n'), recipientId, taskId: t.id, type, message, read: false, createdAt: ctx.now, byUserId: ctx.user.id, via: 'claude' });
}
// getEffectiveTaskPct, stored on the parent as the app does when a subitem's status changes.
function rollUp(data, ctx, parentId) {
  const p = parentId ? arr(data.tasks).find(x => x.id === parentId) : null;
  if (!p || p.archived) return;
  const kids = arr(data.tasks).filter(x => x.parentTaskId === parentId && !x.archived);
  if (!kids.length) return;
  p.percentComplete = Math.round(kids.reduce((s, x) => s + (DONE.includes(x.status) ? 100 : (x.percentComplete || 0)), 0) / kids.length);
  p.updatedAt = ctx.now;
}

// ── Output ──────────────────────────────────────────────────────────────────────────────
// The same shape as get_task, plus rank.
function publicTask(data, user, t, base) {
  return Object.assign(getTaskForUser(data, user, t.id, base), { rank: typeof t.rank === 'number' ? t.rank : null });
}
function shortTask(data, t, base) {
  const bId = taskBoardId(data, t);
  const board = bId ? boardsOf(data).find(b => b.id === bId) : null;
  const g = arr(data.groups).find(x => x.id === t.groupId);
  return { id: t.id, title: t.name || t.title || '', board: board ? board.name : null, boardId: bId || null, group: g ? g.name : null,
    owner: t.ownerId ? personName(data, t.ownerId) : null, status: t.status || null, priority: t.priority || null,
    dueDate: t.endDate || null, parentId: t.parentTaskId || null, url: taskUrl(base, bId, t.id) };
}

// ── create_task / create_tasks ──────────────────────────────────────────────────────────
const CREATE_FIELDS = ['board', 'title', 'group', 'description', 'owner', 'dueDate', 'priority', 'status', 'parentId'];
function checkFields(input, allowed, tool) {
  const extra = Object.keys(input || {}).filter(k => !allowed.includes(k));
  if (extra.length) throw fail('invalid_params', `${tool} does not take ${extra.map(k => `"${k}"`).join(', ')}. It takes: ${allowed.join(', ')}.`);
}
// Everything is checked before anything is written, so a task that fails leaves no half-made group behind.
function createOne(data, ctx, input) {
  checkFields(input, CREATE_FIELDS, 'create_task');
  const title = String(input.title == null ? '' : input.title).trim();
  if (!title) throw fail('invalid_params', 'title is required.');
  if (title.length > 500) throw fail('invalid_params', 'title can be at most 500 characters.');
  const description = input.description == null ? '' : String(input.description);
  if (description.length > 20000) throw fail('invalid_params', 'description can be at most 20,000 characters.');
  const status = input.status != null && input.status !== '' ? resolveStatus(data, input.status) : 'todo';
  const priority = input.priority != null && input.priority !== '' ? resolvePriority(data, input.priority) : 'med';
  const due = input.dueDate != null && input.dueDate !== '' ? validDate(input.dueDate, 'dueDate') : null;
  const owner = input.owner != null && input.owner !== '' ? resolveOwner(data, input.owner) : null;

  let parent = null, board;
  if (input.parentId != null && input.parentId !== '') {
    const w = findWritableTask(data, ctx.user, input.parentId, 'parent task');
    parent = w.task; board = w.board;
    if (parent.parentTaskId) throw fail('invalid_params', `"${parent.name || parent.title}" is itself a subitem. Subitems go one level deep: use its parent (${parent.parentTaskId}).`);
    if (input.board != null && input.board !== '' && findBoard(data, ctx.user, input.board, true).id !== board.id) {
      throw fail('invalid_params', `The parent task is on "${board.name}", not "${input.board}". A subitem lives on its parent's board.`);
    }
    if (input.group != null && input.group !== '') throw fail('invalid_params', 'A subitem stays in its parent\'s group: leave group out when you pass parentId.');
  } else {
    board = findBoard(data, ctx.user, input.board, true);
  }
  const now = ctx.now;
  let t, groupCreated = false;
  if (parent) {
    const pg = arr(data.groups).find(g => g.id === parent.groupId);
    const ownerId = owner ? owner.id : null;
    t = { id: newId('si_'), parentTaskId: parent.id, name: title, title, status, priority,
      clientId: parent.clientId || (pg && pg.clientId) || null,
      ownerId, currentlyWith: 'internal', currentlyWithUserId: ownerId,
      groupId: parent.groupId, boardId: board.id, workboardId: board.id, startDate: null, endDate: due,
      percentComplete: 0, tags: [], dependencies: [], archived: false, hourBudget: null,
      order: arr(data.tasks).filter(x => x.parentTaskId === parent.id).length,
      description, createdAt: now, updatedAt: now, createdBy: ctx.user.id, createdVia: 'claude' };
  } else {
    const gr = groupFor(data, board, input.group, ctx);
    groupCreated = gr.created;
    const ownerId = owner ? owner.id : ctx.user.id;
    const today = todayStr(now);
    t = { id: newId('t'), groupId: gr.group.id, workboardId: board.id, boardId: board.id,
      clientId: gr.group.clientId || boardClientId(data, board) || null,
      name: title, title, status, priority, ownerId,
      currentlyWith: 'internal', currentlyWithType: 'none', currentlyWithUserId: ownerId,
      percentComplete: 0, startDate: due && due < today ? due : today, endDate: due || '',
      hourBudget: '', description, dependencies: [], tags: [], archived: false, order: nextOrder(data, gr.group.id),
      createdAt: now, updatedAt: now, completedAt: null, createdBy: ctx.user.id, createdVia: 'claude' };
  }
  if (status !== 'todo') applyStatusProgress(t, status, 'todo', now);
  if (!data.tasks) data.tasks = [];
  data.tasks.push(t);
  if (parent) rollUp(data, ctx, parent.id);
  logEvent(data, ctx, 'Task', t.id, 'created', null, { name: title, boardId: board.id, groupId: t.groupId, parentTaskId: t.parentTaskId || null });
  notify(data, ctx, t.ownerId, t, 'task_assigned', `Task assigned to you: ${title}`);
  return { task: t, groupCreated };
}
function createTask(data, user, input, base, ctx) {
  assertCanWrite(user);
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const { task, groupCreated } = createOne(data, c, input || {});
  return { result: { ok: true, groupCreated, task: publicTask(data, user, task, base) }, audits: c.audits };
}
const MAX_BULK = 100;
function createTasks(data, user, input, base, ctx) {
  assertCanWrite(user);
  const list = input && input.tasks;
  if (!Array.isArray(list) || !list.length) throw fail('invalid_params', 'tasks is required: a list of 1 to 100 tasks, each with board and title (same fields as create_task).');
  if (list.length > MAX_BULK) throw fail('invalid_params', `At most ${MAX_BULK} tasks in one call (got ${list.length}). Split the list.`);
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const created = [], failed = [], groups = new Set();
  list.forEach((item, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw fail('invalid_params', 'Each task must be an object with board and title.');
      const { task, groupCreated } = createOne(data, c, item);
      if (groupCreated) groups.add(task.groupId);
      created.push(Object.assign({ index }, shortTask(data, task, base)));
    } catch (e) {
      failed.push({ index, title: item && item.title != null ? String(item.title) : null, error: e.message });
    }
  });
  const groupsCreated = [...groups].map(id => { const g = arr(data.groups).find(x => x.id === id); return g ? { id: g.id, name: g.name } : null; }).filter(Boolean);
  return { result: { ok: failed.length === 0, createdCount: created.length, failedCount: failed.length, created, failed, groupsCreated }, audits: c.audits, unchanged: !created.length };
}

// ── update_task ─────────────────────────────────────────────────────────────────────────
const UPDATE_FIELDS = ['id', 'title', 'description', 'priority', 'status', 'dueDate', 'owner', 'group', 'board', 'rank'];
function moveTo(data, ctx, t, board, group) {
  const before = { boardId: taskBoardId(data, t), groupId: t.groupId };
  const order = nextOrder(data, group.id);
  t.boardId = board.id; t.workboardId = board.id; t.groupId = group.id;
  t.clientId = group.clientId || boardClientId(data, board) || null;
  t.order = order;
  // Subitems carry their parent's board and group.
  arr(data.tasks).filter(x => x.parentTaskId === t.id).forEach(s => {
    s.boardId = board.id; s.workboardId = board.id; s.groupId = group.id; s.clientId = t.clientId; s.updatedAt = ctx.now;
  });
  if (before.boardId !== board.id) recordChange(data, ctx, t, 'boardId', before.boardId, board.id);
  if (before.groupId !== group.id) recordChange(data, ctx, t, 'groupId', before.groupId, group.id);
}
function updateTask(data, user, input, base, ctx) {
  assertCanWrite(user);
  input = input || {};
  checkFields(input, UPDATE_FIELDS, 'update_task');
  if (!input.id) throw fail('invalid_params', 'id is required (from list_tasks, get_task or create_task).');
  if (!UPDATE_FIELDS.some(k => k !== 'id' && input[k] !== undefined)) throw fail('invalid_params', `Nothing to change. Pass at least one of: ${UPDATE_FIELDS.filter(k => k !== 'id').join(', ')}.`);
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const { task: t, board } = findWritableTask(data, user, input.id);
  const isSub = !!t.parentTaskId;

  // Check every value first: one bad field changes nothing.
  const want = {};
  if (input.title !== undefined) {
    const v = String(input.title == null ? '' : input.title).trim();
    if (!v) throw fail('invalid_params', 'title cannot be empty.');
    if (v.length > 500) throw fail('invalid_params', 'title can be at most 500 characters.');
    want.name = v;
  }
  if (input.description !== undefined) {
    const v = input.description == null ? '' : String(input.description);
    if (v.length > 20000) throw fail('invalid_params', 'description can be at most 20,000 characters.');
    want.description = v;
  }
  if (input.priority !== undefined) want.priority = resolvePriority(data, input.priority);
  if (input.status !== undefined) want.status = resolveStatus(data, input.status);
  if (input.dueDate !== undefined) want.endDate = input.dueDate == null || input.dueDate === '' ? (isSub ? null : '') : validDate(input.dueDate, 'dueDate');
  if (input.owner !== undefined) want.ownerId = input.owner == null || input.owner === '' ? null : resolveOwner(data, input.owner).id;
  if (input.rank !== undefined) {
    if (input.rank !== null && !(Number.isInteger(input.rank) && Math.abs(input.rank) <= 1000000)) throw fail('invalid_params', `rank must be a whole number (or null to clear it), got ${JSON.stringify(input.rank)}.`);
    want.rank = input.rank;
  }
  const moving = (input.board != null && input.board !== '') || (input.group != null && input.group !== '');
  if (moving && isSub) throw fail('invalid_params', 'A subitem moves with its parent: change the board or group of the parent task instead.');
  const target = input.board != null && input.board !== '' ? findBoard(data, user, input.board, true) : board;

  // Apply.
  const changed = [];
  const set = (field, value) => {
    const before = t[field];
    const norm = v => JSON.stringify(v == null || v === '' ? null : v);
    if (norm(before) === norm(value)) return false;
    t[field] = value; changed.push(field);
    recordChange(data, c, t, field, before, value);
    return true;
  };
  if (want.name !== undefined && set('name', want.name)) t.title = want.name;
  if (want.description !== undefined) set('description', want.description);
  if (want.priority !== undefined) set('priority', want.priority);
  if (want.status !== undefined) {
    const prev = t.status;
    if (set('status', want.status)) {
      applyStatusProgress(t, want.status, prev, c.now);
      if (isSub) rollUp(data, c, t.parentTaskId);
    }
  }
  if (want.endDate !== undefined) set('endDate', want.endDate);
  if (want.ownerId !== undefined) {
    const prev = t.ownerId;
    if (set('ownerId', want.ownerId)) {
      // setTaskAssignees: the old and new lead leave the co-assignees, and the first one left is the co-owner.
      t.assigneeIds = [...new Set(arr(t.assigneeIds).filter(Boolean).filter(id => id !== prev && id !== want.ownerId))];
      t.coOwnerId = t.assigneeIds[0] || null;
      notify(data, c, want.ownerId, t, 'owner_changed', `You are now the owner of: ${t.name || t.title}`);
    }
  }
  if (want.rank !== undefined) set('rank', want.rank);
  let groupCreated = false;
  if (moving) {
    const sameBoard = target.id === board.id;
    let gr;
    if (input.group != null && input.group !== '') gr = groupFor(data, target, input.group, c);
    else if (sameBoard) gr = { group: arr(data.groups).find(g => g.id === t.groupId) || groupFor(data, target, null, c).group, created: false };
    else gr = groupFor(data, target, null, c);
    groupCreated = gr.created;
    if (!sameBoard || gr.group.id !== t.groupId) {
      moveTo(data, c, t, target, gr.group);
      if (!sameBoard) changed.push('board');
      changed.push('group');
    }
  }
  if (changed.length) t.updatedAt = c.now;
  return { result: { ok: true, changed, groupCreated, task: publicTask(data, user, t, base) }, audits: c.audits, unchanged: !changed.length };
}

// ── Groups ──────────────────────────────────────────────────────────────────────────────
function listGroups(data, user, input) {
  const board = findBoard(data, user, input && input.board, false);
  const groups = groupsOf(data, board.id).map(g => {
    const top = arr(data.tasks).filter(t => t && t.groupId === g.id && !t.parentTaskId && !t.archived);
    return { id: g.id, name: g.name, order: g.order != null ? g.order : null, taskCount: top.length, openTaskCount: top.filter(t => !DONE.includes(t.status) && t.status !== 'cancelled').length };
  });
  return { ok: true, board: { id: board.id, name: board.name, archived: !!board.archived }, groups };
}
function createGroup(data, user, input, base, ctx) {
  assertCanWrite(user);
  input = input || {};
  checkFields(input, ['board', 'name'], 'create_group');
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const board = findBoard(data, user, input.board, true);
  const q = String(input.name == null ? '' : input.name).trim().toLowerCase();
  const hit = q && groupsOf(data, board.id).find(g => String(g.name || '').trim().toLowerCase() === q);
  const g = hit || newGroup(data, board, input.name, c);
  return { result: { ok: true, created: !hit, board: { id: board.id, name: board.name }, group: { id: g.id, name: g.name, order: g.order } }, audits: c.audits, unchanged: !!hit };
}

// ── add_comment ─────────────────────────────────────────────────────────────────────────
// addComment: the comment, its log event, @mentions and the task's people told (never the author).
function addComment(data, user, input, base, ctx) {
  assertCanWrite(user);
  input = input || {};
  checkFields(input, ['taskId', 'text'], 'add_comment');
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const { task: t } = findWritableTask(data, user, input.taskId);
  const body = String(input.text == null ? '' : input.text).trim();
  if (!body) throw fail('invalid_params', 'text is required.');
  if (body.length > 5000) throw fail('invalid_params', 'A comment can be at most 5,000 characters.');
  const comment = { id: newId('cm'), taskId: t.id, authorId: user.id, authorName: user.name, body, createdAt: c.now, timestamp: c.now, via: 'claude' };
  if (!data.comments) data.comments = [];
  data.comments.push(comment);
  logEvent(data, c, 'Comment', comment.id, 'created', null, { taskId: t.id, authorId: user.id, bodyPreview: body.slice(0, 120) });
  const told = new Set([user.id]);
  const staff = ownerChoices(data);
  for (const m of body.matchAll(/@([\w][\w\d_-]*)/g)) {
    const token = m[1].toLowerCase();
    staff.filter(s => String(s.name || '').toLowerCase().replace(/\s+/g, '').startsWith(token) || String(s.name || '').toLowerCase().split(' ')[0].startsWith(token))
      .forEach(s => { if (!told.has(s.id)) { told.add(s.id); notify(data, c, s.id, t, 'mention', `${user.name} mentioned you in: ${t.name || t.title}`); } });
  }
  [...new Set([t.ownerId, ...arr(t.assigneeIds)].filter(Boolean))].forEach(id => {
    if (!told.has(id)) { told.add(id); notify(data, c, id, t, 'comment', `New comment on: ${t.name || t.title}`); }
  });
  return { result: { ok: true, comment: { id: comment.id, taskId: t.id, author: user.name, via: 'Claude', text: body, createdAt: c.now }, task: shortTask(data, t, base) }, audits: c.audits };
}

// ── route_action ────────────────────────────────────────────────────────────────────────
// triageConfirmRoute: the email's own title and description, board, group, owner, due date and priority, status
// Not Started, tagged email-intake so list_actions and update_action keep seeing it; the queue item is marked routed.
function routeAction(data, user, input, base, ctx) {
  assertCanWrite(user);
  input = input || {};
  checkFields(input, ['actionId', 'board', 'group', 'owner', 'dueDate', 'priority'], 'route_action');
  const c = Object.assign({ data, user, now: new Date().toISOString(), audits: [] }, ctx || {});
  const item = input.actionId ? arr(data.emailIntake).find(x => x && x.id === String(input.actionId)) : null;
  if (!item) throw fail('not_found', `No email action has the id "${input.actionId}". Use list_actions with status "pending" to find it.`);
  if (item.status !== 'pending') {
    const done = item.routedToTaskId ? arr(data.tasks).find(t => t.id === item.routedToTaskId) : null;
    throw fail('conflict', item.status === 'routed' ? `This email was already routed${done ? ` to "${done.name || done.title}" (task ${done.id})` : ''}. Use update_task to change that task.` : `This email action is ${item.status}, not waiting to be routed.`);
  }
  if (input.group == null || String(input.group).trim() === '') throw fail('invalid_params', 'group is required: a group name on that board (use list_groups). A new name makes a new group.');
  const owner = resolveOwner(data, input.owner);
  // As the Route dialog: the email's suggested date when it is a real date (its date box drops anything else), and
  // Medium unless a priority is given (the dialog does not take the suggested one; create_action never checks it).
  const suggested = (() => { try { return item.suggestedDueDate ? validDate(item.suggestedDueDate, 'dueDate') : null; } catch (_) { return null; } })();
  const due = input.dueDate != null && input.dueDate !== '' ? validDate(input.dueDate, 'dueDate') : suggested;
  const priority = input.priority != null && input.priority !== '' ? resolvePriority(data, input.priority) : 'med';
  const board = findBoard(data, user, input.board, true);
  const gr = groupFor(data, board, input.group, c);
  const title = String(item.suggestedTitle || item.subject || 'Email task').trim() || 'Email task';
  const t = { id: newId('t'), workboardId: board.id, boardId: board.id, groupId: gr.group.id,
    title, name: title, description: item.suggestedDescription || item.snippet || '', status: 'not-started', priority,
    ownerId: owner.id, startDate: null, endDate: due,
    archived: false, order: nextOrder(data, gr.group.id), tags: ['email-intake'],
    emailSource: { from: item.from, fromName: item.fromName, subject: item.subject, receivedAt: item.receivedAt, originalEmailId: item.originalEmailId },
    createdAt: c.now, updatedAt: c.now,
    percentComplete: 0, percentMode: 'manual', lockedDates: false, dependencies: [], createdBy: user.id, createdVia: 'claude' };
  if (item.emailLink) t.emailLink = item.emailLink;
  if (!data.tasks) data.tasks = [];
  data.tasks.push(t);
  item.status = 'routed'; item.routedToTaskId = t.id; item.routedAt = c.now; item.routedBy = user.id; item.updatedAt = c.now;
  logEvent(data, c, 'Task', t.id, 'created', null, { name: title, boardId: board.id, groupId: gr.group.id, fromEmail: item.id });
  notify(data, c, owner.id, t, 'task_assigned', `Task assigned to you: ${title}`);
  return { result: { ok: true, groupCreated: gr.created, task: publicTask(data, user, t, base) }, audits: c.audits };
}

module.exports = {
  createTask, createTasks, updateTask, listGroups, createGroup, addComment, routeAction,
  // exported for tests
  findBoard, resolveOwner, resolveStatus, resolvePriority, validDate, groupsOf, MAX_BULK,
};
