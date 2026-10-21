// Retained Services (.agents/PLAN-retained-services.md), batch 2: the retainer in the client's server slice,
// staff names (R6), Request Work's service / urgency / needed-by with lead + admin notify (R11), Add to
// Workboard limited to the client's boards and pre-filled, a request's new board linked to the client,
// the portal's Retained Services tab, and retained hours kept off the hourly pro forma (R7).
// Server parts run on api/_portal.js directly; the browser parts on the harness's own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained2-test', 3178, async (t) => {
  // ── Server slice + submitWorkRequest (no browser) ─────────────────────────────────────────
  const now = new Date().toISOString(), lastMonth = new Date(Date.now() - 40 * 864e5).toISOString();
  const blob = {
    users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin' }, { id: 'u2', name: 'Sam Wignall', role: 'staff' }, { id: 'u3', name: 'Alex Staff', role: 'staff' }],
    clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }, { id: 'c2', name: 'Daltech', portalEnabled: true }],
    boards: [
      { id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u2', startMonth: '2026-03', priority: 'Highest', services: [{ key: 'ims', groupId: 'g1', unit: 'document reviews', allowance: 20, core: true, ownerId: 'u1' }], months: {} } },
      { id: 'tb', clientId: 'c1', name: 'GCR - Tracker' },
      { id: 'ob', clientId: 'c2', name: 'Daltech board' },
    ],
    groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS and Document Control' }, { id: 'g2', boardId: 'tb', clientId: 'c1', name: 'Main' }, { id: 'g3', boardId: 'ob', clientId: 'c2', name: 'Main' }],
    tasks: [
      { id: 'p', groupId: 'g1', boardId: 'rb', clientId: 'c1', title: 'Six procedures', status: 'in-progress', ownerId: 'u1', currentlyWithType: 'staff', currentlyWithUserId: 'u2' },
      { id: 's1', parentTaskId: 'p', status: 'done', completedAt: now }, { id: 's2', parentTaskId: 'p', status: 'done', completedAt: now },
      { id: 's3', parentTaskId: 'p', status: 'done', completedAt: lastMonth }, { id: 's4', parentTaskId: 'p', status: 'todo' },
      { id: 'solo', groupId: 'g1', boardId: 'rb', clientId: 'c1', title: 'Register check', status: 'done', completedAt: now },
      { id: 'hid', groupId: 'g1', boardId: 'rb', clientId: 'c1', title: 'Internal', status: 'done', completedAt: now, clientHidden: true },
      { id: 'nodate', groupId: 'g1', boardId: 'rb', clientId: 'c1', title: 'Audit', status: 'completed', updatedAt: now },
    ],
    clientWorkRequests: [], notifications: [],
  };
  const slice = P.sliceForClient(blob, 'c1', 'cu1');
  const rb = slice.boards.find(b => b.id === 'rb');
  t.ok(rb && rb.retainer && rb.retainer.services[0].used === 4, `the client's slice carries the retainer with this month's use, a finished task without a date included (got ${rb && rb.retainer && rb.retainer.services[0].used})`);
  t.ok(rb && rb.retainer.leadName === 'Sam Wignall' && rb.retainer.services[0].ownerName === 'Bruna Canto', 'the slice names the lead and the service owner');
  t.ok(rb && !JSON.stringify(rb.retainer).includes('"u1"') && !JSON.stringify(rb.retainer).includes('"u2"'), 'the slice carries names, never staff ids');
  t.ok(!slice.boards.find(b => b.id === 'tb').retainer, 'a board without a retainer carries none');
  const pt = slice.tasks.find(x => x.id === 'p');
  t.ok(pt && pt.ownerName === 'Bruna Canto' && pt.withName === 'Sam Wignall', 'client tasks carry the owner\'s and holder\'s names (R6)');
  let seq = 0; const ctx = (clientId) => ({ clientId, userId: 'cu1', userName: 'Client Person', now, rid: () => 'r' + (++seq) });
  const send = (clientId, extra) => P.applyPortalAction(blob, ctx(clientId), { type: 'submitWorkRequest', title: 'Need a thing', description: '', ...extra });
  t.ok(send('c1', { serviceRef: 'g:g1', urgency: 'week', neededBy: '2026-11-03' }).ok, 'a request with a service, urgency and date is accepted');
  const r1 = blob.clientWorkRequests[blob.clientWorkRequests.length - 1];
  t.ok(r1.serviceRef === 'g:g1' && r1.urgency === 'week' && r1.neededBy === '2026-11-03' && r1.priority === 'normal', 'the request keeps its service, urgency and needed-by');
  const told = blob.notifications.filter(n => n.type === 'work_request').map(n => n.recipientId).sort();
  t.eq(told, ['u1', 'u2'], 'a retainer client\'s request notifies the retainer lead and the admins only (R11)');
  send('c1', { serviceRef: 'g:g3', urgency: 'urgent', neededBy: 'soon' });
  const r2 = blob.clientWorkRequests[blob.clientWorkRequests.length - 1];
  t.ok(r2.serviceRef === 'adhoc' && r2.neededBy === null && r2.priority === 'urgent', 'another client\'s group and a bad date are refused (ad hoc, no date); urgent maps to priority urgent');
  blob.notifications = [];
  send('c2', { serviceRef: 'b:ob' });
  t.eq(blob.notifications.filter(n => n.type === 'work_request').length, 3, 'a client without a retainer still notifies all staff');

  // ── Browser: staff side, then the portal as the client ────────────────────────────────────
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const ids = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Core'); retainerCreate();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1');
    const ims = b.retainer.services.find(s => s.key === 'ims');
    const now = new Date().toISOString();
    DB.tasks.push({ id: 'rt2-done', name: 'Register check', title: 'Register check', boardId: b.id, workboardId: b.id, groupId: ims.groupId, clientId: 'c1', status: 'done', completedAt: now, archived: false, ownerId: currentUser.id });
    DB.clientWorkRequests = DB.clientWorkRequests || [];
    DB.clientWorkRequests.push({ id: 'wr-rt2', clientId: 'c1', title: 'SWMS register update', description: 'Twelve SWMS', priority: 'normal', urgency: 'week', neededBy: '2026-11-05', serviceRef: 'g:' + ims.groupId, submittedAt: now, status: 'pending', adminNote: null, attachments: [] });
    DB.clientWorkRequests.push({ id: 'wr-rt2b', clientId: 'c2', title: 'Daltech thing', description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: now, status: 'pending', adminNote: null, attachments: [] });
    saveDB(DB);
    return { board: b.id, group: ims.groupId, owner: ims.ownerId };
  });
  await ev(() => renderView('clients')); await t.sleep(700);
  t.ok(await ev(() => /Asked for IMS and Document Control \(retainer\), needed by/.test(document.getElementById('view-container').textContent)), 'the staff request card says what the client asked for and by when');
  await ev(() => wrOpenAddModal('wr-rt2')); await t.sleep(300);
  const modal = await ev(() => ({ boards: [...document.querySelectorAll('#wr-modal-board option')].map(o => o.value), board: document.getElementById('wr-modal-board').value, group: document.getElementById('wr-modal-group').value, owner: document.getElementById('wr-modal-owner').value }));
  const c1Boards = await ev(() => DB.boards.filter(b => !b.archived && b.clientId === 'c1' && !_isPersonalBoard(b)).map(b => b.id).concat('__new__'));
  t.eq(modal.boards.sort(), c1Boards.sort(), 'Add to Workboard lists only that client\'s boards');
  t.ok(modal.board === ids.board && modal.group === ids.group && modal.owner === ids.owner, 'it is pre-filled with the retained board, the service group and the service owner');
  await ev(() => wrDoAddToWorkboard('wr-rt2')); await t.sleep(300);
  const added = await ev(g => { const r = DB.clientWorkRequests.find(x => x.id === 'wr-rt2'); const tk = DB.tasks.find(x => x.id === r.linkedItemId); return { status: r.status, group: tk && tk.groupId, end: tk && tk.endDate }; }, ids.group);
  t.ok(added.status === 'scoped' && added.group === ids.group && added.end === '2026-11-05', 'adding creates the task in the service group with the needed-by date');
  await ev(() => { wrOpenAddModal('wr-rt2b'); document.getElementById('wr-modal-board').value = '__new__'; wrModalBoardChange('__new__'); document.getElementById('wr-modal-newboard-name').value = 'Daltech - Tracker'; wrDoAddToWorkboard('wr-rt2b'); }); await t.sleep(300);
  const nb = await ev(() => { const b = DB.boards.find(x => x.name === 'Daltech - Tracker'); const c = DB.clients.find(x => x.id === 'c2'); return { client: b && b.clientId, remembered: c && c.adhocBoardId === (b && b.id) }; });
  t.ok(nb.client === 'c2', 'a board created from a request is linked to that client (it now shows in their portal)');
  t.ok(nb.remembered, 'an ad hoc request remembers the board it went to for next time');

  // Pro forma: hours on the retained board stay off the hourly invoice.
  const pf = await ev(b => {
    const tr = DB.tasks.find(x => x.boardId === b && !x.parentTaskId), other = DB.tasks.find(x => x.clientId === 'c1' && (x.boardId || x.workboardId) && (x.boardId || x.workboardId) !== b && !x.parentTaskId);
    const es = [{ id: 'e1', taskId: tr.id, clientId: 'c1', staffId: currentUser.id, date: '2026-10-10', hours: 2, billable: true }, { id: 'e2', taskId: other.id, clientId: 'c1', staffId: currentUser.id, date: '2026-10-10', hours: 3, billable: true }];
    const out = filterTimeEntriesForReport(es.map(timeEntryForReport), 'c1', '2026-10-01', '2026-10-31');
    return out.map(e => e.id);
  }, ids.board);
  t.eq(pf, ['e2'], 'hours on a retained board never reach the hourly pro forma (R7)');

  // Portal as General Cranes (c1, has the retainer), then Daltech (c2, none).
  await ev(() => { currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; launchClientView(); }); await t.sleep(1200);
  t.ok(await ev(() => getComputedStyle(document.getElementById('cp-tab-retained')).display !== 'none'), 'a client with a retainer gets the Retained Services tab');
  await ev(() => cpNavigate('retained')); await t.sleep(500);
  const tab = await ev(() => { const b = document.getElementById('cp-body'); return { text: b.textContent.replace(/\s+/g, ' '), rows: b.querySelectorAll('.cp-rt-row').length }; });
  t.ok(/Your retainer/.test(tab.text) && /2 Core/.test(tab.text) && /1 of 20 document reviews used/.test(tab.text), `the tab shows the plan and each service's use this month (got "${tab.text.slice(0, 160)}")`);
  t.ok(tab.rows >= 3, 'the service lists hold the client\'s jobs');
  const shot = await ui.shot('retained-portal');
  t.eq(shot.phone, 0, 'the Retained Services tab fits a phone');
  await ev(() => cpNavigate('requests')); await t.sleep(400);
  const form = await ev(g => ({ hasSvc: !!document.querySelector(`#cp-req-service option[value="g:${g}"]`), hint: document.getElementById('cp-req-hint').textContent }), ids.group);
  t.ok(form.hasSvc && /charged separately/.test(form.hint), 'Request Work offers the retained services, with ad hoc first explained');
  await ev(g => { document.getElementById('cp-req-service').value = 'g:' + g; cpReqServiceHint(); }, ids.group);
  t.ok(/Covered by your retainer: 19 of 20 document reviews left this month/.test(await ev(() => document.getElementById('cp-req-hint').textContent)), 'picking a retained service shows what is left this month');
  await ev(() => { currentUser = { id: 'c2', name: 'Daltech', role: 'client', type: 'client', clientId: 'c2', initials: 'DAL', color: '#1d6fb8' }; launchClientView(); cpNavigate('retained'); }); await t.sleep(900);
  const c2 = await ev(() => ({ hidden: getComputedStyle(document.getElementById('cp-tab-retained')).display === 'none', active: (document.querySelector('.cp-nav-tab.active') || {}).dataset.section }));
  t.ok(c2.hidden && c2.active === 'overview', 'a client without a retainer has no Retained Services tab, and the route falls back to Overview');
});
