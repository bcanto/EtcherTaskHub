// Retained Services, next features batch 4 (2026-10-21): registers. Each retained client's document register and
// training matrix, imported from Excel through the real file picker (fixtures shaped like the client spreadsheets the
// user shared, every row made up), with a preview, re-import that keeps comments, review and expiry states, filters,
// the matrix, comments, templates for both, dashboard warnings, and personal details never stored. Staff only.
// Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');
const F = require('./_reg-fixtures.cjs');
const ExcelJS = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/exceljs');
const fs = require('fs'), os = require('os'), path = require('path');

H.run('retained7-test', 3267, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-test-'));
  const docsFile = await F.docRegister(path.join(dir, 'Doc Register.xlsx'));
  const trnFile = await F.trainingMatrix(path.join(dir, 'Qualification Matrix.xlsx'));
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const pick = async (kind, file) => {
    await ev(k => openRegisterImport('c1', k), kind); await t.sleep(250);
    const input = await ui.page.$('#reg-file'); await input.uploadFile(file);
    for (let i = 0; i < 60; i++) { await t.sleep(200); if (await ev(() => !!document.getElementById('reg-imp-res') || !!document.getElementById('reg-imp-err'))) break; }
    return ev(() => (document.getElementById('reg-imp-out') || {}).textContent.replace(/\s+/g, ' '));
  };

  await ev(() => { openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Core'); retainerCreate(); closeGenericModal(); navigate('retained'); });
  await t.sleep(400);
  t.ok(await ev(() => !!document.querySelector('[data-rd-reg="c1"]')), 'each retained client has an Open button on the dashboard');
  await ev(() => { document.querySelector('[data-rd-reg="c1"]').click(); _regSet('tab', 'docs'); }); await t.sleep(300);
  t.ok(await ev(() => !!document.getElementById('reg-empty') && /No document register yet/.test(document.getElementById('reg-empty').textContent)), 'an empty register explains what to import');

  // ── Document register ──
  const pv = await pick('docs', docsFile);
  t.ok(/Read 8 documents from the sheet "Doc Register", headings on row 2/.test(pv), `the preview finds the headings below the client's coloured rule (got "${pv.slice(0, 120)}")`);
  t.ok(/Imported: File Name, Issue \/ Created Date, Review Every \(Months\), Expiry \/ Next Review Date, Notes/.test(pv) && /Left out: Date Basis, Days to Expiry, Review Status, Why This Period/.test(pv),
    'it reads the four register fields and the notes, and says which columns it leaves out');
  t.ok(/the issue date "sometime soon" is not a date/.test(pv) && /no file name, so it was left out/.test(pv), 'problems are listed by row');
  t.ok(/8 new\./.test(pv), 'and what the import will do');
  await ev(() => _regImportConfirm()); await t.sleep(400);
  const docs = await ev(() => DB.registerDocs.filter(d => d.clientId === 'c1').map(d => ({ code: d.code, title: d.title, issue: d.issueDate, months: d.reviewMonths, next: d.nextReview, note: d.note })));
  const by = c => docs.find(d => d.code === c) || {};
  t.ok(by('QMS-POL-001').title === 'Quality Policy' && by('QMS-POL-001').months === 12 && /review and reissue/.test(by('QMS-POL-001').note), 'the code and title are split, the period and note kept');
  const exp = await ev(() => { const d = new Date(); d.setDate(d.getDate() - 30); const iso = toDateStr(d); return { issue: iso, next: _regAddMonths(iso, 24) }; });
  t.ok(by('OPS-CHK-001').issue === exp.issue && by('OPS-CHK-001').next === exp.next, `a blank next review date is worked out from a typed issue date and the period (got ${by('OPS-CHK-001').issue}, ${by('OPS-CHK-001').next})`);
  t.ok(docs.some(d => d.title === 'Visitor Sign-in Form' && d.months === 12 && !d.code), '"annual" is read as 12 months; a name without a code still imports');
  t.ok(by('OPS-CHK-002').issue === null && by('OPS-CHK-002').next === null, 'a row with a bad date imports with no date rather than a wrong one');

  const pg = await ev(() => {
    const st = k => (document.querySelector(`[data-reg-st="${k}"] b`) || {}).textContent;
    const rows = () => [...document.querySelectorAll('#reg-docs tbody tr[data-reg-doc]')];
    const out = { counts: ['', 'over', 'd30', 'd60', 'd90', 'ok', 'none'].map(st), first: rows()[0] && rows()[0].textContent.replace(/\s+/g, ' ') };
    _regSet('st', 'over'); out.over = rows().length;
    _regSet('st', ''); _regSet('series', 'WHS-PRO'); out.series = rows().map(r => r.querySelector('.reg-code').textContent);
    _regSet('series', ''); _regView.q = 'complaints'; renderView('retained'); out.q = rows().length; _regView.q = ''; renderView('retained');
    return out;
  });
  t.eq(pg.counts, ['8', '1', '1', '1', '1', '3', '1'], 'status counts: overdue, within 30, 60 and 90 days, current, no date');
  t.ok(/QMS-POL-001/.test(pg.first) && /Overdue/.test(pg.first) && /35 days ago/.test(pg.first), `the most overdue document comes first, with how long (got "${pg.first}")`);
  t.ok(pg.over === 1 && JSON.stringify(pg.series) === '["WHS-PRO-001","WHS-PRO-002"]' && pg.q === 1, 'filter by status, by series (from the code) and by search');
  const shotDocs = await ui.shot('retained7-docs');
  t.eq(shotDocs.phone, 0, 'the document register fits a phone');

  // Comments on a document survive a re-import, which archives what the new file leaves out.
  await ev(() => { const d = DB.registerDocs.find(x => x.code === 'QMS-POL-001'); _regOpenDoc(d.id); document.getElementById('reg-cm-text').value = 'Sent to the client for review on 20 October.'; _regCommentSubmit(d.clientId); });
  await t.sleep(200);
  const firstId = await ev(() => DB.registerDocs.find(x => x.code === 'QMS-POL-001').id);
  const docs2 = await F.docRegister(path.join(dir, 'Doc Register v2.xlsx'), { rows: [
    ['QMS-POL-001 - Quality Policy', new Date(Date.UTC(2026, 9, 15)), 'Issue date (register)', 12, '', '', '', '', 'Reissued'],
    ['QMS-POL-002 - Customer Complaints Policy', new Date(Date.UTC(2025, 10, 15)), '', 12, '', '', '', '', ''],
    ['QMS-POL-003 - Supplier Selection Policy', new Date(Date.UTC(2026, 8, 1)), '', 24, '', '', '', '', ''],
  ] });
  const pv2 = await pick('docs', docs2);
  t.ok(/1 new, 1 updated, 1 unchanged/.test(pv2) && /Archive the 6 documents not in this file/.test(pv2), `a re-import says what is new, what changed, what did not, and what the file leaves out (got "${pv2.slice(-260)}")`);
  await ev(() => _regImportConfirm()); await t.sleep(300);
  const re = await ev(id => {
    const d = DB.registerDocs.find(x => x.id === id), act = DB.registerDocs.filter(x => x.clientId === 'c1' && !x.archived).map(x => x.code);
    return { same: !!d, issue: d && d.issueDate, next: d && d.nextReview, cms: _regComments('doc', id).map(c => c.text), act };
  }, firstId);
  t.ok(re.same && re.issue === '2026-10-15' && re.next === '2027-10-15', 'the document is matched by its code and updated in place');
  t.eq(re.cms, ['Sent to the client for review on 20 October.'], 'its comment stays with it');
  t.eq(re.act.slice().sort(), ['QMS-POL-001', 'QMS-POL-002', 'QMS-POL-003'], 'documents not in the new file are archived');
  await pick('docs', docsFile);
  // The old file lacks QMS-POL-003: untick Archive to keep it, and every archived document comes back.
  const back = await ev(() => { const box = document.getElementById('reg-imp-archive'); if (box) box.checked = false; _regImportConfirm(); return { box: !!box, n: DB.registerDocs.filter(x => x.clientId === 'c1' && !x.archived).length }; });
  t.ok(back.box && back.n === 9, `importing the old file again brings the archived documents back (got ${back.n} active)`);

  // ── Training matrix ──
  await ev(() => openRegisters('c1', 'training')); await t.sleep(200);
  const tv = await pick('training', trnFile);
  t.ok(/Read 4 people from the sheet "Qualifications", headings on row 1, 8 training columns/.test(tv), `the preview reads people and training columns (got "${tv.slice(0, 140)}")`);
  t.ok(/Personal details, not imported: DOB, PHONE, EMAIL, DL, CLASS, HRWL #/.test(tv), 'date of birth, phone, email and licence numbers are refused, by name');
  await ev(() => _regImportConfirm()); await t.sleep(300);
  const ppl = await ev(() => ({ json: JSON.stringify(DB.registerPeople) + JSON.stringify(DB.registers), people: DB.registerPeople.filter(p => p.clientId === 'c1').map(p => ({ ref: p.ref, n: _regPersonName(p), pos: p.position, loc: p.location, q: p.quals })) }));
  t.ok(!/example\.invalid|0400 000|X10000|WL 000002|1980|1975|10\/5\/199/.test(ppl.json), 'no personal detail is stored anywhere');
  const alex = ppl.people.find(p => p.n === 'Alex EXAMPLE') || { q: {} }, jordan = ppl.people.find(p => p.n === 'Jordan SAMPLE') || { q: {} }, riley = ppl.people.find(p => p.n === 'Riley PLACEHOLDER') || { q: {} };
  t.ok(alex.ref === '9000001' && alex.pos === 'Cleaner' && alex.loc === 'FIFO - PERTH', 'the ID, position and location are kept');
  t.ok(alex.q.DL && alex.q.DL.d && !alex.q['DL EXPIRY'] && jordan.q.HRWL, '"DL EXPIRY" and "HRWL EXPIRY" become the DL and HRWL records');
  const states = await ev(q => ({ heat: _regQualState(q.alex['Heat Stress Prevention Measures']).k, wc: _regQualState(q.jordan['White Card']).k, wcLabel: _regQualState(q.jordan['White Card']).label, booked: _regQualState(q.riley['Site Essentials 12345']), na: 'N/A' in (q.casey || {}) }),
    { alex: alex.q, jordan: jordan.q, riley: riley.q, casey: (ppl.people.find(p => p.n === 'Casey DEMO') || {}).q });
  t.ok(states.heat === 'noexp' && states.wc === 'held' && states.wcLabel === 'Yes' && states.booked.k === 'held' && /Booked/.test(states.booked.label), 'a date decades out reads No expiry; "Yes" and other words read as held');
  t.ok(!jordan.q['4WD'] || jordan.q['4WD'].d, 'a dated cell stays a date');
  const tr = await ev(() => {
    const rows = () => [...document.querySelectorAll('#reg-expiring tbody tr[data-reg-exp]')].map(r => r.textContent.replace(/\s+/g, ' '));
    const out = { exp90: rows() };
    _regSet('win', 'exp'); out.exp = rows();
    _regSet('win', 'all'); _regSet('loc', 'KARRATHA'); out.kar = rows().every(r => /KARRATHA/.test(r)) && rows().length > 0;
    _regSet('loc', ''); _regSet('qual', 'White Card'); out.wc = rows();
    _regSet('qual', ''); _regSet('win', '90'); _regSet('mode', 'matrix');
    const mx = document.getElementById('reg-matrix');
    out.cols = [...mx.querySelectorAll('thead th')].map(th => th.textContent.trim());
    out.cells = mx.querySelectorAll('.reg-c:not(.empty)').length; out.empty = mx.querySelectorAll('button.reg-c.empty').length; out.expCells = mx.querySelectorAll('.reg-c.exp').length; out.expShape = mx.querySelectorAll('.reg-c.exp .rq-ic').length;
    _regSet('dueOnly', true); out.due = [...document.querySelectorAll('#reg-matrix thead th')].map(th => th.textContent.trim());
    _regSet('dueOnly', false);
    return out;
  });
  t.ok(tr.exp90.length === 9 && /Alex EXAMPLE.*White Card.*Expired/.test(tr.exp90[0]), `Expiring lists what has expired or expires within 90 days, oldest first (got ${tr.exp90.length}: "${(tr.exp90[0] || '').slice(0, 80)}")`);
  t.ok(tr.exp.length === 4 && tr.exp.every(r => /Expired/.test(r)), 'Expired only');
  t.ok(tr.kar, 'filter by location');
  t.ok(tr.wc.length === 2 && tr.wc.every(r => /White Card/.test(r)), 'filter by training');
  t.eq(tr.cols, ['Person', 'DL', 'HRWL', 'Site Essentials 12345', 'Isolation Theory: Lock Holder', 'Heat Stress Prevention Measures', 'Working at Heights Gap Training', 'White Card', '4WD'], 'the matrix keeps the spreadsheet\'s column order');
  t.ok(tr.cells === 15 && tr.empty === 17 && tr.expCells === 4 && tr.expShape === 4, `each record is a cell; expired cells carry the triangle as well as the colour (got ${tr.cells}, ${tr.expCells}, ${tr.expShape})`);
  t.ok(!tr.due.includes('Isolation Theory: Lock Holder') && !tr.due.includes('Heat Stress Prevention Measures') && tr.due.includes('White Card'), 'Only training due within 90 days narrows the columns');
  const shotMx = await ui.shot('retained7-matrix');
  t.eq(shotMx.phone, 0, 'the matrix scrolls inside its own box on a phone');

  // Odd columns and cells: a __proto__ heading is never a training, a plain number is not a date, a date may carry a time.
  const edge = await ev(() => {
    const XL = window.XLSX, ws = XL.utils.aoa_to_sheet([['Surname', 'First Name', '__proto__', 'Induction No', 'First Aid'], ['EDGE', 'Pat', 46000, 12345, '15/09/2027 00:00']]);
    const p = _regParseTraining({ SheetNames: ['S'], Sheets: { S: ws } }), r = p.rows[0];
    return { quals: p.quals, proto: Object.getPrototypeOf(r.quals) === Object.prototype, ind: r.quals['Induction No'], fa: r.quals['First Aid'],
      text: [_regParseDateText('15/9/25 3:45 pm'), _regParseDateText('2025-09-15T00:00:00'), _regParseDateText('31/02/2025')] };
  });
  t.ok(!edge.quals.includes('__proto__') && edge.proto, 'a column headed __proto__ is never a training and cannot reach the record');
  t.ok(edge.ind && edge.ind.t === '12345' && !edge.ind.d, `a plain number in a training column stays text, not a 1933 date (got ${JSON.stringify(edge.ind)})`);
  t.ok(edge.fa && edge.fa.d === '2027-09-15', 'a typed date with a time on it still reads');
  t.eq(edge.text, ['2025-09-15', '2025-09-15', null], 'dates typed with a time or in ISO form read; an impossible date does not');

  // Comments on a person, about one training; deleting is the author's or an admin's.
  const cm = await ev(() => {
    const p = DB.registerPeople.find(x => x.surname === 'EXAMPLE');
    _regOpenPerson(p.id, 'White Card');
    const focused = !!(document.activeElement && document.activeElement.classList.contains('reg-dr-x'));
    // The matrix keeps its place when a comment redraws the page (its scroll box is drawn anew each time).
    const vc = document.getElementById('view-container'), vkeep = vc.style.maxWidth;
    vc.style.maxWidth = '520px'; const w0 = document.querySelector('.reg-mx-wrap'); w0.scrollLeft = 150; const before = w0.scrollLeft;
    const about = document.getElementById('reg-cm-about').value;
    document.getElementById('reg-cm-text').value = 'Booked into the White Card course on 4 November.'; _regCommentSubmit(p.clientId);
    const after = document.querySelector('.reg-mx-wrap').scrollLeft; vc.style.maxWidth = vkeep;
    const c = _regComments('person', p.id)[0];
    renderView('retained');
    const dot = !!document.querySelector(`#reg-matrix tr[data-reg-person="${p.id}"] .reg-c[data-q="White Card"] .reg-dot`);
    (DB.registerComments).push({ id: 'rc-other', clientId: p.clientId, kind: 'person', rowId: p.id, qual: null, text: 'Someone else wrote this', by: 'u2', at: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const keep = currentUser.role; currentUser.role = 'staff';
    const staffDel = regDeleteComment('rc-other'); currentUser.role = keep;
    const adminDel = regDeleteComment('rc-other');
    _regDrawerRender();
    const panel = document.getElementById('reg-drawer').textContent.replace(/\s+/g, ' ');
    return { about, qual: c && c.qual, dot, staffDel, adminDel, panel, focused, before, after };
  });
  t.ok(cm.focused, 'the panel takes focus when it opens');
  t.ok(cm.before > 0 && cm.after === cm.before, `adding a comment keeps the matrix scrolled where it was (got ${cm.before} then ${cm.after})`);
  t.ok(cm.about === 'White Card' && cm.qual === 'White Card', 'a comment from a cell is about that training');
  t.ok(cm.dot, 'the cell shows it has a comment');
  t.ok(!cm.staffDel && cm.adminDel, 'staff cannot delete someone else\'s comment; an admin can');
  t.ok(/About White Card/.test(cm.panel) && /Booked into the White Card course/.test(cm.panel) && !/Someone else wrote this/.test(cm.panel), 'the panel lists the comments, with what each is about');
  const esc = await ev(() => { document.getElementById('reg-cm-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return !document.getElementById('reg-drawer'); });
  t.ok(esc, 'Escape closes the panel');

  // A person matched by ID; two people with one name but different IDs stay two.
  const tr2 = await F.trainingMatrix(path.join(dir, 'Qualification Matrix v2.xlsx'), { rows: [
    ['9000001', 'EXAMPLE', 'Alexander', '', '', '', 'Casual', 'Team Leader', 'FIFO - PERTH', '', '', '', '', '', '', '', '', '', '', new Date(Date.UTC(2027, 0, 1)), ''],
    ['9000777', 'TWIN', 'Sam', '', '', '', 'Casual', 'Cleaner', 'PERTH', '', '', '', '', '', '', '', '', '', '', new Date(Date.UTC(2027, 0, 1)), ''],
    ['9000778', 'TWIN', 'Sam', '', '', '', 'Casual', 'Cleaner', 'PERTH', '', '', '', '', '', '', '', '', '', '', new Date(Date.UTC(2027, 0, 1)), ''],
    ['', 'PLACEHOLDER', 'Riley', '', '', '', 'Casual', 'Cleaner', 'TOM PRICE', '', '', '', '', '', '', '', '', '', '', new Date(Date.UTC(2027, 0, 1)), ''],
  ] });
  const tv2 = await pick('training', tr2);
  const arch = await ev(() => { const b = document.getElementById('reg-imp-archive'); if (b) b.checked = false; _regImportConfirm();
    const act = DB.registerPeople.filter(p => p.clientId === 'c1' && !p.archived);
    const alex = DB.registerPeople.find(p => p.ref === '9000001');
    return { n: act.length, twins: act.filter(p => p.surname === 'TWIN').length, alex: alex && alex.first, alexCm: alex ? _regComments('person', alex.id).length : 0, riley: DB.registerPeople.filter(p => p.surname === 'PLACEHOLDER').length };
  });
  t.ok(/2 new, 2 updated/.test(tv2), `re-import: matched by ID, and by name when there is none (got "${tv2.slice(-200)}")`);
  t.ok(arch.alex === 'Alexander' && arch.alexCm === 1 && arch.riley === 1, 'a renamed person keeps their ID match and their comments');
  t.ok(arch.twins === 2, 'two people with the same name and different IDs stay two people');
  t.eq(arch.n, 6, 'unticking Archive keeps the people the file leaves out');

  // ── Dashboard warnings, the boundary, client deletion ──
  const dash = await ev(() => {
    _rdHome(); renderView('retained');
    const li = id => (document.getElementById(id) || {}).textContent || '';
    return { d: li('rd-att-regd-c1').replace(/\s+/g, ' '), t: li('rd-att-regt-c1').replace(/\s+/g, ' '), col: (document.querySelector('#rd-clients tr[data-rd-client="c1"] .rd-c-reg') || {}).textContent || '' };
  });
  t.ok(/2 documents are due for review with no task yet \(1 overdue\)/.test(dash.d), `the dashboard flags documents due for review with no task (got "${dash.d}")`);
  t.ok(/(person has|people have) training expired or expiring with no renewal task yet/.test(dash.t) && /with expired training/.test(dash.t), `and people with expired or expiring training and no renewal task (got "${dash.t}")`);
  t.ok(/Documents: 2 need a review task/.test(dash.col) && /Training: \d+ expired/.test(dash.col), 'the Clients sheet shows each register\'s state');
  const blob = await ev(() => ({ users: DB.users, clients: DB.clients, boards: DB.workboards, groups: DB.groups, tasks: DB.tasks, registerDocs: DB.registerDocs, registerPeople: DB.registerPeople, registerComments: DB.registerComments, registers: DB.registers }));
  const slice = JSON.stringify(P.sliceForClient(blob, 'c1', 'cu1'));
  t.ok(slice.length > 200 && !/registerDocs|registerPeople|registerComments|Quality Policy|White Card course|Sent to the client for review|9000001|FIFO - PERTH/.test(slice), 'the client portal slice carries none of it');
  const del = await ev(() => {
    const lo = _clientLeftovers('c1'), text = lo.text;
    _removeClientLeftovers('c1');
    const left = ['registerDocs', 'registerPeople', 'registerComments', 'registers'].map(k => (DB[k] || []).filter(x => x.clientId === 'c1').length);
    const merged = _mergeDB({ deletedClientIds: ['c1'], registerDocs: [] }, { registerDocs: [{ id: 'x', clientId: 'c1', updatedAt: 'z' }], registerComments: [{ id: 'y', clientId: 'c1', updatedAt: 'z' }] });
    return { text, left, back: (merged.registerDocs || []).length + (merged.registerComments || []).length };
  });
  t.ok(/document register and training matrix will be deleted/.test(del.text), `deleting the client says its registers go too (got "${del.text}")`);
  t.eq(del.left, [0, 0, 0, 0], 'and they go');
  t.eq(del.back, 0, 'an older copy merging in never brings them back');

  // ── Templates: built in the page, read back here, and the filled-in template imports cleanly ──
  const tpl = await ev(() => new Promise(res => _ensureExcelJs(() => Promise.all(['docs', 'training'].map(k => _regTemplateBuild(k))).then(bufs => res(bufs.map(b => { const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }))))));
  const rdWb = async b64 => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(b64, 'base64')); return wb; };
  const [wbD, wbT] = [await rdWb(tpl[0]), await rdWb(tpl[1])];
  const heads = ws => ws.getRow(1).values.filter(Boolean);
  t.eq(heads(wbD.getWorksheet('Document register')), ['File Name', 'Issue Date', 'Review Every (Months)', 'Next Review Date', 'Notes'], 'the document template has the importer\'s columns');
  t.ok(heads(wbT.getWorksheet('Training matrix')).slice(0, 7).join('|') === 'ID|Surname|First Name|Position|Location|Employment Status|Company' && !heads(wbT.getWorksheet('Training matrix')).some(h => /DOB|Phone|Email/i.test(h)), 'the training template asks for no personal details');
  t.ok(!!wbD.getWorksheet('How to fill it in') && !!wbT.getWorksheet('How to fill it in'), 'both come with a how-to sheet');
  t.ok(wbD.getWorksheet('Document register').getCell('B2').numFmt === 'dd/mm/yyyy' && wbD.getWorksheet('Document register').getCell('C2').dataValidation.type === 'whole', 'dates are formatted and the review period is checked');
  const wsD = wbD.getWorksheet('Document register');
  wsD.getRow(2).values = ['ABC-POL-001 - Test Policy', new Date(Date.UTC(2026, 0, 10)), 12, null, 'From the template'];
  const filled = path.join(dir, 'Filled template.xlsx'); await wbD.xlsx.writeFile(filled);
  await ev(() => openRegisters('c2', 'docs'));
  const pvT = await ev(() => { openRegisterImport('c2', 'docs'); return true; });
  const input = await ui.page.$('#reg-file'); await input.uploadFile(filled);
  for (let i = 0; i < 60; i++) { await t.sleep(200); if (await ev(() => !!document.getElementById('reg-imp-res'))) break; }
  const tplTxt = await ev(() => { const s = document.getElementById('reg-imp-out').textContent.replace(/\s+/g, ' '); _regImportConfirm(); return s; });
  const tplDoc = await ev(() => (DB.registerDocs.find(d => d.clientId === 'c2' && d.code === 'ABC-POL-001') || {}).nextReview || null);
  t.ok(pvT && /Read 1 document/.test(tplTxt) && !/things? to check/.test(tplTxt) && tplDoc === '2027-01-10', `a filled-in template imports with nothing to check (got "${tplTxt.slice(0, 100)}", next review ${tplDoc})`);
});
