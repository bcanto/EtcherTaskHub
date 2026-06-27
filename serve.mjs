import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

// ── Load .env file (no npm dotenv needed) ────────────────────────────────────
// Falls back to process.env — works in both local dev and hosted environments.
const _env = {};
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    _env[key] = val;
  }
} catch (_) {
  // .env not found — Supabase features will be disabled until credentials are added
}

const SUPABASE_URL      = _env.SUPABASE_URL      || process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (SUPABASE_URL) {
  console.log(`  Supabase: ${SUPABASE_URL}`);
} else {
  console.log('  Supabase: not configured (add .env to enable)');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// B6: Cache-Control per asset type
const CACHE_CONTROL = {
  '.html': 'no-cache, must-revalidate',
  '.css':  'public, max-age=86400',
  '.js':   'public, max-age=86400',
  '.mjs':  'public, max-age=86400',
  '.json': 'no-cache, must-revalidate',
  '.png':  'public, max-age=2592000, immutable',
  '.jpg':  'public, max-age=2592000, immutable',
  '.jpeg': 'public, max-age=2592000, immutable',
  '.gif':  'public, max-age=2592000, immutable',
  '.svg':  'public, max-age=2592000, immutable',
  '.ico':  'public, max-age=2592000, immutable',
  '.woff': 'public, max-age=31536000, immutable',
  '.woff2':'public, max-age=31536000, immutable',
  '.ttf':  'public, max-age=31536000, immutable',
};

// B2: Security headers applied to every response
// Supabase domains added to script-src (CDN), connect-src (API + realtime), img-src (storage)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://placehold.co https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'X-XSS-Protection':        '1; mode=block',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
};

const _ROOT = path.resolve(__dirname);

// ── Email Intake Queue (file-backed in-memory store) ─────────────────────────
// email-intake.mjs POSTs to /api/intake; browser polls /api/intake/pending.
// When Supabase is live this moves to the email_intake table (see 004_email_intake.sql).
const _INTAKE_PATH = path.join(__dirname, 'intake-queue.json');
let _intakeQueue = [];
try { _intakeQueue = JSON.parse(fs.readFileSync(_INTAKE_PATH, 'utf-8')); } catch (_) {}
function _saveIntakeQueue() {
  try { fs.writeFileSync(_INTAKE_PATH, JSON.stringify(_intakeQueue, null, 2)); } catch (_) {}
}

// Helper: read entire request body as string
function _readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Bad Request');
    return;
  }

  // ── Email Intake API ─────────────────────────────────────────────────────────

  // POST /api/intake — email-intake.mjs posts a parsed email here
  if (urlPath === '/api/intake' && req.method === 'POST') {
    try {
      const body = await _readBody(req);
      const item = JSON.parse(body);
      if (!item.id)         item.id         = 'ei_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (!item.status)     item.status     = 'pending';
      if (!item.receivedAt) item.receivedAt = new Date().toISOString();
      _intakeQueue.push(item);
      _saveIntakeQueue();
      console.log(`[Intake] Queued: "${item.subject}" from ${item.from}`);
      res.writeHead(201, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, id: item.id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Bad Request');
    }
    return;
  }

  // GET /api/intake/pending — browser polls this every 30 s
  if (urlPath === '/api/intake/pending' && req.method === 'GET') {
    const pending = _intakeQueue.filter(x => x.status === 'pending');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(JSON.stringify(pending));
    return;
  }

  // POST /api/intake/ack/:id — browser marks an item as routed or discarded
  if (urlPath.startsWith('/api/intake/ack/') && req.method === 'POST') {
    const id = urlPath.slice('/api/intake/ack/'.length);
    try {
      const body = await _readBody(req);
      const { status, taskId } = JSON.parse(body);
      const item = _intakeQueue.find(x => x.id === id);
      if (item) {
        item.status   = status || 'routed';
        item.ackedAt  = new Date().toISOString();
        if (taskId) item.routedToTaskId = taskId;
        _saveIntakeQueue();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Bad Request');
    }
    return;
  }

  // GET /api/webhook/graph — Microsoft's subscription validation handshake
  // POST /api/webhook/graph — incoming change notification from Graph
  if (urlPath === '/api/webhook/graph') {
    if (req.method === 'GET') {
      const token = new URL(req.url, 'http://localhost').searchParams.get('validationToken');
      if (token) {
        res.writeHead(200, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
        res.end(token); // must echo back token within 10 s for subscription to activate
      } else {
        res.writeHead(400, SECURITY_HEADERS); res.end();
      }
      return;
    }
    if (req.method === 'POST') {
      // Acknowledge immediately (Graph requires 202 within 3 s)
      res.writeHead(202, SECURITY_HEADERS); res.end();
      // Process asynchronously — email-intake.mjs will poll and do the real work
      _readBody(req).then(b => {
        try { console.log('[Webhook] Graph notification:', JSON.stringify(JSON.parse(b)).slice(0, 160)); }
        catch (_) {}
      }).catch(() => {});
      return;
    }
  }

  // ── /api/config — exposes ONLY the public (anon) Supabase credentials ──────
  // The service role key NEVER goes here — it stays server-side only.
  if (req.method === 'GET' && urlPath === '/api/config') {
    const payload = JSON.stringify({
      supabaseUrl:      SUPABASE_URL,
      supabaseAnonKey:  SUPABASE_ANON_KEY,
    });
    res.writeHead(200, {
      'Content-Type':  'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      ...SECURITY_HEADERS,
    });
    res.end(payload);
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.resolve(__dirname, '.' + urlPath);
  // Prevent path traversal: resolved path must stay inside the project root
  if (!filePath.startsWith(_ROOT + path.sep) && filePath !== _ROOT) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Bad Request');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType  = MIME[ext]          || 'application/octet-stream';
  const cacheControl = CACHE_CONTROL[ext] || 'no-cache, must-revalidate';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        ...SECURITY_HEADERS,
      });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type':  contentType,
      'Cache-Control': cacheControl,
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  Etcher Task Hub — dev server`);
  console.log(`  http://localhost:${PORT}\n`);
});
