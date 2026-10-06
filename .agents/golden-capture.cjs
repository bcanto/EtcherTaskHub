// Phase 0.5 — one-shot golden-master capture tool. Run manually, never as part of the gate:
//   node .agents/golden-capture.cjs
// Re-run only when the fixture (.agents/fixtures/golden-db.json) or the capture matrix in
// _golden-shared.cjs intentionally changes. mt-golden-test.cjs re-renders the same matrix
// against live code and diffs it against what this tool writes to .agents/golden/.
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const { installFixture, boot, captureAll } = require('./_golden-shared.cjs');

const GOLDEN_DIR = path.join(__dirname, 'golden');
const URL = process.argv[2] || 'http://localhost:3001/';

(async () => {
  fs.rmSync(GOLDEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await installFixture(p);
  await boot(p, URL);

  const t0 = Date.now();
  const results = await captureAll(p, { onProgress: n => { if (n % 100 === 0) process.stdout.write(`  captured ${n}...\n`); } });
  for (const { name, html } of results) fs.writeFileSync(path.join(GOLDEN_DIR, name), html);

  const manifest = { capturedAt: new Date().toISOString(), fileCount: results.length, names: results.map(r => r.name).sort() };
  fs.writeFileSync(path.join(GOLDEN_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Captured ${results.length} golden files in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${GOLDEN_DIR}`);
  console.log('page errors:', errs.length ? errs.slice(0, 10) : 'none');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
