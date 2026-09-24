// Shared notification-email sender (leading underscore = not a Vercel route).
// Used by api/notify-email.js (browser-triggered) and api/portal-action.js (server-side, for
// notifications a client action produces). Every interpolated value is HTML-escaped: message
// text and names can contain client-controlled strings (a client can set their own profile
// name), and they used to go into the email body raw.

const META = {
  mention:       { subject: 'You were mentioned',   emoji: '💬', color: '#0369a1' },
  task_assigned: { subject: 'Task assigned to you', emoji: '📋', color: '#7c3aed' },
  owner_changed: { subject: 'Task assigned to you', emoji: '📋', color: '#7c3aed' },
  currently_with:{ subject: 'Task is now with you', emoji: '↗️', color: '#0d6e4e' },
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Resolves to {ok:true,id} | {skipped:reason}. Never throws — email is best-effort.
async function sendNotificationEmail({ to, recipientName, type, message, senderName }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return { skipped: 'RESEND_API_KEY not configured' };
  if (!to || !message) return { skipped: 'missing to/message' };
  const FROM = process.env.RESEND_FROM_EMAIL || 'Etcher Task Hub <notifications@etchersolutions.com>';
  const APP_URL = process.env.APP_URL || 'https://etcher-task-hub.vercel.app';
  const meta = META[type] || { subject: 'New notification', emoji: '🔔', color: '#0d1c33' };

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(13,28,51,0.08)">

        <!-- Header -->
        <tr><td style="background:#0d1c33;padding:24px 32px;text-align:left">
          <span style="color:#97bcbd;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase">ETCHER TASK HUB</span>
        </td></tr>

        <!-- Accent bar -->
        <tr><td style="height:3px;background:${meta.color}"></td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 32px 24px">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0d1c33;letter-spacing:-0.01em">${meta.emoji} ${meta.subject}</p>
          <p style="margin:0 0 24px;font-size:14px;color:#64748b">Hi ${esc(recipientName || 'there')},</p>
          <div style="background:#f8fafc;border-left:3px solid ${meta.color};border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px">
            <p style="margin:0;font-size:14px;color:#1a2940;line-height:1.6">${esc(message)}</p>
          </div>
          <p style="margin:0 0 6px;font-size:13px;color:#94a3b8">Sent by <strong style="color:#475569">${esc(senderName || 'Etcher Team')}</strong></p>
          <a href="${esc(APP_URL)}" style="display:inline-block;margin-top:20px;padding:10px 22px;background:#0d1c33;color:#fff;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.02em">Open Task Hub →</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#b0bec5">You're receiving this because you're a member of the Etcher Task Hub workspace.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: `${meta.emoji} ${meta.subject} — Etcher Task Hub`, html }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('[email] Resend error:', body);
      return { skipped: 'send failed', detail: body };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    console.warn('[email] fetch error:', e.message);
    return { skipped: e.message };
  }
}

module.exports = { sendNotificationEmail };
