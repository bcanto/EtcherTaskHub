// Phase 4 acceptance: the browser parser (iso/iso-import.js) against the real gap-analysis
// workbook (workboard/ISO Audit/source/*.xlsx, gitignored/local-only), cross-checked field-for-
// field against the prototype's own already-proven-correct importer.mjs (read-only reference,
// never modified) — a stronger guarantee than re-deriving the prototype's A/B/C/G-only .txt
// cross-check a second time, since every field of every row is compared here. Then the full
// server-side import.preview/import.apply pipeline over real HTTP against a throwaway offline
// server: library import of the 3 standards, then a first audit (plan Phase 4 acceptance).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = 3108;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

const WORKBOOK_PATH = path.join(ROOT, 'workboard', 'ISO Audit', 'source', 'ISO 9001, 14001, 45001 Gap Analysis Etcher_Coastal Electrics V2.0.xlsx');

// Loads a vendored SheetJS UMD bundle the same way workboard/ISO Audit/lib/importer.mjs's own
// loadVendoredXlsx() does (Node's require() clobbers module.exports on this bundle; a throwaway
// exports object dodges it) — test-only. iso/iso-import.js itself never needs this in the browser
// (window.XLSX is set directly by the <script> tag — see its header comment).
function loadVendoredXlsxForNode(file) {
  const code = fs.readFileSync(file, 'utf8');
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code);
  fn(moduleObj, moduleObj.exports, require);
  if (typeof moduleObj.exports.read !== 'function') throw new Error('vendored xlsx bundle did not expose .read()');
  return moduleObj.exports;
}

function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
function offlineHeader(user) { return encodeURIComponent(JSON.stringify(user)); }
async function callIso(port, user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-ISO-Offline-User'] = offlineHeader(user);
  const r = await fetch(`http://127.0.0.1:${port}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}

(async () => {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    console.log('SKIPPED: no local source workbook at workboard/ISO Audit/source/ — gitignored, dev-machine only.');
    console.log('\nPASS (0):\nFAIL (0):');
    process.exit(0);
  }

  // ── Part 1: pure parsing — iso/iso-import.js vs the prototype's proven-correct importer.mjs ──
  const isoImportBrowser = require(path.join(ROOT, 'iso', 'iso-import.js'));
  const XLSX = loadVendoredXlsxForNode(path.join(ROOT, 'vendor', 'xlsx-0.20.3.full.min.js'));
  const buffer = fs.readFileSync(WORKBOOK_PATH);
  const nodeDigest = (buf) => Promise.resolve(crypto.createHash('sha256').update(Buffer.from(buf)).digest());
  let payload = null;
  try {
    payload = await isoImportBrowser.buildImportPayload({ XLSX, arrayBuffer: buffer, sourceFilename: 'gap-analysis.xlsx', digestFn: nodeDigest });
  } catch (e) {
    fail.push('buildImportPayload threw: ' + e.message);
  }

  if (payload) {
    const counts = {};
    for (const it of payload.items) counts[it.standard] = (counts[it.standard] || 0) + 1;
    ok(counts['9001'] === 98, `ISO 9001 has 98 requirement rows (got ${counts['9001']})`);
    ok(counts['14001'] === 65, `ISO 14001 has 65 requirement rows (got ${counts['14001']})`);
    ok(counts['45001'] === 73, `ISO 45001 has 73 requirement rows (got ${counts['45001']})`);
    ok(payload.items.length === 236, `236 requirement rows total (got ${payload.items.length})`);
    ok(/^[0-9a-f]{64}$/.test(payload.sha256), 'sha256 is a 64-char hex string');

    const EXPECTED_HEADING_ROWS = {
      '9001': [2, 13, 14, 17, 23, 30, 31, 36, 46, 51, 53, 61, 68, 75, 92, 93, 105, 110],
      '14001': [2, 12, 19, 20, 29, 32, 39, 44, 49, 52, 53, 61, 72],
      '45001': [2, 12, 20, 21, 25, 33, 36, 43, 48, 53, 54, 58, 63, 64, 72, 83],
    };
    for (const standard of Object.keys(EXPECTED_HEADING_ROWS)) {
      const rows = payload.sections.filter(s => s.standard === standard).map(s => s.source.row).sort((a, b) => a - b);
      ok(JSON.stringify(rows) === JSON.stringify(EXPECTED_HEADING_ROWS[standard]), `ISO ${standard} heading rows match (got ${JSON.stringify(rows)})`);
      const itemRows = new Set(payload.items.filter(i => i.standard === standard).map(i => i.source.row));
      ok(EXPECTED_HEADING_ROWS[standard].every(r => !itemRows.has(r)), `ISO ${standard} heading rows never became items`);
    }

    const EXPECTED_G_MERGES = {
      '9001': [{ top: 10, rows: [11, 12] }, { top: 37, rows: [38] }],
      '14001': [{ top: 10, rows: [11] }],
      '45001': [{ top: 10, rows: [11] }],
    };
    for (const standard of Object.keys(EXPECTED_G_MERGES)) {
      for (const group of EXPECTED_G_MERGES[standard]) {
        const topItem = payload.items.find(i => i.standard === standard && i.source.row === group.top);
        ok(!!topItem && topItem.imported.evidenceMergedFromRow === null && !!topItem.imported.evidenceExamples,
          `ISO ${standard} row ${group.top}: merge top row has its own evidence text`);
        for (const r of group.rows) {
          const item = payload.items.find(i => i.standard === standard && i.source.row === r);
          ok(!!item && item.imported.evidenceMergedFromRow === group.top && item.imported.evidenceExamples === '',
            `ISO ${standard} row ${r}: merged-down evidence points at row ${group.top}`);
        }
      }
    }

    for (const row of [53, 61, 68, 75]) {
      const isItem = payload.items.some(i => i.standard === '9001' && i.source.row === row);
      const section = payload.sections.find(s => s.standard === '9001' && s.source.row === row);
      ok(!isItem && !!section && section.sourceStatus === 'To be updated', `ISO 9001 row ${row} is a section with sourceStatus "To be updated" (got item=${isItem}, section=${JSON.stringify(section)})`);
    }

    ok(payload.todoRows.length === 28, `28 to-do rows found (got ${payload.todoRows.length})`);

    try {
      const importerUrl = pathToFileURL(path.join(ROOT, 'workboard', 'ISO Audit', 'lib', 'importer.mjs')).href;
      const prototype = await import(importerUrl);
      const proto = prototype.parseWorkbook(buffer, {});
      ok(proto.items.length === payload.items.length, `prototype and port agree on item count (${proto.items.length} vs ${payload.items.length})`);
      const byKey = new Map(payload.items.map(i => [i.standard + ':' + i.source.row, i]));
      let mismatches = 0;
      for (const protoItem of proto.items) {
        const mine = byKey.get(protoItem.standard + ':' + protoItem.source.row);
        if (!mine) { mismatches++; continue; }
        if (mine.clause !== protoItem.clause || mine.clauseName !== protoItem.clauseName || mine.requirement !== protoItem.requirement
          || mine.source.matchKey !== protoItem.source.matchKey
          || mine.imported.currentSystem !== protoItem.imported.currentSystem
          || mine.imported.complianceStatus !== protoItem.imported.complianceStatus
          || mine.imported.plannedAction !== protoItem.imported.plannedAction
          || mine.imported.evidenceExamples !== protoItem.imported.evidenceExamples
          || mine.imported.evidenceMergedFromRow !== protoItem.imported.evidenceMergedFromRow) mismatches++;
      }
      ok(mismatches === 0, `0 mismatches vs the prototype's importer.mjs, every field, every row (got ${mismatches})`);
    } catch (e) {
      fail.push('prototype cross-check threw: ' + e.message);
    }
  }

  // ── Part 2: server-side import.preview / import.apply over real HTTP ─────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-import-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe',
  });
  try {
    await waitForServer(PORT);
    const admin = { id: 'u1', role: 'admin' };

    if (payload) {
      const staffPreview = await callIso(PORT, { id: 'u2', role: 'staff' }, Object.assign({ op: 'import.preview', kind: 'library' }, payload));
      ok(staffPreview.status === 403, `a non-admin cannot preview a library import (got ${staffPreview.status})`);

      const preview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'library' }, payload));
      ok(preview.status === 200, `library import.preview succeeds (got ${JSON.stringify(preview.body)})`);
      const runId = preview.body && preview.body.data && preview.body.data.runId;
      const s9001 = preview.body.data.summary.perStandard.find(p => p.standard === '9001');
      const s14001 = preview.body.data.summary.perStandard.find(p => p.standard === '14001');
      const s45001 = preview.body.data.summary.perStandard.find(p => p.standard === '45001');
      ok(s9001 && s9001.summary.requirements.created === 98, `library preview: 98 new ISO 9001 requirements (got ${s9001 && JSON.stringify(s9001.summary)})`);
      ok(s14001 && s14001.summary.requirements.created === 65, `library preview: 65 new ISO 14001 requirements (got ${s14001 && JSON.stringify(s14001.summary)})`);
      ok(s45001 && s45001.summary.requirements.created === 73, `library preview: 73 new ISO 45001 requirements (got ${s45001 && JSON.stringify(s45001.summary)})`);

      const apply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId }, payload));
      ok(apply.status === 200, `library import.apply succeeds (got ${JSON.stringify(apply.body)})`);

      const reapply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId }, payload));
      ok(reapply.status === 400 && /already been applied/.test(reapply.body.error || ''), `re-applying the same run is refused (got ${JSON.stringify(reapply.body)})`);

      const preview2 = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'library' }, payload));
      const s9001b = preview2.body.data.summary.perStandard.find(p => p.standard === '9001');
      ok(s9001b && s9001b.summary.requirements.created === 0 && s9001b.summary.requirements.unchanged === 98,
        `re-import of the same library workbook creates 0 new, 98 unchanged (got ${s9001b && JSON.stringify(s9001b.summary)})`);

      const versions = await callIso(PORT, admin, { op: 'library.versions' });
      ok(versions.status === 200 && versions.body.data.length === 3, `library.versions lists the 3 draft versions (got ${versions.status}, ${versions.body && versions.body.data && versions.body.data.length})`);
      for (const v of versions.body.data) {
        const approved = await callIso(PORT, admin, { op: 'library.approve', id: v.id });
        ok(approved.status === 200 && approved.body.data.status === 'approved', `library.approve ISO ${v.standard_code} succeeds`);
      }
      const reapprove = await callIso(PORT, admin, { op: 'library.approve', id: versions.body.data[0].id });
      ok(reapprove.status === 400, `approving an already-approved version is refused (got ${reapprove.status})`);

      // ── First audit from the workbook (plan acceptance: "a first audit") ────────────────────
      const auditCreate = await callIso(PORT, admin, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001', '45001'], title: 'Coastal Electrics Gap Analysis' });
      ok(auditCreate.status === 200, `audit.create with all 3 pinned standards succeeds (got ${JSON.stringify(auditCreate.body)})`);
      const auditId = auditCreate.body.data.id;

      const auditPreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, payload));
      ok(auditPreview.status === 200, `audit import.preview succeeds (got ${JSON.stringify(auditPreview.body)})`);
      // 0 created, not 236: audit.create (plan 5.4/A30) already copied all 236 library requirements
      // in at not_started with no baseline yet — this first workbook import fills in their real
      // D/E/F data via the "never baselined" update path, not a fresh create.
      ok(auditPreview.body.data.summary.requirements.created === 0 && auditPreview.body.data.summary.requirements.updated === 236,
        `audit preview: 0 new, 236 updated (baseline not yet set) (got ${JSON.stringify(auditPreview.body.data.summary.requirements)})`);
      ok(auditPreview.body.data.summary.actions.created === 28, `audit preview: 28 new actions from the to-do rows (got ${JSON.stringify(auditPreview.body.data.summary.actions)})`);
      ok(auditPreview.body.data.summary.actions.seedApplied === true, 'audit preview: the seed sha256 matches this workbook, so links are applied');
      ok(auditPreview.body.data.summary.actions.linksAdded === 183, `audit preview: 183 suggested links (got ${auditPreview.body.data.summary.actions.linksAdded})`);

      const auditApply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: auditPreview.body.data.runId }, payload));
      ok(auditApply.status === 200, `audit import.apply succeeds (got ${JSON.stringify(auditApply.body)})`);

      const metric = await callIso(PORT, admin, { op: 'metric.audit', auditId });
      ok(metric.status === 200 && metric.body.data.req_total === 236, `the audit now has 236 requirements (got ${JSON.stringify(metric.body.data)})`);

      // ── §6.1 STATUS -> assessment mapping actually landed in the DB (not just in the returned
      // summary counts) — one real row per bucket, picked from the real workbook data. ──────────
      {
        const dbCheck = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
        process.env.ISO_OFFLINE_DIR = tmpDir;
        const reqRows = await dbCheck.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: auditId }] });
        const byStatus = {};
        for (const it of payload.items) if (!(it.imported.complianceStatus in byStatus)) byStatus[it.imported.complianceStatus] = it;
        const checks = [
          ['Fully conforming', 'implemented_effective', 'complete'],
          ['Partially conforming', 'partially_implemented', 'complete'],
          ['Not conforming', 'not_implemented', 'complete'],
          ['To be updated', null, 'needs_follow_up'],
        ];
        for (const [status, expectResult, expectState] of checks) {
          const sample = byStatus[status];
          if (!sample) { fail.push(`setup: no real row found with STATUS "${status}" to check the mapping against`); continue; }
          const row = reqRows.find(r => r.standard_code === sample.standard && r.source_row === sample.source.row);
          ok(!!row && row.assessment_result === expectResult && row.assessment_state === expectState && row.baseline_result === expectResult && row.baseline_state === expectState,
            `§6.1 mapping for "${status}": assessment/baseline = ${expectResult}/${expectState} (got ${row && JSON.stringify([row.assessment_result, row.assessment_state, row.baseline_result, row.baseline_state])})`);
        }
      }

      const auditPreview2 = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, payload));
      ok(auditPreview2.body.data.summary.requirements.created === 0 && auditPreview2.body.data.summary.requirements.unchanged === 236,
        `re-import into the same audit: 0 new, 236 unchanged (got ${JSON.stringify(auditPreview2.body.data.summary.requirements)})`);
      ok(auditPreview2.body.data.duplicateOf !== null, 'a duplicate-file re-import is flagged with duplicateOf');
      const auditApply2NoConfirm = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: auditPreview2.body.data.runId }, payload));
      ok(auditApply2NoConfirm.status === 400 && /already applied/.test(auditApply2NoConfirm.body.error || ''), 'applying a duplicate file without confirmDuplicate is refused');
      const auditApply2 = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: auditPreview2.body.data.runId, confirmDuplicate: true }, payload));
      ok(auditApply2.status === 200, `applying a duplicate file with confirmDuplicate succeeds (got ${JSON.stringify(auditApply2.body)})`);

      // ── Simulate a user starting work on a row, then the workbook changing under it ──────────
      const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
      process.env.ISO_OFFLINE_DIR = tmpDir;
      const allReqs = await db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: auditId }] });
      const target = allReqs.find(r => r.source_row === payload.items[0].source.row && r.standard_code === payload.items[0].standard);
      await db.update('iso_requirements', target.id, { assessment_state: 'in_progress' }, target.row_version, { entity_type: 'requirement', entity_id: target.id, action: 'test-setup', source: 'automation' });

      const changedItems = JSON.parse(JSON.stringify(payload.items));
      changedItems[0] = Object.assign({}, changedItems[0], { imported: Object.assign({}, changedItems[0].imported, { currentSystem: (changedItems[0].imported.currentSystem || '') + ' [CHANGED FOR TEST]' }) });
      const changedPayload = Object.assign({}, payload, { items: changedItems });
      const conflictPreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, changedPayload));
      ok(conflictPreview.body.data.summary.requirements.conflicts.length === 1, `changing an in-progress row's source content reports exactly 1 conflict (got ${JSON.stringify(conflictPreview.body.data.summary.requirements.conflicts)})`);
      const conflictApply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: conflictPreview.body.data.runId, confirmDuplicate: true }, changedPayload));
      ok(conflictApply.status === 200, `applying the conflicting re-import still succeeds (got ${JSON.stringify(conflictApply.body)})`);
      const targetBefore = target.current_system;
      const afterConflict = await db.get('iso_requirements', target.id);
      ok(afterConflict.current_system === targetBefore, `the live current_system field is preserved through the conflict, unchanged (${JSON.stringify([targetBefore, afterConflict.current_system])})`);
      ok(afterConflict.source_changed === true, 'source_changed is now true after the conflicting re-import');
      ok(afterConflict.imported.currentSystem.endsWith('[CHANGED FOR TEST]'), 'the read-only imported snapshot DID refresh to the new source value');

      // ── Removed row: flagged missing, not deleted ────────────────────────────────────────────
      const droppedRow = changedItems.pop();
      const droppedPayload = Object.assign({}, payload, { items: changedItems });
      const dropPreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, droppedPayload));
      ok(dropPreview.body.data.summary.requirements.missingNow === 1, `dropping one row from the resent workbook flags exactly 1 as missing (got ${JSON.stringify(dropPreview.body.data.summary.requirements)})`);
      const dropApply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: dropPreview.body.data.runId, confirmDuplicate: true }, droppedPayload));
      ok(dropApply.status === 200, `applying the drop succeeds (got ${JSON.stringify(dropApply.body)})`);
      const totalAfterDrop = await db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: auditId }] });
      ok(totalAfterDrop.length === 236, `the dropped row is still in the store, just flagged (still 236 rows, got ${totalAfterDrop.length})`);
      const droppedDbRow = totalAfterDrop.find(r => r.standard_code === droppedRow.standard && r.source_row === droppedRow.source.row);
      ok(droppedDbRow && droppedDbRow.missing_from_source === true, 'the dropped row is flagged missing_from_source, not deleted');

      // ── Rejected links stay rejected ──────────────────────────────────────────────────────────
      const auditActions = await db.list('iso_actions', { where: [{ field: 'audit_id', op: 'eq', value: auditId }] });
      let actionWithLinks = null, linksForAction = [];
      for (const a of auditActions) {
        const l = await db.list('iso_action_links', { where: [{ field: 'action_id', op: 'eq', value: a.id }] });
        if (l.length) { actionWithLinks = a; linksForAction = l; break; }
      }
      if (actionWithLinks) {
        await db.patchRow('iso_action_links', linksForAction[0].id, { link_state: 'rejected', decided_by: 'u1', decided_at: new Date().toISOString() });
        const reimportPreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, payload));
        const reimportApply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: reimportPreview.body.data.runId, confirmDuplicate: true }, payload));
        ok(reimportApply.status === 200, 'a further re-import (to test rejected links) succeeds');
        const linkAfter = await db.get('iso_action_links', linksForAction[0].id);
        ok(linkAfter.link_state === 'rejected', 'a rejected suggested link stays rejected after re-import');
      } else {
        fail.push('setup: no action links found to test rejection against');
      }

      // ── apply refuses if the diff changed since preview ──────────────────────────────────────
      const stalePreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'audit', targetAuditId: auditId }, payload));
      const anyReq = (await db.list('iso_requirements', { where: [{ field: 'audit_id', op: 'eq', value: auditId }] }))[0];
      await db.update('iso_requirements', anyReq.id, { missing_from_source: !anyReq.missing_from_source }, anyReq.row_version, { entity_type: 'requirement', entity_id: anyReq.id, action: 'test-setup', source: 'automation' });
      const staleApply = await callIso(PORT, admin, Object.assign({ op: 'import.apply', runId: stalePreview.body.data.runId, confirmDuplicate: true }, payload));
      ok(staleApply.status === 409, `apply refuses when the target changed since preview (got ${staleApply.status})`);

      // ── mid-apply failure: importApply's own atomicity, and the recovery patchRow import.apply's
      // catch block uses (hard rule 7: proven able to fail, not assumed) ──────────────────────────
      const forcePreview = await callIso(PORT, admin, Object.assign({ op: 'import.preview', kind: 'library' }, payload));
      const beforeForce = await db.list('iso_library_requirements', {});
      const runRow = await db.get('iso_import_runs', forcePreview.body.data.runId);
      try {
        await db.importApply(runRow.id, [{ table: 'not_a_real_table', id: 'x', patch: { id: 'x' } }]);
        fail.push('importApply with an unknown table should have thrown');
      } catch (e) {
        ok(/unknown table/.test(e.message), 'importApply throws on an unknown table (proves it CAN fail, hard rule 7)');
      }
      const afterForce = await db.list('iso_library_requirements', {});
      ok(JSON.stringify(beforeForce) === JSON.stringify(afterForce), 'a forced mid-apply failure left iso_library_requirements byte-identical (the offline adapter\'s own all-or-nothing guarantee)');
      await db.patchRow('iso_import_runs', runRow.id, { status: 'failed', at: new Date().toISOString() });
      const runNowFailed = await db.get('iso_import_runs', runRow.id);
      ok(runNowFailed.status === 'failed', 'patchRow marks the run failed — the exact recovery mechanism import.apply\'s catch block uses');
    } else {
      fail.push('setup: workbook payload was not built, skipping HTTP-level tests');
    }
  } finally {
    proc.kill();
  }

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
