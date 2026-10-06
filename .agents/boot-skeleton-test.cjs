// The boot skeleton (shown while index.html's own script decides what to render) must match
// what's actually coming: the sign-in layout for a definitely-logged-out visitor, the app shell
// layout (sidebar + topbar) for everyone else, chosen BEFORE the body is even parsed (a class on
// <html>, set by the very first script in <head>) so the wrong one is never painted even briefly.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const allErrs=[];

  // ── 1. Logged-out visitor. The whole point of deciding via a <html> class (rather than a
  // later script reaching for the elements) is that the cleanup script right after the two
  // skeletons runs SYNCHRONOUSLY in the same parse pass — by domcontentloaded, a logged-out
  // visitor's boot has already fully resolved. So this checks the CSS rules structurally (would
  // the right skeleton have painted, had there been any delay?) and the final settled DOM
  // separately, rather than trying to catch an intentionally-instant transition mid-flight.
  {
    const p=await b.newPage();
    const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
    await p.evaluateOnNewDocument(()=>{try{localStorage.clear();}catch(e){}});
    await p.goto('http://localhost:3001/',{waitUntil:'domcontentloaded'});

    const cssRules=await p.evaluate(()=>{
      const rules=[];
      for(const sheet of document.styleSheets){
        let list;try{list=sheet.cssRules;}catch(e){continue;}
        for(const r of list){
          if(r.selectorText&&/boot-loggedout/.test(r.selectorText))rules.push({sel:r.selectorText,display:r.style.display});
        }
      }
      return rules;
    });
    console.log('BOOT-LOGGEDOUT CSS RULES:',JSON.stringify(cssRules));
    const hideLoading=cssRules.find(r=>/#loading-screen/.test(r.sel));
    const showLoginSk=cssRules.find(r=>/#login-skeleton/.test(r.sel));
    ok(!!hideLoading&&hideLoading.display==='none','a rule keyed off html.boot-loggedout hides the app skeleton, so it can never paint even for a moment on a slow connection');
    ok(!!showLoginSk&&showLoginSk.display==='flex','a rule keyed off html.boot-loggedout shows the sign-in skeleton from the very first paint, before any script decides anything at runtime');

    const htmlClassEarly=await p.evaluate(()=>document.documentElement.className);
    ok(htmlClassEarly.split(' ').includes('boot-loggedout'),'a definitely-logged-out visitor gets the boot-loggedout class, decided before the body is even parsed');

    await new Promise(r=>setTimeout(r,800));
    const settled=await p.evaluate(()=>({
      loginSkeletonInDom:!!document.getElementById('login-skeleton'),
      loadingScreenInDom:!!document.getElementById('loading-screen'),
      loginScreenVisible:!document.getElementById('login-screen').classList.contains('hidden')&&getComputedStyle(document.getElementById('login-screen')).display!=='none',
    }));
    console.log('LOGGED-OUT, settled:',JSON.stringify(settled));
    ok(!settled.loginSkeletonInDom,'the sign-in skeleton removes itself once settled (it resolves synchronously, so this is already true by domcontentloaded)');
    ok(!settled.loadingScreenInDom,'the app skeleton is also cleaned up rather than left lying around hidden in the DOM');
    ok(settled.loginScreenVisible,'the real sign-in page is visible underneath once the skeleton clears');
    allErrs.push(...errs.map(e=>'[logged-out] '+e));
    await p.close();
  }

  // ── 2. A saved (even if stale/fake) session: app skeleton stays up for the real async check —
  // unchanged from the previous behaviour, and the sign-in skeleton must stay hidden throughout.
  {
    const p=await b.newPage();
    const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
    await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('etcher_session_v1',JSON.stringify({id:'u1',type:'staff',role:'admin',savedAt:Date.now()}));}catch(e){}});
    await p.goto('http://localhost:3001/',{waitUntil:'domcontentloaded'});
    const early=await p.evaluate(()=>({
      htmlClass:document.documentElement.className,
      loadingScreenDisplay:getComputedStyle(document.getElementById('loading-screen')).display,
      loginSkeletonDisplay:getComputedStyle(document.getElementById('login-skeleton')).display,
    }));
    console.log('SAVED SESSION, at domcontentloaded:',JSON.stringify(early));
    ok(early.htmlClass.split(' ').includes('boot-pending'),'a saved session gets boot-pending, not boot-loggedout');
    ok(early.loadingScreenDisplay==='flex','the app skeleton is shown while the real session check runs');
    ok(early.loginSkeletonDisplay==='none','the sign-in skeleton stays hidden the whole time a session is being checked');

    await new Promise(r=>setTimeout(r,4000));
    const settled=await p.evaluate(()=>({
      loadingScreenInDom:!!document.getElementById('loading-screen'),
      onLoginOrApp:!document.getElementById('login-screen').classList.contains('hidden')||!document.getElementById('app-shell').classList.contains('hidden'),
    }));
    console.log('SAVED SESSION, settled:',JSON.stringify(settled));
    ok(!settled.loadingScreenInDom,'the app skeleton still clears once the real boot code resolves the (invalid/fake) session');
    ok(settled.onLoginOrApp,'boot resolves to either the sign-in page or the app shell, not stuck on nothing');
    allErrs.push(...errs.map(e=>'[saved-session] '+e));
    await p.close();
  }

  // ── 3. A real login still works end to end — the actual regression risk of this change:
  // #login-screen now carries an extra class, and the sign-in skeleton sits in the same DOM
  // region. Confirm signing in for real is completely unaffected.
  {
    const p=await b.newPage();
    const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
    await p.evaluateOnNewDocument(()=>{try{localStorage.clear();}catch(e){}});
    await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,800));
    if(await p.$('#login-email')){
      await p.type('#login-email','b.canto@etchersolutions.com');
      await p.type('#login-password','TaskHub123');
      await p.keyboard.press('Enter');
      await new Promise(r=>setTimeout(r,1800));
    }
    const loggedIn=await p.evaluate(()=>!!(typeof currentUser!=='undefined'&&currentUser&&currentUser.id));
    console.log('REAL LOGIN:',JSON.stringify({loggedIn}));
    ok(loggedIn,'a real sign-in still works after the skeleton changes');
    allErrs.push(...errs.map(e=>'[real-login] '+e));
    await p.close();
  }

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',allErrs.length?allErrs.slice(0,10):'none');
  await b.close();
  process.exit(fail.length||allErrs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
