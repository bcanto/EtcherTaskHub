// Offline ISO data store — a JSON file, used only when isoOfflineMode() is true (see _isoAuth.js).
// Leading underscore = shared module, not a Vercel route.
//
// serve.mjs drops every api/ module from the require cache on each request (so edits apply
// without a restart), which means a module-level mutex or cache does NOT work here — a fresh
// module instance loses whatever was held in memory between requests. Concurrency instead uses a
// process-wide lock on globalThis.__isoOfflineLock (survives the require-cache drop because it's
// on globalThis, not on this module) and reads the file fresh inside the lock on every operation.
//
// `.iso-offline/` is the user's own review data once they start using it for real — no test
// suite may write to, reset or read the default directory. Every suite that writes sets
// ISO_OFFLINE_DIR to a fresh temp directory instead (plan §4.2).
const fs = require('fs');
const path = require('path');

function _dir() { return process.env.ISO_OFFLINE_DIR || path.join(__dirname, '..', '.iso-offline'); }
function _storePath() { return path.join(_dir(), 'store.json'); }
function _filesDir() { return path.join(_dir(), 'files'); }
function nowIso() { return new Date().toISOString(); }

const TABLES = [
  'iso_standards', 'iso_standard_versions', 'iso_clause_sections', 'iso_library_requirements',
  'iso_audits', 'iso_templates', 'iso_audit_standards', 'iso_audit_units', 'iso_audit_members',
  'iso_requirements', 'iso_relationships', 'iso_comments', 'iso_activity', 'iso_saved_views',
  'iso_notifications', 'iso_import_runs', 'iso_findings', 'iso_finding_requirements', 'iso_actions',
  'iso_action_subtasks', 'iso_action_reviews', 'iso_action_links', 'iso_action_extensions',
  'iso_risks', 'iso_risk_proposals', 'iso_obligations', 'iso_controls', 'iso_control_clauses',
  'iso_documents', 'iso_register_links', 'iso_evidence', 'iso_evidence_links', 'iso_evidence_requests',
  'iso_evidence_uploads', // plan 8.2 (migration 010)
  'iso_reports', 'iso_report_versions', 'iso_client_responses',
  'iso_company_profiles', 'iso_prompt_answers', // plan 8c (migration 014)
];

// Same defaults migration 009 inserts (plan §4.2 "On first init a store seeds the same default
// iso_config rows as migration 009"). Row-shaped ({key, value, ...}), matching the SQL table —
// api/_iso.js's config.get/set treat this table as a list of rows, the same as everywhere else.
function _defaultConfig() {
  const rows = {
    finding_classifications: ['major_nc', 'minor_nc', 'observation', 'ofi'],
    gap_categories: ['documentation', 'implementation', 'effectiveness', 'evidence', 'competence_awareness', 'resources', 'other'],
    fishbone_categories: ['People', 'Method', 'Machine/Equipment', 'Materials', 'Measurement', 'Environment'],
    number_prefixes: { audit: 'AUD', finding: 'F', action: 'A', evidence: 'E', report: 'R' },
    timezone: 'Australia/Perth',
    evidence_max_upload_mb: 10,
  };
  return Object.entries(rows).map(([key, value]) => ({ key, value, updated_at: nowIso(), updated_by: null }));
}
function _defaultStandards() {
  return [
    { code: '9001', name: 'ISO 9001', title: 'Quality Management System', system_abbrev: 'QMS', badge: 'Q', color: '#1d6fb8', active: true },
    { code: '14001', name: 'ISO 14001', title: 'Environmental Management System', system_abbrev: 'EMS', badge: 'E', color: '#0d6e4e', active: true },
    { code: '45001', name: 'ISO 45001', title: 'Occupational Health and Safety Management System', system_abbrev: 'OHS', badge: 'S', color: '#b45309', active: true },
  ];
}
function _freshStore() {
  const store = { iso_config: _defaultConfig(), iso_counters: {}, _activitySeq: 0 };
  for (const t of TABLES) store[t] = [];
  store.iso_standards = _defaultStandards();
  return store;
}

// Process-wide lock: a promise chain on globalThis, so it survives serve.mjs's per-request
// require-cache drop. Every read-modify-write operation runs its body inside this.
function withLock(fn) {
  const prev = globalThis.__isoOfflineLock || Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if the previous chain step rejected
  globalThis.__isoOfflineLock = next.catch(() => {}); // never let one failure wedge the chain
  return next;
}

async function _readRaw() {
  try {
    const text = await fs.promises.readFile(_storePath(), 'utf-8');
    const parsed = JSON.parse(text);
    // Fill in any table/collection missing from an older store on disk.
    for (const t of TABLES) if (!parsed[t]) parsed[t] = [];
    if (!parsed.iso_config) parsed.iso_config = _defaultConfig();
    if (!parsed.iso_counters) parsed.iso_counters = {};
    if (typeof parsed._activitySeq !== 'number') parsed._activitySeq = (parsed.iso_activity || []).reduce((m, a) => Math.max(m, a.id || 0), 0);
    if (!parsed.iso_standards || !parsed.iso_standards.length) parsed.iso_standards = _defaultStandards();
    return parsed;
  } catch (e) {
    if (e.code === 'ENOENT') return _freshStore();
    throw e;
  }
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
// Atomic write: temp file + rename, retried on the transient lock errors OneDrive is known to
// produce (the repo lives inside OneDrive — plan §4.2).
async function _writeRaw(store) {
  await fs.promises.mkdir(_dir(), { recursive: true });
  const tmp = _storePath() + '.tmp';
  const text = JSON.stringify(store, null, 2);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.promises.writeFile(tmp, text, 'utf-8');
      await fs.promises.rename(tmp, _storePath());
      return;
    } catch (e) {
      if (RETRYABLE.has(e.code) && attempt < 9) {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      throw e;
    }
  }
}

function _matchWhere(row, w) {
  const val = row[w.field];
  switch (w.op) {
    case 'eq': return val === w.value;
    case 'in': return Array.isArray(w.value) && w.value.includes(val);
    case 'lt': return val < w.value;
    case 'lte': return val <= w.value;
    case 'gt': return val > w.value;
    case 'isnull': return val === null || val === undefined;
    case 'notnull': return val !== null && val !== undefined;
    default: return true;
  }
}

async function get(table, id) {
  const store = await _readRaw();
  return (store[table] || []).find(r => r.id === id) || null;
}

async function list(table, opts) {
  opts = opts || {};
  const store = await _readRaw();
  let rows = (store[table] || []).slice();
  for (const [k, v] of Object.entries(opts.scope || {})) rows = rows.filter(r => r[k] === v);
  for (const w of (opts.where || [])) rows = rows.filter(r => _matchWhere(r, w));
  if (opts.order) {
    const [col, dir] = String(opts.order).split(' ');
    rows.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  if (opts.limit) rows = rows.slice(0, opts.limit);
  return rows;
}

function counterNext(scope) {
  return withLock(async () => {
    const store = await _readRaw();
    const cur = store.iso_counters[scope] || 1;
    store.iso_counters[scope] = cur + 1;
    await _writeRaw(store);
    return cur;
  });
}

function _padNumber(n, minWidth) {
  const s = String(n);
  return s.padStart(Math.max(minWidth || 3, s.length), '0');
}
// kind: 'audit' (scope 'AUD-<year>', ref = scope + '-NNN') | 'child' (scope '<auditId>:F|A|E|R',
// ref = <audit ref>-<letter>NNN) | 'register' (scope '<clientId>:RSK|OBL|CTL|DOC', ref =
// <letter>-NNN). These three kinds are this codebase's own internal vocabulary (plan §4.1a
// doesn't fix kind's string values) — api/_iso.js is the only caller, so both adapters just need
// to agree with each other, which they do by both following this file's convention.
function _formatRef(kind, scope, n, store) {
  const padded = _padNumber(n, 3);
  if (kind === 'audit') return scope + '-' + padded;
  if (kind === 'child') {
    const [auditId, letter] = scope.split(':');
    const audit = (store.iso_audits || []).find(a => a.id === auditId);
    if (!audit) throw new Error('insertNumbered: unknown audit ' + auditId);
    return audit.ref + '-' + letter + padded;
  }
  if (kind === 'register') {
    const [, letter] = scope.split(':');
    return letter + '-' + padded;
  }
  throw new Error('insertNumbered: unknown kind ' + kind);
}

function insertNumbered(table, kind, scope, row, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const cur = store.iso_counters[scope] || 1;
    store.iso_counters[scope] = cur + 1;
    const ref = _formatRef(kind, scope, cur, store);
    const fullRow = { row_version: 1, created_at: nowIso(), updated_at: nowIso(), ...row, ref };
    store[table] = store[table] || [];
    store[table].push(fullRow);
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), after: activity.after || fullRow }));
    await _writeRaw(store);
    return fullRow;
  });
}

function insert(table, row, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    store[table] = store[table] || [];
    const fullRow = { row_version: 1, created_at: nowIso(), updated_at: nowIso(), ...row };
    store[table].push(fullRow);
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), after: activity.after || fullRow }));
    await _writeRaw(store);
    return fullRow;
  });
}

function update(table, id, patch, expectedVersion, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store[table] || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('ISO record not found'); e.code = 'not_found'; throw e; }
    const row = rows[idx];
    if (expectedVersion == null) { const e = new Error('expectedVersion is required'); e.code = 'bad_request'; throw e; }
    if (row.row_version !== expectedVersion) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    const before = { ...row };
    const updated = { ...row, ...patch, row_version: row.row_version + 1, updated_at: nowIso() };
    rows[idx] = updated;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: updated }));
    await _writeRaw(store);
    return updated;
  });
}

// opts (Phase 7, additive — every existing 6-arg call keeps working unchanged): {expectedVersion,
// extra}. expectedVersion adds the same optimistic-concurrency check update() already has (the
// Supabase adapter's own dedicated transition RPCs are row_version-based, not from-state-based —
// checking both here means an offline transition() call and its real-Postgres counterpart agree on
// when a transition is stale, not just on which state changes are legal). extra is a plain object
// of additional columns to set alongside `column` (e.g. released_at/released_by) — every dedicated
// SQL transition function already sets its own such columns inside the same statement; this is the
// offline adapter's equivalent, since it has no per-verb SQL of its own to do that in.
function transition(table, id, column, from, to, activity, opts) {
  opts = opts || {};
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store[table] || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('ISO record not found'); e.code = 'not_found'; throw e; }
    const row = rows[idx];
    const fromOk = Array.isArray(from) ? from.includes(row[column]) : row[column] === from;
    if (!fromOk) { const e = new Error(`cannot move ${column} from ${row[column]} to ${to}`); e.code = 'invalid_transition'; throw e; }
    if (opts.expectedVersion != null && row.row_version !== opts.expectedVersion) {
      const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e;
    }
    const before = { ...row };
    const updated = { ...row, [column]: to, ...(opts.extra || {}), row_version: row.row_version + 1, updated_at: nowIso() };
    rows[idx] = updated;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: updated }));
    await _writeRaw(store);
    return updated;
  });
}

// verifyAction/reopenAction (Phase 7.3 next slice) — mirror iso_verify_action/iso_reopen_action's
// exact SQL shape (009_iso_core.sql) rather than db.transition()'s (column,from,to) shape, since
// neither is a single-column from->to move: verify sets 4 columns at once and only conditionally
// changes status; reopen is gated on a set of from-statuses plus a required reason, not a single
// from value (A41).
function verifyAction(id, result, notes, expectedVersion, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store.iso_actions || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('unknown action'); e.code = 'not_found'; throw e; }
    const row = rows[idx];
    if (row.row_version !== expectedVersion) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    if (!['effective', 'ineffective'].includes(result)) { const e = new Error(`invalid verification result ${result}`); e.code = 'bad_request'; throw e; }
    const before = { ...row };
    const updated = {
      ...row, verification_status: result, verification_notes: notes || null, verified_by: activity.actor_uid,
      verified_at: nowIso(), status: result === 'ineffective' ? 'in_progress' : row.status,
      row_version: row.row_version + 1, updated_at: nowIso(),
    };
    rows[idx] = updated;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: updated }));
    await _writeRaw(store);
    return updated;
  });
}
function reopenAction(id, reasonCode, reasonText, expectedVersion, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store.iso_actions || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('unknown action'); e.code = 'not_found'; throw e; }
    const row = rows[idx];
    if (row.row_version !== expectedVersion) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    if (!['verified', 'closed'].includes(row.status)) { const e = new Error('only a verified or closed action can be reopened'); e.code = 'invalid_transition'; throw e; }
    if (!reasonCode) { const e = new Error('a reason is required to reopen an action'); e.code = 'bad_request'; throw e; }
    const before = { ...row };
    const updated = {
      ...row, status: 'in_progress', reopened_count: (row.reopened_count || 0) + 1,
      row_version: row.row_version + 1, updated_at: nowIso(),
    };
    rows[idx] = updated;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: updated }));
    await _writeRaw(store);
    return updated;
  });
}

// Release-1 B2.4: mirrors iso_reopen_finding (009_iso_core.sql) — closed -> reopened, the count and
// the reason on the row, the closing stamp cleared (the finding is open again).
function reopenFinding(id, reasonCode, reasonText, expectedVersion, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store.iso_findings || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('unknown finding'); e.code = 'not_found'; throw e; }
    const row = rows[idx];
    if (row.row_version !== expectedVersion) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    if (row.status !== 'closed') { const e = new Error('only a closed finding can be reopened'); e.code = 'invalid_transition'; throw e; }
    if (!reasonCode) { const e = new Error('a reason is required to reopen a finding'); e.code = 'bad_request'; throw e; }
    const before = { ...row };
    const updated = {
      ...row, status: 'reopened', reopened_count: (row.reopened_count || 0) + 1,
      reopen_reason: reasonCode + (reasonText ? ': ' + reasonText : ''), closed_at: null, closed_by: null,
      row_version: row.row_version + 1, updated_at: nowIso(),
    };
    rows[idx] = updated;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: updated }));
    await _writeRaw(store);
    return updated;
  });
}

function log(activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const entry = Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso() });
    store.iso_activity.push(entry);
    await _writeRaw(store);
    return entry;
  });
}

// All-or-nothing: ops are applied to an in-memory copy of the store, which is only written to
// disk once every op has succeeded — an exception partway through never touches store.json.
function importApply(runId, ops) {
  return withLock(async () => {
    const store = await _readRaw();
    const backup = [];
    for (const op of ops) {
      if (!TABLES.includes(op.table)) throw new Error('importApply: unknown table ' + op.table);
      if (!op.id || !op.patch) throw new Error('importApply: malformed op ' + JSON.stringify(op));
      const rows = (store[op.table] = store[op.table] || []);
      const idx = rows.findIndex(r => r.id === op.id);
      if (idx === -1) {
        rows.push(Object.assign({ row_version: 1, created_at: nowIso(), updated_at: nowIso() }, op.patch, { id: op.id }));
        backup.push({ table: op.table, id: op.id, before: null });
      } else {
        backup.push({ table: op.table, id: op.id, before: { ...rows[idx] } });
        rows[idx] = Object.assign({}, rows[idx], op.patch, { row_version: rows[idx].row_version + 1, updated_at: nowIso() });
      }
    }
    const run = (store.iso_import_runs || []).find(r => r.id === runId);
    if (run) { run.status = 'applied'; run.at = nowIso(); run.backup = backup; }
    await _writeRaw(store);
    return { applied: ops.length };
  });
}

// Evidence storage (plan §4.7): offline has no real signed URLs — evidence bytes go through
// /api/iso as base64 (evidence.offlinePut, plan 8.2) and land under .iso-offline/files/, named from
// the server-chosen storage path with the separators flattened and the extension dropped — never
// the client's filename, never an extension. A `.type` sidecar keeps the type the bytes were sent
// with, standing in for the object metadata Supabase Storage keeps, so evidence.register's type
// check runs offline too.
function _safeFileName(p) { return String(p).replace(/[\\/]/g, '_').replace(/\.[A-Za-z0-9]{1,10}$/, ''); }
async function storageSignedUpload(filePath) { return { url: null, path: filePath }; }
async function storageSignedDownload(filePath, name) { return { url: null, path: filePath, name }; }
async function storageHead(filePath) {
  const base = path.join(_filesDir(), _safeFileName(filePath));
  try {
    const st = await fs.promises.stat(base);
    let mime = null;
    try { mime = (await fs.promises.readFile(base + '.type', 'utf8')).trim() || null; } catch (e) {}
    return { exists: true, size: st.size, mime };
  } catch (e) { return { exists: false, size: 0, mime: null }; }
}
async function storagePut(filePath, bytes, type) {
  await fs.promises.mkdir(_filesDir(), { recursive: true });
  const base = path.join(_filesDir(), _safeFileName(filePath));
  await fs.promises.writeFile(base, bytes);
  await fs.promises.writeFile(base + '.type', String(type || ''));
  return { path: filePath };
}
// Offline only — evidence.downloadUrl returns the bytes when there is no signed URL to give.
async function storageGet(filePath) {
  try { return await fs.promises.readFile(path.join(_filesDir(), _safeFileName(filePath))); } catch (e) { return null; }
}
async function storageRemove(filePath) {
  const base = path.join(_filesDir(), _safeFileName(filePath));
  for (const p of [base, base + '.type']) { try { await fs.promises.unlink(p); } catch (e) {} }
}

// iso_config is keyed by `key`, not `id`, and (like iso_audit_members) has no row_version — a
// dedicated pair rather than forcing it through the generic id+version-shaped get()/update().
async function getConfig(key) {
  const store = await _readRaw();
  return (store.iso_config || []).find(r => r.key === key) || null;
}
function upsertConfig(key, value, updatedBy, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    store.iso_config = store.iso_config || [];
    const idx = store.iso_config.findIndex(r => r.key === key);
    const before = idx === -1 ? null : store.iso_config[idx].value;
    const row = { key, value, updated_at: nowIso(), updated_by: updatedBy };
    if (idx === -1) store.iso_config.push(row); else store.iso_config[idx] = row;
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: value }));
    await _writeRaw(store);
    return row;
  });
}

// Company profile (plan 8c.1; mirrors migration 014's iso_upsert_company_profile): one row per client,
// keyed by client_id, optimistic concurrency (expected 0 = "no profile yet"), one activity row per
// changed key.
async function getProfile(clientId) {
  const store = await _readRaw();
  return (store.iso_company_profiles || []).find(r => r.client_id === clientId) || null;
}
function upsertProfile(clientId, fields, expectedVersion, actorUid, changedKeys) {
  return withLock(async () => {
    const store = await _readRaw();
    store.iso_company_profiles = store.iso_company_profiles || [];
    const idx = store.iso_company_profiles.findIndex(r => r.client_id === clientId);
    const prev = idx === -1 ? null : store.iso_company_profiles[idx];
    if ((prev ? prev.row_version : 0) !== (expectedVersion || 0)) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    const row = prev
      ? { ...prev, fields, row_version: prev.row_version + 1, updated_at: nowIso(), updated_by: actorUid }
      : { client_id: clientId, fields, row_version: 1, created_at: nowIso(), created_by: actorUid, updated_at: nowIso(), updated_by: actorUid };
    if (idx === -1) store.iso_company_profiles.push(row); else store.iso_company_profiles[idx] = row;
    for (const k of (changedKeys || [])) {
      store.iso_activity.push({
        id: ++store._activitySeq, at: nowIso(), audit_id: null, client_id: clientId, entity_type: 'company_profile', entity_id: clientId,
        entity_ref: null, action: 'profile_updated', field: k,
        before: prev && prev.fields && prev.fields[k] !== undefined ? prev.fields[k] : null,
        after: fields[k] === undefined ? null : fields[k], reason: null, source: 'user', actor_uid: actorUid, actor_kind: 'staff',
      });
    }
    await _writeRaw(store);
    return row;
  });
}

// Guided prompt answers (plan 8c.4; mirrors migration 014's iso_save_prompt_answers): one row per
// (audit, requirement, template), optimistic concurrency (expected 0 = none yet), one activity row.
async function getPromptAnswers(auditId, requirementId, templateKey) {
  const store = await _readRaw();
  return (store.iso_prompt_answers || []).find(r => r.audit_id === auditId && r.requirement_id === requirementId && r.template_key === templateKey) || null;
}
function savePromptAnswers(row, expectedVersion, actorUid) {
  return withLock(async () => {
    const store = await _readRaw();
    store.iso_prompt_answers = store.iso_prompt_answers || [];
    const idx = store.iso_prompt_answers.findIndex(r => r.audit_id === row.audit_id && r.requirement_id === row.requirement_id && r.template_key === row.template_key);
    const prev = idx === -1 ? null : store.iso_prompt_answers[idx];
    if ((prev ? prev.row_version : 0) !== (expectedVersion || 0)) { const e = new Error('version_conflict'); e.code = 'version_conflict'; throw e; }
    const next = prev
      ? { ...prev, answers: row.answers, template_version: row.template_version, row_version: prev.row_version + 1, updated_at: nowIso(), updated_by: actorUid }
      : { ...row, row_version: 1, created_at: nowIso(), created_by: actorUid, updated_at: nowIso(), updated_by: actorUid };
    if (idx === -1) store.iso_prompt_answers.push(next); else store.iso_prompt_answers[idx] = next;
    store.iso_activity.push({
      id: ++store._activitySeq, at: nowIso(), audit_id: row.audit_id, client_id: row.client_id, entity_type: 'requirement', entity_id: row.requirement_id,
      entity_ref: null, action: 'prompt_answers_saved', field: row.template_key, before: prev ? prev.answers : null, after: next.answers,
      reason: null, source: 'user', actor_uid: actorUid, actor_kind: 'staff',
    });
    await _writeRaw(store);
    return next;
  });
}


// iso_audit_members has a composite key (audit_id, user_uid) and no row_version (plan §5.1 —
// membership isn't optimistically-concurrent like the tables the generic update()/transition()
// assume). A deliberate, minimal extension to the "fixed" _isoDb interface rather than forcing a
// single-id/versioned shape onto a table that structurally has neither (hard rule 12).
function updateMember(auditId, userUid, patch, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store.iso_audit_members || [];
    const idx = rows.findIndex(r => r.audit_id === auditId && r.user_uid === userUid);
    if (idx === -1) { const e = new Error('member not found'); e.code = 'not_found'; throw e; }
    const before = { ...rows[idx] };
    rows[idx] = { ...rows[idx], ...patch };
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: rows[idx] }));
    await _writeRaw(store);
    return rows[idx];
  });
}
function removeMember(auditId, userUid, activity) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store.iso_audit_members || [];
    const idx = rows.findIndex(r => r.audit_id === auditId && r.user_uid === userUid);
    if (idx === -1) { const e = new Error('member not found'); e.code = 'not_found'; throw e; }
    const before = rows[idx];
    rows.splice(idx, 1);
    if (activity) store.iso_activity.push(Object.assign({}, activity, { id: ++store._activitySeq, at: activity.at || nowIso(), before, after: null }));
    await _writeRaw(store);
    return { removed: true };
  });
}

// A handful of ISO tables have neither a single-id-shaped row_version (iso_standard_versions,
// iso_import_runs) — direct, unconditional, unlogged single-row patches for the server's own
// bookkeeping writes (library-version approval, marking a failed import run), never exposed to a
// user-facing versioned field. Same "extend the fixed interface rather than force-fit" reasoning
// as updateMember/removeMember (A21); added for Phase 4's import ops (plan §14 A26).
function patchRow(table, id, patch) {
  return withLock(async () => {
    const store = await _readRaw();
    const rows = store[table] || [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) { const e = new Error('ISO record not found'); e.code = 'not_found'; throw e; }
    rows[idx] = { ...rows[idx], ...patch };
    await _writeRaw(store);
    return rows[idx];
  });
}

module.exports = {
  get, list, insertNumbered, insert, update, transition, log, counterNext, importApply,
  updateMember, removeMember, getConfig, upsertConfig, patchRow, verifyAction, reopenAction, reopenFinding, getProfile, upsertProfile, getPromptAnswers, savePromptAnswers,
  storageSignedUpload, storageSignedDownload, storageHead, storagePut, storageGet, storageRemove,
};
