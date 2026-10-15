// Release-1 B7b: what the client sends back from the portal ISO tab (plan Phase 13). They answer the
// issued report (accurate, or a correction, plus a management response), say their own action is done
// and say a requested document is sent. Each waits for Etcher, who accepts or rejects an answer with a
// note the client reads. Clients never verify, close or change a conclusion. Own offline server.
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');
const CU = { id: 'cu1', role: 'client', clientId: 'c1', name: 'Jordan Price' };
const CU2 = H.CLIENT('cu2', 'c1');

H.run('iso-portal2-test', 3186, async (t, srv) => {
  const A = H.ADMIN;
  const b = await srv.board({ standards: ['9001'], title: 'ISO 9001 internal audit', members: [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }] });
  const audit = async () => srv.must(A, { op: 'audit.get', auditId: b.id }).then(x => x.audit || x);
  for (const uid of ['offline:cu1', 'offline:c1']) await srv.must(A, { op: 'member.add', auditId: b.id, uid, auditRole: 'client_contributor', memberKind: 'client' });
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: true }, reason: 'Report issued', expectedVersion: (await audit()).row_version });
  const r41 = b.key('9001 4.1'), r42 = b.key('9001 4.2');
  await srv.set(b, '9001 4.1', { compliance_status: 'compliant', current_system: 'Seen the register and two signed records.' }, AUD);
  const f = await srv.must(AUD, { op: 'finding.create', auditId: b.id, requirementId: r41.id, title: 'Load cells not in the register', classification: 'minor_nc', visibility: 'client_all' });
  const mine = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'finding', targetId: f.id, title: 'Add load-cell calibration to the register', ownerKind: 'client', dueDate: '2026-12-01', visibility: 'client_all' });
  const theirs = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'requirement', targetId: r42.id, title: 'Tighten the complaint procedure', visibility: 'client_all' });
  const actRow = id => srv.must(A, { op: 'action.list', auditId: b.id }).then(l => l.find(x => x.id === id));
  await srv.must(AUD, { op: 'action.updateStatus', auditId: b.id, id: mine.id, to: 'assigned', expectedVersion: (await actRow(mine.id)).row_version });
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: 'Send the calibration certificates', requirementIds: [r41.id], dueDate: '2026-11-20' }, { documentName: 'Staff-only request', requirementIds: [r42.id], requestedFromUid: 'offline:u3' }] });
  const r1 = await srv.row(b, '9001 4.1');
  await srv.must(LEAD, { op: 'requirement.approve', auditId: b.id, id: r1.id, expectedVersion: r1.row_version });
  await srv.must(AUD, { op: 'report.saveDraft', auditId: b.id, sections: { executiveSummary: 'Mostly in place.' } });
  const v1 = await srv.must(LEAD, { op: 'report.issue', auditId: b.id });
  const inboxOf = async u => ((await srv.call(u, { op: 'portal.notifications' })).data || { notifications: [] }).notifications.map(n => n.message);
  t.ok((await inboxOf(CU)).includes(b.ref + ': the audit report is ready for you to check.'), 'the client is told the report is ready');
  t.eq((await inboxOf(CU2)).length, 0, 'a login not named on the board is told nothing');
  const board = async (u = CU) => (await srv.call(u, { op: 'portal.board', auditId: b.id })).data;
  const needs = async () => (await srv.call(CU, { op: 'portal.boards' })).data.needs.map(n => n.kind).sort();

  // ── Report answer ──
  t.eq((await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: false })).status, 400, 'a correction needs its text');
  t.eq((await srv.call(CU2, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: true })).status, 403, 'a login not named on the board cannot answer');
  t.eq((await srv.call(A, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: true })).status, 403, 'staff cannot answer as the client');
  t.eq((await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: false, correction: 'x'.repeat(4001) })).status, 400, 'text has a length limit');
  let r = await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: false, correction: 'Two load cells were calibrated in August.', managementResponse: 'We will update the register by 1 December.' });
  t.ok(r.status === 200 && r.data.responses[0].status === 'submitted' && !r.data.responses[0].accurate, 'the client asks for a correction; it waits for Etcher');
  t.ok(!(await needs()).includes('report'), 'an answered report no longer asks the client');
  t.eq((await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: true })).status, 400, 'one answer at a time');
  let d = await board();
  t.ok(d.responses.length === 1 && d.responses[0].correction === 'Two load cells were calibrated in August.' && d.responses[0].by === 'Jordan Price' && !d.reports[0].acknowledgement, 'the client sees their answer; no acknowledgement yet');
  t.ok(!JSON.stringify(d.responses).includes('offline:'), 'answers carry no user ids');
  const list = await srv.must(A, { op: 'response.list', auditId: b.id });
  t.ok(list.length === 1 && list[0].factual_status === 'disputed' && list[0].respondent_uid === 'offline:cu1', 'Etcher sees the answer');
  const rep = await srv.must(A, { op: 'report.get', auditId: b.id });
  t.eq(rep.versions[0].responses.length, 1, 'the Report panel shows it under its version');
  t.ok((await srv.must(LEAD, { op: 'notification.list' })).items.some(n => n.type === 'client_response' && /asked for a correction/.test(n.message)), 'the lead auditor is told');
  t.eq((await srv.call(CU, { op: 'response.decide', auditId: b.id, id: list[0].id, decision: 'accepted', note: 'ok' })).status, 403, 'the client cannot decide');
  t.eq((await srv.call(LEAD, { op: 'response.decide', auditId: b.id, id: list[0].id, decision: 'rejected' })).status, 400, 'a decision needs a note');
  await srv.must(LEAD, { op: 'response.decide', auditId: b.id, id: list[0].id, decision: 'rejected', note: 'The August certificates cover different serial numbers.' });
  const told = await inboxOf(CU);
  t.ok(told.includes(b.ref + ': Etcher replied to your answer on the audit report.') && !told.some(m => /serial numbers/.test(m)), 'the client is told Etcher replied, without the note in the message');
  t.eq((await srv.call(LEAD, { op: 'response.decide', auditId: b.id, id: list[0].id, decision: 'accepted', note: 'again' })).status, 400, 'decided once only');
  d = await board();
  t.ok(d.responses[0].status === 'rejected' && /different serial numbers/.test(d.responses[0].decisionNote), 'the client reads Etcher\'s note');
  t.ok((await needs()).includes('report'), 'after a rejection the report asks the client again');
  r = await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: true, managementResponse: 'Agreed, register updated.' });
  d = await board();
  t.ok(r.status === 200 && d.reports[0].acknowledgement && d.reports[0].acknowledgement.name === 'Jordan Price', '"It is accurate" records the client\'s own acknowledgement');
  t.ok(!(await needs()).includes('report'), 'and the report stops asking');
  // A newer version: an answer to the old one is refused.
  await srv.must(AUD, { op: 'report.saveDraft', auditId: b.id, sections: { executiveSummary: 'Corrected.' }, expectedVersion: (await srv.must(A, { op: 'report.get', auditId: b.id })).draft.row_version });
  const v2 = await srv.must(LEAD, { op: 'report.issue', auditId: b.id, reason: 'Serial numbers corrected' });
  t.ok((await needs()).includes('report'), 'a reissued report asks the client again');
  const old = await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v1.id, accurate: true });
  t.ok(old.status === 400 && /newer version/.test(old.error || ''), 'an answer to a replaced version is refused, pointing at the new one');
  t.eq((await srv.call(CU, { op: 'portal.respond', auditId: b.id, versionId: v2.id, accurate: true })).status, 200, 'the new version is answered');

  // ── Mark done ──
  t.eq((await srv.call(CU, { op: 'portal.actionDone', auditId: b.id, id: theirs.id, expectedVersion: (await actRow(theirs.id)).row_version })).status, 403, 'Etcher\'s action cannot be marked done by the client');
  t.eq((await srv.call(CU, { op: 'portal.actionDone', auditId: b.id, id: mine.id, expectedVersion: 1 })).status, 409, 'a stale copy is refused');
  r = await srv.call(CU, { op: 'portal.actionDone', auditId: b.id, id: mine.id, expectedVersion: (await actRow(mine.id)).row_version, note: 'Register updated with all six load cells.' });
  const after = await actRow(mine.id);
  t.ok(r.status === 200 && after.status === 'submitted_for_review' && after.verification_status === 'not_verified', 'done goes to Etcher for review; nothing is verified or closed');
  const reviews = await srv.must(A, { op: 'review.list', auditId: b.id, actionId: mine.id });
  t.ok(reviews.length === 1 && reviews[0].submission_note === 'Register updated with all six load cells.' && reviews[0].submitted_by === 'offline:cu1', 'Etcher sees what the client did, in the action\'s review');
  t.eq((await srv.call(CU, { op: 'portal.actionDone', auditId: b.id, id: mine.id, expectedVersion: after.row_version })).status, 400, 'once sent, it is no longer open for the client');
  t.ok(!(await needs()).includes('action'), 'and no longer asks the client');
  t.eq((await srv.call(CU, { op: 'action.updateStatus', auditId: b.id, id: mine.id, to: 'ready_for_verification', expectedVersion: after.row_version })).status, 403, 'the client cannot move it on themselves');

  // ── Mark sent ──
  d = await board();
  const req = d.requests[0];
  t.eq(d.requests.length, 1, 'the staff-only request stays hidden');
  const staffReq = (await srv.must(A, { op: 'evidenceRequest.list', auditId: b.id })).find(x => x.description === 'Staff-only request');
  t.eq((await srv.call(CU, { op: 'portal.requestSent', auditId: b.id, id: staffReq.id, expectedVersion: staffReq.row_version })).status, 404, 'a request for someone else cannot be marked');
  r = await srv.call(CU, { op: 'portal.requestSent', auditId: b.id, id: req.id, expectedVersion: req.rowVersion });
  t.ok(r.status === 200 && (await board()).requests[0].status === 'submitted', 'the client marks the document sent');
  t.eq((await srv.call(CU, { op: 'portal.requestSent', auditId: b.id, id: req.id, expectedVersion: req.rowVersion + 1 })).status, 400, 'once only');
  t.eq(await needs(), [], 'nothing is waiting on the client now');

  // ── Your history (13.6b) ──
  // Etcher marks the staff-only request sent: that is Etcher's action, never the client's history.
  await srv.must(AUD, { op: 'evidenceRequest.update', auditId: b.id, id: staffReq.id, status: 'submitted', expectedVersion: staffReq.row_version });
  const hist = await srv.call(CU, { op: 'portal.history' });
  const whats = (hist.data && hist.data.history || []).map(x => x.what);
  t.ok(hist.status === 200 && whats.includes('You asked for a correction to the audit report') && whats.includes('You confirmed the audit report is accurate') && whats.includes('You said ' + mine.ref + ' is done') && whats.includes('You sent a requested document'), 'Your history lists what the client sent (' + whats.join(' | ') + ')');
  t.ok(!/serial|calibrated|offline:|register by 1 December/.test(JSON.stringify(hist.body)), 'history is sentences only: no text the client or Etcher wrote, no ids');
  t.eq((await srv.call(CU2, { op: 'portal.history' })).data.history.length, 0, 'another login of the client sees none of it');
  t.eq((await srv.call(A, { op: 'portal.history' })).status, 403, 'staff cannot call it');
  t.ok(!whats.some(w => /Etcher|rejected|accepted/.test(w)) && whats.filter(w => w === 'You sent a requested document').length === 1, 'only the client\'s own actions, not Etcher\'s');

  // ── UI: client answers, marks done and sent; Etcher decides in the Report panel ──
  // A fresh board for the UI, shared with the local preview login.
  const u = await srv.board({ standards: ['9001'], title: 'Maintenance audit 2026', members: [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }] });
  await srv.must(A, { op: 'member.add', auditId: u.id, uid: 'offline:c1', auditRole: 'client_contributor', memberKind: 'client' });
  await srv.must(A, { op: 'audit.update', auditId: u.id, patch: { client_portal_enabled: true }, reason: 'Sharing', expectedVersion: (await srv.must(A, { op: 'audit.get', auditId: u.id }).then(x => x.audit || x)).row_version });
  const uf = await srv.must(AUD, { op: 'finding.create', auditId: u.id, requirementId: u.key('9001 4.1').id, title: 'Training records incomplete', classification: 'minor_nc', visibility: 'client_all' });
  const ua = await srv.must(AUD, { op: 'action.create', auditId: u.id, targetType: 'finding', targetId: uf.id, title: 'Record toolbox talk attendance', ownerKind: 'client', dueDate: '2026-12-10', visibility: 'client_all' });
  await srv.must(AUD, { op: 'action.updateStatus', auditId: u.id, id: ua.id, to: 'assigned', expectedVersion: (await srv.must(A, { op: 'action.list', auditId: u.id })).find(x => x.id === ua.id).row_version });
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: u.id, items: [{ documentName: 'Send the September toolbox talk sheets', requirementIds: [u.key('9001 4.1').id] }] });
  await srv.set(u, '9001 4.1', { compliance_status: 'compliant', current_system: 'Seen the register and two signed records.' }, AUD);
  const ur = await srv.row(u, '9001 4.1');
  await srv.must(LEAD, { op: 'requirement.approve', auditId: u.id, id: ur.id, expectedVersion: ur.row_version });
  await srv.must(AUD, { op: 'report.saveDraft', auditId: u.id, sections: { executiveSummary: 'In place.' } });
  await srv.must(LEAD, { op: 'report.issue', auditId: u.id });

  const cl = await t.browser({ email: 'client@generalcranes.com.au', password: 'ClientPreview1' });
  await t.sleep(1800);
  await cl.eval(id => ISO.portal.open(id), u.id); await t.sleep(1800);
  t.ok(await cl.eval(() => !!document.querySelector('.cpi-rv') && document.getElementById('cpi-rv-fix').hidden), 'the report asks for a factual accuracy check');
  await cl.eval(() => { document.querySelector('input[name="cpi-rv"][value="fix"]').click(); }); await t.sleep(200);
  t.ok(await cl.eval(() => !document.getElementById('cpi-rv-fix').hidden), 'choosing a correction opens its box');
  await cl.eval(() => document.querySelector('.cpi-rv .cpi-send').click()); await t.sleep(600);
  t.ok(await cl.eval(() => !!document.querySelector('.cpi-rv') && document.activeElement && document.activeElement.id === 'cpi-rv-c'), 'sending an empty correction is stopped at the box');
  await cl.eval(() => { document.getElementById('cpi-rv-c').value = 'The audit dates were 1 to 3 October.'; document.getElementById('cpi-rv-m').value = 'Training sheets will be filed weekly.'; document.querySelector('.cpi-rv .cpi-send').click(); }); await t.sleep(2200);
  let ui = await cl.eval(() => ({ form: !!document.querySelector('.cpi-rv'), ans: (document.querySelector('.cpi-ans') || {}).textContent || '' }));
  t.ok(!ui.form && /You asked for a correction/.test(ui.ans) && /With Etcher/.test(ui.ans) && /1 to 3 October/.test(ui.ans), 'the answer shows as sent and waiting for Etcher');
  t.ok(await cl.eval(() => { const r = document.querySelector('.cpi-reply'); return !!r && r.hidden && getComputedStyle(r).display === 'none'; }), 'the Mark done note stays closed until asked for');
  await cl.eval(() => [...document.querySelectorAll('.cpi-xa .cp-btn')].find(x => x.textContent === 'Mark done').click()); await t.sleep(300);
  t.ok(await cl.eval(() => { const r = document.querySelector('.cpi-reply'); return r && !r.hidden && document.activeElement && document.activeElement.tagName === 'TEXTAREA'; }), 'Mark done opens a short note');
  await cl.eval(() => { const r = document.querySelector('.cpi-reply'); r.querySelector('textarea').value = 'Attendance is now on the sign-in sheet.'; r.querySelector('.cpi-send').click(); }); await t.sleep(2200);
  t.ok(await cl.eval(() => [...document.querySelectorAll('.cp-sec:has(#cpi-act-h) .cpi-s')].some(s => s.textContent === 'Etcher to verify') && !document.querySelector('.cp-sec:has(#cpi-act-h) .cpi-xa .cp-btn')), 'the action shows Etcher to verify, with nothing left to press');
  await cl.eval(() => [...document.querySelectorAll('.cp-sec:has(#cpi-ev-h) .cpi-xa .cp-btn')].find(x => x.textContent === 'Mark sent').click()); await t.sleep(2200);
  t.ok(await cl.eval(() => /Sent, Etcher to review/.test(document.querySelector('.cp-sec:has(#cpi-ev-h)').textContent)), 'Mark sent marks the request');
  const shot = await cl.shot('iso-portal2-client');
  t.eq(shot.phone, 0, 'the answered tab fits a phone');
  t.eq(await cl.eval(() => ISO.portal.needCount()), 0, 'the Overview has no ISO asks left for this login');

  const st = await t.browser();
  await st.openBoard(u.id);
  await st.eval(() => ISO._openReport()); await t.sleep(1400);
  t.ok(await st.eval(() => /asked for a correction/.test((document.querySelector('.iso-rep-resp') || {}).textContent || '') && !!document.querySelector('.iso-rep-resp-d')), 'Etcher sees the answer under the issued version, with Accept and Reject');
  await st.eval(() => document.querySelector('.iso-rep-resp-d .btn-teal').click()); await t.sleep(700);
  t.ok(await st.eval(() => !!document.querySelector('.iso-rep-resp-d') && document.activeElement === document.querySelector('.iso-rep-resp-d input')), 'a decision without a note is stopped at the note box');
  await st.eval(() => { document.querySelector('.iso-rep-resp-d input').value = 'Dates corrected in version 2.'; document.querySelector('.iso-rep-resp-d .btn-teal').click(); }); await t.sleep(2200);
  t.ok(await st.eval(() => /Accepted: Dates corrected in version 2\./.test((document.querySelector('.iso-rep-resp') || {}).textContent || '')), 'the decision and its note are recorded');
  await cl.eval(id => { ISO.portal._reset(); ISO.portal.open(id); }, u.id); await t.sleep(2200);
  t.ok(await cl.eval(() => /Etcher accepted this/.test(document.querySelector('.cpi-ans').textContent) && /Dates corrected in version 2/.test(document.querySelector('.cpi-ans').textContent)), 'the client reads Etcher\'s note');
  t.ok(await cl.eval(() => { const h = document.getElementById('cpi-hist'); return !!h && !h.hidden && /You asked for a correction/.test(h.textContent) && /is done/.test(h.textContent); }), 'Your history shows in the ISO tab');
  t.ok(!/offline:|SENTINEL/.test(await cl.eval(() => document.getElementById('cp-body').innerText)), 'nothing internal on the client\'s screen');
});
