// Guards the Client Notes "glitchy on live, fine on localhost" bug: a Supabase merge from
// another session used to repaint the view mid-keystroke, dropping the caret and redrawing
// the box being typed in as empty. Locally Supabase is unconfigured so it never showed.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  const api=await p.evaluate(()=>({
    guard:typeof _userIsTypingAnywhere==='function',
    repaint:typeof _repaintAfterMerge==='function'}));
  ok(api.guard,'_userIsTypingAnywhere() exists');
  ok(api.repaint,'_repaintAfterMerge() exists');

  await p.evaluate(async()=>{navigate('notes');await new Promise(x=>setTimeout(x,900));});

  const spot=await p.evaluate(()=>{
    const c=document.getElementById('note-page');
    if(!c)return null;
    const r=c.getBoundingClientRect();
    const taken=[...document.querySelectorAll('.note-box')].map(b=>b.getBoundingClientRect());
    for(let dy=260;dy<r.height-60;dy+=70){
      const y=r.top+dy,x=r.left+r.width*0.45;
      if(!taken.some(t=>y>t.top-30&&y<t.bottom+30))return{x:Math.round(x),y:Math.round(y)};
    }
    return null;
  });
  ok(!!spot,'found an empty spot on the notes page');
  if(!spot){done();return;}

  await p.mouse.click(spot.x,spot.y);
  await new Promise(r=>setTimeout(r,600));
  const TEXT='Site meeting with GCR about crane 4';
  await p.keyboard.type(TEXT,{delay:20});
  await new Promise(r=>setTimeout(r,250));

  ok(await p.evaluate(()=>{const e=document.activeElement;
    return !!(e&&e.classList&&e.classList.contains('note-box-body'));}),
    'the new note box is focused and being typed into');
  ok(await p.evaluate(()=>typeof _userIsTypingAnywhere==='function'&&_userIsTypingAnywhere()),
    'the guard correctly reports that someone is typing');

  // a merge arrives from another session, exactly as the realtime handler delivers it
  const during=await p.evaluate(async(txt)=>{
    _repaintAfterMerge();
    await new Promise(x=>setTimeout(x,400));
    const e=document.activeElement;
    return{
      stillEditing:!!(e&&e.classList&&e.classList.contains('note-box-body')),
      textIntact:!!(e&&(e.textContent||'').includes(txt)),
      caretKept:(()=>{const s=window.getSelection();return !!(s&&s.rangeCount&&e&&e.contains(s.anchorNode));})(),
      visible:[...document.querySelectorAll('.note-box')].some(x=>(x.textContent||'').includes(txt))
    };
  },TEXT);
  ok(during.stillEditing,'a merge mid-typing does not throw you out of the box');
  ok(during.textIntact,'the text you were typing is still in the box');
  ok(during.caretKept,'the caret stays inside the box you were editing');
  ok(during.visible,'the typed text is still visible on the page');

  // once you click away, the deferred repaint runs and the page catches up
  const after=await p.evaluate(async(txt)=>{
    document.activeElement.blur();
    await new Promise(x=>setTimeout(x,600));
    return{
      typing:_userIsTypingAnywhere(),
      stillOnPage:[...document.querySelectorAll('.note-box')].some(x=>(x.textContent||'').includes(txt)),
      inDb:JSON.stringify(DB).includes(txt)
    };
  },TEXT);
  ok(!after.typing,'once you click away the guard reports you have stopped');
  ok(after.inDb,'the note reached the database');
  ok(after.stillOnPage,'the note survives the deferred repaint');

  // and with nobody typing, a merge repaints immediately as it always did
  const idle=await p.evaluate(async()=>{
    let painted=false;const real=window.renderView;
    window.renderView=(v)=>{painted=true;return real(v);};
    _repaintAfterMerge();
    await new Promise(x=>setTimeout(x,200));
    window.renderView=real;
    return painted;
  });
  ok(idle,'with nobody typing, a merge still repaints straight away');

  await p.evaluate(txt=>{
    (DB.noteSections||[]).forEach(s=>{
      if(Array.isArray(s.boxes))s.boxes=s.boxes.filter(b=>!String(b.html||'').includes(txt));
    });
    saveDB(DB);
  },TEXT);

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
