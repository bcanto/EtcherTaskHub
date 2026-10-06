const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
// A 1x1 transparent PNG, enough to prove the logo renders and is sized.
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:950}});
  const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,130));});
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  // ── title formatting ───────────────────────────────────────────
  const t=await p.evaluate(()=>({
    dup:      clientDisplayTitle({name:'General Crane Services / GCS',shortCode:'GCS'}),
    dupDash:  clientDisplayTitle({name:'General Crane Services - GCS',shortCode:'GCS'}),
    dupParen: clientDisplayTitle({name:'General Crane Services (GCS)',shortCode:'GCS'}),
    plain:    clientDisplayTitle({name:'General Cranes',shortCode:'GCR'}),
    noCode:   clientDisplayTitle({name:'Daltech',shortCode:''}),
    codeOnly: clientDisplayTitle({name:'GCS',shortCode:'GCS'}),
    caseIns:  clientDisplayTitle({name:'Acme Widgets / awd',shortCode:'AWD'}),
    none:     clientDisplayTitle(null),
    // a code that merely appears mid-name must NOT be stripped
    midName:  clientDisplayTitle({name:'GCS Holdings Group',shortCode:'GCS'}),
  }));
  console.log('TITLE:',JSON.stringify(t,null,1));
  ok(t.dup==='General Crane Services - GCS','"General Crane Services / GCS" + GCS -> "'+t.dup+'"');
  ok(t.dupDash==='General Crane Services - GCS','a trailing " - GCS" is stripped too');
  ok(t.dupParen==='General Crane Services - GCS','a trailing "(GCS)" is stripped too');
  ok(t.plain==='General Cranes - GCR','a name without the code just gets it appended');
  ok(t.noCode==='Daltech','no short code -> plain name');
  ok(t.codeOnly==='GCS','a name that is only the code does not become "GCS - GCS"');
  ok(t.caseIns==='Acme Widgets - AWD','the strip is case-insensitive');
  ok(t.none==='','no client -> empty string');
  ok(t.midName==='GCS Holdings Group - GCS','a code inside the name is left alone — only a trailing repeat goes');

  // ── the real topbar, with a duplicated name and a logo ─────────
  const bar=await p.evaluate(async(PNG)=>{
    const bid=DB.workboards[0].id;
    const cid=boardClientId(DB.workboards.find(w=>w.id===bid));
    const cli=DB.clients.find(c=>c.id===cid);
    const keep={name:cli.name,shortCode:cli.shortCode,logo:cli.logo};
    cli.name='General Crane Services / GCS';cli.shortCode='GCS';cli.logo=null;
    saveDB(DB);
    openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const vt=document.getElementById('view-title');
    const bare={text:vt.textContent.trim(),logos:vt.querySelectorAll('img.vt-logo').length,
      barH:document.getElementById('topbar').getBoundingClientRect().height};
    cli.logo=PNG;saveDB(DB);
    openWorkboard(bid);await new Promise(r=>setTimeout(r,700));
    const img=vt.querySelector('img.vt-logo');
    const withLogo={text:vt.textContent.trim(),logos:vt.querySelectorAll('img.vt-logo').length,
      barH:document.getElementById('topbar').getBoundingClientRect().height,
      logoH:img?Math.round(img.getBoundingClientRect().height):0,
      logoBeforeText:!!img&&vt.firstElementChild===img};
    Object.assign(cli,keep);saveDB(DB);
    openWorkboard(bid);await new Promise(r=>setTimeout(r,600));
    return {bare,withLogo};
  },PNG);
  console.log('TOPBAR:',JSON.stringify(bar,null,1));
  ok(bar.bare.text==='General Crane Services - GCS','the topbar reads "'+bar.bare.text+'" (was "General Crane Services / GCS / GCS")');
  ok(!/GCS.*GCS.*GCS/.test(bar.bare.text),'the short code is not repeated');
  ok(bar.bare.logos===0,'a client with no logo renders no image');
  ok(bar.withLogo.logos===1,'a client with a logo renders it');
  ok(bar.withLogo.logoBeforeText,'the logo sits before the name');
  ok(bar.withLogo.logoH>0&&bar.withLogo.logoH<=33,'the logo is scaled to the 56px header ('+bar.withLogo.logoH+'px)');
  ok(bar.withLogo.barH===bar.bare.barH,'adding the logo does not grow the header ('+bar.bare.barH+'px either way)');
  ok(bar.withLogo.text==='General Crane Services - GCS','the name still reads correctly beside the logo');
  ok(/ - GCS$/.test(bar.bare.text),'the short code comes AFTER the company name');

  // ── the board header matches every other page header ──────────
  const hh=await p.evaluate(async()=>{
    openWorkboard(DB.workboards[0].id);await new Promise(r=>setTimeout(r,700));
    const inBoard=Math.round(document.getElementById('topbar').getBoundingClientRect().height);
    const slim=document.getElementById('topbar').classList.contains('topbar-slim');
    const tabTop=Math.round(document.querySelector('.ws-tabstrip')?.getBoundingClientRect().top||-1);
    navigate('clients');await new Promise(r=>setTimeout(r,700));
    const clientMgr=Math.round(document.getElementById('topbar').getBoundingClientRect().height);
    return {inBoard,clientMgr,slim,tabTop};
  });
  console.log('HEADER HEIGHT:',JSON.stringify(hh));
  ok(hh.inBoard===hh.clientMgr,'the board header is the same height as Client Manager ('+hh.inBoard+'px)');
  ok(hh.inBoard===56,'both are the standard 56px');
  ok(!hh.slim,'the board topbar no longer collapses to a slim band');
  ok(hh.tabTop===56,'the tab strip still sits flush under it, not overlapping');

  // ── suggested client codes ─────────────────────────────────────
  // "General Cranes"/GCR and "Daltech"/DAL already exist in the seed data, so measure the
  // base suggestion by excluding the very client that owns the code.
  const codes=await p.evaluate(()=>{
    const byName=n=>(DB.clients||[]).find(c=>c.name===n)?.id||'';
    return {
      three:  suggestClientCode('General Crane Services',''),
      two:    suggestClientCode('General Cranes',byName('General Cranes')),
      one:    suggestClientCode('Daltech',byName('Daltech')),
      four:   suggestClientCode('Bright Blue Widget Company',''),
      punct:  suggestClientCode('O\'Brien & Sons Pty Ltd',''),
      short:  suggestClientCode('Ax',''),
      empty:  suggestClientCode('',''),
      existingNames:(DB.clients||[]).map(c=>c.name+'='+c.shortCode),
    };
  });
  console.log('CODES:',JSON.stringify(codes,null,1));
  ok(codes.three==='GCS','"General Crane Services" -> GCS');
  ok(codes.two==='GCR','"General Cranes" -> GCR (initial + first two of the second word)');
  ok(codes.one==='DAL','"Daltech" -> DAL');
  ok(codes.four==='BBW','only the first three words are used ("'+codes.four+'")');
  ok(/^[A-Z0-9]{2,3}$/.test(codes.punct),'punctuation is dropped ("'+codes.punct+'")');
  ok(codes.empty==='','an empty name suggests nothing');
  ok(codes.short.length>0,'a very short name still yields something ("'+codes.short+'")');

  // ── collisions ─────────────────────────────────────────────────
  const clash=await p.evaluate(()=>{
    const made=[];
    const mk=n=>{const code=suggestClientCode(n,'');
      DB.clients.push({id:'ctest'+made.length,name:n,shortCode:code,color:'#888',active:true});
      made.push(code);return code;};
    const a=mk('Zenith Alpha Systems');
    const b=mk('Zenith Alpha Services');   // same initials -> must differ
    const c=mk('Zenith Alpha Solutions');  // and again
    const dup=new Set(made).size===made.length;
    const all=(DB.clients||[]).map(x=>x.shortCode);
    const globallyUnique=new Set(all.filter(Boolean)).size===all.filter(Boolean).length;
    DB.clients=DB.clients.filter(x=>!String(x.id).startsWith('ctest'));
    saveDB(DB);
    return {a,b,c,dup,globallyUnique};
  });
  console.log('CLASH:',JSON.stringify(clash));
  ok(clash.a==='ZAS','the first of three identical-initial names gets ZAS');
  ok(clash.b!==clash.a&&clash.c!==clash.a&&clash.b!==clash.c,'colliding names each get a distinct code ('+[clash.a,clash.b,clash.c].join(', ')+')');
  ok(clash.dup,'no duplicates among the generated batch');
  ok(clash.globallyUnique,'no generated code collides with an existing client');

  // ── the modal prefills, and lets you override ──────────────────
  const modal=await p.evaluate(async()=>{
    navigate('clients');await new Promise(r=>setTimeout(r,700));
    openClientModal('');await new Promise(r=>setTimeout(r,400));
    const nm=document.getElementById('cm-name'),cd=document.getElementById('cm-code');
    const out={opened:!!nm&&!!cd,startEmpty:cd.value===''};
    nm.value='Harbour Freight Logistics';nm.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    out.prefilled=cd.value;
    // keep typing the name — still tracks, because the code was never touched
    nm.value='Harbour Freight Logistics Pty';nm.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    out.stillTracks=cd.value;
    // now the user edits the code by hand
    cd.value='HFX';cd.dispatchEvent(new Event('input',{bubbles:true}));
    nm.value='Harbour Freight Logistics Group';nm.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    out.afterManualEdit=cd.value;
    closeGenericModal();await new Promise(r=>setTimeout(r,300));
    // editing an EXISTING client must never rewrite its code
    const ex=DB.clients.find(c=>c.shortCode);
    openClientModal(ex.id);await new Promise(r=>setTimeout(r,400));
    const n2=document.getElementById('cm-name'),c2=document.getElementById('cm-code');
    out.editStart=c2.value;
    n2.value=ex.name+' Renamed';n2.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    out.editAfter=c2.value;out.editExpected=ex.shortCode;
    closeGenericModal();
    return out;
  });
  console.log('MODAL:',JSON.stringify(modal));
  ok(modal.opened,'the New Client modal has a name and a code field');
  ok(modal.startEmpty,'a new client starts with no code');
  ok(modal.prefilled==='HFL','typing the name prefills the code ("'+modal.prefilled+'")');
  ok(modal.stillTracks==='HFL','it keeps tracking the name while untouched');
  ok(modal.afterManualEdit==='HFX','once edited by hand, the code is left alone');
  ok(modal.editAfter===modal.editExpected,'editing an existing client never rewrites its code');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
  await b.close();
  process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
