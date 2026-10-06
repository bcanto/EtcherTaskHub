// Offline unit tests for the MCP connector: api/_mcpAuth.js, api/_mcpActions.js, api/mcp.js,
// api/oauth/[...path].js — no browser, no network, no real Supabase or Vercel.
// Run: node .agents/mcp-logic-test.cjs     (prints PASS (n): / FAIL (n): like the other suites)
process.env.MCP_OAUTH_SECRET = 'test-secret-do-not-use-in-real-env';
process.env.MCP_ALLOWED_EMAIL = ' b.canto@etchersolutions.com , s.wignall@etchersolutions.com ';
const ALLOWED = 'b.canto@etchersolutions.com';
const ALLOWED2 = 's.wignall@etchersolutions.com';

const path = require('path');
const auth = require('../api/_mcpAuth.js');
const actions = require('../api/_mcpActions.js');

const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const clone = x => JSON.parse(JSON.stringify(x));

const base = path.resolve(__dirname, '../api');
const mockAbs = (abs, exp) => { require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };
const mock = (name, exp) => mockAbs(path.join(base, name), exp);
const freshRequire = rel => { delete require.cache[path.join(base, rel)]; return require(path.join(base, rel)); };

// ── _mcpAuth: token sign/verify ──────────────────────────────────────────────
{
  const t = auth.signToken({ kind: 'access', sub: 'u1', email: ALLOWED }, 3600);
  const p = auth.verifyToken(t);
  ok(!!p && p.sub === 'u1' && p.email === ALLOWED && p.kind === 'access', 'signToken/verifyToken round-trip preserves payload');

  const expired = auth.signToken({ kind: 'access', sub: 'u1' }, -1);
  ok(auth.verifyToken(expired) === null, 'an expired token fails verification');

  const tampered = t.slice(0, -2) + (t.slice(-2) === 'AA' ? 'BB' : 'AA');
  ok(auth.verifyToken(tampered) === null, 'a tampered signature fails verification');

  ok(auth.verifyToken('not-a-token') === null, 'garbage input fails verification without throwing');
  ok(auth.verifyToken('') === null, 'empty token fails verification without throwing');
}

// ── _mcpAuth: PKCE ────────────────────────────────────────────────────────────
{
  const crypto = require('crypto');
  const verifier = 'a-random-code-verifier-1234567890';
  const challenge = auth.b64url(crypto.createHash('sha256').update(verifier).digest());
  ok(auth.pkceMatches(verifier, challenge), 'matching PKCE verifier/challenge passes');
  ok(!auth.pkceMatches('wrong-verifier', challenge), 'wrong PKCE verifier fails');
  ok(!auth.pkceMatches('', challenge), 'empty PKCE verifier fails');
}

// ── _mcpAuth: allowlist ───────────────────────────────────────────────────────
{
  ok(auth.isAllowedEmail(ALLOWED), 'the first allow-listed email passes');
  ok(auth.isAllowedEmail(ALLOWED2), 'a second, comma-separated allow-listed email also passes');
  ok(auth.isAllowedEmail(ALLOWED.toUpperCase()), 'the check is case-insensitive');
  ok(auth.isAllowedEmail(ALLOWED2.toUpperCase()), 'the check is case-insensitive for the second email too');
  ok(!auth.isAllowedEmail('someone.else@etchersolutions.com'), 'a different email is rejected');
  ok(!auth.isAllowedEmail(''), 'an empty email is rejected');
  ok(auth.allowedEmails().length === 2 && auth.allowedEmails().includes(ALLOWED) && auth.allowedEmails().includes(ALLOWED2),
    'allowedEmails() parses the comma-separated list, trimming stray whitespace around entries and the comma');
}

// ── _mcpActions: fixture ─────────────────────────────────────────────────────
function fixture() {
  return {
    users: [
      { id: 'u1', name: 'Bruna Canto', email: ALLOWED, role: 'admin', active: true },
      { id: 'u2', name: 'Sam Wignall', email: 's.wignall@etchersolutions.com', role: 'staff', active: true },
    ],
    boards: [{ id: 'b1', name: 'Ops', clientId: 'c1' }],
    groups: [], tasks: [], emailIntake: [],
  };
}
const CALLER = { id: 'u1', name: 'Bruna Canto', email: ALLOWED };

{
  const data = fixture();
  ok(actions.resolveOwner(data, 's.wignall@etchersolutions.com', CALLER).id === 'u2', 'resolveOwner matches by exact email');
  ok(actions.resolveOwner(data, 'Sam Wignall', CALLER).id === 'u2', 'resolveOwner matches by exact name');
  ok(actions.resolveOwner(data, 'sam', CALLER).id === 'u2', 'resolveOwner matches by partial name');
  const none = actions.resolveOwner(data, 'Nobody Here', CALLER);
  ok(none.id === 'u1' && none.matched === false, 'resolveOwner falls back to the caller and reports matched:false');
}

{
  const data = fixture();
  const r1 = actions.createOrUpdateAction(data, { task: 'Reply to Acme re: invoice', outlookMessageId: 'msg-1', dueDate: '2026-10-05' }, CALLER);
  ok(r1.created === true && data.emailIntake.length === 1 && data.tasks.length === 0, 'create_action never creates a task directly — it queues a pending review item instead');
  ok(r1.task.status === 'pending' && r1.task.originalEmailId === 'msg-1', 'the queued item starts pending and carries the Outlook id');
  ok(r1.task.suggestedDueDate === '2026-10-05', 'the queued item carries the suggested due date');
  ok(!data.boards.some(bd => bd.id === 'b-email-triage'), 'no fixed Email Triage board is auto-created anymore');

  const r2 = actions.createOrUpdateAction(data, { task: 'Reply to Acme re: invoice', outlookMessageId: 'msg-1', dueDate: '2026-10-06' }, CALLER);
  ok(r2.created === false && data.emailIntake.length === 1, 'create_action with the same outlookMessageId updates the pending item instead of duplicating it');
  ok(r2.task.suggestedDueDate === '2026-10-06', 'the update changed the pending item’s suggested due date');

  const r3 = actions.createOrUpdateAction(data, { task: 'A different task entirely', outlookMessageId: 'msg-1' }, CALLER);
  ok(r3.created === true && data.emailIntake.length === 2, 'the same outlookMessageId with different task text queues a separate item (dedup key is the pair, not the id alone)');
}

{
  // Once a person has routed an item to a real board (what the Dashboard's Route dialog does),
  // create_action for that same email must update the routed task, not queue a second pending item.
  const data = fixture();
  data.tasks.push({
    id: 't-routed', boardId: 'b1', workboardId: 'b1', clientId: 'c1', groupId: null,
    name: 'Reply to Acme re: invoice', title: 'Reply to Acme re: invoice', status: 'not-started',
    ownerId: 'u1', endDate: '2026-10-05', tags: ['email-intake'],
    emailSource: { originalEmailId: 'msg-9' }, archived: false,
  });
  const r = actions.createOrUpdateAction(data, { task: 'Reply to Acme re: invoice', outlookMessageId: 'msg-9', status: 'Done' }, CALLER);
  ok(r.created === false && r.routed === true && data.emailIntake.length === 0, 'create_action for an already-routed email updates the real task, not the queue');
  ok(data.tasks[0].status === 'done', 'the routed task’s status was actually updated');
}

{
  const data = fixture();
  const { task: pendingItem } = actions.createOrUpdateAction(data, { task: 'Follow up with vendor' }, CALLER);
  let threw = false;
  try { actions.applyUpdate(data, { id: pendingItem.id, status: 'Done' }); } catch (e) { threw = e.code === 'not_yet_routed'; }
  ok(threw, 'update_action on a still-pending (not yet routed) item is refused with a clear reason');

  data.tasks.push({
    id: 't-real', boardId: 'b1', workboardId: 'b1', clientId: 'c1', groupId: null,
    name: 'Routed task', status: 'not-started', ownerId: 'u1', tags: ['email-intake'], emailSource: {}, archived: false,
  });
  const updated = actions.applyUpdate(data, { id: 't-real', status: 'Waiting', dueDate: '2026-11-01', owner: 's.wignall@etchersolutions.com' });
  ok(updated.status === 'blocked' && updated.endDate === '2026-11-01' && updated.ownerId === 'u2', 'update_action changes status/dueDate/owner on a routed task by id');

  let notFound = false;
  try { actions.applyUpdate(data, { id: 'not-a-real-id', status: 'Done' }); } catch (e) { notFound = e.code === 'not_found'; }
  ok(notFound, 'update_action on an unknown id throws not_found');

  data.tasks.push({ id: 'foreign', boardId: 'b1', name: 'Not ours', status: 'todo', tags: [], archived: false });
  let refused = false;
  try { actions.applyUpdate(data, { id: 'foreign', status: 'Done' }); } catch (e) { refused = e.code === 'not_found'; }
  ok(refused, 'update_action ignores a task the connector never touched (no email-intake tag) rather than editing it');
}

{
  const data = fixture();
  actions.createOrUpdateAction(data, { task: 'Still pending one' }, CALLER);
  data.tasks.push(
    { id: 't-open', boardId: 'b1', name: 'Open one', status: 'todo', ownerId: 'u2', endDate: '2026-10-01', tags: ['email-intake'], emailSource: {}, archived: false },
    { id: 't-done', boardId: 'b1', name: 'Done one', status: 'done', ownerId: 'u1', endDate: '2026-10-10', tags: ['email-intake'], emailSource: {}, archived: false },
    { id: 't-wait', boardId: 'b1', name: 'Waiting one', status: 'blocked', ownerId: 'u1', endDate: '2026-10-20', tags: ['email-intake'], emailSource: {}, archived: false },
  );

  ok(actions.listActions(data, {}).length === 4, 'list_actions with no filter returns the pending queue plus every routed item');
  ok(actions.listActions(data, { status: 'Done' }).length === 1, 'list_actions filters routed items by status');
  ok(actions.listActions(data, { status: 'pending' }).length === 1, 'list_actions can filter down to just the still-pending queue');
  ok(actions.listActions(data, { owner: 'Sam Wignall' }).length === 1, 'list_actions filters by owner name (routed items only)');
  ok(actions.listActions(data, { owner: 's.wignall@etchersolutions.com' }).length === 1, 'list_actions filters by owner email (routed items only)');
  ok(actions.listActions(data, { dueBefore: '2026-10-15' }).length === 2, 'list_actions filters by dueBefore (routed items only)');
  ok(actions.listActions(data, { dueAfter: '2026-10-15' }).length === 1, 'list_actions filters by dueAfter (routed items only)');
  const item = actions.listActions(data, { status: 'Done' })[0];
  ok(item.status === 'Done' && item.task === 'Done one' && !('name' in item), 'list_actions returns the friendly public shape, not the raw task object');
  ok(item.source === 'Email triage', 'the public shape includes source, so a caller can actually see it was auto-set');
  ok(item.board === 'Ops', 'the public shape includes which board a routed item landed on, since that now varies per item');
  const pendingPublic = actions.listActions(data, { status: 'pending' })[0];
  ok(pendingPublic.status === 'Pending review', 'a still-pending item is reported with a distinct, honest status rather than a fake Open/Waiting/Done');
}

// ── /api/mcp handler — now folded into api/oauth/[...path].js (blob mocked) ──────────────────
// Real production requests reach it via the vercel.json rewrite (/api/mcp -> .../oauth/mcp);
// here the query is injected directly, same effect, so every call site below is unchanged.
async function withHandler(fn) {
  let blob = fixture();
  mock('_blob.js', {
    readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }),
    casWrite: async (data) => { blob = data; return true; },
  });
  const real = freshRequire(path.join('oauth', '[...path].js'));
  const h = (req, res) => real({ ...req, query: { path: ['mcp'] } }, res);
  await fn(h, () => blob);
}
function mkRes() {
  const res = { code: 0, headers: {}, body: null };
  res.status = c => { res.code = c; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.send = b => { res.body = b; return res; };
  res.json = b => { res.body = JSON.stringify(b); return res; };
  res.end = () => res;
  return res;
}
function rpc(method, params, id) { return { jsonrpc: '2.0', id: id === undefined ? 1 : id, method, params }; }

(async () => {
  await withHandler(async (h) => {
    const res = mkRes();
    await h({ method: 'POST', headers: {}, body: rpc('tools/list') }, res);
    ok(res.code === 401, 'mcp: no Authorization header is rejected');
    ok(/oauth-protected-resource/.test(res.headers['WWW-Authenticate'] || ''), 'mcp: the 401 points at the protected-resource metadata');
  });

  await withHandler(async (h) => {
    const res = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer garbage' }, body: rpc('tools/list') }, res);
    ok(res.code === 401, 'mcp: a garbage bearer token is rejected');
  });

  await withHandler(async (h) => {
    const otherToken = auth.signToken({ kind: 'access', sub: 'u9', email: 'someone.else@etchersolutions.com' }, 3600);
    const res = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + otherToken }, body: rpc('tools/list') }, res);
    ok(res.code === 401, 'mcp: a validly-signed token for a NON-allow-listed email is still rejected');
  });

  const accessToken = auth.signToken({ kind: 'access', sub: 'u1', email: ALLOWED }, 3600);
  await withHandler(async (h) => {
    const res = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: rpc('tools/list') }, res);
    const names = JSON.parse(res.body).result.tools.map(t => t.name).sort();
    ok(res.code === 200 && names.join(',') === 'create_action,get_task,list_actions,list_boards,list_tasks,update_action', 'mcp: tools/list returns the original three tools plus the three new read-only ones');
  });

  await withHandler(async (h, getBlob) => {
    const res1 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'create_action', arguments: { task: 'Reply to Acme', outlookMessageId: 'm-1' } }) }, res1);
    const r1 = JSON.parse(res1.body).result.structuredContent;
    ok(r1.ok && r1.created && getBlob().emailIntake.length === 1 && getBlob().tasks.length === 0, 'mcp: tools/call create_action queues a pending review item through the full handler, not a task');
    ok(r1.item.status === 'Pending review', 'mcp: the public item shape reports it as pending review');

    const res2 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'create_action', arguments: { task: 'Reply to Acme', outlookMessageId: 'm-1', dueDate: '2026-12-01' } }) }, res2);
    const r2 = JSON.parse(res2.body).result.structuredContent;
    ok(r2.ok && !r2.created && getBlob().emailIntake.length === 1, 'mcp: calling create_action again with the same message id updates the pending item in place, through the full handler');

    const res3 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'list_actions', arguments: { status: 'pending' } }) }, res3);
    const r3 = JSON.parse(res3.body).result.structuredContent;
    ok(r3.ok && r3.items.length === 1, 'mcp: tools/call list_actions sees the pending queue item, through the full handler');

    const res4 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'update_action', arguments: { id: r1.item.id, status: 'Done' } }) }, res4);
    const r4 = JSON.parse(res4.body).result;
    ok(r4.isError === true && /pending review/.test(r4.content[0].text), 'mcp: update_action on a still-pending item is refused with a clear message, through the full handler');

    // Simulate a person routing it from the Dashboard: create the real task by hand, tagged the
    // same way triageConfirmRoute()/the bulk-route equivalent does, on an ordinary board — not a
    // fixed connector-owned one.
    const blob = getBlob();
    blob.boards = blob.boards || []; blob.boards.push({ id: 'b1', name: 'Ops', clientId: 'c1', archived: false });
    blob.tasks = blob.tasks || []; blob.tasks.push({
      id: 't-routed', boardId: 'b1', workboardId: 'b1', clientId: 'c1', groupId: null,
      name: 'Reply to Acme', title: 'Reply to Acme', status: 'not-started', ownerId: 'u1',
      tags: ['email-intake'], emailSource: { originalEmailId: 'm-1' }, archived: false,
    });
    blob.emailIntake.find(x => x.originalEmailId === 'm-1').status = 'routed';

    const res5 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'update_action', arguments: { id: 't-routed', owner: 'nobody@nowhere.test' } }) }, res5);
    const r5 = JSON.parse(res5.body).result;
    ok(r5.isError !== true, 'mcp: update_action on a routed task with an unmatched owner still succeeds (falls back rather than failing)');

    const res6 = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + accessToken },
      body: rpc('tools/call', { name: 'create_action', arguments: { task: 'Reply to Acme', outlookMessageId: 'm-1', status: 'Waiting' } }) }, res6);
    const r6 = JSON.parse(res6.body).result.structuredContent;
    ok(r6.ok && r6.item.status === 'Waiting' && getBlob().tasks.length === 1, 'mcp: create_action for an already-routed email updates the real routed task instead of re-queuing it, through the full handler');
  });

  // ── api/oauth/[...path].js (register/authorize/complete/token) ────────────
  const realAuth = require('../api/_mcpAuth.js');
  mockAbs(path.join(base, '_mcpAuth.js'), { ...realAuth, verifySupabaseSession: async (tok) =>
    tok === 'good-session' ? { id: 'u1', email: ALLOWED } :
    tok === 'good-session-2' ? { id: 'u2', email: ALLOWED2 } : null });
  const oauth = freshRequire(path.join('oauth', '[...path].js'));
  const req = (method, p, extra) => ({ method, query: { path: p.split('/') }, headers: { host: 'preview-xyz.vercel.app' }, ...extra });

  {
    const res = mkRes();
    await oauth(req('GET', 'as-metadata'), res);
    const meta = JSON.parse(res.body);
    ok(res.code === 200 && meta.issuer === 'https://preview-xyz.vercel.app' && /\/api\/oauth\/token$/.test(meta.token_endpoint), 'oauth: authorization-server metadata self-reports the request host (works on preview and prod alike)');
  }
  {
    const res = mkRes();
    await oauth(req('GET', 'prm-metadata'), res);
    const meta = JSON.parse(res.body);
    ok(res.code === 200 && meta.resource === 'https://preview-xyz.vercel.app/api/mcp', 'oauth: protected-resource metadata points at /api/mcp on this host');
  }

  let clientId;
  {
    const res = mkRes();
    await oauth(req('POST', 'register', { body: { redirect_uris: ['https://claude.ai/api/mcp/callback'] } }), res);
    const body = JSON.parse(res.body);
    clientId = body.client_id;
    const decoded = realAuth.verifyToken(clientId);
    ok(res.code === 201 && decoded && decoded.kind === 'client' && decoded.redirect_uris[0] === 'https://claude.ai/api/mcp/callback', 'oauth: register returns a client_id that encodes the redirect_uris it was given');
  }
  {
    const res = mkRes();
    await oauth(req('POST', 'register', { body: { redirect_uris: ['javascript:alert(1)'] } }), res);
    ok(res.code === 400, 'oauth: register refuses a non-http(s) redirect_uri');
  }

  const crypto = require('crypto');
  const verifier = 'unit-test-code-verifier-abcdefghijklmnop';
  const challenge = auth.b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = 'https://claude.ai/api/mcp/callback';
  {
    const res = mkRes();
    await oauth(req('GET', 'authorize', { query: { path: ['authorize'], response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: '</script><script>xss</script>' } }), res);
    ok(res.code === 200 && /Connect to TaskHub/.test(res.body), 'oauth: authorize renders the consent page for a valid, registered client');
    ok(!res.body.includes('</script><script>xss</script>'), 'oauth: a hostile state value cannot break out of the embedded <script> tag');
  }
  {
    const res = mkRes();
    await oauth(req('GET', 'authorize', { query: { path: ['authorize'], response_type: 'code', client_id: clientId, redirect_uri: 'https://not-registered.test/cb', code_challenge: challenge, code_challenge_method: 'S256' } }), res);
    ok(res.code === 400, 'oauth: authorize refuses a redirect_uri that does not match what was registered');
  }

  let authCode;
  {
    const res = mkRes();
    await oauth(req('POST', 'complete', { body: { accessToken: 'good-session', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, state: 'xyz' } }), res);
    const body = JSON.parse(res.body);
    ok(res.code === 200 && body.redirect.startsWith(redirectUri + '?code=') && body.redirect.includes('state=xyz'), 'oauth: complete mints a code and returns the right redirect_uri + state, for an allow-listed session');
    authCode = new URL(body.redirect).searchParams.get('code');
  }
  {
    const res = mkRes();
    await oauth(req('POST', 'complete', { body: { accessToken: 'bad-session', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge } }), res);
    ok(res.code === 403, 'oauth: complete rejects a session that is not the allow-listed account');
  }
  {
    const res = mkRes();
    await oauth(req('POST', 'complete', { body: { accessToken: 'good-session-2', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, state: 'xyz' } }), res);
    const body = JSON.parse(res.body);
    ok(res.code === 200 && body.redirect.startsWith(redirectUri + '?code='), 'oauth: complete also mints a code for the second allow-listed account (Sam)');
  }

  let refreshToken;
  {
    const res = mkRes();
    await oauth(req('POST', 'token', { body: { grant_type: 'authorization_code', code: authCode, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier } }), res);
    const body = JSON.parse(res.body);
    ok(res.code === 200 && body.access_token && body.refresh_token && body.token_type === 'Bearer', 'oauth: token exchanges a valid code for an access + refresh token');
    refreshToken = body.refresh_token;
    const decoded = realAuth.verifyToken(body.access_token);
    ok(decoded && decoded.kind === 'access' && decoded.email === ALLOWED, 'oauth: the minted access token carries the right identity and can be used against /api/mcp');
    ok(decoded && decoded.scope && decoded.scope.split(' ').includes('boards:read'), `oauth: a brand-new connection (no explicit scope requested) is granted boards:read automatically (got scope: "${decoded && decoded.scope}")`);
  }
  {
    const res = mkRes();
    await oauth(req('POST', 'token', { body: { grant_type: 'authorization_code', code: authCode, redirect_uri: redirectUri, client_id: clientId, code_verifier: 'wrong-verifier' } }), res);
    ok(res.code === 400, 'oauth: token rejects a mismatched PKCE verifier');
  }
  {
    const res = mkRes();
    await oauth(req('POST', 'token', { body: { grant_type: 'refresh_token', refresh_token: refreshToken } }), res);
    const body = JSON.parse(res.body);
    ok(res.code === 200 && body.access_token, 'oauth: token refreshes a new access token from a valid refresh token');
  }

  // ── list_boards / list_tasks / get_task (read-only, boards:read) ────────────────────────────
  // NOTE ON THE FIXTURE'S ROLES: this file's own pre-existing fixture (used by every test above)
  // has u1 (Bruna Canto) as role:'admin' and u2 (Sam Wignall) as role:'staff' — that is what
  // determines visibility via api/_mcpBoards.js's canViewBoard/canViewTask, faithfully mirrored
  // from index.html's own functions of the same name. Under that rule, ADMIN sees every board and
  // STAFF sees only boards marked all_internal, boards they own, or boards specifically shared
  // with them. The task that requested this feature described the opposite ("Sam sees all boards,
  // Bruna sees only her own") — if TaskHub's real production roles have that reversed relative to
  // this dev fixture, the outcome for each named person in production will be reversed too; this
  // suite tests the RULE faithfully (an admin-role account sees everything, a staff-role account
  // is limited to what it's actually granted), not a hardcoded assumption about which named person
  // holds which role. Flagged explicitly in the report back to the user rather than silently
  // asserting whichever outcome the prose described.
  function boardFixture() {
    return {
      users: [
        { id: 'u1', name: 'Bruna Canto', email: ALLOWED, role: 'admin', active: true },
        { id: 'u2', name: 'Sam Wignall', email: ALLOWED2, role: 'staff', active: true },
      ],
      clients: [{ id: 'c1', name: 'Acme Co', shortCode: 'ACM' }, { id: 'c2', name: 'Beta LLC', shortCode: 'BETA' }],
      boards: [
        { id: 'b1', name: 'Ops (all internal)', clientId: 'c1', visibility: 'all_internal', ownerId: 'u1', archived: false },
        { id: 'b2', name: 'Exec Only (private)', clientId: 'c1', visibility: 'private', ownerId: 'u1', archived: false },
        { id: 'b3', name: "Sam's Board (private, owned by Sam)", clientId: 'c2', visibility: 'private', ownerId: 'u2', archived: false },
        { id: 'b4', name: 'Shared With Sam (private)', clientId: 'c2', visibility: 'private', ownerId: 'u1', archived: false },
        { id: 'b5', name: 'Archived board', clientId: 'c1', visibility: 'all_internal', ownerId: 'u1', archived: true },
      ],
      boardShares: [{ boardId: 'b4', userId: 'u2' }],
      groups: [{ id: 'g1', boardId: 'b1', clientId: 'c1', name: 'Group A' }],
      tasks: [
        { id: 't1', boardId: 'b1', groupId: 'g1', name: 'Task on Ops', status: 'in-progress', priority: 'high', ownerId: 'u2', endDate: '2026-01-05', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', tags: [], archived: false },
        { id: 't2', boardId: 'b1', groupId: 'g1', name: 'Another Ops task', status: 'todo', priority: 'med', ownerId: 'u1', endDate: '2026-01-10', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z', tags: ['email-intake'], archived: false },
        { id: 't3', boardId: 'b1', groupId: 'g1', name: 'Done Ops task', status: 'done', priority: 'low', ownerId: 'u2', endDate: '2025-12-01', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z', tags: [], archived: false },
        { id: 't4', boardId: 'b2', groupId: null, name: 'Exec secret task', status: 'todo', priority: 'high', ownerId: 'u1', endDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], archived: false },
        { id: 't5', boardId: 'b3', groupId: null, name: "Sam's own task", status: 'todo', priority: 'low', ownerId: 'u2', endDate: '2026-02-01', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], archived: false },
        { id: 't6', boardId: 'b1', groupId: 'g1', parentTaskId: 't1', name: 'Subitem of Task on Ops', status: 'todo', priority: null, ownerId: null, endDate: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], archived: false },
      ],
      emailIntake: [],
    };
  }

  const READ_SCOPE = auth.SCOPE; // includes boards:read (current, correct scope)
  const brunaToken = auth.signToken({ kind: 'access', sub: 'u1', email: ALLOWED, scope: READ_SCOPE }, 3600);
  const samToken = auth.signToken({ kind: 'access', sub: 'u2', email: ALLOWED2, scope: READ_SCOPE }, 3600);
  const oldScopeToken = auth.signToken({ kind: 'access', sub: 'u1', email: ALLOWED, scope: 'actions:read actions:write' }, 3600);
  // A 3rd email, allow-listed only for the one call below (restored immediately after) — both of
  // this file's two normal allow-listed emails already match a fixture user by design (they ARE
  // Bruna/Sam), so "allow-listed but no matching staff record" needs a 3rd one to be constructible.
  const UNLINKED_EMAIL = 'unlinked.person@etchersolutions.com';
  const unlinkedToken = auth.signToken({ kind: 'access', sub: 'u-nobody', email: UNLINKED_EMAIL, scope: READ_SCOPE }, 3600);

  async function withBoardHandler(fn) {
    let blob = boardFixture();
    mock('_blob.js', {
      readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }),
      casWrite: async (data) => { blob = data; return true; },
    });
    const real = freshRequire(path.join('oauth', '[...path].js'));
    const h = (req, res) => real({ ...req, query: { path: ['mcp'] } }, res);
    await fn(h, () => blob);
  }
  async function call(h, token, name, args) {
    const res = mkRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer ' + token, host: 'taskhub.etchersolutions.com' }, body: rpc('tools/call', { name, arguments: args || {} }) }, res);
    const parsed = JSON.parse(res.body);
    return { httpCode: res.code, isError: parsed.result && parsed.result.isError, text: parsed.result && parsed.result.content && parsed.result.content[0] && parsed.result.content[0].text, data: parsed.result && parsed.result.structuredContent };
  }

  await withBoardHandler(async (h) => {
    // ── scope enforcement: an old-scoped (pre-existing) token still works for the ORIGINAL 3
    // tools exactly as before, but is refused with a clear reconnect message on the new ones. ────
    const oldToolsStillWork = await call(h, oldScopeToken, 'list_actions', {});
    ok(!oldToolsStillWork.isError, 'an old-scoped token (issued before boards:read existed) still works on the original list_actions — existing connections are unaffected');
    const oldTokenNewTool = await call(h, oldScopeToken, 'list_boards', {});
    ok(oldTokenNewTool.isError && /reconnect/i.test(oldTokenNewTool.text), `an old-scoped token gets a clear "reconnect" message on the new list_boards, not a silent failure (got: ${oldTokenNewTool.text})`);

    // ── visibility: admin (Bruna) sees every non-archived board ─────────────────────────────
    const brunaBoards = await call(h, brunaToken, 'list_boards', {});
    ok(!brunaBoards.isError && brunaBoards.data.boards.length === 4, `admin sees every non-archived board (got ${brunaBoards.data && brunaBoards.data.boards.length})`);
    ok(brunaBoards.data.boards.every(b => b.id !== 'b5'), 'the archived board never appears for anyone');
    const opsBoard = brunaBoards.data.boards.find(b => b.id === 'b1');
    ok(opsBoard && opsBoard.client === 'Acme Co' && opsBoard.taskCountByStatus['in-progress'] === 1 && opsBoard.taskCountByStatus['done'] === 1,
      `list_boards reports the right client and a real per-status task count (got ${JSON.stringify(opsBoard)})`);

    // ── visibility: staff (Sam) sees only all_internal (b1), owned (b3) and shared (b4) — NOT
    // the private, unshared, not-owned b2. ─────────────────────────────────────────────────────
    const samBoards = await call(h, samToken, 'list_boards', {});
    const samBoardIds = (samBoards.data.boards || []).map(b => b.id).sort();
    ok(samBoardIds.join(',') === 'b1,b3,b4', `staff sees exactly the all_internal + owned + shared boards, no more (got ${samBoardIds.join(',')})`);

    // ── an allow-listed email with no matching TaskHub user record gets a clear error, not a crash
    const savedAllowed = process.env.MCP_ALLOWED_EMAIL;
    process.env.MCP_ALLOWED_EMAIL = savedAllowed + ',' + UNLINKED_EMAIL;
    const unlinked = await call(h, unlinkedToken, 'list_boards', {});
    process.env.MCP_ALLOWED_EMAIL = savedAllowed;
    ok(unlinked.isError && /not be matched|account/i.test(unlinked.text), `an allow-listed account with no matching staff record is refused clearly (got: ${unlinked.text})`);
  });

  // ── personalBoard: a Private board can ALSO be hidden from admin/pm oversight — the gap a real
  // user report found (an admin could still see a staff member's board marked Private, because the
  // admin-sees-everything rule ran unconditionally before the visibility check even looked at who
  // it was shared with). Separate blob/handler so the base fixture above stays untouched. ─────────
  await (async () => {
    let personalBlob = boardFixture();
    personalBlob.boards.find(b => b.id === 'b3').personalBoard = true; // Sam's own private board
    mock('_blob.js', {
      readBlob: async () => ({ data: clone(personalBlob), updatedAt: 'v1' }),
      casWrite: async (data) => { personalBlob = data; return true; },
    });
    const real = freshRequire(path.join('oauth', '[...path].js'));
    const h = (req, res) => real({ ...req, query: { path: ['mcp'] } }, res);

    const brunaAfter = await call(h, brunaToken, 'list_boards', {});
    const brunaIds = (brunaAfter.data.boards || []).map(b => b.id).sort();
    ok(!brunaIds.includes('b3'), `a board marked personalBoard is hidden from admin too, not just other staff (got ${brunaIds.join(',')})`);
    ok(brunaIds.join(',') === 'b1,b2,b4', `admin still sees every OTHER private/all_internal board unaffected (got ${brunaIds.join(',')})`);

    const samAfter = await call(h, samToken, 'list_boards', {});
    const samIds = (samAfter.data.boards || []).map(b => b.id).sort();
    ok(samIds.includes('b3'), `the OWNER of a personalBoard still sees it themselves (got ${samIds.join(',')})`);
  })();

  await withBoardHandler(async (h) => {
    // ── list_tasks: visibility follows the same rule — Sam never sees a task on the private,
    // unshared b2, even by direct id filter. ────────────────────────────────────────────────────
    const samTasks = await call(h, samToken, 'list_tasks', {});
    const samTaskIds = (samTasks.data.items || []).map(t => t.id).sort();
    ok(!samTaskIds.includes('t4'), 'staff never sees a task on a private board they cannot open, even unfiltered');
    ok(samTaskIds.includes('t5'), 'staff sees a task on a private board they own');

    // ── list_tasks: includeDone defaults false, closed tasks excluded ───────────────────────────
    const brunaDefault = await call(h, brunaToken, 'list_tasks', {});
    ok(!brunaDefault.data.items.some(t => t.id === 't3'), 'a done task is excluded by default (includeDone defaults false)');
    const brunaIncludeDone = await call(h, brunaToken, 'list_tasks', { includeDone: true });
    ok(brunaIncludeDone.data.items.some(t => t.id === 't3'), 'includeDone:true brings the done task back');

    // ── list_tasks: filters ──────────────────────────────────────────────────────────────────────
    const byBoard = await call(h, brunaToken, 'list_tasks', { boardId: 'b1' });
    // 3, not 2: t1, t2, AND t6 (t1's subitem) all sit on b1 — list_tasks lists every visible task,
    // subitems included, cross-referenced via parentId/subitemIds rather than filtered out.
    ok(byBoard.data.items.every(t => t.boardId === 'b1') && byBoard.data.items.length === 3, `boardId filter matches only that board's (non-done) tasks, subitems included (got ${byBoard.data.items.length})`);
    const byClient = await call(h, brunaToken, 'list_tasks', { client: 'Beta LLC' });
    ok(byClient.data.items.every(t => t.client === 'Beta LLC'), 'client filter (by name) matches only that client\'s tasks');
    const byClientCode = await call(h, brunaToken, 'list_tasks', { client: 'ACM' });
    ok(byClientCode.data.items.length > 0 && byClientCode.data.items.every(t => t.client === 'Acme Co'), 'client filter also matches by short code');
    const byOwner = await call(h, brunaToken, 'list_tasks', { owner: 's.wignall@etchersolutions.com' });
    ok(byOwner.data.items.every(t => t.owner === 'Sam Wignall'), 'owner filter (by email) matches only that owner\'s tasks');
    const byOwnerName = await call(h, brunaToken, 'list_tasks', { owner: 'Sam Wignall' });
    ok(byOwnerName.data.items.length === byOwner.data.items.length, 'owner filter also matches by exact name');
    const byPriority = await call(h, brunaToken, 'list_tasks', { priority: 'high' });
    ok(byPriority.data.items.every(t => t.priority === 'high'), 'priority filter matches exactly');
    const byDueBefore = await call(h, brunaToken, 'list_tasks', { dueBefore: '2026-01-06' });
    ok(byDueBefore.data.items.every(t => t.dueDate && t.dueDate < '2026-01-06'), 'dueBefore filter excludes tasks due on/after the date');
    const byDueAfter = await call(h, brunaToken, 'list_tasks', { dueAfter: '2026-01-06' });
    ok(byDueAfter.data.items.every(t => t.dueDate && t.dueDate > '2026-01-06'), 'dueAfter filter excludes tasks due on/before the date');
    const byUpdatedSince = await call(h, brunaToken, 'list_tasks', { updatedSince: '2026-01-03T00:00:00Z', includeDone: true });
    ok(byUpdatedSince.data.items.every(t => t.updatedAt >= '2026-01-03T00:00:00Z'), 'updatedSince filter excludes tasks not touched since that time');
    const byStatus = await call(h, brunaToken, 'list_tasks', { status: 'todo' });
    ok(byStatus.data.items.every(t => t.status === 'todo'), 'status filter matches TaskHub\'s own internal status value exactly');

    // ── list_tasks: sorting ──────────────────────────────────────────────────────────────────────
    const sortedDue = await call(h, brunaToken, 'list_tasks', { boardId: 'b1' });
    const dueDates = sortedDue.data.items.map(t => t.dueDate);
    ok(JSON.stringify(dueDates) === JSON.stringify(dueDates.slice().sort()), `default sort is dueDate ascending (got ${JSON.stringify(dueDates)})`);
    const sortedPriority = await call(h, brunaToken, 'list_tasks', { sort: 'priority', includeDone: true });
    const priorities = sortedPriority.data.items.map(t => t.priority).filter(Boolean);
    const priorityRank = { high: 0, med: 1, low: 2 };
    ok(priorities.every((p, i) => i === 0 || priorityRank[priorities[i - 1]] <= priorityRank[p]), `sort:priority orders high -> med -> low (got ${JSON.stringify(priorities)})`);
    const sortedUpdated = await call(h, brunaToken, 'list_tasks', { sort: 'updatedAt', includeDone: true });
    const updated = sortedUpdated.data.items.map(t => t.updatedAt);
    ok(JSON.stringify(updated) === JSON.stringify(updated.slice().sort().reverse()), 'sort:updatedAt orders most-recently-updated first');

    // ── list_tasks: pagination ───────────────────────────────────────────────────────────────────
    const page1 = await call(h, brunaToken, 'list_tasks', { includeDone: true, limit: 2, offset: 0 });
    ok(page1.data.items.length === 2 && page1.data.total >= 5 && page1.data.nextOffset === 2, `limit:2 returns 2 items and a nextOffset (got ${JSON.stringify({ n: page1.data.items.length, total: page1.data.total, nextOffset: page1.data.nextOffset })})`);
    const page2 = await call(h, brunaToken, 'list_tasks', { includeDone: true, limit: 2, offset: page1.data.nextOffset });
    ok(!page2.data.items.some(t => page1.data.items.some(t1 => t1.id === t.id)), 'the second page never repeats a row from the first');
    const overLimit = await call(h, brunaToken, 'list_tasks', { limit: 9999, includeDone: true });
    ok(overLimit.data.items.length <= 200, 'limit is capped at 200 even when a caller asks for more');

    // ── get_task: full detail incl. subitems, parent, group ─────────────────────────────────────
    const parentDetail = await call(h, brunaToken, 'get_task', { id: 't1' });
    ok(!parentDetail.isError && parentDetail.data.task.subitems.length === 1 && parentDetail.data.task.subitems[0].id === 't6',
      `get_task on a parent includes its subitem (got ${JSON.stringify(parentDetail.data && parentDetail.data.task && parentDetail.data.task.subitems)})`);
    const childDetail = await call(h, brunaToken, 'get_task', { id: 't6' });
    ok(!childDetail.isError && childDetail.data.task.parent && childDetail.data.task.parent.id === 't1', 'get_task on a subitem includes its parent');
    ok(childDetail.data.task.groupDetail && childDetail.data.task.groupDetail.name === 'Group A', 'get_task includes the full group detail, not just its name');
    ok(parentDetail.data.task.url === 'https://taskhub.etchersolutions.com/?openTask=t1&openBoard=b1', `get_task returns a real, complete direct URL (got ${parentDetail.data.task.url})`);
    const notFound = await call(h, brunaToken, 'get_task', { id: 'no-such-task' });
    ok(notFound.isError, 'get_task on an unknown id returns a clear error, not a crash');
    const forbidden = await call(h, samToken, 'get_task', { id: 't4' });
    ok(forbidden.isError, 'get_task on a task Sam cannot see (private board b2) is refused, not silently returned');

    // ── source field distinguishes email-triage-routed tasks from ordinary ones ─────────────────
    const withSource = await call(h, brunaToken, 'list_tasks', {});
    const t2public = withSource.data.items.find(t => t.id === 't2');
    ok(t2public && t2public.source === 'email-triage', 'a task tagged email-intake reports source:"email-triage"');
    const t1public = withSource.data.items.find(t => t.id === 't1');
    ok(t1public && t1public.source === 'manual', 'an ordinary task reports source:"manual"');
  });

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  console.log('ERRORS: none');
  process.exit(fail.length ? 1 : 0);
})();
