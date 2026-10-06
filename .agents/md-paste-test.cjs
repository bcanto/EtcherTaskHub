const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const SAMPLE=`# Site Meeting — Daltech HR Module

**Date:** 6 Sep 2026
**Attendees:** Bruna Canto, Sam Wignall

## Decisions
- Payroll proceeds using the **Humanz connector**
- API key due *Friday*

## Actions
1. Sam to chase the API key
2. Bruna to draft the pro forma
   - approved timesheet hours only

> Without the key by Friday the go-live slips.

| Item | Owner | Due |
|---|---|---|
| API key | Daltech | 11 Sep |

Run \`npm run sync\`. See [runbook](https://example.com/rb).`;

async function pasteInto(p, selector, text){
  await p.evaluate((sel,txt)=>{
    const el=document.querySelector(sel);
    el.focus();
    const dt=new DataTransfer();
    dt.setData('text/plain',txt);
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  },selector,text);
}

(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,160));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];
  const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ---------- 1. DESCRIPTION ----------
  await p.evaluate(()=>{const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);openTaskPanel(t.id);});
  await new Promise(r=>setTimeout(r,900));
  await p.evaluate(()=>{if(!_tpSec.desc){const hd=[...document.querySelectorAll('.tp-sec-hd')].find(h=>/DESCRIPTION/i.test(h.textContent));hd&&hd.click();}});
  await new Promise(r=>setTimeout(r,400));

  await pasteInto(p,'#tp-desc',SAMPLE);
  await new Promise(r=>setTimeout(r,400));
  const popupShown=await p.evaluate(()=>!!document.getElementById('paste-choice-popup'));
  ok(popupShown,'markdown paste offers the Plain / Keep formatting choice');

  await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('#paste-choice-popup button')];
    btns.find(b=>/Keep formatting/.test(b.textContent)).click();
  });
  await new Promise(r=>setTimeout(r,1400));

  const desc=await p.evaluate(()=>{
    const el=document.getElementById('tp-desc');
    const saved=DB.tasks.find(t=>t.id===_tpCurrentTask.id).description||'';
    const d=document.createElement('div');d.innerHTML=saved;
    return {inEditor:{h1:el.querySelectorAll('h1').length,h2:el.querySelectorAll('h2').length,li:el.querySelectorAll('li').length,table:el.querySelectorAll('table').length,strong:el.querySelectorAll('strong').length},
      saved:{h1:d.querySelectorAll('h1').length,h2:d.querySelectorAll('h2').length,li:d.querySelectorAll('li').length,table:d.querySelectorAll('table').length,strong:d.querySelectorAll('strong').length,code:d.querySelectorAll('code').length,blockquote:d.querySelectorAll('blockquote').length,a:d.querySelectorAll('a').length},
      rawMarkers:/\*\*|^#{1,3}\s/m.test(d.textContent)};
  });
  ok(desc.inEditor.h1===1&&desc.inEditor.h2===2,'description editor shows real headings');
  ok(desc.inEditor.table===1,'description editor shows the table');
  ok(desc.saved.h2===2&&desc.saved.li>=4&&desc.saved.table===1&&desc.saved.blockquote===1&&desc.saved.a===1,
     'description SAVED to DB with formatting intact '+JSON.stringify(desc.saved));
  ok(!desc.rawMarkers,'no raw ** or ## left in saved description');

  // reopen the panel — formatting must survive a re-render
  await p.evaluate(()=>closeTaskPanel());
  await new Promise(r=>setTimeout(r,500));
  await p.evaluate(()=>{const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);openTaskPanel(t.id);});
  await new Promise(r=>setTimeout(r,900));
  const reopened=await p.evaluate(()=>{
    const el=document.getElementById('tp-desc');
    if(!el)return null;
    return {h2:el.querySelectorAll('h2').length,li:el.querySelectorAll('li').length,table:el.querySelectorAll('table').length};
  });
  ok(reopened&&reopened.h2===2&&reopened.table===1,'formatting survives closing and reopening the panel '+JSON.stringify(reopened));

  // ---------- 2. MEETING NOTE ----------
  await p.evaluate(()=>tpShowTab('notes'));
  await new Promise(r=>setTimeout(r,600));
  await p.evaluate(()=>tpNoteStartNew());
  await new Promise(r=>setTimeout(r,600));

  const editorIsRich=await p.evaluate(()=>{
    const el=document.getElementById('tpn-body');
    return el?{tag:el.tagName,editable:el.isContentEditable,ready:el.dataset.noteReady}:null;
  });
  ok(editorIsRich&&editorIsRich.editable&&editorIsRich.ready==='1','meeting note body is a wired rich editor '+JSON.stringify(editorIsRich));

  await p.evaluate(()=>{document.getElementById('tpn-title').value='Daltech HR sync';});
  await pasteInto(p,'#tpn-body',SAMPLE);
  await new Promise(r=>setTimeout(r,400));
  await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('#paste-choice-popup button')];
    const k=btns.find(b=>/Keep formatting/.test(b.textContent));
    if(k)k.click();
  });
  await new Promise(r=>setTimeout(r,500));
  await p.evaluate(()=>{const t=_tpCurrentTask;tpNoteSave(t.id);});
  await new Promise(r=>setTimeout(r,1200));

  const note=await p.evaluate(()=>{
    const n=(DB.meetingNotes||[]).filter(x=>x.taskId===_tpCurrentTask.id).slice(-1)[0];
    const d=document.createElement('div');d.innerHTML=n?n.body:'';
    const rendered=document.querySelector('#tp-body .rich-text');
    return {saved:{h2:d.querySelectorAll('h2').length,li:d.querySelectorAll('li').length,table:d.querySelectorAll('table').length,strong:d.querySelectorAll('strong').length},
      rawMarkers:/\*\*|^#{1,3}\s/m.test(d.textContent),
      renderedHasHeadings: rendered?rendered.querySelectorAll('h2').length:-1,
      renderedHasTable: rendered?rendered.querySelectorAll('table').length:-1};
  });
  ok(note.saved.h2===2&&note.saved.li>=4&&note.saved.table===1,'meeting note SAVED with formatting '+JSON.stringify(note.saved));
  ok(!note.rawMarkers,'no raw markdown markers in saved note');
  ok(note.renderedHasHeadings===2&&note.renderedHasTable===1,'expanded note RENDERS the formatting (h2='+note.renderedHasHeadings+', table='+note.renderedHasTable+')');

  // ---------- 3. plain text must stay plain ----------
  await p.evaluate(()=>tpShowTab('details'));
  await new Promise(r=>setTimeout(r,600));
  await pasteInto(p,'#tp-desc','just a normal sentence with no markdown at all');
  await new Promise(r=>setTimeout(r,400));
  const plainPopup=await p.evaluate(()=>!!document.getElementById('paste-choice-popup'));
  ok(!plainPopup,'plain text pastes straight in with no popup');

  await p.screenshot({path:'temporary screenshots/md-paste.png'});
  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
