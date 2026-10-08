#!/usr/bin/env bash
# Fast lanes (release-1 plan B0.4): run only the suites a batch touches while building, then the
# full gate (.agents/gate.sh) once at batch close. Same parsing and zero-pass retry as gate.sh.
#   bash .agents/lane.sh api                     one lane
#   bash .agents/lane.sh api board               several lanes
#   bash .agents/lane.sh api iso-conclusions-test   lanes and/or individual suite names
cd "$(dirname "$0")/.."
declare -A LANES=(
  [api]="iso-store-test iso-logic-test iso-api-test iso-security-test iso-dbsb-unit-test iso-import-test iso-calc-test iso-document-test iso-relationship-test iso-export-test iso-zip-test"
  [board]="iso-boardshell-test iso-approval-ui-test iso-review-test iso-dashboard-test iso-landing-test"
  [evidence]="iso-evidence-test iso-evidence-review-test iso-upload-test iso-prompt-test iso-library-seed-test"
  [lifecycle]="iso-maintenance-test iso-time-test iso-gantt-pdf-test iso-ui-test"
)
if [ $# -eq 0 ]; then echo "usage: bash .agents/lane.sh <lane|suite>...   lanes: ${!LANES[*]}"; exit 2; fi
SUITES=""
for a in "$@"; do
  if [ -n "${LANES[$a]+x}" ]; then SUITES="$SUITES ${LANES[$a]}"
  elif [ -f ".agents/$a.cjs" ]; then SUITES="$SUITES $a"
  else echo "unknown lane or suite: $a"; exit 2; fi
done
# Suites that use the shared :3001 dev server must never meet the live database (hard rule 1).
_cfg=$(curl -s http://localhost:3001/api/config)
if [ -n "$_cfg" ] && ! printf '%s' "$_cfg" | grep -q '"supabaseUrl":""'; then
  echo "ABORT: the :3001 dev server is connected to a live Supabase project. Restart it: node serve.mjs --offline"; exit 1
fi
TP=0; TF=0; BAD=""; START=$(date +%s)
num(){ printf '%s' "$1" | grep -oE "^$2 \([0-9]+\)" | grep -oE '[0-9]+' | tail -1; }
for s in $SUITES; do
  out=$(node ".agents/$s.cjs" 2>&1)
  pa=$(num "$out" PASS); fa=$(num "$out" FAIL)
  if [ -z "$pa" ] || [ "$pa" = "0" ]; then out=$(node ".agents/$s.cjs" 2>&1); pa=$(num "$out" PASS); fa=$(num "$out" FAIL); fi
  if [ -z "$pa" ]; then printf '%-26s NO SUMMARY LINE\n' "$s"; BAD="$BAD $s"; continue; fi
  fa=${fa:-0}; TP=$((TP+pa)); TF=$((TF+fa))
  printf '%-26s pass=%-4s fail=%s\n' "$s" "$pa" "$fa"
  [ "$fa" != "0" ] && printf '%s' "$out" | sed -n '/^FAIL (/,/^ERRORS/p' | head -8
done
echo "LANE TOTAL: $TP  FAILURES: $TF  ($(( $(date +%s) - START ))s)"
[ -n "$BAD" ] && echo "SUITES THAT DID NOT REPORT:$BAD"
exit 0
