// Audit low-priority batch (2026-10-17): L1 rollup 0% vs dash, L2 recurring copy-board/assignees, L3 tap targets,
// L4 dead director role checks, L6 email intake polling (L5 is a documentation-only change, checked separately).
// Runs the real app in a browser on its own server (never :3001).
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3245;

// The real shipped handler, invoked directly (a mock req/res, the same pattern other suites use for api/*.js).
function mockRes() { return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} }; }
function realIntakeHandler() {
  delete require.cache[require.resolve(path.join(H.ROOT, 'api', 'intake', 'pending.js'))];
  return require(path.join(H.ROOT, 'api', 'intake', 'pending.js'));
}

(async () => {
  const handler = realIntakeHandler();
  const r = mockRes();
  handler({ method: 'GET' }, r);
  ok(r.code === 404, 'L6: the real shipped placeholder answers 404 until email intake is really set up (' + r.code + ', body ' + JSON.stringify(r.body) + ')');

  // The browser's own circuit breaker, exercised against a stand-in server shaped like that real answer (local
  // serve.mjs still answers its own real queue in dev; this part is about the browser's polling logic, not the file).
  const srv = await H.serve(PORT, { api: (req, res, url) => {
    if (url.pathname === '/api/intake/pending') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not set up' })); return true; }
    return false;
  } });
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const T = '2026-10-10T09:00:00.000Z';

    // ── L6: the poller stops after its first 404 and never asks again ──
    const l6 = await p.evaluate(async () => {
      window.__intakeCalls = 0;
      const real = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('/api/intake/pending')) window.__intakeCalls++; return real(u, o); };
      _intakeUnavailable = false; _intakePoller = null;
      startIntakePoller();
      await new Promise(r => setTimeout(r, 400));
      const first = window.__intakeCalls, offAfterFirst = _intakeUnavailable, pollerCleared = _intakePoller === null;
      startIntakePoller();   // a second call (e.g. a later sign-in) must not restart it
      await new Promise(r => setTimeout(r, 400));
      window.fetch = real;
      return { calls: window.__intakeCalls, first, offAfterFirst, pollerCleared };
    });
    ok(l6.first === 1 && l6.offAfterFirst && l6.pollerCleared, 'L6: one failed poll switches it off for the rest of the session (' + JSON.stringify(l6) + ')');
    ok(l6.calls === 1, 'L6: it is not asked again, even if something tries to start it a second time (' + l6.calls + ' call(s))');

    // ── L4: a "director" role is not real; the admin-only checks behave exactly like a non-admin ──
    const l4 = await p.evaluate(() => {
      const keep = currentUser;
      currentUser = { ...keep, id: 'xDirector', role: 'director' };
      DB.presenceEntries = DB.presenceEntries || [];
      DB.presenceEntries.push({ userId: 'someoneElse', date: '2026-10-20', type: 'office' });
      const before = DB.presenceEntries.length;
      presenceRemove('someoneElse', '2026-10-20');
      const refused = DB.presenceEntries.length === before;
      currentUser = keep;
      return refused;
    });
    ok(l4, 'L4: a "director" role (not a real role) gets no special access, same as any other non-admin');

    // ── L1: a parent row with sub-items at 0% shows a dash, not "0%" ──
    const l1 = await p.evaluate(T => {
      const wb = DB.workboards[0];
      DB.groups.push({ id: 'gL1', name: 'L1', boardId: wb.id, clientId: null, order: 99, createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tL1parent', name: 'Parent L1', groupId: 'gL1', boardId: wb.id, status: 'todo', priority: 'med', percentComplete: 0, createdAt: T, updatedAt: T });
      for (let i = 0; i < 3; i++) DB.tasks.push({ id: 'tL1kid' + i, name: 'Kid ' + i, parentTaskId: 'tL1parent', groupId: 'gL1', boardId: wb.id, status: 'todo', priority: 'med', percentComplete: 0, createdAt: T, updatedAt: T });
      openWorkboard(wb.id); navigate('workspace');
    }, T);
    await H.sleep(400);
    // The parent's progress cell is marked "Auto-calculated from subitems" — read that cell on its own, not the
    // whole row's text, since the row also carries other numbers (sub-item count, order) that could confuse a regex.
    const progressCellText = () => p.evaluate(() => {
      const r = [...document.querySelectorAll('tr')].find(r => r.innerText.includes('Parent L1'));
      const cell = r && r.querySelector('td[title="Auto-calculated from subitems"]');
      return cell ? cell.innerText.replace(/\s+/g, ' ').trim() : null;
    });
    const c1 = await progressCellText();
    ok(/—/.test(c1 || '') && /0\/3/.test(c1 || ''), 'L1: a parent whose sub-items are all not-started shows a dash, not 0% (' + JSON.stringify(c1) + ')');
    ok(!/\b0%/.test(c1 || ''), 'L1: and definitely not "0%" (' + JSON.stringify(c1) + ')');
    await p.evaluate(() => { DB.tasks.find(t => t.id === 'tL1kid0').status = 'done'; });
    await p.evaluate(() => navigate('workspace'));
    await H.sleep(300);
    const c1b = await progressCellText();
    ok(/33%/.test(c1b || ''), 'L1: once a sub-item is done, the real percentage still shows (' + JSON.stringify(c1b) + ')');

    // ── L2: recurring tasks: "Same board" off clears the board; "Same assignee" off also clears assignees ──
    const l2 = await p.evaluate(T => {
      const wb2 = DB.workboards[1] || DB.workboards[0];
      DB.tasks.push({ id: 'tL2src', name: 'Recurring L2', boardId: DB.workboards[0].id, workboardId: DB.workboards[0].id, groupId: 'gL1', status: 'todo', priority: 'med', ownerId: 'u2', assigneeIds: ['u3', 'u4'], currentlyWithUserId: 'u2', currentlyWith: 'u2',
        recurrence: { freq: 'daily', nextDue: '2020-01-01', leadDays: 0, endType: 'never', copySameAssignee: false, copySameBoard: false, copySamePriority: true, copySameDescription: true }, createdAt: T, updatedAt: T });
      _checkRecurringTasks();
      const made = DB.tasks.find(t => t.recurSourceId === 'tL2src');
      return made ? { boardId: made.boardId, workboardId: made.workboardId, groupId: made.groupId, ownerId: made.ownerId, assigneeIds: made.assigneeIds, currentlyWithUserId: made.currentlyWithUserId } : null;
    }, T);
    ok(!!l2 && l2.boardId === null && l2.workboardId === null && l2.groupId === null, 'L2: "Same board" off means the new occurrence is not put on the source board (' + JSON.stringify(l2) + ')');
    ok(!!l2 && l2.ownerId === null && l2.currentlyWithUserId === null && Array.isArray(l2.assigneeIds) && l2.assigneeIds.length === 0, 'L2: "Same assignee" off clears the owner and every other assignee, not just the owner');
    const l2b = await p.evaluate(T => {
      DB.tasks.push({ id: 'tL2src2', name: 'Recurring L2b', boardId: DB.workboards[0].id, workboardId: DB.workboards[0].id, groupId: 'gL1', status: 'todo', priority: 'med', ownerId: 'u2', assigneeIds: ['u3'],
        recurrence: { freq: 'daily', nextDue: '2020-01-02', leadDays: 0, endType: 'never', copySameAssignee: true, copySameBoard: true, copySamePriority: true, copySameDescription: true }, createdAt: T, updatedAt: T });
      _checkRecurringTasks();
      const made = DB.tasks.find(t => t.recurSourceId === 'tL2src2');
      return made ? { boardId: made.boardId, groupId: made.groupId, ownerId: made.ownerId, assigneeIds: made.assigneeIds } : null;
    }, T);
    const l2bOk = l2b && l2b.boardId === (await p.evaluate(() => DB.workboards[0].id)) && l2b.groupId === 'gL1' && l2b.ownerId === 'u2' && JSON.stringify(l2b.assigneeIds) === JSON.stringify(['u3']);
    ok(l2bOk, 'L2: with both switched on, the new occurrence still keeps the board and the assignees as before (' + JSON.stringify(l2b) + ')');

    // ── L3: tap targets under 32px get a bigger hit area; a colour swatch is left alone ──
    const l3 = await p.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <button id="ttSmallBtn" onclick="void 0" title="Delete" style="width:16px;height:16px;padding:0;border:none">x</button>
        <div id="ttSwatch" onclick="void 0" title="#ff00aa" style="width:14px;height:14px;background:#ff00aa"></div>
        <button id="ttBigBtn" onclick="void 0" title="Already fine" style="width:40px;height:40px">ok</button>
        <table><tbody><tr id="ttRow" onclick="void 0" style="height:14px"><td>cell</td></tr></tbody></table>
        <table><tbody><tr><td style="width:20px;padding:0"><button id="ttCellBtn" onclick="void 0" title="Delete" style="width:16px;height:16px;padding:0;border:none">x</button></td></tr></tbody></table>
        <div style="position:relative;width:200px;height:60px"><button id="ttFloatBtn" onclick="void 0" title="Delete" style="position:absolute;top:0;right:0;width:16px;height:16px;padding:0;border:none">x</button></div>
      `);
      return 'inserted';
    });
    await H.sleep(200);
    const l3sizes = await p.evaluate(() => {
      const r = id => { const el = document.getElementById(id); const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), tt: el.hasAttribute('data-tt') }; };
      return { small: r('ttSmallBtn'), swatch: r('ttSwatch'), big: r('ttBigBtn'), row: r('ttRow'), cellBtn: r('ttCellBtn'), floatBtn: r('ttFloatBtn') };
    });
    ok(l3sizes.floatBtn.w === 16 && l3sizes.floatBtn.h === 16, 'L3: a small button floating over other content (a corner delete cross) is never grown, so it cannot cover what is under it (' + JSON.stringify(l3sizes.floatBtn) + ')');
    // The real case that exposed it: the note box delete cross must not cover the note's own corner.
    const noteCorner = await p.evaluate(async () => {
      navigate('notes'); await new Promise(r => setTimeout(r, 1200));
      const body = document.querySelector('#note-page .note-box-body'); if (!body) return null;
      const bb = body.getBoundingClientRect(), hit = document.elementFromPoint(bb.left + bb.width - 8, bb.top + 8);
      return { onDelete: !!(hit && hit.closest && hit.closest('.note-box-del')) };
    });
    ok(noteCorner && noteCorner.onDelete === false, 'L3: clicking the top-right corner of a note lands on the note, not on its delete button (' + JSON.stringify(noteCorner) + ')');
    ok(l3sizes.small.tt && l3sizes.small.w >= 32 && l3sizes.small.h >= 32, 'L3: a small icon button is grown to at least 32x32 (' + JSON.stringify(l3sizes.small) + ')');
    ok(l3sizes.swatch.w < 32 && l3sizes.swatch.h < 32, 'L3: a colour swatch (its title is the hex code) is left at its real size (' + JSON.stringify(l3sizes.swatch) + ')');
    ok(l3sizes.big.w === 40 && l3sizes.big.h === 40, "L3: a button that was already big enough is not resized (" + JSON.stringify(l3sizes.big) + ')');
    const rowDisplay = await p.evaluate(() => getComputedStyle(document.getElementById('ttRow')).display);
    ok(l3sizes.row.h >= 32 && rowDisplay === 'table-row', 'L3: a table row only gets a taller minimum height, never turned into a flex box (' + JSON.stringify(l3sizes.row) + ', display=' + rowDisplay + ')');
    ok(l3sizes.cellBtn.tt && l3sizes.cellBtn.h >= 32 && l3sizes.cellBtn.w < 32, 'L3: a small button inside a narrow table cell only gets taller, never wider, so it cannot clip past its column (' + JSON.stringify(l3sizes.cellBtn) + ')');

    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('low-test', pass, fail);
})();
