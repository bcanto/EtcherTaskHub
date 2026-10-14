// ISO landing ("All ISO boards"), redesigned to match the board (2026-10-06): one white card — header
// with counts (overdue in red), search + filter chips, boards grouped by client, each row reading like
// a board header (standard tags, title, ref · stage, per-standard "done /total" + status bar, report
// due). metric.portfolio's new status_by_audit feeds the bars. Fresh offline temp server.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3164;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
async function callIso(user, body) {
  const headers = { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) };
  const r = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}
const ADMIN = { id: 'u1', role: 'admin' };
const data = res => res.body && res.body.data;
function report() {
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}
const iso = d => d.toISOString().slice(0, 10);

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-land-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const xss = `Readiness <img src=x onerror="window.__xss=1">`;
    const b1 = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: 'ISO 9001/14001' }));
    const b2 = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: xss }));
    const b3 = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c2', standards: ['45001'], title: 'ISO 45001' }));
    const upd = async (b, patch) => { const cur = data(await callIso(ADMIN, { op: 'audit.get', auditId: b.id })); const a = cur.audit || cur; const r = await callIso(ADMIN, { op: 'audit.update', auditId: b.id, expectedVersion: a.row_version, patch }); if (r.status !== 200) throw new Error('upd ' + JSON.stringify(r.body)); };
    const now = Date.now();
    await upd(b1, { report_due: iso(new Date(now + 5 * 86400000)) });   // due soon
    await upd(b2, { report_due: iso(new Date(now - 10 * 86400000)) });  // overdue
    await upd(b3, { report_due: iso(new Date(now + 60 * 86400000)) });  // later
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: b1.id })) || [];
    const setSt = async (r, st) => { const cur = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: b1.id })) || []).find(x => x.id === r.id); await callIso(ADMIN, { op: 'requirement.update', auditId: b1.id, id: r.id, expectedVersion: cur.row_version, patch: { compliance_status: st } }); };
    const r9 = reqs.filter(r => r.standard_code === '9001'), r14 = reqs.filter(r => r.standard_code === '14001');
    await setSt(r9[0], 'compliant'); await setSt(r9[1], 'non_compliant'); await setSt(r14[0], 'ofi');

    // API: status_by_audit
    const pm = data(await callIso(ADMIN, { op: 'metric.portfolio' }));
    const s1 = pm.status_by_audit && pm.status_by_audit[b1.id];
    ok(s1 && s1['9001'].total === r9.length && s1['9001'].counts.compliant === 1 && s1['9001'].counts.non_compliant === 1 && s1['14001'].counts.compliant === 1 && s1['9001'].counts.not_assessed === r9.length - 2, `metric.portfolio counts each board's clauses per standard and status (got ${JSON.stringify(s1 && s1['9001'])})`);

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 } });
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' }); await sleep(900);
    await page.type('#login-email', 'b.canto@etchersolutions.com'); await page.type('#login-password', 'TaskHub123'); await page.keyboard.press('Enter');
    await sleep(1800);
    await page.evaluate(() => ISO.openLanding()); await sleep(2200);

    const L = await page.evaluate(() => ({
      card: !!document.querySelector('.iso-landing.iso-app > header.iso-app-h + main.iso-app-main'),
      title: document.querySelector('.iso-landing .iso-board-title')?.textContent.trim(),
      meta: document.getElementById('iso-landing-meta')?.textContent.replace(/\s+/g, ' ').trim(),
      late: document.querySelector('#iso-landing-meta .iso-land-late')?.textContent.trim(),
      newBtn: document.querySelector('.iso-landing-head button')?.textContent.trim(),
      chips: [...document.querySelectorAll('.iso-land-toolbar .iso-fchip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
      groups: [...document.querySelectorAll('.iso-land-gh')].map(h => h.childNodes[0].textContent.trim()),
      rows: [...document.querySelectorAll('.iso-land-row')].map(r => ({ id: r.dataset.audit, t: r.querySelector('.iso-land-t')?.textContent, tags: [...r.querySelectorAll('.iso-land-tags .iso-tag')].map(t => t.textContent).join(''), prog: [...r.querySelectorAll('.iso-ps-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), due: r.querySelector('.iso-land-due')?.textContent.trim(), late: r.querySelector('.iso-land-due')?.classList.contains('is-late'), img: !!r.querySelector('img') })),
      oldTable: !!document.querySelector('#iso-portfolio-table table'),
      xss: window.__xss || 0,
    }));
    ok(L.card && !L.oldTable, 'the landing is one card like a board, no bare table');
    ok(L.title === 'ISO audits' && /^3 active boards · 2 clients · 1 report overdue · 1 due in 14 days$/.test(L.meta) && L.late === '1 report overdue', `the header counts boards and clients, overdue in its own mark (got ${JSON.stringify([L.meta, L.late])})`);
    ok(L.newBtn === '+ New ISO board', `+ New ISO board stays in the header (got ${L.newBtn})`);
    ok(JSON.stringify(L.chips) === JSON.stringify(['Active 3', 'Report due soon 1', 'Overdue 1', 'Closed 0', 'All 3']), `chips with counts (got ${JSON.stringify(L.chips)})`);
    ok(L.groups.length === 2, `boards are grouped by client (got ${JSON.stringify(L.groups)})`);
    const row1 = L.rows.find(r => r.id === b1.id), row2 = L.rows.find(r => r.id === b2.id);
    ok(row1 && row1.t === 'Gap analysis' && row1.tags === 'QE', `a default-titled board is named by its audit type, with its standard tags (got ${JSON.stringify(row1 && [row1.t, row1.tags])})`);
    ok(row1 && JSON.stringify(row1.prog) === JSON.stringify([`Q2 /${r9.length}`, `E1 /${r14.length}`]), `each row shows assessed/total per standard (got ${JSON.stringify(row1 && row1.prog)})`);
    ok(row2 && row2.late && /^Report overdue · /.test(row2.due) && row1 && !row1.late && /^Report due /.test(row1.due), `an overdue report is marked on its row (got ${JSON.stringify([row2 && row2.due, row1 && row1.due])})`);
    ok(row2 && row2.t === xss && !row2.img && !L.xss, 'a board title renders as text, never markup');

    await page.evaluate(() => ISO._landSetFilter('overdue')); await sleep(300);
    const ov = await page.evaluate(() => [...document.querySelectorAll('.iso-land-row')].map(r => r.dataset.audit));
    ok(JSON.stringify(ov) === JSON.stringify([b2.id]), `Overdue lists only the overdue board (got ${ov.length})`);
    await page.evaluate(() => ISO._landSetFilter('due_soon')); await sleep(300);
    const ds = await page.evaluate(() => [...document.querySelectorAll('.iso-land-row')].map(r => r.dataset.audit));
    ok(JSON.stringify(ds) === JSON.stringify([b1.id]), `Report due soon lists only the board due within 14 days (got ${ds.length})`);
    await page.evaluate(() => ISO._landSetFilter('all')); await page.evaluate(ref => ISO._landSetQuery(ref), b3.ref); await sleep(300);
    const sq = await page.evaluate(() => [...document.querySelectorAll('.iso-land-row')].map(r => r.dataset.audit));
    ok(JSON.stringify(sq) === JSON.stringify([b3.id]), `search finds a board by reference (got ${sq.length})`);
    await page.evaluate(() => ISO._landSetQuery('zzz-nothing')); await sleep(200);
    ok(await page.evaluate(() => /No boards match/.test(document.getElementById('iso-portfolio-table').textContent)), 'a search with no hits says so');
    await page.evaluate(() => ISO._landSetQuery('')); await sleep(200);
    // 2026-10-14: the client's logo (Client Manager stores it as a data URL) sits beside its name;
    // anything that is not image data or an http(s) link is never put into the page.
    const logo = await page.evaluate(async () => {
      const db = window._isoDB(), ids = [...new Set([...document.querySelectorAll('.iso-land-client')].map(b => b.dataset.cid))];
      const [good, bad] = ids.map(id => db.clients.find(c => c.id === id));
      good.logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (bad) bad.logo = 'javascript:alert(1)';
      ISO.openLanding(); await new Promise(r => setTimeout(r, 1800));
      const head = cid => document.querySelector(`.iso-land-client[data-cid="${cid}"]`).closest('.iso-land-gh');
      const out = { good: !!head(good.id).querySelector('img.iso-client-logo'), bad: bad ? !!head(bad.id).querySelector('img') : false };
      delete good.logo; if (bad) delete bad.logo;
      return out;
    });
    ok(logo.good && !logo.bad, `a client's logo shows beside its name, and a non-image logo value is never rendered (got ${JSON.stringify(logo)})`);
    await page.evaluate(() => ISO.openLanding()); await sleep(1500);

    await page.evaluate(id => document.querySelector(`.iso-land-row[data-audit="${id}"]`).click(), b1.id); await sleep(2200);
    ok(await page.evaluate(() => !!document.querySelector('.iso-app-h .iso-tabs')), 'a row opens its board');

    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => ISO.openLanding()); await sleep(1800);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(sw <= 0, `the landing fits a 390px phone with no sideways scroll (overflow ${sw}px)`);
    ok(errs.length === 0, `no page errors (got ${JSON.stringify(errs.slice(0, 3))})`);
  } catch (e) {
    fail.push('threw: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    proc.kill();
    report();
  }
})();
