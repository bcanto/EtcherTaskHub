// Retained Services batch 12 (2026-10-23, fixes from the audit): request files reach the portal by name only and
// requests by whitelist; the Retained tab's request form survives the portal refresh; a plan change applies from this
// month and earlier months keep the plan they had (services and senior consultants); an hour that fits no part counts
// nowhere and the hours log says so; Client approved keeps its finish month and rework clears it; this month keeps a
// parent finished earlier while a subitem counts; the request hint knows quarterly hours; the portal lists this month's
// work, counts delivered the staff way, and shows a request as Delivered with its work; Show late clears the filters and
// opens the queue, and a filter whose choice has gone is cleared; the plan window keeps an unsaved note.
// Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained16-test', 3278, async (t) => {
  // ── Server ──
  {
    const now = new Date(), ym = now.toISOString().slice(0, 7);
    const prev = (() => { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
    const big = 'data:application/pdf;base64,' + 'A'.repeat(4000);
    const blob = {
      users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin', active: true }, { id: 'u2', name: 'Sam Wignall', role: 'staff', active: true }],
      clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }],
      boards: [{ id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u1', startMonth: '2026-01', seniorIds: [], seniorHist: [{ until: prev, ids: ['u2'] }], months: {}, services: [
        { key: 'ims', groupId: 'g1', unit: 'document revisions', allowance: 20, mode: 'hours', parts: [{ label: 'Hours', hours: 10, period: 'month', who: 'all' }], hist: [{ until: prev, mode: 'items', allowance: 20, unit: 'document revisions', parts: null }] },
        { key: 'ci', groupId: 'g2', unit: 'hours', allowance: 11, mode: 'hours', parts: [{ label: 'Senior consult', hours: 3, period: 'month', who: 'senior' }] },   // senior only: an hour by anyone else counts nowhere
        { key: 'hseq', groupId: 'g3', unit: 'hours', allowance: 8, mode: 'hours', parts: [{ label: 'Audits', hours: 8, period: 'month', who: 'audit' }] },
      ] } }],
      groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS' }, { id: 'g2', boardId: 'rb', clientId: 'c1', name: 'CI' }, { id: 'g3', boardId: 'rb', clientId: 'c1', name: 'HSEQ' }],
      tasks: [
        { id: 't-prev', boardId: 'rb', groupId: 'g1', clientId: 'c1', name: 'Rev', status: 'done', completedAt: prev + '-10T04:00:00Z' },
        { id: 't-ci', boardId: 'rb', groupId: 'g2', clientId: 'c1', name: 'CI work', status: 'in-progress' },
        { id: 't-hs', boardId: 'rb', groupId: 'g3', clientId: 'c1', name: 'HSEQ work', status: 'in-progress' },
        { id: 't-hid', boardId: 'rb', groupId: 'g1', clientId: 'c1', name: 'Hidden', status: 'done', clientHidden: true },
        { id: 't-ok', boardId: 'rb', groupId: 'g1', clientId: 'c1', name: 'Scoped work', status: 'done', completedAt: now.toISOString() },
        { id: 't-ap', boardId: 'rb', groupId: 'g1', clientId: 'c1', name: 'Approve me', status: 'ready-approval', currentlyWithType: 'client', percentComplete: 60 },
      ],
      timeEntries: [
        { id: 'e1', taskId: 't-ci', staffId: 'u2', hours: 2, date: prev + '-12', status: 'approved' },
        { id: 'e2', taskId: 't-hs', staffId: 'u1', hours: 3, date: ym + '-01', status: 'approved' },
      ],
      clientWorkRequests: [
        { id: 'wr1', clientId: 'c1', title: 'Files', status: 'pending', submittedAt: now.toISOString(), attachments: [{ name: 'plan.pdf', type: 'application/pdf', size: 3000, data: big }], respondedBy: 'u1' },
        { id: 'wr2', clientId: 'c1', title: 'Scoped', status: 'scoped', submittedAt: now.toISOString(), linkedItemType: 'task', linkedItemId: 't-ok', linkedBoardId: 'rb', respondedBy: 'u1' },
        { id: 'wr3', clientId: 'c1', title: 'Hidden one', status: 'scoped', submittedAt: now.toISOString(), linkedItemType: 'task', linkedItemId: 't-hid' },
      ],
      notifications: [], actionRequests: [], taskFiles: [],
    };
    const sl = P.sliceForClient(blob, 'c1', 'cu1'), text = JSON.stringify(sl.clientWorkRequests);
    const w1 = sl.clientWorkRequests.find(r => r.id === 'wr1'), w2 = sl.clientWorkRequests.find(r => r.id === 'wr2'), w3 = sl.clientWorkRequests.find(r => r.id === 'wr3');
    t.ok(w1.attachments.length === 1 && w1.attachments[0].name === 'plan.pdf' && !('data' in w1.attachments[0]) && !text.includes('AAAA'), `request files reach the portal by name, never their data (got ${JSON.stringify(w1.attachments)})`);
    t.ok(!/respondedBy|linkedItemId|linkedBoardId|u1/.test(text) && w2.taskId === 't-ok' && !('taskId' in w3), `requests carry no staff ids or internal links; the task they became only when the client can see it (got ${text.slice(0, 300)})`);
    const rt = sl.boards[0].retainer, hp = rt.history.find(h => h.month === prev), ims = hp.services.find(s => s.key === 'ims'), ci = hp.services.find(s => s.key === 'ci');
    t.ok(ims.used === 1 && ims.unit === null && rt.services.find(s => s.key === 'ims').mode === 'hours', `a month before a plan change is counted with the plan it had: last month IMS by items (got ${JSON.stringify(hp)})`);
    t.ok(ci.used === '2', `last month's senior hours count by last month's senior consultants (got ${JSON.stringify(ci)})`);
    const ciNow = rt.services.find(s => s.key === 'ci').parts, hsNow = rt.services.find(s => s.key === 'hseq').parts;
    t.ok(hsNow[0].used === 0 && ciNow.every(p => p.used === 0), `an hour on untagged work counts nowhere on an Audit-only service (got ${JSON.stringify(hsNow)})`);
    // Client approval keeps the date it got there.
    const res = P.applyPortalAction(blob, { clientId: 'c1', userId: 'cu1', userName: 'Client Person', now: now.toISOString(), rid: () => 'x' }, { type: 'approve', taskId: 't-ap' });
    const ap = blob.tasks.find(x => x.id === 't-ap');
    t.ok(res.ok && ap.status === 'approved-client' && ap.clientApprovedAt === now.toISOString() && ap.percentComplete === 60, `a portal approval stamps when it was approved and leaves progress alone (got ${JSON.stringify(ap)})`);
  }

  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const fx = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Ops'); retainerCreate(); closeGenericModal();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived), r = b.retainer, ym = _rsYm(), prev = _rsPrevYm(ym);
    r.startMonth = _rsPrevYm(_rsPrevYm(prev));
    const s0 = r.services[0], s1 = r.services[1], at = prev + '-10T12:00:00', now = new Date().toISOString();
    const mk = (id, o) => { const x = Object.assign({ id, name: id, title: id, boardId: b.id, workboardId: b.id, groupId: s0.groupId, clientId: 'c1', status: 'todo', order: 90, archived: false, createdAt: at, updatedAt: at }, o); DB.tasks.push(x); return x; };
    mk('h-prev', { status: 'done', completedAt: new Date(at).toISOString(), percentComplete: 100 });
    mk('h-par', { status: 'done', completedAt: new Date(at).toISOString() });
    mk('h-sub', { parentTaskId: 'h-par', status: 'done', completedAt: now });
    mk('h-old', { status: 'done', completedAt: new Date(at).toISOString(), groupId: s1.groupId });
    mk('h-cur', { status: 'in-progress', groupId: s1.groupId });
    saveDB(DB);
    const staff2 = _rsStaff().find(u => u.id !== currentUser.id).id;
    return { bid: b.id, k0: s0.key, k1: s1.key, g0: s0.groupId, g1: s1.groupId, ym, prev, staff2, me: currentUser.id };
  });

  // ── Plan history ──
  const ph = await ev((bid, k0, prev, ym) => {
    const b = DB.workboards.find(w => w.id === bid), s = () => b.retainer.services.find(x => x.key === k0);
    const before = _rsUsage(b, s(), prev).parts[0].used;
    _rsPlanSet(bid, 'mode', k0, 'hours'); _rsPlanSet(bid, 'mode', k0, 'items'); _rsPlanSet(bid, 'mode', k0, 'hours');
    const after = _rsUsage(b, s(), prev), cur = _rsUsage(b, s(), ym);
    _rsPlanSet(bid, 'allowance', k0, '3');
    const out = { before, prevMode: after.mode, prevUsed: after.parts[0].used, curMode: cur.mode, hist: (s().hist || []).map(h => h.until + ':' + h.mode + ':' + h.allowance) };
    closeGenericModal(); return out;
  }, fx.bid, fx.k0, fx.prev, fx.ym);
  t.ok(ph.before === 1 && ph.prevMode === 'items' && ph.prevUsed === 1 && ph.curMode === 'hours', `switching a service to hours leaves last month counted by items (got ${JSON.stringify(ph)})`);
  t.ok(ph.hist.length === 1 && ph.hist[0].startsWith(fx.prev + ':items:'), `the plan before this month is kept once, however many changes this month (got ${JSON.stringify(ph.hist)})`);

  const sh = await ev((bid, k1, prev, ym, staff2) => {
    const b = DB.workboards.find(w => w.id === bid), r = b.retainer, s = r.services.find(x => x.key === k1);
    s.mode = 'hours'; s.parts = [{ id: 'pa', label: 'Admin', hours: 8, period: 'month', who: 'admin' }, { id: 'ps', label: 'Senior consult', hours: 3, period: 'month', who: 'senior' }];
    r.seniorIds = [staff2]; delete s.hist; delete r.seniorHist;
    DB.timeEntries = DB.timeEntries || [];
    DB.timeEntries.push({ id: 'te-s1', taskId: 'h-old', staffId: staff2, hours: 2, date: prev + '-11', status: 'approved' });
    const was = _rsUsage(b, s, prev).parts.map(p => p.used).join('/');
    _rsPlanSet(bid, 'senior', staff2, false);
    const now = _rsUsage(b, s, prev).parts.map(p => p.used).join('/');
    openRetainerPlan(bid); const warn = !!document.getElementById('rs-pl-nosenior'); closeGenericModal();
    return { was, now, warn, ids: r.seniorIds.length };
  }, fx.bid, fx.k1, fx.prev, fx.ym, fx.staff2);
  t.ok(sh.was === '0/2' && sh.now === '0/2' && sh.ids === 0, `unticking a senior consultant leaves last month's senior hours where they were (got ${JSON.stringify(sh)})`);
  t.ok(sh.warn, 'with no senior consultant ticked the plan says every hour counts to Admin');

  // ── An hour that fits no part ──
  const nc = await ev(async (bid, k1, ym, me) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid), s = b.retainer.services.find(x => x.key === k1);
    s.parts = [{ id: 'pq', label: 'Audits', hours: 8, period: 'month', who: 'audit' }];
    DB.timeEntries.push({ id: 'te-nc', taskId: 'h-cur', staffId: me, hours: 1.5, date: ym + '-01', status: 'approved' });
    const used = _rsUsage(b, s, ym).parts[0].used;
    openRetainedClient('c1'); await wait(400);
    const row = document.querySelector('tr[data-rc-hour="te-nc"]');
    return { used, row: row ? row.textContent.replace(/\s+/g, ' ') : null };
  }, fx.bid, fx.k1, fx.ym, fx.me);
  t.ok(nc.used === 0 && /Not counted/.test(nc.row || ''), `an untagged hour on an Audit-only service counts nowhere and the hours log says so (got ${JSON.stringify(nc)})`);

  // ── Finish dates ──
  const fd = await ev((bid, prev) => {
    const at = new Date(prev + '-10T12:00:00').toISOString(), t = DB.tasks.find(x => x.id === 'h-prev');
    const set = s => { const w = t.status; t.status = s; _applyStatusProgress(t, s, w); };
    set('approved-client'); const a = { at: t.completedAt, pct: t.percentComplete, ym: _rsDoneYm(t) };
    set('done'); const d = { at: t.completedAt };
    const n = DB.tasks.find(x => x.id === 'h-cur'); const w = n.status; n.status = 'approved-client'; _applyStatusProgress(n, 'approved-client', w);
    const nym = _rsDoneYm(n); n.status = 'in-progress'; _applyStatusProgress(n, 'in-progress', 'approved-client');
    // Rework from the approvals list clears the finish date.
    incomingApprovalAction('h-prev', 'in-progress');
    return { a, d, at, nym, cleared: !n.clientApprovedAt && !n.completedAt, rework: t.completedAt, trail: (t.auditTrail || []).some(e => e.field === 'status') };
  }, fx.bid, fx.prev);
  t.ok(fd.a.at === fd.at && fd.a.pct === 100 && fd.a.ym === fx.prev && fd.d.at === fd.at, `Client approved keeps a finished task's month and progress, and Completed after it keeps that date (got ${JSON.stringify(fd)})`);
  t.ok(fd.nym === fx.ym && fd.cleared, `Client approved from in progress counts this month, and going back to work clears it (got ${JSON.stringify(fd)})`);
  t.ok(fd.rework === null && fd.trail, `rework from the approvals list clears the finish date and goes in the audit trail (got ${JSON.stringify(fd)})`);

  // ── This month keeps a parent while its subitem counts ──
  const mf = await ev(async bid => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openWorkboard(bid); await wait(500); _wsMonthSet('cur'); await wait(300);
    return getVisibleTasks().map(x => x.id).filter(id => /^h-(par|sub)$/.test(id)).sort();
  }, fx.bid);
  t.ok(JSON.stringify(mf) === '["h-par","h-sub"]', `this month shows a parent finished last month with a subitem finished this month (got ${JSON.stringify(mf)})`);

  // ── The request hint knows quarterly hours ──
  const hint = await ev((bid, k1, g1) => {
    const s = DB.workboards.find(w => w.id === bid).retainer.services.find(x => x.key === k1);
    s.parts = [{ id: 'pq', label: 'Audits', hours: 8, period: 'quarter', who: 'all' }];
    return _cpServiceHint('c1', 'g:' + g1);
  }, fx.bid, fx.k1, fx.g1);
  t.ok(/^Covered by your retainer: [\d.]+ of 8 hours left this quarter\.$/.test(hint), `a quarterly-only service tells the client the quarter's hours left (got "${hint}")`);

  // ── Dashboard: Show late, stale filters ──
  const dq = await ev(async (bid) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const y = new Date(); y.setDate(y.getDate() - 3);
    const b = DB.workboards.find(w => w.id === bid);
    DB.tasks.push({ id: 'h-late', name: 'Late job', title: 'Late job', boardId: bid, workboardId: bid, groupId: b.retainer.services[0].groupId, clientId: 'c1', status: 'in-progress', endDate: toDateStr(y), ownerId: currentUser.id, order: 97, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    saveDB(DB);
    _regView = null; Object.assign(_rdQ, { tab: 'clients', client: 'c1', owner: 'nobody-left', level: '' });
    navigate('retained'); await wait(400);
    const owner = _rdQ.owner;
    document.getElementById('rd-cell-late').click(); await wait(300);
    return { owner, tab: _rdQ.tab, client: _rdQ.client, show: _rdQ.show, paneHidden: document.getElementById('rd-pane-queue').hidden, late: !!document.querySelector('tr[data-rq="task:h-late"]') };
  }, fx.bid);
  t.ok(dq.owner === '', `an owner filter whose person has no open work is cleared (got ${JSON.stringify(dq)})`);
  t.ok(dq.tab === 'queue' && !dq.paneHidden && dq.client === '' && dq.show === 'late' && dq.late, `the late count opens the queue on late work with the filters cleared, even from the Clients tab (got ${JSON.stringify(dq)})`);

  // ── The plan window keeps an unsaved note ──
  const pn = await ev((bid, k0, staff2) => {
    openRetainerPlan(bid);
    document.getElementById('rs-pl-note').value = 'Draft for the review';
    _rsPlanSet(bid, 'owner', k0, staff2);
    const kept = document.getElementById('rs-pl-note').value;
    _rsPlanSet(bid, 'note', null, 'Saved note');
    const saved = document.getElementById('rs-pl-note').value;
    closeGenericModal();
    return { kept, saved };
  }, fx.bid, fx.k0, fx.staff2);
  t.ok(pn.kept === 'Draft for the review' && pn.saved === 'Saved note', `the plan window keeps a note not saved yet when something else changes (got ${JSON.stringify(pn)})`);
  // ── Portal: this month's work, delivered, requests ──
  const po = await ev(async (bid, g1, prev) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const pAt = new Date(prev + '-14T12:00:00').toISOString();
    DB.tasks.push({ id: 'h-appr', name: 'h-appr', title: 'h-appr', boardId: bid, workboardId: bid, groupId: g1, clientId: 'c1', status: 'completed-approved', completedAt: null, clientApproval: { status: 'approved', at: pAt }, order: 95, archived: false, createdAt: pAt, updatedAt: new Date().toISOString() });
    DB.tasks.push({ id: 'h-req', name: 'h-req', title: 'Request work', boardId: bid, workboardId: bid, groupId: g1, clientId: 'c1', status: 'done', completedAt: new Date().toISOString(), order: 96, archived: false, createdAt: pAt, updatedAt: pAt });
    DB.clientWorkRequests = (DB.clientWorkRequests || []).concat([
      { id: 'wq1', clientId: 'c1', title: 'Became work', status: 'scoped', submittedAt: new Date().toISOString(), linkedItemType: 'task', linkedItemId: 'h-req' },
      { id: 'wq2', clientId: 'c1', title: 'Not for us', status: 'declined', adminNote: 'Outside the retainer', submittedAt: new Date().toISOString() },
      { id: 'wq3', clientId: 'c1', title: 'With names', status: 'pending', submittedAt: new Date().toISOString(), attachments: [{ name: 'only-name.pdf', type: 'application/pdf', size: 10 }] },
    ]);
    saveDB(DB);
    const keepUser = Object.assign({}, currentUser);
    currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; DB.clients.find(c => c.id === 'c1').portalEnabled = true;
    launchClientView(); await wait(800); cpNavigate('retained'); await wait(500);
    const svcText = [...document.querySelectorAll('.cp-rt-svc')].map(x => x.textContent.replace(/\s+/g, ' '));
    const out = { svc: svcText, review: (document.querySelector('.cp-rt-review') || {}).textContent || '', jobs: [...document.querySelectorAll('.cp-rt-row .cp-rt-t')].map(x => x.textContent), older: [...document.querySelectorAll('.cp-rt-older')].map(x => x.textContent.trim()) };
    // The Retained tab's form survives the refresh; an empty one is redrawn.
    const stub = () => { _portalServerMode = () => true; _portalLoad = async () => { _portalServerMode = () => false; }; };
    stub(); _startPortalRefresh(); _portalServerMode = () => false;
    document.getElementById('cp-req-title').value = 'Half written'; if (document.activeElement) document.activeElement.blur(); stub();
    window.dispatchEvent(new Event('focus')); await wait(300);
    out.kept = (document.getElementById('cp-req-title') || {}).value;
    document.getElementById('cp-req-title').value = ''; document.querySelector('.cp-rt').dataset.mark = '1'; stub();
    window.dispatchEvent(new Event('focus')); await wait(300);
    out.redrawn = !document.querySelector('.cp-rt[data-mark]');
    _cpReqFiles = [{ name: 'x', size: 1 }]; cpNavigate('overview'); await wait(200); cpNavigate('retained'); await wait(300); out.files = _cpReqFiles.length;
    _portalServerMode = () => false;
    cpNavigate('requests'); await wait(400);
    const card = id => [...document.querySelectorAll('.cp-req-card')].find(c => c.textContent.includes(id));
    const c1 = card('Became work'), c2 = card('Not for us'), c3 = card('With names');
    out.c1 = c1 ? { badge: c1.querySelector('.cp-badge').textContent, open: !!c1.querySelector('.cp-req-open[data-req-task="h-req"]') } : null;
    out.c2 = c2 ? { note: (c2.querySelector('.cp-req-note.dec') || {}).textContent || '' } : null;
    out.c3 = c3 ? { a: c3.querySelectorAll('a[download]').length, span: [...c3.querySelectorAll('span[title]')].some(s => s.textContent.includes('only-name.pdf')) } : null;
    currentUser = keepUser;
    return out;
  }, fx.bid, fx.g1, fx.prev);
  t.ok(!po.jobs.some(j => j.startsWith('h-old')) && po.jobs.some(j => j.startsWith('Request work')) && po.older.some(x => /^2 finished before \w+$/.test(x)), `the portal's services list this month's work and say how many finished earlier (got ${JSON.stringify(po.jobs)} ${JSON.stringify(po.older)})`);
  t.ok(/(^|\D)3 delivered/.test(po.review.replace(/\s+/g, ' ')), `the month in review counts delivered the way staff count it, approval dates included (got "${po.review.replace(/\s+/g, ' ')}")`);
  t.ok(po.kept === 'Half written' && po.redrawn, `the refresh leaves a half-written request alone and redraws an empty form (got ${JSON.stringify({ kept: po.kept, redrawn: po.redrawn })})`);
  t.ok(po.files === 0, 'files picked for a form no longer on show never go with the next request');
  t.ok(po.c1 && po.c1.badge === 'Delivered' && po.c1.open, `a request whose work is finished says Delivered and opens the work (got ${JSON.stringify(po.c1)})`);
  t.ok(po.c2 && /Why we declined/.test(po.c2.note) && po.c3 && po.c3.a === 0 && po.c3.span, `a decline reads as one, and files sent by name show without a download (got ${JSON.stringify([po.c2, po.c3])})`);

});
