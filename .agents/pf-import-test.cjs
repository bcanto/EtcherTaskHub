const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1400,height:950}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR: '+e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // Snapshot the live DB's timesheet / client wiring
  const snap=await p.evaluate(()=>{
    const te=DB.timeEntries||[];
    const approved=te.filter(e=>e.status==='approved'&&!e.deletedAt);
    const resolveClient=e=>{
      if(e.clientId)return e.clientId;
      const t=e.taskId&&DB.tasks.find(x=>x.id===e.taskId);
      return t?(getTaskClient(t)?.id||null):null;
    };
    const byClient={};
    approved.forEach(e=>{const c=resolveClient(e);byClient[c]=(byClient[c]||0)+1;});
    // how many approved entries would the OLD filter miss vs the new one?
    const oldMatch=(cid)=>approved.filter(e=>{
      const t=e.taskId&&DB.tasks.find(x=>x.id===e.taskId);
      return e.clientId===cid||(t&&t.clientId===cid);
    }).length;
    const newMatch=(cid)=>approved.filter(e=>resolveClient(e)===cid).length;
    const rows=Object.keys(byClient).filter(Boolean).map(cid=>({
      client:DB.clients.find(c=>c.id===cid)?.name||cid,cid,
      approved:byClient[cid],oldFilter:oldMatch(cid),newFilter:newMatch(cid)
    }));
    return {totalApproved:approved.length,rows,
      dates:approved.map(e=>e.date).sort()};
  });
  console.log('approved entries in live DB:',snap.totalApproved);
  console.log('date span:',snap.dates[0],'->',snap.dates[snap.dates.length-1]);
  console.table ? console.table(snap.rows) : console.log(JSON.stringify(snap.rows,null,1));

  if(!snap.totalApproved){
    console.log('\n(no approved entries in this localStorage DB — testing diagnostic path only)');
  }

  // Pick a client that has approved entries and exercise the real import fn
  const target=snap.rows.find(r=>r.newFilter>0)||snap.rows[0];

  const result=await p.evaluate((cid)=>{
    // build a fresh invoice covering a very wide range
    const inv={id:'pf-test-'+Date.now(),number:'TEST-001',clientId:cid,
      dateFrom:'2000-01-01',dateTo:'2099-12-31',lineItems:[],auditEvents:[],
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    (DB.proFormaInvoices=DB.proFormaInvoices||[]).push(inv);
    let alertMsg=null;const _origAlert=window.showAlert;window.showAlert=m=>{alertMsg=m;};
    pfiImportEntries(inv.id);
    window.showAlert=_origAlert;
    const modalOpen=!document.getElementById('generic-modal').classList.contains('hidden')
      && /Import Time Entries/.test(document.getElementById('generic-modal-title').textContent);
    const rowCount=document.querySelectorAll('.pfi-import-cb').length;
    // clean up
    DB.proFormaInvoices=DB.proFormaInvoices.filter(i=>i.id!==inv.id);
    if(document.getElementById('generic-modal'))document.getElementById('generic-modal').classList.add('hidden');
    return {alertMsg,modalOpen,rowCount,cid};
  }, target?target.cid:null);
  console.log('\nWIDE-RANGE import for client',target&&target.client,'->',JSON.stringify(result));

  if(target && target.newFilter>0){
    ok(result.modalOpen,'import modal opens for a client with approved entries');
    ok(result.rowCount===target.newFilter,`modal lists all ${target.newFilter} approved entries (got ${result.rowCount})`);
    ok(!result.alertMsg,'no "nothing found" alert when entries exist');
    if(target.oldFilter<target.newFilter)
      ok(true,`FIX CONFIRMED: old filter would have shown ${target.oldFilter}, new shows ${target.newFilter}`);
  }

  // Diagnostic: narrow date range should give the date-specific message
  if(target && target.newFilter>0){
    const diag=await p.evaluate((cid)=>{
      const inv={id:'pf-test2-'+Date.now(),number:'TEST-002',clientId:cid,
        dateFrom:'1990-01-01',dateTo:'1990-01-02',lineItems:[],auditEvents:[],
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      (DB.proFormaInvoices=DB.proFormaInvoices||[]).push(inv);
      let alertMsg=null;const o=window.showAlert;window.showAlert=m=>{alertMsg=m;};
      pfiImportEntries(inv.id);
      window.showAlert=o;
      DB.proFormaInvoices=DB.proFormaInvoices.filter(i=>i.id!==inv.id);
      return alertMsg;
    }, target.cid);
    console.log('NARROW-RANGE diagnostic ->',JSON.stringify(diag));
    ok(/date range|outside/i.test(diag||''),'out-of-range gives a date-specific message');
  }

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
