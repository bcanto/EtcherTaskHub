// H8 (audit 2026-10-17): the audit trail missed key actions and could be edited. Nothing was recorded for deleting a task,
// creating, editing or deleting a client, adding, removing or changing the role of a staff member, editing a time entry, or
// approving or rejecting hours; the log kept 1,000 events; and it lived in the shared record, which any staff login can
// rewrite. Now those actions are recorded; every event is also sent to public.audit_log (nobody can edit or delete there);
// the server writes the account events itself; and the Audit screen shows both. Part 1 runs the real handlers against a fake
// Supabase; part 2 drives the app in a browser on its own server. Neither touches :3001 or a real project.
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

// ── A fake Supabase with the audit table ──
function backend() {
  const st = { tokens: { 'tok-a1': A1 }, auth: { [A1]: { email: 'a1@etcher.test' }, [S1]: { email: 's1@etcher.test' }, [S2]: { email: 's2@etcher.test' } },
    profiles: { [A1]: { role: 'admin', active: true }, [S1]: { role: 'staff', active: true }, [S2]: { role: 'staff', active: true } }, calls: [], audit: [], auditStatus: 201, auditHang: false };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (body == null ? '' : JSON.stringify(body)) });
  st.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(method + ' ' + u.pathname);
    if (u.origin !== 'https://fake-supabase.test') return res(599, {});
    if (u.pathname === '/auth/v1/user') { const id = st.tokens[(opts.headers.Authorization || '').replace('Bearer ', '')]; return id ? res(200, { id }) : res(401, {}); }
    if (u.pathname === '/rest/v1/audit_log' && method === 'POST') {
      if (st.auditHang) return new Promise(() => {});
      if (st.auditStatus >= 300) return res(st.auditStatus, { message: 'no' });
      st.audit.push({ ...body, __headers: opts.headers }); return res(201, null);
    }
    let m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m && method === 'PUT') { const id = decodeURIComponent(m[1]); if (!st.auth[id]) return res(404, {}); if ('password' in body) st.auth[id].password = body.password; if ('ban_duration' in body) st.auth[id].banned = body.ban_duration !== 'none'; return res(200, { id }); }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') { if (Object.values(st.auth).some(x => x.email === body.email)) return res(422, { error_code: 'user_already_exists' }); const id = 'ffffffff-ffff-4fff-8fff-' + String(Object.keys(st.auth).length).padStart(12, '0'); st.auth[id] = { email: body.email }; return res(200, { id }); }
    if (u.pathname === '/rest/v1/profiles' && method === 'GET') { const id = u.searchParams.get('id'), email = u.searchParams.get('email'); const rows = Object.entries(st.profiles).map(([pid, p]) => ({ id: pid, email: (st.auth[pid] || {}).email, ...p })).filter(r => (!id || 'eq.' + r.id === id) && (!email || 'eq.' + r.email === email)); return res(200, rows.slice(0, 1)); }
    if (u.pathname === '/rest/v1/profiles' && method === 'PATCH') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); if (!st.profiles[id]) return res(200, null); Object.assign(st.profiles[id], body); return res(204, null); }
    if (u.pathname === '/rest/v1/rpc/upsert_profile' && method === 'POST') { st.profiles[body.p_id] = { ...(st.profiles[body.p_id] || { active: true }), role: body.p_role }; return res(200, null); }
    return res(404, {});
  };
  return st;
}
const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

async function apiTests() {
  const saved = { fetch: global.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, { SUPABASE_URL: 'https://fake-supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', SUPABASE_ANON_KEY: 'anon-key' });
  console.log = () => {}; console.error = () => {};
  const base = path.resolve(__dirname, '../api');
  for (const f of ['_authAdmin.js', '_accountAccess.js', '_audit.js', 'set-password.js', 'invite-user.js']) delete require.cache[path.join(base, f)];
  const setPassword = require(path.join(base, 'set-password.js')), inviteUser = require(path.join(base, 'invite-user.js'));
  const call = async (h, st, body) => { global.fetch = st.fetch; const r = mockRes(); await h({ method: 'POST', headers: { authorization: 'Bearer tok-a1' }, body }, r); return r; };
  try {
    { const st = backend(); const r = await call(setPassword, st, { userId: S1, password: 'a-good-password' });
      const ev = st.audit[0];
      ok(r.code === 200 && st.audit.length === 1 && ev.action === 'password_changed' && ev.entity_type === 'User' && ev.entity_id === S1 && ev.actor_id === A1, 'a password change by an admin is written to the server audit trail, with who did it and to whom (' + JSON.stringify(ev && { a: ev.action, t: ev.entity_id, by: ev.actor_id }) + ')');
      ok(!JSON.stringify(st.audit).includes('a-good-password'), 'and the password itself is never in the trail');
      ok(/^ae[0-9a-f]{16}$/.test(ev.id) && !('created_at' in ev), 'the row has its own id and no time of its own (the database stamps it)');
      ok(ev.__headers.Authorization === 'Bearer svc-key', 'it is written with the server\'s own key, not the caller\'s'); }
    { const st = backend(); await call(setPassword, st, { userId: S1, access: 'disable' }); await call(setPassword, st, { userId: S1, access: 'enable' });
      ok(st.audit.map(e => e.action).join() === 'access_disabled,access_enabled' && st.audit.every(e => e.entity_id === S1 && e.actor_id === A1), 'switching a login off and on again are each recorded'); }
    { const st = backend(); await call(setPassword, st, { userId: S1, role: 'admin' }); await call(setPassword, st, { userId: S1, role: 'admin' });
      ok(st.audit.length === 1 && st.audit[0].action === 'role_changed' && st.audit[0].before_value.role === 'staff' && st.audit[0].after_value.role === 'admin', 'a role change is recorded with the old and new role; repeating it records nothing more'); }
    { const st = backend(); await call(inviteUser, st, { name: 'New Person', email: 'new@etcher.test', role: 'restricted', password: 'a-good-password' });
      const ev = st.audit[0];
      ok(st.audit.length === 1 && ev.action === 'login_created' && ev.after_value.email === 'new@etcher.test' && ev.after_value.role === 'staff' && ev.after_value.existed === false && ev.actor_id === A1, 'creating a login is recorded with the role the database really holds (' + JSON.stringify(ev && ev.after_value) + ')');
      ok(!JSON.stringify(st.audit).includes('a-good-password'), 'and no password'); }
    // Refused or failed actions leave nothing in the trail.
    { const st = backend(); await call(setPassword, st, { userId: A1, role: 'staff' }); await call(setPassword, st, { userId: A1, access: 'disable' }); await call(setPassword, st, { userId: S1, password: 'short' }); await call(setPassword, st, { userId: S1, role: 'owner' });
      ok(st.audit.length === 0, 'actions that were refused (yourself, a short password, an unknown role) are not recorded as if they happened'); }
    // The trail never changes the answer.
    { const st = backend(); st.auditStatus = 500; const r = await call(setPassword, st, { userId: S1, password: 'a-good-password' });
      ok(r.code === 200 && r.body.ok === true && st.auth[S1].password === 'a-good-password', 'if the trail cannot be written the action still succeeds'); }
    { const st = backend(); st.auditHang = true; const t0 = Date.now(); const r = await call(setPassword, st, { userId: S1, access: 'disable' });
      ok(r.code === 200 && Date.now() - t0 < 4500, 'and a trail that does not answer delays the answer by seconds at most (' + (Date.now() - t0) + ' ms)'); }
  } catch (e) { fail.push('API part crashed: ' + (e && e.stack || e)); }
  finally {
    global.fetch = saved.fetch; console.log = saved.log; console.error = saved.error;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) { if (k in saved.env) process.env[k] = saved.env[k]; else delete process.env[k]; }
  }
}

async function browserTests() {
  const srv = await H.serve(3214);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3214/');
    const brief = o => JSON.stringify(o === undefined ? null : o).slice(0, 160);   // a missing event must be a failed check, not a crash
    await p.evaluate(() => {
      const T = '2026-10-10T09:00:00.000Z', B = DB.workboards[0].id;
      DB.groups.push({ id: 'gA8', name: 'G', workboardId: B, boardId: B, clientId: 'cA8', order: 90, createdAt: T, updatedAt: T });
      DB.clients.push({ id: 'cA8', name: 'Audit Client', shortCode: 'AC', color: '#1d6fb8', createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tA8', name: 'Audit task', groupId: 'gA8', boardId: B, workboardId: B, clientId: 'cA8', status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tA8k', name: 'Audit kid', parentTaskId: 'tA8', groupId: 'gA8', status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      DB.users.push({ id: 'uA8', name: 'Aud Staff', email: 'aud@etcher.test', role: 'staff', color: '#7aa3a4', initials: 'AS', active: true, createdAt: T, updatedAt: T, supabase_uid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' }); DB.staff = DB.users;
      DB.timeEntries.push({ id: 'teA8', staffId: 'uA8', taskId: 'tA8', clientId: 'cA8', date: '2026-10-09', hours: 2, note: 'did it', status: 'submitted', billable: true, createdAt: T, updatedAt: T });
      DB.timeEntries.push({ id: 'teA8b', staffId: 'uA8', taskId: null, clientId: 'cA8', date: '2026-10-09', hours: 1.5, note: 'more', status: 'submitted', billable: true, createdAt: T, updatedAt: T });
      DB.timeEntries.push({ id: 'teA8c', staffId: 'uA8', taskId: null, clientId: 'cA8', date: '2026-10-08', hours: 1, note: 'again', status: 'draft', billable: true, createdAt: T, updatedAt: T });
      DB.auditLog = [];
      window.__last = (n) => DB.auditLog.slice(-(n || 1)).map(e => ({ type: e.entityType, id: e.entityId, action: e.action, before: e.beforeValueJson && JSON.parse(e.beforeValueJson), after: e.afterValueJson && JSON.parse(e.afterValueJson) }));
      window.__actions = () => DB.auditLog.map(e => e.entityType + ':' + e.action).join(',');
    });
    const actions = () => p.evaluate(() => window.__actions());
    const clear = () => p.evaluate(() => { DB.auditLog = []; });
    const confirmYes = () => p.evaluate(() => { document.getElementById('confirm-ok-btn').click(); });

    // ── Deleting tasks (four ways) ──
    await p.evaluate(() => { confirmDelete('task', 'tA8'); }); await confirmYes();
    let ev = await p.evaluate(() => window.__last(3));
    ok(ev.length === 1 && ev[0].type === 'Task' && ev[0].id === 'tA8' && ev[0].action === 'deleted' && ev[0].before.name === 'Audit task' && ev[0].before.subItems === 1, 'deleting a task is recorded: who (the actor), which task, its name and its sub-items (' + brief(ev[0]) + ')');
    ok(await p.evaluate(() => (DB.auditLog[0] || {}).actorId === currentUser.id), 'with the signed-in person as the actor');
    await clear();
    const mkTask = id => p.evaluate(id => { const T = new Date().toISOString(); DB.tasks.push({ id, name: 'Task ' + id, groupId: 'gA8', boardId: DB.workboards[0].id, workboardId: DB.workboards[0].id, clientId: 'cA8', status: 'todo', priority: 'med', createdAt: T, updatedAt: T, archived: id.startsWith('arc') }); }, id);
    await mkTask('panel1'); await p.evaluate(() => { _tpCurrentTask = DB.tasks.find(t => t.id === 'panel1'); tpDeleteTask(); }); await confirmYes();
    await mkTask('forever1'); await p.evaluate(() => { permanentDeleteTask('forever1'); }); await confirmYes();
    ok(await actions() === 'Task:deleted,Task:deleted', 'the task panel Delete and Delete Forever are recorded too (' + await actions() + ')');
    await clear();
    for (let i = 1; i <= 12; i++) await mkTask('arc' + i);
    await p.evaluate(() => { permanentDeleteAllArchivedTasks(); }); await confirmYes();
    ev = await p.evaluate(() => window.__last(3));
    ok(ev.length === 1 && ev[0].action === 'deleted' && ev[0].id === 'bulk' && ev[0].before.count === 12 && ev[0].before.names.length === 10, 'deleting twelve archived tasks at once is one event with the count and the first names (' + brief(ev[0]) + ')');
    await clear();

    // ── Clients ──
    await p.evaluate(() => { openClientModal(null); document.getElementById('cm-name').value = 'Brand New Client'; document.getElementById('cm-code').value = 'bnc'; return saveClient(''); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].type === 'Client' && ev[0].action === 'created' && ev[0].after.name === 'Brand New Client', 'creating a client is recorded (' + brief(ev[0]) + ')');
    await clear();
    await p.evaluate(() => { openClientModal('cA8'); document.getElementById('cm-name').value = 'Audit Client Renamed'; document.getElementById('cm-color').value = '#aa0000'; return saveClient('cA8'); });
    ev = await p.evaluate(() => window.__last(5));
    ok(ev.map(e => e.action).sort().join() === 'updated:color,updated:name' && ev.find(e => e.action === 'updated:name').before.displayValue === 'Audit Client' && ev.find(e => e.action === 'updated:name').after.displayValue === 'Audit Client Renamed', 'editing a client records each field that changed, with the old and new value (' + ev.map(e => e.action).join() + ')');
    await clear();
    await p.evaluate(() => { openClientModal('cA8'); return saveClient('cA8'); });
    ok((await actions()) === '', 'saving a client without changing anything records nothing');
    await mkTask('clientTask1');   // a task under the client's group: if tasks were recorded one by one, it would show
    await p.evaluate(() => { confirmDelete('client', 'cA8'); }); await confirmYes();
    ev = await p.evaluate(() => window.__last(5));
    ok(ev.some(e => e.type === 'Client' && e.id === 'cA8' && e.action === 'deleted' && e.before.name === 'Audit Client Renamed' && e.before.groups >= 1), 'deleting a client is recorded with its name and what went with it (' + JSON.stringify(ev.map(e => e.type + ':' + e.action)) + ')');
    ok(!ev.some(e => e.type === 'Task'), 'and its tasks are not each recorded separately');
    await clear();

    // ── Staff (the account requests are answered by a stand-in) ──
    await p.evaluate(() => {
      window.__reqs = []; const real = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('/api/invite-user') || String(u).includes('/api/set-password')) { window.__reqs.push({ u: String(u), body: JSON.parse(o.body) }); return Promise.resolve(new Response(JSON.stringify({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9', ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })); } return real(u, o); };
      window._supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
    });
    await p.evaluate(async () => { openStaffModal(null); document.getElementById('sm-name').value = 'Newly Added'; document.getElementById('sm-email').value = 'newly@etcher.test'; document.getElementById('sm-pw').value = 'a-good-password'; document.getElementById('sm-pw2').value = 'a-good-password'; document.getElementById('sm-role').value = 'restricted'; await saveStaff(''); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].type === 'User' && ev[0].action === 'created' && ev[0].after.email === 'newly@etcher.test' && ev[0].after.role === 'restricted' && !JSON.stringify(ev).includes('a-good-password'), 'adding a staff member is recorded with their name, email and role, never the password (' + brief(ev[0]) + ')');
    await clear();
    await p.evaluate(async () => { openStaffModal('uA8'); document.getElementById('sm-role').value = 'restricted'; document.getElementById('sm-name').value = 'Aud Renamed'; await saveStaff('uA8'); });
    ev = await p.evaluate(() => window.__last(4));
    ok(ev.map(e => e.action).sort().join() === 'updated:name,updated:role' && ev.find(e => e.action === 'updated:role').before.displayValue === 'staff' && ev.find(e => e.action === 'updated:role').after.displayValue === 'restricted', 'changing a staff member\'s name and role is recorded field by field (' + ev.map(e => e.action).join() + ')');
    await clear();
    await p.evaluate(async () => { openStaffModal('uA8'); document.getElementById('sm-pw').value = 'another-good-password'; await saveStaff('uA8'); });
    ev = await p.evaluate(() => window.__last(3));
    ok(ev.map(e => e.action).join() === 'password_changed' && !JSON.stringify(ev).includes('another-good-password'), 'a password change by the admin is recorded without the password');
    await clear();
    await p.evaluate(() => { deleteStaff('uA8'); }); await confirmYes(); await p.evaluate(() => new Promise(r => setTimeout(r, 300)));
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].type === 'User' && ev[0].id === 'uA8' && ev[0].action === 'deleted' && ev[0].before.name === 'Aud Renamed', 'removing a staff member is recorded (' + brief(ev[0]) + ')');
    await clear();
    // A client created together with a portal login.
    await p.evaluate(async () => { openClientModal(null); document.getElementById('cm-name').value = 'Portal Client'; document.getElementById('cm-email').value = 'portal@client.test'; document.getElementById('cm-pw').value = 'a-good-password'; document.getElementById('cm-pw2').value = 'a-good-password'; await saveClient(''); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].type === 'Client' && ev[0].action === 'created' && /portal login portal@client\.test/.test(ev[0].after.title) && !JSON.stringify(ev).includes('a-good-password'), 'creating a client with a portal login is recorded, never the password (' + brief(ev[0]) + ')');
    await p.evaluate(() => { delete window._supabase; });
    await clear();

    // The person and client removed above are needed again for the hours and the Audit screen.
    await p.evaluate(() => { const T = '2026-10-10T09:00:00.000Z'; DB.users.push({ id: 'uA8', name: 'Aud Staff', email: 'aud@etcher.test', role: 'staff', color: '#7aa3a4', initials: 'AS', active: true, createdAt: T, updatedAt: T, supabase_uid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' }); DB.staff = DB.users; DB.clients.push({ id: 'cA8', name: 'Audit Client', shortCode: 'AC', color: '#1d6fb8', createdAt: T, updatedAt: T }); DB.timeEntries.find(e => e.id === 'teA8').taskId = null; /* its task was deleted above */ });
    // ── Hours ──
    await p.evaluate(() => { openEditTimeEntry('teA8'); document.getElementById('ete-hours').value = '3'; document.getElementById('ete-note').value = 'did it properly'; saveEditTimeEntry('teA8'); });
    ev = await p.evaluate(() => window.__last(4));
    ok(ev.map(e => e.type + ':' + e.action).sort().join() === 'TimeEntry:updated:hours,TimeEntry:updated:note' && ev.find(e => e.action === 'updated:hours').before.displayValue === '2' && ev.find(e => e.action === 'updated:hours').after.displayValue === '3', 'editing a time entry records each field that changed, old and new (' + ev.map(e => e.action).join() + ')');
    await clear();
    await p.evaluate(() => { tsApproveEntry('teA8'); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].type === 'TimeEntry' && ev[0].id === 'teA8' && ev[0].action === 'approved' && ev[0].before.displayValue === 'submitted' && ev[0].after.hours === 3, 'approving an entry is recorded, from the status it had (' + brief(ev[0]) + ')');
    await clear();
    await p.evaluate(() => { openTsRejectModal('teA8b'); document.getElementById('ts-reject-reason').value = 'no ticket number'; tsRejectEntry('teA8b'); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].action === 'rejected' && ev[0].id === 'teA8b' && /no ticket number/.test(ev[0].after.displayValue), 'rejecting an entry is recorded with the reason');
    await clear();
    await p.evaluate(() => { DB.timeEntries.forEach(e => { if (e.id === 'teA8b' || e.id === 'teA8c') { e.status = 'submitted'; delete e.rejectionReason; } }); tsSelectedIds = new Set(['teA8b', 'teA8c']); tsBulkApprove(); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].action === 'bulk_approved' && ev[0].after.count === 2 && ev[0].after.ids.join() === 'teA8b,teA8c' && /2 entries, 2\.5h/.test(ev[0].after.title), 'a bulk approval is one event naming the entries, their number and hours (' + brief(ev[0]) + ')');
    await clear();
    await p.evaluate(() => { DB.timeEntries.forEach(e => { if (e.id === 'teA8b' || e.id === 'teA8c') { e.status = 'submitted'; delete e.approvedAt; } }); tsSelectedIds = new Set(['teA8b', 'teA8c']); openTsBulkRejectModal(); document.getElementById('ts-bulk-reject-reason').value = 'wrong week'; tsBulkReject(); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].action === 'bulk_rejected' && ev[0].after.count === 2 && /wrong week/.test(ev[0].after.displayValue), 'a bulk rejection likewise, with the reason');
    await clear();
    await p.evaluate(() => { tsSelectedIds = new Set(); tsBulkApprove(); });
    ok((await actions()) === '', 'a bulk run that changed nothing records nothing');
    // A whole fortnight for one person, approved and rejected.
    await p.evaluate(() => { DB.timeEntries.forEach(e => { if (e.id === 'teA8b' || e.id === 'teA8c') { e.status = 'submitted'; delete e.approvedAt; delete e.rejectedAt; } }); tsBulkApproveForStaff('uA8', tsGetFortnightEnding('2026-10-09')); closeAlert(); closeGenericModal(); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].action === 'bulk_approved' && ev[0].after.count >= 1 && ev[0].after.ids.includes('teA8b'), 'approving a person\'s whole fortnight is recorded (' + brief(ev[0]) + ')');
    await clear();
    await p.evaluate(() => { DB.timeEntries.forEach(e => { if (e.id === 'teA8b' || e.id === 'teA8c') { e.status = 'submitted'; delete e.approvedAt; delete e.rejectedAt; } }); openTsBulkRejectForStaff('uA8', tsGetFortnightEnding('2026-10-09')); document.getElementById('ts-staff-reject-reason').value = 'duplicate week'; tsBulkRejectForStaff('uA8', tsGetFortnightEnding('2026-10-09')); });
    ev = await p.evaluate(() => window.__last(2));
    ok(ev.length === 1 && ev[0].action === 'bulk_rejected' && /duplicate week/.test(ev[0].after.displayValue), 'and rejecting it, with the reason');
    await clear();

    // ── The permanent copy ──
    await p.evaluate(() => {
      window.__rows = []; window.__insertMode = 'ok';
      window._supabase = { from: (t) => ({
        insert: async (rows) => { window.__rows.push({ t, rows }); if (window.__insertMode === 'denied') return { error: { code: '42501', message: 'new row violates row-level security policy' } }; if (window.__insertMode === 'net') return { error: { code: '', message: 'network down' } }; if (window.__insertMode === 'dup') return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }; return { error: null }; },
        // After a few requests it stops answering, so a screen that kept asking would not loop for ever and hide the failed check.
        select: () => ({ order: () => ({ limit: async () => { window.__selects = (window.__selects || 0) + 1; if (window.__selects > 4) return new Promise(() => {}); return { data: window.__serverRows || [], error: null }; } }) }),
      }) };
      currentUser.authUid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
      _auditServerOff = false; _auditQueue.length = 0;
    });
    const flushAll = () => p.evaluate(() => new Promise(r => setTimeout(r, 1900)));
    await p.evaluate(() => { writeAuditEvent('Task', 'tX', 'deleted', { name: 'x' }, null); writeAuditEvent('Client', 'cX', 'created', null, { name: 'y' }); });
    ok((await p.evaluate(() => window.__rows.length)) === 0, 'events are sent in a batch after a moment, not one request each');
    await flushAll();
    const sent = await p.evaluate(() => window.__rows);
    ok(sent.length === 1 && sent[0].t === 'audit_log' && sent[0].rows.length === 2, 'the two events went to the audit table in one request (' + sent.length + ' request, ' + (sent[0] && sent[0].rows.length) + ' rows)');
    const row = sent[0].rows[0];
    ok(row.actor_id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' && row.entity_type === 'Task' && row.entity_id === 'tX' && row.action === 'deleted' && row.before_value.name === 'x' && row.after_value === null && !('created_at' in row) && /^ae/.test(row.id), 'each row names the signed-in login as the actor, has the event\'s own id, and carries no time of its own (' + JSON.stringify(row) + ')');
    ok(await p.evaluate(() => DB.auditLog.length) >= 2, 'and the local log still has them');
    // Not allowed yet (migration 017 not applied): stop quietly, keep the local log.
    await p.evaluate(() => { window.__rows.length = 0; window.__insertMode = 'denied'; writeAuditEvent('Task', 'tY', 'deleted', { name: 'y' }, null); });
    await flushAll();
    const denied = await p.evaluate(() => ({ tries: window.__rows.length, off: _auditServerOff, queue: _auditQueue.length, local: DB.auditLog.some(e => e.entityId === 'tY') }));
    ok(denied.tries === 1 && denied.off === true && denied.queue === 0 && denied.local, 'if the database does not allow it yet, the app stops trying for this session, shows nothing, and keeps the local log (' + JSON.stringify(denied) + ')');
    await p.evaluate(() => { window.__rows.length = 0; writeAuditEvent('Task', 'tZ', 'deleted', { name: 'z' }, null); });
    await flushAll();
    ok(await p.evaluate(() => window.__rows.length) === 0, 'and does not try again');
    // A network failure is tried again, a few times.
    await p.evaluate(() => { _auditServerOff = false; window.__rows.length = 0; window.__insertMode = 'net'; writeAuditEvent('Task', 'tN', 'deleted', { name: 'n' }, null); });
    await p.evaluate(() => new Promise(r => setTimeout(r, 1700 + 3100 * 3 + 500)));
    const net = await p.evaluate(() => ({ tries: window.__rows.length, queue: _auditQueue.length, off: _auditServerOff }));
    ok(net.tries === 4 && net.queue === 0 && net.off === false, 'a network failure is retried, four tries in all, and the server trail stays on (' + JSON.stringify(net) + ')');
    // Rows that are already there (an earlier try got through before the answer was lost) are not an error and are not sent again.
    await p.evaluate(() => { _auditServerOff = false; window.__rows.length = 0; window.__insertMode = 'dup'; writeAuditEvent('Task', 'tD', 'deleted', { name: 'd' }, null); });
    await p.evaluate(() => new Promise(r => setTimeout(r, 1700 + 3100 + 500)));
    const dup = await p.evaluate(() => ({ tries: window.__rows.length, queue: _auditQueue.length, off: _auditServerOff }));
    ok(dup.tries === 1 && dup.queue === 0 && dup.off === false, 'rows the server already has are accepted as done: one try, nothing left to send, the trail stays on (' + JSON.stringify(dup) + ')');
    // Offline (no sign-in service) and a client: nothing is sent.
    await p.evaluate(() => { _auditServerOff = false; window.__insertMode = 'ok'; window.__rows.length = 0; const keep = window._supabase; delete window._supabase; writeAuditEvent('Task', 'tO', 'deleted', {}, null); window._supabase = keep; });
    await flushAll();
    ok(await p.evaluate(() => window.__rows.length) === 0, 'with no sign-in service (offline) nothing is sent');

    // ── The Audit screen ──
    await p.evaluate(() => {
      _auditServerRows = []; _auditServerAt = 0; _auditServerOff = false;
      const T = new Date().toISOString();
      // The shapes the real code writes: a task delete carries its board, client and sub-items; twelve at once carry the first names.
      DB.auditLog = [{ id: 'aeLocalOnly', entityType: 'Task', entityId: 't1', actorId: currentUser.id, action: 'deleted', beforeValueJson: JSON.stringify({ name: 'Local only task', boardId: 'b1', clientId: null, subItems: 2 }), afterValueJson: null, createdAt: T },
                     { id: 'aeBulk', entityType: 'Task', entityId: 'bulk', actorId: currentUser.id, action: 'deleted', beforeValueJson: JSON.stringify({ count: 12, subItems: 3, names: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'] }), afterValueJson: null, createdAt: T },
                     { id: 'aeBoth', entityType: 'Client', entityId: 'cB', actorId: currentUser.id, action: 'deleted', beforeValueJson: JSON.stringify({ name: 'Edited locally' }), afterValueJson: null, createdAt: T },
                     { id: 'aeHours', entityType: 'TimeEntry', entityId: 'teQ', actorId: currentUser.id, action: 'approved', beforeValueJson: JSON.stringify({ displayValue: 'submitted' }), afterValueJson: JSON.stringify({ displayValue: 'approved', hours: 3 }), createdAt: T }];
      window.__serverRows = [{ id: 'aeBoth', entity_type: 'Client', entity_id: 'cB', actor_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', action: 'deleted', before_value: { name: 'The real client name', tasks: 5, groups: 2 }, after_value: null, created_at: T },
                             { id: 'aeSrvNew', entity_type: 'User', entity_id: 'uZ', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', action: 'login_created', before_value: null, after_value: { email: 'new@x.test', role: 'staff', existed: false }, created_at: T },
                             { id: 'aeServer', entity_type: 'User', entity_id: 'uZ', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', action: 'password_changed', before_value: null, after_value: null, created_at: T },
                             { id: 'aeSrvRole', entity_type: 'User', entity_id: 'uZ', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', action: 'role_changed', before_value: { role: 'staff' }, after_value: { role: 'admin' }, created_at: T },
                             { id: 'aeSrvOff', entity_type: 'User', entity_id: 'uZ', actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', action: 'access_disabled', before_value: null, after_value: null, created_at: T }];
      window.__selects = 0;
    });
    await p.evaluate(() => navigate('audit'));
    await p.evaluate(() => new Promise(r => setTimeout(r, 600)));
    const screen = await p.evaluate(() => ({ text: document.getElementById('view-container').innerText.replace(/\s+/g, ' '), dots: document.querySelectorAll('#view-container td > span[title^="Recorded on the server"]').length, rows: document.querySelectorAll('#view-container tbody tr').length }));
    ok(/Local only task/.test(screen.text) && /The real client name/.test(screen.text) && !/Edited locally/.test(screen.text), 'the Audit screen shows the local log and the server trail together; where both hold an event the server\'s copy is shown (' + screen.rows + ' rows)');
    ok(screen.rows === 8 && screen.dots === 5, 'five of the eight rows are marked as recorded on the server (' + screen.dots + ' of ' + screen.rows + ')');
    // The Change column in words, never the raw record: what was deleted, and what went with it.
    const changeOf = re => p.evaluate(src => { const row = [...document.querySelectorAll('#view-container tbody tr')].find(r => new RegExp(src).test(r.innerText)); return row ? row.children[4].innerText.replace(/\s+/g, ' ').trim() : null; }, re.source);
    const delTask = await changeOf(/Local only task/), delBulk = await changeOf(/Alpha/), delClient = await changeOf(/The real client name/);
    ok(delTask === 'Local only task (with 2 sub-items)', 'a deleted task reads as its name and its sub-items, not as the stored record (' + delTask + ')');
    ok(delBulk === '12 tasks: Alpha, Bravo, Charlie and more, with 3 sub-items', 'twelve tasks deleted at once read as the count and the first names (' + delBulk + ')');
    ok(delClient === 'The real client name (with 5 tasks)', 'a deleted client reads as its name and the tasks that went with it (' + delClient + ')');
    const roleCell = await changeOf(/Role Changed/), newCell = await changeOf(/Login Created/);
    ok(/^staff\s+admin$/.test(roleCell || ''), 'a role change reads as the old and the new role (' + roleCell + ')');
    ok(newCell === 'new@x.test, staff', 'a login that was created reads as the email and role alone, with no empty "before" (' + newCell + ')');
    ok(await changeOf(/Password Changed/) === '' && await changeOf(/Login Switched Off/) === '', 'events with no values (a password change, a login switched off) leave the Change column empty');
    const rawCells = await p.evaluate(() => [...document.querySelectorAll('#view-container tbody tr')].map(r => r.children[4].innerText).filter(t => /[{}"]/.test(t)));
    ok(rawCells.length === 0, 'no row on the Audit screen shows the raw record (' + rawCells.slice(0, 2).join(' | ').slice(0, 120) + ')');
    const words = await p.evaluate(() => ({ none: _auditText({}), one: _auditText({ order: 3 }), view: _auditText({ displayValue: 'x', name: 'y' }), board: _auditText({ name: 'Old board', taskCount: 1 }) }));
    ok(words.none === null && words.one === '3' && words.view === 'x' && words.board === 'Old board (with 1 task)', 'the wording helper copes with an empty record, a single value, its own displayValue first, and a singular count (' + JSON.stringify(words) + ')');
    const hoursRow = await p.evaluate(() => { const row = [...document.querySelectorAll('#view-container tbody tr')].find(r => /TimeEntry/.test(r.innerText) && /Approved/.test(r.innerText)); return row ? row.innerText.replace(/\s+/g, ' ') : ''; });
    ok(/submitted/.test(hoursRow) && /approved/.test(hoursRow), 'an approval reads as the change it was, from submitted to approved (' + hoursRow.slice(0, 110) + ')');
    ok(/Password Changed/.test(screen.text) && /Role Changed/.test(screen.text) && /Login Switched Off/.test(screen.text) && /staff\s*→?\s*admin|staff.*admin/.test(screen.text), 'account events read in plain words (Login Switched Off, Role Changed), with the old and new role');
    const actor = await p.evaluate(() => { const row = [...document.querySelectorAll('#view-container tbody tr')].find(r => /The real client name/.test(r.innerText)); return row ? row.innerText.replace(/\s+/g, ' ') : ''; });
    ok(/\bAud\b/.test(actor),'a server row\'s actor is matched to a person in the app by their login id (' + actor.slice(0, 100) + ')');
    // The screen asks the server at most every 30 seconds.
    const asked = await p.evaluate(async () => { window.__selects = 0; _auditServerBusy = false; let n = 0; const real = window._supabase.from; window._supabase.from = (t) => { n++; return real(t); }; renderView('audit'); renderView('audit'); await new Promise(r => setTimeout(r, 200)); window._supabase.from = real; return n; });
    ok(asked === 0, 'drawing the Audit screen again within 30 seconds does not ask the server again');
    // Signing in remembers the login's own id, which is what the server trail names as the actor.
    const authUid = await p.evaluate(async () => {
      window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
      const profile = { id: 'ffffffff-ffff-4fff-8fff-000000000099', role: 'staff', name: 'Sign In Person', email: 'signin99@etcher.test', active: true };
      const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
      window._supabase = { auth: { signOut: async () => {} }, from: tbl };
      DB.users.push({ id: 'uSI', name: 'Sign In Person', email: profile.email, role: 'staff', active: true }); DB.staff = DB.users;
      await _supabaseRestoreSession({ user: { id: profile.id } });
      return { got: currentUser.authUid, want: profile.id };
    });
    ok(authUid.got === authUid.want, 'signing in remembers the login\'s own id for the server trail (' + authUid.got + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
}

(async () => {
  await apiTests();
  await browserTests();
  H.report('high-h8-audit-test', pass, fail);
})();
