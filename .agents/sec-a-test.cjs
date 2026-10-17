// Security batch A (SSO + HTTPS plan, 2026-10-17): security headers for the live site from one source, the login
// library pinned with an integrity hash, the dev server bound to this machine with secrets never served, "Sign in with
// Microsoft" behind MICROSOFT_SIGNIN, and email links on the real https address.
// Spawns its own serve.mjs instances on private ports (--offline); never touches :3001 or a real Supabase project.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), http = require('http');
const H = require('./_static-offline.cjs');
const ROOT = H.ROOT;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

// Status only: some blocked paths can be real secrets on a developer machine, so a body is never read for them.
const status = (host, port, p) => new Promise(res => {
  const req = http.get({ host, port, path: p, timeout: 3000 }, r => { r.resume(); res(r.statusCode); });
  req.on('error', () => res(0)); req.on('timeout', () => { req.destroy(); res(0); });
});
const getRes = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(ch).toString() })); }).on('error', rej));
function start(args, port, env) {
  const proc = spawn(process.execPath, ['serve.mjs', ...args, '--port', String(port)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...(env || {}) } });
  const ready = new Promise((resolve, reject) => {
    let n = 60; const tick = () => status('127.0.0.1', port, '/api/config').then(s => s === 200 ? resolve() : (--n > 0 ? setTimeout(tick, 100) : reject(new Error('server ' + port + ' did not start'))));
    tick();
  });
  return { proc, ready };
}
const stop = proc => new Promise(r => { proc.once('exit', r); proc.kill(); setTimeout(r, 1500); });
const lanIp = () => { for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address; return null; };

(async () => {
  // ── headers: one source, same locally and on the live site ──
  const { securityHeaders } = require(path.join(ROOT, 'security-headers.cjs'));
  const want = securityHeaders();
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const vh = Object.fromEntries((((vercel.headers || []).find(h => h.source === '/(.*)')) || { headers: [] }).headers.map(h => [h.key, h.value]));
  ok(JSON.stringify(vh) === JSON.stringify(want), 'vercel.json sends the live site exactly the security headers in security-headers.cjs');
  ok(/max-age=\d{8,}; includeSubDomains/.test(want['Strict-Transport-Security'] || ''), 'the live site sends HSTS for two years, subdomains included (' + want['Strict-Transport-Security'] + ')');
  ok(/frame-ancestors 'none'/.test(want['Content-Security-Policy'] || '') && want['X-Frame-Options'] === 'DENY', 'the live site refuses to be framed by another site (clickjacking)');
  ok(want['X-Content-Type-Options'] === 'nosniff', 'the live site sends nosniff');
  // The header policy must allow everything the page's own policy tag allows, or it would block something today's live
  // site loads (the stricter of the two always wins).
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const meta = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
  const parse = p => Object.fromEntries(p.split(';').map(x => x.trim()).filter(Boolean).map(x => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));
  const mp = parse(meta), hp = parse(want['Content-Security-Policy']);
  const missing = [];
  for (const [k, vals] of Object.entries(mp)) {
    const hv = hp[k] || hp['default-src'] || [];
    for (const v of vals) if (!hv.includes(v) && !(k === 'connect-src' && v === 'https://cdn.tailwindcss.com')) missing.push(k + ' ' + v);
  }
  ok(meta.length > 0 && missing.length === 0, 'the header policy allows everything the page\'s own policy allows (nothing the live site loads today is blocked) (' + (missing.join(', ') || 'none missing') + ')');
  ok(!/cdn\.tailwindcss\.com/.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')), 'the page loads nothing from cdn.tailwindcss.com, so leaving it out of the header connect-src changes nothing');

  // ── the sign-in library: pinned, served from this site, with a matching integrity hash ──
  const tag = /<script src="(vendor\/supabase-js-[\d.]+\.umd\.js)" integrity="(sha384-[^"]+)"><\/script>/.exec(html);
  ok(!!tag && !/supabase-js@2\//.test(html), 'the login page loads the sign-in library from a pinned copy on this site, not "any 2.x" from a public CDN');
  const vend = tag && fs.existsSync(path.join(ROOT, tag[1])) ? fs.readFileSync(path.join(ROOT, tag[1])) : Buffer.alloc(0);
  ok(!!tag && vend.length > 100000 && tag[2] === 'sha384-' + crypto.createHash('sha384').update(vend).digest('base64'), 'its integrity hash matches the file, so a changed file is refused by the browser');
  ok(/^vendor\/\*\* -text/m.test(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')), 'git keeps the pinned file byte for byte (vendor/** -text), so the deployed copy still matches its hash');

  // ── what the live site publishes (.vercelignore) ──
  {
    const vi = fs.existsSync(path.join(ROOT, '.vercelignore')) ? fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8') : '';
    const pats = vi.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const toRe = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\/$/, '/.*') + '$');
    const res = pats.map(toRe);
    const ignored = f => res.some(r => r.test(f) || r.test(f.split('/').slice(-1)[0]));
    const mustGo = ['supabase/migrations/001_initial_schema.sql', 'docs/security/sso-https-plan.md', 'serve.mjs', 'email-intake.mjs', 'SETUP.md', 'CLAUDE.md', '.env', '.env.local', '.agents/gate.sh', 'workboard/x', 'scripts/gen-vercel-headers.cjs'];
    const mustStay = ['index.html', 'supabase-client.js', 'vendor/supabase-js-2.117.3.umd.js', 'vendor/xlsx-0.20.3.full.min.js', 'api/config.js', 'api/_authAdmin.js', 'api/oauth/[...path].js', 'vercel.json', 'package.json', 'terms-of-use.html', 'privacy-policy.html', 'data-compliance.html', 'etcher-logo-white-520.png', 'favicon-128.png', 'Etcher_Logo_2026.png', 'taskhub_gcs_tracker_import.json'];
    const leaked = mustGo.filter(f => !ignored(f)), lost = mustStay.filter(f => ignored(f));
    ok(pats.length > 0 && leaked.length === 0, 'the live site no longer publishes migrations, docs, the dev server, the email-intake service, setup notes or env files (' + (leaked.join(', ') || 'none published') + ')');
    ok(lost.length === 0, 'and everything the app needs is still uploaded: the page, the sign-in library, the server functions, the legal pages, the images (' + (lost.join(', ') || 'none lost') + ')');
    const fromGit = require('child_process').execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    // iso/ only exists on branches that still carry the ISO module; where it does, all of it is served.
    const needed = fromGit.filter(f => /^(api\/|vendor\/|iso\/)|^[^/]+\.(html|js|png|json)$/.test(f) && !/^(serve|email-intake)\.mjs$/.test(f));
    const neededLost = needed.filter(ignored);
    ok(needed.length > 20 && neededLost.length === 0, 'no tracked page, script, image or server function the site serves is excluded (' + needed.length + ' checked' + (neededLost.length ? ', excluded: ' + neededLost.join(', ') : '') + ')');
  }

  // ── emails link to the real https address when APP_URL is not set ──
  {
    const saved = { fetch: global.fetch, key: process.env.RESEND_API_KEY, url: process.env.APP_URL };
    let body = '';
    global.fetch = async (u, o) => { body = o.body; return { ok: true, json: async () => ({ id: 'x' }), text: async () => '' }; };
    process.env.RESEND_API_KEY = 'test-key'; delete process.env.APP_URL;
    delete require.cache[require.resolve(path.join(ROOT, 'api', '_email.js'))];
    const { sendNotificationEmail } = require(path.join(ROOT, 'api', '_email.js'));
    await sendNotificationEmail({ to: 'a@b.test', recipientName: 'A', type: 'mention', message: 'hello', senderName: 'B' });
    global.fetch = saved.fetch; if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key; if (saved.url !== undefined) process.env.APP_URL = saved.url;
    ok(body.includes('https://taskhub.etchersolutions.com') && !body.includes('vercel.app'), 'notification emails link to https://taskhub.etchersolutions.com when APP_URL is not set');
  }

  // ── the live site's /api/config ──
  {
    const saved = process.env.MICROSOFT_SIGNIN;
    const run = () => { delete require.cache[require.resolve(path.join(ROOT, 'api', 'config.js'))]; const h = require(path.join(ROOT, 'api', 'config.js')); let out; h({}, { setHeader() {}, status() { return this; }, json(b) { out = b; return this; } }); return out; };
    delete process.env.MICROSOFT_SIGNIN; const off = run();
    process.env.MICROSOFT_SIGNIN = '1'; const on = run();
    if (saved === undefined) delete process.env.MICROSOFT_SIGNIN; else process.env.MICROSOFT_SIGNIN = saved;
    ok(off.microsoftSignIn === false && on.microsoftSignIn === true, 'the live /api/config offers Microsoft sign-in only when MICROSOFT_SIGNIN=1 (off: ' + off.microsoftSignIn + ', on: ' + on.microsoftSignIn + ')');
  }

  // ── the dev server ──
  const A = 3251, B = 3252, made = [];
  const probe = (rel, content) => { const f = path.join(ROOT, rel); if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); made.push(f); } };
  probe('appdata.json', '{"probe":true}');
  probe('.probe-secret', 'probe');
  const sA = start(['--offline'], A, { MICROSOFT_SIGNIN: '1' });
  try {
    await sA.ready;
    const home = await getRes(A, '/');
    ok(Object.entries(want).every(([k, v]) => home.headers[k.toLowerCase()] === v), 'the dev server sends the same security headers as the live site');
    for (const p of ['/.probe-secret', '/.gitattributes', '/%2Egitattributes', '/.agents/_static-offline.cjs', '/appdata.json', '/supabase/004_email_intake.sql']) {
      const s = await status('127.0.0.1', A, p);
      ok(s === 404, 'the dev server never serves ' + p + ' (got ' + s + ')');
    }
    for (const p of ['/', '/index.html', '/supabase-client.js', '/vendor/supabase-js-2.117.3.umd.js', '/taskhub_gcs_tracker_import.json']) {
      const s = await status('127.0.0.1', A, p);
      ok(s === 200, 'the dev server still serves ' + p + ' (got ' + s + ')');
    }
    const cfg = JSON.parse((await getRes(A, '/api/config')).body);
    ok(cfg.supabaseUrl === '' && cfg.microsoftSignIn === false, 'offline, the dev server never offers Microsoft sign-in, even with MICROSOFT_SIGNIN=1');
    const ip = lanIp();
    if (ip) {
      const s = await status(ip, A, '/');
      ok(s === 0, 'the dev server answers on this machine only, not on the network address ' + ip + ' (got ' + s + ')');
      const sB = start(['--offline', '--lan'], B);
      try { await sB.ready; const s2 = await status(ip, B, '/'); ok(s2 === 200, 'with --lan it does answer on the network address (so the check above can tell) (got ' + s2 + ')'); }
      finally { await stop(sB.proc); }
    } else {
      ok(true, 'no network interface on this machine to test the bind address against (skipped)');
    }
  } catch (e) { fail.push('server part crashed: ' + (e && e.message || e)); }
  finally { await stop(sA.proc); made.forEach(f => { try { fs.rmSync(f, { force: true }); } catch (_) {} }); }

  // ── the Microsoft button in the page ──
  const PORT = 3253;
  const cfgs = { on: { supabaseUrl: 'http://127.0.0.1:9', supabaseAnonKey: 'anon-test', microsoftSignIn: true }, off: { supabaseUrl: 'http://127.0.0.1:9', supabaseAnonKey: 'anon-test', microsoftSignIn: false }, offline: { supabaseUrl: '', supabaseAnonKey: '', microsoftSignIn: true } };
  for (const [name, config] of Object.entries(cfgs)) {
    const srv = await H.serve(PORT, { config }), b = await H.launch();
    try {
      const { page: p } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/', { login: false });
      await H.sleep(800);
      const r = await p.evaluate(async () => {
        // Something may ask for the button to be redrawn later (e.g. after a config reload): offline, with no sign-in
        // service, it must still stay hidden even when the flag says on.
        if (!window._supabase && typeof _updateMicrosoftSignIn === 'function') { window._microsoftSignIn = true; _updateMicrosoftSignIn(); }
        const btn = document.getElementById('login-ms');
        const shown = !!btn && getComputedStyle(btn).display !== 'none';
        let args = null;
        if (shown && window._supabase) { window._supabase.auth.signInWithOAuth = async a => { args = a; return { data: {}, error: null }; }; btn.click(); await new Promise(r => setTimeout(r, 100)); }
        return { shown, args };
      });
      if (name === 'on') {
        ok(r.shown, 'with MICROSOFT_SIGNIN on, the login page shows "Sign in with Microsoft"');
        ok(!!r.args && r.args.provider === 'azure' && r.args.options && r.args.options.redirectTo === 'http://127.0.0.1:' + PORT + '/', 'it starts the Microsoft (Azure) sign-in and comes back to this site (' + JSON.stringify(r.args) + ')');
      } else if (name === 'off') ok(!r.shown, 'with it off, the button is hidden');
      else ok(!r.shown, 'offline (no sign-in service), the button is hidden even if the flag says on');
      await p.close();
    } catch (e) { fail.push('browser part (' + name + ') crashed: ' + (e && e.message || e)); }
    finally { await b.close(); srv.stop(); }
  }
  H.report('sec-a-test', pass, fail);
})();
