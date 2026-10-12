// Can-fail mutations for release-1 batch B5 (node .agents/_canfail.cjs .agents/_mut-b5.cjs --green).
const S = 'iso-report-test';
module.exports = [
  { id: 'b5-no-approval-notify', suite: S, file: 'api/_iso.js', note: 'a proposed status notifies nobody',
    find: "  if (out && out.approval_state === 'proposed' && (!before || before.approval_state !== 'proposed') && !isLeadCaller(ctx))", replace: '  if (false)' },
  { id: 'b5-self-notify', suite: S, file: 'api/_iso.js', note: 'people are notified of their own actions',
    find: "  for (const recipient of new Set((recipients || []).filter(r => r && r !== ctx.caller.uid))) {", replace: '  for (const recipient of new Set((recipients || []).filter(r => r))) {' },
  { id: 'b5-repeat-assign', suite: S, file: 'api/_iso.js', note: 'every action edit re-notifies the owner',
    find: '  if (a && a.owner_uid && a.owner_uid !== prevOwner)', replace: '  if (a && a.owner_uid)' },
  { id: 'b5-due', suite: S, file: 'api/_iso.js', note: 'overdue actions produce no reminder',
    find: "        if (x.due_date && x.due_date <= in7) due.push(", replace: '        if (false) due.push(' },
  { id: 'b5-markread-any', suite: S, file: 'api/_iso.js', note: 'anyone can mark anyone\'s notification read',
    find: '  for (const id of ctx.payload.ids) { const n = await ctx.db.get(\'iso_notifications\', id); if (n && n.recipient_uid === ctx.caller.uid) out.push(n); }',
    replace: '  for (const id of ctx.payload.ids) { const n = await ctx.db.get(\'iso_notifications\', id); if (n) out.push(n); }' },
  { id: 'b5-readiness', suite: S, file: 'api/_iso.js', note: 'unapproved clauses do not block the report',
    find: "assessed.filter(r => ['proposed', 'returned'].includes(r.approval_state)).map(ref)", replace: '[]' },
  { id: 'b5-reissue-reason', suite: S, file: 'api/_iso.js', note: 'a report can be reissued without a reason',
    find: "    if (prior && !String(ctx.payload.reason || '').trim()) throw badRequest('Say why this report is being reissued.');\n", replace: '' },
  { id: 'b5-version-mutable', suite: S, file: 'api/_isoDbOffline.js', note: 'an issued version can be changed',
    find: "const IMMUTABLE_TABLES = ['iso_audit_snapshots', 'iso_report_versions', 'iso_report_acknowledgements']; // + B5.2", replace: "const IMMUTABLE_TABLES = ['iso_audit_snapshots'];" },
  { id: 'b5-ack-wording', suite: S, file: 'api/_iso.js', note: 'the acknowledgement says agreed',
    find: "const ACK_WORDING = 'Received and discussed';", replace: "const ACK_WORDING = 'Agreed';" },
  { id: 'b5-csv-guard', suite: S, file: 'iso/iso-core.js', note: 'CSV cells are written without the formula guard',
    find: "    if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s; // formula-injection guard\n", replace: '' },
  { id: 'b5-bell-merge', suite: S, file: 'index.html', note: 'the bell leaves ISO items out',
    find: "  const isoRows=(window._isoEnabled&&window.ISO&&ISO.notifItems)?ISO.notifItems():[];", replace: '  const isoRows=[];' },
  // Branded Excel export (added post-commit, same batch, B5.3) — the user wanted a presentable
  // copy for client sharing; plain CSV can't be branded, so this reuses index.html's own ExcelJS
  // header-styling convention instead of inventing a new one.
  { id: 'b5-xlsx-no-navy', suite: S, file: 'iso/iso-core.js', note: 'the Excel header loses its Etcher navy fill — looks like an unbranded default sheet',
    find: "header.map(h => ({ v: h, bold: true, bg: '0d1c33', fg: 'ffffff' }))", replace: "header.map(h => ({ v: h, bold: true }))" },
  { id: 'b5-xlsx-no-button', suite: S, file: 'iso/iso-core.js', note: 'the Clauses tab loses its Export Excel button',
    find: '<button type="button" class="btn btn-ghost btn-sm iso-xlsx" title="Download a branded Excel copy — presentable to send to a client" onclick="ISO._exportClausesXlsx()">Export Excel<span class="sr"> — clauses</span></button>', replace: '' },
  { id: 'b5-xlsx-wrong-rows', suite: S, file: 'iso/iso-core.js', note: 'Export Excel on Clauses sends the Actions rows instead of its own',
    find: 'function _exportClausesXlsx() { _xlsxDownload(_xlsxName(\'Clauses\'), \'Clauses\', EXPORT_HEADERS.Clauses, _clausesExportRows()); }',
    replace: 'function _exportClausesXlsx() { _xlsxDownload(_xlsxName(\'Clauses\'), \'Clauses\', EXPORT_HEADERS.Actions, _actionsExportRows()); }' },
];
