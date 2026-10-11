// Release-1 B2 — findings and actions that close properly (D49, D50; plan Q6, Q7).
//   B2.1 action.trackPlan: one action for the ticked clauses, a finding per clause on formal audit
//        types only (statement = basis, criterion = requirement reference, evidence = live documents);
//        a clause already tracked can't be tracked twice; the Actions tab shows the tracked record
//        and hides the derived one.
//   B2.3 a finding closes only when every linked action is closed AND verified effective.
//   B2.4 the Lead reopens a closed finding with a reason (closed -> reopened, counted, badge).
//   B2.5 a finding on a clause with a finding / Non-Compliant on an earlier board is a Repeat.
//   B2.6 audit.startMaintenance is open to the Lead Auditor.
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');
const MGR = H.STAFF('u4');
const VIEWER = H.STAFF('u5');

H.run('iso-closure-test', 3166, async (t, srv) => {
  const A = H.ADMIN;
  const basis = 'Seen the records register; two records lack a signature.';
  const plan = 'Introduce a signed-records check';
  const members = [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }, { id: MGR.id, auditRole: 'audit_manager' }, { id: VIEWER.id, auditRole: 'reviewer' }];
  const auditRow = async board => { const a = await srv.must(A, { op: 'audit.get', auditId: board.id }); return a.audit || a; };
  const setType = async (board, type) => srv.must(A, { op: 'audit.update', auditId: board.id, expectedVersion: (await auditRow(board)).row_version, patch: { audit_type: type } });
  const findings = board => srv.must(A, { op: 'finding.list', auditId: board.id });
  const actions = board => srv.must(A, { op: 'action.list', auditId: board.id });
  const fnd = async (board, id) => (await findings(board)).find(f => f.id === id);
  const act = async (board, id) => (await actions(board)).find(a => a.id === id);
  const moveFinding = async (board, id, op, user = A) => srv.call(user, { op, auditId: board.id, id, expectedVersion: (await fnd(board, id)).row_version });
  const moveAction = async (board, id, to) => srv.must(A, { op: 'action.updateStatus', auditId: board.id, id, to, expectedVersion: (await act(board, id)).row_version });

  // ── B2.1 on a formal (internal) board ─────────────────────────────────────────────────────────
  const b = await srv.board({ standards: ['9001', '14001'], members });
  await setType(b, 'internal');
  await srv.set(b, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: plan });
  await srv.set(b, '14001 4.1', { compliance_status: 'partially_compliant', gap_reason: 'no_evidence', current_system: 'Procedure exists; not followed on site.', recommended_action: plan });
  await srv.set(b, '9001 4.2', { compliance_status: 'compliant', ofi: true, current_system: 'Works; could be quicker.', recommended_action: 'Automate the reminder' });
  await srv.set(b, '9001 4.3', { compliance_status: 'compliant', current_system: 'Fine.' });
  await srv.must(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.1').id, title: 'Records register', url: 'https://example.com/register', versionLabel: 'Rev 3' });

  let res = await srv.call(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.3').id], classification: 'minor_nc' });
  t.ok(res.status === 400 && /not Partial, Non-Compliant or OFI/.test(JSON.stringify(res.body)), `a Compliant clause without OFI can't be tracked (got ${res.status})`);
  res = await srv.call(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id] });
  t.ok(res.status === 400 && /classification/i.test(JSON.stringify(res.body)), `a formal audit needs the finding classification (got ${res.status})`);
  res = await srv.call(VIEWER, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id], classification: 'minor_nc' });
  t.eq(res.status, 403, 'a reviewer cannot track');

  res = await srv.call(AUD, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id, b.key('14001 4.1').id], classification: 'minor_nc' });
  t.eq(res.status, 200, 'an auditor tracks a shared plan across two standards in one call');
  const tracked = res.data.action, trackedF = res.data.findings || [];
  t.ok(tracked.title === plan && tracked.priority === 'high' && tracked.status === 'draft', `the action takes the plan as its title and its priority from the worst status (got "${tracked.title}" / ${tracked.priority} / ${tracked.status})`);
  t.eq(trackedF.length, 2, 'a finding per clause on a formal audit type');
  let a1 = await act(b, tracked.id);
  const reqLinks = a1.links.filter(l => l.target_type === 'requirement').map(l => l.target_id).sort();
  const fLinks = a1.links.filter(l => l.target_type === 'finding').map(l => l.target_id).sort();
  t.eq(reqLinks, [b.key('9001 4.1').id, b.key('14001 4.1').id].sort(), 'the action is linked to both clauses');
  t.eq(fLinks, trackedF.map(f => f.id).sort(), 'and to both findings');
  const allF = await findings(b);
  const f9001 = allF.find(f => f.requirement_id === b.key('9001 4.1').id), f14001 = allF.find(f => f.requirement_id === b.key('14001 4.1').id);
  t.ok(f9001 && f14001, 'each finding keeps its own source clause');
  t.ok(f9001.statement === basis, `the finding's statement is the clause's basis (got ${JSON.stringify(f9001.statement)})`);
  t.ok(/ISO 9001 4\.1/.test(f9001.criteria || ''), `its criterion is the requirement reference (got ${JSON.stringify(f9001.criteria)})`);
  t.ok(/Records register, Rev 3/.test(f9001.evidence_basis || ''), `its evidence basis lists the clause's live documents (got ${JSON.stringify(f9001.evidence_basis)})`);
  t.ok(f9001.classification === 'minor_nc' && /^Non-Compliant — ISO 9001 4\.1/.test(f9001.title) && /^Partially Compliant — ISO 14001 4\.1/.test(f14001.title), `classification and titles (got ${f9001.classification} / "${f9001.title}" / "${f14001.title}")`);
  t.ok(!f9001.repeat_of_ref, 'no earlier board, so not a repeat');
  res = await srv.call(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id], classification: 'minor_nc' });
  t.ok(res.status === 400 && new RegExp(tracked.ref).test(JSON.stringify(res.body)), `a clause already tracked can't be tracked again — the refusal names the action (got ${res.status} ${JSON.stringify(res.body).slice(0, 120)})`);
  const ofiTrack = await srv.must(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.2').id], classification: 'ofi', priority: 'med', ownerUid: 'offline:' + AUD.id, dueDate: '2027-03-31' });
  t.ok(ofiTrack.action.priority === 'med' && ofiTrack.action.owner_uid === 'offline:' + AUD.id && ofiTrack.action.due_date === '2027-03-31', 'owner, due and priority from the panel win over the defaults');

  // ── B2.1 on a gap analysis: actions only ─────────────────────────────────────────────────────
  const g = await srv.board({ standards: ['9001'], title: 'Gap analysis' });
  await srv.set(g, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: basis, recommended_action: plan });
  res = await srv.call(A, { op: 'action.trackPlan', auditId: g.id, requirementIds: [g.key('9001 4.1').id], classification: 'minor_nc' });
  t.ok(res.status === 400 && /actions only/.test(JSON.stringify(res.body)), `a gap analysis refuses a classification — it records no findings (got ${res.status})`);
  res = await srv.call(A, { op: 'action.trackPlan', auditId: g.id, requirementIds: [g.key('9001 4.1').id] });
  t.ok(res.status === 200 && res.data.findings.length === 0 && (await findings(g)).length === 0, 'a gap analysis tracks the action with no finding');

  // ── B2.3 closure rule ─────────────────────────────────────────────────────────────────────────
  await moveFinding(b, f9001.id, 'finding.release'); await moveFinding(b, f9001.id, 'finding.finalize');
  res = await moveFinding(b, f9001.id, 'finding.close');
  t.ok(res.status === 400 && new RegExp(tracked.ref).test(JSON.stringify(res.body)) && /draft/.test(JSON.stringify(res.body)), `a finding with an open action can't close; the refusal names the action and its status (got ${res.status} ${JSON.stringify(res.body).slice(0, 160)})`);
  for (const to of ['assigned', 'in_progress', 'submitted_for_review', 'ready_for_verification']) await moveAction(b, tracked.id, to);
  await srv.must(A, { op: 'action.verify', auditId: b.id, id: tracked.id, result: 'effective', expectedVersion: (await act(b, tracked.id)).row_version });
  await moveAction(b, tracked.id, 'verified');
  res = await moveFinding(b, f9001.id, 'finding.close');
  t.ok(res.status === 400 && /verified/.test(JSON.stringify(res.body)), `verified but not closed still blocks (got ${res.status})`);
  await moveAction(b, tracked.id, 'closed');
  res = await moveFinding(b, f9001.id, 'finding.close');
  t.eq(res.status, 200, 'with its action closed and verified effective, the finding closes');
  // An action closed without an effective verification still blocks.
  const fOfi = ofiTrack.findings[0];
  await moveFinding(b, fOfi.id, 'finding.release'); await moveFinding(b, fOfi.id, 'finding.finalize');
  for (const to of ['assigned', 'in_progress', 'submitted_for_review', 'ready_for_verification', 'verified', 'closed']) await moveAction(b, ofiTrack.action.id, to);
  res = await moveFinding(b, fOfi.id, 'finding.close');
  t.ok(res.status === 400 && /not verified effective/.test(JSON.stringify(res.body)), `a closed action that was never verified effective blocks closure (got ${res.status} ${JSON.stringify(res.body).slice(0, 140)})`);

  // ── B2.4 reopen ───────────────────────────────────────────────────────────────────────────────
  const reopen = async (user, extra) => srv.call(user, { op: 'finding.reopen', auditId: b.id, id: f9001.id, expectedVersion: (await fnd(b, f9001.id)).row_version, reasonCode: 'recurred', ...extra });
  t.eq((await reopen(AUD)).status, 403, 'an auditor cannot reopen a finding');
  t.eq((await reopen(MGR)).status, 403, 'nor can the audit manager — Lead only');
  t.eq((await reopen(LEAD, { reasonCode: 'because' })).status, 400, 'an unknown reason is refused');
  res = await reopen(LEAD, { reasonText: 'Seen again in the March sample' });
  t.eq(res.status, 200, 'the Lead reopens a closed finding with a reason');
  let fr = await fnd(b, f9001.id);
  t.ok(fr.status === 'reopened' && fr.reopened_count === 1 && fr.reopen_reason === 'recurred: Seen again in the March sample' && !fr.closed_at, `closed -> reopened, counted, reason kept, closing stamp cleared (got ${fr.status} / ${fr.reopened_count} / ${fr.reopen_reason} / ${fr.closed_at})`);
  t.eq((await reopen(LEAD)).status, 400, 'a reopened finding cannot be reopened again until it closes');
  const hist = await srv.must(A, { op: 'activity.list', auditId: b.id });
  t.ok(hist.some(h => h.entity_id === f9001.id && h.action === 'reopened' && /recurred/.test(h.reason || '')), 'the reopen is in the history with its reason');
  t.ok((await srv.must(A, { op: 'finding.list', auditId: b.id, filter: { entity: 'finding', where: [{ field: 'status', op: 'in', value: ['reopened'] }] } })).length === 1, 'a reopened finding is listable by its status');
  t.eq((await moveFinding(b, f9001.id, 'finding.close')).status, 200, 'a reopened finding closes again under the same rule');

  // ── B2.6 + B2.5 next year's board ─────────────────────────────────────────────────────────────
  await srv.set(b, '9001 4.4', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: 'No procedure.' });
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch: { stage: 'closed' } });
  t.eq((await srv.call(AUD, { op: 'audit.startMaintenance', auditId: b.id })).status, 403, 'an auditor cannot start the maintenance board');
  res = await srv.call(LEAD, { op: 'audit.startMaintenance', auditId: b.id });
  t.eq(res.status, 200, 'the Lead Auditor starts the maintenance board (B2.6)');
  const nb = res.data.audit;
  await srv.refresh(nb);
  await srv.set(nb, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: 'Still unsigned.', recommended_action: plan });
  const rep = await srv.must(A, { op: 'action.trackPlan', auditId: nb.id, requirementIds: [nb.key('9001 4.1').id], classification: 'minor_nc' });
  t.eq(rep.findings[0].repeat_of_ref, `${b.ref} / ${f9001.ref}`, 'a finding on a clause that had a finding last time is a repeat, naming it');
  const hand = await srv.must(A, { op: 'finding.create', auditId: nb.id, requirementId: nb.key('9001 4.4').id, title: 'Still no procedure', classification: 'minor_nc' });
  t.eq(hand.repeat_of_ref, `${b.ref} / ISO 9001 4.4`, 'a hand-raised finding on a clause that was Non-Compliant last time is a repeat too');
  const fresh = await srv.must(A, { op: 'finding.create', auditId: nb.id, requirementId: nb.key('9001 4.3').id, title: 'New issue', classification: 'observation' });
  t.ok(!fresh.repeat_of_ref, 'a clause that was fine last time is not a repeat');

  // ── UI ────────────────────────────────────────────────────────────────────────────────────────
  const u = await srv.board({ standards: ['9001'], title: 'Track UI', members });
  await setType(u, 'internal');
  const shared = 'Train the document controllers';
  await srv.set(u, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: shared });
  await srv.set(u, '9001 4.2', { compliance_status: 'partially_compliant', gap_reason: 'no_evidence', current_system: basis, recommended_action: shared });
  const ui = await t.browser();
  await ui.openBoard(u.id); await ui.tab('requirements');
  const oneId = u.key('9001 4.1').id;
  if (!(await ui.eval(id => !!document.querySelector(`[data-ireq="${id}"] .iso-track-btn`), oneId))) { await ui.eval(id => ISO._reqToggleExpand(id), oneId); await t.sleep(900); }
  await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-track-btn`).click(), oneId); await t.sleep(500);
  const fromRow = await ui.eval(() => [...document.querySelectorAll('.iso-trk-cb')].filter(c => c.checked).map(c => c.value));
  t.ok(fromRow.length === 2 && fromRow.includes(u.key('9001 4.2').id), `Track › on one clause pre-ticks every open clause sharing its plan (got ${fromRow.length})`);
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  await ui.tab('worklist');
  const rowsFor = () => ui.eval(p => [...document.querySelectorAll('#iso-wl-tab .iso-wl-row')].filter(r => r.querySelector('.iso-wl-plan')?.textContent.trim() === p).map(r => ({ tracked: !!r.querySelector('button.iso-wl-plan.is-link'), track: !!r.querySelector('.iso-track-btn'), state: r.querySelector('.iso-wl-state')?.textContent.trim() || '' })), shared);
  let rows = await rowsFor();
  t.ok(rows.length === 1 && !rows[0].tracked && rows[0].track, `the shared plan is one derived row with Track › (got ${JSON.stringify(rows)})`);
  await ui.eval(() => document.querySelector('#iso-wl-tab .iso-track-btn').click()); await t.sleep(500);
  const panel = await ui.eval(() => ({ ticked: [...document.querySelectorAll('.iso-trk-cb')].filter(c => c.checked).length, prio: document.getElementById('trk-prio')?.value, cls: document.getElementById('trk-class')?.value || null }));
  t.ok(panel.ticked === 2 && panel.prio === 'high' && panel.cls === 'minor_nc', `the panel pre-ticks both clauses, priority from the worst status, a classification on a formal board (got ${JSON.stringify(panel)})`);
  const shots = await ui.shot('b2-track-panel');
  t.ok(shots.desktop <= 0 && shots.phone <= 0, `the Track panel fits at desktop and 390px (overflow ${JSON.stringify(shots)})`);
  await ui.size(390, 844);
  const fit = await ui.eval(() => { const b = document.getElementById('trk-go').getBoundingClientRect(); const tr = document.querySelector('.iso-track'); const fs = document.querySelector('.iso-track-clauses').getBoundingClientRect(), t2 = tr.getBoundingClientRect(); return { right: Math.round(b.right), inner: Math.round(Math.max(tr.scrollWidth - tr.clientWidth, fs.right - t2.right, b.right - t2.right)), vw: innerWidth }; });
  t.ok(fit.right <= fit.vw && fit.inner <= 0, `at 390px the panel's content and its Track button stay on screen (got ${JSON.stringify(fit)})`);
  await ui.size(1440, 1000);
  await ui.eval(() => ISO._trackApply()); await t.sleep(1500);
  rows = await rowsFor();
  t.ok(rows.length === 1 && rows[0].tracked && !rows[0].track && /Draft/.test(rows[0].state), `afterwards the Actions tab shows the tracked record and hides the derived one — never two (got ${JSON.stringify(rows)})`);
  const uActs = await actions(u);
  t.ok(uActs.length === 1 && uActs[0].links.filter(l => l.target_type === 'finding').length === 2, 'one action, two findings created from the panel');
  await ui.shot('b2-actions-tracked');
  await ui.tab('requirements');
  const markOf = id => ui.eval(x => document.querySelector(`[data-ireq="${x}"] .iso-tracked`)?.textContent.replace(/\s+/g, ' ').trim() || '', id);
  let mark = await markOf(u.key('9001 4.1').id);
  if (!mark) { await ui.eval(id => ISO._reqToggleExpand(id), u.key('9001 4.1').id); await t.sleep(900); mark = await markOf(u.key('9001 4.1').id); }
  t.ok(mark.startsWith('Tracked') && mark.includes(uActs[0].ref), `the clause shows what tracks it instead of Track › (got "${mark}")`);
  await ui.shot('b2-clause-tracked');
  // Gap analysis: no classification in the panel.
  await srv.set(g, '9001 4.2', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: basis, recommended_action: 'Write the procedure' });
  await ui.openBoard(g.id); await ui.tab('worklist');
  await ui.eval(() => document.querySelector('#iso-wl-tab .iso-track-btn')?.click()); await t.sleep(500);
  t.ok(await ui.eval(() => !!document.querySelector('.iso-trk-cb') && !document.getElementById('trk-class')), 'on a gap analysis the panel asks no classification');
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  // Findings: Reopened badge and the Lead's Reopen button; Repeat badge next year.
  await ui.openBoard(b.id); await ui.tab('findings');
  t.ok(await ui.eval(() => [...document.querySelectorAll('.iso-fnd-badge.is-reopened')].some(x => /Reopened/.test(x.textContent))), 'the findings list shows a Reopened badge');
  await ui.eval((aid, id) => ISO.openFindingDrawer(aid, id), b.id, f9001.id); await t.sleep(900);
  t.ok(await ui.eval(() => [...document.querySelectorAll('#iso-drawer-body button')].some(x => x.textContent.trim() === 'Reopen')), 'a closed finding offers Reopen to the Lead (admin here)');
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  await ui.openBoard(nb.id); await ui.tab('findings');
  t.ok(await ui.eval(() => document.querySelectorAll('.iso-fnd-badge.is-repeat').length >= 2), 'next year\'s findings show the Repeat badge');
  await ui.shot('b2-findings-repeat');
});
