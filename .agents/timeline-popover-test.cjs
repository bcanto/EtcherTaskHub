// Setting a Timeline range used to close the popover after the start date, forcing a
// reopen to add the end date. It must now stay up until both ends are set.
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
  await p.evaluate(async()=>{
    if(!currentWorkboard)openWorkboard(DB.workboards[0].id);
    navigate('workspace');await new Promise(x=>setTimeout(x,800));
  });

  ok(await p.evaluate(()=>typeof wsCellSaveDate==='function'),'wsCellSaveDate() exists');

  // clear the dates on a task so we start from an empty range
  const taskId=await p.evaluate(()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId);
    t.startDate='';t.endDate='';saveDB(DB);renderView('workspace');
    return t.id;
  });
  await new Promise(r=>setTimeout(r,500));

  const openPopover=async()=>{
    await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
    const cell=await p.$('td[title="Timeline"],td[title="Due date"],td[title="Start / End"]');
    if(cell){await cell.click();}
    else{
      // fall back to the app's own opener with a synthetic event carrying currentTarget
      await p.evaluate(id=>{
        const td=[...document.querySelectorAll('.ws-row td')].find(x=>/wsCellOpen\('[^']+','duedate'/.test(x.getAttribute('onclick')||''));
        if(td)td.click();
      },taskId);
    }
    await new Promise(r=>setTimeout(r,450));
  };

  await openPopover();
  const opened=await p.evaluate(()=>{
    const dd=document.getElementById('ws-cell-dd');
    return{visible:!!dd&&dd.style.display!=='none',
      field:typeof _wsCellField!=='undefined'?_wsCellField:null,
      dates:document.querySelectorAll('#ws-cell-dd-body input[type=date]').length};
  });
  ok(opened.visible,'the Timeline popover opens');
  ok(opened.dates===2,'it shows Start and End / Due (found '+opened.dates+')');
  if(!opened.visible||opened.dates!==2){
    // Stopping here would leave every check below simply unrun, and a suite reporting
    // "pass=2 fail=1" reads far milder than one that never exercised the behaviour it
    // exists to guard. Register what can no longer be reached as failed, then stop.
    [ 'the start date is saved',
      'the popover STAYS OPEN after the start date — this was the bug',
      'the end field is still there to fill in',
      'the end field was reachable without reopening the cell',
      'both dates are saved as a range',
      'the popover closes once the range is complete',
      'setting the end date first also keeps the popover open',
      'it closes once the other end is filled in, whichever order',
      'a normal cell edit still closes the popover as it always did',
    ].forEach(m=>ok(false,m+'  [NOT REACHED — the popover did not open with the expected fields]'));
    console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
    console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
    console.log('ERRORS:',errs.length?errs:'none');
    await b.close();process.exit(1);
  }

  // set only the start date, exactly as the date picker does
  const afterStart=await p.evaluate(async()=>{
    const inp=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[0];   // Start
    inp.value='2026-08-31';
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,450));
    const dd=document.getElementById('ws-cell-dd');
    const t=DB.tasks.find(x=>x.startDate==='2026-08-31');
    return{stillOpen:!!dd&&dd.style.display!=='none',
      saved:!!t,
      endFieldStillThere:document.querySelectorAll('#ws-cell-dd-body input[type=date]').length===2};
  });
  ok(afterStart.saved,'the start date is saved');
  ok(afterStart.stillOpen,'the popover STAYS OPEN after the start date — this was the bug');
  ok(afterStart.endFieldStillThere,'the end field is still there to fill in');

  // now the end date, without reopening anything
  const afterEnd=await p.evaluate(async()=>{
    const inp=document.querySelectorAll('#ws-cell-dd-body input[type=date]')[1];   // End / Due
    if(!inp)return{noField:true};
    inp.value='2026-09-11';
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,450));
    const dd=document.getElementById('ws-cell-dd');
    const t=DB.tasks.find(x=>x.startDate==='2026-08-31'&&x.endDate==='2026-09-11');
    return{closed:!dd||dd.style.display==='none',saved:!!t};
  });
  ok(!afterEnd.noField,'the end field was reachable without reopening the cell');
  ok(afterEnd.saved,'both dates are saved as a range');
  ok(afterEnd.closed,'the popover closes once the range is complete');

  // the reverse order works too: end first, then start
  await p.evaluate(()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId);t.startDate='';t.endDate='';saveDB(DB);renderView('workspace');
  });
  await new Promise(r=>setTimeout(r,400));
  await openPopover();
  const reverse=await p.evaluate(async()=>{
    const ins=document.querySelectorAll('#ws-cell-dd-body input[type=date]');
    ins[1].value='2026-09-20';ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(x=>setTimeout(x,400));
    const dd=document.getElementById('ws-cell-dd');
    const openAfterEnd=!!dd&&dd.style.display!=='none';
    const ins2=document.querySelectorAll('#ws-cell-dd-body input[type=date]');
    let closedAfterStart=null;
    if(ins2[0]){
      ins2[0].value='2026-09-10';ins2[0].dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(x=>setTimeout(x,400));
      const dd2=document.getElementById('ws-cell-dd');
      closedAfterStart=!dd2||dd2.style.display==='none';
    }
    return{openAfterEnd,closedAfterStart};
  });
  ok(reverse.openAfterEnd,'setting the end date first also keeps the popover open');
  ok(reverse.closedAfterStart===true,'it closes once the other end is filled in, whichever order');

  // other cell types must still close on save, as before
  await p.evaluate(()=>{try{wsCellClose()}catch(_){}});
  const other=await p.evaluate(async()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId);
    const dd=document.getElementById('ws-cell-dd');
    if(dd)dd.style.display='block';
    wsCellSave(t.id,'priority','high');
    await new Promise(x=>setTimeout(x,300));
    const d2=document.getElementById('ws-cell-dd');
    return !d2||d2.style.display==='none';
  });
  ok(other,'a normal cell edit still closes the popover as it always did');

  await p.evaluate(()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId);
    t.startDate='';t.endDate='';saveDB(DB);
  });
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
