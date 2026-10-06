// Supabase Storage access with the service role key, for the client portal's file uploads and
// downloads (the portal never talks to Storage directly — every client file access goes through
// a server check first). Bucket and policies: supabase/migrations/006_task_files_storage.sql.
// Leading underscore = shared module, not a Vercel route.
//
// `bucket` is optional on every function and defaults to BUCKET ('task-files') so every existing
// caller (portal-action.js, portal-file.js) is unaffected — added for ISO's separate
// `iso-evidence` bucket (plan 3.2, D18), never to change task-files behaviour.

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
async function putObject(path, buffer, contentType, bucket) {
  const r = await fetch(`${_base()}/object/${bucket || BUCKET}/${_enc(path)}`, {
    method: 'POST',
    headers: _auth({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': 'no-cache' }),
    body: buffer,
  });
  if (!r.ok) throw new Error(`storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// Short-lived signed URL. With downloadName the response is sent as an attachment under that
// name (Content-Disposition), so it saves instead of opening.
async function signedUrl(path, expiresIn, downloadName, bucket) {
  const r = await fetch(`${_base()}/object/sign/${bucket || BUCKET}/${_enc(path)}`, {
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

// A short-lived signed URL the *browser* uploads directly to (never through this server, so a
// large evidence file never has to fit in Vercel's 4.5 MB body cap). The client PUTs the file
// bytes to `url` with the given token, matching Supabase Storage's resumable/signed-upload flow.
async function signedUploadUrl(bucket, path) {
  const r = await fetch(`${_base()}/object/upload/sign/${bucket || BUCKET}/${_enc(path)}`, {
    method: 'POST',
    headers: _auth({ 'Content-Type': 'application/json' }),
  });
  if (!r.ok) throw new Error(`storage upload-sign failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const rel = j.url;
  if (!rel) throw new Error('storage upload-sign returned no URL');
  return _base() + (rel.startsWith('/') ? rel : '/' + rel);
}

async function removeObjects(paths, bucket) {
  if (!paths || !paths.length) return;
  await fetch(`${_base()}/object/${bucket || BUCKET}`, {
    method: 'DELETE',
    headers: _auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => {});
}

module.exports = { BUCKET, putObject, signedUrl, signedUploadUrl, removeObjects };
