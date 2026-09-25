const handler = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  // An unset secret must refuse everyone: undefined !== undefined is false, so without this a
  // server missing UPLOAD_SECRET (e.g. local dev with .env) accepted a blob overwrite from anyone.
  if (!process.env.UPLOAD_SECRET || req.headers['x-upload-secret'] !== process.env.UPLOAD_SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_state`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 1, data: req.body, updated_at: new Date().toISOString() }),
  });

  if (!resp.ok) return res.status(500).json({ error: await resp.text() });
  res.json({ ok: true });
};

handler.config = { api: { bodyParser: { sizeLimit: '20mb' } } };
module.exports = handler;
