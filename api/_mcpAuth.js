// Shared helpers for the MCP connector's OAuth layer (api/oauth/[...path].js) and the MCP
// endpoint itself (api/mcp.js). Leading underscore = shared module, not a Vercel route.
//
// There is no database table behind any of this. Every "code"/"access token"/"refresh
// token"/"client_id" this app issues is a signed, self-contained token (HMAC-SHA256, same
// shape as a JWT) carrying its own expiry and whatever the holder is allowed to do — verified
// against MCP_OAUTH_SECRET, a random value set only in Vercel's env. Rotating that secret
// instantly invalidates every token ever issued; there is nothing else to revoke.
//
// The connector is for a short, explicit allowlist of TaskHub accounts (MCP_ALLOWED_EMAIL — comma-
// separated for more than one). Anyone can still run the OAuth dance and prove who they are via a
// real TaskHub login, same as api/_authAdmin.js does for the rest of the app — but only an
// allowlisted email is ever allowed past login, and it is checked again on every single token
// verification, not just at login time.
const crypto = require('crypto');

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

const TOKEN_HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function _secret() {
  const s = process.env.MCP_OAUTH_SECRET;
  if (!s) throw new Error('MCP_OAUTH_SECRET not configured');
  return s;
}

// Signs a payload (plain object) into a compact token. `ttlSeconds` sets exp = now + ttl.
function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = b64url(crypto.createHmac('sha256', _secret()).update(`${TOKEN_HEADER}.${body}`).digest());
  return `${TOKEN_HEADER}.${body}.${sig}`;
}

// Verifies signature + expiry. Returns the payload object, or null if invalid/expired/malformed.
// Never throws on bad input — every caller treats null as "reject", so a malformed token from
// the outside world must not be able to crash the request.
function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', _secret()).update(`${h}.${body}`).digest();
    const gotSig = b64urlDecode(sig);
    if (expectedSig.length !== gotSig.length || !crypto.timingSafeEqual(expectedSig, gotSig)) return null;
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// PKCE (RFC 7636, S256 only — this server never accepts the "plain" method).
function pkceMatches(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const a = Buffer.from(computed), b = Buffer.from(String(codeChallenge));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// MCP_ALLOWED_EMAIL is one email, or several separated by commas ("a@x.com,b@x.com").
function allowedEmails() {
  const list = (process.env.MCP_ALLOWED_EMAIL || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) throw new Error('MCP_ALLOWED_EMAIL not configured');
  return list;
}
function isAllowedEmail(email) {
  return !!email && allowedEmails().includes(String(email).trim().toLowerCase());
}

// Verifies a browser-supplied Supabase access token via GoTrue and returns { id, email }, or
// null (nothing sent to res — callers decide how to report the failure, since one call site
// is a JSON API and the other is an HTML consent page).
async function verifySupabaseSession(accessToken) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !accessToken) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id || !u.email) return null;
    return { id: u.id, email: u.email };
  } catch (_) {
    return null;
  }
}

// boards:read is new (read-only WorkBoards/tasks) — actions:read/actions:write are unchanged and
// still never enforced per-call (see api/oauth/[...path].js's callTool), so an existing connection
// keeps working exactly as before for the 3 original tools with no action needed. boards:read IS
// enforced on the 3 new tools (there is no pre-existing behaviour of theirs to protect), so an
// already-issued token/refresh-token — signed before this scope existed — gets a clear
// "reconnect the connector" error on list_boards/list_tasks/get_task until the holder reconnects
// and consents to the wider scope.
const SCOPE = 'actions:read actions:write boards:read';

module.exports = {
  b64url, b64urlDecode, signToken, verifyToken, pkceMatches,
  allowedEmails, isAllowedEmail, verifySupabaseSession, SCOPE,
};
