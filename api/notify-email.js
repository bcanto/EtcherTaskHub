const { requireStaffCaller } = require('./_authAdmin');
const { sendNotificationEmail } = require('./_email');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Previously anyone could POST here with just {to, message} and send mail as Etcher. Then any
  // signed-in session — which let a client account mail anyone under Etcher's name. Client
  // sessions no longer call this: the portal's emails are sent server-side by portal-action.js.
  if (!(await requireStaffCaller(req, res))) return;

  const { to, recipientName, type, message, senderName } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: 'Missing required fields' });
  // Rendering + Resend call live in _email.js (shared with portal-action.js), which also
  // HTML-escapes every value — they used to be interpolated into the email raw.
  const result = await sendNotificationEmail({ to, recipientName, type, message, senderName });
  return res.status(200).json(result);
};
