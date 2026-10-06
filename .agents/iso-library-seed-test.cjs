// Phase 4b.1 acceptance (R13, D24): the standard library as reviewed seed files, one per edition.
// Part D (added 2026-10-03) checks library.retire — discarding a never-used draft, or retiring an
// approved edition. Never a real delete (ISO records are archived, never deleted).
// Part A checks the seed files themselves (library columns only, no client data, the same stable
// keys the workbook import produces). Part B drives library.seeds / library.loadSeed / audit.create
// editions over HTTP on a fresh offline temp server. Part C walks the admin page and the new-board
// wizard in a real browser.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3139;
const SEED_DIR = path.join(ROOT, 'iso', 'seed', 'library');
const WORKBOOK_PATH = path.join(ROOT, 'workboard', 'ISO Audit', 'source', 'ISO 9001, 14001, 45001 Gap Analysis Etcher_Coastal Electrics V2.0.xlsx');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function loadVendoredXlsxForNode(file) {
  const code = fs.readFileSync(file, 'utf8');
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code);
  fn(moduleObj, moduleObj.exports, require);
  return moduleObj.exports;
}
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
const STAFF = { id: 'u2', role: 'staff' };
const data = res => res.body && res.body.data;

(async () => {
  // ── Part A: the seed files ────────────────────────────────────────────────────────────────
  // R1 (2026-10-04, D35): v3 replaced the library outright — one edition per standard, no more
  // drafted amendments layered on an approved 2015 base. The old workbook cross-check (against
  // the gitignored prototype file) no longer applies; v3's own source file is the one in the repo
  // root, checked against the live seed's own recorded sha256 instead.
  const EXPECT = { '9001-2026': 60, '14001-2026': 33, '45001-2018-a1': 40 };
  const seeds = {};
  for (const key of Object.keys(EXPECT)) {
    const file = path.join(SEED_DIR, key + '.json');
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    ok(!!raw, `seed file ${key}.json exists`);
    if (!raw) continue;
    const s = JSON.parse(raw);
    seeds[key] = s;
    ok(s.seedKey === key && s.standardCode === key.split('-')[0] && s.status === 'approved', `${key}: seedKey/standardCode agree with the file name, approved on load (D43)`);
    ok(s.items.length === EXPECT[key], `${key}: ${EXPECT[key]} requirements (got ${s.items.length})`);
    ok(s.items.every(i => i.imported && !('currentSystem' in i.imported) && !('complianceStatus' in i.imported) && !('plannedAction' in i.imported)), `${key}: no client assessment columns (current system / status / planned action) in any item`);
    ok(!/coastal/i.test(raw), `${key}: the client's name appears nowhere in the seed file`);
    ok(!('todoRows' in s), `${key}: no client To-Do rows`);
    ok(/not ISO text/i.test(s.wording || '') && /Etcher_Solutions_ISO_Audit_Registers_Editable_v3/.test(s.scopeNote || ''), `${key}: carries the Etcher-wording note and cites the v3 register as its source`);
  }
  const isoImportServer = require(path.join(ROOT, 'api', '_isoImport.js'));
  for (const [key, s] of Object.entries(seeds)) {
    let threw = null;
    try { isoImportServer.validateCandidates({ sha256: s.sourceSha256, sourceFilename: s.sourceFilename, sections: s.sections, items: s.items, todoRows: [] }); } catch (e) { threw = e.message; }
    ok(!threw, `${key}: passes the import's own validateCandidates (got ${threw || 'ok'})`);
  }
  const V3_PATH = path.join(ROOT, 'Etcher_Solutions_ISO_Audit_Registers_Editable_v3.xlsx');
  if (fs.existsSync(V3_PATH)) {
    const crypto = require('crypto');
    const realSha = crypto.createHash('sha256').update(fs.readFileSync(V3_PATH)).digest('hex');
    ok(Object.values(seeds).every(s => s.sourceSha256 === realSha), 'every seed records the real v3 workbook\'s own sha256 (it has not silently drifted from the seed)');
  } else {
    pass.push('(v3 workbook not present locally — sha256 cross-check skipped, gitignored file)');
  }

  // ── Part B + C: fresh offline server ──────────────────────────────────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-libseed-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser = null;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;

    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
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

    const wizardToStep2 = async (codes) => {
      await page.evaluate(() => window.navigate('iso'));
      await new Promise(r => setTimeout(r, 600));
      await page.evaluate(() => document.querySelector('.iso-landing-head button').click());
      await new Promise(r => setTimeout(r, 400));
      await page.evaluate(() => document.querySelector('.iso-wiz-client-row').click());
      await new Promise(r => setTimeout(r, 150));
      await page.evaluate(() => ISO._wizNext());
      await new Promise(r => setTimeout(r, 300));
      for (const c of codes) { await page.evaluate(code => ISO._wizToggleStandard(code), c); await new Promise(r => setTimeout(r, 150)); }
    };

    // C1: before anything is loaded, the wizard says so instead of letting a create fail.
    await wizardToStep2(['14001']);
    const noLibHint = await page.evaluate(() => document.querySelector('.iso-wiz-nolib')?.textContent || '');
    ok(/No approved ISO 14001 library yet/.test(noLibHint), `with no library loaded, step 2 points to the built-in library (got ${JSON.stringify(noLibHint)})`);
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));

    // B1: library.seeds before loading; a non-admin cannot load.
    // R1/D42: the multi-edition drafted-amendment system (4b.2, iso-editions-test) is removed —
    // v3 ships exactly one edition per standard, all three reviewed and approved (D43).
    const seedsBefore = data(await callIso(ADMIN, { op: 'library.seeds' })) || [];
    ok(seedsBefore.length === 3 && seedsBefore.every(s => s.seedStatus === 'approved' && !s.loadedVersionId), `library.seeds lists the 3 built-in editions, all approved, none loaded yet (got ${JSON.stringify(seedsBefore.map(s => [s.seedKey, s.seedStatus, s.loadedVersionId]))})`);
    const staffLoad = await callIso(STAFF, { op: 'library.loadSeed' });
    ok(staffLoad.status === 403, `a non-admin cannot load the built-in library (got ${staffLoad.status})`);

    // C2: the admin page's Built-in library card loads all three with one click.
    await page.evaluate(() => window.navigate('iso-admin'));
    await new Promise(r => setTimeout(r, 900));
    const cardBefore = await page.evaluate(() => document.getElementById('iso-admin-seeds')?.innerText || '');
    ok(/Built-in library/.test(cardBefore) && /no upload needed/i.test(cardBefore) && /ISO 9001:2026/.test(cardBefore), 'the ISO admin page shows the Built-in library card with the editions on offer');
    await page.evaluate(() => [...document.querySelectorAll('#iso-admin-seeds button')].find(b => b.textContent.trim() === 'Load all')?.click());
    await new Promise(r => setTimeout(r, 2500));
    const cardAfter = await page.evaluate(() => document.getElementById('iso-admin-seeds')?.innerText || '');
    ok((cardAfter.match(/Loaded \(approved\)/g) || []).length === 3, `after Load all, all three rows read "Loaded (approved)" (got ${JSON.stringify(cardAfter.slice(0, 300))})`);

    // B2: what landed in the store, and loading again changes nothing.
    const versions = data(await callIso(ADMIN, { op: 'library.versions' })) || [];
    const byKey = Object.fromEntries(versions.map(v => [v.standard_code + '-' + v.edition, v]));
    ok(['9001-2026', '14001-2026', '45001-2018+A1:2024'].every(k => byKey[k] && byKey[k].status === 'approved'), `three approved versions with their editions (got ${JSON.stringify(versions.map(v => [v.standard_code, v.edition, v.status]))})`);
    ok(byKey['9001-2026'] && /ISO 9001:2026/.test(byKey['9001-2026'].label), 'the version label carries the edition');
    const countReqs = async () => (await db.list('iso_library_requirements', {})).length;
    const reqsAfterFirst = await countReqs();
    ok(reqsAfterFirst === 60 + 33 + 40, `the library holds 60 + 33 + 40 = 133 requirements (got ${reqsAfterFirst})`);
    const again = data(await callIso(ADMIN, { op: 'library.loadSeed' })) || [];
    ok(again.length === 3 && again.every(r => r.skipped), 'loading again skips every edition (idempotent)');
    ok((await countReqs()) === reqsAfterFirst, 'and adds no rows');

    // B3: editions and boards. Board A is created while 2026 is the only 9001 edition.
    // R1/D42: the real second edition this once stood in for (a future 9001:2026) now IS the real
    // live one, so the stand-in moves one edition further out (a future, still-hypothetical
    // 9001:2027) — same synthetic-insert technique, same thing proved.
    const boardA = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Board A' }));
    ok(boardA && boardA.id, 'board A created on the seeded library');
    const now = new Date().toISOString();
    await db.insert('iso_standard_versions', { id: 'iver_9001_2027', standard_code: '9001', label: 'ISO 9001:2027 — test', edition: '2027', status: 'approved', approved_at: now, created_at: now });
    await db.insert('iso_clause_sections', { id: 'isec_9001_2027', version_id: 'iver_9001_2027', clause: '4', title: 'Context', level: 1, sort_key: 0 });
    await db.insert('iso_library_requirements', { id: 'ilr_9001_2027', version_id: 'iver_9001_2027', section_id: 'isec_9001_2027', clause: '4.1', clause_name: 'Context', requirement_text: 'Test 2027 requirement', stable_key: '9001|4.1|t27|0', sort_key: 0 });
    const boardB = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Board B' }));
    const boardC = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], editions: { '9001': '2026' }, title: 'Board C' }));
    const getB = data(await callIso(ADMIN, { op: 'audit.get', auditId: boardB.id }));
    const getC = data(await callIso(ADMIN, { op: 'audit.get', auditId: boardC.id }));
    const getA = data(await callIso(ADMIN, { op: 'audit.get', auditId: boardA.id }));
    ok(getB && getB.editions && getB.editions['9001'] === '2027', `with no edition asked for, a new board gets the newest approved edition (got ${JSON.stringify(getB && getB.editions)})`);
    ok(getC && getC.editions && getC.editions['9001'] === '2026', `a board can still be created on the older edition (got ${JSON.stringify(getC && getC.editions)})`);
    ok(getA && getA.editions && getA.editions['9001'] === '2026', 'board A keeps the edition it was created on after a newer one appears');
    const reqCount = async id => (data(await callIso(ADMIN, { op: 'requirement.list', auditId: id })) || []).length;
    ok((await reqCount(boardA.id)) === 60 && (await reqCount(boardC.id)) === 60 && (await reqCount(boardB.id)) === 1, 'each board holds its own edition\'s requirements (60 / 60 / 1)');
    const listA = (data(await callIso(ADMIN, { op: 'audit.list' })) || []).find(a => a.id === boardA.id);
    ok(listA && listA.editions && listA.editions['9001'] === '2026', 'audit.list carries the editions map for the sidebar');
    const badEdition = await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], editions: { '9001': '1999' } });
    ok(badEdition.status === 400 && /9001:1999/.test(JSON.stringify(badEdition.body)), `asking for an edition that has no approved library is refused clearly (got ${badEdition.status})`);
    const badShape = await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], editions: ['2015'] });
    ok(badShape.status === 400, 'a malformed editions payload is refused');

    // B4: a plain workbook import never merges into an edition's draft.
    await db.insert('iso_standard_versions', { id: 'iver_45001_2028', standard_code: '45001', label: 'ISO 45001:2028 — draft', edition: '2028', status: 'draft', created_at: now });
    const s45 = seeds['45001-2018-a1'];
    const preview = await callIso(ADMIN, { op: 'import.preview', kind: 'library', sha256: 'a'.repeat(64), sourceFilename: 'legacy.xlsx', sections: s45.sections.slice(0, 2), items: s45.items.slice(0, 1), todoRows: [], warnings: [] });
    const per = preview.body && preview.body.data && preview.body.data.summary && preview.body.data.summary.perStandard && preview.body.data.summary.perStandard[0];
    ok(per && per.isNewVersion === true, `a workbook import with no edition starts its own draft instead of merging into the 45001:2027 draft (got ${JSON.stringify(per && { isNewVersion: per.isNewVersion })})`);

    // C3: the wizard's edition picker and the edition shown on the board.
    // R1/D42: with the synthetic 9001:2027 from B3 still in the store, two approved 9001 editions
    // genuinely exist right now, so the real two-edition picker is still exercised for real —
    // just '2027,2026' instead of the old '2026,2015'.
    await wizardToStep2(['9001']);
    await new Promise(r => setTimeout(r, 600));
    const picker = await page.evaluate(() => { const s = document.querySelector('.iso-wiz-edition[data-std="9001"]'); return s ? { opts: [...s.options].map(o => o.value), val: s.value } : null; });
    ok(picker && picker.opts.join(',') === '2027,2026' && picker.val === '2027', `with two approved editions, step 2 shows an edition picker defaulting to the newest (got ${JSON.stringify(picker)})`);
    await page.select('.iso-wiz-edition[data-std="9001"]', '2026');
    await page.evaluate(() => ISO._wizNext());
    await new Promise(r => setTimeout(r, 200));
    await page.evaluate(() => ISO._wizCreate());
    await new Promise(r => setTimeout(r, 1800));
    // D27: a new board opens on its Dashboard; these checks read the register.
    await page.evaluate(() => ISO.setTab('requirements'));
    await new Promise(r => setTimeout(r, 1200));
    const boardUi = await page.evaluate(() => ({
      header: document.querySelector('.iso-board-editions')?.textContent || '',
      group: document.querySelector('.iso-clause-section-label')?.textContent || '',
      rows: document.querySelectorAll('[data-ireq]').length,
    }));
    ok(boardUi.header === 'ISO 9001:2026', `the board header names the edition the user picked (got ${JSON.stringify(boardUi.header)})`);
    // R3 (D35 P2): group headers are shared clause-family titles now ("4 Context of the
    // organization"), never edition-qualified — the board header above already names the edition,
    // and each row's own standard tag carries it on hover (title attribute).
    ok(/^4 /.test(boardUi.group), `the register's group headers are plain clause-family titles (got ${JSON.stringify(boardUi.group)})`);
    ok(boardUi.rows === 60, `the board created on 2026 from the wizard has the 60 seeded requirements (got ${boardUi.rows})`);
    const firstReq = await page.evaluate(() => document.querySelector('[data-ireq]')?.dataset.ireq);
    // td:nth-child(2) is the name cell — the first cell is row selection (same as iso-ui-test).
    await page.evaluate((id) => ISO._reqOpenMore(id), firstReq);
    await new Promise(r => setTimeout(r, 1200));
    const drawerText = await page.evaluate(() => document.getElementById('iso-drawer-body')?.innerText || '');
    ok(/Requirement \(Etcher wording\) · ISO 9001:2026/.test(drawerText) && /Check the licensed standard for the authoritative text/.test(drawerText), `the requirement drawer labels the text as Etcher wording with its edition (got ${JSON.stringify(drawerText.slice(0, 120))})`);

    // ── Part D: library.retire — "how do I remove it" (discard a never-used draft; retire an
    // approved edition). Never a real delete: the row moves to `retired`, which pickApprovedVersion
    // already excludes and library.approve already refuses to re-approve.
    // R1/D43: all three real editions load approved, so there is no real draft left to discard.
    // The "discard" half uses the synthetic 45001:2028 draft version B4 already inserted above
    // (same iso_standard_versions row a real drafted seed would have produced); the "retire" half
    // uses the real, now-approved 45001:2018+A1:2024 edition.
    const draftVersionId = 'iver_45001_2028';
    ok((data(await callIso(ADMIN, { op: 'library.versions' })) || []).find(v => v.id === draftVersionId)?.status === 'draft', 'the synthetic 45001:2028 version from Part B4 is on the server as a draft, ready to be discarded or approved');
    // Before anything is discarded: the admin page's real DOM offers both buttons on a draft row.
    await page.evaluate(() => window.navigate('iso-admin'));
    await new Promise(r => setTimeout(r, 1200));
    const draftRowBefore = await page.evaluate(() => {
      const table = document.querySelectorAll('#iso-admin-seeds ~ .card table')[0];
      const tr = table && [...table.querySelectorAll('tbody tr')].find(t => { const tds = t.querySelectorAll('td'); return tds[0] && tds[0].textContent.trim() === '45001' && tds[1] && tds[1].textContent.trim() === '2028'; });
      return tr ? [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
    });
    ok(draftRowBefore && draftRowBefore.join() === 'Approve,Discard draft', `an unapproved draft's row offers both Approve and Discard draft (got ${JSON.stringify(draftRowBefore)})`);
    const nonAdminRetire = await callIso(STAFF, { op: 'library.retire', id: draftVersionId });
    ok(nonAdminRetire.status === 403, `a non-admin cannot discard or retire a library version (got ${nonAdminRetire.status})`);
    const badId = await callIso(ADMIN, { op: 'library.retire', id: 'iver_does_not_exist_000000' });
    ok(badId.status === 404, `retiring an unknown version is refused (got ${badId.status})`);
    const discard = await callIso(ADMIN, { op: 'library.retire', id: draftVersionId });
    ok(discard.status === 200 && data(discard).status === 'retired', `an admin discards the never-used draft — it moves to retired (got ${discard.status} ${data(discard) && data(discard).status})`);
    const discardActs = (await db.list('iso_activity', {})).filter(a => a.entity_type === 'library_version' && a.entity_id === draftVersionId);
    ok(discardActs.some(a => a.action === 'draft_discarded') && !discardActs.some(a => a.action === 'retired'), `discarding a draft is logged as draft_discarded, not retired (got ${JSON.stringify(discardActs.map(a => a.action))})`);
    ok((await callIso(ADMIN, { op: 'library.approve', id: draftVersionId })).status === 400, 'a discarded draft can no longer be approved');
    ok((await callIso(ADMIN, { op: 'library.retire', id: draftVersionId })).status === 400, 'retiring an already-retired version a second time is refused');

    // Retire an approved edition a board already uses — the existing board must be completely unaffected.
    const v45001 = (data(await callIso(ADMIN, { op: 'library.versions' })) || []).find(v => v.standard_code === '45001' && v.status === 'approved');
    ok(!!v45001, 'the approved 45001:2018+A1:2024 version is on the server, ready to retire');
    const boardBeforeRetire = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['45001'], title: 'Before retire' }));
    const reqCountBefore = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: boardBeforeRetire.id })) || []).length;
    const retireIt = await callIso(ADMIN, { op: 'library.retire', id: v45001.id });
    ok(retireIt.status === 200 && data(retireIt).status === 'retired', `an admin retires an approved edition (got ${retireIt.status})`);
    const retireActs = (await db.list('iso_activity', {})).filter(a => a.entity_type === 'library_version' && a.entity_id === v45001.id);
    ok(retireActs.some(a => a.action === 'retired') && !retireActs.some(a => a.action === 'draft_discarded'), `retiring an approved edition is logged as retired, not draft_discarded (got ${JSON.stringify(retireActs.map(a => a.action))})`);
    const reqCountAfter = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: boardBeforeRetire.id })) || []).length;
    ok(reqCountAfter === reqCountBefore && reqCountAfter === 40, `the board created before the retire keeps all 40 of its requirements afterwards (got ${reqCountBefore} → ${reqCountAfter})`);
    const auditGetAfter = data(await callIso(ADMIN, { op: 'audit.get', auditId: boardBeforeRetire.id }));
    ok(auditGetAfter && auditGetAfter.editions && auditGetAfter.editions['45001'] === '2018+A1:2024', "and the board's own pinned edition label is untouched");
    const newBoardAfterRetire = await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['45001'], title: 'After retire' });
    ok(newBoardAfterRetire.status === 400 && /No approved library version for ISO 45001/.test(JSON.stringify(newBoardAfterRetire.body)), `with no approved 45001 edition left, a new board on 45001 is refused clearly (got ${newBoardAfterRetire.status})`);

    // The admin page, in the real browser already open from Part C: Retire an approved edition
    // (14001:2026) end to end, and confirm a retired/discarded row shows no action button. Rows are
    // matched by their exact Standard + Edition cells, never by fuzzy text search.
    await page.evaluate(() => window.navigate('iso-admin'));
    await new Promise(r => setTimeout(r, 1200));
    const rowButtons = (std, edition) => page.evaluate((std, edition) => {
      const table = document.querySelectorAll('#iso-admin-seeds ~ .card table')[0];
      const tr = table && [...table.querySelectorAll('tbody tr')].find(t => {
        const tds = t.querySelectorAll('td');
        return tds[0] && tds[0].textContent.trim() === std && tds[1] && tds[1].textContent.trim() === edition;
      });
      return tr ? [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
    }, std, edition);
    const before14001 = await rowButtons('14001', '2026');
    ok(before14001 && before14001.join() === 'Retire', `an approved edition's row offers only Retire (got ${JSON.stringify(before14001)})`);
    const discardedRow = await rowButtons('45001', '2028');
    ok(discardedRow && discardedRow.length === 0, "the discarded draft's row (45001:2028) now offers no action button");
    const retiredRow = await rowButtons('45001', '2018+A1:2024');
    ok(retiredRow && retiredRow.length === 0, 'the retired 45001:2018+A1:2024 edition\'s row now offers no action button either');
    await page.evaluate(() => {
      const table = document.querySelectorAll('#iso-admin-seeds ~ .card table')[0];
      const tr = [...table.querySelectorAll('tbody tr')].find(t => { const tds = t.querySelectorAll('td'); return tds[0] && tds[0].textContent.trim() === '14001' && tds[1] && tds[1].textContent.trim() === '2026'; });
      [...tr.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retire').click();
    });
    await new Promise(r => setTimeout(r, 500));
    const modal = await page.evaluate(() => ({ title: document.getElementById('generic-modal-title')?.textContent || '', body: document.getElementById('generic-modal-body')?.innerText || '' }));
    ok(modal.title === 'Retire library version' && /no longer be offered to new boards/.test(modal.body) && /Boards already created on this edition keep working/.test(modal.body) && /cannot be undone/.test(modal.body), `Retire asks first, naming the consequence for new boards and the safety of existing ones (got ${JSON.stringify(modal.title)})`);
    const stillApproved = (data(await callIso(ADMIN, { op: 'library.versions' })) || []).find(v => v.standard_code === '14001');
    ok(stillApproved && stillApproved.status === 'approved', 'nothing is retired until the confirm button is actually clicked');
    await page.click('#iso-retire-confirm');
    await new Promise(r => setTimeout(r, 1200));
    const after14001 = await rowButtons('14001', '2026');
    ok(after14001 && after14001.length === 0, 'confirming retires it — the row now offers no action button');
    const retired14001 = (data(await callIso(ADMIN, { op: 'library.versions' })) || []).find(v => v.standard_code === '14001');
    ok(retired14001 && retired14001.status === 'retired', 'and the server really did retire it, not just the DOM');

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
