// Phase 8.1/8.2a acceptance (plan §5.4, D18): links-first evidence. evidence.addLink/evidence.list
// (server, api/_iso.js) + the requirement/finding/action drawers' new Evidence panel (iso-core.js).
// File upload (8.2) and the full per-link review workflow/Evidence tab (8.3) are later phases, not
// tested here — see A59. Fresh offline temp server with its own ISO_OFFLINE_DIR, same convention
// as every other ISO suite this phase.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3138;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-evidence-'));
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

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1200));
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1800));

    const setup = await page.evaluate(async () => {
      const a = await ISO.api('audit.create', { clientId: 'c0', standards: ['9001'], title: 'Evidence Test' });
      return a;
    });
    ok(!!setup.id, `a real ISO audit was created (got ${JSON.stringify({ id: setup.id, ref: setup.ref })})`);

    const req = await db.insert('iso_requirements', {
      id: 'ireq_1', audit_id: setup.id, client_id: 'c0', standard_code: '9001', clause: '4.1', clause_name: 'Context',
      requirement_text: 'x', applicability: 'applicable', assessment_state: 'in_progress',
    });
    const finding = await db.insert('iso_findings', {
      id: 'ifnd_1', audit_id: setup.id, client_id: 'c0', ref: setup.ref + '-F001', classification: 'minor_nc',
      title: 'Gap in doc control', status: 'draft', visibility: 'internal', reopened_count: 0, root_cause_required: false,
    });
    const action = await db.insert('iso_actions', {
      id: 'iact_1', audit_id: setup.id, client_id: 'c0', ref: setup.ref + '-A001', title: 'Fix doc control',
      owner_kind: 'etcher', status: 'in_progress', verification_status: 'not_verified', progress: 0, reopened_count: 0,
      visibility: 'internal', root_cause_method: 'none', cause_categories: [],
    });
    ok(!!req.id && !!finding.id && !!action.id, 'a real requirement, finding and action exist on the board to attach evidence to');

    // ── evidence.addLink: a SharePoint link, a plain link, and three rejections ─────────────────
    const spResult = await page.evaluate((auditId, id) => ISO.api('evidence.addLink', {
      auditId, targetType: 'requirement', targetId: id, url: 'https://etcher.sharepoint.com/sites/qms/doc1.docx',
      title: 'Doc control procedure', description: 'The real SOP', versionLabel: 'v3', evidenceDate: '2026-01-05',
    }), setup.id, req.id);
    ok(spResult.evidence.kind === 'sharepoint', `a sharepoint.com URL is stored as kind='sharepoint' (got ${spResult.evidence.kind})`);
    ok(!spResult.evidence.storage_path, 'the sharepoint-kind evidence record stores no storage object (storage_path is null)');
    ok(spResult.link.review_status === 'submitted', `a newly-added link defaults to review_status='submitted' (got ${spResult.link.review_status})`);
    ok(/^.+-E\d{3}$/.test(spResult.evidence.ref), `the evidence record got a real numbered ref (got ${spResult.evidence.ref})`);

    const plainResult = await page.evaluate((auditId, id) => ISO.api('evidence.addLink', {
      auditId, targetType: 'finding', targetId: id, url: 'example.com/report.pdf', title: 'External report',
    }), setup.id, finding.id);
    ok(plainResult.evidence.kind === 'link', `a non-SharePoint URL is stored as kind='link' (got ${plainResult.evidence.kind})`);
    ok(plainResult.evidence.url === 'https://example.com/report.pdf', `a bare domain is normalized to a full https URL (got ${plainResult.evidence.url})`);

    for (const bad of ['javascript:alert(1)', 'data:text/plain,hi', 'https://user:pass@example.com/x', '']) {
      const res = await page.evaluate((auditId, id, url) => ISO.api('evidence.addLink', { auditId, targetType: 'action', targetId: id, url, title: 'x' }).then(() => ({ ok: true })).catch(e => ({ ok: false, message: e.message })), setup.id, action.id, bad);
      ok(res.ok === false, `a ${JSON.stringify(bad)} URL is rejected, not stored (got ${JSON.stringify(res)})`);
    }

    // ── evidence.list: per-target lookup, right shape ──────────────────────────────────────────
    const reqEvidence = await page.evaluate((auditId, id) => ISO.api('evidence.list', { auditId, targetType: 'requirement', targetId: id }), setup.id, req.id);
    ok(reqEvidence.length === 1 && reqEvidence[0].title === 'Doc control procedure', `evidence.list for the requirement returns exactly the one link added to it (got ${JSON.stringify(reqEvidence.map(e => e.title))})`);
    ok(reqEvidence[0].linkId && reqEvidence[0].reviewStatus === 'submitted', 'the returned row carries its own linkId and review status');
    const actionEvidence = await page.evaluate((auditId, id) => ISO.api('evidence.list', { auditId, targetType: 'action', targetId: id }), setup.id, action.id);
    ok(actionEvidence.length === 0, 'evidence.list for the action (all 4 rejected adds) returns zero rows — rejections never reached the store');

    // ── metric.audit: the new evidence_* fields are real, not stubs ────────────────────────────
    const metric = await page.evaluate(auditId => ISO.api('metric.audit', { auditId }), setup.id);
    ok(metric.evidence_submitted === 2, `metric.audit.evidence_submitted counts both real links across the whole audit (got ${metric.evidence_submitted})`);
    ok(metric.evidence_accepted === 0 && metric.req_with_accepted_evidence === 0, 'metric.audit.evidence_accepted / req_with_accepted_evidence are 0 — no review/accept op exists yet this phase (8.3), not a bug');
    ok(metric.evidence_requested === 0, 'metric.audit.evidence_requested is 0 — no evidenceRequest.create op exists yet this phase (8.3)');

    // ── UI: the requirement drawer's own Evidence panel — add via the real form, see it render,
    // Copy link works, restricted badge shows. A fresh board created through the real new-board
    // wizard (same flow as iso-ui-test.cjs) so the Requirements tab's own real render populates
    // _req.requirements the way a user's session actually would — openRequirementDrawer reads from
    // that cache directly, it is never fetched fresh for one id. ──────────────────────────────────
    await page.evaluate(() => window.navigate('iso'));
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => document.querySelector('.iso-landing-head button').click());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => document.querySelector('.iso-wiz-client-row').click());
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => ISO._wizNext());
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => ISO._wizToggleStandard('9001'));
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => ISO._wizNext());
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => ISO._wizCreate());
    await new Promise(r => setTimeout(r, 1200));
    // D27: a new board opens on its Dashboard; the drawer checks below need the register.
    await page.evaluate(() => ISO.setTab('requirements'));
    await new Promise(r => setTimeout(r, 1000));
    const uiSetup = await page.evaluate(async () => {
      const audits = await ISO.api('audit.list');
      const a = audits.find(x => x.ref.endsWith('-002'));
      const reqs = a ? await ISO.api('requirement.list', { auditId: a.id }) : [];
      return { auditId: a && a.id, reqId: reqs[0] && reqs[0].id };
    });
    ok(!!uiSetup.auditId && !!uiSetup.reqId, `a second real board was created via the wizard, with a real seeded requirement (got ${JSON.stringify(uiSetup)})`);

    await page.evaluate((auditId, id) => ISO.openRequirementDrawer(auditId, id), uiSetup.auditId, uiSetup.reqId);
    await new Promise(r => setTimeout(r, 900));
    const panelBefore = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerHTML || '');
    ok(panelBefore.includes('Evidence (0)') && panelBefore.includes('No evidence attached yet'), 'a fresh requirement\'s drawer renders the Evidence panel with zero items via a real evidence.list call');

    await page.evaluate((auditId, id) => ISO._openAddEvidence('requirement', id, auditId), uiSetup.auditId, uiSetup.reqId);
    await new Promise(r => setTimeout(r, 400));
    await page.type('#evd-url', 'https://etcher.sharepoint.com/sites/qms/doc2.docx');
    await page.type('#evd-title', 'Second evidence item');
    await page.select('#evd-conf', 'restricted');
    await page.evaluate((auditId, id) => ISO._evdAddApply('requirement', id, auditId), uiSetup.auditId, uiSetup.reqId);
    await new Promise(r => setTimeout(r, 900));
    const panelAfter = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerHTML || '');
    ok(panelAfter.includes('Second evidence item') && panelAfter.includes('Evidence (1)'), `adding evidence through the real UI form re-opens the drawer and shows the new item (panel had Evidence(1): ${panelAfter.includes('Evidence (1)')})`);
    ok(panelAfter.includes('RESTRICTED'), 'a restricted-confidentiality evidence item shows the RESTRICTED badge');
    ok(!/<a\s/i.test(panelAfter.match(/Second evidence item[\s\S]{0,400}/)[0]), 'the evidence URL renders as plain selectable text, never a clickable anchor (hard rule 13)');

    await page.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Copy link'); btn && btn.click(); });
    await new Promise(r => setTimeout(r, 200));
    const copied = await page.evaluate(() => window.__copied);
    ok(typeof copied === 'string' && copied.startsWith('https://'), `Copy link actually writes the real URL to the clipboard (got ${JSON.stringify(copied)})`);

    // A81: a valid http(s) link whose text would close a JS string inside an inline handler — the
    // URL parser keeps ' ( ) ; / as they are, so only the rendering keeps it inert.
    const crafted = "https://example.com/');window.__xss=1;//";
    await page.evaluate((auditId, id) => ISO._openAddEvidence('requirement', id, auditId), uiSetup.auditId, uiSetup.reqId);
    await new Promise(r => setTimeout(r, 400));
    await page.type('#evd-url', crafted);
    await page.type('#evd-title', 'Crafted link');
    await page.evaluate((auditId, id) => ISO._evdAddApply('requirement', id, auditId), uiSetup.auditId, uiSetup.reqId);
    await new Promise(r => setTimeout(r, 900));
    await page.evaluate(() => { window.__copiedAll = []; navigator.clipboard.writeText = (t) => { window.__copiedAll.push(t); return Promise.resolve(); }; [...document.querySelectorAll('#iso-drawer-body button')].filter(b => b.textContent.trim() === 'Copy link').forEach(b => b.click()); });
    await new Promise(r => setTimeout(r, 300));
    const xss = await page.evaluate(() => ({ fired: window.__xss === 1, copied: window.__copiedAll }));
    ok(!xss.fired && xss.copied.includes(crafted), `a crafted link stays data: Copy link copies it exactly and runs nothing (fired: ${xss.fired}, copied: ${JSON.stringify(xss.copied)})`);

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
