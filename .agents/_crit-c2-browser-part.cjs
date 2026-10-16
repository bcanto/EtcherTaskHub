// Part 2 of crit-c2-staff-access-test: the app side of Remove staff, in a browser on its own server.
module.exports = async function browserPart(H, ok, fail) {
  const srv = await H.serve(3204);
  const b = await H.launch();
  try {
    const UID = '11111111-1111-4111-8111-111111111113';
    const setup = async (page, supabase) => {
      await page.evaluate((supabase, UID) => {
        window._reqs = []; window._reply = { status: 200, body: { ok: true } }; window._netFail = false;
        const real = window.fetch;
        window.fetch = (u, o) => {
          if (String(u).includes('/api/set-password')) {
            window._reqs.push({ body: JSON.parse(o.body), auth: (o.headers || {}).Authorization || null });
            if (window._netFail) return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve(new Response(JSON.stringify(window._reply.body), { status: window._reply.status, headers: { 'Content-Type': 'application/json' } }));
          }
          return real(u, o);
        };
        if (supabase) window._supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-admin' } } }) } };
        DB.users.find(x => x.id === 'u3').supabase_uid = UID;
        window.__roles = {}; DB.users.forEach(u => { window.__roles[u.id] = u.role; });
      }, supabase, UID);
    };
    const remove = (page, id) => page.evaluate(async id => {
      deleteStaff(id);
      const msg = document.getElementById('confirm-msg').textContent;
      document.getElementById('confirm-ok-btn').click();
      await new Promise(r => setTimeout(r, 400));
      return { msg, stillThere: !!DB.users.find(u => u.id === id), confirmOpen: !document.getElementById('confirm-modal').classList.contains('hidden'),
        alert: document.getElementById('generic-modal').classList.contains('hidden') ? '' : document.getElementById('generic-modal-body').innerText, reqs: window._reqs.slice() };
    }, id);

    // With Supabase on: the login is switched off first.
    { const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3204/'); await setup(p, true);
      const r = await remove(p, 'u3');
      ok(!r.stillThere && !r.confirmOpen && r.reqs.length === 1 && r.reqs[0].body.userId === UID && r.reqs[0].body.access === 'disable' && r.reqs[0].auth === 'Bearer tok-admin',
        'Remove staff asks the server to switch the login off, with the admin\'s own session, then removes the person (' + JSON.stringify(r.reqs) + ')');
      ok(/login is switched off/.test(r.msg), 'the confirmation says the login is switched off (' + r.msg + ')');
      ok(errors.length === 0, 'no page errors (remove) (' + errors.slice(0, 2).join(' | ') + ')');
      await p.close(); }
    // The server refuses or fails: the person is NOT removed, and the admin is told why.
    { const { page: p } = await H.openPage(b, 'http://127.0.0.1:3204/'); await setup(p, true);
      await p.evaluate(() => { window._reply = { status: 500, body: { error: 'Could not stop this login. Nothing was changed; try again.' } }; });
      const r = await remove(p, 'u3');
      ok(r.stillThere && !r.confirmOpen && /Nothing was changed; try again\./.test(r.alert) && /has not been removed/.test(r.alert), 'if the login cannot be switched off the person stays, and the server\'s reason is shown (' + r.alert.replace(/\s+/g, ' ').slice(0, 140) + ')');
      await p.evaluate(() => { window._netFail = true; });
      const r2 = await remove(p, 'u3');
      ok(r2.stillThere && /Could not reach the server/.test(r2.alert), 'if the server cannot be reached the person stays too');
      await p.evaluate(() => { window._netFail = false; window._reply = { status: 200, body: { ok: true } }; });
      const r3 = await remove(p, 'u3');
      ok(!r3.stillThere, 'trying again once the server answers removes them');
      await p.close(); }
    // A person with no login of their own, and offline dev: removed in the app only, no request.
    { const { page: p } = await H.openPage(b, 'http://127.0.0.1:3204/'); await setup(p, true);
      const r = await remove(p, 'u4');
      ok(!r.stillThere && r.reqs.length === 0 && !/login is switched off/.test(r.msg), 'a staff record with no login behind it is removed without a request');
      await p.close(); }
    { const { page: p } = await H.openPage(b, 'http://127.0.0.1:3204/'); await setup(p, false);
      const r = await remove(p, 'u3');
      ok(!r.stillThere && r.reqs.length === 0, 'offline dev (no Supabase) removes the person without a request, as before');
      await p.close(); }
    // Signing in with a switched-off account.
    { const { page: p } = await H.openPage(b, 'http://127.0.0.1:3204/');
      const r = await p.evaluate(async () => {
        const before = currentUser.id; let signedOut = 0;
        window._supabase = { auth: { signOut: async () => { signedOut++; } }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'zzzz', role: 'staff', name: 'Removed Person', email: 'gone@etcher.test', active: false }, error: null }) }) }) }) };
        const restored = await _supabaseRestoreSession({ user: { id: 'zzzz' } });
        return { restored, signedOut, same: currentUser.id === before };
      });
      ok(r.restored === false && r.signedOut === 1 && r.same, 'a switched-off account gets no session: it is signed out and the sign-in is refused (' + JSON.stringify(r) + ')');
      await p.close(); }
  } catch (e) { fail.push('browser part crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
};
