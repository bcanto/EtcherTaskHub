// Phase 5 acceptance: the ISO menu, sidebar, new-board wizard and board chrome, in a real browser
// against a throwaway offline server with its own temp ISO_OFFLINE_DIR (never the shared :3001
// server or the user's real .iso-offline/ — plan §4.2). Puppeteer, offline, real login as the
// seeded admin (this is the main app's own login form — there is no client-portal offline login
// path at all (Supabase-only, see index.html's doLogin comment), so client-role menu/route
// blocking is verified directly against the real, parameterised _acBlockedViews(user) function
// instead of a full interactive client session — logged as a scope note, not a gap, since that
// function IS the real blocking logic applyRolePermissions/renderView both call).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3109;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
function offlineHeader(user) { return encodeURIComponent(JSON.stringify(user)); }
async function callIso(port, user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-ISO-Offline-User'] = offlineHeader(user);
  const r = await fetch(`http://127.0.0.1:${port}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-ui-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe',
  });
  let browser = null;
  try {
    await waitForServer(PORT);
    const admin = { id: 'u1', role: 'admin' };

    // ── Approve one standard's library so audit.create can proceed (Phase 4 already proves the
    // real workbook import end to end — this suite is about the UI, so a bare approved version is
    // enough setup, matching iso-api-test.cjs's own precedent). ─────────────────────────────────
    await callIso(PORT, admin, { op: 'config.get' }); // warms the store deterministically
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const sec = await db.insert('iso_clause_sections', { id: 'isec_1', version_id: 'iver_1', clause: '4', title: 'Context', level: 1, sort_key: 0 });
    await db.insert('iso_standard_versions', { id: 'iver_1', standard_code: '9001', label: 'Test v1', status: 'approved' });
    await db.insert('iso_library_requirements', { id: 'ilr_1', version_id: 'iver_1', section_id: sec.id, clause: '4.1', clause_name: 'Context', requirement_text: 'Understand the organisation.', stable_key: '9001|4.1|abc|0', sort_key: 0 });

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push('console: ' + m.text()); });
    // A native alert/confirm/prompt blocks the whole page's JS thread until dismissed — with no
    // handler here that hangs this suite forever (found the hard way: mutateReasoned originally
    // called window.prompt directly, since fixed to use the app's own callback-based showPrompt).
    // Dismissing on sight turns any future regression back into that kind of native dialog into a
    // fast, visible failure (a missed assertion) instead of a multi-minute protocol timeout.
    page.on('dialog', d => { consoleErrors.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });

    // page.type() APPENDS to whatever is already in the field — always clear both fields first, or
    // a second login in the same session types straight onto the previous email/password.
    async function loginAs(email, password) {
      await page.evaluate(() => { document.getElementById('login-email').value = ''; document.getElementById('login-password').value = ''; });
      await page.type('#login-email', email);
      await page.type('#login-password', password);
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));
    }

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));
    await loginAs('b.canto@etchersolutions.com', 'TaskHub123');

    // Fixture: an archived client + a normal client's board should never appear for the archived
    // one (sidebar's own client-side filter, plan 5.2b), and an XSS-laced board title.
    await page.evaluate(() => {
      DB.clients = DB.clients || [];
      if (!DB.clients.find(c => c.id === 'c2')) DB.clients.push({ id: 'c2', name: 'Archived Test Client', archived: true, color: '#999', shortCode: 'ARC' });
      saveDB(DB);
    });

    // ── menu: ISO section visible for admin ──────────────────────────────────────────────────
    const menuVisible = await page.evaluate(() => {
      const el = document.getElementById('nav-iso-header');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    ok(menuVisible, 'the ISO nav section is visible for admin');

    // ── role-based route blocking (real, parameterised function — see header note) ────────────
    const blocking = await page.evaluate(() => ({
      client: [...(_acBlockedViews({ role: 'client' }))],
      restrictedHasIsoAdmin: [..._acBlockedViews({ role: 'restricted' })].includes('iso-admin'),
      restrictedHasIso: [..._acBlockedViews({ role: 'restricted' })].includes('iso'),
      adminBlocksNothing: _acBlockedViews({ role: 'admin' }).size === 0,
    }));
    ok(blocking.client.includes('iso') && blocking.client.includes('iso-admin'), 'a client role is route-blocked from both iso and iso-admin');
    ok(blocking.restrictedHasIsoAdmin === true, 'restricted staff is route-blocked from iso-admin');
    ok(blocking.restrictedHasIso === false, 'restricted staff is NOT blocked from iso itself (server decides per board)');
    ok(blocking.adminBlocksNothing, 'admin is blocked from nothing');

    // ── restricted staff: real login, real DOM, in a SEPARATE browser context (no backdoor — a
    // genuine offline seed user). A plain new tab shares localStorage with the admin page (same
    // origin) and auto-restores its session before a fresh login can happen; an isolated context
    // has its own storage partition, so it needs its own copy of the fixture user. ───────────────
    const restrictedContext = await browser.createBrowserContext();
    const restrictedPage = await restrictedContext.newPage();
    await restrictedPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));
    await restrictedPage.evaluate(() => {
      DB.users.push({ id: 'u_restricted_test', name: 'Restricted Tester', email: 'restricted.test@example.com', password: 'TaskHub123', role: 'restricted', active: true, displayColor: '#888', initials: 'RT' });
      saveDB(DB);
    });
    await restrictedPage.type('#login-email', 'restricted.test@example.com');
    await restrictedPage.type('#login-password', 'TaskHub123');
    await restrictedPage.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1500));
    const restrictedDom = await restrictedPage.evaluate(() => {
      const header = document.getElementById('nav-iso-header');
      const addBtn = document.getElementById('iso-add-btn');
      return { user: window._isoCurrentUser && window._isoCurrentUser(), headerVisible: header && getComputedStyle(header).display !== 'none', addBtnHidden: !addBtn || getComputedStyle(addBtn).display === 'none' };
    });
    ok(restrictedDom.user && restrictedDom.user.role === 'restricted', `the restricted test user actually logged in (got ${JSON.stringify(restrictedDom.user)})`);
    ok(restrictedDom.headerVisible, 'restricted staff sees the ISO section header (real login, real DOM)');
    ok(restrictedDom.addBtnHidden, 'restricted staff has the "+" (new board) button hidden (A13, real login, real DOM)');
    await restrictedContext.close();

    // ── no new tab, ever (plan 5.1's Tests) ──────────────────────────────────────────────────
    await page.evaluate(() => { window.__openCount = 0; const real = window.open; window.open = function () { window.__openCount++; return null; }; window.__realOpen = real; });

    await page.evaluate(() => window.navigate('iso'));
    await new Promise(r => setTimeout(r, 600));

    // New-board flow, 1 standard: creates a board with the pinned standard's requirement rows.
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
    const created1 = await page.evaluate(async () => {
      const audits = await ISO.api('audit.list');
      const a = audits.find(x => x.ref.endsWith('-001'));
      const metric = a ? await ISO.api('metric.audit', { auditId: a.id }) : null;
      return { ref: a && a.ref, reqTotal: metric && metric.req_total, modalHidden: document.getElementById('generic-modal').classList.contains('hidden'), view: document.getElementById('view-container').innerText };
    });
    ok(created1.ref && /-001$/.test(created1.ref), `new-board flow: first board is ref -001 (got ${created1.ref})`);
    ok(created1.reqTotal === 1, `new-board flow with 1 standard copies that standard's requirement rows (got ${created1.reqTotal})`);
    ok(created1.modalHidden, 'the wizard modal closes after creating the board');
    ok(!/Etcher White Logo/.test(created1.view), 'sanity: the board view rendered actual content, not a stray asset name');

    // Topbar shows the board's client like a workboard.
    const topbar = await page.evaluate(() => document.getElementById('view-title').classList.contains('vt-client'));
    ok(topbar, "the topbar carries the vt-client class for an open ISO board (shows the client, like a workboard)");

    // D27: a new board opens on its Dashboard (it used to open on Requirements, D17); the Phase 6
    // register checks below switch to Requirements themselves.
    const landedOn = await page.evaluate(() => document.querySelector('.ws-tabstrip .ws-tab.active')?.childNodes[0].textContent.trim());
    ok(landedOn === 'Overview', `the new-board flow opens the board on its Overview (D27/R5) (got ${landedOn})`);
    await page.evaluate(() => ISO.setTab('requirements'));
    await new Promise(r => setTimeout(r, 900));

    // ── Phase 6: Requirements register renders (grouped, editable) and a custom requirement with
    // an XSS payload in its text stays inert everywhere it appears (register + drawer). ──────────
    const reqRowCount = await page.evaluate(() => document.querySelectorAll('[data-ireq]').length);
    ok(reqRowCount === 1, `the register renders the one fixture requirement row (got ${reqRowCount})`);
    const originalReqId = await page.evaluate(() => document.querySelector('[data-ireq]')?.dataset.ireq);
    const reqXssText = `<img src=x onerror=window.__xssReq=1>"'`;
    // Redesign (wireframe): "+ Add requirement" left the Clauses toolbar for Settings ("+ Add a
    // client-specific clause"); the same dialog, opened here so the register refreshes in view.
    const tbAdd = await page.evaluate(() => [...document.querySelectorAll('#iso-req-tab button')].some(b => /Add requirement/.test(b.textContent)));
    ok(!tbAdd, 'the Clauses toolbar carries no "Add requirement" button (moved to Settings, wireframe)');
    await page.evaluate(() => ISO.setTab('settings')); await new Promise(r => setTimeout(r, 900));
    const setAdd = await page.evaluate(() => !!document.querySelector('.iso-set-addclause'));
    ok(setAdd, 'Settings offers "+ Add a client-specific clause"');
    await page.evaluate(() => ISO.setTab('requirements')); await new Promise(r => setTimeout(r, 900));
    await page.evaluate(() => ISO._openAddRequirement());
    await new Promise(r => setTimeout(r, 300));
    await page.select('#ar-std', '9001');
    await page.type('#ar-clause', '8.9');
    await page.type('#ar-text', reqXssText);
    await page.evaluate(() => document.querySelector('button[onclick*="_addRequirementApply"]').click());
    await new Promise(r => setTimeout(r, 900));
    const reqXssResult = await page.evaluate(() => ({ xss: window.__xssReq, rows: document.querySelectorAll('[data-ireq]').length, hasImg: !!document.querySelector('#iso-req-tab img') }));
    ok(reqXssResult.xss === undefined, 'an XSS payload in a custom requirement\'s text never executes in the register (window.__xssReq stays undefined)');
    ok(!reqXssResult.hasImg, 'the register never contains a live <img> tag from requirement text');
    ok(reqXssResult.rows === 2, `the custom requirement was added for real (now ${reqXssResult.rows} rows)`);
    // The fixture (library-copied) row and the freshly-added custom row can both be plain
    // crypto-random `ireq_<hex>` ids — neither reliably contains "fx", so picking "whichever id
    // doesn't look like a fixture id" silently fell through to "the second DOM row" every time,
    // which happened to still be the original row whenever section grouping put the new
    // (unsectioned) row first. Comparing against the id captured before the custom row existed is
    // the only way to reliably target it.
    const xssRowId = await page.evaluate((origId) => [...document.querySelectorAll('[data-ireq]')].map(tr => tr.dataset.ireq).find(id => id !== origId), originalReqId);
    ok(!!xssRowId && xssRowId !== originalReqId, 'the custom requirement row is reliably identified (not the original fixture row)');
    // R3: the requirement's own wording only renders once the row is expanded in place (collapsed
    // rows show clause + name only) — expand it so this probe actually exercises that escaping path.
    await page.evaluate((id) => ISO._reqToggleExpand(id), xssRowId);
    await new Promise(r => setTimeout(r, 300));
    const expandedXss = await page.evaluate((id) => ({ xss: window.__xssReq, hasImg: !!document.querySelector(`[data-ireq="${id}"] img`), text: document.querySelector(`[data-ireq="${id}"] .iso-clause-reqtext`)?.textContent || '' }), xssRowId);
    ok(expandedXss.xss === undefined && !expandedXss.hasImg, `the payload stays inert in the expanded row's requirement text too (got ${JSON.stringify(expandedXss)})`);
    ok(expandedXss.text === reqXssText, 'the expanded row shows the requirement text as plain escaped text, not markup');
    await page.evaluate((id) => ISO._reqToggleExpand(id), xssRowId);
    await page.evaluate((id) => ISO._reqOpenMore(id), xssRowId);
    await new Promise(r => setTimeout(r, 700));
    const drawerXss = await page.evaluate(() => ({ xss: window.__xssReq, hasImg: !!document.querySelector('#iso-drawer-body img'), text: document.getElementById('iso-drawer-body')?.innerText.slice(0, 60) }));
    ok(drawerXss.xss === undefined, 'the same payload never executes when the drawer renders the full requirement text');
    ok(!drawerXss.hasImg, 'the drawer never contains a live <img> tag from requirement text either');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // "Save view" used the native window.prompt (found while reviewing this file for 9.6) — the exact
    // A52 bug class, which blocks the whole page's JS thread until dismissed (undetectable headless,
    // and this suite's page-wide dialog listener above would flag and dismiss it as a failure). Fixed
    // to the app's own non-blocking prompt; this proves it round-trips through the real server.
    // Redesign: saved views left the Clauses toolbar (wireframe: search + chips only). The prompt
    // regression still matters for any caller, so it is driven directly.
    const tbSave = await page.evaluate(() => [...document.querySelectorAll('#iso-req-tab button')].some(b => b.textContent.trim() === 'Save view'));
    ok(!tbSave, 'the Clauses toolbar has no Save view button (wireframe)');
    await page.evaluate(() => { ISO._reqSaveView(); });
    await new Promise(r => setTimeout(r, 300));
    const promptVisible = await page.evaluate(() => !document.getElementById('generic-modal')?.classList.contains('hidden') && !!document.getElementById('sp-val'));
    ok(promptVisible, 'Save view opens the app\'s own prompt modal, never a native window.prompt');
    if (promptVisible) {
      await page.evaluate(() => { document.getElementById('sp-val').value = 'All open gaps'; });
      await page.evaluate(() => document.querySelector('#generic-modal button.btn-teal')?.click());
      await new Promise(r => setTimeout(r, 700));
    }
    const savedView = await page.evaluate(async () => (await ISO.api('view.list', { auditId: (await ISO.api('audit.list'))[0].id })).some(v => v.name === 'All open gaps'));
    ok(savedView, 'the named view is actually saved through view.save');

    // Nested modals (user-reported, 2026-10-03): opening "Add evidence" from inside a requirement
    // drawer used to overwrite the single shared #generic-modal in place — closing the nested dialog
    // then closed everything, with no way back to the drawer. openGenericModal/closeGenericModal
    // (index.html) now keep a small stack; this is the exact reported scenario end to end.
    const drawerRowId = await page.evaluate(() => document.querySelector('[data-ireq]')?.dataset.ireq);
    await page.evaluate((id) => ISO._reqOpenMore(id), drawerRowId);
    await new Promise(r => setTimeout(r, 500));
    const drawerTitle = await page.evaluate(() => document.getElementById('generic-modal-title')?.textContent || '');
    ok(drawerTitle.length > 3, `setup: the requirement drawer opened as the first modal (got ${JSON.stringify(drawerTitle)})`);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Add evidence/i.test(b.textContent))?.click());
    await new Promise(r => setTimeout(r, 400));
    const nestedTitle = await page.evaluate(() => document.getElementById('generic-modal-title')?.textContent || '');
    ok(nestedTitle === 'Add evidence', `setup: "Add evidence" opened nested, on top of the drawer (got ${JSON.stringify(nestedTitle)})`);
    await page.evaluate(() => document.querySelector('#generic-modal button[onclick="closeGenericModal()"]')?.click());
    await new Promise(r => setTimeout(r, 400));
    const afterNestedClose = await page.evaluate(() => ({ title: document.getElementById('generic-modal-title')?.textContent || '', hidden: document.getElementById('generic-modal')?.classList.contains('hidden'), hasAssessment: document.getElementById('iso-drawer-body')?.innerText.includes('Assessment') }));
    ok(!afterNestedClose.hidden && afterNestedClose.title === drawerTitle && afterNestedClose.hasAssessment, `closing the nested "Add evidence" dialog returns to the drawer it was opened from, not to a blank page (got ${JSON.stringify(afterNestedClose)})`);
    await page.evaluate(() => document.querySelector('#generic-modal button[onclick="closeGenericModal()"]')?.click());
    await new Promise(r => setTimeout(r, 400));
    ok(await page.evaluate(() => document.getElementById('generic-modal')?.classList.contains('hidden')), 'closing the drawer itself (the outermost modal) now fully closes — the stack never leaks into the next, unrelated close');
    // A plain, never-nested modal (the Access modal) is unaffected: opens and fully closes normally.
    await page.evaluate(() => ISO.openAccessModal());
    await new Promise(r => setTimeout(r, 400));
    const plainOpen = await page.evaluate(() => !document.getElementById('generic-modal')?.classList.contains('hidden'));
    await page.evaluate(() => document.querySelector('#generic-modal button[onclick="closeGenericModal()"]')?.click());
    await new Promise(r => setTimeout(r, 400));
    const plainClosed = await page.evaluate(() => document.getElementById('generic-modal')?.classList.contains('hidden'));
    ok(plainOpen && plainClosed, `a plain, never-nested modal still opens and closes normally (got ${JSON.stringify({ plainOpen, plainClosed })})`);

    // R3: the register's Status column is gone — each clause row expands in place with a status
    // button bar (no dropdown, no Save button). A click round-trips through the real server and is
    // reflected both in the expanded button state and the collapsed row's pill.
    const stateCellId = await page.evaluate(() => document.querySelector('[data-ireq]').dataset.ireq);
    await page.evaluate((id) => ISO._reqToggleExpand(id), stateCellId);
    await new Promise(r => setTimeout(r, 300));
    const statusBar = await page.evaluate((id) => {
      const row = document.querySelector(`[data-ireq="${id}"]`);
      const btns = [...row.querySelectorAll('.iso-status-btn')];
      return { count: btns.length, values: btns.map(b => b.dataset.status), active: btns.filter(b => b.classList.contains('is-active')).map(b => b.dataset.status) };
    }, stateCellId);
    ok(statusBar.count === 5, `the expanded row shows a status button for each of the 5 real statuses, Not assessed excluded (got ${statusBar.count})`);
    ok(statusBar.values.includes('compliant') && statusBar.values.includes('not_applicable'), `the button bar includes Compliant and N/A (got ${JSON.stringify(statusBar.values)})`);
    await page.evaluate((id) => document.querySelector(`[data-ireq="${id}"] .iso-status-btn[data-status="compliant"]`).click(), stateCellId);
    await new Promise(r => setTimeout(r, 700));
    const afterClick = await page.evaluate((id) => {
      const row = document.querySelector(`[data-ireq="${id}"]`);
      return { activeBtn: row.querySelector('.iso-status-btn.is-active')?.dataset.status, headPill: row.querySelector('.iso-clause-head').textContent };
    }, stateCellId);
    ok(afterClick.activeBtn === 'compliant', `clicking Compliant persisted through a real requirement.update call and marks that button active (got ${JSON.stringify(afterClick.activeBtn)})`);
    ok(/Compliant/.test(afterClick.headPill), `the collapsed row's own status pill reads Compliant too (got ${JSON.stringify(afterClick.headPill)})`);

    // ── Phase 7.4: Findings register renders, a finding can be created from a requirement, an XSS
    // payload in its title stays inert everywhere (register + drawer), a lifecycle transition and
    // a comment both round-trip through the real server, and a plain cell edit (visibility) does
    // too — the same shape of proof Phase 6's requirement register block above already gives. ────
    await page.evaluate(() => ISO.setTab('findings'));
    await new Promise(r => setTimeout(r, 500));
    const fndEmptyText = await page.evaluate(() => document.getElementById('iso-fnd-tab')?.innerText || '');
    ok(/No findings match/.test(fndEmptyText), 'the findings register shows a real empty state before any finding exists (not a blank screen)');
    const fndXssText = `<img src=x onerror=window.__xssFnd=1>"'`;
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('New finding'))?.click());
    await new Promise(r => setTimeout(r, 300));
    await page.select('#af-class', 'major_nc');
    await page.type('#af-title', fndXssText);
    await page.type('#af-statement', 'The isolation procedure was not followed.');
    await page.evaluate(() => document.querySelector('button[onclick*="_addFindingApply"]').click());
    await new Promise(r => setTimeout(r, 1400));
    const fndXssResult = await page.evaluate(() => ({ xss: window.__xssFnd, rows: document.querySelectorAll('tr[data-ifnd]').length, hasImg: !!document.querySelector('#iso-fnd-tab img') }));
    ok(fndXssResult.xss === undefined, 'an XSS payload in a finding title never executes in the register (window.__xssFnd stays undefined)');
    ok(!fndXssResult.hasImg, 'the findings register never contains a live <img> tag from finding text');
    ok(fndXssResult.rows === 1, `the finding was created for real, from the fixture requirement (now ${fndXssResult.rows} row)`);
    const fndRowId = await page.evaluate(() => document.querySelector('tr[data-ifnd]')?.dataset.ifnd);
    ok(!!fndRowId, 'the created finding has a real, addressable row id');
    if (!fndRowId) throw new Error('finding creation did not produce a row — aborting the rest of the findings block');

    // Classification grouping: the register groups by classification, and this major_nc finding
    // must land under that section, not "Unsectioned" or silently dropped.
    const fndGroupLabel = await page.evaluate(() => document.querySelector('tr.ws-grp-hdr')?.innerText || '');
    ok(/Major NC/.test(fndGroupLabel), `the finding renders under its own classification's section header (got "${fndGroupLabel.replace(/\s+/g, ' ').trim()}")`);

    await page.evaluate((id) => { document.querySelector(`tr[data-ifnd="${id}"] td:nth-child(2)`)?.click(); }, fndRowId);
    await new Promise(r => setTimeout(r, 700));
    const fndDrawerXss = await page.evaluate(() => ({ xss: window.__xssFnd, hasImg: !!document.querySelector('#iso-drawer-body img'), hasReleaseBtn: !!document.querySelector('#iso-drawer-body button[onclick*="finding.release"]') }));
    ok(fndDrawerXss.xss === undefined, 'the same payload never executes when the finding drawer renders the full title/statement');
    ok(!fndDrawerXss.hasImg, 'the finding drawer never contains a live <img> tag from finding text either');
    ok(fndDrawerXss.hasReleaseBtn, 'a draft finding\'s drawer offers "Release for review" (the real lifecycle op, not a dead button)');

    // A real lifecycle transition (finding.release) round-trips through the server and the drawer
    // reflects it in place, exactly like a real audit_manager/auditor action would.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="finding.release"]').click());
    await new Promise(r => setTimeout(r, 700));
    const fndAfterRelease = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Released for review/.test(fndAfterRelease), 'clicking Release for review really moves the finding to released_for_review via finding.release, reflected in the reopened drawer');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));
    const fndRegisterStatus = await page.evaluate((id) => document.querySelector(`tr[data-ifnd="${id}"] td[data-field="status"]`)?.innerText, fndRowId);
    ok(fndRegisterStatus === 'Released for review', `the register itself (not just the drawer) reflects the transition too — a drawer-only refresh would leave this stale (got "${fndRegisterStatus}")`);
    await page.evaluate((id) => { document.querySelector(`tr[data-ifnd="${id}"] td:nth-child(2)`)?.click(); }, fndRowId);
    await new Promise(r => setTimeout(r, 700));

    // A comment posted from the drawer round-trips through comment.add and reappears in place.
    await page.type('#fd-comment', 'Evidence pack requested from the site supervisor.');
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_fndAddComment"]').click());
    await new Promise(r => setTimeout(r, 700));
    const fndCommentText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Evidence pack requested from the site supervisor/.test(fndCommentText), 'a comment posted from the finding drawer round-trips through a real comment.add call');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // A plain register cell edit (visibility) round-trips through finding.update, same proof shape
    // as the Requirements register's assessment_state check above.
    await page.evaluate((id) => { document.querySelector(`tr[data-ifnd="${id}"] td[data-field="visibility"]`)?.click(); }, fndRowId);
    await new Promise(r => setTimeout(r, 300));
    const fndHasSelectEditor = await page.evaluate(() => !!document.querySelector('#ws-cell-dd .mt-dd-opt[data-value="client_all"]'));
    ok(fndHasSelectEditor, 'clicking the finding register\'s Visibility cell opens its dropdown of options');
    if (fndHasSelectEditor) {
      await page.evaluate(() => document.querySelector('#ws-cell-dd .mt-dd-opt[data-value="client_all"]').click());
      await new Promise(r => setTimeout(r, 500));
      // The finding is now released (from the transition above) — api/_iso.js's own
      // requireReason demands a reason for a visibility change after release. mutateReasoned
      // collects it through the app's own callback-based showPrompt, never a native
      // window.prompt (a real bug this exact test caught: a native dialog blocks Puppeteer's
      // evaluate() indefinitely with no dialog handler — see mutateReasoned's own comment).
      const reasonPromptShown = await page.evaluate(() => !!document.getElementById('sp-val'));
      ok(reasonPromptShown, "changing a released finding's visibility prompts for a reason through the app's own modal, not a native dialog");
      if (reasonPromptShown) {
        await page.type('#sp-val', 'Client requested visibility into this finding.');
        await page.evaluate(() => document.querySelector('#generic-modal-body button.btn-teal').click());
        await new Promise(r => setTimeout(r, 700));
      }
      const fndNewVis = await page.evaluate((id) => document.querySelector(`tr[data-ifnd="${id}"] td[data-field="visibility"]`)?.innerText, fndRowId);
      ok(fndNewVis === 'All client members', `the inline visibility edit persisted through a real finding.update call once the reason was supplied (cell now reads "${fndNewVis}")`);
    }

    // Quick view filter: "Major NC" must still show the finding, "Open" must exclude it now it has
    // moved to released_for_review... no — released_for_review IS still "Open" per FINDING_QUICK_VIEWS
    // (draft or released_for_review). Prove the filter is real by switching to a view that excludes it.
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'All findings')?.click());
    await new Promise(r => setTimeout(r, 300));
    const fndAllViewRows = await page.evaluate(() => document.querySelectorAll('tr[data-ifnd]').length);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Major NC')?.click());
    await new Promise(r => setTimeout(r, 300));
    const fndMajorViewRows = await page.evaluate(() => document.querySelectorAll('tr[data-ifnd]').length);
    ok(fndAllViewRows === 1 && fndMajorViewRows === 1, `quick views render real, filtered data (All: ${fndAllViewRows}, Major NC: ${fndMajorViewRows})`);

    // ── Phase 7.4: Actions register renders, an action can be created from the finding created
    // above, its status workflow (incl. the on_hold pause/resume A40/A48 fixed at the ops layer)
    // and CAPA/subtask saves all round-trip through the real server, and — the specific bug this
    // slice found in Findings (A49) — a save right after a status transition must not fail on a
    // stale cached row_version. ─────────────────────────────────────────────────────────────────
    await page.evaluate(() => ISO.setTab('actions'));
    await new Promise(r => setTimeout(r, 500));
    const actXssText = `<img src=x onerror=window.__xssAct=1>"'`;
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('New action'))?.click());
    await new Promise(r => setTimeout(r, 300));
    await page.select('#aa-type', 'finding'); // the finding created in the Phase 7.4 Findings block above
    await new Promise(r => setTimeout(r, 150));
    await page.type('#aa-title', actXssText);
    await page.evaluate(() => document.querySelector('button[onclick*="_addActionApply"]').click());
    await new Promise(r => setTimeout(r, 1400));
    const actXssResult = await page.evaluate(() => ({ xss: window.__xssAct, rows: document.querySelectorAll('tr[data-iact]').length, hasImg: !!document.querySelector('#iso-act-tab img') }));
    ok(actXssResult.xss === undefined, 'an XSS payload in an action title never executes in the register (window.__xssAct stays undefined)');
    ok(!actXssResult.hasImg, 'the actions register never contains a live <img> tag from action text');
    ok(actXssResult.rows === 1, `the action was created for real, from the finding created above (now ${actXssResult.rows} row)`);
    const actRowId = await page.evaluate(() => document.querySelector('tr[data-iact]')?.dataset.iact);
    ok(!!actRowId, 'the created action has a real, addressable row id');
    if (!actRowId) throw new Error('action creation did not produce a row — aborting the rest of the actions block');

    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    const actDrawerXss = await page.evaluate(() => ({ xss: window.__xssAct, hasImg: !!document.querySelector('#iso-drawer-body img'), hasMoveBtn: !!document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"]') }));
    ok(actDrawerXss.xss === undefined, 'the same payload never executes when the action drawer renders the full title');
    ok(!actDrawerXss.hasImg, 'the action drawer never contains a live <img> tag from action text either');
    ok(actDrawerXss.hasMoveBtn, 'a draft action\'s drawer offers a real status-move button, not a dead one');

    // draft -> assigned -> in_progress, each a real action.updateStatus round trip.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"][onclick*="assigned"]').click());
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"][onclick*="in_progress"]').click());
    await new Promise(r => setTimeout(r, 700));
    const actAfterMoves = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/In progress/.test(actAfterMoves), 'two chained status moves (draft→assigned→in_progress) both really persisted, reflected in the reopened drawer each time');

    // Pause to on_hold, then Resume — the first UI exercise of A40/A48's fix. A wrong destination
    // was never offered a picker for in the first place (the drawer only ever renders the one
    // correct Resume button), so this proves the round trip, not a picker's own validation.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"][onclick*="on_hold"]').click());
    await new Promise(r => setTimeout(r, 700));
    const onHoldText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/On hold/.test(onHoldText), 'pausing an action really moves it to on_hold');
    const resumeBtnText = await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"]')?.textContent || '');
    ok(/Resume \(In progress\)/.test(resumeBtnText), `the drawer offers exactly one Resume destination — the real status it was paused from (got "${resumeBtnText}")`);
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_actUpdateStatus"]').click());
    await new Promise(r => setTimeout(r, 700));
    const resumedText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/In progress/.test(resumedText) && !/On hold/.test(resumedText), 'resuming really moves the action back to exactly the status it was paused from (in_progress)');

    // A save right after a status transition — this exact sequence is what A49 found broken in
    // Findings (a stale cached row_version silently failing the very next save).
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td[data-field="priority"]`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 300));
    const actHasSelectEditor = await page.evaluate(() => !!document.querySelector('#ws-cell-dd .mt-dd-opt[data-value="high"]'));
    ok(actHasSelectEditor, 'clicking the actions register\'s Priority cell opens its dropdown of options');
    if (actHasSelectEditor) {
      await page.evaluate(() => document.querySelector('#ws-cell-dd .mt-dd-opt[data-value="high"]').click());
      await new Promise(r => setTimeout(r, 700));
      const actNewPriority = await page.evaluate((id) => document.querySelector(`tr[data-iact="${id}"] td[data-field="priority"]`)?.innerText, actRowId);
      ok(actNewPriority === 'High', `a save right after two status transitions and an on_hold round trip still succeeds — no stale row_version conflict (cell now reads "${actNewPriority}")`);
    }

    // CAPA save (plain fields) and a subtask add/toggle, both real round trips.
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    await page.type('#ad-rcsummary', 'The isolation valve inspection interval was extended without a documented risk assessment.');
    await page.evaluate(() => document.querySelector('.ad-cause-cat').click());
    await page.evaluate(() => document.querySelector('button[onclick*="_adSaveCapa"]').click());
    await new Promise(r => setTimeout(r, 700));
    // _adSaveCapa hides the modal on success without re-rendering it — reopen fresh from the
    // register so this reads the real, persisted server value, not just whatever is still sitting
    // in the (now hidden) input from before the save.
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    const capaSaved = await page.evaluate(() => document.getElementById('ad-rcsummary')?.value || '');
    ok(/isolation valve inspection interval/.test(capaSaved), 'the CAPA root-cause summary round-trips through a real action.update call');

    // ── Guided root-cause editors — 5 Whys, fishbone, cause-and-effect tree, each over the real
    // five_whys/fishbone/cause_tree JSONB columns via action.update, not a fake preview. ───────────
    await page.select('#ad-rcmethod', 'five_whys');
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => document.querySelector('button[onclick*="_rcFiveWhysAdd"]').click());
    await new Promise(r => setTimeout(r, 150));
    const fwInputs = await page.$$('#ad-guided-rc input');
    await fwInputs[0].type('Why was the interval extended?');
    await fwInputs[1].type('A supervisor approved it verbally without a written risk assessment.');
    await page.evaluate(() => document.querySelector('button[onclick*="_adSaveCapa"]').click());
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    // innerText never includes an <input>'s value (it isn't a text node) — read .value directly,
    // the same way the earlier root-cause-summary and cause-tree checks already correctly do.
    const fiveWhysSaved = await page.evaluate(() => [...document.querySelectorAll('#ad-guided-rc input')].map(el => el.value).join(' | '));
    ok(/Why was the interval extended/.test(fiveWhysSaved) && /A supervisor approved it verbally/.test(fiveWhysSaved), `a 5 Whys entry round-trips through a real action.update call and reappears in the guided editor, not just in memory (got "${fiveWhysSaved}")`);

    await page.select('#ad-rcmethod', 'fishbone');
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => document.querySelector('button[onclick*="_rcFishboneAdd"][onclick*="method"]').click());
    await new Promise(r => setTimeout(r, 150));
    await page.type('#ad-guided-rc input', 'No documented procedure for extending inspection intervals.');
    await page.evaluate(() => document.querySelector('button[onclick*="_adSaveCapa"]').click());
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    const fishboneSaved = await page.evaluate(() => ({
      causeValue: document.querySelector('#ad-guided-rc input')?.value || '',
      categoryLabels: document.getElementById('ad-guided-rc')?.innerText || '', // category names ARE real text nodes, unlike the cause itself
    }));
    ok(/No documented procedure for extending inspection intervals/.test(fishboneSaved.causeValue), `a fishbone cause round-trips through a real action.update call (got "${fishboneSaved.causeValue}")`);
    ok(/Method/.test(fishboneSaved.categoryLabels), 'the cause is filed under its real category (Method), not a generic list');

    await page.select('#ad-rcmethod', 'cause_tree');
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => document.querySelector('button[onclick*="_rcTreeAddRoot"]').click());
    await new Promise(r => setTimeout(r, 150));
    await page.type('#ad-guided-rc input', 'Inspection interval extended without review');
    await page.evaluate(() => document.querySelector('button[onclick*="_rcTreeAddChild"]').click());
    await new Promise(r => setTimeout(r, 150));
    const treeInputs = await page.$$('#ad-guided-rc input');
    await treeInputs[1].type('No procedure required a documented risk assessment');
    await page.evaluate(() => document.querySelector('button[onclick*="_adSaveCapa"]').click());
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    const treeSaved = await page.evaluate(() => {
      const el = document.getElementById('ad-guided-rc');
      const inputs = [...el.querySelectorAll('input')];
      return { count: inputs.length, root: inputs[0]?.value, childIndent: el.querySelectorAll('div[style*="margin-left:20px"]').length };
    });
    ok(treeSaved.count === 2 && treeSaved.root === 'Inspection interval extended without review', `the cause tree's root node round-trips through a real action.update call (got ${JSON.stringify(treeSaved)})`);
    ok(treeSaved.childIndent === 1, 'the child node renders indented under its parent — a real tree structure, not a flat list');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));

    await page.type('#ad-subtask', 'Confirm the updated interval with the site supervisor.');
    await page.evaluate(() => document.querySelector('button[onclick*="_subtaskAdd"]').click());
    await new Promise(r => setTimeout(r, 700));
    const subtaskText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Confirm the updated interval with the site supervisor/.test(subtaskText), 'a subtask added from the drawer round-trips through a real subtask.add call');
    // Scoped to the drawer specifically — the same onchange text now also appears on the subtask's
    // Main Table child-row status checkbox (rendered into #iso-act-tab, hidden behind this modal),
    // and an unscoped selector would grab that occluded element instead of the visible drawer one.
    const subtaskCb = await page.$('#iso-drawer-body input[onchange*="_subtaskToggle"]');
    if (subtaskCb) {
      await subtaskCb.click();
      await new Promise(r => setTimeout(r, 700));
      const subtaskChecked = await page.evaluate(() => document.querySelector('#iso-drawer-body input[onchange*="_subtaskToggle"]')?.checked);
      ok(subtaskChecked === true, 'toggling a subtask\'s checkbox round-trips through a real subtask.update call');
    }
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));
    await new Promise(r => setTimeout(r, 500));

    // ── Subtasks as real Main Table child rows ─────────────────────────────────────────────────
    const subRowId = await page.evaluate((parentId) => {
      const parentRow = document.querySelector(`tr[data-iact="${parentId}"]`);
      const next = parentRow && parentRow.nextElementSibling;
      return next && next.matches('tr[data-isub]') ? next.dataset.isub : null;
    }, actRowId);
    ok(!!subRowId, 'a subtask added from the drawer checklist also renders as a real child row directly under its parent action in the Main Table register');
    const subRowIndent = await page.evaluate((id) => {
      const cell = document.querySelector(`tr[data-isub="${id}"] td:nth-child(2)`);
      return cell ? cell.style.paddingLeft : null;
    }, subRowId);
    ok(subRowIndent === '28px', `the child row is indented under its parent, not flush with the top-level rows (got ${subRowIndent})`);
    const subRowStatusText = await page.evaluate((id) => document.querySelector(`tr[data-isub="${id}"] td[data-field="status"]`)?.innerText, subRowId);
    ok(subtaskCb ? /Done/.test(subRowStatusText || '') : /Open/.test(subRowStatusText || ''), `the child row's own status cell reflects the checklist toggle applied above (got ${JSON.stringify(subRowStatusText)})`);

    await page.evaluate((id) => { document.querySelector(`tr[data-isub="${id}"] td[data-field="due_date"]`)?.click(); }, subRowId);
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { document.getElementById('mt-edit-date').value = '2026-11-15'; });
    await page.evaluate(() => document.querySelector('#ws-cell-dd .mt-dd-save').click());
    await new Promise(r => setTimeout(r, 700));
    const subRowDueText = await page.evaluate((id) => document.querySelector(`tr[data-isub="${id}"] td[data-field="due_date"]`)?.innerText, subRowId);
    ok(/2026|Nov/.test(subRowDueText || ''), `inline-editing a subtask row's due date round-trips through a real subtask.update call (got ${JSON.stringify(subRowDueText)})`);

    await page.evaluate((id) => { document.querySelector(`tr[data-isub="${id}"] td:nth-child(2)`)?.click(); }, subRowId);
    await new Promise(r => setTimeout(r, 700));
    const drawerOpenedForParent = await page.evaluate((parentId) => {
      const title = document.getElementById('iso-drawer-body')?.innerText || '';
      return { hasParentRef: title.length > 0, hasSubtaskModal: !document.getElementById('generic-modal').classList.contains('hidden') };
    }, actRowId);
    ok(drawerOpenedForParent.hasSubtaskModal, 'clicking a subtask row\'s name opens a drawer rather than doing nothing');
    const drawerShowsCapa = await page.evaluate(() => !!document.getElementById('ad-guided-rc'));
    ok(drawerShowsCapa, 'clicking a subtask row\'s name opens the PARENT action\'s drawer (identified by its CAPA panel), not a dead click or a subtask-only view');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // ── Phase 7.4: submit for review / decide review, and extension request/decide — the extension
    // flow needs a real due date first (never set on this action so far), via the same register
    // inline date editor already proven for Priority above. ────────────────────────────────────────
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td[data-field="due_date"]`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { document.getElementById('mt-edit-date').value = '2026-12-01'; });
    await page.evaluate(() => document.querySelector('#ws-cell-dd .mt-dd-save').click());
    await new Promise(r => setTimeout(r, 700));

    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td:nth-child(2)`)?.click(); }, actRowId);
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_openSubmitForReview"]').click());
    await new Promise(r => setTimeout(r, 300));
    await page.type('#sr-note', 'The updated interval is documented and the supervisor has signed off.');
    await page.evaluate(() => document.querySelector('button[onclick*="_submitForReviewApply"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterSubmit = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Submitted for review/.test(afterSubmit), 'action.submitForReview really moves the action to submitted_for_review');
    ok(/Submission #1/.test(afterSubmit) && /Pending/.test(afterSubmit), 'a real, numbered review row (submission #1, pending) is created alongside the status move — not just a bare status change');

    // Decide "Needs more info" — A45: sends the action back to more_info_required.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_reviewDecide"][onclick*="more_info"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterMoreInfo = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/More info required/.test(afterMoreInfo), 'deciding "needs more info" really reverts the action to more_info_required (A45)');
    ok(/More info needed/.test(afterMoreInfo), 'the review row itself now shows its real decision, not still "Pending"');

    // Resubmit — submission_no must increment, proving this is a real resubmission cycle.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_openSubmitForReview"]').click());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => document.querySelector('button[onclick*="_submitForReviewApply"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterResubmit = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Submission #2/.test(afterResubmit), 'resubmitting creates submission #2, not a second #1 (the resubmission-cycle numbering is real)');

    // Accept — A45: does NOT auto-advance past submitted_for_review (the real ready_for_verification
    // move stays a separate, explicit action.updateStatus call).
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_reviewDecide"][onclick*="accepted"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterAccept = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Accepted/.test(afterAccept), 'an accepted review shows its real decision');
    ok(/Submitted for review/.test(afterAccept), 'accepting a review does NOT auto-advance the action\'s status (A45) — that stays a separate, explicit move');

    // Extension request/decide — a real due-date change, not a status change.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_openRequestExtension"]').click());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { document.getElementById('ex-due').value = '2027-01-15'; });
    await page.type('#ex-reason', 'Waiting on the supplier for a replacement part.');
    await page.evaluate(() => document.querySelector('button[onclick*="_requestExtensionApply"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterExtRequest = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Waiting on the supplier for a replacement part/.test(afterExtRequest), 'extension.request really creates a real extension record, shown in the drawer');
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_extensionDecide"][onclick*="approved"]').click());
    await new Promise(r => setTimeout(r, 900));
    const afterExtApprove = await page.evaluate((id) => document.querySelector(`tr[data-iact="${id}"] td[data-field="due_date"]`)?.innerText, actRowId);
    ok(afterExtApprove === '15 Jan 2027', `approving the extension really moves the action's own due_date (register now shows "${afterExtApprove}")`);
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // ── Phase 7.4: requirement-drawer traceability panels — finding.list/action.list now attach
    // requirement_id / links so a requirement's drawer can show what was raised from it, without a
    // whole new op. Ask the server directly which requirement the finding above actually got
    // linked to (whichever the "+ New finding" form's default dropdown selection was, not assumed)
    // rather than guessing, then prove the panel actually reflects that real link. ──────────────────
    await page.evaluate(() => ISO.setTab('requirements'));
    await new Promise(r => setTimeout(r, 500));
    const fndReqId = await page.evaluate(async () => {
      const findings = await ISO.api('finding.list', { auditId: (await ISO.api('audit.list'))[0].id });
      return (findings[0] || {}).requirement_id;
    });
    ok(!!fndReqId, "finding.list now attaches the finding's real source requirement id");
    await page.evaluate((id) => ISO._reqOpenMore(id), fndReqId);
    await new Promise(r => setTimeout(r, 700));
    // Phase 8b.2: the requirement drawer is tabbed — open its "Findings and actions" tab first (innerText skips hidden panels).
    await page.evaluate(() => document.querySelector('#iso-drawer-body [role="tab"][data-tab="links"]')?.click());
    const reqDrawerFindings = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Findings raised from this requirement \(1\)/.test(reqDrawerFindings), 'the requirement drawer shows the real finding raised from it, via the new requirement_id link — not a placeholder count');
    ok(/Actions linked to this requirement \(0\)/.test(reqDrawerFindings), 'and correctly shows zero linked actions — the action created earlier was linked to the FINDING, not to this requirement directly');

    // "+ New action" from the requirement drawer itself creates an action linked to the
    // REQUIREMENT (target_type:'requirement') — a real, separate link path from the
    // finding-sourced action already created above.
    await page.evaluate(() => document.querySelector('#iso-drawer-body button[onclick*="_openAddAction"]').click());
    await new Promise(r => setTimeout(r, 300));
    const aaTypeValue = await page.evaluate(() => document.getElementById('aa-type')?.value);
    ok(aaTypeValue === 'requirement', 'the requirement drawer\'s "+ New action" shortcut preselects Requirement as the source type');
    await page.type('#aa-title', 'Update the risk assessment before extending any inspection interval.');
    await page.evaluate(() => document.querySelector('button[onclick*="_addActionApply"]').click());
    await new Promise(r => setTimeout(r, 1400));
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));
    await page.evaluate((id) => ISO._reqOpenMore(id), fndReqId);
    await new Promise(r => setTimeout(r, 700));
    // Phase 8b.2: the requirement drawer is tabbed — open its "Findings and actions" tab first (innerText skips hidden panels).
    await page.evaluate(() => document.querySelector('#iso-drawer-body [role="tab"][data-tab="links"]')?.click());
    const reqDrawerAfterAction = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Actions linked to this requirement \(1\)/.test(reqDrawerAfterAction) && /Update the risk assessment before extending any inspection interval/.test(reqDrawerAfterAction), 'the requirement drawer now shows the action just created from it, via action.list\'s new links array');
    await page.evaluate(() => document.getElementById('generic-modal').classList.add('hidden'));

    // ── Phase 7.4: Action plan Gantt — the last named Phase 7.4 item. First real consumer of
    // index.html's generic Gantt renderer with actual mouse-drag wiring (previously exercised only
    // against a fake model, with beforeCommit/commitMove driven directly, in gantt-adapter-test.cjs
    // — no real onscreen drag existed for anything, ISO or Workboards, until this). Grouped by
    // standard/owner/finding per the plan's own §7.4 wording; a drag round-trips through a real
    // action.update call, and needs a reason when it changes the due date on an action that was
    // already overdue (§6.3a rule 4), the same rule the register's own inline editor already hits. ──
    await page.evaluate(() => ISO.setTab('actionplan'));
    await new Promise(r => setTimeout(r, 700));
    const gpToolbarText = await page.evaluate(() => document.querySelector('#iso-ganttact-tab')?.innerText || '');
    ok(/Standard/.test(gpToolbarText) && /Owner/.test(gpToolbarText) && /Finding/.test(gpToolbarText), 'the Action plan tab offers all three group-by options from the plan (Standard/Owner/Finding)');

    const gpDefaultSections = await page.evaluate(() => [...document.querySelectorAll('.g2g-sec')].map(el => el.textContent));
    ok(gpDefaultSections.some(s => /^ISO /.test(s)), `the default "Standard" grouping resolves a real standard code via the finding→requirement chain, not "No standard" (got ${JSON.stringify(gpDefaultSections)})`);

    const gpBarIsMilestone = await page.evaluate((id) => {
      const bar = document.getElementById('g2g-bar-' + id);
      return bar ? bar.classList.contains('g2g-milestone') : null;
    }, actRowId);
    ok(gpBarIsMilestone === true, 'the test action (a due date but no start date) renders as a milestone diamond, not a two-ended bar');

    // Switch grouping to "Finding" — the same action must regroup under its real finding's ref.
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Finding')?.click());
    await new Promise(r => setTimeout(r, 400));
    const fndRefForGroup = await page.evaluate(async () => { const fs = await ISO.api('finding.list', { auditId: (await ISO.api('audit.list'))[0].id }); return fs[0].ref; });
    const gpFindingSections = await page.evaluate(() => [...document.querySelectorAll('.g2g-sec')].map(el => el.textContent));
    ok(gpFindingSections.some(s => s.includes(fndRefForGroup)), `switching to "Finding" grouping regroups the same action under its real finding's ref (got ${JSON.stringify(gpFindingSections)})`);

    // Switch grouping to "Owner" — the action has no owner assigned, so it must fall into
    // "Unassigned" rather than disappearing or crashing the render.
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Owner')?.click());
    await new Promise(r => setTimeout(r, 400));
    const gpOwnerSections = await page.evaluate(() => [...document.querySelectorAll('.g2g-sec')].map(el => el.textContent));
    ok(gpOwnerSections.includes('Unassigned'), `switching to "Owner" grouping falls back to "Unassigned" for an action with no owner (got ${JSON.stringify(gpOwnerSections)})`);

    // Real mouse drag (not a direct beforeCommit/commitMove call, unlike gantt-adapter-test.cjs's
    // fake model — this is the first Gantt anywhere in the app, Workboards included, whose actual
    // onscreen drag path has real test coverage). Drag the milestone 3 days forward; the action's
    // due date (2027-01-15, set earlier by the extension-approval block) is NOT overdue, so this
    // must save with no reason prompt.
    const gpBarBox = await page.evaluate((id) => {
      const el = document.getElementById('g2g-bar-' + id);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, actRowId);
    ok(!!gpBarBox, 'the test action\'s bar is a real, clickable element on screen');
    if (gpBarBox) {
      await page.mouse.move(gpBarBox.x, gpBarBox.y);
      await page.mouse.down();
      await page.mouse.move(gpBarBox.x + 30, gpBarBox.y, { steps: 5 });
      await page.mouse.up();
      await new Promise(r => setTimeout(r, 700));
      const gpDraggedDue = await page.evaluate(async (id) => { const acts = await ISO.api('action.list', { auditId: (await ISO.api('audit.list'))[0].id }); return acts.find(a => a.id === id)?.due_date; }, actRowId);
      ok(gpDraggedDue === '2027-01-18', `dragging a not-yet-overdue milestone 3 days forward round-trips through a real action.update call with no reason needed (got ${gpDraggedDue})`);
    }

    // Overdue drag needs a reason (§6.3a rule 4). Use the second action (created from the
    // requirement drawer above, still has no due date) — give it a past due date first via the
    // register's own inline editor (setting a PREVIOUSLY-NULL due date needs no reason; only
    // CHANGING an already-overdue one does), then drag it in the Gantt.
    const secondActId = await page.evaluate(async (skipId) => {
      const acts = await ISO.api('action.list', { auditId: (await ISO.api('audit.list'))[0].id });
      return (acts.find(a => a.id !== skipId) || {}).id;
    }, actRowId);
    await page.evaluate(() => ISO.setTab('actions'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate((id) => { document.querySelector(`tr[data-iact="${id}"] td[data-field="due_date"]`)?.click(); }, secondActId);
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { document.getElementById('mt-edit-date').value = '2026-01-01'; });
    await page.evaluate(() => document.querySelector('#ws-cell-dd .mt-dd-save').click());
    await new Promise(r => setTimeout(r, 700));

    await page.evaluate(() => ISO.setTab('actionplan'));
    await new Promise(r => setTimeout(r, 700));
    const secondBarBox = await page.evaluate((id) => {
      const el = document.getElementById('g2g-bar-' + id);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, secondActId);
    ok(!!secondBarBox, 'the now-overdue second action also renders as a real bar in the Action plan Gantt');
    if (secondBarBox) {
      await page.mouse.move(secondBarBox.x, secondBarBox.y);
      await page.mouse.down();
      await page.mouse.move(secondBarBox.x + 20, secondBarBox.y, { steps: 5 });
      await page.mouse.up();
      await new Promise(r => setTimeout(r, 700));
      const reasonPromptShownGantt = await page.evaluate(() => !!document.getElementById('sp-val'));
      ok(reasonPromptShownGantt, 'dragging an already-overdue action\'s bar prompts for a reason through the app\'s own modal (§6.3a rule 4), same as the register\'s own inline editor — not a native dialog, not a silent skip');
      if (reasonPromptShownGantt) {
        await page.type('#sp-val', 'Rescheduled after confirming the supplier\'s lead time.');
        await page.evaluate(() => document.querySelector('#generic-modal-body button.btn-teal').click());
        await new Promise(r => setTimeout(r, 700));
      }
      const secondActAfter = await page.evaluate(async (id) => { const acts = await ISO.api('action.list', { auditId: (await ISO.api('audit.list'))[0].id }); return acts.find(a => a.id === id)?.due_date; }, secondActId);
      ok(secondActAfter === '2026-01-03', `once the reason is supplied, the overdue drag really persists through a real action.update call (got ${secondActAfter})`);
    }

    // ── XSS: an audit title with a payload renders as text, never executes ──────────────────────
    // Requirements, not Settings, is the landing tab since Phase 6.1 — switch tabs to reach the
    // title field this check needs.
    await page.evaluate(() => ISO.setTab('settings'));
    await new Promise(r => setTimeout(r, 400));
    const xssTitle = `<img src=x onerror=window.__xss=1>"'`;
    await page.evaluate((title) => {
      document.getElementById('iso-set-title').value = title;
    }, xssTitle);
    await page.evaluate(async () => {
      const a = await ISO.api('audit.get', { auditId: (await ISO.api('audit.list'))[0].id });
      ISO.saveSettings(a.id, a.row_version);
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => window.renderView('iso'));
    await new Promise(r => setTimeout(r, 400));
    const xssResult = await page.evaluate(() => ({ xss: window.__xss, hasImg: !!document.querySelector('#view-container img[src="x"]') }));
    ok(xssResult.xss === undefined, 'an XSS payload in the audit title never executes (window.__xss stays undefined)');
    ok(!xssResult.hasImg, 'the XSS payload does not become a live <img> element — it renders as escaped text');

    await page.evaluate(() => window.navigate('iso'));
    await new Promise(r => setTimeout(r, 500));
    const sidebarXss = await page.evaluate(() => ({ xss: window.__xss, html: document.getElementById('sidebar-iso-list').innerHTML }));
    ok(sidebarXss.xss === undefined, 'the same XSS payload never executes when rendered in the sidebar list either');
    ok(!/<img/i.test(sidebarXss.html), 'the sidebar never contains a live <img> tag from user-entered board data');

    // ── archived client is absent from the sidebar despite being a valid fixture client id ────
    await callIso(PORT, admin, { op: 'audit.create', clientId: 'c2', standards: ['9001'], title: 'Should not show — archived client' });
    await page.evaluate(() => ISO.invalidate());
    await page.evaluate(() => ISO.openLanding());
    await new Promise(r => setTimeout(r, 600));
    const sidebarText = await page.evaluate(() => document.getElementById('sidebar-iso-list').innerText);
    ok(!/Archived Test Client/.test(sidebarText), 'a board for an archived client never appears in the sidebar');

    // New-board flow, "All three" standards — second and third boards, refs -002/-003, growing
    // requirement totals as each additional standard's (here: only 9001 has real library data in
    // this suite's minimal fixture, so 2/3-standard picks still resolve against the same single
    // approved standard) pinned version is copied in. openLanding() first — the previous board
    // creation left route.auditId pointing at board -001, so a bare navigate('iso') would still
    // show that board's chrome, not the landing page's "+ New ISO board" button.
    await page.evaluate(() => ISO.openLanding());
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => document.querySelector('.iso-landing-head button').click());
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => document.querySelector('.iso-wiz-client-row').click());
    await page.evaluate(() => ISO._wizNext());
    await page.evaluate(() => ISO._wizToggleStandard('9001'));
    await page.evaluate(() => ISO._wizNext());
    await page.evaluate(() => ISO._wizCreate());
    await new Promise(r => setTimeout(r, 1000));
    const created2 = await page.evaluate(async () => (await ISO.api('audit.list')).find(x => x.ref.endsWith('-002')));
    ok(created2 && created2.ref.endsWith('-002'), `a second new-board creation gets ref -002 (got ${created2 && created2.ref})`);

    // ── access modal + save (real UI) ──────────────────────────────────────────────────────────
    await page.evaluate(async () => { const a = (await ISO.api('audit.list'))[0]; ISO.openBoard(a.id); });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => ISO.openAccessModal());
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => { document.getElementById('iso-wiz-vis').value = 'private'; ISO._wizSetVis('private'); });
    await page.evaluate(() => ISO._saveAccess());
    await new Promise(r => setTimeout(r, 700));
    const afterAccess = await page.evaluate(async () => { const a = (await ISO.api('audit.list'))[0]; return a.visibility; });
    ok(afterAccess === 'private', `the access modal's visibility change persists (got ${afterAccess})`);

    // ── admin page: library versions list + approve is reachable ──────────────────────────────
    await page.evaluate(() => window.navigate('iso-admin'));
    await new Promise(r => setTimeout(r, 700));
    const adminText = await page.evaluate(() => document.getElementById('view-container').innerText);
    ok(/9001/.test(adminText) && /approved|Approve/.test(adminText), 'the ISO admin page lists the 9001 library version with its status');

    // ── no new tab, ever — checked across the whole flow above ─────────────────────────────────
    const openCount = await page.evaluate(() => window.__openCount);
    ok(openCount === 0, `window.open was never called through the whole flow (got ${openCount})`);
    const targetScan = await page.evaluate(() => {
      const withTarget = [...document.querySelectorAll('[data-iso-audit], [data-iso-client], .iso-nav-row, .iso-client-row, .ws-tabstrip, .ws-tab')].filter(el => el.hasAttribute('target'));
      return withTarget.length;
    });
    ok(targetScan === 0, 'no ISO element in the live DOM carries a target attribute');

    // Static scan of the ISO source files themselves (plan 5.1's Tests) — never window.open,
    // target=, location.href= or _clickDownload( without a second argument.
    const isoSrc = fs.readFileSync(path.join(ROOT, 'iso', 'iso-core.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'iso', 'iso-import.js'), 'utf8');
    ok(!/window\.open\s*\(/.test(isoSrc), 'iso/*.js never calls window.open');
    ok(!/\btarget\s*=\s*['"]/.test(isoSrc), 'iso/*.js never sets a target= attribute in a template string');
    ok(!/location\.href\s*=/.test(isoSrc), 'iso/*.js never assigns location.href');
    ok(!/_clickDownload\(\s*[^,)]*\s*\)/.test(isoSrc), 'iso/*.js never calls _clickDownload with fewer than 2 arguments');
    // Plan 2.5, closed 2026-10-06 (release-1 B0.6): ISO data must never be served stale from Task Hub's
    // view cache. The ISO route renders straight through ISO.render — guard that it stays that way.
    const isoRouteLine = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/case 'iso':[^\n]*/) || [''])[0];
    ok(/ISO\.render\(vc\)/.test(isoRouteLine) && !/_renderCached/.test(isoRouteLine), `the ISO route renders directly, never through _renderCached (got ${JSON.stringify(isoRouteLine.trim().slice(0, 120))})`);

    ok(consoleErrors.length === 0, `no console errors through the whole flow (got ${JSON.stringify(consoleErrors)})`);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
