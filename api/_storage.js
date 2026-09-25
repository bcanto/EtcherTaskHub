// Supabase Storage access with the service role key, for the client portal's file uploads and
// downloads (the portal never talks to Storage directly — every client file access goes through
// a server check first). Bucket and policies: supabase/migrations/006_task_files_storage.sql.
// Leading underscore = shared module, not a Vercel route.

const BUCKET = 'task-files';

function _base() { return `${process.env.SUPABASE_URL}/storage/v1`; }
function _auth(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, ...(extra || {}) };
}
// Object paths are built by the server from generated ids only (tasks/<taskId>/<fileId>), never
// from a file name, but encode each segment anyway.
function _enc(path) { return String(path).split('/').map(encodeURIComponent).join('/'); }

// Upload (or overwrite, so a retried request is harmless). Throws on failure.
async function putObject(path, buffer, contentType) {
  const r = await fetch(`${_base()}/object/${BUCKET}/${_enc(path)}`, {
    method: 'POST',
    headers: _auth({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': 'no-cache' }),
    body: buffer,
  });
  if (!r.ok) throw new Error(`storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// Short-lived signed URL. With downloadName the response is sent as an attachment under that
// name (Content-Disposition), so it saves instead of opening.
async function signedUrl(path, expiresIn, downloadName) {
  const r = await fetch(`${_base()}/object/sign/${BUCKET}/${_enc(path)}`, {
    method: 'POST',
    headers: _auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: expiresIn || 120 }),
  });
  if (!r.ok) throw new Error(`storage sign failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const rel = j.signedURL || j.signedUrl;
  if (!rel) throw new Error('storage sign returned no URL');
  let url = _base() + (rel.startsWith('/') ? rel : '/' + rel);
  if (downloadName) url += (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(downloadName);
  return url;
}

async function removeObjects(paths) {
  if (!paths || !paths.length) return;
  await fetch(`${_base()}/object/${BUCKET}`, {
    method: 'DELETE',
    headers: _auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => {});
}

module.exports = { BUCKET, putObject, signedUrl, removeObjects };
