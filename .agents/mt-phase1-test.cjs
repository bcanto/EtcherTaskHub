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

  // ---- unit-level: the two new helpers ----
  const u=await p.evaluate(()=>{
    const y=new Date().getFullYear();
    const mk=(m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    // toDateStr, not toISOString: the app decides "today" from the LOCAL calendar date, so a
    // UTC-derived expectation here is a day behind between midnight and 08:00 Perth and this
    // suite failed every morning. Use the same helper the app uses so they can't disagree.
    const iso=off=>{const dt=new Date();dt.setDate(dt.getDate()+off);return toDateStr(dt);};
    return {
      sameMonth:_wsCompactRange(mk(6,26),mk(6,30)),
      crossMonth:_wsCompactRange(mk(6,26),mk(7,7)),
      startOnly:_wsCompactRange(mk(6,26),''),
      endOnly:_wsCompactRange('',mk(7,7)),
      none:_wsCompactRange('',''),
      nextYear:_wsCompactRange(mk(6,26),(y+1)+'-07-07'),
      dueToday:_wsDueState({endDate:iso(0),status:'todo'}),
      dueSoon:_wsDueState({endDate:iso(2),status:'todo'}),
      dueFuture:_wsDueState({endDate:iso(30),status:'todo'}),
      over3d:_wsDueState({endDate:iso(-3),status:'todo'}),
      stale:_wsDueState({endDate:iso(-70),status:'todo'}),
      doneIgnored:_wsDueState({endDate:iso(-70),status:'done'}),
      archivedIgnored:_wsDueState({endDate:iso(-70),status:'todo',archived:true})
    };
  });
  console.log('HELPERS:',JSON.stringify(u,null,1));
  ok(u.sameMonth==='26 – 30 Jun','same-month range collapses the month ("'+u.sameMonth+'")');
  ok(u.crossMonth==='26 Jun – 7 Jul','cross-month range drops the current year ("'+u.crossMonth+'")');
  ok(!/\d{4}/.test(u.crossMonth),'current-year range shows no 4-digit year');
  ok(/'\d\d/.test(u.nextYear),'a non-current year is still shown ("'+u.nextYear+'")');
  ok(u.none==='—','empty range renders a dash');
  ok(u.dueToday.tone==='soon'&&/today/.test(u.dueToday.chip),'due today = soon/amber');
  ok(u.dueSoon.tone==='soon','due in 2 days = soon');
  ok(u.dueFuture.tone==='none'&&!u.dueFuture.chip,'far-future due date gets no chip');
  ok(u.over3d.tone==='over'&&/3d overdue/.test(u.over3d.chip),'3 days overdue = red');
  ok(u.stale.tone==='stale'&&/w overdue/.test(u.stale.chip),'10 weeks overdue = muted, not red');
  ok(u.doneIgnored.tone==='none','completed tasks never colour their date');
  ok(u.archivedIgnored.tone==='none','archived tasks never colour their date');

  // ---- rendered table ----
  await p.evaluate(()=>{
    const c={};(DB.tasks||[]).forEach(t=>{const b=t.boardId||t.workboardId;if(b)c[b]=(c[b]||0)+1;});
    openWorkboard(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]);
  });
  await new Promise(r=>setTimeout(r,1500));

  const r=await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('.ws-row')];
    const txt=document.querySelector('.ws-table').textContent;
    return {
      rowCount:rows.length,
      longDates:(txt.match(/\d{2}\/\d{2}\/\d{4}/g)||[]).length,
      arrowGlyphs:(txt.match(/→/g)||[]).length,
      redRows:rows.filter(r=>{const s=r.querySelector('.ws-due-over');return !!s;}).length,
      staleChips:document.querySelectorAll('.ws-due-stale').length,
      soonChips:document.querySelectorAll('.ws-due-soon').length,
      // Scoped to task rows. Group headers still show a flat % — that is Phase 4's
      // segmented-bar work, not Phase 1.
      zeroPctLabels:rows.map(r=>r.textContent).join(' ').match(/\b0%/g)?.length||0,
      groupHeaderPct:(document.querySelector('.ws-table').textContent.match(/\b0%/g)||[]).length,
      // just the date span, excluding the overdue chip and the caret that share the cell
      longestTimelineText:Math.max(...rows.map(r=>{
        const td=[...r.querySelectorAll('td')].find(td=>/\d+\s[A-Z][a-z]{2}/.test(td.textContent));
        if(!td)return 0;
        const span=[...td.querySelectorAll('span')].find(s=>/\d+\s[A-Z][a-z]{2}/.test(s.textContent));
        return span?span.textContent.trim().replace(/\s+/g,' ').length:0;})),
      hundredPctLabels:(txt.match(/\b100%/g)||[]).length,
      progressBars:document.querySelectorAll('.ws-row .progress-bar').length,
      emptyClipsHidden:[...document.querySelectorAll('.ws-clip-empty')]
        .every(el=>getComputedStyle(el).opacity==='0'),
      timelineColW:Math.round([...document.querySelectorAll('.ws-table th')]
        .find(t=>/Timeline/.test(t.textContent)).getBoundingClientRect().width)
    };
  });
  console.log('TABLE:',JSON.stringify(r));
  ok(r.longDates===0,'no dd/mm/yyyy dates left in the table');
  ok(r.arrowGlyphs===0,'no "→" range arrows left');
  ok(r.zeroPctLabels===0,'no "0%" labels on task rows (empty progress now a dash)');
  ok(r.hundredPctLabels===0,'no "100%" labels (completed rows say Done once)');
  ok(r.progressBars<r.rowCount,'progress bars only on rows actually in progress');
  ok(r.emptyClipsHidden,'empty attachment clips hidden until row hover');
  // The column stretches to fill spare table width, so assert on content density —
  // "26 Jun – 7 Jul" (14 ch) vs the old "02/06/2026 → 05/06/2026" (23 ch).
  ok(r.longestTimelineText<=20,'timeline text is compact (longest '+r.longestTimelineText+' chars, was 23)');
  ok(r.staleChips>0,'long-overdue rows carry a muted overdue chip');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
