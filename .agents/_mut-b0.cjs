// Can-fail mutations for release-1 batch B0 (run: node .agents/_canfail.cjs .agents/_mut-b0.cjs --green).
module.exports = [
  {
    id: 'b0-iso-route-cached',
    suite: 'iso-ui-test',
    file: 'index.html',
    find: "case 'iso':       vc.innerHTML=window._isoEnabled&&window.ISO?ISO.render(vc):_render404Html('iso');break;",
    replace: "case 'iso':       _renderCached(vc,'iso',()=>{vc.innerHTML=window._isoEnabled&&window.ISO?ISO.render(vc):_render404Html('iso');});break;",
    note: 'ISO route served through the view cache (plan 2.5 guard)',
  },
  {
    id: 'b0-doclist-provided',
    suite: 'iso-document-test',
    file: 'api/_iso.js',
    find: 'providedCount: clauses.filter(c => c.provided).length, totalCount: clauses.length, latest:',
    replace: 'providedCount: 0, totalCount: clauses.length, latest:',
    note: 'document.list never counts provided clauses',
  },
];
