const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,160));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];
  const ok=(c,m)=>c?pass.push(m):fail.push(m);

  await p.evaluate(()=>{const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);openTaskPanel(t.id);});
  await new Promise(r=>setTimeout(r,800));

  // all tabs render
  for(const tab of ['subtasks','dependencies','notes','activity','recurrence','details']){
    await p.evaluate(t=>tpShowTab(t),tab);
    await new Promise(r=>setTimeout(r,350));
    const h=await p.evaluate(()=>document.getElementById('tp-body')?.innerHTML.length||0);
    ok(h>50,`tab "${tab}" renders (${h} chars)`);
  }

  // details still has redesign after tab round-trip
  // 5, not 4 — action-requests-test.cjs added a "Client Action" section (renderTpActionRequests)
  // between Comments and Client Thread; see PLAN-client-board-and-actions.md.
  const d=await p.evaluate(()=>({secs:document.querySelectorAll('.tp-sec').length,props:document.querySelectorAll('.tp-prop').length,people:!!document.querySelector('.tp-people'),oldRows:document.querySelectorAll('.tp-field-row').length}));
  ok(d.secs===6,'6 collapsible sections after tab round-trip, the Audit trail last (got '+d.secs+')');
  ok(d.props>=6,'compact prop rows present ('+d.props+')');
  ok(d.people,'people stack present');
  ok(d.oldRows===0,'no legacy .tp-field-row rows');

  // collapse state survives close + reopen
  await p.evaluate(()=>{const hd=[...document.querySelectorAll('.tp-sec-hd')].find(h=>/DESCRIPTION/i.test(h.textContent));hd&&hd.click();});
  await new Promise(r=>setTimeout(r,300));
  await p.evaluate(()=>closeTaskPanel());
  await new Promise(r=>setTimeout(r,500));
  await p.evaluate(()=>{const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);openTaskPanel(t.id);});
  await new Promise(r=>setTimeout(r,700));
  const persisted=await p.evaluate(()=>{
    const s=[...document.querySelectorAll('.tp-sec')].find(x=>/DESCRIPTION/i.test(x.querySelector('.tp-sec-hd').textContent));
    return s?s.classList.contains('open'):null;
  });
  ok(persisted===false,'Description stays collapsed after close+reopen (got '+persisted+')');

  // description edits still save
  await p.evaluate(()=>{const hd=[...document.querySelectorAll('.tp-sec-hd')].find(h=>/DESCRIPTION/i.test(h.textContent));hd&&hd.click();});
  await new Promise(r=>setTimeout(r,500));
  await p.evaluate(()=>{
    const el=document.getElementById('tp-desc');
    el.focus(); el.innerHTML='Regression edit '+Date.now();
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.blur();
  });
  await new Promise(r=>setTimeout(r,800));
  const saved=await p.evaluate(()=>DB.tasks.find(x=>x.id===_tpCurrentTask.id).description||'');
  ok(/Regression edit/.test(saved),'description edit persists ("'+saved.slice(0,30)+'")');

  // tags add
  await p.evaluate(()=>{const i=document.getElementById('tp-tag-input');if(i){i.value='regtag';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}});
  await new Promise(r=>setTimeout(r,700));
  ok(await p.evaluate(()=>(DB.tasks.find(x=>x.id===_tpCurrentTask.id).tags||[]).includes('regtag')),'tag add works');

  // more menu handlers exist
  const menuOk=await p.evaluate(()=>{
    document.querySelector('button[title="More actions"]').click();
    const m=document.getElementById('tp-more-menu');
    return m&&getComputedStyle(m).display==='block'&&m.querySelectorAll('.tp-more-item').length===2
      &&typeof tpArchiveTask==='function'&&typeof tpDeleteTask==='function';
  });
  ok(menuOk,'more menu opens with working Archive/Delete handlers');

  console.log('PASS ('+pass.length+'):'); pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):'); fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
