// Server-side access to the app_state blob (row id=1) with the service role key.
// Leading underscore = shared module, not a Vercel route.
//
// casWrite is the same compare-and-swap the browser sync uses (_syncMergeWrite in index.html):
// the UPDATE only lands if updated_at still equals the value we read, so a staff save that
// happened in between is never silently overwritten — the caller re-reads and retries instead.

function _headers(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...(extra || {}) };
}

// → { data, updatedAt }  (throws on failure)
async function readBlob() {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_state?id=eq.1&select=data,updated_at&limit=1`, { headers: _headers() });
  if (!r.ok) throw new Error(`app_state read failed (${r.status})`);
  const row = (await r.json())[0];
  if (!row || !row.data) throw new Error('app_state row missing');
  return { data: row.data, updatedAt: row.updated_at };
}

// → true if written, false if someone else wrote first (re-read and retry)
async function casWrite(data, prevUpdatedAt) {
  let stamp = new Date().toISOString();
  if (stamp === prevUpdatedAt) stamp = new Date(Date.now() + 1).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_state?id=eq.1&updated_at=eq.${encodeURIComponent(prevUpdatedAt)}&select=id`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: _headers({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({ data, updated_at: stamp }),
  });
  if (!r.ok) throw new Error(`app_state write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return Array.isArray(rows) && rows.length === 1;
}

module.exports = { readBlob, casWrite };
