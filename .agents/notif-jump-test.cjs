// Notification jump (2026-10-16 user report, live site): clicking a notification about a task took
// the user to the wrong board. Sub-items were saved without a board id and the jump read only the
// task's own id, so it stayed on whatever board was open. Now: the right board, the row flashed,
// the side panel open. Runs on its own static offline server (never :3001), in memory only.
const path = require('path'), http = require('http'), fs = require('fs');
const H = require('./_iso-harness.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 3190;

function staticOffline(port) {
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '', isoEnabled: false, microsoftSignIn: false })); }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not in this test"}'); }
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ stop: () => server.close() })));
}

(async () => {
  let srv = null, ui = null;
  try {
    srv = await staticOffline(PORT);
    ui = await H.browser(PORT);
    const p = ui.page;
    await p.evaluate(() => { window.saveDB = () => {}; });

    // ── New sub-items record their parent's board ──
    const made = await p.evaluate(() => {
      const ensure = id => { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); } return el; };
      const parent = DB.tasks.find(t => t.id === 't9');
      const out = {};
      ensure('tp-new-si').value = 'Sub from the panel'; tpAddSubitem('t9');
      tpSubitemPaste({ clipboardData: { getData: () => 'Pasted one\nPasted two' }, preventDefault() {} }, 't9');
      ensure('tm-ci-new').value = 'Sub from the modal'; tmAddSubitem('t9'); if (typeof closeTaskModal === 'function') closeTaskModal();
      for (const n of ['Sub from the panel', 'Pasted one', 'Pasted two', 'Sub from the modal']) { const t = DB.tasks.find(x => x.parentTaskId === 't9' && x.name === n); out[n] = t ? [t.boardId, t.workboardId] : null; }
      out.parentBoard = parent.boardId;
      return out;
    });
    ok(['Sub from the panel', 'Pasted one', 'Pasted two', 'Sub from the modal'].every(n => made[n] && made[n][0] === 'b2' && made[n][1] === 'b2'), 'sub-items added from the panel, by paste and from the task modal carry their parent\'s board (' + JSON.stringify(made) + ')');

    // ── A sub-item saved the old way (no board id), and a notification about it ──
    const setup = await p.evaluate(() => {
      const now = new Date().toISOString();
      DB.tasks.push({ id: 'si_legacy', parentTaskId: 't9', name: 'Legacy sub-item', title: 'Legacy sub-item', groupId: DB.tasks.find(t => t.id === 't9').groupId, status: 'todo', priority: 'med', percentComplete: 0, tags: [], dependencies: [], archived: false, createdAt: now, updatedAt: now });
      const me = currentUser.id;
      DB.notifications.push({ id: 'n_jump_sub', recipientId: me, taskId: 'si_legacy', type: 'mention', message: 'Sam mentioned you in: Legacy sub-item', read: false, createdAt: now });
      DB.notifications.push({ id: 'n_jump_top', recipientId: me, taskId: 't18', type: 'task_assigned', message: 'Task assigned to you: Review Humanz API Documentation', read: false, createdAt: now });
      return { me, t18Board: DB.tasks.find(t => t.id === 't18').boardId };
    });
    const clickNotif = async (nid) => {
      await p.evaluate(() => { openWorkboard('b1'); });
      await sleep(400);
      await p.evaluate(() => navigate('notifications'));
      await sleep(400);
      await p.evaluate(nid => { const row = [...document.querySelectorAll('#view-container [onclick]')].find(x => (x.getAttribute('onclick') || '').includes(`'${nid}'`) && (x.getAttribute('onclick') || '').startsWith('notifGoToTask')); row.click(); }, nid);
      await sleep(120);
      return p.evaluate(nid => ({
        board: currentWorkboard && currentWorkboard.id, view: currentView,
        panel: document.getElementById('task-panel').style.display === 'flex', panelTask: _tpCurrentTask && _tpCurrentTask.id,
        rowFlash: (() => { const r = document.querySelector('tr.ws-row-jump'); return r ? r.getAttribute('data-tid') : null; })(),
        read: (DB.notifications.find(n => n.id === nid) || {}).read,
      }), nid);
    };
    const sub = await clickNotif('n_jump_sub');
    ok(sub.board === 'b2' && sub.view === 'workspace', 'a notification about a sub-item opens the board it is on, not the board that was open (' + JSON.stringify(sub) + ')');
    ok(sub.rowFlash === 'si_legacy', 'its row is shown and highlighted');
    ok(sub.panel && sub.panelTask === 'si_legacy' && sub.read === true, 'the side panel opens on it, and the notification is marked read');
    await p.evaluate(() => closeTaskPanel()); await sleep(300);
    const top = await clickNotif('n_jump_top');
    ok(top.board === setup.t18Board && top.rowFlash === 't18' && top.panel && top.panelTask === 't18', 'a notification about a top-level task still lands on its board, row highlighted, panel open (' + JSON.stringify(top) + ')');
    await p.evaluate(() => closeTaskPanel()); await sleep(300);

    // The deep link (MCP task links) takes the same route.
    const deep = await p.evaluate(async () => { openWorkboard('b1'); await new Promise(r => setTimeout(r, 300)); _deepLinkOpenTask('si_legacy'); await new Promise(r => setTimeout(r, 200)); return { board: currentWorkboard && currentWorkboard.id, panelTask: _tpCurrentTask && _tpCurrentTask.id }; });
    ok(deep.board === 'b2' && deep.panelTask === 'si_legacy', 'a task link to a sub-item opens its board too');
    await p.evaluate(() => closeTaskPanel()); await sleep(300);

    // Sub-items already saved without a board id get it on load.
    const repaired = await p.evaluate(() => {
      const copy = JSON.parse(JSON.stringify(DB));
      copy.tasks.push({ id: 'si_old2', parentTaskId: 't18', name: 'Old sub-item', groupId: 'tg7', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      copy.tasks.push({ id: 'si_old3', parentTaskId: 'si_old2', name: 'Older still', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      _applyCompatAliases(copy);
      const a = copy.tasks.find(t => t.id === 'si_old2'), b = copy.tasks.find(t => t.id === 'si_old3');
      return { a: [a.boardId, a.workboardId, a.updatedAt], b: [b.boardId, b.workboardId] };
    });
    ok(repaired.a[0] === setup.t18Board && repaired.a[1] === setup.t18Board && repaired.a[2] === '2026-01-01T00:00:00.000Z' && repaired.b[0] === setup.t18Board, 'sub-items saved without a board id get their parent\'s board on load, without a new timestamp (' + JSON.stringify(repaired) + ')');
    ok(ui.errors.length === 0, 'no page errors or native dialogs (' + ui.errors.slice(0, 2).join(' | ') + ')');
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally {
    if (ui) await ui.close();
    if (srv) srv.stop();
    console.log('\nnotif-jump-test');
    console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
    console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
    process.exit(fail.length ? 1 : 0);
  }
})();
