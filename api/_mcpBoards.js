// Pure logic for the MCP connector's read-only board/task tools (list_boards, list_tasks,
// get_task). No HTTP, no fetch, no crypto — same convention as _mcpActions.js, so this can be
// unit-tested directly with plain objects. Leading underscore = shared module, not a Vercel route.
//
// Visibility is a line-for-line mirror of index.html's own canViewBoard()/canViewTask() — never
// re-derived independently, since two copies of a permission rule drifting apart is exactly how a
// cross-account leak happens. If those functions ever change, this file must change with them.

function boardsOf(data) { return data.boards || data.workboards || []; }
function usersOf(data) { return data.users || data.staff || []; }

// Mirrors index.html:5167 canViewBoard(user,board) exactly.
function canViewBoard(user, board, data) {
  if (!user || !board) return false;
  if (user.role === 'client') return false;
  if (user.role === 'admin' || user.role === 'pm') return true;
  if (board.visibility === 'all_internal') return true;
  if (board.ownerId === user.id) return true;
  if ((data.boardShares || []).some(s => s.boardId === board.id && s.userId === user.id)) return true;
  return false;
}

// Mirrors index.html:5872 _taskBoardId(t) plus its group-fallback lookup.
function resolveTaskBoardId(data, t) {
  if (!t) return null;
  if (t.boardId || t.workboardId) return t.boardId || t.workboardId;
  const g = (data.groups || []).find(g => g.id === t.groupId);
  return g ? (g.boardId || g.workboardId || null) : null;
}
function isAssignedTo(t, userId) {
  if (!userId || !t) return false;
  const ids = new Set([t.ownerId, ...(t.assigneeIds || [])].filter(Boolean));
  return ids.has(userId);
}
// Mirrors index.html:5895 canViewTask(user,task) for the staff/admin branches — the client branch
// is intentionally omitted: the MCP connector is allow-listed to real staff accounts only
// (api/_mcpAuth.js), never a client login, so there is nothing to mirror there.
function canViewTask(user, task, data) {
  if (!user || !task) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'staff' || user.role === 'restricted') {
    const bId = resolveTaskBoardId(data, task);
    const board = bId ? boardsOf(data).find(b => b.id === bId) : null;
    if (board && !canViewBoard(user, board, data)) return isAssignedTo(task, user.id) || task.currentlyWithUserId === user.id;
    return true;
  }
  return false;
}

// Mirrors index.html:22559 boardClientId(wb).
function boardClientId(data, board) {
  if (!board) return null;
  if (board.clientId != null) return board.clientId;
  const g = (data.groups || []).find(g => (g.boardId || g.workboardId) === board.id && g.clientId);
  return g ? g.clientId : null;
}

// Resolves the MCP caller's real TaskHub user record — the OAuth token only carries the Supabase
// auth id (sub) and email, neither of which is DB.users' own id (which canViewBoard/canViewTask
// compare against). Matches by supabase_uid first (the real, stable link), falling back to email
// (case-insensitive) since not every account is guaranteed to carry supabase_uid.
function resolveCallerUser(data, sub, email) {
  const users = usersOf(data);
  const bySub = sub && users.find(u => u.supabase_uid === sub);
  if (bySub) return bySub;
  const q = email && String(email).trim().toLowerCase();
  return (q && users.find(u => (u.email || '').toLowerCase() === q)) || null;
}

const DONE_STATUSES = new Set(['done', 'completed', 'completed-approved', 'cancelled']);
const PRIORITY_ORDER = { high: 0, med: 1, low: 2 };

function listBoardsForUser(data, user) {
  const visible = boardsOf(data).filter(b => !b.archived && canViewBoard(user, b, data));
  return visible.map(b => {
    const clientId = boardClientId(data, b);
    const client = clientId ? (data.clients || []).find(c => c.id === clientId) : null;
    const boardTasks = (data.tasks || []).filter(t => !t.archived && resolveTaskBoardId(data, t) === b.id);
    const taskCountByStatus = {};
    for (const t of boardTasks) { const s = t.status || 'todo'; taskCountByStatus[s] = (taskCountByStatus[s] || 0) + 1; }
    return { id: b.id, name: b.name, client: client ? client.name : null, taskCountByStatus };
  });
}

function matchesOwnerFilter(data, t, ownerText) {
  const q = String(ownerText).trim().toLowerCase();
  const match = usersOf(data).find(u => (u.email || '').toLowerCase() === q || (u.name || '').toLowerCase() === q);
  if (!match) return false;
  return t.ownerId === match.id || (t.assigneeIds || []).includes(match.id);
}
function matchesClientFilter(data, t, clientText) {
  const q = String(clientText).trim().toLowerCase();
  const client = (data.clients || []).find(c => (c.name || '').toLowerCase() === q || (c.shortCode || '').toLowerCase() === q);
  if (!client) return false;
  const bId = resolveTaskBoardId(data, t);
  const board = bId ? boardsOf(data).find(b => b.id === bId) : null;
  return board ? boardClientId(data, board) === client.id : false;
}

function taskUrl(base, boardId, taskId) {
  if (!base) return null;
  const params = new URLSearchParams({ openTask: taskId });
  if (boardId) params.set('openBoard', boardId);
  return `${base}/?${params.toString()}`;
}

function toPublicTask(data, t, base) {
  const bId = resolveTaskBoardId(data, t);
  const board = bId ? boardsOf(data).find(b => b.id === bId) : null;
  const group = (data.groups || []).find(g => g.id === t.groupId);
  const clientId = board ? boardClientId(data, board) : null;
  const client = clientId ? (data.clients || []).find(c => c.id === clientId) : null;
  const owner = t.ownerId ? usersOf(data).find(u => u.id === t.ownerId) : null;
  return {
    id: t.id, title: t.name || t.title || '',
    board: board ? board.name : null, boardId: bId || null,
    client: client ? client.name : null, group: group ? group.name : null,
    owner: owner ? owner.name : null, status: t.status || null, priority: t.priority || null,
    dueDate: t.endDate || null, createdAt: t.createdAt || null, updatedAt: t.updatedAt || null,
    source: (t.tags || []).includes('email-intake') ? 'email-triage' : 'manual',
    parentId: t.parentTaskId || null,
    subitemIds: (data.tasks || []).filter(x => x.parentTaskId === t.id && !x.archived).map(x => x.id),
    url: taskUrl(base, bId, t.id),
  };
}

// visibleBoardIds: precomputed by the caller (listTasksForUser/getTaskForUser) so this stays a
// pure per-row check, not an O(n) board scan per task.
function taskVisible(data, user, t, visibleBoardIds) {
  const bId = resolveTaskBoardId(data, t);
  if (bId) return visibleBoardIds.has(bId) || isAssignedTo(t, user.id) || t.currentlyWithUserId === user.id;
  // No identifiable board at all (a genuinely orphaned task) — fall back to the same admin/staff
  // default canViewTask uses when it can't find a board to check against.
  return user.role === 'admin' || user.role === 'staff' || user.role === 'restricted';
}

function listTasksForUser(data, user, filter, base) {
  filter = filter || {};
  const visibleBoardIds = new Set(boardsOf(data).filter(b => canViewBoard(user, b, data)).map(b => b.id));
  let tasks = (data.tasks || []).filter(t => !t.archived && taskVisible(data, user, t, visibleBoardIds));

  if (filter.boardId) tasks = tasks.filter(t => resolveTaskBoardId(data, t) === filter.boardId);
  if (filter.client) tasks = tasks.filter(t => matchesClientFilter(data, t, filter.client));
  if (filter.owner) tasks = tasks.filter(t => matchesOwnerFilter(data, t, filter.owner));
  if (filter.status) tasks = tasks.filter(t => t.status === filter.status);
  if (filter.priority) tasks = tasks.filter(t => t.priority === filter.priority);
  if (filter.dueBefore) tasks = tasks.filter(t => t.endDate && t.endDate < filter.dueBefore);
  if (filter.dueAfter) tasks = tasks.filter(t => t.endDate && t.endDate > filter.dueAfter);
  if (filter.updatedSince) tasks = tasks.filter(t => t.updatedAt && t.updatedAt >= filter.updatedSince);
  if (!filter.includeDone) tasks = tasks.filter(t => !DONE_STATUSES.has(t.status));

  const sortKey = filter.sort || 'dueDate';
  tasks = tasks.slice().sort((a, b) => {
    if (sortKey === 'priority') return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    if (sortKey === 'updatedAt') return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    const ad = a.endDate || '9999-12-31', bd = b.endDate || '9999-12-31'; // no-due-date sorts last
    return ad.localeCompare(bd);
  });

  const limit = Math.max(1, Math.min(200, Number(filter.limit) || 50));
  const offset = Math.max(0, Number(filter.offset) || 0);
  const page = tasks.slice(offset, offset + limit);
  return {
    items: page.map(t => toPublicTask(data, t, base)),
    total: tasks.length,
    nextOffset: offset + limit < tasks.length ? offset + limit : null,
  };
}

function getTaskForUser(data, user, id, base) {
  const t = (data.tasks || []).find(x => x.id === id);
  if (!t || t.archived) throw Object.assign(new Error('No task with that id'), { code: 'not_found' });
  const visibleBoardIds = new Set(boardsOf(data).filter(b => canViewBoard(user, b, data)).map(b => b.id));
  if (!taskVisible(data, user, t, visibleBoardIds)) throw Object.assign(new Error('That task is not visible to you'), { code: 'forbidden' });
  const base_ = toPublicTask(data, t, base);
  const parent = t.parentTaskId ? (data.tasks || []).find(x => x.id === t.parentTaskId) : null;
  const group = (data.groups || []).find(g => g.id === t.groupId);
  const subitems = (data.tasks || []).filter(x => x.parentTaskId === t.id && !x.archived)
    .map(x => ({ id: x.id, title: x.name || x.title || '', status: x.status || null, priority: x.priority || null, dueDate: x.endDate || null }));
  return {
    ...base_,
    description: t.description || t.notes || '',
    parent: parent ? { id: parent.id, title: parent.name || parent.title || '', status: parent.status || null } : null,
    groupDetail: group ? { id: group.id, name: group.name } : null,
    subitems,
  };
}

module.exports = {
  canViewBoard, canViewTask, resolveTaskBoardId, boardClientId, resolveCallerUser,
  listBoardsForUser, listTasksForUser, getTaskForUser, taskUrl, DONE_STATUSES,
};
