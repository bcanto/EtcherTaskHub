// Retained Services (.agents/PLAN-retained-services.md), batch 3: changing the plan (add / remove a service),
// ending a retainer, and the last two months in the portal, read only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained3-test', 3179, async (t) => {
  // Server slice history (no browser).
  const lastMonth = new Date(Date.now() - 32 * 864e5).toISOString();
  const blob = {
    users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin' }], clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }],
    boards: [{ id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u1', services: [{ key: 'ims', groupId: 'g1', unit: 'document reviews', allowance: 20, core: true }], months: {} } }],
    groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS' }],
    tasks: [{ id: 'p', groupId: 'g1', boardId: 'rb', clientId: 'c1', title: 'Procedures', status: 'in-progress' }, { id: 's1', parentTaskId: 'p', status: 'done', completedAt: lastMonth }, { id: 's2', parentTaskId: 'p', status: 'done', completedAt: lastMonth }],
  };
  const rt = P.sliceForClient(blob, 'c1', 'cu1').boards[0].retainer;
  t.ok(rt.history && rt.history.length === 2 && rt.history[0].services[0].used === 2 && rt.services[0].used === 0, 'the slice carries the last two months, read only (2 last month, 0 this month)');

  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  // The staff Dashboard (where the + for a retained board lives) fits a phone: its search and
  // "+ New WorkBoard" were 12px too wide at 390 (found while testing batch 1).
  const dash = await ui.shot('dashboard-header');
  t.eq(dash.phone, 0, 'the staff Dashboard fits a phone');
  const id = await ev(() => { openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Core'); retainerCreate(); return DB.workboards.find(w => w.retainer && w.clientId === 'c1').id; });
  await ev(b => openRetainerPlan(b), id); await t.sleep(300);
  t.ok(await ev(() => !!document.getElementById('rs-pl-addsvc') && !!document.querySelector('[data-rs-remove="ims"]') && !!document.getElementById('rs-pl-end')), 'an admin can add or remove services and end the retainer from the plan');

  // Add, remove, re-add.
  const add = await ev(b => { _rsPlanSet(b, 'addService', 'ci'); const w = DB.workboards.find(x => x.id === b), s = w.retainer.services.find(x => x.key === 'ci'); return { has: !!s, group: s && DB.groups.some(g => g.id === s.groupId && (g.boardId || g.workboardId) === b), gid: s && s.groupId }; }, id);
  t.ok(add.has && add.group, 'adding a service adds it to the plan with its own group');
  await ev(b => { openWorkboard(b); }, id); await t.sleep(900);
  t.eq(await ev(() => document.querySelectorAll('.ws-grp-meter').length), 3, 'the new service gets a meter on the board');
  const rm = await ev((b, gid) => {
    DB.tasks.push({ id: 'rt3-job', name: 'Trend review', title: 'Trend review', boardId: b, workboardId: b, groupId: gid, status: 'todo', archived: false });
    _rsPlanSet(b, 'removeService', 'ci'); renderView('workspace');
    const w = DB.workboards.find(x => x.id === b);
    return { inPlan: w.retainer.services.some(x => x.key === 'ci'), groupKept: DB.groups.some(g => g.id === gid), jobKept: DB.tasks.some(x => x.id === 'rt3-job' && !x.archived) };
  }, id, add.gid); await t.sleep(400);
  t.ok(!rm.inPlan && rm.groupKept && rm.jobKept, 'removing a service takes it off the plan but keeps its group and jobs');
  t.eq(await ev(() => document.querySelectorAll('.ws-grp-meter').length), 2, 'a removed service has no meter');
  const back = await ev(b => { _rsPlanSet(b, 'addService', 'ci'); return DB.workboards.find(x => x.id === b).retainer.services.find(x => x.key === 'ci').groupId; }, id);
  t.eq(back, add.gid, 'adding it back reuses its old group, jobs and all');
  const staff = await ev(b => {
    const role = currentUser.role; currentUser.role = 'staff'; closeConfirm();
    _rsPlanSet(b, 'removeService', 'ci'); retainerEnd(b);
    const asked = !document.getElementById('confirm-modal').classList.contains('hidden'); closeConfirm();
    const w = DB.workboards.find(x => x.id === b); currentUser.role = role;
    return { still: w.retainer.services.some(x => x.key === 'ci'), archived: !!w.archived, asked };
  }, id);
  t.ok(staff.still && !staff.archived && !staff.asked, 'staff who are not admins cannot change services or even start ending a retainer');

  // Portal history.
  await ev(b => { const w = DB.workboards.find(x => x.id === b), g = w.retainer.services.find(s => s.key === 'ims').groupId, lm = new Date(Date.now() - 32 * 864e5).toISOString();
    DB.tasks.push({ id: 'rt3-p', name: 'Procedures', title: 'Procedures', boardId: b, workboardId: b, groupId: g, clientId: 'c1', status: 'in-progress', archived: false });
    DB.tasks.push({ id: 'rt3-s1', name: 'One', title: 'One', parentTaskId: 'rt3-p', status: 'done', completedAt: lm, archived: false });
    saveDB(DB); }, id);
  await ev(() => { currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; launchClientView(); cpNavigate('retained'); }); await t.sleep(800);
  const hist = await ev(() => { const h = document.querySelector('.cp-rt-hist'); return h ? h.textContent.replace(/\s+/g, ' ') : ''; });
  t.ok(/Earlier months/.test(hist) && /1 document reviews/.test(hist), `the portal shows the last two months, read only (got "${hist.slice(0, 120)}")`);
  const shot = await ui.shot('retained-history');
  t.eq(shot.phone, 0, 'the tab with its history fits a phone');

  // End the retainer (as admin again), then restore it.
  await ev(() => { currentUser = Object.assign({}, allStaff().find(u => u.id === 'u1'), { type: 'admin' }); launchApp && launchApp(); }); await t.sleep(1500);
  await ev(b => retainerEnd(b), id); await t.sleep(300);
  t.ok(await ev(() => !document.getElementById('confirm-modal').classList.contains('hidden')), 'ending a retainer asks first');
  await ev(() => document.getElementById('confirm-ok-btn').click()); await t.sleep(600);
  const ended = await ev(b => ({ archived: !!DB.workboards.find(x => x.id === b).archived, inSidebar: !!document.querySelector(`#sidebar-retained-list [data-wb-row="${b}"]`) }), id);
  t.ok(ended.archived && !ended.inSidebar, 'an ended retainer\'s board is archived and leaves the Retained Services section');
  t.ok(await ev(() => !_cpClientBoards('c1').some(b => _isRetainedBoard(b))), 'the client\'s portal no longer has a retained board, so no Retained Services tab');
  await ev(b => { DB.workboards.find(x => x.id === b).archived = false; saveDB(DB); renderSidebarWorkboards(); }, id);
  t.ok(await ev(b => !!document.querySelector(`#sidebar-retained-list [data-wb-row="${b}"]`), id), 'restoring the board brings it back to Retained Services');
});
