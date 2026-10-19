// Client portal audit, the three major findings (2026-10-19):
//  1. on a phone a Tasks row shows the task's name, with the date under it and any buttons below;
//  2. no text in the portal is below the readable contrast (4.5:1, or 3:1 for large text);
//  3. the task window is a real dialog: named, focus moves in and back, Tab stays inside, Escape closes.
// Seed client General Cranes; own server and temp ISO store, never :3001.
const H = require('./_iso-harness.cjs');

// Runs in the page: every visible text element in `scope` that is below the minimum, worst first.
function lowContrast(scopeSel) {
  const scope = document.querySelector(scopeSel) || document.body;
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => { const layers = []; let e = el; while (e && e.nodeType === 1) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } if (getComputedStyle(e).backgroundImage !== 'none') return null; e = e.parentElement; } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base); return base; };
  const out = []; let seen = 0;
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') || !vis(el)) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    seen++;
    const s = getComputedStyle(el), fg = parse(s.color), bg = bgOf(el);
    if (!fg || !bg) continue;
    const f = fg.a < 1 ? blend(fg, bg) : fg;
    const l1 = lum(f), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(s.fontSize), large = px >= 24 || (px >= 18.66 && +s.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(Math.round(ratio * 100) / 100 + ' ' + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName) + ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '"');
  }
  return { n: seen, bad: out.sort().slice(0, 6) };
}

H.run('portal-audit-test', 3262, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await ui.page.keyboard.press(key); await t.sleep(60); } };
  await ev(() => { currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; launchClientView(); cpNavigate('tasks'); });
  await t.sleep(900);

  // ── 1. Tasks rows ──
  // One task with a name far too long for a phone line, so the row has to wrap it (the sample names all fit on one line).
  const LONG = 'Replace the main hoist wire rope and the sheave assembly on Crane number one before the annual load test and certification inspection';
  await ev(l => { const x = getClientTasks('c1').find(y => !y.parentId); window.__longId = x.id; DB.tasks.find(y => y.id === x.id).title = l; }, LONG);
  await ui.size(390, 844);
  await ev(() => cpNavigate('tasks')); await t.sleep(500);
  const long = await ev(() => {
    const r = [...document.querySelectorAll('#cp-body .cp-task-list-row')].find(x => /Replace the main hoist/.test(x.textContent));
    if (!r) return null;
    const ti = r.querySelector('.cp-tl-title'), lh = parseFloat(getComputedStyle(ti).lineHeight) || 18;
    return { lines: Math.round(ti.getBoundingClientRect().height / lh), clipped: ti.scrollHeight > ti.clientHeight + 1, oneLine: getComputedStyle(ti).whiteSpace === 'nowrap' };
  });
  t.ok(long && !long.oneLine && long.lines === 2 && long.clipped, 'a name too long for a phone wraps to two lines and is cut after that (' + JSON.stringify(long) + ')');
  const phone = await ev(() => {
    const rows = [...document.querySelectorAll('#cp-body .cp-task-list-row')];
    const titles = rows.map(r => r.querySelector('.cp-tl-title')).filter(Boolean);
    const widths = titles.map(x => Math.round(x.getBoundingClientRect().width));
    const cut = titles.filter(x => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).whiteSpace === 'nowrap').length;
    const waiting = rows.find(r => r.querySelector('.cp-tl-actions.has-btn'));
    let below = null, dateUnder = null;
    if (waiting) {
      const tt = waiting.querySelector('.cp-tl-title').getBoundingClientRect(), b = waiting.querySelector('.cp-tl-actions button').getBoundingClientRect();
      below = b.top >= tt.bottom - 1;
      const d = waiting.querySelector('.cp-tl-sub');
      dateUnder = !!d && d.getBoundingClientRect().top >= tt.bottom - 1;
    }
    return { rows: rows.length, min: Math.min(...widths), cut, below, dateUnder, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, hasWaiting: !!waiting };
  });
  t.ok(phone.rows >= 8 && phone.hasWaiting, 'the sample client has task rows and a row waiting on them (' + phone.rows + ' rows)');
  t.ok(phone.min >= 200, 'on a phone every task name gets the width of the row, not a few letters (narrowest ' + phone.min + 'px)');
  t.eq(phone.cut, 0, 'on a phone no task name is cut to an ellipsis on one line');
  t.ok(phone.below === true, 'a row that asks for an answer puts its buttons under the name');
  t.ok(phone.dateUnder === true, 'and the date sits under the name');
  t.eq(phone.overflow, 0, 'the Tasks tab does not scroll sideways on a phone');
  await ui.size(1440, 900);
  await ev(() => cpNavigate('tasks')); await t.sleep(500);
  const desk = await ev(() => {
    const row = document.querySelector('#cp-body .cp-task-list-row .cp-tl-actions.has-btn')?.closest('.cp-task-list-row');
    if (!row) return null;
    const a = row.querySelector('.cp-tl-title').getBoundingClientRect(), b = row.querySelector('.cp-tl-actions button').getBoundingClientRect();
    return { sameLine: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 14, h: Math.round(row.getBoundingClientRect().height) };
  });
  t.ok(desk && desk.sameLine && desk.h < 70, 'on a wide screen a row is still one line, name and buttons side by side (' + JSON.stringify(desk) + ')');

  // ── 2. contrast ──
  const bad = {}, seen = {};
  // each tab is measured only once it has drawn: the Schedule's date axis, the Board's rows, the Tasks rows
  const READY = { overview: '.cp-sum', tasks: '.cp-task-list-row', workboard: '.cp-brow', schedule: '.cpg-head > div > div', requests: '.cp-form-input', notifications: '.cp-empty-text, .cp-notif' };
  for (const s of ['overview', 'tasks', 'workboard', 'schedule', 'requests', 'notifications']) {
    await ev(x => cpNavigate(x), s);
    await ui.page.waitForSelector('#cp-body ' + READY[s].split(', ').join(', #cp-body '), { timeout: 8000 });
    await t.sleep(300);
    const r = await ev(lowContrast, '#client-portal');
    seen[s] = r.n;
    if (r.bad.length) bad[s] = r.bad;
  }
  t.ok(Object.values(seen).every(n => n >= 8) && seen.schedule >= 40, 'every tab had real text on it to measure (' + JSON.stringify(seen) + ')');
  t.ok(Object.keys(bad).length === 0, 'no text on the six portal tabs is below the readable contrast (' + (JSON.stringify(bad).slice(0, 400) || 'none') + ')');
  const tid = await ev(() => (getClientTasks('c1') || [])[0].id);
  await ev(id => cpOpenTaskModal(id), tid); await t.sleep(500);
  const modalM = await ev(lowContrast, '#cp-task-modal');
  t.ok(modalM.n >= 8 && modalM.bad.length === 0, 'nor in the task window (' + modalM.n + ' texts measured; ' + (modalM.bad.join(' | ') || 'none low') + ')');
  await ev(() => cpCloseTaskModal());

  // ── 3. the task window is a dialog ──
  await ev(() => { cpNavigate('tasks'); const r = document.querySelector('#cp-body .cp-task-list-row'); r.focus(); window.__opener = r.getAttribute('data-task-title'); });
  await ev(id => cpOpenTaskModal(id), tid); await t.sleep(400);
  const dlg = await ev(() => {
    const m = document.getElementById('cp-task-modal'), box = m.querySelector('.modal-box'), lab = document.getElementById(box.getAttribute('aria-labelledby') || 'x');
    return { role: box.getAttribute('role'), modal: box.getAttribute('aria-modal'), named: !!lab && lab.textContent.trim().length > 0, inside: m.contains(document.activeElement), overlayTab: m.getAttribute('tabindex'), overlayRole: m.getAttribute('role') };
  });
  t.ok(dlg.role === 'dialog' && dlg.modal === 'true', 'the task window announces itself as a dialog');
  t.ok(dlg.named, 'and is named by its own task title');
  t.ok(dlg.inside, 'focus moves into the window when it opens');
  t.ok(dlg.overlayTab === null && dlg.overlayRole === null, 'the dark backdrop is not a control: no tab stop, no button role');
  const stay = [];
  for (let i = 0; i < 16; i++) { await press('Tab'); stay.push(await ev(() => document.getElementById('cp-task-modal').contains(document.activeElement))); }
  t.ok(stay.every(Boolean), 'Tab never leaves the window, however many times it is pressed');
  await ev(() => { document.querySelector('#cp-task-modal .modal-box').focus(); });
  await ui.page.keyboard.down('Shift'); await press('Tab'); await ui.page.keyboard.up('Shift');
  t.ok(await ev(() => document.getElementById('cp-task-modal').contains(document.activeElement)), 'and Shift+Tab from the top wraps to the bottom, still inside');
  // a dialog on top owns Escape
  await ev(() => openGenericModal('Over the task', '<p>Second dialog</p>', 380)); await t.sleep(300);
  await press('Escape');
  t.ok(await ev(() => !document.getElementById('cp-task-modal').classList.contains('hidden')), 'Escape with another dialog on top does not close the task window beneath');
  await ev(() => closeGenericModal()); await t.sleep(200);
  await ev(() => { document.querySelector('#cp-task-modal .modal-box').focus(); });
  await press('Escape'); await t.sleep(300);
  t.ok(await ev(() => document.getElementById('cp-task-modal').classList.contains('hidden')), 'Escape closes the task window');
  t.eq(await ev(() => (document.activeElement && document.activeElement.getAttribute('data-task-title')) || document.activeElement.className), await ev(() => window.__opener), 'and focus goes back to the row that opened it');
  await ev(id => cpOpenTaskModal(id), tid); await t.sleep(300);
  await ev(() => document.getElementById('cp-task-modal').click()); await t.sleep(300);
  t.ok(await ev(() => document.getElementById('cp-task-modal').classList.contains('hidden')), 'clicking the backdrop still closes it');
});
