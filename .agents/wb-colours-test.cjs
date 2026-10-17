// Create WorkBoard colours (user request 2026-10-17): 24 named colours plus any colour; only #rrggbb is ever stored.
const path = require('path');
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const PORT = 3243;
(async () => {
  const srv = await H.serve(PORT), b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:' + PORT + '/');
    await p.evaluate(() => { navigate('dashboard'); });
    await H.sleep(400);
    await p.evaluate(() => openCreateWbForm());
    await H.sleep(200);
    const sw = await p.evaluate(() => [...document.querySelectorAll('#create-wb-form [id^="wbc-"]')].filter(el => el.id !== 'wbc-custom' && el.id !== 'wbc-custom-input').map(el => ({ id: el.id, name: el.getAttribute('aria-label') })));
    ok(sw.length === 24 && new Set(sw.map(x => x.id)).size === 24 && sw.every(x => x.name && !/^#/.test(x.name)), 'the form offers 24 different colours, each with a name (' + sw.length + ')');
    ok(['wbc-0d1c33', 'wbc-97bcbd', 'wbc-3b82f6', 'wbc-8b5cf6', 'wbc-f59e0b', 'wbc-10b981', 'wbc-ef4444', 'wbc-f97316'].every(id => sw.some(x => x.id === id)), 'the eight original colours are still there');
    await p.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, 'wb-colours.png'), clip: await p.evaluate(() => { const r = document.getElementById('create-wb-form').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }).catch(() => {});
    const made = await p.evaluate(async () => {
      document.getElementById('new-wb-name').value = 'Colour test board';
      document.getElementById('wbc-be123c').click();
      submitCreateWb();
      const a = DB.workboards.find(w => w.name === 'Colour test board');
      openCreateWbForm();
      document.getElementById('new-wb-name').value = 'Custom colour board';
      const inp = document.getElementById('wbc-custom-input'); inp.value = '#123abc'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const marked = document.getElementById('wbc-custom').style.outline.includes('solid') && document.getElementById('wbc-custom').style.background !== '';
      submitCreateWb();
      const b = DB.workboards.find(w => w.name === 'Custom colour board');
      openCreateWbForm();
      selectWbColor('red;background:url(x)'); selectWbColor('#zzzzzz');
      const kept = selectedWbColor;
      return { a: a && a.color, b: b && b.color, marked, kept };
    });
    ok(made.a === '#be123c', 'picking a new colour creates the board in that colour (' + made.a + ')');
    ok(made.b === '#123abc' && made.marked, 'the "+" picker gives any colour, and shows it as chosen (' + made.b + ')');
    ok(/^#[0-9a-f]{6}$/.test(made.kept), 'anything that is not a plain colour is refused (' + made.kept + ')');
    await p.setViewport({ width: 390, height: 844 });
    await H.sleep(200);
    const phone = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(phone <= 1, 'the form fits a phone screen without sideways scrolling (' + phone + ')');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); }
  H.report('wb-colours-test', pass, fail);
})();
