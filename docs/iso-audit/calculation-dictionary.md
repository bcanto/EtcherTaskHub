# ISO Audit — Calculation Dictionary

**Source of truth:** `api/_isoCalc.js` (pure CommonJS, no DB, no clock). This document describes what
that module computes; if the two ever disagree, the code is right and this file is stale — fix the
file, not the behaviour. Written per the plan's own §7 "Phase ownership": *"Sonnet writes
`docs/iso-audit/calculation-dictionary.md` from this table."*

Consumers: `metric.audit`, `metric.portfolio` and `dashboard.audit` (`api/_iso.js`) are thin wrappers —
they fetch the raw rows for one audit (or every audit the caller may see, for portfolio) and hand them
to `api/_isoCalc.js`'s pure functions unchanged. UI consumers: the Reports tab, and the board's
Dashboard tab (9.2, reworked in 9.5), whose every figure is one of the fields below plus a filter that
returns exactly the rows it counted (see "Dashboard figures" at the end).

**Rounding:** every percentage is rounded to a whole number, half up (`Math.round`), computed from
exact integer counts — never chained through an already-rounded intermediate value. A 0/0 division is
always `0`, never `NaN`/`Infinity`. **`data_as_at`**: the server time the computation ran
(`ctx.now.toISOString()`, passed in — the calc module itself never reads a live clock, so
`iso-calc-test.cjs` can pin it). **Archived records** (`archived_at` not null) are excluded from every
metric below — the op layer filters them out before the rows ever reach `_isoCalc.js`.

## Requirements (`computeRequirementMetrics`)

| Metric | Formula | Notes |
|---|---|---|
| `req_total` | every requirement on the audit | |
| `req_applicable` | `req_total` − `applicability = 'not_applicable'` | `'review'` still counts as applicable — it is a staff triage state, not a conformity verdict |
| `req_assessed` | applicable, `assessment_state = 'complete'` **and** `assessment_result` not null | Both are required: `requirement.update`'s own validation never forces a result to exist together with `'complete'`, so a row can reach that state with no result yet — such a row is not "assessed" |
| `assessment_completion_pct` | `req_assessed / req_applicable` | |
| `req_follow_up` | applicable, `assessment_state = 'needs_follow_up'` **and** a result recorded | Its own bucket: a verdict exists but follow-up is needed, so it is neither assessed nor "not assessed" |
| `req_not_assessed` | applicable, no `assessment_result` (any state) | `req_assessed + req_follow_up + req_not_assessed = req_applicable` exactly, because `requirement.update` only accepts a result while the state is `complete` or `needs_follow_up` |
| `req_gaps` | applicable, result in `GAP_RESULTS` = (`not_implemented`, `no_evidence_provided`, `partially_implemented`, `implemented_ineffective`) | The same list the register's "Gaps identified" view uses — one definition, `GAP_RESULTS` |
| `req_not_applicable` | `req_total − req_applicable` | |
| `req_conforming` | applicable, `assessment_result = 'implemented_effective'` | |
| `conformance_pct` | `req_conforming / req_applicable` | **Not** `/ req_assessed`. An unassessed requirement stays in the denominator and is never counted as conforming — matches the Reports tab's "Overall conformance" intent |
| `req_by_result` | applicable, counted per `assessment_result`, with no result grouped under `'unassessed'` | |
| `req_by_state` | applicable, counted per `assessment_state` | |
| `findings_by_unit` | for every applicable requirement with ≥1 linked finding, +1 to each of the requirement's own `unit_ids`, once per finding | Findings have no unit of their own — attribution is only ever through the requirement they are raised against |
| `risk_distribution` | applicable requirements with a `risk_severity`, cross-tabbed against the classification of any finding raised against them (or `'no_finding'` if none) | The audit-level "heat map"; distinct from the Phase 12 register's own 5×5 likelihood×consequence map |

**`baseline_vs_current`** (`computeBaselineVsCurrent`, 9.4): over the applicable requirements that have a
baseline, `{baseline: {result: n}, current: {result: n}, total, by_standard, baselined_at}` — both sides
over the *same* requirements, so the totals always match. The baseline is the workbook's original
assessment: the import writes `baseline_result` / `baseline_state` / `baseline_at` on a requirement's
first import (`api/_isoImport.js`; this file first said nothing wrote them — wrong, corrected
2026-10-03). `null` when nothing on the board was ever imported; the dashboard says so in words.

**Not applicable (D30):** N/A is an applicability decision only. `requirement.update` refuses
`assessment_result = 'not_applicable'` and the result pickers no longer offer it, so every formula here
excludes N/A through `applicability` alone — and the dashboard's filters, which have no OR, reproduce
each count exactly. (Plan §7's "result/applicability not_applicable" described two ways of saying the
same thing; there is now one.)

## Findings (`computeFindingMetrics`)

| Metric | Formula | Notes |
|---|---|---|
| `findings_total` | every finding on the audit | |
| `findings_open` | `status` not in (`closed`, `withdrawn`) | |
| `findings_closed` | `findings_total − findings_open` | |
| `findings_by_classification` | counted per `classification`, every status included | Named `findings_by_class` in the plan's prose; kept as `findings_by_classification` here because `iso-security-test.cjs` already pins that exact key and the data is identical either way |

## Actions (`computeActionMetrics`)

An action's **resolved requirements** (used by `shared_actions` and `overdue_by_unit`) are every
requirement it reaches through a **confirmed** `iso_action_links` row — directly (`target_type =
'requirement'`), or via a linked finding's own originating requirement(s) (`target_type = 'finding'`,
resolved through `iso_finding_requirements`, which a finding is linked into once at creation and never
re-linked afterward). A `rejected` link (after `action.unlink`) is excluded — it must never keep
attributing an action to a target it no longer targets. Neither `action.create` nor `action.link` has
ever inserted a `'suggested'` row (both insert `'confirmed'` directly), so this filter only ever removes
genuinely-unlinked rows, never a live one.

| Metric | Formula | Notes |
|---|---|---|
| `actions_total` | every action on the audit | |
| `actions_open` | `status` not in (`verified`, `closed`) | |
| `actions_closed` | `actions_total − actions_open` | |
| `actions_overdue` | open, `due_date` in the past | |
| `actions_completed` | `status` in (`ready_for_verification`, `verified`, `closed`) | "Completed" ≠ "verified" — a closed action without ever being verified still counts here |
| `actions_verified` | `verification_status = 'effective'` | |
| `actions_by_status` | counted per `status` | |
| `actions_by_owner` | **open** actions per owner, split `{etcher: {uid: n}, client: {uid: n}}` by `owner_kind` | A closed action, or a client's own action, must not inflate an Etcher auditor's apparent workload (or vice versa) |
| `avg_action_progress` | mean `progress` of open actions | |
| `shared_actions` | actions whose resolved requirements span **≥2 distinct standards** | Not merely ≥2 distinct target rows — two requirements of the *same* standard are not "shared across standards" |
| `overdue_by_unit` | for every **overdue** action, +1 to each distinct unit among its resolved requirements' `unit_ids`, once per unit | Actions have no unit of their own |

## Evidence (`computeEvidenceMetrics`, unchanged since 8.1/8b.5 — restated here for one source of truth)

| Metric | Formula | Notes |
|---|---|---|
| `evidence_requested` | `iso_evidence_requests` with `status = 'open'` | |
| `evidence_submitted` | links with `review_status` in (`submitted`, `under_review`, `more_info_required`) | Submitted ≠ accepted |
| `evidence_accepted` | links with `review_status = 'accepted'` | Any target type |
| `req_with_accepted_evidence` | distinct **requirement** targets with ≥1 accepted link | Requirement targets only — a finding/action's accepted link doesn't count here |
| `evidence_partial` / `evidence_insufficient` | links with `review_status` = `partially_sufficient` / `insufficient` | |
| `evidence_suggested` | pending D21 suggestions (derived, never stored) | |
| `req_evidence_to_review` | requirements (N/A included) whose evidence summary has a link awaiting a verdict (`submitted`, `under_review`, `more_info_required`) or a pending suggestion | Exactly the rows of the register's "Evidence to review" view: both read `computeEvidenceSummary`, which is also what `evidence.summary` returns. `null` (never a guessed 0) when a caller passes no summary |

## Portfolio (`computePortfolioMetrics`)

Scope: `audits` is whatever `audit.list` already returned for this caller — a client sees only their
own `client_portal_enabled` boards, staff whatever `canOpenAudit` lets them open. Portfolio metrics
reuse that list as-is rather than re-deriving visibility, so they can never disagree with the board
list about who sees what. "Active" = `stage ≠ 'closed'`; every metric below only considers active
audits.

| Metric | Formula | Notes |
|---|---|---|
| `audits_active` | active audits | |
| `audits_due_soon` | `report_due` within 14 days, not already past | |
| `audits_overdue` | `report_due` in the past | |
| `audits_by_stage` | counted per `stage` | |
| `report_deadlines_upcoming` | active audits with a `report_due`, sorted earliest first | |
| `progress_by_audit` | `assessment_completion_pct` per audit | Reuses `computeRequirementMetrics` directly — portfolio and per-audit completion can never drift apart |
| `progress_by_client` | mean of that client's audits' `progress_by_audit` | |
| `findings_by_standard` | every finding attributed to each of its audit's standards | An audit with 2 standards attributes each of its findings to both |
| `workload_by_auditor` | audits led (`owner_uid`) + open actions assigned to them (across all their active audits) + unassessed-but-applicable requirements assigned to them (`responsible_uid`) | Deliberately richer than, and distinct from, the per-audit `actions_by_owner` above |

**Not built — named, not faked:** `responses_awaiting_review` (client responses with status
`submitted`/`under_review`) — the plan's own §7 table already says *"added in Phase 13"*; client
responses don't exist before that phase.

## Dashboard figures (`buildDashboard`, 9.5 stage 1 — D26–D29)

Per board, so per client (D26); staff-only (`dashboard.audit` refuses client callers). Each figure's
`value` is a field above and its `filter` returns exactly that many rows from `requirement.list` /
`finding.list` / `action.list` (`iso-dashboard-test.cjs` round-trips every one).

| Figure | Field | Opens |
|---|---|---|
| Applicable requirements | `req_applicable` (detail: total, N/A) | Requirements: applicability applicable or review |
| Assessed — "X of Y" | `req_assessed` of `req_applicable`, `assessment_completion_pct`, and `req_follow_up` named | Requirements: applicable, state complete, a result recorded |
| Not assessed | `req_not_assessed` | Requirements: applicable, no result |
| Gaps identified | `req_gaps` | Requirements: applicable, result in `GAP_RESULTS` |
| Conforming — "X of Y" (D28) | `req_conforming` of `req_applicable`, `conformance_pct` | Requirements: applicable, result implemented (effective) |
| Evidence to review | `req_evidence_to_review` | Requirements, on its existing "Evidence to review" view |
| Open findings | `findings_open` | Findings: status not closed/withdrawn |
| Open actions | `actions_open` | Actions: status not verified/closed |
| Overdue actions | `actions_overdue` | Actions: open, due date before today (Perth) |

**Standard filter (D29, `scopeInputsToStandard`).** Requirements: that standard. Findings: their source
requirement is in scope (`finding.list` attaches `standard_code`). Actions: at least one confirmed link
reaches an in-scope requirement, directly or through a linked live finding — an action spanning two
standards counts under each, by design (`action.list` attaches `standard_codes`; filtered with the
`contains` op). Evidence links and requests: their target is in scope. Suggestions and the evidence
summary: their target requirement is in scope. "Last update" in the header stays the board's: its
newest activity, excluding reads (`evidence_downloaded`, `prompt_copied`, `prompt_downloaded`).

**Assessment results summary (9.6).** The same `req_by_result` segments as the `req_by_result` chart
below, promoted into their own prominent section with full, never-truncated labels, sorted into a fixed
display order (best to worst, `unassessed` last) rather than row-insertion order. Not a second
definition — removed from the Charts grid once promoted, so the same number is never shown twice.

**Standard cards (9.6, D26).** One per board standard, **always**, independent of the dashboard's own
standard filter above — the filter narrows the KPI row and charts; the cards exist specifically for the
side-by-side comparison a single-standard view would remove. Each card is `buildDashboard` called again
with `computeAuditMetrics(scopeInputsToStandard(input, code))`, so a card's own numbers are provably
identical to selecting that standard in the overview (`iso-dashboard-test.cjs` checks this directly) —
never a second, independently-computed set. A board with only one standard shows no cards (nothing to
compare). Each card groups 9 of its own kpis into four sections: Coverage (`req_applicable`,
`req_assessed`, `req_not_assessed`), Results (`req_conforming`, `req_gaps`, plus the card's own
`req_by_result` segments as a compact strip), Evidence review (`req_evidence_to_review`), Findings &
actions (`findings_open`, `actions_open`, `actions_overdue`) — "action completion" in the plan's own
9.6 wording is shown together with open findings, since the brief's own design groups them on one card
too. Each card's "Open register" opens every requirement of that standard with no applicability
restriction (N/A included) — a different, wider filter than any of the card's own kpis, built for
navigation rather than to match a displayed count. The per-standard "workbook baseline vs now" line
reads the card's own `charts.baseline_vs_current.data` (already scoped, since the card's own metrics
were computed from standard-scoped input) — not a separate calculation.

**Standard × clause matrix (`computeClauseMatrix`, 9.6).** Always every board standard × clause family
4–10, independent of the dashboard's standard filter (same reasoning as the cards). Only applicable
requirements count (`clauseFamilyOf(clause)` — the top-level clause digit, e.g. `6` from `6.1.2`, the
same helper `req_by_result_by_clause` uses, so the two can never group a requirement under different
families). Each cell: `{total, assessed, gaps, evidenceToReview}` (`evidenceToReview` is `null`,
never 0, when no evidence summary was given) plus a server-resolved `filter`
(`{applicability: in [applicable, review], standard_code: eq, clause_family: eq}`) — a plain `eq`/`in`
filter, since `requirement.list` attaches a derived `clause_family` to every row it returns (the filter
schema has no prefix operator, and this way it never needs one). A cell with `total === 0` (that
standard has no rows in that clause family) renders as an honest "—", not a clickable zero.

## Dashboard panels (`computeDashboardPanels`, 9.7 stage 3)

The same rule as every figure above: each count carries the filter that returns exactly its rows.
`input` is the (optionally standard-scoped) input the KPIs use; `fullInput` the whole board's.

**"Today"** is the board's own date in its configured timezone (`timezone` config, Australia/Perth by
default) — `fetchAuditCalcInputs` puts it on the input as `today`, the same day the filters' `$today`
resolves to. `computeActionMetrics` uses it too when given (before 9.7 it used the UTC date, so for
the first eight hours of a Perth day an action due "yesterday" in UTC terms could count as overdue on
the tile but not in the view it opened, or the reverse).

**Needs attention** — categories in this order, only those with at least one row, three records each:

| Key | Rows | Filter |
|---|---|---|
| `overdue_actions` | open actions with `due_date` before today | status in open, `due_date lt $today` |
| `senior_review` | requirements assessed (a result, or N/A) whose senior review is still pending (D32) | `sr_awaiting eq true` — derived on every `requirement.list` row by `seniorReviewAwaiting` |
| `evidence_to_review` | requirements with evidence awaiting a verdict or a pending suggestion | the register's "Evidence to review" view (as the KPI tile) |
| `high_risk_unassessed` | applicable, risk high or critical, no result | applicability in, risk in, result isnull |
| `findings_in_review` | findings released for review | status eq released_for_review |
| `actions_no_owner` | open actions with no owner | status in open, `owner_uid isnull` |
| `requirements_no_owner` | applicable, no result, no owner | applicability in, `responsible_uid isnull`, result isnull |

"No owner" is `== null` — exactly the filter's `isnull` (an empty string is not null there either).

**Findings panel:** open; major NC open; minor NC open; closed. Findings have no due date or owner, so
no overdue/unassigned figures. **Actions panel:** open; overdue; due in 14 days (`due_date` today to
today + 14 — filter `gt $today-1` and `lte $today+14`, as the schema has no `gte`); unassigned (open,
no owner); completed (ready for verification, verified or closed — `ACTION_COMPLETED_STATUSES`).

**Shared actions:** actions whose resolved requirements (above, confirmed links only, through findings
too) span at least two standards — always resolved against the whole board, since a single-standard
input cannot see the other standard; with a standard selected, only those reaching it. Overdue first,
then by due date; eight rows, with the total. View all: `is_shared eq true` (derived on every
`action.list` row from its `standard_codes`).

**Recent activity:** the twelve newest activity rows, reads (`READ_ONLY_ACTIVITY`) left out. Whole
board, whatever standard is selected.

The evidence panel shows `charts.evidence_status` (unchanged) and links to the Evidence tab's own
queue, where decisions are made. 9.7 retired the "Actions open vs closed" and "Evidence status" charts
and the "Upcoming deadlines" list — the panels above replace them.

## Testing

`.agents/iso-calc-test.cjs`: a fixture per metric, including the edge cases the plan's own testing
spec names (zero requirements, all N/A, only-unassessed), plus a short HTTP section that proves
`metric.audit`/`metric.portfolio` are faithful wrappers — it rebuilds the same answer independently
from the same raw offline-store rows and asserts the two never disagree. `.agents/iso-dashboard-test.cjs`
round-trips every dashboard figure and chart segment through the real list ops, with and without a
standard selected — and, since 9.7, every Needs attention count and panel figure (section P).
