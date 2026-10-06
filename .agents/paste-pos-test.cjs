const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const MD='## Decisions\n- one **bold** thing\n- two\n\n1. action\n2. action two';
async function paste(p,sel,txt){
  await p.evaluate((s,t)=>{
    const el=document.querySelector(s);el.focus();
    const dt=new DataTransfer();dt.setData('text/plain',t);
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  },sel,txt);
}
async function popInfo(p,sel){
  return p.evaluate(s=>{
    const pop=document.getElementById('paste-choice-popup');
    if(!pop)return null;
    const r=pop.getBoundingClientRect();
    const e=document.querySelector(s).getBoundingClientRect();
    return {pos:getComputedStyle(pop).position,visible:getComputedStyle(pop).visibility,
      pop:{t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)},
      ed:{t:Math.round(e.top),l:Math.round(e.left),b:Math.round(e.bottom),r:Math.round(e.right)},
      inViewport:r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,
      dx:Math.round(r.left-e.left), dyFromEditor:Math.round(r.top-e.bottom)};
  },sel);
}
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  await p.evaluate(()=>{const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);openTaskPanel(t.id);});
  await new Promise(r=>setTimeout(r,900));

  // ---- CASE 1: EMPTY meeting note editor (the reported bug) ----
  await p.evaluate(()=>tpShowTab('notes'));await new Promise(r=>setTimeout(r,600));
  await p.evaluate(()=>tpNoteStartNew());await new Promise(r=>setTimeout(r,700));
  await paste(p,'#tpn-body',MD);await new Promise(r=>setTimeout(r,400));
  let i=await popInfo(p,'#tpn-body');
  console.log('EMPTY NOTE EDITOR:',JSON.stringify(i));
  ok(i&&i.pos==='fixed','popup uses fixed positioning');
  ok(i&&i.visible==='visible','popup is visible');
  ok(i&&Math.abs(i.dx)<=4,'popup left-aligns with the editor (dx='+(i&&i.dx)+')');
  ok(i&&i.dyFromEditor>=0&&i.dyFromEditor<=20,'popup sits just below the editor (dy='+(i&&i.dyFromEditor)+')');
  ok(i&&i.inViewport,'popup fully inside viewport');
  await p.screenshot({path:'temporary screenshots/paste-pop-note.png'});
  await p.evaluate(()=>document.getElementById('paste-choice-popup')?.remove());

  // ---- CASE 2: description editor WITH existing content (caret rect valid) ----
  await p.evaluate(()=>tpShowTab('details'));await new Promise(r=>setTimeout(r,700));
  await p.evaluate(()=>{if(!_tpSec.desc){[...document.querySelectorAll('.tp-sec-hd')].find(h=>/DESCRIPTION/i.test(h.textContent))?.click();}});
  await new Promise(r=>setTimeout(r,500));
  await paste(p,'#tp-desc',MD);await new Promise(r=>setTimeout(r,400));
  i=await popInfo(p,'#tp-desc');
  console.log('DESCRIPTION EDITOR:',JSON.stringify(i));
  ok(i&&i.inViewport,'description popup inside viewport');
  ok(i&&i.pop.t>=i.ed.t-80&&i.pop.t<=i.ed.b+40,'description popup near its editor');
  await p.screenshot({path:'temporary screenshots/paste-pop-desc.png'});

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs:'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
