// Release-1 B7a: the client portal ISO Audits tab (plan Phase 13). A client sees a board only while its
// client portal is on and they are named on it; results come from the issued report; only shared actions
// and requests addressed to them; never an internal field (sentinel sweep). Etcher side: the board's
// Client portal switch (reason required) and "The client" as an action owner. Own offline server.
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');
const CU = H.CLIENT('cu1', 'c1');
const CU2 = H.CLIENT('cu2', 'c1');
const OTHER = H.CLIENT('cx1', 'c2');

H.run('iso-portal-test', 3184, async (t, srv) => {
  const A = H.ADMIN;
  const members = [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }];
  const b = await srv.board({ standards: ['9001'], title: 'ISO 9001 internal audit', members });
  const audit = async () => srv.must(A, { op: 'audit.get', auditId: b.id }).then(x => x.audit || x);
  const boardsOf = async u => (await srv.call(u, { op: 'portal.boards' }));

  // ── Not shared yet ──
  t.eq((await boardsOf(CU)).data.boards.length, 0, 'before sharing, the client has no ISO boards');
  t.eq((await srv.call(CU, { op: 'portal.board', auditId: b.id })).status, 403, 'and cannot open this one');
  t.eq((await srv.call(A, { op: 'portal.boards' })).status, 403, 'staff cannot call the portal ops');

  // ── Share it: one named login, a reason required ──
  const users = await srv.must(A, { op: 'clientUser.list', clientId: 'c1' });
  t.ok(users.some(u => u.uid === 'offline:c1' && /local preview/.test(u.name)), 'the local preview login is offered beside the fixtures');
  await srv.must(A, { op: 'member.add', auditId: b.id, uid: 'offline:cu1', auditRole: 'client_contributor', memberKind: 'client' });
  t.eq((await srv.call(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: true }, expectedVersion: (await audit()).row_version })).status, 400, 'turning the portal on needs a reason');
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: true, internal_notes: 'SENTINEL-audit-notes' }, reason: 'Sharing with the client', expectedVersion: (await audit()).row_version });
  let mine = (await boardsOf(CU)).data;
  t.ok(mine.boards.length === 1 && mine.boards[0].ref === b.ref && mine.boards[0].standards[0].startsWith('ISO 9001'), 'shared and named: the board is in the client\'s list');
  t.eq((await boardsOf(CU2)).data.boards.length, 0, 'another login of the same client who is not named sees nothing');
  t.eq((await boardsOf(OTHER)).data.boards.length, 0, 'another client sees nothing');
  t.eq((await srv.call(CU2, { op: 'portal.board', auditId: b.id })).status, 403, 'a login not named cannot open it');
  t.eq((await srv.call(OTHER, { op: 'portal.board', auditId: b.id })).status, 403, 'another client cannot open it');

  // ── Fixture: shared and internal records, with sentinels in every internal place ──
  const r41 = b.key('9001 4.1'), r42 = b.key('9001 4.2');
  await srv.set(b, '9001 4.1', { compliance_status: 'compliant', ofi: true, current_system: 'Seen the register and two signed records.', internal_notes: 'SENTINEL-internal_notes' }, AUD);
  const fVis = await srv.must(AUD, { op: 'finding.create', auditId: b.id, requirementId: r41.id, title: 'Load cells not in the register', classification: 'minor_nc', visibility: 'client_all' });
  const fHid = await srv.must(AUD, { op: 'finding.create', auditId: b.id, requirementId: r42.id, title: 'SENTINEL-hidden-finding', classification: 'observation', visibility: 'internal' });
  const aMine = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'finding', targetId: fVis.id, title: 'Add load-cell calibration to the equipment register', ownerKind: 'client', dueDate: '2026-01-10', visibility: 'client_all' });
  const aEtcher = await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'requirement', targetId: r42.id, title: 'Tighten the complaint procedure', dueDate: '2027-02-01', visibility: 'client_all' });
  await srv.must(AUD, { op: 'action.create', auditId: b.id, targetType: 'finding', targetId: fHid.id, title: 'SENTINEL-internal-action', visibility: 'internal' });
  const cur = id => srv.must(A, { op: 'action.list', auditId: b.id }).then(l => l.find(x => x.id === id));
  await srv.must(AUD, { op: 'action.update', auditId: b.id, id: aMine.id, patch: { auditor_review_note: 'SENTINEL-auditor_review_note', correction: 'SENTINEL-correction', containment: 'SENTINEL-containment' }, expectedVersion: (await cur(aMine.id)).row_version });
  await srv.must(AUD, { op: 'action.updateStatus', auditId: b.id, id: aMine.id, to: 'assigned', expectedVersion: (await cur(aMine.id)).row_version });
  await srv.must(AUD, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: 'Send the calibration certificates', requirementIds: [r41.id], dueDate: '2026-11-20' }, { documentName: 'SENTINEL-staff-request', requirementIds: [r42.id], requestedFromUid: 'offline:u3' }] });

  let d = (await srv.call(CU, { op: 'portal.board', auditId: b.id })).data;
  t.ok(d && d.board.ref === b.ref && d.lead === 'Sam Wignall', 'the client opens the board with its lead auditor named');
  t.eq(d.actions.map(a => a.ref).sort(), [aEtcher.ref, aMine.ref].sort(), 'only the actions shared with the client');
  const m = d.actions.find(a => a.id === aMine.id);
  t.ok(m.mine && m.finding && m.finding.ref === fVis.ref && m.finding.classification === 'minor_nc' && /^4\.1 /.test(m.clause || ''), 'their own action, named with its shared finding and that finding\'s clause');
  t.ok(!d.actions.find(a => a.id === aEtcher.id).mine && /^4\.2/.test(d.actions.find(a => a.id === aEtcher.id).clause), 'Etcher\'s action shows its clause');
  t.eq(d.requests.map(r => r.description), ['Send the calibration certificates'], 'only evidence requests for the client');
  t.eq(d.results, null, 'no results before the report is issued');
  mine = (await boardsOf(CU)).data;
  t.eq(mine.needs.map(n => n.kind).sort(), ['action', 'request'], 'Needs you: their open action and the evidence request');

  // ── Issue the report: results come from it ──
  // A linked document, so the report carries link stamps (who linked it, when) to strip.
  await srv.must(AUD, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: r41.id, title: 'Equipment register', url: 'https://example.com/register', kind: 'link' });
  const r1 = await srv.row(b, '9001 4.1');
  await srv.must(LEAD, { op: 'requirement.approve', auditId: b.id, id: r1.id, expectedVersion: r1.row_version });
  await srv.must(AUD, { op: 'report.saveDraft', auditId: b.id, sections: { executiveSummary: 'Mostly in place.' } });
  const v1 = await srv.must(LEAD, { op: 'report.issue', auditId: b.id });
  d = (await srv.call(CU, { op: 'portal.board', auditId: b.id })).data;
  t.ok(d.results && d.results.counts.compliant === 1 && d.results.counts.ofi === 1 && d.results.counts.non_compliant === 0, 'results come from the issued report (' + JSON.stringify(d.results && d.results.counts) + ')');
  t.ok(d.reports.length === 1 && d.reports[0].id === v1.id && !d.reports[0].acknowledgement, 'the issued report is listed, not yet acknowledged');
  t.ok((await boardsOf(CU)).data.needs.some(n => n.kind === 'report'), 'an unacknowledged report needs the client');
  const rep = await srv.call(CU, { op: 'portal.report', auditId: b.id, versionId: v1.id });
  t.ok(rep.status === 200 && rep.data.version.content.audit.ref === b.ref && rep.data.version.content.snapshot.clauses.length > 0, 'the client downloads the issued report');
  const repJson = JSON.stringify(rep.data);
  t.ok(rep.data.version.content.snapshot.clauses.some(c => c.documents.some(x => x.title === 'Equipment register')), 'the report lists the linked document');
  t.ok(!/linkedBy|linkedAt|sha256|approval|"by"/.test(repJson), 'the report download drops link stamps, hashes and approvals');
  t.ok(!repJson.includes('SENTINEL-hidden-finding') && !repJson.includes('SENTINEL-internal-action'), 'internal findings and actions are not in the client\'s copy');
  const other = await srv.board({ standards: ['9001'], title: 'Other board' });
  t.eq((await srv.call(CU, { op: 'portal.report', auditId: other.id, versionId: v1.id })).status, 403, 'a report through a board the client cannot open: refused');
  await srv.must(A, { op: 'report.acknowledge', auditId: b.id, versionId: v1.id, name: 'Jordan Price', date: '2026-10-15' });
  d = (await srv.call(CU, { op: 'portal.board', auditId: b.id })).data;
  t.ok(d.reports[0].acknowledgement && d.reports[0].acknowledgement.name === 'Jordan Price', 'the acknowledgement shows');
  t.ok(!(await boardsOf(CU)).data.needs.some(n => n.kind === 'report'), 'and the report no longer needs the client');

  // ── Sentinel sweep over every portal op ──
  const sweep = [await srv.call(CU, { op: 'portal.boards' }), await srv.call(CU, { op: 'portal.board', auditId: b.id }), rep];
  t.ok(sweep.every(r => r.status === 200 && !JSON.stringify(r.body).includes('SENTINEL')), 'no portal op returns any internal value (sentinel sweep)');
  t.ok(sweep.every(r => !/offline:u\d|owner_uid|visible_to_uids|internal_notes/.test(JSON.stringify(r.body))), 'no staff ids or internal field names either');
  // Clients still cannot reach staff-only ops.
  for (const [op, extra] of [['report.list', {}], ['report.get', {}], ['evidenceRequest.list', {}], ['audit.update', { patch: { stage: 'closed' }, expectedVersion: 1 }]]) {
    t.eq((await srv.call(CU, { op, auditId: b.id, ...extra })).status, 403, `a client is refused ${op}`);
  }

  // ── Turning it off hides it again; the named login stays for next time ──
  await srv.must(A, { op: 'audit.update', auditId: b.id, patch: { client_portal_enabled: false }, reason: 'Paused', expectedVersion: (await audit()).row_version });
  t.eq((await boardsOf(CU)).data.boards.length, 0, 'portal off: the board leaves the client\'s list');
  t.eq((await srv.call(CU, { op: 'portal.board', auditId: b.id })).status, 403, 'and cannot be opened');
  t.ok((await srv.must(A, { op: 'member.list', auditId: b.id })).some(x => x.user_uid === 'offline:cu1'), 'the named login is kept');

  // ── Etcher side UI: the switch, the logins, the client owner ──
  const ui = await t.browser();
  await ui.openBoard(b.id);
  t.ok(/Client portal off/.test(await ui.eval(() => (document.querySelector('.iso-portal-btn') || {}).textContent || '')), 'the board header shows the Client portal switch, off');
  await ui.eval(() => ISO.openClientPortal()); await t.sleep(900);
  const dlg = await ui.eval(() => ({ names: [...document.querySelectorAll('.iso-cps-u')].map(c => c.closest('label').textContent.trim()), ticked: [...document.querySelectorAll('.iso-cps-u')].filter(c => c.checked).map(c => c.value), off: document.getElementById('iso-cps-who').disabled }));
  t.ok(dlg.names.some(n => /local preview/.test(n)) && dlg.ticked.join() === 'offline:cu1' && dlg.off, 'the dialog lists the client\'s logins, keeps who was named, and is greyed while off');
  // Switch on without a reason: refused. Then add the preview login with a reason.
  await ui.eval(() => { document.getElementById('iso-cps-on').checked = true; ISO._cpsSet(true); }); await ui.eval(() => ISO._cpsSave()); await t.sleep(700);
  t.ok(!(await audit()).client_portal_enabled && await ui.eval(() => document.activeElement && document.activeElement.id === 'iso-cps-why'), 'Save without a reason does not change sharing and asks for the reason');
  await ui.eval(() => { document.querySelector('.iso-cps-u[value="offline:c1"]').checked = true; document.getElementById('iso-cps-why').value = 'Report issued'; ISO._cpsSave(); }); await t.sleep(2600);
  const after = await audit();
  const named = (await srv.must(A, { op: 'member.list', auditId: b.id })).filter(x => x.member_kind === 'client').map(x => x.user_uid).sort();
  t.ok(after.client_portal_enabled && named.join() === 'offline:c1,offline:cu1', 'Save turns the portal on and names the ticked logins (' + named.join() + ')');
  t.ok(/Client portal on/.test(await ui.eval(() => (document.querySelector('.iso-portal-btn') || {}).textContent || '')), 'the header now says on');
  const shotStaff = await ui.shot('iso-portal-staff');
  t.eq(shotStaff.phone, 0, 'the board header with the switch fits a phone');
  await ui.tab('actions');
  await ui.eval((a, id) => ISO.openActionDrawer(a, id), b.id, aMine.id); await t.sleep(1200);
  const own = await ui.eval(() => { const s = document.getElementById('ad-owner'); return s ? { v: s.value, has: !![...s.options].find(o => o.value === '__client' && o.textContent === 'The client') } : null; });
  t.ok(own && own.has && own.v === '__client', 'an action can be owned by the client, and shows it');
  await ui.eval(() => { const c = document.querySelector('#generic-modal .modal-close, #generic-modal [onclick*="closeGenericModal"]'); if (c) c.click(); else closeGenericModal(); }); await t.sleep(300);

  // ── Client side UI: the local preview login sees the tab, the Overview asks and the audit ──
  const cl = await t.browser({ email: 'client@generalcranes.com.au', password: 'ClientPreview1' });
  await t.sleep(1800);
  const tab = await cl.eval(() => ({ portal: !document.getElementById('client-portal').classList.contains('hidden'), iso: (document.getElementById('cp-tab-iso') || {}).style ? document.getElementById('cp-tab-iso').style.display !== 'none' : false, needs: document.querySelectorAll('#cp-attn .cpi-need').length, eng: !!document.querySelector('.cpi-eng') }));
  t.ok(tab.portal && tab.iso, 'the preview login sees the ISO Audits tab');
  t.ok(tab.needs === 2 && tab.eng, 'the Overview lists their ISO asks in Waiting on you, and ISO audits as an engagement (' + tab.needs + ')');
  await cl.eval(() => cpNavigate('iso')); await t.sleep(1600);
  const v = await cl.eval(() => ({
    list: document.querySelectorAll('.cpi-a').length, title: (document.querySelector('.cpi-head h1') || {}).textContent,
    res: [...document.querySelectorAll('.cpi-rk b')].map(x => x.textContent).join(','), ack: (document.querySelector('.cpi-ack') || {}).textContent || '',
    acts: [...document.querySelectorAll('#cpi-act-h ~ .cpi-sheet .cpi-x, .cp-sec:has(#cpi-act-h) .cpi-x')].length,
    you: [...document.querySelectorAll('.cp-sec:has(#cpi-act-h) .cpi-s.you')].map(x => x.textContent), late: document.querySelectorAll('.cp-sec:has(#cpi-act-h) .cpi-due.late').length,
    reqs: document.querySelectorAll('.cp-sec:has(#cpi-ev-h) .cpi-x').length,
  }));
  t.ok(v.list === 1 && v.title === 'ISO 9001 internal audit', 'the ISO tab lists the audit and opens it');
  t.eq(v.res, '1,0,0,1,0', 'results from the issued report: compliant, partial, non-compliant, OFI, N/A');
  t.ok(/Received and discussed by Jordan Price/.test(v.ack), 'the report shows its acknowledgement');
  t.ok(v.acts === 2 && v.you.join() === 'Needs you' && v.late === 1, 'two actions, the client\'s own marked Needs you and overdue');
  t.eq(v.reqs, 1, 'the evidence request is listed');
  const shotCl = await cl.shot('iso-portal-client');
  t.eq(shotCl.phone, 0, 'the ISO tab fits a phone');
  t.eq(shotCl.desktop, 0, 'and a desktop');
  await cl.eval(() => { window.__pdf = null; ISO._repPdf = x => { window.__pdf = x; }; }); await cl.eval(() => document.querySelector('.cpi-rep .cp-btn').click()); await t.sleep(900);
  t.ok(await cl.eval(id => !!(window.__pdf && window.__pdf.id === id && window.__pdf.content.audit), v1.id), 'Download PDF fetches the client\'s copy of the issued report');
  const txt = await cl.eval(() => document.getElementById('cp-body').innerText);
  t.ok(!/SENTINEL|offline:/.test(txt), 'nothing internal on the client\'s screen');
});
