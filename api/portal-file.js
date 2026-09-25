// GET /api/portal-file?id=<taskFile id>[&dl=1] — a client-portal user's only way to open a stored
// task file. Checks the file is visible to the caller's client (same rule as the slice:
// fileVisibleTo in api/_portal.js), then returns a 2-minute signed URL. dl=1 makes it a download.
const { requireClientCaller } = require('./_authAdmin');
const { readBlob } = require('./_blob');
const { fileVisibleTo } = require('./_portal');
const { signedUrl } = require('./_storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const caller = await requireClientCaller(req, res);
  if (!caller) return;
  const q = new URL(req.url, 'http://x').searchParams;   // the local dev server has no req.query
  const id = String(q.get('id') || (req.query && req.query.id) || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'Invalid file.' });
  try {
    const { data } = await readBlob();
    const f = (data.taskFiles || []).find(x => x.id === id);
    // Same answer for "no such file" and "not yours", so ids can't be probed.
    if (!f || !fileVisibleTo(data, caller.clientId, f) || !f.storagePath) return res.status(404).json({ error: 'File not found.' });
    const url = await signedUrl(f.storagePath, 120, (q.get('dl') || (req.query && req.query.dl)) === '1' ? f.name : null);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ url });
  } catch (e) {
    console.error('[portal-file]', e.message);
    return res.status(500).json({ error: 'Could not open the file. Please try again.' });
  }
};
