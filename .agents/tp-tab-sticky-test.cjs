const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  // Changing the owner posts an assignment email to /api/notify-email, which only exists
  // in the deployed function environment — locally it 404s. Not this suite's business.
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── tab order ──────────────────────────────────────────────────
  const order=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    openWorkboard(bid);await new Promise(r=>setTimeout(r,500));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,700));
    return {ids:[...document.querySelectorAll('.tp-tab')].map(x=>x.id.replace('tp-tab-','')),
            active:_tpActiveTab,
            bodyIsDetails:!!document.querySelector('#tp-body .tp-prop')};
  });
  console.log('ORDER:',JSON.stringify(order));
  ok(order.ids[0]==='details','Details is the first tab');
  ok(order.ids[1]==='notes','Meeting Notes sits directly after Details');
  ok(order.ids.join(',')==='details,notes,subtasks,dependencies,activity,recurrence','full order is Details, Meeting Notes, Subitems, Dependencies, Activity, Recurrence');
  ok(order.active==='details'&&order.bodyIsDetails,'opening the panel starts on Details');

  // ── header saves must repaint the tab you are on, not Details ──
  const sticky=await p.evaluate(async()=>{
    const task=_tpCurrentTask;
    const keep={status:task.status,ownerId:task.ownerId};
    const other=(DB.staff.find(s=>s.id!==task.ownerId)||DB.staff[0]).id;
    const probe=async(tab,field,value)=>{
      tpShowTab(tab);await new Promise(r=>setTimeout(r,300));
      tpSaveField(field,value);await new Promise(r=>setTimeout(r,450));
      return {tab,field,
        active:[...document.querySelectorAll('.tp-tab.active')].map(x=>x.id.replace('tp-tab-','')).join(','),
        tracked:_tpActiveTab,
        bodyIsDetails:!!document.querySelector('#tp-body .tp-prop')};
    };
    const out=[];
    out.push(await probe('notes','ownerId',other));
    out.push(await probe('notes','status','ready-approval'));
    out.push(await probe('subtasks','ownerId',keep.ownerId||other));
    out.push(await probe('dependencies','status','in-progress'));
    out.push(await probe('activity','ownerId',other));
    out.push(await probe('recurrence','status',keep.status||'todo'));
    const det=await probe('details','ownerId',keep.ownerId||other);
    Object.assign(task,keep);saveDB(DB);
    return {out,det};
  });
  sticky.out.forEach(r=>{
    console.log('  '+r.tab.padEnd(13),'save '+r.field.padEnd(8),'active='+r.active,'details='+r.bodyIsDetails);
    ok(r.active===r.tab&&r.tracked===r.tab&&!r.bodyIsDetails,'saving '+r.field+' from the header keeps you on '+r.tab);
  });
  ok(sticky.det.active==='details'&&sticky.det.bodyIsDetails,'Details still repaints itself after a header save');

  // ── writing meeting notes keeps you on Meeting Notes ───────────
  const notes=await p.evaluate(async()=>{
    const task=_tpCurrentTask;
    const st=()=>({active:_tpActiveTab,details:!!document.querySelector('#tp-body .tp-prop')});
    const out={};
    tpShowTab('notes');await new Promise(r=>setTimeout(r,300));
    tpNoteStartNew();await new Promise(r=>setTimeout(r,350));
    out.form=!!document.getElementById('tpn-title');
    document.getElementById('tpn-title').value='Sticky probe note';
    const bd=document.getElementById('tpn-body');
    if(bd)bd.innerHTML='Body text';
    tpNoteSave(task.id);await new Promise(r=>setTimeout(r,600));
    out.afterSave=st();
    const n=(DB.meetingNotes||[]).find(x=>x.title==='Sticky probe note');
    out.saved=!!n;
    tpNoteStartEdit(n.id);await new Promise(r=>setTimeout(r,350));
    document.getElementById('tpn-e-title-'+n.id).value='Sticky probe note v2';
    tpNoteSaveEdit(n.id);await new Promise(r=>setTimeout(r,450));
    out.afterEdit=st();
    out.edited=(DB.meetingNotes||[]).some(x=>x.title==='Sticky probe note v2');
    DB.meetingNotes=(DB.meetingNotes||[]).filter(x=>!/^Sticky probe note/.test(x.title));
    saveDB(DB);tpShowTab('notes');await new Promise(r=>setTimeout(r,300));
    return out;
  });
  console.log('NOTES:',JSON.stringify(notes));
  ok(notes.form,'the new-note form opens');
  ok(notes.saved&&notes.afterSave.active==='notes'&&!notes.afterSave.details,'saving a note leaves you on Meeting Notes');
  ok(notes.edited&&notes.afterEdit.active==='notes'&&!notes.afterEdit.details,'editing a note leaves you on Meeting Notes');

  // ── an incoming sync must not repaint over someone typing ──────
  const typing=await p.evaluate(async()=>{
    tpShowTab('notes');await new Promise(r=>setTimeout(r,300));
    tpNoteStartNew();await new Promise(r=>setTimeout(r,350));
    const el=document.getElementById('tpn-title');
    el.focus();el.value='half typed';
    const guardedInput=_tpUserIsTyping();
    const bd=document.getElementById('tpn-body');
    bd.focus();
    const guardedEditor=_tpUserIsTyping();
    document.getElementById('tp-body').focus?.();
    el.blur();bd.blur();
    const idle=_tpUserIsTyping();
    tpNoteCancel();await new Promise(r=>setTimeout(r,300));
    return {guardedInput,guardedEditor,idle};
  });
  console.log('TYPING GUARD:',JSON.stringify(typing));
  ok(typing.guardedInput,'a focused note title counts as typing');
  ok(typing.guardedEditor,'a focused note editor counts as typing');
  ok(!typing.idle,'nothing focused in the panel is not typing');

  // ── Details-side repaints still work ───────────────────────────
  const tags=await p.evaluate(async()=>{
    const task=_tpCurrentTask;
    tpShowTab('details');await new Promise(r=>setTimeout(r,350));
    task.tags=['probe-tag'];saveDB(DB);
    tpShowTab('details');await new Promise(r=>setTimeout(r,350));
    const before=(document.getElementById('tp-body').textContent||'').includes('probe-tag');
    tpRemoveTag('probe-tag');await new Promise(r=>setTimeout(r,450));
    return {before,gone:!(document.getElementById('tp-body').textContent||'').includes('probe-tag'),
            active:_tpActiveTab,details:!!document.querySelector('#tp-body .tp-prop')};
  });
  console.log('TAGS:',JSON.stringify(tags));
  ok(tags.before&&tags.gone,'removing a tag still updates the Details pane');
  ok(tags.active==='details'&&tags.details,'and leaves you on Details');

  // ── closing resets, so the next task opens on Details ──────────
  const reset=await p.evaluate(async()=>{
    tpShowTab('notes');await new Promise(r=>setTimeout(r,300));
    closeTaskPanel();await new Promise(r=>setTimeout(r,400));
    const afterClose=_tpActiveTab;
    const t=DB.tasks.find(x=>_taskBoardId(x)===DB.workboards[0].id&&!x.parentTaskId);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,600));
    const afterOpen={active:_tpActiveTab,details:!!document.querySelector('#tp-body .tp-prop'),
      activeTabEl:[...document.querySelectorAll('.tp-tab.active')].map(x=>x.id.replace('tp-tab-','')).join(',')};
    // and opening straight onto a named tab still works
    openTaskPanel(t.id,'notes');await new Promise(r=>setTimeout(r,600));
    const direct={active:_tpActiveTab,details:!!document.querySelector('#tp-body .tp-prop')};
    closeTaskPanel();await new Promise(r=>setTimeout(r,400));
    return {afterClose,afterOpen,direct};
  });
  console.log('RESET:',JSON.stringify(reset));
  ok(reset.afterClose==='details','closing the panel resets the remembered tab');
  ok(reset.afterOpen.active==='details'&&reset.afterOpen.details&&reset.afterOpen.activeTabEl==='details','reopening starts on Details');
  ok(reset.direct.active==='notes'&&!reset.direct.details,'openTaskPanel(id,"notes") still lands on Meeting Notes');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
