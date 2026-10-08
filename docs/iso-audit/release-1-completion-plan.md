# ISO module — Release 1 completion plan

**Status:** APPROVED 2026-10-06 — the user accepted every recommendation in §2 ("accept all"); recorded as D44–D56 in the integration plan. Build batch by batch.
**Written for:** Bruna (answer §2, then approve) and the executing model (build §3 batch by batch).
**Merges:** the external critique (two reviews, 2026-10-06), the "Audit Programme and Follow-Up Audits"
brief, the learning-from-history discussion, the cyber-security review, the unbuilt wireframe pieces, and
the integration plan's unfinished phases (2.5, 7.6, 8.3, 10.2, 11, 12, 13, 14, 15). §11 maps every single
recommendation to a batch, so nothing is dropped silently.
**Rules:** the integration plan's §1 hard rules still apply in full (offline only, no SQL, no commit/push/
deploy without an explicit OK, CRLF, no AI service, `data-*` not inline user text, every test proven able
to fail, clean full gate per batch).

---

## 0. Summary

| Batch | Delivers | Size¹ | Needs from you |
|---|---|---|---|
| **B0** | Build speed and safety: checkpoint commits, shared test harness, can-fail helper, fast test lanes | S | Q12 |
| **B1** | Defensible conclusions: basis required, gap reason, OFI flag, Out of scope, controlled Apply to related, risk-sorted sign-off, consistency warnings, evidence sufficiency | L | Q1–Q5 |
| **B2** | Findings and actions that close properly: Track this action, closure rules, reopen, repeat findings | M | Q6–Q7 |
| **B3** | History foundation: library frozen per board, close snapshot, evidence fingerprints, learning signals — **and the gap-analysis Excel workbook (the client deliverable, plan 10.2)** | L | Review 3 exported workbooks (STOP 2b) |
| **B6** | Go-live: security headers, pinned scripts, Microsoft sign-in, Supabase dev project and access rules, accessibility and responsive checks | M | Q13 and dashboard steps |
| ▶ **Pilot** | One real gap analysis on the live system, delivered with the B3.5 gap-analysis workbook | — | Pick the client |
| **B4** | Follow-ups and the client programme page, audit setup, evidence request letter, on-site audit pack | L | Q8–Q10 |
| **B5** | Notifications, formal reports (audit, follow-up, maintenance), CSV export | L | Q11 |
| **B7** | Client portal ISO tab (Phase 13) | L | After the pilot |

¹ Rough relative sizes (S < M < L), not promises.

**Shortest path to real use:** B0 → B1 → B2 → B3, with B6 in parallel → pilot. Follow-up and maintenance
audits happen months after a first audit, so B4 and B5 get built *during* the pilot instead of blocking it.
The pilot's client deliverable is the gap-analysis Excel workbook filled from Etcher's own template (B3.5,
plan 10.2). **Correction, 2026-10-06 (B1 prep):** an earlier version of this plan said that workbook already
existed — it does not; only the sanitised template (10.1) and the Reports-tab portfolio CSV/XLSX exist. B3.5
puts it on the pilot path.

**Dependencies:**
- B2 uses B1's statuses.
- B3's snapshot records what B1 and B2 add.
- B4 uses B1's Out of scope and B2's tracked findings.
- B5's reports read B3's snapshots.
- B6 depends on nothing and can start today.

---

## 1. How this plan builds faster

1. **Batches, not tasks.** About 45 recommendations become 7 build batches. Each batch has one data-model
   pass, one server pass, one UI pass, **one** new test suite, **one** full gate run, **one** Progress Log
   row and one checkpoint commit. Before, each small change cost its own gate run (10–15 minutes) and its
   own bookkeeping.
2. **Decisions up front.** Every open question is in §2 with a recommended answer. After approval there
   are only two stops: this plan, and the Supabase dev project in B6, which needs you. No mid-batch waiting.
3. **Test tooling first (B0).**
   - A shared harness removes about 60 lines of setup from every new suite (server, seed, login, screenshots).
   - A can-fail helper turns "break the code, run, restore" from about 5 minutes of hand edits into one command,
     including a byte-for-byte restore check. Hand edits caused three escaping mistakes this week.
4. **Server-level checks first.** Rules are tested over HTTP, which takes seconds. Browser checks (1–3 minutes
   each) cover wiring and layout only.
5. **Fast lanes.** During a batch, run only the named group of suites the batch touches. Run the full gate
   once, at batch close, in the background while the bookkeeping is written.
6. **Reuse before build.** Every item names the existing code it extends (§3). Most "new" features are
   about 70% built already: maintenance carry-forward, corrective-action lifecycle, verification and
   reopen, finding classification, evidence kinds, the evidence-request table, the notifications table,
   jsPDF, the ISO on/off switch.
7. **Stay out of `index.html`.** All ISO work lives in `iso/` and `api/`. Only three planned hooks touch
   `index.html`: the notification bell merge (B5), the Microsoft sign-in button (B6) and the header source
   (B6). That means no golden-snapshot refreshes and no CRLF risk elsewhere.
8. **Dark launch is already possible.** ISO is off in production unless `ISO_ENABLED=1` (`api/config.js:7`,
   `api/iso.js:77`). Code can be committed, and later deployed, without anyone seeing it, then switched
   on for staff when ready.
9. **Protect the work.** The whole ISO module is untracked by git today (`api/_iso*.js`, `iso/`,
   `docs/iso-audit/`, migrations 009/010/014), and the test suites are gitignored (`.gitignore:34`). A week of
   work has no history or rollback. Local checkpoint commits (Q12) make every batch safe to undo, which
   makes building faster.

---

## 2. Decisions needed before B1

Reply **"accept all"** or list exceptions. The recommended answer applies when you accept.

| # | Question | Recommended | Why |
|---|---|---|---|
| Q1 | OFI: keep the OFI button, but store it as *Compliant + OFI flag*, and allow *Partial + OFI*? | **Yes** | Same clicks. The data matches the method (a conforming clause can carry an OFI). The export already treats OFI as "Fully conforming + OFI:". Changes the stored meaning of the 5 statuses confirmed 2026-10-04; the screens stay the same. |
| Q2 | Add **Outside this audit's scope**, separate from N/A, under the N/A button's ▾? | **Yes** | N/A is about the organisation; scope is about this audit. Mixing them distorts coverage. Follow-up audits (B4) need it. The 5 visible buttons stay. |
| Q3 | A conclusion's **basis** (the "Current system" text) is required before **approval, board close and report issue**, not before clicking a status? | **Yes** | Defensible without forcing a click order. Filled automatically when concluding from the add-document form (B1.8). |
| Q4 | **Apply to related:** copy the source's documents, basis and planned action; the target statuses arrive "Derived — confirm", even for a Lead or sole auditor? | **Yes** | Removes the one real path to unreviewed conclusions found in the code (`relationship.applyToRelated` lands *approved* for a Lead). |
| Q5 | **Gap reason** on Partial / Non-Compliant: *Not implemented · Implemented but ineffective · No evidence provided* (required with the basis)? | **Yes** | Your old workbook's own vocabulary. Covers "insufficient evidence" without a new status. |
| Q6 | **Track this action** creates an action, plus a **finding** on formal audit types only (internal, surveillance, recertification, certification prep, follow-up). Gap analyses get actions only. | **Yes** | Formal audits need finding records; gap analyses don't. Classification uses the existing list (major NC, minor NC, observation, OFI). |
| Q7 | A finding can **close only when every linked action is verified effective**, and closed findings can be **reopened** by the Lead with a reason? | **Yes** | Closure needs objective evidence and an auditor conclusion; nothing closes because a box was ticked. |
| Q8 | **Programme = the client's chain of boards** (no new "programme" record), plus a small client settings record for next audit due, frequency and industry? | **Yes** | One source of truth. The brief itself warns against duplicates. |
| Q9 | **Follow-up audit = the maintenance flow plus a scope choice.** Unselected clauses are set to Out of scope. Lead Auditors can start one. | **Yes** | Reuses `audit.startMaintenance`'s carry-forward. The audit type `follow_up` is added. |
| Q10 | **Recurrence** sets the next audit due date and reminders; it never auto-creates boards? | **Yes** | Auto-created empty boards clutter the list and invite copied conclusions. |
| Q11 | **Reports:** three templates (audit, follow-up, maintenance), PDF through jsPDF like the Gantt PDF, a frozen snapshot per issue, and acknowledgement wording of "received and discussed", not "agreed". **Notifications:** in-app only for release 1, with reminders computed when the bell opens (no scheduler); email later. | **Yes** | Smallest build that meets the brief. Emails come with the portal. |
| Q12 | OK to make **local checkpoint commits** on a branch `iso-release-1` at each batch close (**never pushed** without you), and to **track the test suites** in git (`.agents/*-test.cjs`, harness, gate; not scratch or golden files)? | **Yes** | Rollback for a week of work; tests versioned with the code they prove. |
| Q13 | **Client industry list** for programme and learning: Mining & resources · Construction · Manufacturing · Transport & logistics · Professional services · Government · Other? | **Yes** | Structured values can be learned from later; free text can't. |

---

## 3. Batches

Each batch lists **what it builds** (with acceptance), **what it reuses**, **data**, **ops**, **tests**
and **what it deliberately doesn't do**.

### B0 — Build speed and safety (S) · no feature code

- **B0.1 Checkpoint commits** (needs Q12):
  - Create the branch `iso-release-1`.
  - Review the `index.html` diff (about 1,050 lines) so only intended changes go in.
  - Commit the current ISO work in 3–4 logical commits: server, front end, migrations and docs, tests.
  - Never push without you.
- **B0.2 `.agents/_iso-harness.cjs`:**
  - `startOffline(port)` → `{ call(user, body), stop }`.
  - `seedBoard({ standards, statuses, docs, members })`.
  - `browser()` → login, plus `openBoard` and `setTab`.
  - `shots(name)` takes desktop 1440 and phone 390 screenshots.
  - `noPageErrors()`.
  - Used by every new suite; old suites aren't rewritten.
- **B0.3 `.agents/_canfail.cjs <suite> <file> <find> <replace>`:**
  - Backs up the file and asserts exactly one match (CRLF-safe).
  - Runs the suite and asserts `FAIL > 0`.
  - Restores the file, verifies it's byte-identical, and prints one evidence line for the Progress Log.
- **B0.4 Fast lanes** — `.agents/lane.sh <name>`:

  | Lane | Suites | Purpose |
  |---|---|---|
  | `api` | store, logic, api, security, dbsb-unit, import, calc, document, relationship, export, zip | every server rule, minutes |
  | `board` | boardshell, approval-ui, review, dashboard, landing | Clauses / Overview / Actions / landing UI |
  | `evidence` | evidence, evidence-review, upload, prompt, library-seed | evidence and generator UI |
  | `lifecycle` | maintenance, time, gantt-pdf, ui | board lifecycle, time, exports |

- **B0.5 `.agents/iso-shots.cjs`:** the screenshot script moves out of scratch. One command captures every board tab plus the landing, at desktop and phone width.
- **B0.6 Close stale items:**
  - 7.5 (replaced by 7b) and 8.3 (superseded by 8b) — tick them off with a note.
  - 2.5 (view cache) — check whether any ISO view still renders through `_renderCached`, which no longer appears in `iso-core.js`. Close it or fix it with one test.
- **Tests:** run `_canfail` once against `iso-document-test` with a known break. Expect a failure and an exact restore. Gate unchanged.

### B1 — Defensible conclusions (L)

| Item | Builds | Acceptance |
|---|---|---|
| **B1.1 Basis** | "Current system" becomes "Basis — current system". A row with a status but no basis shows an amber **Basis missing** mark and a toolbar chip. | `requirement.approve` / `bulkApprove` skip it with the reason "basis missing". The board can't move to *closed* (and B5 can't issue a report) while any assessed clause lacks a basis; the refusal lists the clauses. |
| **B1.2 Gap reason** | A 3-option pick under the status bar for Partial / Non-Compliant (Q5). | Required alongside the basis for approval. Exported as a prefix to Current system unless the template has a column for it (check in build). |
| **B1.3 OFI flag** | The OFI button = Compliant + OFI. A small **+ OFI** toggle on Compliant and Partial. The row pill reads "Compliant · OFI". | Stored as `ofi=true`; `compliance_status='ofi'` is retired. Export: Compliant+OFI → Fully conforming + "OFI:"; Partial+OFI → Partially conforming + "OFI:". A one-time converter for the offline dev store, backed up first. |
| **B1.4 Out of scope** | N/A ▾ → "Not applicable" / "Outside this audit's scope" (optional note). | Excluded from coverage denominators and counted separately (calc). Export: status blank, note "Outside this audit's scope". |
| **B1.5 Apply to related, controlled** | The panel lists each related clause with both requirement texts (expandable), what will change (status, basis, plan, +N documents) and a tick per target. | Targets get the status with `derived_from` set and approval *proposed* for **everyone**. The row shows "Derived from Q 7.5.1 · **Confirm**". The source's live document links are linked to the targets. Logs `related_applied` with offered / applied / unticked ids (a learning signal). |
| **B1.6 Risk-sorted sign-off + consistency** | The Awaiting approval view is sorted by risk, and each row says why: Non-Compliant › derived › consistency warning › changed since baseline › basis or evidence missing › Partial › rest. | **Check consistency** (amber) appears when a related clause sharing at least one linked document differs by two or more steps (Compliant vs Non-Compliant), or N/A vs anything. Worked out in the browser from data already loaded (`relationship.library` + `document.list`). |
| **B1.7 Evidence sufficiency + quick notes** | Each document in the open row gets a **Partial / Insufficient** flag (through the existing `evidence.review` verdicts). **+ Interview · Observation · Sample note** quick-add (those evidence types already exist). A sample note has population, sample size and exceptions. | Insufficient links don't count as "provided" in the Documents tab, the clause column or `document.list`. Sample fields are saved and shown. |
| **B1.8 Add-document form, finished** | Status buttons on every ticked clause in the form (wireframe Q7), with the basis pre-filled as "Evidence — <document>, <revision> · <date>". Cheat-sheet hover in the form. | Linking a document and concluding becomes one flow; the basis is never empty when it's used. |

- **Reuses:** `validateRequirementPatch`, `applyComplianceStatusPatch`, `relationship.applyToRelated`, `requirement.approve/bulkApprove`, `evidence.review`, `evidence.link`, `document.list`, the export mapping (D36), `reqStatusBarHtml`, `reqExpandedBodyHtml`, `reqApplyPanelHtml`, `reqToolbarHtml`, `_docOpenForm`.
- **Data:** migration drafts 009/010 are amended in place. None has ever been applied anywhere; recorded as an assumption.
  - `iso_requirements`:
    - add `ofi bool`, `ofi_note`;
    - add `gap_reason` (checked: Partial/Non-Compliant only);
    - add `derived_from_id`, `derived_at`;
    - status check gains `out_of_scope` and loses `ofi`.
  - `iso_evidence`: add `sample_population`, `sample_size`, `sample_exceptions`.
- **Ops:**
  - **New:** `requirement.confirmDerived {ids}`.
  - **Changed:** `requirement.update` (accepts the new fields), `approve` and `bulkApprove` (basis gate), `audit.update` (close gate), `relationship.applyToRelated` (derived, documents, signal), `evidence.addLink` (sample fields), `document.list` (insufficient ≠ provided).
- **Tests:**
  - New `iso-conclusions-test`, about 30 checks, mostly server-level.
  - Lanes: `api` + `board`.
  - Can-fail mutations: remove the basis gate; land derived statuses approved for a Lead; skip copying documents; count out-of-scope in coverage; drop the OFI conversion.
  - **Expected, deliberate test edits:** approval-ui and review fixtures must now include a basis before approving; any check reading `'ofi'` as a status.
- **Not in B1:** process views, contradiction workflow, a five-state link model.

### B2 — Findings and actions that close properly (M)

| Item | Builds | Acceptance |
|---|---|---|
| **B2.1 Track this action** | **Track ›** on an open row (Partial / Non-Compliant / OFI with a plan) and on derived Actions rows. A small panel: owner, due date, priority (default from the status), and classification on formal audit types only (Q6). | One op creates the action, plus the finding on formal types, and links it to the clause(s). For a shared plan, every clause with that plan is pre-ticked. The finding's statement comes from the basis, its criterion from the requirement reference, its evidence basis from the linked documents. Afterwards the Actions tab shows the **tracked** record and hides the derived one; there are never two. |
| **B2.2 Lifecycle in place** | Tracked rows show status, verification and due date; clicking opens the **existing** action drawer (correction, containment, root-cause tools, corrective / preventive action, effectiveness check, verify / reopen). | No new drawer. The brief's 11 follow-up states are mapped to the existing 10 action statuses plus effective / ineffective verification (mapping table in the build notes). |
| **B2.3 Closure rule** | — | A finding can't go *final → closed* unless every linked action is closed **and** verified effective. The refusal names the blocking actions (Q7). |
| **B2.4 Reopen** | A Lead-only **Reopen** with a reason (reuses the action reopen reasons: recurred, evidence invalid, ineffective…). | A new transition *closed → reopened*. Counted in `reopen_count`. Shown as a "Reopened" badge. |
| **B2.5 Repeat findings** | — | A finding on a clause that had a finding or a Non-Compliant status on an earlier board in the client's chain is stamped `repeat_of` and shows a **Repeat** badge. |
| **B2.6 Permission fix** | — | `audit.startMaintenance` also allows `lead_auditor`. Today it's admin / audit_manager only, which R2 missed. |

- **Reuses:** `finding.create`, `action.create`, `action.link`, `FINDING_TRANSITIONS`, `action.verify/reopen` (`ACTION_REOPEN_REASONS`), the action drawer, `worklistItemsFrom`, the finding classification config list.
- **Data:** `iso_findings` gains the status `reopened`, `reopen_count`, `reopen_reason`, `repeat_of_ref`.
- **Ops:**
  - **New:** `action.trackPlan`, `finding.reopen`.
  - **Changed:** finding status transition (closure gate), `audit.startMaintenance` (permission).
- **Tests:**
  - New `iso-closure-test`.
  - Lanes: `api` + `board` + `lifecycle` (maintenance).
  - Can-fail mutations: drop the closure gate; show both derived and tracked rows; skip the repeat stamp.
- **Not in B2:** merging findings because their action text matches (never). Each finding keeps its own record under a shared action.

### B3 — History foundation (M) · reproducibility and the learning footprint

| Item | Builds | Acceptance |
|---|---|---|
| **B3.1 Library frozen per board** | Each board stores `library_release` (today `v3`). Cross-standard links, the document catalogue and cheat sheets load from `iso/seed/releases/<release>/`, not from one live file. A release manifest records editions, transition dates (with source and last-verified date), technical reviewer, review date and change notes. | A test adds a fake `v4` release: new boards use it, existing boards are unchanged. Covers "plain-language library" governance and "transition dates as controlled configuration". |
| **B3.2 Close snapshot** | When a board moves to *closed*, one immutable `iso_audit_snapshots` row is written. Per clause: status, OFI, gap reason, basis, baseline, changed-since-baseline, approval. Plus library release and calculation version. | It can't be edited (an immutability trigger like migration 011's design). B5's reports and the later learning work read it. |
| **B3.3 Evidence fingerprints** | The snapshot records, for each linked document: title, revision, date, URL, who linked it and when, and a SHA-256 for uploaded files. Optional **Attach a copy** for key SharePoint documents. | A later broken or changed SharePoint link no longer erases what was seen. Honest limit: links can't be checksummed, only uploaded files. |
| **B3.5 Gap-analysis Excel workbook** (plan 10.2, D36) | **Export to Excel** on the board (Overview / ⚙): one workbook per standard, `<REF>_ISO<code>_Gap_Analysis.xlsx`, filled from `iso/templates/gap-analysis-template.xlsx` by direct XML filling through `api/_isoZip.js` (the A94 path — ExcelJS loses template parts). Op `export.dataset`: staff only, rows projected through an `EXPORT_FIELDS` allowlist (display names not uids; no record ids, `stable_key`, `storage_path` or internal-only actions). | Status mapping onto the template's own list (Fully conforming · Partially conforming · Not conforming · To be updated): Compliant → Fully conforming; Compliant+OFI → Fully conforming with "OFI:" before Current system (D36/D44); Partial (+OFI) → Partially conforming; Non-Compliant → Not conforming; Not assessed → To be updated; N/A and Out of scope → status blank with "Not applicable — <reason>" / "Outside this audit's scope" in Current system (exact cells checked against the template's validation list in build). Gap reason prefixed to Current system. User text written only as escaped strings, never formulas; leading `= + - @` tab/CR prefixed with `'`. Plan 10's tests (sheets, titles/footer per standard, one section row per clause 4–10, row count = clauses, Summary formulas and cached values = `_isoCalc`, validations / conditional formats / data bars / logo / freeze intact, no internal-only fields). **STOP 2b:** you open the three exported files (9001, 14001, 45001) in Excel and compare with your template. |
| **B3.4 Learning signals** | No new UI. Activity entries with fixed payloads: `related_applied` (from B1.5); `doc_linked {source: register suggestion · history suggestion · search · custom}`. The existing 8b.5 suggestion decisions are included. An admin-only **Export signals** (JSON) to check what's being captured. | Each signal is written once per action with the documented payload (server-level test). |

- **Reuses:** `buildGuidance`, `LIBRARY_RELATIONSHIPS` / `DOCUMENT_CATALOG` loaders, the activity log (`iso_activity` already stores before/after, actor, time, reason), the D24 seed-file review process.
- **Data:**
  - `iso_audits.library_release`.
  - New `iso_audit_snapshots` (kind `close` | `report`, data as JSON), plus a trigger.
  - Seed files move under `iso/seed/releases/v3/` (the loader keeps old paths working).
- **Ops:**
  - **New:** `signal.export` (admin).
  - **Changed:** `audit.update` (writes the snapshot on close), `relationship.library`, `document.list`, `guidance.list` (resolve the board's release).
- **Tests:**
  - New `iso-history-test` (server-level).
  - `iso-export-test` gains the plan-10.2 sections (export.dataset projection, the filled workbooks per standard, the status mapping above).
  - Lane: `api`.
  - Can-fail mutations: read the live release instead of the board's; allow a snapshot update; skip a signal.
- **Not in B3:** the learning features themselves (§4) — this batch only makes sure the data exists; CSV export of on-screen views (B5.3).

### B6 — Go-live (M) · runs in parallel, any time

**Code** (Task Hub-wide security changes, outside the ISO hook list; added to the plan's hard rule 6 with reasons before building):
- **B6.1 Security headers on the live site.**
  - `vercel.json` gets the same headers as `serve.mjs`: content security policy, framing protection, HSTS, referrer and nosniff.
  - Both come from one source (a small generator script), so they can't drift.
  - Test: extend `serve-security-test` to assert they're equal.
- **B6.2 Pin the login library.**
  - supabase-js is pinned to an exact version with an integrity check, or served from Task Hub itself.
  - Test: assert the integrity attribute.
- **B6.3 "Sign in with Microsoft."**
  - Through the Supabase Azure provider, restricted to Etcher's tenant. An emergency admin password login is kept.
  - Test: the button calls the provider with the right options. The real sign-in is checked manually after setup.
- **B6.4 Phase 14 checks** in the harness, for every ISO screen at 390 / 768 / 1440 px:
  - no sideways scroll;
  - every button and input has an accessible name;
  - archived audits are read-only.
  - New suite `iso-a11y-test`.
- **B6.5 Migrations ready to apply.**
  - Drafts 009 / 010 / 014 amended (B1–B4), plus 011 (reports), the snapshots table and the client settings table.
  - Database access rules on **every** ISO table.
  - Checked against the dev project with a client login, using `iso-db-verify`.
- **B6.6 Dependency alerts:** `.github/dependabot.yml`. Plus a check that share-view links expire and can be revoked (fix it if not).

**You** (a step-by-step checklist comes with the batch):
- **B6.7 Supabase dev project** (the plan's STOP 3). Create it and apply the migrations in its SQL editor; the executing model never runs SQL.
- **B6.8 Microsoft Entra app registration** plus the Supabase Azure provider settings. Enforce two-step sign-in for admins in 365.
- **B6.9 Operations:**
  - Supabase sign-in rate limits.
  - A backup plan tier, plus one test restore.
  - A one-page breach plan (Australia's notifiable data breaches scheme).
  - A key rotation note (service-role key, MCP secret).
  - A Vercel paid plan for business use.
- **B6.10 Go-live sequence:**
  1. Commit (your OK).
  2. Deploy dark (`ISO_ENABLED` off).
  3. Apply migrations to production (you).
  4. `ISO_ENABLED=1` for staff.
  5. Pilot board.

### ▶ Pilot (after B0–B3 + B6)

- One real gap analysis for one client, built only by staff, delivered with the B3.5 gap-analysis workbook.
- Walk the brief §1–§32 against the live system (plan 14.1) and list anything missing.
- Feedback from the pilot sets the order of B4, B5 and B7.

### B4 — Follow-ups and programme (L)

| Item | Builds | Acceptance |
|---|---|---|
| **B4.1 Audit setup** | A Settings card: objective, scope statement, criteria (standards and editions automatic, plus free text), sites (existing units), team (automatic), limitations, opening and closing meeting notes (date, attendees, notes). | Saved per board; feeds B5's reports. |
| **B4.2 Start follow-up / maintenance** | One dialog from a closed board, or from a finding ("Schedule follow-up") or the programme page. Choose a type, then a scope: all clauses (maintenance) or selected findings / actions / clauses (follow-up; open findings, open actions and Partial / Non-Compliant clauses pre-selected). Then a date, Lead and team. | Non-selected clauses are set to Out of scope. Each carried item shows where it came from: original audit, finding, status, auditor, date first identified, previous evidence (as suggestions). Audit type `follow_up`. |
| **B4.3 Carry-forward labels** (worked out, no new state machine) | Carried, not yet verified · Reconfirmed · Changed since last audit · No longer applicable · Out of scope, plus a **Changed since last audit** chip. | Previous conclusions never count as current (already true: statuses reset, baseline kept). |
| **B4.4 Client programme page** | Opened from the landing's client heading. Shows the client, standards and sites; a **timeline** of boards in the chain; next audit due; separate tiles for open findings by significance, overdue actions, effectiveness reviews due, repeat findings, reopened findings, documents due for review, and follow-ups / maintenance due; buttons for Start follow-up / maintenance, Set next audit, Open board. | `programme.get` adds up existing tables only, with no copies, and only counts boards the caller can open. No single "health" percentage. |
| **B4.5 Client settings** | Next audit due, frequency (one-time · monthly · quarterly · 6-monthly · annual · custom months), industry (Q13), notes. | Reminders come from these dates (B5). Recurrence never creates boards (Q10). |
| **B4.6 Evidence request letter** | In the Documents tab, **Request from client**: pick the documents not yet provided (key ones pre-ticked), grouped by owner, then copy or download the text. | Creates `iso_evidence_requests` rows (the table already exists in 010). Rows show "Requested 12 Oct". Email and portal come later. |
| **B4.7 On-site audit pack** | A PDF checklist (jsPDF) of selected clauses, grouped by clause family or site: Look for / Confirm / Watch for, expected documents, blank lines for notes. | Downloads with a file name (hard rule 13); no AI. |

- **Reuses:** `audit.startMaintenance` (carry-forward, baselines, `carried_from_ref`), `previous_audit_id` and `has_successor`, units, `iso_evidence_requests`, the landing's client groups, the existing PDF approach (`doc.save`).
- **Data:**
  - `iso_audits`: `setup` (JSON), `follow_up_scope` (JSON), audit type `follow_up`.
  - New `iso_client_settings`.
  - `iso_evidence.review_due`.
- **Ops:**
  - **New:** `audit.startFollowUp` (generalises maintenance; `startMaintenance` stays as an alias), `programme.get`, `clientSettings.get/update`, `evidenceRequest.create/list/update`.
  - **Changed:** `audit.update` (setup).
- **Tests:**
  - New `iso-programme-test`.
  - Lanes: `api` + `lifecycle` + `board`.
  - One screenshot round (iso-shots).

### B5 — Notifications and reports (L)

| Item | Builds | Acceptance |
|---|---|---|
| **B5.1 Notifications** (plan 7.6) | **Event** notifications are stored in `iso_notifications` (table already drafted in 009): evidence submitted, awaiting approval, returned, derived awaiting confirmation, finding reopened, action assigned. **Due** reminders are worked out when the bell opens: action due within 7 days or overdue, effectiveness review due, follow-up / maintenance due, report due. | The bell merges ISO items (the planned 7.6 hook). Clicking jumps to the row. No scheduler or cron needed. |
| **B5.2 Formal reports** (Phase 11) | Three templates: **Audit report**, **Follow-up report**, **Maintenance report**. Sections come pre-filled from the setup, findings and snapshot: executive summary, scope and criteria, dates and team, method, limitations, objectives achieved, findings, non-conformities, OFIs and good practice, coverage, evidence index, unverified carried-forward items, library release, sign-off, client acknowledgement. Plus a "Requirement wording is Etcher's plain-language interpretation" disclaimer. | A **Ready to report** checklist blocks issue while any of these remain: basis missing, unapproved, derived unconfirmed, findings unclassified. **Issue** freezes a snapshot (kind `report`, version *n*), downloads the PDF, and records the acknowledgement ("received and discussed"). Reissue creates version *n*+1 and keeps the old one. |
| **B5.3 CSV export of views** (14.2) | Export any on-screen ISO view as CSV. | Staff only. Formula-injection guard `/^[=+\-@\t\r]/`. |

- **Data:** migration 011 as designed (§5.5), plus acknowledgement fields; `iso_notifications` as designed.
- **Ops:**
  - **New:** `notification.list` / `markRead`, `report.readiness`, `report.saveDraft`, `report.issue`, `report.list` / `get`, `report.acknowledge`.
- **Tests:**
  - New `iso-report-test`.
  - Lanes: `api` + `board`.
  - The bell merge hook touches `index.html`, so the full gate includes the golden snapshot check.

### B7 — Client portal ISO tab (L) · Phase 13, after the pilot

Phase 13 as written, plus the brief's boundaries.

**Clients may:**
- view agreed findings and their assigned actions;
- upload follow-up evidence;
- comment;
- propose completion;
- request a review;
- see due dates;
- acknowledge reports ("received and discussed").

**Clients may never:**
- change conclusions or classifications;
- verify or close anything;
- delete the evidence trail.

Emails start here.

---

## 4. Deferred, with the trigger that brings each back

| Item | Why later | Trigger |
|---|---|---|
| **Learning engine features:** document-suggestion ranking, link confidence, common gaps per clause, repeat-finding trends, reused action wording, effort ranges, suggestion quality | Needs history to learn from; B3 captures it from now on | About 15 closed boards with snapshots |
| **Client-level document register** (evidence shared across a client's boards and years) | Changes evidence permissions from per-audit to per-client, a security change | Second maintenance cycle for a pilot client |
| **Mobile capture with offline queue** (photo or note to the open clause on remote sites) | Offline sync is the largest technical piece | Pilot feedback from site audits |
| **Phase 12 registers** (legal obligations, risks, controls) | Not needed to run a gap or internal audit | Client demand; first candidate is linking 45001 / 14001 6.1.3 to a legal register |
| **Process tags and Process filter** | Units cover sites; processes need their own tags | Internal audits that are planned by process |
| **D40 shared library of custom documents** | Custom documents work per audit today | Same custom name created on three or more boards |
| **Cross-standard link types** (equivalent · shared evidence · related) | Content work for an Etcher technical reviewer; B3 signals will show which links are weak | Library v4 review |
| **Email notifications** | In-app covers release 1 | With the portal (B7) |
| **OCR / document classification, contradiction workflow** | Large; a comment plus B1.6 consistency warnings cover most of it | Explicit demand |

**Learning guardrails** (apply when the engine is built):
- It suggests evidence and focus areas, **never conclusions**.
- It always shows its basis ("linked in 14 of 17 audits").
- A minimum sample size before anything shows.
- Aggregate, register-only data across clients; never one client's text on another client's board.
- Library updates go through review and versioning (B3.1).
- No AI service in the app; heavier analysis happens outside the app and comes back as reviewed seed data.

## 5. Won't build (and why)

- **Certification-readiness score or a single confidence %.** It implies certainty the audit can't give. Separate indicators instead (B4.4).
- **Merging findings because their action text matches.** Same wording ≠ same root cause.
- **A parallel set of 11 verification states.** Duplicates the action lifecycle; it's mapped instead (B2.2).
- **Six parallel views.** Filters on the same records instead.
- **Client-approved closure.** Closure is the auditor's (B2.3, B7).
- **Recurrence that auto-creates boards** (Q10).
- **"Not sampled" status.** Use Not assessed with a note.
- **A configurable classification system per engagement.** The existing configurable list is enough.
- **AI inside the site.**

## 6. Data impact (consolidated, all additive)

- **Amend the 009 / 010 / 014 drafts** (never applied; recorded as an assumption):
  - B1: requirement fields and status check, sample fields.
  - B2: finding status and fields.
  - B3: `library_release`.
  - B4: `setup`, `follow_up_scope`, audit type `follow_up`, `review_due`.
- **New migration files:** `011_iso_reports.sql` (as designed), `015_iso_history.sql` (snapshots plus trigger), `016_iso_client_settings.sql`.
- **Offline dev store:** one converter, backed up first (OFI → Compliant + flag). Tests use fresh stores and are unaffected.
- **Production:** no ISO data exists yet. Migrations are applied once, by you, at go-live (B6.10).
- **Nothing destructive**, and no Task Hub blob (`app_state`) changes.

## 7. Ops (append to the plan's §4.1a when built)

- **New:**
  - B1: `requirement.confirmDerived`
  - B2: `action.trackPlan`, `finding.reopen`
  - B3: `signal.export`, `export.dataset`
  - B4: `audit.startFollowUp`, `programme.get`, `clientSettings.get` / `update`, `evidenceRequest.create` / `list` / `update`
  - B5: `notification.list` / `markRead`, `report.readiness` / `saveDraft` / `issue` / `list` / `get` / `acknowledge`
- **Changed:** `requirement.update` / `approve` / `bulkApprove`, `audit.update` (close gate, snapshot, setup), `relationship.applyToRelated` / `library`, `document.list`, `guidance.list`, `evidence.addLink`, finding status transitions, `audit.startMaintenance`.

## 8. Permissions

| Action | Who |
|---|---|
| Confirm a derived status | Anyone who can assess (approval rules then apply as normal) |
| Track an action, create a finding | Auditor and above |
| Close or reopen a finding, issue a report, start a follow-up or maintenance audit | Lead Auditor, audit manager, admin |
| Programme page | Staff; shows only boards the caller can open |
| Client settings | Audit manager, admin |
| Export signals | Admin |
| Notifications | The recipient only |
| Client portal | B7 boundaries |

All checked on the server (hard rule 10). Each B-batch suite includes deny checks.

## 9. Calculation changes (`api/_isoCalc.js`)

- Out of scope gets its own bucket and is excluded from applicable / assessed / coverage.
- OFI is counted from the flag (`req_ofi`).
- Insufficient evidence links don't count as provided.
- New programme indicators (B4.4) are computed from existing records.
- Dashboards keep separate indicators; nothing collapses into one score.

## 10. Risks and how they're handled

| Risk | Handling |
|---|---|
| The status change touches the 5 statuses confirmed 2026-10-04 | The visible buttons don't change; only the stored meaning is clearer (Q1, Q2) |
| Requiring a basis slows auditors down | Enforced at approval and close, not at click time; pre-filled from documents (B1.8) |
| Deliberate test edits look like regressions | Each batch lists its expected test edits up front |
| jsPDF report layout eats time | One plain house style shared by all three templates; no per-section design work |
| Access-rule gaps in Supabase | Checked against the dev project with a client login before production (B6.5) |
| Scope creep inside a batch | Each batch states what it doesn't do; new ideas go to §4 |
| The uncommitted work is lost | Checkpoint commits (B0.1, Q12) |

## 11. Traceability — every recommendation → where it lands

| Source | Recommendation | Lands in |
|---|---|---|
| Critique | Document coverage ≠ conformity | B1.1, B1.7, B5.2 readiness |
| Critique | Apply to related needs strict control | B1.5 |
| Critique | Status model mixes concepts (OFI, N/A vs scope, insufficient evidence) | B1.3, B1.4, B1.2 |
| Critique | Complete corrective-action lifecycle; findings not merged | B2.1–B2.3, §5 |
| Critique | Audit planning (scope, criteria, team, limitations, meetings) | B4.1 |
| Critique | Formal audit report | B5.2 |
| Critique | Non-conformity severity / classification methodology | B2.1 (existing configurable list), Q6 |
| Critique | Plain-language library authority, library versioning | B3.1, B5.2 disclaimer |
| Critique | Cross-link confidence / automation permission | §4 (link types) + B3.4 signals |
| Critique | Relevance vs sufficiency | B1.7 |
| Critique | Process-based auditing | §4 (process tags and filter) |
| Critique | Sampling record | B1.7 sample fields |
| Critique | Carry-forward as unverified | Already true; B4.2, B4.3 labels |
| Critique | Contradictory evidence | B1.6 consistency warnings; full workflow §4 |
| Critique | Historical reproducibility | B3.1–B3.3, B5.2 versions |
| Critique | Offline conflicts | Already handled: ISO writes are version-checked on the server |
| Critique | Readiness score / one confidence formula | §5 (won't build) |
| Critique | Transition dates as controlled configuration | B3.1 manifest |
| Critique | Client-approved closure | B2.3, B7 |
| Critique | OCR, suggested mappings | §4 |
| Follow-up brief | Programme hierarchy and dashboard | B4.4 (client chain, Q8) |
| Follow-up brief | Follow-up audits, carried-item display, workflow | B4.2, B2.3 |
| Follow-up brief | Verification states | B2.2 mapping |
| Follow-up brief | Maintenance planning, reminders, recurrence | B4.5, B5.1, Q10 |
| Follow-up brief | Carry-forward states | B4.3 |
| Follow-up brief | Scheduling with scope, criteria, team | B4.1, B4.2 |
| Follow-up brief | Client portal rules | B7 |
| Follow-up brief | Notifications | B5.1 |
| Follow-up brief | Follow-up and maintenance reports | B5.2 |
| Follow-up brief | Traceability of every change | Exists (activity log); B3 snapshots |
| Follow-up brief | "Schedule follow-up" from a finding; programme buttons | B4.2, B4.4 |
| Follow-up brief | Sites | Units (exist) + B4.4 grouping; client-level sites §4 |
| Learning | Signal footprint now | B1.5, B3.2–B3.4, B4.5 (industry); hours already logged |
| Learning | Engine features | §4 |
| Extras | SharePoint link rot | B3.3 |
| Extras | Client-level document register | §4 |
| Extras | Cross-standard consistency warnings | B1.6 |
| Extras | Risk-sorted Lead review | B1.6 |
| Extras | Evidence request letter | B4.6 |
| Extras | On-site audit pack | B4.7 |
| Extras | Mobile capture on remote sites | §4 |
| Security | Headers on the live site | B6.1 |
| Security | Pin and verify the login library | B6.2 |
| Security | Two-step sign-in / Microsoft sign-in | B6.3, B6.8 |
| Security | Server-side sign-in rate limits | B6.9 |
| Security | Access rules on ISO tables | B6.5 |
| Security | Keys, dependency alerts, share links, backups, breach plan | B6.6, B6.9 |
| Wireframe leftovers | Status per row in the add-document form; cheat-sheet hover | B1.8 |
| Wireframe leftovers | D40 shared custom documents | §4 |
| Plan leftovers | 2.5, 7.5, 8.3 | B0.6 |
| Plan leftovers | 7.6 notifications | B5.1 |
| Plan leftovers | 10.2 gap-analysis Excel workbook | B3.5 (pilot path) |
| Plan leftovers | 14.2 CSV export of views | B5.3 |
| Plan leftovers | 11 reports | B5.2 |
| Plan leftovers | 12 registers | §4 |
| Plan leftovers | 13 portal | B7 |
| Plan leftovers | 14.1 brief walk | Pilot |
| Plan leftovers | 14.3–14.5 | B6.4 |
| Plan leftovers | 15 security / dev DB / docs | B6 |
| Task Hub (not ISO) | Data-loss Tier 2 backlog in the shared sync | Out of scope here; tracked separately |

When approved: record Q1–Q13 as decisions D44–D56 in the integration plan's §2, append the ops to §4.1a,
and replace RESUME HERE's "next" with "B0".
