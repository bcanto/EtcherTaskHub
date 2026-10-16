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

  // ---- 3.1/3.2 backfill integrity ----
  const bf=await p.evaluate(()=>{
    const withBoard=DB.tasks.filter(t=>_taskBoardId(t));
    const dupes={};
    const byBoard={};
    withBoard.forEach(t=>{const b=_taskBoardId(t);(byBoard[b]=byBoard[b]||[]).push(t.refNumber);});
    Object.entries(byBoard).forEach(([b,ns])=>{
      const seen=new Set(),d=[];ns.forEach(n=>{if(n==null)return;if(seen.has(n))d.push(n);seen.add(n);});
      if(d.length)dupes[b]=d;
    });
    return {
      tasksWithBoard:withBoard.length,
      missingRef:withBoard.filter(t=>!t.refNumber).length,
      subitems:withBoard.filter(t=>t.parentTaskId).length,
      subitemsWithRef:withBoard.filter(t=>t.parentTaskId&&t.refNumber).length,
      duplicates:dupes,
      prefixes:DB.workboards.map(w=>_boardRefPrefix(w)),
      flag:DB.migrationFlags.taskRefsV1,
      sample:taskRef(withBoard[0])
    };
  });
  console.log('BACKFILL:',JSON.stringify(bf));
  ok(bf.missingRef===0,'every task on a board has a ref ('+bf.tasksWithBoard+' tasks)');
  ok(bf.subitems>0&&bf.subitemsWithRef===bf.subitems,'subitems get refs too ('+bf.subitemsWithRef+'/'+bf.subitems+')');
  ok(Object.keys(bf.duplicates).length===0,'no duplicate ref numbers within a board');
  ok(/^[A-Z0-9]{1,4}-\d{3}$/.test(bf.sample),'ref format looks like PREFIX-001 ("'+bf.sample+'")');
  ok(bf.flag===true,'migration flag set');

  // ---- migration must not run twice ----
  const twice=await p.evaluate(()=>{
    const before=DB.tasks.map(t=>t.id+':'+t.refNumber).join(',');
    _assignTaskRefs(DB);               // idempotent?
    const after=DB.tasks.map(t=>t.id+':'+t.refNumber).join(',');
    return before===after;
  });
  ok(twice,'re-running the assignment changes nothing (idempotent)');

  // ---- new task gets the next number, never a reused one ----
  const created=await p.evaluate(()=>{
    const c={};(DB.tasks||[]).forEach(t=>{const b=t.boardId||t.workboardId;if(b&&!t.parentTaskId)c[b]=(c[b]||0)+1;});
    const bid=Object.keys(c).sort((a,b)=>c[b]-c[a])[0];
    const board=DB.workboards.find(w=>w.id===bid);
    const beforeNext=board.nextRef;
    const highest=Math.max(...DB.tasks.filter(t=>_taskBoardId(t)===bid).map(t=>t.refNumber||0));
    const t={id:'t-reftest',name:'Ref test',boardId:bid,workboardId:bid,
      groupId:DB.groups.find(g=>(g.boardId||g.workboardId)===bid)?.id,
      status:'todo',priority:'med',createdAt:new Date().toISOString()};
    DB.tasks.push(t);saveDB(DB);
    const gotRef=t.refNumber, gotStr=taskRef(t);
    // delete it, then make another — the number must NOT be reused
    DB.tasks=DB.tasks.filter(x=>x.id!=='t-reftest');saveDB(DB);
    const t2={id:'t-reftest2',name:'Ref test 2',boardId:bid,workboardId:bid,
      groupId:t.groupId,status:'todo',priority:'med',createdAt:new Date().toISOString()};
    DB.tasks.push(t2);saveDB(DB);
    const second=t2.refNumber;
    DB.tasks=DB.tasks.filter(x=>x.id!=='t-reftest2');saveDB(DB);
    return {highest,gotRef,gotStr,second,beforeNext,afterNext:board.nextRef};
  });
  console.log('NEW TASK:',JSON.stringify(created));
  ok(created.gotRef===created.highest+1,'new task takes the next number ('+created.gotRef+' after '+created.highest+')');
  ok(created.second>created.gotRef,'a deleted task does not release its number ('+created.gotRef+' then '+created.second+')');

  // ---- 3.3 surfaced in the table ----
  await p.evaluate(()=>{
    const c={};(DB.tasks||[]).forEach(t=>{const b=t.boardId||t.workboardId;if(b&&!t.parentTaskId)c[b]=(c[b]||0)+1;});
    openWorkboard(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]);
  });
  await new Promise(r=>setTimeout(r,1400));
  const offByDefault=await p.evaluate(()=>({
    colOff:!document.querySelector('.ws-row .ws-ref'),
    inColumnsMenu:[...document.querySelectorAll('#ws-col-menu .ws-dropdown-item')].some(i=>/\bID\b/.test(i.textContent))
  }));
  ok(offByDefault.colOff,'ID column is off by default');
  ok(offByDefault.inColumnsMenu,'ID is offered in the Columns menu');

  const onNow=await p.evaluate(()=>{wsToggleCol('ref');return null;});
  await new Promise(r=>setTimeout(r,900));
  const shown=await p.evaluate(()=>{
    const cells=[...document.querySelectorAll('.ws-row .ws-ref')];
    return {count:cells.length,first:cells[0]?.textContent.trim(),
      allFormatted:cells.every(c=>/^[A-Z0-9]{1,4}-\d{3}$/.test(c.textContent.trim()))};
  });
  console.log('ID COLUMN ON:',JSON.stringify(shown));
  ok(shown.count>0,'enabling the column shows refs');
  ok(shown.allFormatted,'every rendered ref is well-formed');

  // task panel header
  const panel=await p.evaluate(()=>{
    const t=DB.tasks.find(x=>_taskBoardId(x)===currentWorkboard.id&&!x.parentTaskId);
    openTaskPanel(t.id);
    return null;
  });
  await new Promise(r=>setTimeout(r,900));
  const hdr=await p.evaluate(()=>{
    const el=document.querySelector('#task-panel .ws-ref');
    return el?el.textContent.trim():null;
  });
  ok(hdr&&/^[A-Z0-9]{1,4}-\d{3}$/.test(hdr),'task panel header shows the ref ("'+hdr+'")');
  await p.evaluate(()=>closeTaskPanel());
  await new Promise(r=>setTimeout(r,400));

  // ---- searchable by ref ----
  const search=await p.evaluate(()=>{
    const t=DB.tasks.find(x=>_taskBoardId(x)===currentWorkboard.id&&x.refNumber);
    const ref=taskRef(t);
    wsMtSearch=ref;renderView('workspace');
    const names=[...document.querySelectorAll('.ws-row .ws-task-name-span')].map(s=>s.textContent.trim());
    wsMtSearch='';renderView('workspace');
    return {ref,matched:names.length,expected:(t.name||'').slice(0,25),names:names.slice(0,3)};
  });
  console.log('SEARCH BY REF:',JSON.stringify(search));
  ok(search.matched>=1&&search.matched<=2,'filtering by a ref narrows to that task ('+search.matched+' rows)');

  // ---- prefix rename relabels without renumbering ----
  const rename=await p.evaluate(()=>{
    const wb=currentWorkboard;
    const before=DB.tasks.filter(t=>_taskBoardId(t)===wb.id).map(t=>t.refNumber).join(',');
    saveWbRefPrefix(wb.id,'zz9');
    const after=DB.tasks.filter(t=>_taskBoardId(t)===wb.id).map(t=>t.refNumber).join(',');
    const sample=taskRef(DB.tasks.find(t=>_taskBoardId(t)===wb.id));
    return {numbersUnchanged:before===after,prefix:wb.refPrefix,sample};
  });
  console.log('RENAME PREFIX:',JSON.stringify(rename));
  ok(rename.prefix==='ZZ9','prefix is uppercased and sanitised');
  ok(rename.numbersUnchanged,'renaming the prefix does not renumber anything');
  ok(rename.sample.startsWith('ZZ9-'),'refs immediately use the new prefix');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
