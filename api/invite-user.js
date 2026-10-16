const { requireAdminCaller } = require('./_authAdmin');
const { enableIfDisabled } = require('./_accountAccess');

// A readable sentence from a Supabase REST/Auth error, never the raw JSON. The Add Client form used
// to show {"code":"23503","details":...} straight from PostgREST.
function errText(raw, fallback) {
  let b = raw;
  if (typeof raw === 'string') { try { b = JSON.parse(raw); } catch (e) { return raw.slice(0, 300) || fallback; } }
  return String((b && (b.message || b.msg || b.error_description || b.error)) || fallback).slice(0, 300);
}

// The profile of an existing login: { role, client_id } or null.
async function readProfile(base, headers, userId) {
  const r = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,client_id&limit=1`, { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

// An email that already has a login may only be reused for the same kind of account: a client's
// portal login never takes over a staff login, a staff login never takes over a client's portal
// login, and one client's login never moves to another client. A login with no client yet (a
// half-finished earlier attempt) is free to use. Returns the refusal, or null when it may be used.
function accountClash(existing, clientId) {
  if (!existing) return null;
  const internal = ['admin', 'pm', 'staff'].includes(existing.role);
  if (clientId) {
    if (internal) return 'That email belongs to a staff login. Use a different email for the client portal.';
    if (existing.client_id && existing.client_id !== clientId) return 'That email is already the portal login for another client.';
    return null;
  }
  if (!internal && existing.client_id) return 'That email is a client portal login. Use a different email for this staff member.';
  return null;
}

// A client login's profile points at public.clients(id) (migration 004's profiles_client_id_fkey,
// enforced for every new or changed row). The app keeps its clients in the app_state blob, so that
// table only holds the rows this endpoint puts there: one per client given a login, made before the
// login itself so a failure here leaves no half-made account behind. Nothing reads it but the key.
async function ensureClientRow(base, headers, clientId, name, shortCode) {
  const row = { id: clientId, name: String(name).trim().slice(0, 120) || clientId };
  const code = String(shortCode || '').trim().toUpperCase();
  if (code && code.length <= 10) row.short_code = code;
  const r = await fetch(`${base}/rest/v1/clients?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (r.ok) return null;
  const raw = await r.text();
  console.error('[invite-user] client row failed:', r.status, raw);
  return errText(raw, 'the client could not be registered');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await requireAdminCaller(req, res))) return;

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { name, email, role, color, clientId, password, shortCode } = req.body || {};
  if (!name || !email)
    return res.status(400).json({ error: 'name and email are required' });
  if (clientId != null && !/^[A-Za-z0-9_-]{1,64}$/.test(String(clientId)))
    return res.status(400).json({ error: 'Invalid client.' });

  const adminHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const anonHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY || '',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY || ''}`,
  };

  if (clientId) {
    const why = await ensureClientRow(SUPABASE_URL, adminHeaders, String(clientId), name, shortCode);
    if (why) return res.status(500).json({ error: `Could not set up the client for portal logins: ${why}` });
  }

  let userId = null;
  let existed = false;

  if (password) {
    // ── Direct account creation (admin sets the password) ──────────────────
    // Try admin API first so we bypass email confirmation entirely
    const adminResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
    });
    const adminBody = await adminResp.json();
    console.log('[invite-user] admin create:', adminResp.status, adminBody && adminBody.id ? 'created' : (adminBody.error_code || adminBody.msg || ''));

    if (adminResp.ok) {
      userId = adminBody.id;
    } else if (adminBody.error_code === 'user_already_exists' || adminResp.status === 422) {
      existed = true;
      // User exists — look up their UUID via profiles table then upsert profile
      const lookupResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
        { headers: adminHeaders }
      );
      if (lookupResp.ok) {
        const rows = await lookupResp.json();
        if (rows[0]?.id) userId = rows[0].id;
      }
      // If profile doesn't exist yet, try admin list as fallback
      if (!userId) {
        const listResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: adminHeaders });
        if (listResp.ok) {
          const listBody = await listResp.json();
          const users = listBody.users || (Array.isArray(listBody) ? listBody : []);
          const found = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
          if (found) userId = found.id;
        }
      }
      if (!userId) return res.status(400).json({ error: 'Account already exists but could not retrieve ID. Check Supabase dashboard.' });
    } else {
      // Admin API unavailable — fall back to public signup with the supplied password
      if (!SUPABASE_ANON_KEY)
        return res.status(500).json({ error: 'Cannot create account: server not fully configured.' });

      const signupResp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: anonHeaders,
        body: JSON.stringify({ email, password, options: { data: { name } } }),
      });
      const signupBody = await signupResp.json();
      console.log('[invite-user] public signup:', signupResp.status, signupBody && (signupBody.id || signupBody.user?.id) ? 'created' : (signupBody.code || signupBody.msg || ''));

      if (signupResp.ok && (signupBody.id || signupBody.user?.id)) {
        userId = signupBody.id || signupBody.user?.id;
      } else if (signupBody.msg?.includes('already') || signupBody.code === 'user_already_exists') {
        return res.status(400).json({ error: 'An account with that email already exists.' });
      } else {
        return res.status(400).json({ error: signupBody.msg || signupBody.message || 'Could not create account.' });
      }
    }

  } else {
    // ── Client portal invite (email link flow) ─────────────────────────────
    const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email, invite: true, data: { name } }),
    });
    const inviteBody = await inviteResp.json();
    console.log('[invite-user] admin invite:', inviteResp.status, inviteBody && inviteBody.id ? 'invited' : (inviteBody.error_code || inviteBody.msg || ''));

    if (inviteResp.ok) {
      userId = inviteBody.id;
    } else if (inviteResp.status === 422 && inviteBody.error_code === 'user_already_exists') {
      existed = true;
      // Look up existing UUID
      let page = 1;
      outer: while (page <= 5) {
        const listResp = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
          { headers: adminHeaders }
        );
        if (!listResp.ok) break;
        const listBody = await listResp.json();
        const users = listBody.users || (Array.isArray(listBody) ? listBody : []);
        for (const u of users) {
          if (u.email?.toLowerCase() === email.toLowerCase()) { userId = u.id; break outer; }
        }
        if (users.length < 200) break;
        page++;
      }
      if (!userId) return res.status(400).json({ error: `Could not find existing account for ${email}` });
    } else {
      return res.status(400).json({ error: inviteBody.msg || inviteBody.message || 'Failed to invite user' });
    }
  }

  if (!userId) return res.status(400).json({ error: 'Could not resolve user ID' });

  if (existed) {
    // Never repurpose someone else's login (see accountClash).
    const clash = accountClash(await readProfile(SUPABASE_URL, adminHeaders, userId), clientId ? String(clientId) : null);
    if (clash) return res.status(409).json({ error: clash });
    if (password) {
      // The login is there already (most often an earlier attempt that failed half way): the
      // password typed now is the one that has to work.
      const pwResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT', headers: adminHeaders, body: JSON.stringify({ password }),
      });
      if (!pwResp.ok) {
        console.error('[invite-user] password update failed:', pwResp.status, await pwResp.text());
        return res.status(500).json({ error: 'The login exists already, but its password could not be set. Try again.' });
      }
    } else if (SUPABASE_ANON_KEY) {
      await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST', headers: anonHeaders, body: JSON.stringify({ email }),
      }).catch(() => {});
    }
  }
  // An admin adding someone whose login was switched off by Remove staff (audit C2): adding them again
  // switches it back on. An active profile, or one that does not exist yet, is left alone.
  try { await enableIfDisabled(userId); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  // ── Upsert profile via SECURITY DEFINER function (bypasses RLS) ───────────
  const profileResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_profile`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      p_id: userId,
      p_name: name,
      p_email: email,
      p_role: clientId ? 'client' : (role || 'staff'),
      p_display_color: color || '#7aa3a4',
      p_client_id: clientId || null,
    }),
  });

  if (!profileResp.ok) {
    const profileErr = await profileResp.text();
    console.error('[invite-user] profile upsert failed:', profileResp.status, profileErr);
    return res.status(500).json({ error: `The login was made, but its profile could not be saved: ${errText(profileErr, 'unknown error')}. Save again to finish.` });
  }

  res.json({ id: userId, existed });
};

module.exports._test = { accountClash, errText };
