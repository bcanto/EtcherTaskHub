// Security batch B (SSO + HTTPS plan, audit L7): sign out after a stretch without activity (SESSION_IDLE_MINUTES).
// Runs the real app in a browser on its own server (never :3001) and the real /api/config handler.
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3254;

(async () => {
  // ── the live /api/config ──
  {
    const saved = process.env.SESSION_IDLE_MINUTES;
    const run = v => { if (v === undefined) delete process.env.SESSION_IDLE_MINUTES; else process.env.SESSION_IDLE_MINUTES = v; delete require.cache[require.resolve(path.join(H.ROOT, 'api', 'config.js'))]; let out; require(path.join(H.ROOT, 'api', 'config.js'))({}, { setHeader() {}, status() { return this; }, json(b) { out = b; return this; } }); return out.sessionIdleMinutes; };
    const r = { unset: run(undefined), thirty: run('30'), junk: run('abc'), negative: run('-5') };
    if (saved === undefined) delete process.env.SESSION_IDLE_MINUTES; else process.env.SESSION_IDLE_MINUTES = saved;
    ok(r.unset === 0 && r.thirty === 30 && r.junk === 0 && r.negative === 0, 'SESSION_IDLE_MINUTES reaches /api/config as a whole number of minutes, 0 (off) when unset or not a positive number (' + JSON.stringify(r) + ')');
  }

  const srv = await H.serve(PORT), b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    const signedIn = () => p.evaluate(() => !!currentUser && document.getElementById('login-screen').classList.contains('hidden'));
    const loginError = () => p.evaluate(() => { const e = document.getElementById('login-error'); return e && !e.classList.contains('hidden') ? e.innerText.replace(/\s+/g, ' ') : ''; });
    const relogin = async () => { await p.evaluate(() => { document.getElementById('login-error')?.classList.add('hidden'); }); await p.type('#login-email', H.LOGIN.email); await p.type('#login-password', H.LOGIN.password); await p.keyboard.press('Enter'); await H.sleep(1800); await p.evaluate(() => { window.saveDB = () => {}; window._flushDB = () => {}; }); };

    // ── off by default: nothing happens however long the browser sits ──
    const off = await p.evaluate(() => { window._sessionIdleMinutes = 0; localStorage.setItem('etcher_last_activity', String(Date.now() - 365 * 86400000)); _idleCheck(); return !!currentUser; });
    ok(off, 'with no limit set (the default), a session is never signed out for being idle');

    // ── recent activity: still signed in ──
    const recent = await p.evaluate(() => { window._sessionIdleMinutes = 1; localStorage.setItem('etcher_last_activity', String(Date.now() - 30000)); _idleCheck(); return !!currentUser; });
    ok(recent, 'with a 1 minute limit, a session active 30 seconds ago stays signed in');

    // ── two minutes before: a warning, once ──
    const warn = await p.evaluate(async () => {
      window._sessionIdleMinutes = 5; localStorage.setItem('etcher_last_activity', String(Date.now() - 3.5 * 60000)); _idleWarned = false;
      const before = document.body.innerText.split('signed out in two minutes').length;
      _idleCheck(); await new Promise(r => setTimeout(r, 150));
      const after = document.body.innerText.split('signed out in two minutes').length;
      _idleCheck(); await new Promise(r => setTimeout(r, 150));
      const again = document.body.innerText.split('signed out in two minutes').length;
      return { shown: after > before, once: again === after, still: !!currentUser };
    });
    ok(warn.shown && warn.once && warn.still, 'two minutes before the limit a warning shows, once, and the session stays signed in (' + JSON.stringify(warn) + ')');

    // ── activity resets the clock ──
    const touched = await p.evaluate(async () => {
      window._sessionIdleMinutes = 5; localStorage.setItem('etcher_last_activity', String(Date.now() - 4 * 60000)); _idleLastWrite = 0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      return Date.now() - _idleLast();
    });
    ok(touched >= 0 && touched < 2000, 'typing counts as activity and resets the clock (' + touched + ' ms ago)');
    const touchedOff = await p.evaluate(() => {
      window._sessionIdleMinutes = 0; localStorage.setItem('etcher_last_activity', String(Date.now() - 86400000)); _idleLastWrite = 0;
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return Date.now() - _idleLast();
    });
    ok(touchedOff >= 0 && touchedOff < 2000, 'activity is recorded even while no limit is set, so switching one on later starts from real activity (' + touchedOff + ' ms ago)');

    // ── past the limit: signed out, with a reason on the login screen ──
    const out = await p.evaluate(() => { window._sessionIdleMinutes = 1; localStorage.setItem('etcher_last_activity', String(Date.now() - 61000)); _idleCheck(); return { user: !!currentUser, login: !document.getElementById('login-screen').classList.contains('hidden') }; });
    ok(!out.user && out.login, 'past the limit the session is signed out and the login screen shows (' + JSON.stringify(out) + ')');
    const msg = await loginError();
    ok(/signed out after 1 minute without activity/.test(msg), 'the login screen says why, in plain words (' + msg + ')');
    ok(await p.evaluate(() => sessionStorage.getItem('etcher_idle_signed_out') === null), 'the reason is shown once, not again on the next visit');

    // ── a client portal sign-out reloads the page: the reason survives the reload ──
    const kept = await p.evaluate(() => { window._sessionIdleMinutes = 30; sessionStorage.setItem('etcher_idle_signed_out', '30 minutes'); document.getElementById('login-error')?.classList.add('hidden'); _idleShowNotice(); const e = document.getElementById('login-error'); return e && !e.classList.contains('hidden') ? e.innerText.replace(/\s+/g, ' ') : ''; });
    ok(/signed out after 30 minutes/.test(kept), 'after a reload (the client portal sign-out reloads) the reason is still shown (' + kept + ')');

    // ── start-up: a browser left signed in past the limit starts signed out; a fresh sign-in never counts as idle ──
    const st = await p.evaluate(() => {
      window._sessionIdleMinutes = 60;
      const old = new Date(Date.now() - 5 * 3600000).toISOString(), fresh = new Date().toISOString();
      localStorage.setItem('etcher_last_activity', String(Date.now() - 2 * 3600000));
      const stale = _idleStartupExpired({ user: { last_sign_in_at: old } });
      const justSignedIn = _idleStartupExpired({ user: { last_sign_in_at: fresh } });
      localStorage.removeItem('etcher_last_activity');
      const noRecord = _idleStartupExpired({ user: { last_sign_in_at: old } });
      const recorded = Date.now() - _idleLast() < 2000;
      window._sessionIdleMinutes = 0;
      localStorage.setItem('etcher_last_activity', String(Date.now() - 365 * 86400000));
      const offAtStart = _idleStartupExpired({ user: { last_sign_in_at: old } });
      return { stale, justSignedIn, noRecord, recorded, offAtStart };
    });
    ok(st.stale === true, 'at start-up, a browser idle past the limit is signed out before anything loads');
    ok(st.justSignedIn === false, 'a fresh sign-in (Microsoft sends you back to the page) never counts as idle, even with old activity on record');
    ok(st.noRecord === false && st.recorded, 'with no activity on record it does not sign out, and starts the clock');
    ok(st.offAtStart === false, 'with no limit set, start-up never signs anyone out');

    // ── signing in counts as activity (otherwise an old record would sign a fresh login straight out) ──
    const restore = await p.evaluate(async () => {
      window._sessionIdleMinutes = 1;
      localStorage.setItem('etcher_last_activity', String(Date.now() - 86400000));
      window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
      const profile = { id: 'ffffffff-ffff-4fff-8fff-000000000011', role: 'staff', name: 'Idle Tester', email: 'idle@etcher.test', active: true };
      const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
      window._supabase = { auth: { signOut: async () => {} }, from: tbl };
      DB.users.push({ id: 'uIdle', name: 'Idle Tester', email: profile.email, role: 'staff', active: true }); DB.staff = DB.users;
      await _supabaseRestoreSession({ user: { id: profile.id } });
      const age = Date.now() - _idleLast();
      _idleCheck();
      const still = !!currentUser;
      delete window._supabase; window._sessionIdleMinutes = 0;
      return { age, still };
    });
    ok(restore.age < 2000 && restore.still, 'signing in counts as activity, so an old record does not sign a fresh login straight out (' + JSON.stringify(restore) + ')');

    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('sec-b-test', pass, fail);
})();
