// serve.mjs used to serve any file under the project root, dotfiles included, on every network
// interface — so /.env (the live Supabase service-role key) and /appdata.json (plaintext staff/
// client data) were downloadable by anyone who could reach this port (plan A10, fixed in ISO
// Phase 0.2b/0.3/0.3b). This suite proves the fix and guards it from regressing.
// Run: node .agents/serve-security-test.cjs   (spawns its own throwaway server instances —
// never touches the shared server at :3001, and never starts serve.mjs non-offline against the
// real .env).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function statusOnly(url) {
  // Deliberately discards the body — some of these paths are real secrets on this machine
  // (the live .env, appdata.json). Never read, log or return res text for them.
  return fetch(url).then(r => { r.body && r.body.cancel && r.body.cancel().catch(() => {}); return r.status; }).catch(() => 0);
}

function waitForServer(port, tries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n))
        .catch(() => retry(n));
    };
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}

// Every server here gets its own throwaway ISO store: the real .iso-offline/ is the user's own work.
const TEMP_ISO_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'serve-sec-iso-'));
process.on('exit', () => { try { fs.rmSync(TEMP_ISO_DIR, { recursive: true, force: true }); } catch (e) {} });
function startServer(args, port) {
  const proc = spawn(process.execPath, ['serve.mjs', ...args], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, ISO_OFFLINE_DIR: TEMP_ISO_DIR } });
  let out = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => out += d);
  return { proc, getOut: () => out, ready: waitForServer(port) };
}

function stopServer(proc) {
  return new Promise(resolve => {
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(resolve, 1500); // don't hang the gate if the OS is slow to reap it
  });
}

(async () => {
  // ── 0.2b: blocked paths never reach the filesystem, on an --offline instance ──────────────
  const PORT_A = 3196;
  const iso = startServer(['--offline', '--port', String(PORT_A)], PORT_A);
  try {
    await iso.ready;

    // The path from the plan's acceptance text must be tried against a file that actually exists
    // (otherwise a 404 would prove nothing — a missing file 404s with or without the fix). When the
    // user's real store is there it is that file, and it is never written, replaced or deleted —
    // this test used to overwrite it with a probe and then delete the whole folder on every gate
    // run, wiping the user's ISO boards (found 2026-10-14). A probe is made only when there is no
    // store, and only the probe is removed.
    const isoOfflineDir = path.join(ROOT, '.iso-offline');
    const realStore = path.join(isoOfflineDir, 'store.json');
    const dirExisted = fs.existsSync(isoOfflineDir), storeExisted = fs.existsSync(realStore);
    const storeBefore = storeExisted ? require('crypto').createHash('sha256').update(fs.readFileSync(realStore)).digest('hex') : null;
    if (!storeExisted) { fs.mkdirSync(isoOfflineDir, { recursive: true }); fs.writeFileSync(realStore, '{"probe":true}'); }

    const blocked = [
      '/.env',                                   // live service-role key
      '/.gitignore',                              // any dotfile, not just secrets
      '/appdata.json',                            // plaintext staff/client export
      '/.agents/gate.sh',                         // test harness internals
      '/.iso-offline/store.json',                 // ISO offline store (Phase 3+)
      '/docs/iso-audit-integration-plan.md',      // this plan itself
      '/workboard/ISO%20Audit/README.md',         // the prototype
      '/supabase/004_email_intake.sql',           // migrations
    ];
    for (const p of blocked) {
      const status = await statusOnly(`http://127.0.0.1:${PORT_A}${p}`);
      ok(status === 404, `blocked path returns 404, not the file: ${p} (got ${status})`);
    }

    // Sanity: the fix must not take anything legitimate down with it.
    const allowed = ['/', '/index.html', '/supabase-client.js'];
    for (const p of allowed) {
      const status = await statusOnly(`http://127.0.0.1:${PORT_A}${p}`);
      ok(status === 200, `unrelated path still serves normally: ${p} (got ${status})`);
    }

    const cfg = await fetch(`http://127.0.0.1:${PORT_A}/api/config`).then(r => r.json());
    ok(cfg.supabaseUrl === '', '--offline still reports no Supabase project at /api/config');

    // Release-1 B6.1 / B6.2: the headers come from one source (security-headers.cjs) and vercel.json
    // carries the same set; supabase-js is pinned to a vendored file with a matching integrity hash.
    const { securityHeaders } = require(path.join(ROOT, 'security-headers.cjs'));
    const want = securityHeaders();
    const home = await fetch(`http://127.0.0.1:${PORT_A}/`);
    const html = await home.text();
    for (const [k, v] of Object.entries(want)) ok(home.headers.get(k) === v, `serve.mjs sends ${k} from security-headers.cjs`);
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const vh = Object.fromEntries((((vercel.headers || []).find(h => h.source === '/(.*)')) || { headers: [] }).headers.map(h => [h.key, h.value]));
    ok(JSON.stringify(vh) === JSON.stringify(want), 'vercel.json sends exactly the same security headers (regenerate: node scripts/gen-vercel-headers.cjs)');
    const tag = /<script src="(vendor\/supabase-js-[\d.]+\.umd\.js)" integrity="(sha384-[^"]+)"><\/script>/.exec(html);
    ok(!!tag && !/supabase-js@2\//.test(html), 'index.html loads supabase-js from a pinned, vendored file — not a floating CDN version');
    const vend = tag ? fs.readFileSync(path.join(ROOT, tag[1])) : Buffer.alloc(0);
    ok(!!tag && tag[2] === 'sha384-' + require('crypto').createHash('sha384').update(vend).digest('base64'), 'its integrity hash matches the vendored file');
    ok(!!tag && (await statusOnly(`http://127.0.0.1:${PORT_A}/${tag[1]}`)) === 200, 'the vendored file is served');
    ok(cfg.microsoftSignIn === false, '--offline never offers Microsoft sign-in');

    // 0.3b: /iso/* always revalidates, unlike the default 24h cache on .js/.css, so a STOP
    // review never looks at day-old ISO front-end code. iso/ doesn't exist until Phase 4+, so
    // this creates and removes its own probe file.
    const isoDir = path.join(ROOT, 'iso');
    const isoDirExisted = fs.existsSync(isoDir);
    fs.mkdirSync(isoDir, { recursive: true });
    fs.writeFileSync(path.join(isoDir, 'probe.js'), '// serve-security-test probe file, safe to delete');
    try {
      const r = await fetch(`http://127.0.0.1:${PORT_A}/iso/probe.js`);
      ok(r.status === 200, `/iso/probe.js serves normally (got ${r.status})`);
      ok(r.headers.get('cache-control') === 'no-cache, must-revalidate',
        `/iso/*.js always revalidates instead of the default 24h .js cache (got "${r.headers.get('cache-control')}")`);
      await r.text();
    } finally {
      fs.rmSync(path.join(isoDir, 'probe.js'), { force: true });
      if (!isoDirExisted) fs.rmSync(isoDir, { recursive: true, force: true });
    }

    if (!storeExisted) { fs.rmSync(realStore, { force: true }); if (!dirExisted) fs.rmSync(isoOfflineDir, { recursive: true, force: true }); }
    else {
      // The user may be working in the app while the gate runs, so "unchanged" means not replaced
      // by a probe and not deleted — and byte-identical unless their own server wrote to it.
      const now = fs.existsSync(realStore) ? fs.readFileSync(realStore, 'utf8') : null;
      ok(now !== null && !/^\{"probe":true\}$/.test(now), 'the user\'s real ISO store is left in place — never replaced by a probe or deleted');
      ok(now === null || require('crypto').createHash('sha256').update(now).digest('hex') === storeBefore || now.length > 100, 'the real store still holds the user\'s data');
    }
  } finally {
    await stopServer(iso.proc);
  }

  // ── 0.3: --envfile points the server at a different project (never the real .env) ─────────
  const PORT_B = 3197;
  const fakeEnv = path.join(__dirname, 'fixtures', 'fake-dev.env');
  const dev = startServer(['--envfile', fakeEnv, '--port', String(PORT_B)], PORT_B);
  try {
    await dev.ready;
    const cfg = await fetch(`http://127.0.0.1:${PORT_B}/api/config`).then(r => r.json());
    ok(cfg.supabaseUrl === 'http://127.0.0.1:9', '--envfile SUPABASE_URL reaches /api/config, not the real .env');

    const headerCsp = (await fetch(`http://127.0.0.1:${PORT_B}/index.html`)).headers.get('content-security-policy') || '';
    ok(headerCsp.includes("connect-src 'self' https://127.0.0.1:9 wss://127.0.0.1:9"),
      'CSP header connect-src is rebuilt from --envfile\'s SUPABASE_URL');
    ok(!headerCsp.includes('wowwiafaqzovlfwzyktj'), 'CSP header no longer names the production project under --envfile');

    const html = await (await fetch(`http://127.0.0.1:${PORT_B}/index.html`)).text();
    ok(html.includes("https://127.0.0.1:9") && !html.includes('wowwiafaqzovlfwzyktj'),
      "served index.html's own CSP meta tag is rewritten in memory to the --envfile project");
  } finally {
    await stopServer(dev.proc);
  }

  // ── 0.3: a bad --envfile is fatal (exit 1) and must never fall back to the real .env ───────
  const missing = path.join(__dirname, 'fixtures', 'does-not-exist.env');
  const bad = spawnSync(process.execPath, ['serve.mjs', '--envfile', missing, '--port', '3199'], { cwd: ROOT, encoding: 'utf-8', timeout: 5000 });
  ok(bad.status === 1, `an unreadable --envfile exits 1, not a running server (got ${bad.status})`);
  ok((bad.stderr || '').includes(missing) || (bad.stdout || '').includes(missing),
    'the exit message names the --envfile path that failed to read');
  ok(!/LIVE project/.test(bad.stdout || ''), 'a bad --envfile never silently falls back to the real .env');

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed'); process.exit(1); });
