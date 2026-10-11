// Release-1 B4 — follow-ups and programme (Q8–Q10, Q13).
//   B4.1 audit setup saved on the board; B4.2 audit.startFollowUp (follow-up scope → every other clause
//   Out of scope; carried items say where they came from; a Lead; startMaintenance still works);
//   B4.3 carry-forward labels; B4.4 programme.get + page; B4.5 client settings; B4.6 evidence requests;
//   B4.7 the on-site audit pack.
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');
const OUTSIDER = H.STAFF('u5');

H.run('iso-programme-test', 3172, async (t, srv) => {
  const A = H.ADMIN;
  const basis = 'Seen the register.';
  const members = [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }];
  const auditRow = async b => { const a = await srv.must(A, { op: 'audit.get', auditId: b.id }); return a.audit || a; };
  const update = async (b, patch, user = A) => srv.call(user, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch });

  // ── B4.1 audit setup ──────────────────────────────────────────────────────────────────────────
  const b = await srv.board({ standards: ['9001'], title: 'Year one', members });
  let res = await update(b, { setup: { objective: 'Check readiness', scope: 'Head office', criteria: 'Client procedures', sites: ['iunit_x', 'bad id!'], limitations: 'No site visit', opening: { date: '2026-10-01', attendees: 'GM, QA', notes: 'Agreed plan' }, closing: { date: 'nope' } } });
  t.ok(res.status === 400 && /date/.test(JSON.stringify(res.body)), `a bad meeting date is refused (got ${res.status})`);
  res = await update(b, { setup: { objective: 'Check readiness', scope: 'Head office', criteria: 'Client procedures', sites: ['iunit_x', 'bad id!'], limitations: 'No site visit', opening: { date: '2026-10-01', attendees: 'GM, QA', notes: 'Agreed plan' }, extra: 'dropped' } });
  t.eq(res.status, 200, 'the audit setup saves');
  const su = (await auditRow(b)).setup;
  t.ok(su.objective === 'Check readiness' && su.opening.attendees === 'GM, QA' && JSON.stringify(su.sites) === '["iunit_x"]' && !('extra' in su) && su.closing === null, `stored cleaned: unknown keys and invalid site ids dropped (got ${JSON.stringify(su)})`);
  t.eq((await update(b, { audit_type: 'made_up' })).status, 400, 'an unknown audit type is refused');
  t.eq((await update(b, { setup: { objective: 'x' } }, AUD)).status, 403, 'an auditor cannot edit the setup');

  // ── fixtures on year one: findings, actions, gaps; then close it ──────────────────────────────
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch: { audit_type: 'internal' } });
  await srv.set(b, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Fix 4.1' });
  await srv.set(b, '9001 4.2', { compliance_status: 'partially_compliant', gap_reason: 'no_evidence', current_system: basis, recommended_action: 'Fix 4.2' });
  await srv.set(b, '9001 4.3', { compliance_status: 'compliant', current_system: basis });
  const t1 = await srv.must(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id], classification: 'minor_nc' });
  const t2 = await srv.must(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.2').id], classification: 'observation' });
  await srv.must(A, { op: 'action.update', auditId: b.id, id: t1.action.id, expectedVersion: t1.action.row_version, patch: { due_date: '2026-01-15', effectiveness_review_date: '2026-10-20' } });
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch: { stage: 'closed', maintenance_due: '2026-11-15' } });

  // ── B4.6 evidence requests (on year one, before it is followed up) ────────────────────────────
  const docs0 = await srv.must(A, { op: 'document.list', auditId: b.id });
  const doc = docs0.find(d => !d.clauses.some(c => c.provided));
  t.eq((await srv.call(A, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: '', requirementIds: [] }] })).status, 400, 'a request needs a document and its clauses');
  const er = await srv.must(A, { op: 'evidenceRequest.create', auditId: b.id, items: [{ documentName: doc.name, requirementIds: doc.clauses.map(c => c.requirementId), dueDate: '2026-11-01' }] });
  t.ok(er.created === doc.clauses.length && er.rows.every(r => r.status === 'open' && r.description === doc.name && r.due_date === '2026-11-01'), `one open request row per clause the document serves (${er.created})`);
  const docs1 = await srv.must(A, { op: 'document.list', auditId: b.id });
  t.ok(!!docs1.find(d => d.name === doc.name).requestedAt, 'the document shows when it was requested');
  const erList = await srv.must(A, { op: 'evidenceRequest.list', auditId: b.id });
  const upd = await srv.must(A, { op: 'evidenceRequest.update', auditId: b.id, id: erList[0].id, status: 'submitted', expectedVersion: erList[0].row_version });
  t.ok(upd.status === 'submitted', 'a request can be marked submitted');

  // ── B4.2 follow-up ────────────────────────────────────────────────────────────────────────────
  const f1 = t1.findings[0], f2 = t2.findings[0];
  t.eq((await srv.call(A, { op: 'audit.startFollowUp', auditId: b.id, type: 'follow_up', scope: {} })).status, 400, 'a follow-up needs at least one item in scope');
  t.eq((await srv.call(AUD, { op: 'audit.startFollowUp', auditId: b.id, type: 'follow_up', scope: { findingIds: [f1.id] } })).status, 403, 'an auditor cannot start one');
  res = await srv.call(LEAD, { op: 'audit.startFollowUp', auditId: b.id, type: 'follow_up', scope: { findingIds: [f1.id] }, plannedStart: '2026-12-01', leadUid: 'offline:' + LEAD.id });
  t.eq(res.status, 200, 'the Lead starts a follow-up scoped to one finding');
  const fu = res.data.audit;
  const fuRow = await srv.must(A, { op: 'audit.get', auditId: fu.id });
  const fuA = fuRow.audit || fuRow;
  t.ok(fuA.audit_type === 'follow_up' && fuA.planned_start === '2026-12-01' && fuA.previous_audit_id === b.id && JSON.stringify(fuA.follow_up_scope.findingIds) === JSON.stringify([f1.id]), `type follow_up, planned date, linked, scope kept (got ${fuA.audit_type} / ${fuA.planned_start})`);
  const fuReqs = await srv.must(A, { op: 'requirement.list', auditId: fu.id });
  const inScope = fuReqs.filter(r => r.compliance_status !== 'out_of_scope');
  t.ok(inScope.length === 1 && inScope[0].clause === '4.1' && res.data.summary.outOfScope === fuReqs.length - 1, `only the finding's clause stays in scope; every other clause is Out of scope (in scope: ${inScope.map(r => r.clause).join(',')})`);
  const fuF = await srv.must(A, { op: 'finding.list', auditId: fu.id });
  t.ok(fuF.length === 1 && fuF[0].carried_from_ref === `${b.ref} / ${f1.ref}`, 'only the chosen finding is carried over');
  const meta = fuF[0].carried_meta || {};
  t.ok(meta.auditRef === b.ref && meta.ref === f1.ref && meta.status === f1.status && meta.by && meta.at, `it records where it came from — audit, finding, status, who, when (got ${JSON.stringify(meta)})`);
  const fuActs = await srv.must(A, { op: 'action.list', auditId: fu.id });
  t.ok(fuActs.length === 0, 'actions outside the scope are not carried');
  const fuMembers = await srv.must(A, { op: 'member.list', auditId: fu.id });
  t.ok(fuMembers.some(m => m.user_uid === 'offline:' + LEAD.id && m.audit_role === 'lead_auditor'), 'the chosen Lead leads the follow-up');
  t.ok((await srv.call(A, { op: 'audit.startFollowUp', auditId: b.id, type: 'maintenance' })).status === 400, 'a board followed up once cannot start another');

  // startMaintenance (alias) on a second closed board: everything in scope, action carried with its origin.
  const y = await srv.board({ standards: ['9001'], title: 'Other year', members });
  await srv.set(y, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Fix it' });
  await srv.set(y, '9001 4.2', { compliance_status: 'compliant', current_system: basis });
  const yt = await srv.must(A, { op: 'action.trackPlan', auditId: y.id, requirementIds: [y.key('9001 4.1').id] });
  await srv.must(A, { op: 'audit.update', auditId: y.id, expectedVersion: (await auditRow(y)).row_version, patch: { stage: 'closed' } });
  const mt = await srv.must(LEAD, { op: 'audit.startMaintenance', auditId: y.id });
  const mtReqs = await srv.must(A, { op: 'requirement.list', auditId: mt.audit.id });
  t.ok(mt.summary.type === 'maintenance' && mt.summary.outOfScope === 0 && !mtReqs.some(r => r.compliance_status === 'out_of_scope'), 'startMaintenance still keeps every clause in scope');
  const mtActs = await srv.must(A, { op: 'action.list', auditId: mt.audit.id });
  t.ok(mtActs.length === 1 && mtActs[0].carried_meta && mtActs[0].carried_meta.ref === yt.action.ref, 'a carried action records where it came from');

  // ── B4.5 client settings ──────────────────────────────────────────────────────────────────────
  const blank = await srv.must(A, { op: 'clientSettings.get', clientId: 'c1' });
  t.ok(blank.row_version === 0 && blank.next_audit_due === null, 'a client with no settings yet reads as blank (version 0)');
  t.eq((await srv.call(A, { op: 'clientSettings.update', clientId: 'c1', expectedVersion: 0, patch: { frequency: 'fortnightly' } })).status, 400, 'an unknown frequency is refused');
  t.eq((await srv.call(A, { op: 'clientSettings.update', clientId: 'c1', expectedVersion: 0, patch: { industry: 'farming' } })).status, 400, 'an industry outside the list is refused (Q13)');
  const cs1 = await srv.must(A, { op: 'clientSettings.update', clientId: 'c1', expectedVersion: 0, patch: { next_audit_due: '2027-03-01', frequency: 'custom', custom_months: 18, industry: 'construction', notes: 'Two sites' } });
  t.ok(cs1.row_version === 1 && cs1.custom_months === 18 && cs1.industry === 'construction', 'the first save creates the settings');
  const cs2 = await srv.must(A, { op: 'clientSettings.update', clientId: 'c1', expectedVersion: 1, patch: { frequency: 'annual', custom_months: 9 } });
  t.ok(cs2.frequency === 'annual' && cs2.custom_months === null, 'custom months clear when the frequency is not custom');
  t.eq((await srv.call(A, { op: 'clientSettings.update', clientId: 'c1', expectedVersion: 1, patch: { notes: 'stale' } })).status, 409, 'a stale save is refused');
  t.eq((await srv.call(H.CLIENT('cu1', 'c1'), { op: 'clientSettings.get', clientId: 'c1' })).status, 403, 'clients cannot read the settings');

  // ── B4.4 programme ────────────────────────────────────────────────────────────────────────────
  const priv = await srv.board({ standards: ['9001'], title: 'Private one', extra: { visibility: 'private' } });
  const prog = await srv.must(A, { op: 'programme.get', clientId: 'c1' });
  const tlIds = prog.timeline.map(x => x.id);
  t.ok([b.id, fu.id, y.id, mt.audit.id, priv.id].every(id => tlIds.includes(id)), 'the timeline lists the client\'s boards');
  t.ok(prog.nextAuditDue === '2027-03-01' && prog.settings.frequency === 'annual', 'next audit due comes from the client settings');
  t.ok(prog.standards.includes('9001') && prog.client.id === 'c1', 'the client and its standards');
  t.ok((prog.tiles.openFindingsByClass.minor_nc || []).length >= 1 && (prog.tiles.openFindingsByClass.observation || []).length >= 1, 'open findings by significance');
  t.ok(prog.tiles.overdueActions.some(x => x.id === t1.action.id), 'an action past its due date is overdue');
  t.ok(prog.tiles.effectivenessDue.some(x => x.id === t1.action.id), 'an effectiveness review due within 30 days is listed');
  t.ok(prog.tiles.followUpsDue.every(x => x.auditId !== b.id), 'a board already followed up is not "due"');
  t.ok(!('health' in prog) && !('score' in prog), 'no single health percentage');
  const progOut = await srv.must(OUTSIDER, { op: 'programme.get', clientId: 'c1' });
  t.ok(!progOut.timeline.some(x => x.id === priv.id) && progOut.timeline.some(x => x.id === b.id), 'a private board the caller cannot open is left out');

  // ── UI ────────────────────────────────────────────────────────────────────────────────────────
  const ui = await t.browser();
  await ui.landing();
  const heads = await ui.eval(() => [...document.querySelectorAll('button.iso-land-client')].map(x => x.dataset.cid));
  t.ok(heads.includes('c1'), 'the landing\'s client heading is a button');
  await ui.eval(() => document.querySelector('button.iso-land-client[data-cid="c1"]').click()); await t.sleep(1800);
  const page = await ui.eval(() => ({ title: document.querySelector('.iso-prog-title')?.textContent.trim(), tl: document.querySelectorAll('.iso-prog-tl-item').length, tiles: document.querySelectorAll('.iso-prog-tile').length }));
  t.ok(page.title && page.tl >= 5 && page.tiles === 7, `the programme page shows the client, the timeline and seven tiles (got ${JSON.stringify(page)})`);
  await ui.eval(() => document.querySelector('.iso-prog-tile[data-k="overdueActions"]').click()); await t.sleep(300);
  t.ok(await ui.eval(() => document.querySelectorAll('.iso-prog-row').length >= 1), 'a tile lists its items, each opening its board');
  const shots = await ui.shot('b4-programme');
  t.ok(shots.desktop <= 0 && shots.phone <= 0, `the programme page fits at desktop and 390px (${JSON.stringify(shots)})`);
  await ui.eval(() => { document.getElementById('iso-cs-notes').value = 'Saved from the page'; ISO._progSaveSettings(); }); await t.sleep(1200);
  t.eq((await srv.must(A, { op: 'clientSettings.get', clientId: 'c1' })).notes, 'Saved from the page', 'the settings save from the programme page');
  // Settings: the setup card and the start dialog.
  await ui.openBoard(y.id); await ui.tab('settings');
  t.ok(await ui.eval(() => !!document.getElementById('iso-su-objective')), 'the board settings show the audit setup card');
  await ui.eval(() => { document.getElementById('iso-su-objective').value = 'From the UI'; ISO._saveAuditSetup(document.querySelector('.iso-setup-card button').dataset.id); }); await t.sleep(1500);
  t.eq(((await auditRow(y)).setup || {}).objective, 'From the UI', 'the setup saves from the card');
  await ui.shot('b4-settings-setup');
  // Documents: Request from client.
  const u = await srv.board({ standards: ['9001'], title: 'Docs UI' });
  await ui.openBoard(u.id); await ui.tab('documents');
  await ui.eval(() => document.querySelector('.iso-doc-request').click()); await t.sleep(500);
  const ticked = await ui.eval(() => [...document.querySelectorAll('.iso-er-doc')].filter(c => c.checked).map(c => c.value));
  t.ok(ticked.length >= 3, `the key documents arrive pre-ticked (${ticked.length})`);
  await ui.eval(() => ISO._docRequestApply()); await t.sleep(1800);
  const letter = await ui.eval(() => document.getElementById('iso-er-text')?.value || '');
  t.ok(ticked.every(n => letter.includes(n)), 'the letter lists every requested document');
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden')); await t.sleep(800);
  await ui.eval(() => ISO._docSetFilter('all')); await t.sleep(300);
  t.ok(await ui.eval(n => /Requested/.test([...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === n)?.textContent || ''), ticked[0]), 'a requested document says so in the list');
  // Carry labels on the maintenance board (B4.3).
  await srv.set({ ...mt.audit, key: k => mtReqs.find(r => r.standard_code + ' ' + r.clause === k) }, '9001 4.2', { compliance_status: 'compliant', current_system: basis });
  await srv.set({ ...mt.audit, key: k => mtReqs.find(r => r.standard_code + ' ' + r.clause === k) }, '9001 4.1', { compliance_status: 'compliant', current_system: basis });
  await ui.openBoard(mt.audit.id); await ui.tab('requirements');
  const rows = await srv.must(A, { op: 'requirement.list', auditId: mt.audit.id });
  const lab = await ui.eval(rs => rs.map(r => ISO.carryLabel(r)), rows.filter(r => ['4.1', '4.2', '4.3'].includes(r.clause)).sort((a, b) => a.clause.localeCompare(b.clause)));
  t.eq(lab, ['Changed since last audit', 'Reconfirmed', 'Carried, not yet verified'], 'carry-forward labels against last year\'s result');
  t.ok(await ui.eval(() => [...document.querySelectorAll('.iso-fchip')].some(x => /Changed since last audit/.test(x.textContent))), 'the "Changed since last audit" chip appears when there are some');
  // Finding drawer on a closed board: Schedule follow-up.
  await ui.openBoard(y.id); await ui.tab('findings');
  const anyF = (await srv.must(A, { op: 'finding.list', auditId: y.id }))[0];
  if (anyF) {
    await ui.eval((aid, id) => ISO.openFindingDrawer(aid, id), y.id, anyF.id); await t.sleep(900);
    // y already has a successor (the maintenance board), so it must NOT offer Schedule follow-up.
    t.ok(!(await ui.eval(() => [...document.querySelectorAll('#iso-drawer-body button')].some(x => x.textContent.trim() === 'Schedule follow-up'))), 'no Schedule follow-up once the board has been followed up');
    await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  } else t.ok(true, 'no finding on y (gap analysis) — drawer check not applicable');
  // Start dialog from a fresh closed board: follow-up pre-ticks the open items.
  const z = await srv.board({ standards: ['9001'], title: 'Dialog board' });
  await srv.must(A, { op: 'audit.update', auditId: z.id, expectedVersion: (await auditRow(z)).row_version, patch: { audit_type: 'internal' } });
  await srv.set(z, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Fix' });
  await srv.must(A, { op: 'action.trackPlan', auditId: z.id, requirementIds: [z.key('9001 4.1').id], classification: 'minor_nc' });
  await srv.must(A, { op: 'audit.update', auditId: z.id, expectedVersion: (await auditRow(z)).row_version, patch: { stage: 'closed' } });
  await ui.openBoard(z.id); await ui.tab('settings');
  await ui.eval(() => document.querySelector('.iso-maint-start').click()); await t.sleep(1200);
  const dlg = await ui.eval(() => ({ f: [...document.querySelectorAll('.iso-sn-f')].filter(c => c.checked).length, a: [...document.querySelectorAll('.iso-sn-a')].filter(c => c.checked).length, r: [...document.querySelectorAll('.iso-sn-r')].filter(c => c.checked).length }));
  t.ok(dlg.f === 1 && dlg.a === 1 && dlg.r === 1, `the dialog pre-ticks open findings, open actions and Partial / Non-Compliant clauses (got ${JSON.stringify(dlg)})`);
  await ui.shot('b4-start-dialog');
  await ui.eval(() => ISO._snApply()); await t.sleep(2500);
  const succ = (await auditRow(z));
  const prog2 = await srv.must(A, { op: 'programme.get', clientId: 'c1' });
  t.ok(prog2.timeline.some(x => x.previousAuditId === z.id && x.auditType === 'follow_up'), 'Start creates the follow-up board');
  // Overview: the audit pack downloads.
  await ui.openBoard(u.id); await ui.tab('dashboard');
  await ui.eval(() => document.querySelector('.iso-audit-pack').click()); await t.sleep(400);
  await ui.eval(() => ISO._auditPackApply()); await t.sleep(4000);
  t.ok(await ui.eval(() => [...document.querySelectorAll('.toast, [class*=toast]')].some(x => /Audit pack downloaded/.test(x.textContent))), 'the on-site audit pack downloads as a PDF');
  void succ;
});
