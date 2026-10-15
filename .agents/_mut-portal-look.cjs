// Can-fail mutations for the portal look (node .agents/_canfail.cjs .agents/_mut-portal-look.cjs --green).
module.exports = [
  { id: 'pl-one-column', suite: 'portal-look-test', file: 'index.html', note: 'the Overview falls back to one column',
    find: '.cp-ov2{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:22px;align-items:start}', replace: '.cp-ov2{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;align-items:start}' },
  { id: 'pl-no-recent', suite: 'portal-look-test', file: 'index.html', note: 'no recent activity',
    find: "  const left=awaitingSection+dueSoonSection, right=engSection+recent;", replace: "  const left=awaitingSection+dueSoonSection, right=engSection;" },
  { id: 'pl-no-meta', suite: 'portal-look-test', file: 'index.html', note: 'task rows lose Engagement and With',
    find: '      <span class="cp-tl-meta"><span class="cp-tl-eng">', replace: '      <span class="cp-tl-gone"><span class="cp-tl-eng">' },
  { id: 'pl-req-stacked', suite: 'portal-look-test', file: 'index.html', note: 'Request Work stacks in one column',
    find: '.cp-req2{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:22px;align-items:start}', replace: '.cp-req2{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;align-items:start}' },
  { id: 'pl-wide-phone', suite: 'portal-look-test', file: 'index.html', note: 'the four counts stay four wide on a phone',
    find: '#client-portal .cp-sum .cp-band{grid-template-columns:repeat(2,minmax(0,1fr))}', replace: '#client-portal .cp-sum .cp-band{grid-template-columns:repeat(4,160px)}' },
  { id: 'pl-accent-rule', suite: 'portal-look-test', file: 'index.html', note: 'the old 3px accent rule catches the new rows again',
    find: '.cp-list>.cp-task-row:not(.cp-need):not(.cp-due)>div:first-child{width:3px', replace: '.cp-list>.cp-task-row>div:first-child{width:3px' },
];
