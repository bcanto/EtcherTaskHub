// ════════════════════════════════════════════════════════════════════════════
// api/_portal.js — the ONE authority for what a client-portal session may see and do.
// (Leading underscore: a shared module, not a Vercel route.)
//
// Clients never receive the app_state blob and never write it. They get sliceForClient(),
// and can only change data through applyPortalAction() — both run server-side in
// api/portal-data.js and api/portal-action.js with the service role key.
// See .agents/PLAN-server-enforcement.md.
//
// Pure functions: no network, no env, no clock, no randomness — the caller passes `now` and
// `rid()` in ctx. That keeps every rule here testable in plain Node against a copy of the data
// (.agents/portal-logic-test.cjs).
//
// Behaviour mirrors the browser functions it replaces (cpPostClientComment,
// cpSendActionResponse, cpAddActionLink, cpUploadToTask, cpApproveTask, cpSubmitChanges,
// cpSubmitChangesRequest, cpSubmitRequest, the read-flag write in renderCpNotifications).
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const DONE_STATUSES = ['done', 'completed', 'completed-approved'];
const BLOCKED_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml']);
const BLOCKED_EXT = /\.(svg|html?|xml)$/i;
const MAX_FILE_BYTES = 1048576;           // same 1 MB cap as the portal upload
// A work request carries its files inline as base64 (+33%). Vercel rejects request bodies over
// 4.5 MB before the handler runs, so cap the total well under that — the portal checks too.
const MAX_REQUEST_ATTACH_BYTES = 3 * 1048576;
const EMAIL_TYPES = new Set(['mention', 'task_assigned', 'owner_changed', 'currently_with']);
const KIND_VERB = { review: 'review', approve: 'approve', supply: 'supply information for', decide: 'decide on', info: 'see' };

const arr = x => (Array.isArray(x) ? x : []);
const clone = x => JSON.parse(JSON.stringify(x));
const taskName = t => (t && (t.name || t.title)) || 'a task';

// ── Resolution helpers (same order as canViewTask / _cpTaskHidden in index.html) ─────────
function findTask(blob, id) { return arr(blob.tasks).find(t => t.id === id) || null; }
function findGroup(blob, id) { return arr(blob.groups).find(g => g.id === id) || null; }

function taskClientId(blob, t, depth = 0) {
  if (!t || depth > 20) return null;
  if (t.clientId) return t.clientId;
  const g = findGroup(blob, t.groupId);
  if (g && g.clientId) return g.clientId;
  if (t.parentTaskId) return taskClientId(blob, findTask(blob, t.parentTaskId), depth + 1);
  return null;
}
function taskBoardId(blob, t, depth = 0) {
  if (!t || depth > 20) return null;
  if (t.boardId || t.workboardId) return t.boardId || t.workboardId;
  const g = findGroup(blob, t.groupId);
  if (g && (g.boardId || g.workboardId)) return g.boardId || g.workboardId;
  if (t.parentTaskId) return taskBoardId(blob, findTask(blob, t.parentTaskId), depth + 1);
  return null;
}
function taskHidden(blob, t, depth = 0) {
  if (!t || depth > 20) return true;
  if (t.clientHidden) return true;
  if (t.parentTaskId) {
    const p = findTask(blob, t.parentTaskId);
    if (p && taskHidden(blob, p, depth + 1)) return true;
  }
  return false;
}
function portalClient(blob, clientId) {
  const c = arr(blob.clients).find(x => x.id === clientId);
  return c && c.portalEnabled ? c : null;
}
function taskVisibleTo(blob, clientId, t) {
  return !!t && !t.archived && !taskHidden(blob, t) && taskClientId(blob, t) === clientId;
}
// Same definition the portal uses for "this is waiting on you".
function awaitingClient(t) {
  return t.currentlyWithType === 'client' || t.status === 'ready-approval' || t.status === 'waiting-client';
}
function openRequestFor(blob, taskId) {
  return arr(blob.actionRequests).find(r => r.taskId === taskId && r.status === 'open') || null;
}
// Same rule as the portal's _cpIsApprovalAsk: Approve / Request changes only answer an approval
// ask. A "review X" or "send us Y" request is answered with Mark done, never by approving the task.
function isApprovalAsk(blob, t) {
  const open = openRequestFor(blob, t.id);
  return t.status === 'ready-approval' || !open || open.kind === 'approve';
}

// ── The slice ────────────────────────────────────────────────────────────────────────────
// Whitelists only. Anything not named here never leaves the server — hour budgets, owners,
// assignees, internal descriptions, tags, time entries, rates, invoices, client notes, the
// staff roster, other clients.
const TASK_FIELDS = ['id', 'name', 'title', 'status', 'percentComplete', 'startDate', 'endDate', 'priority',
  'approvalType', 'clientDescription', 'parentTaskId', 'groupId', 'order', 'createdAt', 'updatedAt', 'completedAt'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function sliceTask(blob, t) {
  const s = pick(t, TASK_FIELDS);
  s.clientId = taskClientId(blob, t);
  const bid = taskBoardId(blob, t);
  s.boardId = bid; s.workboardId = bid;
  s.archived = false;
  // Only whether it's with the client — never which staff member holds it.
  s.currentlyWithType = t.currentlyWithType === 'client' ? 'client' : 'staff';
  s.awaitingClient = awaitingClient(t);
  if (t.clientApproval) s.clientApproval = { status: t.clientApproval.status, note: t.clientApproval.note || null, at: t.clientApproval.at || null };
  return s;
}

function sliceActionRequest(r) {
  return pick(r, ['id', 'taskId', 'clientId', 'kind', 'title', 'body', 'dueDate', 'status', 'createdAt', 'updatedAt', 'respondedAt', 'responseNote']);
}

// userId: the caller's auth uid — their own notifications only.
function sliceForClient(blob, clientId, userId) {
  const client = portalClient(blob, clientId);
  if (!client) return null;

  const tasks = arr(blob.tasks).filter(t => taskVisibleTo(blob, clientId, t));
  const taskIds = new Set(tasks.map(t => t.id));
  const boards = arr(blob.boards).filter(b => b.clientId === clientId && !b.archived)
    .map(b => pick(b, ['id', 'name', 'color', 'clientId', 'order']));
  const boardIds = new Set(boards.map(b => b.id));
  const groupIds = new Set(tasks.map(t => t.groupId).filter(Boolean));
  const groups = arr(blob.groups)
    .filter(g => groupIds.has(g.id) || boardIds.has(g.boardId || g.workboardId))
    .map(g => pick(g, ['id', 'boardId', 'workboardId', 'clientId', 'name', 'color', 'order', 'collapsed']));

  return {
    _portalSlice: true,
    _savedAt: blob._savedAt || null,
    clients: [pick(client, ['id', 'name', 'shortCode', 'color', 'logo', 'portalEnabled'])],
    boards,
    workboards: boards.map(b => ({ ...b })),
    groups,
    tasks: tasks.map(t => sliceTask(blob, t)),
    // Staff replies carry the staff member's display name (they already did); their internal
    // user id does not leave the server.
    clientComments: arr(blob.clientComments).filter(c => taskIds.has(c.taskId)).map(c => {
      const o = pick(c, ['id', 'taskId', 'authorName', 'authorRole', 'body', 'createdAt', 'timestamp']);
      if (c.authorRole === 'client') o.authorId = c.authorId;
      return o;
    }),
    // internalOnly === true is internal. Legacy rows (undefined) stay visible — decision D1 of
    // PLAN-client-board-and-actions.md, unchanged here.
    taskFiles: arr(blob.taskFiles).filter(f => taskIds.has(f.taskId) && f.internalOnly !== true)
      .map(f => pick(f, ['id', 'taskId', 'name', 'type', 'size', 'url', 'internalOnly', 'uploadedByClientId', 'actionRequestId', 'addedAt', 'uploadedAt'])),
    actionRequests: arr(blob.actionRequests).filter(r => taskIds.has(r.taskId)).map(sliceActionRequest),
    clientWorkRequests: arr(blob.clientWorkRequests).filter(r => r.clientId === clientId).map(clone),
    notifications: arr(blob.notifications).filter(n => userId && n.recipientId === userId).map(clone),
    labelConfig: blob.labelConfig ? clone(blob.labelConfig) : { statuses: {}, priorities: {} },
    users: [], staff: [],
  };
}

// ── Share links (?share=<token>) — anonymous, read-only ──────────────────────────────────
// Exactly what renderSharePage() draws, and nothing else. A task link keeps showing that
// task's description and owner's name, as it always has — that is what staff choose to share
// when they create the link. A board link shows task names, statuses and due dates by group.
function sliceForShare(blob, token) {
  if (!/^[0-9a-z]{16,64}$/.test(String(token || ''))) return null;
  const link = arr(blob.shareLinks).find(l => l.token === token && !l.revoked);
  if (!link) return null;
  const base = { _portalSlice: true, _shareSlice: true,
    shareLinks: [pick(link, ['id', 'token', 'type', 'targetId', 'label'])],
    boards: [], workboards: [], groups: [], tasks: [], users: [], staff: [], clients: [],
    labelConfig: blob.labelConfig ? clone(blob.labelConfig) : { statuses: {}, priorities: {} } };
  if (link.type === 'workboard') {
    const wb = arr(blob.boards).find(b => b.id === link.targetId);
    if (!wb) return base;                      // renders "Board not found", as before
    const tasks = arr(blob.tasks).filter(t => (t.workboardId || t.boardId) === wb.id && !t.archived && !taskHidden(blob, t));
    const gids = new Set(tasks.map(t => t.groupId));
    base.boards = [pick(wb, ['id', 'name', 'color'])];
    base.workboards = base.boards.map(b => ({ ...b }));
    base.groups = arr(blob.groups).filter(g => gids.has(g.id)).map(g => pick(g, ['id', 'name', 'color', 'boardId', 'workboardId']));
    base.tasks = tasks.map(t => pick(t, ['id', 'name', 'title', 'status', 'endDate', 'groupId', 'boardId', 'workboardId', 'percentComplete']));
  } else if (link.type === 'task') {
    const t = arr(blob.tasks).find(x => x.id === link.targetId);
    if (!t) return base;
    base.tasks = [pick(t, ['id', 'name', 'title', 'status', 'endDate', 'description', 'percentComplete', 'ownerId'])];
    const owner = arr(blob.users).find(u => u.id === t.ownerId);
    if (owner) base.users = [{ id: owner.id, name: owner.name }];
    base.staff = base.users;
  }
  return base;
}

// ── Mutation helpers ─────────────────────────────────────────────────────────────────────
function applyStatusProgress(task, newStatus, prevStatus, now) {
  const wasDone = DONE_STATUSES.includes(prevStatus);
  const isDone = DONE_STATUSES.includes(newStatus);
  const ownedByHours = task.percentMode === 'hour_budget' && !!task.hourBudget;
  if (isDone) {
    if (!ownedByHours) task.percentComplete = 100;
    if (!wasDone) task.completedAt = now;
  } else {
    task.completedAt = null;
    if (ownedByHours) return;
    if (wasDone && task.percentComplete === 100) task.percentComplete = 0;
  }
}

function activeStaff(blob) {
  return arr(blob.users).filter(u => u && u.role !== 'client' && u.active !== false);
}

function normalizeLinkUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (e) { return null; }
}

function makeRecorder(blob, ctx) {
  const emails = [];
  const staffIds = new Set(activeStaff(blob).map(u => u.id));
  function notify(recipientId, taskId, type, message) {
    if (!recipientId) return;
    if (!blob.notifications) blob.notifications = [];
    blob.notifications.push({ id: 'n' + ctx.rid(), recipientId, taskId: taskId || null, type, message, read: false, createdAt: ctx.now });
    if (EMAIL_TYPES.has(type)) {
      const rec = arr(blob.users).find(u => u.id === recipientId);
      if (rec && rec.email) emails.push({ to: rec.email, recipientName: rec.name, type, message, senderName: ctx.userName || 'Client' });
    }
  }
  // The task's owner and holder when they're real staff, otherwise every active staff member —
  // a client message nobody is told about is worse than one extra notification.
  function notifyTaskPeople(task, type, message) {
    const ids = [...new Set([task.ownerId, task.currentlyWithUserId].filter(id => id && staffIds.has(id)))];
    if (ids.length) ids.forEach(id => notify(id, task.id, type, message));
    else notifyAllStaff(type, message, task.id);
  }
  function notifyAllStaff(type, message, taskId) {
    activeStaff(blob).forEach(u => notify(u.id, taskId, type, message));
  }
  function audit(entityId, action, before, after) {
    if (!blob.auditLog) blob.auditLog = [];
    blob.auditLog.push({ id: 'ae' + ctx.rid(), entityType: 'Task', entityId, actorId: ctx.userId || null, action,
      beforeValueJson: before ? JSON.stringify(before) : null, afterValueJson: after ? JSON.stringify(after) : null, createdAt: ctx.now });
  }
  function clientComment(taskId, body) {
    if (!blob.clientComments) blob.clientComments = [];
    blob.clientComments.push({ id: 'cc' + ctx.rid(), taskId, authorId: ctx.userId, authorName: ctx.userName || 'Client',
      authorRole: 'client', body, createdAt: ctx.now, timestamp: ctx.now });
  }
  function closeOpenRequest(taskId, reason) {
    const r = openRequestFor(blob, taskId);
    if (!r) return null;
    r.status = 'done'; r.respondedAt = ctx.now; r.respondedByUserId = ctx.userId || null; r.responseNote = reason || null; r.updatedAt = ctx.now;
    return r.id;
  }
  function returnToOwner(task, userId) {
    task.currentlyWithType = 'staff';
    task.currentlyWith = userId || '';
    task.currentlyWithUserId = userId || null;
    task.awaitingClient = false;
  }
  return { emails, notify, notifyTaskPeople, notifyAllStaff, audit, clientComment, closeOpenRequest, returnToOwner };
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────
// applyPortalAction(blob, ctx, action) mutates `blob` in place and returns
//   { ok:true, spec, emails }   spec = exactly what the action was allowed to touch, checked
//                               afterwards by checkConfined() before anything is written
//   { error, status }            nothing should be written
// ctx = { clientId, userId, userName, now, rid }
function applyPortalAction(blob, ctx, action) {
  const a = action || {};
  const client = portalClient(blob, ctx.clientId);
  if (!client) return { error: 'Portal access is not enabled for this client.', status: 403 };
  const clientName = client.name || 'Client';
  const rec = makeRecorder(blob, ctx);
  const fail = (error, status = 400) => ({ error, status });
  const visibleTask = id => { const t = findTask(blob, id); return taskVisibleTo(blob, ctx.clientId, t) ? t : null; };
  const ok = spec => ({ ok: true, spec, emails: rec.emails });

  switch (a.type) {
    case 'postComment': {
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      const body = String(a.body || '').trim();
      if (!body) return fail('Message is empty.');
      if (body.length > 10000) return fail('Message is too long.');
      rec.clientComment(task.id, body);
      rec.notifyTaskPeople(task, 'client_comment', `${ctx.userName || 'Client'} sent a message on: ${taskName(task)}`);
      return ok({ append: ['clientComments', 'notifications'] });
    }

    case 'markActionDone': {
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      const req = arr(blob.actionRequests).find(r => r.id === a.requestId);
      if (!req || req.taskId !== task.id || (req.clientId && req.clientId !== ctx.clientId)) return fail('Request not found.', 404);
      if (req.status !== 'open') return fail('This request has already been closed.', 409);
      if (task.currentlyWithType !== 'client') return fail('Etcher has already picked this task back up — no action is needed from you right now.', 409);
      const note = String(a.note || '').trim().slice(0, 2000);
      req.status = 'done'; req.respondedAt = ctx.now; req.respondedByUserId = ctx.userId || null; req.responseNote = note || null; req.updatedAt = ctx.now;
      // Deliberately leaves task.status alone — see PLAN-client-board-and-actions.md §5.
      const returnTo = req.returnToUserId || task.ownerId || null;
      rec.returnToOwner(task, returnTo);
      task.updatedAt = ctx.now;
      rec.clientComment(task.id, `**Marked done:** ${req.title}${note ? `\n\n${note}` : ''}`);
      const msg = `Client marked "${req.title}" done on: ${taskName(task)}`;
      if (returnTo) rec.notify(returnTo, task.id, 'currently_with', msg);
      else rec.notifyAllStaff('client_action_completed', msg, task.id);
      rec.audit(task.id, 'client_action_completed', {}, { requestId: req.id, note });
      return ok({ modify: { tasks: [task.id], actionRequests: [req.id] }, append: ['clientComments', 'notifications', 'auditLog'] });
    }

    case 'addLink': {
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task)) return fail('You can add documents while a task is waiting on you.', 409);
      const url = normalizeLinkUrl(a.url);
      if (!url) return fail('That link is not a valid web address (http or https).');
      const host = url.replace(/^https?:\/\//i, '').split('/')[0];
      const open = openRequestFor(blob, task.id);
      if (!blob.taskFiles) blob.taskFiles = [];
      const f = { id: ctx.rid(), taskId: task.id, name: host, size: 0, type: 'link', url, addedAt: ctx.now,
        internalOnly: false, uploadedByClientId: ctx.clientId };
      if (open) f.actionRequestId = open.id;
      blob.taskFiles.push(f);
      rec.notifyTaskPeople(task, 'client_comment', `${clientName} uploaded "${host}" on: ${taskName(task)}`);
      return ok({ append: ['taskFiles', 'notifications'] });
    }

    case 'uploadFile': {
      // Metadata only. The bytes stay in the uploading browser's local file store, exactly as
      // before this change (moving them to Supabase Storage is a separate item — plan §4).
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task)) return fail('You can add documents while a task is waiting on you.', 409);
      const files = arr(a.files);
      if (!files.length || files.length > 10) return fail('Choose between 1 and 10 files.');
      for (const x of files) {
        if (!/^cf-[A-Za-z0-9-]{1,48}$/.test(String(x.id || ''))) return fail('Invalid file id.');
        const name = String(x.name || '');
        if (!name || name.length > 255) return fail('Invalid file name.');
        if (BLOCKED_MIME.has(x.type) || BLOCKED_EXT.test(name)) return fail(`"${name}" cannot be uploaded (file type not allowed).`);
        if (!(x.size > 0) || x.size > MAX_FILE_BYTES) return fail(`"${name}" exceeds the 1 MB limit.`);
        if (arr(blob.taskFiles).some(f => f.id === x.id)) return fail('Duplicate file id.', 409);
      }
      const open = openRequestFor(blob, task.id);
      if (!blob.taskFiles) blob.taskFiles = [];
      files.forEach(x => {
        const f = { id: x.id, taskId: task.id, name: String(x.name), type: String(x.type || ''), size: x.size,
          uploadedAt: ctx.now, uploadedByClientId: ctx.clientId, internalOnly: false };
        if (open) f.actionRequestId = open.id;
        blob.taskFiles.push(f);
      });
      const label = files.length === 1 ? `"${files[0].name}"` : `${files.length} files`;
      rec.notifyTaskPeople(task, 'client_comment', `${clientName} uploaded ${label} on: ${taskName(task)}`);
      return ok({ append: ['taskFiles', 'notifications'] });
    }

    case 'approve': {
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task) || !isApprovalAsk(blob, task)) return fail('This task is not waiting on your approval.', 409);
      if (task.clientApproval && task.clientApproval.status === 'approved') return fail('Already approved.', 409);
      task.clientApproval = { status: 'approved', note: null, at: ctx.now, approvedBy: ctx.userName || 'Client' };
      const was = task.status;
      task.status = task.approvalType === 'final' ? 'completed-approved' : 'approved-client';
      applyStatusProgress(task, task.status, was, ctx.now);
      rec.returnToOwner(task, task.ownerId || null);
      task.updatedAt = ctx.now;
      const closed = rec.closeOpenRequest(task.id, '(closed — client approved)');
      rec.notifyAllStaff('client_approved', `Client approved: "${taskName(task)}" — ${clientName}`, task.id);
      return ok({ modify: { tasks: [task.id], actionRequests: closed ? [closed] : [] }, append: ['notifications'] });
    }

    case 'requestChanges': {
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task)) return fail('This task is not waiting on you.', 409);
      if (!isApprovalAsk(blob, task)) return fail('This request is answered with Mark done, not by requesting changes.', 409);
      const note = String(a.note || '').trim();
      if (!note) return fail('Please describe the changes needed.');
      if (note.length > 2000) return fail('That note is too long.');
      task.clientApproval = { status: 'changes-requested', note, at: ctx.now };
      const was = task.status;
      task.status = 'change-requested';
      applyStatusProgress(task, 'change-requested', was, ctx.now);
      rec.returnToOwner(task, task.ownerId || null);
      task.updatedAt = ctx.now;
      rec.clientComment(task.id, '**Changes requested:**\n' + note);
      const closed = rec.closeOpenRequest(task.id, '(closed — client requested changes)');
      const msg = `Changes requested on "${taskName(task)}" by ${clientName}: ${note.slice(0, 80)}`;
      if (task.ownerId && activeStaff(blob).some(u => u.id === task.ownerId)) rec.notify(task.ownerId, task.id, 'client_changes_requested', msg);
      else rec.notifyAllStaff('client_changes_requested', msg, task.id);
      return ok({ modify: { tasks: [task.id], actionRequests: closed ? [closed] : [] }, append: ['clientComments', 'notifications'] });
    }

    case 'submitWorkRequest': {
      const title = String(a.title || '').trim();
      if (!title) return fail('Please enter a request title.');
      if (title.length > 300) return fail('That title is too long.');
      const description = String(a.description || '').trim().slice(0, 5000);
      const priority = a.priority === 'urgent' ? 'urgent' : 'normal';
      const atts = arr(a.attachments);
      if (atts.length > 10) return fail('Attach at most 10 files.');
      const attachments = [];
      let total = 0;
      for (const x of atts) {
        const name = String(x.name || '');
        if (!name || name.length > 255) return fail('Invalid file name.');
        if (BLOCKED_MIME.has(x.type) || BLOCKED_EXT.test(name)) return fail(`"${name}" cannot be attached (file type not allowed).`);
        const data = String(x.data || '');
        if (!/^data:[^,]*,/.test(data)) return fail(`"${name}" could not be read.`);
        if (data.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 200) return fail(`"${name}" exceeds the 1 MB limit.`);
        total += data.length;
        if (total > Math.ceil(MAX_REQUEST_ATTACH_BYTES * 4 / 3)) return fail('Attachments can total at most 3 MB.');
        attachments.push({ name, type: String(x.type || ''), size: Number(x.size) || 0, data });
      }
      if (!blob.clientWorkRequests) blob.clientWorkRequests = [];
      blob.clientWorkRequests.push({ id: 'wr-' + ctx.rid() + ctx.rid(), clientId: ctx.clientId, title, description, priority,
        submittedAt: ctx.now, status: 'pending', adminNote: null, attachments });
      rec.notifyAllStaff('work_request', `New work request from ${clientName}: "${title}"`, null);
      return ok({ append: ['clientWorkRequests', 'notifications'] });
    }

    case 'markNotificationsRead': {
      const ids = arr(blob.notifications).filter(n => n.recipientId === ctx.userId && !n.read).map(n => n.id);
      arr(blob.notifications).forEach(n => { if (ids.includes(n.id)) n.read = true; });
      return ok({ modify: { notifications: ids } });
    }

    default:
      return fail('Unknown action.');
  }
}

// ── Write guard ──────────────────────────────────────────────────────────────────────────
// Before anything is written back, prove the change is confined to what the action declared:
// every other top-level key byte-identical, "append" collections only gained items at the
// end, "modify" collections only changed the named ids. Belt and braces around a whole-blob
// write — a bug in an action above can't take down data the action had no business touching.
function checkConfined(before, after, spec) {
  const problems = [];
  const append = new Set((spec && spec.append) || []);
  const modify = (spec && spec.modify) || {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.delete('_savedAt');
  for (const k of keys) {
    const b = before[k], a = after[k];
    if (append.has(k)) {
      const bl = arr(b), al = arr(a);
      if (al.length < bl.length) { problems.push(`${k}: items removed`); continue; }
      for (let i = 0; i < bl.length; i++) {
        if (JSON.stringify(bl[i]) !== JSON.stringify(al[i])) {
          if (modify[k] && modify[k].includes(bl[i] && bl[i].id)) continue;
          problems.push(`${k}: existing item ${bl[i] && bl[i].id} changed`); break;
        }
      }
      continue;
    }
    if (modify[k]) {
      const bl = arr(b), al = arr(a), allowed = new Set(modify[k]);
      if (al.length !== bl.length) { problems.push(`${k}: length changed`); continue; }
      for (let i = 0; i < bl.length; i++) {
        if ((bl[i] && bl[i].id) !== (al[i] && al[i].id)) { problems.push(`${k}: order/ids changed`); break; }
        if (!allowed.has(bl[i].id) && JSON.stringify(bl[i]) !== JSON.stringify(al[i])) { problems.push(`${k}: unexpected change to ${bl[i].id}`); break; }
      }
      continue;
    }
    if (JSON.stringify(b) !== JSON.stringify(a)) problems.push(`${k}: changed but not allowed`);
  }
  return problems;
}

module.exports = {
  sliceForClient, sliceForShare, applyPortalAction, checkConfined,
  // exported for tests
  taskClientId, taskHidden, taskVisibleTo, normalizeLinkUrl, awaitingClient, isApprovalAsk,
};
