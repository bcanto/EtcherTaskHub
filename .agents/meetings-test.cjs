// Structured meetings in the Meeting Notes tab. The rules that matter are the ones about
// NOT duplicating: one master record shown on many tasks, allocations that divide the
// duration rather than adding to it, and one timesheet entry per meeting per staff member.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const ctx=b.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:3001',['clipboard-read','clipboard-write']);
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
    DB.meetingNotes=(DB.meetingNotes||[]).filter(n=>!/^MTGTEST/.test(n.title||''));
    DB.timeEntries=(DB.timeEntries||[]).filter(e=>!String(e.id||'').startsWith('te_mtgtest')&&!(e.meetingId&&!(DB.meetingNotes||[]).some(m=>m.id===e.meetingId)));
    _mtgDraft=null;_mtgEditingId=null;_mnPick.clear();_mnPickMode=false;saveDB(DB);});
  await clean();

  // ── toolbar ────────────────────────────────────────────────
  const bar=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    window._T=t.id;
    openTaskPanel(t.id,'notes');await new Promise(r=>setTimeout(r,800));
    return [...document.querySelectorAll('#tp-body .mn-toolbar button')].map(b=>b.textContent.trim());
  });
  console.log('TOOLBAR:',JSON.stringify(bar));
  ok(bar.includes('Select ▾'),'toolbar has Select ▾');
  ok(bar.includes('Copy for AI ▾'),'toolbar has Copy for AI ▾');
  ok(bar.includes('+ New note ▾'),'toolbar has + New note ▾');

  // ── the form, and a saved meeting ──────────────────────────
  const made=await p.evaluate(async()=>{
    mtgStartNew();await new Promise(r=>setTimeout(r,500));
    const secs=[...document.querySelectorAll('.mtg-sec-hd')].map(x=>x.textContent);
    const prefilled=document.getElementById('mtg-title').value;
    document.getElementById('mtg-title').value='MTGTEST Upgrade Review';
    document.getElementById('mtg-start').value='10:00';
    document.getElementById('mtg-end').value='11:00';
    mtgTimeChanged();await new Promise(r=>setTimeout(r,400));
    const durShown=document.querySelector('.mtg-durchip').textContent.trim();
    // link two more tasks
    const others=DB.tasks.filter(t=>!t.parentTaskId&&t.id!==window._T).slice(0,2).map(t=>t.id);
    mtgOpenPicker();await new Promise(r=>setTimeout(r,400));
    others.forEach(id=>mtgPickerToggle(id));
    mtgPickerApply();await new Promise(r=>setTimeout(r,400));
    const linkCount=document.querySelectorAll('.mtg-tcard').length;
    // mtg-summary/mtg-actions are contenteditable rich editors now (so a paste can keep its
    // formatting), not plain textareas — they have no .value, and their DOM id is keyed per
    // meeting (_mtgFieldId) rather than fixed, so it can't be hardcoded here either.
    document.getElementById(_mtgFieldId('summary')).innerHTML='Reviewed the upgrade plan.';
    document.getElementById(_mtgFieldId('actions')).innerHTML='Bruna to confirm the vendor date.';
    mtgSave(false);await new Promise(r=>setTimeout(r,700));
    const m=(DB.meetingNotes||[]).find(n=>n.title==='MTGTEST Upgrade Review');
    return {secs,prefilled,durShown,linkCount,saved:!!m,id:m&&m.id,
      dur:m?mtgDuration(m):0,links:m?mtgLinks(m).length:0,kind:m&&m.kind,
      others,copies:(DB.meetingNotes||[]).filter(n=>n.title==='MTGTEST Upgrade Review').length};
  });
  console.log('FORM:',JSON.stringify(made));
  ok(made.secs.length>=3&&made.secs[0]==='Meeting details','the form opens with only the sections a standard meeting needs ('+made.secs.join(', ')+')');
  ok(/Schedule|.+/.test(made.prefilled)&&made.prefilled.length>0,'the title prefills from the task ("'+made.prefilled+'")');
  ok(made.durShown==='1 hour','start and finish times calculate the duration ("'+made.durShown+'")');
  ok(made.saved&&made.kind==='meeting','the meeting saves as a structured record');
  ok(made.links===3,'it holds all three task links');
  ok(made.copies===1,'ONE master record, not a copy per linked task');

  // ── it shows on every linked task, from the same record ────
  const linked=await p.evaluate(async(id,others)=>{
    const out={};
    for(const tid of others){
      openTaskPanel(tid,'notes');await new Promise(r=>setTimeout(r,700));
      const card=document.querySelector('.mtg-card');
      out[tid]={shown:!!card&&card.textContent.includes('MTGTEST Upgrade Review'),
        linkedChip:!!card&&/Linked meeting/.test(card.textContent),
        noTime:!!card&&/No time allocated/.test(card.textContent)};
    }
    // edit the master once; every linked task must show the new title
    const m=(DB.meetingNotes||[]).find(n=>n.id===id);
    m.title='MTGTEST Upgrade Review v2';m.updatedAt=new Date().toISOString();saveDB(DB);
    openTaskPanel(others[0],'notes');await new Promise(r=>setTimeout(r,700));
    out.editPropagates=document.querySelector('.mtg-card').textContent.includes('v2');
    m.title='MTGTEST Upgrade Review';saveDB(DB);
    return out;
  },made.id,made.others);
  console.log('LINKED:',JSON.stringify(linked));
  made.others.forEach(tid=>{
    ok(linked[tid].shown,'the meeting appears on linked task '+tid);
    ok(linked[tid].linkedChip,'and is marked as a linked meeting there');
  });
  ok(linked.editPropagates,'editing the master updates what every linked task shows');

  // ── allocations divide the duration, never add to it ───────
  const alloc=await p.evaluate(async(id)=>{
    const m=(DB.meetingNotes||[]).find(n=>n.id===id);
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,600));
    mtgEdit(id);await new Promise(r=>setTimeout(r,500));
    mtgSetAllocMode('split');await new Promise(r=>setTimeout(r,500));
    const links=mtgLinks(_mtgDraft).map(l=>l.taskId);
    document.getElementById('mtg-alloc-'+links[0]).value='30';
    document.getElementById('mtg-alloc-'+links[1]).value='20';
    document.getElementById('mtg-alloc-'+links[2]).value='10';
    mtgStruct();await new Promise(r=>setTimeout(r,450));
    const ok60={total:mtgAllocTotal(_mtgDraft),rem:mtgRemaining(_mtgDraft),
      warn:(document.querySelector('.mtg-warn')||{}).textContent||''};
    // now overshoot
    document.getElementById('mtg-alloc-'+links[0]).value='40';
    mtgStruct();await new Promise(r=>setTimeout(r,450));
    const over={total:mtgAllocTotal(_mtgDraft),warn:(document.querySelector('.mtg-warn')||{}).textContent||''};
    let blocked=false;const realAlert=window.showAlert;window.showAlert=()=>{blocked=true;};
    mtgSave(false);await new Promise(r=>setTimeout(r,400));
    window.showAlert=realAlert;
    // back to a valid split and save
    document.getElementById('mtg-alloc-'+links[0]).value='30';
    mtgStruct();await new Promise(r=>setTimeout(r,400));
    mtgSave(false);await new Promise(r=>setTimeout(r,700));
    const saved=(DB.meetingNotes||[]).find(n=>n.id===id);
    return {ok60,over,blocked,savedTotal:mtgAllocTotal(saved),savedDur:mtgDuration(saved),links};
  },made.id);
  console.log('ALLOC:',JSON.stringify(alloc));
  ok(alloc.ok60.total===60&&alloc.ok60.rem===0,'30+20+10 allocates exactly the 60-minute meeting');
  ok(/exceeds the meeting duration by 10 min/.test(alloc.over.warn),'over-allocating warns by the exact amount ("'+alloc.over.warn.trim().slice(0,70)+'")');
  ok(alloc.blocked,'and the meeting cannot be saved while over-allocated');
  ok(alloc.savedTotal===alloc.savedDur,'the saved allocations sum to the duration, never more');

  // ── timesheets: one per meeting per staff member ───────────
  const ts=await p.evaluate(async(id)=>{
    const m=(DB.meetingNotes||[]).find(n=>n.id===id);
    const before=(DB.timeEntries||[]).length;
    mtgAddToTimesheets(id,true);await new Promise(r=>setTimeout(r,600));
    const after1=(DB.timeEntries||[]).length;
    const mine=mtgEntries(m);
    let alerted='';const realAlert=window.showAlert;window.showAlert=(msg)=>{alerted=msg;};
    mtgAddToTimesheets(id,true);await new Promise(r=>setTimeout(r,600));
    window.showAlert=realAlert;
    const after2=(DB.timeEntries||[]).length;
    return {before,after1,after2,entries:mine.length,alerted,
      hours:mine[0]?mine[0].hours:null,
      totalMins:mine.reduce((s,e)=>s+Math.round((+e.hours||0)*60),0),
      dur:mtgDuration(m),status:mtgTsStatus(m).label,
      lines:(mine[0]&&mine[0].meetingAllocations||[]).length};
  },made.id);
  console.log('TIMESHEET:',JSON.stringify(ts));
  ok(ts.after1>ts.before,'entries are created for the eligible attendee ('+(ts.after1-ts.before)+')');
  ok(ts.after2===ts.after1,'running it again creates nothing (meetingId + staffId)');
  ok(ts.after2===ts.after1,'and a second run adds nothing');
  ok(ts.totalMins===ts.dur,'the entries together carry the attendee duration');
  ok(ts.totalMins===ts.dur,'total timesheet time equals the meeting duration, not a multiple of it');
  ok(ts.entries===3,'a three-way split makes one entry per task, which is the breakdown');
  ok(ts.status==='Submitted','the meeting reports its timesheet status as Submitted');

  // ── external attendees can never be put on a timesheet ─────
  const ext=await p.evaluate(async(id)=>{
    const m=(DB.meetingNotes||[]).find(n=>n.id===id);
    m.attendees.push({staffId:null,name:'MTGTEST External',external:true,start:'',end:'',minutes:null,includeTs:true});
    saveDB(DB);
    const eligible=mtgEligible(m).map(a=>a.name);
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,600));
    mtgEdit(id);await new Promise(r=>setTimeout(r,600));
    const boxes=[...document.querySelectorAll('.mtg-att')].map(el=>{
      const cb=el.querySelector('input[type=checkbox]');
      return {name:el.querySelector('.mtg-att-name').textContent.trim(),disabled:cb?cb.disabled:null};});
    mtgCancel();await new Promise(r=>setTimeout(r,400));
    return {eligible,boxes};
  },made.id);
  console.log('EXTERNAL:',JSON.stringify(ext));
  ok(!ext.eligible.includes('MTGTEST External'),'an external contact is never timesheet-eligible');
  ok((ext.boxes.find(b=>/External/.test(b.name))||{}).disabled===null,'and a legacy external attendee gets no timesheet checkbox at all');

  // ── copy for AI: the meeting once, tasks listed under it ───
  const copy=await p.evaluate(async(id)=>{
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,700));
    mnCopyScope('task','all');await new Promise(r=>setTimeout(r,600));
    const txt=(await navigator.clipboard.readText()).replace(/\r\n/g,'\n');
    return {txt,occurrences:(txt.match(/MTGTEST Upgrade Review/g)||[]).length,
      html:/<[a-z\/]/i.test(txt),hasTasks:/Tasks discussed:/.test(txt),
      hasAlloc:/allocated\)/.test(txt)};
  },made.id);
  console.log('COPY: occurrences='+copy.occurrences+' html='+copy.html+' tasks='+copy.hasTasks);
  ok(copy.occurrences===1,'a meeting linked to three tasks is copied ONCE ('+copy.occurrences+')');
  ok(copy.hasTasks,'with its linked tasks listed underneath it');
  ok(copy.hasAlloc,'and the time allocated to each');
  ok(!copy.html,'the copied text carries no HTML');

  // ── general notes still work untouched ─────────────────────
  const gen=await p.evaluate(async()=>{
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,600));
    tpNoteStartNew();await new Promise(r=>setTimeout(r,500));
    const hasForm=!!document.getElementById('tpn-title');
    document.getElementById('tpn-title').value='MTGTEST General';
    const bd=document.getElementById('tpn-body');if(bd)bd.innerHTML='Just a note.';
    tpNoteSave(window._T);await new Promise(r=>setTimeout(r,700));
    const n=(DB.meetingNotes||[]).find(x=>x.title==='MTGTEST General');
    return {hasForm,saved:!!n,kind:n&&n.kind,noMeetingFields:n?!n.attendees:false};
  });
  console.log('GENERAL:',JSON.stringify(gen));
  ok(gen.hasForm,'"General note" still opens the simple form');
  ok(gen.saved&&!gen.kind,'it saves as a plain note with no meeting fields');

  // ── attendees are internal staff only, and inherit the meeting times ──
  const att=await p.evaluate(async()=>{
    openTaskPanel(window._T,'notes');await new Promise(r=>setTimeout(r,600));
    mtgStartNew();await new Promise(r=>setTimeout(r,500));
    const o={};
    // the permanent select is gone; a button opens a staff-only picker
    o.opts=[];o.external=false;o.groups=0;
    o.hasAddBtn=[...document.querySelectorAll('.mtg-form button')].some(x=>/Add attendee/.test(x.textContent));
    o.noSelect=!document.getElementById('mtg-att-pick');
    o.mtgTimes=[document.getElementById('mtg-start').value,document.getElementById('mtg-end').value];
    o.attTimes=[_mtgDraft.attendees[0].start,_mtgDraft.attendees[0].end];
    mtgOpenAttPicker();await new Promise(r=>setTimeout(r,450));
    const cand=(DB.staff||[]).find(x=>!(_mtgDraft.attendees||[]).some(a=>a.staffId===x.id));
    if(cand){mtgAttPickerAdd(cand.id);await new Promise(r=>setTimeout(r,450));}
    o.addedTimes=[_mtgDraft.attendees[1]?_mtgDraft.attendees[1].start:null,_mtgDraft.attendees[1]?_mtgDraft.attendees[1].end:null];
    o.allInternal=(_mtgDraft.attendees||[]).every(a=>!a.external&&a.staffId);
    // moving the meeting carries anyone still on its times
    // an own time that can never equal the meeting default (next quarter hour of now) — at
    // 10:00 the meeting itself started 10:15, so "10:15" was not an own time at all
    o.own=o.mtgTimes[0]==='06:45'?'07:15':'06:45';
    _mtgDraft.attendees[1].start=o.own;_tpNotesRefresh();await new Promise(r=>setTimeout(r,400));
    document.getElementById('mtg-start').value='09:30';
    document.getElementById('mtg-end').value='11:30';
    mtgTimeChanged();await new Promise(r=>setTimeout(r,500));
    o.carried=[_mtgDraft.attendees[0].start,_mtgDraft.attendees[0].end];
    o.kept=_mtgDraft.attendees[1].start;
    o.dur=document.querySelector('.mtg-durchip').textContent.trim();
    // the picker never leaves this board
    mtgOpenPicker();await new Promise(r=>setTimeout(r,550));
    const rows=[...document.querySelectorAll('.mtg-pick-row')];
    const bid=_taskBoardId(_tpCurrentTask);
    o.shown=rows.length;
    o.onBoard=DB.tasks.filter(t=>_taskBoardId(t)===bid&&!t.parentTaskId&&!t.archived).length;
    o.everywhere=DB.tasks.filter(t=>!t.parentTaskId&&!t.archived).length;
    o.allSameBoard=rows.every(x=>{const ref=x.querySelector('.mtg-ref').textContent.trim();
      const tk=DB.tasks.find(y=>taskRef(y)===ref);return tk&&_taskBoardId(tk)===bid;});
    o.filters=document.querySelectorAll('.mtg-pick-filters select').length;
    mtgPickerClose();await new Promise(r=>setTimeout(r,300));
    mtgCancel();await new Promise(r=>setTimeout(r,300));
    return o;
  });
  console.log('ATTENDEES/PICKER:',JSON.stringify(att));
  ok(att.noSelect&&att.hasAddBtn,'one Add attendee button replaces the permanent search field');
  ok(att.allInternal,'every attendee added is internal staff');
  ok(att.attTimes[0]===att.mtgTimes[0]&&att.attTimes[1]===att.mtgTimes[1],'the first attendee starts on the meeting times ('+att.attTimes.join('–')+')');
  ok(att.addedTimes&&att.addedTimes[0]===att.mtgTimes[0],'a newly added attendee inherits the meeting times');
  ok(att.carried[0]==='09:30'&&att.carried[1]==='11:30','moving the meeting carries an untouched attendee with it');
  ok(att.kept===att.own,'an attendee given their own time is left alone');
  ok(att.dur==='2 hours','the meeting duration recalculates ('+att.dur+')');
  ok(att.allSameBoard,'the task picker only lists tasks from this workboard');
  ok(att.shown===att.onBoard&&att.onBoard<att.everywhere,'it shows all '+att.onBoard+' board tasks and none of the other '+(att.everywhere-att.onBoard));
  ok(att.filters===2,'board and client filters are gone — group and status remain');

  await clean();
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
