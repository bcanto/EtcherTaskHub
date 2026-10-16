// Shared helper for suites that need the app in a browser WITHOUT the dev server on :3001.
// Serves the project folder statically on its own port with a configurable /api/config, and logs in
// as the seeded admin. Everything stays in the browser's memory: callers stub saveDB.
// (main's serve.mjs only listens on :3001, which is the user's own server and ISO store.)
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PUPPETEER = 'C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOGIN = { email: 'b.canto@etchersolutions.com', password: 'TaskHub123' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

// opts.host: address to listen on ('127.0.0.1', or '0.0.0.0' to also answer on 127.0.0.2)
// opts.config: what /api/config answers (default: no Supabase)
// opts.api: (req, res, url) => true when it answered an /api/ request itself
function serve(port, opts = {}) {
  const config = opts.config || { supabaseUrl: '', supabaseAnonKey: '', isoEnabled: false, microsoftSignIn: false };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(config)); }
    if (url.pathname.startsWith('/api/')) {
      if (opts.api && opts.api(req, res, url)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not in this test"}');
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, opts.host || '127.0.0.1', () => r({ port, stop: () => server.close() })));
}

async function launch(opts = {}) {
  const puppeteer = require(PUPPETEER);
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: opts.width || 1440, height: opts.height || 900 } });
}

// Opens a page, optionally runs a script before the app's own (seed storage), logs in as the admin.
async function openPage(browser, url, opts = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { errors.push('native dialog: ' + d.message()); try { await d.dismiss(); } catch (e) {} });
  if (opts.beforeLoad) await page.evaluateOnNewDocument(opts.beforeLoad, opts.beforeLoadArg);
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(900);
  if (opts.login !== false) {
    await page.type('#login-email', LOGIN.email); await page.type('#login-password', LOGIN.password); await page.keyboard.press('Enter');
    await sleep(2000);
    // opts.realSave keeps the app's own saveDB (needed when the save/sync path itself is under test).
    if (!opts.realSave) await page.evaluate(() => { window.saveDB = () => { if (typeof _vcClear === 'function') _vcClear(); }; window._flushDB = () => {}; });
  }
  return { page, errors };
}

// A suite runner in the gate's format (PASS (n): / FAIL (n):).
function report(name, pass, fail) {
  console.log('\n' + name);
  console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}

module.exports = { serve, launch, openPage, report, sleep, ROOT, LOGIN };
