// Can-fail mutations for the branded report PDF (node .agents/_canfail.cjs .agents/_mut-reppdf.cjs --green).
const S = 'iso-report-test';
module.exports = [
  { id: 'reppdf-offline-names', suite: S, file: 'api/iso.js', note: 'offline reports carry uids instead of names again',
    find: "return OFFLINE_STAFF_NAMES[String(uid).replace(/^offline:/, '')] || null;", replace: 'return OFFLINE_STAFF_NAMES[uid] || null;' },
  { id: 'reppdf-no-page-logo', suite: S, file: 'iso/iso-core.js', note: 'body pages lose the Etcher logo',
    find: "      if (logoNavy) doc.addImage(logoNavy.data, 'PNG', M - 4, 18, 76, 76 * logoNavy.ratio, logoNavy.alias, 'FAST');", replace: '' },
  { id: 'reppdf-logo-per-page', suite: S, file: 'iso/iso-core.js', note: 'the logo is stored again on every page (file bloats)',
    find: "76 * logoNavy.ratio, logoNavy.alias, 'FAST');", replace: "76 * logoNavy.ratio, 'pg' + p, 'FAST');" },
  { id: 'reppdf-no-signoff', suite: S, file: 'iso/iso-core.js', note: 'the sign-off section is dropped',
    find: "    section('Sign-off', 210);", replace: "    section('Signatures', 210);" },
];
