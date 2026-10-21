// Retained Services batch 9 (2026-10-21, the user's answers): business days skip WA public holidays; training renewal
// tasks are hidden from the client (the portal never lists or counts them, document reviews stay visible); the training
// matrix takes new columns typed in Task Hub, kept through the next import; nothing from the registers reaches the
// portal. The fee is covered in retained4. Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained10-test', 3271, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── WA public holidays ──
  const hol = await ev(() => {
    const h26 = [..._waHolidays(2026)].sort(), h27 = [..._waHolidays(2027)].sort();
    const due = (s, n) => _bdDue(s + 'T09:00:00', n);
    return {
      h26, h27,
      xmas: due('2026-12-24', 1), anzac: due('2026-04-24', 1), king: due('2026-09-25', 1), easter: due('2026-04-02', 1),
      onHol: due('2026-06-01', 0), plain: due('2026-10-19', 2), across: due('2026-12-23', 3),
    };
  });
  t.eq(hol.h26, ['2026-01-01', '2026-01-26', '2026-03-02', '2026-04-03', '2026-04-06', '2026-04-25', '2026-04-27', '2026-06-01', '2026-09-28', '2026-12-25', '2026-12-26', '2026-12-28'],
    'the 2026 WA holidays: Labour Day, Easter, WA Day, King\'s Birthday, and Anzac and Boxing Day on a Saturday moved to the Monday');
  t.ok(hol.h27.includes('2027-03-26') && hol.h27.includes('2027-03-29') && hol.h27.includes('2027-12-27') && hol.h27.includes('2027-12-28'),
    `2027: Easter worked out for the year; Christmas on a Saturday and Boxing Day on a Sunday move to Monday and Tuesday (got ${JSON.stringify(hol.h27)})`);
  t.eq(hol.xmas, '2026-12-29', 'one business day from Christmas Eve skips Christmas, the weekend and the Boxing Day Monday');
  t.eq(hol.anzac, '2026-04-28', 'one business day from the Friday before Anzac Day skips the Anzac Monday');
  t.eq(hol.king, '2026-09-29', 'the King\'s Birthday Monday is not a business day');
  t.eq(hol.easter, '2026-04-07', 'from the Thursday before Easter, Good Friday and Easter Monday are skipped');
  t.eq(hol.onHol, '2026-06-02', 'a clock that starts on WA Day starts the next business day');
  t.eq(hol.plain, '2026-10-21', 'an ordinary week is unchanged');
  t.eq(hol.across, '2026-12-30', 'three business days from 23 December are 24, 29 and 30 December');

  // ── Renewals hidden from the client; reviews visible ──
  const fx = await ev(() => {
    DB.clients.find(c => c.id === 'c2').portalEnabled = true;
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, true)); retainerCreate(); closeGenericModal();
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    const Pn = (ref, surname, first, quals) => ({ ref, surname, first, full: '', position: 'Cleaner', location: 'Perth', employment: 'Casual', company: '', note: '', quals });
    _regApply('c2', { kind: 'training', quals: ['White Card', 'First Aid'], rows: [
      Pn('T1', 'EXAMPLE', 'Alex', { 'White Card': { d: day(-10) }, 'First Aid': { d: day(200) } }),
      Pn('T2', 'SAMPLE', 'Jordan', { 'White Card': { d: day(400) } }),
    ] }, false, 'matrix.xlsx');
    _regApply('c2', { kind: 'docs', rows: [{ name: 'QMS-POL-001 - Quality Policy', code: 'QMS-POL-001', title: 'Quality Policy', issueDate: day(-400), reviewMonths: 12, nextReview: day(-30), note: 'Reviewer: Sam Placeholder' }] }, false, 'reg.xlsx');
    const alex = DB.registerPeople.find(p => p.surname === 'EXAMPLE' && p.clientId === 'c2'), doc = DB.registerDocs.find(d => d.code === 'QMS-POL-001' && d.clientId === 'c2');
    regAddRenewalTasks('c2', [alex.id]); regAddReviewTasks('c2', [doc.id]);
    const rn = DB.tasks.find(x => x.registerPersonId === alex.id), rv = DB.tasks.find(x => x.registerDocId === doc.id);
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c2' && !w.archived), mob = b.retainer.services.find(s => s.key === 'mob').groupId;
    const now = new Date().toISOString();
    rn.status = 'done'; rn.completedAt = now; rv.status = 'done'; rv.completedAt = now; saveDB(DB);
    const blob = { users: DB.users, clients: DB.clients, boards: DB.workboards, groups: DB.groups, tasks: DB.tasks, registerDocs: DB.registerDocs, registerPeople: DB.registerPeople, registerComments: DB.registerComments || [], registers: DB.registers, proFormaInvoices: [{ id: 'pf-x', clientId: 'c2', feeLines: [{ id: 'fl-x', amount: 7777, label: 'Fixed fee' }] }] };
    return { rn: { id: rn.id, hidden: rn.clientHidden, local: _cpTaskHidden(rn) }, rv: { id: rv.id, hidden: !!rv.clientHidden, local: _cpTaskHidden(rv) }, staffUsed: _retainerUsed(b.id, mob, _rsYm()), bid: b.id, mob, blob: JSON.stringify(blob), alex: alex.id };
  });
  t.ok(fx.rn.hidden === true && fx.rn.local, 'a renewal task is made hidden from the client');
  t.ok(!fx.rv.hidden && !fx.rv.local, 'a document review task stays visible to the client');
  const blob = JSON.parse(fx.blob);
  const slice = P.sliceForClient(blob, 'c2', 'cu2'), sj = JSON.stringify(slice);
  const ids = (slice.tasks || []).map(x => x.id);
  t.ok(!ids.includes(fx.rn.id) && ids.includes(fx.rv.id), `the portal slice lists the review and not the renewal (got ${ids.length} tasks)`);
  t.ok(!/EXAMPLE|SAMPLE|White Card|Reviewer: Sam|registerPeople|registerDocs|registerComments|"registers"|7777|feeLines/.test(sj), 'the portal slice carries no register, person, comment or fee');
  const mobSvc = ((slice.boards || []).find(b => b.id === fx.bid) || {}).retainer;
  const used = mobSvc && mobSvc.services.find(s => s.key === 'mob').used;
  t.ok(used === 0 && fx.staffUsed === 0, `a hidden renewal never uses the client's allowance, in the portal or for staff (got ${used}, ${fx.staffUsed})`);

  // ── New training columns ──
  const col = await ev(() => {
    const out = {};
    out.ok = regAddQualColumn('c2', '  Confined   Space Entry ');
    out.dupe = regAddQualColumn('c2', 'confined space entry'); out.sheetDupe = regAddQualColumn('c2', 'first aid');
    out.blank = regAddQualColumn('c2', '   '); out.proto = regAddQualColumn('c2', '__proto__');
    const keep = currentUser.role; currentUser.role = 'client'; out.client = regAddQualColumn('c2', 'Forklift'); currentUser.role = keep;
    out.meta = DB.registers.find(r => r.clientId === 'c2').training;
    openRegisters('c2', 'training'); _regSet('mode', 'matrix');
    out.th = [...document.querySelectorAll('#reg-matrix thead th')].map(th => th.textContent.trim());
    out.empty = document.querySelectorAll('#reg-matrix button.reg-c.empty[data-q="Confined Space Entry"]').length;
    out.btn = !!document.getElementById('reg-add-col');
    return out;
  });
  t.ok(col.ok && col.meta.added.length === 1 && col.meta.added[0] === 'Confined Space Entry' && col.meta.quals.includes('Confined Space Entry'), `a column is added with its spaces tidied (got ${JSON.stringify(col.meta)})`);
  t.ok(!col.dupe && !col.sheetDupe && !col.blank && !col.proto, 'a name already in the matrix, in any case, a blank name or a reserved word is refused');
  t.ok(!col.client, 'a client cannot add a column');
  t.ok(col.btn && col.th.some(h => /Confined Space Entry/.test(h)) && col.empty === 2, `the matrix shows the new column, empty, with an Add button for each person (got ${JSON.stringify(col.th)}, ${col.empty})`);
  const dlg = await ev(() => {
    document.getElementById('reg-add-col').click();
    const name = document.getElementById('reg-col-name'), out = { open: !!name };
    name.value = 'Forklift Licence'; document.getElementById('reg-col-save').click();
    out.closed = document.getElementById('generic-modal').classList.contains('hidden');
    out.th = [...document.querySelectorAll('#reg-matrix thead th')].map(th => th.textContent.trim());
    document.getElementById('reg-add-col').click(); document.getElementById('reg-col-name').value = 'FORKLIFT LICENCE'; document.getElementById('reg-col-save').click();
    out.stillOpen = !document.getElementById('generic-modal').classList.contains('hidden'); closeGenericModal();
    return out;
  });
  t.ok(dlg.open && dlg.closed && dlg.th.some(h => /Forklift Licence/.test(h)), 'the + Training column dialog adds a column to the matrix');
  t.ok(dlg.stillOpen, 'a repeated name keeps the dialog open');

  // Records: from the empty cell, the panel's date, cleared again; a bad date is refused.
  const rec = await ev(id => {
    const p = DB.registerPeople.find(x => x.id === id), out = {};
    document.querySelector(`#reg-matrix tr button.reg-c.empty[data-q="Confined Space Entry"][aria-label*="EXAMPLE"]`).click();
    out.drawer = !!document.getElementById('reg-drawer');
    const sel = document.getElementById('reg-rec-q'); out.pre = sel && sel.value;
    document.getElementById('reg-rec-d').value = '2027-05-01'; document.querySelector('.reg-add-rec button').click();
    out.added = (p.quals['Confined Space Entry'] || {}).d;
    const inp = document.querySelector('#reg-drawer .reg-qd[data-q="First Aid"]'); inp.value = '2028-01-31'; inp.dispatchEvent(new Event('change'));
    out.changed = p.quals['First Aid'].d;
    out.bad = regSetQual(id, 'First Aid', '31/31/2028'); out.afterBad = p.quals['First Aid'].d;
    out.uk = regSetQual(id, 'Forklift Licence', '15/03/2027') && p.quals['Forklift Licence'].d;
    regSetQual(id, 'Forklift Licence', ''); out.cleared = !('Forklift Licence' in p.quals);
    _regDrawerClose(); _regSet('mode', 'matrix');
    out.cell = !!document.querySelector('#reg-matrix button.reg-c.empty[data-q="Confined Space Entry"][aria-label*="EXAMPLE"]');
    return out;
  }, fx.alex);
  t.ok(rec.drawer && rec.pre === 'Confined Space Entry' && rec.added === '2027-05-01', `an empty cell opens the person with that training picked, and a date adds the record (got ${JSON.stringify(rec)})`);
  t.ok(rec.changed === '2028-01-31' && rec.afterBad === '2028-01-31' && !rec.bad, 'a date changed in the panel saves; an impossible date is refused and changes nothing');
  t.ok(rec.uk === '2027-03-15' && rec.cleared, 'a day-first date is read as such, and an empty date clears the record');
  t.ok(!rec.cell, 'the matrix cell is filled');

  // Re-import the same sheet: its own columns come from the sheet again; columns added here keep their records.
  const re = await ev(id => {
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    const Pn = (ref, surname, first, quals) => ({ ref, surname, first, full: '', position: 'Cleaner', location: 'Perth', employment: 'Casual', company: '', note: '', quals });
    const r = _regApply('c2', { kind: 'training', quals: ['White Card', 'First Aid'], rows: [
      Pn('T1', 'EXAMPLE', 'Alex', { 'White Card': { d: day(300) }, 'First Aid': { d: day(200) } }),
      Pn('T2', 'SAMPLE', 'Jordan', { 'White Card': { d: day(400) } }),
    ] }, false, 'matrix v2.xlsx');
    const p = DB.registerPeople.find(x => x.id === id), meta = DB.registers.find(x => x.clientId === 'c2').training;
    const out = { r, cse: (p.quals['Confined Space Entry'] || {}).d, fa: p.quals['First Aid'].d, faWant: day(200), meta };
    // A later sheet that has the column itself takes it over.
    _regApply('c2', { kind: 'training', quals: ['White Card', 'First Aid', 'Confined Space Entry'], rows: [
      Pn('T1', 'EXAMPLE', 'Alex', { 'White Card': { d: day(300) }, 'First Aid': { d: day(200) }, 'Confined Space Entry': { d: '2029-02-02' } }),
    ] }, false, 'matrix v3.xlsx');
    out.cse3 = p.quals['Confined Space Entry'].d; out.added3 = DB.registers.find(x => x.clientId === 'c2').training.added;
    openRegisters('c2', 'training'); _regSet('mode', 'matrix');
    out.th = [...document.querySelectorAll('#reg-matrix thead th')].map(th => th.textContent.trim());
    return out;
  }, fx.alex);
  t.ok(re.cse === '2027-05-01', `a re-import keeps the record in a column added here (got ${re.cse})`);
  t.ok(re.fa === re.faWant, 'a sheet column takes the sheet\'s date again');
  t.ok(re.meta.added.includes('Confined Space Entry') && re.meta.added.includes('Forklift Licence') && re.meta.quals.includes('Forklift Licence'), `the added columns stay on the matrix after the import, even an empty one (got ${JSON.stringify(re.meta)})`);
  t.ok(re.cse3 === '2029-02-02' && !re.added3.includes('Confined Space Entry') && re.added3.includes('Forklift Licence'), `once the sheet has the column, the sheet owns it (got ${re.cse3}, ${JSON.stringify(re.added3)})`);
  t.ok(re.th.filter(h => /Confined Space Entry/.test(h)).length === 1, 'the column shows once');

  const shot = await ui.shot('retained10-matrix');
  t.eq(shot.phone, 0, 'the matrix with its new columns fits a phone');
});
