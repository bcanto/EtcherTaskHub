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
// Staff sign in with Microsoft only, once switched on in the database (migration 018, SSO + HTTPS plan phase B2). The
// database answers for the caller's own session through public.session_allowed(), so the rule lives in one place.
// "allowed": true or false; "missing": the migration is not applied (the rule does not exist yet, so nothing changes);
// "error": anything else (refused by the callers, since they act with the service role and bypass the database's rules).
async function sessionAllowed(token) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/session_allowed`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.status === 404) return 'missing';
    if (!r.ok) return 'error';
    return (await r.json()) === false ? false : true;
  } catch (e) {
    return 'error';
  }
}
// Answers the request itself and returns false when the session does not meet the rule.
async function enforceSignInRule(token, res) {
  const a = await sessionAllowed(token);
  if (a === true || a === 'missing') return true;
  if (a === false) res.status(403).json({ error: 'Staff accounts sign in with Microsoft. Sign in again with "Sign in with Microsoft".' });
  else res.status(503).json({ error: 'Could not check how this session signed in. Try again in a moment.' });
  return false;
}

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
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,active&limit=1`,
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
  // An admin who has been switched off stays refused even while their last session token is still valid.
  if (role !== 'admin' || rows[0]?.active === false) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  if (!(await enforceSignInRule(token, res))) return null;

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
  // Someone who set up two-step sign-in must have given their code (migration 018; the Microsoft rule never applies to
  // clients, so for them this is only that).
  const token = (req.headers['authorization'] || '').slice(7);
  if (!(await enforceSignInRule(token, res))) return null;
  // The name is shown to staff in notifications and comments; a user can edit their own, so cap it.
  const name = String(p.name || 'Client').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'Client';
  return { id: caller.id, name, clientId: p.client_id };
}

// Internal staff only — the same roles as the database helper public.is_internal()
// (admin, pm, staff). Returns the caller or null (response already sent).
async function requireStaffCaller(req, res) {
  const caller = await requireAuthedCaller(req, res);
  if (!caller) return null;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,active,name&limit=1`,
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
  const token = (req.headers['authorization'] || '').slice(7);
  if (!(await enforceSignInRule(token, res))) return null;
  // The server's own record of who this is (name and role), for endpoints that must not trust what the
  // browser says about the sender.
  return { ...caller, profileName: p.name || null, profileRole: p.role };
}

module.exports = { requireAdminCaller, requireAuthedCaller, requireClientCaller, requireStaffCaller, sessionAllowed };
