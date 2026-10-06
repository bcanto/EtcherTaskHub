const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1700,height:1000,deviceScaleFactor:2}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // legacy plain-text note — must migrate to a box, losing nothing
  await p.evaluate(()=>{
    const cid=DB.clients[0].id;
    let o=DB.clientNotes.find(n=>n.clientId===cid);
    if(!o){o={id:'cn'+uid(),clientId:cid,sections:[]};DB.clientNotes.push(o);}
    o.sections=[{id:'sec-a',title:'LOGINS',
      content:'Username: etcher@gcswa.com.au\nPassword: Etcher123\nNAS admin / a*b_c#1',
      updatedAt:new Date().toISOString()}];
    delete o.sections[0].boxes;
    selectedNoteClientId=cid;selectedNoteSectionId='sec-a';saveDB(DB);navigate('notes');
  });
  await new Promise(r=>setTimeout(r,900));

  // ---- header, OneNote style ----
  const hd=await p.evaluate(()=>{
    const t=document.querySelector('.note-title');
    const d=document.querySelector('.note-date');
    const hdEl=document.querySelector('.note-page-hd');
    const rule=hdEl?getComputedStyle(hdEl,'::after'):null;
    const cs=t?getComputedStyle(t):null;
    return {title:t?t.value:null,fontSize:cs?cs.fontSize:null,weight:cs?cs.fontWeight:null,
      date:d?d.textContent.trim():null,
      ruleWidth:rule?rule.width:null,ruleColor:rule?rule.backgroundColor:null,
      editableTitle:!!t&&t.tagName==='INPUT'};
  });
  console.log('HEADER:',JSON.stringify(hd));
  ok(hd.title==='LOGINS','page title shown ("'+hd.title+'")');
  ok(parseInt(hd.fontSize)>=26,'title is large like OneNote ('+hd.fontSize+')');
  ok(hd.weight==='400','title is light weight, not bold ('+hd.weight+')');
  ok(hd.ruleWidth&&parseInt(hd.ruleWidth)>100,'a thin rule sits under the title ('+hd.ruleWidth+')');
  ok(/\w+day, \d+ \w+ \d{4}/.test(hd.date||''),'date line under the rule ("'+hd.date+'")');
  ok(hd.editableTitle,'the title is editable in place');

  // ---- legacy content migrated into a box ----
  const mig=await p.evaluate(()=>{
    const sec=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(s=>s.id==='sec-a');
    const boxes=document.querySelectorAll('.note-box');
    return {stored:Array.isArray(sec.boxes)?sec.boxes.length:0,rendered:boxes.length,
      text:boxes[0]?boxes[0].textContent:'',password:document.querySelector('.note-page').textContent.includes('a*b_c#1')};
  });
  console.log('MIGRATION:',JSON.stringify({stored:mig.stored,rendered:mig.rendered,pw:mig.password}));
  ok(mig.stored===1&&mig.rendered===1,'legacy plain-text note became one box');
  ok(/Etcher123/.test(mig.text),'its content carried over');
  ok(mig.password,'password characters survive untouched');

  // ---- click anywhere on the page → box appears THERE ----
  const placed=await p.evaluate(async()=>{
    const page=document.getElementById('note-page');
    const r=page.getBoundingClientRect();
    const before=document.querySelectorAll('.note-box').length;
    page.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+700,clientY:r.top+420}));
    await new Promise(x=>setTimeout(x,300));
    const boxes=[...document.querySelectorAll('.note-box')];
    const last=boxes[boxes.length-1];
    const lr=last.getBoundingClientRect();
    const focused=document.activeElement&&document.activeElement.classList.contains('note-box-body');
    return {before,after:boxes.length,focused,
      dx:Math.round(lr.left-(r.left+700)),dy:Math.round(lr.top-(r.top+420))};
  });
  console.log('PLACE:',JSON.stringify(placed));
  ok(placed.after===placed.before+1,'clicking the page adds a box');
  ok(Math.abs(placed.dx)<12&&Math.abs(placed.dy)<12,'the box lands where you clicked (off by '+placed.dx+','+placed.dy+'px)');
  ok(placed.focused,'the new box takes the caret immediately');

  // ---- boxes must never sit on top of the title block ----
  const clear=await p.evaluate(()=>{
    const hd=document.querySelector('.note-page-hd').getBoundingClientRect();
    const boxes=[...document.querySelectorAll('.note-box')].map(b=>b.getBoundingClientRect());
    return {headerBottom:Math.round(hd.bottom),minBoxTop:Math.round(Math.min(...boxes.map(b=>b.top))),
      overlapping:boxes.filter(b=>b.top<hd.bottom-2).length};
  });
  console.log('CLEARANCE:',JSON.stringify(clear));
  ok(clear.overlapping===0,'no box overlaps the title/date header');

  // ---- typing in it saves; an empty box removes itself ----
  const typed=await p.evaluate(async()=>{
    const el=document.activeElement;
    el.innerHTML='Zapier etcher@gcswa.com.au';
    el.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
    await new Promise(x=>setTimeout(x,400));
    const sec=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(s=>s.id==='sec-a');
    return {boxes:sec.boxes.length,hasText:sec.boxes.some(b=>/Zapier/.test(b.html||'')),
      mailto:!!document.querySelector('.note-box-body a[href^="mailto:"]')};
  });
  console.log('TYPE:',JSON.stringify(typed));
  ok(typed.hasText,'typing is saved into that box');
  ok(typed.mailto,'a typed email becomes a clickable link');

  const emptied=await p.evaluate(async()=>{
    const page=document.getElementById('note-page');
    const r=page.getBoundingClientRect();
    const before=document.querySelectorAll('.note-box').length;
    page.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+300,clientY:r.top+600}));
    await new Promise(x=>setTimeout(x,300));
    document.activeElement.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
    await new Promise(x=>setTimeout(x,400));
    return {before,after:document.querySelectorAll('.note-box').length};
  });
  ok(emptied.after===emptied.before,'a box left empty removes itself');

  // ---- boxes are draggable ----
  const drag=await p.evaluate(()=>({
    grips:document.querySelectorAll('.note-box-grip').length,
    dels:document.querySelectorAll('.note-box-del').length,
    fn:typeof noteBoxDragStart==='function'
  }));
  ok(drag.grips>0&&drag.fn,'each box has a move grip');
  ok(drag.dels>0,'each box can be deleted');

  const moved=await p.evaluate(async()=>{
    const sec=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(s=>s.id==='sec-a');
    const bx=sec.boxes[0];const before={x:bx.x,y:bx.y};
    const grip=document.querySelector('.note-box .note-box-grip');
    grip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:200,clientY:200}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:320,clientY:280}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    await new Promise(x=>setTimeout(x,250));
    return {before,after:{x:sec.boxes[0].x,y:sec.boxes[0].y}};
  });
  console.log('DRAG:',JSON.stringify(moved));
  ok(moved.after.x!==moved.before.x||moved.after.y!==moved.before.y,'dragging a box moves and persists it');

  // ---- toolbar ----
  const tb=await p.evaluate(()=>[...document.querySelectorAll('.note-toolbar .rdt-btn')].map(b=>b.title));
  console.log('TOOLBAR:',JSON.stringify(tb));
  ok(tb.length>=6,'minimal formatting toolbar present ('+tb.length+')');
  ok(tb.includes('Bold')&&tb.some(t=>/list/i.test(t)),'bold and lists available');

  // ---- structure intact ----
  ok(await p.evaluate(()=>!!document.querySelector('.notes-clients')&&!!document.querySelector('.notes-sections')),
     'three-column layout intact');
  ok(await p.evaluate(async()=>{
    const other=DB.clients[1];if(!other)return true;
    selectNoteClient(other.id);await new Promise(x=>setTimeout(x,350));
    return !!document.getElementById('notes-pane');
  }),'switching client re-renders');

  await p.evaluate(()=>{selectNoteClient(DB.clients[0].id);selectNoteSection('sec-a');});
  await new Promise(r=>setTimeout(r,500));
  await p.screenshot({path:'temporary screenshots/notes-onenote.png'});

  // ── an untouched box vanishes on blur; switching away mid-edit does not crash ──
  const jsErrs=[];
  p.on('pageerror',e=>jsErrs.push(e.message));
  const box=await p.evaluate(async()=>{
    navigate('notes');await new Promise(x=>setTimeout(x,700));
    const o=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId);
    const sid=(o.sections||[])[0].id;
    selectNoteSection(sid);await new Promise(x=>setTimeout(x,300));
    const s=o.sections.find(x=>x.id===sid);
    const before=(s.boxes||[]).length;
    const pg=document.getElementById('note-page');const r=pg.getBoundingClientRect();
    notePageClick({clientX:r.left+420,clientY:r.top+320,target:pg},sid);
    await new Promise(x=>setTimeout(x,250));
    const created=(s.boxes||[]).length;
    // blur without typing → the box removes itself, no delete-cross left behind
    const el=[...document.querySelectorAll('#note-page .note-box-body')].pop();
    el.blur();
    await new Promise(x=>setTimeout(x,300));
    const afterEmpty=(s.boxes||[]).length;
    // the crash path the user hit: an empty box is being edited, its blur handler
    // removes it AND the blur was fired by a re-render (switching section). The blur
    // must not re-enter renderNotes.
    notePageClick({clientX:r.left+420,clientY:r.top+360,target:pg},sid);
    await new Promise(x=>setTimeout(x,250));
    const el2=[...document.querySelectorAll('#note-page .note-box-body')].pop();
    el2.focus();
    const other=(o.sections||[]).find(x=>x.id!==sid);
    // fire blur (as leaving the box does) then immediately switch — mirrors a real click on the sidebar
    el2.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
    if(other){selectNoteSection(other.id);}
    await new Promise(x=>setTimeout(x,400));
    return {before,created,afterEmpty,
      survived:!!document.querySelector('.notes-editor')&&!!document.getElementById('view-container'),
      noLeftoverEmpty:(s.boxes||[]).every(b=>(b.html||'').replace(/<[^>]*>/g,'').trim())};
  });
  console.log('EMPTY-BOX:',JSON.stringify(box));
  ok(box.created===box.before+1,'clicking an empty spot creates a text box');
  ok(box.afterEmpty===box.before,'clicking away without typing removes it again');
  ok(box.survived,'switching section while an empty box is open does not blow up the view');
  ok(box.noLeftoverEmpty,'no empty boxes are left behind');
  ok(jsErrs.filter(m=>/no longer a child|innerHTML/i.test(m)).length===0,'no re-entrant renderNotes error thrown');

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
