// Portal filters on Tasks, Board and Schedule (the client portal concept, approved 2026-10-15): one bar with
// Engagement, Status, Due and With, a count, and Clear. Runs as the seed client General Cranes (c1) on its own
// offline server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('portal-filters-test', 3180, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  await ev(() => { currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; launchClientView(); cpNavigate('tasks'); });
  await t.sleep(800);
  const base = await ev(() => ({ bar: !!document.querySelector('#cp-body .cp-fbar'), rows: document.querySelectorAll('#cp-body .cp-task-list-row').length, top: getClientTasks('c1').filter(x => !x.parentId).length, n: document.querySelector('.cp-fn').textContent }));
  t.ok(base.bar, 'the Tasks tab has a filter bar');
  t.ok(base.rows === base.top && new RegExp('^' + base.top + ' items').test(base.n), `unfiltered, every task shows and the bar counts them (${base.rows} rows, ${base.top} tasks)`);

  // Status: Done.
  await ev(() => cpSetFilter('tasks', 'st', 'done')); await t.sleep(300);
  const done = await ev(() => ({ rows: [...document.querySelectorAll('#cp-body .cp-task-list-row')].map(r => r.dataset.taskTitle), want: getClientTasks('c1').filter(x => !x.parentId && _cpStatusKey(x) === 'done').map(x => x.title), n: document.querySelector('.cp-fn').textContent }));
  t.ok(done.rows.length === done.want.length && done.rows.every(r => done.want.includes(r)), `Status Done shows only finished tasks (${done.rows.length})`);
  t.ok(new RegExp(`^${done.want.length} of ${base.top} shown`).test(done.n) && /Clear filters/.test(done.n), 'the bar says how many are shown and offers Clear');
  // Waiting on you + With: You agree.
  await ev(() => { cpClearFilters('tasks'); cpSetFilter('tasks', 'who', 'You'); }); await t.sleep(300);
  const you = await ev(() => ({ rows: document.querySelectorAll('#cp-body .cp-task-list-row').length, want: getClientTasks('c1').filter(x => !x.parentId && x.awaitingClient && !_CP_DONE.includes(x.status)).length }));
  t.ok(you.rows === you.want && you.want > 0, `With: You shows exactly the tasks waiting on the client (${you.rows})`);
  // Due: Overdue.
  await ev(() => { cpClearFilters('tasks'); cpSetFilter('tasks', 'due', 'over'); }); await t.sleep(300);
  const over = await ev(() => { const today = toDateStr(new Date()); return { rows: document.querySelectorAll('#cp-body .cp-task-list-row').length, want: getClientTasks('c1').filter(x => !x.parentId && x.endDate && x.endDate < today && !_CP_DONE.includes(x.status)).length }; });
  t.eq(over.rows, over.want, 'Due: Overdue shows only overdue open tasks');
  // Engagement.
  const eng = await ev(() => { const b = _cpClientBoards('c1')[0]; cpClearFilters('tasks'); cpSetFilter('tasks', 'eng', b.id); return { rows: document.querySelectorAll('#cp-body .cp-task-list-row').length, want: getClientTasks('c1').filter(x => !x.parentId && x.boardId === b.id).length }; });
  t.eq(eng.rows, eng.want, 'Engagement shows only that board\'s tasks');
  // Subtasks stay with their parent.
  const subs = await ev(() => { cpClearFilters('tasks'); const all = getClientTasks('c1'); const p = all.find(x => !x.parentId && all.some(y => y.parentId === x.id)); if (!p) return null; cpSetFilter('tasks', 'st', _cpStatusKey(p)); return _cpFilterTasks('tasks', all).filter(x => x.parentId === p.id).length === all.filter(x => x.parentId === p.id).length; });
  t.ok(subs !== false, 'a matching task keeps all its subtasks');
  // Clear, and the title search still works on top.
  await ev(() => cpClearFilters('tasks')); await t.sleep(300);
  t.eq(await ev(() => document.querySelectorAll('#cp-body .cp-task-list-row').length), base.rows, 'Clear filters brings every task back');
  // Each tab keeps its own filters; Board and Schedule have the bar too.
  await ev(() => { cpSetFilter('tasks', 'st', 'done'); cpNavigate('workboard'); }); await t.sleep(400);
  t.ok(await ev(() => !!document.querySelector('#cp-body .cp-fbar') && !Object.values(_cpFilters.workboard).some(Boolean)), 'the Board tab has its own filter bar, unaffected by the Tasks filters');
  t.ok(await ev(() => !document.querySelector('#cp-body [data-cp-f="who"]')), 'the Board tab has no With filter: it shows no staff names');
  await ev(() => cpNavigate('schedule')); await t.sleep(600);
  t.ok(await ev(() => !!document.querySelector('#cp-body .cp-fbar')), 'the Schedule tab has the filter bar');
  await ev(() => cpNavigate('tasks')); await t.sleep(300);
  t.ok(await ev(() => document.querySelector('[data-cp-f="st"]').value === 'done'), 'coming back to Tasks keeps its filter');
  await ev(() => cpClearFilters('tasks'));
  const shot = await ui.shot('portal-filters');
  t.eq(shot.phone, 0, 'the filter bar fits a phone');
});
