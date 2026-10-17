// H1 (audit 2026-10-17): the Staff screen's Role and Restricted settings never reached a real login. The sign-in
// takes the role from the server profile, which the Staff screen never changed, and the profile has no
// "Restricted" at all. Now Admin/Staff changes go to the profile through the admin endpoint, a Restricted record
// narrows the signed-in staff login (never widens, never touches an admin), and adding a Restricted person no
// longer fails at the profile step. Part 1 runs the real handlers against a fake Supabase; part 2 drives the app
// in a browser on its own server. Neither touches :3001 or a real project.
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const P1 = '11111111-1111-4111-8111-111111111111', C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', GONE = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

// ── A fake Supabase: auth users, profiles (with roles), the token check and the account endpoints ──
function backend() {
  const st = {
    tokens: { 'tok-a1': A1, 'tok-a3': A3, 'tok-s2': S2 },
    auth: { [A1]: { email: 'a1@etcher.test' }, [A2]: { email: 'a2@etcher.test' }, [A3]: { email: 'a3@etcher.test' }, [S1]: { email: 's1@etcher.test' }, [S2]: { email: 's2@etcher.test' }, [P1]: { email: 'p1@etcher.test' }, [C1]: { email: 'c1@acme.test' } },
    profiles: { [A1]: { role: 'admin', active: true }, [A2]: { role: 'admin', active: true }, [A3]: { role: 'admin', active: false }, [S1]: { role: 'staff', active: true }, [S2]: { role: 'staff', active: true }, [P1]: { role: 'pm', active: true }, [C1]: { role: 'client', active: true } },
    calls: [], patches: [], failRolePatch: false,
  };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (body == null ? '' : JSON.stringify(body)) });
  st.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(method + ' ' + u.pathname);
    if (u.origin !== 'https://fake-supabase.test') return res(599, { msg: 'unexpected host' });
    if (u.pathname === '/auth/v1/user') { const id = st.tokens[(opts.headers.Authorization || '').replace('Bearer ', '')]; return id ? res(200, { id }) : res(401, { msg: 'bad token' }); }
    let m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m && method === 'PUT') { const id = decodeURIComponent(m[1]); if (!st.auth[id]) return res(404, {}); if ('password' in body) st.auth[id].password = body.password; if ('ban_duration' in body) st.auth[id].banned = body.ban_duration !== 'none'; return res(200, { id }); }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (Object.values(st.auth).some(x => x.email === body.email)) return res(422, { error_code: 'user_already_exists', msg: 'exists' });
      const id = 'ffffffff-ffff-4fff-8fff-' + String(Object.keys(st.auth).length).padStart(12, '0'); st.auth[id] = { email: body.email, password: body.password }; return res(200, { id });
    }
    if (u.pathname === '/rest/v1/profiles' && method === 'GET') {
      const id = u.searchParams.get('id'), email = u.searchParams.get('email');
      const rows = Object.entries(st.profiles).map(([pid, p]) => ({ id: pid, email: (st.auth[pid] || {}).email, ...p })).filter(r => (!id || 'eq.' + r.id === id) && (!email || 'eq.' + r.email === email));
      return res(200, rows.slice(0, 1));
    }
    if (u.pathname === '/rest/v1/profiles' && method === 'PATCH') {
      st.patches.push(body);
      if (st.failRolePatch && 'role' in body) return res(500, { message: 'patch failed' });
      const id = (u.searchParams.get('id') || '').replace('eq.', ''); if (!st.profiles[id]) return res(200, null);
      Object.assign(st.profiles[id], body); return res(204, null);
    }
    if (u.pathname === '/rest/v1/rpc/upsert_profile' && method === 'POST') { st.profiles[body.p_id] = { ...(st.profiles[body.p_id] || { active: true }), role: body.p_role }; st.upserted = body; return res(200, null); }
    return res(404, { msg: 'unexpected ' + method + ' ' + u.pathname });
  };
  return st;
}
const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

async function apiTests() {
  const saved = { fetch: global.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, { SUPABASE_URL: 'https://fake-supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', SUPABASE_ANON_KEY: 'anon-key' });
  console.log = () => {}; console.error = () => {};
  const base = path.resolve(__dirname, '../api');
  for (const f of ['_authAdmin.js', '_accountAccess.js', 'set-password.js', 'invite-user.js']) delete require.cache[path.join(base, f)];
  const setPassword = require(path.join(base, 'set-password.js')), inviteUser = require(path.join(base, 'invite-user.js'));
  const call = async (h, st, token, body) => { global.fetch = st.fetch; const r = mockRes(); await h({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body }, r); return r; };
  const writes = st => st.calls.filter(c => /^(PUT|PATCH|POST) /.test(c) && !/\/auth\/v1\/user/.test(c));
  try {
    // The role reaches the profile.
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'admin' });
      ok(r.code === 200 && r.body.ok === true && r.body.changed === true && st.profiles[S1].role === 'admin' && st.patches.length === 1, 'an admin can make a staff login an admin: the profile role changes (' + r.code + ')');
      const r2 = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'staff' });
      ok(r2.code === 200 && st.profiles[S1].role === 'staff', 'and back to staff'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: A2, role: 'staff' });
      ok(r.code === 200 && st.profiles[A2].role === 'staff' && st.profiles[A1].role === 'admin', 'an admin can make another admin a standard staff login while they stay an admin themselves'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: P1, role: 'staff' });
      ok(r.code === 200 && st.profiles[P1].role === 'staff', 'a project-manager login can be moved to staff too'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'staff' });
      ok(r.code === 200 && r.body.changed === false && st.patches.length === 0, 'asking for the role a login already has changes nothing and writes nothing (safe to repeat)'); }
    // Only the two roles the Staff screen can give.
    for (const bad of ['restricted', 'client', 'pm', 'ADMIN', '', null, 42, ['admin'], { role: 'admin' }]) {
      const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: bad });
      if (!(r.code === 400 && st.patches.length === 0 && st.profiles[S1].role === 'staff')) { ok(false, 'a role other than admin or staff is refused before anything is written: ' + JSON.stringify(bad) + ' got ' + r.code); break; }
      if (bad && typeof bad === 'object' && !Array.isArray(bad)) ok(true, 'a role other than admin or staff (restricted, client, pm, other case, empty, null, numbers, lists, objects) is refused with 400 and nothing is written');
    }
    // Who may ask, and for whom.
    { const st = backend(); const r = await call(setPassword, st, 'tok-s2', { userId: S1, role: 'admin' });
      ok(r.code === 403 && st.profiles[S1].role === 'staff' && writes(st).length === 0, 'a staff member cannot make anyone an admin (403, nothing changed)'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a3', { userId: S1, role: 'admin' });
      ok(r.code === 403 && st.profiles[S1].role === 'staff' && writes(st).length === 0, 'an admin who is switched off cannot change roles, even with a valid session'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: A1, role: 'staff' });
      ok(r.code === 409 && /own role/.test(r.body.error) && st.profiles[A1].role === 'admin' && writes(st).length === 0, 'an admin cannot change their own role, so one admin is always left'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: C1, role: 'admin' });
      ok(r.code === 409 && /client portal/.test(r.body.error) && st.profiles[C1].role === 'client' && writes(st).length === 0, 'a client portal login can never be made staff or admin from here'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: GONE, role: 'admin' });
      ok(r.code === 404 && writes(st).length === 0, 'a person with no login yet gets a clear 404 and nothing is written'); }
    for (const bad of ['../../auth/v1/admin/users', 'not-a-uuid', '', 42, null]) {
      const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: bad, role: 'admin' });
      if (!(r.code === 400 && writes(st).length === 0)) { ok(false, 'a malformed user id is refused: ' + JSON.stringify(bad) + ' got ' + r.code); break; }
      if (bad === null) ok(true, 'a malformed user id is refused with 400 before anything is sent');
    }
    // One action per request.
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'admin', password: 'a-good-password' });
      ok(r.code === 400 && /one action/.test(r.body.error) && st.profiles[S1].role === 'staff' && !st.auth[S1].password, 'a role and a password in one request is refused: neither is applied'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'admin', access: 'disable' });
      ok(r.code === 400 && st.profiles[S1].role === 'staff' && st.profiles[S1].active === true && writes(st).length === 0, 'a role and an access change in one request is refused too'); }
    // An honest failure.
    { const st = backend(); st.failRolePatch = true; const r = await call(setPassword, st, 'tok-a1', { userId: S1, role: 'admin' });
      ok(r.code === 500 && /Nothing was changed/.test(r.body.error) && st.profiles[S1].role === 'staff', 'if the profile cannot be updated the answer says nothing was changed'); }
    // The other actions still work.
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, password: 'a-good-password' });
      ok(r.code === 200 && st.auth[S1].password === 'a-good-password', 'setting a password still works');
      const r2 = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      ok(r2.code === 200 && st.profiles[S1].active === false, 'and so does switching a login off'); }
    // Adding a person: the server only ever gets a role it knows.
    for (const [sent, want, why] of [['restricted', 'staff', 'Restricted'], ['staff', 'staff', 'Staff'], ['admin', 'admin', 'Admin'], ['pm', 'pm', 'a project manager'], ['owner', 'staff', 'an unknown role'], [{ x: 1 }, 'staff', 'a role that is not text'], [undefined, 'staff', 'no role']]) {
      const st = backend(); const r = await call(inviteUser, st, 'tok-a1', { name: 'New Person', email: 'new.' + why.replace(/\W/g, '') + '@etcher.test', role: sent, password: 'a-good-password' });
      if (!(r.code === 200 && st.upserted && st.upserted.p_role === want)) { ok(false, 'adding ' + why + ' stores the profile role ' + want + ' (got ' + r.code + ' ' + JSON.stringify(st.upserted && st.upserted.p_role) + ')'); break; }
      if (why === 'no role') ok(true, 'adding a person always stores a profile role the database knows: Restricted and unknown roles become staff, admin and pm are kept');
    }
  } catch (e) { fail.push('API part crashed: ' + (e && e.stack || e)); }
  finally {
    global.fetch = saved.fetch; console.log = saved.log; console.error = saved.error;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) { if (k in saved.env) process.env[k] = saved.env[k]; else delete process.env[k]; }
  }
}

async function browserTests() {
  const srv = await H.serve(3205);
  const b = await H.launch();
  try {
    const UID = '11111111-1111-4111-8111-111111111113', NEWID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    const setup = async (page, supabase) => {
      await page.evaluate((supabase, UID, NEWID) => {
        window._reqs = []; window._net = { fail: false };
        window._replies = { '/api/set-password': { status: 200, body: { ok: true } }, '/api/invite-user': { status: 200, body: { id: NEWID } } };
        const real = window.fetch;
        window.fetch = (u, o) => {
          const url = String(u), key = Object.keys(window._replies).find(k => url.includes(k));
          if (!key) return real(u, o);
          window._reqs.push({ url: key, body: JSON.parse(o.body), auth: (o.headers || {}).Authorization || null });
          if (window._net.fail) return Promise.reject(new TypeError('Failed to fetch'));
          const r = window._replies[key]; return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        };
        if (supabase) window._supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-admin' } } }) } };
        DB.users.find(x => x.id === 'u3').supabase_uid = UID;   // u3 has a login; u4 has none
      }, supabase, UID, NEWID);
    };
    // Open the Staff form for someone, pick a role (and maybe type a password), press Save.
    const edit = (page, id, role, pw) => page.evaluate(async (id, role, pw) => {
      closeAlert();
      openStaffModal(id);
      document.getElementById('sm-role').value = role;
      if (pw !== undefined) document.getElementById('sm-pw').value = pw;
      await saveStaff(id);
      const rec = DB.users.find(u => u.id === id), open = !document.getElementById('generic-modal').classList.contains('hidden');
      // a message raised over the open form is on its own layer (audit H7); otherwise it is in the shared dialog
      const layerOpen = !document.getElementById('alert-modal').classList.contains('hidden');
      return { role: rec.role, modal: layerOpen ? document.getElementById('alert-modal-msg').textContent : (open ? document.getElementById('generic-modal-body').innerText.replace(/\s+/g, ' ') : ''), reqs: window._reqs.slice() };
    }, id, role, pw);
    const setRec = (page, id, role) => page.evaluate((id, role) => { DB.users.find(u => u.id === id).role = role; window._reqs.length = 0; }, id, role);
    const open = async () => { const { page, errors } = await H.openPage(b, 'http://127.0.0.1:3205/'); return { page, errors }; };

    // Staff -> Admin reaches the real login, with the admin's own session.
    { const { page: p, errors } = await open(); await setup(p, true);
      const r = await edit(p, 'u3', 'admin');
      ok(r.role === 'admin' && r.reqs.length === 1 && r.reqs[0].url === '/api/set-password' && r.reqs[0].body.userId === UID && r.reqs[0].body.role === 'admin' && r.reqs[0].auth === 'Bearer tok-admin' && !r.modal,
        'making someone an admin asks the server to change their login, with the admin\'s own session, then saves the record (' + JSON.stringify(r.reqs) + ')');
      ok(Object.keys(r.reqs[0].body).sort().join() === 'role,userId', 'the request carries the role and the id and nothing else');
      // Admin -> Staff.
      const r2 = await edit(p, 'u3', 'staff');
      ok(r2.role === 'staff' && r2.reqs.length === 2 && r2.reqs[1].body.role === 'staff', 'making an admin a standard staff login asks the server for staff');
      // Staff <-> Restricted is the app's own setting: no request.
      await setRec(p, 'u3', 'staff');
      const r3 = await edit(p, 'u3', 'restricted');
      ok(r3.role === 'restricted' && r3.reqs.length === 0, 'Staff to Restricted needs no request to the server (it is a setting on the record)');
      const r4 = await edit(p, 'u3', 'staff');
      ok(r4.role === 'staff' && r4.reqs.length === 0, 'and Restricted back to Staff needs none either');
      // Admin -> Restricted: the login must stop being an admin.
      await setRec(p, 'u3', 'admin');
      const r5 = await edit(p, 'u3', 'restricted');
      ok(r5.role === 'restricted' && r5.reqs.length === 1 && r5.reqs[0].body.role === 'staff', 'an admin made Restricted has their login moved to staff first (the server never sees "restricted")');
      // Nothing else changes: same role again sends nothing.
      await setRec(p, 'u3', 'staff');
      const r6 = await edit(p, 'u3', 'staff');
      ok(r6.role === 'staff' && r6.reqs.length === 0, 'saving without changing the role sends no role request');
      ok(errors.length === 0, 'no page errors (roles) (' + errors.slice(0, 2).join(' | ') + ')');
      await p.close(); }
    // The server refuses or cannot be reached: the record is NOT changed and the admin is told.
    { const { page: p } = await open(); await setup(p, true);
      await p.evaluate(() => { window._replies['/api/set-password'] = { status: 500, body: { error: 'Could not change this role. Nothing was changed; try again.' } }; });
      const r = await edit(p, 'u3', 'admin');
      ok(r.role === 'staff' && /Nothing was changed; try again\./.test(r.modal), 'if the server refuses, the person keeps their role and the server\'s reason is shown (' + r.modal.slice(0, 100) + ')');
      await p.evaluate(() => { window._net.fail = true; });
      const r2 = await edit(p, 'u3', 'admin');
      ok(r2.role === 'staff' && r2.modal !== '', 'if the server cannot be reached the person keeps their role too');
      await p.evaluate(() => { window._net.fail = false; window._replies['/api/set-password'] = { status: 200, body: { ok: true } }; });
      const r3 = await edit(p, 'u3', 'admin');
      ok(r3.role === 'admin', 'trying again once the server answers saves it');
      await p.close(); }
    // A person with no login linked: a change that needs the login is refused, nothing is sent.
    { const { page: p } = await open(); await setup(p, true);
      const r = await edit(p, 'u4', 'admin');
      ok(r.role === 'staff' && r.reqs.length === 0 && /cannot be changed here/.test(r.modal) && /sign in once/.test(r.modal), 'a person whose login is not linked yet cannot be made an admin: nothing is sent and the admin is told why (' + r.modal.slice(0, 120) + ')');
      const r2 = await edit(p, 'u4', 'restricted');
      ok(r2.role === 'restricted' && r2.reqs.length === 0, 'but they can still be marked Restricted, which needs no login');
      await p.close(); }
    // An admin cannot change their own role (the server refuses it too).
    { const { page: p } = await open(); await setup(p, true);
      const r = await p.evaluate(async () => {
        const me = currentUser.id, rec = DB.users.find(u => u.id === me); rec.role = 'admin'; window._reqs.length = 0;
        openStaffModal(me); document.getElementById('sm-role').value = 'staff'; await saveStaff(me);
        const layerOpen = !document.getElementById('alert-modal').classList.contains('hidden');
        return { role: rec.role, reqs: window._reqs.slice(), modal: layerOpen ? document.getElementById('alert-modal-msg').textContent : document.getElementById('generic-modal-body').innerText.replace(/\s+/g, ' ') };
      });
      ok(r.role === 'admin' && r.reqs.length === 0 && /cannot change your own role/.test(r.modal), 'an admin cannot demote themselves from the Staff screen (' + r.modal.slice(0, 80) + ')');
      await p.close(); }
    // A password and a role together: the password first, and nothing at all when the password is too short.
    { const { page: p } = await open(); await setup(p, true);
      const r = await edit(p, 'u3', 'admin', 'a-good-password');
      ok(r.reqs.length === 2 && r.reqs[0].body.password === 'a-good-password' && !('role' in r.reqs[0].body) && r.reqs[1].body.role === 'admin' && !('password' in r.reqs[1].body), 'a new password and a new role are two separate requests, the password first');
      await setRec(p, 'u3', 'staff');
      const r2 = await edit(p, 'u3', 'admin', 'short');
      ok(r2.role === 'staff' && r2.reqs.length === 0, 'a too-short password stops the whole save: no request goes out and the role does not change');
      await p.close(); }
    // Offline dev (no Supabase): as before, no request.
    { const { page: p } = await open(); await setup(p, false);
      const r = await edit(p, 'u4', 'admin');
      ok(r.role === 'admin' && r.reqs.length === 0, 'offline dev (no sign-in service) changes the role on the record without any request, as before');
      await p.close(); }
    // Adding a person: the server is sent a role it knows; the record keeps Restricted.
    { const { page: p } = await open(); await setup(p, true);
      const add = (role, email) => p.evaluate(async (role, email) => {
        window._reqs.length = 0; openStaffModal(null);
        document.getElementById('sm-name').value = 'Added ' + role; document.getElementById('sm-email').value = email;
        document.getElementById('sm-pw').value = 'a-good-password'; document.getElementById('sm-pw2').value = 'a-good-password';
        document.getElementById('sm-role').value = role; await saveStaff('');
        const rec = DB.users.find(u => u.email === email);
        return { sent: (window._reqs[0] || {}).body, rec: rec ? rec.role : null, n: window._reqs.length };
      }, role, email);
      const a = await add('restricted', 'r@etcher.test'), b2 = await add('admin', 'a@etcher.test'), c = await add('staff', 's@etcher.test');
      ok(a.n === 1 && a.sent.role === 'staff' && a.rec === 'restricted', 'adding a Restricted person sends the server "staff" and keeps Restricted on the record (' + JSON.stringify(a) + ')');
      ok(b2.sent.role === 'admin' && b2.rec === 'admin' && c.sent.role === 'staff' && c.rec === 'staff', 'adding an admin sends admin, adding staff sends staff');
      await p.close(); }

    // ── Sign-in and live changes ──
    { const { page: p, errors } = await open();
      await p.evaluate(() => {
        window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
        window.__signIn = async (profile, rec) => {
          const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
          window._supabase = { auth: { signOut: async () => {} }, from: tbl };
          DB.users = DB.users.filter(u => (u.email || '').toLowerCase() !== profile.email.toLowerCase());
          if (rec) DB.users.push({ active: true, email: profile.email, ...rec }); DB.staff = DB.users;
          const restored = await _supabaseRestoreSession({ user: { id: profile.id } });
          const nav = id => (document.getElementById(id) || {}).style ? document.getElementById(id).style.display : null;
          return { restored, role: currentUser.role, type: currentUser.type, profileRole: currentUser.profileRole, recId: currentUser.id,
            sidebarRole: document.getElementById('sidebar-role').textContent, timeNav: nav('nav-time-item'), staffNav: nav('nav-staff-item'), notesBlocked: _acBlockedViews(currentUser).has('notes') };
        };
      });
      const prof = (role, n) => ({ id: 'ffffffff-ffff-4fff-8fff-00000000000' + n, role, name: 'Signed In ' + n, email: 'signedin' + n + '@etcher.test', active: true });
      const r1 = await p.evaluate((pf) => __signIn(pf, { id: 'uR1', name: 'Signed In 1', role: 'restricted' }), prof('staff', 1));
      ok(r1.restored && r1.role === 'restricted' && r1.type === 'restricted' && r1.profileRole === 'staff' && r1.recId === 'uR1', 'a staff login whose record says Restricted signs in as Restricted (' + JSON.stringify(r1) + ')');
      ok(r1.sidebarRole === 'restricted' && r1.timeNav === 'none' && r1.notesBlocked === true, 'and the screen follows: Restricted label, no Time, no Client Notes');
      const r2 = await p.evaluate((pf) => __signIn(pf, { id: 'uR2', name: 'Signed In 2', role: 'staff' }), prof('staff', 2));
      ok(r2.restored && r2.role === 'staff' && r2.type === 'staff' && r2.timeNav === '' && r2.notesBlocked === false, 'a staff login whose record says Staff keeps full staff access');
      const r3 = await p.evaluate((pf) => __signIn(pf, { id: 'uR3', name: 'Signed In 3', role: 'restricted' }), prof('admin', 3));
      ok(r3.restored && r3.role === 'admin' && r3.type === 'admin' && r3.staffNav === '', 'a record can not narrow an admin: the profile\'s admin role stands, so nobody is locked out of the Staff screen');
      const r4 = await p.evaluate((pf) => __signIn(pf, { id: 'uR4', name: 'Signed In 4', role: 'admin' }), prof('staff', 4));
      ok(r4.restored && r4.role === 'staff' && r4.type === 'staff' && r4.staffNav === 'none', 'a record can not widen a staff login: "admin" on the record does not make the person an admin');
      const r5 = await p.evaluate((pf) => __signIn(pf, null), prof('staff', 5));
      ok(r5.restored && r5.role === 'staff', 'a staff login with no record yet signs in as staff (the record is created for them)');
      // A colleague (an admin) changes this person's record while they are signed in.
      const live = await p.evaluate(async (pf) => {
        await __signIn(pf, { id: 'uL1', name: 'Live Person', role: 'staff' });
        const out = {};
        DB.users.find(u => u.id === 'uL1').role = 'restricted'; _repaintAfterMerge();
        out.narrowed = { role: currentUser.role, type: currentUser.type, label: document.getElementById('sidebar-role').textContent, time: document.getElementById('nav-time-item').style.display };
        DB.users.find(u => u.id === 'uL1').role = 'staff'; _repaintAfterMerge();
        out.restored = { role: currentUser.role, type: currentUser.type, label: document.getElementById('sidebar-role').textContent, time: document.getElementById('nav-time-item').style.display };
        return out;
      }, { ...prof('staff', 6), email: 'live6@etcher.test' });
      ok(live.narrowed.role === 'restricted' && live.narrowed.type === 'restricted' && live.narrowed.label === 'restricted' && live.narrowed.time === 'none', 'if an admin marks someone Restricted while they are signed in, their access narrows at the next update without signing out (' + JSON.stringify(live.narrowed) + ')');
      ok(live.restored.role === 'staff' && live.restored.type === 'staff' && live.restored.time === '', 'and moving them back to Staff restores it');
      const none = await p.evaluate(() => { const keep = currentUser; currentUser = { id: 'c1', type: 'client', role: 'client', clientId: 'x' }; const changed = _applyStaffRecordToCurrentUser(); const same = currentUser.role === 'client'; currentUser = keep; return { changed, same }; });
      ok(none.changed === false && none.same, 'a client session is never touched by the staff record');
      ok(errors.length === 0, 'no page errors (sign-in) (' + errors.slice(0, 2).join(' | ') + ')');
      await p.close(); }
  } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
}

(async () => {
  await apiTests();
  await browserTests();
  H.report('high-h1-roles-test', pass, fail);
})();
