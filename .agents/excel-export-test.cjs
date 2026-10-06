// Runs the real export, catches the download, and reads the workbook back with ExcelJS in
// Node — so the assertions are about the actual file a person receives, not about the code
// that was supposed to produce it.
const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const fs=require('fs');
const path=require('path');
const pass=[],fail=[];
const ok=(c,m)=>{(c?pass:fail).push(m);};
const OUT=path.resolve('.agents/_dl');
(async()=>{
  fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1600,height:1000}});
  const p=await b.newPage();await p.setCacheEnabled(false);
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,140));});
  const client=await p.target().createCDPSession();
  await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:OUT});

  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.type('#login-email','b.canto@etchersolutions.com');
  await p.type('#login-password','TaskHub123');
  await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,2000));

  // a known shape to assert against: one parent with subitems, distinct statuses
  const fixture=await p.evaluate(async()=>{
    if(!currentWorkboard)openWorkboard(DB.workboards[0].id);
    navigate('workspace');await new Promise(x=>setTimeout(x,800));
    const parent=DB.tasks.find(t=>!t.parentTaskId&&DB.tasks.some(k=>k.parentTaskId===t.id&&!k.archived));
    const kids=DB.tasks.filter(k=>k.parentTaskId===parent.id&&!k.archived);
    parent.name='EXPORT Parent Task';parent.status='in-progress';parent.priority='crit';
    parent.startDate='2026-04-11';parent.endDate='2026-05-20';parent.percentComplete=45;
    kids[0].name='EXPORT Child One';kids[0].status='completed';
    if(kids[1])kids[1].name='EXPORT Child Two';
    saveDB(DB);renderView('workspace');
    return{parent:parent.name,kids:kids.length,
      board:currentWorkboard.name,
      statusLabel:getStatusMeta('in-progress').label,
      statusBg:getStatusMeta('in-progress').bg,
      prioLabel:getPrioMeta('crit').label,
      prioBg:getPrioMeta('crit').bg,
      groups:_wsBuildSections(getFilteredTasks()).map(s=>s.label),
      rollPct:getEffectiveTaskPct(parent.id),
      rollTimeline:(()=>{
        const r=getTaskDateSpan(parent.id);
        const s0=(r&&r.startDate)||parent.startDate,e0=(r&&r.endDate)||parent.endDate;
        return (s0?formatDate(s0):'')+' – '+(e0?formatDate(e0):'');
      })()};
  });
  ok(fixture.kids>0,'the fixture parent has subitems to export');

  await p.evaluate(()=>wsMtExport());
  // the writer is fetched from a CDN on first use, so give it room
  let file=null;
  for(let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,500));
    const f=fs.readdirSync(OUT).filter(n=>n.endsWith('.xlsx'));
    if(f.length){file=path.join(OUT,f[0]);break;}
  }
  ok(!!file,'the export produces an .xlsx download'+(file?' ('+path.basename(file)+')':''));
  if(!file){
    console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
    console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
    console.log('ERRORS:',errs.length?errs.slice(0,4):'none');
    await b.close();process.exit(1);
  }
  ok(/\.xlsx$/.test(file),'the file is named .xlsx, not .csv');
  ok(fs.statSync(file).size>3000,'the workbook has real content ('+fs.statSync(file).size+' bytes)');

  // read it back the way Excel would
  const ExcelJS=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/exceljs');
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws=wb.worksheets[0];
  ok(!!ws,'the workbook has a sheet');
  const text=[];
  ws.eachRow({includeEmpty:false},row=>{
    text.push(row.values.map(v=>v==null?'':(typeof v==='object'&&v.richText?v.richText.map(t=>t.text).join(''):String(v))).join('|'));
  });
  const all=text.join('\n');

  ok(new RegExp(fixture.board.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(all),'the board name is in the sheet');
  ok(/EXPORT Parent Task/.test(all),'the parent task appears');
  ok(/EXPORT Child One/.test(all),'its subitem appears');
  ok(/Subitems/.test(all),'subitems are introduced by their own label row');
  const groupHit=fixture.groups.filter(g=>g&&all.includes(g)).length;
  ok(groupHit>0,'group headings are written ('+groupHit+' of '+fixture.groups.length+' found)');

  // the parent row must come before its subitem, with the Subitems label between
  const iParent=text.findIndex(l=>l.includes('EXPORT Parent Task'));
  const iLabel=text.findIndex((l,ix)=>ix>iParent&&/Subitems/.test(l));
  const iChild=text.findIndex((l,ix)=>ix>iParent&&l.includes('EXPORT Child One'));
  ok(iParent>=0&&iLabel>iParent&&iChild>iLabel,'subitems are nested under their parent, after a Subitems label');

  // colour actually landed on the Status and Priority cells
  let statusFilled=0,prioFilled=0,headerBold=0;
  ws.eachRow({includeEmpty:false},row=>{
    row.eachCell({includeEmpty:false},cell=>{
      const v=String(cell.value==null?'':cell.value);
      const fill=cell.fill&&cell.fill.fgColor&&cell.fill.fgColor.argb;
      if(v===fixture.statusLabel&&fill)statusFilled++;
      if(v===fixture.prioLabel&&fill)prioFilled++;
      if(v==='Name'&&cell.font&&cell.font.bold)headerBold++;
    });
  });
  ok(statusFilled>0,'Status cells carry a background fill ('+statusFilled+' found)');
  ok(prioFilled>0,'Priority cells carry a background fill ('+prioFilled+' found)');
  ok(headerBold>0,'header rows are bold ('+headerBold+' Name headers)');

  // the fill matches the board's own colour for that status
  const wantStatus='FF'+String(fixture.statusBg).replace('#','').toUpperCase();
  let matched=false;
  ws.eachRow({includeEmpty:false},row=>row.eachCell({includeEmpty:false},cell=>{
    if(String(cell.value)===fixture.statusLabel&&cell.fill&&cell.fill.fgColor&&cell.fill.fgColor.argb===wantStatus)matched=true;
  }));
  ok(matched,'the Status fill is the board\'s own colour for that status ('+wantStatus+')');

  // percentages are numbers with a % format, not text
  let pctCell=null;
  ws.eachRow({includeEmpty:false},row=>row.eachCell({includeEmpty:false},cell=>{
    if(cell.numFmt==='0%'&&typeof cell.value==='number'&&!pctCell)pctCell=cell;
  }));
  ok(!!pctCell,'progress is written as a real percentage'+(pctCell?' ('+Math.round(pctCell.value*100)+'%)':''));

  // the board rolls a parent's progress and timeline up from its subitems; the sheet must agree
  const parentRow=text.find(l=>l.includes('EXPORT Parent Task'))||'';
  ok(parentRow.includes(fixture.rollTimeline),
    'the parent row carries the rolled-up timeline the board shows ("'+fixture.rollTimeline+'")');
  let parentPct=null;
  ws.eachRow({includeEmpty:false},row=>{
    const vals=row.values.map(v=>String(v==null?'':v));
    if(vals.some(v=>v.includes('EXPORT Parent Task')))
      row.eachCell({includeEmpty:false},c=>{if(c.numFmt==='0%'&&typeof c.value==='number')parentPct=Math.round(c.value*100);});
  });
  ok(parentPct===fixture.rollPct,
    'the parent row carries the rolled-up progress ('+parentPct+'% vs board '+fixture.rollPct+'%)');

  // ── the raw XML, because Excel is stricter than any reader ──
  // Excel showed "Repaired Records: View from /xl/worksheets/sheet1.xml part" when the sheet
  // carried <pane state="frozen"/> with no xSplit or ySplit — a freeze that splits nothing.
  // ExcelJS reads such a file back happily, so only the XML catches it.
  const { execSync } = require('child_process');
  const xdir = path.join(OUT,'_unzipped');
  execSync('unzip -o -q "'+file+'" -d "'+xdir+'"');
  const sheetXml = fs.readFileSync(path.join(xdir,'xl','worksheets','sheet1.xml'),'utf8');
  const panes = sheetXml.match(/<pane[^>]*>/g)||[];
  const degenerate = panes.filter(t=>/state="frozen"/.test(t)&&!/[xy]Split="[1-9]/.test(t));
  ok(degenerate.length===0,'no frozen pane without a split'+(degenerate.length?': '+degenerate[0]:''));
  ok(sheetXml.startsWith('<?xml'),'sheet1.xml starts with an XML declaration');
  ok(sheetXml.trim().endsWith('</worksheet>'),'sheet1.xml closes its worksheet element');
  // control characters are illegal in XML 1.0 and are a common cause of a repair prompt
  const badChars=[...sheetXml].filter(ch=>{const c=ch.charCodeAt(0);return c<0x20&&c!==9&&c!==10&&c!==13;});
  ok(badChars.length===0,'no control characters leaked into the sheet ('+badChars.length+')');
  // every fill colour must be the 8-digit ARGB Excel demands
  const fills=(fs.readFileSync(path.join(xdir,'xl','styles.xml'),'utf8').match(/rgb="[^"]*"/g)||[]);
  const badFills=fills.filter(f=>!/^rgb="[0-9A-Fa-f]{8}"$/.test(f));
  ok(badFills.length===0,'every colour is valid 8-digit ARGB'+(badFills.length?': '+badFills[0]:''));

  ok(ws.getColumn(1).width>20,'the name column is given room ('+ws.getColumn(1).width+')');
  ok(errs.length===0,'the export runs without console errors'+(errs.length?': '+errs[0]:''));

  await p.evaluate(()=>{
    const t=DB.tasks.find(x=>x.name==='EXPORT Parent Task');
    if(t){t.name='Service Hydraulic Systems — Crane #2';}
    (DB.tasks||[]).forEach(k=>{if(/^EXPORT Child/.test(k.name||''))k.name=k.name.replace('EXPORT Child','Subitem');});
    saveDB(DB);
  });
  fs.rmSync(OUT,{recursive:true,force:true});
  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  console.log('ERRORS:',errs.length?[...new Set(errs)].slice(0,3):'none');
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('CRASHED',e.message);console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed');process.exit(1)});
