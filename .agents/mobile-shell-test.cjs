const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  // Plain narrow viewport, not Chrome's device-emulation mode: isMobile/hasTouch apply a
  // deviceScaleFactor that desyncs window.innerHeight from Puppeteer's own click coordinate
  // space, making real, correctly-positioned elements read as "not clickable". The
  // max-width:768px media query only cares about width in CSS px, which this gives it.
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:393,height:852}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,200));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // This dev server's browser profile is not guaranteed fresh between runs (other test
  // suites, or an earlier run of this one, can leave a board open in sessionStorage). Start
  // every run from a known dashboard state rather than assume isolation the environment does
  // not actually give us.
  await p.evaluate(()=>{try{sessionStorage.removeItem('etcher_last_nav');}catch(_){}currentWorkboard=null;navigate('dashboard');});
  await new Promise(r=>setTimeout(r,300));

  // ---- Shell: drawer closed by default, hamburger opens it, scrim closes it ----
  const shell1=await p.evaluate(()=>{
    const sb=document.getElementById('sidebar');
    const r=sb.getBoundingClientRect();
    return{offscreen:r.right<=0,menuBtnVisible:getComputedStyle(document.getElementById('mobile-menu-btn')).display!=='none'};
  });
  ok(shell1.offscreen,'sidebar starts off-screen on a 393px viewport');
  ok(shell1.menuBtnVisible,'hamburger button is visible under 768px');

  await p.click('#mobile-menu-btn');await new Promise(r=>setTimeout(r,350));
  const shell2=await p.evaluate(()=>{
    const sb=document.getElementById('sidebar');
    return{onscreen:sb.getBoundingClientRect().left===0,scrimVisible:getComputedStyle(document.getElementById('mobile-scrim')).display!=='none'};
  });
  ok(shell2.onscreen,'tapping the hamburger slides the sidebar on-screen');
  ok(shell2.scrimVisible,'the scrim is visible while the drawer is open');

  // #mobile-scrim spans the full viewport; its bounding-box CENTER (Puppeteer's default
  // click point) sits under the open 215px drawer, which has the higher z-index and
  // correctly intercepts taps there — a real thumb would hit the drawer's own content at
  // that point too. Click an offset actually clear of the drawer, as a real dismiss tap would.
  const scrimEl=await p.$('#mobile-scrim');
  await scrimEl.click({offset:{x:350,y:400}});await new Promise(r=>setTimeout(r,350));
  const shell3=await p.evaluate(()=>document.getElementById('sidebar').getBoundingClientRect().right<=0);
  ok(shell3,'tapping the scrim (clear of the drawer) closes it again');

  // ---- Bottom tab bar exists and has real tabs ----
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('.mobile-tab')].map(b=>b.textContent.trim()));
  ok(tabs.length>=2,'bottom tab bar has at least 2 tabs (got '+JSON.stringify(tabs)+')');
  ok(tabs.some(t=>/Board/.test(t)),'Board tab present');
  ok(tabs.some(t=>/More/.test(t)),'More tab present');

  // ---- Board FAB + quick-add sheet, only while on a board ----
  const beforeBoard=await p.evaluate(()=>getComputedStyle(document.getElementById('mobile-board-fab')).display);
  ok(beforeBoard==='none','board FAB hidden before entering a board');

  // Open the first board via the nav drawer (same click path a user takes)
  await p.click('#mobile-menu-btn');await new Promise(r=>setTimeout(r,300));
  const wbClicked=await p.evaluate(()=>{
    const row=document.querySelector('[data-wb-row]');
    if(!row)return false;
    row.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return true;
  });
  await new Promise(r=>setTimeout(r,600));
  ok(wbClicked,'a board exists to open in this dataset');

  const onBoard=await p.evaluate(()=>({
    fabVisible:getComputedStyle(document.getElementById('mobile-board-fab')).display!=='none',
    bodyClass:document.body.classList.contains('on-board-view'),
  }));
  ok(onBoard.bodyClass,'body gets on-board-view class after opening a board');
  ok(onBoard.fabVisible,'board FAB becomes visible once on a board');

  const taskCountBefore=await p.evaluate(()=>DB.tasks.length);
  await p.click('#mobile-board-fab');await new Promise(r=>setTimeout(r,350));
  const sheetOpen=await p.evaluate(()=>document.getElementById('ws-quickadd-wrap').classList.contains('open'));
  ok(sheetOpen,'quick-add sheet opens');
  const testName='Mobile QA test item '+Date.now();
  await p.type('#qa-name',testName);
  await p.click('#qa-save-btn');
  await new Promise(r=>setTimeout(r,400));
  const afterAdd=await p.evaluate((name)=>{
    const t=DB.tasks.find(x=>x.name===name);
    return{found:!!t,sheetClosed:!document.getElementById('ws-quickadd-wrap').classList.contains('open'),
      ownerId:t?t.ownerId:null,status:t?t.status:null};
  },testName);
  ok(afterAdd.found,'a real click on the Save button created a task in DB.tasks');
  ok(afterAdd.sheetClosed,'sheet closes after saving');
  const meId=await p.evaluate(()=>currentUser.id);
  ok(afterAdd.ownerId===meId,'quick-added task defaults owner to the current user');
  ok(afterAdd.status==='todo','quick-added task defaults status to todo');
  const taskCountAfter=await p.evaluate(()=>DB.tasks.length);
  ok(taskCountAfter===taskCountBefore+1,'exactly one task was added, not zero or duplicated');

  // Undo via the toast
  const undone=await p.evaluate((name)=>{
    const btn=[...document.querySelectorAll('.app-toast button')].find(b=>/Undo/.test(b.textContent));
    if(!btn)return null;
    btn.click();
    return !DB.tasks.some(t=>t.name===name);
  },testName);
  ok(undone===true,'Undo on the toast removes the task again');

  // ---- Timesheet quick-log ----
  await p.evaluate(()=>navigate('time'));await new Promise(r=>setTimeout(r,500));
  const onTime=await p.evaluate(()=>({
    bodyClass:document.body.classList.contains('on-time-view'),
    fabVisible:getComputedStyle(document.getElementById('mobile-time-fab')).display!=='none',
  }));
  ok(onTime.bodyClass,'body gets on-time-view class on the Time view');
  ok(onTime.fabVisible,'timesheet FAB visible on the Time view');

  const entryCountBefore=await p.evaluate(()=>(DB.timeEntries||[]).length);
  await p.click('#mobile-time-fab');await new Promise(r=>setTimeout(r,350));
  const logSheetOpen=await p.evaluate(()=>document.getElementById('te-quicklog-wrap').classList.contains('open'));
  ok(logSheetOpen,'quick-log sheet opens');

  const recentInfo=await p.evaluate(()=>({count:(window._teQuickRecent||[]).length}));
  if(recentInfo.count>0){
    await p.click('.qte-recent-chip');
    await p.click('.qte-hours-chip[data-h="2"]');
    const noteText='Mobile QA note '+Date.now();
    await p.type('#qte-note',noteText);
    // A real, prior bug caught by this test: the offline-mode banner (z-index:99998,
    // position:fixed bottom-left) sat directly on top of this Save button once the tab bar
    // and bottom sheets existed, so a real click here never reached it. Fixed by lowering the
    // banner's z-index below the sheets' and lifting it clear of the tab bar on mobile — see
    // _showOfflineBanner and the #offline-mode-banner rule in the mobile shell CSS. This
    // click must keep succeeding as a real .click(), not be replaced by a programmatic call,
    // or that regression can come back unnoticed.
    await p.click('#qte-save-btn');
    await new Promise(r=>setTimeout(r,400));
    const afterLog=await p.evaluate((note)=>{
      const es=DB.timeEntries||[];
      const mine=es.find(e=>e.note===note);
      return{count:es.length,hours:mine?.hours,status:mine?.status,submittedAt:!!mine?.submittedAt,found:!!mine};
    },noteText);
    ok(afterLog.found,'a real click on the Save button reached it and created the entry');
    ok(afterLog.count===entryCountBefore+1,'quick-log created exactly one time entry');
    ok(afterLog.hours===2,'quick-log used the selected 2h chip');
    ok(afterLog.status==='submitted','quick-logged entry is submitted, not left in draft');
    ok(afterLog.submittedAt,'quick-logged entry carries a submittedAt');
  } else {
    pass.push('(no existing time entries to build recent-chips from — chip-pick path not exercised, expected on a fresh dataset)');
  }

  // ---- The offline banner itself must never sit on top of the sheets ----
  const bannerCheck=await p.evaluate(()=>{
    const banner=document.getElementById('offline-mode-banner');
    if(!banner)return{present:false};
    const bz=+getComputedStyle(banner).zIndex||0;
    return{present:true,zIndex:bz,belowSheet:bz<900};
  });
  if(bannerCheck.present)ok(bannerCheck.belowSheet,'offline banner z-index stays below the bottom sheets (900)');
  else pass.push('(offline banner not shown this run — Supabase reachable, banner logic not exercised)');

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  if(fail.length){console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));}
  console.log('ERRORS:',errs.length?errs.join(' | '):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('SCRIPT ERROR:',e);process.exit(1);});
