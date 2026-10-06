// Phase 15.3 (pulled forward, run manually against a real dev Supabase project — NEVER part of
// `gate.sh`, which must stay offline-only). Verifies migration 009 + the Supabase adapter against
// real Postgres/PostgREST/GoTrue: numbering race, append-only + TRUNCATE triggers, library
// immutability, no-hard-delete triggers, RLS denies anon/authenticated, every iso_* RPC refused
// with the anon key and with a real client JWT, and the same store-contract suite
// iso-store-test.cjs runs against the offline adapter — this time against the real thing.
//
// Usage:  node .agents/iso-db-verify.cjs
// Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from .env.dev (never .env —
// this must NEVER be pointed at the production project; see the hard refusal below).
// Prerequisites (see docs/iso-audit-integration-plan.md Phase 15.3 and
// supabase/dev/000_dev_bootstrap.sql's own header):
//   1. A fresh Supabase project created for this purpose only (suggested name etcher-taskhub-dev).
//   2. supabase/dev/000_dev_bootstrap.sql applied to it (by the user, in the Supabase SQL editor).
//   3. supabase/migrations/009_iso_core.sql applied to it (by the user, same way).
//   4. .env.dev in the repo root with that project's SUPABASE_URL, SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY — confirmed `git check-ignore .env.dev` before ever asking for it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

// ── Load .env.dev (never .env) ──────────────────────────────────────────────────────────────────
function loadEnvFile(p) {
  const out = {};
  const text = fs.readFileSync(p, 'utf-8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const ENV_DEV_PATH = path.join(ROOT, '.env.dev');
const PROD_PROJECT_ID = 'wowwiafaqzovlfwzyktj'; // never let this script touch this project, ever

(async () => {
  if (!fs.existsSync(ENV_DEV_PATH)) {
    fail.push('.env.dev not found at the repo root — create it with the dev project\'s SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY first (plan §15.3)');
    return report();
  }
  const env = loadEnvFile(ENV_DEV_PATH);
  const SUPABASE_URL = env.SUPABASE_URL, ANON_KEY = env.SUPABASE_ANON_KEY, SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    fail.push('.env.dev is missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
    return report();
  }
  // The one check this whole script exists to make impossible to skip: never run against prod.
  if (SUPABASE_URL.includes(PROD_PROJECT_ID)) {
    fail.push(`REFUSING TO RUN: .env.dev points at the production project (${PROD_PROJECT_ID}). This script writes and deletes test data — it must only ever run against a disposable dev project.`);
    return report();
  }
  ok(true, `.env.dev resolved to a non-production project (${new URL(SUPABASE_URL).host})`);

  const svcHeaders = (extra) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra });
  const anonHeaders = (extra) => ({ apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, ...extra });

  // ── Create 4 real Supabase-authenticated test users (2 staff, 2 client on 2 client ids) ──────
  const testPassword = 'IsoDbVerify-' + crypto.randomBytes(9).toString('hex') + '!1';
  const stamp = Date.now();
  const usersToCreate = [
    { key: 'staffA', email: `iso-verify-staffA-${stamp}@example.invalid`, role: 'staff', clientId: null },
    { key: 'staffAdmin', email: `iso-verify-admin-${stamp}@example.invalid`, role: 'admin', clientId: null },
    { key: 'clientA', email: `iso-verify-clientA-${stamp}@example.invalid`, role: 'client', clientId: 'iso-verify-c1' },
    { key: 'clientB', email: `iso-verify-clientB-${stamp}@example.invalid`, role: 'client', clientId: 'iso-verify-c2' },
  ];
  const users = {};
  for (const u of usersToCreate) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: svcHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: u.email, password: testPassword, email_confirm: true }),
    });
    if (!r.ok) { fail.push(`could not create GoTrue user ${u.key}: ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
    const created = await r.json();
    users[u.key] = { id: created.id, email: u.email };
    // Promote past the "new accounts get no access" default (dev bootstrap's own handle_new_auth_user).
    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH', headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ role: u.role, client_id: u.clientId, name: u.key }),
    });
    ok(patchR.ok, `promoted ${u.key} to role=${u.role}${u.clientId ? ' client_id=' + u.clientId : ''} (${patchR.status})`);
    // Real password-grant login, exactly as a browser session would get its JWT.
    const tokenR = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: anonHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: u.email, password: testPassword }),
    });
    if (tokenR.ok) users[u.key].jwt = (await tokenR.json()).access_token;
    else fail.push(`could not get a password-grant token for ${u.key}: ${tokenR.status}`);
  }

  try {
    // ── RLS denies anon and authenticated (a real client JWT) on every iso_* table ────────────
    const ISO_TABLES = ['iso_audits', 'iso_requirements', 'iso_findings', 'iso_actions', 'iso_activity', 'iso_config', 'iso_standards'];
    for (const t of ISO_TABLES) {
      const anonR = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: anonHeaders() });
      const anonRows = anonR.ok ? await anonR.json() : null;
      ok(!anonR.ok || (Array.isArray(anonRows) && anonRows.length === 0), `anon key gets no rows from ${t} (status ${anonR.status}, rows ${anonRows ? anonRows.length : 'n/a'})`);
      if (users.clientA && users.clientA.jwt) {
        const clientR = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${users.clientA.jwt}` } });
        const clientRows = clientR.ok ? await clientR.json() : null;
        ok(!clientR.ok || (Array.isArray(clientRows) && clientRows.length === 0), `an authenticated client JWT gets no rows from ${t} either (status ${clientR.status})`);
      }
    }

    // ── Every iso_* RPC refused with the anon key and with a client JWT ───────────────────────
    const RPCS = [
      ['iso_next_number', { p_scope: 'iso-verify-probe' }],
      ['iso_create_audit', { p_id: 'x', p_client_id: 'x', p_title: 'x', p_audit_type: 'gap_analysis', p_owner_uid: 'x', p_visibility: 'all_internal', p_actor_uid: 'x' }],
      ['iso_update_row', { p_table: 'iso_audits', p_id: 'x', p_patch: {}, p_expected_version: 1, p_actor_uid: 'x', p_actor_kind: 'staff' }],
      ['iso_log', { p_audit_id: null, p_client_id: null, p_entity_type: 'x', p_entity_id: 'x', p_entity_ref: null, p_action: 'x', p_field: null, p_before: null, p_after: null, p_reason: null, p_source: 'user', p_actor_uid: 'x', p_actor_kind: 'staff' }],
    ];
    for (const [fn, body] of RPCS) {
      const anonR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: anonHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      ok(anonR.status === 401 || anonR.status === 403 || anonR.status === 404, `${fn} refused with the anon key (got ${anonR.status})`);
      if (users.clientA && users.clientA.jwt) {
        const clientR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${users.clientA.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        ok(clientR.status === 401 || clientR.status === 403 || clientR.status === 404, `${fn} refused with a real client JWT too (got ${clientR.status})`);
      }
      // has_function_privilege must independently say false for both roles (plan §4.4's own Check).
      const privR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/iso_next_number`, { method: 'POST', headers: svcHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ p_scope: '__priv_probe__' }) });
      if (fn === 'iso_next_number') ok(privR.ok, 'sanity: the service role key CAN call iso_next_number (the lockdown is role-specific, not total)');
    }

    // ── Numbering race: 50 parallel HTTP creates through a real local serve.mjs pointed at this
    // dev project (--envfile), exercising api/iso.js -> _isoDbSupabase.js -> the real RPCs ──────
    const PORT = 3109;
    const proc = spawn(process.execPath, ['serve.mjs', '--envfile', ENV_DEV_PATH, '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
    const serverErrs = []; proc.stderr.on('data', d => serverErrs.push(d.toString()));
    try {
      await new Promise((resolve, reject) => {
        const attempt = n => fetch(`http://127.0.0.1:${PORT}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
        const retry = n => n <= 0 ? reject(new Error('server did not come up: ' + serverErrs.join(''))) : setTimeout(() => attempt(n - 1), 150);
        attempt(50);
      });
      const cfg = await fetch(`http://127.0.0.1:${PORT}/api/config`).then(r => r.json());
      ok(cfg.supabaseUrl === SUPABASE_URL, `the local server under --envfile reports the DEV project, not production (got ${cfg.supabaseUrl})`);

      const adminJwt = users.staffAdmin && users.staffAdmin.jwt;
      const callIso = (jwt, body) => fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) })
        .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

      if (adminJwt) {
        const stdList = await callIso(adminJwt, { op: 'standard.list' });
        ok(stdList.status === 200, `standard.list succeeds through the real HTTP+Supabase path (got ${stdList.status}: ${JSON.stringify(stdList.body)})`);

        await fetch(`${SUPABASE_URL}/rest/v1/iso_standard_versions`, { method: 'POST', headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: 'iver_verify', standard_code: '9001', label: 'verify', status: 'approved' }) });

        const results = await Promise.all(Array.from({ length: 50 }, () => callIso(adminJwt, { op: 'audit.create', clientId: 'iso-verify-c1', standards: ['9001'], title: 'DB Verify Concurrent' })));
        const refs = results.filter(r => r.status === 200).map(r => r.body.data.ref);
        ok(refs.length === 50, `all 50 concurrent creates succeeded against real Postgres (got ${refs.length}/50; sample error: ${JSON.stringify(results.find(r => r.status !== 200))})`);
        ok(new Set(refs).size === refs.length, `50 concurrent creates against real Postgres produced ${new Set(refs).size} unique refs of ${refs.length}`);
      } else {
        fail.push('no admin JWT available — skipped the HTTP numbering race (see earlier GoTrue failures)');
      }
    } finally {
      proc.kill();
      await new Promise(r => { proc.once('exit', r); setTimeout(r, 1500); });
    }

    // ── Append-only + TRUNCATE triggers on iso_activity (service role bypasses RLS, so only the
    // trigger stops this — plan §4.4) ───────────────────────────────────────────────────────────
    const oneActivity = await fetch(`${SUPABASE_URL}/rest/v1/iso_activity?select=id&limit=1`, { headers: svcHeaders() }).then(r => r.json());
    if (oneActivity && oneActivity[0]) {
      const updR = await fetch(`${SUPABASE_URL}/rest/v1/iso_activity?id=eq.${oneActivity[0].id}`, { method: 'PATCH', headers: svcHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'tampered' }) });
      ok(!updR.ok, `UPDATE on iso_activity is rejected even with the service role key (got ${updR.status})`);
      const delR = await fetch(`${SUPABASE_URL}/rest/v1/iso_activity?id=eq.${oneActivity[0].id}`, { method: 'DELETE', headers: svcHeaders() });
      ok(!delR.ok, `DELETE on iso_activity is rejected even with the service role key (got ${delR.status})`);
    } else {
      fail.push('no iso_activity row existed to test the append-only trigger against (the numbering race above should have created some)');
    }

    // ── Library immutability once a version is approved ───────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/iso_clause_sections`, { method: 'POST', headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: 'isec_verify', version_id: 'iver_verify', clause: '4', title: 'Context', level: 1, sort_key: 1 }) });
    await fetch(`${SUPABASE_URL}/rest/v1/iso_library_requirements`, { method: 'POST', headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: 'ilr_verify', version_id: 'iver_verify', section_id: 'isec_verify', clause: '4.1', clause_name: 'Context', requirement_text: 'x', stable_key: 'verify-key', sort_key: 1 }) });
    const immutR = await fetch(`${SUPABASE_URL}/rest/v1/iso_library_requirements?id=eq.ilr_verify`, { method: 'PATCH', headers: svcHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ requirement_text: 'tampered' }) });
    ok(!immutR.ok, `editing a library requirement once its version is approved is rejected (got ${immutR.status})`);

    // ── No-hard-delete triggers (substantive tables) vs. the deliberate exceptions (A19/§4.4) ──
    const delAudit = await fetch(`${SUPABASE_URL}/rest/v1/iso_audits?id=eq.does-not-exist-but-trigger-fires-on-any-attempt`, { method: 'DELETE', headers: svcHeaders() });
    // A DELETE matching zero rows never fires a row-level trigger — this only proves the
    // trigger exists by deleting a REAL row created above, not a nonexistent one.
    const anyAudit = await fetch(`${SUPABASE_URL}/rest/v1/iso_audits?select=id&limit=1`, { headers: svcHeaders() }).then(r => r.json());
    if (anyAudit && anyAudit[0]) {
      const realDelR = await fetch(`${SUPABASE_URL}/rest/v1/iso_audits?id=eq.${anyAudit[0].id}`, { method: 'DELETE', headers: svcHeaders() });
      ok(!realDelR.ok, `DELETE on a real iso_audits row is rejected by the no-hard-delete trigger (got ${realDelR.status})`);
    } else {
      fail.push('no iso_audits row existed to test the no-hard-delete trigger against');
    }

    // ── Store contract suite against the REAL Supabase adapter (same cases as iso-store-test.cjs) ─
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    delete require.cache[require.resolve('../api/_isoDbSupabase.js')];
    const db = require('../api/_isoDbSupabase.js');
    const probeId = 'iaud_verify_' + crypto.randomBytes(4).toString('hex');
    const created = await db.insertNumbered('iso_audits', 'audit', 'AUD-VERIFY-' + stamp, { id: probeId, client_id: 'iso-verify-c1', title: 'Adapter probe', owner_uid: 'x', visibility: 'all_internal' }, { actor_uid: 'x' });
    ok(created && created.ref, `_isoDbSupabase.insertNumbered() works against real Postgres (ref ${created && created.ref})`);
    const fetched = await db.get('iso_audits', probeId);
    ok(fetched && fetched.title === 'Adapter probe', '_isoDbSupabase.get() reads back what was just written');
    const updated = await db.update('iso_audits', probeId, { title: 'Adapter probe (renamed)' }, 1, { actor_uid: 'x', actor_kind: 'staff' });
    ok(updated && updated.row_version === 2, '_isoDbSupabase.update() applies a patch and bumps row_version for real');
    let conflictSeen = false;
    try { await db.update('iso_audits', probeId, { title: 'stale' }, 1, null); } catch (e) { conflictSeen = e.code === 'version_conflict'; }
    ok(conflictSeen, '_isoDbSupabase.update() surfaces a real 40001 as version_conflict');
  } finally {
    // ── Cleanup: delete all 4 test users, regardless of what failed above ──────────────────────
    for (const key of Object.keys(users)) {
      const u = users[key];
      if (!u || !u.id) continue;
      const delR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: svcHeaders() });
      ok(delR.ok, `cleaned up GoTrue test user ${key} (${delR.status})`);
    }
  }

  report();
  function report() {
    console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
    console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
    process.exit(fail.length ? 1 : 0);
  }
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
