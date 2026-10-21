// Retained Services, next features batch 2 (2026-10-21): the Etcher-side dashboard. The queue orders open requests and
// retained work by the client's service level, with reply and delivery dates counted in business days (Monday to Friday);
// the reply clock stops at the first reply or action, delivery at done or sent for approval. Allowances at 80% and over
// are flagged. Staff only. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained5-test', 3265, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── Business days ──
  const bd = await ev(() => [
    _bdDue('2026-10-23T09:00:00', 1),  // Fri + 1 = Mon
    _bdDue('2026-10-24T09:00:00', 0),  // Sat, same day = Mon
    _bdDue('2026-10-25T21:00:00', 2),  // Sun + 2 = Wed (starts Mon)
    _bdDue('2026-10-21T08:00:00', 2),  // Wed + 2 = Fri
    _bdDue('2026-10-22T08:00:00', 3),  // Thu + 3 = Tue
    _bdDue('2026-10-23T08:00:00', 5),  // Fri + 5 = next Fri
    _bdDue('2026-10-21T08:00:00', 0),  // Wed, same day
    _bdDue('2026-10-21T08:00:00', null),
  ]);
  t.eq(bd, ['2026-10-26', '2026-10-26', '2026-10-28', '2026-10-23', '2026-10-27', '2026-10-30', '2026-10-21', null], 'business days skip Saturday and Sunday; a weekend start counts from Monday; no clock is no date');

  // ── Fixture: five retained clients, one per level, and one client with no retainer ──
  const fx = await ev(() => {
    const now = new Date().toISOString(), lm = _rsPrevYm(_rsYm()), ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
    const levels = ['Standard', 'Priority', 'Priority+', 'High', 'Highest'];
    const out = { boards: {}, groups: {} };
    levels.forEach((lv, i) => {
      const cid = 'rq-c' + i, bid = 'rq-b' + i, gid = 'rq-g' + i;
      DB.clients.push({ id: cid, name: 'Queue Client ' + lv, color: '#31585a', portalEnabled: true, archived: false, shortCode: 'Q' + i, createdAt: now, updatedAt: now });
      DB.workboards.push({ id: bid, name: 'Queue Client ' + lv, color: '#31585a', visibility: 'all_internal', personalBoard: false, clientId: cid, folderId: null, ownerId: 'u1', archived: false, createdAt: now, updatedAt: now,
        retainer: { services: [{ key: 'ims', groupId: gid, unit: 'document reviews', allowance: 10, core: true, ownerId: 'u2' }], leadId: 'u1', startMonth: lm, priority: lv, months: {}, endedAt: null, fees: [] } });
      DB.groups.push({ id: gid, clientId: cid, workboardId: bid, boardId: bid, name: 'IMS and Document Control', order: 0, color: '#1d6fb8', createdAt: now });
      out.boards[lv] = bid; out.groups[lv] = gid;
    });
    DB.clients.push({ id: 'rq-cx', name: 'Hourly Client', color: '#64748b', portalEnabled: true, archived: false, createdAt: now, updatedAt: now });
    const req = (id, cid, title, submittedAt, extra) => DB.clientWorkRequests.push(Object.assign({ id, clientId: cid, title, description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt, updatedAt: now, status: 'pending', adminNote: null, attachments: [] }, extra || {}));
    req('rq-std-old', 'rq-c0', 'Old standard ask', ago(20));                          // reply and delivery late
    req('rq-std-ok', 'rq-c0', 'Fresh standard ask', now);                             // not late yet
    req('rq-pri', 'rq-c1', 'Priority ask', ago(20), { status: 'reviewing', respondedAt: ago(19) }); // replied, delivery late
    req('rq-ppl', 'rq-c2', 'Priority plus ask', ago(20), { respondedAt: ago(1) });    // replied late
    req('rq-high', 'rq-c3', 'High ask', ago(2), { respondedAt: ago(2) });             // replied, no delivery clock
    req('rq-top', 'rq-c4', 'Highest ask', ago(1));                                    // no clocks at all
    req('rq-dec', 'rq-c4', 'Declined ask', ago(1), { status: 'declined' });
    req('rq-hourly', 'rq-cx', 'Hourly client ask', ago(1));
    // Linked: one done (leaves), one sent for approval (leaves), one still open (stays as one row)
    const T = (id, bid, gid, cid, o) => DB.tasks.push(Object.assign({ id, name: id, title: id, clientId: cid, boardId: bid, workboardId: bid, groupId: gid, parentTaskId: null, status: 'todo', priority: 'med', ownerId: 'u2', archived: false, createdAt: now, updatedAt: now }, o || {}));
    T('rq-t-done', out.boards.Priority, out.groups.Priority, 'rq-c1', { status: 'done', completedAt: now });
    req('rq-l-done', 'rq-c1', 'Linked done', ago(3), { status: 'scoped', linkedItemId: 'rq-t-done', linkedItemType: 'task', linkedBoardId: out.boards.Priority });
    T('rq-t-appr', out.boards.Priority, out.groups.Priority, 'rq-c1', { awaitingClient: true, clientActionType: 'approval' });
    req('rq-l-appr', 'rq-c1', 'Linked for approval', ago(3), { status: 'scoped', linkedItemId: 'rq-t-appr', linkedItemType: 'task', linkedBoardId: out.boards.Priority });
    T('rq-t-open', out.boards.Priority, out.groups.Priority, 'rq-c1', { ownerId: 'u1' });
    req('rq-l-open', 'rq-c1', 'Linked open', ago(3), { status: 'scoped', linkedItemId: 'rq-t-open', linkedItemType: 'task', linkedBoardId: out.boards.Priority });
    // Plain retained work: overdue, due in three days, due in a month, and none
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    T('rq-w-late', out.boards.Standard, out.groups.Standard, 'rq-c0', { endDate: day(-3) });
    T('rq-w-soon', out.boards.Standard, out.groups.Standard, 'rq-c0', { endDate: day(3) });
    T('rq-w-far', out.boards.Standard, out.groups.Standard, 'rq-c0', { endDate: day(30) });
    T('rq-w-none', out.boards.Standard, out.groups.Standard, 'rq-c0');
    T('rq-w-top', out.boards.Highest, out.groups.Highest, 'rq-c4', { endDate: day(2) });   // dated work at the Highest level
    saveDB(DB);
    return out;
  });
  t.ok(await ev(() => typeof _cpIsApprovalAsk === 'function' && _cpIsApprovalAsk(DB.tasks.find(x => x.id === 'rq-t-appr'))), 'fixture: the approval task is an approval ask');

  const q = await ev(() => {
    const rows = _rqQueue(), by = id => rows.find(r => r.id === id) || null, pick = r => r && { reply: r.reply && r.reply.due, rs: r.replyState, del: r.deliver && r.deliver.due, ds: r.deliverState, late: r.late };
    const sub = (iso, n) => _bdDue(iso, n);
    const reqs = Object.fromEntries(DB.clientWorkRequests.map(r => [r.id, r]));
    return {
      ids: rows.map(r => r.id),
      std: pick(by('rq-std-old')), stdExp: [sub(reqs['rq-std-old'].submittedAt, 2), sub(reqs['rq-std-old'].submittedAt, 5)],
      pri: pick(by('rq-pri')), priExp: sub(reqs['rq-pri'].submittedAt, 3),
      ppl: pick(by('rq-ppl')), high: pick(by('rq-high')), top: pick(by('rq-top')),
      linkedOpen: rows.filter(r => r.id === 'rq-l-open' || r.id === 'rq-t-open').map(r => r.kind + ':' + r.id + ':' + r.ownerId),
      fresh: pick(by('rq-std-ok')),
    };
  });
  t.ok(q.std && q.std.reply === q.stdExp[0] && q.std.del === q.stdExp[1] && q.std.rs === 'late' && q.std.ds === 'late', `Standard: reply in 2 business days, deliver in 5; both late here (got ${JSON.stringify(q.std)})`);
  t.ok(q.pri && q.pri.rs === 'met' && q.pri.del === q.priExp && q.pri.ds === 'late', `Priority: the reply was in time; delivery in 3 business days is late (got ${JSON.stringify(q.pri)})`);
  t.eq(q.ppl && q.ppl.rs, 'metlate', 'a reply after its due date counts as replied late');
  t.ok(q.high && q.high.rs === 'met' && q.high.del === null && q.high.ds === null, `High: same-day reply, no delivery date (accelerated) (got ${JSON.stringify(q.high)})`);
  t.ok(q.top && q.top.reply === null && q.top.del === null && !q.top.late, 'Highest: no clocks, never late');
  t.ok(q.fresh && !q.fresh.late, 'a request that came in today is not late');
  t.ok(!q.ids.includes('rq-dec') && !q.ids.includes('rq-hourly'), 'declined requests and clients without a retainer stay out of the queue');
  t.ok(!q.ids.includes('rq-l-done') && !q.ids.includes('rq-t-done') && !q.ids.includes('rq-l-appr') && !q.ids.includes('rq-t-appr'), 'work done or sent for approval leaves the queue, with its request');
  t.eq(q.linkedOpen, ['request:rq-l-open:u1'], 'a job added from a request is one row: the request, with the job\'s owner');

  // ── Order and filters ──
  const ord = await ev(() => {
    const rows = _rqSort(_rqQueue(), 'level'), lv = rows.map(r => r.lv.rank);
    const sorted = lv.every((v, i) => i === 0 || lv[i - 1] >= v);
    const std = rows.filter(r => r.lv.key === 'Standard').map(r => r.id);
    const due = _rqSort(_rqQueue(), 'due').map(r => r.key || '9999');
    return { first: rows[0] && rows[0].id, sorted, std, dueSorted: due.every((v, i) => i === 0 || due[i - 1] <= v) };
  });
  t.eq(ord.first, 'rq-top', 'by level: the Highest client\'s request is at the top, above that client\'s dated work (no clock means it is due now)');
  t.ok(ord.sorted, 'by level: every Highest item before High, before Priority+, before Priority, before Standard');
  t.ok(ord.std.indexOf('rq-std-old') < ord.std.indexOf('rq-w-soon') && ord.std.indexOf('rq-w-soon') < ord.std.indexOf('rq-w-far') && ord.std.indexOf('rq-w-far') < ord.std.indexOf('rq-w-none'),
    `within a level the nearest date comes first and undated work last (got ${JSON.stringify(ord.std)})`);
  t.ok(ord.dueSorted, 'by due date: the nearest date first, whatever the level');
  const flt = await ev(() => {
    const ids = q => { Object.assign(_rdQ, { client: '', level: '', owner: '', show: 'all', order: 'level' }, q); return _rdFilter(_rqQueue()).map(r => r.id); };
    return {
      soon: ids({ show: 'soon' }), all: ids({ show: 'all' }), req: ids({ show: 'requests' }), late: ids({ show: 'late' }),
      client: ids({ client: 'rq-c2' }), level: ids({ level: 'Highest' }), me: ids({ owner: 'me' }), u2: ids({ owner: 'u2' }),
    };
  });
  t.ok(flt.soon.includes('rq-w-late') && flt.soon.includes('rq-w-soon') && !flt.soon.includes('rq-w-far') && !flt.soon.includes('rq-w-none') && flt.soon.includes('rq-top'),
    'the default view: every request, plus work that is late or due within a week');
  t.ok(flt.all.includes('rq-w-far') && flt.all.includes('rq-w-none'), 'All open work shows the rest');
  t.ok(flt.req.length && flt.req.every(id => !id.startsWith('rq-w-')), 'Requests only');
  t.ok(flt.late.includes('rq-std-old') && flt.late.includes('rq-w-late') && !flt.late.includes('rq-top') && !flt.late.includes('rq-std-ok'), 'Late only');
  t.eq(flt.client, ['rq-ppl'], 'filter by client');
  t.eq(flt.level.slice().sort(), ['rq-top', 'rq-w-top'], 'filter by level');
  t.ok(flt.me.includes('rq-l-open') && !flt.me.includes('rq-w-late'), 'filter by owner: me');
  t.ok(flt.u2.includes('rq-w-late') && !flt.u2.includes('rq-l-open'), 'filter by another owner');

  // ── The page ──
  await ev(() => { Object.assign(_rdQ, { client: '', level: '', owner: '', show: 'soon', order: 'level' }); navigate('retained'); }); await t.sleep(600);
  const pg = await ev(() => {
    const rows = [...document.querySelectorAll('#rd-queue tbody tr[data-rq]')];
    const row = id => rows.find(r => r.dataset.rq.endsWith(':' + id));
    const txt = id => { const r = row(id); return r ? r.textContent.replace(/\s+/g, ' ') : ''; };
    return {
      title: document.getElementById('view-title').textContent, n: rows.length, first: rows[0] && rows[0].dataset.rq,
      lateRow: !!(row('rq-std-old') && row('rq-std-old').classList.contains('late')), lateTxt: txt('rq-std-old'), top: txt('rq-top'), high: txt('rq-high'),
      bars: row('rq-top') ? row('rq-top').querySelectorAll('.rq-lv rect.on').length : 0, bars1: row('rq-std-old') ? row('rq-std-old').querySelectorAll('.rq-lv rect.on').length : 0,
      side: !!document.getElementById('nav-retained-dash'), badge: (document.querySelector('#nav-retained-dash .rd-nav-badge') || {}).textContent || '', lateN: _rqLateCount(),
      active: document.getElementById('nav-retained-dash').classList.contains('active'),
    };
  });
  t.eq(pg.title, 'Retained Services', 'the view is titled Retained Services');
  t.ok(pg.first === 'request:rq-top' && pg.bars === 5 && pg.bars1 === 1, 'the queue shows the Highest request first, levels drawn as one to five bars');
  t.ok(pg.lateRow && /Late, /.test(pg.lateTxt), `a late item is marked late in words and shape (got "${pg.lateTxt}")`);
  t.ok(/Priority queue/.test(pg.top) && /Surge support/.test(pg.top), 'Highest shows its priority queue and surge support instead of dates');
  t.ok(/Replied/.test(pg.high) && /Accelerated/.test(pg.high), 'High: replied, delivery accelerated');
  t.ok(pg.side && pg.active && pg.badge === String(pg.lateN) && pg.lateN > 0, `the sidebar's Dashboard row is active and counts the late items (got ${pg.badge}, ${pg.lateN})`);
  const shot = await ui.shot('retained5-dashboard');
  t.ok(shot.desktop === 0 && shot.phone === 0, `the dashboard fits desktop and phone (got ${JSON.stringify(shot)})`);

  // ── Near-limit warnings ──
  const warn = await ev(fx => {
    const now = new Date().toISOString(), add = (lv, n) => { for (let i = 0; i < n; i++) DB.tasks.push({ id: 'rq-u-' + lv + i, name: 'u', title: 'u', boardId: fx.boards[lv], workboardId: fx.boards[lv], groupId: fx.groups[lv], parentTaskId: null, status: 'done', completedAt: now, archived: false, createdAt: now, updatedAt: now }); };
    // Priority already has one finished job (rq-t-done), so 6 more makes 7 of 10.
    add('High', 8); add('Highest', 10); add('Priority', 6); saveDB(DB); renderView('retained');
    const li = lv => { const el = document.getElementById('rd-att-' + fx.boards[lv] + '-ims'); return el ? { cls: el.className, txt: el.textContent.replace(/\s+/g, ' ') } : null; };
    const meter = lv => { const tr = document.querySelector(`#rd-clients tr[data-rd-client="rq-c${['Standard', 'Priority', 'Priority+', 'High', 'Highest'].indexOf(lv)}"] .rd-m`); return tr ? tr.className : ''; };
    return { high: li('High'), top: li('Highest'), pri: li('Priority'), mHigh: meter('High'), mTop: meter('Highest'), mPri: meter('Priority') };
  }, fx);
  t.ok(warn.high && warn.high.cls === 'warn' && /8 of 10 document reviews used/.test(warn.high.txt), `80% of the allowance is flagged (got ${JSON.stringify(warn.high)})`);
  t.ok(warn.top && warn.top.cls === 'bad' && /used up/.test(warn.top.txt), `100% is flagged as used up (got ${JSON.stringify(warn.top)})`);
  t.eq(warn.pri, null, 'under 80% is not flagged');
  t.ok(/near/.test(warn.mHigh) && /full/.test(warn.mTop) && !/near|full/.test(warn.mPri), 'the client meters say near and full too');

  // ── Requests open in a dialog and change there; the page stays on the queue ──
  const dlg = await ev(() => {
    _rdOpen('request', 'rq-std-ok');
    const m = document.getElementById('generic-modal'), open = !m.classList.contains('hidden'), title = document.getElementById('generic-modal-title').textContent;
    const r = DB.clientWorkRequests.find(x => x.id === 'rq-std-ok');
    wrUpdateStatus('rq-std-ok', 'reviewing', null);
    const still = !document.getElementById('generic-modal').classList.contains('hidden') && /Reviewing/.test(document.getElementById('generic-modal-body').textContent);
    const out = { open, title, view: currentView, onQueue: !!document.getElementById('rd-queue'), still, stamped: !!r.respondedAt };
    closeGenericModal(); return out;
  });
  t.ok(dlg.open && dlg.title === 'Work request', 'a request opens in a dialog with the Client Manager card');
  t.ok(dlg.view === 'retained' && dlg.onQueue && dlg.still && dlg.stamped, `changing its status there keeps the queue on screen, refreshes the dialog and stops the reply clock (got ${JSON.stringify(dlg)})`);
  const opened = await ev(() => { const keep = window.openTaskPanel; let got = null; window.openTaskPanel = id => { got = id; }; try { _rdOpen('task', 'rq-w-late'); const a = got; _rdOpen('request', 'rq-l-open'); return [a, got]; } finally { window.openTaskPanel = keep; } });
  t.eq(opened, ['rq-w-late', 'rq-t-open'], 'a job, or a request already on a board, opens its task');

  // ── Who sees what ──
  const vis = await ev(() => {
    const keep = Object.assign({}, currentUser), out = {};
    currentUser.role = 'staff'; currentUser.billing = false; renderView('retained');
    out.staff = { queue: !!document.getElementById('rd-queue'), fee: /Monthly fee|\$\d/.test(document.getElementById('rd-clients').textContent), newBtn: !!document.getElementById('rd-new') };
    currentUser.billing = true; renderView('retained');
    out.bill = /Monthly fee|\$\d/.test(document.getElementById('rd-clients').textContent);
    currentUser.role = 'client'; currentUser.clientId = 'rq-c0'; renderView('retained');
    out.client = !document.getElementById('rd-queue') && /Access Restricted/.test(document.getElementById('view-container').textContent);
    Object.keys(currentUser).forEach(k => delete currentUser[k]); Object.assign(currentUser, keep); renderView('retained');
    out.admin = { newBtn: !!document.getElementById('rd-new'), fee: /Monthly fee|\$\d/.test(document.getElementById('rd-clients').textContent) };
    return out;
  });
  t.ok(vis.staff.queue && !vis.staff.fee && !vis.staff.newBtn, 'staff see the queue, without fees or the new-board button');
  t.ok(!vis.bill, 'billing staff see no fee here either: the director sets it on the pro forma');
  t.ok(vis.client, 'a client never reaches the dashboard');
  t.ok(vis.admin.newBtn && !vis.admin.fee, 'admins can add a retained board, and see no fee column');
});
