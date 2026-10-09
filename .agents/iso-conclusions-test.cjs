// Release-1 B1 — defensible conclusions (D44–D48). Server rules first (fast), then the UI wiring.
//   D44 OFI is a flag on Compliant / Partially Compliant, never a status ('ofi' accepted as an alias).
//   D45 "Outside this audit's scope" — its own status, excluded from coverage, counts = click-through lists.
//   D46 a basis ("Current system") before approval and before closing the board.
//   D48 a gap reason on Partially Compliant / Non-Compliant, required with the basis.
//   D47 Apply to related proposes: copies status, basis, gap reason, plan and live documents; every
//       target arrives derived + proposed (Lead and sole auditor included); one click confirms.
//   B1.6 risk-sorted sign-off reasons + cross-standard consistency warning; B1.7 staff sufficiency
//   flag, sample fields, observation notes; B1.8 status per clause in the add-document form.
const H = require('./_iso-harness.cjs');
const AUD = H.STAFF('u2');
const VIEWER = H.STAFF('u3');

H.run('iso-conclusions-test', 3165, async (t, srv) => {
  const A = H.ADMIN;
  const b = await srv.board({ standards: ['9001', '14001', '45001'], members: [{ id: AUD.id, auditRole: 'auditor' }, { id: VIEWER.id, auditRole: 'reviewer' }] });
  const row = k => srv.row(b, k);
  const basis = 'Seen the register and two signed records.';

  // ── D44 OFI is a flag ──────────────────────────────────────────────────────────────────────────
  t.eq((await srv.set(b, '9001 4.1', { compliance_status: 'compliant', ofi: true, current_system: basis })).status, 200, 'Compliant + OFI saves');
  let r = await row('9001 4.1');
  t.ok(r.compliance_status === 'compliant' && r.ofi === true, `stored as Compliant with the OFI flag (got ${r.compliance_status} / ${r.ofi})`);
  await srv.set(b, '9001 4.2', { compliance_status: 'ofi', current_system: basis });
  r = await row('9001 4.2');
  t.ok(r.compliance_status === 'compliant' && r.ofi === true, `the old 'ofi' status is accepted as an alias and stored as Compliant + OFI (got ${r.compliance_status} / ${r.ofi})`);
  await srv.set(b, '9001 4.3', { compliance_status: 'partially_compliant', ofi: true, gap_reason: 'ineffective', current_system: basis });
  r = await row('9001 4.3');
  t.ok(r.compliance_status === 'partially_compliant' && r.ofi === true, 'Partially Compliant can carry the OFI flag too');
  await srv.set(b, '9001 4.3', { compliance_status: 'non_compliant', gap_reason: 'not_implemented' });
  r = await row('9001 4.3');
  t.ok(r.ofi === false, `moving to Non-Compliant clears the OFI flag (got ${r.ofi})`);
  t.eq((await srv.set(b, '9001 4.4', { compliance_status: 'ofi_maybe' })).status, 400, 'an unknown status is refused');

  // ── D48 gap reason ────────────────────────────────────────────────────────────────────────────
  t.eq((await srv.set(b, '9001 4.4', { compliance_status: 'partially_compliant', gap_reason: 'nonsense' })).status, 400, 'an unknown gap reason is refused');
  await srv.set(b, '9001 4.4', { compliance_status: 'compliant', gap_reason: 'ineffective', current_system: basis });
  r = await row('9001 4.4');
  t.ok(r.gap_reason == null, `a gap reason is cleared on a Compliant clause (got ${r.gap_reason})`);

  // ── D45 Outside this audit's scope ────────────────────────────────────────────────────────────
  const before = await srv.must(A, { op: 'metric.audit', auditId: b.id });
  t.eq((await srv.set(b, '14001 4.1', { compliance_status: 'out_of_scope' })).status, 200, 'Outside this audit\'s scope saves without a reason');
  r = await row('14001 4.1');
  t.ok(r.compliance_status === 'out_of_scope' && r.applicability === 'out_of_scope', `stored with its own derived applicability (got ${r.compliance_status} / ${r.applicability})`);
  const after = await srv.must(A, { op: 'metric.audit', auditId: b.id });
  t.ok(after.req_total === before.req_total && after.req_applicable === before.req_applicable - 1, `out of scope leaves the total alone and drops out of "applicable" (applicable ${before.req_applicable} → ${after.req_applicable})`);
  const dash = await srv.must(A, { op: 'dashboard.audit', auditId: b.id });
  const kpi = dash.kpis.find(k => k.key === 'req_applicable');
  const listed = await srv.must(A, { op: 'requirement.list', auditId: b.id, filter: kpi.filter });
  t.ok(listed.length === kpi.value && !listed.some(x => x.compliance_status === 'out_of_scope'), `the "applicable" tile and its click-through list agree and exclude out-of-scope (tile ${kpi.value}, list ${listed.length})`);
  await srv.set(b, '14001 4.1', { compliance_status: 'not_applicable', na_justification: '' });
  t.eq((await srv.set(b, '14001 4.1', { compliance_status: 'not_applicable' })).status, 400, 'Not applicable still needs a reason (unchanged)');

  // ── D46 / D48 basis gate on approval ──────────────────────────────────────────────────────────
  await srv.set(b, '9001 5.1.1', { compliance_status: 'compliant' }, AUD);
  r = await row('9001 5.1.1');
  t.ok(r.approval_state === 'proposed', 'an auditor\'s status arrives proposed');
  let res = await srv.call(A, { op: 'requirement.approve', auditId: b.id, id: r.id, expectedVersion: r.row_version });
  t.ok(res.status === 400 && /basis/i.test(JSON.stringify(res.body)), `approving without a basis is refused, naming the basis (got ${res.status} ${JSON.stringify(res.body).slice(0, 120)})`);
  await srv.set(b, '9001 5.1.1', { current_system: basis }, AUD);
  r = await row('9001 5.1.1');
  res = await srv.call(A, { op: 'requirement.approve', auditId: b.id, id: r.id, expectedVersion: r.row_version });
  t.eq(res.status, 200, 'with a basis it approves');
  await srv.set(b, '9001 5.1.2', { compliance_status: 'partially_compliant', current_system: basis }, AUD);
  r = await row('9001 5.1.2');
  res = await srv.call(A, { op: 'requirement.approve', auditId: b.id, id: r.id, expectedVersion: r.row_version });
  t.ok(res.status === 400 && /gap reason/i.test(JSON.stringify(res.body)), `Partially Compliant without a gap reason is refused (got ${res.status})`);
  await srv.set(b, '9001 5.2.1', { compliance_status: 'compliant' }, AUD);
  const bulk = await srv.must(A, { op: 'requirement.bulkApprove', auditId: b.id, ids: [(await row('9001 5.2.1')).id, (await row('9001 5.1.2')).id] });
  t.ok(bulk.updated === 0 && bulk.skipped.length === 2 && bulk.skipped.every(s => /basis|gap reason/i.test(s.reason)), `bulk approve skips rows missing a basis or gap reason, saying why (got ${JSON.stringify(bulk)})`);

  // Lead / sole auditor: final on entry only once the basis is complete.
  await srv.set(b, '9001 5.3', { compliance_status: 'compliant' });
  r = await row('9001 5.3');
  t.ok(r.approval_state === 'proposed', `the Lead's own status without a basis is not auto-approved (got ${r.approval_state})`);
  await srv.set(b, '9001 5.3', { current_system: basis });
  r = await row('9001 5.3');
  t.ok(r.approval_state === 'approved', `…and is approved the moment the Lead adds the basis (got ${r.approval_state})`);
  await srv.set(b, '9001 6.1.1', { compliance_status: 'non_compliant', gap_reason: 'no_evidence', current_system: basis });
  t.ok((await row('9001 6.1.1')).approval_state === 'approved', 'the Lead\'s complete status (basis + gap reason) is approved on entry, as before');

  // ── D46 close gate (a small board of its own) ──────────────────────────────────────────────────
  const c = await srv.board({ standards: ['9001'], title: 'Close gate' });
  await srv.set(c, '9001 4.1', { compliance_status: 'compliant' });
  let audit = await srv.must(A, { op: 'audit.get', auditId: c.id }); audit = audit.audit || audit;
  res = await srv.call(A, { op: 'audit.update', auditId: c.id, expectedVersion: audit.row_version, patch: { stage: 'closed' } });
  t.ok(res.status === 400 && /4\.1/.test(JSON.stringify(res.body)) && /basis/i.test(JSON.stringify(res.body)), `closing is refused while a clause lacks a basis, naming it (got ${res.status} ${JSON.stringify(res.body).slice(0, 140)})`);
  await srv.set(c, '9001 4.1', { current_system: basis });
  audit = await srv.must(A, { op: 'audit.get', auditId: c.id }); audit = audit.audit || audit;
  t.eq((await srv.call(A, { op: 'audit.update', auditId: c.id, expectedVersion: audit.row_version, patch: { stage: 'closed' } })).status, 200, 'with every basis in place the board closes');

  // ── D47 Apply to related proposes ──────────────────────────────────────────────────────────────
  const lib = await srv.must(A, { op: 'relationship.library', auditId: b.id });
  const srcId = Object.keys(lib).find(id => (lib[id] || []).filter(x => !x.rejected).length >= 2 && b.reqs.find(q => q.id === id && q.standard_code === '9001'));
  t.ok(!!srcId, 'fixture: a 9001 clause with at least two related clauses');
  const related = lib[srcId].filter(x => !x.rejected);
  await srv.set(b, srcId, { compliance_status: 'partially_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Reissue and brief the team' });
  const doc = await srv.must(A, { op: 'evidence.addLinkBulk', auditId: b.id, title: 'Shared Procedure', url: 'https://example.com/p', requirementIds: [srcId] });
  const target = related[0].requirementId, untouched = related[1].requirementId;
  const applied = await srv.must(A, { op: 'relationship.applyToRelated', auditId: b.id, fromId: srcId, toIds: [target], offeredIds: related.map(x => x.requirementId) });
  r = await row(target);
  t.ok(r.compliance_status === 'partially_compliant' && r.gap_reason === 'ineffective' && r.current_system === basis && r.recommended_action === 'Reissue and brief the team', 'the target gets status, gap reason, basis and planned action');
  t.ok(r.derived_from_id === srcId && r.approval_state === 'proposed', `…marked derived and proposed even though the Lead applied it (got ${r.derived_from_id === srcId} / ${r.approval_state})`);
  const tDocs = await srv.must(A, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: target });
  t.ok(tDocs.some(e => e.id === doc.evidence.id), 'the source\'s live document is linked to the target too');
  t.ok((await row(untouched)).derived_from_id == null, 'an offered but unticked clause is left alone');
  res = await srv.call(A, { op: 'requirement.approve', auditId: b.id, id: r.id, expectedVersion: r.row_version });
  t.ok(res.status === 400 && /derived|confirm/i.test(JSON.stringify(res.body)), `a derived status cannot be approved before it is confirmed (got ${res.status})`);
  const act = await srv.must(A, { op: 'activity.list', auditId: b.id });
  const sig = act.find(x => x.action === 'related_applied');
  t.ok(sig && sig.after && JSON.stringify(sig.after.applied) === JSON.stringify([target]) && sig.after.unticked.includes(untouched) && sig.after.offered.length === related.length, `the choice is recorded as a signal: offered / applied / unticked (got ${JSON.stringify(sig && sig.after)})`);
  await srv.must(A, { op: 'requirement.confirmDerived', auditId: b.id, ids: [target] });
  r = await row(target);
  t.ok(r.derived_from_id == null && r.approval_state === 'approved', `the Lead's Confirm clears "derived" and approves (got ${r.derived_from_id} / ${r.approval_state})`);
  await srv.must(A, { op: 'relationship.applyToRelated', auditId: b.id, fromId: srcId, toIds: [untouched] });
  await srv.must(AUD, { op: 'requirement.confirmDerived', auditId: b.id, ids: [untouched] });
  r = await row(untouched);
  t.ok(r.derived_from_id == null && r.approval_state === 'proposed', `an auditor's Confirm clears "derived" but leaves it proposed for the Lead (got ${r.approval_state})`);
  t.eq((await srv.call(H.CLIENT('cu1', 'c1'), { op: 'requirement.confirmDerived', auditId: b.id, ids: [untouched] })).status, 403, 'a client cannot confirm a derived status');

  // ── B1.7 sufficiency flag, samples, observations ──────────────────────────────────────────────
  const link = (await srv.must(A, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: srcId })).find(e => e.id === doc.evidence.id);
  res = await srv.call(A, { op: 'evidence.setSufficiency', auditId: b.id, linkId: link.linkId, sufficiency: 'insufficient', expectedVersion: link.linkRowVersion });
  t.eq(res.status, 200, 'the auditor who linked a document can flag it insufficient (staff evidence: their confirmation is the review, D35)');
  const docs = await srv.must(A, { op: 'document.list', auditId: b.id });
  const custom = docs.find(d => d.name === 'Shared Procedure');
  t.ok(!custom || !custom.clauses.some(cl => cl.requirementId === srcId && cl.provided), 'an insufficient link no longer counts as provided');
  const link2 = (await srv.must(A, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: srcId })).find(e => e.id === doc.evidence.id);
  t.eq(link2.reviewStatus, 'insufficient', 'the flag is stored on the link');
  t.eq((await srv.call(VIEWER, { op: 'evidence.setSufficiency', auditId: b.id, linkId: link2.linkId, sufficiency: 'partial', expectedVersion: link2.linkRowVersion })).status, 403, 'a reviewer cannot set the flag');
  t.eq((await srv.call(A, { op: 'evidence.setSufficiency', auditId: b.id, linkId: link2.linkId, sufficiency: null, expectedVersion: link2.linkRowVersion })).status, 200, 'clearing the flag works');
  const sample = await srv.call(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: srcId, kind: 'sample', title: 'Competency files', samplePopulation: 42, sampleSize: 5, sampleExceptions: '2 lacked authorisation' });
  t.eq(sample.status, 200, 'a sample note saves with population, size and exceptions');
  const obs = await srv.call(A, { op: 'evidence.addLink', auditId: b.id, targetType: 'requirement', targetId: srcId, kind: 'observation', title: 'Toolbox talk observed' });
  t.eq(obs.status, 200, 'an observation note saves');
  const notes = await srv.must(A, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: srcId });
  const s1 = notes.find(e => e.title === 'Competency files');
  t.ok(s1 && s1.samplePopulation === 42 && s1.sampleSize === 5 && s1.sampleExceptions === '2 lacked authorisation', `the sample fields come back on the list (got ${JSON.stringify(s1 && [s1.samplePopulation, s1.sampleSize, s1.sampleExceptions])})`);

  // ── UI ─────────────────────────────────────────────────────────────────────────────────────────
  const ui = await t.browser();
  await ui.openBoard(b.id); await ui.tab('requirements');
  const k = await srv.row(b, '9001 6.2.1');
  await ui.eval(id => ISO._reqToggleExpand(id), k.id); await t.sleep(600);
  const bar = await ui.eval(id => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-clause-statusbar button`)].map(x => x.textContent.trim()), k.id);
  t.ok(JSON.stringify(bar.slice(0, 4)) === JSON.stringify(['Compliant', 'Partially Compliant', 'Non-Compliant', 'OFI']) && /N\/A/.test(bar[4] || ''), `the status bar keeps its five buttons (got ${JSON.stringify(bar)})`);
  await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-status-btn[data-status="ofi"]`).click(), k.id); await t.sleep(900);
  r = await srv.row(b, '9001 6.2.1');
  const pill = await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-status-dot`)?.textContent.trim(), k.id);
  t.ok(r.compliance_status === 'compliant' && r.ofi === true && pill === 'Compliant · OFI', `the OFI button stores Compliant + OFI and the pill says so (got ${r.compliance_status}/${r.ofi}, "${pill}")`);
  const missing = await ui.eval(id => !!document.querySelector(`[data-ireq="${id}"] .iso-basis-missing`), k.id);
  t.ok(missing, 'a status without a basis shows "Basis missing" on the row');
  const chip = await ui.eval(() => [...document.querySelectorAll('.iso-clause-toolbar .iso-fchip')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).find(x => /^Needs basis/.test(x)));
  t.ok(/^Needs basis \d+$/.test(chip || ''), `a "Needs basis" chip counts them (got ${chip})`);
  await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-status-btn[data-status="partially_compliant"]`).click(), k.id); await t.sleep(900);
  const gap = await ui.eval(id => [...document.querySelectorAll(`[data-ireq="${id}"] .iso-gap-reason button`)].map(x => x.textContent.trim()), k.id);
  t.ok(JSON.stringify(gap) === JSON.stringify(['Not implemented', 'Implemented but ineffective', 'No evidence provided']), `Partially Compliant shows the three gap reasons (got ${JSON.stringify(gap)})`);
  await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-gap-reason button[data-gap="no_evidence"]`).click(), k.id); await t.sleep(800);
  t.eq((await srv.row(b, '9001 6.2.1')).gap_reason, 'no_evidence', 'clicking a gap reason saves it');
  const ofiToggle = await ui.eval(id => !!document.querySelector(`[data-ireq="${id}"] .iso-ofi-toggle`), k.id);
  t.ok(ofiToggle, 'Partially Compliant offers the "+ OFI" toggle');
  await ui.eval(id => ISO._reqOpenScopeMenu(id), k.id); await t.sleep(200);
  const menu = await ui.eval(() => [...document.querySelectorAll('.iso-na-menu button')].map(x => x.textContent.trim()));
  t.ok(menu.includes('Not applicable') && menu.includes("Outside this audit's scope"), `N/A ▾ offers Not applicable and Outside this audit's scope (got ${JSON.stringify(menu)})`);
  await ui.eval(() => [...document.querySelectorAll('.iso-na-menu button')].find(x => /scope/.test(x.textContent)).click()); await t.sleep(900);
  t.eq((await srv.row(b, '9001 6.2.1')).compliance_status, 'out_of_scope', 'choosing it sets Outside this audit\'s scope');

  // Derived banner and Confirm in the open row.
  await srv.must(A, { op: 'relationship.applyToRelated', auditId: b.id, fromId: srcId, toIds: [target] });
  await ui.tab('requirements');
  await ui.eval(id => ISO._reqToggleExpand(id), target); await t.sleep(700);
  const banner = await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-derived-banner`)?.textContent.replace(/\s+/g, ' ').trim() || '', target);
  t.ok(/Derived from/.test(banner) && /Confirm/.test(banner), `a derived row explains itself and offers Confirm (got "${banner.slice(0, 90)}")`);
  await ui.eval(id => document.querySelector(`[data-ireq="${id}"] .iso-derived-confirm`).click(), target); await t.sleep(900);
  t.ok((await srv.row(b, target)).derived_from_id == null, 'Confirm in the row clears "derived"');

  // Approval view: risk reasons, Non-Compliant first.
  await srv.set(b, '9001 7.1.2', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: basis }, AUD);
  await srv.set(b, '9001 7.1.3', { compliance_status: 'compliant', current_system: basis }, AUD);
  await ui.tab('requirements');
  await ui.eval(() => ISO._reqSetView('approval_awaiting')); await t.sleep(500);
  const q = await ui.eval(() => [...document.querySelectorAll('#iso-req-tab [data-ireq]')].map(x => ({ id: x.dataset.ireq, why: [...x.querySelectorAll('.iso-why')].map(w => w.textContent.trim()) })));
  const ncIdx = q.findIndex(x => x.why.includes('Non-Compliant'));
  t.ok(ncIdx === 0 || (ncIdx > -1 && q.slice(0, ncIdx).every(x => x.why.includes('Non-Compliant'))), `Awaiting approval puts Non-Compliant first (got ${JSON.stringify(q.map(x => x.why))})`);
  t.ok(q.some(x => x.why.length), 'each row in the queue says why it matters');

  // B1.8: conclude while linking — status per clause in the add-document form, basis pre-filled.
  await ui.tab('documents');
  await ui.eval(() => ISO._docSetFilter('all')); await t.sleep(300);
  const docName = await ui.eval(() => [...document.querySelectorAll('.iso-doc-row')].find(r => /Not provided/.test(r.textContent) && r.querySelector('.iso-doc-add'))?.dataset.docRow);
  await ui.eval(n => [...document.querySelectorAll('.iso-doc-row')].find(r => r.dataset.docRow === n).querySelector('.iso-doc-add').click(), docName); await t.sleep(500);
  const formIds = await ui.eval(() => [...document.querySelectorAll('#iso-da-groups input[type=checkbox]:checked')].map(i => i.value));
  const stBtns = await ui.eval(id => [...document.querySelectorAll(`#iso-da-groups .iso-da-st-btn[data-id="${id}"]`)].map(b => b.textContent.trim()), formIds[0]);
  t.ok(JSON.stringify(stBtns) === JSON.stringify(['C', 'PC', 'NC', 'OFI']), `each clause in the form has Compliant / Partial / Non-Compliant / OFI (got ${JSON.stringify(stBtns)})`);
  const cur = await srv.must(H.ADMIN, { op: 'requirement.list', auditId: b.id });
  const blank = formIds.filter(id => !String((cur.find(r => r.id === id) || {}).current_system || '').trim());
  t.ok(blank.length >= 2, 'fixture: at least two clauses in the form have no basis yet');
  const [fa, fb] = blank;
  const fbBefore = (await srv.row(b, fb)).compliance_status;
  await ui.eval(id => document.querySelector(`#iso-da-groups .iso-da-st-btn[data-id="${id}"][data-v="non_compliant"]`).click(), fa);
  await ui.page.type('#ovda-url', 'https://example.com/form-doc'); await ui.page.type('#ovda-version', 'Rev 7');
  await ui.eval(() => ISO._ovDocAddApply()); await t.sleep(2500);
  const ra = await srv.row(b, fa), rb = await srv.row(b, fb);
  t.ok(ra.compliance_status === 'non_compliant' && ra.current_system === `Evidence — ${docName}, Rev 7`, `the status chosen in the form is saved with the basis pre-filled from the document (got ${ra.compliance_status} / "${ra.current_system}")`);
  t.ok(rb.compliance_status === fbBefore, 'clauses with no status chosen keep their own status');
  const linkedA = await srv.must(H.ADMIN, { op: 'evidence.list', auditId: b.id, targetType: 'requirement', targetId: fa });
  t.ok(linkedA.some(e => e.title === docName), '…and the document is linked as usual');
});
