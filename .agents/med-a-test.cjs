// Audit medium batch A (2026-10-17): M1 client delete leftovers, M3 pm role, M4 sign-in linking, M6 quote number,
// M7 upload-state removed, M9 calendar events, M11 approved entry re-check, M13 custom label delete, M17 comment delete.
// Runs the real handlers in a browser on its own server (never :3001).
const path = require('path'), fs = require('fs');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3241;

(async () => {
  ok(!fs.existsSync(path.join(H.ROOT, 'api', 'upload-state.js')), 'M7: the endpoint that overwrote the whole record is gone');
  const srv = await H.serve(PORT), b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const T = '2026-10-10T09:00:00.000Z';
    const confirmYes = () => p.evaluate(() => document.getElementById('confirm-ok-btn').click());
    const confirmShown = () => p.evaluate(() => !document.getElementById('confirm-modal').classList.contains('hidden') ? document.getElementById('confirm-msg').textContent : null);
    const alertText = () => p.evaluate(() => { const m = document.getElementById('alert-modal'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\s+/g, ' ') : ''; });
    const dismiss = () => p.evaluate(() => { if (typeof closeAlert === 'function') closeAlert(); if (typeof closeConfirm === 'function') closeConfirm(); if (typeof closeGenericModal === 'function') closeGenericModal(); });

    // ── M3 and M4: sign-in ──
    const signIn = (profile, setup) => p.evaluate(async (profile, setup) => {
      window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
      const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
      window._supabase = { auth: { signOut: async () => {} }, from: tbl };
      if (setup) (new Function(setup))();
      const before = DB.users.length;
      await _supabaseRestoreSession({ user: { id: profile.id } });
      const r = { id: currentUser.id, role: currentUser.role, type: currentUser.type, added: DB.users.length - before };
      return r;
    }, profile, setup || '');
    const pm = await signIn({ id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'pm', name: 'Pat Manager', email: 'pat@etcher.test', active: true });
    const pmAccess = await p.evaluate(() => {
      const t = DB.tasks.find(x => !x.archived && !x.parentTaskId);
      return { view: canViewTask(currentUser, t), edit: canEditTask(currentUser, t), blocked: [..._acBlockedViews(currentUser)].sort().join(), staffBlocked: [..._STAFF_BLOCKED].sort().join() };
    });
    ok(pm.role === 'staff' && pm.type === 'staff', 'M3: a pm login signs in as staff (' + JSON.stringify(pm) + ')');
    ok(pmAccess.view && pmAccess.edit && pmAccess.blocked === pmAccess.staffBlocked, 'M3: and can see and edit tasks, with the same screens as staff (' + JSON.stringify(pmAccess) + ')');
    const admin = await signIn({ id: 'aaaaaaaa-0000-4000-8000-000000000009', role: 'admin', name: 'An Admin', email: 'an.admin@etcher.test', active: true });
    ok(admin.role === 'admin' && admin.type === 'admin', 'M3: an admin login is untouched (' + JSON.stringify(admin) + ')');
    // same display name as an existing person, different email: a new record, not theirs
    const sameName = await p.evaluate(() => { const u = DB.users.find(x => x.id === 'u2'); return u ? u.name : null; });
    const twin = await signIn({ id: 'aaaaaaaa-0000-4000-8000-000000000002', role: 'staff', name: sameName, email: 'someone.else@etcher.test', active: true });
    ok(twin.id !== 'u2' && twin.added === 1, 'M4: a new login with the same name as a colleague does not take over their record (' + JSON.stringify(twin) + ')');
    // the right email, but the record already belongs to another login: not taken over either
    const taken = await signIn({ id: 'aaaaaaaa-0000-4000-8000-000000000003', role: 'staff', name: 'Imposter', email: 'linked@etcher.test', active: true },
      "DB.users.push({id:'uLinked',name:'Linked Person',email:'linked@etcher.test',role:'staff',active:true,supabase_uid:'bbbbbbbb-0000-4000-8000-000000000003'});");
    ok(taken.id !== 'uLinked', 'M4: a record already linked to a different login is never taken over by email (' + JSON.stringify(taken) + ')');
    // email matches a record that is not linked yet: linked, as before
    const fresh = await signIn({ id: 'aaaaaaaa-0000-4000-8000-000000000004', role: 'staff', name: 'Free Person', email: 'Free@Etcher.test', active: true },
      "DB.users.push({id:'uFree',name:'Free Person',email:'free@etcher.test',role:'staff',active:true});");
    const freeUid = await p.evaluate(() => (DB.users.find(u => u.id === 'uFree') || {}).supabase_uid);
    ok(fresh.id === 'uFree' && freeUid === 'aaaaaaaa-0000-4000-8000-000000000004', 'M4: a login still finds its own unlinked record by email, and the link is stored (' + JSON.stringify(fresh) + ')');
    // back to the seeded admin for the rest
    await p.evaluate(() => { delete window._supabase; currentUser = { ...DB.users.find(u => u.id === 'u1'), type: 'admin' }; currentUser.role = 'admin'; });

    // ── M6: a quote number with quotes and markup is shown and edited as text ──
    const evil = "Q-9'\"><img src=x onerror=window.__pwn=1>";
    const q6 = await p.evaluate(async evil => {
      window.__pwn = 0;
      (DB.quotes = DB.quotes || []).push({ id: 'qEvil', number: evil, title: 'T', clientId: null, date: '2026-10-10', items: [], status: 'draft', createdAt: new Date().toISOString() });
      quoteCurrentId = null; navigate('quotes'); await new Promise(r => setTimeout(r, 200));
      const listShows = document.getElementById('view-container').innerText.includes(evil);
      quoteCurrentId = 'qEvil'; renderView('quotes'); await new Promise(r => setTimeout(r, 200));
      const inp = document.getElementById('quote-number-input');
      return { listShows, value: inp ? inp.value : null, pwn: window.__pwn };
    }, evil);
    ok(q6.pwn === 0 && q6.listShows && q6.value === evil, 'M6: a quote number with quotes and markup is shown and edited as plain text, nothing runs (' + JSON.stringify(q6).slice(0, 160) + ')');

    // ── M9: calendar events ──
    await p.evaluate(T => { (DB.scheduleEvents = DB.scheduleEvents || []).push({ id: 'seM9', title: 'Owner meeting', type: 'meeting', date: '2026-10-20', startTime: '09:00', endTime: '10:00', attendees: ['u2'], ownerId: 'u2', color: '#97bcbd', createdAt: T, updatedAt: T }); }, T);
    const m9 = await p.evaluate(() => {
      openEventModal('seM9');
      document.getElementById('sched-title').value = 'Owner meeting, moved';
      saveSchedEvent('seM9');
      const e = DB.scheduleEvents.find(x => x.id === 'seM9');
      return { owner: e.ownerId, title: e.title, createdAt: e.createdAt };
    });
    ok(m9.owner === 'u2' && m9.title === 'Owner meeting, moved' && m9.createdAt === T, 'M9: editing a colleague\'s event keeps them as its owner (' + JSON.stringify(m9) + ')');
    const noDate = await p.evaluate(() => { const n = DB.scheduleEvents.length; openEventModal(null); document.getElementById('sched-title').value = 'No date'; document.getElementById('sched-date').value = ''; saveSchedEvent(''); return DB.scheduleEvents.length - n; });
    ok(noDate === 0 && /Choose a date/.test(await alertText()), 'M9: an event without a date is not saved, and the reason is shown');
    await dismiss();
    const badTime = await p.evaluate(() => { const n = DB.scheduleEvents.length; openEventModal(null); document.getElementById('sched-title').value = 'Backwards'; document.getElementById('sched-date').value = '2026-10-21'; document.getElementById('sched-start').value = '15:00'; document.getElementById('sched-end').value = '14:00'; saveSchedEvent(''); return DB.scheduleEvents.length - n; });
    ok(badTime === 0 && /end time cannot be before the start time/i.test(await alertText()), 'M9: an event that ends before it starts is not saved');
    await dismiss();
    const goodTime = await p.evaluate(() => { const n = DB.scheduleEvents.length; openEventModal(null); document.getElementById('sched-title').value = 'Forwards'; document.getElementById('sched-date').value = '2026-10-21'; document.getElementById('sched-start').value = '09:00'; document.getElementById('sched-end').value = '10:00'; saveSchedEvent(''); return DB.scheduleEvents.length - n; });
    ok(goodTime === 1, 'M9: a normal event still saves');

    // ── M11: approved while the edit form was open ──
    const m11 = await p.evaluate(T => {
      DB.timeEntries.push({ id: 'teM11', staffId: 'u1', taskId: null, clientId: DB.clients[0].id, date: '2026-10-09', hours: 2, note: 'work', status: 'submitted', billable: true, createdAt: T, updatedAt: T });
      openEditTimeEntry('teM11');
      document.getElementById('ete-hours').value = '7';
      DB.timeEntries.find(e => e.id === 'teM11').status = 'approved';   // a colleague approves it meanwhile
      saveEditTimeEntry('teM11');
      return DB.timeEntries.find(e => e.id === 'teM11').hours;
    }, T);
    ok(m11 === 2 && /approved while the form was open/.test(await alertText()), 'M11: an entry approved while its form was open is not changed, and the reason is shown');
    await dismiss();
    const m11b = await p.evaluate(T => {
      DB.timeEntries.push({ id: 'teM11b', staffId: 'u1', taskId: null, clientId: DB.clients[0].id, date: '2026-10-09', hours: 2, note: 'work', status: 'submitted', billable: true, createdAt: T, updatedAt: T });
      openEditTimeEntry('teM11b'); document.getElementById('ete-hours').value = '3'; saveEditTimeEntry('teM11b');
      return DB.timeEntries.find(e => e.id === 'teM11b').hours;
    }, T);
    ok(m11b === 3, 'M11: an entry still awaiting approval saves as before');

    // ── M13: deleting a custom status ──
    const m13setup = await p.evaluate(T => {
      DB.labelConfig = DB.labelConfig || {}; DB.labelConfig.statuses = DB.labelConfig.statuses || {};
      DB.labelConfig.statuses.cst_m13 = { label: 'Parked', color: '#888888', isCustom: true, updatedAt: T };
      const ts = DB.tasks.filter(t => !t.archived).slice(0, 2); ts.forEach(t => { t.status = 'cst_m13'; });
      wsDeleteCustomLabel('status', 'cst_m13');
      return { ids: ts.map(t => t.id) };
    }, T);
    const m13msg = await confirmShown();
    const m13still = await p.evaluate(() => !!DB.labelConfig.statuses.cst_m13);
    ok(!!m13msg && /Parked/.test(m13msg) && /2 tasks use it and will move to/.test(m13msg) && m13still, 'M13: deleting a custom status asks first and says how many tasks move (' + m13msg + ')');
    await confirmYes();
    const m13after = await p.evaluate(ids => ({ gone: !DB.labelConfig.statuses.cst_m13, statuses: ids.map(i => DB.tasks.find(t => t.id === i).status) }), m13setup.ids);
    ok(m13after.gone && m13after.statuses.every(s => s === 'todo'), 'M13: after confirming, the label is gone and its tasks are on To Do (' + JSON.stringify(m13after) + ')');
    const m13cancel = await p.evaluate(T => {
      DB.labelConfig.statuses.cst_keep = { label: 'Keep', color: '#888888', isCustom: true, updatedAt: T };
      wsDeleteCustomLabel('status', 'cst_keep'); closeConfirm();
      return !!DB.labelConfig.statuses.cst_keep;
    }, T);
    ok(m13cancel, 'M13: cancelling leaves the label alone');

    // ── M17: deleting a comment ──
    const m17 = await p.evaluate(T => {
      const t = DB.tasks.find(x => !x.archived);
      DB.comments.push({ id: 'cmM17', taskId: t.id, authorId: 'u1', body: 'mine', createdAt: T });
      DB.comments.push({ id: 'cmM17b', taskId: t.id, authorId: 'u2', body: 'theirs', createdAt: T });
      openTaskPanel(t.id);
      tpDeleteComment('cmM17');
      return { stillThere: DB.comments.some(c => c.id === 'cmM17') };
    }, T);
    const m17msg = await confirmShown();
    ok(m17.stillThere && /Delete this comment/.test(m17msg || ''), 'M17: deleting a comment asks first; nothing is removed yet');
    await confirmYes();
    ok(await p.evaluate(() => !DB.comments.some(c => c.id === 'cmM17') && (DB.deletedCommentIds || []).includes('cmM17')), 'M17: after confirming it is removed and remembered as deleted');
    const m17b = await p.evaluate(() => {
      const keep = currentUser; currentUser = { ...DB.users.find(u => u.id === 'u3') || { id: 'u3' }, role: 'staff', type: 'staff' };
      tpDeleteComment('cmM17b'); const shown = !document.getElementById('confirm-modal').classList.contains('hidden');
      currentUser = keep; return { shown, still: DB.comments.some(c => c.id === 'cmM17b') };
    });
    ok(!m17b.shown && m17b.still, 'M17: someone who is neither the author nor an admin cannot delete it, even calling the function directly');

    // ── M1: deleting a client ──
    const m1 = await p.evaluate(T => {
      const cid = 'cM1', other = DB.clients[0].id;
      DB.clients.push({ id: cid, name: 'Leaving Client', shortCode: 'LV', color: '#123456', createdAt: T, updatedAt: T });
      DB.boards.push({ id: 'bM1only', name: 'Leaving board', clientId: cid, visibility: 'all_internal', archived: false, createdAt: T, updatedAt: T });
      DB.boards.push({ id: 'bM1shared', name: 'Shared board', clientId: cid, visibility: 'all_internal', archived: false, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gM1a', name: 'G', clientId: cid, boardId: 'bM1only', order: 0, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gM1b', name: 'G2', clientId: cid, boardId: 'bM1shared', order: 0, createdAt: T, updatedAt: T });
      DB.groups.push({ id: 'gM1c', name: 'Other client work', clientId: other, boardId: 'bM1shared', order: 1, createdAt: T, updatedAt: T });
      (DB.clientNotes = DB.clientNotes || []).push({ clientId: cid, sections: [{ id: 'nsM1', title: 'Logins', body: 'secret', updatedAt: T }] });
      (DB.clientWorkRequests = DB.clientWorkRequests || []).push({ id: 'wrM1a', clientId: cid, title: 'A', status: 'pending', createdAt: T, updatedAt: T }, { id: 'wrM1b', clientId: cid, title: 'B', status: 'pending', createdAt: T, updatedAt: T });
      window.__older = JSON.parse(JSON.stringify({ clientNotes: DB.clientNotes, clientWorkRequests: DB.clientWorkRequests }));
      confirmDelete('client', cid);
      return cid;
    }, T);
    const m1msg = await confirmShown();
    ok(/1 board will move to Archive & Bin/.test(m1msg || '') && /1 board will stay, with no client/.test(m1msg || '') && /Its client notes and 2 work requests will be deleted/.test(m1msg || ''), 'M1: the delete confirmation says what happens to the boards, notes and requests (' + (m1msg || '').slice(-220) + ')');
    await confirmYes();
    const m1after = await p.evaluate(() => {
      const only = DB.boards.find(b => b.id === 'bM1only'), shared = DB.boards.find(b => b.id === 'bM1shared');
      return { onlyArchived: !!only && only.archived === true && only.clientId === null, sharedKept: !!shared && !shared.archived && shared.clientId === null,
        notes: (DB.clientNotes || []).filter(n => n.clientId === 'cM1').length, notesTomb: (DB.deletedNoteSectionIds || []).includes('nsM1'),
        reqs: (DB.clientWorkRequests || []).filter(r => r.clientId === 'cM1').length, reqTomb: ['wrM1a', 'wrM1b'].every(i => (DB.deletedWorkRequestIds || []).includes(i)),
        otherGroup: DB.groups.some(g => g.id === 'gM1c') };
    });
    ok(m1after.onlyArchived && m1after.sharedKept && m1after.otherGroup, 'M1: the board with nothing else on it is archived; the board with other work stays, without the client (' + JSON.stringify(m1after) + ')');
    ok(m1after.notes === 0 && m1after.notesTomb && m1after.reqs === 0 && m1after.reqTomb, 'M1: its client notes and work requests are deleted and remembered as deleted');
    const m1merge = await p.evaluate(() => {
      const older = { ...JSON.parse(JSON.stringify(DB)), ...window.__older, deletedClientIds: [], deletedWorkRequestIds: [], deletedNoteSectionIds: [] };
      const merged = _mergeDB(DB, older);
      return { notes: (merged.clientNotes || []).filter(n => n.clientId === 'cM1').length, reqs: (merged.clientWorkRequests || []).filter(r => r.clientId === 'cM1').length };
    });
    ok(m1merge.notes === 0 && m1merge.reqs === 0, 'M1: a colleague\'s older copy does not bring the deleted client\'s notes or requests back (' + JSON.stringify(m1merge) + ')');

    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('med-a-test', pass, fail);
})();
