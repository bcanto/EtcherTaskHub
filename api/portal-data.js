// GET /api/portal-data — the client portal's ONLY way to read data.
// Returns the caller's own slice (api/_portal.js sliceForClient). The client's id comes from
// their profile row server-side; nothing the caller sends can widen it.
const { requireClientCaller } = require('./_authAdmin');
const { readBlob } = require('./_blob');
const { sliceForClient } = require('./_portal');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const caller = await requireClientCaller(req, res);
  if (!caller) return;
  try {
    const { data } = await readBlob();
    const slice = sliceForClient(data, caller.clientId, caller.id);
    if (!slice) return res.status(403).json({ error: 'Portal access is not enabled for this client.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ slice });
  } catch (e) {
    console.error('[portal-data]', e.message);
    return res.status(500).json({ error: 'Could not load your portal. Please try again.' });
  }
};
