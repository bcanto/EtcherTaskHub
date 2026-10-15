// Can-fail mutations for ISO board archiving (node .agents/_canfail.cjs .agents/_mut-isoarch.cjs --green).
module.exports = [
  { id: 'isoarch-no-confirm', suite: 'iso-archive-test', file: 'iso/iso-core.js', note: 'Archive archives straight away, without asking',
    find: "    if (root.openConfirm) root.openConfirm('Archive this ISO board?',", replace: "    go(); if (false) root.openConfirm('Archive this ISO board?'," },
  { id: 'isoarch-no-header-btn', suite: 'iso-archive-test', file: 'iso/iso-core.js', note: 'the Archive button is not in the board header',
    find: '${canArchiveLocally() ? `<button type="button" class="btn btn-ghost btn-sm iso-archive-btn"', replace: '${false ? `<button type="button" class="btn btn-ghost btn-sm iso-archive-btn"' },
  { id: 'isoarch-restore-open', suite: 'iso-archive-test', file: 'api/_iso.js', note: 'anyone may restore an archived board',
    find: "  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: isIsoAdmin,", replace: "  validate(payload) { if (!isValidId(payload.auditId)) throw badRequest('A valid auditId is required.'); },\n  allow: () => true," },
  { id: 'isoarch-no-card', suite: 'iso-archive-test', file: 'index.html', note: 'Archive & Bin never fills the ISO card',
    find: 'if(window._isoEnabled&&window.ISO&&ISO.fillArchiveCard)ISO.fillArchiveCard();', replace: '' },
];
