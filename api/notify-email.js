const { requireStaffCaller } = require('./_authAdmin');
const { sendNotificationEmail, EMAIL_TYPES } = require('./_email');

// POST { to, type, message }  -> one notification email to ONE active staff member.
//
// This used to take any address and any text from any signed-in staff session and send it as Etcher, so a
// single compromised staff account could send phishing mail from Etcher's address (audit H11, 2026-10-17).
// Now: the recipient must be an active staff member's own profile (the mail goes to the address on that
// profile, never to what the browser typed), the kind must be one of the four notification kinds, the text
// is short, the sender's name is the caller's own profile name (never what the browser says), and each
// caller and each recipient has a ceiling per ten minutes. No cross-origin access: the app calls this from
// its own pages.

const WINDOW_MS = 10 * 60 * 1000;
const PER_CALLER = 40;      // mails a person may trigger in the window (a busy day of assignments and mentions)
const PER_RECIPIENT = 20;   // mails any one person may receive in the window, whoever triggers them
const MESSAGE_MAX = 300;
const EMAIL_RE = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;   // no % or *: they are wildcards in the lookup
const hits = new Map();     // key -> timestamps in the window (kept per server instance: a ceiling, not an exact count)

function allow(key, limit, now) {
  const arr = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const caller = await requireStaffCaller(req, res);
  if (!caller) return;

  const { to, type, message } = req.body || {};
  if (typeof to !== 'string' || !EMAIL_RE.test(to)) return res.status(400).json({ error: 'A single valid recipient is required' });
  if (!EMAIL_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown notification type' });
  if (typeof message !== 'string' || !message.trim() || message.length > MESSAGE_MAX) return res.status(400).json({ error: `The message must be 1 to ${MESSAGE_MAX} characters` });

  const now = Date.now();
  if (!allow('c:' + caller.id, PER_CALLER, now)) return res.status(429).json({ error: 'Too many emails from this account. Try again later.' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(to)}&select=id,email,name,role,active&limit=1`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) return res.status(500).json({ error: 'Could not check the recipient' });
  const p = (await r.json())[0];
  // Only people who work here: not a client login, not a switched-off account, not an address nobody holds.
  // ilike can match more loosely than the address given (an underscore matches any one character), so the
  // profile found must hold exactly this address.
  if (!p || !p.email || p.email.toLowerCase() !== to.toLowerCase() || !['admin', 'pm', 'staff'].includes(p.role) || p.active === false) return res.status(403).json({ error: 'That address is not an active staff member' });
  if (!allow('r:' + p.id, PER_RECIPIENT, now)) return res.status(429).json({ error: 'That person has had too many emails just now.' });

  const result = await sendNotificationEmail({
    to: p.email,
    recipientName: p.name,
    type,
    message: message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(),
    senderName: caller.profileName || 'Etcher Team',
  });
  return res.status(200).json(result);
};

module.exports._test = { reset: () => hits.clear() };
