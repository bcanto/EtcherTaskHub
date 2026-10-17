// H6 (audit 2026-10-17): Duplicate board doubled the original and left the copy empty. Copied groups and tasks kept
// the original's boardId, which wins over the new workboardId, so every copy appeared on the ORIGINAL board (3 groups
// and 15 tasks became 6 and 30) and the new board showed nothing. Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3208);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3208/');
    // The board: 3 groups and 15 tasks (12 top-level, 3 sub-items), written the way real boards are: most name their
    // board in BOTH boardId and workboardId, some in one, sub-items in neither. One task recurs, one is archived.
    // A second board with its own group and tasks must not be copied.
    await p.evaluate(() => {
      const T = '2026-10-01T09:00:00.000Z', B = 'bH6', O = 'bOther';
      DB.workboards.push({ id: B, name: 'H6 board', color: '#0d1c33', visibility: 'all_internal', ownerId: currentUser.id, archived: false, refPrefix: 'HX', nextRef: 16, createdAt: T, updatedAt: T });
      DB.workboards.push({ id: O, name: 'Other board', color: '#0d1c33', visibility: 'all_internal', ownerId: currentUser.id, archived: false, createdAt: T, updatedAt: T });
      DB.boards = DB.workboards;
      DB.groups.push({ id: 'gA', name: 'Group A', workboardId: B, boardId: B, order: 0, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gB', name: 'Group B', workboardId: B, boardId: B, order: 1, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gC', name: 'Group C', workboardId: B, order: 2, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gO', name: 'Other group', workboardId: O, boardId: O, order: 0, createdAt: T, updatedAt: T });
      const mk = (i, extra) => DB.tasks.push({ id: 'h6t' + i, name: 'H6 Task ' + i, groupId: ['gA', 'gB', 'gC'][i % 3], status: 'todo', priority: 'med', refNumber: i, createdAt: T, updatedAt: T, ...extra });
      for (let i = 1; i <= 12; i++) mk(i, i % 4 === 1 ? { boardId: B, workboardId: B } : i % 4 === 2 ? { workboardId: B } : i % 4 === 3 ? { boardId: B } : { boardId: B, workboardId: B });
      DB.tasks.find(t => t.id === 'h6t5').recurrence = { freq: 'weekly', nextDue: '2099-01-01' };
      DB.tasks.find(t => t.id === 'h6t6').archived = true;
      ['h6t1', 'h6t2', 'h6t3'].forEach((parent, k) => DB.tasks.push({ id: 'h6s' + (k + 1), name: 'H6 Sub ' + (k + 1), parentTaskId: parent, groupId: DB.tasks.find(t => t.id === parent).groupId, status: 'todo', priority: 'med', refNumber: 13 + k, createdAt: T, updatedAt: T }));
      DB.tasks.push({ id: 'otherT', name: 'Other board task', groupId: 'gO', boardId: O, workboardId: O, status: 'todo', priority: 'med', refNumber: 1, createdAt: T, updatedAt: T });
      window.__on = id => ({ groups: DB.groups.filter(g => (g.boardId || g.workboardId) === id).length, tasks: DB.tasks.filter(t => _taskBoardId(t) === id).length });
    });
    const on = id => p.evaluate(id => window.__on(id), id);
    let o = await on('bH6');
    ok(o.groups === 3 && o.tasks === 15, 'the starting board has 3 groups and 15 tasks (' + JSON.stringify(o) + ')');
    const totalBefore = await p.evaluate(() => ({ groups: DB.groups.length, tasks: DB.tasks.length, boards: DB.workboards.length }));
    await p.evaluate(() => duplicateWorkboard('bH6'));
    const newId = await p.evaluate(() => (DB.workboards.find(w => w.name === 'H6 board (copy)') || {}).id);
    ok(!!newId, 'the copy exists, named "H6 board (copy)"');
    o = await on('bH6');
    ok(o.groups === 3 && o.tasks === 15, 'the original is NOT doubled: still 3 groups and 15 tasks (' + JSON.stringify(o) + ')');
    const c = await on(newId);
    ok(c.groups === 3 && c.tasks === 15, 'the copy has the 3 groups and 15 tasks (' + JSON.stringify(c) + ')');
    const totalAfter = await p.evaluate(() => ({ groups: DB.groups.length, tasks: DB.tasks.length, boards: DB.workboards.length }));
    ok(totalAfter.boards === totalBefore.boards + 1 && totalAfter.groups === totalBefore.groups + 3 && totalAfter.tasks === totalBefore.tasks + 15, 'exactly 3 groups and 15 tasks were added, and the other board\'s group and task were not copied (' + JSON.stringify(totalAfter) + ')');
    const shape = await p.evaluate(newId => {
      const copyTasks = DB.tasks.filter(t => _taskBoardId(t) === newId), copyGroups = DB.groups.filter(g => (g.boardId || g.workboardId) === newId);
      const gIds = new Set(copyGroups.map(g => g.id)), tIds = new Set(copyTasks.map(t => t.id));
      const origIds = new Set(DB.tasks.filter(t => _taskBoardId(t) === 'bH6').map(t => t.id));
      const named = copyTasks.filter(t => t.boardId || t.workboardId);
      return {
        newIds: copyTasks.every(t => !origIds.has(t.id)) && copyGroups.every(g => !['gA', 'gB', 'gC'].includes(g.id)),
        bothIds: named.length > 0 && named.every(t => t.boardId === newId && t.workboardId === newId),
        groupsBoth: copyGroups.every(g => g.workboardId === newId && (g.boardId === undefined || g.boardId === newId)),
        groupsInside: copyTasks.every(t => gIds.has(t.groupId)),
        parentsInside: copyTasks.filter(t => t.parentTaskId).length === 3 && copyTasks.filter(t => t.parentTaskId).every(t => tIds.has(t.parentTaskId)),
        subsKeepNoBoard: copyTasks.filter(t => t.parentTaskId).every(t => !t.boardId && !t.workboardId),
        noRefs: copyTasks.every(t => t.refNumber === undefined),
        notRecurring: copyTasks.every(t => !t.recurrence),
        stamped: copyTasks.every(t => t.updatedAt > '2026-10-02') && copyGroups.every(g => g.updatedAt > '2026-10-02'),
        orig5: DB.tasks.find(t => t.id === 'h6t5').recurrence && DB.tasks.find(t => t.id === 'h6t5').recurrence.freq === 'weekly',
        origRefs: DB.tasks.filter(t => _taskBoardId(t) === 'bH6').every(t => t.refNumber >= 1),
        names: copyTasks.map(t => t.name).sort().join('|') === DB.tasks.filter(t => _taskBoardId(t) === 'bH6').map(t => t.name).sort().join('|'),
      };
    }, newId);
    ok(shape.newIds, 'every copied group and task has a new id');
    ok(shape.bothIds && shape.groupsBoth, 'a copy that names a board names the new board in both boardId and workboardId');
    ok(shape.subsKeepNoBoard && shape.parentsInside, 'the three sub-items are copied under their copied parents and, as in the original, name no board of their own');
    ok(shape.groupsInside, 'every copied task sits in a copied group');
    ok(shape.names, 'the copy has the same task names as the original');
    ok(shape.noRefs && shape.stamped, 'copies carry no reference number and are stamped as new (so they reach the other computers)');
    ok(shape.notRecurring && shape.orig5, 'a recurring task is not copied as recurring, and the original keeps its schedule');
    const board = await p.evaluate(newId => { const w = DB.workboards.find(x => x.id === newId); return { refPrefix: w.refPrefix, nextRef: w.nextRef, archived: w.archived, orig: DB.workboards.find(x => x.id === 'bH6').refPrefix + '/' + DB.workboards.find(x => x.id === 'bH6').nextRef }; }, newId);
    ok(board.refPrefix === undefined && board.nextRef === undefined && board.orig === 'HX/16', 'the copy has its own reference prefix and counter; the original keeps HX / 16 (' + JSON.stringify(board) + ')');
    // The copy is numbered afresh in its own board.
    const refs = await p.evaluate(newId => { _assignTaskRefs(DB); const nums = DB.tasks.filter(t => _taskBoardId(t) === newId).map(t => t.refNumber).sort((a, b) => a - b); return { nums, orig: DB.tasks.filter(t => _taskBoardId(t) === 'bH6').map(t => t.refNumber).sort((a, b) => a - b) }; }, newId);
    ok(refs.nums.length === 15 && refs.nums.join() === Array.from({ length: 15 }, (_, i) => i + 1).join() && refs.orig.join() === Array.from({ length: 15 }, (_, i) => i + 1).join(), 'the copy\'s tasks are numbered 1 to 15 in their own board and the original keeps 1 to 15 (' + refs.nums.join(',') + ')');
    // What the person sees: each board shows its own rows.
    const rows = await p.evaluate(async newId => {
      const rowsOf = async id => { currentWorkboard = null; openWorkboard(id); renderView('workspace'); await new Promise(r => setTimeout(r, 400)); return [...document.querySelectorAll('tr.ws-row[data-tid]')].map(r => r.dataset.tid); };
      const orig = await rowsOf('bH6'), copy = await rowsOf(newId);
      const own = id => new Set(DB.tasks.filter(t => _taskBoardId(t) === id).map(t => t.id));
      return { orig: orig.length, copy: copy.length, origOwn: orig.every(t => own('bH6').has(t)), copyOwn: copy.every(t => own(newId).has(t)) };
    }, newId);
    ok(rows.orig >= 11 && rows.copy >= 11 && rows.origOwn && rows.copyOwn, 'on screen the original and the copy each show only their own task rows (' + JSON.stringify(rows) + ')');
    // Duplicating again gives another independent copy and still leaves the original alone.
    await p.evaluate(() => duplicateWorkboard('bH6'));
    o = await on('bH6');
    ok(o.groups === 3 && o.tasks === 15, 'duplicating twice still leaves the original at 3 groups and 15 tasks');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h6-duplicate-board-test', pass, fail); }
})();
