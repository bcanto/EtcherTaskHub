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
# The user's real ISO store must come out of a gate run byte-identical: suites never touch .iso-offline.
# (notif-test dismissed the user's ISO notifications through :3001 on every run until 2026-10-15.)
_isofp(){ if [ -d .iso-offline ]; then find .iso-offline -type f -exec sha256sum {} + 2>/dev/null | sort -k2 | sha256sum | cut -c1-16; else echo none; fi; }
ISOFP_BEFORE=$(_isofp)
SUITES="mt-phase1-test mt-phase2-test mt-phase3-test mt-phase4-test mt-phase5-test
mt-colresize-test mt-complete-hours-test subitem-rollup-test timeline-range-test board-client-test
tp-tab-sticky-test tp-regress md-paste-test notes-test notes-align-test notes-access
session-test scroll-test board-delete-test pf-import-test four-fixes-test
client-title-test session-audit mn-copy-test audit-access audit-portal personal-boards-test progress-hours-test client-add-test notif-jump-test crit-c1-sync-test crit-c2-staff-access-test crit-c3-passwords-test crit-c4-injection-test
gantt-sticky-test three-asks-test meetings-test meetings2-test layout-test file-preview-test realtime-typing-test timeline-popover-test tp-rollup-test timeline-calendar-test date-typing-test dblclick-day-test excel-export-test merge-test mobile-shell-test action-requests-test portal-logic-test audit-fixes-test portal-design-test notif-test mcp-logic-test comms-notes-test comment-reply-test boot-skeleton-test triage-route-test serve-security-test mt-golden-test mt-adapter-test gantt-adapter-test billing-perm-test retained-test retained2-test retained3-test retained4-test retained5-test retained6-test retained7-test retained8-test retained9-test retained10-test retained11-test mt-cols-test retained12-test retained13-test retained14-test retained15-test portal-filters-test client-preview-login-test portal-look-test eol-guard-test
high-h11-email-test high-h1-roles-test high-h1-billing-test high-h7-alert-layer-test high-h4-hours-test high-h6-duplicate-board-test high-h6-retainer-test high-h5-recurring-test high-h2-merge-test high-h3-labels-test high-h9-performance-test high-h10-comms-files-test
high-h8-audit-test
med-a-test med-b-test wb-colours-test low-test
sec-a-test sec-b-test sec-c-test sec-d-test
m5-upsert-profile-test
portal-audit-test
no-iso-test"
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
ISOFP_AFTER=$(_isofp)
if [ "$ISOFP_BEFORE" != "$ISOFP_AFTER" ]; then
  echo "ISO STORE CHANGED during the gate ($ISOFP_BEFORE to $ISOFP_AFTER): a suite wrote to the real .iso-offline, or the app was used while it ran. Counted as a failure."
  TF=$((TF+1))
fi
echo "TOTAL: $TP  FAILURES: $TF"
[ -n "$BAD" ] && echo "SUITES THAT DID NOT REPORT:$BAD"
exit 0
