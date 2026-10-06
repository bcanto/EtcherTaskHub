// The Main Table rolls a parent's timeline up from its subitems; the task panel showed the
// parent's own stored dates, so the two disagreed. They must now match.
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

  // set up exactly the reported situation: a parent whose own dates are stale and whose
  // subitems span a different range
  const ids=await p.evaluate(()=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&DB.tasks.some(k=>k.parentTaskId===t.id&&!k.archived));
    if(!parent)return null;
    const kids=DB.tasks.filter(k=>k.parentTaskId===parent.id&&!k.archived);
    parent.startDate='2026-07-30';parent.endDate='2026-09-11';   // the stale pair
    kids[0].startDate='2026-08-31';kids[0].endDate='2026-09-05';
    kids[kids.length-1].startDate='2026-09-02';kids[kids.length-1].endDate='2026-09-18';
    saveDB(DB);renderView('workspace');
    return{parent:parent.id,kids:kids.length};
  });
  ok(!!ids,'found a parent task with subitems to test against');
  if(!ids){console.log('\nPASS (0):\nFAIL (1):\n  - no parent with subitems in the dataset');await b.close();process.exit(1);}
  await new Promise(r=>setTimeout(r,500));

  const rollup=await p.evaluate(id=>getTaskDateSpan(id),ids.parent);
  ok(rollup&&rollup.startDate==='2026-08-31'&&rollup.endDate==='2026-09-18',
    'the rollup spans the subitems: '+(rollup?rollup.startDate+' → '+rollup.endDate:'none'));

  // what the Main Table shows
  const table=await p.evaluate(id=>{
    const tr=document.querySelector('tr[data-tid="'+id+'"]');
    if(!tr)return null;
    // the Timeline cell is the one whose onclick opens the 'duedate' popover
    const td=[...tr.children].find(c=>/'duedate'/.test(c.getAttribute('onclick')||''));
    return{text:(td?td.textContent:'').replace(/\s+/g,' ').trim(),
      title:(td?td.getAttribute('title'):'')||''};
  },ids.parent);
  ok(!!table&&/rolled up from/i.test(table.title),
    'the Main Table labels the parent row as rolled up ("'+(table?table.title:'')+'")');

  // now the panel
  const panel=await p.evaluate(async id=>{
    openTaskPanel(id);await new Promise(x=>setTimeout(x,700));
    const root=document.getElementById('task-panel');
    const rolled=root.querySelector('.tp-rolled');
    const note=root.querySelector('.tp-rolled-note');
    const inputs=[...root.querySelectorAll('.tp-date input[type=date]')];
    return{
      showsRolled:!!rolled,
      rolledText:rolled?(rolled.textContent||'').replace(/\s+/g,' ').trim():'',
      note:note?note.textContent.trim():'',
      editableInputs:inputs.length,
      inputValues:inputs.map(i=>i.value),
      panelText:(root.innerText||'').replace(/\s+/g,' ')
    };
  },ids.parent);
  ok(panel.showsRolled,'the Details panel shows a rolled-up timeline instead of the stale pair');
  ok(/31\/08\/2026|31 Aug/.test(panel.rolledText)&&/18\/09\/2026|18 Sep/.test(panel.rolledText),
    'the panel shows the subitem span, not the parent dates ("'+panel.rolledText+'")');
  ok(!/30\/07\/2026/.test(panel.rolledText),'the stale 30/07 start is gone from the panel');
  ok(panel.editableInputs===0,'the rolled-up dates are not presented as editable fields');
  ok(/rolled up from '+'/.test(panel.note)||/rolled up from/.test(panel.note),
    'the panel says where the dates came from ("'+panel.note+'")');

  // a task with no subitems keeps its own editable dates
  const leaf=await p.evaluate(async()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId&&!DB.tasks.some(k=>k.parentTaskId===x.id&&!k.archived));
    if(!t)return null;
    t.startDate='2026-09-01';t.endDate='2026-09-04';saveDB(DB);
    openTaskPanel(t.id);await new Promise(x=>setTimeout(x,700));
    const root=document.getElementById('task-panel');
    const inputs=[...root.querySelectorAll('.tp-date input[type=date]')];
    return{rolled:!!root.querySelector('.tp-rolled'),inputs:inputs.length,vals:inputs.map(i=>i.value)};
  });
  ok(leaf&&!leaf.rolled,'a task with no subitems is not shown as rolled up');
  ok(leaf&&leaf.inputs===2,'a task with no subitems keeps both date fields editable');
  ok(leaf&&leaf.vals[0]==='2026-09-01'&&leaf.vals[1]==='2026-09-04','those fields show its own dates');

  // editing a subitem's date moves the parent's panel figure
  const after=await p.evaluate(async id=>{
    const kid=DB.tasks.filter(k=>k.parentTaskId===id&&!k.archived)[0];
    kid.startDate='2026-08-01';saveDB(DB);
    openTaskPanel(id);await new Promise(x=>setTimeout(x,700));
    const r=document.getElementById('task-panel').querySelector('.tp-rolled');
    return r?(r.textContent||'').replace(/\s+/g,' ').trim():'';
  },ids.parent);
  ok(/01\/08\/2026|1 Aug/.test(after),'moving a subitem updates the parent panel ("'+after+'")');

  // ── the Gantt must show the same rolled-up span, not the parent's own dates ──
  const gantt=await p.evaluate(async id=>{
    try{closeTaskPanel()}catch(_){}
    // reset to a clean, known spread: parent 30/07–11/09, kids 01/08–18/09
    const parent=DB.tasks.find(t=>t.id===id);
    const kids=DB.tasks.filter(k=>k.parentTaskId===id&&!k.archived);
    parent.startDate='2026-07-30';parent.endDate='2026-09-11';
    kids[0].startDate='2026-08-01';kids[0].endDate='2026-09-05';
    kids[kids.length-1].startDate='2026-09-02';kids[kids.length-1].endDate='2026-09-18';
    saveDB(DB);
    navigate('gantt');await new Promise(x=>setTimeout(x,900));
    // find the parent's row in the left panel by its name
    const nameCell=[...document.querySelectorAll('#g2-left-body div')]
      .find(d=>d.textContent&&d.textContent.includes(parent.name)&&d.querySelector('span'));
    const label=nameCell?(nameCell.innerText||'').replace(/\s+/g,' ').trim():'';
    const bar=document.getElementById('g2-bar-'+id);
    const cs=bar?getComputedStyle(bar):null;
    return{
      label,
      showsRolled:/01\/08\/2026|1 Aug/.test(label)&&/18\/09\/2026|18 Sep/.test(label),
      showsStale:/30\/07\/2026|30 Jul/.test(label),
      barExists:!!bar,
      barIsSummary:bar?bar.classList.contains('g2-bar-rollup'):false,
      barHasDragHandler:bar?!!bar.getAttribute('onmousedown'):null,
      hasResizeHandles:bar?bar.querySelectorAll('.g2-rh').length:0
    };
  },ids.parent);
  ok(gantt.barExists,'the parent has a bar in the Gantt');
  ok(gantt.showsRolled,'the Gantt label shows the rolled-up subitem span ("'+gantt.label+'")');
  ok(!gantt.showsStale,'the Gantt no longer shows the stale parent dates');
  ok(gantt.barIsSummary,'the rolled-up parent bar is marked as a summary bar');
  ok(!gantt.barHasDragHandler,'the summary bar is not draggable');
  ok(gantt.hasResizeHandles===0,'the summary bar has no resize handles');

  // a leaf task in the Gantt still shows and drags its own dates
  const gLeaf=await p.evaluate(async()=>{
    const t=DB.tasks.find(x=>!x.parentTaskId&&!DB.tasks.some(k=>k.parentTaskId===x.id&&!k.archived&&(k.startDate||k.endDate)));
    if(!t)return null;
    t.startDate='2026-09-01';t.endDate='2026-09-09';saveDB(DB);
    navigate('gantt');await new Promise(x=>setTimeout(x,800));
    const bar=document.getElementById('g2-bar-'+t.id);
    return bar?{summary:bar.classList.contains('g2-bar-rollup'),drag:!!bar.getAttribute('onmousedown'),
      handles:bar.querySelectorAll('.g2-rh').length}:null;
  });
  ok(gLeaf&&!gLeaf.summary,'a leaf task bar is not marked as a summary');
  ok(gLeaf&&gLeaf.drag,'a leaf task bar is still draggable');
  ok(gLeaf&&gLeaf.handles===2,'a leaf task bar keeps its two resize handles');

  await p.evaluate(()=>{try{closeTaskPanel()}catch(_){}});
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
