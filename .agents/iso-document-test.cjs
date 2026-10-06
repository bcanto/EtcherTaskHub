// R4 (D35 P5): the Documents view's data layer. DOCUMENT_CATALOG/DOCUMENT_CATALOG_BY_CLAUSE
// (api/_iso.js, static from documents-v3.json) ship 125 shared documents with the library — same
// "no per-board table" pattern R3 used for Column P's relationships. document.list reads them live
// against a board's own requirement rows; evidence.addLinkBulk is the "add once, link to every
// clause" op that makes that worth anything (P5: "~5 clicks for 35 clauses"). Fresh offline temp
// server, seeded v3 library.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3149;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
async function callIso(user, body) {
  const headers = { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) };
  const r = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}
const ADMIN = { id: 'u1', role: 'admin' };
const AUD = { id: 'u2', role: 'staff' };
const VIEWER = { id: 'u3', role: 'staff' };
const data = res => res.body && res.body.data;
function report() {
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-doc-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  try {
    await waitForServer(PORT);
    ok((data(await callIso(ADMIN, { op: 'library.loadSeed' })) || []).length === 3, 'the v3 library is loaded (3 editions)');

    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'iso', 'seed', 'library', 'documents-v3.json'), 'utf8')).documents;
    ok(catalog.length === 125, `fixture sanity: the v3 document catalog has 125 documents (got ${catalog.length})`);

    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001', '45001'], title: 'Doc test' }));
    await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:' + AUD.id, auditRole: 'auditor' });
    await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:' + VIEWER.id, auditRole: 'reviewer' });
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const byKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));

    // ── document.list: computed correctly against the board's own rows ─────────────────────────
    const docs = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    ok(docs.length > 0, `document.list returns at least one document (got ${docs.length})`);
    ok(docs.every(d => d.totalCount === d.clauses.length && d.providedCount === 0), 'every document starts with providedCount 0, matching its own clause list length');
    ok(docs.every((d, i) => i === 0 || docs[i - 1].totalCount >= d.totalCount), 'documents are sorted by how many of this board\'s clauses they cover, most first');
    const mrm = docs.find(d => d.name === 'Management Review Minutes');
    ok(!!mrm && mrm.clauses.length > 0, `Management Review Minutes resolves real clauses on this 3-standard board (got ${mrm && mrm.clauses.length})`);
    const expectedMrmClauses = new Set(catalog.find(d => d.name === 'Management Review Minutes').clauses.map(c => c.standard + ' ' + c.clause).filter(k => byKey.has(k)));
    const gotMrmClauses = new Set(mrm.clauses.map(c => c.standardCode + ' ' + c.clause));
    ok(gotMrmClauses.size === expectedMrmClauses.size && [...expectedMrmClauses].every(k => gotMrmClauses.has(k)), `Management Review Minutes' clauses match the catalog exactly, filtered to rows this board actually has (expected ${expectedMrmClauses.size}, got ${gotMrmClauses.size})`);

    // Viewer (reviewer, not assess-capable) can still read document.list (board visibility only).
    const viewerRead = await callIso(VIEWER, { op: 'document.list', auditId: board.id });
    ok(viewerRead.status === 200, 'a reviewer can read document.list');

    // ── evidence.addLinkBulk: permission ────────────────────────────────────────────────────────
    const target1 = mrm.clauses[0], target2 = mrm.clauses[1];
    ok(!!target1 && !!target2 && target1.requirementId !== target2.requirementId, 'fixture needs at least 2 distinct clauses for Management Review Minutes');
    const viewerBulk = await callIso(VIEWER, { op: 'evidence.addLinkBulk', auditId: board.id, title: mrm.name, url: 'https://etcher.sharepoint.com/sites/qms/mrm.pdf', requirementIds: [target1.requirementId] });
    ok(viewerBulk.status === 403, `a reviewer cannot add evidence in bulk (got ${viewerBulk.status} ${JSON.stringify(viewerBulk.body)})`);
    const viewerUnlink = await callIso(VIEWER, { op: 'evidence.unlinkDocument', auditId: board.id, title: mrm.name, requirementIds: [target1.requirementId] });
    ok(viewerUnlink.status === 403, `a reviewer cannot take a document off clauses either (got ${viewerUnlink.status})`);

    // ── evidence.addLinkBulk: one record, linked to every chosen clause in one call ────────────
    const bulk = await callIso(AUD, { op: 'evidence.addLinkBulk', auditId: board.id, title: mrm.name, url: 'https://etcher.sharepoint.com/sites/qms/mrm.pdf', versionLabel: 'Rev 2', evidenceDate: '2026-08-14', requirementIds: [target1.requirementId, target2.requirementId] });
    ok(bulk.status === 200, `evidence.addLinkBulk succeeds (got ${bulk.status} ${JSON.stringify(bulk.body)})`);
    const bulkData = data(bulk);
    ok(bulkData.linked.length === 2 && bulkData.skipped.length === 0, `both clauses were linked to the one new evidence record (got ${JSON.stringify({ linked: bulkData.linked.length, skipped: bulkData.skipped.length })})`);
    const ev1 = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: target1.requirementId })) || []);
    const ev2 = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: target2.requirementId })) || []);
    ok(ev1.length === 1 && ev2.length === 1 && ev1[0].id === ev2[0].id, `both clauses link the SAME evidence record, not two copies (got ${JSON.stringify({ a: ev1.map(e => e.id), b: ev2.map(e => e.id) })})`);
    ok(ev1[0].title === mrm.name && ev1[0].versionLabel === 'Rev 2', 'the record carries the document name as its title and the given revision');

    // A foreign/unknown requirement id is skipped, not a hard error.
    const bulkBad = await callIso(AUD, { op: 'evidence.addLinkBulk', auditId: board.id, title: 'Another document', url: 'https://etcher.sharepoint.com/sites/qms/other.pdf', requirementIds: ['ireq_doesnotexist'] });
    ok(bulkBad.status === 200 && (data(bulkBad).skipped || []).length === 1 && (data(bulkBad).linked || []).length === 0, `an unknown requirement id is reported as skipped, not a crash (got ${bulkBad.status} ${JSON.stringify(data(bulkBad))})`);

    // ── document.list reflects the new evidence: providedCount updates, matched by title ───────
    const docsAfter = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const mrmAfter = docsAfter.find(d => d.name === 'Management Review Minutes');
    ok(mrmAfter.providedCount === 2, `providedCount reflects the 2 newly-linked clauses (got ${mrmAfter.providedCount})`);
    const providedIds = new Set(mrmAfter.clauses.filter(c => c.provided).map(c => c.requirementId));
    ok(providedIds.has(target1.requirementId) && providedIds.has(target2.requirementId), 'exactly the two linked clauses are marked provided');
    const untouched = mrmAfter.clauses.find(c => !providedIds.has(c.requirementId));
    ok(!untouched || untouched.provided === false, 'a clause nothing was linked to is not marked provided');

    // Rejecting the link removes it from "provided" — proves the match is live, not cached at add time.
    const linkRow = (await (async () => {
      process.env.ISO_OFFLINE_DIR = tmpDir;
      const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
      return db.list('iso_evidence_links', { where: [{ field: 'audit_id', op: 'eq', value: board.id }, { field: 'target_id', op: 'eq', value: target1.requirementId }] });
    })())[0];
    await callIso(ADMIN, { op: 'evidence.review', auditId: board.id, linkId: linkRow.id, verdict: 'rejected', comment: 'Wrong revision.', expectedVersion: linkRow.row_version });
    const docsAfterReject = data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || [];
    const mrmAfterReject = docsAfterReject.find(d => d.name === 'Management Review Minutes');
    ok(mrmAfterReject.providedCount === 1, `rejecting one link drops providedCount back to 1 (got ${mrmAfterReject.providedCount})`);
    // Only an Edit-links removal is revived by re-linking; a reviewer's rejection stands.
    await callIso(ADMIN, { op: 'evidence.link', auditId: board.id, targetType: 'requirement', targetId: target1.requirementId, evidenceIds: [linkRow.evidence_id] });
    const mrmAfterRelink = (data(await callIso(ADMIN, { op: 'document.list', auditId: board.id })) || []).find(d => d.name === 'Management Review Minutes');
    ok(mrmAfterRelink.providedCount === 1, `re-linking never overturns a reviewer's rejection (got ${mrmAfterRelink.providedCount})`);

    console.log(fail.length === 0 ? '\nALL PASS so far' : `\n${fail.length} FAILURE(S) so far`);
  } catch (e) {
    fail.push('unexpected error: ' + (e && e.stack || e));
  } finally {
    proc.kill();
    report();
  }
})();
