module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { name, email, role, color, initials, clientId } = req.body || {};
  if (!name || !email)
    return res.status(400).json({ error: 'name and email are required' });

  const authHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Try to invite the user (creates new Supabase Auth account + sends email)
  let userId = null;
  const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, invite: true, data: { name } }),
  });
  const inviteBody = await inviteResp.json();

  if (inviteResp.ok) {
    userId = inviteBody.id;
  } else {
    // User already exists — look them up by email and just upsert the profile
    const listResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: authHeaders }
    );
    if (!listResp.ok)
      return res.status(400).json({ error: inviteBody.msg || inviteBody.message || 'Invite failed' });

    const listBody = await listResp.json();
    const existing = (listBody.users || []).find(u => u.email === email);
    if (!existing)
      return res.status(400).json({ error: inviteBody.msg || inviteBody.message || 'Invite failed' });

    userId = existing.id;
  }

  // Upsert profile (insert or update if already exists)
  const profile = {
    id: userId,
    name,
    email,
    role: clientId ? 'client' : (role || 'staff'),
    display_color: color || '#7aa3a4',
    ...(clientId ? { client_id: clientId } : {}),
  };

  const profileResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...authHeaders, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(profile),
  });

  if (!profileResp.ok)
    return res.status(500).json({ error: await profileResp.text() });

  res.json({ id: userId });
};
