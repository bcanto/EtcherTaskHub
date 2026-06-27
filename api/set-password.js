module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server not configured' });

  const { userId, password } = req.body || {};
  if (!userId || !password)
    return res.status(400).json({ error: 'userId and password are required' });

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
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

  res.json({ ok: true });
};
