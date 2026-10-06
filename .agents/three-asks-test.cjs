const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1900));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── 1. move tasks to another group ─────────────────────────────
  const move=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    openWorkboard(bid);await new Promise(r=>setTimeout(r,800));
    const groups=getWbGroups();
    const from=groups[0],to=groups.find(g=>g.id!==from.id);
    const picked=DB.tasks.filter(t=>t.groupId===from.id&&!t.parentTaskId).slice(0,2);
    window._mKeep=picked.map(t=>({id:t.id,g:t.groupId,
      subs:DB.tasks.filter(s=>s.parentTaskId===t.id).map(s=>({id:s.id,g:s.groupId}))}));
    const subIds=picked.flatMap(t=>DB.tasks.filter(s=>s.parentTaskId===t.id).map(s=>s.id));
    wsSelected=new Set(picked.map(t=>t.id));updateBulkBar();
    await new Promise(r=>setTimeout(r,300));
    const hasControl=!!document.querySelector('select[onchange*="wsBulkMoveToGroup"]');
    const optionCount=document.querySelectorAll('select[onchange*="wsBulkMoveToGroup"] option').length;
    wsBulkMoveToGroup(to.id);await new Promise(r=>setTimeout(r,700));
    const moved=picked.every(t=>DB.tasks.find(x=>x.id===t.id).groupId===to.id);
    const subsFollowed=subIds.length===0||subIds.every(id=>DB.tasks.find(x=>x.id===id).groupId===to.id);
    const cleared=wsSelected.size===0;
    // put it back
    window._mKeep.forEach(k=>{const t=DB.tasks.find(x=>x.id===k.id);if(t)t.groupId=k.g;
      k.subs.forEach(s=>{const st=DB.tasks.find(x=>x.id===s.id);if(st)st.groupId=s.g;});});
    saveDB(DB);
    return {hasControl,optionCount,groups:groups.length,picked:picked.length,subIds:subIds.length,moved,subsFollowed,cleared};
  });
  console.log('MOVE GROUP:',JSON.stringify(move));
  ok(move.hasControl,'the selection bar offers "Move to group…"');
  ok(move.optionCount===move.groups+1,'it lists every group on the board ('+move.groups+' + the placeholder)');
  ok(move.moved,'the selected tasks land in the new group');
  ok(move.subsFollowed,'their subitems follow ('+move.subIds+' checked)');
  ok(move.cleared,'the selection clears afterwards');

  // ── 2. completing a task takes progress to 100% ────────────────
  const done=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    window._dKeep={id:t.id,s:t.status,p:t.percentComplete,c:t.completedAt};
    t.status='in-progress';t.percentComplete=11;t.completedAt=null;saveDB(DB);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,800));
    const before=_tpCurrentTask.percentComplete;
    const out={before,byStatus:{}};
    for(const s of ['done','completed','completed-approved']){
      _tpCurrentTask.percentComplete=11;_tpCurrentTask.status='in-progress';
      tpSaveField('status',s);await new Promise(r=>setTimeout(r,350));
      out.byStatus[s]={pct:_tpCurrentTask.percentComplete,completedAt:!!_tpCurrentTask.completedAt};
    }
    // a non-final status must NOT be forced to 100
    _tpCurrentTask.percentComplete=40;
    tpSaveField('status','in-progress');await new Promise(r=>setTimeout(r,350));
    out.inProgressPct=_tpCurrentTask.percentComplete;
    // the shown value is what is stored
    tpSaveField('status','done');await new Promise(r=>setTimeout(r,500));
    out.shown=(document.querySelector('.tp-prog-pct')||{}).textContent;
    const k=window._dKeep;const tt=DB.tasks.find(x=>x.id===k.id);
    tt.status=k.s;tt.percentComplete=k.p;tt.completedAt=k.c;saveDB(DB);
    if(typeof closeTaskPanel==='function')closeTaskPanel();
    return out;
  });
  console.log('COMPLETE→100:',JSON.stringify(done));
  ok(done.before===11,'the task started on 11%');
  ['done','completed','completed-approved'].forEach(s=>{
    ok(done.byStatus[s].pct===100,'"'+s+'" sets progress to 100%');
    ok(done.byStatus[s].completedAt,'"'+s+'" stamps completedAt');
  });
  ok(done.inProgressPct===40,'a non-final status leaves progress alone ('+done.inProgressPct+'%)');
  ok(done.shown==='100%','the panel shows 100% straight away');

  // ── 3. timesheet note: required on every entry, task or client ──
  const ts=await p.evaluate(async()=>{
    navigate('time');await new Promise(r=>setTimeout(r,900));
    const out={};
    const alerts=[];const realAlert=window.showAlert;window.showAlert=(m,t)=>alerts.push((t||'')+': '+m);
    const before=(DB.timeEntries||[]).length;

    // client mode, no note -> refused
    if(typeof _teMode!=='undefined'){_teMode='client';renderView('time');await new Promise(r=>setTimeout(r,700));}
    out.clientLabelStarred=!!document.querySelector('label.form-label')&&
      [...document.querySelectorAll('label.form-label')].some(l=>/Note/.test(l.textContent)&&/\*/.test(l.textContent));
    const setC=()=>{const c=document.getElementById('te-client');if(c&&!c.value)c.value=(DB.clients[0]||{}).id;
      const h=document.getElementById('te-hours');if(h)h.value='2';
      const d=document.getElementById('te-date');if(d&&!d.value)d.value=new Date().toISOString().slice(0,10);};
    setC();
    const n=document.getElementById('te-note');if(n)n.value='';
    logTime();await new Promise(r=>setTimeout(r,400));
    out.refusedWithoutNote=(DB.timeEntries||[]).length===before;
    out.alert=alerts[alerts.length-1]||null;

    // client mode with a note -> accepted
    setC();
    const n2=document.getElementById('te-note');if(n2)n2.value='Audit prep call';
    logTime();await new Promise(r=>setTimeout(r,600));
    out.acceptedWithNote=(DB.timeEntries||[]).length===before+1;

    // task mode, no note -> accepted
    if(typeof _teMode!=='undefined'){_teMode='task';renderView('time');await new Promise(r=>setTimeout(r,700));}
    out.taskLabelStarred=[...document.querySelectorAll('label.form-label')].some(l=>/^Note/.test(l.textContent.trim())&&/\*/.test(l.textContent));
    const t=DB.tasks.find(x=>!x.parentTaskId);
    const hid=document.getElementById('te-task');if(hid)hid.value=t.id;
    const h2=document.getElementById('te-hours');if(h2)h2.value='1.5';
    const d2=document.getElementById('te-date');if(d2&&!d2.value)d2.value=new Date().toISOString().slice(0,10);
    const n3=document.getElementById('te-note');if(n3)n3.value='';
    logTime();await new Promise(r=>setTimeout(r,600));
    out.taskNoNoteAccepted=(DB.timeEntries||[]).length===before+2;
    // and it saves once a note is written
    const hid2=document.getElementById('te-task');if(hid2)hid2.value=t.id;
    const h3=document.getElementById('te-hours');if(h3)h3.value='1.5';
    const d3=document.getElementById('te-date');if(d3&&!d3.value)d3.value=new Date().toISOString().slice(0,10);
    const n4=document.getElementById('te-note');if(n4)n4.value='Drafted the inspection checklist';
    logTime();await new Promise(r=>setTimeout(r,600));
    out.taskWithNoteAccepted=(DB.timeEntries||[]).length===before+2;

    window.showAlert=realAlert;
    DB.timeEntries=(DB.timeEntries||[]).slice(0,before);saveDB(DB);
    return out;
  });
  console.log('TIMESHEET NOTE:',JSON.stringify(ts));
  ok(ts.refusedWithoutNote,'logging against a client with no note is refused');
  ok(/Note Required/.test(ts.alert||''),'and says why ("'+(ts.alert||'').slice(0,60)+'…")');
  ok(ts.acceptedWithNote,'the same entry saves once a note is written');
  ok(ts.clientLabelStarred,'Client mode marks Note as required');
  ok(ts.taskLabelStarred,'Task mode marks it required too — every entry needs a note');
  ok(!ts.taskNoNoteAccepted,'logging against a task with no note is refused as well');
  ok(ts.taskWithNoteAccepted,'and saves once a note is written');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
