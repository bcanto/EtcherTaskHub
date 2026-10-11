# Handover — ISO release-1 build (updated 2026-10-11)

**For:** the next Claude Code session (any account). Read this first, then
`docs/iso-audit/release-1-completion-plan.md` (the approved plan, D44–D56) and the `⏸ RESUME HERE`
block of `docs/iso-audit-integration-plan.md`. Hard rules in its §1 still apply: offline only
(`node serve.mjs --offline`), no SQL anywhere, never push or deploy without the user, `index.html` stays
CRLF, no AI in the app, `data-*` never inline user text, every new test proven able to fail, a clean full
gate per batch.

## Where things stand

| Batch | State | Commit (local branch `iso-release-1`, never pushed) |
|---|---|---|
| B0 build tooling | Done | `b7299d8` |
| B1 defensible conclusions | Done | `eb5837f` |
| B2 findings and actions that close | Done | `e57bb83` |
| B3 history + gap-analysis Excel export | Done — **STOP 2b waiting on the user** | `3a291c1` |
| B6 go-live code | Done — **the user's steps in `docs/iso-audit/go-live-checklist.md`** | `e538690` |
| B4 follow-ups and programme | Done (built ahead of the pilot) | `3c924e5` |
| B5 notifications and reports | Done (built ahead of the pilot) | see `git log` |
| Pilot | Waiting on STOP 2b + the checklist | — |
| B7 client portal ISO tab | Not started — **after the pilot by plan** | — |

## What the user has to do next
1. **STOP 2b:** open the three exported workbooks in Excel and compare with the template —
   regenerate them with `node .agents/iso-export-test.cjs`; they land in `.agents/shots/`
   (`<REF>_ISO9001|14001|45001_Gap_Analysis.xlsx`).
2. Fill in the v3 manifest's transition dates and technical reviewer (`iso/seed/releases/v3/manifest.json`)
   — left null on purpose, nothing invented.
3. The go-live checklist (Supabase dev project + migrations 009/010/014/015/011, Microsoft Entra app,
   operations, go-live order).
4. Say "commit and push" when ready — the branch is local only.

## Open items recorded in the plan
- The Supabase adapter's `insertNumbered` passes only each create RPC's fixed columns (statement /
  criteria / refs on findings, owner / due / priority on actions are not written on Supabase) — fix before
  the first Supabase apply.
- "Attach a copy" of a SharePoint document (B3.3, optional) not built.
- Report PDFs are downloaded, not uploaded to storage (release-1 simplification of §5.5).

## Tooling
- New suites: `const H = require('./_iso-harness.cjs'); H.run(name, port, async (t, srv) => { … })`;
  `H.startOffline(port, {dir, env})` for multi-server tests.
- Lanes: `bash .agents/lane.sh api|board|evidence|lifecycle`. Full gate: `bash .agents/gate.sh` (~60–70 min
  now; known flake: `mt-golden-test` under load — rerun alone, 390/0 = accept).
- Can-fail: `node .agents/_canfail.cjs .agents/_mut-<batch>.cjs --green` (b1–b6 lists exist).
- Write multi-line or regex-bearing edits with the Write tool or a script file — shell heredocs and
  `node -e` quoting have mangled edits several times this release.
- Ports used by suites: 3165–3173 (conclusions, closure, history, history-releases 3168/3169, export 3170,
  a11y 3171, programme 3172, report 3173).
