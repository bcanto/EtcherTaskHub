// _mergeDB used to start from {...incoming} and merge only nine named collections by id.
// Every other collection — clientNotes, timeEntries, dependencies, quotes, 26 more — was
// taken wholesale from the remote snapshot, so local work the server had not seen yet was
// silently replaced. That is why a client note typed on the live site disappeared while the
// same steps worked locally: locally Supabase is unconfigured, so no merge ever runs.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,130)));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  const R=await p.evaluate(async()=>{
    navigate('notes');await new Promise(x=>setTimeout(x,700));
    const o={};
    const snapshot=()=>JSON.parse(JSON.stringify(DB));

    // ── a local edit the server has not seen survives a merge ──
    const remote=snapshot();
    const sec=(DB.clientNotes||[]).flatMap(n=>n.sections||[])[0];
    o.hasSection=!!sec;
    if(sec){
      if(!Array.isArray(sec.boxes))sec.boxes=[];
      sec.boxes.push({id:'nbMERGE',x:20,y:200,w:430,html:'MERGE probe note'});
    }
    (DB.timeEntries=DB.timeEntries||[]).push({id:'teMERGE',taskId:null,staffId:currentUser.id,hours:1,date:'2026-09-10',note:'MERGE probe entry'});
    (DB.dependencies=DB.dependencies||[]).push({id:'depMERGE',dependentTaskId:'x',predecessorTaskId:'y'});
    (DB.quotes=DB.quotes||[]).push({id:'qMERGE',title:'MERGE probe quote'});
    (DB.checklistItems=DB.checklistItems||[]).push({id:'ckMERGE',taskId:'x',text:'MERGE probe item'});

    const m=_mergeDB(DB,remote);
    o.notes=JSON.stringify(m.clientNotes||[]).includes('MERGE probe note');
    o.time=(m.timeEntries||[]).some(x=>x.id==='teMERGE');
    o.deps=(m.dependencies||[]).some(x=>x.id==='depMERGE');
    o.quotes=(m.quotes||[]).some(x=>x.id==='qMERGE');
    o.checks=(m.checklistItems||[]).some(x=>x.id==='ckMERGE');

    // ── a remote addition still arrives ──
    const remote2=snapshot();
    (remote2.timeEntries=remote2.timeEntries||[]).push({id:'teREMOTE',taskId:null,staffId:'other',hours:2,date:'2026-09-10',note:'from another session'});
    (remote2.quotes=remote2.quotes||[]).push({id:'qREMOTE',title:'remote quote'});
    const m2=_mergeDB(DB,remote2);
    o.remoteTime=(m2.timeEntries||[]).some(x=>x.id==='teREMOTE');
    o.remoteQuote=(m2.quotes||[]).some(x=>x.id==='qREMOTE');
    o.localKept=(m2.timeEntries||[]).some(x=>x.id==='teMERGE');

    // ── a newer remote version of the same record wins on updatedAt ──
    const t=DB.tasks.find(x=>!x.parentTaskId);
    const remote3=snapshot();
    const rt=remote3.tasks.find(x=>x.id===t.id);
    rt.name='NEWER FROM SERVER';rt.updatedAt='2099-01-01T00:00:00.000Z';
    t.updatedAt='2020-01-01T00:00:00.000Z';
    const m3=_mergeDB(DB,remote3);
    o.newerWins=(m3.tasks.find(x=>x.id===t.id)||{}).name==='NEWER FROM SERVER';

    // ── tombstoned clients stay deleted ──
    const remote4=snapshot();
    const victim=(remote4.clients||[])[0];
    o.hasClient=!!victim;
    if(victim){
      DB.deletedClientIds=[...(DB.deletedClientIds||[]),victim.id];
      const m4=_mergeDB(DB,remote4);
      o.tombstone=!(m4.clients||[]).some(c=>c.id===victim.id);
      o.tombstoneKept=(m4.deletedClientIds||[]).includes(victim.id);
      DB.deletedClientIds=(DB.deletedClientIds||[]).filter(x=>x!==victim.id);
    }

    // ── arrays of plain strings must not be mangled ──
    const remote5=snapshot();
    remote5.deletedWorkRequestIds=['a','b'];
    DB.deletedWorkRequestIds=['b','c'];
    const m5=_mergeDB(DB,remote5);
    o.stringArray=Array.isArray(m5.deletedWorkRequestIds)
      &&['a','b','c'].every(x=>m5.deletedWorkRequestIds.includes(x));

    // ── object settings still come through ──
    const remote6=snapshot();
    remote6.labelConfig={statuses:{todo:{color:'#123456'}}};
    const m6=_mergeDB(DB,remote6);
    o.objectKept=!!(m6.labelConfig&&m6.labelConfig.statuses&&m6.labelConfig.statuses.todo);

    // ── a notification already marked read locally must not come back unread on merge ──
    // (unionById had no timestamp to compare — since nothing bumps updatedAt when read flips —
    // so it just let whichever side was passed as `inc` win outright, silently reverting a
    // read-and-dismissed notification back to unread the moment a stale snapshot merged in.)
    const remote7=snapshot();
    const notif=(DB.notifications||[]).find(n=>n.recipientId===currentUser.id);
    o.hasNotif=!!notif;
    if(notif){
      const staleRemoteCopy=(remote7.notifications||[]).find(n=>n.id===notif.id);
      if(staleRemoteCopy)staleRemoteCopy.read=false; // a snapshot taken before the read-flip below
      const wasRead=notif.read;
      notif.read=true; // the local read-flip notifMarkRead performs
      const m7=_mergeDB(DB,remote7);
      o.readSurvivesMerge=(m7.notifications.find(n=>n.id===notif.id)||{}).read===true;
      notif.read=wasRead; // restore fixture state for any later test in this file
    }

    // ── a deleted sidebar folder must not come back from a stale peer's merge ──
    // (wbFolders had no tombstone at all — it went through the generic by-id loop, a plain
    // union, so a folder deleted locally reappeared the moment a snapshot that still had it
    // merged in. This is what "I delete this folder and it comes back" looked like in practice.)
    (DB.wbFolders=DB.wbFolders||[]).push({id:'wbfMERGE',name:'MERGE probe folder',collapsed:false,order:999});
    const preDeleteSnapshot=snapshot(); // a peer that saw the folder BEFORE this delete
    DB.wbFolders=DB.wbFolders.filter(f=>f.id!=='wbfMERGE');
    (DB.deletedWbFolderIds=DB.deletedWbFolderIds||[]).push('wbfMERGE');
    const m8=_mergeDB(DB,preDeleteSnapshot);
    o.folderStaysDeleted=!(m8.wbFolders||[]).some(f=>f.id==='wbfMERGE');
    o.folderTombstoneKept=(m8.deletedWbFolderIds||[]).includes('wbfMERGE');
    DB.deletedWbFolderIds=(DB.deletedWbFolderIds||[]).filter(x=>x!=='wbfMERGE');

    // ── nothing in the merge throws on an empty or partial snapshot ──
    try{ _mergeDB(DB,{}); _mergeDB({},DB); o.robust=true; }catch(e){ o.robust=false; o.robustErr=e.message; }

    // clean up
    if(sec)sec.boxes=sec.boxes.filter(x=>x.id!=='nbMERGE');
    DB.timeEntries=(DB.timeEntries||[]).filter(x=>!/MERGE$/.test(x.id));
    DB.dependencies=(DB.dependencies||[]).filter(x=>x.id!=='depMERGE');
    DB.quotes=(DB.quotes||[]).filter(x=>x.id!=='qMERGE');
    DB.checklistItems=(DB.checklistItems||[]).filter(x=>x.id!=='ckMERGE');
    saveDB(DB);
    return o;
  });

  ok(R.hasSection,'the dataset has a note section to write into');
  ok(R.notes,'a client note the server has not seen survives a merge');
  ok(R.time,'a timesheet entry survives a merge');
  ok(R.deps,'a dependency survives a merge');
  ok(R.quotes,'a quote survives a merge');
  ok(R.checks,'a checklist item survives a merge');
  ok(R.remoteTime,'a timesheet entry added by another session still arrives');
  ok(R.remoteQuote,'a quote added by another session still arrives');
  ok(R.localKept,'the local entry is kept alongside the remote one');
  ok(R.newerWins,'a newer remote version of a task still wins on updatedAt');
  ok(R.hasClient&&R.tombstone,'a tombstoned client stays deleted after a merge');
  ok(R.tombstoneKept,'the tombstone itself is carried forward');
  ok(R.stringArray,'arrays of plain ids are unioned, not mangled');
  ok(R.objectKept,'object settings still come through the merge');
  ok(R.hasNotif,'the dataset has a notification for the logged-in user to test against');
  ok(R.readSurvivesMerge,'a notification already marked read locally does not come back unread after merging in a stale, still-unread snapshot');
  ok(R.robust,'the merge survives an empty or partial snapshot'+(R.robustErr?': '+R.robustErr:''));
  ok(R.folderStaysDeleted,'a deleted sidebar folder does not come back after merging in a stale peer that still had it');
  ok(R.folderTombstoneKept,'the wbFolder deletion tombstone itself is carried forward');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
