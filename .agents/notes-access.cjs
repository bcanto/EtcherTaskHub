const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1400,height:900}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR: '+e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,1800));
  }
  const pass=[],fail=[];const ok=(c,m)=>c?pass.push(m):fail.push(m);

  const probe=async(role)=>{
    return p.evaluate((role)=>{
      currentUser.role=role;
      applyRolePermissions();
      const navEl=document.getElementById('nav-notes-item');
      const navShown=navEl&&getComputedStyle(navEl).display!=='none';
      const blocked=_acBlockedViews(currentUser).has('notes')||_acBlockedViews(currentUser).has('*');
      navigate('notes');
      const vc=document.getElementById('view-container');
      const denied=/Access Restricted/.test(vc.textContent);
      const hasEditor=!!vc.querySelector('#notes-pane, .notes-editor');
      return {navShown:!!navShown, blockedByAc:blocked, viewDenied:denied, rendersNotesUI:hasEditor};
    },role);
  };

  const staff=await probe('staff');
  console.log('STAFF   ',JSON.stringify(staff));
  ok(staff.navShown,'staff: Client Notes nav item visible');
  ok(!staff.blockedByAc,'staff: notes not in blocked views');
  ok(!staff.viewDenied&&staff.rendersNotesUI,'staff: Client Notes view renders (not access-denied)');

  const restricted=await probe('restricted');
  console.log('RESTRICT',JSON.stringify(restricted));
  ok(!restricted.navShown,'restricted: Client Notes nav item hidden');
  ok(restricted.blockedByAc,'restricted: notes still blocked');
  ok(restricted.viewDenied,'restricted: Client Notes view still access-denied');

  const client=await probe('client');
  console.log('CLIENT  ',JSON.stringify(client));
  ok(!client.navShown&&client.viewDenied,'client: still no access');

  const admin=await probe('admin');
  ok(admin.navShown&&!admin.viewDenied,'admin: unchanged, full access');

  console.log('\nPASS ('+pass.length+'):');pass.forEach(m=>console.log('  + '+m));
  console.log('FAIL ('+fail.length+'):');fail.forEach(m=>console.log('  - '+m));
  await b.close();
  process.exit(fail.length?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
