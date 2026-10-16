// Retained Services (.agents/PLAN-retained-services.md), batch 1: the permanent sidebar section, the
// admin set-up, the allowance meter (finished subitems, client-visible work, this month) and the plan.
// Own offline server through the ISO harness: never the user's :3001.
const H = require('./_iso-harness.cjs');

H.run('retained-test', 3177, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // Section: always there for an admin, with +, even before any retained board exists.
  const sec0 = await ev(() => { const h = document.getElementById('nav-retained-header'), l = document.getElementById('sidebar-retained-list'), a = document.getElementById('retained-add-btn'); return h && l ? { shown: getComputedStyle(h).display !== 'none', text: h.textContent + ' ' + l.textContent, add: !!a && getComputedStyle(a).display !== 'none', sameAsWb: !!a && a.classList.contains('nav-add-btn') && h.querySelector('.section-header.nav-sec-toggle') !== null } : null; });
  t.ok(sec0 && sec0.shown && /Retained Services/.test(sec0.text) && /No retained boards yet/.test(sec0.text), 'the sidebar has a permanent Retained Services section, empty to start');
  t.ok(sec0 && sec0.add, 'an admin sees + on the section');
  t.ok(sec0 && sec0.sameAsWb, 'the section is built like WorkBoards and ISO (same header and + button)');

  // Set-up.
  await ev(() => openRetainerSetup()); await t.sleep(300);
  const su = await ev(() => ({
    title: document.getElementById('generic-modal-title').textContent,
    clients: [...document.querySelectorAll('#rs-su-client option')].map(o => o.value),
    on: [...document.querySelectorAll('[data-rs-svc]:checked')].map(i => i.dataset.rsSvc),
  }));
  t.eq(su.title, 'New retained board', 'the + opens the New retained board set-up');
  t.ok(su.clients.length && !su.clients.includes('c0'), 'the client list leaves out Etcher itself');
  t.eq(su.on, ['ims', 'hseq'], 'the two core services start ticked');
  await ui.shot('retained-setup');
  // Measured on the dialog itself: the dashboard behind it already overflows by 12px at 390 (a
  // teal button there, not part of this feature).
  await ui.size(390, 844);
  const suWide = await ev(() => [...document.querySelectorAll('#generic-modal *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
  await ui.size(1440, 1000);
  t.eq(suWide, 0, 'the set-up dialog fits a phone');
  await ev(() => { _rsSet('clientId', null, 'c2'); _rsSet('on', 'mob', true); _rsSet('allowance', 'ims', '12'); _rsSet('mt', 'hseq', false, 1); });
  await ev(() => document.getElementById('rs-su-create').click()); await t.sleep(800);
  const made = await ev(() => {
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c2');
    if (!b) return null;
    const groups = DB.groups.filter(g => (g.boardId || g.workboardId) === b.id);
    const tasks = DB.tasks.filter(x => (x.boardId || x.workboardId) === b.id);
    return { name: b.name, client: b.clientId, folder: b.folderId, svc: b.retainer.services.map(s => s.key + ':' + s.allowance), groupsOk: b.retainer.services.every(s => groups.some(g => g.id === s.groupId)), groups: groups.length,
      tasks: tasks.length, recur: tasks.every(x => x.recurrence && x.recurrence.freq === 'monthly' && x.recurrence.nextDue > x.startDate), owners: tasks.every(x => !!x.ownerId), start: b.retainer.startMonth, id: b.id };
  });
  t.ok(made && made.client === 'c2' && made.name === 'Daltech' && made.folder === null, 'Create makes a board named after the client and linked to it');
  t.eq(made && made.svc, ['ims:12', 'hseq:8', 'mob:15'], 'the board carries each ticked service with its allowance');
  t.ok(made && made.groups === 3 && made.groupsOk, 'one group per service, each tied to its service');
  t.eq(made && made.tasks, 4, 'the monthly tasks kept ticked are created (2 + 1 + 1)');
  t.ok(made && made.recur && made.owners, 'monthly tasks repeat monthly from the start month and have the service owner');
  const side = await ev(id => ({ inSection: !!document.querySelector(`#sidebar-retained-list [data-wb-row="${id}"]`), elsewhere: [...document.querySelectorAll(`[data-wb-row="${id}"]`)].filter(r => !r.closest('#sidebar-retained-list')).length }), made.id);
  t.ok(side.inSection && side.elsewhere === 0, 'the board sits in Retained Services, not under Team Boards or a folder');
  await ev(() => openRetainerSetup()); await t.sleep(300);
  t.ok(!(await ev(() => [...document.querySelectorAll('#rs-su-client option')].some(o => o.value === 'c2'))), 'a client with a retained board is not offered again');
  await ev(() => closeGenericModal());

  // Admin only.
  const staffView = await ev(() => {
    const role = currentUser.role; currentUser.role = 'staff'; applyRolePermissions(); renderSidebarWorkboards();
    const ab = document.getElementById('retained-add-btn'), add = !!ab && getComputedStyle(ab).display !== 'none';
    document.getElementById('generic-modal').classList.add('hidden'); openRetainerSetup();
    const opened = !document.getElementById('generic-modal').classList.contains('hidden');
    currentUser.role = role; applyRolePermissions(); renderSidebarWorkboards(); return { add, opened };
  });
  t.ok(!staffView.add && !staffView.opened, 'staff who are not admins get no + and cannot open the set-up');

  // No folders for retained boards.
  const fold = await ev(id => { DB.wbFolders = DB.wbFolders || []; DB.wbFolders.push({ id: 'wbf_rt', name: 'Some folder', order: 0, ownerId: currentUser.id }); moveWbToFolder(id, 'wbf_rt'); return DB.workboards.find(w => w.id === id).folderId; }, made.id);
  t.eq(fold, null, 'a retained board cannot be moved into a folder');

  // Meter: finished subitems this month on client-visible work.
  await ev(id => openWorkboard(id), made.id); await t.sleep(1200);
  const meter = () => ev(() => [...document.querySelectorAll('.ws-grp-meter')].map(m => m.textContent.replace(/\s+/g, ' ').trim()));
  const m0 = await meter();
  t.ok(m0.length === 3 && /^0 of 12 document reviews used in /.test(m0[0]), 'each service group header shows its meter, starting at 0');
  await ev(id => {
    const b = DB.workboards.find(w => w.id === id), g = b.retainer.services[0].groupId, now = new Date().toISOString(), lastMonth = new Date(Date.now() - 40 * 864e5).toISOString();
    const T = (o) => Object.assign({ id: 't' + uid(), name: 'x', title: 'x', boardId: id, workboardId: id, groupId: g, status: 'todo', priority: 'med', archived: false, createdAt: now, updatedAt: now }, o);
    DB.tasks.push(T({ id: 'rt-parent', name: 'Six procedures' }));
    DB.tasks.push(T({ id: 'rt-s1', parentTaskId: 'rt-parent', status: 'done', completedAt: now }));
    DB.tasks.push(T({ id: 'rt-s2', parentTaskId: 'rt-parent', status: 'done', completedAt: now }));
    DB.tasks.push(T({ id: 'rt-s3', parentTaskId: 'rt-parent', status: 'in-progress' }));
    DB.tasks.push(T({ id: 'rt-s4', parentTaskId: 'rt-parent', status: 'done', completedAt: lastMonth }));
    DB.tasks.push(T({ id: 'rt-solo', name: 'Register check', status: 'done', completedAt: now }));
    DB.tasks.push(T({ id: 'rt-hidden', name: 'Internal prep', status: 'done', completedAt: now, clientHidden: true }));
    DB.tasks.push(T({ id: 'rt-hidden-p', name: 'Hidden parent', clientHidden: true }));
    DB.tasks.push(T({ id: 'rt-hidden-s', parentTaskId: 'rt-hidden-p', status: 'done', completedAt: now }));
    saveDB(DB); renderView('workspace');
  }, made.id); await t.sleep(600);
  const m1 = await meter();
  t.ok(/^3 of 12 /.test(m1[0]), `two subitems and one task finished this month count, last month's and hidden work do not (got "${m1[0]}")`);
  // A finished task saved without a completion date (created already Completed, 2026-10-16) counts by
  // its last update; one last updated last month does not.
  await ev(id => {
    const b = DB.workboards.find(w => w.id === id), g = b.retainer.services[0].groupId, now = new Date().toISOString(), lastMonth = new Date(Date.now() - 40 * 864e5).toISOString();
    DB.tasks.push({ id: 'rt-nodate', name: 'Audit', title: 'Audit', boardId: id, workboardId: id, groupId: g, status: 'completed', priority: 'med', archived: false, createdAt: now, updatedAt: now, completedAt: null });
    DB.tasks.push({ id: 'rt-nodate-old', name: 'Old', title: 'Old', boardId: id, workboardId: id, groupId: g, status: 'done', priority: 'med', archived: false, createdAt: lastMonth, updatedAt: lastMonth });
    saveDB(DB); renderView('workspace');
  }, made.id); await t.sleep(500);
  t.ok(/^4 of 12 /.test((await meter())[0]), 'a finished task saved without a date counts by its last update; last month\'s does not (got "' + (await meter())[0] + '")');
  // The New Task form records the completion date when a task is created already Completed.
  const created = await ev(id => {
    const b = DB.workboards.find(w => w.id === id), g = b.retainer.services[0].groupId;
    openTaskModal(null, g);
    document.getElementById('tm-name').value = 'Created done';
    document.getElementById('tm-status').value = 'done';
    saveTask();
    const x = DB.tasks.find(k => k.name === 'Created done');
    return x ? { at: x.completedAt, status: x.status } : null;
  }, made.id); await t.sleep(500);
  t.ok(created && created.at && created.at.slice(0, 7) === new Date().toISOString().slice(0, 7), 'a task created already Completed records when it was finished (' + JSON.stringify(created) + ')');
  t.ok(/^5 of 12 /.test((await meter())[0]), 'and it counts on the meter');
  const shotWs = await ui.shot('retained-board');
  t.eq(shotWs.phone, 0, 'the retained board fits a phone');

  // Retainer plan.
  t.ok(await ev(() => !!document.querySelector('.rs-plan-btn')), 'a retained board has a Retainer plan button');
  await ev(id => openRetainerPlan(id), made.id); await t.sleep(300);
  t.eq(await ev(() => document.getElementById('generic-modal-title').textContent), 'Retainer plan', 'the button opens the Retainer plan');
  await ev(id => _rsPlanSet(id, 'allowance', 'ims', '10'), made.id); await t.sleep(400);
  t.ok(/^5 of 10 /.test((await meter())[0]), 'changing an allowance in the plan moves the meter');
  await ev(id => { _rsPlanSet(id, 'focusAdd', 'rt-parent'); _rsPlanSet(id, 'note', null, '  Licences all current.  '); }, made.id);
  const plan = await ev(id => { const r = DB.workboards.find(w => w.id === id).retainer, ym = _rsYm(); return { focus: (r.months[ym] || {}).focusTaskIds, note: (r.months[_rsPrevYm(ym)] || {}).note }; }, made.id);
  t.eq(plan.focus, ['rt-parent'], 'a task pinned to the focus is kept for this month');
  t.eq(plan.note, 'Licences all current.', 'the note is kept, trimmed, against last month\'s review');
  const staffPlan = await ev(id => { const role = currentUser.role; currentUser.role = 'staff'; const before = DB.workboards.find(w => w.id === id).retainer.services[0].allowance; _rsPlanSet(id, 'allowance', 'ims', '99'); openRetainerPlan(id); const inputs = document.querySelectorAll('[data-rs-allow]').length; currentUser.role = role; return { same: DB.workboards.find(w => w.id === id).retainer.services[0].allowance === before, inputs }; }, made.id);
  t.ok(staffPlan.same && staffPlan.inputs === 0, 'only admins change allowances');
  const shotPl = await ui.shot('retained-plan');
  t.eq(shotPl.phone, 0, 'the Retainer plan fits a phone');
});
