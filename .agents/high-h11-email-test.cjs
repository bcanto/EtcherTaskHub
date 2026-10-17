// H11 (audit 2026-10-17): any staff session could send any email, to any address, with any text and any
// sender name, as Etcher. Now only a notification to one active staff member, from the caller's own name,
// in a short text, within a ceiling. Runs the real handler against a fake Supabase and a fake mail service.
const path = require('path');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', S3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', X1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

function backend() {
  const st = {
    tokens: { 'tok-s1': S1, 'tok-c1': C1, 'tok-x1': X1 },
    profiles: {
      [S1]: { email: 'sam@etcher.test', name: 'Sam Staff', role: 'staff', active: true },
      [S2]: { email: 'bob_s@etcher.test', name: 'Bob Staff', role: 'staff', active: true },
      [S3]: { email: 'gone@etcher.test', name: 'Gone Staff', role: 'staff', active: false },
      [C1]: { email: 'client@acme.test', name: 'Client Person', role: 'client', active: true },
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1': { email: 'other.bob@etcher.test', name: 'Other Bob', role: 'staff', active: true },
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2': { email: 'amy@etcher.test', name: 'Amy Staff', role: 'staff', active: true },
    },
    mail: [],
  };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  st.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase();
    if (u.origin === 'https://api.resend.com') { st.mail.push(JSON.parse(opts.body)); return res(200, { id: 'mail-' + st.mail.length }); }
    if (u.origin !== 'https://fake-supabase.test') return res(599, {});
    if (u.pathname === '/auth/v1/user') { const id = st.tokens[(opts.headers.Authorization || '').replace('Bearer ', '')]; return id ? res(200, { id }) : res(401, {}); }
    if (u.pathname === '/rest/v1/profiles' && method === 'GET') {
      const id = u.searchParams.get('id'), email = u.searchParams.get('email');
      const rows = Object.entries(st.profiles).map(([pid, p]) => ({ id: pid, ...p })).filter(r => {
        if (id) return 'eq.' + r.id === id;
        if (email && email.startsWith('ilike.')) { const pat = new RegExp('^' + email.slice(6).replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.') + '$', 'i'); return pat.test(r.email); }
        return true;
      });
      return res(200, rows.slice(0, 1));
    }
    return res(404, {});
  };
  return st;
}
const mockRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, setHeader(k, v) { this.headers[k] = v; } });

(async () => {
  const saved = { fetch: global.fetch, env: { ...process.env }, log: console.log, warn: console.warn };
  Object.assign(process.env, { SUPABASE_URL: 'https://fake-supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', SUPABASE_ANON_KEY: 'anon', RESEND_API_KEY: 'resend-key' });
  console.log = () => {}; console.warn = () => {};
  const base = path.resolve(__dirname, '../api');
  for (const f of ['_authAdmin.js', '_email.js', 'notify-email.js']) delete require.cache[path.join(base, f)];
  const handler = require(path.join(base, 'notify-email.js'));
  const call = async (st, token, body, method = 'POST') => { global.fetch = st.fetch; handler._test.reset(); return run(st, token, body, method); };
  const run = async (st, token, body, method = 'POST') => { global.fetch = st.fetch; const r = mockRes(); await handler({ method, headers: { authorization: 'Bearer ' + token }, body }, r); return r; };
  const good = { to: 'sam@etcher.test', type: 'task_assigned', message: 'Task assigned to you: Quarterly review' };
  try {
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test' });
      ok(r.code === 200 && st.mail.length === 1 && st.mail[0].to === 'bob_s@etcher.test', 'a staff member can send a notification to another active staff member (' + r.code + ')');
      ok(/Task assigned to you: Quarterly review/.test(st.mail[0].html) && /Hi Bob Staff/.test(st.mail[0].html), 'the mail greets the person by their own profile name'); }
    // The sender is the caller, whatever the browser says.
    { const st = backend(); await call(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test', senderName: 'Etcher CEO', recipientName: 'Dear Customer' });
      ok(/Sent by <strong[^>]*>Sam Staff<\/strong>/.test(st.mail[0].html) && !/CEO|Dear Customer/.test(st.mail[0].html), 'the sender shown is the caller\'s own profile name; a name typed by the browser is ignored'); }
    // Who it may go to.
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'someone@gmail.test' });
      ok(r.code === 403 && st.mail.length === 0, 'an address that is not a staff profile gets nothing (an outside address cannot be mailed)'); }
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'client@acme.test' });
      ok(r.code === 403 && st.mail.length === 0, 'a client login cannot be mailed from here'); }
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'gone@etcher.test' });
      ok(r.code === 403 && st.mail.length === 0, 'a switched-off staff member cannot be mailed'); }
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'other_bob@etcher.test' });
      ok(r.code === 403 && st.mail.length === 0, 'an address that only matches loosely (an underscore standing for another character) is not the same address');
      const r2 = await call(st, 'tok-s1', { ...good, to: 'other.bob@etcher.test' });
      ok(r2.code === 200 && st.mail.length === 1 && st.mail[0].to === 'other.bob@etcher.test', 'while the exact address is mailed'); }
    for (const to of ['a@etcher.test,b@etcher.test', ['sam@etcher.test'], 'sam@etcher.test\nbcc:x@y.com', '%@etcher.test', '*@etcher.test', '', null, 'not-an-email']) {
      const st = backend(); const r = await call(st, 'tok-s1', { ...good, to });
      if (!(r.code === 400 && st.mail.length === 0)) { ok(false, 'a recipient that is not exactly one plain address is refused: ' + JSON.stringify(to) + ' got ' + r.code); break; }
      if (to === 'not-an-email') ok(true, 'a recipient that is not exactly one plain address (list, array, newline, wildcards, empty) is refused with 400');
    }
    // What it may say.
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test', type: 'password_reset' });
      ok(r.code === 400 && st.mail.length === 0, 'only the four notification kinds can be sent'); }
    { const st = backend(); const r = await call(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test', message: 'x'.repeat(301) });
      ok(r.code === 400 && st.mail.length === 0, 'a long text is refused');
      const r2 = await call(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test', message: '   ' });
      ok(r2.code === 400, 'an empty text is refused'); }
    // Who may call.
    { const st = backend(); const r = await call(st, 'tok-c1', { ...good, to: 'bob_s@etcher.test' });
      ok(r.code === 403 && st.mail.length === 0, 'a client login cannot send email'); }
    { const st = backend(); const r = await call(st, 'tok-x1', { ...good, to: 'bob_s@etcher.test' });
      ok(r.code === 403 && st.mail.length === 0, 'a login with no profile cannot send email'); }
    { const st = backend(); const r = await call(st, 'nope', { ...good, to: 'bob_s@etcher.test' });
      ok(r.code === 401 && st.mail.length === 0, 'no valid session, no email'); }
    { const st = backend(); const r = await call(st, 'tok-s1', good, 'GET');
      ok(r.code === 405, 'only POST is accepted'); ok(!('Access-Control-Allow-Origin' in r.headers), 'the endpoint is not open to other websites (no cross-origin header)'); }
    // The ceiling.
    { const st = backend(); handler._test.reset(); let last = null, sent = 0;
      const tos = ['bob_s@etcher.test', 'sam@etcher.test', 'amy@etcher.test'];
      for (let i = 0; i < 45; i++) { last = await run(st, 'tok-s1', { ...good, to: tos[i % 3], message: 'm' + i }); if (last.code === 200) sent++; }
      ok(sent === 40 && last.code === 429, 'one account is stopped after 40 emails in ten minutes, spread over several people (' + sent + ' sent, last answer ' + last.code + ')'); }
    { const st = backend(); handler._test.reset(); let last = null, sent = 0;
      for (let i = 0; i < 25; i++) { last = await run(st, 'tok-s1', { ...good, to: 'bob_s@etcher.test', message: 'm' + i }); if (last.code === 200) sent++; }
      ok(sent === 20 && last.code === 429, 'one person is not sent more than 20 emails in ten minutes, however many ask (' + sent + ')'); }
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally {
    global.fetch = saved.fetch; console.log = saved.log; console.warn = saved.warn;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'RESEND_API_KEY']) { if (k in saved.env) process.env[k] = saved.env[k]; else delete process.env[k]; }
    console.log('\nhigh-h11-email-test');
    console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
    console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
    process.exit(fail.length ? 1 : 0);
  }
})();
