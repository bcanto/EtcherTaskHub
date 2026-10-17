// H7 (audit 2026-10-17): an error message wrote into the same dialog as the form that raised it, so the form was
// replaced and its OK closed it, losing everything typed (13 forms, two of them in the client portal). Now a message
// raised while a form is open appears on a layer of its own above it; with nothing open it works as before.
// Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3206);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3206/');
    // What the screen shows right now: the form dialog, the message layer.
    const state = () => p.evaluate(() => {
      const vis = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
      const layer = document.getElementById('alert-modal');
      return {
        form: vis('generic-modal'), formTitle: document.getElementById('generic-modal-title').textContent,
        formText: document.getElementById('generic-modal-body').innerText.replace(/\s+/g, ' ').trim(),
        formIsMessage: !!document.querySelector('#generic-modal-body [data-alert-msg]'),
        layer: vis('alert-modal'), layerTitle: document.getElementById('alert-modal-title').textContent, layerMsg: document.getElementById('alert-modal-msg').textContent,
        layerZ: +getComputedStyle(layer).zIndex, formZ: +getComputedStyle(document.getElementById('generic-modal')).zIndex, confirmZ: +getComputedStyle(document.getElementById('confirm-modal')).zIndex,
        focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
      };
    });
    const val = id => p.evaluate(id => (document.getElementById(id) || {}).value, id);
    const reset = () => p.evaluate(() => { closeGenericModal(); closeAlert(); });

    // ── The mechanism ──
    await p.evaluate(() => {
      openGenericModal('Some form', '<input id="t-in" class="form-input"/><textarea id="t-ta"></textarea><button id="t-btn">Go</button>');
      document.getElementById('t-in').value = 'half typed'; document.getElementById('t-ta').value = 'a long note'; document.getElementById('t-in').focus();
      showAlert('Something went wrong', 'Oops');
    });
    let s = await state();
    ok(s.form && s.formTitle === 'Some form' && !s.formIsMessage && await val('t-in') === 'half typed' && await val('t-ta') === 'a long note', 'a message raised while a form is open leaves the form on screen with everything typed (' + s.formTitle + ')');
    ok(s.layer && s.layerTitle === 'Oops' && s.layerMsg === 'Something went wrong', 'and shows the message on its own layer');
    ok(s.layerZ > s.formZ && s.layerZ > s.confirmZ, 'the layer sits above the form and above the confirm dialog (' + s.layerZ + ' over ' + s.formZ + '/' + s.confirmZ + ')');
    ok(s.focus === 'alert-ok-btn', 'focus moves to the OK button so the keyboard works (' + s.focus + ')');
    await p.evaluate(() => { const b = document.getElementById('alert-ok-btn'); if (b) b.click(); });   // not p.click: when broken the button may be hidden, and a throw would hide every later check
    s = await state();
    ok(!s.layer && s.form && await val('t-in') === 'half typed' && await val('t-ta') === 'a long note', 'OK closes only the message: the form and what was typed are still there');
    ok(s.focus === 't-in', 'and focus goes back to where it was in the form (' + s.focus + ')');
    await p.evaluate(() => closeGenericModal());
    s = await state();
    ok(!s.form && !s.layer, 'closing the form afterwards leaves nothing on screen');

    // With nothing open it is the message dialog, as before; a second message replaces the first.
    await reset();
    await p.evaluate(() => { showAlert('First message', 'One'); });
    s = await state();
    ok(s.form && s.formIsMessage && /First message/.test(s.formText) && s.formTitle === 'One' && !s.layer, 'with nothing open a message still appears in the shared dialog, as before');
    await p.evaluate(() => { showAlert('Second message', 'Two'); });
    s = await state();
    ok(s.form && s.formIsMessage && /Second message/.test(s.formText) && !/First message/.test(s.formText) && s.formTitle === 'Two' && !s.layer, 'a second message replaces the first one rather than stacking on it');
    await p.evaluate(() => { document.querySelector('#generic-modal-body button').click(); });
    s = await state();
    ok(!s.form && !s.layer, 'and its OK closes it');

    // Layer behaviour: one layer, Escape and the backdrop close it, the form stays.
    await reset();
    await p.evaluate(() => { openGenericModal('Form', '<input id="t-in" class="form-input" value="keep"/>'); document.getElementById('t-in').focus(); showAlert('First', 'A'); showAlert('Second', 'B'); });
    s = await state();
    ok(s.layer && s.layerMsg === 'Second' && s.layerTitle === 'B', 'a second message while the layer is open replaces the text (one layer, not two)');
    await p.keyboard.press('Escape');
    s = await state();
    ok(!s.layer && s.form && await val('t-in') === 'keep' && s.focus === 't-in', 'Escape closes the message and leaves the form (' + s.focus + ')');
    await p.evaluate(() => showAlert('Again', 'C'));
    await p.evaluate(() => { document.getElementById('alert-modal').click(); });   // a click on the dark backdrop itself
    s = await state();
    ok(!s.layer && s.form, 'a click outside the message closes it and leaves the form');
    await reset();

    // ── The real forms from the audit: submit them wrong and check nothing is lost ──
    // Staff form: a name but no email.
    await p.evaluate(() => { openStaffModal(null); document.getElementById('sm-name').value = 'Keep Me'; document.getElementById('sm-email').value = ''; saveStaff(''); });
    s = await state();
    ok(s.form && s.formTitle === 'Add Staff' && await val('sm-name') === 'Keep Me' && s.layer && /Name and email are required/.test(s.layerMsg), 'Add Staff: a missing email keeps the form and the name typed (' + s.layerMsg + ')');
    await reset();
    // Calendar event: no title.
    await p.evaluate(() => { openEventModal(null, null); document.getElementById('sched-desc').value = 'agenda I typed'; saveSchedEvent(''); });
    s = await state();
    ok(s.form && await val('sched-desc') === 'agenda I typed' && s.layer && /Title is required/.test(s.layerMsg), 'Calendar event: a missing title keeps the form and the description typed');
    await reset();
    // Time entries: an editable draft, a reject form, and the bulk reject form.
    const eid = await p.evaluate(() => {
      const e = { id: 'te-h7', staffId: currentUser.id, taskId: null, clientId: '', date: '2026-10-12', hours: 3, note: 'work', status: 'submitted', billable: true, createdAt: '2026-10-12T09:00:00.000Z', updatedAt: '2026-10-12T09:00:00.000Z' };
      (DB.timeEntries = DB.timeEntries || []).push(e); return e.id;
    });
    await p.evaluate(id => { openEditTimeEntry(id); document.getElementById('ete-hours').value = '2.5'; document.getElementById('ete-note').value = ''; saveEditTimeEntry(id); }, eid);
    s = await state();
    ok(s.form && s.formTitle === 'Edit Time Entry' && await val('ete-hours') === '2.5' && s.layer && /Add a note/.test(s.layerMsg), 'Edit Time Entry: a missing note keeps the form and the hours typed');
    await reset();
    await p.evaluate(id => { openTsRejectModal(id); tsRejectEntry(id); }, eid);
    s = await state();
    ok(s.form && s.formTitle === 'Reject Timesheet Entry' && s.layer && /rejection reason/.test(s.layerMsg), 'Reject entry: a missing reason keeps the reject form open');
    await reset();
    await p.evaluate(id => { tsSelectedIds = new Set([id]); openTsBulkRejectModal(); tsBulkReject(); }, eid);
    s = await state();
    ok(s.form && s.formTitle === 'Bulk Reject Timesheets' && s.layer && /rejection reason/.test(s.layerMsg), 'Bulk reject: a missing reason keeps the form open');
    await reset();
    // The portal's failed send: the typed note must survive. (_portalAction is the one place that raises it.)
    const portal = await p.evaluate(async () => {
      openGenericModal('Mark as Done', '<textarea id="cp-ar-note" class="form-input"></textarea>');
      document.getElementById('cp-ar-note').value = 'a note the client typed';
      const real = window.fetch; window.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: 'Nope, try later' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      const okSend = await _portalAction('respondAction', { requestId: 'x' });
      window.fetch = real;
      return { okSend, note: document.getElementById('cp-ar-note') ? document.getElementById('cp-ar-note').value : null };
    });
    s = await state();
    ok(portal.okSend === false && portal.note === 'a note the client typed' && s.layer && /Nope, try later/.test(s.layerMsg), 'a failed portal send keeps the form and the note the client typed, and says why');
    await reset();

    // A message that arrives after the form is closed still shows normally.
    await p.evaluate(() => { openStaffModal(null); closeGenericModal(); showAlert('After close', 'Late'); });
    s = await state();
    ok(s.form && s.formIsMessage && /After close/.test(s.formText) && !s.layer, 'a message after the form was closed appears in the shared dialog as before');
    await reset();
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h7-alert-layer-test', pass, fail); }
})();
