// The simplified meeting form: the §11 regression checks, plus the disclosure rules.
// External-contact coverage is deliberately absent — attendees are internal staff only,
// per Bruna's standing instruction, which overrides §4 of the brief.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,140));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1900));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);
  const clean=()=>p.evaluate(()=>{
    const ids=new Set((DB.meetingNotes||[]).filter(n=>/^M2TEST/.test(n.title||'')).map(n=>n.id));
    DB.meetingNotes=(DB.meetingNotes||[]).filter(n=>!ids.has(n.id));
    DB.timeEntries=(DB.timeEntries||[]).filter(e=>!ids.has(e.meetingId));
    _mtgDraft=null;_mtgEditingId=null;_mtgPicker=null;_mtgAttPicker=null;saveDB(DB);});
  await clean();

  // ── the default form ──────────────────────────────────────
  const def=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    window._T=t.id;window._BID=bid;
    openTaskPanel(t.id,'notes');await new Promise(r=>setTimeout(r,800));
    mtgStartNew();await new Promise(r=>setTimeout(r,600));
    const d=_mtgDraft;
    const startM=(+d.startTime.split(':')[0])*60+(+d.startTime.split(':')[1]);
    return{
      secs:[...document.querySelectorAll('.mtg-sec-hd')].map(x=>x.textContent),
      noMethodSelect:!document.getElementById('mtg-method'),
      noAttSearch:!document.getElementById('mtg-att-pick'),
      durChip:(document.querySelector('.mtg-durchip')||{}).textContent,
      start:d.startTime,end:d.endTime,dur:mtgDuration(d),startOn15:startM%15===0,
      attCount:(d.attendees||[]).length,attSum:(document.querySelector('.mtg-att-sum')||{}).textContent,
      oneline:(document.querySelector('.mtg-oneline')||{}).textContent||'',
      footer:[...document.querySelectorAll('.mtg-footer button')].map(x=>x.textContent.trim()),
      discAria:[...document.querySelectorAll('.mtg-disc')].every(x=>x.tagName==='BUTTON'),
      moreHidden:document.getElementById('mtg-more').hasAttribute('hidden'),
      tsHidden:document.getElementById('mtg-tsset').hasAttribute('hidden'),
      billingDefault:d.billing,
      parse:[mtgParseDur('90'),mtgParseDur('1.5'),mtgParseDur('1h30'),mtgParseDur('1:30')],
      fmt:[mtgFmtMins(60),mtgFmtMins(45),mtgFmtMins(90)]};
  });
  console.log('DEFAULT:',JSON.stringify(def));
  ok(def.secs.length===3&&!def.secs.some(s=>/allocation/i.test(s)),'one linked task hides Time allocation entirely');
  ok(def.noMethodSelect,'the Time entry method dropdown is gone');
  ok(def.noAttSearch,'there is no permanent attendee search field');
  ok(def.durChip&&/min|hour/.test(def.durChip),'duration is a chip on the Finish field ("'+def.durChip+'")');
  ok(def.startOn15,'start rounds down to a 15-minute mark ('+def.start+')');
  ok(def.dur===30,'finish defaults to start + 30 minutes');
  ok(def.attCount===1&&/Included in timesheet/.test(def.attSum||''),'the current user is added automatically ("'+def.attSum+'")');
  ok(/will be recorded against/.test(def.oneline),'a single task shows the recording line ("'+def.oneline.trim()+'")');
  ok(def.footer.join(',')==='Cancel,Save & add time','the footer has exactly Cancel and Save & add time');
  ok(def.discAria,'every disclosure trigger is a real button');
  ok(def.moreHidden&&def.tsHidden,'More options and Settings start collapsed');
  ok(def.billingDefault==='task-default','billing defaults to the task, not to Billable');
  ok(def.parse.every(v=>v===90),'90, 1.5, 1h30 and 1:30 all parse to 90 minutes');
  ok(def.fmt.join('|')==='1 hour|45 min|1 hr 30 min','durations format consistently ('+def.fmt.join(', ')+')');

  // ── duration-only mode ────────────────────────────────────
  const dm=await p.evaluate(async()=>{
    mtgSetDurMode(true);await new Promise(r=>setTimeout(r,450));
    const o={field:!!document.getElementById('mtg-dur'),noStart:!document.getElementById('mtg-start'),
      label:(document.querySelector('.mtg-disc')||{}).textContent.trim()};
    mtgDurInput('1h30');await new Promise(r=>setTimeout(r,450));
    o.dur=mtgDuration(_mtgDraft);o.shown=document.getElementById('mtg-dur').value;
    mtgSetDurMode(false);await new Promise(r=>setTimeout(r,450));
    o.backToRange=!!document.getElementById('mtg-start');
    return o;});
  console.log('DURATION MODE:',JSON.stringify(dm));
  ok(dm.field&&dm.noStart,'"Enter duration only" swaps the time row for a duration field');
  ok(/start and finish/i.test(dm.label),'and the button flips to "Enter start and finish time"');
  ok(dm.dur===90&&dm.shown==='1 hr 30 min','1h30 normalises to 90 minutes, shown consistently');
  ok(dm.backToRange,'and it switches back');

  // ── §11.2 split 60 across 3 → 3 entries totalling 60 ──────
  const split=await p.evaluate(async()=>{
    const d=_mtgDraft;
    document.getElementById('mtg-title').value='M2TEST Split';
    document.getElementById('mtg-start').value='10:00';
    document.getElementById('mtg-end').value='11:00';
    mtgTimeChanged();await new Promise(r=>setTimeout(r,400));
    const others=DB.tasks.filter(t=>_taskBoardId(t)===window._BID&&!t.parentTaskId&&t.id!==window._T).slice(0,2).map(t=>t.id);
    mtgOpenPicker();await new Promise(r=>setTimeout(r,400));
    others.forEach(id=>mtgPickerToggle(id));
    mtgPickerApply();await new Promise(r=>setTimeout(r,450));
    const o={allocShown:[...document.querySelectorAll('.mtg-sec-hd')].some(x=>/Time allocation/i.test(x.textContent)),
      links:mtgLinks(_mtgDraft).length};
    mtgSetAllocMode('split');await new Promise(r=>setTimeout(r,450));
    o.prefill=Object.assign({},_mtgDraft.allocations);
    o.prefillValid=mtgAllocTotal(_mtgDraft)===mtgDuration(_mtgDraft);
    const ids=mtgLinks(_mtgDraft).map(l=>l.taskId);
    document.getElementById('mtg-alloc-'+ids[0]).value='30';
    document.getElementById('mtg-alloc-'+ids[1]).value='20';
    document.getElementById('mtg-alloc-'+ids[2]).value='10';
    mtgStruct();await new Promise(r=>setTimeout(r,450));
    o.total=mtgAllocTotal(_mtgDraft);
    mtgSaveMain();await new Promise(r=>setTimeout(r,800));
    const m=(DB.meetingNotes||[]).find(n=>n.title==='M2TEST Split');
    const ents=(DB.timeEntries||[]).filter(e=>e.meetingId===m.id);
    o.mid=m.id;o.entries=ents.length;
    o.mins=ents.reduce((s,e)=>s+Math.round((+e.hours||0)*60),0);
    o.perTask=ents.map(e=>e.taskId).sort().join(',');
    return o;});
  console.log('SPLIT:',JSON.stringify(split));
  ok(split.allocShown&&split.links===3,'a second linked task reveals Time allocation');
  ok(split.prefillValid,'choosing Split prefills the full duration on the primary, never an invalid state');
  ok(split.entries===3,'a 60-minute meeting split three ways makes 3 entries');
  ok(split.mins===60,'they total 60 minutes, not 180');

  // ── §11.1 save twice → no duplicates ──────────────────────
  const twice=await p.evaluate(async(mid)=>{
    const before=(DB.timeEntries||[]).filter(e=>e.meetingId===mid).length;
    mtgAddToTimesheets(mid,true);await new Promise(r=>setTimeout(r,700));
    const after=(DB.timeEntries||[]).filter(e=>e.meetingId===mid);
    return{before,after:after.length,mins:after.reduce((s,e)=>s+Math.round((+e.hours||0)*60),0)};
  },split.mid);
  console.log('TWICE:',JSON.stringify(twice));
  ok(twice.after===twice.before,'running Add to timesheets again creates no duplicates');
  ok(twice.mins===60,'and the total is still 60 minutes');

  // ── §11.3 partial attendance × split → pro-rata ───────────
  const prorata=await p.evaluate(async(mid)=>{
    const m=(DB.meetingNotes||[]).find(n=>n.id===mid);
    const a=m.attendees[0];
    a.start='10:00';a.end='10:30';   // half the meeting
    saveDB(DB);
    const lines=mtgAttendeeLines(m,a);
    return{attMins:mtgAttMinutes(m,a),lines,sum:lines.reduce((s,l)=>s+l.minutes,0),
      over:mtgOverBooked(m).length};
  },split.mid);
  console.log('PRO-RATA:',JSON.stringify(prorata));
  ok(prorata.attMins===30,'the attendee is recorded as present for 30 minutes');
  ok(prorata.sum===30,'their minutes spread across the tasks total exactly their attendance');
  ok(prorata.lines.length===3&&prorata.lines.every(l=>l.minutes%5===0),'split pro-rata and rounded to 5-minute steps');
  ok(prorata.over===0,'nobody is booked for more than they attended');

  // ── §11.6 over-allocate → save blocked with a visible reason ──
  const over=await p.evaluate(async(mid)=>{
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,600));
    mtgEdit(mid);await new Promise(r=>setTimeout(r,600));
    const ids=mtgLinks(_mtgDraft).map(l=>l.taskId);
    document.getElementById('mtg-alloc-'+ids[0]).value='60';
    mtgStruct();await new Promise(r=>setTimeout(r,500));
    const btn=[...document.querySelectorAll('.mtg-footer button')].find(x=>/Save/.test(x.textContent));
    const o={disabled:btn.disabled,reason:(document.getElementById('mtg-blocked')||{}).textContent||'',
      describedBy:btn.getAttribute('aria-describedby'),
      warn:(document.querySelector('.mtg-warn--bad')||{}).textContent||''};
    // and it comes back once the numbers are right
    document.getElementById('mtg-alloc-'+ids[0]).value='30';
    mtgStruct();await new Promise(r=>setTimeout(r,500));
    const btn2=[...document.querySelectorAll('.mtg-footer button')].find(x=>/Save/.test(x.textContent));
    o.reEnabled=!btn2.disabled;
    return o;},split.mid);
  console.log('OVER:',JSON.stringify(over));
  ok(over.disabled,'over-allocating disables Save');
  ok(/exceed/i.test(over.reason),'the footer says why ("'+over.reason+'")');
  ok(over.describedBy==='mtg-blocked','the disabled button points at the reason for screen readers');
  ok(/exceeds the meeting duration by/.test(over.warn),'and the allocation row warns with the exact overage');
  ok(over.reEnabled,'fixing the numbers re-enables Save');

  // ── §11.4 custom meeting type reopens expanded ────────────
  const disc=await p.evaluate(async(mid)=>{
    const m=(DB.meetingNotes||[]).find(n=>n.id===mid);
    m.meetingType='site';m.tsCategory='Consulting';saveDB(DB);
    mtgCancel();await new Promise(r=>setTimeout(r,400));
    mtgEdit(mid);await new Promise(r=>setTimeout(r,700));
    return{more:!document.getElementById('mtg-more').hasAttribute('hidden'),
      ts:!document.getElementById('mtg-tsset').hasAttribute('hidden'),
      type:document.getElementById('mtg-type').value};
  },split.mid);
  console.log('DISCLOSURE:',JSON.stringify(disc));
  ok(disc.more,'a custom meeting type reopens More meeting options expanded');
  ok(disc.ts,'a custom timesheet category reopens Settings expanded');

  // ── §11.5 remove a non-primary link, and guard the primary ──
  const unlink=await p.evaluate(async(mid)=>{
    const ids=mtgLinks(_mtgDraft).map(l=>l.taskId);
    const primary=mtgPrimaryTaskId(_mtgDraft);
    const victim=ids.find(x=>x!==primary);
    let alerted='';const real=window.showAlert;window.showAlert=(m)=>{alerted=m;};
    mtgUnlink(primary);await new Promise(r=>setTimeout(r,350));
    const primaryGuard=alerted;
    window.showAlert=real;
    // the non-primary one carries time, so it asks where to move it
    mtgUnlink(victim);await new Promise(r=>setTimeout(r,400));
    const asked=!!document.getElementById('mtg-move-to');
    if(asked){document.getElementById('mtg-move-to').value=primary;mtgMoveTimeAndUnlink(victim);}
    await new Promise(r=>setTimeout(r,500));
    return{primaryGuard,asked,linksLeft:mtgLinks(_mtgDraft).length,
      stillPrimary:mtgPrimaryTaskId(_mtgDraft)===primary,
      meetingAlive:!!(DB.meetingNotes||[]).find(n=>n.id===mid)};
  },split.mid);
  console.log('UNLINK:',JSON.stringify(unlink));
  ok(/primary/i.test(unlink.primaryGuard||''),'removing the primary task is refused until primary is reassigned');
  ok(unlink.asked,'removing a task that holds time asks where the time should go');
  ok(unlink.linksLeft===2&&unlink.meetingAlive,'the master meeting and its other links survive');

  // ── §11.8 an approved entry is never rewritten ────────────
  const approved=await p.evaluate(async(mid)=>{
    mtgCancel();await new Promise(r=>setTimeout(r,300));
    const m=(DB.meetingNotes||[]).find(n=>n.id===mid);
    const ents=(DB.timeEntries||[]).filter(e=>e.meetingId===mid);
    ents[0].status='approved';ents[0].hours=1;saveDB(DB);
    const before={id:ents[0].id,hours:ents[0].hours,status:ents[0].status};
    let alerted='';const real=window.showAlert;window.showAlert=(msg)=>{alerted=msg;};
    mtgAddToTimesheets(mid,true);await new Promise(r=>setTimeout(r,700));
    window.showAlert=real;
    const after=(DB.timeEntries||[]).find(e=>e.id===before.id);
    return{alerted,unchanged:after.hours===before.hours&&after.status==='approved'};
  },split.mid);
  console.log('APPROVED:',JSON.stringify(approved));
  ok(approved.unchanged,'an approved entry is left exactly as it was');
  ok(/approved/i.test(approved.alerted||'')&&/Timesheet module/i.test(approved.alerted||''),
     'and the message names it and points at the Timesheet module');

  await clean();
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
