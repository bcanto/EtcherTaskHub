// Regression checks for the 2026-09-24 audit of the client-portal work (browser side):
//  1. With → Client in the task modal saves the rest of the form before handing off.
//  2. The portal Overview only offers Approve / Request changes for an approval ask.
//  3. Work-request attachments are capped at 10 files / 3 MB total in the portal.
//  4. Logging out of a client session holding a server slice reloads the page.
// The server-side halves (approval-ask rule, share-board hidden tasks, attachment cap) are in
// portal-logic-test.cjs. Offline only — gate.sh checks the server first.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const report=()=>{
    console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
    console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
    console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
  };

  const setup=await p.evaluate(()=>{
    const resolveClient=t=>t.clientId||(DB.groups.find(g=>g.id===t.groupId)||{}).clientId||null;
    const t=DB.tasks.find(x=>!x.archived&&!x.parentTaskId&&x.ownerId&&resolveClient(x)&&!x.clientHidden
      &&x.currentlyWithType!=='client'&&!(DB.actionRequests||[]).some(r=>r.taskId===x.id&&r.status==='open'));
    return t?{id:t.id,name:t.name,clientId:resolveClient(t)}:null;
  });
  if(!setup){fail.push('no seed task with an owner and a resolvable client');report();await b.close();process.exit(1);}

  // ── 1. With → Client keeps the other edits ──
  const cw=await p.evaluate(({id,name})=>{
    openTaskModal(id);
    document.getElementById('tm-name').value=name+' (edited)';
    const sel=document.getElementById('tm-cw');
    const hasClient=[...sel.options].some(o=>o.value==='client');
    sel.value='client';tmCwChanged(sel);
    const r={hasClient,
      saved:DB.tasks.find(t=>t.id===id).name===name+' (edited)',
      taskModalClosed:document.getElementById('task-modal').classList.contains('hidden'),
      composer:document.getElementById('generic-modal-title').textContent,
      holderUnchanged:DB.tasks.find(t=>t.id===id).currentlyWithType!=='client'};
    closeGenericModal();
    // Validation failure: stays on the form, no handoff, nothing written.
    openTaskModal(id);
    document.getElementById('tm-name').value='';
    const sel2=document.getElementById('tm-cw');sel2.value='client';tmCwChanged(sel2);
    r.invalidStays=!document.getElementById('task-modal').classList.contains('hidden');
    r.invalidNoComposer=!/Send to Client/.test(document.getElementById('generic-modal-title').textContent);
    r.invalidUnsaved=DB.tasks.find(t=>t.id===id).name===name+' (edited)';
    closeGenericModal();closeTaskModal();
    const t=DB.tasks.find(x=>x.id===id);t.name=name;saveDB(DB);
    return r;
  },setup);
  console.log('CW:',JSON.stringify(cw));
  ok(cw.hasClient,'task modal offers Client in Currently With');
  ok(cw.saved,'picking Client saves the name edit typed before it (was discarded)');
  ok(cw.taskModalClosed&&/Send to Client/.test(cw.composer),'then opens the Send to Client composer');
  ok(cw.holderUnchanged,'the holder itself only changes when the request is sent');
  ok(cw.invalidStays&&cw.invalidNoComposer&&cw.invalidUnsaved,'an invalid form (empty name) stays open, no composer, nothing saved');

  // ── 2. Overview buttons follow the approval-ask rule ──
  const ov=await p.evaluate(({id,clientId})=>{
    wsHandoffToClient(id);
    document.getElementById('wsh-kind').value='review';
    document.getElementById('wsh-title').value='Review the draft';
    document.getElementById('wsh-body').value='Please review.';
    wsSendClientAction(id,false);
    const req=DB.actionRequests.find(r=>r.taskId===id&&r.status==='open');
    const real=currentUser;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId};
    launchClientView();cpNavigate('overview');
    const html=()=>document.getElementById('cp-body').innerHTML;
    const r={kind:req&&req.kind,
      reviewNoApprove:!html().includes(`cpApproveTask('${id}')`),
      reviewView:html().includes(`cpOpenTaskModal('${id}')`)&&html().includes('View request')};
    req.kind='approve';cpNavigate('overview');
    r.approveShows=html().includes(`cpApproveTask('${id}')`)&&html().includes(`cpOpenChangesModal('${id}')`);
    // Clean up: close the request and hand the task back, as staff.
    req.status='cancelled';
    currentUser=real;
    document.getElementById('client-portal').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    const t=DB.tasks.find(x=>x.id===id);t.currentlyWithType='staff';t.currentlyWith=t.ownerId;t.currentlyWithUserId=t.ownerId;
    saveDB(DB);
    return r;
  },setup);
  console.log('OVERVIEW:',JSON.stringify(ov));
  ok(ov.kind==='review','a review request was sent');
  ok(ov.reviewNoApprove&&ov.reviewView,'overview: a review ask shows View request, not Approve (the server refuses that approve)');
  ok(ov.approveShows,'overview: an approval ask still shows Approve and Request changes');

  // ── 3. Work-request attachment caps ──
  const at=await p.evaluate(()=>{
    const MB=1048576,f=(n,size)=>({name:n,size});
    _cpReqFiles=[];cpReqFileChanged({files:[f('a',MB),f('b',MB),f('c',MB)]});
    const three=_cpReqFiles.length;closeGenericModal();
    cpReqFileChanged({files:[f('d',10)]});
    const overTotal=_cpReqFiles.length,msg=document.getElementById('generic-modal-title').textContent;closeGenericModal();
    _cpReqFiles=[];cpReqFileChanged({files:Array.from({length:12},(_,i)=>f('s'+i,10))});
    const count=_cpReqFiles.length;closeGenericModal();
    _cpReqFiles=[];cpReqFileChanged({files:[f('big',MB+1)]});
    const big=_cpReqFiles.length;closeGenericModal();_cpReqFiles=[];
    return{three,overTotal,msg,count,big};
  });
  console.log('ATTACH:',JSON.stringify(at));
  ok(at.three===3,'three 1 MB files fit (3 MB total)');
  ok(at.overTotal===3,'a file that would pass 3 MB in total is refused');
  ok(at.count===10,'at most 10 files are kept');
  ok(at.big===0,'a single file over 1 MB is still refused');

  // ── 3b. Task description in the portal pop-up: formatted, sanitised, hideable ──
  const desc=await p.evaluate(({id,clientId})=>{
    const t=DB.tasks.find(x=>x.id===id);const orig={d:t.description,h:t.clientDescriptionHidden};
    window.__xss=0;
    t.description='<!--StartFragment--><div>It would be helpful to have <strong>Usage Items</strong> at job level.</div><ul><li>One</li><li>Two</li></ul>'
      +'<img src="x" onerror="window.__xss=1"><a href=" javascript:window.__xss=2">bad</a><a href="java\tscript:window.__xss=3">bad2</a><a href="https://example.com/doc">doc</a>';
    // The staff toggle lives in the Task Panel, only for tasks on a client's board.
    openTaskPanel(id);
    const cb=[...document.querySelectorAll('input[type=checkbox]')].find(el=>/clientDescriptionHidden/.test(el.getAttribute('onchange')||''));
    const r={toggle:!!cb,toggleLabel:cb&&cb.nextElementSibling.textContent};
    closeTaskPanel();
    const real=currentUser;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId};
    launchClientView();cpOpenTaskModal(id);
    const box=document.querySelector('#cp-task-modal .cp-desc');
    r.rendered=!!box&&!!box.querySelector('strong')&&box.querySelectorAll('li').length===2&&/Usage Items/.test(box.textContent);
    r.noRawTags=!!box&&!/<strong>|StartFragment/.test(box.textContent);
    r.noImg=!!box&&!box.querySelector('img,[onerror]');
    r.links=box?[...box.querySelectorAll('a')].map(a=>a.getAttribute('href')):[];
    cpCloseTaskModal();
    t.clientDescriptionHidden=true;cpOpenTaskModal(id);
    r.hidden=!document.querySelector('#cp-task-modal .cp-desc')&&!/Usage Items/.test(document.getElementById('cp-task-modal').innerText);
    cpCloseTaskModal();
    currentUser=real;
    document.getElementById('client-portal').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    t.description=orig.d;if(orig.h===undefined)delete t.clientDescriptionHidden;else t.clientDescriptionHidden=orig.h;saveDB(DB);
    return r;
  },setup);
  await new Promise(r=>setTimeout(r,500));
  const xss=await p.evaluate(()=>window.__xss);
  console.log('DESC:',JSON.stringify(desc),'xss',xss);
  ok(desc.toggle&&desc.toggleLabel==='Description shown','Task Panel has the "Description shown" switch');
  ok(desc.rendered&&desc.noRawTags,'portal pop-up shows the description as formatted text (bold, list), no raw HTML');
  ok(desc.noImg&&xss===0,'description is sanitised: no image/onerror, nothing executed');
  ok(desc.links.includes('https://example.com/doc')&&!desc.links.some(h=>h&&/script/i.test(h)),'safe links kept, javascript: links (with space/tab tricks) stripped');
  ok(desc.hidden,'ticking Hide description removes it from the pop-up');

  // ── 3c. Decline: pop-up button, reason required, With back to owner, staff card ──
  const dec=await p.evaluate(({id,clientId})=>{
    const t=DB.tasks.find(x=>x.id===id);const orig=JSON.parse(JSON.stringify(t));
    t.status='ready-approval';t.awaitingClient=true;t.currentlyWithType='client';t.currentlyWith='client';t.currentlyWithUserId=null;delete t.clientApproval;
    const real=currentUser;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId};
    launchClientView();cpOpenTaskModal(id);
    const btns=[...document.querySelectorAll('#cp-approval-btns button')].map(b=>b.textContent.trim());
    const r={btns};
    [...document.querySelectorAll('#cp-approval-btns button')].find(b=>/Decline/.test(b.textContent)).click();
    r.formShown=!document.getElementById('cp-decline-form').classList.contains('hidden')&&document.getElementById('cp-approval-btns').classList.contains('hidden');
    cpDeclineTask(id);                                   // empty reason: nothing happens
    r.emptyRefused=t.status==='ready-approval';
    document.getElementById('cp-decline-note').value='Not going ahead this quarter';
    cpDeclineTask(id);
    r.status=t.status;r.approval=t.clientApproval&&t.clientApproval.status;r.note=t.clientApproval&&t.clientApproval.note;
    r.withOwner=t.currentlyWithType==='staff'&&t.currentlyWithUserId===(orig.ownerId||null)&&t.awaitingClient===false;
    r.notified=(DB.notifications||[]).some(n=>n.type==='client_declined'&&n.taskId===id);
    cpOpenTaskModal(id);
    r.declinedState=/You declined this/.test(document.getElementById('cp-task-modal').innerText)&&/Not going ahead/.test(document.getElementById('cp-task-modal').innerText);
    r.noButtonsAfter=!document.getElementById('cp-approval-btns');
    cpCloseTaskModal();
    currentUser=real;
    document.getElementById('client-portal').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    const card=renderNeedsAttention();
    r.staffCard=/Declined by Client/.test(card)&&/Not going ahead/.test(card)&&card.includes(`incomingApprovalAction('${id}','cancelled')`);
    r.statusLabel=getStatusMeta('declined-client').label;
    r.inLists=getAllStatuses().includes('declined-client');
    for(const k in t)delete t[k];Object.assign(t,orig);
    DB.notifications=(DB.notifications||[]).filter(n=>!(n.type==='client_declined'&&n.taskId===id));
    saveDB(DB);
    return r;
  },setup);
  console.log('DECLINE:',JSON.stringify(dec));
  ok(dec.btns.length===3&&/Approve/.test(dec.btns[0])&&/Request Changes/.test(dec.btns[1])&&/Decline/.test(dec.btns[2]),'pop-up offers Approve, Request Changes and Decline');
  ok(dec.formShown&&dec.emptyRefused,'Decline opens a reason form; an empty reason is refused');
  ok(dec.status==='declined-client'&&dec.approval==='declined'&&dec.note==='Not going ahead this quarter','declining records the status and the reason');
  ok(dec.withOwner&&dec.notified,'declining hands the task back to its owner and notifies them');
  ok(dec.declinedState&&dec.noButtonsAfter,'the pop-up then shows "You declined this" with the reason, no buttons');
  ok(dec.staffCard,'staff dashboard shows a Declined by Client card with next actions');
  ok(dec.statusLabel==='Declined by Client'&&dec.inLists,'Declined by Client is a registered status');

  // ── 3d. Work-request attachment hrefs (stored XSS against staff, 2026-09-25 audit) ──
  const wx=await p.evaluate(()=>{
    window.__wxss=0;
    const evil={id:'wr-evil',clientId:'x',title:'Quote',status:'pending',submittedAt:new Date().toISOString(),attachments:[
      {name:'a.pdf',type:'application/pdf',data:'data:,"><img src=x onerror="window.__wxss=1">'},
      {name:'b.pdf',type:'application/pdf',data:'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='},
      {name:'ok.pdf',type:'application/pdf',data:'data:application/pdf;base64,QUJD'}]};
    const host=document.createElement('div');document.body.appendChild(host);
    host.innerHTML=renderWorkRequestCard(evil);
    const hrefs=[...host.querySelectorAll('a[download]')].map(a=>a.getAttribute('href'));
    const injected=!!host.querySelector('img,[onerror]');
    host.remove();
    return{hrefs,injected};
  });
  await new Promise(r=>setTimeout(r,400));
  const wxss=await p.evaluate(()=>window.__wxss);
  console.log('WR-HREF:',JSON.stringify(wx),'xss',wxss);
  ok(!wx.injected&&wxss===0,'staff Clients page: a crafted attachment injects nothing and runs nothing');
  ok(wx.hrefs[0]==='#'&&wx.hrefs[1]==='#'&&wx.hrefs[2]==='data:application/pdf;base64,QUJD','only a clean, non-renderable data URL becomes a link');

  // ── 3e. Attachments: Portal Visibility switch, Shared default, file storage paths ──
  const fa=await p.evaluate(async({id,clientId})=>{
    const r={};
    // downloads here point at fake links, not a file server: stop their clicks navigating the test page
    const _rc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};
    const t=DB.tasks.find(x=>x.id===id);const origFiles=JSON.parse(JSON.stringify(DB.taskFiles||[]));
    // The third switch
    openTaskPanel(id);
    const sws=[...document.querySelectorAll('.tp-switch-txt')].map(e=>e.textContent);
    r.switches=sws;
    const attSw=[...document.querySelectorAll('.tp-switch input')].find(i=>/clientAttachmentsHidden/.test(i.getAttribute('onchange')||''));
    closeTaskPanel();
    // New staff upload (offline → browser store) defaults to Shared
    await new Promise(res=>{wsAddAttachment(id,{files:[new File(['hello'],'notes.txt',{type:'text/plain'})]});setTimeout(res,600);});
    const up=(DB.taskFiles||[]).filter(f=>f.taskId===id&&f.name==='notes.txt').pop();
    r.newShared=!!up&&up.internalOnly===false;
    // Staff upload with file storage on: goes to the bucket, no local bytes
    const realSb=window._supabase,realSync=_supabaseSyncEnabled;const calls=[];
    window._supabase={storage:{from:b=>({upload:async(path,file,o)=>{calls.push(['upload',b,path,o&&o.contentType]);return{error:null};},createSignedUrl:async(path,exp,o)=>{calls.push(['sign',path,o&&o.download||null]);return{data:{signedUrl:'https://example.invalid/signed?download=spec.pdf'}};},remove:async(ps)=>{calls.push(['remove',ps[0]]);return{};}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:null,error:{message:'stub'}})})})})};
    _supabaseSyncEnabled=true;
    await new Promise(res=>{wsAddAttachment(id,{files:[new File(['pdfbytes'],'spec.pdf',{type:'application/pdf'})]});setTimeout(res,600);});
    const st=(DB.taskFiles||[]).filter(f=>f.taskId===id&&f.name==='spec.pdf').pop();
    r.stored=!!st&&st.storagePath===`tasks/${id}/${st.id}`&&!_getFileData(st.id)&&st.internalOnly===false;
    r.uploadCall=calls.find(c=>c[0]==='upload');
    await _downloadTaskFile(st.id);
    r.signCall=calls.find(c=>c[0]==='sign');
    wsDeleteAttachment(st.id);
    r.removeCall=calls.find(c=>c[0]==='remove');
    window._supabase=realSb;_supabaseSyncEnabled=realSync;
    // Portal: switch off hides staff files, keeps the client's own
    DB.taskFiles.push({id:'cf-own',taskId:id,name:'client-own.pdf',type:'application/pdf',size:3,uploadedByClientId:clientId,internalOnly:false});
    const real=currentUser;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId};
    launchClientView();
    const names=()=>{cpOpenTaskModal(id);const n=[...document.querySelectorAll('#cp-task-modal .cp-file-btn')].length;const txt=document.getElementById('cp-task-modal').innerText;cpCloseTaskModal();return{n,notes:/notes\.txt/.test(txt),own:/client-own\.pdf/.test(txt)};};
    r.on=names();
    t.clientAttachmentsHidden=true;r.off=names();delete t.clientAttachmentsHidden;
    // Server mode: View/Download ask /api/portal-file for a signed link
    const realMode=_portalServerMode,realFetch=window.fetch,realOpen=window.open;const asked=[];let opened=null;
    DB.taskFiles.push({id:'cf-srv',taskId:id,name:'srv.png',type:'image/png',stored:true,uploadedByClientId:clientId});
    _portalServerMode=()=>true;
    const PNG=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
    window.fetch=async(u,o)=>{asked.push(String(u));if(String(u).startsWith('/api/'))return new Response(JSON.stringify({url:'https://example.supabase.co/signed/x'}),{status:200,headers:{'Content-Type':'application/json'}});return new Response(new Blob([PNG],{type:'image/png'}),{status:200});};
    window.open=()=>{opened={opener:1,location:{href:''},close(){}};return opened;};
    await cpOpenFile('cf-srv',false);
    r.viewAsked=asked[0];r.viewFetchedSigned=asked[1];r.newWindow=!!opened;
    const ov=document.getElementById('_file-preview-ov');r.popup=!!ov&&!!ov.querySelector('img')&&/srv\.png/.test(ov.innerText);
    if(typeof _closeFilePreview==='function')_closeFilePreview();
    await cpOpenFile('cf-srv',true);
    r.dlAsked=asked[2];
    // Remove button: only on the client's own uploads; server mode posts removeFile
    const realAction=_portalAction;const acts=[];_portalAction=async(tp,pl)=>{acts.push([tp,pl]);return false;};
    cpOpenTaskModal(id);
    r.removeBtns=[...document.querySelectorAll('#cp-task-modal .cp-file-del')].map(b=>b.getAttribute('onclick'));
    cpRemoveFile('cf-srv');document.getElementById('confirm-ok')?.click?.();
    const okBtn=[...document.querySelectorAll('#confirm-modal button')].find(b=>/Remove/.test(b.textContent));if(okBtn)okBtn.click();
    await new Promise(x=>setTimeout(x,50));r.removeAction=acts[0];
    cpCloseTaskModal();_portalAction=realAction;
    _portalServerMode=realMode;window.fetch=realFetch;window.open=realOpen;
    currentUser=real;
    document.getElementById('client-portal').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    DB.taskFiles=origFiles;saveDB(DB);
    HTMLAnchorElement.prototype.click=_rc;
    r.attSwitch=!!attSw;
    return r;
  },setup);
  console.log('FILES:',JSON.stringify(fa));
  ok(fa.attSwitch&&fa.switches.join('|')==='Visible to client|Description shown|Attachments shown','Portal Visibility has a third switch: Attachments shown');
  ok(fa.newShared,'new staff uploads start Shared');
  ok(fa.stored&&fa.uploadCall&&fa.uploadCall[1]==='task-files'&&fa.uploadCall[3]==='application/pdf','with file storage on, a staff upload goes to the task-files bucket (no copy left in the browser)');
  ok(fa.signCall&&fa.signCall[2]==='spec.pdf'&&fa.removeCall,'download signs a link under the file name; delete removes the stored object');
  ok(fa.on.notes&&fa.on.own,'portal: shared staff files and the client\'s own uploads show');
  ok(!fa.off.notes&&fa.off.own,'portal: Attachments hidden removes staff files, keeps the client\'s own');
  ok(/\/api\/portal-file\?id=cf-srv$/.test(fa.viewAsked||'')&&fa.viewFetchedSigned==='https://example.supabase.co/signed/x','portal View asks /api/portal-file, then fetches the file through the signed link');
  ok(fa.popup&&!fa.newWindow,'portal View shows the file in the in-page preview pop-up, not a new window');
  ok(fa.removeBtns.length>=1&&fa.removeBtns.every(o=>/cf-srv|cf-own/.test(o)),'Remove shows only on files the client uploaded (got '+JSON.stringify(fa.removeBtns)+')');
  ok(fa.removeAction&&fa.removeAction[0]==='removeFile'&&fa.removeAction[1].fileId==='cf-srv','Remove asks for confirmation, then sends removeFile to the server');
  ok(/\/api\/portal-file\?id=cf-srv&dl=1$/.test(fa.dlAsked||''),'portal Download asks for a download link');

  // ── 3f. Deleted attachments stay deleted after a merge (they came back on refresh) ──
  const tomb=await p.evaluate((id)=>{
    const orig=JSON.parse(JSON.stringify(DB.taskFiles||[])),origT=JSON.parse(JSON.stringify(DB.deletedTaskFileIds||[]));
    DB.taskFiles.push({id:'del-me',taskId:id,name:'dup.png',type:'link',url:'https://x.example/a',internalOnly:false});
    const server=JSON.parse(JSON.stringify(DB));          // the server copy still has the file
    wsDeleteAttachment('del-me');
    const m1=_mergeDB(JSON.parse(JSON.stringify(DB)),server);   // save: local (deleted) + server (has it)
    const m2=_mergeDB(server,JSON.parse(JSON.stringify(m1)));   // another device merges the result
    const r={afterDelete:!(DB.taskFiles||[]).some(x=>x.id==='del-me'),m1:!(m1.taskFiles||[]).some(x=>x.id==='del-me'),m2:!(m2.taskFiles||[]).some(x=>x.id==='del-me'),kept:(m1.deletedTaskFileIds||[]).includes('del-me')};
    DB.taskFiles=orig;DB.deletedTaskFileIds=origT;saveDB(DB);
    return r;
  },setup.id);
  console.log('TOMBSTONE:',JSON.stringify(tomb));
  ok(tomb.afterDelete&&tomb.m1,'a deleted attachment does not come back when merged with a server copy that still has it');
  ok(tomb.m2&&tomb.kept,'the deletion travels to other devices (tombstone kept through the merge)');

  // ── 3g. 2026-09-26 audit: previews sanitised, patched SheetJS, band/list agree, decline colour ──
  const a2=await p.evaluate(async({id,clientId})=>{
    const r={};window.__mx=0;
    const host=document.createElement('div');document.body.appendChild(host);
    host.innerHTML=_descSanitize('<noscript><p title="</noscript><img src=x onerror=window.__mx=1>"></p></noscript><p>kept</p>');
    r.noscript=!host.querySelector('noscript,img,[onerror]')&&/kept/.test(host.textContent);
    host.innerHTML=_descSanitize('<p><img src="data:image/png;base64,iVBORw0KGgo="><img src="https://x.example/t.png"><img src="data:text/html;base64,PGI+"></p>',{images:true});
    r.imgs=[...host.querySelectorAll('img')].map(i=>i.getAttribute('src').slice(0,15));
    host.innerHTML=_descSanitize('<table><tr><td colspan="2" onclick="window.__mx=2">a</td></tr></table>',{attrs:['colspan','rowspan']});
    const td=host.querySelector('td');r.colspan=td&&td.getAttribute('colspan')==='2'&&!td.hasAttribute('onclick');
    // Spreadsheet preview: patched library, and a javascript: hyperlink comes out inert
    await new Promise(res=>_ensureDocViewer('sheet',res,res));
    r.xlsx=window.XLSX&&window.XLSX.version;
    const ws=XLSX.utils.aoa_to_sheet([['<b>bold?</b>','link']]);ws['B1'].l={Target:'javascript:window.__mx=3'};
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'S');
    host.innerHTML=_sheetToHtml(wb,0);
    r.sheetSafe=!host.querySelector('script,b,[onclick]')&&[...host.querySelectorAll('a')].every(a=>!/script/i.test(a.getAttribute('href')||''));
    host.remove();
    // Overview: band count = Due this week list
    const t0=DB.tasks.filter(t=>getClientTasks(clientId).some(x=>x.id===t.id)).slice(0,3);const saved=t0.map(t=>({t,e:t.endDate,s:t.status,w:t.currentlyWithType,p:t.percentComplete}));
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return toDateStr(x);};
    t0[0].endDate=d(2);t0[0].status='todo';t0[0].percentComplete=0;t0[0].currentlyWithType='staff';
    t0[1].endDate=d(3);t0[1].status='todo';t0[1].percentComplete=0;t0[1].currentlyWithType='client';   // waiting on the client
    t0[2].endDate=d(4);t0[2].status='todo';t0[2].percentComplete=0;t0[2].currentlyWithType='staff';
    const real=currentUser;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId};
    launchClientView();cpNavigate('overview');
    const band=document.querySelectorAll('.cp-band-cell')[3]?.querySelector('.cp-band-num')?.textContent;
    const secs=[...document.querySelectorAll('.cp-sec')].find(s=>/Due this week/.test(s.textContent));
    r.band=band;r.list=secs?secs.querySelectorAll('.cp-task-row').length:0;
    saved.forEach(x=>{x.t.endDate=x.e;x.t.status=x.s;x.t.currentlyWithType=x.w;x.t.percentComplete=x.p;});
    currentUser=real;
    document.getElementById('client-portal').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    // Decline card: reason in red, labelled Reason
    const t=DB.tasks.find(x=>x.id===id);const o={s:t.status,c:t.clientApproval};
    t.status='declined-client';t.clientApproval={status:'declined',note:'Over budget',at:new Date().toISOString(),declinedBy:'C'};
    const card=renderNeedsAttention();
    r.declineRed=/color:#991b1b[^>]*><strong>Reason:<\/strong> "Over budget"/.test(card);
    t.status=o.s;if(o.c)t.clientApproval=o.c;else delete t.clientApproval;
    await new Promise(x=>setTimeout(x,200));r.ran=window.__mx;
    return r;
  },setup);
  console.log('AUDIT2:',JSON.stringify(a2));
  ok(a2.noscript,'sanitiser drops <noscript> (no markup-reparsing trick)');
  ok(a2.imgs.length===1&&a2.imgs[0].startsWith('data:image/png'),'Word previews keep embedded images only ('+a2.imgs+')');
  ok(a2.colspan,'spreadsheet previews keep colspan, drop handlers');
  ok(a2.xlsx==='0.20.3','spreadsheet preview uses the patched SheetJS (got '+a2.xlsx+')');
  ok(a2.sheetSafe,'a spreadsheet cell with markup or a javascript: link renders inert');
  ok(a2.ran===0,'nothing injected ran');
  ok(a2.band===String(a2.list)&&a2.list===2,'overview band "Due in the next 7 days" matches the Due this week list (band '+a2.band+', list '+a2.list+')');
  ok(a2.declineRed,'staff decline card shows the reason in red, labelled Reason');

  // ── 3h. Internal toggle survives a merge; downloads stay on the page ──
  const a3=await p.evaluate(({id})=>{
    const orig=JSON.parse(JSON.stringify(DB.taskFiles||[]));
    DB.taskFiles.push({id:'tg-1',taskId:id,name:'cost.xlsx',type:'application/vnd.ms-excel',size:10,internalOnly:false});
    const stale=JSON.parse(JSON.stringify(DB));            // a peer still holds it as Shared
    wsToggleAttachmentShare('tg-1');
    const mine=DB.taskFiles.find(x=>x.id==='tg-1');
    const m1=_mergeDB(stale,JSON.parse(JSON.stringify(DB)));   // the peer merges our save into theirs
    const r={stamped:!!mine.updatedAt,internalAfterMerge:m1.taskFiles.find(x=>x.id==='tg-1').internalOnly===true};
    // download anchor: a name, no new tab
    const realClick=HTMLAnchorElement.prototype.click;let seen=null;
    HTMLAnchorElement.prototype.click=function(){seen={target:this.target,download:this.getAttribute('download')};};
    _clickDownload('https://example.supabase.co/signed/x?download=a.pdf','a.pdf');
    HTMLAnchorElement.prototype.click=realClick;
    r.dl=seen;
    DB.taskFiles=orig;saveDB(DB);
    return r;
  },setup);
  console.log('AUDIT3:',JSON.stringify(a3));
  ok(a3.stamped&&a3.internalAfterMerge,'marking a file Internal survives a merge with a stale Shared copy');
  ok(a3.dl&&a3.dl.target!=='_blank'&&a3.dl.download==='a.pdf','a download with a name stays on the page (no new tab for popup blockers to stop)');

  // ── 3i. Client upload shows progress at once; remove is one click, no dialog ──
  const ux=await p.evaluate(async({id,clientId})=>{
    const r={};const t=DB.tasks.find(x=>x.id===id);const o={w:t.currentlyWithType,s:t.status};
    t.currentlyWithType='client';t.currentlyWith='client';
    const origFiles=JSON.parse(JSON.stringify(DB.taskFiles||[]));
    DB.taskFiles.push({id:'cf-mine',taskId:id,name:'mine.pdf',type:'application/pdf',size:3,stored:true,uploadedByClientId:clientId,internalOnly:false});
    const real=currentUser;currentUser={id:'probe-ux',name:'Probe',role:'client',type:'client',clientId};launchClientView();
    const realMode=_portalServerMode,realAction=_portalAction;const calls=[];let release;
    _portalServerMode=()=>true;
    _portalAction=(tp,pl)=>{calls.push(tp);return new Promise(res=>{release=()=>res(false);});};
    cpOpenTaskModal(id);
    // remove: immediate, no confirm dialog
    const btn=document.querySelector('#cp-task-modal .cp-file-del');
    btn.click();
    r.noDialog=document.getElementById('confirm-modal').classList.contains('hidden');
    r.chipGone=btn.closest('.cp-file-chip').classList.contains('removing');
    r.removeCalled=calls[0]==='removeFile';
    release&&release();await new Promise(x=>setTimeout(x,30));
    // upload: pending chip shows before the server answers
    cpOpenTaskModal(id);
    const input=document.querySelector('#cp-task-modal .cp-m-file');
    cpUploadToTask(id,{files:[new File(['hello'],'quick.txt',{type:'text/plain'})],value:'',set disabled(v){this._d=v},get disabled(){return this._d}});
    await new Promise(x=>setTimeout(x,20));
    const pend=document.querySelector('#cp-m-attach .cp-file-chip.uploading');
    r.pending=!!pend&&/quick\.txt/.test(pend.textContent)&&/Uploading/.test(pend.textContent);
    r.busy=!!document.querySelector('#cp-m-attach .cp-m-upload.busy');
    await new Promise(x=>setTimeout(x,60));r.uploadCalled=calls.includes('uploadFile');
    release&&release();await new Promise(x=>setTimeout(x,30));
    _portalServerMode=realMode;_portalAction=realAction;cpCloseTaskModal();
    currentUser=real;document.getElementById('client-portal').classList.add('hidden');document.getElementById('app-shell').classList.remove('hidden');
    t.currentlyWithType=o.w;t.status=o.s;DB.taskFiles=origFiles;saveDB(DB);
    return r;
  },setup);
  console.log('UX:',JSON.stringify(ux));
  ok(ux.noDialog&&ux.chipGone&&ux.removeCalled,'client remove: one click, no dialog, the file disappears at once and the server is asked');
  ok(ux.pending&&ux.busy&&ux.uploadCalled,'client upload: the file shows "Uploading…" straight away and the button is blocked until it finishes');

  // ── 4. Client logout with a slice reloads ──
  const nav=p.waitForNavigation({timeout:5000}).then(()=>true).catch(()=>false);
  const shownAtOnce=await p.evaluate(()=>{
    // Mimic the real client: signOut fires SIGNED_OUT to the supabase-client.js listener, which
    // calls doLogout() while the login screen is hidden. A fake without that listener missed a
    // loop that hung sign-out in production.
    window.__logoutCalls=0;const real=doLogout;doLogout=function(){window.__logoutCalls++;return real.apply(this,arguments);};
    const onSignedOut=()=>{if(window._portalLoggingOut)return;if(document.getElementById('login-screen').classList.contains('hidden'))doLogout();};
    window._supabase={auth:{signOut:()=>new Promise(r=>setTimeout(()=>{onSignedOut();r({error:null});},50))}};
    DB._portalSlice=true;window.__beforeReload=1;
    currentUser={id:'probe-audit',name:'Probe Client',role:'client',type:'client',clientId:'x'};
    document.getElementById('login-screen').classList.add('hidden');
    doLogout();
    return !document.getElementById('login-screen').classList.contains('hidden');
  });
  const reloaded=await nav;
  const fresh=reloaded&&await p.evaluate(()=>typeof window.__beforeReload==='undefined');
  ok(shownAtOnce,'client sign-out shows the login screen immediately');
  ok(reloaded&&fresh,'logging out of a client slice session reloads the page (no slice left to merge into staff data)');

  report();await b.close();process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);process.exit(1);});
