const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  // Owner changes POST to /api/notify-email, which only exists in the deployed function
  // environment — a local 404 there is not this suite's concern.
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── 1. task panel is 1cm wider (520 -> 558) ────────────────────
  const w=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,600));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    openTaskPanel(t.id);await new Promise(r=>setTimeout(r,700));
    const px=getComputedStyle(document.getElementById('task-panel')).width;
    const overflow=document.getElementById('task-panel').scrollWidth>document.getElementById('task-panel').clientWidth+1;
    if(typeof closeTaskPanel==='function')closeTaskPanel();
    return {px,overflow};
  });
  console.log('PANEL:',JSON.stringify(w));
  ok(w.px==='558px','task panel is 558px wide (520 + 1cm)');
  ok(!w.overflow,'panel content does not overflow the wider frame');

  // ── 2. topbar shows the board client, not the board name ───────
  const tb=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const vt=document.getElementById('view-title');
    const inBoard={text:vt.textContent.trim(),visible:getComputedStyle(vt).display!=='none',
      fontPx:parseFloat(getComputedStyle(vt).fontSize),
      barH:Math.round(document.getElementById('topbar').getBoundingClientRect().height),
      client:boardClient(currentWorkboard)?.name||null};
    navigate('dashboard');await new Promise(r=>setTimeout(r,600));
    const outBoard={text:vt.textContent.trim(),visible:getComputedStyle(vt).display!=='none'};
    // a client-less board
    const wb=currentWorkboard||DB.workboards[0];
    const keep=(DB.workboards.find(x=>x.id===bid)||{}).clientId;
    if(typeof saveWbClient==='function'){saveWbClient(bid,'');}
    openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const noneText=document.getElementById('view-title').textContent.trim();
    if(typeof saveWbClient==='function'){saveWbClient(bid,keep||'');}
    navigate('dashboard');await new Promise(r=>setTimeout(r,400));
    return {inBoard,outBoard,noneText,boardName:(DB.workboards.find(x=>x.id===bid)||{}).name};
  });
  console.log('TOPBAR:',JSON.stringify(tb));
  ok(tb.inBoard.visible,'the topbar title slot is shown inside a board (was hidden before)');
  ok(tb.inBoard.client&&tb.inBoard.text.includes(tb.inBoard.client),'it shows the board client ("'+tb.inBoard.text+'")');
  ok(tb.inBoard.text!==tb.boardName,'it is NOT the board name ("'+tb.boardName+'")');
  ok(tb.inBoard.fontPx===15,'styled as a client heading, not the 17px page title ('+tb.inBoard.fontPx+'px)');
  ok(tb.inBoard.barH===56,'the board header is the standard 56px, same as every other page');
  ok(tb.outBoard.text==='Dashboard'&&tb.outBoard.visible,'outside a board the normal page title is back');
  ok(/no client/i.test(tb.noneText),'a client-less board shows "No client set" ("'+tb.noneText+'")');

  // ── 3. main table search must not drop characters at ~120ms ────
  let dropped=0;
  for(let i=0;i<3;i++){
    await p.evaluate(async()=>{openWorkboard(DB.workboards[0].id);await new Promise(r=>setTimeout(r,600));
      wsMtSearch='';renderView('workspace');});
    await new Promise(r=>setTimeout(r,500));
    await p.click('.mt-search');
    await p.type('.mt-search','timeline',{delay:120});
    await new Promise(r=>setTimeout(r,700));
    const v=await p.$eval('.mt-search',e=>e.value);
    if(v!=='timeline'){dropped++;console.log('  run '+i+' -> "'+v+'"');}
  }
  await p.evaluate(()=>{wsMtSearch='';renderView('workspace');});
  console.log('SEARCH: dropped '+dropped+'/3 runs at 120ms cadence');
  ok(dropped===0,'typing "timeline" at a 120ms cadence is never truncated');

  // ── 4. a paste into a note box lands at the caret and persists ─
  const paste=await p.evaluate(async()=>{
    navigate('notes');await new Promise(r=>setTimeout(r,900));
    const el=document.querySelector('#note-page .note-box-body');
    if(!el)return{err:'no note box'};
    const boxId=el.dataset.box;
    const secId=(()=>{const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
      return (o.sections||[]).find(s=>(s.boxes||[]).some(x=>x.id===boxId))?.id;})();
    el.focus();
    const rng=document.createRange();rng.selectNodeContents(el);rng.collapse(false);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(rng);
    const dt=new DataTransfer();
    dt.setData('text/html','<span>CARET-MARK</span>');
    dt.setData('text/plain','CARET-MARK');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,300));
    const pop=document.getElementById('paste-choice-popup');
    const out={popup:!!pop};
    if(!pop)return out;
    const btn=pop.querySelectorAll('button')[1];
    // popup mousedown must NOT blur the editor
    btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,40));
    out.editorStillFocused=document.activeElement===el;
    btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await new Promise(r=>setTimeout(r,350));
    const live=document.querySelector('#note-page .note-box-body[data-box="'+boxId+'"]');
    out.visible=!!live&&live.textContent.includes('CARET-MARK');
    out.atTop=!!live&&live.textContent.trim().startsWith('CARET-MARK');
    const stored=(()=>{const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
      const s=(o.sections||[]).find(x=>x.id===secId);
      const bx=(s?.boxes||[]).find(x=>x.id===boxId);return bx?bx.html:'';})();
    out.stored=stored.includes('CARET-MARK');
    renderNotes();await new Promise(r=>setTimeout(r,300));
    const live2=document.querySelector('#note-page .note-box-body[data-box="'+boxId+'"]');
    out.survives=!!live2&&live2.textContent.includes('CARET-MARK');
    // cleanup: strip the marker back out
    const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
    const s=(o.sections||[]).find(x=>x.id===secId);
    const bx=(s?.boxes||[]).find(x=>x.id===boxId);
    if(bx){bx.html=bx.html.replace(/<span>CARET-MARK<\/span>/g,'').replace(/CARET-MARK/g,'');saveDB(DB);}
    return out;
  });
  console.log('PASTE:',JSON.stringify(paste));
  ok(paste.popup,'the "Paste as" popup still opens');
  ok(paste.editorStillFocused,'pressing a popup button does NOT blur the note box');
  ok(paste.visible&&!paste.atTop,'pasted text lands at the caret, not at the top of the box');
  ok(paste.stored,'the paste is written to DB.clientNotes, not lost on blur');
  ok(paste.survives,'and it is still there after a full re-render');

  // ── 5. a plain blur on a note box does not rebuild the page ────
  const blur=await p.evaluate(async()=>{
    navigate('notes');await new Promise(r=>setTimeout(r,700));
    const el=document.querySelector('#note-page .note-box-body');
    if(!el)return{err:'no box'};
    const page=document.getElementById('note-page');
    page.dataset.sentinel='keep';           // survives only if the page is NOT rebuilt
    el.focus();
    el.dispatchEvent(new Event('input',{bubbles:true}));   // touch it, no real change
    el.blur();
    await new Promise(r=>setTimeout(r,250));
    const p2=document.getElementById('note-page');
    return {sentinel:p2?p2.dataset.sentinel:null,boxes:document.querySelectorAll('#note-page .note-box').length};
  });
  console.log('BLUR:',JSON.stringify(blur));
  ok(blur.sentinel==='keep','clicking out of an unchanged box does not rebuild the whole page');
  ok(blur.boxes>0,'the box is still there after blur');

  // ── stray box guard ───────────────────────────────────────────
  const stray=await p.evaluate(async()=>{
    navigate('notes');await new Promise(r=>setTimeout(r,700));
    const pg=document.getElementById('note-page');
    const before=document.querySelectorAll('#note-page .note-box').length;
    const secId=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(s=>s.id===selectedNoteSectionId).id;
    // selection active → a click that ends a drag-select must not spawn a box
    const tn=pg.querySelector('.note-box-body')?.firstChild;
    if(tn){const rng=document.createRange();rng.setStart(tn,0);rng.setEnd(tn,Math.min(3,tn.length||1));
      const s=window.getSelection();s.removeAllRanges();s.addRange(rng);}
    const r=pg.getBoundingClientRect();
    notePageClick({clientX:r.left+500,clientY:r.top+380,target:pg},secId);
    await new Promise(r=>setTimeout(r,200));
    const afterSel=document.querySelectorAll('#note-page .note-box').length;
    window.getSelection().removeAllRanges();
    // no selection → a genuine bare-page click still adds one
    notePageClick({clientX:r.left+500,clientY:r.top+520,target:pg},secId);
    await new Promise(r=>setTimeout(r,300));
    const afterClean=document.querySelectorAll('#note-page .note-box').length;
    // cleanup the one we just made
    const sec=_noteSection(secId);
    sec.boxes=sec.boxes.slice(0,before);saveDB(DB);renderNotes();
    return {before,afterSel,afterClean};
  });
  console.log('STRAY:',JSON.stringify(stray));
  ok(stray.afterSel===stray.before,'ending a text selection on the page does not create a box');
  ok(stray.afterClean===stray.before+1,'a genuine bare-page click still creates one');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
