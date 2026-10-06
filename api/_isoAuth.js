// Who is calling api/iso.js. Leading underscore = shared module, not a Vercel route.
// See docs/iso-audit-integration-plan.md §4.3 for the exact contract every condition here
// implements — this file is deliberately conservative (fail closed) since it decides both which
// data store is used (offline vs. the live Supabase project) and who the caller is allowed to act
// as.
const { requireAuthedCaller } = require('./_authAdmin');
const { readBlob } = require('./_blob');

// True only when ALL of these hold. Every condition is read fresh on every call — nothing here is
// cached — because env vars and globals can differ per request in a serverless environment, and a
// stale true here would let a request skip real Supabase auth entirely.
function isoOfflineMode() {
  return globalThis.__TASKHUB_SERVE_OFFLINE === true
    && process.env.ISO_OFFLINE === '1'
    && !process.env.VERCEL
    && !process.env.VERCEL_ENV
    && !process.env.AWS_LAMBDA_FUNCTION_NAME
    && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
// Deviation from the plan's literal "Host ∈ {localhost:3001, 127.0.0.1:3001, [::1]:3001}" (logged
// as A20): the plan's own §4.2 has every ISO HTTP/Puppeteer suite spawn `serve.mjs --offline
// --port 31xx` (never :3001, which is the shared dev server) — a hard-coded :3001 check would
// make the offline header unusable by any of those suites, which need it to impersonate a client
// or a specific role. The port number isn't the security-relevant part of this check anyway: it
// exists to defeat DNS rebinding, where an attacker's page makes the browser send a request whose
// Host is an attacker-controlled hostname that merely *resolves* to 127.0.0.1 — the browser still
// sends that original hostname as Host, never "localhost" or "127.0.0.1", regardless of port. So
// this checks the hostname only, on whatever port this server instance is actually listening on.
function _hostnameOf(hostHeader) {
  const s = String(hostHeader || '');
  const m = /^(\[[^\]]+\]|[^:]+)(:\d+)?$/.exec(s);
  return m ? m[1] : s;
}

// The offline impersonation header — this is also how UI tests impersonate clients
// (role:'client', clientId:'c1'). Every guard below must hold or this returns null; the caller
// never learns which guard failed (all paths collapse to the same 401 from resolveIsoCaller).
function _offlineHeaderCaller(req) {
  const raw = req.headers['x-iso-offline-user'];
  if (!raw || !isoOfflineMode()) return null;
  const remote = req.socket && req.socket.remoteAddress;
  if (!remote || !LOOPBACK.has(remote)) return null; // never trust X-Forwarded-For
  const host = req.headers['host'];
  if (!host || !LOCAL_HOSTNAMES.has(_hostnameOf(host))) return null;
  const origin = req.headers['origin'];
  // Same port-independence as the Host check above (A20): compare only scheme+hostname. (URL's
  // .hostname strips IPv6 brackets, unlike a raw Host header, hence the separate '::1' case.)
  if (origin) {
    let originUrl = null;
    try { originUrl = new URL(origin); } catch (e) { return null; }
    const hostnameOk = originUrl.hostname === '::1' || LOCAL_HOSTNAMES.has(originUrl.hostname);
    if (!/^https?:$/.test(originUrl.protocol) || !hostnameOk) return null;
  }
  let parsed;
  try { parsed = JSON.parse(decodeURIComponent(raw)); } catch (e) { return null; }
  if (!parsed || typeof parsed !== 'object' || !parsed.id) return null;
  const role = parsed.role || 'staff';
  const isClient = role === 'client';
  return {
    uid: 'offline:' + parsed.id,
    kind: isClient ? 'client' : 'staff',
    role,
    clientId: isClient ? (parsed.clientId || null) : null,
    name: parsed.name || parsed.id,
    active: true,
    restricted: role === 'restricted',
  };
}

// Restricted staff resolution (Supabase mode): the profiles enum has no 'restricted' — it exists
// only in the blob's DB.users. A blob read failure fails closed (treats the caller as restricted)
// rather than silently granting full staff visibility.
async function _isRestrictedStaff(uid) {
  try {
    const blob = await readBlob();
    const u = (blob.data.users || []).find(x => x.supabase_uid === uid || x.id === uid);
    return u ? u.role === 'restricted' : true;
  } catch (e) {
    return true;
  }
}

async function _supabaseCaller(req, res) {
  const caller = await requireAuthedCaller(req, res);
  if (!caller) return null; // response already sent (401)
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,client_id,name,active&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!profileResp.ok) { res.status(500).json({ error: 'Could not verify caller' }); return null; }
  const p = (await profileResp.json())[0];
  if (!p || p.active === false) { res.status(403).json({ error: 'Inactive account' }); return null; }
  const isClient = p.role === 'client';
  const restricted = isClient ? false : await _isRestrictedStaff(caller.id);
  if (!isClient && !['admin', 'pm', 'staff'].includes(p.role) && !restricted) {
    // profiles has no 'restricted' value (see _isRestrictedStaff) — anything else is not a valid
    // ISO caller role.
    res.status(403).json({ error: 'ISO access required' });
    return null;
  }
  return {
    uid: caller.id,
    kind: isClient ? 'client' : 'staff',
    role: isClient ? 'client' : (restricted ? 'restricted' : p.role),
    clientId: isClient ? p.client_id : null,
    name: String(p.name || 'User').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'User',
    active: true,
    restricted,
  };
}

// Resolves who is calling api/iso.js, or sends the response and returns null.
async function resolveIsoCaller(req, res) {
  const offline = _offlineHeaderCaller(req);
  if (offline) return offline;
  if (isoOfflineMode()) {
    // Offline mode never falls through to a real Supabase auth attempt — there are no real
    // credentials configured, and doing so would either hang or hit the wrong project.
    res.status(401).json({ error: 'Missing or invalid X-ISO-Offline-User header' });
    return null;
  }
  return _supabaseCaller(req, res);
}

module.exports = { isoOfflineMode, resolveIsoCaller };
