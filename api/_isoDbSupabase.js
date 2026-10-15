// Live ISO data store — PostgREST + RPC against the dev/production Supabase project, with the
// service role key. Leading underscore = shared module, not a Vercel route.
//
// Same interface as _isoDbOffline.js (both must pass .agents/iso-store-test.cjs's contract
// suite). Mutations go through the plpgsql functions in 009_iso_core.sql (iso_create_*,
// iso_update_row, iso_transition_*) — never a raw PostgREST PATCH/POST on an iso_* table — so
// numbering, optimistic concurrency and activity logging stay atomic and server-side, matching
// plan §4.4. Reads use PostgREST directly (RLS denies everything to anon/authenticated, but the
// service role bypasses RLS).
//
// Refuses to start without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (checked by _isoDb.js before
// this module is even required, so every function below can assume they exist).
function _base() { return `${process.env.SUPABASE_URL}/rest/v1`; }
function _rpcBase() { return `${process.env.SUPABASE_URL}/rest/v1/rpc`; }
function _headers(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(extra || {}) };
}
async function _asJson(r, what) {
  if (!r.ok) throw new Error(`${what} failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Per-entity allowlist for filter/sort columns (plan §4.2 "filter and sort columns come only from
// a per-entity allowlist" — never built from the raw request).
const FILTERABLE = {
  iso_audits: ['id', 'client_id', 'archived_at', 'bin_removed_at', 'visibility', 'stage', 'owner_uid', 'report_due', 'previous_audit_id', 'client_portal_enabled'],
  iso_audit_members: ['audit_id', 'user_uid', 'audit_role'],
  iso_audit_units: ['audit_id', 'archived_at'],
  iso_requirements: ['audit_id', 'client_id', 'archived_at', 'assessment_state', 'applicability', 'standard_code', 'clause'],
  iso_findings: ['audit_id', 'client_id', 'archived_at', 'status', 'classification'],
  iso_actions: ['audit_id', 'client_id', 'archived_at', 'status', 'owner_uid', 'owner_kind', 'due_date'],
  iso_comments: ['audit_id', 'entity_type', 'entity_id', 'archived_at'],
  iso_activity: ['audit_id', 'entity_type', 'entity_id', 'action'],
  iso_saved_views: ['audit_id', 'owner_uid'],
  iso_templates: ['archived_at'],
  iso_config: [],
  iso_standard_versions: ['standard_code', 'status', 'edition'],
  iso_audit_standards: ['audit_id'],
  iso_clause_sections: ['version_id'],
  iso_library_requirements: ['version_id'],
  iso_import_runs: ['kind', 'target_audit_id', 'target_version_id', 'sha256', 'status'],
  iso_action_links: ['action_id', 'target_type', 'target_id', 'link_state'],
  iso_action_subtasks: ['audit_id', 'action_id', 'archived_at'],
  iso_action_reviews: ['action_id'],
  iso_action_extensions: ['action_id'],
  // Phase 7.4: finding.list now attaches each finding's source requirement (requirement drawer's
  // own "findings raised from here" panel) — the same §4.2 explicit-allowlist rule every other
  // table here already follows; this table had no entry at all before now (an oversight, same
  // class as A43's unit tables, not a deliberate omission).
  iso_finding_requirements: ['finding_id', 'requirement_id'],
  // Plan 8b.1: relationship.add's clash check and D21's derivation read relationships by audit/state.
  iso_relationships: ['audit_id', 'from_id', 'to_id', 'state', 'kind', 'source'],
  // Phase 8.1/8.2a: evidence.list (by audit/target) and evidence.addLink's own duplicate-link
  // check both filter on these columns — added up front this time, same class of column FILTERABLE
  // must list before a query ever needs it (A54's lesson), not found as a gap after the fact.
  iso_evidence: ['audit_id', 'client_id', 'archived_at', 'visibility', 'kind'],
  iso_evidence_links: ['evidence_id', 'audit_id', 'target_type', 'target_id', 'review_status'],
  iso_evidence_requests: ['audit_id', 'target_type', 'target_id', 'status', 'archived_at'],
  iso_client_responses: ['audit_id', 'archived_at', 'report_version_id', 'status'],
  iso_evidence_uploads: ['evidence_id', 'audit_id', 'reserved_by', 'closed_at'],
  // Plan 8c (migration 014).
  iso_company_profiles: ['client_id'],
  iso_prompt_answers: ['audit_id', 'requirement_id', 'template_key'],
};
function _assertFilterable(table, field) {
  const allow = FILTERABLE[table];
  if (allow && !allow.includes(field) && field !== 'id') throw new Error(`ISO: ${field} is not a filterable column on ${table}`);
}
const OP_MAP = { eq: 'eq', in: 'in', lt: 'lt', lte: 'lte', gt: 'gt', isnull: 'is', notnull: 'is' };

async function get(table, id) {
  const url = `${_base()}/${table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  const rows = await _asJson(await fetch(url, { headers: _headers() }), `get ${table}`);
  return (rows && rows[0]) || null;
}

async function list(table, opts) {
  opts = opts || {};
  const params = new URLSearchParams();
  params.set('select', '*');
  for (const [k, v] of Object.entries(opts.scope || {})) {
    _assertFilterable(table, k);
    params.append(k, `eq.${v}`);
  }
  for (const w of (opts.where || [])) {
    _assertFilterable(table, w.field);
    if (w.op === 'in') params.append(w.field, `in.(${w.value.map(String).join(',')})`);
    else if (w.op === 'isnull') params.append(w.field, 'is.null');
    else if (w.op === 'notnull') params.append(w.field, 'not.is.null');
    else params.append(w.field, `${OP_MAP[w.op] || w.op}.${w.value}`);
  }
  if (opts.order) {
    const [col, dir] = String(opts.order).split(' ');
    _assertFilterable(table, col);
    params.set('order', `${col}.${dir === 'desc' ? 'desc' : 'asc'}`);
  }
  if (opts.limit) params.set('limit', String(opts.limit));
  const url = `${_base()}/${table}?${params.toString()}`;
  return _asJson(await fetch(url, { headers: _headers() }), `list ${table}`) || [];
}

async function insertNumbered(table, kind, scope, row, activity) {
  const fnMap = { iso_audits: 'iso_create_audit', iso_findings: 'iso_create_finding', iso_actions: 'iso_create_action', iso_evidence: 'iso_create_evidence' };
  const fn = fnMap[table];
  if (!fn) throw new Error(`insertNumbered: no create function for ${table}`);
  let body, core;
  if (table === 'iso_audits') {
    core = ['id', 'client_id', 'title', 'audit_type', 'owner_uid', 'visibility'];
    body = { p_id: row.id, p_client_id: row.client_id, p_title: row.title, p_audit_type: row.audit_type, p_owner_uid: row.owner_uid, p_visibility: row.visibility, p_actor_uid: activity && activity.actor_uid };
  } else if (table === 'iso_findings') {
    core = ['id', 'audit_id', 'client_id', 'classification', 'title'];
    body = { p_id: row.id, p_audit_id: row.audit_id, p_client_id: row.client_id, p_classification: row.classification, p_title: row.title, p_actor_uid: activity && activity.actor_uid };
  } else if (table === 'iso_actions') {
    core = ['id', 'audit_id', 'client_id', 'title', 'owner_kind'];
    body = { p_id: row.id, p_audit_id: row.audit_id, p_client_id: row.client_id, p_title: row.title, p_owner_kind: row.owner_kind, p_actor_uid: activity && activity.actor_uid };
  } else {
    core = ['id', 'audit_id', 'client_id', 'kind', 'title', 'description', 'url', 'version_label', 'evidence_date', 'owner_uid', 'confidentiality', 'visibility', 'uploaded_by', 'uploaded_via', 'suggest_related', 'storage_path', 'original_filename', 'mime', 'size_bytes', 'document_status', 'approver_uid', 'effective_date'];
    body = { p_id: row.id, p_audit_id: row.audit_id, p_client_id: row.client_id, p_kind: row.kind, p_title: row.title, p_description: row.description, p_url: row.url, p_version_label: row.version_label, p_evidence_date: row.evidence_date, p_owner_uid: row.owner_uid, p_confidentiality: row.confidentiality, p_visibility: row.visibility, p_uploaded_by: row.uploaded_by, p_uploaded_via: row.uploaded_via, p_actor_uid: activity && activity.actor_uid, p_suggest_related: row.suggest_related !== false,
      // Plan 8.2: an uploaded file's columns, and (8c.5, D22) its document fields — null for a link.
      p_storage_path: row.storage_path || null, p_original_filename: row.original_filename || null, p_mime: row.mime || null, p_size_bytes: row.size_bytes == null ? null : row.size_bytes,
      p_document_status: row.document_status || null, p_approver_uid: row.approver_uid || null, p_effective_date: row.effective_date || null };
  }
  // Fix (2026-10-12): every other field in `row` rides along as p_extra — each create function
  // (009/010) validates its own keys against its own allowlist (same discipline as iso_update_row),
  // so a field a future batch adds to a call site's row object reaches Supabase instead of being
  // silently dropped. This had already happened three times before this fix: B1's statement/
  // criteria/evidence_basis, B2/B4's carried_from_ref/carried_meta/repeat_of_ref, and the original
  // audit.startMaintenance's previous_audit_id/scope_text/library_release — none offline, since
  // _isoDbOffline.js's insertNumbered just writes the whole row object as given.
  const extra = {};
  for (const k of Object.keys(row)) if (!core.includes(k) && k !== 'created_by' && k !== 'updated_by' && row[k] !== undefined) extra[k] = row[k];
  body.p_extra = extra;
  const r = await fetch(`${_rpcBase()}/${fn}`, { method: 'POST', headers: _headers(), body: JSON.stringify(body) });
  return _asJson(r, fn);
}

async function insert(table, row, activity) {
  // Plain inserts (members, units, comments, saved views, …) — not through a numbered create
  // function, but still logged explicitly here since PostgREST itself does not write iso_activity.
  const r = await fetch(`${_base()}/${table}`, { method: 'POST', headers: _headers({ Prefer: 'return=representation' }), body: JSON.stringify(row) });
  const inserted = (await _asJson(r, `insert ${table}`))[0];
  if (activity) await log({ ...activity, after: inserted });
  return inserted;
}

// Release-1 B3.2: snapshots are written once and never changed (migration 015's trigger is the backstop).
const IMMUTABLE_TABLES = ['iso_audit_snapshots', 'iso_report_versions', 'iso_report_acknowledgements']; // + B5.2
function refuseImmutable(table) { if (IMMUTABLE_TABLES.includes(table)) { const e = new Error(`${table} is immutable`); e.code = 'immutable'; throw e; } }
async function update(table, id, patch, expectedVersion, activity) {
  refuseImmutable(table);
  const r = await fetch(`${_rpcBase()}/iso_update_row`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({
      p_table: table, p_id: id, p_patch: patch, p_expected_version: expectedVersion, p_actor_uid: activity && activity.actor_uid, p_actor_kind: activity && activity.actor_kind,
      // A80: the op's own description of the change, so Supabase logs what the offline store logs.
      p_entity_type: (activity && activity.entity_type) || null, p_entity_id: (activity && activity.entity_id) || null, p_entity_ref: (activity && activity.entity_ref) || null,
      p_action: (activity && activity.action) || null, p_field: (activity && activity.field) || null, p_reason: (activity && activity.reason) || null, p_source: (activity && activity.source) || null,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 400 && /version_conflict/.test(text)) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    throw new Error(`update ${table} failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

// Dedicated transition RPCs (plan §4.4 "Status/state, verification, release, close and visibility
// columns change only through dedicated iso_transition_* functions"). Phase 3 left this generic
// entry point throwing ("once those ops exist (Phase 7)") — Phase 7.2 is that phase for findings;
// dispatches by (table, column, to) to the one dedicated RPC that move actually maps to, since
// unlike insertNumbered's one-function-per-table dispatch, findings alone have four different
// destination functions (no single iso_transition_finding exists — see 009's own iso_release_finding
// for why: each verb sets different extra columns, e.g. released_at/released_by, so one generic
// function per verb is the same shape 009 already chose for actions' iso_verify_action/
// iso_reopen_action rather than folding those into iso_transition_action too).
const FINDING_TRANSITION_FN = { released_for_review: 'iso_release_finding', final: 'iso_finalize_finding', closed: 'iso_close_finding', withdrawn: 'iso_withdraw_finding' };
async function transition(table, id, column, from, to, activity, opts) {
  opts = opts || {};
  const act = activity || {};
  if (table === 'iso_actions' && column === 'status') {
    const r = await fetch(`${_rpcBase()}/iso_transition_action`, {
      method: 'POST', headers: _headers(),
      body: JSON.stringify({ p_id: id, p_to: to, p_expected_version: opts.expectedVersion, p_reason: act.reason || null, p_actor_uid: act.actor_uid, p_actor_kind: act.actor_kind }),
    });
    return _asJson(r, 'iso_transition_action');
  }
  if (table === 'iso_findings' && column === 'status') {
    const fn = FINDING_TRANSITION_FN[to];
    if (!fn) throw new Error(`transition(): no finding RPC moves status to ${to}`);
    const r = await fetch(`${_rpcBase()}/${fn}`, {
      method: 'POST', headers: _headers(),
      body: JSON.stringify({ p_id: id, p_expected_version: opts.expectedVersion, p_actor_uid: act.actor_uid }),
    });
    return _asJson(r, fn);
  }
  throw new Error(`transition(): ${table}.${column} has no dedicated RPC yet`);
}

// verifyAction/reopenAction (Phase 7.3 next slice, A41) — iso_verify_action/iso_reopen_action
// don't fit transition()'s (column,from,to) shape (see 009_iso_core.sql: verify sets 4 columns at
// once and only conditionally changes status; reopen gates on a from-status SET plus a required
// reason, not a single from value), so they get their own dedicated methods, same as
// updateMember/patchRow's "extend the interface" precedent (A21/A26).
async function verifyAction(id, result, notes, expectedVersion, activity) {
  const act = activity || {};
  const r = await fetch(`${_rpcBase()}/iso_verify_action`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({ p_id: id, p_result: result, p_notes: notes || null, p_expected_version: expectedVersion, p_actor_uid: act.actor_uid }),
  });
  return _asJson(r, 'iso_verify_action');
}
async function reopenAction(id, reasonCode, reasonText, expectedVersion, activity) {
  const act = activity || {};
  const r = await fetch(`${_rpcBase()}/iso_reopen_action`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({ p_id: id, p_reason_code: reasonCode, p_reason_text: reasonText || null, p_expected_version: expectedVersion, p_actor_uid: act.actor_uid }),
  });
  return _asJson(r, 'iso_reopen_action');
}
// Release-1 B2.4: closed -> reopened through its own RPC (iso_reopen_finding), same shape as reopenAction.
async function reopenFinding(id, reasonCode, reasonText, expectedVersion, activity) {
  const act = activity || {};
  const r = await fetch(`${_rpcBase()}/iso_reopen_finding`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({ p_id: id, p_reason_code: reasonCode, p_reason_text: reasonText || null, p_expected_version: expectedVersion, p_actor_uid: act.actor_uid }),
  });
  return _asJson(r, 'iso_reopen_finding');
}

async function log(activity) {
  const r = await fetch(`${_rpcBase()}/iso_log`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({
      p_audit_id: activity.audit_id || null, p_client_id: activity.client_id || null, p_entity_type: activity.entity_type,
      p_entity_id: activity.entity_id, p_entity_ref: activity.entity_ref || null, p_action: activity.action,
      p_field: activity.field || null, p_before: activity.before || null, p_after: activity.after || null,
      p_reason: activity.reason || null, p_source: activity.source || 'user', p_actor_uid: activity.actor_uid || null,
      p_actor_kind: activity.actor_kind || null,
    }),
  });
  return _asJson(r, 'iso_log');
}

async function counterNext(scope) {
  const r = await fetch(`${_rpcBase()}/iso_next_number`, { method: 'POST', headers: _headers(), body: JSON.stringify({ p_scope: scope }) });
  return _asJson(r, 'iso_next_number');
}

async function importApply(runId, ops) {
  const r = await fetch(`${_rpcBase()}/iso_import_apply`, { method: 'POST', headers: _headers(), body: JSON.stringify({ p_run_id: runId, p_ops: ops, p_actor_uid: null }) });
  return _asJson(r, 'iso_import_apply');
}

// Company profile (plan 8c.1, migration 014). Reads use PostgREST; the write goes through
// iso_upsert_company_profile so the version check, the write and the per-key activity rows stay atomic.
async function getProfile(clientId) {
  const url = `${_base()}/iso_company_profiles?client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`;
  const rows = await _asJson(await fetch(url, { headers: _headers() }), 'getProfile');
  return (rows && rows[0]) || null;
}
async function upsertProfile(clientId, fields, expectedVersion, actorUid, changedKeys) {
  const r = await fetch(`${_rpcBase()}/iso_upsert_company_profile`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({ p_client_id: clientId, p_fields: fields, p_expected_version: expectedVersion || 0, p_actor_uid: actorUid, p_changed_keys: changedKeys || [] }),
  });
  if (!r.ok) {
    const text = await r.text();
    if (/version_conflict/.test(text)) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    throw new Error(`upsertProfile failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

// Guided prompt answers (plan 8c.4, migration 014's iso_save_prompt_answers — atomic version check,
// write and activity row).
async function getPromptAnswers(auditId, requirementId, templateKey) {
  const url = `${_base()}/iso_prompt_answers?audit_id=eq.${encodeURIComponent(auditId)}&requirement_id=eq.${encodeURIComponent(requirementId)}&template_key=eq.${encodeURIComponent(templateKey)}&select=*&limit=1`;
  const rows = await _asJson(await fetch(url, { headers: _headers() }), 'getPromptAnswers');
  return (rows && rows[0]) || null;
}
async function savePromptAnswers(row, expectedVersion, actorUid) {
  const r = await fetch(`${_rpcBase()}/iso_save_prompt_answers`, {
    method: 'POST', headers: _headers(),
    body: JSON.stringify({ p_id: row.id, p_audit_id: row.audit_id, p_client_id: row.client_id, p_requirement_id: row.requirement_id, p_template_key: row.template_key, p_template_version: row.template_version, p_answers: row.answers, p_expected_version: expectedVersion || 0, p_actor_uid: actorUid }),
  });
  if (!r.ok) {
    const text = await r.text();
    if (/version_conflict/.test(text)) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    throw new Error(`savePromptAnswers failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

async function getConfig(key) {
  const url = `${_base()}/iso_config?key=eq.${encodeURIComponent(key)}&select=*&limit=1`;
  const rows = await _asJson(await fetch(url, { headers: _headers() }), 'getConfig');
  return (rows && rows[0]) || null;
}
async function upsertConfig(key, value, updatedBy, activity) {
  const r = await fetch(`${_base()}/iso_config`, {
    method: 'POST',
    headers: _headers({ Prefer: 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString(), updated_by: updatedBy }),
  });
  const row = (await _asJson(r, 'upsertConfig'))[0];
  if (activity) await log(activity);
  return row;
}

async function updateMember(auditId, userUid, patch, activity) {
  const params = new URLSearchParams();
  params.append('audit_id', `eq.${auditId}`);
  params.append('user_uid', `eq.${userUid}`);
  const r = await fetch(`${_base()}/iso_audit_members?${params.toString()}`, {
    method: 'PATCH', headers: _headers({ Prefer: 'return=representation' }), body: JSON.stringify(patch),
  });
  const rows = await _asJson(r, 'updateMember');
  if (!rows || !rows[0]) { const e = new Error('member not found'); e.code = 'not_found'; throw e; }
  if (activity) await log({ ...activity, after: rows[0] });
  return rows[0];
}
async function removeMember(auditId, userUid, activity) {
  const params = new URLSearchParams();
  params.append('audit_id', `eq.${auditId}`);
  params.append('user_uid', `eq.${userUid}`);
  const r = await fetch(`${_base()}/iso_audit_members?${params.toString()}`, { method: 'DELETE', headers: _headers() });
  if (!r.ok) throw new Error(`removeMember failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  if (activity) await log(activity);
  return { removed: true };
}

// Evidence storage (Phase 8) — bucket iso-evidence, separate from task-files. Implemented via
// _storage.js's bucket-aware helpers (plan 3.2 "Add an optional bucket argument").
const { signedUrl, putObject, removeObjects, signedUploadUrl } = require('./_storage');
const EVIDENCE_BUCKET = 'iso-evidence';
async function storageSignedUpload(filePath) { return { url: await signedUploadUrl(EVIDENCE_BUCKET, filePath), path: filePath }; }
async function storageSignedDownload(filePath, name) { return { url: await signedUrl(filePath, 120, name, EVIDENCE_BUCKET), path: filePath, name }; }
async function storageHead(filePath) {
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/info/${EVIDENCE_BUCKET}/${filePath.split('/').map(encodeURIComponent).join('/')}`, { headers: _headers() });
  if (!r.ok) return { exists: false, size: 0 };
  const j = await r.json();
  // Plan 8.2: evidence.register checks the stored type too. Storage's object-info shape has varied
  // across versions (top-level size/content_type, or metadata.size/mimetype) — read either. Not yet
  // verified against a real project (the standing A9/STOP 1 caveat).
  const meta = j.metadata || {};
  return { exists: true, size: Number(j.size != null ? j.size : meta.size != null ? meta.size : meta.contentLength) || 0, mime: j.content_type || j.contentType || meta.mimetype || null };
}
async function storagePut(filePath, bytes, type) { await putObject(filePath, bytes, type, EVIDENCE_BUCKET); return { path: filePath }; }
// Release-1 B3.3: an uploaded file's bytes (the close snapshot's SHA-256), through a short signed URL.
async function storageGet(filePath) {
  try {
    const r = await fetch(await signedUrl(filePath, 60, null, EVIDENCE_BUCKET));
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch (e) { return null; }
}
async function storageRemove(filePath) { await removeObjects([filePath], EVIDENCE_BUCKET); }

// See _isoDbOffline.js's patchRow comment (plan §14 A26) — direct, unconditional, unlogged
// single-row patch for tables with no row_version (iso_standard_versions, iso_import_runs).
async function patchRow(table, id, patch) {
  refuseImmutable(table);
  const r = await fetch(`${_base()}/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: _headers({ Prefer: 'return=representation' }), body: JSON.stringify(patch),
  });
  const rows = await _asJson(r, `patchRow ${table}`);
  return (rows && rows[0]) || null;
}

module.exports = {
  get, list, insertNumbered, insert, update, transition, log, counterNext, importApply,
  updateMember, removeMember, getConfig, upsertConfig, patchRow, verifyAction, reopenAction, reopenFinding, getProfile, upsertProfile, getPromptAnswers, savePromptAnswers,
  storageSignedUpload, storageSignedDownload, storageHead, storagePut, storageGet, storageRemove,
  _test: { FILTERABLE },
};
