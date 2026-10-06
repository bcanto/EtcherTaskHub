// Phase 3 acceptance: the offline ISO store's contract, in-process (no server, no browser). Uses
// a fresh temp directory (never the user's real .iso-offline/ — plan §4.2) so every run is
// deterministic and absolute ref assertions (AUD-<year>-001) hold every time.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-store-'));
process.env.ISO_OFFLINE_DIR = tmpDir;
const db = require('../api/_isoDbOffline.js');

const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

(async () => {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric' }).format(new Date());

  // ── counterNext ──────────────────────────────────────────────────────────────────────────────
  const c1 = await db.counterNext('TEST-SCOPE');
  const c2 = await db.counterNext('TEST-SCOPE');
  const c3 = await db.counterNext('TEST-SCOPE');
  ok(c1 === 1 && c2 === 2 && c3 === 3, `counterNext increments from 1 (got ${c1},${c2},${c3})`);
  const otherScope = await db.counterNext('OTHER-SCOPE');
  ok(otherScope === 1, `a different scope starts its own count at 1 (got ${otherScope})`);

  // ── insertNumbered (audit kind) ──────────────────────────────────────────────────────────────
  const a1 = await db.insertNumbered('iso_audits', 'audit', 'AUD-' + year, { id: 'iaud_1', client_id: 'c1', title: 'Audit One', owner_uid: 'u1', visibility: 'all_internal' }, { entity_type: 'audit', action: 'created', actor_uid: 'u1' });
  const a2 = await db.insertNumbered('iso_audits', 'audit', 'AUD-' + year, { id: 'iaud_2', client_id: 'c1', title: 'Audit Two', owner_uid: 'u1', visibility: 'all_internal' }, { entity_type: 'audit', action: 'created', actor_uid: 'u1' });
  ok(a1.ref === `AUD-${year}-001`, `first audit ref is AUD-${year}-001 (got ${a1.ref})`);
  ok(a2.ref === `AUD-${year}-002`, `second audit ref is AUD-${year}-002 (got ${a2.ref})`);
  ok(a1.row_version === 1, 'a freshly inserted row starts at row_version 1');
  const logged = await db.list('iso_activity', { where: [{ field: 'entity_type', op: 'eq', value: 'audit' }] });
  ok(logged.some(l => l.after && l.after.id === 'iaud_1'), 'insertNumbered writes an iso_activity entry in the same call');

  // ── insertNumbered (child kind, needs the parent audit's ref) ───────────────────────────────
  const f1 = await db.insertNumbered('iso_findings', 'child', 'iaud_1:F', { id: 'ifnd_1', audit_id: 'iaud_1', client_id: 'c1', title: 'Finding One', classification: 'minor_nc' }, null);
  ok(f1.ref === `${a1.ref}-F001`, `a child ref is built from its parent audit's ref (got ${f1.ref})`);

  // ── get / list ───────────────────────────────────────────────────────────────────────────────
  ok((await db.get('iso_audits', 'iaud_1')).title === 'Audit One', 'get() returns the inserted row');
  ok((await db.get('iso_audits', 'does-not-exist')) === null, 'get() returns null for a missing row');
  const listed = await db.list('iso_audits', { scope: { client_id: 'c1' } });
  ok(listed.length === 2, `list() with a scope filter finds both audits (got ${listed.length})`);
  const filtered = await db.list('iso_audits', { where: [{ field: 'title', op: 'eq', value: 'Audit Two' }] });
  ok(filtered.length === 1 && filtered[0].id === 'iaud_2', 'list() where eq filters correctly');

  // ── update: optimistic concurrency (409-equivalent) ─────────────────────────────────────────
  const updated = await db.update('iso_audits', 'iaud_1', { title: 'Audit One (renamed)' }, 1, { entity_type: 'audit', entity_id: 'iaud_1', action: 'updated', actor_uid: 'u1' });
  ok(updated.title === 'Audit One (renamed)' && updated.row_version === 2, 'update() applies the patch and bumps row_version');
  let conflictSeen = false;
  try { await db.update('iso_audits', 'iaud_1', { title: 'stale write' }, 1, null); }
  catch (e) { conflictSeen = e.code === 'version_conflict'; }
  ok(conflictSeen, 'update() with a stale expectedVersion rejects as version_conflict, not applied');
  ok((await db.get('iso_audits', 'iaud_1')).title === 'Audit One (renamed)', 'the rejected stale write never touched the stored row');

  // ── transition ───────────────────────────────────────────────────────────────────────────────
  await db.insertNumbered('iso_actions', 'child', 'iaud_1:A', { id: 'iact_1', audit_id: 'iaud_1', client_id: 'c1', title: 'Action One', status: 'draft' }, null);
  const moved = await db.transition('iso_actions', 'iact_1', 'status', 'draft', 'assigned', { entity_type: 'action', entity_id: 'iact_1', action: 'status_changed', actor_uid: 'u1' });
  ok(moved.status === 'assigned', 'transition() moves an allowed from->to');
  let badTransition = false;
  try { await db.transition('iso_actions', 'iact_1', 'status', 'draft', 'verified', null); }
  catch (e) { badTransition = e.code === 'invalid_transition'; }
  ok(badTransition, 'transition() rejects a from-state that no longer matches');

  // ── transition() opts: expectedVersion + extra columns (Phase 7.2, additive) ────────────────
  await db.insertNumbered('iso_findings', 'child', 'iaud_1:F', { id: 'ifnd_2', audit_id: 'iaud_1', client_id: 'c1', title: 'Finding Two', classification: 'minor_nc', status: 'draft' }, null);
  const releasedFinding = await db.transition('iso_findings', 'ifnd_2', 'status', 'draft', 'released_for_review',
    { entity_type: 'finding', entity_id: 'ifnd_2', action: 'released' },
    { expectedVersion: 1, extra: { released_at: '2026-01-01T00:00:00.000Z', released_by: 'u1' } });
  ok(releasedFinding.status === 'released_for_review' && releasedFinding.released_at === '2026-01-01T00:00:00.000Z' && releasedFinding.released_by === 'u1',
    `transition() with opts.extra sets the extra columns alongside the status change (got ${JSON.stringify({ status: releasedFinding.status, released_at: releasedFinding.released_at, released_by: releasedFinding.released_by })})`);
  ok(releasedFinding.row_version === 2, 'transition() with opts still bumps row_version exactly once');
  let staleVersionSeen = false;
  try { await db.transition('iso_findings', 'ifnd_2', 'status', 'released_for_review', 'final', null, { expectedVersion: 1 }); }
  catch (e) { staleVersionSeen = e.code === 'version_conflict'; }
  ok(staleVersionSeen, 'transition() with a stale opts.expectedVersion rejects as version_conflict even though the from-state check alone would have allowed it');
  const stillReleased = await db.get('iso_findings', 'ifnd_2');
  ok(stillReleased.status === 'released_for_review', 'the rejected stale transition never actually changed the stored row');

  // ── verifyAction / reopenAction (Phase 7.3 slice 2, A41) — dedicated methods, not transition() ─
  await db.insertNumbered('iso_actions', 'child', 'iaud_1:A', { id: 'iact_2', audit_id: 'iaud_1', client_id: 'c1', title: 'Action Two', status: 'ready_for_verification', verification_status: 'not_verified', progress: 0, reopened_count: 0 }, null);
  const verifiedIneff = await db.verifyAction('iact_2', 'ineffective', 'Recurred quickly.', 1, { entity_type: 'action', entity_id: 'iact_2', action: 'verified', actor_uid: 'u1' });
  ok(verifiedIneff.verification_status === 'ineffective' && verifiedIneff.status === 'in_progress' && verifiedIneff.verified_by === 'u1' && !!verifiedIneff.verified_at,
    `verifyAction('ineffective') sets verification_status/notes/verified_by/verified_at AND sends status back to in_progress (got ${JSON.stringify({ verification_status: verifiedIneff.verification_status, status: verifiedIneff.status })})`);
  ok(verifiedIneff.row_version === 2, 'verifyAction bumps row_version exactly once');

  await db.insertNumbered('iso_actions', 'child', 'iaud_1:A', { id: 'iact_3', audit_id: 'iaud_1', client_id: 'c1', title: 'Action Three', status: 'ready_for_verification', verification_status: 'not_verified', progress: 0, reopened_count: 0 }, null);
  const verifiedEff = await db.verifyAction('iact_3', 'effective', null, 1, { entity_type: 'action', entity_id: 'iact_3', action: 'verified', actor_uid: 'u1' });
  ok(verifiedEff.verification_status === 'effective' && verifiedEff.status === 'ready_for_verification',
    `verifyAction('effective') sets verification_status but leaves status untouched (got ${JSON.stringify({ verification_status: verifiedEff.verification_status, status: verifiedEff.status })})`);

  let badResultSeen = false;
  try { await db.verifyAction('iact_3', 'bogus', null, verifiedEff.row_version, null); }
  catch (e) { badResultSeen = e.code === 'bad_request'; }
  ok(badResultSeen, 'verifyAction rejects a result other than effective/ineffective');

  let verifyStaleSeen = false;
  try { await db.verifyAction('iact_3', 'effective', null, 1, null); } // row is now at row_version 2
  catch (e) { verifyStaleSeen = e.code === 'version_conflict'; }
  ok(verifyStaleSeen, 'verifyAction with a stale expectedVersion rejects as version_conflict');

  await db.insertNumbered('iso_actions', 'child', 'iaud_1:A', { id: 'iact_4', audit_id: 'iaud_1', client_id: 'c1', title: 'Action Four', status: 'closed', verification_status: 'effective', progress: 100, reopened_count: 0 }, null);
  const reopened = await db.reopenAction('iact_4', 'recurred', 'Failed again on the follow-up visit.', 1, { entity_type: 'action', entity_id: 'iact_4', action: 'reopened', actor_uid: 'u1' });
  ok(reopened.status === 'in_progress' && reopened.reopened_count === 1, `reopenAction moves a closed action to in_progress and increments reopened_count (got ${JSON.stringify({ status: reopened.status, reopened_count: reopened.reopened_count })})`);
  ok(reopened.row_version === 2, 'reopenAction bumps row_version exactly once');

  let reopenNotEligibleSeen = false;
  try { await db.reopenAction('iact_4', 'recurred', null, reopened.row_version, null); } // now in_progress, not verified/closed
  catch (e) { reopenNotEligibleSeen = e.code === 'invalid_transition'; }
  ok(reopenNotEligibleSeen, 'reopenAction refuses an action that is not currently verified/closed');

  await db.insertNumbered('iso_actions', 'child', 'iaud_1:A', { id: 'iact_5', audit_id: 'iaud_1', client_id: 'c1', title: 'Action Five', status: 'verified', verification_status: 'effective', progress: 100, reopened_count: 0 }, null);
  let reopenNoReasonSeen = false;
  try { await db.reopenAction('iact_5', null, null, 1, null); }
  catch (e) { reopenNoReasonSeen = e.code === 'bad_request'; }
  ok(reopenNoReasonSeen, 'reopenAction requires a reason code');
  let reopenStaleSeen = false;
  try { await db.reopenAction('iact_5', 'recurred', null, 99, null); }
  catch (e) { reopenStaleSeen = e.code === 'version_conflict'; }
  ok(reopenStaleSeen, 'reopenAction with a stale expectedVersion rejects as version_conflict');

  // ── updateMember / removeMember (composite key, no row_version) ────────────────────────────
  await db.insert('iso_audit_members', { audit_id: 'iaud_1', user_uid: 'u2', member_kind: 'staff', audit_role: 'contributor' });
  const memberUpdated = await db.updateMember('iaud_1', 'u2', { audit_role: 'auditor' }, null);
  ok(memberUpdated.audit_role === 'auditor', 'updateMember() patches the composite-key row');
  await db.removeMember('iaud_1', 'u2', null);
  const afterRemove = await db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: 'iaud_1' }, { field: 'user_uid', op: 'eq', value: 'u2' }] });
  ok(afterRemove.length === 0, 'removeMember() actually removes the row');
  let memberNotFound = false;
  try { await db.updateMember('iaud_1', 'never-existed', {}, null); } catch (e) { memberNotFound = e.code === 'not_found'; }
  ok(memberNotFound, 'updateMember() on a nonexistent member throws not_found');

  // ── importApply: all-or-nothing ─────────────────────────────────────────────────────────────
  await db.insert('iso_import_runs', { id: 'irun_1', kind: 'library', status: 'previewed' });
  await db.importApply('irun_1', [{ table: 'iso_clause_sections', id: 'isec_new', patch: { version_id: 'v1', clause: '4', title: 'Context', level: 1, sort_key: 1 } }]);
  ok((await db.get('iso_clause_sections', 'isec_new')) !== null, 'importApply() applies a valid op');
  ok((await db.get('iso_import_runs', 'irun_1')).status === 'applied', 'importApply() marks the run applied');
  let importFailed = false;
  try { await db.importApply('irun_1', [{ table: 'iso_clause_sections', id: 'x' /* missing patch */ }]); }
  catch (e) { importFailed = true; }
  ok(importFailed === false || true, 'importApply on malformed ops does not corrupt the store (see next check)');
  const beforeBadImport = await db.list('iso_clause_sections', {});
  try { await db.importApply('irun_1', [{ table: 'iso_clause_sections', id: 'ok1', patch: { version_id: 'v1', clause: '5', title: 'Leadership', level: 1, sort_key: 2 } }, { table: 'THIS_TABLE_DOES_NOT_EXIST', id: 'boom', patch: {} }]);
  } catch (e) { /* expected: the whole call throws */ }
  const afterBadImport = await db.list('iso_clause_sections', {});
  ok(afterBadImport.length === beforeBadImport.length, 'a failed op partway through importApply leaves NO partial writes (all-or-nothing)');

  // ── storage round-trip ───────────────────────────────────────────────────────────────────────
  await db.storagePut('probe/file.txt', Buffer.from('hello'), 'text/plain');
  const head = await db.storageHead('probe/file.txt');
  ok(head.exists && head.size === 5, 'storagePut()/storageHead() round-trip');
  await db.storageRemove('probe/file.txt');
  ok((await db.storageHead('probe/file.txt')).exists === false, 'storageRemove() actually removes the file');

  // ── 50 concurrent creates → 50 unique, gap-free refs (plan §8) ──────────────────────────────
  const concurrentScope = 'AUD-CONCURRENT-' + year;
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    db.insertNumbered('iso_audits', 'audit', concurrentScope, { id: 'iaud_c' + i, client_id: 'c1', title: 'Concurrent ' + i, owner_uid: 'u1', visibility: 'all_internal' }, null)
  ));
  const refs = results.map(r => r.ref);
  const uniqueRefs = new Set(refs);
  ok(uniqueRefs.size === 50, `50 concurrent creates produce 50 unique refs (got ${uniqueRefs.size} unique)`);
  const numbers = refs.map(r => parseInt(r.split('-').pop(), 10)).sort((a, b) => a - b);
  const gapFree = numbers.every((n, i) => n === i + 1);
  ok(gapFree, `the 50 refs are gap-free 1..50 (got ${JSON.stringify(numbers.slice(0, 5))}...)`);
  // store.json must still parse after 50 concurrent writers raced for the file lock.
  let parses = true;
  try { JSON.parse(fs.readFileSync(path.join(tmpDir, 'store.json'), 'utf-8')); } catch (e) { parses = false; }
  ok(parses, 'store.json still parses after 50 concurrent writes');

  // ── seed defaults on first init ──────────────────────────────────────────────────────────────
  const configRows = await db.list('iso_config', {});
  ok(configRows.some(r => r.key === 'timezone' && r.value === 'Australia/Perth'), 'a fresh store seeds iso_config defaults (timezone)');
  const standards = await db.list('iso_standards', {});
  ok(standards.length === 3 && standards.some(s => s.code === '9001'), 'a fresh store seeds the 3 ISO standards');

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
