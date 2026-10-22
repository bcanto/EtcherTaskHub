// Retained Services with its client portal, end to end (2026-10-21, before the deploy): staff set up General Cranes'
// retainer, registers and tasks; the client signs in to the portal in another browser and sees the retainer, the
// document review and its use, never the renewal, a person, a register or a fee; the client's Request Work lands in
// the staff queue with the level's dates in business days. Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained11-test', 3272, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const fx = await ev(() => {
    DB.clients.find(c => c.id === 'c1').portalEnabled = true;
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); RETAINER_CATALOGUE.forEach(s => _rsSet('on', s.key, s.key === 'ims' || s.key === 'mob')); _rsSet('priority', null, 'Priority'); retainerCreate(); closeGenericModal();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived), ims = b.retainer.services.find(s => s.key === 'ims'), mob = b.retainer.services.find(s => s.key === 'mob');
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    _regApply('c1', { kind: 'training', quals: ['White Card'], rows: [{ ref: 'T1', surname: 'PLACEHOLDER', first: 'Robin', full: '', position: 'Rigger', location: 'Perth', employment: 'Casual', company: '', note: '', quals: { 'White Card': { d: day(-5) } } }] }, false, 'gc matrix.xlsx');
    _regApply('c1', { kind: 'docs', rows: [{ name: 'GC-PRO-007 - Lifting Procedure', code: 'GC-PRO-007', title: 'Lifting Procedure', issueDate: day(-400), reviewMonths: 12, nextReview: day(-20), note: '' }] }, false, 'gc reg.xlsx');
    const person = DB.registerPeople.find(p => p.clientId === 'c1'), doc = DB.registerDocs.find(d => d.clientId === 'c1');
    regAddReviewTasks('c1', [doc.id]); regAddRenewalTasks('c1', [person.id]);
    const rv = DB.tasks.find(x => x.registerDocId === doc.id), rn = DB.tasks.find(x => x.registerPersonId === person.id), now = new Date().toISOString();
    [rv, rn].forEach(x => { x.status = 'done'; x.completedAt = now; x.updatedAt = now; });
    // A fee typed on a pro forma for this client: staff only.
    DB.proFormaInvoices = DB.proFormaInvoices || [];
    DB.proFormaInvoices.push({ id: 'pf11', number: 'PF-11', clientId: 'c1', dateFrom: day(-20), dateTo: day(0), status: 'draft', lineItems: [], feeLines: [{ id: 'fl11', kind: 'retainer', boardId: b.id, month: _rsYm(), label: 'Retained Services fixed monthly fee', amount: 6543.21, billable: true }], createdAt: now, updatedAt: now });
    saveDB(DB);
    return { bid: b.id, ims: ims.groupId, imsAllow: ims.allowance, imsUnit: ims.unit, mob: mob.groupId, rv: rv.name, rn: rn.name, lv: _rsLevel('Priority') };
  });
  t.ok(/Lifting Procedure/.test(fx.rv) && /Renew tickets: Robin PLACEHOLDER/.test(fx.rn), 'staff have a document review and a renewal, both finished this month');
  await t.sleep(800);

  // Sign out, reload (only what was saved carries over), sign in as someone else on the same page.
  const switchTo = async (email, password, role) => {
    await ev(() => doLogout());
    await ui.page.reload({ waitUntil: 'networkidle2' }); await t.sleep(1200);
    await ev((e, p) => { if (typeof currentUser !== 'undefined' && currentUser) doLogout(); document.getElementById('login-email').value = e; document.getElementById('login-password').value = p; doLogin(); }, email, password);
    await ui.page.waitForFunction(r => typeof currentUser !== 'undefined' && currentUser && currentUser.role === r, { timeout: 15000 }, role); await t.sleep(1500);
  };

  // ── The client signs in to the portal ──
  await switchTo('client@generalcranes.com.au', 'ClientPreview1', 'client');
  const cev = ev;
  const seen = await cev(async fx => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), body = () => document.getElementById('cp-body').textContent.replace(/\s+/g, ' ');
    const out = { portal: !document.getElementById('client-portal').classList.contains('hidden'), who: currentUser.clientId, tab: getComputedStyle(document.getElementById('cp-tab-retained')).display !== 'none' };
    out.text = {};
    for (const s of ['overview', 'tasks', 'retained', 'requests']) {
      cpNavigate(s); await wait(500); out.text[s] = body();
      if (s === 'retained') { out.squares = document.querySelectorAll('#cp-body .cp-rt-cells i').length; out.on = document.querySelectorAll('#cp-body .cp-rt-cells i.on').length; out.starts = /Starts\s?[A-Z][a-z]+ 20\d\d/.test(body()); }
    }
    out.service = !!document.querySelector(`#cp-req-service option[value="g:${fx.ims}"]`);
    return out;
  }, fx);
  t.ok(seen.portal && seen.who === 'c1' && seen.tab, 'General Cranes signs in and has the Retained Services tab');
  const all = Object.values(seen.text).join(' ');
  t.ok(new RegExp(`1 of ${fx.imsAllow} ${fx.imsUnit} used`).test(seen.text.retained), `the finished document review uses one of the allowance (got "${seen.text.retained.slice(0, 240)}")`);
  t.ok(/Lifting Procedure/.test(all), 'the document review is visible to the client');
  t.ok(!/Renew tickets|PLACEHOLDER|Robin|White Card/.test(all), 'the renewal, the person and their training never show in the portal');
  t.ok(!/Document register|Training matrix|gc reg\.xlsx|gc matrix\.xlsx/.test(all), 'the registers never show in the portal');
  t.ok(!/6,?543|Monthly fee|fixed monthly fee|\$\d/.test(all), 'no fee amount shows in the portal');
  t.ok(/Priority/.test(seen.text.retained) && seen.squares > 0 && seen.on === 1, `the retainer shows its level and the allowance squares, one filled (got ${seen.squares}, ${seen.on})`);
  t.ok(seen.starts, 'a retainer that begins next month says Starts, not Started');

  // ── Request Work from the portal, into the staff queue ──
  const sent = await cev(async g => {
    cpNavigate('retained'); await new Promise(r => setTimeout(r, 400));
    document.getElementById('cp-req-title').value = 'Update the lifting plan'; document.getElementById('cp-req-service').value = 'g:' + g; cpReqServiceHint();
    const hint = document.getElementById('cp-req-hint').textContent;
    cpSubmitRequest(); await new Promise(r => setTimeout(r, 400));
    const r = (DB.clientWorkRequests || []).find(x => x.title === 'Update the lifting plan');
    return { hint, id: r && r.id, at: r && r.submittedAt, ref: r && r.serviceRef };
  }, fx.ims);
  t.ok(sent.id && sent.ref === 'g:' + fx.ims && /Covered by your retainer/.test(sent.hint), `the client sends a request against the retained service (got ${JSON.stringify(sent)})`);
  await t.sleep(800);
  await switchTo('b.canto@etchersolutions.com', 'TaskHub123', 'admin');
  const q = await ev(id => {
    navigate('retained');
    const r = _rqQueue().find(x => x.kind === 'request' && x.id === id), row = document.querySelector(`#rd-queue [data-rq="${id}"], #rd-queue [data-id="${id}"]`);
    const req = (DB.clientWorkRequests || []).find(x => x.id === id), lv = _rsLevel('Priority');
    return r ? { level: r.lv.key, reply: r.reply.due, deliver: r.deliver.due, wantReply: _bdDue(req.submittedAt, lv.resp), wantDeliver: _bdDue(req.submittedAt, lv.del), queueText: document.getElementById('rd-queue').textContent, row: !!row } : null;
  }, sent.id);
  t.ok(q && q.level === 'Priority', `the request is in the staff queue at the client's level (got ${JSON.stringify(q && q.level)})`);
  t.ok(q && q.reply === q.wantReply && q.deliver === q.wantDeliver && !!q.reply, `its reply and delivery dates follow the level in business days (got ${q && q.reply}, ${q && q.deliver})`);
  t.ok(q && /Update the lifting plan/.test(q.queueText), 'the queue lists it by title');
  // Business days never land on a weekend or a WA holiday.
  t.ok(q && await ev(ds => ds.every(d => _bdIsWork(new Date(d + 'T12:00:00'))), [q.reply, q.deliver]), 'the dates are working days');
});
