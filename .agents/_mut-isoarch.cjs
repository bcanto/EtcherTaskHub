// Can-fail mutations for ISO board archiving (node .agents/_canfail.cjs .agents/_mut-isoarch.cjs --green).
module.exports = [
  { id: 'isoarch-no-confirm', suite: 'iso-archive-test', file: 'iso/iso-core.js', note: 'Archive archives straight away, without asking',
    find: "    if (root.openConfirm) root.openConfirm('Archive this ISO board?',", replace: "    go(); if (false) root.openConfirm('Archive this ISO board?'," },
  { id: 'isoarch-no-header-btn', suite: 'iso-archive-test', file: 'iso/iso-core.js', note: 'the Archive button is not in the board header',
    find: '${canArchiveLocally() ? `<button type="button" class="btn btn-ghost btn-sm iso-archive-btn"', replace: '${false ? `<button type="button" class="btn btn-ghost btn-sm iso-archive-btn"' },
  { id: 'isoarch-restore-open', suite: 'iso-archive-test', file: 'api/_iso.js', note: 'anyone may restore an archived board',
    find: "defineOp('audit.restore', {\n  scope: 'none',\n  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: isIsoAdmin,",
    replace: "defineOp('audit.restore', {\n  scope: 'none',\n  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: () => true," },
  { id: 'isoarch-no-card', suite: 'iso-archive-test', file: 'index.html', note: 'Archive & Bin never fills the ISO card',
    find: 'if(window._isoEnabled&&window.ISO&&ISO.fillArchiveCard)ISO.fillArchiveCard();', replace: '' },
  // Remove from bin (2026-10-15).
  { id: 'isoarch-remove-open', suite: 'iso-archive-test', file: 'api/_iso.js', note: 'anyone may remove a board from the bin',
    find: "defineOp('audit.removeFromBin', {\n  scope: 'none',\n  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: isIsoAdmin,",
    replace: "defineOp('audit.removeFromBin', {\n  scope: 'none',\n  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: () => true," },
  { id: 'isoarch-remove-no-confirm', suite: 'iso-archive-test', file: 'iso/iso-core.js', note: 'Remove happens straight away, without asking',
    find: "    if (root.openConfirm) root.openConfirm('Remove from Archive & Bin?',", replace: "    go(); if (false) root.openConfirm('Remove from Archive & Bin?'," },
  { id: 'isoarch-removed-listed', suite: 'iso-archive-test', file: 'api/_iso.js', note: 'removed boards still show in Archive & Bin',
    find: ", { field: 'bin_removed_at', op: 'isnull' }], limit: 500 });", replace: "], limit: 500 });" },
  { id: 'isoarch-removed-restorable', suite: 'iso-archive-test', file: 'api/_iso.js', note: 'a removed board can still be restored from the app',
    find: "    if (!a || !a.archived_at || a.bin_removed_at) throw notFound('Archived board not found.');\n    return ctx.db.update('iso_audits', a.id, { archived_at: null }",
    replace: "    if (!a || !a.archived_at) throw notFound('Archived board not found.');\n    return ctx.db.update('iso_audits', a.id, { archived_at: null }" },
];
