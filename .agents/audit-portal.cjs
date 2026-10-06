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
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── are DB.boards and DB.workboards the same array? ──
  const alias=await p.evaluate(()=>{
    const same=DB.boards===DB.workboards;
    const bId=(DB.boards||[]).map(b=>b.id).sort().join(','),
          wId=(DB.workboards||[]).map(b=>b.id).sort().join(',');
    // does a write through saveWbClient reach DB.boards?
    const id=DB.workboards[0].id, keep=DB.workboards[0].clientId;
    const other=(DB.clients.find(c=>c.id!==keep)||{}).id;
    saveWbClient(id,other);
    const viaBoards=(DB.boards||[]).find(x=>x.id===id)?.clientId;
    const viaWorkboards=(DB.workboards||[]).find(x=>x.id===id)?.clientId;
    saveWbClient(id,keep||'');
    return {same,sameIds:bId===wId,bCount:(DB.boards||[]).length,wCount:(DB.workboards||[]).length,
      wroteTo:other,viaBoards,viaWorkboards};
  });
  console.log('BOARD ALIAS:',JSON.stringify(alias));
  ok(alias.viaBoards===alias.wroteTo&&alias.viaWorkboards===alias.wroteTo,
     'setting a board client is visible through BOTH DB.boards and DB.workboards');
  ok(alias.bCount===alias.wCount,'DB.boards and DB.workboards hold the same number of boards');

  // ── the client portal must show one client's work only ──
  const portal=await p.evaluate(async()=>{
    const real=currentUser;
    const withTasks=DB.clients.map(c=>({c,n:(typeof getClientTasks==='function'?getClientTasks(c.id):[]).length}))
      .filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
    if(withTasks.length<2){currentUser=real;return{skip:'need two clients with tasks',have:withTasks.map(x=>x.c.name+':'+x.n)};}
    const A=withTasks[0].c,B=withTasks[1].c;
    const bNames=getClientTasks(B.id).map(t=>t.name||t.title).filter(n=>n&&n.length>6);
    currentUser={id:'probe',name:A.name,role:'client',type:'client',clientId:A.id};
    document.getElementById('client-portal')?.classList.remove('hidden');
    const out={A:A.name,B:B.name,aCount:getClientTasks(A.id).length,bCount:bNames.length,sections:{}};
    for(const s of ['overview','tasks','workboard','schedule','requests','notifications']){
      let txt='';
      try{cpNavigate(s);await new Promise(r=>setTimeout(r,350));
        txt=document.getElementById('cp-body')?.innerText||'';}
      catch(e){txt='THREW: '+e.message;}
      out.sections[s]={len:txt.length,threw:/^THREW/.test(txt),
        leaked:bNames.filter(n=>txt.includes(n)).slice(0,4)};
    }
    // can the portal user reach another client's meeting notes / client notes?
    out.notesBlocked=_acBlockedViews(currentUser).has('notes')||_acBlockedViews(currentUser).has('*');
    currentUser=real;
    document.getElementById('client-portal')?.classList.add('hidden');
    return out;
  });
  console.log('PORTAL:',JSON.stringify(portal,null,1));
  if(portal.skip){
    console.log('  (portal isolation not exercised: '+portal.skip+')');
  }else{
    Object.entries(portal.sections).forEach(([s,r])=>{
      ok(!r.threw,'portal section "'+s+'" renders without throwing');
      ok(r.leaked.length===0,'portal section "'+s+'" shows none of '+portal.B+'\u2019s '+portal.bCount+' task names');
    });
    ok(portal.notesBlocked,'a portal user is still blocked from Client Notes');
  }

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('AUDIT CRASHED',e.message);process.exit(1)});
