// H9 (audit 2026-10-17): performance at a realistic data size (60 clients, 120 boards, 6,000 tasks, 25,000 time entries,
// 3,000 notifications: about two years for a ten-person team). Reports took 5.6 s to open, Time 1.6 s, Notifications 0.6 s,
// and every keystroke in the search boxes rebuilt a whole list. Now the big lists show a window and say so, the search boxes
// wait for a pause in typing, and a person's old read notifications are cleared. Runs on its own server (no :3001).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3212);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3212/');
    // The record: built once, in memory only.
    await p.evaluate(() => {
      const now = Date.now(), iso = d => new Date(d).toISOString();
      for (let c = 0; c < 60; c++) DB.clients.push({ id: 'cs' + c, name: 'Client ' + c, shortCode: 'C' + c, color: '#3a6ea5', active: true, createdAt: iso(now), updatedAt: iso(now) });
      for (let w = 0; w < 120; w++) {
        DB.workboards.push({ id: 'bs' + w, name: 'Board ' + w, clientId: 'cs' + (w % 60), color: '#97bcbd', visibility: 'all_internal', archived: false, createdAt: iso(now), updatedAt: iso(now) });
        for (let g = 0; g < 4; g++) DB.groups.push({ id: 'gs' + w + '_' + g, boardId: 'bs' + w, workboardId: 'bs' + w, clientId: 'cs' + (w % 60), name: 'Group ' + g, createdAt: iso(now), updatedAt: iso(now) });
      }
      DB.boards = DB.workboards;
      const staff = DB.users.filter(u => u.role !== 'client').map(u => u.id);
      for (let i = 0; i < 6000; i++) { const w = i % 120; DB.tasks.push({ id: 'ts' + i, boardId: 'bs' + w, workboardId: 'bs' + w, groupId: 'gs' + w + '_' + (i % 4), clientId: 'cs' + (w % 60), name: 'Task ' + i, title: 'Task ' + i, status: 'todo', priority: 'med', createdAt: iso(now), updatedAt: iso(now) }); }
      for (let i = 0; i < 25000; i++) DB.timeEntries.push({ id: 'tes' + i, staffId: i % 3 === 0 ? currentUser.id : staff[i % staff.length], taskId: 'ts' + (i % 6000), clientId: 'cs' + (i % 60), date: iso(now - 86400000 * (i % 120)).slice(0, 10), hours: 1 + (i % 7) / 2, note: 'Work ' + i, status: i % 5 ? 'approved' : 'submitted', billable: true, location: 'remote', earningsRateId: 'er1', createdAt: iso(now - i * 1000), updatedAt: iso(now) });
      // entries that name no client themselves: the client comes from their task (the filter must look the task up)
      for (let k = 0; k < 20; k++) DB.timeEntries.push({ id: 'tex' + k, staffId: currentUser.id, taskId: 'ts' + (7 + 60 * k), clientId: '', date: iso(now - 86400000 * k).slice(0, 10), hours: 1, note: 'No client ' + k, status: 'submitted', billable: true, location: 'remote', earningsRateId: 'er1', createdAt: iso(now), updatedAt: iso(now) });
      for (let i = 0; i < 3000; i++) DB.notifications.push({ id: 'ns' + i, recipientId: currentUser.id, taskId: 'ts' + i, type: 'comment', message: 'Note ' + i, read: i % 2 === 0, createdAt: iso(now - i * 60000) });
      window.__time = async (fn) => { const t0 = performance.now(); fn(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); return Math.round(performance.now() - t0); };
      rptTab = 'timesheet'; tsViewMode = 'detailed'; tsStatusTab = 'all'; tsStaffFilter = 'all'; tsClientFilter = 'all'; tsBoardFilter = 'all'; tsDateFrom = ''; tsDateTo = ''; tsSearch = '';
    });

    // ── Reports: the timesheet table ──
    const ms = await p.evaluate(() => window.__time(() => navigate('reports')));
    const rep = await p.evaluate(() => ({ rows: document.querySelectorAll('#rpt-body tbody tr').length, bar: (document.getElementById('ts-window-bar') || {}).innerText || '', foot: document.querySelector('#rpt-body .card > div:last-child') ? document.querySelector('#rpt-body .card > div:last-child').innerText.replace(/\s+/g, ' ') : '', all: _tsFilterEntries().length, hours: _tsFilterEntries().reduce((s, e) => s + e.hours, 0) }));
    ok(ms < 2500, 'Reports opens quickly with 25,000 entries (' + ms + ' ms; it took 5,600 ms before)');
    ok(rep.rows === 150, 'the detailed table draws the latest 150 rows, not all of them (' + rep.rows + ')');
    ok(new RegExp('Showing the latest 150 of ' + rep.all + ' entries').test(rep.bar.replace(/\s+/g, ' ')) && /the totals count them all/.test(rep.bar), 'and says how many it is not showing (' + rep.bar.replace(/\s+/g, ' ').slice(0, 130) + ')');
    ok(rep.foot.indexOf(rep.all + ' entries') >= 0 && rep.foot.indexOf(rep.hours.toFixed(1) + 'h') >= 0, 'the footer still counts every entry and every hour (' + rep.foot + ')');
    // Latest first: the rows shown are the most recent dates.
    const dates = await p.evaluate(() => { const s = _tsSorted(_tsFilterEntries()); const sh = _tsShown(s); return { firstShown: sh[0].date, lastAll: s[s.length - 1].date, firstAll: s[0].date, olderThanAllShown: s.slice(0, s.length - sh.length).every(e => e.date <= sh[0].date) }; });
    ok(dates.lastAll >= dates.firstShown && dates.olderThanAllShown && dates.firstAll < dates.firstShown, 'the rows shown are the latest ones; everything left out is older');
    await p.evaluate(() => { document.querySelector('#ts-window-bar button').click(); });
    ok(await p.evaluate(() => document.querySelectorAll('#rpt-body tbody tr').length) === 300, 'Show 150 more draws 150 more rows');
    // A filter change starts the window again.
    await p.evaluate(() => { tsStatusTab = 'pending'; renderView('reports'); });
    ok(await p.evaluate(() => document.querySelectorAll('#rpt-body tbody tr').length) === 150, 'changing a filter starts the window at 150 again');
    // Select all covers the rows shown and no more.
    const sel = await p.evaluate(() => {
      tsSelectedIds = new Set(); tsToggleAllSelected(true);
      return { n: tsSelectedIds.size, bar: (document.getElementById('ts-bulk-bar') || {}).innerText || '', headerChecked: document.querySelector('#rpt-body thead input[type=checkbox]').checked, pendingAll: _tsFilterEntries().length };
    });
    ok(sel.n === 150 && sel.pendingAll > 150 && /150 selected/.test(sel.bar) && sel.headerChecked, 'Select all selects the 150 rows shown, not all ' + sel.pendingAll + ' matching entries, so a bulk approval cannot include rows nobody saw (' + sel.n + ')');
    await p.evaluate(() => { tsSelectedIds = new Set(); tsToggleAllSelected(false); });
    ok(await p.evaluate(() => tsSelectedIds.size) === 0, 'and unticking clears it');
    // A small result shows everything, with no window bar, as before.
    const small = await p.evaluate(() => { tsStatusTab = 'all'; tsDateFrom = tsDateTo = _tsSorted(_tsFilterEntries())[0].date; renderView('reports'); return { rows: document.querySelectorAll('#rpt-body tbody tr').length, bar: !!document.getElementById('ts-window-bar'), all: _tsFilterEntries().length }; });
    ok(small.rows === small.all && !small.bar, 'a small result shows every row and no window bar (' + small.rows + ' of ' + small.all + ')');
    await p.evaluate(() => { tsDateFrom = tsDateTo = ''; });
    // The filter itself still gives the right answer.
    const filt = await p.evaluate(() => {
      tsClientFilter = 'cs7'; const a = _tsFilterEntries().length; tsClientFilter = 'all';
      const expect = DB.timeEntries.filter(e => (e.staffId === currentUser.id || currentUser.role === 'admin') && (e.clientId === 'cs7' || (DB.tasks.find(t => t.id === e.taskId) || {}).clientId === 'cs7')).length;
      tsSearch = 'Work 12345'; const s = _tsFilterEntries().length; tsSearch = '';
      return { a, expect, s };
    });
    ok(filt.a === filt.expect && filt.s === 1, 'filtering by client and by search text gives the same answers as before (' + JSON.stringify(filt) + ')');
    // The search box waits for a pause in typing, then renders once, and keeps the cursor.
    const typing = await p.evaluate(async () => {
      tsStatusTab = 'all'; renderView('reports');
      let renders = 0; const real = window.renderView; window.renderView = (v) => { if (v === 'reports') renders++; return real(v); };
      const el = document.getElementById('ts-search-input'); el.focus();
      for (const v of ['W', 'Wo', 'Wor', 'Work', 'Work 1']) { el.value = v; _tsSearchInput(v); }
      const immediately = renders;
      await new Promise(r => setTimeout(r, 600));
      window.renderView = real;
      const after = document.getElementById('ts-search-input');
      return { immediately, renders, focused: document.activeElement === after, caret: after.selectionStart, value: after.value, tsSearch };
    });
    ok(typing.immediately === 0 && typing.renders === 1 && typing.tsSearch === 'Work 1', 'five quick keystrokes in the timesheet search make one render, after a pause (' + JSON.stringify(typing) + ')');
    ok(typing.focused && typing.value === 'Work 1' && typing.caret === 6, 'and the cursor is still in the box at the end of what was typed');
    await p.evaluate(() => { tsSearch = ''; });

    // ── Time ──
    const tms = await p.evaluate(() => window.__time(() => navigate('time')));
    const tview = await p.evaluate(() => ({ groups: document.querySelectorAll('#view-container [style*="position:sticky"]').length, btn: [...document.querySelectorAll('#view-container button')].find(b => /Show earlier days/.test(b.textContent)), total: null }));
    const tinfo = await p.evaluate(() => { const btn = [...document.querySelectorAll('#view-container button')].find(b => /Show earlier days/.test(b.textContent)); const days = new Set(DB.timeEntries.filter(e => e.staffId === currentUser.id).map(e => e.date)).size; return { text: btn ? btn.textContent : null, days, drawn: document.querySelectorAll('#view-container [style*="position:sticky"]').length }; });
    ok(tms < 2500, 'Time opens in reasonable time (' + tms + ' ms; it took 1,550 ms before)');
    ok(tinfo.drawn === 14 && /Show earlier days \((\d+) more\)/.test(tinfo.text || '') && +/\((\d+) more\)/.exec(tinfo.text)[1] === tinfo.days - 14, 'Time lists the latest 14 days and offers the rest (' + JSON.stringify(tinfo) + ')');
    await p.evaluate(() => { [...document.querySelectorAll('#view-container button')].find(b => /Show earlier days/.test(b.textContent)).click(); });
    ok(await p.evaluate(() => document.querySelectorAll('#view-container [style*="position:sticky"]').length) === 28, 'Show earlier days adds 14 more');

    // ── Notifications ──
    const nms = await p.evaluate(() => window.__time(() => navigate('notifications')));
    const nview = await p.evaluate(() => ({ rows: document.querySelectorAll('#view-container [onclick*="notifGoToTask"]').length, btn: [...document.querySelectorAll('#view-container button')].find(b => /Show older/.test(b.textContent)) ? [...document.querySelectorAll('#view-container button')].find(b => /Show older/.test(b.textContent)).textContent : null, unread: (document.querySelector('#view-container .card span') || {}).textContent, real: DB.notifications.filter(n => n.recipientId === currentUser.id && !n.read).length }));
    ok(nms < 1500, 'Notifications opens quickly (' + nms + ' ms; it took 640 ms before)');
    const mine = await p.evaluate(() => DB.notifications.filter(n => n.recipientId === currentUser.id).length);
    ok(nview.rows === 100 && new RegExp('Show older \\(' + (mine - 100) + ' more\\)').test(nview.btn || '') && new RegExp(nview.real + ' unread').test(nview.unread || '') && mine >= 3000, 'it lists the latest 100, offers the other ' + (mine - 100) + ', and the unread count covers them all (' + JSON.stringify({ rows: nview.rows, btn: nview.btn, unread: nview.unread }) + ')');
    await p.evaluate(() => { [...document.querySelectorAll('#view-container button')].find(b => /Show older/.test(b.textContent)).click(); });
    ok(await p.evaluate(() => document.querySelectorAll('#view-container [onclick*="notifGoToTask"]').length) === 200, 'Show older adds 100 more');

    // ── The global search ──
    const gs = await p.evaluate(async () => {
      let calls = 0; const real = window._onGlobalSearchNow; window._onGlobalSearchNow = () => { calls++; return real(); };
      openWorkboard('bs1'); navigate('workspace'); await new Promise(r => setTimeout(r, 200));   // the search box lives in the board header
      const el = document.getElementById('global-search'); el.value = 'Task 12';
      onGlobalSearch(); onGlobalSearch(); onGlobalSearch(); onGlobalSearch(); onGlobalSearch();
      const immediately = calls;
      await new Promise(r => setTimeout(r, 700));
      window._onGlobalSearchNow = real;
      const shown = (document.getElementById('view-container').innerText.match(/Task 12/g) || []).length;
      return { immediately, calls, shown };
    });
    ok(gs.immediately === 0 && gs.calls === 1 && gs.shown > 0, 'five quick keystrokes in the global search run the search once, after a pause, and it shows results (' + JSON.stringify(gs) + ')');

    // ── Old read notifications are cleared; nothing else ──
    const prune = await p.evaluate(() => {
      const day = 86400000, now = Date.now(), iso = d => new Date(d).toISOString(), me = currentUser.id;
      DB.notifications = [
        { id: 'pOldRead', recipientId: me, type: 'comment', message: 'x', read: true, createdAt: iso(now - 120 * day) },
        { id: 'pOldUnread', recipientId: me, type: 'comment', message: 'x', read: false, createdAt: iso(now - 120 * day) },
        { id: 'pNewRead', recipientId: me, type: 'comment', message: 'x', read: true, createdAt: iso(now - 10 * day) },
        { id: 'pOtherOldRead', recipientId: 'someone-else', type: 'comment', message: 'x', read: true, createdAt: iso(now - 120 * day) },
      ];
      DB.deletedNotificationIds = [];
      _pruneOldNotifications();
      const ids = DB.notifications.map(n => n.id).sort().join(',');
      const tomb = (DB.deletedNotificationIds || []).join(',');
      _pruneOldNotifications();
      return { ids, tomb, again: DB.notifications.length };
    });
    ok(prune.ids === 'pNewRead,pOldUnread,pOtherOldRead' && prune.tomb === 'pOldRead' && prune.again === 3, 'only the signed-in person\'s read notifications older than 90 days are cleared, and remembered as removed (' + JSON.stringify(prune) + ')');
    const merged = await p.evaluate(() => { const stale = { ...JSON.parse(JSON.stringify(DB)), notifications: [{ id: 'pOldRead', recipientId: currentUser.id, type: 'comment', message: 'x', read: true, createdAt: '2025-01-01T00:00:00.000Z' }] }; const m = _mergeDB(JSON.parse(JSON.stringify(DB)), stale); return m.notifications.some(n => n.id === 'pOldRead'); });
    ok(merged === false, 'another computer\'s older copy does not bring a cleared notification back');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h9-performance-test', pass, fail); }
})();
