# ISO Audit Board — Redesign Proposal

**Status:** proposal for approval (2026-10-04). Nothing is built. Produced with the `iso-compliance-architect`, `impeccable` (shape, Operate mode) and `responsive-frontend-architect` skills.
**Wireframes:** [redesign-wireframes.html](redesign-wireframes.html). Double-click to open; it is self-contained. It is a working mock of all four tabs, built on the real v3 register (133 clauses, 125 documents, 407 links). Audit progress and people are illustrative. Use "View as" to switch between Lead Auditor, Auditor and Sole auditor; "Design notes" shows what changed and the click counts. It is not served on :3001 because `serve.mjs` blocks `/docs/`.
**Reference:** `Etcher_Solutions_ISO_Audit_Registers_Editable_v3.xlsx` (repo root).
**Confirmed before this proposal (2026-10-04):** only Etcher auditors work in the board · Lead Auditor signs off per audit or section, not per clause · five statuses · v3 replaces the built-in library, old seeds archived.

---

## 0. The proposal in six lines

1. **7 board tabs → 4:** Overview · Clauses · Documents · Actions. Settings moves to a ⚙ in the header.
2. **One status per clause**, set with one click on the row: Compliant · Partially Compliant · Non-Compliant · OFI · N/A. Today a clause carries up to seven status-like fields.
3. **No clause popup for the everyday path.** A row expands in place showing exactly the register's own columns. The 6-tab popup and its 12-field form go.
4. **A new Documents view, evidence first.** Column P names 125 documents and the clauses each one supports. Add a document once and its clauses arrive pre-ticked. **23 documents touch all 133 clauses; 16 cover 90%.**
5. **Relationships are built in, not suggested per board.** Column P's 407 cross-standard links ship with the library. "Apply to related" on a clause carries the status and documents across in one click.
6. **The Lead Auditor approves in bulk** (a standard or a section at a time) and returns only the exceptions. A sole auditor's statuses are final on entry.

---

## 1. What the v3 register tells us

| Fact | Number | Design consequence |
|---|---|---|
| Clauses | 133 — 9001: 60 · 14001: 33 · 45001: 40 (one row per clause; today's library has 98 rows for 9001 alone) | A full audit fits on one scrollable list; no need for a grid's density |
| Columns | A–M as today **plus** N Evidence Examples · O Audit Cheat Sheet (LOOK FOR / CONFIRM / WATCH FOR) · P Shared Documents + Related Clauses | N and O become collapsible guidance on the row; P drives Documents and relationships |
| Shared documents (P) | 125 named documents; 76 serve all three standards; "Management Review Minutes" alone serves 35 clauses | Organise evidence around documents, not clauses |
| Coverage | 6 documents touch 50% of clauses · 11 → 75% · 16 → 90% · 23 → 100% | A "documents to collect" list replaces "clauses to open" |
| Related clauses (P) | 793 references, 407 unique pairs, none dangling; every 9001 clause links to both a 14001 and a 45001 clause; 150 references are one-way (made two-way on load) | Ship relationships with the library; no per-board "Suggest relationships" |
| Clause numbering | 80 distinct numbers; only 20 identical in all three standards; the link graph forms one 68-clause cluster | Don't merge rows across standards — sort by clause number so equivalents sit side by side, linked by chips |
| Editions | 9001:2026 · 14001:2026 · 45001:2018 + Amd 1:2024 (register's Read Me) | Load these three as the library editions |
| Vocabulary | Register dropdowns: Fully / Partially / Not conforming, To be updated | Export mapping must translate the new five statuses (see Q1) |

---

## 2. Problems → alternatives → recommendation

### P1 · Board navigation
**Today:** 7 tabs — Dashboard, Requirements, Findings, Actions, Action plan, Evidence, Settings (`iso/iso-core.js:292`). Findings, Actions and Action plan are three views of follow-up work; Evidence is a fourth list of the same documents the clauses already show.
**Alternatives:**
- A. Keep 7 tabs, restyle. Cheapest; doesn't reduce choices.
- B. Single page, everything stacked. One view, but very long and slow to scan.
- C. **4 tabs: Overview · Clauses · Documents · Actions**, Settings as ⚙. Each tab answers one question.
**Recommended: C.** Removes 3 tabs. Findings fold into Actions (see P9). Action plan becomes a list/timeline toggle inside Actions. Evidence becomes Documents.

### P2 · The clause grid
**Today:** a 9-column register (`REQ_COL_DEFS`, `iso-core.js:852`), with two-line names, fixed columns and 8 quick-view buttons (`:865`). Most cells read "—", "Unassigned" or "Internal" for most of the audit.
**Alternatives:**
- A. Keep the grid, hide empty columns. Still a spreadsheet, worse than Excel at being one.
- B. Cards in a masonry wall. Pretty, but hard to scan 60 clauses in order.
- C. **Grouped rows:** clause families 4–10 as sections. Each row carries only clause, name, status, documents, related chips and owner, and expands in place.
**Recommended: C.** About 5 visible facts per row instead of 9 columns. Visibility, risk and target date leave the row (risk and date belong to actions). A status filter replaces the quick views: Not assessed · Needs action · Awaiting approval · Returned (the last two are hidden for a sole auditor).

### P3 · Assessing a clause
**Today:** click the row → a 1040px popup opens on its Assessment tab (`openRequirementDrawer`, `:1361`; 6 tabs at `:1411`). It shows 12 fields (`:1442–1453`): State, Result, Applicability, N/A justification, Owner, Target date, Effectiveness, Risk, Current system, Gap, Recommended action, Client-visible comment. You pick State and Result separately, then Save. That's about 8 clicks plus typing, and you lose sight of the list.
**Alternatives:**
- A. Keep the popup, trim it to 5 fields. Fewer fields; still a context switch per clause.
- B. Fully editable grid (Excel clone). Fast for typing; loses evidence and relationships, which are the value.
- C. **Expand in place:** status buttons, Current System, Planned Action, Owner/Due, documents and related clauses inside the row. Everything autosaves.
**Recommended: C.** **2 clicks** (open the row, pick a status) and no save button. The fields are exactly the register's columns D, E, F, J and K, so it is no harder than Excel and nothing new to learn. Comments and history sit behind a "Comments · History" link in the row's footer.
- **Layout of the open clause (review round 3, 2026-10-04):** the requirement, then one status bar, then two columns. The left column is the assessment: Current system, plus Planned action / Owner / Due for Partial, Non-Compliant and OFI. The right column holds evidence and links: the document list and the related-clause chips. The open clause is about a third of the height of the first draft.
- **Audit cheat sheet = an ⓘ right after every clause name** (Column O: Look for / Confirm / Watch for). Hovering shows it on a desktop; a tap or click pins it, which also covers touch and keyboard. It works on collapsed rows, so an auditor can read the guidance without opening the clause.

### P4 · The status model
**Today:** up to 7 status-like fields per clause:
- Assessment state (5 values, `:837`)
- Result (6, `:838`)
- Applicability (3, `:846`)
- Senior verdict (6, `:883`)
- a review verdict on each linked piece of evidence (7, `:2787`)
- Effectiveness (4)
- Risk (4)

The dashboard needs a formula dictionary (`docs/iso-audit/calculation-dictionary.md`) to explain how they combine.
**Alternatives:**
- A. Keep all of them, hide some. The confusion moves; it doesn't go away.
- B. **One status (Not assessed + 5) plus one approval mark** (proposed / approved / returned).
- C. One status and no approval at all. Simplest, but contradicts the Lead Auditor role.
**Recommended: B.**
- **N/A** absorbs Applicability (a reason is still required).
- **Not assessed** replaces assessment state.
- **Effectiveness** folds into the status: Compliant means implemented and effective.
- **Risk** moves to the action's priority.
- The **evidence-link verdict** disappears for staff-added documents: the auditor confirming the link is the review (see P5).

### P5 · Evidence (highest-cost workflow today)
**Today (clause first):** open clause → Evidence tab → "+ Add evidence" → a 15-field modal (`_openAddEvidence`, `:2948`) → save. Then someone sets a verdict on the link (`_evdReviewControlsHtml`, `:3252`). To reuse that document on equivalent clauses, the relationship must first be confirmed per board (P6). Then you open each other clause and confirm the suggestion there (`reqSuggestionsHtml`, `:3276`), and that link needs its own verdict. **One document on 3 equivalent clauses ≈ 25–30 clicks, 3 popups and 2 people.**
**Alternatives:**
- A. Shorten the modal to 3 fields. Saves typing, not the per-clause loop.
- B. Bulk "link existing document to selected clauses" from the grid. Faster, but still clause-first.
- C. **Documents view (document first):** a checklist of the documents the audit needs, from Column P. Add a document once; its clauses (up to 35, across standards) arrive pre-ticked; untick any that don't apply; confirm.
**Recommended: C, plus a 3-field add panel (A) everywhere a document is added.**
- **About 5 clicks** for a document that serves 35 clauses.
- The confirming auditor's tick *is* the acceptance: no verdict step for staff-added documents. Verdicts return only for client-uploaded documents in the portal phase.
- The panel has three fields: document type (typeahead over the 125 names, auto-fills the title), file or link, and revision/date. The other 12 fields go under "More details".
- In a clause row, documents are one compact list, **names only**: ✓ provided (with revision and date), and a dashed ○ for documents the register suggests that aren't provided yet, each with **Add** (and **Generator** where a template exists). Metadata is one click away.
- **Any document, not just the suggested ones** (round 3): "+ Add document" opens one chooser. It shows the suggestions for this clause, documents already provided (this replaces the separate "Link existing" button), a search over all 125 register documents, and, when nothing matches, **"Add “…” as a new document"**. A custom document starts linked to the current clause. The clause's related clauses (Column P) are offered unticked as "may also apply", and any other clause can be added by number or name. The Documents tab has the same chooser as "Add other document". Custom documents are tagged "Custom" and belong to that audit only.
- **The add/edit-document panel works as a clause checklist (round 4):** each clause is one row (checkbox · number · name · current status) with an arrow to open it.
  - Hovering a clause opens its cheat sheet in a card to the **left of the panel**, over the dimmed board: the requirement, Look for / Confirm / Watch for, and the current status. It never covers the list.
  - Opening a clause shows its **status buttons first**, then the requirement and a collapsible cheat sheet. Statuses chosen here are held until save: the button reads "Save links + 2 statuses", and Cancel discards them.
  - The same Lead approval rules apply: an Auditor's statuses arrive as proposed.
  - "Tick all / Untick all" works per standard.
  - **There is no "mark all ticked Compliant"** (see Q7).
- **The Phase 8c document generator stays** and becomes easier to find. A **Generator** button sits on every not-yet-provided document that has a template: in the clause's document list, in the Documents tab, and as "No document yet? Build a generator prompt" in the add-document panel. It opens the same 8c flow: Company Profile completeness, the template's questions, copy or download, no AI. "Upload finished document" closes the loop straight into the add-document panel.
- **Data change this needs:** the 20 templates are keyed today to the *2015 workbook's* clause keys (`supportsRequirements[].stableKey`, e.g. `9001|4.1|d819ea7e|0`). Every one of those keys stops matching once v3 replaces the library. In a document-first design the natural key is the **document name**, so each template gets a `documents: [...]` list of v3 document names instead. 18 of the 20 map cleanly (e.g. Risk and Opportunity Register → "Integrated Risks and Opportunities Register"; Management Review → "Management Review Minutes" and "Management Review Agenda and Input Pack"). Two have no clean match: see **Q5**.

### P6 · Relationships (Column P)
**Today:** relationships are created per board by "Suggest relationships" (`_reqSuggestRelationships`, `:1210`). Each one is confirmed or rejected inside the clause popup's Relationships tab (`reqRelationshipRowHtml`, `:1511`). They are hidden two clicks deep, and the mapping is rebuilt on every board.
**Alternatives:**
- A. Keep per-board suggestions, surface the count. Still a chore before any value appears.
- B. **Library-level relationships from Column P**, present on every board at once.
- C. B, plus auto-applying the status across. Fast, but an auditor must stay in control.
**Recommended: B, with confirmation at the point of use.**
- Every clause row shows its equivalents as chips (Q / E / S, each with its status dot).
- In the expanded row, "**Apply to related**" lists each equivalent with what would change, for example "E 7.1 → Partially Compliant + 2 documents". Untick any; one click applies.
- "Not equivalent here" on a chip hides that link for this board (the reject case).
- The Documents panel is the second home of the same data: one document, all its clauses, all standards.

### P7 · Lead Auditor approval
**Today:** senior review (D32) gives a per-clause verdict through "Review ▾" in the popup header (`reqSeniorHeaderHtml`, `:916`). Separation of duties blocks reviewing your own assessment. Roles are 4 audit roles plus a "Senior reviewer" tick (`:516–518`). That means 133 clauses × about 4 clicks.
**Alternatives:**
- A. Keep per-clause review, rename to Lead. Smallest change; same click count.
- B. **Bulk sign-off per standard or section;** return exceptions with a note.
- C. No approval; the Lead just edits. Fastest, but loses the record of who decided.
**Recommended: B** (your confirmed choice).
- A **"For sign-off"** strip on Overview: "9001 — 24 clauses assessed by J. Smith · Review".
- It opens Clauses filtered to "Awaiting approval", grouped by section, with **Approve section** per group and **Approve all**.
- **Return** on a row asks for a one-line note; the row shows "Returned" to the auditor.
- The Lead's own statuses are approved on entry. **A sole auditor is the Lead, so their statuses are final; no strip, no extra step.**
- Separation of duties gives way to the Lead's authority by your rule. The audit trail records who set and who approved each status.
- "Senior" becomes **Lead Auditor** everywhere.

### P8 · Dashboard
**Today:** header, Needs attention, 9 KPI tiles with a formula section, results summary, findings and actions panels, shared actions, evidence panel, standard cards, clause matrix, recent activity and about 13 charts (`renderDashboardTab`, `:3808`). Valuable, but a long page.
**Alternatives:**
- A. Keep it all and reorder. Same length.
- B. **Overview = 3 blocks:** progress per standard (assessed and status mix), Needs attention (keeps 9.7's list), Documents coverage. Everything else behind "Full dashboard ▸".
- C. Remove the dashboard entirely. Loses the client conversation tool.
**Recommended: B.** Nothing is deleted: KPIs, charts, matrix and activity move under "Full dashboard ▸" (one click). Each Overview number still opens its filtered list.

### P9 · Findings, Actions, Action plan
**Today:** three tabs. A finding is a separate record created from a requirement; actions link to findings or requirements; the action plan is a Gantt.
**Alternatives:**
- A. Keep all three. Most flexible; most to learn.
- B. **Actions only:** a clause marked Non-Compliant, Partially Compliant or OFI *is* the finding. Its Planned Action (with owner and due date) becomes the action automatically. Timeline is a toggle.
- C. B, and also drop the timeline.
**Recommended: B.** The formal finding reference and classification wording are generated when a report needs them (Phase 11). See **Q3**; this is your call because it changes how findings are recorded.

### P10 · Roles
**Today:** Audit manager · Auditor · Contributor · Reviewer (read-only), plus a "Senior reviewer" tick (`:516–518`).
**Recommended:** **Lead Auditor (one per board) · Auditor · Viewer.**
- Contributor merges into Auditor, since any assigned auditor can assess.
- The board creator is Lead by default. Lead is changed in ⚙ Access.
- Audit manager's access rights go to the Lead.

---

## 3. Remove · merge · hide · redesign

| Element (today) | Fate | Where it goes |
|---|---|---|
| Tabs: Dashboard / Requirements / Findings / Actions / Action plan / Evidence / Settings | **Merge** | Overview · Clauses · Documents · Actions · ⚙ |
| Clause popup (6 tabs) | **Remove** for the everyday path | Inline expanding row; a full-page clause view stays reachable by link (for printing/sharing) |
| Assessment form: State, Result, Applicability, Effectiveness | **Merge** | One status (+ N/A reason) |
| Gap description | **Merge** | Into Current System (the register's column D) |
| Recommended action | **Rename** | Planned Action (register column E) |
| Risk severity, Target date on the clause | **Move** | Action priority and due date |
| Client-visible comment | **Hide** | "Share with client" toggle under More (portal phase) |
| Senior review "Review ▾" per clause | **Replace** | Lead bulk sign-off (P7) |
| Senior reviewer tick in Access | **Replace** | Lead Auditor role |
| "Suggest relationships" button; Relationships tab | **Remove** | Library relationships + related chips + Apply to related |
| Evidence tab (board) | **Redesign** | Documents view |
| Add-evidence modal (15 fields) | **Redesign** | 3-field panel + "More details" |
| Per-link evidence verdict (staff-added) | **Remove** | The auditor's confirmation is the review; verdict kept for client uploads later |
| Findings tab | **Merge** | Actions (finding = clause status + planned action) — Q3 |
| Action plan tab | **Merge** | Timeline toggle in Actions |
| Register columns Visibility / Risk / Applicability / Evidence summary | **Remove from the row** | Visibility under More; risk on actions; N/A is a status; documents show as a count |
| 8 quick-view buttons | **Replace** | 4 status filters + search |
| Bulk bar (State/Owner/Date/Visibility/Senior review) | **Simplify** | Bulk: set status · set owner · approve (Lead) |
| Dashboard KPI tiles, charts, matrix, cards, activity | **Hide** | Under "Full dashboard ▸" |
| Needs attention, per-standard progress | **Keep** | Overview |
| Coverage card (shared actions) | **Keep** | Action row detail |
| Comments, Activity | **Hide** | "Comments · History" link in the open clause's footer |
| Guidance cards (Column O display) | **Redesign** | ⓘ after the clause name: hover or tap for the cheat sheet (Look for / Confirm / Watch for) |
| "Link existing" chip | **Merge** | Into "+ Add document" (provided documents are listed first) |
| Long related-clause list (one full row per link) | **Redesign** | Compact chips grouped by standard, with a status dot; Edit mode to reject a link |
| Document generator (Phase 8c: 20 templates, Company Profile completeness, "Download generator prompt") | **Keep, relocate** | Same dialog. A **Generator** button on every missing document with a template (clause list, Documents tab, add-document panel); templates re-keyed from 2015 clause keys to v3 document names (P5, Q5). Nothing from 8c is removed; STOP R2's 20-template approval still applies. |
| Maintenance audit, standards strip, ⚙ Access | **Keep** | Unchanged |

Every new element is **staff-only**. Nothing new is client-visible; clients see shared results through the portal later (Phase 13).

---

## 4. Screen structure

Full mock: [redesign-wireframes.html](redesign-wireframes.html). In outline:

```
┌ ‹ ISO │ AUD-2026-004 · Example Client │ All · Q · E · S │ Overview  Clauses  Documents  Actions │ ⚙ ┐
│ Q 32/60 ▓▓▓▓░░  E 12/33 ▓▓░░░  S 8/40 ▓░░░░        For sign-off: 24 (Lead)          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ CLAUSES  [search]  Not assessed 97 · Needs action 19 · Awaiting approval 22 · Returned │
│ 4  CONTEXT OF THE ORGANIZATION                                            4 of 12    │
│  Q 4.1 Understanding the organisation…   ● Partially Compliant  📄2  E● S○   BC  ✓   │
│  Q 4.2 Needs and expectations…           ▾ expanded ─────────────────────────────── │
│     Requirement text (Etcher wording)            ⓘ on the row = hover cheat sheet    │
│     [ Compliant | Partially Compliant | Non-Compliant | OFI | N/A ]                  │
│     ASSESSMENT                       │ DOCUMENTS 1 of 3            + Add document    │
│     Current system ____________      │ ✓ Interested Parties Register   Rev 4 · 30 Jul │
│     (Planned action ________         │ ○ Legal and Other Req. Reg.  Generator  + Add  │
│      Owner ▾   Due ▾  → the action)  │ RELATED 6      Edit  [Apply to related]        │
│                                      │ E [● 4.2] [○ 6.1.3]   S [● 4.2] [○ 6.1.3]      │
│     ✓ Saved · Set by Sam Taylor · Approved               Comments · History          │
└──────────────────────────────────────────────────────────────────────────────────────┘
DOCUMENTS: list of the 125 document types → provided / not, clauses served (Q E S) → Add → side panel with pre-ticked clauses → Link.
OVERVIEW: three standard cards · Needs attention · Documents coverage · For sign-off · Full dashboard ▸
ACTIONS: one list (status, priority, owner, due, clauses covered) · List | Timeline toggle · Coverage card on open
```

**Responsive:** at 390px the header collapses to the ref and a tab menu. Rows stack (status pill under the name). The Documents side panel becomes a full-screen sheet. Status buttons wrap to two lines with 44px tap targets.

---

## 5. Workflows — before → after

| # | Workflow | Before | After |
|---|---|---|---|
| W1 | Assess one clause | Register → open popup → set State → set Result → type → Save (~8 clicks, popup) | Clauses → click row → click status (2 clicks, autosave) |
| W2 | One document for its clauses | Per clause: popup → Evidence → modal (15 fields) → verdict; repeat per clause (~25–30 clicks for 3 clauses) | Documents → Add on "Management Review Minutes" → drop file → review 35 pre-ticked clauses → Link (~5 clicks for 35 clauses) |
| W3 | Same answer across standards | Confirm relationship per board → open each related clause → set status → add evidence again | Expanded row → Apply to related ▸ → untick any → Apply (2 clicks) |
| W4 | Lead sign-off | Per clause: popup → Review ▾ → verdict (~4 clicks × 133) | Overview "For sign-off" → per section Approve (1 click) → Return exceptions (2 clicks + note each) |
| W5 | Sole auditor | Senior-review step blocked by separation of duties | None: statuses are final on entry |
| W6 | Raise the fix | Popup → Findings and actions → New finding → modal → New action → modal | Set Non-Compliant → type Planned Action + Owner + Due in the same row → action exists |

---

## 6. Data impact (what the developer will touch)

**Library (your answer: v3 only, old seeds archived)**
- New seed files generated from v3: `9001-2026`, `14001-2026`, `45001-2018-a1-2024`. Each row: clause, name, Etcher requirement text, stable key, plus guidance N/O. The current `9001-2026`/`14001-2026` drafts are replaced, not merged.
- **New library data:**
  - the document catalog: 125 document types and the clauses each one serves (from P);
  - library relationships: 407 two-way pairs (the 150 one-way references are made two-way).
- **Archive, don't delete:** the 8 `iso/seed/library/*.json` and 3 `iso/seed/guidance/*.json` move to `iso/seed/archive/`.
- **Local store:** localhost:3001's ISO store is already empty (no boards, no library, no `.iso-offline` folder). Nothing else to wipe there. If your boards live on another server, say where and it gets backed up first.

**Schema (009/010 amended in place, never applied — hard rule)**

`iso_requirements`:
- **Add** `compliance_status` (`not_assessed`, `compliant`, `partially_compliant`, `non_compliant`, `ofi`, `not_applicable`), `approval_state` (`proposed`, `approved`, `returned`), `approved_by`, `approved_at` and `return_note`.
- **Stop writing** (columns kept, nothing dropped) `assessment_state`, `assessment_result`, `applicability`, `effectiveness`, `risk_severity`, `gap_description` and the `senior_review_*` columns.

New tables:
- `iso_document_types`: the library catalog.
- `iso_document_type_clauses`: the catalog's clause map.
- `iso_library_relationships`: Column P's links.

Other changes:
- `iso_evidence.document_type_id`.
- Audit roles: `lead_auditor`, `auditor`, `viewer`. One Lead per board is enforced on the server.

**Calculations:** `api/_isoCalc.js` moves to the single status, and the dictionary is rewritten (conformance = Compliant ÷ applicable). Dashboard filters follow.

**Export (Phase 10.2):** v3's 16-column, three-register layout is the better export template; see **Q2**.

**Tests:** every ISO suite that asserts state/result/applicability/senior review changes. New suites cover the Documents flow, Apply to related, and Lead sign-off. The gate is green before each stage closes.

**Templates (round 3):** add `documents: [...]` (v3 document names) to each of the 20 `iso/seed/prompt-templates/*.json`. Keep `supportsRequirements` for history; the server's `promptTemplate.list` serves documents instead of stable keys. The edit to each file is a reviewed edit, so it is done alongside STOP R2's approvals.
**Custom documents:** an evidence record whose document type isn't in the library catalogue. It stores its name and its clause links on that audit only, and the shared library is never changed.

**Hard to reverse:** nothing is destroyed. Seeds are archived, retired columns are kept, and no live data exists (the store is empty). The D32 senior-review verdicts disappear from the UI; there are none stored to lose.

**Build order (each stage gated):**
1. R1 library swap (v3 seeds, document catalog, library relationships).
2. R2 status model + Lead Auditor + roles.
3. R3 Clauses view (rows, expand, Apply to related).
4. R4 Documents view.
5. R5 Overview + Full dashboard.
6. R6 Actions merge + tab structure.

---

## 7. Open questions (yours to decide — recommendation first)

| # | Question | Recommendation |
|---|---|---|
| Q1 | How does **OFI** export to the register's vocabulary (Fully / Partially / Not conforming)? | **Fully conforming**, with "OFI:" prefixed to Current System. An OFI means the requirement is met with room to improve. |
| Q2 | Should the Phase 10 export use **v3's layout** (one workbook: Read Me, three registers A–P, Sources) instead of the 13-column single-standard template built in 10.1? | **Yes, v3 layout.** It is the newer Etcher register and matches this redesign. 10.1's zip/allowlist tooling carries over; the template is rebuilt from v3. |
| Q3 | Drop separate **Findings** records (the clause status + Planned Action *is* the finding)? | **Yes.** Generate finding references and classification only when a report needs them (Phase 11). |
| Q4 | Treat the auditor's confirmation as **evidence acceptance** (no separate verdict) for staff-added documents? | **Yes.** Keep verdicts for client-uploaded documents when the portal arrives. |
| Q5 | Two templates have no clean v3 document: **Corrective Action Form** and **Training and Induction Record**. Where should they show? | Corrective Action Form → "Corrective Action Register" (alongside the Nonconformity Register template, so that document offers two); Training and Induction Record → "Communication and Training Records". Or retire both if Etcher no longer uses them. |
| Q6 | Should a custom document an auditor adds become a suggestion on **other** audits (i.e. added to the shared library)? | **No.** It stays on that audit. Adding to the library goes through the existing reviewed library edit (ISO library page), so the shared list stays curated. |
| Q7 | Should the document panel offer **"mark all ticked clauses Compliant"** in one click? | **No.** One document rarely proves a whole clause on its own, and a one-click stamp across 35 clauses undercuts the audit. Statuses stay a deliberate per-clause choice: open the clause and pick. That is still far fewer clicks than today because the panel stays open. |
