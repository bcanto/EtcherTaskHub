const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const ctx=b.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:3001',['clipboard-read','clipboard-write']);
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // seed three notes on a task, with rich bodies
  const seed=await p.evaluate(async()=>{
    const bid=DB.workboards[0].id;openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const t=DB.tasks.find(x=>_taskBoardId(x)===bid&&!x.parentTaskId);
    DB.meetingNotes=(DB.meetingNotes||[]).filter(n=>!/^AITEST/.test(n.title||''));
    const mk=(d,title,body)=>({id:'mn-ai-'+d,taskId:t.id,boardId:bid,title,body,date:d,
      authorId:currentUser.id,createdAt:d+'T09:00:00.000Z',updatedAt:d+'T09:00:00.000Z'});
    DB.meetingNotes.push(
      mk('2026-03-04','AITEST Kickoff','<p>Agreed <b>scope</b> and budget.</p><ul><li>Crane audit</li><li>Site survey</li></ul>'),
      mk('2026-01-15','AITEST Discovery','<div>First call.</div><div>Client wants monthly reporting.</div>'),
      mk('2026-05-20','AITEST Review','<p>Signed off phase&nbsp;1.<br>Phase 2 starts July.</p>'));
    saveDB(DB);
    openTaskPanel(t.id,'notes');await new Promise(r=>setTimeout(r,900));
    return {taskId:t.id,boardId:bid,count:(DB.meetingNotes||[]).filter(n=>n.taskId===t.id).length};
  });
  console.log('SEED:',JSON.stringify(seed));
  ok(seed.count>=3,'three meeting notes seeded on the task');

  // ── the bar shows up ───────────────────────────────────────────
  const bar=await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('#tp-body button')].map(b=>b.textContent.trim());
    return {copy:btns.find(t=>/Copy .*for AI/.test(t))||null,select:btns.some(t=>/^Select/.test(t)),
      boxes:document.querySelectorAll('#tp-body input[type=checkbox]').length};
  });
  console.log('BAR:',JSON.stringify(bar));
  ok(!!bar.copy,'the Copy for AI button is on the Meeting Notes tab ("'+bar.copy+'")');
  ok(bar.select,'a Select dropdown sits next to it');
  ok(bar.boxes===0,'no tick boxes until you ask for them');

  // ── copy everything ────────────────────────────────────────────
  const all=await p.evaluate(async()=>{
    mnCopyScope('task','all');await new Promise(r=>setTimeout(r,500));
    return (await navigator.clipboard.readText()).replace(/\r\n/g,'\n');
  });
  console.log('--- COPIED (all) ---\n'+all.split('\n').slice(0,16).join('\n')+'\n...');
  ok(/^HANDOVER — /.test(all),'the text opens with a HANDOVER header');
  ok(/\nTASK\n/.test(all),'it carries a TASK block');
  ok(/\nTitle: \S/.test(all),'the task title is in the handover');
  ok(/\nDescription:\n/.test(all),'the task description has its own section');
  ok(/Book external inspector/.test(all),'the description text itself came through');
  ok(/\nReference: \S/.test(all),'the task reference is included');
  ok(/\nStatus: \S/.test(all)&&/Priority: \S/.test(all),'status and priority are included');
  ok(/\nMEETINGS\n/.test(all),'the meetings follow under their own heading');
  ok(all.indexOf('\nTASK\n')<all.indexOf('\nMEETINGS\n'),'the work comes before the meetings');
  ok(/3 notes, oldest first/.test(all),'it says how many and in what order');
  ok(/Use it as background for questions about this job/.test(all),'it tells the assistant what to do with them');
  const order=['AITEST Discovery','AITEST Kickoff','AITEST Review'].map(t=>all.indexOf(t));
  ok(order[0]>-1&&order[0]<order[1]&&order[1]<order[2],'meetings are oldest-first, not newest-first');
  ok(!/<[a-z/]/i.test(all),'no HTML tags survive into the copied text');
  ok(/- Crane audit/.test(all)&&/- Site survey/.test(all),'list items keep a bullet');
  ok(/First call\.\s*\n\s*Client wants monthly reporting/.test(all),'block elements keep their line breaks');
  ok(/Signed off phase 1\.\s*\nPhase 2 starts July/.test(all),'a <br> becomes a newline and &nbsp; becomes a space');
  ok(/Written by: /.test(all),'each meeting records who wrote it');
  ok(all.indexOf('Date: ')>-1,'each meeting carries its date');

  // ── choose a subset ────────────────────────────────────────────
  const sub=await p.evaluate(async()=>{
    mnTogglePickMode('task');await new Promise(r=>setTimeout(r,400));
    const boxes=document.querySelectorAll('#tp-body input[type=checkbox]').length;
    const ids=(DB.meetingNotes||[]).filter(n=>n.taskId===_tpCurrentTask.id&&/^AITEST/.test(n.title));
    const pickId=ids.find(n=>n.title==='AITEST Review').id;
    mnTogglePick(pickId,'task');await new Promise(r=>setTimeout(r,400));
    const bulk=(document.querySelector('#tp-body .mn-selcount')||{}).textContent||'';
    mnCopyScope('task','selected');await new Promise(r=>setTimeout(r,500));
    const txt=(await navigator.clipboard.readText()).replace(/\r\n/g,'\n');
    return {boxes,bulk,txt,checked:document.querySelectorAll('#tp-body input[type=checkbox]:checked').length};
  });
  console.log('SUBSET label:',JSON.stringify(sub.label),'boxes:',sub.boxes,'checked:',sub.checked);
  ok(sub.boxes>=3,'Select… reveals a tick box on every meeting ('+sub.boxes+')');
  ok(sub.checked===1,'ticking one meeting checks exactly one box');
  ok(/1 selected/.test(sub.bulk||''),'the bulk bar counts what you chose ("'+sub.bulk+'")');
  ok(/AITEST Review/.test(sub.txt)&&!/AITEST Kickoff/.test(sub.txt),'only the chosen meeting is copied');
  ok(/1 note, oldest first/.test(sub.txt),'the header agrees ("1 note")');

  // ── select all / clear, and leaving pick mode ──────────────────
  const bulk=await p.evaluate(async()=>{
    mnPickAll('task');await new Promise(r=>setTimeout(r,350));
    const afterAll=document.querySelectorAll('#tp-body input[type=checkbox]:checked').length;
    mnPickAll('task');await new Promise(r=>setTimeout(r,350));
    const afterClear=document.querySelectorAll('#tp-body input[type=checkbox]:checked').length;
    mnTogglePickMode('task');await new Promise(r=>setTimeout(r,350));
    return {afterAll,afterClear,boxesAfterDone:document.querySelectorAll('#tp-body input[type=checkbox]').length,
      picked:_mnPick.size};
  });
  console.log('BULK:',JSON.stringify(bulk));
  ok(bulk.afterAll>=3,'Select all ticks every meeting');
  ok(bulk.afterClear===0,'pressing it again clears them');
  ok(bulk.boxesAfterDone===0&&bulk.picked===0,'Done hides the boxes and forgets the choice');

  // ── board-level notes get the same bar ─────────────────────────
  const board=await p.evaluate(async()=>{
    if(typeof closeTaskPanel==='function')closeTaskPanel();
    const bid=DB.workboards[0].id;
    DB.meetingNotes.push({id:'mn-ai-board',boardId:bid,title:'AITEST Board Sync',
      body:'<p>Weekly sync. <b>Two</b> items outstanding.</p>',date:'2026-04-02',
      authorId:currentUser.id,createdAt:'2026-04-02T09:00:00.000Z',updatedAt:'2026-04-02T09:00:00.000Z'});
    saveDB(DB);
    wsOpenComms();await new Promise(r=>setTimeout(r,600));
    wsSetCommsTab('notes');await new Promise(r=>setTimeout(r,700));
    const btn=[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).find(t=>/for AI/.test(t));
    mnCopyScope('board','all');await new Promise(r=>setTimeout(r,500));
    const txt=(await navigator.clipboard.readText()).replace(/\r\n/g,'\n');
    return {btn,hasSync:/AITEST Board Sync/.test(txt),hasTaskNote:/AITEST Kickoff/.test(txt),head:txt.split('\n')[0],
      hasBoardBlock:/\nBOARD\n/.test(txt)&&/\nTitle: \S/.test(txt),hasDesc:/\nDescription:\n/.test(txt)};
  });
  console.log('BOARD:',JSON.stringify(board));
  ok(!!board.btn,'the board Meeting Notes tab has the same button ("'+board.btn+'")');
  ok(board.hasSync,'it copies the board-level notes');
  ok(!board.hasTaskNote,'and does NOT mix in notes belonging to a task');
  ok(/HANDOVER — /.test(board.head),'the board export is headed by the board and client ("'+board.head+'")');
  ok(board.hasBoardBlock,'the board export leads with a BOARD block carrying its title');
  ok(board.hasDesc,'and its description section');

  // ── nothing to copy ────────────────────────────────────────────
  const empty=await p.evaluate(async()=>{
    const keep=DB.meetingNotes;
    DB.meetingNotes=[];
    let toasted='';
    const orig=window.showToast;window.showToast=(m,t)=>{toasted=t+':'+m;};
    mnCopyScope('board','all');
    window.showToast=orig;DB.meetingNotes=keep;
    return toasted;
  });
  console.log('EMPTY:',empty);
  ok(/warning:.*No meeting notes/.test(empty),'copying with no notes warns instead of copying an empty file');

  // cleanup
  await p.evaluate(()=>{DB.meetingNotes=(DB.meetingNotes||[]).filter(n=>!/^AITEST/.test(n.title||''));saveDB(DB);});

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
