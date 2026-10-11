// Release-1 B6.5 (static): the draft ISO migrations are ready to apply — every iso_* table any of them
// creates has row level security enabled and anon/authenticated revoked (service role only), every
// iso_* function is locked down the same way, and every file says it was written, never applied.
// Reads the .sql files only; never connects to a database (hard rule 1).
const fs = require('fs');
const path = require('path');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(DIR).filter(f => /^\d{3}_iso_.*\.sql$/.test(f)).sort();
ok(files.length >= 4, `the ISO drafts are present (${files.join(', ')})`);
const all = files.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
const sqlOnly = all.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const tables = [...new Set([...sqlOnly.matchAll(/create table if not exists (iso_\w+)/g)].map(m => m[1]))];
ok(tables.length >= 25, `iso tables found: ${tables.length}`);
// RLS + revoke: either named directly, or inside a loop's array literal.
const rlsNamed = new Set([...sqlOnly.matchAll(/alter table (iso_\w+) enable row level security/g)].map(m => m[1]));
const revokeNamed = new Set([...sqlOnly.matchAll(/revoke all on table (iso_\w+) from anon, authenticated/g)].map(m => m[1]));
const loops = [...sqlOnly.matchAll(/select unnest\(array\[([\s\S]*?)\]\)\s*loop([\s\S]*?)end loop/g)];
for (const [, list, body] of loops) {
  const names = [...list.matchAll(/'(iso_\w+)'/g)].map(m => m[1]);
  if (/enable row level security/.test(body)) names.forEach(n => rlsNamed.add(n));
  if (/revoke all on table %I from anon, authenticated/.test(body)) names.forEach(n => revokeNamed.add(n));
}
const noRls = tables.filter(t => !rlsNamed.has(t)), noRevoke = tables.filter(t => !revokeNamed.has(t));
ok(noRls.length === 0, `every iso table enables row level security (missing: ${noRls.join(', ') || 'none'})`);
ok(noRevoke.length === 0, `every iso table revokes anon/authenticated (missing: ${noRevoke.join(', ') || 'none'})`);
ok(!/create policy/i.test(sqlOnly), 'no RLS policy grants browser access (zero policies — the server is the only door)');

const fns = [...new Set([...sqlOnly.matchAll(/create or replace function (iso_\w+)\s*\(/g)].map(m => m[1]))];
const lockedText = sqlOnly;
const unlocked = fns.filter(fn => !new RegExp(`revoke execute on function ${fn}\\b|'${fn}\\(`).test(lockedText));
ok(fns.length >= 20 && unlocked.length === 0, `every iso function is locked to the service role (${fns.length} functions; not locked: ${unlocked.join(', ') || 'none'})`);
for (const f of files) {
  const head = fs.readFileSync(path.join(DIR, f), 'utf8').slice(0, 1500);
  ok(/WRITTEN, NEVER APPLIED|never applied/i.test(head), `${f} says it was written, never applied`);
}
ok(/iso_audit_snapshots/.test(sqlOnly) && /iso_snapshot_immutable/.test(sqlOnly), 'the snapshot table and its immutability trigger are in the drafts (B3.2)');
ok(/'reopened'/.test(sqlOnly) && /iso_reopen_finding/.test(sqlOnly), 'the finding reopen status and function are in the drafts (B2.4)');

console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
process.exit(fail.length ? 1 : 0);
