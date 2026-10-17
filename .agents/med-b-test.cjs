// Audit medium batch B (2026-10-17): M2 Clients screen, M12 notifications, M14 Client Notes on a phone, M15 keyboard
// access, M16 small logo. Runs the real app in a browser on its own server (never :3001).
const path = require('path'), fs = require('fs'), http = require('http');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3242;
const get = u => new Promise((res, rej) => http.get(u, r => { const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(ch) })); }).on('error', rej));

(async () => {
  const srv = await H.serve(PORT), b = await H.launch();
  try {
    // ── M16 ──
    const logo = await get('http://127.0.0.1:' + PORT + '/etcher-logo-white-520.png'), fav = await get('http://127.0.0.1:' + PORT + '/favicon-128.png');
    const html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
    ok(logo.status === 200 && logo.body.length < 30 * 1024 && fav.status === 200 && fav.body.length < 30 * 1024, 'M16: the logo and favicon the page loads are under 30 KB (' + logo.body.length + ' and ' + fav.body.length + ' bytes)');
    ok(/<link rel="preload" href="etcher-logo-white-520\.png"/.test(html) && !/src="Etcher White Logo\.png"/.test(html) && /id="app-favicon"[^>]*href="favicon-128\.png"/.test(html), 'M16: the page preloads and shows the small logo, and uses the small favicon');

    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const T = '2026-10-10T09:00:00.000Z';

    // ── M2: Clients screen ──
    await p.evaluate(T => {
      const g = (id, cid) => DB.groups.push({ id, name: 'G ' + id, clientId: cid, boardId: DB.boards[0].id, order: 9, createdAt: T, updatedAt: T });
      DB.clients.push({ id: 'cAlpha', name: 'Alpha Archived', shortCode: 'AAR', color: '#336699', archived: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: T });
      DB.clients.push({ id: 'cBeta', name: 'Beta Builders', shortCode: 'BBL', color: '#993366', archived: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: T });
      DB.clients.push({ id: 'cZeta', name: 'Zeta Zinc', shortCode: 'ZZN', color: '#669933', archived: false, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: T });
      g('gBeta', 'cBeta'); g('gZeta', 'cZeta');
      const mk = (id, gid, status, archived) => DB.tasks.push({ id, name: 'T ' + id, groupId: gid, boardId: DB.boards[0].id, status, priority: 'med', archived: !!archived, createdAt: T, updatedAt: T });
      mk('tb1', 'gBeta', 'todo'); mk('tb2', 'gBeta', 'done'); mk('tb3', 'gBeta', 'completed'); mk('tb4', 'gBeta', 'completed-approved'); mk('tb5', 'gBeta', 'cancelled'); mk('tb6', 'gBeta', 'in-progress', true);
      ['tz1', 'tz2', 'tz3'].forEach(i => mk(i, 'gZeta', 'in-progress'));
      navigate('clients');
    }, T);
    const cardOf = name => p.evaluate(name => { const card = [...document.querySelectorAll('#clients-grid > div > div')].find(d => d.innerText.includes(name)); return card ? card.innerText.replace(/\s+/g, ' ') : null; }, name);
    const beta = await cardOf('Beta Builders');
    ok(!!beta && /\b1 Open\b/i.test(beta.replace(/(\d+)\s*Open/i, '$1 Open')) && /\b3 Done\b/i.test(beta.replace(/(\d+)\s*Done/i, '$1 Done')), 'M2: counts treat completed, approved and cancelled work as not open (' + (beta || '').slice(0, 120) + ')');
    ok(!(await cardOf('Alpha Archived')), 'M2: archived clients are hidden by default');
    await p.evaluate(() => { const i = document.getElementById('clients-search'); i.focus(); i.value = 'zin'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await H.sleep(350);
    const s1 = await p.evaluate(() => ({ cards: [...document.querySelectorAll('#clients-grid > div > div')].map(d => d.innerText.split('\n')[0]).join('|'), focus: document.activeElement && document.activeElement.id, grid: document.getElementById('clients-grid').innerText }));
    ok(/Zeta Zinc/.test(s1.grid) && !/Beta Builders/.test(s1.grid) && s1.focus === 'clients-search', 'M2: search filters by name, code or email, and typing keeps the cursor in the box (' + s1.focus + ')');
    await p.evaluate(() => { const i = document.getElementById('clients-search'); i.value = 'bbl'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await H.sleep(350);
    ok(await p.evaluate(() => /Beta Builders/.test(document.getElementById('clients-grid').innerText) && !/Zeta/.test(document.getElementById('clients-grid').innerText)), 'M2: search finds a client by its short code');
    await p.evaluate(() => { const i = document.getElementById('clients-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await H.sleep(350);
    const order = await p.evaluate(() => { const sel = document.getElementById('clients-sort'); sel.value = 'open'; sel.dispatchEvent(new Event('change', { bubbles: true })); const names = [...document.querySelectorAll('#clients-grid > div > div')].map(d => d.innerText); return names.findIndex(t => t.includes('Zeta Zinc')) < names.findIndex(t => t.includes('Beta Builders')); });
    ok(order, 'M2: sorting by most open work puts the busiest client first');
    const arch = await p.evaluate(() => {
      clientSetArchived('cBeta', true);
      const hidden = !/Beta Builders/.test(document.getElementById('clients-grid').innerText);
      const cb = document.getElementById('clients-show-archived'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
      const shown = /Beta Builders/.test(document.getElementById('clients-grid').innerText) && /Archived/.test(document.getElementById('clients-grid').innerText);
      clientSetArchived('cBeta', false);
      const c = DB.clients.find(x => x.id === 'cBeta');
      return { hidden, shown, restored: c.archived === false, stamped: !!c.updatedAt && c.updatedAt > '2026-10-10T09:00:00.000Z', stillThere: !!c };
    });
    ok(arch.hidden && arch.shown && arch.restored && arch.stamped && arch.stillThere, 'M2: Archive hides a client without deleting anything, Show archived lists it, Restore brings it back (' + JSON.stringify(arch) + ')');

    // ── M12: notifications ──
    const m12 = await p.evaluate(async T => {
      window.__mails = []; window._adminApiAuthHeaders = async () => ({});
      const realFetch = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('/api/notify-email')) { window.__mails.push(JSON.parse(o.body)); return Promise.resolve(new Response('{}')); } return realFetch(u, o); };
      DB.users.push({ id: 'uGone', name: 'Gone Person', email: 'gone@etcher.test', role: 'staff', active: false, createdAt: T });
      DB.users.push({ id: 'uMail', name: 'Mail Person', email: 'mail@etcher.test', role: 'staff', active: true, createdAt: T });
      DB.boards.push({ id: 'bPriv', name: 'Private', visibility: 'private', ownerId: 'u1', archived: false, createdAt: T, updatedAt: T });
      DB.tasks.push({ id: 'tPriv', name: 'Private task', boardId: 'bPriv', status: 'todo', priority: 'med', createdAt: T, updatedAt: T });
      const open = DB.tasks.find(t => !t.archived && t.boardId === DB.boards[0].id);
      const n0 = DB.notifications.length;
      notify('uGone', open.id, 'task_assigned', 'x');
      const goneAdded = DB.notifications.length - n0;
      notify('uMail', 'tPriv', 'task_assigned', 'secret');
      const privAdded = DB.notifications.length - n0 - goneAdded;
      notify('uMail', open.id, 'task_assigned', 'Task assigned to you: one');
      notify('uMail', open.id, 'mention', 'You were mentioned: two');
      notify('uMail', open.id, 'task_assigned', 'Task assigned to you: three');
      const inApp = DB.notifications.length - n0;
      const immediate = window.__mails.length;
      await new Promise(r => setTimeout(r, 2400));
      const batch = window.__mails.slice();
      window.__mails = [];
      notify('uMail', open.id, 'task_assigned', 'A'.repeat(450));
      await new Promise(r => setTimeout(r, 2400));
      const long = window.__mails.slice();
      window.__mails = [];
      notify('uMail', open.id, 'currently_with', 'Task is now with you: solo');
      await new Promise(r => setTimeout(r, 2400));
      const single = window.__mails.slice();
      window.fetch = realFetch;
      return { goneAdded, privAdded, inApp, immediate, batch, long: long.map(m => m.message.length), single };
    }, T);
    ok(m12.goneAdded === 0, 'M12: someone who has left gets no notification');
    ok(m12.privAdded === 0, 'M12: nobody is notified about a task they cannot open');
    ok(m12.inApp === 3 && m12.immediate === 0 && m12.batch.length === 1 && /^3 updates in Task Hub\. First: Task assigned to you: one\. Open Task Hub to see the other 2\.$/.test(m12.batch[0].message) && m12.batch[0].to === 'mail@etcher.test',
      'M12: three notifications in a row are three in the app but one email (' + JSON.stringify(m12.batch.map(m => m.message)) + ')');
    ok(m12.long.length === 1 && m12.long[0] <= 300, 'M12: a long message is cut to what the email service accepts (' + m12.long + ')');
    ok(m12.single.length === 1 && m12.single[0].message === 'Task is now with you: solo' && m12.single[0].type === 'currently_with', 'M12: a single notification still sends its own email unchanged');

    // ── M15: keyboard access ──
    const views = ['dashboard', 'workspace', 'board', 'gantt', 'schedule', 'capacity', 'time', 'reports', 'digest', 'clients', 'notes', 'staff'];
    const counts = {};
    for (const v of views) {
      const c = await p.evaluate(async v => {
        try { if (v === 'workspace' || v === 'board' || v === 'gantt') { if (typeof openWorkboard === 'function') openWorkboard(DB.boards[0].id); } navigate(v); } catch (e) { return 'err ' + e.message; }
        await new Promise(r => setTimeout(r, 250));
        const nat = 'a,button,input,select,textarea,label,summary,option,iframe,[contenteditable="true"]';
        const left = [...document.querySelectorAll('#view-container [onclick]')].filter(el => !el.matches(nat) && !el.hasAttribute('tabindex') && !/^\s*(event|e)\.stopPropagation\(\)\s*;?\s*$/.test(el.getAttribute('onclick') || '') && !el.querySelector(nat));
        const unlabelled = [...document.querySelectorAll('#view-container input[placeholder]:not([type=hidden])')].filter(i => !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !(i.id && document.querySelector('label[for="' + i.id + '"]')));
        return left.length + unlabelled.length;
      }, v);
      counts[v] = c;
    }
    ok(Object.values(counts).every(n => n === 0), 'M15: on every screen, every clickable area can be reached with the keyboard and every placeholder-only input has a name (' + JSON.stringify(counts) + ')');
    const kb = await p.evaluate(async () => {
      navigate('dashboard'); await new Promise(r => setTimeout(r, 200));
      const item = document.querySelector('.nav-item[onclick*="navigate(\'clients\')"]') || document.querySelector('.nav-item[data-view="clients"]');
      if (!item) return { found: false };
      return { found: true, role: item.getAttribute('role'), tab: item.getAttribute('tabindex') };
    });
    ok(kb.found && kb.role === 'button' && kb.tab === '0', 'M15: sidebar items are buttons with a tab stop (' + JSON.stringify(kb) + ')');
    await p.focus('.nav-item[data-view="clients"]').catch(() => {});
    await p.keyboard.press('Enter');
    await H.sleep(300);
    ok(await p.evaluate(() => currentView) === 'clients', 'M15: Enter on a focused sidebar item opens that screen');
    await p.evaluate(() => navigate('dashboard')); await H.sleep(200);
    await p.focus('.nav-item[data-view="clients"]').catch(() => {});
    await p.keyboard.press('Space');
    await H.sleep(300);
    ok(await p.evaluate(() => currentView) === 'clients', 'M15: Space does the same');

    // ── M14: Client Notes on a phone ──
    await p.setViewport({ width: 390, height: 844 });
    const m14 = await p.evaluate(async () => {
      DB.clientNotes = DB.clientNotes || [];
      const c = DB.clients.find(x => !x.archived);
      if (!DB.clientNotes.some(n => n.clientId === c.id)) DB.clientNotes.push({ clientId: c.id, sections: [{ id: 'nsPhone', title: 'Phone test', body: 'A note body that should be readable on a phone.', updatedAt: new Date().toISOString() }] });
      selectedNoteClientId = c.id; selectedNoteSectionId = DB.clientNotes.find(n => n.clientId === c.id).sections[0].id;
      navigate('notes'); await new Promise(r => setTimeout(r, 300));
      const ed = document.querySelector('.notes-editor'), pane = document.getElementById('notes-pane');
      return { over: document.documentElement.scrollWidth - window.innerWidth, paneOver: pane ? pane.scrollWidth - pane.clientWidth : -1, editorW: ed ? Math.round(ed.getBoundingClientRect().width) : 0 };
    });
    ok(m14.over <= 1 && m14.paneOver <= 1 && m14.editorW >= 330, 'M14: at phone width Client Notes has no sideways overflow and the note uses the full width (' + JSON.stringify(m14) + ')');
    await p.setViewport({ width: 1440, height: 900 });

    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('med-b-test', pass, fail);
})();
