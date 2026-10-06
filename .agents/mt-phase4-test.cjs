const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,140));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ---- 4.1 the helper ----
  const u=await p.evaluate(()=>{
    const mk=(...st)=>st.map((s,i)=>({id:'x'+i,status:s}));
    return {
      empty:statusMixOf([]),
      allSame:statusMixOf(mk('todo','todo','todo')),
      mixed:statusMixOf(mk('todo','in-progress','done','done')),
      archivedExcluded:statusMixOf([{id:'a',status:'todo'},{id:'b',status:'done',archived:true}]),
      ordering:statusMixOf(mk('done','todo','in-progress')).segments.map(s=>s.status)
    };
  });
  console.log('HELPER:',JSON.stringify(u.mixed));
  ok(u.empty.total===0&&u.empty.segments.length===0,'empty input yields an empty mix');
  ok(u.allSame.segments.length===1&&u.allSame.segments[0].pct===100,'a uniform group is one full-width segment');
  ok(u.mixed.total===4&&u.mixed.segments.length===3,'a mixed group splits into one segment per status');
  ok(Math.abs(u.mixed.segments.reduce((s,x)=>s+x.pct,0)-100)<0.01,'segment percentages sum to 100');
  ok(u.archivedExcluded.total===1,'archived tasks are excluded from the mix');
  ok(u.ordering[0]==='todo'&&u.ordering[u.ordering.length-1]==='done','segments ordered not-started → done ('+u.ordering.join(' → ')+')');
  ok(u.mixed.segments.every(s=>/^#|^rgb/.test(s.color)),'every segment carries a colour from STATUS_META');

  // ---- pick a board that actually has parents with children ----
  const info=await p.evaluate(()=>{
    const kids={};DB.tasks.forEach(t=>{if(t.parentTaskId)kids[t.parentTaskId]=(kids[t.parentTaskId]||0)+1;});
    const perBoard={};
    Object.keys(kids).forEach(pid=>{const par=DB.tasks.find(t=>t.id===pid);if(!par)return;const bd=_taskBoardId(par);if(bd)perBoard[bd]=(perBoard[bd]||0)+1;});
    const best=Object.keys(perBoard).sort((a,b)=>perBoard[b]-perBoard[a])[0];
    openWorkboard(best);
    return {board:DB.workboards.find(w=>w.id===best)?.name,parents:perBoard[best]};
  });
  await new Promise(r=>setTimeout(r,1600));
  console.log('BOARD:',JSON.stringify(info));

  // ---- 4.2 parent rows ----
  const rows=await p.evaluate(()=>{
    const bars=[...document.querySelectorAll('.ws-row .status-mix')];
    return {
      count:bars.length,
      allHaveSegments:bars.every(m=>m.children.length>=1),
      allHaveTooltip:bars.every(m=>/\d+\s\w/.test(m.title)),
      widthsSumTo100:bars.every(m=>{
        const tot=[...m.children].reduce((s,c)=>s+parseFloat(c.style.width||0),0);
        return Math.abs(tot-100)<0.5;}),
      plainBarsStillExist:document.querySelectorAll('.ws-row .progress-bar').length,
      sample:bars[0]?.title
    };
  });
  console.log('ROWS:',JSON.stringify(rows));
  ok(rows.count>0,'parent rows with children render a segmented bar ('+rows.count+')');
  ok(rows.allHaveSegments,'every segmented bar has at least one segment');
  ok(rows.allHaveTooltip,'each bar tooltips its composition ("'+rows.sample+'")');
  ok(rows.widthsSumTo100,'segment widths sum to 100% on every bar');
  ok(rows.plainBarsStillExist>0,'leaf tasks keep the plain progress bar');

  // ---- 4.3 group headers ----
  const groups=await p.evaluate(()=>{
    const bars=[...document.querySelectorAll('.ws-grp-hdr .status-mix')];
    return {count:bars.length,
      titles:bars.map(m=>m.title),
      hdrCount:document.querySelectorAll('.ws-grp-hdr').length};
  });
  console.log('GROUPS:',JSON.stringify(groups));
  ok(groups.count===groups.hdrCount,'every group header shows a mix bar ('+groups.count+'/'+groups.hdrCount+')');
  ok(groups.titles.every(t=>/\d+\s\w/.test(t)),'group tooltips list the counts');

  // ---- the point of the change: all-blocked must not look like all-not-started ----
  const distinct=await p.evaluate(()=>{
    const a=statusMixOf([{id:1,status:'blocked'},{id:2,status:'blocked'}]);
    const b=statusMixOf([{id:1,status:'todo'},{id:2,status:'todo'}]);
    return {blockedColor:a.segments[0].color,todoColor:b.segments[0].color,
      blockedLabel:a.segments[0].label,todoLabel:b.segments[0].label};
  });
  console.log('DISTINCT:',JSON.stringify(distinct));
  ok(distinct.blockedColor!==distinct.todoColor,'all-blocked renders a different colour from all-not-started');

  // ---- a group of one uniform status fills the bar rather than reading empty ----
  const uniform=await p.evaluate(()=>{
    const m=statusMixOf([{id:1,status:'todo'},{id:2,status:'todo'},{id:3,status:'todo'}]);
    const html=statusMixBar(m,64);
    const d=document.createElement('div');d.innerHTML=html;
    const seg=d.querySelector('.status-mix > span');
    return {width:seg?seg.style.width:null,title:d.querySelector('.status-mix')?.title};
  });
  ok(uniform.width==='100%','an all-not-started group fills its bar (was an empty 0% bar)');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
