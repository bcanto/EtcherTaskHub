const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,200));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));

  // login
  const needLogin=await p.$('#login-email');
  if(needLogin){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,1800));
  }
  console.log('logged in as',await p.evaluate(()=>currentUser?currentUser.email+' ('+currentUser.role+')':'NULL'),'view=',await p.evaluate(()=>typeof currentView!=='undefined'?currentView:'?'));

  // open first non-archived task
  const opened=await p.evaluate(()=>{
    const t=(DB.tasks||[]).find(x=>!x.archived&&!x.parentTaskId);
    if(!t)return null;
    openTaskPanel(t.id);
    return {id:t.id,name:t.name};
  });
  console.log('opened task:',JSON.stringify(opened));
  await new Promise(r=>setTimeout(r,900));

  const info=await p.evaluate(()=>{
    const body=document.getElementById('tp-body');
    const secs=[...document.querySelectorAll('.tp-sec')].map(s=>({
      key:s.dataset.key||s.id||'?',
      label:s.querySelector('.tp-sec-hd')?.textContent.trim().slice(0,40),
      open:s.classList.contains('open'),
      bodyH:Math.round(s.querySelector('.tp-sec-body')?.getBoundingClientRect().height||0)
    }));
    return {
      bodyScrollH: body?body.scrollHeight:-1,
      bodyClientH: body?body.clientHeight:-1,
      sections: secs,
      props: document.querySelectorAll('.tp-prop').length,
      peopleStack: !!document.querySelector('.tp-people'),
      peopleTxt: document.querySelector('#tp-people-box')?.textContent.trim().slice(0,60),
      oldRows: document.querySelectorAll('.tp-field-row').length,
      hasArchiveBtn: [...document.querySelectorAll('#tp-body button')].some(b=>/Archive|Delete Task/.test(b.textContent))
    };
  });
  console.log('PANEL:',JSON.stringify(info,null,1));

  // collapse Properties, check persistence key
  await p.evaluate(()=>{const hd=[...document.querySelectorAll('.tp-sec-hd')].find(h=>/PROPERTIES/i.test(h.textContent));hd&&hd.click();});
  await new Promise(r=>setTimeout(r,400));
  const afterCollapse=await p.evaluate(()=>({
    open:[...document.querySelectorAll('.tp-sec')].map(s=>s.classList.contains('open')),
    stored:localStorage.getItem('etcher_tp_sec'),
    scrollH:document.getElementById('tp-body')?.scrollHeight
  }));
  console.log('AFTER COLLAPSE:',JSON.stringify(afterCollapse));

  // reopen
  await p.evaluate(()=>{const hd=[...document.querySelectorAll('.tp-sec-hd')].find(h=>/PROPERTIES/i.test(h.textContent));hd&&hd.click();});
  await new Promise(r=>setTimeout(r,300));

  // people picker
  await p.evaluate(()=>document.querySelector('.tp-people')?.click());
  await new Promise(r=>setTimeout(r,400));
  const pop=await p.evaluate(()=>{
    const el=document.getElementById('tp-people-pop');
    if(!el)return null;
    const r=el.getBoundingClientRect();
    return {display:getComputedStyle(el).display,top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height),rows:el.querySelectorAll('[onclick]').length,inViewport:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};
  });
  console.log('PEOPLE POP:',JSON.stringify(pop));

  // pick first person
  const before=await p.evaluate(()=>{const t=_tpCurrentTask;return {owner:t.ownerId,assignees:(t.assigneeIds||[]).slice()};});
  const clicked=await p.evaluate(()=>{const el=document.getElementById('tp-people-pop');const r=el&&el.querySelector('[onclick]');if(!r)return 'NO ROW';r.click();return r.getAttribute('onclick');});
  await new Promise(r=>setTimeout(r,600));
  const at600=await p.evaluate(()=>{const t=DB.tasks.find(x=>x.id===_tpCurrentTask.id);return {owner:t.ownerId,assignees:(t.assigneeIds||[]).slice()};});
  await new Promise(r=>setTimeout(r,1200));
  const after=await p.evaluate(()=>{const t=DB.tasks.find(x=>x.id===_tpCurrentTask.id);return {owner:t.ownerId,assignees:(t.assigneeIds||[]).slice(),stackTxt:document.querySelector('#tp-people-box')?.textContent.trim().slice(0,60),ls:(JSON.parse(localStorage.getItem('etcher_taskhub_v4')||'{}').tasks||[]).find(x=>x.id===_tpCurrentTask.id)?.assigneeIds};});
  console.log('PICK clicked:',clicked,'| before:',JSON.stringify(before),'| at600:',JSON.stringify(at600),'| after:',JSON.stringify(after));
  // direct call, bypassing the DOM click
  const direct=await p.evaluate(()=>{
    const t0=JSON.stringify({o:_tpCurrentTask.ownerId,a:_tpCurrentTask.assigneeIds});
    let err=null;
    try{ tpPickPerson('u1'); }catch(e){ err=e.message; }
    const t=DB.tasks.find(x=>x.id==='t1');
    return {t0,err,owner:t.ownerId,assignees:t.assigneeIds,curIsDbObj:DB.tasks.find(x=>x.id==='t1')===_tpCurrentTask,
      user:currentUser&&{id:currentUser.id,role:currentUser.role,email:currentUser.email},
      canEdit:canEditTask(currentUser,_tpCurrentTask),
      taskAssigneesNow:taskAssignees(_tpCurrentTask)};
  });
  console.log('DIRECT CALL:',JSON.stringify(direct));

  // more menu
  await p.evaluate(()=>{const b=[...document.querySelectorAll('button[title="More actions"]')][0];b&&b.click();});
  await new Promise(r=>setTimeout(r,400));
  const more=await p.evaluate(()=>{
    const m=document.getElementById('tp-more-menu');
    if(!m)return null;const r=m.getBoundingClientRect();
    return {display:getComputedStyle(m).display,items:[...m.querySelectorAll('.tp-more-item')].map(i=>i.textContent.trim()),inViewport:r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth};
  });
  console.log('MORE MENU:',JSON.stringify(more));

  await p.screenshot({path:'temporary screenshots/tp-redesign.png'});
  console.log('ERRORS:',errs.length?errs.slice(0,8):'none');
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
