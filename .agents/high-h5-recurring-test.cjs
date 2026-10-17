// H5 (audit 2026-10-17): recurring tasks were created twice, and with a duplicate reference number. Every open session
// made the occurrence that was due when it started and at midnight, advancing "next due" without stamping the source,
// so no other session saw it; each copy also kept the source's reference number. Two sessions are simulated here by two
// copies of the same company record, each running the real check, then merged the way the sync merges them.
// Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3209);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3209/');
    await p.evaluate(() => {
      const T = '2026-09-01T09:00:00.000Z', B = DB.workboards[0].id;
      DB.groups.push({ id: 'gR', name: 'Recurring', workboardId: B, boardId: B, order: 99, createdAt: T, updatedAt: T });
      const due = toDateStr(new Date(Date.now() - 86400000));   // yesterday: due now
      window.__due = due;
      DB.tasks.push({ id: 'srcR', name: 'Weekly report', groupId: 'gR', boardId: B, workboardId: B, status: 'done', priority: 'high', refNumber: 99, ownerId: 'u2', startDate: due, endDate: due, createdAt: T, updatedAt: T,
        recurrence: { freq: 'weekly', interval: 1, nextDue: due, copySameAssignee: true, copySameBoard: true, copySamePriority: true, copySameDescription: true, occurrenceCount: 0 } });
      // run the real check against a given copy of the record, as that session would
      window.__run = (copy) => {
        const keep = JSON.parse(JSON.stringify(DB));
        for (const k in DB) delete DB[k]; Object.assign(DB, JSON.parse(JSON.stringify(copy)));
        _checkRecurringTasks();
        const out = JSON.parse(JSON.stringify(DB));
        for (const k in DB) delete DB[k]; Object.assign(DB, keep);
        return out;
      };
    });
    const due = await p.evaluate(() => window.__due);
    // Two sessions start from the same record and each runs the check.
    const r = await p.evaluate(() => {
      const start = JSON.parse(JSON.stringify(DB));
      const a = window.__run(start), bb = window.__run(start);
      const mine = d => d.tasks.filter(t => t.recurSourceId === 'srcR');
      const merged = _mergeDB(a, bb);
      const occ = merged.tasks.filter(t => t.recurSourceId === 'srcR');
      _assignTaskRefs(merged);
      const board = merged.tasks.filter(t => t.boardId === DB.workboards[0].id).map(t => t.refNumber).filter(Boolean);
      const src = merged.tasks.find(t => t.id === 'srcR');
      const srcA = a.tasks.find(t => t.id === 'srcR');
      return {
        aMade: mine(a).length, bMade: mine(bb).length, sameId: mine(a)[0].id === mine(bb)[0].id, id: mine(a)[0].id,
        merged: occ.length, occ: occ[0] || null, refsUnique: new Set(board).size === board.length,
        srcStamped: srcA.updatedAt > '2026-09-02', srcNext: src.recurrence.nextDue, srcCount: src.recurrence.occurrenceCount,
      };
    });
    ok(r.aMade === 1 && r.bMade === 1, 'each session makes the occurrence that is due (' + r.aMade + ' and ' + r.bMade + ')');
    ok(r.sameId && r.id === 't_rec_srcR_' + due, 'and both make the same task, named by its source and due date (' + r.id + ')');
    ok(r.merged === 1, 'after the sessions merge there is ONE occurrence, not two (' + r.merged + ')');
    ok(r.occ && r.occ.startDate === due && r.occ.status === 'todo' && r.occ.recur === undefined && !r.occ.recurrence && r.occ.name === 'Weekly report', 'it is a fresh to-do for the due date with the source\'s name and no schedule of its own');
    ok(r.occ && r.occ.refNumber !== 99 && r.refsUnique, 'it has its own reference number, not the source\'s 99, and no two tasks on the board share one (' + (r.occ && r.occ.refNumber) + ')');
    ok(r.srcStamped, 'the source task is stamped when "next due" moves on, so other sessions see it');
    ok(r.srcNext > due && r.srcCount === 1, 'next due moved forward once and the occurrence count is 1 (' + r.srcNext + ', ' + r.srcCount + ')');
    // Running the check again changes nothing.
    const again = await p.evaluate(() => {
      const a = window.__run(JSON.parse(JSON.stringify(DB)));
      const first = window.__run(JSON.parse(JSON.stringify(DB)));
      return { before: DB.tasks.length, after: first.tasks.length, none: first.tasks.filter(t => t.recurSourceId === 'srcR').length };
    });
    ok(again.after === again.before + 1 && again.none === 1, 'the check made exactly one occurrence from the starting record (' + again.none + ')');
    // A stale source (another session\'s move of "next due" has not arrived): the occurrence is not made twice,
    // but next due still moves on.
    const stale = await p.evaluate(() => {
      const start = JSON.parse(JSON.stringify(DB));
      const once = window.__run(start);                          // the occurrence exists now
      const staleSrc = once.tasks.find(t => t.id === 'srcR'); staleSrc.recurrence.nextDue = window.__due; staleSrc.recurrence.occurrenceCount = 0;
      const twice = window.__run(once);
      return { n: twice.tasks.filter(t => t.recurSourceId === 'srcR').length, next: twice.tasks.find(t => t.id === 'srcR').recurrence.nextDue, due: window.__due };
    });
    ok(stale.n === 1 && stale.next > stale.due, 'with a stale "next due" the occurrence is not made a second time, and next due moves on (' + JSON.stringify(stale) + ')');
    // Someone deleted the occurrence: it is not made again.
    const deleted = await p.evaluate(() => {
      const start = JSON.parse(JSON.stringify(DB));
      const once = window.__run(start);
      const id = once.tasks.find(t => t.recurSourceId === 'srcR').id;
      once.tasks = once.tasks.filter(t => t.id !== id); once.deletedTaskIds = [...(once.deletedTaskIds || []), id];
      once.tasks.find(t => t.id === 'srcR').recurrence.nextDue = window.__due;
      const after = window.__run(once);
      return { remade: after.tasks.some(t => t.id === id) };
    });
    ok(deleted.remade === false, 'an occurrence someone deleted is not made again');
    // The end conditions and lead days still work.
    const ends = await p.evaluate(() => {
      const start = JSON.parse(JSON.stringify(DB));
      const src = start.tasks.find(t => t.id === 'srcR'); src.recurrence.endType = 'count'; src.recurrence.occurrences = 1; src.recurrence.occurrenceCount = 1;
      const a = window.__run(start);
      const start2 = JSON.parse(JSON.stringify(DB));
      const s2 = start2.tasks.find(t => t.id === 'srcR'); s2.recurrence.nextDue = toDateStr(new Date(Date.now() + 10 * 86400000)); s2.recurrence.leadDays = 3;
      const b2 = window.__run(start2);
      const s3 = JSON.parse(JSON.stringify(DB)); const x3 = s3.tasks.find(t => t.id === 'srcR'); x3.recurrence.nextDue = toDateStr(new Date(Date.now() + 10 * 86400000)); x3.recurrence.leadDays = 12;
      const c3 = window.__run(s3);
      return { countStop: a.tasks.filter(t => t.recurSourceId === 'srcR').length, tooEarly: b2.tasks.filter(t => t.recurSourceId === 'srcR').length, withLead: c3.tasks.filter(t => t.recurSourceId === 'srcR').length };
    });
    ok(ends.countStop === 0, 'a task that has reached its number of occurrences makes no more');
    ok(ends.tooEarly === 0 && ends.withLead === 1, 'lead days still decide how early an occurrence is made (' + ends.tooEarly + ' too early, ' + ends.withLead + ' with a 12-day lead)');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h5-recurring-test', pass, fail); }
})();
