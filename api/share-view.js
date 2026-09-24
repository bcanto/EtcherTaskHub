// GET /api/share-view?token=… — data for a public progress link (?share=<token>). No login.
// The share page used to read the whole app_state blob anonymously; RLS refuses that, so it
// fell back to the VISITOR's own browser storage and showed "Link not found" to everyone except
// the staff member who made the link. This validates the token server-side and returns only
// what that one link shows (api/_portal.js sliceForShare).
const { readBlob } = require('./_blob');
const { sliceForShare } = require('./_portal');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server not configured' });
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || (req.query && req.query.token) || '';
  try {
    const { data } = await readBlob();
    const slice = sliceForShare(data, token);
    res.setHeader('Cache-Control', 'no-store');
    if (!slice) return res.status(404).json({ error: 'Link not found' });
    return res.status(200).json({ slice });
  } catch (e) {
    console.error('[share-view]', e.message);
    return res.status(500).json({ error: 'Could not load this link.' });
  }
};
