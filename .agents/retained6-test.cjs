// Retained Services, next features batch 3 (2026-10-21): the month-end report, a PDF per retained client from the month
// review figures (delivered, requests, overdue at month end, allowances used, focus, the lead's note). Made for the
// client: never hours, rates or fees. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained6-test', 3266, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  const fx = await ev(() => {
    const now = new Date(), iso = d => d.toISOString(), pm = _rsPrevYm(_rsYm()), day = n => new Date(pm + '-' + String(n).padStart(2, '0') + 'T10:00:00');
    DB.workboards.push({ id: 'mr-b', name: 'General Cranes', clientId: 'c1', visibility: 'all_internal', archived: false, createdAt: iso(now), updatedAt: iso(now),
      retainer: { services: [{ key: 'ims', groupId: 'mr-g1', unit: 'document reviews', allowance: 20, core: true }, { key: 'mob', groupId: 'mr-g2', unit: 'compliance checks', allowance: 15, core: false }],
        leadId: 'u1', startMonth: _rsPrevYm(_rsPrevYm(pm)), priority: 'Priority+', months: {}, endedAt: null, fees: [{ from: '2020-01', amount: 7777 }] } });
    DB.groups.push({ id: 'mr-g1', boardId: 'mr-b', workboardId: 'mr-b', clientId: 'c1', name: 'IMS', order: 0 }, { id: 'mr-g2', boardId: 'mr-b', workboardId: 'mr-b', clientId: 'c1', name: 'Mob', order: 1 });
    const T = (id, g, o) => DB.tasks.push(Object.assign({ id, name: id, title: id, clientId: 'c1', boardId: 'mr-b', workboardId: 'mr-b', groupId: g, parentTaskId: null, status: 'todo', archived: false, createdAt: iso(day(1)), updatedAt: iso(now) }, o || {}));
    T('Induction pack', 'mr-g1', { status: 'done', completedAt: iso(day(4)) });
    T('Insurance check', 'mr-g2', { status: 'done', completedAt: iso(day(9)) });
    T('Secret internal job', 'mr-g1', { status: 'done', completedAt: iso(day(10)), clientHidden: true });
    T('Done this month', 'mr-g1', { status: 'done', completedAt: iso(now) });
    T('Late open job', 'mr-g1', { endDate: pm + '-20' });
    T('Late but finished in time', 'mr-g1', { endDate: pm + '-20', status: 'done', completedAt: iso(day(19)) });
    T('Finished after month end', 'mr-g1', { endDate: pm + '-21', status: 'done', completedAt: iso(now) });
    T('Focus job', 'mr-g1', { percentComplete: 40 });
    const R = (id, d, o) => DB.clientWorkRequests.push(Object.assign({ id, clientId: 'c1', title: id, description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: iso(d), updatedAt: iso(now), status: 'pending', adminNote: null, attachments: [] }, o || {}));
    R('Crane lift SWMS', day(3), { status: 'scoped', linkedItemId: 'Induction pack', linkedItemType: 'task' });
    R('Starter pack', day(12), { status: 'reviewing' });
    R('ISO quote', day(15), { status: 'declined' });
    R('This month ask', now);
    R('Other client ask', day(5), { clientId: 'c2' });
    DB.workboards.find(b => b.id === 'mr-b').retainer.months[pm] = { focusTaskIds: ['Focus job'], note: 'Procedures are nearly through. Next month: contractor pre-qualification.' };
    DB.timeEntries.push({ id: 'mr-te', staffId: 'u1', taskId: 'Induction pack', clientId: 'c1', date: pm + '-04', hours: 6.5, billable: true, status: 'approved', createdAt: iso(now) });
    saveDB(DB);
    return { pm };
  });

  const d = await ev(pm => {
    const b = DB.workboards.find(x => x.id === 'mr-b'), d = _mrData(b, pm);
    return { delivered: d.delivered.map(x => x.name), requests: d.requests.map(x => [x.title, x.state]), overdue: d.overdue, used: d.services.map(s => s.used), focus: d.focus, note: d.note, months: _mrMonths(b), level: d.level, lead: d.lead };
  }, fx.pm);
  t.eq(d.delivered, ['Induction pack', 'Insurance check', 'Late but finished in time'], 'delivered: the client-visible work finished in that month, in order; hidden work and other months stay out');
  t.eq(d.requests, [['Crane lift SWMS', 'Delivered'], ['Starter pack', 'Being reviewed'], ['ISO quote', 'Declined']], 'requests: this client\'s, received that month, with where each stands');
  t.eq(d.overdue, 2, 'overdue at month end: due in the month and still open when it closed (finished later counts, finished in time does not)');
  t.eq(d.used, [2, 1], 'allowances used that month, client-visible work only');
  t.ok(d.focus.length === 1 && d.focus[0].name === 'Focus job' && /40%/.test(d.focus[0].state) && /Procedures are nearly through/.test(d.note), 'the focus and the lead\'s note for that month');
  t.ok(d.months.length === 4 && d.months[1] === fx.pm, `months offered: from the start month to now, newest first (got ${JSON.stringify(d.months)})`);

  // The dialog
  const dlg = await ev(() => {
    openMonthReport('mr-b');
    const sel = document.getElementById('mr-month'), pv = () => document.getElementById('mr-preview').textContent.replace(/\s+/g, ' ');
    const out = { title: document.getElementById('generic-modal-title').textContent, month: sel.value, pv: pv() };
    _mrShow(_rsYm()); out.pv2 = pv(); return out;
  });
  t.ok(dlg.title === 'Month-end report' && dlg.month === fx.pm && /3 delivered, 3 requests received, 2 overdue at month end/.test(dlg.pv), `the dialog opens on last month with its figures (got "${dlg.pv}")`);
  t.ok(/2 delivered, 1 request received, 1 overdue at month end/.test(dlg.pv2), `another month shows that month (got "${dlg.pv2}")`);
  const shot = await ui.shot('retained6-dialog');
  t.eq(shot.phone, 0, 'the dialog fits a phone');

  // The PDF itself, caught as the blob jsPDF hands to the download.
  const pdf = await ev(pm => new Promise(res => {
    document.getElementById('mr-month').value = pm;
    _ensureJsPdf(() => {
      const keep = URL.createObjectURL; let blob = null;
      URL.createObjectURL = b => { if (b && /pdf/.test(b.type || '')) blob = b; return keep.call(URL, b); };
      downloadMonthReport();
      const wait = (n) => { if (blob || n > 40) { URL.createObjectURL = keep; (blob ? blob.text().then(s => res({ s, size: blob.size })) : res({ s: '', size: 0 })); } else setTimeout(() => wait(n + 1), 150); };
      wait(0);
    });
  }), fx.pm);
  const s = pdf.s;
  t.ok(s.startsWith('%PDF') && /General Cranes/.test(s) && /Month-end report/.test(s), 'a PDF comes out, named for the client');
  t.ok(/Induction pack/.test(s) && /Starter pack/.test(s) && /Procedures are nearly through/.test(s) && /Overdue at month end/.test(s), 'it carries the delivered work, the requests, the figures and the note');
  t.ok(!/Secret internal job/.test(s), 'hidden work never reaches the client\'s report');
  // Only the text the PDF draws (jsPDF writes it as "(...) Tj"); the logo's compressed bytes can hold any character.
  const text = [...s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(m => m[1]).join(' ');
  t.ok(text.length > 200 && /Induction pack/.test(text), 'the drawn text was read');
  t.ok(!/\$|7777|7,777|6\.5|hours|rate/i.test(text), `no fee, hours or rates anywhere in it (got "${(text.match(/.{0,30}(\$|7777|7,777|6\.5|hours|rate).{0,30}/i) || [''])[0]}")`);
  t.ok(pdf.size > 0 && pdf.size < 150000, `the file is small enough to email (got ${pdf.size} bytes)`);

  // Clients never make one.
  const cl = await ev(() => {
    const keep = Object.assign({}, currentUser); closeGenericModal();
    currentUser.role = 'client'; currentUser.clientId = 'c1';
    openMonthReport('mr-b'); const open = !document.getElementById('generic-modal').classList.contains('hidden');
    Object.keys(currentUser).forEach(k => delete currentUser[k]); Object.assign(currentUser, keep); return open;
  });
  t.eq(cl, false, 'a client cannot open the report maker');
});
