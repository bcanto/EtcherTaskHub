// Timeline popover: an inline calendar where the first click sets the start and the second
// sets the end. Double-click behaviour lives in dblclick-day-test.
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

  const setDates=(s,e)=>p.evaluate((id,s,e)=>{
    const t=DB.tasks.find(x=>x.id===id);t.startDate=s;t.endDate=e;saveDB(DB);renderView('workspace');
  },taskId,s,e);
  const openCell=async()=>{
    await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
    const cell=await p.$('td[onclick*="duedate"]');
    await cell.click();await new Promise(r=>setTimeout(r,450));
  };
  const dates=()=>p.evaluate(id=>{const t=DB.tasks.find(x=>x.id===id);return{s:t.startDate||'',e:t.endDate||''};},taskId);
  const isOpen=()=>p.evaluate(()=>{const d=document.getElementById('ws-cell-dd');return !!d&&d.style.display!=='none';});

  // ── the fields on offer ──
  await setDates('2026-09-08','2026-09-17');
  await openCell();
  const fields=await p.evaluate(()=>{
    const body=document.getElementById('ws-cell-dd-body');
    const labels=[...body.querySelectorAll('div')].map(d=>d.textContent.trim()).filter(t=>t.length<14);
    const ins=[...body.querySelectorAll('input[type=date]')];
    return{count:ins.length,values:ins.map(i=>i.value),
      hasSingle:labels.some(t=>/^single day$/i.test(t)),
      hasStart:labels.some(t=>/^start$/i.test(t)),
      hasEnd:labels.some(t=>/^end \/ due$/i.test(t)),
      hasCal:!!body.querySelector('.ws-cal-grid')};
  });
  ok(fields.count===2,'the popover has two date fields (found '+fields.count+')');
  ok(!fields.hasSingle,'there is no Single day field');
  ok(fields.hasStart&&fields.hasEnd,'they are labelled Start and End / Due');
  ok(fields.values[0]==='2026-09-08'&&fields.values[1]==='2026-09-17','Start and End show the task dates');
  ok(fields.hasCal,'an inline calendar is shown');

  // ── the calendar reflects the current range ──
  const marks=await p.evaluate(()=>{
    const g=document.querySelector('.ws-cal-grid');
    const on=[...g.querySelectorAll('.ws-cal-on')].map(b=>b.textContent.trim());
    const inR=[...g.querySelectorAll('.ws-cal-in')].map(b=>b.textContent.trim());
    const mon=document.querySelector('.ws-cal-mon').textContent.trim();
    return{on,inR,mon};
  });
  ok(marks.mon==='September 2026','the calendar opens on the month of the range ("'+marks.mon+'")');
  ok(marks.on.join(',')==='8,17','the start and end days are marked ('+marks.on.join(',')+')');
  ok(marks.inR.join(',')==='9,10,11,12,13,14,15,16','the days between are shaded ('+marks.inR.join(',')+')');

  // ── one day, chosen by clicking the same date twice ──
  const single=await p.evaluate(async id=>{
    const btns=()=>[...document.querySelectorAll('.ws-cal-d')];
    btns().find(b=>b.textContent.trim()==='25').click();
    await new Promise(x=>setTimeout(x,350));
    btns().find(b=>b.textContent.trim()==='25').click();
    await new Promise(x=>setTimeout(x,350));
    const t=DB.tasks.find(x=>x.id===id);
    const dd=document.getElementById('ws-cell-dd');
    return{s:t.startDate,e:t.endDate,closed:!dd||dd.style.display==='none'};
  },taskId);
  ok(single.s===single.e&&/-25$/.test(single.s),'clicking one day twice sets start and end to that day ('+single.s+')');
  ok(single.closed,'the popover closes once that single day is set');

  // ── two clicks in the calendar make a range ──
  await setDates('','');
  await openCell();
  const firstClick=await p.evaluate(async id=>{
    const btns=[...document.querySelectorAll('.ws-cal-d')];
    const d10=btns.find(b=>b.textContent.trim()==='10');
    d10.click();await new Promise(x=>setTimeout(x,400));
    const t=DB.tasks.find(x=>x.id===id);
    const dd=document.getElementById('ws-cell-dd');
    return{s:t.startDate,e:t.endDate,open:!!dd&&dd.style.display!=='none',
      hint:(document.querySelector('.ws-cal-hint')||{}).textContent||''};
  },taskId);
  ok(firstClick.s&&firstClick.s.endsWith('-10'),'the first click sets the start ('+firstClick.s+')');
  ok(!firstClick.e,'the first click leaves the end empty, ready for the second');
  ok(firstClick.open,'the popover stays open between the two clicks');
  ok(/end of the range/i.test(firstClick.hint),'it prompts for the end of the range ("'+firstClick.hint.trim()+'")');

  const secondClick=await p.evaluate(async id=>{
    const btns=[...document.querySelectorAll('.ws-cal-d')];
    btns.find(b=>b.textContent.trim()==='21').click();
    await new Promise(x=>setTimeout(x,400));
    const t=DB.tasks.find(x=>x.id===id);
    const dd=document.getElementById('ws-cell-dd');
    return{s:t.startDate,e:t.endDate,closed:!dd||dd.style.display==='none'};
  },taskId);
  ok(secondClick.s.endsWith('-10')&&secondClick.e.endsWith('-21'),
    'the second click completes the range ('+secondClick.s+' → '+secondClick.e+')');
  ok(secondClick.closed,'the popover closes once the range is complete');

  // ── clicking backwards still produces a sane range ──
  await setDates('','');
  await openCell();
  const backwards=await p.evaluate(async id=>{
    const g=()=>[...document.querySelectorAll('.ws-cal-d')];
    g().find(b=>b.textContent.trim()==='20').click();
    await new Promise(x=>setTimeout(x,350));
    g().find(b=>b.textContent.trim()==='6').click();
    await new Promise(x=>setTimeout(x,350));
    const t=DB.tasks.find(x=>x.id===id);
    return{s:t.startDate,e:t.endDate};
  },taskId);
  ok(backwards.s.endsWith('-06')&&backwards.e.endsWith('-20'),
    'picking the later day first still yields start-before-end ('+backwards.s+' → '+backwards.e+')');

  // ── month navigation ──
  await openCell();
  const nav=await p.evaluate(async()=>{
    const before=document.querySelector('.ws-cal-mon').textContent.trim();
    document.querySelectorAll('.ws-cal-nav')[1].click();
    await new Promise(x=>setTimeout(x,350));
    const fwd=document.querySelector('.ws-cal-mon').textContent.trim();
    document.querySelectorAll('.ws-cal-nav')[0].click();
    await new Promise(x=>setTimeout(x,350));
    document.querySelectorAll('.ws-cal-nav')[0].click();
    await new Promise(x=>setTimeout(x,350));
    const back=document.querySelector('.ws-cal-mon').textContent.trim();
    return{before,fwd,back};
  });
  ok(nav.fwd!==nav.before,'the next-month arrow moves the calendar ('+nav.before+' → '+nav.fwd+')');
  ok(nav.back!==nav.fwd&&nav.back!==nav.before,'the previous-month arrow moves it back ('+nav.back+')');

  // ── clear dates ──
  const cleared=await p.evaluate(async id=>{
    const btn=[...document.querySelectorAll('#ws-cell-dd-body button')].find(b=>/clear dates/i.test(b.textContent));
    if(!btn)return{noBtn:true};
    btn.click();await new Promise(x=>setTimeout(x,400));
    const t=DB.tasks.find(x=>x.id===id);
    const dd=document.getElementById('ws-cell-dd');
    return{s:t.startDate||'',e:t.endDate||'',open:!!dd&&dd.style.display!=='none'};
  },taskId);
  ok(!cleared.noBtn&&!cleared.s&&!cleared.e,'Clear dates empties both ends');
  ok(cleared.open,'the popover stays open after clearing, so you can pick again');

  // ── the year boundary ──
  await setDates('2026-12-28','2027-01-05');
  await openCell();
  const yearEnd=await p.evaluate(()=>{
    const mon=document.querySelector('.ws-cal-mon').textContent.trim();
    const on=[...document.querySelectorAll('.ws-cal-on')].map(b=>b.textContent.trim());
    document.querySelectorAll('.ws-cal-nav')[1].click();
    return{mon,on};
  });
  ok(yearEnd.mon==='December 2026','a range crossing new year opens on the start month ("'+yearEnd.mon+'")');
  const rolled=await p.evaluate(async()=>{await new Promise(x=>setTimeout(x,350));
    return document.querySelector('.ws-cal-mon').textContent.trim();});
  ok(rolled==='January 2027','stepping forward from December rolls into the next year ("'+rolled+'")');

  await p.evaluate(id=>{const t=DB.tasks.find(x=>x.id===id);t.startDate='';t.endDate='';saveDB(DB);},taskId);
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
