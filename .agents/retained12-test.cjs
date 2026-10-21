// Retained Services: the New retained board configurator (2026-10-21, the user's brief). Bundle first; each bundle
// fills in its services and never allows more than it takes; services show Included, Selected, Optional or Not in
// the bundle; the support tier follows the bundle; a live summary (bundle, tier, services, monthly activities and
// tasks, coverage, lead, start); guidance instead of errors, and Create only when the bundle is complete.
// "Service level" is "Support tier" wherever it shows. Own server, never :3001.
const H = require('./_iso-harness.cjs');

H.run('retained12-test', 3274, async (t) => {
  const ui = await t.browser();
  const ev = (fn, ...a) => ui.eval(fn, ...a);
  const read = () => ev(() => {
    const q = s => document.querySelector(s);
    return {
      st: Object.fromEntries([...document.querySelectorAll('[data-rs-card]')].map(c => [c.dataset.rsCard, c.dataset.rsState + (c.querySelector('.rs-check').checked ? '+' : '') + (c.querySelector('.rs-check').disabled ? '!' : '')])),
      guide: (q('#rs-su-guide') || {}).textContent || '', value: (q('#rs-su-value') || {}).textContent || '', create: q('#rs-su-create').disabled,
      tier: q('#rs-su-level').selectedOptions[0].textContent, bsum: (q('#rs-su-bsum') || {}).textContent || '',
      sum: q('#rs-su-summary').textContent.replace(/\s+/g, ' '), acts: (q('#rs-su-acts') || {}).textContent || '', tasks: q('#rs-su-tasks').textContent,
      cover: [...document.querySelectorAll('#rs-su-cover li')].map(l => (l.classList.contains('off') ? '-' : '+') + l.textContent.trim()),
      pressed: [...document.querySelectorAll('[data-rs-bundle][aria-pressed="true"]')].map(b => b.dataset.rsBundle),
    };
  });

  // Opens bundle first.
  await ev(() => { openRetainerSetup(); _rsSet('clientId', null, 'c1'); });
  const s0 = await read();
  t.ok(Object.values(s0.st).every(v => v === 'wait!') && s0.create && /Choose a bundle to start/.test(s0.guide) && /Not chosen yet/.test(s0.sum), `it opens on the five bundles with every service waiting for one, and Create waits (got ${JSON.stringify(s0)})`);
  t.eq(await ev(() => [...document.querySelectorAll('[data-rs-bundle]')].map(b => b.dataset.rsBundle)), ['Light', 'Core', 'Ops', 'Plus', 'Embedded'], 'the bundles, Light to Embedded');

  // Core: both core services included, add-ons not in the bundle.
  await ev(() => document.querySelector('[data-rs-bundle="Core"]').click());
  const s1 = await read();
  t.ok(s1.st.ims === 'fixed+!' && s1.st.hseq === 'fixed+!' && ['mob', 'ci', 'sys'].every(k => s1.st[k] === 'na!'), `Core includes both core services and greys out the add-ons (got ${JSON.stringify(s1.st)})`);
  t.ok(s1.tier === 'Priority' && /Core bundle/.test(s1.bsum) && /2 core services/.test(s1.bsum) && /Priority support/.test(s1.bsum) && s1.pressed.join() === 'Core', `the bundle card says what Core gives, and the tier follows (got "${s1.bsum}")`);
  t.ok(await ev(() => { _rsSet('on', 'mob', true); _rsSet('on', 'ims', false); return _rsSetupKeys(_rsSetup).join(); }) === 'ims,hseq', 'an add-on cannot be ticked into Core, and an included service cannot be taken out');

  // Light: one service of either kind; ticking another swaps.
  await ev(() => document.querySelector('[data-rs-bundle="Light"]').click());
  const s2 = await read();
  await ev(() => document.querySelector('[data-rs-svc="mob"]').click());
  const s2b = await read();
  t.ok(s2.st.ims === 'on+' && s2.st.hseq === 'open' && s2.st.mob === 'open', `Light keeps one service and leaves the others to pick (got ${JSON.stringify(s2.st)})`);
  t.ok(s2b.st.mob === 'on+' && s2b.st.ims === 'open' && s2b.tier === 'Standard' && !s2b.create, `in Light, picking an add-on swaps it for the core service (got ${JSON.stringify(s2b.st)}, ${s2b.tier})`);

  // Plus: one core, two add-ons; the third add-on waits until one is unticked.
  await ev(() => document.querySelector('[data-rs-bundle="Plus"]').click());
  const s3 = await read();
  t.ok(s3.st.mob === 'on+' && s3.st.ims === 'on+' && s3.st.ci === 'on+' && s3.st.sys === 'full!' && s3.tier === 'High Priority', `Plus fills one core and two add-ons, the third add-on is held (got ${JSON.stringify(s3.st)}, ${s3.tier})`);
  t.ok(await ev(() => { _rsSet('on', 'sys', true); return _rsSetup.svc.sys.on; }) === false, 'a third add-on is refused in Plus');
  await ev(() => document.querySelector('[data-rs-svc="ci"]').click());
  const s4 = await read();
  t.ok(s4.st.sys === 'open' && s4.create && /Pick 1 more add-on service for the Plus bundle/.test(s4.guide), `unticking one frees the place, and Create waits with what is missing (got ${JSON.stringify(s4)})`);
  t.ok(await ev(() => { retainerCreate(); return !DB.workboards.some(w => w.retainer && w.clientId === 'c1'); }), 'an incomplete bundle never makes a board');
  await ev(() => document.querySelector('[data-rs-svc="sys"]').click());
  const s5 = await read();
  t.ok(!s5.create && /3 services included/.test(s5.value) && /High Priority support/.test(s5.value) && s5.cover.join() === '+Governance,-Compliance,+Mobilisation,+Systems and data,-Continuous improvement', `complete again: the value line by Create, and coverage follows the services (got ${JSON.stringify(s5)})`);

  // Ops: one core and one add-on, each a swap.
  await ev(() => document.querySelector('[data-rs-bundle="Ops"]').click());
  await ev(() => document.querySelector('[data-rs-svc="hseq"]').click());
  const s6 = await read();
  t.ok(s6.st.hseq === 'on+' && s6.st.ims === 'open' && s6.st.mob === 'on+' && s6.tier === 'Priority+', `Ops swaps between the core services (got ${JSON.stringify(s6.st)})`);

  // Owner and lead are checked; guidance names what to do.
  const own = await ev(() => { _rsSet('owner', 'hseq', ''); const g = document.getElementById('rs-su-guide').textContent, d = document.getElementById('rs-su-create').disabled; _rsSet('owner', 'hseq', currentUser.id); return { g, d }; });
  t.ok(own.d && /Choose an owner for HSEQ Admin and Audit Readiness/.test(own.g), `a service with no owner holds Create and says so (got ${JSON.stringify(own)})`);

  // Embedded: everything included; the summary adds it up.
  await ev(() => document.querySelector('[data-rs-bundle="Embedded"]').click());
  const s7 = await read();
  t.ok(Object.values(s7.st).every(v => v === 'fixed+!') && s7.tier === 'Highest Priority' && /Priority queue/.test(s7.bsum) && /Surge support included/.test(s7.bsum), `Embedded includes all five services, with Highest Priority support (got ${JSON.stringify(s7.st)}, "${s7.bsum}")`);
  t.ok(s7.acts === '53' && s7.tasks === '7' && s7.cover.every(c => c[0] === '+'), `the summary totals 53 monthly activities and 7 monthly tasks, every area covered (got ${s7.acts}, ${s7.tasks})`);
  t.ok(/Bundle ?Embedded/.test(s7.sum) && /Support tier ?Highest Priority/.test(s7.sum) && /Document reviews ?20/.test(s7.sum) && /Retainer lead ?Bruna Canto/.test(s7.sum) && /Starts ?[A-Z][a-z]+ \d{4}/.test(s7.sum), `the summary names the bundle, tier, activities, lead and start (got "${s7.sum.slice(0, 400)}")`);
  t.ok(/5 services included/.test(s7.value) && /7 monthly tasks/.test(s7.value) && /Highest Priority support/.test(s7.value), 'the value line by Create: services, monthly tasks, support');

  // A redraw keeps the place and the focus.
  const keep = await ev(() => {
    const body = document.getElementById('generic-modal-body'); body.scrollTop = 600; const before = body.scrollTop;
    const box = document.querySelector('[data-f="mt-sys-0"]'); box.focus(); box.click();
    return { before, after: document.getElementById('generic-modal-body').scrollTop, focus: (document.activeElement.dataset || {}).f };
  });
  t.ok(keep.before > 0 && Math.abs(keep.after - keep.before) <= 2 && keep.focus === 'mt-sys-0', `ticking a box keeps the scroll position and the focus (got ${JSON.stringify(keep)})`);
  await ev(() => { document.getElementById('generic-modal-body').scrollTop = 0; document.querySelector('[data-f="mt-sys-0"]').click(); });
  const shot = await ui.shot('retained12-configurator');
  t.eq(shot.phone, 0, 'the configurator fits a phone');

  // Create: the board keeps the bundle and the tier.
  const made = await ev(() => {
    document.getElementById('rs-su-create').click();
    const b = DB.workboards.find(w => w.retainer && w.clientId === 'c1' && !w.archived);
    return b ? { bundle: b.retainer.bundle, tier: b.retainer.priority, svc: b.retainer.services.length, tasks: DB.tasks.filter(x => x.boardId === b.id).length, id: b.id } : null;
  });
  t.ok(made && made.bundle === 'Embedded' && made.tier === 'Highest' && made.svc === 5 && made.tasks === 7, `the board keeps the Embedded bundle and the Highest tier, five services, seven monthly tasks (got ${JSON.stringify(made)})`);

  // Support tier, by name, wherever it shows.
  const names = await ev(async id => {
    const wait = ms => new Promise(x => setTimeout(x, ms));
    navigate('retained'); await wait(400);
    const out = { clientsHead: [...document.querySelectorAll('#rd-clients thead th')].map(th => th.textContent.trim()), queueHead: [...document.querySelectorAll('#rd-queue thead th')].map(th => th.textContent.trim()), tierBadge: (document.querySelector('#rd-clients .rq-lv') || {}).textContent || '', filter: document.body.textContent.includes('All tiers') };
    openRetainerPlan(id); out.plan = document.querySelector('.rs-pl-grid').textContent.replace(/\s+/g, ' '); closeGenericModal();
    const keepUser = Object.assign({}, currentUser);
    currentUser = { id: 'c1', name: 'General Cranes', role: 'client', type: 'client', clientId: 'c1', initials: 'GCR', color: '#c2410c' }; DB.clients.find(c => c.id === 'c1').portalEnabled = true;
    launchClientView(); await wait(800); cpNavigate('retained'); await wait(500);
    out.portal = document.getElementById('cp-body').textContent.replace(/\s+/g, ' ');
    currentUser = keepUser;
    return out;
  }, made.id);
  t.ok(names.clientsHead.includes('Support tier') && names.queueHead[0] === 'Tier' && /Highest Priority/.test(names.tierBadge) && names.filter, `the dashboard says Support tier and shows the tier's name (got ${JSON.stringify(names).slice(0, 300)})`);
  t.ok(/Support tier/.test(names.plan) && !/Service level/.test(names.plan), 'the plan says Support tier');
  t.ok(/Support tier ?Highest Priority/.test(names.portal), `the client's portal says Support tier: Highest Priority (got "${names.portal.slice(0, 200)}")`);
});
