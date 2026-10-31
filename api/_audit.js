// Server-side audit trail (audit H8, 2026-10-17). Leading underscore = shared module, not a Vercel route.
//
// The log inside the shared company record can be rewritten by any staff session and keeps 1,000 events. This writes the
// actions that matter most to their own table, public.audit_log, with the service role. That table has no update or
// delete rule for anyone (migration 002), so what is written here stays. The app also sends its own events there
// (migration 017 lets a signed-in staff member add rows under their own id), and the Audit screen reads them back.
//
// Recording an event must never block or fail the action it describes: it is awaited for a short time, errors are logged,
// and the caller carries on either way. Returns true when the row was written.

const crypto = require('crypto');

const TIMEOUT_MS = 2500;

async function recordAudit({ entityType, entityId, actorId, action, before, after }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const row = {
    id: 'ae' + crypto.randomBytes(8).toString('hex'),
    entity_type: String(entityType || 'Unknown').slice(0, 60),
    entity_id: entityId == null ? null : String(entityId).slice(0, 120),
    actor_id: actorId || null,
    action: String(action || 'unknown').slice(0, 120),
    before_value: before == null ? null : before,
    after_value: after == null ? null : after,
  };
  let timer;
  try {
    const send = fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); });
    const r = await Promise.race([send, late]);
    if (!r) { console.error('[audit] not recorded (timed out):', row.action); return false; }
    if (!r.ok) { console.error('[audit] not recorded:', row.action, r.status); return false; }
    return true;
  } catch (e) {
    console.error('[audit] not recorded:', row.action, e && e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Several events in one request (the MCP connector's bulk task load writes up to a few hundred at once). Same rules as
// recordAudit: best effort, never blocks or fails the action, true when the rows were written.
async function recordAudits(events) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!list.length || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const rows = list.map(({ entityType, entityId, actorId, action, before, after }) => ({
    id: 'ae' + crypto.randomBytes(8).toString('hex'),
    entity_type: String(entityType || 'Unknown').slice(0, 60),
    entity_id: entityId == null ? null : String(entityId).slice(0, 120),
    actor_id: actorId || null,
    action: String(action || 'unknown').slice(0, 120),
    before_value: before == null ? null : before,
    after_value: after == null ? null : after,
  }));
  let timer;
  try {
    const send = fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); });
    const r = await Promise.race([send, late]);
    if (!r) { console.error('[audit] not recorded (timed out):', rows.length, 'events'); return false; }
    if (!r.ok) { console.error('[audit] not recorded:', rows.length, 'events', r.status); return false; }
    return true;
  } catch (e) {
    console.error('[audit] not recorded:', rows.length, 'events', e && e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recordAudit, recordAudits };
