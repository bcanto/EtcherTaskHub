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

  // deliberately messy positions
  await p.evaluate(()=>{
    const cid=DB.clients[0].id;
    let o=DB.clientNotes.find(n=>n.clientId===cid);
    if(!o){o={id:'cn'+uid(),clientId:cid,sections:[]};DB.clientNotes.push(o);}
    o.sections=[{id:'sec-a',title:'LOGINS',boxes:[
      {id:'b1',x:17,y:140,w:430,html:'Portal one'},
      {id:'b2',x:611,y:213,w:430,html:'Portal two'},
      {id:'b3',x:88,y:388,w:430,html:'Portal three'},
      {id:'b4',x:734,y:502,w:430,html:'Portal four'},
      {id:'b5',x:301,y:651,w:430,html:'Portal five'}
    ],updatedAt:new Date().toISOString()}];
    selectedNoteClientId=cid;selectedNoteSectionId='sec-a';saveDB(DB);navigate('notes');
  });
  await new Promise(r=>setTimeout(r,900));

  // ---- toolbar has both new controls ----
  const tb=await p.evaluate(()=>({
    hilite:!!document.querySelector('.note-hilite-btn'),
    menu:!!document.getElementById('note-hilite-menu'),
    swatches:document.querySelectorAll('#note-hilite-menu > button').length,
    align:[...document.querySelectorAll('.note-toolbar .rdt-btn')].some(b=>/Align/.test(b.textContent))
  }));
  console.log('TOOLBAR:',JSON.stringify(tb));
  ok(tb.hilite&&tb.menu,'highlight control present');
  ok(tb.swatches>=5,'highlight offers colours + none ('+tb.swatches+')');
  ok(tb.align,'Align button present');

  // ---- highlight applies ----
  const hl=await p.evaluate(async()=>{
    const el=document.querySelector('.note-box-body');
    el.focus();
    const r=document.createRange();r.selectNodeContents(el);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);
    noteHilite('#fff3a3');
    await new Promise(x=>setTimeout(x,200));
    const html=el.innerHTML;
    el.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
    await new Promise(x=>setTimeout(x,400));
    const sec=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(s2=>s2.id==='sec-a');
    return {html,persisted:sec.boxes.some(bx=>/background/i.test(bx.html||''))};
  });
  console.log('HIGHLIGHT:',JSON.stringify({applied:/background/i.test(hl.html),persisted:hl.persisted}));
  ok(/background/i.test(hl.html),'highlight applies a background colour');
  ok(hl.persisted,'the highlight is saved with the note');

  // menu closes after choosing
  ok(await p.evaluate(()=>document.getElementById('note-hilite-menu').classList.contains('hidden')),
     'the colour menu closes after picking');

  // ---- auto-align tidies into columns ----
  const before=await p.evaluate(()=>{
    const s=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(x=>x.id==='sec-a');
    return {xs:[...new Set(s.boxes.map(b=>b.x))].sort((a,c)=>a-c)};
  });
  await p.evaluate(()=>noteAutoAlign('sec-a'));
  await new Promise(r=>setTimeout(r,700));
  const after=await p.evaluate(()=>{
    const s=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(x=>x.id==='sec-a');
    const xs=[...new Set(s.boxes.map(b=>b.x))].sort((a,c)=>a-c);
    return {xs,count:s.boxes.length,
      allBelowHeader:s.boxes.every(b=>b.y>=_NOTE_HEADER_H),
      noOverlapInColumn:(()=>{
        const byCol={};s.boxes.forEach(b=>{(byCol[b.x]=byCol[b.x]||[]).push(b.y);});
        return Object.values(byCol).every(ys=>new Set(ys).size===ys.length);
      })()};
  });
  console.log('ALIGN:',JSON.stringify({before:before.xs,after:after.xs}));
  ok(before.xs.length>after.xs.length,'scattered x positions collapse into columns ('+before.xs.length+' -> '+after.xs.length+')');
  ok(after.xs.length<=3&&after.xs.length>=1,'boxes land in a small number of columns ('+after.xs.length+')');
  ok(after.count===5,'no box is lost in the tidy-up');
  ok(after.allBelowHeader,'aligned boxes stay clear of the header');
  ok(after.noOverlapInColumn,'boxes in a column do not stack on the same y');

  // ---- dragging snaps to another box edge ----
  const snap=await p.evaluate(async()=>{
    const s=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(x=>x.id==='sec-a');
    const target=s.boxes[0];
    const mover=s.boxes.find(b=>b.x!==target.x)||s.boxes[1];
    // start it 5px off the target column, well inside the snap radius
    mover.x=target.x+5;mover.y=target.y+240;saveDB(DB);renderNotes();
    await new Promise(x=>setTimeout(x,400));
    const node=document.querySelector('#note-page .note-box[data-id="'+mover.id+'"]');
    const grip=node.querySelector('.note-box-grip');
    grip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:500,clientY:500}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:502,clientY:502}));
    const guideVisible=(()=>{const g=document.getElementById('note-guide-x');return !!g&&g.style.display==='block';})();
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    await new Promise(x=>setTimeout(x,300));
    const s2=DB.clientNotes.find(n=>n.clientId===selectedNoteClientId).sections.find(x=>x.id==='sec-a');
    const moved=s2.boxes.find(b=>b.id===mover.id);
    return {targetX:target.x,movedX:moved.x,guideVisible,
      guideHidden:(()=>{const g=document.getElementById('note-guide-x');return !g||g.style.display==='none';})()};
  });
  console.log('SNAP:',JSON.stringify(snap));
  ok(snap.movedX===snap.targetX,'a dragged box snaps onto the neighbouring column ('+snap.movedX+' = '+snap.targetX+')');
  ok(snap.guideVisible,'an alignment guide shows while snapped');
  ok(snap.guideHidden,'the guide disappears on drop');

  await p.evaluate(()=>noteAutoAlign('sec-a'));
  await new Promise(r=>setTimeout(r,600));
  await p.screenshot({path:'temporary screenshots/notes-aligned.png'});

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
