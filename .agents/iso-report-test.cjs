// Release-1 B5 — notifications and reports (Q11).
//   B5.1 event notifications (awaiting approval, returned, derived, evidence submitted, action assigned,
//        finding reopened) and due reminders worked out when the bell asks; mark read / dismiss; the bell
//        in index.html merges them; clicking opens the record.
//   B5.2 Ready-to-report blocks issue; issue freezes a report snapshot + immutable version; reissue keeps
//        the old one and needs a reason; acknowledgement is "Received and discussed"; three templates.
//   B5.3 CSV of on-screen views with the formula-injection guard.
const path = require('path');
const H = require('./_iso-harness.cjs');
const LEAD = H.STAFF('u2');
const AUD = H.STAFF('u3');

H.run('iso-report-test', 3173, async (t, srv) => {
  const A = H.ADMIN;
  const basis = 'Seen the register and two signed records.';
  const members = [{ id: LEAD.id, auditRole: 'lead_auditor' }, { id: AUD.id, auditRole: 'auditor' }];
  const b = await srv.board({ standards: ['9001', '14001'], members });
  const auditRow = async x => { const a = await srv.must(A, { op: 'audit.get', auditId: x.id }); return a.audit || a; };
  const inbox = async user => srv.must(user, { op: 'notification.list' });
  const ofType = (box, type) => box.items.filter(n => n.type === type);

  // ── B5.1 events ───────────────────────────────────────────────────────────────────────────────
  await srv.set(b, '9001 4.1', { compliance_status: 'compliant', current_system: basis }, AUD);
  let lead = await inbox(LEAD);
  t.ok(ofType(lead, 'awaiting_approval').length === 1 && /9001 4\.1/.test(ofType(lead, 'awaiting_approval')[0].message), 'an auditor\'s proposed status notifies the Lead');
  t.eq(ofType(await inbox(AUD), 'awaiting_approval').length, 0, 'nobody notifies themselves');
  await srv.set(b, '9001 4.1', { current_system: basis + ' Also the log.' }, AUD);
  t.eq(ofType(await inbox(LEAD), 'awaiting_approval').length, 1, 'editing a row that is already proposed does not notify again');
  const r41 = await srv.row(b, '9001 4.1');
  await srv.must(LEAD, { op: 'requirement.return', auditId: b.id, id: r41.id, expectedVersion: r41.row_version, note: 'Name the records you sampled.' });
  t.ok(ofType(await inbox(AUD), 'returned').length === 1, 'the Lead returning it notifies the auditor who set it');
  await srv.must(AUD, { op: 'evidence.addLinkBulk', auditId: b.id, title: 'Records register', url: 'https://example.com/r', requirementIds: [b.key('9001 4.2').id] });
  t.ok(ofType(await inbox(LEAD), 'evidence_submitted').length === 1, 'new evidence from an auditor notifies the Lead');
  await srv.set(b, '9001 4.2', { compliance_status: 'compliant', current_system: basis }, AUD);
  const peers = (await srv.must(A, { op: 'relationship.library', auditId: b.id }))[b.key('9001 4.2').id] || [];
  if (peers.length) {
    await srv.must(AUD, { op: 'relationship.applyToRelated', auditId: b.id, fromId: b.key('9001 4.2').id, toIds: [peers[0].requirementId || peers[0].id] });
    t.ok(ofType(await inbox(LEAD), 'derived_awaiting').length === 1, 'Apply to related by an auditor tells the Lead there are derived statuses to confirm');
  } else t.ok(false, 'fixture: 9001 4.2 has related clauses');
  // Action assigned.
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch: { audit_type: 'internal' } });
  await srv.set(b, '9001 4.3', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Fix it' });
  const tr = await srv.must(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.3').id], classification: 'minor_nc', ownerUid: 'offline:' + AUD.id, dueDate: '2026-01-31' });
  t.ok(ofType(await inbox(AUD), 'action_assigned').length === 1, 'an action assigned to someone notifies them');
  await srv.must(A, { op: 'action.update', auditId: b.id, id: tr.action.id, expectedVersion: tr.action.row_version, patch: { title: 'Fix it properly' } });
  t.eq(ofType(await inbox(AUD), 'action_assigned').length, 1, 'editing without changing the owner does not notify again');
  await srv.set(b, '9001 4.4', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: basis, recommended_action: 'Write it' });
  await srv.must(LEAD, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.4').id], classification: 'minor_nc', ownerUid: 'offline:' + LEAD.id });
  t.eq(ofType(await inbox(LEAD), 'action_assigned').length, 0, 'assigning an action to yourself notifies nobody');
  // Due reminders: the owner sees the overdue action; the Lead sees the report due.
  await srv.must(A, { op: 'audit.update', auditId: b.id, expectedVersion: (await auditRow(b)).row_version, patch: { report_due: '2026-01-01' } });
  const audBox = await inbox(AUD);
  t.ok(audBox.items.some(n => n.due && n.type === 'action_overdue' && n.entity_id === tr.action.id), 'an overdue action owned by me is a due reminder');
  t.ok((await inbox(LEAD)).items.some(n => n.due && n.type === 'report_due'), 'a report due date reminds the Lead');
  // Finding reopened: notifies who raised it.
  const f = tr.findings[0];
  const fv = async () => (await srv.must(A, { op: 'finding.list', auditId: b.id })).find(x => x.id === f.id).row_version;
  await srv.must(A, { op: 'action.updateStatus', auditId: b.id, id: tr.action.id, to: 'assigned', expectedVersion: (await srv.must(A, { op: 'action.list', auditId: b.id })).find(a => a.id === tr.action.id).row_version });
  // (closure needs the action closed + effective — drive it)
  const av = async () => (await srv.must(A, { op: 'action.list', auditId: b.id })).find(a => a.id === tr.action.id).row_version;
  for (const to of ['in_progress', 'submitted_for_review', 'ready_for_verification']) await srv.must(A, { op: 'action.updateStatus', auditId: b.id, id: tr.action.id, to, expectedVersion: await av() });
  await srv.must(A, { op: 'action.verify', auditId: b.id, id: tr.action.id, result: 'effective', expectedVersion: await av() });
  for (const to of ['verified', 'closed']) await srv.must(A, { op: 'action.updateStatus', auditId: b.id, id: tr.action.id, to, expectedVersion: await av() });
  for (const op of ['finding.release', 'finding.finalize', 'finding.close']) await srv.must(A, { op, auditId: b.id, id: f.id, expectedVersion: await fv() });
  await srv.must(LEAD, { op: 'finding.reopen', auditId: b.id, id: f.id, reasonCode: 'recurred', expectedVersion: await fv() });
  const adminBox = await inbox(A);
  t.ok(ofType(adminBox, 'finding_reopened').length === 1 && ofType(await inbox(AUD), 'finding_reopened').length === 1, 'a reopened finding notifies who raised it and the owners of its actions');
  // Read / dismiss, only one's own.
  const before = (await inbox(LEAD)).unread;
  const one = (await inbox(LEAD)).items.find(n => !n.due && !n.read_at);
  await srv.must(AUD, { op: 'notification.markRead', ids: [one.id] });
  t.eq((await inbox(LEAD)).unread, before, 'nobody can mark someone else\'s notification read');
  await srv.must(LEAD, { op: 'notification.markRead', ids: [one.id] });
  t.eq((await inbox(LEAD)).unread, before - 1, 'marking read lowers the unread count');
  await srv.must(LEAD, { op: 'notification.dismiss', ids: [one.id] });
  t.ok(!(await inbox(LEAD)).items.some(n => n.id === one.id), 'a dismissed notification is gone from the list');
  t.ok(!JSON.stringify(await inbox(AUD)).includes('Name the records you sampled'), 'messages never carry notes');

  // ── B5.2 reports ──────────────────────────────────────────────────────────────────────────────
  const rb = await srv.board({ standards: ['9001'], title: 'Report board', members });
  await srv.set(rb, '9001 4.1', { compliance_status: 'compliant', ofi: true, current_system: basis }, AUD);
  let ready = await srv.must(A, { op: 'report.readiness', auditId: rb.id });
  t.ok(!ready.ready && ready.blockers.find(x => x.key === 'unapproved').items.includes('9001 4.1'), 'an unapproved clause blocks the report, named');
  t.eq((await srv.call(A, { op: 'report.issue', auditId: rb.id })).status, 400, 'issue is refused while not ready');
  const r1 = await srv.row(rb, '9001 4.1');
  await srv.must(LEAD, { op: 'requirement.approve', auditId: rb.id, id: r1.id, expectedVersion: r1.row_version });
  ready = await srv.must(A, { op: 'report.readiness', auditId: rb.id });
  t.ok(ready.ready && ready.notAssessed > 0, 'with everything approved it is ready (not-assessed clauses are reported, not blocking)');
  t.eq((await srv.call(A, { op: 'report.issue', auditId: rb.id })).status, 400, 'issue needs a saved draft first');
  const draft = await srv.must(AUD, { op: 'report.saveDraft', auditId: rb.id, sections: { executiveSummary: 'Mostly in place.', method: 'Interviews and records.', unknown: 'dropped' } });
  t.ok(draft.ref === `${rb.ref}-R001` && draft.kind === 'audit' && draft.config.sections.executiveSummary === 'Mostly in place.' && !('unknown' in draft.config.sections), `one numbered draft per board, narrative cleaned (got ${draft.ref} / ${draft.kind})`);
  t.eq((await srv.call(AUD, { op: 'report.issue', auditId: rb.id })).status, 403, 'an auditor cannot issue');
  const v1 = await srv.must(LEAD, { op: 'report.issue', auditId: rb.id });
  t.ok(v1.version_no === 1 && v1.content.sections.executiveSummary === 'Mostly in place.' && v1.content.ackWording === 'Received and discussed' && /plain-language interpretation/.test(v1.content.disclaimer), 'issue freezes version 1 with the narrative, the acknowledgement wording and the disclaimer');
  t.ok(v1.content.team.length >= 2 && v1.content.snapshot.clauses.length > 0 && v1.content.libraryRelease === 'v3', 'the version carries the team, the clause snapshot and the library release');
  const snaps = await srv.must(A, { op: 'snapshot.list', auditId: rb.id });
  t.ok(snaps.some(s => s.kind === 'report' && s.id === v1.snapshot_id), 'issue wrote a report snapshot');
  t.eq((await srv.call(LEAD, { op: 'report.issue', auditId: rb.id })).status, 400, 'reissue needs a reason');
  await srv.must(AUD, { op: 'report.saveDraft', auditId: rb.id, sections: { executiveSummary: 'Corrected summary.' }, expectedVersion: (await srv.must(A, { op: 'report.get', auditId: rb.id })).draft.row_version });
  const v2 = await srv.must(LEAD, { op: 'report.issue', auditId: rb.id, reason: 'Summary corrected' });
  const list = await srv.must(A, { op: 'report.list', auditId: rb.id });
  t.ok(v2.version_no === 2 && v2.supersedes_version_id === v1.id && v2.supersede_reason === 'Summary corrected' && list.length === 2, 'reissue makes version 2, naming what it supersedes and why');
  t.ok(JSON.stringify(list.find(v => v.id === v1.id).content) === JSON.stringify(v1.content), 'version 1 is unchanged');
  const ack = await srv.must(A, { op: 'report.acknowledge', auditId: rb.id, versionId: v2.id, name: 'Jo Client', role: 'GM', date: '2026-10-11' });
  t.ok(ack.wording === 'Received and discussed', 'the acknowledgement is recorded as "Received and discussed", never "agreed"');
  t.eq((await srv.call(A, { op: 'report.acknowledge', auditId: rb.id, versionId: v2.id, name: '', date: '2026-10-11' })).status, 400, 'an acknowledgement needs a name');
  process.env.ISO_OFFLINE_DIR = srv.dir;
  const db = require(path.join(H.ROOT, 'api', '_isoDbOffline.js'));
  let refused = null;
  try { await db.update('iso_report_versions', v1.id, { title: 'x' }, 1, null); } catch (e) { refused = e.code; }
  t.eq(refused, 'immutable', 'an issued version cannot be changed in the store');
  // Templates: follow-up and maintenance.
  await srv.must(A, { op: 'audit.update', auditId: rb.id, expectedVersion: (await auditRow(rb)).row_version, patch: { stage: 'closed' } });
  const fu = await srv.must(LEAD, { op: 'audit.startFollowUp', auditId: rb.id, type: 'follow_up', scope: { requirementIds: [r1.id] } });
  t.eq((await srv.must(A, { op: 'report.get', auditId: fu.audit.id })).kind, 'follow_up', 'a follow-up board gets the Follow-up report');
  const mb = await srv.board({ standards: ['9001'], title: 'For maintenance' });
  await srv.must(A, { op: 'audit.update', auditId: mb.id, expectedVersion: (await auditRow(mb)).row_version, patch: { stage: 'closed' } });
  const mt = await srv.must(A, { op: 'audit.startMaintenance', auditId: mb.id });
  t.eq((await srv.must(A, { op: 'report.get', auditId: mt.audit.id })).kind, 'maintenance', 'a maintenance board gets the Maintenance report');

  // ── UI ────────────────────────────────────────────────────────────────────────────────────────
  const ui = await t.browser();
  // B5.3 CSV guard + a real export captured from the page.
  const guard = await ui.eval(() => [ISO._csvCell('=1+1'), ISO._csvCell('@x'), ISO._csvCell('a,b'), ISO._csvCell('plain')]);
  t.eq(guard, ["'=1+1", "'@x", '"a,b"', 'plain'], 'CSV cells: formula-injection guard and quoting');
  await ui.openBoard(b.id); await ui.tab('requirements');
  const csv = await ui.eval(async () => {
    const orig = URL.createObjectURL; let blob = null;
    URL.createObjectURL = x => { blob = x; return orig.call(URL, x); };
    document.querySelector('.iso-clause-toolbar .iso-csv').click();
    URL.createObjectURL = orig;
    return blob ? await blob.text() : '';
  });
  t.ok(/Standard,Clause,Clause name,Status/.test(csv) && /ISO 9001,4\.1/.test(csv), 'Export CSV on Clauses downloads the rows shown');
  const exportShots = await ui.shot('b5-clauses-export-buttons');
  t.ok(exportShots.desktop <= 0 && exportShots.phone <= 0, `the Clauses toolbar (now with two export buttons) fits at desktop and 390px (overflow ${JSON.stringify(exportShots)})`);

  // Branded Excel export (same views, same rows) — reuses index.html's own ExcelJS helpers (the
  // ISO Audits report export's own navy-header pattern), so a staff member has something
  // presentable to forward to a client instead of plain CSV.
  const xlsxBytes = await ui.eval(() => new Promise((resolve, reject) => {
    const orig = URL.createObjectURL;
    const timeout = setTimeout(() => { URL.createObjectURL = orig; reject(new Error('timed out waiting for the Excel file')); }, 20000);
    URL.createObjectURL = blob => {
      URL.createObjectURL = orig; clearTimeout(timeout);
      blob.arrayBuffer().then(buf => resolve(Array.from(new Uint8Array(buf))));
      return orig.call(URL, blob);
    };
    document.querySelector('.iso-clause-toolbar .iso-xlsx').click();
  })).catch(e => { throw new Error('Export Excel on Clauses: ' + e.message); });
  const { readZip, getPart } = require(path.join(H.ROOT, 'api', '_isoZip.js'));
  const xlsxBuf = Buffer.from(xlsxBytes);
  t.ok(xlsxBuf.length > 1000 && xlsxBuf.slice(0, 2).toString('latin1') === 'PK', `Export Excel on Clauses downloads a real .xlsx file (got ${xlsxBuf.length} bytes, signature ${JSON.stringify(xlsxBuf.slice(0, 2).toString('latin1'))})`);
  const xz = readZip(xlsxBuf);
  const ct = getPart(xz, '[Content_Types].xml').toString();
  t.ok(/spreadsheetml/.test(ct), 'it is a real spreadsheet package, not a renamed something-else');
  const sheet1 = getPart(xz, 'xl/worksheets/sheet1.xml').toString();
  const sharedStrings = (() => { try { return getPart(xz, 'xl/sharedStrings.xml').toString(); } catch (e) { return ''; } })();
  const sheetText = sheet1 + sharedStrings;
  t.ok(/Clause name/.test(sheetText) && /4\.1/.test(sheetText), `the sheet carries the same header and data as the CSV (got header present: ${/Clause name/.test(sheetText)}, row present: ${/4\.1/.test(sheetText)})`);
  const styles = getPart(xz, 'xl/styles.xml').toString();
  t.ok(/0D1C33/i.test(styles), `the header row is filled Etcher navy (0d1c33), not a plain white cell (got no navy fill in styles.xml)`);
  t.ok(/bold val="1"|<b\/>/.test(styles), 'the header row is bold');

  await ui.tab('worklist');
  t.ok(await ui.eval(() => !!document.querySelector('.iso-wl-toolbar .iso-csv')), 'the Actions tab offers Export CSV');
  t.ok(await ui.eval(() => !!document.querySelector('.iso-wl-toolbar .iso-xlsx')), 'the Actions tab offers Export Excel too');
  // B5.1 bell: the admin has an ISO notification (finding reopened).
  await ui.eval(() => ISO.refreshNotifs()); await t.sleep(1500);
  await ui.eval(() => navigate('notifications')); await t.sleep(1200);
  const bell = await ui.eval(() => ({ rows: document.querySelectorAll('.iso-notif-row').length, text: [...document.querySelectorAll('.iso-notif-row')].map(x => x.textContent.replace(/\s+/g, ' ')).join(' | '), badge: document.getElementById('notif-count-badge')?.textContent || '' }));
  t.ok(bell.rows >= 1 && /reopened/.test(bell.text), `the bell lists ISO notifications alongside Task Hub's (got ${bell.rows}: ${bell.text.slice(0, 120)})`);
  t.ok(Number(bell.badge) >= 1, `the badge counts unread ISO notifications (got "${bell.badge}")`);
  const hdr = await ui.eval(() => (document.querySelector('#view-container .card span')?.textContent || '').trim());
  t.ok(new RegExp('^' + bell.badge + ' unread').test(hdr), `the list header counts ISO items too (header "${hdr}", badge ${bell.badge})`);
  await ui.shot('b5-bell');
  const isoUnreadBefore = await ui.eval(() => ISO.notifUnread());
  await ui.eval(() => notifMarkAllRead()); await t.sleep(1200);
  t.ok(isoUnreadBefore >= 1 && (await ui.eval(() => ISO.notifUnread())) === 0 && (await inbox(A)).unread === 0, 'Mark all read also marks the ISO items read (on the server too)');
  await ui.eval(() => [...document.querySelectorAll('.iso-notif-row')].find(x => /reopened/.test(x.textContent)).click()); await t.sleep(3500);
  t.ok(await ui.eval(() => !!document.getElementById('iso-fnd-tab') && /Reopen|Close/.test(document.getElementById('iso-drawer-body')?.textContent || '')), 'clicking it opens the finding on its board');
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  // B5.2 report panel on a ready board.
  const ub = await srv.board({ standards: ['9001'], title: 'Report UI' });
  await srv.set(ub, '9001 4.1', { compliance_status: 'compliant', current_system: basis });
  await ui.openBoard(ub.id); await ui.tab('dashboard');
  await ui.eval(() => document.querySelector('.iso-report-open').click()); await t.sleep(1200);
  const panel = await ui.eval(() => ({ ready: /Ready to report/.test(document.querySelector('.iso-rep-ready')?.textContent || ''), secs: document.querySelectorAll('.iso-rep-sec').length, issue: !document.getElementById('iso-rep-issue')?.disabled }));
  t.ok(panel.ready && panel.secs === 5 && panel.issue, `the report panel shows it is ready, five narrative sections and Issue enabled (got ${JSON.stringify(panel)})`);
  await ui.shot('b5-report');
  await ui.eval(() => { document.querySelector('.iso-rep-sec[data-k="executiveSummary"]').value = 'From the panel.'; ISO._repIssue(); }); await t.sleep(5000);
  const ul = await srv.must(A, { op: 'report.list', auditId: ub.id });
  t.ok(ul.length === 1 && ul[0].content.sections.executiveSummary === 'From the panel.', 'Issue from the panel saves the draft and issues version 1');
  t.ok(await ui.eval(() => /Version 1/.test(document.querySelector('.iso-rep-versions')?.textContent || '')), 'the panel lists the issued version');
  await ui.eval(() => document.getElementById('generic-modal').classList.add('hidden'));
  await ui.tab('documents');
  t.ok(await ui.eval(() => !!document.querySelector('.iso-doc-toolbar .iso-xlsx') && !!document.querySelector('.iso-doc-toolbar .iso-csv')), 'the Documents tab offers both Export CSV and Export Excel');
  await ui.shot('b5-export-buttons');
});
