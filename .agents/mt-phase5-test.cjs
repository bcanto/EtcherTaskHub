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

  // board that has parents with children
  await p.evaluate(()=>{
    const kids={};DB.tasks.forEach(t=>{if(t.parentTaskId)kids[t.parentTaskId]=(kids[t.parentTaskId]||0)+1;});
    const perBoard={};Object.keys(kids).forEach(pid=>{const par=DB.tasks.find(t=>t.id===pid);if(!par)return;const bd=_taskBoardId(par);if(bd)perBoard[bd]=(perBoard[bd]||0)+1;});
    openWorkboard(Object.keys(perBoard).sort((a,b)=>perBoard[b]-perBoard[a])[0]);
  });
  await new Promise(r=>setTimeout(r,1400));

  // ---- 5.1 level field ----
  const lv=await p.evaluate(()=>{
    mtAddCustomCol('text','Quick Note','subitem');
    mtAddCustomCol('text','Client Owner','parent');
    mtAddCustomCol('text','Legacy Col');          // no level → must default to 'both'
    const cols=mtGetBoardCustomCols();
    return {
      levels:cols.map(c=>({n:c.name,lv:c.level})),
      appliesParent:cols.map(c=>mtColAppliesTo(c,false)),
      appliesSub:cols.map(c=>mtColAppliesTo(c,true)),
      legacyNoLevel:mtColAppliesTo({name:'x'},false)&&mtColAppliesTo({name:'x'},true)
    };
  });
  console.log('LEVELS:',JSON.stringify(lv.levels));
  ok(lv.levels.find(c=>c.n==='Quick Note').lv==='subitem','a subitem-only column stores level=subitem');
  ok(lv.levels.find(c=>c.n==='Client Owner').lv==='parent','an item-only column stores level=parent');
  ok(lv.levels.find(c=>c.n==='Legacy Col').lv==='both','a column created without a level defaults to both');
  ok(lv.legacyNoLevel,'a column with no level field at all still applies everywhere (back-compat)');
  ok(JSON.stringify(lv.appliesParent)==='[false,true,true]','parent rows get item + both columns only');
  ok(JSON.stringify(lv.appliesSub)==='[true,false,true]','subitem rows get subitem + both columns only');

  // expand a parent so subitems render
  await p.evaluate(()=>{
    const kids={};DB.tasks.forEach(t=>{if(t.parentTaskId)kids[t.parentTaskId]=(kids[t.parentTaskId]||0)+1;});
    const pid=Object.keys(kids).find(id=>{const pp=DB.tasks.find(t=>t.id===id);return pp&&_taskBoardId(pp)===currentWorkboard.id;});
    if(pid)wsToggleExpand(pid);
  });
  await new Promise(r=>setTimeout(r,1300));

  // ---- 5.2b: subitems live in their OWN grid ----
  // Rewritten for the nested architecture. The outer table must be undisturbed, and the
  // subitem table is a separate grid with its own header — that separation IS the feature.
  const grid=await p.evaluate(()=>{
    const outerHdr=document.querySelectorAll('.ws-table>thead th').length;
    const outerRows=[...document.querySelectorAll('.ws-table>tbody>tr.ws-row')]
      .filter(r=>!r.querySelector('td[colspan]')).map(r=>r.children.length);
    const sub=document.querySelector('.ws-subtable');
    const subHdr=sub?sub.querySelectorAll('thead th').length:0;
    const subRows=sub?[...sub.querySelectorAll('tbody tr.ws-subrow2')].map(r=>r.children.length):[];
    return {
      outerHdr,outerWidths:[...new Set(outerRows)],
      subHdr,subWidths:[...new Set(subRows)],
      subTables:document.querySelectorAll('.ws-subtable').length,
      subHosts:document.querySelectorAll('.ws-subhost').length,
      subRowCount:document.querySelectorAll('.ws-subrow2').length,
      legacySubrows:document.querySelectorAll('.ws-subrow').length,
      subHeaders:sub?[...sub.querySelectorAll('thead th')].map(t=>t.textContent.trim()).filter(Boolean):[],
      outerHeaders:[...document.querySelectorAll('.ws-table>thead th')].map(t=>t.textContent.trim().replace(/[⇅↑↓]/g,'')).filter(Boolean)
    };
  });
  console.log('GRID:',JSON.stringify(grid));
  ok(grid.outerWidths.length===1&&grid.outerWidths[0]===grid.outerHdr,
     'outer grid untouched — header and item rows both '+grid.outerHdr+' columns');
  ok(grid.subTables>0&&grid.subTables===grid.subHosts,'each expanded parent hosts exactly one subitem grid');
  ok(grid.subRowCount>0,'subitems render in the nested grid ('+grid.subRowCount+')');
  ok(grid.legacySubrows===0,'the old shared-grid subitem rows are fully gone');
  ok(grid.subWidths.length===1&&grid.subWidths[0]===grid.subHdr,
     'subitem grid is internally consistent ('+grid.subHdr+' columns)');
  ok(grid.subHdr!==grid.outerHdr,'the two grids genuinely differ in width ('+grid.outerHdr+' vs '+grid.subHdr+')');
  ok(grid.subHeaders.includes('Subitem'),'subitem grid has its own header row');
  ok(!grid.subHeaders.includes('Priority')&&grid.outerHeaders.includes('Priority'),
     'Priority is an item-level column and does not appear on subitems');

  // ---- level-scoped custom columns still blank at the wrong tier on the parent grid ----
  const tiers=await p.evaluate(()=>{
    const parents=[...document.querySelectorAll('.ws-table>tbody>tr.ws-row')].filter(r=>!r.querySelector('td[colspan]'));
    const sub=document.querySelector('.ws-subtable');
    return {
      parentBlanks:[...new Set(parents.map(r=>r.querySelectorAll('.ws-col-na').length))],
      // the subitem grid only ever builds columns that apply to subitems, so it should
      // never need a hatched placeholder at all
      subBlanks:sub?sub.querySelectorAll('.ws-col-na').length:-1
    };
  });
  console.log('TIERS:',JSON.stringify(tiers));
  ok(tiers.parentBlanks.length===1&&tiers.parentBlanks[0]===1,'parent rows blank exactly the subitem-only column');
  ok(tiers.subBlanks===0,'subitem grid needs no placeholders — it only builds columns that apply');

  // ---- 5.3 header tags + menu ----
  // The sub/item chip was removed at the user's request (2026-09-06) — scope is now conveyed
  // by the header tooltip and the column's ▾ menu, not by a badge in the header.
  const scopeHint=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Client Owner/.test(t.textContent));
    return {badges:document.querySelectorAll('.ws-col-lvl').length,
      tooltip:th?th.querySelector('.col-label').title:''};
  });
  ok(scopeHint.badges===0,'no scope badge clutters the header');
  ok(/items only/.test(scopeHint.tooltip),'scope is still discoverable via the tooltip ("'+scopeHint.tooltip+'")');

  const menu=await p.evaluate(()=>{
    const col=mtGetBoardCustomCols().find(c=>c.name==='Quick Note');
    const btn=[...document.querySelectorAll('.mt-col-menu-btn')].find(b=>b.closest('th').textContent.includes('Quick Note'));
    if(!btn)return null;
    btn.click();
    const dd=document.getElementById('mt-col-dd');
    return dd?[...dd.querySelectorAll('.ws-cell-dd-item')].map(i=>i.textContent.trim()):null;
  });
  console.log('COL MENU:',JSON.stringify(menu));
  ok(menu&&menu.some(i=>/Items and subitems/.test(i)),'column menu offers all three scopes');
  ok(menu&&menu.some(i=>/^✓/.test(i)),'menu ticks the current scope');

  // switching scope re-scopes live
  const switched=await p.evaluate(()=>{
    const col=mtGetBoardCustomCols().find(c=>c.name==='Quick Note');
    mtSetCustomColLevel(col.id,'both');
    return mtGetBoardCustomCols().find(c=>c.name==='Quick Note').level;
  });
  await new Promise(r=>setTimeout(r,900));
  ok(switched==='both','changing a column scope persists');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
