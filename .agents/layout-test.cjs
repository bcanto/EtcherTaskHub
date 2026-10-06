// Guards the two layout bugs found in the September audit:
//  - the Reports view forced the whole page to scroll sideways (grid min-width:auto trap)
//  - the List view's table was clipped by its card with no way to scroll to the rest
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1280,height:900}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  for(const w of [1280,1024]){
    await p.setViewport({width:w,height:900});
    await new Promise(r=>setTimeout(r,250));
    const r=await p.evaluate(async()=>{
      navigate('reports');await new Promise(x=>setTimeout(x,700));
      const vw=window.innerWidth;
      const btn=[...document.querySelectorAll('button')].find(x=>/Xero CSV/.test(x.textContent||''));
      return{page:document.documentElement.scrollWidth-vw,
        xeroWhole:btn?btn.getBoundingClientRect().right<=vw+1:null,
        tableScrolls:!!document.querySelector('#rpt-body .card div[style*="overflow-x"]')};
    });
    ok(r.page<=2,'Reports at '+w+' does not push the page sideways (was '+r.page+'px)');
    ok(r.xeroWhole!==false,'the Xero CSV button is whole at '+w);
    ok(r.tableScrolls,'the timesheet table scrolls horizontally at '+w);
  }

  await p.setViewport({width:1024,height:900});
  const l=await p.evaluate(async()=>{
    if(!currentWorkboard)openWorkboard(DB.workboards[0].id);
    navigate('list');await new Promise(x=>setTimeout(x,700));
    const sc=document.querySelector('#view-container .card > div[style*="overflow-x"]');
    const o={found:!!sc,page:document.documentElement.scrollWidth-window.innerWidth};
    if(sc){
      o.hidden=sc.scrollWidth-sc.clientWidth;
      sc.scrollLeft=9999;await new Promise(x=>setTimeout(x,120));
      o.scrolled=sc.scrollLeft>0;
      const ths=[...sc.querySelectorAll('th')],last=ths[ths.length-1];
      o.lastVisible=last.getBoundingClientRect().right<=sc.getBoundingClientRect().right+2;
      sc.scrollLeft=0;
    }
    return o;
  });
  ok(l.found,'the List table sits in a horizontal scroller');
  ok(l.page<=2,'the List view does not push the page sideways');
  ok(l.hidden>0,'the List table has hidden columns to scroll to at 1024 ('+l.hidden+'px)');
  ok(l.scrolled,'the List table actually scrolls when asked');
  ok(l.lastVisible,'the last List column becomes visible after scrolling');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:','none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
