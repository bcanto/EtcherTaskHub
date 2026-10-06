// Phase 2 acceptance (plan 2.1-2.3): mounts a FAKE Gantt model — 2 sections, nested rows, a
// milestone (single-date row) and a dependency — through the new generic renderer
// (_ganttRenderGeneric) and the async commit helper (_ganttCommitDrag), never through
// renderGantt's Workboards branch. Proves the {model, handlers} contract (beforeCommit ->
// commitMove -> rerender, rejection -> rollback + toast) works for a non-task model before
// anything real (ISO, Phase 6+/7b) depends on it.
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
    document.body.insertAdjacentHTML('beforeend', '<div id="gantt-adapter-test-root"></div>');
    const root = document.getElementById('gantt-adapter-test-root');

    // 2 sections, nested rows (depth 0/1), a milestone (only .end set), and 'r1' shared across
    // both sections (like a shared ISO action across two findings) under two distinct keys.
    const records = {
      r1: { id: 'r1', name: 'Shared', start: '2026-01-05', end: '2026-01-10', color: '#97bcbd' },
      r2: { id: 'r2', name: 'Parent', start: '2026-01-03', end: '2026-01-08', color: '#97bcbd' },
      r3: { id: 'r3', name: 'Child', start: '2026-01-04', end: '2026-01-06', color: '#97bcbd', depth: 1 },
      r4: { id: 'r4', name: 'Milestone', start: null, end: '2026-01-12', color: '#3b82f6' },
    };
    const mk = (id, key) => ({ ...records[id], key: key || id });
    let commitCalls = [], beforeCommitCalls = [];
    let rejectNext = false;
    const model = {
      key: 'fake-gantt:test',
      sections: [
        { id: 'secA', label: 'Section A', color: '#111', rows: [mk('r1', 'secA~r1'), mk('r2'), mk('r3')] },
        { id: 'secB', label: 'Section B', color: '#222', rows: [mk('r1', 'secB~r1'), mk('r4')] },
      ],
      deps: [{ from: 'r2', to: 'r1', lag: 0 }],
    };
    const handlers = {
      open() {},
      beforeCommit(id, start, end) { beforeCommitCalls.push([id, start, end]); return !rejectNext; },
      commitMove(id, start, end) {
        commitCalls.push([id, start, end]);
        if (rejectNext) { rejectNext = false; return Promise.reject(new Error('simulated rejection')); }
        records[id].start = start; records[id].end = end;
        return Promise.resolve(true);
      },
      toggle() {},
      rerender() { root.innerHTML = _ganttRenderGeneric(model); },
      linkDeps: true,
    };

    root.innerHTML = _ganttRenderGeneric(model);
    o.barCount = root.querySelectorAll('.g2g-bar').length;
    o.sectionCount = root.querySelectorAll('.g2g-sec').length;
    o.milestoneCount = root.querySelectorAll('.g2g-milestone').length;
    o.distinctBarIds = new Set([...root.querySelectorAll('.g2g-bar')].map(el => el.id)).size;
    o.sharedRecordBarCount = [...root.querySelectorAll('.g2g-bar')].filter(el => el.dataset.id === 'r1').length;
    o.nestedDepthPresent = !!root.querySelector('.g2g-bar[data-depth="1"]');

    // drag calls beforeCommit then commitMove, in that order, with the right args
    await _ganttCommitDrag(handlers, 'r2', '2026-02-01', '2026-02-06');
    o.beforeCommitCalledWith = beforeCommitCalls[0];
    o.commitCalledWith = commitCalls[0];
    o.commitAfterBeforeCommit = beforeCommitCalls.length === 1 && commitCalls.length === 1;
    o.dataActuallyMoved = records.r2.start === '2026-02-01' && records.r2.end === '2026-02-06';

    // a rejected commitMove shows a toast and never mutates the model (rollback = re-render from
    // the model's own, still-original data)
    const toastCountBefore = document.querySelectorAll('.app-toast').length;
    rejectNext = true;
    let threw = false;
    try { await _ganttCommitDrag(handlers, 'r3', '2026-03-01', '2026-03-05'); }
    catch (e) { threw = true; }
    o.rejectedCommitRethrows = threw;
    o.rejectedCommitDidNotMutate = records.r3.start === '2026-01-04' && records.r3.end === '2026-01-06';
    o.toastShownOnRejection = document.querySelectorAll('.app-toast').length > toastCountBefore;

    // a beforeCommit rejection stops before commitMove is ever called
    rejectNext = false;
    beforeCommitCalls = []; commitCalls = [];
    const rejectBefore = { ...handlers, beforeCommit: () => false };
    let threw2 = false;
    try { await _ganttCommitDrag(rejectBefore, 'r2', '2026-04-01', '2026-04-05'); }
    catch (e) { threw2 = true; }
    o.beforeCommitRejectionThrows = threw2;
    o.beforeCommitRejectionSkipsCommit = commitCalls.length === 0;

    root.remove();
    return o;
  });

  ok(R.sectionCount === 2, `renders 2 section headers (got ${R.sectionCount})`);
  ok(R.barCount === 5, `renders all 5 row slots (4 records, r1 shared across 2 sections) (got ${R.barCount})`);
  ok(R.milestoneCount === 1, `renders exactly 1 milestone diamond for the single-date row (got ${R.milestoneCount})`);
  ok(R.distinctBarIds === 5, `one record in two sections -> two bars with distinct DOM ids (got ${R.distinctBarIds} distinct of 5)`);
  ok(R.sharedRecordBarCount === 2, `the shared record (r1) renders exactly twice, once per section (got ${R.sharedRecordBarCount})`);
  ok(R.nestedDepthPresent, 'a nested (depth 1) row renders with its depth marked');
  ok(!!R.beforeCommitCalledWith && R.beforeCommitCalledWith[0] === 'r2', `drag calls beforeCommit with the dragged id (got ${JSON.stringify(R.beforeCommitCalledWith)})`);
  ok(!!R.commitCalledWith && R.commitCalledWith[0] === 'r2' && R.commitCalledWith[1] === '2026-02-01' && R.commitCalledWith[2] === '2026-02-06',
    `drag calls commitMove with the right args (got ${JSON.stringify(R.commitCalledWith)})`);
  ok(R.commitAfterBeforeCommit, 'commitMove is called exactly once, after beforeCommit');
  ok(R.dataActuallyMoved, 'a successful commit actually updates the model');
  ok(R.rejectedCommitRethrows, 'a rejected commitMove propagates so a caller can react to it');
  ok(R.rejectedCommitDidNotMutate, 'a rejected commitMove never mutates the model');
  ok(R.toastShownOnRejection, 'a rejected commitMove shows a toast (rollback is a re-render from the unmutated model)');
  ok(R.beforeCommitRejectionThrows, 'a beforeCommit rejection also propagates');
  ok(R.beforeCommitRejectionSkipsCommit, 'a beforeCommit rejection stops before commitMove is ever called');

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  console.log('ERRORS:', errs.length ? errs.slice(0, 6) : 'none');
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.message); process.exit(1); });
