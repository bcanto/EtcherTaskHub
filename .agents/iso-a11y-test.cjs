// Release-1 B6.4 — plan Phase 14 checks for every ISO screen at 390 / 768 / 1440 px:
//   no sideways scroll; every visible button, link and form field has an accessible name;
//   an archived audit is read-only (gone from every op, so nothing can change it).
// Plus B6.3's login button: hidden unless switched on, and it calls the Azure provider correctly.
const H = require('./_iso-harness.cjs');

H.run('iso-a11y-test', 3171, async (t, srv) => {
  const A = H.ADMIN;
  const b = await srv.board({ standards: ['9001', '14001'], title: 'A11y board' });
  const basis = 'Seen the procedure.';
  await srv.set(b, '9001 4.1', { compliance_status: 'non_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Fix it' });
  await srv.set(b, '9001 4.2', { compliance_status: 'compliant', ofi: true, current_system: basis });
  await srv.must(A, { op: 'evidence.addLinkBulk', auditId: b.id, title: 'Document Control Procedure', url: 'https://example.com/dcp', requirementIds: [b.key('9001 4.1').id] });
  await srv.must(A, { op: 'action.trackPlan', auditId: b.id, requirementIds: [b.key('9001 4.1').id] });

  const ui = await t.browser();
  // Unnamed controls on the page: visible buttons, links, inputs, selects, textareas whose accessible
  // name (aria-label, aria-labelledby, text, title, a label, alt of an image inside, placeholder) is empty.
  const unnamed = () => ui.eval(() => {
    const scope = document.getElementById('view-container') || document.body;
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const nameOf = el => {
      const al = el.getAttribute('aria-label'); if (al && al.trim()) return al;
      const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim(); if (t) return t; }
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && l.textContent.trim()) return l.textContent; }
      const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent;
      if (['BUTTON', 'A'].includes(el.tagName)) {
        // Visible text only: an aria-hidden icon (⚙, ×, ›) is not a name.
        const c = el.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove());
        const t = c.textContent.replace(/[›‹×✕▾▸•·…]/g, '').trim(); if (t) return t;
        const img = el.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt;
      }
      if (el.title && el.title.trim()) return el.title;
      if (el.placeholder && el.placeholder.trim()) return el.placeholder;
      if (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type) && el.value) return el.value;
      return '';
    };
    return [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')]
      .filter(vis).filter(el => !nameOf(el).trim())
      .map(el => el.outerHTML.slice(0, 140));
  });
  const screens = [
    ['landing', async () => { await ui.landing(); }],
    ['overview', async () => { await ui.openBoard(b.id); await ui.tab('dashboard'); }],
    ['clauses (row open)', async () => { await ui.openBoard(b.id); await ui.tab('requirements'); await ui.eval(id => { if (!document.querySelector(`[data-ireq="${id}"] .iso-clause-statusbar`)) ISO._reqToggleExpand(id); }, b.key('9001 4.1').id); await t.sleep(800); }],
    ['documents', async () => { await ui.openBoard(b.id); await ui.tab('documents'); }],
    ['actions', async () => { await ui.openBoard(b.id); await ui.tab('worklist'); }],
    ['findings', async () => { await ui.openBoard(b.id); await ui.tab('findings'); }],
    ['settings', async () => { await ui.openBoard(b.id); await ui.tab('settings'); }],
  ];
  for (const width of [1440, 768, 390]) {
    await ui.size(width, width < 500 ? 844 : 1000);
    for (const [name, open] of screens) {
      await open();
      const over = await ui.overflow();
      t.ok(over <= 0, `${name} at ${width}px: no sideways scroll (overflow ${over}px)`);
      const bad = await unnamed();
      t.ok(bad.length === 0, `${name} at ${width}px: every control has an accessible name (unnamed: ${bad.length ? JSON.stringify(bad.slice(0, 3)) : 'none'})`);
    }
  }
  await ui.size(1440, 1000);

  // Archived audits are read-only: archiving removes the board from every op.
  const arc = await srv.board({ standards: ['9001'], title: 'To archive' });
  await srv.must(A, { op: 'audit.archive', auditId: arc.id });
  const tryUpdate = await srv.call(A, { op: 'requirement.update', auditId: arc.id, id: arc.key('9001 4.1').id, expectedVersion: 1, patch: { current_system: 'x' } });
  t.ok(tryUpdate.status === 404, `an archived audit refuses changes (requirement.update → ${tryUpdate.status})`);
  t.ok((await srv.call(A, { op: 'audit.get', auditId: arc.id })).status === 404, 'an archived audit cannot be opened');
  const list = await srv.must(A, { op: 'audit.list' });
  t.ok(!(list.audits || list).some(a => a.id === arc.id), 'an archived audit is not listed');

  // B6.3: Sign in with Microsoft — hidden offline; when switched on it calls the Azure provider.
  const cfg = await (await fetch(`http://127.0.0.1:${srv.port}/api/config`)).json();
  t.ok(cfg.microsoftSignIn === false, '/api/config reports Microsoft sign-in off when offline');
  const page = ui.page;
  const ms = await page.evaluate(async () => {
    const btn = document.getElementById('login-ms');
    const hiddenByDefault = !!btn && btn.style.display === 'none';
    const saved = { s: window._supabase, m: window._microsoftSignIn };
    let call = null;
    window._supabase = { auth: { signInWithOAuth: o => { call = o; return Promise.resolve({ error: null }); } } };
    window._microsoftSignIn = true;
    window._updateMicrosoftSignIn();
    const shown = btn.style.display === '';
    btn.click();
    await new Promise(r => setTimeout(r, 50));
    window._microsoftSignIn = false; window._updateMicrosoftSignIn();
    const hiddenAgain = btn.style.display === 'none';
    window._supabase = saved.s; window._microsoftSignIn = saved.m;
    return { hiddenByDefault, shown, hiddenAgain, call, origin: location.origin, name: btn.getAttribute('aria-label') };
  });
  t.ok(ms.hiddenByDefault && ms.shown && ms.hiddenAgain, `the Microsoft button is hidden unless switched on (got ${JSON.stringify({ d: ms.hiddenByDefault, s: ms.shown, h: ms.hiddenAgain })})`);
  t.ok(ms.call && ms.call.provider === 'azure' && /email/.test(ms.call.options.scopes) && ms.call.options.redirectTo === ms.origin + '/', `it signs in through the Azure provider with email scope and returns to the app (got ${JSON.stringify(ms.call)})`);
  t.ok(ms.name === 'Sign in with Microsoft', 'the button has an accessible name');
});
