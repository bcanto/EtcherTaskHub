// The client portal in the approved concept's look (2026-10-15): the month at a glance, two-column Overview
// with recent activity, answers straight from Waiting on you, Tasks rows with Engagement and With, Request
// Work in two columns, and every page fitting a phone. Seed client General Cranes; own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('portal-look-test', 3182, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  await ev(() => {
    DB.notifications = DB.notifications || [];
    DB.notifications.push({ id: 'n-look-1', recipientId: 'c1', taskId: null, type: 'work_request', message: 'Your request is in scope: SWMS register', read: false, createdAt: new Date().toISOString() });
    currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' };
    launchClientView(); cpNavigate('overview');
  });
  await t.sleep(800);
  const ov = await ev(() => {
    const sum = document.querySelector('.cp-sum'), cols = [...document.querySelectorAll('.cp-ov2 > .cp-col')];
    return {
      month: sum && sum.querySelector('h1') ? sum.querySelector('h1').textContent : '',
      ring: !!document.querySelector('#cp-body .cp-band-ring, #cp-body svg circle[stroke-dasharray]'),
      cells: document.querySelectorAll('.cp-sum .cp-band-cell').length,
      twoCols: cols.length === 2 && cols[0].getBoundingClientRect().width > 0 && cols[1].getBoundingClientRect().left > cols[0].getBoundingClientRect().left,
      recent: [...document.querySelectorAll('#cp-body .cp-sec')].some(s => /Recent activity/.test(s.textContent) && /SWMS register/.test(s.textContent)),
      engRows: document.querySelectorAll('#cp-body button.cp-eng').length,
      signOff: [...document.querySelectorAll('#cp-attn .cp-btn.sign')].length,
      needW: (document.querySelector('#cp-attn .cp-need-t') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
    };
  });
  t.ok(new RegExp(new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })).test(ov.month), 'the Overview opens with the month at a glance');
  t.ok(!ov.ring && ov.cells === 4, 'four plain counts, no progress ring');
  t.ok(ov.twoCols, 'Overview is two columns on a wide screen');
  t.ok(ov.recent, 'recent activity lists the client\'s notifications');
  t.ok(ov.engRows >= 1, 'each engagement is one quiet row');
  t.ok(ov.signOff >= 1, 'a sign-off can be given straight from Waiting on you');
  t.ok(ov.needW > 200, 'a waiting task title gets the row width, not the old 3px accent bar (' + Math.round(ov.needW) + 'px)');
  const shotOv = await ui.shot('portal-look-overview');
  t.eq(shotOv.phone, 0, 'the Overview fits a phone');
  // The summary clips its own overflow, so check each count is actually on screen at phone width.
  await ui.size(390, 844);
  const offscreen = await ev(() => [...document.querySelectorAll('.cp-sum .cp-band-cell')].filter(c => c.getBoundingClientRect().right > window.innerWidth + 1).length);
  await ui.size(1440, 1000);
  t.eq(offscreen, 0, 'all four counts are on screen on a phone');

  await ev(() => cpNavigate('tasks')); await t.sleep(400);
  const tk = await ev(() => { const r = document.querySelector('#cp-body .cp-task-list-row .cp-tl-meta'); return r ? { eng: r.querySelector('.cp-tl-eng').textContent, who: r.querySelector('.cp-tl-who').textContent } : null; });
  t.ok(tk && tk.eng.length > 0 && tk.who.length > 0, 'task rows show the engagement and who has it');
  const shotTk = await ui.shot('portal-look-tasks');
  t.eq(shotTk.phone, 0, 'Tasks fits a phone');

  await ev(() => cpNavigate('requests')); await t.sleep(400);
  const rq = await ev(() => { const cols = [...document.querySelectorAll('.cp-req2 > .cp-col')]; return { two: cols.length === 2 && cols[1].getBoundingClientRect().left > cols[0].getBoundingClientRect().left, after: /After you send it/.test(document.getElementById('cp-body').textContent), form: !!document.getElementById('cp-req-title') && !!document.getElementById('cp-req-desc') }; });
  t.ok(rq.two && rq.after && rq.form, 'Request Work: the form beside the client\'s requests and what happens next');
  const shotRq = await ui.shot('portal-look-request');
  t.eq(shotRq.phone, 0, 'Request Work fits a phone');
});
