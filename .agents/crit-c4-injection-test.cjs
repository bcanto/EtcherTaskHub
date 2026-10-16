// C4 (audit 2026-10-17): stored script injection between staff. Text one person types must never run as
// code in another person's browser. Every text field of every record gets a payload that fires a marker if
// it is parsed as HTML; every view, panel and modal is then opened, and the sinks that need a gesture
// (mention list, share-link manager, quote number, links) are driven by hand. Own server, in memory only.
const H = require('./_static-offline.cjs');
const { SEED } = require('./_xss-seed.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const VIEWS = [['dashboard'], ['my-week'], ['notifications'], ['clients'], ['staff'], ['time'], ['reports'], ['audit'], ['archive'], ['notes'], ['quotes'], ['schedule'], ['digest'],
  ['workspace', 'b1'], ['board', 'b1'], ['list', 'b1'], ['gantt', 'b1'], ['capacity', 'b1']];
const OPEN = [
  ...['details', 'subtasks', 'dependencies', 'notes', 'activity', 'recurrence'].map(tab => [`task panel ${tab}`, `openTaskPanel(window.__probe.t);tpShowTab('${tab}')`]),
  ['task panel (custom status)', `openTaskPanel(window.__probe.t2)`], ['task modal', `openTaskModal(window.__probe.t)`], ['new task modal', `openTaskModal(null,'')`],
  ['client modal', `openClientModal('c1')`], ['staff modal', `openStaffModal('u2')`], ['time entry modal', `openEditTimeEntry(DB.timeEntries[0].id)`],
  ['digest detail', `openDigestDetail(DB.digests[0].id)`], ['new digest', `openCreateDigest()`], ['add group', `openAddGroupModal()`], ['board share', `openBoardShareModal('b1')`],
  ['work request add', `wrOpenAddModal('wr1')`], ['quote editor', `quoteCurrentId='q1';navigate('quotes')`], ['invoice editor', `rptTab='invoice';pfiCurrentId='pfi1';navigate('reports')`],
  ['timesheet report', `rptTab='timesheet';pfiCurrentId=null;navigate('reports')`], ['comms panel', `openWorkboard('b1');wsOpenComms()`],
];

(async () => {
  const srv = await H.serve(3203);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3203/');
    await p.evaluate(SEED);
    const drain = () => p.evaluate(() => { const r = [...window.__xh]; window.__xh = new Set(); return r; });
    const close = () => p.evaluate(() => { try { closeGenericModal(); closeConfirm(); closeTaskPanel(); if (typeof closeTaskModal === 'function') closeTaskModal(); } catch (e) {} });

    // ── Everything on screen with hostile text in every field ──
    const fired = [];
    for (const [v, board] of VIEWS) {
      await close();
      await p.evaluate(async (v, board) => { if (board && (!currentWorkboard || currentWorkboard.id !== board)) openWorkboard(board); navigate(v); await new Promise(r => setTimeout(r, 250)); }, v, board);
      fired.push(...(await drain()).map(f => 'view ' + v + ': ' + f));
    }
    for (const [name, code] of OPEN) {
      await close();
      const err = await p.evaluate(async code => { try { (0, eval)(code); } catch (e) { return e.message; } await new Promise(r => setTimeout(r, 350)); return null; }, code);
      if (err) fail.push('could not open "' + name + '": ' + err);
      fired.push(...(await drain()).map(f => name + ': ' + f));
    }
    ok(fired.length === 0, VIEWS.length + ' views and ' + OPEN.length + ' panels and modals render hostile text as text (ran as code: ' + JSON.stringify([...new Set(fired.map(f => f.split(': ').pop().replace(/:(tag|attr|js|rc)$/, '')))].slice(0, 8)) + ')');
    if (fired.length) fail.push('where: ' + JSON.stringify([...new Set(fired)].slice(0, 10)));

    // ── Sinks that need a gesture ──
    await close();
    const mention = await p.evaluate(async () => {
      const u3 = DB.users.find(x => x.id === 'u3'); u3.name = `Zed"onmouseover="__x('mention:attr')" data-x='__x("mention:js")`;
      openTaskPanel(window.__probe.t); await new Promise(r => setTimeout(r, 300));
      const inp = document.getElementById('tp-comment-input'); inp.value = '@zed'; inp.setSelectionRange(4, 4); tpMentionCheck(inp);
      const item = document.querySelector('#tp-mention-dropdown [data-mention-idx]');
      const out = { found: !!item, onclick: item && item.getAttribute('onclick'), dataName: item && item.dataset.name, extraHandlers: item ? [...item.attributes].map(a => a.name).filter(n => /^on/.test(n) && n !== 'onclick' && n !== 'onmouseover' && n !== 'onmouseout') : [], mouseover: item && item.getAttribute('onmouseover') };
      if (item) item.click();
      out.inserted = inp.value;
      out.name = u3.name;
      return out;
    });
    ok(mention.found && mention.onclick === 'tpMentionInsert(this.dataset.name)' && mention.dataName === mention.name && mention.extraHandlers.length === 0 && !/__x/.test(mention.mouseover || ''), 'the @mention list passes a staff name as data, not inside the handler (' + JSON.stringify({ onclick: mention.onclick, extra: mention.extraHandlers }) + ')');
    ok(mention.inserted === '@' + mention.name + ' ', 'picking a mention inserts the name exactly as typed, quotes and all');
    ok((await drain()).length === 0, 'a staff name with quotes in it runs nothing from the @mention list');

    const share = await p.evaluate(async () => {
      await new Promise(r => setTimeout(r, 100));
      const boardName = window.__P('board.share');
      DB.boards.find(x => x.id === 'b1').name = boardName;
      openWorkboard('b1'); navigate('workspace'); await new Promise(r => setTimeout(r, 300));
      const btn = document.querySelector('button[data-label][onclick^="openShareLinkManager"]');
      const out = { btn: !!btn, onclick: btn && btn.getAttribute('onclick'), dataLabel: btn && btn.dataset.label };
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 200));
      const gen = [...document.querySelectorAll('#generic-modal-body button')].find(x => /Generate share link/.test(x.textContent));
      out.gen = !!gen; out.genOnclick = gen && gen.getAttribute('onclick');
      DB.shareLinks = [];
      if (gen) gen.click();
      await new Promise(r => setTimeout(r, 200));
      out.link = DB.shareLinks[0] ? DB.shareLinks[0].label : null; out.boardName = boardName;
      return out;
    });
    ok(share.btn && share.onclick === "openShareLinkManager('workboard','b1',this.dataset.label)" && share.dataLabel === share.boardName, 'the share-link button carries the board name as data, not in the handler');
    ok(share.gen && share.link === share.boardName && !/__x|<img/.test(share.genOnclick || ''), 'Generate share link stores the exact board name as the link label and runs nothing');
    ok((await drain()).length === 0, 'a board name with markup in it runs nothing from the share-link manager');

    const quote = await p.evaluate(async () => {
      DB.quotes[0].number = window.__P('quote.number2'); quoteCurrentId = 'q1'; navigate('quotes'); await new Promise(r => setTimeout(r, 300));
      const inp = document.getElementById('quote-number-input');
      const out = { onblur: inp.getAttribute('onblur') };
      inp.value = ''; inp.dispatchEvent(new Event('blur'));
      out.after = DB.quotes[0].number;
      return out;
    });
    ok(!/quote\.number|<img|__x/.test(quote.onblur) && quote.after.includes('quote.number2'), 'the quote number box falls back to its own value, not a copy written into the handler');
    ok((await drain()).length === 0, 'a quote number with markup in it runs nothing when the box loses focus');

    // ── Links ──
    const links = await p.evaluate(async () => {
      const out = {};
      DB.scheduleEvents.forEach(e => { e.teamsLink = 'javascript:__x("teams:js")'; });
      schedSetView('list'); navigate('schedule'); schedSetView('list'); await new Promise(r => setTimeout(r, 300));
      const a = [...document.querySelectorAll('#view-container a')].filter(x => /Join/.test(x.textContent));
      out.teamsCount = a.length; out.teamsHrefs = [...new Set(a.map(x => x.getAttribute('href')))];
      out.helper = ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'https://example.com/a?b=1&c="2"', 'mailto:a@b.co', 'www.example.com'].map(u => _safeHref(u));
      return out;
    });
    ok(links.teamsCount > 0 && links.teamsHrefs.length === 1 && links.teamsHrefs[0] === '#', 'a calendar event\'s javascript: Teams link is not followed (' + JSON.stringify(links.teamsHrefs) + ')');
    ok(links.helper[0] === '#' && links.helper[1] === '#' && links.helper[2] === '#' && links.helper[3] === '#' && links.helper[4] === '#', 'javascript:, data: and vbscript: addresses are refused, with case and hidden characters ignored');
    ok(links.helper[5] === 'https://example.com/a?b=1&amp;c=&quot;2&quot;' && links.helper[6] === 'mailto:a@b.co' && links.helper[7] === 'www.example.com', 'ordinary links pass through, escaped (' + JSON.stringify(links.helper.slice(5)) + ')');

    // ── Labels and colours: what every badge reads from ──
    const meta = await p.evaluate(() => {
      DB.labelConfig.statuses.cst_ok = { label: "Waiting on Bob's reply & Q&A <2d", color: '#123456', bg: '#abcdef', dot: '#123456' };
      DB.labelConfig.statuses.cst_bad = { label: 'x', color: 'red;" onmouseover="__x(1)', bg: 'url(javascript:1)', dot: '"><img src=x>' };
      DB.labelConfig.statuses["cst_');alert(1);//"] = { label: 'evil key' };
      DB.labelConfig.priorities.cp_bad = { label: '<b>hi</b>', icon: '<img src=x onerror=__x(2)>', cls: '" onclick="__x(3)' };
      const ok1 = getStatusMeta('cst_ok'), bad = getStatusMeta('cst_bad'), unknown = getStatusMeta('<img src=x onerror=__x(4)>'), prio = getPrioMeta('cp_bad');
      return { ok1, bad, unknown: unknown.label, prio, keys: getAllStatuses().filter(k => /cst_/.test(k)), builtin: getStatusMeta('in-progress').label, builtinPrio: getPrioMeta('high') };
    });
    ok(/^[^<>"'`]*$/.test(meta.ok1.label) && meta.ok1.label.includes('Bob’s reply') && meta.ok1.label.includes('Q&A') && meta.ok1.color === '#123456' && meta.ok1.bg === '#abcdef', 'a custom label keeps its words (apostrophe becomes a curly one) and its colours (' + meta.ok1.label + ')');
    ok(meta.bad.color === '#64748b' && meta.bad.bg === '#f1f5f9' && meta.bad.dot === '#94a3b8', 'a colour that is not a colour falls back to the default');
    ok(!/[<>"'`]/.test(meta.unknown), 'a status key that is markup is shown as plain text');
    ok(!/[<>]/.test(meta.prio.label) && meta.prio.icon === '●' && meta.prio.cls === 'prio-med', 'a custom priority cannot change its icon or class (' + JSON.stringify({ i: meta.prio.icon, c: meta.prio.cls }) + ')');
    ok(meta.keys.includes('cst_ok') && !meta.keys.some(k => /[');]/.test(k)), 'a custom status key that is not a plain key is not offered');
    ok(meta.builtin === 'In Progress' && meta.builtinPrio.label === 'High' && meta.builtinPrio.icon === '▲', 'built-in statuses and priorities are unchanged');
    ok((await drain()).length === 0, 'nothing ran while checking labels');

    // ── Staff text elsewhere: a name with markup in the avatar, owner list and dates ──
    const misc = await p.evaluate(() => ({
      avatar: avatarHtml({ initials: '<img src=x onerror=__x(5)>', color: 'red;" x="' }, 20),
      date: formatDate('<img src=x onerror=__x(6)>-x-y'), dateOk: formatDate('2026-10-17'), dateEmpty: formatDate(''),
    }));
    ok(!/<img/.test(misc.avatar) && /background:#64748b/.test(misc.avatar), 'avatar initials are text and a bad colour falls back');
    ok(!/<img/.test(misc.date) && misc.dateOk === '17/10/2026' && misc.dateEmpty === '—', 'a date that is markup is shown as text; real dates are unchanged');
    ok(errors.length === 0, 'no page errors or native dialogs (' + errors.slice(0, 2).join(' | ') + ')');
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('crit-c4-injection-test', pass, fail); }
})();
