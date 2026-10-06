// Phase 3 acceptance: iso-security-test starts here (plan §4.1a) — enumerates the op registry
// (fails if an op has no scope resolver or client projection; iso-logic-test does the same check
// at unit speed, this one is the one every later phase's new ops must keep passing) and a
// two-client x two-audit leak fixture run through the REAL dispatcher (api/iso.js's handler, not
// just the pure permission functions) so a projection/serialization bug at the HTTP boundary
// would be caught here even if the underlying permission check is correct.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-security-'));
process.env.ISO_OFFLINE_DIR = tmpDir;
process.env.ISO_OFFLINE = '1';
globalThis.__TASKHUB_SERVE_OFFLINE = true;
for (const k of Object.keys(process.env)) if (k.startsWith('SUPABASE_')) delete process.env[k];

const { registry } = require('../api/_iso.js');
const handler = require('../api/iso.js');

const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function fakeReq(user, body) {
  const headers = { host: 'localhost:3001' };
  if (user) headers['x-iso-offline-user'] = encodeURIComponent(JSON.stringify(user));
  return { method: 'POST', headers, socket: { remoteAddress: '127.0.0.1' }, body };
}
function fakeRes() {
  const r = { code: 0, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
async function call(user, body) { const res = fakeRes(); await handler(fakeReq(user, body), res); return res; }

(async () => {
  // ── registry enumeration (plan §4.1a: "an op without them fails the gate") ─────────────────
  const names = Object.keys(registry);
  for (const name of names) {
    const def = registry[name];
    ok(!!def.scope, `[registry] ${name} declares a scope resolver`);
    ok(def.scope === 'none' || def.clientProjection !== undefined, `[registry] ${name} declares a client projection`);
  }
  ok(names.length >= 25, `[registry] Phase 3's ops are all present (got ${names.length})`);

  // ── fixture: two clients, two audits, a staff member on only one of them ───────────────────
  const admin = { id: 'u_admin', role: 'admin' };
  const approveVersion = await call(admin, { op: 'config.get' }); // warms the store deterministically before inserts below
  const db = require('../api/_isoDbOffline.js');
  await db.insert('iso_standard_versions', { id: 'iver_1', standard_code: '9001', label: 'v1', status: 'approved' });

  const auditA = (await call(admin, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Audit A', visibility: 'private' })).body.data;
  const auditB = (await call(admin, { op: 'audit.create', clientId: 'c2', standards: ['9001'], title: 'Audit B', visibility: 'private' })).body.data;
  await call(admin, { op: 'member.add', auditId: auditA.id, uid: 'offline:u_memberA', auditRole: 'auditor' });

  const memberA = { id: 'u_memberA', role: 'staff' };
  const stranger = { id: 'u_stranger', role: 'staff' };
  const clientA = { id: 'cu_A', role: 'client', clientId: 'c1' };
  const clientB = { id: 'cu_B', role: 'client', clientId: 'c2' };

  const memberAOpensA = await call(memberA, { op: 'audit.get', auditId: auditA.id });
  ok(memberAOpensA.code === 200, `a named member of private audit A can open it (got ${memberAOpensA.code})`);
  const memberAOpensB = await call(memberA, { op: 'audit.get', auditId: auditB.id });
  ok(memberAOpensB.code === 403, `the SAME user, with no membership on private audit B, is refused (got ${memberAOpensB.code})`);
  const strangerOpensA = await call(stranger, { op: 'audit.get', auditId: auditA.id });
  ok(strangerOpensA.code === 403, `a staff member with no relationship to private audit A at all is refused (got ${strangerOpensA.code})`);

  // A client can never reach another client's audit by id, even guessing correctly-shaped ids —
  // client_portal_enabled is false by default, so this must be refused before visibility even
  // matters, and would still be refused after enabling it since clientId never matches.
  const clientAOpensB = await call(clientA, { op: 'audit.get', auditId: auditB.id });
  ok(clientAOpensB.code === 403 || clientAOpensB.code === 404, `client A can never open client B's audit by id (got ${clientAOpensB.code})`);
  await call(admin, { op: 'audit.update', auditId: auditB.id, patch: { client_portal_enabled: true }, expectedVersion: auditB.row_version, reason: 'test' });
  await call(admin, { op: 'member.add', auditId: auditB.id, uid: 'offline:cu_A', auditRole: 'client_contributor', memberKind: 'client' });
  const clientAStillCantOpenB = await call(clientA, { op: 'audit.get', auditId: auditB.id });
  ok(clientAStillCantOpenB.code === 403, `client A (clientId c1) still cannot open client B's audit (client_id c2) even with a membership row impersonating them (got ${clientAStillCantOpenB.code})`);

  // audit.list never leaks the other client's audits into the list either.
  const clientAList = await call(clientA, { op: 'audit.list' });
  ok(clientAList.code === 200 && !clientAList.body.data.some(a => a.id === auditB.id), 'audit.list for client A never includes client B\'s audit');

  // ── client projection strips internal fields even for an audit the client CAN see ──────────
  const auditANow = (await call(admin, { op: 'audit.get', auditId: auditA.id })).body.data;
  const auditAUpdated = await call(admin, { op: 'audit.update', auditId: auditA.id, patch: { internal_notes: 'staff-only secret', client_portal_enabled: true }, expectedVersion: auditANow.row_version, reason: 'test' });
  ok(auditAUpdated.code === 200, `setup: audit A's internal_notes/client_portal_enabled update succeeds (got ${auditAUpdated.code})`);
  await call(admin, { op: 'member.add', auditId: auditA.id, uid: 'offline:cu_A2', auditRole: 'client_contributor', memberKind: 'client' });
  const clientSeesA = await call({ id: 'cu_A2', role: 'client', clientId: 'c1' }, { op: 'audit.get', auditId: auditA.id });
  ok(clientSeesA.code === 200, `a properly-shared client member CAN open the audit (got ${clientSeesA.code})`);
  ok(clientSeesA.body.data && !('internal_notes' in clientSeesA.body.data) && !('owner_uid' in clientSeesA.body.data),
    'even a client who CAN open the audit never receives internal_notes/owner_uid — the allowlist, not the access check, controls field exposure');

  // ── a staff caller still gets the unprojected shape (sanity — the allowlist is client-only) ─
  const staffSeesA = await call(admin, { op: 'audit.get', auditId: auditA.id });
  ok(staffSeesA.body.data && 'internal_notes' in staffSeesA.body.data, 'a staff caller still receives the full row (the projection only ever applies to a client caller)');

  // ── unit.* (A43) — update/archive were real no-ops until fixed this session: they built and
  // returned a patched object but never actually wrote it, so an edited name/archive silently
  // reverted on the next read. Proven against the real stored row, not just the response body. ──
  const unit1 = (await call(memberA, { op: 'unit.add', auditId: auditA.id, kind: 'site', name: 'Perth Office' })).body.data;
  ok(unit1 && unit1.name === 'Perth Office', `unit.add creates a unit (got ${JSON.stringify(unit1)})`);
  const unitUpdateRes = await call(memberA, { op: 'unit.update', auditId: auditA.id, id: unit1.id, name: 'Perth HQ' });
  ok(unitUpdateRes.code === 200 && unitUpdateRes.body.data.name === 'Perth HQ', `unit.update's response reflects the new name (got ${JSON.stringify(unitUpdateRes.body.data)})`);
  const unitAfterUpdate = await db.get('iso_audit_units', unit1.id);
  ok(unitAfterUpdate.name === 'Perth HQ', `unit.update actually persisted the new name to storage (got ${unitAfterUpdate.name})`);
  const unitArchiveRes = await call(memberA, { op: 'unit.archive', auditId: auditA.id, id: unit1.id });
  ok(unitArchiveRes.code === 200 && !!unitArchiveRes.body.data.archived_at, `unit.archive's response carries archived_at (got ${JSON.stringify(unitArchiveRes.body.data)})`);
  const unitAfterArchive = await db.get('iso_audit_units', unit1.id);
  ok(!!unitAfterArchive.archived_at, `unit.archive actually persisted archived_at to storage (got ${unitAfterArchive.archived_at})`);
  const unitListAfterArchive = await call(memberA, { op: 'unit.list', auditId: auditA.id });
  ok(!unitListAfterArchive.body.data.some(u => u.id === unit1.id), 'an archived unit no longer appears in unit.list');
  const unitUpdateBadName = await call(memberA, { op: 'unit.update', auditId: auditA.id, id: unit1.id, name: '' });
  ok(unitUpdateBadName.code === 400, `unit.update refuses an empty name (got ${unitUpdateBadName.code})`);

  // ── Phase 6: requirement.*/relationship.* permission boundaries and behaviour ────────────────
  // Direct fixture inserts (bypassing audit.create's library copy) for precise control — matches
  // the rest of this file's own pattern.
  const reqFixture = (i, over) => db.insert('iso_requirements', Object.assign({
    id: 'ireq_fx' + i, audit_id: auditA.id, client_id: 'c1', standard_code: '9001', sort_key: i,
    origin: 'library', clause: '4.' + i, clause_name: 'Fixture ' + i, requirement_text: 'Fixture requirement ' + i,
    applicability: 'applicable', unit_ids: [], assessment_state: 'not_started', compliance_status: 'not_assessed', visibility: 'internal', visible_to_uids: [],
    source_changed: false, missing_from_source: false,
  }, over || {}));
  const r1 = await reqFixture(1);
  const r2 = await reqFixture(2, { visibility: 'client_all' });
  await reqFixture(3); await reqFixture(4); await reqFixture(5); await reqFixture(6);

  // D35/R2: one status field (compliance_status) replaces applicability + assessment_state/result.
  // Not applicable without a reason -> 400.
  const naNoJust = await call(memberA, { op: 'requirement.update', auditId: auditA.id, id: r1.id, patch: { compliance_status: 'not_applicable' }, expectedVersion: r1.row_version });
  ok(naNoJust.code === 400, `not_applicable with no reason is refused (got ${naNoJust.code})`);
  const naWithJust = await call(memberA, { op: 'requirement.update', auditId: auditA.id, id: r1.id, patch: { compliance_status: 'not_applicable', na_justification: 'Decommissioned process.' }, expectedVersion: r1.row_version });
  ok(naWithJust.code === 200, `not_applicable WITH a reason succeeds (got ${naWithJust.code})`);
  // An invalid status is refused; a real one needs no second gating step (the old two-field
  // state+result dance is gone — one patch, one field, is enough).
  const badStatus = await call(memberA, { op: 'requirement.update', auditId: auditA.id, id: r2.id, patch: { compliance_status: 'sort-of-compliant' }, expectedVersion: r2.row_version });
  ok(badStatus.code === 400, `an invalid status is refused (got ${badStatus.code})`);
  const resultOk = await call(memberA, { op: 'requirement.update', auditId: auditA.id, id: r2.id, patch: { compliance_status: 'compliant' }, expectedVersion: r2.row_version });
  ok(resultOk.code === 200, `a real status succeeds in one patch, no second gating step (got ${resultOk.code})`);

  // A client caller gets 403 on every requirement write op.
  const clientA2 = { id: 'cu_A2', role: 'client', clientId: 'c1' };
  const clientUpdate = await call(clientA2, { op: 'requirement.update', auditId: auditA.id, id: r1.id, patch: { current_system: 'hacked' }, expectedVersion: r1.row_version });
  ok(clientUpdate.code === 403, `a client caller gets 403 on requirement.update (got ${clientUpdate.code})`);
  const clientAdd = await call(clientA2, { op: 'requirement.addCustom', auditId: auditA.id, standardCode: '9001', clause: '99', requirementText: 'x' });
  ok(clientAdd.code === 403, `a client caller gets 403 on requirement.addCustom (got ${clientAdd.code})`);
  const clientBulk = await call(clientA2, { op: 'requirement.bulkUpdate', auditId: auditA.id, ids: [r1.id], patch: { compliance_status: 'compliant' } });
  ok(clientBulk.code === 403, `a client caller gets 403 on requirement.bulkUpdate (got ${clientBulk.code})`);
  const clientRelDecide = await call(clientA2, { op: 'relationship.decide', auditId: auditA.id, id: 'irel_x', decision: 'confirmed' });
  ok(clientRelDecide.code === 403, `a client caller gets 403 on relationship.decide (got ${clientRelDecide.code})`);

  // requirement.list for a client returns only visible rows, projected through CLIENT_FIELDS (0 internal rows).
  const clientList = await call(clientA2, { op: 'requirement.list', auditId: auditA.id });
  ok(clientList.code === 200, `client requirement.list succeeds (got ${clientList.code})`);
  const clientRows = clientList.body.data || [];
  ok(clientRows.every(r => r.visibility === 'client_all' || r.visibility === 'client_selected'), 'every row a client receives is client-visible (none internal)');
  ok(clientRows.some(r => r.id === r2.id), 'the one client_all fixture row IS in the client\'s list');
  ok(!clientRows.some(r => r.id === r1.id), 'the internal fixture row is NOT in the client\'s list');
  ok(clientRows.every(r => !('interview_notes' in r) && !('internal_notes' in r) && !('auditor_observations' in r)), 'no internal-only field ever appears in a client\'s requirement rows');

  // Bulk edit of 5 -> 5 activity rows (one per record, not one combined entry).
  const before = await call(admin, { op: 'activity.list', auditId: auditA.id });
  const beforeCount = (before.body.data || []).filter(a => a.action === 'bulk_updated').length;
  const fiveIds = ['ireq_fx1', 'ireq_fx2', 'ireq_fx3', 'ireq_fx4', 'ireq_fx5'];
  const bulkFive = await call(memberA, { op: 'requirement.bulkUpdate', auditId: auditA.id, ids: fiveIds, patch: { compliance_status: 'partially_compliant' } });
  ok(bulkFive.code === 200 && bulkFive.body.data.updated === 5, `bulk edit of 5 reports updated:5 (got ${JSON.stringify(bulkFive.body)})`);
  const after = await call(admin, { op: 'activity.list', auditId: auditA.id });
  const afterCount = (after.body.data || []).filter(a => a.action === 'bulk_updated').length;
  ok(afterCount === beforeCount + 5, `bulk edit of 5 requirements writes exactly 5 activity rows, one per record (before ${beforeCount}, after ${afterCount})`);

  // Confirming a suggestion changes no assessment.
  const relRow = await db.insert('iso_relationships', { id: 'irel_fx1', audit_id: auditA.id, from_id: r1.id, to_id: r2.id, kind: 'mapping', state: 'suggested', source: 'rule' });
  const r1Before = await db.get('iso_requirements', r1.id);
  const decideConfirm = await call(memberA, { op: 'relationship.decide', auditId: auditA.id, id: relRow.id, decision: 'confirmed' });
  ok(decideConfirm.code === 200 && decideConfirm.body.data.state === 'confirmed', `confirming a suggestion succeeds (got ${JSON.stringify(decideConfirm.body)})`);
  const r1After = await db.get('iso_requirements', r1.id);
  ok(r1After.assessment_state === r1Before.assessment_state && r1After.assessment_result === r1Before.assessment_result && r1After.row_version === r1Before.row_version,
    'confirming a relationship suggestion never touches either requirement\'s own assessment fields');
  const rejectAgain = await call(memberA, { op: 'relationship.decide', auditId: auditA.id, id: relRow.id, decision: 'rejected' });
  ok(rejectAgain.code === 400, `a relationship already decided cannot be decided again (got ${rejectAgain.code})`);

  // Saved view filters exactly (plan 6.3's "Gaps identified" predicate, via requirement.list's own filter passthrough).
  await reqFixture(7, { assessment_result: 'not_implemented' });
  const gapsFilter = { where: [{ field: 'assessment_result', op: 'in', value: ['not_implemented', 'no_evidence_provided', 'partially_implemented', 'implemented_ineffective'] }] };
  const gapsView = await call(admin, { op: 'view.save', auditId: auditA.id, entity: 'requirement', name: 'Gaps', config: gapsFilter });
  ok(gapsView.code === 200, `saving a view succeeds (got ${gapsView.code})`);
  const filtered = await call(admin, { op: 'requirement.list', auditId: auditA.id, filter: gapsFilter });
  ok(filtered.code === 200 && filtered.body.data.every(r => ['not_implemented', 'no_evidence_provided', 'partially_implemented', 'implemented_ineffective'].includes(r.assessment_result)),
    `requirement.list's filter matches exactly the saved view's predicate (got ${JSON.stringify((filtered.body.data || []).map(r => r.assessment_result))})`);
  ok(filtered.body.data.length >= 1, 'at least the one deliberately-gapped fixture row comes back');

  // ── Phase 7.2: finding.* — create-from-requirement, classification/downgrade rules, lifecycle
  // transitions, permission tiers, and client visibility (incl. after_approval + released_at) ──
  await call(admin, { op: 'member.add', auditId: auditA.id, uid: 'offline:u_contribA', auditRole: 'contributor' });
  const contribA = { id: 'u_contribA', role: 'staff' };

  const badClass = await call(memberA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'not_a_real_one', title: 'X' });
  ok(badClass.code === 400, `finding.create with an invalid classification is refused (got ${badClass.code})`);

  const fMajor = await call(memberA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'major_nc', title: 'Major gap', statement: 'Statement text', evidenceBasis: 'Site visit' });
  ok(fMajor.code === 200 && fMajor.body.data.status === 'draft' && fMajor.body.data.root_cause_required === true,
    `finding.create from a requirement succeeds, drafts as major_nc with root_cause_required auto-set (got ${JSON.stringify(fMajor.body.data && { status: fMajor.body.data.status, root_cause_required: fMajor.body.data.root_cause_required })})`);
  const majorFinding = fMajor.body.data;
  const preLinked = await db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'eq', value: majorFinding.id }] });
  ok(preLinked.length === 1 && preLinked[0].requirement_id === r1.id, 'finding.create pre-links the source requirement in iso_finding_requirements');

  // A contributor can draft/create a finding...
  const contribCreates = await call(contribA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'minor_nc', title: 'Contributor-drafted' });
  ok(contribCreates.code === 200, `a contributor can create a finding (got ${contribCreates.code})`);
  // ...but cannot progress it through the lifecycle — that's an auditor-tier decision (plan §14 A38).
  const contribReleases = await call(contribA, { op: 'finding.release', auditId: auditA.id, id: contribCreates.body.data.id, expectedVersion: contribCreates.body.data.row_version });
  ok(contribReleases.code === 403, `a contributor is refused on finding.release (got ${contribReleases.code})`);

  // Classification downgrade from major_nc needs a reason (plan §6.2).
  const downgradeNoReason = await call(memberA, { op: 'finding.update', auditId: auditA.id, id: majorFinding.id, patch: { classification: 'minor_nc' }, expectedVersion: majorFinding.row_version });
  ok(downgradeNoReason.code === 400, `downgrading a major_nc finding with no reason is refused (got ${downgradeNoReason.code})`);
  const downgradeWithReason = await call(memberA, { op: 'finding.update', auditId: auditA.id, id: majorFinding.id, patch: { classification: 'minor_nc' }, expectedVersion: majorFinding.row_version, reason: 'Reassessed after review.' });
  ok(downgradeWithReason.code === 200 && downgradeWithReason.body.data.classification === 'minor_nc' && downgradeWithReason.body.data.root_cause_required === false,
    `downgrading WITH a reason succeeds and clears root_cause_required (got ${JSON.stringify(downgradeWithReason.body.data && { classification: downgradeWithReason.body.data.classification, root_cause_required: downgradeWithReason.body.data.root_cause_required })})`);

  // Lifecycle: draft -> released_for_review -> final -> closed, and the after_approval visibility
  // gate becomes true only once released_at is actually set.
  const fVis = await call(memberA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'observation', title: 'Visible once released', visibility: 'after_approval' });
  ok(fVis.code === 200, `setup: creating an after_approval finding succeeds (got ${fVis.code})`);
  let vis = fVis.body.data;
  const clientListBeforeRelease = await call(clientA2, { op: 'finding.list', auditId: auditA.id });
  ok(clientListBeforeRelease.code === 200 && !clientListBeforeRelease.body.data.some(f => f.id === vis.id),
    'an after_approval finding is NOT visible to a client before release (released_at is still null)');

  const badSkip = await call(memberA, { op: 'finding.close', auditId: auditA.id, id: vis.id, expectedVersion: vis.row_version });
  ok(badSkip.code === 400, `finding.close on a draft finding (skipping release/finalize) is refused (got ${badSkip.code})`);

  const released = await call(memberA, { op: 'finding.release', auditId: auditA.id, id: vis.id, expectedVersion: vis.row_version });
  ok(released.code === 200 && released.body.data.status === 'released_for_review' && !!released.body.data.released_at,
    `finding.release moves draft -> released_for_review and stamps released_at (got ${JSON.stringify(released.body.data && { status: released.body.data.status, released_at: released.body.data.released_at })})`);
  vis = released.body.data;

  const clientListAfterRelease = await call(clientA2, { op: 'finding.list', auditId: auditA.id });
  ok(clientListAfterRelease.code === 200 && clientListAfterRelease.body.data.some(f => f.id === vis.id),
    'the SAME after_approval finding IS now visible to a client, once released_at is set');
  const clientRow = clientListAfterRelease.body.data.find(f => f.id === vis.id);
  ok(clientRow && !('root_cause_required' in clientRow) && !('created_by' in clientRow),
    'a client\'s finding row is still CLIENT_FIELDS-projected — no internal-only field leaks even on a visible record');

  const finalized = await call(memberA, { op: 'finding.finalize', auditId: auditA.id, id: vis.id, expectedVersion: vis.row_version });
  ok(finalized.code === 200 && finalized.body.data.status === 'final', `finding.finalize moves released_for_review -> final (got ${JSON.stringify(finalized.body.data)})`);
  vis = finalized.body.data;
  const closed = await call(memberA, { op: 'finding.close', auditId: auditA.id, id: vis.id, expectedVersion: vis.row_version });
  ok(closed.code === 200 && closed.body.data.status === 'closed' && !!closed.body.data.closed_at,
    `finding.close moves final -> closed and stamps closed_at (got ${JSON.stringify(closed.body.data && { status: closed.body.data.status, closed_at: closed.body.data.closed_at })})`);
  const reopenAttempt = await call(memberA, { op: 'finding.release', auditId: auditA.id, id: vis.id, expectedVersion: closed.body.data.row_version });
  ok(reopenAttempt.code === 400, `a closed finding cannot be moved back to released_for_review — no reopen path exists for findings (got ${reopenAttempt.code})`);

  // Withdraw: allowed from draft, refused once closed.
  const fWithdraw = (await call(memberA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'ofi', title: 'To withdraw' })).body.data;
  const withdrawn = await call(memberA, { op: 'finding.withdraw', auditId: auditA.id, id: fWithdraw.id, expectedVersion: fWithdraw.row_version });
  ok(withdrawn.code === 200 && withdrawn.body.data.status === 'withdrawn', `finding.withdraw succeeds from draft (got ${JSON.stringify(withdrawn.body.data)})`);
  const withdrawClosedAttempt = await call(memberA, { op: 'finding.withdraw', auditId: auditA.id, id: closed.body.data.id, expectedVersion: closed.body.data.row_version });
  ok(withdrawClosedAttempt.code === 400, `finding.withdraw on an already-closed finding is refused (got ${withdrawClosedAttempt.code})`);

  // A client caller gets 403 on every finding write op.
  for (const [op, extra] of [
    ['finding.create', { requirementId: r1.id, classification: 'minor_nc', title: 'x' }],
    ['finding.update', { id: majorFinding.id, patch: { title: 'hacked' }, expectedVersion: majorFinding.row_version }],
    ['finding.release', { id: fWithdraw.id, expectedVersion: fWithdraw.row_version }],
    ['finding.finalize', { id: fWithdraw.id, expectedVersion: fWithdraw.row_version }],
    ['finding.close', { id: fWithdraw.id, expectedVersion: fWithdraw.row_version }],
    ['finding.withdraw', { id: majorFinding.id, expectedVersion: majorFinding.row_version }],
  ]) {
    const res = await call(clientA2, Object.assign({ op, auditId: auditA.id }, extra));
    ok(res.code === 403, `a client caller gets 403 on ${op} (got ${res.code})`);
  }

  // metric.audit's Phase 7.1 additions are present and reflect the findings just created (all
  // real reads over iso_findings/iso_actions — actions are still empty until Phase 7.3, so those
  // fields are legitimately 0/empty here, not stubbed).
  const metrics = await call(admin, { op: 'metric.audit', auditId: auditA.id });
  ok(metrics.code === 200 && metrics.body.data.findings_total === 4, `metric.audit reports findings_total (got ${metrics.body.data.findings_total})`);
  ok(typeof metrics.body.data.findings_by_classification === 'object' && metrics.body.data.findings_by_classification.minor_nc >= 1,
    `metric.audit's findings_by_classification breaks down by classification (got ${JSON.stringify(metrics.body.data.findings_by_classification)})`);
  ok(metrics.body.data.actions_total === 0 && metrics.body.data.actions_overdue === 0 && metrics.body.data.avg_action_progress === 0 && metrics.body.data.shared_actions === 0,
    'metric.audit\'s action-side fields are present and correctly 0 before Phase 7.3 creates any actions');

  // ── Phase 7.3 (this slice): action.* — create/link/update/status workflow, permission tiers,
  // the major-NC root-cause gate, and client visibility ──────────────────────────────────────
  const badTarget = await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'finding', targetId: 'not-real', title: 'X' });
  ok(badTarget.code === 400, `action.create against a nonexistent finding is refused (got ${badTarget.code})`);

  // majorFinding itself was downgraded to minor_nc earlier in this run (the classification-downgrade
  // test above) — a fresh major_nc finding is needed here so the action's root-cause gate below is
  // actually exercised against a real major_nc link, not a stale reference to a now-minor_nc row.
  const majorFinding2 = (await call(memberA, { op: 'finding.create', auditId: auditA.id, requirementId: r1.id, classification: 'major_nc', title: 'A second, still-major gap' })).body.data;
  const actionFromFinding = await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'finding', targetId: majorFinding2.id, title: 'Fix the major gap', priority: 'high' });
  ok(actionFromFinding.code === 200 && actionFromFinding.body.data.status === 'draft' && actionFromFinding.body.data.ref.endsWith('-A001'),
    `action.create from a finding succeeds, drafts with an -A001 ref (got ${JSON.stringify(actionFromFinding.body.data && { status: actionFromFinding.body.data.status, ref: actionFromFinding.body.data.ref })})`);
  const majorAction = actionFromFinding.body.data;
  const actionLinks = await db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: majorAction.id }] });
  ok(actionLinks.length === 1 && actionLinks[0].target_type === 'finding' && actionLinks[0].target_id === majorFinding2.id,
    'action.create pre-links its originating finding in iso_action_links, confirmed');

  // A contributor can create/edit an action, but not verify/close it.
  const actionFromReq = await call(contribA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Contributor-created action' });
  ok(actionFromReq.code === 200, `a contributor can create an action from a requirement (got ${actionFromReq.code})`);

  // action.update: CAPA fields, and field/value validation.
  const badPriority = await call(memberA, { op: 'action.update', auditId: auditA.id, id: majorAction.id, patch: { priority: 'urgent' }, expectedVersion: majorAction.row_version });
  ok(badPriority.code === 400, `action.update with an invalid priority is refused (got ${badPriority.code})`);
  const capaUpdate = await call(memberA, { op: 'action.update', auditId: auditA.id, id: majorAction.id, patch: { correction: 'Immediate fix applied.', containment: 'Isolated the affected process.' }, expectedVersion: majorAction.row_version });
  ok(capaUpdate.code === 200 && capaUpdate.body.data.correction === 'Immediate fix applied.', `action.update writes CAPA fields (correction/containment) (got ${capaUpdate.code})`);
  let action1 = capaUpdate.body.data;

  // action.link / action.unlink — link to a second requirement, then reject the link.
  const linkRes = await call(memberA, { op: 'action.link', auditId: auditA.id, actionId: action1.id, targetType: 'requirement', targetId: r2.id });
  ok(linkRes.code === 200 && linkRes.body.data.link_state === 'confirmed', `action.link adds a confirmed link to a second target (got ${JSON.stringify(linkRes.body.data)})`);
  const dupeLink = await call(memberA, { op: 'action.link', auditId: auditA.id, actionId: action1.id, targetType: 'requirement', targetId: r2.id });
  ok(dupeLink.code === 400, `action.link refuses a duplicate link to the same target (got ${dupeLink.code})`);
  const unlinkRes = await call(memberA, { op: 'action.unlink', auditId: auditA.id, linkId: linkRes.body.data.id });
  ok(unlinkRes.code === 200 && unlinkRes.body.data.link_state === 'rejected', `action.unlink marks the link rejected rather than deleting it (got ${JSON.stringify(unlinkRes.body.data)})`);
  const relinkAfterReject = await call(memberA, { op: 'action.link', auditId: auditA.id, actionId: action1.id, targetType: 'requirement', targetId: r2.id });
  ok(relinkAfterReject.code === 200, `re-linking the same target after a rejection is allowed (got ${relinkAfterReject.code})`);

  // Workflow: draft -> assigned -> in_progress -> submitted_for_review, then blocked by the
  // major-NC gate (this action is linked to a major_nc finding) until a real root cause exists.
  const toAssigned = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'assigned', expectedVersion: action1.row_version });
  ok(toAssigned.code === 200 && toAssigned.body.data.status === 'assigned', `action.updateStatus draft -> assigned succeeds (got ${JSON.stringify(toAssigned.body.data)})`);
  action1 = toAssigned.body.data;
  const badSkipStatus = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'verified', expectedVersion: action1.row_version });
  ok(badSkipStatus.code === 400, `action.updateStatus refuses skipping straight from assigned to verified (got ${badSkipStatus.code})`);
  const toInProgress = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'in_progress', expectedVersion: action1.row_version });
  action1 = toInProgress.body.data;
  const toSubmitted = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'submitted_for_review', expectedVersion: action1.row_version });
  ok(toSubmitted.code === 200, `action.updateStatus in_progress -> submitted_for_review succeeds (got ${toSubmitted.code})`);
  action1 = toSubmitted.body.data;

  const gateBlocked = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'ready_for_verification', expectedVersion: action1.row_version });
  ok(gateBlocked.code === 400 && /root cause/.test(gateBlocked.body.error || ''), `the major-NC gate refuses ready_for_verification with no real root cause yet (got ${gateBlocked.code}: ${gateBlocked.body.error})`);
  const rootCauseFilled = await call(memberA, { op: 'action.update', auditId: auditA.id, id: action1.id, patch: { root_cause_method: 'five_whys', root_cause_summary: 'The isolation valve inspection interval was extended without a documented risk assessment.', cause_categories: ['process_failure'] }, expectedVersion: action1.row_version });
  ok(rootCauseFilled.code === 200, `filling in a real root cause succeeds (got ${rootCauseFilled.code})`);
  action1 = rootCauseFilled.body.data;
  const gateNowPasses = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'ready_for_verification', expectedVersion: action1.row_version });
  ok(gateNowPasses.code === 200 && gateNowPasses.body.data.status === 'ready_for_verification', `the same transition now succeeds once a real root cause is on record (got ${JSON.stringify(gateNowPasses.body.data)})`);
  action1 = gateNowPasses.body.data;

  // ── A40: on_hold now has a real exit path — pause from ready_for_verification, prove a wrong
  // resume target is refused, then prove the exact original status resumes correctly. ────────────
  const toOnHold = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'on_hold', expectedVersion: action1.row_version });
  ok(toOnHold.code === 200 && toOnHold.body.data.status === 'on_hold', `action.updateStatus can pause a ready_for_verification action to on_hold (got ${JSON.stringify(toOnHold.body.data)})`);
  action1 = toOnHold.body.data;
  const resumeWrong = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'in_progress', expectedVersion: action1.row_version });
  ok(resumeWrong.code === 400, `resuming an on_hold action to a status OTHER than the one it was paused from is refused (got ${resumeWrong.code})`);
  const resumeRight = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'ready_for_verification', expectedVersion: action1.row_version });
  ok(resumeRight.code === 200 && resumeRight.body.data.status === 'ready_for_verification', `resuming to the exact status it was paused from succeeds (got ${JSON.stringify(resumeRight.body.data)})`);
  action1 = resumeRight.body.data;

  // Only audit_manager / auditor-with-can_verify may move an action to verified/closed.
  const contribVerifyAttempt = await call(contribA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'verified', expectedVersion: action1.row_version });
  ok(contribVerifyAttempt.code === 403, `a contributor is refused moving an action to verified (got ${contribVerifyAttempt.code})`);
  const toVerified = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'verified', expectedVersion: action1.row_version });
  ok(toVerified.code === 200 && toVerified.body.data.status === 'verified', `an auditor (with can_verify) CAN move the action to verified (got ${JSON.stringify(toVerified.body.data)})`);
  action1 = toVerified.body.data;
  const toClosed = await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: action1.id, to: 'closed', expectedVersion: action1.row_version });
  ok(toClosed.code === 200 && toClosed.body.data.status === 'closed', `action.updateStatus verified -> closed succeeds (got ${JSON.stringify(toClosed.body.data)})`);
  action1 = toClosed.body.data;

  // ── Phase 7.3 slice 2: action.verify / action.reopen ──────────────────────────────────────────
  // Drive a fresh major-NC-linked action to ready_for_verification the same way action1 was above.
  let va = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'finding', targetId: majorFinding2.id, title: 'Verify workflow target' })).body.data;
  va = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: va.id, to: 'assigned', expectedVersion: va.row_version })).body.data;
  va = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: va.id, to: 'in_progress', expectedVersion: va.row_version })).body.data;
  va = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: va.id, to: 'submitted_for_review', expectedVersion: va.row_version })).body.data;
  va = (await call(memberA, { op: 'action.update', auditId: auditA.id, id: va.id, patch: { root_cause_method: 'five_whys', root_cause_summary: 'A sufficiently long, specific, non-generic root cause description for this test case.', cause_categories: ['process_failure'] }, expectedVersion: va.row_version })).body.data;
  va = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: va.id, to: 'ready_for_verification', expectedVersion: va.row_version })).body.data;

  // action.verify's own majorNcRootCauseGate check (not just updateStatus's) is load-bearing: an
  // edit made AFTER reaching ready_for_verification can blank the root cause again, so 'effective'
  // must still be blocked at the verify step itself, not only at the earlier status transition.
  const blanked = (await call(memberA, { op: 'action.update', auditId: auditA.id, id: va.id, patch: { root_cause_summary: 'short' }, expectedVersion: va.row_version })).body.data;
  const gateBlocksVerify = await call(memberA, { op: 'action.verify', auditId: auditA.id, id: blanked.id, result: 'effective', expectedVersion: blanked.row_version });
  ok(gateBlocksVerify.code === 400 && /root cause/.test(gateBlocksVerify.body.error || ''), `action.verify's own major-NC gate refuses 'effective' with a blanked-out root cause (got ${gateBlocksVerify.code}: ${gateBlocksVerify.body.error})`);
  va = (await call(memberA, { op: 'action.update', auditId: auditA.id, id: blanked.id, patch: { root_cause_summary: 'A sufficiently long, specific, non-generic root cause description for this test case.' }, expectedVersion: blanked.row_version })).body.data;

  const contribVerify = await call(contribA, { op: 'action.verify', auditId: auditA.id, id: va.id, result: 'effective', expectedVersion: va.row_version });
  ok(contribVerify.code === 403, `a contributor is refused action.verify (got ${contribVerify.code})`);
  const badResult = await call(memberA, { op: 'action.verify', auditId: auditA.id, id: va.id, result: 'bogus', expectedVersion: va.row_version });
  ok(badResult.code === 400, `action.verify refuses an invalid result value (got ${badResult.code})`);
  const staleVerify = await call(memberA, { op: 'action.verify', auditId: auditA.id, id: va.id, result: 'effective', expectedVersion: va.row_version + 999 });
  ok(staleVerify.code === 409, `action.verify with a stale expectedVersion returns a conflict (got ${staleVerify.code})`);

  const verifiedEffective = await call(memberA, { op: 'action.verify', auditId: auditA.id, id: va.id, result: 'effective', expectedVersion: va.row_version });
  ok(verifiedEffective.code === 200 && verifiedEffective.body.data.verification_status === 'effective' && verifiedEffective.body.data.status === 'ready_for_verification',
    `an 'effective' verify sets verification_status but leaves status alone — advancing to 'verified' is a separate action.updateStatus call (got ${JSON.stringify(verifiedEffective.body.data && { verification_status: verifiedEffective.body.data.verification_status, status: verifiedEffective.body.data.status })})`);
  va = verifiedEffective.body.data;
  va = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: va.id, to: 'verified', expectedVersion: va.row_version })).body.data;
  ok(va.status === 'verified', `the separate action.updateStatus call actually advances status to verified (got ${va.status})`);

  // A 'ineffective' result sends the action straight back to in_progress.
  let ineffAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Ineffective-verify target' })).body.data;
  ineffAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: ineffAction.id, to: 'assigned', expectedVersion: ineffAction.row_version })).body.data;
  ineffAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: ineffAction.id, to: 'in_progress', expectedVersion: ineffAction.row_version })).body.data;
  ineffAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: ineffAction.id, to: 'submitted_for_review', expectedVersion: ineffAction.row_version })).body.data;
  ineffAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: ineffAction.id, to: 'ready_for_verification', expectedVersion: ineffAction.row_version })).body.data;
  const ineffVerify = await call(memberA, { op: 'action.verify', auditId: auditA.id, id: ineffAction.id, result: 'ineffective', notes: 'Recurred within a week.', expectedVersion: ineffAction.row_version });
  ok(ineffVerify.code === 200 && ineffVerify.body.data.verification_status === 'ineffective' && ineffVerify.body.data.status === 'in_progress',
    `an 'ineffective' verify sends the action back to in_progress automatically (got ${JSON.stringify(ineffVerify.body.data && { verification_status: ineffVerify.body.data.verification_status, status: ineffVerify.body.data.status })})`);

  // action.reopen — action1 is 'closed' from the workflow above.
  const reopenContrib = await call(contribA, { op: 'action.reopen', auditId: auditA.id, id: action1.id, reasonCode: 'recurred', expectedVersion: action1.row_version });
  ok(reopenContrib.code === 403, `a contributor is refused action.reopen (got ${reopenContrib.code})`);
  const reopenBadReason = await call(memberA, { op: 'action.reopen', auditId: auditA.id, id: action1.id, reasonCode: 'not_a_real_reason', expectedVersion: action1.row_version });
  ok(reopenBadReason.code === 400, `action.reopen refuses an unrecognised reason code (got ${reopenBadReason.code})`);
  const reopenNotClosed = await call(memberA, { op: 'action.reopen', auditId: auditA.id, id: actionFromReq.body.data.id, reasonCode: 'recurred', expectedVersion: actionFromReq.body.data.row_version });
  ok(reopenNotClosed.code === 400, `action.reopen refuses a draft action that was never verified/closed (got ${reopenNotClosed.code})`);
  const staleReopen = await call(memberA, { op: 'action.reopen', auditId: auditA.id, id: action1.id, reasonCode: 'recurred', expectedVersion: action1.row_version + 999 });
  ok(staleReopen.code === 409, `action.reopen with a stale expectedVersion returns a conflict (got ${staleReopen.code})`);
  const reopened = await call(memberA, { op: 'action.reopen', auditId: auditA.id, id: action1.id, reasonCode: 'recurred', reasonText: 'The nonconformity resurfaced during the follow-up audit.', expectedVersion: action1.row_version });
  ok(reopened.code === 200 && reopened.body.data.status === 'in_progress' && reopened.body.data.reopened_count === 1,
    `action.reopen moves a closed action back to in_progress and increments reopened_count (got ${JSON.stringify(reopened.body.data && { status: reopened.body.data.status, reopened_count: reopened.body.data.reopened_count })})`);
  action1 = reopened.body.data;

  // §6.3a rule 4: a due_date change on an overdue, still-open action needs a reason.
  const overdueAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Overdue test action' })).body.data;
  await db.patchRow('iso_actions', overdueAction.id, { due_date: '2020-01-01' });
  const overdueNoReason = await call(memberA, { op: 'action.update', auditId: auditA.id, id: overdueAction.id, patch: { due_date: '2026-12-31' }, expectedVersion: overdueAction.row_version });
  ok(overdueNoReason.code === 400, `changing the due date on an overdue action with no reason is refused (got ${overdueNoReason.code})`);
  const overdueWithReason = await call(memberA, { op: 'action.update', auditId: auditA.id, id: overdueAction.id, patch: { due_date: '2026-12-31' }, expectedVersion: overdueAction.row_version, reason: 'Client requested more time.' });
  ok(overdueWithReason.code === 200, `changing the due date WITH a reason succeeds (got ${overdueWithReason.code})`);

  // A client caller gets 403 on every action write op.
  for (const [op, extra] of [
    ['action.create', { targetType: 'requirement', targetId: r1.id, title: 'x' }],
    ['action.update', { id: overdueAction.id, patch: { title: 'hacked' }, expectedVersion: overdueAction.row_version }],
    ['action.link', { actionId: overdueAction.id, targetType: 'requirement', targetId: r1.id }],
    ['action.unlink', { linkId: 'ial_x' }],
    ['action.updateStatus', { id: overdueAction.id, to: 'assigned', expectedVersion: overdueAction.row_version }],
    ['action.verify', { id: va.id, result: 'effective', expectedVersion: va.row_version }],
    ['action.reopen', { id: action1.id, reasonCode: 'recurred', expectedVersion: action1.row_version }],
  ]) {
    const res = await call(clientA2, Object.assign({ op, auditId: auditA.id }, extra));
    ok(res.code === 403, `a client caller gets 403 on ${op} (got ${res.code})`);
  }

  // action.list: a client sees only their visibility-eligible, CLIENT_FIELDS-projected rows.
  const visAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Client-visible action', visibility: 'client_all' })).body.data;
  const clientActionList = await call(clientA2, { op: 'action.list', auditId: auditA.id });
  ok(clientActionList.code === 200 && clientActionList.body.data.some(a => a.id === visAction.id), 'a client sees a client_all action in action.list');
  ok(!clientActionList.body.data.some(a => a.id === majorAction.id), 'a client does NOT see an internal-visibility action in action.list');
  const clientActionRow = clientActionList.body.data.find(a => a.id === visAction.id);
  ok(clientActionRow && !('owner_uid' in clientActionRow) && !('created_by' in clientActionRow), 'a client\'s action row is CLIENT_FIELDS-projected — no internal-only field leaks');

  // metric.audit's action-side fields now reflect the real actions just created.
  const metrics2 = await call(admin, { op: 'metric.audit', auditId: auditA.id });
  ok(metrics2.code === 200 && metrics2.body.data.actions_total === 6, `metric.audit's actions_total reflects the actions created this run (got ${metrics2.body.data.actions_total})`);
  // Phase 9.1 (A87): shared_actions means requirements of >=2 DISTINCT STANDARDS, not merely >=2
  // distinct target rows — action1's two targets (r1, r2) are both 9001, same audit, same standard,
  // so this is correctly 0, not 1. This is itself a regression guard against the bug 9.1 fixed (the
  // old formula counted same-standard links as "shared"); the real cross-standard positive case
  // lives in iso-calc-test.cjs, built from a hand-made, deliberately cross-standard fixture.
  ok(metrics2.body.data.shared_actions === 0, `metric.audit's shared_actions is 0 here — action1's two targets are both ISO 9001, not two different standards (got ${metrics2.body.data.shared_actions})`);

  // ── Phase 7.3 slice 3: subtask.* (simple child rows of an action, never client-visible) ───────
  const subtaskBadAction = await call(memberA, { op: 'subtask.add', auditId: auditA.id, actionId: 'not-real', title: 'x' });
  ok(subtaskBadAction.code === 400, `subtask.add against a nonexistent action is refused (got ${subtaskBadAction.code})`);
  const sub1 = (await call(memberA, { op: 'subtask.add', auditId: auditA.id, actionId: majorAction.id, title: 'Draft the containment memo' })).body.data;
  ok(sub1 && sub1.action_id === majorAction.id && sub1.done === false, `subtask.add creates an undone child row on the right action (got ${JSON.stringify(sub1)})`);
  const contribSub = await call(contribA, { op: 'subtask.add', auditId: auditA.id, actionId: majorAction.id, title: 'Contributor-created subtask' });
  ok(contribSub.code === 200, `a contributor can add a subtask (got ${contribSub.code})`);

  const subUpdate = await call(memberA, { op: 'subtask.update', auditId: auditA.id, id: sub1.id, patch: { done: true }, expectedVersion: sub1.row_version });
  ok(subUpdate.code === 200 && subUpdate.body.data.done === true, `subtask.update toggles done (got ${JSON.stringify(subUpdate.body.data)})`);
  const subBadField = await call(memberA, { op: 'subtask.update', auditId: auditA.id, id: sub1.id, patch: { action_id: 'iact_hijack' }, expectedVersion: subUpdate.body.data.row_version });
  ok(subBadField.code === 400, `subtask.update refuses a field outside the allowlist (got ${subBadField.code})`);
  const subBadDone = await call(memberA, { op: 'subtask.update', auditId: auditA.id, id: sub1.id, patch: { done: 'yes' }, expectedVersion: subUpdate.body.data.row_version });
  ok(subBadDone.code === 400, `subtask.update refuses a non-boolean done value (got ${subBadDone.code})`);
  const subStaleVersion = await call(memberA, { op: 'subtask.update', auditId: auditA.id, id: sub1.id, patch: { title: 'Renamed' }, expectedVersion: subUpdate.body.data.row_version + 999 });
  ok(subStaleVersion.code === 409, `subtask.update with a stale expectedVersion returns a conflict (got ${subStaleVersion.code})`);

  const subList = await call(memberA, { op: 'subtask.list', auditId: auditA.id });
  ok(subList.code === 200 && subList.body.data.some(s => s.id === sub1.id), `subtask.list includes the subtask just created (got ${subList.body.data.length} rows)`);

  const subArchive = await call(memberA, { op: 'subtask.archive', auditId: auditA.id, id: sub1.id, expectedVersion: subUpdate.body.data.row_version });
  ok(subArchive.code === 200 && !!subArchive.body.data.archived_at, `subtask.archive stamps archived_at (got ${JSON.stringify(subArchive.body.data)})`);
  const subListAfterArchive = await call(memberA, { op: 'subtask.list', auditId: auditA.id });
  ok(!subListAfterArchive.body.data.some(s => s.id === sub1.id), 'an archived subtask no longer appears in subtask.list');

  // A client caller gets 403 on every subtask op — never in CLIENT_FIELDS.action or its own allowlist.
  for (const [op, extra] of [
    ['subtask.list', {}],
    ['subtask.add', { actionId: majorAction.id, title: 'x' }],
    ['subtask.update', { id: sub1.id, patch: { done: true }, expectedVersion: 1 }],
    ['subtask.archive', { id: sub1.id, expectedVersion: 1 }],
  ]) {
    const res = await call(clientA2, Object.assign({ op, auditId: auditA.id }, extra));
    ok(res.code === 403, `a client caller gets 403 on ${op} (got ${res.code})`);
  }

  // ── Phase 7.3 slice 4: action.submitForReview/decideReview + extension.* ───────────────────────
  let reviewAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Review workflow target' })).body.data;
  reviewAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: reviewAction.id, to: 'assigned', expectedVersion: reviewAction.row_version })).body.data;
  reviewAction = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: reviewAction.id, to: 'in_progress', expectedVersion: reviewAction.row_version })).body.data;

  const submit1 = await call(memberA, { op: 'action.submitForReview', auditId: auditA.id, id: reviewAction.id, expectedVersion: reviewAction.row_version, submissionNote: 'First pass.' });
  ok(submit1.code === 200 && submit1.body.data.action.status === 'submitted_for_review' && submit1.body.data.review.submission_no === 1,
    `action.submitForReview moves status and creates submission_no 1 (got ${JSON.stringify(submit1.body.data && { status: submit1.body.data.action.status, submission_no: submit1.body.data.review.submission_no })})`);
  reviewAction = submit1.body.data.action;
  let review1 = submit1.body.data.review;

  const resubmitTooSoon = await call(memberA, { op: 'action.submitForReview', auditId: auditA.id, id: reviewAction.id, expectedVersion: reviewAction.row_version });
  ok(resubmitTooSoon.code === 400, `action.submitForReview refuses submitting again while already submitted_for_review (got ${resubmitTooSoon.code})`);

  const contribDecide = await call(contribA, { op: 'action.decideReview', auditId: auditA.id, id: review1.id, decision: 'more_info' });
  ok(contribDecide.code === 403, `a contributor is refused action.decideReview (got ${contribDecide.code})`);
  const decideBadValue = await call(memberA, { op: 'action.decideReview', auditId: auditA.id, id: review1.id, decision: 'bogus' });
  ok(decideBadValue.code === 400, `action.decideReview refuses an invalid decision value (got ${decideBadValue.code})`);

  const decideMoreInfo = await call(memberA, { op: 'action.decideReview', auditId: auditA.id, id: review1.id, decision: 'more_info', decisionNote: 'Need the calibration cert attached.' });
  ok(decideMoreInfo.code === 200 && decideMoreInfo.body.data.decision === 'more_info', `action.decideReview('more_info') records the decision (got ${JSON.stringify(decideMoreInfo.body.data)})`);
  const afterMoreInfo = await db.get('iso_actions', reviewAction.id);
  ok(afterMoreInfo.status === 'more_info_required', `a 'more_info' decision auto-reverts the action to more_info_required (got ${afterMoreInfo.status})`);
  reviewAction = afterMoreInfo;

  const decideAgain = await call(memberA, { op: 'action.decideReview', auditId: auditA.id, id: review1.id, decision: 'accepted' });
  ok(decideAgain.code === 400, `action.decideReview refuses deciding the same review twice (got ${decideAgain.code})`);

  const submit2 = await call(memberA, { op: 'action.submitForReview', auditId: auditA.id, id: reviewAction.id, expectedVersion: reviewAction.row_version, submissionNote: 'Resubmitted with the cert attached.' });
  ok(submit2.code === 200 && submit2.body.data.review.submission_no === 2, `resubmitting after more_info_required creates submission_no 2 (got ${submit2.body.data.review.submission_no})`);
  reviewAction = submit2.body.data.action;
  const review2 = submit2.body.data.review;

  const decideAccepted = await call(memberA, { op: 'action.decideReview', auditId: auditA.id, id: review2.id, decision: 'accepted' });
  ok(decideAccepted.code === 200 && decideAccepted.body.data.decision === 'accepted', `action.decideReview('accepted') records the decision (got ${JSON.stringify(decideAccepted.body.data)})`);
  const afterAccepted = await db.get('iso_actions', reviewAction.id);
  ok(afterAccepted.status === 'submitted_for_review', `an 'accepted' decision does NOT auto-advance status — that stays a separate action.updateStatus call (got ${afterAccepted.status})`);

  const reviewList = await call(memberA, { op: 'review.list', auditId: auditA.id, actionId: reviewAction.id });
  ok(reviewList.code === 200 && reviewList.body.data.length === 2 && reviewList.body.data.some(r => r.submission_no === 1) && reviewList.body.data.some(r => r.submission_no === 2),
    `review.list returns both submission cycles (got ${JSON.stringify(reviewList.body.data.map(r => ({ submission_no: r.submission_no, decision: r.decision })))})`);

  for (const [op, extra] of [
    ['action.submitForReview', { id: reviewAction.id, expectedVersion: reviewAction.row_version }],
    ['action.decideReview', { id: review2.id, decision: 'accepted' }],
    ['review.list', { actionId: reviewAction.id }],
  ]) {
    const res = await call(clientA2, Object.assign({ op, auditId: auditA.id }, extra));
    ok(res.code === 403, `a client caller gets 403 on ${op} (got ${res.code})`);
  }

  // extension.* — request/decide a due-date extension.
  const extAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Extension workflow target', dueDate: '2026-06-01' })).body.data;
  const extNoDueDate = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'No due date yet' })).body.data;
  const extBadTarget = await call(memberA, { op: 'extension.request', auditId: auditA.id, actionId: extNoDueDate.id, requestedDue: '2026-07-01', reason: 'Client needs more time.' });
  ok(extBadTarget.code === 400, `extension.request refuses an action with no due date to extend (got ${extBadTarget.code})`);

  const ext1 = (await call(contribA, { op: 'extension.request', auditId: auditA.id, actionId: extAction.id, requestedDue: '2026-07-15', reason: 'Client requested more time to complete the fix.' })).body.data;
  ok(ext1 && ext1.decision === 'pending' && ext1.current_due === '2026-06-01' && ext1.requested_due === '2026-07-15',
    `extension.request creates a pending request with the current due date frozen (got ${JSON.stringify(ext1)})`);

  const extDecideByContrib = await call(contribA, { op: 'extension.decide', auditId: auditA.id, id: ext1.id, decision: 'approved' });
  ok(extDecideByContrib.code === 403, `a contributor is refused extension.decide (got ${extDecideByContrib.code})`);
  const extBadDecision = await call(memberA, { op: 'extension.decide', auditId: auditA.id, id: ext1.id, decision: 'bogus' });
  ok(extBadDecision.code === 400, `extension.decide refuses an invalid decision value (got ${extBadDecision.code})`);

  const extApproved = await call(memberA, { op: 'extension.decide', auditId: auditA.id, id: ext1.id, decision: 'approved', decisionNote: 'Reasonable given the supplier delay.' });
  ok(extApproved.code === 200 && extApproved.body.data.decision === 'approved', `extension.decide('approved') records the decision (got ${JSON.stringify(extApproved.body.data)})`);
  const actionAfterExtension = await db.get('iso_actions', extAction.id);
  ok(actionAfterExtension.due_date === '2026-07-15', `approving the extension actually moves the action's own due_date (got ${actionAfterExtension.due_date})`);

  const extDecideAgain = await call(memberA, { op: 'extension.decide', auditId: auditA.id, id: ext1.id, decision: 'rejected' });
  ok(extDecideAgain.code === 400, `extension.decide refuses deciding the same extension twice (got ${extDecideAgain.code})`);

  const ext2 = (await call(memberA, { op: 'extension.request', auditId: auditA.id, actionId: extAction.id, requestedDue: '2026-08-01', reason: 'A second request, to be rejected.' })).body.data;
  const extRejected = await call(memberA, { op: 'extension.decide', auditId: auditA.id, id: ext2.id, decision: 'rejected' });
  ok(extRejected.code === 200 && extRejected.body.data.decision === 'rejected', `extension.decide('rejected') records the decision (got ${JSON.stringify(extRejected.body.data)})`);
  const actionAfterRejection = await db.get('iso_actions', extAction.id);
  ok(actionAfterRejection.due_date === '2026-07-15', `rejecting an extension leaves the action's due_date untouched (got ${actionAfterRejection.due_date})`);

  const extensionList = await call(memberA, { op: 'extension.list', auditId: auditA.id, actionId: extAction.id });
  ok(extensionList.code === 200 && extensionList.body.data.length === 2, `extension.list returns both requests for this action (got ${extensionList.body.data.length})`);

  for (const [op, extra] of [
    ['extension.request', { actionId: extAction.id, requestedDue: '2026-09-01', reason: 'x' }],
    ['extension.decide', { id: ext2.id, decision: 'approved' }],
    ['extension.list', { actionId: extAction.id }],
  ]) {
    const res = await call(clientA2, Object.assign({ op, auditId: auditA.id }, extra));
    ok(res.code === 403, `a client caller gets 403 on ${op} (got ${res.code})`);
  }

  // ── Phase 7.3 closeout: auditor_review_note (staff-only both ways), client_response (client CAN
  // write, but only that one field, only while the action is in a respondable status, and only when
  // the action is actually shared with them), and a cause_tree cycle rejected on action.update ────
  const extActionFresh = await db.get('iso_actions', extAction.id);
  const reviewNote = await call(memberA, { op: 'action.update', auditId: auditA.id, id: extAction.id, patch: { auditor_review_note: 'Looks thin, ask for more evidence.' }, expectedVersion: extActionFresh.row_version });
  ok(reviewNote.code === 200 && reviewNote.body.data.auditor_review_note === 'Looks thin, ask for more evidence.', `a staff caller can write auditor_review_note (got ${JSON.stringify(reviewNote.body.data && reviewNote.body.data.auditor_review_note)})`);
  const extActionAfterNote = await db.get('iso_actions', extAction.id);
  ok(extActionAfterNote.auditor_review_note === 'Looks thin, ask for more evidence.', 'auditor_review_note actually persisted to storage');

  const clientRespondableAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Client-response target', visibility: 'client_all' })).body.data;
  let cra = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: clientRespondableAction.id, to: 'assigned', expectedVersion: clientRespondableAction.row_version })).body.data;

  const clientMultiFieldAttempt = await call(clientA2, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { client_response: 'We are on it.', title: 'sneaky' }, expectedVersion: cra.row_version });
  ok(clientMultiFieldAttempt.code === 403, `a client is refused if the patch includes ANY field besides client_response (got ${clientMultiFieldAttempt.code})`);
  const clientAuditorNoteAttempt = await call(clientA2, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { auditor_review_note: 'sneaky' }, expectedVersion: cra.row_version });
  ok(clientAuditorNoteAttempt.code === 403, `a client can never write auditor_review_note, even alone (got ${clientAuditorNoteAttempt.code})`);

  const clientRespondOk = await call(clientA2, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { client_response: 'We are on it, done by Friday.' }, expectedVersion: cra.row_version });
  ok(clientRespondOk.code === 200 && clientRespondOk.body.data.client_response === 'We are on it, done by Friday.', `a client CAN write client_response alone while the action is assigned (got ${JSON.stringify(clientRespondOk.body.data)})`);
  ok(!('owner_uid' in clientRespondOk.body.data) && !('created_by' in clientRespondOk.body.data), 'the client_response write response is still CLIENT_FIELDS-projected, no internal field leaks');
  cra = await db.get('iso_actions', cra.id);

  // Not client_all/client_selected for this client -> not found, not merely forbidden (no existence leak).
  const otherClientAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Internal-only, no client access', visibility: 'internal' })).body.data;
  let internalOnly = (await call(memberA, { op: 'action.updateStatus', auditId: auditA.id, id: otherClientAction.id, to: 'assigned', expectedVersion: otherClientAction.row_version })).body.data;
  const clientOnInternalAction = await call(clientA2, { op: 'action.update', auditId: auditA.id, id: internalOnly.id, patch: { client_response: 'x' }, expectedVersion: internalOnly.row_version });
  ok(clientOnInternalAction.code === 404, `a client cannot write client_response on an action never shared with them (got ${clientOnInternalAction.code})`);

  // Not in a respondable status (still draft) -> refused.
  const draftAction = (await call(memberA, { op: 'action.create', auditId: auditA.id, targetType: 'requirement', targetId: r1.id, title: 'Still draft', visibility: 'client_all' })).body.data;
  const clientOnDraft = await call(clientA2, { op: 'action.update', auditId: auditA.id, id: draftAction.id, patch: { client_response: 'x' }, expectedVersion: draftAction.row_version });
  ok(clientOnDraft.code === 403, `a client cannot write client_response while the action is still draft (got ${clientOnDraft.code})`);

  // cause_tree cycle rejected.
  const cycleTree = [{ id: 'n1', parentId: 'n2', text: 'A' }, { id: 'n2', parentId: 'n1', text: 'B' }];
  const cycleAttempt = await call(memberA, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { cause_tree: cycleTree }, expectedVersion: cra.row_version });
  ok(cycleAttempt.code === 400, `action.update refuses a cause_tree containing a cycle (got ${cycleAttempt.code})`);
  // A81: node ids land in the editor's markup — anything outside the id alphabet is refused.
  const badIdAttempt = await call(memberA, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { cause_tree: [{ id: "n1');alert(1);//", parentId: null, text: 'Root' }] }, expectedVersion: cra.row_version });
  const badParent = await call(memberA, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { cause_tree: [{ id: 'n1', parentId: '"><img>', text: 'Root' }] }, expectedVersion: cra.row_version });
  ok(badIdAttempt.code === 400 && badParent.code === 400, `action.update refuses a cause_tree node whose id or parent id is not a plain id (got ${badIdAttempt.code} / ${badParent.code})`);
  const validTree = [{ id: 'n1', parentId: null, text: 'Root cause' }, { id: 'n2', parentId: 'n1', text: 'Contributing factor' }];
  const validTreeSave = await call(memberA, { op: 'action.update', auditId: auditA.id, id: cra.id, patch: { cause_tree: validTree }, expectedVersion: cra.row_version });
  ok(validTreeSave.code === 200, `action.update accepts a valid, cycle-free cause_tree (got ${validTreeSave.code})`);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
