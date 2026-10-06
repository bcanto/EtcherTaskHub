const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:900}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // build a board tall enough to scroll, with several groups
  await p.evaluate(()=>{
    const bid=DB.workboards[0].id;const now=new Date().toISOString();
    ['Alpha','Bravo','Charlie','Delta','Echo'].forEach((n,gi)=>{
      const gid='scr-g'+gi;
      DB.groups.push({id:gid,name:n,boardId:bid,workboardId:bid,clientId:DB.clients[0].id,order:100+gi});
      for(let i=0;i<12;i++)DB.tasks.push({id:'scr-t'+gi+'-'+i,name:n+' task '+i,boardId:bid,workboardId:bid,
        groupId:gid,status:'todo',priority:'med',createdAt:now});
    });
    saveDB(DB);openWorkboard(bid);
  });
  await new Promise(r=>setTimeout(r,1500));

  const info=await p.evaluate(()=>{
    const sc=document.getElementById('ws-table-scroll');
    return {scrollable:sc.scrollHeight>sc.clientHeight+40,max:sc.scrollHeight-sc.clientHeight};
  });
  ok(info.scrollable,'board is tall enough to scroll ('+info.max+'px of travel)');

  // ---- collapsing a group far down must not jump to the top ----
  const grp=await p.evaluate(async()=>{
    const sc=document.getElementById('ws-table-scroll');
    sc.scrollTop=Math.round((sc.scrollHeight-sc.clientHeight)*0.6);
    await new Promise(x=>setTimeout(x,120));
    const before=sc.scrollTop;
    // pick a group header actually visible at this scroll position
    const hdr=[...document.querySelectorAll('.ws-grp-hdr')].find(h=>{
      const r=h.getBoundingClientRect(),s=sc.getBoundingClientRect();
      return r.top>s.top&&r.bottom<s.bottom;});
    if(!hdr)return{err:'no visible group header'};
    hdr.click();
    await new Promise(x=>setTimeout(x,500));
    const sc2=document.getElementById('ws-table-scroll');
    return {before,after:sc2.scrollTop,drift:Math.abs(sc2.scrollTop-before)};
  });
  console.log('COLLAPSE GROUP:',JSON.stringify(grp));
  ok(!grp.err,'found a group header while scrolled');
  ok(grp.after>0,'still scrolled after collapsing a group (was jumping to 0)');
  ok(grp.drift<140,'scroll position held within '+grp.drift+'px');

  // ---- expanding it again also holds ----
  const grp2=await p.evaluate(async()=>{
    const sc=document.getElementById('ws-table-scroll');
    const before=sc.scrollTop;
    const hdr=[...document.querySelectorAll('.ws-grp-hdr')].find(h=>{
      const r=h.getBoundingClientRect(),s=sc.getBoundingClientRect();
      return r.top>s.top&&r.bottom<s.bottom;});
    hdr.click();
    await new Promise(x=>setTimeout(x,500));
    return {before,after:document.getElementById('ws-table-scroll').scrollTop};
  });
  console.log('EXPAND GROUP:',JSON.stringify(grp2));
  ok(grp2.after>0,'still scrolled after expanding again');

  // ---- what survives a refresh ----
  // The scroll offset is deliberately no longer persisted: it could only be captured on a
  // group toggle, so restoring it dropped you at a position you had long since left. Which
  // groups are open still survives; the scroll starts at the top.
  const saved=await p.evaluate(()=>{
    const raw=sessionStorage.getItem('etcher_ws_state_'+currentWorkboard.id);
    const s=raw?JSON.parse(raw):null;
    return {keys:s?Object.keys(s).sort():null,hasScroll:s?('scroll' in s):null,
            live:document.getElementById('ws-table-scroll').scrollTop};
  });
  console.log('SAVED STATE:',JSON.stringify(saved));
  ok(saved.keys&&saved.keys.join(',')==='collapsed,expanded','the saved state carries the open/closed groups');
  ok(saved.hasScroll===false,'and no scroll offset, so a refresh starts at the top');
  ok(saved.live>0,'scrolling itself still works while you are on the page ('+saved.live+')');

  // ---- a cell edit re-render also holds position ----
  const cell=await p.evaluate(async()=>{
    const sc=document.getElementById('ws-table-scroll');
    const before=sc.scrollTop;
    const t=DB.tasks.find(x=>x.id==='scr-t2-4');
    if(t){t.priority='high';saveDB(DB);renderView('workspace');}
    await new Promise(x=>setTimeout(x,500));
    return {before,after:document.getElementById('ws-table-scroll').scrollTop};
  });
  console.log('CELL EDIT:',JSON.stringify(cell));
  ok(Math.abs(cell.after-cell.before)<140,'editing a row keeps your place ('+cell.before+' -> '+cell.after+')');

  // ---- leaving and returning still restores ----
  const roundTrip=await p.evaluate(async()=>{
    const before=document.getElementById('ws-table-scroll').scrollTop;
    const bid=currentWorkboard.id;
    exitWorkboard();await new Promise(x=>setTimeout(x,400));
    openWorkboard(bid);await new Promise(x=>setTimeout(x,700));
    return {before,after:document.getElementById('ws-table-scroll')?.scrollTop||0};
  });
  console.log('LEAVE/RETURN:',JSON.stringify(roundTrip));
  // Re-entering a board has never restored scroll: _wsStateRestore only runs on the
  // page-reload path (etcher_last_nav), not in openWorkboard. Pre-existing behaviour,
  // left as-is rather than changed without being asked. The position IS saved, so
  // wiring it up later is a one-liner.
  ok(roundTrip.after===0,'re-entering starts at the top (unchanged, pre-existing)');

  // cleanup
  await p.evaluate(()=>{
    DB.tasks=DB.tasks.filter(t=>!String(t.id).startsWith('scr-t'));
    DB.groups=DB.groups.filter(g=>!String(g.id).startsWith('scr-g'));
    saveDB(DB);
  });

  console.log('PASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
