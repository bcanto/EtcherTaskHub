#!/usr/bin/env bash
# Full regression gate.
# Suites print "PASS (n):" / "FAIL (n):" — parse that, nothing else. An earlier version of
# this script looked for "pass=n fail=n", which no suite prints, so every suite silently
# scored zero and the whole gate reported TOTAL: 0 FAILURES: 0 — green, and meaningless.
# A suite reporting 0 passes has flaked (Puppeteer detached Frame when many browsers run
# back to back) rather than passed, so a zero-pass run is retried once before it counts,
# and a suite that prints no summary at all is named rather than counted as zero.
cd "$(dirname "$0")/.."
# These suites log in and delete boards/tasks. With a .env present the dev server talks to the
# LIVE Supabase project, so refuse to run unless it was started with `node serve.mjs --offline`.
_cfg=$(curl -s http://localhost:3001/api/config)
if ! printf '%s' "$_cfg" | grep -q '"supabaseUrl":""'; then
  echo "ABORT: dev server is connected to a live Supabase project ($_cfg)."
  echo "Restart it offline first:  node serve.mjs --offline"
  exit 1
fi
SUITES="mt-phase1-test mt-phase2-test mt-phase3-test mt-phase4-test mt-phase5-test
mt-colresize-test mt-complete-hours-test subitem-rollup-test timeline-range-test board-client-test
tp-tab-sticky-test tp-regress md-paste-test notes-test notes-align-test notes-access
session-test scroll-test board-delete-test pf-import-test four-fixes-test
client-title-test session-audit mn-copy-test audit-access audit-portal personal-boards-test
gantt-sticky-test three-asks-test meetings-test meetings2-test layout-test file-preview-test realtime-typing-test timeline-popover-test tp-rollup-test timeline-calendar-test date-typing-test dblclick-day-test excel-export-test merge-test mobile-shell-test action-requests-test portal-logic-test audit-fixes-test portal-design-test notif-test mcp-logic-test comms-notes-test comment-reply-test boot-skeleton-test triage-route-test serve-security-test mt-golden-test mt-adapter-test gantt-adapter-test iso-store-test iso-logic-test iso-api-test iso-security-test iso-dbsb-unit-test iso-import-test iso-ui-test billing-perm-test iso-time-test iso-gantt-pdf-test iso-evidence-test iso-library-seed-test iso-evidence-review-test iso-prompt-test iso-upload-test iso-calc-test iso-dashboard-test iso-review-test iso-maintenance-test iso-relationship-test iso-document-test iso-boardshell-test iso-approval-ui-test iso-landing-test iso-conclusions-test iso-closure-test iso-history-test iso-export-test iso-zip-test eol-guard-test"
TP=0; TF=0; BAD=""
num(){ printf '%s' "$1" | grep -oE "^$2 \([0-9]+\)" | grep -oE '[0-9]+' | tail -1; }
for s in $SUITES; do
  out=$(node ".agents/$s.cjs" 2>&1)
  pa=$(num "$out" PASS); fa=$(num "$out" FAIL)
  if [ -z "$pa" ] || [ "$pa" = "0" ]; then
    out=$(node ".agents/$s.cjs" 2>&1)
    pa=$(num "$out" PASS); fa=$(num "$out" FAIL)
  fi
  if [ -z "$pa" ]; then
    printf '%-22s NO SUMMARY LINE — the suite did not report\n' "$s"
    BAD="$BAD $s"; continue
  fi
  fa=${fa:-0}
  TP=$((TP+pa)); TF=$((TF+fa))
  printf '%-22s pass=%-4s fail=%s\n' "$s" "$pa" "$fa"
  if [ "$fa" != "0" ]; then
    printf '%s' "$out" | sed -n '/^FAIL (/,/^ERRORS/p' | head -8
  fi
done
echo "TOTAL: $TP  FAILURES: $TF"
[ -n "$BAD" ] && echo "SUITES THAT DID NOT REPORT:$BAD"
exit 0
