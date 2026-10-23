// Can-fail mutations for batch 13, the rest of the audit (node .agents/_canfail.cjs .agents/_mut-retained17.cjs --green).
const S = 'retained17-test';
module.exports = [
  // Server
  { id: 'rt17-lock-server', suite: S, file: 'api/_portal.js', note: 'the portal recounts closed months', find: "  const lk = rsLocked(b, s, ym); if (lk) return lk;\n", replace: "" },
  { id: 'rt17-qtr-server', suite: S, file: 'api/_portal.js', note: 'history says nothing of quarterly hours', find: "qtr: us.mode === 'hours' && q.length ? h(q) : null", replace: "qtr: null" },
  { id: 'rt17-team-server', suite: S, file: 'api/_portal.js', note: 'someone who left is on the client\'s team again', find: "    leadName: activeStaffName(blob, r.leadId), startMonth:", replace: "    leadName: staffName(blob, r.leadId), startMonth:" },
  // Helpers
  { id: 'rt17-perth', suite: S, file: 'index.html', note: 'months follow the computer\'s clock', find: "function _rsYm(d){d=d||new Date();if(_RS_FMT&&", replace: "function _rsYm(d){d=d||new Date();if(false&&" },
  { id: 'rt17-prev', suite: S, file: 'index.html', note: 'the month before January is wrong', find: "return m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');}", replace: "return y+'-'+String(m-1).padStart(2,'0');}" },
  { id: 'rt17-qstart', suite: S, file: 'index.html', note: 'quarters are calendar quarters again', find: "  if(/^\\d{4}-\\d{2}$/.test(String(start||''))){const sk=", replace: "  if(false){const sk=" },
  { id: 'rt17-qend', suite: S, file: 'index.html', note: 'a month counts its whole quarter, later months too', find: "_rsQuarter(d,start)===_rsQuarter(ym,start)&&d<=ym:d===ym;}", replace: "_rsQuarter(d,start)===_rsQuarter(ym,start):d===ym;}" },
  { id: 'rt17-kb', suite: S, file: 'index.html', note: 'King\'s Birthday 2024 on the wrong day', find: "add(_WA_KB[y]||lastMon(9));", replace: "add(lastMon(9));" },
  { id: 'rt17-quals', suite: S, file: 'index.html', note: 'training columns sorted by name again', find: "return order.concat([...used].filter(k=>!inOrder.has(k)));", replace: "return order.concat([...used].filter(k=>!inOrder.has(k)).sort());" },
  { id: 'rt17-due1', suite: S, file: 'index.html', note: 'a backdated retainer starts its jobs in the past', find: "  const due1=m.startMonth<_rsYm()?_rsYm()+'-01':first;", replace: "  const due1=first;" },
  // Audit trail
  { id: 'rt17-toggle', suite: S, file: 'index.html', note: 'ticking done leaves no trail', find: "  t.status=checked?'done':'todo';\n  _applyStatusProgress(t,t.status,_was);_taskAudit(t.id,'status',_was,t.status);", replace: "  t.status=checked?'done':'todo';\n  _applyStatusProgress(t,t.status,_was);" },
  { id: 'rt17-cycle', suite: S, file: 'index.html', note: 'cycling the status leaves no trail', find: "  t.status=CYCLE[idx>=0?(idx+1)%CYCLE.length:0];\n  _applyStatusProgress(t,t.status,_was);_taskAudit(t.id,'status',_was,t.status);", replace: "  t.status=CYCLE[idx>=0?(idx+1)%CYCLE.length:0];\n  _applyStatusProgress(t,t.status,_was);" },
  { id: 'rt17-mw', suite: S, file: 'index.html', note: 'My Week\'s complete leaves no trail', find: "if(done)task.percentComplete=0;_taskAudit(task.id,'status',was,ns);", replace: "if(done)task.percentComplete=0;" },
  { id: 'rt17-mwbulk', suite: S, file: 'index.html', note: 'bulk complete leaves no trail', find: "_applyStatusProgress(t,'done',was);_taskAudit(t.id,'status',was,'done');", replace: "_applyStatusProgress(t,'done',was);" },
  { id: 'rt17-drop', suite: S, file: 'index.html', note: 'a drag to another group leaves subitems behind', find: "dragged.groupId=target.groupId;DB.tasks.filter(x=>x.parentTaskId===dragged.id).forEach(x=>{x.groupId=target.groupId;});}", replace: "dragged.groupId=target.groupId;}" },
  { id: 'rt17-gantt', suite: S, file: 'index.html', note: 'a Gantt move leaves no dates in the trail', find: "    _taskAudit(taskId,'startDate',before.startDate,newStartDate);_taskAudit(taskId,'endDate',before.endDate,newEndDate);", replace: "" },
  { id: 'rt17-modal', suite: S, file: 'index.html', note: 'the task window logs fields nobody changed', find: "percentComplete:t.percentComplete||0,groupId:t.groupId,clientId:t.clientId,hourBudget:t.hourBudget||0,description:t.description||''};", replace: "groupId:t.groupId,clientId:t.clientId};" },
  { id: 'rt17-boardmove', suite: S, file: 'index.html', note: 'a move to another board leaves no trail', find: "      _taskAudit(t.id,'boardId',t.boardId||t.workboardId,boardId);\n", replace: "" },
  { id: 'rt17-created', suite: S, file: 'index.html', note: 'Created the task shows twice', find: "if(task.createdAt&&!logCreated)out.push(", replace: "if(task.createdAt)out.push(" },
  { id: 'rt17-actbtn', suite: S, file: 'index.html', note: 'the Activity tab shows a toggle that does nothing', find: "${rows.length>10&&!noToggle?", replace: "${rows.length>10?" },
  // Boards, months, copies
  { id: 'rt17-openwb', suite: S, file: 'index.html', note: 'a link to a missing board clears the open one', find: "  const wb=DB.workboards.find(w=>w.id===id);\n  if(!wb){showToast('That board is no longer here.','info',3500);return;}", replace: "  const wb=DB.workboards.find(w=>w.id===id);currentWorkboard=wb;\n  if(!wb){showToast('That board is no longer here.','info',3500);return;}" },
  { id: 'rt17-monthtmp', suite: S, file: 'index.html', note: 'a notification\'s All months is saved for good', find: "function _wsMonthShowAll(){if(currentWorkboard&&_wsMonthOn())_wsMonthTmp=currentWorkboard.id;}", replace: "function _wsMonthShowAll(){if(currentWorkboard&&_wsMonthOn()){_wsMonthSel[currentWorkboard.id]='all';try{localStorage.setItem('etcher_ws_month',JSON.stringify(_wsMonthSel));}catch(e){}}}" },
  { id: 'rt17-order', suite: S, file: 'index.html', note: 'archived tasks lose their place in the order', find: "  let max=-1;(DB.tasks||[]).forEach(t=>{if(t.groupId===groupId&&!t.parentTaskId){", replace: "  let max=-1;(DB.tasks||[]).forEach(t=>{if(t.groupId===groupId&&!t.parentTaskId&&!t.archived){" },
  { id: 'rt17-occ', suite: S, file: 'index.html', note: 'a recurring copy carries the source\'s history', find: "      delete base.auditTrail;delete base.clientApproval;delete base.clientApprovedAt;", replace: "" },
  { id: 'rt17-dup', suite: S, file: 'index.html', note: 'a board copy carries the original\'s history', find: "    delete copy.refNumber;delete copy.auditTrail;delete copy.clientApproval;delete copy.clientApprovedAt;", replace: "    delete copy.refNumber;" },
  { id: 'rt17-restore', suite: S, file: 'index.html', note: 'an ended retainer is restored next to a running one', find: "  if(wb&&_rsRestoreClash(wb))return;\n", replace: "" },
  // Month locking
  { id: 'rt17-lock', suite: S, file: 'index.html', note: 'closed months are recounted', find: "  const lk=_rsLocked(b,s,ym);if(lk)return lk;\n", replace: "" },
  { id: 'rt17-lock-once', suite: S, file: 'index.html', note: 'months are locked again every time', find: "      if(r.months[m]&&r.months[m].lock)continue;\n", replace: "" },
  { id: 'rt17-lock-cur', suite: S, file: 'index.html', note: 'the month in progress is locked too', find: "function _rsLockUpTo(){const d=new Date();d.setDate(d.getDate()-9);return _rsPrevYm(_rsYm(d));}", replace: "function _rsLockUpTo(){return _rsYm();}" },
  { id: 'rt17-kids', suite: S, file: 'index.html', note: 'the subitem index goes stale within a moment', find: "if(!_rsKidsIx||_rsKidsIx.src!==ts||_rsKidsIx.n!==ts.length){", replace: "if(!_rsKidsIx){" },
  // Plan, dashboard
  { id: 'rt17-left', suite: S, file: 'index.html', note: 'someone who left is replaced by the first name in the list', find: "const staffOpts=v=>(v&&!_rsStaff().some(u=>u.id===v)?`<option value=\"${escHtml(v)}\" selected>${escHtml(leftName(v))}</option>`:'')+", replace: "const staffOpts=v=>" },
  { id: 'rt17-remove', suite: S, file: 'index.html', note: 'a service is removed on one click', find: "onclick=\"_rsPlanRemove('${b.id}','${s.key}')\"", replace: "onclick=\"_rsPlanSet('${b.id}','removeService','${s.key}')\"" },
  { id: 'rt17-tabs', suite: S, file: 'index.html', note: 'arrow keys do nothing on the tabs', find: "  e.preventDefault();tabs[step==='first'?0:", replace: "  return;tabs[step==='first'?0:" },
  { id: 'rt17-tabindex', suite: S, file: 'index.html', note: 'every tab is its own stop for Tab', find: " tabindex=\"${(_rdQ.tab||'queue')===k?0:-1}\"", replace: "" },
  { id: 'rt17-level', suite: S, file: 'index.html', note: 'the queue says By level again', find: "[['level','By support tier'],", replace: "[['level','By level']," },
  { id: 'rt17-clientsby', suite: S, file: 'index.html', note: 'the 80% count opens nothing', find: "function _rdClientsBy(k){_regView=null;Object.assign(_rdQ,{tab:'clients',cq:''});", replace: "function _rdClientsBy(k){_regView=null;" },
  { id: 'rt17-att', suite: S, file: 'index.html', note: 'Needs attention lists everything', find: "(_rdQ.attAll?attLis:attLis.slice(0,8)).join('')", replace: "attLis.join('')" },
  // Hours log, panel, portal
  { id: 'rt17-items', suite: S, file: 'index.html', note: 'the hours log is silent about items services', find: ":'<small>Tracked by items, so hours fill no squares</small>'}</td>", replace: ":''}</td>" },
  { id: 'rt17-footer', suite: S, file: 'index.html', note: 'the task panel footer uses dots again', find: ".filter(Boolean).join('. ')}", replace: ".filter(Boolean).join(' &middot; ')}" },
  { id: 'rt17-team', suite: S, file: 'index.html', note: 'someone who left is on the portal\'s team', find: "return u&&u.active!==false?u.name:null;};   // someone who has left", replace: "return u?u.name:null;};   // someone who has left" },
  { id: 'rt17-attach', suite: S, file: 'index.html', note: 'Attach files cannot be reached by keyboard', find: "<input type=\"file\" multiple onchange=\"cpReqFileChanged(this)\" aria-label=\"Attach files\"/>", replace: "<input type=\"file\" multiple onchange=\"cpReqFileChanged(this)\" style=\"display:none\"/>" },
  { id: 'rt17-max', suite: S, file: 'index.html', note: 'the description has no limit', find: "rows=\"4\" maxlength=\"5000\"", replace: "rows=\"4\"" },
  { id: 'rt17-duem', suite: S, file: 'index.html', note: 'phones lose the due dates', find: "${due(t)?`<small class=\"cp-rt-due-m\">Due ${due(t)}</small>`:''}", replace: "" },
  { id: 'rt17-notif', suite: S, file: 'index.html', note: 'a note about a request cannot be clicked', find: "req=!open&&!n.taskId&&n.type==='work_request';", replace: "req=false;" },
  { id: 'rt17-stamp', suite: S, file: 'index.html', note: 'a request sent offline has no update stamp', find: "      submittedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),", replace: "      submittedAt:new Date().toISOString()," },
];
