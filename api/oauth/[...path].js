// /api/oauth/* — a minimal OAuth 2.1 authorization server for exactly the MCP connector at
// /api/mcp, restricted to one TaskHub account (MCP_ALLOWED_EMAIL). One catch-all file so this
// whole feature costs exactly one more Vercel serverless function, not five.
//
// Stateless by design: there is no database table anywhere in this flow. Every code/token is a
// signed, self-expiring token (see ../_mcpAuth.js) — including the OAuth "client_id" itself,
// which is a signed token embedding whatever redirect_uris the client registered with. Losing
// this process's memory between requests (normal for serverless) costs nothing, because
// nothing here depends on server memory.
//
// Routes (path = the catch-all segments after /api/oauth/):
//   GET  well-known/oauth-authorization-server   — RFC 8414 metadata (reached via a vercel.json rewrite from /.well-known/...)
//   GET  well-known/oauth-protected-resource     — RFC 9728 metadata (ditto)
//   POST register                                — RFC 7591 dynamic client registration
//   GET  authorize                               — renders the sign-in/consent page
//   POST complete                                — the consent page calls this once it has a verified TaskHub session
//   POST token                                   — RFC 6749 token endpoint (authorization_code + refresh_token grants)
const crypto = require('crypto');
const { signToken, verifyToken, pkceMatches, isAllowedEmail, allowedEmail, verifySupabaseSession, SCOPE } = require('../_mcpAuth');

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['host']}`;
}
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}
function isHttpUrl(u) {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch (_) { return false; }
}
// Safe to drop straight into an inline <script> tag: JSON-encoded, with any "<" escaped so a
// malicious query-string value (e.g. redirect_uri containing "</script>") can't break out of it.
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return Object.fromEntries(new URLSearchParams(req.body)); } catch (_) { return {}; }
  }
  return {};
}

function wellKnownAuthServer(req, res) {
  const base = baseUrl(req);
  json(res, 200, {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: SCOPE.split(' '),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
function wellKnownProtectedResource(req, res) {
  const base = baseUrl(req);
  json(res, 200, { resource: `${base}/api/mcp`, authorization_servers: [base] });
}

// RFC 7591. No persistence needed: the returned client_id IS the registration, signed so it
// can't be forged or edited (e.g. to add a redirect_uri that was never actually registered).
function register(req, res) {
  const body = readBody(req);
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length || !redirectUris.every(isHttpUrl)) {
    return json(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris must be a non-empty array of http(s) URLs' });
  }
  const clientId = signToken({ kind: 'client', redirect_uris: redirectUris }, 60 * 60 * 24 * 365);
  json(res, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}

function errorPage(res, status, title, detail) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;color:#1a2940">` +
    `<h2 style="margin-bottom:8px">${title}</h2><p style="color:#5b6770">${detail}</p></body></html>`
  );
}

function authorize(req, res) {
  const q = req.query || {};
  if (q.response_type !== 'code') return errorPage(res, 400, 'Unsupported request', 'response_type must be "code".');
  const clientPayload = verifyToken(q.client_id);
  if (!clientPayload || clientPayload.kind !== 'client') {
    return errorPage(res, 400, 'Unknown client', 'This client is not registered (or its registration expired) — try adding the connector again.');
  }
  if (!q.redirect_uri || !clientPayload.redirect_uris.includes(q.redirect_uri)) {
    return errorPage(res, 400, 'Redirect not allowed', 'redirect_uri does not match what this client registered.');
  }
  if (q.code_challenge_method !== 'S256' || !q.code_challenge) {
    return errorPage(res, 400, 'PKCE required', 'code_challenge with method S256 is required.');
  }

  const params = {
    client_id: q.client_id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge,
    state: q.state || '', scope: q.scope || SCOPE,
  };
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Connect to TaskHub</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:'Lato',system-ui,sans-serif;background:#f4f7fa;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:12px;padding:32px;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(13,28,51,0.08)}
  h1{font-size:18px;margin:0 0 6px;color:#0d1c33}
  p{font-size:13px;color:#5b6770;margin:0 0 20px;line-height:1.5}
  label{display:block;font-size:12px;font-weight:600;color:#1a2940;margin:14px 0 5px}
  input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #dbe3ea;border-radius:7px;font-size:14px}
  button{width:100%;margin-top:20px;padding:10px;border:none;border-radius:7px;background:#0d1c33;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  button:disabled{opacity:0.6;cursor:default}
  #msg{font-size:12px;color:#b91c1c;margin-top:10px;min-height:16px}
  #loading{text-align:center;color:#8da2b2;font-size:13px}
</style></head>
<body><div class="card">
  <h1>Connect to TaskHub</h1>
  <p>An app wants to read and update the Email Triage action register on your behalf.</p>
  <div id="loading">Checking your session…</div>
  <form id="f" style="display:none">
    <label for="email">Email</label><input id="email" type="email" autocomplete="username">
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">
    <button id="go" type="submit">Sign in and connect</button>
    <div id="msg"></div>
  </form>
</div>
<script>window.__P = ${embedJson(params)};</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script>
(async function(){
  const msgEl = document.getElementById('msg');
  const form = document.getElementById('f');
  const loading = document.getElementById('loading');
  const P = window.__P;
  let sb;
  try {
    const cfg = await (await fetch('/api/config')).json();
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (e) {
    loading.textContent = 'Could not reach TaskHub. Please try again.';
    return;
  }
  async function complete(accessToken) {
    loading.style.display = ''; loading.textContent = 'Connecting…';
    form.style.display = 'none';
    const r = await fetch('/api/oauth/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, client_id: P.client_id, redirect_uri: P.redirect_uri, code_challenge: P.code_challenge, state: P.state, scope: P.scope }),
    });
    const j = await r.json();
    if (!r.ok) {
      loading.style.display = 'none'; form.style.display = '';
      msgEl.textContent = j.error_description || 'This TaskHub account is not allowed to use this connector.';
      return;
    }
    window.location.href = j.redirect;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await complete(session.access_token); return; }
  loading.style.display = 'none'; form.style.display = '';
  form.addEventListener('submit', async function(ev){
    ev.preventDefault();
    document.getElementById('go').disabled = true; msgEl.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('pw').value;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msgEl.textContent = 'Incorrect email or password.'; document.getElementById('go').disabled = false; return; }
    await complete(data.session.access_token);
  });
})();
</script>
</body></html>`);
}

async function complete(req, res) {
  const body = readBody(req);
  const clientPayload = verifyToken(body.client_id);
  if (!clientPayload || clientPayload.kind !== 'client' || !clientPayload.redirect_uris.includes(body.redirect_uri)) {
    return json(res, 400, { error: 'invalid_request', error_description: 'Unknown client or redirect_uri.' });
  }
  const identity = await verifySupabaseSession(body.accessToken);
  if (!identity || !isAllowedEmail(identity.email)) {
    return json(res, 403, { error: 'access_denied', error_description: `This connector is restricted to ${allowedEmail()}.` });
  }
  const code = signToken({
    kind: 'code', sub: identity.id, email: identity.email,
    client_id: body.client_id, redirect_uri: body.redirect_uri, code_challenge: body.code_challenge,
    scope: body.scope || SCOPE,
  }, 120);
  const sep = body.redirect_uri.includes('?') ? '&' : '?';
  let redirect = `${body.redirect_uri}${sep}code=${encodeURIComponent(code)}`;
  if (body.state) redirect += `&state=${encodeURIComponent(body.state)}`;
  json(res, 200, { redirect });
}

async function token(req, res) {
  const body = readBody(req);
  if (body.grant_type === 'authorization_code') {
    const payload = verifyToken(body.code);
    if (!payload || payload.kind !== 'code') return json(res, 400, { error: 'invalid_grant' });
    if (payload.client_id !== body.client_id || payload.redirect_uri !== body.redirect_uri) {
      return json(res, 400, { error: 'invalid_grant', error_description: 'client_id/redirect_uri mismatch.' });
    }
    if (!pkceMatches(body.code_verifier, payload.code_challenge)) {
      return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed.' });
    }
    if (!isAllowedEmail(payload.email)) return json(res, 403, { error: 'access_denied' });
    return json(res, 200, issueTokens(payload.sub, payload.email, payload.scope));
  }
  if (body.grant_type === 'refresh_token') {
    const payload = verifyToken(body.refresh_token);
    if (!payload || payload.kind !== 'refresh') return json(res, 400, { error: 'invalid_grant' });
    if (!isAllowedEmail(payload.email)) return json(res, 403, { error: 'access_denied' });
    return json(res, 200, issueTokens(payload.sub, payload.email, payload.scope));
  }
  return json(res, 400, { error: 'unsupported_grant_type' });
}
function issueTokens(sub, email, scope) {
  return {
    access_token: signToken({ kind: 'access', sub, email, scope }, 3600),
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: signToken({ kind: 'refresh', sub, email, scope }, 60 * 60 * 24 * 30),
    scope,
  };
}

// Vercel's plain (non-Next.js) catch-all convention puts the captured segments under the
// query key "...path" (the literal bracket contents, ellipsis included) — not "path" — and as
// a single already-joined string for this shape, not an array. Handling both a string and an
// array here rather than hard-coding that one observed shape, since it's undocumented behaviour
// discovered by deploying and inspecting the actual request, not something to rely on exactly.
function pathParts(req) {
  const raw = req.query['...path'] !== undefined ? req.query['...path'] : req.query.path;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split('/').filter(Boolean);
  return [];
}

module.exports = async function handler(req, res) {
  const path = pathParts(req).join('/');
  try {
    // Flat, single-segment names — this project's plain (non-Next.js) Vercel function router
    // turns out not to support true multi-level catch-all (confirmed by deploying and testing
    // directly): a request for /api/oauth/well-known/oauth-authorization-server (two segments)
    // 404s at the platform level before it ever reaches this file, even though the exact same
    // file happily handles /api/oauth/register (one segment). vercel.json rewrites the real
    // /.well-known/... URLs to these flat names instead of trying to preserve their path shape.
    if (path === 'as-metadata' && req.method === 'GET') return wellKnownAuthServer(req, res);
    if (path === 'prm-metadata' && req.method === 'GET') return wellKnownProtectedResource(req, res);
    if (path === 'register' && req.method === 'POST') return register(req, res);
    if (path === 'authorize' && req.method === 'GET') return authorize(req, res);
    if (path === 'complete' && req.method === 'POST') return await complete(req, res);
    if (path === 'token' && req.method === 'POST') return await token(req, res);
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[oauth]', path, e);
    return json(res, 500, { error: 'server_error' });
  }
};
