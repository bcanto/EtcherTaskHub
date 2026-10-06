# ISO Audit — the user's brief (condensed, list items kept verbatim)

Source: the user's prompt of 2026-09-28/29 in the planning session. Prose is trimmed; every list item
is kept. Section numbers match the original brief and are referenced from
`docs/iso-audit-integration-plan.md`. Where the plan records a decision that changes something here
(e.g. single organisation, status split), **the plan wins**.

## §1 Primary outcome
ISO Audit is a native Task Hub module: its own sidebar entry, opens inside the normal shell, uses Task
Hub auth, users, permissions, database conventions, Workboards main table, design, responsive
behaviour, existing components, notifications/comments/attachments/activity where available. Supports
multiple clients and multiple audits concurrently; designed for a future ISO Client Portal; data
separated by organisation, client, audit and permissions. Task Hub is the architectural source of truth;
the workbook is the source of truth for imported standard/clause/requirement wording unless an admin
creates a controlled new version; the prototype is a source of reusable logic only.

## §4 Navigation — sections the module provides
Audit portfolio or list · Selected audit dashboard · Requirements and gap analysis · Findings · Actions ·
Evidence · Reports · Audit configuration · Templates or administration where authorised.
Fast switching between active audits; keep each audit's last view, filters and grouping.

## §5 Multi-client and multi-audit — a user must be able to
Create multiple audits for one client · Create audits for multiple clients · Run multiple audits
concurrently · Switch between active audits · Archive completed audits without deleting them ·
Duplicate an audit structure as a reusable template · Create internal audits · readiness/gap-analysis
audits · certification preparation audits · surveillance audits · recertification audits · supplier
audits · custom audit types · Select one or multiple standards · Configure audit scope · Include one or
multiple sites · Include departments and processes · Record justified exclusions · Assign a lead auditor
· Assign supporting auditors · Set audit and reporting dates · Restrict access by organisation, client,
audit and role. No cross-client leakage even if a route parameter, record ID or API request is changed.

## §6 Concepts kept separate
Audit · Standard · Standard version · Clause or requirement · Audit requirement instance · Assessment ·
Finding · Corrective action · Evidence · Evidence link · Verification · Report · Report snapshot · Comment
· Activity-history record · Client-facing response · Shared or connected relationship.
One finding → many actions; one action → many findings/requirements; one evidence → many requirements;
a shared action keeps one identity and number; historic audits stay on their original standard version.

## §7 Requirements table fields
Audit · Client · Standard · Standard version · Clause · Clause title · Requirement · Audit question · Site
· Department · Process · Evidence expected · Evidence requested · Evidence submitted · Evidence accepted
· Assessment status · Implementation level · Effectiveness · Gap category · Finding type · Risk rating ·
Current controls · Auditor notes · Recommended action · Responsible person · Target date · Related action
numbers · Verification status · Client visibility · Last updated · Source version.

**Saved views:** All requirements · Not assessed · Assessment in progress · Evidence required · Evidence
submitted · Evidence awaiting review · Gaps identified · Major nonconformities · Minor nonconformities ·
Opportunities for improvement · Open actions · Overdue actions · Awaiting client response · Awaiting
auditor review · Ready for verification · Verified and closed · Client-visible records. Saved views
respect permissions.

## §8 Audit creation wizard
1. Client and audit details: Client · Audit title · Audit type · Automatically generated audit reference
   · Audit scope · Included sites · Included departments · Included processes · Exclusions and
   justification · Lead auditor · Supporting auditors · Client contacts · Planned start date · Planned
   completion date · Report due date · Certification body where applicable · Internal notes · Initial
   client visibility configuration.
2. Standards: ISO 9001 · ISO 14001 · ISO 45001 · IMS combinations · future standards via controlled
   administration (never hard-code only three).
3. Applicability: include all applicable clauses · mark clauses for applicability review · record
   exclusions · require justification for not-applicable · apply requirements to selected sites,
   departments or processes · add client-specific, contractual, regulatory/legal requirements where authorised.
4. Team and permissions: internal users · auditors · audit managers · internal contributors · read-only
   reviewers · future client portal participants · users permitted to upload evidence / respond to
   findings / verify or close actions.
5. Create workspace: requirement instances, default views, initial permissions. Never alters the library.

## §9 Gap analysis — per requirement
Current system or practice · Audit question · Evidence expected · Evidence requested · Evidence reviewed ·
Evidence references · Interview notes · Sampling details · Sites / departments / processes assessed ·
Auditor observations · Implementation level · Effectiveness assessment · Gap description · Business or
operational impact · Risk severity · Finding classification · Recommended action · Responsible person ·
Target date · Verification requirements · Internal notes · Client-visible comments.
Assessment, action and verification statuses stay separate; completing an action never marks a
requirement compliant.

## §10 Findings and scoring
Configurable classifications (Major NC, Minor NC, Observation, OFI …). Configurable scoring may consider
assessment completion, implementation level, evidence strength, effectiveness, risk severity, finding
classification, action completion, verification status. Distinguish: requirements assessed ·
requirements conforming · requirements with accepted evidence · actions created · completed · verified ·
findings closed · evidence requested · submitted · accepted. Never count unassessed as conforming, task
completion as compliance, or uploaded evidence as accepted. Every metric has an explainable formula (name,
formula, included/excluded statuses, N/A treatment, unassessed treatment, rounding, data date) and one
calculation service feeds dashboards, graphs, exports and reports.

## §11 Numbering
Patterns: AUD-2026-001 · AUD-2026-001-F001 · -A001 · -E001 · -R001. Automatic, unique at DB level,
concurrency-safe, never reused after delete/archive, preserved on move/assign/edit, one number per shared
action, shown in tables, drawers, notifications, exports, reports and client screens; controlled prefix
config; a concurrency test creating many actions at once.

## §12 Connected clauses — topics
Context · Interested parties · Leadership · Risks and opportunities · Objectives · Competence and
training · Communication · Document control · Operational control · Emergency preparedness · Monitoring
and measurement · Internal audits · Management review · Nonconformity · Corrective action · Continual
improvement. States suggested / confirmed / rejected. A suggestion never changes another assessment,
marks another clause conforming, accepts evidence for another clause, closes another finding or completes
another action. Show related clauses, explain why, confirm/reject, record who and when, keep independent
traceability. Indicators: "This evidence may support four additional requirements" · "This action is linked
to seven requirements" · "Three connected requirements still require verification" · "A related requirement
changed after this item was reviewed" · "This evidence has been accepted for two requirements and is
awaiting review for three others".

## §13 Evidence
Kinds: file upload · SharePoint links · document links · website links · photographs · meeting notes ·
interview records · sample records · policy references · procedure references · client submissions ·
version details · evidence owner · evidence date · review status · auditor comments · confidentiality ·
review/expiry date · multiple requirement links · superseded evidence.
Statuses: Requested · Submitted · Under review · More information required · Accepted · Rejected ·
Superseded · Restricted. History: uploader, time, original filename, stored reference, version reviewed,
links, who accepted/rejected, comments, replacements, visibility changes. Consider types, size limits,
secure download, access checks, virus scanning, retention, restricted/PII material.

## §14 Actions
Fields: number · title · description · related finding · related requirements · root cause · correction
or containment · corrective action · preventive/improvement action · owner · due date · priority · risk ·
progress · subtasks · evidence · client response · internal comments · auditor review · verification
requirements · verification result · closure decision · rejection and resubmission · extension request ·
approval history · reopening history.
Workflow: Draft · Assigned · In progress · Awaiting evidence · Submitted for review · More information
required · Ready for verification · Verified · Closed. Only auditors/audit managers verify and close;
clients may submit but never verify. Reopen when evidence invalid · action ineffective · issue recurs ·
connected requirement changed · later audit finds the same problem · closed in error — reason required.

**Add-on — correction vs corrective action:** Immediate correction (what was fixed immediately) ·
Containment (what controls the immediate risk) · Root cause (why) · Corrective action (prevents
recurrence) · Effectiveness check (how it will be proven) · Effectiveness review date.
**Add-on — root cause tools:** 5 Whys · Fishbone categories · cause-and-effect tree · contributing factors ·
human factors · process failure · training issue · resource issue · equipment issue · supervision issue ·
documentation issue · control design failure · control operating failure. Prevent superficial causes such
as "human error" alone where a major finding requires formal analysis.

## §15 Dashboards
Portfolio: active audits · due soon · overdue audits · open findings · overdue actions · awaiting
verification · evidence awaiting review · progress by client · by audit · workload by auditor · findings by
standard · audit stage · upcoming report deadlines.
Audit: assessment completion · readiness/compliance indicators · results by standard · by clause · findings
by classification · actions by status · overdue actions · evidence status · verification progress ·
progress by site · department · process · owner · risk distribution · upcoming deadlines · client
responses awaiting review · original vs current position · shared actions across standards.
Client-facing: progress · stage · evidence requests · open client actions · deadlines · approved findings ·
responses awaiting review · recently completed actions · approved reports.
Every number links to the exact filtered records.

## §16 Graphs
Results by standard · by clause · assessment status distribution · finding classification distribution ·
actions by status · open vs closed · actions by owner · overdue by department · evidence status ·
verification status · risk heat map · progress over time · initial vs current · findings by site · by
process · recurring findings · shared actions across standards. Respect audit, filters, permissions; show
data date; consistent legends/colours; accessible labels; not colour alone; never treat unassessed as
conforming; print-friendly; report inclusion; same calculation service; honest empty states.

## §17 Report builder
Sections: title · client details · audit reference · scope · standards and versions · dates · auditor
details · executive summary · methodology · limitations · exclusions · summary of findings · results by
clause · selected graphs · detailed findings · action plan · evidence summary · verification status ·
approval details · appendices. Lifecycle: Draft · Internal review · Approved · Issued to client ·
Superseded. Issued = immutable snapshot. Store version, generated date, data snapshot date, generated by,
approved by, issued by, recipients, included sections, graph data, file reference, superseded links.

## §18 Client portal
Clients may: view shared audits · permitted progress · approved findings · assigned actions · upload
evidence · comment · respond to findings · request extensions · mark actions ready for review · respond to
information requests · download approved reports · view deadlines · receive notifications · view their
submission history. Clients must not: view internal notes · unreleased drafts · change assessments ·
accept their own evidence · verify or close findings · view other clients / unauthorised audits /
restricted evidence · edit issued reports · bypass permissions via URL or API.
Visibility levels: internal only · selected client contacts · all authorised client users · visible after
auditor approval · included in final report only — enforced server-side.
**Add-on — factual-accuracy review:** the client may confirm facts · dispute a factual statement · provide
additional evidence · suggest corrected names or dates · add a management response; may not delete the
finding · change its classification · mark it closed · edit the auditor's conclusion. Preserve original
wording · client response · auditor decision · final wording · decision history.
**Add-on — management response:** management response · accepted or disputed · proposed correction ·
proposed root cause · proposed corrective action · responsible manager · proposed due date · resources
required · extension request · approval status.

## §19 Notifications
Action assigned · evidence requested · evidence submitted · more information required · due date
approaching · action overdue · extension requested · extension approved/rejected · finding released to
client · comment/response added · submitted for verification · action accepted · action rejected · audit
stage changed · report approved · report issued. In-app + email, preferences/digests where supported, no
noise for background updates, no internal content to clients.

## §20 Activity history
Record: actor · date/time · record type · reference · previous value · new value · action · reason ·
source (user, import, automation, portal) · evidence upload/replacement · assessment change · finding
classification change · due-date change · extension decision · visibility change · relationship
confirmation/rejection · verification decision · report generation/approval/issue · reopening ·
archiving. Normal users cannot delete history; bulk edits create one entry per record.
Reason required for: changing a verification result · reopening a closed action · downgrading a major
finding · extending an overdue action · changing client visibility after release · superseding a report.

## §21 Roles
Task Hub administrator · Audit manager · Auditor · Internal contributor · Client administrator · Client
contributor · Read-only reviewer (capabilities mapped in the plan §6.4). Server checks; queries scoped by
client and audit; files, exports, reports and direct API calls validated separately; permission changes logged.

## §22 Templates and standard library
Templates for audit setup · audit types · standard selection · clause applicability · audit questions ·
evidence guidance · saved views · finding classifications · scoring models · action workflows · report
layouts · notification rules. Converting an audit to a template never copies client evidence,
confidential notes, personal information, client responses, issued reports or client identifiers.
Versioned libraries: new versions never change historic audits; show changes; new audits pick the new
version; deliberate upgrade workflow; record who approved.

## §23 Import
Preserve: traceability · sheet and row references · exact wording · evidence guidance · assessments ·
current-system notes · planned actions · shared actions · owners · due dates · progress · notes · evidence
references · suggested and confirmed links · source-change detection · no duplicate imports · no silent
overwrites. Support: dry-run preview · validation · added/changed/removed detection · conflict report ·
transactional apply · backup before change · rollback on failure · import history · who imported · file
hash · source standard version · summary. Never delete a requirement because it disappeared; never use
row number alone as identity; keep the original workbook; never import prototype test data into production.

## Add-ons — wider management system (plan Phase 12)
**Risk register:** link findings to existing risks · propose a new risk · recommend a rating change · link
to existing controls · identify a failed control · trigger a control review · show residual risk after
closure — never change the official register without approval.
**Legal and obligations register:** legislation · regulations · licence conditions · codes of practice ·
contractual obligations · client requirements · internal policies; obligation owner · applicability ·
jurisdiction · review date · change notification · evidence of evaluation · compliance evaluation result ·
linked findings.
**Control library:** title · objective · owner · type · frequency · preventive/detective · manual/automated ·
related risks · related ISO clauses · required evidence · test procedure · last test result · next test
date. A requirement maps to several controls; a control supports several standards.
**Document control:** document number · revision · effective date · approval status · owner · next review
date · superseded status · SharePoint/DMS link · warning when evidence points to an obsolete document.

## §26 Data integrity rules
1. Completing an action does not automatically make a requirement compliant.
2. Uploading evidence does not mean the evidence has been accepted.
3. Suggested clause relationships do not change assessments.
4. Client users cannot verify or close findings.
5. Unassessed requirements are not conforming.
6. Not-applicable requirements require justification.
7. Issued reports are immutable snapshots.
8. Historic audits retain their original standard version.
9. Audit records are separated by organisation, client, audit and permissions.
10. Archived records remain traceable.
11. Shared evidence is referenced rather than unnecessarily duplicated.
12. Automatic calculations have explainable formulas.
13. Bulk changes create individual history entries.
14. Dashboard totals link to their source records.
15. Findings, actions and evidence remain traceable to their audit.
16. Shared actions retain one stable action number.
17. Numbers are not reused.
18. Source imports do not silently overwrite user changes.
19. Removed source requirements are not silently deleted.
20. Client visibility changes are permission-checked and logged.
21. Report exports use the same calculations as the live dashboard.
22. Direct record URLs must not bypass access control.

## §27 Required automated tests
Creating multiple audits · multiple audits for one client · audits for different clients · switching
audits · preserving filter state · organisation isolation · client isolation · audit-level permissions ·
direct URL access attempts · direct API access attempts · unique audit / finding / action numbering ·
concurrent action creation · Workboards filters · saved views · bulk edits and history · assessment vs
action status separation · action completion without assessment change · evidence submission without
acceptance · evidence accepted for one requirement but not another · suggested / confirmed / rejected
links · shared actions across standards · N/A justification · client visibility · internal-note
restrictions · client cannot verify · report snapshot immutability · report versioning · import dry run ·
import conflicts · source changes · removed source requirements · preservation of user edits · activity
entries · dashboard total accuracy · graph data accuracy · calculation consistency across dashboard,
export and report · archived audit behaviour · responsive behaviour · accessibility · existing Task Hub
regression tests. Security test: a client-A user cannot get client-B data by changing the URL, audit ID,
client ID, query parameter, API body, file reference, export request or report reference.

## §28–29 UX, performance, security
Use Task Hub typography, spacing, colours, buttons, forms, drawers, modals, tables, empty/loading/error
states, toasts, mobile patterns. Clear separation of assessment / finding / action / evidence /
verification; consistent badges; audit and client context always visible; before destructive operations
show client, audit, record number and impact; keyboard access and labels. No loading every client's
records into the browser; server-side filtering/pagination; index organisation, client, audit, standard,
clause, status, owner, due date, action/finding numbers, visibility, archived; no N+1 queries; validate
and sanitise input; protect downloads; don't log confidential evidence; no internal ids or secrets in
client exports.

## §31 Definition of done
ISO Audit in navigation · opens inside Task Hub · Task Hub auth and permissions · multiple audits · clients
isolated · Workboards table reused/extended · requirements assessable · findings creatable · actions
auto-numbered · evidence linked and reviewed · three statuses separate · connected clauses suggested and
confirmed safely · dashboard totals reconcile · graphs use real data · history recorded · import preview ·
no silent overwrites · tests pass · no Task Hub regressions · docs updated · no placeholders presented as done.

## §32 Final report items
1 Architecture summary · 2 Components reused · 3 Prototype logic migrated · 4 New entities/migrations ·
5 Routes added · 6 Permissions · 7 Numbering · 8 Calculations · 9 Import and migration behaviour ·
10 Tests added · 11 Test results · 12 Known limitations · 13 Deferred features · 14 Deployment
considerations · 15 Rollback instructions · 16 Manual validation still required. Never claim
production-ready unless implementation, migration, permission and regression testing support it.

## Truncated
The brief ended mid-sentence: "Audit universe → Risk-based programme → Audit planning → Pre-audit
requests → Fieldwork → Review and quality assurance → Findings and CAPA → Effectiveness verification →
Trend a…". Treated as a later-release lifecycle view (plan §13).

## §33 Later additions R1–R10 (2026-09-29)
The user's follow-up message, verbatim (spelling kept):

> "make sure timesheets can add hours agains iso audit client, sam needs to be able to invoice/send gantt
> view like the one in the workboards, pray attention ion everything that was already improved. iso in the
> main left menu should expand to let me chose new client board, add whhich stands or all 3 and then show
> the template reeady to be populate in the expanded should let me pick active clients, to keep my work,
> client will be added in the client manager and pick one when start iso board, include it to reports and
> proforma, it is not an independed module its part of the tash hub, in any circustances should open a new
> tab/window, reflect it in the digest, control acesses just like the workboards int he begning when add
> new iso bpard we should be chosing who has acess"

Split into numbered requirements (the plan's decisions D10–D16 say how each is met):

| # | Requirement |
|---|---|
| R1 | Timesheets can log hours against an ISO audit's client. |
| R2 | Sam can invoice ISO work and send an ISO Gantt view like the Workboards Gantt. |
| R3 | Everything already improved in Task Hub stays improved — no regressions. |
| R4 | "ISO" in the main left menu expands; from it the user starts a new client ISO board, picks one, two or all three standards, and lands on the template ready to populate. |
| R5 | The expanded ISO menu lists active clients so the user can pick one and continue existing work. |
| R6 | Clients are added only in the Client Manager; starting an ISO board picks one of them. |
| R7 | ISO appears in Reports and Pro forma. |
| R8 | ISO is part of Task Hub, not an independent module, and must never open a new tab or window under any circumstances. |
| R9 | ISO is reflected in the Digest. |
| R10 | Access is controlled exactly like Workboards: when a new ISO board is added, the creator chooses who has access. |

Where §1, §4 or §8 conflict with R1–R10 (e.g. "its own sidebar entry", the 5-step wizard order), R1–R10
win — see plan D10–D17.

## §34 Later additions R11–R13 (2026-10-02)
Three inputs on the same day. R11 and R12 arrived as briefs written by ChatGPT that the user pasted in
(the R11 brief was reviewed at the user's request — "do you agree or can top it?" — and the plan follows
the reviewed version). R13 is the user's own follow-up. The user's own words, verbatim (spelling kept):

> "i had this idea can we implement? would you be able to build as well? can you use reliable online
> available information and docuemnts examples in the docuemnt @ISO 9001, 14001, 45001 Gap Analysis
> Etcher_Coastal Electrics V2.0 and source for trusty sources"

> "why? the standards dont change often, I dont really need to upload the library ? all i wante dwitrh
> the upload was the guidance/example to you, dont need to uploaded if makes easier to have a thruth
> source. we can just generate most updated version including 2027 changes and ill code change when
> othes come? otherwide can do upload i guess"

User choices (2026-10-02, answered as multiple-choice questions): plan only, no build yet; Company
Profile per client; prompt templates kept as reviewed seed files in the code.

| # | Requirement |
|---|---|
| R11 | Evidence review and reuse. The register shows each requirement's own wording under its clause title, plus an optional Evidence column. The requirement drawer is split into tabs (Assessment, Evidence, Relationships, Findings and actions, Activity), with plain-language guidance kept apart from the requirement text. Evidence is picked from a searchable selector (suggested examples, this board's evidence, recently used, used on related requirements, other/free-typed); one evidence record serves many requirements across standards. Confirmed related requirements surface evidence suggestions that a person confirms or rejects one requirement at a time. Nothing about evidence ever changes an assessment state, result, applicability, effectiveness, risk or action status by itself. (ChatGPT brief, as amended by the 2026-10-02 review — plan D19–D21, D25.) |
| R12 | Document generator prompts. For a suggested document type, "Download generator prompt" builds a strict, predefined text prompt (copy, or download as TXT) from an approved template, the client's confirmed company profile, the requirement, its confirmed related requirements and the user's answers. The app calls no AI service. Unconfirmed or missing information becomes a visible `[INFORMATION REQUIRED: …]` placeholder; the prompt never claims certification or conformity. A document later made from it enters through the normal evidence workflow as Draft. Templates may draw on the workbook's evidence examples and on official public guidance, with every source recorded. (ChatGPT brief — plan D22–D23.) |
| R13 | Library source and editions. The user does not need to upload the standard library; one reviewed source of truth in the code is fine, updated by a code change when a standard changes. The user wants the newest editions (ISO 9001:2026 and ISO 14001:2026 are published; ISO 45001's revision is expected in 2027). Verbatim ISO text stays out (D8) — see plan D24. |

Where §13 (Evidence), §22 (Templates and standard library) or §23 (Import) conflict with R11–R13,
R11–R13 win — see plan D19–D25.
