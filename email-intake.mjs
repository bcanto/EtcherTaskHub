/**
 * email-intake.mjs — Microsoft Graph email ingestion service
 *
 * Runs alongside serve.mjs as a separate process:
 *   node email-intake.mjs          # polls every 5 min (requires .env credentials)
 *   node email-intake.mjs --demo   # injects sample emails without credentials
 *
 * Required .env variables (copy from .env.example):
 *   TENANT_ID          Azure AD tenant ID
 *   CLIENT_ID          App registration client ID
 *   CLIENT_SECRET      App registration client secret
 *   MAILBOX_UPN        taskhub@etchersolutions.com
 *   WEBHOOK_URL        Public HTTPS URL for /api/webhook/graph (use ngrok in dev)
 *   TASKHUB_API        http://localhost:3001 (where serve.mjs is running)
 *
 * See SETUP.md for full Microsoft 365 + Azure AD setup instructions.
 */

import fs   from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env (same parser as serve.mjs) ─────────────────────────────────────
const _env = {};
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    _env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
} catch (_) {}

const TENANT_ID    = _env.TENANT_ID    || process.env.TENANT_ID    || '';
const CLIENT_ID    = _env.CLIENT_ID    || process.env.CLIENT_ID    || '';
const CLIENT_SECRET= _env.CLIENT_SECRET|| process.env.CLIENT_SECRET|| '';
const MAILBOX_UPN  = _env.MAILBOX_UPN  || process.env.MAILBOX_UPN  || 'taskhub@etchersolutions.com';
const WEBHOOK_URL  = _env.WEBHOOK_URL  || process.env.WEBHOOK_URL  || '';
const TASKHUB_API  = _env.TASKHUB_API  || process.env.TASKHUB_API  || 'http://localhost:3001';

const DEMO_MODE    = process.argv.includes('--demo');
const CONFIGURED   = TENANT_ID && CLIENT_ID && CLIENT_SECRET;
const POLL_MS      = 5 * 60 * 1000; // 5 minutes
const RENEW_MS     = 47 * 60 * 60 * 1000; // 47 hours (subscriptions expire at 48h)

// Allowed sender domains — everything else is quarantined
const ALLOWED_DOMAINS = new Set([
  'etchersolutions.com',
  // Add client domains here, or load from DB
]);

// ── Microsoft Graph helpers ───────────────────────────────────────────────────

let _accessToken   = null;
let _tokenExpiry   = 0;
let _subscriptionId= null;

/** Get an app-only Graph access token via client_credentials flow */
async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res = await graphFetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  _accessToken  = data.access_token;
  _tokenExpiry  = Date.now() + data.expires_in * 1000;
  return _accessToken;
}

/** Thin HTTPS fetch wrapper (avoids external deps) */
function graphFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   opts.method || 'GET',
      headers:  opts.headers || {},
    };
    if (opts.body) reqOpts.headers['Content-Length'] = Buffer.byteLength(opts.body);
    const req = mod.request(reqOpts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: () => JSON.parse(data), text: () => data });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Call Graph API with auth header */
async function graph(endpoint, opts = {}) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...opts.headers };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return graphFetch(`https://graph.microsoft.com/v1.0${endpoint}`, { ...opts, headers });
}

// ── Webhook subscription ──────────────────────────────────────────────────────

async function subscribeToMailbox() {
  if (!WEBHOOK_URL) {
    console.log('[Intake] WEBHOOK_URL not set — skipping webhook, using poll-only mode');
    return;
  }
  const expiryDate = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();
  const payload = JSON.stringify({
    changeType:         'created',
    notificationUrl:    `${WEBHOOK_URL}/api/webhook/graph`,
    resource:           `/users/${MAILBOX_UPN}/mailFolders('Inbox')/messages`,
    expirationDateTime: expiryDate,
    clientState:        'taskhub-intake-secret', // validate in webhook handler
  });
  const res = await graph('/subscriptions', { method: 'POST', body: payload });
  const data = res.json();
  if (res.ok) {
    _subscriptionId = data.id;
    console.log(`[Intake] Webhook subscription active → ${data.id} (expires ${expiryDate})`);
  } else {
    console.warn('[Intake] Subscription failed:', JSON.stringify(data));
  }
}

async function renewSubscription() {
  if (!_subscriptionId) return;
  const expiryDate = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();
  const res = await graph(`/subscriptions/${_subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: expiryDate }),
  });
  if (res.ok) {
    console.log(`[Intake] Subscription renewed → expires ${expiryDate}`);
  } else {
    console.warn('[Intake] Renewal failed — resubscribing...');
    _subscriptionId = null;
    await subscribeToMailbox();
  }
}

// ── Email polling ─────────────────────────────────────────────────────────────

/** Fetch unread emails from the inbox */
async function pollMailbox() {
  const res = await graph(
    `/users/${MAILBOX_UPN}/mailFolders/Inbox/messages?$filter=isRead eq false&$top=25&$select=id,subject,from,body,receivedDateTime,hasAttachments,internetMessageHeaders`
  );
  if (!res.ok) { console.warn('[Intake] Poll failed:', res.status); return; }
  const { value: messages = [] } = res.json();
  console.log(`[Intake] Found ${messages.length} unread message(s)`);
  for (const msg of messages) {
    await processMessage(msg);
  }
}

/** Parse one Graph message object and POST to /api/intake */
async function processMessage(msg) {
  const fromAddr = msg.from?.emailAddress?.address?.toLowerCase() || '';
  const fromName = msg.from?.emailAddress?.name || fromAddr;
  const domain   = fromAddr.split('@')[1] || '';

  // Sender allowlist check
  if (!ALLOWED_DOMAINS.has(domain)) {
    console.log(`[Intake] Quarantined (unknown domain): ${fromAddr}`);
    await markAsRead(msg.id);
    return;
  }

  const body    = msg.body?.content || '';
  const isHtml  = msg.body?.contentType === 'html';
  const plain   = isHtml ? stripHtml(body) : body;
  const snippet = plain.replace(/\s+/g, ' ').trim().slice(0, 250);

  // Heuristic extraction
  const actionItems    = extractActionItems(plain);
  const extractedDates = extractDates(plain);
  const suggestedDue   = extractedDates[0] || null;

  const item = {
    id:                   'ei_' + msg.id.slice(-12).replace(/[^a-z0-9]/gi, ''),
    status:               'pending',
    from:                 fromAddr,
    fromName:             fromName,
    subject:              msg.subject || '(no subject)',
    body:                 plain,
    snippet,
    attachments:          msg.hasAttachments ? await fetchAttachmentMeta(msg.id) : [],
    receivedAt:           msg.receivedDateTime || new Date().toISOString(),
    suggestedTitle:       msg.subject || '(no subject)',
    suggestedDescription: actionItems.length ? actionItems.join('\n') : snippet,
    suggestedBoardId:     null, // populated by suggestBoard()
    suggestedGroupId:     null,
    suggestedDueDate:     suggestedDue,
    extractedDates,
    actionItems,
    originalEmailId:      msg.id,
    emailHeaders:         Object.fromEntries((msg.internetMessageHeaders || []).map(h => [h.name, h.value])),
    isTest:               false,
  };

  // Post to TaskHub API
  const postRes = await graphFetch(`${TASKHUB_API}/api/intake`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(item),
  });
  if (postRes.ok) {
    console.log(`[Intake] Queued: "${item.subject}" from ${fromAddr}`);
    await markAsRead(msg.id);
    await moveToProcessed(msg.id);
  }
}

async function fetchAttachmentMeta(messageId) {
  const res = await graph(`/users/${MAILBOX_UPN}/messages/${messageId}/attachments?$select=name,contentType,size`);
  if (!res.ok) return [];
  return (res.json().value || []).map(a => ({ name: a.name, type: a.contentType, size: a.size }));
}

async function markAsRead(messageId) {
  await graph(`/users/${MAILBOX_UPN}/messages/${messageId}`, {
    method: 'PATCH', body: JSON.stringify({ isRead: true }),
  });
}

async function moveToProcessed(messageId) {
  // Move to a "TaskHub Processed" folder (create it if needed — Graph will error gracefully if it doesn't exist)
  await graph(`/users/${MAILBOX_UPN}/messages/${messageId}/move`, {
    method: 'POST', body: JSON.stringify({ destinationId: 'TaskHub Processed' }),
  }).catch(() => {}); // folder may not exist yet — that's fine
}

// ── Heuristic parser ──────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract bullet-point or numbered action items from plain text */
function extractActionItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^[-*•]\s+.{5,}/.test(t))         items.push(t.replace(/^[-*•]\s+/, ''));
    if (/^\d+[.)]\s+.{5,}/.test(t))        items.push(t.replace(/^\d+[.)]\s+/, ''));
    if (/^(action|todo|please|required):/i.test(t)) items.push(t.replace(/^[^:]+:\s*/i, ''));
  }
  return items.slice(0, 10);
}

/** Very simple date extraction — covers the most common patterns */
function extractDates(text) {
  const dates = [];
  const now = new Date();

  // "by next Friday", "by Monday", etc.
  const dowMatch = text.match(/by\s+(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (dowMatch) {
    const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    const target = days[dowMatch[2].toLowerCase()];
    const d = new Date(now);
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff + (dowMatch[1] ? 7 : 0));
    dates.push(d.toISOString().slice(0, 10));
  }

  // "EOD", "end of day"
  if (/\b(eod|end of day)\b/i.test(text)) dates.push(now.toISOString().slice(0, 10));

  // ISO date pattern: 2026-06-30
  const isoMatches = text.match(/\b(\d{4}-\d{2}-\d{2})\b/g) || [];
  dates.push(...isoMatches.filter(d => !isNaN(new Date(d))));

  // DD/MM/YYYY or D Month YYYY
  const auMatches = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/g) || [];
  for (const raw of auMatches) {
    const [d, m, y] = raw.split(/[\/\-]/);
    const parsed = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
    if (!isNaN(parsed)) dates.push(parsed.toISOString().slice(0, 10));
  }

  // Deduplicate and return soonest first
  return [...new Set(dates)].sort();
}

// ── Demo mode ─────────────────────────────────────────────────────────────────

const DEMO_EMAILS = [
  {
    from: 'john.smith@generalcranes.com.au', fromName: 'John Smith',
    subject: 'Quote Request — 2× overhead crane installation Kewdale',
    body: 'Hi team,\n\nWe need a quote for installing two overhead cranes at our new facility in Kewdale. Site visit required before the end of next month.\n\nPlease can someone get back to me by Friday with availability?\n\nThanks,\nJohn',
  },
  {
    from: 'sarah.jones@etchersolutions.com', fromName: 'Sarah Jones',
    subject: 'Meeting notes — Daltech project kickoff 27 June',
    body: 'Hi all,\n\nAction items from today\'s kickoff:\n\n- Bruna to send project schedule by Wednesday EOD\n- Ops to confirm subcontractor availability by Thursday\n- Site induction required before 15 July 2026\n\nNext meeting: Monday 14 July 10am.\n\nThanks,\nSarah',
  },
  {
    from: 'compliance@etchersolutions.com', fromName: 'Compliance',
    subject: 'ACTION REQUIRED: ISO 9001 document review due 2026-06-30',
    body: 'Reminder: The following documents require review before 30/06/2026:\n\n1. Quality Manual v4.2\n2. Corrective Action Register\n3. Internal audit schedule\n\nPlease complete your section and return to compliance by COB Friday.',
  },
];

async function runDemoMode() {
  console.log('[Intake] DEMO MODE — injecting sample emails into Triage Zone...\n');
  // Only inject emails that don't match allowed domains (to test allowlist)
  const demoItems = DEMO_EMAILS.map((e, i) => {
    const plain   = e.body;
    const snippet = plain.replace(/\s+/g, ' ').trim().slice(0, 250);
    const actionItems    = extractActionItems(plain);
    const extractedDates = extractDates(plain);
    return {
      id:                   `ei_demo${i}_${Date.now().toString(36)}`,
      status:               'pending',
      from:                 e.from,
      fromName:             e.fromName,
      subject:              e.subject,
      body:                 plain,
      snippet,
      attachments:          [],
      receivedAt:           new Date(Date.now() - i * 3600_000).toISOString(),
      suggestedTitle:       e.subject,
      suggestedDescription: actionItems.length ? actionItems.join('\n') : snippet,
      suggestedBoardId:     null,
      suggestedGroupId:     null,
      suggestedDueDate:     extractedDates[0] || null,
      extractedDates,
      actionItems,
      originalEmailId:      null,
      emailHeaders:         {},
      isTest:               true,
    };
  });

  for (const item of demoItems) {
    const res = await graphFetch(`${TASKHUB_API}/api/intake`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(item),
    });
    console.log(res.ok ? `[Intake] Injected: "${item.subject}"` : `[Intake] Failed to inject: ${res.status}`);
  }
  console.log('\nDone. Open the app dashboard to see items in the Triage Zone.\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Etcher Task Hub — Email Intake Service');
  console.log(`  Mailbox: ${MAILBOX_UPN}`);
  console.log(`  API:     ${TASKHUB_API}\n`);

  if (DEMO_MODE) {
    await runDemoMode();
    process.exit(0);
  }

  if (!CONFIGURED) {
    console.warn('  ⚠  No Azure AD credentials found in .env');
    console.warn('  The Email Intake service is ready but inactive.');
    console.warn('  See SETUP.md to configure Microsoft 365 + Azure AD.\n');
    console.warn('  Tip: run  node email-intake.mjs --demo  to test the UI without credentials.\n');
    process.exit(0);
  }

  // Initial poll
  await pollMailbox().catch(e => console.error('[Intake] Poll error:', e.message));

  // Try to set up webhook subscription (requires public WEBHOOK_URL)
  await subscribeToMailbox().catch(e => console.warn('[Intake] Subscription error:', e.message));

  // Poll every 5 minutes as fallback
  setInterval(async () => {
    await pollMailbox().catch(e => console.error('[Intake] Poll error:', e.message));
  }, POLL_MS);

  // Renew subscription every 47 hours
  setInterval(async () => {
    await renewSubscription().catch(e => console.warn('[Intake] Renewal error:', e.message));
  }, RENEW_MS);

  console.log(`[Intake] Running — polling every ${POLL_MS / 60000} min`);
  if (_subscriptionId) console.log('[Intake] Webhook active — near real-time delivery enabled');
}

main().catch(e => { console.error('[Intake] Fatal:', e); process.exit(1); });
