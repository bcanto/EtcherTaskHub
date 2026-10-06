// Board redesign to the approved wireframe (docs/iso-audit/redesign-wireframes.html): one card per
// board — header (back, title, standard switch, ⚙), per-standard progress strip, four tabs
// (Overview · Clauses · Documents · Actions); the Documents tab (R4b: document-first, Key documents
// set cover, add once / edit links, custom documents, Generator) and the Actions tab (R6: a
// Partial/Non-Compliant/OFI status with a planned action IS the action; identical plans share one
// action; List / Timeline). Fresh offline temp server, seeded v3 library.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3162;
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

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-shell-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001', '45001'], title: 'ISO 9001/14001/45001' }));
    let reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const byKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
    const setReq = async (key, patch) => {
      const cur = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).find(r => r.id === byKey.get(key).id);
      const res = await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: cur.id, expectedVersion: cur.row_version, patch });
      if (res.status !== 200) throw new Error('setReq ' + key + ' ' + JSON.stringify(res.body));
    };
    // Two clauses (different standards) share one planned action; one NC with its own; one compliant.
    await setReq('9001 7.5.1', { compliance_status: 'partially_compliant', recommended_action: 'Reissue the document control procedure', target_date: '2026-12-01' });
    await setReq('14001 7.5.1', { compliance_status: 'ofi', recommended_action: '  reissue the document control procedure ', target_date: '2026-11-20' });
    await setReq('45001 6.1.2.1', { compliance_status: 'non_compliant', recommended_action: 'Build a hazard register', target_date: '2026-11-05' });
    await setReq('9001 4.1', { compliance_status: 'compliant' });
    await setReq('9001 4.2', { compliance_status: 'non_compliant' }); // no plan → not an action
    // An action raised the old way, linked to a 9001 clause.
    const act = data(await callIso(ADMIN, { op: 'action.create', auditId: board.id, targetType: 'requirement', targetId: byKey.get('9001 8.5.1').id, title: 'Legacy action raised the old way', priority: 'low', dueDate: '2027-01-15' }));

    // ── document.list: latest revision and custom documents (API) ──────────────────────────────
    let docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const mrm = docs.find(d => d.name === 'Management Review Minutes');
    ok(mrm && mrm.latest === null, 'a document not yet on the board has latest: null');
    await callIso(ADMIN, { op: 'evidence.addLinkBulk', auditId: board.id, title: 'Management Review Minutes', url: 'https://example.com/mrm', versionLabel: 'Rev 2', evidenceDate: '2026-08-14', requirementIds: mrm.clauses.slice(0, 3).map(c => c.requirementId) });
    await callIso(ADMIN, { op: 'evidence.addLinkBulk', auditId: board.id, title: 'Management Review Minutes', url: 'https://example.com/mrm3', versionLabel: 'Rev 3', evidenceDate: '2026-09-30', requirementIds: [mrm.clauses[0].requirementId] });
    const xssName = `Site <img src=x onerror="window.__xss=1"> it's plan`;
    await callIso(ADMIN, { op: 'evidence.addLinkBulk', auditId: board.id, title: xssName, url: 'https://example.com/custom', requirementIds: [byKey.get('9001 4.1').id, byKey.get('14001 4.1').id] });
    docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const mrm2 = docs.find(d => d.name === 'Management Review Minutes');
    ok(mrm2 && mrm2.latest && mrm2.latest.versionLabel === 'Rev 3' && mrm2.latest.evidenceDate === '2026-09-30', `latest is the newest live copy by date (got ${JSON.stringify(mrm2 && mrm2.latest)})`);
    ok(mrm2 && mrm2.providedCount === 3, `providedCount counts each clause once however many copies (got ${mrm2 && mrm2.providedCount})`);
    const custom = docs.find(d => d.custom);
    ok(custom && custom.name === xssName && custom.clauses.length === 2 && custom.providedCount === 2, `evidence matching no catalog document is listed as a custom document with exactly its linked clauses (got ${JSON.stringify(custom && { n: custom.name, c: custom.clauses.length })})`);
    ok(docs.filter(d => d.custom).length === 1, 'catalog-named evidence never doubles as a custom document');

    // ── UI ─────────────────────────────────────────────────────────────────────────────────────
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 } });
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' }); await sleep(900);
    await page.type('#login-email', 'b.canto@etchersolutions.com'); await page.type('#login-password', 'TaskHub123'); await page.keyboard.press('Enter');
    await sleep(1800);
    await page.evaluate(id => ISO.openBoard(id), board.id); await sleep(2200);

    // Header and tabs
    const hdr = await page.evaluate(() => ({
      card: !!document.querySelector('.iso-app > header.iso-app-h + main.iso-app-main'),
      tabs: [...document.querySelectorAll('.iso-tabs .iso-tab')].map(t => t.childNodes[0].textContent.trim()),
      active: document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab,
      title: document.querySelector('.iso-board-title')?.textContent.trim(),
      radios: [...document.querySelectorAll('.iso-stdfilter [role=radio]')].map(b => b.textContent.trim()),
      gear: !!document.querySelector('.iso-h1row .iso-icon-btn[aria-label="Board settings"]'),
      strip: [...document.querySelectorAll('#iso-pstrip .iso-ps-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      clausesCt: document.querySelector('.iso-tab-ct[data-ct="clauses"]')?.textContent,
      actionsCt: document.querySelector('.iso-tab-ct[data-ct="actions"]')?.textContent,
      oldHeader: !!document.querySelector('#iso-dash-tab .iso-dash-header'),
    }));
    ok(hdr.card, 'the board is one card: header, then the tab content in the same card');
    ok(JSON.stringify(hdr.tabs) === JSON.stringify(['Overview', 'Clauses', 'Documents', 'Actions']), `exactly four tabs, in the wireframe's order (got ${JSON.stringify(hdr.tabs)})`);
    ok(hdr.active === 'dashboard', 'a board opens on Overview');
    ok(hdr.title === 'Gap analysis', `a default-titled board's header names the audit type (got ${hdr.title})`);
    ok(JSON.stringify(hdr.radios) === JSON.stringify(['All', 'Q9001', 'E14001', 'S45001']), `the standard switch is a radiogroup: All, then each standard with its tag (got ${JSON.stringify(hdr.radios)})`);
    ok(hdr.gear, 'Settings is the ⚙ in the header, not a tab');
    ok(hdr.strip.length === 3 && /^Q ?3 \/60$/.test(hdr.strip[0]), `the progress strip shows assessed/total per standard (got ${JSON.stringify(hdr.strip)})`);
    ok(hdr.clausesCt === `${reqs.length - 5} to go`, `Clauses tab count is the clauses not yet assessed (got ${hdr.clausesCt}, expected ${reqs.length - 5} to go)`);
    ok(hdr.actionsCt === '3', `Actions tab count = shared plan + own plan + legacy action (got ${hdr.actionsCt})`);
    ok(!hdr.oldHeader, 'Overview no longer repeats a second header card under the board header');

    // Overview legend speaks the five clause statuses, not workbook result labels
    const legend = await page.evaluate(() => [...document.querySelectorAll('.iso-ov-stdcol')][0]?.querySelector('.iso-ov-legend')?.textContent || '');
    ok(/Compliant 1/.test(legend) && /Non-Compliant 1/.test(legend) && /Partially Compliant 1/.test(legend) && /Not assessed/.test(legend) && !/Implemented/.test(legend), `the Overview legend counts clause statuses (got ${legend})`);

    // ── Documents tab ──────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => ISO.setTab('documents')); await sleep(1800);
    const d1 = await page.evaluate(() => ({
      active: document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab,
      sum: document.querySelector('.iso-docs-sum')?.textContent.replace(/\s+/g, ' ').trim(),
      chips: [...document.querySelectorAll('.iso-doc-toolbar .iso-fchip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
      on: document.querySelector('.iso-doc-toolbar .iso-fchip.is-on')?.dataset.f,
      rows: document.querySelectorAll('.iso-doc-row').length,
      xss: window.__xss || 0,
    }));
    ok(d1.active === 'documents', 'the Documents tab is lit');
    ok(/^4 of 133 clauses have evidence/.test(d1.sum || ''), `summary counts distinct clauses with evidence (got ${d1.sum})`);
    ok(/2 documents provided/.test(d1.sum || '') && /together touch every clause — collect them first/.test(d1.sum || ''), `summary names provided documents and the Key-documents promise (got ${d1.sum})`);
    ok(d1.on === 'key' && /^Key documents \d+$/.test(d1.chips[0]) && /^Not provided \d+$/.test(d1.chips[1]) && d1.chips[2] === 'Provided 2' && /^All 126$/.test(d1.chips[3]), `chips: Key documents, Not provided, Provided, All — Key first (got ${JSON.stringify(d1.chips)})`);
    // Key documents really are a cover: together they touch every clause.
    const cover = await page.evaluate(() => {
      const keyRows = [...document.querySelectorAll('.iso-doc-row')].map(r => r.dataset.docRow);
      return { n: keyRows.length };
    });
    const keyCover = (() => {
      const left = new Set(reqs.map(r => r.id)); const pool = docs.filter(d => !d.custom); const out = [];
      while (left.size) { let best = null, bn = 0; for (const d of pool) { if (out.includes(d)) continue; const n = d.clauses.filter(c => left.has(c.requirementId)).length; if (n > bn) { bn = n; best = d; } } if (!best) break; out.push(best); best.clauses.forEach(c => left.delete(c.requirementId)); }
      return { n: out.length, left: left.size };
    })();
    ok(cover.n === keyCover.n && keyCover.left === 0, `Key documents is the greedy cover of every clause (${cover.n} rows, reference ${keyCover.n}, uncovered ${keyCover.left})`);
    await page.evaluate(() => ISO._docSetFilter('all')); await sleep(300);
    const d2 = await page.evaluate(name => {
      const rows = [...document.querySelectorAll('.iso-doc-row')];
      const mrm = rows.find(r => r.dataset.docRow === 'Management Review Minutes');
      const cust = rows.find(r => r.dataset.docRow === name);
      const leg = rows.find(r => r.dataset.docRow === 'Legal and Other Requirements Register');
      return {
        mrmStatus: mrm?.querySelector('.iso-doc-ds')?.textContent.trim(), mrmBtn: mrm?.querySelector('.iso-doc-add')?.textContent.trim(),
        custFlag: cust?.querySelector('.iso-keyflag')?.textContent, custName: cust?.querySelector('.iso-doc-dn')?.childNodes[0]?.textContent,
        custImg: !!cust?.querySelector('img'), legGen: !!leg?.querySelector('.iso-doc-gen'), legBtn: leg?.querySelector('.iso-doc-add')?.textContent.trim(),
        mrmGen: !!mrm?.querySelector('.iso-doc-gen'), xss: window.__xss || 0,
        inline: [...document.querySelectorAll('.iso-doc-row [onclick]')].some(b => b.getAttribute('onclick').includes('img')),
      };
    }, xssName);
    ok(/✓\s*Rev 3 · 30 Sept 2026/.test(d2.mrmStatus || '') && d2.mrmBtn === 'Edit links', `a provided document shows ✓ Rev · date and Edit links (got ${JSON.stringify([d2.mrmStatus, d2.mrmBtn])})`);
    ok(d2.legBtn === '+ Add' && d2.legGen, 'a missing document with a generator template shows Generator and + Add');
    ok(!d2.mrmGen, 'Generator is offered only while the document is missing');
    ok(d2.custFlag === 'Custom' && d2.custName === xssName && !d2.custImg && !d2.xss && !d2.inline, 'a custom document carries the Custom flag; its name renders as text and never reaches an inline handler (A81)');

    // Search and filter
    await page.evaluate(() => ISO._docSetQuery('hazard')); await sleep(250);
    const srch = await page.evaluate(() => [...document.querySelectorAll('.iso-doc-row')].map(r => r.dataset.docRow));
    ok(srch.length >= 1 && srch.every(n => /hazard/i.test(n)), `search narrows to matching document names (got ${JSON.stringify(srch)})`);
    await page.evaluate(() => ISO._docSetQuery('')); await page.evaluate(() => ISO._docSetFilter('provided')); await sleep(250);
    const prov = await page.evaluate(() => [...document.querySelectorAll('.iso-doc-row')].map(r => r.dataset.docRow).sort());
    ok(JSON.stringify(prov) === JSON.stringify(['Management Review Minutes', xssName].sort()), `Provided lists exactly the documents on the board (got ${JSON.stringify(prov)})`);

    // + Add on a missing document: clauses arrive pre-ticked; untick one; link → one evidence, N links
    await page.evaluate(() => ISO._docSetFilter('all')); await sleep(250);
    const target = docs.find(d => d.name === 'Legal and Other Requirements Register');
    await page.evaluate(() => { [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === 'Legal and Other Requirements Register').querySelector('.iso-doc-add').click(); });
    await sleep(400);
    const form = await page.evaluate(() => ({
      title: document.querySelector('#generic-modal .modal-title, #generic-modal h2, #generic-modal h3')?.textContent.trim(),
      ticked: document.querySelectorAll('#iso-da-groups input[type=checkbox]:checked').length,
      groups: [...document.querySelectorAll('#iso-da-groups .iso-da-gh b')].map(b => b.textContent),
      sum: document.getElementById('iso-da-sum')?.textContent,
    }));
    ok(form.ticked === target.clauses.length, `every clause the register names arrives pre-ticked (got ${form.ticked} of ${target.clauses.length})`);
    ok(form.groups.length >= 2, `clauses are grouped by standard (got ${JSON.stringify(form.groups)})`);
    await page.evaluate(() => { document.querySelector('#iso-da-groups input[type=checkbox]').click(); });
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(400);
    const noUrl = await page.evaluate(() => !document.getElementById('generic-modal').classList.contains('hidden'));
    ok(noUrl, 'Link without a file or link keeps the form open (nothing saved)');
    await page.type('#ovda-url', 'https://example.com/legal'); await page.type('#ovda-version', 'Rev 1');
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(1800);
    docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const legal = docs.find(d => d.name === 'Legal and Other Requirements Register');
    ok(legal.providedCount === target.clauses.length - 1 && legal.latest && legal.latest.versionLabel === 'Rev 1', `one save links the document to every ticked clause, minus the unticked one (got ${legal.providedCount} of ${target.clauses.length}, ${JSON.stringify(legal.latest)})`);
    const legalIds = async () => {
      const ids = new Set();
      for (const c of target.clauses.concat([{ requirementId: byKey.get('9001 9.3.1').id }])) for (const e of (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: c.requirementId })) || [])) if (e.title === 'Legal and Other Requirements Register') ids.add(e.id);
      return ids;
    };
    ok((await legalIds()).size === 1, 'it is one evidence record, not one per clause');

    // Edit links: the remaining clause is unticked; ticking it links the SAME evidence record
    await page.evaluate(() => { [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === 'Legal and Other Requirements Register').querySelector('.iso-doc-add').click(); });
    await sleep(400);
    const edit = await page.evaluate(() => ({
      linked: document.querySelectorAll('#iso-da-groups input[data-linked]').length,
      url: !!document.getElementById('ovda-url'),
      btn: document.querySelector('.iso-da-save')?.textContent.trim(),
      unticked: [...document.querySelectorAll('#iso-da-groups input:not([data-linked])')].filter(i => !i.checked).map(i => i.value),
    }));
    ok(edit.linked === target.clauses.length - 1 && !edit.url && edit.btn === 'Save links', `Edit links shows the linked clauses ticked, no file fields, and Save links (got ${JSON.stringify(edit)})`);
    ok(edit.unticked.length === 1, `in Edit links a register clause not yet linked starts unticked — you tick what to add (got ${edit.unticked.length})`);
    await page.evaluate(id => document.querySelector(`#iso-da-groups input[value="${id}"]`).click(), edit.unticked[0]); await sleep(100);
    // add one more clause via search (not in the register's list)
    await page.evaluate(() => ISO._docAddClauseSearch('9.3.1')); await sleep(150);
    await page.evaluate(() => document.querySelector('#iso-da-hits .iso-pick')?.click()); await sleep(150);
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(1800);
    docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const legalEv = await legalIds();
    const legal2 = docs.find(d => d.name === 'Legal and Other Requirements Register');
    ok(legalEv.size === 1 && legal2.providedCount === target.clauses.length, `Edit links re-links the same record — still one evidence, now on every register clause (got ${legalEv.size} records, ${legal2.providedCount} of ${target.clauses.length})`);
    const link931 = await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: byKey.get('9001 9.3.1').id });
    ok((data(link931) || []).some(e => e.title === 'Legal and Other Requirements Register'), 'a clause added by search gets the link too');

    // Edit links → untick a linked clause: warning, then the app's own confirm, then it comes off that clause only.
    const LEGAL = 'Legal and Other Requirements Register';
    const dropId = target.clauses[0].requirementId;
    await page.evaluate(n => { [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === n).querySelector('.iso-doc-add').click(); }, LEGAL);
    await sleep(400);
    const warnBefore = await page.evaluate(() => document.getElementById('iso-da-warn')?.hidden);
    await page.evaluate(id => document.querySelector(`#iso-da-groups input[data-linked][value="${id}"]`).click(), dropId); await sleep(150);
    const warnAfter = await page.evaluate(() => ({ hidden: document.getElementById('iso-da-warn')?.hidden, text: document.getElementById('iso-da-warn')?.textContent || '', sum: document.getElementById('iso-da-sum')?.textContent }));
    ok(warnBefore === true && warnAfter.hidden === false && /Removing this document from 1 clause/.test(warnAfter.text) && /stays on the board/.test(warnAfter.text) && /1 to remove/.test(warnAfter.sum), `unticking a linked clause shows a warning before anything is saved (got ${JSON.stringify(warnAfter)})`);
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(400);
    const conf = await page.evaluate(() => ({ shown: !document.getElementById('confirm-modal').classList.contains('hidden'), title: document.getElementById('confirm-title')?.textContent, msg: document.getElementById('confirm-msg')?.textContent || '' }));
    const stillLinked = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: dropId })) || []).some(e => e.title === LEGAL && !['rejected', 'superseded'].includes(e.reviewStatus));
    ok(conf.shown && conf.title === 'Remove from 1 clause?' && /stays on the board/.test(conf.msg) && stillLinked, `Save asks first in the app's own dialog, and nothing is removed yet (got ${JSON.stringify({ ...conf, stillLinked })})`);
    await page.evaluate(() => document.getElementById('confirm-ok-btn').click()); await sleep(2000);
    const afterRm = (data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || []).find(d => d.name === LEGAL);
    const dropLinks = data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: dropId })) || [];
    ok(!afterRm.clauses.find(c => c.requirementId === dropId).provided && afterRm.providedCount === target.clauses.length - 1 && afterRm.latest, `the document comes off that clause only — it stays on the board and its other clauses (got ${afterRm.providedCount} of ${target.clauses.length})`);
    ok(dropLinks.some(e => e.title === LEGAL && e.reviewStatus === 'rejected' && /Removed from this clause/.test(e.reviewComment || '')), 'the removal is a soft one: the link row stays, marked removed, for the history');
    // Re-tick: the same link comes back (no duplicate row).
    await page.evaluate(n => { [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === n).querySelector('.iso-doc-add').click(); }, LEGAL);
    await sleep(400);
    const reTickable = await page.evaluate(id => { const cb = document.querySelector(`#iso-da-groups input[value="${id}"]`); return !!cb && !cb.checked && !cb.hasAttribute('data-linked'); }, dropId);
    await page.evaluate(id => document.querySelector(`#iso-da-groups input[value="${id}"]`).click(), dropId); await sleep(150);
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(2000);
    const back = data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: dropId })) || [];
    const legalBack = back.filter(e => e.title === LEGAL);
    ok(reTickable && legalBack.length === 1 && legalBack[0].reviewStatus === 'submitted', `ticking it again puts the same link back, not a second one (got ${JSON.stringify(legalBack.map(e => e.reviewStatus))})`);

    // Add other document → new custom name → pick clause → link
    await page.evaluate(() => ISO._docOpenChooser()); await sleep(300);
    await page.type('#iso-da-find', 'Toolbox talk record'); await sleep(200);
    const newPick = await page.evaluate(() => document.querySelector('#iso-da-picks .iso-pick.is-new')?.textContent || '');
    ok(/Add “Toolbox talk record” as a new document/.test(newPick), `the chooser offers a typed name as a new document (got ${newPick})`);
    await page.evaluate(() => document.querySelector('#iso-da-picks .iso-pick.is-new').click()); await sleep(300);
    const customForm = await page.evaluate(() => ({ flag: document.querySelector('.iso-da-doc .iso-keyflag')?.textContent, rows: document.querySelectorAll('#iso-da-groups input').length }));
    ok(customForm.flag === 'Custom document' && customForm.rows === 0, `a new custom document starts with no clauses (got ${JSON.stringify(customForm)})`);
    await page.evaluate(() => ISO._docAddClauseSearch('7.4')); await sleep(150);
    await page.evaluate(() => document.querySelector('#iso-da-hits .iso-pick')?.click()); await sleep(150);
    await page.type('#ovda-url', 'https://example.com/toolbox');
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(1800);
    docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const tb = docs.find(d => d.name === 'Toolbox talk record');
    ok(tb && tb.custom && tb.clauses.length === 1 && tb.clauses[0].clause === '7.4', `the custom document lands on the clause picked for it (got ${JSON.stringify(tb && tb.clauses.map(c => c.clause))})`);

    // Standard switch scopes Documents
    await page.evaluate(() => ISO._boardSetStandard('14001')); await sleep(1500);
    const d14 = await page.evaluate(() => ({ sum: document.querySelector('.iso-docs-sum .iso-docs-big')?.textContent.replace(/\s+/g, ' ').trim(), tags: [...new Set([...document.querySelectorAll('.iso-doc-sv .iso-tag')].map(t => t.textContent))] }));
    ok(/of 33 clauses have evidence/.test(d14.sum || '') && JSON.stringify(d14.tags) === '["E"]', `the standard switch narrows Documents to that standard (got ${JSON.stringify(d14)})`);
    await page.evaluate(() => ISO._boardSetStandard('')); await sleep(1200);

    // ── Actions tab ────────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => ISO.setTab('worklist')); await sleep(1800);
    const a1 = await page.evaluate(() => ({
      active: document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab,
      count: document.querySelector('.iso-wl-count')?.textContent.trim(),
      rows: [...document.querySelectorAll('.iso-wl-row')].map(r => ({ p: r.querySelector('.iso-prio')?.textContent.trim(), t: r.querySelector('.iso-wl-plan')?.textContent.trim(), cv: [...r.querySelectorAll('.iso-cv')].map(c => c.textContent.trim()), due: r.querySelector('.iso-wl-due')?.textContent.trim() })),
    }));
    ok(a1.active === 'worklist', 'the Actions tab is lit');
    ok(a1.count === '3 actions · 1 shared across clauses', `count line: actions and how many are shared (got ${a1.count})`);
    ok(a1.rows[0] && a1.rows[0].p === 'High' && a1.rows[0].t === 'Build a hazard register' && JSON.stringify(a1.rows[0].cv) === '["S6.1.2.1"]', `Non-Compliant is High and sorts first (got ${JSON.stringify(a1.rows[0])})`);
    const shared = a1.rows.find(r => /document control/i.test(r.t || ''));
    ok(shared && shared.p === 'Medium' && JSON.stringify(shared.cv) === '["Q7.5.1","E7.5.1"]' && shared.due === '20 Nov 2026', `the same plan on two clauses is one shared action: highest priority, both clauses, earliest due (got ${JSON.stringify(shared)})`);
    const legacy = a1.rows.find(r => r.t === 'Legacy action raised the old way');
    ok(legacy && legacy.p === 'Low' && JSON.stringify(legacy.cv) === '["Q8.5.1"]', `an action raised the old way stays listed with its linked clause (got ${JSON.stringify(legacy)})`);
    ok(!a1.rows.some(r => /4\.2/.test(r.cv.join(''))), 'a Non-Compliant clause without a planned action is not an action (it shows under Needs attention instead)');

    // Timeline
    await page.evaluate(() => ISO._wlSetMode('timeline')); await sleep(300);
    const tl = await page.evaluate(() => ({ rows: document.querySelectorAll('.iso-tl-row').length, months: document.querySelectorAll('.iso-tl-months span').length, bars: [...document.querySelectorAll('.iso-tl-bar')].map(b => parseFloat(b.style.width)) }));
    ok(tl.rows === 3 && tl.months >= 5 && tl.bars.every(w => w > 0 && w <= 100), `Timeline draws one bar per action across the months (got ${JSON.stringify(tl)})`);
    await page.evaluate(() => ISO._wlSetMode('list')); await sleep(200);

    // Clause chip jumps to Clauses with that clause open
    await page.evaluate(() => { [...document.querySelectorAll('.iso-cv')].find(c => c.textContent.trim() === 'S6.1.2.1').click(); });
    await sleep(2500);
    const jump = await page.evaluate(id => ({ tab: document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab, open: !!document.querySelector(`[data-ireq="${id}"].is-open`) }), byKey.get('45001 6.1.2.1').id);
    ok(jump.tab === 'requirements' && jump.open, `a clause chip opens Clauses with that clause expanded (got ${JSON.stringify(jump)})`);

    // Legacy action title opens its drawer
    await page.evaluate(() => ISO.setTab('worklist')); await sleep(1600);
    await page.evaluate(() => [...document.querySelectorAll('button.iso-wl-plan')].find(b => b.textContent.includes('Legacy'))?.click()); await sleep(1500);
    const drawer = await page.evaluate(() => !document.getElementById('generic-modal').classList.contains('hidden') && /Legacy action raised the old way/.test(document.getElementById('generic-modal-title').textContent));
    ok(drawer, 'an action raised the old way opens its own drawer from the list');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // ── Open clause: documents column (✓ linked, ○ register suggestions) and the clause-aware chooser ──
    const c43 = byKey.get('9001 4.3').id;
    const g43 = (data(await callIso(ADMIN, { op: 'guidance.list', auditId: board.id })) || {})[c43] || {};
    await page.evaluate(() => ISO.setTab('requirements')); await sleep(2000);
    await page.evaluate(id => ISO._reqToggleExpand(id), c43); await sleep(1200);
    const col = await page.evaluate(id => {
      const r = document.querySelector(`[data-ireq="${id}"]`);
      return { label: r.querySelector('.iso-clause-col-head .iso-clause-col-label')?.textContent.replace(/\s+/g, ' ').trim(), sug: [...r.querySelectorAll('.iso-doc-item.is-sug .iso-doc-name')].map(e => e.textContent), ok: r.querySelectorAll('.iso-doc-item.is-ok').length };
    }, c43);
    ok((g43.documents || []).length > 0 && JSON.stringify(col.sug) === JSON.stringify(g43.documents) && col.ok === 0 && col.label === `Documents 0 of ${g43.documents.length}`, `an open clause lists the register's suggested documents as not-yet-provided, "0 of N" (got ${JSON.stringify(col)}, register ${JSON.stringify(g43.documents)})`);
    const sugName = g43.documents[0];
    await page.evaluate((id, n) => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-doc-sug-add`)].find(b => b.dataset.doc === n).click(), c43, sugName); await sleep(400);
    const sugForm = await page.evaluate(id => ({ ticked: [...document.querySelectorAll('#iso-da-groups input:checked')].map(i => i.value), name: document.querySelector('.iso-da-doc b')?.textContent }), c43);
    ok(sugForm.name === sugName && sugForm.ticked.includes(c43), `+ Add on a suggestion opens that document with this clause ticked (got ${JSON.stringify({ n: sugForm.name, has: sugForm.ticked.includes(c43) })})`);
    await page.type('#ovda-url', 'https://example.com/sug');
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(2500);
    const col2 = await page.evaluate(id => ({ ok: [...document.querySelectorAll(`[data-ireq="${id}"] .iso-doc-item.is-ok .iso-doc-name`)].map(e => e.textContent), open: !!document.querySelector(`[data-ireq="${id}"].is-open`) }), c43);
    ok(col2.open && col2.ok.includes(sugName), `after linking, the open clause shows it ✓ (got ${JSON.stringify(col2)})`);
    // "+ Add document" → chooser in this clause's context → link an already-provided document to it alone.
    const mrmBefore = (data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || []).find(d => d.name === 'Management Review Minutes').providedCount;
    await page.evaluate(id => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-clause-col-head .linkbtn`)].find(b => /Add document/.test(b.textContent)).click(), c43); await sleep(400);
    const ch = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#iso-da-picks .iso-pick-g .iso-clause-col-label')].map(e => e.textContent), legacy: !!document.getElementById('evd-search') }));
    ok(!ch.legacy && ch.groups.some(g => g === 'Already provided — link it to this clause'), `"+ Add document" opens the document chooser for this clause, not the old evidence modal (got ${JSON.stringify(ch)})`);
    await page.evaluate(() => [...document.querySelectorAll('#iso-da-picks .iso-pick')].find(b => b.dataset.doc === 'Management Review Minutes').click()); await sleep(400);
    const mrmForm = await page.evaluate(id => ({ newTicks: [...document.querySelectorAll('#iso-da-groups input:checked:not([data-linked])')].map(i => i.value), btn: document.querySelector('.iso-da-save')?.textContent.trim() }), c43);
    ok(mrmForm.btn === 'Save links' && JSON.stringify(mrmForm.newTicks) === JSON.stringify([c43]), `an already-provided document opens as Edit links with only this clause newly ticked (got ${JSON.stringify(mrmForm)})`);
    await page.evaluate(() => ISO._ovDocAddApply()); await sleep(2500);
    const mrmAfter = (data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || []).find(d => d.name === 'Management Review Minutes');
    const on43 = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: c43 })) || []).map(e => e.title);
    ok(on43.includes('Management Review Minutes') && mrmAfter.clauses.filter(c => c.provided).length === mrmBefore + (mrmAfter.clauses.some(c => c.requirementId === c43) ? 1 : 0), `the provided document is linked to this clause only (got ${JSON.stringify({ on43, before: mrmBefore, after: mrmAfter.providedCount })})`);

    // Old routes still land, lighting the tab they now belong under
    await page.evaluate(() => ISO.setTab('findings')); await sleep(1500);
    ok(await page.evaluate(() => document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab) === 'worklist', 'the old Findings route lights Actions');
    await page.evaluate(() => ISO.setTab('evidence')); await sleep(1500);
    ok(await page.evaluate(() => document.querySelector('.iso-tabs .iso-tab.active')?.dataset.tab) === 'documents', 'the old Evidence route lights Documents');

    // Phone: no sideways scroll on Documents or Actions
    await page.setViewport({ width: 390, height: 844 });
    for (const t of ['documents', 'worklist']) {
      await page.evaluate(tab => ISO.setTab(tab), t); await sleep(1600);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(sw <= 0, `${t} fits a 390px phone with no sideways scroll (overflow ${sw}px)`);
    }
    ok(errs.length === 0, `no page errors (got ${JSON.stringify(errs.slice(0, 3))})`);
  } catch (e) {
    fail.push('threw: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    proc.kill();
    report();
  }
})();
