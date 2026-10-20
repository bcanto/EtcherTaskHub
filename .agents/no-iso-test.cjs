// The ISO audit module moved to its own site (20 October 2026, HANDOVER section 11). This guard fails if any part of it
// comes back into Task Hub: its files, its server endpoint, its database migrations, or a hook in the page. The browser
// part serves the page with the old ISO_ENABLED flag switched ON, so it proves the code is gone, not merely switched off.
// Own server and port; never :3001.
const fs = require('fs'), path = require('path');
const H = require('./_static-offline.cjs');
const ROOT = H.ROOT;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (_) { return ''; } };

(async () => {
  // ── files ──
  ok(!fs.existsSync(path.join(ROOT, 'iso')), 'the iso/ folder is gone (module code, library seeds, templates)');
  const api = fs.readdirSync(path.join(ROOT, 'api'));
  const isoApi = api.filter(f => /^_?iso/i.test(f));
  ok(isoApi.length === 0, 'no ISO server files in api/ (' + (isoApi.join(', ') || 'none') + ')');
  const mig = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /_iso_/i.test(f));
  ok(mig.length === 0, 'no ISO database migrations (' + (mig.join(', ') || 'none') + ')');
  const fns = api.filter(f => f.endsWith('.js') && !f.startsWith('_')).length + fs.readdirSync(path.join(ROOT, 'api')).filter(d => fs.statSync(path.join(ROOT, 'api', d)).isDirectory()).reduce((n, d) => n + fs.readdirSync(path.join(ROOT, 'api', d)).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 0);
  ok(fns <= 10, 'the site has at most 10 server functions (' + fns + ')');

  // ── hooks in the page and the server ──
  const html = read('index.html');
  const hooks = ['window.ISO', 'ISO.', '_isoEnabled', '/iso/', 'nav-iso', 'cp-tab-iso', 'isoAuditId', 'tsIsoFilter', "_teMode==='iso'", "rptTab==='iso'", "case 'iso'", '_cpIsoRefresh', 'iso-archive-card', '_dgAddIsoProgress', '_isoDB', '_isoCurrentUser'];
  const left = hooks.filter(h => html.includes(h));
  ok(left.length === 0, 'the page has no ISO hooks left (' + (left.join(' | ') || 'none') + ')');
  ok(!/isoEnabled/.test(read('api/config.js')) && !/isoEnabled|ISO_OFFLINE|\/iso\//.test(read('serve.mjs')), 'the server no longer offers an ISO switch or ISO routes');
  ok(!/_isoEnabled/.test(read('supabase-client.js')), 'the sign-in setup no longer reads an ISO switch');

  // ── the app, with the old flag switched on ──
  const PORT = 3263;
  const srv = await H.serve(PORT, { config: { supabaseUrl: '', supabaseAnonKey: '', isoEnabled: true, microsoftSignIn: false } });
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const asked = [];
    p.on('request', r => { if (/\/iso\/|\/api\/iso/.test(r.url())) asked.push(r.url()); });
    await p.reload({ waitUntil: 'networkidle2' }); await H.sleep(1500);
    const nav = await p.evaluate(() => ({ section: !!document.getElementById('nav-iso-header'), library: [...document.querySelectorAll('.nav-item')].some(n => /ISO library/.test(n.textContent)), signedIn: !!currentUser }));
    ok(nav.signedIn, 'the app opens for an admin');
    ok(!nav.section && !nav.library, 'the sidebar has no ISO section and no ISO library, even with the old flag on');
    const view = await p.evaluate(() => { renderView('iso'); return document.getElementById('view-container')?.innerText || document.body.innerText; });
    ok(/Page Not Found/.test(view), 'the old ISO address shows "Page Not Found"');
    const time = await p.evaluate(() => { renderView('time'); return [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(t => /^(Task|Client|ISO audit)$/.test(t)); });
    ok(time.includes('Task') && time.includes('Client') && !time.includes('ISO audit'), 'Log Time offers Task and Client only (' + time.join(', ') + ')');
    const rpt = await p.evaluate(() => { renderView('reports'); return document.body.innerText; });
    ok(/Pro Forma Invoice/.test(rpt) && !/ISO audits|ISO board/.test(rpt), 'Reports has no ISO audits tab and no ISO board filter');
    const arch = await p.evaluate(() => { renderView('archive'); return !!document.getElementById('iso-archive-card'); });
    ok(!arch, 'Archive & Bin has no ISO card');
    const portal = await p.evaluate(() => { currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; launchClientView(); return { tab: !!document.getElementById('cp-tab-iso'), tabs: [...document.querySelectorAll('.cp-nav-tab')].map(t => t.textContent.trim()) }; });
    ok(!portal.tab && !portal.tabs.some(t => /ISO/.test(t)), 'the client portal has no ISO Audits tab (' + portal.tabs.join(', ') + ')');
    await H.sleep(800);
    ok(asked.length === 0, 'the page never asks for an ISO file or the ISO endpoint (' + (asked.slice(0, 3).join(', ') || 'none') + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('no-iso-test', pass, fail);
})();
