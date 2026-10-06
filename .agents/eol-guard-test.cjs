// Line-ending guard (A70). index.html is committed with CRLF; core.autocrlf=true only normalises a
// file whose committed copy is LF, so an LF index.html makes `git diff` show every line changed and
// buries the real edits. That happened once (during Phase 7b.1) without any test noticing — this turns
// the "preserve index.html's CRLF" rule into a check the gate actually runs.
const fs = require('fs');
const path = require('path');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

const s = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'latin1');
const crlf = (s.match(/\r\n/g) || []).length;
const loneLf = (s.match(/(^|[^\r])\n/g) || []).length;
const loneCr = (s.match(/\r(?!\n)/g) || []).length;
ok(crlf > 1000, `index.html uses CRLF line endings (${crlf} CRLF)`);
ok(loneLf === 0, `index.html has no LF-only line endings (found ${loneLf})`);
ok(loneCr === 0, `index.html has no stray CR (found ${loneCr})`);

console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
process.exit(fail.length ? 1 : 0);
