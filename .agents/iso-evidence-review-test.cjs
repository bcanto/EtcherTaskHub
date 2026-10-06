// Phase 8b acceptance (R11, D19–D21, D25): evidence review and reuse. One suite for the whole
// phase (deviation from the plan's "extend iso-ui-test" for 8b.1/8b.2 — see A68): it runs on the
// seeded 2015/2018 library (plan 4b.1), whose real repeated clause titles and real cross-standard
// relationship suggestions are exactly what 8b needs, on a fresh offline temp server.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3140;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
// Section N tests plan task 8b.N (1–6). ISO_8B_SECTIONS=1,3 runs only those sections (focused
// debugging); unset = every section.
const SECTIONS = process.env.ISO_8B_SECTIONS ? process.env.ISO_8B_SECTIONS.split(',') : null;
const on = n => !SECTIONS || SECTIONS.includes(String(n));

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

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-8b-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser = null;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const loaded = data(await callIso(ADMIN, { op: 'library.loadSeed' })) || [];
    ok(loaded.length === 3 && loaded.every(r => r.status === 'approved'), 'the built-in 2015/2018 library is loaded as the fixture');
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: '8b board' }));
    ok(board && board.id, 'a two-standard board (9001 + 14001) is created on the seeded library');
    let reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    ok(reqs.length === 60 + 33, `the board holds 60 + 33 requirements (R1, 2026-10-04: v3 seeds — got ${reqs.length})`);
    // R1 (2026-10-04): v3 has exactly one row per clause per standard, so the "two real rows
    // sharing a clause title" scenario the old 2015 workbook happened to have no longer exists in
    // real data. Synthesise it — clone a real 4.1 row with different wording — so the second-line
    // distinguishing-text feature this block tests stays covered regardless of what the library
    // currently contains.
    const real41 = reqs.find(r => r.standard_code === '9001' && r.clause === '4.1');
    await db.insert('iso_requirements', { ...real41, id: 'ireq_dup41_synthetic', requirement_text: real41.requirement_text + ' (synthetic duplicate for test coverage)' });
    reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
    page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1800));
    const openBoardTab = async (tab) => {
      await page.evaluate((id, t) => ISO.openBoard(id, t), board.id, tab || 'requirements');
      await new Promise(r => setTimeout(r, 1500));
    };
    const openReqDrawer = async (reqId) => {
      await page.evaluate((id) => ISO._reqOpenMore(id), reqId);
      await new Promise(r => setTimeout(r, 1200));
    };

    // ── 8b.1: the register's second line, and relationship detail ───────────────────────────
    if (on(1)) {
      // Two real 9001 rows sharing clause 4.1's title but with different wording.
      const dupTitle = reqs.filter(r => r.standard_code === '9001' && r.clause === '4.1');
      ok(dupTitle.length >= 2 && dupTitle[0].requirement_text !== dupTitle[1].requirement_text, `the seeded 9001 library has repeated clause titles with different wording (4.1 × ${dupTitle.length})`);
      await openBoardTab('requirements');
      // Retired by the R3 redesign (D35 P2): a collapsed row shows clause + name only — "about 5
      // visible facts... expands in place" — so two rows sharing a clause title are no longer told
      // apart without opening either; distinguishing wording now lives in the expanded body. The
      // escaping property itself still matters, so it's re-checked below on the expanded rows
      // instead of the now-gone two-line name cell.
      const ids2 = dupTitle.slice(0, 2).map(r => r.id);
      for (const id of ids2) await page.evaluate(i => ISO._reqToggleExpand(i), id);
      await new Promise(r => setTimeout(r, 300));
      const expandedTexts = await page.evaluate(ids => ids.map(id => document.querySelector(`[data-ireq="${id}"] .iso-clause-reqtext`)?.textContent || ''), ids2);
      ok(expandedTexts[0] && expandedTexts[1] && expandedTexts[0] !== expandedTexts[1], `expanding either of two same-title rows shows their own different wording (got ${JSON.stringify(expandedTexts)})`);
      ok(expandedTexts[0] === dupTitle[0].requirement_text, 'the expanded wording is the requirement\'s own stored text, exactly');
      const xssProbe = await page.evaluate(() => !!document.querySelector('#iso-req-tab script, #iso-req-tab img'));
      ok(!xssProbe, 'the requirement text renders as escaped text — no live <script>/<img> anywhere in the register');
      for (const id of ids2) await page.evaluate(i => ISO._reqToggleExpand(i), id);

      // Relationships: suggest, show kind + reason, reject, suggest again.
      const sug1 = data(await callIso(ADMIN, { op: 'relationship.suggest', auditId: board.id }));
      ok(sug1 && sug1.created > 0, `Suggest relationships creates real cross-standard suggestions on the seeded library (got ${sug1 && sug1.created})`);
      const rels = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      const first = rels.find(r => r.state === 'suggested');
      ok(!!first && !!first.reason_text, 'a suggested relationship carries a stored reason');
      const fromReq = reqs.find(r => r.id === first.from_id);
      await openBoardTab('requirements');
      await openReqDrawer(fromReq.id);
      await page.evaluate(() => ISO._reqDrawerSetTab('relationships'));
      await new Promise(r => setTimeout(r, 150));
      const relCard = await page.evaluate(() => document.querySelector('#iso-drawer-body .iso-rel-row')?.innerText || '');
      ok(/Equivalent requirement|Shared integrated control|Mapped|Shared evidence|Supporting/.test(relCard), `the drawer's relationship row names its kind (got ${JSON.stringify(relCard.slice(0, 160))})`);
      ok(relCard.includes(first.reason_text.slice(0, 20)), 'and shows its reason');
      const dec = await callIso(ADMIN, { op: 'relationship.decide', auditId: board.id, id: first.id, decision: 'rejected' });
      ok(dec.status === 200, 'the suggestion is rejected');
      const sug2 = data(await callIso(ADMIN, { op: 'relationship.suggest', auditId: board.id }));
      const relsAfter = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      const samePair = relsAfter.filter(r => (r.from_id === first.from_id && r.to_id === first.to_id) || (r.from_id === first.to_id && r.to_id === first.from_id));
      ok(sug2 && sug2.created === 0 && samePair.length === 1 && samePair[0].state === 'rejected', `running Suggest again recreates nothing — the rejected pair stays rejected, once (created ${sug2 && sug2.created}, pair rows ${samePair.length})`);

      // relationship.add: a user-defined relationship, saved as confirmed, with its reason.
      // Pick pairs with no relationship of any state yet — the same-clause rule already suggested many
      // cross-standard pairs (e.g. 7.5.1 ↔ 7.5.1), and relationship.add rightly refuses those.
      const relsNow = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      const related = new Set(relsNow.flatMap(r => [r.from_id + '|' + r.to_id, r.to_id + '|' + r.from_id]));
      const freePair = (xs, ys, skip) => { for (const x of xs) for (const y of ys) if (!related.has(x.id + '|' + y.id) && !(skip || []).includes(y.id)) return [x, y]; return [null, null]; };
      const [a, b] = freePair(reqs.filter(r => r.standard_code === '9001'), reqs.filter(r => r.standard_code === '14001'));
      const add = await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: a.id, toId: b.id, kind: 'shared_evidence', reasonText: 'One document control procedure covers both systems.' });
      const added = data(add);
      ok(add.status === 200 && added && added.state === 'confirmed' && added.source === 'manual' && added.kind === 'shared_evidence', `relationship.add creates a confirmed, user-defined relationship (got ${add.status} ${JSON.stringify(added ? { state: added.state, source: added.source, kind: added.kind } : add.body)})`);
      const dupAdd = await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: b.id, toId: a.id, kind: 'supporting', reasonText: 'again' });
      ok(dupAdd.status === 400, 'adding the same pair again (either direction) is refused');
      const noReason = await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: a.id, toId: reqs.find(r => r.standard_code === '14001' && r.clause === '4.1').id, kind: 'supporting', reasonText: '' });
      ok(noReason.status === 400, 'a user-defined relationship needs a reason');
      const badKind = await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: a.id, toId: reqs[5].id, kind: 'mapping', reasonText: 'x' });
      ok(badKind.status === 400, '"mapping" is rule-made only — it cannot be added by hand');
      const selfRel = await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: a.id, toId: a.id, kind: 'supporting', reasonText: 'x' });
      ok(selfRel.status === 400, 'a requirement cannot be related to itself');
      await openBoardTab('requirements');
      await openReqDrawer(a.id);
      const manualRow = await page.evaluate(() => [...document.querySelectorAll('#iso-drawer-body .iso-rel-row')].map(e => e.innerText).find(t => /Shared evidence/.test(t)) || '');
      ok(/user-defined/.test(manualRow) && /One document control procedure/.test(manualRow), `the manual relationship shows as user-defined, with its reason (got ${JSON.stringify(manualRow.slice(0, 160))})`);
      // The drawer's own "+ Add relationship" form.
      await page.evaluate(() => [...document.querySelectorAll('#iso-drawer-body button')].find(x => x.textContent.trim() === '+ Add relationship')?.click());
      await new Promise(r => setTimeout(r, 400));
      const formOk = await page.evaluate(() => !!document.getElementById('rel-add-target') && !!document.getElementById('rel-add-kind') && !!document.getElementById('rel-add-reason'));
      ok(formOk, 'the drawer offers a "+ Add relationship" form (target, kind, reason)');
      related.add(a.id + '|' + b.id); related.add(b.id + '|' + a.id);
      const [, target] = freePair([a], reqs.filter(r => r.standard_code === '14001'), [b.id]);
      await page.select('#rel-add-target', target.id);
      await page.select('#rel-add-kind', 'integrated_topic');
      await page.type('#rel-add-reason', 'Same internal audit programme for both standards.');
      await page.evaluate(() => [...document.querySelectorAll('#generic-modal-body button')].find(x => x.textContent.trim() === 'Add relationship')?.click());
      await new Promise(r => setTimeout(r, 1200));
      const relsFinal = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      ok(relsFinal.some(r => r.source === 'manual' && r.kind === 'integrated_topic' && r.state === 'confirmed' && [r.from_id, r.to_id].includes(target.id)), 'the form creates a real confirmed relationship');
    }

    // ── 8b.2: the wider, tabbed requirement drawer ──────────────────────────────────────────
    if (on(2)) {
      const r1 = reqs.find(r => r.standard_code === '9001' && r.clause === '5.2.1') || reqs.find(r => r.standard_code === '9001');
      const r2 = reqs.find(r => r.standard_code === '14001' && r.clause === '6.2.1') || reqs.find(r => r.standard_code === '14001');
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openBoardTab('requirements');
      await openReqDrawer(r1.id);
      const shape = await page.evaluate(() => {
        const body = document.getElementById('iso-drawer-body');
        const tabs = [...body.querySelectorAll('[role="tablist"] [role="tab"]')];
        const panels = [...body.querySelectorAll('[role="tabpanel"]')];
        return {
          header: body.querySelector('.iso-drawer-header')?.innerText || '',
          tabs: tabs.map(t => ({ tab: t.dataset.tab, sel: t.getAttribute('aria-selected'), idx: t.tabIndex, controls: t.getAttribute('aria-controls') })),
          visiblePanels: panels.filter(p => !p.hidden).map(p => p.dataset.tab),
          panelIds: panels.map(p => p.id),
          width: document.querySelector('#generic-modal .modal-box')?.style.maxWidth,
        };
      });
      ok(/ISO 9001:2026/.test(shape.header) && shape.header.includes(r1.clause) && shape.header.includes(r1.clause_name) && shape.header.includes(r1.requirement_text.slice(0, 40)), 'the header shows standard + edition, clause number, clause title and the requirement text');
      ok(/Requirement \(Etcher wording\)/.test(shape.header) && !shape.header.includes('<textarea'), 'the header labels the text as Etcher wording and holds no editable field');
      ok(shape.tabs.map(t => t.tab).join(',') === 'assessment,evidence,relationships,links,comments,activity', `six tabs in order — Comments (D33) before Activity (got ${shape.tabs.map(t => t.tab).join(',')})`);
      ok(shape.tabs[0].sel === 'true' && shape.tabs.slice(1).every(t => t.sel === 'false'), 'a fresh open starts on Assessment');
      ok(shape.tabs[0].idx === 0 && shape.tabs.slice(1).every(t => t.idx === -1), 'only the selected tab is in the Tab order (roving tabindex)');
      ok(shape.tabs.every(t => shape.panelIds.includes(t.controls)), 'every tab names the panel it controls');
      ok(shape.visiblePanels.join() === 'assessment', `exactly one panel is visible (got ${shape.visiblePanels.join()})`);
      ok(shape.width === '1040px', `the drawer is wider than before (got ${shape.width})`);

      // Keyboard only. Each check starts from an explicitly chosen tab (not wherever the last key left
      // focus), so it can only pass if the key really moved focus and selection.
      const startAt = tab => page.evaluate(t => { ISO._reqDrawerSetTab(t); document.querySelector(`#iso-drawer-body [role="tab"][data-tab="${t}"]`).focus(); }, tab);
      const afterKey = async key => { await page.keyboard.press(key); await new Promise(r => setTimeout(r, 120)); return page.evaluate(() => ({ focused: document.activeElement?.dataset?.tab, selected: document.querySelector('#iso-drawer-body [role="tab"][aria-selected="true"]')?.dataset.tab, visible: [...document.querySelectorAll('#iso-drawer-body [role="tabpanel"]')].filter(p => !p.hidden).map(p => p.dataset.tab).join() })); };
      await startAt('assessment');
      const k1 = await afterKey('ArrowRight');
      ok(k1.focused === 'evidence' && k1.selected === 'evidence' && k1.visible === 'evidence', `ArrowRight moves focus and selection to the next tab (got ${JSON.stringify(k1)})`);
      await startAt('relationships');
      const k2 = await afterKey('End');
      ok(k2.focused === 'activity' && k2.selected === 'activity' && k2.visible === 'activity', 'End jumps from a middle tab to the last');
      await startAt('activity');
      const k3 = await afterKey('ArrowRight');
      ok(k3.focused === 'assessment' && k3.selected === 'assessment', 'ArrowRight on the last tab wraps to the first');
      await startAt('assessment');
      const k4 = await afterKey('ArrowLeft');
      ok(k4.focused === 'activity' && k4.selected === 'activity', 'ArrowLeft on the first tab wraps to the last');
      await startAt('relationships');
      const k5 = await afterKey('Home');
      ok(k5.focused === 'assessment' && k5.visible === 'assessment', 'Home jumps from a middle tab back to the first');

      // An unsaved Assessment edit survives a tab switch AND a drawer refresh (a posted comment).
      // D35/R2: gap description merged into Current system (P4) — #dr-gap is gone, #dr-cursys covers it.
      const typed = 'Gap noted during the walk-through: ' + Math.random().toString(36).slice(2, 8);
      await page.evaluate(() => ISO._reqDrawerSetTab('assessment')); // independent of where the keyboard checks left focus
      await page.focus('#dr-cursys');
      await page.keyboard.type(typed);
      await page.evaluate(() => ISO._reqDrawerSetTab('evidence'));
      await page.evaluate(() => ISO._reqDrawerSetTab('assessment'));
      ok((await page.$eval('#dr-cursys', el => el.value)).endsWith(typed), 'an unsaved edit survives switching tabs');
      await page.evaluate(() => ISO._reqDrawerSetTab('comments'));
      await page.type('#dr-comment', 'Spoke with the site supervisor.');
      await page.evaluate(() => [...document.querySelectorAll('#iso-drawer-body button')].find(b => b.textContent.trim() === 'Post')?.click());
      await new Promise(r => setTimeout(r, 1300));
      const afterComment = await page.evaluate(() => ({ selected: document.querySelector('#iso-drawer-body [role="tab"][aria-selected="true"]')?.dataset.tab, activity: document.getElementById('iso-rdp-comments')?.innerText || '', gap: document.getElementById('dr-cursys')?.value || '', note: !!document.querySelector('#iso-drawer-body .iso-draft-note') }));
      ok(afterComment.selected === 'comments' && /Spoke with the site supervisor/.test(afterComment.activity) && /Staff only/.test(afterComment.activity), 'posting a comment refreshes the drawer and stays on the Comments tab, labelled staff only');
      ok(afterComment.gap.endsWith(typed) && afterComment.note, 'the unsaved Assessment edit survived the refresh, flagged "Unsaved changes"');
      const before = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).find(r => r.id === r1.id);
      ok(!(before.current_system || '').includes(typed), 'nothing was saved by switching tabs or posting a comment');
      await page.evaluate(() => ISO._reqDrawerSetTab('assessment'));
      await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-assessment button')].find(b => b.textContent.trim() === 'Save')?.click());
      await new Promise(r => setTimeout(r, 1300));
      const saved = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).find(r => r.id === r1.id);
      ok((saved.current_system || '').endsWith(typed), 'Save persists the edit');
      ok(saved.assessment_state === before.assessment_state && saved.assessment_result === before.assessment_result, 'and changes nothing else about the assessment');
      await openReqDrawer(r1.id);
      ok(!(await page.evaluate(() => !!document.querySelector('#iso-drawer-body .iso-draft-note'))), 'after a save, reopening shows no unsaved-changes flag (the draft was cleared)');

      // Adding evidence comes back on the Evidence tab; a different requirement starts on Assessment.
      await page.evaluate((auditId, id) => ISO._openAddEvidence('requirement', id, auditId), board.id, r1.id);
      await new Promise(r => setTimeout(r, 400));
      await page.type('#evd-url', 'https://etcher.sharepoint.com/sites/qms/policy.pdf');
      await page.type('#evd-title', 'Quality policy (signed)');
      await page.evaluate((auditId, id) => ISO._evdAddApply('requirement', id, auditId), board.id, r1.id);
      await new Promise(r => setTimeout(r, 1300));
      const evTab = await page.evaluate(() => ({ selected: document.querySelector('#iso-drawer-body [role="tab"][aria-selected="true"]')?.dataset.tab, text: document.getElementById('iso-rdp-evidence')?.innerText || '', label: document.querySelector('#iso-drawer-body [role="tab"][data-tab="evidence"]')?.textContent }));
      ok(evTab.selected === 'evidence' && /Quality policy \(signed\)/.test(evTab.text), 'adding evidence reopens the drawer on the Evidence tab, showing the new item');
      ok(evTab.label === 'Evidence (1)', `the Evidence tab label carries the count (got ${JSON.stringify(evTab.label)})`);
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openReqDrawer(r2.id);
      ok((await page.evaluate(() => document.querySelector('#iso-drawer-body [role="tab"][aria-selected="true"]')?.dataset.tab)) === 'assessment', 'opening a different requirement starts on Assessment again');
      const titleText = await page.evaluate(() => document.getElementById('generic-modal-title')?.textContent || '');
      ok(/^ISO 14001:2026 /.test(titleText) && !/&amp;|&lt;|&gt;/.test(titleText), `the drawer title is plain text with the edition — no escaped entities (got ${JSON.stringify(titleText)})`);
    }

    // ── 8b.3: guidance, kept apart from the requirement text ────────────────────────────────
    if (on(3)) {
      // Pure helper first: approved entries shown, drafts hidden, merged evidence cells resolved.
      const { buildGuidance } = require(path.join(ROOT, 'api', '_iso.js'));
      const lib = { id: 'L1', version_id: 'V1', evidence_guidance: 'Quality policy\nObjectives register' };
      const libMerged = { id: 'L2', version_id: 'V1', evidence_guidance: null };
      const seedLib = { standardCode: '9001', edition: '2015', items: [
        { source: { row: 10, matchKey: 'k-top' }, imported: { evidenceExamples: 'Top-row examples', evidenceMergedFromRow: null } },
        { source: { row: 11, matchKey: 'k-merged' }, imported: { evidenceExamples: '', evidenceMergedFromRow: 10 } },
      ] };
      const seedGuide = { standardCode: '9001', edition: '2015',
        clauses: { '5.2': { explanation: 'Approved clause text', auditorLooksFor: 'A signed policy', status: 'approved' }, '6.1': { explanation: 'Draft clause text', status: 'draft' } },
        requirements: { 'k-top': { explanation: 'Approved requirement text', status: 'approved' } } };
      const g = buildGuidance({
        requirements: [
          { id: 'R1', clause: '5.2', stable_key: 'k-top', library_requirement_id: 'L1' },
          { id: 'R2', clause: '6.1', stable_key: 'k-merged', library_requirement_id: 'L2' },
          { id: 'R3', clause: '9.9', stable_key: 'k-none', library_requirement_id: null, imported: null },
        ],
        libReqById: { L1: lib, L2: libMerged }, versionById: { V1: { id: 'V1', standard_code: '9001', edition: '2015' } },
        guidanceSeeds: [seedGuide], librarySeeds: [seedLib],
      });
      ok(g.R1.evidenceExamples === lib.evidence_guidance, 'buildGuidance: evidence examples come from the pinned library row');
      ok(g.R1.clause && g.R1.clause.explanation === 'Approved clause text' && g.R1.clause.auditorLooksFor === 'A signed policy', 'buildGuidance: approved clause guidance is returned');
      ok(g.R1.requirement && g.R1.requirement.explanation === 'Approved requirement text', 'buildGuidance: approved requirement-level guidance is returned');
      ok(g.R2.clause === null, 'buildGuidance: a draft entry is never returned (no unreviewed text reaches auditors)');
      ok(g.R2.evidenceExamples === 'Top-row examples', 'buildGuidance: a merged evidence cell resolves to the row it was merged from');
      ok(g.R3.evidenceExamples === null && g.R3.clause === null && g.R3.requirement === null, 'buildGuidance: nothing known → all null, no placeholder');

      // The real op on the seeded board.
      const guidance = data(await callIso(ADMIN, { op: 'guidance.list', auditId: board.id })) || {};
      // R1 (2026-10-04): the live 9001 seed is v3's now.
      const seed9001 = JSON.parse(fs.readFileSync(path.join(ROOT, 'iso', 'seed', 'library', '9001-2026.json'), 'utf8'));
      const req41 = reqs.find(r => r.standard_code === '9001' && r.clause === '4.1');
      const seedItem41 = seed9001.items.find(i => i.source.matchKey === req41.stable_key);
      ok(guidance[req41.id] && guidance[req41.id].evidenceExamples === seedItem41.imported.evidenceExamples, 'guidance.list returns the workbook\'s examples for a seeded requirement, exactly');
      const mergedSeed = seed9001.items.find(i => i.imported.evidenceMergedFromRow != null);
      // The merged-evidence-cell artifact was a quirk of the old 2015 Excel sheet (two clauses
      // sharing one merged "Evidence Examples" cell); v3's clean, hand-maintained register has one
      // row per clause with its own cell, so this case has nothing real to exercise against right
      // now (the buildGuidance unit checks above already cover the merge-resolution logic itself).
      if (mergedSeed) {
        const mergedReq = reqs.find(r => r.stable_key === mergedSeed.source.matchKey);
        const mergedTop = seed9001.items.find(i => i.source.row === mergedSeed.imported.evidenceMergedFromRow);
        ok(mergedReq && guidance[mergedReq.id] && guidance[mergedReq.id].evidenceExamples === mergedTop.imported.evidenceExamples, 'a requirement whose evidence cell was merged shows the merged-from row\'s examples');
      } else {
        pass.push('no merged evidence cell in the live seed (v3 has none by construction) — covered by the buildGuidance unit check instead');
      }
      ok(Object.values(guidance).every(x => x.clause === null && x.requirement === null), 'the shipped guidance files hold no approved explanations yet (D25: examples only in the first release)');

      // In the drawer: Assessment tab, apart from the header, with the exact label.
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openBoardTab('requirements');
      await openReqDrawer(req41.id);
      const ui = await page.evaluate(() => {
        const card = document.querySelector('#iso-drawer-body .iso-guidance');
        return {
          present: !!card,
          inAssessment: !!card && !!card.closest('#iso-rdp-assessment'),
          inHeader: !!card && !!card.closest('.iso-drawer-header'),
          text: card ? card.innerText : '',
          internal: !!document.querySelector('#iso-drawer-body .iso-guidance-internal'),
        };
      });
      ok(ui.present && ui.inAssessment && !ui.inHeader, 'the guidance card sits in the Assessment tab, never inside the requirement-text header');
      ok(ui.text.includes('Guidance only. Suggested evidence is non-mandatory and non-exhaustive.'), 'the workbook examples carry the exact "Guidance only" label');
      ok(ui.text.includes(seedItem41.imported.evidenceExamples.split('\n')[0]), 'and show the real examples');
      ok(!ui.internal, 'no "Internal guidance" block is shown while no explanation is approved');
      const noEvidenceSeed = seed9001.items.find(i => !i.imported.evidenceExamples && i.imported.evidenceMergedFromRow == null);
      const noEvidenceReq = noEvidenceSeed && reqs.find(r => r.stable_key === noEvidenceSeed.source.matchKey);
      if (noEvidenceReq) {
        await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
        await openReqDrawer(noEvidenceReq.id);
        ok(!(await page.evaluate(() => !!document.querySelector('#iso-drawer-body .iso-guidance'))), 'a requirement with no examples and no guidance shows no guidance card at all');
      } else pass.push('(no requirement without examples in the seed — empty-card check skipped)');
      const clientCaller = await callIso({ id: 'cu1', role: 'client', clientId: 'c1' }, { op: 'guidance.list', auditId: board.id });
      ok([401, 403, 404].includes(clientCaller.status), `a client caller cannot read internal guidance (got ${clientCaller.status})`);
    }

    // ── 8b.4: evidence selector, evidence.link, Other evidence ──────────────────────────────
    if (on(4)) {
      const pick = (std, clause) => reqs.find(r => r.standard_code === std && r.clause === clause);
      const R1 = pick('9001', '7.5.1'), R2 = pick('14001', '7.5.1'), R3 = pick('9001', '7.5.2');
      const R4 = pick('14001', '7.5.2'), R5 = pick('14001', '7.5.3'), R6 = pick('14001', '8.1');
      ok([R1, R2, R3, R4, R5, R6].every(Boolean), 'six real requirements across 9001 and 14001 are picked as fixtures');
      const ASSESS_KEYS = ['assessment_state', 'assessment_result', 'applicability', 'effectiveness', 'risk_severity', 'row_version'];
      const snap = async () => Object.fromEntries((data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).filter(r => [R1, R2, R3, R4, R5, R6].some(x => x.id === r.id)).map(r => [r.id, ASSESS_KEYS.map(k => r[k])]));
      const before = await snap();

      // One record, three requirements, two standards — no duplication.
      const e1 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: R1.id, url: 'https://etcher.sharepoint.com/sites/ims/doc-control.docx', title: 'Document control procedure', versionLabel: '4' }));
      ok(e1 && e1.evidence && e1.link.role === 'primary', 'a new record is added to 9001 7.5.1 with the default role (primary)');
      const lk = await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: R2.id, evidenceIds: [e1.evidence.id], roles: { [e1.evidence.id]: 'supporting' } });
      await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: R3.id, evidenceIds: [e1.evidence.id] });
      const evRows = (await db.list('iso_evidence', {})).filter(e => e.title === 'Document control procedure');
      const e1Links = (await db.list('iso_evidence_links', {})).filter(l => l.evidence_id === e1.evidence.id);
      ok(evRows.length === 1, `still exactly one evidence record (got ${evRows.length})`);
      ok(e1Links.length === 3 && new Set(e1Links.map(l => l.target_id)).size === 3, `three link rows, one per requirement (got ${e1Links.length})`);
      ok(e1Links.find(l => l.target_id === R2.id).role === 'supporting' && lk.status === 200, 'the role is chosen per link (supporting on 14001 7.5.1)');
      const again = data(await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: R2.id, evidenceIds: [e1.evidence.id] }));
      ok(again && again.linked.length === 0 && again.skipped[0] === e1.evidence.id, 'linking the same record to the same requirement again is skipped, not duplicated');
      ok((await db.list('iso_evidence_links', {})).filter(l => l.evidence_id === e1.evidence.id).length === 3, 'and adds no row');
      const foreign = await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: R2.id, evidenceIds: ['ievi_doesnotexist'] });
      ok(foreign.status === 400, 'an evidence id that is not on this board is refused');

      // Other evidence: free-typed, no link.
      const interview = await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: R3.id, kind: 'interview', title: 'Interview with the document controller', versionLabel: 'n/a', evidenceDate: '2026-09-30', relevanceNote: 'Explains the approval chain', suggestRelated: false });
      const iv = data(interview);
      ok(interview.status === 200 && iv.evidence.kind === 'interview' && iv.evidence.url === null, `a free-typed interview is saved with no link (got ${interview.status} ${JSON.stringify(iv && { kind: iv.evidence.kind, url: iv.evidence.url })})`);
      ok(iv.evidence.suggest_related === false && iv.evidence.evidence_date === '2026-09-30' && iv.evidence.version_label === 'n/a', '"use for this requirement only", the evidence date and the revision are kept');
      ok(iv.link.relevance_note === 'Explains the approval chain', 'the "why it\'s relevant" note is stored on the link');
      const listed = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: R3.id })) || []).find(x => x.id === iv.evidence.id);
      ok(listed && listed.relevanceNote === 'Explains the approval chain' && listed.role === 'primary' && listed.suggestRelated === false, 'evidence.list returns role, relevance note and the only-here flag');
      const noUrlLink = await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: R3.id, kind: 'link', title: 'x' });
      const fileNoUrl = await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: R3.id, kind: 'file', title: 'x' });
      ok(noUrlLink.status === 400 && fileNoUrl.status === 400, 'a link type with no address, or a file type here, is refused');

      // Search: text, type, recently used, linked-to-target, and "used on related requirements".
      const s1 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, q: 'document controller' }));
      ok(s1.items.length === 1 && s1.items[0].id === iv.evidence.id, 'search finds by title text');
      const s2 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, kind: 'interview' }));
      ok(s2.items.every(x => x.kind === 'interview') && s2.items.length === 1, 'search filters by type');
      const s3 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, targetType: 'requirement', targetId: R2.id }));
      ok(s3.recentIds.includes(e1.evidence.id) && s3.recentIds.includes(iv.evidence.id), 'recently used lists what this user linked most recently');
      ok(s3.items.find(x => x.id === e1.evidence.id).linkedToTarget === true && s3.items.find(x => x.id === e1.evidence.id).linkCount === 3, 'items say whether they are already linked to this requirement, and how widely they are used');
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: R1.id, toId: R4.id, kind: 'shared_evidence', reasonText: 'Same document control system.' });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: R1.id, toId: R5.id, kind: 'supporting', reasonText: 'Records support document control.' });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: R3.id, toId: R6.id, kind: 'shared_evidence', reasonText: 'Same approval chain.' });
      const r4 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, targetType: 'requirement', targetId: R4.id }));
      const r5 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, targetType: 'requirement', targetId: R5.id }));
      const r6 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, targetType: 'requirement', targetId: R6.id }));
      ok(r4.relatedIds.includes(e1.evidence.id), 'evidence on a confirmed "shared evidence" neighbour shows as used on related requirements');
      ok(!r5.relatedIds.includes(e1.evidence.id), 'a "supporting" relationship never carries evidence across');
      ok(r6.relatedIds.includes(e1.evidence.id) && !r6.relatedIds.includes(iv.evidence.id), '"use for this requirement only" evidence is never offered to a related requirement');
      const after = await snap();
      ok(JSON.stringify(before) === JSON.stringify(after), 'none of the six requirements\' assessment state, result, applicability, effectiveness, risk or version changed');

      // UI: the selector, by keyboard alone, links the related evidence to 14001 7.5.2.
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openBoardTab('requirements');
      await openReqDrawer(R4.id);
      await page.evaluate(() => ISO._reqDrawerSetTab('evidence'));
      await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-evidence button')].find(b => b.textContent.trim() === '+ Add evidence')?.focus());
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1200));
      const sel = await page.evaluate((e1id) => ({
        focusedSearch: document.activeElement?.id === 'evd-search',
        relatedHasE1: !!document.querySelector(`#iso-evd-lists .iso-evd-group-related input[value="${e1id}"]`),
        groups: [...document.querySelectorAll('#iso-evd-lists .iso-evd-group')].map(g => g.className.replace(/.*iso-evd-group-/, '')),
      }), e1.evidence.id);
      ok(sel.focusedSearch, 'Enter on "+ Add evidence" opens the selector with focus in its search box');
      ok(sel.relatedHasE1, `the selector lists the shared evidence under "Used on related requirements" (groups: ${sel.groups.join(', ')})`);
      await page.keyboard.type('document control');
      await new Promise(r => setTimeout(r, 200));
      const filtered = await page.evaluate(() => [...document.querySelectorAll('#iso-evd-lists .iso-evd-pick')].filter(el => el.style.display !== 'none').length);
      ok(filtered >= 1, 'typing in the search box filters the lists');
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((e1id) => document.activeElement?.classList.contains('iso-evd-check') && document.activeElement.value === e1id, e1.evidence.id);
      }
      ok(reached, 'Tab reaches the record\'s checkbox');
      await page.keyboard.press('Space');
      let onSave = false;
      for (let i = 0; i < 60 && !onSave; i++) { await page.keyboard.press('Tab'); onSave = await page.evaluate(() => document.activeElement?.id === 'evd-save'); }
      ok(onSave, 'Tab reaches Save');
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));
      const r4Links = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: R4.id })) || []).map(x => x.id);
      ok(r4Links.includes(e1.evidence.id), 'keyboard only: the record is now linked to 14001 7.5.2');
      ok((await page.evaluate(() => document.querySelector('#iso-drawer-body [role="tab"][aria-selected="true"]')?.dataset.tab)) === 'evidence', 'and the drawer is back on its Evidence tab');

      // Already linked rows can't be picked twice; suggested examples fill the new record's title.
      await page.evaluate((auditId, id) => ISO._openAddEvidence('requirement', id, auditId), board.id, R2.id);
      await new Promise(r => setTimeout(r, 1200));
      const dis = await page.evaluate((e1id) => { const c = document.querySelector(`#iso-evd-lists input.iso-evd-check[value="${e1id}"]`); return c ? { disabled: c.disabled, text: c.closest('.iso-evd-pick').innerText } : null; }, e1.evidence.id);
      ok(dis && dis.disabled && /already linked/.test(dis.text), 'a record already linked to this requirement is shown but cannot be picked again');
      const ex = await page.evaluate(() => { const b = document.querySelector('.iso-evd-example'); if (!b) return null; b.click(); return { text: b.dataset.text, title: document.getElementById('evd-title').value }; });
      ok(!ex || (ex.text && ex.title === ex.text), ex ? 'clicking a suggested example fills in the new record\'s title (it is not itself a record)' : '(this requirement has no workbook examples — example check skipped)');
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      const finalSnap = await snap();
      ok(JSON.stringify(before) === JSON.stringify(finalSnap), 'after the whole selector flow, still no assessment field changed on any of them');
    }

    // ── 8b.5: derived suggestions and per-link review ───────────────────────────────────────
    if (on(5)) {
      const AUDITOR = { id: 'u2', role: 'staff' };     // made an auditor below — may review (can_verify)
      const CONTRIB = { id: 'u3', role: 'staff' };     // implicit contributor on this all-internal board — may not
      await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:u2', auditRole: 'auditor' });
      const relsAll = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      const busy = new Set(relsAll.flatMap(r => [r.from_id, r.to_id]));
      const free = (std, n, skip) => reqs.filter(r => r.standard_code === std && !busy.has(r.id) && !(skip || []).includes(r.id)).slice(0, n);
      const [S, S2] = free('9001', 2);
      const [T1, T2, T3, T4, U] = free('14001', 5);
      ok([S, S2, T1, T2, T3, T4, U].every(Boolean), 'seven requirements with no relationships yet are picked as fixtures');
      const ASSESS = ['assessment_state', 'assessment_result', 'applicability', 'effectiveness', 'risk_severity', 'row_version'];
      const snap = async () => JSON.stringify((data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).filter(r => [S, S2, T1, T2, T3, T4, U].some(x => x.id === r.id)).map(r => ASSESS.map(k => r[k])));
      const before = await snap();
      const sugFor = async t => (data(await callIso(ADMIN, { op: 'evidence.suggestions', auditId: board.id, targetId: t.id })) || []);
      const linkCount = async () => (await db.list('iso_evidence_links', {})).length;

      const E5 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: S.id, url: 'https://etcher.sharepoint.com/sites/ims/production-plan.docx', title: 'Production control plan', versionLabel: '2' })).evidence;
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: S.id, toId: T1.id, kind: 'shared_evidence', reasonText: 'One operational control plan for both.' });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: S.id, toId: T2.id, kind: 'supporting', reasonText: 'Supporting records only.' });
      await db.insert('iso_relationships', { id: 'irel_pending_t3', audit_id: board.id, from_id: S.id, to_id: T3.id, kind: 'shared_evidence', state: 'suggested', reason_code: 'manual', reason_text: 'Same plan.', source: 'manual', created_at: new Date().toISOString() });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: T1.id, toId: U.id, kind: 'shared_evidence', reasonText: 'Chained on purpose.' });
      const s1 = await sugFor(T1), s2 = await sugFor(T2), s3 = await sugFor(T3), sU = await sugFor(U);
      ok(s1.length === 1 && s1[0].evidenceId === E5.id && s1[0].source.id === S.id && s1[0].relationshipKind === 'shared_evidence', 'a confirmed "shared evidence" neighbour gets the suggestion, with its source requirement and relationship');
      ok(s1[0].source.edition === '2026' && s1[0].target.requirement_text === T1.requirement_text && s1[0].evidence.versionLabel === '2', 'the suggestion carries the source standard + edition, the target wording and the document revision');
      ok(s2.length === 0, 'a "supporting" relationship never carries a suggestion');
      ok(s3.length === 0, 'a relationship that is only suggested (not confirmed) carries no suggestion');
      ok(sU.length === 0, 'two hops away gets nothing (only one hop from where the evidence is actually linked)');
      const E6 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: S.id, kind: 'note', title: 'Only for this one', suggestRelated: false })).evidence;
      ok(!(await sugFor(T1)).some(s => s.evidenceId === E6.id), '"use for this requirement only" evidence is never suggested');
      const linksBeforeConfirm = await linkCount();
      await callIso(ADMIN, { op: 'relationship.decide', auditId: board.id, id: 'irel_pending_t3', decision: 'confirmed' });
      ok((await sugFor(T3)).some(s => s.evidenceId === E5.id), 'the suggestion appears once the relationship is confirmed, even though the evidence was linked first');
      ok((await linkCount()) === linksBeforeConfirm, 'suggestions are worked out, not stored — confirming the relationship wrote no link rows');

      // Confirm on T1 (as supporting) → a real, separate link with its own verdict "Not reviewed".
      const conf = await callIso(ADMIN, { op: 'evidence.decideSuggestion', auditId: board.id, evidenceId: E5.id, targetId: T1.id, decision: 'confirm', role: 'supporting', comment: 'Same plan covers environmental controls.' });
      const t1Link = data(conf);
      ok(conf.status === 200 && t1Link.target_id === T1.id && t1Link.role === 'supporting' && t1Link.review_status === 'submitted', 'confirming creates a separate link (role supporting, verdict "Not reviewed")');
      ok((await sugFor(T1)).length === 0, 'and the suggestion is gone');
      ok((await sugFor(U)).some(s => s.evidenceId === E5.id && s.source.id === T1.id), 'now that it is really linked to T1, T1\'s own confirmed neighbour gets a suggestion — one hop from a real link');
      // Reject on T3 → never comes back, even when another related requirement gets the same evidence.
      const rej = await callIso(ADMIN, { op: 'evidence.decideSuggestion', auditId: board.id, evidenceId: E5.id, targetId: T3.id, decision: 'reject', comment: 'Different process at this site.' });
      ok(rej.status === 200 && data(rej).review_status === 'rejected', 'rejecting stores a rejected link');
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: S2.id, toId: T3.id, kind: 'shared_evidence', reasonText: 'Also related.' });
      await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: S2.id, evidenceIds: [E5.id] });
      ok(!(await sugFor(T3)).some(s => s.evidenceId === E5.id), 'a rejected suggestion never reappears — not even through a second related requirement');
      const again = await callIso(ADMIN, { op: 'evidence.decideSuggestion', auditId: board.id, evidenceId: E5.id, targetId: T3.id, decision: 'confirm' });
      ok(again.status === 400, 'deciding a suggestion that no longer applies is refused');
      const acts = (await db.list('iso_activity', {})).filter(a => [T1.id, T3.id].includes(a.entity_id));
      ok(acts.some(a => a.action === 'evidence_suggestion_confirmed' && a.entity_id === T1.id) && acts.some(a => a.action === 'evidence_suggestion_rejected' && a.entity_id === T3.id), 'both decisions are logged on the requirement they concern');

      // Review: a reviewer's verdict, separate from the role; no self-review; comments where needed.
      const t1Rows = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: T1.id })) || []);
      const t1Row = t1Rows.find(x => x.id === E5.id);
      const selfReview = await callIso(ADMIN, { op: 'evidence.review', auditId: board.id, linkId: t1Row.linkId, verdict: 'accepted', expectedVersion: t1Row.linkRowVersion });
      ok(selfReview.status === 403, `the person who linked the evidence cannot review it (got ${selfReview.status})`);
      const contrib = await callIso(CONTRIB, { op: 'evidence.review', auditId: board.id, linkId: t1Row.linkId, verdict: 'accepted', expectedVersion: t1Row.linkRowVersion });
      ok(contrib.status === 403, `a contributor without review rights cannot record a verdict (got ${contrib.status})`);
      const noComment = await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: t1Row.linkId, verdict: 'insufficient', expectedVersion: t1Row.linkRowVersion });
      ok(noComment.status === 400, '"insufficient" needs a comment');
      const okReview = await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: t1Row.linkId, verdict: 'partially_sufficient', comment: 'Covers controls, not monitoring.', expectedVersion: t1Row.linkRowVersion });
      const reviewed = data(okReview);
      ok(okReview.status === 200 && reviewed.review_status === 'partially_sufficient' && reviewed.role === 'supporting' && reviewed.reviewed_by === 'offline:u2' && reviewed.reviewed_version_label === '2', 'an auditor records "partially sufficient"; the role stays supporting; the reviewed revision is kept');
      const stale = await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: t1Row.linkId, verdict: 'accepted', expectedVersion: t1Row.linkRowVersion });
      ok(stale.status === 409, 'a verdict based on an old version is refused');
      // The source link rejected → suggestions that came from it disappear, leaving nothing behind.
      const E7 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: S.id, url: 'https://example.com/old-plan.pdf', title: 'Superseded plan' })).evidence;
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: S.id, toId: T4.id, kind: 'shared_evidence', reasonText: 'Same plan family.' });
      ok((await sugFor(T4)).some(s => s.evidenceId === E7.id), 'E7 is suggested for T4');
      const sRow = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: S.id })) || []).find(x => x.id === E7.id);
      const n0 = await linkCount();
      await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: sRow.linkId, verdict: 'rejected', comment: 'Superseded.', expectedVersion: sRow.linkRowVersion });
      ok(!(await sugFor(T4)).some(s => s.evidenceId === E7.id) && (await linkCount()) === n0, 'once the source link is rejected the suggestion disappears, and no row was written for T4');
      ok((await snap()) === before, 'none of the seven requirements\' assessment state, result, applicability, effectiveness, risk or version changed');

      // Metrics and the register.
      const m = data(await callIso(ADMIN, { op: 'metric.audit', auditId: board.id }));
      ok(m.evidence_partial >= 1 && typeof m.evidence_insufficient === 'number' && m.evidence_suggested >= 1 && typeof m.evidence_accepted === 'number', `metric.audit reports partial / insufficient / suggested separately (got ${JSON.stringify({ a: m.evidence_accepted, p: m.evidence_partial, i: m.evidence_insufficient, s: m.evidence_suggested, sub: m.evidence_submitted })})`);
      const summary = data(await callIso(ADMIN, { op: 'evidence.summary', auditId: board.id }));
      ok(summary[T1.id] && summary[T1.id].partial === 1 && summary[U.id] && summary[U.id].suggested === 1, 'evidence.summary counts per requirement');
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openBoardTab('requirements');
      const reg = await page.evaluate((uId, t1Id) => {
        const tr = document.querySelector(`[data-ireq="${uId}"]`);
        return { flag: tr?.getAttribute('data-evd-suggested'), badge: tr?.querySelector('.iso-evd-sugg-badge')?.textContent || '', t1Flag: document.querySelector(`[data-ireq="${t1Id}"]`)?.getAttribute('data-evd-suggested') };
      }, U.id, T1.id);
      ok(reg.flag === '1' && /Evidence suggested/.test(reg.badge) && /⟳/.test(reg.badge), 'a requirement with a pending suggestion is marked "Evidence suggested" with an icon');
      ok(reg.t1Flag === '0', 'a requirement without one is not');
      // R3: the register's optional, per-type "Evidence" column (toggle + ◐/✓/✕ text breakdown) is
      // retired — reqDocCountHtml's row-level count is a placeholder until R4's Documents view ships
      // the real per-document list; the richer breakdown text isn't reproduced here on purpose.
      await page.evaluate(() => ISO._reqSetView('evidence_review'));
      await new Promise(r => setTimeout(r, 700));
      const viewIds = await page.evaluate(() => [...document.querySelectorAll('[data-ireq]')].map(tr => tr.dataset.ireq));
      ok(viewIds.includes(U.id) && viewIds.includes(S.id), 'the "Evidence to review" view lists requirements with a pending suggestion or a link awaiting review');
      ok(!viewIds.includes(T1.id), 'a requirement whose only link already has a final verdict is not "to review"');
      ok(!viewIds.includes(T2.id), 'and leaves out requirements with nothing to review');
      await page.evaluate(() => ISO._reqSetView('all'));
      await new Promise(r => setTimeout(r, 500));
      // The drawer: confirm a suggestion through the real buttons.
      await openReqDrawer(U.id);
      await page.evaluate(() => ISO._reqDrawerSetTab('evidence'));
      const sug = await page.evaluate(() => ({ text: document.querySelector('#iso-rdp-evidence .iso-evd-suggestions')?.innerText || '', buttons: [...document.querySelectorAll('#iso-rdp-evidence .iso-evd-sugg button')].map(b => b.textContent.trim()) }));
      ok(/Evidence suggested \(1\)/.test(sug.text) && /From ISO 14001:2026/.test(sug.text) && /Shared evidence/.test(sug.text), 'the drawer explains the suggestion: source standard and clause, relationship kind and reason');
      ok(['Confirm', 'Reject — not relevant', 'Select different evidence'].every(b => sug.buttons.includes(b)), 'with Confirm, Reject and Select different evidence');
      await page.evaluate(() => document.querySelector('#iso-rdp-evidence .iso-evd-sugg .iso-sugg-role').value = 'primary');
      await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-evidence .iso-evd-sugg button')].find(b => b.textContent.trim() === 'Confirm').click());
      await new Promise(r => setTimeout(r, 1400));
      ok((await sugFor(U)).length === 0 && (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: U.id })) || []).some(x => x.id === E5.id), 'confirming in the drawer links the evidence and clears the suggestion');
    }

    // ── 8b.6: the Evidence tab, the evidence drawer, supersede and the board-wide queue ───────
    if (on(6)) {
      const AUDITOR = { id: 'u2', role: 'staff' };
      const CONTRIB = { id: 'u3', role: 'staff' };     // implicit contributor — may link, may not review
      const RESTRICTED = { id: 'u9', role: 'restricted' }; // implicit reviewer — read only
      await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:u2', auditRole: 'auditor' }); // "already a member" if section 5 ran — harmless
      const relsAll = data(await callIso(ADMIN, { op: 'relationship.list', auditId: board.id })) || [];
      const busy = new Set(relsAll.flatMap(r => [r.from_id, r.to_id]));
      const used = new Set((await db.list('iso_evidence_links', {})).map(l => l.target_id));
      const free = (std, n) => reqs.filter(r => r.standard_code === std && !busy.has(r.id) && !used.has(r.id)).slice(0, n);
      const [P, P2] = free('9001', 2);
      const [Q1, Q2, Q3] = free('14001', 3);
      ok([P, P2, Q1, Q2, Q3].every(Boolean), 'five untouched requirements are picked as 8b.6 fixtures');
      const ASSESS = ['assessment_state', 'assessment_result', 'applicability', 'effectiveness', 'risk_severity', 'row_version'];
      const fixtureIds = [P, P2, Q1, Q2, Q3].map(r => r.id);
      const snap6 = async () => JSON.stringify((data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).filter(r => fixtureIds.includes(r.id)).map(r => ASSESS.map(k => r[k])));
      const before6 = await snap6();
      const sugAll = async () => (data(await callIso(ADMIN, { op: 'evidence.suggestions', auditId: board.id })) || []);
      const getE = async id => data(await callIso(ADMIN, { op: 'evidence.get', auditId: board.id, evidenceId: id }));
      const listFor = async (type, id) => (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: type, targetId: id })) || []);

      // One record used on two requirements, a finding and an action; Q1's link added by someone else.
      const E8 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: P.id, url: 'https://etcher.sharepoint.com/sites/ims/document-control-procedure.docx', title: 'Document control procedure', versionLabel: '3', evidenceDate: '2026-08-01' })).evidence;
      const cLink = await callIso(CONTRIB, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: Q1.id, evidenceIds: [E8.id], roles: { [E8.id]: 'supporting' } });
      ok(cLink.status === 200 && data(cLink).linked.length === 1, 'a contributor links the same record to a second requirement');
      const F = data(await callIso(ADMIN, { op: 'finding.create', auditId: board.id, requirementId: P.id, classification: 'observation', title: 'Procedure not yet issued to site' }));
      await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'finding', targetId: F.id, evidenceIds: [E8.id] });
      const A = data(await callIso(ADMIN, { op: 'action.create', auditId: board.id, targetType: 'finding', targetId: F.id, title: 'Issue the procedure to site' }));
      await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'action', targetId: A.id, evidenceIds: [E8.id] });
      await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: Q2.id, evidenceIds: [E8.id] });
      const pRow = (await listFor('requirement', P.id)).find(x => x.id === E8.id);
      const q2Row = (await listFor('requirement', Q2.id)).find(x => x.id === E8.id);
      await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: pRow.linkId, verdict: 'accepted', expectedVersion: pRow.linkRowVersion });
      await callIso(AUDITOR, { op: 'evidence.review', auditId: board.id, linkId: q2Row.linkId, verdict: 'rejected', comment: 'Different procedure at this site.', expectedVersion: q2Row.linkRowVersion });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: P.id, toId: Q3.id, kind: 'shared_evidence', reasonText: 'One document control system for both.' });
      await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: P2.id, toId: Q2.id, kind: 'integrated_topic', reasonText: 'Same records procedure.' });

      // evidence.get: reverse traceability, verdict per link, history.
      const g = await getE(E8.id);
      const targets = (g.links || []).map(l => l.targetType + ':' + l.targetId).sort();
      ok(JSON.stringify(targets) === JSON.stringify(['action:' + A.id, 'finding:' + F.id, 'requirement:' + P.id, 'requirement:' + Q1.id, 'requirement:' + Q2.id].sort()), `evidence.get lists every requirement, finding and action the record serves (got ${targets.length})`);
      const byT = Object.fromEntries(g.links.map(l => [l.targetId, l]));
      ok(byT[P.id]?.reviewStatus === 'accepted' && byT[Q1.id]?.reviewStatus === 'submitted' && byT[Q2.id]?.reviewStatus === 'rejected', 'each link keeps its own verdict — accepted for one requirement, not reviewed for another, rejected for a third');
      ok(byT[Q1.id]?.role === 'supporting' && byT[P.id]?.role === 'primary', 'and its own role');
      ok(byT[P.id]?.targetShort === `ISO 9001:2026 ${P.clause}` && byT[Q1.id]?.targetShort === `ISO 14001:2026 ${Q1.clause}` && byT[F.id]?.targetShort === 'Finding ' + F.ref && byT[A.id]?.targetShort === 'Action ' + A.ref, `targets are named with standard and edition, or as Finding/Action with their ref (got ${JSON.stringify(g.links.map(l => l.targetShort))})`);
      ok(g.history.filter(h => h.action === 'evidence_linked').length === 5 && g.history.filter(h => h.action === 'evidence_reviewed').length === 2 && g.history.some(h => h.action === 'created'), `the record's history holds its creation, its five links and both reviews (got ${JSON.stringify(g.history.map(h => h.action))})`);
      ok((await callIso(ADMIN, { op: 'evidence.get', auditId: board.id, evidenceId: 'ievi_nope' })).status === 404, 'an unknown record is not found');
      ok((await callIso({ id: 'cu1', role: 'client', clientId: 'c1' }, { op: 'evidence.get', auditId: board.id, evidenceId: E8.id })).status === 403, 'a client caller cannot read it');
      ok((await sugAll()).some(s => s.evidenceId === E8.id && s.targetId === Q3.id), 'before any supersede, E8 is suggested for its confirmed neighbour Q3');

      // The Evidence tab: same rows as evidence.search, review status as text + icon.
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await openBoardTab('evidence');
      const all = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id }));
      const tab = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.ws-tabstrip .ws-tab')].map(t => t.childNodes[0].textContent.trim()), active: document.querySelector('.ws-tabstrip .ws-tab.active')?.childNodes[0].textContent.trim(), rows: [...document.querySelectorAll('#iso-evd-tab tr[data-ievd]')].map(tr => tr.dataset.ievd) }));
      ok(tab.tabs.join('|') === 'Overview|Clauses|Documents|Actions' && tab.active === 'Documents', `the board's four tabs (wireframe); the Evidence register opens under Documents (got ${tab.tabs.join(' | ')}, active ${tab.active})`);
      ok(tab.rows.length === all.items.length && all.items.every(i => tab.rows.includes(i.id)), `the Evidence tab lists every record on the board (${tab.rows.length} rows, ${all.items.length} records)`);
      const e8Row = await page.evaluate(id => (document.querySelector(`#iso-evd-tab tr[data-ievd="${id}"]`)?.innerText || '').replace(/\s+/g, ' '), E8.id);
      ok(/SharePoint link/.test(e8Row) && /✓ 1 confirmed/.test(e8Row) && /○ 3 to review/.test(e8Row) && /⊘ 1 rejected/.test(e8Row), `its row shows the type and the review status as text and icon (got ${JSON.stringify(e8Row.slice(0, 220))})`);

      // The drawer, opened from the row: every target, the summary line, no anchors.
      await page.evaluate(id => document.querySelector(`#iso-evd-tab tr[data-ievd="${id}"] td:nth-child(2)`)?.click(), E8.id);
      await new Promise(r => setTimeout(r, 1300));
      const drw = await page.evaluate(() => ({ title: document.getElementById('generic-modal-title')?.textContent || '', links: [...document.querySelectorAll('#iso-evd-drawer .iso-evd-link')].map(e => e.innerText), summary: document.querySelector('#iso-evd-drawer .iso-evd-verdict-summary')?.innerText || '', anchors: document.querySelectorAll('#iso-evd-drawer a[href]').length, copy: [...document.querySelectorAll('#iso-evd-drawer button')].some(b => b.textContent.trim() === 'Copy link') }));
      ok(drw.title === `${E8.ref} — Document control procedure`, `clicking the row opens the evidence drawer, titled with ref and title (got ${JSON.stringify(drw.title)})`);
      ok(drw.links.length === 5 && [`ISO 9001:2026 ${P.clause}`, `ISO 14001:2026 ${Q1.clause}`, `ISO 14001:2026 ${Q2.clause}`, 'Finding ' + F.ref, 'Action ' + A.ref].every(s => drw.links.some(t => t.includes(s))), `the drawer lists all five targets (got ${drw.links.length})`);
      // Summary lines group their targets per standard: a coloured chip (Q/E/S) then that standard's clauses.
      const sum = await page.evaluate(() => [...document.querySelectorAll('#iso-evd-drawer .iso-evd-sum-line')].map(l => ({ text: l.innerText.replace(/\s+/g, ' '), groups: [...l.querySelectorAll('.iso-std-inline')].map(g => ({ std: g.dataset.std, chip: g.querySelector('.iso-std-chip')?.textContent || '', text: g.innerText.replace(/\s+/g, ' ') })) })));
      const lineFor = label => sum.find(l => l.text.includes(label)) || { text: '', groups: [] };
      const grp = (label, std) => lineFor(label).groups.find(g => g.std === std)?.text || '';
      ok(grp('Accepted for:', '9001').includes(P.clause) && lineFor('Accepted for:').groups.length === 1, `the summary says what it is accepted for, under the 9001 chip only (got ${JSON.stringify(lineFor('Accepted for:'))})`);
      ok(grp('Awaiting review for:', '14001').includes(Q1.clause) && ['Finding ' + F.ref, 'Action ' + A.ref].every(t => grp('Awaiting review for:', '').includes(t)), `…and what it is still awaiting review for, 14001 and the finding/action grouped apart (got ${JSON.stringify(lineFor('Awaiting review for:'))})`);
      ok(grp('Rejected for:', '14001').includes(Q2.clause), 'and where it was rejected');
      ok(lineFor('Awaiting review for:').groups.map(g => g.chip).join('|') === 'E|', `each standard group carries its letter chip (got ${JSON.stringify(lineFor('Awaiting review for:').groups.map(g => g.chip))})`);
      const usedOn = await page.evaluate(() => [...document.querySelectorAll('#iso-evd-drawer .iso-evd-links .iso-std-group')].map(g => ({ std: g.dataset.std, n: g.querySelectorAll('.iso-evd-link').length, color: getComputedStyle(g).borderLeftColor, head: g.querySelector('.iso-std-group-h')?.innerText.replace(/\s+/g, ' ') || '' })));
      ok(usedOn.map(g => g.std + ':' + g.n).join(',') === '9001:1,14001:2,:2', `"Used on" is grouped by standard in Q, E, S order, findings/actions last (got ${JSON.stringify(usedOn.map(g => g.std + ':' + g.n))})`);
      ok(new Set(usedOn.map(g => g.color)).size === usedOn.length && usedOn[0]?.color === 'rgb(13, 28, 51)' && usedOn[1]?.color === 'rgb(49, 88, 90)', `each group has its own standard colour (got ${JSON.stringify(usedOn.map(g => g.color))})`);
      ok(/ISO 9001:2026/.test(usedOn[0]?.head) && /Findings & actions/.test(usedOn[2]?.head), `group headers name the standard (got ${JSON.stringify(usedOn.map(g => g.head))})`);
      ok(drw.anchors === 0 && drw.copy, 'the address is plain text with Copy link — never an anchor');

      // A verdict recorded inside the evidence drawer (on the contributor's link) stays in the drawer.
      const reviewBox = await page.evaluate(id => { const row = document.querySelector(`#iso-evd-drawer .iso-evd-link[data-target-id="${id}"]`); return !!row?.querySelector('.iso-evd-review'); }, Q1.id);
      ok(reviewBox, 'someone else\'s link offers the reviewer controls in the evidence drawer');
      await page.evaluate(id => { const row = document.querySelector(`#iso-evd-drawer .iso-evd-link[data-target-id="${id}"]`); row.querySelector('.iso-evd-verdict').value = 'more_info_required'; row.querySelector('.iso-evd-review-comment').value = 'Which revision is on site?'; row.querySelector('.iso-evd-review button').click(); }, Q1.id);
      await new Promise(r => setTimeout(r, 1500));
      const afterRev = await page.evaluate(id => ({ open: !document.getElementById('generic-modal')?.classList.contains('hidden'), drawer: !!document.getElementById('iso-evd-drawer'), verdict: document.querySelector(`#iso-evd-drawer .iso-evd-link[data-target-id="${id}"] .iso-evd-link-verdict`)?.innerText || '' }), Q1.id);
      ok(afterRev.open && afterRev.drawer && /\?/.test(afterRev.verdict) && /More info needed/.test(afterRev.verdict), `the verdict is recorded and the evidence drawer reopens showing it (got ${JSON.stringify(afterRev)})`);
      const q1Now = ((await getE(E8.id)).links || []).find(l => l.targetId === Q1.id);
      ok(q1Now?.reviewStatus === 'more_info_required' && q1Now?.reviewedBy === 'offline:u1' && q1Now?.reviewComment === 'Which revision is on site?', 'the server holds that verdict, its reviewer and comment');

      // Supersede: revision 4 replaces revision 3 — first the refusals, then the real thing in the drawer.
      const E9 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: P2.id, url: 'https://etcher.sharepoint.com/sites/ims/document-control-procedure-r4.docx', title: 'Document control procedure', versionLabel: '4', evidenceDate: '2026-09-15' })).evidence;
      const E10 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: P2.id, kind: 'note', title: 'Spare record', suggestRelated: false })).evidence;
      const e8v = (await getE(E8.id)).rowVersion;
      ok((await callIso(RESTRICTED, { op: 'evidence.supersede', auditId: board.id, evidenceId: E8.id, byEvidenceId: E9.id, expectedVersion: e8v })).status === 403, 'a read-only viewer cannot supersede');
      ok((await callIso(ADMIN, { op: 'evidence.supersede', auditId: board.id, evidenceId: E8.id, byEvidenceId: E8.id, expectedVersion: e8v })).status === 400, 'a record cannot supersede itself');
      ok((await callIso(ADMIN, { op: 'evidence.supersede', auditId: board.id, evidenceId: E8.id, byEvidenceId: E9.id, expectedVersion: e8v + 7 })).status === 409, 'a stale version is refused');
      await openBoardTab('evidence');
      await page.evaluate(id => document.querySelector(`#iso-evd-tab tr[data-ievd="${id}"] td:nth-child(2)`)?.click(), E8.id);
      await new Promise(r => setTimeout(r, 1300));
      const supOpts = await page.evaluate(() => [...document.querySelectorAll('#iso-evd-supersede option')].map(o => o.value));
      ok(supOpts.includes(E9.id) && !supOpts.includes(E8.id), 'the drawer offers the board\'s other records as the replacement');
      await page.select('#iso-evd-supersede', E9.id);
      await page.evaluate(() => [...document.querySelectorAll('#iso-evd-drawer button')].find(b => b.textContent.trim() === 'Mark superseded')?.click());
      await new Promise(r => setTimeout(r, 1600));
      const supUi = await page.evaluate(() => ({ banner: document.querySelector('#iso-evd-drawer .iso-evd-superseded')?.innerText || '', supCard: !!document.querySelector('#iso-evd-drawer .iso-evd-supersede'), reviewBoxes: document.querySelectorAll('#iso-evd-drawer .iso-evd-review').length }));
      ok(supUi.banner.includes('Superseded by ' + E9.ref) && !supUi.supCard && supUi.reviewBoxes === 0, `the drawer reopens with a "Superseded by ${E9.ref}" banner and no further review or supersede controls (got ${JSON.stringify(supUi)})`);
      const g8 = await getE(E8.id), g9 = await getE(E9.id);
      const st8 = Object.fromEntries(g8.links.map(l => [l.targetId, l.reviewStatus]));
      ok(g8.supersededBy === E9.id && g8.supersededByRef === E9.ref, 'the old record now names its replacement');
      ok([P.id, Q1.id, F.id, A.id].every(id => st8[id] === 'superseded') && st8[Q2.id] === 'rejected', `its live links (accepted, more info, not reviewed) became "superseded"; the rejected one stayed rejected (got ${JSON.stringify(Object.values(st8))})`);
      ok(g8.links.length === 5, 'nothing was deleted — all five of its link rows are still there');
      const st9 = Object.fromEntries(g9.links.map(l => [l.targetId, l]));
      ok([P.id, Q1.id, F.id, A.id].every(id => st9[id] && st9[id].reviewStatus === 'submitted') && !st9[Q2.id] && st9[P2.id], `the new record took over each live target as "Not reviewed" — not the rejected one (got ${g9.links.length} links)`);
      ok(st9[Q1.id]?.role === 'supporting', 'each carried-over link keeps its role');
      const supActs = (await db.list('iso_activity', {})).filter(a => a.audit_id === board.id);
      ok([P.id, Q1.id, F.id, A.id].every(id => supActs.some(a => a.action === 'evidence_superseded' && a.entity_id === id)) && supActs.some(a => a.action === 'superseded' && a.entity_type === 'evidence' && a.entity_id === E8.id), 'superseding is logged on the record and on every target it served');
      ok((await callIso(ADMIN, { op: 'evidence.supersede', auditId: board.id, evidenceId: E8.id, byEvidenceId: E10.id, expectedVersion: g8.rowVersion })).status === 400, 'an already-superseded record cannot be superseded again');
      ok((await callIso(ADMIN, { op: 'evidence.supersede', auditId: board.id, evidenceId: E10.id, byEvidenceId: E8.id, expectedVersion: 1 })).status === 400, 'nor can a superseded record replace another');
      ok((await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: Q3.id, evidenceIds: [E8.id] })).status === 400, 'a superseded record can no longer be linked anywhere');
      const sugNow = await sugAll();
      ok(!sugNow.some(s => s.evidenceId === E8.id) && sugNow.some(s => s.evidenceId === E9.id && s.targetId === Q3.id), 'suggestions move to the current revision: Q3 now gets E9, never E8');
      const relQ3 = data(await callIso(ADMIN, { op: 'evidence.search', auditId: board.id, targetType: 'requirement', targetId: Q3.id }));
      ok(relQ3.relatedIds.includes(E9.id) && !relQ3.relatedIds.includes(E8.id), 'and "used on related requirements" offers E9, not E8');
      const s8 = relQ3.items.find(i => i.id === E8.id);
      ok(s8 && s8.supersededBy === E9.id && s8.linkSummary.superseded === 4 && s8.linkSummary.rejected === 1 && s8.linkCount === 0, `the search results mark E8 superseded and count no live use (got ${JSON.stringify(s8 && { by: s8.supersededBy, sum: s8.linkSummary, n: s8.linkCount })})`);
      const sumP = data(await callIso(ADMIN, { op: 'evidence.summary', auditId: board.id }))[P.id];
      ok(sumP && sumP.accepted === 0 && sumP.toReview === 1, 'P\'s acceptance belonged to revision 3 — revision 4 waits for its own review');
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      await page.evaluate((auditId, id) => ISO._openAddEvidence('requirement', id, auditId), board.id, Q3.id);
      await new Promise(r => setTimeout(r, 1200));
      const pick8 = await page.evaluate(id => { const c = document.querySelector(`#iso-evd-lists input.iso-evd-check[value="${id}"]`); return c ? { disabled: c.disabled, text: c.closest('.iso-evd-pick').innerText } : null; }, E8.id);
      ok(pick8 && pick8.disabled && /superseded/.test(pick8.text), `the selector still shows the superseded record but it cannot be picked (got ${JSON.stringify(pick8)})`);
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));

      // The board-wide queue matches evidence.suggestions; a batch writes one decision per requirement.
      await openBoardTab('evidence');
      await page.evaluate(() => ISO._evtSetView('queue'));
      await new Promise(r => setTimeout(r, 500));
      const expected = (await sugAll()).map(s => s.evidenceId + '|' + s.targetId).sort();
      const q = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.iso-evtq-row')].map(tr => tr.dataset.evidence + '|' + tr.dataset.targetId).sort(), btn: [...document.querySelectorAll('.iso-evt-view')].find(b => b.dataset.view === 'queue')?.innerText || '' }));
      ok(JSON.stringify(q.rows) === JSON.stringify(expected) && expected.length >= 2, `the "Evidence to review" queue lists exactly evidence.suggestions (${q.rows.length} rows, ${expected.length} suggestions)`);
      ok(q.btn.includes(`Evidence to review (${expected.length})`), `its button counts them (got ${JSON.stringify(q.btn)})`);
      const rowText = await page.evaluate((e, t) => document.querySelector(`.iso-evtq-row[data-evidence="${e}"][data-target-id="${t}"]`)?.innerText || '', E9.id, Q3.id);
      ok(rowText.includes(E9.ref) && rowText.includes('Document control procedure') && rowText.includes(`ISO 9001:2026 ${P.clause}`) && rowText.includes(`ISO 14001:2026 ${Q3.clause}`) && rowText.includes('One document control system for both.') && /\d{4}/.test(rowText), `a queue row names the evidence, source and target requirement with standard, the relationship reason and the date (got ${JSON.stringify(rowText.replace(/\s+/g, ' ').slice(0, 260))})`);
      const linksBefore = (await db.list('iso_evidence_links', {})).length;
      const confBefore = (await db.list('iso_activity', {})).filter(a => a.action === 'evidence_suggestion_confirmed').length;
      await page.evaluate((pairs) => { for (const [e, t] of pairs) document.querySelector(`.iso-evtq-row[data-evidence="${e}"][data-target-id="${t}"] .iso-evtq-check`).checked = true; }, [[E9.id, Q3.id], [E9.id, Q2.id]]);
      await page.select('#iso-evtq-role', 'supporting');
      await page.type('#iso-evtq-comment', 'Confirmed together at the review meeting.');
      await page.evaluate(() => [...document.querySelectorAll('.iso-evt-queue button')].find(b => b.textContent.trim() === 'Confirm selected')?.click());
      await new Promise(r => setTimeout(r, 2200));
      const newLinks = (await db.list('iso_evidence_links', {})).filter(l => l.evidence_id === E9.id && [Q3.id, Q2.id].includes(l.target_id));
      const confActs = (await db.list('iso_activity', {})).filter(a => a.action === 'evidence_suggestion_confirmed');
      ok((await db.list('iso_evidence_links', {})).length === linksBefore + 2 && newLinks.length === 2, `the batch wrote two separate link rows — one per requirement (got +${(await db.list('iso_evidence_links', {})).length - linksBefore})`);
      ok(newLinks.every(l => l.role === 'supporting' && l.review_status === 'submitted' && l.relevance_note === 'Confirmed together at the review meeting.'), 'each with the chosen role, "Not reviewed", and the comment');
      ok(confActs.length === confBefore + 2 && [Q3.id, Q2.id].every(id => confActs.some(a => a.entity_id === id && a.after && a.after.evidenceId === E9.id)), 'and two activity entries, one on each requirement');
      const qAfter = await page.evaluate(() => [...document.querySelectorAll('.iso-evtq-row')].map(tr => tr.dataset.evidence + '|' + tr.dataset.targetId));
      ok(!qAfter.includes(E9.id + '|' + Q3.id) && !qAfter.includes(E9.id + '|' + Q2.id) && qAfter.length === expected.length - 2, 'the queue refreshes from the server without them');
      // Timestamps are shown as the viewer's local date: 04:00 in Perth on 3 Oct is 20:00 UTC on 2 Oct.
      await db.log({ audit_id: board.id, client_id: board.client_id, entity_type: 'evidence', entity_id: E10.id, action: 'tz_probe', source: 'user', actor_uid: 'offline:u1', actor_kind: 'staff', at: '2026-10-02T20:00:00.000Z' });
      await page.emulateTimezone('Australia/Perth');
      await page.evaluate((auditId, id) => ISO.openEvidenceDrawer(auditId, id), board.id, E10.id);
      await new Promise(r => setTimeout(r, 1200));
      const tzLine = await page.evaluate(() => [...document.querySelectorAll('#iso-evd-drawer .iso-evd-history div')].map(d => d.innerText).find(t => /tz probe/.test(t)) || '');
      ok(/^3 Oct 2026/.test(tzLine), `a timestamp shows as the viewer's local date — "3 Oct" for 04:00 Perth time, not the UTC "2 Oct" (got ${JSON.stringify(tzLine)})`);
      await page.emulateTimezone();
      await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
      ok((await snap6()) === before6, 'across the whole 8b.6 flow, no assessment, applicability, effectiveness, risk or version field changed on any fixture requirement');
    }

    ok(errs.length === 0, `no console errors or native dialogs (got ${JSON.stringify(errs.slice(0, 8))})`);
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
