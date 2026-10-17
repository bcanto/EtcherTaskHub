// H2 (audit 2026-10-17): some edits were undone by a colleague's next save. The merge keeps the local copy when neither
// side carries a last-updated time, and a revoked share link, a scoped work request and an edited calendar event stamped
// none; a person's board access, a client comment and a calendar event, once deleted, came back from another computer.
// Each case does the real action, then merges with the state a colleague still holds, in BOTH directions: the colleague
// receives my save, and I receive their older save. Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3210);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3210/');
    await p.evaluate(() => {
      const T = '2026-09-01T09:00:00.000Z', B = 'bH2';
      DB.workboards.push({ id: B, name: 'H2 board', color: '#0d1c33', visibility: 'all_internal', ownerId: currentUser.id, archived: false, createdAt: T, updatedAt: T }); DB.boards = DB.workboards;
      DB.groups.push({ id: 'gH2', name: 'Main', workboardId: B, boardId: B, order: 0, createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tH2', name: 'H2 task', groupId: 'gH2', boardId: B, workboardId: B, status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      DB.clients.push({ id: 'cH2', name: 'H2 Client', shortCode: 'HC', color: '#1d6fb8', createdAt: T, updatedAt: T });
      // all of these exist the way old records do: nothing stamped
      DB.shareLinks = [{ id: 'slH2', token: 'tokH2', type: 'board', targetId: B, label: '', createdBy: 'u1', createdAt: T, revoked: false }];
      DB.clientWorkRequests = [{ id: 'wrH2', clientId: 'cH2', title: 'Please build it', description: 'd', priority: 'normal', status: 'pending', submittedAt: T },
                               { id: 'wrH2b', clientId: 'cH2', title: 'Second one', description: 'd', priority: 'normal', status: 'pending', submittedAt: T }];
      DB.scheduleEvents = [{ id: 'seH2', title: 'Old title', type: 'meeting', date: '2026-10-20', startTime: '09:00', endTime: '10:00', attendees: [], ownerId: 'u1', color: '#97bcbd' },
                           { id: 'seH2b', title: 'Delete me', type: 'meeting', date: '2026-10-21', startTime: '09:00', endTime: '10:00', attendees: [], ownerId: 'u1', color: '#97bcbd' }];
      DB.boardShares = [{ id: 'bsH2', boardId: B, userId: 'u2', addedAt: T, addedByUserId: 'u1' }];
      DB.clientComments = [{ id: 'ccH2', taskId: 'tH2', authorId: currentUser.id, authorName: 'x', body: 'a comment', createdAt: T }];
      // Take the colleague's state, run the action, then merge both ways.
      window.__both = (action) => {
        const old = JSON.parse(JSON.stringify(DB));
        action();
        const mine = JSON.parse(JSON.stringify(DB));
        return { colleagueReceivesMine: _mergeDB(old, mine), iReceiveTheirOlder: _mergeDB(mine, old) };
      };
    });
    const both = (code, ...args) => p.evaluate((code, args) => { const m = window.__both(() => new Function('args', code)(args)); return { c: pick(m.colleagueReceivesMine), i: pick(m.iReceiveTheirOlder) }; function pick(d) {
      return { link: (d.shareLinks.find(l => l.id === 'slH2') || {}).revoked, req: (d.clientWorkRequests.find(r => r.id === 'wrH2') || {}).status, reqB: (d.clientWorkRequests.find(r => r.id === 'wrH2b') || {}).status,
        reqLinked: (d.clientWorkRequests.find(r => r.id === 'wrH2') || {}).linkedItemId || null,
        evTitle: (d.scheduleEvents.find(e => e.id === 'seH2') || {}).title || null, evB: !!d.scheduleEvents.find(e => e.id === 'seH2b'),
        shares: d.boardShares.filter(s => s.userId === 'u2' && s.boardId === 'bH2').map(s => s.id).join(','), comment: !!d.clientComments.find(c => c.id === 'ccH2'),
        tombs: { ev: d.deletedScheduleEventIds || [], bs: d.deletedBoardShareIds || [], cc: d.deletedClientCommentIds || [] } }; } }, code, args);

    // A revoked share link stays revoked.
    let r = await both("revokeShareLink('tokH2');");
    ok(r.c.link === true && r.i.link === true, 'a revoked share link stays revoked after a colleague\'s save, in both directions (' + r.c.link + ' / ' + r.i.link + ')');
    // A scoped work request stays scoped (and is not offered for scoping again).
    r = await p.evaluate(async () => {
      const old = JSON.parse(JSON.stringify(DB));
      wrOpenAddModal('wrH2');
      document.getElementById('wr-modal-name').value = 'Scoped task';
      document.getElementById('wr-modal-board').value = 'bH2';
      wrModalBoardChange('bH2');   // fills the group list for the chosen board, as picking it in the form does
      const g = document.getElementById('wr-modal-group'); if (g) g.value = 'gH2';
      wrDoAddToWorkboard('wrH2');
      const mine = JSON.parse(JSON.stringify(DB));
      const pick = d => { const q = d.clientWorkRequests.find(x => x.id === 'wrH2'); return { status: q.status, linked: q.linkedItemId || null, tasksFromIt: d.tasks.filter(t => t.name === 'Scoped task').length }; };
      return { c: pick(_mergeDB(old, mine)), i: pick(_mergeDB(mine, old)), made: DB.tasks.filter(t => t.name === 'Scoped task').length };
    });
    ok(r.made === 1 && r.c.status === 'scoped' && r.i.status === 'scoped' && !!r.c.linked && !!r.i.linked, 'a scoped work request stays scoped, with its task linked, after a colleague\'s save in both directions (' + JSON.stringify(r) + ')');
    r = await both("wrUpdateStatus('wrH2b','declined',null);");
    ok(r.c.reqB === 'declined' && r.i.reqB === 'declined', 'every other status change on a request (declined, reviewing, a note) is stamped the same way (' + r.c.reqB + ' / ' + r.i.reqB + ')');
    // Calendar events: an edit wins, a delete stays deleted.
    r = await p.evaluate(() => {
      const old = JSON.parse(JSON.stringify(DB));
      openEventModal('seH2', null); document.getElementById('sched-title').value = 'New title'; saveSchedEvent('seH2');
      const mine = JSON.parse(JSON.stringify(DB));
      const t = d => (d.scheduleEvents.find(e => e.id === 'seH2') || {}).title;
      return { c: t(_mergeDB(old, mine)), i: t(_mergeDB(mine, old)), owner: DB.scheduleEvents.find(e => e.id === 'seH2').ownerId };
    });
    ok(r.c === 'New title' && r.i === 'New title', 'an edited calendar event keeps its edit after a colleague\'s save in both directions (' + r.c + ' / ' + r.i + ')');
    r = await p.evaluate(() => {
      const old = JSON.parse(JSON.stringify(DB));
      deleteSchedEvent('seH2b'); document.getElementById('confirm-ok-btn').click();
      const mine = JSON.parse(JSON.stringify(DB));
      const has = d => !!d.scheduleEvents.find(e => e.id === 'seH2b');
      return { c: has(_mergeDB(old, mine)), i: has(_mergeDB(mine, old)), tomb: (DB.deletedScheduleEventIds || []).includes('seH2b'), gone: !DB.scheduleEvents.some(e => e.id === 'seH2b') };
    });
    ok(r.gone && r.tomb && r.c === false && r.i === false, 'a deleted calendar event stays deleted after a colleague\'s save, and is remembered as deleted (' + JSON.stringify(r) + ')');
    // Board access: removing someone stays removed; giving it back later works.
    r = await p.evaluate(() => {
      const old = JSON.parse(JSON.stringify(DB));
      openBoardShareModal('bH2'); removeBoardShare('bH2', 'u2');
      const mine = JSON.parse(JSON.stringify(DB));
      const has = d => d.boardShares.some(s => s.boardId === 'bH2' && s.userId === 'u2');
      return { c: has(_mergeDB(old, mine)), i: has(_mergeDB(mine, old)), tomb: (DB.deletedBoardShareIds || []).includes('bsH2') };
    });
    ok(r.tomb && r.c === false && r.i === false, 'a person\'s removed board access does not come back after a colleague\'s save (' + JSON.stringify(r) + ')');
    r = await p.evaluate(() => {
      openBoardShareModal('bH2'); document.getElementById('bsm-add-user').value = 'u2'; addBoardShare('bH2');
      const mine = JSON.parse(JSON.stringify(DB));
      const staleWithOldTombstoneOnly = JSON.parse(JSON.stringify(DB)); staleWithOldTombstoneOnly.boardShares = [];
      const m = _mergeDB(staleWithOldTombstoneOnly, mine);
      return { mine: DB.boardShares.filter(s => s.userId === 'u2').length, merged: m.boardShares.filter(s => s.userId === 'u2').length, newId: DB.boardShares.find(s => s.userId === 'u2').id !== 'bsH2' };
    });
    ok(r.mine === 1 && r.merged === 1 && r.newId, 'giving the access back later works: the new share has a new id, so the old removal does not block it (' + JSON.stringify(r) + ')');
    // Client comments.
    r = await p.evaluate(() => {
      openTaskPanel('tH2');
      const old = JSON.parse(JSON.stringify(DB));
      deleteClientComment('ccH2', 'tH2');
      const mine = JSON.parse(JSON.stringify(DB));
      const has = d => !!d.clientComments.find(c => c.id === 'ccH2');
      return { c: has(_mergeDB(old, mine)), i: has(_mergeDB(mine, old)), tomb: (DB.deletedClientCommentIds || []).includes('ccH2') };
    });
    ok(r.tomb && r.c === false && r.i === false, 'a deleted client comment does not come back after a colleague\'s save (' + JSON.stringify(r) + ')');
    // Nothing else moved: two unstamped copies still keep the local one, and a newer stamp still wins.
    r = await p.evaluate(() => {
      const a = JSON.parse(JSON.stringify(DB)), c = JSON.parse(JSON.stringify(DB));
      a.clientWorkRequests = [{ id: 'q', clientId: 'cH2', title: 'local', status: 'pending', submittedAt: '2026-01-01' }];
      c.clientWorkRequests = [{ id: 'q', clientId: 'cH2', title: 'remote', status: 'pending', submittedAt: '2026-01-01' }];
      const tie = _mergeDB(a, c).clientWorkRequests.find(x => x.id === 'q').title;
      c.clientWorkRequests[0].updatedAt = '2026-02-01'; c.clientWorkRequests[0].title = 'remote newer';
      const newer = _mergeDB(a, c).clientWorkRequests.find(x => x.id === 'q').title;
      a.clientWorkRequests[0].updatedAt = '2026-03-01';
      const mineNewer = _mergeDB(a, c).clientWorkRequests.find(x => x.id === 'q').title;
      return { tie, newer, mineNewer };
    });
    ok(r.tie === 'local' && r.newer === 'remote newer' && r.mineNewer === 'local', 'merge behaviour is otherwise unchanged: equal copies keep the local one, the newer stamp wins (' + JSON.stringify(r) + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h2-merge-test', pass, fail); }
})();
