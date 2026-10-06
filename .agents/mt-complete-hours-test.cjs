// Main Table: marking a task Completed (incl. a brand-new item added purely for traceability,
// with no time ever logged against it) offers a one-line "log hours" field right in the status
// dropdown, straight to the task's owner — see wsStatusPick/_wsShowHoursPrompt/
// wsLogHoursFromStatusDD in index.html. Calls those functions directly rather than clicking
// through wsCellOpen's positioned popover: none of the three depend on the popover's on-screen
// position, only on #ws-cell-dd-body's (always-present, just hidden) static markup.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
// `style.display!=='none'` is not the same claim as "a real person can see and click this" — a
// field can pass that check while still being clipped to zero width by a fixed-width parent cell
// (a genuine bug found live: the subitem row's hours field had display:'' the whole time, but the
// column was 104px wide and the field never actually rendered visibly). This hit-tests the
// element's real center point against elementFromPoint, the same thing a mouse click would hit.
async function isGenuinelyVisible(page,elId){
  return page.evaluate((id)=>{
    const el=document.getElementById(id);
    if(!el)return false;
    if(getComputedStyle(el).display==='none')return false;
    const r=el.getBoundingClientRect();
    if(r.width<10||r.height<8)return false;
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return hit===el;
  },elId);
}
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  const R=await p.evaluate(async()=>{
    const o={};
    const owner=DB.staff[0];
    const group=DB.groups[0];
    o.hasOwner=!!owner;o.hasGroup=!!group;
    // A real click always runs wsCellOpen first (builds #ws-dd-hours-prompt's empty container
    // via wsBuildDropdownHtml before any status item can be clicked) — a fake event is enough,
    // since wsCellOpen only reads currentTarget for the popover's on-screen position.
    const fakeEvt=()=>({stopPropagation(){},currentTarget:{getBoundingClientRect:()=>({left:0,right:0,top:0,bottom:0})}});

    // ── a task with an owner, picked straight to Completed ──
    const t1={id:'tCOMPLETEHOURS1',groupId:group.id,workboardId:group.workboardId||group.boardId,
      name:'MERGE-PROBE completed-with-owner',status:'todo',ownerId:owner.id,percentComplete:0,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    DB.tasks.push(t1);

    wsCellOpen(t1.id,'status',fakeEvt());
    wsStatusPick(t1.id,'done');
    o.statusSetToDone=DB.tasks.find(t=>t.id===t1.id)?.status==='done';
    const box=document.getElementById('ws-dd-hours-prompt');
    o.promptShown=!!box&&box.innerHTML.includes('ws-dd-hours');
    o.promptNamesOwner=!!box&&box.innerHTML.includes(owner.name);
    o.ddStillOpen=document.getElementById('ws-cell-dd').style.display!=='none';

    const hoursInput=document.getElementById('ws-dd-hours');
    if(hoursInput)hoursInput.value='2.5';
    wsLogHoursFromStatusDD(t1.id);
    const entry=(DB.timeEntries||[]).find(e=>e.taskId===t1.id);
    o.entryCreated=!!entry;
    o.entryStaffIsOwner=entry&&entry.staffId===owner.id;
    o.entryHours=entry&&entry.hours;
    o.entryHasNote=entry&&entry.note===t1.name;
    o.entryBillable=entry&&entry.billable===true;
    o.ddClosedAfterLog=document.getElementById('ws-cell-dd').style.display==='none';

    // ── picking a NON-done status must behave exactly as before: no prompt, dropdown closes ──
    const t2={id:'tCOMPLETEHOURS2',groupId:group.id,workboardId:group.workboardId||group.boardId,
      name:'MERGE-PROBE not-done',status:'todo',ownerId:owner.id,percentComplete:0,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    DB.tasks.push(t2);
    wsCellOpen(t2.id,'status',fakeEvt());
    wsStatusPick(t2.id,'in-progress');
    o.nonDoneStatusSet=DB.tasks.find(t=>t.id===t2.id)?.status==='in-progress';
    o.nonDoneClosesDropdown=document.getElementById('ws-cell-dd').style.display==='none';

    // ── an ownerless task shows a hint instead of an input, and never creates an entry ──
    const t3={id:'tCOMPLETEHOURS3',groupId:group.id,workboardId:group.workboardId||group.boardId,
      name:'MERGE-PROBE completed-no-owner',status:'todo',ownerId:'',percentComplete:0,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    DB.tasks.push(t3);
    wsCellOpen(t3.id,'status',fakeEvt());
    wsStatusPick(t3.id,'done');
    const box3=document.getElementById('ws-dd-hours-prompt');
    o.noOwnerHint=!!box3&&/set an owner/i.test(box3.innerHTML)&&!box3.innerHTML.includes('id="ws-dd-hours"');
    o.noOwnerNoEntry=!(DB.timeEntries||[]).some(e=>e.taskId===t3.id);

    // clean up
    DB.tasks=DB.tasks.filter(t=>!/^tCOMPLETEHOURS/.test(t.id));
    DB.timeEntries=(DB.timeEntries||[]).filter(e=>!/^tCOMPLETEHOURS/.test(e.taskId||''));
    wsCellClose();
    saveDB(DB);
    return o;
  });

  ok(R.hasOwner&&R.hasGroup,'the dataset has a staff member and a group to build the fixture from');
  ok(R.statusSetToDone,'wsStatusPick actually sets the task to done, same as the plain status click always did');
  ok(R.promptShown,"picking Completed shows the hours field right after the status list");
  ok(R.promptNamesOwner,'the prompt names the task\'s actual owner');
  ok(R.ddStillOpen,'the dropdown stays open after picking Completed, so the hours field can be filled in');
  ok(R.entryCreated,'submitting hours creates a real timesheet entry');
  ok(R.entryStaffIsOwner,"the logged entry is attributed to the task's owner, not the person logging it");
  ok(R.entryHours===2.5,`the entered hours value is what gets logged (got ${R.entryHours})`);
  ok(R.entryHasNote,"the entry's note defaults to the task's own name");
  ok(R.entryBillable,'the quick-logged entry defaults billable, matching the rest of the app');
  ok(R.ddClosedAfterLog,'logging hours closes the dropdown');
  ok(R.nonDoneStatusSet,'picking an ordinary (non-done) status still sets it correctly');
  ok(R.nonDoneClosesDropdown,'picking a non-done status still closes the dropdown immediately, exactly as before this feature existed');
  ok(R.noOwnerHint,'an ownerless task shows a "set an owner" hint instead of an hours field');
  ok(R.noOwnerNoEntry,'no time entry is ever created for a task with no owner to log against');

  // ── the actual reported bug: the "+ Add item" inline row (wsStartInlineAdd/wsSaveInlineTask),
  // driven through REAL selects/typing so the status select's onchange wiring is genuinely
  // exercised — not just the underlying functions called directly, like the block above. ───────
  await p.evaluate(()=>{openWorkboard(DB.workboards[0].id);renderView('workspace');});
  await new Promise(r=>setTimeout(r,500));
  const opened=await p.evaluate(()=>{const row=document.querySelector('.ws-add-row');if(!row)return false;row.click();return true;});
  await new Promise(r=>setTimeout(r,300));
  const rowReady=opened&&await p.evaluate(()=>!!document.getElementById('ws-inline-name'));
  ok(opened&&rowReady,'the "+ Add item" inline row actually opens on a real board (the surface the bug report screenshotted)');

  let inline={};
  if(rowReady){
    inline.hiddenBeforePick=await p.evaluate(()=>document.getElementById('ws-inline-hours').style.display==='none');
    await p.type('#ws-inline-name','TABBUG-inline-complete '+Date.now());
    await p.select('#ws-inline-status','done');
    await new Promise(r=>setTimeout(r,100));
    inline.shownAfterDone=await p.evaluate(()=>document.getElementById('ws-inline-hours').style.display!=='none');
    inline.genuinelyVisible=await isGenuinelyVisible(p,'ws-inline-hours');
    await p.type('#ws-inline-hours','1.75');
    const ownerId=await p.evaluate(()=>document.getElementById('ws-inline-owner').value);
    await p.evaluate(()=>wsSaveInlineTask());
    await new Promise(r=>setTimeout(r,300));
    Object.assign(inline,await p.evaluate((ownerId)=>{
      const t=DB.tasks.slice().reverse().find(t=>(t.name||'').startsWith('TABBUG-inline-complete'));
      const e=t&&(DB.timeEntries||[]).find(e=>e.taskId===t.id);
      const out={taskFound:!!t,taskStatus:t&&t.status,entryCreated:!!e,entryHours:e&&e.hours,entryOwnerMatches:!!e&&e.staffId===ownerId};
      if(t){DB.tasks=DB.tasks.filter(x=>x.id!==t.id);DB.timeEntries=(DB.timeEntries||[]).filter(x=>x.taskId!==t.id);saveDB(DB);}
      return out;
    },ownerId));
  }
  ok(inline.hiddenBeforePick,'the inline-add row\'s hours field starts hidden (default status is not-done)');
  ok(inline.shownAfterDone,'selecting Completed in the REAL <select> reveals the hours field via its onchange handler');
  ok(inline.genuinelyVisible,'the revealed hours field is actually clickable at its own center point, not clipped by a fixed-width cell');
  ok(inline.taskFound&&inline.taskStatus==='done','the new item is actually created with status done');
  ok(inline.entryCreated,'saving with hours filled in creates a real timesheet entry for the new item');
  ok(inline.entryHours===1.75,`the typed hours value is what gets logged (got ${inline.entryHours})`);
  ok(inline.entryOwnerMatches,'the entry is attributed to whichever owner the inline row had selected');

  // negative case: default (non-done) status never shows the field and never logs anything,
  // even though the field exists in the DOM and could in principle hold a stale value.
  await p.evaluate(()=>{document.querySelector('.ws-add-row')?.click();});
  await new Promise(r=>setTimeout(r,300));
  await p.type('#ws-inline-name','TABBUG-inline-notdone '+Date.now());
  const stillHidden=await p.evaluate(()=>document.getElementById('ws-inline-hours').style.display==='none');
  await p.evaluate(()=>wsSaveInlineTask());
  await new Promise(r=>setTimeout(r,300));
  const negResult=await p.evaluate(()=>{
    const t=DB.tasks.slice().reverse().find(t=>(t.name||'').startsWith('TABBUG-inline-notdone'));
    const hasEntry=t&&(DB.timeEntries||[]).some(e=>e.taskId===t.id);
    if(t){DB.tasks=DB.tasks.filter(x=>x.id!==t.id);saveDB(DB);}
    return{found:!!t,hasEntry:!!hasEntry};
  });
  ok(stillHidden,'the hours field stays hidden when the status is left at its non-done default');
  ok(negResult.found&&!negResult.hasEntry,'no time entry is created for an item that was not marked done');

  // ── same behaviour on the subitem inline-add row (wsStartInlineSubitem/wsSaveInlineSubitem) ──
  const subSetup=await p.evaluate(()=>{
    const parent=DB.tasks.find(t=>!t.parentTaskId&&!t.archived);
    if(!parent)return{ok:false};
    wsStartInlineSubitem(parent.id);
    return{ok:true,parentId:parent.id};
  });
  await new Promise(r=>setTimeout(r,300));
  const subRowReady=subSetup.ok&&await p.evaluate(()=>!!document.getElementById('ws-inline-subtask-input'));
  ok(subRowReady,'the subitem inline-add row opens under a real parent task');

  let sub={};
  if(subRowReady){
    sub.hiddenBeforePick=await p.evaluate(()=>document.getElementById('ws-inline-subtask-hours')?.style.display==='none');
    await p.type('#ws-inline-subtask-input','TABBUG-sub-complete '+Date.now());
    const hasOwnerSelect=await p.evaluate(()=>!!document.getElementById('ws-inline-subtask-owner'));
    let ownerId='';
    if(hasOwnerSelect){
      ownerId=await p.evaluate(()=>DB.staff[0]?.id||'');
      if(ownerId)await p.select('#ws-inline-subtask-owner',ownerId);
    }
    await p.select('#ws-inline-subtask-status','done');
    await new Promise(r=>setTimeout(r,100));
    sub.shownAfterDone=await p.evaluate(()=>document.getElementById('ws-inline-subtask-hours')?.style.display!=='none');
    sub.genuinelyVisible=await isGenuinelyVisible(p,'ws-inline-subtask-hours');
    await p.type('#ws-inline-subtask-hours','0.5');
    await p.evaluate(()=>wsSaveInlineSubitem());
    await new Promise(r=>setTimeout(r,300));
    Object.assign(sub,await p.evaluate((parentId,ownerId)=>{
      const t=DB.tasks.slice().reverse().find(t=>t.parentTaskId===parentId&&(t.name||'').startsWith('TABBUG-sub-complete'));
      const e=t&&(DB.timeEntries||[]).find(e=>e.taskId===t.id);
      const out={taskFound:!!t,taskStatus:t&&t.status,entryCreated:!!e,entryHours:e&&e.hours,entryOwnerMatches:!ownerId||(!!e&&e.staffId===ownerId)};
      if(t){DB.tasks=DB.tasks.filter(x=>x.id!==t.id);DB.timeEntries=(DB.timeEntries||[]).filter(x=>x.taskId!==t.id);saveDB(DB);}
      return out;
    },subSetup.parentId,ownerId));
  }
  ok(sub.hiddenBeforePick,'the subitem row\'s hours field also starts hidden');
  ok(sub.shownAfterDone,'picking Completed on a subitem reveals its own hours field the same way');
  ok(sub.genuinelyVisible,'the subitem hours field is actually clickable at its own center point, not clipped by the narrow Status column');
  ok(sub.taskFound&&sub.taskStatus==='done','the new subitem is created with status done');
  ok(sub.entryCreated,'saving the subitem with hours filled in logs a real timesheet entry for it too');
  ok(sub.entryHours===0.5,`the typed subitem hours value is what gets logged (got ${sub.entryHours})`);
  ok(sub.entryOwnerMatches,'the subitem entry is attributed to whichever owner was picked on that row');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: '+e.message);process.exit(1)});
