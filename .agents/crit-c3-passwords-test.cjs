// C3 (audit 2026-10-17): staff passwords were saved in plain text in localStorage 'etcher_pw_v1'
// on the live site too. Offline dev keeps its store; with Supabase on (or on any origin that cannot
// use local sign-in) nothing is stored and what is there is deleted. Own server, in memory only.
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const KEY = 'etcher_pw_v1';
const stubFetch = () => {
  window._calls = [];
  const real = window.fetch;
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.includes('/api/invite-user')) { window._calls.push('invite'); return Promise.resolve(new Response(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222' }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    if (url.includes('/api/set-password')) { window._calls.push('set-password'); return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    return real(u, o);
  };
};

(async () => {
  const srv = await H.serve(3201, { host: '0.0.0.0' });
  const b = await H.launch();
  try {
    // ── A. Offline dev (no Supabase, local origin): the store keeps working ──
    {
      const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3201/');
      await p.evaluate(stubFetch);
      const r = await p.evaluate(async KEY => {
        localStorage.removeItem(KEY);
        const out = { allowed: _pwStoreAllowed() };
        openStaffModal('u2'); document.getElementById('sm-pw').value = 'EditedPass1'; await saveStaff('u2');
        out.afterEdit = (JSON.parse(localStorage.getItem(KEY) || '{}')).u2 || null;
        openStaffModal(null);
        document.getElementById('sm-name').value = 'New Person'; document.getElementById('sm-email').value = 'new.person@etchersolutions.com';
        document.getElementById('sm-pw').value = 'NewPersonPw1'; document.getElementById('sm-pw2').value = 'NewPersonPw1';
        await saveStaff('');
        out.afterAdd = (JSON.parse(localStorage.getItem(KEY) || '{}'))['22222222-2222-4222-8222-222222222222'] || null;
        return out;
      }, KEY);
      ok(r.allowed === true, 'offline dev on a local origin may keep the password store');
      ok(r.afterEdit === 'EditedPass1' && r.afterAdd === 'NewPersonPw1', 'offline dev: a changed and a new staff password are kept for the local login (' + JSON.stringify(r) + ')');
      ok(errors.length === 0, 'no page errors (offline) (' + errors.slice(0, 2).join(' | ') + ')');
      await p.close();
    }

    // ── B. Supabase on: nothing is stored, and what is there is removed ──
    {
      const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3201/');
      await p.evaluate(stubFetch);
      const r = await p.evaluate(async KEY => {
        // A live session as far as the page can tell: the client object exists and carries a token.
        window._supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
        const out = { allowed: _pwStoreAllowed() };
        localStorage.setItem(KEY, JSON.stringify({ old1: 'OldPass12345' }));
        _savePw('someone', 'AnotherPass12');
        out.directSaveKept = (JSON.parse(localStorage.getItem(KEY) || '{}')).someone || null;
        out.loadReturns = Object.keys(_loadPwStore()).length;
        _purgePwStore();
        out.afterPurge = localStorage.getItem(KEY);
        // The two real paths: add a staff member, change one's password.
        const u2 = DB.users.find(x => x.id === 'u2'); u2.supabase_uid = '11111111-1111-4111-8111-111111111111';
        openStaffModal('u2'); document.getElementById('sm-pw').value = 'EditedPass2'; await saveStaff('u2');
        openStaffModal(null);
        document.getElementById('sm-name').value = 'Second Person'; document.getElementById('sm-email').value = 'second.person@etchersolutions.com';
        document.getElementById('sm-pw').value = 'SecondPersonPw'; document.getElementById('sm-pw2').value = 'SecondPersonPw';
        await saveStaff('');
        out.calls = window._calls.slice();
        out.keyAfterRealPaths = localStorage.getItem(KEY);
        return out;
      }, KEY);
      ok(r.allowed === false, 'with Supabase on the password store is not allowed');
      ok(r.directSaveKept === null && r.loadReturns === 0, 'with Supabase on, a password is not saved and the store reads as empty (' + JSON.stringify({ k: r.directSaveKept, n: r.loadReturns }) + ')');
      ok(r.afterPurge === null, 'the purge removes the stored passwords');
      ok(r.calls.includes('set-password') && r.calls.includes('invite') && r.keyAfterRealPaths === null, 'adding a staff member and changing a password still reach the server, and store nothing in the browser (' + JSON.stringify({ calls: r.calls, key: r.keyAfterRealPaths }) + ')');
      ok(errors.length === 0, 'no page errors (supabase on) (' + errors.slice(0, 2).join(' | ') + ')');
      await p.close();
    }

    // ── C. Boot: stored passwords are deleted when the page starts on an origin that cannot use local sign-in ──
    {
      const seed = KEY => { localStorage.setItem(KEY, JSON.stringify({ u1: 'LeftBehind123' })); };
      // 127.0.0.2 is not on the local-origin list, like a deployed site.
      const { page: p } = await H.openPage(b, 'http://127.0.0.2:3201/', { login: false, beforeLoad: seed, beforeLoadArg: KEY });
      const away = await p.evaluate(KEY => ({ key: localStorage.getItem(KEY), local: _localAuthAllowed() }), KEY);
      ok(away.local === false && away.key === null, 'on a non-local origin the stored passwords are deleted at start-up (' + JSON.stringify(away) + ')');
      await p.close();
      // A local origin that IS connected to Supabase: deleted once the client is known to be on.
      const srv2 = await H.serve(3202, { config: { supabaseUrl: 'https://fake-supabase.test', supabaseAnonKey: 'anon-key-for-test', isoEnabled: false } });
      const { page: q } = await H.openPage(b, 'http://127.0.0.1:3202/', { login: false, beforeLoad: seed, beforeLoadArg: KEY });
      await H.sleep(1500);
      const dev = await q.evaluate(KEY => ({ key: localStorage.getItem(KEY), supabase: !!window._supabase }), KEY);
      ok(dev.supabase === true && dev.key === null, 'a local origin connected to Supabase deletes them once the client is ready (' + JSON.stringify(dev) + ')');
      await q.close(); srv2.stop();
    }
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('crit-c3-passwords-test', pass, fail); }
})();
