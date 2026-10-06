const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1400,height:900}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');
  await new Promise(r=>setTimeout(r,1900));
  const loggedIn=await p.evaluate(()=>!!currentUser);
  ok(loggedIn,'logged in');

  const stored=await p.evaluate(()=>{
    const raw=localStorage.getItem('etcher_session_v1');
    return raw?JSON.parse(raw):null;
  });
  ok(!!stored&&!!stored.savedAt,'session written to localStorage');
  ok(await p.evaluate(()=>_SESSION_MAX_IDLE)===30*24*60*60*1000,'idle window is 30 days');

  // RELOAD — the real complaint: does it survive?
  await p.reload({waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1800));
  const afterReload=await p.evaluate(()=>({
    user:currentUser?currentUser.email||currentUser.name:null,
    loginVisible:!!document.querySelector('#login-email')&&document.querySelector('#login-email').offsetParent!==null
  }));
  console.log('AFTER RELOAD:',JSON.stringify(afterReload));
  ok(!!afterReload.user,'still signed in after a reload ('+afterReload.user+')');
  ok(!afterReload.loginVisible,'login form is not shown again');

  // a 9-hour-old session used to be dead; it must now survive
  const old9h=await p.evaluate(async()=>{
    const s=JSON.parse(localStorage.getItem('etcher_session_v1'));
    s.savedAt=Date.now()-9*60*60*1000;
    localStorage.setItem('etcher_session_v1',JSON.stringify(s));
    return true;
  });
  await p.reload({waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1800));
  ok(await p.evaluate(()=>!!currentUser),'a 9-hour-old session survives (was expired at 8h)');

  // activity pushes the stamp forward
  const touched=await p.evaluate(async()=>{
    const before=JSON.parse(localStorage.getItem('etcher_session_v1')).savedAt;
    _sessionTouchedAt=0;                       // clear the 60s throttle
    document.body.click();
    await new Promise(r=>setTimeout(r,250));
    const after=JSON.parse(localStorage.getItem('etcher_session_v1')).savedAt;
    return{before,after,moved:after>before};
  });
  console.log('TOUCH:',JSON.stringify(touched));
  ok(touched.moved,'using the app pushes the expiry forward (rolling window)');

  // throttle: rapid clicks must not rewrite every time
  const throttled=await p.evaluate(async()=>{
    const a=JSON.parse(localStorage.getItem('etcher_session_v1')).savedAt;
    for(let i=0;i<5;i++)document.body.click();
    await new Promise(r=>setTimeout(r,200));
    return JSON.parse(localStorage.getItem('etcher_session_v1')).savedAt===a;
  });
  ok(throttled,'repeat clicks are throttled to one write a minute');

  // beyond the window it still expires
  await p.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('etcher_session_v1'));
    s.savedAt=Date.now()-31*24*60*60*1000;
    localStorage.setItem('etcher_session_v1',JSON.stringify(s));
  });
  await p.reload({waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1700));
  const expired=await p.evaluate(()=>({user:!!currentUser,cleared:!localStorage.getItem('etcher_session_v1')}));
  console.log('31 DAYS:',JSON.stringify(expired));
  ok(!expired.user&&expired.cleared,'a 31-day-idle session still expires and is cleared');

  // explicit sign out must still work immediately
  await p.evaluate(()=>{});
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');
  await new Promise(r=>setTimeout(r,1800));
  const out=await p.evaluate(async()=>{
    doLogout();
    await new Promise(r=>setTimeout(r,300));
    return{user:!!currentUser,stored:!!localStorage.getItem('etcher_session_v1')};
  });
  console.log('SIGN OUT:',JSON.stringify(out));
  ok(!out.user&&!out.stored,'Sign Out still clears the session immediately');

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
