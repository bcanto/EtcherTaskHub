// Release-1 B7c: the client uploads a file from the portal ISO tab (plan 13.6), for an open evidence
// request addressed to them or their own open action. The staff pipeline does the work; the server
// fixes what the client may not choose (shared with the client, draft, linked "not reviewed", via
// the portal). Never for Etcher's actions or someone else's request; never a download. Own server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');
const CU = { id: 'cu1', role: 'client', clientId: 'c1', name: 'Jordan Price' };
const CU2 = H.CLIENT('cu2', 'c1');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

H.run('iso-portal3-test', 3187, async (t, srv) => {
  const A = H.ADMIN;
  const b = await srv.board({ standards: ['9001'], title: 'ISO 9001 internal audit', members: [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }] });
  for (const uid of ['offline:cu1', 'offline:c1']) await srv.must(A, { op: 'member.add', auditId: b.id, uid, auditRole: 'client_contributor', memberKind: 'client' });
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: true }, reason: 'Sharing', expectedVersion: (await srv.must(A, { op: 'audit.get', auditId: b.id }).then(x => x.audit || x)).row_version });
  const r41 = b.key('9001 4.1'), r42 = b.key('9001 4.2');
  const f = await srv.must(AUD, { op: 'finding.create', auditId: b.id, requirementId: r41.id, title: 'Training records incomplete', classification: 'minor_nc', visibility: 'client_all' });
  const mine = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'finding', targetId: f.id, title: 'Record toolbox talk attendance', ownerKind: 'client', visibility: 'client_all' });
  const theirs = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'requirement', targetId: r42.id, title: 'Tighten the complaint procedure', visibility: 'client_all' });
  await srv.must(AUD, { op: 'action.updateStatus', auditId: b.id, id: mine.id, to: 'assigned', expectedVersion: (await srv.must(A, { op: 'action.list', auditId: b.id })).find(x => x.id === mine.id).row_version });
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: 'Send the toolbox talk sheets', requirementIds: [r41.id] }, { documentName: 'Staff-only request', requirementIds: [r42.id], requestedFromUid: 'offline:u3' }] });
  const reqs = await srv.must(A, { op: 'evidenceRequest.list', auditId: b.id });
  const req = reqs.find(x => x.description === 'Send the toolbox talk sheets'), staffReq = reqs.find(x => x.description === 'Staff-only request');
  const start = (u, extra) => srv.call(u, { op: 'portal.uploadStart', auditId: b.id, filename: 'sheets.pdf', size: PDF.length, mime: 'application/pdf', ...extra });

  t.eq((await start(CU, { actionId: theirs.id })).status, 400, 'not for Etcher\'s action');
  t.eq((await start(CU, { requestId: staffReq.id })).status, 404, 'not for a request addressed to someone else');
  t.eq((await start(CU, { requestId: req.id, filename: 'tool.exe', mime: 'application/octet-stream' })).status, 400, 'only the accepted file types');
  t.eq((await start(CU2, { requestId: req.id })).status, 403, 'not for a login not named on the board');
  t.eq((await start(A, { requestId: req.id })).status, 403, 'staff use the Documents tab, not the portal op');

  // ── For the request: start, send, finish ──
  let s = await start(CU, { requestId: req.id, note: 'September and October sheets.', visibility: 'internal', documentStatus: 'approved' });
  t.ok(s.status === 200 && s.data.upload.offline && s.data.upload.evidenceId, 'the upload starts (offline: the bytes go through the API)');
  t.eq((await srv.call(CU, { op: 'portal.uploadPut', auditId: b.id, evidenceId: s.data.upload.evidenceId, dataBase64: PDF.toString('base64') })).status, 200, 'the bytes are sent');
  let fin = await srv.call(CU, { op: 'portal.uploadFinish', auditId: b.id, evidenceId: s.data.upload.evidenceId });
  t.ok(fin.status === 200 && fin.data.upload.title === 'sheets', 'the file is registered');
  t.eq((await srv.call(CU, { op: 'portal.uploadFinish', auditId: b.id, evidenceId: s.data.upload.evidenceId })).status, 400, 'once only');
  const onClause = () => srv.must(A, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: r41.id });
  const ev = (await onClause()).find(x => x.originalFilename === 'sheets.pdf');
  t.ok(ev && ev.uploadedVia === 'portal' && ev.visibility === 'client_all' && ev.documentStatus === 'draft', 'Etcher sees it from the portal, shared, a draft whatever the client sent (' + JSON.stringify(ev && { via: ev.uploadedVia, vis: ev.visibility, st: ev.documentStatus }) + ')');
  t.eq(ev.reviewStatus, 'submitted', 'linked to the requested clause, not yet reviewed');
  t.eq((await srv.must(A, { op: 'evidenceRequest.list', auditId: b.id })).find(x => x.id === req.id).status, 'submitted', 'the request is marked sent');
  t.ok((await srv.must(LEAD, { op: 'notification.list' })).items.some(n => n.type === 'client_response' && /uploaded a file/.test(n.message)), 'the lead auditor is told');
  t.eq((await srv.call(CU, { op: 'evidence.downloadUrl', auditId: b.id, evidenceId: ev.id })).status, 403, 'the client cannot download through the staff op');

  // ── For their own action ──
  s = await start(CU, { actionId: mine.id, filename: 'attendance.pdf' });
  await srv.call(CU, { op: 'portal.uploadPut', auditId: b.id, evidenceId: s.data.upload.evidenceId, dataBase64: PDF.toString('base64') });
  fin = await srv.call(CU, { op: 'portal.uploadFinish', auditId: b.id, evidenceId: s.data.upload.evidenceId });
  const d = (await srv.call(CU, { op: 'portal.board', auditId: b.id })).data;
  t.ok(fin.status === 200 && d.actions.find(a => a.id === mine.id).files.includes('attendance'), 'the action lists the file the client sent');
  t.ok(!JSON.stringify(d).includes('offline:'), 'no user ids in the board');

  // ── What the client is told (13.7, in-app) ──
  const inbox = async u => ((await srv.call(u, { op: 'portal.notifications' })).data || { notifications: [] }).notifications;
  let box = (await inbox(CU)).map(n => n.message);
  t.ok(box.includes(b.ref + ': Etcher asked you for a document.') && box.includes(mine.ref + ': this action is yours to do.'), 'the client is told about the document asked for and the action given to them (' + box.join(' | ') + ')');
  t.ok(!box.some(m => /Tighten|Staff-only/.test(m)), 'nothing about Etcher\'s own work');
  t.eq((await srv.call(A, { op: 'portal.notifications' })).status, 403, 'staff cannot read a client\'s portal notifications');
  t.eq((await inbox(CU2)).length, 0, 'a login not named on the board is told nothing');
  // Etcher returns the action: the client is told.
  const cur = (await srv.must(A, { op: 'action.list', auditId: b.id })).find(x => x.id === mine.id);
  await srv.must(CU, { op: 'portal.actionDone', auditId: b.id, id: mine.id, expectedVersion: cur.row_version });
  const rv = (await srv.must(A, { op: 'review.list', auditId: b.id, actionId: mine.id }))[0];
  await srv.must(LEAD, { op: 'action.decideReview', auditId: b.id, id: rv.id, decision: 'more_info', decisionNote: 'Add the October sheet.' });
  box = await inbox(CU);
  t.ok(box.some(n => n.message === mine.ref + ': Etcher needs more from you on this action.' && !n.read), 'the client is told Etcher needs more, unread');
  // Read: only their own.
  await srv.must(CU2, { op: 'portal.notificationsRead', ids: box.map(n => n.id) }).catch(() => {});
  t.ok((await inbox(CU)).some(n => !n.read), 'another login cannot mark them read');
  await srv.must(CU, { op: 'portal.notificationsRead', ids: box.map(n => n.id) });
  t.ok((await inbox(CU)).every(n => n.read), 'the client marks them read');
  // Portal off: nothing listed, nothing new.
  const au = await srv.must(A, { op: 'audit.get', auditId: b.id }).then(x => x.audit || x);
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: false }, reason: 'Paused', expectedVersion: au.row_version });
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: 'Quiet request', requirementIds: [r41.id] }] });
  t.eq((await inbox(CU)).length, 0, 'portal off: no ISO notifications listed');
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: true }, reason: 'Back on', expectedVersion: au.row_version + 1 });
  t.ok(!(await inbox(CU)).some(n => /asked you for a document/.test(n.message) && !n.read), 'and a request made while it was off told nobody');

  // ── UI: Upload on a request, Add a file on the action ──
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: 'Send the induction register', requirementIds: [r41.id] }] });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iso-p3-')), 'induction register.pdf');
  fs.writeFileSync(file, PDF);
  const cl = await t.browser({ email: 'client@generalcranes.com.au', password: 'ClientPreview1' });
  await t.sleep(1800);
  await cl.eval(id => ISO.portal.open(id), b.id); await t.sleep(1800);
  const btn = (await cl.page.evaluateHandle(() => { const r = [...document.querySelectorAll('.cp-sec:has(#cpi-ev-h) .cpi-x')].find(x => /Send the induction register/.test(x.textContent)); return r && r.querySelector('.cpi-xa .cp-btn.line'); })).asElement();
  t.ok(!!btn && /Upload/.test(await cl.eval(e => e.textContent, btn)), 'an open request has Upload');
  const [chooser] = await Promise.all([cl.page.waitForFileChooser({ timeout: 5000 }), btn.click()]);
  await chooser.accept([file]); await t.sleep(3000);
  t.ok(await cl.eval(() => /Sent, Etcher to review/.test(([...document.querySelectorAll('.cp-sec:has(#cpi-ev-h) .cpi-x')].find(x => /Send the induction register/.test(x.textContent)) || {}).textContent || '')), 'after the upload the request shows as sent');
  t.ok((await onClause()).some(x => x.originalFilename === 'induction register.pdf' && x.uploadedVia === 'portal'), 'Etcher has the file');
  t.ok(await cl.eval(() => /Add a file/.test(document.querySelector('.cp-sec:has(#cpi-act-h)').textContent) && /Files: attendance/.test(document.querySelector('.cp-sec:has(#cpi-act-h)').textContent)), 'the action offers Add a file and lists what was sent');
  // The bell counts the ISO notifications, and the Notifications tab lists them; each opens its board.
  await cl.eval(() => { ISO.portal._reset(); return ISO.portal.load(); }); await t.sleep(500);
  const bell = await cl.eval(() => { const b = document.getElementById('cp-notif-badge'); return { shown: b && b.style.display !== 'none', n: b ? +b.textContent : 0, iso: ISO.portal.notifUnread() }; });
  t.ok(bell.iso > 0 && bell.shown && bell.n >= bell.iso, 'the portal bell counts the unread ISO notifications (' + JSON.stringify(bell) + ')');
  await cl.eval(() => cpNavigate('notifications')); await t.sleep(600);
  const nt = await cl.eval(() => ({ iso: document.querySelectorAll('#cp-body .cp-notif .cpi-notif-i').length, read: ISO.portal.notifUnread() }));
  t.ok(nt.iso > 0 && nt.read === 0, 'the Notifications tab lists them, and viewing marks them read');
  await cl.eval(() => document.querySelector('#cp-body .cp-notif:has(.cpi-notif-i)').click()); await t.sleep(1800);
  t.ok(await cl.eval(() => cpSection === 'iso' && !!document.querySelector('.cpi-head')), 'an ISO notification opens its board');
  const shot = await cl.shot('iso-portal3-client');
  t.eq(shot.phone, 0, 'fits a phone');
});
