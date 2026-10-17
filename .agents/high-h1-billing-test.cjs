// H1 (audit 2026-10-17), Billing half: the Billing tick on the Staff screen is checked on the signed-in user (_canBill) but
// was never copied onto it, so a Billing-ticked staff login on the live site had no Reports, approvals or invoicing. The
// offline login copies the whole staff record, which is why the existing billing test passed. Now the sign-in applies the
// tick to a standard staff login (never to a Restricted one), and a change made while they are signed in reaches them.
// Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3215);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3215/');
    await p.evaluate(() => {
      window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
      window.__signIn = async (profile, rec) => {
        const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
        window._supabase = { auth: { signOut: async () => {} }, from: tbl };
        DB.users = DB.users.filter(u => (u.email || '').toLowerCase() !== profile.email.toLowerCase());
        if (rec) DB.users.push({ active: true, email: profile.email, ...rec }); DB.staff = DB.users;
        const restored = await _supabaseRestoreSession({ user: { id: profile.id } });
        const nav = id => { const e = document.getElementById(id); return e ? e.style.display : null; };
        return { restored, role: currentUser.role, billing: currentUser.billing, canBill: _canBill(currentUser), reportsNav: nav('nav-reports-item'), reportsBlocked: _acBlockedViews(currentUser).has('reports') };
      };
    });
    const prof = (role, n) => ({ id: 'ffffffff-ffff-4fff-8fff-00000000010' + n, role, name: 'Bill Person ' + n, email: 'bill' + n + '@etcher.test', active: true });
    let r = await p.evaluate(pf => __signIn(pf, { id: 'uB1', name: 'Bill Person 1', role: 'staff', billing: true }), prof('staff', 1));
    ok(r.restored && r.role === 'staff' && r.billing === true && r.canBill === true, 'a staff login whose record has the Billing tick signs in able to bill (' + JSON.stringify(r) + ')');
    ok(r.reportsNav === '' && r.reportsBlocked === false, 'and Reports is in their menu and open to them');
    r = await p.evaluate(pf => __signIn(pf, { id: 'uB2', name: 'Bill Person 2', role: 'staff' }), prof('staff', 2));
    ok(r.restored && !r.billing && r.canBill === false && r.reportsNav === 'none' && r.reportsBlocked === true, 'a staff login without the tick has no Reports (' + JSON.stringify(r) + ')');
    r = await p.evaluate(pf => __signIn(pf, { id: 'uB3', name: 'Bill Person 3', role: 'restricted', billing: true }), prof('staff', 3));
    ok(r.restored && r.role === 'restricted' && r.billing === false && r.canBill === false && r.reportsBlocked === true, 'a Restricted person never bills, tick or not (' + JSON.stringify(r) + ')');
    r = await p.evaluate(pf => __signIn(pf, { id: 'uB4', name: 'Bill Person 4', role: 'staff', billing: true }), prof('admin', 4));
    ok(r.restored && r.role === 'admin' && r.canBill === true && r.reportsNav === '', 'an admin bills by role, whatever the record says');
    r = await p.evaluate(pf => __signIn(pf, { id: 'uB5', name: 'Bill Person 5', role: 'staff', billing: 'yes' }), prof('staff', 5));
    ok(r.restored && !r.billing && r.canBill === false, 'only a real tick counts: any other value in the record does not give Billing');
    // An admin ticks or unticks Billing while the person is signed in.
    const live = await p.evaluate(async pf => {
      await __signIn(pf, { id: 'uB6', name: 'Bill Person 6', role: 'staff' });
      const rec = DB.users.find(u => u.id === 'uB6'), out = {};
      const snap = () => ({ canBill: _canBill(currentUser), nav: document.getElementById('nav-reports-item').style.display });
      out.before = snap();
      rec.billing = true; _repaintAfterMerge(); out.ticked = snap();
      delete rec.billing; _repaintAfterMerge(); out.unticked = snap();
      return out;
    }, prof('staff', 6));
    ok(live.before.canBill === false && live.ticked.canBill === true && live.ticked.nav === '' && live.unticked.canBill === false && live.unticked.nav === 'none', 'ticking Billing while they are signed in gives it to them at the next update, and unticking takes it away (' + JSON.stringify(live) + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h1-billing-test', pass, fail); }
})();
