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

  let userId = null;

  // Try invite first (new users)
  const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, invite: true, data: { name } }),
  });
  const inviteBody = await inviteResp.json();

  if (inviteResp.ok) {
    userId = inviteBody.id;
  } else {
    // User already exists — send a password recovery link instead
    const genResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ type: 'recovery', email }),
    });
    const genBody = await genResp.json();

    if (!genResp.ok)
      return res.status(400).json({ error: genBody.msg || genBody.message || 'Failed to send invite' });

    userId = genBody.user?.id || genBody.properties?.user_id;
    if (!userId)
      return res.status(400).json({ error: 'Could not resolve user ID' });
  }

  // Upsert profile
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
