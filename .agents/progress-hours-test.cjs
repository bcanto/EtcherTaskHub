// Main Board progress cell (2026-10-16): log hours with a progress change, like the status
// dropdown's "Log hours for <owner>" on completion. Hours typed first save with the % in one
// click; picking a % first keeps the field open with Log. In memory only (saveDB stubbed).
// Its own static offline server (never the user's :3001, which shares their ISO store).
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const path = require('path'), http = require('http'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 3195;
function staticOffline(port) {
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '', isoEnabled: false, microsoftSignIn: false })); }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not in this test"}'); }
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
(async () => {
  const pass = [], fail = []; const ok = (c, m) => (c ? pass : fail).push(m);
  const srv = await staticOffline(PORT);
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
  const errs = [];
  try {
    const p = await b.newPage(); await p.setCacheEnabled(false);
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { errs.push('dialog ' + d.message()); d.dismiss(); });
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' }); await sleep(900);
    await p.type('#login-email', 'b.canto@etchersolutions.com'); await p.type('#login-password', 'TaskHub123'); await p.keyboard.press('Enter'); await sleep(2200);
    await p.evaluate(() => { window.saveDB = () => {}; });
    const setup = await p.evaluate(() => {
      const t = DB.tasks.find(x => !x.archived && !x.parentTaskId && x.ownerId && (x.workboardId || x.boardId) && (DB.workboards || []).some(w => w.id === (x.workboardId || x.boardId) && !w.archived));
      t.percentComplete = 50; t.status = 'in-progress'; t.percentMode = 'manual';
      openWorkboard(t.workboardId || t.boardId);
      return { id: t.id, owner: t.ownerId, before: (DB.timeEntries || []).length };
    });
    await sleep(1500);
    const open = () => p.evaluate(id => { const td = [...document.querySelectorAll('td.ws-editable')].find(x => (x.getAttribute('onclick') || '').includes(`'${id}','progress'`)); if (td) td.click(); return !!td; }, setup.id);
    t0: {
      ok(await open(), 'the progress cell opens its popover');
      await sleep(300);
      const ui = await p.evaluate(() => { const dd = document.getElementById('ws-cell-dd'); return { field: !!document.getElementById('ws-prog-hours'), label: (dd.textContent.match(/Log hours for [^(]+/i) || [''])[0].trim() }; });
      ok(ui.field && /^Log hours for \S/.test(ui.label), 'the popover offers "Log hours for <owner>" (' + ui.label + ')');
    }
    // Hours first, then the %: both in one action.
    const one = await p.evaluate(id => {
      document.getElementById('ws-prog-hours').value = '2.5';
      const btn = [...document.querySelectorAll('#ws-cell-dd button')].find(x => x.textContent.trim() === '75%');
      btn.click();
      const t = DB.tasks.find(x => x.id === id), e = DB.timeEntries[DB.timeEntries.length - 1];
      return { pct: t.percentComplete, hours: e && e.hours, task: e && e.taskId, staff: e && e.staffId, note: e && e.note, open: !!document.getElementById('ws-prog-hours'), msg: (document.getElementById('ws-prog-msg') || {}).textContent, n: DB.timeEntries.length };
    }, setup.id);
    ok(one.pct === 75 && one.hours === 2.5 && one.task === setup.id && one.staff === setup.owner, 'hours typed first are saved with the new % in one click, against the task owner');
    ok(/progress 50% to 75%/.test(one.note || ''), 'the entry notes the change for reporting (' + one.note + ')');
    ok(one.n === setup.before + 1 && one.open && /Saved 75% and logged 2.5h/.test(one.msg || ''), 'one entry, and the popover confirms it');
    // % first, then Log.
    const two = await p.evaluate(id => {
      const btn = [...document.querySelectorAll('#ws-cell-dd button')].find(x => x.textContent.trim() === '90%');
      btn.click();
      const mid = { pct: DB.tasks.find(x => x.id === id).percentComplete, n: DB.timeEntries.length, msg: document.getElementById('ws-prog-msg').textContent, focused: document.activeElement && document.activeElement.id };
      document.getElementById('ws-prog-hours').value = '1';
      wsLogProgressHours(id);
      const e = DB.timeEntries[DB.timeEntries.length - 1];
      return { ...mid, after: DB.timeEntries.length, hours: e.hours, note: e.note };
    }, setup.id);
    ok(two.pct === 90 && two.n === setup.before + 1 && /Add hours above/.test(two.msg) && two.focused === 'ws-prog-hours', 'picking a % without hours saves it and keeps the hours field open, focused');
    ok(two.after === setup.before + 2 && two.hours === 1 && /progress 90%/.test(two.note), 'Log then records the hours at the current %');
    // Zero or empty hours never create an entry.
    const zero = await p.evaluate(id => { document.getElementById('ws-prog-hours').value = ''; wsLogProgressHours(id); return DB.timeEntries.length; }, setup.id);
    ok(zero === setup.before + 2, 'Log with no hours does nothing');
    // No owner: no field, and the % still saves.
    const noOwner = await p.evaluate(id => {
      wsCellClose();
      const t = DB.tasks.find(x => x.id === id); t.ownerId = null; renderView('workspace');
      return true;
    }, setup.id).catch(() => true);
    await sleep(500); await open(); await sleep(300);
    const no = await p.evaluate(id => ({ field: !!document.getElementById('ws-prog-hours'), text: document.getElementById('ws-cell-dd').innerText }), setup.id);
    ok(!no.field && /Set an owner to log hours/.test(no.text), 'a task with no owner offers no hours field, and says why');
    ok(errs.length === 0, 'no page errors or native dialogs (' + errs.slice(0, 2).join(' | ') + ')');
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally {
    await b.close(); srv.close();
    console.log('\nprogress-hours-test');
    console.log('PASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
    console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
    process.exit(fail.length ? 1 : 0);
  }
})();
