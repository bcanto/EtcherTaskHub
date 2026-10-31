// Pure logic for the MCP connector's list_timesheets tool (read only). Same convention as _mcpBoards.js: no HTTP,
// plain functions over the DB blob. Leading underscore = shared module, not a Vercel route.
//
// Who sees what mirrors index.html: an admin, or staff with Billing switched on (_canBill), sees everyone's hours;
// anyone else sees only their own. Rates, pay codes and notes are left out: hours, task, board, billable and status
// are what the tool is for.
const { resolveTaskBoardId } = require('./_mcpBoards');

const arr = x => (Array.isArray(x) ? x : []);
function boardsOf(data) { return data.boards || data.workboards || []; }
function usersOf(data) { return data.users || data.staff || []; }
function fail(code, message) { return Object.assign(new Error(message), { code }); }
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function canSeeAllHours(user) { return !!user && (user.role === 'admin' || (user.role === 'staff' && user.billing === true)); }

function validDate(raw, what) {
  const s = String(raw == null ? '' : raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw fail('invalid_params', `${what} is required, written YYYY-MM-DD (got "${raw == null ? '' : raw}").`);
  }
  return s;
}
// Staff (current or not, never a client login) by email, full name, or a unique part of a name.
function resolvePerson(data, raw) {
  const q = String(raw).trim().toLowerCase();
  const people = usersOf(data).filter(u => u && u.role !== 'client');
  const names = people.filter(u => u.active !== false).map(u => u.name).join(', ');
  const exact = people.find(u => String(u.email || '').toLowerCase() === q) || people.find(u => String(u.name || '').toLowerCase() === q);
  if (exact) return exact;
  const part = people.filter(u => String(u.name || '').toLowerCase().includes(q));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw fail('ambiguous', `More than one person matches "${raw}": ${part.map(u => u.name).join(', ')}. Use the full name or email.`);
  throw fail('not_found', `No staff member matches "${raw}". Staff: ${names}.`);
}

// A person's period: a rejected or draft entry still needs them; submitted waits on approval; all approved is finished.
function periodStatus(entries) {
  if (!entries.length) return 'none';
  const st = new Set(entries.map(e => e.status || 'draft'));
  if (st.has('rejected')) return 'rejected';
  if (st.has('draft')) return 'draft';
  if (st.has('submitted')) return 'submitted';
  return 'approved';
}

const MAX_ENTRIES = 2000;
function listTimesheets(data, user, input) {
  input = input || {};
  const from = validDate(input.dateFrom, 'dateFrom'), to = validDate(input.dateTo, 'dateTo');
  if (from > to) throw fail('invalid_params', `dateFrom (${from}) is after dateTo (${to}).`);
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 400) throw fail('invalid_params', 'The period can be at most 400 days. Ask for a shorter range.');
  const all = canSeeAllHours(user);
  let person = input.person != null && String(input.person).trim() !== '' ? resolvePerson(data, input.person) : null;
  if (!all) {
    if (person && person.id !== user.id) throw fail('forbidden', 'You can only see your own hours. Admins and staff with Billing access can see everyone\'s.');
    person = user;
  }
  const users = usersOf(data), former = arr(data.formerStaff);
  const nameOf = id => { const u = users.find(x => x.id === id) || former.find(x => x.id === id); return u ? u.name + (u.active === false || former.includes(u) ? ' (left)' : '') : 'Unknown'; };
  const emailOf = id => { const u = users.find(x => x.id === id); return (u && u.email) || null; };
  const gone = new Set(arr(data.deletedTimeEntryIds));
  const tasks = new Map(arr(data.tasks).map(t => [t.id, t]));
  const boards = new Map(boardsOf(data).map(b => [b.id, b]));

  const rows = arr(data.timeEntries).filter(e => {
    if (!e || gone.has(e.id) || e.deleted) return false;
    const d = String(e.date || '').slice(0, 10);
    return d >= from && d <= to && (!person || e.staffId === person.id);
  });
  const entries = rows.map(e => {
    const t = e.taskId ? tasks.get(e.taskId) : null;
    let bId = t ? resolveTaskBoardId(data, t) : null;
    if (!bId && t && t.parentTaskId) bId = resolveTaskBoardId(data, tasks.get(t.parentTaskId));
    const b = bId ? boards.get(bId) : null;
    return { id: e.id, person: nameOf(e.staffId), personEmail: emailOf(e.staffId), date: String(e.date || '').slice(0, 10), hours: r2(e.hours),
      task: t ? (t.name || t.title || '') : null, taskId: e.taskId || null, board: b ? b.name : null,
      billable: e.billable !== false, status: e.status || 'draft' };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person));

  // Everyone in the period: each person with hours, plus (for a full view) every current staff member with none,
  // so a missing timesheet shows as "none" rather than not at all.
  const ids = new Set(rows.map(e => e.staffId));
  if (person) ids.add(person.id);
  else users.filter(u => u && u.role !== 'client' && u.active !== false).forEach(u => ids.add(u.id));
  const people = [...ids].map(id => {
    const mine = rows.filter(e => e.staffId === id);
    const p = { person: nameOf(id), email: emailOf(id), entries: mine.length, hours: 0, billableHours: 0, nonBillableHours: 0,
      draftHours: 0, submittedHours: 0, approvedHours: 0, rejectedHours: 0 };
    mine.forEach(e => {
      const h = Number(e.hours) || 0, st = e.status || 'draft';
      p.hours += h; if (e.billable !== false) p.billableHours += h; else p.nonBillableHours += h;
      if (p[st + 'Hours'] !== undefined) p[st + 'Hours'] += h;
    });
    ['hours', 'billableHours', 'nonBillableHours', 'draftHours', 'submittedHours', 'approvedHours', 'rejectedHours'].forEach(k => { p[k] = r2(p[k]); });
    p.timesheetStatus = periodStatus(mine);
    return p;
  }).sort((a, b) => a.person.localeCompare(b.person));

  const totals = { entries: entries.length, hours: r2(entries.reduce((s, e) => s + e.hours, 0)), billableHours: r2(entries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)) };
  const out = { ok: true, dateFrom: from, dateTo: to, scope: all ? (person ? 'one person' : 'everyone') : 'your own hours', totals, people,
    entries: entries.slice(0, MAX_ENTRIES) };
  if (entries.length > MAX_ENTRIES) out.truncated = `Only the first ${MAX_ENTRIES} of ${entries.length} entries are listed; the totals count them all. Ask for a shorter period or one person.`;
  return out;
}

module.exports = { listTimesheets, canSeeAllHours };
