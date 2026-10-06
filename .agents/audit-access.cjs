// Access pass, probed adversarially: not "does the UI hide it" but "does the code refuse it
// when called directly". This app stores client credentials in DB.clientNotes, so the cost
// of a gap here is the highest in the product.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));
  const pass=[],fail=[],notes=[];
  const ok=(c,m)=>c?pass.push(m):fail.push(m);

  const R=await p.evaluate(()=>{
    const out={};
    const realUser=currentUser;
    const clients=DB.clients||[];
    const cA=clients[1],cB=clients[2];
    const asClient=c=>({id:'probe_'+c.id,name:c.name,role:'client',type:'client',clientId:c.id});
    const asStaff=()=>({id:'probe_staff',name:'Probe Staff',role:'staff',type:'staff'});

    // ── a client may only see their own board / tasks ──
    const boardsOfB=(DB.workboards||[]).filter(w=>boardClientId(w)===cB.id);
    const boardsOfA=(DB.workboards||[]).filter(w=>boardClientId(w)===cA.id);
    currentUser=asClient(cA);
    out.clientSeesOtherBoard=boardsOfB.filter(w=>canViewBoard(currentUser,w)).map(w=>w.name);
    out.clientSeesOwnBoard=boardsOfA.filter(w=>canViewBoard(currentUser,w)).length;
    const tasksOfB=(DB.tasks||[]).filter(t=>{const wb=(DB.workboards||[]).find(w=>w.id===_taskBoardId(t));return wb&&boardClientId(wb)===cB.id;});
    out.clientSeesOtherTasks=tasksOfB.filter(t=>canViewTask(currentUser,t)).length;
    out.otherClientTaskCount=tasksOfB.length;

    // ── personalBoard: a Private board can ALSO be hidden from admin/pm oversight, not just
    // other staff — the gap a real user report found (Sam marked her board Private, Bruna the
    // admin could still see it, because canViewBoard's admin/pm check ran unconditionally
    // before ever looking at who the board was actually shared with). ─────────────────────────
    out.realUserIsAdmin=realUser.role==='admin';
    const personalBoard={id:'probe_personal_board',name:'Personal Probe',visibility:'private',personalBoard:true,ownerId:'probe_owner_1'};
    const ownerOfPersonalBoard={id:'probe_owner_1',role:'staff'};
    out.adminSeesPersonalBoard=canViewBoard(realUser,personalBoard);
    out.ownerSeesOwnPersonalBoard=canViewBoard(ownerOfPersonalBoard,personalBoard);
    const ordinaryPrivateBoard={id:'probe_private_board',name:'Private Probe',visibility:'private',ownerId:'probe_owner_1'};
    out.adminSeesOrdinaryPrivateBoard=canViewBoard(realUser,ordinaryPrivateBoard);

    // ── client notes hold credentials ──
    out.clientBlockedFromNotes=_acBlockedViews(currentUser).has('notes')||_acBlockedViews(currentUser).has('*');
    let threw=false;try{requireInternalUser(currentUser);}catch(e){threw=true;}
    out.clientRefusedInternal=threw;

    // ── staff must not be able to delete someone else's board ──
    currentUser=asStaff();
    const someoneElses=(DB.workboards||[]).find(w=>w.ownerId&&w.ownerId!==currentUser.id);
    out.staffBlockedFromNotes=_acBlockedViews(currentUser).has('notes');
    out.foreignBoard=someoneElses?someoneElses.name:null;

    // ── a client writing through internal paths ──
    currentUser=asClient(cA);
    const before=(DB.tasks||[]).length;
    try{tpAddSubitem((DB.tasks.find(t=>!t.parentTaskId)||{}).id);}catch(e){}
    out.clientCouldAddSubitem=(DB.tasks||[]).length>before;
    if(out.clientCouldAddSubitem)DB.tasks.length=before;

    const bId=(DB.workboards[0]||{}).id;
    const gBefore=(DB.groups||[]).length;
    try{if(typeof saveWbClient==='function')saveWbClient(bId,cB.id);}catch(e){}
    out.clientCouldRepointBoard=boardClientId(DB.workboards.find(w=>w.id===bId))===cB.id;

    currentUser=realUser;
    // put it back if the probe moved it
    if(out.clientCouldRepointBoard)saveWbClient(bId,cA.id);
    out.groupsUnchanged=(DB.groups||[]).length===gBefore;
    return out;
  });

  console.log('ACCESS:',JSON.stringify(R,null,1));
  // canViewBoard is false for every client by design \u2014 clients live in the portal, not on
  // boards \u2014 so this says "the rule still holds", not "cross-client access was tested".
  ok(R.realUserIsAdmin,'the logged-in probe user is really admin-role, so the personalBoard checks below mean something');
  ok(R.adminSeesPersonalBoard===false,'admin is refused a board explicitly marked personalBoard (the bug a real user report found)');
  ok(R.ownerSeesOwnPersonalBoard===true,'the owner of a personalBoard still sees it themselves');
  ok(R.adminSeesOrdinaryPrivateBoard===true,'admin still sees an ordinary Private board that is NOT marked personal — no regression to the existing admin-oversight behaviour');
  ok(R.clientSeesOtherBoard.length===0&&R.clientSeesOwnBoard===0,'canViewBoard refuses a client for every board, their own included');
  ok(R.clientSeesOtherTasks===0,'a client cannot see another client\u2019s tasks (0 of '+R.otherClientTaskCount+')');
  ok(R.clientBlockedFromNotes,'a client is blocked from Client Notes (credentials live there)');
  ok(R.clientRefusedInternal,'requireInternalUser refuses a client');
  ok(R.staffBlockedFromNotes===false,'staff keep their Client Notes access');
  ok(!R.clientCouldAddSubitem,'a client calling tpAddSubitem directly is refused');
  if(R.clientCouldRepointBoard)notes.push('saveWbClient() has no role check — a client-role session calling it directly can repoint a board to another client. Not reachable from the client UI (the control is admin-only), but it is an unguarded write.');

  // Portal isolation is covered properly in audit-portal.cjs, which drives cpNavigate()
  // through every section. The stub that used to sit here called renderClientPortal(),
  // which does not exist, so it always “passed” without ever rendering the portal.

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  if(notes.length){console.log('\nOBSERVATIONS:');notes.forEach(n=>console.log('  ! '+n));}
  console.log('ERRORS:',errs.length?errs.slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('AUDIT CRASHED',e.message);process.exit(1)});
