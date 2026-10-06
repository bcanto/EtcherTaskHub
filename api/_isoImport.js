// Pure workbook-import logic (plan Phase 4). Leading underscore = shared module, not a Vercel
// route. api/_iso.js's import.preview / import.apply / library.versions / library.approve ops
// call into this file; iso-import-test exercises it directly (in-process, no server).
//
// The browser (iso/iso-import.js) parses the uploaded .xlsx with the vendored SheetJS and sends
// the resulting rows here (plan §3.4 "parse in the browser... and send rows to the server") — this
// file never touches xlsx bytes. It validates those rows strictly, then diffs/merges them against
// the target (a draft library version, or an audit) using the prototype's merge rules
// (workboard/ISO Audit/lib/merge.mjs, read-only reference — never modified, never imported):
// match by stable key (not row number), refresh the read-only `imported` snapshot, flag
// source_changed / missing_from_source, never delete, never touch a requirement's live working
// fields. See docs/iso-audit-integration-plan.md §14 A22/A23 for the deliberate departures from
// the prototype this file makes (documented where they happen, below).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uid = (prefix) => prefix + crypto.randomBytes(8).toString('hex');
function nowIso(now) { return (now || new Date()).toISOString(); }

class ImportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const badImport = (msg) => new ImportError(400, msg);
const conflictImport = (msg) => new ImportError(409, msg);

// ── 1. Strict row validation (plan 4.3) ─────────────────────────────────────────────────────────
const STANDARDS = ['9001', '14001', '45001'];
const MAX_TEXT = 20000;
function isNonEmptyStr(v) { return typeof v === 'string' && v.length > 0; }

function assertSection(s, i) {
  if (!s || typeof s !== 'object') throw badImport(`sections[${i}]: not an object`);
  if (!STANDARDS.includes(s.standard)) throw badImport(`sections[${i}]: invalid standard`);
  if (!isNonEmptyStr(s.clause)) throw badImport(`sections[${i}]: missing clause`);
  if (typeof s.title !== 'string' || !s.title || s.title.length > MAX_TEXT) throw badImport(`sections[${i}]: invalid title`);
  if (s.level !== 1 && s.level !== 2) throw badImport(`sections[${i}]: invalid level`);
  if (!s.source || typeof s.source.row !== 'number') throw badImport(`sections[${i}]: missing source.row`);
}
function assertItem(it, i) {
  if (!it || typeof it !== 'object') throw badImport(`items[${i}]: not an object`);
  if (!STANDARDS.includes(it.standard)) throw badImport(`items[${i}]: invalid standard`);
  if (!isNonEmptyStr(it.clause)) throw badImport(`items[${i}]: missing clause`);
  if (typeof it.requirement !== 'string' || !it.requirement.trim()) throw badImport(`items[${i}]: missing requirement text`);
  if (it.requirement.length > MAX_TEXT) throw badImport(`items[${i}]: requirement text too long`);
  if (!it.source || typeof it.source.row !== 'number' || !isNonEmptyStr(it.source.matchKey)) throw badImport(`items[${i}]: missing source/matchKey`);
  if (!it.imported || typeof it.imported !== 'object') throw badImport(`items[${i}]: missing imported snapshot`);
  for (const f of ['currentSystem', 'complianceStatus', 'plannedAction', 'evidenceExamples']) {
    if (it.imported[f] != null && typeof it.imported[f] !== 'string') throw badImport(`items[${i}]: imported.${f} must be a string`);
  }
}
function assertTodoRow(t, i) {
  if (!t || typeof t !== 'object' || typeof t.row !== 'number' || !isNonEmptyStr(t.title)) throw badImport(`todoRows[${i}]: invalid`);
}

// Throws on anything malformed; returns the trusted, shape-checked payload otherwise. Never
// trusts the client for anything beyond these rows — matchKey/sha256 are recomputed nowhere here
// (the browser's matchKey algorithm is fixed and shared, see iso/iso-import.js), but every op that
// writes to the database only ever uses fields validated here.
function validateCandidates(payload) {
  if (!payload || typeof payload !== 'object') throw badImport('Missing import payload.');
  if (!/^[0-9a-f]{64}$/.test(String(payload.sha256 || ''))) throw badImport('Missing or invalid workbook sha256.');
  if (!isNonEmptyStr(payload.sourceFilename)) throw badImport('Missing source filename.');
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  const todoRows = Array.isArray(payload.todoRows) ? payload.todoRows : [];
  if (!items.length) throw badImport('No requirement rows were found in this workbook.');
  sections.forEach(assertSection);
  items.forEach(assertItem);
  todoRows.forEach(assertTodoRow);
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(w => typeof w === 'string').slice(0, 500) : [];
  return { sha256: payload.sha256, sourceFilename: payload.sourceFilename, sections, items, todoRows, warnings };
}

// ── 2. §6.1 workbook STATUS -> assessment mapping ───────────────────────────────────────────────
const STATUS_MAP = {
  'Fully conforming': { result: 'implemented_effective', state: 'complete' },
  'Partially conforming': { result: 'partially_implemented', state: 'complete' },
  'Not conforming': { result: 'not_implemented', state: 'complete' },
  'To be updated': { result: null, state: 'needs_follow_up' },
};
function mapComplianceStatus(status, where, warnings) {
  const hit = STATUS_MAP[status];
  if (hit) return hit;
  if (status && status !== 'Not assessed') warnings.push(`${where}: unrecognised STATUS "${status}" imported as not started`);
  return { result: null, state: 'not_started' };
}
// D35/R2: a plain workbook import has no OFI or N/A concept of its own (that is v3's vocabulary,
// §this import reads the older client-workbook STATUS column, D18/plan §6.1) — map what it does
// know onto the new status field so an imported row is never silently stuck at Not assessed despite
// carrying a real result.
const RESULT_TO_COMPLIANCE = { implemented_effective: 'compliant', partially_implemented: 'partially_compliant', not_implemented: 'non_compliant' };
function complianceStatusFromMapped(mapped) { return RESULT_TO_COMPLIANCE[mapped.result] || 'not_assessed'; }

// ── 3. Read-only snapshot comparison (ports lib/merge.mjs's importedSnapshotsDiffer 1:1) ────────
function importedSnapshotsDiffer(a, b) {
  if (!a || !b) return a !== b;
  return a.currentSystem !== b.currentSystem
    || a.complianceStatus !== b.complianceStatus
    || a.plannedAction !== b.plannedAction
    || a.evidenceExamples !== b.evidenceExamples
    || a.evidenceMergedFromRow !== b.evidenceMergedFromRow;
}

// ── 4. Diff fingerprint — apply must recompute the same diff preview produced, or refuse (plan
// 4.4 "diff re-computed server-side and must equal diff_sha256"). Fingerprints a stripped copy of
// the summary, not the summary itself: a fresh library import mints a new random versionId on
// every call until the version actually exists in the DB (isNewVersion stays true at both preview
// and apply time, since apply recomputes from the same, still-unwritten DB state) — including that
// id would make preview and apply disagree even when nothing about the target actually changed.
function fingerprintSummary(summary) {
  if (summary.kind === 'library') {
    return { kind: 'library', perStandard: summary.perStandard.map(p => ({ standard: p.standard, isNewVersion: p.isNewVersion, summary: p.summary })), warnings: summary.warnings };
  }
  return summary;
}
function diffFingerprint(summary) {
  return crypto.createHash('sha256').update(JSON.stringify(fingerprintSummary(summary))).digest('hex');
}

function opInsert(table, id, row) { return { table, id, patch: { id, ...row } }; }
function opUpdate(table, id, patch) { return { table, id, patch }; }

// ── Fresh-board population (plan 5.4): audit.create copies every pinned library requirement into
// iso_requirements at not_started — a plain create, not a diff (nothing exists yet to merge
// against). Preserves stable_key/library_requirement_id/section_id from the library row, so a
// later workbook import (this file's computeAuditPlan) matches these rows by stable_key instead of
// creating 236 duplicates alongside them — this is what makes "New ISO board" then "Import
// workbook…" into the same board compose correctly (plan §14 A30).
function copyLibraryRequirements({ auditId, clientId, versions, libReqsByVersion, actorUid, now }) {
  const ops = [];
  let sortKey = 0;
  for (const v of versions) {
    for (const lr of (libReqsByVersion[v.id] || [])) {
      const mySortKey = sortKey++;
      ops.push(opInsert('iso_requirements', uid('ireq_'), {
        audit_id: auditId, client_id: clientId, standard_code: v.standard_code, library_requirement_id: lr.id,
        section_id: lr.section_id, sort_key: mySortKey, origin: 'library',
        clause: lr.clause, clause_name: lr.clause_name, requirement_text: lr.requirement_text,
        applicability: 'applicable', unit_ids: [], assessment_state: 'not_started', assessment_result: null,
        // D35/R2: every requirement starts Not assessed with nothing proposed or approved yet.
        compliance_status: 'not_assessed', approval_state: null, approved_by: null, approved_at: null, return_note: null,
        current_system: null, recommended_action: null, baseline_result: null, baseline_state: null, baseline_at: null,
        imported: null, source_sheet: lr.source_sheet || null, source_row: lr.source_row || null, stable_key: lr.stable_key,
        source_changed: false, missing_from_source: false, visibility: 'internal', visible_to_uids: [],
        row_version: 1, created_by: actorUid, updated_by: actorUid, created_at: nowIso(now), updated_at: nowIso(now),
      }));
    }
  }
  return ops;
}

// ── 5. Library plan — one iso_standard_versions per standard present in the workbook. A version
// already in 'draft' is merged into (created/updated/unchanged, by stable_key); an 'approved'
// version is immutable (the DB trigger would refuse anyway — refused here first, with a clear
// message) — starting a genuinely new version is out of scope for Phase 4 (plan §13/A23).
// Deliberately no missing/conflict tracking on the library side: iso_library_requirements has no
// source_changed/missing_from_source columns (only iso_requirements does) — a library re-import
// simply never removes or flags a row that disappeared from the sheet (A23, logged in §14).
// editionByStandard/labelByStandard (optional, plan 4b.1): a seed file names its edition and label;
// a plain workbook import names neither and keeps the old "Etcher library v1", edition null.
function computeLibraryPlan({ candidateSections, candidateItems, existingVersionByStandard, existingSectionsByVersion, existingLibReqsByVersion, sourceFilename, sha256, actorUid, now, editionByStandard, labelByStandard }) {
  const standardsPresent = [...new Set(candidateItems.map(i => i.standard))];
  const perStandard = [];
  const warnings = [];

  for (const standard of standardsPresent) {
    const version = existingVersionByStandard[standard] || null;
    if (version && version.status === 'approved') {
      throw badImport(`ISO ${standard}'s library version "${version.label}" is already approved — starting a new version isn't built yet (plan §13).`);
    }
    const versionId = version ? version.id : uid('istdver_');
    const isNewVersion = !version;

    const secs = candidateSections.filter(s => s.standard === standard);
    const reqs = candidateItems.filter(i => i.standard === standard);
    const existingSecs = existingSectionsByVersion[standard] || [];
    const existingReqs = existingLibReqsByVersion[standard] || [];
    const secByClause = new Map(existingSecs.map(s => [s.clause, s]));
    const reqByStableKey = new Map(existingReqs.map(r => [r.stable_key, r]));

    const ops = [];
    let sectionsCreated = 0, sectionsUpdated = 0, sectionsUnchanged = 0;
    let sortKey = 0;
    // sectionIdByClause resolves a candidate item's sectionId/subSectionId ("9001:4.1") to the
    // DB-scoped iso_clause_sections id for this version, for the requirement rows below.
    const sectionIdByClause = new Map();
    for (const s of secs) {
      const ex = secByClause.get(s.clause);
      const mySortKey = sortKey++;
      if (!ex) {
        const id = uid('isec_');
        sectionIdByClause.set(s.clause, id);
        ops.push(opInsert('iso_clause_sections', id, {
          version_id: versionId, clause: s.clause, title: s.title, level: s.level, sort_key: mySortKey, source_row: s.source.row,
        }));
        sectionsCreated++;
      } else {
        sectionIdByClause.set(s.clause, ex.id);
        if (ex.title !== s.title || ex.level !== s.level || ex.sort_key !== mySortKey || ex.source_row !== s.source.row) {
          ops.push(opUpdate('iso_clause_sections', ex.id, { title: s.title, level: s.level, sort_key: mySortKey, source_row: s.source.row }));
          sectionsUpdated++;
        } else sectionsUnchanged++;
      }
    }
    // A section not found by clause among fresh candidates but referenced by an existing DB row
    // still resolves (needed if a requirement's own section wasn't re-emitted for some reason).
    for (const ex of existingSecs) if (!sectionIdByClause.has(ex.clause)) sectionIdByClause.set(ex.clause, ex.id);

    function clauseOf(compoundId) {
      if (!compoundId) return null;
      const idx = compoundId.indexOf(':');
      return idx === -1 ? compoundId : compoundId.slice(idx + 1);
    }

    let reqCreated = 0, reqUpdated = 0, reqUnchanged = 0;
    let reqSortKey = 0;
    for (const it of reqs) {
      const mySortKey = reqSortKey++;
      const sectionClause = clauseOf(it.subSectionId) || clauseOf(it.sectionId);
      const sectionId = sectionClause ? (sectionIdByClause.get(sectionClause) || null) : null;
      // iso_library_requirements.section_id is NOT NULL (unlike the audit-side iso_requirements,
      // where an unsectioned row is a warning, not a hard stop) — every real row in the workbook
      // is preceded by a heading, so this should never actually fire against real data.
      if (!sectionId) throw badImport(`ISO ${standard} row ${it.source.row}: requirement has no preceding section heading — cannot import.`);
      const ex = reqByStableKey.get(it.source.matchKey);
      const fields = {
        version_id: versionId, section_id: sectionId, clause: it.clause, clause_name: it.clauseName || '',
        requirement_text: it.requirement, evidence_guidance: it.imported.evidenceExamples || null,
        stable_key: it.source.matchKey, source_sheet: it.source.sheet, source_row: it.source.row, sort_key: mySortKey,
      };
      if (!ex) {
        ops.push(opInsert('iso_library_requirements', uid('ilibreq_'), fields));
        reqCreated++;
      } else {
        const changed = ex.section_id !== sectionId || ex.clause_name !== fields.clause_name || ex.requirement_text !== fields.requirement_text
          || ex.evidence_guidance !== fields.evidence_guidance || ex.sort_key !== mySortKey;
        if (changed) { ops.push(opUpdate('iso_library_requirements', ex.id, fields)); reqUpdated++; }
        else reqUnchanged++;
      }
    }

    let versionOp = null;
    const newLabel = (labelByStandard && labelByStandard[standard]) || 'Etcher library v1';
    if (isNewVersion) {
      versionOp = opInsert('iso_standard_versions', versionId, {
        standard_code: standard, label: newLabel, edition: (editionByStandard && editionByStandard[standard]) || null, status: 'draft',
        source_filename: sourceFilename, source_sha256: sha256, created_by: actorUid, created_at: nowIso(now),
      });
      ops.unshift(versionOp);
    }

    perStandard.push({
      standard, versionId, isNewVersion, versionLabel: isNewVersion ? newLabel : version.label,
      ops,
      summary: {
        sections: { created: sectionsCreated, updated: sectionsUpdated, unchanged: sectionsUnchanged },
        requirements: { created: reqCreated, updated: reqUpdated, unchanged: reqUnchanged },
      },
    });
  }

  return { perStandard, warnings };
}

// ── 6. Audit plan — full merge rules (created/updated/unchanged/removed/conflict), plus the to-do
// rows -> actions + seed-gated suggested links (plan 4.6). ───────────────────────────────────────
//
// A22 (plan §14): the schema has a single `source_changed` boolean per requirement, not a
// per-field conflict record (unlike the prototype's richer doc model, this is all migration 009
// provides — see api/_isoImport.js header). A "conflict" here means: the workbook's D/E/F/G
// changed for a row AND that row's assessment has already moved past not_started (real staff
// engagement happened) — reported in the diff for the reviewer's attention; a row still sitting at
// not_started absorbs the same source change silently since nothing of the user's is at risk. In
// both cases the live fields (current_system, recommended_action, assessment_result/state,
// baseline_*) are never touched by merge — only the read-only `imported` snapshot and
// source_changed change, exactly like the prototype's merge.mjs never touching working fields.
function computeAuditPlan({
  auditId, clientId, auditRef, candidateSections, candidateItems, todoRows, warnings,
  pinnedVersionByStandard, librarySectionsByVersion, libraryReqsByVersion,
  existingRequirements, existingActions, existingActionLinks, seedShared, workbookSha256,
  actionNumbers, actorUid, now,
}) {
  const ops = [];
  const byStableKey = new Map(existingRequirements.map(r => [r.stable_key, r]));
  const seenIds = new Set();
  let created = 0, updated = 0, unchanged = 0, reappeared = 0;
  const conflicts = [];

  function clauseOf(compoundId) {
    if (!compoundId) return null;
    const idx = compoundId.indexOf(':');
    return idx === -1 ? compoundId : compoundId.slice(idx + 1);
  }

  let sortKey = 0;
  const itemIdBySourceKey = new Map(); // "standard:row" -> requirement id, for shared-action link resolution
  for (const it of candidateItems) {
    const mySortKey = sortKey++;
    const standard = it.standard;
    const version = pinnedVersionByStandard[standard];
    if (!version) { warnings.push(`ISO ${standard} row ${it.source.row}: this audit has no library standard pinned for ${standard} — row skipped`); continue; }
    const sectionClause = clauseOf(it.subSectionId) || clauseOf(it.sectionId);
    const sections = librarySectionsByVersion[standard] || [];
    const section = sectionClause ? sections.find(s => s.clause === sectionClause) : null;
    const libReqs = libraryReqsByVersion[standard] || [];
    const libReq = libReqs.find(r => r.stable_key === it.source.matchKey);
    if (!libReq) warnings.push(`ISO ${standard} row ${it.source.row}: no matching library requirement — imported as a client-specific row`);

    const importedSnap = {
      currentSystem: it.imported.currentSystem || '', complianceStatus: it.imported.complianceStatus || 'Not assessed',
      plannedAction: it.imported.plannedAction || '', evidenceExamples: it.imported.evidenceExamples || '',
      evidenceMergedFromRow: it.imported.evidenceMergedFromRow || null,
    };
    const mapped = mapComplianceStatus(importedSnap.complianceStatus, `ISO ${standard} row ${it.source.row}`, warnings);

    const ex = byStableKey.get(it.source.matchKey);
    if (!ex) {
      const id = uid('ireq_');
      itemIdBySourceKey.set(`${standard}:${it.source.row}`, id);
      ops.push(opInsert('iso_requirements', id, {
        audit_id: auditId, client_id: clientId, standard_code: standard,
        library_requirement_id: libReq ? libReq.id : null, section_id: section ? section.id : null,
        sort_key: mySortKey, origin: libReq ? 'library' : 'client_specific',
        clause: it.clause, clause_name: it.clauseName || '', requirement_text: it.requirement,
        applicability: 'applicable', unit_ids: [], assessment_state: mapped.state, assessment_result: mapped.result,
        compliance_status: complianceStatusFromMapped(mapped), approval_state: null, approved_by: null, approved_at: null, return_note: null,
        current_system: importedSnap.currentSystem, recommended_action: importedSnap.plannedAction,
        baseline_result: mapped.result, baseline_state: mapped.state, baseline_at: nowIso(now),
        imported: importedSnap, source_sheet: it.source.sheet, source_row: it.source.row, stable_key: it.source.matchKey,
        source_changed: false, missing_from_source: false, visibility: 'internal', visible_to_uids: [],
        row_version: 1, created_by: actorUid, updated_by: actorUid, created_at: nowIso(now), updated_at: nowIso(now),
      }));
      created++;
      continue;
    }

    itemIdBySourceKey.set(`${standard}:${it.source.row}`, ex.id);
    seenIds.add(ex.id);
    const wasMissing = ex.missing_from_source;
    const rowChanged = ex.source_row !== it.source.row;
    const contentChanged = importedSnapshotsDiffer(ex.imported, importedSnap);
    const patch = {
      library_requirement_id: libReq ? libReq.id : ex.library_requirement_id,
      section_id: section ? section.id : ex.section_id, sort_key: mySortKey,
      clause: it.clause, clause_name: it.clauseName || '', requirement_text: it.requirement,
      imported: importedSnap, source_sheet: it.source.sheet, source_row: it.source.row,
      missing_from_source: false, updated_by: actorUid,
    };
    // A row that exists but was never baselined (audit.create's library copy creates rows exactly
    // like this, plan 5.4/A30) has nothing of the user's to protect yet — the FIRST workbook data
    // to land on it fills baseline/assessment/current_system/recommended_action, same as a brand
    // new row would. Once baseline_at is set, this branch never fires again for that row — from
    // then on it's a genuine re-import, and only `imported`/`source_changed` ever change (below).
    if (!ex.baseline_at) {
      Object.assign(patch, {
        current_system: importedSnap.currentSystem, recommended_action: importedSnap.plannedAction,
        assessment_result: mapped.result, assessment_state: mapped.state,
        compliance_status: complianceStatusFromMapped(mapped),
        baseline_result: mapped.result, baseline_state: mapped.state, baseline_at: nowIso(now),
      });
    }
    if (contentChanged) patch.source_changed = true;
    if (contentChanged || rowChanged || wasMissing || !ex.baseline_at) {
      ops.push(opUpdate('iso_requirements', ex.id, patch));
      updated++;
      if (wasMissing) reappeared++;
      const engaged = !!ex.baseline_at;
      if (contentChanged && engaged) conflicts.push({ id: ex.id, standard, clause: it.clause, row: it.source.row, reason: 'workbook changed after assessment started' });
    } else {
      unchanged++;
    }
  }

  let missingNow = 0;
  for (const ex of existingRequirements) {
    if (!seenIds.has(ex.id) && !ex.missing_from_source) {
      ops.push(opUpdate('iso_requirements', ex.id, { missing_from_source: true, updated_by: actorUid }));
      missingNow++;
    }
  }

  // ── To-do rows -> actions (idempotent by source row: an action already created for a given
  // row/audit is matched by its own `source_row`-derived stable id rather than re-created). ─────
  const existingActionBySourceRow = new Map();
  for (const a of existingActions) if (a.import_source_row != null) existingActionBySourceRow.set(a.import_source_row, a);
  const actionPlans = []; // { id, isNew, sourceRow, title, number }
  todoRows.forEach((t, i) => {
    const ex = existingActionBySourceRow.get(t.row);
    if (ex) { actionPlans.push({ id: ex.id, isNew: false, sourceRow: t.row, title: t.title }); return; }
    actionPlans.push({ id: uid('iact_'), isNew: true, sourceRow: t.row, title: t.title, number: actionNumbers[i] });
  });

  // ── Seed links (plan 4.6): only applied when the imported workbook's sha256 matches the seed's
  // recorded source hash; otherwise the actions still import, with a warning and no links. ──────
  const seedMatchesWorkbook = !!(seedShared && seedShared.sourceSha256 === workbookSha256);
  if (seedShared && !seedMatchesWorkbook) {
    warnings.push(`Shared-action seed skipped: this workbook's sha256 doesn't match the seed's recorded source (imported the ${todoRows.length} to-do rows as actions with no suggested links).`);
  }
  const seedByRow = new Map((seedShared ? seedShared.seeds : []).map(s => [s.row, s]));
  const existingLinksByAction = new Map();
  for (const l of existingActionLinks) { if (!existingLinksByAction.has(l.action_id)) existingLinksByAction.set(l.action_id, new Map()); existingLinksByAction.get(l.action_id).set(l.target_id, l); }

  const actionOps = [];
  const actionLinkOps = [];
  let actionsCreated = 0, linksAdded = 0;
  const linkWarnings = [];
  for (const plan of actionPlans) {
    if (plan.isNew) {
      actionOps.push(opInsert('iso_actions', plan.id, {
        ref: `${auditRef}-A${String(plan.number).padStart(3, '0')}`,
        audit_id: auditId, client_id: clientId, title: plan.title, owner_kind: 'etcher',
        progress: 0, status: 'draft', verification_status: 'not_verified', root_cause_method: 'none',
        cause_categories: [], visibility: 'internal', visible_to_uids: [], reopened_count: 0, row_version: 1,
        import_source_row: plan.sourceRow, created_by: actorUid, updated_by: actorUid,
        created_at: nowIso(now), updated_at: nowIso(now),
      }));
      actionsCreated++;
    }
    if (!seedMatchesWorkbook) continue;
    const seed = seedByRow.get(plan.sourceRow);
    if (!seed) continue;
    const already = existingLinksByAction.get(plan.id) || new Map();
    for (const linkKey of seed.links) {
      const targetId = itemIdBySourceKey.get(resolveSeedLinkKey(linkKey));
      if (!targetId) { linkWarnings.push(`Seed link ${linkKey} for to-do row ${plan.sourceRow}: no matching requirement — skipped`); continue; }
      if (already.has(targetId)) continue; // rejected/confirmed suggestions are never re-suggested by re-import
      actionLinkOps.push(opInsert('iso_action_links', uid('iactlnk_'), {
        action_id: plan.id, target_type: 'requirement', target_id: targetId, link_state: 'suggested', created_at: nowIso(now),
      }));
      linksAdded++;
    }
  }
  warnings.push(...linkWarnings);

  return {
    ops, actionOps, actionLinkOps,
    summary: {
      requirements: { created, updated, unchanged, reappeared, missingNow, conflicts },
      actions: { created: actionsCreated, total: actionPlans.length, linksAdded, seedApplied: seedMatchesWorkbook },
    },
    warnings,
  };
}

// Seed link keys are "standard:row" against the workbook's OWN row numbers (plan 4.6: "Seed links
// are keyed by sheet row" — confirmed against the prototype's actual rowMap, not the clause-number
// look the digits superficially resemble; see docs/iso-audit-integration-plan.md §14).
function resolveSeedLinkKey(linkKey) {
  const idx = linkKey.indexOf(':');
  if (idx === -1) return linkKey;
  return `${linkKey.slice(0, idx)}:${linkKey.slice(idx + 1)}`;
}

function loadSeedShared() {
  try {
    const file = path.join(__dirname, '..', 'iso', 'seed', 'shared-actions.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!json || !Array.isArray(json.seeds)) return null;
    return json;
  } catch (e) { return null; }
}

module.exports = {
  ImportError, badImport, conflictImport,
  validateCandidates, mapComplianceStatus, importedSnapshotsDiffer, diffFingerprint,
  computeLibraryPlan, computeAuditPlan, copyLibraryRequirements, loadSeedShared, opInsert, opUpdate, uid,
  STATUS_MAP, STANDARDS,
};
