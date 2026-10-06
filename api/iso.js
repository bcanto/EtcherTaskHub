// POST /api/iso — the only ISO Audit route (plan §4.1). Body: {op:'<name>', auditId?, clientId?,
// ...payload}. Every op resolves the audit first (if it has one), checks the caller against that
// audit, then runs. Reads and writes both go through here, like the client portal.
const { isoOfflineMode, resolveIsoCaller } = require('./_isoAuth');
const { getAdapter } = require('./_isoDb');
const {
  registry, IsoError, badRequest, notFound, forbidden, conflict,
  isValidId, resolveMembership, projectForClient, CLIENT_FIELDS,
} = require('./_iso');
const { readBlob } = require('./_blob');

function isoEnabled() { return isoOfflineMode() || process.env.ISO_ENABLED === '1'; }

async function isoYear() {
  // iso_config.timezone defaults to Australia/Perth (plan §8) — Vercel itself runs in UTC.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric' }).format(new Date());
}

// plan 3.4: audit.create validates the client exists and is not archived in the blob. Offline has
// no blob to read, so it accepts the seed ids only — clearly an offline-only fixture, never
// mistaken for a real client list.
const OFFLINE_CLIENTS = new Set(['c0', 'c1', 'c2', 'c3']);
async function checkClientExists(clientId) {
  if (isoOfflineMode()) {
    if (!OFFLINE_CLIENTS.has(clientId)) throw badRequest('Unknown client.');
    return;
  }
  const { data } = await readBlob();
  const client = (data.clients || []).find(c => c.id === clientId);
  if (!client || client.archived) throw badRequest('Unknown or archived client.');
}

// Phase 7b.6 (D14): export.gantt's client version shows "owners as display names," and its header
// band shows a client NAME, not a raw clientId/owner_uid — neither of which exists in this file's
// (or the offline store's) own data. Same dual-path precedent as checkClientExists just above:
// offline has no real blob, so a hardcoded fixture map stands in for it; production reads the
// real blob. Kept to exactly these two lookups (never a general "get me the whole blob" ctx
// method) so nothing broader than a name string ever has a path out of Task Hub's own data.
const OFFLINE_CLIENT_NAMES = { c0: 'Etcher Solutions', c1: 'General Cranes', c2: 'Daltech', c3: 'Retained Services' };
const OFFLINE_STAFF_NAMES = { u1: 'Bruna Canto', u2: 'Sam Wignall', u3: 'Project Manager', u4: 'Admin Officer', u5: 'HSEQ Coordinator' };
async function getClientName(clientId) {
  if (!clientId) return null;
  if (isoOfflineMode()) return OFFLINE_CLIENT_NAMES[clientId] || clientId;
  const { data } = await readBlob();
  const c = (data.clients || []).find(x => x.id === clientId);
  return c ? c.name : clientId;
}
async function getStaffName(uid) {
  if (!uid) return null;
  if (isoOfflineMode()) return OFFLINE_STAFF_NAMES[uid] || null;
  const { data } = await readBlob();
  const u = (data.users || data.staff || []).find(x => x.id === uid);
  return u ? u.name : null;
}

// plan 3.3: clientUser.list — profiles with that client_id. Offline returns a labelled
// offline-only fixture so client memberships and portal tests work without a real Supabase
// project.
async function listClientUsers(clientId) {
  if (isoOfflineMode()) {
    return [
      { uid: 'offline:cu1', name: 'Offline Client User 1 (fixture)', clientId },
      { uid: 'offline:cu2', name: 'Offline Client User 2 (fixture)', clientId },
    ];
  }
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?client_id=eq.${encodeURIComponent(clientId)}&role=eq.client&active=eq.true&select=id,name`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!r.ok) throw new Error(`clientUser.list failed (${r.status})`);
  const rows = await r.json();
  return rows.map(p => ({ uid: p.id, name: p.name, clientId }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isoEnabled()) return res.status(404).json({ error: 'ISO Audit is not enabled' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : null;
  const opName = body && typeof body.op === 'string' ? body.op : null;
  if (!opName) return res.status(400).json({ error: 'Missing op.' });
  const def = registry[opName];
  if (!def) return res.status(400).json({ error: `Unknown op: ${opName}` });

  const caller = await resolveIsoCaller(req, res);
  if (!caller) return; // response already sent (401/403/500)

  const db = getAdapter();
  const now = new Date();

  try {
    let audit = null, members = [], membership = null;
    if (def.scope === 'audit') {
      if (!isValidId(body.auditId)) throw badRequest('A valid auditId is required.');
      audit = await db.get('iso_audits', body.auditId);
      if (!audit || audit.archived_at) throw notFound('Audit not found.');
      // If both auditId and a nested record id are sent, record.audit_id must equal it (plan
      // §4.1) — enforced per-op, since each op's run() already resolves and scopes its own
      // nested ids (e.g. member.update resolves ctx.payload.uid against ctx.members, which is
      // already scoped to this audit) rather than a second, generic pass here.
      members = await db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }] });
      membership = resolveMembership(caller, audit, members);
      if (!membership) throw forbidden('You do not have access to this ISO board.');
      // A client caller's capabilities are capped at client_admin/client_contributor whatever
      // audit_role says (plan §4.1) — belt and braces on top of allowedAuditRoles at creation time.
      if (caller.kind === 'client' && !['client_admin', 'client_contributor'].includes(membership.audit_role)) {
        throw forbidden('You do not have access to this ISO board.');
      }
    }

    const ctx = {
      caller, db, payload: body, audit, members, membership, now,
      isoYear, checkClientExists, listClientUsers, getClientName, getStaffName,
    };

    if (def.validate) await def.validate(body, ctx);
    if (!(await def.allow(ctx))) throw forbidden();
    let data = await def.run(ctx);

    // Client projection (plan §6.3 — whitelist only, never a blocklist).
    if (caller.kind === 'client' && def.clientProjection) {
      const entity = def.clientProjection;
      if (Array.isArray(data)) {
        // after_approval (findings only, plan §6.3) is client-visible once released_at is set —
        // this dispatcher had no path for it at all until Phase 7.2's finding.list needed it
        // (plan §14 A39); additive only, since no other entity's check constraint allows this
        // visibility value in the first place (existing rows fall through unaffected).
        data = data.filter(row => entity === 'audit' || entity === 'member' || entity === 'unit' || row.visibility === 'client_all' || row.visibility === 'client_selected' && (row.visible_to_uids || []).includes(caller.uid) || row.visibility === 'after_approval' && !!row.released_at)
          .map(row => projectForClient(entity, row));
      } else if (data && typeof data === 'object') {
        data = projectForClient(entity, data);
      }
    } else if (caller.kind === 'client' && !def.clientProjection) {
      // No allowlist declared for this op at all -> a client must never see its result shape,
      // even accidentally (defence in depth; ops without a real client use case simply refuse
      // client callers in their own allow(), so this should be unreachable in practice).
      throw forbidden();
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    if (e instanceof IsoError) return res.status(e.status).json({ error: e.message || 'Request failed' });
    console.error('[iso]', opName, e.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
