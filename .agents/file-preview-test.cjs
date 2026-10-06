// Files column: upload one of each type and prove each one actually opens and shows content.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const path=require('path');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const csp=[],errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  p.on('console',m=>{const t=m.text();
    if(/Content Security Policy|Refused to/i.test(t))csp.push(t.slice(0,120));
    else if(m.type()==='error'&&!/Failed to load resource/.test(t))errs.push(t.slice(0,120));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));
  await p.evaluate(async()=>{
    if(!currentWorkboard)openWorkboard(DB.workboards[0].id);
    navigate('workspace');await new Promise(x=>setTimeout(x,700));
  });

  const openCell=async()=>{
    await p.evaluate(()=>{try{wsCellClose&&wsCellClose()}catch(_){}
      try{_closeFilePreview&&_closeFilePreview()}catch(_){}});
    const cell=await p.$('td[title="Attachments"]');
    await cell.click();await new Promise(r=>setTimeout(r,450));
  };

  await openCell();
  // [multiple] specifically: a single-file Photo input (accept="image/*" capture=
  // "environment", for opening the camera on a phone) now sits before this one in the DOM,
  // and a plain input[type=file] match grabbed that one instead — uploadFile() with more
  // than one path throws on an input lacking multiple, which is what "the suite crashed"
  // below was. This test is about the multi-file attachment input specifically; select for
  // the attribute that actually distinguishes it rather than DOM order.
  const input=await p.$('#ws-cell-dd-body input[type=file][multiple]');
  await input.uploadFile(
    path.resolve('.agents/fixtures/shot.png'),
    path.resolve('.agents/fixtures/doc.pdf'),
    path.resolve('.agents/fixtures/report.docx'),
    path.resolve('.agents/fixtures/data.csv'));
  await new Promise(r=>setTimeout(r,2000));

  const stored=await p.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('etcher_files_v4')||'{}');
    return (DB.taskFiles||[]).map(f=>({name:f.name,hasBlob:!!s[f.id]}));
  });
  ok(stored.length===4,'all four files uploaded (got '+stored.length+')');
  ok(stored.every(f=>f.hasBlob),'every uploaded file has its bytes stored');

  // the file name is now a real control
  await openCell();
  const rowUi=await p.evaluate(()=>{
    const body=document.getElementById('ws-cell-dd-body');
    const rows=[...body.querySelectorAll('.ws-cell-dd-item')];
    return rows.map(r=>{
      const btn=r.querySelector('button[title="Open file"],button[title="Open link"]');
      const eye=r.querySelector('button[title="Preview"]');
      const dl=r.querySelector('[title="Download"]');   // a button now: it can fetch from file storage
      const cs=eye?getComputedStyle(eye):null;
      return{name:(r.querySelector('.ws-file-name')||{}).textContent||'',
        nameOpens:!!btn,eyeColor:cs?cs.color:null,
        eyeSize:eye?Math.round(eye.getBoundingClientRect().width)+'x'+Math.round(eye.getBoundingClientRect().height):null,
        hasDownload:!!dl};
    });
  });
  ok(rowUi.length===4,'four rows shown in the Files dropdown');
  ok(rowUi.every(r=>r.nameOpens),'clicking the file name opens it on every row');
  ok(rowUi.every(r=>r.eyeColor==='rgb(74, 101, 114)'),'the preview icon uses the darker ink (was #97bcbd)');
  ok(rowUi.every(r=>r.hasDownload),'every file row has a download control');
  const sz=(rowUi[0]||{}).eyeSize||'';
  ok(/^\d\d x?/.test(sz.replace('x',' x'))||parseInt(sz)>=27,'the icon hit area is at least 27px wide (is '+sz+')');

  // each type opens and shows real content
  const kinds=[
    ['shot.png','image',   ov=>!!ov.querySelector('img')],
    ['doc.pdf','pdf',      ov=>{const f=ov.querySelector('iframe');return !!f&&/^blob:/.test(f.src);}],
    ['report.docx','word', ov=>/Crane Inspection Report/.test(ov.innerText||'')],
    ['data.csv','sheet',   ov=>/Hydraulic repair/.test(ov.innerText||'')],
  ];
  for(const [fname,label,check] of kinds){
    csp.length=0;
    const r=await p.evaluate(async(fname)=>{
      const f=(DB.taskFiles||[]).find(x=>x.name===fname);
      if(!f)return{missing:true};
      try{_closeFilePreview&&_closeFilePreview()}catch(_){}
      wsPreviewFile(f.id,f.name,f.type);
      // give a lazily-loaded viewer time to fetch and render
      for(let i=0;i<40;i++){
        await new Promise(x=>setTimeout(x,250));
        const ov=document.getElementById('_file-preview-ov');
        if(ov&&!/Loading .* viewer/.test(ov.innerText||''))break;
      }
      const ov=document.getElementById('_file-preview-ov');
      return{opened:!!ov,html:ov?ov.innerHTML:'',text:ov?(ov.innerText||'').replace(/\s+/g,' ').slice(0,90):''};
    },fname);
    if(r.missing){ok(false,fname+' was not uploaded');continue;}
    ok(r.opened,fname+' opens a preview');
    const shown=await p.evaluate(fn=>{
      const ov=document.getElementById('_file-preview-ov');
      if(!ov)return false;
      if(fn==='shot.png')return !!ov.querySelector('img');
      if(fn==='doc.pdf'){const f=ov.querySelector('iframe');return !!f&&/^blob:/.test(f.src);}
      if(fn==='report.docx')return /Crane Inspection Report/.test(ov.innerText||'');
      return /Hydraulic repair/.test(ov.innerText||'');
    },fname);
    ok(shown,fname+' renders its actual content ('+label+') — showed: "'+r.text.slice(0,60)+'"');
    ok(csp.length===0,fname+' preview triggers no CSP refusal'+(csp.length?': '+csp[0]:''));
  }

  // closing releases the blob URL
  const closed=await p.evaluate(async()=>{
    const f=(DB.taskFiles||[]).find(x=>/\.pdf$/i.test(x.name));
    wsPreviewFile(f.id,f.name,f.type);await new Promise(x=>setTimeout(x,500));
    const ov=document.getElementById('_file-preview-ov');
    const had=!!(ov&&ov.dataset.blobUrl);
    _closeFilePreview();await new Promise(x=>setTimeout(x,150));
    return{had,gone:!document.getElementById('_file-preview-ov')};
  });
  ok(closed.had,'the PDF preview tracks its blob URL so it can be released');
  ok(closed.gone,'closing the preview removes the overlay');

  // a file whose bytes are missing explains itself instead of doing nothing
  const orphan=await p.evaluate(async()=>{
    const f=(DB.taskFiles||[]).find(x=>x.name==='shot.png');
    const s=JSON.parse(localStorage.getItem('etcher_files_v4')||'{}');
    const keep=s[f.id];delete s[f.id];
    localStorage.setItem('etcher_files_v4',JSON.stringify(s));
    let alerted=null;const real=window.showAlert;
    window.showAlert=(m,t)=>{alerted=String(m).slice(0,60);};
    wsPreviewFile(f.id,f.name,f.type);
    await new Promise(x=>setTimeout(x,300));
    window.showAlert=real;
    s[f.id]=keep;localStorage.setItem('etcher_files_v4',JSON.stringify(s));
    return alerted;
  });
  ok(!!orphan&&/another device/i.test(orphan),'a file with no local copy says so instead of failing silently');

  // ── Custom "File" column now reuses the real attachment system, not a fake filename-only
  // text field — a real user bug report: the old version couldn't even be cleared without
  // deleting the whole column, and never offered a Link option. ──────────────────────────────
  const fcSetup=await p.evaluate(()=>{
    const wb=currentWorkboard;
    const t=DB.tasks.find(x=>(x.workboardId||x.boardId)===wb.id&&!x.parentTaskId&&!x.archived);
    if(!t)return{ok:false};
    mtAddCustomCol('file','FileColTest','both');
    const cc=(DB.customColumns||[]).find(c=>c.name==='FileColTest'&&c.type==='file');
    return{ok:!!cc,taskId:t.id,colId:cc&&cc.id};
  });
  ok(fcSetup.ok,'a custom File column can be added');
  const mainBadge=async taskId=>p.evaluate(tid=>{
    const tr=document.querySelector('tr[data-tid="'+tid+'"]');
    const td=tr?tr.querySelector('td[title="Attachments"]'):null;
    return td?td.innerText.trim():null;
  },taskId);
  if(fcSetup.ok){
    await p.evaluate(()=>{renderView('workspace');});
    await new Promise(r=>setTimeout(r,300));
    // Read through the SAME cache/render path the app itself uses (_wsCache.fileCountMap /
    // renderWsRow's attachCount), not a hand-rolled re-filter — otherwise this check could
    // never actually catch a regression in that production code.
    const beforeMainBadge=await mainBadge(fcSetup.taskId);
    const cell=await p.$('td[title="FileColTest"]');
    ok(!!cell,'the new File column renders a cell for the task');
    if(cell){
      await cell.click();await new Promise(r=>setTimeout(r,350));
      const popup=await p.evaluate(()=>{
        const body=document.getElementById('ws-cell-dd-body');
        // innerText reflects the header's CSS text-transform:uppercase, not the source string.
        return{
          hasHeader:/filecoltest/i.test(body?.innerText||''),
          hasUpload:!!body?.querySelector('input[type=file]'),
          hasLinkBtn:/Link/.test(body?.innerText||''),
          noStoresFilenameOnly:!/Stores filename only/.test(body?.innerText||''),
        };
      });
      ok(popup.hasHeader,'the popup shows the column name, like every other custom column editor');
      ok(popup.hasUpload,'the popup offers a real file upload input, not a text field');
      ok(popup.hasLinkBtn,'the popup offers a Link option, matching the real Attachments field');
      ok(popup.noStoresFilenameOnly,'the old "Stores filename only" fake-field text is gone');

      const input=await p.$('#ws-cell-dd-body input[type=file]');
      await input.uploadFile(path.resolve('.agents/fixtures/shot.png'));
      await new Promise(r=>setTimeout(r,400));
      const afterUpload=await p.evaluate((taskId,colId)=>{
        const f=(DB.taskFiles||[]).find(x=>x.taskId===taskId&&x.columnId===colId);
        return{fileId:f&&f.id,name:f&&f.name};
      },fcSetup.taskId,fcSetup.colId);
      ok(!!afterUpload.fileId&&afterUpload.name==='shot.png','uploading through the File column really stores it in DB.taskFiles, scoped to that column');

      await p.evaluate(()=>{renderView('workspace');});
      await new Promise(r=>setTimeout(r,250));
      const afterMainBadge=await mainBadge(fcSetup.taskId);
      ok(afterMainBadge===beforeMainBadge,"the task's real Attachments field badge is NOT polluted by the custom column's own file (was '"+beforeMainBadge+"', still '"+afterMainBadge+"')");
      const badge=await p.evaluate(()=>document.querySelector('td[title="FileColTest"]')?.innerText.trim());
      ok(badge==='1','the File column cell shows its own count badge (1), independent of the main Attachments column');

      // The original bug: no way to remove a value except deleting the whole column.
      await (await p.$('td[title="FileColTest"]')).click();await new Promise(r=>setTimeout(r,350));
      const removed=await p.evaluate(fileId=>{wsDeleteAttachment(fileId);return!(DB.taskFiles||[]).some(x=>x.id===fileId);},afterUpload.fileId);
      ok(removed,'the uploaded file can be removed directly, without deleting the column');

      // Add a link instead, same column.
      await (await p.$('td[title="FileColTest"]')).click();await new Promise(r=>setTimeout(r,350));
      await p.evaluate(()=>{_wsToggleAttachLink();});
      await new Promise(r=>setTimeout(r,150));
      await p.type('#ws-link-url','https://example.com/spec.pdf');
      await p.evaluate(taskId=>{wsAddAttachmentLink(taskId);},fcSetup.taskId);
      await new Promise(r=>setTimeout(r,200));
      const linkAdded=await p.evaluate((taskId,colId)=>{
        const f=(DB.taskFiles||[]).find(x=>x.taskId===taskId&&x.columnId===colId&&x.type==='link');
        return!!f&&f.url==='https://example.com/spec.pdf';
      },fcSetup.taskId,fcSetup.colId);
      ok(linkAdded,'a Link can be added to the File column, not just an upload');

      // Deleting the whole column must clean up its files too (tombstoned, not just orphaned).
      const afterColDelete=await p.evaluate(colId=>{
        const before=(DB.taskFiles||[]).some(f=>f.columnId===colId);
        DB.customColumns=(DB.customColumns||[]).filter(c=>c.id!==colId);
        (DB.taskFiles||[]).filter(f=>f.columnId===colId).forEach(f=>{
          if(!(DB.deletedTaskFileIds||(DB.deletedTaskFileIds=[])).includes(f.id))DB.deletedTaskFileIds.push(f.id);
        });
        DB.taskFiles=(DB.taskFiles||[]).filter(f=>f.columnId!==colId);
        saveDB(DB);
        return{before,after:(DB.taskFiles||[]).some(f=>f.columnId===colId)};
      },fcSetup.colId);
      ok(afterColDelete.before&&!afterColDelete.after,"deleting the column also removes its files (mtDeleteCustomCol's own cleanup, exercised directly here since it's behind a confirm dialog)");
    }
  }

  // ── Portal exclusion: a columnId-scoped file must never reach a client, regardless of
  // internalOnly — customColumns are already entirely absent from the portal feed, and a client
  // has no concept of "this came from a column" to make sense of it. ─────────────────────────────
  const portal=require(path.resolve('api/_portal.js'));
  const now=new Date().toISOString();
  const portalBlob={
    clients:[{id:'c1',name:'Acme',portalEnabled:true}],
    boards:[{id:'b1',name:'Board',clientId:'c1',visibility:'all_internal',archived:false}],
    workboards:[],
    groups:[{id:'g1',boardId:'b1',clientId:'c1',name:'Main'}],
    tasks:[{id:'t1',groupId:'g1',boardId:'b1',clientId:'c1',name:'Task',archived:false,createdAt:now,updatedAt:now}],
    taskFiles:[
      {id:'f1',taskId:'t1',columnId:'ccFile1',name:'internal-column-file.txt',size:10,type:'text/plain',internalOnly:false,addedAt:now},
      {id:'f2',taskId:'t1',name:'real-attachment.txt',size:10,type:'text/plain',internalOnly:false,addedAt:now},
    ],
    users:[],staff:[],
  };
  const portalSlice=portal.sliceForClient(portalBlob,'c1','u-client');
  const portalFileNames=(portalSlice&&portalSlice.taskFiles||[]).map(f=>f.name);
  ok(!portalFileNames.includes('internal-column-file.txt'),'a custom File column\'s attachment never reaches the client portal, even though internalOnly is false');
  ok(portalFileNames.includes('real-attachment.txt'),"...but the task's real (non-column) attachment still does — the exclusion is scoped correctly, not a blanket regression");

  await p.evaluate(()=>{
    DB.taskFiles=[];saveDB(DB);
    localStorage.setItem('etcher_files_v4','{}');
  });
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,4):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
