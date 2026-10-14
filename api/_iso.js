// Pure ISO rules: the op registry, the permission matrix (plan §6.4), visibility stripping
// (§6.3), transition tables (§6.1-6.2) and payload validation. Leading underscore = shared
// module, not a Vercel route. api/iso.js is the thin HTTP wrapper around this; iso-logic-test
// exercises this file directly (in-process, no server) for every matrix cell and transition.
//
// Every op resolves the audit first, then checks the caller against THAT audit, then runs (plan
// §4.1). Ops never spread the payload into a patch — each op builds its patch from its own field
// list, and the server sets client_id/audit_id from the resolved parent, never from the request.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const isoImport = require('./_isoImport');
const { evaluateFilter } = require('./_isoFilter');
const { suggestRelationships } = require('./_isoRelate');
const { normalizeLinkUrl: normalizePortalLinkUrl } = require('./_portal');
const isoProfile = require('./_isoProfile');
const isoCalc = require('./_isoCalc');
const isoPrompt = require('./_isoPrompt');
const uid = (prefix) => prefix + crypto.randomBytes(8).toString('hex');
function loadTopicMap() {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'iso', 'seed', 'topic-map.json'), 'utf8'));
    delete json._comment;
    return json;
  } catch (e) { return {}; }
}
// Plan 4b.1 (R13, D24), replaced under D35/R1 (2026-10-04): the built-in standard library, one
// reviewed seed file per edition. Static require()s (not a directory scan) so a serverless bundle
// traces every file; a new edition is one more line here plus its file.
//
// D35: the v3 register (Etcher_Solutions_ISO_Audit_Registers_Editable_v3.xlsx) replaces the old
// 2015/2015+A1/2026-draft library entirely. The 8 old editions and their 3 guidance files are
// archived (not deleted) at iso/seed/archive/{library,guidance}/ — see D35 and the Progress Log.
// Every clause's stable_key changed (the hash is over the v3 wording), so nothing on an old board
// could carry forward even if one existed; the local store was empty when this ran (no boards).
const LIBRARY_SEEDS = [
  require('../iso/seed/library/9001-2026.json'),
  require('../iso/seed/library/14001-2026.json'),
  require('../iso/seed/library/45001-2018-a1.json'),
];
// 2026-10-14: each clause's cheat-sheet CONFIRM points are tick boxes under Assessment. Ticking
// writes "Confirmed that …" at the top of the basis (iso/iso-checks.js, shared with the browser);
// basisProblem() uses this to tell those ticks apart from what the auditor actually saw.
const IsoChecks = require('../iso/iso-checks.js');
const CONFIRM_BY_KEY = new Map();
for (const s of LIBRARY_SEEDS) for (const i of s.items || []) {
  const c = i.imported && i.imported.cheatSheet && i.imported.cheatSheet.confirm;
  if (c && c.length && i.source && i.source.matchKey) CONFIRM_BY_KEY.set(s.standardCode + '|' + i.source.matchKey, c);
}
const confirmItemsFor = r => CONFIRM_BY_KEY.get(r.standard_code + '|' + r.stable_key) || [];
// Plan 8b.3 (R11, D25): reviewed internal guidance, one file per edition, kept apart from the
// requirement text and from library rows (immutable once approved). Static require()s, same reason.
//
// D35/R1: empty for now. The old guidance files were keyed to the extinct 2015 stable_key hashes
// and are archived with the rest of the old library (iso/seed/archive/guidance/). v3's own Column O
// ("Audit Cheat Sheet" — Look for / Confirm / Watch for) is the redesign's replacement guidance
// source (P3 of the approved proposal), surfaced through the clause row's ⓘ — that wiring, plus the
// schema field to hold it, is R3 work (Clauses view), not yet built. Do not add seed files here
// until R3 actually reads them; approvedGuidance() already degrades to null with none present.
const GUIDANCE_SEEDS = [];
// R3 (D35, P6): Column P's cross-standard links ship with the library — no per-board "Suggest
// relationships" step. standard+clause → Set(standard+clause), symmetrised (R1 already made every
// pair two-way); keyed by a plain "STD CLAUSE" string since that is exactly what a board's own
// requirement rows carry (standard_code + clause), stable across whichever edition is loaded.
const LIBRARY_RELATIONSHIPS = require('../iso/seed/library/relationships-v3.json').relationships;
const LIBRARY_REL_BY_CLAUSE = (() => {
  const key = c => c.standard + ' ' + c.clause;
  const m = new Map();
  for (const { a, b } of LIBRARY_RELATIONSHIPS) {
    const ka = key(a), kb = key(b);
    if (!m.has(ka)) m.set(ka, new Set()); if (!m.has(kb)) m.set(kb, new Set());
    m.get(ka).add(kb); m.get(kb).add(ka);
  }
  return m;
})();
function approvedGuidance(entry) {
  if (!entry || entry.status !== 'approved') return null; // drafts never reach auditors
  return { explanation: entry.explanation || null, auditorLooksFor: entry.auditorLooksFor || null };
}
// R4 (D35, P5): Column P's 125 shared documents ship with the library, same pattern as the
// relationships above — a static catalog, no iso_document_types table (D35's original data-impact
// note named one; this follows R3's own precedent of computing library-shipped data live instead,
// since nothing here is ever written per-board). Keyed the same way as LIBRARY_REL_BY_CLAUSE.
const DOCUMENT_CATALOG = require('../iso/seed/library/documents-v3.json').documents;
const DOCUMENT_CATALOG_BY_CLAUSE = (() => {
  const m = new Map();
  for (const doc of DOCUMENT_CATALOG) for (const c of doc.clauses) {
    const k = c.standard + ' ' + c.clause;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(doc.name);
  }
  return m;
})();
const DOCUMENT_CATALOG_BY_NAME = new Map(DOCUMENT_CATALOG.map(d => [d.name, d]));
// ── Release-1 B3.1: the library frozen per board ────────────────────────────────────────────────
// Every board stores library_release — the release current when it was created. Cross-standard links,
// the document catalogue and cheat sheets resolve from that release, so a new release (v4) changes only
// boards created after it. Each release has a manifest (iso/seed/releases/<release>/manifest.json:
// editions, transition dates with source and last-verified date, technical reviewer, review date,
// change notes). v3's data files stay at iso/seed/library/ (old paths keep working); its manifest names
// them. Static require()s, so Vercel's file tracing ships every release.
const LIBRARY_RELEASES = {
  v3: { manifest: require('../iso/seed/releases/v3/manifest.json'), relationships: LIBRARY_RELATIONSHIPS, documents: DOCUMENT_CATALOG, librarySeeds: LIBRARY_SEEDS },
};
let _currentLibraryRelease = 'v3', _extraReleaseLoaded = false;
// Offline dev / tests only (ISO_OFFLINE is set by serve.mjs --offline alone, never by a request):
// ISO_EXTRA_LIBRARY_RELEASE names a JSON file {release, current, manifest, relationships, documents} —
// how iso-history-test proves a new release reaches new boards only. Read lazily: serve.mjs sets
// ISO_OFFLINE after its imports have loaded this module.
function _loadExtraRelease() {
  if (_extraReleaseLoaded) return;
  _extraReleaseLoaded = true;
  if (process.env.ISO_OFFLINE !== '1' || !process.env.ISO_EXTRA_LIBRARY_RELEASE) return;
  const x = JSON.parse(require('fs').readFileSync(process.env.ISO_EXTRA_LIBRARY_RELEASE, 'utf8'));
  if (!/^v\d{1,3}$/.test(String(x.release || '')) || LIBRARY_RELEASES[x.release]) return;
  LIBRARY_RELEASES[x.release] = { manifest: x.manifest || { release: x.release }, relationships: x.relationships || [], documents: x.documents || [], librarySeeds: LIBRARY_SEEDS };
  if (x.current) _currentLibraryRelease = x.release;
}
function currentLibraryRelease() { _loadExtraRelease(); return _currentLibraryRelease; }
const _releaseIndex = new Map();
// The release a board reads (a board from before B3.1 has none — it is v3, the only release then).
function libraryRelease(audit) {
  _loadExtraRelease();
  const name = audit && audit.library_release && LIBRARY_RELEASES[audit.library_release] ? audit.library_release : 'v3';
  if (!_releaseIndex.has(name)) {
    const r = LIBRARY_RELEASES[name];
    const key = c => c.standard + ' ' + c.clause;
    const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
    const relByClause = new Map(), docByClause = new Map();
    for (const { a, b } of r.relationships) { add(relByClause, key(a), key(b)); add(relByClause, key(b), key(a)); }
    for (const doc of r.documents) for (const c of doc.clauses) add(docByClause, key(c), doc.name);
    _releaseIndex.set(name, { name, manifest: r.manifest, documents: r.documents, librarySeeds: r.librarySeeds, relByClause, docByClause });
  }
  return _releaseIndex.get(name);
}
// A seed's change entry with its source keys resolved to {title, url, checkedOn, how}.
function resolveChange(seed, c) {
  return { clause: c.clause, kind: c.kind, summary: c.summary, sources: (c.sources || []).map(k => (seed.sources || []).find(s => s.key === k)).filter(Boolean).map(s => ({ title: s.title, url: s.url, checkedOn: s.checkedOn, how: s.how })) };
}
// Pure: per requirement — the workbook's evidence examples (from its pinned library row: a board
// copied from the library has no `imported` snapshot of its own) plus any APPROVED clause- and
// requirement-level guidance for its edition. A row whose workbook evidence cell was merged with the
// row above (SheetJS only fills a merge's top cell) shows the merged-from row's examples.
function buildGuidance({ requirements, libReqById, versionById, guidanceSeeds, librarySeeds, docByClause }) {
  const out = {};
  for (const r of requirements) {
    const lib = r.library_requirement_id ? libReqById[r.library_requirement_id] : null;
    const version = lib ? versionById[lib.version_id] : null;
    let examples = (lib && lib.evidence_guidance) || (r.imported && r.imported.evidenceExamples) || '';
    if (!examples && version && version.edition) {
      const seed = librarySeeds.find(s => s.standardCode === version.standard_code && s.edition === version.edition);
      const item = seed && seed.items.find(i => i.source.matchKey === r.stable_key);
      const top = item && item.imported.evidenceMergedFromRow != null ? seed.items.find(i => i.source.row === item.imported.evidenceMergedFromRow) : null;
      if (top) examples = top.imported.evidenceExamples || '';
    }
    const g = version ? guidanceSeeds.find(s => s.standardCode === version.standard_code && s.edition === version.edition) : null;
    // 4b.2: what this edition changed for the requirement's clause (or a parent clause, e.g. a note on
    // all of clause 8), with its sources; and whether the row itself is new in the edition.
    const libSeed = version && version.edition ? librarySeeds.find(s => s.standardCode === version.standard_code && s.edition === version.edition) : null;
    const changes = libSeed && libSeed.changes ? libSeed.changes.filter(c => r.clause === c.clause || String(r.clause).startsWith(c.clause + '.')).map(c => resolveChange(libSeed, c)) : [];
    const seedItem = libSeed && r.stable_key ? libSeed.items.find(i => i.source.matchKey === r.stable_key) : null;
    // R3: Column O's own cheat sheet (Look for / Confirm / Watch for), same fallback chain as
    // evidenceExamples above — the live library seed is the one source, nothing to review/approve.
    const cheatSheet = (seedItem && seedItem.imported.cheatSheet) || null;
    // R4 (D35, P5): Column P's suggested documents for this clause — same static catalog
    // relationship.library already uses for Column P's related clauses.
    const documents = [...((docByClause || DOCUMENT_CATALOG_BY_CLAUSE).get(r.standard_code + ' ' + r.clause) || [])];
    out[r.id] = {
      evidenceExamples: examples || null,
      cheatSheet: cheatSheet && (cheatSheet.lookFor.length || cheatSheet.confirm.length || cheatSheet.watchFor.length) ? cheatSheet : null,
      clause: g ? approvedGuidance(g.clauses[r.clause]) : null,
      requirement: g && r.stable_key ? approvedGuidance(g.requirements[r.stable_key]) : null,
      changes, newInEdition: !!(libSeed && libSeed.basedOn && seedItem && /^Etcher draft/.test(seedItem.source.sheet || '')),
      standardCode: version ? version.standard_code : null, edition: version ? version.edition : null,
      documents,
    };
  }
  return out;
}
// Newest edition first ('2026' sorts after '2015+A1:2024', which sorts after '2015'; a legacy null
// edition sorts last), then the most
// recently approved — deterministic. The old pick took the first approved row, which became arbitrary
// as soon as a standard had two approved versions (a library re-import + approve could already do it).
function pickApprovedVersion(versions, edition) {
  const approved = versions.filter(v => v.status === 'approved');
  if (edition) return approved.find(v => v.edition === edition) || null;
  return approved.sort((a, b) => String(b.edition || '').localeCompare(String(a.edition || ''))
    || String(b.approved_at || '').localeCompare(String(a.approved_at || '')))[0] || null;
}
function countByStandard(items) {
  const out = {};
  for (const it of items) out[it.standard] = (out[it.standard] || 0) + 1;
  return out;
}

// ── ID / text validation (plan §4.1, §29 of the brief) ──────────────────────────────────────────
const ID_RE = /^[A-Za-z0-9_:-]{1,64}$/;
function isValidId(v) { return typeof v === 'string' && ID_RE.test(v); }
function isNonEmptyText(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.length <= (max || 10000); }

class IsoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const badRequest = (msg) => new IsoError(400, msg);
const forbidden = (msg) => new IsoError(403, msg || 'Not permitted');
const notFound = (msg) => new IsoError(404, msg || 'Not found');
const conflict = (msg) => new IsoError(409, msg || 'Someone changed this — showing the latest version');

// ── §6.4 permission matrix ───────────────────────────────────────────────────────────────────────
// Default member flags [can_upload_evidence, can_respond, can_verify, can_manage_client_actions].
const DEFAULT_MEMBER_FLAGS = {
  // D35/R2: 'lead_auditor' is the new primary role (Lead Auditor / Auditor / Viewer, P10) — final
  // review and approval authority over every clause status on the board (requirement.approve/
  // return/bulkApprove, below). 'audit_manager'/'contributor' are kept, unused by new UI, so an
  // existing membership row never breaks (D35's "retiring" pattern, same as R1's old library seeds).
  lead_auditor: { can_upload_evidence: true, can_respond: false, can_verify: true, can_manage_client_actions: false },
  audit_manager: { can_upload_evidence: true, can_respond: false, can_verify: true, can_manage_client_actions: false },
  auditor: { can_upload_evidence: true, can_respond: false, can_verify: true, can_manage_client_actions: false },
  contributor: { can_upload_evidence: true, can_respond: false, can_verify: false, can_manage_client_actions: false },
  reviewer: { can_upload_evidence: false, can_respond: false, can_verify: false, can_manage_client_actions: false },
  client_admin: { can_upload_evidence: true, can_respond: true, can_verify: false, can_manage_client_actions: true },
  client_contributor: { can_upload_evidence: true, can_respond: true, can_verify: false, can_manage_client_actions: false },
};
function defaultFlagsFor(role) { return DEFAULT_MEMBER_FLAGS[role] || DEFAULT_MEMBER_FLAGS.reviewer; }

// Who may open an ISO board at all (plan §6.4 "Who may open an ISO board", mirrors canViewBoard).
// Returns the caller's membership row (or a synthetic one for admin/owner/all_internal) or null.
function resolveMembership(caller, audit, members) {
  if (caller.kind === 'client') {
    if (caller.clientId !== audit.client_id) return null;
    if (!audit.client_portal_enabled) return null;
    const m = members.find(x => x.user_uid === caller.uid);
    return m || null; // clients are never implicit members — must be named
  }
  if (caller.role === 'admin') return { audit_id: audit.id, user_uid: caller.uid, member_kind: 'staff', audit_role: 'audit_manager', ...defaultFlagsFor('audit_manager'), synthetic: true };
  if (audit.owner_uid === caller.uid) return { audit_id: audit.id, user_uid: caller.uid, member_kind: 'staff', audit_role: 'audit_manager', ...defaultFlagsFor('audit_manager'), synthetic: true };
  const m = members.find(x => x.user_uid === caller.uid);
  if (m) return m;
  if (audit.visibility === 'all_internal') {
    const role = caller.restricted ? 'reviewer' : 'contributor';
    return { audit_id: audit.id, user_uid: caller.uid, member_kind: 'staff', audit_role: role, ...defaultFlagsFor(role), synthetic: true };
  }
  return null; // private board, not a named member -> 403
}
function canOpenAudit(caller, audit, members) { return !!resolveMembership(caller, audit, members); }

// Allowed audit_role by global role (plan §6.4 "Allowed audit_role by global role").
function allowedAuditRoles(caller) {
  if (caller.kind === 'client') return ['client_admin', 'client_contributor'];
  if (caller.restricted) return ['reviewer'];
  // D35/R2: 'lead_auditor' first — the access modal now offers Lead Auditor / Auditor / Viewer
  // (P10). 'audit_manager'/'contributor' stay allowed so an existing row is never force-migrated.
  return ['lead_auditor', 'audit_manager', 'auditor', 'contributor', 'reviewer'];
}

// ── §6.1 requirement assessment ─────────────────────────────────────────────────────────────────
const ASSESSMENT_STATES = ['not_started', 'in_progress', 'awaiting_evidence', 'needs_follow_up', 'complete'];
const ASSESSMENT_RESULTS = ['not_implemented', 'no_evidence_provided', 'partially_implemented', 'implemented_ineffective', 'implemented_effective', 'not_applicable'];

// ── §6.2 action status transitions ──────────────────────────────────────────────────────────────
const ACTION_TRANSITIONS = {
  draft: ['assigned', 'on_hold'],
  assigned: ['in_progress', 'on_hold'],
  in_progress: ['awaiting_evidence', 'submitted_for_review', 'on_hold'],
  awaiting_evidence: ['submitted_for_review', 'on_hold'],
  submitted_for_review: ['more_info_required', 'ready_for_verification', 'on_hold'],
  more_info_required: ['submitted_for_review', 'on_hold'],
  ready_for_verification: ['verified', 'on_hold'],
  verified: ['closed'],
  closed: [],
  // A40, resolved: on_hold has no fixed destination of its own — it returns to whatever status it
  // was paused from, tracked server-side in on_hold_from_status (set when entering on_hold,
  // cleared on resume; see 009_iso_core.sql's iso_transition_action and this file's
  // action.updateStatus). This array stays [] on purpose: the real check needs the row's
  // on_hold_from_status, which a pure (from,to) string function has no access to — see the
  // dedicated check in action.updateStatus.run() below, same division of labour as the
  // majorNcRootCauseGate double-check pattern (coarse here, exact where the row is loaded).
  on_hold: [],
};
// Statuses that could plausibly have been paused into on_hold (mirrors 009's own
// on_hold_from_status check constraint) — used only as the coarse shape check here; the exact
// destination (on_hold_from_status itself) is enforced in action.updateStatus.run().
const ACTION_ON_HOLD_RESUMABLE = ['draft', 'assigned', 'in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required', 'ready_for_verification'];
function isAllowedActionTransition(from, to) {
  if (to === 'on_hold') return from !== 'on_hold' && from !== 'closed';
  if (from === 'on_hold') return ACTION_ON_HOLD_RESUMABLE.includes(to);
  return (ACTION_TRANSITIONS[from] || []).includes(to);
}

// ── §6.3 visibility / CLIENT_FIELDS ─────────────────────────────────────────────────────────────
// A client caller receives only these fields per entity — an explicit allowlist, never a
// blocklist (the _portal.js "whitelists only" pattern). Anything not listed here is never sent to
// a client, for any entity, ever.
const CLIENT_FIELDS = {
  audit: ['id', 'ref', 'title', 'audit_type', 'custom_type_label', 'stage', 'scope_text', 'planned_start', 'planned_end', 'report_due', 'certification_body', 'client_id', 'row_version', 'standards', 'editions', 'visibility'],
  member: ['user_uid', 'member_kind', 'audit_role', 'name'],
  unit: ['id', 'kind', 'name'],
  comment: ['id', 'body', 'author_uid', 'author_name', 'created_at', 'entity_type', 'entity_id'],
  activity: ['id', 'entity_type', 'entity_id', 'entity_ref', 'action', 'at', 'actor_kind'],
  requirement: ['id', 'audit_id', 'standard_code', 'clause', 'clause_name', 'requirement_text', 'applicability',
    'na_justification', 'assessment_result', 'compliance_status', 'client_visible_comment', 'visibility', 'row_version'],
  finding: ['id', 'audit_id', 'ref', 'classification', 'title', 'statement', 'criteria', 'evidence_basis',
    'status', 'visibility', 'released_at', 'row_version'],
  // start_date added for Phase 7b.6 (D14) — the client Gantt PDF needs a real start date to draw
  // a bar rather than a milestone; no client-facing surface needed it before this (action.list's
  // own client callers never drew a timeline). Nothing new is exposed by this beyond "when does
  // this action span" — the same date a client could already ask about via client_response.
  action: ['id', 'audit_id', 'ref', 'title', 'description', 'status', 'priority', 'start_date', 'due_date',
    'client_response', 'verification_requirements', 'visibility', 'row_version'],
};
// Fields never sent to a client caller for ANY entity, even one whose CLIENT_FIELDS is generous —
// a second layer so a future typo in one allowlist can't leak these (plan §6.3).
const NEVER_TO_CLIENT = new Set([
  'interview_notes', 'auditor_observations', 'internal_notes', 'verification_notes', 'auditor_review_note',
  'visible_to_uids', 'reason', 'owner_uid', 'lead_auditor_uid', 'internal_notes',
  'senior_review_status', 'senior_review_note', 'senior_reviewed_by', 'senior_reviewed_at',
]);
function projectForClient(entity, row) {
  if (!row) return row;
  const allow = CLIENT_FIELDS[entity];
  if (!allow) return null; // no allowlist declared -> never send this entity to a client
  const out = {};
  for (const f of allow) { if (f in row && !NEVER_TO_CLIENT.has(f)) out[f] = row[f]; }
  return out;
}
function isClientVisibleRecord(row) {
  // internal / report_only / after_approval(unreleased) are never client-visible from a live op.
  return row.visibility === 'client_all' || row.visibility === 'client_selected';
}

// ── §6.3a reason-required changes ───────────────────────────────────────────────────────────────
function requireReason(reason, what) {
  if (!reason || !String(reason).trim()) throw badRequest(`A reason is required to ${what}.`);
}

// ── The op registry ──────────────────────────────────────────────────────────────────────────────
// Every op declares: audited (false only for the audit-less ops listed in plan §4.1a),
// scope: 'audit'|'client'|'none' (what resolveScope needs), clientProjection (entity name for
// projectForClient, or null if this op is staff-only), allow(ctx) -> boolean, run(ctx) -> data.
// ctx = {caller, db, payload, audit, membership, now}
const registry = {};
function defineOp(name, def) {
  if (!def.scope) throw new Error(`op ${name} has no scope resolver`); // iso-security-test enumerates this
  if (def.scope !== 'none' && def.clientProjection === undefined) throw new Error(`op ${name} has no client projection declared`);
  registry[name] = def;
}

// standard.list — audit-less, open to any authenticated caller.
defineOp('standard.list', {
  scope: 'none', clientProjection: null,
  allow: () => true,
  async run(ctx) { return ctx.db.list('iso_standards', { where: [{ field: 'active', op: 'eq', value: true }] }); },
});

// audit.list — only boards the caller may open (plan D11).
defineOp('audit.list', {
  scope: 'none', clientProjection: 'audit',
  allow: () => true,
  async run(ctx) {
    let audits = await ctx.db.list('iso_audits', { where: [{ field: 'archived_at', op: 'isnull' }], limit: 500 });
    // D31: a closed board whose maintenance audit has already been started is not "due" any more.
    const followed = new Set(audits.filter(a => a.previous_audit_id).map(a => a.previous_audit_id));
    if (ctx.caller.kind === 'client') audits = audits.filter(a => a.client_id === ctx.caller.clientId && a.client_portal_enabled);
    const out = [];
    for (const a of audits) {
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      if (!canOpenAudit(ctx.caller, a, members)) continue;
      // Standard codes for the sidebar's Q/E/S badges (plan 5.2b) — audit_standards only stores
      // version_id, so resolve each to its standard_code.
      const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      const standards = [], editions = {};
      for (const as of auditStandards) {
        const v = await ctx.db.get('iso_standard_versions', as.version_id);
        if (v) { standards.push(v.standard_code); editions[v.standard_code] = v.edition || null; }
      }
      out.push({ ...a, standards, editions, has_successor: followed.has(a.id) });
    }
    return out;
  },
});

// timeTarget.list — plan Phase 7b.2 (D12): one row per ISO board the caller may log time
// against, with that board's own Etcher-owned, still-open actions (clients never log Task Hub
// timesheets at all, so this refuses a client caller outright rather than returning an empty
// list — "ops without a real client use case simply refuse client callers in their own allow()",
// the same precedent action.create/action.update already follow).
defineOp('timeTarget.list', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client'; },
  async run(ctx) {
    const audits = await ctx.db.list('iso_audits', { where: [{ field: 'archived_at', op: 'isnull' }], limit: 500 });
    const out = [];
    for (const a of audits) {
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      if (!canOpenAudit(ctx.caller, a, members)) continue;
      const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      const standards = [];
      for (const as of auditStandards) {
        const v = await ctx.db.get('iso_standard_versions', as.version_id);
        if (v) standards.push(v.standard_code);
      }
      const actions = await ctx.db.list('iso_actions', {
        where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }, { field: 'owner_kind', op: 'eq', value: 'etcher' }],
        limit: 2000,
      });
      const openActions = actions.filter(x => !ACTION_CLOSED_STATUSES.includes(x.status)).map(x => ({ id: x.id, ref: x.ref, title: x.title }));
      out.push({ auditId: a.id, ref: a.ref, title: a.title, clientId: a.client_id, standards, actions: openActions });
    }
    return out;
  },
});

defineOp('audit.get', {
  scope: 'audit', clientProjection: 'audit',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    // standards + editions (plan 4b.1) — the board header and register show "ISO 9001:2015", the
    // same pair audit.list already returns for the sidebar.
    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const standards = [], editions = {};
    for (const as of auditStandards) {
      const v = await ctx.db.get('iso_standard_versions', as.version_id);
      if (v) { standards.push(v.standard_code); editions[v.standard_code] = v.edition || null; }
    }
    // D31: the board it follows, and the maintenance board that follows it (if started).
    const prev = ctx.audit.previous_audit_id ? await ctx.db.get('iso_audits', ctx.audit.previous_audit_id) : null;
    const next = (await ctx.db.list('iso_audits', { where: [{ field: 'previous_audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] }))[0] || null;
    return { ...ctx.audit, standards, editions, previous: prev ? { id: prev.id, ref: prev.ref } : null, successor: next ? { id: next.id, ref: next.ref } : null };
  },
});

defineOp('audit.create', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && ['admin', 'pm', 'staff'].includes(ctx.caller.role); },
  async validate(payload) {
    if (!isValidId(payload.clientId)) throw badRequest('A client is required.');
    if (!Array.isArray(payload.standards) || !payload.standards.length) throw badRequest('Pick at least one standard.');
    for (const s of payload.standards) if (!isValidId(s)) throw badRequest('Invalid standard code.');
    if (payload.visibility && !['all_internal', 'private'].includes(payload.visibility)) throw badRequest('Invalid visibility.');
    // editions (optional, plan 4b.1): {"9001": "2015"} pins an older edition; omitted = the newest
    // approved edition of each standard.
    if (payload.editions != null) {
      if (typeof payload.editions !== 'object' || Array.isArray(payload.editions)) throw badRequest('Invalid editions.');
      // An edition is a year, optionally with a consolidated amendment (4b.2): '2015' or '2015+A1:2024'.
      for (const [code, ed] of Object.entries(payload.editions)) if (!isValidId(code) || !/^\d{4}(\+A\d{1,2}:\d{4})?$/.test(String(ed))) throw badRequest('Invalid edition.');
    }
  },
  async run(ctx) {
    const { payload, caller } = ctx;
    await ctx.checkClientExists(payload.clientId); // plan 3.4
    const versions = [];
    for (const code of payload.standards) {
      const edition = payload.editions && payload.editions[code];
      const v = pickApprovedVersion(await ctx.db.list('iso_standard_versions', { where: [{ field: 'standard_code', op: 'eq', value: code }, { field: 'status', op: 'eq', value: 'approved' }] }), edition);
      if (!v) throw badRequest(edition ? `No approved ISO ${code}:${edition} library.` : `No approved library version for ISO ${code} yet.`);
      versions.push(v);
    }
    const audit = await ctx.db.insertNumbered('iso_audits', 'audit', 'AUD-' + (await ctx.isoYear()), {
      id: uid('iaud_'), client_id: payload.clientId, title: payload.title || `ISO ${payload.standards.join('/')}`,
      audit_type: 'gap_analysis', stage: 'planning', visibility: payload.visibility || 'all_internal',
      owner_uid: caller.uid, client_portal_enabled: false, default_visibility: 'internal',
      library_release: currentLibraryRelease(), // B3.1
      created_by: caller.uid, updated_by: caller.uid,
    }, { audit_id: null, client_id: payload.clientId, entity_type: 'audit', action: 'created', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
    for (const v of versions) await ctx.db.insert('iso_audit_standards', { audit_id: audit.id, version_id: v.id });
    await ctx.db.insert('iso_audit_members', {
      audit_id: audit.id, user_uid: caller.uid, member_kind: 'staff', audit_role: 'audit_manager',
      ...defaultFlagsFor('audit_manager'), added_by: caller.uid, added_at: ctx.now.toISOString(),
    });
    for (const m of (payload.members || [])) {
      if (m.uid === caller.uid) continue; // creator is already the audit_manager above
      if (!allowedAuditRoles({ kind: 'staff', restricted: false }).includes(m.auditRole)) throw badRequest('Invalid audit role for a member.');
      await ctx.db.insert('iso_audit_members', {
        audit_id: audit.id, user_uid: m.uid, member_kind: 'staff', audit_role: m.auditRole,
        ...defaultFlagsFor(m.auditRole), added_by: caller.uid, added_at: ctx.now.toISOString(),
      });
    }
    // Copy every pinned library requirement in, all not_started (plan 5.4) — atomic, and tolerant
    // of a runId with no matching iso_import_runs row (both adapters' importApply just skip the
    // "mark run applied" step in that case; see api/_isoImport.js's copyLibraryRequirements).
    const libReqsByVersion = {};
    for (const v of versions) libReqsByVersion[v.id] = await ctx.db.list('iso_library_requirements', { where: [{ field: 'version_id', op: 'eq', value: v.id }] });
    const copyOps = isoImport.copyLibraryRequirements({ auditId: audit.id, clientId: payload.clientId, versions, libReqsByVersion, actorUid: caller.uid, now: ctx.now });
    if (copyOps.length) await ctx.db.importApply(isoImport.uid('iboot_'), copyOps);
    return audit;
  },
});

defineOp('audit.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const allowed = ['title', 'audit_type', 'custom_type_label', 'scope_text', 'exclusions_text', 'planned_start',
      'planned_end', 'report_due', 'certification_body', 'lead_auditor_uid', 'internal_notes', 'stage',
      'client_portal_enabled', 'default_visibility', 'maintenance_due', 'setup'];
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!allowed.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
      patch[k] = ctx.payload.patch[k];
    }
    if ('stage' in patch && !AUDIT_STAGES.includes(patch.stage)) throw badRequest('Invalid stage.');
    if ('audit_type' in patch && !AUDIT_TYPE_VALUES.includes(patch.audit_type)) throw badRequest('Invalid audit type.');
    if ('setup' in patch) patch.setup = cleanAuditSetup(patch.setup); // B4.1
    if ('maintenance_due' in patch && patch.maintenance_due != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.maintenance_due))) throw badRequest('The maintenance audit date must be a date.');
    // D31: closing a board records when, and gives it a maintenance audit date — the one asked for,
    // or 12 months after today (the board's timezone) — editable later. Reopening clears completed_at.
    if (patch.stage === 'closed' && ctx.audit.stage !== 'closed') {
      // D46: a board closes only when every assessed clause has its basis, gap reason and confirmation.
      const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
      const open = reqs.map(r => ({ r, why: basisProblem(r) })).filter(x => x.why);
      if (open.length) {
        const list = open.slice(0, 12).map(x => `${x.r.standard_code} ${x.r.clause} (${BASIS_SHORT(x.why)})`).join(', ');
        throw badRequest(`Can't close yet — ${open.length} clause${open.length === 1 ? ' needs' : 's need'} a basis, gap reason or confirmation: ${list}${open.length > 12 ? ', …' : ''}.`);
      }
      patch.completed_at = ctx.now.toISOString();
      if (!patch.maintenance_due && !ctx.audit.maintenance_due) patch.maintenance_due = await boardDatePlusMonths(ctx, 12);
    } else if ('stage' in patch && patch.stage !== 'closed' && ctx.audit.stage === 'closed') {
      patch.completed_at = null;
    }
    if ('client_portal_enabled' in patch) requireReason(ctx.payload.reason, 'change client portal sharing');
    const closing = patch.stage === 'closed' && ctx.audit.stage !== 'closed';
    let updated;
    try {
      updated = await ctx.db.update('iso_audits', ctx.audit.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'audit', entity_id: ctx.audit.id,
        entity_ref: ctx.audit.ref, action: 'updated', reason: ctx.payload.reason || null, source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
    if (closing) await writeCloseSnapshot(ctx, updated); // B3.2
    return updated;
  },
});

const AUDIT_STAGES = ['planning', 'fieldwork', 'reporting', 'capa', 'closed'];
// Release-1 B4: 'follow_up' joins the audit types (009's check constraint amended to match).
const AUDIT_TYPE_VALUES = ['internal', 'gap_analysis', 'certification_prep', 'surveillance', 'recertification', 'supplier', 'custom', 'follow_up'];
// B4.1: the audit setup card — objective, scope statement, criteria (free text beside the board's own
// standards), sites (the board's units), limitations, opening and closing meetings. Saved on the board
// (iso_audits.setup) and read by B5's reports. Unknown keys are dropped; text is bounded.
function cleanAuditSetup(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('Invalid audit setup.');
  const text = (v, max = 4000) => { if (v == null || v === '') return null; if (typeof v !== 'string' || v.length > max) throw badRequest('An audit setup field is too long.'); return v.trim() || null; };
  const date = v => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest('A meeting date must be a date.'); return String(v); };
  const meeting = m => (m && typeof m === 'object' ? { date: date(m.date), attendees: text(m.attendees, 1000), notes: text(m.notes) } : null);
  const sites = Array.isArray(raw.sites) ? raw.sites.filter(isValidId).slice(0, 200) : [];
  return { objective: text(raw.objective), scope: text(raw.scope), criteria: text(raw.criteria), sites, limitations: text(raw.limitations), opening: meeting(raw.opening), closing: meeting(raw.closing) };
}

// ── Release-1 B3.2 / B3.3: the close snapshot ───────────────────────────────────────────────────
// Closing a board writes one immutable iso_audit_snapshots row (kind 'close'): per clause its
// conclusion (status, OFI, gap reason, basis, plan), baseline and whether it changed since, and its
// approval; per linked document what was seen — title, revision, date, URL, who linked it and when,
// its review state, and a SHA-256 for an uploaded file (a link can't be checksummed, only a file).
// Plus the board's library release, the calculation version and the metrics. Both adapters refuse
// any update to the table (migration 015's trigger does the same online). Reopening and closing
// again writes a second snapshot; nothing overwrites the first. B5's reports read these.
const SNAPSHOT_KINDS = ['close', 'report'];
async function fileSha256(ctx, storagePath) {
  if (!storagePath || typeof ctx.db.storageGet !== 'function') return null;
  try {
    const bytes = await ctx.db.storageGet(storagePath);
    return bytes ? require('crypto').createHash('sha256').update(bytes).digest('hex') : null;
  } catch (e) { return null; }
}
async function writeCloseSnapshot(ctx, audit) { return writeAuditSnapshot(ctx, audit, 'close'); }
// B5.2: the same snapshot, kind 'report', is what an issued report is drawn from.
async function writeAuditSnapshot(ctx, audit, kind) {
  const reqs = (await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }))
    .sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0));
  const links = (await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }] }))
    .filter(l => !DEAD_LINK_STATUSES.includes(l.review_status));
  const evidence = new Map(), sha = new Map();
  for (const l of links) {
    if (evidence.has(l.evidence_id)) continue;
    const e = await ctx.db.get('iso_evidence', l.evidence_id);
    evidence.set(l.evidence_id, e || null);
    if (e && e.storage_path) sha.set(e.id, await fileSha256(ctx, e.storage_path));
  }
  const linksByReq = new Map();
  for (const l of links) { if (!linksByReq.has(l.target_id)) linksByReq.set(l.target_id, []); linksByReq.get(l.target_id).push(l); }
  const docOf = l => {
    const e = evidence.get(l.evidence_id);
    if (!e || e.archived_at) return null;
    return { evidenceRef: e.ref || null, title: e.title, kind: e.kind || null, revision: e.version_label || null, date: e.evidence_date || null, url: e.url || null,
      filename: e.original_filename || null, sha256: e.storage_path ? (sha.get(e.id) || null) : null,
      linkedBy: l.created_by || null, linkedAt: l.created_at || null, review: l.review_status || null };
  };
  const clauses = reqs.map(r => ({
    requirementId: r.id, standard: r.standard_code, clause: r.clause, clauseName: r.clause_name || '',
    status: r.compliance_status || 'not_assessed', ofi: !!r.ofi, gapReason: r.gap_reason || null,
    basis: r.current_system || null, plannedAction: r.recommended_action || null,
    baseline: r.baseline_at ? { result: r.baseline_result || null, state: r.baseline_state || null, at: r.baseline_at } : null,
    changedSinceBaseline: r.baseline_at ? (r.assessment_result || null) !== (r.baseline_result || null) : null,
    approval: { state: r.approval_state || null, by: r.approved_by || null, at: r.approved_at || null },
    documents: (linksByReq.get(r.id) || []).map(docOf).filter(Boolean),
  }));
  const metrics = isoCalc.computeAuditMetrics(await fetchAuditCalcInputs(ctx));
  const release = libraryRelease(audit).name;
  const snap = await ctx.db.insert('iso_audit_snapshots', {
    id: uid('isnap_'), audit_id: audit.id, client_id: audit.client_id, kind,
    library_release: release, calc_version: isoCalc.CALC_VERSION,
    data: { auditRef: audit.ref, title: audit.title, auditType: audit.audit_type, closedAt: audit.completed_at || ctx.now.toISOString(), clauses, metrics },
    created_by: ctx.caller.uid, created_at: ctx.now.toISOString(),
  });
  await ctx.db.log({ audit_id: audit.id, client_id: audit.client_id, entity_type: 'audit', entity_id: audit.id, entity_ref: audit.ref,
    action: 'snapshot_written', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    after: { snapshotId: snap.id, kind, clauses: clauses.length, libraryRelease: release, calcVersion: isoCalc.CALC_VERSION } });
  return snap;
}
// Staff read the snapshots of a board (newest first). Nothing writes them except the close above.
defineOp('snapshot.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const rows = await ctx.db.list('iso_audit_snapshots', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  },
});
// The board's library release and its manifest (B3.1) — what the board reads its links, catalogue
// and cheat sheets from.
defineOp('library.release', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { const r = libraryRelease(ctx.audit); return { release: r.name, current: currentLibraryRelease(), manifest: r.manifest }; },
});
async function boardToday(ctx) {
  const tz = await ctx.db.getConfig('timezone');
  return new Intl.DateTimeFormat('en-CA', { timeZone: (tz && tz.value) || 'Australia/Perth' }).format(ctx.now);
}
async function boardDatePlusMonths(ctx, months) {
  const [y, m, d] = (await boardToday(ctx)).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); // 29 Feb → 28 Feb
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ── audit.startMaintenance — Phase 9b, D31 ─────────────────────────────────────────────────────
// Creates next year's maintenance board from a closed one. Copied: client; standards (newest approved
// edition, or the one asked for — requirements matched by stable key, then by clause and position);
// applicability and N/A reasons, owners, units and visibility; staff members. Last year's final
// results become the new board's baseline ("last audit vs now"); every assessment starts Not started.
// Open findings and actions carry over tagged with their previous ref (links remapped); accepted
// evidence is copied unlinked and offered as a suggestion for the clauses it was accepted for. Nothing
// is written to the previous board — the new board's previous_audit_id is the only link.
function maintenanceMatchKey(r, occurrence) { return `${r.standard_code}|${r.clause}|${occurrence}`; }
function occurrenceKeys(rows) {
  const seen = {}, out = new Map();
  for (const r of rows.slice().sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0))) {
    const k = r.standard_code + '|' + r.clause; seen[k] = (seen[k] || 0) + 1;
    out.set(r.id, maintenanceMatchKey(r, seen[k]));
  }
  return out;
}
// Release-1 B4.2 (Q9): audit.startFollowUp generalises this op — the same carry-forward, plus a type
// ('maintenance' keeps everything in scope; 'follow_up' scopes to the chosen findings, actions and
// clauses and sets every other clause Out of scope), a planned date and a Lead. startMaintenance stays
// as an alias. Each carried finding / action records where it came from (carried_meta).
const START_NEXT_OP = {
  scope: 'audit', clientProjection: null,
  // Release-1 B2.6: the Lead Auditor starts next year's board too (R2 left it manager-only).
  allow(ctx) { return ctx.caller.kind === 'staff' && (ctx.caller.role === 'admin' || ['audit_manager', 'lead_auditor'].includes(ctx.membership.audit_role)); },
  async validate(payload) {
    if (payload.title != null && !isNonEmptyText(payload.title, 200)) throw badRequest('Invalid title.');
    if (payload.type != null && !['maintenance', 'follow_up'].includes(payload.type)) throw badRequest('Invalid follow-up type.');
    if (payload.scope != null) {
      if (typeof payload.scope !== 'object' || Array.isArray(payload.scope)) throw badRequest('Invalid scope.');
      for (const k of ['requirementIds', 'findingIds', 'actionIds']) if (payload.scope[k] != null && (!Array.isArray(payload.scope[k]) || payload.scope[k].length > 5000 || !payload.scope[k].every(isValidId))) throw badRequest('Invalid scope.');
    }
    if (payload.type === 'follow_up' && !(payload.scope && ['requirementIds', 'findingIds', 'actionIds'].some(k => (payload.scope[k] || []).length))) throw badRequest('Pick at least one finding, action or clause for the follow-up.');
    if (payload.plannedStart != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.plannedStart))) throw badRequest('The planned date must be a date.');
    if (payload.leadUid != null && !isValidId(payload.leadUid)) throw badRequest('Invalid Lead Auditor.');
    if (payload.editions != null) {
      if (typeof payload.editions !== 'object' || Array.isArray(payload.editions)) throw badRequest('Invalid editions.');
      for (const [code, ed] of Object.entries(payload.editions)) if (!isValidId(code) || !/^\d{4}(\+A\d{1,2}:\d{4})?$/.test(String(ed))) throw badRequest('Invalid edition.');
    }
  },
  async run(ctx) {
    const prev = ctx.audit;
    if (prev.stage !== 'closed') throw badRequest('Close this board first — a maintenance or follow-up audit follows a completed one.');
    const followUp = ctx.payload.type === 'follow_up';
    const scopeIn = ctx.payload.scope || {};
    const already = (await ctx.db.list('iso_audits', { where: [{ field: 'previous_audit_id', op: 'eq', value: prev.id }, { field: 'archived_at', op: 'isnull' }] }))[0];
    if (already) throw badRequest(`The maintenance audit for this board has already been started: ${already.ref}.`);
    const caller = ctx.caller, nowIso = ctx.now.toISOString();
    // Standards: the same ones, each at the newest approved edition unless one is asked for.
    const prevStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }] });
    const versions = [];
    for (const as of prevStandards) {
      const pv = await ctx.db.get('iso_standard_versions', as.version_id);
      if (!pv) continue;
      const edition = ctx.payload.editions && ctx.payload.editions[pv.standard_code];
      const v = pickApprovedVersion(await ctx.db.list('iso_standard_versions', { where: [{ field: 'standard_code', op: 'eq', value: pv.standard_code }, { field: 'status', op: 'eq', value: 'approved' }] }), edition);
      if (!v) throw badRequest(edition ? `No approved ISO ${pv.standard_code}:${edition} library.` : `No approved library version for ISO ${pv.standard_code}.`);
      versions.push(v);
    }
    const audit = await ctx.db.insertNumbered('iso_audits', 'audit', 'AUD-' + (await ctx.isoYear()), {
      id: uid('iaud_'), client_id: prev.client_id, title: ctx.payload.title || `${followUp ? 'Follow-up' : 'Maintenance'} audit of ${prev.ref}`,
      audit_type: followUp ? 'follow_up' : 'internal', stage: 'planning', visibility: prev.visibility || 'all_internal',
      planned_start: ctx.payload.plannedStart || null,
      follow_up_scope: followUp ? { requirementIds: scopeIn.requirementIds || [], findingIds: scopeIn.findingIds || [], actionIds: scopeIn.actionIds || [] } : null,
      owner_uid: caller.uid, client_portal_enabled: false, default_visibility: prev.default_visibility || 'internal',
      scope_text: prev.scope_text || null, exclusions_text: prev.exclusions_text || null, previous_audit_id: prev.id,
      library_release: currentLibraryRelease(), // B3.1: a new board takes the current release
      created_by: caller.uid, updated_by: caller.uid,
    }, { audit_id: null, client_id: prev.client_id, entity_type: 'audit', action: 'created', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
    for (const v of versions) await ctx.db.insert('iso_audit_standards', { audit_id: audit.id, version_id: v.id });
    // Staff members, with their roles and flags; the caller manages the new board.
    const prevMembers = ctx.members.filter(m => m.member_kind === 'staff');
    await ctx.db.insert('iso_audit_members', { audit_id: audit.id, user_uid: caller.uid, member_kind: 'staff', audit_role: 'audit_manager', ...defaultFlagsFor('audit_manager'), added_by: caller.uid, added_at: nowIso });
    for (const m of prevMembers) {
      if (m.user_uid === caller.uid) continue;
      await ctx.db.insert('iso_audit_members', { audit_id: audit.id, user_uid: m.user_uid, member_kind: 'staff', audit_role: m.audit_role,
        can_upload_evidence: !!m.can_upload_evidence, can_respond: !!m.can_respond, can_verify: !!m.can_verify, can_manage_client_actions: !!m.can_manage_client_actions,
        added_by: caller.uid, added_at: nowIso });
    }
    // Units, remapped.
    const unitMap = new Map();
    for (const u of await ctx.db.list('iso_audit_units', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }, { field: 'archived_at', op: 'isnull' }] })) {
      const nu = await ctx.db.insert('iso_audit_units', { id: uid('iunit_'), audit_id: audit.id, kind: u.kind, name: u.name });
      unitMap.set(u.id, nu.id);
    }
    // Requirements: the library copy, then each matched to last year's row — stable key first, then
    // standard + clause + position within the clause (an edition move that reworded a requirement).
    const prevReqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    const libReqsByVersion = {};
    for (const v of versions) libReqsByVersion[v.id] = await ctx.db.list('iso_library_requirements', { where: [{ field: 'version_id', op: 'eq', value: v.id }] });
    const ops = isoImport.copyLibraryRequirements({ auditId: audit.id, clientId: prev.client_id, versions, libReqsByVersion, actorUid: caller.uid, now: ctx.now });
    const prevLibrary = prevReqs.filter(r => r.origin === 'library' || r.library_requirement_id);
    const byStable = new Map(prevLibrary.filter(r => r.stable_key).map(r => [r.standard_code + '|' + r.stable_key, r]));
    const prevOcc = occurrenceKeys(prevLibrary);
    const byOcc = new Map(prevLibrary.map(r => [prevOcc.get(r.id), r]));
    const newOcc = occurrenceKeys(ops.map(o => o.patch));
    const used = new Set(), reqMap = new Map(); // previous requirement id → new requirement id
    const carry = (row, p) => {
      Object.assign(row, {
        applicability: p.applicability || 'applicable', na_justification: p.na_justification || null,
        // D35/R2: N/A is a scope decision, not an assessment — it (and its reason) carries forward
        // like applicability always did; everything else starts fresh at Not assessed (already set
        // by copyLibraryRequirements above, so there is nothing to do for the non-N/A case here).
        compliance_status: p.applicability === 'not_applicable' ? 'not_applicable' : 'not_assessed',
        responsible_uid: p.responsible_uid || null, unit_ids: (p.unit_ids || []).map(id => unitMap.get(id)).filter(Boolean),
        visibility: p.visibility || 'internal', visible_to_uids: p.visible_to_uids || [],
        baseline_result: p.assessment_result || null, baseline_state: p.assessment_state || 'not_started', baseline_at: p.assessed_at || nowIso,
      });
      used.add(p.id); reqMap.set(p.id, row.id);
    };
    for (const o of ops) { const p = byStable.get(o.patch.standard_code + '|' + o.patch.stable_key); if (p && !used.has(p.id)) carry(o.patch, p); }
    for (const o of ops) { if (o.patch.baseline_at) continue; const p = byOcc.get(newOcc.get(o.patch.id)); if (p && !used.has(p.id)) carry(o.patch, p); }
    // Client-specific / custom requirements (no library row) come along too — full scope (D31).
    let sortKey = ops.length;
    const newStdCodes = new Set(versions.map(v => v.standard_code));
    for (const p of prevReqs.filter(r => !(r.origin === 'library' || r.library_requirement_id) && newStdCodes.has(r.standard_code))) {
      const row = { id: uid('ireq_'), audit_id: audit.id, client_id: prev.client_id, standard_code: p.standard_code, library_requirement_id: null, section_id: p.section_id || null,
        sort_key: sortKey++, origin: p.origin || 'client_specific', clause: p.clause, clause_name: p.clause_name || '', requirement_text: p.requirement_text,
        assessment_state: 'not_started', assessment_result: null, stable_key: p.stable_key || null, source_changed: false, missing_from_source: false,
        row_version: 1, created_by: caller.uid, updated_by: caller.uid, created_at: nowIso, updated_at: nowIso };
      carry(row, p);
      ops.push({ table: 'iso_requirements', id: row.id, patch: row });
    }
    // B4.2: a follow-up keeps only the chosen clauses — those picked, those of the picked findings and
    // those the picked actions cover; every other clause (and any clause new in this edition) is Out of scope.
    let scopeFindings = null, scopeActions = null, outOfScope = 0;
    if (followUp) {
      scopeFindings = new Set(scopeIn.findingIds || []); scopeActions = new Set(scopeIn.actionIds || []);
      const keep = new Set(scopeIn.requirementIds || []);
      if (scopeFindings.size) for (const l of await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: [...scopeFindings] }] })) keep.add(l.requirement_id);
      if (scopeActions.size) {
        const aLinks = await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: [...scopeActions] }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
        const viaFindings = aLinks.filter(l => l.target_type === 'finding').map(l => l.target_id);
        for (const l of aLinks) if (l.target_type === 'requirement') keep.add(l.target_id);
        if (viaFindings.length) for (const l of await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: viaFindings }] })) keep.add(l.requirement_id);
      }
      const prevOf = new Map([...reqMap].map(([p, n]) => [n, p]));
      for (const o of ops) {
        const p = prevOf.get(o.patch.id);
        if (p && keep.has(p)) continue;
        Object.assign(o.patch, { compliance_status: 'out_of_scope', applicability: 'out_of_scope' });
        outOfScope++;
      }
    }
    if (ops.length) await ctx.db.importApply(isoImport.uid('imaint_'), ops);
    // Open findings, tagged with their previous ref and linked to the matched requirement.
    const prevFindings = await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }, { field: 'archived_at', op: 'isnull' }] });
    const prevFindingLinks = prevFindings.length ? await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: prevFindings.map(f => f.id) }] }) : [];
    const findingMap = new Map(); let findingsSkipped = 0;
    for (const f of prevFindings.filter(x => !FINDING_CLOSED_STATUSES.includes(x.status) && (!scopeFindings || scopeFindings.has(x.id)))) {
      const newReqIds = prevFindingLinks.filter(l => l.finding_id === f.id).map(l => reqMap.get(l.requirement_id)).filter(Boolean);
      if (!newReqIds.length) { findingsSkipped++; continue; }
      const nf = await ctx.db.insertNumbered('iso_findings', 'child', audit.id + ':F', {
        id: uid('ifnd_'), audit_id: audit.id, client_id: prev.client_id, classification: f.classification, title: f.title,
        statement: f.statement || null, criteria: f.criteria || null, evidence_basis: f.evidence_basis || null, status: f.status,
        visibility: f.visibility || 'internal', visible_to_uids: f.visible_to_uids || [], root_cause_required: !!f.root_cause_required,
        carried_from_ref: `${prev.ref} / ${f.ref}`, created_by: caller.uid, updated_by: caller.uid,
        carried_meta: { auditRef: prev.ref, ref: f.ref, status: f.status, by: f.created_by || null, at: f.created_at || null }, // B4.2
      }, { audit_id: audit.id, client_id: prev.client_id, entity_type: 'finding', entity_id: null, action: 'carried_over', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
      for (const rid of newReqIds) await ctx.db.insert('iso_finding_requirements', { finding_id: nf.id, requirement_id: rid });
      findingMap.set(f.id, nf.id);
    }
    // Open actions (with their subtasks), links remapped to the new requirements and carried findings.
    const prevActions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }, { field: 'archived_at', op: 'isnull' }] });
    const openActions = prevActions.filter(a => !ACTION_CLOSED_STATUSES.includes(a.status) && (!scopeActions || scopeActions.has(a.id)));
    const prevActionLinks = openActions.length ? await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: openActions.map(a => a.id) }, { field: 'link_state', op: 'eq', value: 'confirmed' }] }) : [];
    const prevSubtasks = openActions.length ? await ctx.db.list('iso_action_subtasks', { where: [{ field: 'action_id', op: 'in', value: openActions.map(a => a.id) }, { field: 'archived_at', op: 'isnull' }] }) : [];
    const ACTION_CARRY_FIELDS = ['title', 'description', 'owner_kind', 'owner_uid', 'start_date', 'due_date', 'priority', 'risk_rating', 'progress', 'status',
      'verification_requirements', 'correction', 'containment', 'root_cause_method', 'five_whys', 'fishbone', 'cause_tree', 'contributing_factors', 'cause_categories',
      'root_cause_summary', 'corrective_action', 'preventive_action', 'effectiveness_check', 'effectiveness_review_date', 'visibility', 'visible_to_uids'];
    let actionsCarried = 0;
    for (const a of openActions) {
      const links = prevActionLinks.filter(l => l.action_id === a.id).map(l => ({ type: l.target_type, id: l.target_type === 'requirement' ? reqMap.get(l.target_id) : findingMap.get(l.target_id) })).filter(l => l.id);
      const row = { id: uid('iact_'), audit_id: audit.id, client_id: prev.client_id, verification_status: 'not_verified', reopened_count: 0, carried_from_ref: `${prev.ref} / ${a.ref}`, created_by: caller.uid, updated_by: caller.uid,
        carried_meta: { auditRef: prev.ref, ref: a.ref, status: a.status, by: a.created_by || null, at: a.created_at || null } }; // B4.2
      for (const k of ACTION_CARRY_FIELDS) if (a[k] !== undefined) row[k] = a[k];
      if (row.progress == null) row.progress = 0;
      const na = await ctx.db.insertNumbered('iso_actions', 'child', audit.id + ':A', row, { audit_id: audit.id, client_id: prev.client_id, entity_type: 'action', entity_id: null, action: 'carried_over', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
      for (const l of links) await ctx.db.insert('iso_action_links', { id: uid('ial_'), action_id: na.id, target_type: l.type, target_id: l.id, link_state: 'confirmed', decided_by: caller.uid, decided_at: nowIso });
      for (const st of prevSubtasks.filter(x => x.action_id === a.id)) await ctx.db.insert('iso_action_subtasks', { id: uid('isub_'), audit_id: audit.id, client_id: prev.client_id, action_id: na.id, title: st.title, owner_uid: st.owner_uid || null, due_date: st.due_date || null, done: !!st.done, sort_key: st.sort_key || 0, created_by: caller.uid, updated_by: caller.uid });
      actionsCarried++;
    }
    // Accepted evidence: copied unlinked, offered as a suggestion for the clauses it was accepted for.
    const prevLinks = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }] });
    const acceptedFor = new Map();
    for (const l of prevLinks) if (l.target_type === 'requirement' && l.review_status === 'accepted' && reqMap.get(l.target_id)) { if (!acceptedFor.has(l.evidence_id)) acceptedFor.set(l.evidence_id, new Set()); acceptedFor.get(l.evidence_id).add(reqMap.get(l.target_id)); }
    const EVIDENCE_CARRY_FIELDS = ['kind', 'title', 'description', 'storage_path', 'original_filename', 'mime', 'size_bytes', 'url', 'document_id', 'version_label', 'evidence_date', 'owner_uid',
      'confidentiality', 'visibility', 'visible_to_uids', 'review_or_expiry_date', 'document_status', 'approver_uid', 'effective_date'];
    let evidenceCarried = 0;
    for (const [eid, targets] of acceptedFor) {
      const e = await ctx.db.get('iso_evidence', eid);
      if (!e || e.archived_at || e.superseded_by) continue;
      const row = { id: uid('ievd_'), audit_id: audit.id, client_id: prev.client_id, suggest_related: e.suggest_related !== false, uploaded_by: e.uploaded_by || null, uploaded_via: e.uploaded_via || 'staff',
        carried_from_ref: `${prev.ref} / ${e.ref}`, carry_target_ids: [...targets], created_by: caller.uid };
      for (const k of EVIDENCE_CARRY_FIELDS) if (e[k] !== undefined) row[k] = e[k];
      await ctx.db.insertNumbered('iso_evidence', 'child', audit.id + ':E', row, { audit_id: audit.id, client_id: prev.client_id, entity_type: 'evidence', entity_id: null, action: 'carried_over', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
      evidenceCarried++;
    }
    // B4.2: the Lead chosen in the dialog leads the new board.
    if (ctx.payload.leadUid) {
      const leadUid = ctx.payload.leadUid;
      const now = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }] });
      if (now.some(m => m.user_uid === leadUid)) await ctx.db.updateMember(audit.id, leadUid, { audit_role: 'lead_auditor', ...defaultFlagsFor('lead_auditor') }, null);
      else await ctx.db.insert('iso_audit_members', { audit_id: audit.id, user_uid: leadUid, member_kind: 'staff', audit_role: 'lead_auditor', ...defaultFlagsFor('lead_auditor'), added_by: caller.uid, added_at: nowIso });
    }
    const summary = { requirements: ops.length, matched: reqMap.size, unmatched: ops.length - reqMap.size, findings: findingMap.size, findingsSkipped, actions: actionsCarried, evidence: evidenceCarried, outOfScope, type: followUp ? 'follow_up' : 'maintenance' };
    await ctx.db.log({ audit_id: audit.id, client_id: prev.client_id, entity_type: 'audit', entity_id: audit.id, entity_ref: audit.ref, action: followUp ? 'follow_up_started' : 'maintenance_started', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind, after: { previous: prev.ref, ...summary } });
    return { audit, summary };
  },
};
defineOp('audit.startMaintenance', START_NEXT_OP);
defineOp('audit.startFollowUp', START_NEXT_OP);

// ── Release-1 B4.5: client settings (Q8, Q10, Q13) ─────────────────────────────────────────────
// One small record per client: next audit due, frequency, industry, notes. Reminders read these dates
// (B5); recurrence never creates boards. Staff only.
const CLIENT_FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'six_monthly', 'annual', 'custom'];
const CLIENT_INDUSTRIES = ['mining_resources', 'construction', 'manufacturing', 'transport_logistics', 'professional_services', 'government', 'other'];
const CLIENT_SETTINGS_FIELDS = ['next_audit_due', 'frequency', 'custom_months', 'industry', 'notes'];
function blankClientSettings(clientId) { return { id: clientId, client_id: clientId, next_audit_due: null, frequency: null, custom_months: null, industry: null, notes: null, row_version: 0 }; }
defineOp('clientSettings.get', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) { if (!isValidId(payload.clientId)) throw badRequest('A client is required.'); },
  async run(ctx) { return (await ctx.db.get('iso_client_settings', ctx.payload.clientId)) || blankClientSettings(ctx.payload.clientId); },
});
defineOp('clientSettings.update', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) {
    if (!isValidId(payload.clientId)) throw badRequest('A client is required.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    const p = payload.patch || {};
    for (const k of Object.keys(p)) if (!CLIENT_SETTINGS_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
    if (p.next_audit_due != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.next_audit_due))) throw badRequest('The next audit date must be a date.');
    if (p.frequency != null && !CLIENT_FREQUENCIES.includes(p.frequency)) throw badRequest('Invalid frequency.');
    if (p.custom_months != null && !(Number.isInteger(p.custom_months) && p.custom_months >= 1 && p.custom_months <= 60)) throw badRequest('Custom frequency is 1 to 60 months.');
    if (p.industry != null && !CLIENT_INDUSTRIES.includes(p.industry)) throw badRequest('Invalid industry.');
    if (p.notes != null && (typeof p.notes !== 'string' || p.notes.length > 4000)) throw badRequest('The notes are too long.');
  },
  async run(ctx) {
    await ctx.checkClientExists(ctx.payload.clientId);
    const patch = { ...ctx.payload.patch };
    if (patch.frequency && patch.frequency !== 'custom') patch.custom_months = null;
    const existing = await ctx.db.get('iso_client_settings', ctx.payload.clientId);
    const activity = { audit_id: null, client_id: ctx.payload.clientId, entity_type: 'client_settings', entity_id: ctx.payload.clientId, action: 'client_settings_updated', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind };
    if (!existing) {
      if (Number(ctx.payload.expectedVersion) !== 0) throw conflict();
      const row = { ...blankClientSettings(ctx.payload.clientId), ...patch, row_version: 1, created_by: ctx.caller.uid, updated_by: ctx.caller.uid, created_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString() };
      return ctx.db.insert('iso_client_settings', row, activity);
    }
    try { return await ctx.db.update('iso_client_settings', existing.id, patch, ctx.payload.expectedVersion, activity); }
    catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// ── Release-1 B4.4: the client programme (Q8 — the client's chain of boards, no new record) ──────
// Adds up existing tables only, and only over boards the caller can open. No single "health" figure.
defineOp('programme.get', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) { if (!isValidId(payload.clientId)) throw badRequest('A client is required.'); },
  async run(ctx) {
    const clientId = ctx.payload.clientId;
    const all = await ctx.db.list('iso_audits', { where: [{ field: 'client_id', op: 'eq', value: clientId }, { field: 'archived_at', op: 'isnull' }] });
    const audits = [];
    for (const a of all) {
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      if (canOpenAudit(ctx.caller, a, members)) audits.push(a);
    }
    const ids = audits.map(a => a.id);
    const today = await boardToday(ctx);
    const plus = days => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const within30 = plus(30), within60 = plus(60);
    const byId = new Map(audits.map(a => [a.id, a]));
    const item = (row, extra) => ({ auditId: row.audit_id, auditRef: (byId.get(row.audit_id) || {}).ref || null, id: row.id, ref: row.ref || null, title: row.title || row.description || '', ...extra });
    const listIn = async table => ids.length ? (await ctx.db.list(table, { where: [{ field: 'audit_id', op: 'in', value: ids }, { field: 'archived_at', op: 'isnull' }], limit: 20000 })) : [];
    const [findings, actions, evidence] = [await listIn('iso_findings'), await listIn('iso_actions'), await listIn('iso_evidence')];
    const openF = findings.filter(f => !FINDING_CLOSED_STATUSES.includes(f.status));
    const standards = new Set(), units = [];
    for (const a of audits) {
      for (const as of await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] })) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) standards.add(v.standard_code); }
      for (const u of await ctx.db.list('iso_audit_units', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] })) if (!units.includes(u.name)) units.push(u.name);
    }
    const successorOf = new Map(audits.filter(a => a.previous_audit_id).map(a => [a.previous_audit_id, a]));
    const dueBoards = audits.filter(a => a.stage === 'closed' && !successorOf.has(a.id) && a.maintenance_due);
    const settings = (await ctx.db.get('iso_client_settings', clientId)) || blankClientSettings(clientId);
    const nextAuditDue = settings.next_audit_due || dueBoards.map(a => a.maintenance_due).sort()[0] || null;
    const byClass = {};
    for (const f of openF) (byClass[f.classification] = byClass[f.classification] || []).push(item(f, { classification: f.classification, status: f.status }));
    const tiles = {
      openFindingsByClass: byClass,
      overdueActions: actions.filter(a => !ACTION_CLOSED_STATUSES.includes(a.status) && a.due_date && a.due_date < today).map(a => item(a, { due: a.due_date })),
      effectivenessDue: actions.filter(a => a.effectiveness_review_date && a.effectiveness_review_date <= within30 && a.verification_status !== 'effective').map(a => item(a, { due: a.effectiveness_review_date })),
      repeatFindings: openF.filter(f => f.repeat_of_ref).map(f => item(f, { repeatOf: f.repeat_of_ref })),
      reopenedFindings: findings.filter(f => (f.reopened_count || 0) > 0).map(f => item(f, { reopened: f.reopened_count, status: f.status })),
      documentsDue: evidence.filter(e => !e.superseded_by && e.review_or_expiry_date && e.review_or_expiry_date <= within30).map(e => item(e, { due: e.review_or_expiry_date })),
      followUpsDue: dueBoards.filter(a => a.maintenance_due <= within60).map(a => ({ auditId: a.id, auditRef: a.ref, title: a.title, due: a.maintenance_due })),
    };
    const timeline = audits.slice().sort((x, y) => String(x.planned_start || x.created_at || '').localeCompare(String(y.planned_start || y.created_at || '')))
      .map(a => ({ id: a.id, ref: a.ref, title: a.title, auditType: a.audit_type, stage: a.stage, plannedStart: a.planned_start || null, plannedEnd: a.planned_end || null,
        completedAt: a.completed_at || null, maintenanceDue: a.maintenance_due || null, previousAuditId: a.previous_audit_id || null, hasSuccessor: successorOf.has(a.id), createdAt: a.created_at || null }));
    return { client: { id: clientId, name: (await ctx.getClientName(clientId)) || clientId }, standards: [...standards].sort(), sites: units, settings, nextAuditDue, timeline, tiles, today };
  },
});

// ── Release-1 B4.6: evidence requests (iso_evidence_requests, already in 010) ────────────────────
// "Request from client" in the Documents tab: one row per document per clause it is asked for. The
// letter itself is text the auditor copies or downloads; email and the portal come later.
const EVIDENCE_REQUEST_STATUSES = ['open', 'submitted', 'closed'];
defineOp('evidenceRequest.create', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canManageEvidence(ctx); },
  async validate(payload) {
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 200) throw badRequest('Pick at least one document.');
    for (const it of payload.items) {
      if (!it || !isNonEmptyText(it.documentName, 300)) throw badRequest('Each request needs a document name.');
      if (!Array.isArray(it.requirementIds) || !it.requirementIds.length || it.requirementIds.length > 200 || !it.requirementIds.every(isValidId)) throw badRequest('Each request needs its clauses.');
      if (it.requestedFromUid != null && !isValidId(it.requestedFromUid)) throw badRequest('Invalid recipient.');
      if (it.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(it.dueDate))) throw badRequest('The due date must be a date.');
    }
  },
  async run(ctx) {
    const rows = [];
    for (const it of ctx.payload.items) {
      for (const rid of new Set(it.requirementIds)) {
        const r = await ctx.db.get('iso_requirements', rid);
        if (!r || r.audit_id !== ctx.audit.id || r.archived_at) throw badRequest('That clause is not on this audit.');
        rows.push(await ctx.db.insert('iso_evidence_requests', {
          id: uid('iereq_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, target_type: 'requirement', target_id: rid,
          description: it.documentName.trim(), requested_from_uid: it.requestedFromUid || null, due_date: it.dueDate || null, status: 'open',
          row_version: 1, created_by: ctx.caller.uid, updated_by: ctx.caller.uid, created_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString(),
        }));
      }
    }
    await ctx.db.log({ audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'audit', entity_id: ctx.audit.id, entity_ref: ctx.audit.ref,
      action: 'evidence_requested', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind, after: { documents: ctx.payload.items.map(i => i.documentName), rows: rows.length } });
    return { created: rows.length, rows };
  },
});
defineOp('evidenceRequest.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return ctx.db.list('iso_evidence_requests', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] }); },
});
defineOp('evidenceRequest.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id) || payload.expectedVersion == null) throw badRequest('A request and expectedVersion are required.');
    if (!EVIDENCE_REQUEST_STATUSES.includes(payload.status)) throw badRequest('Invalid status.');
  },
  async run(ctx) {
    const row = await ctx.db.get('iso_evidence_requests', ctx.payload.id);
    if (!row || row.audit_id !== ctx.audit.id) throw notFound();
    try {
      return await ctx.db.update('iso_evidence_requests', row.id, { status: ctx.payload.status }, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: row.target_id, action: 'evidence_request_' + ctx.payload.status,
        field: 'status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

defineOp('audit.setAccess', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (!['all_internal', 'private'].includes(payload.visibility)) throw badRequest('Invalid visibility.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    try {
      return await ctx.db.update('iso_audits', ctx.audit.id, { visibility: ctx.payload.visibility }, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'audit', entity_id: ctx.audit.id,
        entity_ref: ctx.audit.ref, action: 'access_changed', field: 'visibility', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      // Switching to private never removes existing members (plan §6.4) — this never touches
      // iso_audit_members, so that guarantee holds by construction.
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

defineOp('audit.archive', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async run(ctx) {
    return ctx.db.update('iso_audits', ctx.audit.id, { archived_at: ctx.now.toISOString() }, ctx.audit.row_version, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'audit', entity_id: ctx.audit.id,
      entity_ref: ctx.audit.ref, action: 'archived', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});

// ── member.* ─────────────────────────────────────────────────────────────────────────────────────
defineOp('member.list', {
  scope: 'audit', clientProjection: 'member',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return ctx.members; },
});
defineOp('member.add', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (!isValidId(payload.uid)) throw badRequest('A user is required.');
    if (!isNonEmptyText(payload.auditRole, 40)) throw badRequest('An ISO role is required.');
  },
  async run(ctx) {
    if (ctx.members.some(m => m.user_uid === ctx.payload.uid)) throw badRequest('Already a member.');
    const memberKind = ctx.payload.memberKind === 'client' ? 'client' : 'staff';
    const allowedRoles = allowedAuditRoles({ kind: memberKind, restricted: !!ctx.payload.restricted });
    if (!allowedRoles.includes(ctx.payload.auditRole)) throw badRequest('That role is not allowed for this member.');
    const row = await ctx.db.insert('iso_audit_members', {
      audit_id: ctx.audit.id, user_uid: ctx.payload.uid, member_kind: memberKind, audit_role: ctx.payload.auditRole,
      ...defaultFlagsFor(ctx.payload.auditRole), added_by: ctx.caller.uid, added_at: ctx.now.toISOString(),
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'member', entity_id: ctx.payload.uid,
      action: 'added', after: { audit_role: ctx.payload.auditRole }, source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    return row;
  },
});
defineOp('member.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async run(ctx) {
    const target = ctx.members.find(m => m.user_uid === ctx.payload.uid);
    if (!target) throw notFound('Member not found.');
    const patch = {};
    if (ctx.payload.auditRole) patch.audit_role = ctx.payload.auditRole;
    for (const f of ['can_upload_evidence', 'can_respond', 'can_verify', 'can_manage_client_actions']) {
      if (f in (ctx.payload.patch || {})) patch[f] = !!ctx.payload.patch[f];
    }
    // "Removing the last audit_manager is refused" (plan §6.4) — check before applying a demotion
    // away from top-level authority. D35/R2: 'lead_auditor' holds the same authority now, so this
    // counts both — a board always keeps at least one Lead Auditor (or the legacy audit_manager).
    const TOP_ROLES = ['lead_auditor', 'audit_manager'];
    if (patch.audit_role && TOP_ROLES.includes(target.audit_role) && !TOP_ROLES.includes(patch.audit_role)) {
      const managers = ctx.members.filter(m => TOP_ROLES.includes(m.audit_role));
      if (managers.length <= 1) throw badRequest('Cannot remove the last Lead Auditor.');
    }
    // member.* changes always log before/after role and flags (plan §6.3a), regardless of which
    // fields changed.
    return ctx.db.updateMember(ctx.audit.id, ctx.payload.uid, patch, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'member', entity_id: ctx.payload.uid,
      action: 'updated', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});
defineOp('member.remove', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async run(ctx) {
    const target = ctx.members.find(m => m.user_uid === ctx.payload.uid);
    if (!target) throw notFound('Member not found.');
    if (target.audit_role === 'audit_manager' && ctx.members.filter(m => m.audit_role === 'audit_manager').length <= 1) {
      throw badRequest('Cannot remove the last audit manager.');
    }
    await ctx.db.removeMember(ctx.audit.id, ctx.payload.uid, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'member', entity_id: ctx.payload.uid,
      action: 'removed', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    return { removed: ctx.payload.uid };
  },
});

// ── unit.* ───────────────────────────────────────────────────────────────────────────────────────
defineOp('unit.list', {
  scope: 'audit', clientProjection: 'unit',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return ctx.db.list('iso_audit_units', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] }); },
});
defineOp('unit.add', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['audit_manager', 'auditor'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (!['site', 'department', 'process'].includes(payload.kind)) throw badRequest('Invalid unit kind.');
    if (!isNonEmptyText(payload.name, 200)) throw badRequest('A name is required.');
  },
  async run(ctx) {
    return ctx.db.insert('iso_audit_units', { id: uid('iunit_'), audit_id: ctx.audit.id, kind: ctx.payload.kind, name: ctx.payload.name });
  },
});
defineOp('unit.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['audit_manager', 'auditor'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if ('name' in payload && !isNonEmptyText(payload.name, 200)) throw badRequest('A name is required.');
  },
  async run(ctx) {
    const unit = await ctx.db.get('iso_audit_units', ctx.payload.id);
    if (!unit || unit.audit_id !== ctx.audit.id) throw notFound();
    // iso_audit_units has no row_version (same shape as iso_relationships/iso_action_links) —
    // patchRow, not update() (A43: found this op never actually persisted at all — it built and
    // returned a patched object without ever writing it, so an edited unit name reverted on the
    // next page load. Real, pre-existing, untested since Phase 3; fixed here).
    return ctx.db.patchRow('iso_audit_units', unit.id, { name: ctx.payload.name || unit.name });
  },
});
defineOp('unit.archive', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['audit_manager', 'auditor'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async run(ctx) {
    const unit = await ctx.db.get('iso_audit_units', ctx.payload.id);
    if (!unit || unit.audit_id !== ctx.audit.id) throw notFound();
    return ctx.db.patchRow('iso_audit_units', unit.id, { archived_at: ctx.now.toISOString() });
  },
});

// ── section.list (plan 6.1 "grouped standard -> clause section") ───────────────────────────────
// iso_clause_sections is library data (keyed by version_id, immutable once approved) — resolved via
// the audit's own pinned iso_audit_standards, same lookup audit.create/import already do.
defineOp('section.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const out = [];
    for (const as of auditStandards) {
      const version = await ctx.db.get('iso_standard_versions', as.version_id);
      if (!version) continue;
      const sections = await ctx.db.list('iso_clause_sections', { where: [{ field: 'version_id', op: 'eq', value: version.id }] });
      for (const s of sections) out.push({ ...s, standard_code: version.standard_code });
    }
    return out;
  },
});

// ── requirement.* (plan Phase 6) ────────────────────────────────────────────────────────────────
// Assessment-capable roles: audit_manager/auditor/contributor may assess; reviewer is read-only
// (matches the role table's own "contributor" description — can work the board but not manage
// access/membership). A client caller never writes a requirement, ever (plan 6's own Tests line).
function canAssessRequirement(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(ctx.membership.audit_role);
}
// D35/R2 (P4): one status field replaces assessment_state + assessment_result + applicability +
// effectiveness + gap_description. 'applicability'/'assessment_state'/'assessment_result'/
// 'effectiveness'/'gap_description' are removed from here — no longer directly writable — but stay
// in REQUIREMENT_RESET_FIELDS below: requirement.update derives and writes them from
// compliance_status on every save, so isoCalc.js and the dashboard (R5 work, not yet rebuilt) keep
// reading real, correct values with no changes of their own. 'risk_severity' stays writable and
// untouched (R6: Actions merge moves it to the action's priority — not yet built).
const REQUIREMENT_WRITABLE_FIELDS = [
  'compliance_status', 'na_justification', 'unit_ids', 'audit_question', 'current_system', 'evidence_expected',
  'interview_notes', 'sampling_details', 'auditor_observations',
  'implementation_level', 'gap_category', 'current_controls', 'impact',
  'risk_severity', 'recommended_action', 'responsible_uid', 'target_date', 'verification_requirements',
  'internal_notes', 'client_visible_comment', 'visibility', 'visible_to_uids',
  'ofi', 'ofi_note', 'gap_reason',
];
// D44 (2026-10-06): OFI is a flag on Compliant / Partially Compliant, not a status — 'ofi' is still
// accepted on input as an alias for Compliant + ofi=true (normaliseRequirementPatch). D45: a clause can
// be "Outside this audit's scope" — its own status, excluded from coverage like N/A but not N/A.
const COMPLIANCE_STATUSES = ['not_assessed', 'compliant', 'partially_compliant', 'non_compliant', 'not_applicable', 'out_of_scope'];
const OFI_STATUSES = ['compliant', 'partially_compliant'];
// D48: why a Partially Compliant / Non-Compliant clause falls short — the old workbook's own vocabulary.
const GAP_STATUSES = ['partially_compliant', 'non_compliant'];
const GAP_REASONS = ['not_implemented', 'ineffective', 'no_evidence'];
// compliance_status → the retired fields it derives, so every consumer that still reads them
// (isoCalc.js, the maintenance-audit baseline carry-forward, filters) sees correct values.
const COMPLIANCE_DERIVED = {
  not_assessed: { assessment_state: 'not_started', assessment_result: null, applicability: 'applicable' },
  compliant: { assessment_state: 'complete', assessment_result: 'implemented_effective', applicability: 'applicable' },
  partially_compliant: { assessment_state: 'complete', assessment_result: 'partially_implemented', applicability: 'applicable' },
  non_compliant: { assessment_state: 'complete', assessment_result: 'not_implemented', applicability: 'applicable' },
  not_applicable: { assessment_state: 'complete', assessment_result: null, applicability: 'not_applicable' },
  // Its own applicability value, so every formula and filter that keys on APPLICABLE_VALUES
  // (_isoCalc) leaves it out of coverage exactly as it does N/A — counts and click-through lists agree.
  out_of_scope: { assessment_state: 'not_started', assessment_result: null, applicability: 'out_of_scope' },
};
// compliance_status → the senior-review verdict it mirrors once approved (D32's fields stay real
// and populated; the old per-clause "Review ▾" UI is gone — P7 — but requirement.seniorReview
// still exists and works independently, untouched, for anything that still calls it directly).
const COMPLIANCE_TO_VERDICT = { compliant: 'compliant', partially_compliant: 'partially_compliant', non_compliant: 'non_compliant', not_applicable: 'na_confirmed', out_of_scope: 'na_confirmed' };
// D46/D48/D47: what still stands between an assessed clause and approval / board close / report issue,
// or null. Not assessed and Outside scope need nothing; N/A's basis is its (already required) reason.
function basisProblem(r) {
  const cs = r.compliance_status || 'not_assessed';
  if (cs === 'not_assessed' || cs === 'out_of_scope') return null;
  if (r.derived_from_id) return 'Derived from a related clause — confirm it first.';
  if (cs !== 'not_applicable' && !String(r.current_system || '').trim()) return 'Basis missing — write the current system (what you saw) first.';
  // Ticked checks alone aren't a basis: they say what was checked, not what was seen.
  if (cs !== 'not_applicable' && !IsoChecks.hasOwnText(r.current_system, confirmItemsFor(r))) return 'Basis missing — the ticked checks are in; add what you saw.';
  if (GAP_STATUSES.includes(cs) && !r.gap_reason) return 'Gap reason missing — pick why it falls short.';
  return null;
}
const BASIS_SHORT = p => (/^Derived/.test(p) ? 'derived — confirm' : /^Gap reason/.test(p) ? 'gap reason missing' : 'basis missing');
function approvedPatch(ctx, cs) {
  return { approval_state: 'approved', approved_by: ctx.caller.uid, approved_at: ctx.now.toISOString(), return_note: null,
    senior_review_status: COMPLIANCE_TO_VERDICT[cs], senior_review_note: null, senior_reviewed_by: ctx.caller.uid, senior_reviewed_at: ctx.now.toISOString() };
}
const PROPOSED_PATCH = { approval_state: 'proposed', approved_by: null, approved_at: null, return_note: null,
  senior_review_status: 'pending', senior_review_note: null, senior_reviewed_by: null, senior_reviewed_at: null };
// Mirrors the DB's own check constraints (plan §6.1) so a bad write gets a clear 400 here rather
// than a raw constraint-violation error from the adapter.
// D35/R2 (P7, P10): who holds final review and approval authority on this board. Keyed off the
// new 'lead_auditor' role, or automatically — with no extra step — the single assess-capable
// member of a one-auditor board (the user's own rule: "A sole auditor automatically becomes the
// Lead Auditor"). Deliberately independent of the old action-verify `can_verify` flag, which stays
// exactly as it was for Actions (not yet redesigned — R6).
function assessCapableMembers(members) {
  return (members || []).filter(m => m.member_kind === 'staff' && ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(m.audit_role));
}
function isSoleAssessor(ctx) {
  const assessors = assessCapableMembers(ctx.members);
  return assessors.length === 1 && assessors[0].user_uid === ctx.caller.uid;
}
function isEffectiveLeadAuditor(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || isSoleAssessor(ctx);
}
// Fields that, changed after approval or a return, put the row back to "proposed" — an auditor
// resubmits either by picking a status again or by changing what they wrote (P7's "Change the
// status or the notes to resubmit"). Mirrors the old SENIOR_REVIEW_INVALIDATING's spirit without
// touching that list or anything that reads it.
const APPROVAL_INVALIDATING = ['compliance_status', 'current_system', 'recommended_action', 'na_justification', 'gap_reason', 'ofi'];
// The one place compliance_status actually gets written: derives the retired old fields (so
// isoCalc.js and the dashboard need no changes, D35/R2), sets who/when assessed, and runs the
// approval workflow (P7) — proposed by default, approved immediately for the Lead Auditor or a
// sole auditor (D43's sibling decision, same reasoning), reset to proposed on a real resubmit.
// Shared by requirement.update and requirement.bulkUpdate so both stay in lock-step.
function applyComplianceStatusPatch(ctx, existing, patch) {
  const changingStatus = 'compliance_status' in patch && !sameValue(patch.compliance_status, existing.compliance_status);
  if (changingStatus) {
    const cs = patch.compliance_status;
    Object.assign(patch, COMPLIANCE_DERIVED[cs]);
    if (cs === 'not_assessed') {
      Object.assign(patch, { assessed_by: null, assessed_at: null, approval_state: null, approved_by: null, approved_at: null, return_note: null,
        senior_review_status: 'pending', senior_review_note: null, senior_reviewed_by: null, senior_reviewed_at: null });
    } else {
      patch.assessed_by = ctx.caller.uid; patch.assessed_at = ctx.now.toISOString();
      // D46: the Lead's (or sole auditor's) status is final on entry only once its basis is complete.
      if (isEffectiveLeadAuditor(ctx) && !basisProblem(Object.assign({}, existing, patch))) Object.assign(patch, approvedPatch(ctx, cs));
      else Object.assign(patch, PROPOSED_PATCH);
    }
  } else {
    // No status change: a resubmit-on-edit only applies once something has actually been assessed.
    const ex = Object.assign({}, existing, patch);
    if (ex.compliance_status && ex.compliance_status !== 'not_assessed' && (existing.approval_state === 'approved' || existing.approval_state === 'returned')
      && APPROVAL_INVALIDATING.some(k => k in patch && !sameValue(patch[k], existing[k]))) {
      Object.assign(patch, PROPOSED_PATCH);
    }
    // D46: the Lead completing the basis of their OWN assessment approves it there and then — the
    // same "final on entry" as before, just once the basis exists. Someone else's proposal still needs
    // an explicit Approve.
    const post = Object.assign({}, existing, patch);
    if (post.compliance_status && post.compliance_status !== 'not_assessed' && post.approval_state === 'proposed'
      && post.assessed_by === ctx.caller.uid && isEffectiveLeadAuditor(ctx) && !basisProblem(post)) {
      Object.assign(patch, approvedPatch(ctx, post.compliance_status));
    }
  }
}
// D44/D48: the old 'ofi' status becomes Compliant + ofi; the OFI flag and the gap reason only live on
// the statuses they belong to and are cleared (never refused) when the status moves elsewhere.
function normaliseRequirementPatch(existing, patch) {
  if (patch.compliance_status === 'ofi') { patch.compliance_status = 'compliant'; if (!('ofi' in patch)) patch.ofi = true; }
  if ('ofi' in patch && patch.ofi != null) patch.ofi = patch.ofi === true || patch.ofi === 'true';
  if ('gap_reason' in patch && patch.gap_reason === '') patch.gap_reason = null;
  const cs = 'compliance_status' in patch ? patch.compliance_status : (existing.compliance_status || 'not_assessed');
  if (!OFI_STATUSES.includes(cs) && (existing.ofi || patch.ofi)) { patch.ofi = false; patch.ofi_note = null; }
  if (!GAP_STATUSES.includes(cs) && (existing.gap_reason || patch.gap_reason)) patch.gap_reason = null;
}
function validateRequirementPatch(existing, patch) {
  normaliseRequirementPatch(existing, patch);
  if ('compliance_status' in patch && !COMPLIANCE_STATUSES.includes(patch.compliance_status)) throw badRequest('Invalid status.');
  if ('gap_reason' in patch && patch.gap_reason != null && !GAP_REASONS.includes(patch.gap_reason)) throw badRequest('Invalid gap reason.');
  if ('ofi_note' in patch && patch.ofi_note != null && String(patch.ofi_note).length > 2000) throw badRequest('That OFI note is too long.');
  const complianceStatus = 'compliance_status' in patch ? patch.compliance_status : (existing.compliance_status || 'not_assessed');
  const naJustification = 'na_justification' in patch ? patch.na_justification : existing.na_justification;
  if (complianceStatus === 'not_applicable' && !(naJustification && String(naJustification).trim())) {
    throw badRequest('Not applicable requires a reason.');
  }
  if ('visibility' in patch && patch.visibility === 'after_approval') throw badRequest('after_approval is for findings only.');
}

// D32 senior review: a second pair of eyes on each requirement's assessment, kept apart from the
// assessor. The senior reviewer gives the verdict — Compliant / Partially compliant / Non-compliant
// (N/A confirmed for a Not applicable row) — suggested from the assessor's Result, or sends it back
// with a note. The same people who may verify an action (canVerifyAction). Any verdict and redo drop
// back to pending the moment the assessment itself changes, so a verdict always refers to what is on
// screen now, never an older version of it.
const SENIOR_VERDICTS = ['compliant', 'partially_compliant', 'non_compliant', 'na_confirmed'];
const SENIOR_REVIEW_STATUSES = ['pending', 'redo'].concat(SENIOR_VERDICTS);
const SENIOR_VERDICT_FROM_RESULT = {
  implemented_effective: 'compliant', partially_implemented: 'partially_compliant', implemented_ineffective: 'partially_compliant',
  not_implemented: 'non_compliant', no_evidence_provided: 'non_compliant',
};
const SENIOR_REVIEW_INVALIDATING = ['applicability', 'na_justification', 'assessment_state', 'assessment_result',
  'implementation_level', 'effectiveness', 'current_system', 'gap_description', 'recommended_action', 'risk_severity',
  'client_visible_comment'];
function canSeniorReview(ctx) { return ctx.caller.kind !== 'client' && canVerifyAction(ctx); }
const blankToNull = v => (v === '' || v === undefined ? null : v);
function sameValue(a, b) { return JSON.stringify(blankToNull(a)) === JSON.stringify(blankToNull(b)); }
function suggestedVerdict(row) {
  if (row.applicability === 'not_applicable') return 'na_confirmed';
  return SENIOR_VERDICT_FROM_RESULT[row.assessment_result] || null;
}
// Adds the reset to `patch` when a field the review covered really changes (the drawer sends every
// field on each save, most unchanged — so compare values, never mere presence).
function seniorReviewReset(existing, patch) {
  if ((existing.senior_review_status || 'pending') === 'pending') return;
  if (SENIOR_REVIEW_INVALIDATING.some(k => k in patch && !sameValue(patch[k], existing[k]))) patch.senior_review_status = 'pending';
}
// Why this caller may not give this verdict on this row, or null. Separation of duties first.
function seniorVerdictBlocker(ctx, row, verdict) {
  if (row.assessed_by && row.assessed_by === ctx.caller.uid) return { own: true, message: 'You recorded this assessment — another senior reviewer must give the verdict.' };
  const na = row.applicability === 'not_applicable';
  if (!na && row.assessment_result == null) return { own: false, message: 'Nothing to review yet — record a result (or mark it Not applicable) first.' };
  if (verdict === 'na_confirmed' && !na) return { own: false, message: 'N/A confirmed is only for a requirement marked Not applicable.' };
  if (verdict !== 'na_confirmed' && na) return { own: false, message: 'This requirement is marked Not applicable — confirm the N/A or send it back.' };
  return null;
}
function seniorReviewPatch(ctx, status, note) {
  if (status === 'pending') return { senior_review_status: 'pending', senior_review_note: null, senior_reviewed_by: null, senior_reviewed_at: null };
  return { senior_review_status: status, senior_review_note: note ? String(note).trim() : null, senior_reviewed_by: ctx.caller.uid, senior_reviewed_at: ctx.now.toISOString() };
}

defineOp('requirement.list', {
  scope: 'audit', clientProjection: 'requirement',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    let rows = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    // 9.6: the top-level clause digit, so the clause matrix's cell filter is plain `eq` — the filter
    // schema has no prefix op, and this way it never needs one.
    for (const r of rows) { r.clause_family = isoCalc.clauseFamilyOf(r.clause); if (!r.senior_review_status) r.senior_review_status = 'pending'; r.sr_awaiting = isoCalc.seniorReviewAwaiting(r); }
    if (ctx.payload.filter) {
      const tzConfig = await ctx.db.getConfig('timezone');
      rows = await evaluateFilter(rows, ctx.payload.filter, { db: ctx.db, now: ctx.now, timezone: (tzConfig && tzConfig.value) || 'Australia/Perth' });
    }
    return rows;
  },
});

defineOp('requirement.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A requirement id is required.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_requirements', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound('Requirement not found.');
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!REQUIREMENT_WRITABLE_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
      patch[k] = ctx.payload.patch[k];
    }
    validateRequirementPatch(existing, patch);
    // D32 stays fully independent and intact (untouched) — a content edit still resets it to
    // pending exactly as it always has; applyComplianceStatusPatch runs after and only overrides
    // it with the mirrored verdict when compliance_status itself is what changed.
    seniorReviewReset(existing, patch);
    applyComplianceStatusPatch(ctx, existing, patch);
    try {
      return await ctx.db.update('iso_requirements', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: existing.id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'updated', reason: ctx.payload.reason || null,
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

defineOp('requirement.addCustom', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager', 'auditor'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (!isValidId(payload.standardCode)) throw badRequest('A standard is required.');
    if (!isNonEmptyText(payload.clause, 40)) throw badRequest('A clause is required.');
    if (!isNonEmptyText(payload.requirementText, 10000)) throw badRequest('Requirement text is required.');
    if (payload.origin && !['client_specific', 'contractual', 'regulatory_legal'].includes(payload.origin)) throw badRequest('Invalid origin for a custom requirement.');
  },
  async run(ctx) {
    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    let versionId = null;
    for (const as of auditStandards) {
      const v = await ctx.db.get('iso_standard_versions', as.version_id);
      if (v && v.standard_code === ctx.payload.standardCode) { versionId = v.id; break; }
    }
    if (!versionId) throw badRequest(`This audit has no ${ctx.payload.standardCode} standard pinned.`);
    const siblings = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const sortKey = siblings.reduce((m, r) => Math.max(m, r.sort_key || 0), 0) + 1;
    return ctx.db.insert('iso_requirements', {
      id: uid('ireq_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, standard_code: ctx.payload.standardCode,
      library_requirement_id: null, section_id: ctx.payload.sectionId || null, sort_key: sortKey,
      origin: ctx.payload.origin || 'client_specific', clause: ctx.payload.clause, clause_name: ctx.payload.clauseName || '',
      requirement_text: ctx.payload.requirementText, applicability: 'applicable', unit_ids: [],
      assessment_state: 'not_started', compliance_status: 'not_assessed', approval_state: null,
      visibility: 'internal', visible_to_uids: [],
      source_changed: false, missing_from_source: false, created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});

defineOp('requirement.bulkUpdate', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!Array.isArray(payload.ids) || !payload.ids.length) throw badRequest('Select at least one requirement.');
    if (payload.ids.length > 500) throw badRequest('Too many requirements selected at once.');
  },
  async run(ctx) {
    // D35/R2: 'compliance_status' replaces 'assessment_state' — the bulk bar's "set status" (P7's
    // remove/merge list: "Bulk: set status · set owner · approve (Lead)").
    const BULK_FIELDS = ['compliance_status', 'responsible_uid', 'target_date', 'visibility'];
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!BULK_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable in bulk.`);
      patch[k] = ctx.payload.patch[k];
    }
    if ('visibility' in patch && patch.visibility === 'after_approval') throw badRequest('after_approval is for findings only.');
    if ('compliance_status' in patch && patch.compliance_status === 'not_applicable') throw badRequest('Not applicable needs its own reason per clause — set it one at a time.');
    let updated = 0;
    for (const id of ctx.payload.ids) {
      const existing = await ctx.db.get('iso_requirements', id);
      if (!existing || existing.audit_id !== ctx.audit.id) continue; // silently skip rows outside this audit — never leak their existence
      const rowPatch = Object.assign({}, patch);
      validateRequirementPatch(existing, rowPatch);
      seniorReviewReset(existing, rowPatch);
      applyComplianceStatusPatch(ctx, existing, rowPatch);
      await ctx.db.update('iso_requirements', id, rowPatch, existing.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'bulk_updated', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      updated++;
    }
    return { updated };
  },
});

// D35/R2 (P7): the Lead Auditor's review and approval — "Approve section"/"Approve all" in bulk,
// "Return" one row at a time with a note. Independent of the old requirement.seniorReview (D32,
// still present, untouched, unused by the new UI — different fields, no conflict).
function canApproveRequirement(ctx) { return isEffectiveLeadAuditor(ctx); }
defineOp('requirement.approve', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canApproveRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A requirement id is required.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_requirements', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) throw notFound('Requirement not found.');
    if (!existing.compliance_status || existing.compliance_status === 'not_assessed') throw badRequest('Nothing to approve yet — set a status first.');
    const why = basisProblem(existing);
    if (why) throw badRequest(why);
    const patch = approvedPatch(ctx, existing.compliance_status);
    try {
      return await ctx.db.update('iso_requirements', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: existing.id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'approved', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
defineOp('requirement.return', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canApproveRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A requirement id is required.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (!isNonEmptyText(payload.note, 2000)) throw badRequest('Say what to check — the auditor sees this note.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_requirements', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) throw notFound('Requirement not found.');
    if (!existing.compliance_status || existing.compliance_status === 'not_assessed') throw badRequest('Nothing to return yet — it has no status to question.');
    const note = String(ctx.payload.note).trim();
    const patch = { approval_state: 'returned', approved_by: null, approved_at: null, return_note: note,
      senior_review_status: 'redo', senior_review_note: note, senior_reviewed_by: ctx.caller.uid, senior_reviewed_at: ctx.now.toISOString() };
    try {
      return await ctx.db.update('iso_requirements', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: existing.id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'returned', reason: note,
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
// "Approve section"/"Approve all": every proposed row among the given ids. Rows not currently
// 'proposed' (already approved, returned, or not assessed) are skipped, never failed as a batch —
// the same per-row-skip pattern as the old requirement.bulkSeniorReview.
defineOp('requirement.bulkApprove', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canApproveRequirement(ctx); },
  async validate(payload) {
    if (!Array.isArray(payload.ids) || !payload.ids.length) throw badRequest('Select at least one requirement.');
    if (payload.ids.length > 500) throw badRequest('Too many requirements selected at once.');
  },
  async run(ctx) {
    let updated = 0; const skipped = [];
    for (const id of ctx.payload.ids) {
      const existing = await ctx.db.get('iso_requirements', id);
      if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) continue;
      if (existing.approval_state !== 'proposed') { skipped.push({ id, reason: existing.approval_state === 'approved' ? 'Already approved.' : existing.approval_state === 'returned' ? 'Returned — not proposed.' : 'Not assessed yet.' }); continue; }
      const why = basisProblem(existing);
      if (why) { skipped.push({ id, reason: why }); continue; }
      const patch = approvedPatch(ctx, existing.compliance_status);
      await ctx.db.update('iso_requirements', id, patch, existing.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'approved', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      updated++;
    }
    return { updated, skipped };
  },
});

defineOp('requirement.seniorReview', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canSeniorReview(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A requirement id is required.');
    if (!SENIOR_REVIEW_STATUSES.includes(payload.status)) throw badRequest('Invalid senior review status.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (payload.status === 'redo' && !isNonEmptyText(payload.note, 2000)) throw badRequest('Say what needs redoing — the assessor sees this note.');
    if (payload.note != null && String(payload.note).length > 2000) throw badRequest('The note is too long (2000 characters at most).');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_requirements', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) throw notFound('Requirement not found.');
    const status = ctx.payload.status;
    if (SENIOR_VERDICTS.includes(status)) { const why = seniorVerdictBlocker(ctx, existing, status); if (why) throw (why.own ? forbidden(why.message) : badRequest(why.message)); }
    const patch = seniorReviewPatch(ctx, status, ctx.payload.note);
    try {
      return await ctx.db.update('iso_requirements', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: existing.id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'senior_review_' + status, reason: patch.senior_review_note,
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
// Accept each row's suggested verdict (or reset) many at once from the register's selection bar. Rows
// this caller may not give a verdict on are skipped with the reason, never failed as a batch.
defineOp('requirement.bulkSeniorReview', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canSeniorReview(ctx); },
  async validate(payload) {
    if (!Array.isArray(payload.ids) || !payload.ids.length) throw badRequest('Select at least one requirement.');
    if (payload.ids.length > 500) throw badRequest('Too many requirements selected at once.');
    if (!['suggested', 'pending'].includes(payload.status)) throw badRequest('In bulk a senior review can accept the suggested verdicts or reset — send back one at a time, with its note.');
  },
  async run(ctx) {
    const status = ctx.payload.status;
    let updated = 0, unchanged = 0; const skipped = [];
    for (const id of ctx.payload.ids) {
      const existing = await ctx.db.get('iso_requirements', id);
      if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) continue;
      const target = status === 'suggested' ? suggestedVerdict(existing) : 'pending';
      if (status === 'suggested') {
        const why = seniorVerdictBlocker(ctx, existing, target);
        if (why || !target) { skipped.push({ id, reason: why ? why.message : 'No verdict to suggest yet.' }); continue; }
      }
      if ((existing.senior_review_status || 'pending') === target) { unchanged++; continue; }
      await ctx.db.update('iso_requirements', id, seniorReviewPatch(ctx, target, null), existing.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'senior_review_' + target, source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      updated++;
    }
    return { updated, unchanged, skipped };
  },
});

// ── relationship.* (plan 6.5) ───────────────────────────────────────────────────────────────────
defineOp('relationship.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const [rels, reqs] = await Promise.all([
      ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] }),
      ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }),
    ]);
    // Both ends' clause and wording travel with each relationship, so the drawer never depends on
    // the register happening to have the other requirement loaded — since 9.5 the register is often
    // filtered (a dashboard click, one standard), and the drawer used to fall back to the raw id.
    const brief = new Map(reqs.map(r => [r.id, { id: r.id, standard_code: r.standard_code, clause: r.clause, clause_name: r.clause_name, requirement_text: r.requirement_text }]));
    return rels.map(r => ({ ...r, from: brief.get(r.from_id) || null, to: brief.get(r.to_id) || null }));
  },
});

defineOp('relationship.suggest', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async run(ctx) {
    const requirements = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    const existing = await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const existingPairKeys = existing.map(r => (r.from_id < r.to_id ? r.from_id + '|' + r.to_id : r.to_id + '|' + r.from_id));
    const reqIds = new Set(requirements.map(r => r.id));
    let actionLinks = [];
    const actions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    for (const a of actions) {
      const links = await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: a.id }, { field: 'target_type', op: 'eq', value: 'requirement' }] });
      actionLinks.push(...links.filter(l => l.link_state !== 'rejected' && reqIds.has(l.target_id)));
    }
    const candidates = suggestRelationships({ requirements, topicMap: loadTopicMap(), actionLinks, existingPairKeys });
    const created = [];
    for (const c of candidates) {
      created.push(await ctx.db.insert('iso_relationships', {
        id: uid('irel_'), audit_id: ctx.audit.id, from_id: c.fromId, to_id: c.toId, kind: c.kind,
        state: 'suggested', reason_code: c.reasonCode, reason_text: c.reasonText, source: 'rule',
      }));
    }
    return { created: created.length };
  },
});

defineOp('relationship.decide', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A relationship id is required.');
    if (!['confirmed', 'rejected'].includes(payload.decision)) throw badRequest('Invalid decision.');
  },
  async run(ctx) {
    const rel = await ctx.db.get('iso_relationships', ctx.payload.id);
    if (!rel || rel.audit_id !== ctx.audit.id) throw notFound('Relationship not found.');
    if (rel.state !== 'suggested') throw badRequest('Only a suggested relationship can be decided.');
    const updated = await ctx.db.patchRow('iso_relationships', rel.id, {
      state: ctx.payload.decision, decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
      reason_code: ctx.payload.reasonCode || rel.reason_code, reason_text: ctx.payload.reasonText || rel.reason_text,
    });
    // Plan 8b.1: a confirmed relationship now carries evidence suggestions (D21), so who decided it
    // and when belongs in both requirements' activity, not just on the relationship row.
    await logRelationshipActivity(ctx, updated, 'relationship_' + ctx.payload.decision);
    return updated;
  },
});

async function logRelationshipActivity(ctx, rel, action) {
  for (const reqId of [rel.from_id, rel.to_id]) {
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: reqId,
      action, source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { relationshipId: rel.id, fromId: rel.from_id, toId: rel.to_id, kind: rel.kind, state: rel.state },
    });
  }
}

// guidance.list — plan 8b.3: staff-only (internal guidance, D25). Keyed by requirement id.
defineOp('guidance.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const requirements = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const versionById = {}, libReqById = {};
    for (const as of auditStandards) {
      const v = await ctx.db.get('iso_standard_versions', as.version_id);
      if (!v) continue;
      versionById[v.id] = v;
      for (const lr of await ctx.db.list('iso_library_requirements', { where: [{ field: 'version_id', op: 'eq', value: v.id }] })) libReqById[lr.id] = lr;
    }
    const rel = libraryRelease(ctx.audit); // B3.1: the board's own release
    return buildGuidance({ requirements, libReqById, versionById, guidanceSeeds: GUIDANCE_SEEDS, librarySeeds: rel.librarySeeds, docByClause: rel.docByClause });
  },
});

// relationship.add — plan 8b.1 (R11): a user-defined relationship, saved as confirmed because a person
// made it. `mapping` stays rule-made only. A reason is required, so every relationship explains itself.
// A pair that already has a suggested or confirmed relationship is refused (confirm the suggestion
// instead); a pair whose only relationship was rejected can be related on purpose.
const MANUAL_RELATIONSHIP_KINDS = ['same_requirement', 'integrated_topic', 'shared_evidence', 'supporting'];
defineOp('relationship.add', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.fromId) || !isValidId(payload.toId)) throw badRequest('Two requirements are required.');
    if (payload.fromId === payload.toId) throw badRequest('A requirement cannot be related to itself.');
    if (!MANUAL_RELATIONSHIP_KINDS.includes(payload.kind)) throw badRequest('Invalid relationship type.');
    if (!isNonEmptyText(payload.reasonText, 1000)) throw badRequest('Say why these requirements are related.');
  },
  async run(ctx) {
    const a = await ctx.db.get('iso_requirements', ctx.payload.fromId);
    const b = await ctx.db.get('iso_requirements', ctx.payload.toId);
    if (!a || !b || a.audit_id !== ctx.audit.id || b.audit_id !== ctx.audit.id || a.archived_at || b.archived_at) throw badRequest('Both requirements must be on this audit.');
    const existing = await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const clash = existing.find(r => r.state !== 'rejected' && ((r.from_id === a.id && r.to_id === b.id) || (r.from_id === b.id && r.to_id === a.id)));
    if (clash) throw badRequest(clash.state === 'suggested' ? 'These requirements already have a suggested relationship — confirm it instead.' : 'These requirements are already related.');
    const rel = await ctx.db.insert('iso_relationships', {
      id: uid('irel_'), audit_id: ctx.audit.id, from_id: a.id, to_id: b.id, kind: ctx.payload.kind, state: 'confirmed',
      reason_code: 'manual', reason_text: ctx.payload.reasonText.trim(), source: 'manual',
      decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
    });
    await logRelationshipActivity(ctx, rel, 'relationship_added');
    return rel;
  },
});

// ── relationship.library* (R3, D35 P6) ──────────────────────────────────────────────────────────
// Column P's 407 cross-standard pairs ship with the library itself (LIBRARY_REL_BY_CLAUSE) — no
// per-board "Suggest relationships" step for these. relationship.library computes them live against
// this board's own requirement rows; nothing is stored for the default (shown) case, so a board
// never gets 407 real iso_relationships rows just for opening the register. A row is only ever
// written here to remember that a user rejected one pair for this board (kind:'library',
// source:'library') — state 'rejected' hides it, state 'confirmed' means a rejection was undone.
defineOp('relationship.library', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    const byClauseKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
    const libraryRows = (await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'source', op: 'eq', value: 'library' }] }))
      .filter(r => r.state === 'rejected');
    const rejectedPairKeys = new Set(libraryRows.map(r => (r.from_id < r.to_id ? r.from_id + '|' + r.to_id : r.to_id + '|' + r.from_id)));
    const out = {};
    for (const r of reqs) {
      const peers = libraryRelease(ctx.audit).relByClause.get(r.standard_code + ' ' + r.clause); // B3.1
      if (!peers) continue;
      const related = [];
      for (const peerKey of peers) {
        const peerReq = byClauseKey.get(peerKey);
        if (!peerReq || peerReq.id === r.id) continue;
        const pairKey = r.id < peerReq.id ? r.id + '|' + peerReq.id : peerReq.id + '|' + r.id;
        related.push({
          requirementId: peerReq.id, standardCode: peerReq.standard_code, clause: peerReq.clause,
          clauseName: peerReq.clause_name, complianceStatus: peerReq.compliance_status,
          rejected: rejectedPairKeys.has(pairKey),
        });
      }
      if (related.length) {
        related.sort((a, b) => a.standardCode !== b.standardCode ? a.standardCode.localeCompare(b.standardCode) : a.clause.localeCompare(b.clause, undefined, { numeric: true }));
        out[r.id] = related;
      }
    }
    return out;
  },
});

async function findLibraryRelationshipRow(ctx, aId, bId) {
  const rows = await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'source', op: 'eq', value: 'library' }] });
  return rows.find(r => (r.from_id === aId && r.to_id === bId) || (r.from_id === bId && r.to_id === aId)) || null;
}

defineOp('relationship.rejectLibrary', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.fromId) || !isValidId(payload.toId)) throw badRequest('Two requirements are required.');
    if (payload.fromId === payload.toId) throw badRequest('A requirement cannot be related to itself.');
  },
  async run(ctx) {
    const a = await ctx.db.get('iso_requirements', ctx.payload.fromId);
    const b = await ctx.db.get('iso_requirements', ctx.payload.toId);
    if (!a || !b || a.audit_id !== ctx.audit.id || b.audit_id !== ctx.audit.id) throw badRequest('Both requirements must be on this audit.');
    const row = await findLibraryRelationshipRow(ctx, a.id, b.id);
    if (row) return ctx.db.patchRow('iso_relationships', row.id, { state: 'rejected', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString() });
    return ctx.db.insert('iso_relationships', {
      id: uid('irel_'), audit_id: ctx.audit.id, from_id: a.id, to_id: b.id, kind: 'library', state: 'rejected',
      reason_code: 'library_hidden', reason_text: null, source: 'library', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
    });
  },
});

defineOp('relationship.unrejectLibrary', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.fromId) || !isValidId(payload.toId)) throw badRequest('Two requirements are required.');
  },
  async run(ctx) {
    const row = await findLibraryRelationshipRow(ctx, ctx.payload.fromId, ctx.payload.toId);
    if (!row || row.state !== 'rejected') return { unchanged: true };
    return ctx.db.patchRow('iso_relationships', row.id, { state: 'confirmed', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString() });
  },
});

// relationship.applyToRelated — R3 (D35 P6, proposal §4 "Apply to related"): copies the source
// clause's compliance_status/current_system/recommended_action onto selected related clauses in
// one call. Each target still goes through applyComplianceStatusPatch (same approval/derive-on-write
// rules as a normal edit — Q7 deliberately keeps this a real per-clause save, not a status stamp).
// D47: confirming a derived (Apply to related) status on its own clause. Clears the mark; the Lead
// (or sole auditor) approves it there and then when the basis is complete, anyone else leaves it
// proposed for the Lead — the normal approval rules from that point.
defineOp('requirement.confirmDerived', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canAssessRequirement(ctx); },
  async validate(payload) {
    if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 500 || payload.ids.some(id => !isValidId(id))) throw badRequest('Choose the clauses to confirm.');
  },
  async run(ctx) {
    const confirmed = [], skipped = [];
    for (const id of new Set(ctx.payload.ids)) {
      const existing = await ctx.db.get('iso_requirements', id);
      if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) { skipped.push({ id, reason: 'not found' }); continue; }
      if (!existing.derived_from_id) { skipped.push({ id, reason: 'Not derived.' }); continue; }
      const patch = { derived_from_id: null, derived_at: null };
      const post = Object.assign({}, existing, patch);
      if (isEffectiveLeadAuditor(ctx) && post.compliance_status !== 'not_assessed' && !basisProblem(post)) Object.assign(patch, approvedPatch(ctx, post.compliance_status));
      await ctx.db.update('iso_requirements', id, patch, existing.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'derived_confirmed', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      confirmed.push(id);
    }
    return { confirmed, skipped };
  },
});

defineOp('relationship.applyToRelated', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canAssessRequirement(ctx); },
  async validate(payload) {
    if (!isValidId(payload.fromId)) throw badRequest('A source clause is required.');
    if (!Array.isArray(payload.toIds) || !payload.toIds.length || payload.toIds.some(id => !isValidId(id))) throw badRequest('At least one related clause is required.');
    if (payload.offeredIds != null && (!Array.isArray(payload.offeredIds) || payload.offeredIds.length > 200 || payload.offeredIds.some(id => !isValidId(id)))) throw badRequest('Invalid related clauses.');
  },
  async run(ctx) {
    const source = await ctx.db.get('iso_requirements', ctx.payload.fromId);
    if (!source || source.audit_id !== ctx.audit.id) throw notFound('Requirement not found.');
    // D47: the source's answer is copied as a PROPOSAL — derived_from_id marks it, and it stays
    // proposed for everyone (Lead and sole auditor included) until someone confirms it on the target.
    const nowIso = ctx.now.toISOString();
    const basePatch = { compliance_status: source.compliance_status, current_system: source.current_system, recommended_action: source.recommended_action,
      gap_reason: source.gap_reason || null, ofi: !!source.ofi, ofi_note: source.ofi_note || null, derived_from_id: source.id, derived_at: nowIso };
    if (source.compliance_status === 'not_applicable' || source.compliance_status === 'out_of_scope') basePatch.na_justification = source.na_justification;
    // The source's live documents go across too (D47) — not superseded / rejected / insufficient.
    const srcLinks = (await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }, { field: 'target_id', op: 'eq', value: source.id }] }))
      .filter(l => !DEAD_LINK_STATUSES.includes(l.review_status) && l.review_status !== 'insufficient');
    const srcEvidence = [];
    for (const l of srcLinks) { const e = await ctx.db.get('iso_evidence', l.evidence_id); if (e && !e.archived_at && !e.superseded_by) srcEvidence.push(e); }
    let documentsLinked = 0;
    const applied = [], skipped = [];
    for (const id of new Set(ctx.payload.toIds)) {
      if (id === source.id) continue;
      const existing = await ctx.db.get('iso_requirements', id);
      if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) { skipped.push({ id, reason: 'not found' }); continue; }
      const rowPatch = Object.assign({}, basePatch);
      validateRequirementPatch(existing, rowPatch);
      seniorReviewReset(existing, rowPatch);
      applyComplianceStatusPatch(ctx, existing, rowPatch);
      if (rowPatch.compliance_status && rowPatch.compliance_status !== 'not_assessed') Object.assign(rowPatch, PROPOSED_PATCH, { assessed_by: ctx.caller.uid, assessed_at: nowIso });
      const updated = await ctx.db.update('iso_requirements', id, rowPatch, existing.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: id,
        entity_ref: `${existing.standard_code} ${existing.clause}`, action: 'applied_from_related', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      applied.push(updated.id);
      const have = new Set((await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }, { field: 'target_id', op: 'eq', value: id }] })).map(l => l.evidence_id));
      for (const e of srcEvidence) {
        if (have.has(e.id)) continue;
        const link = await ctx.db.insert('iso_evidence_links', {
          id: uid('ievl_'), evidence_id: e.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
          target_type: 'requirement', target_id: id, role: 'primary', relevance_note: null,
          review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
        });
        await logEvidenceLinked(ctx, e, link);
        documentsLinked++;
      }
    }
    // Learning signal (release-1 B3.4 footprint): which related clauses were offered, applied, unticked.
    const offered = [...new Set(ctx.payload.offeredIds || ctx.payload.toIds)];
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: source.id,
      entity_ref: `${source.standard_code} ${source.clause}`, action: 'related_applied', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { offered, applied, unticked: offered.filter(x => !ctx.payload.toIds.includes(x)), documentsLinked },
    });
    return { applied, skipped, documentsLinked };
  },
});

// ── clientUser.list ──────────────────────────────────────────────────────────────────────────────
defineOp('clientUser.list', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) { if (!isValidId(payload.clientId)) throw badRequest('A client is required.'); },
  async run(ctx) { return ctx.listClientUsers(ctx.payload.clientId); },
});

// ── activity.list — visibility-filtered on read (plan §6.3) ────────────────────────────────────
defineOp('activity.list', {
  scope: 'audit', clientProjection: 'activity',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    let rows = await ctx.db.list('iso_activity', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }], order: 'at desc', limit: 500 });
    if (ctx.caller.kind === 'client' || ctx.caller.restricted) {
      // Internal-only fields never reach a client or a restricted staff member (plan §6.3, §4.3).
      const INTERNAL_FIELDS = new Set(['interview_notes', 'auditor_observations', 'internal_notes', 'verification_notes', 'auditor_review_note']);
      rows = rows.filter(r => !INTERNAL_FIELDS.has(r.field)).map(r => ({ ...r, before: null, after: null, reason: ctx.caller.kind === 'client' ? null : r.reason }));
    }
    return rows;
  },
});

// ── comment.* ────────────────────────────────────────────────────────────────────────────────────
defineOp('comment.list', {
  scope: 'audit', clientProjection: 'comment',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    let rows = await ctx.db.list('iso_comments', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
    if (ctx.caller.kind === 'client') rows = rows.filter(c => c.visibility === 'client_all');
    return rows;
  },
});
defineOp('comment.add', {
  scope: 'audit', clientProjection: 'comment',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) {
    if (!isNonEmptyText(payload.body, 5000)) throw badRequest('A comment body is required.');
    if (!isValidId(payload.entityType) || !isValidId(payload.entityId)) throw badRequest('Invalid comment target.');
  },
  async run(ctx) {
    // Comment visibility for a client author is always client_all (plan §4.1 "the server sets...
    // comment visibility (client for client authors)") — never trust the payload for this.
    const visibility = ctx.caller.kind === 'client' ? 'client_all' : 'internal';
    return ctx.db.insert('iso_comments', {
      id: uid('icmt_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: ctx.payload.entityType,
      entity_id: ctx.payload.entityId, body: ctx.payload.body, visibility, author_uid: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'comment', entity_id: ctx.payload.entityId,
      action: 'commented', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});

// ── finding.* (plan Phase 7.2) ──────────────────────────────────────────────────────────────────
// A finding is always created from a requirement, which it pre-links (iso_finding_requirements) —
// never a bare, unlinked record. A client caller never writes one, ever (same as requirements).
// Drafting/editing a finding's content is open to the same tier that assesses requirements
// (audit_manager/auditor/contributor); progressing its lifecycle (release/finalise/close/withdraw)
// is restricted to audit_manager/auditor. The plan's own §6.2 text only says "close (auditor)"
// explicitly — treating every lifecycle transition the same way is the more conservative reading
// (a formal sign-off action, not busy-work a contributor does alone), logged as A38.
function canManageFinding(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(ctx.membership.audit_role);
}
function canProgressFinding(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager', 'auditor'].includes(ctx.membership.audit_role);
}
// draft -> released_for_review -> final -> closed, or withdrawn from either open state. A finding
// that has reached final/closed is not withdrawable — retracting a finalised or closed finding
// needs its own reopen-style mechanism, which is out of this task's scope, not silently allowed
// here (least-destructive reading, logged as A38 alongside the permission-tier note above).
const FINDING_TRANSITIONS = {
  draft: ['released_for_review', 'withdrawn'],
  released_for_review: ['final', 'withdrawn'],
  final: ['closed'],
  // Release-1 B2.4 (Q7): the Lead reopens a closed finding with a reason (finding.reopen); a reopened
  // finding closes again under the same closure rule as a final one.
  closed: ['reopened'],
  reopened: ['closed'],
  withdrawn: [],
};
function isAllowedFindingTransition(from, to) { return (FINDING_TRANSITIONS[from] || []).includes(to); }
async function findingClassifications(ctx) {
  const cfg = await ctx.db.getConfig('finding_classifications');
  return (cfg && cfg.value) || ['major_nc', 'minor_nc', 'observation', 'ofi'];
}
const FINDING_WRITABLE_FIELDS = ['classification', 'title', 'statement', 'criteria', 'evidence_basis', 'visibility', 'visible_to_uids'];

defineOp('finding.list', {
  scope: 'audit', clientProjection: 'finding',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const findings = await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 });
    // Phase 7.4's requirement drawer needs "findings raised from this requirement" — a finding
    // always has exactly one source requirement (finding.create's own single insert into
    // iso_finding_requirements, never added to afterward), so attaching it here is cheap and is
    // the only way the client can see this fact at all; there is no other op that exposes it.
    // clientProjection strips this back out for a client caller (not in CLIENT_FIELDS.finding).
    if (findings.length) {
      const links = await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: findings.map(f => f.id) }] });
      const byFinding = new Map(links.map(l => [l.finding_id, l.requirement_id]));
      for (const f of findings) f.requirement_id = byFinding.get(f.id) || null;
      // D29: a finding's standard is its source requirement's (live requirements only, exactly as
      // _isoCalc.scopeInputsToStandard decides) — what the dashboard's standard filter matches.
      const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
      const stdByReq = new Map(reqs.map(r => [r.id, r.standard_code]));
      for (const f of findings) f.standard_code = stdByReq.get(f.requirement_id) || null;
    }
    // Plan §7 (Phase 9.2): the same `{filter}` shape requirement.list already takes, so a dashboard
    // number for findings (by classification, open) can link to exactly the rows it counted.
    if (ctx.payload.filter) {
      const tzConfig = await ctx.db.getConfig('timezone');
      return evaluateFilter(findings, ctx.payload.filter, { db: ctx.db, now: ctx.now, timezone: (tzConfig && tzConfig.value) || 'Australia/Perth' });
    }
    return findings;
  },
});

defineOp('finding.create', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageFinding(ctx); },
  async validate(payload, ctx) {
    if (!isValidId(payload.requirementId)) throw badRequest('A source requirement is required.');
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('A title is required.');
    const classes = await findingClassifications(ctx);
    if (!classes.includes(payload.classification)) throw badRequest('Invalid classification.');
  },
  async run(ctx) {
    const req = await ctx.db.get('iso_requirements', ctx.payload.requirementId);
    if (!req || req.audit_id !== ctx.audit.id || req.archived_at) throw badRequest('That requirement is not on this audit.');
    const finding = await ctx.db.insertNumbered('iso_findings', 'child', ctx.audit.id + ':F', {
      id: uid('ifnd_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      classification: ctx.payload.classification, title: ctx.payload.title,
      statement: ctx.payload.statement || null, criteria: ctx.payload.criteria || null,
      evidence_basis: ctx.payload.evidenceBasis || null, status: 'draft',
      visibility: ctx.payload.visibility || ctx.audit.default_visibility || 'internal',
      root_cause_required: ctx.payload.classification === 'major_nc',
      repeat_of_ref: await repeatOfRef(ctx, req),
      created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'finding', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    await ctx.db.insert('iso_finding_requirements', { finding_id: finding.id, requirement_id: req.id });
    return finding;
  },
});

defineOp('finding.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageFinding(ctx); },
  async validate(payload, ctx) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if ('classification' in (payload.patch || {})) {
      const classes = await findingClassifications(ctx);
      if (!classes.includes(payload.patch.classification)) throw badRequest('Invalid classification.');
    }
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_findings', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!FINDING_WRITABLE_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
      patch[k] = ctx.payload.patch[k];
    }
    // §6.2: "Changing major_nc -> anything lower requires a reason."
    if (existing.classification === 'major_nc' && patch.classification && patch.classification !== 'major_nc') {
      requireReason(ctx.payload.reason, 'downgrade a major nonconformity');
    }
    if ('classification' in patch) patch.root_cause_required = patch.classification === 'major_nc';
    // §6.3a: any visibility change after release needs a reason.
    if ('visibility' in patch && existing.released_at) requireReason(ctx.payload.reason, 'change visibility after release');
    try {
      return await ctx.db.update('iso_findings', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'finding', entity_id: existing.id,
        entity_ref: existing.ref, action: 'updated', reason: ctx.payload.reason || null, source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// One op per lifecycle transition (release/finalize/close/withdraw) rather than a single generic
// finding.transition(to) — matches the plan's own naming ("release for review, finalise, close,
// withdraw" as four distinct verbs) and lets each carry its own extra fields (released_at/by,
// closed_at/by) without a payload-shaped branch inside one op.
function findingTransitionOp(name, to, extraPatch) {
  defineOp(name, {
    scope: 'audit', clientProjection: null,
    allow: canProgressFinding,
    async validate(payload) { if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.'); },
    async run(ctx) {
      const existing = await ctx.db.get('iso_findings', ctx.payload.id);
      if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
      if (!isAllowedFindingTransition(existing.status, to)) throw badRequest(`Cannot move a finding from ${existing.status} to ${to}.`);
      if (to === 'closed') { const why = await findingClosureProblem(ctx, existing); if (why) throw badRequest(why); }
      try {
        // db.transition() is the dedicated primitive (plan §4.4) — for Supabase this calls the
        // matching iso_release_finding/iso_finalize_finding/iso_close_finding/iso_withdraw_finding
        // RPC (never the generic iso_update_row a plain patch would use); for offline it applies
        // the from-check, the extra columns and the expectedVersion check in one place.
        return await ctx.db.transition('iso_findings', existing.id, 'status', existing.status, to, {
          audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'finding', entity_id: existing.id,
          entity_ref: existing.ref, action: to, source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
        }, { expectedVersion: ctx.payload.expectedVersion, extra: extraPatch ? extraPatch(ctx) : {} });
      } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
    },
  });
}
findingTransitionOp('finding.release', 'released_for_review', ctx => ({ released_at: ctx.now.toISOString(), released_by: ctx.caller.uid }));
findingTransitionOp('finding.finalize', 'final');
findingTransitionOp('finding.close', 'closed', ctx => ({ closed_at: ctx.now.toISOString(), closed_by: ctx.caller.uid }));
findingTransitionOp('finding.withdraw', 'withdrawn');

// Release-1 B2.3 (D50, Q7): a finding closes only when every action linked to it is closed AND
// verified effective — nothing closes because a box was ticked. The refusal names the blockers.
async function findingClosureProblem(ctx, finding) {
  const links = await ctx.db.list('iso_action_links', { where: [{ field: 'target_type', op: 'eq', value: 'finding' }, { field: 'target_id', op: 'eq', value: finding.id }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
  const blocking = [];
  for (const l of links) {
    const a = await ctx.db.get('iso_actions', l.action_id);
    if (!a || a.archived_at) continue;
    if (a.status === 'closed' && a.verification_status === 'effective') continue;
    blocking.push(`${a.ref} (${a.status === 'closed' ? 'not verified effective' : String(a.status).replace(/_/g, ' ')})`);
  }
  return blocking.length ? `This finding can't close until its actions are closed and verified effective: ${blocking.join(', ')}.` : null;
}

// Release-1 B2.5: a finding on a clause that had a finding, or was Non-Compliant, on an earlier board
// in the client's chain (previous_audit_id, newest first) is a repeat — stamped
// "<earlier board ref> / <its finding ref>" (or "/ ISO <std> <clause>" when it was a status only).
// Matched by standard + clause, narrowed to the same stable key when the earlier board has it.
async function repeatOfRef(ctx, req) {
  let prevId = ctx.audit.previous_audit_id, hops = 0;
  while (prevId && hops++ < 20) {
    const prev = await ctx.db.get('iso_audits', prevId);
    if (!prev) break;
    const rows = (await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: prev.id }, { field: 'standard_code', op: 'eq', value: req.standard_code }, { field: 'clause', op: 'eq', value: req.clause }] })).filter(r => !r.archived_at);
    const same = req.stable_key ? rows.filter(r => r.stable_key === req.stable_key) : [];
    const matches = same.length ? same : rows;
    if (matches.length) {
      const links = await ctx.db.list('iso_finding_requirements', { where: [{ field: 'requirement_id', op: 'in', value: matches.map(r => r.id) }] });
      for (const l of links) {
        const f = await ctx.db.get('iso_findings', l.finding_id);
        if (f && !f.archived_at && f.status !== 'withdrawn') return `${prev.ref} / ${f.ref}`;
      }
      if (matches.some(r => r.compliance_status === 'non_compliant')) return `${prev.ref} / ISO ${req.standard_code} ${req.clause}`;
    }
    prevId = prev.previous_audit_id;
  }
  return null;
}

// Release-1 B2.4 (Q7): only the Lead (or an admin) reopens a closed finding, with one of the action
// reopen reasons. closed -> reopened, reopened_count + 1, the reason kept on the row and in history.
defineOp('finding.reopen', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && (ctx.caller.role === 'admin' || ctx.membership.audit_role === 'lead_auditor'); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (!ACTION_REOPEN_REASONS.includes(payload.reasonCode)) throw badRequest('Invalid reopen reason.');
    if (payload.reasonText != null && (typeof payload.reasonText !== 'string' || payload.reasonText.length > 2000)) throw badRequest('Invalid reason text.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_findings', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id || existing.archived_at) throw notFound();
    if (!isAllowedFindingTransition(existing.status, 'reopened')) throw badRequest('Only a closed finding can be reopened.');
    const reasonText = ctx.payload.reasonText ? ctx.payload.reasonText.trim() : null;
    try {
      return await ctx.db.reopenFinding(existing.id, ctx.payload.reasonCode, reasonText, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'finding', entity_id: existing.id,
        entity_ref: existing.ref, action: 'reopened', field: 'status',
        reason: ctx.payload.reasonCode + (reasonText ? `: ${reasonText}` : ''),
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// ── action.* (plan Phase 7.3 — slice 1: create/update/list/link/unlink + core status workflow.
// Slice 2 (this one): action.verify/action.reopen, calling the dedicated db.verifyAction()/
// reopenAction() adapter methods (iso_verify_action/iso_reopen_action) rather than db.transition(),
// since verify sets 4 columns at once with a conditional status change and reopen gates on a
// from-status SET plus a required reason — neither fits transition()'s (column,from,to) shape, same
// reasoning as A21/A26's `updateMember`/`patchRow`. Subtasks/reviews/extensions
// (iso_action_subtasks/iso_action_reviews/iso_action_extensions) are still not in this slice —
// logged in the plan's RESUME HERE note, not silently dropped.) ──────────────────────────────────
// Day-to-day action work (create, edit CAPA fields, move through the ordinary workflow) is open to
// the same tier as findings (contributor+); moving an action to verified/closed specifically needs
// the audit_manager, or an auditor holding can_verify (plan §6.2's own wording), mirroring findings'
// canManageFinding/canProgressFinding split (A38) one level more precisely since the plan is
// explicit here about the `can_verify` flag rather than the role alone.
function canManageAction(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(ctx.membership.audit_role);
}
function canVerifyAction(ctx) {
  return ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || (ctx.membership.audit_role === 'auditor' && !!ctx.membership.can_verify);
}
const ACTION_WRITABLE_FIELDS = [
  'title', 'description', 'owner_uid', 'start_date', 'due_date', 'priority', 'risk_rating',
  'progress', 'verification_requirements', 'client_response', 'auditor_review_note', 'correction', 'containment',
  'root_cause_method', 'five_whys', 'fishbone', 'cause_tree', 'contributing_factors', 'cause_categories',
  'root_cause_summary', 'corrective_action', 'preventive_action', 'effectiveness_check', 'effectiveness_review_date',
  'visibility', 'visible_to_uids',
];
// A client may write exactly one field on an action, and only through this same op (plan §5/§14 —
// 009's own column comment: "client_response ... writable by the client owner/client_admin while
// assigned..more_info_required"). Everything else on ACTION_WRITABLE_FIELDS, including
// auditor_review_note (already in NEVER_TO_CLIENT — a client must never even READ it, let alone
// write it), stays staff-only via canManageAction.
const CLIENT_WRITABLE_ACTION_FIELDS = ['client_response'];
const CLIENT_RESPONDABLE_ACTION_STATUSES = ['assigned', 'in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required'];
const ROOT_CAUSE_METHODS = ['none', 'five_whys', 'fishbone', 'cause_tree', 'other'];
const ACTION_PRIORITIES = ['low', 'med', 'high', 'crit'];
const ACTION_RISK_RATINGS = ['low', 'medium', 'high', 'critical'];
// A cause-and-effect tree (plan §14 "indented outline: add child, add sibling, mark root") is
// stored as a flat array of {id, parentId, text} — cheaper to validate and diff than a nested
// structure, and the client-side outline UI (Phase 7.4) can still render it as a tree from a flat
// parent-pointer list. Cycle check: a valid tree's longest possible parent-chain is bounded by its
// own node count, so any walk that exceeds that bound proves a cycle exists (pigeonhole), without
// needing a separate visited-set per node.
function causeTreeHasCycle(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return false;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const limit = nodes.length + 1;
  for (const start of nodes) {
    let cur = start, steps = 0;
    while (cur && cur.parentId != null) {
      cur = byId.get(cur.parentId);
      steps++;
      if (steps > limit) return true;
    }
  }
  return false;
}
// §6.2's major-NC gate, mirrored from (and stricter than) iso_transition_action's own SQL check —
// the SQL only checks length/method/categories (a defensible minimum a raw constraint could also
// enforce); "reject a generic cause" needs real string normalisation the SQL layer isn't suited to,
// so it lives here as the actual enforcement, with the SQL as a coarser backstop.
const GENERIC_ROOT_CAUSES = new Set(['human error', 'operator error', 'staff error', 'mistake', 'forgot']);
function isGenericRootCause(text) {
  return GENERIC_ROOT_CAUSES.has(String(text || '').toLowerCase().trim().replace(/[.!]+$/, ''));
}
function majorNcRootCauseGate(action, linkedFindings) {
  if (!linkedFindings.some(f => f.classification === 'major_nc')) return null;
  const summary = (action.root_cause_summary || '').trim();
  if (summary.length < 40) return 'A major nonconformity needs a real root cause summary (at least 40 characters) before verification.';
  if (isGenericRootCause(summary)) return 'A major nonconformity\'s root cause cannot be a generic phrase like "human error" — describe the actual underlying cause.';
  if (!action.root_cause_method || action.root_cause_method === 'none') return 'A major nonconformity needs a root cause method selected before verification.';
  if (!(action.cause_categories || []).length) return 'A major nonconformity needs at least one cause category before verification.';
  return null;
}
async function linkedFindingsFor(ctx, actionId) {
  const links = await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: actionId }, { field: 'target_type', op: 'eq', value: 'finding' }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
  const out = [];
  for (const l of links) { const f = await ctx.db.get('iso_findings', l.target_id); if (f) out.push(f); }
  return out;
}

defineOp('action.list', {
  scope: 'audit', clientProjection: 'action',
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const actions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 });
    // Phase 7.4's requirement drawer needs "actions linked to this requirement" — unlike a
    // finding's single source requirement, an action can be linked to several findings/
    // requirements (action.link/unlink, many-to-many) — so this is a real array, not a single id.
    // clientProjection strips this back out for a client caller (not in CLIENT_FIELDS.action).
    if (actions.length) {
      const links = await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: actions.map(a => a.id) }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
      const byAction = new Map();
      // The link's own id too — action.unlink takes it (the Action drawer's Coverage card removes links).
      for (const l of links) { if (!byAction.has(l.action_id)) byAction.set(l.action_id, []); byAction.get(l.action_id).push({ id: l.id, target_type: l.target_type, target_id: l.target_id }); }
      for (const a of actions) a.links = byAction.get(a.id) || [];
      // D29: every standard an action's confirmed links reach — directly, or through a linked live
      // finding's source requirement — resolved exactly as _isoCalc.scopeInputsToStandard does, so
      // the dashboard's `standard_codes contains` filter returns the same actions it counted.
      const [reqs, liveFindings] = await Promise.all([
        ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }),
        ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 }),
      ]);
      const findingLinks = liveFindings.length ? await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: liveFindings.map(f => f.id) }] }) : [];
      const reqIdsByFinding = new Map();
      for (const l of findingLinks) { if (!reqIdsByFinding.has(l.finding_id)) reqIdsByFinding.set(l.finding_id, []); reqIdsByFinding.get(l.finding_id).push(l.requirement_id); }
      const stdByReq = new Map(reqs.map(r => [r.id, r.standard_code]));
      for (const a of actions) {
        const codes = new Set();
        for (const l of a.links) {
          const reqIds = l.target_type === 'requirement' ? [l.target_id] : l.target_type === 'finding' ? (reqIdsByFinding.get(l.target_id) || []) : [];
          for (const rid of reqIds) { const code = stdByReq.get(rid); if (code) codes.add(code); }
        }
        a.standard_codes = [...codes].sort();
        a.is_shared = a.standard_codes.length >= 2; // 9.7: the dashboard's shared-actions filter
      }
    }
    // Plan §7 (Phase 9.2): the same `{filter}` shape requirement.list already takes, so a dashboard
    // number for actions (by status, overdue, verification) can link to exactly the rows it counted.
    if (ctx.payload.filter) {
      const tzConfig = await ctx.db.getConfig('timezone');
      return evaluateFilter(actions, ctx.payload.filter, { db: ctx.db, now: ctx.now, timezone: (tzConfig && tzConfig.value) || 'Australia/Perth' });
    }
    return actions;
  },
});

defineOp('action.create', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('A title is required.');
    if (!['finding', 'requirement'].includes(payload.targetType)) throw badRequest('An action must be created from a finding or a requirement.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid link target.');
  },
  async run(ctx) {
    const table = ctx.payload.targetType === 'finding' ? 'iso_findings' : 'iso_requirements';
    const target = await ctx.db.get(table, ctx.payload.targetId);
    if (!target || target.audit_id !== ctx.audit.id) throw badRequest(`That ${ctx.payload.targetType} is not on this audit.`);
    const action = await ctx.db.insertNumbered('iso_actions', 'child', ctx.audit.id + ':A', {
      id: uid('iact_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, title: ctx.payload.title,
      description: ctx.payload.description || null, owner_kind: ctx.payload.ownerKind === 'client' ? 'client' : 'etcher',
      owner_uid: ctx.payload.ownerUid || null, due_date: ctx.payload.dueDate || null,
      priority: ACTION_PRIORITIES.includes(ctx.payload.priority) ? ctx.payload.priority : null,
      // 009's column defaults (status/verification_status/progress/reopened_count) are Postgres-side
      // only — the offline store has no schema to fall back on, so every default that later logic
      // actually reads (status for isAllowedActionTransition, progress for avg_action_progress) is
      // set explicitly here, the same way finding.create already does for iso_findings.
      status: 'draft', verification_status: 'not_verified', progress: 0, reopened_count: 0,
      visibility: ctx.payload.visibility || ctx.audit.default_visibility || 'internal',
      created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    await ctx.db.insert('iso_action_links', {
      id: uid('ial_'), action_id: action.id, target_type: ctx.payload.targetType, target_id: target.id,
      link_state: 'confirmed', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
    });
    return action;
  },
});

// ── action.trackPlan — release-1 B2.1 (D49, Q6) ─────────────────────────────────────────────────
// "Track this action" on an open clause (Partial / Non-Compliant / OFI with a plan) or a derived
// Actions row: one op creates the action and links it to every ticked clause; on a formal audit type
// it also raises a finding per clause (each keeps its own record under the shared action — findings
// are never merged because their action text matches). The finding's statement is the clause's
// basis, its criterion the requirement reference, its evidence basis the clause's live documents.
// A clause already linked to an open action can't be tracked again — there are never two records.
const FORMAL_AUDIT_TYPES = ['internal', 'surveillance', 'recertification', 'certification_prep', 'follow_up'];
const TRACK_STATUS_WORD = { non_compliant: 'Non-Compliant', partially_compliant: 'Partially Compliant', compliant: 'OFI' };
const TRACK_PRIORITY = { non_compliant: 'high', partially_compliant: 'med', compliant: 'low' };
function trackableProblem(r) {
  if (['non_compliant', 'partially_compliant'].includes(r.compliance_status) || (r.compliance_status === 'compliant' && r.ofi)) return null;
  return `ISO ${r.standard_code} ${r.clause} is not Partial, Non-Compliant or OFI.`;
}
defineOp('action.trackPlan', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canManageAction(ctx) && (!FORMAL_AUDIT_TYPES.includes(ctx.audit.audit_type) || canManageFinding(ctx)); },
  async validate(payload, ctx) {
    if (!Array.isArray(payload.requirementIds) || !payload.requirementIds.length || payload.requirementIds.length > 500 || !payload.requirementIds.every(isValidId)) throw badRequest('Pick at least one clause.');
    if (payload.title != null && !isNonEmptyText(payload.title, 300)) throw badRequest('Invalid title.');
    if (payload.ownerUid != null && !isValidId(payload.ownerUid)) throw badRequest('Invalid owner.');
    if (payload.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.dueDate))) throw badRequest('Invalid due date.');
    if (payload.priority != null && !ACTION_PRIORITIES.includes(payload.priority)) throw badRequest('Invalid priority.');
    if (FORMAL_AUDIT_TYPES.includes(ctx.audit.audit_type)) {
      if (!(await findingClassifications(ctx)).includes(payload.classification)) throw badRequest('Pick a classification — this audit type records a finding.');
    } else if (payload.classification != null) throw badRequest('This audit type tracks actions only — no finding classification.');
  },
  async run(ctx) {
    const reqs = [];
    for (const id of new Set(ctx.payload.requirementIds)) {
      const r = await ctx.db.get('iso_requirements', id);
      if (!r || r.audit_id !== ctx.audit.id || r.archived_at) throw badRequest('That clause is not on this audit.');
      const why = trackableProblem(r);
      if (why) throw badRequest(why);
      reqs.push(r);
    }
    const reqLinks = await ctx.db.list('iso_action_links', { where: [{ field: 'target_type', op: 'eq', value: 'requirement' }, { field: 'target_id', op: 'in', value: reqs.map(r => r.id) }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
    for (const l of reqLinks) {
      const a = await ctx.db.get('iso_actions', l.action_id);
      if (!a || a.archived_at || ACTION_CLOSED_STATUSES.includes(a.status)) continue;
      const r = reqs.find(x => x.id === l.target_id);
      throw badRequest(`ISO ${r.standard_code} ${r.clause} is already tracked by ${a.ref}.`);
    }
    const planned = reqs.map(r => String(r.recommended_action || '').trim()).find(Boolean) || '';
    const title = String(ctx.payload.title || planned).trim();
    if (!title) throw badRequest('Write the planned action first.');
    const worst = reqs.some(r => r.compliance_status === 'non_compliant') ? 'non_compliant' : reqs.some(r => r.compliance_status === 'partially_compliant') ? 'partially_compliant' : 'compliant';
    const caller = ctx.caller, nowIso = ctx.now.toISOString();
    const visibility = ctx.audit.default_visibility || 'internal';
    const action = await ctx.db.insertNumbered('iso_actions', 'child', ctx.audit.id + ':A', {
      id: uid('iact_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, title: title.slice(0, 300), description: null, owner_kind: 'etcher',
      owner_uid: ctx.payload.ownerUid || (reqs.find(r => r.responsible_uid) || {}).responsible_uid || null,
      due_date: ctx.payload.dueDate || reqs.map(r => r.target_date).filter(Boolean).sort()[0] || null,
      priority: ctx.payload.priority || TRACK_PRIORITY[worst],
      status: 'draft', verification_status: 'not_verified', progress: 0, reopened_count: 0, visibility,
      created_by: caller.uid, updated_by: caller.uid,
    }, { audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: null, action: 'created', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
    const link = (targetType, targetId) => ctx.db.insert('iso_action_links', { id: uid('ial_'), action_id: action.id, target_type: targetType, target_id: targetId, link_state: 'confirmed', decided_by: caller.uid, decided_at: nowIso });
    for (const r of reqs) await link('requirement', r.id);
    const findings = [];
    if (FORMAL_AUDIT_TYPES.includes(ctx.audit.audit_type)) {
      for (const r of reqs) {
        const evLinks = (await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }, { field: 'target_id', op: 'eq', value: r.id }] }))
          .filter(l => !DEAD_LINK_STATUSES.includes(l.review_status) && l.review_status !== 'insufficient');
        const docs = [];
        for (const l of evLinks) { const e = await ctx.db.get('iso_evidence', l.evidence_id); if (e && !e.archived_at && !e.superseded_by) docs.push(e.title + (e.version_label ? `, ${e.version_label}` : '')); }
        const ref = `ISO ${r.standard_code} ${r.clause}${r.clause_name ? ' ' + r.clause_name : ''}`;
        const f = await ctx.db.insertNumbered('iso_findings', 'child', ctx.audit.id + ':F', {
          id: uid('ifnd_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, classification: ctx.payload.classification,
          title: `${TRACK_STATUS_WORD[r.compliance_status === 'compliant' ? 'compliant' : r.compliance_status]} — ${ref}`.slice(0, 300),
          statement: String(r.current_system || '').trim() || null, criteria: ref, evidence_basis: docs.join('; ') || null, status: 'draft',
          visibility, root_cause_required: ctx.payload.classification === 'major_nc', repeat_of_ref: await repeatOfRef(ctx, r),
          created_by: caller.uid, updated_by: caller.uid,
        }, { audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'finding', entity_id: null, action: 'created', source: 'user', actor_uid: caller.uid, actor_kind: caller.kind });
        await ctx.db.insert('iso_finding_requirements', { finding_id: f.id, requirement_id: r.id });
        await link('finding', f.id);
        findings.push(f);
      }
    }
    return { action, findings };
  },
});

defineOp('action.update', {
  // clientProjection: 'action' (not null) — the one case a client caller can reach this op at all
  // is the client_response write below, so the response needs the same CLIENT_FIELDS projection
  // action.list/action.get already use, not the "a client must never see this op's shape" default.
  scope: 'audit', clientProjection: 'action',
  allow(ctx) {
    if (ctx.caller.kind === 'client') {
      // A client may touch exactly one field, and nothing else — checked here on the field NAMES
      // alone (cheap, sync); the row's own visibility/status eligibility is checked in run() once
      // the record is actually loaded (plan §14, 009's own client_response column comment).
      const keys = Object.keys(ctx.payload.patch || {});
      return keys.length > 0 && keys.every(k => CLIENT_WRITABLE_ACTION_FIELDS.includes(k));
    }
    return canManageAction(ctx);
  },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    const patch = payload.patch || {};
    if ('priority' in patch && patch.priority != null && !ACTION_PRIORITIES.includes(patch.priority)) throw badRequest('Invalid priority.');
    if ('risk_rating' in patch && patch.risk_rating != null && !ACTION_RISK_RATINGS.includes(patch.risk_rating)) throw badRequest('Invalid risk rating.');
    if ('root_cause_method' in patch && !ROOT_CAUSE_METHODS.includes(patch.root_cause_method)) throw badRequest('Invalid root cause method.');
    if ('five_whys' in patch && patch.five_whys != null && (!Array.isArray(patch.five_whys) || patch.five_whys.length > 5)) throw badRequest('5 Whys supports at most 5 why/answer pairs.');
    // A81: a JSONB column gets no type check from Postgres, so the shape is checked here — node ids
    // end up in the editor's markup, so they keep to the same alphabet as every other id.
    if ('cause_tree' in patch && patch.cause_tree != null && (!Array.isArray(patch.cause_tree) || patch.cause_tree.length > 200 || !patch.cause_tree.every(n => n && typeof n === 'object' && isValidId(n.id) && (n.parentId == null || isValidId(n.parentId)) && (n.text == null || (typeof n.text === 'string' && n.text.length <= 2000))))) throw badRequest('Invalid cause tree.');
    if ('cause_tree' in patch && causeTreeHasCycle(patch.cause_tree)) throw badRequest('The cause tree cannot contain a cycle.');
    
    if ('progress' in patch && (typeof patch.progress !== 'number' || patch.progress < 0 || patch.progress > 100)) throw badRequest('Progress must be between 0 and 100.');
    if ('client_response' in patch && typeof patch.client_response !== 'string') throw badRequest('client_response must be text.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_actions', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    if (ctx.caller.kind === 'client') {
      const visibleToThisClient = existing.visibility === 'client_all'
        || (existing.visibility === 'client_selected' && (existing.visible_to_uids || []).includes(ctx.caller.uid));
      if (!visibleToThisClient) throw notFound();
      if (!CLIENT_RESPONDABLE_ACTION_STATUSES.includes(existing.status)) throw forbidden('This action is not open for a client response right now.');
    }
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!ACTION_WRITABLE_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
      patch[k] = ctx.payload.patch[k];
    }
    // §6.3a rule 4: any due_date change on an overdue, still-open action needs a reason.
    const today = ctx.now.toISOString().slice(0, 10);
    if ('due_date' in patch && existing.due_date && existing.due_date < today && !ACTION_CLOSED_STATUSES.includes(existing.status)) {
      requireReason(ctx.payload.reason, 'change the due date on an overdue action');
    }
    if ('visibility' in patch) requireReason(ctx.payload.reason, 'change visibility'); // §6.3a rule 5 (release/issue concept doesn't apply to actions the same way — every visibility change is reasoned, not just post-release ones)
    try {
      return await ctx.db.update('iso_actions', existing.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: existing.id,
        entity_ref: existing.ref, action: 'updated', reason: ctx.payload.reason || null, source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

defineOp('action.link', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (!['finding', 'requirement'].includes(payload.targetType)) throw badRequest('Invalid link target type.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid link target.');
  },
  async run(ctx) {
    const action = await ctx.db.get('iso_actions', ctx.payload.actionId);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    const table = ctx.payload.targetType === 'finding' ? 'iso_findings' : 'iso_requirements';
    const target = await ctx.db.get(table, ctx.payload.targetId);
    if (!target || target.audit_id !== ctx.audit.id) throw badRequest(`That ${ctx.payload.targetType} is not on this audit.`);
    const existingLinks = await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: action.id }] });
    if (existingLinks.some(l => l.target_type === ctx.payload.targetType && l.target_id === target.id && l.link_state !== 'rejected')) {
      throw badRequest('Already linked.');
    }
    return ctx.db.insert('iso_action_links', {
      id: uid('ial_'), action_id: action.id, target_type: ctx.payload.targetType, target_id: target.id,
      link_state: 'confirmed', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: action.id,
      entity_ref: action.ref, action: 'linked', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});
defineOp('action.unlink', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async run(ctx) {
    const link = await ctx.db.get('iso_action_links', ctx.payload.linkId);
    if (!link) throw notFound();
    const action = await ctx.db.get('iso_actions', link.action_id);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    // iso_action_links has no row_version (same shape as iso_relationships) — patchRow, not
    // update(), the same primitive relationship.decide already uses for this exact kind of
    // link-state change; no activity entry, matching that same precedent (A21/A26 territory).
    return ctx.db.patchRow('iso_action_links', link.id, { link_state: 'rejected', decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString() });
  },
});

defineOp('action.updateStatus', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['verified', 'closed'].includes(ctx.payload.to) ? canVerifyAction(ctx) : canManageAction(ctx); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (!isNonEmptyText(payload.to, 40)) throw badRequest('A destination status is required.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_actions', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    const to = ctx.payload.to;
    if (!isAllowedActionTransition(existing.status, to)) throw badRequest(`Cannot move an action from ${existing.status} to ${to}.`);
    // A40, resolved: isAllowedActionTransition's from==='on_hold' branch only checks the coarse
    // shape (some resumable status); the exact destination must match on_hold_from_status, the
    // status this action was actually paused from — loaded here, not knowable to that pure
    // (from,to) function. Mirrors the majorNcRootCauseGate double-check pattern below.
    if (existing.status === 'on_hold' && to !== existing.on_hold_from_status) {
      throw badRequest(`An on-hold action can only resume to ${existing.on_hold_from_status || 'the status it was paused from'}.`);
    }
    // Major-NC gate (§6.2): cannot pass submitted_for_review without a real root cause, when this
    // action is linked to a major_nc finding. Checked here (not only in the SQL) for a clear
    // message, mirroring the same double-check pattern findings' isAllowedFindingTransition uses.
    if (existing.status === 'submitted_for_review' && to === 'ready_for_verification') {
      const gateMsg = majorNcRootCauseGate(existing, await linkedFindingsFor(ctx, existing.id));
      if (gateMsg) throw badRequest(gateMsg);
    }
    try {
      return await ctx.db.transition('iso_actions', existing.id, 'status', existing.status, to, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: existing.id,
        entity_ref: existing.ref, action: 'status_changed', reason: ctx.payload.reason || null, source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      }, {
        expectedVersion: ctx.payload.expectedVersion,
        // Only the offline adapter reads `extra` (Supabase goes through iso_transition_action's
        // own SQL, which sets/clears this column itself) — see api/_isoDbOffline.js's transition().
        extra: { on_hold_from_status: to === 'on_hold' ? existing.status : null },
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

const ACTION_VERIFICATION_RESULTS = ['effective', 'ineffective'];
// Plan §6.2's own allowed-reasons list for reopening a verified/closed action — the SQL side
// (iso_reopen_action) only checks p_reason_code is non-null, so this enumeration is enforced here,
// the same division of labour majorNcRootCauseGate already uses (SQL = coarse backstop, JS = real check).
const ACTION_REOPEN_REASONS = ['evidence_invalid', 'ineffective', 'recurred', 'connected_requirement_changed', 'later_audit_found', 'closed_in_error', 'other'];

defineOp('action.verify', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canVerifyAction(ctx); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (!ACTION_VERIFICATION_RESULTS.includes(payload.result)) throw badRequest('Invalid verification result.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_actions', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    // Mirrors iso_verify_action's own gate (009_iso_core.sql): only marking a major-NC-linked
    // action "effective" needs a real root cause on file — "ineffective" always sends it back to
    // in_progress regardless, so there's nothing to gate there.
    if (ctx.payload.result === 'effective') {
      const gateMsg = majorNcRootCauseGate(existing, await linkedFindingsFor(ctx, existing.id));
      if (gateMsg) throw badRequest(gateMsg);
    }
    try {
      return await ctx.db.verifyAction(existing.id, ctx.payload.result, ctx.payload.notes || null, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: existing.id,
        entity_ref: existing.ref, action: 'verified', field: 'verification_status', source: 'user',
        actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

defineOp('action.reopen', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canVerifyAction(ctx); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    if (!ACTION_REOPEN_REASONS.includes(payload.reasonCode)) throw badRequest('Invalid reopen reason.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_actions', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    if (!['verified', 'closed'].includes(existing.status)) throw badRequest('Only a verified or closed action can be reopened.');
    try {
      return await ctx.db.reopenAction(existing.id, ctx.payload.reasonCode, ctx.payload.reasonText || null, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: existing.id,
        entity_ref: existing.ref, action: 'reopened', field: 'status',
        reason: ctx.payload.reasonCode + (ctx.payload.reasonText ? `: ${ctx.payload.reasonText}` : ''),
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// ── subtask.* (plan §5 "subtask: add · update · archive") ──────────────────────────────────────
// Simple child rows of an action (iso_action_subtasks) — no numbering, no lifecycle beyond
// done/archived, no client visibility at all (not in CLIENT_FIELDS.action or any own allowlist —
// they're a working checklist for whoever owns the action, not a client-facing artifact; matches
// action.link/unlink's own clientProjection:null precedent for the same reason). Day-to-day tier
// (canManageAction), same as editing an action's other CAPA fields.
const SUBTASK_WRITABLE_FIELDS = ['title', 'owner_uid', 'due_date', 'done', 'sort_key'];
defineOp('subtask.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    return ctx.db.list('iso_action_subtasks', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
  },
});
defineOp('subtask.add', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('A title is required.');
    if (!isValidId(payload.actionId)) throw badRequest('An action is required.');
  },
  async run(ctx) {
    const action = await ctx.db.get('iso_actions', ctx.payload.actionId);
    if (!action || action.audit_id !== ctx.audit.id) throw badRequest('That action is not on this audit.');
    return ctx.db.insert('iso_action_subtasks', {
      id: uid('isub_'), action_id: action.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      title: ctx.payload.title, owner_uid: ctx.payload.ownerUid || null, due_date: ctx.payload.dueDate || null,
      done: false, sort_key: Number.isFinite(ctx.payload.sortKey) ? ctx.payload.sortKey : 0,
      created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    });
  },
});
defineOp('subtask.update', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    const patch = payload.patch || {};
    if ('title' in patch && !isNonEmptyText(patch.title, 300)) throw badRequest('A title is required.');
    if ('done' in patch && typeof patch.done !== 'boolean') throw badRequest('done must be true or false.');
  },
  async run(ctx) {
    const subtask = await ctx.db.get('iso_action_subtasks', ctx.payload.id);
    if (!subtask || subtask.audit_id !== ctx.audit.id) throw notFound();
    const patch = {};
    for (const k of Object.keys(ctx.payload.patch || {})) {
      if (!SUBTASK_WRITABLE_FIELDS.includes(k)) throw badRequest(`Field ${k} is not editable here.`);
      patch[k] = ctx.payload.patch[k];
    }
    try {
      return await ctx.db.update('iso_action_subtasks', subtask.id, patch, ctx.payload.expectedVersion, null);
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
defineOp('subtask.archive', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) { if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.'); },
  async run(ctx) {
    const subtask = await ctx.db.get('iso_action_subtasks', ctx.payload.id);
    if (!subtask || subtask.audit_id !== ctx.audit.id) throw notFound();
    try {
      return await ctx.db.update('iso_action_subtasks', subtask.id, { archived_at: ctx.now.toISOString() }, ctx.payload.expectedVersion, null);
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// ── action.submitForReview / action.decideReview (plan §5's own action.* naming — iso_action_reviews,
// submission_no incrementing per resubmission cycle) ────────────────────────────────────────────
// Neither table has a row_version (iso_action_reviews/iso_action_extensions) — patchRow for the
// decide half, same as relationship.decide's own precedent for a one-shot decision field.
const REVIEW_DECISIONS = ['accepted', 'rejected', 'more_info'];
defineOp('action.submitForReview', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const existing = await ctx.db.get('iso_actions', ctx.payload.id);
    if (!existing || existing.audit_id !== ctx.audit.id) throw notFound();
    if (!isAllowedActionTransition(existing.status, 'submitted_for_review')) throw badRequest(`Cannot submit for review from ${existing.status}.`);
    let updated;
    try {
      updated = await ctx.db.transition('iso_actions', existing.id, 'status', existing.status, 'submitted_for_review', {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: existing.id,
        entity_ref: existing.ref, action: 'status_changed', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      }, { expectedVersion: ctx.payload.expectedVersion });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
    const priorReviews = await ctx.db.list('iso_action_reviews', { where: [{ field: 'action_id', op: 'eq', value: existing.id }] });
    const submissionNo = priorReviews.reduce((max, r) => Math.max(max, r.submission_no), 0) + 1;
    const review = await ctx.db.insert('iso_action_reviews', {
      id: uid('irev_'), action_id: existing.id, submission_no: submissionNo, submitted_by: ctx.caller.uid,
      submission_note: ctx.payload.submissionNote || null,
    });
    return { action: updated, review };
  },
});
defineOp('review.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) { if (!isValidId(payload.actionId)) throw badRequest('An action is required.'); },
  async run(ctx) {
    const action = await ctx.db.get('iso_actions', ctx.payload.actionId);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    // iso_action_reviews has no audit_id/client_id column of its own (child of an action only) —
    // scoped by actionId, verified against this audit above, rather than a direct where-filter.
    return ctx.db.list('iso_action_reviews', { where: [{ field: 'action_id', op: 'eq', value: action.id }] });
  },
});
defineOp('action.decideReview', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canVerifyAction(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('A review id is required.');
    if (!REVIEW_DECISIONS.includes(payload.decision)) throw badRequest('Invalid review decision.');
  },
  async run(ctx) {
    const review = await ctx.db.get('iso_action_reviews', ctx.payload.id);
    if (!review) throw notFound();
    const action = await ctx.db.get('iso_actions', review.action_id);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    if (review.decision) throw badRequest('This review has already been decided.');
    const decided = await ctx.db.patchRow('iso_action_reviews', review.id, {
      decision: ctx.payload.decision, decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
      decision_note: ctx.payload.decisionNote || null,
    });
    // A45: 'rejected'/'more_info' send the action straight back to more_info_required — there's
    // only one sensible destination for "not accepted yet" — mirroring action.verify's own
    // 'ineffective' auto-revert (A42). 'accepted' deliberately does NOT auto-advance to
    // ready_for_verification (mirroring 'effective' leaving status alone) — the real, gated move
    // stays a separate action.updateStatus call, so the major-NC gate is checked in exactly one
    // place, never duplicated. Guarded by the action still actually being submitted_for_review
    // (a decision can still be recorded even if something else already moved the action on).
    if (ctx.payload.decision !== 'accepted' && action.status === 'submitted_for_review') {
      await ctx.db.transition('iso_actions', action.id, 'status', 'submitted_for_review', 'more_info_required', {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: action.id,
        entity_ref: action.ref, action: 'status_changed', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    }
    return decided;
  },
});

// ── extension.* (plan §5 "extension: request · decide") ────────────────────────────────────────
defineOp('extension.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) { if (!isValidId(payload.actionId)) throw badRequest('An action is required.'); },
  async run(ctx) {
    const action = await ctx.db.get('iso_actions', ctx.payload.actionId);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    return ctx.db.list('iso_action_extensions', { where: [{ field: 'action_id', op: 'eq', value: action.id }] });
  },
});
defineOp('extension.request', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageAction(ctx); },
  async validate(payload) {
    if (!isValidId(payload.actionId)) throw badRequest('An action is required.');
    if (!isNonEmptyText(payload.requestedDue, 40)) throw badRequest('A requested due date is required.');
    if (!isNonEmptyText(payload.reason, 2000)) throw badRequest('A reason is required.');
  },
  async run(ctx) {
    const action = await ctx.db.get('iso_actions', ctx.payload.actionId);
    if (!action || action.audit_id !== ctx.audit.id) throw badRequest('That action is not on this audit.');
    if (!action.due_date) throw badRequest('This action has no due date to extend.');
    return ctx.db.insert('iso_action_extensions', {
      id: uid('iext_'), action_id: action.id, requested_by: ctx.caller.uid,
      current_due: action.due_date, requested_due: ctx.payload.requestedDue, reason: ctx.payload.reason,
      // decision: 'pending' set explicitly — same class of gap as action.create's missing status
      // default (Phase 7.3 slice 1): the offline store has no Postgres column default to fall
      // back on, so leaving this out left every extension's decision permanently undefined,
      // which extension.decide's own "already decided" guard then misread as always-already-decided.
      decision: 'pending',
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: action.id,
      entity_ref: action.ref, action: 'extension_requested', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});
defineOp('extension.decide', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canVerifyAction(ctx); },
  async validate(payload) {
    if (!isValidId(payload.id)) throw badRequest('An extension id is required.');
    if (!['approved', 'rejected'].includes(payload.decision)) throw badRequest('Invalid decision.');
  },
  async run(ctx) {
    const ext = await ctx.db.get('iso_action_extensions', ctx.payload.id);
    if (!ext) throw notFound();
    const action = await ctx.db.get('iso_actions', ext.action_id);
    if (!action || action.audit_id !== ctx.audit.id) throw notFound();
    if (ext.decision !== 'pending') throw badRequest('This extension has already been decided.');
    const decided = await ctx.db.patchRow('iso_action_extensions', ext.id, {
      decision: ctx.payload.decision, decided_by: ctx.caller.uid, decided_at: ctx.now.toISOString(),
      decision_note: ctx.payload.decisionNote || null,
    });
    if (ctx.payload.decision === 'approved') {
      // A46: approving moves the action's own due_date to the requested one directly via
      // db.update — not back through action.update's own requireReason gate for an overdue due
      // date (§6.3a rule 4), which would demand a SECOND reason for a change whose reason is
      // already on file in the extension record itself.
      await ctx.db.update('iso_actions', action.id, { due_date: ext.requested_due }, action.row_version, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'action', entity_id: action.id,
        entity_ref: action.ref, action: 'updated', field: 'due_date', reason: `Extension approved: ${ext.reason}`,
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    }
    return decided;
  },
});

// ── view.* (saved views) ─────────────────────────────────────────────────────────────────────────
defineOp('view.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const all = await ctx.db.list('iso_saved_views', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    return all.filter(v => !v.owner_uid || v.owner_uid === ctx.caller.uid);
  },
});
defineOp('view.save', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) {
    if (!isNonEmptyText(payload.entity, 40)) throw badRequest('A view entity is required.');
    if (!isNonEmptyText(payload.name, 100)) throw badRequest('A view name is required.');
  },
  async run(ctx) {
    return ctx.db.insert('iso_saved_views', {
      id: uid('ivw_'), owner_uid: ctx.payload.shared ? null : ctx.caller.uid, audit_id: ctx.audit.id,
      entity: ctx.payload.entity, name: ctx.payload.name, config: ctx.payload.config || {}, is_default: !!ctx.payload.isDefault,
      created_by: ctx.caller.uid,
    });
  },
});
defineOp('view.delete', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const view = await ctx.db.get('iso_saved_views', ctx.payload.id);
    if (!view || view.audit_id !== ctx.audit.id) throw notFound();
    if (view.owner_uid && view.owner_uid !== ctx.caller.uid) throw forbidden('Not your saved view.');
    return { deleted: ctx.payload.id };
  },
});

// ── template.* — whitelist only; never client ids, member uids, notes, comments, evidence,
// responses or reports (plan D17) ──────────────────────────────────────────────────────────────
const TEMPLATE_WHITELIST = ['name', 'description', 'audit_type', 'standards', 'unit_kinds', 'saved_views', 'finding_classifications', 'report_sections'];
defineOp('template.list', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) { return ctx.db.list('iso_templates', { where: [{ field: 'archived_at', op: 'isnull' }] }); },
});
defineOp('template.createFromAudit', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role) || ctx.caller.role === 'admin'; },
  async run(ctx) {
    const config = {};
    for (const k of TEMPLATE_WHITELIST) if (ctx.payload[k] !== undefined) config[k] = ctx.payload[k];
    return ctx.db.insert('iso_templates', {
      id: uid('itpl_'), name: ctx.payload.name || (ctx.audit.title + ' template'), description: ctx.payload.description || null,
      audit_type: ctx.audit.audit_type, config, created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    });
  },
});
defineOp('template.archive', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.role === 'admin'; },
  async run(ctx) {
    const tpl = await ctx.db.get('iso_templates', ctx.payload.id);
    if (!tpl) throw notFound();
    return { ...tpl, archived_at: ctx.now.toISOString() };
  },
});

// ── config.get / config.set (admin; logged) ─────────────────────────────────────────────────────
defineOp('config.get', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) {
    const rows = await ctx.db.list('iso_config', {});
    const out = {}; for (const r of rows) out[r.key] = r.value;
    return out;
  },
});
defineOp('config.set', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (!isNonEmptyText(payload.key, 60)) throw badRequest('A config key is required.');
    if (payload.value === undefined) throw badRequest('A config value is required.');
    if (payload.key === 'evidence_max_upload_mb' && (typeof payload.value !== 'number' || payload.value < 1 || payload.value > 25)) {
      throw badRequest('evidence_max_upload_mb must be between 1 and 25.');
    }
  },
  async run(ctx) {
    return ctx.db.upsertConfig(ctx.payload.key, ctx.payload.value, ctx.caller.uid, {
      audit_id: null, client_id: null, entity_type: 'config', entity_id: ctx.payload.key, action: 'updated',
      source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
  },
});

// ── evidence.* — plan Phase 8.1/8.2a (§5.4, D18). Links first: every "Add evidence" entry point
// pastes a SharePoint/web link by default; a file upload (evidence.uploadUrl / offlinePut /
// register / downloadUrl, plan 8.2) is the exception, further down with its own checks. Per-link
// review (evidence.review, 8b.5) and supersede plus the board's Evidence tab
// (8b.6) are further down; evidenceRequest.* (asking a client for evidence) is still not built —
// named here, not silently dropped, same discipline as A41/A57's own deferred-item notes. No
// notification is emitted for evidence add/review: no ISO notification-emission code exists
// anywhere in this codebase yet for ANY phase (confirmed by grep before writing this), so there is
// no existing pattern to extend and building one from scratch is out of this slice's scope — see
// A59 for the full record of this decision.
const EVIDENCE_TARGET_TABLES = { requirement: 'iso_requirements', finding: 'iso_findings', action: 'iso_actions' };
// Same content-editing tier as finding.create/update (canManageFinding) — attaching proof to a
// requirement/finding/action is the same kind of day-to-day work, not a lifecycle sign-off.
function canManageEvidence(ctx) { return canManageFinding(ctx); }
// api/_portal.js's normalizeLinkUrl already enforces http/https-only and rejects anything that
// doesn't parse; it does NOT reject embedded credentials (plan's own "no credentials" rule for
// evidence links specifically), so that check is layered on here rather than changing the shared
// portal helper's behaviour for its own, unrelated callers.
function normalizeEvidenceUrl(raw) {
  const href = normalizePortalLinkUrl(raw);
  if (!href) return null;
  const u = new URL(href);
  if (u.username || u.password) return null;
  return u.href;
}
function evidenceKindForUrl(href) {
  const host = new URL(href).hostname.toLowerCase();
  return (host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) ? 'sharepoint' : 'link';
}

// Plan 8b.4: "Other evidence" can be free-typed with no link at all (a note, an interview, a sample,
// a policy or procedure reference); a URL still decides link vs sharepoint by itself.
const EVIDENCE_NO_URL_KINDS = ['note', 'meeting_note', 'interview', 'observation', 'sample', 'policy_ref', 'procedure_ref'];
// B1.7: a sample note records what was sampled — population, sample size, exceptions found.
function samplePatch(p) {
  const out = {};
  for (const [k, col] of [['samplePopulation', 'sample_population'], ['sampleSize', 'sample_size']]) {
    if (p[k] == null || p[k] === '') continue;
    const n = Number(p[k]);
    if (!Number.isInteger(n) || n < 0 || n > 10000000) throw badRequest('Sample numbers must be whole numbers.');
    out[col] = n;
  }
  if (p.sampleExceptions != null && String(p.sampleExceptions).trim()) {
    if (String(p.sampleExceptions).length > 2000) throw badRequest('That note is too long.');
    out.sample_exceptions = String(p.sampleExceptions).trim();
  }
  return out;
}
const EVIDENCE_LINK_ROLES = ['primary', 'supporting'];
// D21: relationship kinds that mean "the same evidence can serve both" — never `supporting`, and not
// `mapping` either (that one only says both requirements share an action, not their evidence).
const EVIDENCE_SHARING_KINDS = ['same_requirement', 'integrated_topic', 'shared_evidence'];
// 8b.6: a link that no longer carries anything — a rejection, or a revision replaced by a newer one.
// Neither counts as use, and neither feeds D21's suggestions.
const DEAD_LINK_STATUSES = ['rejected', 'superseded'];
// Edit links "untick" (user-approved 2026-10-06, with a warning): a soft removal — the link row stays,
// review_status 'rejected' with this exact comment, logged as evidence_unlinked — so history keeps it
// and re-ticking the clause revives the same link (evidence.link) instead of silently skipping it.
const EVIDENCE_UNLINK_NOTE = 'Removed from this clause (Edit links)';
// ── Release-1 B3.4: learning signals ────────────────────────────────────────────────────────────
// No UI of their own — fixed-payload activity entries the later learning work reads:
//   related_applied {offered, applied, unticked, documentsLinked}   (B1.5, relationship.applyToRelated)
//   doc_linked {source, evidenceId, title, requirementIds}           (below — one per linking call)
//   evidence_suggestion_confirmed / _rejected                        (8b.5, evidence.decideSuggestion)
// source: register_suggestion (a catalogue document from the register), history_suggestion (an 8b.5
// suggestion confirmed), search (an existing document picked by search), custom (a new document of
// the board's own). A linking call without a valid linkSource writes no doc_linked signal.
const LINK_SOURCES = ['register_suggestion', 'history_suggestion', 'search', 'custom'];
const SIGNAL_ACTIONS = ['related_applied', 'doc_linked', 'evidence_suggestion_confirmed', 'evidence_suggestion_rejected'];
async function logDocLinked(ctx, source, evidence, requirementIds) {
  if (!LINK_SOURCES.includes(source) || !evidence) return;
  await ctx.db.log({
    audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: evidence.id, entity_ref: evidence.ref || null,
    action: 'doc_linked', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    after: { source, evidenceId: evidence.id, title: evidence.title, requirementIds: [...requirementIds] },
  });
}
function checkLinkSource(payload) {
  if (payload.linkSource != null && !LINK_SOURCES.includes(payload.linkSource)) throw badRequest('Invalid link source.');
}
// Admin only: every learning signal captured so far, as JSON — to check what is being recorded.
defineOp('signal.export', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && ctx.caller.role === 'admin'; },
  async run(ctx) {
    const rows = await ctx.db.list('iso_activity', { where: [{ field: 'action', op: 'in', value: SIGNAL_ACTIONS }], limit: 50000 });
    const signals = rows.map(a => ({ at: a.at || a.created_at || null, auditId: a.audit_id || null, action: a.action, actor: a.actor_uid || null, entityType: a.entity_type || null, entityId: a.entity_id || null, payload: a.after || null }))
      .sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
    return { generatedAt: ctx.now.toISOString(), actions: SIGNAL_ACTIONS, count: signals.length, signals };
  },
});
async function logEvidenceLinked(ctx, evidence, link) {
  await ctx.db.log({
    audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: link.target_type, entity_id: link.target_id,
    action: 'evidence_linked', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    after: { evidenceId: evidence.id, evidenceRef: evidence.ref, linkId: link.id, role: link.role },
  });
}
async function evidenceTarget(ctx, targetType, targetId) {
  const target = await ctx.db.get(EVIDENCE_TARGET_TABLES[targetType], targetId);
  if (!target || target.audit_id !== ctx.audit.id || target.archived_at) throw badRequest(`That ${targetType} is not on this audit.`);
  return target;
}

defineOp('evidence.addLink', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!EVIDENCE_TARGET_TABLES[payload.targetType]) throw badRequest('Invalid evidence target type.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid evidence target.');
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('A title is required.');
    const hasUrl = typeof payload.url === 'string' && payload.url.trim() !== '';
    if (hasUrl && payload.url.length > 2000) throw badRequest('That link is too long.');
    if (!hasUrl && !EVIDENCE_NO_URL_KINDS.includes(payload.kind)) throw badRequest('A link is required (or choose a type that has none, such as a note).');
    if (payload.confidentiality && !['normal', 'restricted'].includes(payload.confidentiality)) throw badRequest('Invalid confidentiality.');
    if (payload.role && !EVIDENCE_LINK_ROLES.includes(payload.role)) throw badRequest('Invalid evidence role.');
    if (payload.relevanceNote != null && String(payload.relevanceNote).length > 2000) throw badRequest('That note is too long.');
    samplePatch(payload);
    checkLinkSource(payload);
  },
  async run(ctx) {
    const target = await evidenceTarget(ctx, ctx.payload.targetType, ctx.payload.targetId);
    const rawUrl = typeof ctx.payload.url === 'string' ? ctx.payload.url.trim() : '';
    let href = null, kind;
    if (rawUrl) {
      href = normalizeEvidenceUrl(rawUrl);
      if (!href) throw badRequest('That link is not a valid http(s) URL (no embedded credentials allowed).');
      kind = evidenceKindForUrl(href);
    } else {
      kind = ctx.payload.kind;
    }
    const evidence = await ctx.db.insertNumbered('iso_evidence', 'child', ctx.audit.id + ':E', {
      id: uid('ievi_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, kind, title: ctx.payload.title.trim(),
      description: ctx.payload.description || null, url: href, version_label: ctx.payload.versionLabel || null,
      evidence_date: ctx.payload.evidenceDate || null, owner_uid: ctx.payload.ownerUid || ctx.caller.uid,
      confidentiality: ctx.payload.confidentiality || 'normal', visibility: ctx.payload.visibility || 'internal',
      suggest_related: ctx.payload.suggestRelated !== false,
      uploaded_by: ctx.caller.uid, uploaded_via: 'staff', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
      ...(kind === 'sample' ? samplePatch(ctx.payload) : {}),
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    const link = await ctx.db.insert('iso_evidence_links', {
      id: uid('ievl_'), evidence_id: evidence.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      target_type: ctx.payload.targetType, target_id: target.id, role: ctx.payload.role || 'primary',
      relevance_note: ctx.payload.relevanceNote ? String(ctx.payload.relevanceNote).trim() : null,
      review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    });
    await logEvidenceLinked(ctx, evidence, link);
    if (link.target_type === 'requirement') await logDocLinked(ctx, ctx.payload.linkSource, evidence, [link.target_id]); // B3.4
    return { evidence, link };
  },
});

// evidence.link — plan 8b.4 (D19): reuse existing evidence on another target, no duplicate record.
// One link row per evidence; anything already linked to this target (in ANY state — including a
// rejected link, so a rejection stays final) is skipped and reported, never duplicated.
defineOp('evidence.link', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!EVIDENCE_TARGET_TABLES[payload.targetType]) throw badRequest('Invalid evidence target type.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid evidence target.');
    if (!Array.isArray(payload.evidenceIds) || !payload.evidenceIds.length || payload.evidenceIds.length > 50 || !payload.evidenceIds.every(isValidId)) throw badRequest('Choose between 1 and 50 evidence records.');
    checkLinkSource(payload);
    if (payload.roles != null && (typeof payload.roles !== 'object' || Array.isArray(payload.roles) || !Object.values(payload.roles).every(r => EVIDENCE_LINK_ROLES.includes(r)))) throw badRequest('Invalid evidence role.');
  },
  async run(ctx) {
    const target = await evidenceTarget(ctx, ctx.payload.targetType, ctx.payload.targetId);
    const existing = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: ctx.payload.targetType }, { field: 'target_id', op: 'eq', value: target.id }] });
    const already = new Set(existing.map(l => l.evidence_id));
    const linked = [], skipped = [];
    for (const evidenceId of [...new Set(ctx.payload.evidenceIds)]) {
      const e = await ctx.db.get('iso_evidence', evidenceId);
      if (!e || e.audit_id !== ctx.audit.id || e.archived_at) throw badRequest('That evidence is not on this audit.');
      if (e.superseded_by) throw badRequest(`${e.ref} has been superseded — link the current revision instead.`);
      const removed = existing.find(l => l.evidence_id === e.id && l.review_status === 'rejected' && l.review_comment === EVIDENCE_UNLINK_NOTE);
      if (removed) {
        const revived = await ctx.db.update('iso_evidence_links', removed.id, { review_status: 'submitted', review_comment: null }, removed.row_version || 1, {
          audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: removed.target_type, entity_id: removed.target_id,
          action: 'evidence_linked', field: 'review_status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
        });
        linked.push(revived);
        continue;
      }
      if (already.has(e.id)) { skipped.push(e.id); continue; }
      const link = await ctx.db.insert('iso_evidence_links', {
        id: uid('ievl_'), evidence_id: e.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
        target_type: ctx.payload.targetType, target_id: target.id,
        role: (ctx.payload.roles && ctx.payload.roles[e.id]) || 'primary',
        relevance_note: (ctx.payload.relevanceNotes && ctx.payload.relevanceNotes[e.id]) ? String(ctx.payload.relevanceNotes[e.id]).trim().slice(0, 2000) : null,
        review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
      });
      await logEvidenceLinked(ctx, e, link);
      already.add(e.id);
      linked.push(link);
    }
    // B3.4: one doc_linked signal per document this call linked.
    if (ctx.payload.targetType === 'requirement') for (const evId of new Set(linked.map(l => l.evidence_id))) await logDocLinked(ctx, ctx.payload.linkSource, await ctx.db.get('iso_evidence', evId), [target.id]);
    return { linked, skipped };
  },
});

// evidence.addLinkBulk — R4 (D35, P5): "Add a document once; its clauses arrive pre-ticked" — one
// new evidence record, linked to every chosen requirement in the same call. The 3-field add panel
// (title/url-or-kind/version+date) stays evidence.addLink's own shape; this is its multi-target
// sibling, requirement-only (the Documents view's whole premise is clause coverage, not
// findings/actions). "~5 clicks for 35 clauses" (P5) is this call plus the chooser, not 35 separate
// evidence.addLink calls.
defineOp('evidence.addLinkBulk', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('A title is required.');
    if (!Array.isArray(payload.requirementIds) || !payload.requirementIds.length || payload.requirementIds.length > 50 || !payload.requirementIds.every(isValidId)) throw badRequest('Choose between 1 and 50 clauses.');
    const hasUrl = typeof payload.url === 'string' && payload.url.trim() !== '';
    if (hasUrl && payload.url.length > 2000) throw badRequest('That link is too long.');
    if (!hasUrl && !EVIDENCE_NO_URL_KINDS.includes(payload.kind)) throw badRequest('A link is required (or choose a type that has none, such as a note).');
    checkLinkSource(payload);
  },
  async run(ctx) {
    const rawUrl = typeof ctx.payload.url === 'string' ? ctx.payload.url.trim() : '';
    let href = null, kind;
    if (rawUrl) {
      href = normalizeEvidenceUrl(rawUrl);
      if (!href) throw badRequest('That link is not a valid http(s) URL (no embedded credentials allowed).');
      kind = evidenceKindForUrl(href);
    } else {
      kind = ctx.payload.kind;
    }
    const evidence = await ctx.db.insertNumbered('iso_evidence', 'child', ctx.audit.id + ':E', {
      id: uid('ievi_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, kind, title: ctx.payload.title.trim(),
      description: ctx.payload.description || null, url: href, version_label: ctx.payload.versionLabel || null,
      evidence_date: ctx.payload.evidenceDate || null, owner_uid: ctx.payload.ownerUid || ctx.caller.uid,
      confidentiality: ctx.payload.confidentiality || 'normal', visibility: ctx.payload.visibility || 'internal',
      suggest_related: ctx.payload.suggestRelated !== false,
      uploaded_by: ctx.caller.uid, uploaded_via: 'staff', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    const linked = [], skipped = [];
    for (const reqId of [...new Set(ctx.payload.requirementIds)]) {
      const req = await ctx.db.get('iso_requirements', reqId);
      if (!req || req.audit_id !== ctx.audit.id || req.archived_at) { skipped.push({ id: reqId, reason: 'not found' }); continue; }
      const link = await ctx.db.insert('iso_evidence_links', {
        id: uid('ievl_'), evidence_id: evidence.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
        target_type: 'requirement', target_id: req.id, role: 'primary',
        relevance_note: null, review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
      });
      await logEvidenceLinked(ctx, evidence, link);
      linked.push(link);
    }
    if (linked.length) await logDocLinked(ctx, ctx.payload.linkSource, evidence, linked.map(l => l.target_id)); // B3.4
    return { evidence, linked, skipped };
  },
});

// evidence.unlinkDocument — Edit links: take a document off chosen clauses. Matches the document the
// way document.list does (live evidence whose title equals it, case-insensitively — every revision
// still live), soft-removes each live link to those requirements and logs it. The evidence record
// itself, and its links to every other clause, are untouched.
defineOp('evidence.unlinkDocument', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isNonEmptyText(payload.title, 300)) throw badRequest('Which document?');
    if (!Array.isArray(payload.requirementIds) || !payload.requirementIds.length || payload.requirementIds.length > 50 || !payload.requirementIds.every(isValidId)) throw badRequest('Choose between 1 and 50 clauses.');
  },
  async run(ctx) {
    const title = ctx.payload.title.trim().toLowerCase();
    const targets = new Set(ctx.payload.requirementIds);
    const links = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }] });
    const removed = [];
    const evCache = {};
    for (const l of links) {
      if (!targets.has(l.target_id) || DEAD_LINK_STATUSES.includes(l.review_status)) continue;
      const e = evCache[l.evidence_id] || (evCache[l.evidence_id] = await ctx.db.get('iso_evidence', l.evidence_id));
      if (!e || e.archived_at || String(e.title || '').trim().toLowerCase() !== title) continue;
      try {
        await ctx.db.update('iso_evidence_links', l.id, { review_status: 'rejected', review_comment: EVIDENCE_UNLINK_NOTE }, l.row_version || 1, {
          audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: l.target_id,
          action: 'evidence_unlinked', field: 'review_status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
        });
      } catch (err) { if (err.code === 'version_conflict') throw conflict(); throw err; }
      removed.push({ linkId: l.id, requirementId: l.target_id, evidenceId: e.id });
    }
    return { removed: removed.length, links: removed };
  },
});

// document.list — R4 (D35, P5): the Documents view's own data, document-first. For every catalog
// document (DOCUMENT_CATALOG, static — same "no per-board table" pattern as library relationships),
// which of THIS board's own clauses it is suggested for, and how many of those already have it
// (matched by evidence title, case-insensitively, among this board's live — not superseded, not
// rejected — evidence links). A document the register never suggests for this board's standards is
// left out entirely; a custom, audit-only document (not in the catalog) is out of scope for this op
// — it already has real evidence and real links, nothing to "suggest".
defineOp('document.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
    const byClauseKey = new Map();
    for (const r of reqs) {
      const k = r.standard_code + ' ' + r.clause;
      if (!byClauseKey.has(k)) byClauseKey.set(k, []);
      byClauseKey.get(k).push(r);
    }
    const links = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }] });
    const liveLinks = links.filter(l => !DEAD_LINK_STATUSES.includes(l.review_status));
    const evidenceById = {};
    for (const l of liveLinks) { if (!evidenceById[l.evidence_id]) evidenceById[l.evidence_id] = await ctx.db.get('iso_evidence', l.evidence_id); }
    // requirementId -> Set(lowercased evidence titles live-linked to it)
    const titlesByReq = new Map();
    // lowercased title -> the newest live evidence carrying it (the Documents tab's "✓ Rev · date")
    const latestByTitle = new Map();
    const reqIdsByTitle = new Map();
    for (const l of liveLinks) {
      const e = evidenceById[l.evidence_id];
      if (!e || e.archived_at || e.superseded_by) continue;
      if (l.review_status === 'insufficient') continue; // B1.7: flagged insufficient = not provided
      const t = String(e.title || '').trim().toLowerCase();
      if (!titlesByReq.has(l.target_id)) titlesByReq.set(l.target_id, new Set());
      titlesByReq.get(l.target_id).add(t);
      if (!reqIdsByTitle.has(t)) reqIdsByTitle.set(t, new Set());
      reqIdsByTitle.get(t).add(l.target_id);
      const cur = latestByTitle.get(t);
      const stamp = x => String(x.evidence_date || x.created_at || '');
      if (!cur || stamp(e) > stamp(cur)) latestByTitle.set(t, e);
    }
    const latestOf = t => { const e = latestByTitle.get(t); return e ? { evidenceId: e.id, title: e.title, versionLabel: e.version_label || null, evidenceDate: e.evidence_date || null } : null; };
    const reqById = new Map(reqs.map(r => [r.id, r]));
    const out = [];
    const releaseDocs = libraryRelease(ctx.audit).documents; // B3.1: the board's own catalogue
    for (const doc of releaseDocs) {
      const clauses = [];
      for (const c of doc.clauses) {
        const rows = byClauseKey.get(c.standard + ' ' + c.clause);
        if (!rows) continue;
        for (const r of rows) {
          const have = (titlesByReq.get(r.id) || new Set()).has(doc.name.toLowerCase());
          clauses.push({ requirementId: r.id, standardCode: r.standard_code, clause: r.clause, clauseName: r.clause_name, provided: have });
        }
      }
      if (!clauses.length) continue; // the catalog's clause isn't on this board at all — nothing to suggest
      out.push({ name: doc.name, clauses, providedCount: clauses.filter(c => c.provided).length, totalCount: clauses.length, latest: latestOf(doc.name.toLowerCase()) });
    }
    // Redesign (wireframe "Add other document"): evidence whose title matches no catalog document is
    // a custom, audit-only document — listed with exactly the clauses it is linked to (all provided).
    const catalogNames = new Set(releaseDocs.map(d => d.name.toLowerCase()));
    for (const [t, ids] of reqIdsByTitle) {
      if (!t || catalogNames.has(t)) continue;
      const clauses = [...ids].map(id => reqById.get(id)).filter(Boolean).map(r => ({ requirementId: r.id, standardCode: r.standard_code, clause: r.clause, clauseName: r.clause_name, provided: true }));
      if (!clauses.length) continue;
      const latest = latestOf(t);
      out.push({ name: latest.title, custom: true, clauses, providedCount: clauses.length, totalCount: clauses.length, latest });
    }
    // B4.6: when each document was last asked for (an open request on any of its clauses).
    const reqRows = (await ctx.db.list('iso_evidence_requests', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] })).filter(x => x.status === 'open');
    for (const d of out) {
      const ids = new Set(d.clauses.map(c => c.requirementId));
      const hit = reqRows.filter(x => ids.has(x.target_id) && String(x.description || '').toLowerCase() === d.name.toLowerCase()).map(x => x.created_at).sort().pop();
      if (hit) d.requestedAt = hit;
    }
    out.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name));
    return out;
  },
});

// Live evidence (not superseded) on a live link (not rejected or superseded) to requirements one
// confirmed, evidence-sharing hop away from requirementId (D21). Shared by evidence.search's "Used on
// related requirements" group and 8b.5's suggestions, so the selector and the suggestions can never
// disagree about what is "related".
function relatedEvidenceIds(requirementId, relationships, links, evidenceById) {
  const neighbours = new Set();
  for (const r of relationships) {
    if (r.state !== 'confirmed' || !EVIDENCE_SHARING_KINDS.includes(r.kind)) continue;
    if (r.from_id === requirementId) neighbours.add(r.to_id);
    else if (r.to_id === requirementId) neighbours.add(r.from_id);
  }
  const out = new Set();
  for (const l of links) {
    if (l.target_type !== 'requirement' || !neighbours.has(l.target_id) || DEAD_LINK_STATUSES.includes(l.review_status)) continue;
    const e = evidenceById[l.evidence_id];
    if (e && !e.archived_at && !e.superseded_by && e.suggest_related !== false) out.add(e.id);
  }
  return [...out];
}

// evidence.search — plan 8b.4: the selector's data in one round trip. Staff only (as evidence.list).
defineOp('evidence.search', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) {
    if (payload.targetType != null && !EVIDENCE_TARGET_TABLES[payload.targetType]) throw badRequest('Invalid evidence target type.');
    if (payload.targetId != null && !isValidId(payload.targetId)) throw badRequest('Invalid evidence target.');
    if (payload.q != null && String(payload.q).length > 200) throw badRequest('Search text is too long.');
  },
  async run(ctx) {
    const evidence = (await ctx.db.list('iso_evidence', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 }));
    const links = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const evidenceById = Object.fromEntries(evidence.map(e => [e.id, e]));
    const q = String(ctx.payload.q || '').trim().toLowerCase();
    const kind = ctx.payload.kind || null;
    const t = ctx.payload.targetType && ctx.payload.targetId ? ctx.payload.targetType + ':' + ctx.payload.targetId : null;
    const items = evidence
      .filter(e => !kind || e.kind === kind)
      .filter(e => !q || [e.title, e.ref, e.description, e.url, e.version_label].some(x => x && String(x).toLowerCase().includes(q)))
      .map(e => {
        const mine = links.filter(l => l.evidence_id === e.id);
        return {
          id: e.id, ref: e.ref, kind: e.kind, title: e.title, url: e.url, versionLabel: e.version_label,
          evidenceDate: e.evidence_date, confidentiality: e.confidentiality, createdAt: e.created_at,
          hasFile: !!e.storage_path, originalFilename: e.original_filename || null, sizeBytes: e.size_bytes == null ? null : Number(e.size_bytes),
          linkCount: mine.filter(l => !DEAD_LINK_STATUSES.includes(l.review_status)).length,
          linkedToTarget: !!t && mine.some(l => l.target_type + ':' + l.target_id === t),
          // 8b.6: the Evidence tab's review-status column, and the selector's "superseded" state.
          linkSummary: mine.reduce((s, l) => { const k = ['submitted', 'under_review', 'more_info_required'].includes(l.review_status) ? 'toReview' : l.review_status; s[k] = (s[k] || 0) + 1; return s; }, {}),
          supersededBy: e.superseded_by || null,
        };
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const recentIds = [];
    for (const l of links.filter(l => l.created_by === ctx.caller.uid).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))) {
      if (evidenceById[l.evidence_id] && !recentIds.includes(l.evidence_id)) recentIds.push(l.evidence_id);
      if (recentIds.length === 10) break;
    }
    let relatedIds = [];
    if (ctx.payload.targetType === 'requirement' && ctx.payload.targetId) {
      const relationships = await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
      relatedIds = relatedEvidenceIds(ctx.payload.targetId, relationships, links, evidenceById);
    }
    return { items, recentIds, relatedIds };
  },
});

// evidence.list — staff-only this slice (clientProjection:null): the ISO client portal (plan
// 13.6, the only place a client caller would ever need this) is Phase 13 and does not exist yet —
// confirmed by grep before writing this, not assumed. Building client-safety filtering for a
// caller path with no real entry point would be speculative, not protective; add it when 13.6 is
// actually built, the same "don't invent scope for an unbuilt feature" call A57 already made for
// digest.items' "Report issued" line.
defineOp('evidence.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) {
    if (!EVIDENCE_TARGET_TABLES[payload.targetType]) throw badRequest('Invalid evidence target type.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid evidence target.');
  },
  async run(ctx) {
    const links = await ctx.db.list('iso_evidence_links', {
      where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'target_type', op: 'eq', value: ctx.payload.targetType }, { field: 'target_id', op: 'eq', value: ctx.payload.targetId }],
    });
    const out = [];
    for (const l of links) {
      const e = await ctx.db.get('iso_evidence', l.evidence_id);
      if (!e || e.archived_at) continue;
      out.push({
        id: e.id, ref: e.ref, kind: e.kind, title: e.title, description: e.description, url: e.url,
        versionLabel: e.version_label, evidenceDate: e.evidence_date, ownerUid: e.owner_uid,
        confidentiality: e.confidentiality, visibility: e.visibility, createdAt: e.created_at, suggestRelated: e.suggest_related !== false,
        samplePopulation: e.sample_population == null ? null : e.sample_population, sampleSize: e.sample_size == null ? null : e.sample_size, sampleExceptions: e.sample_exceptions || null,
        // 8.2: an uploaded file's name, size, type and document status — never its storage path.
        hasFile: !!e.storage_path, originalFilename: e.original_filename || null, sizeBytes: e.size_bytes == null ? null : Number(e.size_bytes), mime: e.mime || null, documentStatus: e.document_status || 'draft',
        linkId: l.id, role: l.role || 'primary', relevanceNote: l.relevance_note || null,
        reviewStatus: l.review_status, reviewedBy: l.reviewed_by, reviewedAt: l.reviewed_at, reviewComment: l.review_comment,
        // 8b.5: what the review controls need — the link's own version (optimistic concurrency), who
        // linked it (no self-review) and the revision the reviewer saw.
        linkRowVersion: l.row_version || 1, createdBy: l.created_by || null, reviewedVersionLabel: l.reviewed_version_label || null,
      });
    }
    return out;
  },
});

// ── 8b.5 (R11, D20, D21): derived cross-standard suggestions and per-link review ─────────────────
const EVIDENCE_VERDICTS = ['under_review', 'more_info_required', 'accepted', 'partially_sufficient', 'insufficient', 'rejected'];
const VERDICTS_NEEDING_COMMENT = ['more_info_required', 'insufficient', 'rejected'];
// Who may judge evidence: whoever may verify actions (can_verify — audit managers and auditors by
// default) or an admin; never the person who added that link (no self-review, D20).
function canReviewEvidence(ctx) { return ctx.caller.role === 'admin' || !!(ctx.membership && ctx.membership.can_verify); }

// D21, pure: a suggestion for (evidence E, requirement T) exists while E has a live (not rejected,
// not superseded) link to a requirement S, S↔T is a CONFIRMED relationship of an evidence-sharing
// kind, E is neither superseded (8b.6) nor "use for this requirement only", and no link row of any
// status exists for (E, T). Worked out on read, never
// stored — so it appears whichever came first, and leaves nothing behind when it stops applying.
// Only decisions are stored (a confirmed or rejected link row, kept forever by 010's unique key).
function deriveSuggestions({ links, relationships, evidenceById, requirementById }) {
  const linked = new Set(links.map(l => l.evidence_id + '|' + l.target_type + '|' + l.target_id));
  const out = new Map();
  for (const l of links) {
    if (l.target_type !== 'requirement' || DEAD_LINK_STATUSES.includes(l.review_status)) continue;
    const e = evidenceById[l.evidence_id];
    if (!e || e.archived_at || e.superseded_by || e.suggest_related === false) continue;
    for (const r of relationships) {
      if (r.state !== 'confirmed' || !EVIDENCE_SHARING_KINDS.includes(r.kind)) continue;
      const other = r.from_id === l.target_id ? r.to_id : r.to_id === l.target_id ? r.from_id : null;
      if (!other || !requirementById[other] || linked.has(e.id + '|requirement|' + other)) continue;
      const key = e.id + '|' + other;
      if (out.has(key)) continue; // first source wins — stable, in store order
      out.set(key, {
        evidenceId: e.id, targetId: other, sourceRequirementId: l.target_id, sourceLinkId: l.id,
        relationshipId: r.id, relationshipKind: r.kind, relationshipReason: r.reason_text || null,
        suggestedAt: [l.created_at, r.decided_at].filter(Boolean).sort().pop() || null,
      });
    }
  }
  // Phase 9b (D31): evidence carried from last year's board is offered for the clauses it was accepted
  // for there — unless it is already linked here, or that suggestion was rejected (a rejected link).
  for (const e of Object.values(evidenceById)) {
    if (!e.carry_target_ids || !e.carry_target_ids.length || e.archived_at || e.superseded_by) continue;
    for (const t of e.carry_target_ids) {
      if (!requirementById[t] || linked.has(e.id + '|requirement|' + t) || out.has(e.id + '|' + t)) continue;
      out.set(e.id + '|' + t, { evidenceId: e.id, targetId: t, sourceRequirementId: null, sourceLinkId: null, relationshipId: null,
        relationshipKind: 'carried_over', relationshipReason: `Accepted for this clause in ${String(e.carried_from_ref || '').split(' / ')[0] || 'the last audit'}`, suggestedAt: e.created_at || null });
    }
  }
  return [...out.values()];
}
async function suggestionContext(ctx) {
  const [evidence, links, relationships, requirements, auditStandards] = await Promise.all([
    ctx.db.list('iso_evidence', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }], limit: 5000 }),
    ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] }),
    ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] }),
    ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }),
    ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] }),
  ]);
  const editionByStd = {};
  for (const as of auditStandards) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) editionByStd[v.standard_code] = v.edition || null; }
  const evidenceById = Object.fromEntries(evidence.map(e => [e.id, e]));
  const requirementById = Object.fromEntries(requirements.map(r => [r.id, { ...r, edition: editionByStd[r.standard_code] || null }]));
  return { evidenceById, links, relationships, requirementById, suggestions: deriveSuggestions({ links, relationships, evidenceById, requirementById }) };
}
const reqBrief = r => r ? { id: r.id, standard_code: r.standard_code, edition: r.edition, clause: r.clause, clause_name: r.clause_name, requirement_text: r.requirement_text } : null;

defineOp('evidence.suggestions', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) { if (payload.targetId != null && !isValidId(payload.targetId)) throw badRequest('Invalid requirement.'); },
  async run(ctx) {
    const sc = await suggestionContext(ctx);
    return sc.suggestions.filter(s => !ctx.payload.targetId || s.targetId === ctx.payload.targetId).map(s => {
      const e = sc.evidenceById[s.evidenceId];
      return {
        ...s, relationshipKindLabel: REL_KIND_LABEL_SERVER[s.relationshipKind] || s.relationshipKind,
        evidence: { id: e.id, ref: e.ref, title: e.title, kind: e.kind, url: e.url, versionLabel: e.version_label, evidenceDate: e.evidence_date },
        source: reqBrief(sc.requirementById[s.sourceRequirementId]), target: reqBrief(sc.requirementById[s.targetId]),
      };
    });
  },
});

// Confirm → a real link row (its own role, verdict "Not reviewed"); reject → a `rejected` row that
// keeps the suggestion from ever coming back. Only a suggestion that still applies can be decided.
defineOp('evidence.decideSuggestion', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.evidenceId) || !isValidId(payload.targetId)) throw badRequest('Evidence and requirement are required.');
    if (!['confirm', 'reject'].includes(payload.decision)) throw badRequest('Invalid decision.');
    if (payload.role != null && !EVIDENCE_LINK_ROLES.includes(payload.role)) throw badRequest('Invalid evidence role.');
    if (payload.comment != null && String(payload.comment).length > 2000) throw badRequest('That comment is too long.');
  },
  async run(ctx) {
    const sc = await suggestionContext(ctx);
    const s = sc.suggestions.find(x => x.evidenceId === ctx.payload.evidenceId && x.targetId === ctx.payload.targetId);
    if (!s) throw badRequest('That evidence is no longer suggested for this requirement.');
    const confirm = ctx.payload.decision === 'confirm';
    const comment = ctx.payload.comment ? String(ctx.payload.comment).trim() : null;
    const link = await ctx.db.insert('iso_evidence_links', {
      id: uid('ievl_'), evidence_id: s.evidenceId, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      target_type: 'requirement', target_id: s.targetId, role: (confirm && ctx.payload.role) || 'primary',
      relevance_note: confirm ? comment : null, review_status: confirm ? 'submitted' : 'rejected',
      review_comment: confirm ? null : comment, reviewed_by: confirm ? null : ctx.caller.uid, reviewed_at: confirm ? null : ctx.now.toISOString(),
      created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    });
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: s.targetId,
      action: confirm ? 'evidence_suggestion_confirmed' : 'evidence_suggestion_rejected', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { evidenceId: s.evidenceId, linkId: link.id, sourceRequirementId: s.sourceRequirementId, relationshipId: s.relationshipId, role: link.role, comment },
    });
    if (confirm) await logDocLinked(ctx, 'history_suggestion', await ctx.db.get('iso_evidence', s.evidenceId), [s.targetId]); // B3.4
    return link;
  },
});

// evidence.review — one reviewer verdict on one link (D20). Comment required for the three verdicts
// that send work back; the link's own role may be adjusted at the same time; the evidence record's
// revision at the time of review is kept on the link.
defineOp('evidence.review', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canReviewEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.linkId)) throw badRequest('A link is required.');
    if (!EVIDENCE_VERDICTS.includes(payload.verdict)) throw badRequest('Invalid verdict.');
    if (VERDICTS_NEEDING_COMMENT.includes(payload.verdict) && !isNonEmptyText(payload.comment, 2000)) throw badRequest('Say why — a comment is required for this verdict.');
    if (payload.role != null && !EVIDENCE_LINK_ROLES.includes(payload.role)) throw badRequest('Invalid evidence role.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const link = await ctx.db.get('iso_evidence_links', ctx.payload.linkId);
    if (!link || link.audit_id !== ctx.audit.id) throw notFound('Evidence link not found.');
    if (link.created_by === ctx.caller.uid) throw forbidden('You added this evidence here — someone else needs to review it.');
    const e = await ctx.db.get('iso_evidence', link.evidence_id);
    const patch = {
      review_status: ctx.payload.verdict, reviewed_by: ctx.caller.uid, reviewed_at: ctx.now.toISOString(),
      reviewed_version_label: (e && e.version_label) || null, review_comment: ctx.payload.comment ? String(ctx.payload.comment).trim() : null,
    };
    if (ctx.payload.role) patch.role = ctx.payload.role;
    try {
      return await ctx.db.update('iso_evidence_links', link.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: link.target_type, entity_id: link.target_id,
        action: 'evidence_reviewed', field: 'review_status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e2) { if (e2.code === 'version_conflict') throw conflict(); throw e2; }
  },
});

// B1.7 (D35: for staff-added evidence the auditor's own confirmation IS the review): the auditor
// flags a document they linked as only partly sufficient, or insufficient — or clears the flag. Client
// uploads keep the independent reviewer flow (evidence.review, no self-review).
const SUFFICIENCY_STATUS = { partial: 'partially_sufficient', insufficient: 'insufficient' };
defineOp('evidence.setSufficiency', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.linkId)) throw badRequest('A link is required.');
    if (payload.sufficiency != null && !SUFFICIENCY_STATUS[payload.sufficiency]) throw badRequest('Invalid sufficiency.');
    if (payload.note != null && String(payload.note).length > 2000) throw badRequest('That note is too long.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const link = await ctx.db.get('iso_evidence_links', ctx.payload.linkId);
    if (!link || link.audit_id !== ctx.audit.id) throw notFound('Evidence link not found.');
    if (DEAD_LINK_STATUSES.includes(link.review_status)) throw badRequest('That link is no longer live.');
    const e = await ctx.db.get('iso_evidence', link.evidence_id);
    if (!e || e.uploaded_via !== 'staff') throw forbidden('Client uploads are reviewed through Evidence review.');
    const patch = { review_status: ctx.payload.sufficiency ? SUFFICIENCY_STATUS[ctx.payload.sufficiency] : 'submitted',
      review_comment: ctx.payload.note ? String(ctx.payload.note).trim() : null };
    try {
      return await ctx.db.update('iso_evidence_links', link.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: link.target_type, entity_id: link.target_id,
        action: 'evidence_sufficiency', field: 'review_status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e2) { if (e2.code === 'version_conflict') throw conflict(); throw e2; }
  },
});

// evidence.summary — per requirement: counts by verdict plus pending suggestions, for the register's
// Evidence column, the "Evidence suggested" marker and the "Evidence to review" view.
defineOp('evidence.summary', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async run(ctx) {
    const sc = await suggestionContext(ctx);
    return isoCalc.computeEvidenceSummary(sc.links, sc.evidenceById, new Set(Object.keys(sc.requirementById)), sc.suggestions);
  },
});

// ── 8b.6: the board's Evidence tab and evidence drawer (reverse traceability, supersede) ─────────
// `label` is the full line for the drawer's "Used on" list; `short` names the target only, for the
// "accepted for X, awaiting review for Y" summary.
async function evidenceTargetLabel(ctx, l, cache) {
  const key = l.target_type + ':' + l.target_id;
  if (cache[key]) return cache[key];
  const row = await ctx.db.get(EVIDENCE_TARGET_TABLES[l.target_type], l.target_id);
  let label = l.target_id, short = l.target_id, std = null;
  if (row && l.target_type === 'requirement') {
    std = row.standard_code;
    short = 'ISO ' + row.standard_code + (cache['ed:' + row.standard_code] ? ':' + cache['ed:' + row.standard_code] : '') + ' ' + row.clause;
    label = short + ' — ' + String(row.requirement_text || '').slice(0, 90);
  } else if (row) {
    short = (l.target_type === 'finding' ? 'Finding ' : 'Action ') + (row.ref || '');
    label = short + ' — ' + (row.title || '');
  }
  return (cache[key] = { label, short, std });
}
// evidence.get — one record with every target it serves and the verdict on each, so a reviewer sees
// "accepted for X, awaiting review for Y" in one place; plus its own history.
defineOp('evidence.get', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) { if (!isValidId(payload.evidenceId)) throw badRequest('An evidence record is required.'); },
  async run(ctx) {
    const e = await ctx.db.get('iso_evidence', ctx.payload.evidenceId);
    if (!e || e.audit_id !== ctx.audit.id || e.archived_at) throw notFound('Evidence not found.');
    const links = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'evidence_id', op: 'eq', value: e.id }] });
    const cache = {};
    for (const as of await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] })) {
      const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v && v.edition) cache['ed:' + v.standard_code] = v.edition;
    }
    const outLinks = [];
    for (const l of links) {
      const t = await evidenceTargetLabel(ctx, l, cache);
      outLinks.push({ linkId: l.id, targetType: l.target_type, targetId: l.target_id, targetLabel: t.label, targetShort: t.short, targetStandard: t.std, role: l.role || 'primary', relevanceNote: l.relevance_note || null,
        reviewStatus: l.review_status, reviewedBy: l.reviewed_by || null, reviewedAt: l.reviewed_at || null, reviewComment: l.review_comment || null,
        reviewedVersionLabel: l.reviewed_version_label || null, linkRowVersion: l.row_version || 1, createdBy: l.created_by || null, createdAt: l.created_at || null });
    }
    // Its own entries (created, superseded) plus every entry about one of its links: logEvidenceLinked
    // and the suggestion decisions carry `evidenceId`; a link update's `after` is the link row itself.
    const history = (await ctx.db.list('iso_activity', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] }))
      .filter(a => (a.entity_type === 'evidence' && a.entity_id === e.id) || (a.after && (a.after.evidenceId === e.id || a.after.evidence_id === e.id || (a.entity_type === 'evidence' && a.after.id === e.id))))
      .map(a => ({ at: a.at, action: a.action, actorUid: a.actor_uid, entityType: a.entity_type, entityId: a.entity_id }))
      .sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const supersededByRef = e.superseded_by ? ((await ctx.db.get('iso_evidence', e.superseded_by)) || {}).ref || null : null;
    return {
      id: e.id, ref: e.ref, kind: e.kind, title: e.title, description: e.description, url: e.url, versionLabel: e.version_label,
      evidenceDate: e.evidence_date, ownerUid: e.owner_uid, confidentiality: e.confidentiality, visibility: e.visibility,
      suggestRelated: e.suggest_related !== false, supersededBy: e.superseded_by || null, supersededByRef, createdAt: e.created_at,
      hasFile: !!e.storage_path, originalFilename: e.original_filename || null, sizeBytes: e.size_bytes == null ? null : Number(e.size_bytes), mime: e.mime || null, documentStatus: e.document_status || 'draft',
      approverUid: e.approver_uid || null, effectiveDate: e.effective_date || null,
      rowVersion: e.row_version || 1, links: outLinks, history,
    };
  },
});
// evidence.supersede — a newer record replaces an older one (typically a new revision of the same
// document). The old record's live links become `superseded` (history kept, never deleted); the new
// record is linked to the same targets as "Not reviewed", skipping any it already has a link of any
// status to (a rejection stays final, as in evidence.link). Suggestions stop flowing from the old
// record (D21 skips superseded records and links). No assessment field is touched.
defineOp('evidence.supersede', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.evidenceId) || !isValidId(payload.byEvidenceId)) throw badRequest('Both evidence records are required.');
    if (payload.evidenceId === payload.byEvidenceId) throw badRequest('A record cannot supersede itself.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const oldE = await ctx.db.get('iso_evidence', ctx.payload.evidenceId);
    const newE = await ctx.db.get('iso_evidence', ctx.payload.byEvidenceId);
    if (!oldE || !newE || oldE.audit_id !== ctx.audit.id || newE.audit_id !== ctx.audit.id || oldE.archived_at || newE.archived_at) throw badRequest('Both records must be on this audit.');
    if (oldE.superseded_by) throw badRequest('That record is already superseded.');
    if (newE.superseded_by) throw badRequest('The replacement is itself superseded.');
    let updatedOld;
    try {
      updatedOld = await ctx.db.update('iso_evidence', oldE.id, { superseded_by: newE.id }, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: oldE.id, entity_ref: oldE.ref,
        action: 'superseded', field: 'superseded_by', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
    const oldLinks = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'evidence_id', op: 'eq', value: oldE.id }] });
    const newLinks = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'evidence_id', op: 'eq', value: newE.id }] });
    const has = new Set(newLinks.map(l => l.target_type + ':' + l.target_id));
    let superseded = 0, carried = 0;
    for (const l of oldLinks) {
      if (['rejected', 'superseded'].includes(l.review_status)) continue;
      await ctx.db.update('iso_evidence_links', l.id, { review_status: 'superseded', review_comment: `Superseded by ${newE.ref}` }, l.row_version || 1, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: l.target_type, entity_id: l.target_id,
        action: 'evidence_superseded', field: 'review_status', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      superseded++;
      if (has.has(l.target_type + ':' + l.target_id)) continue;
      const target = await ctx.db.get(EVIDENCE_TARGET_TABLES[l.target_type], l.target_id);
      if (!target || target.archived_at) continue;
      const nl = await ctx.db.insert('iso_evidence_links', {
        id: uid('ievl_'), evidence_id: newE.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id, target_type: l.target_type, target_id: l.target_id,
        role: l.role || 'primary', relevance_note: l.relevance_note || null, review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
      });
      has.add(l.target_type + ':' + l.target_id);
      await logEvidenceLinked(ctx, newE, nl);
      carried++;
    }
    return { superseded: updatedOld, linksSuperseded: superseded, linksCarriedOver: carried };
  },
});

// ── evidence file upload — plan 8.2 (§4.7, §5.4, D18). Links stay the default; a file is the
// exception, used only through "Upload a file instead". The server chooses the evidence id and the
// storage path (the client never names either). The browser sends bytes only to the one signed URL
// it is given (online) or through evidence.offlinePut (the offline dev server, base64 through
// /api/iso). evidence.register then checks what actually arrived before any record exists. No virus
// scanning exists — a known limitation, recorded in A82.
const EVIDENCE_FILE_TYPES = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  txt: ['text/plain'],
  png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], gif: ['image/gif'], webp: ['image/webp'], heic: ['image/heic', 'image/heif'],
  msg: ['application/vnd.ms-outlook'],
  eml: ['message/rfc822'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};
const EVIDENCE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'];
const EVIDENCE_DOCUMENT_STATUSES = ['draft', 'approved', 'superseded', 'obsolete']; // 010 / D22
const EVIDENCE_HARD_LIMIT_BYTES = 25 * 1024 * 1024;   // the bucket's own file_size_limit (§5.4)
const EVIDENCE_OFFLINE_LIMIT_BYTES = 4 * 1024 * 1024; // base64 through /api/iso stays under serve.mjs's 6 MB body cap
const EVIDENCE_RESERVATION_MS = 2 * 60 * 60 * 1000;
const EVIDENCE_MAX_OPEN_RESERVATIONS = 10;
// The filename lives only in original_filename: control characters and path separators stripped,
// at most 200 characters, the extension kept when it has to be shortened.
function cleanUploadFilename(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  if (s.length <= 200) return s;
  const m = s.match(/(\.[A-Za-z0-9]{1,10})$/);
  return m ? s.slice(0, 200 - m[1].length) + m[1] : s.slice(0, 200);
}
function uploadExt(filename) { return ((String(filename).match(/\.([A-Za-z0-9]{1,10})$/) || [])[1] || '').toLowerCase(); }
function fmtMb(bytes) { return (bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1) + ' MB'; }
async function evidenceUploadCap(ctx) {
  const cfg = await ctx.db.getConfig('evidence_max_upload_mb');
  const mb = Math.min(25, Math.max(1, Number(cfg && cfg.value) || 10));
  const offline = require('./_isoAuth').isoOfflineMode();
  return { mb, bytes: offline ? Math.min(mb * 1024 * 1024, EVIDENCE_OFFLINE_LIMIT_BYTES) : mb * 1024 * 1024, offline };
}
async function openReservation(ctx, evidenceId) {
  const rows = await ctx.db.list('iso_evidence_uploads', { where: [{ field: 'evidence_id', op: 'eq', value: evidenceId }, { field: 'closed_at', op: 'isnull' }] });
  const r = rows[0];
  return r && r.audit_id === ctx.audit.id ? r : null;
}
async function closeReservation(ctx, r, reason, removeObject) {
  if (removeObject) await ctx.db.storageRemove(r.storage_path);
  await ctx.db.patchRow('iso_evidence_uploads', r.id, { closed_at: ctx.now.toISOString(), close_reason: reason });
}
// What a browser may see of an evidence row — never the storage path (downloads go through
// evidence.downloadUrl, which reads the path itself).
function evidencePublic(e) {
  const { storage_path, ...rest } = e; // eslint-disable-line no-unused-vars
  return { ...rest, has_file: !!storage_path };
}

defineOp('evidence.uploadUrl', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!EVIDENCE_TARGET_TABLES[payload.targetType]) throw badRequest('Invalid evidence target type.');
    if (!isValidId(payload.targetId)) throw badRequest('Invalid evidence target.');
    if (!isNonEmptyText(payload.filename, 1000)) throw badRequest('A file name is required.');
    if (!Number.isInteger(payload.size) || payload.size <= 0) throw badRequest('The file size is required.');
    if (payload.mime != null && (typeof payload.mime !== 'string' || payload.mime.length > 200)) throw badRequest('Invalid file type.');
    if (payload.title != null && (typeof payload.title !== 'string' || payload.title.length > 300)) throw badRequest('That title is too long.');
    if (payload.confidentiality && !['normal', 'restricted'].includes(payload.confidentiality)) throw badRequest('Invalid confidentiality.');
    if (payload.role && !EVIDENCE_LINK_ROLES.includes(payload.role)) throw badRequest('Invalid evidence role.');
    if (payload.relevanceNote != null && String(payload.relevanceNote).length > 2000) throw badRequest('That note is too long.');
    if (payload.description != null && String(payload.description).length > 5000) throw badRequest('That description is too long.');
    // 8c.5 (D22): the document's own fields, set at upload.
    if (payload.documentStatus != null && !EVIDENCE_DOCUMENT_STATUSES.includes(payload.documentStatus)) throw badRequest('Invalid document status.');
    for (const k of ['ownerUid', 'approverUid']) if (payload[k] != null && payload[k] !== '' && !isValidId(payload[k])) throw badRequest(`Invalid ${k === 'ownerUid' ? 'owner' : 'approver'}.`);
    if (payload.effectiveDate != null && payload.effectiveDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(payload.effectiveDate)) throw badRequest('The effective date must be a date.');
  },
  async run(ctx) {
    await evidenceTarget(ctx, ctx.payload.targetType, ctx.payload.targetId);
    const filename = cleanUploadFilename(ctx.payload.filename);
    const ext = uploadExt(filename);
    if (!filename || !EVIDENCE_FILE_TYPES[ext]) throw badRequest(`That file type isn't accepted. Allowed: ${Object.keys(EVIDENCE_FILE_TYPES).join(', ')} — or paste a SharePoint link instead.`);
    const mime = String(ctx.payload.mime || '').trim().toLowerCase() || EVIDENCE_FILE_TYPES[ext][0];
    if (!EVIDENCE_FILE_TYPES[ext].includes(mime)) throw badRequest(`The file's type (${mime}) doesn't match a .${ext} file.`);
    const cap = await evidenceUploadCap(ctx);
    if (ctx.payload.size > cap.bytes) {
      throw badRequest(`That file is ${fmtMb(ctx.payload.size)} — the limit is ${cap.offline && cap.bytes < cap.mb * 1024 * 1024 ? fmtMb(cap.bytes) + ' on the offline dev server' : cap.mb + ' MB'}. Paste a SharePoint link to it instead.`);
    }
    // This caller's open reservations: expired ones are closed (and their bytes removed) first.
    const nowMs = ctx.now.getTime();
    const mine = await ctx.db.list('iso_evidence_uploads', { where: [{ field: 'reserved_by', op: 'eq', value: ctx.caller.uid }, { field: 'closed_at', op: 'isnull' }] });
    let open = 0;
    for (const r of mine) {
      if (new Date(r.expires_at).getTime() <= nowMs) await closeReservation(ctx, r, 'expired', true);
      else open++;
    }
    if (open >= EVIDENCE_MAX_OPEN_RESERVATIONS) throw badRequest(`You already have ${EVIDENCE_MAX_OPEN_RESERVATIONS} uploads in progress — finish one, or wait for it to expire (2 hours).`);
    const evidenceId = uid('ievi_');
    const storagePath = `${ctx.audit.client_id}/${ctx.audit.id}/${evidenceId}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const expiresAt = new Date(nowMs + EVIDENCE_RESERVATION_MS).toISOString();
    await ctx.db.insert('iso_evidence_uploads', {
      id: uid('ievu_'), evidence_id: evidenceId, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      target_type: ctx.payload.targetType, target_id: ctx.payload.targetId, storage_path: storagePath,
      original_filename: filename, ext, declared_mime: mime, declared_size: ctx.payload.size,
      details: {
        title: String(ctx.payload.title || '').trim() || filename.replace(/\.[A-Za-z0-9]{1,10}$/, ''),
        description: ctx.payload.description || null, versionLabel: ctx.payload.versionLabel || null, evidenceDate: ctx.payload.evidenceDate || null,
        confidentiality: ctx.payload.confidentiality || 'normal', visibility: ctx.payload.visibility || 'internal', role: ctx.payload.role || 'primary',
        relevanceNote: ctx.payload.relevanceNote ? String(ctx.payload.relevanceNote).trim() : null, suggestRelated: ctx.payload.suggestRelated !== false,
        documentStatus: ctx.payload.documentStatus || 'draft', ownerUid: ctx.payload.ownerUid || null, approverUid: ctx.payload.approverUid || null, effectiveDate: ctx.payload.effectiveDate || null,
      },
      reserved_by: ctx.caller.uid, expires_at: expiresAt, closed_at: null, close_reason: null,
    });
    const signed = await ctx.db.storageSignedUpload(storagePath);
    return { evidenceId, signedUrl: signed.url || null, offline: !signed.url, mime, maxBytes: cap.bytes, expiresAt };
  },
});

// Offline only: the dev server has no signed URLs, so the bytes come through /api/iso as base64 and
// land in .iso-offline/files/ — the same one-time, reservation-scoped write a signed URL allows.
defineOp('evidence.offlinePut', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.evidenceId)) throw badRequest('An upload is required.');
    if (typeof payload.dataBase64 !== 'string' || !payload.dataBase64.length || payload.dataBase64.length > Math.ceil(EVIDENCE_OFFLINE_LIMIT_BYTES / 3) * 4 + 8) throw badRequest('The file is missing or too large for the offline dev server.');
  },
  async run(ctx) {
    if (!require('./_isoAuth').isoOfflineMode()) throw badRequest('Only the offline dev server takes file bytes through the API.');
    const r = await openReservation(ctx, ctx.payload.evidenceId);
    if (!r) throw badRequest('No upload is in progress for that record.');
    if (r.reserved_by !== ctx.caller.uid) throw forbidden('Someone else started that upload.');
    if (new Date(r.expires_at).getTime() <= ctx.now.getTime()) { await closeReservation(ctx, r, 'expired', true); throw badRequest('That upload expired — start again.'); }
    if ((await ctx.db.storageHead(r.storage_path)).exists) throw badRequest('That upload has already been sent.');
    const bytes = Buffer.from(ctx.payload.dataBase64, 'base64');
    await ctx.db.storagePut(r.storage_path, bytes, r.declared_mime);
    return { received: bytes.length };
  },
});

// evidence.register — takes only the evidence id. The object must exist, be at most 25 MB, match the
// declared size and have an allowed type for its extension; otherwise it is removed and refused. Only
// then is the record created (kind file, or photo for an image), linked "Not reviewed", with the
// document status the form chose — Draft unless set (D20, D22, 8c.5) — the upload never changes an
// assessment or a verdict, and never confirms anything for a related requirement (D21 only suggests).
defineOp('evidence.register', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) { if (!isValidId(payload.evidenceId)) throw badRequest('An upload is required.'); },
  async run(ctx) {
    const r = await openReservation(ctx, ctx.payload.evidenceId);
    if (!r) throw badRequest('No upload is in progress for that record.');
    if (r.reserved_by !== ctx.caller.uid) throw forbidden('Someone else started that upload.');
    if (new Date(r.expires_at).getTime() <= ctx.now.getTime()) { await closeReservation(ctx, r, 'expired', true); throw badRequest('That upload expired — start again.'); }
    const head = await ctx.db.storageHead(r.storage_path);
    if (!head.exists) throw badRequest('The file has not arrived yet — send it, then register it.');
    const mime = String(head.mime || r.declared_mime || '').split(';')[0].trim().toLowerCase();
    const why = head.size > EVIDENCE_HARD_LIMIT_BYTES ? 'it is over 25 MB'
      : head.size !== Number(r.declared_size) ? `its size (${head.size} bytes) is not the declared ${r.declared_size}`
      : !EVIDENCE_FILE_TYPES[r.ext].includes(mime) ? `its type (${mime || 'unknown'}) is not allowed for .${r.ext}`
      : null;
    if (why) { await closeReservation(ctx, r, 'refused', true); throw badRequest(`The upload was refused — ${why} — and has been removed.`); }
    const target = await ctx.db.get(EVIDENCE_TARGET_TABLES[r.target_type], r.target_id);
    if (!target || target.audit_id !== ctx.audit.id || target.archived_at) { await closeReservation(ctx, r, 'refused', true); throw badRequest(`That ${r.target_type} is no longer on this audit — the upload has been removed.`); }
    const d = r.details || {};
    const evidence = await ctx.db.insertNumbered('iso_evidence', 'child', ctx.audit.id + ':E', {
      id: r.evidence_id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id, kind: EVIDENCE_IMAGE_EXTS.includes(r.ext) ? 'photo' : 'file',
      title: d.title || r.original_filename, description: d.description || null, url: null,
      storage_path: r.storage_path, original_filename: r.original_filename, mime, size_bytes: head.size,
      document_status: d.documentStatus || 'draft', approver_uid: d.approverUid || null, effective_date: d.effectiveDate || null,
      version_label: d.versionLabel || null, evidence_date: d.evidenceDate || null, owner_uid: d.ownerUid || ctx.caller.uid,
      confidentiality: d.confidentiality || 'normal', visibility: d.visibility || 'internal', suggest_related: d.suggestRelated !== false,
      uploaded_by: ctx.caller.uid, uploaded_via: 'staff', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    }, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: null,
      action: 'created', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: evidence.id, entity_ref: evidence.ref,
      action: 'evidence_uploaded', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { evidenceId: evidence.id, filename: r.original_filename, sizeBytes: head.size, mime, documentStatus: evidence.document_status },
    });
    const link = await ctx.db.insert('iso_evidence_links', {
      id: uid('ievl_'), evidence_id: evidence.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      target_type: r.target_type, target_id: r.target_id, role: d.role || 'primary', relevance_note: d.relevanceNote || null,
      review_status: 'submitted', created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
    });
    await logEvidenceLinked(ctx, evidence, link);
    await closeReservation(ctx, r, 'registered', false);
    return { evidence: evidencePublic(evidence), link };
  },
});

// evidence.setDocumentStatus — plan 8c.5 (D22): the document's own status (as stated on it), with
// its approver and effective date. Separate from the reviewer's verdict on each link (D20), which
// it never touches; a change is logged as document_status_changed.
defineOp('evidence.setDocumentStatus', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    if (!isValidId(payload.evidenceId)) throw badRequest('An evidence record is required.');
    if (!EVIDENCE_DOCUMENT_STATUSES.includes(payload.documentStatus)) throw badRequest('Invalid document status.');
    if (payload.approverUid != null && payload.approverUid !== '' && !isValidId(payload.approverUid)) throw badRequest('Invalid approver.');
    if (payload.effectiveDate != null && payload.effectiveDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(payload.effectiveDate)) throw badRequest('The effective date must be a date.');
    if (payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const e = await ctx.db.get('iso_evidence', ctx.payload.evidenceId);
    if (!e || e.audit_id !== ctx.audit.id || e.archived_at) throw notFound('Evidence not found.');
    if (!e.storage_path) throw badRequest('Only an uploaded document has a document status.');
    const patch = { document_status: ctx.payload.documentStatus };
    if ('approverUid' in ctx.payload) patch.approver_uid = ctx.payload.approverUid || null;
    if ('effectiveDate' in ctx.payload) patch.effective_date = ctx.payload.effectiveDate || null;
    try {
      const updated = await ctx.db.update('iso_evidence', e.id, patch, ctx.payload.expectedVersion, {
        audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: e.id, entity_ref: e.ref,
        action: (e.document_status || 'draft') !== patch.document_status ? 'document_status_changed' : 'updated', field: 'document_status',
        source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      });
      return evidencePublic(updated);
    } catch (err) { if (err.code === 'version_conflict') throw conflict(); throw err; }
  },
});

// evidence.downloadUrl — never takes a path: it signs the record's own storage path for 120 s as an
// attachment under the original filename (online), or returns the bytes (offline), and logs it.
defineOp('evidence.downloadUrl', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) { if (!isValidId(payload.evidenceId)) throw badRequest('An evidence record is required.'); },
  async run(ctx) {
    const e = await ctx.db.get('iso_evidence', ctx.payload.evidenceId);
    if (!e || e.audit_id !== ctx.audit.id || e.archived_at) throw notFound('Evidence not found.');
    if (!e.storage_path) throw badRequest('That evidence has no file.');
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'evidence', entity_id: e.id, entity_ref: e.ref,
      action: 'evidence_downloaded', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { evidenceId: e.id, filename: e.original_filename },
    });
    const signed = await ctx.db.storageSignedDownload(e.storage_path, e.original_filename);
    const base = { filename: e.original_filename, mime: e.mime, sizeBytes: e.size_bytes };
    if (signed.url) return { ...base, url: signed.url, expiresIn: 120 };
    const bytes = await ctx.db.storageGet(e.storage_path);
    if (!bytes) throw notFound('The file is missing from storage.');
    return { ...base, dataBase64: bytes.toString('base64') };
  },
});

// evidence.storageUsage — the admin page's "storage used" line: the sum of size_bytes over every
// uploaded evidence file (links use none, D18).
defineOp('evidence.storageUsage', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && ctx.caller.role === 'admin'; },
  async run(ctx) {
    const rows = (await ctx.db.list('iso_evidence', {})).filter(e => e.storage_path);
    return { files: rows.length, bytes: rows.reduce((s, e) => s + (Number(e.size_bytes) || 0), 0) };
  },
});

// ── metric.audit / metric.portfolio — Phase 9.1: the arithmetic itself now lives in the pure,
// directly-unit-tested api/_isoCalc.js (plan §7's own "one module computes every number"); this op
// only fetches the raw rows and hands them over, so the server and iso-calc-test.cjs can never
// compute two different answers for the same inputs. FINDING_CLOSED_STATUSES/ACTION_CLOSED_STATUSES
// stay defined here too (several OTHER ops below — the due-date reason rule, the digest, the action
// Gantt — already close over these exact in-file consts; _isoCalc.js keeps its own copies of the
// same literal values for its own internal use and for the test suite, rather than reaching back
// into this file for them).
const FINDING_CLOSED_STATUSES = ['closed', 'withdrawn'];
const ACTION_CLOSED_STATUSES = ['verified', 'closed'];
// Every value each status column's own check constraint (009) allows — kept as one list so a
// dashboard "open" filter descriptor (Phase 9.2) can derive its positive enumeration from the
// complement rather than hand-duplicating it; the shared filter schema (api/_isoFilter.js) has no
// negation operator, only `in`.
const FINDING_STATUSES = ['draft', 'released_for_review', 'final', 'closed', 'withdrawn', 'reopened'];
const ACTION_STATUSES = ['draft', 'assigned', 'in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required', 'ready_for_verification', 'verified', 'closed', 'on_hold'];
const FINDING_OPEN_STATUSES = FINDING_STATUSES.filter(s => !FINDING_CLOSED_STATUSES.includes(s));
const ACTION_OPEN_STATUSES = ACTION_STATUSES.filter(s => !ACTION_CLOSED_STATUSES.includes(s));
// Shared by metric.audit and dashboard.audit — the one place that fetches the raw rows
// computeAuditMetrics needs, so the two ops can never disagree about what went into the numbers.
async function fetchAuditCalcInputs(ctx) {
  const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
  const findings = await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
  // A finding is linked to its originating requirement at creation and never re-linked afterward
  // (confirmed by grep of every write to this join table) — fetched here, resolved purely in _isoCalc.
  const findingRequirementLinks = findings.length ? await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: findings.map(f => f.id) }] }) : [];
  const actions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
  // ALL link states fetched; _isoCalc's own confirmed-only filter decides what counts — a rejected
  // link (action.unlink) must never keep attributing an action to a target it no longer targets.
  const actionLinks = actions.length ? await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: actions.map(a => a.id) }] }) : [];
  // Phase 8.1 (plan §5.4/§7): evidence_requested counts open iso_evidence_requests (a staff
  // member has asked for proof but none has arrived yet); evidence_submitted/evidence_accepted
  // read iso_evidence_links' own per-link review_status (acceptance is per link, so the SAME
  // evidence file can count as accepted for one requirement and still be submitted/under review
  // for another — plan's own "acceptance is per link" rule, not per evidence record).
  const evidenceRequests = await ctx.db.list('iso_evidence_requests', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
  const evidenceLinks = await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
  // The same per-requirement summary evidence.summary returns — the dashboard's evidence figure and
  // the register's "Evidence to review" view read one computation.
  const sc = await suggestionContext(ctx);
  const evidenceSummary = isoCalc.computeEvidenceSummary(sc.links, sc.evidenceById, new Set(Object.keys(sc.requirementById)), sc.suggestions);
  const suggestions = sc.suggestions.map(s => ({ evidenceId: s.evidenceId, targetId: s.targetId }));
  const tzConfig = await ctx.db.getConfig('timezone');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: (tzConfig && tzConfig.value) || 'Australia/Perth' }).format(ctx.now);
  return { reqs, findings, findingRequirementLinks, actions, actionLinks, evidenceRequests, evidenceLinks, suggestions, suggestionsCount: suggestions.length, evidenceSummary, nowIso: ctx.now.toISOString(), today };
}
// Activity that only reads (downloads, prompt copies) is not an update to the audit.
const READ_ONLY_ACTIVITY = ['evidence_downloaded', 'prompt_copied', 'prompt_downloaded'];
defineOp('metric.audit', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return isoCalc.computeAuditMetrics(await fetchAuditCalcInputs(ctx)); },
});
// dashboard.audit — plan 9.2. Wraps the same computeAuditMetrics numbers into {key,label,value,filter}
// descriptors (isoCalc.buildDashboard) and adds the three cross-tabs that need extra data metric.audit
// itself never fetches (unit names, the activity log) — kept out of metric.audit because the Reports
// tab calls metric.audit once per audit in a loop, and none of the three is cheap: iso_audit_units is
// an extra round trip and iso_activity can be large.
defineOp('dashboard.audit', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) {
    if (payload.standard != null && !/^\d{4,5}$/.test(String(payload.standard))) throw badRequest('Invalid standard.');
  },
  async run(ctx) {
    // D29: an optional standard scopes the KPIs/charts below; it must be one of this board's own. The
    // board's own standards are needed regardless (9.6's cards/matrix cover every one, always).
    const standard = ctx.payload.standard != null ? String(ctx.payload.standard) : null;
    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const codes = [];
    for (const as of auditStandards) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) codes.push(v.standard_code); }
    if (standard && !codes.includes(standard)) throw badRequest('That standard is not on this board.');

    const fullInput = await fetchAuditCalcInputs(ctx);
    const input = isoCalc.scopeInputsToStandard(fullInput, standard);
    const metrics = isoCalc.computeAuditMetrics(input);
    const units = await ctx.db.list('iso_audit_units', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
    const progressByUnit = isoCalc.computeProgressByGroup(input.reqs, r => r.unit_ids);
    const progressByOwner = isoCalc.computeProgressByGroup(input.reqs, r => [r.responsible_uid]);
    // Capped at 5000, chronological — generous for any real audit's own update volume; named here
    // rather than silently assumed exhaustive for an unusually long-lived, heavily-edited audit.
    const activity = await ctx.db.list('iso_activity', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }], order: 'at asc', limit: 5000 });
    const inScopeReq = new Set(input.reqs.map(r => r.id));
    const progressOverTime = isoCalc.computeProgressOverTime(standard ? activity.filter(a => a.entity_type !== 'requirement' || inScopeReq.has(a.entity_id)) : activity);
    // "Last update" is the board's, whatever standard is selected: its newest activity that changed something.
    const recent = await ctx.db.list('iso_activity', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }], order: 'at desc', limit: 50 });
    const lastChange = recent.find(a => !READ_ONLY_ACTIVITY.includes(a.action));
    // 9.6: the clause matrix, always every board standard — independent of `standard` above, which
    // only narrows the KPI/chart overview; a single-standard filter must never remove the comparison
    // the matrix exists to show.
    const clauseMatrix = isoCalc.computeClauseMatrix(fullInput.reqs, fullInput.evidenceSummary);
    const extras = { openFindingStatuses: FINDING_OPEN_STATUSES, openActionStatuses: ACTION_OPEN_STATUSES };
    // 9.6: one card per board standard, always — each is this same buildDashboard, scoped, so a card's
    // numbers can never drift from what the overview would show if that standard were selected.
    const cards = codes.map(code => isoCalc.buildDashboard(isoCalc.computeAuditMetrics(isoCalc.scopeInputsToStandard(fullInput, code)), { ...extras, standard: code }));
    // 9.7: Needs attention, findings/actions panels, shared actions, recent activity.
    // D31: on a maintenance board, what came over from the previous one.
    const carried = ctx.audit.previous_audit_id ? {
      previous: ((await ctx.db.get('iso_audits', ctx.audit.previous_audit_id)) || {}).ref || null,
      findings: fullInput.findings.filter(f => f.carried_from_ref).length,
      actions: fullInput.actions.filter(a => a.carried_from_ref).length,
      evidence: (await ctx.db.list('iso_evidence', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }], limit: 5000 })).filter(e => e.carried_from_ref && !e.archived_at).length,
      baseline: fullInput.reqs.filter(r => r.baseline_at).length,
    } : null;
    const panels = isoCalc.computeDashboardPanels(input, fullInput, { standard, today: fullInput.today, openActionStatuses: ACTION_OPEN_STATUSES, openFindingStatuses: FINDING_OPEN_STATUSES, activity: recent, excludeActivity: READ_ONLY_ACTIVITY });
    return Object.assign(isoCalc.buildDashboard(metrics, {
      ...extras, progressByUnit, progressByOwner, progressOverTime,
      units: units.map(u => ({ id: u.id, kind: u.kind, name: u.name })),
      standard, lastUpdateAt: lastChange ? lastChange.at : null,
      clauseMatrix, cards,
    }), { panels, carried });
  },
});
defineOp('metric.portfolio', {
  scope: 'none', clientProjection: null,
  allow: () => true,
  async run(ctx) {
    // audit.list already restricts to exactly what this caller may see (a client to their own
    // client_portal-enabled boards, staff to whatever canOpenAudit lets them open) — reused as-is,
    // never re-derived, so portfolio metrics can't disagree with the board list about who sees what.
    const audits = await registry['audit.list'].run(ctx);
    const active = audits.filter(a => a.stage !== 'closed');
    // The per-audit detail portfolio metrics need (progress, workload, findings by standard) is
    // fetched only for ACTIVE audits — a closed audit contributes nothing to any of these.
    const perAuditReqs = new Map(), findingsByAuditId = new Map(), actionsByAuditId = new Map();
    for (const a of active) {
      perAuditReqs.set(a.id, await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] }));
      findingsByAuditId.set(a.id, await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] }));
      actionsByAuditId.set(a.id, await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] }));
    }
    const out = isoCalc.computePortfolioMetrics({ audits, perAuditReqs, findingsByAuditId, actionsByAuditId, nowIso: ctx.now.toISOString() });
    // Landing redesign: per active board, per standard, how many clauses sit in each compliance status
    // — the same "25 /60 + status bar" the board header shows, so the list reads like the board.
    out.status_by_audit = {};
    for (const [auditId, reqs] of perAuditReqs) {
      const byStd = {};
      for (const r of reqs) {
        const b = byStd[r.standard_code] || (byStd[r.standard_code] = { total: 0, counts: {} });
        const st = r.compliance_status || 'not_assessed';
        b.total++; b.counts[st] = (b.counts[st] || 0) + 1;
      }
      out.status_by_audit[auditId] = byStd;
    }
    return out;
  },
});

// ── profile.* — plan 8c.1 (R12, D23): one Company Profile per client, shared by all its boards. ──
// A profile belongs to a client, not a board: whoever can open at least one of that client's boards
// may read it; editing needs the content-editing tier (contributor and up, as findings) on one of them.
async function clientBoardAccess(ctx, clientId) {
  if (ctx.caller.role === 'admin') return { canRead: true, canEdit: true };
  const audits = await ctx.db.list('iso_audits', { where: [{ field: 'client_id', op: 'eq', value: clientId }, { field: 'archived_at', op: 'isnull' }], limit: 500 });
  let canRead = false, canEdit = false;
  for (const a of audits) {
    const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
    const m = resolveMembership(ctx.caller, a, members);
    if (!m) continue;
    canRead = true;
    if (['audit_manager', 'auditor', 'contributor'].includes(m.audit_role)) { canEdit = true; break; }
  }
  return { canRead, canEdit };
}
function profileView(clientId, row, canEdit) {
  return { clientId, fields: (row && row.fields) || {}, rowVersion: row ? row.row_version : 0, canEdit, schema: isoProfile.PROFILE_FIELDS };
}
defineOp('profile.get', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) { if (!isValidId(payload.clientId)) throw badRequest('A client is required.'); },
  async run(ctx) {
    const access = await clientBoardAccess(ctx, ctx.payload.clientId);
    if (!access.canRead) throw forbidden('You cannot open any ISO board for this client.');
    return profileView(ctx.payload.clientId, await ctx.db.getProfile(ctx.payload.clientId), access.canEdit);
  },
});
// changes: {<key>: {value, confirmed} | [{id?, text, confirmed}]} — a batch, one save for the whole
// card. Only keys whose stored value really changes are written and logged; an all-unchanged save
// writes nothing (and still refuses a stale version).
defineOp('profile.set', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async validate(payload) {
    if (!isValidId(payload.clientId)) throw badRequest('A client is required.');
    if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    await ctx.checkClientExists(ctx.payload.clientId);
    const access = await clientBoardAccess(ctx, ctx.payload.clientId);
    if (!access.canEdit) throw forbidden("Only someone who works on one of this client's ISO boards can edit its profile.");
    const row = await ctx.db.getProfile(ctx.payload.clientId);
    let applied;
    try { applied = isoProfile.applyProfileChanges(row ? row.fields : {}, ctx.payload.changes, ctx.caller.uid, ctx.now.toISOString()); }
    catch (e) { if (e instanceof isoProfile.ProfileError) throw badRequest(e.message); throw e; }
    const current = row ? row.row_version : 0;
    if (current !== ctx.payload.expectedVersion) throw conflict();
    if (!applied.changedKeys.length) return profileView(ctx.payload.clientId, row, true);
    try {
      const saved = await ctx.db.upsertProfile(ctx.payload.clientId, applied.fields, ctx.payload.expectedVersion, ctx.caller.uid, applied.changedKeys);
      return profileView(ctx.payload.clientId, saved, true);
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});

// ── promptTemplate.* / prompt.* — plan 8c (R12, D22–D23). No AI service, key, endpoint or model:
// prompt.build only assembles text from reviewed seed templates and confirmed data. ──────────────
// Static require()s (bundling), one line per template; adding a template = one line + its file.
const PROMPT_TEMPLATES = [
  require('../iso/seed/prompt-templates/ims-policy.json'),
  require('../iso/seed/prompt-templates/context-register.json'),
  require('../iso/seed/prompt-templates/interested-parties-register.json'),
  require('../iso/seed/prompt-templates/risk-opportunity-register.json'),
  require('../iso/seed/prompt-templates/internal-audit-procedure.json'),
  require('../iso/seed/prompt-templates/internal-audit-program.json'),
  require('../iso/seed/prompt-templates/management-review.json'),
  require('../iso/seed/prompt-templates/corrective-action-form.json'),
  require('../iso/seed/prompt-templates/nonconformity-register.json'),
  // Plan 8c.6: the second batch (drafts until approved, STOP R2); three carry source-backed checklists.
  require('../iso/seed/prompt-templates/ims-scope-statement.json'),
  require('../iso/seed/prompt-templates/environmental-aspects-register.json'),
  require('../iso/seed/prompt-templates/hazard-risk-register.json'),
  require('../iso/seed/prompt-templates/legal-register.json'),
  require('../iso/seed/prompt-templates/objectives-register.json'),
  require('../iso/seed/prompt-templates/competency-matrix.json'),
  require('../iso/seed/prompt-templates/communication-plan.json'),
  require('../iso/seed/prompt-templates/document-control-procedure.json'),
  require('../iso/seed/prompt-templates/emergency-plan.json'),
  require('../iso/seed/prompt-templates/supplier-evaluation.json'),
  require('../iso/seed/prompt-templates/training-induction-record.json'),
];
// Approved templates are offered to every staff member. A draft (awaiting Etcher's approval, STOP
// R2) is offered to admins only, so a template can be reviewed by actually using it — its prompt and
// filename say DRAFT. Approval is a reviewed code change to the seed file (D23).
function templatesFor(caller) { return PROMPT_TEMPLATES.filter(t => t.reviewStatus === 'approved' || caller.role === 'admin'); }
function templateSummary(t) {
  return { templateId: t.templateId, version: t.version, title: t.title, purpose: t.purpose, documentType: t.documentType, reviewStatus: t.reviewStatus,
    questions: t.questions, requiredProfileFields: t.requiredProfileFields,
    // D40: re-keyed from the 2015 workbook's stableKey (kept, never matches a v3 row — retiring
    // pattern) to v3 document names. Empty for the 2 templates with no clean v3 match (Q5) — they
    // stay reachable from the Documents tab's own template list (R4b), never suggested per clause.
    supportsStableKeys: t.supportsRequirements.map(m => m.stableKey), documents: t.documents || [] };
}
defineOp('promptTemplate.list', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) { return templatesFor(ctx.caller).map(templateSummary); },
});

const REL_KIND_LABEL_SERVER = { carried_over: 'Accepted in the last audit', same_requirement: 'Equivalent requirement', integrated_topic: 'Shared integrated control', mapping: 'Linked through a shared action', shared_evidence: 'Shared evidence', supporting: 'Supporting' };
const PROMPT_MODES = ['quick', 'guided'];
function validatePromptPayload(payload) {
  if (!isValidId(payload.requirementId)) throw badRequest('A requirement is required.');
  if (!isValidId(payload.templateKey)) throw badRequest('A template is required.');
  if (payload.mode != null && !PROMPT_MODES.includes(payload.mode)) throw badRequest('Invalid mode.');
  if (payload.answers != null) {
    if (typeof payload.answers !== 'object' || Array.isArray(payload.answers) || Object.keys(payload.answers).length > 50) throw badRequest('Invalid answers.');
    for (const v of Object.values(payload.answers)) if (v != null && String(v).length > 4000) throw badRequest('An answer is too long.');
  }
  if (payload.options != null && (typeof payload.options !== 'object' || Array.isArray(payload.options))) throw badRequest('Invalid options.');
}
// Everything prompt.build needs, read server-side: the caller never supplies requirement wording,
// relationships or profile values, so the prompt can't be made to assert something the app doesn't hold.
async function promptInputs(ctx, template, requirementId) {
  const req = await ctx.db.get('iso_requirements', requirementId);
  if (!req || req.audit_id !== ctx.audit.id || req.archived_at) throw badRequest('That requirement is not on this audit.');
  const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
  const editionByStd = {}, versionById = {};
  for (const as of auditStandards) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) { editionByStd[v.standard_code] = v.edition || null; versionById[v.id] = v; } }
  const boardRequirements = (await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }))
    .map(r => ({ ...r, edition: editionByStd[r.standard_code] || null }));
  const byId = Object.fromEntries(boardRequirements.map(r => [r.id, r]));
  const rels = await ctx.db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
  const related = rels.filter(r => r.state === 'confirmed' && (r.from_id === req.id || r.to_id === req.id))
    .map(r => ({ other: byId[r.from_id === req.id ? r.to_id : r.from_id], r }))
    .filter(x => x.other)
    .map(({ other, r }) => ({ ...other, kindLabel: REL_KIND_LABEL_SERVER[r.kind] || r.kind, reason: r.reason_text || null }));
  let guidance = null;
  if (req.library_requirement_id) {
    const lib = await ctx.db.get('iso_library_requirements', req.library_requirement_id);
    if (lib) { const rel = libraryRelease(ctx.audit); guidance = buildGuidance({ requirements: [req], libReqById: { [lib.id]: lib }, versionById, guidanceSeeds: GUIDANCE_SEEDS, librarySeeds: rel.librarySeeds, docByClause: rel.docByClause })[req.id]; }
  }
  const profile = await ctx.db.getProfile(ctx.audit.client_id);
  return { requirement: byId[req.id] || { ...req, edition: editionByStd[req.standard_code] || null }, boardRequirements, related, guidance, fields: (profile && profile.fields) || {} };
}
defineOp('prompt.build', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) { validatePromptPayload(payload); },
  async run(ctx) {
    const template = templatesFor(ctx.caller).find(t => t.templateId === ctx.payload.templateKey);
    if (!template) throw notFound('That template is not available.');
    const inputs = await promptInputs(ctx, template, ctx.payload.requirementId);
    const out = isoPrompt.buildPrompt({
      template, ...inputs, clientName: await ctx.getClientName(ctx.audit.client_id),
      answers: ctx.payload.answers || {}, options: { ...(ctx.payload.options || {}), mode: ctx.payload.mode || 'quick' },
      preparedOn: ctx.now.toISOString().slice(0, 10), // the builder never reads a clock itself
    });
    return { ...out, templateId: template.templateId, templateVersion: template.version, reviewStatus: template.reviewStatus };
  },
});

// prompt.getAnswers / prompt.saveAnswers — plan 8c.4: the guided answers for one (board, requirement,
// template), so the user can come back to them. Answers are the user's own typed facts.
function cleanAnswers(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) if (isValidId(k) && v != null && String(v).trim()) out[k] = String(v).trim().slice(0, 4000);
  return out;
}
defineOp('prompt.getAnswers', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) { validatePromptPayload(payload); },
  async run(ctx) {
    const row = await ctx.db.getPromptAnswers(ctx.audit.id, ctx.payload.requirementId, ctx.payload.templateKey);
    return { answers: (row && row.answers) || {}, rowVersion: row ? row.row_version : 0 };
  },
});
defineOp('prompt.saveAnswers', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canManageEvidence(ctx); },
  async validate(payload) {
    validatePromptPayload(payload);
    if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) throw badRequest('expectedVersion is required.');
  },
  async run(ctx) {
    const template = templatesFor(ctx.caller).find(t => t.templateId === ctx.payload.templateKey);
    if (!template) throw notFound('That template is not available.');
    const req = await ctx.db.get('iso_requirements', ctx.payload.requirementId);
    if (!req || req.audit_id !== ctx.audit.id) throw badRequest('That requirement is not on this audit.');
    const known = new Set((template.questions || []).map(q => q.id));
    const answers = Object.fromEntries(Object.entries(cleanAnswers(ctx.payload.answers)).filter(([k]) => known.has(k)));
    try {
      const row = await ctx.db.savePromptAnswers({
        id: uid('ipans_'), audit_id: ctx.audit.id, client_id: ctx.audit.client_id, requirement_id: req.id,
        template_key: template.templateId, template_version: template.version, answers,
      }, ctx.payload.expectedVersion, ctx.caller.uid);
      return { answers: row.answers, rowVersion: row.row_version };
    } catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
// prompt.logExport — D22: copy and download are the moments client information leaves the app, so
// each is logged on the requirement with the template version and exactly which sensitive profile
// sections went out. Opening the dialog is not logged (noise in an append-only log). The server
// re-reads the template version itself rather than trusting the caller's.
defineOp('prompt.logExport', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client' && !!ctx.membership; },
  async validate(payload) {
    validatePromptPayload(payload);
    if (!['copy', 'download'].includes(payload.kind)) throw badRequest('Invalid export kind.');
    if (payload.sensitiveIncluded != null && (!Array.isArray(payload.sensitiveIncluded) || !payload.sensitiveIncluded.every(k => isoProfile.FIELD_BY_KEY[k] && isoProfile.FIELD_BY_KEY[k].sensitive))) throw badRequest('Invalid section list.');
    if (payload.filename != null && !/^[A-Za-z0-9_-]{1,116}\.txt$/.test(String(payload.filename))) throw badRequest('Invalid filename.');
  },
  async run(ctx) {
    const template = templatesFor(ctx.caller).find(t => t.templateId === ctx.payload.templateKey);
    if (!template) throw notFound('That template is not available.');
    const req = await ctx.db.get('iso_requirements', ctx.payload.requirementId);
    if (!req || req.audit_id !== ctx.audit.id) throw badRequest('That requirement is not on this audit.');
    await ctx.db.log({
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'requirement', entity_id: req.id,
      action: ctx.payload.kind === 'copy' ? 'prompt_copied' : 'prompt_downloaded', source: 'user',
      actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
      after: { templateKey: template.templateId, templateVersion: template.version, reviewStatus: template.reviewStatus, filename: ctx.payload.filename || null, sensitiveIncluded: ctx.payload.sensitiveIncluded || [] },
    });
    return { ok: true };
  },
});

// digest.items — plan Phase 7b.5 (R9): client-safe summary lines for a client's ISO boards,
// appended into the existing Digest feature's own draft→holding→approved→sent review (a staff
// member always reads every line before it reaches the client — this op only ever returns plain
// strings, never a field that could carry internal text through unreviewed). Staff-only caller
// (a client has no reason to generate their own digest); only boards with the portal actually
// switched on for that client contribute lines at all, same gate audit.list already uses for a
// client caller. No "Report issued: …" line — no report-issuance feature exists yet anywhere in
// this codebase (that's Phase 11, not built), so there is nothing real to summarise; adding a
// line for a feature that doesn't exist would be inventing data, not a client-safety concern.
defineOp('digest.items', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind !== 'client'; },
  async validate(payload) {
    if (!isValidId(payload.clientId)) throw badRequest('A client is required.');
  },
  async run(ctx) {
    const audits = await ctx.db.list('iso_audits', {
      where: [{ field: 'client_id', op: 'eq', value: ctx.payload.clientId }, { field: 'archived_at', op: 'isnull' }, { field: 'client_portal_enabled', op: 'eq', value: true }],
    });
    const today = ctx.now.toISOString().slice(0, 10);
    // `since` scopes "closed" to a real window instead of a hardcoded week, so a digest built
    // right after the previous one (whatever cadence staff actually use) doesn't miss or
    // double-count closures — falls back to a week when there's no prior digest to anchor on.
    const since = (ctx.payload.since && String(ctx.payload.since).slice(0, 10)) || new Date(ctx.now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const in14 = new Date(ctx.now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const lines = [];
    for (const a of audits) {
      const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] });
      const applicable = reqs.filter(r => r.applicability !== 'not_applicable');
      const assessedPct = applicable.length ? Math.round(100 * applicable.filter(r => r.assessment_state === 'complete').length / applicable.length) : 0;
      const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      const standardCodes = [];
      for (const as of auditStandards) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) standardCodes.push(v.standard_code); }
      const stageLabel = a.stage ? a.stage.charAt(0).toUpperCase() + a.stage.slice(1) : 'Unknown';
      lines.push(`ISO ${standardCodes.join('/')} audit ${a.ref} — stage ${stageLabel}, ${assessedPct}% of requirements assessed`);

      // Only an action the client could already see through a real op (action.list's own
      // clientProjection) is eligible to be counted or described here — draft/internal-only
      // actions never surface, even as a bare number.
      const actions = (await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] })).filter(isClientVisibleRecord);
      const closedCount = actions.filter(x => ACTION_CLOSED_STATUSES.includes(x.status) && (x.updated_at || '').slice(0, 10) >= since).length;
      if (closedCount) lines.push(`${closedCount} action${closedCount === 1 ? '' : 's'} closed this week`);
      const dueSoonCount = actions.filter(x => !ACTION_CLOSED_STATUSES.includes(x.status) && x.due_date && x.due_date >= today && x.due_date <= in14).length;
      if (dueSoonCount) lines.push(`${dueSoonCount} action${dueSoonCount === 1 ? '' : 's'} due in the next 14 days`);
    }
    return { lines };
  },
});

// export.gantt — plan Phase 7b.6 (D14): the ISO Action plan tab's "Export PDF" button, client or
// internal version. The SERVER decides both which actions appear (client version:
// isClientVisibleRecord, same gate every other client-facing ISO data goes through) and how
// they're grouped (standard/owner/finding, mirroring iso-core.js's own client-side
// buildActionPlanModel — replicated here, not shared, since that function reads _act's client-side
// cache directly and has no server-side equivalent to call into) — a client-version PDF must never
// depend on the browser to decide what's safe to draw. Every row field is hand-picked onto the
// output object (never a raw iso_actions row, never even for the internal version) so there is no
// path for a CAPA field, an internal note, or a raw owner_uid to end up in a jsPDF cell by
// accident — a field allowlist by construction, not a blocklist applied to someone else's object.
// ── Release-1 B3.5 (plan 10.2, D36): the gap-analysis workbook, one per standard ───────────────
// export.dataset builds the rows for one board + standard, projected through EXPORT_FIELDS — display
// names, never uids; no record ids, stable_key or storage paths; no internal-only field (interview
// notes, auditor observations, internal notes, internal comments) and no internal-visibility action
// in Linked Actions — these workbooks may be sent to clients. export.gapAnalysis fills the template
// (api/_isoExport.js, direct XML) and returns the file. Staff only.
const isoExport = require('./_isoExport.js');
const GAP_TEMPLATE_PATH = require('path').join(__dirname, '..', 'iso', 'templates', 'gap-analysis-template.xlsx');
const EXPORT_FIELDS = ['clause', 'clauseName', 'requirement', 'currentSystem', 'plannedAction', 'complianceStatus', 'originalStatus', 'workStatus', 'priority', 'owner', 'dueDate', 'progress', 'linkedActions', 'sourceData'];
const EXPORT_STATUS = { compliant: 'Fully conforming', partially_compliant: 'Partially conforming', non_compliant: 'Not conforming', not_assessed: 'To be updated', not_applicable: 'Not applicable', out_of_scope: '' };
const EXPORT_BASELINE = { implemented_effective: 'Fully conforming', partially_implemented: 'Partially conforming', implemented_ineffective: 'Partially conforming', not_implemented: 'Not conforming', no_evidence_provided: 'Not conforming' };
const EXPORT_GAP_LABEL = { not_implemented: 'Not implemented', ineffective: 'Implemented but ineffective', no_evidence: 'No evidence provided' };
const EXPORT_PRIORITY = { crit: 'High', high: 'High', med: 'Medium', low: 'Low' };
const EXPORT_PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };
// Status onto the template's own list; the basis carries the gap reason and the OFI in front (D36/D44).
function exportStatusAndBasis(r) {
  const cs = r.compliance_status || 'not_assessed';
  const status = cs in EXPORT_STATUS ? EXPORT_STATUS[cs] : EXPORT_STATUS.not_assessed;
  const why = String(r.na_justification || '').trim();
  if (cs === 'not_applicable') return { status, basis: 'Not applicable' + (why ? ' — ' + why : '') };
  if (cs === 'out_of_scope') return { status, basis: "Outside this audit's scope" + (why ? ' — ' + why : '') };
  const basis = String(r.current_system || '').trim();
  const gap = r.gap_reason && EXPORT_GAP_LABEL[r.gap_reason] ? `Gap reason: ${EXPORT_GAP_LABEL[r.gap_reason]}. ` : '';
  const ofi = r.ofi && (cs === 'compliant' || cs === 'partially_compliant') ? 'OFI: ' + (String(r.ofi_note || '').trim() ? String(r.ofi_note).trim() + ' — ' : '') : '';
  return { status, basis: gap + ofi + basis };
}
// Plan §11 roll-ups over the clause's confirmed linked actions (direct, or through its findings).
function workStatusOf(actions) {
  if (!actions.length) return 'Not started';
  if (actions.every(a => ['verified', 'closed'].includes(a.status))) return 'Complete';
  if (actions.some(a => a.status === 'on_hold')) return 'On hold';
  if (actions.some(a => ['in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required', 'ready_for_verification'].includes(a.status))) return 'In progress';
  return 'Planned';
}
async function exportDataset(ctx, standard) {
  const audit = ctx.audit;
  const reqs = (await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 }))
    .filter(r => r.standard_code === standard).sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0));
  const actions = (await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 }));
  const actionById = new Map(actions.map(a => [a.id, a]));
  const links = actions.length ? await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: actions.map(a => a.id) }, { field: 'link_state', op: 'eq', value: 'confirmed' }] }) : [];
  const findings = await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'archived_at', op: 'isnull' }] });
  const fReq = findings.length ? await ctx.db.list('iso_finding_requirements', { where: [{ field: 'finding_id', op: 'in', value: findings.map(f => f.id) }] }) : [];
  const reqOfFinding = new Map(fReq.map(l => [l.finding_id, l.requirement_id]));
  const actionsByReq = new Map(), reqsByAction = new Map();
  for (const l of links) {
    const rid = l.target_type === 'requirement' ? l.target_id : l.target_type === 'finding' ? reqOfFinding.get(l.target_id) : null;
    if (!rid || !actionById.has(l.action_id)) continue;
    if (!actionsByReq.has(rid)) actionsByReq.set(rid, new Set()); actionsByReq.get(rid).add(l.action_id);
    if (!reqsByAction.has(l.action_id)) reqsByAction.set(l.action_id, new Set()); reqsByAction.get(l.action_id).add(rid);
  }
  const evLinks = (await ctx.db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }, { field: 'target_type', op: 'eq', value: 'requirement' }] })).filter(l => !DEAD_LINK_STATUSES.includes(l.review_status));
  const comments = await ctx.db.list('iso_comments', { where: [{ field: 'audit_id', op: 'eq', value: audit.id }] }).catch(() => []);
  const subtasks = actions.length ? await ctx.db.list('iso_action_subtasks', { where: [{ field: 'action_id', op: 'in', value: actions.map(a => a.id) }, { field: 'archived_at', op: 'isnull' }] }) : [];
  const names = new Map();
  const nameOf = async uid => { if (!uid) return ''; if (!names.has(uid)) names.set(uid, (await ctx.getStaffName(uid)) || ''); return names.get(uid); };
  const short = ref => (String(ref || '').match(/A\d+$/) || [String(ref || '')])[0];
  const rows = [];
  for (const r of reqs) {
    const { status, basis } = exportStatusAndBasis(r);
    const acts = [...(actionsByReq.get(r.id) || [])].map(id => actionById.get(id));
    const open = acts.filter(a => !['verified', 'closed'].includes(a.status));
    const priority = open.map(a => EXPORT_PRIORITY[a.priority]).filter(Boolean).sort((x, y) => EXPORT_PRIORITY_RANK[y] - EXPORT_PRIORITY_RANK[x])[0] || '';
    const progress = acts.length ? acts.reduce((s, a) => s + (Number(a.progress) || 0), 0) / acts.length / 100 : 0;
    const linkedActions = acts.filter(a => a.visibility && a.visibility !== 'internal').map(a => `${short(a.ref)} ${a.title}`).join('; ');
    const owner = await nameOf(r.responsible_uid);
    const original = audit.previous_audit_id ? (EXPORT_BASELINE[r.baseline_result] || '') : '';
    const work = workStatusOf(acts);
    const row = {
      clause: r.clause, clauseName: r.clause_name || '', requirement: r.requirement_text || '', currentSystem: basis, plannedAction: r.recommended_action || '',
      complianceStatus: status, originalStatus: original, workStatus: work, priority, owner, dueDate: r.target_date || null, progress, linkedActions,
      sourceData: {
        standard: `ISO ${standard}`, clause: r.clause, clauseName: r.clause_name || '', requirement: r.requirement_text || '', currentSystem: basis, plannedAction: r.recommended_action || '',
        complianceStatus: status, originalComplianceStatus: original, workStatus: work, priority, owner, dueDate: r.target_date || '', progressPercent: Math.round(progress * 100),
        evidenceCount: evLinks.filter(l => l.target_id === r.id).length, notesCount: comments.filter(c => c.entity_type === 'requirement' && c.entity_id === r.id).length,
        subtaskCount: subtasks.filter(s => acts.some(a => a.id === s.action_id)).length, sharedActions: acts.filter(a => (reqsByAction.get(a.id) || new Set()).size > 1).length,
        sourceSheet: (r.imported && r.imported.sheet) || '', sourceRow: (r.imported && r.imported.row != null) ? String(r.imported.row) : '',
        sourceChanged: !!r.source_changed, missingFromSource: !!r.missing_from_source, manual: !(r.origin === 'library' || r.library_requirement_id), archived: false, updatedAt: r.updated_at || '',
      },
    };
    rows.push(Object.fromEntries(EXPORT_FIELDS.map(k => [k, row[k]])));
  }
  return { standard, auditRef: audit.ref, dataAsAt: await boardToday(ctx), rows };
}
function checkExportStandard(payload, ctx) {
  if (!/^\d{4,5}$/.test(String(payload.standard || ''))) throw badRequest('Pick a standard.');
}
async function boardStandardCodes(ctx) {
  const as = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
  const codes = [];
  for (const x of as) { const v = await ctx.db.get('iso_standard_versions', x.version_id); if (v) codes.push(v.standard_code); }
  return codes;
}
defineOp('export.dataset', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload, ctx) { checkExportStandard(payload, ctx); },
  async run(ctx) {
    if (!(await boardStandardCodes(ctx)).includes(ctx.payload.standard)) throw badRequest('That standard is not on this board.');
    return exportDataset(ctx, ctx.payload.standard);
  },
});
defineOp('export.gapAnalysis', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload, ctx) { checkExportStandard(payload, ctx); },
  async run(ctx) {
    if (!(await boardStandardCodes(ctx)).includes(ctx.payload.standard)) throw badRequest('That standard is not on this board.');
    const ds = await exportDataset(ctx, ctx.payload.standard);
    const filled = isoExport.fillGapAnalysis(require('fs').readFileSync(GAP_TEMPLATE_PATH), ds);
    const filename = `${ctx.audit.ref}_ISO${ctx.payload.standard}_Gap_Analysis.xlsx`;
    await ctx.db.log({ audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'audit', entity_id: ctx.audit.id, entity_ref: ctx.audit.ref,
      action: 'exported', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind, after: { kind: 'gap_analysis', standard: ctx.payload.standard, rows: ds.rows.length, filename } });
    return { filename, rows: ds.rows.length, base64: filled.buffer.toString('base64') };
  },
});

defineOp('export.gantt', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const a = ctx.audit;
    const clientVersion = !!ctx.payload.clientVersion;
    const groupBy = ['standard', 'owner', 'finding'].includes(ctx.payload.groupBy) ? ctx.payload.groupBy : 'standard';

    const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
    const standards = [];
    for (const as of auditStandards) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) standards.push(v.standard_code); }

    let actions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }], limit: 2000 });
    actions = actions.filter(x => x.start_date || x.due_date); // nothing to draw otherwise, same rule the on-screen Gantt uses
    if (clientVersion) actions = actions.filter(isClientVisibleRecord);

    // Standard/finding grouping needs the same action -> link -> finding -> requirement chain
    // A54/A55's own client-side code already resolves (action.link, confirmed only).
    const actionIds = actions.map(x => x.id);
    const links = actionIds.length ? await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'in', value: actionIds }, { field: 'link_state', op: 'eq', value: 'confirmed' }] }) : [];
    const linksByAction = new Map();
    for (const l of links) { if (!linksByAction.has(l.action_id)) linksByAction.set(l.action_id, []); linksByAction.get(l.action_id).push(l); }
    const findingIds = [...new Set(links.filter(l => l.target_type === 'finding').map(l => l.target_id))];
    const findingsById = {};
    for (const fid of findingIds) { const f = await ctx.db.get('iso_findings', fid); if (f) findingsById[fid] = f; }
    const reqIds = new Set();
    for (const f of Object.values(findingsById)) if (f.requirement_id) reqIds.add(f.requirement_id);
    for (const l of links) if (l.target_type === 'requirement') reqIds.add(l.target_id);
    const requirementsById = {};
    for (const rid of reqIds) { const r = await ctx.db.get('iso_requirements', rid); if (r) requirementsById[rid] = r; }

    const groupKeyFor = (act) => {
      const myLinks = linksByAction.get(act.id) || [];
      if (groupBy === 'owner') return act.owner_uid || '__none';
      const findingLink = myLinks.find(l => l.target_type === 'finding');
      if (groupBy === 'finding') return findingLink ? findingLink.target_id : '__none';
      let reqId = null;
      if (findingLink) { const f = findingsById[findingLink.target_id]; reqId = f ? f.requirement_id : null; }
      else { const reqLink = myLinks.find(l => l.target_type === 'requirement'); reqId = reqLink ? reqLink.target_id : null; }
      const req = reqId ? requirementsById[reqId] : null;
      return req ? req.standard_code : '__none';
    };
    const groupLabelFor = async (key) => {
      if (groupBy === 'owner') return key === '__none' ? 'Unassigned' : ((await ctx.getStaffName(key)) || 'Unassigned');
      if (groupBy === 'finding') { if (key === '__none') return 'Not linked to a finding'; const f = findingsById[key]; return f ? (f.ref + ' — ' + f.title) : key; }
      return key === '__none' ? 'No standard' : ('ISO ' + key);
    };

    const groups = new Map();
    for (const act of actions) { const k = groupKeyFor(act); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(act); }
    const today = ctx.now.toISOString().slice(0, 10);
    const sections = [];
    for (const [key, acts] of groups) {
      const rows = [];
      for (const act of acts) {
        const overdue = act.due_date && act.due_date < today && !ACTION_CLOSED_STATUSES.includes(act.status);
        const ownerName = act.owner_uid ? await ctx.getStaffName(act.owner_uid) : null;
        rows.push({
          id: act.id, ref: act.ref, name: act.ref + ' — ' + act.title,
          start: act.start_date || null, end: act.due_date || null,
          color: overdue ? '#b91c1c' : (ACTION_CLOSED_STATUSES.includes(act.status) ? '#0d6e4e' : '#6b8399'),
          ownerName: ownerName || 'Unassigned', status: act.status, progress: act.progress || 0,
        });
      }
      sections.push({ id: key, label: await groupLabelFor(key), rows });
    }

    return {
      ref: a.ref, title: a.title, clientName: await ctx.getClientName(a.client_id),
      standards, dataAsAt: ctx.now.toISOString(), clientVersion, groupBy, sections,
    };
  },
});

// ── import.* / library.* — Phase 4: standard library and workbook import ───────────────────────
// The browser (iso/iso-import.js) parses the .xlsx and sends rows here (plan §3.4); these ops own
// the DB-facing orchestration (fetching current state, calling api/_isoImport.js's pure diff/merge
// builders, writing atomically through ctx.db.importApply). Both import.preview and import.apply
// take payload.kind: 'library' | 'audit' — one pair of ops covers both targets (plan §4.4 names
// exactly these four ops, not eight).
async function fetchAuditImportContext(ctx, auditId) {
  const auditRecord = await ctx.db.get('iso_audits', auditId);
  if (!auditRecord || auditRecord.archived_at) throw notFound('Audit not found.');
  const auditStandards = await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: auditRecord.id }] });
  const pinnedVersionByStandard = {}, librarySectionsByVersion = {}, libraryReqsByVersion = {};
  for (const as of auditStandards) {
    const version = await ctx.db.get('iso_standard_versions', as.version_id);
    if (!version) continue;
    pinnedVersionByStandard[version.standard_code] = version;
    librarySectionsByVersion[version.standard_code] = await ctx.db.list('iso_clause_sections', { where: [{ field: 'version_id', op: 'eq', value: version.id }] });
    libraryReqsByVersion[version.standard_code] = await ctx.db.list('iso_library_requirements', { where: [{ field: 'version_id', op: 'eq', value: version.id }] });
  }
  const existingRequirements = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: auditRecord.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
  const existingActions = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: auditRecord.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
  const existingActionLinks = [];
  for (const a of existingActions) existingActionLinks.push(...await ctx.db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: a.id }] }));
  return { auditRecord, pinnedVersionByStandard, librarySectionsByVersion, libraryReqsByVersion, existingRequirements, existingActions, existingActionLinks };
}
async function fetchLibraryImportContext(ctx, standardsPresent) {
  const existingVersionByStandard = {}, existingSectionsByVersion = {}, existingLibReqsByVersion = {};
  for (const standard of standardsPresent) {
    const versions = await ctx.db.list('iso_standard_versions', { where: [{ field: 'standard_code', op: 'eq', value: standard }] });
    // A workbook import names no edition, so it only ever merges into an edition-less draft — never
    // into a seeded edition's draft (plan 4b.1), which would silently relabel that edition's text.
    const draft = versions.find(v => v.status === 'draft' && !v.edition) || null;
    existingVersionByStandard[standard] = draft;
    existingSectionsByVersion[standard] = draft ? await ctx.db.list('iso_clause_sections', { where: [{ field: 'version_id', op: 'eq', value: draft.id }] }) : [];
    existingLibReqsByVersion[standard] = draft ? await ctx.db.list('iso_library_requirements', { where: [{ field: 'version_id', op: 'eq', value: draft.id }] }) : [];
  }
  return { existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion };
}
function auditImportSummary(auditRecord, plan, candidates) {
  return { kind: 'audit', targetAuditId: auditRecord.id, requirements: plan.summary.requirements, actions: plan.summary.actions, warnings: plan.warnings, sheetCounts: countByStandard(candidates.items) };
}
function libraryImportSummary(plan) {
  return { kind: 'library', perStandard: plan.perStandard.map(p => ({ standard: p.standard, versionId: p.versionId, isNewVersion: p.isNewVersion, versionLabel: p.versionLabel, summary: p.summary })), warnings: plan.warnings };
}

defineOp('import.preview', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && ['admin', 'pm', 'staff'].includes(ctx.caller.role); },
  async validate(payload) {
    if (!['library', 'audit'].includes(payload.kind)) throw badRequest('Invalid import kind.');
    if (payload.kind === 'audit' && !isValidId(payload.targetAuditId)) throw badRequest('A target audit is required.');
  },
  async run(ctx) {
    const candidates = isoImport.validateCandidates(ctx.payload);
    let plan, summary, targetAuditId = null, targetVersionId = null;

    if (ctx.payload.kind === 'audit') {
      const { auditRecord, pinnedVersionByStandard, librarySectionsByVersion, libraryReqsByVersion, existingRequirements, existingActions, existingActionLinks } =
        await fetchAuditImportContext(ctx, ctx.payload.targetAuditId);
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: auditRecord.id }] });
      const membership = resolveMembership(ctx.caller, auditRecord, members);
      if (!(ctx.caller.role === 'admin' || (membership && membership.audit_role === 'audit_manager'))) throw forbidden('Only the audit manager can import a workbook into this board.');
      targetAuditId = auditRecord.id;
      plan = isoImport.computeAuditPlan({
        auditId: auditRecord.id, clientId: auditRecord.client_id, auditRef: auditRecord.ref,
        candidateSections: candidates.sections, candidateItems: candidates.items, todoRows: candidates.todoRows,
        warnings: candidates.warnings.slice(), pinnedVersionByStandard, librarySectionsByVersion, libraryReqsByVersion,
        existingRequirements, existingActions, existingActionLinks, seedShared: isoImport.loadSeedShared(),
        workbookSha256: candidates.sha256, actionNumbers: candidates.todoRows.map(() => 0), actorUid: ctx.caller.uid, now: ctx.now,
      });
      summary = auditImportSummary(auditRecord, plan, candidates);
    } else {
      if (ctx.caller.role !== 'admin') throw forbidden('Only an admin can import into the standard library.');
      const standardsPresent = [...new Set(candidates.items.map(i => i.standard))];
      const { existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion } = await fetchLibraryImportContext(ctx, standardsPresent);
      plan = isoImport.computeLibraryPlan({
        candidateSections: candidates.sections, candidateItems: candidates.items,
        existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion,
        sourceFilename: candidates.sourceFilename, sha256: candidates.sha256, actorUid: ctx.caller.uid, now: ctx.now,
      });
      summary = libraryImportSummary(plan);
      targetVersionId = (plan.perStandard[0] && plan.perStandard[0].versionId) || null;
    }

    const diffSha256 = isoImport.diffFingerprint(summary);
    const priorApplied = await ctx.db.list('iso_import_runs', { where: [{ field: 'sha256', op: 'eq', value: candidates.sha256 }, { field: 'status', op: 'eq', value: 'applied' }], order: 'at desc', limit: 20 });
    const duplicateOf = priorApplied.find(r => (ctx.payload.kind === 'audit' ? r.target_audit_id === targetAuditId : r.target_version_id === targetVersionId)) || null;

    const run = await ctx.db.insert('iso_import_runs', {
      id: uid('irun_'), kind: ctx.payload.kind, source_filename: candidates.sourceFilename, sha256: candidates.sha256,
      target_version_id: targetVersionId, target_audit_id: targetAuditId, dry_run: true, summary, diff_sha256: diffSha256,
      status: 'previewed', performed_by: ctx.caller.uid,
    });

    return { runId: run.id, diffSha256, summary, duplicateOf: duplicateOf ? { at: duplicateOf.at, performedBy: duplicateOf.performed_by } : null };
  },
});

defineOp('import.apply', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && ['admin', 'pm', 'staff'].includes(ctx.caller.role); },
  async validate(payload) { if (!isValidId(payload.runId)) throw badRequest('A runId is required.'); },
  async run(ctx) {
    const run = await ctx.db.get('iso_import_runs', ctx.payload.runId);
    if (!run) throw notFound('Import run not found.');
    if (run.status === 'applied') throw badRequest('This import has already been applied.');
    const candidates = isoImport.validateCandidates(ctx.payload);
    if (candidates.sha256 !== run.sha256) throw badRequest('The resubmitted workbook does not match the one that was previewed.');

    const priorApplied = await ctx.db.list('iso_import_runs', { where: [{ field: 'sha256', op: 'eq', value: candidates.sha256 }, { field: 'status', op: 'eq', value: 'applied' }], order: 'at desc', limit: 20 });
    const duplicate = priorApplied.find(r => (run.kind === 'audit' ? r.target_audit_id === run.target_audit_id : r.target_version_id === run.target_version_id));
    if (duplicate && !ctx.payload.confirmDuplicate) {
      throw badRequest(`This exact file was already applied on ${duplicate.at} by ${duplicate.performed_by}. Confirm to import anyway.`);
    }

    let plan, summary, auditRecord = null;
    if (run.kind === 'audit') {
      const fetched = await fetchAuditImportContext(ctx, run.target_audit_id);
      auditRecord = fetched.auditRecord;
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: auditRecord.id }] });
      const membership = resolveMembership(ctx.caller, auditRecord, members);
      if (!(ctx.caller.role === 'admin' || (membership && membership.audit_role === 'audit_manager'))) throw forbidden('Only the audit manager can apply an import into this board.');
      // Real ref numbers are minted only now, right before the atomic apply (numbering is
      // server/DB-only). A rejected or failed apply after this point leaves a small hole in the
      // audit's :A counter — the same trade-off audit.create's own insertNumbered already accepts
      // elsewhere in this file (plan §14 A27).
      const actionNumbers = [];
      for (let i = 0; i < candidates.todoRows.length; i++) actionNumbers.push(await ctx.db.counterNext(auditRecord.id + ':A'));
      plan = isoImport.computeAuditPlan({
        auditId: auditRecord.id, clientId: auditRecord.client_id, auditRef: auditRecord.ref,
        candidateSections: candidates.sections, candidateItems: candidates.items, todoRows: candidates.todoRows,
        warnings: candidates.warnings.slice(), pinnedVersionByStandard: fetched.pinnedVersionByStandard,
        librarySectionsByVersion: fetched.librarySectionsByVersion, libraryReqsByVersion: fetched.libraryReqsByVersion,
        existingRequirements: fetched.existingRequirements, existingActions: fetched.existingActions, existingActionLinks: fetched.existingActionLinks,
        seedShared: isoImport.loadSeedShared(), workbookSha256: candidates.sha256, actionNumbers, actorUid: ctx.caller.uid, now: ctx.now,
      });
      summary = auditImportSummary(auditRecord, plan, candidates);
    } else {
      if (ctx.caller.role !== 'admin') throw forbidden('Only an admin can import into the standard library.');
      const standardsPresent = [...new Set(candidates.items.map(i => i.standard))];
      const { existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion } = await fetchLibraryImportContext(ctx, standardsPresent);
      plan = isoImport.computeLibraryPlan({
        candidateSections: candidates.sections, candidateItems: candidates.items,
        existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion,
        sourceFilename: candidates.sourceFilename, sha256: candidates.sha256, actorUid: ctx.caller.uid, now: ctx.now,
      });
      summary = libraryImportSummary(plan);
    }

    const diffSha256 = isoImport.diffFingerprint(summary);
    if (diffSha256 !== run.diff_sha256) throw conflict('This target changed since the preview was generated — please preview again.');

    const allOps = run.kind === 'audit' ? [...plan.ops, ...plan.actionOps, ...plan.actionLinkOps] : plan.perStandard.flatMap(p => p.ops);
    try {
      await ctx.db.importApply(run.id, allOps);
    } catch (e) {
      await ctx.db.patchRow('iso_import_runs', run.id, { status: 'failed', at: ctx.now.toISOString() });
      throw e;
    }

    await ctx.db.log({
      audit_id: run.kind === 'audit' ? auditRecord.id : null, client_id: run.kind === 'audit' ? auditRecord.client_id : null,
      entity_type: 'import', entity_id: run.id, action: 'applied', source: 'import', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });

    return { runId: run.id, summary };
  },
});

defineOp('library.versions', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) { return ctx.db.list('iso_standard_versions', { order: 'standard_code asc' }); },
});

defineOp('library.approve', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.role === 'admin'; },
  async validate(payload) { if (!isValidId(payload.id)) throw badRequest('A version id is required.'); },
  async run(ctx) {
    const version = await ctx.db.get('iso_standard_versions', ctx.payload.id);
    if (!version) throw notFound('Library version not found.');
    if (version.status !== 'draft') throw badRequest('Only a draft version can be approved.');
    const updated = await ctx.db.patchRow('iso_standard_versions', version.id, {
      status: 'approved', approved_by: ctx.caller.uid, approved_at: ctx.now.toISOString(),
    });
    await ctx.db.log({
      audit_id: null, client_id: null, entity_type: 'library_version', entity_id: version.id,
      action: 'approved', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    return updated;
  },
});

// library.retire — the user-requested "how do I remove it" op. Never a real delete (hard rule: ISO
// records are archived, never deleted — the same reason iso_no_hard_delete raises on every
// substantive table): a version is marked `retired`, which pickApprovedVersion already excludes
// (its filter is `status === 'approved'`, so nothing else changed there) and which library.approve
// already refuses to re-approve (`status !== 'draft'`). Works on either a draft nobody ever used
// (the UI calls this "Discard draft") or an approved edition no longer wanted for new boards (the
// UI calls this "Retire") — same op, same guarantee: existing boards already on that version are
// completely unaffected, since requirement.list reads iso_requirements, never iso_standard_versions.
defineOp('library.retire', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.role === 'admin'; },
  async validate(payload) { if (!isValidId(payload.id)) throw badRequest('A version id is required.'); },
  async run(ctx) {
    const version = await ctx.db.get('iso_standard_versions', ctx.payload.id);
    if (!version) throw notFound('Library version not found.');
    if (version.status === 'retired') throw badRequest('That version is already retired.');
    const wasApproved = version.status === 'approved';
    const updated = await ctx.db.patchRow('iso_standard_versions', version.id, { status: 'retired' });
    await ctx.db.log({
      audit_id: null, client_id: null, entity_type: 'library_version', entity_id: version.id,
      action: wasApproved ? 'retired' : 'draft_discarded', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    return updated;
  },
});

// library.seeds / library.loadSeed — plan 4b.1 (R13, D24): the built-in library, so nobody has to
// upload the workbook. A seed is the exact payload a workbook import would produce (library columns
// only), run through the same computeLibraryPlan + importApply path the import uses — no second
// loader to drift from it. Explicit and idempotent rather than automatic at start-up: a hidden
// start-up load would add 236 rows to every fresh store, including every test suite's.
function seedSummary(seed, versions) {
  const v = versions.find(x => x.standard_code === seed.standardCode && x.edition === seed.edition) || null;
  return {
    seedKey: seed.seedKey, standardCode: seed.standardCode, edition: seed.edition, label: seed.label,
    seedStatus: seed.status, scopeNote: seed.scopeNote || null, requirementCount: seed.items.length,
    basedOn: seed.basedOn || null, changes: (seed.changes || []).map(c => resolveChange(seed, c)),
    loadedVersionId: v ? v.id : null, loadedStatus: v ? v.status : null,
  };
}
defineOp('library.seeds', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) {
    const versions = await ctx.db.list('iso_standard_versions', {});
    return LIBRARY_SEEDS.map(s => seedSummary(s, versions));
  },
});
defineOp('library.loadSeed', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.role === 'admin'; },
  async validate(payload) {
    if (payload.seedKey != null && !LIBRARY_SEEDS.some(s => s.seedKey === payload.seedKey)) throw badRequest('Unknown built-in library.');
  },
  async run(ctx) {
    // "Load all" loads the reviewed (approved) seeds only; a drafted edition is loaded by its own key,
    // for review, and stays draft until an admin approves it (4b.2).
    const wanted = ctx.payload.seedKey ? LIBRARY_SEEDS.filter(s => s.seedKey === ctx.payload.seedKey) : LIBRARY_SEEDS.filter(s => s.status === 'approved');
    const results = [];
    for (const seed of wanted) {
      const existing = (await ctx.db.list('iso_standard_versions', { where: [{ field: 'standard_code', op: 'eq', value: seed.standardCode }, { field: 'edition', op: 'eq', value: seed.edition }] }))[0];
      if (existing) { results.push({ seedKey: seed.seedKey, skipped: true, versionId: existing.id, status: existing.status }); continue; }
      const candidates = isoImport.validateCandidates({ sha256: seed.sourceSha256, sourceFilename: seed.sourceFilename, sections: seed.sections, items: seed.items, todoRows: [] });
      const plan = isoImport.computeLibraryPlan({
        candidateSections: candidates.sections, candidateItems: candidates.items,
        existingVersionByStandard: {}, existingSectionsByVersion: {}, existingLibReqsByVersion: {},
        sourceFilename: seed.sourceFilename, sha256: seed.sourceSha256, actorUid: ctx.caller.uid, now: ctx.now,
        editionByStandard: { [seed.standardCode]: seed.edition }, labelByStandard: { [seed.standardCode]: seed.label },
      });
      const p = plan.perStandard[0];
      await ctx.db.importApply(uid('iseed_'), p.ops);
      // A reviewed seed marked approved is the approval (it was reviewed in the code); a seed marked
      // draft — e.g. a new edition still to be checked against the licensed standard — stays draft
      // for an admin to approve through the normal library.approve.
      let version = await ctx.db.get('iso_standard_versions', p.versionId);
      if (seed.status === 'approved') {
        version = await ctx.db.patchRow('iso_standard_versions', p.versionId, { status: 'approved', approved_by: ctx.caller.uid, approved_at: ctx.now.toISOString() });
      }
      await ctx.db.log({
        audit_id: null, client_id: null, entity_type: 'library_version', entity_id: p.versionId,
        action: 'seed_loaded', source: 'import', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
        after: { seedKey: seed.seedKey, edition: seed.edition, status: version.status },
      });
      results.push({ seedKey: seed.seedKey, skipped: false, versionId: p.versionId, status: version.status, requirements: p.summary.requirements.created });
    }
    return results;
  },
});

// ── Release-1 B5.2: formal reports (Phase 11, Q11) ──────────────────────────────────────────────
// Three templates chosen from the board: Audit report, Follow-up report (audit type follow_up),
// Maintenance report (a board that follows another). One draft per board holds the narrative the
// auditor writes; everything else is pre-filled from the setup, findings and a frozen snapshot.
// A Ready-to-report check blocks issue while any clause lacks its basis, is unapproved or derived and
// unconfirmed, or a finding is unclassified. Issue freezes a snapshot (kind 'report') and an immutable
// version n; reissue makes n+1 and keeps n. The client's acknowledgement is recorded as "received and
// discussed" — never "agreed". The PDF is drawn in the browser from the frozen version.
const REPORT_KINDS = ['audit', 'follow_up', 'maintenance'];
const REPORT_KIND_TITLE = { audit: 'Audit report', follow_up: 'Follow-up report', maintenance: 'Maintenance report' };
const REPORT_NARRATIVE = ['executiveSummary', 'method', 'objectivesAchieved', 'goodPractice', 'conclusion'];
const ACK_WORDING = 'Received and discussed';
const REPORT_DISCLAIMER = "Requirement wording in this report is Etcher's plain-language interpretation of each clause, not the text of the standard. The licensed ISO standard is the authoritative wording.";
function reportKindFor(audit) { return audit.audit_type === 'follow_up' ? 'follow_up' : audit.previous_audit_id ? 'maintenance' : 'audit'; }
async function reportReadiness(ctx) {
  const reqs = await ctx.db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }], limit: 5000 });
  const findings = await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] });
  const classes = await findingClassifications(ctx);
  const ref = r => `${r.standard_code} ${r.clause}`;
  const assessed = reqs.filter(r => !['not_assessed', 'out_of_scope'].includes(r.compliance_status || 'not_assessed'));
  const blockers = [
    { key: 'basis', label: 'Basis or gap reason missing', items: assessed.filter(r => !r.derived_from_id && basisProblem(r)).map(ref) },
    { key: 'unapproved', label: 'Not yet approved by the Lead', items: assessed.filter(r => ['proposed', 'returned'].includes(r.approval_state)).map(ref) },
    { key: 'derived', label: 'Derived status not confirmed', items: reqs.filter(r => r.derived_from_id).map(ref) },
    { key: 'unclassified', label: 'Finding without a classification', items: findings.filter(f => f.status !== 'withdrawn' && !classes.includes(f.classification)).map(f => f.ref) },
  ];
  return { ready: blockers.every(b => !b.items.length), blockers, notAssessed: reqs.filter(r => (r.compliance_status || 'not_assessed') === 'not_assessed').length };
}
async function boardDraft(ctx) {
  return (await ctx.db.list('iso_reports', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] }))[0] || null;
}
function cleanNarrative(raw) {
  const out = {};
  for (const k of REPORT_NARRATIVE) {
    const v = raw && raw[k];
    if (v == null || v === '') { out[k] = null; continue; }
    if (typeof v !== 'string' || v.length > 20000) throw badRequest('A report section is too long.');
    out[k] = v.trim() || null;
  }
  return out;
}
defineOp('report.readiness', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return reportReadiness(ctx); },
});
defineOp('report.get', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) {
    const draft = await boardDraft(ctx);
    const versions = (await ctx.db.list('iso_report_versions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] })).sort((a, b) => a.version_no - b.version_no);
    const acks = await ctx.db.list('iso_report_acknowledgements', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] });
    const kind = reportKindFor(ctx.audit);
    return { kind, title: REPORT_KIND_TITLE[kind], draft, versions: versions.map(v => ({ ...v, acknowledgements: acks.filter(a => a.version_id === v.id) })), readiness: await reportReadiness(ctx) };
  },
});
defineOp('report.saveDraft', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && (ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager', 'auditor'].includes(ctx.membership.audit_role)); },
  async validate(payload) { if (payload.title != null && !isNonEmptyText(payload.title, 200)) throw badRequest('Invalid title.'); },
  async run(ctx) {
    const sections = cleanNarrative(ctx.payload.sections || {});
    const existing = await boardDraft(ctx);
    const activity = { audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'report', action: 'report_draft_saved', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind };
    if (!existing) {
      // Numbered like findings / actions (<board>-R001) through the shared counter, which both adapters have.
      const n = await ctx.db.counterNext(ctx.audit.id + ':R');
      return ctx.db.insert('iso_reports', {
        id: uid('irep_'), ref: `${ctx.audit.ref}-R${String(n).padStart(3, '0')}`, audit_id: ctx.audit.id, client_id: ctx.audit.client_id, kind: reportKindFor(ctx.audit), title: ctx.payload.title || REPORT_KIND_TITLE[reportKindFor(ctx.audit)],
        status: 'draft', config: { sections }, current_version: 0, row_version: 1, created_by: ctx.caller.uid, updated_by: ctx.caller.uid,
        created_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString(),
      }, activity);
    }
    if (ctx.payload.expectedVersion == null) throw badRequest('expectedVersion is required.');
    try { return await ctx.db.update('iso_reports', existing.id, { config: { sections }, ...(ctx.payload.title ? { title: ctx.payload.title } : {}) }, ctx.payload.expectedVersion, { ...activity, entity_id: existing.id, entity_ref: existing.ref }); }
    catch (e) { if (e.code === 'version_conflict') throw conflict(); throw e; }
  },
});
defineOp('report.issue', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && (ctx.caller.role === 'admin' || ['lead_auditor', 'audit_manager'].includes(ctx.membership.audit_role)); },
  async validate(payload) { if (payload.reason != null && (typeof payload.reason !== 'string' || payload.reason.length > 1000)) throw badRequest('The reason is too long.'); },
  async run(ctx) {
    const readiness = await reportReadiness(ctx);
    if (!readiness.ready) throw badRequest('Not ready to report: ' + readiness.blockers.filter(b => b.items.length).map(b => `${b.label} (${b.items.slice(0, 6).join(', ')}${b.items.length > 6 ? ', …' : ''})`).join('; ') + '.');
    const draft = await boardDraft(ctx);
    if (!draft) throw badRequest('Save the report draft first.');
    const prior = (await ctx.db.list('iso_report_versions', { where: [{ field: 'report_id', op: 'eq', value: draft.id }] })).sort((a, b) => b.version_no - a.version_no)[0] || null;
    if (prior && !String(ctx.payload.reason || '').trim()) throw badRequest('Say why this report is being reissued.');
    const snap = await writeAuditSnapshot(ctx, ctx.audit, 'report');
    // Everything the PDF shows, frozen: the narrative, the setup, the team, the findings and actions, the snapshot.
    const members = ctx.members.filter(m => m.member_kind === 'staff');
    const team = [];
    for (const m of members) team.push({ name: (await ctx.getStaffName(m.user_uid)) || m.user_uid, role: m.audit_role });
    const findings = (await ctx.db.list('iso_findings', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] })).filter(f => f.status !== 'withdrawn')
      .map(f => ({ ref: f.ref, title: f.title, classification: f.classification, status: f.status, statement: f.statement || null, criteria: f.criteria || null, repeatOf: f.repeat_of_ref || null, carriedFrom: f.carried_from_ref || null }));
    const actions = (await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }, { field: 'archived_at', op: 'isnull' }] }))
      .map(a => ({ ref: a.ref, title: a.title, status: a.status, verification: a.verification_status, due: a.due_date || null, carriedFrom: a.carried_from_ref || null }));
    const standards = [];
    for (const as of await ctx.db.list('iso_audit_standards', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] })) { const v = await ctx.db.get('iso_standard_versions', as.version_id); if (v) standards.push({ code: v.standard_code, edition: v.edition || null }); }
    const signer = (await ctx.getStaffName(ctx.caller.uid)) || ctx.caller.uid;
    const versionNo = prior ? prior.version_no + 1 : 1;
    const version = await ctx.db.insert('iso_report_versions', {
      id: uid('irv_'), report_id: draft.id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id, version_no: versionNo, kind: draft.kind,
      title: draft.title, snapshot_id: snap.id, supersedes_version_id: prior ? prior.id : null, supersede_reason: prior ? ctx.payload.reason.trim() : null,
      content: { sections: (draft.config && draft.config.sections) || {}, setup: ctx.audit.setup || null, audit: { ref: ctx.audit.ref, title: ctx.audit.title, auditType: ctx.audit.audit_type, plannedStart: ctx.audit.planned_start || null, plannedEnd: ctx.audit.planned_end || null, completedAt: ctx.audit.completed_at || null, clientName: (await ctx.getClientName(ctx.audit.client_id)) || '' },
        standards, team, findings, actions, snapshot: snap.data, libraryRelease: snap.library_release, calcVersion: snap.calc_version, disclaimer: REPORT_DISCLAIMER, signedBy: signer, ackWording: ACK_WORDING },
      issued_at: ctx.now.toISOString(), issued_by: ctx.caller.uid, created_at: ctx.now.toISOString(),
    });
    await ctx.db.update('iso_reports', draft.id, { status: 'issued', current_version: versionNo }, draft.row_version, {
      audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'report', entity_id: draft.id, entity_ref: draft.ref, action: versionNo > 1 ? 'report_reissued' : 'report_issued',
      reason: prior ? ctx.payload.reason.trim() : null, source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind,
    });
    return version;
  },
});
defineOp('report.list', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async run(ctx) { return (await ctx.db.list('iso_report_versions', { where: [{ field: 'audit_id', op: 'eq', value: ctx.audit.id }] })).sort((a, b) => a.version_no - b.version_no); },
});
defineOp('report.acknowledge', {
  scope: 'audit', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff' && canOpenAudit(ctx.caller, ctx.audit, ctx.members); },
  async validate(payload) {
    if (!isValidId(payload.versionId)) throw badRequest('Pick a report version.');
    if (!isNonEmptyText(payload.name, 200)) throw badRequest('Who acknowledged it?');
    if (payload.role != null && (typeof payload.role !== 'string' || payload.role.length > 200)) throw badRequest('The role is too long.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) throw badRequest('The acknowledgement date must be a date.');
  },
  async run(ctx) {
    const v = await ctx.db.get('iso_report_versions', ctx.payload.versionId);
    if (!v || v.audit_id !== ctx.audit.id) throw notFound();
    return ctx.db.insert('iso_report_acknowledgements', {
      id: uid('irack_'), version_id: v.id, report_id: v.report_id, audit_id: ctx.audit.id, client_id: ctx.audit.client_id,
      name: ctx.payload.name.trim(), role: ctx.payload.role ? ctx.payload.role.trim() : null, acknowledged_on: ctx.payload.date, wording: ACK_WORDING,
      recorded_by: ctx.caller.uid, created_at: ctx.now.toISOString(),
    }, { audit_id: ctx.audit.id, client_id: ctx.audit.client_id, entity_type: 'report', entity_id: v.report_id, action: 'report_acknowledged', source: 'user', actor_uid: ctx.caller.uid, actor_kind: ctx.caller.kind });
  },
});

// ── Release-1 B5.1: notifications (plan 7.6, Q11 — in-app only, no scheduler) ───────────────────
// Event notifications are written to iso_notifications after the op that caused them succeeds (a
// failure to notify never fails the op): evidence submitted, awaiting approval, returned, derived
// awaiting confirmation, finding reopened, action assigned. Due reminders (action due within 7 days
// or overdue, effectiveness review due, follow-up / maintenance due, report due) are worked out when
// the bell asks — notification.list — so nothing has to run on a timer. Messages carry refs and
// clause numbers only, never notes or client text.
const ISO_NOTIF_TYPES = ['evidence_submitted', 'awaiting_approval', 'returned', 'derived_awaiting', 'finding_reopened', 'action_assigned'];
function leadUidsOf(ctx) {
  const staff = (ctx.members || []).filter(m => m.member_kind === 'staff');
  const leads = staff.filter(m => m.audit_role === 'lead_auditor');
  return (leads.length ? leads : staff.filter(m => m.audit_role === 'audit_manager')).map(m => m.user_uid);
}
async function notifyUids(ctx, recipients, n) {
  const nowIso = ctx.now.toISOString();
  for (const recipient of new Set((recipients || []).filter(r => r && r !== ctx.caller.uid))) {
    await ctx.db.insert('iso_notifications', { id: uid('inot_'), recipient_uid: recipient, audit_id: ctx.audit ? ctx.audit.id : (n.audit_id || null),
      entity_type: n.entity_type, entity_id: n.entity_id, type: n.type, message: String(n.message).slice(0, 300), read_at: null, dismissed_at: null, created_at: nowIso });
  }
}
const isLeadCaller = ctx => ctx.caller.role === 'admin' || ['lead_auditor'].includes(ctx.membership && ctx.membership.audit_role);
// Runs after an op succeeds; `before` (optional) reads state the op is about to change.
function afterOp(name, before, hook) {
  const def = registry[name];
  if (!def) throw new Error('afterOp: unknown op ' + name);
  const run = def.run;
  def.run = async ctx => {
    let b = null;
    try { b = before ? await before(ctx) : null; } catch (e) { b = null; }
    const out = await run(ctx);
    try { await hook(ctx, out, b); } catch (e) { console.warn('[iso notify]', name, e.message); }
    return out;
  };
}
const clauseRef = r => `ISO ${r.standard_code} ${r.clause}`;
afterOp('requirement.update', ctx => ctx.db.get('iso_requirements', ctx.payload.id), async (ctx, out, before) => {
  if (out && out.approval_state === 'proposed' && (!before || before.approval_state !== 'proposed') && !isLeadCaller(ctx))
    await notifyUids(ctx, leadUidsOf(ctx), { entity_type: 'requirement', entity_id: out.id, type: 'awaiting_approval', message: `${clauseRef(out)} is waiting for your sign-off (${ctx.audit.ref}).` });
});
afterOp('requirement.return', ctx => ctx.db.get('iso_requirements', ctx.payload.id), async (ctx, out, before) => {
  const to = (before && before.assessed_by) || (out && out.assessed_by);
  if (out) await notifyUids(ctx, [to], { entity_type: 'requirement', entity_id: out.id, type: 'returned', message: `${clauseRef(out)} was returned to you by the Lead Auditor (${ctx.audit.ref}).` });
});
afterOp('relationship.applyToRelated', null, async (ctx, out) => {
  const n = out && Array.isArray(out.applied) ? out.applied.length : 0;
  if (n && !isLeadCaller(ctx)) await notifyUids(ctx, leadUidsOf(ctx), { entity_type: 'requirement', entity_id: ctx.payload.fromId, type: 'derived_awaiting', message: `${n} related clause${n === 1 ? '' : 's'} got a derived status to confirm (${ctx.audit.ref}).` });
});
afterOp('finding.reopen', null, async (ctx, out) => {
  if (!out) return;
  const links = await ctx.db.list('iso_action_links', { where: [{ field: 'target_type', op: 'eq', value: 'finding' }, { field: 'target_id', op: 'eq', value: out.id }, { field: 'link_state', op: 'eq', value: 'confirmed' }] });
  const owners = [];
  for (const l of links) { const a = await ctx.db.get('iso_actions', l.action_id); if (a && a.owner_uid) owners.push(a.owner_uid); }
  await notifyUids(ctx, [out.created_by, ...owners], { entity_type: 'finding', entity_id: out.id, type: 'finding_reopened', message: `${out.ref} was reopened (${ctx.audit.ref}).` });
});
const notifyAssigned = async (ctx, a, prevOwner) => {
  if (a && a.owner_uid && a.owner_uid !== prevOwner) await notifyUids(ctx, [a.owner_uid], { entity_type: 'action', entity_id: a.id, type: 'action_assigned', message: `${a.ref} was assigned to you${a.due_date ? ', due ' + a.due_date : ''} (${ctx.audit.ref}).` });
};
afterOp('action.create', null, (ctx, out) => notifyAssigned(ctx, out, null));
afterOp('action.trackPlan', null, (ctx, out) => notifyAssigned(ctx, out && out.action, null));
afterOp('action.update', ctx => ctx.db.get('iso_actions', ctx.payload.id), (ctx, out, before) => notifyAssigned(ctx, out, before ? before.owner_uid : null));
for (const op of ['evidence.addLink', 'evidence.addLinkBulk', 'evidence.link', 'evidence.register']) {
  afterOp(op, null, async (ctx, out) => {
    if (isLeadCaller(ctx) || ctx.caller.kind !== 'staff') return;
    const ev = out && (out.evidence || (out.linked && out.linked[0]) || out.link);
    if (!ev) return;
    await notifyUids(ctx, leadUidsOf(ctx), { entity_type: 'audit', entity_id: ctx.audit.id, type: 'evidence_submitted', message: `New evidence on ${ctx.audit.ref} to review.` });
  });
}

defineOp('notification.list', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) {
    const me = ctx.caller.uid;
    const stored = (await ctx.db.list('iso_notifications', { where: [{ field: 'recipient_uid', op: 'eq', value: me }, { field: 'dismissed_at', op: 'isnull' }], limit: 500 }))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 100);
    // Due reminders over boards the caller is named on (owner or member) — not every open board.
    const audits = await ctx.db.list('iso_audits', { where: [{ field: 'archived_at', op: 'isnull' }], limit: 2000 });
    const today = await boardToday(ctx);
    const plus = days => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const in7 = plus(7), in30 = plus(30);
    const successorOf = new Set(audits.filter(a => a.previous_audit_id).map(a => a.previous_audit_id));
    const due = [];
    for (const a of audits) {
      const members = await ctx.db.list('iso_audit_members', { where: [{ field: 'audit_id', op: 'eq', value: a.id }] });
      const mine = members.find(m => m.user_uid === me);
      if (!mine && a.owner_uid !== me) continue;
      const lead = a.owner_uid === me || (mine && ['lead_auditor', 'audit_manager'].includes(mine.audit_role));
      const acts = await ctx.db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: a.id }, { field: 'archived_at', op: 'isnull' }] });
      for (const x of acts) {
        if (x.owner_uid !== me || ['verified', 'closed'].includes(x.status)) continue;
        if (x.due_date && x.due_date <= in7) due.push({ id: `due:action:${x.id}`, due: true, audit_id: a.id, entity_type: 'action', entity_id: x.id, type: x.due_date < today ? 'action_overdue' : 'action_due', message: `${x.ref} is ${x.due_date < today ? 'overdue' : 'due'} (${x.due_date}).`, created_at: x.due_date });
      }
      for (const x of acts) {
        if (x.owner_uid !== me || !x.effectiveness_review_date || x.verification_status === 'effective' || x.effectiveness_review_date > in7) continue;
        due.push({ id: `due:effectiveness:${x.id}`, due: true, audit_id: a.id, entity_type: 'action', entity_id: x.id, type: 'effectiveness_due', message: `Effectiveness review for ${x.ref} is due (${x.effectiveness_review_date}).`, created_at: x.effectiveness_review_date });
      }
      if (lead && a.stage === 'closed' && !successorOf.has(a.id) && a.maintenance_due && a.maintenance_due <= in30)
        due.push({ id: `due:followup:${a.id}`, due: true, audit_id: a.id, entity_type: 'audit', entity_id: a.id, type: 'follow_up_due', message: `The follow-up / maintenance audit after ${a.ref} is due (${a.maintenance_due}).`, created_at: a.maintenance_due });
      if (lead && a.stage !== 'closed' && a.report_due && a.report_due <= in7)
        due.push({ id: `due:report:${a.id}`, due: true, audit_id: a.id, entity_type: 'audit', entity_id: a.id, type: 'report_due', message: `The report for ${a.ref} is due (${a.report_due}).`, created_at: a.report_due });
    }
    return { items: stored.map(n => ({ ...n, due: false })).concat(due), unread: stored.filter(n => !n.read_at).length };
  },
});
async function ownNotifications(ctx) {
  if (!Array.isArray(ctx.payload.ids) || !ctx.payload.ids.length || ctx.payload.ids.length > 500 || !ctx.payload.ids.every(isValidId)) throw badRequest('Pick notifications.');
  const out = [];
  for (const id of ctx.payload.ids) { const n = await ctx.db.get('iso_notifications', id); if (n && n.recipient_uid === ctx.caller.uid) out.push(n); }
  return out;
}
defineOp('notification.markRead', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) { const nowIso = ctx.now.toISOString(); for (const n of await ownNotifications(ctx)) if (!n.read_at) await ctx.db.patchRow('iso_notifications', n.id, { read_at: nowIso }); return { ok: true }; },
});
defineOp('notification.dismiss', {
  scope: 'none', clientProjection: null,
  allow(ctx) { return ctx.caller.kind === 'staff'; },
  async run(ctx) { const nowIso = ctx.now.toISOString(); for (const n of await ownNotifications(ctx)) await ctx.db.patchRow('iso_notifications', n.id, { dismissed_at: nowIso, read_at: n.read_at || nowIso }); return { ok: true }; },
});

module.exports = {
  registry, defineOp, IsoError, badRequest, forbidden, notFound, conflict,
  isValidId, isNonEmptyText, resolveMembership, canOpenAudit, allowedAuditRoles, defaultFlagsFor,
  isAllowedActionTransition, ACTION_TRANSITIONS, ASSESSMENT_STATES, ASSESSMENT_RESULTS,
  CLIENT_FIELDS, NEVER_TO_CLIENT, projectForClient, isClientVisibleRecord, requireReason, uid,
  canManageFinding, canProgressFinding, isAllowedFindingTransition, FINDING_TRANSITIONS,
  canManageAction, canVerifyAction, isGenericRootCause, majorNcRootCauseGate,
  ACTION_VERIFICATION_RESULTS, ACTION_REOPEN_REASONS, REVIEW_DECISIONS,
  causeTreeHasCycle, CLIENT_WRITABLE_ACTION_FIELDS, CLIENT_RESPONDABLE_ACTION_STATUSES,
  buildGuidance, relatedEvidenceIds, EVIDENCE_SHARING_KINDS,
};
