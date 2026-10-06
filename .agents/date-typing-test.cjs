// Typing a date by hand used to store a year like 0002: a native date input reports a
// valid value on the first digit of the year, so 2026 arrives as 0002, 0020, 0202 first.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  const taskId=await p.evaluate(async()=>{
    if(!currentWorkboard)openWorkboard(DB.workboards[0].id);
    navigate('workspace');await new Promise(x=>setTimeout(x,800));
    return DB.tasks.find(t=>!t.parentTaskId).id;
  });

  // ── the guard itself ──
  const guard=await p.evaluate(()=>({
    exists:typeof _dateReady==='function',
    rejects:typeof _dateReady==='function'
      ?['0002-04-15','0020-04-15','0202-04-15','0999-01-01'].every(v=>!_dateReady(v)):null,
    accepts:typeof _dateReady==='function'
      ?['2026-04-15','1999-12-31','1000-01-01'].every(v=>_dateReady(v)):null,
    allowsClear:typeof _dateReady==='function'?_dateReady('')&&_dateReady(null):null
  }));
  ok(guard.exists,'_dateReady() exists');
  ok(guard.rejects,'a half-typed year (0002, 0020, 0202, 0999) is not treated as ready');
  ok(guard.accepts,'a complete year (2026, 1999, 1000) is accepted');
  ok(guard.allowsClear,'clearing a date is still a real edit');

  const setDates=(s,e)=>p.evaluate((id,s,e)=>{
    const t=DB.tasks.find(x=>x.id===id);t.startDate=s;t.endDate=e;saveDB(DB);renderView('workspace');
  },taskId,s,e);
  const stored=()=>p.evaluate(id=>{const t=DB.tasks.find(x=>x.id===id);return{s:t.startDate||'',e:t.endDate||''};},taskId);

  // ── typing the End date one digit at a time, as a person does ──
  await setDates('2026-04-11','');
  await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
  const cell=await p.$('td[onclick*="duedate"]');
  await cell.click();await new Promise(r=>setTimeout(r,500));
  const box=await p.evaluate(()=>{
    const el=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[1];
    if(!el)return null;const r=el.getBoundingClientRect();
    return{x:Math.round(r.left+18),y:Math.round(r.top+r.height/2)};
  });
  ok(!!box,'the End / Due field is present to type into');
  if(box){
    await p.mouse.click(box.x,box.y);await new Promise(r=>setTimeout(r,200));
    const trail=[];
    for(const ch of '15042026'){
      await p.keyboard.type(ch);await new Promise(r=>setTimeout(r,170));
      trail.push(await p.evaluate(id=>{
        const t=DB.tasks.find(x=>x.id===id);
        const dd=document.getElementById('ws-cell-dd');
        return{stored:t.endDate||'',open:!!dd&&dd.style.display!=='none'};
      },taskId));
    }
    const midway=trail.slice(0,7);
    ok(midway.every(s=>!/^0\d{3}/.test(s.stored)),'no partial year is ever written to the task');
    ok(midway.every(s=>s.open),'the popover stays open while the year is being typed');
    const end=await stored();
    ok(end.e==='2026-04-15','the finished date is stored correctly ('+end.e+')');
    ok(end.s==='2026-04-11','the start date is untouched by the typing ('+end.s+')');
  }

  // ── a box abandoned mid-year is put back, not left showing a fake date ──
  await setDates('2026-04-11','2026-05-20');
  await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
  const cell2=await p.$('td[onclick*="duedate"]');
  await cell2.click();await new Promise(r=>setTimeout(r,500));
  const reverted=await p.evaluate(async id=>{
    const el=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[1];
    el.value='0002-04-15';
    el.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    const storedAfterChange=(DB.tasks.find(x=>x.id===id).endDate)||'';
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    return{storedAfterChange,shown:el.value};
  },taskId);
  ok(reverted.storedAfterChange==='2026-05-20','a half-typed year does not overwrite the stored date');
  ok(reverted.shown==='2026-05-20','the box reverts to the real date when it loses focus ('+reverted.shown+')');

  // ── the Start box is guarded the same way ──
  await setDates('','');
  await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
  const cell3=await p.$('td[onclick*="duedate"]');
  await cell3.click();await new Promise(r=>setTimeout(r,500));
  const startGuard=await p.evaluate(async id=>{
    const el=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[0];   // Start
    el.value='0002-04-15';el.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    const partial=(DB.tasks.find(x=>x.id===id).startDate)||'';
    const el2=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[0];
    el2.value='2026-04-15';el2.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,350));
    return{partial,full:(DB.tasks.find(x=>x.id===id).startDate)||''};
  },taskId);
  ok(!startGuard.partial,'Start ignores a half-typed year too');
  ok(startGuard.full==='2026-04-15','Start still saves once the year is complete');

  // ── the task panel writes dates too, and needs the same guard ──
  const panel=await p.evaluate(async id=>{
    try{wsCellClose()}catch(_){}
    const t=DB.tasks.find(x=>x.id===id);
    t.startDate='2026-04-11';t.endDate='2026-05-20';saveDB(DB);
    openTaskPanel(id);await new Promise(x=>setTimeout(x,700));
    const ins=[...document.querySelectorAll('#task-panel .tp-date input[type=date]')];
    if(ins.length<2)return{noFields:true};
    ins[1].value='0002-04-15';ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,300));
    const afterPartial=(DB.tasks.find(x=>x.id===id).endDate)||'';
    ins[1].dispatchEvent(new Event('blur',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    const shown=ins[1].value;
    ins[1].value='2026-06-30';ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,350));
    const afterFull=(DB.tasks.find(x=>x.id===id).endDate)||'';
    return{afterPartial,shown,afterFull};
  },taskId);
  ok(!panel.noFields,'the task panel exposes its date fields');
  ok(panel.afterPartial==='2026-05-20','the panel ignores a half-typed year too');
  ok(panel.shown==='2026-05-20','the panel box reverts on blur ('+panel.shown+')');
  ok(panel.afterFull==='2026-06-30','the panel still saves a complete date ('+panel.afterFull+')');

  await p.evaluate(id=>{
    try{closeTaskPanel()}catch(_){}
    const t=DB.tasks.find(x=>x.id===id);t.startDate='';t.endDate='';saveDB(DB);
  },taskId);
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
