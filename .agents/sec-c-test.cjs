// Security batch C (SSO + HTTPS plan phase B2): staff sign in with Microsoft only, behind a database switch (migration
// 018, off by default). Part 1 runs the real server handlers and the MCP connector against a fake Supabase; part 2 reads
// the migration; part 3 drives the app in a browser on its own server. Nothing touches :3001 or a real project.
const path = require('path'), fs = require('fs');
const H = require('./_static-offline.cjs');
const ROOT = H.ROOT;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const UID = { admin: 'aaaaaaaa-0000-4000-8000-000000000001', staff: 'aaaaaaaa-0000-4000-8000-000000000002', client: 'aaaaaaaa-0000-4000-8000-000000000003' };
function fake(rpc) {
  const st = { rpcCalls: [] };
  st.fetch = async (url, opts = {}) => {
    const u = new URL(url), auth = (opts.headers || {}).Authorization || '';
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.pathname === '/auth/v1/user') { const id = { 'Bearer tok-admin': UID.admin, 'Bearer tok-staff': UID.staff, 'Bearer tok-client': UID.client }[auth]; return id ? res(200, { id, email: id === UID.admin ? 'admin@etcher.test' : id === UID.staff ? 'staff@etcher.test' : 'client@x.test' }) : res(401, {}); }
    if (u.pathname === '/rest/v1/profiles') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); const role = id === UID.admin ? 'admin' : id === UID.staff ? 'staff' : 'client'; return res(200, [{ role, active: true, name: role, client_id: role === 'client' ? 'c1' : null }]); }
    if (u.pathname === '/rest/v1/rpc/session_allowed') { st.rpcCalls.push(auth); st.rpcMethods = (st.rpcMethods || []).concat((opts.method || 'GET').toUpperCase()); return rpc.status === 200 ? res(200, rpc.value) : res(rpc.status, { code: rpc.status === 404 ? 'PGRST202' : 'X' }); }
    return res(404, {});
  };
  return st;
}
const mockRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, send(b) { try { this.body = JSON.parse(b); } catch (_) { this.body = b; } return this; }, end() { return this; } });

(async () => {
  // ── part 1: the server ──
  const saved = { fetch: global.fetch, env: { ...process.env } };
  Object.assign(process.env, { SUPABASE_URL: 'https://fake-supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', SUPABASE_ANON_KEY: 'anon-key', MCP_OAUTH_SECRET: 'test-secret-0123456789', MCP_ALLOWED_EMAIL: 'admin@etcher.test,staff@etcher.test' });
  const load = f => { delete require.cache[require.resolve(path.join(ROOT, 'api', f))]; return require(path.join(ROOT, 'api', f)); };
  try {
    const A = load('_authAdmin.js');
    const call = async (fn, tok, rpc) => { const st = fake(rpc); global.fetch = st.fetch; const r = mockRes(); const caller = await fn({ headers: { authorization: 'Bearer ' + tok } }, r); return { caller, code: r.code, body: r.body, rpcCalls: st.rpcCalls, rpcMethods: st.rpcMethods || [] }; };
    {
      const r0 = await call(A.requireAdminCaller, 'tok-admin', { status: 200, value: true });
      ok(r0.rpcMethods.length === 1 && r0.rpcMethods[0] === 'GET', 'the question is asked as a read (GET), never counted as a write (' + JSON.stringify(r0.rpcMethods) + ')');
      const keepUrl = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
      const st = fake({ status: 500 }); global.fetch = st.fetch;
      const noProject = await A.sessionAllowed('tok-admin');
      process.env.SUPABASE_URL = keepUrl;
      ok(noProject === 'missing' && st.rpcCalls.length === 0, 'with no Supabase project configured there is no rule to ask about (as before migration 018) (' + noProject + ')');
    }
    let r = await call(A.requireAdminCaller, 'tok-admin', { status: 200, value: false });
    ok(!r.caller && r.code === 403 && /sign in with Microsoft/.test((r.body || {}).error || ''), 'with the switch on, an admin password session is refused by the account endpoints, with the reason (' + r.code + ')');
    ok(r.rpcCalls.length === 1 && r.rpcCalls[0] === 'Bearer tok-admin', 'the database is asked about the caller\'s own session (their token, not the server key)');
    r = await call(A.requireAdminCaller, 'tok-admin', { status: 200, value: true });
    ok(!!r.caller && r.code === 200, 'a session that meets the rule (Microsoft, or the switch off) is let through');
    r = await call(A.requireAdminCaller, 'tok-admin', { status: 404 });
    ok(!!r.caller, 'before migration 018 is applied (no such function), nothing changes: the caller is let through');
    r = await call(A.requireAdminCaller, 'tok-admin', { status: 500 });
    ok(!r.caller && r.code === 503, 'if the database cannot answer, the account endpoints refuse (they act with the server key, past the database rules) (' + r.code + ')');
    r = await call(A.requireStaffCaller, 'tok-staff', { status: 200, value: false });
    ok(!r.caller && r.code === 403, 'the staff endpoints apply the same rule (' + r.code + ')');
    r = await call(A.requireStaffCaller, 'tok-staff', { status: 200, value: true });
    ok(!!r.caller, 'and let a Microsoft session through');
    r = await call(A.requireClientCaller, 'tok-client', { status: 200, value: true });
    ok(!!r.caller && r.rpcCalls.length === 1 && r.rpcCalls[0] === 'Bearer tok-client', 'client portal calls ask the database about the client\'s own session, and go through when it says yes');
    r = await call(A.requireClientCaller, 'tok-client', { status: 200, value: false });
    ok(!r.caller && r.code === 403, 'and are refused when it says no (for a client that only happens when they set up two-step sign-in and skipped the code)');
    r = await call(A.requireClientCaller, 'tok-client', { status: 404 });
    ok(!!r.caller, 'before migration 018 is applied, client portal calls work as today');

    // the MCP connector's sign-in step
    const { signToken } = load('_mcpAuth.js');
    const handler = load('oauth/[...path].js');
    const clientId = signToken({ kind: 'client', redirect_uris: ['https://claude.test/cb'] }, 3600);
    const complete = async (tok, rpc) => { const st = fake(rpc); global.fetch = st.fetch; const res = mockRes(); await handler({ method: 'POST', query: { path: 'complete' }, headers: {}, body: { client_id: clientId, redirect_uri: 'https://claude.test/cb', accessToken: tok, code_challenge: 'x' } }, res); return res; };
    let m = await complete('tok-staff', { status: 200, value: false });
    ok(m.code === 403 && /sign in with Microsoft/.test(JSON.stringify(m.body)), 'the MCP connector refuses a staff password session too, with the reason (' + m.code + ')');
    m = await complete('tok-staff', { status: 200, value: true });
    ok(m.code === 200 && /code=/.test((m.body || {}).redirect || ''), 'and connects a Microsoft session as before');
    m = await complete('tok-staff', { status: 404 });
    ok(m.code === 200, 'before migration 018 is applied, the connector works as before');
  } catch (e) { fail.push('server part crashed: ' + (e && e.stack || e)); }
  finally { global.fetch = saved.fetch; for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'MCP_OAUTH_SECRET', 'MCP_ALLOWED_EMAIL']) { if (saved.env[k] === undefined) delete process.env[k]; else process.env[k] = saved.env[k]; } }

  // ── part 2: the migration ──
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '018_staff_sign_in_with_microsoft.sql'), 'utf8');
  const code = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  ok(/staff_microsoft_only\s+BOOLEAN NOT NULL DEFAULT false/.test(code) && /INSERT INTO public\.security_settings \(id\) VALUES \(1\) ON CONFLICT \(id\) DO NOTHING/.test(code), 'applying the migration changes nothing by itself: the switch starts off, and re-running it never flips it');
  ok(/WHEN NOT EXISTS \(SELECT 1 FROM public\.profiles WHERE id = auth\.uid\(\) AND role IN \('admin', 'pm', 'staff'\)\) THEN true/.test(code), 'the rule applies to internal staff only: clients are always allowed');
  ok(/lower\(COALESCE\(auth\.jwt\(\) ->> 'email', ''\)\) IN \(SELECT email FROM public\.break_glass_accounts\)/.test(code) && /CHECK \(email = lower\(email\)\)/.test(code), 'a break-glass account (stored in lower case, matched in lower case) may still use its password');
  ok(/auth\.jwt\(\) -> 'amr'/.test(code) && /'oauth'/.test(code), 'a session counts as Microsoft when its token records an oauth sign-in');
  const ir = /FUNCTION public\.is_internal\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(code), ar = /FUNCTION public\.auth_user_role\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(code);
  ok(!!ir && /AND active/.test(ir[1]) && /session_allowed\(\)/.test(ir[1]) && !!ar && /AND active/.test(ar[1]) && /session_allowed\(\)/.test(ar[1]), 'both helpers keep migration 016\'s rule (inactive accounts have no access) and add the sign-in rule');
  ok(/GRANT EXECUTE ON FUNCTION public\.session_allowed\(\) TO authenticated/.test(code) && /REVOKE ALL ON FUNCTION public\.session_allowed\(\) FROM PUBLIC/.test(code), 'only signed-in users can ask the question');
  ok(/ALTER TABLE public\.security_settings ENABLE ROW LEVEL SECURITY/.test(code) && /ALTER TABLE public\.break_glass_accounts ENABLE ROW LEVEL SECURITY/.test(code) && !/CREATE POLICY/i.test(code), 'the switch and the break-glass list are locked (row level security, no policies): only the SQL editor changes them');
  ok(/-- ── Roll back completely/.test(sql) && /staff_microsoft_only = false/.test(sql.split('Switch off')[1] || ''), 'the file carries the switch-off line and a complete roll-back');

  // ── part 3: the app ──
  const PORT = 3255;
  const srv = await H.serve(PORT), b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const restore = (role, rpc) => p.evaluate(async (role, rpc) => {
      window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
      const id = 'ffffffff-ffff-4fff-8fff-0000000000' + (role === 'admin' ? '21' : role === 'staff' ? '22' : '23');
      const profile = { id, role, name: role + ' person', email: role + '@etcher.test', active: true, client_id: role === 'client' ? 'c1' : null };
      let rpcCalls = 0, signedOut = 0;
      const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
      window._supabase = { auth: { signOut: async () => { signedOut++; } }, from: tbl,
        rpc: async name => { rpcCalls++; if (name !== 'session_allowed') return { data: null, error: { message: 'unknown' } }; return rpc === 'missing' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: rpc, error: null }; } };
      if (!DB.users.some(u => u.email === profile.email)) { DB.users.push({ id: 'u_' + role + '_c', name: profile.name, email: profile.email, role: role === 'admin' ? 'admin' : 'staff', active: true }); DB.staff = DB.users; }
      currentUser = null;
      document.getElementById('login-error')?.classList.add('hidden');
      let restored = null; try { restored = await _supabaseRestoreSession({ user: { id } }); } catch (e) { restored = 'threw ' + e.message; }
      const errEl = document.getElementById('login-error');
      const msg = errEl && !errEl.classList.contains('hidden') ? errEl.innerText.replace(/\s+/g, ' ') : '';
      delete window._supabase;
      return { restored, user: !!currentUser, rpcCalls, signedOut, msg };
    }, role, rpc);
    let r = await restore('staff', false);
    ok(r.restored === false && !r.user && r.signedOut === 1, 'with the switch on, a staff password session is signed out instead of opening an empty app (' + JSON.stringify(r) + ')');
    ok(/Staff accounts sign in with Microsoft/.test(r.msg), 'and the login screen says to use "Sign in with Microsoft" (' + r.msg + ')');
    r = await restore('admin', false);
    ok(r.restored === false && !r.user, 'admins too (unless on the break-glass list, which the database decides)');
    r = await restore('staff', true);
    ok(r.restored === true && r.user && r.signedOut === 0, 'a session that meets the rule signs in as before (' + JSON.stringify(r) + ')');
    r = await restore('staff', 'missing');
    ok(r.restored === true && r.user, 'before migration 018 is applied (no such function), everyone signs in as today');
    r = await restore('client', false);
    ok(r.rpcCalls === 0 && r.signedOut === 0 && !/Microsoft/.test(r.msg), 'a client login is never asked about Microsoft (' + JSON.stringify(r) + ')');

    // ── a Microsoft sign-in that opens no account (part A3) ──
    // row: the profile the database returns (null = none); err: its error; method: how the session signed in; shown: a
    // reason already on the login screen.
    const unknown = o => p.evaluate(async o => {
      const id = 'ffffffff-ffff-4fff-8fff-000000000024';
      const payload = btoa(JSON.stringify({ amr: [{ method: o.method || 'oauth' }] })).replace(/=+$/, '');
      let signedOut = 0;
      window._supabase = { auth: { signOut: async () => { signedOut++; } },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: o.err ? null : o.row, error: o.err || null }) }) }) }) };
      const errEl = document.getElementById('login-error');
      errEl?.classList.add('hidden');
      if (o.shown) showLoginError(o.shown);
      let out = null; try { out = await _refuseUnknownMicrosoftSession({ access_token: 'h.' + payload + '.s', user: { id } }); } catch (e) { out = 'threw ' + e.message; }
      const msg = errEl && !errEl.classList.contains('hidden') ? errEl.innerText.replace(/\s+/g, ' ') : '';
      delete window._supabase;
      return { out, signedOut, msg };
    }, o);
    const NONE = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
    r = await unknown({ err: NONE });
    ok(r.out === true && r.signedOut === 1 && /no access to Task Hub/.test(r.msg), 'a Microsoft sign-in with no Task Hub account is signed out, with the reason on the login screen (' + JSON.stringify(r) + ')');
    r = await unknown({ row: { id: 'x', role: 'client', client_id: null, active: true } });
    ok(r.out === true && r.signedOut === 1, 'so is the empty account Supabase makes for an unlinked Microsoft login (no client, no role) (' + JSON.stringify(r) + ')');
    r = await unknown({ row: { id: 'x', role: 'staff', client_id: null, active: false } });
    ok(r.out === true && r.signedOut === 1, 'and a switched-off staff account (' + JSON.stringify(r) + ')');
    r = await unknown({ err: { message: 'Failed to fetch' } });
    ok(r.out === false && r.signedOut === 0 && r.msg === '', 'a passing fault reading the profile signs nobody out: the next load tries again (' + JSON.stringify(r) + ')');
    r = await unknown({ method: 'password', err: NONE });
    ok(r.out === false && r.signedOut === 0 && r.msg === '', 'a password session is left as it was (' + JSON.stringify(r) + ')');
    r = await unknown({ err: NONE, shown: 'Staff accounts sign in with Microsoft. Use "Sign in with Microsoft" below.' });
    ok(r.out === false && r.signedOut === 0 && /Staff accounts sign in with Microsoft/.test(r.msg), 'a sign-in already refused with its own reason keeps that reason (' + JSON.stringify(r) + ')');
    r = await unknown({ row: { id: 'x', role: 'staff', client_id: null, active: true } });
    ok(r.out === false && r.signedOut === 0, 'a real staff account is never told it has no access (' + JSON.stringify(r) + ')');
    ok(/const restored=await _supabaseRestoreSession\(session\);\s*if\(restored\)return;\s*await _refuseUnknownMicrosoftSession\(session\);/.test(fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8')), 'start-up asks this whenever a stored session does not open the app');

    // ── a sign-in error Supabase sends back in the address ──
    const fromUrl = u => p.evaluate(u => { history.replaceState(null, '', u); const m = _authErrorFromUrl(); return { m, left: location.search + location.hash }; }, u);
    r = await fromUrl('/#error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance');
    ok(/no access to Task Hub/.test(r.m) && r.left === '', 'an unknown Microsoft account (new sign-ups off) is told it has no access, and the error leaves the address (' + JSON.stringify(r) + ')');
    r = await fromUrl('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    ok(/email link has expired/.test(r.m) && r.left === '', 'an expired email link says so (' + JSON.stringify(r) + ')');
    r = await fromUrl('/?error=server_error&error_description=Call+0800+000+000+to+unlock+your+account');
    ok(/^Sign-in did not finish/.test(r.m) && !/0800|unlock/.test(r.m) && r.left === '', 'any other error gets fixed words: text in the address is never shown, so a crafted link cannot put words on the login page (' + JSON.stringify(r) + ')');
    r = await fromUrl('/?d=t1#notes');
    ok(r.m === '' && r.left === '?d=t1#notes', 'an address without an error is left alone (' + JSON.stringify(r) + ')');
    await p.evaluate(() => history.replaceState(null, '', '/'));
    ok(/_idleShowNotice\(\);\s*\{const m=_authErrorFromUrl\(\);if\(m\)showLoginError\(m\);\}/.test(fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8')), 'start-up shows it on the login screen when no session opened');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('sec-c-test', pass, fail);
})();
