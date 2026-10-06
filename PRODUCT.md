# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Etcher Solutions staff** (Perth, Western Australia): consultants, project managers and admins running client work in Task Hub every day — workboards, timesheets, approvals, client communications.
- **Etcher auditors** in the ISO Audit module: they run gap analyses and internal/maintenance audits for Etcher's clients against ISO 9001, ISO 14001 and ISO 45001. Auditors are the only people working inside an ISO board (confirmed 2026-10-04).
- **Clients**: see what Etcher shares with them through the client portal. For ISO, clients only see shared results and actions later via the portal (planned, Phase 13); they do not work in the board.

## Product Purpose

Task Hub is Etcher's operations control surface: one place for client work, time, approvals and communication.

The ISO Audit module lets Etcher auditors assess a client's management system against one or more ISO standards, collect the evidence that proves each requirement, track the actions that close the gaps, and hand the client a clear result. Success: an audit is finished faster and more consistently than in the spreadsheet it replaces, and one piece of evidence is never collected twice.

## Positioning

The ISO module competes with Excel, not with other audit software. Its advantage, in priority order:

1. **Shared evidence** — one document proves many clauses.
2. **Clause relationships** — each requirement knows its equivalents (the reference register's Column P).
3. **Cross-standard compliance mapping** — ISO 9001, 14001 and 45001 answered together.

These outrank clause management, dashboards, metrics, forms and approval workflows.

## Operating Context

- Reference register: `Etcher_Solutions_ISO_Audit_Registers_Editable_v3.xlsx` (repo root) — Etcher's client-neutral working register: one sheet per standard, columns Clause, Clause Name, Requirement, Current System, Planned Action, Compliance Status, Original Status, Work Status, Priority, Owner, Due Date, Progress, Linked Actions, Evidence Examples, Context / Audit Cheat Sheet (LOOK FOR / CONFIRM / WATCH FOR), Cross-Standard Links / Shared Documents (Column P).
- Editions in use (per the register's Read Me): ISO 9001:2026, ISO 14001:2026, ISO 45001:2018 with Amendment 1:2024.
- Requirement text is Etcher's own plain-language wording, not the licensed standard; formal audits verify against the client's authorised copy.
- Western Australian context: WA Work Health and Safety Act 2020 and its regulation sets; WA environmental legislation (DWER).

## Capabilities and Constraints

- Single-page web app (`index.html`) with the ISO module in `iso/` and a Node API in `api/`; Supabase in production, an offline JSON store for local work and tests.
- ISO roles: the Lead Auditor holds final authority over compliance status and the audit outcome; any assigned auditor can assess. A sole auditor is automatically the Lead Auditor (confirmed 2026-10-04).
- Clause statuses (2026-10-04): Compliant, Partially Compliant, Non-Compliant, Opportunity for Improvement, Not Applicable.
- Lead Auditor approval is one sign-off per audit or clause section, not per clause (confirmed 2026-10-04).
- Client-visible vs staff-only is a hard boundary on every record.
- No AI service inside the app.
- Opportunity for Improvement exports as Fully conforming, with "OFI:" prefixed to Current System (D36).
- The board redesign is approved (D35–D41): 4 tabs, one status per clause, inline-expanding rows, library-shipped relationships, document-first evidence, Lead Auditor bulk sign-off. See `docs/iso-audit/redesign-proposal.md`. Build status: R1 (library swap), R2 (status model, Lead Auditor role, approval workflow), R3 (Clauses view — Column O cheat sheet, Column P relationships, apply-to-related, inline-expanding rows grouped by shared clause family across standards) and R4's data layer (document catalog, bulk evidence linking, prompt templates re-keyed to document names) done. R5's Overview tab (sign-off banner, progress band, Needs attention, Collect next) is done, landing page for every board now — the old full dashboard stays exactly as it was, one click away behind "Full dashboard". The board now matches the approved wireframe: one card with Overview · Clauses · Documents · Actions; the Documents tab (R4b: Key documents, add once / edit links, custom documents, Generator) and the Actions tab (R6: planned actions on Partial/Non-Compliant/OFI clauses, shared across clauses, List/Timeline) are built. Edit links can also take a document off a clause, after a warning (soft removal, kept in history). Not yet: per-row status buttons in the add-document sheet, a shared library of custom documents.

## Brand Commitments

- Name: Etcher Solutions; product: Task Hub.
- Footer convention on exports: "Etcher Solutions · ISO <code> Gap Analysis".

## Evidence on Hand

- The v3 register (133 clauses: 60 / 33 / 40) with 125 named shared documents and 793 cross-standard clause links in Column P.
- `Etcher_ISO9001_Gap_Analysis.xlsx` — an earlier single-standard register (repo root) and the sanitised export template built from it (`iso/templates/gap-analysis-template.xlsx`).
- No customer testimonials, benchmarks or published case studies exist; never fabricate them.

## Product Principles

1. **Beat the spreadsheet or don't ship it.** If an auditor would finish faster in Excel, simplify: fewer steps, fields, approvals and screens.
2. **Evidence first, clauses second.** Document → suggested clauses → auditor confirmation; never clause → upload → repeat.
3. **Relationships are the product.** Cross-standard links and shared documents are a primary workflow, never a hidden data point.
4. **Challenge every element.** Anything needing training, documentation, several screens or many clicks is redesigned or removed.
5. **Keep the intelligence, hide the machinery.** Calculations, separation of duties, visibility rules and audit trails stay — behind progressive disclosure, not on every screen.
