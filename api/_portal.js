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
// Types a browser could render or run. Checked after normaliseMime (lower-case, no parameters),
// so "TEXT/HTML", "text/html;charset=utf-8" or a non-string type no longer slip past.
const BLOCKED_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml',
  'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript', 'text/x-component',
  'application/hta', 'message/rfc822', 'multipart/related', 'application/x-shockwave-flash']);
const BLOCKED_EXT = /\.(svgz?|html?|xhtml?|xht|shtml|mht|mhtml|xml|xsl|xslt|hta|js|mjs|jse|vbs|vbe|wsf|scr|lnk|php)$/i;
function normaliseMime(t) { return String(t == null ? '' : t).toLowerCase().split(';')[0].trim(); }
// Trailing dots/spaces are dropped by Windows when saving, so "a.html. " is an .html file.
function blockedFile(name, type) {
  return BLOCKED_MIME.has(normaliseMime(type)) || BLOCKED_EXT.test(String(name).replace(/[.\s]+$/, ''));
}
// A work-request attachment is stored and later used as a link href, so accept only exactly what
// FileReader.readAsDataURL produces: data:<type>/<subtype>[;params];base64,<base64>. No quotes,
// brackets or spaces can get through, and the embedded type is checked like the declared one.
const DATA_URL_RE = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)((?:;[a-z0-9_.+-]+=[a-z0-9_.+-]+)*);base64,([A-Za-z0-9+/]*={0,2})$/i;
// Abuse limits. Counted from timestamps the data already carries (see recentActivity), so no
// extra state is stored and nothing needs resetting.
const RATE_PER_MINUTE = 20;
const RATE_PER_DAY = 500;
const MAX_OPEN_WORK_REQUESTS = 10;
const MAX_OPEN_REQUEST_ATTACH_CHARS = Math.ceil(6 * 1048576 * 4 / 3);   // ~6 MB of files, base64
const MAX_BLOB_CHARS_FOR_FILES = 10 * 1048576;  // company record size past which new files are refused
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
// Mirrors index.html's own _isPersonalBoard(wb) exactly: personalBoard alone means nothing once
// visibility has been switched back to all_internal (saveBoardVisibility never clears the flag,
// so a board converted back to an ordinary team board can carry a stale personalBoard:true) —
// checking the flag alone here disagreed with index.html and kept such a board hidden from its
// client's portal even after the owner had deliberately made it a normal, shared board again.
function taskOnPersonalBoard(blob, t) {
  const bId = taskBoardId(blob, t);
  const b = bId && arr(blob.boards).find(x => x.id === bId);
  return !!(b && b.visibility === 'private' && b.personalBoard);
}
// A task on a board in Archive & Bin (31 Oct 2026): open work there is no longer the client's current work, so the
// slice leaves it out; finished work, its files and its history stay (index.html getClientTasks).
function taskOnArchivedBoard(blob, t) {
  const bId = taskBoardId(blob, t);
  const b = bId && arr(blob.boards).find(x => x.id === bId);
  return !!(b && b.archived);
}
function taskVisibleTo(blob, clientId, t) {
  return !!t && !t.archived && !taskHidden(blob, t) && taskClientId(blob, t) === clientId && !taskOnPersonalBoard(blob, t);
}

// ── Retained Services (.agents/PLAN-retained-services.md) ─────────────────────────────────────
// The meter mirrors index.html's _retainerUsed: per service group and calendar month, finished
// subitems of a top-level task, or the task itself when it has none, on client-visible work only.
// Months are Perth calendar months, the same as the staff app on Etcher's machines.
const RS_DONE = new Set(['done', 'completed', 'completed-approved', 'approved-client']);
const RS_TZ = 'Australia/Perth';
function rsYm(d) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: RS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)).slice(0, 7); }
  catch (e) { return String(d).slice(0, 7); }
}
function rsPrevYm(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
// IMS counts document revisions (2026-10-22); boards saved before stored "document reviews". HSEQ's "reports and
// register updates" are plain Items (TH-15, 31 Oct 2026; index.html _rsUnitFix).
function rsUnit(u) { return /^document reviews?$/i.test(String(u || '')) ? 'document revisions' : /^reports and register updates$/i.test(String(u || '')) ? 'items' : u; }
// Who a part counts (index.html _rsWho): an Audit part (Items counted in audits) takes tasks tagged Audit.
function rsWho(x) { return x && x.kind === 'items' && x.unit === 'audits' ? 'audit' : (x && x.who) || 'all'; }
function isRetainedBoard(b) { return !!(b && b.retainer && !b.retainer.endedAt && !b.archived); }
// "Your team": only people still at Etcher.
function activeStaffName(blob, id) { const u = id && arr(blob.users).find(x => x.id === id && x.role !== 'client' && x.active !== false); return u ? u.name : null; }
function staffName(blob, id) { const u = id && arr(blob.users).find(x => x.id === id && x.role !== 'client'); return u ? u.name : null; }
// Same rule as index.html _rsDoneYm: a finished task saved without a date counts by its last update.
function rsDoneYm(x) { const at = x.completedAt || (x.clientApproval && x.clientApproval.at) || x.clientApprovedAt || (RS_DONE.has(x.status) ? x.updatedAt : null); return at ? rsYm(at) : null; }
function retainerUsed(blob, boardId, groupId, ym) {
  const tasks = arr(blob.tasks), doneYm = rsDoneYm;
  let n = 0;
  tasks.filter(t => !t.archived && !t.parentTaskId && t.groupId === groupId && taskBoardId(blob, t) === boardId && !taskHidden(blob, t)).forEach(t => {
    const subs = tasks.filter(x => x.parentTaskId === t.id && !x.archived && !taskHidden(blob, x));
    if (subs.length) n += subs.filter(x => RS_DONE.has(x.status) && doneYm(x) === ym).length;
    else if (RS_DONE.has(t.status) && doneYm(t) === ym) n++;
  });
  return n;
}
// Allowances by items or hours (2026-10-22), the same rules as index.html's _rsUsage: in progress means started and
// not finished; hours are logged on the service's work the client can see (never rejected entries), one part each by
// who logs (senior consultants, everyone else admin) or tasks tagged Audit; parts are monthly or quarterly.
const RS_IDLE = new Set(['todo', 'not-started', 'backlog', '']);
const RS_HOUR_PARTS = {
  hseq: [{ label: 'HSEQ elements', hours: 5, period: 'month', who: 'all' }, { label: 'Audits (mini and main)', hours: 8, period: 'quarter', who: 'audit' }],
  ci: [{ label: 'Admin', hours: 8, period: 'month', who: 'admin' }, { label: 'Senior consult', hours: 3, period: 'month', who: 'senior' }],
};
function rsAt(hist, ym) { return arr(hist).filter(h => h && h.until >= ym).sort((a, b) => String(a.until).localeCompare(String(b.until)))[0] || null; }
function rsSvcAt(s, ym) {
  const h = rsAt(s.hist, ym); if (!h) return s;
  const o = Object.assign({}, s, { allowance: h.allowance, unit: h.unit || s.unit, parts: h.parts || null });
  if (h.mode === 'hours' || h.mode === 'mixed') o.mode = h.mode; else delete o.mode;
  return o;
}
function rsSeniorsAt(r, ym) { const h = rsAt(r && r.seniorHist, ym); return new Set(arr(h ? h.ids : r && r.seniorIds)); }
// Which part an hour counts to (index.html _rsPartFor): Audit-tagged work, senior consultants, everyone else as admin,
// then Everyone, then Admin. Hours that fit no part are not counted (an untagged task on an Audit-only service).
// kind ('hours' or 'items', TH-11) breaks a tie between two parts with the same filter.
function rsPartFor(parts, aud, senior, kind) {
  const who = rsWho, pick = fn => { const c = parts.filter(fn); return c.find(x => !kind || rsKind(x) === kind) || c[0] || null; };
  return pick(x => who(x) === 'audit' && aud) || pick(x => who(x) === 'senior' && senior) || pick(x => who(x) === 'admin' && !senior)
    || pick(x => who(x) === 'all') || pick(x => who(x) === 'admin') || null;
}
// Quarters and years run from the retainer's start month (index.html _rsPeriodStart); a month counts its period up
// to its own end.
function rsPeriodStart(ym, period, start) {
  const k = +String(ym).slice(0, 4) * 12 + (+String(ym).slice(5, 7)) - 1;
  if (period !== 'quarter' && period !== 'year') return k;
  const n = period === 'year' ? 12 : 3;
  if (/^\d{4}-\d{2}$/.test(String(start || ''))) { const sk = +start.slice(0, 4) * 12 + (+start.slice(5, 7)) - 1; return sk + Math.floor((k - sk) / n) * n; }
  return n === 12 ? k - k % 12 : k - (k % 12) % 3;
}
function rsInPeriod(d, ym, period, start) { d = String(d || '').slice(0, 7); if (!d) return false; return period === 'quarter' || period === 'year' ? rsPeriodStart(d, period, start) === rsPeriodStart(ym, period, start) && d <= ym : d === ym; }
function rsPeriodOf(p) { return p && (p.period === 'quarter' || p.period === 'year') ? p.period : 'month'; }
function rsKind(p) { return p && p.kind === 'items' ? 'items' : 'hours'; }
// A quarterly or yearly part not used up in the last month of its period, while that month is running: due by its last day.
function rsDue(u, ym, start, now) {
  if (u.period === 'month' || ym !== now || !(u.used < u.cap)) return null;
  const k = rsPeriodStart(ym, u.period, start) + (u.period === 'year' ? 11 : 2), end = Math.floor(k / 12) + '-' + String(k % 12 + 1).padStart(2, '0');
  if (end !== ym) return null;
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
}
// A closed month's figures as they were kept (index.html _rsLocked / _rsLockMonths); totals only, nothing about who.
function rsLocked(b, s, ym) {
  const L = ((((b || {}).retainer || {}).months || {})[ym] || {}).lock, x = L && arr(L.services).find(y => y.key === s.key);
  if (!x) return null;
  return { mode: x.mode === 'hours' || x.mode === 'mixed' ? x.mode : 'items', parts: arr(x.parts).map(p => ({ label: p.label || '', cap: Number(p.cap) || 0, used: Number(p.used) || 0, prog: 0, period: rsPeriodOf(p), unit: p.unit === 'hours' ? 'hours' : rsUnit(p.unit), due: null })) };
}
function retainerProgress(blob, boardId, groupId) {
  const tasks = arr(blob.tasks), started = x => !RS_DONE.has(x.status) && !RS_IDLE.has(String(x.status || ''));
  let n = 0;
  tasks.filter(t => !t.archived && !t.parentTaskId && t.groupId === groupId && taskBoardId(blob, t) === boardId && !taskHidden(blob, t)).forEach(t => {
    const subs = tasks.filter(x => x.parentTaskId === t.id && !x.archived && !taskHidden(blob, x));
    if (subs.length) n += subs.filter(started).length; else if (started(t)) n++;
  });
  return n;
}
// Every service is parts (TH-11): an items service (no mode) is one Items part a month for Everyone; mode 'hours' is
// hour parts saved before parts had a kind; mode 'mixed' is parts that each say their kind.
function rsParts(s) {
  if (s.mode === 'hours' || s.mode === 'mixed') {
    const ps = arr(s.parts).length ? arr(s.parts) : s.mode === 'hours' ? (RS_HOUR_PARTS[s.key] || [{ label: 'Hours', hours: Math.min(99, s.allowance || 8), period: 'month', who: 'all' }]) : [];
    if (ps.length) return ps;
  }
  return [{ id: 'items', label: '', kind: 'items', amount: s.allowance, unit: s.unit, period: 'month', who: 'all' }];
}
const rsTagged = x => arr(x && x.tags).some(g => /^audit$/i.test(String(g).trim()));
// index.html _rsItemUnits: a top-level task's subitems are its items, or the task itself when it has none; a task tagged
// Audit on a service with an Audit items part is one audit however many subitems it has. Each item goes to one part.
function rsItemUnits(blob, b, s, parts, ym) {
  const tasks = arr(blob.tasks), seniors = rsSeniorsAt(b.retainer || {}, ym), out = [];
  const doneYm = rsDoneYm;
  const auditItems = parts.some(p => rsKind(p) === 'items' && rsWho(p) === 'audit');
  tasks.filter(t => !t.archived && !t.parentTaskId && t.groupId === s.groupId && taskBoardId(blob, t) === b.id && !taskHidden(blob, t)).forEach(t => {
    const subs = tasks.filter(x => x.parentTaskId === t.id && !x.archived && !taskHidden(blob, x));
    const one = x => { const done = RS_DONE.has(x.status); out.push({ part: rsPartFor(parts, rsTagged(x) || rsTagged(t), seniors.has(x.ownerId || t.ownerId), 'items'), done, doneYm: done ? doneYm(x) : null, started: !done && !RS_IDLE.has(String(x.status || '')) }); };
    if (!subs.length || (auditItems && rsTagged(t))) one(t); else subs.forEach(one);
  });
  return out;
}
function rsUsage(blob, b, s, ym, withProg) {
  const lk = rsLocked(b, s, ym); if (lk) return lk;
  s = rsSvcAt(s, ym);
  const parts = rsParts(s), start = (b.retainer || {}).startMonth, kinds = new Set(parts.map(rsKind));
  const used = parts.map(() => 0);
  if (kinds.has('hours')) {
    const tasks = arr(blob.tasks), byId = new Map(tasks.map(t => [t.id, t])), seniors = rsSeniorsAt(b.retainer || {}, ym);
    arr(blob.timeEntries).forEach(e => {
      if (!e || e.status === 'rejected' || !(Number(e.hours) > 0)) return;
      const t = byId.get(e.taskId); if (!t || t.archived || taskHidden(blob, t)) return;
      const top = t.parentTaskId ? byId.get(t.parentTaskId) : t;
      if (!top || top.archived || top.groupId !== s.groupId || taskBoardId(blob, top) !== b.id) return;
      const p = rsPartFor(parts, rsTagged(t) || rsTagged(top), seniors.has(e.staffId), 'hours');
      const i = parts.indexOf(p); if (i >= 0 && rsKind(p) === 'hours' && rsInPeriod(e.date, ym, rsPeriodOf(p), start)) used[i] += Number(e.hours) || 0;
    });
  }
  // A plain items service (its one part made up by rsParts) is counted exactly as it always was.
  const plain = parts.length === 1 && parts[0].id === 'items';
  if (plain) return { mode: 'items', parts: [{ label: '', cap: s.allowance, used: retainerUsed(blob, b.id, s.groupId, ym), prog: withProg ? retainerProgress(blob, b.id, s.groupId) : 0, period: 'month', unit: rsUnit(s.unit), due: null }] };
  const units = kinds.has('items') ? rsItemUnits(blob, b, s, parts, ym) : [];
  return { mode: kinds.size > 1 ? 'mixed' : [...kinds][0], parts: parts.map((p, i) => {
    const period = rsPeriodOf(p), u = rsKind(p) === 'hours'
      ? { label: p.label || 'Hours', cap: Number(p.hours) || 0, used: Math.round(used[i] * 100) / 100, prog: 0, period, unit: 'hours' }
      : { label: p.label || '', cap: Number(p.amount) || 0, used: units.filter(x => x.part === p && x.done && rsInPeriod(x.doneYm, ym, period, start)).length,
        prog: withProg ? units.filter(x => x.part === p && x.started).length : 0, period, unit: rsUnit(p.unit || 'items') };
    u.due = withProg ? rsDue(u, ym, start, ym) : null;   // only for the month running now (the portal's current month)
    return u;
  }) };
}
// Only what the portal shows: never fees, rates, staff ids or who logged what. Hour allowances show their totals only.
function sliceRetainer(blob, b, now) {
  if (!isRetainedBoard(b)) return undefined;
  const r = b.retainer, ym = rsYm(now), prev = rsPrevYm(ym), months = r.months || {};
  return {
    services: arr(r.services).map(s => { const us = rsUsage(blob, b, s, ym, true); return { key: s.key, groupId: s.groupId, unit: rsUnit(s.unit), allowance: s.allowance, core: !!s.core, ownerName: activeStaffName(blob, s.ownerId), used: us.parts[0].used, mode: us.mode, prog: us.mode === 'items' ? us.parts[0].prog : 0, parts: us.parts }; }),
    leadName: activeStaffName(blob, r.leadId), startMonth: r.startMonth || null, priority: r.priority || null,
    month: ym, focusTaskIds: arr((months[ym] || {}).focusTaskIds).slice(0, 3), reviewMonth: prev, reviewNote: (months[prev] || {}).note || null,
    // The last two months, read only (plan §5).
    history: [prev, rsPrevYm(prev)].map(m => ({ month: m, services: arr(r.services).map(s => { const us = rsUsage(blob, b, s, m, false); const q = us.parts.filter(u => u.period === 'quarter'), h = ps => String(Math.round(ps.reduce((n, u) => n + u.used, 0) * 100) / 100);
      return { key: s.key, used: us.mode === 'hours' ? h(us.parts.filter(u => u.period === 'month')) : us.parts[0].used, unit: us.mode === 'hours' ? 'hours' : null, qtr: us.mode === 'hours' && q.length ? h(q) : null,
        mode: us.mode, parts: us.parts.map(u => ({ label: u.label, cap: u.cap, used: u.used, period: u.period, unit: u.unit })) }; }) })),
  };
}
// A request's service must be one of the client's own groups or boards; anything else is ad hoc.
function workRequestRef(blob, clientId, ref) {
  const s = String(ref || '');
  const own = b => !!b && b.clientId === clientId && !b.archived && !(b.visibility === 'private' && b.personalBoard);
  if (s.startsWith('g:')) { const g = findGroup(blob, s.slice(2)); if (g && own(arr(blob.boards).find(x => x.id === (g.boardId || g.workboardId)))) return s; }
  if (s.startsWith('b:')) { if (own(arr(blob.boards).find(x => x.id === s.slice(2)))) return s; }
  return 'adhoc';
}
// Same definition the portal uses for "this is waiting on you".
// A task file is visible to the client when its task is, and either the client uploaded it, or
// staff haven't switched attachments off for the task (clientAttachmentsHidden) and haven't
// marked this one file Internal. Used by the slice and by /api/portal-file before signing a URL.
function fileVisibleTo(blob, clientId, f) {
  if (!f) return false;
  const t = findTask(blob, f.taskId);
  if (!taskVisibleTo(blob, clientId, t)) return false;
  if (f.uploadedByClientId === clientId) return true;
  return f.internalOnly !== true && !t.clientAttachmentsHidden;
}
// A finished task waits on nobody, even when With still says Client (staff completed it after
// sending it over). Client Approved is not finished: staff can still ask the client for something.
const CLOSED_FOR_CLIENT = new Set(['done', 'completed', 'completed-approved', 'cancelled']);
function awaitingClient(t) {
  if (CLOSED_FOR_CLIENT.has(t.status)) return false;
  return t.currentlyWithType === 'client' || t.status === 'ready-approval' || t.status === 'waiting-client';
}
function openRequestFor(blob, taskId) {
  return arr(blob.actionRequests).find(r => r.taskId === taskId && r.status === 'open') || null;
}
// Same rule as the portal's _cpIsApprovalAsk: Approve / Request changes only answer an approval
// ask. A "review X" or "send us Y" request is answered with Mark done, never by approving the task.
function isApprovalAsk(blob, t) {
  // The portal only shows an open ask while the task is with the client (sanitizeTaskForClient),
  // so a stale ask left on a task staff took back must not turn Approve into a refusal.
  const open = t.currentlyWithType === 'client' ? openRequestFor(blob, t.id) : null;
  return t.status === 'ready-approval' || !open || open.kind === 'approve';
}

// ── The slice ────────────────────────────────────────────────────────────────────────────
// Whitelists only. Anything not named here never leaves the server — hour budgets, owners,
// assignees, internal descriptions, tags, time entries, rates, invoices, client notes, the
// staff roster, other clients.
const TASK_FIELDS = ['id', 'name', 'title', 'status', 'percentComplete', 'startDate', 'endDate', 'priority',
  'approvalType', 'clientDescription', 'parentTaskId', 'groupId', 'order', 'createdAt', 'updatedAt', 'completedAt', 'clientApprovedAt'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function sliceTask(blob, t) {
  const s = pick(t, TASK_FIELDS);
  // The task description is shown to the client unless staff ticked "Hide description from
  // client" on it (clientDescriptionHidden). Rich-text HTML: the portal sanitises it on render.
  delete s.clientDescription;
  s.description = t.clientDescriptionHidden ? null : (String(t.clientDescription || t.description || '').slice(0, 20000) || null);
  s.clientId = taskClientId(blob, t);
  const bid = taskBoardId(blob, t);
  s.boardId = bid; s.workboardId = bid;
  s.archived = false;
  // Whether it's with the client, and (R6, 2026-10-15) the owner's and holder's display names. Names
  // only: the staff roster and internal ids still never leave the server.
  s.currentlyWithType = t.currentlyWithType === 'client' ? 'client' : 'staff';
  s.ownerName = staffName(blob, t.ownerId);
  s.withName = t.currentlyWithType === 'client' ? null : staffName(blob, t.currentlyWithUserId);
  s.awaitingClient = awaitingClient(t);
  if (t.clientApproval) s.clientApproval = { status: t.clientApproval.status, note: t.clientApproval.note || null, at: t.clientApproval.at || null };
  return s;
}

// A client's own work requests: what the portal shows, files by name only (their data can run to megabytes and the client
// already has them), no staff ids, and the task it became when the client can see that task.
function sliceWorkRequest(r, taskIds) {
  const o = clone(pick(r, ['id', 'clientId', 'title', 'description', 'priority', 'urgency', 'neededBy', 'serviceRef', 'submittedAt', 'status', 'adminNote', 'respondedAt', 'updatedAt']));
  o.attachments = arr(r.attachments).map(a => ({ name: String((a && a.name) || 'File'), type: (a && a.type) || '', size: Number(a && a.size) || 0 }));
  if (r.linkedItemType === 'task' && taskIds.has(r.linkedItemId)) o.taskId = r.linkedItemId;
  return o;
}
function sliceActionRequest(r) {
  return pick(r, ['id', 'taskId', 'clientId', 'kind', 'title', 'body', 'dueDate', 'status', 'createdAt', 'updatedAt', 'respondedAt', 'responseNote']);
}

// userId: the caller's auth uid — their own notifications only.
function sliceForClient(blob, clientId, userId) {
  const client = portalClient(blob, clientId);
  if (!client) return null;

  const tasks = arr(blob.tasks).filter(t => taskVisibleTo(blob, clientId, t) && (RS_DONE.has(t.status) || !taskOnArchivedBoard(blob, t)));
  const taskIds = new Set(tasks.map(t => t.id));
  const taskById = new Map(tasks.map(t => [t.id, t]));
  // personalBoard is excluded even if it somehow carries this clientId (e.g. an existing
  // client board later marked Personal) — a personal board must never appear in any client's
  // portal, full stop, matching the plan's own "PERSONAL = private to the owner" rule. Checked
  // the same way as taskOnPersonalBoard above (both flags) — not personalBoard alone, which
  // stays stale-true after a board is switched back to a normal all_internal team board.
  const boards = arr(blob.boards).filter(b => b.clientId === clientId && !b.archived && !(b.visibility === 'private' && b.personalBoard))
    .map(b => { const o = pick(b, ['id', 'name', 'color', 'clientId', 'order']); const rt = sliceRetainer(blob, b, new Date()); if (rt) o.retainer = rt; return o; });
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
    // taskIds are exactly the visible tasks, so only the per-file part of fileVisibleTo is left to check.
    // columnId-scoped files (a Main Table custom "File" column) are excluded outright, regardless
    // of internalOnly — customColumns/customColumnValues are already entirely absent from the
    // portal feed (see _PORTAL_EMPTY in index.html), so a client who has no concept of "columns"
    // must never see a file that only exists because of one, mixed unexplained into their
    // Attachments list.
    taskFiles: arr(blob.taskFiles).filter(f => taskIds.has(f.taskId) && !f.columnId && (f.uploadedByClientId === clientId || (f.internalOnly !== true && !(taskById.get(f.taskId) || {}).clientAttachmentsHidden)))
      .map(f => ({ ...pick(f, ['id', 'taskId', 'name', 'type', 'size', 'url', 'internalOnly', 'uploadedByClientId', 'actionRequestId', 'addedAt', 'uploadedAt']), stored: !!f.storagePath })),
    actionRequests: arr(blob.actionRequests).filter(r => taskIds.has(r.taskId)).map(sliceActionRequest),
    clientWorkRequests: arr(blob.clientWorkRequests).filter(r => r.clientId === clientId).map(r => sliceWorkRequest(r, taskIds)),
    notifications: arr(blob.notifications).filter(n => userId && n.recipientId === userId).map(clone),
    labelConfig: blob.labelConfig ? clone(blob.labelConfig) : { statuses: {}, priorities: {} },
    users: [], staff: [],
  };
}

// ── Share links (?share=<token>) — anonymous, read-only ──────────────────────────────────
// Exactly what renderSharePage() draws, and nothing else. A task link keeps showing that
// task's description and owner's name, as it always has — that is what staff choose to share
// when they create the link. A board link shows task names, statuses and due dates by group.
// Release-1 B6.6: a share link stops working SHARE_LINK_DAYS after it was made, or at its own expiresAt;
// revoked links are refused as before. A link from before dates were recorded (no createdAt) keeps
// working until someone revokes it.
const SHARE_LINK_DAYS = 365;
function shareLinkExpired(link, now) {
  const end = link.expiresAt ? Date.parse(link.expiresAt) : link.createdAt ? Date.parse(link.createdAt) + SHARE_LINK_DAYS * 86400000 : null;
  return end != null && Number.isFinite(end) && now.getTime() > end;
}
function sliceForShare(blob, token, now = new Date()) {
  if (!/^[0-9a-z]{16,64}$/.test(String(token || ''))) return null;
  const link = arr(blob.shareLinks).find(l => l.token === token && !l.revoked);
  if (!link || shareLinkExpired(link, now)) return null;
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
  // Client approved: a retainer counts it as finished in the month it got there (index.html _applyStatusProgress).
  if (newStatus === 'approved-client') { if (!task.completedAt && !task.clientApprovedAt) task.clientApprovedAt = now; return; }
  if (isDone) {
    if (!ownedByHours) task.percentComplete = 100;
    if (!wasDone) task.completedAt = (prevStatus === 'approved-client' && (task.completedAt || task.clientApprovedAt)) || now;
  } else {
    task.completedAt = null;
    delete task.clientApprovedAt;
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
  function notify(recipientId, taskId, type, message, link) {
    if (!recipientId) return;
    if (!blob.notifications) blob.notifications = [];
    blob.notifications.push({ id: 'n' + ctx.rid(), recipientId, taskId: taskId || null, type, message, read: false, createdAt: ctx.now, ...(ctx.userId ? { byUserId: ctx.userId } : {}), ...(link ? { link } : {}) });
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
  function notifyAllStaff(type, message, taskId, link) {
    activeStaff(blob).forEach(u => notify(u.id, taskId, type, message, link));
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

// How many things this client login (comments, responses) or client company (files, links,
// work requests) has created in the last `ms`. Items without a parseable timestamp don't count.
function recentActivity(blob, ctx, ms) {
  const since = Date.parse(ctx.now) - ms;
  const recent = v => { const t = Date.parse(v); return t >= since; };
  let n = 0;
  for (const c of arr(blob.clientComments)) if (c.authorRole === 'client' && c.authorId === ctx.userId && recent(c.createdAt)) n++;
  for (const f of arr(blob.taskFiles)) if (f.uploadedByClientId === ctx.clientId && recent(f.uploadedAt || f.addedAt)) n++;
  for (const r of arr(blob.clientWorkRequests)) if (r.clientId === ctx.clientId && recent(r.submittedAt)) n++;
  for (const r of arr(blob.actionRequests)) if (r.respondedByUserId && r.respondedByUserId === ctx.userId && recent(r.respondedAt)) n++;
  // Every action notifies Etcher, and all of one action's notifications share its timestamp —
  // so distinct timestamps = actions taken, including ones whose record has since been removed.
  const acts = new Set();
  for (const x of arr(blob.notifications)) if (x.byUserId && x.byUserId === ctx.userId && recent(x.createdAt)) acts.add(x.createdAt);
  return Math.max(n, acts.size);
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

  if (a.type !== 'markNotificationsRead') {
    if (recentActivity(blob, ctx, 60 * 1000) >= RATE_PER_MINUTE) return fail('You are doing that too quickly. Please wait a minute and try again.', 429);
    if (recentActivity(blob, ctx, 24 * 3600 * 1000) >= RATE_PER_DAY) return fail('Daily limit reached. Please contact Etcher.', 429);
  }

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
      // The file travels as a data URL and is stored in Supabase Storage by portal-action.js
      // (result.uploads) before the record is written, so staff on any device can open it.
      // One request stays well under Vercel's 4.5 MB body limit: 3 files / 3 MB at most.
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task)) return fail('You can add documents while a task is waiting on you.', 409);
      const files = arr(a.files);
      if (!files.length || files.length > 3) return fail('Choose between 1 and 3 files.');
      const uploads = [];
      let total = 0;
      const ids = new Set();
      for (const x of files) {
        if (!/^cf-[A-Za-z0-9-]{1,48}$/.test(String(x.id || ''))) return fail('Invalid file id.');
        if (ids.has(x.id)) return fail('Duplicate file id.', 409);
        ids.add(x.id);
        const name = String(x.name || '');
        if (!name || name.length > 255) return fail('Invalid file name.');
        if (blockedFile(name, x.type)) return fail(`"${name}" cannot be uploaded (file type not allowed).`);
        const dm = DATA_URL_RE.exec(typeof x.data === 'string' ? x.data : '');
        if (!dm) return fail(`"${name}" could not be read. Please try again.`);
        if (blockedFile(name, dm[1])) return fail(`"${name}" cannot be uploaded (file type not allowed).`);
        const bytes = Math.floor(dm[3].length * 3 / 4) - (dm[3].endsWith('==') ? 2 : dm[3].endsWith('=') ? 1 : 0);
        if (!(bytes > 0) || bytes > MAX_FILE_BYTES) return fail(`"${name}" exceeds the 1 MB limit.`);
        total += bytes;
        if (total > MAX_REQUEST_ATTACH_BYTES) return fail('Upload at most 3 MB at a time.');
        if (arr(blob.taskFiles).some(f => f.id === x.id)) return fail('Duplicate file id.', 409);
        uploads.push({ id: x.id, name, type: normaliseMime(dm[1]), size: bytes, base64: dm[3], path: `tasks/${task.id}/${x.id}` });
      }
      const open = openRequestFor(blob, task.id);
      if (!blob.taskFiles) blob.taskFiles = [];
      uploads.forEach(u => {
        const f = { id: u.id, taskId: task.id, name: u.name, type: u.type, size: u.size, storagePath: u.path,
          uploadedAt: ctx.now, uploadedByClientId: ctx.clientId, internalOnly: false };
        if (open) f.actionRequestId = open.id;
        blob.taskFiles.push(f);
      });
      const label = uploads.length === 1 ? `"${uploads[0].name}"` : `${uploads.length} files`;
      rec.notifyTaskPeople(task, 'client_comment', `${clientName} uploaded ${label} on: ${taskName(task)}`);
      return { ...ok({ append: ['taskFiles', 'notifications'] }), uploads: uploads.map(u => ({ path: u.path, type: u.type, base64: u.base64 })) };
    }

    case 'removeFile': {
      // A client may remove a file or link its own company added — never one from Etcher.
      const file = arr(blob.taskFiles).find(x => x.id === a.fileId);
      const task = file ? visibleTask(file.taskId) : null;
      if (!file || !task || file.uploadedByClientId !== ctx.clientId) return fail('File not found.', 404);
      blob.taskFiles = blob.taskFiles.filter(x => x.id !== file.id);
      // Tombstone: without it a staff browser still holding the file re-adds it on its next save.
      if (!blob.deletedTaskFileIds) blob.deletedTaskFileIds = [];
      if (!blob.deletedTaskFileIds.includes(file.id)) blob.deletedTaskFileIds.push(file.id);
      rec.notifyTaskPeople(task, 'client_comment', `${clientName} removed "${file.name}" from: ${taskName(task)}`);
      return { ...ok({ remove: { taskFiles: [file.id] }, append: ['notifications', 'deletedTaskFileIds'] }), removals: file.storagePath ? [file.storagePath] : [] };
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

    case 'decline': {
      // The client turns the work down (a quote, scope, proposal...). Same gate as approve: only
      // an approval ask can be declined. A reason is required so the owner knows what to do next.
      const task = visibleTask(a.taskId);
      if (!task) return fail('Task not found.', 404);
      if (!awaitingClient(task) || !isApprovalAsk(blob, task)) return fail('This task is not waiting on your approval.', 409);
      if (task.clientApproval && task.clientApproval.status === 'approved') return fail('Already approved.', 409);
      const note = String(a.note || '').trim();
      if (!note) return fail('Please tell us why you are declining.');
      if (note.length > 2000) return fail('That note is too long.');
      task.clientApproval = { status: 'declined', note, at: ctx.now, declinedBy: ctx.userName || 'Client' };
      const was = task.status;
      task.status = 'declined-client';
      applyStatusProgress(task, 'declined-client', was, ctx.now);
      rec.returnToOwner(task, task.ownerId || null);
      task.updatedAt = ctx.now;
      rec.clientComment(task.id, '**Declined:**\n' + note);
      const closed = rec.closeOpenRequest(task.id, '(closed — client declined)');
      const msg = `Declined by ${clientName}: "${taskName(task)}" — ${note.slice(0, 80)}`;
      if (task.ownerId && activeStaff(blob).some(u => u.id === task.ownerId)) rec.notify(task.ownerId, task.id, 'client_declined', msg);
      else rec.notifyAllStaff('client_declined', msg, task.id);
      return ok({ modify: { tasks: [task.id], actionRequests: closed ? [closed] : [] }, append: ['clientComments', 'notifications'] });
    }

    case 'submitWorkRequest': {
      const title = String(a.title || '').trim();
      if (!title) return fail('Please enter a request title.');
      if (title.length > 300) return fail('That title is too long.');
      const description = String(a.description || '').trim().slice(0, 5000);
      const urgency = ['normal', 'week', 'urgent'].includes(a.urgency) ? a.urgency : (a.priority === 'urgent' ? 'urgent' : 'normal');
      const priority = urgency === 'urgent' ? 'urgent' : 'normal';
      const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(String(a.neededBy || '')) ? String(a.neededBy) : null;
      const serviceRef = workRequestRef(blob, ctx.clientId, a.serviceRef);
      const atts = arr(a.attachments);
      if (atts.length > 10) return fail('Attach at most 10 files.');
      const attachments = [];
      let total = 0;
      for (const x of atts) {
        const name = String(x.name || '');
        if (!name || name.length > 255) return fail('Invalid file name.');
        if (blockedFile(name, x.type)) return fail(`"${name}" cannot be attached (file type not allowed).`);
        const data = typeof x.data === 'string' ? x.data : '';
        const dm = DATA_URL_RE.exec(data);
        if (!dm) return fail(`"${name}" could not be read.`);
        if (blockedFile(name, dm[1])) return fail(`"${name}" cannot be attached (file type not allowed).`);
        if (data.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 200) return fail(`"${name}" exceeds the 1 MB limit.`);
        total += data.length;
        if (total > Math.ceil(MAX_REQUEST_ATTACH_BYTES * 4 / 3)) return fail('Attachments can total at most 3 MB.');
        attachments.push({ name, type: normaliseMime(x.type), size: Number(x.size) || 0, data });
      }
      const openReqs = arr(blob.clientWorkRequests).filter(r => r.clientId === ctx.clientId && (!r.status || r.status === 'pending' || r.status === 'reviewing'));
      if (openReqs.length >= MAX_OPEN_WORK_REQUESTS) return fail(`You have ${openReqs.length} requests waiting for Etcher. Please wait for those to be reviewed before sending more.`, 429);
      if (attachments.length) {
        const stored = openReqs.reduce((n, r) => n + arr(r.attachments).reduce((m, x) => m + String(x.data || '').length, 0), 0);
        if (stored + total > MAX_OPEN_REQUEST_ATTACH_CHARS) return fail('Your open requests already hold the maximum amount of attachments. Please send files as SharePoint links, or wait for Etcher to review your open requests.', 429);
        if (JSON.stringify(blob).length + total > MAX_BLOB_CHARS_FOR_FILES) return fail('File storage is full right now. Please send files as SharePoint links, or contact Etcher.', 507);
      }
      if (!blob.clientWorkRequests) blob.clientWorkRequests = [];
      blob.clientWorkRequests.push({ id: 'wr-' + ctx.rid() + ctx.rid(), clientId: ctx.clientId, title, description, priority, urgency, neededBy, serviceRef,
        submittedAt: ctx.now, status: 'pending', adminNote: null, attachments });
      // R11: a retainer client's request goes to the retainer lead and the admins; others to all staff.
      const rmsg = `New work request from ${clientName}: "${title}"`;
      const rb = arr(blob.boards).find(b => b.clientId === ctx.clientId && isRetainedBoard(b));
      const staff = activeStaff(blob), to = new Set(rb ? staff.filter(u => u.role === 'admin' || u.id === rb.retainer.leadId).map(u => u.id) : []);
      const rlink = { kind: 'client', clientId: ctx.clientId };
      if (to.size) to.forEach(id => rec.notify(id, null, 'work_request', rmsg, rlink)); else rec.notifyAllStaff('work_request', rmsg, null, rlink);
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
  const remove = (spec && spec.remove) || {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.delete('_savedAt');
  for (const k of keys) {
    let b = before[k];
    const a = after[k];
    if (remove[k]) {
      const gone = new Set(remove[k]);
      if (arr(b).filter(x => x && gone.has(x.id)).length !== gone.size) { problems.push(`${k}: removed id not present`); continue; }
      if (arr(a).some(x => x && gone.has(x.id))) { problems.push(`${k}: declared removal still present`); continue; }
      b = arr(b).filter(x => !(x && gone.has(x.id)));   // then the rest must be untouched
    }
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
  sliceForClient, sliceForShare, shareLinkExpired, SHARE_LINK_DAYS, applyPortalAction, checkConfined,
  // exported for tests
  taskClientId, taskHidden, taskVisibleTo, normalizeLinkUrl, awaitingClient, isApprovalAsk, blockedFile, normaliseMime, DATA_URL_RE, recentActivity, fileVisibleTo,
  // shared with api/_mcpWrite.js (the MCP connector sets statuses the same way)
  applyStatusProgress,
};
