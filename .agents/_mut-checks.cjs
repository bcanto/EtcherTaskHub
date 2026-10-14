// Can-fail mutations for the CONFIRM tick boxes (node .agents/_canfail.cjs .agents/_mut-checks.cjs --green).
const S = 'iso-conclusions-test';
module.exports = [
  { id: 'checks-no-safeguard', suite: S, file: 'api/_iso.js', note: 'ticked checks alone count as a basis on the server',
    find: "  if (cs !== 'not_applicable' && !IsoChecks.hasOwnText(r.current_system, confirmItemsFor(r))) return 'Basis missing — the ticked checks are in; add what you saw.';\n", replace: '' },
  { id: 'checks-drop-own-text', suite: S, file: 'iso/iso-checks.js', note: 'a tick wipes what the auditor typed',
    find: "return head ? head + (rest ? '\\n' + rest : '\\n') : rest;", replace: "return head ? head + '\\n' : '';" },
  { id: 'checks-no-readback', suite: S, file: 'iso/iso-checks.js', note: 'the boxes are not read back from the sentence',
    find: "      if (sentence(sub) === line) return", replace: "      if (false) return" },
  { id: 'checks-not-shown', suite: S, file: 'iso/iso-core.js', note: 'the tick boxes are not shown under Assessment',
    find: '      ${reqChecksHtml(row)}\n', replace: '' },
];
