// The Gantt at day scale is the widest thing the app renders. It must scroll inside its own
// panel — if the shell grows to fit it instead, the page scrolls sideways and the pinned
// task-name column goes with it.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1400,height:900}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1900));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // stretch the board across a year so the timeline is genuinely wider than the panel
  const wide=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    const ts=DB.tasks.filter(t=>_taskBoardId(t)===bid&&!t.parentTaskId);
    window._gKeep=ts.map(t=>({id:t.id,s:t.startDate,e:t.endDate}));
    ts.forEach((t,i)=>{t.startDate='2026-01-'+String((i%27)+1).padStart(2,'0');t.endDate='2026-1'+(i%2?'1':'2')+'-15';});
    saveDB(DB);
    openWorkboard(bid);await new Promise(r=>setTimeout(r,600));
    navigate('gantt');await new Promise(r=>setTimeout(r,900));
    ganttSetScale('days');await new Promise(r=>setTimeout(r,1000));
    const de=document.documentElement,right=document.getElementById('g2-right');
    const c=document.querySelector('.g2-container');
    return {pageScrollsX:de.scrollWidth>de.clientWidth,
      mainW:Math.round(document.getElementById('main-content').getBoundingClientRect().width),
      viewportW:de.clientWidth,
      containerW:Math.round(c.getBoundingClientRect().width),
      trackWider:right.scrollWidth>right.clientWidth,
      trackScrollW:right.scrollWidth,trackClientW:right.clientWidth};
  });
  console.log('WIDE GANTT:',JSON.stringify(wide));
  ok(wide.trackWider,'the timeline really is wider than its panel ('+wide.trackScrollW+' in '+wide.trackClientW+')');
  ok(!wide.pageScrollsX,'the page does NOT scroll sideways');
  ok(wide.mainW<=wide.viewportW,'main-content stays within the viewport ('+wide.mainW+' <= '+wide.viewportW+')');

  // scroll the timeline hard right — the task column must stay put
  const scrolled=await p.evaluate(async()=>{
    const right=document.getElementById('g2-right');
    right.scrollLeft=right.scrollWidth;
    await new Promise(r=>setTimeout(r,400));
    const left=document.querySelector('.g2-container').firstElementChild;
    const lr=left.getBoundingClientRect();
    const names=(document.getElementById('g2-left-body')||{}).innerText||'';
    const hdr=document.querySelector('#g2-right > div').getBoundingClientRect();
    const panel=right.getBoundingClientRect();
    return {scrolledTo:Math.round(right.scrollLeft),leftLeft:Math.round(lr.left),leftW:Math.round(lr.width),
      namesShown:names.trim().length>10,pageScrollX:Math.round(window.scrollX),
      headerAtPanelTop:Math.abs(hdr.top-panel.top)<3};
  });
  console.log('SCROLLED:',JSON.stringify(scrolled));
  ok(scrolled.scrolledTo>500,'the timeline scrolled a long way right ('+scrolled.scrolledTo+'px)');
  ok(scrolled.pageScrollX===0,'the page itself never moved');
  ok(scrolled.leftW>250&&scrolled.leftLeft>=0,'the task-name column is still on screen at full width');
  ok(scrolled.namesShown,'and still shows the task names');
  ok(scrolled.headerAtPanelTop,'the date header stays stuck to the top of the panel');

  // vertical scroll keeps the two panels in step
  const vert=await p.evaluate(async()=>{
    const right=document.getElementById('g2-right'),lb=document.getElementById('g2-left-body');
    const canScroll=right.scrollHeight>right.clientHeight+10;
    right.scrollTop=220;await new Promise(r=>setTimeout(r,300));
    return {canScroll,right:Math.round(right.scrollTop),left:Math.round(lb.scrollTop)};
  });
  console.log('VERTICAL SYNC:',JSON.stringify(vert));
  // 0===0 would pass without proving anything, so only assert when there is room to scroll.
  if(vert.canScroll&&vert.right>0)ok(vert.left===vert.right,'the name column scrolls vertically in step with the timeline ('+vert.left+')');
  else console.log('  (vertical sync not exercised: the Gantt fits without scrolling here)');

  await p.evaluate(()=>{(window._gKeep||[]).forEach(k=>{const t=DB.tasks.find(x=>x.id===k.id);
    if(t){t.startDate=k.s;t.endDate=k.e;}});saveDB(DB);});

  // ── subitems on the Gantt, and the toolbar toggles that feed the same cache key ──
  const subs=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    window._sKeep=[];
    DB.tasks.filter(t=>_taskBoardId(t)===bid&&!t.parentTaskId).slice(0,3).forEach(par=>{
      DB.tasks.filter(c=>c.parentTaskId===par.id).slice(0,3).forEach((c,i)=>{
        window._sKeep.push({id:c.id,s:c.startDate,e:c.endDate});
        c.startDate='2026-07-'+String(1+i*5).padStart(2,'0');
        c.endDate='2026-07-'+String(10+i*5).padStart(2,'0');});});
    saveDB(DB);
    ganttExpanded.clear();ganttCollapsed.clear();
    openWorkboard(bid);await new Promise(r=>setTimeout(r,600));
    navigate('gantt');await new Promise(r=>setTimeout(r,1000));
    const rows=()=>document.querySelectorAll('#g2-left-body > div').length;
    const o={base:rows()};
    // group collapse used to be dead: the cache key ignored ganttCollapsed
    const gid=getWbGroups()[0].id;
    ganttToggleGroup(gid);await new Promise(r=>setTimeout(r,700));o.afterGroupCollapse=rows();
    ganttToggleGroup(gid);await new Promise(r=>setTimeout(r,700));o.afterGroupExpand=rows();
    const withSubs=DB.tasks.filter(t=>_taskBoardId(t)===bid&&!t.parentTaskId
      &&DB.tasks.some(c=>c.parentTaskId===t.id&&(c.startDate||c.endDate)));
    o.parentsWithSubs=withSubs.length;
    if(!withSubs.length)return o;
    const target=withSubs[0];
    o.kids=DB.tasks.filter(c=>c.parentTaskId===target.id&&(c.startDate||c.endDate)).length;
    o.chevrons=document.querySelectorAll('#g2-left-body span[onclick*="ganttToggleTask"]').length;
    ganttToggleTask(target.id);await new Promise(r=>setTimeout(r,800));
    o.afterExpand=rows();
    const lh=[...document.querySelectorAll('#g2-left-body > div')].map(d=>Math.round(d.getBoundingClientRect().height));
    const rh=[...document.querySelectorAll('#g2-right > div:last-child > div')]
      .filter(d=>/height/.test(d.getAttribute('style')||'')).map(d=>Math.round(d.getBoundingClientRect().height));
    o.subRows=lh.filter(h=>h===32).length;
    o.leftTotal=lh.reduce((a,c)=>a+c,0);o.rightTotal=rh.reduce((a,c)=>a+c,0);
    ganttToggleTask(target.id);await new Promise(r=>setTimeout(r,700));o.afterCollapse=rows();
    // colour-by was dead for the same reason
    const before=document.querySelector('.g2-bar')?.style.background;
    ganttSetColorBy(ganttColorBy==='status'?'priority':'status');await new Promise(r=>setTimeout(r,700));
    o.colourChanged=(document.querySelector('.g2-bar')?.style.background)!==before;
    ganttSetColorBy('status');ganttExpanded.clear();
    (window._sKeep||[]).forEach(k=>{const c=DB.tasks.find(x=>x.id===k.id);if(c){c.startDate=k.s;c.endDate=k.e;}});
    saveDB(DB);
    return o;
  });
  console.log('SUBITEMS:',JSON.stringify(subs));
  ok(subs.afterGroupCollapse<subs.base,'collapsing a group actually removes rows ('+subs.base+' -> '+subs.afterGroupCollapse+')');
  ok(subs.afterGroupExpand===subs.base,'expanding it puts them back');
  if(subs.parentsWithSubs){
    ok(subs.chevrons>0,'a parent with dated subitems gets an expander ('+subs.chevrons+')');
    ok(subs.afterExpand===subs.base+subs.kids,'expanding adds one row per dated subitem (+'+subs.kids+')');
    ok(subs.subRows===subs.kids,'subitem rows render at the shorter height');
    ok(subs.leftTotal===subs.rightTotal,'left and right panels stay the same total height ('+subs.leftTotal+')');
    ok(subs.afterCollapse===subs.base,'collapsing the parent removes them again');
  }
  ok(subs.colourChanged,'changing Colour by actually redraws the bars');

  // ── every toolbar control, clicked for real ──
  const tb=await p.evaluate(async()=>{
    const click=t=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(el)el.click();return !!el;};
    const state=()=>({scale:ganttScale,colorBy:ganttColorBy,baseline:ganttShowBaseline,
      activeScale:[...document.querySelectorAll('.g2-scale-btn.active')].map(x=>x.textContent.trim()).join(','),
      activeCb:[...document.querySelectorAll('.g2-cb-btn.active')].map(x=>x.textContent.trim()).join(','),
      bar:(document.querySelector('.g2-bar')||{}).style?.background||null,
      track:(document.querySelector('#g2-right > div:last-child')||{}).style?.minWidth||null});
    const o={};
    click('Months');await new Promise(r=>setTimeout(r,700));o.months=state();
    click('Days');await new Promise(r=>setTimeout(r,700));o.days=state();
    click('By Priority');await new Promise(r=>setTimeout(r,700));o.prio=state();
    click('By Status');await new Promise(r=>setTimeout(r,700));o.status=state();
    const cb=[...document.querySelectorAll('input[type=checkbox]')].find(c=>/Baseline/.test(c.parentElement.textContent));
    if(cb){cb.click();await new Promise(r=>setTimeout(r,700));}
    o.baselineOn=ganttShowBaseline;
    if(cb){const cb2=[...document.querySelectorAll('input[type=checkbox]')].find(c=>/Baseline/.test(c.parentElement.textContent));
      if(cb2)cb2.click();await new Promise(r=>setTimeout(r,600));}
    ganttSetScale('weeks');await new Promise(r=>setTimeout(r,600));
    return o;
  });
  console.log('TOOLBAR:',JSON.stringify(tb));
  ok(tb.months.activeScale==='Months'&&tb.days.activeScale==='Days','the scale buttons highlight the one you picked');
  ok(tb.months.track!==tb.days.track,'and actually change the timeline width ('+tb.months.track+' vs '+tb.days.track+')');
  ok(tb.prio.activeCb==='By Priority'&&tb.status.activeCb==='By Status','Colour by highlights the one you picked');
  ok(tb.prio.bar!==tb.status.bar,'and actually recolours the bars ('+tb.prio.bar+' vs '+tb.status.bar+')');
  ok(tb.baselineOn===true,'the Baseline checkbox takes effect');

  // ── folding the task list away to widen the calendar ──
  const fold=await p.evaluate(async()=>{
    const panelW=()=>Math.round(document.querySelector('.g2-container').firstElementChild.getBoundingClientRect().width);
    const trackW=()=>document.getElementById('g2-right').clientWidth;
    const o={hasBtn:!!document.querySelector("button[onclick='ganttToggleLeft()']"),openW:panelW(),openTrack:trackW()};
    ganttToggleLeft();await new Promise(r=>setTimeout(r,700));
    o.foldedW=panelW();o.foldedTrack=trackW();
    o.rowsHidden=document.getElementById('g2-left-body').offsetParent===null;
    o.btnStays=!!document.querySelector("button[onclick='ganttToggleLeft()']");
    ganttToggleLeft();await new Promise(r=>setTimeout(r,700));
    o.backW=panelW();o.rowsBack=document.getElementById('g2-left-body').offsetParent!==null;
    return o;
  });
  console.log('FOLD PANEL:',JSON.stringify(fold));
  ok(fold.hasBtn,'the task list has a fold-away control');
  ok(fold.foldedW<60&&fold.openW>250,'folding shrinks the task column ('+fold.openW+' -> '+fold.foldedW+')');
  ok(fold.foldedTrack>fold.openTrack,'the calendar gains that width (+'+(fold.foldedTrack-fold.openTrack)+'px)');
  ok(fold.rowsHidden,'the task rows are hidden while folded');
  ok(fold.btnStays,'the control stays reachable to unfold it');
  ok(fold.backW===fold.openW&&fold.rowsBack,'unfolding restores the column');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
