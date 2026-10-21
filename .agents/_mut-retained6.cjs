// Can-fail mutations for Retained Services next features batch 3 (node .agents/_canfail.cjs .agents/_mut-retained6.cjs --green).
module.exports = [
  { id: 'rt6-hidden', suite: 'retained6-test', file: 'index.html', note: 'hidden work reaches the client report',
    find: "  const top=(DB.tasks||[]).filter(t=>!t.archived&&!t.parentTaskId&&(t.boardId||t.workboardId)===b.id&&!_cpTaskHidden(t));\n  const gName=",
    replace: "  const top=(DB.tasks||[]).filter(t=>!t.archived&&!t.parentTaskId&&(t.boardId||t.workboardId)===b.id);\n  const gName=" },
  { id: 'rt6-overdue', suite: 'retained6-test', file: 'index.html', note: 'work finished in time still counts as overdue at month end',
    find: "&&!doneBy(t,next+'T00:00:00')).length;", replace: ").length;" },
  { id: 'rt6-month', suite: 'retained6-test', file: 'index.html', note: 'requests from every month are listed',
    find: "(DB.clientWorkRequests||[]).filter(q=>q.clientId===b.clientId&&inM(q.submittedAt))", replace: "(DB.clientWorkRequests||[]).filter(q=>q.clientId===b.clientId&&true)" },
  { id: 'rt6-client', suite: 'retained6-test', file: 'index.html', note: "another client's requests are listed",
    find: "(DB.clientWorkRequests||[]).filter(q=>q.clientId===b.clientId&&inM(q.submittedAt))", replace: "(DB.clientWorkRequests||[]).filter(q=>inM(q.submittedAt))" },
  { id: 'rt6-note', suite: 'retained6-test', file: 'index.html', note: "the lead's note is left out",
    find: "delivered,requests,overdue,focus,note:(months[ym]||{}).note||'',", replace: "delivered,requests,overdue,focus,note:'',"},
  { id: 'rt6-guard', suite: 'retained6-test', file: 'index.html', note: 'a client can open the report maker',
    find: "function openMonthReport(boardId){\n  try{requireInternalUser(currentUser);}catch(e){return;}", replace: "function openMonthReport(boardId){" },
  { id: 'rt6-logo-raw', suite: 'retained6-test', file: 'index.html', note: 'the logo goes in uncompressed (a 500 KB file)',
    find: "doc.addImage(logo,'PNG',M,7,40,18.5,'etcher-logo','FAST')", replace: "doc.addImage(logo,'PNG',M,7,40,18.5)" },
];
