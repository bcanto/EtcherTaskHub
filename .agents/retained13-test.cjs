// Retained Services: the training matrix after the user's audit (2026-10-22). It fills the width; Import, the new
// training column and the template sit together at the top right; headings are readable and count who holds each
// training and what is expired or due; a summary and the key sit above the table; a cell with no training shows a
// mark; people come most urgent first (or by name); a training a renewal task is handling carries a mark, in the
// matrix and the Expiring list. Made-up people only. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained13-test', 3275, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  await ui.size(1520, 900);
  await ev(async () => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Light'); retainerCreate(); closeGenericModal();
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); _rsSet('bundle', null, 'Embedded'); retainerCreate(); closeGenericModal();
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };
    const P = (ref, surname, first, quals) => ({ ref, surname, first, full: '', position: 'Rigger', location: 'Perth', employment: '', company: '', note: '', quals });
    _regApply('c2', { kind: 'training', quals: ['White Card', 'First Aid', 'Working at Heights', 'Driver Licence'], rows: [
      P('A2', 'BAKER', 'Jordan', { 'White Card': { d: day(460) }, 'First Aid': { d: day(260) }, 'Working at Heights': { d: day(176) }, 'Driver Licence': { d: day(740) } }),
      P('A5', 'EVANS', 'Sam', { 'White Card': { d: day(202) }, 'First Aid': { d: day(14) }, 'Driver Licence': { d: day(633) } }),
      P('A1', 'ADAMS', 'Alex', { 'White Card': { d: day(230) }, 'Working at Heights': { t: 'Yes' }, 'Driver Licence': { d: day(36) } }),
      P('A4', 'DAVIS', 'Riley', { 'White Card': { d: day(-22) }, 'First Aid': { t: 'No expiry' }, 'Driver Licence': { d: day(357) } }),
      P('A3', 'CLARK', 'Casey', { 'White Card': { t: 'No expiry' }, 'First Aid': { d: day(95) }, 'Driver Licence': { d: day(-41) } }),
    ] }, false, 'matrix.xlsx');
    regAddRenewalTasks('c2', [DB.registerPeople.find(p => p.surname === 'CLARK' && p.clientId === 'c2').id]);
    navigate('retained'); await new Promise(x => setTimeout(x, 300));
    window.__dashOrder = [...document.querySelectorAll('#rd-clients tbody tr')].map(r => r.textContent.replace(/s+/g, ' ').trim().slice(0, 14));
    openRegisters('c2', 'training'); _regSet('mode', 'matrix'); await new Promise(x => setTimeout(x, 400));
  });
  const m = await ev(() => {
    const q = s => document.querySelector(s), r = s => q(s).getBoundingClientRect();
    const io = r('.reg-io'), tpl = r('#reg-template');
    return {
      table: Math.round(r('#reg-matrix').width), wrap: Math.round(q('.reg-mx-wrap').clientWidth),
      rightGap: Math.round(io.right - tpl.right), addColInIo: !!q('.reg-io #reg-add-col'), addColInFilters: !!q('.reg-fl #reg-add-col'),
      heads: [...document.querySelectorAll('#reg-matrix thead th')].slice(1).map(th => [th.querySelector('.reg-mx-n').textContent, th.querySelector('.reg-mx-t').textContent]),
      headSize: parseFloat(getComputedStyle(q('#reg-matrix thead th .reg-mx-n')).fontSize),
      sum: q('#reg-mx-sum').textContent, keyAbove: r('#reg-key').bottom <= r('.reg-mx-wrap').top, keyItems: [...document.querySelectorAll('#reg-key li')].map(l => l.textContent.trim()),
      order: [...document.querySelectorAll('#reg-matrix tbody th b')].map(b => b.textContent), orderSel: q('#reg-order').value, dash: window.__dashOrder,
      notHeld: (q('#reg-matrix .reg-c.empty') || {}).getAttribute ? q('#reg-matrix .reg-c.empty').getAttribute('aria-label') : '',
      notHeldMark: (cs => cs.content !== 'none' && cs.width === '12px')(getComputedStyle(q('#reg-matrix .reg-c.empty'), '::before')),
      ren: [...document.querySelectorAll('#reg-matrix .reg-c.ren')].map(c => c.closest('tr').querySelector('th b').textContent + '|' + c.dataset.q + '|' + c.title),
    };
  });
  t.ok(m.table === m.wrap && m.table > 1000, `the matrix fills the width (got ${m.table} of ${m.wrap})`);
  t.ok(m.rightGap <= 1 && m.addColInIo && !m.addColInFilters, `Import, + Training column and the template sit together at the right (got gap ${m.rightGap})`);
  t.eq(m.heads, [['White Card', '5 of 5 held, 1 expired'], ['First Aid', '4 of 5 held, 1 due'], ['Working at Heights', '2 of 5 held'], ['Driver Licence', '5 of 5 held, 1 expired, 1 due']], 'each heading counts who holds the training and what is expired or due');
  t.ok(m.headSize >= 12, `headings are readable (got ${m.headSize}px)`);
  t.ok(/^5 people, 2 expired, 2 due within 90 days, 1 with a renewal task\.$/.test(m.sum) && m.keyAbove, `a summary and the key sit above the table (got "${m.sum}")`);
  t.eq(m.keyItems, ['Expired', 'Within 30 days', 'Within 90 days', 'Not held', 'Renewal task', 'Comments'], 'the key names every mark');
  t.ok(m.orderSel === 'added' && JSON.stringify(m.order) === JSON.stringify(['Jordan BAKER', 'Sam EVANS', 'Alex ADAMS', 'Riley DAVIS', 'Casey CLARK']), `people stay in the order they were added, not by name (got ${m.orderSel}, ${JSON.stringify(m.order)})`);
  t.ok(/General Cran/.test(m.dash[0] || '') && /Daltech/.test(m.dash[1] || ''), `the dashboard lists clients in the order their boards were added, not by name or tier (got ${JSON.stringify(m.dash)})`);
  t.ok(/not held/.test(m.notHeld) && m.notHeldMark === true, `a cell with no training says so and shows a mark (got "${m.notHeld}", ${m.notHeldMark})`);
  t.ok(m.ren.length === 1 && /^Casey CLARK\|Driver Licence\|.*Renewal task: Not Started/.test(m.ren[0]), `the training a renewal task is handling carries the mark (got ${JSON.stringify(m.ren)})`);

  const urgent = await ev(() => { document.getElementById('reg-order').value = 'urgent'; document.getElementById('reg-order').dispatchEvent(new Event('change')); return [...document.querySelectorAll('#reg-matrix tbody th b')].map(b => b.textContent); });
  t.eq(urgent, ['Casey CLARK', 'Riley DAVIS', 'Sam EVANS', 'Alex ADAMS', 'Jordan BAKER'], 'Most urgent first: the longest expired, then the soonest due, then the rest');
  t.eq(await ev(() => [...document.querySelectorAll('#reg-order option')].map(o => o.textContent)), ['Order added', 'Most urgent first'], 'the order choices: as added, or most urgent first (never by name)');
  const one = await ev(() => { _regSet('qual', 'First Aid'); const o = [...document.querySelectorAll('#reg-matrix tbody th b')].map(b => b.textContent); _regSet('qual', ''); _regSet('order', 'added'); return o; });
  t.eq(one.slice(0, 2), ['Sam EVANS', 'Casey CLARK'], 'with one training picked, urgency follows that training');

  const exp = await ev(() => { _regSet('mode', 'expiring'); return [...document.querySelectorAll('#reg-expiring tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()); });
  t.ok(exp.some(r => /Casey CLARK.*Driver Licence.*Renewal task not started/.test(r)) && !exp.some(r => /Riley DAVIS.*Renewal task/.test(r)), `the Expiring list says where a renewal task is in hand (got ${JSON.stringify(exp)})`);
  const done = await ev(() => {
    const tk = DB.tasks.find(x => x.registerPersonId && x.clientId === 'c2'); tk.status = 'done'; tk.completedAt = new Date().toISOString(); saveDB(DB);
    _regSet('mode', 'matrix'); const c = document.querySelector('#reg-matrix .reg-c.ren'); return c ? c.title : '';
  });
  t.ok(/Renewed, update the matrix/.test(done), `a finished renewal says the matrix needs updating (got "${done}")`);
  const shot = await ui.shot('retained13-matrix');
  t.eq(shot.phone, 0, 'the matrix fits a phone');
});
