// Can-fail mutations for Retained Services next features batch 2 (node .agents/_canfail.cjs .agents/_mut-retained5.cjs --green).
// Not mutated: the client block on the view, which has two layers (the blocked-views list and the page's own
// internal-user check), so removing either one alone is caught by neither test by design.
module.exports = [
  { id: 'rt5-weekend', suite: 'retained5-test', file: 'index.html', note: 'weekends count as business days',
    find: "function _bdIsWork(d){const w=d.getDay();return w>0&&w<6&&", replace: "function _bdIsWork(d){const w=d.getDay();return true||" },
  { id: 'rt5-reply-stop', suite: 'retained5-test', file: 'index.html', note: 'a reply never stops the reply clock',
    find: "function _wrReplied(r){return !!(r.respondedAt||r.status!=='pending'||r.adminNote||r.linkedItemId);}", replace: "function _wrReplied(r){return false;}" },
  { id: 'rt5-approval-stays', suite: 'retained5-test', file: 'index.html', note: 'work sent for approval stays in the queue',
    find: "function _rqTaskDelivered(t){return !!t&&(_rsDone(t)||(!!t.awaitingClient&&_cpIsApprovalAsk(t)));}", replace: "function _rqTaskDelivered(t){return !!t&&_rsDone(t);}" },
  { id: 'rt5-order', suite: 'retained5-test', file: 'index.html', note: 'the queue ignores the service level',
    find: ":(a,b)=>b.lv.rank-a.lv.rank||byDue(a,b));", replace: ":(a,b)=>byDue(a,b));" },
  { id: 'rt5-noclock-key', suite: 'retained5-test', file: 'index.html', note: 'a request with no clock sorts after dated work',
    find: "    x.key=x.next||(x.kind==='request'&&x.received?toDateStr(new Date(x.received)):null);", replace: "    x.key=x.next;" },
  { id: 'rt5-soon', suite: 'retained5-test', file: 'index.html', note: 'the default view shows every open job',
    find: "(q.show!=='soon'||r.kind==='request'||r.late||(r.next&&r.next<=soon))", replace: "(q.show!=='soon'||true)" },
  { id: 'rt5-80', suite: 'retained5-test', file: 'index.html', note: 'only 90% and over is flagged',
    find: "usage.filter(u=>u.allowance&&u.ratio>=0.8)", replace: "usage.filter(u=>u.allowance&&u.ratio>=0.9)" },
  { id: 'rt5-fee-col', suite: 'retained5-test', file: 'index.html', note: 'the dashboard shows a fee column again',
    find: "<th>${month} allowances</th>${regCol?", replace: "<th>${month} allowances</th><th>Monthly fee</th>${regCol?" },
  { id: 'rt5-redraw', suite: 'retained5-test', file: 'index.html', note: 'a change from the queue dialog jumps to Client Manager',
    find: "function _wrRedraw(id){\n  if(currentView==='retained'){", replace: "function _wrRedraw(id){\n  if(false){" },
  { id: 'rt5-linked-one-row', suite: 'retained5-test', file: 'index.html', note: 'a job added from a request shows twice',
    find: "if(!task||task.archived)return;taken.add(task.id);", replace: "if(!task||task.archived)return;" },
  { id: 'rt5-badge', suite: 'retained5-test', file: 'index.html', note: 'the sidebar badge never counts late items',
    find: "  const rdLate=retainedWbs.length?_rqLateCount():0;", replace: "  const rdLate=0;" },
];
