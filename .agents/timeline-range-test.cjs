const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const S='2026-10-05', E='2026-10-19';

  // ── SUBITEM TIER ───────────────────────────────────────────────
  const sub=await p.evaluate(async(S,E)=>{
    const bid=DB.workboards[0].id;
    const parent=DB.tasks.find(t=>_taskBoardId(t)===bid&&!t.parentTaskId);
    openWorkboard(bid);await new Promise(r=>setTimeout(r,450));
    wsExpanded.add(parent.id);renderView('workspace');await new Promise(r=>setTimeout(r,500));
    const out={parentId:parent.id};

    wsStartInlineSubitem(parent.id);await new Promise(r=>setTimeout(r,500));
    const cell=document.getElementById('ws-inline-subtask-tl');
    out.cellExists=!!cell;
    out.emptyLabel=cell?cell.textContent.trim():null;
    out.oldSingleInput=!!document.getElementById('ws-inline-subtask-date');

    // open the range popover from the cell
    cell.closest('td').click();await new Promise(r=>setTimeout(r,350));
    const dd=document.getElementById('ws-cell-dd');
    const ins=[...document.querySelectorAll('#ws-cell-dd-body input[type=date]')];
    out.popoverVisible=dd&&dd.style.display==='block'&&dd.style.visibility==='visible';
    out.dateInputs=ins.length;
    out.labels=[...document.querySelectorAll('#ws-cell-dd-body div')].map(d=>d.childNodes[0]&&d.childNodes[0].nodeType===3?d.textContent.trim():'').filter(t=>t&&t.length<12);
    out.onScreen=dd?(()=>{const r=dd.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})():false;

    // set both ends
    ins[0].value=S;ins[0].dispatchEvent(new Event('change',{bubbles:true}));
    ins[1].value=E;ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,200));
    out.pending={..._wsInlineSubTL};
    out.cellText=document.getElementById('ws-inline-subtask-tl').textContent.trim();
    // the name field must survive setting dates (no full re-render)
    document.getElementById('ws-inline-subtask-input').value='Range sub A';
    out.nameKept=document.getElementById('ws-inline-subtask-input').value;
    wsCellClose();

    wsSaveInlineSubitem();await new Promise(r=>setTimeout(r,500));
    const made=DB.tasks.find(t=>t.parentTaskId===parent.id&&t.name==='Range sub A');
    out.saved=made?{start:made.startDate,end:made.endDate}:null;
    out.rendered=document.body.textContent.includes('5 – 19 Oct');
    return out;
  },S,E);

  console.log('SUBITEM:',JSON.stringify(sub,null,1));
  ok(sub.cellExists,'subitem add row has a Timeline cell');
  ok(!sub.oldSingleInput,'the old single date input is gone');
  ok(sub.emptyLabel==='+ dates','empty cell invites a click ("'+sub.emptyLabel+'")');
  ok(sub.popoverVisible,'clicking it opens the range popover');
  ok(sub.dateInputs===2,'popover offers TWO dates, not one (got '+sub.dateInputs+')');
  ok(sub.labels.includes('Start')&&sub.labels.includes('End / Due'),'labelled Start and End / Due');
  ok(sub.onScreen,'popover is placed fully on screen');
  ok(sub.pending.start===S&&sub.pending.end===E,'both ends held pending save');
  ok(sub.cellText==='5 – 19 Oct','cell shows the range inline ("'+sub.cellText+'")');
  ok(sub.nameKept==='Range sub A','setting dates does not wipe the half-typed name');
  ok(sub.saved&&sub.saved.start===S,'saved subitem keeps the START date');
  ok(sub.saved&&sub.saved.end===E,'saved subitem keeps the END date');
  ok(sub.rendered,'the range renders in the subitem grid');

  // ── pasting a list carries the range to every row ──────────────
  const paste=await p.evaluate(async(S,E)=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&_taskBoardId(t)===DB.workboards[0].id);
    wsStartInlineSubitem(parent.id);await new Promise(r=>setTimeout(r,450));
    _wsInlineSubTL={start:S,end:E};
    const inp=document.getElementById('ws-inline-subtask-input');
    const dt=new DataTransfer();dt.setData('text','Bulk R1\nBulk R2\nBulk R3');
    inp.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,500));
    const made=DB.tasks.filter(t=>t.parentTaskId===parent.id&&/^Bulk R/.test(t.name));
    return {n:made.length,allRanged:made.length>0&&made.every(t=>t.startDate===S&&t.endDate===E)};
  },S,E);
  console.log('SUB PASTE:',JSON.stringify(paste));
  ok(paste.n===3,'pasted 3 subitems');
  ok(paste.allRanged,'every pasted subitem got the whole range');

  // ── the pending range must not leak into the next row ──────────
  const leak=await p.evaluate(async()=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&_taskBoardId(t)===DB.workboards[0].id);
    wsStartInlineSubitem(parent.id);await new Promise(r=>setTimeout(r,400));
    const onOpen={..._wsInlineSubTL};
    _wsInlineSubTL={start:'2020-01-01',end:'2020-02-02'};
    wsCancelInlineSubitem();await new Promise(r=>setTimeout(r,350));
    return {onOpen,afterCancel:{..._wsInlineSubTL}};
  });
  console.log('LEAK:',JSON.stringify(leak));
  ok(!leak.onOpen.start&&!leak.onOpen.end,'a fresh add row starts with no dates');
  ok(!leak.afterCancel.start&&!leak.afterCancel.end,'cancelling clears the pending range');

  // ── ITEM TIER ──────────────────────────────────────────────────
  const item=await p.evaluate(async(S,E)=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&_taskBoardId(t)===DB.workboards[0].id);
    wsStartInlineAdd(parent.groupId,parent.groupId);await new Promise(r=>setTimeout(r,500));
    const out={};
    const st=document.getElementById('ws-inline-startdate');
    const en=document.getElementById('ws-inline-duedate');
    out.hasStart=!!st;out.hasEnd=!!en;
    if(!st||!en)return out;
    document.getElementById('ws-inline-name').value='Range item A';
    st.value=S;en.value=E;
    wsSaveInlineTask();await new Promise(r=>setTimeout(r,500));
    const made=DB.tasks.find(t=>t.name==='Range item A');
    out.saved=made?{start:made.startDate,end:made.endDate}:null;
    return out;
  },S,E);
  console.log('ITEM:',JSON.stringify(item));
  ok(item.hasStart&&item.hasEnd,'item add bar has both a start and an end field');
  ok(item.saved&&item.saved.start===S,'item keeps the typed START (was hardcoded to today)');
  ok(item.saved&&item.saved.end===E,'item keeps the END date');

  // ── an item add with no start still defaults to today ──────────
  const dflt=await p.evaluate(async()=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&_taskBoardId(t)===DB.workboards[0].id);
    wsStartInlineAdd(parent.groupId,parent.groupId);await new Promise(r=>setTimeout(r,450));
    document.getElementById('ws-inline-name').value='No start item';
    wsSaveInlineTask();await new Promise(r=>setTimeout(r,450));
    const made=DB.tasks.find(t=>t.name==='No start item');
    // Local date, matching the app — a UTC expectation here is a day behind between midnight
    // and 08:00 Perth, which made this fail every morning.
    return {start:made?made.startDate:null,today:toDateStr(new Date())};
  });
  console.log('DEFAULT:',JSON.stringify(dflt));
  ok(dflt.start===dflt.today,'leaving start blank still defaults to today, as before');

  // ── existing subitems are untouched ────────────────────────────
  const existing=await p.evaluate(async()=>{
    const kid=DB.tasks.find(t=>t.parentTaskId&&t.name==='Range sub A');
    const td=[...document.querySelectorAll('.ws-subtable td')]
      .find(x=>/wsCellOpen\('[^']+','duedate'/.test(x.getAttribute('onclick')||''));
    if(!td)return{err:'no cell'};
    td.click();await new Promise(r=>setTimeout(r,320));
    const body=document.getElementById('ws-cell-dd-body');
    const n=body.querySelectorAll('input[type=date]').length;
    // The popover also offers a Single day shortcut, so count the labels rather than
    // assuming the number of date inputs: what matters is that a range is still on offer.
    const labels=[...body.querySelectorAll('div')].map(d=>d.textContent.trim().toLowerCase());
    const hasStart=labels.includes('start');
    const hasEnd=labels.includes('end / due');
    wsCellClose();
    return {n,hasStart,hasEnd,kidHasRange:!!(kid&&kid.startDate&&kid.endDate)};
  });
  console.log('EXISTING:',JSON.stringify(existing));
  ok(existing.hasStart&&existing.hasEnd,'editing an existing subitem still gives a range');

  // cleanup
  await p.evaluate(()=>{
    DB.tasks=DB.tasks.filter(t=>!/^(Range sub A|Range item A|No start item|Bulk R\d)$/.test(t.name));
    saveDB(DB);
  });

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
