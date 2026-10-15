// Every column the ISO ops filter a list on must be filterable in the Supabase adapter, or that op
// throws "is not a filterable column" the first time it runs on Supabase (offline never checks).
// Found 2026-10-15: evidenceRequest.list filtered iso_evidence_requests on archived_at. Static, no server.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'api/_iso.js'), 'utf8');
const { FILTERABLE } = require(path.join(ROOT, 'api/_isoDbSupabase.js'))._test || {};
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
ok(FILTERABLE && typeof FILTERABLE === 'object', 'the Supabase adapter exposes its FILTERABLE map for this check');
const seen = [];
// ctx.db.list('<table>', { where: [ ... ] }) — the where list never nests brackets in this file.
const re = /db\.list\('(\w+)',\s*\{\s*where:\s*\[([^\]]*)\]/g;
let m;
while ((m = re.exec(src))) {
  const table = m[1];
  for (const f of m[2].matchAll(/field:\s*'(\w+)'/g)) seen.push({ table, field: f[1], line: src.slice(0, m.index).split('\n').length });
}
ok(seen.length > 100, `found the ops' list filters (${seen.length})`);
const bad = FILTERABLE ? seen.filter(x => FILTERABLE[x.table] && x.field !== 'id' && !FILTERABLE[x.table].includes(x.field)) : seen;
ok(bad.length === 0, 'every list filter is a filterable column in the Supabase adapter' + (bad.length ? ': ' + [...new Set(bad.map(x => `${x.table}.${x.field} (line ${x.line})`))].join(', ') : ''));
console.log(`PASS (${pass.length}):`); pass.forEach(p => console.log('  + ' + p));
console.log(`FAIL (${fail.length}):`); fail.forEach(f => console.log('  - ' + f));
process.exit(fail.length ? 1 : 0);
