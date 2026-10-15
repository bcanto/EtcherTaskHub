// Covers .agents/PLAN-client-board-and-actions.md — the "With: Client" handoff composer,
// the client's response flipping With back to the owner, the board view leaking no staff
// names, internalOnly attachment defaults, and _reconcileActionRequests.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const report=()=>{
    console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
    console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
    console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  };

  // ── pick a task with an owner AND a clientId resolvable through it or its group —
  // required for the client-side response calls below to pass assertClientCanAccessClientData.
  const setup=await p.evaluate(()=>{
    const resolveClient=t=>t.clientId||(DB.groups.find(g=>g.id===t.groupId)||{}).clientId||null;
    const t=DB.tasks.find(x=>!x.archived&&!x.parentTaskId&&x.ownerId&&resolveClient(x));
    return t?{id:t.id,ownerId:t.ownerId,clientId:resolveClient(t),status:t.status}:null;
  });
  console.log('SETUP:',JSON.stringify(setup));
  if(!setup){
    fail.push('could not find a seed task with an owner and a resolvable clientId');
    report();await b.close();process.exit(1);
  }

  // ── 1. Sending an action request: creates the row, moves With, leaves status alone ──
  const sendResult=await p.evaluate((taskId)=>{
    const before=DB.actionRequests.length;
    const beforeStatus=DB.tasks.find(t=>t.id===taskId).status;
    wsHandoffToClient(taskId);
    document.getElementById('wsh-title').value='Review the draft';
    document.getElementById('wsh-body').value='Please review section 3.';
    wsSendClientAction(taskId,false);
    const t=DB.tasks.find(x=>x.id===taskId);
    const reqs=DB.actionRequests.filter(r=>r.taskId===taskId&&r.status==='open');
    return{
      created:DB.actionRequests.length===before+1,
      reqCount:reqs.length,
      req:reqs[0]?{kind:reqs[0].kind,title:reqs[0].title,body:reqs[0].body}:null,
      currentlyWithType:t.currentlyWithType,
      statusUnchanged:t.status===beforeStatus,
      modalClosed:document.getElementById('generic-modal').classList.contains('hidden'),
    };
  },setup.id);
  console.log('SEND:',JSON.stringify(sendResult));
  ok(sendResult.created,'sending an action request adds exactly one DB.actionRequests row');
  ok(sendResult.reqCount===1,'exactly one OPEN request exists for the task after sending');
  ok(sendResult.req&&sendResult.req.title==='Review the draft'&&sendResult.req.body==='Please review section 3.','the composer\'s title/body are saved onto the request');
  ok(sendResult.currentlyWithType==='client','sending the request moves With to Client via the existing wsCellSave path');
  ok(sendResult.statusUnchanged,'sending the request does not touch task.status');
  ok(sendResult.modalClosed,'the composer modal closes after sending');

  // ── 2. "Send without a note" bypasses the required-body validation ──
  const skipResult=await p.evaluate((taskId)=>{
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    const before=DB.actionRequests.filter(r=>r.taskId===taskId&&r.status==='open').length;
    wsHandoffToClient(taskId);
    document.getElementById('wsh-body').value='';
    wsSendClientAction(taskId,true);
    const after=DB.actionRequests.filter(r=>r.taskId===taskId&&r.status==='open').length;
    return{before,after,modalClosed:document.getElementById('generic-modal').classList.contains('hidden')};
  },setup.id);
  console.log('SKIP-NOTE:',JSON.stringify(skipResult));
  ok(skipResult.after===skipResult.before+1,'"Send without a note" still creates and sends a request with an empty body');
  ok(skipResult.modalClosed,'"Send without a note" closes the modal (never blocks)');

  // ── 3. A required-note send with an empty body is blocked — no request created ──
  const blockResult=await p.evaluate((taskId)=>{
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    const before=DB.actionRequests.filter(r=>r.taskId===taskId&&r.status==='open').length;
    wsHandoffToClient(taskId);
    document.getElementById('wsh-body').value='';
    wsSendClientAction(taskId,false);
    const after=DB.actionRequests.filter(r=>r.taskId===taskId&&r.status==='open').length;
    const errShown=document.getElementById('wsh-body-err').style.display==='block';
    const modalStillOpen=!document.getElementById('generic-modal').classList.contains('hidden');
    return{before,after,errShown,modalStillOpen};
  },setup.id);
  console.log('BLOCK-EMPTY:',JSON.stringify(blockResult));
  ok(blockResult.after===blockResult.before,'"Send request" with an empty body is blocked — no request created');
  ok(blockResult.errShown,'the validation error is shown');
  ok(blockResult.modalStillOpen,'the composer stays open when blocked');
  await p.evaluate(()=>closeGenericModal());

  // ── 4. Client responding: flips With back to returnToUserId, leaves status alone, notifies ──
  const respondResult=await p.evaluate((taskId,ownerId)=>{
    const real=currentUser;
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    wsHandoffToClient(taskId);
    document.getElementById('wsh-title').value='Approve the quote';
    document.getElementById('wsh-body').value='Please approve so we can proceed.';
    document.getElementById('wsh-return').value=ownerId;
    wsSendClientAction(taskId,false);
    const req=DB.actionRequests.find(r=>r.taskId===taskId&&r.status==='open');
    const beforeStatus=DB.tasks.find(t=>t.id===taskId).status;

    // Fake client session scoped to this task's client — same pattern as audit-portal.cjs.
    currentUser={id:'probe-client-1',name:'Probe Client',role:'client',type:'client',clientId:req.clientId};
    cpRespondToAction(req.id,taskId);
    document.getElementById('cp-ar-note').value='Done, thanks!';
    cpSendActionResponse(req.id,taskId);

    const t=DB.tasks.find(x=>x.id===taskId);
    const reqAfter=DB.actionRequests.find(r=>r.id===req.id);
    const result={
      reqStatus:reqAfter.status,
      reqNote:reqAfter.responseNote,
      currentlyWithType:t.currentlyWithType,
      currentlyWithUserId:t.currentlyWithUserId,
      statusUnchanged:t.status===beforeStatus,
      notifCreated:(DB.notifications||[]).some(n=>n.taskId===taskId&&n.type==='currently_with'&&n.recipientId===ownerId),
    };
    currentUser=real;
    return result;
  },setup.id,setup.ownerId);
  console.log('RESPOND:',JSON.stringify(respondResult));
  ok(respondResult.reqStatus==='done','client response marks the request done');
  ok(respondResult.reqNote==='Done, thanks!',"the client's note is saved on the request");
  ok(respondResult.currentlyWithType==='staff'&&respondResult.currentlyWithUserId===setup.ownerId,'responding flips With back to the returnToUserId');
  ok(respondResult.statusUnchanged,'responding does not change task.status');
  ok(respondResult.notifCreated,'the returning owner is notified');

  // ── 5. An ownerless task's completed response notifies all staff, not nobody ──
  const noOwnerResult=await p.evaluate((taskId)=>{
    const real=currentUser;
    const t=DB.tasks.find(x=>x.id===taskId);
    const savedOwner=t.ownerId;
    t.ownerId=null;
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    const before=(DB.notifications||[]).length;
    wsHandoffToClient(taskId);
    document.getElementById('wsh-title').value='FYI';
    document.getElementById('wsh-body').value='Just for your awareness.';
    document.getElementById('wsh-return').value='';
    wsSendClientAction(taskId,false);
    const req=DB.actionRequests.find(r=>r.taskId===taskId&&r.status==='open');
    currentUser={id:'probe-client-2',name:'Probe Client',role:'client',type:'client',clientId:req.clientId};
    cpRespondToAction(req.id,taskId);
    cpSendActionResponse(req.id,taskId);
    const after=(DB.notifications||[]).length;
    currentUser=real;
    t.ownerId=savedOwner;
    return{gained:after-before};
  },setup.id);
  console.log('NO-OWNER:',JSON.stringify(noOwnerResult));
  ok(noOwnerResult.gained>0,"an ownerless task's completed response still fires at least one notification (all staff, not nobody)");

  // ── 6. Approving a task with an open request closes that request ──
  const approveCloses=await p.evaluate((taskId)=>{
    const real=currentUser;
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    wsHandoffToClient(taskId);
    document.getElementById('wsh-title').value='Approve please';
    document.getElementById('wsh-body').value='Approve this.';
    wsSendClientAction(taskId,false);
    const req=DB.actionRequests.find(r=>r.taskId===taskId&&r.status==='open');
    const t=DB.tasks.find(x=>x.id===taskId);
    t.approvalType='work';
    currentUser={id:'probe-client-3',name:'Probe Client',role:'client',type:'client',clientId:req.clientId};
    const origConfirm=window.confirm;window.confirm=()=>true;
    cpApproveTask(taskId);
    window.confirm=origConfirm;
    const reqAfter=DB.actionRequests.find(r=>r.id===req.id);
    currentUser=real;
    return{reqStatus:reqAfter.status};
  },setup.id);
  console.log('APPROVE-CLOSES:',JSON.stringify(approveCloses));
  ok(approveCloses.reqStatus==='done','approving a task closes any open action request on it');

  // ── 7. As a fake client session, the staff-only functions are no-ops ──
  const clientNoOp=await p.evaluate((taskId)=>{
    const real=currentUser;
    const beforeReqs=DB.actionRequests.length;
    const beforeTask=JSON.stringify(DB.tasks.find(t=>t.id===taskId));
    currentUser={id:'probe-client-4',name:'Probe Client',role:'client',type:'client',clientId:(DB.tasks.find(t=>t.id===taskId)||{}).clientId};
    let threw=false;
    try{
      wsHandoffToClient(taskId);
      wsSendClientAction(taskId,true);
      const anyReq=DB.actionRequests.find(r=>r.taskId===taskId&&r.status==='open');
      if(anyReq)wsCancelActionRequest(anyReq.id);
    }catch(e){threw=true;}
    const afterReqs=DB.actionRequests.length;
    const afterTask=JSON.stringify(DB.tasks.find(t=>t.id===taskId));
    currentUser=real;
    return{threw,noNewRequests:afterReqs===beforeReqs,taskUnchanged:afterTask===beforeTask};
  },setup.id);
  console.log('CLIENT-NOOP:',JSON.stringify(clientNoOp));
  ok(!clientNoOp.threw,'a client session calling the staff-only functions never throws uncaught');
  ok(clientNoOp.noNewRequests,'a client session cannot create action requests');
  ok(clientNoOp.taskUnchanged,'a client session cannot change the task via these functions');

  // ── 8. _reconcileActionRequests: fixes a lost flip, is idempotent, never fights a later edit ──
  const reconcileTest=await p.evaluate((taskId,ownerId)=>{
    (DB.actionRequests||[]).filter(r=>r.taskId===taskId&&r.status==='open').forEach(r=>r.status='cancelled');
    const t=DB.tasks.find(x=>x.id===taskId);
    const now=new Date().toISOString();
    const past=new Date(Date.now()-60000).toISOString();
    const future=new Date(Date.now()+60000).toISOString();
    DB.actionRequests.push({id:'ar-test-reconcile',taskId,boardId:null,clientId:t.clientId||null,kind:'review',
      title:'t',body:'b',dueDate:null,askedByUserId:null,askedByName:null,returnToUserId:ownerId,
      status:'done',respondedAt:now,respondedByUserId:null,responseNote:null,createdAt:past,updatedAt:now});
    t.currentlyWithType='client';t.currentlyWith='client';t.currentlyWithUserId=null;t.updatedAt=past;
    _reconcileActionRequests();
    const afterFirst={currentlyWithType:t.currentlyWithType,currentlyWithUserId:t.currentlyWithUserId};
    _reconcileActionRequests();
    const afterSecond={currentlyWithType:t.currentlyWithType,currentlyWithUserId:t.currentlyWithUserId};

    t.currentlyWithType='client';t.currentlyWith='client';t.currentlyWithUserId=null;t.updatedAt=future;
    _reconcileActionRequests();
    const guardResult={currentlyWithType:t.currentlyWithType};

    DB.actionRequests=DB.actionRequests.filter(r=>r.id!=='ar-test-reconcile');
    return{afterFirst,afterSecond,guardResult};
  },setup.id,setup.ownerId);
  console.log('RECONCILE:',JSON.stringify(reconcileTest));
  ok(reconcileTest.afterFirst.currentlyWithType==='staff'&&reconcileTest.afterFirst.currentlyWithUserId===setup.ownerId,'reconcile flips a stale With:Client back to the returning owner');
  ok(reconcileTest.afterSecond.currentlyWithType==='staff','a second reconcile call is idempotent — no further change');
  ok(reconcileTest.guardResult.currentlyWithType==='client','a later deliberate staff edit (newer updatedAt) is never fought by reconcile');

  // ── 9. No staff id or email leaks in the client board view (display names are allowed, R6) ──
  const boardLeak=await p.evaluate(()=>{
    const real=currentUser;
    const withTasks=DB.clients.map(c=>({c,n:(typeof getClientTasks==='function'?getClientTasks(c.id):[]).length})).filter(x=>x.n>0);
    if(!withTasks.length)return{skip:'no client with tasks'};
    const A=withTasks[0].c;
    currentUser={id:'probe-board',name:'Probe',role:'client',type:'client',clientId:A.id};
    document.getElementById('client-portal')?.classList.remove('hidden');
    cpNavigate('workboard');
    const txt=document.getElementById('cp-body')?.innerText||'';
    const html=document.getElementById('cp-body')?.innerHTML||'';
    const secrets=(DB.staff||[]).flatMap(s=>[s.email,s.loginEmail,s.id]).filter(v=>v&&String(v).length>3);
    const leaked=secrets.filter(v=>html.includes(String(v)));
    currentUser=real;
    document.getElementById('client-portal')?.classList.add('hidden');
    return{leaked,len:txt.length};
  });
  console.log('BOARD-LEAK:',JSON.stringify(boardLeak));
  if(boardLeak.skip){console.log('  (board leak check skipped: '+boardLeak.skip+')');}
  else{
    ok(boardLeak.len>0,'the board view renders content for a client with tasks');
    ok(boardLeak.leaked.length===0,'no staff id or email appears anywhere in the rendered board view');
  }

  // ── 10. internalOnly attachment defaults + the share toggle ──
  const attachTest=await p.evaluate((taskId)=>{
    _wsCellTask=taskId;_wsShowLinkInput=true;
    const dd=document.getElementById('ws-cell-dd'),body=document.getElementById('ws-cell-dd-body');
    if(dd&&body){dd.style.display='block';body.innerHTML=wsBuildDropdownHtml(taskId,'attachments');}
    document.getElementById('ws-link-url').value='sharepoint.com/site/probe-doc';
    wsAddAttachmentLink(taskId);
    const f=(DB.taskFiles||[]).filter(x=>x.taskId===taskId).sort((a,b)=>(b.addedAt||'').localeCompare(a.addedAt||''))[0];
    const sharedDefault=f.internalOnly===false;
    wsToggleAttachmentShare(f.id);
    const afterToggle=(DB.taskFiles||[]).find(x=>x.id===f.id).internalOnly;
    const beforeCount=(DB.taskFiles||[]).filter(x=>x.taskId===taskId).length;
    wsDeleteAttachment(f.id);
    const afterCount=(DB.taskFiles||[]).filter(x=>x.taskId===taskId).length;
    if(dd)dd.style.display='none';
    return{sharedDefault,afterToggle,cleanedUp:afterCount===beforeCount-1};
  },setup.id);
  console.log('ATTACH:',JSON.stringify(attachTest));
  ok(attachTest.sharedDefault,'a new link attachment defaults to Shared (internalOnly:false) — the task switch and the pill decide visibility');
  ok(attachTest.afterToggle===true,'toggling the pill flips it to Internal (hidden from the client)');
  ok(attachTest.cleanedUp,'the test attachment was removed again (no leftover state)');

  // ── 11. Audit fixes (2026-09-24) ─────────────────────────────────────────────────────────
  // 11a. A client-typed link can't run script in the staff session (three injection vectors
  // the audit reproduced live: onclick JS string, staff href attribute, portal href attribute).
  const xss=await p.evaluate(()=>{
    const real=currentUser;window.__xss=0;window.__xss2=0;
    const t=DB.tasks.find(x=>x.id==='t1');
    const saved={a:t.currentlyWithType,b:t.currentlyWith,c:t.currentlyWithUserId};
    t.currentlyWithType='client';t.currentlyWith='client';t.currentlyWithUserId=null;
    currentUser={id:'probe-xss',name:'P',role:'client',type:'client',clientId:'c1'};
    const add=v=>{_cpShowLinkInput=true;cpOpenTaskModal('t1');document.getElementById('cp-link-url-t1').value=v;cpAddActionLink('t1');};
    add("x.com/');window.__xss=1;//");
    add('x.com/" onmouseover="window.__xss2=1" x="');
    add('javascript:window.__xss=1');
    const injected=root=>[...root.querySelectorAll('*')].some(el=>[...el.attributes].some(at=>at.name.startsWith('on')&&at.value.includes('__xss')));
    const portalInjected=injected(document.getElementById('cp-task-modal-body'));
    cpCloseTaskModal();currentUser=real;
    const origOpen=window.open;window.open=()=>null;
    const dd=document.getElementById('ws-cell-dd'),body=document.getElementById('ws-cell-dd-body');
    _wsCellTask='t1';dd.style.display='block';body.innerHTML=wsBuildDropdownHtml('t1','attachments');
    body.querySelectorAll('button[title="Open link"]').forEach(bt=>bt.click());
    const staffHrefInjected=injected(body);
    window.open=origOpen;dd.style.display='none';
    const stored=DB.taskFiles.filter(f=>f.taskId==='t1'&&f.uploadedByClientId&&f.type==='link').map(f=>f.url);
    DB.taskFiles=DB.taskFiles.filter(f=>!(f.taskId==='t1'&&f.uploadedByClientId));
    t.currentlyWithType=saved.a;t.currentlyWith=saved.b;t.currentlyWithUserId=saved.c;
    return{onclickRan:!!window.__xss,portalInjected,staffHrefInjected,stored};
  });
  console.log('XSS:',JSON.stringify(xss));
  ok(!xss.onclickRan,'a crafted link cannot break out of the staff attachment onclick');
  ok(!xss.staffHrefInjected,'a crafted link cannot inject attributes into the staff attachment list');
  ok(!xss.portalInjected,'a crafted link cannot inject attributes into the client portal attachment list');
  ok(xss.stored.every(u=>/^https?:\/\//.test(u)&&!u.includes('"')),'stored link URLs are normalised http(s) with no raw double quotes');

  // 11b. "No one in particular" is honoured even when the task has an owner.
  const noOne=await p.evaluate((taskId)=>{
    wsHandoffToClient(taskId);
    document.getElementById('wsh-body').value='x';
    document.getElementById('wsh-return').value='';
    wsSendClientAction(taskId,false);
    const r=DB.actionRequests.filter(x=>x.taskId===taskId&&x.status==='open')[0];
    return{returnTo:r?r.returnToUserId:'missing'};
  },setup.id);
  ok(noOne.returnTo===null,'choosing "No one in particular" stores no return-to user (not the owner)');

  // 11c. A new ask supersedes the one still open — never two open asks on one task.
  const sup=await p.evaluate((taskId)=>{
    wsHandoffToClient(taskId);
    document.getElementById('wsh-body').value='second ask';
    wsSendClientAction(taskId,false);
    return{open:DB.actionRequests.filter(x=>x.taskId===taskId&&x.status==='open').length};
  },setup.id);
  ok(sup.open===1,'sending a new ask leaves exactly one open request on the task');

  // 11d. The client sees and gets notified of the ask at the id their session actually uses.
  const notif=await p.evaluate((taskId,clientId)=>{
    const rid=_clientRecipientId(clientId);
    return{rid,has:(DB.notifications||[]).some(n=>n.taskId===taskId&&n.type==='client_action_requested'&&n.recipientId===rid)};
  },setup.id,setup.clientId);
  ok(notif.rid&&notif.has,'the client_action_requested notification is addressed to the client portal id');

  // 11e. Staff taking the task back hides the ask from the client and blocks Mark Done.
  const takeBack=await p.evaluate((taskId,ownerId)=>{
    const real=currentUser;
    wsCellSave(taskId,'currentlyWith',ownerId);
    const req=DB.actionRequests.find(x=>x.taskId===taskId&&x.status==='open');
    const exposed=!!sanitizeTaskForClient(DB.tasks.find(t=>t.id===taskId)).openRequest;
    currentUser={id:'probe-tb',name:'P',role:'client',type:'client',clientId:req.clientId};
    cpSendActionResponse(req.id,taskId);
    const t=DB.tasks.find(x=>x.id===taskId);
    const res={exposed,reqStillOpen:DB.actionRequests.find(x=>x.id===req.id).status==='open',withUser:t.currentlyWithUserId};
    currentUser=real;closeGenericModal();
    wsCancelActionRequest(req.id);
    return res;
  },setup.id,setup.ownerId);
  console.log('TAKE-BACK:',JSON.stringify(takeBack));
  ok(!takeBack.exposed,'an open ask is hidden from the client once staff take the task back');
  ok(takeBack.reqStillOpen&&takeBack.withUser===setup.ownerId,'Mark Done is refused and does not move With once staff have the task back');

  // 11f. Handing off from the older task modal doesn't paint the Main Table over the dashboard.
  const viewKeep=await p.evaluate(async(taskId)=>{
    navigate('dashboard');await new Promise(r=>setTimeout(r,500));
    wsHandoffToClient(taskId);
    document.getElementById('wsh-body').value='from dashboard';
    wsSendClientAction(taskId,false);
    await new Promise(r=>setTimeout(r,300));
    const vc=document.getElementById('view-container');
    return{view:currentView,mainTableShown:!!vc.querySelector('.ws-grp-hdr')};
  },setup.id);
  ok(viewKeep.view==='dashboard'&&!viewKeep.mainTableShown,'a handoff sent from the dashboard leaves the dashboard on screen');

  // 11g. A non-approval ask (supply) shows Mark Done, not Approve/Request Changes — Approve
  // would move task.status to approved-client, which a plain ask must never do.
  const supply=await p.evaluate(async(taskId)=>{
    const real=currentUser;
    navigate('dashboard');
    wsHandoffToClient(taskId);
    document.getElementById('wsh-kind').value='supply';
    document.getElementById('wsh-body').value='Send us the site plan.';
    wsSendClientAction(taskId,false);
    const req=DB.actionRequests.find(x=>x.taskId===taskId&&x.status==='open');
    currentUser={id:'probe-sup',name:'P',role:'client',type:'client',clientId:req.clientId};
    document.getElementById('client-portal')?.classList.remove('hidden');
    cpOpenTaskModal(taskId);
    const m=document.getElementById('cp-task-modal-body');
    const modal={markDone:!!m.querySelector(`button[onclick^="cpRespondToAction"]`),approve:!!m.querySelector(`button[onclick^="cpApproveTask"]`)};
    cpCloseTaskModal();
    cpNavigate('tasks');
    const rowApprove=!!document.querySelector(`#cp-tasks-body button[onclick*="cpApproveTask('${taskId}')"]`);
    document.getElementById('client-portal')?.classList.add('hidden');
    currentUser=real;
    wsCancelActionRequest(req.id);
    return{modal,rowApprove};
  },setup.id);
  console.log('SUPPLY-ASK:',JSON.stringify(supply));
  ok(supply.modal.markDone&&!supply.modal.approve,'a "supply information" ask offers Mark Done and no Approve in the task modal');
  ok(!supply.rowApprove,'a "supply information" ask shows no Approve button on its Tasks-tab row');

  // ── 12. clientHidden — per-task opt-out from the portal ─────────────────────────────────
  const hiddenTest=await p.evaluate((taskId)=>{
    const real=currentUser;
    const t=DB.tasks.find(x=>x.id===taskId);
    const child={id:'th-child-'+uid(),parentTaskId:taskId,groupId:t.groupId,clientId:t.clientId,name:'child of hidden',
      title:'child of hidden',status:'todo',priority:'med',percentComplete:0,percentMode:'manual',
      currentlyWithType:'none',currentlyWithUserId:null,startDate:null,endDate:null,archived:false,
      tags:[],dependencies:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null};
    DB.tasks.push(child);
    const before=getClientTasks(t.clientId).some(x=>x.id===taskId);
    t.clientHidden=true;
    const afterInList=getClientTasks(t.clientId).some(x=>x.id===taskId);
    const childInList=getClientTasks(t.clientId).some(x=>x.id===child.id);
    currentUser={id:'probe-hidden',name:'P',role:'client',type:'client',clientId:t.clientId};
    const directView=canViewTask(currentUser,t);
    const childDirectView=canViewTask(currentUser,child);
    currentUser=real;
    t.clientHidden=false;
    DB.tasks=DB.tasks.filter(x=>x.id!==child.id);
    return{before,afterInList,childInList,directView,childDirectView};
  },setup.id);
  console.log('CLIENT-HIDDEN:',JSON.stringify(hiddenTest));
  ok(hiddenTest.before,'sanity: the task is in getClientTasks before being hidden');
  ok(!hiddenTest.afterInList,'setting clientHidden removes the task from getClientTasks');
  ok(!hiddenTest.childInList,"a hidden task's own subtask is also excluded from getClientTasks");
  ok(!hiddenTest.directView,'canViewTask refuses a client viewing a hidden task directly by id');
  ok(!hiddenTest.childDirectView,"canViewTask refuses a client viewing a hidden task's subtask directly by id");

  report();
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('ACTION-REQUESTS TEST CRASHED',e.message);process.exit(1)});
