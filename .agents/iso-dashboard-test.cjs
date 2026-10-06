// Acceptance for the board's Dashboard tab: 9.2/9.3 (built first), reworked as stage 1 of 9.5 (D26–D29)
// with the 9.4 corrections. One suite, on a fresh offline temp server. The plan's own testing bar:
// "each dashboard number equals the count of rows in the view it links to, and every chart's plotted
// values equal the metric.* output" — checked with and without a standard selected. Also pins the
// double-filter regression 9.2 found (a stale local quick view must never re-narrow a server-filtered
// set), D27 (a board opens on its Dashboard), D30 (no "Not applicable" result) and the stage-1 UI rules:
// real buttons, formulas readable without hovering, no page-level horizontal scroll on a phone.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const isoCalc = require(path.join(__dirname, '..', 'api', '_isoCalc.js'));

const ROOT = path.join(__dirname, '..');
const PORT = 3145;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const SECTIONS = process.env.ISO_DASH_SECTIONS ? process.env.ISO_DASH_SECTIONS.split(',') : null;
const on = n => !SECTIONS || SECTIONS.includes(String(n));
const KPI_KEYS = ['req_applicable', 'req_assessed', 'req_not_assessed', 'req_gaps', 'req_conforming', 'req_evidence_to_review', 'findings_open', 'actions_open', 'actions_overdue'];

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
const data = res => res.body && res.body.data;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-dash-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser = null;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001', '14001'], title: 'dashboard board' }));
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const by9001 = reqs.filter(r => r.standard_code === '9001');
    const by14001 = reqs.filter(r => r.standard_code === '14001');
    const freshVersion = async id => (data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).find(r => r.id === id).row_version;
    const update = async (r, patch) => {
      const res = await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: r.id, patch, expectedVersion: await freshVersion(r.id) });
      if (res.status !== 200) throw new Error('fixture setup failed: requirement.update — ' + JSON.stringify(res.body));
    };
    // A real fixture: 3 conforming and 2 gaps (9001), one in progress, one with a result but needing
    // follow-up, one N/A (14001); a unit; one finding (9001) with an action linked across BOTH standards;
    // accepted evidence on one requirement and evidence still awaiting review on another (14001).
    // D35/R2: compliance_status derives the old fields. 'needs_follow_up' has no new-model
    // equivalent (one status replaces state+result — P4), so req_follow_up can never be nonzero
    // again; by9001[5] stays not assessed (there is no "in progress" either) and by9001[6] becomes
    // a real Partially Compliant row instead of standing in for the retired follow-up bucket.
    for (const r of by9001.slice(0, 3)) await update(r, { compliance_status: 'compliant' });
    for (const r of by9001.slice(3, 5)) await update(r, { compliance_status: 'non_compliant' });
    await update(by9001[6], { compliance_status: 'partially_compliant' });
    await update(by14001[2], { compliance_status: 'not_applicable', na_justification: 'Outside the agreed scope.' });
    const unitSite = data(await callIso(ADMIN, { op: 'unit.add', auditId: board.id, kind: 'site', name: 'Perth Depot' }));
    await update(by9001[3], { unit_ids: [unitSite.id] });
    const finding = data(await callIso(ADMIN, { op: 'finding.create', auditId: board.id, requirementId: by9001[3].id, classification: 'major_nc', title: 'Cross-standard gap' }));
    const action = data(await callIso(ADMIN, { op: 'action.create', auditId: board.id, targetType: 'finding', targetId: finding.id, title: 'Fix the gap', dueDate: '2020-01-01' }));
    await callIso(ADMIN, { op: 'action.link', auditId: board.id, actionId: action.id, targetType: 'requirement', targetId: by14001[0].id }); // the cross-standard share
    await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: by9001[0].id, url: 'https://etcher.sharepoint.com/sites/qms/x.docx', title: 'Policy' });
    const theLink = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: by9001[0].id })) || [])[0];
    // evidence.review needs can_verify, which no implicit membership grants — only an explicit
    // member.add as auditor/audit_manager does (checked, not assumed: an earlier draft got a silent 403).
    const memberRes = await callIso(ADMIN, { op: 'member.add', auditId: board.id, uid: 'offline:u9', auditRole: 'auditor' });
    if (memberRes.status !== 200) throw new Error('fixture setup failed: member.add — ' + JSON.stringify(memberRes.body));
    const reviewRes = await callIso({ id: 'u9', role: 'staff' }, { op: 'evidence.review', auditId: board.id, linkId: theLink.linkId, verdict: 'accepted', expectedVersion: theLink.linkRowVersion });
    if (reviewRes.status !== 200) throw new Error('fixture setup failed: evidence.review — ' + JSON.stringify(reviewRes.body));
    const pendingRes = await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: by14001[1].id, url: 'https://etcher.sharepoint.com/sites/qms/aspects.xlsx', title: 'Aspects register' });
    if (pendingRes.status !== 200) throw new Error('fixture setup failed: second evidence.addLink — ' + JSON.stringify(pendingRes.body));

    const dashFor = async std => data(await callIso(ADMIN, { op: 'dashboard.audit', auditId: board.id, ...(std ? { standard: std } : {}) }));
    const listOpFor = entity => ({ requirement: 'requirement.list', finding: 'finding.list', action: 'action.list' })[entity];
    const evidenceSummary = data(await callIso(ADMIN, { op: 'evidence.summary', auditId: board.id })) || {};
    const hasToReview = id => { const s = evidenceSummary[id]; return !!(s && (s.toReview || s.suggested)); };

    // ── A: the dashboard's numbers are metric.audit's numbers — never a second truth ───────────────
    if (on('A')) {
      const metrics = data(await callIso(ADMIN, { op: 'metric.audit', auditId: board.id }));
      const dash = await dashFor(null);
      const kpi = key => dash.kpis.find(k => k.key === key) || {};
      ok(JSON.stringify(dash.kpis.map(k => k.key)) === JSON.stringify(KPI_KEYS), `the stage-1 KPI row, in order (got ${dash.kpis.map(k => k.key).join(', ')})`);
      for (const key of KPI_KEYS) ok(kpi(key).value === metrics[key], `${key} on the dashboard equals metric.audit's own ${key} (got ${kpi(key).value} vs ${metrics[key]})`);
      // D35/R2: req_follow_up is always 0 now (nothing can produce assessment_state
      // 'needs_follow_up' any more — see the fixture comment above); req_assessed is 6, not 5.
      ok(metrics.req_assessed === 3 + 2 + 1 && metrics.req_follow_up === 0 && metrics.req_not_applicable === 1, `fixture: 6 assessed, 0 needing follow-up (retired), 1 not applicable (got ${metrics.req_assessed}/${metrics.req_follow_up}/${metrics.req_not_applicable})`);
      ok(metrics.req_assessed + metrics.req_follow_up + metrics.req_not_assessed === metrics.req_applicable, 'assessed + follow-up + not assessed = applicable, exactly');
      ok(kpi('req_assessed').display === `${metrics.req_assessed} of ${metrics.req_applicable}` && kpi('req_conforming').display === `${metrics.req_conforming} of ${metrics.req_applicable}`, `assessed and conforming read "X of Y" (D28) (got ${kpi('req_assessed').display}; ${kpi('req_conforming').display})`);
      ok(kpi('req_conforming').detail === `${metrics.conformance_pct}% conforming`, `conforming's percentage is conformance_pct (got ${kpi('req_conforming').detail})`);
      ok(!/need follow-up/.test(kpi('req_assessed').detail || ''), `the retired follow-up bucket names nothing on the assessed tile (got ${kpi('req_assessed').detail})`);
      const independentEvidence = reqs.filter(r => hasToReview(r.id)).length;
      ok(metrics.req_evidence_to_review === independentEvidence && independentEvidence === 1, `evidence to review equals the requirements evidence.summary flags — the register view's own source (got ${metrics.req_evidence_to_review} vs ${independentEvidence})`);
      ok(dash.kpis.every(k => typeof k.formula === 'string' && k.formula.length > 20) && !dash.kpis.some(k => 'notAvailable' in k), 'every KPI has its formula; no "not yet available" placeholders remain');
      ok(dash.charts.baseline_vs_current.data === null, 'this board was never imported, so its baseline chart has no data (the UI says why) — never an invented comparison');
      ok(dash.charts.req_by_result.segments.reduce((s, x) => s + x.value, 0) === metrics.req_applicable, 'req_by_result\'s segments sum to exactly req_applicable');
      ok(typeof dash.last_update_at === 'string' && !isNaN(Date.parse(dash.last_update_at)), `the header's last update is a real timestamp (got ${dash.last_update_at})`);
      ok(dash.standard === null, 'no standard selected: the response says so');

      // 9.6: cards and the clause matrix — never a second truth either.
      ok(dash.cards.length === 2 && JSON.stringify(dash.cards.map(c => c.standard).sort()) === JSON.stringify(['14001', '9001']), `one card per board standard, always (got ${dash.cards.map(c => c.standard)})`);
      for (const card of dash.cards) {
        const scoped = await dashFor(card.standard);
        ok(JSON.stringify(card.kpis) === JSON.stringify(scoped.kpis), `card[${card.standard}]'s kpis are byte-identical to calling the overview with that standard selected — the same buildDashboard, never a second computation`);
        ok(JSON.stringify(card.charts.req_by_result) === JSON.stringify(scoped.charts.req_by_result), `card[${card.standard}]'s result distribution matches too`);
      }
      const totalsByStandard = {};
      for (const [code, fams] of Object.entries(dash.clause_matrix)) totalsByStandard[code] = Object.values(fams).reduce((s, c) => ({ total: s.total + c.total, assessed: s.assessed + c.assessed, gaps: s.gaps + c.gaps }), { total: 0, assessed: 0, gaps: 0 });
      for (const card of dash.cards) {
        const t = totalsByStandard[card.standard] || { total: 0, assessed: 0, gaps: 0 };
        const k = key => card.kpis.find(x => x.key === key).value;
        // computeClauseMatrix's own "assessed" condition (state=complete, result recorded) is exactly
        // req_assessed's — req_follow_up is a different state (needs_follow_up) and is never counted here.
        ok(t.total === k('req_applicable'), `[${card.standard}] the matrix's cells sum to the card's own req_applicable (got ${t.total} vs ${k('req_applicable')})`);
        ok(t.assessed === k('req_assessed'), `[${card.standard}] the matrix's cells sum to the card's own req_assessed (got ${t.assessed} vs ${k('req_assessed')})`);
        ok(t.gaps === k('req_gaps'), `[${card.standard}] the matrix's cells sum to the card's own req_gaps (got ${t.gaps} vs ${k('req_gaps')})`);
      }
    }

    // ── B: every clickable number round-trips through the real list op, with and without a standard ─
    if (on('B')) {
      const roundTrip = async (dash, tag) => {
        for (const k of dash.kpis) {
          let rows = data(await callIso(ADMIN, { op: listOpFor(k.filter.entity), auditId: board.id, filter: k.filter })) || [];
          if (k.view === 'evidence_review') rows = rows.filter(r => hasToReview(r.id)); // the register's own view, same source
          ok(rows.length === k.value, `[${tag}] ${k.key}'s filter${k.view ? ' + its "' + k.view + '" view' : ''} returns exactly its own ${k.value} rows (got ${rows.length})`);
        }
        for (const chartKey of ['req_by_result', 'req_by_state', 'findings_by_classification', 'actions_by_status']) {
          for (const seg of dash.charts[chartKey].segments) {
            const rows = data(await callIso(ADMIN, { op: listOpFor(seg.filter.entity), auditId: board.id, filter: seg.filter })) || [];
            ok(rows.length === seg.value, `[${tag}] ${chartKey} "${seg.key}" (${seg.value}) round-trips to exactly that many rows (got ${rows.length})`);
          }
        }
      };
      const all = await dashFor(null), q = await dashFor('9001'), e = await dashFor('14001');
      await roundTrip(all, 'all');
      await roundTrip(q, '9001');
      await roundTrip(e, '14001');
      const v = (d, key) => d.kpis.find(k => k.key === key).value;
      ok(v(q, 'req_applicable') === by9001.length && v(e, 'req_applicable') === by14001.length - 1, `a standard scopes requirements (9001: ${v(q, 'req_applicable')}; 14001: ${v(e, 'req_applicable')}, its N/A one excluded)`);
      ok(v(q, 'req_applicable') + v(e, 'req_applicable') === v(all, 'req_applicable'), 'the two standards\' applicable counts add up to the whole board\'s');
      ok(v(q, 'findings_open') === 1 && v(e, 'findings_open') === 0, 'the finding follows its source requirement: counted under 9001, not 14001');
      ok(v(all, 'actions_open') === 1 && v(q, 'actions_open') === 1 && v(e, 'actions_open') === 1, 'the action linked to both standards counts once overall and once under each standard, by design (D29)');
      ok(v(q, 'req_evidence_to_review') === 0 && v(e, 'req_evidence_to_review') === 1, 'evidence awaiting review follows its target requirement (14001)');
      ok(q.standard === '9001' && q.kpis.every(k => k.filter.where.some(w => w.value === '9001')), 'every filter returned under 9001 carries the standard');
      const wrongStd = await callIso(ADMIN, { op: 'dashboard.audit', auditId: board.id, standard: '45001' });
      ok(wrongStd.status === 400 && /not on this board/.test((wrongStd.body && wrongStd.body.error) || ''), `a standard the board doesn't have is refused (got ${wrongStd.status} ${JSON.stringify(wrongStd.body && wrongStd.body.error)})`);
      const badStd = await callIso(ADMIN, { op: 'dashboard.audit', auditId: board.id, standard: '9001; drop' });
      ok(badStd.status === 400, `a malformed standard is refused (got ${badStd.status})`);
      const clientCall = await callIso({ id: 'cl1', role: 'client', clientId: 'c1' }, { op: 'dashboard.audit', auditId: board.id });
      ok(clientCall.status === 403, `a client caller is refused — the dashboard stays staff-only until Phase 13 (D26) (got ${clientCall.status})`);
      const fRows = data(await callIso(ADMIN, { op: 'finding.list', auditId: board.id })) || [];
      ok(fRows.length === 1 && fRows[0].standard_code === '9001', `finding.list carries each finding's standard (its source requirement's) (got ${fRows.map(f => f.standard_code)})`);
      const aRows = data(await callIso(ADMIN, { op: 'action.list', auditId: board.id })) || [];
      ok(aRows.length === 1 && JSON.stringify(aRows[0].standard_codes) === JSON.stringify(['14001', '9001']), `action.list carries every standard an action's confirmed links reach (got ${JSON.stringify(aRows.map(a => a.standard_codes))})`);
      // D30/D35(R2): the old "two fields can both claim N/A" ambiguity is gone — compliance_status
      // is the one field, and 'not_applicable' needs its own reason, same rule as before.
      const naResult = await callIso(ADMIN, { op: 'requirement.update', auditId: board.id, id: by9001[7].id, patch: { compliance_status: 'not_applicable' }, expectedVersion: await freshVersion(by9001[7].id) });
      ok(naResult.status === 400 && /reason/.test((naResult.body && naResult.body.error) || ''), `"Not applicable" with no reason is refused (D30/R2) (got ${naResult.status} ${JSON.stringify(naResult.body && naResult.body.error)})`);

      // 9.6: cards and the clause matrix always cover every board standard — a single-standard filter
      // at the top must never narrow either (D29's own scope: it narrows the KPI/chart overview only).
      // data_as_at/last_update_at are real per-request timestamps (ctx.now, api/iso.js) — three separate
      // HTTP calls legitimately differ by a few milliseconds there even with identical underlying data,
      // so the comparison strips timestamps and compares only the content that must stay stable.
      const cardsContent = d => d.cards.map(c => ({ standard: c.standard, kpis: c.kpis, charts: c.charts }));
      ok(JSON.stringify(cardsContent(all)) === JSON.stringify(cardsContent(q)) && JSON.stringify(cardsContent(q)) === JSON.stringify(cardsContent(e)), 'cards are identical whichever standard (or none) is selected at the top');
      ok(JSON.stringify(all.clause_matrix) === JSON.stringify(q.clause_matrix) && JSON.stringify(q.clause_matrix) === JSON.stringify(e.clause_matrix), 'the clause matrix is identical whichever standard (or none) is selected at the top');
      // Every clause-family cell's filter round-trips to exactly its own total, for both standards.
      let matrixCellsChecked = 0;
      for (const [code, fams] of Object.entries(all.clause_matrix)) {
        for (const [fam, cell] of Object.entries(fams)) {
          const rows = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id, filter: cell.filter })) || [];
          ok(rows.length === cell.total, `[${code} clause ${fam}] the matrix cell's filter returns exactly its own ${cell.total} rows (got ${rows.length})`);
          ok(rows.every(r => r.standard_code === code && r.clause_family === fam), `[${code} clause ${fam}] every returned row really is that standard and clause family (got ${JSON.stringify(rows.map(r => [r.standard_code, r.clause_family]))})`);
          matrixCellsChecked++;
        }
      }
      ok(matrixCellsChecked >= 10, `a real spread of clause-family cells was actually checked, not an accidentally-empty matrix (got ${matrixCellsChecked})`);
      const req0 = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id, filter: { entity: 'requirement', where: [{ field: 'id', op: 'eq', value: by9001[0].id }] } }));
      ok(req0[0] && req0[0].clause_family === isoCalc.clauseFamilyOf(req0[0].clause), `requirement.list attaches the real derived clause_family (got clause ${req0[0] && req0[0].clause} -> family ${req0[0] && req0[0].clause_family})`);
    }

    // ── P: 9.7 panels — every Needs attention count and panel figure is exactly its filter's rows ───
    if (on('P')) {
      const panelTrip = async (dash, tag) => {
        const pn = dash.panels;
        ok(pn && Array.isArray(pn.attention) && Array.isArray(pn.findings_panel) && Array.isArray(pn.actions_panel) && pn.shared_actions && Array.isArray(pn.recent_activity), `[${tag}] dashboard.audit returns the 9.7 panels`);
        for (const c of pn.attention) {
          let rows = data(await callIso(ADMIN, { op: listOpFor(c.filter.entity), auditId: board.id, filter: c.filter })) || [];
          if (c.view === 'evidence_review') rows = rows.filter(r => hasToReview(r.id));
          ok(rows.length === c.count, `[${tag}] Needs attention "${c.label}" returns exactly its ${c.count} rows (got ${rows.length})`);
          ok(c.items.length === Math.min(3, c.count) && c.items.every(it => rows.some(r => r.id === it.id)), `[${tag}] its listed records are among those rows`);
        }
        for (const t of [...pn.findings_panel, ...pn.actions_panel]) {
          const rows = data(await callIso(ADMIN, { op: listOpFor(t.filter.entity), auditId: board.id, filter: t.filter })) || [];
          ok(rows.length === t.value, `[${tag}] panel figure "${t.label}" (${t.filter.entity}) returns exactly its ${t.value} rows (got ${rows.length})`);
        }
        const sharedRows = data(await callIso(ADMIN, { op: 'action.list', auditId: board.id, filter: pn.shared_actions.filter })) || [];
        ok(sharedRows.length === pn.shared_actions.total, `[${tag}] shared actions' View all returns exactly its ${pn.shared_actions.total} (got ${sharedRows.length})`);
        return pn;
      };
      const all = await panelTrip(await dashFor(null), 'all');
      await panelTrip(await dashFor('9001'), '9001');
      await panelTrip(await dashFor('14001'), '14001');
      ok(all.shared_actions.total === 1 && all.shared_actions.rows[0].id === action.id && all.shared_actions.rows[0].standard_codes.join(',') === '14001,9001', `the fixture's one cross-standard action is the one shared action, listing both standards (got ${JSON.stringify(all.shared_actions.rows.map(r => [r.id, r.standard_codes]))})`);
      ok(all.shared_actions.rows[0].overdue === true, 'it is flagged overdue (due 2020-01-01)');
      const att = Object.fromEntries(all.attention.map(c => [c.key, c.count]));
      ok(att.overdue_actions === 1 && att.evidence_to_review === 1, `Needs attention names the overdue action and the evidence awaiting review (got ${JSON.stringify(att)})`);
      ok(all.recent_activity.length > 0 && all.recent_activity.every(a => !['evidence_downloaded', 'prompt_copied', 'prompt_downloaded'].includes(a.action)), 'recent activity lists changes only, never reads');
      const reqRows = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
      const actRows = data(await callIso(ADMIN, { op: 'action.list', auditId: board.id })) || [];
      ok(reqRows.every(r => typeof r.sr_awaiting === 'boolean') && actRows.every(a => typeof a.is_shared === 'boolean'), 'requirement.list attaches sr_awaiting and action.list attaches is_shared — the panels\' filters are plain eq');
    }

    // ── C: the browser ─────────────────────────────────────────────────────────────────────────────
    if (on('C')) {
      browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 1100 } });
      const page = await browser.newPage();
      const errs = [], external = [];
      page.on('pageerror', x => errs.push('pageerror: ' + x.message.slice(0, 200)));
      page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
      page.on('request', rq => { const u = rq.url(); if (/^https?:/.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) && !/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|cdn\.tailwindcss\.com|cdn\.jsdelivr\.net/.test(u)) external.push(u); });
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
      await sleep(1000);
      await page.type('#login-email', 'b.canto@etchersolutions.com');
      await page.type('#login-password', 'TaskHub123');
      await page.keyboard.press('Enter');
      await sleep(1800);
      await page.evaluate(() => { window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; });
      const activeTab = () => page.evaluate(() => document.querySelector('.ws-tabstrip .ws-tab.active')?.childNodes[0].textContent.trim());
      const dashState = () => page.evaluate(() => ({
        pressed: [...document.querySelectorAll('.iso-dash-std')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.std),
        tiles: Object.fromEntries([...document.querySelectorAll('.iso-dash-kpi')].map(b => [b.dataset.key, b.querySelector('.iso-dash-kpi-value')?.textContent.trim()])),
      }));

      // D27: a board opens on its Dashboard — from a call with no tab, and from the sidebar.
      await page.evaluate(id => ISO.openBoard(id, 'findings'), board.id);
      await sleep(1200);
      await page.evaluate(id => ISO.openBoard(id), board.id);
      await sleep(1800);
      ok((await activeTab()) === 'Overview', `opening a board lands on Overview, not the tab you were last on (got ${await activeTab()})`);
      const tabOrder = await page.evaluate(() => [...document.querySelectorAll('.ws-tabstrip .ws-tab')].map(t => t.childNodes[0].textContent.trim()).join('|'));
      ok(tabOrder === 'Overview|Clauses|Documents|Actions', `Overview is the first of the wireframe's four tabs (D27/R5) (got ${tabOrder})`);
      await page.evaluate(() => ISO.setTab('evidence'));
      await sleep(900);
      await page.evaluate(id => document.querySelector(`.iso-nav-row[data-iso-audit="${id}"]`)?.click(), board.id);
      await sleep(1800);
      ok((await activeTab()) === 'Overview', `clicking the board in the sidebar also opens its Overview (got ${await activeTab()})`);

      // R5: everything below this point tests the old, untouched full dashboard (now one click
      // behind "Full dashboard" instead of the tab's own default) — switch once; it stays in Full
      // mode across every same-board setTab('dashboard')/openBoard(board.id) call below (R5's own
      // design: the mode only resets to Overview when a genuinely different board opens).
      await page.evaluate(() => ISO._ovShowFull());
      await sleep(1200);

      // Header: only what the board's top strip lacks, starting with the client (D26: per client).
      const header = await page.evaluate(() => ({ title: document.querySelector('.iso-dash-title')?.innerText || '', items: [...document.querySelectorAll('.iso-dash-hdr-item dt')].map(d => d.textContent.trim()) }));
      ok(header.title.length > 3 && !/Client not found/.test(header.title) && header.title.includes(board.ref), `the header names the client and the audit (got ${JSON.stringify(header.title)})`);
      ok(JSON.stringify(header.items) === JSON.stringify(['Audit type', 'Stage', 'Planned dates', 'Report due', 'Last update']), `the header lists type, stage, dates, report due and last update (got ${header.items.join(', ')})`);

      // The KPI row: real buttons, in two groups, the formula as a description outside the name.
      const kpiMeta = await page.evaluate(() => [...document.querySelectorAll('.iso-dash-kpi')].map(b => ({ tag: b.tagName, key: b.dataset.key, name: b.innerText, desc: document.getElementById(b.getAttribute('aria-describedby'))?.textContent || '', group: b.closest('.iso-dash-kpi-group')?.getAttribute('aria-label') })));
      ok(kpiMeta.length === 9 && kpiMeta.every(k => k.tag === 'BUTTON'), `nine KPI tiles, each a real <button> (got ${kpiMeta.length}: ${[...new Set(kpiMeta.map(k => k.tag))]})`);
      ok(kpiMeta.every(k => k.desc.length > 20 && !k.name.includes(k.desc.slice(0, 20))), 'each tile is described by its formula, and the formula is not part of the button\'s own name');
      ok(kpiMeta.slice(0, 5).every(k => k.group === 'Assessment') && kpiMeta.slice(5).every(k => k.group === 'Follow-up work'), `assessment figures and follow-up work sit in two separate groups (got ${kpiMeta.map(k => k.group).join(', ')})`);
      const howto = await page.evaluate(async () => { const d = document.querySelector('.iso-dash-howto'); if (!d) return { closed: false, open: false, items: 0, text: '' }; const closed = !d.open; d.querySelector('summary').click(); await new Promise(r => setTimeout(r, 100)); return { closed, open: d.open, items: d.querySelectorAll('dt').length, text: d.innerText }; });
      ok(howto.closed && howto.open && howto.items === 9 && /Overall conformance/.test(howto.text), `"How these numbers are calculated" opens to all nine formulas, visible without hovering (got ${JSON.stringify({ closed: howto.closed, open: howto.open, items: howto.items })})`);

      // Keyboard only: focus a tile, press Enter, land on the filtered register.
      await page.evaluate(() => document.querySelector('.iso-dash-kpi[data-key="actions_overdue"]')?.focus());
      await page.keyboard.press('Enter');
      await sleep(1500);
      const viaKeyboard = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('tr[data-iact]').length, banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      ok(viaKeyboard.tab === 'Actions' && viaKeyboard.rows === 1 && /Overdue actions/.test(viaKeyboard.banner) && /1 matching/.test(viaKeyboard.banner), `Enter on the focused "Overdue actions" tile opens Actions filtered to its 1 row, the banner naming it (got ${JSON.stringify(viaKeyboard)})`);

      // The 9.2 regression, still pinned: a stale "Verified & closed" view must not re-hide the rows.
      await page.evaluate(() => ISO._actClearDashFilter());
      await sleep(900);
      await page.evaluate(() => ISO._actSetView('closed'));
      await sleep(500);
      ok((await page.evaluate(() => document.querySelectorAll('tr[data-iact]').length)) === 0, 'setup: the "Verified & closed" quick view shows 0 of our (open, overdue) actions');
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);
      await page.evaluate(() => document.querySelector('.iso-dash-kpi[data-key="actions_overdue"]')?.click());
      await sleep(1500);
      const regression = await page.evaluate(() => ({ rows: document.querySelectorAll('tr[data-iact]').length, quickViews: [...document.querySelectorAll('#iso-act-tab .card button')].filter(b => ['All actions', 'Open', 'Overdue', 'Verified & closed'].includes(b.textContent.trim())).length }));
      ok(regression.rows === 1 && regression.quickViews === 0, `the stale quick view never re-hides the dashboard's filtered row, and its buttons are hidden while filtered (got ${JSON.stringify(regression)})`);
      await page.evaluate(() => [...document.querySelectorAll('.iso-dash-filter-banner button')].find(b => b.textContent.trim() === 'Clear filter')?.click());
      await sleep(1200);
      const cleared = await page.evaluate(() => ({ banner: !!document.querySelector('.iso-dash-filter-banner'), quickViews: [...document.querySelectorAll('#iso-act-tab .card button')].filter(b => ['All actions', 'Open', 'Overdue', 'Verified & closed'].includes(b.textContent.trim())).length }));
      ok(!cleared.banner && cleared.quickViews === 4, `Clear filter removes the banner and brings the quick views back (got ${JSON.stringify(cleared)})`);

      // The standard filter (D29): every figure follows it; click-through keeps it; Back keeps it too.
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);
      const q = await dashFor('9001');
      await page.evaluate(() => document.querySelector('.iso-dash-std[data-std="9001"]')?.click());
      await sleep(1500);
      let st = await dashState();
      ok(JSON.stringify(st.pressed) === JSON.stringify(['9001']), `pressing ISO 9001 marks it pressed (got ${JSON.stringify(st.pressed)})`);
      ok(q.kpis.every(k => st.tiles[k.key] === k.display), `every tile shows dashboard.audit's 9001 figure (got ${JSON.stringify(st.tiles)})`);
      const chip = await page.evaluate(() => document.querySelector('.iso-dash-chip')?.innerText || '');
      ok(/Showing ISO 9001.*only/.test(chip), `an active-filter chip says what is shown (got ${JSON.stringify(chip)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-kpi[data-key="req_gaps"]')?.click());
      await sleep(1600);
      const gapsView = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('[data-ireq]').length, banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      const gapsValue = q.kpis.find(k => k.key === 'req_gaps').value;
      ok(gapsView.tab === 'Clauses' && gapsView.rows === gapsValue && /Gaps identified · ISO 9001/.test(gapsView.banner) && new RegExp(`${gapsValue} matching`).test(gapsView.banner), `the 9001 "Gaps identified" tile opens exactly its ${gapsValue} requirements, the banner naming the standard (got ${JSON.stringify(gapsView)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-back')?.click());
      await sleep(1500);
      st = await dashState();
      ok((await activeTab()) === 'Overview' && JSON.stringify(st.pressed) === JSON.stringify(['9001']), `"Back to overview" returns with ISO 9001 still selected (got ${await activeTab()}, ${JSON.stringify(st.pressed)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-chip-x')?.click());
      await sleep(1500);
      st = await dashState();
      ok(JSON.stringify(st.pressed) === JSON.stringify(['']), `clearing the chip goes back to All standards (got ${JSON.stringify(st.pressed)})`);

      // The evidence figure opens the register's "Evidence to review" view on a freshly loaded register
      // (that view used to come up empty there — its flag was set only after filtering).
      await page.evaluate(() => document.querySelector('.iso-dash-std[data-std="14001"]')?.click());
      await sleep(1500);
      await page.evaluate(() => document.querySelector('.iso-dash-kpi[data-key="req_evidence_to_review"]')?.click());
      await sleep(1600);
      const evView = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), ids: [...document.querySelectorAll('[data-ireq]')].map(t => t.dataset.ireq), banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      ok(evView.tab === 'Clauses' && evView.ids.length === 1 && evView.ids[0] === by14001[1].id && /1 matching/.test(evView.banner), `the 14001 "Evidence to review" tile opens exactly the one requirement whose evidence awaits review (got ${JSON.stringify(evView)})`);

      // D35/R2 in the UI: the old separate State/Result pickers are gone — one Status select, with
      // N/A among its 6 real options (not a 7th "both fields disagree" possibility, D30's concern
      // in its new form). The standard filter picked for the evidence check above (14001) now
      // persists across tabs by design (the header strip's own switch, 2026-10-03) — clear it so
      // every 9001 row is back in the register.
      await page.evaluate(() => ISO._boardSetStandard(''));
      await sleep(1200);
      await page.evaluate(() => ISO._reqClearDashFilter());
      await sleep(1200);
      await page.evaluate(id => ISO._reqOpenMore(id), by9001[0].id);
      await sleep(900);
      const statusOptions = await page.evaluate(() => ({ status: [...document.querySelectorAll('#dr-status option')].map(o => o.value), hasOldState: !!document.getElementById('dr-state'), hasOldResult: !!document.getElementById('dr-result') }));
      ok(statusOptions.status.length === 6 && statusOptions.status.includes('not_applicable') && !statusOptions.hasOldState && !statusOptions.hasOldResult, `one Status picker with all 6 values, including N/A — no separate State/Result fields (D35/R2) (got ${JSON.stringify(statusOptions)})`);
      await page.evaluate(() => document.getElementById('iso-drawer-close')?.click());

      // Accessibility and honesty of the charts (kept from 9.3).
      await page.evaluate(id => ISO.openBoard(id), board.id);
      await sleep(1800);
      await page.evaluate(() => { const b = document.querySelector('.iso-dash-std[data-std=""]'); if (b) b.click(); });
      await sleep(1500);
      const chartMeta = await page.evaluate(() => [...document.querySelectorAll('.iso-chart')].map(f => ({ role: f.getAttribute('role'), aria: f.getAttribute('aria-label'), text: f.innerText })));
      ok(chartMeta.length >= 12 && chartMeta.every(c => c.role === 'img' && c.aria && c.aria.length > 5), `every chart carries role="img" and a real aria-label (got ${chartMeta.length} charts)`);
      ok(!chartMeta.some(c => /Actions open vs closed|Evidence status/.test(c.text)) && !(await page.evaluate(() => !!document.querySelector('.iso-dash-upcoming'))), '9.7 retired the charts its panels replace: Actions open vs closed, Evidence status, Upcoming deadlines');
      // 9.7 panels render, in a sensible order, and their numbers are real links.
      const panelUi = await page.evaluate(() => ({
        sections: [...document.querySelectorAll('#iso-dash-tab .iso-dash-section-h')].map(h => h.textContent.trim().replace(/\s+\d+$/, '')),
        attn: [...document.querySelectorAll('.iso-attn-row')].map(r => ({ key: r.dataset.key, count: Number(r.querySelector('.iso-attn-count')?.textContent) })),
        tiles: [...document.querySelectorAll('.iso-panel-actions .iso-panel-tile')].map(t => ({ key: t.dataset.key, v: Number(t.querySelector('.iso-panel-tile-v')?.textContent) })),
        sharedRows: document.querySelectorAll('.iso-shared-row').length, activity: document.querySelectorAll('.iso-activity-row').length,
        evdQueue: !!document.querySelector('.iso-evd-queue'),
      }));
      ok(panelUi.sections[0] === 'Needs attention' && panelUi.sections.includes('Findings') && panelUi.sections.includes('Actions') && panelUi.sections.some(t => /^Shared actions/.test(t)) && panelUi.sections.includes('Evidence') && panelUi.sections.includes('Recent activity'), `the stage-3 panels render, Needs attention first (got ${JSON.stringify(panelUi.sections)})`);
      ok(panelUi.attn.some(a => a.key === 'overdue_actions' && a.count === 1) && panelUi.sharedRows === 1 && panelUi.activity > 0 && panelUi.evdQueue, `Needs attention, the shared actions table, recent activity and the evidence queue link all show real data (got ${JSON.stringify(panelUi)})`);
      const overdueTile = panelUi.tiles.find(t => t.key === 'overdue');
      await page.evaluate(() => document.querySelector('.iso-panel-actions .iso-panel-tile[data-key="overdue"]').click());
      await sleep(1500);
      const afterTile = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('tr[data-iact]').length, banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      ok(afterTile.tab === 'Actions' && afterTile.rows === overdueTile.v && /Overdue/.test(afterTile.banner), `the Actions panel's "Overdue" opens exactly its ${overdueTile && overdueTile.v} actions (got ${JSON.stringify(afterTile)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-back')?.click());
      await sleep(1500);
      await page.evaluate(() => document.querySelector('.iso-attn-item')?.click());
      await sleep(1500);
      const afterItem = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('tr[data-iact], [data-ireq], tr[data-ifnd]').length }));
      ok(afterItem.rows === 1, `a record listed under Needs attention opens just that record (got ${JSON.stringify(afterItem)})`);
      await page.evaluate(id => ISO.openBoard(id), board.id);
      await sleep(1800);
      ok(chartMeta.every(c => /As at/.test(c.text)), 'every chart shows its "As at" caption');
      ok(chartMeta.some(c => /Workbook baseline vs now/.test(c.text) && /No workbook was imported/.test(c.text)), 'the baseline chart says plainly that this board has no workbook baseline');
      await page.evaluate(() => { const row = [...document.querySelectorAll('.iso-chart-bar-row')].find(r => JSON.parse(r.dataset.filter).entity === 'finding'); row && row.click(); });
      await sleep(1500);
      const afterChartClick = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('tr[data-ifnd]').length }));
      ok(afterChartClick.tab === 'Actions' && afterChartClick.rows === 1, `a chart segment is a real link too: findings by classification opens its 1 finding (got ${JSON.stringify(afterChartClick)})`);
      await page.evaluate(id => ISO.openBoard(id), board.id);
      await sleep(1800);

      // ── 9.6: the promoted Assessment results summary ────────────────────────────────────────────
      const summaryMeta = await page.evaluate(() => { const f = document.querySelector('.iso-dash-results'); return f ? { role: f.getAttribute('role'), aria: f.getAttribute('aria-label'), labels: [...f.querySelectorAll('.iso-dash-result-label')].map(e => e.textContent.trim()) } : null; });
      ok(!!summaryMeta && summaryMeta.role === 'img' && summaryMeta.aria.length > 10, `the Assessment results summary is a real figure with role="img" and a real aria-label (got ${JSON.stringify(summaryMeta)})`);
      ok(JSON.stringify(summaryMeta.labels) === JSON.stringify(['Implemented Effective', 'Partially Implemented', 'Not Implemented', 'Unassessed']), `results are shown best to worst, then Unassessed last — never the row-insertion order (got ${JSON.stringify(summaryMeta.labels)})`);
      await page.evaluate(() => [...document.querySelectorAll('.iso-dash-result-row')].find(r => r.textContent.includes('Not Implemented'))?.click());
      await sleep(1500);
      const afterResultClick = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('[data-ireq]').length, banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      const notImplExpected = (await (async () => { const rows = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id, filter: { entity: 'requirement', where: [{ field: 'applicability', op: 'in', value: ['applicable', 'review'] }, { field: 'assessment_result', op: 'eq', value: 'not_implemented' }] } })); return rows.length; })());
      ok(afterResultClick.tab === 'Clauses' && afterResultClick.rows === notImplExpected && notImplExpected > 0, `clicking "Not Implemented" in the summary opens exactly its ${notImplExpected} requirements (got ${JSON.stringify(afterResultClick)})`);
      await page.evaluate(() => ISO._reqClearDashFilter());
      await sleep(900);
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);

      // ── 9.6: standard cards — always both standards, never affected by the top filter ───────────
      let cardMeta = await page.evaluate(() => [...document.querySelectorAll('.iso-dash-card')].map(c => c.querySelector('h4')?.textContent.trim()));
      ok(cardMeta.length === 2 && cardMeta.some(t => /9001/.test(t)) && cardMeta.some(t => /14001/.test(t)), `one card per board standard renders (got ${JSON.stringify(cardMeta)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-std[data-std="9001"]')?.click());
      await sleep(1500);
      cardMeta = await page.evaluate(() => [...document.querySelectorAll('.iso-dash-card')].map(c => c.querySelector('h4')?.textContent.trim()));
      ok(cardMeta.length === 2, `both cards still render with 9001 selected at the top (got ${JSON.stringify(cardMeta)})`);
      await page.evaluate(() => document.querySelector('.iso-dash-chip-x')?.click());
      await sleep(1500);
      // A stat inside the 9001 card opens Requirements filtered to exactly that card's own number.
      const cardGapsValue = q.kpis.find(k => k.key === 'req_gaps').value;
      await page.evaluate(() => { const card = [...document.querySelectorAll('.iso-dash-card')].find(c => /9001/.test(c.querySelector('h4')?.textContent || '')); card.querySelector('.iso-dash-card-stat[data-label^="Gaps identified"]')?.click(); });
      await sleep(1500);
      const afterCardStatClick = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('[data-ireq]').length, banner: document.querySelector('.iso-dash-filter-banner')?.innerText || '' }));
      ok(afterCardStatClick.tab === 'Clauses' && afterCardStatClick.rows === cardGapsValue && /ISO 9001/.test(afterCardStatClick.banner), `a stat inside the 9001 card opens exactly its own ${cardGapsValue} gaps, scoped to that standard (got ${JSON.stringify(afterCardStatClick)})`);
      await page.evaluate(() => ISO._reqClearDashFilter());
      await sleep(900);
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);
      // "Open register" opens every requirement of that standard — no applicability restriction.
      const wholeStdRows = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id, filter: { entity: 'requirement', where: [{ field: 'standard_code', op: 'eq', value: '14001' }] } }));
      await page.evaluate(() => { const card = [...document.querySelectorAll('.iso-dash-card')].find(c => /14001/.test(c.querySelector('h4')?.textContent || '')); card.querySelector('.iso-dash-card-open')?.click(); });
      await sleep(1500);
      const afterOpenRegister = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('[data-ireq]').length }));
      ok(afterOpenRegister.tab === 'Clauses' && afterOpenRegister.rows === wholeStdRows.length, `"Open register" on the 14001 card opens all ${wholeStdRows.length} of its requirements, N/A included (got ${JSON.stringify(afterOpenRegister)})`);
      await page.evaluate(() => ISO._reqClearDashFilter());
      await sleep(900);
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);

      // ── 9.6: the clause matrix — a real table, keyboard-reachable cells, never affected by the filter ─
      const matrixMeta = await page.evaluate(() => { const t = document.querySelector('.iso-dash-matrix'); if (!t) return null; return { rows: t.querySelectorAll('tbody tr').length, cols: t.querySelectorAll('thead th').length - 1, emptyCells: t.querySelectorAll('.iso-dash-matrix-empty').length, cellButtons: t.querySelectorAll('.iso-dash-matrix-cell').length }; });
      ok(matrixMeta && matrixMeta.rows === 7 && matrixMeta.cols === 2, `the matrix has 7 clause rows and 2 standard columns (got ${JSON.stringify(matrixMeta)})`);
      ok(matrixMeta.cellButtons + matrixMeta.emptyCells === matrixMeta.rows * matrixMeta.cols, 'every cell is either a real button or an honest "—", never blank');
      await page.evaluate(() => document.querySelector('.iso-dash-std[data-std="9001"]')?.click());
      await sleep(1500);
      const matrixAfterFilter = await page.evaluate(() => document.querySelectorAll('.iso-dash-matrix tbody tr').length);
      ok(matrixAfterFilter === 7, 'the matrix keeps all 7 rows with 9001 selected at the top — the standard filter never narrows it');
      await page.evaluate(() => document.querySelector('.iso-dash-chip-x')?.click());
      await sleep(1500);
      const matrixCell = await page.evaluate(() => { const cell = document.querySelector('.iso-dash-matrix-cell'); return cell ? { label: cell.dataset.label, filter: JSON.parse(cell.dataset.filter) } : null; });
      ok(!!matrixCell, 'at least one real clause-matrix cell exists to click');
      const matrixCellExpected = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id, filter: matrixCell.filter }));
      await page.evaluate(() => document.querySelector('.iso-dash-matrix-cell').click());
      await sleep(1500);
      const afterMatrixClick = await page.evaluate(() => ({ tab: document.querySelector('.ws-tab.active')?.childNodes[0].textContent.trim(), rows: document.querySelectorAll('[data-ireq]').length }));
      ok(afterMatrixClick.tab === 'Clauses' && afterMatrixClick.rows === matrixCellExpected.length, `clicking a clause-matrix cell opens exactly its own ${matrixCellExpected.length} requirements (got ${JSON.stringify(afterMatrixClick)})`);
      await page.evaluate(() => ISO._reqClearDashFilter());
      await sleep(900);
      await page.evaluate(() => ISO.setTab('dashboard'));
      await sleep(1500);

      // A single-standard board has nothing to filter by, so no filter bar and no cards (nothing to
      // compare) — but the clause matrix still shows, with its one column.
      const single = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['45001'], title: 'empty for dashboard' }));
      await page.evaluate(id => ISO.openBoard(id), single.id);
      await sleep(1800);
      await page.evaluate(() => ISO._ovShowFull()); // R5: a fresh board always opens on Overview first
      await sleep(1200);
      ok((await page.evaluate(() => document.querySelectorAll('.iso-dash-filters').length)) === 0, 'a one-standard board shows no standard filter');
      ok((await page.evaluate(() => document.querySelectorAll('.iso-dash-card').length)) === 0, 'a one-standard board shows no comparison cards (nothing to compare against)');
      const singleMatrixCols = await page.evaluate(() => document.querySelectorAll('.iso-dash-matrix thead th').length - 1);
      ok(singleMatrixCols === 1, `the clause matrix still shows, with the board's one standard as its only column (got ${singleMatrixCols})`);
      const emptyChart = await page.evaluate(() => [...document.querySelectorAll('.iso-chart')].find(f => f.innerText.includes('Findings by classification'))?.innerText || '');
      ok(/No findings raised on this board yet/.test(emptyChart), `an empty board says so in words (got ${JSON.stringify(emptyChart.slice(0, 120))})`);

      // Phone width: no page-level horizontal scroll on the dashboard.
      await page.evaluate(id => ISO.openBoard(id), board.id);
      await sleep(1600);
      await page.setViewport({ width: 390, height: 844 });
      await sleep(900);
      const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      ok(overflow.sw <= overflow.cw, `at 390px wide the dashboard has no page-level horizontal scroll (got ${JSON.stringify(overflow)})`);
      await page.setViewport({ width: 1500, height: 1100 });

      // A reload keeps the tab you were on (only *opening* a board lands on Dashboard).
      await page.evaluate(() => ISO.setTab('findings'));
      await sleep(900);
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(2600);
      ok((await activeTab()) === 'Actions', `a reload keeps the current tab (got ${await activeTab()})`);

      ok((await page.evaluate(() => (window.__opened || []).length)) === 0, 'nothing on the dashboard ever called window.open');
      ok(external.length === 0, `no request left the local server (got ${JSON.stringify(external.slice(0, 5))})`);
      ok(errs.length === 0, `no console errors or native dialogs (got ${JSON.stringify(errs.slice(0, 8))})`);
    }
  } catch (e) {
    console.error('CRASHED', e);
    fail.push('the suite crashed: ' + e.message);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
