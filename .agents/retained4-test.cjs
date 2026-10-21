// Retained Services, next features batch 1 (2026-10-21): five service levels kept on the retainer only, the bundle the
// services make with a suggested level, the first-reply stamp on requests, and the fixed fee, which since 2026-10-21 lives
// only on the pro forma invoice (the director types it per client; Retained Services shows it to no one, the portal never).
// Retained hours stay off the hourly pro forma.
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
  const su0 = await ev(() => ({ level: document.getElementById('rs-su-level').value, opts: [...document.querySelectorAll('#rs-su-level option')].map(o => o.value), on: [...document.querySelectorAll('[data-rs-svc]:checked')].length, create: document.getElementById('rs-su-create').disabled, guide: (document.getElementById('rs-su-guide') || {}).textContent || '', fee: !!document.getElementById('rs-su-fee') }));
  t.ok(su0.opts.length === 5 && su0.on === 0 && su0.create && /Choose a bundle/.test(su0.guide) && !su0.fee, `set-up opens bundle first: five tiers, nothing ticked, Create waits, and no fee (got ${JSON.stringify(su0)})`);
  const su1 = await ev(() => { _rsSet('bundle', null, 'Core'); return { level: document.getElementById('rs-su-level').value, note: document.getElementById('rs-su-lvlnote').textContent, on: [...document.querySelectorAll('[data-rs-svc]:checked')].map(i => i.dataset.rsSvc) }; });
  t.ok(su1.level === 'Priority' && /Core bundle/.test(su1.note) && JSON.stringify(su1.on) === '["ims","hseq"]', `the Core bundle ticks both core services and comes with Priority (got ${su1.level}, "${su1.note}")`);
  const su2 = await ev(() => { _rsSet('bundle', null, 'Ops'); return { level: document.getElementById('rs-su-level').value, note: document.getElementById('rs-su-lvlnote').textContent, on: _rsSetupKeys(_rsSetup) }; });
  t.ok(su2.level === 'Priority+' && /Ops bundle/.test(su2.note) && JSON.stringify(su2.on) === '["ims","mob"]', `the Ops bundle keeps one core, adds one add-on, and the tier follows to Priority+ (got ${su2.level}, ${JSON.stringify(su2.on)})`);
  const su3 = await ev(() => { _rsSet('on', 'hseq', true); return { level: document.getElementById('rs-su-level').value, on: _rsSetupKeys(_rsSetup) }; });
  t.ok(su3.level === 'Priority+' && JSON.stringify(su3.on) === '["hseq","mob"]', `ticking the other core service in Ops swaps it, so the mix stays a bundle (got ${su3.level}, ${JSON.stringify(su3.on)})`);
  const su4 = await ev(() => {
    _rsSet('priority', null, 'Standard'); _rsSet('bundle', null, 'Plus');
    const lvl = document.getElementById('rs-su-level').value, offeredPlus = (document.querySelector('#rs-su-lvlnote [data-rs-use]') || {}).dataset;
    _rsSet('bundle', null, 'Ops');
    const use = document.querySelector('#rs-su-lvlnote [data-rs-use]'), offered = use ? use.dataset.rsUse : null; if (use) use.click();
    return { lvl, plus: offeredPlus ? offeredPlus.rsUse : null, offered, after: document.getElementById('rs-su-level').value };
  });
  t.ok(su4.lvl === 'Standard' && su4.plus === 'High' && su4.offered === 'Priority+' && su4.after === 'Priority+', `a tier the admin picked stays when the bundle changes, with the bundle's tier one click away (got ${JSON.stringify(su4)})`);
  t.ok(await ev(() => { _rsSet('priority', null, 'Urgent'); return _rsSetup.priority === 'Priority+'; }), 'an unknown tier is refused');
  const shotSu = await ui.shot('retained4-setup');
  t.eq(shotSu.phone, 0, 'the set-up with its level fits a phone');
  const made = await ev(() => {
    retainerCreate();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived);
    return { id: b.id, level: b.retainer.priority, fees: b.retainer.fees, start: b.retainer.startMonth, taskPrios: [...new Set(DB.tasks.filter(x => x.boardId === b.id).map(x => x.priority))] };
  });
  t.ok(made.level === 'Priority+' && (made.fees || []).length === 0, `the board keeps the level and carries no fee (got ${JSON.stringify(made.fees)})`);
  t.eq(made.taskPrios, ['med'], 'the monthly tasks keep the ordinary task priority: the level never crosses onto task labels');
  const labelsAfter = await ev(() => JSON.stringify(Object.keys((DB.labelConfig || {}).priorities || {})) + '|' + (typeof getPrioMeta === 'function' ? getPrioMeta('high').label : ''));
  t.eq(labelsAfter, labelsBefore, 'the task priority labels are untouched');

  // ── Plan panel: level and suggestion; the fee is not here (the director sets it on the pro forma) ──
  const bid = made.id;
  const plan = await ev(b => {
    const w = DB.workboards.find(x => x.id === b), ym = _rsYm(), p1 = _rsPrevYm(ym), p3 = _rsPrevYm(_rsPrevYm(p1));
    w.retainer.startMonth = p3; saveDB(DB);
    openRetainerPlan(b);
    const sel = document.getElementById('rs-pl-level');
    const out = { opts: sel ? sel.options.length : 0, fee: !!document.getElementById('rs-pl-fee'), grid: document.querySelector('.rs-pl-grid').textContent.replace(/\s+/g, ' '), note: document.getElementById('rs-pl-lvlnote').textContent };
    _rsPlanSet(b, 'priority', null, 'Highest'); out.lvl = w.retainer.priority;
    _rsPlanSet(b, 'priority', null, 'Urgent'); out.lvl2 = w.retainer.priority;
    return out;
  }, bid);
  t.ok(plan.opts === 5 && /Ops bundle/.test(plan.note), `the plan shows the five levels and the bundle (got ${JSON.stringify(plan)})`);
  t.ok(!plan.fee && !/\$/.test(plan.grid) && /Set on the pro forma invoice/.test(plan.grid), `the plan has no fee field or amount, and says where the fee is set (got "${plan.grid}")`);
  t.ok(plan.lvl === 'Highest' && plan.lvl2 === 'Highest', 'an admin changes the level in the plan; an unknown level is refused');
  const sugg = await ev(b => { _rsPlanSet(b, 'priority', null, 'Standard'); const u = document.querySelector('#rs-pl-lvlnote [data-rs-use]'); const o = u ? u.dataset.rsUse : null; if (u) u.click(); return { o, lvl: DB.workboards.find(x => x.id === b).retainer.priority }; }, bid);
  t.ok(sugg.o === 'Priority+' && sugg.lvl === 'Priority+', `the plan offers the bundle's level when it differs, one click (got ${JSON.stringify(sugg)})`);
  const shotPl = await ui.shot('retained4-plan');
  t.eq(shotPl.phone, 0, 'the plan with its level fits a phone');
  const roles = await ev(b => {
    const keep = currentUser.role, out = {};
    currentUser.role = 'staff'; currentUser.billing = false; openRetainerPlan(b);
    _rsPlanSet(b, 'priority', null, 'Standard');
    out.lvl = DB.workboards.find(x => x.id === b).retainer.priority;
    currentUser.role = keep; delete currentUser.billing; closeGenericModal();
    // Nowhere in Retained Services shows a fee, admin included.
    navigate('retained'); out.dash = document.getElementById('view-container').textContent; openRetainedClient('c1'); out.page = document.getElementById('view-container').textContent;
    return out;
  }, bid);
  t.ok(roles.lvl === 'Priority+', 'staff who are not admins cannot change the level');
  t.ok(!/Monthly fee|\$\d/.test(roles.dash) && !/\$\d|a month/.test(roles.page), 'the dashboard and the client page show no fee, even to an admin');

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

  // ── Pro forma: retained hours stay off; the director types the fixed fee on the invoice ──
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
    const fees = modal.querySelectorAll('.pfi-import-fee').length;
    const entries = [...modal.querySelectorAll('.pfi-import-cb')].map(c => c.value);
    const note = (document.getElementById('pfi-import-retnote') || {}).textContent || '';
    pfiConfirmImport(inv.id);
    return { inv: inv.id, fees, entries, note, lines: inv.lineItems.map(l => l.timeEntryId), feeLines: (inv.feeLines || []).length, p1, ym };
  }, bid);
  t.ok(pf.fees === 0 && pf.feeLines === 0, `the import brings in no fee: the retainer holds none (got ${pf.fees} offered, ${pf.feeLines} lines)`);
  t.ok(pf.entries.includes('pf4-te-o') && !pf.entries.includes('pf4-te-r'), `the retained board's hours are not offered, the hourly job is (got ${JSON.stringify(pf.entries)})`);
  t.ok(/on the retained board, covered by the fixed fee/.test(pf.note), `the import says why the retained hours are missing (got "${pf.note}")`);
  t.ok(pf.lines.includes('pf4-te-o') && !pf.lines.includes('pf4-te-r'), 'the hourly entry became a line, the retained one did not');
  const _ym = pf.ym;
  await t.sleep(300);
  const add = await ev((id, b) => {
    renderView('reports');
    const btn = document.getElementById('pfi-add-fee-' + id), inv = DB.proFormaInvoices.find(i => i.id === id);
    let alerted = ''; const keepAlert = window.showAlert; window.showAlert = m => { alerted = m; };
    try {
      btn.click();
      const f = inv.feeLines[0], out = { btn: !!btn, n: inv.feeLines.length, kind: f.kind, board: f.boardId === b, month: f.month, label: f.label, amount: f.amount };
      out.zero = pfiValidate(inv);
      document.getElementById('pfi-add-fee-' + id).click(); out.second = inv.feeLines[1] && inv.feeLines[1].month;
      document.getElementById('pfi-add-fee-' + id).click(); out.twice = inv.feeLines.length; out.alert = alerted;
      pfiSaveFeeLine(id, inv.feeLines[1].id, 'remove');
      const inp = document.querySelector(`[data-pfi-fee-label="${f.id}"]`); out.input = !!inp;
      pfiSaveFeeLine(id, f.id, 'amount', '4500');
      pfiSaveFeeLine(id, f.id, 'label', '  Monthly HSEQ retainer  ');
      out.after = [f.amount, f.label]; out.issues = pfiValidate(inv); out.total = pfiCalcTotals(inv).feeTotal;
      out.audit = (inv.auditEvents || []).filter(e => e.event === 'fee_line_added').length;
      return out;
    } finally { window.showAlert = keepAlert; }
  }, pf.inv, bid);
  t.ok(add.btn && add.n === 1 && add.kind === 'retainer' && add.board && add.month === pf.p1 && add.amount === 0, `+ Fixed fee adds one line for the retained client's first month, at no amount (got ${JSON.stringify(add)})`);
  t.ok(/^Retained Services fixed monthly fee, /.test(add.label) && add.input, `the line is named for the retainer and the name can be changed (got "${add.label}")`);
  t.ok(add.zero.some(i => /fixed fee has no amount/.test(i)), `a fee with no amount stops the invoice (got ${JSON.stringify(add.zero)})`);
  t.ok(add.second === _ym && add.twice === 2 && /Every month of this invoice already has a fixed fee/.test(add.alert), `the next click adds the next month; a month is never added twice (got ${add.second}, ${add.twice}, "${add.alert}")`);
  t.eq(add.after, [4500, 'Monthly HSEQ retainer'], 'the director sets the amount and the description');
  t.ok(add.issues.length === 0 && add.total === 4500 && add.audit === 2, `the invoice is then valid, totals the fee, and records who added it (got ${JSON.stringify(add)})`);
  await t.sleep(300);
  const ed = await ev(id => {
    renderView('reports');
    const tbl = document.getElementById('pfi-fees');
    return { rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0, total: (document.getElementById('pfi-fee-total') || {}).textContent, sum: (document.getElementById('pfi-fee-sum') || {}).textContent };
  }, pf.inv);
  t.ok(ed.rows === 1 && ed.total === '$4,500.00' && /Plus \$4,500\.00 in fixed fees/.test(ed.sum || ''), `the editor lists the fee and its total (got ${JSON.stringify(ed)})`);
  const pfRoles = await ev(id => {
    const inv = DB.proFormaInvoices.find(i => i.id === id), keep = currentUser.role, f = inv.feeLines[0], out = {};
    currentUser.role = 'staff'; currentUser.billing = false;
    pfiAddFeeLine(id); pfiSaveFeeLine(id, f.id, 'amount', '1');
    out.n = inv.feeLines.length; out.amount = f.amount;
    currentUser.role = keep; delete currentUser.billing;
    return out;
  }, pf.inv);
  t.ok(pfRoles.n === 1 && pfRoles.amount === 4500, `staff without billing rights cannot add or change a fixed fee (got ${JSON.stringify(pfRoles)})`);
  const second = await ev(id => {
    pfiDuplicate(id); const dup = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    const dupIssues = pfiValidate(dup);
    DB.proFormaInvoices = DB.proFormaInvoices.filter(i => i.id !== dup.id); saveDB(DB);
    return { dupIssues };
  }, pf.inv);
  t.ok(second.dupIssues.some(i => /fixed fees? already on another invoice/.test(i)), `a copied invoice is stopped from billing the fee twice (got ${JSON.stringify(second.dupIssues)})`);
  t.ok(await ev(b => !/fees|4500/.test(JSON.stringify(DB.workboards.find(x => x.id === b).retainer.fees || [])), bid), 'the fee on the invoice never writes back to the retainer');

  // CSV and PDF carry the fee; a fees-only invoice exports.
  const csv = await ev(id => new Promise(res => {
    const keep = URL.createObjectURL; let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:x'; };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    try { pfiExportCSV(id); } finally { URL.createObjectURL = keep; HTMLAnchorElement.prototype.click = click; }
    blob.text().then(res);
  }), pf.inv);
  t.ok(/Total Fixed Fees"?,.*4500\.00/.test(csv) && /Monthly HSEQ retainer/.test(csv), `the CSV lists the fixed fee and its total (got ${JSON.stringify(csv.slice(-400))})`);
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
  t.ok(/Fixed fee/.test(pdf) && /Total fixed fees/.test(pdf) && /4,500\.00/.test(pdf) && !/TOTAL HOURS/.test(pdf), 'with no hours included the PDF still exports, with the fee table and no hours box');

  // A month with only retained hours: nothing to import, and the message says how to bill the fee.
  const nofee = await ev(() => {
    DB.timeEntries.push({ id: 'pf4-te-f', staffId: 'u1', taskId: 'pf4-rt', clientId: 'c1', date: '2030-03-10', hours: 4, billable: true, status: 'approved', createdAt: new Date().toISOString() }); saveDB(DB);
    pfiCreate(); const inv = DB.proFormaInvoices.find(i => i.id === pfiCurrentId);
    inv.clientId = 'c1'; inv.dateFrom = '2030-03-01'; inv.dateTo = '2030-03-31';
    let msg = ''; const keepAlert = window.showAlert; window.showAlert = m => { msg = m; };
    try { pfiImportEntries(inv.id); } finally { window.showAlert = keepAlert; }
    return msg;
  });
  t.ok(/on the client's retained board, covered by the fixed monthly fee/.test(nofee) && /\+ Fixed fee/.test(nofee), `with only retained hours, the import says they are covered and points to + Fixed fee (got "${nofee}")`);
});
