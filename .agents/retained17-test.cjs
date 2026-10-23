// Retained Services batch 13 (2026-10-23, the rest of the audit): the task audit trail records every way status, group,
// board and dates change (once each, readable); a link to a missing board leaves the open one; a notification's "all
// months" lasts one visit; recurring copies and board copies start with no history; a backdated retainer starts its jobs
// this month; an ended retainer is not restored next to a running one; Perth months; quarters from the start month;
// closed months keep their figures (month locking, staff and portal); the portal hides months before the start, shows
// quarterly hours, due dates on phones, a keyboard-reachable Attach files and clickable request notes; the dashboard caps
// Needs attention, opens Clients from the 80% count and the queue from a client page; tabs move with the arrow keys;
// removing a service asks first; people who left stay shown where they are set; WA's 2024 King's Birthday.
// Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained17-test', 3279, async (t) => {
  // ── Server: locked months, start-month quarters, quarterly history, active team ──
  {
    const blob = {
      users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin', active: true }, { id: 'u9', name: 'Former Person', role: 'staff', active: false }],
      clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }],
      boards: [{ id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u9', startMonth: '2026-02', seniorIds: [], services: [
        { key: 'ims', groupId: 'g1', unit: 'document revisions', allowance: 20, ownerId: 'u9' },
        { key: 'hseq', groupId: 'g3', unit: 'hours', allowance: 8, mode: 'hours', parts: [{ label: 'Elements', hours: 5, period: 'month', who: 'all' }, { label: 'Audits', hours: 8, period: 'quarter', who: 'audit' }] },
      ], months: {} } }],
      groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS' }, { id: 'g3', boardId: 'rb', clientId: 'c1', name: 'HSEQ' }],
      tasks: [{ id: 'a1', boardId: 'rb', groupId: 'g3', clientId: 'c1', name: 'Audit', status: 'in-progress', tags: ['Audit'] }, { id: 'e1', boardId: 'rb', groupId: 'g3', clientId: 'c1', name: 'Elements', status: 'in-progress' }],
      timeEntries: [], clientWorkRequests: [], notifications: [], actionRequests: [], taskFiles: [],
    };
    const now = new Date(), ym = now.toISOString().slice(0, 7);
    const prevOf = x => { const y = +x.slice(0, 4), m = +x.slice(5, 7); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); };
    const prev = prevOf(ym), prev2 = prevOf(prev);
    blob.boards[0].retainer.months[prev] = { lock: { at: now.toISOString(), services: [{ key: 'ims', mode: 'items', parts: [{ label: '', cap: 20, used: 7, prog: 0, period: 'month', unit: 'document revisions', who: 'secret' }] }] } };
    blob.timeEntries.push({ id: 'x1', taskId: 'e1', staffId: 'u1', hours: 2, date: prev2 + '-05', status: 'approved' }, { id: 'x2', taskId: 'a1', staffId: 'u1', hours: 3, date: prev2 + '-06', status: 'approved' });
    const rt = P.sliceForClient(blob, 'c1', 'cu').boards[0].retainer;
    const h1 = rt.history.find(h => h.month === prev).services.find(s => s.key === 'ims'), h2 = rt.history.find(h => h.month === prev2).services.find(s => s.key === 'hseq');
    t.ok(h1.used === 7 && !JSON.stringify(rt).includes('secret'), `a closed month shows the figures kept for it, and nothing about who (got ${JSON.stringify(h1)})`);
    t.ok(h2.used === '2' && h2.qtr === '3', `the history shows a month's hours and the quarter's hours separately (got ${JSON.stringify(h2)})`);
    t.ok(rt.leadName === null && rt.services[0].ownerName === null, `someone who has left is not on the client's team (got ${JSON.stringify([rt.leadName, rt.services[0].ownerName])})`);
  }

  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── Pure helpers: Perth months, start-month quarters, WA holidays, training column order ──
  const pure = await ev(() => ({
    perth: _rsYm(new Date('2026-10-31T17:00:00Z')), prev: _rsPrevYm('2026-01'), next: _rsNextYm('2026-12'),
    qName: _rsQuarterName('2026-03', '2026-02'), qCal: _rsQuarterName('2026-03'),
    inQ: _rsInPeriod('2026-02-10', '2026-04', 'quarter', '2026-02'), notLater: _rsInPeriod('2026-04-10', '2026-03', 'quarter', '2026-02'),
    preStart: _rsInPeriod('2026-01-20', '2026-03', 'quarter', '2026-02'),
    kb24: _waHolidays(2024).has('2024-09-23') && !_waHolidays(2024).has('2024-09-30'), kb26: _waHolidays(2026).has('2026-09-28'),
    quals: _regQualsOrder([{ quals: { Zeta: {}, Alpha: {} } }], {}),
  }));
  t.ok(pure.perth === '2026-11' && pure.prev === '2025-12' && pure.next === '2027-01', `months are Perth months and step over the year end (got ${JSON.stringify(pure)})`);
  // On a computer outside WA, a Perth November morning is still November.
  await ui.page.emulateTimezone('America/New_York');
  const ny = await ev(() => [_rsYm(new Date('2026-10-31T17:00:00Z')), toDateStr(new Date('2026-10-31T17:00:00Z')).slice(0, 7)]);
  await ui.page.emulateTimezone('Australia/Perth');
  t.ok(ny[0] === '2026-11' && ny[1] === '2026-10', `months are Perth months wherever the computer is (got ${JSON.stringify(ny)})`);
  t.ok(pure.qName === 'Feb to Apr' && pure.qCal === 'Jan to Mar' && pure.inQ && !pure.notLater && !pure.preStart, `quarters run from the start month, count up to the month's end, and hours before the start stay out (got ${JSON.stringify(pure)})`);
  t.ok(pure.kb24 && pure.kb26, 'King\'s Birthday: 23 September 2024 as proclaimed, otherwise the last Monday of September');
  t.ok(JSON.stringify(pure.quals) === '["Zeta","Alpha"]', `training columns keep the order they came in (got ${JSON.stringify(pure.quals)})`);

  const fx = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1');
    _rsSetup.startMonth = _rsPrevYm(_rsPrevYm(_rsPrevYm(_rsYm())));   // backdated three months
    _rsSet('bundle', null, 'Ops'); retainerCreate(); closeGenericModal();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived), g = b.retainer.services[0].groupId;
    const jobs = DB.tasks.filter(x => (x.boardId || x.workboardId) === b.id && x.recurrence);
    return { bid: b.id, g, key: b.retainer.services[0].key, firstDue: jobs.map(j => j.endDate.slice(0, 7)), next: jobs.map(j => j.recurrence.nextDue.slice(0, 7)), ym: _rsYm() };
  });
  t.ok(fx.firstDue.length && fx.firstDue.every(d => d === fx.ym) && fx.next.every(d => d > fx.ym), `a backdated retainer's monthly jobs start this month, not with months of overdue copies (got ${JSON.stringify(fx)})`);

  // ── Audit trail ──
  const au = await ev(async (bid, g) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const now = new Date().toISOString();
    const mk = (id, o) => { const x = Object.assign({ id, name: id, title: id, boardId: bid, workboardId: bid, groupId: g, clientId: 'c1', status: 'todo', order: 50, archived: false, createdAt: now, updatedAt: now }, o); DB.tasks.push(x); return x; };
    const a = mk('au-a'), bT = mk('au-b', { ownerId: currentUser.id, priority: 'med' }), c = mk('au-c'), d = mk('au-d'), sub = mk('au-sub', { parentTaskId: 'au-d', groupId: g });
    const g2 = DB.groups.find(x => (x.boardId || x.workboardId) === bid && x.id !== g).id, other = mk('au-o', { groupId: g2 });
    saveDB(DB); openWorkboard(bid); await wait(400);
    const trail = id => (DB.tasks.find(x => x.id === id).auditTrail || []).map(e => e.field + ':' + e.to);
    wsToggleDone('au-a', true); wsCycleStatus('au-b');
    mwQuickComplete('au-c', { stopPropagation() {} });
    _mwSelected.clear(); _mwSelected.add('au-d'); _mwBulkComplete();
    _wsApplyRowDrop('au-d', 'au-o', true);
    const out = { a: trail('au-a'), b: trail('au-b'), c: trail('au-c'), d: trail('au-d'), subGroup: DB.tasks.find(x => x.id === 'au-sub').groupId === g2, dDone: DB.tasks.find(x => x.id === 'au-d').completedAt };
    confirmGanttMove('au-a', '2026-12-01', '2026-12-05', 'apply'); out.gantt = trail('au-a');
    // The full task window: one line per real change, nothing for fields left alone.
    openTaskModal('au-b'); await wait(200);
    document.getElementById('tm-priority').value = 'high'; saveTask(); await wait(200);
    out.modal = trail('au-b');
    // Board move
    const ob = DB.workboards.find(w => w.id !== bid && !w.archived && !w.retainer);
    wsSelected.clear(); wsSelected.add('au-c'); wsBulkMoveToBoard(ob.id); document.getElementById('confirm-ok-btn').click();
    await wait(200); out.board = trail('au-c');
    // The panel: Created once, and the Activity tab has no dead toggle.
    DB.auditLog = (DB.auditLog || []).concat({ id: 'al-x', entityType: 'Task', entityId: 'au-a', action: 'created', actorId: currentUser.id, createdAt: now });
    out.created = _tpTrail(DB.tasks.find(x => x.id === 'au-a')).filter(r => r.text === 'Created the task').length;
    for (let i = 0; i < 12; i++) DB.tasks.find(x => x.id === 'au-a').auditTrail.push({ id: 'z' + i, at: now, by: currentUser.id, field: 'priority', label: 'Priority', from: 'a', to: 'b' + i });
    out.actBtn = /tp-trail-more/.test(renderTpActivity(DB.tasks.find(x => x.id === 'au-a')));
    return out;
  }, fx.bid, fx.g);
  t.ok(au.a[0] === 'status:Completed' && au.b.length === 1 && au.c[0] === 'status:Completed' && au.d.includes('status:Completed') && !!au.dDone, `ticking done, cycling the status, My Week's complete and bulk complete each go in the audit trail (got ${JSON.stringify(au)})`);
  t.ok(au.d.some(x => x.startsWith('groupId:')) && au.subGroup, `dragging a task to another group is recorded and takes its subitems along (got ${JSON.stringify(au.d)})`);
  t.ok(au.gantt.some(x => x.startsWith('startDate:')) && au.gantt.some(x => x.startsWith('endDate:')), `a Gantt move records the new dates (got ${JSON.stringify(au.gantt)})`);
  t.ok(au.modal.filter(x => x.startsWith('priority:')).length === 1 && !au.modal.some(x => /^(name|groupId|ownerId|startDate|endDate|percentComplete|hourBudget|description):/.test(x)), `the full task window records only what changed, once (got ${JSON.stringify(au.modal)})`);
  t.ok(au.board.some(x => x.startsWith('boardId:')), `moving a task to another board is recorded (got ${JSON.stringify(au.board)})`);
  t.ok(au.created === 1 && !au.actBtn, `"Created the task" shows once, and the Activity tab has no toggle that does nothing (got ${JSON.stringify([au.created, au.actBtn])})`);

  // ── Boards, months, copies ──
  const bd = await ev(async (bid, g) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openWorkboard(bid); await wait(300);
    openWorkboard('no-such-board'); const kept = currentWorkboard && currentWorkboard.id;
    localStorage.removeItem('etcher_ws_month'); _wsMonthSel = {};
    _wsMonthShowAll(); const tmp = _wsMonthVal(), saved = localStorage.getItem('etcher_ws_month');
    openWorkboard(bid); await wait(200); const after = _wsMonthVal();
    // Archived tasks still hold their place in the order.
    DB.tasks.push({ id: 'ord-x', name: 'x', title: 'x', boardId: bid, workboardId: bid, groupId: g, clientId: 'c1', status: 'done', order: 900, archived: true });
    const next = _wsNextOrder(g);
    // A recurring copy has no history of its own.
    const src = DB.tasks.find(x => (x.boardId || x.workboardId) === bid && x.recurrence);
    src.auditTrail = [{ id: 'q', at: new Date().toISOString(), field: 'status', label: 'Status', from: 'a', to: 'b' }]; src.clientApproval = { status: 'approved', at: new Date().toISOString() };
    src.recurrence.nextDue = toDateStr(new Date()); _checkRecurringTasks();
    const occ = DB.tasks.find(x => x.recurSourceId === src.id);
    // A board copy too.
    const ob = DB.workboards.find(w => w.id !== bid && !w.archived && !w.retainer && DB.tasks.some(x => (x.boardId || x.workboardId) === w.id));
    const ot = DB.tasks.find(x => (x.boardId || x.workboardId) === ob.id); ot.auditTrail = [{ id: 'q2', at: new Date().toISOString(), field: 'status', label: 'Status', from: 'a', to: 'b' }];
    duplicateWorkboard(ob.id);
    const copyB = DB.workboards.find(w => w.name === ob.name + ' (copy)'), copyT = DB.tasks.filter(x => (x.boardId || x.workboardId) === copyB.id);
    return { kept, tmp, saved, after, next, occTrail: occ ? (occ.auditTrail || null) : 'none', occAppr: occ ? occ.clientApproval || null : 'none', copyTrail: copyT.some(x => x.auditTrail), origTrail: ot.auditTrail.length };
  }, fx.bid, fx.g);
  t.ok(bd.kept === fx.bid, `a link to a board that is gone leaves the open board where it was (got ${JSON.stringify(bd)})`);
  t.ok(bd.tmp === 'all' && !bd.saved && bd.after === 'cur', `a notification's All months lasts for that visit and is never saved (got ${JSON.stringify(bd)})`);
  t.ok(bd.next === 901, `archived tasks keep their place in a group's order (got ${bd.next})`);
  t.ok(bd.occTrail === null && bd.occAppr === null && !bd.copyTrail && bd.origTrail === 1, `recurring and board copies start with no audit trail or approval of their own (got ${JSON.stringify(bd)})`);

  // ── Restore: one retained board per client ──
  const rs = await ev(async bid => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid);
    const old = JSON.parse(JSON.stringify(b)); old.id = 'rb-old'; old.name = 'Old retained'; old.archived = true; DB.workboards.push(old);
    restoreWorkboard('rb-old'); await wait(100);
    const msg = (document.getElementById('generic-modal-body') || {}).textContent || ''; closeGenericModal();
    return { still: DB.workboards.find(w => w.id === 'rb-old').archived, msg };
  }, fx.bid);
  t.ok(rs.still && /End that retainer before restoring/.test(rs.msg), `an ended retainer is not restored while the client has another running (got ${JSON.stringify(rs)})`);

  // ── Month locking ──
  const lk = await ev(async (bid, g) => {
    const b = DB.workboards.find(w => w.id === bid), s = b.retainer.services[0], m = _rsLockUpTo(), at = m + '-12T12:00:00';
    DB.tasks.push({ id: 'lk-1', name: 'lk', title: 'lk', boardId: bid, workboardId: bid, groupId: g, clientId: 'c1', status: 'done', completedAt: new Date(at).toISOString(), order: 70, archived: false, createdAt: at, updatedAt: at });
    const before = _rsUsage(b, s, m).parts[0].used, n = _rsLockMonths(), again = _rsLockMonths();
    DB.tasks.find(x => x.id === 'lk-1').archived = true;
    const after = _rsUsage(b, s, m), cur = (b.retainer.months[_rsYm()] || {}).lock;
    return { m, before, n, again, after: after.parts[0].used, locked: !!after.locked, curLocked: !!cur, lockedM: !!(b.retainer.months[m] || {}).lock };
  }, fx.bid, fx.g);
  t.ok(lk.n >= 1 && lk.again === 0 && lk.lockedM && !lk.curLocked, `closed months are kept once, the month in progress never (got ${JSON.stringify(lk)})`);
  t.ok(lk.before === 1 && lk.after === 1 && lk.locked, `archiving work afterwards leaves a closed month's figures as they were (got ${JSON.stringify(lk)})`);

  // ── Subitem index: a subitem added a moment later still counts ──
  const kx = await ev((bid, g) => {
    const b = DB.workboards.find(w => w.id === bid), s = b.retainer.services[0], ym = _rsYm(), now = new Date().toISOString();
    DB.tasks.push({ id: 'kx-p', name: 'p', title: 'p', boardId: bid, workboardId: bid, groupId: g, clientId: 'c1', status: 'in-progress', order: 71, archived: false });
    const a = _rsUsage(b, s, ym).parts[0].used;
    DB.tasks.push({ id: 'kx-s', name: 's', title: 's', parentTaskId: 'kx-p', status: 'done', completedAt: now, archived: false });
    const c = _rsUsage(b, s, ym).parts[0].used;
    return { a, c };
  }, fx.bid, fx.g);
  t.ok(kx.c === kx.a + 1, `a subitem added in the same moment counts straight away (got ${JSON.stringify(kx)})`);

  // ── Plan: remove asks; people who left stay shown ──
  const pl = await ev(async bid => {
    const b = DB.workboards.find(w => w.id === bid), r = b.retainer, k = r.services[1].key;
    const gone = { id: 'u-left', name: 'Left Person', role: 'staff', active: false }; DB.users.push(gone);
    r.leadId = 'u-left'; r.seniorIds = ['u-left'];
    openRetainerPlan(bid);
    const leadSel = document.querySelector('.rs-pl-grid select'), lead = leadSel ? leadSel.selectedOptions[0].textContent : '';
    const sn = !!document.querySelector('[data-rs-senior="u-left"]');
    document.querySelector(`[data-rs-remove="${k}"]`).click();
    const asked = !document.getElementById('confirm-modal').classList.contains('hidden'), still = r.services.some(s => s.key === k);
    closeConfirm(); closeGenericModal();
    return { lead, sn, asked, still };
  }, fx.bid);
  t.ok(pl.lead === 'Left Person (left)' && pl.sn, `someone who has left stays shown where they are set, marked (got ${JSON.stringify(pl)})`);
  t.ok(pl.asked && pl.still, 'removing a service from the plan asks first');

  // ── Dashboard ──
  const dq = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    _regView = null; _rdQ.tab = 'queue'; navigate('retained'); await wait(300);
    const out = { order: [...document.querySelectorAll('select[data-rd-q="order"] option')].map(o => o.textContent), panes: [...document.querySelectorAll('.rd-tabpane')].map(p => p.getAttribute('role')) };
    const q = document.getElementById('rd-tab-queue'); q.focus();
    q.parentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    out.focused = document.activeElement && document.activeElement.id; out.tabStill = _rdQ.tab;
    out.tabindex = [q.getAttribute('tabindex'), document.getElementById('rd-tab-clients').getAttribute('tabindex')];
    _rdClientsBy('used'); await wait(200); out.cl = [_rdQ.tab, _rdQ.csort];
    _rdQueueFor('c1'); await wait(200); out.qf = [_rdQ.tab, _rdQ.client, _rdQ.show];
    _rdShow('soon'); await wait(100);
    return out;
  });
  t.ok(dq.order.includes('By support tier') && dq.panes.every(r => r === 'tabpanel'), `the queue says "By support tier", and the panes are tab panels (got ${JSON.stringify(dq)})`);
  t.ok(dq.focused === 'rd-tab-clients' && dq.tabStill === 'queue' && JSON.stringify(dq.tabindex) === '["0","-1"]', `arrow keys move between tabs without switching on their own (got ${JSON.stringify(dq)})`);
  t.ok(dq.cl[0] === 'clients' && dq.cl[1] === 'used' && dq.qf.join() === 'queue,c1,all', `the 80% count opens Clients by most used; a client page opens the queue for that client (got ${JSON.stringify(dq)})`);
  const att = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const keep = _regAttention;
    _regAttention = () => Array.from({ length: 11 }, (_, i) => ({ tone: 'warn', id: 'fake-' + i, text: 'Fake ' + i, act: '', btn: 'Open' }));
    _rdQ.attAll = false; navigate('retained'); await wait(300);
    const n1 = document.querySelectorAll('.rd-att li').length, more = (document.getElementById('rd-att-more') || {}).textContent;
    document.getElementById('rd-att-more').click(); await wait(300);
    const n2 = document.querySelectorAll('.rd-att li').length;
    _regAttention = keep; _rdQ.attAll = false;
    return { n1, more, n2 };
  });
  t.ok(att.n1 === 8 && /Show \d+ more/.test(att.more || '') && att.n2 > 8, `Needs attention shows eight lines, then Show more (got ${JSON.stringify(att)})`);

  // ── Task panel copy ──
  const tp = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openTaskPanel('au-b'); await wait(300);
    const txt = (document.getElementById('task-panel') || document.body).innerHTML;
    const foot = /Created [^<]*Updated/.test(txt);
    closeTaskPanel();
    return { foot, mdash: /&mdash;|—/.test(txt.replace(/<script[\s\S]*?<\/script>/g, '')), mid: /&middot;|·/.test(txt) };
  });
  t.ok(tp.foot && !tp.mid, `the task panel footer reads in plain words, no dots (got ${JSON.stringify(tp)})`);

  // ── Hours log: items services and quarters ──
  const hl = await ev(async (bid) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid), it = b.retainer.services.find(s => s.mode !== 'hours'), hs = b.retainer.services.find(s => s !== it);
    hs.mode = 'hours'; hs.parts = [{ id: 'q1', label: 'Audits', hours: 8, period: 'quarter', who: 'all' }];
    const tk = DB.tasks.find(x => x.groupId === it.groupId && !x.parentTaskId && !x.archived);
    DB.timeEntries.push({ id: 'hl-1', taskId: tk.id, staffId: currentUser.id, hours: 1, date: toDateStr(new Date()), status: 'approved' });
    openRetainedClient('c1'); await wait(400);
    const row = document.querySelector('tr[data-rc-hour="hl-1"]'), hint = (document.querySelector('.rc-hours .rd-hint') || {}).textContent || '';
    return { row: row ? row.textContent : '', hint };
  }, fx.bid);
  t.ok(/Tracked by items/.test(hl.row) && /Quarterly parts count the whole quarter \([A-Z][a-z]{2} to [A-Z][a-z]{2}\)/.test(hl.hint), `the hours log says which hours fill no squares, and how quarters count (got ${JSON.stringify(hl)})`);

  // ── Portal ──
  const po = await ev(async (bid) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid);
    DB.users.find(u => u.id === 'u-left').active = false; b.retainer.leadId = 'u-left';
    const g = b.retainer.services[0].groupId;
    DB.tasks.push({ id: 'po-due', name: 'po-due', title: 'Due soon job', boardId: bid, workboardId: bid, groupId: g, clientId: 'c1', status: 'in-progress', endDate: toDateStr(new Date()), order: 80, archived: false });
    saveDB(DB);
    const keepUser = Object.assign({}, currentUser);
    currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; DB.clients.find(c => c.id === 'c1').portalEnabled = true;
    DB.notifications.push({ id: 'cpn-1', recipientId: 'c1', taskId: null, type: 'work_request', read: false, message: 'Etcher left a note on your request "X"', createdAt: new Date().toISOString() });
    launchClientView(); await wait(700); cpNavigate('retained'); await wait(400);
    const out = { team: (document.querySelector('.cp-rt-terms') || {}).textContent || '', dueM: !!document.querySelector('.cp-rt-due-m') };
    const inp = document.querySelector('.cp-attach input[type=file]');
    out.attach = inp ? getComputedStyle(inp).display !== 'none' && inp.tabIndex >= 0 : false;
    out.labels = !!document.querySelector('label[for="cp-req-title"]') && !!document.querySelector('label[for="cp-req-desc"]');
    out.max = (document.getElementById('cp-req-desc') || {}).maxLength;
    cpNavigate('notifications'); await wait(300);
    const n = document.querySelector('[data-cp-req-notif]'); out.notif = !!n; if (n) n.click(); await wait(300); out.section = cpSection;
    // A request sent offline carries its update stamp (the merge keeps the newer copy).
    cpNavigate('requests'); await wait(300); document.getElementById('cp-req-title').value = 'Stamped'; cpSubmitRequest('c1'); await wait(200);
    out.stamped = !!(DB.clientWorkRequests || []).find(r => r.title === 'Stamped' && r.updatedAt);
    currentUser = keepUser;
    return out;
  }, fx.bid);
  t.ok(!/Left Person/.test(po.team), `someone who has left is not on the portal's team (got "${po.team.slice(0, 160)}")`);
  t.ok(po.dueM && po.attach && po.labels && po.max === 5000, `due dates show on phones, Attach files can be reached by keyboard, the fields are labelled and the description says its limit (got ${JSON.stringify(po)})`);
  t.ok(po.notif && po.section === 'requests', `a note about a request opens My Requests (got ${JSON.stringify(po)})`);
  t.ok(po.stamped, 'a request sent offline is stamped with when it changed');
});
