// The Single day field is gone: a one-day task is set by double-clicking a day, while
// single clicks still build a range. Driven with real mouse events — two full press and
// release pairs — because Puppeteer's clickCount:2 sends a single press/release that the
// page sees as detail=1, which is not a double click and quietly under-tests this.
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
  const reset=()=>p.evaluate(id=>{
    const t=DB.tasks.find(x=>x.id===id);t.startDate='';t.endDate='';saveDB(DB);
    try{wsCellClose()}catch(_){}renderView('workspace');
  },taskId);
  const openCell=async()=>{
    await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
    const cell=await p.$('td[onclick*="duedate"]');
    await cell.click();await new Promise(r=>setTimeout(r,500));
  };
  const dayAt=(n)=>p.evaluate(n=>{
    const btn=[...document.querySelectorAll('.ws-cal-d')].find(b=>b.textContent.trim()===String(n));
    if(!btn)return null;const r=btn.getBoundingClientRect();
    return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  },n);
  const doubleClick=async(pt)=>{
    // Puppeteer's clickCount:2 sends a single press/release that the page sees as detail=1 —
    // that is not what a person's double click looks like. Two full press/release pairs is.
    await p.mouse.move(pt.x,pt.y);
    await p.mouse.down();await p.mouse.up();
    await p.mouse.down();await p.mouse.up();
  };
  const stored=()=>p.evaluate(id=>{const t=DB.tasks.find(x=>x.id===id);return{s:t.startDate||'',e:t.endDate||''};},taskId);
  const isOpen=()=>p.evaluate(()=>{const d=document.getElementById('ws-cell-dd');return !!d&&d.style.display!=='none';});

  // ── the field is gone ──
  await reset();await openCell();
  const fields=await p.evaluate(()=>{
    const body=document.getElementById('ws-cell-dd-body');
    const labels=[...body.querySelectorAll('div')].map(d=>d.textContent.trim().toLowerCase());
    return{count:body.querySelectorAll('input[type=date]').length,
      hasSingle:labels.includes('single day'),
      hasStart:labels.includes('start'),
      hasEnd:labels.includes('end / due'),
      hint:(body.querySelector('.ws-cal-hint')||{}).textContent||''};
  });
  ok(fields.count===2,'the popover is back to two date fields (found '+fields.count+')');
  ok(!fields.hasSingle,'the Single day field is gone');
  ok(fields.hasStart&&fields.hasEnd,'Start and End / Due remain');
  ok(/double-click/i.test(fields.hint),'the hint mentions double-click ("'+fields.hint.trim()+'")');
  ok(await p.evaluate(()=>typeof wsCellSaveSingleDay==='undefined'),'wsCellSaveSingleDay is removed');
  ok(await p.evaluate(()=>typeof wsCalDouble==='function'),'wsCalDouble exists');

  // ── a real double-click gives one day ──
  const d12=await dayAt(12);
  await doubleClick(d12);
  await new Promise(r=>setTimeout(r,600));
  const dbl=await stored();
  ok(dbl.s===dbl.e&&/-12$/.test(dbl.s),'double-clicking a day sets that one day ('+dbl.s+' → '+dbl.e+')');
  ok(!(await isOpen()),'the popover closes after a double-click');

  // ── single clicks still build a range ──
  await reset();await openCell();
  const d8=await dayAt(8);
  await p.mouse.click(d8.x,d8.y);
  await new Promise(r=>setTimeout(r,450));
  const mid=await stored();
  ok(/-08$/.test(mid.s)&&!mid.e,'one click still just sets the start ('+mid.s+')');
  ok(await isOpen(),'the popover stays open for the second click');
  const d19=await dayAt(19);
  await p.mouse.click(d19.x,d19.y);
  await new Promise(r=>setTimeout(r,450));
  const range=await stored();
  ok(/-08$/.test(range.s)&&/-19$/.test(range.e),'the second click completes the range ('+range.s+' → '+range.e+')');
  ok(!(await isOpen()),'the popover closes on a completed range');

  // ── a double-click must not clobber a range the first click just completed ──
  await reset();await openCell();
  const a5=await dayAt(5);
  await p.mouse.click(a5.x,a5.y);
  await new Promise(r=>setTimeout(r,450));
  const a20=await dayAt(20);
  await doubleClick(a20);
  await new Promise(r=>setTimeout(r,600));
  const guarded=await stored();
  ok(/-05$/.test(guarded.s)&&/-20$/.test(guarded.e),
    'double-clicking the end of a range keeps the range, not one day ('+guarded.s+' → '+guarded.e+')');

  // ── clicking the same day twice, slowly, is also one day ──
  await reset();await openCell();
  const s14=await dayAt(14);
  await p.mouse.click(s14.x,s14.y);
  await new Promise(r=>setTimeout(r,500));
  const s14b=await dayAt(14);
  await p.mouse.click(s14b.x,s14b.y);
  await new Promise(r=>setTimeout(r,500));
  const same=await stored();
  ok(same.s===same.e&&/-14$/.test(same.s),'two slow clicks on one day also give a single day ('+same.s+')');

  // ── typing a year by hand is still protected ──
  await reset();await openCell();
  const typed=await p.evaluate(async id=>{
    const ins=document.querySelectorAll('#ws-cell-dd-body input[type=date]');
    ins[1].value='0002-04-15';ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    const partial=(DB.tasks.find(x=>x.id===id).endDate)||'';
    ins[1].value='2026-04-15';ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,300));
    return{partial,full:(DB.tasks.find(x=>x.id===id).endDate)||''};
  },taskId);
  ok(!typed.partial,'a half-typed year is still rejected in End / Due');
  ok(typed.full==='2026-04-15','a complete typed date still saves');

  await reset();
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
