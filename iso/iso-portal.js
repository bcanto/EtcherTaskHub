// ISO Audit: the client portal's ISO Audits tab (release-1 B7, plan Phase 13). window.ISO.portal.
// Reads only the portal.* ops, which build every field for the client on the server (api/_iso.js);
// never DB.* and never a staff op. Layout from the approved concept (2026-10-15): the client's audits
// on the left, the chosen audit on the right with its results, report, actions and evidence requests.
// The tab shows only while at least one board has its client portal on and names this client user.
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STAGE = { planning: 'Planned', fieldwork: 'In progress', reporting: 'Report ready', capa: 'Actions open', closed: 'Closed' };
  const TYPE = { internal: 'Internal audit', gap_analysis: 'Gap analysis', certification_prep: 'Certification preparation', surveillance: 'Surveillance audit', recertification: 'Recertification audit', supplier: 'Supplier audit', follow_up: 'Follow-up audit' };
  const RES = [['compliant', 'Compliant', '#15803d'], ['partially_compliant', 'Partially compliant', '#b45309'], ['non_compliant', 'Non-compliant', '#b91c1c'], ['ofi', 'OFI', '#1d6fb8'], ['not_applicable', 'N/A', '#64748b']];
  const CLASS = { major_nc: 'Major nonconformity', minor_nc: 'Minor nonconformity', observation: 'Observation', ofi: 'Opportunity for improvement' };
  const FILE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>';
  const fmt = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

  let summary = null; // portal.boards: { boards, needs }
  let sel = null;     // the chosen board
  let current = null; // portal.board for the chosen board
  let seq = 0;

  function enabled() { return !!(root._isoEnabled && root.ISO && root.ISO.api); }
  async function load() {
    if (!enabled()) { summary = { boards: [], needs: [] }; return summary; }
    try { summary = await root.ISO.api('portal.boards', {}); } catch (e) { summary = summary || { boards: [], needs: [] }; }
    return summary;
  }
  const boards = () => (summary && summary.boards) || [];
  const needs = () => (summary && summary.needs) || [];
  function syncTab() { const t = document.getElementById('cp-tab-iso'); if (t) t.style.display = boards().length ? '' : 'none'; }

  function render(body) {
    if (!summary) { body.innerHTML = '<div class="cpi-sheet cpi-pad cpi-muted">Loading your audits…</div>'; load().then(() => { syncTab(); if (typeof cpSection !== 'undefined' && cpSection === 'iso') render(body); }); return; }
    const list = boards();
    if (!list.length) { body.innerHTML = '<div class="cp-empty"><div class="cp-empty-title">No ISO audits shared with you</div><div class="cp-empty-text">Etcher shares an audit here once it is ready for you.</div></div>'; return; }
    if (!sel || !list.some(b => b.id === sel)) sel = list[0].id;
    body.innerHTML = `<div class="cpi">${listHtml(list)}<div class="cpi-main" id="cpi-main" aria-live="polite"><div class="cpi-sheet cpi-pad cpi-muted">Loading the audit…</div></div></div>`;
    fill(sel);
  }
  function listHtml(list) {
    return `<section class="cp-sec cpi-side" aria-labelledby="cpi-l-h"><div class="cp-sec-head"><h2 class="cp-sec-title" id="cpi-l-h">Your audits</h2><span class="cp-sec-count">${list.length}</span></div>
      <ul class="cpi-sheet cpi-list">${list.map(b => `<li><button type="button" class="cpi-a${b.id === sel ? ' on' : ''}" aria-pressed="${b.id === sel}" data-id="${esc(b.id)}" onclick="ISO.portal.pick(this.dataset.id)">
        <span class="cpi-ref">${esc(b.ref)}</span><b>${esc(b.title)}</b>
        <span class="cpi-m"><span class="cpi-st s-${esc(b.stage)}">${esc(STAGE[b.stage] || b.stage)}</span>${b.completedAt ? 'Closed ' + esc(fmt(b.completedAt)) : b.plannedStart ? 'From ' + esc(fmt(b.plannedStart)) : ''}</span></button></li>`).join('')}</ul></section>`;
  }
  async function fill(id) {
    const my = ++seq;
    let d;
    try { d = await root.ISO.api('portal.board', { auditId: id }); }
    catch (e) { if (my !== seq) return; const m = document.getElementById('cpi-main'); if (m) m.innerHTML = `<div class="cpi-sheet cpi-pad"><p class="cpi-muted">This audit could not be loaded: ${esc(e.message)}</p></div>`; return; }
    if (my !== seq) return;
    current = d;
    const m = document.getElementById('cpi-main'); if (!m) return;
    m.innerHTML = headHtml(d) + resultsHtml(d) + reportHtml(d) + actionsHtml(d) + requestsHtml(d);
  }
  function sec(id, title, count, inner, pad) {
    return `<section class="cp-sec" aria-labelledby="${id}"><div class="cp-sec-head"><h2 class="cp-sec-title" id="${id}">${esc(title)}</h2>${count != null ? `<span class="cp-sec-count">${count}</span>` : ''}</div><div class="cpi-sheet${pad ? ' cpi-pad' : ''}">${inner}</div></section>`;
  }
  function headHtml(d) {
    const b = d.board;
    const type = b.auditType === 'custom' ? (b.customType || 'Audit') : (TYPE[b.auditType] || '');
    const dates = b.plannedStart ? fmt(b.plannedStart) + (b.plannedEnd ? ' to ' + fmt(b.plannedEnd) : '') : '';
    const link = (x, txt) => `<button type="button" class="cpi-lk" data-id="${esc(x.id)}" onclick="ISO.portal.pick(this.dataset.id)">${esc(txt)}</button>`;
    return `<section class="cpi-sheet cpi-head" aria-labelledby="cpi-t"><span class="cpi-ref">${esc(b.ref)}</span><h1 id="cpi-t">${esc(b.title)}</h1>
      <div class="cpi-meta"><span class="cpi-st s-${esc(b.stage)}">${esc(STAGE[b.stage] || b.stage)}</span>${type ? `<span>${esc(type)}</span>` : ''}${(b.standards || []).length ? `<span>${esc(b.standards.join(', '))}</span>` : ''}${dates ? `<span>${esc(dates)}</span>` : ''}${d.lead ? `<span>Lead auditor ${esc(d.lead)}</span>` : ''}</div>
      ${d.previous ? `<p class="cpi-ln">Follows ${link(d.previous, d.previous.ref)}${d.previous.completedAt ? ', closed ' + esc(fmt(d.previous.completedAt)) : ''}.</p>` : ''}
      ${d.next ? `<p class="cpi-ln">Next audit: ${link(d.next, d.next.ref)}.</p>` : b.completedAt && b.maintenanceDue ? `<p class="cpi-ln">Next maintenance audit due ${esc(fmt(b.maintenanceDue))}.</p>` : ''}
    </section>`;
  }
  function resultsHtml(d) {
    const r = d.results, p = d.previousResults;
    if (!r) return sec('cpi-res-h', 'Results', null, `<p class="cpi-muted">Results appear here once the audit report is issued.${p ? ` ${esc(p.ref)}'s results are the starting point.` : ''}</p>`, true);
    const c = k => r.counts[k] || 0;
    const shown = RES.filter(([k]) => c(k));
    let cmp = '';
    if (p) {
      const n = c('non_compliant'), pn = p.counts.non_compliant || 0;
      cmp = `<p class="cpi-cmp">Non-compliant ${n}, ${n === pn ? 'the same as at ' + esc(p.ref) : (n < pn ? 'down' : 'up') + ' from ' + pn + ' at ' + esc(p.ref)}. OFIs ${c('ofi')}, from ${p.counts.ofi || 0}.</p>`;
    }
    return sec('cpi-res-h', 'Results', null, `<div class="cpi-res">${RES.map(([k, l, col]) => `<span class="cpi-rk" style="--c:${col}"><b>${c(k)}</b>${esc(l)}</span>`).join('')}</div>
      ${shown.length ? `<div class="cpi-bar" role="img" aria-label="${esc(RES.map(([k, l]) => l + ' ' + c(k)).join(', '))}">${shown.map(([k, , col]) => `<span style="flex:${c(k)};background:${col}"></span>`).join('')}</div>` : ''}
      ${cmp}<p class="cpi-src">From the audit report issued ${esc(fmt(r.issuedAt))}.</p>`, true);
  }
  function reportHtml(d) {
    const reps = (d.reports || []).slice().reverse();
    if (!reps.length) return sec('cpi-rep-h', 'Report', null, '<p class="cpi-muted">The report is issued after fieldwork.</p>', true);
    const last = reps[0];
    const answers = d.responses || [];
    const lastAns = answers.filter(r => r.versionId === last.id);
    const open = !last.acknowledgement && !lastAns.some(r => r.status !== 'rejected');
    return sec('cpi-rep-h', 'Report', null, reps.map(v => `<div class="cpi-rep${v === last ? '' : ' old'}">
        <span class="cpi-file">${FILE}<span>${esc(d.board.ref)} audit report${v.versionNo > 1 ? ', version ' + v.versionNo : ''}, issued ${esc(fmt(v.issuedAt))}${v === last ? '' : '. Replaced by version ' + last.versionNo}</span></span>
        <button type="button" class="cp-btn line" data-id="${esc(v.id)}" onclick="ISO.portal.download(this.dataset.id)">Download PDF</button>
        ${v.acknowledgement ? `<p class="cpi-ack">Received and discussed by ${esc(v.acknowledgement.name)}, ${esc(fmt(v.acknowledgement.on))}.</p>` : ''}
        ${answers.filter(r => r.versionId === v.id).map(answerHtml).join('')}</div>`).join('') + (open ? reviewHtml(last) : ''), true);
  }
  function answerHtml(r) {
    const head = r.accurate ? 'You confirmed the report is accurate' : 'You asked for a correction';
    const state = r.status === 'submitted' ? '<span class="cpi-s recv">With Etcher</span>' : r.status === 'accepted' ? '<span class="cpi-s done">Etcher accepted this</span>' : '<span class="cpi-s you">Etcher replied</span>';
    return `<div class="cpi-ans"><div class="cpi-ans-h"><b>${head}</b><span>${esc([r.by, fmt(r.at)].filter(Boolean).join(', '))}</span>${state}</div>
      ${r.correction ? `<p>${esc(r.correction)}</p>` : ''}${r.managementResponse ? `<p><span>Management response:</span> ${esc(r.managementResponse)}</p>` : ''}
      ${r.decisionNote ? `<p class="cpi-ans-n"><span>Etcher:</span> ${esc(r.decisionNote)}</p>` : ''}</div>`;
  }
  function reviewHtml(v) {
    return `<div class="cpi-rv"><h4>Check the report for factual accuracy</h4>
      <div class="cpi-rv-o" role="radiogroup" aria-label="Is the report accurate?"><label><input type="radio" name="cpi-rv" value="ok" onchange="ISO.portal._rv(this.value)"> It is accurate</label><label><input type="radio" name="cpi-rv" value="fix" onchange="ISO.portal._rv(this.value)"> Something needs correcting</label></div>
      <div id="cpi-rv-fix" class="cpi-rv-f" hidden><label class="cpi-l" for="cpi-rv-c">What needs correcting</label><textarea id="cpi-rv-c" maxlength="4000" placeholder="Which finding, and what is not accurate?"></textarea></div>
      <div class="cpi-rv-f"><label class="cpi-l" for="cpi-rv-m">Management response <span>(optional)</span></label><textarea id="cpi-rv-m" maxlength="4000" placeholder="How you will address the findings, and by when."></textarea></div>
      <div><button type="button" class="cp-btn cpi-send" data-id="${esc(v.id)}" onclick="ISO.portal.respond(this.dataset.id)">Send to Etcher</button></div></div>`;
  }
  function actState(a) {
    if (['verified', 'closed'].includes(a.status)) return ['Done', 'done'];
    if (['submitted_for_review', 'ready_for_verification'].includes(a.status)) return ['Etcher to verify', 'recv'];
    if (a.status === 'on_hold') return ['On hold', 'scope'];
    if (a.status === 'draft') return ['Planned', 'scope'];
    if (a.mine) return [a.status === 'more_info_required' ? 'More information needed' : 'Needs you', 'you'];
    return ['With Etcher', 'prog'];
  }
  function actionsHtml(d) {
    const acts = d.actions || [], t = today();
    if (!acts.length) return sec('cpi-act-h', 'Actions', 0, '<p class="cpi-muted cpi-pad0">No actions shared with you on this audit.</p>');
    return sec('cpi-act-h', 'Actions', acts.length, `<ul class="cpi-rows">${acts.map(a => {
      const [label, cls] = actState(a);
      const late = a.dueDate && a.dueDate < t && !['Done', 'Etcher to verify'].includes(label);
      const sub = [a.clause, a.finding ? (CLASS[a.finding.classification] || '') + (a.finding.ref ? ' ' + a.finding.ref : '') : '', a.mine ? 'Yours to do' : 'Etcher is doing this'].filter(Boolean).join('. ');
      const can = a.mine && ['assigned', 'in_progress', 'awaiting_evidence', 'more_info_required'].includes(a.status);
      return `<li class="cpi-x"><div class="cpi-tt"><b><span class="cpi-ref">${esc(a.ref)}</span>${esc(a.title)}</b><span>${esc(sub)}.</span></div>
        <span class="cpi-s ${cls}">${esc(label)}</span><span class="cpi-due${late ? ' late' : ''}">${a.dueDate ? (late ? 'Overdue, ' : 'Due ') + esc(fmt(a.dueDate)) : ''}</span>
        <span class="cpi-xa">${can ? `<button type="button" class="cp-btn line" data-id="${esc(a.id)}" onclick="ISO.portal.doneOpen(this.dataset.id)">Mark done</button>` : ''}</span>
        ${can ? `<div class="cpi-reply" id="cpi-done-${esc(a.id)}" hidden><label class="cpi-l" for="cpi-done-n-${esc(a.id)}">What was done <span>(optional)</span></label><textarea id="cpi-done-n-${esc(a.id)}" maxlength="4000" placeholder="For example: the register now lists every load cell with its calibration date."></textarea>
          <div class="cpi-reply-b"><button type="button" class="cp-btn cpi-send" data-id="${esc(a.id)}" onclick="ISO.portal.done(this.dataset.id)">Send to Etcher</button><button type="button" class="cp-btn text" data-id="${esc(a.id)}" onclick="ISO.portal.doneCancel(this.dataset.id)">Cancel</button></div></div>` : ''}</li>`;
    }).join('')}</ul>`);
  }
  function requestsHtml(d) {
    const reqs = d.requests || [];
    if (!reqs.length) return '';
    const st = { open: ['Needs you', 'you'], submitted: ['Sent, Etcher to review', 'recv'], closed: ['Done', 'done'] };
    return sec('cpi-ev-h', 'Evidence requests', reqs.length, `<ul class="cpi-rows">${reqs.map(r => { const [l, c] = st[r.status] || ['', '']; return `<li class="cpi-x"><div class="cpi-tt"><b>${esc(r.description)}</b><span>${esc(r.clause || 'Requested by Etcher')}.</span></div>
      <span class="cpi-s ${c}">${esc(l)}</span><span class="cpi-due">${r.dueDate ? 'Due ' + esc(fmt(r.dueDate)) : ''}</span>
      <span class="cpi-xa">${r.status === 'open' ? `<button type="button" class="cp-btn line" data-id="${esc(r.id)}" onclick="ISO.portal.sent(this.dataset.id)">Mark sent</button>` : ''}</span></li>`; }).join('')}</ul>`);
  }

  function pick(id) {
    sel = id;
    const body = document.getElementById('cp-body');
    if (!body) return;
    if (document.querySelector('.cpi')) {
      document.querySelectorAll('.cpi-a').forEach(b => { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      fill(id);
    } else render(body);
  }
  // From the Overview: open the ISO tab on one board.
  function open(id) { if (id) sel = id; if (root.cpNavigate) root.cpNavigate('iso'); }
  async function download(versionId) {
    try {
      const r = await root.ISO.api('portal.report', { auditId: sel, versionId: versionId });
      root.ISO._repPdf(r.version);
    } catch (e) { if (root.showToast) root.showToast('Could not download the report: ' + e.message, true); }
  }

  // What the client sends back. Every send reloads the board and the Overview counts.
  const toast = (m, bad) => { if (root.showToast) root.showToast(m, bad); };
  const val = id => String((document.getElementById(id) || {}).value || '');
  async function send(op, payload, okMsg) {
    const btns = [...document.querySelectorAll('#cpi-main button')];
    btns.forEach(b => { b.disabled = true; });
    try {
      await root.ISO.api(op, Object.assign({ auditId: sel }, payload));
      toast(okMsg);
      await load(); syncTab(); await fill(sel);
      return true;
    } catch (e) { toast('Could not send: ' + e.message, true); btns.forEach(b => { b.disabled = false; }); return false; }
  }
  function _rv(v) { const f = document.getElementById('cpi-rv-fix'); if (f) f.hidden = v !== 'fix'; }
  function respond(versionId) {
    const pick = (document.querySelector('input[name="cpi-rv"]:checked') || {}).value;
    if (!pick) { toast('Choose whether the report is accurate.', true); return; }
    const correction = val('cpi-rv-c').trim();
    if (pick === 'fix' && !correction) { toast('Say what needs correcting.', true); const c = document.getElementById('cpi-rv-c'); if (c) c.focus(); return; }
    return send('portal.respond', { versionId: versionId, accurate: pick === 'ok', correction: pick === 'fix' ? correction : null, managementResponse: val('cpi-rv-m').trim() || null },
      pick === 'ok' ? 'Thank you. Etcher has your confirmation.' : 'Sent. Etcher will look at the correction and reply.');
  }
  function doneOpen(id) { const r = document.getElementById('cpi-done-' + id); if (r) { r.hidden = false; const t = r.querySelector('textarea'); if (t) t.focus(); } }
  function doneCancel(id) { const r = document.getElementById('cpi-done-' + id); if (r) r.hidden = true; }
  function done(id) {
    const a = ((current && current.actions) || []).find(x => x.id === id); if (!a) return;
    return send('portal.actionDone', { id: id, expectedVersion: a.rowVersion, note: val('cpi-done-n-' + id).trim() || null }, 'Sent. Etcher will check it and close it.');
  }
  function sent(id) {
    const r = ((current && current.requests) || []).find(x => x.id === id); if (!r) return;
    return send('portal.requestSent', { id: id, expectedVersion: r.rowVersion }, 'Thank you. Etcher will review it.');
  }

  // Overview pieces: the client's ISO asks inside "Waiting on you", and one quiet engagement row.
  function needRowsHtml() {
    return needs().map(n => {
      const late = n.kind !== 'report' && n.date && n.date < today();
      const sub = n.kind === 'report' ? `Issued ${fmt(n.date)}. Check it is accurate.` : n.kind === 'action' ? `${n.ref}${n.date ? '. Due ' + fmt(n.date) : ''}` : `Evidence request${n.date ? '. Due ' + fmt(n.date) : ''}`;
      return `<div class="cp-task-row cp-need cpi-need" role="button" tabindex="0" data-id="${esc(n.auditId)}" onclick="ISO.portal.open(this.dataset.id)" onkeypress="if(event.key==='Enter')ISO.portal.open(this.dataset.id)">
        <div class="cp-need-t"><b><span class="cpi-tag">ISO</span>${esc(n.title)}</b><span class="${late ? 'late' : ''}">${esc(sub)}${late ? '. Overdue' : ''}</span></div>
        <div class="cp-need-a"><button type="button" class="cp-btn line" data-id="${esc(n.auditId)}" onclick="event.stopPropagation();ISO.portal.open(this.dataset.id)">${n.kind === 'report' ? 'Review' : 'Open'}</button></div></div>`;
    }).join('');
  }
  function engRowHtml() {
    const list = boards();
    if (!list.length) return '';
    const b = list[0];
    return `<button type="button" class="cp-eng cpi-eng" onclick="ISO.portal.open('')"><span class="cp-eng-n"><i style="background:#0f766e"></i>ISO audits</span><span class="cp-eng-f">${list.length} audit${list.length === 1 ? '' : 's'}</span>
      <span class="cp-eng-x">${esc([(b.standards || []).join(', '), b.ref + ', ' + (STAGE[b.stage] || b.stage).toLowerCase()].filter(Boolean).join('. '))}.</span></button>`;
  }

  root.ISO = root.ISO || {};
  root.ISO.portal = { load: load, syncTab: syncTab, render: render, pick: pick, open: open, download: download, needRowsHtml: needRowsHtml, respond: respond, _rv: _rv, doneOpen: doneOpen, doneCancel: doneCancel, done: done, sent: sent, engRowHtml: engRowHtml, needCount: () => needs().length, boardCount: () => boards().length, _reset: () => { summary = null; sel = null; current = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
