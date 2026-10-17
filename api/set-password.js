const { requireAdminCaller } = require('./_authAdmin');
const { UUID_RE, setAccess, setRole } = require('./_accountAccess');
const { recordAudit } = require('./_audit');

// POST { userId, password }          set a login's password
// POST { userId, access: 'disable' } switch a login off (Remove staff), or 'enable' to switch it back on
// POST { userId, role: 'admin' }     make a login an admin, or 'staff' to make it a standard staff login
// All are admin-only, one action per request. Access and role live here, not in new endpoints, because the
// project is at its serverless function limit (audit C2 and H1, 2026-10-17: removing a person must stop their
// login, and the Staff screen's role must reach the login).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { userId, password, access, role } = req.body || {};
  // The id goes into a URL path below, so it must be exactly a user id and nothing else.
  if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId))
    return res.status(400).json({ error: 'A valid userId is required' });
  if ([password, access, role].filter(v => v !== undefined).length > 1)
    return res.status(400).json({ error: 'Send one action at a time.' });

  // What an admin does to a login is written to the server-side audit trail (audit H8, 2026-10-17). A failure to write
  // it never changes the answer.
  const audit = (action, before, after) => recordAudit({ entityType: 'User', entityId: userId, actorId: caller.id, action, before, after });

  if (role !== undefined) {
    const r = await setRole({ userId, role, callerId: caller.id });
    if (r.status === 200 && r.body.changed) await audit('role_changed', { role: r.previousRole }, { role: r.body.role });
    return res.status(r.status).json(r.body);
  }

  if (access !== undefined) {
    if (access !== 'disable' && access !== 'enable')
      return res.status(400).json({ error: "access must be 'disable' or 'enable'" });
    const r = await setAccess({ userId, enabled: access === 'enable', callerId: caller.id });
    if (r.status === 200) await audit(access === 'enable' ? 'access_enabled' : 'access_disabled', null, null);
    return res.status(r.status).json(r.body);
  }

  if (!password)
    return res.status(400).json({ error: 'userId and password are required' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ password }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('[set-password] failed:', resp.status, err);
    return res.status(500).json({ error: 'Failed to update password' });
  }

  await audit('password_changed', null, null);   // the fact, never the password
  res.json({ ok: true });
};
