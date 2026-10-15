// Local client preview login (2026-10-15): on this machine with no Supabase, a client signs in with their login
// or contact email and the local preview password to check their portal. Never with Supabase present, never
// with a staff password, never for a client whose portal is off. Own offline server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('client-preview-login-test', 3181, async (t) => {
  const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 900 } });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fresh = async () => { await p.goto('http://127.0.0.1:3181/', { waitUntil: 'networkidle2' }); await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }); await p.goto('http://127.0.0.1:3181/', { waitUntil: 'networkidle2' }); await sleep(900); };
  const login = async (email, pw) => { await p.evaluate((e, w) => { document.getElementById('login-email').value = e; document.getElementById('login-password').value = w; }, email, pw); await p.evaluate(() => doLogin()); await sleep(1200); };
  const state = () => p.evaluate(() => ({ portal: !document.getElementById('client-portal').classList.contains('hidden'), who: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.clientId : null, err: (document.getElementById('login-error-text') || {}).textContent || '' }));
  try {
    await fresh();
    await login('client@generalcranes.com.au', 'ClientPreview1');
    let s = await state();
    t.ok(s.portal && s.who === 'c1', 'General Cranes signs in to its portal with the local preview password');
    t.ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('etcher_session_v1') || '{}').clientId), 'the client session is saved like any local session');
    await fresh();
    await login('john@generalcranes.com.au', 'ClientPreview1');
    s = await state();
    t.ok(s.portal && s.who === 'c1', 'the contact email works too');
    await fresh();
    await login('client@generalcranes.com.au', 'TaskHub123');
    s = await state();
    t.ok(!s.portal && /Invalid email or password/.test(s.err), 'a wrong password is refused like any other');
    await fresh();
    await p.evaluate(() => { const c = DB.clients.find(x => x.id === 'c1'); c.portalEnabled = false; });
    await login('client@generalcranes.com.au', 'ClientPreview1');
    s = await state();
    t.ok(!s.portal && /portal is off for General Cranes/.test(s.err), 'a client whose portal is off is told so, not signed in');
    t.ok(await p.evaluate(() => { const was = window._supabase; window._supabase = {}; const r = _localClientPreviewAllowed(); window._supabase = was; return r === false; }), 'the preview login is closed whenever Supabase is present');
    t.ok(await p.evaluate(() => { try { localStorage.setItem('etcher_local_auth', '1'); } catch (e) {} return typeof _localClientPreviewAllowed === 'function' && /localhost/.test(String(_localClientPreviewAllowed)) && !/etcher_local_auth/.test(String(_localClientPreviewAllowed)); }), 'only the hostname opens it: the etcher_local_auth flag does not');
    t.ok(errs.length === 0, 'no page errors (' + errs.slice(0, 2).join(' | ') + ')');
  } finally { await b.close(); }
});
