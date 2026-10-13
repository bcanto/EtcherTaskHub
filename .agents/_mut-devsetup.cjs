// Can-fail mutations for the combined dev-setup guard (node .agents/_canfail.cjs .agents/_mut-devsetup.cjs --green).
const S = 'iso-migrations-test';
module.exports = [
  { id: 'devsetup-stale-source', suite: S, file: 'supabase/migrations/011_iso_reports.sql', note: 'a draft changes after the combined copy was built',
    find: '-- Etcher Task Hub — ISO formal reports', replace: '-- Etcher Task Hub — ISO formal reports (edited)' },
  { id: 'devsetup-missing-draft', suite: S, file: 'supabase/dev/combined-dev-setup.sql', note: 'the combined copy leaves out a draft (015)',
    find: '--   supabase/migrations/015_iso_history.sql    28a7bbb16b1df693\n', replace: '' },
  { id: 'devsetup-no-bootstrap', suite: S, file: 'supabase/dev/combined-dev-setup.sql', note: 'the combined copy leaves out the dev bootstrap',
    find: '--   supabase/dev/000_dev_bootstrap.sql ', replace: '--   (bootstrap omitted) ' },
];
