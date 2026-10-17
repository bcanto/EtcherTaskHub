// Security batch D (SSO + HTTPS plan phase C): two-step sign-in with an authenticator app. Drives the real prompt,
// set-up and turn-off flows in a browser against a stand-in for Supabase's MFA API (own server, never :3001).
const path = require('path'), fs = require('fs');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3256;

(async () => {
  // ── the live /api/config and the migration ──
  {
    const saved = process.env.TWO_STEP_SIGNIN;
    const run = v => { if (v === undefined) delete process.env.TWO_STEP_SIGNIN; else process.env.TWO_STEP_SIGNIN = v; delete require.cache[require.resolve(path.join(H.ROOT, 'api', 'config.js'))]; let out; require(path.join(H.ROOT, 'api', 'config.js'))({}, { setHeader() {}, status() { return this; }, json(b) { out = b; return this; } }); return out.twoStepSignIn; };
    const r = { off: run(undefined), on: run('1') };
    if (saved === undefined) delete process.env.TWO_STEP_SIGNIN; else process.env.TWO_STEP_SIGNIN = saved;
    ok(r.off === false && r.on === true, 'two-step sign-in is offered only when TWO_STEP_SIGNIN=1 (' + JSON.stringify(r) + ')');
    const sql = fs.readFileSync(path.join(H.ROOT, 'supabase', 'migrations', '018_staff_sign_in_with_microsoft.sql'), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    ok(/NOT EXISTS \(SELECT 1 FROM auth\.mfa_factors f WHERE f\.user_id = auth\.uid\(\) AND f\.status = 'verified'\)\s+OR COALESCE\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2'/.test(sql), 'once migration 018 is applied, anyone who set up an authenticator must have given its code this session (aal2); others are unaffected');
    ok(/break_glass_accounts\)\s+THEN COALESCE\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2'/.test(sql), 'a break-glass password session counts only with its authenticator code');
  }

  const srv = await H.serve(PORT), b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    // A stand-in for supabase-js's auth.mfa, plus a profile, so the real _supabaseRestoreSession runs.
    await p.evaluate(() => {
      window.__mk = (opts) => {
        const st = { signedOut: 0, unenrolled: [], enrolled: 0, verifies: [] };
        const payload = btoa(JSON.stringify({ amr: [{ method: opts.method || 'password' }] })).replace(/=+$/, '');
        const factors = opts.factors || [];
        const profile = { id: 'ffffffff-ffff-4fff-8fff-000000000031', role: opts.role || 'staff', name: 'Two Step', email: 'twostep@etcher.test', active: true };
        const tbl = t => ({ select: () => ({ eq: () => ({ single: async () => (t === 'profiles' ? { data: profile, error: null } : { data: null, error: { message: 'none' } }) }) }) });
        window._supabase = { from: tbl, rpc: async () => ({ data: true, error: null }), auth: {
          signOut: async () => { st.signedOut++; },
          getSession: async () => ({ data: { session: { access_token: 'h.' + payload + '.s', user: { id: profile.id } } } }),
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: opts.aal || 'aal1', nextLevel: factors.some(f => f.status === 'verified') ? 'aal2' : 'aal1' }, error: null }),
            listFactors: async () => ({ data: { totp: factors.filter(f => f.status === 'verified'), all: factors }, error: null }),
            challengeAndVerify: async ({ factorId, code }) => { st.verifies.push({ factorId, code }); return code === '123456' ? { data: {}, error: null } : { data: null, error: { message: 'Invalid TOTP code entered' } }; },
            enroll: async () => { st.enrolled++; return { data: { id: 'f-new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } }, error: null }; },
            unenroll: async ({ factorId }) => { st.unenrolled.push(factorId); return { data: {}, error: null }; },
          } } };
        if (!DB.users.some(u => u.email === profile.email)) { DB.users.push({ id: 'uTwoStep', name: 'Two Step', email: profile.email, role: 'staff', active: true }); DB.staff = DB.users; }
        window._syncToSupabase = () => {}; window._startRealtimeSync = () => {};
        return st;
      };
    });
    const startRestore = opts => p.evaluate(opts => { window.__st = window.__mk(opts); currentUser = null; document.getElementById('login-error')?.classList.add('hidden'); window.__res = 'pending'; _supabaseRestoreSession({ user: { id: 'ffffffff-ffff-4fff-8fff-000000000031' } }).then(r => { window.__res = r; }, e => { window.__res = 'threw ' + e.message; }); }, opts);
    const waitFor = (fn, ms = 3000) => p.waitForFunction(fn, { timeout: ms }).then(() => true, () => false);

    // ── sign-in with a code ──
    await startRestore({ factors: [{ id: 'f1', status: 'verified' }] });
    const prompted = await waitFor(() => !!document.getElementById('mfa-prompt'));
    const layer = await p.evaluate(() => { const o = document.getElementById('mfa-prompt'); return o ? { role: o.getAttribute('role'), z: +getComputedStyle(o).zIndex, pending: window.__res === 'pending' } : null; });
    ok(prompted && layer && layer.role === 'dialog' && layer.z >= 700 && layer.pending, 'someone who set up two-step sign-in is asked for a code before anything loads, on a layer of its own (' + JSON.stringify(layer) + ')');
    await p.evaluate(() => { document.getElementById('mfa-code').value = '000000'; document.getElementById('mfa-verify').click(); });
    await H.sleep(200);
    const wrong = await p.evaluate(() => ({ err: document.getElementById('mfa-error')?.textContent || '', still: !!document.getElementById('mfa-prompt'), res: window.__res }));
    ok(/did not work/.test(wrong.err) && wrong.still && wrong.res === 'pending', 'a wrong code is refused with a plain message, and the prompt stays (' + JSON.stringify(wrong) + ')');
    await p.evaluate(() => { const i = document.getElementById('mfa-code'); i.value = '123456'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await waitFor(() => window.__res !== 'pending');
    const right = await p.evaluate(() => ({ res: window.__res, user: !!currentUser, gone: !document.getElementById('mfa-prompt'), verifies: window.__st.verifies }));
    ok(right.res === true && right.user && right.gone && right.verifies.length === 2 && right.verifies[1].factorId === 'f1', 'the right code (Enter works) signs in, with the person\'s own verified factor (' + JSON.stringify(right) + ')');

    // ── cancel ──
    await startRestore({ factors: [{ id: 'f1', status: 'verified' }] });
    await waitFor(() => !!document.getElementById('mfa-prompt'));
    await p.evaluate(() => document.getElementById('mfa-cancel').click());
    await waitFor(() => window.__res !== 'pending');
    const cancel = await p.evaluate(() => { const e = document.getElementById('login-error'); return { res: window.__res, user: !!currentUser, out: window.__st.signedOut, msg: e && !e.classList.contains('hidden') ? e.innerText : '' }; });
    ok(cancel.res === false && !cancel.user && cancel.out === 1 && /authenticator app/.test(cancel.msg), 'cancelling signs out, with the reason on the login screen (' + JSON.stringify(cancel) + ')');

    // ── no code needed ──
    await startRestore({ factors: [] });
    await waitFor(() => window.__res !== 'pending');
    let r = await p.evaluate(() => ({ res: window.__res, prompt: !!document.getElementById('mfa-prompt') }));
    ok(r.res === true && !r.prompt, 'someone without an authenticator signs in as before, no prompt');
    await startRestore({ factors: [{ id: 'f1', status: 'verified' }], aal: 'aal2' });
    await waitFor(() => window.__res !== 'pending');
    r = await p.evaluate(() => ({ res: window.__res, prompt: !!document.getElementById('mfa-prompt') }));
    ok(r.res === true && !r.prompt, 'a session that already gave its code (aal2) is not asked again');

    // ── the button ──
    const btn = (opts) => p.evaluate(async opts => { window.__mk(opts); window._twoStepSignIn = opts.flag; currentUser = currentUser || { id: 'uTwoStep', name: 'Two Step', role: 'staff' }; await _updateTwoStepButton(); const b = document.querySelector('#app-shell .two-step-btn, .two-step-btn'); return b ? getComputedStyle(b).display !== 'none' : null; }, opts);
    ok(await btn({ flag: true, method: 'password' }) === true, 'with TWO_STEP_SIGNIN on, a password login sees "Two-step sign-in"');
    ok(await btn({ flag: true, method: 'oauth' }) === false, 'a Microsoft login does not (Microsoft has its own two-step check)');
    ok(await btn({ flag: false, method: 'password' }) === false, 'with it off, nobody sees it');
    ok(await p.evaluate(() => document.querySelectorAll('.two-step-btn').length) === 2, 'the button sits in the staff sidebar and in the client portal header');

    // ── setting it up ──
    await p.evaluate(() => { window.__st = window.__mk({ factors: [{ id: 'f-old', status: 'unverified' }] }); return openTwoStepSettings(); });
    await H.sleep(150);
    ok(await p.evaluate(() => /Set it up/.test(document.getElementById('two-step-body')?.innerText || '')), 'without an authenticator, the settings offer to set one up');
    await p.evaluate(() => twoStepStart());
    await H.sleep(150);
    const setup = await p.evaluate(() => { const img = document.getElementById('two-step-qr'); return { qr: img ? img.getAttribute('src') || img.src : null, secret: document.getElementById('two-step-secret')?.textContent, markupHasSvg: /<svg/.test(document.getElementById('two-step-body').innerHTML), cleared: window.__st.unenrolled.slice(), enrolled: window.__st.enrolled }; });
    ok(setup.qr && /^data:image\/svg\+xml/.test(setup.qr) && setup.secret === 'JBSWY3DPEHPK3PXP' && !setup.markupHasSvg, 'it shows a QR code (set as an image source, never parsed as markup) and the key to type by hand (' + JSON.stringify({ secret: setup.secret, markupHasSvg: setup.markupHasSvg }) + ')');
    ok(setup.cleared.includes('f-old') && setup.enrolled === 1, 'a half-finished set-up from before is cleared first, so the new one is not refused');
    await p.evaluate(() => { document.getElementById('two-step-code').value = '111111'; document.querySelector('#two-step-body button[data-factor]').click(); });
    await H.sleep(150);
    ok(await p.evaluate(() => /did not work/.test(document.getElementById('two-step-error')?.textContent || '')), 'a wrong code during set-up is refused');
    await p.evaluate(() => { document.getElementById('two-step-code').value = '123456'; document.querySelector('#two-step-body button[data-factor]').click(); });
    await H.sleep(150);
    const on = await p.evaluate(() => ({ text: document.getElementById('two-step-body')?.innerText || '', v: window.__st.verifies.slice(-1)[0], logged: (DB.auditLog || []).some(e => e.action === 'two_step_on') }));
    ok(/Two-step sign-in is on/.test(on.text) && on.v && on.v.factorId === 'f-new' && on.logged, 'the right code turns it on, confirms it in plain words, and records it in the audit trail (' + JSON.stringify(on.v) + ')');

    // ── turning it off ──
    const hostile = 'f"onmouseover="alert(1)';
    await p.evaluate(id => { window.__st = window.__mk({ factors: [{ id, status: 'verified' }] }); return openTwoStepSettings(); }, hostile);
    await H.sleep(150);
    await p.evaluate(() => document.querySelector('#two-step-body button[data-factor]').click());
    const asked = await p.evaluate(() => !document.getElementById('confirm-modal').classList.contains('hidden') && /Turn off two-step/.test(document.getElementById('confirm-msg').textContent));
    await p.evaluate(() => document.getElementById('confirm-ok-btn').click());
    await H.sleep(200);
    const offR = await p.evaluate(() => ({ un: window.__st.unenrolled.slice(), text: document.getElementById('two-step-body')?.innerText || '' }));
    ok(asked && offR.un.length === 1 && offR.un[0] === hostile && /is off/.test(offR.text), 'turning it off asks first, removes exactly that factor (an odd id is passed as data, never as code) and says so (' + JSON.stringify(offR.un) + ')');

    await p.evaluate(() => { delete window._supabase; closeGenericModal(); });
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('sec-d-test', pass, fail);
})();
