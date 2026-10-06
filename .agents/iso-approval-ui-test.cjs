// R2/D41 (P7) Lead Auditor sign-off, in the redesigned Clauses view — the UI half R2 left as a
// known gap (its API ops are covered in iso-review-test/iso-logic-test). An auditor proposes statuses;
// the Lead sees them on Overview's sign-off banner and under "Awaiting your approval", signs off one
// section, returns one row with a note, then approves the rest with "Approve all". A sole auditor sees
// none of the approval machinery (statuses are final on entry). Fresh offline temp server.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3163;
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
const AUD = { id: 'u2', role: 'staff' };
const data = res => res.body && res.body.data;
function report() {
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-appr-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: 'Approval board' }));
    const sole = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Sole board' }));
    await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:' + AUD.id, auditRole: 'auditor' });
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const byKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
    const get = async id => (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).find(r => r.id === id);
    const propose = async (key, status) => {
      const cur = await get(byKey.get(key).id);
      const res = await callIso(AUD, { op: 'requirement.update', auditId: board.id, id: cur.id, expectedVersion: cur.row_version, patch: { compliance_status: status } });
      if (res.status !== 200) throw new Error('propose ' + key + ' ' + JSON.stringify(res.body));
    };
    // Section 4 (three clauses across both standards) and one in section 5.
    await propose('9001 4.1', 'compliant');
    await propose('14001 4.1', 'compliant');
    await propose('9001 4.2', 'partially_compliant');
    await propose('9001 5.1.1', 'compliant');
    const proposedIds = ['9001 4.1', '14001 4.1', '9001 4.2', '9001 5.1.1'].map(k => byKey.get(k).id);
    ok((await Promise.all(proposedIds.map(get))).every(r => r.approval_state === 'proposed'), 'setup: an auditor\'s statuses arrive as proposed');

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 } });
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', async d => { errs.push('native dialog: ' + d.message()); await d.dismiss(); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' }); await sleep(900);
    await page.type('#login-email', 'b.canto@etchersolutions.com'); await page.type('#login-password', 'TaskHub123'); await page.keyboard.press('Enter');
    await sleep(1800);
    await page.evaluate(id => ISO.openBoard(id), board.id); await sleep(2200);

    // Overview: the sign-off banner is the Lead's inbox.
    const banner = await page.evaluate(() => ({ t: document.querySelector('.iso-ov-signoff strong')?.textContent.trim(), btn: !!document.querySelector('.iso-ov-signoff-btn') }));
    ok(banner.t === '4 statuses ready for your sign-off' && banner.btn, `Overview tells the Lead how many statuses wait for sign-off (got ${JSON.stringify(banner)})`);
    await page.evaluate(() => document.querySelector('.iso-ov-signoff-btn').click()); await sleep(2200);
    const landed = await page.evaluate(() => ({
      tab: document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab,
      chip: document.querySelector('.iso-clause-toolbar .iso-fchip.is-on')?.textContent.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('#iso-req-tab [data-ireq]')].map(r => r.dataset.ireq),
      all: [...document.querySelectorAll('.iso-clause-toolbar .btn')].map(b => b.textContent.trim()),
    }));
    ok(landed.tab === 'requirements' && landed.chip === 'Awaiting your approval 4', `"Review and sign off" opens Clauses on Awaiting your approval (got ${JSON.stringify(landed)})`);
    ok(landed.rows.length === 4 && proposedIds.every(id => landed.rows.includes(id)), `exactly the four proposed clauses are listed (got ${landed.rows.length})`);
    ok(landed.all.includes('✓ Approve all 4'), `the toolbar offers "✓ Approve all 4" on this view only (got ${JSON.stringify(landed.all)})`);

    // Approve section on section 4 → its three proposed rows, one request.
    const secBtns = await page.evaluate(() => [...document.querySelectorAll('.iso-clause-section-hdr .btn')].map(b => b.textContent.trim()));
    ok(secBtns.includes('Approve section (3)') && secBtns.includes('Approve section (1)'), `each section offers to approve its own proposed rows (got ${JSON.stringify(secBtns)})`);
    await page.evaluate(() => [...document.querySelectorAll('.iso-clause-section-hdr .btn')].find(b => b.textContent.trim() === 'Approve section (3)').click());
    await sleep(2000);
    const afterSec = await Promise.all(proposedIds.map(get));
    ok(afterSec.slice(0, 3).every(r => r.approval_state === 'approved' && r.approved_by) && afterSec[3].approval_state === 'proposed', `Approve section signs off that section only (got ${JSON.stringify(afterSec.map(r => r.approval_state))})`);
    const chipAfter = await page.evaluate(() => document.querySelector('.iso-clause-toolbar .iso-fchip.is-on')?.textContent.replace(/\s+/g, ' ').trim());
    ok(chipAfter === 'Awaiting your approval 1', `the chip count drops to what is left (got ${chipAfter})`);

    // Return the last one with a note: the app's own prompt, never a native dialog.
    const lastId = proposedIds[3];
    await page.evaluate(id => ISO._reqToggleExpand(id), lastId); await sleep(500);
    const footBtns = await page.evaluate(id => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-clause-foot .iso-sr-btn`)].map(b => b.textContent.trim()), lastId);
    ok(JSON.stringify(footBtns) === '["Approve","Return"]', `an open proposed row carries Approve and Return in its footer (got ${JSON.stringify(footBtns)})`);
    await page.evaluate(id => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-clause-foot .iso-sr-btn`)].find(b => b.textContent.trim() === 'Return').click(), lastId);
    await sleep(400);
    const promptShown = await page.evaluate(() => !!document.getElementById('sp-val') && !document.getElementById('generic-modal').classList.contains('hidden'));
    ok(promptShown, 'Return asks for the note in the app\'s own prompt');
    const note = 'Check the leadership <b>minutes</b> for 2026';
    await page.type('#sp-val', note); await page.keyboard.press('Enter'); await sleep(2000);
    const ret = await get(lastId);
    ok(ret.approval_state === 'returned' && ret.return_note === note, `the row is returned with the Lead's note (got ${JSON.stringify([ret.approval_state, ret.return_note])})`);
    await page.evaluate(() => ISO._reqSetView('returned')); await sleep(400);
    const retView = await page.evaluate(id => ({
      rows: [...document.querySelectorAll('#iso-req-tab [data-ireq]')].map(r => r.dataset.ireq),
      ico: !!document.querySelector(`[data-ireq="${id}"] .iso-ap-ico.is-returned`),
      banner: document.querySelector(`[data-ireq="${id}"] .iso-sr-note.is-redo`)?.textContent.replace(/\s+/g, ' ') || '',
      bold: !!document.querySelector(`[data-ireq="${id}"] .iso-sr-note b`),
    }), lastId);
    ok(retView.rows.length === 1 && retView.rows[0] === lastId && retView.ico, `the Returned chip lists it, marked ↺ on its row (got ${JSON.stringify(retView)})`);
    ok(retView.banner.includes(note) && !retView.bold, `the open row shows the return note as plain text, never markup (got ${JSON.stringify(retView.banner)})`);

    // The auditor re-proposes; the Lead clears the queue with Approve all.
    await propose('9001 5.1.1', 'partially_compliant'); // re-assessed after the note
    await propose('14001 4.2', 'non_compliant');
    await page.evaluate(() => ISO.setTab('requirements')); await sleep(2000);
    await page.evaluate(() => ISO._reqSetView('approval_awaiting')); await sleep(400);
    const allBtn = await page.evaluate(() => [...document.querySelectorAll('.iso-clause-toolbar .btn')].find(b => /Approve all/.test(b.textContent))?.textContent.trim());
    ok(allBtn === '✓ Approve all 2', `Approve all counts the re-proposed and the new row (got ${allBtn})`);
    await page.evaluate(() => [...document.querySelectorAll('.iso-clause-toolbar .btn')].find(b => /Approve all/.test(b.textContent)).click()); await sleep(2000);
    const final = await Promise.all([lastId, byKey.get('14001 4.2').id].map(get));
    ok(final.every(r => r.approval_state === 'approved'), `Approve all signs off everything awaiting (got ${JSON.stringify(final.map(r => r.approval_state))})`);
    const emptyBtn = await page.evaluate(() => [...document.querySelectorAll('.iso-clause-toolbar .btn')].some(b => /Approve all/.test(b.textContent)));
    ok(!emptyBtn, 'with nothing left, Approve all disappears');
    await page.evaluate(() => ISO._reqSetView('all')); await sleep(300);
    const outside = await page.evaluate(() => ({ sec: document.querySelectorAll('.iso-clause-section-hdr .btn').length, all: [...document.querySelectorAll('.iso-clause-toolbar .btn')].length }));
    ok(outside.sec === 0 && outside.all === 0, `outside Awaiting approval there are no standing approve buttons (got ${JSON.stringify(outside)})`);
    await page.evaluate(() => ISO.setTab('dashboard')); await sleep(2200);
    const quiet = await page.evaluate(() => document.querySelector('.iso-ov-signoff.is-quiet strong')?.textContent.trim());
    ok(quiet === 'Everything proposed is signed off.', `Overview goes quiet once nothing waits (got ${quiet})`);

    // A sole auditor: no approval chips, no sign-off banner (D41).
    await page.evaluate(id => ISO.openBoard(id), sole.id); await sleep(2200);
    const soleOv = await page.evaluate(() => !!document.querySelector('.iso-ov-signoff'));
    ok(!soleOv, 'a sole auditor sees no sign-off banner — statuses are final on entry');
    await page.evaluate(() => ISO.setTab('requirements')); await sleep(2000);
    const soleChips = await page.evaluate(() => [...document.querySelectorAll('.iso-clause-toolbar .iso-fchip')].map(c => c.textContent.replace(/\s*\d+$/, '').trim()));
    ok(JSON.stringify(soleChips) === '["All","Not assessed","Needs action"]', `a sole auditor gets only All / Not assessed / Needs action (got ${JSON.stringify(soleChips)})`);
    ok(errs.length === 0, `no page errors or native dialogs (got ${JSON.stringify(errs.slice(0, 3))})`);
  } catch (e) {
    fail.push('threw: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    proc.kill();
    report();
  }
})();
