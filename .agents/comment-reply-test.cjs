// Regression test for the "Uncaught SyntaxError: Unexpected end of input" reported when
// replying to a comment. Root cause: onclick="fn(${JSON.stringify(x)})" — JSON.stringify wraps
// its output in double quotes, which collide with the onclick attribute's own double quotes and
// truncate it mid-attribute, regardless of what x actually contains. Fixed by escHtml()-wrapping
// the JSON.stringify output so the browser's own attribute-decoding restores valid JS.
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

  // Throwaway board + task with a comment from an author whose name carries the exact
  // characters that break naive quoting (a literal double quote AND an apostrophe).
  await p.evaluate(()=>{
    const id='wb-replytest';
    DB.boards.push({id,name:'ReplyTest Board',color:'#97bcbd',clientId:DB.clients[0].id,
      ownerId:currentUser.id,visibility:'all_internal',archived:false,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    DB.workboards=DB.boards;
    DB.groups.push({id:'g-replytest',name:'G',boardId:id,workboardId:id,clientId:DB.clients[0].id});
    DB.tasks.push({id:'t-replytest',name:'Reply test task',boardId:id,workboardId:id,groupId:'g-replytest',status:'todo',priority:'med'});
    DB.comments=DB.comments||[];
    DB.comments.push({id:'cm-replytest',taskId:'t-replytest',authorId:'nonexistent-author-id',
      authorName:'Quote "Test" O\'Brien',body:'hello',timestamp:new Date().toISOString()});
    saveDB(DB);
  });

  await p.evaluate(()=>openTaskPanel('t-replytest'));
  await new Promise(r=>setTimeout(r,400));

  // The real bug mechanism: parse the rendered HTML through an actual DOM parser (like the
  // browser already did to build the page) and confirm the onclick attribute wasn't truncated.
  const attrCheck=await p.evaluate(()=>{
    const btn=[...document.querySelectorAll('#task-panel button')].find(b=>b.textContent.trim()==='Reply');
    return btn?btn.getAttribute('onclick'):null;
  });
  console.log('ONCLICK ATTR:',JSON.stringify(attrCheck));
  ok(!!attrCheck&&attrCheck.startsWith('tpReplyToComment(')&&attrCheck.includes('Quote')&&attrCheck.includes('O')&&attrCheck.trim().endsWith(')'),
    'the Reply button\'s onclick attribute survives HTML parsing intact (not truncated at the first embedded quote)');

  // The actual click — this is exactly what threw "Unexpected end of input" in production.
  await p.evaluate(()=>{
    const btn=[...document.querySelectorAll('#task-panel button')].find(b=>b.textContent.trim()==='Reply');
    if(btn)btn.click();
  });
  await new Promise(r=>setTimeout(r,200));
  const syntaxErrors=errs.filter(e=>/SyntaxError|Unexpected end of input/.test(e));
  ok(syntaxErrors.length===0,'clicking Reply throws no SyntaxError');

  const inputValue=await p.evaluate(()=>document.getElementById('tp-comment-input')?.value||'');
  console.log('COMMENT INPUT AFTER REPLY:',JSON.stringify(inputValue));
  ok(inputValue===`@Quote "Test" O'Brien `,'Reply correctly prefixes @<full author name> into the comment box, quotes and all');

  // ── The other two call sites with the exact same defect (error-fallback page buttons) —
  // verified the same way: does the rendered HTML survive DOM parsing intact?
  const fallbackCheck=await p.evaluate(()=>{
    const html=_renderErrorFallbackHtml('workspace',new Error('test'),'ERR-TESTCASE1');
    const div=document.createElement('div');
    div.innerHTML=html;
    const tryAgain=[...div.querySelectorAll('button')].find(b=>b.textContent.trim()==='Try Again');
    const report=[...div.querySelectorAll('button')].find(b=>b.textContent.trim()==='Report Issue');
    return{
      tryAgain:tryAgain?tryAgain.getAttribute('onclick'):null,
      report:report?report.getAttribute('onclick'):null,
    };
  });
  console.log('FALLBACK ATTRS:',JSON.stringify(fallbackCheck));
  ok(fallbackCheck.tryAgain==='navigate("workspace")','the error page\'s Try Again button survives DOM parsing as valid, complete JS');
  ok(fallbackCheck.report==='openReportIssueModal("ERR-TESTCASE1")','the error page\'s Report Issue button survives DOM parsing as valid, complete JS');

  // Cleanup: leave no trace in real data.
  await p.evaluate(()=>{
    closeTaskPanel();
    DB.boards=DB.boards.filter(w=>w.id!=='wb-replytest');DB.workboards=DB.boards;
    DB.groups=DB.groups.filter(g=>g.id!=='g-replytest');
    DB.tasks=DB.tasks.filter(t=>t.id!=='t-replytest');
    DB.comments=(DB.comments||[]).filter(c=>c.id!=='cm-replytest');
    saveDB(DB);
    navigate('dashboard');
  });

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,5):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
