const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,150));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // Throwaway board so we never touch real data.
  await p.evaluate(()=>{
    const id='wb-commstest';
    DB.boards.push({id,name:'CommsTest Board',color:'#97bcbd',clientId:DB.clients[0].id,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    DB.workboards=DB.boards;
    saveDB(DB);
    openWorkboard(id);
  });
  await new Promise(r=>setTimeout(r,600));

  // ── 1. Merge-level regression: the exact race that resurrected deleted comms/notes.
  const mergeResult=await p.evaluate(()=>{
    const currentComms={internalComms:[{id:'ic-keep',body:'keep'}],deletedInternalCommsIds:['ic-gone']};
    const incomingComms={internalComms:[{id:'ic-keep',body:'keep'},{id:'ic-gone',body:'stale, should stay dead'}],deletedInternalCommsIds:[]};
    const mergedComms=_mergeDB(currentComms,incomingComms);
    const currentNotes={meetingNotes:[{id:'mn-keep',title:'keep'}],deletedMeetingNoteIds:['mn-gone']};
    const incomingNotes={meetingNotes:[{id:'mn-keep',title:'keep'},{id:'mn-gone',title:'stale, should stay dead'}],deletedMeetingNoteIds:[]};
    const mergedNotes=_mergeDB(currentNotes,incomingNotes);
    return{
      commsIds:mergedComms.internalComms.map(x=>x.id).sort(),
      commsTombstones:mergedComms.deletedInternalCommsIds,
      notesIds:mergedNotes.meetingNotes.map(x=>x.id).sort(),
      notesTombstones:mergedNotes.deletedMeetingNoteIds,
    };
  });
  console.log('MERGE:',JSON.stringify(mergeResult));
  ok(!mergeResult.commsIds.includes('ic-gone'),'_mergeDB does not resurrect a tombstoned comms message from a stale incoming copy');
  ok(mergeResult.commsIds.includes('ic-keep'),'_mergeDB keeps a comms message both sides agree on');
  ok(mergeResult.commsTombstones.includes('ic-gone'),'_mergeDB carries the deletedInternalCommsIds tombstone forward');
  ok(!mergeResult.notesIds.includes('mn-gone'),'_mergeDB does not resurrect a tombstoned meeting note from a stale incoming copy');
  ok(mergeResult.notesIds.includes('mn-keep'),'_mergeDB keeps a meeting note both sides agree on');
  ok(mergeResult.notesTombstones.includes('mn-gone'),'_mergeDB carries the deletedMeetingNoteIds tombstone forward');

  // ── 2. wsDeleteComms records a tombstone.
  const commsDeleteResult=await p.evaluate(()=>{
    DB.internalComms=DB.internalComms||[];
    DB.internalComms.push({id:'ic-dismiss-test',authorId:currentUser.id,body:'x',attachments:[],timestamp:new Date().toISOString()});
    wsDeleteComms('ic-dismiss-test');
    return{
      gone:!DB.internalComms.some(m=>m.id==='ic-dismiss-test'),
      tombstoned:(DB.deletedInternalCommsIds||[]).includes('ic-dismiss-test'),
    };
  });
  console.log('COMMS DELETE:',JSON.stringify(commsDeleteResult));
  ok(commsDeleteResult.gone,'wsDeleteComms removes the message');
  ok(commsDeleteResult.tombstoned,'wsDeleteComms records it in deletedInternalCommsIds');

  // ── 3. wsMeetingNoteDelete (the board Comms & Notes panel's own delete button) via its
  // real confirm-dialog path, not a direct function call — this is the exact feature the
  // bug was reported against.
  await p.evaluate(()=>{
    DB.meetingNotes=DB.meetingNotes||[];
    DB.meetingNotes.push({id:'mn-panel-test',title:'Panel test note',body:'x',authorId:currentUser.id,
      boardId:'wb-commstest',kind:'note',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    wsMeetingNoteDelete('mn-panel-test');
  });
  await new Promise(r=>setTimeout(r,300));
  const confirmOpen=await p.evaluate(()=>!document.getElementById('confirm-modal').classList.contains('hidden'));
  ok(confirmOpen,'wsMeetingNoteDelete opens a real confirmation dialog');
  await p.evaluate(()=>document.getElementById('confirm-ok-btn').click());
  await new Promise(r=>setTimeout(r,300));
  const panelNoteResult=await p.evaluate(()=>({
    gone:!DB.meetingNotes.some(n=>n.id==='mn-panel-test'),
    tombstoned:(DB.deletedMeetingNoteIds||[]).includes('mn-panel-test'),
  }));
  console.log('PANEL NOTE DELETE:',JSON.stringify(panelNoteResult));
  ok(panelNoteResult.gone,'confirming the dialog removes the meeting note');
  ok(panelNoteResult.tombstoned,'wsMeetingNoteDelete records it in deletedMeetingNoteIds');

  // ── 4. The task-panel notes tab's own delete (tpNoteDelete) and the full-meeting delete
  // (mtgDeleteConfirm) are separate call sites into the same collection — each must tombstone
  // independently, since each is a real place a note can be deleted from.
  await p.evaluate(()=>{
    DB.meetingNotes.push({id:'mn-tp-test',title:'TP test note',body:'x',authorId:currentUser.id,
      taskId:'nonexistent-task',kind:'note',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    tpNoteDelete('mn-tp-test');
  });
  await new Promise(r=>setTimeout(r,300));
  await p.evaluate(()=>document.getElementById('confirm-ok-btn').click());
  await new Promise(r=>setTimeout(r,300));
  const tpNoteResult=await p.evaluate(()=>({
    gone:!DB.meetingNotes.some(n=>n.id==='mn-tp-test'),
    tombstoned:(DB.deletedMeetingNoteIds||[]).includes('mn-tp-test'),
  }));
  console.log('TP NOTE DELETE:',JSON.stringify(tpNoteResult));
  ok(tpNoteResult.gone,'tpNoteDelete removes the note');
  ok(tpNoteResult.tombstoned,'tpNoteDelete records it in deletedMeetingNoteIds');

  const mtgResult=await p.evaluate(()=>{
    DB.meetingNotes.push({id:'mn-mtg-test',title:'Full meeting test',body:'x',authorId:currentUser.id,
      boardId:'wb-commstest',kind:'meeting',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    mtgDeleteConfirm('mn-mtg-test');
    return{
      gone:!DB.meetingNotes.some(n=>n.id==='mn-mtg-test'),
      tombstoned:(DB.deletedMeetingNoteIds||[]).includes('mn-mtg-test'),
    };
  });
  console.log('MTG DELETE:',JSON.stringify(mtgResult));
  ok(mtgResult.gone,'mtgDeleteConfirm removes the meeting');
  ok(mtgResult.tombstoned,'mtgDeleteConfirm records it in deletedMeetingNoteIds');

  // Cleanup: leave no trace in real data.
  await p.evaluate(()=>{
    closeConfirm();
    DB.boards=DB.boards.filter(w=>w.id!=='wb-commstest');DB.workboards=DB.boards;
    DB.internalComms=(DB.internalComms||[]).filter(m=>!['ic-keep','ic-gone'].includes(m.id));
    DB.meetingNotes=(DB.meetingNotes||[]).filter(n=>!['mn-keep','mn-gone'].includes(n.id));
    currentWorkboard=null;
    saveDB(DB);
    navigate('dashboard');
  });

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
