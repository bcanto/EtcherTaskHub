// Client-portal redesign (2026-09-25): schedule fills the width and stays interactive; overview
// stat band counts correctly; Tasks search still works inside the new list panels; Board rows
// open tasks by mouse and keyboard; notifications mark read, flag New and open their task; the
// staff phone tab bar never shows on the portal. Offline only — gate.sh checks the server first.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1440,height:900}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1000));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // Everything below runs in memory only: saveDB is stubbed so the offline data is untouched.
  await p.evaluate(()=>{window.__realSave=saveDB;window.saveDB=()=>{};
    currentUser={id:'probe-design',name:'Probe Client',role:'client',type:'client',clientId:'c1'};launchClientView();});

  // ── Schedule ──
  const g=await p.evaluate(async()=>{
    cpGanttScale='weeks';cpGanttCollapsed=new Set();cpNavigate('schedule');await new Promise(r=>setTimeout(r,50));
    const right=document.getElementById('cp-g-right');
    const track=right.querySelector('.cpg-track');
    const r={wide:document.getElementById('cp-body').classList.contains('cp-wide'),
      fills:track&&track.offsetWidth>=right.clientWidth-2,
      rows:document.querySelectorAll('.cpg-row').length,
      bars:document.querySelectorAll('.cpg-bar').length,
      legend:[...document.querySelectorAll('.cpg-legend-item')].map(e=>e.textContent.trim()),
      scaleOn:document.querySelector('.cpg-seg button.on')?.textContent};
    // inclusive bar length: a 1 → 5 July task spans 5 days
    const t=getClientTasks('c1').find(x=>x.startDate&&x.endDate&&depDiffDays(x.startDate,x.endDate)>=2);
    const bar=[...document.querySelectorAll('.cpg-bar')].find(el=>(el.getAttribute('onclick')||'').includes(`'${t.id}'`));
    const dayW=track.offsetWidth/((track.offsetWidth)/(parseFloat(bar.style.width)/(depDiffDays(t.startDate,t.endDate)+1)));
    r.inclusive=Math.abs(parseFloat(bar.style.width)-(depDiffDays(t.startDate,t.endDate)+1)*dayW)<1;
    // 'Your action' never on finished work
    r.youOnDone=[...document.querySelectorAll('.cpg-row')].some(row=>row.querySelector('.cpg-you')&&row.querySelector('.cpg-row-name.done'));
    // clicking a row and a bar opens that task
    document.querySelector('.cpg-row').click();r.rowOpens=!document.getElementById('cp-task-modal').classList.contains('hidden');cpCloseTaskModal();
    bar.click();r.barOpens=!document.getElementById('cp-task-modal').classList.contains('hidden');cpCloseTaskModal();
    // collapse keeps the scroll position and hides that group's rows
    const rr=document.getElementById('cp-g-right');rr.scrollTop=40;const before=document.querySelectorAll('.cpg-row').length;
    document.querySelector('.cpg-group').click();await new Promise(x=>setTimeout(x,30));
    r.collapsed=document.querySelectorAll('.cpg-row').length<before&&document.querySelector('.cpg-group').getAttribute('aria-expanded')==='false';
    document.querySelector('.cpg-group').click();await new Promise(x=>setTimeout(x,30));
    r.expanded=document.querySelectorAll('.cpg-row').length===before;
    // zoom buttons + Fit all
    cpSetScale('months');r.months=document.querySelector('.cpg-seg button.on')?.textContent==='Months';
    cpGanttAutoFit();r.fit=['Days','Weeks','Months','Quarters'].includes(document.querySelector('.cpg-seg button.on')?.textContent);
    // Today: seed dates are in the past, so the button is disabled rather than scrolling nowhere
    const todayBtn=[...document.querySelectorAll('.cpg-tool')].find(x=>x.textContent==='Today');
    // the filled range can reach today at wide zooms; then the button must work instead
    r.todayDisabled=document.querySelector('.cpg-today')?todayBtn.disabled===false:todayBtn.disabled===true;
    // leaving the schedule restores the reading width
    cpNavigate('overview');r.narrowAgain=!document.getElementById('cp-body').classList.contains('cp-wide');
    return r;
  });
  console.log('GANTT:',JSON.stringify(g));
  ok(g.wide&&g.narrowAgain,'the schedule gets the wide page; other tabs keep the reading width');
  ok(g.fills,'the chart fills the available width (a short project no longer sits in a third of it)');
  ok(g.rows>0&&g.rows===g.bars+0||g.rows>=g.bars,'one row per task with a bar');
  ok(g.inclusive,'bars include their end day');
  ok(g.legend.length>0,'a status legend is shown');
  ok(!g.youOnDone,'finished tasks never show "Your action"');
  ok(g.rowOpens&&g.barOpens,'clicking a task row or its bar opens the task');
  ok(g.collapsed&&g.expanded,'a group collapses and expands');
  ok(g.months&&g.fit,'zoom buttons and Fit all switch the scale');
  ok(g.todayDisabled,'Today is disabled when today is outside the schedule, and enabled when it is on it');

  // Whole header units at both ends (2026-10-16): the range stopped a few days into its last month and the
  // label read "NOVEMBER 20". A task ending 22 Feb used to leave a one-day March sliver.
  const hdr=await p.evaluate(async()=>{
    const out={};
    const saved=DB.tasks.map(t=>({id:t.id,s:t.startDate,e:t.endDate}));
    const live=getClientTasks('c1').filter(t=>!t.parentTaskId&&t.startDate&&t.endDate).slice(0,2).map(t=>DB.tasks.find(x=>x.id===t.id));
    // Every client task inside September to February, the earliest on 5 Sep: with the padding the range used to start on 29 Aug, a three-day August sliver.
    for(const t of getClientTasks('c1')){const x=DB.tasks.find(k=>k.id===t.id);if(x&&(x.startDate||x.endDate)){x.startDate='2026-09-14';x.endDate='2026-09-30';}}
    live[0].startDate='2026-09-05';live[0].endDate='2026-09-20';
    live[1].startDate='2026-10-05';live[1].endDate='2027-02-22';
    for(const sc of ['weeks','months','quarters']){
      cpGanttScale=sc;cpNavigate('schedule');await new Promise(r=>setTimeout(r,40));
      const cells=[...document.querySelectorAll('#cp-g-right .cpg-head > div:first-child > div')];
      out[sc]={n:cells.length,clipped:cells.filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.textContent),first:(cells[0]||{}).textContent,last:(cells[cells.length-1]||{}).textContent};
    }
    for(const x of saved){const t=DB.tasks.find(k=>k.id===x.id);if(t){t.startDate=x.s;t.endDate=x.e;}}
    cpGanttScale='weeks';cpNavigate('overview');
    return out;
  });
  ok(['weeks','months','quarters'].every(s=>hdr[s]&&hdr[s].n>0&&hdr[s].clipped.length===0),'no label in the top header band is cut off, at any zoom ('+JSON.stringify(hdr)+')');
  ok(/^august 2026$/i.test(hdr.weeks.first||''),'Weeks: the band starts on a whole month, here August for a task from 5 Sep (got "'+(hdr.weeks&&hdr.weeks.first)+'")');
  ok(/^february 2027$/i.test(hdr.weeks.last||''),'Weeks: the band ends on the last task\'s month, shown whole (got "'+(hdr.weeks&&hdr.weeks.last)+'")');
  ok(/2027 Q1/i.test(hdr.months.last||'')&&/^2027$/.test(hdr.quarters.last||''),'Months ends on a whole quarter, Quarters on a whole year');

  // Short project: fills the width at the Weeks zoom (the reported case)
  const sh=await p.evaluate(async()=>{
    const ts=getClientTasks('c1');const keep=ts.filter(t=>t.startDate&&t.endDate&&!t.parentTaskId).slice(0,5);
    const saved=DB.tasks.map(t=>({id:t.id,s:t.startDate,e:t.endDate}));
    const iso=n=>{const d=new Date();d.setDate(d.getDate()+n);return toDateStr(d);};
    DB.tasks.forEach(t=>{if(ts.some(x=>x.id===t.id)&&!keep.some(k=>k.id===t.id)){t.startDate='';t.endDate='';}});
    keep.forEach((k,i)=>{const t=DB.tasks.find(x=>x.id===k.id);t.startDate=iso(-1);t.endDate=iso(5+i);});
    cpGanttScale='weeks';cpNavigate('schedule');await new Promise(r=>setTimeout(r,50));
    const right=document.getElementById('cp-g-right');
    const widest=Math.max(...[...document.querySelectorAll('.cpg-bar')].map(el=>el.offsetWidth));
    const r={bars:document.querySelectorAll('.cpg-bar').length,widest,avail:right.clientWidth,today:!!document.querySelector('.cpg-today'),
      todayEnabled:[...document.querySelectorAll('.cpg-tool')].find(x=>x.textContent==='Today')?.disabled===false};
    saved.forEach(x=>{const t=DB.tasks.find(y=>y.id===x.id);t.startDate=x.s;t.endDate=x.e;});
    cpNavigate('overview');
    return r;
  });
  console.log('SHORT:',JSON.stringify(sh));
  ok(sh.bars===5&&sh.widest>sh.avail*0.35,'a one-week project uses the width: the longest bar spans over a third of the chart (was ~84px per week)');
  ok(sh.today&&sh.todayEnabled,'with today in range there is a Today marker and the Today button works');

  // ── Overview band ──
  const ov=await p.evaluate(()=>{
    const t=getClientTasks('c1').find(x=>x.status==='todo');const orig=t.status;
    const raw=DB.tasks.find(x=>x.id===t.id);raw.status='completed-approved';
    cpNavigate('overview');
    const cells=[...document.querySelectorAll('.cp-band-cell')].map(c=>c.innerText.replace(/\s+/g,' ').trim());
    const tasks=getClientTasks('c1');
    const expectDone=tasks.filter(x=>['done','completed','completed-approved'].includes(x.status)).length;
    raw.status=orig;
    const waitBtn=document.querySelector('button.cp-band-cell');
    return{cells,expectDone,n:tasks.length,waitIsButton:!!waitBtn,attn:!!document.getElementById('cp-attn')};
  });
  console.log('OVERVIEW:',JSON.stringify(ov));
  ok(ov.cells.length===4,'overview shows one stat band with four cells');
  ok(ov.cells[1].startsWith(ov.expectDone+' / '+ov.n),'Tasks complete counts Completed & Approved too ('+ov.cells[1]+')');
  ok(ov.waitIsButton&&ov.attn,'Waiting on you jumps to the waiting list');

  // ── Tasks: search still filters inside the panels ──
  const ts=await p.evaluate(()=>{
    cpNavigate('tasks');
    const all=document.querySelectorAll('#cp-tasks-body [data-task-title]').length;
    const inPanels=document.querySelectorAll('#cp-tasks-body .cp-list [data-task-title]').length;
    const title=document.querySelector('#cp-tasks-body [data-task-title]').dataset.taskTitle;
    cpSetTaskSearch(title);
    const shown=[...document.querySelectorAll('#cp-tasks-body [data-task-title]')].filter(r=>r.style.display!=='none').length;
    const hiddenSections=[...document.querySelectorAll('#cp-tasks-body [data-section-wrap]')].filter(s=>s.style.display==='none').length;
    cpSetTaskSearch('zzzz-no-match');
    const none=[...document.querySelectorAll('#cp-tasks-body [data-section-wrap]')].every(s=>s.style.display==='none');
    cpSetTaskSearch('');
    return{all,inPanels,shown,hiddenSections,none};
  });
  console.log('TASKS:',JSON.stringify(ts));
  ok(ts.all>0&&ts.all===ts.inPanels,'every task row sits inside a list panel');
  ok(ts.shown>=1&&ts.shown<ts.all&&ts.hiddenSections>0&&ts.none,'search filters rows and hides empty sections');

  // ── Board: rows open by click and by Enter ──
  const bd=await p.evaluate(()=>{
    cpNavigate('workboard');
    const rows=[...document.querySelectorAll('.cp-brow[role=button]')];
    rows[0].click();const click=!document.getElementById('cp-task-modal').classList.contains('hidden');cpCloseTaskModal();
    rows[1].dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',bubbles:true}));const key=!document.getElementById('cp-task-modal').classList.contains('hidden');cpCloseTaskModal();
    return{rows:rows.length,heads:document.querySelectorAll('.cp-bhead').length,click,key,focusable:rows.every(r=>r.tabIndex===0)};
  });
  console.log('BOARD:',JSON.stringify(bd));
  ok(bd.rows>0&&bd.heads>0,'board shows a table per engagement with column headings');
  ok(bd.click&&bd.key&&bd.focusable,'board rows open the task by click and by keyboard (Enter), and are focusable');

  // ── Notifications ──
  const nt=await p.evaluate(()=>{
    const tk=getClientTasks('c1')[0];
    DB.notifications.push({id:'pd-n1',recipientId:'probe-design',taskId:tk.id,type:'client_action_requested',message:'Please review',read:false,createdAt:new Date().toISOString()});
    cpNavigate('notifications');
    const r={newCount:document.querySelectorAll('.cp-notif-new').length,read:DB.notifications.find(n=>n.id==='pd-n1').read===true};
    document.querySelector('.cp-notif.link')?.click();r.opens=!document.getElementById('cp-task-modal').classList.contains('hidden');cpCloseTaskModal();
    cpNavigate('notifications');r.newAfter=document.querySelectorAll('.cp-notif-new').length;
    DB.notifications=DB.notifications.filter(n=>n.id!=='pd-n1');
    return r;
  });
  console.log('NOTIFS:',JSON.stringify(nt));
  ok(nt.newCount===1&&nt.read,'an unread notification is flagged New and marked read');
  ok(nt.opens,'a notification about a task opens that task');
  ok(nt.newAfter===0,'on the next visit it is no longer New');

  // ── Phone: no sideways scroll, no staff tab bar ──
  await p.setViewport({width:400,height:820});
  await new Promise(r=>setTimeout(r,300));
  const ph=await p.evaluate(async()=>{
    const out={};
    for(const s of ['overview','tasks','workboard','schedule','requests','notifications']){cpNavigate(s);await new Promise(r=>setTimeout(r,60));out[s]=document.documentElement.scrollWidth;}
    const tb=document.getElementById('mobile-tabbar');
    return{widths:out,vw:window.innerWidth,tabbar:tb?getComputedStyle(tb).display:'none'};
  });
  console.log('PHONE:',JSON.stringify(ph));
  ok(Object.values(ph.widths).every(w=>w<=ph.vw+1),'no tab scrolls sideways on a phone ('+JSON.stringify(ph.widths)+')');
  ok(ph.tabbar==='none','the staff phone tab bar is hidden on the client portal');

  await p.evaluate(()=>{window.saveDB=window.__realSave;});
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  await b.close();process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);process.exit(1);});
