// Retained Services, next features batch 1 (2026-10-21): five service levels kept on the retainer only, the bundle the
// services make with a suggested level, the fixed monthly fee typed per client (staff only, never in the portal),
// the first-reply stamp on requests, and the fee on the pro forma invoice. Retained hours stay off the hourly pro forma.
// Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained4-test', 3264, async (t) => {
  // ── The portal slice never carries the fee (no browser) ──
  const blob = {
    users: [{ id: 'u1', name: 'Bruna Canto', role: 'admin' }], clients: [{ id: 'c1', name: 'General Cranes', portalEnabled: true }],
    boards: [{ id: 'rb', clientId: 'c1', name: 'General Cranes', retainer: { leadId: 'u1', startMonth: '2026-01', priority: 'Priority+', fees: [{ from: '2026-01', amount: 4321.5 }], services: [{ key: 'ims', groupId: 'g1', unit: 'document reviews', allowance: 20, core: true }], months: {} } }],
    groups: [{ id: 'g1', boardId: 'rb', clientId: 'c1', name: 'IMS' }], tasks: [],
  };
  const slice = JSON.stringify(P.sliceForClient(blob, 'c1', 'cu1'));
  t.ok(!/fees|4321/.test(slice) && /Priority\+/.test(slice), 'the portal slice carries the level but never the fee');

  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── Levels and bundles ──
  const lv = await ev(() => ({
    names: RETAINER_LEVELS.map(l => l.key),
    b: [['ims'], ['mob'], ['ims', 'hseq'], ['ims', 'mob'], ['ims', 'mob', 'ci'], ['ims', 'hseq', 'mob', 'ci', 'sys'], ['ims', 'hseq', 'mob'], ['mob', 'ci']].map(k => [_rsBundleName(k), _rsSuggestedLevel(k)]),
    lines: RETAINER_LEVELS.map(l => _rsLevelLine(l.key)),
  }));
  t.eq(lv.names, ['Standard', 'Priority', 'Priority+', 'High', 'Highest'], 'five service levels, Standard to Highest');
  t.eq(lv.b, [['Light', 'Standard'], ['Light', 'Standard'], ['Core', 'Priority'], ['Ops', 'Priority+'], ['Plus', 'High'], ['Embedded', 'Highest'], [null, null], [null, null]],
    'each bundle (Light, Core, Ops, Plus, Embedded) suggests its level; a mix that is no bundle suggests nothing');
  t.ok(/within 2 business days.*within 5 business days/.test(lv.lines[0]) && /same business day.*1 to 2 business days/.test(lv.lines[2]) && /accelerated/.test(lv.lines[3]) && /priority queue, surge support/.test(lv.lines[4]),
    `each level says what it promises (got ${JSON.stringify(lv.lines)})`);

  // ── Set-up: the level follows the services until the admin picks one; the fee is typed ──
  const labelsBefore = await ev(() => JSON.stringify(Object.keys((DB.labelConfig || {}).priorities || {})) + '|' + (typeof getPrioMeta === 'function' ? getPrioMeta('high').label : ''));
  await ev(() => { openRetainerSetup(); _rsSet('clientId', null, 'c1'); }); await t.sleep(300);
  const su1 = await ev(() => ({ level: document.getElementById('rs-su-level').value, opts: [...document.querySelectorAll('#rs-su-level option')].map(o => o.value), note: document.getElementById('rs-su-lvlnote').textContent, fee: !!document.getElementById('rs-su-fee') }));
  t.ok(su1.level === 'Priority' && su1.opts.length === 5 && /Core bundle/.test(su1.note) && su1.fee, `set-up opens on two core services, the Core bundle, so Priority (got ${su1.level}, "${su1.note}")`);
  const su2 = await ev(() => { _rsSet('on', 'hseq', false); _rsSet('on', 'mob', true); return { level: document.getElementById('rs-su-level').value, note: document.getElementById('rs-su-lvlnote').textContent }; });
  t.ok(su2.level === 'Priority+' && /Ops bundle/.test(su2.note), `one core and one add-on is the Ops bundle, so the level follows to Priority+ (got ${su2.level})`);
  const su3 = await ev(() => { _rsSet('on', 'hseq', true); return { level: document.getElementById('rs-su-level').value, note: document.getElementById('rs-su-lvlnote').textContent }; });
  t.ok(su3.level === 'Priority+' && /Custom mix/.test(su3.note), `two core and one add-on is no bundle: the level stays and the note says custom mix (got ${su3.level}, "${su3.note}")`);
  const su4 = await ev(() => {
    _rsSet('priority', null, 'Standard'); _rsSet('on', 'hseq', false);
    const lvl = document.getElementById('rs-su-level').value, use = document.querySelector('#rs-su-lvlnote [data-rs-use]');
    const offered = use ? use.dataset.rsUse : null; if (use) use.click();
    return { lvl, offered, after: document.getElementById('rs-su-level').value };
  });
  t.ok(su4.lvl === 'Standard' && su4.offered === 'Priority+' && su4.after === 'Priority+', `a level the admin picked stays when services change, with the suggestion one click away (got ${JSON.stringify(su4)})`);
  t.ok(await ev(() => { _rsSet('priority', null, 'Urgent'); return _rsSetup.priority === 'Priority+'; }), 'an unknown level is refused');
  const shotSu = await ui.shot('retained4-setup');
  t.eq(shotSu.phone, 0, 'the set-up with its level and fee fits a phone');
  const made = await ev(() => {
    _rsSet('fee', null, '4,500'); retainerCreate();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived);
    return { id: b.id, level: b.retainer.priority, fees: b.retainer.fees, start: b.retainer.startMonth, taskPrios: [...new Set(DB.tasks.filter(x => x.boardId === b.id).map(x => x.priority))] };
  });
  t.ok(made.level === 'Priority+' && made.fees.length === 1 && made.fees[0].amount === 4500 && made.fees[0].from === made.start, `the board keeps the level and the fee from its start month (got ${JSON.stringify(made.fees)})`);
  t.eq(made.taskPrios, ['med'], 'the monthly tasks keep the ordinary task priority: the level never crosses onto task labels');
  const labelsAfter = await ev(() => JSON.stringify(Object.keys((DB.labelConfig || {}).priorities || {})) + '|' + (typeof getPrioMeta === 'function' ? getPrioMeta('high').label : ''));
  t.eq(labelsAfter, labelsBefore, 'the task priority labels are untouched');

  // ── Plan panel: level, suggestion, fee from this month, who sees what ──
  const bid = made.id;
  const plan = await ev(b => {
    const w = DB.workboards.find(x => x.id === b), ym = _rsYm(), p1 = _rsPrevYm(ym), p3 = _rsPrevYm(_rsPrevYm(p1));
    w.retainer.startMonth = p3; w.retainer.fees = [{ from: p3, amount: 4000 }]; saveDB(DB);
    openRetainerPlan(b);
    const sel = document.getElementById('rs-pl-level'), fee = document.getElementById('rs-pl-fee');
    const out = { opts: sel ? sel.options.length : 0, fee: fee ? fee.value : null, note: document.getElementById('rs-pl-lvlnote').textContent };
    _rsPlanSet(b, 'fee', null, '4500');
    out.prev = _rsFeeFor(w.retainer, p1); out.now = _rsFeeFor(w.retainer, ym); out.old = _rsFeeFor(w.retainer, p3);
    out.since = (document.querySelector('#rs-pl-fee') || {}).closest ? document.querySelector('#rs-pl-fee').closest('.rs-su-f').textContent : '';
    _rsPlanSet(b, 'priority', null, 'Highest'); out.lvl = w.retainer.priority;
    _rsPlanSet(b, 'priority', null, 'Urgent'); out.lvl2 = w.retainer.priority;
    return out;
  }, bid);
  t.ok(plan.opts === 5 && plan.fee === '4000' && /Ops bundle/.test(plan.note), `the plan shows the five levels, the bundle and the fee (got ${JSON.stringify(plan)})`);
  t.ok(plan.prev === 4000 && plan.old === 4000 && plan.now === 4500 && /Was \$4,000\.00 before/.test(plan.since), `a fee change applies from this month; earlier months keep their fee (got ${plan.prev}, ${plan.now}, "${plan.since}")`);
  t.ok(plan.lvl === 'Highest' && plan.lvl2 === 'Highest', 'an admin changes the level in the plan; an unknown level is refused');
  const sugg = await ev(b => { _rsPlanSet(b, 'priority', null, 'Standard'); const u = document.querySelector('#rs-pl-lvlnote [data-rs-use]'); const o = u ? u.dataset.rsUse : null; if (u) u.click(); return { o, lvl: DB.workboards.find(x => x.id === b).retainer.priority }; }, bid);
  t.ok(sugg.o === 'Priority+' && sugg.lvl === 'Priority+', `the plan offers the bundle's level when it differs, one click (got ${JSON.stringify(sugg)})`);
  const shotPl = await ui.shot('retained4-plan');
  t.eq(shotPl.phone, 0, 'the plan with level and fee fits a phone');
  const roles = await ev(b => {
    const keep = currentUser.role, out = {};
    currentUser.role = 'staff'; currentUser.billing = true; openRetainerPlan(b);
    out.bill = { input: !!document.getElementById('rs-pl-fee'), text: document.querySelector('.rs-pl-grid').textContent.replace(/\s+/g, ' ') };
    _rsPlanSet(b, 'fee', null, '1'); _rsPlanSet(b, 'priority', null, 'Standard');
    currentUser.billing = false; openRetainerPlan(b);
    out.staff = document.querySelector('.rs-pl-grid').textContent.replace(/\s+/g, ' ');
    const w = DB.workboards.find(x => x.id === b); out.fee = _rsFeeFor(w.retainer, _rsYm()); out.lvl = w.retainer.priority;
    currentUser.role = keep; delete currentUser.billing; closeGenericModal(); return out;
  }, bid);
  t.ok(!roles.bill.input && /\$4,500\.00/.test(roles.bill.text), `billing staff see the fee, read only (got "${roles.bill.text}")`);
  t.ok(!/\$/.test(roles.staff) && /Fixed monthly fee/.test(roles.staff), `other staff see "Fixed monthly fee" and no amount (got "${roles.staff}")`);
  t.ok(roles.fee === 4500 && roles.lvl === 'Priority+', 'staff who are not admins cannot change the fee or the level');
  t.ok(await ev(b => !/4500|fees/.test(JSON.stringify(_rsClientRetainer(DB.workboards.find(x => x.id === b)))), bid), 'the local portal view of the retainer has no fee either');

  // ── Requests: first reply or action stamps respondedAt once ──
  const rq = await ev(() => {
    const now = new Date().toISOString();
    DB.clientWorkRequests.push({ id: 'wr4a', clientId: 'c1', title: 'Update SWMS', description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: now, updatedAt: now, status: 'pending', adminNote: null, attachments: [] });
    DB.clientWorkRequests.push({ id: 'wr4b', clientId: 'c1', title: 'Check register', description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: now, updatedAt: now, status: 'pending', adminNote: null, attachments: [] });
    const a = DB.clientWorkRequests.find(r => r.id === 'wr4a'), b = DB.clientWorkRequests.find(r => r.id === 'wr4b');
    const before = !!a.respondedAt;
    wrUpdateStatus('wr4a', 'reviewing', null); const first = a.respondedAt, by = a.respondedBy;
    a.respondedAt = '2026-01-01T00:00:00.000Z'; wrUpdateStatus('wr4a', 'scoped', null); const kept = a.respondedAt;
    wrUpdateStatus('wr4b', null, 'We will look at it today'); const note = !!b.respondedAt;
    return { before, first: !!first, by, kept, note };
  });
  t.ok(!rq.before && rq.first && rq.by === 'u1', 'a status change stamps the first reply, and who made it');
  t.eq(rq.kept, '2026-01-01T00:00:00.000Z', 'a later action never moves the first-reply time');
  t.ok(rq.note, 'a note to the client counts as a reply');

  // ── Pro forma: retained hours stay off; the fee comes in per month, once ──
  const pf = await ev(b => {
    const w = DB.workboards.find(x => x.id === b), g = w.retainer.services[0].groupId, ym = _rsYm(), p1 = _rsPrevYm(ym), now = new Date().toISOString();
    const other = DB.workboards.find(x => x.clientId === 'c1' && !x.retainer && !x.archived) || (() => { const o = { id: 'pf4-ob', name: 'GC Tracker', clientId: 'c1', visibility: 'all_internal', archived: false, createdAt: now, updatedAt: now }; DB.workboards.push(o); DB.groups.push({ id: 'pf4-og', boardId: o.id, workboardId: o.id, clientId: 'c1', name: 'Main', order: 0 }); return o; })();
    const og = (DB.groups.find(x => (x.boardId || x.workboardId) === other.id) || {}).id;
    DB.tasks.push({ id: 'pf4-rt', name: 'Retained job', title: 'Retained job', boardId: b, workboardId: b, groupId: g, clientId: 'c1', status: 'todo', archived: false, createdAt: now, updatedAt: now });
    DB.tasks.push({ id: 'pf4-ot', name: 'Hourly job', title: 'Hourly job', boardId: other.id, workboardId: other.id, groupId: og, clientId: 'c1', status: 'todo', archived: false, createdAt: now, updatedAt: now });
    const day = p1 + '-10';
    DB.timeEntries.push({ id: 'pf4-te-r', staffId: 'u1', taskId: 'pf4-rt', clientId: 'c1', date: day, hours: 3, billable: true, status: 'approved', createdAt: now });
    DB.timeEntries.push({ id: 'pf4-te-o', staffId: 'u1', taskId: 'pf4-ot', clientId: 'c1', date: day, hours: 2, billable: true, status: 'approved', createdAt: now });
    saveDB(DB);
    rptTab = 'invoice'; navigate('reports'); pfiCreate();
    const inv = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    inv.clientId = 'c1'; inv.dateFrom = p1 + '-01'; inv.dateTo = ym + '-28'; saveDB(DB);
    pfiImportEntries(inv.id);
    const modal = document.getElementById('generic-modal-body');
    const fees = [...modal.querySelectorAll('.pfi-import-fee')].map(c => ({ v: c.value, on: c.checked }));
    const entries = [...modal.querySelectorAll('.pfi-import-cb')].map(c => c.value);
    const note = (document.getElementById('pfi-import-retnote') || {}).textContent || '';
    pfiConfirmImport(inv.id);
    return { inv: inv.id, fees, entries, note, lines: inv.lineItems.map(l => l.timeEntryId), feeLines: (inv.feeLines || []).map(f => [f.month, f.amount]), p1, ym, total: pfiCalcTotals(inv).feeTotal };
  }, bid);
  t.ok(pf.fees.length === 2 && pf.fees.every(f => f.on), `the import offers the fee for each month of the period, ticked (got ${JSON.stringify(pf.fees)})`);
  t.ok(pf.entries.includes('pf4-te-o') && !pf.entries.includes('pf4-te-r'), `the retained board's hours are not offered, the hourly job is (got ${JSON.stringify(pf.entries)})`);
  t.ok(/on the retained board, covered by the fixed fee/.test(pf.note), `the import says why the retained hours are missing (got "${pf.note}")`);
  t.eq(pf.feeLines, [[pf.p1, 4000], [pf.ym, 4500]], 'each month bills the fee it had: last month the old fee, this month the new one');
  t.ok(pf.lines.includes('pf4-te-o') && !pf.lines.includes('pf4-te-r'), 'the hourly entry became a line, the retained one did not');
  t.eq(pf.total, 8500, 'the invoice totals its fixed fees');
  await t.sleep(400);
  const ed = await ev(id => {
    renderView('reports');
    const tbl = document.getElementById('pfi-fees');
    return { rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0, total: (document.getElementById('pfi-fee-total') || {}).textContent, sum: (document.getElementById('pfi-fee-sum') || {}).textContent, issues: pfiValidate(DB.proFormaInvoices.find(i => i.id === id)) };
  }, pf.inv);
  t.ok(ed.rows === 2 && ed.total === '$8,500.00' && /Plus \$8,500\.00 in fixed fees/.test(ed.sum || ''), `the editor lists the fees and their total (got ${JSON.stringify(ed)})`);
  t.eq(ed.issues, [], 'the invoice is valid');
  const again = await ev(id => {
    const keepAlert = window.showAlert; window.showAlert = () => {};
    document.getElementById('generic-modal-body').innerHTML = '';
    try { pfiImportEntries(id); } finally { window.showAlert = keepAlert; }
    const m = document.getElementById('generic-modal'), open = !m.classList.contains('hidden'), n = document.querySelectorAll('#generic-modal-body .pfi-import-fee').length;
    closeGenericModal();
    return { open, n };
  }, pf.inv);
  t.eq(again.n, 0, 'a month already on the invoice is not offered again');
  const second = await ev(id => {
    const src = DB.proFormaInvoices.find(i => i.id === id);
    pfiCreate(); const inv = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    inv.clientId = 'c1'; inv.dateFrom = src.dateFrom; inv.dateTo = src.dateTo; saveDB(DB);
    pfiImportEntries(inv.id);
    const boxes = [...document.querySelectorAll('#generic-modal-body .pfi-import-fee')].map(c => c.checked), marks = document.querySelector('#pfi-import-fees').textContent;
    closeGenericModal();
    pfiDuplicate(id); const dup = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    const dupIssues = pfiValidate(dup);
    DB.proFormaInvoices = DB.proFormaInvoices.filter(i => i.id !== dup.id && i.id !== inv.id); saveDB(DB);
    return { boxes, marks, num: src.number, dupIssues };
  }, pf.inv);
  t.ok(second.boxes.length === 2 && second.boxes.every(b => !b) && second.marks.includes('On ' + second.num), `on another invoice the same months come unticked, marked with that invoice (got ${JSON.stringify(second.boxes)})`);
  t.ok(second.dupIssues.some(i => /fixed fees? already on another invoice/.test(i)), `a copied invoice is stopped from billing the fee twice (got ${JSON.stringify(second.dupIssues)})`);
  const edit = await ev((id, b) => {
    pfiCurrentId = id; renderView('reports');
    const inv = DB.proFormaInvoices.find(i => i.id === id), f = inv.feeLines[1];
    pfiSaveFeeLine(id, f.id, 'amount', '2250');
    const w = DB.workboards.find(x => x.id === b);
    return { line: f.amount, retainer: _rsFeeFor(w.retainer, _rsYm()), total: pfiCalcTotals(inv).feeTotal };
  }, pf.inv, bid);
  t.ok(edit.line === 2250 && edit.retainer === 4500 && edit.total === 6250, 'editing a fee on the invoice changes that invoice only, never the retainer');

  // CSV and PDF carry the fees; a fees-only invoice exports.
  const csv = await ev(id => new Promise(res => {
    const keep = URL.createObjectURL; let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:x'; };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    try { pfiExportCSV(id); } finally { URL.createObjectURL = keep; HTMLAnchorElement.prototype.click = click; }
    blob.text().then(res);
  }), pf.inv);
  t.ok(/Total Fixed Fees"?,.*6250\.00/.test(csv) && /Retained Services fixed monthly fee/.test(csv), `the CSV lists the fixed fees and their total (got ${JSON.stringify(csv.slice(-400))})`);
  // The PDF is caught as the blob jsPDF hands to the download (jsPDF writes uncompressed text by default).
  const pdf = await ev(id => new Promise(res => {
    const inv = DB.proFormaInvoices.find(i => i.id === id);
    inv.lineItems.forEach(l => { l.billable = false; }); saveDB(DB);
    _ensureJsPdf(() => {
      const keep = URL.createObjectURL; let blob = null;
      URL.createObjectURL = b => { if (b && /pdf/.test(b.type || '')) blob = b; return keep.call(URL, b); };
      pfiExportPDF(id);
      setTimeout(() => { URL.createObjectURL = keep; (blob ? blob.text() : Promise.resolve('')).then(res); }, 1500);
    });
  }), pf.inv);
  t.ok(/Fixed fee/.test(pdf) && /Total fixed fees/.test(pdf) && /6,250\.00/.test(pdf) && !/TOTAL HOURS/.test(pdf), 'with no hours included the PDF still exports, with the fee table and no hours box');

  // A retained client with no fee: hours stay off, and the message says why.
  const nofee = await ev(b => {
    const w = DB.workboards.find(x => x.id === b); const keep = w.retainer.fees; w.retainer.fees = [];
    DB.timeEntries.push({ id: 'pf4-te-f', staffId: 'u1', taskId: 'pf4-rt', clientId: 'c1', date: '2030-03-10', hours: 4, billable: true, status: 'approved', createdAt: new Date().toISOString() }); saveDB(DB);
    pfiCreate(); const inv = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    inv.clientId = 'c1'; inv.dateFrom = '2030-03-01'; inv.dateTo = '2030-03-31';
    let msg = ''; const keepAlert = window.showAlert; window.showAlert = m => { msg = m; };
    try { pfiImportEntries(inv.id); } finally { window.showAlert = keepAlert; }
    w.retainer.fees = keep; saveDB(DB);
    return msg;
  }, bid);
  t.ok(/on the client's retained board, covered by the fixed monthly fee/.test(nofee) && /No fee is set/.test(nofee), `with no fee set, the import says the hours are covered by the retainer and the fee is missing (got "${nofee}")`);
});
