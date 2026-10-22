// Retained Services batch 8 (2026-10-21): training renewals as work, and the month-end report's document control and
// training section. One renewal task per person (what needs renewing, due on the first expiry) in Mobilisation and
// Contractor Compliance, else HSEQ; the dashboard flags only people with no task; the report counts, never names,
// people. Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained9-test', 3270, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const fx = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, true)); retainerCreate(); closeGenericModal();
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, s.key === 'hseq')); retainerCreate(); closeGenericModal();
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    const P = (ref, surname, first, quals) => ({ ref, surname, first, full: '', position: 'Cleaner', location: 'Perth', employment: 'Casual', company: '', note: '', quals });
    _regApply('c2', { kind: 'training', quals: ['White Card', 'First Aid', 'Working at Heights'], rows: [
      P('T1', 'EXAMPLE', 'Alex', { 'White Card': { d: day(-10) }, 'First Aid': { d: day(12) }, 'Working at Heights': { d: day(300) } }),
      P('T2', 'SAMPLE', 'Jordan', { 'First Aid': { d: day(20) } }),
      P('T3', 'DEMO', 'Casey', { 'White Card': { d: day(400) } }),
    ] }, false, 'matrix.xlsx');
    _regApply('c1', { kind: 'training', quals: ['White Card'], rows: [P('G1', 'TEST', 'Riley', { 'White Card': { d: day(-3) } })] }, false, 'gc matrix.xlsx');
    _regApply('c2', { kind: 'docs', rows: [{ name: 'QMS-POL-001 - Quality Policy', code: 'QMS-POL-001', title: 'Quality Policy', issueDate: day(-400), reviewMonths: 12, nextReview: day(-30), note: '' },
      { name: 'QMS-POL-002 - Complaints Policy', code: 'QMS-POL-002', title: 'Complaints Policy', issueDate: day(-10), reviewMonths: 12, nextReview: day(355), note: '' }] }, false, 'reg.xlsx');
    saveDB(DB);
    const b2 = DB.workboards.find(w => w.retainer && w.clientId === 'c2'), b1 = DB.workboards.find(w => w.retainer && w.clientId === 'c1');
    return { b2: b2.id, mob: b2.retainer.services.find(s => s.key === 'mob').groupId, b1: b1.id, hseq1: b1.retainer.services.find(s => s.key === 'hseq').groupId, today: toDateStr(new Date()), d20: day(20) };
  });

  // Suggestion on the client's Overview, and on the dashboard.
  const ov = await ev(() => { _rdHome(); const att = (document.getElementById('rd-att-regt-c2') || {}).textContent || ''; openRetainedClient('c2'); return { att, sugg: (document.getElementById('rc-sugg-trn') || {}).textContent || '', btn: !!document.getElementById('rc-add-renewals') }; });
  t.ok(/2 people have training expired or expiring with no renewal task yet \(1 with expired training\)/.test(ov.att), `the dashboard flags people with no renewal task (got "${ov.att.trim()}")`);
  t.ok(/2 people have training expired or expiring with no renewal task yet/.test(ov.sugg) && ov.btn, 'the Overview suggests renewal tasks, one click');

  const add = await ev(fx => {
    document.getElementById('rc-add-renewals').click();
    const ts = DB.tasks.filter(x => x.registerPersonId && x.clientId === 'c2' && !x.archived);
    const by = s => { const p = DB.registerPeople.find(x => x.surname === s && x.clientId === 'c2'); return ts.find(x => x.registerPersonId === p.id); };
    const again = regAddRenewalTasks('c2', DB.registerPeople.filter(p => p.clientId === 'c2').map(p => p.id));
    return { n: ts.length, groups: [...new Set(ts.map(x => x.groupId))], alex: by('EXAMPLE'), jordan: by('SAMPLE'), casey: by('DEMO'), again, sugg: !!document.getElementById('rc-add-renewals') };
  }, fx);
  t.ok(add.n === 2 && add.groups.length === 1 && add.groups[0] === fx.mob, 'one renewal task per person who needs one, in Mobilisation and Contractor Compliance');
  t.ok(add.alex && /Renew tickets: Alex EXAMPLE \(White Card, First Aid\)/.test(add.alex.name) && add.alex.endDate === fx.today && JSON.stringify(add.alex.registerQuals) === '["White Card","First Aid"]', `the task lists what needs renewing, expired first, due today when something has expired (got "${add.alex && add.alex.name}")`);
  t.ok(add.jordan && add.jordan.endDate === fx.d20, 'when nothing has expired yet, it is due on the first expiry');
  t.ok(!add.casey && add.again === 0 && !add.sugg, 'nobody current gets one, nobody gets two, and the suggestion goes');
  const cell = await ev(() => { const p = DB.registerPeople.find(x => x.surname === 'EXAMPLE' && x.clientId === 'c2'); _regOpenPerson(p.id, ''); const txt = document.getElementById('reg-drawer').textContent.replace(/\s+/g, ' '); _regDrawerClose(); return txt; });
  t.ok(/Renewal task: Not Started, due/.test(cell), 'the person\'s panel shows the renewal task');
  const done = await ev(() => {
    const p = DB.registerPeople.find(x => x.surname === 'EXAMPLE' && x.clientId === 'c2'), task = DB.tasks.find(x => x.registerPersonId === p.id);
    task.status = 'done'; task.completedAt = new Date().toISOString(); saveDB(DB);
    return { inHand: _regPersonInHand(p), needs: _regPersonNeedsTask(p, _regToday()), cell: _regRenewCell(p, _regTrnTarget('c2')) };
  });
  t.ok(done.inHand && !done.needs && /Renewed .*update the matrix/.test(done.cell), 'a finished renewal is in hand until the matrix is imported again');
  const hseq = await ev(() => { const n = regAddRenewalTasks('c1', DB.registerPeople.filter(p => p.clientId === 'c1').map(p => p.id)); const tk = DB.tasks.find(x => x.registerPersonId && x.clientId === 'c1'); return { n, group: tk && tk.groupId }; });
  t.ok(hseq.n === 1 && hseq.group === fx.hseq1, 'with no Mobilisation on the plan, renewals go to HSEQ');

  // Month-end report: document control and training, people counted not named.
  const rep = await ev(fx => new Promise(res => {
    const d = DB.registerDocs.find(x => x.code === 'QMS-POL-001' && x.clientId === 'c2');
    regAddReviewTasks('c2', [d.id]); const rt = DB.tasks.find(x => x.registerDocId === d.id); rt.status = 'done'; rt.completedAt = new Date().toISOString(); saveDB(DB);
    const b = DB.workboards.find(w => w.id === fx.b2), data = _mrData(b, _rsYm());
    _ensureJsPdf(() => { const doc = _mrPdf(data, null), s = doc.output(); res({ regs: data.regs, text: [...s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(m => m[1]).join(' ') }); });
  }), fx);
  t.ok(rep.regs && rep.regs.reviewed.length === 1 && rep.regs.renewed === 1 && rep.regs.docs === 2 && rep.regs.people === 3, `the report counts this month's reviews and renewals (got ${JSON.stringify(rep.regs && { r: rep.regs.reviewed.length, n: rep.regs.renewed })})`);
  t.ok(/Document control and training/.test(rep.text) && /1 document revision completed in/.test(rep.text) && /QMS-POL-001 Quality Policy/.test(rep.text) && /1 training renewal completed in/.test(rep.text), 'the PDF has the section, with the reviewed document named');
  const sect = (rep.text.split('Document control and training')[1] || '').split('From your retainer lead')[0];
  t.ok(sect && /across 3 people/.test(sect) && !/EXAMPLE|SAMPLE|DEMO|Alex|Jordan|Casey/.test(sect.split('Document revised')[0]), 'the section counts people and names none (finished renewal tasks still show under Delivered, as the client\'s own work)');
  const shot = await ui.shot('retained9-client');
  t.eq(shot.phone, 0, 'the client\'s page with renewals fits a phone');
});
