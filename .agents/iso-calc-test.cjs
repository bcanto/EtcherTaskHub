// Phase 9.1 acceptance (plan §7, "Calculation dictionary"): api/_isoCalc.js is pure CommonJS — no DB,
// no clock — so most of this suite is plain unit tests against hand-built fixtures, exactly as the
// plan's own testing spec asks ("a fixture per metric + edge cases: all N/A, zero requirements, only
// unassessed"). A short HTTP section at the end proves metric.audit/metric.portfolio are thin,
// faithful wrappers around the same pure functions, over one real offline board — not a UI pass,
// since there is no dashboard yet to click through (that is Phase 9.2's own job).
const assert = require('assert');
const path = require('path');
const calc = require(path.join(__dirname, '..', 'api', '_isoCalc.js'));
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
function eq(actual, expected, msg) {
  try { assert.deepStrictEqual(actual, expected); pass.push(msg); }
  catch (e) { fail.push(`${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`); }
}

// ── computeRequirementMetrics: req_total … risk_distribution ───────────────────────────────────
(() => {
  // Edge case: zero requirements.
  const z = calc.computeRequirementMetrics([], new Map(), new Map());
  eq([z.req_total, z.req_applicable, z.req_assessed, z.assessment_completion_pct, z.req_conforming, z.conformance_pct],
    [0, 0, 0, 0, 0, 0], 'zero requirements: every count and percentage is 0, never NaN');

  // Edge case: all not_applicable.
  const allNa = [{ id: 'r1', applicability: 'not_applicable' }, { id: 'r2', applicability: 'not_applicable' }];
  const na = calc.computeRequirementMetrics(allNa, new Map(), new Map());
  eq([na.req_total, na.req_applicable, na.assessment_completion_pct, na.conformance_pct], [2, 0, 0, 0], 'all not_applicable: req_applicable is 0, percentages are 0 (not a 0/0 NaN)');

  // Edge case: only unassessed (never touched).
  const onlyUnassessed = [
    { id: 'r1', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null },
    { id: 'r2', applicability: 'applicable', assessment_state: 'in_progress', assessment_result: null },
  ];
  const ou = calc.computeRequirementMetrics(onlyUnassessed, new Map(), new Map());
  eq([ou.req_applicable, ou.req_assessed, ou.assessment_completion_pct, ou.req_conforming, ou.conformance_pct], [2, 0, 0, 0, 0], 'only-unassessed requirements: assessed/conforming are 0, not NaN');
  eq(ou.req_by_result, { unassessed: 2 }, 'req_by_result groups a null result under "unassessed"');
  eq(ou.req_by_state, { not_started: 1, in_progress: 1 }, 'req_by_state groups by the raw assessment_state');

  // 'review' applicability still counts as applicable (only not_applicable is excluded) — plan §7.
  const withReview = [{ id: 'r1', applicability: 'review', assessment_state: 'not_started', assessment_result: null }];
  eq(calc.computeRequirementMetrics(withReview, new Map(), new Map()).req_applicable, 1, '"review" applicability still counts toward req_applicable — only not_applicable is excluded');

  // The real bug this phase fixes: assessment_state can reach 'complete' with assessment_result
  // still null (requirement.update's own validateRequirementPatch never requires the two together —
  // confirmed by reading it, not assumed) — such a row must NOT count as assessed or conforming.
  const completeNoResult = [{ id: 'r1', applicability: 'applicable', assessment_state: 'complete', assessment_result: null }];
  const cnr = calc.computeRequirementMetrics(completeNoResult, new Map(), new Map());
  eq([cnr.req_assessed, cnr.assessment_completion_pct], [0, 0], "assessment_state 'complete' with no result is NOT counted as assessed");

  // conformance_pct's denominator is req_applicable, never req_assessed (plan §7: "Unassessed stay
  // in the denominator → never counted as conforming"). 1 conforming of 4 applicable = 25%, not 1 of
  // 1 assessed-with-a-result = 100% (the pre-9.1 formula's answer for this exact fixture).
  const mixed = [
    { id: 'r1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective' },
    { id: 'r2', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null },
    { id: 'r3', applicability: 'applicable', assessment_state: 'in_progress', assessment_result: null },
    { id: 'r4', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null },
  ];
  const mx = calc.computeRequirementMetrics(mixed, new Map(), new Map());
  eq([mx.req_conforming, mx.conformance_pct], [1, 25], 'conformance_pct divides by req_applicable (4), not req_assessed (1) — 25%, not 100%');

  // findings_by_unit / risk_distribution: findings and actions have no unit of their own — only
  // through the requirement(s) they are raised against (plan §7).
  const findingsById = new Map([['f1', { id: 'f1', classification: 'major_nc' }], ['f2', { id: 'f2', classification: 'minor_nc' }]]);
  const findingIdsByRequirementId = new Map([['r1', ['f1']], ['r3', ['f2']]]);
  const reqsForUnits = [
    { id: 'r1', applicability: 'applicable', unit_ids: ['siteA'], risk_severity: 'high' },
    { id: 'r2', applicability: 'applicable', unit_ids: ['siteA'], risk_severity: 'low' },
    { id: 'r3', applicability: 'applicable', unit_ids: ['siteB', 'siteA'], risk_severity: 'high' },
    { id: 'r4', applicability: 'not_applicable', unit_ids: ['siteA'], risk_severity: 'critical' },
  ];
  const ru = calc.computeRequirementMetrics(reqsForUnits, findingsById, findingIdsByRequirementId);
  eq(ru.findings_by_unit, { siteA: 2, siteB: 1 }, 'findings_by_unit attributes through the requirement\'s own unit_ids (r3 has 2 units, counted in both); the not_applicable r4 never contributes');
  // r1 (high, has finding f1=major_nc) -> high.major_nc; r2 (low, no finding) -> low.no_finding;
  // r3 (high, has finding f2=minor_nc) -> high.minor_nc. r4 excluded (not_applicable).
  eq(ru.risk_distribution, { high: { major_nc: 1, minor_nc: 1 }, low: { no_finding: 1 } }, 'risk_distribution cross-tabs risk_severity against any linked finding\'s classification, or "no_finding"');
})();

// ── computeFindingMetrics ─────────────────────────────────────────────────────────────────────────
(() => {
  eq(calc.computeFindingMetrics([]), { findings_total: 0, findings_open: 0, findings_closed: 0, findings_by_classification: {} }, 'zero findings: everything 0, no NaN');
  const findings = [
    { classification: 'major_nc', status: 'draft' }, { classification: 'major_nc', status: 'closed' },
    { classification: 'minor_nc', status: 'released_for_review' }, { classification: 'observation', status: 'withdrawn' },
  ];
  const fm = calc.computeFindingMetrics(findings);
  eq([fm.findings_total, fm.findings_open, fm.findings_closed], [4, 2, 2], 'findings_open excludes closed+withdrawn; findings_closed is the exact complement');
  eq(fm.findings_by_classification, { major_nc: 2, minor_nc: 1, observation: 1 }, 'findings_by_classification counts every finding regardless of status');
})();

// ── computeActionMetrics: actions_total … shared_actions / overdue_by_unit ─────────────────────────
(() => {
  const z = calc.computeActionMetrics([], [], new Map(), new Map(), '2026-06-01T00:00:00.000Z');
  eq([z.actions_total, z.actions_open, z.actions_overdue, z.avg_action_progress, z.shared_actions], [0, 0, 0, 0, 0], 'zero actions: everything 0, avg_action_progress never NaN (0/0 guarded)');

  const requirementsById = new Map([
    ['r1', { standard_code: '9001', unit_ids: ['siteA'] }],
    ['r2', { standard_code: '9001', unit_ids: ['siteA'] }],
    ['r3', { standard_code: '14001', unit_ids: ['siteB'] }],
  ]);
  const actions = [
    // a1: two CONFIRMED requirement links, SAME standard (9001) — must NOT count as shared.
    { id: 'a1', status: 'in_progress', due_date: '2020-01-01', owner_uid: 'u-etcher', owner_kind: 'etcher', progress: 10, verification_status: 'not_verified' },
    // a2: confirmed links spanning 9001 AND 14001 — the real "shared across standards" case.
    { id: 'a2', status: 'assigned', due_date: '2020-01-01', owner_uid: 'u-etcher', owner_kind: 'etcher', progress: 40, verification_status: 'not_verified' },
    // a3: closed, with a REJECTED link to r3 — the rejected link must never attribute it to siteB,
    // and a closed action is never "open" nor "overdue" even with a past due_date.
    { id: 'a3', status: 'closed', due_date: '2020-01-01', owner_uid: 'u-client', owner_kind: 'client', progress: 100, verification_status: 'effective' },
    // a4: ready_for_verification — counts toward actions_completed but not actions_verified.
    { id: 'a4', status: 'ready_for_verification', due_date: null, owner_uid: 'u-etcher', owner_kind: 'etcher', progress: 90, verification_status: 'not_verified' },
  ];
  const confirmedLinks = [
    { action_id: 'a1', target_type: 'requirement', target_id: 'r1', link_state: 'confirmed' },
    { action_id: 'a1', target_type: 'requirement', target_id: 'r2', link_state: 'confirmed' },
    { action_id: 'a2', target_type: 'requirement', target_id: 'r1', link_state: 'confirmed' },
    { action_id: 'a2', target_type: 'finding', target_id: 'fA', link_state: 'confirmed' }, // resolves to r3 via the finding map
    { action_id: 'a3', target_type: 'requirement', target_id: 'r3', link_state: 'rejected' }, // excluded — caller must pre-filter
  ].filter(l => l.link_state === 'confirmed');
  const findingIdToRequirementIds = new Map([['fA', ['r3']]]);
  const am = calc.computeActionMetrics(actions, confirmedLinks, findingIdToRequirementIds, requirementsById, '2026-06-01T00:00:00.000Z');

  eq([am.actions_total, am.actions_open, am.actions_closed], [4, 3, 1], 'actions_open/closed partition exactly (status in verified/closed = closed)');
  eq(am.actions_overdue, 2, 'actions_overdue is only OPEN actions with a past due_date (a1, a2) — not the closed a3');
  eq(am.actions_completed, 2, 'actions_completed = status in (ready_for_verification, verified, closed): a3 and a4');
  eq(am.actions_verified, 1, 'actions_verified = verification_status effective: only a3');
  eq(am.actions_by_status, { in_progress: 1, assigned: 1, closed: 1, ready_for_verification: 1 }, 'actions_by_status counts every action once, by its raw status');
  eq(am.actions_by_owner, { etcher: { 'u-etcher': 3 }, client: {} }, 'actions_by_owner is OPEN actions only (a3 excluded, closed), split etcher/client — a3\'s client owner never appears since it is closed');
  eq(am.avg_action_progress, Math.round((10 + 40 + 90) / 3), 'avg_action_progress means the OPEN actions\' progress only (a3 excluded)');
  eq(am.shared_actions, 1, 'shared_actions is exactly 1 (a2, which resolves to both 9001 and 14001) — a1\'s two same-standard targets do not count');
  // a1 (overdue) resolves to {r1,r2} -> unit {siteA} -> siteA +1. a2 (overdue) resolves to
  // {r1 direct, r3 via its CONFIRMED finding link} -> units {siteA, siteB} -> both +1. a3's
  // link to r3 is the REJECTED one (pre-filtered out before this call) and a3 is closed anyway,
  // so neither reason lets it contribute.
  eq(am.overdue_by_unit, { siteA: 2, siteB: 1 }, 'overdue_by_unit: siteA from both a1 and a2; siteB only from a2 (via its confirmed finding link to r3) — a3\'s rejected link to r3 contributes nothing');

  // Edge: an action with confirmed links but to requirements that resolve to NO standard/units at
  // all (a dangling id) must not throw and must not appear anywhere.
  const dangling = calc.computeActionMetrics(
    [{ id: 'a5', status: 'in_progress', due_date: '2020-01-01', owner_uid: 'u', owner_kind: 'etcher', progress: 0, verification_status: 'not_verified' }],
    [{ action_id: 'a5', target_type: 'requirement', target_id: 'ghost', link_state: 'confirmed' }],
    new Map(), new Map(), '2026-06-01T00:00:00.000Z');
  eq([dangling.shared_actions, dangling.overdue_by_unit], [0, {}], 'a link to an id with no resolvable requirement contributes nothing and never throws');
})();

// ── computeEvidenceMetrics ───────────────────────────────────────────────────────────────────────
(() => {
  eq(calc.computeEvidenceMetrics([], [], 0), { evidence_requested: 0, evidence_submitted: 0, evidence_accepted: 0, req_with_accepted_evidence: 0, evidence_partial: 0, evidence_insufficient: 0, evidence_suggested: 0 }, 'zero evidence: everything 0');
  const requests = [{ status: 'open' }, { status: 'closed' }, { status: 'open' }];
  const links = [
    { target_type: 'requirement', target_id: 'r1', review_status: 'submitted' },
    { target_type: 'requirement', target_id: 'r1', review_status: 'accepted' },
    { target_type: 'requirement', target_id: 'r2', review_status: 'accepted' },
    { target_type: 'requirement', target_id: 'r3', review_status: 'under_review' },
    { target_type: 'finding', target_id: 'f1', review_status: 'accepted' }, // not a requirement — excluded from req_with_accepted_evidence
    { target_type: 'requirement', target_id: 'r4', review_status: 'partially_sufficient' },
    { target_type: 'requirement', target_id: 'r5', review_status: 'insufficient' },
    { target_type: 'requirement', target_id: 'r6', review_status: 'rejected' },
  ];
  const em = calc.computeEvidenceMetrics(requests, links, 3);
  eq(em.evidence_requested, 2, 'evidence_requested counts only open requests');
  eq(em.evidence_submitted, 2, 'evidence_submitted = submitted + under_review + more_info_required (submitted ≠ accepted)');
  eq(em.evidence_accepted, 3, 'evidence_accepted counts every accepted LINK, requirement or finding alike');
  eq(em.req_with_accepted_evidence, 2, 'req_with_accepted_evidence counts only distinct REQUIREMENT targets with an accepted link (r1, r2 — not the finding)');
  eq([em.evidence_partial, em.evidence_insufficient, em.evidence_suggested], [1, 1, 3], 'partial/insufficient/suggested pass through as given');
})();

// ── computeAuditMetrics: the full composer, one realistic fixture ──────────────────────────────────
(() => {
  const reqs = [
    { id: 'r1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', unit_ids: ['siteA'], risk_severity: 'low' },
    { id: 'r2', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'not_implemented', unit_ids: ['siteA'], risk_severity: 'high' },
    { id: 'r3', applicability: 'not_applicable', assessment_state: 'not_started', assessment_result: null, unit_ids: [] },
  ];
  const findings = [{ id: 'f1', classification: 'major_nc', status: 'draft' }];
  const findingRequirementLinks = [{ finding_id: 'f1', requirement_id: 'r2' }];
  const actions = [{ id: 'a1', status: 'assigned', due_date: '2020-01-01', owner_uid: 'u1', owner_kind: 'etcher', progress: 0, verification_status: 'not_verified' }];
  const actionLinks = [{ action_id: 'a1', target_type: 'finding', target_id: 'f1', link_state: 'confirmed' }];
  const evidenceRequests = [{ status: 'open' }];
  const evidenceLinks = [{ target_type: 'requirement', target_id: 'r1', review_status: 'accepted' }];
  const m = calc.computeAuditMetrics({ reqs, findings, findingRequirementLinks, actions, actionLinks, evidenceRequests, evidenceLinks, suggestionsCount: 0, nowIso: '2026-06-15T00:00:00.000Z' });
  ok(m.req_total === 3 && m.req_applicable === 2, 'computeAuditMetrics: requirement counts compose correctly');
  ok(m.conformance_pct === 50, `computeAuditMetrics: conformance_pct is 50 (1 of 2 applicable) (got ${m.conformance_pct})`);
  ok(m.findings_total === 1 && m.findings_by_unit.siteA === 1, 'computeAuditMetrics: the finding is attributed to r2\'s unit siteA');
  ok(m.actions_overdue === 1 && m.overdue_by_unit.siteA === 1, 'computeAuditMetrics: the overdue action resolves through its finding link to r2, attributing siteA');
  ok(m.evidence_requested === 1 && m.evidence_accepted === 1 && m.req_with_accepted_evidence === 1, 'computeAuditMetrics: evidence figures compose correctly');
  ok(m.data_as_at === '2026-06-15T00:00:00.000Z', 'computeAuditMetrics: data_as_at is exactly the nowIso it was given, never read from a live clock');
})();

// ── computePortfolioMetrics ──────────────────────────────────────────────────────────────────────
(() => {
  const z = calc.computePortfolioMetrics({ audits: [], perAuditReqs: new Map(), findingsByAuditId: new Map(), actionsByAuditId: new Map(), nowIso: '2026-06-15T00:00:00.000Z' });
  eq([z.audits_active, z.audits_due_soon, z.audits_overdue, z.report_deadlines_upcoming], [0, 0, 0, []], 'zero audits: everything empty, never throws');

  const audits = [
    { id: 'A1', client_id: 'c1', stage: 'fieldwork', report_due: '2026-06-20', owner_uid: 'lead1', standards: ['9001'] }, // due soon
    { id: 'A2', client_id: 'c1', stage: 'fieldwork', report_due: '2026-05-01', owner_uid: 'lead2', standards: ['14001'] }, // overdue
    { id: 'A3', client_id: 'c2', stage: 'planning', report_due: null, owner_uid: 'lead1', standards: ['9001'] },
    { id: 'A4', client_id: 'c2', stage: 'closed', report_due: '2020-01-01', owner_uid: 'lead1', standards: ['9001'] }, // closed — excluded everywhere
  ];
  const perAuditReqs = new Map([
    ['A1', [{ applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', responsible_uid: 'lead1' }]], // 100%
    ['A2', [
      { applicability: 'applicable', assessment_state: 'not_started', assessment_result: null, responsible_uid: 'lead2' },
      { applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', responsible_uid: 'lead2' },
    ]], // 50%
    ['A3', []], // 0 applicable -> 0%
  ]);
  const findingsByAuditId = new Map([['A1', [{ id: 'f1' }]], ['A2', [{ id: 'f2' }, { id: 'f3' }]], ['A3', []]]);
  const actionsByAuditId = new Map([
    ['A1', [{ owner_uid: 'lead1', status: 'in_progress' }, { owner_uid: 'lead1', status: 'closed' }]],
    ['A2', [{ owner_uid: 'lead2', status: 'assigned' }]],
  ]);
  const p = calc.computePortfolioMetrics({ audits, perAuditReqs, findingsByAuditId, actionsByAuditId, nowIso: '2026-06-15T00:00:00.000Z' });

  eq(p.audits_active, 3, 'audits_active excludes the closed audit');
  eq(p.audits_due_soon, 1, 'audits_due_soon: A1 only (within 14 days, not past)');
  eq(p.audits_overdue, 1, 'audits_overdue: A2 only (report_due in the past)');
  eq(p.audits_by_stage, { fieldwork: 2, planning: 1 }, 'audits_by_stage counts only active audits');
  eq(p.report_deadlines_upcoming.map(a => a.id), ['A2', 'A1'], 'report_deadlines_upcoming is active audits with a report_due, sorted earliest first; A3 (no report_due) is excluded');
  eq(p.progress_by_audit, { A1: 100, A2: 50, A3: 0 }, 'progress_by_audit reuses the exact same requirement-level formula as metric.audit, per audit');
  eq(p.progress_by_client, { c1: Math.round((100 + 50) / 2), c2: 0 }, 'progress_by_client means assessment_completion_pct across that client\'s active audits');
  eq(p.findings_by_standard, { '9001': 1, '14001': 2 }, 'findings_by_standard attributes every finding to each of its audit\'s standards');
  // workload_by_auditor: lead1 leads BOTH A1 and A3 (+2) + 1 open action on A1 (+1, A1's closed
  // action excluded) + 0 unassessed requirements (A1's own requirement is fully assessed) = 3.
  // lead2 leads A2 (+1) + 1 open action on A2 (+1) + A2's own unassessed requirement assigned to
  // lead2 (+1) = 3.
  eq(p.workload_by_auditor, { lead1: 3, lead2: 3 }, `workload_by_auditor = audits led + open assigned actions + unassessed requirements assigned (got ${JSON.stringify(p.workload_by_auditor)})`);
})();

// ── computeProgressByGroup (plan 9.2: "progress by site/department/process/owner") ──────────────────
(() => {
  eq(calc.computeProgressByGroup([], r => r.unit_ids), {}, 'zero requirements: an empty group map, never throws');
  const reqs = [
    { id: 'r1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', unit_ids: ['u1'], responsible_uid: 'o1' },
    { id: 'r2', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null, unit_ids: ['u1', 'u2'], responsible_uid: 'o2' },
    { id: 'r3', applicability: 'not_applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', unit_ids: ['u1'], responsible_uid: 'o1' },
  ];
  eq(calc.computeProgressByGroup(reqs, r => r.unit_ids), { u1: { applicable: 2, assessed: 1, pct: 50 }, u2: { applicable: 1, assessed: 0, pct: 0 } }, 'by unit: a not_applicable requirement (r3) never contributes to any unit, even though it is tagged with one');
  eq(calc.computeProgressByGroup(reqs, r => [r.responsible_uid]), { o1: { applicable: 1, assessed: 1, pct: 100 }, o2: { applicable: 1, assessed: 0, pct: 0 } }, 'by owner: the same generic function, one key per requirement instead of several');
  eq(calc.computeProgressByGroup(reqs, r => []), {}, 'a requirement with no group keys at all (an empty array) contributes to nothing, never a null-key bucket');
})();

// ── computeProgressOverTime (plan 9.3: "rebuilt from iso_activity result changes") ───────────────────
(() => {
  eq(calc.computeProgressOverTime([]), [], 'zero activity: an empty series, never throws');
  eq(calc.computeProgressOverTime([{ entity_type: 'requirement', entity_id: 'r1', at: '2026-01-01T00:00:00.000Z', before: { assessment_result: null }, after: { assessment_result: null } }]), [], 'a requirement update that does not actually change the result produces no point');
  eq(calc.computeProgressOverTime([{ entity_type: 'finding', entity_id: 'f1', at: '2026-01-01T00:00:00.000Z', before: { status: 'draft' }, after: { status: 'final' } }]), [], 'a non-requirement activity row (even with a before/after) is ignored entirely');
  const activity = [
    { entity_type: 'requirement', entity_id: 'r1', at: '2026-01-01T01:00:00.000Z', before: { assessment_result: null }, after: { assessment_result: 'implemented_effective' } },
    { entity_type: 'requirement', entity_id: 'r2', at: '2026-01-01T05:00:00.000Z', before: { assessment_result: null }, after: { assessment_result: 'not_implemented' } },
    { entity_type: 'requirement', entity_id: 'r1', at: '2026-01-02T01:00:00.000Z', before: { assessment_result: 'implemented_effective' }, after: { assessment_result: 'not_implemented' } },
  ];
  eq(calc.computeProgressOverTime(activity), [{ day: '2026-01-01', conforming: 1, with_result: 2 }, { day: '2026-01-02', conforming: 0, with_result: 2 }], 'two same-day events both land in one day\'s snapshot; a later day replays forward from the running state, not from scratch');
  // Out-of-order input (as a real activity log could arrive from a list with no explicit sort) must
  // still replay chronologically, not in array order.
  const shuffled = [activity[2], activity[0], activity[1]];
  eq(calc.computeProgressOverTime(shuffled), calc.computeProgressOverTime(activity), 'the function sorts by `at` itself — input order never changes the result');
})();

// ── buildDashboard (9.2, reworked in 9.5: the stage-1 KPI row, D26–D29) ─────────────────────────────
(() => {
  const reqs = [
    { id: 'r1', standard_code: '9001', clause: '6.1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective', unit_ids: [] },
    { id: 'r2', standard_code: '9001', clause: '6.1', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null, unit_ids: [] },
    { id: 'r3', standard_code: '9001', clause: '7.2', applicability: 'applicable', assessment_state: 'needs_follow_up', assessment_result: 'partially_implemented', unit_ids: [] },
    { id: 'r4', standard_code: '9001', clause: '8.1', applicability: 'not_applicable', assessment_state: 'not_started', assessment_result: null, unit_ids: [] },
    { id: 'r5', standard_code: '9001', clause: '9.1', applicability: 'review', assessment_state: 'complete', assessment_result: 'not_implemented', unit_ids: [] },
  ];
  const base = { reqs, findings: [], findingRequirementLinks: [], actions: [], actionLinks: [], evidenceRequests: [], evidenceLinks: [], suggestionsCount: 0, nowIso: '2026-06-01T00:00:00.000Z' };
  const summary = { r1: { accepted: 1, partial: 0, insufficient: 0, toReview: 0, suggested: 0 }, r2: { accepted: 0, partial: 0, insufficient: 0, toReview: 1, suggested: 0 }, r4: { accepted: 0, partial: 0, insufficient: 0, toReview: 0, suggested: 2 } };
  const metrics = calc.computeAuditMetrics({ ...base, evidenceSummary: summary });
  eq([metrics.req_applicable, metrics.req_assessed, metrics.req_follow_up, metrics.req_not_assessed], [4, 2, 1, 1], 'assessed (r1, r5), follow-up (r3: a result while Needs follow-up) and not assessed (r2) — r4 is N/A');
  ok(metrics.req_assessed + metrics.req_follow_up + metrics.req_not_assessed === metrics.req_applicable, 'the three buckets add up to the applicable total exactly');
  eq(metrics.req_gaps, 2, 'gaps: r3 partially implemented + r5 not implemented (a "review" requirement still counts as applicable)');
  eq(metrics.req_not_applicable, 1, 'not applicable: r4');
  eq(metrics.req_evidence_to_review, 2, 'evidence to review counts every requirement with a link awaiting a verdict or a pending suggestion — r2 and the N/A r4, exactly the register view\'s rows; r1 (accepted evidence only) is not counted');
  eq(calc.computeAuditMetrics(base).req_evidence_to_review, null, 'without an evidence summary the figure is null — never a guessed 0');

  const d = calc.buildDashboard(metrics, { openFindingStatuses: ['draft'], openActionStatuses: ['draft'] });
  ok(JSON.stringify(d) === JSON.stringify(JSON.parse(JSON.stringify(d))), 'the whole dashboard payload survives a JSON round trip unchanged');
  eq(d.kpis.map(k => k.key), ['req_applicable', 'req_assessed', 'req_not_assessed', 'req_gaps', 'req_conforming', 'req_evidence_to_review', 'findings_open', 'actions_open', 'actions_overdue'], 'stage 1\'s KPI row, in order — no "not yet available" placeholders');
  ok(d.kpis.every(k => typeof k.formula === 'string' && k.formula.length > 20), 'every KPI carries its formula in words (shown on the page, D28)');
  ok(d.kpis.every(k => k.filter && k.filter.entity && Array.isArray(k.filter.where)), 'every KPI is clickable: each carries a real filter');
  const by = key => d.kpis.find(k => k.key === key);
  eq([by('req_assessed').display, by('req_conforming').display], ['2 of 4', '1 of 4'], 'assessed and conforming read "X of Y" (D28)');
  ok(/50% assessed/.test(by('req_assessed').detail) && /1 with a result need follow-up/.test(by('req_assessed').detail), `assessed's detail gives the percentage and the follow-up count (got ${by('req_assessed').detail})`);
  ok(/25% conforming/.test(by('req_conforming').detail), `conforming's detail gives conformance_pct — unassessed requirements count against it (got ${by('req_conforming').detail})`);
  ok(/5 in total · 1 not applicable/.test(by('req_applicable').detail), `applicable's detail names the total and the N/A count (got ${by('req_applicable').detail})`);
  ok(by('req_assessed').filter.where.some(w => w.field === 'assessment_result' && w.op === 'notnull'), 'the assessed filter also requires a result (the 9.2 tile matched the state only)');
  eq(by('req_gaps').filter.where.find(w => w.field === 'assessment_result').value, calc.GAP_RESULTS, 'gaps use the one shared GAP_RESULTS list');
  eq(by('req_evidence_to_review').view, 'evidence_review', 'the evidence figure opens the register\'s existing "Evidence to review" view');
  ok(d.kpis.filter(k => k.key !== 'req_evidence_to_review').every(k => k.view === null), 'no other KPI asks for a view');
  eq(d.standard, null, 'no standard selected');
  ok(d.charts.baseline_vs_current.data === null, 'a board never imported has no baseline — null, never a fabricated comparison');
  const unassessedSeg = d.charts.req_by_result.segments.find(s => s.key === 'unassessed');
  ok(unassessedSeg.filter.where.some(w => w.field === 'assessment_result' && w.op === 'isnull'), 'the "unassessed" segment uses isnull, never eq with an undefined value (which JSON would silently drop)');

  // D29: a standard adds the matching predicate to every filter, in the form each entity's rows carry.
  const ds = calc.buildDashboard(metrics, { openFindingStatuses: ['draft'], openActionStatuses: ['draft'], standard: '9001' });
  eq(ds.standard, '9001', 'the selected standard is echoed back');
  const reqStd = { field: 'standard_code', op: 'eq', value: '9001' };
  ok(ds.kpis.filter(k => k.filter.entity === 'requirement').every(k => JSON.stringify(k.filter.where[0]) === JSON.stringify(reqStd)), 'every requirement KPI is scoped by standard_code');
  eq(ds.kpis.find(k => k.key === 'findings_open').filter.where[0], reqStd, 'findings are scoped by their (source requirement\'s) standard_code');
  eq(ds.kpis.find(k => k.key === 'actions_open').filter.where[0], { field: 'standard_codes', op: 'contains', value: '9001' }, 'actions are scoped by standard_codes contains');
  ok(['req_by_result', 'req_by_state'].every(c => ds.charts[c].segments.length && ds.charts[c].segments.every(s => s.filter.where[0].value === '9001')), 'chart segments are scoped too');

  // 9.6: clause_matrix and cards are passed straight through extra, with per-cell filters resolved here.
  eq(d.clause_matrix, {}, 'no clauseMatrix given in extra: an empty object, never undefined');
  eq(d.cards, [], 'no cards given in extra: an empty array, never undefined');
  const clauseMatrix = { '9001': { '6': { total: 2, assessed: 1, gaps: 1, evidenceToReview: 0 } } };
  const dm = calc.buildDashboard(metrics, { openFindingStatuses: ['draft'], openActionStatuses: ['draft'], clauseMatrix, standard: '9001' });
  eq(dm.clause_matrix['9001']['6'].filter, { entity: 'requirement', where: [{ field: 'applicability', op: 'in', value: ['applicable', 'review'] }, { field: 'standard_code', op: 'eq', value: '9001' }, { field: 'clause_family', op: 'eq', value: '6' }] }, 'a matrix cell gets a plain eq/in filter — no new op, clause_family carries the grouping');
  eq(dm.clause_matrix['9001']['6'].total, 2, 'the cell\'s own counts pass through unchanged');
  ok(JSON.stringify(dm) === JSON.stringify(JSON.parse(JSON.stringify(dm))), 'the matrix survives a JSON round trip too — no function value');
  // The matrix must stay full-board even while `standard` narrows the KPIs/charts above (D29/9.6): a
  // single-standard dashboard filter must never remove the comparison the matrix exists to show.
  const clauseMatrixBoth = { '9001': { '6': { total: 2, assessed: 1, gaps: 1, evidenceToReview: 0 } }, '14001': { '4': { total: 3, assessed: 0, gaps: 0, evidenceToReview: 0 } } };
  const dmStd = calc.buildDashboard(metrics, { openFindingStatuses: ['draft'], openActionStatuses: ['draft'], clauseMatrix: clauseMatrixBoth, standard: '9001' });
  eq(Object.keys(dmStd.clause_matrix).sort(), ['14001', '9001'], 'both standards still appear in the matrix with "9001" selected above — the op decides matrix scope, buildDashboard never narrows it itself');

  const cards = [calc.buildDashboard(calc.computeAuditMetrics({ ...base, reqs: reqs.filter(r => r.standard_code === '9001'), evidenceSummary: summary }), { openFindingStatuses: ['draft'], openActionStatuses: ['draft'], standard: '9001' })];
  const dc = calc.buildDashboard(metrics, { openFindingStatuses: ['draft'], openActionStatuses: ['draft'], cards });
  eq(dc.cards.length, 1, 'cards pass straight through');
  eq(dc.cards[0].standard, '9001', 'each card is itself a full buildDashboard output, scoped to its own standard');
  eq(dc.cards[0].kpis.find(k => k.key === 'req_applicable').value, 4, 'a card\'s own numbers come from calling buildDashboard on that standard\'s scoped metrics — the same function, not a second one');
  ok(dc.cards[0].cards.length === 0, 'a card never nests further cards inside itself');
})();

// ── computeBaselineVsCurrent (9.4, A87 correction: the workbook import writes the baseline) ──────────
(() => {
  eq(calc.computeBaselineVsCurrent([{ id: 'a', applicability: 'applicable', assessment_result: null, baseline_at: null }]), null, 'never imported: null');
  const rows = [
    { id: 'a', standard_code: '9001', applicability: 'applicable', baseline_at: '2026-01-01T00:00:00Z', baseline_result: 'not_implemented', assessment_result: 'implemented_effective' },
    { id: 'b', standard_code: '9001', applicability: 'applicable', baseline_at: '2026-01-01T00:00:00Z', baseline_result: null, assessment_result: 'partially_implemented' },
    { id: 'c', standard_code: '14001', applicability: 'applicable', baseline_at: '2026-01-02T00:00:00Z', baseline_result: 'implemented_effective', assessment_result: 'implemented_effective' },
    { id: 'd', standard_code: '14001', applicability: 'not_applicable', baseline_at: '2026-01-02T00:00:00Z', baseline_result: 'not_implemented', assessment_result: null },
    { id: 'e', standard_code: '14001', applicability: 'applicable', baseline_at: null, baseline_result: null, assessment_result: 'not_implemented' },
  ];
  const b = calc.computeBaselineVsCurrent(rows);
  eq(b.total, 3, 'only applicable, baselined requirements are compared (d is N/A, e was never baselined)');
  eq(b.baseline, { not_implemented: 1, unassessed: 1, implemented_effective: 1 }, 'baseline side: what the workbook said');
  eq(b.current, { implemented_effective: 2, partially_implemented: 1 }, 'current side: the same three requirements now');
  eq(Object.keys(b.by_standard).sort(), ['14001', '9001'], 'per standard');
  eq([b.by_standard['9001'].total, b.by_standard['14001'].total], [2, 1], 'per-standard totals match on both sides');
  eq(b.baselined_at, '2026-01-02T00:00:00Z', 'the latest import time is reported');
})();

// ── computeEvidenceSummary (the one map behind evidence.summary and the dashboard figure) ────────────
(() => {
  const links = [
    { evidence_id: 'e1', target_type: 'requirement', target_id: 'r1', review_status: 'accepted' },
    { evidence_id: 'e1', target_type: 'requirement', target_id: 'r2', review_status: 'submitted' },
    { evidence_id: 'e2', target_type: 'requirement', target_id: 'r2', review_status: 'more_info_required' },
    { evidence_id: 'e2', target_type: 'requirement', target_id: 'r3', review_status: 'partially_sufficient' },
    { evidence_id: 'e3', target_type: 'requirement', target_id: 'r3', review_status: 'submitted' },
    { evidence_id: 'e1', target_type: 'finding', target_id: 'f1', review_status: 'submitted' },
    { evidence_id: 'e1', target_type: 'requirement', target_id: 'gone', review_status: 'submitted' },
    { evidence_id: 'e1', target_type: 'requirement', target_id: 'r1', review_status: 'rejected' },
  ];
  const evidenceById = { e1: { id: 'e1' }, e2: { id: 'e2' }, e3: { id: 'e3', archived_at: '2026-01-01' } };
  const s = calc.computeEvidenceSummary(links, evidenceById, new Set(['r1', 'r2', 'r3']), [{ targetId: 'r1' }]);
  eq(s.r1, { accepted: 1, partial: 0, insufficient: 0, toReview: 0, suggested: 1 }, 'r1: accepted plus one pending suggestion; a rejected link counts nowhere');
  eq(s.r2, { accepted: 0, partial: 0, insufficient: 0, toReview: 2, suggested: 0 }, 'r2: submitted and more-info-required both await review');
  eq(s.r3, { accepted: 0, partial: 1, insufficient: 0, toReview: 0, suggested: 0 }, 'r3: archived evidence (e3) is skipped');
  ok(!('gone' in s) && !('f1' in s), 'links to a finding, or to a requirement not on the board, are skipped');
  eq([calc.hasEvidenceToReview(s.r1), calc.hasEvidenceToReview(s.r2), calc.hasEvidenceToReview(s.r3), calc.hasEvidenceToReview(undefined)], [true, true, false, false], 'evidence to review = a pending suggestion or a link awaiting a verdict');
})();

// ── scopeInputsToStandard (D29) ──────────────────────────────────────────────────────────────────────
(() => {
  const input = {
    reqs: [{ id: 'q1', standard_code: '9001' }, { id: 'q2', standard_code: '9001' }, { id: 'e1', standard_code: '14001' }],
    findings: [{ id: 'fq' }, { id: 'fe' }],
    findingRequirementLinks: [{ finding_id: 'fq', requirement_id: 'q1' }, { finding_id: 'fe', requirement_id: 'e1' }],
    actions: [{ id: 'aDirect' }, { id: 'aViaFinding' }, { id: 'aBoth' }, { id: 'aRejected' }, { id: 'aOther' }],
    actionLinks: [
      { action_id: 'aDirect', target_type: 'requirement', target_id: 'q2', link_state: 'confirmed' },
      { action_id: 'aViaFinding', target_type: 'finding', target_id: 'fq', link_state: 'confirmed' },
      { action_id: 'aBoth', target_type: 'requirement', target_id: 'q1', link_state: 'confirmed' },
      { action_id: 'aBoth', target_type: 'requirement', target_id: 'e1', link_state: 'confirmed' },
      { action_id: 'aRejected', target_type: 'requirement', target_id: 'q1', link_state: 'rejected' },
      { action_id: 'aOther', target_type: 'finding', target_id: 'fe', link_state: 'confirmed' },
    ],
    evidenceLinks: [{ id: 'l1', target_type: 'requirement', target_id: 'q1' }, { id: 'l2', target_type: 'finding', target_id: 'fe' }, { id: 'l3', target_type: 'action', target_id: 'aDirect' }],
    evidenceRequests: [{ id: 'x1', target_type: 'requirement', target_id: 'e1' }, { id: 'x2', target_type: 'finding', target_id: 'fq' }],
    suggestions: [{ targetId: 'q2' }, { targetId: 'e1' }],
    evidenceSummary: { q1: { toReview: 1 }, e1: { suggested: 1 } },
  };
  const q = calc.scopeInputsToStandard(input, '9001');
  eq(q.reqs.map(r => r.id), ['q1', 'q2'], 'requirements of the standard');
  eq(q.findings.map(f => f.id), ['fq'], 'findings follow their source requirement');
  eq(q.actions.map(a => a.id), ['aDirect', 'aViaFinding', 'aBoth'], 'actions: a direct link, a link through a finding, or one of several standards — a rejected link never counts');
  eq(calc.scopeInputsToStandard(input, '14001').actions.map(a => a.id), ['aBoth', 'aOther'], 'the two-standard action counts under each standard, by design');
  eq(q.evidenceLinks.map(l => l.id), ['l1', 'l3'], 'evidence links follow their target (requirement, finding or action)');
  eq(q.evidenceRequests.map(r => r.id), ['x2'], 'evidence requests follow their target');
  eq([q.suggestions.length, q.suggestionsCount], [1, 1], 'suggestions follow their target requirement');
  eq(Object.keys(q.evidenceSummary), ['q1'], 'the evidence summary is narrowed too');
  ok(calc.scopeInputsToStandard(input, null) === input, 'no standard: the input is returned untouched');
})();

// ── clauseFamilyOf + computeClauseMatrix (9.6) ──────────────────────────────────────────────────────
(() => {
  eq([calc.clauseFamilyOf('6.1.2'), calc.clauseFamilyOf('10'), calc.clauseFamilyOf(''), calc.clauseFamilyOf(null)], ['6', '10', null, null], 'the top-level clause digit only, or null for nothing');
  eq(calc.computeClauseMatrix([], null), {}, 'zero requirements: an empty matrix, never throws');
  const reqs = [
    { id: 'a', standard_code: '9001', clause: '6.1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'implemented_effective' },
    { id: 'b', standard_code: '9001', clause: '6.2', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'not_implemented' },
    { id: 'c', standard_code: '9001', clause: '6.3', applicability: 'applicable', assessment_state: 'not_started', assessment_result: null },
    { id: 'd', standard_code: '9001', clause: '7.1', applicability: 'not_applicable', assessment_state: 'not_started', assessment_result: null },
    { id: 'e', standard_code: '14001', clause: '6.1', applicability: 'applicable', assessment_state: 'complete', assessment_result: 'partially_implemented' },
  ];
  const noSummary = calc.computeClauseMatrix(reqs, null);
  eq(noSummary['9001']['6'], { total: 3, assessed: 2, gaps: 1, evidenceToReview: null }, 'clause 6 of 9001: 3 applicable (d is N/A and excluded despite being clause 7 anyway), 2 assessed, 1 gap (b); no summary given -> evidenceToReview null, never a guessed 0');
  ok(!('7' in noSummary['9001']), 'clause 7 has no applicable rows at all (d is N/A) — no cell, not a zero cell');
  eq(Object.keys(noSummary).sort(), ['14001', '9001'], 'one top-level key per standard present');
  eq(noSummary['14001']['6'], { total: 1, assessed: 1, gaps: 1, evidenceToReview: null }, 'a different standard never mixes into 9001\'s own clause 6');
  const summary = { a: { toReview: 1, suggested: 0 }, c: { toReview: 0, suggested: 1 } };
  const withSummary = calc.computeClauseMatrix(reqs, summary);
  eq(withSummary['9001']['6'].evidenceToReview, 2, 'a and c both have evidence awaiting review (one a link, one a suggestion) — counted when a summary is given');
})();

// ── A thin HTTP integration check: metric.audit/metric.portfolio are faithful wrappers ──────────
// ── 9.7: computeDashboardPanels — Needs attention, findings/actions panels, shared actions ─────────
(() => {
  const OPEN_ACT = ['draft', 'assigned', 'in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required', 'ready_for_verification', 'on_hold'];
  const OPEN_FND = ['draft', 'released_for_review', 'final'];
  const reqs = [
    { id: 'r1', standard_code: '9001', clause: '4.1', clause_name: 'Context', applicability: 'applicable', assessment_result: null, risk_severity: 'high', responsible_uid: null },
    { id: 'r2', standard_code: '9001', clause: '5.1', applicability: 'applicable', assessment_result: 'implemented_effective', senior_review_status: 'pending', responsible_uid: 'u1' },
    { id: 'r3', standard_code: '14001', clause: '6.1', applicability: 'applicable', assessment_result: null, risk_severity: 'low', responsible_uid: 'u2' },
    { id: 'r4', standard_code: '14001', clause: '7.1', applicability: 'not_applicable', assessment_result: null },
    { id: 'r5', standard_code: '9001', clause: '8.1', applicability: 'applicable', assessment_result: 'partially_implemented', senior_review_status: 'compliant', responsible_uid: 'u1' },
  ];
  const findings = [
    { id: 'f1', ref: 'F-1', title: 'Major gap', status: 'released_for_review', classification: 'major_nc' },
    { id: 'f2', ref: 'F-2', title: 'Closed one', status: 'closed', classification: 'minor_nc' },
    { id: 'f3', ref: 'F-3', title: 'Draft one', status: 'draft', classification: 'minor_nc' },
  ];
  const findingRequirementLinks = [{ finding_id: 'f1', requirement_id: 'r1' }, { finding_id: 'f2', requirement_id: 'r3' }, { finding_id: 'f3', requirement_id: 'r1' }];
  const actions = [
    { id: 'a1', ref: 'A-1', title: 'Overdue shared', status: 'in_progress', due_date: '2026-01-01', owner_uid: null },
    { id: 'a2', ref: 'A-2', title: 'Due soon', status: 'assigned', due_date: '2026-03-15', owner_uid: 'u1' },
    { id: 'a3', ref: 'A-3', title: 'Closed late', status: 'closed', due_date: '2026-01-01', owner_uid: 'u1' },
    { id: 'a4', ref: 'A-4', title: 'Ready, shared via finding', status: 'ready_for_verification', due_date: null, owner_uid: null },
  ];
  const actionLinks = [
    { action_id: 'a1', target_type: 'requirement', target_id: 'r1', link_state: 'confirmed' },
    { action_id: 'a1', target_type: 'requirement', target_id: 'r3', link_state: 'confirmed' },
    { action_id: 'a2', target_type: 'finding', target_id: 'f1', link_state: 'confirmed' },
    { action_id: 'a3', target_type: 'requirement', target_id: 'r1', link_state: 'rejected' },
    { action_id: 'a3', target_type: 'requirement', target_id: 'r3', link_state: 'confirmed' },
    { action_id: 'a4', target_type: 'requirement', target_id: 'r2', link_state: 'confirmed' },
    { action_id: 'a4', target_type: 'finding', target_id: 'f2', link_state: 'confirmed' },
  ];
  const input = { reqs, findings, findingRequirementLinks, actions, actionLinks, evidenceRequests: [], evidenceLinks: [], suggestions: [], suggestionsCount: 0, evidenceSummary: { r3: { toReview: 1 } }, nowIso: '2026-03-10T02:00:00.000Z' };
  const activity = [{ at: '2026-03-10T01:00:00Z', action: 'evidence_downloaded', entity_type: 'evidence', entity_id: 'e1' }, { at: '2026-03-09T01:00:00Z', action: 'updated', entity_type: 'requirement', entity_id: 'r1', entity_ref: '9001 4.1', actor_uid: 'offline:u1' }];
  const opts = { today: '2026-03-10', openActionStatuses: OPEN_ACT, openFindingStatuses: OPEN_FND, activity, excludeActivity: ['evidence_downloaded'] };
  const p = calc.computeDashboardPanels(input, input, opts);
  eq(p.attention.map(c => c.key + ':' + c.count), ['overdue_actions:1', 'senior_review:2', 'evidence_to_review:1', 'high_risk_unassessed:1', 'findings_in_review:1', 'actions_no_owner:2', 'requirements_no_owner:1'],
    'Needs attention: every category with something in it, most urgent first, each with its exact count');
  eq(p.attention.find(c => c.key === 'senior_review').items.map(i => i.id), ['r2', 'r4'], 'Awaiting senior review = assessed (a result, or N/A) and still pending — r5 already has a verdict');
  eq(p.attention.find(c => c.key === 'evidence_to_review').view, 'evidence_review', 'Evidence to review opens the register\'s own "Evidence to review" view, like its KPI tile');
  eq(p.attention.find(c => c.key === 'overdue_actions').filter, { entity: 'action', where: [{ field: 'status', op: 'in', value: OPEN_ACT }, { field: 'due_date', op: 'lt', value: '$today' }] }, 'Overdue actions carries the same filter as the Overdue KPI (open, due before $today)');
  eq(p.attention.find(c => c.key === 'requirements_no_owner').items.map(i => i.id), ['r1'], '"Not assessed and no owner" counts only unassessed applicable rows with no owner (r3 has one, r4 is N/A)');
  eq(p.findings_panel.map(t => t.key + ':' + t.value), ['open:2', 'major_open:1', 'minor_open:1', 'closed:1'], 'Findings panel: open, major/minor open, closed');
  eq(p.actions_panel.map(t => t.key + ':' + t.value), ['open:3', 'overdue:1', 'due_soon:1', 'unassigned:2', 'completed:2'], 'Actions panel: open, overdue, due in 14 days, unassigned, completed (ready + closed)');
  eq(p.actions_panel.find(t => t.key === 'due_soon').filter.where.slice(1), [{ field: 'due_date', op: 'gt', value: '$today-1' }, { field: 'due_date', op: 'lte', value: '$today+14' }], '"Due in 14 days" is gt $today-1 (no gte op) and lte $today+14');
  eq(p.shared_actions.total, 2, 'shared actions: a1 (two direct links) and a4 (one direct, one via a finding) — a3\'s 9001 link was rejected, so it is not shared');
  eq(p.shared_actions.rows.map(r => r.id), ['a1', 'a4'], 'overdue shared actions are listed first');
  eq(p.shared_actions.rows[1].requirements.map(r => r.standard_code + ' ' + r.clause), ['9001 5.1', '14001 6.1'], 'a shared action lists every clause it covers (Q, E, S order), resolved through findings too');
  eq(p.shared_actions.filter, { entity: 'action', where: [{ field: 'is_shared', op: 'eq', value: true }] }, 'View all opens is_shared = true');
  eq(p.recent_activity.map(a => a.action), ['updated'], 'recent activity leaves out reads (downloads)');
  // Scoped to one standard: the panel filters carry the scope; shared actions still see both standards.
  const scoped = calc.computeDashboardPanels(calc.scopeInputsToStandard(input, '14001'), input, Object.assign({}, opts, { standard: '14001' }));
  eq(scoped.shared_actions.total, 2, 'with 14001 selected, both shared actions still show (each reaches 14001) — resolved against the whole board');
  eq(scoped.shared_actions.filter.where[0], { field: 'standard_codes', op: 'contains', value: '14001' }, 'and View all carries the standard scope first');
  eq(scoped.attention.map(c => c.key), ['overdue_actions', 'senior_review', 'evidence_to_review', 'actions_no_owner'], 'with 14001 selected, only 14001\'s rows feed Needs attention');
  // Empty board.
  const empty = calc.computeDashboardPanels({ reqs: [], findings: [], findingRequirementLinks: [], actions: [], actionLinks: [], nowIso: '2026-03-10T00:00:00Z' }, null, { today: '2026-03-10' });
  eq([empty.attention.length, empty.shared_actions.total, empty.findings_panel.every(t => t.value === 0), empty.actions_panel.every(t => t.value === 0)], [0, 0, true, true], 'an empty board: nothing needs attention, every panel figure is 0');
  eq([calc.seniorReviewAwaiting({ assessment_result: 'not_implemented' }), calc.seniorReviewAwaiting({ applicability: 'not_applicable' }), calc.seniorReviewAwaiting({ assessment_result: null }), calc.seniorReviewAwaiting({ assessment_result: 'x', senior_review_status: 'redo' })], [true, true, false, false], 'seniorReviewAwaiting: a result or N/A, and still pending');
  // "today" in the board's timezone: due 2026-03-10 is overdue on Perth's 11 March even while UTC says 10 March.
  const tzInput = { reqs: [], findings: [], findingRequirementLinks: [], actions: [{ id: 'x', status: 'assigned', due_date: '2026-03-10' }], actionLinks: [], evidenceRequests: [], evidenceLinks: [], suggestions: [], suggestionsCount: 0, nowIso: '2026-03-10T20:00:00Z' };
  eq([calc.computeAuditMetrics(tzInput).actions_overdue, calc.computeAuditMetrics(Object.assign({}, tzInput, { today: '2026-03-11' })).actions_overdue], [0, 1], 'actions_overdue uses input.today (the board\'s timezone) when given — the same day the filters\' $today resolves to');
})();

(async () => {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const ROOT = path.join(__dirname, '..');
  const PORT = 3144;
  function waitForServer(port, tries = 50) {
    return new Promise((resolve, reject) => {
      const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
      const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
      attempt(tries);
    });
  }
  async function callIso(user, body) {
    const headers = { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) };
    const r = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, body: json };
  }
  const ADMIN = { id: 'u1', role: 'admin' };
  const data = res => res.body && res.body.data;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-calc-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir;
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: 'calc board' }));
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const [r9001, r9001b] = reqs.filter(r => r.standard_code === '9001');
    const [r14001] = reqs.filter(r => r.standard_code === '14001');
    // D35/R2: compliance_status derives assessment_state/assessment_result server-side now.
    await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: r9001.id, patch: { compliance_status: 'compliant' }, expectedVersion: r9001.row_version });
    await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: r9001b.id, patch: { compliance_status: 'non_compliant' }, expectedVersion: r9001b.row_version });
    const finding = data(await callIso(ADMIN, { op: 'finding.create', auditId: board.id, requirementId: r9001b.id, classification: 'major_nc', title: 'A gap' }));
    const action = data(await callIso(ADMIN, { op: 'action.create', auditId: board.id, targetType: 'finding', targetId: finding.id, title: 'Fix it', dueDate: '2020-01-01' }));
    await callIso(ADMIN, { op: 'action.link', auditId: board.id, actionId: action.id, targetType: 'requirement', targetId: r14001.id });

    const serverMetric = data(await callIso(ADMIN, { op: 'metric.audit', auditId: board.id }));
    // Rebuild the same answer independently, straight from the offline store's own rows, bypassing
    // the op entirely — if these ever disagree, metric.audit has drifted from the pure dictionary.
    const rawReqs = (await db.list('iso_requirements', {})).filter(r => r.audit_id === board.id && !r.archived_at);
    const rawFindings = (await db.list('iso_findings', {})).filter(f => f.audit_id === board.id && !f.archived_at);
    const rawFRLinks = await db.list('iso_finding_requirements', {});
    const rawActions = (await db.list('iso_actions', {})).filter(a => a.audit_id === board.id && !a.archived_at);
    const rawActionLinks = (await db.list('iso_action_links', {})).filter(l => rawActions.some(a => a.id === l.action_id));
    const rawEvReq = (await db.list('iso_evidence_requests', {})).filter(r => r.audit_id === board.id);
    const rawEvLinks = (await db.list('iso_evidence_links', {})).filter(l => l.audit_id === board.id);
    const rawEvidence = (await db.list('iso_evidence', {})).filter(e => e.audit_id === board.id);
    // No evidence exists on this board, so there can be no derived suggestions either — the summary is
    // rebuilt with an empty suggestion list (asserted, not assumed).
    ok(rawEvidence.length === 0 && rawEvLinks.length === 0, 'setup: the parity board has no evidence, so its evidence summary needs no derived suggestions');
    const rawSummary = calc.computeEvidenceSummary(rawEvLinks, Object.fromEntries(rawEvidence.map(e => [e.id, e])), new Set(rawReqs.map(r => r.id)), []);
    const rebuilt = calc.computeAuditMetrics({ reqs: rawReqs, findings: rawFindings, findingRequirementLinks: rawFRLinks.filter(l => rawFindings.some(f => f.id === l.finding_id)), actions: rawActions, actionLinks: rawActionLinks, evidenceRequests: rawEvReq, evidenceLinks: rawEvLinks, suggestionsCount: 0, evidenceSummary: rawSummary, nowIso: serverMetric.data_as_at });
    const { data_as_at: _a, ...serverRest } = serverMetric;
    const { data_as_at: _b, ...rebuiltRest } = rebuilt;
    eq(serverRest, rebuiltRest, 'metric.audit over HTTP equals computeAuditMetrics run directly on the same raw rows — a real action linked across 2 standards makes shared_actions 1');
    ok(serverMetric.shared_actions === 1, `and that cross-standard action (confirmed-linked via its finding to a 9001 requirement, and directly to a 14001 requirement) really is counted shared (got ${serverMetric.shared_actions})`);
    ok(serverMetric.req_conforming === 1 && serverMetric.req_applicable > serverMetric.req_conforming, `conformance_pct's denominator is the WHOLE board's applicable set, not just the 2 requirements touched here (got ${serverMetric.req_conforming} of ${serverMetric.req_applicable})`);

    const serverPortfolio = data(await callIso(ADMIN, { op: 'metric.portfolio' }));
    ok(typeof serverPortfolio.progress_by_audit === 'object' && board.id in serverPortfolio.progress_by_audit, 'metric.portfolio reports progress_by_audit for the real board just created');
    ok(serverPortfolio.workload_by_auditor && serverPortfolio.workload_by_auditor['offline:u1'] >= 1, 'metric.portfolio\'s workload_by_auditor counts the admin as leading the audit it owns');
  } catch (e) {
    console.error('CRASHED', e);
    fail.push('the HTTP integration section crashed: ' + e.message);
  } finally {
    proc.kill();
  }
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
