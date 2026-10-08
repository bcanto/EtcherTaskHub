// Can-fail runner (release-1 plan B0.3; hard rule 7: every new test is proven able to fail).
//
//   node .agents/_canfail.cjs .agents/_mut-b1.cjs            run every mutation in the list
//   node .agents/_canfail.cjs .agents/_mut-b1.cjs --only id   just one
//   node .agents/_canfail.cjs .agents/_mut-b1.cjs --green     also re-run each suite clean afterwards
//
// A mutation list exports [{ id, suite, file, find, replace, note }]. For each one this backs the file
// up (bytes), applies the replacement — which must match EXACTLY once; written with \n, converted to
// \r\n automatically when the target is a CRLF file — runs the suite, requires FAIL > 0, then writes
// the original bytes back and checks they are byte-identical. A copy of every original also goes to
// the temp dir before it is touched, so an interrupted run can always be recovered by hand.
// Output: one evidence line per mutation, ready for the Progress Log. Exit 1 if any mutation was not
// caught, any anchor did not match exactly once, or any restore failed.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const listPath = args.find(a => !a.startsWith('--'));
if (!listPath) { console.error('usage: node .agents/_canfail.cjs <mutation-list.cjs> [--only id] [--green]'); process.exit(2); }
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const green = args.includes('--green');
const list = require(path.resolve(listPath)).filter(m => !only || m.id === only);
if (!list.length) { console.error('no mutations selected'); process.exit(2); }

function counts(out) {
  const p = [...out.matchAll(/^PASS \((\d+)\)/gm)].pop(), f = [...out.matchAll(/^FAIL \((\d+)\)/gm)].pop();
  return { pass: p ? Number(p[1]) : null, fail: f ? Number(f[1]) : null };
}
function runSuite(suite) {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.agents', suite + '.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { ...counts(out), out };
}

let current = null; // { abs, orig } while a file is mutated — restored on Ctrl-C too
function restore() {
  if (!current) return true;
  fs.writeFileSync(current.abs, current.orig);
  const ok = Buffer.compare(fs.readFileSync(current.abs), current.orig) === 0;
  current = null;
  return ok;
}
process.on('SIGINT', () => { restore(); console.error('\ninterrupted — file restored'); process.exit(130); });

let bad = 0;
const lines = [];
for (const m of list) {
  const abs = path.join(ROOT, m.file);
  const orig = fs.readFileSync(abs);
  const text = orig.toString('utf8');
  const crlf = /\r\n/.test(text) && !/[^\r]\n/.test(text);
  const conv = s => (crlf ? s.replace(/\r?\n/g, '\r\n') : s);
  const find = conv(m.find), replace = conv(m.replace);
  const n = text.split(find).length - 1;
  if (n !== 1) { bad++; lines.push(`✗ ${m.id}: anchor matched ${n} times in ${m.file} — fix the mutation list`); continue; }
  const backup = path.join(os.tmpdir(), `canfail-${Date.now()}-${path.basename(m.file)}`);
  fs.writeFileSync(backup, orig);
  current = { abs, orig };
  let res;
  try {
    fs.writeFileSync(abs, text.replace(find, () => replace));
    res = runSuite(m.suite);
  } finally {
    const restored = restore();
    if (!restored) { bad++; lines.push(`✗ ${m.id}: RESTORE FAILED — original bytes are in ${backup}`); }
    else fs.unlinkSync(backup);
  }
  const caught = res && res.fail > 0;
  if (!caught) bad++;
  lines.push(`${caught ? '✓' : '✗ NOT CAUGHT'} ${m.id} — ${m.note} → ${m.suite} PASS ${res && res.pass} / FAIL ${res && res.fail} (restored, byte-identical)`);
  console.log(lines[lines.length - 1]);
}
if (green) {
  for (const suite of [...new Set(list.map(m => m.suite))]) {
    const r = runSuite(suite);
    const okRun = r.fail === 0 && r.pass > 0;
    if (!okRun) bad++;
    lines.push(`${okRun ? '✓' : '✗'} clean re-run ${suite} → PASS ${r.pass} / FAIL ${r.fail}`);
    console.log(lines[lines.length - 1]);
  }
}
console.log('\nCAN-FAIL SUMMARY');
lines.forEach(l => console.log('  ' + l));
process.exit(bad ? 1 : 0);
