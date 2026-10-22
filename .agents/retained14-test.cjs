// Retained Services batch 10, from the user's notes (2026-10-22). Tasks keep the order added; IMS counts document
// revisions; squares are empty, half orange in progress, full green done; a service tracks items or hours, with hour
// parts that are monthly or quarterly and count by who logs (senior consultants, else admin) or by tasks tagged
// Audit; set-up and plan edit them; the client page logs hours and who logged them; the server slice matches; staff
// decline a request with a reason; retainer requests come from the portal's Retained tab; with CLIENT_EMAIL_LINK on a
// client login is an email link. Made-up data only. Own server, never :3001.
const H = require('./_iso-harness.cjs');
const P = require('../api/_portal.js');

H.run('retained14-test', 3276, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);

  // ── Order added ──
  const ord = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => !w.archived && !w.retainer && DB.tasks.filter(x => (x.boardId || x.workboardId) === w.id && !x.parentTaskId).length >= 3);
    openWorkboard(b.id); await wait(600);
    const g = DB.groups.find(x => (x.boardId || x.workboardId) === b.id && DB.tasks.filter(t => t.groupId === x.id && !t.parentTaskId && !t.archived).length >= 2);
    const tops = () => DB.tasks.filter(t => t.groupId === g.id && !t.parentTaskId && !t.archived);
    // As if the group had been dragged: orders 0, 1, 2 ...
    tops().forEach((t, i) => { t.order = i; }); saveDB(DB);
    wsStartInlineAdd(g.id, g.id); await wait(200);
    document.getElementById('ws-inline-name').value = 'Added last ' + Date.now(); wsSaveInlineTask(); await wait(300);
    const added = DB.tasks[DB.tasks.length - 1];
    const sec = _wsBuildSections(DB.tasks.filter(t => (t.boardId || t.workboardId) === b.id && !t.parentTaskId && !t.archived)).find(s => s.id === g.id);
    const rows = [...document.querySelectorAll('.ws-table tr.ws-row')].map(r => r.dataset.tid), inGroup = rows.filter(id => tops().some(t => t.id === id));
    return { order: added.order, max: Math.max(...tops().filter(t => t.id !== added.id).map(t => t.order || 0)), lastInSection: sec && sec.tasks[sec.tasks.length - 1].id === added.id, lastOnScreen: inGroup[inGroup.length - 1] === added.id };
  });
  t.ok(ord.order === ord.max + 1 && ord.lastInSection && ord.lastOnScreen, `a new task goes after the last one in its group, also after a drag (got ${JSON.stringify(ord)})`);

  // ── Set-up: hours for HSEQ and CI, a senior consultant ──
  const su = await ev(() => {
    openRetainerSetup(); _rsSet('clientId', null, 'c2'); _rsSet('bundle', null, 'Embedded');
    _rsSet('mode', 'hseq', 'hours'); _rsSet('mode', 'ci', 'hours');
    const seniorId = _rsStaff().find(u => u.id !== currentUser.id).id; _rsSet('senior', null, seniorId);
    const out = { hseqParts: _rsSetup.svc.hseq.parts.map(p => [p.label, p.hours, p.period, p.who]), ci: _rsSetup.svc.ci.parts.map(p => [p.label, p.hours, p.period, p.who]),
      editor: document.querySelectorAll('[data-rs-parts="hseq"] .rs-part').length, sum: document.getElementById('rs-su-summary').textContent.replace(/\s+/g, ' '), hours: (document.getElementById('rs-su-hours') || {}).textContent, seniorId };
    _rsSet('pHours', 'ci', '10', 0); out.ciAdmin = _rsSetup.svc.ci.parts[0].hours;
    _rsSet('pHours', 'ci', '8', 0);
    retainerCreate();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c2' && !w.archived);
    out.board = b.id; out.stored = b.retainer.services.filter(s => s.mode === 'hours').map(s => s.key); out.seniors = b.retainer.seniorIds; out.unit = b.retainer.services.find(s => s.key === 'ims').unit;
    return out;
  });
  t.eq(su.hseqParts, [['HSEQ elements', 5, 'month', 'all'], ['Audits (mini and main)', 8, 'quarter', 'audit']], 'HSEQ in hours: elements 5 h a month, audits 8 h a quarter (tasks tagged Audit)');
  t.eq(su.ci, [['Admin', 8, 'month', 'admin'], ['Senior consult', 3, 'month', 'senior']], 'CI in hours: admin 8 h and senior consult 3 h a month');
  t.ok(su.editor === 2 && su.ciAdmin === 10 && su.hours === '16', `the set-up edits the parts, and the summary adds the monthly hours (got ${su.editor}, ${su.ciAdmin}, ${su.hours})`);
  t.ok(JSON.stringify(su.stored) === '["hseq","ci"]' && JSON.stringify(su.seniors) === JSON.stringify([su.seniorId]) && su.unit === 'document revisions', `the board keeps hours, parts, the senior consultant and counts document revisions (got ${JSON.stringify(su)})`);

  // ── Items: in progress half orange, finished full green ──
  const it = await ev(async bid => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid), ims = b.retainer.services.find(s => s.key === 'ims'), now = new Date().toISOString();
    const mk = (name, status) => { const t = { id: 't' + uid(), name, title: name, boardId: bid, workboardId: bid, groupId: ims.groupId, clientId: 'c2', status, order: 99, archived: false, createdAt: now, updatedAt: now, completedAt: status === 'done' ? now : null }; DB.tasks.push(t); return t; };
    mk('Revise QMS-POL-001', 'done'); mk('Revise QMS-POL-002', 'in-progress'); mk('Revise QMS-POL-003', 'todo'); saveDB(DB);
    openWorkboard(bid); await wait(700);
    const m = [...document.querySelectorAll('.ws-grp-meter')].find(x => /document revisions/.test(x.textContent));
    return { on: m.querySelectorAll('i.on').length, pg: m.querySelectorAll('i.pg').length, text: m.textContent.replace(/\s+/g, ' ').trim(), green: getComputedStyle(m.querySelector('i.on')).backgroundColor };
  }, su.board);
  t.ok(it.on === 1 && it.pg === 1 && /1 of 20 document revisions used, 1 in progress/.test(it.text) && it.green === 'rgb(22, 163, 74)', `finished is a full green square, in progress a half orange one (got ${JSON.stringify(it)})`);

  // ── Hours: parts by who logs, audits by tag over the quarter ──
  const hr = await ev(async (bid, seniorId) => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const b = DB.workboards.find(w => w.id === bid), sv = k => b.retainer.services.find(s => s.key === k), now = new Date().toISOString(), today = toDateStr(new Date());
    const qStart = (() => { const ym = _rsYm(), m = +ym.slice(5, 7), q0 = Math.floor((m - 1) / 3) * 3 + 1; return ym.slice(0, 4) + '-' + String(q0).padStart(2, '0') + '-02'; })();
    const mk = (k, name, tags) => { const t = { id: 't' + uid(), name, title: name, boardId: bid, workboardId: bid, groupId: sv(k).groupId, clientId: 'c2', status: 'in-progress', order: 99, tags: tags || [], archived: false, createdAt: now, updatedAt: now }; DB.tasks.push(t); return t; };
    const te = (task, staffId, hours, date, status) => DB.timeEntries.push({ id: 'te' + uid(), taskId: task.id, clientId: 'c2', staffId, date: date || today, hours, billable: true, status: status || 'submitted', createdAt: now });
    const el = mk('hseq', 'Monthly HSEQ report'), aud = mk('hseq', 'Mini audit', ['Audit']), ci = mk('ci', 'Improvement review');
    te(el, currentUser.id, 2); te(aud, currentUser.id, 3, qStart); te(el, currentUser.id, 5, today, 'rejected');
    te(ci, seniorId, 1.5); te(ci, currentUser.id, 2.5);
    saveDB(DB);
    const u = k => _rsUsage(b, sv(k), _rsYm()).parts.map(p => [p.label, p.used, p.cap]);
    openWorkboard(bid); await wait(700);
    const meters = [...document.querySelectorAll('.ws-grp-meter')].map(m => ({ text: m.textContent.replace(/\s+/g, ' ').trim(), on: m.querySelectorAll('i.on').length, hf: m.querySelectorAll('i.hf').length }));
    return { hseq: u('hseq'), ci: u('ci'), meters };
  }, su.board, su.seniorId);
  t.eq(hr.hseq, [['HSEQ elements', 2, 5], ['Audits (mini and main)', 3, 8]], 'HSEQ: 2 h on elements this month; audit hours (tagged Audit) count over the quarter; rejected hours never count');
  t.eq(hr.ci, [['Admin', 2.5, 8], ['Senior consult', 1.5, 3]], 'CI: the senior consultant\'s hours fill the senior part, everyone else\'s the admin part');
  const sm = hr.meters.find(m => /Senior consult: 1.5 of 3 hours/.test(m.text)), au = hr.meters.find(m => /Audits \(mini and main\): 3 of 8 hours this quarter/.test(m.text));
  t.ok(sm && sm.on === 1 && sm.hf === 1 && au && au.on === 3, `one square an hour, half a square for half an hour (got ${JSON.stringify(hr.meters)})`);

  // ── Plan: switch, edit parts, seniors ──
  const pl = await ev((bid, seniorId) => {
    const b = DB.workboards.find(w => w.id === bid), s = k => b.retainer.services.find(x => x.key === k);
    openRetainerPlan(bid);
    const out = { switches: document.querySelectorAll('.rs-pl-t .rs-track').length, parts: document.querySelectorAll('.rs-pl-t .rs-part').length, seniorBox: !!document.querySelector(`[data-rs-senior="${seniorId}"]:checked`) };
    _rsPlanPart(bid, 'hseq', 'pHours', 0, '6'); out.h = s('hseq').parts[0].hours;
    _rsPlanPart(bid, 'hseq', 'pAdd', 0, ''); out.n = s('hseq').parts.length; _rsPlanPart(bid, 'hseq', 'pRm', 2, ''); out.n2 = s('hseq').parts.length;
    _rsPlanSet(bid, 'mode', 'mob', 'hours'); out.mob = [s('mob').mode, (s('mob').parts || []).length];
    _rsPlanSet(bid, 'mode', 'mob', 'items'); out.mobBack = s('mob').mode || 'items';
    const keep = currentUser.role; currentUser.role = 'staff'; _rsPlanPart(bid, 'hseq', 'pHours', 0, '50'); currentUser.role = keep; out.staffTried = s('hseq').parts[0].hours;
    closeGenericModal(); return out;
  }, su.board, su.seniorId);
  t.ok(pl.switches === 5 && pl.parts === 4 && pl.seniorBox, `the plan shows Track by on every service, the hour parts and the senior consultant (got ${JSON.stringify(pl)})`);
  t.ok(pl.h === 6 && pl.n === 3 && pl.n2 === 2 && pl.mob[0] === 'hours' && pl.mob[1] === 1 && pl.mobBack === 'items' && pl.staffTried === 6, `admins change hours and parts and switch a service; staff cannot (got ${JSON.stringify(pl)})`);

  // ── Client page: the hours log ──
  const log = await ev(() => { openRetainedClient('c2'); const t2 = document.getElementById('rc-hours'); return { rows: t2 ? [...t2.querySelectorAll('tbody tr[data-rc-hour]')].map(r => r.textContent.replace(/\s+/g, ' ').trim()) : [], head: (document.getElementById('rc-hours-h') || {}).textContent || '' }; });
  t.ok(log.rows.length === 4 && log.rows.some(r => /Senior consult/.test(r) && /1.5/.test(r)) && /9 h/.test(log.head) && !log.rows.some(r => /\b5\b.*Rejected/.test(r)), `the client page logs this month's hours, who logged them and what they count to (got ${JSON.stringify(log)})`);

  // ── Server slice matches, and carries no names of who logged ──
  const blob = JSON.parse(await ev(() => JSON.stringify({ users: DB.users, clients: DB.clients.map(c => c.id === 'c2' ? Object.assign({}, c, { portalEnabled: true }) : c), boards: DB.workboards, groups: DB.groups, tasks: DB.tasks, timeEntries: DB.timeEntries })));
  const local = await ev(bid => _rsClientRetainer(DB.workboards.find(w => w.id === bid)).services.map(s => ({ key: s.key, mode: s.mode, prog: s.prog, parts: s.parts.map(p => [p.label, p.used, p.cap, p.period]) })), su.board);
  const slice = P.sliceForClient(blob, 'c2', 'cu2'), rb = slice.boards.find(b => b.id === su.board).retainer;
  const server = rb.services.map(s => ({ key: s.key, mode: s.mode, prog: s.prog, parts: s.parts.map(p => [p.label, p.used, p.cap, p.period]) }));
  t.eq(server, local, 'the portal slice gives the same items, in progress and hour parts as the app');
  t.ok(!/staffId|timeEntries/.test(JSON.stringify(slice)) && !(blob.timeEntries || []).some(e => JSON.stringify(slice).includes(JSON.stringify(e.id))), 'the slice carries hour totals only: no entries, no one who logged them');
  t.ok(P.sliceForClient({ users: [], clients: [{ id: 'c9', portalEnabled: true }], boards: [{ id: 'ob', clientId: 'c9', retainer: { services: [{ key: 'ims', groupId: 'og', unit: 'document reviews', allowance: 5 }] } }], groups: [{ id: 'og', boardId: 'ob' }], tasks: [] }, 'c9', 'u').boards[0].retainer.services[0].unit === 'document revisions', 'a board saved before shows document revisions in the portal');
  t.ok(await ev(() => { const d = { boards: [{ retainer: { services: [{ key: 'ims', unit: 'document reviews' }] } }] }; _migrateDB(d); return d.boards[0].retainer.services[0].unit; }) === 'document revisions', 'and in the app as it loads');

  // ── Requests: decline with a reason ──
  const dec = await ev(() => {
    const now = new Date().toISOString();
    DB.clientWorkRequests = DB.clientWorkRequests || [];
    DB.clientWorkRequests.push({ id: 'wr14', clientId: 'c2', title: 'Rebuild the website', description: '', priority: 'normal', serviceRef: 'adhoc', submittedAt: now, updatedAt: now, status: 'pending', adminNote: null, attachments: [] });
    const host = document.createElement('div'); host.innerHTML = renderWorkRequestCard(DB.clientWorkRequests.find(r => r.id === 'wr14'));
    const out = { btn: !!host.querySelector('[data-wr-decline="wr14"]') };
    wrOpenDecline('wr14'); document.getElementById('wr-decline-go').click();
    out.blankKept = DB.clientWorkRequests.find(r => r.id === 'wr14').status;
    document.getElementById('wr-decline-why').value = 'This is outside the retainer; we can quote it separately.'; document.getElementById('wr-decline-go').click();
    const r = DB.clientWorkRequests.find(x => x.id === 'wr14'); out.status = r.status; out.note = r.adminNote;
    return out;
  });
  t.ok(dec.btn && dec.blankKept === 'pending' && dec.status === 'declined' && /outside the retainer/.test(dec.note || ''), `Decline sits beside Add to Workboard, asks for the reason and sends it to the client (got ${JSON.stringify(dec)})`);

  // ── Email link: with CLIENT_EMAIL_LINK on, a client login is the email only ──
  const link = await ev(async () => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    const keepPrev = window._localClientPreviewAllowed, keepFetch = window.fetch, keepHeaders = window._adminApiAuthHeaders;
    window._clientEmailLink = true; window._localClientPreviewAllowed = () => false; window._adminApiAuthHeaders = async () => ({});
    let sent = null;
    window.fetch = async (u, o) => { if (String(u).includes('/api/invite-user')) { sent = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ id: 'uid-link', existed: false }) }; } return keepFetch(u, o); };
    try {
      const c = DB.clients.find(x => x.id === 'c1'); delete c.supabaseUserId;
      openClientModal('c1'); await wait(200);
      const out = { note: !!document.getElementById('cm-link-note'), pw: !!document.getElementById('cm-pw') };
      document.getElementById('cm-email').value = 'portal@example.test';
      await saveClient('c1'); await wait(300);
      out.sent = sent; out.uid = DB.clients.find(x => x.id === 'c1').supabaseUserId;
      return out;
    } finally { window._clientEmailLink = false; window._localClientPreviewAllowed = keepPrev; window.fetch = keepFetch; window._adminApiAuthHeaders = keepHeaders; }
  });
  t.ok(link.note && !link.pw, `with the switch on, the form asks for the email only and says the client sets their own password (got ${JSON.stringify(link)})`);
  t.ok(link.sent && link.sent.email === 'portal@example.test' && !('password' in link.sent) && link.uid === 'uid-link', 'saving sends the invitation with no password, and the client is linked to its login');
});
