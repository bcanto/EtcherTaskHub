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

  // board with subitems, expanded
  await p.evaluate(()=>{
    const k={};DB.tasks.forEach(t=>{if(t.parentTaskId)k[t.parentTaskId]=1;});
    const pb={};Object.keys(k).forEach(pid=>{const pp=DB.tasks.find(t=>t.id===pid);if(pp){const bd=_taskBoardId(pp);if(bd)pb[bd]=(pb[bd]||0)+1;}});
    openWorkboard(Object.keys(pb).sort((a,b)=>pb[b]-pb[a])[0]);
  });
  await new Promise(r=>setTimeout(r,1400));
  await p.evaluate(()=>{
    const k={};DB.tasks.forEach(t=>{if(t.parentTaskId)k[t.parentTaskId]=1;});
    const pid=Object.keys(k).find(id=>{const pp=DB.tasks.find(t=>t.id===id);return pp&&_taskBoardId(pp)===currentWorkboard.id;});
    if(pid)wsToggleExpand(pid);
  });
  await new Promise(r=>setTimeout(r,1300));

  // ---- affordances present on both grids ----
  const aff=await p.evaluate(()=>({
    itemHandles:document.querySelectorAll('.ws-table>thead .col-resize').length,
    itemLabels:document.querySelectorAll('.ws-table>thead .col-label').length,
    subHandles:document.querySelectorAll('.ws-subtable thead .col-resize').length,
    subLabels:document.querySelectorAll('.ws-subtable thead .col-label').length
  }));
  console.log('AFFORDANCES:',JSON.stringify(aff));
  ok(aff.itemHandles>5,'item grid headers have resize handles ('+aff.itemHandles+')');
  ok(aff.itemLabels>5,'item grid headers have renamable labels ('+aff.itemLabels+')');
  ok(aff.subHandles>3,'subitem grid headers have resize handles ('+aff.subHandles+')');
  ok(aff.subLabels>3,'subitem grid headers have renamable labels ('+aff.subLabels+')');

  // ---- resize by dragging: item grid ----
  const box=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Status/.test(t.textContent));
    const h=th.querySelector('.col-resize');
    const r=h.getBoundingClientRect();
    return {before:Math.round(th.getBoundingClientRect().width),x:r.x+r.width/2,y:r.y+r.height/2};
  });
  await p.mouse.move(box.x,box.y);
  await p.mouse.down();
  await p.mouse.move(box.x+70,box.y,{steps:8});
  await p.mouse.up();
  await new Promise(r=>setTimeout(r,900));
  const resized=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Status/.test(t.textContent));
    return {after:Math.round(th.getBoundingClientRect().width),
      stored:(JSON.parse(localStorage.getItem('etcher_ws_colmeta')||'{}')[currentWorkboard.id]||{}).item?.widths?.status};
  });
  console.log('RESIZE:',JSON.stringify({before:box.before,...resized}));
  ok(resized.after>box.before+30,'dragging the edge widened the column ('+box.before+' → '+resized.after+')');
  ok(typeof resized.stored==='number','the new width is persisted to localStorage ('+resized.stored+'px)');

  // survives a re-render
  await p.evaluate(()=>renderView('workspace'));
  await new Promise(r=>setTimeout(r,900));
  const persisted=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Status/.test(t.textContent));
    return Math.round(th.getBoundingClientRect().width);
  });
  ok(Math.abs(persisted-resized.after)<12,'width survives a re-render ('+persisted+'px)');

  // ---- resize did NOT trigger a sort ----
  const sortState=await p.evaluate(()=>wsSort.col);
  ok(sortState===null,'dragging a resize handle does not sort the column');

  // ---- THE regression that motivated table-layout:fixed ----
  // Under table-layout:auto the browser re-solved every column on each change, so dragging
  // one edge visibly shoved its neighbours. Only the dragged column and the unsized filler
  // may move now.
  const widthsBefore=await p.evaluate(()=>[...document.querySelectorAll('.ws-table>thead th')].map(t=>Math.round(t.getBoundingClientRect().width)));
  const h2=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Priority/.test(t.textContent));
    const r=th.querySelector('.col-resize').getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,
      idx:[...document.querySelectorAll('.ws-table>thead th')].indexOf(th),
      fillerIdx:[...document.querySelectorAll('.ws-table>thead th')].findIndex(t=>t.classList.contains('ws-col-filler'))};
  });
  await p.mouse.move(h2.x,h2.y);await p.mouse.down();
  await p.mouse.move(h2.x+60,h2.y,{steps:8});await p.mouse.up();
  await new Promise(r=>setTimeout(r,500));
  const widthsAfter=await p.evaluate(()=>[...document.querySelectorAll('.ws-table>thead th')].map(t=>Math.round(t.getBoundingClientRect().width)));
  const drift=widthsBefore.map((w,i)=>widthsAfter[i]-w);
  const strays=drift.map((d,i)=>({i,d})).filter(x=>Math.abs(x.d)>2&&x.i!==h2.idx&&x.i!==h2.fillerIdx);
  console.log('DRIFT:',JSON.stringify(drift),'stray columns:',JSON.stringify(strays));
  ok(drift[h2.idx]>40,'the dragged column actually grew (+'+drift[h2.idx]+'px)');
  ok(strays.length===0,'no other column moved — neighbours stay put ('+strays.length+' strays)');
  // The filler soaks up slack until it runs out; past that the table simply grows wider and
  // the container scrolls. Either is fine — what matters is that no real column shifted.
  ok(drift[h2.fillerIdx]<=0,'the filler column absorbs slack rather than pushing columns ('+drift[h2.fillerIdx]+'px)');

  // ---- table-layout must stay fixed, or the above silently regresses ----
  const layout=await p.evaluate(()=>({
    item:getComputedStyle(document.querySelector('.ws-table')).tableLayout,
    sub:document.querySelector('.ws-subtable')?getComputedStyle(document.querySelector('.ws-subtable')).tableLayout:'n/a'
  }));
  ok(layout.item==='fixed','item grid uses table-layout:fixed');
  ok(layout.sub==='fixed'||layout.sub==='n/a','subitem grid uses table-layout:fixed');

  // ---- add-column from either header ----
  const addBtns=await p.evaluate(()=>({
    item:!!document.querySelector('.ws-table>thead .mt-addcol-btn'),
    sub:!!document.querySelector('.ws-subtable thead .mt-addcol-btn')
  }));
  ok(addBtns.item,'item header has an add-column button');
  ok(addBtns.sub,'subitem header has its own add-column button');

  // opening from the subitem header preselects the subitem scope
  const preset=await p.evaluate(()=>{
    mtOpenAddColModal('subitem');
    const sel=document.querySelector('#mt-level-grid .mt-type-btn.selected');
    const lvl=mtSelectedColLevel;
    document.getElementById('mt-addcol-overlay')?.remove();
    return {lvl,label:sel?sel.textContent.trim():null};
  });
  console.log('ADD FROM SUB HEADER:',JSON.stringify(preset));
  ok(preset.lvl==='subitem','adding from the subitem header defaults the column to subitems');

  // ---- no clipped labels or cells at default widths ----
  const clip=await p.evaluate(()=>({
    hdrs:[...document.querySelectorAll('.col-label')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim()),
    cells:[...document.querySelectorAll('.ws-row td,.ws-subrow2 td')].filter(td=>td.scrollWidth>td.clientWidth+2).length
  }));
  console.log('CLIPPING:',JSON.stringify(clip));

  // ---- magnetic snap between the two grids ----
  const snapInfo=await p.evaluate(()=>{
    const subTh=[...document.querySelectorAll('.ws-subtable thead th')].find(t=>/STATUS/i.test(t.textContent));
    if(!subTh)return null;
    const r=subTh.getBoundingClientRect();
    const edges=[...document.querySelectorAll('.ws-table>thead th')].map(t=>Math.round(t.getBoundingClientRect().right));
    const target=edges.find(x=>x>r.right+12&&x<r.right+100);
    const h=subTh.querySelector('.col-resize').getBoundingClientRect();
    return target?{subRight:Math.round(r.right),target,hx:h.x+h.width/2,hy:h.y+h.height/2}:null;
  });
  if(snapInfo){
    await p.mouse.move(snapInfo.hx,snapInfo.hy);await p.mouse.down();
    // stop 4px SHORT of the item-grid boundary — magnetism should pull it the rest
    await p.mouse.move(snapInfo.hx+(snapInfo.target-snapInfo.subRight-4),snapInfo.hy,{steps:12});
    const mid=await p.evaluate(()=>{
      const g=document.getElementById('ws-snap-guide');
      const th=[...document.querySelectorAll('.ws-subtable thead th')].find(t=>/STATUS/i.test(t.textContent));
      return {guide:!!(g&&g.style.left),edge:Math.round(th.getBoundingClientRect().right)};
    });
    await p.mouse.up();
    await new Promise(r=>setTimeout(r,400));
    const post=await p.evaluate(()=>document.getElementById('ws-snap-guide').style.display==='none');
    console.log('SNAP:',JSON.stringify({...mid,target:snapInfo.target,guideHiddenAfter:post}));
    ok(mid.edge===snapInfo.target,'edge latches exactly onto the item grid boundary ('+mid.edge+' = '+snapInfo.target+')');
    ok(mid.guide,'a guide line shows while snapped');
    ok(post,'the guide disappears on release');

    // and you can still push past it
    const past=await p.evaluate(()=>{
      const th=[...document.querySelectorAll('.ws-subtable thead th')].find(t=>/STATUS/i.test(t.textContent));
      const h=th.querySelector('.col-resize').getBoundingClientRect();
      return {hx:h.x+h.width/2,hy:h.y+h.height/2,before:Math.round(th.getBoundingClientRect().right)};
    });
    await p.mouse.move(past.hx,past.hy);await p.mouse.down();
    await p.mouse.move(past.hx+55,past.hy,{steps:10});await p.mouse.up();
    await new Promise(r=>setTimeout(r,400));
    const pastAfter=await p.evaluate(()=>{
      const th=[...document.querySelectorAll('.ws-subtable thead th')].find(t=>/STATUS/i.test(t.textContent));
      return Math.round(th.getBoundingClientRect().right);
    });
    ok(pastAfter>past.before+30,'snapping is magnetic, not sticky — you can drag straight past it');
  }

  // ---- centred titles + fields ----
  const centred=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')];
    const nameTh=th[1],dataTh=th[3];
    const row=document.querySelector('.ws-row');
    const tds=[...row.children];
    return {
      nameLeft:getComputedStyle(nameTh).textAlign,
      dataHdr:getComputedStyle(dataTh).textAlign,
      dataCell:getComputedStyle(tds[3]).textAlign,
      subHdr:(()=>{const s=document.querySelectorAll('.ws-subtable thead th');return s[3]?getComputedStyle(s[3]).textAlign:'n/a';})()
    };
  });
  console.log('ALIGN:',JSON.stringify(centred));
  ok(centred.dataHdr==='center','data column titles are centred');
  ok(centred.dataCell==='center','data column cells are centred under their title');
  ok(centred.nameLeft!=='center','the task name column stays left-aligned');
  ok(centred.subHdr==='center'||centred.subHdr==='n/a','subitem titles are centred too');
  ok(clip.hdrs.length===0,'no header label is clipped at its default width');
  ok(clip.cells===0,'no cell content is clipped at default widths');

  // ---- inline rename: built-in item column ----
  const renamed=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Status/.test(t.textContent));
    const lbl=th.querySelector('.col-label');
    wsRenameColInline(lbl,'item','status',false);
    const editable=lbl.isContentEditable;
    lbl.textContent='Stage';
    lbl.dispatchEvent(new FocusEvent('blur'));
    return {editable};
  });
  await new Promise(r=>setTimeout(r,900));
  const afterRename=await p.evaluate(()=>({
    header:[...document.querySelectorAll('.ws-table>thead th')].map(t=>t.textContent.replace(/[⇅↑↓]/g,'').trim()).filter(Boolean),
    stored:(JSON.parse(localStorage.getItem('etcher_ws_colmeta')||'{}')[currentWorkboard.id]||{}).item?.labels?.status,
    dataIntact:document.querySelectorAll('.ws-status-cell').length
  }));
  console.log('RENAME:',JSON.stringify(afterRename));
  ok(renamed.editable,'double-click makes the header contenteditable');
  ok(afterRename.header.includes('Stage'),'header now reads the new label');
  ok(afterRename.stored==='Stage','the label override is persisted');
  ok(afterRename.dataIntact>0,'renaming the label did not disturb the column data');

  // ---- rename on the subitem grid too ----
  const subRename=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-subtable thead th')].find(t=>/Subitem/.test(t.textContent));
    const lbl=th.querySelector('.col-label');
    wsRenameColInline(lbl,'sub','name',false);
    lbl.textContent='Work item';
    lbl.dispatchEvent(new FocusEvent('blur'));
    return true;
  });
  await new Promise(r=>setTimeout(r,900));
  const subAfter=await p.evaluate(()=>({
    hdr:[...document.querySelectorAll('.ws-subtable thead th')].map(t=>t.textContent.trim()).filter(Boolean),
    stored:(JSON.parse(localStorage.getItem('etcher_ws_colmeta')||'{}')[currentWorkboard.id]||{}).sub?.labels?.name
  }));
  console.log('SUB RENAME:',JSON.stringify(subAfter));
  ok(subAfter.hdr.includes('Work item'),'subitem header renames independently of the item grid');
  ok(subAfter.stored==='Work item','subitem label stored under its own grid key');

  // ---- the two grids keep separate metadata ----
  const separate=await p.evaluate(()=>{
    const m=JSON.parse(localStorage.getItem('etcher_ws_colmeta')||'{}')[currentWorkboard.id]||{};
    return {itemLabels:Object.keys(m.item?.labels||{}),subLabels:Object.keys(m.sub?.labels||{})};
  });
  ok(separate.itemLabels.includes('status')&&!separate.subLabels.includes('status'),
     'item and subitem grids store their column metadata separately');

  // ---- escape cancels ----
  const escaped=await p.evaluate(()=>{
    const th=[...document.querySelectorAll('.ws-table>thead th')].find(t=>/Priority/.test(t.textContent));
    const lbl=th.querySelector('.col-label');
    const before=lbl.textContent.trim();
    wsRenameColInline(lbl,'item','priority',false);
    lbl.textContent='ZZZ';
    lbl.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return {before,after:lbl.textContent.trim()};
  });
  console.log('ESCAPE:',JSON.stringify(escaped));
  ok(escaped.after===escaped.before,'Escape cancels the rename and restores the original');

  // ---- reset puts a column back ----
  const reset=await p.evaluate(()=>{
    wsResetCol('item','status');
    const m=JSON.parse(localStorage.getItem('etcher_ws_colmeta')||'{}')[currentWorkboard.id]||{};
    return {label:m.item?.labels?.status,width:m.item?.widths?.status};
  });
  ok(reset.label===undefined&&reset.width===undefined,'wsResetCol clears both the label and the width');

  // ---- equal-width latch: making a set of columns match each other ----
  await p.evaluate(async()=>{renderView('workspace');await new Promise(r=>setTimeout(r,500));});
  const eq=await p.evaluate(()=>{
    const ths=[...document.querySelectorAll('.ws-table>thead th')].filter(t=>t.querySelector('.col-resize'));
    const h=ths[2].querySelector('.col-resize').getBoundingClientRect();
    return {hx:h.left+h.width/2,hy:h.top+h.height/2};
  });
  await p.mouse.move(eq.hx,eq.hy);await p.mouse.down();
  await p.mouse.move(eq.hx+1,eq.hy,{steps:2});
  // Read the snap targets the drag actually captured, rather than guessing from widths
  // measured before mousedown — earlier assertions in this suite have resized columns.
  const tgt=await p.evaluate(()=>{
    const cands=(_wsResize.widths||[]).filter(t=>Math.abs(t.w-_wsResize.startW)>25&&t.label!=='another column');
    return cands.length?{w:cands[0].w,label:cands[0].label,startW:_wsResize.startW}:null;
  });
  if(tgt){
    Object.assign(eq,{targetW:tgt.w,dragW:tgt.startW});
    await p.mouse.move(eq.hx+(tgt.w-tgt.startW)+4,eq.hy,{steps:14});
    await new Promise(r=>setTimeout(r,180));
    const latched=await p.evaluate(()=>{
      const t=document.getElementById('ws-size-tag');
      const ths=[...document.querySelectorAll('.ws-table>thead th')].filter(x=>x.querySelector('.col-resize'));
      return {w:Math.round(ths[2].getBoundingClientRect().width),tag:t?t.textContent:null,
        green:t?t.style.background==='rgb(13, 110, 78)':false};
    });
    await p.mouse.move(eq.hx+(eq.targetW-eq.dragW)+55,eq.hy,{steps:10});
    await new Promise(r=>setTimeout(r,150));
    const released=await p.evaluate(()=>{const t=document.getElementById('ws-size-tag');
      return {tag:t.textContent,green:t.style.background==='rgb(13, 110, 78)'};});
    await p.mouse.up();await new Promise(r=>setTimeout(r,250));
    const gone=await p.evaluate(()=>document.getElementById('ws-size-tag').style.display==='none');
    console.log('EQUAL WIDTH:',JSON.stringify({latched,released,gone}));
    ok(latched.w===eq.targetW,'dragging near another column latches to its exact width ('+latched.w+' = '+eq.targetW+')');
    ok(/ · same as /.test(latched.tag||''),'the read-out names the column it matches ("'+latched.tag+'")');
    ok(latched.green,'and turns green while matched');
    ok(!/ · same as /.test(released.tag||'')&&!released.green,'dragging past releases it ("'+released.tag+'")');
    ok(gone,'the read-out disappears on release');
  }else{
    await p.mouse.up();
    fail.push('no equal-width target was available to test against');
  }

  // ---- subitem columns reorder by drag, independently of the item tier ----
  const subord=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;
    const par=DB.tasks.find(t=>_taskBoardId(t)===bid&&!t.parentTaskId&&DB.tasks.some(c=>c.parentTaskId===t.id));
    if(!par)return{skip:true};
    wsExpanded.add(par.id);renderView('workspace');await new Promise(r=>setTimeout(r,800));
    const subTh=()=>[...document.querySelectorAll('.ws-subtable thead th')];
    const labels=()=>subTh().map(t=>(t.querySelector('.col-label')||{}).textContent||'').filter(Boolean);
    const o={before:labels(),
      draggable:subTh().filter(t=>t.getAttribute('draggable')==='true').length,
      itemBefore:[...document.querySelectorAll('.ws-table>thead th .col-label')].map(x=>x.textContent)};
    const order=_wsGetColOrder('sub')||_WS_DEFAULT_SUB_COL_ORDER;
    _wsDragCol={grid:'sub',key:order[2]};
    _wsColDrop({preventDefault(){}},'sub',order[0]);
    await new Promise(r=>setTimeout(r,700));
    wsExpanded.add(par.id);renderView('workspace');await new Promise(r=>setTimeout(r,700));
    o.after=labels();
    o.savedSub=(_wsGetColOrder('sub')||[]).join(',');
    o.itemAfter=[...document.querySelectorAll('.ws-table>thead th .col-label')].map(x=>x.textContent);
    // an item column must never land in the subitem row
    const snap=JSON.stringify(_wsGetColOrder('sub'));
    _wsDragCol={grid:'item',key:'status'};
    _wsColDrop({preventDefault(){}},'sub',(_wsGetColOrder('sub')||[])[0]);
    o.crossBlocked=JSON.stringify(_wsGetColOrder('sub'))===snap;
    // and the reverse
    const isnap=JSON.stringify(_wsGetColOrder('item'));
    _wsDragCol={grid:'sub',key:'owner'};
    _wsColDrop({preventDefault(){}},'item','status');
    o.crossBlocked2=JSON.stringify(_wsGetColOrder('item'))===isnap;
    _wsDragCol=null;
    return o;
  });
  console.log('SUBITEM ORDER:',JSON.stringify(subord));
  if(!subord.skip){
    ok(subord.draggable>0,'subitem headers are draggable ('+subord.draggable+')');
    ok(subord.before.join(',')!==subord.after.join(','),'dragging reorders the subitem columns ('+subord.after.join(' ')+')');
    ok(subord.savedSub.length>0,'the subitem order is saved under its own key');
    ok(subord.itemBefore.join(',')===subord.itemAfter.join(','),'the item columns are untouched by it');
    ok(subord.crossBlocked,'an item column cannot be dropped into the subitem grid');
    ok(subord.crossBlocked2,'nor a subitem column into the item grid');
  }

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
