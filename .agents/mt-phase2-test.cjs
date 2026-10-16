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

  await p.evaluate(()=>{const c={};(DB.tasks||[]).forEach(t=>{const b=t.boardId||t.workboardId;if(b&&!t.parentTaskId)c[b]=(c[b]||0)+1;});openWorkboard(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]);});
  await new Promise(r=>setTimeout(r,1500));

  // ---- 2.1 the two searches are distinguishable ----
  const s=await p.evaluate(()=>{
    const ins=[...document.querySelectorAll('input')].filter(i=>/search|filter/i.test(i.placeholder||''));
    return ins.map(i=>({id:i.id||'(none)',ph:i.placeholder,title:i.title||''}));
  });
  console.log('SEARCHES:',JSON.stringify(s));
  ok(s.length===2,'still two inputs (both behaviours preserved)');
  ok(new Set(s.map(x=>x.ph)).size===2,'their placeholders differ');
  ok(s.every(x=>x.title.length>10),'each explains its scope in a tooltip');
  ok(!s.some(x=>x.ph==='Search tasks…')&&!s.filter(x=>x.ph===s[0].ph)[1],'no two inputs share "Search tasks…"');

  // ---- 2.2 toolbar is one row ----
  const tb=await p.evaluate(()=>{
    const bar=document.querySelector('.mt-search').closest('.ut-bar');
    const kids=[...bar.children].map(el=>el.getBoundingClientRect()).filter(r=>r.width>0);
    const tops=kids.map(r=>Math.round(r.top));
    const selects=[...bar.querySelectorAll(':scope > select')].map(s=>Math.round(s.getBoundingClientRect().width));
    return {height:Math.round(bar.getBoundingClientRect().height),
      topSpread:Math.max(...tops)-Math.min(...tops),
      selectWidths:selects,
      widestSelect:Math.max(...selects)};
  });
  console.log('TOOLBAR:',JSON.stringify(tb));
  ok(tb.height<=56,'toolbar fits one row ('+tb.height+'px, was 84)');
  ok(tb.topSpread<32,'no child wrapped to a second line (top spread '+tb.topSpread+'px)');
  ok(tb.widestSelect<=130,'no filter select stretched by long option text (widest '+tb.widestSelect+'px, was 232)');

  // ---- 2.3 sort ----
  const sortRest=await p.evaluate(()=>{
    const hints=[...document.querySelectorAll('.ws-sort-hint')];
    return {hintCount:hints.length,
      allHiddenAtRest:hints.every(h=>getComputedStyle(h).opacity==='0'),
      activeArrows:document.querySelectorAll('.ws-sort-active').length,
      sortBtn:!!document.getElementById('ws-sort-menu')};
  });
  console.log('SORT AT REST:',JSON.stringify(sortRest));
  ok(sortRest.hintCount>5,'sort hints exist on the headers');
  ok(sortRest.allHiddenAtRest,'sort ⇅ hints hidden at rest (were 11 permanent glyphs)');
  ok(sortRest.activeArrows===0,'no active sort arrow before sorting');
  ok(sortRest.sortBtn,'explicit Sort control exists in the toolbar');

  // menu opens and lists columns
  await p.evaluate(()=>{
    [...document.querySelectorAll('button')].find(b=>/^Sort/.test(b.textContent.trim()))?.click();
  });
  await new Promise(r=>setTimeout(r,350));
  const menu=await p.evaluate(()=>{
    const m=document.getElementById('ws-sort-menu');
    return {open:!m.classList.contains('hidden'),
      items:[...m.querySelectorAll('.ws-dropdown-item')].map(i=>i.textContent.trim())};
  });
  console.log('SORT MENU:',JSON.stringify(menu.items));
  ok(menu.open,'Sort menu opens');
  ok(/Manual order/.test(menu.items[0]||''),'menu offers a way back to manual order');
  ok(menu.items.some(i=>/Task Name/.test(i)),'menu lists Task Name');

  // sorting actually reorders, and labels the button
  const sorted=await p.evaluate(()=>{
    const before=[...document.querySelectorAll('.ws-row .ws-task-name-span')].map(s=>s.textContent.trim());
    wsSortBy('name');
    const after=[...document.querySelectorAll('.ws-row .ws-task-name-span')].map(s=>s.textContent.trim());
    const btn=[...document.querySelectorAll('button')].find(b=>/^Sort/.test(b.textContent.trim()));
    return {before,after,changed:before.join('|')!==after.join('|'),
      btnLabel:btn?btn.textContent.trim().replace(/\s+/g,' '):'',
      activeArrows:document.querySelectorAll('.ws-sort-active').length,
      isSorted:JSON.stringify(after)===JSON.stringify([...after].sort((a,b)=>a.localeCompare(b)))};
  });
  console.log('AFTER SORT:',JSON.stringify({changed:sorted.changed,btn:sorted.btnLabel,arrows:sorted.activeArrows,ordered:sorted.isSorted}));
  ok(sorted.changed,'sorting reorders the rows');
  ok(/Task Name/.test(sorted.btnLabel),'Sort button shows the active column ("'+sorted.btnLabel+'")');
  ok(sorted.activeArrows===1,'exactly one active sort arrow after sorting');

  // clearing returns to manual order
  const cleared=await p.evaluate(()=>{
    wsClearSort();
    const btn=[...document.querySelectorAll('button')].find(b=>/^Sort/.test(b.textContent.trim()));
    return {btnLabel:btn?btn.textContent.trim().replace(/\s+/g,' '):'',
      activeArrows:document.querySelectorAll('.ws-sort-active').length,col:wsSort.col};
  });
  ok(cleared.col===null&&cleared.activeArrows===0,'Manual order clears the sort');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
