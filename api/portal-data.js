// GET /api/portal-data — the client portal's ONLY way to read data.
// Returns the caller's own slice (api/_portal.js sliceForClient). The client's id comes from
// their profile row server-side; nothing the caller sends can widen it.
const { requireClientCaller } = require('./_authAdmin');
const { readBlob } = require('./_blob');
const { sliceForClient } = require('./_portal');

// Only requests carrying a token-shaped header start the early read, so anonymous junk
// requests are refused before any data is fetched.
const _looksLikeJwt = req => /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String((req.headers && req.headers.authorization) || ''));

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Read the blob while the login is checked (two independent round trips); nothing from it is
  // used or returned unless the caller turns out to be a valid client.
  const blobP = _looksLikeJwt(req) ? readBlob() : null; if (blobP) blobP.catch(() => {});
  const caller = await requireClientCaller(req, res);
  if (!caller) return;
  try {
    const { data } = await (blobP || readBlob());
    const slice = sliceForClient(data, caller.clientId, caller.id);
    if (!slice) return res.status(403).json({ error: 'Portal access is not enabled for this client.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ slice });
  } catch (e) {
    console.error('[portal-data]', e.message);
    return res.status(500).json({ error: 'Could not load your portal. Please try again.' });
  }
};
