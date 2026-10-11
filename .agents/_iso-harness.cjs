// Shared harness for ISO suites (release-1 plan B0.2). Every new ISO suite uses this instead of
// re-implementing the ~60 lines each older suite carries: an isolated offline server on its own port
// and temp store, the v3 library seeded, boards created, statuses set with row_version handled, a
// logged-in browser, screenshots at desktop and phone width, page-error capture, and the
// PASS (n): / FAIL (n): report gate.sh parses. Older suites are left as they are.
//
//   const H = require('./_iso-harness.cjs');
//   H.run('iso-something-test', 3170, async (t, srv) => {
//     const board = await srv.board({ standards: ['9001', '14001'] });
//     await srv.set(board, '9001 4.1', { compliance_status: 'compliant', current_system: 'Seen.' });
//     t.ok(cond, 'message');
//     const ui = await t.browser();            // logged in as the seeded admin
//     await ui.openBoard(board.id); await ui.tab('requirements');
//   });
//
// Hard rule 1: the server is always `serve.mjs --offline` with its own ISO_OFFLINE_DIR.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUPPETEER = 'C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOGIN = { email: 'b.canto@etchersolutions.com', password: 'TaskHub123' }; // index.html SEED admin (u1)
const SHOT_DIR = path.join(__dirname, 'shots');

const ADMIN = { id: 'u1', role: 'admin' };
const STAFF = id => ({ id, role: 'staff' });
const CLIENT = (id, clientId) => ({ id, role: 'client', clientId });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// opts.dir reuses a store (two servers in turn over one store); opts.env adds env vars (offline only).
async function startOffline(port, opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'iso-h-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(port)], { cwd: ROOT, env: { ...process.env, ...(opts.env || {}), ISO_OFFLINE_DIR: dir }, stdio: 'pipe' });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/api/config`)).ok; } catch (e) { await sleep(100); }
  }
  if (!up) { proc.kill(); throw new Error(`offline server on :${port} did not come up`); }
  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  if (cfg.supabaseUrl) { proc.kill(); throw new Error('server is not offline — refusing to continue (hard rule 1)'); }

  async function call(user, body) {
    const headers = { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) };
    const r = await fetch(`http://127.0.0.1:${port}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, body: json, data: json && json.data, error: json && json.error };
  }
  // Throws on a non-200 so setup mistakes surface as a crash, not a silent wrong fixture.
  async function must(user, body) {
    const r = await call(user, body);
    if (r.status !== 200) throw new Error(`${body.op} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.data;
  }
  await call(ADMIN, { op: 'config.get' }); // warm the store deterministically

  const srv = {
    port, dir, call, must, ADMIN,
    async seed() { return must(ADMIN, { op: 'library.loadSeed' }); },
    // Creates a board (seeding the library first if needed); returns the audit with .reqs and .key(k).
    async board(opts = {}) {
      if (!srv._seeded) { await srv.seed(); srv._seeded = true; }
      const a = await must(ADMIN, { op: 'audit.create', clientId: opts.clientId || 'c1', standards: opts.standards || ['9001'], title: opts.title || 'ISO ' + (opts.standards || ['9001']).join('/'), ...(opts.extra || {}) });
      for (const m of opts.members || []) await must(ADMIN, { op: 'member.add', auditId: a.id, uid: 'offline:' + m.id, auditRole: m.auditRole || 'auditor' });
      await srv.refresh(a);
      return a;
    },
    async refresh(a) {
      a.reqs = await must(ADMIN, { op: 'requirement.list', auditId: a.id });
      const byKey = new Map(a.reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
      a.key = k => { const r = byKey.get(k); if (!r) throw new Error(`no clause "${k}" on ${a.ref}`); return r; };
      return a;
    },
    // Patches one requirement by "9001 4.1" key or id, reading the current row_version first.
    async set(a, keyOrId, patch, user = ADMIN) {
      const id = keyOrId.startsWith('ireq_') ? keyOrId : a.key(keyOrId).id;
      const cur = (await must(ADMIN, { op: 'requirement.list', auditId: a.id })).find(r => r.id === id);
      return call(user, { op: 'requirement.update', auditId: a.id, id, expectedVersion: cur.row_version, patch });
    },
    async row(a, keyOrId) {
      const id = keyOrId.startsWith('ireq_') ? keyOrId : a.key(keyOrId).id;
      return (await must(ADMIN, { op: 'requirement.list', auditId: a.id })).find(r => r.id === id);
    },
    stop() { try { proc.kill(); } catch (e) {} },
  };
  return srv;
}

async function browser(port, opts = {}) {
  const puppeteer = require(PUPPETEER);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: opts.width || 1440, height: opts.height || 1000 } });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { errors.push('native dialog: ' + d.message()); try { await d.dismiss(); } catch (e) {} });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2' }); await sleep(900);
  await page.type('#login-email', opts.email || LOGIN.email); await page.type('#login-password', opts.password || LOGIN.password); await page.keyboard.press('Enter');
  await sleep(1800);
  const ui = {
    page, errors,
    eval: (fn, ...args) => page.evaluate(fn, ...args),
    async openBoard(id, wait = 2200) { await page.evaluate(x => ISO.openBoard(x), id); await sleep(wait); },
    async tab(t, wait = 1800) { await page.evaluate(x => ISO.setTab(x), t); await sleep(wait); },
    async landing(wait = 2000) { await page.evaluate(() => ISO.openLanding()); await sleep(wait); },
    async size(width, height) { await page.setViewport({ width, height: height || (width < 500 ? 844 : 1000) }); await sleep(500); },
    async overflow() { return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); },
    // Desktop + phone screenshots into .agents/shots/ (gitignored); restores the desktop size after.
    // Returns the sideways-scroll overflow at each width (0 = fits).
    async shot(name) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
      const desktop = await ui.overflow();
      const vp = page.viewport();
      await ui.size(390, 844); await page.screenshot({ path: path.join(SHOT_DIR, name + '-390.png'), fullPage: true });
      const phone = await ui.overflow();
      await ui.size(vp.width, vp.height);
      return { desktop, phone };
    },
    close: () => b.close(),
  };
  return ui;
}

// Runs one suite: own server, collected results, always reports and cleans up — a crash is a FAIL.
function run(name, port, fn) {
  const pass = [], fail = [];
  const browsers = [];
  let srv = null;
  const t = {
    ok: (c, m) => (c ? pass.push(m) : fail.push(m)),
    eq: (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? pass.push(m) : fail.push(`${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)),
    sleep,
    browser: async opts => { const b = await browser(port, opts); browsers.push(b); return b; },
  };
  (async () => {
    try {
      srv = await startOffline(port);
      await fn(t, srv);
      for (const b of browsers) if (b.errors.length) fail.push(`no page errors or native dialogs (got ${JSON.stringify(b.errors.slice(0, 3))})`);
    } catch (e) {
      fail.push('the suite crashed: ' + (e && e.stack || e));
    } finally {
      for (const b of browsers) { try { await b.close(); } catch (e) {} }
      if (srv) srv.stop();
      console.log(`\n${name}`);
      console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
      console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
      process.exit(fail.length ? 1 : 0);
    }
  })();
}

module.exports = { run, startOffline, browser, sleep, ADMIN, STAFF, CLIENT, LOGIN, ROOT };
