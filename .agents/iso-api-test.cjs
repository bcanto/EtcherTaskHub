// Phase 3 acceptance: /api/iso over real HTTP, against a throwaway `node serve.mjs --offline`
// instance with its own temp ISO_OFFLINE_DIR (never the shared :3001 server or the user's real
// .iso-offline/ — plan §4.2). Covers 405/400/401/403/404/409 and 50 concurrent HTTP creates (the
// in-process store test already proves 50 concurrent in-process creates are unique/gap-free;
// this proves the same holds when each create is its own HTTP request through a real server,
// which is the only way to catch a per-request module-reload bug — plan §8).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3107;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-api-'));
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${PORT}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
function offlineHeader(user) { return encodeURIComponent(JSON.stringify(user)); }
async function callIso(user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-ISO-Offline-User'] = offlineHeader(user);
  const r = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}

(async () => {
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe',
  });
  const errs = []; proc.stderr.on('data', d => errs.push(d.toString()));
  try {
    await waitForServer();
    const cfg = await fetch(`http://127.0.0.1:${PORT}/api/config`).then(r => r.json());
    ok(cfg.supabaseUrl === '', 'the throwaway server reports no Supabase project (truly offline)');

    // ── method / shape ───────────────────────────────────────────────────────────────────────
    const getResp = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'GET' });
    ok(getResp.status === 405, `GET /api/iso is 405 (got ${getResp.status})`);

    const noOp = await callIso({ id: 'u1', role: 'admin' }, {});
    ok(noOp.status === 400, `missing op is 400 (got ${noOp.status})`);

    const unknownOp = await callIso({ id: 'u1', role: 'admin' }, { op: 'nonsense.op' });
    ok(unknownOp.status === 400, `unknown op is 400 (got ${unknownOp.status})`);

    // ── auth: no header at all -> 401 ────────────────────────────────────────────────────────
    const noAuth = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'standard.list' }) });
    ok(noAuth.status === 401, `no offline header at all is 401 (got ${noAuth.status})`);

    // ── auth: malformed header -> 401 ────────────────────────────────────────────────────────
    const badHeaderResp = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ISO-Offline-User': 'not-json-at-all' }, body: JSON.stringify({ op: 'standard.list' }) });
    ok(badHeaderResp.status === 401, `a malformed offline header is 401 (got ${badHeaderResp.status})`);

    // ── standard.list works for a valid offline admin ───────────────────────────────────────
    const stdList = await callIso({ id: 'u1', role: 'admin' }, { op: 'standard.list' });
    ok(stdList.status === 200 && stdList.body.ok && stdList.body.data.length === 3, `standard.list returns the 3 seeded standards (got ${JSON.stringify(stdList.body)})`);

    // ── audit.create -> audit.get roundtrip; 404 for someone else's / a bad id ──────────────
    const created = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'API Test Audit' });
    ok(created.status === 400 && /approved library version/.test(created.body.error || ''),
      `audit.create without an approved library version refuses clearly (got ${JSON.stringify(created.body)})`);

    // Approve a library version directly in the store so audit.create can proceed (Phase 4's
    // importer builds this for real; Phase 3 just needs a version to exist for the ops test).
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    process.env.ISO_OFFLINE_DIR = tmpDir; // this process's own db calls must hit the SAME store the spawned server uses
    await db.insert('iso_standard_versions', { id: 'iver_9001', standard_code: '9001', label: 'Test v1', status: 'approved' });

    const created2 = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'API Test Audit' });
    ok(created2.status === 200 && created2.body && created2.body.data && created2.body.data.ref, `audit.create succeeds once a library version is approved (ref ${created2.body && created2.body.data && created2.body.data.ref})`);
    const auditId = created2.body && created2.body.data && created2.body.data.id;

    const gotBad = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.get', auditId: 'does-not-exist' });
    ok(gotBad.status === 404, `audit.get for an unknown auditId is 404 (got ${gotBad.status})`);

    const strangerGet = await callIso({ id: 'u_stranger', role: 'staff' }, { op: 'audit.get', auditId });
    ok(strangerGet.status === 200, 'an ordinary staff member CAN open an all_internal audit');

    const privateAudit = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Private', visibility: 'private' });
    const privateId = privateAudit.body.data.id;
    const strangerPrivate = await callIso({ id: 'u_stranger2', role: 'staff' }, { op: 'audit.get', auditId: privateId });
    ok(strangerPrivate.status === 403, `a non-member cannot open a private audit — 403 (got ${strangerPrivate.status})`);

    // ── 409 on a version conflict ─────────────────────────────────────────────────────────────
    const upd1 = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.update', auditId, patch: { title: 'Renamed once' }, expectedVersion: 1 });
    ok(upd1.status === 200, `first audit.update at row_version 1 succeeds (got ${upd1.status})`);
    const upd2 = await callIso({ id: 'u1', role: 'admin' }, { op: 'audit.update', auditId, patch: { title: 'Renamed twice' }, expectedVersion: 1 });
    ok(upd2.status === 409, `a second audit.update reusing the stale expectedVersion is 409 (got ${upd2.status})`);

    // ── a client caller impersonating via the offline header ─────────────────────────────────
    const clientCall = await callIso({ id: 'cu1', role: 'client', clientId: 'c1' }, { op: 'audit.list' });
    ok(clientCall.status === 200 && Array.isArray(clientCall.body.data), 'a client caller can call audit.list (gets an empty/filtered list, not an error)');

    // ── 50 concurrent creates over real HTTP -> 50 unique refs, store.json still parses ──────
    const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric' }).format(new Date());
    const results = await Promise.all(Array.from({ length: 50 }, () => callIso({ id: 'u1', role: 'admin' }, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Concurrent HTTP' })));
    const refs = results.filter(r => r.status === 200).map(r => r.body.data.ref);
    ok(refs.length === 50, `all 50 concurrent HTTP creates succeeded (got ${refs.length}/50)`);
    ok(new Set(refs).size === 50, `50 concurrent HTTP creates produce 50 unique refs (got ${new Set(refs).size} unique)`);
    let storeParses = true;
    try { JSON.parse(fs.readFileSync(path.join(tmpDir, 'store.json'), 'utf-8')); } catch (e) { storeParses = false; }
    ok(storeParses, 'store.json still parses after 50 concurrent HTTP requests');
  } finally {
    proc.kill();
    await new Promise(r => { proc.once('exit', r); setTimeout(r, 1500); });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ── offline-header negative cases, in-process with global.fetch stubbed to throw (plan §4.3:
  // "never spawn serve.mjs without --offline except with the fake env file from 0.3"). The real
  // property under test: the offline header is honoured ONLY when every isoOfflineMode()
  // condition holds — with no real Supabase creds configured, a request that skips the header
  // must fail closed (fall through toward Supabase auth, which then 500s on missing config)
  // rather than ever being silently treated as an authenticated offline caller.
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (...args) => { fetchCalls++; throw new Error('fetch should never be called for an offline-mode negative case'); };
  for (const k of Object.keys(process.env)) if (k.startsWith('SUPABASE_')) delete process.env[k];
  delete require.cache[require.resolve('../api/_isoAuth.js')];
  const isoAuth = require('../api/_isoAuth.js');
  const fakeRes = () => { const r = { code: 0, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  const validOfflineHeader = encodeURIComponent(JSON.stringify({ id: 'u1', role: 'admin', clientId: null }));
  const fakeReq = () => ({ headers: { 'x-iso-offline-user': validOfflineHeader, host: 'localhost:3001' }, socket: { remoteAddress: '127.0.0.1' } });

  // condition false: __TASKHUB_SERVE_OFFLINE not set — a valid-looking header must still be ignored.
  delete globalThis.__TASKHUB_SERVE_OFFLINE;
  process.env.ISO_OFFLINE = '1';
  let res1 = fakeRes();
  const caller1 = await isoAuth.resolveIsoCaller(fakeReq(), res1);
  ok(!caller1 && res1.code === 500, `a valid offline header is ignored when __TASKHUB_SERVE_OFFLINE isn't set (got caller=${JSON.stringify(caller1)}, status=${res1.code})`);

  // condition false: ISO_OFFLINE not '1' — same header, still ignored.
  globalThis.__TASKHUB_SERVE_OFFLINE = true;
  delete process.env.ISO_OFFLINE;
  let res2 = fakeRes();
  const caller2 = await isoAuth.resolveIsoCaller(fakeReq(), res2);
  ok(!caller2 && res2.code === 500, `a valid offline header is ignored when ISO_OFFLINE isn't '1' (got caller=${JSON.stringify(caller2)}, status=${res2.code})`);

  // fully offline again, but from a non-loopback address — still ignored.
  process.env.ISO_OFFLINE = '1';
  let res3 = fakeRes();
  const caller3 = await isoAuth.resolveIsoCaller({ headers: { 'x-iso-offline-user': validOfflineHeader, host: 'localhost:3001' }, socket: { remoteAddress: '203.0.113.5' } }, res3);
  ok(!caller3 && res3.code === 401, `a valid offline header from a non-loopback remoteAddress is rejected (got caller=${JSON.stringify(caller3)}, status=${res3.code})`);

  ok(fetchCalls === 0, 'no negative case ever called fetch (no accidental network attempt)');
  global.fetch = realFetch;

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
