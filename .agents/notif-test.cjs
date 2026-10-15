const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const H=require('./_iso-harness.cjs');
let srv=null;
(async()=>{
  // Its own offline server and temp ISO store. clearAllNotifs() also clears the user's ISO notifications
  // server-side (ISO 7.6), so on the shared :3001 server every gate run dismissed the real ones in
  // .iso-offline (caught by the store fingerprint, 2026-10-15).
  srv=await H.startOffline(3176);
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
  await p.goto(`http://127.0.0.1:${srv.port}/`,{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // Throwaway board + group + tasks so we never touch real data.
  await p.evaluate(()=>{
    const id='wb-notiftest';
    DB.boards.push({id,name:'NotifTest Board',color:'#97bcbd',clientId:DB.clients[0].id,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    DB.workboards=DB.boards;
    DB.groups.push({id:'g-notiftest',name:'G',boardId:id,workboardId:id,clientId:DB.clients[0].id});
    DB.tasks.push({id:'t-notif-top',name:'Top task',boardId:id,workboardId:id,groupId:'g-notiftest',status:'todo',priority:'med'});
    DB.tasks.push({id:'t-notif-sub',name:'Sub task',parentTaskId:'t-notif-top',boardId:id,workboardId:id,groupId:'g-notiftest',status:'todo',priority:'med'});
    DB.tasks.push({id:'t-notif-arch',name:'Archived task',boardId:id,workboardId:id,groupId:'g-notiftest',status:'todo',priority:'med',archived:true});
    saveDB(DB);
  });

  // ── 1. Merge-level regression: the exact race that resurrected a dismissed notification.
  // `current` = this client's outgoing save (notification already removed, tombstoned).
  // `incoming` = a stale server row that hasn't seen the delete yet (still has it, no tombstone).
  // Before the fix, unionById(current.notifications, incoming.notifications) put it right back.
  const mergeResult=await p.evaluate(()=>{
    const current={notifications:[{id:'n-keep',recipientId:'u1',message:'keep me'}],deletedNotificationIds:['n-gone']};
    const incoming={notifications:[{id:'n-keep',recipientId:'u1',message:'keep me'},{id:'n-gone',recipientId:'u1',message:'stale, should stay dead'}],deletedNotificationIds:[]};
    const merged=_mergeDB(current,incoming);
    return{ids:merged.notifications.map(n=>n.id).sort(),tombstones:merged.deletedNotificationIds};
  });
  console.log('MERGE:',JSON.stringify(mergeResult));
  ok(!mergeResult.ids.includes('n-gone'),'_mergeDB does not resurrect a tombstoned notification from a stale incoming copy');
  ok(mergeResult.ids.includes('n-keep'),'_mergeDB keeps a notification both sides agree on');
  ok(mergeResult.tombstones.includes('n-gone'),'_mergeDB carries the deletedNotificationIds tombstone forward');

  // ── 2. notifDismiss records a tombstone (not just a local filter).
  const dismissResult=await p.evaluate(()=>{
    DB.notifications=DB.notifications||[];
    DB.notifications.push({id:'n-dismiss-test',recipientId:currentUser.id,type:'task_assigned',message:'x',read:false,createdAt:new Date().toISOString()});
    notifDismiss('n-dismiss-test');
    return{
      gone:!DB.notifications.some(n=>n.id==='n-dismiss-test'),
      tombstoned:(DB.deletedNotificationIds||[]).includes('n-dismiss-test')
    };
  });
  console.log('DISMISS:',JSON.stringify(dismissResult));
  ok(dismissResult.gone,'notifDismiss removes the notification');
  ok(dismissResult.tombstoned,'notifDismiss records it in deletedNotificationIds');

  // ── 3. clearAllNotifs records a tombstone for every notification it clears.
  const clearResult=await p.evaluate(()=>{
    DB.notifications.push({id:'n-clear-1',recipientId:currentUser.id,type:'task_assigned',message:'a',read:false,createdAt:new Date().toISOString()});
    DB.notifications.push({id:'n-clear-2',recipientId:currentUser.id,type:'task_assigned',message:'b',read:false,createdAt:new Date().toISOString()});
    clearAllNotifs();
    const ts=new Set(DB.deletedNotificationIds||[]);
    return{
      gone:!DB.notifications.some(n=>n.id==='n-clear-1'||n.id==='n-clear-2'),
      tombstoned:ts.has('n-clear-1')&&ts.has('n-clear-2')
    };
  });
  console.log('CLEAR ALL:',JSON.stringify(clearResult));
  ok(clearResult.gone,'clearAllNotifs removes every one of the user\'s notifications');
  ok(clearResult.tombstoned,'clearAllNotifs tombstones every id it removes');

  // ── 4. Rendered row wires onclick to notifGoToTask (catches a stale/typo'd handler name).
  const rendered=await p.evaluate(()=>{
    DB.notifications.push({id:'n-render-test',recipientId:currentUser.id,taskId:'t-notif-top',type:'task_assigned',message:'render me',read:false,createdAt:new Date().toISOString()});
    const html=renderNotifications();
    DB.notifications=DB.notifications.filter(n=>n.id!=='n-render-test');
    return html;
  });
  ok(/notifGoToTask\('n-render-test','t-notif-top'\)/.test(rendered),'notification row onclick calls notifGoToTask(notifId, taskId)');

  // ── 5. Click-through navigation: top-level task on a different board than the one open.
  await p.evaluate(()=>{currentWorkboard=null;navigate('dashboard');});
  await new Promise(r=>setTimeout(r,300));
  const topNav=await p.evaluate(()=>{
    notifGoToTask('none','t-notif-top');
    return true;
  });
  await new Promise(r=>setTimeout(r,400));
  const topState=await p.evaluate(()=>({
    board:currentWorkboard&&currentWorkboard.id,
    view:currentView,
    rowPresent:!!document.querySelector('tr[data-tid="t-notif-top"]'),
    rowFlashing:document.querySelector('tr[data-tid="t-notif-top"]')?.classList.contains('ws-row-jump'),
    panelOpen:document.getElementById('task-panel').style.display==='flex',
    panelTask:_tpCurrentTask&&_tpCurrentTask.id
  }));
  console.log('TOP-LEVEL NAV:',JSON.stringify(topState));
  ok(topState.board==='wb-notiftest','clicking the notification switches to the task\'s own board');
  ok(topState.view==='workspace','lands on the Main Table view');
  ok(topState.rowPresent,'the task\'s row is in the DOM');
  ok(topState.rowFlashing,'the row gets the jump/highlight treatment');
  ok(topState.panelOpen&&topState.panelTask==='t-notif-top','the task panel opens on the right task');
  await p.screenshot({path:'temporary screenshots/notif-goto-top.png'});

  // ── 6. Subitem: parent must auto-expand so the child row exists.
  await p.evaluate(()=>{closeTaskPanel();currentWorkboard=null;navigate('dashboard');wsExpanded=new Set();});
  await new Promise(r=>setTimeout(r,300));
  await p.evaluate(()=>{notifGoToTask('none','t-notif-sub');});
  await new Promise(r=>setTimeout(r,400));
  const subState=await p.evaluate(()=>({
    parentExpanded:wsExpanded.has('t-notif-top'),
    rowPresent:!!document.querySelector('tr[data-tid="t-notif-sub"]'),
    topRowPresent:!!document.querySelector('tr[data-tid="t-notif-top"]'),
    panelTask:_tpCurrentTask&&_tpCurrentTask.id,
    childInDb:DB.tasks.some(t=>t.id==='t-notif-sub'&&t.parentTaskId==='t-notif-top'),
    childArchived:DB.tasks.find(t=>t.id==='t-notif-sub')?.archived,
    board:currentWorkboard&&currentWorkboard.id,
    view:currentView
  }));
  console.log('SUBITEM NAV:',JSON.stringify(subState));
  ok(subState.parentExpanded,'jumping to a subitem expands its parent');
  ok(subState.rowPresent,'the subitem row is in the DOM');
  ok(subState.panelTask==='t-notif-sub','the task panel opens on the subitem');

  // ── 7. Archived task: must flip on Show Archived, or the row can never render.
  await p.evaluate(()=>{closeTaskPanel();wsShowArchived=false;});
  await new Promise(r=>setTimeout(r,200));
  await p.evaluate(()=>{notifGoToTask('none','t-notif-arch');});
  await new Promise(r=>setTimeout(r,400));
  const archState=await p.evaluate(()=>({
    showArchived:wsShowArchived,
    rowPresent:!!document.querySelector('tr[data-tid="t-notif-arch"]')
  }));
  console.log('ARCHIVED NAV:',JSON.stringify(archState));
  ok(archState.showArchived,'jumping to an archived task turns on Show Archived');
  ok(archState.rowPresent,'the archived task\'s row is in the DOM');

  // ── 8. A stale filter that would otherwise hide the target must not survive the jump.
  await p.evaluate(()=>{closeTaskPanel();wsShowArchived=false;activeFilters.statuses=['done'];saveFilters();});
  await new Promise(r=>setTimeout(r,200));
  await p.evaluate(()=>{notifGoToTask('none','t-notif-top');});
  await new Promise(r=>setTimeout(r,400));
  const filterState=await p.evaluate(()=>({
    statuses:activeFilters.statuses,
    rowPresent:!!document.querySelector('tr[data-tid="t-notif-top"]')
  }));
  console.log('FILTER RESET:',JSON.stringify(filterState));
  ok(filterState.statuses.length===0,'a stale status filter is cleared by the jump');
  ok(filterState.rowPresent,'the row renders once the filter is out of the way');

  // ── 9. Browser-tab title/favicon bubble — the sidebar badge is invisible whenever this tab
  // isn't the one on screen, which is exactly when a new notification is easiest to miss.
  const tabBefore=await p.evaluate(()=>{
    const before=DB.notifications.filter(n=>n.recipientId===currentUser.id&&!n.read).length;
    return{title:document.title,baseTitle:_tabBaseTitle,before,
      faviconBefore:document.getElementById('app-favicon').getAttribute('href')};
  });
  console.log('TAB BUBBLE (before probe):',JSON.stringify(tabBefore));
  ok(tabBefore.title===(tabBefore.before>0?`(${tabBefore.before}) ${tabBefore.baseTitle}`:tabBefore.baseTitle),
    'document.title already reflects the real unread count on load, off the one true base title');
  ok(tabBefore.faviconBefore.startsWith('data:')===(tabBefore.before>0),
    'the favicon already shows a bubble exactly when there is real unread mail, and only then');

  await p.evaluate(()=>{
    DB.notifications.push({id:'n-tabbubble-probe',recipientId:currentUser.id,taskId:null,type:'assigned',read:false,message:'Tab bubble probe',createdAt:new Date().toISOString()});
    updateNotifBadge();
  });
  // Favicon redraw goes through an Image().onload, not synchronous — give it a moment.
  await new Promise(r=>setTimeout(r,300));
  const tabWithUnread=await p.evaluate(()=>({
    title:document.title,
    favicon:document.getElementById('app-favicon').getAttribute('href'),
  }));
  console.log('TAB BUBBLE (with probe):',JSON.stringify(tabWithUnread));
  ok(tabWithUnread.title===`(${tabBefore.before+1}) ${tabBefore.baseTitle}`,
    `adding one more unread notification bumps the title's count by exactly one (got "${tabWithUnread.title}")`);
  ok(tabWithUnread.favicon.startsWith('data:image/png'),'the favicon is redrawn with a bubble once there is an unread notification');

  await p.evaluate(()=>{
    DB.notifications=DB.notifications.filter(n=>n.id!=='n-tabbubble-probe');
    updateNotifBadge();
  });
  await new Promise(r=>setTimeout(r,300));
  const tabAfter=await p.evaluate(()=>({
    title:document.title,
    favicon:document.getElementById('app-favicon').getAttribute('href'),
  }));
  console.log('TAB BUBBLE (after cleanup):',JSON.stringify(tabAfter));
  ok(tabAfter.title===tabBefore.title,'removing the probe notification restores the exact original title');
  ok(tabAfter.favicon===tabBefore.faviconBefore,'removing the probe notification restores the exact original favicon state (bubble or plain, whichever it truly was before)');

  // Cleanup: leave no trace in real data.
  await p.evaluate(()=>{
    closeTaskPanel();
    DB.boards=DB.boards.filter(w=>w.id!=='wb-notiftest');DB.workboards=DB.boards;
    DB.groups=DB.groups.filter(g=>g.id!=='g-notiftest');
    DB.tasks=DB.tasks.filter(t=>!['t-notif-top','t-notif-sub','t-notif-arch'].includes(t.id));
    DB.notifications=(DB.notifications||[]).filter(n=>!['n-keep','n-gone'].includes(n.id));
    activeFilters.statuses=[];saveFilters();
    wsShowArchived=false;currentWorkboard=null;
    saveDB(DB);
    navigate('dashboard');
  });

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();srv.stop();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);if(srv)srv.stop();process.exit(1)});
