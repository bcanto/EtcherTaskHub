// Main Table columns and two Retained Services fixes (2026-10-21, the user): a column added to a board moves and
// resizes like the built-in ones, and an item row's cells follow the header's order (moving a built-in column used to
// move only its header); the retainer's Starts field is a plain list of months; the Retained Services pages fill the
// window like the other pages. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('mt-cols-test', 3273, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const fx = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => !w.archived && DB.tasks.some(x => (x.boardId || x.workboardId) === w.id && !x.parentTaskId && DB.tasks.some(s => s.parentTaskId === x.id && !s.archived)));
    openWorkboard(b.id); await wait(800);
    mtAddCustomCol('text', 'Site Note', 'both'); await wait(300);
    const cc = DB.customColumns.find(c => c.name === 'Site Note' && c.boardId === b.id);
    const parent = DB.tasks.find(x => (x.boardId || x.workboardId) === b.id && !x.parentTaskId && DB.tasks.some(s => s.parentTaskId === x.id && !s.archived));
    return { bid: b.id, cc: cc.id, parent: parent.id };
  });
  const snap = () => ev(() => {
    const ths = [...document.querySelectorAll('.ws-table>thead>tr>th')].map(th => th.dataset.cc ? 'cc' : th.textContent.replace(/[⇅▾+]/g, '').replace(/\s+/g, ' ').trim());
    const row = document.querySelector('.ws-table tr.ws-row');
    const tds = [...row.children].map(td => td.classList.contains('ws-status-cell') ? 'Status' : td.classList.contains('ws-prio-cell') ? 'Priority' : /Site Note/.test(td.title || '') ? 'cc' : '');
    return { status: [ths.indexOf('Status'), tds.indexOf('Status')], prio: [ths.indexOf('Priority'), tds.indexOf('Priority')], cc: [ths.indexOf('cc'), tds.indexOf('cc')], n: [ths.length, tds.length] };
  });

  // An added column has the same handles as the others.
  const h = await ev(id => { const th = document.querySelector(`.ws-table>thead th[data-cc="${id}"]`); return { resize: !!(th && th.querySelector('.col-resize')), drag: th && th.getAttribute('draggable'), grip: !!(th && th.querySelector('.ws-col-grip')), menu: !!(th && th.querySelector('.mt-col-menu-btn')) }; }, fx.cc);
  t.ok(h.resize && h.drag === 'true' && h.grip && h.menu, `an added column can be resized, dragged and still has its menu (got ${JSON.stringify(h)})`);
  // Headings sit in the middle of the header row (the tap-target 32px minimum had held them at the top).
  const mid = await ev(async () => { await new Promise(x => setTimeout(x, 300)); if (typeof _ttEnhance === 'function') _ttEnhance(document.querySelector('.ws-table')); await new Promise(x => setTimeout(x, 200)); return [...document.querySelectorAll('.ws-table>thead>tr>th')].map(th => { const l = th.querySelector('.col-label'); if (!l || !l.firstChild) return null; const rg = document.createRange(); rg.selectNodeContents(l); const a = th.getBoundingClientRect(), b = rg.getBoundingClientRect(); return Math.abs(Math.round((b.top + b.height / 2) - (a.top + a.height / 2))); }).filter(x => x != null); });
  t.ok(mid.length >= 3 && mid.every(d => d <= 1), `the column headings are centred in the header row (got ${JSON.stringify(mid)})`);

  // Moving a built-in column moves its cells too.
  await ev(async () => { _wsDragCol = { grid: 'item', key: 'priority' }; _wsColDrop({ preventDefault() {} }, 'item', 'status'); await new Promise(x => setTimeout(x, 400)); });
  const s1 = await snap();
  t.ok(s1.prio[0] < s1.status[0], `Priority now comes before Status in the header (got ${JSON.stringify(s1)})`);
  t.ok(s1.prio[0] === s1.prio[1] && s1.status[0] === s1.status[1] && s1.n[0] === s1.n[1], `each row's cells sit under their own headings (got ${JSON.stringify(s1)})`);

  // The added column moves between built-in ones, header and cells together, and stays there.
  await ev(async id => { _wsDragCol = { grid: 'item', key: id }; _wsColDrop({ preventDefault() {} }, 'item', 'owner'); await new Promise(x => setTimeout(x, 400)); }, fx.cc);
  const s2 = await snap();
  const ownerAt = await ev(() => [...document.querySelectorAll('.ws-table>thead>tr>th')].findIndex(th => /^Owner/.test(th.textContent.replace(/\s+/g, ' ').trim())));
  t.ok(s2.cc[0] === ownerAt - 1 && s2.cc[0] === s2.cc[1], `the added column moved before Owner, its cells with it (got ${JSON.stringify(s2)}, owner at ${ownerAt})`);
  const kept = await ev(async () => { renderView('workspace'); await new Promise(x => setTimeout(x, 400)); return null; });
  const s3 = await snap();
  t.eq(s3.cc, s2.cc, 'the new place is kept after the board is drawn again');

  // Moving a built-in column onto the added one works too.
  await ev(async id => { _wsDragCol = { grid: 'item', key: 'status' }; _wsColDrop({ preventDefault() {} }, 'item', id); await new Promise(x => setTimeout(x, 400)); }, fx.cc);
  const s4 = await snap();
  t.ok(s4.status[0] === s4.status[1] && s4.cc[0] === s4.cc[1] && s4.prio[0] === s4.prio[1], `a built-in column dropped on the added one keeps every cell under its heading (got ${JSON.stringify(s4)})`);

  // Resizing the added column: the width is kept for that column.
  const rz = await ev(async id => {
    const th = document.querySelector(`.ws-table>thead th[data-cc="${id}"]`), hd = th.querySelector('.col-resize'), r = hd.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2, before = Math.round(th.getBoundingClientRect().width);
    hd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 90, clientY: y }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 90, clientY: y }));
    await new Promise(z => setTimeout(z, 500));
    const th2 = document.querySelector(`.ws-table>thead th[data-cc="${id}"]`);
    return { before, saved: _wsColMetaFor('item').widths[id], after: Math.round(th2.getBoundingClientRect().width) };
  }, fx.cc);
  t.ok(rz.saved && rz.saved > rz.before + 40 && Math.abs(rz.after - rz.saved) <= 2, `dragging the edge widens the added column and keeps the width (got ${JSON.stringify(rz)})`);

  // Subitem grid: an added column moves there as well, cells with it.
  const sub = await ev(async (id, pid) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    wsExpanded.add(pid); renderView('workspace'); await wait(500);
    const grid = () => document.querySelector(`tr.ws-subhost .ws-subtable`);
    const read = () => { const g = grid(); const ths = [...g.querySelectorAll('thead th')].map(th => th.dataset.cc ? 'cc' : th.textContent.replace(/[▾+]/g, '').replace(/\s+/g, ' ').trim()); const row = g.querySelector('tbody tr.ws-subrow2'); const tds = [...row.children].map(td => /Site Note/.test(td.title || '') ? 'cc' : ''); return { h: ths.indexOf('cc'), c: tds.indexOf('cc'), first: ths[2], drag: g.querySelector(`thead th[data-cc="${id}"]`).getAttribute('draggable') }; };
    const before = read();
    const firstKey = (_wsMixCols('sub', SUB_COL_DEFS.filter(c => wsSubColumns[c.key]), []).find(Boolean) || {}).key;
    _wsDragCol = { grid: 'sub', key: id }; _wsColDrop({ preventDefault() {} }, 'sub', firstKey); await wait(400);
    return { before, after: read() };
  }, fx.cc, fx.parent);
  t.ok(sub.before.drag === 'true' && sub.after.h === 2 && sub.after.h === sub.after.c && sub.after.first === 'cc', `in the subitem grid the added column moves first, its cells with it (got ${JSON.stringify(sub)})`);

  // The Excel export uses the board's order, added columns included.
  const xl = await ev(() => new Promise(res => {
    _ensureExcelJs(() => {
      const keep = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      URL.createObjectURL = b => {
        URL.createObjectURL = keep; HTMLAnchorElement.prototype.click = click;
        b.arrayBuffer().then(buf => { const wb = new ExcelJS.Workbook(); return wb.xlsx.load(buf).then(() => wb); }).then(wb => {
          let head = null; wb.worksheets[0].eachRow(r => { const v = (r.values || []).map(x => String(x == null ? '' : (x.richText ? x.richText.map(p => p.text).join('') : x))); if (!head && v.includes('Site Note')) head = v; });
          res(head);
        });
        return 'blob:x';
      };
      wsMtExport();
    });
  }));
  const at = k => (xl || []).findIndex(v => String(v || '').trim() === k);
  t.ok(xl && at('Priority') < at('Site Note') && at('Site Note') < at('Status') && at('Priority') > -1, `the Excel export lists the columns in the board's order (got ${JSON.stringify(xl)})`);

  // ── Retained Services: Starts is a list of months ──
  const st = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c1');
    const sel = document.getElementById('rs-su-start'), out = { tag: sel && sel.tagName, n: sel ? sel.options.length : 0, picked: sel && sel.value, label: sel && sel.selectedOptions[0].textContent, now: [...(sel ? sel.options : [])].find(o => /this month/.test(o.textContent)) ? _rsYm() : null };
    out.native = !!document.querySelector('#generic-modal-body input[type="month"]');
    sel.value = _rsPrevYm(_rsYm()); sel.dispatchEvent(new Event('change')); out.prev = _rsSetup.startMonth;
    _rsSet('startMonth', null, ''); out.blank = _rsSetup.startMonth;
    _rsSet('startMonth', null, 'next week'); out.junk = _rsSetup.startMonth;
    out.next = _rsNextYm(_rsYm()); closeGenericModal(); return out;
  });
  t.ok(st.tag === 'SELECT' && !st.native && st.n === 37, `Starts is a list of months, two years back to a year ahead, not the browser's month picker (got ${JSON.stringify(st)})`);
  t.ok(st.picked === st.next && /^[A-Z][a-z]+ \d{4}$/.test(st.label) && st.now, 'it opens on next month, written out, with this month marked');
  t.ok(st.prev === await ev(() => _rsPrevYm(_rsYm())) && st.blank === st.prev && st.junk === st.prev, 'picking a month sets it; an empty or wrong value changes nothing');

  // ── Retained Services pages fill the window ──
  await ui.size(2200, 1000);
  const wide = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    openRetainerSetup(); _rsSet('clientId', null, 'c1'); _rsSet('bundle', null, 'Core'); retainerCreate(); closeGenericModal(); if (!DB.workboards.some(w => w.retainer && w.clientId === 'c1')) return { dash: [0, 1], mast: [0, 1] };
    const inner = () => { const vc = document.getElementById('view-container'), cs = getComputedStyle(vc); return Math.round(vc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); };
    navigate('retained'); await wait(400); const dash = [Math.round(document.querySelector('.rd').getBoundingClientRect().width), inner()];
    openRetainedClient('c1'); await wait(400); const mast = [Math.round(document.querySelector('.rc-mast').getBoundingClientRect().width), inner()];
    return { dash, mast };
  });
  t.ok(Math.abs(wide.dash[0] - wide.dash[1]) <= 2 && Math.abs(wide.mast[0] - wide.mast[1]) <= 2 && wide.dash[1] > 1800, `on a wide screen the dashboard and the client page use the full width (got ${JSON.stringify(wide)})`);
  await ui.size(1440, 1000);
});
