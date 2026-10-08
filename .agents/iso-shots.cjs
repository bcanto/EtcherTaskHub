// One-command visual check (release-1 plan B0.5): seeds a realistic 3-standard board plus two more
// boards, then captures every ISO screen at desktop (1440) and phone (390) width into .agents/shots/
// (gitignored). Not a gate suite — it prints overflow and page errors and exits 0/1 on those only.
//   node .agents/iso-shots.cjs [label]      → .agents/shots/<label>-<screen>.png and -390.png
const H = require('./_iso-harness.cjs');
const label = process.argv[2] || 'shot';
const PORT = 3171;

(async () => {
  const srv = await H.startOffline(PORT);
  const problems = [];
  let ui;
  try {
    const A = H.ADMIN;
    const b1 = await srv.board({ standards: ['9001', '14001', '45001'], title: 'ISO 9001/14001/45001' });
    await srv.board({ clientId: 'c1', standards: ['9001'], title: 'Supplier readiness review' });
    await srv.board({ clientId: 'c2', standards: ['45001'], title: 'ISO 45001' });
    const sts = ['compliant', 'compliant', 'partially_compliant', 'non_compliant', 'ofi', 'compliant'];
    for (let i = 0; i < 24; i++) {
      const r = b1.reqs[(i * 5) % b1.reqs.length], st = sts[i % sts.length];
      const patch = { compliance_status: st, current_system: 'Documented; sample checked.' };
      if (st !== 'compliant') { patch.recommended_action = i % 4 === 1 ? 'Review and reissue the procedure' : 'Set up a register and review it quarterly ' + i; patch.target_date = '2026-1' + (1 + i % 2) + '-' + String(10 + i).padStart(2, '0'); }
      await srv.set(b1, r.id, patch);
    }
    const docs = await srv.must(A, { op: 'document.list', auditId: b1.id });
    for (const d of docs.slice(1, 4)) await srv.must(A, { op: 'evidence.addLinkBulk', auditId: b1.id, title: d.name, url: 'https://example.com/' + encodeURIComponent(d.name), versionLabel: 'Rev 2', evidenceDate: '2026-09-12', requirementIds: d.clauses.slice(0, 50).map(c => c.requirementId) });

    ui = await H.browser(PORT);
    const shot = async name => {
      const o = await ui.shot(`${label}-${name}`);
      if (o.desktop > 0) problems.push(`${name}: ${o.desktop}px sideways scroll at 1440`);
      if (o.phone > 0) problems.push(`${name}: ${o.phone}px sideways scroll at 390`);
    };
    await ui.landing(); await shot('landing');
    await ui.openBoard(b1.id); await shot('overview');
    await ui.tab('requirements'); await shot('clauses');
    await ui.eval(() => document.querySelector('[data-ireq] .iso-clause-head')?.click()); await H.sleep(1200); await shot('clauses-open');
    await ui.tab('documents'); await shot('documents');
    await ui.eval(() => ISO._docSetFilter('all')); await H.sleep(300); await shot('documents-all');
    await ui.eval(() => document.querySelector('.iso-doc-add')?.click()); await H.sleep(500); await shot('doc-add');
    await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
    await ui.tab('worklist'); await shot('actions');
    await ui.eval(() => ISO._wlSetMode('timeline')); await H.sleep(400); await shot('actions-timeline');
    await ui.eval(() => ISO._wlSetMode('list'));
    await ui.tab('settings'); await shot('settings');
    if (ui.errors.length) problems.push('page errors: ' + JSON.stringify(ui.errors.slice(0, 3)));
  } catch (e) {
    problems.push('crashed: ' + (e && e.stack || e));
  } finally {
    if (ui) await ui.close();
    srv.stop();
    console.log(`screenshots → .agents/shots/${label}-*.png`);
    console.log(problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no overflow, no page errors');
    process.exit(problems.length ? 1 : 0);
  }
})();
