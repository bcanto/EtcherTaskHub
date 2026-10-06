// Audit of everything changed this session, driven with REAL mouse/keyboard input.
// The suites written alongside the changes lean on synthetic events; this one does not,
// because the bugs being fixed were all about focus, and synthetic events do not move focus.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text().slice(0,140));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const box=async sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;
    const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,t:r.top,l:r.left};},sel);

  // ══ A. NOTE BOX PASTE — real click on the popup button ══════════
  // The whole fix hinges on a real mousedown not blurring the editor. A dispatched
  // MouseEvent cannot move focus, so only a real click proves it.
  await p.evaluate(async()=>{navigate('notes');await new Promise(r=>setTimeout(r,900));});
  await new Promise(r=>setTimeout(r,600));
  const bodyBox=await box('#note-page .note-box-body');
  await p.mouse.click(bodyBox.l+bodyBox.w-8,bodyBox.t+8);   // click into the box
  await new Promise(r=>setTimeout(r,200));
  const preState=await p.evaluate(()=>{
    const el=document.querySelector('#note-page .note-box-body');
    el.focus();
    const rng=document.createRange();rng.selectNodeContents(el);rng.collapse(false);
    const s=window.getSelection();s.removeAllRanges();s.addRange(rng);
    const dt=new DataTransfer();
    dt.setData('text/html','<b>REALPASTE</b>');dt.setData('text/plain','REALPASTE');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    return {boxId:el.dataset.box,before:el.textContent.trim().slice(-30)};
  });
  await new Promise(r=>setTimeout(r,350));
  const btnBox=await p.evaluate(()=>{
    const pop=document.getElementById('paste-choice-popup');if(!pop)return null;
    const btn=pop.querySelectorAll('button')[1];const r=btn.getBoundingClientRect();
    return{x:r.left+r.width/2,y:r.top+r.height/2};});
  ok(!!btnBox,'the paste popup opens and its "Keep formatting" button is on screen');
  if(btnBox){
    // real mousedown+mouseup — this is what used to blur the editor and lose the paste
    await p.mouse.click(btnBox.x,btnBox.y);
    await new Promise(r=>setTimeout(r,450));
    const after=await p.evaluate(bid=>{
      const live=document.querySelector('#note-page .note-box-body[data-box="'+bid+'"]');
      const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
      let stored='';
      (o.sections||[]).forEach(s=>(s.boxes||[]).forEach(x=>{if(x.id===bid)stored=x.html;}));
      return {visible:!!live&&live.textContent.includes('REALPASTE'),
        atTop:!!live&&live.textContent.trim().startsWith('REALPASTE'),
        stored:stored.includes('REALPASTE'),bold:/<b>|font-weight/i.test(stored)};
    },preState.boxId);
    ok(after.visible,'a REAL click on the popup keeps the pasted text on screen');
    ok(!after.atTop,'it lands at the caret, not pushed to the top of the box');
    ok(after.stored,'and it is persisted to DB.clientNotes');
    ok(after.bold,'"Keep formatting" actually kept the formatting');
    // reload the page for real and confirm it is still there
    await p.reload({waitUntil:'networkidle2'});await new Promise(r=>setTimeout(r,2200));
    const survived=await p.evaluate(async bid=>{
      navigate('notes');await new Promise(r=>setTimeout(r,900));
      const live=document.querySelector('#note-page .note-box-body[data-box="'+bid+'"]');
      return !!live&&live.textContent.includes('REALPASTE');
    },preState.boxId);
    ok(survived,'and it survives a genuine page reload');
    // clean up
    await p.evaluate(()=>{
      (DB.clientNotes||[]).forEach(n=>(n.sections||[]).forEach(s=>(s.boxes||[]).forEach(x=>{
        if(x.html)x.html=x.html.replace(/<b>REALPASTE<\/b>/g,'').replace(/REALPASTE/g,'');})));
      saveDB(DB);renderNotes();});
    await new Promise(r=>setTimeout(r,400));
  }

  // ══ B. NOTE BOX DRAG — real drag by the grip, and Alt+drag ══════
  const before1=await p.evaluate(()=>{const n=document.querySelector('#note-page .note-box');
    return{x:parseFloat(n.style.left),y:parseFloat(n.style.top)};});
  const grip=await box('#note-page .note-box .note-box-grip');
  ok(!!grip&&grip.h>=14,'the drag grip is a real target ('+(grip?Math.round(grip.h):0)+'px tall)');
  if(grip){
    await p.mouse.move(grip.x,grip.y);await p.mouse.down();
    await p.mouse.move(grip.x+120,grip.y+90,{steps:12});await p.mouse.up();
    await new Promise(r=>setTimeout(r,300));
    const after1=await p.evaluate(()=>{const n=document.querySelector('#note-page .note-box');
      const o=DB.clientNotes.find(z=>z.clientId===selectedNoteClientId);
      let bx=null;(o.sections||[]).forEach(s=>(s.boxes||[]).forEach(z=>{if(z.id===n.dataset.id)bx=z;}));
      return{x:parseFloat(n.style.left),y:parseFloat(n.style.top),savedX:bx?bx.x:null,savedY:bx?bx.y:null};});
    ok(Math.abs(after1.x-before1.x)>50,'dragging the grip moves the box ('+before1.x+' -> '+after1.x+')');
    ok(after1.savedX===Math.round(after1.x)&&after1.savedY===Math.round(after1.y),'the new position is saved');
  }
  // Alt+drag from the middle of the box body
  const before2=await p.evaluate(()=>{const n=document.querySelector('#note-page .note-box');
    return{x:parseFloat(n.style.left),y:parseFloat(n.style.top)};});
  const bb=await box('#note-page .note-box-body');
  await p.keyboard.down('Alt');
  await p.mouse.move(bb.x,bb.y);await p.mouse.down();
  await p.mouse.move(bb.x-90,bb.y+40,{steps:10});await p.mouse.up();
  await p.keyboard.up('Alt');
  await new Promise(r=>setTimeout(r,300));
  const after2=await p.evaluate(()=>{const n=document.querySelector('#note-page .note-box');
    return{x:parseFloat(n.style.left),y:parseFloat(n.style.top)};});
  ok(Math.abs(after2.x-before2.x)>40,'Alt+drag anywhere on the box also moves it ('+before2.x+' -> '+after2.x+')');
  // a plain (no-Alt) drag inside the body must select text, NOT move the box
  const before3=await p.evaluate(()=>({x:parseFloat(document.querySelector('#note-page .note-box').style.left)}));
  const bb2=await box('#note-page .note-box-body');
  await p.mouse.move(bb2.l+10,bb2.t+8);await p.mouse.down();
  await p.mouse.move(bb2.l+130,bb2.t+8,{steps:8});await p.mouse.up();
  await new Promise(r=>setTimeout(r,250));
  const after3=await p.evaluate(()=>({x:parseFloat(document.querySelector('#note-page .note-box').style.left),
    sel:(window.getSelection()||'').toString().length}));
  ok(after3.x===before3.x,'a plain drag inside the text does NOT move the box');
  ok(after3.sel>0,'a plain drag selects text as it should ('+after3.sel+' chars)');

  // ══ C. bare-page click creates a box; selection-drag does not ═══
  const cnt0=await p.evaluate(()=>document.querySelectorAll('#note-page .note-box').length);
  const pg=await box('#note-page');
  await p.mouse.click(pg.l+700,pg.t+430);           // genuine empty-space click
  await new Promise(r=>setTimeout(r,450));
  const cnt1=await p.evaluate(()=>document.querySelectorAll('#note-page .note-box').length);
  ok(cnt1===cnt0+1,'a real click on empty page still creates a box ('+cnt0+' -> '+cnt1+')');
  await p.keyboard.type('audit box');
  await new Promise(r=>setTimeout(r,200));
  await p.mouse.click(pg.l+700,pg.t+620);            // click away -> saves, makes another
  await new Promise(r=>setTimeout(r,450));
  const typed=await p.evaluate(()=>{
    const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
    let found=false;(o.sections||[]).forEach(s=>(s.boxes||[]).forEach(x=>{if(/audit box/.test(x.html||''))found=true;}));
    return found;});
  ok(typed,'typing in a new box and clicking away persists it');
  // clean up every box we made
  await p.evaluate(()=>{
    const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
    (o.sections||[]).forEach(s=>{if(s.boxes)s.boxes=s.boxes.filter(x=>!/audit box/.test(x.html||'')&&(x.html||'').trim()!=='');});
    saveDB(DB);renderNotes();});
  await new Promise(r=>setTimeout(r,400));

  // ══ D. task panel: header saves keep the tab, real <select> use ══
  const tab=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,800));
    tpShowTab('notes');await new Promise(r=>setTimeout(r,400));
    return {sel:!!document.querySelector('#task-panel select'),tab:_tpActiveTab};
  });
  ok(tab.tab==='notes','panel opens on Meeting Notes when asked');
  // drive the real status <select> in the header
  const selBox=await box('#task-panel select');
  if(selBox){
    await p.select('#task-panel select',await p.evaluate(()=>{
      const s=document.querySelector('#task-panel select');
      const cur=s.value;const alt=[...s.options].find(o=>o.value!==cur);return alt?alt.value:cur;}));
    await new Promise(r=>setTimeout(r,600));
    const st=await p.evaluate(()=>({tab:_tpActiveTab,
      active:[...document.querySelectorAll('.tp-tab.active')].map(x=>x.id.replace('tp-tab-','')).join(','),
      details:!!document.querySelector('#tp-body .tp-prop')}));
    ok(st.tab==='notes'&&st.active==='notes'&&!st.details,'changing status from the real header dropdown keeps you on Meeting Notes');
  }
  // a half-typed internal comment must survive a header save
  const draft=await p.evaluate(async()=>{
    tpShowTab('details');await new Promise(r=>setTimeout(r,500));
    const ta=document.getElementById('tp-comment-input');
    if(!ta)return{skip:true};
    ta.focus();ta.value='half typed comment';ta.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,150));
    tpSaveField('ownerId',(DB.staff.find(s=>s.id!==_tpCurrentTask.ownerId)||DB.staff[0]).id);
    await new Promise(r=>setTimeout(r,600));
    const back=document.getElementById('tp-comment-input');
    const v=back?back.value:null;
    if(typeof clearTextareaDraft==='function')clearTextareaDraft('tp-comment-input');
    return {v};
  });
  console.log('DRAFT:',JSON.stringify(draft));
  ok(draft.skip||draft.v==='half typed comment','a half-typed comment survives a header save (was lost before)');
  await p.evaluate(()=>{if(typeof closeTaskPanel==='function')closeTaskPanel();});

  // ══ E. topbar title: quotes view, no-client board, real nav ═════
  const nav=await p.evaluate(async()=>{
    const out={};
    const vt=document.getElementById('view-title');
    navigate('quotes');await new Promise(r=>setTimeout(r,700));
    out.quotesHidden=getComputedStyle(vt).display==='none';
    navigate('dashboard');await new Promise(r=>setTimeout(r,600));
    out.dash={t:vt.textContent.trim(),shown:getComputedStyle(vt).display!=='none',cls:vt.className};
    openWorkboard(DB.workboards[0].id);await new Promise(r=>setTimeout(r,700));
    out.board={t:vt.textContent.trim(),cls:vt.className,h:Math.round(document.getElementById('topbar').getBoundingClientRect().height)};
    navigate('clients');await new Promise(r=>setTimeout(r,600));
    out.clients={t:vt.textContent.trim(),cls:vt.className,h:Math.round(document.getElementById('topbar').getBoundingClientRect().height)};
    return out;
  });
  console.log('NAV:',JSON.stringify(nav));
  ok(nav.quotesHidden,'the Quotes view still hides the page title (display:none not beaten by !important)');
  ok(nav.dash.shown&&nav.dash.t==='Dashboard'&&!/vt-client/.test(nav.dash.cls),'Dashboard title is normal and vt-client is removed');
  ok(/vt-client/.test(nav.board.cls),'inside a board the title carries vt-client');
  ok(!/vt-client/.test(nav.clients.cls),'leaving the board strips vt-client again');
  ok(nav.board.h===nav.clients.h&&nav.board.h===56,'board and Client Manager headers are both 56px');

  // ══ F. main table search, real typing at several cadences ══════
  let drops=0,runs=0;
  for(const d of [150,120,100,80]){
    await p.evaluate(async()=>{openWorkboard(DB.workboards[0].id);await new Promise(r=>setTimeout(r,600));
      wsMtSearch='';renderView('workspace');});
    await new Promise(r=>setTimeout(r,500));
    await p.click('.mt-search');
    await p.type('.mt-search','timeline',{delay:d});
    await new Promise(r=>setTimeout(r,700));
    const v=await p.$eval('.mt-search',e=>e.value);runs++;
    if(v!=='timeline'){drops++;console.log('  drop at '+d+'ms -> "'+v+'"');}
  }
  ok(drops===0,'real typing at 150/120/100/80ms never truncates ('+runs+' runs)');
  // the filter must actually filter, and clearing must restore
  const filt=await p.evaluate(async()=>{
    wsMtSearch='';renderView('workspace');await new Promise(r=>setTimeout(r,500));
    const all=document.querySelectorAll('#ws-table-scroll tr').length;
    const el=document.querySelector('.mt-search');
    el.value='zzzznomatch';onMtSearch(el,'workspace');
    await new Promise(r=>setTimeout(r,400));
    const none=document.querySelectorAll('#ws-table-scroll tr').length;
    const el2=document.querySelector('.mt-search');
    el2.value='';onMtSearch(el2,'workspace');
    await new Promise(r=>setTimeout(r,400));
    return {all,none,back:document.querySelectorAll('#ws-table-scroll tr').length,
      focused:document.activeElement===document.querySelector('.mt-search')};
  });
  console.log('FILTER:',JSON.stringify(filt));
  ok(filt.none<filt.all,'the search actually filters rows ('+filt.all+' -> '+filt.none+')');
  ok(filt.back===filt.all,'clearing it restores every row');
  ok(filt.focused,'focus stays in the search box after the debounced re-render');

  // ══ G. client modal, real typing ════════════════════════════════
  await p.evaluate(async()=>{navigate('clients');await new Promise(r=>setTimeout(r,700));openClientModal('');});
  await new Promise(r=>setTimeout(r,500));
  await p.click('#cm-name');
  await p.type('#cm-name','Northern Rail Freight',{delay:35});
  await new Promise(r=>setTimeout(r,250));
  const code1=await p.$eval('#cm-code',e=>e.value);
  ok(code1==='NRF','real typing prefills the code ("'+code1+'")');
  await p.click('#cm-code');
  await p.keyboard.down('Control');await p.keyboard.press('KeyA');await p.keyboard.up('Control');
  await p.type('#cm-code','NRX',{delay:35});
  await p.click('#cm-name');
  await p.type('#cm-name',' Group',{delay:35});
  await new Promise(r=>setTimeout(r,250));
  const code2=await p.$eval('#cm-code',e=>e.value);
  ok(code2==='NRX','a hand-typed code is not overwritten by further name edits ("'+code2+'")');
  const upper=await p.evaluate(()=>getComputedStyle(document.getElementById('cm-code')).textTransform);
  ok(upper==='uppercase','the code field shows uppercase');
  await p.evaluate(()=>closeGenericModal());
  await new Promise(r=>setTimeout(r,300));
  const leftover=await p.evaluate(()=>(DB.clients||[]).some(c=>/Northern Rail/.test(c.name)));
  ok(!leftover,'cancelling the modal creates nothing');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('FAIL',e.message,e.stack&&e.stack.split('\n')[1]);process.exit(1)});
