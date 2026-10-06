// Phase 1 acceptance (plan 1.1-1.3, 1.5): mounts a FAKE Main Table ctx — 3 sections, 10 distinct
// records (11 row slots: 'r1' deliberately appears in two sections under two different keys) —
// and drives it entirely through the new generic adapter path (_mtRenderGeneric/_mtRowHtml/
// _mtStateFor/_mtCellCommit), never through renderWorkspace's Workboards branch. Proves the
// contract works for a non-task ctx before anything real (ISO, Phase 6+) depends on it, and that
// per-ctx state never leaks into the Workboards globals it wraps.
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

  await p.goto('http://localhost:3001/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));
  await p.type('#login-email', 'b.canto@etchersolutions.com');
  await p.type('#login-password', 'TaskHub123');
  await p.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1800));

  const R = await p.evaluate(async () => {
    const o = {};
    document.body.insertAdjacentHTML('beforeend', '<div id="mt-adapter-test-root"></div>');
    const root = document.getElementById('mt-adapter-test-root');

    const records = {};
    for (let i = 1; i <= 10; i++) records['r' + i] = { id: 'r' + i, name: 'Row ' + i, foo: 'val' + i };
    const saveCalls = [], bulkCalls = [];
    let order = 'a';
    let failNextSave = false;
    const mk = (id, key) => ({ ...records[id], key: key || id, id });
    const fakeCtx = {
      key: 'fake:test',
      columns() { return [{ key: 'foo', label: 'Foo' }]; },
      subColumns() { return null; },
      customColumns() { return []; },
      sections() {
        if (order === 'a') return [
          { id: 'secA', label: 'Section A', color: '#111', rows: [mk('r1', 'secA~r1'), mk('r2'), mk('r3'), mk('r4')] },
          { id: 'secB', label: 'Section B', color: '#222', rows: [mk('r1', 'secB~r1'), mk('r5'), mk('r6')] },
          { id: 'secC', label: 'Section C', color: '#333', rows: [mk('r7'), mk('r8'), mk('r9'), mk('r10')] },
        ];
        return [
          { id: 'secA', label: 'Section A', color: '#111', rows: [mk('r4'), mk('r3'), mk('r2'), mk('r1', 'secA~r1')] },
          { id: 'secB', label: 'Section B', color: '#222', rows: [mk('r6'), mk('r5'), mk('r1', 'secB~r1')] },
          { id: 'secC', label: 'Section C', color: '#333', rows: [mk('r10'), mk('r9'), mk('r8'), mk('r7')] },
        ];
      },
      children() { return []; },
      rowId(row) { return row.key; },
      rowAttrs(row) { return { 'data-tid': row.key }; },
      cell(row, key) { return { html: escHtml(String(row[key] ?? '')), title: '' }; },
      editor(row, key) { return { type: 'text', value: row[key], label: 'Edit ' + key }; },
      save(id, key, value) {
        saveCalls.push([id, key, value]);
        if (failNextSave) { failNextSave = false; return Promise.reject(new Error('simulated rejection')); }
        records[id][key] = value;
        return Promise.resolve(true);
      },
      open() {},
      bulkActions() { return [{ id: 'test', label: 'Test', run: (ids) => bulkCalls.push(ids) }]; },
      toolbar() { return null; },
      rerender() { root.innerHTML = _mtRenderGeneric(fakeCtx); },
      groupByOptions() { return []; },
      sortOptions() { return []; },
      emptyHtml() { return 'empty'; },
      canDragRows() { return true; },
    };

    // ── spy: no DB.tasks access while the fake ctx renders/interacts ──────────────────────────
    let dbTasksAccessed = false;
    const realTasks = DB.tasks;
    DB.tasks = new Proxy(realTasks, { get(t, prop) { dbTasksAccessed = true; return t[prop]; } });

    _mtCtx = fakeCtx;
    root.innerHTML = _mtRenderGeneric(fakeCtx);
    o.rowCount = root.querySelectorAll('tr[data-tid]').length;
    o.sectionCount = root.querySelectorAll('tr.ws-grp-hdr').length;
    o.distinctDomIds = new Set([...root.querySelectorAll('tr[data-tid]')].map(tr => tr.getAttribute('data-tid'))).size;
    o.sharedRecordRowCount = [...root.querySelectorAll('tr[data-tid]')].filter(tr => tr.getAttribute('data-tid').endsWith('~r1')).length;

    // sort/group: flip order, re-render, confirm the row sequence in section A actually changed
    order = 'b';
    fakeCtx.rerender();
    const firstRowAfterFlip = root.querySelector('.ws-grp-hdr + tr')?.getAttribute('data-tid'); // first data row under section A's header
    o.sortGroupChangedOrder = firstRowAfterFlip === 'r4'; // order='b' reverses section A to [r4,r3,r2,r1] — only the deliberately-shared r1 carries a 'secA~' key prefix
    order = 'a';
    fakeCtx.rerender();

    // collapse
    _mtToggleSection('secA');
    o.collapsedHidesRows = !root.querySelector('tr[data-tid="secA~r1"]');
    _mtToggleSection('secA');
    o.expandShowsRowsAgain = !!root.querySelector('tr[data-tid="secA~r1"]');

    // inline edit -> save called with right args, and both rendered instances reflect it
    await _mtCellCommit(fakeCtx, 'secA~r1', 'r1', 'foo', 'EDITED');
    o.saveCalledWith = saveCalls[saveCalls.length - 1];
    o.bothInstancesUpdated = root.querySelector('tr[data-tid="secA~r1"] td[data-field="foo"]')?.textContent === 'EDITED'
      && root.querySelector('tr[data-tid="secB~r1"] td[data-field="foo"]')?.textContent === 'EDITED';

    // plan 1.5: a rejected save shows a toast and rolls back to the previous value (re-render
    // from the ctx's own — unmutated — data, since save() rejected before writing).
    const toastCountBefore = document.querySelectorAll('.app-toast').length;
    failNextSave = true;
    let threw = false;
    try { await _mtCellCommit(fakeCtx, 'secA~r2', 'r2', 'foo', 'SHOULD-NOT-STICK'); }
    catch (e) { threw = true; }
    o.rejectedCommitRethrows = threw;
    o.rejectedSaveDidNotMutate = records.r2.foo === 'val2';
    o.rollbackShowsOldValue = root.querySelector('tr[data-tid="r2"] td[data-field="foo"]')?.textContent === 'val2';
    o.toastShownOnRejection = document.querySelectorAll('.app-toast').length > toastCountBefore;

    // resize persists under ctx.key, isolated from the Workboards ('wb') bucket
    const wbWidthBefore = _mtStateFor('wb').columns.foo;
    _mtSetColWidth(fakeCtx.key, 'foo', '222px');
    o.resizePersistsUnderCtxKey = _mtStateFor('fake:test').columns.foo === '222px';
    o.resizeNeverLeaksIntoWb = _mtStateFor('wb').columns.foo === wbWidthBefore;

    // bulk action receives ids
    fakeCtx.bulkActions()[0].run(['r2', 'r3']);
    o.bulkReceivedIds = bulkCalls[0];

    // selection isolation (plan 1.3's own example: "selecting in the fake ctx leaves wsSelected untouched")
    const wsSelectedSizeBefore = wsSelected.size;
    _mtToggleRowSelect('r2', true);
    o.fakeSelectionRecorded = _mtStateFor('fake:test').selected.has('r2');
    o.wsSelectedUntouched = wsSelected.size === wsSelectedSizeBefore;

    o.dbTasksAccessed = dbTasksAccessed;
    DB.tasks = realTasks; // restore before anything else in the page touches it
    root.remove();
    _mtCtx = null;
    return o;
  });

  ok(R.rowCount === 11, `renders all 11 row slots for 10 distinct records across 3 sections (got ${R.rowCount})`);
  ok(R.sectionCount === 3, `renders 3 section headers (got ${R.sectionCount})`);
  ok(R.distinctDomIds === 11, `one record in two sections -> two rows with distinct DOM ids (got ${R.distinctDomIds} distinct of 11 rows)`);
  ok(R.sharedRecordRowCount === 2, `the shared record (r1) renders exactly twice, once per section (got ${R.sharedRecordRowCount})`);
  ok(R.sortGroupChangedOrder, 'changing the ctx\'s own sort/group state changes the rendered row order');
  ok(R.collapsedHidesRows, 'collapsing a section hides its rows');
  ok(R.expandShowsRowsAgain, 'expanding it again shows the rows');
  ok(!!R.saveCalledWith && R.saveCalledWith[0] === 'r1' && R.saveCalledWith[1] === 'foo' && R.saveCalledWith[2] === 'EDITED',
    `inline edit calls ctx.save with the right args (got ${JSON.stringify(R.saveCalledWith)})`);
  ok(R.bothInstancesUpdated, 'editing the shared record updates both of its rendered rows');
  ok(R.rejectedCommitRethrows, 'a rejected save propagates so a caller can react to it');
  ok(R.rejectedSaveDidNotMutate, 'a rejected save never mutates the ctx\'s own data');
  ok(R.rollbackShowsOldValue, 'the cell rolls back to the previous value after a rejected save');
  ok(R.toastShownOnRejection, 'a rejected save shows a toast');
  ok(R.resizePersistsUnderCtxKey, 'column resize persists under the fake ctx\'s own key');
  ok(R.resizeNeverLeaksIntoWb, 'resizing the fake ctx\'s column never touches the Workboards (\'wb\') bucket');
  ok(!!R.bulkReceivedIds && R.bulkReceivedIds.length === 2 && R.bulkReceivedIds[0] === 'r2' && R.bulkReceivedIds[1] === 'r3',
    `bulk action run() receives the ids it was given (got ${JSON.stringify(R.bulkReceivedIds)})`);
  ok(R.fakeSelectionRecorded, 'selecting a row in the fake ctx is recorded under its own state bucket');
  ok(R.wsSelectedUntouched, 'selecting in the fake ctx leaves the Workboards wsSelected untouched');
  ok(!R.dbTasksAccessed, 'the fake (non-task) ctx never touches DB.tasks');

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  console.log('ERRORS:', errs.length ? errs.slice(0, 6) : 'none');
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.message); process.exit(1); });
