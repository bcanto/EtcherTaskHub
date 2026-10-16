// C2 (audit 2026-10-17): Remove staff did not remove access. The login and profile stayed, and the next
// sign-in made a fresh staff record. Now removing a person switches their login off (banned + profile
// inactive), refuses to carry on if that fails, and a switched-off account is refused at sign-in.
// Part 1 runs the real API handlers against a fake Supabase (no network). Part 2 drives the app in a
// browser on its own server. Neither touches :3001 or a real project.
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

// ── A fake Supabase: auth users (with ban), profiles, the token check, and the account endpoints ──
function backend() {
  const st = {
    tokens: { 'tok-a1': A1, 'tok-a3': A3, 'tok-s2': S2, 'tok-s1': S1 },
    auth: { [A1]: { email: 'a1@etcher.test' }, [A2]: { email: 'a2@etcher.test' }, [A3]: { email: 'a3@etcher.test' }, [S1]: { email: 's1@etcher.test' }, [S2]: { email: 's2@etcher.test' } },
    profiles: { [A1]: { role: 'admin', active: true }, [A2]: { role: 'admin', active: true }, [A3]: { role: 'admin', active: false }, [S1]: { role: 'staff', active: true }, [S2]: { role: 'staff', active: true } },
    calls: [], failBan: false, failProfilePatch: false,
  };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (body == null ? '' : JSON.stringify(body)) });
  st.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(method + ' ' + u.pathname + (u.search ? '?' + u.searchParams.toString().slice(0, 60) : ''));
    if (u.origin !== 'https://fake-supabase.test') return res(599, { msg: 'unexpected host' });
    if (u.pathname === '/auth/v1/user') { const id = st.tokens[(opts.headers.Authorization || '').replace('Bearer ', '')]; return id ? res(200, { id }) : res(401, { msg: 'bad token' }); }
    let m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m && method === 'PUT') {
      const id = decodeURIComponent(m[1]);
      if (!st.auth[id]) return res(404, { msg: 'not found' });
      if ('ban_duration' in body) { if (st.failBan) return res(500, { msg: 'ban failed' }); st.auth[id].banned = body.ban_duration !== 'none' ? body.ban_duration : null; }
      if ('password' in body) st.auth[id].password = body.password;
      return res(200, { id });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (Object.values(st.auth).some(x => x.email === body.email)) return res(422, { error_code: 'user_already_exists', msg: 'exists' });
      const id = 'cccccccc-cccc-4ccc-8ccc-' + String(Object.keys(st.auth).length).padStart(12, '0'); st.auth[id] = { email: body.email, password: body.password };
      return res(200, { id });
    }
    if (u.pathname === '/rest/v1/profiles' && method === 'GET') {
      const id = u.searchParams.get('id'), email = u.searchParams.get('email');
      const rows = Object.entries(st.profiles).map(([pid, p]) => ({ id: pid, email: (st.auth[pid] || {}).email, ...p }))
        .filter(r => (!id || 'eq.' + r.id === id) && (!email || 'eq.' + r.email === email));
      return res(200, rows.slice(0, 1));
    }
    if (u.pathname === '/rest/v1/profiles' && method === 'PATCH') {
      if (st.failProfilePatch) return res(500, { message: 'patch failed' });
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
  const load = f => { delete require.cache[path.join(base, f)]; return require(path.join(base, f)); };
  for (const f of ['_authAdmin.js', '_accountAccess.js', 'set-password.js', 'invite-user.js']) delete require.cache[path.join(base, f)];
  const setPassword = load('set-password.js'), inviteUser = load('invite-user.js');
  const call = async (h, st, token, body) => { global.fetch = st.fetch; const r = mockRes(); await h({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body }, r); return r; };
  const writes = st => st.calls.filter(c => /^(PUT|PATCH|POST) /.test(c) && !/\/auth\/v1\/user/.test(c));
  try {
    // Switch a person off.
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      ok(r.code === 200 && r.body.ok === true && st.auth[S1].banned && st.profiles[S1].active === false, 'an admin removing a person bans their login and marks the profile inactive (' + r.code + ')');
      const r2 = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      ok(r2.code === 200 && st.profiles[S1].active === false, 'removing someone twice is harmless (a failed attempt can simply be tried again)'); }
    // Who may do it.
    { const st = backend(); const r = await call(setPassword, st, 'tok-s2', { userId: S1, access: 'disable' });
      ok(r.code === 403 && !st.auth[S1].banned && st.profiles[S1].active === true && writes(st).length === 0, 'a staff member cannot remove anyone (403, nothing changed)'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a3', { userId: S1, access: 'disable' });
      ok(r.code === 403 && !st.auth[S1].banned && writes(st).length === 0, 'an admin who is switched off is refused, even with a valid session token'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: A1, access: 'disable' });
      ok(r.code === 409 && /own access/.test(r.body.error) && !st.auth[A1].banned && st.profiles[A1].active === true, 'an admin cannot remove themselves, so one admin is always left'); }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: A2, access: 'disable' });
      ok(r.code === 200 && st.profiles[A2].active === false && st.profiles[A1].active === true, 'an admin can remove another admin while they remain'); }
    // Bad input never reaches Supabase.
    for (const bad of ['../../auth/v1/admin/users', 'not-a-uuid', '', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/../x', 42, null]) {
      const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: bad, access: 'disable' });
      if (!(r.code === 400 && writes(st).length === 0)) { ok(false, 'a malformed user id is refused before anything is sent: ' + JSON.stringify(bad) + ' got ' + r.code); break; }
      if (bad === null) ok(true, 'a malformed user id (path tricks, text, numbers, nothing) is refused with 400 before anything is sent');
    }
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'delete' });
      ok(r.code === 400 && writes(st).length === 0, 'an unknown access action is refused'); }
    // Failures are honest and leave things repeatable.
    { const st = backend(); st.failBan = true; const r = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      ok(r.code === 500 && /Nothing was changed/.test(r.body.error) && st.profiles[S1].active === true, 'if the login cannot be stopped, nothing else is changed and the answer says so'); }
    { const st = backend(); st.failProfilePatch = true; const r = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      ok(r.code === 500 && /stopped/.test(r.body.error) && /Try again/.test(r.body.error) && st.auth[S1].banned, 'if only the profile step fails, the answer says the login is stopped and to try again'); }
    // Switching back on.
    { const st = backend(); await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' }); const r = await call(setPassword, st, 'tok-a1', { userId: S1, access: 'enable' });
      ok(r.code === 200 && !st.auth[S1].banned && st.profiles[S1].active === true, 'enable switches the login and the profile back on'); }
    // The password path still works, with the new guards.
    { const st = backend(); const r = await call(setPassword, st, 'tok-a1', { userId: S1, password: 'a-good-password' });
      ok(r.code === 200 && st.auth[S1].password === 'a-good-password', 'setting a password still works');
      const r2 = await call(setPassword, st, 'tok-a1', { userId: S1, password: 'short' });
      ok(r2.code === 400 && /8 characters/.test(r2.body.error) && st.auth[S1].password === 'a-good-password', 'a password under 8 characters is refused by the server too');
      const r3 = await call(setPassword, st, 'tok-a1', { userId: S1 });
      ok(r3.code === 400, 'no password and no action is refused'); }
    // Adding someone back (invite-user): a switched-off login is switched on again; others are left alone.
    { const st = backend(); await call(setPassword, st, 'tok-a1', { userId: S1, access: 'disable' });
      const r = await call(inviteUser, st, 'tok-a1', { name: 'Sam Staff', email: 's1@etcher.test', role: 'staff', password: 'a-good-password' });
      ok(r.code === 200 && r.body.id === S1 && st.profiles[S1].active === true && !st.auth[S1].banned && st.upserted && st.upserted.p_role === 'staff', 'adding a removed person again switches their login back on (' + r.code + ' ' + JSON.stringify(r.body) + ')'); }
    { const st = backend(); const before = JSON.stringify(st.profiles[S2]);
      const r = await call(inviteUser, st, 'tok-a1', { name: 'Sam Two', email: 's2@etcher.test', role: 'staff', password: 'a-good-password' });
      ok(r.code === 200 && !st.calls.some(c => /^PATCH .*profiles/.test(c)) && JSON.stringify(st.profiles[S2]) === before && !st.auth[S2].banned, 'adding someone whose login is already active changes nothing about their access'); }
    { const st = backend(); const r = await call(inviteUser, st, 'tok-a1', { name: 'Brand New', email: 'new.person@etcher.test', role: 'staff', password: 'a-good-password' });
      ok(r.code === 200 && !st.calls.some(c => /^PATCH .*profiles/.test(c)), 'adding a brand-new person works as before'); }
    { const st = backend(); const r = await call(inviteUser, st, 'tok-a3', { name: 'x', email: 'x@etcher.test', role: 'staff', password: 'a-good-password' });
      ok(r.code === 403, 'inviting is refused for a switched-off admin too'); }
  } catch (e) { fail.push('API part crashed: ' + (e && e.stack || e)); }
  finally {
    global.fetch = saved.fetch; console.log = saved.log; console.error = saved.error;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) { if (k in saved.env) process.env[k] = saved.env[k]; else delete process.env[k]; }
  }
}

(async () => {
  await apiTests();
  if (process.env.ONLY === 'api') H.report('crit-c2-staff-access-test (api only)', pass, fail);
  try { await require('./_crit-c2-browser-part.cjs')(H, ok, fail, { S1, A1 }); } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  H.report('crit-c2-staff-access-test', pass, fail);
})();
