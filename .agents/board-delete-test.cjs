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

  // Make a throwaway board with tasks so we never touch real data
  const made=await p.evaluate(()=>{
    const id='wb-deltest';
    const wb={id,name:'DeleteTest Board',color:'#97bcbd',clientId:DB.clients[0].id,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,description:'',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    DB.boards.push(wb);DB.workboards=DB.boards;
    const g={id:'g-deltest',name:'G',boardId:id,workboardId:id,clientId:DB.clients[0].id};
    DB.groups.push(g);
    for(let i=0;i<3;i++)DB.tasks.push({id:'t-deltest'+i,name:'Temp '+i,boardId:id,workboardId:id,groupId:g.id,status:'todo',priority:'med'});
    saveDB(DB);
    openWorkboard(id);
    return {id,tasks:3};
  });
  await new Promise(r=>setTimeout(r,1400));

  // 1. menu button present in the Main Table tab strip
  const btn=await p.evaluate(()=>{
    const b=document.querySelector('.wb-menu-btn');
    if(!b)return null;
    const r=b.getBoundingClientRect();
    return {visible:r.height>0,top:Math.round(r.top),left:Math.round(r.left)};
  });
  ok(btn&&btn.visible,'board ⋯ menu button visible in Main Table tab strip');

  // 2. menu opens with Archive + Delete
  await p.evaluate(()=>document.querySelector('.wb-menu-btn').click());
  await new Promise(r=>setTimeout(r,400));
  const menu=await p.evaluate(()=>{
    const m=document.getElementById('wb-board-menu');
    if(!m)return null;const r=m.getBoundingClientRect();
    return {display:getComputedStyle(m).display,
      items:[...m.querySelectorAll('.tp-more-item')].map(i=>i.textContent.trim()),
      inViewport:r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth};
  });
  console.log('MENU:',JSON.stringify(menu));
  ok(menu&&menu.display==='block','menu opens');
  ok(menu&&menu.items.length===2,'menu has Archive + Delete');
  ok(menu&&/3 tasks/.test(menu.items[1]||''),'Delete item shows the task count');
  ok(menu&&menu.inViewport,'menu stays inside the viewport');
  await p.screenshot({path:'temporary screenshots/board-menu.png'});

  // 3. delete opens a confirm naming the board + task count
  await p.evaluate(()=>{
    [...document.querySelectorAll('#wb-board-menu .tp-more-item')].find(i=>/Delete board/.test(i.textContent)).click();
  });
  await new Promise(r=>setTimeout(r,500));
  const confirmTxt=await p.evaluate(()=>{
    const m=document.getElementById('confirm-modal');
    return {open:!m.classList.contains('hidden'),msg:document.getElementById('confirm-msg').textContent};
  });
  console.log('CONFIRM:',JSON.stringify(confirmTxt));
  ok(confirmTxt.open,'delete opens a confirmation');
  ok(/DeleteTest Board/.test(confirmTxt.msg)&&/\b3\b.*tasks/.test(confirmTxt.msg),'confirmation names the board and task count');

  // 4. confirm actually deletes and drops you out of the board
  await p.evaluate(()=>document.getElementById('confirm-ok-btn').click());
  await new Promise(r=>setTimeout(r,1200));
  const after=await p.evaluate(()=>({
    boardGone:!DB.boards.some(w=>w.id==='wb-deltest'),
    tasksGone:!DB.tasks.some(t=>(t.boardId||t.workboardId)==='wb-deltest'),
    groupsGone:!DB.groups.some(g=>(g.boardId||g.workboardId)==='wb-deltest'),
    currentCleared:currentWorkboard===null,
    view:currentView,
    audited:(DB.auditLog||[]).some(a=>a.entityId==='wb-deltest'&&a.action==='deleted'),
    tabStripGone:!document.querySelector('.wb-menu-btn')
  }));
  console.log('AFTER DELETE:',JSON.stringify(after));
  ok(after.boardGone,'board removed');
  ok(after.tasksGone&&after.groupsGone,'its tasks and groups removed');
  ok(after.currentCleared,'currentWorkboard cleared (no phantom board)');
  ok(after.view==='dashboard','navigated out to dashboard');
  ok(after.audited,'delete written to the audit log');

  // 5. non-owner staff must not see the menu
  const staffCheck=await p.evaluate(()=>{
    const id='wb-permtest';
    DB.boards.push({id,name:'Perm Board',color:'#97bcbd',clientId:DB.clients[0].id,
      ownerId:'someone-else',visibility:'all_internal',archived:false,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    DB.workboards=DB.boards;
    const realRole=currentUser.role;
    currentUser.role='staff';
    openWorkboard(id);
    const seen=!!document.querySelector('.wb-menu-btn');
    // and the function itself must refuse
    let blocked=false;
    const o=window.showAlert;window.showAlert=()=>{blocked=true;};
    deleteWorkboard(id);
    window.showAlert=o;
    const stillThere=DB.boards.some(w=>w.id===id);
    currentUser.role=realRole;
    DB.boards=DB.boards.filter(w=>w.id!==id);DB.workboards=DB.boards;
    currentWorkboard=null;
    return {menuSeen:seen,refused:blocked,boardSurvived:stillThere};
  });
  console.log('STAFF NON-OWNER:',JSON.stringify(staffCheck));
  ok(!staffCheck.menuSeen,'non-owner staff does not see the board menu');
  ok(staffCheck.refused&&staffCheck.boardSurvived,'deleteWorkboard refuses a non-owner even if called directly');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
