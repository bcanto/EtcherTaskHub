// Phase 9b acceptance (D31): the yearly maintenance audit cycle. Closing a board records completion
// and a maintenance date (default 12 months on, editable); audit.startMaintenance copies only the
// listed fields, carries nothing assessed (last year's results become the baseline), carries open
// findings/actions only (tagged, links remapped), offers accepted evidence as suggestions (never
// linked), maps an edition move by stable key, and writes nothing to the previous board. Plus the
// landing page's due list and the UI. Fresh offline temp server, seeded library.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3147;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
const CONTRIB = { id: 'u3', role: 'staff' };
const data = res => res.body && res.body.data;
const perthToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
function plusMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
function report() {
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-maint-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser = null;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    ok((data(await callIso(ADMIN, { op: 'library.loadSeed' })) || []).length === 3, 'the 2015/2018 library is loaded');

    // ── Fixture: last year's board P (9001 + 14001) ─────────────────────────────────────────────
    const P = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: 'Last year' }));
    for (const [u, role] of [['offline:u2', 'auditor'], ['offline:u3', 'contributor']]) await callIso(ADMIN, { op: 'member.add', auditId: P.id, uid: u, auditRole: role });
    const list = async (auditId) => data(await callIso(ADMIN, { op: 'requirement.list', auditId })) || [];
    const reqs = await list(P.id);
    const p9 = reqs.filter(r => r.standard_code === '9001');
    const upd = async (r, patch) => { const cur = (await list(P.id)).find(x => x.id === r.id); const res = await callIso(ADMIN, { op: 'requirement.update', auditId: P.id, id: r.id, patch, expectedVersion: cur.row_version }); if (res.status !== 200) throw new Error('fixture: ' + JSON.stringify(res.body)); };
    const unit = data(await callIso(ADMIN, { op: 'unit.add', auditId: P.id, kind: 'site', name: 'Perth Depot' }));
    const [r0, r1, r2, r3] = p9;
    await upd(r0, { unit_ids: [unit.id], responsible_uid: 'u2', visibility: 'client_all' });
    // D35/R2: compliance_status replaces applicability/assessment_state/assessment_result; gap
    // description merges into current_system (P4) — no separate field any more.
    await upd(r1, { compliance_status: 'not_applicable', na_justification: 'No design work on site.' });
    await upd(r2, { compliance_status: 'compliant', risk_severity: 'high', current_system: 'Procedure followed on the sample checked.' });
    await upd(r3, { compliance_status: 'non_compliant', current_system: 'Informal. No procedure.', gap_reason: 'not_implemented' });
    const custom = data(await callIso(ADMIN, { op: 'requirement.addCustom', auditId: P.id, standardCode: '9001', clause: 'C1', clauseName: 'Client rule', requirementText: 'Toolbox talks are recorded weekly.' }));
    const fOpen = data(await callIso(ADMIN, { op: 'finding.create', auditId: P.id, requirementId: r3.id, classification: 'major_nc', title: 'No procedure' }));
    const fClosed = data(await callIso(ADMIN, { op: 'finding.create', auditId: P.id, requirementId: r2.id, classification: 'observation', title: 'Closed out' }));
    await db.patchRow('iso_findings', fClosed.id, { status: 'withdrawn' });
    const aOpen = data(await callIso(ADMIN, { op: 'action.create', auditId: P.id, targetType: 'finding', targetId: fOpen.id, title: 'Write the procedure', dueDate: '2026-12-31', ownerUid: 'u2' }));
    await callIso(ADMIN, { op: 'action.link', auditId: P.id, actionId: aOpen.id, targetType: 'requirement', targetId: r0.id });
    await callIso(ADMIN, { op: 'subtask.add', auditId: P.id, actionId: aOpen.id, title: 'Draft' });
    const aClosed = data(await callIso(ADMIN, { op: 'action.create', auditId: P.id, targetType: 'requirement', targetId: r2.id, title: 'Already done' }));
    await db.patchRow('iso_actions', aClosed.id, { status: 'closed' });
    const e1 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: P.id, targetType: 'requirement', targetId: r2.id, url: 'https://etcher.sharepoint.com/sites/qms/policy.docx', title: 'Quality policy' }));
    const e1Link = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: P.id, targetType: 'requirement', targetId: r2.id })) || [])[0];
    const rev = await callIso(AUD, { op: 'evidence.review', auditId: P.id, linkId: e1Link.linkId, verdict: 'accepted', expectedVersion: e1Link.linkRowVersion });
    ok(rev.status === 200, 'fixture: evidence accepted on r2');
    const e3 = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: P.id, targetType: 'requirement', targetId: r0.id, url: 'https://etcher.sharepoint.com/sites/qms/org-chart.pdf', title: 'Org chart' }));
    const e3Link = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: P.id, targetType: 'requirement', targetId: r0.id })) || [])[0];
    ok((await callIso(AUD, { op: 'evidence.review', auditId: P.id, linkId: e3Link.linkId, verdict: 'accepted', expectedVersion: e3Link.linkRowVersion })).status === 200, 'fixture: evidence accepted on r0');
    await callIso(ADMIN, { op: 'evidence.addLink', auditId: P.id, targetType: 'requirement', targetId: r3.id, url: 'https://etcher.sharepoint.com/sites/qms/draft.docx', title: 'Draft only' });

    // ── 9b.1: closing a board ───────────────────────────────────────────────────────────────────
    const early = await callIso(ADMIN, { op: 'audit.startMaintenance', auditId: P.id });
    ok(early.status === 400 && /Close this board first/.test(JSON.stringify(early.body)), 'a maintenance audit cannot start from a board that is not closed');
    const getAudit = async id => data(await callIso(ADMIN, { op: 'audit.get', auditId: id }));
    let pa = await getAudit(P.id);
    ok((await callIso(ADMIN, { op: 'audit.update', auditId: P.id, patch: { stage: 'archived' }, expectedVersion: pa.row_version })).status === 400, 'an unknown stage is refused');
    const closeRes = await callIso(ADMIN, { op: 'audit.update', auditId: P.id, patch: { stage: 'closed' }, expectedVersion: pa.row_version });
    pa = await getAudit(P.id);
    ok(closeRes.status === 200 && pa.stage === 'closed' && !!pa.completed_at, 'closing a board records when it was completed');
    ok(pa.maintenance_due === plusMonths(perthToday(), 12), `with no date given, its maintenance audit falls due 12 months on (got ${pa.maintenance_due}, expected ${plusMonths(perthToday(), 12)})`);

    // Snapshot of everything on P, to prove the carry-forward writes nothing to it.
    const TABLES = ['iso_audits', 'iso_requirements', 'iso_findings', 'iso_finding_requirements', 'iso_actions', 'iso_action_links', 'iso_action_subtasks', 'iso_evidence', 'iso_evidence_links', 'iso_audit_units', 'iso_audit_members', 'iso_audit_standards'];
    const snapshot = async () => {
      const out = {};
      const pFindingIds = new Set((await db.list('iso_findings', {})).filter(f => f.audit_id === P.id).map(f => f.id));
      const pActionIds = new Set((await db.list('iso_actions', {})).filter(a => a.audit_id === P.id).map(a => a.id));
      for (const t of TABLES) out[t] = (await db.list(t, {})).filter(r => r.audit_id === P.id || (t === 'iso_audits' && r.id === P.id) || (t === 'iso_finding_requirements' && pFindingIds.has(r.finding_id)) || (t === 'iso_action_links' && pActionIds.has(r.action_id)));
      return JSON.stringify(out);
    };
    const before = await snapshot();

    // ── 9b.2: who may start it ──────────────────────────────────────────────────────────────────
    ok((await callIso(CONTRIB, { op: 'audit.startMaintenance', auditId: P.id })).status === 403, 'a contributor cannot start a maintenance audit');
    ok((await callIso(AUD, { op: 'audit.startMaintenance', auditId: P.id })).status === 403, 'an auditor cannot either — audit manager or admin only');
    const startRes = await callIso(ADMIN, { op: 'audit.startMaintenance', auditId: P.id });
    const started = data(startRes);
    ok(startRes.status === 200 && started && started.audit && started.summary, `the audit manager / admin starts it (got ${startRes.status} ${JSON.stringify(startRes.body).slice(0, 160)})`);
    const N = started.audit;
    const again = await callIso(ADMIN, { op: 'audit.startMaintenance', auditId: P.id });
    ok(again.status === 400 && new RegExp(N.ref).test(JSON.stringify(again.body)), 'it can only be started once — the second attempt names the board already started');

    const na = await getAudit(N.id);
    ok(na.previous_audit_id === P.id && na.previous && na.previous.ref === P.ref && na.stage === 'planning' && na.audit_type === 'internal' && na.client_id === P.client_id, 'the new board links back to last year\'s, same client, an internal audit, at Planning');
    ok(JSON.stringify(na.standards.slice().sort()) === JSON.stringify(['14001', '9001']) && na.title === `Maintenance audit of ${P.ref}`, `same standards; titled "Maintenance audit of ${P.ref}" (got ${na.title})`);
    ok((await getAudit(P.id)).successor.ref === N.ref, 'last year\'s board shows its successor');

    // ── only the listed fields are copied; nothing assessed carries over ─────────────────────────
    const nReqs = await list(N.id);
    ok(nReqs.length === reqs.length + 1, `every requirement, plus the client-specific one (got ${nReqs.length}, expected ${reqs.length + 1})`);
    const match = r => nReqs.find(x => x.standard_code === r.standard_code && x.clause === r.clause && x.requirement_text === r.requirement_text);
    const n0 = match(r0), n1 = match(r1), n2 = match(r2), n3 = match(r3);
    const newUnits = (await db.list('iso_audit_units', {})).filter(u => u.audit_id === N.id);
    ok(newUnits.length === 1 && newUnits[0].name === 'Perth Depot' && newUnits[0].id !== unit.id && JSON.stringify(n0.unit_ids) === JSON.stringify([newUnits[0].id]), 'units are copied to the new board and each requirement points at the new unit');
    ok(n0.responsible_uid === 'u2' && n0.visibility === 'client_all', 'owner and visibility are copied');
    ok(n1.applicability === 'not_applicable' && n1.na_justification === 'No design work on site.', 'applicability and the N/A reason are copied');
    ok(nReqs.every(r => r.assessment_state === 'not_started' && r.assessment_result == null && r.senior_review_status === 'pending'), 'every assessment starts again at Not started, no result, no senior verdict');
    ok(n3.gap_description == null && n3.current_system == null && n2.risk_severity == null, 'the assessment\'s own content (gap, current system, risk) is not copied');
    ok(n2.baseline_result === 'implemented_effective' && n3.baseline_result === 'not_implemented' && n2.baseline_state === 'complete', 'last year\'s final results become the new board\'s baseline');
    const nCustom = nReqs.find(r => r.clause === 'C1');
    ok(nCustom && nCustom.origin === 'client_specific' && nCustom.requirement_text === 'Toolbox talks are recorded weekly.' && nCustom.assessment_state === 'not_started', 'the client-specific requirement comes along too, reset');
    ok(started.summary.matched === reqs.length + 1 && started.summary.unmatched === 0, `every requirement was matched to last year's (got ${JSON.stringify(started.summary)})`);

    // ── open findings and actions only, tagged, links remapped ────────────────────────────────────
    const nFindings = data(await callIso(ADMIN, { op: 'finding.list', auditId: N.id })) || [];
    ok(nFindings.length === 1 && nFindings[0].title === 'No procedure' && nFindings[0].carried_from_ref === `${P.ref} / ${fOpen.ref}` && nFindings[0].requirement_id === n3.id, `only the open finding carries over, tagged with its previous ref and linked to the new clause (got ${JSON.stringify(nFindings.map(f => [f.title, f.carried_from_ref, f.requirement_id === n3.id]))})`);
    const nActions = data(await callIso(ADMIN, { op: 'action.list', auditId: N.id })) || [];
    const nA = nActions[0];
    ok(nActions.length === 1 && nA.title === 'Write the procedure' && nA.carried_from_ref === `${P.ref} / ${aOpen.ref}` && nA.owner_uid === 'u2' && nA.due_date === '2026-12-31', 'only the open action carries over, with its owner and due date, tagged');
    ok(nA.links.length === 2 && nA.links.some(l => l.target_type === 'finding' && l.target_id === nFindings[0].id) && nA.links.some(l => l.target_type === 'requirement' && l.target_id === n0.id), 'its links point at the carried finding and the new clause — never at last year\'s rows');
    const nSubs = (await db.list('iso_action_subtasks', {})).filter(st => st.action_id === nA.id);
    ok(nSubs.length === 1 && nSubs[0].title === 'Draft', 'its subtasks come with it');

    // ── evidence: suggested, never linked ─────────────────────────────────────────────────────
    const nEvidence = (await db.list('iso_evidence', {})).filter(e => e.audit_id === N.id);
    const nLinks = (await db.list('iso_evidence_links', {})).filter(l => l.audit_id === N.id);
    const nE1 = nEvidence.find(e => e.title === 'Quality policy');
    ok(nEvidence.length === 2 && !nEvidence.some(e => e.title === 'Draft only') && nE1 && nE1.carried_from_ref === `${P.ref} / ${e1.evidence.ref}` && JSON.stringify(nE1.carry_target_ids) === JSON.stringify([n2.id]), `only accepted evidence is copied (not the unreviewed draft), each remembering the clause it was accepted for (got ${JSON.stringify(nEvidence.map(e => e.title))})`);
    ok(nLinks.length === 0, 'and nothing is linked — no evidence counts for anything until someone confirms it');
    const sugg = data(await callIso(ADMIN, { op: 'evidence.suggestions', auditId: N.id, targetId: n2.id })) || [];
    ok(sugg.length === 1 && sugg[0].relationshipKind === 'carried_over' && /Accepted in the last audit/.test(sugg[0].relationshipKindLabel) && new RegExp(P.ref).test(sugg[0].relationshipReason) && sugg[0].source === null, `it is offered as a suggestion for that clause (got ${JSON.stringify(sugg).slice(0, 200)})`);
    const dec = data(await callIso(ADMIN, { op: 'evidence.decideSuggestion', auditId: N.id, evidenceId: nE1.id, targetId: n2.id, decision: 'confirm' }));
    ok(dec && dec.review_status === 'submitted', 'confirming it links it as "submitted" — still awaiting a reviewer\'s verdict, never auto-accepted');
    ok(((data(await callIso(ADMIN, { op: 'evidence.suggestions', auditId: N.id, targetId: n2.id })) || []).length) === 0, 'once linked, it is no longer suggested');

    // ── nothing written to the previous board ─────────────────────────────────────────────────
    ok((await snapshot()) === before, 'last year\'s board is byte-for-byte unchanged — the new board\'s link is the only connection');

    // ── 9b.4: the dashboard knows what came over ─────────────────────────────────────────────────
    const dash = data(await callIso(ADMIN, { op: 'dashboard.audit', auditId: N.id }));
    ok(dash.carried && dash.carried.previous === P.ref && dash.carried.findings === 1 && dash.carried.actions === 1 && dash.carried.evidence === 2 && dash.carried.baseline === reqs.length + 1, `dashboard.audit reports what was carried over (got ${JSON.stringify(dash.carried)})`);
    ok(dash.charts.baseline_vs_current.data && (dash.charts.baseline_vs_current.data.baseline.implemented_effective || 0) >= 1, 'and the baseline chart has last year\'s results');
    ok((data(await callIso(ADMIN, { op: 'dashboard.audit', auditId: P.id }))).carried === null, 'a board that follows nothing reports nothing carried');

    // ── an edition move maps by stable key ──────────────────────────────────────────────────────
    // R1 (2026-10-04, D42): the old amendment seed ('9001-2015-a1') this once loaded is archived —
    // v3 ships one edition per standard, with nothing pre-built to move to. The underlying
    // mechanism this proves (a maintenance audit picks the newest approved edition; a clause worded
    // identically carries its baseline forward by stable key; a genuinely new clause starts fresh)
    // stays real server behaviour (D42) — exercised here with a synthetic second edition instead of
    // a seed file, the same way iso-library-seed-test's own B3 section already does.
    const Q = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], editions: { '9001': '2026' }, title: 'Pinned 2026' }));
    const qReqs = await list(Q.id);
    const q83 = qReqs.find(r => r.clause.startsWith('8.3'));
    const nowIso = new Date().toISOString();
    await db.insert('iso_standard_versions', { id: 'iver_9001_synth2027', standard_code: '9001', label: 'ISO 9001:2027 — test', edition: '2027', status: 'approved', approved_at: nowIso, created_at: nowIso });
    await db.insert('iso_clause_sections', { id: 'isec_9001_synth2027_8', version_id: 'iver_9001_synth2027', clause: '8', title: 'Operation', level: 1, sort_key: 0 });
    // Same clause, same wording, same stable_key as the real 2026 row — proves "carries forward".
    await db.insert('iso_library_requirements', { id: 'ilr_9001_synth2027_same', version_id: 'iver_9001_synth2027', section_id: 'isec_9001_synth2027_8', clause: q83.clause, clause_name: q83.clause_name, requirement_text: q83.requirement_text, stable_key: q83.stable_key, sort_key: 0 });
    // A genuinely new clause — proves "the amendment's new rows start fresh".
    await db.insert('iso_library_requirements', { id: 'ilr_9001_synth2027_new', version_id: 'iver_9001_synth2027', section_id: 'isec_9001_synth2027_8', clause: '8.9', clause_name: 'Synthetic new clause (test only)', requirement_text: 'A requirement that exists only in the synthetic 2027 edition.', stable_key: '9001|8.9|synthetic2027|0', sort_key: 1 });
    let qv = (await list(Q.id)).find(x => x.id === q83.id);
    await callIso(ADMIN, { op: 'requirement.update', auditId: Q.id, id: q83.id, patch: { compliance_status: 'partially_compliant', current_system: 'Partly in place.', gap_reason: 'ineffective' }, expectedVersion: qv.row_version });
    let qa = await getAudit(Q.id);
    ok((await callIso(ADMIN, { op: 'audit.update', auditId: Q.id, patch: { stage: 'closed', maintenance_due: 'soon' }, expectedVersion: qa.row_version })).status === 400, 'a maintenance date that is not a date is refused');
    await callIso(ADMIN, { op: 'audit.update', auditId: Q.id, patch: { stage: 'closed', maintenance_due: '2027-01-15' }, expectedVersion: qa.row_version });
    qa = await getAudit(Q.id);
    ok(qa.maintenance_due === '2027-01-15', 'a maintenance date given when closing is kept');
    await callIso(ADMIN, { op: 'audit.update', auditId: Q.id, patch: { stage: 'capa' }, expectedVersion: qa.row_version });
    qa = await getAudit(Q.id);
    ok(qa.completed_at == null && qa.maintenance_due === '2027-01-15', 'reopening clears completed_at (the date stays, editable)');
    await callIso(ADMIN, { op: 'audit.update', auditId: Q.id, patch: { stage: 'closed', maintenance_due: '2027-02-01' }, expectedVersion: qa.row_version });
    ok((await getAudit(Q.id)).maintenance_due === '2027-02-01', 'and editable later');
    const N2 = data(await callIso(ADMIN, { op: 'audit.startMaintenance', auditId: Q.id }));
    const n2a = await getAudit(N2.audit.id);
    ok(n2a.editions['9001'] === '2027', `the maintenance board takes the newest approved edition (got ${n2a.editions['9001']})`);
    const n2Reqs = await list(N2.audit.id);
    const n283 = n2Reqs.find(r => r.clause === q83.clause && r.requirement_text === q83.requirement_text);
    ok(n283 && n283.baseline_result === 'partially_implemented', 'last year\'s result follows the requirement into the new edition (matched by stable key)');
    ok(N2.summary.matched === 1 && n2Reqs.length === 2, `the identically-worded clause maps across the edition move; the synthetic edition's new clause starts fresh (got ${JSON.stringify(N2.summary)})`);

    // ── 9b.3: the landing page's due list ────────────────────────────────────────────────────────
    const R = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['45001'], title: 'Overdue board' }));
    const ra = await getAudit(R.id);
    await callIso(ADMIN, { op: 'audit.update', auditId: R.id, patch: { stage: 'closed', maintenance_due: '2026-01-01' }, expectedVersion: ra.row_version });
    const audits = data(await callIso(ADMIN, { op: 'audit.list' })) || [];
    ok(audits.find(a => a.id === P.id).has_successor === true && audits.find(a => a.id === R.id).has_successor === false, 'audit.list says which closed boards already have their maintenance audit');

    // ── UI ──────────────────────────────────────────────────────────────────────────────────────
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
    page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await sleep(1800);
    await page.evaluate(() => ISO.openLanding()); await sleep(1500);
    const dueList = await page.evaluate(() => [...document.querySelectorAll('.iso-maint-due .iso-maint-row')].map(r => ({ id: r.dataset.audit, when: r.querySelector('.iso-maint-when')?.textContent || '' })));
    ok(dueList.length === 1 && dueList[0].id === R.id && /Overdue/.test(dueList[0].when), `the landing page lists the overdue maintenance audit — not last year's board (already started) nor dates a year away (got ${JSON.stringify(dueList)})`);

    // Settings of a planning board: picking Closed shows the date, filled 12 months on.
    await page.evaluate(id => ISO.openBoard(id, 'settings'), N.id); await sleep(1500);
    const hiddenFirst = await page.evaluate(() => getComputedStyle(document.getElementById('iso-set-maint-wrap')).display);
    await page.select('#iso-set-stage', 'closed'); await sleep(200);
    const shown = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('iso-set-maint-wrap')).display, value: document.getElementById('iso-set-maint').value }));
    ok(hiddenFirst === 'none' && shown.display !== 'none' && /^\d{4}-\d{2}-\d{2}$/.test(shown.value), `choosing Closed in Settings asks for the maintenance audit date, pre-filled (got ${JSON.stringify({ hiddenFirst, ...shown })})`);
    const followsCard = await page.evaluate(() => document.querySelector('.iso-maint-card')?.innerText || '');
    ok(new RegExp(`maintenance audit of ${P.ref}`, 'i').test(followsCard.replace(/\s+/g, ' ')), `the maintenance board says which board it follows (got ${JSON.stringify(followsCard.slice(0, 200))})`);

    // Start from the landing list: confirm, then the new board opens on its dashboard.
    await page.evaluate(() => ISO.openLanding()); await sleep(1500);
    await page.evaluate(id => document.querySelector(`.iso-maint-row[data-audit="${id}"] .btn-teal`).click(), R.id); await sleep(400);
    const confirmShown = await page.evaluate(() => !document.getElementById('confirm-modal').classList.contains('hidden'));
    ok(confirmShown, 'Start asks for confirmation in the app\'s own dialog');
    await page.evaluate(() => document.getElementById('confirm-ok-btn').click()); await sleep(2500);
    const newBoard = await page.evaluate(() => ({ confirmHidden: document.getElementById('confirm-modal').classList.contains('hidden'), tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), hdr: document.querySelector('.iso-board-meta')?.innerText || '' }));
    ok(newBoard.confirmHidden && newBoard.tab === 'Overview', `the new board opens on its overview (got ${JSON.stringify(newBoard)})`);
    ok(new RegExp(`Maintenance audit of ${R.ref}`, 'i').test(newBoard.hdr.replace(/\s+/g, ' ')), `the board header names the board it follows (got ${JSON.stringify(newBoard.hdr.slice(0, 200))})`);
    // R5: the carried-forward summary banner and the baseline chart are still the old full
    // dashboard's own — one click behind "Full dashboard" now, not the tab's own default.
    await page.evaluate(() => ISO._ovShowFull()); await sleep(1500);
    const full = await page.evaluate(() => ({ banner: document.querySelector('.iso-dash-carried')?.innerText || '', charts: [...document.querySelectorAll('.iso-chart')].map(f => f.innerText).filter(t => /vs now/.test(t)).map(t => t.split('\n')[0]) }));
    ok(new RegExp(R.ref).test(full.banner) && full.charts.some(t => /Last audit vs now/.test(t)), `the full dashboard's carried-forward banner names the board it follows, and the baseline chart reads "Last audit vs now" (got ${JSON.stringify(full)})`);
    const rAfter = await getAudit(R.id);
    ok(rAfter.successor && rAfter.stage === 'closed', 'the overdue board now has its maintenance audit, and stays closed');

    // Carried tags in the drawers.
    await page.evaluate(id => ISO.openBoard(id, 'actions'), N.id); await sleep(1500);
    await page.evaluate(() => ISO._actSetView('all')); await sleep(400);
    await page.evaluate(id => document.querySelector(`#iso-act-tab tr[data-iact="${id}"] td:nth-child(2)`)?.click(), nA.id); await sleep(1500);
    const tag = await page.evaluate(() => document.querySelector('#iso-drawer-body .iso-carried-tag')?.innerText || '');
    ok(new RegExp(`Carried over from ${P.ref}`).test(tag), `the carried action's drawer says where it came from (got ${JSON.stringify(tag)})`);
    await page.evaluate(() => closeGenericModal()); await sleep(200);
    // A carried evidence suggestion renders (it has no source clause) — the Org chart, still unconfirmed on n0.
    await page.evaluate(id => ISO.openBoard(id, 'requirements'), N.id); await sleep(1500);
    await page.evaluate(id => ISO._reqOpenMore(id), n0.id); await sleep(1500);
    await page.evaluate(() => ISO._reqDrawerSetTab('evidence')); await sleep(200);
    const suggUi = await page.evaluate(() => { const b = document.querySelector('#iso-rdp-evidence .iso-evd-sugg'); return b ? b.innerText.replace(/\s+/g, ' ') : ''; });
    ok(/Org chart/.test(suggUi) && /Carried over/.test(suggUi) && /Accepted in the last audit/.test(suggUi), `the carried evidence shows as a suggestion on its clause, labelled carried over (got ${JSON.stringify(suggUi.slice(0, 200))})`);
    await page.evaluate(() => closeGenericModal()); await sleep(200);
    ok(errs.length === 0, `no page errors or native dialogs (got ${JSON.stringify(errs.slice(0, 5))})`);
  } catch (e) {
    fail.push('the suite crashed: ' + (e && e.stack || e).toString().slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }
  report();
})();
