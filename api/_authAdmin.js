// Shared caller-auth check for endpoints that mint or rotate account credentials
// (invite-user, set-password). Leading underscore keeps this out of Vercel's routing —
// only api/<name>.js without a leading underscore becomes a callable endpoint.
//
// Why this exists: before this, invite-user and set-password checked req.method and env
// vars, then did their (service-role-key) work with no check on who was calling — any
// unauthenticated POST could mint a Supabase user or overwrite anyone's password. This
// validates the caller's own Supabase access token against GoTrue, then requires their
// profile role to be 'admin' — the same role the app's own route guard already requires to
// reach the Staff/Clients screens that call these endpoints (_STAFF_BLOCKED in index.html
// blocks 'staff'/'clients' views for everyone but admin).
async function requireAdminCaller(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server not configured' });
    return null;
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }

  // Validate the token and resolve the calling user via GoTrue.
  // GoTrue requires an apikey header. SUPABASE_ANON_KEY is only optionally configured here
  // (invite-user.js treats it as optional and falls back), so an empty apikey would make
  // GoTrue reject every caller and lock admins out of account creation entirely. The service
  // role key is always present — it is checked above — and is equally valid as an apikey.
  // The caller's own token in Authorization is still what identifies and authorises them.
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!userResp.ok) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  const caller = await userResp.json();
  if (!caller || !caller.id) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }

  // Look up the caller's role via the service-role key (bypasses RLS — this endpoint IS
  // the authority making the decision, not something relying on RLS to enforce it for it).
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!profileResp.ok) {
    res.status(500).json({ error: 'Could not verify caller role' });
    return null;
  }
  const rows = await profileResp.json();
  const role = rows[0]?.role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }

  return caller;
}

// Same token validation as requireAdminCaller, minus the admin-role requirement. The base for
// requireClientCaller and requireStaffCaller, which add their own role check on top.
async function requireAuthedCaller(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server not configured' });
    return null;
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!userResp.ok) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  const caller = await userResp.json();
  if (!caller || !caller.id) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }

  return caller;
}

// For the client-portal endpoints: a valid session whose profile is an ACTIVE client account
// with a client_id. Returns { id, name, clientId } or null (response already sent). The
// client_id comes from the profile row, never from anything the caller sends.
async function requireClientCaller(req, res) {
  const caller = await requireAuthedCaller(req, res);
  if (!caller) return null;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,client_id,name,active&limit=1`,
    { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!profileResp.ok) {
    res.status(500).json({ error: 'Could not verify caller' });
    return null;
  }
  const p = (await profileResp.json())[0];
  if (!p || p.role !== 'client' || !p.client_id || p.active === false) {
    res.status(403).json({ error: 'Client portal access required' });
    return null;
  }
  return { id: caller.id, name: p.name || 'Client', clientId: p.client_id };
}

// Internal staff only — the same roles as the database helper public.is_internal()
// (admin, pm, staff). Returns the caller or null (response already sent).
async function requireStaffCaller(req, res) {
  const caller = await requireAuthedCaller(req, res);
  if (!caller) return null;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,active&limit=1`,
    { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!profileResp.ok) {
    res.status(500).json({ error: 'Could not verify caller' });
    return null;
  }
  const p = (await profileResp.json())[0];
  if (!p || !['admin', 'pm', 'staff'].includes(p.role) || p.active === false) {
    res.status(403).json({ error: 'Staff access required' });
    return null;
  }
  return caller;
}

module.exports = { requireAdminCaller, requireAuthedCaller, requireClientCaller, requireStaffCaller };
