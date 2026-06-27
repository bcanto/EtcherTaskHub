module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { name, email, role, color, clientId, password } = req.body || {};
  if (!name || !email)
    return res.status(400).json({ error: 'name and email are required' });

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

  let userId = null;

  if (password) {
    // ── Direct account creation (admin sets the password) ──────────────────
    // Try admin API first so we bypass email confirmation entirely
    const adminResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
    });
    const adminBody = await adminResp.json();
    console.log('[invite-user] admin create:', adminResp.status, JSON.stringify(adminBody));

    if (adminResp.ok) {
      userId = adminBody.id;
    } else if (adminBody.error_code === 'user_already_exists' || adminResp.status === 422) {
      return res.status(400).json({ error: 'An account with that email already exists.' });
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
      console.log('[invite-user] public signup:', signupResp.status, JSON.stringify(signupBody));

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
    console.log('[invite-user] admin invite:', inviteResp.status, JSON.stringify(inviteBody));

    if (inviteResp.ok) {
      userId = inviteBody.id;
    } else if (inviteResp.status === 422 && inviteBody.error_code === 'user_already_exists') {
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
      if (SUPABASE_ANON_KEY) {
        await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
          method: 'POST', headers: anonHeaders, body: JSON.stringify({ email }),
        }).catch(() => {});
      }
      if (!userId) return res.status(400).json({ error: `Could not find existing account for ${email}` });
    } else {
      return res.status(400).json({ error: inviteBody.msg || inviteBody.message || 'Failed to invite user' });
    }
  }

  if (!userId) return res.status(400).json({ error: 'Could not resolve user ID' });

  // ── Upsert profile ────────────────────────────────────────────────────────
  const profile = {
    id: userId, name, email,
    role: clientId ? 'client' : (role || 'staff'),
    display_color: color || '#7aa3a4',
    ...(clientId ? { client_id: clientId } : {}),
  };

  const profileResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(profile),
  });

  if (!profileResp.ok) {
    const profileErr = await profileResp.text();
    console.error('[invite-user] profile upsert failed:', profileResp.status, profileErr);
    return res.status(500).json({ error: profileErr });
  }

  res.json({ id: userId });
};
