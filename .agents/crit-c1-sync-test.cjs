// C1 (audit 2026-10-17): a failed or contested save fell back to overwriting the whole shared record with this
// browser's copy, and closing a tab did the same, so a bad connection could wipe out other people's work.
// Now nothing ever overwrites: the changes are kept, the save is retried, and a banner says so until one gets
// through. Drives the app's real save path against a fake Supabase "app_state" row. Own server, in memory only.
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

// Installed in the page: a fake Supabase client that only knows app_state and records every operation.
const FAKE = () => {
  const srv = window.__srv = { row: { id: 1, data: { users: [], tasks: [{ id: 'srv_only', name: 'Written by someone else', updatedAt: '2026-10-01T00:00:00.000Z' }] }, updated_at: '2026-10-01T00:00:00.000Z' },
    ops: [], failRead: 0, failUpdate: 0, loseRaces: 0, failInsert: null, versions: 1 };
  const clone = x => JSON.parse(JSON.stringify(x));
  const res = (data, error) => Promise.resolve({ data: data || null, error: error || null });
  window._supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }), signOut: async () => {} },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
    from(table) {
      if (table !== 'app_state') return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'n/a' } }) }) }) };
      return {
        select() { return { eq() { return { limit() { srv.ops.push('read'); if (srv.failRead > 0) { srv.failRead--; return res(null, { message: 'network down' }); } return res(srv.row ? [clone(srv.row)] : []); } }; } }; },
        update(patch) {
          const f = {};
          const q = { eq(k, v) { f[k] = v; return q; }, is(k, v) { f[k + ' is'] = v; return q; },
            select() {
              srv.ops.push('update');
              if (srv.failUpdate > 0) { srv.failUpdate--; return res(null, { message: 'permission denied for table app_state' }); }
              if (srv.loseRaces > 0) { srv.loseRaces--; srv.row.updated_at = new Date(Date.parse(srv.row.updated_at) + 1000).toISOString(); srv.row.data.tasks.push({ id: 'race_' + srv.loseRaces, name: 'Someone saved in between', updatedAt: srv.row.updated_at }); return res([]); }
              const expected = f['updated_at'] !== undefined ? f['updated_at'] : null;
              if (!srv.row || (expected !== null && srv.row.updated_at !== expected)) return res([]);
              srv.row = { id: 1, data: clone(patch.data), updated_at: patch.updated_at }; srv.versions++; srv.lastFilter = clone(f);
              return res([{ id: 1 }]);
            } };
          return q;
        },
        insert(row) { srv.ops.push('insert'); if (srv.failInsert) { const e = srv.failInsert; srv.failInsert = null; if (e.code === '23505') srv.row = { id: 1, data: { users: [], tasks: [] }, updated_at: '2026-10-02T00:00:00.000Z' }; return res(null, e); } srv.row = clone(row); srv.versions++; return res(null); },
        upsert() { srv.ops.push('UPSERT'); return res(null); },
      };
    },
  };
  window._supabaseSyncEnabled = true; _supabaseSyncEnabled = true;
};

(async () => {
  const srv = await H.serve(3205);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3205/', { realSave: true });
    await p.evaluate(FAKE);
    const wait = ms => H.sleep(ms);
    const reset = () => p.evaluate(() => { __srv.ops.length = 0; __srv.failRead = 0; __srv.failUpdate = 0; __srv.loseRaces = 0; __srv.failInsert = null; _syncFailCount = 0; _syncRetryMs = 4000; clearTimeout(_syncRetryTimer); _syncRetryTimer = null; _syncInFlight = false; _syncQueued = false; _hideSyncError(); });
    const edit = (name) => p.evaluate(name => { const t = DB.tasks[0]; t.name = name; t.updatedAt = new Date().toISOString(); saveDB(DB); }, name);
    const state = () => p.evaluate(() => ({ ops: __srv.ops.slice(), fails: _syncFailCount, banner: !!document.getElementById('sync-err-toast'), bannerText: (document.getElementById('sync-err-toast') || {}).textContent || '', timer: !!_syncRetryTimer,
      serverNames: (__srv.row ? __srv.row.data.tasks.map(t => t.name) : []), serverIds: (__srv.row ? __srv.row.data.tasks.map(t => t.id) : []) }));

    // 1. A healthy save merges what others wrote and writes with a version check.
    await reset(); await edit('First change'); await wait(900);
    let s = await state();
    ok(s.ops.join() === 'read,update' && s.serverNames.includes('First change') && s.serverIds.includes('srv_only') && !s.banner, 'a normal save reads, merges the other person\'s record in, and writes once (' + s.ops.join() + ')');
    const filt = await p.evaluate(() => __srv.lastFilter);
    ok(filt && filt.id === 1 && filt.updated_at === '2026-10-01T00:00:00.000Z', 'the write only lands if nobody has written since the read (it is filtered on the version it read: ' + JSON.stringify(filt) + ')');

    // 2. The read fails: nothing is written, the changes are kept, a retry is scheduled, the banner appears.
    await reset(); await p.evaluate(() => { __srv.failRead = 99; _syncRetryMs = 150; });
    await edit('Second change'); await wait(1500);
    s = await state();
    ok(!s.ops.some(o => /update|insert|UPSERT/.test(o)) && s.ops.filter(o => o === 'read').length >= 2, 'when the shared record cannot be read, nothing is written; saves are retried (' + [...new Set(s.ops)].join() + ' x' + s.ops.length + ')');
    ok(s.banner && /not reached the server/.test(s.bannerText) && /network down/.test(s.bannerText) && s.fails >= 2, 'the banner says the changes have not reached the server, and why');
    ok(!s.serverNames.includes('Second change'), 'the server record is untouched while it cannot be reached');
    const local = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('etcher_taskhub_v4')).tasks[0].name; } catch (e) { return null; } });
    ok(local === 'Second change', 'the change is still safe in this browser');
    // The connection comes back: the retry gets it through and the banner goes.
    await p.evaluate(() => { __srv.failRead = 0; });
    await wait(1800); s = await state();
    ok(s.serverNames.includes('Second change') && s.serverIds.includes('srv_only') && !s.banner && s.fails === 0 && !s.timer, 'once the connection is back the retry saves, nothing of other people\'s is lost, and the banner goes (' + s.ops.slice(-3).join() + ')');

    // 3. Losing the race over and over: never a blind write.
    await reset(); await p.evaluate(() => { __srv.loseRaces = 99; _syncRetryMs = 60000; });
    await edit('Third change'); await wait(2800);
    s = await state();
    ok(s.ops.filter(o => o === 'update').length === 6 && !s.ops.includes('UPSERT') && !s.serverNames.includes('Third change') && s.serverIds.some(i => /^race_/.test(i)), 'losing the race six times in a row gives up without overwriting; the other people\'s changes stay (' + s.ops.filter(o => o === 'update').length + ' tries)');
    ok(s.timer, 'and a retry is scheduled');

    // 4. The server refuses the write.
    await reset(); await p.evaluate(() => { __srv.failUpdate = 99; _syncRetryMs = 60000; });
    await edit('Fourth change'); await wait(900);
    s = await state();
    ok(!s.ops.includes('UPSERT') && !s.ops.includes('insert') && s.fails === 1 && s.timer, 'a refused write is not answered with an overwrite; it is retried');
    await edit('Fourth change again'); await wait(900); s = await state();
    ok(s.banner && /permission denied/.test(s.bannerText), 'the second failure shows the banner with the server\'s reason');

    // 5. No row yet (first ever save): created, not overwritten; created by someone else meanwhile: merged.
    await reset(); await p.evaluate(() => { __srv.row = null; });
    await edit('Fifth change'); await wait(900); s = await state();
    ok(s.ops.join() === 'read,insert' && s.serverNames.includes('Fifth change'), 'with no record stored yet, the first save creates it');
    await reset(); await p.evaluate(() => { __srv.row = null; __srv.failInsert = { code: '23505', message: 'duplicate key' }; });
    await edit('Sixth change'); await wait(1200); s = await state();
    ok(s.ops.slice(0, 4).join() === 'read,insert,read,update' && s.serverNames.includes('Sixth change') && !s.ops.includes('UPSERT'), 'if someone created the record first, this save reads theirs and merges on top (' + s.ops.slice(0, 5).join() + ')');

    // 5b. The banner reads as one sentence, and clears the bottom tab bar on a phone.
    const lay = await p.evaluate(() => { _showSyncError('network down'); const el = document.getElementById('sync-err-toast'); return { kids: el.childNodes.length, bottom: el.style.bottom, link: !!el.querySelector('a') }; });
    ok(lay.kids === 1 && lay.link && lay.bottom === '20px', 'the banner is one block of text with its Reload link inside the sentence (desktop: ' + JSON.stringify(lay) + ')');
    await p.setViewport({ width: 390, height: 844 });
    const lay2 = await p.evaluate(() => { _showSyncError('network down'); const el = document.getElementById('sync-err-toast'); const r = el.getBoundingClientRect(); return { bottom: el.style.bottom, fits: r.left >= 0 && r.right <= window.innerWidth }; });
    ok(lay2.bottom === '72px' && lay2.fits, 'on a phone the banner sits above the bottom tab bar and fits the screen (' + JSON.stringify(lay2) + ')');
    await p.setViewport({ width: 1440, height: 900 }); await reset();

    // 6. Closing the tab never writes to the server, and asks first when changes are stuck.
    await reset(); await p.evaluate(() => { __srv.ops.length = 0; });
    const unload = await p.evaluate(async () => {
      DB.tasks[0].name = 'Seventh change'; DB.tasks[0].updatedAt = new Date().toISOString(); saveDB(DB); // debounce now pending
      const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 700));
      return { prevented: ev.defaultPrevented, ops: __srv.ops.slice(), local: JSON.parse(localStorage.getItem('etcher_taskhub_v4')).tasks[0].name };
    });
    ok(!unload.ops.includes('UPSERT') && unload.local === 'Seventh change', 'closing the tab with a save pending writes this browser\'s copy only, never an overwrite of the server (' + unload.ops.join() + ')');
    ok(unload.prevented === false, 'and closing with everything saved asks nothing');
    await reset(); await p.evaluate(() => { _syncFailCount = 3; });
    const stuck = await p.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
    ok(stuck === true, 'closing while changes are stuck asks first');
    await reset();

    // 6b. Signing out ends the retrying: no banner on the login screen, no timer left running.
    await reset(); await p.evaluate(() => { __srv.failRead = 99; _syncRetryMs = 100; });
    await edit('Eighth change'); await wait(1200);
    s = await state();
    ok(s.banner && s.timer, 'while changes are stuck the banner shows and a retry is waiting (before signing out)');
    await p.evaluate(() => { doLogout(); });
    s = await state();
    ok(!s.banner && !s.timer && s.fails === 0, 'signing out clears the banner and the waiting retry');
    const opsAtLogout = s.ops.length;
    await wait(900); s = await state();
    ok(s.ops.length === opsAtLogout && !s.banner, 'nothing keeps retrying after sign-out');
    await p.evaluate(() => { __srv.failRead = 99; DB.tasks[0].updatedAt = new Date().toISOString(); saveDB(DB); });
    await wait(900); s = await state();
    ok(!s.banner && !s.timer, 'a save that fails after sign-out shows no banner and schedules no retry');

    // 7. The upload code has no overwrite path left, and other code paths are untouched.
    const src = await p.evaluate(() => [_syncToSupabase, _syncMergeWrite, _syncFailed, _syncSucceeded].map(f => f.toString()).join('\n'));
    ok(!/upsert|_syncBlindUpsert|blind/i.test(src), 'the sync code contains no upsert or blind-write path');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('crit-c1-sync-test', pass, fail); }
})();
