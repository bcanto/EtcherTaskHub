// Can-fail mutations for Retained Services batch 3 (node .agents/_canfail.cjs .agents/_mut-retained3.cjs --green).
module.exports = [
  { id: 'rt3-no-history', suite: 'retained3-test', file: 'api/_portal.js', note: 'the slice drops the earlier months',
    find: "    history: [prev, rsPrevYm(prev)].map(", replace: "    history: [].map(" },
  { id: 'rt3-remove-drops-group', suite: 'retained3-test', file: 'index.html', note: 'adding a service back makes a fresh group instead of reusing the old one',
    find: "      let gid=past&&(DB.groups||[]).some(g=>g.id===past.groupId)?past.groupId:null;", replace: "      let gid=null;" },
  { id: 'rt3-end-no-archive', suite: 'retained3-test', file: 'index.html', note: 'ending a retainer leaves the board live',
    find: "    b.archived=true;b.updatedAt=new Date().toISOString();saveDB(DB);closeConfirm();", replace: "    b.updatedAt=new Date().toISOString();saveDB(DB);closeConfirm();" },
  { id: 'rt3-end-open', suite: 'retained3-test', file: 'index.html', note: 'anyone can end a retainer',
    find: "function retainerEnd(boardId){\n  if(currentUser?.role!=='admin')return;", replace: "function retainerEnd(boardId){\n  if(false)return;" },
  { id: 'rt3-no-portal-history', suite: 'retained3-test', file: 'index.html', note: 'the portal does not show earlier months',
    find: "    ${(rt.history||[]).length&&(rt.services||[]).length?`<div class=\"cp-stat-card cp-rt-hist\">", replace: "    ${false?`<div class=\"cp-stat-card cp-rt-hist\">" },
  { id: 'rt3-dash-wide', suite: 'retained3-test', file: 'index.html', note: 'the Dashboard search is fixed-width again',
    find: 'color:#1a2940;outline:none;width:min(220px,100%);height:34px;', replace: 'color:#1a2940;outline:none;width:420px;height:34px;' },
];
