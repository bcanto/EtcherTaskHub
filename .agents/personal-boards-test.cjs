// Personal Boards — see .agents/PLAN-personal-boards.md. A real user report: Sam marked her
// board Private, but Bruna (admin) could still see it, because canViewBoard's admin/pm bypass
// ran before the board's own visibility was even checked. That earlier fix (canViewBoard itself)
// is covered by mcp-logic-test.cjs and audit-access.cjs; this suite covers everything Phase 1
// added on top: the task-level leak (canViewTask/canEditTask), the sidebar's virtual Personal
// Boards / Shared With Me sections, per-user folder collapse, direct-URL guards, the client
// portal exclusion, and — found live while testing this — personal-board tasks being
// selectable (and their names visible) in the Timesheet's task picker for any staff member.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const path=require('path');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};

// ── Portal exclusion — tested directly against api/_portal.js's own exports (a live HTTP round
// trip through the offline dev server's client-portal auth is not worth reproducing here; the
// module-level functions are exactly what enforces the rule, so this is the real check). ───────
function testPortalExclusion(){
  const portal=require(path.join(__dirname,'..','api','_portal.js'));
  const now=new Date().toISOString();
  // A real personal board is visibility:'private' AND personalBoard:true — both flags, matching
  // index.html's own _isPersonalBoard exactly (checked here, not personalBoard alone).
  const blob={
    clients:[{id:'c1',name:'Acme',portalEnabled:true}],
    boards:[{id:'b1',name:'Sam Personal',clientId:'c1',visibility:'private',personalBoard:true,archived:false,ownerId:'u2'}],
    workboards:[],
    groups:[{id:'g1',boardId:'b1',clientId:'c1',name:'Main'}],
    tasks:[{id:'t1',groupId:'g1',boardId:'b1',clientId:'c1',name:'Secret personal task',archived:false,createdAt:now,updatedAt:now}],
    users:[],staff:[],
  };
  const slice=portal.sliceForClient(blob,'c1','u-client');
  const boardExcluded=!!slice&&!slice.boards.some(b=>b.id==='b1');
  const taskExcluded=!!slice&&!slice.tasks.some(t=>t.id==='t1');
  const directCheck=!portal.taskVisibleTo(blob,'c1',blob.tasks[0]);

  // A board converted BACK from personal to a normal team board (visibility switched to
  // all_internal) keeps a stale personalBoard:true — saveBoardVisibility never clears it. Found
  // in this session's own audit: checking personalBoard alone (not both flags, matching
  // index.html's own _isPersonalBoard) kept such a board wrongly hidden from its client forever.
  const revertedBlob={
    clients:[{id:'c1',name:'Acme',portalEnabled:true}],
    boards:[{id:'b2',name:'Converted Back',clientId:'c1',visibility:'all_internal',personalBoard:true,archived:false,ownerId:'u2'}],
    workboards:[],
    groups:[{id:'g2',boardId:'b2',clientId:'c1',name:'Main'}],
    tasks:[{id:'t2',groupId:'g2',boardId:'b2',clientId:'c1',name:'Now a team task',archived:false,createdAt:now,updatedAt:now}],
    users:[],staff:[],
  };
  const revertedSlice=portal.sliceForClient(revertedBlob,'c1','u-client');
  const revertedBoardVisible=!!revertedSlice&&revertedSlice.boards.some(b=>b.id==='b2');
  const revertedTaskVisible=!!revertedSlice&&revertedSlice.tasks.some(t=>t.id==='t2');

  return{boardExcluded,taskExcluded,directCheck,revertedBoardVisible,revertedTaskVisible};
}
(async()=>{
  const portalResult=testPortalExclusion();
  ok(portalResult.boardExcluded,'sliceForClient excludes a personalBoard even when it carries a real clientId');
  ok(portalResult.taskExcluded,"...and excludes that board's tasks from the client's task list too");
  ok(portalResult.directCheck,'taskVisibleTo itself refuses a task on a personal board, independent of sliceForClient');
  ok(portalResult.revertedBoardVisible,'a board converted BACK to all_internal (stale personalBoard:true left behind) is visible in the portal again, not stuck hidden');
  ok(portalResult.revertedTaskVisible,"...and its tasks come back too — the exclusion checks BOTH flags, matching index.html's own _isPersonalBoard exactly");

  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:1000}});
  const errs=[];

  // ── Fixture: two personal boards (owned by two different staff), one shared board, one
  // ordinary Private (non-personal) board — set up once as an admin session. ───────────────────
  const admin=await b.newPage();await admin.setCacheEnabled(false);
  admin.on('pageerror',e=>errs.push('ADMIN: '+e.message.slice(0,150)));
  await admin.goto('http://localhost:3001/',{waitUntil:'networkidle2'});await new Promise(r=>setTimeout(r,1200));
  await admin.type('#login-email','b.canto@etchersolutions.com');
  await admin.type('#login-password','TaskHub123');
  await admin.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  const setup=await admin.evaluate(()=>{
    const owner=DB.staff.find(s=>s.id!==currentUser.id)||DB.staff[0];
    const other=DB.staff.find(s=>s.id!==owner.id&&s.id!==currentUser.id)||DB.staff[1];
    const now=new Date().toISOString();
    const mkBoard=(id,name,extra)=>({id,name,color:'#0d1c33',visibility:'private',ownerId:owner.id,description:'',archived:false,createdAt:now,updatedAt:now,...extra});
    const personal1={...mkBoard('PBT-personal-1','PBT Personal One',{personalBoard:true})};
    const personal2={...mkBoard('PBT-personal-2','PBT Personal Two — shared',{personalBoard:true})};
    const ordinaryPrivate={...mkBoard('PBT-ordinary-private','PBT Ordinary Private',{personalBoard:false})};
    DB.workboards.push(personal1,personal2,ordinaryPrivate);
    const g1={id:'PBT-g1',boardId:personal1.id,workboardId:personal1.id,clientId:null,name:'Main',order:0,color:'#0d1c33',createdAt:now};
    const g2={id:'PBT-g2',boardId:personal2.id,workboardId:personal2.id,clientId:null,name:'Main',order:0,color:'#0d1c33',createdAt:now};
    const g3={id:'PBT-g3',boardId:ordinaryPrivate.id,workboardId:ordinaryPrivate.id,clientId:null,name:'Main',order:0,color:'#0d1c33',createdAt:now};
    DB.groups.push(g1,g2,g3);
    const t1={id:'PBT-task-1',groupId:g1.id,boardId:personal1.id,workboardId:personal1.id,name:'PBT-SECRET buy birthday gift',status:'todo',ownerId:owner.id,priority:'med',percentComplete:0,createdAt:now,updatedAt:now,archived:false};
    const t2={id:'PBT-task-2',groupId:g2.id,boardId:personal2.id,workboardId:personal2.id,name:'PBT-SHARED task',status:'todo',ownerId:owner.id,priority:'med',percentComplete:0,createdAt:now,updatedAt:now,archived:false};
    const t3={id:'PBT-task-3',groupId:g3.id,boardId:ordinaryPrivate.id,workboardId:ordinaryPrivate.id,name:'PBT-ordinary task',status:'todo',ownerId:owner.id,priority:'med',percentComplete:0,createdAt:now,updatedAt:now,archived:false};
    DB.tasks.push(t1,t2,t3);
    // Share personal2 with `other` (a THIRD person, not admin) — proves sharing one personal
    // board never exposes the other, and that the shared recipient (not admin) can see it.
    if(!DB.boardShares)DB.boardShares=[];
    DB.boardShares.push({id:'PBT-share-1',boardId:personal2.id,userId:other.id});
    saveDB(DB);
    return{ownerId:owner.id,ownerEmail:owner.email,otherId:other.id,otherEmail:other.email};
  });

  // ── Admin (not the owner, not shared): task-level + board-level + URL + timesheet checks ────
  const adminChecks=await admin.evaluate((s)=>{
    const out={};
    const p1=DB.tasks.find(t=>t.id==='PBT-task-1');
    const p1Board=DB.workboards.find(w=>w.id==='PBT-personal-1');
    const ordinaryBoard=DB.workboards.find(w=>w.id==='PBT-ordinary-private');
    const ordinaryTask=DB.tasks.find(t=>t.id==='PBT-task-3');
    out.adminCannotViewBoard=!canViewBoard(currentUser,p1Board);
    out.adminCannotViewTask=!canViewTask(currentUser,p1);
    out.adminCannotEditTask=!canEditTask(currentUser,p1);
    out.adminStillSeesOrdinaryPrivateBoard=canViewBoard(currentUser,ordinaryBoard);
    out.adminStillSeesOrdinaryPrivateTask=canViewTask(currentUser,ordinaryTask);
    // Deep-link / direct-URL guard
    const before=document.getElementById('task-panel')?.innerHTML;
    openTaskPanel('PBT-task-1');
    out.taskPanelRefused=!_tpCurrentTask||_tpCurrentTask.id!=='PBT-task-1';
    // openTaskModal must refuse too (older code path, same class of gap)
    const modalBefore=editingTaskId;
    openTaskModal('PBT-task-1');
    out.taskModalRefused=editingTaskId!==('PBT-task-1');
    editingTaskId=modalBefore;
    // Timesheet task picker: personal-board tasks must not be offered or searchable by name
    navigate('time');
    const items=window._teTaskAllItems||[];
    out.pickerBuilt=items.length>0;
    out.pickerExcludesPersonal=!items.some(x=>x.id==='PBT-task-1');
    out.pickerExcludesSharedPersonal=!items.some(x=>x.id==='PBT-task-2');
    out.pickerIncludesOrdinaryPrivate=items.some(x=>x.id==='PBT-task-3');
    return out;
  },setup);
  ok(adminChecks.adminCannotViewBoard,'admin cannot canViewBoard a personalBoard they do not own/share');
  ok(adminChecks.adminCannotViewTask,'admin cannot canViewTask a task ON a personalBoard (the actual leak this session found and fixed)');
  ok(adminChecks.adminCannotEditTask,'admin cannot canEditTask a task on a personalBoard either');
  ok(adminChecks.adminStillSeesOrdinaryPrivateBoard,'admin still sees an ordinary (non-personal) Private board — no regression');
  ok(adminChecks.adminStillSeesOrdinaryPrivateTask,'admin still sees tasks on an ordinary Private board — no regression');
  ok(adminChecks.taskPanelRefused,'openTaskPanel refuses to open a task on a personalBoard the caller cannot view');
  ok(adminChecks.taskModalRefused,'openTaskModal (the older task-edit surface) refuses the same task');
  ok(adminChecks.pickerBuilt,'the Timesheet view actually populated its task-picker list (sanity — otherwise the exclusion checks below are vacuous)');
  ok(adminChecks.pickerExcludesPersonal,'the Timesheet task picker never offers a personal-board task at all');
  ok(adminChecks.pickerExcludesSharedPersonal,"a personal board shared with a THIRD person still never appears in admin's own picker");
  ok(adminChecks.pickerIncludesOrdinaryPrivate,'the picker still includes tasks on an ordinary (non-personal) board — no over-reach');

  // ── Sidebar, as the owner and as a third shared user — swapping `currentUser` in place in the
  // SAME page/localStorage, the established pattern this repo's own audit-access.cjs already
  // uses for cross-role checks. Plain Task Hub's --offline mode persists to localStorage per
  // browser (unlike ISO's own separate server-side offline store), so a genuinely fresh
  // browser.createBrowserContext() would boot with none of this fixture's data at all — that
  // approach is for ISO suites only; this is the correct one for plain Task Hub. ───────────────
  const roleSwapChecks=await admin.evaluate((s)=>{
    const realUser=currentUser;
    const out={};

    currentUser=DB.staff.find(u=>u.id===s.ownerId);
    renderSidebarWorkboards();
    let txt=document.getElementById('sidebar-wb-list')?.innerText||'';
    out.ownerHasSection=/Personal Boards/i.test(txt);
    out.ownerHasBoard=txt.includes('PBT Personal One');
    out.ownerHasSecondBoard=txt.includes('PBT Personal Two');

    currentUser=DB.staff.find(u=>u.id===s.otherId);
    renderSidebarWorkboards();
    txt=document.getElementById('sidebar-wb-list')?.innerText||'';
    out.otherHasSharedSection=/Shared With Me/i.test(txt);
    out.otherHasSharedBoard=txt.includes('PBT Personal Two');
    out.otherLacksOtherPersonal=!txt.includes('PBT Personal One');
    out.otherCanViewShared=canViewBoard(currentUser,DB.workboards.find(w=>w.id==='PBT-personal-2'));
    out.otherCannotViewOther=!canViewBoard(currentUser,DB.workboards.find(w=>w.id==='PBT-personal-1'));

    currentUser=realUser;
    renderSidebarWorkboards(); // restore admin's own sidebar before the checks below
    return out;
  },setup);
  ok(roleSwapChecks.ownerHasSection,"the owner's sidebar shows a Personal Boards section");
  ok(roleSwapChecks.ownerHasBoard,'the owner sees their own personal board listed in it');
  ok(roleSwapChecks.ownerHasSecondBoard,'the owner sees BOTH of their personal boards');
  ok(roleSwapChecks.otherHasSharedSection,'a user shared on one personal board sees a "Shared With Me" section');
  ok(roleSwapChecks.otherHasSharedBoard,'…and the specific board shared with them is in it');
  ok(roleSwapChecks.otherLacksOtherPersonal,"…but NOT the owner's OTHER personal board — sharing one never exposes the rest");
  ok(roleSwapChecks.otherCanViewShared&&roleSwapChecks.otherCannotViewOther,'canViewBoard agrees: yes to the shared one, no to the other');

  // ── Sidebar, from admin's own session — must show neither personal board nor "Shared With
  // Me" (admin was never shared on anything here), and a team folder containing ONLY a hidden
  // personal-ish setup must not appear for them. ─────────────────────────────────────────────
  const adminSidebar=await admin.evaluate(()=>{
    renderSidebarWorkboards();
    const txt=document.getElementById('sidebar-wb-list')?.innerText||'';
    return{lacksBoard1:!txt.includes('PBT Personal One'),lacksBoard2:!txt.includes('PBT Personal Two'),
      hasOwnPersonalSection:/Personal Boards/.test(txt)}; // admin's OWN (empty or otherwise) section is fine/expected
  });
  ok(adminSidebar.lacksBoard1&&adminSidebar.lacksBoard2,"admin's sidebar shows neither of Sam's personal boards");

  // ── Per-user folder collapse: collapsing as admin must not affect how the SAME folder reads
  // for a different user id (localStorage key is scoped by viewer id — see
  // _wbFolderCollapseKey). Swapping currentUser proves the isolation without needing a second,
  // separately-stored browser session. ─────────────────────────────────────────────────────────
  const folderChecks=await admin.evaluate((s)=>{
    const realUser=currentUser;
    if(!DB.wbFolders)DB.wbFolders=[];
    let f=DB.wbFolders.find(x=>x.id==='PBT-folder-1');
    if(!f){f={id:'PBT-folder-1',name:'PBT Team Folder',collapsed:false,order:DB.wbFolders.length,ownerId:currentUser.id};DB.wbFolders.push(f);}
    const wb=DB.workboards.find(w=>w.id==='PBT-ordinary-private');
    if(wb)wb.folderId='PBT-folder-1';
    saveDB(DB);
    toggleWbFolder('PBT-folder-1'); // admin (realUser) collapses it
    const adminCollapsedAfterToggle=_wbFolderCollapsed(f);
    currentUser=DB.staff.find(u=>u.id===s.ownerId);
    const ownerSeesCollapsed=_wbFolderCollapsed(f);
    currentUser=realUser;
    return{adminCollapsedAfterToggle,ownerSeesCollapsed};
  },setup);
  ok(folderChecks.adminCollapsedAfterToggle,'toggling a folder collapses it for the toggling user');
  ok(!folderChecks.ownerSeesCollapsed,"a DIFFERENT user's view of the same folder is unaffected by admin's collapse (per-user, not shared)");

  // ── The Personal Boards section header itself must also collapse, same per-viewer scheme ──
  const personalSectionChecks=await admin.evaluate(()=>{
    const before=_personalSectionCollapsed();
    toggleWbPersonalSection();
    const afterToggle=_personalSectionCollapsed();
    toggleWbPersonalSection();
    const afterToggleBack=_personalSectionCollapsed();
    return{before,afterToggle,afterToggleBack};
  });
  ok(!personalSectionChecks.before,'Personal Boards section starts expanded by default');
  ok(personalSectionChecks.afterToggle,'toggling the Personal Boards header collapses the section');
  ok(!personalSectionChecks.afterToggleBack,'toggling it again re-expands the section');

  // ── saveBoardPersonal: only the owner may toggle it, not admin — found in this session's own
  // audit: admin bypasses canViewBoard for every board except one marked personalBoard, so an
  // admin ticking this on someone ELSE's board instantly lost their own access to the very
  // board+modal they were just editing (self-lockout), while also imposing a privacy choice on
  // a board that was never theirs to decide. ─────────────────────────────────────────────────
  const ownerOnlyChecks=await admin.evaluate((s)=>{
    const now=new Date().toISOString();
    DB.workboards.push({id:'PBT-toggle-board',name:'PBT Toggle Probe',color:'#000',visibility:'private',ownerId:s.ownerId,archived:false,createdAt:now,updatedAt:now});
    const before=canViewBoard(currentUser,DB.workboards.find(w=>w.id==='PBT-toggle-board'));
    saveBoardPersonal('PBT-toggle-board',true); // admin (currentUser) is NOT the owner
    const wb=DB.workboards.find(w=>w.id==='PBT-toggle-board');
    const after=canViewBoard(currentUser,wb);
    const out={adminToggleRejected:wb.personalBoard!==true,adminStillSeesBoard:before===true&&after===true};
    DB.workboards=DB.workboards.filter(w=>w.id!=='PBT-toggle-board');DB.boards=DB.workboards;
    saveDB(DB);
    return out;
  },setup);
  ok(ownerOnlyChecks.adminToggleRejected,"admin cannot toggle personalBoard on a board they don't own — saveBoardPersonal silently refuses");
  ok(ownerOnlyChecks.adminStillSeesBoard,'…and admin keeps seeing the board afterward — no self-lockout');

  // ── A board move survives sync (user report 2026-10-06: Sam's board moved on one computer
  // stayed in the old folder on hers). Moves and access changes were unstamped, and _mergeDB's
  // mergeById keeps the local copy unless the incoming one is NEWER — so each computer kept its
  // own version forever. Simulated: this browser makes the change, a stale peer copy merges in. ──
  const syncChecks=await admin.evaluate(()=>{
    const old='2026-01-01T00:00:00.000Z';
    DB.wbFolders=DB.wbFolders||[];
    DB.wbFolders.push({id:'PBT-sync-folder',name:'PBT Sync Folder',collapsed:false,order:99,ownerId:currentUser.id});
    DB.workboards.push({id:'PBT-sync-a',name:'PBT Sync A',color:'#000',visibility:'all_internal',ownerId:currentUser.id,folderId:'PBT-sync-folder',order:0,archived:false,createdAt:old,updatedAt:old});
    DB.workboards.push({id:'PBT-sync-b',name:'PBT Sync B',color:'#000',visibility:'all_internal',ownerId:currentUser.id,folderId:null,order:0,archived:false,createdAt:old,updatedAt:old});
    const stale=JSON.parse(JSON.stringify(DB)); // the other computer's copy, before the change
    moveWbToFolder('PBT-sync-a',null);                 // drop on empty space
    saveBoardVisibility('PBT-sync-b','private');       // an access change
    document.getElementById('generic-modal')?.classList.add('hidden');
    const merged=_mergeDB(JSON.parse(JSON.stringify(DB)),stale);   // stale copy arrives here
    const peer=_mergeDB(stale,JSON.parse(JSON.stringify(DB)));     // our copy arrives at the peer
    const get=(db,id)=>db.workboards.find(w=>w.id===id)||{};
    // Row drop (re-order onto a row in another folder) stamps too.
    const st2=JSON.parse(JSON.stringify(DB));
    _wbDragId='PBT-sync-b';
    _wbRowDrop({preventDefault(){},stopPropagation(){},currentTarget:{classList:{contains:()=>false}}},'PBT-sync-a','');
    const rowDropKept=get(_mergeDB(JSON.parse(JSON.stringify(DB)),st2),'PBT-sync-b').updatedAt!==old;
    renderSidebarWorkboards();
    const teamHead=[...document.querySelectorAll('#sidebar-wb-list .sb-team-boards-h')].map(e=>e.textContent.trim());
    return {
      moveStamped:get(DB,'PBT-sync-a').updatedAt>old,
      moveSurvivesStale:get(merged,'PBT-sync-a').folderId===null,
      moveReachesPeer:get(peer,'PBT-sync-a').folderId===null,
      visReachesPeer:get(peer,'PBT-sync-b').visibility==='private',
      rowDropKept, teamHead,
    };
  });
  ok(syncChecks.moveStamped,'moving a board between folders stamps its updatedAt');
  ok(syncChecks.moveSurvivesStale,'a stale copy from another computer no longer pulls the board back into its old folder');
  ok(syncChecks.moveReachesPeer,'…and the move wins on the other computer too (it is now the newer copy)');
  ok(syncChecks.visReachesPeer,'an access change (visibility) reaches the other computer instead of being kept stale');
  ok(syncChecks.rowDropKept,'dropping a board onto a row stamps it as well');
  ok(JSON.stringify(syncChecks.teamHead)==='["Team Boards"]',`team boards outside a folder sit under their own "Team Boards" heading, not under Personal Boards (got ${JSON.stringify(syncChecks.teamHead)})`);

  // ── doLogout resets the tab title/favicon bubble — found live: a regular (non-portal) logout
  // never reloads the page, so nothing else would clear a previous session's unread indicator,
  // leaving it visible on the login screen (misleading on a shared machine). ──────────────────
  const logoutCheck=await admin.evaluate(()=>{
    DB.notifications.push({id:'PBT-logout-probe',recipientId:currentUser.id,taskId:null,type:'assigned',read:false,message:'logout probe',createdAt:new Date().toISOString()});
    updateNotifBadge();
    const titleBefore=document.title;
    const faviconBeforeIsBubble=document.getElementById('app-favicon').getAttribute('href').startsWith('data:');
    doLogout();
    const out={
      titleHadCount:/^\(\d+\)/.test(titleBefore),
      titleResetAfterLogout:document.title===titleBefore.replace(/^\(\d+\)\s*/,''),
      faviconHadBubble:faviconBeforeIsBubble,
      faviconResetAfterLogout:!document.getElementById('app-favicon').getAttribute('href').startsWith('data:'),
    };
    DB.notifications=DB.notifications.filter(n=>n.id!=='PBT-logout-probe');
    return out;
  });
  ok(logoutCheck.titleHadCount,'sanity: the tab title really did carry an unread-count prefix before logging out');
  ok(logoutCheck.titleResetAfterLogout,'doLogout() clears the unread-count prefix from the tab title');
  ok(logoutCheck.faviconHadBubble,'sanity: the favicon really did show a drawn bubble before logging out');
  ok(logoutCheck.faviconResetAfterLogout,'doLogout() reverts the favicon to the plain static file, not a stale bubble');
  // doLogout genuinely logged us out — log back in as admin so the cleanup step below (and
  // anything after this suite in the same gate run) still has a real session to work with.
  await admin.type('#login-email','b.canto@etchersolutions.com');
  await admin.type('#login-password','TaskHub123');
  await admin.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  // ── Cleanup ──────────────────────────────────────────────────────────────────────────────
  await admin.evaluate(()=>{
    DB.tasks=DB.tasks.filter(t=>!/^PBT-/.test(t.id));
    DB.workboards=DB.workboards.filter(w=>!/^PBT-/.test(w.id));DB.boards=DB.workboards;
    DB.groups=DB.groups.filter(g=>!/^PBT-/.test(g.id));
    DB.boardShares=(DB.boardShares||[]).filter(s=>!/^PBT-/.test(s.id));
    DB.wbFolders=(DB.wbFolders||[]).filter(f=>!/^PBT-/.test(f.id));
    saveDB(DB);
  });
  try{localStorage;}catch(e){}

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,5):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: '+e.message);process.exit(1)});
