// Covers two additions to the Email Triage flow:
//  1. Bulk-routing pending triage items (triageToggleSelect/triageOpenBulkRoute/
//     triageConfirmBulkRoute/triageBulkDiscard) — needed once the MCP connector queues into
//     DB.emailIntake instead of creating tasks directly, so the queue can back up.
//  2. wsBulkMoveToBoard — moving tasks to a genuinely different board (not just a different
//     group on the same board), the escape hatch for anything routed to the wrong board.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // Two throwaway boards on two (possibly identical, if the seed only has one client) clients,
  // plus a group on each, so we never touch real data.
  const setup=await p.evaluate(()=>{
    const now=new Date().toISOString();
    const clientA=DB.clients[0].id, clientB=(DB.clients[1]||DB.clients[0]).id;
    const boardA={id:'wb-triageroute-a',name:'TriageRoute A',color:'#0d6e4e',clientId:clientA,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,createdAt:now,updatedAt:now};
    const boardB={id:'wb-triageroute-b',name:'TriageRoute B',color:'#1d6fb8',clientId:clientB,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,createdAt:now,updatedAt:now};
    DB.boards.push(boardA,boardB);DB.workboards=DB.boards;
    const groupA={id:'g-triageroute-a',clientId:clientA,boardId:boardA.id,workboardId:boardA.id,name:'Inbox A',order:0,color:'#0d6e4e',collapsed:false,createdAt:now,updatedAt:now};
    DB.groups.push(groupA);
    const staff=allStaff().find(u=>u.active!==false&&u.role!=='client');
    saveDB(DB);
    return{boardAId:boardA.id,boardBId:boardB.id,groupAId:groupA.id,crossClient:clientA!==clientB,staffId:staff?.id||null};
  });

  // ── 1. Bulk route: select 2 pending items, route both to Board A / Group A / one owner /
  // high priority / one due date in a single pass, each keeping its own subject as its title.
  const routeResult=await p.evaluate((s)=>{
    DB.emailIntake=DB.emailIntake||[];
    const mk=(id,subject)=>({id,status:'pending',from:'a@client.test',fromName:'A Client',subject,
      body:'',snippet:'',attachments:[],receivedAt:new Date().toISOString(),suggestedTitle:subject,
      suggestedDescription:'',suggestedBoardId:null,suggestedGroupId:null,suggestedDueDate:null,
      extractedDates:[],actionItems:[],routedToTaskId:null,routedAt:null,routedBy:null,
      discardedAt:null,discardedBy:null,originalEmailId:null,emailHeaders:{},isTest:true});
    const item1=mk('ei-route-1','Quote request — job 1'), item2=mk('ei-route-2','Quote request — job 2');
    DB.emailIntake.push(item1,item2);
    triageToggleSelect(item1.id);triageToggleSelect(item2.id);
    const selSizeAfterToggle=triageSelected.size;
    triageOpenBulkRoute();
    const modalOpen=!document.getElementById('generic-modal').classList.contains('hidden');
    document.getElementById('tr-board').value=s.boardAId;
    triageUpdateGroups();
    document.getElementById('tr-group').value=s.groupAId;
    document.getElementById('tr-owner').value=s.staffId||'';
    document.getElementById('tr-priority').value='high';
    document.getElementById('tr-due').value='2026-11-20';
    triageConfirmBulkRoute();
    const tasks=DB.tasks.filter(t=>t.emailSource&&(t.emailSource.subject==='Quote request — job 1'||t.emailSource.subject==='Quote request — job 2'));
    return{
      selSizeAfterToggle,modalOpen,
      taskCount:tasks.length,
      allOnBoardA:tasks.every(t=>t.boardId===s.boardAId&&t.workboardId===s.boardAId&&t.groupId===s.groupAId),
      allHighPriority:tasks.every(t=>t.priority==='high'),
      allDue:tasks.every(t=>t.endDate==='2026-11-20'),
      allOwned:s.staffId?tasks.every(t=>t.ownerId===s.staffId):true,
      titlesDistinct:new Set(tasks.map(t=>t.title)).size===2,
      taggedEmailIntake:tasks.every(t=>(t.tags||[]).includes('email-intake')),
      item1Routed:DB.emailIntake.find(x=>x.id==='ei-route-1').status==='routed',
      item2Routed:DB.emailIntake.find(x=>x.id==='ei-route-2').status==='routed',
      routedToTaskIdSet:DB.emailIntake.find(x=>x.id==='ei-route-1').routedToTaskId===tasks.find(t=>t.emailSource.subject==='Quote request — job 1')?.id,
      selectionCleared:triageSelected.size===0,
      modalClosedAfter:document.getElementById('generic-modal').classList.contains('hidden'),
    };
  },setup);
  ok(routeResult.selSizeAfterToggle===2,'triageToggleSelect adds both picked items to the selection');
  ok(routeResult.modalOpen,'triageOpenBulkRoute opens the generic modal');
  ok(routeResult.taskCount===2,'triageConfirmBulkRoute creates one task per selected pending item');
  ok(routeResult.allOnBoardA,'every bulk-routed task lands on the chosen board and group');
  ok(routeResult.allHighPriority,'the chosen priority applies to every bulk-routed task');
  ok(routeResult.allDue,'the chosen due date applies to every bulk-routed task');
  ok(routeResult.allOwned,'the chosen owner applies to every bulk-routed task');
  ok(routeResult.titlesDistinct,'each bulk-routed task keeps its own email subject as its title, not a shared one');
  ok(routeResult.taggedEmailIntake,'bulk-routed tasks are tagged email-intake, same as the single-item Route flow');
  ok(routeResult.item1Routed&&routeResult.item2Routed,'both queued items are marked routed, not left pending');
  ok(routeResult.routedToTaskIdSet,'a routed queue item points at the real task it became');
  ok(routeResult.selectionCleared,'the selection clears after a successful bulk route');
  ok(routeResult.modalClosedAfter,'the modal closes after a successful bulk route');

  // ── 2. Bulk discard: select 2 pending items, discard both through the real confirm dialog.
  const discardSetup=await p.evaluate(()=>{
    DB.emailIntake.push(
      {id:'ei-discard-1',status:'pending',subject:'Spam 1',from:'x@x.test',fromName:'X',receivedAt:new Date().toISOString(),isTest:true,attachments:[],actionItems:[],extractedDates:[]},
      {id:'ei-discard-2',status:'pending',subject:'Spam 2',from:'x@x.test',fromName:'X',receivedAt:new Date().toISOString(),isTest:true,attachments:[],actionItems:[],extractedDates:[]},
    );
    triageClearSelection();
    triageToggleSelect('ei-discard-1');triageToggleSelect('ei-discard-2');
    triageBulkDiscard();
    return{confirmOpen:!document.getElementById('confirm-modal').classList.contains('hidden')};
  });
  ok(discardSetup.confirmOpen,'triageBulkDiscard opens a real confirmation dialog rather than discarding immediately');
  await p.evaluate(()=>document.getElementById('confirm-ok-btn').click());
  await new Promise(r=>setTimeout(r,300));
  const discardResult=await p.evaluate(()=>({
    bothDiscarded:DB.emailIntake.find(x=>x.id==='ei-discard-1').status==='discarded'&&DB.emailIntake.find(x=>x.id==='ei-discard-2').status==='discarded',
    selectionCleared:triageSelected.size===0,
  }));
  ok(discardResult.bothDiscarded,'confirming the dialog discards every selected item');
  ok(discardResult.selectionCleared,'the selection clears after a bulk discard');

  // ── 3. Select-all toggles on, then off.
  const selectAllResult=await p.evaluate(()=>{
    DB.emailIntake.push(
      {id:'ei-selall-1',status:'pending',subject:'A',receivedAt:new Date().toISOString(),isTest:true,attachments:[],actionItems:[],extractedDates:[]},
      {id:'ei-selall-2',status:'pending',subject:'B',receivedAt:new Date().toISOString(),isTest:true,attachments:[],actionItems:[],extractedDates:[]},
    );
    triageClearSelection();
    triageToggleSelectAll();
    const afterFirst=triageSelected.has('ei-selall-1')&&triageSelected.has('ei-selall-2');
    triageToggleSelectAll();
    const afterSecond=triageSelected.size;
    return{afterFirst,afterSecond};
  });
  ok(selectAllResult.afterFirst,'triageToggleSelectAll selects every pending item');
  ok(selectAllResult.afterSecond===0,'triageToggleSelectAll deselects everything when all were already selected');

  // ── 4. Cross-board move: two ordinary tasks (one with a subitem) on Board A, bulk-moved to
  // Board B via the real confirm dialog. Subitems must follow their parent.
  await p.evaluate((s)=>{openWorkboard(s.boardAId);},setup);
  await new Promise(r=>setTimeout(r,400));
  const moveSetup=await p.evaluate((s)=>{
    const now=new Date().toISOString();
    const parent={id:'t-moveparent',clientId:s.boardAId?DB.boards.find(b=>b.id===s.boardAId).clientId:null,boardId:s.boardAId,workboardId:s.boardAId,groupId:s.groupAId,parentTaskId:null,
      title:'Move test parent',name:'Move test parent',ownerId:null,status:'todo',priority:'med',percentComplete:0,percentMode:'manual',
      startDate:null,endDate:null,lockedDates:false,order:0,archived:false,description:'',tags:[],dependencies:[],createdAt:now,updatedAt:now};
    const child={...parent,id:'t-movechild',parentTaskId:'t-moveparent',title:'Move test child',name:'Move test child'};
    DB.tasks.push(parent,child);
    wsSelected.clear();wsSelected.add('t-moveparent');
    wsBulkMoveToBoard(s.boardBId);
    const confirmOpen=!document.getElementById('confirm-modal').classList.contains('hidden');
    const confirmMsg=document.getElementById('confirm-msg').textContent;
    return{confirmOpen,confirmMsg};
  },setup);
  ok(moveSetup.confirmOpen,'wsBulkMoveToBoard confirms before moving, unlike the same-board group move');
  if(setup.crossClient) ok(/different client/.test(moveSetup.confirmMsg),'the confirm message warns when the move also changes the client');
  await p.evaluate(()=>document.getElementById('confirm-ok-btn').click());
  await new Promise(r=>setTimeout(r,300));
  const moveResult=await p.evaluate((s)=>{
    const parent=DB.tasks.find(t=>t.id==='t-moveparent'), child=DB.tasks.find(t=>t.id==='t-movechild');
    const boardB=DB.boards.find(b=>b.id===s.boardBId);
    return{
      parentMoved:parent.boardId===s.boardBId&&parent.workboardId===s.boardBId&&parent.clientId===boardB.clientId&&parent.groupId===null,
      childFollowed:child.boardId===s.boardBId&&child.workboardId===s.boardBId&&child.clientId===boardB.clientId&&child.groupId===null,
      selectionCleared:wsSelected.size===0,
    };
  },setup);
  ok(moveResult.parentMoved,'wsBulkMoveToBoard reassigns board/workboard/client and clears the group on the moved task');
  ok(moveResult.childFollowed,'a subitem follows its parent across the board move, same as the same-board group move');
  ok(moveResult.selectionCleared,'the selection clears after a successful cross-board move');

  // ── 5. Guard rails: no-op on an empty/self target, and the dropdown never offers the current board.
  const guardResult=await p.evaluate((s)=>{
    const before=JSON.stringify(DB.tasks.find(t=>t.id==='t-moveparent'));
    wsSelected.add('t-moveparent');
    wsBulkMoveToBoard('');
    wsBulkMoveToBoard(currentWorkboard.id);
    const unchanged=before===JSON.stringify(DB.tasks.find(t=>t.id==='t-moveparent'));
    updateBulkBar();
    const optionsHtml=document.getElementById('ws-bulk-bar').innerHTML;
    return{unchanged,excludesSelf:!optionsHtml.includes(`value="${currentWorkboard.id}"`)};
  },setup);
  ok(guardResult.unchanged,'wsBulkMoveToBoard is a no-op for an empty target or the board tasks are already on');
  ok(guardResult.excludesSelf,'the "Move to board" dropdown never lists the board you are currently viewing');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  if(errs.length){console.log('PAGE ERRORS:');errs.forEach(e=>console.log('  ! '+e));}
  await b.close();
  process.exit(fail.length?1:0);
})();
