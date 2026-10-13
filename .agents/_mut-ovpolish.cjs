// Can-fail mutations for the 2026-10-13 Overview polish (node .agents/_canfail.cjs .agents/_mut-ovpolish.cjs --green).
const S = 'iso-dashboard-test';
module.exports = [
  { id: 'ovp-no-padding', suite: S, file: 'iso/iso.css', note: 'Full dashboard loses its card padding (flush to the edges again)',
    find: '.iso-app #iso-dash-tab:has(> .iso-dash-header) { padding: 20px 16px 28px; }', replace: '' },
  { id: 'ovp-title-shown', suite: S, file: 'iso/iso-core.js', note: 'the board title is repeated on screen again',
    find: 'class="iso-dash-title iso-visually-hidden"', replace: 'class="iso-dash-title"' },
  { id: 'ovp-back-dead', suite: S, file: 'iso/iso-core.js', note: '"‹ Overview" does nothing',
    find: 'onclick="ISO._ovShowOverview()"><span aria-hidden="true">‹</span> Overview', replace: 'onclick=""><span aria-hidden="true">‹</span> Overview' },
  { id: 'ovp-double-style', suite: S, file: 'iso/iso-charts.js', note: 'clickable bars get two style attributes again (layout dropped)',
    find: '` class="iso-chart-bar-row" tabindex="0"', replace: '` class="iso-chart-bar-row" style="cursor:pointer" tabindex="0"' },
];
