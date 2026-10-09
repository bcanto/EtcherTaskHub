# Handover — ISO release-1 build (written 2026-10-08)

**For:** the next Claude Code session (any account) continuing the build. Read this first, then
`docs/iso-audit/release-1-completion-plan.md` (the approved build plan, D44–D56) and the
`⏸ RESUME HERE` block of `docs/iso-audit-integration-plan.md` (hard rules in its §1 still apply:
offline only, no SQL, never push/deploy without the user, CRLF in `index.html`, no AI in the app,
`data-*` not inline user text, every new test proven able to fail, clean full gate per batch).

## Where things stand

| Batch | State |
|---|---|
| B0 build tooling | **Done and committed** (`b7299d8` on local branch `iso-release-1`, never pushed) |
| B1 defensible conclusions | **Built, tested, NOT committed yet** — finish the steps below |
| B2 → B7 | Not started — follow the plan's §3 in order (B6 can run in parallel) |

Branch: `iso-release-1` (local only). Commits on this branch are allowed at batch close (D55);
**pushing or deploying needs the user's explicit OK.**

## Finish B1 (in this order)

1. **Make sure no file was left half-mutated.** A can-fail run (`_canfail.cjs`) was running when the
   account was switched; it deliberately breaks a file, runs a test, then restores it. If the process
   was killed mid-run, a file may still hold a break. Check:
   ```bash
   md5sum api/_iso.js api/_isoCalc.js iso/iso-core.js
   ```
   Expected (the correct B1 versions):
   ```
   2ca2313f7bcd1b0216d6ce0481b23bd6  api/_iso.js
   bf0e422801fc37c6b0225638d60a73bb  api/_isoCalc.js
   6103df3d2fa8d519726a79b401ebe8c7  iso/iso-core.js
   ```
   If one differs, the original bytes are in the temp folder as `canfail-<timestamp>-<file name>`
   (`ls -t "$TMP"/canfail-*` or `%TEMP%\canfail-*`) — copy it back over the file, then re-check the md5.
   The breaks are listed in `.agents/_mut-b1.cjs` (each `find` → `replace`), so a mutated line is easy to spot.
2. **Can-fail (rerun to be sure):** `node .agents/_canfail.cjs .agents/_mut-b1.cjs --green`
   (11 breaks against `iso-conclusions-test`; all must say ✓ and the clean re-run must be FAIL 0).
   **Already done 2026-10-08:** all 11 caught, every file restored byte-identical (md5 verified), clean re-run 59/0 — skip this step unless step 1 found a changed file.
3. **Dev server must be offline:** `curl -s localhost:3001/api/config` must show `"supabaseUrl":""`;
   if not, start it with `node serve.mjs --offline` (never without `--offline`).
4. **One visual round:** `node .agents/iso-shots.cjs b1` → look at `.agents/shots/b1-clauses-open.png`,
   `b1-doc-add.png`, `b1-overview.png` (desktop) and the `-390` phone versions. It reports overflow itself.
5. **Full gate once:** `bash .agents/gate.sh` (about 20 min). Known flake: `mt-golden-test` failing only on
   `nav.html` under gate load — rerun `node .agents/mt-golden-test.cjs` alone; 390/0 alone = accept and note it.
6. **Bookkeeping:** in the integration plan's Progress Log, the B1 row ends with "Can-fail: `_mut-b1.cjs`
   (11 breaks) — see the gate line below." Replace that with: "Can-fail: `_mut-b1.cjs` 11/11 caught (each 1–4 failures), restored byte-identical, clean re-run 59/0." plus the gate total.
7. **Commit B1** on `iso-release-1` (do not push):
   ```bash
   git add api/_iso.js api/_isoCalc.js iso/iso-core.js iso/iso.css supabase/migrations/009_iso_core.sql \
     supabase/migrations/010_iso_evidence.sql .agents/iso-conclusions-test.cjs .agents/_mut-b1.cjs \
     .agents/iso-approval-ui-test.cjs .agents/iso-landing-test.cjs .agents/iso-maintenance-test.cjs \
     .agents/iso-relationship-test.cjs .agents/iso-review-test.cjs .agents/iso-ui-test.cjs \
     docs/iso-audit-integration-plan.md docs/iso-audit/HANDOVER.md
   git commit -m "Release-1 B1: defensible conclusions (D44-D48)"
   ```
   (Also add `.agents/iso-conclusions-test` to `SUITES` in `.agents/gate.sh` before the gate in step 5 —
   it is **not in the gate yet**. Add it next to `iso-landing-test`.)

## What B1 changed (so you can review quickly)
Full detail: the 2026-10-08 "Release-1 B1" Progress Log row. In short: OFI is a flag on Compliant /
Partial; "Outside this audit's scope" status; a basis (Current system) + gap reason are required before
approval and board close; Apply to related proposes (derived → Confirm); risk-sorted Awaiting approval with
reasons; consistency warning; staff sufficiency flag; interview/observation/sample notes; status per clause
in the add-document form. Two new ops: `requirement.confirmDerived`, `evidence.setSufficiency`.

## Then B2 (next batch)
Plan §3 "B2 — Findings and actions that close properly": Track this action (`action.trackPlan`, finding on
formal audit types only — D49), closure rule (finding closes only when its actions are verified effective —
D50), Lead-only reopen, repeat findings, and `audit.startMaintenance` must also allow `lead_auditor`.
New suite `iso-closure-test` on `.agents/_iso-harness.cjs` (port 3166 is free), a `_mut-b2.cjs` list,
lanes `api` + `board` + `lifecycle` while building, full gate once at the end, then commit.

## Tooling (from B0)
- New suites: `const H = require('./_iso-harness.cjs'); H.run(name, port, async (t, srv) => { … })`
- Fast lanes: `bash .agents/lane.sh api` (≈10 s), `board`, `evidence`, `lifecycle`, or suite names.
- Prove tests can fail: `node .agents/_canfail.cjs .agents/_mut-<batch>.cjs --green`.
- Screens: `node .agents/iso-shots.cjs <label>`.
- Write regex-bearing edits with a Node script or the Edit tool, never a shell heredoc into a JS string
  (a literal newline in a JS string broke a mutation file once already).
