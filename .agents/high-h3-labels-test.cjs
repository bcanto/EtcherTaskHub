// H3 (audit 2026-10-17): custom statuses and priorities were lost on sync. The label settings are one object and the
// merge takes an object from the server whole, so a status you created, renamed, recoloured or deleted was missing from
// what you saved and was replaced when a colleague's change arrived. Each case does the real action, then merges with the
// state a colleague still holds, in BOTH directions. Runs on its own server (no :3001, no real project).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3211);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3211/');
    await p.evaluate(() => {
      // what a colleague's computer holds, and a way to merge it with mine in both directions
      window.__both = (action) => {
        const old = JSON.parse(JSON.stringify(DB));
        action();
        const mine = JSON.parse(JSON.stringify(DB));
        const m = { c: _mergeDB(old, mine), i: _mergeDB(mine, old) };   // c: the colleague receives my save; i: I receive their older save
        const swap = d => { const keep = JSON.parse(JSON.stringify(DB)); for (const k in DB) delete DB[k]; Object.assign(DB, d); return keep; };
        const meta = (d, kind, key) => { const keep = swap(d); const r = kind === 'status' ? { label: getStatusMeta(key).label, color: getStatusMeta(key).color, all: getAllStatuses().includes(key) } : { label: getPrioMeta(key).label, color: getPrioMeta(key).color, all: getAllPriorities().includes(key) }; swap(keep); return r; };
        return { m, meta };
      };
      window.__newLabel = (kind, text, color) => { document.body.insertAdjacentHTML('beforeend', '<div id="__lbl"><input id="ws-dd-new-' + kind + '" value="' + text + '"><input id="ws-dd-new-' + kind + '-color" value="' + color + '"></div>'); wsAddCustomLabel(kind); document.getElementById('__lbl').remove(); return Object.keys(DB.labelConfig[kind === 'status' ? 'statuses' : 'priorities']).filter(k => DB.labelConfig[kind === 'status' ? 'statuses' : 'priorities'][k].label === text).pop(); };
    });
    const run = (fnSrc, kind, keyArg) => p.evaluate(({ fnSrc, kind, keyArg }) => {
      let key = keyArg;
      const w = window.__both(() => { const r = new Function('kind', 'key', fnSrc)(kind, key); if (r) key = r; });
      return { key, c: w.meta(w.m.c, kind, key), i: w.meta(w.m.i, kind, key), gone: !!w.m.c.deletedLabels && w.m.c.deletedLabels };
    }, { fnSrc, kind, keyArg });

    // A new custom status survives a colleague's save, in both directions, and can be picked.
    let r = await run("return __newLabel(kind,'Awaiting parts','#aa5500');", 'status', null);
    ok(r.c.all && r.i.all && r.c.label === 'Awaiting parts' && r.i.label === 'Awaiting parts', 'a new custom status survives a colleague\'s save in both directions and is in the status list (' + JSON.stringify([r.c, r.i]) + ')');
    const statusKey = r.key;
    ok(await p.evaluate(k => typeof DB.labelConfig.statuses[k].updatedAt === 'string', statusKey), 'a new label is stamped when it is made');
    // A new custom priority likewise.
    r = await run("return __newLabel(kind,'Whenever','#336699');", 'priority', null);
    ok(r.c.all && r.i.all && r.c.label === 'Whenever' && r.i.label === 'Whenever', 'a new custom priority survives too (' + JSON.stringify([r.c, r.i]) + ')');
    const prioKey = r.key;
    // Renaming and recolouring.
    r = await run("wsLabelRename('status',key,'Parts on order');", 'status', statusKey);
    ok(r.c.label === 'Parts on order' && r.i.label === 'Parts on order', 'a renamed status keeps its new name after a colleague\'s save in both directions (' + r.c.label + ' / ' + r.i.label + ')');
    r = await run("wsLabelColor('status',key,'#123456');", 'status', statusKey);
    ok(r.c.color === '#123456' && r.i.color === '#123456', 'a recoloured status keeps its colour (' + r.c.color + ' / ' + r.i.color + ')');
    // A built-in recoloured from the colour presets, then put back.
    r = await run("_lcSet('statuses','todo',{color:'#b91c1c',bg:'#fef2f2',dot:'#f87171'});", 'status', 'todo');
    ok(r.c.color === '#b91c1c' && r.i.color === '#b91c1c', 'a built-in status recoloured from the presets keeps its colour (' + r.c.color + ' / ' + r.i.color + ')');
    r = await run("_lcReset('statuses','todo');", 'status', 'todo');
    ok(r.c.color !== '#b91c1c' && r.i.color !== '#b91c1c', 'and putting it back to the default also survives a colleague\'s save (' + r.c.color + ' / ' + r.i.color + ')');
    r = await run("_lcSet('statuses','todo',{color:'#0f766e',bg:'#ccfbf1',dot:'#2dd4bf'});", 'status', 'todo');
    ok(r.c.color === '#0f766e' && r.i.color === '#0f766e', 'and customising it again afterwards still works: the new colour is newer than the reset (' + r.c.color + ' / ' + r.i.color + ')');
    // Deleting.
    r = await run("wsDeleteCustomLabel('priority',key);", 'priority', prioKey);
    ok(!r.c.all && !r.i.all, 'a deleted custom priority stays deleted after a colleague\'s save in both directions (' + r.c.all + ' / ' + r.i.all + ')');
    const tomb = await p.evaluate(k => (DB.deletedLabels || {})['priorities:' + k], prioKey);
    ok(typeof tomb === 'string' && tomb.length > 10, 'and the delete is remembered with its time');
    // Two computers each make a different status: both exist afterwards.
    r = await p.evaluate(() => {
      const base = JSON.parse(JSON.stringify(DB));
      const swap = d => { const keep = JSON.parse(JSON.stringify(DB)); for (const k in DB) delete DB[k]; Object.assign(DB, d); return keep; };
      swap(base); const k1 = __newLabel('status', 'From A', '#111111'); const a = JSON.parse(JSON.stringify(DB));
      swap(base); const k2 = __newLabel('status', 'From B', '#222222'); const bb = JSON.parse(JSON.stringify(DB));
      const m = _mergeDB(a, bb);
      return { both: !!m.labelConfig.statuses[k1] && !!m.labelConfig.statuses[k2], m2: (() => { const x = _mergeDB(bb, a); return !!x.labelConfig.statuses[k1] && !!x.labelConfig.statuses[k2]; })() };
    });
    ok(r.both && r.m2, 'two computers that each add a status end up with both');
    // The newer change wins; nothing changes for copies with no stamps (the old behaviour: the incoming one).
    r = await p.evaluate(() => {
      const mk = (label, ts) => ({ labelConfig: { statuses: { cst_x: { label, color: '#000000', isCustom: true, ...(ts ? { updatedAt: ts } : {}) } }, priorities: {} } });
      const lab = (cur, inc) => _mergeDB({ ...cur }, { ...inc }).labelConfig.statuses.cst_x.label;
      return { newerIncoming: lab(mk('mine', '2026-01-01T00:00:00.000Z'), mk('theirs', '2026-02-01T00:00:00.000Z')), newerMine: lab(mk('mine', '2026-03-01T00:00:00.000Z'), mk('theirs', '2026-02-01T00:00:00.000Z')),
        unstamped: lab(mk('mine'), mk('theirs')), stampedBeatsUnstamped: lab(mk('mine', '2026-03-01T00:00:00.000Z'), mk('theirs')) };
    });
    ok(r.newerIncoming === 'theirs' && r.newerMine === 'mine' && r.unstamped === 'theirs' && r.stampedBeatsUnstamped === 'mine', 'the newer change wins; two unstamped copies keep the incoming one as before; a stamped copy beats an unstamped one (' + JSON.stringify(r) + ')');
    // The statuses menu draws them (what a person sees).
    const menu = await p.evaluate(key => { DB.tasks.length && (window.__t = DB.tasks[0]); return wsBuildDropdownHtml(DB.tasks[0].id, 'status'); }, statusKey);
    ok(/Parts on order/.test(menu), 'the status menu lists the renamed custom status');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h3-labels-test', pass, fail); }
})();
