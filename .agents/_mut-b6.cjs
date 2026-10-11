// Can-fail mutations for release-1 batch B6 (node .agents/_canfail.cjs .agents/_mut-b6.cjs --green).
module.exports = [
  { id: 'b6-header-drift', suite: 'serve-security-test', file: 'security-headers.cjs', note: 'local headers drift from vercel.json',
    find: "'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',", replace: "'Strict-Transport-Security': 'max-age=60',", },
  { id: 'b6-sri', suite: 'serve-security-test', file: 'index.html', note: 'supabase-js loads without an integrity hash',
    find: '<script src="vendor/supabase-js-2.117.3.umd.js" integrity="', replace: '<script src="vendor/supabase-js-2.117.3.umd.js" data-integrity="' },
  { id: 'b6-ms-provider', suite: 'iso-a11y-test', file: 'index.html', note: 'Microsoft sign-in uses the wrong provider',
    find: "signInWithOAuth({provider:'azure',", replace: "signInWithOAuth({provider:'google'," },
  { id: 'b6-ms-always', suite: 'iso-a11y-test', file: 'index.html', note: 'the Microsoft button shows even when switched off',
    find: "b.style.display=(window._microsoftSignIn&&window._supabase)?'':'none';", replace: "b.style.display='';" },
  { id: 'b6-share-expiry', suite: 'portal-logic-test', file: 'api/_portal.js', note: 'expired share links still work',
    find: '  if (!link || shareLinkExpired(link, now)) return null;', replace: '  if (!link) return null;' },
  { id: 'b6-rls', suite: 'iso-migrations-test', file: 'supabase/migrations/015_iso_history.sql', note: 'the snapshot table is left without row level security',
    find: 'alter table iso_audit_snapshots enable row level security;\n', replace: '' },
  { id: 'b6-a11y-label', suite: 'iso-a11y-test', file: 'iso/iso-core.js', note: 'the board settings button loses its accessible name',
    find: 'class="iso-icon-btn${activeTab === \'settings\' ? \' is-on\' : \'\'}" aria-label="Board settings" title="Settings — details, access, maintenance"', replace: 'class="iso-icon-btn${activeTab === \'settings\' ? \' is-on\' : \'\'}"' },
];
