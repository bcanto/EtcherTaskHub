// Plan §7 "Calculation dictionary" (Phase 9.1). One pure module for every number shown in
// dashboards, graphs, exports and report snapshots — no DB access, no `ctx`, no clock: every function
// takes plain arrays of already-fetched rows (api/_iso.js's metric.audit/metric.portfolio do the
// fetching) plus `nowIso` where "overdue" needs today's date, so the whole dictionary is directly
// unit-testable with hand-built fixtures (.agents/iso-calc-test.cjs) and the server can never compute
// a different answer than the test expects for the same inputs. Rounding: percentages to whole
// numbers, half up (Math.round), from exact integer counts — never chained through an
// already-rounded intermediate. A 0/0 division is always 0, never NaN/Infinity.
//
// Scope note: `computeAuditMetrics`/`computePortfolioMetrics` return one flat object per
// audit/portfolio, exactly the shape metric.audit/metric.portfolio have always returned (so the
// Reports tab, the one pre-9.2 consumer, keeps working unchanged). Phase 9.2 adds `buildDashboard`
// (below), which wraps the relevant fields of that same flat object into the plan's own
// `{key, label, value, filter}` descriptors, so the dashboard can turn a number into a link to the
// matching filtered view without ever inventing a second definition of what the number means.
//
// `baseline_vs_current` reads `iso_requirements.baseline_*`, which the workbook import writes on a
// requirement's first import (api/_isoImport.js) — so the baseline is the workbook's original
// assessment, and a board never imported has none (A87's first note said nothing wrote them; wrong).
// `responses_awaiting_review` is not built: the plan's §7 table assigns it to Phase 13.
//
// Not applicable is an applicability decision only (D30): requirement.update refuses the result
// value 'not_applicable', so every formula here excludes N/A through `applicability` alone and the
// dashboard's filters (which have no OR) can reproduce each count exactly.

const FINDING_CLOSED_STATUSES = ['closed', 'withdrawn'];
const ACTION_CLOSED_STATUSES = ['verified', 'closed'];
const ACTION_COMPLETED_STATUSES = ['ready_for_verification', 'verified', 'closed'];
const APPLICABLE_VALUES = ['applicable', 'review'];
// The Requirements register's own "Gaps identified" view uses exactly this list; one definition here.
const GAP_RESULTS = ['not_implemented', 'no_evidence_provided', 'partially_implemented', 'implemented_ineffective'];

function pct(numerator, denominator) { return denominator ? Math.round(100 * numerator / denominator) : 0; }
function bump(map, key) { if (key != null) map[key] = (map[key] || 0) + 1; return map; }
function unitsOf(req) { return (req && req.unit_ids) || []; }
// Top-level clause digit only (e.g. '6' from '6.1.2') — one definition, shared by req_by_result_by_clause
// and the 9.6 clause matrix, so the two can never group a requirement under different families.
function clauseFamilyOf(clause) { const d = String(clause || '').split('.')[0]; return d || null; }

// ── Requirements: req_total … risk_distribution ─────────────────────────────────────────────────
// findingIdsByRequirementId: Map<requirementId, findingId[]> — the caller resolves
// iso_finding_requirements once (a finding is linked to its originating requirement at creation and
// never re-linked afterward — confirmed by grep of every write site) and passes the join already
// made, so this function stays pure over plain data, never touching the DB layer itself.
function computeRequirementMetrics(reqs, findingsById, findingIdsByRequirementId) {
  const req_total = reqs.length;
  // req_applicable excludes only 'not_applicable' — 'review' still counts as applicable (plan §7:
  // "req_total − result/applicability not_applicable"; 'review' is a staff-side triage state, not
  // a conformity verdict, so it stays in every denominator below until someone resolves it).
  const applicable = reqs.filter(r => APPLICABLE_VALUES.includes(r.applicability));
  const req_applicable = applicable.length;

  // req_assessed / assessment_completion_pct need a RECORDED RESULT, not just assessment_state
  // 'complete' — the server never requires the two together (requirement.update's
  // validateRequirementPatch only blocks a result OUTSIDE complete/needs_follow_up; it never
  // requires one INSIDE complete), so a requirement can sit at state 'complete' with no result yet.
  // Counting that as "assessed" would overstate completion for exactly those rows.
  const assessedReqs = applicable.filter(r => r.assessment_state === 'complete' && r.assessment_result != null);
  const req_assessed = assessedReqs.length;
  const assessment_completion_pct = pct(req_assessed, req_applicable);

  const conformingReqs = applicable.filter(r => r.assessment_result === 'implemented_effective');
  const req_conforming = conformingReqs.length;
  // conformance_pct's denominator is req_applicable, NOT req_assessed (plan §7's own note:
  // "Unassessed stay in the denominator → never counted as conforming. Matches the export's Overall
  // conformance.") — a requirement nobody has assessed yet is not conforming; it must not be
  // dropped from the count just because no verdict has been recorded.
  const conformance_pct = pct(req_conforming, req_applicable);
  // Assessed, follow-up and not assessed partition the applicable set: requirement.update only accepts
  // a result while the state is complete or needs_follow_up, so a result with follow-up needed is its
  // own bucket rather than silently missing from both of the other two.
  const req_follow_up = applicable.filter(r => r.assessment_state === 'needs_follow_up' && r.assessment_result != null).length;
  const req_not_assessed = applicable.filter(r => r.assessment_result == null).length;
  const req_gaps = applicable.filter(r => GAP_RESULTS.includes(r.assessment_result)).length;
  const req_not_applicable = req_total - req_applicable;

  const req_by_result = applicable.reduce((m, r) => bump(m, r.assessment_result || 'unassessed'), {});
  const req_by_state = applicable.reduce((m, r) => bump(m, r.assessment_state), {});
  // "Results by standard" / "results by clause" (plan 9.2/9.3) — the same req_by_result grouping,
  // cross-tabbed. Top-level clause only (e.g. '6' from '6.1.2'), matching the register's own
  // section grouping, not every sub-clause (which would be too fine-grained for a chart).
  const req_by_result_by_standard = {}, req_by_result_by_clause = {};
  for (const r of applicable) {
    const result = r.assessment_result || 'unassessed';
    if (r.standard_code) { req_by_result_by_standard[r.standard_code] = req_by_result_by_standard[r.standard_code] || {}; bump(req_by_result_by_standard[r.standard_code], result); }
    const topClause = clauseFamilyOf(r.clause);
    if (topClause) { req_by_result_by_clause[topClause] = req_by_result_by_clause[topClause] || {}; bump(req_by_result_by_clause[topClause], result); }
  }

  // findings_by_unit / risk_distribution: findings and actions "have no unit of their own" (plan
  // §7) — attribution is only ever through the requirement(s) they are raised against.
  const findings_by_unit = {};
  const risk_distribution = {};
  for (const r of applicable) {
    const fIds = findingIdsByRequirementId.get(r.id) || [];
    const units = unitsOf(r);
    if (fIds.length) for (const u of units) findings_by_unit[u] = (findings_by_unit[u] || 0) + fIds.length;
    if (!r.risk_severity) continue;
    const classes = fIds.length ? [...new Set(fIds.map(id => findingsById.get(id)).filter(Boolean).map(f => f.classification))] : ['no_finding'];
    risk_distribution[r.risk_severity] = risk_distribution[r.risk_severity] || {};
    for (const c of classes) bump(risk_distribution[r.risk_severity], c);
  }

  return { req_total, req_applicable, req_not_applicable, req_assessed, assessment_completion_pct, req_follow_up, req_not_assessed, req_gaps, req_conforming, conformance_pct, req_by_result, req_by_state, req_by_result_by_standard, req_by_result_by_clause, findings_by_unit, risk_distribution };
}

// ── Baseline vs current (plan §7) ────────────────────────────────────────────────────────────────
// The baseline is what the workbook said when it was first imported (api/_isoImport.js writes
// baseline_result/baseline_state/baseline_at once per requirement). Compared over the SAME applicable,
// baselined requirements on both sides, so the two distributions always have the same total. null when
// nothing on the board was ever imported — there is no baseline to compare, and the UI says so.
function computeBaselineVsCurrent(reqs) {
  const baselined = reqs.filter(r => APPLICABLE_VALUES.includes(r.applicability) && r.baseline_at);
  if (!baselined.length) return null;
  const side = rows => ({
    baseline: rows.reduce((m, r) => bump(m, r.baseline_result || 'unassessed'), {}),
    current: rows.reduce((m, r) => bump(m, r.assessment_result || 'unassessed'), {}),
    total: rows.length,
  });
  const by_standard = {};
  for (const code of [...new Set(baselined.map(r => r.standard_code).filter(Boolean))].sort()) by_standard[code] = side(baselined.filter(r => r.standard_code === code));
  const latest = baselined.reduce((m, r) => (String(r.baseline_at) > m ? String(r.baseline_at) : m), '');
  return { ...side(baselined), by_standard, baselined_at: latest };
}

// ── Findings: findings_total … findings_by_classification ──────────────────────────────────────
function computeFindingMetrics(findings) {
  const findings_total = findings.length;
  const findings_open = findings.filter(f => !FINDING_CLOSED_STATUSES.includes(f.status)).length;
  const findings_closed = findings_total - findings_open;
  // Field name kept as `findings_by_classification` (matches the column name; iso-security-test.cjs
  // already pins this exact key) — the plan's own prose calls the same thing `findings_by_class`.
  const findings_by_classification = findings.reduce((m, f) => bump(m, f.classification), {});
  return { findings_total, findings_open, findings_closed, findings_by_classification };
}

// Every requirement id an action ultimately targets: its own confirmed requirement links, plus —
// via each confirmed finding link — that finding's originating requirement(s). Shared by
// shared_actions (distinct STANDARDS, not distinct target rows) and overdue_by_unit (distinct
// UNITS) so the two metrics can never disagree about what an action is "really" linked to.
function resolveActionRequirementIds(actionId, confirmedLinksByActionId, findingIdToRequirementIds) {
  const out = new Set();
  for (const l of (confirmedLinksByActionId.get(actionId) || [])) {
    if (l.target_type === 'requirement') out.add(l.target_id);
    else if (l.target_type === 'finding') for (const rid of (findingIdToRequirementIds.get(l.target_id) || [])) out.add(rid);
  }
  return out;
}

// ── Actions: actions_total … shared_actions ─────────────────────────────────────────────────────
// confirmedActionLinks: iso_action_links rows already filtered to link_state === 'confirmed' — a
// rejected link (action.unlink) must never keep counting an action as "linked" to what it no longer
// targets; neither op has ever inserted a 'suggested' row (both action.create and action.link
// insert 'confirmed' directly — confirmed by reading both call sites), so this filter only ever
// removes genuinely-unlinked rows, never a real, live link.
// requirementsById: Map<id, {standard_code, unit_ids}> for every requirement an action might
// resolve to (its own direct targets' requirements, plus every linked finding's requirement(s)).
function computeActionMetrics(actions, confirmedActionLinks, findingIdToRequirementIds, requirementsById, nowIso) {
  const today = nowIso.slice(0, 10);
  const actions_total = actions.length;
  const openActions = actions.filter(a => !ACTION_CLOSED_STATUSES.includes(a.status));
  const actions_open = openActions.length;
  const actions_closed = actions_total - actions_open;
  const overdueActions = openActions.filter(a => a.due_date && a.due_date < today);
  const actions_overdue = overdueActions.length;
  const actions_completed = actions.filter(a => ACTION_COMPLETED_STATUSES.includes(a.status)).length;
  const actions_verified = actions.filter(a => a.verification_status === 'effective').length;
  const actions_by_status = actions.reduce((m, a) => bump(m, a.status), {});
  const avg_action_progress = openActions.length ? Math.round(openActions.reduce((s, a) => s + (a.progress || 0), 0) / openActions.length) : 0;

  // actions_by_owner: OPEN actions per owner, split by owner_kind (plan §7: "open actions per
  // owner (etcher/client split)") — the pre-9.1 version counted every action regardless of status
  // and never split by kind, so an action a client had already closed out still inflated an
  // Etcher auditor's apparent workload, and a client's own actions were mixed into the same bucket.
  const actions_by_owner = { etcher: {}, client: {} };
  for (const a of openActions) if (a.owner_uid) bump(actions_by_owner[a.owner_kind === 'client' ? 'client' : 'etcher'], a.owner_uid);

  const confirmedLinksByActionId = new Map();
  for (const l of confirmedActionLinks) { if (!confirmedLinksByActionId.has(l.action_id)) confirmedLinksByActionId.set(l.action_id, []); confirmedLinksByActionId.get(l.action_id).push(l); }

  // shared_actions: confirmed links to requirements of >=2 DISTINCT STANDARDS (plan §7) — not
  // merely >=2 distinct target rows. The pre-9.1 version counted an action linked to two
  // requirements of the SAME standard as "shared" (wrong — nothing is shared across standards),
  // and counted a rejected (unlinked) target as if it were still live (it never filtered by
  // link_state at all).
  let shared_actions = 0;
  // overdue_by_unit: each OVERDUE action is attributed, once per distinct unit, to every unit any
  // of its resolved requirements belongs to (plan §7: "counted once per unit").
  const overdue_by_unit = {};
  const overdueIds = new Set(overdueActions.map(a => a.id));
  for (const a of actions) {
    const reqIds = resolveActionRequirementIds(a.id, confirmedLinksByActionId, findingIdToRequirementIds);
    if (!reqIds.size) continue;
    const standards = new Set(), units = new Set();
    for (const rid of reqIds) {
      const r = requirementsById.get(rid);
      if (!r) continue;
      if (r.standard_code) standards.add(r.standard_code);
      for (const u of unitsOf(r)) units.add(u);
    }
    if (standards.size >= 2) shared_actions++;
    if (overdueIds.has(a.id)) for (const u of units) overdue_by_unit[u] = (overdue_by_unit[u] || 0) + 1;
  }

  // actions_open_vs_closed (plan 9.3's own chart map): the same open/closed split as a named pair,
  // for a 2-segment chart rather than two separate KPI tiles.
  const actions_open_vs_closed = { open: actions_open, closed: actions_closed };
  // upcoming_deadlines (plan 9.2): the next few OPEN, not-yet-overdue actions, nearest due date
  // first — the audit-level equivalent of the portfolio's report_deadlines_upcoming.
  const upcoming_deadlines = openActions.filter(a => a.due_date && a.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 10).map(a => ({ id: a.id, ref: a.ref, title: a.title, due_date: a.due_date }));

  return { actions_total, actions_open, actions_closed, actions_overdue, actions_completed, actions_verified, actions_by_status, actions_open_vs_closed, actions_by_owner, avg_action_progress, shared_actions, overdue_by_unit, upcoming_deadlines };
}

// ── Evidence: evidence_requested … evidence_suggested (unchanged since 8.1/8b.5 — kept here only
// for a single source of truth; already matches plan §7: "submitted ≠ accepted") ──────────────────
const EVIDENCE_TO_REVIEW_STATUSES = ['submitted', 'under_review', 'more_info_required'];
function computeEvidenceMetrics(evidenceRequests, evidenceLinks, suggestionsCount) {
  const evidence_requested = evidenceRequests.filter(r => r.status === 'open').length;
  const evidence_submitted = evidenceLinks.filter(l => EVIDENCE_TO_REVIEW_STATUSES.includes(l.review_status)).length;
  const evidence_accepted = evidenceLinks.filter(l => l.review_status === 'accepted').length;
  const req_with_accepted_evidence = new Set(evidenceLinks.filter(l => l.target_type === 'requirement' && l.review_status === 'accepted').map(l => l.target_id)).size;
  const evidence_partial = evidenceLinks.filter(l => l.review_status === 'partially_sufficient').length;
  const evidence_insufficient = evidenceLinks.filter(l => l.review_status === 'insufficient').length;
  return { evidence_requested, evidence_submitted, evidence_accepted, req_with_accepted_evidence, evidence_partial, evidence_insufficient, evidence_suggested: suggestionsCount };
}

// Per requirement: its evidence links by verdict, plus pending suggestions (D21 — derived, never
// stored). The register's Evidence column, its "Evidence to review" view (evidence.summary) and the
// dashboard's evidence figure all read this one map, so they cannot disagree.
// evidenceById: {id: evidence row}; requirementIds: Set of this board's requirement ids;
// suggestions: [{targetId, …}].
function computeEvidenceSummary(links, evidenceById, requirementIds, suggestions) {
  const out = {};
  const add = (id, k) => { (out[id] = out[id] || { accepted: 0, partial: 0, insufficient: 0, toReview: 0, suggested: 0 })[k]++; };
  for (const l of links) {
    if (l.target_type !== 'requirement' || !requirementIds.has(l.target_id)) continue;
    const e = evidenceById[l.evidence_id];
    if (!e || e.archived_at) continue;
    if (l.review_status === 'accepted') add(l.target_id, 'accepted');
    else if (l.review_status === 'partially_sufficient') add(l.target_id, 'partial');
    else if (l.review_status === 'insufficient') add(l.target_id, 'insufficient');
    else if (EVIDENCE_TO_REVIEW_STATUSES.includes(l.review_status)) add(l.target_id, 'toReview');
  }
  for (const s of suggestions) add(s.targetId, 'suggested');
  return out;
}
function hasEvidenceToReview(summaryRow) { return !!(summaryRow && (summaryRow.toReview || summaryRow.suggested)); }

// ── Standard scope (D29) ───────────────────────────────────────────────────────────────────────────
// Narrows computeAuditMetrics' input to one standard. Requirements: that standard. Findings: their
// source requirement is in scope. Actions: at least one CONFIRMED link reaches an in-scope requirement,
// directly or through a linked finding — so an action spanning two standards counts under each, by
// design. Evidence links/requests: their target (requirement, finding or action) is in scope.
// Suggestions and the evidence summary: their target requirement is in scope.
function scopeInputsToStandard(input, standard) {
  if (!standard) return input;
  const reqs = input.reqs.filter(r => r.standard_code === standard);
  const reqIds = new Set(reqs.map(r => r.id));
  const findingIdToRequirementIds = new Map();
  for (const l of input.findingRequirementLinks) {
    if (!findingIdToRequirementIds.has(l.finding_id)) findingIdToRequirementIds.set(l.finding_id, []);
    findingIdToRequirementIds.get(l.finding_id).push(l.requirement_id);
  }
  const findingRequirementLinks = input.findingRequirementLinks.filter(l => reqIds.has(l.requirement_id));
  const findingIds = new Set(findingRequirementLinks.map(l => l.finding_id));
  const findings = input.findings.filter(f => findingIds.has(f.id));
  const confirmedByAction = new Map();
  for (const l of input.actionLinks) {
    if (l.link_state !== 'confirmed') continue;
    if (!confirmedByAction.has(l.action_id)) confirmedByAction.set(l.action_id, []);
    confirmedByAction.get(l.action_id).push(l);
  }
  const actions = input.actions.filter(a => [...resolveActionRequirementIds(a.id, confirmedByAction, findingIdToRequirementIds)].some(id => reqIds.has(id)));
  const actionIds = new Set(actions.map(a => a.id));
  const inScope = (type, id) => (type === 'requirement' ? reqIds : type === 'finding' ? findingIds : type === 'action' ? actionIds : new Set()).has(id);
  const suggestions = (input.suggestions || []).filter(s => reqIds.has(s.targetId));
  const out = {
    ...input, reqs, findings, findingRequirementLinks, actions,
    actionLinks: input.actionLinks.filter(l => actionIds.has(l.action_id)),
    evidenceLinks: input.evidenceLinks.filter(l => inScope(l.target_type, l.target_id)),
    evidenceRequests: input.evidenceRequests.filter(r => inScope(r.target_type, r.target_id)),
    suggestions, suggestionsCount: suggestions.length,
  };
  if (input.evidenceSummary) out.evidenceSummary = Object.fromEntries(Object.entries(input.evidenceSummary).filter(([id]) => reqIds.has(id)));
  return out;
}

// ── Progress by group (plan 9.2: "progress by site/department/process/owner") ──────────────────────
// groupKeysFn(req) returns the array of group keys a requirement belongs to (unit_ids for
// site/department/process — iso_audit_units carries its own `kind`, this function doesn't care
// which — or a single-element array [responsible_uid] for "by owner"). One generic function so the
// two dashboard cuts can never disagree about what "progress" means per group.
function computeProgressByGroup(reqs, groupKeysFn) {
  const applicable = reqs.filter(r => APPLICABLE_VALUES.includes(r.applicability));
  const byGroup = new Map();
  for (const r of applicable) {
    for (const key of groupKeysFn(r) || []) {
      if (key == null) continue;
      if (!byGroup.has(key)) byGroup.set(key, { applicable: 0, assessed: 0 });
      const g = byGroup.get(key);
      g.applicable++;
      if (r.assessment_state === 'complete' && r.assessment_result != null) g.assessed++;
    }
  }
  const out = {};
  for (const [key, g] of byGroup) out[key] = { applicable: g.applicable, assessed: g.assessed, pct: pct(g.assessed, g.applicable) };
  return out;
}

// ── Progress over time (plan 9.3: "rebuilt from iso_activity result changes") ───────────────────────
// activityRows: every iso_activity row for the audit (entity_type/action/before/after as both
// adapters actually write them — a plain requirement.update's own activity entry carries no
// `field`, so this reads the full before/after row snapshot and compares assessment_result itself,
// rather than relying on a field column that generic updates never set). Replays events in
// chronological order and snapshots the running conforming-count at the END of each day that saw a
// change — a COUNT over time, not a percentage (the applicable denominator can itself change over
// time, e.g. an applicability edit, which this intentionally does not attempt to reconstruct).
function computeProgressOverTime(activityRows) {
  const events = activityRows
    .filter(a => a.entity_type === 'requirement' && a.before && a.after && a.before.assessment_result !== a.after.assessment_result)
    .map(a => ({ at: a.at, requirementId: a.entity_id, to: a.after.assessment_result || null }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const current = new Map();
  const byDay = new Map();
  for (const e of events) {
    current.set(e.requirementId, e.to);
    const day = String(e.at).slice(0, 10);
    const conforming = [...current.values()].filter(r => r === 'implemented_effective').length;
    const withResult = [...current.values()].filter(r => r != null).length;
    byDay.set(day, { conforming, with_result: withResult }); // last event of a day wins that day's snapshot
  }
  return [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day));
}

// ── Standard × clause matrix (plan §9.3/9.6) ────────────────────────────────────────────────────────
// Always every board standard × clause family, independent of any single-standard dashboard filter —
// the matrix's own job is the side-by-side comparison a single-standard view would remove. Only
// applicable requirements count (same rule as every other requirement metric). evidenceSummary is
// optional (computeEvidenceSummary's map); without it evidenceToReview is left out of every cell,
// never guessed as 0.
function computeClauseMatrix(reqs, evidenceSummary) {
  const cells = {};
  for (const r of reqs) {
    if (!APPLICABLE_VALUES.includes(r.applicability)) continue;
    const std = r.standard_code, fam = clauseFamilyOf(r.clause);
    if (!std || !fam) continue;
    cells[std] = cells[std] || {};
    const c = cells[std][fam] = cells[std][fam] || { total: 0, assessed: 0, gaps: 0, evidenceToReview: evidenceSummary ? 0 : null };
    c.total++;
    if (r.assessment_state === 'complete' && r.assessment_result != null) c.assessed++;
    if (GAP_RESULTS.includes(r.assessment_result)) c.gaps++;
    if (evidenceSummary && hasEvidenceToReview(evidenceSummary[r.id])) c.evidenceToReview++;
  }
  return cells;
}

// ── Dashboard descriptors (Phase 9.2) ───────────────────────────────────────────────────────────────
// Wraps the relevant fields of an already-computed `metrics` object (computeAuditMetrics's own
// output) into the plan's own `{key, label, value, filter}` shape, so a dashboard number is never a
// second, separately-maintained definition of what it counts — it is the exact same field, with a
// filter that reproduces exactly the rows that went into it. `filter.entity` names which `<entity>.list
// {filter}` op the UI should call (`requirement`, `finding` or `action` — the three ops that support
// the shared filter schema); `where` uses only the ops api/_isoFilter.js actually implements (no
// negation — ACTION_OPEN_STATUSES/FINDING_OPEN_STATUSES are the caller's own positive enumeration of
// "not closed", passed in rather than hard-coded here so this module needs no api/_iso.js import).
// extra: { openActionStatuses, openFindingStatuses, progressByUnit, progressByOwner, progressOverTime,
//          units: [{id, kind, name}] } — the three cross-tabs computeAuditMetrics doesn't itself
// compute (they need iso_audit_units/iso_activity, which most metric.audit callers never need —
// kept out of the cheaper, far more frequently called metric.audit for exactly that reason).
// extra.standard (D29): when set, `metrics` was computed from scopeInputsToStandard's narrowed input,
// and every filter below gains the matching standard predicate — requirement and finding rows carry
// `standard_code` (a finding's is its source requirement's, attached by finding.list), action rows
// carry `standard_codes` (every standard their confirmed links reach, attached by action.list).
// A filter builder that prepends the standard scope (D29) — buildDashboard and the 9.7 panels share
// it, so a panel figure and a tile for the same rows can never be scoped differently.
function scopedFilterFor(std) {
  const scopeWhere = entity => (!std ? [] : entity === 'action' ? [{ field: 'standard_codes', op: 'contains', value: std }] : [{ field: 'standard_code', op: 'eq', value: std }]);
  return (entity, where) => ({ entity, where: [...scopeWhere(entity), ...where] });
}

function buildDashboard(metrics, extra) {
  const e = extra || {};
  const std = e.standard || null;
  const filterFor = scopedFilterFor(std);
  const APPLICABLE_WHERE = { field: 'applicability', op: 'in', value: APPLICABLE_VALUES };
  // `value` is always the number of rows `filter` returns; `display` is how the tile writes it. `group`
  // keeps assessment progress and follow-up work visibly apart (never one combined figure, D28).
  const kpi = (key, label, value, filter, formula, opts) => ({ key, label, value, display: (opts && opts.display) || String(value), detail: (opts && opts.detail) || null, formula, filter, view: (opts && opts.view) || null, group: key.startsWith('req_') && key !== 'req_evidence_to_review' ? 'assessment' : 'follow_up' });
  const kpis = [
    kpi('req_applicable', 'Applicable requirements', metrics.req_applicable, filterFor('requirement', [APPLICABLE_WHERE]),
      'Requirements whose applicability is not "Not applicable".',
      { detail: `${metrics.req_total} in total · ${metrics.req_not_applicable} not applicable` }),
    kpi('req_assessed', 'Assessed', metrics.req_assessed, filterFor('requirement', [APPLICABLE_WHERE, { field: 'assessment_state', op: 'eq', value: 'complete' }, { field: 'assessment_result', op: 'notnull' }]),
      'Applicable requirements whose assessment is Complete with a result recorded. Percentage = assessed ÷ applicable. A requirement with a result whose state is Needs follow-up is counted separately, not as assessed.',
      { display: `${metrics.req_assessed} of ${metrics.req_applicable}`, detail: `${metrics.assessment_completion_pct}% assessed` + (metrics.req_follow_up ? ` · ${metrics.req_follow_up} with a result need follow-up` : '') }),
    kpi('req_not_assessed', 'Not assessed', metrics.req_not_assessed, filterFor('requirement', [APPLICABLE_WHERE, { field: 'assessment_result', op: 'isnull' }]),
      'Applicable requirements with no result recorded yet, whatever their assessment state.'),
    kpi('req_gaps', 'Gaps identified', metrics.req_gaps, filterFor('requirement', [APPLICABLE_WHERE, { field: 'assessment_result', op: 'in', value: GAP_RESULTS }]),
      'Applicable requirements whose result is Not implemented, No evidence provided, Partially implemented or Implemented (ineffective).'),
    kpi('req_conforming', 'Conforming', metrics.req_conforming, filterFor('requirement', [APPLICABLE_WHERE, { field: 'assessment_result', op: 'eq', value: 'implemented_effective' }]),
      'Applicable requirements whose result is Implemented (effective). Percentage = conforming ÷ applicable, so requirements not yet assessed count against it — the same formula as the export\'s "Overall conformance".',
      { display: `${metrics.req_conforming} of ${metrics.req_applicable}`, detail: `${metrics.conformance_pct}% conforming` }),
    kpi('req_evidence_to_review', 'Evidence to review', metrics.req_evidence_to_review, filterFor('requirement', []),
      'Requirements with a pending evidence suggestion, or with linked evidence waiting for a reviewer\'s verdict (submitted, under review or more information required). Opens the register\'s "Evidence to review" view.',
      { view: 'evidence_review', detail: 'requirements with evidence awaiting review' }),
    kpi('findings_open', 'Open findings', metrics.findings_open, filterFor('finding', [{ field: 'status', op: 'in', value: e.openFindingStatuses || [] }]),
      'Findings that are not Closed or Withdrawn.'),
    kpi('actions_open', 'Open actions', metrics.actions_open, filterFor('action', [{ field: 'status', op: 'in', value: e.openActionStatuses || [] }]),
      'Actions that are not Verified or Closed. An action linked to two standards counts under each when a standard is selected.'),
    kpi('actions_overdue', 'Overdue actions', metrics.actions_overdue, filterFor('action', [{ field: 'status', op: 'in', value: e.openActionStatuses || [] }, { field: 'due_date', op: 'lt', value: '$today' }]),
      'Open actions whose due date is before today (Perth time).'),
  ];

  // One-dimensional breakdowns get a real per-segment filter, computed here (server-side) into a
  // plain, JSON-serializable array — never a function, which a fetch() response could never carry
  // across to the browser. `segmentsFor` turns a {key: count} map into [{key, value, filter}].
  const segmentsFor = (data, entity, whereForKey) => Object.entries(data || {}).map(([key, value]) => ({ key, value, filter: filterFor(entity, whereForKey(key)) }));
  const charts = {
    req_by_result: { segments: segmentsFor(metrics.req_by_result, 'requirement', k => [APPLICABLE_WHERE, k === 'unassessed' ? { field: 'assessment_result', op: 'isnull' } : { field: 'assessment_result', op: 'eq', value: k }]) },
    req_by_state: { segments: segmentsFor(metrics.req_by_state, 'requirement', k => [APPLICABLE_WHERE, { field: 'assessment_state', op: 'eq', value: k }]) },
    findings_by_classification: { segments: segmentsFor(metrics.findings_by_classification, 'finding', k => [{ field: 'classification', op: 'eq', value: k }]) },
    actions_by_status: { segments: segmentsFor(metrics.actions_by_status, 'action', k => [{ field: 'status', op: 'eq', value: k }]) },
    actions_open_vs_closed: { data: metrics.actions_open_vs_closed },
    evidence_status: { data: { accepted: metrics.evidence_accepted, to_review: metrics.evidence_submitted, partial: metrics.evidence_partial, insufficient: metrics.evidence_insufficient, suggested: metrics.evidence_suggested } },
    // 2D cross-tabs (plain data, text values shown, no per-cell drill-down in this first pass —
    // named here rather than silently promised: see A88).
    req_by_result_by_standard: { data: metrics.req_by_result_by_standard },
    req_by_result_by_clause: { data: metrics.req_by_result_by_clause },
    actions_by_owner: { data: metrics.actions_by_owner },
    overdue_by_unit: { data: metrics.overdue_by_unit },
    findings_by_unit: { data: metrics.findings_by_unit },
    risk_distribution: { data: metrics.risk_distribution },
    progress_by_unit: { data: e.progressByUnit || {}, units: e.units || [] },
    progress_by_owner: { data: e.progressByOwner || {} },
    progress_over_time: { data: e.progressOverTime || [] },
    baseline_vs_current: { data: metrics.baseline_vs_current },
  };

  // The clause matrix (9.6) always covers every board standard, independent of `std` — a single-
  // standard dashboard filter narrows the KPIs/charts above, never the matrix's own side-by-side
  // comparison. Each cell's filter is plain `eq`/`in` (no new op needed: requirement.list attaches a
  // derived `clause_family` to every row, same pattern as finding.list's `standard_code`).
  const clause_matrix = {};
  for (const [code, fams] of Object.entries(e.clauseMatrix || {})) {
    clause_matrix[code] = {};
    for (const [fam, c] of Object.entries(fams)) {
      clause_matrix[code][fam] = { ...c, filter: { entity: 'requirement', where: [APPLICABLE_WHERE, { field: 'standard_code', op: 'eq', value: code }, { field: 'clause_family', op: 'eq', value: fam }] } };
    }
  }

  // `cards` (9.6): one pre-built dashboard per board standard, always — the op builds them by calling
  // this same function per standard; passed straight through here so the top-level response carries
  // both the (optionally standard-scoped) overview and the always-every-standard card set together.
  return { standard: std, kpis, charts, clause_matrix, cards: e.cards || [], upcoming_deadlines: metrics.upcoming_deadlines, data_as_at: metrics.data_as_at, last_update_at: e.lastUpdateAt || null };
}

// ── 9.7: dashboard stage 3 — Needs attention, findings/actions panels, shared actions, activity ──
// The same rule as every figure above: each count carries the filter that returns exactly its rows
// (iso-dashboard-test opens each one and compares). `input` is the (optionally standard-scoped)
// input the KPIs use; `fullInput` the whole board's — an action is "shared" because it reaches two
// standards, which a single-standard input cannot see. opts: { standard, today, openActionStatuses,
// openFindingStatuses, activity (newest first), excludeActivity }.
const DUE_SOON_DAYS = 14;
function addDaysIso(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// D32: assessed (a result, or N/A) and not yet given a senior verdict or sent back. requirement.list
// attaches it as `sr_awaiting` so "Awaiting senior review" is a plain eq filter.
function seniorReviewAwaiting(r) { return (r.senior_review_status || 'pending') === 'pending' && (r.assessment_result != null || r.applicability === 'not_applicable'); }
function computeDashboardPanels(input, fullInput, opts) {
  const o = opts || {}, std = o.standard || null;
  const filterFor = scopedFilterFor(std);
  const today = o.today || input.nowIso.slice(0, 10), soon = addDaysIso(today, DUE_SOON_DAYS);
  const APPL = { field: 'applicability', op: 'in', value: APPLICABLE_VALUES };
  const OPEN_ACT = { field: 'status', op: 'in', value: o.openActionStatuses || [] };
  const OPEN_FND = { field: 'status', op: 'in', value: o.openFindingStatuses || [] };
  const byDue = (a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
  const reqItem = r => ({ entity: 'requirement', id: r.id, standard_code: r.standard_code, label: r.clause + (r.clause_name ? ' ' + r.clause_name : ''), sub: String(r.requirement_text || '').slice(0, 120) });
  const actItem = a => ({ entity: 'action', id: a.id, label: (a.ref ? a.ref + ' — ' : '') + (a.title || ''), due_date: a.due_date || null });
  const fndItem = f => ({ entity: 'finding', id: f.id, label: (f.ref ? f.ref + ' — ' : '') + (f.title || ''), classification: f.classification || null });
  const applicable = input.reqs.filter(r => APPLICABLE_VALUES.includes(r.applicability));
  const openActions = input.actions.filter(a => !ACTION_CLOSED_STATUSES.includes(a.status));
  const openFindings = input.findings.filter(f => !FINDING_CLOSED_STATUSES.includes(f.status));
  const overdue = openActions.filter(a => a.due_date && a.due_date < today).sort(byDue);
  // == null, exactly the filter's isnull (an empty string is not null there either).
  const unowned = openActions.filter(a => a.owner_uid == null);
  // Needs attention: most urgent first, only categories with something in them, three records each.
  const category = (key, label, rows, filter, toItem, view) => ({ key, label, count: rows.length, filter, view: view || null, items: rows.slice(0, 3).map(toItem) });
  const attention = [
    category('overdue_actions', 'Overdue actions', overdue, filterFor('action', [OPEN_ACT, { field: 'due_date', op: 'lt', value: '$today' }]), actItem),
    category('senior_review', 'Awaiting senior review', input.reqs.filter(seniorReviewAwaiting), filterFor('requirement', [{ field: 'sr_awaiting', op: 'eq', value: true }]), reqItem),
    // Opens the register's "Evidence to review" view, exactly like the KPI tile of the same name.
    category('evidence_to_review', 'Evidence to review', input.evidenceSummary ? input.reqs.filter(r => hasEvidenceToReview(input.evidenceSummary[r.id])) : [], filterFor('requirement', []), reqItem, 'evidence_review'),
    category('high_risk_unassessed', 'High or critical risk, not assessed', applicable.filter(r => ['high', 'critical'].includes(r.risk_severity) && r.assessment_result == null), filterFor('requirement', [APPL, { field: 'risk_severity', op: 'in', value: ['high', 'critical'] }, { field: 'assessment_result', op: 'isnull' }]), reqItem),
    category('findings_in_review', 'Findings out for review', input.findings.filter(f => f.status === 'released_for_review'), filterFor('finding', [{ field: 'status', op: 'eq', value: 'released_for_review' }]), fndItem),
    category('actions_no_owner', 'Open actions without an owner', unowned, filterFor('action', [OPEN_ACT, { field: 'owner_uid', op: 'isnull' }]), actItem),
    category('requirements_no_owner', 'Not assessed and no owner', applicable.filter(r => r.responsible_uid == null && r.assessment_result == null), filterFor('requirement', [APPL, { field: 'responsible_uid', op: 'isnull' }, { field: 'assessment_result', op: 'isnull' }]), reqItem),
  ].filter(c => c.count > 0);

  const tile = (key, label, rows, filter) => ({ key, label, value: rows.length, filter });
  // Findings carry no due date or owner, so their panel has no overdue/unassigned figures (9.7 scope).
  const findings_panel = [
    tile('open', 'Open', openFindings, filterFor('finding', [OPEN_FND])),
    tile('major_open', 'Major NC open', openFindings.filter(f => f.classification === 'major_nc'), filterFor('finding', [OPEN_FND, { field: 'classification', op: 'eq', value: 'major_nc' }])),
    tile('minor_open', 'Minor NC open', openFindings.filter(f => f.classification === 'minor_nc'), filterFor('finding', [OPEN_FND, { field: 'classification', op: 'eq', value: 'minor_nc' }])),
    tile('closed', 'Closed', input.findings.filter(f => FINDING_CLOSED_STATUSES.includes(f.status)), filterFor('finding', [{ field: 'status', op: 'in', value: FINDING_CLOSED_STATUSES }])),
  ];
  // The filter schema has no gte: "due today or later" is gt $today-1 (whole dates, so identical).
  const actions_panel = [
    tile('open', 'Open', openActions, filterFor('action', [OPEN_ACT])),
    tile('overdue', 'Overdue', overdue, filterFor('action', [OPEN_ACT, { field: 'due_date', op: 'lt', value: '$today' }])),
    tile('due_soon', `Due in ${DUE_SOON_DAYS} days`, openActions.filter(a => a.due_date && a.due_date >= today && a.due_date <= soon), filterFor('action', [OPEN_ACT, { field: 'due_date', op: 'gt', value: '$today-1' }, { field: 'due_date', op: 'lte', value: '$today+' + DUE_SOON_DAYS }])),
    tile('unassigned', 'Unassigned', unowned, filterFor('action', [OPEN_ACT, { field: 'owner_uid', op: 'isnull' }])),
    tile('completed', 'Completed', input.actions.filter(a => ACTION_COMPLETED_STATUSES.includes(a.status)), filterFor('action', [{ field: 'status', op: 'in', value: ACTION_COMPLETED_STATUSES }])),
  ];

  // Shared actions, resolved against the whole board; with a standard selected, those reaching it.
  const fi = fullInput || input;
  const reqById = new Map(fi.reqs.map(r => [r.id, r]));
  const reqIdsByFinding = new Map();
  for (const l of fi.findingRequirementLinks) { if (!reqIdsByFinding.has(l.finding_id)) reqIdsByFinding.set(l.finding_id, []); reqIdsByFinding.get(l.finding_id).push(l.requirement_id); }
  const linksByAction = new Map();
  for (const l of fi.actionLinks) { if (l.link_state !== 'confirmed') continue; if (!linksByAction.has(l.action_id)) linksByAction.set(l.action_id, []); linksByAction.get(l.action_id).push(l); }
  const sharedRows = [];
  for (const a of fi.actions) {
    const linked = [...resolveActionRequirementIds(a.id, linksByAction, reqIdsByFinding)].map(id => reqById.get(id)).filter(Boolean);
    const codes = [...new Set(linked.map(r => r.standard_code))].sort();
    if (codes.length < 2 || (std && !codes.includes(std))) continue;
    const isOpen = !ACTION_CLOSED_STATUSES.includes(a.status);
    sharedRows.push({ id: a.id, ref: a.ref || null, title: a.title || '', status: a.status, owner_uid: a.owner_uid || null, due_date: a.due_date || null, progress: a.progress || 0,
      overdue: !!(isOpen && a.due_date && a.due_date < today), standard_codes: codes,
      requirements: linked.sort((x, y) => (x.standard_code + ' ' + x.clause).localeCompare(y.standard_code + ' ' + y.clause, undefined, { numeric: true })).map(r => ({ id: r.id, standard_code: r.standard_code, clause: r.clause })) });
  }
  sharedRows.sort((x, y) => (y.overdue - x.overdue) || byDue(x, y));
  const shared_actions = { total: sharedRows.length, rows: sharedRows.slice(0, 8), filter: filterFor('action', [{ field: 'is_shared', op: 'eq', value: true }]) };

  // Recent activity: what changed, newest first — reads (downloads, prompt copies) left out.
  const exclude = new Set(o.excludeActivity || []);
  const recent_activity = (o.activity || []).filter(a => !exclude.has(a.action)).slice(0, 12)
    .map(a => ({ at: a.at, actor_uid: a.actor_uid || null, actor_kind: a.actor_kind || null, entity_type: a.entity_type, entity_id: a.entity_id, entity_ref: a.entity_ref || null, action: a.action }));

  return { attention, findings_panel, actions_panel, shared_actions, recent_activity, due_soon_days: DUE_SOON_DAYS, today };
}

// ── Top-level per-audit composer ─────────────────────────────────────────────────────────────────
// input: { reqs, findings, findingRequirementLinks (rows {finding_id,requirement_id}), actions,
//          actionLinks (ALL link rows — this function does the confirmed-only filter itself so a
//          caller can never forget it), evidenceRequests, evidenceLinks, suggestionsCount, nowIso,
//          evidenceSummary (optional — computeEvidenceSummary's map; without it the evidence figure is
//          null, never a guessed 0) }.
function computeAuditMetrics(input) {
  const findingsById = new Map(input.findings.map(f => [f.id, f]));
  const findingIdsByRequirementId = new Map();
  const findingIdToRequirementIds = new Map();
  for (const l of input.findingRequirementLinks) {
    if (!findingIdsByRequirementId.has(l.requirement_id)) findingIdsByRequirementId.set(l.requirement_id, []);
    findingIdsByRequirementId.get(l.requirement_id).push(l.finding_id);
    if (!findingIdToRequirementIds.has(l.finding_id)) findingIdToRequirementIds.set(l.finding_id, []);
    findingIdToRequirementIds.get(l.finding_id).push(l.requirement_id);
  }
  const requirementsById = new Map(input.reqs.map(r => [r.id, r]));
  const confirmedActionLinks = input.actionLinks.filter(l => l.link_state === 'confirmed');

  return {
    ...computeRequirementMetrics(input.reqs, findingsById, findingIdsByRequirementId),
    ...computeFindingMetrics(input.findings),
    // input.today (YYYY-MM-DD, the board's timezone) when given — the same day the filters' $today
    // resolves to, so "overdue" here and in the view it opens agree at any hour; else the UTC date.
    ...computeActionMetrics(input.actions, confirmedActionLinks, findingIdToRequirementIds, requirementsById, input.today || input.nowIso),
    ...computeEvidenceMetrics(input.evidenceRequests, input.evidenceLinks, input.suggestionsCount),
    // Every requirement on the board counts here, N/A included — exactly the rows the register's
    // "Evidence to review" view shows, which never looks at applicability.
    req_evidence_to_review: input.evidenceSummary ? input.reqs.filter(r => hasEvidenceToReview(input.evidenceSummary[r.id])).length : null,
    baseline_vs_current: computeBaselineVsCurrent(input.reqs),
    data_as_at: input.nowIso,
  };
}

// ── Portfolio ────────────────────────────────────────────────────────────────────────────────────
// input: { audits (already caller-scoped — metric.portfolio reuses audit.list's own visibility
//          filtering, never re-derives it), perAuditReqs: Map<auditId, requirement[]>,
//          findingsByAuditId: Map<auditId, finding[]>, actionsByAuditId: Map<auditId, action[]>,
//          clientNameById: Map<clientId, name>, nowIso }.
// perAuditReqs only needs to carry `applicability`/`assessment_state`/`assessment_result` — the one
// field this level actually reduces (assessment_completion_pct), reusing computeRequirementMetrics
// so portfolio and audit-level completion can never drift apart from each other.
function computePortfolioMetrics(input) {
  const today = input.nowIso.slice(0, 10);
  const soon = new Date(new Date(input.nowIso).getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const active = input.audits.filter(a => a.stage !== 'closed');

  const audits_due_soon = active.filter(a => a.report_due && a.report_due <= soon && a.report_due >= today).length;
  const audits_overdue = active.filter(a => a.report_due && a.report_due < today).length;
  const audits_by_stage = active.reduce((m, a) => bump(m, a.stage), {});
  const report_deadlines_upcoming = active.filter(a => a.report_due).sort((a, b) => a.report_due.localeCompare(b.report_due));

  const progress_by_audit = {}, progress_by_client = {};
  const clientTotals = new Map();
  for (const a of active) {
    const reqs = (input.perAuditReqs && input.perAuditReqs.get(a.id)) || [];
    const { assessment_completion_pct } = computeRequirementMetrics(reqs, new Map(), new Map());
    progress_by_audit[a.id] = assessment_completion_pct;
    if (!clientTotals.has(a.client_id)) clientTotals.set(a.client_id, []);
    clientTotals.get(a.client_id).push(assessment_completion_pct);
  }
  for (const [clientId, pcts] of clientTotals) progress_by_client[clientId] = pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0;

  const findings_by_standard = {};
  for (const a of active) for (const code of (a.standards || [])) for (const f of ((input.findingsByAuditId && input.findingsByAuditId.get(a.id)) || [])) bump(findings_by_standard, code);

  // workload_by_auditor (plan §7, portfolio level): audits led + open assigned actions +
  // unassessed requirements assigned to that person, summed across every active audit — a richer,
  // portfolio-wide figure, deliberately distinct from the per-audit `actions_by_owner` above.
  const workload_by_auditor = {};
  for (const a of active) {
    if (a.owner_uid) bump(workload_by_auditor, a.owner_uid);
    for (const act of ((input.actionsByAuditId && input.actionsByAuditId.get(a.id)) || [])) {
      if (act.owner_uid && !ACTION_CLOSED_STATUSES.includes(act.status)) bump(workload_by_auditor, act.owner_uid);
    }
    for (const r of ((input.perAuditReqs && input.perAuditReqs.get(a.id)) || [])) {
      if (r.responsible_uid && APPLICABLE_VALUES.includes(r.applicability) && !(r.assessment_state === 'complete' && r.assessment_result != null)) bump(workload_by_auditor, r.responsible_uid);
    }
  }

  return {
    audits_active: active.length, audits_due_soon, audits_overdue, audits_by_stage,
    report_deadlines_upcoming, progress_by_audit, progress_by_client, findings_by_standard, workload_by_auditor,
    data_as_at: input.nowIso,
  };
}

module.exports = {
  computeAuditMetrics, computePortfolioMetrics,
  computeRequirementMetrics, computeFindingMetrics, computeActionMetrics, computeEvidenceMetrics,
  computeProgressByGroup, computeProgressOverTime, buildDashboard, computeBaselineVsCurrent,
  computeEvidenceSummary, hasEvidenceToReview, scopeInputsToStandard, computeClauseMatrix, clauseFamilyOf,
  resolveActionRequirementIds, pct, computeDashboardPanels, seniorReviewAwaiting, scopedFilterFor, addDaysIso, DUE_SOON_DAYS,
  FINDING_CLOSED_STATUSES, ACTION_CLOSED_STATUSES, ACTION_COMPLETED_STATUSES, APPLICABLE_VALUES, GAP_RESULTS, EVIDENCE_TO_REVIEW_STATUSES,
};
