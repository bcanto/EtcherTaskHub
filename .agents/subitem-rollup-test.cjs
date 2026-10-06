const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
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

  const r=await p.evaluate(async()=>{
    const out={};
    const bid=DB.workboards[0].id;
    const gid=DB.groups.find(g=>(g.boardId||g.workboardId)===bid)?.id;
    const now=new Date().toISOString();
    // parent with deliberately WRONG own dates + children spanning a known range
    DB.tasks.push({id:'roll-p',name:'Rollup parent',boardId:bid,workboardId:bid,groupId:gid,
      status:'in-progress',priority:'med',createdAt:now,startDate:'2026-01-01',endDate:'2026-01-02'});
    [['roll-c1','2026-03-10','2026-03-20'],
     ['roll-c2','2026-02-05','2026-04-25'],   // earliest start AND latest end
     ['roll-c3','2026-03-01','2026-03-15']].forEach(([id,s,e])=>{
      DB.tasks.push({id,name:id,parentTaskId:'roll-p',boardId:bid,workboardId:bid,groupId:gid,
        status:'todo',priority:'low',createdAt:now,startDate:s,endDate:e});
    });
    saveDB(DB);
    out.span=getTaskDateSpan('roll-p');
    out.leafSpan=getTaskDateSpan('roll-c1');           // a leaf has no span
    // archived children must be excluded
    DB.tasks.find(t=>t.id==='roll-c2').archived=true;
    out.spanExclArchived=getTaskDateSpan('roll-p');
    DB.tasks.find(t=>t.id==='roll-c2').archived=false;
    openWorkboard(bid);wsExpanded.add('roll-p');renderView('workspace');
    await new Promise(r=>setTimeout(r,400));
    const row=document.querySelector('.ws-row[data-tid="roll-p"]');
    const td=[...row.querySelectorAll('td')].find(x=>/\d+\s[A-Z][a-z]{2}/.test(x.textContent));
    out.rendered=td?td.textContent.replace(/\s+/g,' ').trim():null;
    out.tooltip=td?td.getAttribute('title'):null;
    // select-all subitems
    const host=row.nextElementSibling;
    out.hasSelectAll=!!host.querySelector('thead input[type=checkbox]');
    wsSelected.clear();
    wsSelectAllSubitems('roll-p',true);
    out.selectedAll=[...wsSelected].filter(id=>id.startsWith('roll-c')).length;
    out.rowsMarked=host.querySelectorAll('.ws-subrow2.ws-row-selected').length;
    wsSelectAllSubitems('roll-p',false);
    out.clearedTo=[...wsSelected].filter(id=>id.startsWith('roll-c')).length;
    // cleanup
    DB.tasks=DB.tasks.filter(t=>!t.id.startsWith('roll-'));
    wsExpanded.delete('roll-p');saveDB(DB);
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  ok(r.span&&r.span.startDate==='2026-02-05','span starts at the earliest subitem ('+(r.span||{}).startDate+')');
  ok(r.span&&r.span.endDate==='2026-04-25','span ends at the latest subitem ('+(r.span||{}).endDate+')');
  ok(r.leafSpan===null,'a task with no subitems has no rolled-up span');
  ok(r.spanExclArchived&&r.spanExclArchived.startDate==='2026-03-01'&&r.spanExclArchived.endDate==='2026-03-20',
     'archived subitems are excluded from the span');
  ok(/Feb/.test(r.rendered||'')&&/Apr/.test(r.rendered||''),'the row renders the rolled-up range ("'+r.rendered+'")');
  ok(!/1 Jan/.test(r.rendered||''),'the parent no longer shows its own stale dates');
  ok(/rolled up from 3 subitems/.test(r.tooltip||''),'tooltip explains the rollup');
  ok(r.hasSelectAll,'subitem grid header has a select-all checkbox');
  ok(r.selectedAll===3,'select-all selects every subitem ('+r.selectedAll+')');
  ok(r.rowsMarked===3,'selected subitem rows are visually marked ('+r.rowsMarked+')');
  ok(r.clearedTo===0,'unchecking clears them all');

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
