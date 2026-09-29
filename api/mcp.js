// POST /api/mcp — the remote MCP server the Claude connector talks to (JSON-RPC 2.0 over plain
// HTTP; single-response "streamable HTTP" transport, no SSE — every tool here is a quick blob
// read/write, nothing needs a long-lived stream).
//
// Every request must carry a valid access token (see api/oauth/[...path].js for how one is
// minted) for the one allow-listed account (MCP_ALLOWED_EMAIL) — checked on every single call,
// not just at login. Anything else gets a 401 pointing at this server's OAuth metadata, which is
// how Claude's connector knows to run the sign-in flow.
const { verifyToken, isAllowedEmail, SCOPE } = require('./_mcpAuth');
const { readBlob, casWrite } = require('./_blob');
const { listActions, createOrUpdateAction, applyUpdate, toPublic } = require('./_mcpActions');

const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'list_actions',
    description: 'List action items on the Email Triage board, optionally filtered by status, owner or due date.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Open', 'Waiting', 'Done'], description: 'Filter by status.' },
        owner: { type: 'string', description: 'Filter by owner — a staff name or email.' },
        dueBefore: { type: 'string', description: 'YYYY-MM-DD — only items due before this date.' },
        dueAfter: { type: 'string', description: 'YYYY-MM-DD — only items due after this date.' },
      },
    },
  },
  {
    name: 'create_action',
    description: 'Create an action item from an email. If an item with the same outlookMessageId and task text already exists, it is updated instead of duplicated.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The action item text.' },
        owner: { type: 'string', description: 'Who owns this — a staff name or email. Defaults to the connected account if not recognised.' },
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
    description: 'Change the status, due date or owner of an existing action item.',
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
];

function send(res, status, body) {
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

function unauthorized(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${proto}://${host}/.well-known/oauth-protected-resource"`);
  send(res, 401, { error: 'unauthorized' });
}

async function callTool(name, args, caller) {
  args = args || {};
  if (name === 'list_actions') {
    const { data } = await readBlob();
    return { ok: true, items: listActions(data, args) };
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Protocol-Version');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.kind !== 'access' || !isAllowedEmail(payload.email)) {
    return unauthorized(req, res);
  }
  const caller = { id: payload.sub, name: payload.email };

  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send(res, 400, rpcError(null, -32600, 'Invalid request'));
  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      return send(res, 200, rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'taskhub-mcp', version: '1.0.0' },
      }));
    }
    if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) {
      return res.status(202).end();
    }
    if (method === 'tools/list') {
      return send(res, 200, rpcResult(id, { tools: TOOLS }));
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = params && params.arguments;
      try {
        const result = await callTool(name, args, caller);
        return send(res, 200, toolResult(id, result));
      } catch (e) {
        return send(res, 200, toolError(id, e.message || 'Tool call failed'));
      }
    }
    return send(res, 400, rpcError(id, -32601, `Unknown method: ${method}`));
  } catch (e) {
    console.error('[mcp]', e);
    return send(res, 500, rpcError(id, -32603, 'Internal error'));
  }
};
