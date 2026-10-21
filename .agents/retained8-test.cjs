// Retained Services, batch 5 (2026-10-21, the user's review): no + on the sidebar section; leaving a retained board goes
// back to Retained Services (the client's page when it was opened from there); allowances drawn as squares like the
// client portal, on the dashboard, the client's page and each service group's title row (no progress bar or percentage
// there); a page per client (Overview, Document register, Training matrix); due documents suggested as review tasks in
// IMS and Document Control, linked to their document and counted as document reviews when done. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained8-test', 3269, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── Sidebar: no + ──
  const side = await ev(() => ({ plus: !!document.getElementById('retained-add-btn'), header: !!document.getElementById('nav-retained-header'), dash: !!document.getElementById('nav-retained-dash') }));
  t.ok(!side.plus && side.header && side.dash, 'the Retained Services section has its Dashboard row and no + of its own');

  // ── Squares ──
  const sq = await ev(() => {
    const el = h => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
    const a = el(_rsSquares(4, 20, '#1d6fb8')), b = el(_rsSquares(23, 20, '#1d6fb8'));
    return { n: a.querySelectorAll('i').length, on: a.querySelectorAll('i.on').length, nb: b.querySelectorAll('i').length, onb: b.querySelectorAll('i.on').length, x: b.querySelectorAll('i.x').length, big: _rsSquares(5, 70, '#000'), colour: a.style.getPropertyValue('--sq-c') };
  });
  t.ok(sq.n === 20 && sq.on === 4 && sq.colour === '#1d6fb8', 'one square per unit of allowance, filled as used, in the service colour');
  t.ok(sq.nb === 23 && sq.onb === 20 && sq.x === 3, 'use beyond the allowance follows as outlined squares');
  t.eq(sq.big, '', 'an allowance too big for squares leaves the words to say it');

  // ── Fixture: Daltech on an Embedded retainer, General Cranes on HSEQ only ──
  const fx = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, true)); retainerCreate(); closeGenericModal();
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, s.key === 'hseq')); retainerCreate(); closeGenericModal();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c2'), ims = b.retainer.services.find(s => s.key === 'ims'), now = new Date().toISOString();
    for (let i = 0; i < 4; i++) DB.tasks.push({ id: 'r8-u' + i, name: 'Done ' + i, title: 'Done ' + i, clientId: 'c2', boardId: b.id, workboardId: b.id, groupId: ims.groupId, parentTaskId: null, status: 'done', completedAt: now, archived: false, createdAt: now, updatedAt: now });
    DB.clientWorkRequests.push({ id: 'r8-req', clientId: 'c2', title: 'Update the induction pack', description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: now, updatedAt: now, status: 'pending', adminNote: null, attachments: [] });
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    const row = (code, title, issue, months, next) => ({ name: code + ' - ' + title, code, title, issueDate: issue, reviewMonths: months, nextReview: next, note: '' });
    _regApply('c2', { kind: 'docs', rows: [row('HR-POL-001', 'Performance Management Policy', day(-400), 12, day(-36)), row('WHSE-POL-004', 'Drug and Alcohol Policy', day(-380), 12, day(-20)),
      row('WHSE-PRO-001', 'Return to Work Procedure', day(-340), 12, day(20)), row('WHSE-PRO-004', 'Risk Management Procedure', day(-30), 24, day(700))] }, false, 'Daltech register.xlsx');
    _regApply('c1', { kind: 'docs', rows: [row('QMS-POL-001', 'Quality Policy', day(-400), 12, day(-35))] }, false, 'GC register.xlsx');
    saveDB(DB);
    return { board: b.id, ims: ims.groupId, owner: ims.ownerId, gc: DB.workboards.find(w => w.retainer && w.clientId === 'c1').id, day20: day(20), today: toDateStr(new Date()) };
  });

  // ── Board: squares in the service group's title row, no progress bar or percentage there ──
  await ev(b => openWorkboard(b), fx.board); await t.sleep(900);
  const hdr = await ev(g => {
    const row = document.querySelector(`tr.ws-grp-hdr[data-gid="${g}"]`);
    return row ? { sq: row.querySelectorAll('.ws-grp-meter .rs-sq i').length, on: row.querySelectorAll('.ws-grp-meter .rs-sq i.on').length, pct: !!row.querySelector('.ws-grp-pct'), bar: !!row.querySelector('.ws-grp-bar'), text: row.querySelector('.ws-grp-meter').textContent, back: document.querySelector('.ws-tabstrip button').textContent.trim() } : null;
  }, fx.ims);
  t.ok(hdr && hdr.sq === 20 && hdr.on === 4 && /4 of 20 document reviews used in/.test(hdr.text), `the service group shows its allowance as squares and words (got ${JSON.stringify(hdr)})`);
  t.ok(hdr && !hdr.pct && !hdr.bar, 'and no generic progress bar or percentage');
  t.eq(hdr && hdr.back, 'Retained Services', 'the back button on a retained board says Retained Services');
  const shotBoard = await ui.shot('retained8-board');
  t.eq(shotBoard.phone, 0, 'the board with squares fits a phone');

  // ── Back: from the sidebar to the dashboard; from the client's page back to that page; other boards as before ──
  const back1 = await ev(() => { exitWorkboard(); return { view: currentView, page: !!document.querySelector('.rc-grid'), dash: !!document.getElementById('rd-queue') }; });
  t.ok(back1.view === 'retained' && back1.dash && !back1.page, 'leaving a retained board opened from the sidebar goes to the Retained Services dashboard');
  const back2 = await ev(() => { openRetainedClient('c2'); document.getElementById('rc-board').click(); const inBoard = currentView === 'workspace' && !!currentWorkboard; document.querySelector('.ws-tabstrip button').click(); return { inBoard, view: currentView, page: !!document.querySelector('.rc-grid'), name: (document.querySelector('.rc-id .reg-h') || {}).textContent }; });
  t.ok(back2.inBoard && back2.view === 'retained' && back2.page && back2.name === 'Daltech', 'opened from the client\'s page, it goes back to that page');
  const back3 = await ev(() => { const other = DB.workboards.find(w => !w.retainer && !w.archived && !_isPersonalBoard(w)); openWorkboard(other.id); const label = document.querySelector('.ws-tabstrip button').textContent.trim(); exitWorkboard(); return { label, view: currentView }; });
  t.ok(back3.label === 'Boards' && back3.view === 'dashboard', 'any other board still goes back to Boards');

  // ── The client's page ──
  await ev(() => _rdHome()); await t.sleep(300);
  const open = await ev(() => { document.querySelector('[data-rd-open="c2"]').click(); return { tab: _regView && _regView.tab, page: !!document.querySelector('.rc-grid') }; });
  t.ok(open.tab === 'overview' && open.page, 'the client\'s name on the dashboard opens its page, on the Overview');
  const ov = await ev(() => {
    const svc = document.querySelector('[data-rc-svc="ims"]');
    return { tabs: [...document.querySelectorAll('.reg-tab')].map(b => b.textContent.replace(/\d+/g, '').trim()), sq: svc ? svc.querySelectorAll('.rs-sq i').length : 0, on: svc ? svc.querySelectorAll('.rs-sq i.on').length : 0,
      work: (document.getElementById('rc-queue') || {}).textContent || '', sugg: (document.getElementById('rc-sugg') || {}).textContent || '', facts: document.querySelector('.rc-facts').textContent, acts: [...document.querySelectorAll('.reg-top .reg-acts button')].map(b => b.textContent) };
  });
  t.eq(ov.tabs, ['Overview', 'Document register', 'Training matrix'], 'the page has Overview, Document register and Training matrix');
  t.ok(ov.sq === 20 && ov.on === 4, 'the month shows each service as squares');
  t.ok(/Update the induction pack/.test(ov.work), 'its requests and work are listed');
  t.ok(/Embedded bundle/.test(ov.facts) && JSON.stringify(ov.acts) === '["Plan","Board","Month report"]', 'the header carries the level, bundle and lead, with Plan, Board and Month report');
  t.ok(/3 documents are due for review with no task yet/.test(ov.sugg), `three documents (two overdue, one due within 30 days) are suggested as review tasks (got "${ov.sugg.trim().slice(0, 90)}")`);
  const shotOv = await ui.shot('retained8-client');
  t.eq(shotOv.phone, 0, 'the client\'s page fits a phone');

  // ── Review tasks ──
  const add = await ev(fx => {
    document.getElementById('rc-add-tasks').click();
    const ts = DB.tasks.filter(x => x.registerDocId && x.clientId === 'c2' && !x.archived);
    const by = code => { const d = DB.registerDocs.find(x => x.code === code && x.clientId === 'c2'); return ts.find(x => x.registerDocId === d.id); };
    const again = regAddReviewTasks('c2', DB.registerDocs.filter(d => d.clientId === 'c2').map(d => d.id));
    return { n: ts.length, again, groups: [...new Set(ts.map(x => x.groupId))], owner: [...new Set(ts.map(x => x.ownerId))], over: by('HR-POL-001'), soon: by('WHSE-PRO-001'), sugg: !!document.getElementById('rc-add-tasks') };
  }, fx);
  t.ok(add.n === 3 && add.groups.length === 1 && add.groups[0] === fx.ims && add.owner.length === 1 && add.owner[0] === fx.owner, 'one review task per due document, in IMS and Document Control, for its owner');
  t.ok(add.over && add.over.endDate === fx.today && /Review HR-POL-001 Performance Management Policy/.test(add.over.name) && add.soon && add.soon.endDate === fx.day20, 'an overdue review is due today; one due soon keeps its review date');
  t.eq(add.again, 0, 'a document with a task gets no second one');
  t.ok(!add.sugg, 'with every due review in hand, the suggestion goes');
  const reg = await ev(() => {
    _regSet('tab', 'docs');
    const cell = code => { const d = DB.registerDocs.find(x => x.code === code && x.clientId === 'c2'); const tr = document.querySelector(`#reg-docs tr[data-reg-doc="${d.id}"] .reg-tk`); return tr ? tr.textContent.trim() : null; };
    return { over: cell('HR-POL-001'), cur: cell('WHSE-PRO-004') };
  });
  t.ok(/Not Started, due/.test(reg.over || '') && reg.cur === '', `the register shows each document's review task (got ${JSON.stringify(reg)})`);
  const done = await ev(fx => {
    const d = DB.registerDocs.find(x => x.code === 'HR-POL-001' && x.clientId === 'c2'), task = DB.tasks.find(x => x.registerDocId === d.id);
    const before = _retainerUsed(fx.board, fx.ims, _rsYm());
    task.status = 'done'; task.completedAt = new Date().toISOString(); saveDB(DB); renderView('retained');
    const after = _retainerUsed(fx.board, fx.ims, _rsYm());
    const cell = document.querySelector(`#reg-docs tr[data-reg-doc="${d.id}"] .reg-tk`).textContent.trim();
    _regOpenDoc(d.id); const panel = document.getElementById('reg-drawer').textContent.replace(/\s+/g, ' '); _regDrawerClose();
    return { before, after, cell, panel, inHand: _regDocInHand(d) };
  }, fx);
  t.ok(done.after === done.before + 1, 'a finished review counts as a document review');
  t.ok(/Reviewed .*update the register/.test(done.cell) && /Review tasks*Reviewed/.test(done.panel) && done.inHand, 'the register says it was reviewed and the register needs updating');
  const reissue = await ev(() => {
    const day = n => { const x = new Date(); x.setDate(x.getDate() + n); return toDateStr(x); };
    _regApply('c2', { kind: 'docs', rows: [{ name: 'HR-POL-001 - Performance Management Policy', code: 'HR-POL-001', title: 'Performance Management Policy', issueDate: day(0), reviewMonths: 12, nextReview: day(365), note: '' }] }, false, 'Daltech register v2.xlsx');
    const d = DB.registerDocs.find(x => x.code === 'HR-POL-001' && x.clientId === 'c2');
    return { state: _regDocState(d).k, need: _regNeedsTask(d, _regToday()) };
  });
  t.ok(reissue.state === 'ok' && !reissue.need, 'once the reissued register is imported, the document is current');

  // ── Without IMS on the plan: the suggestion says so and offers no button ──
  const gc = await ev(() => { openRetainedClient('c1'); return { sugg: (document.getElementById('rc-sugg') || {}).textContent || '', btn: !!document.getElementById('rc-add-tasks'), n: regAddReviewTasks('c1', DB.registerDocs.filter(d => d.clientId === 'c1').map(d => d.id)) }; });
  t.ok(/Add IMS and Document Control to the plan/.test(gc.sugg) && !gc.btn && gc.n === 0, 'a client without IMS and Document Control is told how to turn reviews into tasks, and none are made');

  // ── Dashboard: the warning and the Registers column follow the tasks ──
  const dash = await ev(() => { _rdHome(); renderView('retained'); return { d2: !!document.getElementById('rd-att-regd-c2'), d1: (document.getElementById('rd-att-regd-c1') || {}).textContent || '', col2: (document.querySelector('#rd-clients tr[data-rd-client="c2"] .rd-c-reg') || {}).textContent || '' }; });
  t.ok(!dash.d2 && /1 document is due for review with no task yet \(1 overdue\)/.test(dash.d1), 'the dashboard flags only documents with no review task');
  t.ok(/Documents: (up to date|reviews in hand)/.test(dash.col2), `the Clients sheet says Daltech's reviews are in hand (got "${dash.col2}")`);
});
