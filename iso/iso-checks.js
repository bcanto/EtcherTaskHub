// The cheat sheet's CONFIRM points as tick boxes under a clause's Assessment (2026-10-14).
// Ticking writes one sentence at the top of the basis ("Confirmed that …") and the auditor adds
// what they actually saw underneath. The boxes are read back from that sentence, so there is no
// second field to drift out of step with the text: edit the sentence and it becomes your own words.
// Shared by the browser (window.IsoChecks) and the server (require), so both read it the same way.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IsoChecks = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const PREFIX = 'Confirmed that ';
  const clean = s => String(s == null ? '' : s).trim().replace(/\.+$/, '');
  // "Leaders can explain…" → "leaders can explain…"; leaves "ISO…" / "SWOT…" alone.
  const lower = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  const list = items => (items || []).map(clean).filter(Boolean);

  // One readable sentence: "Confirmed that a.", "… a, and that b.", "… a; that b; and that c."
  // (semicolons from three on, because the points themselves often contain commas).
  function sentence(items) {
    const xs = list(items).map(lower);
    if (!xs.length) return '';
    if (xs.length === 1) return PREFIX + xs[0] + '.';
    if (xs.length === 2) return PREFIX + xs[0] + ', and that ' + xs[1] + '.';
    return PREFIX + xs.slice(0, -1).join('; that ') + '; and that ' + xs[xs.length - 1] + '.';
  }

  // { ticked, rest }: the opening line counts as ticks only when it is exactly what sentence()
  // writes for some of `items`, in their order. Anything else is the auditor's own text.
  function split(text, items) {
    const t = String(text == null ? '' : text);
    const all = list(items);
    if (!all.length || !t.startsWith(PREFIX) || all.length > 12) return { ticked: [], rest: t };
    const nl = t.indexOf('\n');
    const line = (nl === -1 ? t : t.slice(0, nl)).trim();
    for (let m = 1; m < (1 << all.length); m++) {
      const sub = all.filter((_, i) => m & (1 << i));
      if (sentence(sub) === line) return { ticked: sub, rest: nl === -1 ? '' : t.slice(nl + 1) };
    }
    return { ticked: [], rest: t };
  }

  // Ticks one point on or off. Only the opening sentence is rewritten; the rest stays as typed.
  function toggle(text, items, item, on) {
    const all = list(items), it = clean(item);
    const s = split(text, all);
    const set = new Set(s.ticked);
    if (on) set.add(it); else set.delete(it);
    const head = sentence(all.filter(x => set.has(x)));
    const rest = s.rest.replace(/^\n+/, '');
    return head ? head + (rest ? '\n' + rest : '\n') : rest;
  }

  // True when the basis has something beyond the ticked sentence — what the auditor saw.
  function hasOwnText(text, items) { return split(text, items).rest.trim() !== ''; }

  return { sentence, split, toggle, hasOwnText, PREFIX };
});
