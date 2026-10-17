// H6 (audit 2026-10-17), retained-services half: a duplicated board must not carry the original's retained-services
// arrangement. Its services point at the original board's groups and its months hold the original's history, so a copy that
// kept it would look retained, report the original's usage, and point at groups that are not its own.
// Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3216);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3216/');
    const r = await p.evaluate(() => {
      const T = '2026-09-01T09:00:00.000Z';
      DB.workboards.push({ id: 'bRet', name: 'Retained client', color: '#0d1c33', visibility: 'all_internal', ownerId: currentUser.id, archived: false, createdAt: T, updatedAt: T,
        retainer: { leadId: currentUser.id, startedAt: T, services: [{ key: 'core', groupId: 'gRet1', unit: 'hours', allowance: 10, core: true, ownerId: currentUser.id }], months: { '2026-09': { used: 4 } } } });
      DB.boards = DB.workboards;
      DB.groups.push({ id: 'gRet1', name: 'Core', workboardId: 'bRet', boardId: 'bRet', order: 0, createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tRet1', name: 'Retained task', groupId: 'gRet1', boardId: 'bRet', workboardId: 'bRet', status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      const before = _isRetainedBoard(DB.workboards.find(w => w.id === 'bRet'));
      duplicateWorkboard('bRet');
      const copy = DB.workboards.find(w => w.name === 'Retained client (copy)'), orig = DB.workboards.find(w => w.id === 'bRet');
      return { before, copyHas: copy && 'retainer' in copy, copyRetained: _isRetainedBoard(copy), origKeeps: _isRetainedBoard(orig) && orig.retainer.services[0].groupId === 'gRet1' && orig.retainer.months['2026-09'].used === 4,
        copyTasks: DB.tasks.filter(t => _taskBoardId(t) === copy.id).length, origTasks: DB.tasks.filter(t => _taskBoardId(t) === 'bRet').length };
    });
    ok(r.before === true, 'the starting board is a retained-services board');
    ok(r.copyHas === false && r.copyRetained === false, 'its copy is an ordinary board: no retained-services arrangement (' + JSON.stringify({ has: r.copyHas, retained: r.copyRetained }) + ')');
    ok(r.origKeeps === true, 'the original keeps its arrangement, its group and its usage so far');
    ok(r.copyTasks === 1 && r.origTasks === 1, 'and the copy has its own task while the original keeps one (' + r.copyTasks + ' and ' + r.origTasks + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h6-retainer-test', pass, fail); }
})();
