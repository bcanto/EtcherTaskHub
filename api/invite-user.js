module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { name, email, role, color, initials, clientId } = req.body || {};
  if (!name || !email)
    return res.status(400).json({ error: 'name and email are required' });

  // Create Supabase Auth user and send invitation email
  const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, invite: true, data: { name } }),
  });

  const inviteBody = await inviteResp.json();
  if (!inviteResp.ok)
    return res.status(400).json({ error: inviteBody.msg || inviteBody.message || JSON.stringify(inviteBody) });

  const userId = inviteBody.id;

  // Build profile — clients get role='client' and a client_id link
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
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(profile),
  });

  if (!profileResp.ok)
    return res.status(500).json({ error: await profileResp.text() });

  res.json({ id: userId });
};
