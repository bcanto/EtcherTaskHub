const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── migration ──────────────────────────────────────────────────
  const mig=await p.evaluate(()=>{
    const boards=(DB.workboards||[]);
    return {
      total:boards.length,
      withClient:boards.filter(w=>w.clientId).length,
      allDefined:boards.every(w=>w.clientId!==undefined),
      matchesGroups:boards.every(w=>{
        const gs=DB.groups.filter(g=>(g.boardId||g.workboardId)===w.id&&g.clientId);
        return !gs.length||gs.some(g=>g.clientId===w.clientId);
      }),
      resolver:typeof boardClientId==='function'&&typeof boardClient==='function',
    };
  });
  console.log('MIGRATION:',JSON.stringify(mig));
  ok(mig.resolver,'boardClientId / boardClient exist');
  ok(mig.allDefined,'every board now carries a clientId field');
  ok(mig.withClient>0,mig.withClient+' of '+mig.total+' boards adopted a client from their groups');
  ok(mig.matchesGroups,'each board client matches one its groups actually use');

  // ── the group row no longer carries the client ─────────────────
  const row=await p.evaluate(async()=>{
    openWorkboard(DB.workboards[0].id);await new Promise(r=>setTimeout(r,600));
    const hdrs=[...document.querySelectorAll('.ws-grp-hdr')];
    const cli=boardClient(currentWorkboard);
    return {
      groups:hdrs.length,
      selects:document.querySelectorAll('.ws-grp-hdr select.ws-grp-client').length,
      anySelect:document.querySelectorAll('.ws-grp-hdr select').length,
      clientName:cli?cli.name:null,
      nameInAnyHeader:cli?hdrs.some(h=>h.textContent.includes(cli.name)):false,
      bandCount:cli?[...document.querySelectorAll('#ws-table-scroll tr')]
        .filter(tr=>tr.style.pointerEvents==='none'&&tr.textContent.trim()===cli.name.toUpperCase()).length:0,
      shortCodeBand:cli?document.querySelectorAll('#ws-table-scroll td span[style*="letter-spacing:0.08em"]').length:0,
    };
  });
  console.log('GROUP ROW:',JSON.stringify(row));
  ok(row.groups>0,'board renders '+row.groups+' group headers');
  ok(row.selects===0,'no per-group client selector remains');
  ok(row.anySelect===0,'no dropdown at all left in the group row');
  ok(!row.nameInAnyHeader,'the client name ("'+row.clientName+'") is gone from the group rows');
  ok(row.shortCodeBand===0,'the client separator band is gone');

  // ── changing the board client cascades ─────────────────────────
  const cascade=await p.evaluate(async()=>{
    const wb=currentWorkboard;
    const other=DB.clients.find(c=>c.id!==boardClientId(wb));
    const before=boardClientId(wb);
    saveWbClient(wb.id,other.id);await new Promise(r=>setTimeout(r,450));
    const gs=DB.groups.filter(g=>(g.boardId||g.workboardId)===wb.id);
    const out={
      before,set:other.id,
      board:DB.workboards.find(w=>w.id===wb.id).clientId,
      allGroups:gs.length&&gs.every(g=>g.clientId===other.id),
      groupCount:gs.length,
    };
    // tasks resolve their client through the group, which is what reports/pro forma use
    const t=DB.tasks.find(x=>_taskBoardId(x)===wb.id&&x.groupId);
    out.taskResolves=t?(getTaskClient?getTaskClient(t)?.id:null):null;
    saveWbClient(wb.id,before);await new Promise(r=>setTimeout(r,450));
    out.restored=boardClientId(currentWorkboard)===before;
    return out;
  });
  console.log('CASCADE:',JSON.stringify(cascade));
  ok(cascade.board===cascade.set,'setting the board client stores it on the board');
  ok(cascade.allGroups,'all '+cascade.groupCount+' groups followed the board');
  ok(cascade.taskResolves===cascade.set,'a task still resolves to the new client through its group');
  ok(cascade.restored,'setting it back works too');

  // ── new groups inherit, even when the board has no client ──────
  const inherit=await p.evaluate(async()=>{
    const wb=currentWorkboard;
    const want=boardClientId(wb);
    wsAddGroup();await new Promise(r=>setTimeout(r,500));
    const out={picker:!!document.getElementById('ws-inline-group-client')};
    document.getElementById('ws-inline-group-name').value='Inherit test';
    wsSaveInlineGroup();await new Promise(r=>setTimeout(r,500));
    const g=DB.groups.find(x=>x.name==='Inherit test');
    out.made=!!g;out.inherited=g?g.clientId===want:false;out.want=want;

    // and with no board client at all — this used to bail silently
    const keep=wb.clientId;
    saveWbClient(wb.id,'');await new Promise(r=>setTimeout(r,400));
    wsAddGroup();await new Promise(r=>setTimeout(r,500));
    document.getElementById('ws-inline-group-name').value='No client group';
    wsSaveInlineGroup();await new Promise(r=>setTimeout(r,500));
    out.madeWithoutClient=!!DB.groups.find(x=>x.name==='No client group');
    saveWbClient(wb.id,keep);await new Promise(r=>setTimeout(r,400));
    return out;
  });
  console.log('INHERIT:',JSON.stringify(inherit));
  ok(!inherit.picker,'the add-group row no longer asks for a client');
  ok(inherit.made&&inherit.inherited,'a new group inherits the board client');
  ok(inherit.madeWithoutClient,'a group can be added to a board with no client (used to fail silently)');

  // ── client filtering still works off group.clientId ────────────
  const filt=await p.evaluate(async()=>{
    const wb=currentWorkboard;
    const cid=boardClientId(wb);
    if(!cid)return{skipped:true};
    activeFilters.clientId=cid;renderView('workspace');await new Promise(r=>setTimeout(r,500));
    const withFilter=document.querySelectorAll('.ws-grp-hdr').length;
    activeFilters.clientId='all';renderView('workspace');await new Promise(r=>setTimeout(r,500));
    return {withFilter,all:document.querySelectorAll('.ws-grp-hdr').length};
  });
  console.log('FILTER:',JSON.stringify(filt));
  ok(filt.skipped||filt.withFilter>0,'filtering by the board client still shows its groups');

  // ── grouping BY client still labels its sections ───────────────
  const byClient=await p.evaluate(async()=>{
    const prev=wsGroupBy;wsGroupBy='client';renderView('workspace');
    await new Promise(r=>setTimeout(r,500));
    const hdrs=[...document.querySelectorAll('.ws-grp-hdr')];
    const cli=boardClient(currentWorkboard);
    const labelled=cli?hdrs.some(h=>h.textContent.includes(cli.name)):false;
    wsGroupBy=prev;renderView('workspace');await new Promise(r=>setTimeout(r,450));
    return {sections:hdrs.length,labelled};
  });
  console.log('BY CLIENT:',JSON.stringify(byClient));
  ok(byClient.labelled,'grouping BY client still names each section (that is identity, not a repeat)');

  // ── task panel shows it read-only ──────────────────────────────
  const panel=await p.evaluate(async()=>{
    const t=DB.tasks.find(x=>_taskBoardId(x)===currentWorkboard.id&&!x.parentTaskId);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,700));
    const lbls=[...document.querySelectorAll('.tp-prop')];
    const cl=lbls.find(x=>x.querySelector('.tp-prop-lbl')?.textContent.trim()==='Client');
    const out={found:!!cl};
    if(cl){
      out.hasSelect=!!cl.querySelector('select');
      out.text=cl.querySelector('.tp-prop-val')?.textContent.trim();
      // The panel shows the de-duplicated "Name - CODE" title, not the raw client name.
      const _c=boardClient(currentWorkboard);
      out.expected=_c?clientDisplayTitle(_c):'— None —';
    }
    if(typeof closeTaskPanel==='function')closeTaskPanel();
    return out;
  });
  console.log('PANEL:',JSON.stringify(panel));
  ok(panel.found,'task panel still has a Client row');
  ok(panel.found&&!panel.hasSelect,'it is read-only — no per-group dropdown');
  ok(panel.found&&panel.text===panel.expected,'it shows the board client ("'+panel.text+'")');

  // cleanup
  await p.evaluate(()=>{
    DB.groups=DB.groups.filter(g=>!['Inherit test','No client group'].includes(g.name));
    saveDB(DB);
  });

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
