// Phase 7b.6 acceptance (D14): "Send the Gantt" — the ISO Action plan tab's Export PDF button.
// export.gantt (server) decides which actions appear and how they're grouped; _ganttPdf (client,
// index.html) just draws whatever it's handed. Fresh offline temp server with its own
// ISO_OFFLINE_DIR, same convention as every other ISO suite this phase.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3137;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-gantt-pdf-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe',
  });
  let browser = null;
  try {
    await waitForServer(PORT);
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const sec = await db.insert('iso_clause_sections', { id: 'isec_1', version_id: 'iver_1', clause: '4', title: 'Context', level: 1, sort_key: 0 });
    await db.insert('iso_standard_versions', { id: 'iver_1', standard_code: '9001', label: 'Test v1', status: 'approved' });
    await db.insert('iso_library_requirements', { id: 'ilr_1', version_id: 'iver_1', section_id: sec.id, clause: '4.1', clause_name: 'Context', requirement_text: 'x', stable_key: '9001|4.1|abc|0', sort_key: 0 });

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
    page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.evaluateOnNewDocument(() => { window.__openCount = 0; const real = window.open; window.open = function () { window.__openCount++; return null; }; window.__realOpen = real; });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1200));
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1800));

    // ── Seed: one board, one client-visible action with a SENTINEL in a free-text field that
    // IS client-safe to prove it survives (description is in CLIENT_FIELDS.action — this isn't a
    // leak, it's content a client is meant to see), and one genuinely internal-only action whose
    // title itself carries a different SENTINEL that must never reach the client version. ────────
    const setup = await page.evaluate(async () => {
      const a = await ISO.api('audit.create', { clientId: 'c0', standards: ['9001'], title: 'Gantt PDF Test' });
      await ISO.api('audit.update', { auditId: a.id, patch: { client_portal_enabled: true }, expectedVersion: a.row_version, reason: 'test setup' });
      return a;
    });
    ok(!!setup.id, `a real ISO audit was created (got ${JSON.stringify({ id: setup.id, ref: setup.ref })})`);

    const SENTINEL_INTERNAL = 'SENTINEL-INTERNAL-' + Math.random().toString(36).slice(2, 8);
    const act1 = await db.insert('iso_actions', {
      id: 'iact_client1', audit_id: setup.id, client_id: 'c0', ref: setup.ref + '-A001', title: 'Replace the faulty gauge',
      owner_kind: 'etcher', status: 'in_progress', verification_status: 'not_verified', progress: 50, reopened_count: 0,
      visibility: 'client_all', root_cause_method: 'none', cause_categories: [], start_date: '2026-01-01', due_date: '2026-01-10',
    });
    const act2 = await db.insert('iso_actions', {
      id: 'iact_client2', audit_id: setup.id, client_id: 'c0', ref: setup.ref + '-A002', title: 'Update the risk register',
      owner_kind: 'etcher', status: 'verified', verification_status: 'effective', progress: 100, reopened_count: 0,
      visibility: 'client_selected', visible_to_uids: ['offline:cu1'], root_cause_method: 'none', cause_categories: [], due_date: '2026-01-20',
    });
    const act3 = await db.insert('iso_actions', {
      id: 'iact_internal1', audit_id: setup.id, client_id: 'c0', ref: setup.ref + '-A003', title: SENTINEL_INTERNAL,
      owner_kind: 'etcher', status: 'draft', verification_status: 'not_verified', progress: 0, reopened_count: 0,
      visibility: 'internal', root_cause_method: 'none', cause_categories: [], start_date: '2026-01-02', due_date: '2026-01-25',
    });
    ok(!!act1.id && !!act2.id && !!act3.id, 'three real actions seeded: two client-visible (one bar, one milestone), one internal-only');

    // ── export.gantt: client version includes exactly the two client-visible actions ───────────
    const clientExport = await page.evaluate((auditId) => ISO.api('export.gantt', { auditId, clientVersion: true, groupBy: 'standard' }), setup.id);
    const clientRows = (clientExport.sections || []).flatMap(s => s.rows || []);
    const clientRefs = clientRows.map(r => r.ref);
    ok(clientRefs.includes(setup.ref + '-A001') && clientRefs.includes(setup.ref + '-A002'), `the client version includes every client-visible action ref (got ${JSON.stringify(clientRefs)})`);
    ok(!clientRefs.includes(setup.ref + '-A003'), `the client version excludes the internal-only action (got ${JSON.stringify(clientRefs)})`);
    ok(!JSON.stringify(clientExport).includes(SENTINEL_INTERNAL), `the client version's own JSON payload never contains the internal action's SENTINEL title (checked server-side, before any PDF drawing) (payload: ${JSON.stringify(clientExport).slice(0, 300)})`);
    ok(clientRows.every(r => !('owner_uid' in r)), 'no row in the client export carries a raw owner_uid field at all');

    // ── export.gantt: internal version includes all three ─────────────────────────────────────
    const internalExport = await page.evaluate((auditId) => ISO.api('export.gantt', { auditId, clientVersion: false, groupBy: 'standard' }), setup.id);
    const internalRows = (internalExport.sections || []).flatMap(s => s.rows || []);
    const internalRefs = internalRows.map(r => r.ref);
    ok([setup.ref + '-A001', setup.ref + '-A002', setup.ref + '-A003'].every(r => internalRefs.includes(r)), `the internal version contains all three actions, including the internal-only one (got ${JSON.stringify(internalRefs)})`);
    ok(internalRows.some(r => r.name && r.name.includes(SENTINEL_INTERNAL)), 'the internal version\'s own row name legitimately includes the internal action\'s real title (it is allowed to, for staff)');

    // ── Real PDF build: stub jsPDF.prototype.save (and .text, to inspect what was actually drawn)
    // for BOTH versions, driven through the real _ganttPdf, not a hand-built fake model. ─────────
    const runPdf = async (exportData) => page.evaluate(async (data) => {
      let savedName = null, capturedText = [], barCount = 0, milestoneCount = 0;
      await new Promise((resolve, reject) => {
        _ensureJsPdf(() => {
          const RealJsPDF = window.jspdf.jsPDF;
          window.jspdf.jsPDF = function (...args) {
            const doc = new RealJsPDF(...args);
            const realText = doc.text.bind(doc);
            doc.text = (...a) => { capturedText.push(String(a[0])); return realText(...a); };
            const realRoundedRect = doc.roundedRect.bind(doc);
            doc.roundedRect = (...a) => { barCount++; return realRoundedRect(...a); };
            const realTriangle = doc.triangle.bind(doc);
            doc.triangle = (...a) => { milestoneCount++; return realTriangle(...a); };
            doc.save = (name) => { savedName = name; resolve(); };
            return doc;
          };
          try { _ganttPdf({ sections: data.sections }, { clientName: data.clientName, ref: data.ref, title: data.title, dataAsAt: data.dataAsAt, clientVersion: data.clientVersion }); }
          catch (e) { reject(e); }
        }, () => reject(new Error('jsPDF failed to load')));
      });
      return { savedName, capturedText, barCount, milestoneCount };
    }, exportData);

    const clientPdf = await runPdf(clientExport);
    ok(!!clientPdf.savedName && clientPdf.savedName.endsWith('.pdf'), `the client PDF saves with a real .pdf filename (got ${JSON.stringify(clientPdf.savedName)})`);
    ok(clientPdf.capturedText.some(t => t.includes(setup.ref + '-A001')) && clientPdf.capturedText.some(t => t.includes(setup.ref + '-A002')), `the client PDF's drawn text includes every client-visible action ref (got ${JSON.stringify(clientPdf.capturedText)})`);
    ok(!clientPdf.capturedText.some(t => t.includes(SENTINEL_INTERNAL)), 'the client PDF\'s drawn text never includes the internal action\'s SENTINEL title');
    ok(!clientPdf.capturedText.some(t => t.includes(setup.ref + '-A003')), 'the client PDF\'s drawn text never includes the internal-only action\'s ref either');
    // One bar (A001, has start+end) drawn via roundedRect (the bar itself; progress>0 draws a
    // second roundedRect for the fill, so 2 calls for that one dated-range row) + one milestone
    // (A002, due_date only) drawn via two triangle() calls (the diamond is two triangles).
    ok(clientPdf.barCount >= 1, `at least one bar was actually drawn via roundedRect for the one dated-range client action (got ${clientPdf.barCount})`);
    ok(clientPdf.milestoneCount === 2, `the one milestone-only client action (due date, no start) draws its diamond as exactly 2 triangle() calls (got ${clientPdf.milestoneCount})`);

    const internalPdf = await runPdf(internalExport);
    ok(internalPdf.capturedText.some(t => t.includes(SENTINEL_INTERNAL)), `the internal PDF legitimately draws the internal action's real title (got ${JSON.stringify(internalPdf.capturedText)})`);
    ok([setup.ref + '-A001', setup.ref + '-A002', setup.ref + '-A003'].every(ref => internalPdf.capturedText.some(t => t.includes(ref))), 'the internal PDF\'s drawn text includes all three action refs');

    // ── window.open trap: neither version, nor any ISO code path, ever opens a tab (hard rule 13 —
    // a PDF export is always a download via doc.save, never window.open). ──────────────────────────
    ok((await page.evaluate(() => window.__openCount)) === 0, 'window.open was never called through the whole flow (both PDF builds)');
    const srcGrep = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'latin1');
    const isoSrcGrep = require('fs').readFileSync(path.join(ROOT, 'iso', 'iso-core.js'), 'utf8');
    ok(!/_ganttPdf[\s\S]{0,2000}window\.open/.test(srcGrep.slice(srcGrep.indexOf('function _ganttPdf('), srcGrep.indexOf('function _ganttPdf(') + 6000)), 'the _ganttPdf function body itself never calls window.open');
    ok(!isoSrcGrep.includes('window.open('), 'iso-core.js never calls window.open anywhere');

    ok(errs.length === 0, `no console errors or unexpected native dialogs through the whole flow (got ${JSON.stringify(errs.slice(0, 10))})`);

  } catch (e) {
    console.error('CRASHED', e);
    fail.push('the suite crashed: ' + e.message);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
