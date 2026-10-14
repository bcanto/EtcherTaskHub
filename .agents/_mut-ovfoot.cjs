// Can-fail mutations for the Overview footer tiles and the client logo (node .agents/_canfail.cjs .agents/_mut-ovfoot.cjs --green).
module.exports = [
  { id: 'ovfoot-loose-row', suite: 'iso-dashboard-test', file: 'iso/iso-core.js', note: 'the loose export row comes back instead of the tiles',
    find: '      + ovDeliverHtml(_auditCache)\n', replace: '      + _exportRowHtml(_auditCache)\n' },
  { id: 'ovfoot-no-logo', suite: 'iso-landing-test', file: 'iso/iso-core.js', note: 'the client logo is not shown',
    find: '<h2 class="iso-land-gh">${clientLogoHtml(cid)}<button', replace: '<h2 class="iso-land-gh"><button' },
  { id: 'ovfoot-any-logo', suite: 'iso-landing-test', file: 'iso/iso-core.js', note: 'any logo value is put into the page, scripts included',
    find: "/^(data:image\\/|https?:\\/\\/)/i.test(c.logo) ? c.logo : ''", replace: "c.logo ? c.logo : ''" },
];
