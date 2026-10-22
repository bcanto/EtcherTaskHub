// Retained Services batch 11 (2026-10-22 night, the user's answers): a Month filter on retained boards (this month by
// default, earlier months, all; hidden tasks still count); Retained Services notifications open the work (revision and
// renewal tasks on the board, requests and older notifications the client page; the portal's server sends the link
// too); the task panel's audit trail (changes kept on the task, quick repeats folded, everything newest first, never in
// the portal); the dashboard as Queue and Clients tabs, the queue grouped by client and paged, the clients searchable.
// Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained15-test', 3277, async (t) => {
  // ── Server: a client's request notifies with a link to the client ──
  {
    const now = new Date().toISOString();
    const blob = { users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin', active: true }, { id: 'u2', name: 'Sam Wignall', role: 'staff', active: true }], clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }],
      boards: [{ id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u2', services: [{ key: 'ims', groupId: 'g1', unit: 'document revisions', allowance: 20 }], months: {} } }],
      groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS' }], tasks: [], clientWorkRequests: [], notifications: [] };
    let seq = 0;
    const res = P.applyPortalAction(blob, { clientId: 'c1', userId: 'cu1', userName: 'Client Person', now, rid: () => 'r' + (++seq) }, { type: 'submitWorkRequest', title: 'Need a thing', description: '' });
    const ns = blob.notifications;
    t.ok(res.ok && ns.length >= 1 && ns.every(n => n.link && n.link.kind === 'client' && n.link.clientId === 'c1'), `a request from the portal notifies with a link to the client's page (got ${JSON.stringify(ns.map(n => n.link))})`);
  }

  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const fx = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Ops'); retainerCreate(); closeGenericModal();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived), g = b.retainer.services[0].groupId, now = new Date().toISOString();
    const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setDate(0); d.setDate(10); return d.toISOString(); })();
    const mk = (id, status, completedAt) => DB.tasks.push({ id, name: id, title: id, boardId: b.id, workboardId: b.id, groupId: g, clientId: 'c1', status, completedAt: completedAt || null, order: 90, archived: false, createdAt: now, updatedAt: now });
    mk('mf-old', 'done', lastMonth); mk('mf-now', 'done', now); mk('mf-open', 'in-progress');
    saveDB(DB);
    return { bid: b.id, g, prev: _rsPrevYm(_rsYm()), staff2: _rsStaff().find(u => u.id !== currentUser.id).id, me: currentUser.id };
  });

  // ── Month filter ──
  const mf = await ev(async bid => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openWorkboard(bid); await wait(600);
    const ids = () => getVisibleTasks().map(x => x.id).filter(id => /^mf-/.test(id)).sort();
    const sel = document.getElementById('ws-month'), out = { sel: !!sel, first: sel && sel.options[0].textContent, cur: ids() };
    _wsMonthSet(_rsPrevYm(_rsYm())); await wait(300);
    out.prevName = _rsMonthName(_rsPrevYm(_rsYm())); out.prev = ids(); out.meter = [...document.querySelectorAll('.ws-grp-meter')].map(m => m.textContent.replace(/\s+/g, ' ').trim())[0];
    _wsMonthSet('all'); await wait(300); out.all = ids();
    _wsMonthSet('cur'); await wait(300);
    out.counted = _retainerUsed(bid, DB.workboards.find(w => w.id === bid).retainer.services[0].groupId, _rsPrevYm(_rsYm()));
    const other = DB.workboards.find(w => !w.archived && !w.retainer && DB.tasks.some(x => (x.boardId || x.workboardId) === w.id));
    openWorkboard(other.id); await wait(500); out.otherSel = !!document.getElementById('ws-month');
    return out;
  }, fx.bid);
  t.ok(mf.sel && /This month \(1 earlier hidden\)/.test(mf.first) && JSON.stringify(mf.cur) === '["mf-now","mf-open"]', `this month shows open work and what was finished this month, and says how many are hidden (got ${JSON.stringify(mf)})`);
  t.ok(JSON.stringify(mf.prev) === '["mf-old"]' && (mf.meter || '').endsWith(' in ' + mf.prevName) && /^1 of 20 /.test(mf.meter || '') && JSON.stringify(mf.all) === '["mf-new","mf-now","mf-old","mf-open"]'.replace('"mf-new",', ''), `an earlier month shows what was finished then, with that month's figures; All shows everything (got ${JSON.stringify(mf)})`);
  t.ok(mf.counted === 1 && !mf.otherSel, 'hidden tasks still count in their month; boards that are not retained have no month filter');

  // ── Notifications open the work ──
  const nt = await ev(async (bid, staff2, me) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid), ims = b.retainer.services.find(s => s.key === 'ims'); ims.ownerId = staff2;
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    _regApply('c1', { kind: 'docs', rows: [{ name: 'GC-POL-001 - Quality Policy', code: 'GC-POL-001', title: 'Quality Policy', issueDate: day(-400), reviewMonths: 12, nextReview: day(-10), note: '' }, { name: 'GC-POL-002 - Safety Policy', code: 'GC-POL-002', title: 'Safety Policy', issueDate: day(-400), reviewMonths: 12, nextReview: day(-5), note: '' }] }, false, 'reg.xlsx');
    regAddReviewTasks('c1', DB.registerDocs.filter(d => d.clientId === 'c1').map(d => d.id));
    const n = DB.notifications.filter(x => x.recipientId === staff2).pop();
    const made = DB.tasks.filter(x => x.registerDocId).map(x => x.id).sort();
    const out = { link: n && n.link, made };
    // As the owner: the notification can be clicked and opens the board on those tasks.
    const keep = currentUser; currentUser = DB.users.find(u => u.id === staff2) || keep;
    navigate('notifications'); await wait(300);
    const row = [...document.querySelectorAll('#view-container [onclick^="notifGoLink"]')].find(r => /document revision task/.test(r.textContent));
    out.clickable = !!row; if (row) row.click(); await wait(400);
    out.board = currentWorkboard && currentWorkboard.id; out.lit = made.filter(id => { const r = document.querySelector(`tr[data-tid="${id}"]`); return r && r.classList.contains('ws-row-jump'); }).length;
    currentUser = keep;
    // An older notification, no link: found by the client named in it.
    DB.notifications.push({ id: 'n-old', recipientId: me, taskId: null, type: 'task_assigned', message: '1 document review task was added for General Cranes', read: false, createdAt: new Date().toISOString() });
    navigate('notifications'); await wait(300);
    const old = document.querySelector('#view-container [onclick="notifGoLink(\'n-old\')"]'); out.oldClickable = !!old; if (old) old.click(); await wait(300);
    out.page = !!(_regView && _regView.clientId === 'c1'); out.read = DB.notifications.find(x => x.id === 'n-old').read;
    return out;
  }, fx.bid, fx.staff2, fx.me);
  t.ok(nt.link && nt.link.kind === 'tasks' && nt.link.boardId === fx.bid && JSON.stringify(nt.link.taskIds.slice().sort()) === JSON.stringify(nt.made), `a revision task notification carries the tasks it is about (got ${JSON.stringify(nt)})`);
  t.ok(nt.clickable && nt.board === fx.bid && nt.lit === 2, `clicking it opens the board with those tasks highlighted (got ${JSON.stringify(nt)})`);
  t.ok(nt.oldClickable && nt.page && nt.read, 'an older notification without a link opens the client\'s page, found by the name in it');

  // ── Audit trail ──
  const au = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const t1 = DB.tasks.find(x => x.id === 'mf-open'), logBefore = (DB.auditLog || []).length;
    let fwd = 0; const keepF = window._auditForward; window._auditForward = e => { fwd++; };
    try {
      openTaskPanel(t1.id); await wait(300);
      tpSaveField('status', 'review'); tpSaveField('status', 'in-progress'); // changed and changed back at once: no entry
      tpSaveField('priority', 'high'); tpSaveField('percentComplete', 40); tpSaveField('percentComplete', 60);
      wsCellSave(t1.id, 'ownerId', DB.users.find(u => u.role !== 'client' && u.id !== currentUser.id).id, true);
      wsSelected = new Set([t1.id]); wsBulkSetStatus('review'); wsSelected.clear();
    } finally { window._auditForward = keepF; }
    const tr = t1.auditTrail || [], fieldsNow = tr.map(e => e.field), pctNow = (tr.find(e => e.field === 'percentComplete') || {}).to;
    openTaskPanel(t1.id); await wait(300);
    const box = document.getElementById('tp-trail-box'), items = box ? [...box.querySelectorAll('.tp-trail li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()) : [];
    tpShowTab('activity'); await wait(200);
    const act = document.querySelector('.tp-trail-tab') ? document.querySelectorAll('.tp-trail-tab .tp-trail li').length : 0;
    // Cap: 30 per task.
    for (let i = 0; i < 40; i++) _taskAudit(t1.id, i % 2 ? 'name' : 'tags', 'a' + i, 'b' + i);
    return { fields: fieldsNow, pct: pctNow, logGrew: (DB.auditLog || []).length - logBefore, fwd, items: items.slice(0, 8), act, cap: (t1.auditTrail || []).length };
  });
  t.ok(JSON.stringify(au.fields) === JSON.stringify(['priority', 'percentComplete', 'ownerId', 'status']), `status, progress, owner and the bulk change are recorded; a quick repeat is one entry; a change undone leaves none (got ${JSON.stringify(au.fields)})`);
  t.ok(au.pct === '60%' && au.logGrew === 0 && au.fwd === 7, `the entry keeps the latest value, the shared audit log is not churned, and each new entry goes to the permanent copy (got ${au.pct}, ${au.logGrew}, ${au.fwd})`);
  t.ok(au.items.some(x => /^Status: In Progress to In Review/.test(x) && /Bruna Canto/.test(x)) && au.items.some(x => /^Progress: 0% to 60%/.test(x)) && au.items.some(x => /^Created the task/.test(x)) && au.act >= 5, `the panel lists the changes newest first with who and when, and the Activity tab shows the same (got ${JSON.stringify(au.items)}, ${au.act})`);
  t.ok(au.cap === 30, `each task keeps its latest 30 changes (got ${au.cap})`);
  const sliceTr = JSON.parse(await ev(() => JSON.stringify({ users: DB.users, clients: DB.clients.map(c => Object.assign({}, c, { portalEnabled: true })), boards: DB.workboards, groups: DB.groups, tasks: DB.tasks })));
  t.ok(!JSON.stringify(P.sliceForClient(sliceTr, 'c1', 'cu1')).includes('auditTrail'), 'the audit trail never reaches the portal');

  // ── Dashboard: tabs, grouped queue, paging, clients ──
  const dash = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); _rsSet('bundle', null, 'Core'); retainerCreate(); closeGenericModal();
    const b2 = DB.workboards.find(w => w.retainer && w.clientId === 'c2' && !w.archived), g2 = b2.retainer.services[0].groupId, now = new Date().toISOString();
    for (let i = 0; i < 30; i++) DB.tasks.push({ id: 'dq' + i, name: 'Queue job ' + i, title: 'Queue job ' + i, boardId: b2.id, workboardId: b2.id, groupId: g2, clientId: 'c2', status: 'in-progress', order: 200 + i, endDate: toDateStr(new Date()), archived: false, createdAt: now, updatedAt: now });
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    _regApply('c2', { kind: 'docs', rows: [{ name: 'DT-POL-001 - Policy', code: 'DT-POL-001', title: 'Policy', issueDate: day(-400), reviewMonths: 12, nextReview: day(-3), note: '' }] }, false, 'dreg.xlsx');
    saveDB(DB);
    Object.assign(_rdQ, { client: '', level: '', owner: '', show: 'all', order: 'level', tab: 'queue', more: 25, collapsed: [], cq: '', csort: 'added' });
    _rdHome(); await wait(400);
    const q = () => ({ rows: document.querySelectorAll('#rd-queue tbody tr[data-rq]').length, groups: [...document.querySelectorAll('#rd-queue tr[data-rq-group]')].map(r => r.dataset.rqGroup), head: [...document.querySelectorAll('#rd-queue thead th')].map(th => th.textContent.trim()), more: !!document.getElementById('rq-more'), clientsHidden: document.getElementById('rd-pane-clients').hidden });
    const out = { first: q(), tabs: [...document.querySelectorAll('.rd-tab')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) };
    document.getElementById('rq-more').click(); await wait(300); out.afterMore = q();
    _rdToggleGroup('c2'); await wait(300); out.closed = q();
    _rdToggleGroup('c2'); await wait(200);
    out.attLines = [...document.querySelectorAll('.rd-att li')].map(li => li.dataset.rdAttClient || li.id);
    out.att2 = !!document.querySelector('.rd-att li[data-rd-att-client="c2"] #rd-att-regd-c2');
    document.getElementById('rd-tab-clients').click(); await wait(300);
    out.clients = { queueHidden: document.getElementById('rd-pane-queue').hidden, rows: [...document.querySelectorAll('#rd-clients tbody tr[data-rd-client]')].map(r => r.dataset.rdClient) };
    _rdQ.cq = 'dal'; renderView('retained'); await wait(200); out.search = [...document.querySelectorAll('#rd-clients tbody tr[data-rd-client]')].map(r => r.dataset.rdClient);
    Object.assign(_rdQ, { cq: '', tab: 'queue' }); renderView('retained');
    return out;
  });
  t.ok(dash.tabs.length === 2 && /^Queue/.test(dash.tabs[0]) && /^Clients 2/.test(dash.tabs[1]) && dash.first.clientsHidden, `the dashboard has Queue and Clients tabs, the queue open first (got ${JSON.stringify(dash.tabs)})`);
  t.ok(dash.first.groups.length === 2 && JSON.stringify(dash.first.head) === '["Work","Owner","Reply by","Deliver by","Status"]', `the queue is grouped by client, rows without tier or client columns (got ${JSON.stringify(dash.first)})`);
  t.ok(dash.first.rows === 25 && dash.first.more && dash.afterMore.rows > 25, `25 rows, then Show more (got ${dash.first.rows}, ${dash.afterMore.rows})`);
  t.ok(dash.closed.rows < dash.afterMore.rows && dash.closed.groups.includes('c2'), 'a client group closes from its name, keeping its heading');
  t.ok(dash.clients.queueHidden && dash.clients.rows.length === 2 && JSON.stringify(dash.search) === '["c2"]', `the Clients tab lists the clients, and search narrows them (got ${JSON.stringify(dash.clients)}, ${JSON.stringify(dash.search)})`);
  t.ok(dash.attLines.filter(x => x === 'c2').length === 1 && dash.att2, `Needs attention is one line per client (got ${JSON.stringify(dash.attLines)})`);
  const shot = await ui.shot('retained15-dashboard');
  t.eq(shot.phone, 0, 'the dashboard fits a phone');
});
