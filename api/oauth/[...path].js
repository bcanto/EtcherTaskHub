// /api/oauth/* AND /api/mcp — the MCP connector's OAuth server plus the connector endpoint
// itself, both in this one catch-all file so the whole feature costs exactly one Vercel
// serverless function, not two. /api/mcp is reached via a vercel.json rewrite to this file's
// own "mcp" sub-route, same trick already used for the two /.well-known/... routes below.
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
//   *    mcp                                     — the MCP JSON-RPC endpoint itself (reached via a vercel.json rewrite from /api/mcp)
const { signToken, verifyToken, pkceMatches, isAllowedEmail, allowedEmails, verifySupabaseSession, SCOPE } = require('../_mcpAuth');
const { readBlob, casWrite } = require('../_blob');
const { listActions, createOrUpdateAction, applyUpdate, toPublic } = require('../_mcpActions');
const { resolveCallerUser, listBoardsForUser, listTasksForUser, getTaskForUser } = require('../_mcpBoards');

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
  <p>An app wants to add items to your TaskHub Email Triage review queue, update ones you've already routed to a WorkBoard, and read the WorkBoards and tasks you can already see in TaskHub. It cannot create, edit or delete a WorkBoard task, and cannot see anything you can't already see yourself.</p>
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
    return json(res, 403, { error: 'access_denied', error_description: `This connector is restricted to ${allowedEmails().join(', ')}.` });
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

// ── /api/mcp — the MCP JSON-RPC endpoint (formerly its own api/mcp.js; folded in here to save
// a function slot). Every request must carry a valid access token for the one allow-listed
// account, checked on every single call, not just at login. Anything else gets a 401 pointing
// at this server's OAuth metadata, which is how Claude's connector knows to run the sign-in flow.
const MCP_PROTOCOL_VERSION = '2025-06-18';
const MCP_TOOLS = [
  {
    name: 'list_actions',
    description: 'List action items pulled from email. Items still waiting for a person to route them to a WorkBoard show status "Pending review"; once routed, an item shows its real status and which board it landed on. Optionally filtered by status, owner or due date (owner/due-date filters only match already-routed items).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Open', 'Waiting', 'Done', 'pending'], description: 'Filter by status. "pending" returns only items still waiting to be routed.' },
        owner: { type: 'string', description: 'Filter by owner — a staff name or email. Only matches already-routed items.' },
        dueBefore: { type: 'string', description: 'YYYY-MM-DD — only items due before this date. Only matches already-routed items.' },
        dueAfter: { type: 'string', description: 'YYYY-MM-DD — only items due after this date. Only matches already-routed items.' },
      },
    },
  },
  {
    name: 'create_action',
    description: 'Queue an action item from an email for review in TaskHub\'s Email Triage dashboard panel — a person routes it to the correct WorkBoard, client, group and owner from there, so it is never created directly on a board. If an item with the same outlookMessageId and task text already exists — pending or already routed — it is updated instead of duplicated.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The action item text.' },
        owner: { type: 'string', description: 'Who owns this — a staff name or email. Only takes effect once the item has been routed to a board.' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        emailSubject: { type: 'string', description: 'Subject line of the source email.' },
        emailLink: { type: 'string', description: 'Outlook web link to the source email.' },
        outlookMessageId: { type: 'string', description: 'Outlook message id — used to avoid creating duplicates.' },
        notes: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'med', 'high'] },
      },
      required: ['task'],
    },
  },
  {
    name: 'update_action',
    description: 'Change the status, due date or owner of an action item that has already been routed to a WorkBoard. An item still pending review must be routed from the TaskHub dashboard first — this returns an error explaining that instead of guessing a board.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The action item id, from list_actions or create_action.' },
        status: { type: 'string', enum: ['Open', 'Waiting', 'Done'] },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        owner: { type: 'string', description: 'A staff name or email.' },
      },
      required: ['id'],
    },
  },
  // ── Read-only WorkBoard/task tools (boards:read) — everything here is a plain read, scoped to
  // exactly what the caller can already see logged into TaskHub itself: an admin/pm sees every
  // board, everyone else sees boards marked "all internal", boards they own, and boards
  // specifically shared with them (api/_mcpBoards.js mirrors index.html's own canViewBoard/
  // canViewTask so this can never drift from what the UI actually shows). ─────────────────────
  {
    name: 'list_boards',
    description: 'List the WorkBoards visible to you (an admin/pm sees every board; anyone else sees boards marked "all internal", boards they own, and boards specifically shared with them) — each with its client and a count of its tasks per status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks',
    description: 'List tasks across every WorkBoard visible to you, optionally filtered. Closed tasks (done/completed/completed-approved/cancelled) are excluded unless includeDone is true. Sorted by due date (soonest first, no-due-date last) by default.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'Only tasks on this board (from list_boards).' },
        client: { type: 'string', description: 'Only tasks whose board belongs to this client — a client name or short code.' },
        owner: { type: 'string', description: 'Only tasks owned by or assigned to this person — a staff name or email.' },
        status: { type: 'string', description: 'TaskHub\'s own internal status value, e.g. "todo", "in-progress", "blocked", "done" — exactly as returned by these tools, not a display label.' },
        priority: { type: 'string', enum: ['low', 'med', 'high'] },
        dueBefore: { type: 'string', description: 'YYYY-MM-DD' },
        dueAfter: { type: 'string', description: 'YYYY-MM-DD' },
        updatedSince: { type: 'string', description: 'ISO date/time — only tasks updated at or after this.' },
        includeDone: { type: 'boolean', description: 'Include closed tasks too. Default false.' },
        sort: { type: 'string', enum: ['dueDate', 'priority', 'updatedAt'], description: 'Default dueDate (ascending; no due date sorts last). priority is high-med-low. updatedAt is most-recent first.' },
        limit: { type: 'number', description: 'Default 50, max 200.' },
        offset: { type: 'number', description: 'For pagination — pass back the previous call\'s nextOffset. Default 0.' },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Full detail for one task: everything list_tasks returns, plus its description, its parent task (if it\'s a subitem), its group, and its own subitems.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The task id, from list_tasks.' } }, required: ['id'] },
  },
];
// Tools added after the original 3 that require the caller's token to actually carry the new
// scope — see _mcpAuth.js's SCOPE comment for why this is enforced here but not on the original 3.
const READ_TOOLS = new Set(['list_boards', 'list_tasks', 'get_task']);

function mcpSend(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function toolResult(id, payload) {
  return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload });
}
function toolError(id, message) {
  return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
}
function mcpUnauthorized(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${proto}://${host}/.well-known/oauth-protected-resource"`);
  mcpSend(res, 401, { error: 'unauthorized' });
}

async function callTool(name, args, caller, base) {
  args = args || {};
  if (READ_TOOLS.has(name) && !(caller.scope || '').split(' ').includes('boards:read')) {
    throw Object.assign(new Error('This connection was authorised before board/task access existed — disconnect and reconnect the TaskHub connector to grant it.'), { code: 'scope_required' });
  }
  if (name === 'list_actions') {
    const { data } = await readBlob();
    return { ok: true, items: listActions(data, args) };
  }
  if (READ_TOOLS.has(name)) {
    const { data } = await readBlob();
    const user = resolveCallerUser(data, caller.id, caller.email);
    if (!user) throw Object.assign(new Error('Your TaskHub account could not be matched to a staff record — ask an admin to check your account.'), { code: 'account_not_linked' });
    if (name === 'list_boards') return { ok: true, boards: listBoardsForUser(data, user) };
    if (name === 'list_tasks') return { ok: true, ...listTasksForUser(data, user, args, base) };
    if (name === 'get_task') {
      if (!args.id) throw Object.assign(new Error('id is required'), { code: 'invalid_params' });
      return { ok: true, task: getTaskForUser(data, user, args.id, base) };
    }
  }
  if (name === 'create_action') {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, updatedAt } = await readBlob();
      const { task, created, ownerMatched } = createOrUpdateAction(data, args, caller);
      data._savedAt = new Date().toISOString();
      if (await casWrite(data, updatedAt)) {
        return { ok: true, created, ownerMatched, item: toPublic(data, task) };
      }
      await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
    }
    throw Object.assign(new Error('TaskHub is saving changes right now — please try again in a moment.'), { code: 'conflict' });
  }
  if (name === 'update_action') {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, updatedAt } = await readBlob();
      const task = applyUpdate(data, args);
      data._savedAt = new Date().toISOString();
      if (await casWrite(data, updatedAt)) {
        return { ok: true, item: toPublic(data, task) };
      }
      await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
    }
    throw Object.assign(new Error('TaskHub is saving changes right now — please try again in a moment.'), { code: 'conflict' });
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'not_found' });
}

async function mcp(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Protocol-Version');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return mcpSend(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.kind !== 'access' || !isAllowedEmail(payload.email)) {
    return mcpUnauthorized(req, res);
  }
  // caller.email is new — the original code only ever set .name (to the email address, so
  // create_action's "from" field silently stayed empty forever; harmless since it was never
  // surfaced, but real). Added because the read-only tools below need the real email to resolve
  // the caller's actual TaskHub user record; .name/.id are untouched so the 3 original tools'
  // existing behaviour (including that quirk) is unaffected.
  const caller = { id: payload.sub, name: payload.email, email: payload.email, scope: payload.scope || '' };

  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return mcpSend(res, 400, rpcError(null, -32600, 'Invalid request'));
  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      return mcpSend(res, 200, rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'taskhub-mcp', version: '1.0.0' },
      }));
    }
    if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) {
      return res.status(202).end();
    }
    if (method === 'tools/list') {
      return mcpSend(res, 200, rpcResult(id, { tools: MCP_TOOLS }));
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = params && params.arguments;
      try {
        const result = await callTool(name, args, caller, baseUrl(req));
        return mcpSend(res, 200, toolResult(id, result));
      } catch (e) {
        return mcpSend(res, 200, toolError(id, e.message || 'Tool call failed'));
      }
    }
    return mcpSend(res, 400, rpcError(id, -32601, `Unknown method: ${method}`));
  } catch (e) {
    console.error('[mcp]', e);
    return mcpSend(res, 500, rpcError(id, -32603, 'Internal error'));
  }
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
    if (path === 'mcp') return await mcp(req, res);
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[oauth]', path, e);
    return json(res, 500, { error: 'server_error' });
  }
};
