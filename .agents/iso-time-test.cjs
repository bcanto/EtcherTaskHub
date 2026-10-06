// Phase 7b.2 acceptance (D12): Timesheets' "ISO audit" mode — hours are ordinary Task Hub time
// entries logged against an ISO board (never a linked task — that design was replaced), carrying
// four frozen iso* fields. Fresh offline temp server with its own ISO_OFFLINE_DIR (never the
// shared :3001 server), real login, mirroring iso-ui-test.cjs's own setup style for the ISO side
// while exercising the real Timesheets UI/functions on the Task Hub side (plain DB.timeEntries,
// which this app's own --offline mode never syncs across browser contexts — see
// personal-boards-test.cjs's precedent comment — so everything here runs in ONE page/session).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3129;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-time-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe',
  });
  let browser = null;
  try {
    await waitForServer(PORT);

    // ── Seed an approved 9001 library (same minimal setup iso-ui-test.cjs uses) and one real
    // action (direct insert, bypassing the finding/requirement chain — not what this suite is
    // about; action.create/finding.create are already proven elsewhere). ─────────────────────────
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const sec = await db.insert('iso_clause_sections', { id: 'isec_1', version_id: 'iver_1', clause: '4', title: 'Context', level: 1, sort_key: 0 });
    await db.insert('iso_standard_versions', { id: 'iver_1', standard_code: '9001', label: 'Test v1', status: 'approved' });
    await db.insert('iso_library_requirements', { id: 'ilr_1', version_id: 'iver_1', section_id: sec.id, clause: '4.1', clause_name: 'Context', requirement_text: 'Understand the organisation.', stable_key: '9001|4.1|abc|0', sort_key: 0 });

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1200));
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1800));

    // Real audit.create (needs the approved library above) + one real action, direct-inserted.
    const setup = await page.evaluate(async () => {
      const audit = await ISO.api('audit.create', { clientId: 'c0', standards: ['9001'], title: 'ISO 9001 — Time Test' });
      return { auditId: audit.id, ref: audit.ref };
    });
    ok(!!setup.auditId, `a real ISO audit was created for the Timesheets picker to find (got ${JSON.stringify(setup)})`);
    const actionRow = await db.insert('iso_actions', {
      id: 'iact_timetest1', audit_id: setup.auditId, client_id: 'c0', ref: setup.ref + '-A001', title: 'Retrain staff on the procedure',
      owner_kind: 'etcher', status: 'in_progress', verification_status: 'not_verified', progress: 0, reopened_count: 0,
      visibility: 'internal', root_cause_method: 'none', cause_categories: [],
    });
    ok(!!actionRow.id, 'a real open, Etcher-owned action exists on that audit');

    // ── timeTarget.list surfaces the board and its one open action ─────────────────────────────
    const targets = await page.evaluate(async () => ISO.timeTargets());
    const ourTarget = targets.find(t => t.auditId === setup.auditId);
    ok(!!ourTarget, 'timeTarget.list returns the board the caller can see');
    ok(ourTarget && ourTarget.actions.length === 1 && ourTarget.actions[0].id === 'iact_timetest1', `timeTarget.list's actions array has exactly our one open Etcher-owned action (got ${JSON.stringify(ourTarget && ourTarget.actions)})`);
    ok(ourTarget && ourTarget.standards.includes('9001'), 'the target carries its real standard codes');

    // ── Real Timesheets UI: ISO toggle appears, switching to it loads the picker ────────────────
    await page.evaluate(() => window.navigate('time'));
    await new Promise(r => setTimeout(r, 500));
    const hasIsoToggle = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'ISO audit'));
    ok(hasIsoToggle, 'the Timesheets Log Time form offers an "ISO audit" toggle (ISO is enabled)');
    await page.evaluate(() => _teSetMode('iso'));
    await new Promise(r => setTimeout(r, 900));
    const boardSelectHtml = await page.evaluate(() => document.getElementById('te-iso-board')?.innerHTML || '');
    ok(boardSelectHtml.includes(setup.auditId) || new RegExp(setup.ref).test(boardSelectHtml), `the real ISO board appears in the board select (got snippet: ${JSON.stringify(boardSelectHtml.slice(0, 200))})`);

    // ── Log a real entry against the board + action, via the real form + logTime() ─────────────
    await page.evaluate((auditId) => { document.getElementById('te-iso-board').value = auditId; _teIsoBoardChanged(auditId); }, setup.auditId);
    await new Promise(r => setTimeout(r, 200));
    const actionSelectHtml = await page.evaluate(() => document.getElementById('te-iso-action')?.innerHTML || '');
    ok(/Retrain staff on the procedure/.test(actionSelectHtml), 'choosing the board populates its Action select with the real action');
    await page.evaluate(() => { document.getElementById('te-iso-action').value = 'iact_timetest1'; });
    await page.evaluate(() => { document.getElementById('te-hours').value = '3'; document.getElementById('te-date').value = '2026-01-06'; document.getElementById('te-note').value = 'ISOTIMETEST entry with an action.'; });
    await page.evaluate(() => logTime());
    await new Promise(r => setTimeout(r, 500));
    const entryWithAction = await page.evaluate(() => (DB.timeEntries || []).find(e => (e.note || '').startsWith('ISOTIMETEST entry with an action')));
    ok(!!entryWithAction, 'a real time entry was created from the ISO form');
    ok(entryWithAction && entryWithAction.taskId === null, 'the ISO entry carries taskId:null — hours are logged against the board directly, no linked task');
    ok(entryWithAction && entryWithAction.clientId === 'c0', 'the ISO entry inherits the board\'s own clientId');
    ok(entryWithAction && entryWithAction.isoAuditId === setup.auditId && entryWithAction.isoActionId === 'iact_timetest1' && entryWithAction.isoActionRef === setup.ref + '-A001', `all four iso* fields are set correctly (got ${JSON.stringify({ isoAuditId: entryWithAction?.isoAuditId, isoActionId: entryWithAction?.isoActionId, isoActionRef: entryWithAction?.isoActionRef })})`);
    ok(entryWithAction && /^ISO · /.test(entryWithAction.isoLabel || ''), `isoLabel is frozen in the "ISO · <ref> · <standards>" shape (got ${JSON.stringify(entryWithAction && entryWithAction.isoLabel)})`);

    // ── "General audit work" (no action) also works. logTime()'s own renderView('time') re-render
    // resets the board select back to its "Choose an ISO board" placeholder (same as Task/Client
    // mode resetting their own selects after every submit) — re-pick the board first. ─────────────
    await page.evaluate((auditId) => { document.getElementById('te-iso-board').value = auditId; _teIsoBoardChanged(auditId); }, setup.auditId);
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => { document.getElementById('te-iso-action').value = ''; document.getElementById('te-hours').value = '1'; document.getElementById('te-note').value = 'ISOTIMETEST general audit work.'; });
    await page.evaluate(() => logTime());
    await new Promise(r => setTimeout(r, 500));
    const generalEntry = await page.evaluate(() => (DB.timeEntries || []).find(e => (e.note || '').startsWith('ISOTIMETEST general audit work')));
    ok(!!generalEntry && generalEntry.isoAuditId && !generalEntry.isoActionId, `"General audit work" logs a real entry tied to the board with no action (got isoActionId=${JSON.stringify(generalEntry && generalEntry.isoActionId)})`);

    // ── Display: the entry row, timeEntryForReport, recent chips, and the mobile quick-log sheet
    // all show the ISO label where a task name would normally go. ──────────────────────────────
    await page.evaluate(() => renderView('time'));
    await new Promise(r => setTimeout(r, 400));
    const rowText = await page.evaluate(() => document.body.innerText);
    ok(rowText.includes(setup.ref + '-A001'), 'the real register row shows the ISO entry\'s action ref where a task name would go');

    const reportShape = await page.evaluate((id) => timeEntryForReport((DB.timeEntries || []).find(e => e.id === id)), entryWithAction.id);
    ok(reportShape.taskTitle.includes(setup.ref + '-A001'), `timeEntryForReport's taskTitle shows the ISO action ref (got ${JSON.stringify(reportShape.taskTitle)})`);

    const recent = await page.evaluate(() => _teRecentTargets());
    ok(recent.some(r => r.isoAuditId === setup.auditId && r.isoActionId === 'iact_timetest1'), 'the recent-targets chips include the real ISO entry, carrying its iso* fields forward for one-tap repeat');

    // ── Hours logged on the action drawer (7.5) ─────────────────────────────────────────────────
    await page.evaluate((auditId) => { ISO.openBoard(auditId); }, setup.auditId);
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate(() => ISO.setTab('actions'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, 'iact_timetest1');
    await new Promise(r => setTimeout(r, 700));
    const hoursLoggedText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    // Only the 3h entry carries THIS action's id — the 1h "General audit work" entry is real
    // ISO time but has no isoActionId, so it correctly does not count toward this specific
    // action's own hours (it would show up in a future audit-wide hours total instead).
    ok(/Hours logged:\s*3h/.test(hoursLoggedText), `the action drawer shows real hours logged from Task Hub time entries, scoped to just this action (got snippet: ${JSON.stringify(hoursLoggedText.match(/Hours logged:[^\n]*/)?.[0])})`);
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));

    // ── Submit → approve works the same as any other entry ─────────────────────────────────────
    const approveResult = await page.evaluate((id) => { tsApproveEntry(id); const e = (DB.timeEntries || []).find(x => x.id === id); return e && e.status; }, entryWithAction.id);
    ok(approveResult === 'approved', `an ISO time entry can be approved exactly like any other (got status=${approveResult})`);

    // ── Phase 7b.3 (D13): the Timesheet report's own ISO board filter ──────────────────────────
    await page.evaluate(() => window.navigate('reports'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => { rptTab = 'timesheet'; renderView('reports'); });
    await new Promise(r => setTimeout(r, 500));
    const isoFilterOptsHtml = await page.evaluate(() => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'ISO board')?.nextElementSibling?.innerHTML || '');
    ok(/Any ISO work/.test(isoFilterOptsHtml) && new RegExp(setup.ref).test(isoFilterOptsHtml.replace(/·/g, ' ')), `the Timesheet report's ISO board filter offers "Any ISO work" and the real board (got snippet: ${JSON.stringify(isoFilterOptsHtml.slice(0, 200))})`);
    // Asserted directly on _tsFilterEntries()'s own returned set (isoAuditId truthy / exact match),
    // not re-filtered by this suite's own ISOTIMETEST note marker — a note-based re-filter on top
    // would still land on exactly these two entries even if tsIsoFilter's own logic were a no-op
    // returning everything, silently hiding a real regression (caught the hard way: this was the
    // test's first shape, and an adversarial check that deleted both isoFilter lines passed clean).
    const anyIsoShape = await page.evaluate(() => { tsIsoFilter = 'any_iso'; const rows = _tsFilterEntries(); return { count: rows.length, allHaveIso: rows.every(e => !!e.isoAuditId) }; });
    ok(anyIsoShape.allHaveIso, `"Any ISO work" never includes a non-ISO entry (got ${JSON.stringify(anyIsoShape)})`);
    ok(anyIsoShape.count === 2, `"Any ISO work" returns exactly the two ISO entries this suite created, nothing else (got ${anyIsoShape.count})`);
    const specificBoardShape = await page.evaluate((auditId) => { tsIsoFilter = auditId; const rows = _tsFilterEntries(); return { count: rows.length, allMatch: rows.every(e => e.isoAuditId === auditId) }; }, setup.auditId);
    ok(specificBoardShape.allMatch && specificBoardShape.count === 2, `filtering by the specific board id returns exactly its own two entries, nothing from another board (got ${JSON.stringify(specificBoardShape)})`);
    const allVsAnyIso = await page.evaluate(() => { tsIsoFilter = 'all'; const before = _tsFilterEntries().length; tsIsoFilter = 'any_iso'; const after = _tsFilterEntries().length; tsIsoFilter = 'all'; return { before, after }; });
    ok(allVsAnyIso.after < allVsAnyIso.before, `"Any ISO work" returns STRICTLY fewer rows than "All work" — this fixture has real non-ISO entries too, so an isoFilter that does nothing would fail this (got ${JSON.stringify(allVsAnyIso)})`);
    await page.evaluate(() => { tsIsoFilter = 'all'; });
    const detailTableHtml = await page.evaluate((auditId) => { tsIsoFilter = auditId; renderView('reports'); const html = document.getElementById('rpt-body')?.innerText || ''; tsIsoFilter = 'all'; return html; }, setup.auditId);
    ok(detailTableHtml.includes(setup.ref + '-A001'), `_tsDetailTable's own Task column shows the ISO action ref too (got snippet containing: ${JSON.stringify(detailTableHtml.slice(0, 300))})`);

    // ── Phase 7b.3 (D13): the "ISO audits" Reports tab — real metric.audit numbers, real hours ──
    const directMetric = await page.evaluate((auditId) => ISO.api('metric.audit', { auditId }), setup.auditId);
    await page.evaluate(() => { rptTab = 'iso'; renderView('reports'); });
    await new Promise(r => setTimeout(r, 1200));
    const isoTabText = await page.evaluate(() => document.getElementById('rpt-iso-body')?.innerText || '');
    ok(isoTabText.includes(setup.ref), `the ISO audits tab lists the real board by ref (got snippet: ${JSON.stringify(isoTabText.slice(0, 120))})`);
    ok(isoTabText.includes('9001'), 'the ISO audits tab shows the real standard code');
    ok(new RegExp(directMetric.findings_open + '\\s').test(isoTabText) || isoTabText.includes(String(directMetric.findings_open)), `the open-findings column equals the real metric.audit value (got ${directMetric.findings_open}, row text: ${JSON.stringify(isoTabText.slice(0, 300))})`);
    ok(isoTabText.includes(directMetric.actions_overdue + ''), `the overdue-actions column equals the real metric.audit value (got ${directMetric.actions_overdue})`);
    ok(/4\.0h/.test(isoTabText), `the Hours column sums all of this board's time entries regardless of action (3h + 1h = 4.0h total, got snippet: ${JSON.stringify(isoTabText.match(/\d+\.\dh/g))})`);
    ok(/3\.0h/.test(isoTabText), 'the Approved column reflects only the one entry that was actually approved (3h, not 4h)');
    const hoursColumns = await page.evaluate(() => [...(document.querySelector('#rpt-iso-body table')?.innerText.match(/\d+\.\dh/g) || [])]);
    ok(hoursColumns.length === 3 && hoursColumns.every(h => h === '4.0h' || h === '3.0h'), `exactly 3 hours columns render (Hours/Approved/Billable), all drawn from the real entries (got ${JSON.stringify(hoursColumns)})`);

    // CSV/Excel export don't throw and produce a real download (a Blob URL is created).
    const exportOk = await page.evaluate(() => {
      let created = false;
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = (b) => { created = true; return realCreate.call(URL, b); };
      try { ISO._rptExportCsv(); } finally { URL.createObjectURL = realCreate; }
      return created;
    });
    ok(exportOk, 'the ISO audits tab\'s CSV export runs without throwing and creates a real downloadable file');

    // ── Phase 7b.4 (R2/R7): Pro forma — an approved ISO entry imports as its own project line.
    // Deliberately NOT extended into pf-import-test.cjs (which runs against the shared gate dev
    // server, not a throwaway temp instance) the way the plan's own prose suggests — every other
    // ISO suite in this session uses its own disposable ISO_OFFLINE_DIR specifically so nothing
    // ISO-shaped ever accumulates in the shared server's persistent store (no-hard-delete is a
    // hard rule here too, so a board created there would never be cleanable). All ISO-side pro
    // forma coverage lives here instead, where the fixtures already exist and cleanup is "throw
    // the whole temp dir away." ──────────────────────────────────────────────────────────────────
    const pfiResult = await page.evaluate(async (auditId) => {
      const inv = { id: 'pfi' + Math.random().toString(36).slice(2), number: 'TEST-1', clientId: 'c0', dateFrom: '2026-01-01', dateTo: '2026-01-31', issueDate: '2026-01-31', status: 'draft', preparedById: currentUser.id, notes: '', clientNotes: '', lineItems: [], comments: [], auditEvents: [], createdAt: new Date().toISOString(), createdByUserId: currentUser.id, updatedAt: new Date().toISOString() };
      DB.proFormaInvoices = DB.proFormaInvoices || []; DB.proFormaInvoices.push(inv);
      saveDB(DB);
      return { invId: inv.id };
    }, setup.auditId);

    const beforeTimeEntriesSnapshot = await page.evaluate(() => JSON.stringify(DB.timeEntries));

    await page.evaluate(() => window.navigate('reports'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => { rptTab = 'invoice'; pfiCurrentId = DB.proFormaInvoices[DB.proFormaInvoices.length - 1].id; renderView('reports'); });
    await new Promise(r => setTimeout(r, 500));

    const importShape = await page.evaluate((args) => {
      // pfiConfirmImport reads checked .pfi-import-cb boxes from whatever modal is open — call it
      // directly against our one approved ISO entry rather than driving the whole "Import time
      // entries" modal's own candidate-filtering UI, which is already proven generically by
      // pf-import-test.cjs for plain task/client entries.
      document.body.insertAdjacentHTML('beforeend', `<input type="checkbox" class="pfi-import-cb" value="${args.entryId}" checked style="display:none"/>`);
      pfiConfirmImport(args.invId);
      document.querySelector('.pfi-import-cb')?.remove();
      const line = (DB.proFormaInvoices.find(i => i.id === args.invId).lineItems || [])[0];
      return line ? { taskTitle: line.taskTitle, boardId: line.boardId, boardName: line.boardName, hours: line.hours } : null;
    }, { invId: pfiResult.invId, entryId: entryWithAction.id });
    ok(!!importShape && importShape.taskTitle === setup.ref + '-A001', `the imported line's taskTitle is the real action ref, not a blank task (got ${JSON.stringify(importShape)})`);
    ok(!!importShape && importShape.boardId === 'iso:' + setup.auditId, `the imported line's boardId is the real "iso:<auditId>" shape so it groups as its own project`);
    ok(!!importShape && /^ISO · /.test(importShape.boardName || ''), `the imported line's boardName is the real frozen isoLabel (got ${JSON.stringify(importShape && importShape.boardName)})`);
    ok(!!importShape && importShape.hours === 3, `the imported line carries the entry's real hours (got ${importShape && importShape.hours})`);

    // Grouping "by task/project" shows the ISO board as its own project, automatically, from the
    // same boardId/boardName fields just set — no separate grouping code needed (confirmed by
    // reading _rptInvoiceHtml's own groupKey/groupLabel directly, not assumed from the plan's text).
    const groupedProjectLabel = await page.evaluate((invId) => {
      pfiGroupBy = 'task';
      const li = DB.proFormaInvoices.find(i => i.id === invId).lineItems[0];
      return li.boardName || li.taskTitle || 'No Project';
    }, pfiResult.invId);
    ok(/^ISO · /.test(groupedProjectLabel), `"by project" grouping shows the real ISO board label, not "No Project" (got ${JSON.stringify(groupedProjectLabel)})`);

    // The "never writes back" rule (§3.5): editing the line, pfiSyncAll, and deleting the invoice
    // must all leave DB.timeEntries byte-identical to before any of this started.
    await page.evaluate((invId) => {
      const li = DB.proFormaInvoices.find(i => i.id === invId).lineItems[0];
      li.hours = 99; li.description = 'edited on the invoice, not the source'; li.descriptionEdited = true;
      saveDB(DB);
    }, pfiResult.invId);
    await page.evaluate((invId) => { pfiSyncAll(invId); }, pfiResult.invId);
    await page.evaluate((invId) => { DB.proFormaInvoices = (DB.proFormaInvoices || []).filter(i => i.id !== invId); saveDB(DB); }, pfiResult.invId);
    const afterTimeEntriesSnapshot = await page.evaluate(() => JSON.stringify(DB.timeEntries));
    ok(afterTimeEntriesSnapshot === beforeTimeEntriesSnapshot, '§3.5 "never writes back": editing the invoice line, pfiSyncAll, and deleting the invoice leave every DB.timeEntries record byte-identical to before');

    // ── Phase 7b.5 (R9): Digest — client-safe ISO progress lines ────────────────────────────────
    // Enable the client portal on our board first — digest.items must stay empty until then.
    const digestBefore = await page.evaluate((auditId) => ISO.api('digest.items', { clientId: 'c0' }), setup.auditId);
    ok(Array.isArray(digestBefore.lines) && digestBefore.lines.length === 0, `digest.items returns no lines for a board whose client portal isn't enabled yet (got ${JSON.stringify(digestBefore.lines)})`);

    const SENTINEL = 'SENTINEL-' + Math.random().toString(36).slice(2, 8);
    const enableResult = await page.evaluate(async (args) => {
      const a = await ISO.api('audit.get', { auditId: args.auditId });
      // Salt every plausible internal/free-text field this audit has with the sentinel before
      // enabling the portal, so the sweep below is a real proof, not a coincidence of digest.items
      // never having been given anything to leak in the first place.
      await ISO.api('audit.update', { auditId: args.auditId, patch: { client_portal_enabled: true, internal_notes: args.sentinel, scope_text: args.sentinel }, expectedVersion: a.row_version, reason: 'enable for digest test' });
    }, { auditId: setup.auditId, sentinel: SENTINEL });
    const digestAfter = await page.evaluate(() => ISO.api('digest.items', { clientId: 'c0' }));
    ok(digestAfter.lines.some(l => l.includes(setup.ref)), `digest.items now returns a real line for the board once its client portal is enabled (got ${JSON.stringify(digestAfter.lines)})`);
    ok(digestAfter.lines.some(l => /\d+% of requirements assessed/.test(l)), `the assessment-progress line has a real computed percentage (got ${JSON.stringify(digestAfter.lines)})`);
    const sentinelLeak = digestAfter.lines.some(l => l.includes('SENTINEL'));
    ok(!sentinelLeak, `the sentinel sweep: no internal/free-text field (internal_notes, scope_text) ever appears in digest.items (got ${JSON.stringify(digestAfter.lines)})`);

    // A second, private (portal-disabled) board for the SAME client adds no lines of its own.
    const privateAudit = await page.evaluate(async () => ISO.api('audit.create', { clientId: 'c0', standards: ['9001'], title: 'Private board — should not appear in digest' }));
    const digestWithPrivate = await page.evaluate(() => ISO.api('digest.items', { clientId: 'c0' }));
    ok(digestWithPrivate.lines.length === digestAfter.lines.length && !digestWithPrivate.lines.some(l => l.includes(privateAudit.ref)), `a private (portal-disabled) board for the same client adds no lines (got ${JSON.stringify(digestWithPrivate.lines)})`);

    // "Add ISO progress" / client-switch wiring: digest.items appends into #dg-items.
    await page.evaluate(() => window.navigate('digest'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => openCreateDigest());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { document.getElementById('dg-client').value = 'c0'; _dgOnClientChange('c0'); });
    await new Promise(r => setTimeout(r, 1200));
    const dgItemsText = await page.evaluate(() => document.getElementById('dg-items')?.value || '');
    ok(dgItemsText.includes(setup.ref), `switching the New Digest form to a client with ISO boards appends the real ISO progress lines (got ${JSON.stringify(dgItemsText)})`);

    // Switching client mid-fetch must not append stale lines meant for the PREVIOUS client.
    await page.evaluate(() => { document.getElementById('dg-items').value = ''; });
    await page.evaluate(() => { _dgOnClientChange('c0'); document.getElementById('dg-client').value = ''; }); // switch away before the fetch resolves
    await new Promise(r => setTimeout(r, 1200));
    const dgItemsAfterSwitch = await page.evaluate(() => document.getElementById('dg-items')?.value || '');
    ok(!dgItemsAfterSwitch.includes(setup.ref), `switching the client away before digest.items resolves leaves no stale lines behind (got ${JSON.stringify(dgItemsAfterSwitch)})`);
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));

    // ── Deleting the Workboards task/board underneath has nothing to touch — ISO entries carry
    // no taskId at all, confirmed by construction above, not re-proven with a deletion here since
    // there is no linked task to delete in the first place (that is the whole point of D12). ─────

    // ── _mergeDB of a stale copy keeps the iso* fields: build an `incoming` snapshot that is a
    // genuinely STALE, pre-ISO-fields copy of the same record (older updatedAt, iso* fields
    // stripped, as if synced before this entry was ever logged against the board) and confirm
    // merging it into the live `current` does not overwrite the real record's iso* fields — the
    // generic by-id merge compares updatedAt and the newer (current, real) side should win. ──────
    const mergeResult = await page.evaluate((id) => {
      const current = JSON.parse(JSON.stringify(DB)); // clone — never mutate the live DB here
      const live = current.timeEntries.find(e => e.id === id);
      const incoming = JSON.parse(JSON.stringify(current));
      const staleEntry = incoming.timeEntries.find(e => e.id === id);
      delete staleEntry.isoAuditId; delete staleEntry.isoLabel; delete staleEntry.isoActionId; delete staleEntry.isoActionRef;
      staleEntry.updatedAt = '2020-01-01T00:00:00.000Z';
      const merged = _mergeDB(current, incoming);
      const after = (merged.timeEntries || []).find(e => e.id === id);
      return { before: { isoAuditId: live.isoAuditId, isoActionId: live.isoActionId }, after: after ? { isoAuditId: after.isoAuditId, isoActionId: after.isoActionId } : null };
    }, entryWithAction.id);
    ok(!!mergeResult.after && mergeResult.after.isoAuditId === mergeResult.before.isoAuditId && mergeResult.after.isoActionId === mergeResult.before.isoActionId, `_mergeDB keeps the real (newer) record's iso* fields over a stale incoming copy that lacks them (got ${JSON.stringify(mergeResult)})`);

    // ── Inline target editing clears the iso* fields when switching an ISO entry to a client ───
    const switchedAway = await page.evaluate((id) => {
      _tePickClient(id, 'c0');
      const e = (DB.timeEntries || []).find(x => x.id === id);
      return { hasIso: !!e.isoAuditId, clientId: e.clientId };
    }, generalEntry.id);
    ok(!switchedAway.hasIso && switchedAway.clientId === 'c0', `switching an ISO entry's client via the inline picker clears its iso* fields (got ${JSON.stringify(switchedAway)})`);

    // ── With _isoEnabled=false, the toggle reverts to two buttons and golden markup is unaffected
    // (golden coverage itself lives in mt-golden-test; this just proves the feature-flag path). ──
    const flagOffShape = await page.evaluate(() => {
      const real = window._isoEnabled;
      window._isoEnabled = false;
      _teSetMode('task');
      const html = renderTime();
      const toggleCount = (html.match(/_teSetMode\(/g) || []).length;
      window._isoEnabled = real;
      return toggleCount;
    });
    ok(flagOffShape === 2, `with _isoEnabled=false, the Log Time toggle has exactly two buttons (Task/Client), no ISO one (got ${flagOffShape})`);

    ok(errs.length === 0, `no console errors or unexpected native dialogs through the whole flow (got ${JSON.stringify(errs.slice(0, 10))})`);
  } catch (e) {
    fail.push('the suite crashed: ' + e.message + '\n' + e.stack);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
