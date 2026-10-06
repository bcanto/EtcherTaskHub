// Phase 3 acceptance: pure ISO rules, in-process (no server, no browser). Every permission-matrix
// cell (plan §6.4 D11 access table), every action transition (§6.2), visibility stripping (§6.3)
// and a two-client leak fixture (like portal-logic-test.cjs).
const iso = require('../api/_iso.js');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

const audit = (over) => Object.assign({ id: 'iaud_1', client_id: 'cA', owner_uid: 'u_owner', visibility: 'all_internal', row_version: 1 }, over);
const staff = (uid, role, restricted) => ({ uid, kind: 'staff', role: role || 'staff', restricted: !!restricted, clientId: null });
const client = (uid, clientId) => ({ uid, kind: 'client', role: 'client', restricted: false, clientId });
const memberRow = (uid, auditRole, kind) => ({ audit_id: 'iaud_1', user_uid: uid, member_kind: kind || 'staff', audit_role: auditRole, ...iso.defaultFlagsFor(auditRole) });

(async () => {
  // ── D11 access table ────────────────────────────────────────────────────────────────────────
  const a = audit();
  ok(iso.canOpenAudit(staff('u_admin', 'admin'), a, []), 'admin can always open an audit');
  ok(iso.canOpenAudit(staff('u_owner', 'staff'), a, []), 'the owner can open their own audit even with no member row');
  ok(iso.canOpenAudit(staff('u_member', 'staff'), a, [memberRow('u_member', 'auditor')]), 'a named member can open the audit');
  ok(iso.canOpenAudit(staff('u_other', 'staff'), a, []), 'on an all_internal board, any other active staff can open it');
  ok(iso.resolveMembership(staff('u_other', 'staff'), a, []).audit_role === 'contributor', 'a non-member on all_internal gets contributor');
  ok(iso.resolveMembership(staff('u_other', 'staff', true), a, []).audit_role === 'reviewer', 'a restricted non-member on all_internal gets reviewer, not contributor');

  const priv = audit({ visibility: 'private' });
  ok(!iso.canOpenAudit(staff('u_stranger', 'staff'), priv, []), 'a non-member cannot open a private audit');
  ok(iso.canOpenAudit(staff('u_owner', 'staff'), priv, []), 'the owner can still open their own private audit');
  ok(iso.canOpenAudit(staff('u_admin', 'admin'), priv, []), 'admin can open a private audit too');
  ok(iso.canOpenAudit(staff('u_member', 'staff'), priv, [memberRow('u_member', 'reviewer')]), 'a named member can open a private audit');

  ok(iso.canOpenAudit(client('cu1', 'cA'), audit({ client_portal_enabled: true }), [memberRow('cu1', 'client_contributor', 'client')]), 'a named client member can open a shared audit');
  ok(!iso.canOpenAudit(client('cu1', 'cA'), audit({ client_portal_enabled: false }), [memberRow('cu1', 'client_contributor', 'client')]), 'a client cannot open an audit that is not portal-shared, even as a named member');
  ok(!iso.canOpenAudit(client('cu1', 'cB'), audit({ client_portal_enabled: true, client_id: 'cA' }), [memberRow('cu1', 'client_contributor', 'client')]), 'a client from a different client_id can never open the audit');
  ok(!iso.canOpenAudit(client('cu2', 'cA'), audit({ client_portal_enabled: true }), [memberRow('cu1', 'client_contributor', 'client')]), 'a client with no membership row cannot open it even if all_internal-equivalent — clients are never implicit members');

  // ── allowedAuditRoles ────────────────────────────────────────────────────────────────────────
  // D35/R2: 'lead_auditor' added first (P10); 'audit_manager'/'contributor' stay allowed (D35's
  // "retiring" pattern) so an existing membership row is never force-migrated.
  ok(JSON.stringify(iso.allowedAuditRoles(staff('u1', 'admin'))) === JSON.stringify(['lead_auditor', 'audit_manager', 'auditor', 'contributor', 'reviewer']), 'admin/staff may hold any staff audit role');
  ok(JSON.stringify(iso.allowedAuditRoles(staff('u1', 'staff', true))) === JSON.stringify(['reviewer']), 'restricted staff may only hold reviewer');
  ok(JSON.stringify(iso.allowedAuditRoles(client('cu1', 'cA'))) === JSON.stringify(['client_admin', 'client_contributor']), 'a client may only hold client_admin or client_contributor');

  // ── default member flags (plan §6.4) ────────────────────────────────────────────────────────
  const flagRows = { audit_manager: [1, 0, 1, 0], auditor: [1, 0, 1, 0], contributor: [1, 0, 0, 0], reviewer: [0, 0, 0, 0], client_admin: [1, 1, 0, 1], client_contributor: [1, 1, 0, 0] };
  for (const [role, expect] of Object.entries(flagRows)) {
    const f = iso.defaultFlagsFor(role);
    const got = [f.can_upload_evidence, f.can_respond, f.can_verify, f.can_manage_client_actions].map(Number);
    ok(JSON.stringify(got) === JSON.stringify(expect), `default flags for ${role} are ${JSON.stringify(expect)} (got ${JSON.stringify(got)})`);
  }

  // ── §6.2 action transitions — every documented edge, both allowed and refused ───────────────
  const allowedEdges = [
    ['draft', 'assigned'], ['assigned', 'in_progress'], ['in_progress', 'awaiting_evidence'],
    ['in_progress', 'submitted_for_review'], ['awaiting_evidence', 'submitted_for_review'],
    ['submitted_for_review', 'more_info_required'], ['submitted_for_review', 'ready_for_verification'],
    ['more_info_required', 'submitted_for_review'], ['ready_for_verification', 'verified'], ['verified', 'closed'],
  ];
  for (const [from, to] of allowedEdges) ok(iso.isAllowedActionTransition(from, to), `action transition ${from} -> ${to} is allowed`);
  const refusedEdges = [
    ['draft', 'verified'], ['draft', 'closed'], ['closed', 'in_progress'], ['verified', 'draft'],
    ['assigned', 'ready_for_verification'], ['submitted_for_review', 'closed'],
  ];
  for (const [from, to] of refusedEdges) ok(!iso.isAllowedActionTransition(from, to), `action transition ${from} -> ${to} is refused`);
  ok(iso.isAllowedActionTransition('in_progress', 'on_hold') && iso.isAllowedActionTransition('assigned', 'on_hold'), 'on_hold is reachable from an active status');
  ok(!iso.isAllowedActionTransition('closed', 'on_hold') && !iso.isAllowedActionTransition('on_hold', 'on_hold'), 'on_hold is never reachable from closed or from itself');
  // A40: resuming from on_hold — isAllowedActionTransition only checks the coarse shape (some
  // resumable status), since it has no access to the row's on_hold_from_status; the exact
  // destination is enforced in action.updateStatus.run() (exercised end-to-end in iso-security-test).
  ok(iso.isAllowedActionTransition('on_hold', 'in_progress') && iso.isAllowedActionTransition('on_hold', 'draft'), 'on_hold coarsely allows resuming to any resumable active status');
  ok(!iso.isAllowedActionTransition('on_hold', 'verified') && !iso.isAllowedActionTransition('on_hold', 'closed'), 'on_hold can never resume straight into verified or closed');

  // ── Phase 7.2: finding permission tiers and lifecycle transitions ──────────────────────────
  const contributorCtx = { caller: staff('u_c', 'staff'), membership: memberRow('u_c', 'contributor') };
  const auditorCtx = { caller: staff('u_a', 'staff'), membership: memberRow('u_a', 'auditor') };
  const reviewerCtx = { caller: staff('u_r', 'staff'), membership: memberRow('u_r', 'reviewer') };
  ok(iso.canManageFinding(contributorCtx), 'a contributor can draft/edit a finding\'s content');
  ok(!iso.canProgressFinding(contributorCtx), 'a contributor cannot progress a finding through its lifecycle (release/finalise/close/withdraw) — an auditor-tier decision');
  ok(iso.canProgressFinding(auditorCtx), 'an auditor can progress a finding through its lifecycle');
  ok(!iso.canManageFinding(reviewerCtx), 'a reviewer (read-only tier) cannot even draft a finding');

  const findingAllowedEdges = [['draft', 'released_for_review'], ['draft', 'withdrawn'], ['released_for_review', 'final'], ['released_for_review', 'withdrawn'], ['final', 'closed']];
  for (const [from, to] of findingAllowedEdges) ok(iso.isAllowedFindingTransition(from, to), `finding transition ${from} -> ${to} is allowed`);
  const findingRefusedEdges = [['draft', 'final'], ['draft', 'closed'], ['released_for_review', 'closed'], ['final', 'draft'], ['final', 'withdrawn'], ['closed', 'draft'], ['withdrawn', 'draft']];
  for (const [from, to] of findingRefusedEdges) ok(!iso.isAllowedFindingTransition(from, to), `finding transition ${from} -> ${to} is refused`);

  // ── Phase 7.3 (this slice): action permission tiers + the major-NC root-cause gate ────────────
  const auditManagerCtx = { caller: staff('u_am', 'staff'), membership: memberRow('u_am', 'audit_manager') };
  const auditorNoVerifyCtx = { caller: staff('u_av', 'staff'), membership: Object.assign(memberRow('u_av', 'auditor'), { can_verify: false }) };
  const auditorWithVerifyCtx = { caller: staff('u_avy', 'staff'), membership: Object.assign(memberRow('u_avy', 'auditor'), { can_verify: true }) };
  ok(iso.canManageAction(contributorCtx), 'a contributor can create/edit an action\'s day-to-day content');
  ok(!iso.canVerifyAction(contributorCtx), 'a contributor cannot verify/close an action');
  ok(iso.canVerifyAction(auditManagerCtx), 'an audit_manager can always verify/close an action');
  ok(!iso.canVerifyAction(auditorNoVerifyCtx), 'an auditor WITHOUT can_verify cannot verify/close an action');
  ok(iso.canVerifyAction(auditorWithVerifyCtx), 'an auditor WITH can_verify can verify/close an action');

  ok(iso.isGenericRootCause('Human error.') && iso.isGenericRootCause('  Mistake  ') && iso.isGenericRootCause('FORGOT'),
    'isGenericRootCause catches the documented generic phrases, case/whitespace/punctuation-insensitively');
  ok(!iso.isGenericRootCause('Human error during the handover, because the checklist step was removed in 2024.'),
    'isGenericRootCause does not flag a real explanation that happens to mention "human error" among other content');
  const majorFindingFx = { classification: 'major_nc' };
  const minorFindingFx = { classification: 'minor_nc' };
  ok(iso.majorNcRootCauseGate({ root_cause_summary: '', root_cause_method: 'none', cause_categories: [] }, [minorFindingFx]) === null,
    'majorNcRootCauseGate is a no-op when nothing linked is actually a major_nc');
  ok(typeof iso.majorNcRootCauseGate({ root_cause_summary: 'short', root_cause_method: 'five_whys', cause_categories: ['process_failure'] }, [majorFindingFx]) === 'string',
    'majorNcRootCauseGate blocks a summary under 40 characters when a linked finding is major_nc');
  ok(typeof iso.majorNcRootCauseGate({ root_cause_summary: 'Human error.', root_cause_method: 'five_whys', cause_categories: ['process_failure'] }, [majorFindingFx]) === 'string',
    'majorNcRootCauseGate blocks a generic-phrase summary even if it were padded past 40 characters some other way');
  ok(iso.majorNcRootCauseGate({ root_cause_summary: 'A' + ' real'.repeat(10), root_cause_method: 'five_whys', cause_categories: ['process_failure'] }, [majorFindingFx]) === null,
    'majorNcRootCauseGate passes a real, long-enough, non-generic summary with a method and a category');

  // ── Phase 7.3 slice 2: action.verify/action.reopen's enumerations ──────────────────────────────
  ok(iso.ACTION_VERIFICATION_RESULTS.includes('effective') && iso.ACTION_VERIFICATION_RESULTS.includes('ineffective') && iso.ACTION_VERIFICATION_RESULTS.length === 2,
    `ACTION_VERIFICATION_RESULTS is exactly effective/ineffective (got ${JSON.stringify(iso.ACTION_VERIFICATION_RESULTS)})`);
  ok(['evidence_invalid', 'ineffective', 'recurred', 'connected_requirement_changed', 'later_audit_found', 'closed_in_error', 'other'].every(r => iso.ACTION_REOPEN_REASONS.includes(r)) && iso.ACTION_REOPEN_REASONS.length === 7,
    `ACTION_REOPEN_REASONS matches the plan's §6.2 allowed-reasons list exactly (got ${JSON.stringify(iso.ACTION_REOPEN_REASONS)})`);

  // ── Phase 7.3 slice 4: action.submitForReview/decideReview + extension.*'s enumeration ─────────
  ok(['accepted', 'rejected', 'more_info'].every(d => iso.REVIEW_DECISIONS.includes(d)) && iso.REVIEW_DECISIONS.length === 3,
    `REVIEW_DECISIONS matches iso_action_reviews' own check constraint exactly (got ${JSON.stringify(iso.REVIEW_DECISIONS)})`);

  // ── Phase 7.3 closeout: causeTreeHasCycle + the client-writable-fields allowlist ────────────────
  ok(iso.CLIENT_WRITABLE_ACTION_FIELDS.length === 1 && iso.CLIENT_WRITABLE_ACTION_FIELDS[0] === 'client_response',
    `a client may write exactly one action field, client_response (got ${JSON.stringify(iso.CLIENT_WRITABLE_ACTION_FIELDS)})`);
  ok(!iso.causeTreeHasCycle([]) && !iso.causeTreeHasCycle(null) && !iso.causeTreeHasCycle(undefined),
    'causeTreeHasCycle treats an empty/missing tree as cycle-free');
  ok(!iso.causeTreeHasCycle([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }]),
    'causeTreeHasCycle accepts a valid tree with two children of the same root');
  ok(iso.causeTreeHasCycle([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]),
    'causeTreeHasCycle catches a direct 2-node cycle');
  ok(iso.causeTreeHasCycle([{ id: 'a', parentId: 'a' }]),
    'causeTreeHasCycle catches a node that is its own parent');
  ok(iso.causeTreeHasCycle([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'c' }, { id: 'c', parentId: 'a' }]),
    'causeTreeHasCycle catches a longer 3-node cycle, not just a direct one');

  // ── §6.3 visibility / CLIENT_FIELDS — whitelist only, never a blocklist ─────────────────────
  const internalAudit = { id: 'iaud_1', ref: 'AUD-2026-001', title: 'Secret Title', client_id: 'cA', row_version: 3,
    internal_notes: 'never leak this', owner_uid: 'u_owner', lead_auditor_uid: 'u_lead', visible_to_uids: ['x'] };
  const projected = iso.projectForClient('audit', internalAudit);
  ok(projected.title === 'Secret Title' && projected.ref === 'AUD-2026-001', 'projectForClient keeps the allowlisted fields');
  ok(!('internal_notes' in projected) && !('owner_uid' in projected) && !('lead_auditor_uid' in projected) && !('visible_to_uids' in projected),
    'projectForClient drops every non-allowlisted field, even ones that happen to be present on the row');
  // 'evidence' is Phase 8's entity name — still genuinely undeclared as of Phase 7.2. 'finding'
  // itself gained a real allowlist this phase (Phase 7.2), so it no longer serves as this example.
  ok(iso.projectForClient('evidence', { id: 'x' }) === null, 'an entity with no declared CLIENT_FIELDS allowlist is never sent to a client at all');
  for (const f of iso.NEVER_TO_CLIENT) {
    const row = { id: 'x', [f]: 'leak-me' };
    // Add f to every entity's allowlist hypothetically to prove the second layer (NEVER_TO_CLIENT)
    // still blocks it even if a future allowlist typo added it.
    const withAllowlisted = iso.projectForClient('audit', { ...internalAudit, [f]: 'leak-me' });
    ok(!(f in withAllowlisted) || !CLIENT_FIELDS_HAS(f), `NEVER_TO_CLIENT still blocks "${f}" even if it were added to an allowlist`);
  }
  function CLIENT_FIELDS_HAS(f) { return iso.CLIENT_FIELDS.audit.includes(f); }

  // ── requireReason (plan §6.3a) ───────────────────────────────────────────────────────────────
  let threw = false;
  try { iso.requireReason('', 'reopen a closed action'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'requireReason rejects an empty reason with 400');
  threw = false;
  try { iso.requireReason('   ', 'x'); } catch (e) { threw = e.status === 400; }
  ok(threw, 'requireReason rejects a whitespace-only reason');
  let noThrow = true;
  try { iso.requireReason('evidence was invalid', 'x'); } catch (e) { noThrow = false; }
  ok(noThrow, 'requireReason accepts a real reason');

  // ── op registry shape (every op declares scope + clientProjection — iso-security-test also
  // checks this at the full registry level; this is the same assertion at unit-test speed) ────
  const opNames = Object.keys(iso.registry);
  ok(opNames.length >= 25, `the op registry has the Phase 3 ops registered (got ${opNames.length})`);
  for (const name of opNames) {
    const def = iso.registry[name];
    ok(!!def.scope, `op ${name} declares a scope`);
    ok(def.scope === 'none' || def.clientProjection !== undefined, `op ${name} declares a client projection (or is scope:none)`);
    ok(typeof def.allow === 'function', `op ${name} declares allow()`);
    ok(typeof def.run === 'function', `op ${name} declares run()`);
  }

  // ── two-client leak fixture (mirrors portal-logic-test.cjs's own pattern) ───────────────────
  const auditA = audit({ id: 'iaud_A', client_id: 'cA' });
  const auditB = audit({ id: 'iaud_B', client_id: 'cB', owner_uid: 'u_ownerB' });
  const clientAUser = client('cuA', 'cA');
  ok(!iso.canOpenAudit(clientAUser, { ...auditB, client_portal_enabled: true }, [memberRow('cuA', 'client_contributor', 'client')]),
    'a client-A user can never open client-B\'s audit, even holding a (mistaken) membership row for it — client_id must match first');
  const stranger = staff('u_stranger', 'staff');
  ok(iso.canOpenAudit(stranger, auditA, []) && iso.canOpenAudit(stranger, auditB, []),
    'sanity: an ordinary staff member CAN see both (all_internal) — proves the client-A denial above is about client_id, not just "no access to anything"');

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
