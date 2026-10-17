// H4 (audit 2026-10-17): Remove Staff silently deleted the person's unapproved hours, and deleting a task or a client
// deleted the unapproved hours logged against it. Payroll hours for work already done disappeared before anyone had
// approved them. Now the hours stay (so they can be approved or rejected), the removed person's name and the deleted
// task's name stay on them, and every confirmation says so. Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3207);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3207/');
    // The data: a person with one entry of every status, another person's entry, a client with a task, a sub-item,
    // and entries on both, plus a comment and a checklist item that SHOULD still be deleted with their task.
    await p.evaluate(() => {
      const T = '2026-10-14T09:00:00.000Z';
      const ent = (id, staffId, taskId, status, hours, extra) => ({ id, staffId, taskId, clientId: 'cH4', date: '2026-10-13', hours, note: 'worked on it', status, billable: true, createdAt: T, updatedAt: T, ...(extra || {}) });
      DB.users.push({ id: 'uH4', name: 'Hana Hours', email: 'hana@etcher.test', role: 'staff', color: '#7aa3a4', displayColor: '#7aa3a4', initials: 'HH', active: true, createdAt: T, updatedAt: T });
      DB.users.push({ id: 'uOther', name: 'Olly Other', email: 'olly@etcher.test', role: 'staff', color: '#7aa3a4', displayColor: '#7aa3a4', initials: 'OO', active: true, createdAt: T, updatedAt: T });
      DB.staff = DB.users;
      DB.clients.push({ id: 'cH4', name: 'Hours Client', shortCode: 'HC', color: '#1d6fb8', createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gH4', name: 'Group', clientId: 'cH4', workboardId: DB.workboards[0].id, boardId: DB.workboards[0].id, order: 0, createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tH4', name: 'Quarterly review', groupId: 'gH4', clientId: 'cH4', workboardId: DB.workboards[0].id, boardId: DB.workboards[0].id, status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tH4b', name: 'Prepare slides', groupId: 'gH4', parentTaskId: 'tH4', clientId: 'cH4', status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      DB.comments = DB.comments || []; DB.comments.push({ id: 'cmH4', taskId: 'tH4', authorId: 'u1', body: 'a comment', createdAt: T });
      DB.checklistItems = DB.checklistItems || []; DB.checklistItems.push({ id: 'ckH4', taskId: 'tH4', text: 'a check', done: false, createdAt: T });
      DB.timeEntries = DB.timeEntries || [];
      DB.timeEntries.push(
        ent('eDraft', 'uH4', 'tH4', 'draft', 2), ent('eSub', 'uH4', 'tH4', 'submitted', 3.5), ent('eRej', 'uH4', null, 'rejected', 1), ent('eApp', 'uH4', null, 'approved', 4),
        ent('eOther', 'uOther', 'tH4', 'submitted', 1.5), ent('eSubTask', 'uOther', 'tH4b', 'draft', 0.5));
      window.__q = () => ({ n: DB.timeEntries.length, ids: DB.timeEntries.map(e => e.id).sort().join(','), msg: document.getElementById('confirm-msg').textContent });
    });
    const confirmText = () => p.evaluate(() => document.getElementById('confirm-msg').textContent);
    const clickConfirm = () => p.evaluate(() => { document.getElementById('confirm-ok-btn').click(); });
    const entries = () => p.evaluate(() => DB.timeEntries.map(e => ({ id: e.id, status: e.status, taskId: e.taskId, taskName: e.taskName || null, taskDeleted: !!e.taskDeleted })));
    const byId = async id => (await entries()).find(e => e.id === id);

    // ── Remove Staff ──
    await p.evaluate(() => deleteStaff('uH4'));
    let msg = await confirmText();
    ok(/Remove Hana Hours\?/.test(msg) && /Their 4 time entries \(10\.5h\) stay in Timesheets under their name/.test(msg) && /not yet approved can still be approved or rejected/.test(msg), 'the Remove Staff confirmation says their time entries and hours stay (' + msg.slice(0, 200) + ')');
    await clickConfirm();
    let es = await entries();
    ok(['eDraft', 'eSub', 'eRej', 'eApp', 'eOther'].every(id => es.find(e => e.id === id)), 'after removing the person, every one of their entries is still there: draft, submitted, rejected and approved');
    const gone = await p.evaluate(() => ({ user: !!DB.users.find(u => u.id === 'uH4'), tomb: (DB.deletedUserIds || []).includes('uH4'), former: (DB.formerStaff || []).filter(f => f.id === 'uH4').length, name: getStaff('uH4').name, other: getStaff('uOther').name }));
    ok(!gone.user && gone.tomb, 'and the person is removed as before (record gone, remembered as removed)');
    ok(gone.former === 1 && gone.name === 'Hana Hours (removed)' && gone.other === 'Olly Other', 'their name stays with the hours they left: "Hana Hours (removed)" (' + gone.name + ')');
    // They still show in Timesheets, and an admin can still approve or reject them.
    const table = await p.evaluate(async () => { rptTab = 'timesheet'; tsStatusTab = 'all'; tsStaffFilter = 'all'; tsDateFrom = ''; tsDateTo = ''; tsSearch = ''; renderView('reports'); await new Promise(r => setTimeout(r, 300)); return document.getElementById('view-container').innerText; });
    ok(/Hana Hours \(removed\)/.test(table), 'Timesheets still lists their entries under their name, marked removed');
    await p.evaluate(() => { tsApproveEntry('eSub'); });
    ok((await byId('eSub')).status === 'approved', 'a submitted entry of a removed person can still be approved');
    await p.evaluate(() => { openTsRejectModal('eDraft'); document.getElementById('ts-reject-reason').value = 'not submitted in time'; tsRejectEntry('eDraft'); });
    ok((await byId('eDraft')).status === 'rejected', 'and a draft one can still be rejected');
    // Editing a removed person's hours must not move them to whoever is first in the list.
    const editRemoved = await p.evaluate(() => {
      openEditTimeEntry('eRej');
      const sel = document.getElementById('ete-staff'), opt = sel.options[sel.selectedIndex];
      const shown = { value: sel.value, label: opt ? opt.textContent : '' };
      document.getElementById('ete-hours').value = '1.5';
      saveEditTimeEntry('eRej');
      const e = DB.timeEntries.find(x => x.id === 'eRej');
      return { shown, staffId: e.staffId, hours: e.hours };
    });
    ok(editRemoved.shown.value === 'uH4' && /Hana Hours \(removed\)/.test(editRemoved.shown.label) && editRemoved.staffId === 'uH4' && editRemoved.hours === 1.5, 'editing a removed person\'s hours keeps them with that person: the form lists them as removed and saving does not move the hours (' + JSON.stringify(editRemoved) + ')');
    // Adding them back (same login, same id) shows the live name again.
    const back = await p.evaluate(() => { DB.users.push({ id: 'uH4', name: 'Hana Hours', email: 'hana@etcher.test', role: 'staff', color: '#7aa3a4', initials: 'HH', active: true, updatedAt: new Date().toISOString() }); return getStaff('uH4').name; });
    ok(back === 'Hana Hours', 'if the same person is added again their live name is used, not the removed one');
    await p.evaluate(() => { DB.users = DB.users.filter(u => u.id !== 'uH4'); DB.staff = DB.users; });
    // A person with no hours: nothing extra is said, nothing kept.
    await p.evaluate(() => { DB.users.push({ id: 'uNone', name: 'No Hours', email: 'nh@etcher.test', role: 'staff', color: '#7aa3a4', initials: 'NH', active: true }); DB.staff = DB.users; deleteStaff('uNone'); });
    msg = await confirmText();
    ok(/Remove No Hours\? This cannot be undone\.$/.test(msg) && !/time entr/.test(msg), 'a person with no hours gets the same short confirmation as before');
    await clickConfirm();
    ok(await p.evaluate(() => !(DB.formerStaff || []).some(f => f.id === 'uNone')), 'and nothing is kept for them');

    // ── Deleting a task ──
    await p.evaluate(() => { document.getElementById('confirm-modal').classList.add('hidden'); confirmDelete('task', 'tH4'); });
    msg = await confirmText();
    ok(/Delete this task\?/.test(msg) && /1 sub-item/.test(msg) && /1 comment/.test(msg) && /1 checklist item/.test(msg), 'the task confirmation still counts what is deleted: sub-items, comments, checklist (' + msg.slice(0, 160) + ')');
    ok(!/permanently deletes[^.]*time entr/.test(msg) && /time entr(?:y|ies) not yet approved will be kept too/.test(msg), 'and says the hours not yet approved are kept, not deleted (' + msg.slice(msg.indexOf('This also')).slice(0, 200) + ')');
    const nBefore = (await entries()).length;
    await clickConfirm();
    es = await entries();
    const kept = ['eDraft', 'eSub', 'eOther', 'eSubTask'].map(id => es.find(e => e.id === id));
    ok(kept.every(e => e) && es.length === nBefore, 'after deleting the task and its sub-item, every time entry logged against them is still there (' + es.length + ' of ' + nBefore + ' entries)');
    ok(kept.filter(e => e.taskId === 'tH4').every(e => e.taskDeleted && e.taskName === 'Quarterly review') && es.find(e => e.id === 'eSubTask').taskName === 'Prepare slides', 'each carries the name of the task it was logged against');
    const after = await p.evaluate(() => ({ task: !!DB.tasks.find(t => t.id === 'tH4'), sub: !!DB.tasks.find(t => t.id === 'tH4b'), cm: !!DB.comments.find(c => c.id === 'cmH4'), ck: !!DB.checklistItems.find(c => c.id === 'ckH4') }));
    ok(!after.task && !after.sub && !after.cm && !after.ck, 'while the task, its sub-item, comments and checklist are deleted as before');
    const table2 = await p.evaluate(async () => { renderView('reports'); await new Promise(r => setTimeout(r, 300)); return document.getElementById('view-container').innerText; });
    ok(/Quarterly review\s*\(deleted\)/.test(table2) && /Prepare slides\s*\(deleted\)/.test(table2), 'Timesheets names the deleted task on its hours');
    await p.evaluate(() => { tsApproveEntry('eOther'); });
    ok((await byId('eOther')).status === 'approved', 'hours left on a deleted task can still be approved');

    // ── The other ways to delete a task ──
    const mk = (id, name, extra) => p.evaluate((id, name, extra) => {
      const T = new Date().toISOString();
      DB.tasks.push({ id, name, groupId: 'gH4', clientId: 'cH4', workboardId: DB.workboards[0].id, boardId: DB.workboards[0].id, status: 'todo', priority: 'med', createdAt: T, updatedAt: T, ...(extra || {}) });
      DB.timeEntries.push({ id: 'e-' + id, staffId: 'uOther', taskId: id, clientId: 'cH4', date: '2026-10-13', hours: 2, note: 'x', status: 'submitted', billable: true, createdAt: T, updatedAt: T });
    }, id, name, extra);
    // the task panel's Delete
    await mk('tPanel', 'Panel task');
    await p.evaluate(() => { _tpCurrentTask = DB.tasks.find(t => t.id === 'tPanel'); tpDeleteTask(); });
    msg = await confirmText();
    ok(/Delete this task\? This cannot be undone\. Its 1 time entry stays in Timesheets\./.test(msg), 'the task panel Delete says its hours stay (' + msg + ')');
    await clickConfirm();
    let e1 = await byId('e-tPanel');
    ok(e1 && e1.taskDeleted && e1.taskName === 'Panel task' && !(await p.evaluate(() => DB.tasks.find(t => t.id === 'tPanel'))), 'the task panel Delete keeps the hours and removes the task');
    // Archive: delete forever, and delete all archived (with a sub-item of an archived task)
    await mk('tForever', 'Forever task', { archived: true });
    await p.evaluate(() => { permanentDeleteTask('tForever'); });
    msg = await confirmText();
    ok(/Permanently delete this task\? This CANNOT be undone\. Its 1 time entry stays in Timesheets\./.test(msg), 'Delete Forever says its hours stay');
    await clickConfirm();
    e1 = await byId('e-tForever');
    ok(e1 && e1.taskDeleted && e1.taskName === 'Forever task', 'Delete Forever keeps the hours');
    await mk('tArch1', 'Archived one', { archived: true });
    await mk('tArchKid', 'Archived kid', { parentTaskId: 'tArch1' });
    await p.evaluate(() => { permanentDeleteAllArchivedTasks(); });
    msg = await confirmText();
    ok(/Delete all archived|archived task/i.test(msg) && /Its 2 time entries stay in Timesheets\./.test(msg), 'Delete All Archived says its hours stay, counting sub-items too (' + msg.slice(-90) + ')');
    await clickConfirm();
    const ea = await byId('e-tArch1'), ek = await byId('e-tArchKid');
    ok(ea && ea.taskName === 'Archived one' && ek && ek.taskName === 'Archived kid' && ek.taskDeleted, 'Delete All Archived keeps the hours of the archived tasks and of their sub-items');

    // ── Deleting a client ──
    await mk('tClient', 'Client task');
    await p.evaluate(() => { const T = new Date().toISOString(); DB.timeEntries.push({ id: 'e-tClientApp', staffId: 'uOther', taskId: 'tClient', clientId: 'cH4', date: '2026-10-13', hours: 1, note: 'x', status: 'approved', billable: true, createdAt: T, updatedAt: T }); });
    await p.evaluate(() => { document.getElementById('confirm-modal').classList.add('hidden'); confirmDelete('client', 'cH4'); });
    msg = await confirmText();
    ok(/Delete "Hours Client"\?/.test(msg) && /1 approved time entry will be kept, but with the client gone they can no longer be invoiced or reported against/.test(msg) && /1 time entry not yet approved will be kept too, so it can still be approved or rejected, but with the client gone it can no longer be invoiced or reported against/.test(msg) && !/permanently deletes[^.]*time entr/.test(msg), 'the client confirmation says plainly that no hours are deleted and what the kept ones can no longer do (' + msg.slice(msg.indexOf('This also')).slice(0, 360) + ')');
    const before = (await entries()).length;
    await p.evaluate(() => { window.__stale = JSON.parse(JSON.stringify(DB)); });   // a colleague who has not seen the delete
    await clickConfirm();
    es = await entries();
    ok(es.length === before && es.find(e => e.id === 'e-tClient').taskName === 'Client task', 'deleting the client keeps every time entry (' + es.length + ' of ' + before + ')');

    // The same for hours whose client was deleted: the form keeps the client and saving does not move the hours.
    const editNoClient = await p.evaluate(() => {
      openEditTimeEntry('e-tClient');
      const sel = document.getElementById('ete-client'), opt = sel.options[sel.selectedIndex];
      const shown = { value: sel.value, label: opt ? opt.textContent : '' };
      document.getElementById('ete-hours').value = '4';
      saveEditTimeEntry('e-tClient');
      const e = DB.timeEntries.find(x => x.id === 'e-tClient');
      return { shown, clientId: e.clientId, hours: e.hours };
    });
    ok(editNoClient.shown.value === 'cH4' && /client removed/.test(editNoClient.shown.label) && editNoClient.clientId === 'cH4' && editNoClient.hours === 4, 'editing hours whose client was deleted keeps the client: the form lists it as removed and saving does not move the hours (' + JSON.stringify(editNoClient) + ')');

    // ── Merging with a colleague who has not seen this yet ──
    const merged = await p.evaluate(() => {
      const m = _mergeDB(window.__stale, JSON.parse(JSON.stringify(DB)));
      return { count: m.timeEntries.filter(x => x.id === 'e-tClient').length, deleted: m.timeEntries.find(x => x.id === 'e-tClient').taskDeleted === true };
    });
    ok(merged.count === 1 && merged.deleted, 'a colleague\'s older copy of an entry does not bring back the old state or duplicate it');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h4-hours-test', pass, fail); }
})();
