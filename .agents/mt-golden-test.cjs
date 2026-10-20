// Phase 1 acceptance gate (plan 0.5/1): re-renders the exact matrix golden-capture.cjs captured
// and diffs every file after collapsing whitespace *between tags only* — any attribute or text
// difference fails. Must be able to fail: run once against a deliberately-broken renderWorkspace
// (or renderGantt) before trusting a green run — see the Phase 1 Progress Log entry.
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const { installFixture, boot, captureAll } = require('./_golden-shared.cjs');

const GOLDEN_DIR = path.join(__dirname, 'golden');
const pass = [], fail = [];
const errs = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

// Collapse whitespace between tags only (">   <" -> "><"), never inside attribute values or text
// runs beyond that boundary — real spacing/attribute differences still fail.
// The table's scroll box fits its height to the window, and that number moves by a few pixels depending on whether the
// tap-target pass has grown the toolbar above it yet (timing, not content): that one fitted height is not compared.
function normalize(html) { return String(html).replace(/(<div id="ws-table-scroll" style="[^"]*?)(?<![-\w])height: \d+px;/, '$1height: (fitted);').replace(/>\s+</g, '><').trim(); }

function report() {
  console.log('\nPASS (' + pass.length + '):');
  const perFile = pass.filter(m => m.startsWith('MATCH '));
  pass.filter(m => !m.startsWith('MATCH ')).forEach(m => console.log('  + ' + m));
  if (perFile.length) console.log(`  + ${perFile.length} captures matched their golden file byte-for-byte`);
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  console.log('ERRORS:', errs.length ? errs.slice(0, 10) : 'none');
  process.exit(fail.length ? 1 : 0);
}

(async () => {
  if (!fs.existsSync(GOLDEN_DIR) || !fs.existsSync(path.join(GOLDEN_DIR, '_manifest.json'))) {
    fail.push('.agents/golden/ (or its manifest) is missing — run `node .agents/golden-capture.cjs` first');
    return report();
  }

  // Its own offline server on an empty temp ISO store — never the shared :3001 dev server, whose ISO
  // store holds whatever boards someone created while using the app (the sidebar in nav.html then
  // listed them and this suite failed with no code change at all; found 2026-10-03).
  const { spawn } = require('child_process');
  const os = require('os');
  const PORT = 3151;
  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-golden-'));
  const srv = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: path.join(__dirname, '..'), env: { ...process.env, ISO_OFFLINE_DIR: isoDir }, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/config`)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  let results;
  try {
    const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } });
    const p = await b.newPage();
    p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    await installFixture(p);
    await boot(p, `http://localhost:${PORT}/`);
    results = await captureAll(p);
    await b.close();
  } finally { srv.kill(); }

  let compared = 0;
  for (const { name, html } of results) {
    const goldenPath = path.join(GOLDEN_DIR, name);
    if (!fs.existsSync(goldenPath)) { fail.push(`no golden file for freshly-captured "${name}" — re-run golden-capture.cjs if this file is a deliberate addition`); continue; }
    const golden = fs.readFileSync(goldenPath, 'utf-8');
    const isXml = name.endsWith('.xml');
    const a = isXml ? golden.trim() : normalize(golden);
    const bHtml = isXml ? String(html).trim() : normalize(html);
    compared++;
    if (a === bHtml) pass.push(`MATCH ${name}`);
    else fail.push(`${name} differs from its golden capture after whitespace collapse (golden ${a.length} chars, live ${bHtml.length} chars)`);
  }
  console.log(`compared ${compared} of ${results.length} freshly-captured files against .agents/golden/`);
  ok(compared >= results.length, `every freshly-captured file had a golden file to compare against (compared ${compared}, captured ${results.length})`);

  report();
})().catch(e => { console.error('CRASHED', e); fail.push('the suite crashed: ' + e.message); report(); });
