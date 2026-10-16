// Add Client (2026-10-16 user report): "Add Client Failed" with a raw foreign-key error, a
// validation OK that closed the whole form, and a logo colour pick that chose the wrong colour.
// Part 1 runs api/invite-user.js against a fake Supabase (no network, no real project).
// Part 2 runs the Client form in a browser on its own offline server (never :3001).
const path = require('path');
const H = require('./_iso-harness.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── A fake Supabase: auth users, profiles (with migration 008's trigger), clients, and the
// profiles_client_id_fkey of migration 004 ─────────────────────────────────────────────
function fakeSupabase(st) {
  const res = (status, b) => ({ ok: status < 300, status, json: async () => b, text: async () => (b == null ? '' : JSON.stringify(b)) });
  return async (url, opts = {}) => {
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(method + ' ' + u.pathname);
    if (!u.origin.endsWith('fake-supabase.test')) return res(599, { msg: 'unexpected host ' + u.origin });
    if (u.pathname === '/rest/v1/clients' && method === 'POST') {
      if (st.fail.clients) return res(403, { code: '42501', message: 'permission denied for table clients' });
      if (!st.clients.has(body.id)) st.clients.set(body.id, body);
      return res(201, null);
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (st.users.some(x => x.email.toLowerCase() === body.email.toLowerCase())) return res(422, { code: 422, error_code: 'user_already_exists', msg: 'A user with this email address has already been registered' });
      const id = 'uid-' + (st.users.length + 1);
      st.users.push({ id, email: body.email, password: body.password });
      st.profiles[id] = { role: 'client', client_id: null, email: body.email }; // 008: a new account has no access
      return res(200, { id, email: body.email });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'GET') return res(200, { users: st.users.map(x => ({ id: x.id, email: x.email })) });
    const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m && method === 'PUT') {
      const usr = st.users.find(x => x.id === decodeURIComponent(m[1]));
      if (!usr) return res(404, { msg: 'User not found' });
      usr.password = body.password; return res(200, { id: usr.id });
    }
    if (u.pathname === '/rest/v1/profiles' && method === 'GET') {
      const email = u.searchParams.get('email'), id = u.searchParams.get('id');
      const rows = Object.entries(st.profiles).map(([pid, p]) => ({ id: pid, ...p }))
        .filter(r => (!email || 'eq.' + r.email === email) && (!id || 'eq.' + r.id === id));
      return res(200, rows.slice(0, 1).map(r => ({ id: r.id, role: r.role, client_id: r.client_id })));
    }
    if (u.pathname === '/rest/v1/rpc/upsert_profile' && method === 'POST') {
      if (st.fail.upsert) return res(500, { code: 'XX000', details: null, hint: null, message: 'database is resting' });
      if (body.p_client_id && !st.clients.has(body.p_client_id)) return res(409, { code: '23503', details: `Key (client_id)=(${body.p_client_id}) is not present in table "clients".`, hint: null, message: 'insert or update on table "profiles" violates foreign key constraint "profiles_client_id_fkey"' });
      st.profiles[body.p_id] = { role: body.p_role, client_id: body.p_client_id, email: body.p_email };
      return res(200, null);
    }
    if (u.pathname === '/auth/v1/recover') return res(200, {});
    return res(404, { msg: 'unexpected ' + method + ' ' + u.pathname });
  };
}
function state(seed = {}) {
  return { users: (seed.users || []).map(x => ({ ...x })), profiles: JSON.parse(JSON.stringify(seed.profiles || {})), clients: new Map(Object.entries(seed.clients || {})), calls: [], fail: seed.fail || {} };
}

async function apiTests() {
  const base = path.resolve(__dirname, '../api');
  const mock = (name, exp) => { const p = path.join(base, name); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
  mock('_authAdmin.js', { requireAdminCaller: async () => ({ id: 'admin-uid' }) });
  delete require.cache[path.join(base, 'invite-user.js')];
  const handler = require('../api/invite-user.js');
  const env = { SUPABASE_URL: 'https://fake-supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', SUPABASE_ANON_KEY: 'test-anon-key' };
  const saved = { fetch: global.fetch, log: console.log, error: console.error, env: { ...process.env } };
  Object.assign(process.env, env);
  console.log = () => {}; console.error = () => {};
  const call = async (st, body) => {
    global.fetch = fakeSupabase(st);
    const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, r);
    return r;
  };
  try {
    // The fake enforces the foreign key the way production does (the screenshot's error).
    { const st = state(); global.fetch = fakeSupabase(st);
      const r = await fetch('https://fake-supabase.test/rest/v1/rpc/upsert_profile', { method: 'POST', body: JSON.stringify({ p_id: 'x', p_client_id: 'cust7gkwu' }) });
      ok(r.status === 409 && /profiles_client_id_fkey/.test(await r.text()), 'the fake Supabase refuses a profile whose client is not in the clients table, as production did'); }

    // A new client with a portal login: the client row first, then the login, then the profile.
    { const st = state();
      const r = await call(st, { name: 'Acme Pty Ltd', email: 'ops@acme.test', clientId: 'cust7gkwu', shortCode: 'acm', password: 'longpass1' });
      const cRow = st.clients.get('cust7gkwu'), p = st.profiles[r.body && r.body.id];
      ok(r.code === 200 && p && p.role === 'client' && p.client_id === 'cust7gkwu', 'Add Client with a portal login now succeeds: the login belongs to the new client (' + r.code + ' ' + JSON.stringify(r.body) + ')');
      ok(cRow && cRow.name === 'Acme Pty Ltd' && cRow.short_code === 'ACM', 'the client gets its row in the clients table, with its name and code');
      ok(st.calls.indexOf('POST /rest/v1/clients') > -1 && st.calls.indexOf('POST /rest/v1/clients') < st.calls.indexOf('POST /auth/v1/admin/users'), 'the client row is made before the login, so a failure there leaves no half-made login'); }

    // The user's own case: an earlier attempt made the login and then failed; Save again finishes it.
    { const st = state({ users: [{ id: 'uid-old', email: 'pm@beta.test', password: 'firstpass1' }], profiles: { 'uid-old': { role: 'client', client_id: null, email: 'pm@beta.test' } } });
      const r = await call(st, { name: 'Beta Co', email: 'pm@beta.test', clientId: 'cbeta01', password: 'secondpass2' });
      ok(r.code === 200 && r.body.id === 'uid-old' && st.profiles['uid-old'].client_id === 'cbeta01', 'saving again after the failed attempt links the half-made login to the client');
      ok(st.users[0].password === 'secondpass2', 'and the password typed now is the one that works'); }

    // Never repurpose a login that belongs to someone else.
    { const st = state({ users: [{ id: 'uid-sam', email: 'sam@etcher.test', password: 'sampass11' }], profiles: { 'uid-sam': { role: 'staff', client_id: null, email: 'sam@etcher.test' } } });
      const r = await call(st, { name: 'Gamma', email: 'sam@etcher.test', clientId: 'cgamma', password: 'whatever11' });
      ok(r.code === 409 && /staff login/.test(r.body.error) && st.profiles['uid-sam'].role === 'staff' && st.users[0].password === 'sampass11' && !st.calls.includes('POST /rest/v1/rpc/upsert_profile'),
        'a staff member\'s email is refused as a client login: their role and password are untouched (' + r.code + ')'); }
    { const st = state({ users: [{ id: 'uid-a', email: 'a@alpha.test', password: 'alphapass1' }], profiles: { 'uid-a': { role: 'client', client_id: 'calpha', email: 'a@alpha.test' } } });
      const r = await call(st, { name: 'Delta', email: 'a@alpha.test', clientId: 'cdelta', password: 'deltapass1' });
      ok(r.code === 409 && /another client/.test(r.body.error) && st.profiles['uid-a'].client_id === 'calpha' && st.users[0].password === 'alphapass1', 'another client\'s login is refused, and stays with its client');
      const r2 = await call(st, { name: 'New Staff', email: 'a@alpha.test', role: 'staff', password: 'staffpass1' });
      ok(r2.code === 409 && st.profiles['uid-a'].role === 'client', 'a client\'s login is never turned into a staff login');
      const r3 = await call(st, { name: 'Alpha', email: 'a@alpha.test', clientId: 'calpha', password: 'alphapass2' });
      ok(r3.code === 200 && st.users[0].password === 'alphapass2', 'the same client may set its own login again'); }
    { const st = state({ users: [{ id: 'uid-s', email: 's@etcher.test', password: 'oldstaff11' }], profiles: { 'uid-s': { role: 'staff', client_id: null, email: 's@etcher.test' } } });
      const r = await call(st, { name: 'Sam', email: 's@etcher.test', role: 'staff', password: 'newstaff22' });
      ok(r.code === 200 && st.users[0].password === 'newstaff22' && st.profiles['uid-s'].role === 'staff', 'adding back a staff member whose login exists works, with the new password'); }

    // Failures read as sentences and leave nothing half-made.
    { const st = state({ fail: { clients: true } });
      const r = await call(st, { name: 'Epsilon', email: 'e@eps.test', clientId: 'ceps', password: 'epsilonpw1' });
      ok(r.code === 500 && /set up the client/.test(r.body.error) && !/\{"code"/.test(r.body.error) && st.users.length === 0, 'if the client row cannot be made, no login is created and the message is readable (' + r.body.error + ')'); }
    { const st = state({ fail: { upsert: true } });
      const r = await call(st, { name: 'Zeta', email: 'z@zeta.test', clientId: 'czeta', password: 'zetapass11' });
      ok(r.code === 500 && /Save again/.test(r.body.error) && !/\{"code"/.test(r.body.error), 'a profile failure explains itself in a sentence, never raw JSON (' + r.body.error + ')'); }
    { const st = state();
      const r = await call(st, { name: 'Eta', email: 'e@eta.test', clientId: '../profiles', password: 'etapass111' });
      ok(r.code === 400 && st.calls.length === 0, 'a malformed client id is refused before anything is sent'); }
  } finally {
    global.fetch = saved.fetch; console.log = saved.log; console.error = saved.error;
    for (const k of Object.keys(env)) { if (k in saved.env) process.env[k] = saved.env[k]; else delete process.env[k]; }
  }
}

// The page, served offline on its own port: static files plus an empty /api/config (no Supabase).
// main's serve.mjs only listens on :3001, which is the user's own server, so the suite brings its own.
function staticOffline(port) {
  const http = require('http'), fs = require('fs');
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '', isoEnabled: false, microsoftSignIn: false })); }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not in this test"}'); }
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ stop: () => server.close() })));
}

async function uiTests() {
  const srv = await staticOffline(3188);
  let ui = null;
  try {
    ui = await H.browser(3188);
    const p = ui.page;
    await p.evaluate(() => {
      window.saveDB = () => {};
      // The offline copy has no login service: answer /api/invite-user from the test.
      window._inviteReplies = []; window._inviteBodies = [];
      const real = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).includes('/api/invite-user')) {
          window._inviteBodies.push(JSON.parse(o.body));
          const [status, body] = window._inviteReplies.shift() || [200, { id: 'uid-new' }];
          return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
        }
        return real(u, o);
      };
      // retained-services: take the real-login path even on localhost.
      if (typeof _localClientPreviewAllowed === 'function') window._localClientPreviewAllowed = () => false;
      renderView('clients');
    });
    await sleep(500);
    const fill = (vals) => p.evaluate(v => { for (const [k, x] of Object.entries(v)) document.getElementById(k).value = x; }, vals);
    const state = () => p.evaluate(() => {
      const err = id => (document.getElementById(id + '-err') || {}).textContent || '';
      const inv = [...document.querySelectorAll('#cm-form [aria-invalid="true"]')].map(x => x.id);
      const box = document.getElementById('cm-err');
      return { open: !document.getElementById('generic-modal').classList.contains('hidden') && !!document.getElementById('cm-form'), title: document.getElementById('generic-modal-title').textContent, inv, nameErr: err('cm-name'), emailErr: err('cm-email'), pwErr: err('cm-pw'), pw2Err: err('cm-pw2'), box: box && !box.hidden ? box.textContent : '', focus: document.activeElement && document.activeElement.id, email: (document.getElementById('cm-email') || {}).value };
    });
    const save = async () => { await p.evaluate(() => { document.getElementById('cm-save-btn').click(); }); await sleep(250); };

    await p.evaluate(() => openClientModal('')); await sleep(200);
    await save();
    let s = await state();
    ok(s.open && s.title === 'New Client' && s.inv.join() === 'cm-name' && /client name/i.test(s.nameErr) && s.focus === 'cm-name', 'Save with no name keeps the form open and marks the name in red, with the reason under it (' + JSON.stringify(s) + ')');
    await p.type('#cm-name', 'Acme');
    s = await state();
    ok(!s.inv.length && !s.nameErr, 'typing in the marked field clears its mark');

    await fill({ 'cm-email': 'ops@acme.test', 'cm-pw': 'short', 'cm-pw2': 'short' }); await save();
    s = await state();
    ok(s.open && s.inv.join() === 'cm-pw' && /at least 8/.test(s.pwErr) && s.email === 'ops@acme.test', 'a password that is too short is marked on the password, and the email typed is kept');
    await fill({ 'cm-pw': 'longenough1', 'cm-pw2': 'different11' }); await save();
    s = await state();
    ok(s.open && s.inv.join() === 'cm-pw2' && /do not match/.test(s.pw2Err), 'passwords that do not match are marked on the confirm box');
    await fill({ 'cm-email': 'not-an-email', 'cm-pw2': 'longenough1' }); await save();
    s = await state();
    ok(s.open && s.inv.join() === 'cm-email' && /valid email/.test(s.emailErr), 'a malformed email is marked');
    await fill({ 'cm-email': 'ops@acme.test', 'cm-pw': '', 'cm-pw2': '' });
    const before = await p.evaluate(() => DB.clients.length);
    await save();
    s = await state();
    const after = await p.evaluate(() => DB.clients.length);
    ok(s.open && s.inv.join() === 'cm-pw' && /Enter a password/.test(s.pwErr) && before === after, 'an email with no password asks for one instead of quietly adding the client without its email (' + before + ' to ' + after + ' clients, "' + s.pwErr + '")');

    // The server refuses: the message shows in the form, the form stays, the same client id is reused.
    await fill({ 'cm-pw': 'longenough1', 'cm-pw2': 'longenough1' });
    await p.evaluate(() => { window._inviteReplies.push([500, { error: 'The login was made, but its profile could not be saved: database is resting. Save again to finish.' }]); });
    await save(); await sleep(150);
    s = await state();
    const btn = await p.evaluate(() => ({ disabled: document.getElementById('cm-save-btn').disabled, text: document.getElementById('cm-save-btn').textContent }));
    ok(s.open && /Save again/.test(s.box) && !s.inv.length && !btn.disabled && s.email === 'ops@acme.test', 'a server failure shows in the form, not as a popup that closes it; Save is ready again (' + s.box + ')');
    await p.evaluate(() => { window._inviteReplies.push([409, { error: 'That email belongs to a staff login. Use a different email for the client portal.' }]); });
    await save(); await sleep(150);
    s = await state();
    ok(s.open && s.inv.join() === 'cm-email' && /staff login/.test(s.emailErr), 'an email that is already someone\'s login is marked on the email');
    await p.evaluate(() => { window._inviteReplies.push([200, { id: 'uid-acme' }]); });
    await fill({ 'cm-email': 'portal@acme.test' }); await save(); await sleep(250);
    const made = await p.evaluate(() => { const c = DB.clients[DB.clients.length - 1]; return { c, bodies: window._inviteBodies, open: !document.getElementById('generic-modal').classList.contains('hidden') }; });
    const ids = new Set(made.bodies.map(b => b.clientId));
    ok(!made.open && made.c.name === 'Acme' && made.c.supabaseUserId === 'uid-acme' && made.c.loginEmail === 'portal@acme.test' && made.c.portalEnabled === true, 'then Save creates the client with its portal login');
    ok(ids.size === 1 && made.c.id === made.bodies[0].clientId && made.bodies.every(b => b.shortCode === 'ACM'), 'every attempt used the same client id (a retry finishes the same client), and sent its code (' + [...ids].join() + ')');

    // Logo colours: the colour that fills the logo, not an edge or an accent.
    const pick = (kind) => p.evaluate(async kind => {
      openClientModal('');
      const cv = document.createElement('canvas'); cv.width = 120; cv.height = 60; const cx = cv.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 120, 60);
      let type = 'image/png';
      if (kind === 'redteal') { cx.fillStyle = '#c0392b'; cx.fillRect(0, 0, 80, 60); cx.fillStyle = '#1abc9c'; cx.fillRect(80, 0, 40, 60); }
      if (kind === 'purplejpg') { type = 'image/jpeg'; cx.fillStyle = '#8e44ad'; cx.fillRect(10, 10, 100, 40); }
      if (kind === 'grey') { cx.fillStyle = '#333333'; cx.fillRect(10, 10, 100, 40); }
      if (kind === 'big') { for (let i = 0; i < 20000; i++) { cx.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); cx.fillRect(i % 120, (i / 120 | 0) % 60, 1, 1); } }
      let blob = await new Promise(r => cv.toBlob(r, type, 0.9));
      if (kind === 'big') blob = new Blob([blob, new Uint8Array(210000)], { type });
      const f = new File([blob], 'logo.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
      const inp = document.getElementById('cm-logo-input');
      const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      const box = document.getElementById('cm-err');
      const r = { colour: document.getElementById('cm-color').value, swatches: [...document.querySelectorAll('#cm-color-swatches button')].map(b => b.getAttribute('aria-label')), box: box && !box.hidden ? box.textContent : '', open: !document.getElementById('generic-modal').classList.contains('hidden') && !!document.getElementById('cm-form') };
      closeGenericModal();
      return r;
    }, kind);
    const dist = (a, b) => { const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const [p1, p2] = [h(a), h(b)]; return Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]); };
    const rt = await pick('redteal');
    ok(dist(rt.colour, '#c0392b') < 20 && rt.swatches.length >= 2, 'a logo two-thirds red and one-third teal gets its red (' + rt.colour + '), with teal offered as a swatch');
    const pj = await pick('purplejpg');
    ok(dist(pj.colour, '#8e44ad') < 30, 'a purple JPG gets its purple, not a pale edge colour (' + pj.colour + ')');
    const gr = await pick('grey');
    ok(gr.colour === '#3b82f6' && gr.swatches.length === 0 && !gr.box, 'a black and grey logo leaves the colour as it was, quietly');
    const big = await pick('big');
    ok(big.open && /200 KB/.test(big.box), 'a logo over 200 KB is refused inside the form, which stays open (' + big.box + ')');

    // Editing a client with a logo keeps its saved colour (it used to be replaced on open).
    const kept = await p.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 60; cv.height = 60; const cx = cv.getContext('2d');
      cx.fillStyle = '#c0392b'; cx.fillRect(0, 0, 60, 60);
      const c = DB.clients.find(x => x.name === 'Acme'); c.logo = cv.toDataURL('image/png'); c.color = '#123456';
      openClientModal(c.id);
      await new Promise(r => setTimeout(r, 700));
      const r = { colour: document.getElementById('cm-color').value, swatches: document.querySelectorAll('#cm-color-swatches button').length };
      closeGenericModal();
      return r;
    });
    ok(kept.colour === '#123456' && kept.swatches >= 1, 'opening Edit keeps the saved colour and only offers the logo\'s colours (' + JSON.stringify(kept) + ')');
    ok(ui.errors.length === 0, 'no page errors or native dialogs (' + ui.errors.slice(0, 2).join(' | ') + ')');
  } finally {
    if (ui) await ui.close();
    srv.stop();
  }
}

(async () => {
  try { await apiTests(); } catch (e) { fail.push('API part crashed: ' + (e && e.stack || e)); }
  try { await uiTests(); } catch (e) { fail.push('UI part crashed: ' + (e && e.stack || e)); }
  console.log('\nclient-add-test');
  console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
