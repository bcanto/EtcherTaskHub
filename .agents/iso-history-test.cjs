// Release-1 B3 — history foundation (server-level).
//   B3.1 every board stores its library release; links, catalogue and cheat sheets come from it —
//        a new release (a fake v4 here) reaches new boards only, existing boards are unchanged.
//   B3.2 closing a board writes one immutable snapshot (per clause: status, OFI, gap reason, basis,
//        baseline, approval; plus release and calc version). Reopen + close writes a second one.
//   B3.3 the snapshot records each linked document as seen, with a SHA-256 for an uploaded file.
//   B3.4 learning signals: doc_linked once per linking call with its source; related_applied; an
//        admin-only signal.export.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const H = require('./_iso-harness.cjs');
const AUD = H.STAFF('u3');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

H.run('iso-history-test', 3167, async (t, srv) => {
  const A = H.ADMIN;
  const basis = 'Seen the procedure and two signed records.';
  const b = await srv.board({ standards: ['9001', '14001'], members: [{ id: AUD.id, auditRole: 'auditor' }] });
  const signals = async () => (await srv.must(A, { op: 'signal.export' })).signals;

  // ── B3.1 the board's release ─────────────────────────────────────────────────────────────────
  const rel = await srv.must(A, { op: 'library.release', auditId: b.id });
  t.ok(rel.release === 'v3' && rel.current === 'v3' && rel.manifest && rel.manifest.editions.length === 3, `a new board records the current release, v3, with its manifest (got ${JSON.stringify({ r: rel.release, c: rel.current, e: rel.manifest && rel.manifest.editions.length })})`);
  t.ok(rel.manifest.editions.every(e => 'transition' in e && 'lastVerified' in e.transition) && 'technicalReviewer' in rel.manifest && Array.isArray(rel.manifest.changeNotes), 'the manifest carries transition dates (with last-verified), reviewer and change notes');
  t.ok((await srv.must(A, { op: 'audit.get', auditId: b.id })).audit?.library_release === 'v3' || (await srv.must(A, { op: 'audit.get', auditId: b.id })).library_release === 'v3', 'the release is stored on the board itself');

  // ── B3.4 doc_linked ──────────────────────────────────────────────────────────────────────────
  let before = (await signals()).length;
  const doc = await srv.must(A, { op: 'evidence.addLinkBulk', auditId: b.id, title: 'Document Control Procedure', url: 'https://example.com/dcp', versionLabel: 'Rev 4', requirementIds: [b.key('9001 4.1').id, b.key('9001 4.2').id], linkSource: 'register_suggestion' });
  let sig = (await signals()).filter(s => s.action === 'doc_linked');
  t.eq((await signals()).length - before, 1, 'one linking call writes exactly one signal');
  const last = sig[sig.length - 1];
  t.ok(last && last.payload.source === 'register_suggestion' && last.payload.evidenceId === doc.evidence.id && last.payload.title === 'Document Control Procedure' && last.payload.requirementIds.length === 2, `doc_linked carries {source, evidenceId, title, requirementIds} (got ${JSON.stringify(last && last.payload)})`);
  before = (await signals()).length;
  await srv.must(A, { op: 'evidence.link', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.3').id, evidenceIds: [doc.evidence.id], linkSource: 'search' });
  sig = (await signals()).filter(s => s.action === 'doc_linked');
  t.ok((await signals()).length - before === 1 && sig[sig.length - 1].payload.source === 'search' && sig[sig.length - 1].payload.requirementIds[0] === b.key('9001 4.3').id, 'picking an existing document by search records source "search"');
  t.eq((await srv.call(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.4').id, title: 'X', url: 'https://example.com/x', linkSource: 'magic' })).status, 400, 'an unknown link source is refused');
  before = (await signals()).length;
  await srv.must(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.4').id, title: 'Interview — QA lead', kind: 'interview' });
  t.eq((await signals()).length - before, 0, 'a call with no link source (an interview note) writes no doc_linked signal');
  before = (await signals()).length;
  await srv.must(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.4').id, title: 'Board-only register', url: 'https://example.com/own', linkSource: 'custom' });
  t.eq((await signals()).filter(s => s.action === 'doc_linked').slice(-1)[0].payload.source, 'custom', 'a new document of the board\'s own records source "custom"');

  // related_applied (B1.5) is part of the export.
  await srv.set(b, '9001 4.1', { compliance_status: 'compliant', current_system: basis });
  const peers = (await srv.must(A, { op: 'relationship.library', auditId: b.id }))[b.key('9001 4.1').id] || [];
  if (peers.length) {
    before = (await signals()).filter(s => s.action === 'related_applied').length;
    const toId = peers[0].requirementId || peers[0].id;
    await srv.must(A, { op: 'relationship.applyToRelated', auditId: b.id, fromId: b.key('9001 4.1').id, toIds: [toId], offeredIds: peers.map(p => p.requirementId || p.id) });
    t.eq((await signals()).filter(s => s.action === 'related_applied').length - before, 1, 'Apply to related writes one related_applied signal, in the export');
    await srv.must(A, { op: 'requirement.confirmDerived', auditId: b.id, ids: [toId] });
  } else t.ok(false, '9001 4.1 has related clauses in v3 (fixture)');
  t.eq((await srv.call(AUD, { op: 'signal.export' })).status, 403, 'signal.export is admin only');
  const exp = await srv.must(A, { op: 'signal.export' });
  t.ok(exp.count === exp.signals.length && exp.actions.includes('doc_linked') && exp.signals.every(s => exp.actions.includes(s.action)), 'the export lists only signal actions, with a count');

  // ── B3.3 an uploaded file (offline upload round trip) ────────────────────────────────────────
  const up = await srv.must(A, { op: 'evidence.uploadUrl', auditId: b.id, targetType: 'requirement', targetId: b.key('9001 4.2').id, filename: 'Signed-records.pdf', size: PDF.length, mime: 'application/pdf', title: 'Signed records sample', versionLabel: 'v1' });
  await srv.must(A, { op: 'evidence.offlinePut', auditId: b.id, evidenceId: up.evidenceId, dataBase64: PDF.toString('base64') });
  await srv.must(A, { op: 'evidence.register', auditId: b.id, evidenceId: up.evidenceId });

  // ── B3.2 close snapshot ──────────────────────────────────────────────────────────────────────
  await srv.set(b, '9001 4.2', { compliance_status: 'partially_compliant', gap_reason: 'ineffective', ofi: true, current_system: basis, recommended_action: 'Sign every record' });
  const auditRow = async () => { const a = await srv.must(A, { op: 'audit.get', auditId: b.id }); return a.audit || a; };
  t.eq((await srv.must(A, { op: 'snapshot.list', auditId: b.id })).length, 0, 'no snapshot before the board closes');
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow()).row_version, patch: { stage: 'closed' } });
  let snaps = await srv.must(A, { op: 'snapshot.list', auditId: b.id });
  t.eq(snaps.length, 1, 'closing the board writes one snapshot');
  const s1 = snaps[0];
  t.ok(s1.kind === 'close' && s1.library_release === 'v3' && /\S/.test(s1.calc_version || ''), `kind close, the board's release and the calc version (got ${s1.kind} / ${s1.library_release} / ${s1.calc_version})`);
  const c42 = s1.data.clauses.find(c => c.requirementId === b.key('9001 4.2').id);
  t.ok(c42 && c42.status === 'partially_compliant' && c42.ofi === true && c42.gapReason === 'ineffective' && c42.basis === basis && c42.plannedAction === 'Sign every record' && c42.approval && c42.approval.state === 'approved', `per clause: status, OFI, gap reason, basis, plan, approval (got ${JSON.stringify(c42 && { s: c42.status, o: c42.ofi, g: c42.gapReason, a: c42.approval })})`);
  t.ok(s1.data.clauses.length === b.reqs.length && 'baseline' in c42 && 'changedSinceBaseline' in c42, 'every clause is in it, with baseline and changed-since-baseline');
  const linkDoc = c42.documents.find(d => d.title === 'Document Control Procedure');
  const fileDoc = c42.documents.find(d => d.title === 'Signed records sample');
  t.ok(linkDoc && linkDoc.url === 'https://example.com/dcp' && linkDoc.revision === 'Rev 4' && linkDoc.linkedBy && linkDoc.linkedAt && linkDoc.sha256 === null, `a linked document: title, revision, URL, who linked it and when — and no checksum (got ${JSON.stringify(linkDoc)})`);
  t.ok(fileDoc && fileDoc.sha256 === crypto.createHash('sha256').update(PDF).digest('hex') && fileDoc.filename === 'Signed-records.pdf', `an uploaded file carries the SHA-256 of its bytes (got ${fileDoc && fileDoc.sha256})`);
  t.ok(s1.data.metrics && typeof s1.data.metrics.req_total === 'number', 'the metrics are in it');
  // Reopen and close again: a second snapshot, the first untouched.
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow()).row_version, patch: { stage: 'fieldwork' } });
  await srv.set(b, '9001 4.2', { compliance_status: 'compliant', ofi: false, current_system: basis });
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow()).row_version, patch: { stage: 'closed' } });
  snaps = await srv.must(A, { op: 'snapshot.list', auditId: b.id });
  const first = snaps.find(s => s.id === s1.id);
  t.ok(snaps.length === 2 && first && JSON.stringify(first.data) === JSON.stringify(s1.data), 'closing again writes a second snapshot; the first is unchanged');
  t.ok(snaps.find(s => s.id !== s1.id).data.clauses.find(c => c.requirementId === b.key('9001 4.2').id).status === 'compliant', 'the second snapshot has the new conclusion');
  t.eq((await srv.call(AUD, { op: 'snapshot.list', auditId: b.id })).status, 200, 'staff on the board read the snapshots');
  // Immutable in the store itself.
  process.env.ISO_OFFLINE_DIR = srv.dir;
  const db = require(path.join(H.ROOT, 'api', '_isoDbOffline.js'));
  let refused = null;
  try { await db.update('iso_audit_snapshots', s1.id, { kind: 'report' }, 1, null); } catch (e) { refused = e.code; }
  t.eq(refused, 'immutable', 'the store refuses to update a snapshot');
  refused = null;
  try { await db.patchRow('iso_audit_snapshots', s1.id, { data: {} }); } catch (e) { refused = e.code; }
  t.eq(refused, 'immutable', 'and refuses a direct patch');
  t.ok(JSON.stringify((await srv.must(A, { op: 'snapshot.list', auditId: b.id })).find(s => s.id === s1.id).data) === JSON.stringify(s1.data), 'the snapshot is still exactly as written');

  // ── UI: the add-document form records its source; Overview exports; admin exports signals ──
  const u = await srv.board({ standards: ['9001', '45001'], title: 'History UI' });
  const ui = await t.browser();
  await ui.openBoard(u.id); await ui.tab('documents');
  await ui.eval(() => ISO._docSetFilter('all')); await t.sleep(300);
  const docName = await ui.eval(() => [...document.querySelectorAll('.iso-doc-row')].find(r => /Not provided/.test(r.textContent) && r.querySelector('.iso-doc-add'))?.dataset.docRow);
  await ui.eval(n => [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === n).querySelector('.iso-doc-add').click(), docName); await t.sleep(500);
  await ui.page.type('#ovda-url', 'https://example.com/ui-doc');
  before = (await signals()).length;
  await ui.eval(() => ISO._ovDocAddApply()); await t.sleep(2000);
  const uiSig = (await signals()).slice(before);
  t.ok(uiSig.length === 1 && uiSig[0].action === 'doc_linked' && uiSig[0].payload.source === 'register_suggestion' && uiSig[0].payload.title === docName, 'adding a catalogue document from the Documents tab records one register_suggestion signal (got ' + JSON.stringify(uiSig.map(x => x.payload && x.payload.source)) + ')');
  await ui.tab('dashboard');
  const xbtns = await ui.eval(() => [...document.querySelectorAll('.iso-dash-export .iso-export-xlsx')].map(x => x.textContent.trim()));
  t.eq(xbtns, ['ISO 9001', 'ISO 45001'], "Overview offers Export to Excel for each of the board's standards");
  await ui.eval(() => document.querySelector('.iso-dash-export .iso-export-xlsx').click()); await t.sleep(2500);
  const hist = await srv.must(A, { op: 'activity.list', auditId: u.id });
  t.ok(hist.some(h => h.action === 'exported' && h.after && h.after.standard === '9001'), 'clicking it exports the workbook (logged)');
  await ui.shot('b3-overview-export');
  await ui.eval(() => navigate('iso-admin')); await t.sleep(2000);
  const hasBtn = await ui.eval(() => !!document.getElementById('iso-export-signals'));
  t.ok(hasBtn, 'the ISO admin page offers Export signals to an admin');

  // ── B3.1 a new release reaches new boards only ───────────────────────────────────────────────
  const v3 = require(path.join(H.ROOT, 'iso', 'seed', 'library', 'relationships-v3.json')).relationships;
  const related = new Set(v3.filter(p => (p.a.standard === '9001' && p.a.clause === '4.1') || (p.b.standard === '9001' && p.b.clause === '4.1')).map(p => (p.a.clause === '4.1' && p.a.standard === '9001' ? p.b : p.a)).map(c => c.standard + ' ' + c.clause));
  const fakePeer = ['9001 10.3', '9001 10.2.1', '9001 9.3.1', '9001 8.7.1', '9001 7.5.3'].find(k => !related.has(k) && b.reqs.some(r => r.standard_code + ' ' + r.clause === k));
  t.ok(!!fakePeer, `a 9001 clause unrelated to 4.1 in v3 exists for the fake link (got ${fakePeer})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-rel-'));
  const v4File = path.join(dir, 'v4.json');
  fs.writeFileSync(v4File, JSON.stringify({ release: 'v4', current: true, manifest: { release: 'v4', editions: [], changeNotes: ['test release'] },
    relationships: [...v3, { a: { standard: '9001', clause: '4.1' }, b: { standard: '9001', clause: fakePeer.split(' ')[1] } }],
    documents: [{ name: 'V4 Only Register', clauses: [{ standard: '9001', clause: '4.1' }] }] }));
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-relstore-'));
  const s3 = await H.startOffline(3168, { dir: storeDir });
  let oldBoard;
  try {
    await s3.seed();
    oldBoard = await s3.must(A, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'Before v4' });
  } finally { s3.stop(); }
  await t.sleep(400);
  const s4 = await H.startOffline(3169, { dir: storeDir, env: { ISO_EXTRA_LIBRARY_RELEASE: v4File } });
  try {
    const newBoard = await s4.must(A, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: 'After v4' });
    const relOld = await s4.must(A, { op: 'library.release', auditId: oldBoard.id });
    const relNew = await s4.must(A, { op: 'library.release', auditId: newBoard.id });
    t.ok(relOld.release === 'v3' && relNew.release === 'v4' && relNew.current === 'v4', `with v4 current, the new board takes v4 and the old keeps v3 (got ${relOld.release} / ${relNew.release})`);
    const docsOld = await s4.must(A, { op: 'document.list', auditId: oldBoard.id });
    const docsNew = await s4.must(A, { op: 'document.list', auditId: newBoard.id });
    t.ok(docsNew.some(d => d.name === 'V4 Only Register') && !docsOld.some(d => d.name === 'V4 Only Register'), 'the document catalogue comes from each board\'s own release');
    t.ok(docsOld.length > 20, `the old board still has its v3 catalogue (${docsOld.length} documents)`);
    const reqsNew = await s4.must(A, { op: 'requirement.list', auditId: newBoard.id });
    const reqsOld = await s4.must(A, { op: 'requirement.list', auditId: oldBoard.id });
    const peerIds = async (board, reqs) => ((await s4.must(A, { op: 'relationship.library', auditId: board.id }))[reqs.find(r => r.clause === '4.1').id] || []).map(p => { const r = reqs.find(x => x.id === (p.requirementId || p.id)); return r ? r.standard_code + ' ' + r.clause : null; });
    t.ok((await peerIds(newBoard, reqsNew)).includes(fakePeer) && !(await peerIds(oldBoard, reqsOld)).includes(fakePeer), 'cross-standard links come from each board\'s own release');
    const gNew = await s4.must(A, { op: 'guidance.list', auditId: newBoard.id });
    const gOld = await s4.must(A, { op: 'guidance.list', auditId: oldBoard.id });
    t.ok((gNew[reqsNew.find(r => r.clause === '4.1').id].documents || []).includes('V4 Only Register') && !(gOld[reqsOld.find(r => r.clause === '4.1').id].documents || []).includes('V4 Only Register'), 'the clause guidance (suggested documents) comes from the board\'s own release');
  } finally { s4.stop(); }
});
