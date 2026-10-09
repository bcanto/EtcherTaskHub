// R3 (D35 P6): library-shipped cross-standard relationships. Column P's 407 pairs are computed
// live from relationships-v3.json against a board's own requirements (relationship.library) — no
// per-board "Suggest relationships" step and no row written for the default (shown) case. A row is
// only ever written to remember a per-board rejection of one pair (relationship.rejectLibrary /
// relationship.unrejectLibrary). relationship.applyToRelated copies compliance_status/current_system/
// recommended_action from one clause onto selected related clauses, going through the same
// approval/derive-on-write rules (applyComplianceStatusPatch) as an ordinary edit (Q7: never a
// one-click stamp that bypasses review). Fresh offline temp server, seeded library.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3148;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-rel-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  try {
    await waitForServer(PORT);
    ok((data(await callIso(ADMIN, { op: 'library.loadSeed' })) || []).length === 3, 'the v3 library is loaded (3 editions)');

    const relFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'iso', 'seed', 'library', 'relationships-v3.json'), 'utf8'));
    const expectedPeersOf = (std, clause) => {
      const out = new Set();
      for (const { a, b } of relFile.relationships) {
        if (a.standard === std && a.clause === clause) out.add(b.standard + ' ' + b.clause);
        if (b.standard === std && b.clause === clause) out.add(a.standard + ' ' + a.clause);
      }
      return out;
    };

    // ── Fixture: a 3-standard board with AUD as a plain (non-lead) co-auditor ──────────────────
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001', '45001'], title: 'Rel test' }));
    await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:' + AUD.id, auditRole: 'auditor' });
    await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:' + VIEWER.id, auditRole: 'reviewer' });
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const byKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
    const r41 = byKey.get('9001 4.1');
    const expected41 = expectedPeersOf('9001', '4.1');
    ok(expected41.size > 0, 'relationships-v3.json names at least one peer for 9001 4.1 (fixture sanity)');

    // ── relationship.library: computed correctly against the board's own rows ─────────────────
    const libMap = data(await callIso(ADMIN, { op: 'relationship.library', auditId: board.id }));
    const related41 = libMap[r41.id] || [];
    const gotKeys = new Set(related41.map(x => x.standardCode + ' ' + x.clause));
    ok(gotKeys.size === expected41.size && [...expected41].every(k => gotKeys.has(k)),
      `relationship.library returns exactly the register's peers for 9001 4.1 (expected ${[...expected41].sort().join(', ')}, got ${[...gotKeys].sort().join(', ')})`);
    ok(related41.every(x => x.rejected === false), 'no pair starts rejected');
    ok(related41.every(x => x.requirementId !== r41.id), 'a clause is never listed as related to itself');
    ok(related41.every(x => typeof x.complianceStatus === 'string'), 'each related entry carries the peer\'s current compliance_status');

    // A 9001-only clause with no Column P peers returns nothing for that id.
    const r50x = reqs.find(r => r.standard_code === '9001' && expectedPeersOf('9001', r.clause).size === 0);
    if (r50x) ok(!libMap[r50x.id], `a clause with no Column P peers (9001 ${r50x.clause}) has no relationship.library entry`);

    // Viewer (reviewer role, not assess-capable) can still read relationships...
    const viewerRead = await callIso(VIEWER, { op: 'relationship.library', auditId: board.id });
    ok(viewerRead.status === 200, 'a reviewer (viewer) can read relationship.library');
    // ...but cannot reject or apply-to-related.
    const peer = related41[0];
    const viewerReject = await callIso(VIEWER, { op: 'relationship.rejectLibrary', auditId: board.id, fromId: r41.id, toId: peer.requirementId });
    ok(viewerReject.status === 403, 'a reviewer cannot reject a library relationship (403)');
    const viewerApply = await callIso(VIEWER, { op: 'relationship.applyToRelated', auditId: board.id, fromId: r41.id, toIds: [peer.requirementId] });
    ok(viewerApply.status === 403, 'a reviewer cannot apply-to-related (403)');

    // ── Reject / unreject toggles, idempotently (no duplicate rows per pair) ──────────────────
    const reject1 = await callIso(AUD, { op: 'relationship.rejectLibrary', auditId: board.id, fromId: r41.id, toId: peer.requirementId });
    ok(reject1.status === 200, 'an auditor can reject a library relationship');
    const afterReject = (data(await callIso(ADMIN, { op: 'relationship.library', auditId: board.id }))[r41.id] || []);
    ok(afterReject.find(x => x.requirementId === peer.requirementId).rejected === true, 'the rejected pair is flagged rejected:true');
    ok(afterReject.length === related41.length, 'rejecting a pair hides nothing from the list — it stays, flagged, for Edit mode to show');

    const reject2 = await callIso(AUD, { op: 'relationship.rejectLibrary', auditId: board.id, fromId: peer.requirementId, toId: r41.id }); // reversed order, same pair
    ok(reject2.status === 200, 'rejecting the same pair again (ids reversed) is accepted, not duplicated');
    const relRows = await (async () => {
      process.env.ISO_OFFLINE_DIR = tmpDir;
      const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
      return db.list('iso_relationships', { where: [{ field: 'audit_id', op: 'eq', value: board.id }, { field: 'source', op: 'eq', value: 'library' }] });
    })();
    ok(relRows.length === 1, `exactly one iso_relationships row exists for the pair after two rejects (found ${relRows.length})`);

    const unreject = await callIso(AUD, { op: 'relationship.unrejectLibrary', auditId: board.id, fromId: r41.id, toId: peer.requirementId });
    ok(unreject.status === 200, 'an auditor can unreject a library relationship');
    const afterUnreject = (data(await callIso(ADMIN, { op: 'relationship.library', auditId: board.id }))[r41.id] || []);
    ok(afterUnreject.find(x => x.requirementId === peer.requirementId).rejected === false, 'the pair is shown again (rejected:false) after unreject');

    // ── applyToRelated: real per-clause save, approval/derive-on-write rules apply ─────────────
    const freshR41 = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id }))).find(r => r.id === r41.id);
    await callIso(AUD, { op: 'requirement.update', auditId: board.id, id: r41.id, expectedVersion: freshR41.row_version,
      patch: { compliance_status: 'compliant', current_system: 'Documented QMS procedure X', recommended_action: 'None' } });

    // AUD is a plain 'auditor' (not lead_auditor/audit_manager) and is not the sole assessor — ADMIN's
    // own membership here is 'audit_manager', so two staff can assess — so a status AUD copies onto the
    // peer via Apply to related must land as 'proposed', not auto-approved: proof the op really runs
    // through applyComplianceStatusPatch rather than writing the fields raw.
    const applyAud = await callIso(AUD, { op: 'relationship.applyToRelated', auditId: board.id, fromId: r41.id, toIds: [peer.requirementId] });
    ok(applyAud.status === 200 && (applyAud.body.data.applied || []).includes(peer.requirementId), 'applyToRelated reports the peer as applied');
    let peerReq = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id }))).find(r => r.id === peer.requirementId);
    ok(peerReq.compliance_status === 'compliant', 'the peer\'s compliance_status was copied');
    ok(peerReq.current_system === 'Documented QMS procedure X', 'the peer\'s current_system was copied');
    ok(peerReq.approval_state === 'proposed', `a non-lead apply-to-related proposes, it does not auto-approve (got ${peerReq.approval_state})`);

    // ADMIN is this board's audit_manager (= effective Lead Auditor) — the same action from ADMIN
    // on a second related clause should auto-approve.
    const peer2 = related41.find(x => x.requirementId !== peer.requirementId);
    if (peer2) {
      const applyLead = await callIso(ADMIN, { op: 'relationship.applyToRelated', auditId: board.id, fromId: r41.id, toIds: [peer2.requirementId] });
      ok(applyLead.status === 200, 'the Lead Auditor can apply-to-related');
      const peer2Req = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id }))).find(r => r.id === peer2.requirementId);
      ok(peer2Req.compliance_status === 'compliant', 'the second peer\'s status was copied too');
      ok(peer2Req.approval_state === 'proposed' && !!peer2Req.derived_from_id, `D47: even the Lead Auditor's apply-to-related arrives derived and proposed, to be confirmed on the clause (got ${peer2Req.approval_state} / ${peer2Req.derived_from_id})`);
    } else {
      ok(false, 'fixture needs a second related clause to test Lead auto-approval — 9001 4.1 only has one peer');
    }

    // Applying to the source itself, or to an id outside the board, is skipped, not applied.
    const bogus = await callIso(ADMIN, { op: 'relationship.applyToRelated', auditId: board.id, fromId: r41.id, toIds: [r41.id, 'irq_doesnotexist'] });
    ok(bogus.status === 200 && (bogus.body.data.applied || []).length === 0 && (bogus.body.data.skipped || []).length === 1,
      'applyToRelated applies nothing for self or a foreign id, and reports the foreign id as skipped');

    // Not-applicable copies its justification, and is still accepted (validateRequirementPatch passes).
    const freshR41b = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id }))).find(r => r.id === r41.id);
    await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: r41.id, expectedVersion: freshR41b.row_version,
      patch: { compliance_status: 'not_applicable', na_justification: 'Client has no export control scope.' } });
    const applyNa = await callIso(ADMIN, { op: 'relationship.applyToRelated', auditId: board.id, fromId: r41.id, toIds: [peer.requirementId] });
    ok(applyNa.status === 200, 'applyToRelated accepts a not_applicable source with a justification');
    peerReq = (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id }))).find(r => r.id === peer.requirementId);
    ok(peerReq.compliance_status === 'not_applicable' && peerReq.na_justification === 'Client has no export control scope.',
      'not_applicable + its justification were both copied to the peer');

  } catch (e) {
    fail.push('unexpected error: ' + (e && e.stack || e));
  } finally {
    proc.kill();
    report();
  }
})();
