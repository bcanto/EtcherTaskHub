// ISO Audit — core module (plan Phase 5). window.ISO. No-op until window._isoEnabled is true.
// Talks to the server only through POST /api/iso (api/iso.js); never touches DB.* or app_state —
// ISO boards are not DB.boards records (D10), so nothing here reads/writes the blob directly.
(function (root) {
  'use strict';

  // index.html's `DB`/`currentUser` are `let` bindings scoped to its own inline <script> block —
  // not reachable as window.DB/window.currentUser from this externally-loaded file. index.html
  // exposes window._isoDB()/window._isoCurrentUser() as the bridge (plan §14 A31). Falling back to
  // root.DB/root.currentUser costs nothing and keeps this file working if that ever changes.
  function _DB() { return (root._isoDB ? root._isoDB() : root.DB) || {}; }
  function _cu() { return (root._isoCurrentUser ? root._isoCurrentUser() : root.currentUser) || null; }

  // ── API client ───────────────────────────────────────────────────────────────────────────────
  // window._supabase is set by supabase-client.js when Supabase is configured; when it's null (the
  // dev offline server), impersonate through the same X-ISO-Offline-User header api/_isoAuth.js's
  // offline branch expects (id/role/clientId/name straight off the app's own currentUser — the
  // same object doLogin() already populates for every other part of the app).
  async function _isoAuthHeaders() {
    if (root._supabase && typeof root._adminApiAuthHeaders === 'function') return root._adminApiAuthHeaders();
    const u = _cu() || {};
    return { 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify({ id: u.id, role: u.role, clientId: u.clientId || null, name: u.name })) };
  }

  async function api(op, payload) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, await _isoAuthHeaders());
    const res = await root.fetch('/api/iso', { method: 'POST', headers, body: JSON.stringify(Object.assign({ op: op }, payload || {})) });
    let json = null; try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || ('ISO request failed (' + res.status + ')'));
    return json.data;
  }

  // Simple TTL read cache, invalidated wholesale on any mutation — the same "refetch, don't
  // fine-grain-patch" model the rest of this app uses for its own DB sync (plan §4.6a).
  const _cache = new Map();
  function invalidate() { _cache.clear(); }
  async function cached(key, fn, ttlMs) {
    const hit = _cache.get(key);
    if (hit && (Date.now() - hit.at) < (ttlMs || 8000)) return hit.data;
    const data = await fn();
    _cache.set(key, { at: Date.now(), data: data });
    return data;
  }
  async function mutate(op, payload) { const r = await api(op, payload); invalidate(); return r; }
  // Phase 7b.2 (D12): the Timesheets "ISO audit" mode's own board/action picker — cached like
  // everything else here, invalidated wholesale on any mutation the same as the rest of ISO.
  async function timeTargets() { return cached('timeTargets', () => api('timeTarget.list'), 8000); }
  // Phase 7b.5 (R9): the Digest feature's own "Add ISO progress" hook — not cached (digest
  // generation is an explicit, infrequent action per client, not a re-rendered view) and returns
  // the plain line strings directly, matching what _dgOnClientChange/openDigestDetail expect to
  // append straight into #dg-items.
  async function digestItems(clientId, since) { const r = await api('digest.items', { clientId: clientId, since: since || null }); return (r && r.lines) || []; }

  // ── Route (sessionStorage, mirrors etcher_last_nav) ────────────────────────────────────────────
  const ROUTE_KEY = 'etcher_iso_route';
  function loadRoute() { try { return Object.assign({ auditId: null, tab: 'dashboard' }, JSON.parse(sessionStorage.getItem(ROUTE_KEY) || 'null') || {}); } catch (e) { return { auditId: null, tab: 'dashboard' }; } }
  function saveRoute() { try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch (e) {} }
  let route = loadRoute();
  let _auditCache = null; // the currently-open audit record, refreshed on openBoard/reload
  // Plan 9.2 "every number is a link": a dashboard tile/chart segment carries a real server {filter}
  // (api/_isoFilter.js's own schema — "the browser never re-filters"). Clicking it hands the filter
  // off here, then navigates; the target tab's own fillXTab consumes it into its state object
  // (`.dashFilter`) and asks the server for exactly those rows instead of the unfiltered list, same
  // as a saved view would. `_clearDashFilter` drops it and re-fills normally.
  // { tab, filter, view, label } — consumed once by the next fillXTab, then nulled. `view` names one of
  // the register's own quick views to show on top of the server filter (the evidence figure's "Evidence
  // to review"); `label` names what was clicked, for the banner.
  let _pendingDashNav = null;
  function _dashOpenFiltered(el) {
    let filter = null; try { filter = JSON.parse(el.dataset.filter); } catch (e) { return; }
    const tab = { requirement: 'requirements', finding: 'findings', action: 'actions' }[filter.entity];
    // Overview (R5) never fills _dash — its links fall back to the open board.
    const auditId = _dash.auditId || (_auditCache && _auditCache.id);
    if (!tab || !auditId) return;
    _pendingDashNav = { tab, filter, view: el.dataset.view || null, label: el.dataset.label || '' };
    openBoard(auditId, tab);
  }
  // count: the rows actually shown. "Back to dashboard" keeps the dashboard's own standard (route.dashStd).
  function _dashFilterBannerHtml(stateObj, count, clearOp) {
    if (!stateObj.dashFilter) return '';
    return `<div class="card iso-dash-filter-banner" role="status" style="padding:8px 14px;margin-top:16px;margin-bottom:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#eff6ff;border-color:#bfdbfe">
      <span style="font-size:12px;color:#1e3a8a"><span aria-hidden="true">⟳</span> Filtered from the dashboard${stateObj.dashLabel ? ': <strong>' + esc(stateObj.dashLabel) + '</strong>' : ''} — ${count} matching</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm iso-dash-back" onclick="ISO.setTab('dashboard')">‹ Back to overview</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO.${clearOp}()">Clear filter</button>
      </span>
    </div>`;
  }
  let _membersCache = []; // that audit's members, refreshed alongside it

  function esc(s) { return root.escHtml ? root.escHtml(s) : String(s == null ? '' : s); }
  function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  // A stored timestamp (created_at, activity `at`, …) shown as the viewer's own local date. Slicing the
  // ISO string to its first 10 characters gives the UTC date instead — a day early in WA (UTC+8) for
  // anything recorded before 8 am local.
  function fmtTs(ts) { const d = ts ? new Date(ts) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  // ── Navigation ──────────────────────────────────────────────────────────────────────────────
  function openLanding() { route = { auditId: null, tab: 'dashboard' }; saveRoute(); root.navigate('iso'); }
  // D27: a board opens on its Dashboard unless the caller names a tab (a dashboard click). A reload
  // keeps the current tab — it restores `route` from sessionStorage and never comes through here. The
  // dashboard's standard (D29) survives moving between this board's own tabs, never to another board.
  function openBoard(auditId, tab) {
    // R5: "Full dashboard" is a per-visit mode, not a route of its own — opening a different board
    // (or the same board fresh) always lands back on the simple Overview.
    if (auditId !== route.auditId) _dash.mode = 'overview';
    route = { auditId: auditId, tab: tab || 'dashboard', dashStd: auditId === route.auditId ? (route.dashStd || null) : null }; saveRoute(); root.navigate('iso');
  }
  function setTab(tab) { route.tab = tab; saveRoute(); root.renderView('iso'); }
  function currentClient() {
    if (!route.auditId || !_auditCache || _auditCache.id !== route.auditId) return null;
    return (_DB().clients || []).find(c => c.id === _auditCache.client_id) || null;
  }

  // ── Sidebar (plan 5.2b) ─────────────────────────────────────────────────────────────────────
  const NAV_KEY = 'etcher_iso_nav';
  function navExpanded() { try { return JSON.parse(localStorage.getItem(NAV_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function toggleClientExpanded(clientId) {
    const st = navExpanded(); st[clientId] = !st[clientId];
    try { localStorage.setItem(NAV_KEY, JSON.stringify(st)); } catch (e) {}
    renderSidebar();
  }

  const STANDARD_BADGE = { '9001': 'Q', '14001': 'E', '45001': 'S' };
  // "ISO 9001:2015" — the edition comes from the board's pinned library version (plan 4b.1, D24).
  function stdLabelFor(code, editions) { const ed = editions && editions[code]; return 'ISO ' + code + (ed ? ':' + ed : ''); }
  function stdLabel(code) { return stdLabelFor(code, _auditCache && _auditCache.editions); }
  function standardBadges(audit) {
    return (audit.standards || []).map(c => `<span class="iso-std-badge" title="${esc(stdLabelFor(c, audit.editions))}">${STANDARD_BADGE[c] || c}</span>`).join('');
  }

  function sidebarRowHtml(a) {
    const active = route.auditId === a.id ? ' active' : '';
    const lock = a.visibility === 'private' ? '<span class="iso-lock" title="Private">🔒</span>' : '';
    return `<div class="nav-item iso-nav-row${active}" data-iso-audit="${esc(a.id)}" onclick="ISO.openBoard('${esc(a.id)}')">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.ref)} · ${standardBadges(a)} · ${esc(a.stage)}${lock}</span>
    </div>`;
  }

  async function renderSidebar() {
    const list = document.getElementById('sidebar-iso-list');
    if (!list) return;
    let audits;
    try { audits = await cached('audit.list', () => api('audit.list')); }
    catch (e) { list.innerHTML = '<div class="nav-item" style="color:#b0bec5;cursor:default">Could not load ISO boards.</div>'; return; }

    const landingActive = !route.auditId ? ' active' : '';
    let html = `<div class="nav-item iso-nav-row${landingActive}" onclick="ISO.openLanding()"><span style="flex:1">All ISO boards</span></div>`;

    if (!audits.length) {
      html += `<div class="nav-item" style="color:#8da2b2;cursor:default;font-size:11px">No ISO boards yet — click +</div>`;
      list.innerHTML = html;
      return;
    }

    const clients = _DB().clients || [];
    const byClient = new Map();
    for (const a of audits) { if (!byClient.has(a.client_id)) byClient.set(a.client_id, []); byClient.get(a.client_id).push(a); }
    const expanded = navExpanded();
    const activeClients = clients.filter(c => c.active !== false && !c.archived && byClient.has(c.id))
      .sort((x, y) => (root.clientDisplayTitle ? root.clientDisplayTitle(x) : x.name).localeCompare(root.clientDisplayTitle ? root.clientDisplayTitle(y) : y.name));

    for (const c of activeClients) {
      const boards = byClient.get(c.id) || [];
      const isOpen = !!expanded[c.id] || boards.some(b => b.id === route.auditId);
      html += `<div class="nav-item iso-client-row" onclick="ISO.toggleClientExpanded('${esc(c.id)}')">
        <span class="iso-client-dot" style="background:${esc(c.color || '#64748b')}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(root.clientDisplayTitle ? root.clientDisplayTitle(c) : c.name)}</span>
        <span class="nav-sec-chevron" style="transform:rotate(${isOpen ? '0' : '-90deg'})">&#9662;</span>
      </div>`;
      if (isOpen) html += `<div style="padding-left:14px">${boards.map(sidebarRowHtml).join('')}</div>`;
    }
    list.innerHTML = html;
  }

  // ── Landing page (plan 5.3) — a bespoke, simpler table than the generic Main Table context.
  // Deliberate departure from the plan's literal "ctx iso:portfolio" wording (plan §14 A30): the
  // generic _mtRenderGeneric/_ganttRenderGeneric machinery from Phase 1-2 exists for a board-style
  // grid with inline cell editing, custom columns, resize, drag and bulk actions on individual
  // rows. The ISO portfolio is a read-only rollup of whole boards — none of that applies, and
  // forcing the fit would add real complexity (a fake ctx satisfying a contract built for a
  // different shape of data) for no behavioural gain. A plain, well-tested render function is more
  // honest here; every number it shows still comes from the same metric.portfolio op either way. ──
  // Loading placeholders use the app's light shimmer (._skl, the same one the main page's own boot
  // skeleton uses) — ._sk is the dark one built for the navy sidebar and showed as heavy dark bars on
  // the light page. Each screen gets a placeholder shaped like what is about to appear.
  const SK_WIDTHS = [92, 78, 86, 70, 82, 74, 88, 66];
  function skeletonRows(n) {
    return `<div class="iso-sk" aria-hidden="true">${Array.from({ length: n }).map((_, i) => `<div class="_skl" style="height:14px;width:${SK_WIDTHS[i % SK_WIDTHS.length]}%;margin:10px 0"></div>`).join('')}</div>`;
  }
  function skeletonFor(kind) {
    const bar = (w, h, extra) => `<div class="_skl" style="height:${h || 12}px;width:${w};${extra || ''}"></div>`;
    const card = inner => `<div class="iso-sk-card">${inner}</div>`;
    let html;
    if (kind === 'dashboard') {
      html = `<div style="margin:18px 0 8px">${bar('240px', 22)}<div style="display:flex;gap:28px;margin-top:12px">${[1, 2, 3, 4, 5].map(() => `<div>${bar('64px', 8)}${bar('90px', 12, 'margin-top:6px')}</div>`).join('')}</div></div>
        <div style="display:flex;gap:6px;margin:16px 0">${[90, 110, 110, 110].map(w => bar(w + 'px', 30, 'border-radius:999px')).join('')}</div>
        <div class="iso-sk-grid">${[1, 2, 3, 4, 5].map(() => card(`${bar('60%', 9)}${bar('45%', 24, 'margin-top:10px')}${bar('70%', 9, 'margin-top:10px')}`)).join('')}</div>
        <div class="iso-sk-grid" style="margin-top:10px">${[1, 2, 3, 4].map(() => card(`${bar('55%', 9)}${bar('30%', 24, 'margin-top:10px')}`)).join('')}</div>
        ${card(`${bar('160px', 12)}${[96, 30, 14, 8, 60].map(w => `<div style="display:flex;align-items:center;gap:12px;margin-top:12px">${bar('150px', 10)}${bar(w + '%', 16)}</div>`).join('')}`)}`;
    } else if (kind === 'gantt') {
      html = `<div class="iso-sk-card" style="margin-top:16px">${[[0, 40], [10, 30], [25, 45], [5, 20], [40, 35], [15, 50]].map(([l, w]) => `<div style="display:flex;align-items:center;gap:16px;margin:12px 0">${bar('180px', 10)}<div style="flex:1;position:relative;height:16px">${bar(w + '%', 16, `position:absolute;left:${l}%;border-radius:8px`)}</div></div>`).join('')}</div>`;
    } else if (kind === 'settings') {
      html = card(`${bar('90px', 12)}<div class="iso-sk-form">${[1, 2, 3, 4].map(() => `<div>${bar('70px', 8)}${bar('100%', 32, 'margin-top:6px;border-radius:7px')}</div>`).join('')}</div>`);
    } else if (kind === 'drawer') {
      html = `${card(`${bar('120px', 9)}${bar('55%', 16, 'margin-top:8px')}${bar('90%', 11, 'margin-top:12px')}${bar('75%', 11, 'margin-top:6px')}`)}
        <div style="display:flex;gap:18px;margin:6px 0 14px">${[80, 70, 90, 120, 60].map(w => bar(w + 'px', 10)).join('')}</div>
        ${card(`<div class="iso-sk-form">${[1, 2, 3, 4, 5, 6].map(() => `<div>${bar('60px', 8)}${bar('100%', 32, 'margin-top:6px;border-radius:7px')}</div>`).join('')}</div>`)}`;
    } else { // a register: toolbar, header row, a group, rows with cells
      const row = i => `<div class="iso-sk-row">${bar(SK_WIDTHS[i % 8] / 2 + 15 + '%', 11)}${bar('78px', 18, 'border-radius:999px')}${bar('64px', 18, 'border-radius:999px')}${bar('80px', 10)}${bar('70px', 10)}</div>`;
      html = `<div class="iso-sk-card" style="display:flex;gap:8px;margin-top:16px">${[110, 90, 120, 100].map(w => bar(w + 'px', 28, 'border-radius:7px')).join('')}</div>
        <div class="iso-sk-card" style="padding:0;overflow:hidden">
          <div class="iso-sk-row" style="background:#f8fafc">${['30%', '60px', '60px', '60px', '60px'].map(w => bar(w, 8)).join('')}</div>
          <div class="iso-sk-row" style="border-left:4px solid #e2e8f0">${bar('260px', 13)}</div>
          ${[0, 1, 2, 3, 4, 5, 6].map(row).join('')}
        </div>`;
    }
    return `<div class="iso-sk" aria-hidden="true">${html}</div>`;
  }
  // Landing redesign (cohesive with the board, 2026-10-06): one white card like a board's — a header
  // (title, how many boards, + New ISO board), overdue / due-soon counts in its meta line, maintenance
  // audits due, then search + chips and the boards grouped by client, each row reading like a board
  // header (standard tags, title, ref · stage, per-standard "25 /60" + status bar, report due).
  function landingSkeleton() {
    return `<div class="iso-landing iso-app">
      <header class="iso-app-h">
        <div class="iso-h1row iso-landing-head">
          <div class="iso-titleblock"><h1 class="iso-board-title">ISO audits</h1><span class="iso-board-meta" id="iso-landing-meta">Loading…</span></div>
          <button type="button" class="btn btn-primary iso-landing-new" onclick="ISO.openNewBoard()">+ New ISO board</button>
        </div>
      </header>
      <main class="iso-app-main">
        <div id="iso-maint-due"></div>
        <div id="iso-portfolio-table">${skeletonRows(5)}</div>
      </main>
    </div>`;
  }
  let _land = { audits: [], metrics: null, filter: 'active', q: '' };
  const LAND_FILTERS = [['active', 'Active'], ['due_soon', 'Report due soon'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['all', 'All']];
  function _landDates() {
    const now = new Date();
    return { today: now.toISOString().slice(0, 10), soon: new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10) };
  }
  function _landMatches(a, f) {
    const { today, soon } = _landDates();
    if (f === 'all') return true;
    if (f === 'closed') return a.stage === 'closed';
    if (a.stage === 'closed') return false;
    if (f === 'due_soon') return !!a.report_due && a.report_due >= today && a.report_due <= soon;
    if (f === 'overdue') return !!a.report_due && a.report_due < today;
    return true;
  }
  function _landClientName(id) { const c = (_DB().clients || []).find(x => x.id === id); return c ? (root.clientDisplayTitle ? root.clientDisplayTitle(c) : c.name) : 'Client not found'; }
  // The client's own logo (set in Client Manager), small, beside its name. Image data or http(s) only.
  function clientLogoHtml(id) {
    const c = (_DB().clients || []).find(x => x.id === id);
    const src = c && typeof c.logo === 'string' && /^(data:image\/|https?:\/\/)/i.test(c.logo) ? c.logo : '';
    return src ? `<img class="iso-client-logo" src="${esc(src)}" alt="" aria-hidden="true">` : '';
  }
  function landingRowHtml(a) {
    const { today } = _landDates();
    const codes = (a.standards || []).slice().sort((x, y) => STANDARD_ORDER.indexOf(x) - STANDARD_ORDER.indexOf(y));
    const tags = codes.map(c => `<span class="iso-tag iso-tag-xs" style="--std:${STANDARD_COLOR[c] || '#6b8399'}" title="${esc(stdLabelFor(c, a.editions))}">${esc(STANDARD_BADGE[c] || '•')}</span>`).join('');
    const stat = ((_land.metrics && _land.metrics.status_by_audit) || {})[a.id] || {};
    const prog = a.stage === 'closed'
      ? `<span class="iso-land-closed">${a.maintenance_due ? 'Maintenance due ' + esc(fmtDate(a.maintenance_due)) : 'Closed'}</span>`
      : codes.map(c => {
        const b = stat[c] || { total: 0, counts: {} };
        const total = b.total - (b.counts.out_of_scope || 0); // D45: out of scope is not part of this audit's progress
        const n = total || 1, done = total - (b.counts.not_assessed || 0);
        const bar = COMPLIANCE_STATUSES.filter(st => st !== 'not_assessed' && st !== 'out_of_scope' && b.counts[st]).map(st => `<i style="width:${b.counts[st] / n * 100}%;background:${complianceColor(st)}"></i>`).join('');
        return `<span class="iso-ps-item"><span class="iso-tag iso-tag-xs" style="--std:${STANDARD_COLOR[c] || '#6b8399'}">${esc(STANDARD_BADGE[c] || '•')}</span><b>${done}</b> /${total}<span class="iso-stack" aria-hidden="true">${bar}</span></span>`;
      }).join('');
    const late = a.stage !== 'closed' && a.report_due && a.report_due < today;
    const title = !boardTitleIsDefault(a) ? a.title : (AUDIT_TYPE_LABEL[a.audit_type] || a.title || a.ref);
    const meta = [a.ref, STAGE_LABEL[a.stage] || a.stage, a.previous_audit_id ? 'Maintenance audit' : '', a.visibility === 'private' ? 'Private' : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="iso-land-row" data-audit="${esc(a.id)}" onclick="ISO.openBoard(this.dataset.audit)">
      <span class="iso-land-tags">${tags}</span>
      <span class="iso-land-title"><span class="iso-land-t">${esc(title)}</span><span class="iso-land-m">${esc(meta)}</span></span>
      <span class="iso-land-prog">${prog}</span>
      <span class="iso-land-due${late ? ' is-late' : ''}">${a.report_due ? (late ? 'Report overdue · ' : 'Report due ') + esc(fmtDate(a.report_due)) : '<span class="muted">No report date</span>'}</span>
      <span class="iso-land-chev" aria-hidden="true">${icoChev()}</span>
    </button>`;
  }
  function renderLandingList() {
    const host = document.getElementById('iso-portfolio-table');
    if (!host) return;
    const q = _land.q.trim().toLowerCase();
    const counts = Object.fromEntries(LAND_FILTERS.map(([f]) => [f, _land.audits.filter(a => _landMatches(a, f)).length]));
    let list = _land.audits.filter(a => _landMatches(a, _land.filter));
    if (q) list = list.filter(a => [a.ref, a.title, _landClientName(a.client_id), AUDIT_TYPE_LABEL[a.audit_type] || ''].some(v => String(v || '').toLowerCase().includes(q)));
    const byClient = new Map();
    for (const a of list) { if (!byClient.has(a.client_id)) byClient.set(a.client_id, []); byClient.get(a.client_id).push(a); }
    const groups = [...byClient.entries()].sort((x, y) => _landClientName(x[0]).localeCompare(_landClientName(y[0])));
    const toolbar = `<div class="iso-toolbar iso-land-toolbar">
      <label class="iso-search"><span class="sr-only">Search boards</span><input type="search" id="iso-land-q" value="${esc(_land.q)}" placeholder="Search client, reference or title" oninput="ISO._landSetQuery(this.value)"/></label>
      <div class="iso-fchips">${LAND_FILTERS.map(([f, l]) => `<button type="button" class="iso-fchip${_land.filter === f ? ' is-on' : ''}" aria-pressed="${_land.filter === f}" data-f="${f}" onclick="ISO._landSetFilter(this.dataset.f)">${esc(l)} <b>${counts[f]}</b></button>`).join('')}</div>
    </div>`;
    const body = !_land.audits.length
      ? `<div class="iso-empty"><strong>No ISO boards yet.</strong><span>Start one for a client — pick the standards and the clauses arrive ready to assess.</span><button type="button" class="btn btn-primary" onclick="ISO.openNewBoard()">+ New ISO board</button></div>`
      : !list.length ? '<div class="iso-empty"><strong>No boards match.</strong></div>'
      : groups.map(([cid, rows]) => `<section class="iso-land-group"><h2 class="iso-land-gh">${clientLogoHtml(cid)}<button type="button" class="iso-land-client" data-cid="${esc(cid)}" title="Open this client's programme" onclick="ISO.openProgramme(this.dataset.cid)">${esc(_landClientName(cid))}</button> <span class="muted">${rows.length} board${rows.length === 1 ? '' : 's'}</span></h2>${rows.sort((x, y) => String(y.ref).localeCompare(String(x.ref))).map(landingRowHtml).join('')}</section>`).join('');
    host.innerHTML = toolbar + body;
  }
  function _landSetFilter(f) {
    _land.filter = f;
    renderLandingList();
  }
  function _landSetQuery(q) {
    _land.q = q; renderLandingList();
    const el = document.getElementById('iso-land-q'); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
  }

  async function fillLanding() {
    let audits, metrics;
    try {
      [audits, metrics] = await Promise.all([cached('audit.list', () => api('audit.list')), cached('metric.portfolio', () => api('metric.portfolio'), 4000)]);
    } catch (e) {
      const t = document.getElementById('iso-portfolio-table'); if (t) t.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c">Could not load ISO boards: ${esc(e.message)}</div>`;
      return;
    }
    _land = { audits: audits || [], metrics: metrics, filter: _land.filter, q: _land.q };
    const meta = document.getElementById('iso-landing-meta');
    if (meta) { const clients = new Set(_land.audits.map(a => a.client_id)).size; meta.innerHTML = [`${metrics.audits_active} active board${metrics.audits_active === 1 ? '' : 's'}`, `${clients} client${clients === 1 ? '' : 's'}`].map(esc).join(' · ') + (metrics.audits_overdue ? ` · <span class="iso-land-late">${esc(metrics.audits_overdue)} report${metrics.audits_overdue === 1 ? '' : 's'} overdue</span>` : '') + (metrics.audits_due_soon ? ` · ${esc(metrics.audits_due_soon)} due in 14 days` : ''); }
    renderLandingList();
    const due = document.getElementById('iso-maint-due');
    if (due) due.innerHTML = maintenanceDueHtml(audits);
  }
  // D31: closed boards whose maintenance audit falls in the next 60 days or is overdue, not yet started.
  const MAINT_WINDOW_DAYS = 60;
  function maintenanceDueHtml(audits) {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + MAINT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const rows = audits.filter(a => a.stage === 'closed' && a.maintenance_due && !a.has_successor && a.maintenance_due <= horizon)
      .sort((a, b) => a.maintenance_due.localeCompare(b.maintenance_due));
    if (!rows.length) return '';
    const clients = _DB().clients || [];
    const name = id => { const c = clients.find(x => x.id === id); return c ? (root.clientDisplayTitle ? root.clientDisplayTitle(c) : c.name) : '—'; };
    const byClient = new Map();
    for (const a of rows) { if (!byClient.has(a.client_id)) byClient.set(a.client_id, []); byClient.get(a.client_id).push(a); }
    return `<section class="card iso-maint-due" aria-labelledby="iso-maint-due-h">
      <h3 id="iso-maint-due-h" class="iso-dash-section-h">Maintenance audits due <span class="iso-dash-count">${rows.length}</span></h3>
      ${[...byClient.entries()].map(([cid, list]) => `<div class="iso-maint-client"><div class="iso-maint-client-h">${esc(name(cid))}</div>${list.map(a => {
        const late = a.maintenance_due < today;
        const days = Math.round((new Date(a.maintenance_due + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
        return `<div class="iso-maint-row" data-audit="${esc(a.id)}"><span class="iso-maint-ref">${esc(a.ref)}</span><span class="iso-maint-title">${esc(a.title)}</span>
          <span class="iso-maint-when${late ? ' is-late' : ''}">${late ? 'Overdue since ' + esc(fmtDate(a.maintenance_due)) : 'Due ' + esc(fmtDate(a.maintenance_due)) + (days === 0 ? ' (today)' : ` (in ${days} day${days === 1 ? '' : 's'})`)}</span>
          <button type="button" class="iso-tb-btn" data-id="${esc(a.id)}" onclick="ISO.openBoard(this.dataset.id, 'settings')">Open</button>
          <button type="button" class="btn btn-teal btn-sm" data-id="${esc(a.id)}" onclick="ISO._startMaintenance(this.dataset.id)">Start maintenance audit</button></div>`;
      }).join('')}</div>`).join('')}
    </section>`;
  }

  // ── Board chrome (plan 5.4b) ────────────────────────────────────────────────────────────────
  // Redesign (D35 P1, wireframe's own .app-h): one white card per board — back link, title + client ·
  // ref, the standard switch, a ⚙ for Settings, a per-standard progress strip, then four tabs:
  // Overview · Clauses · Documents · Actions. Older routes (findings, actionplan, evidence) still
  // open — deep links and dashboard click-throughs land on them — and light up the tab they now
  // belong under rather than a tab of their own. Counts and the progress strip fill in once
  // requirement.list answers (fillBoardHeaderStats), so the header never waits on data.
  const BOARD_TABS = [
    { v: 'dashboard', label: 'Overview', owns: ['dashboard'] },
    { v: 'requirements', label: 'Clauses', owns: ['requirements'], ct: 'clauses' },
    { v: 'documents', label: 'Documents', owns: ['documents', 'evidence'] },
    { v: 'worklist', label: 'Actions', owns: ['worklist', 'actions', 'findings', 'actionplan'], ct: 'actions' },
  ];
  function boardHeadTitle(audit) {
    if (!boardTitleIsDefault(audit)) return audit.title;
    return AUDIT_TYPE_LABEL[audit.audit_type] || audit.title || audit.ref;
  }
  function tabStrip(audit, activeTab) {
    const client = currentClient();
    const clientName = client ? (root.clientDisplayTitle ? root.clientDisplayTitle(client) : client.name) : '';
    return `<header class="iso-app-h">
      <div class="iso-h1row">
        <button type="button" class="iso-back" onclick="ISO.openLanding()"><span aria-hidden="true">‹</span> ISO</button>
        <div class="iso-titleblock">
          <h1 class="iso-board-title">${esc(boardHeadTitle(audit))}</h1>
          <span class="iso-board-meta">${clientName ? esc(clientName) + ' · ' : ''}${esc(audit.ref)}${audit.visibility === 'private' ? ' · Private' : ''}${audit.previous ? ' · Maintenance audit of ' + esc(audit.previous.ref) : ''}</span>
        </div>
        ${boardStandardsHtml(audit, activeTab)}
        ${canArchiveLocally() ? `<button type="button" class="btn btn-ghost btn-sm iso-archive-btn" title="Move this board to Archive & Bin" onclick="ISO._archiveBoard('${esc(audit.id)}')">Archive</button>` : ''}
        <button type="button" class="iso-icon-btn${activeTab === 'settings' ? ' is-on' : ''}" aria-label="Board settings" title="Settings — details, access, maintenance" onclick="ISO.setTab('settings')"><span aria-hidden="true">⚙</span></button>
      </div>
      <div class="iso-progress-strip" id="iso-pstrip"></div>
      <nav class="ws-tabstrip iso-tabs" role="tablist" aria-label="Board">
        ${BOARD_TABS.map(t => { const on = t.owns.includes(activeTab); return `<button type="button" role="tab" class="ws-tab iso-tab${on ? ' active' : ''}" aria-selected="${on}" data-tab="${t.v}" onclick="ISO.setTab('${t.v}')">${esc(t.label)}${t.ct ? `<span class="iso-tab-ct" data-ct="${t.ct}"></span>` : ''}</button>`; }).join('')}
      </nav>
    </header>`;
  }
  function boardShell(audit, tab, inner) {
    setTimeout(() => fillBoardHeaderStats(audit), 0);
    return `<div class="iso-app">${tabStrip(audit, tab)}<main class="iso-app-main">${inner}</main></div>`;
  }
  // Per-standard "25 /60" with its status bar, and the tab counts ("Clauses 97 to go", "Actions 16").
  let _hdrSeq = 0;
  async function fillBoardHeaderStats(audit) {
    const seq = ++_hdrSeq;
    let reqs, actions;
    try { [reqs, actions] = await Promise.all([api('requirement.list', { auditId: audit.id }), api('action.list', { auditId: audit.id }).catch(() => [])]); } catch (e) { return; }
    if (seq !== _hdrSeq || !_auditCache || _auditCache.id !== audit.id) return;
    const std = boardStd();
    const codes = (audit.standards || []).filter(c => !std || c === std);
    const strip = document.getElementById('iso-pstrip');
    if (strip) strip.innerHTML = codes.map(c => {
      const rows = reqs.filter(r => r.standard_code === c && r.compliance_status !== 'out_of_scope'); // D45: out of scope is not part of this audit's progress
      const done = rows.filter(r => r.compliance_status && r.compliance_status !== 'not_assessed').length;
      const n = rows.length || 1;
      const cnt = {};
      rows.forEach(r => { const s = r.compliance_status || 'not_assessed'; if (s !== 'not_assessed') cnt[s] = (cnt[s] || 0) + 1; });
      const bar = COMPLIANCE_STATUSES.filter(s => cnt[s]).map(s => `<i style="width:${cnt[s] / n * 100}%;background:${complianceColor(s)}"></i>`).join('');
      return `<span class="iso-ps-item"><span class="iso-tag" style="--std:${STANDARD_COLOR[c] || '#6b8399'}">${esc(STANDARD_BADGE[c] || '•')}</span><b>${done}</b> /${rows.length}<span class="iso-stack" aria-hidden="true">${bar}</span></span>`;
    }).join('');
    const scoped = std ? reqs.filter(r => r.standard_code === std) : reqs;
    const toGo = scoped.filter(r => !r.compliance_status || r.compliance_status === 'not_assessed').length;
    const ctC = document.querySelector('.iso-tab-ct[data-ct="clauses"]');
    if (ctC) ctC.textContent = toGo ? `${toGo} to go` : '';
    const ctA = document.querySelector('.iso-tab-ct[data-ct="actions"]');
    if (ctA) { const n = worklistItemsFrom(scoped, actions || []).length; ctA.textContent = n ? String(n) : ''; }
  }

  // The title audit.create gives a board by default ("ISO 9001/14001") only repeats the standards the
  // strip beside it already names — shown only when someone gave the board a real title.
  function boardTitleIsDefault(audit) { return /^ISO [\d/]+$/.test(String(audit.title || '').trim()); }
  // Tabs whose records carry a standard, so the strip can switch them; elsewhere it only names them.
  const STD_SWITCH_TABS = ['dashboard', 'requirements', 'findings', 'actions'];
  // One board, one place to pick a standard. A single-standard board just names its edition. The
  // buttons keep the dashboard's own class (iso-dash-std) — it is the same switch (route.dashStd),
  // now reachable from every tab instead of only the dashboard (A81: the code travels in data-std).
  function boardStandardsHtml(audit, activeTab) {
    const codes = audit.standards || [];
    if (!codes.length) return '';
    if (codes.length === 1) return `<span class="iso-board-editions iso-board-single">${esc(stdLabelFor(codes[0], audit.editions))}</span>`;
    const std = route.dashStd && codes.includes(route.dashStd) ? route.dashStd : '';
    // The wireframe's .stdfilter: a segmented radiogroup — [All] [Q 9001] [E 14001] [S 45001].
    const btn = (code, label, full) => `<button type="button" role="radio" class="iso-dash-std iso-board-std-btn${std === code ? ' is-on' : ''}" aria-checked="${std === code}" aria-pressed="${std === code}" data-std="${esc(code)}"${full ? ` aria-label="${esc(full)}" title="${esc(full)}"` : ''} onclick="ISO._boardSetStandard(this.dataset.std)">${code ? `<span class="iso-tag" style="--std:${STANDARD_COLOR[code] || '#97bcbd'}">${esc(STANDARD_BADGE[code] || '')}</span>` : ''}${esc(label)}</button>`;
    return `<div class="iso-board-editions iso-board-std iso-stdfilter" role="radiogroup" aria-label="Standard">${btn('', 'All')}${codes.map(c => btn(c, c, stdLabelFor(c, audit.editions))).join('')}</div>`;
  }
  function _boardSetStandard(code) {
    route.dashStd = code || null;
    saveRoute();
    const strip = document.querySelector('.iso-board-std');
    if (strip && _auditCache) strip.outerHTML = boardStandardsHtml(_auditCache, route.tab);
    if (_auditCache) fillBoardHeaderStats(_auditCache);
    if (route.tab === 'dashboard') { if (_auditCache) { if (_dash.mode === 'full') fillDashboardTab(_auditCache); else fillOverviewTab(_auditCache); } }
    else if (route.tab === 'documents' && _auditCache) renderDocumentsTab(_auditCache.id);
    else if (route.tab === 'worklist' && _auditCache) renderWorklistTab(_auditCache.id);
    else if (route.tab === 'requirements' && _req.auditId) renderRequirementsTable(_req.auditId);
    else if (route.tab === 'findings' && _fnd.auditId) renderFindingsTable(_fnd.auditId);
    else if (route.tab === 'actions' && _act.auditId) renderActionsTable(_act.auditId);
  }
  function boardStd() { return _auditCache && route.dashStd && (_auditCache.standards || []).includes(route.dashStd) ? route.dashStd : null; }

  // Shaped like the tab about to open (route.tab is already set when render() asks for this).
  function boardSkeleton() { return skeletonFor(SK_KIND_BY_TAB[route.tab] || 'table'); }
  const SK_KIND_BY_TAB = { dashboard: 'dashboard', actionplan: 'gantt', settings: 'settings' };

  function settingsTabHtml(audit, members) {
    const isManager = _cu() && (_cu().role === 'admin' || ['lead_auditor', 'audit_manager'].includes((members.find(m => m.user_uid === _cu().id) || {}).audit_role));
    return `<div class="card" style="padding:20px;margin-top:16px;max-width:720px">
      <div style="font-weight:700;font-size:13px;margin-bottom:14px">Details</div>
      <div class="iso-field-grid">
        <label>Title<input class="form-input" id="iso-set-title" value="${esc(audit.title)}" ${isManager ? '' : 'disabled'}/></label>
        <label>Scope<textarea class="form-input" id="iso-set-scope" ${isManager ? '' : 'disabled'}>${esc(audit.scope_text || '')}</textarea></label>
        <label>Planned start<input type="date" class="form-input" id="iso-set-start" value="${esc(audit.planned_start || '')}" ${isManager ? '' : 'disabled'}/></label>
        <label>Planned end<input type="date" class="form-input" id="iso-set-end" value="${esc(audit.planned_end || '')}" ${isManager ? '' : 'disabled'}/></label>
        <label>Report due<input type="date" class="form-input" id="iso-set-due" value="${esc(audit.report_due || '')}" ${isManager ? '' : 'disabled'}/></label>
        <label>Stage<select class="form-input" id="iso-set-stage" onchange="ISO._setStageChanged(this.value)" ${isManager ? '' : 'disabled'}>${Object.keys(STAGE_LABEL).map(k => `<option value="${k}"${audit.stage === k ? ' selected' : ''}>${esc(STAGE_LABEL[k])}</option>`).join('')}</select></label>
        <label id="iso-set-maint-wrap" style="${audit.stage === 'closed' ? '' : 'display:none'}">Maintenance audit due<input type="date" class="form-input" id="iso-set-maint" value="${esc(audit.maintenance_due || '')}" ${isManager ? '' : 'disabled'}/></label>
      </div>
      ${isManager ? `<button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO.saveSettings('${esc(audit.id)}',${audit.row_version})">Save</button>` : ''}
    </div>
    ${auditSetupCardHtml(audit, isManager)}
    ${maintenanceCardHtml(audit, isManager)}
    ${isManager || canAddCustom() ? `<div class="card" style="padding:20px;margin-top:16px;max-width:720px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      ${isManager ? `<button class="btn btn-ghost btn-sm iso-set-access" onclick="ISO.openAccessModal()">Access — who works on this board</button>` : ''}
      ${canAddCustom() ? `<button class="btn btn-ghost btn-sm iso-set-addclause" onclick="ISO._openAddRequirement()">+ Add a client-specific clause</button>` : ''}
    </div>` : ''}
    ${isManager ? `<div class="card" style="padding:20px;margin-top:16px;max-width:720px;display:flex;gap:10px;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="ISO._saveAsTemplate('${esc(audit.id)}')">Save as template</button>
    </div>` : ''}
    <div class="card" id="iso-client-profile" style="padding:20px;margin-top:16px;max-width:900px">${skeletonRows(3)}</div>`;
  }

  // ── Client profile card (plan 8c.1, D23) — one profile per client, shared by all its ISO boards.
  // Each single value and each list item carries its own "Confirmed" tick; only confirmed values
  // are ever presented as fact in a generator prompt. Client-internal lists (issues, risks,
  // hazards, obligations) are grouped and marked sensitive, matching the prompt dialog's notice.
  let _prof = null; // { clientId, rowVersion }
  function _profConfirmNote(stored) {
    if (!stored || !stored.confirmed) return '';
    const who = (_DB().users || []).find(u => 'offline:' + u.id === stored.confirmed_by || u.id === stored.confirmed_by);
    return `<span class="iso-prof-by" style="font-size:10px;color:#8da2b2">confirmed${who ? ' by ' + esc(who.name) : ''}${stored.confirmed_at ? ' · ' + esc(fmtTs(stored.confirmed_at)) : ''}</span>`;
  }
  function _profItemRowHtml(key, item, canEdit) {
    return `<div class="iso-prof-item-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <input class="form-input iso-prof-item" data-key="${esc(key)}" data-id="${esc(item.id || '')}" value="${esc(item.text || '')}" ${canEdit ? '' : 'disabled'} style="flex:1" aria-label="Item"/>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap"><input type="checkbox" class="iso-prof-item-conf" ${item.confirmed ? 'checked' : ''} ${canEdit ? '' : 'disabled'}/> Confirmed</label>
      ${_profConfirmNote(item)}
      ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" onclick="this.closest('.iso-prof-item-row').remove()" aria-label="Remove item">✕</button>` : ''}
    </div>`;
  }
  function _profFieldHtml(f, stored, canEdit) {
    if (f.kind === 'list') {
      const items = Array.isArray(stored) ? stored : [];
      return `<div class="iso-prof-list" data-key="${esc(f.key)}" style="grid-column:1/-1;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(f.label)}</div>
        <div class="iso-prof-items">${items.map(i => _profItemRowHtml(f.key, i, canEdit)).join('')}</div>
        ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._profAddItem('${esc(f.key)}')">+ Add</button>` : ''}
      </div>`;
    }
    const s = stored && typeof stored === 'object' ? stored : {};
    return `<div class="iso-prof-field" data-key="${esc(f.key)}">
      <label style="display:block">${esc(f.label)}<input class="form-input iso-prof-val" data-key="${esc(f.key)}" value="${esc(s.value || '')}" ${f.kind === 'color' ? 'placeholder="#RRGGBB"' : ''} ${canEdit ? '' : 'disabled'}/></label>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin-top:2px"><input type="checkbox" class="iso-prof-conf" data-key="${esc(f.key)}" ${s.confirmed ? 'checked' : ''} ${canEdit ? '' : 'disabled'}/> Confirmed ${_profConfirmNote(s)}</label>
    </div>`;
  }
  function _profAddItem(key) {
    const host = document.querySelector(`.iso-prof-list[data-key="${CSS.escape(key)}"] .iso-prof-items`);
    if (!host) return;
    host.insertAdjacentHTML('beforeend', _profItemRowHtml(key, { id: '', text: '', confirmed: false }, true));
    const inputs = host.querySelectorAll('.iso-prof-item');
    inputs[inputs.length - 1].focus();
  }
  async function fillClientProfile(audit) {
    const host = document.getElementById('iso-client-profile');
    if (!host) return;
    let prof;
    try { prof = await api('profile.get', { clientId: audit.client_id }); }
    catch (e) { host.innerHTML = `<div style="color:#b91c1c;font-size:12px">Could not load the client profile: ${esc(e.message)}</div>`; return; }
    _prof = { clientId: audit.client_id, rowVersion: prof.rowVersion };
    const client = (_DB().clients || []).find(c => c.id === audit.client_id);
    const clientName = client ? (root.clientDisplayTitle ? root.clientDisplayTitle(client) : client.name) : audit.client_id;
    const general = prof.schema.filter(f => !f.sensitive), sensitive = prof.schema.filter(f => f.sensitive);
    host.innerHTML = `
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">Client profile — shared by all ${esc(clientName)} ISO boards</div>
      <div style="font-size:12px;color:#6b8399;margin-bottom:14px">Used to prepare document generator prompts. Only values ticked Confirmed are presented as fact; anything else becomes an "information required" placeholder.</div>
      <div class="iso-field-grid">${general.map(f => _profFieldHtml(f, prof.fields[f.key], prof.canEdit)).join('')}</div>
      <div style="font-weight:700;font-size:12px;margin:14px 0 4px">Client-internal information <span style="font-weight:400;color:#b45309">(sensitive — only included in a prompt when you leave it switched on)</span></div>
      <div class="iso-field-grid">${sensitive.map(f => _profFieldHtml(f, prof.fields[f.key], prof.canEdit)).join('')}</div>
      ${prof.canEdit ? `<button class="btn btn-teal btn-sm" id="iso-prof-save" style="margin-top:14px" onclick="ISO._profSave()">Save client profile</button>` : '<div style="font-size:11px;color:#8da2b2;margin-top:10px">Read only — editing needs contributor access to one of this client\'s boards.</div>'}`;
  }
  async function _profSave() {
    if (!_prof) return;
    const changes = {};
    document.querySelectorAll('#iso-client-profile .iso-prof-val').forEach(el => {
      const conf = document.querySelector(`#iso-client-profile .iso-prof-conf[data-key="${CSS.escape(el.dataset.key)}"]`);
      changes[el.dataset.key] = { value: el.value, confirmed: !!(conf && conf.checked) };
    });
    document.querySelectorAll('#iso-client-profile .iso-prof-list').forEach(list => {
      changes[list.dataset.key] = [...list.querySelectorAll('.iso-prof-item-row')].map(row => {
        const input = row.querySelector('.iso-prof-item');
        return { id: input.dataset.id || undefined, text: input.value, confirmed: !!row.querySelector('.iso-prof-item-conf').checked };
      });
    });
    try {
      const saved = await mutate('profile.set', { clientId: _prof.clientId, changes: changes, expectedVersion: _prof.rowVersion });
      _prof.rowVersion = saved.rowVersion;
      root.showToast ? root.showToast('Client profile saved.') : null;
      fillClientProfile({ client_id: _prof.clientId });
    } catch (e) { root.showToast ? root.showToast('Could not save the client profile: ' + e.message, true) : alert(e.message); }
  }

  // The app's own showPrompt, never the native window.prompt — a native dialog blocks the page (and
  // hangs a Puppeteer run with no handler); A49's first rule. This one predated that rule.
  function _saveAsTemplate(auditId) {
    const ask = root.showPrompt || ((t, d, cb) => cb(null));
    ask('Template name?', '', async name => {
      if (!name || !String(name).trim()) return;
      try { await mutate('template.createFromAudit', { auditId: auditId, name: String(name).trim() }); root.showToast ? root.showToast('Template saved.') : null; }
      catch (e) { root.showToast ? root.showToast('Could not save template: ' + e.message, true) : alert(e.message); }
    });
  }
  // Archive sits in the board header (managers only) and asks first, with the app's own confirm and
  // never a native dialog (A49). The board then waits in Archive & Bin, where an admin can restore it.
  function canArchiveLocally() { const r = _myAuditRole(); return r === 'admin' || r === 'lead_auditor' || r === 'audit_manager'; }
  function _archiveBoard(auditId) {
    const ref = _auditCache && _auditCache.id === auditId ? _auditCache.ref : 'This board';
    const go = async () => {
      if (root.closeConfirm) root.closeConfirm();
      try { await mutate('audit.archive', { auditId: auditId }); if (root.showToast) root.showToast('Board archived. An admin can restore it from Archive & Bin.'); openLanding(); }
      catch (e) { if (root.showToast) root.showToast('Could not archive: ' + e.message, true); }
    };
    if (root.openConfirm) root.openConfirm('Archive this ISO board?', ref + ' moves to Archive & Bin and leaves the ISO list. An admin can restore it from there.', 'Archive', go, false);
  }
  // Archive & Bin's ISO card (index.html renders the placeholder for admins, then calls this).
  // Restore, or Remove from bin (hidden for good, record kept). ISO records are never hard-deleted.
  async function fillArchiveCard() {
    const el = document.getElementById('iso-archive-card'); if (!el) return;
    let rows;
    try { rows = await api('audit.listArchived', {}); }
    catch (e) { el.innerHTML = `<div class="card iso-bin-empty">Could not load archived ISO boards: ${esc(e.message)}</div>`; return; }
    if (!document.body.contains(el)) return;
    const clients = _DB().clients || [];
    const when = s => s ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    el.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
      <div class="iso-bin-h"><div class="iso-bin-t">ISO boards <span class="iso-bin-n">${rows.length}</span></div></div>
      ${rows.length ? rows.map(a => { const c = clients.find(x => x.id === a.client_id); return `<div class="iso-bin-row"><div class="iso-bin-main"><b>${esc(a.title || a.ref)}</b><span>${c ? `<i>${esc(c.name)}</i>` : ''}<i>${esc(a.ref)}</i></span></div><span class="iso-bin-when">${when(a.archived_at)}</span><button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" data-iso-restore="${esc(a.id)}" onclick="ISO._restoreBoard(this.dataset.isoRestore)">↩ Restore</button><button type="button" class="btn btn-danger btn-sm" style="font-size:11px" data-iso-remove="${esc(a.id)}" data-iso-ref="${esc(a.ref)}" onclick="ISO._removeFromBin(this.dataset.isoRemove, this.dataset.isoRef)">Remove</button></div>`; }).join('') : '<div class="iso-bin-empty">No archived ISO boards</div>'}
      <div class="iso-bin-note">ISO audit records are never deleted, so the audit trail stays complete. Restore puts a board back in the ISO list. Remove takes it out of here for good and keeps the record.</div>
    </div>`;
  }
  function _removeFromBin(auditId, ref) {
    const go = async () => {
      if (root.closeConfirm) root.closeConfirm();
      try { await mutate('audit.removeFromBin', { auditId: auditId }); if (root.showToast) root.showToast('Removed from Archive & Bin. The audit record is kept.'); await fillArchiveCard(); }
      catch (e) { if (root.showToast) root.showToast('Could not remove: ' + e.message, true); }
    };
    if (root.openConfirm) root.openConfirm('Remove from Archive & Bin?', (ref || 'This board') + ' disappears from Task Hub for good. Its audit record stays in the database for the audit trail, and only a database admin can bring it back.', 'Remove', go);
  }
  async function _restoreBoard(auditId) {
    try { await mutate('audit.restore', { auditId: auditId }); if (root.showToast) root.showToast('ISO board restored.'); await fillArchiveCard(); if (root._isoEnabled) renderSidebar(); }
    catch (e) { if (root.showToast) root.showToast('Could not restore: ' + e.message, true); }
  }

  // Closing a board asks for its maintenance audit date (D31): shown, and filled with 12 months on.
  function _setStageChanged(stage) {
    const wrap = document.getElementById('iso-set-maint-wrap'), input = document.getElementById('iso-set-maint');
    if (!wrap || !input) return;
    wrap.style.display = stage === 'closed' ? '' : 'none';
    if (stage === 'closed' && !input.value) { const d = new Date(); d.setFullYear(d.getFullYear() + 1); input.value = d.toISOString().slice(0, 10); }
  }
  // The maintenance cycle on a board (D31): what it follows, and the next one — start it, or open it.
  function maintenanceCardHtml(audit, isManager) {
    const parts = [];
    if (audit.previous) parts.push(`<div class="iso-maint-line">This is the maintenance audit of <strong>${esc(audit.previous.ref)}</strong>. <button type="button" class="iso-tb-btn" data-id="${esc(audit.previous.id)}" onclick="ISO.openBoard(this.dataset.id)">Open ${esc(audit.previous.ref)}</button></div>`);
    if (audit.stage === 'closed') {
      const today = new Date().toISOString().slice(0, 10), late = audit.maintenance_due && audit.maintenance_due < today;
      parts.push(`<div class="iso-maint-line">Completed${audit.completed_at ? ' ' + esc(fmtTs(audit.completed_at)) : ''}. Maintenance audit due <strong${late ? ' class="iso-maint-late"' : ''}>${audit.maintenance_due ? esc(fmtDate(audit.maintenance_due)) : 'not set'}</strong>${late ? ' — overdue' : ''}.</div>`);
      if (audit.successor) parts.push(`<div class="iso-maint-line">The maintenance audit has been started: <strong>${esc(audit.successor.ref)}</strong>. <button type="button" class="iso-tb-btn" data-id="${esc(audit.successor.id)}" onclick="ISO.openBoard(this.dataset.id)">Open ${esc(audit.successor.ref)}</button></div>`);
      else if (isManager) parts.push(`<div class="iso-maint-line"><button type="button" class="btn btn-teal btn-sm iso-maint-start" data-id="${esc(audit.id)}" onclick="ISO._openStartNext(this.dataset.id)">Start follow-up / maintenance…</button><span class="iso-maint-hint">A follow-up checks only the findings, actions and clauses you pick; a maintenance audit is next year's full board with this year's results as its baseline. Open items carry over; accepted evidence is offered as suggestions.</span></div>`);
    }
    if (!parts.length) return '';
    return `<div class="card iso-maint-card" style="padding:16px 20px;margin-top:16px;max-width:720px"><div style="font-weight:700;font-size:13px;margin-bottom:8px">Maintenance audit</div>${parts.join('')}</div>`;
  }
  function _startMaintenance(auditId) {
    const go = async () => {
      try {
        const r = await mutate('audit.startMaintenance', { auditId: auditId });
        const su = r.summary || {};
        root.showToast ? root.showToast(`${r.audit.ref} started — ${su.findings || 0} findings and ${su.actions || 0} actions carried over, ${su.evidence || 0} evidence records suggested.`) : null;
        openBoard(r.audit.id);
      } catch (e) { root.showToast ? root.showToast('Could not start the maintenance audit: ' + e.message, true) : alert(e.message); }
    };
    if (root.openConfirm) root.openConfirm('Start maintenance audit?', 'Creates next year\'s board for the same client and standards. This board stays closed as it is.', 'Start', () => { if (root.closeConfirm) root.closeConfirm(); go(); }, false); // openConfirm leaves closing to its caller
    else go();
  }

  async function saveSettings(auditId, expectedVersion) {
    const patch = {
      title: document.getElementById('iso-set-title').value,
      scope_text: document.getElementById('iso-set-scope').value,
      planned_start: document.getElementById('iso-set-start').value || null,
      planned_end: document.getElementById('iso-set-end').value || null,
      report_due: document.getElementById('iso-set-due').value || null,
    };
    // D31: stage, and the maintenance audit date once the board is closed (blank = 12 months on).
    const stageEl = document.getElementById('iso-set-stage');
    if (stageEl) {
      patch.stage = stageEl.value;
      if (stageEl.value === 'closed') patch.maintenance_due = document.getElementById('iso-set-maint').value || null;
    }
    try {
      await mutate('audit.update', { auditId: auditId, patch: patch, expectedVersion: expectedVersion });
      root.showToast ? root.showToast('Saved.') : null;
      root.renderView('iso');
    } catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }

  // ── Access modal (plan 5.4 step 3 / 5.5 Access) — same look/classes as openBoardShareModal,
  // called directly rather than through it (that function is hardcoded to DB.workboards). ───────
  // D35/R2 (P10): roles become Lead Auditor / Auditor / Viewer. 'audit_manager'/'contributor' are
  // no longer offered here (server still accepts them on an existing row — nothing force-migrates).
  const AUDIT_ROLES = ['lead_auditor', 'auditor', 'reviewer'];
  const AUDIT_ROLE_LABEL = { lead_auditor: 'Lead Auditor', audit_manager: 'Lead Auditor', auditor: 'Auditor', contributor: 'Auditor', reviewer: 'Viewer' };
  function accessStepHtml(state) {
    const staff = (_DB().users || []).filter(u => u.role !== 'client' && u.active !== false);
    const added = state.members || [];
    const addedIds = new Set(added.map(m => m.uid));
    const owner = (_DB().users || []).find(u => u.id === (_auditCache && _auditCache.owner_uid)) || (_cu() || {});
    // "Senior reviewer" (can_verify) is a permission on top of the auditor role, never a role of its
    // own — deliberately not called "Reviewer", which already names the read-only audit role above.
    const row = (uid, name, roleHtml, extraHtml, removable) => `
      <div class="iso-access-row">
        ${root.avatarHtml ? root.avatarHtml({ color: '#97bcbd', initials: (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') }, 26) : ''}
        <span class="iso-access-name">${esc(name)}</span>
        <span class="iso-access-controls">${roleHtml}${extraHtml}</span>
        ${removable ? `<button type="button" class="iso-access-remove" title="Remove" onclick="ISO._wizRemoveMember('${esc(uid)}')"><span aria-hidden="true">✕</span></button>` : '<span class="iso-access-remove-ph"></span>'}
      </div>`;
    return `
    <div class="iso-access-section">
      <label class="form-label">Visibility</label>
      <select id="iso-wiz-vis" class="form-input" style="height:34px" onchange="ISO._wizSetVis(this.value)">
        <option value="all_internal"${state.visibility === 'all_internal' ? ' selected' : ''}>All internal staff</option>
        <option value="private"${state.visibility === 'private' ? ' selected' : ''}>Private (invite only)</option>
      </select>
    </div>
    <div class="iso-access-section">
      <div class="iso-access-heading">People with access</div>
      ${row(owner.id, owner.name || 'You', '<span class="iso-access-fixed-role">Owner · Lead Auditor</span>', '<span class="iso-access-fixed-sr" title="The Lead Auditor always holds final review and approval, and the senior reviewer permission.">Senior reviewer</span>', false)}
      ${added.map(m => {
        // member.list's user_uid can be the offline-prefixed id ("offline:u2") or a signed-in user's
        // Supabase uid — match all three forms (as _uidName does), or the row silently vanished.
        const u = staff.find(x => x.id === m.uid || 'offline:' + x.id === m.uid || (x.supabase_uid && x.supabase_uid === m.uid)); if (!u) return '';
        const roleHtml = `<select class="form-input" style="height:28px;font-size:11px" onchange="ISO._wizSetRole('${esc(m.uid)}',this.value)">${AUDIT_ROLES.map(r => `<option value="${r}"${m.auditRole === r ? ' selected' : ''}>${esc(AUDIT_ROLE_LABEL[r] || r)}</option>`).join('')}</select>`;
        const srHtml = m.auditRole === 'lead_auditor' ? '<span class="iso-access-fixed-sr" title="The Lead Auditor always holds the senior reviewer permission.">Senior reviewer</span>'
          : m.auditRole === 'auditor' ? `<label class="iso-access-sr"><input type="checkbox" ${m.canVerify ? 'checked' : ''} onchange="ISO._wizSetVerify('${esc(m.uid)}',this.checked)"/> Senior reviewer</label>` : '<span class="iso-access-sr-ph"></span>';
        return row(m.uid, u.name, roleHtml, srHtml, true);
      }).join('')}
    </div>
    <div class="iso-access-add">
      <select id="iso-wiz-add-user" class="form-input" style="height:32px;flex:1">
        <option value="">Add staff member…</option>
        ${staff.filter(u => !addedIds.has(u.id) && !addedIds.has('offline:' + u.id) && !(u.supabase_uid && addedIds.has(u.supabase_uid)) && u.id !== (_cu() && _cu().id)).map(u => `<option value="${u.id}">${esc(u.name)}${u.supabase_uid ? '' : ' (has not signed in yet)'}</option>`).join('')}
      </select>
      <button onclick="ISO._wizAddMember()" class="btn btn-teal btn-sm" style="height:32px">Add</button>
    </div>`;
  }

  // ── New ISO board wizard (plan 5.4) — 3 steps: client, standards, access. Reused by the "Import
  // workbook…" entry point (opts.thenImport), which skips straight into the import UI once the
  // board is created instead of just opening it (the board already exists with every requirement
  // copied in at not_started — the import then updates matched rows with the workbook's real D/E/F/G,
  // via the same merge logic a re-import uses; see plan 4.6 / iso/iso-import.js). ─────────────────
  let wiz = null;
  function _wizSetVis(v) { wiz.visibility = v; }
  function _wizAddMember() {
    const sel = document.getElementById('iso-wiz-add-user'); const uid = sel && sel.value;
    if (!uid) return;
    // D35/R2: Auditor is the default for a newly added staff member — Contributor is no longer
    // offered as a selectable role (the access dropdown no longer lists it).
    wiz.members.push({ uid: uid, auditRole: 'auditor', canVerify: true });
    renderWizStep();
  }
  // Mirrors api/_iso.js's DEFAULT_MEMBER_FLAGS: switching a member to Lead Auditor or Auditor
  // starts them as a senior reviewer (Actions), switching to Viewer clears it.
  function _wizSetRole(uid, role) { const m = wiz.members.find(x => x.uid === uid); if (!m) return; m.auditRole = role; m.canVerify = role === 'auditor' || role === 'lead_auditor'; if (wiz.step === 3) renderWizStep(); }
  function _wizSetVerify(uid, checked) { const m = wiz.members.find(x => x.uid === uid); if (m) m.canVerify = checked; }
  function _wizRemoveMember(uid) { wiz.members = wiz.members.filter(m => m.uid !== uid); renderWizStep(); }

  function wizClientStepHtml() {
    const clients = (_DB().clients || []).filter(c => c.active !== false && !c.archived)
      .sort((a, b) => (root.clientDisplayTitle ? root.clientDisplayTitle(a) : a.name).localeCompare(root.clientDisplayTitle ? root.clientDisplayTitle(b) : b.name));
    const isAdmin = _cu() && _cu().role === 'admin';
    return `<input class="form-input" placeholder="Search clients…" oninput="ISO._wizFilterClients(this.value)" style="margin-bottom:10px"/>
    <div id="iso-wiz-client-list" style="max-height:280px;overflow:auto">
      ${clients.map(c => `<div class="iso-wiz-client-row${wiz.clientId === c.id ? ' active' : ''}" data-name="${esc((root.clientDisplayTitle ? root.clientDisplayTitle(c) : c.name)).toLowerCase()}" onclick="ISO._wizPickClient('${esc(c.id)}')">
        <span class="iso-client-dot" style="background:${esc(c.color || '#64748b')}"></span>${esc(root.clientDisplayTitle ? root.clientDisplayTitle(c) : c.name)}
      </div>`).join('')}
    </div>
    <div style="margin-top:10px;font-size:12px;color:#8da2b2">Client not listed?
      ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="closeGenericModal&&closeGenericModal();navigate('clients')">Add it in the Client Manager</button>` : 'Ask an admin to add it in the Client Manager.'}
    </div>`;
  }
  function _wizFilterClients(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#iso-wiz-client-list .iso-wiz-client-row').forEach(el => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; });
  }
  function _wizPickClient(id) { wiz.clientId = id; renderWizStep(); }

  // Approved editions of one standard, newest first — the same order audit.create's default pick uses.
  function wizApprovedEditions(code) {
    return (wiz.versions || []).filter(v => v.standard_code === code && v.status === 'approved' && v.edition)
      .map(v => v.edition).sort((a, b) => b.localeCompare(a));
  }
  function wizStandardsStepHtml() {
    const opts = [{ code: '9001', label: 'ISO 9001', sub: 'Quality' }, { code: '14001', label: 'ISO 14001', sub: 'Environmental' }, { code: '45001', label: 'ISO 45001', sub: 'OH&S' }];
    // Plan 4b.1: an edition picker appears only once a standard has two approved editions; a board
    // keeps whichever edition it is created on. A standard with no approved library at all gets a
    // pointer to the built-in library rather than a create that will fail.
    const editionRows = wiz.standards.map(code => {
      const eds = wizApprovedEditions(code);
      const anyApproved = (wiz.versions || []).some(v => v.standard_code === code && v.status === 'approved');
      if (wiz.versions && !anyApproved) return `<div class="iso-wiz-nolib" style="font-size:12px;color:#b45309;margin-top:8px">No approved ISO ${esc(code)} library yet — an admin can load the built-in library on the ISO admin page.</div>`;
      if (eds.length < 2) return '';
      const chosen = wiz.editions[code] || eds[0];
      return `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px">ISO ${esc(code)} edition
        <select class="form-input iso-wiz-edition" data-std="${esc(code)}" style="width:auto" onchange="ISO._wizSetEdition('${esc(code)}',this.value)">
          ${eds.map(e => `<option value="${esc(e)}"${e === chosen ? ' selected' : ''}>ISO ${esc(code)}:${esc(e)}${e === eds[0] ? ' (newest)' : ''}</option>`).join('')}
        </select></label>`;
    }).join('');
    return `<div style="display:flex;gap:10px;flex-wrap:wrap">
      ${opts.map(o => `<div class="iso-std-card${wiz.standards.includes(o.code) ? ' active' : ''}" onclick="ISO._wizToggleStandard('${o.code}')">
        <div style="font-weight:700">${o.label}</div><div style="font-size:11px;color:#8da2b2">${o.sub}</div>
      </div>`).join('')}
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="ISO._wizAllStandards()">All three</button>
    ${editionRows}`;
  }
  function _wizSetEdition(code, edition) { wiz.editions[code] = edition; }
  function _wizToggleStandard(code) {
    const i = wiz.standards.indexOf(code);
    if (i === -1) wiz.standards.push(code); else wiz.standards.splice(i, 1);
    renderWizStep();
  }
  function _wizAllStandards() { wiz.standards = ['9001', '14001', '45001']; renderWizStep(); }

  function wizFooterHtml() {
    const canNext = wiz.step === 1 ? !!wiz.clientId : wiz.step === 2 ? wiz.standards.length > 0 : true;
    const backBtn = wiz.step > 1 ? `<button class="btn btn-ghost btn-sm" onclick="ISO._wizBack()">Back</button>` : '<span></span>';
    const nextBtn = wiz.step < 3
      ? `<button class="btn btn-teal btn-sm" ${canNext ? '' : 'disabled'} onclick="ISO._wizNext()">Next</button>`
      : `<button class="btn btn-teal btn-sm" onclick="ISO._wizCreate()">${wiz.thenImport ? 'Create and import…' : 'Create ISO board'}</button>`;
    return `<div style="display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid #f0f4f8">${backBtn}${nextBtn}</div>`;
  }
  function renderWizStep() {
    const titles = { 1: '1 Client', 2: '2 Standards', 3: '3 Access' };
    const stepHtml = wiz.step === 1 ? wizClientStepHtml() : wiz.step === 2 ? wizStandardsStepHtml() : accessStepHtml(wiz);
    const header = `<div style="display:flex;gap:14px;margin-bottom:14px;font-size:11px;color:#8da2b2;text-transform:uppercase;letter-spacing:0.04em">
      ${[1, 2, 3].map(n => `<span style="${n === wiz.step ? 'color:#0d1c33;font-weight:700' : ''}">${esc(titles[n])}</span>`).join('')}
    </div>`;
    const body = document.getElementById('generic-modal-body');
    if (body) body.innerHTML = header + stepHtml + wizFooterHtml();
    else root.openGenericModal('New ISO board', header + stepHtml + wizFooterHtml(), '640px');
  }
  function _wizNext() { if (wiz.step < 3) { wiz.step++; renderWizStep(); } }
  function _wizBack() { if (wiz.step > 1) { wiz.step--; renderWizStep(); } }

  async function _wizCreate() {
    try {
      // Only editions the user actually chose from a picker are sent; anything else gets the server's
      // newest-approved default, so a stale client-side list can never pin the wrong edition.
      const editions = {};
      for (const code of wiz.standards) if (wiz.editions[code] && wizApprovedEditions(code).length > 1) editions[code] = wiz.editions[code];
      const audit = await mutate('audit.create', {
        clientId: wiz.clientId, standards: wiz.standards, visibility: wiz.visibility,
        members: wiz.members.map(m => ({ uid: m.uid, auditRole: m.auditRole })),
        ...(Object.keys(editions).length ? { editions: editions } : {}),
      });
      const doc = document;
      doc.getElementById('generic-modal') && doc.getElementById('generic-modal').classList.add('hidden');
      root.showToast ? root.showToast(`ISO board ${audit.ref} created for the selected client`) : null;
      await renderSidebar();
      // D27: a new board opens on its Dashboard too; with "then import", the import dialog opens on top
      // and the dashboard behind it shows the imported workbook once it is applied.
      openBoard(audit.id);
      if (wiz.thenImport) setTimeout(() => openImport('audit', { targetAuditId: audit.id }), 50);
    } catch (e) { root.showToast ? root.showToast('Could not create ISO board: ' + e.message, true) : alert(e.message); }
  }

  function openNewBoard(opts) {
    wiz = { step: 1, clientId: null, standards: [], editions: {}, versions: null, visibility: 'all_internal', members: [], thenImport: !!(opts && opts.thenImport) };
    root.openGenericModal('New ISO board', '', '640px');
    renderWizStep();
    // Library versions load in the background (step 1 doesn't need them); step 2 re-renders with the
    // edition pickers once they arrive.
    api('library.versions').then(vs => { wiz.versions = vs || []; if (wiz.step === 2) renderWizStep(); }).catch(() => { wiz.versions = null; });
  }

  // ── Access modal (Settings -> Access / board chrome "Shared with") — edits an EXISTING board. ──
  async function openAccessModal() {
    if (!route.auditId) return;
    let members;
    try { members = await api('member.list', { auditId: route.auditId }); } catch (e) { return; }
    const audit = _auditCache;
    // canVerify travels alongside the role so the access modal can show and change who is a senior
    // reviewer — member.list's own can_verify flag (api/_iso.js's DEFAULT_MEMBER_FLAGS), not derived.
    wiz = { step: 3, clientId: audit.client_id, standards: [], visibility: audit.visibility, members: members.filter(m => m.member_kind === 'staff').map(m => ({ uid: m.user_uid, auditRole: m.audit_role, canVerify: !!m.can_verify })), thenImport: false, editingAuditId: audit.id };
    root.openGenericModal(`ISO board access — ${esc(audit.ref)}`, '', '600px');
    const body = document.getElementById('generic-modal-body');
    body.innerHTML = accessStepHtml(wiz) + `<div style="display:flex;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid #f0f4f8">
      <button class="btn btn-teal btn-sm" onclick="ISO._saveAccess()">Save</button></div>`;
  }
  async function _saveAccess() {
    try {
      await mutate('audit.setAccess', { auditId: wiz.editingAuditId, visibility: wiz.visibility, expectedVersion: _auditCache.row_version });
      const existing = await api('member.list', { auditId: wiz.editingAuditId });
      const existingById = new Map(existing.filter(m => m.member_kind === 'staff').map(m => [m.user_uid, m]));
      const wantedIds = new Set(wiz.members.map(m => m.uid));
      for (const m of wiz.members) {
        const was = existingById.get(m.uid);
        // can_verify only means anything for an auditor (audit_manager always can verify, regardless
        // of the flag; contributor/reviewer never can) — never sent for any other role, so toggling
        // it before switching a member's role away from auditor can't leave a stray server value.
        const patch = { auditRole: m.auditRole };
        if (m.auditRole === 'auditor') patch.can_verify = !!m.canVerify;
        if (was) { if (was.audit_role !== m.auditRole || !!was.can_verify !== !!patch.can_verify) await mutate('member.update', { auditId: wiz.editingAuditId, uid: m.uid, patch: patch }); }
        else {
          await mutate('member.add', { auditId: wiz.editingAuditId, uid: m.uid, auditRole: m.auditRole, memberKind: 'staff' });
          // member.add always starts an auditor as a senior reviewer (the default flags) — only
          // follow up if this one was explicitly turned off before the member even existed.
          if (m.auditRole === 'auditor' && !m.canVerify) await mutate('member.update', { auditId: wiz.editingAuditId, uid: m.uid, patch: { can_verify: false } });
        }
      }
      for (const m of existing) { if (m.member_kind === 'staff' && !wantedIds.has(m.user_uid) && !['lead_auditor', 'audit_manager'].includes(m.audit_role)) await mutate('member.remove', { auditId: wiz.editingAuditId, uid: m.user_uid }); }
      document.getElementById('generic-modal').classList.add('hidden');
      root.showToast ? root.showToast('Access updated.') : null;
      root.renderView('iso');
    } catch (e) { root.showToast ? root.showToast('Could not update access: ' + e.message, true) : alert(e.message); }
  }

  // ── Main render entry points ────────────────────────────────────────────────────────────────
  function render(vc) {
    if (!route.auditId && route.programmeClientId) { setTimeout(fillProgramme, 0); return landingSkeleton(); } // B4.4
    if (!route.auditId) {
      setTimeout(fillLanding, 0);
      return landingSkeleton();
    }
    setTimeout(fillBoard, 0);
    return boardSkeleton();
  }
  async function fillBoard() {
    const vc = document.getElementById('view-container');
    if (!vc) return;
    let audit, members;
    try {
      // In parallel — one round trip of waiting behind the placeholder instead of two.
      [audit, members] = await Promise.all([api('audit.get', { auditId: route.auditId }), api('member.list', { auditId: route.auditId })]);
    } catch (e) {
      vc.innerHTML = `<div class="card" style="padding:20px;color:#b91c1c">Could not open this ISO board: ${esc(e.message)}</div>`;
      return;
    }
    _auditCache = audit;
    _membersCache = members;
    _refreshTopbarClient();
    const shell = inner => { vc.innerHTML = boardShell(audit, route.tab, inner); };
    if (route.tab === 'requirements') { shell(`<div id="iso-req-tab">${skeletonFor('table')}</div>`); fillRequirementsTab(audit); return; }
    if (route.tab === 'documents') { shell(`<div id="iso-doc-tab">${skeletonFor('table')}</div>`); fillDocumentsTab(audit); return; }
    if (route.tab === 'worklist') { shell(`<div id="iso-wl-tab">${skeletonFor('table')}</div>`); fillWorklistTab(audit); return; }
    if (route.tab === 'findings') { shell(`<div id="iso-fnd-tab">${skeletonFor('table')}</div>`); fillFindingsTab(audit); return; }
    if (route.tab === 'actions') { shell(`<div id="iso-act-tab">${skeletonFor('table')}</div>`); fillActionsTab(audit); return; }
    if (route.tab === 'actionplan') { shell(`<div id="iso-ganttact-tab">${skeletonFor('gantt')}</div>`); fillActionPlanTab(audit); return; }
    if (route.tab === 'dashboard') { shell(`<div id="iso-dash-tab">${skeletonFor('dashboard')}</div>`); if (_dash.mode === 'full') fillDashboardTab(audit); else fillOverviewTab(audit); return; }
    if (route.tab === 'evidence') { shell(`<div id="iso-evd-tab">${skeletonFor('table')}</div>`); fillEvidenceTab(audit); return; }
    shell(route.tab === 'settings' ? settingsTabHtml(audit, members) : '');
    if (route.tab === 'settings') { fillClientProfile(audit); _fillSetupSites(audit, _cu() && (_cu().role === 'admin' || ['lead_auditor', 'audit_manager'].includes((members.find(m => m.user_uid === _cu().id || m.user_uid === 'offline:' + _cu().id) || {}).audit_role))); }
  }

  // navigate()'s own topbar client-line logic (index.html) runs synchronously and reads
  // ISO.currentClient(), which is null until fillBoard()'s async audit.get resolves — unlike a
  // workboard's client, which is already sitting in the synced DB with no fetch needed. This fills
  // in the same title-bar markup navigate() would have used, once the data actually exists.
  function _refreshTopbarClient() {
    const vt = document.getElementById('view-title');
    if (!vt || route.tab === undefined || !route.auditId) return;
    const cli = currentClient();
    const logo = cli && cli.logo ? `<img src="${esc(cli.logo)}" alt="" class="vt-logo"/>` : '';
    vt.innerHTML = logo + `<span>${esc(cli ? (root.clientDisplayTitle ? root.clientDisplayTitle(cli) : cli.name) : 'No client set')}</span>`;
    vt.classList.add('vt-client');
    vt.style.display = '';
  }

  // ── Requirements register (plan Phase 6.1) — reuses the generic Main Table ctx from Phase 1-2
  // (_mtRenderGeneric/_mtCellCommit/_mtCellClick), unlike the landing page's bespoke table (A30):
  // this genuinely needs the same inline-editable-grid machinery a workboard uses, just against a
  // different data source. index.html's `_mtCtx` is a `let` binding this file can't set directly
  // (same problem as A31) — `window._isoSetMtCtx()` is the bridge. ─────────────────────────────────
  const STANDARD_COLOR = { '9001': '#0d1c33', '14001': '#31585a', '45001': '#8a4f1d' }; // wireframe --q/--e/--s
  const STANDARD_ORDER = ['9001', '14001', '45001'];
  // One block per standard — coloured letter chip, standard name and count, its items beneath under a
  // left rule in the same colour — so a list spanning Q/E/S reads as three groups, not one jumble.
  // Items with no standard (a finding, an action) group last under `otherLabel`.
  function groupByStandardHtml(items, stdOf, renderItem, otherLabel) {
    const groups = new Map();
    for (const it of items) { const c = stdOf(it) || ''; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    const rank = c => { const i = STANDARD_ORDER.indexOf(c); return i < 0 ? (c ? 50 : 99) : i; };
    return [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(c => {
      const rows = groups.get(c);
      return `<div class="iso-std-group" data-std="${esc(c)}" style="--std:${STANDARD_COLOR[c] || '#6b8399'}">
        <div class="iso-std-group-h">${c ? `<span class="iso-std-chip" aria-hidden="true">${esc(STANDARD_BADGE[c] || '•')}</span>${esc(stdLabel(c))}` : `<span class="iso-std-chip" aria-hidden="true">•</span>${esc(otherLabel || 'Other')}`}<span class="iso-std-group-n">${rows.length}</span></div>
        ${rows.map(renderItem).join('')}</div>`;
    }).join('');
  }
  // Inline form for one-line summaries: "[Q] 4.1, 5.2  [E] 6.1" — a coloured chip per standard.
  function stdChipsInline(items, stdOf, textOf) {
    const groups = new Map();
    for (const it of items) { const c = stdOf(it) || ''; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    const rank = c => { const i = STANDARD_ORDER.indexOf(c); return i < 0 ? (c ? 50 : 99) : i; };
    return [...groups.keys()].sort((a, b) => rank(a) - rank(b)).map(c => `<span class="iso-std-inline" data-std="${esc(c)}" style="--std:${STANDARD_COLOR[c] || '#6b8399'}">${c ? `<span class="iso-std-chip" title="${esc(stdLabel(c))}">${esc(STANDARD_BADGE[c] || '•')}</span>` : ''}${esc(groups.get(c).map(textOf).join(', '))}</span>`).join(' ');
  }
  const ASSESSMENT_STATE_LABEL = { not_started: 'Not started', in_progress: 'In progress', awaiting_evidence: 'Awaiting evidence', needs_follow_up: 'Needs follow-up', complete: 'Complete' };
  const ASSESSMENT_RESULT_LABEL = { not_implemented: 'Not implemented', no_evidence_provided: 'No evidence provided', partially_implemented: 'Partially implemented', implemented_ineffective: 'Implemented (ineffective)', implemented_effective: 'Implemented (effective)', not_applicable: 'Not applicable' };
  // Mirrors api/_iso.js's own ASSESSMENT_STATES/ASSESSMENT_RESULTS (plan §6.1) — derived from the
  // *_LABEL maps' own keys above so the two never drift apart; the server is still the sole source
  // of truth that actually enforces these values, this is just for building select options.
  const ASSESSMENT_STATES = Object.keys(ASSESSMENT_STATE_LABEL);
  const ASSESSMENT_RESULTS = Object.keys(ASSESSMENT_RESULT_LABEL);
  // D30: Not applicable is set under Applicability (with its justification), never as a result.
  const RESULT_CHOICES = ASSESSMENT_RESULTS.filter(r => r !== 'not_applicable');
  const APPLICABILITY_LABEL = { applicable: 'Applicable', review: 'Under review', not_applicable: 'Not applicable' };
  // D35/R2 (P4): one status replaces assessment_state + assessment_result + applicability +
  // effectiveness. The register/drawer read and write only this field now; api/_iso.js derives the
  // retired fields above so isoCalc.js and the dashboard (R5, not yet rebuilt) stay correct untouched.
  // D44 (2026-10-06): OFI is a flag on Compliant / Partially Compliant ("Compliant · OFI"), not a
  // status — the OFI button stores Compliant + ofi. D45: "Outside this audit's scope" is a status.
  const COMPLIANCE_STATUS_LABEL = { not_assessed: 'Not assessed', compliant: 'Compliant', partially_compliant: 'Partially Compliant', non_compliant: 'Non-Compliant', not_applicable: 'N/A', out_of_scope: 'Out of scope' };
  const COMPLIANCE_STATUS_FULL = { ofi: 'Opportunity for Improvement', not_applicable: 'Not Applicable', out_of_scope: "Outside this audit's scope" };
  const COMPLIANCE_STATUS_COLOR = { not_assessed: '#94a3b8', compliant: '#2b7356', partially_compliant: '#87590a', non_compliant: '#a8362d', ofi: '#45579a', not_applicable: '#56606e', out_of_scope: '#7a8799' }; // wireframe --c/--pc/--nc/--ofi/--nap
  const COMPLIANCE_STATUSES = Object.keys(COMPLIANCE_STATUS_LABEL);
  // D48: why a Partially Compliant / Non-Compliant clause falls short (the old workbook's vocabulary).
  const GAP_REASON_LABEL = { not_implemented: 'Not implemented', ineffective: 'Implemented but ineffective', no_evidence: 'No evidence provided' };
  const isGapStatus = cs => cs === 'partially_compliant' || cs === 'non_compliant';
  // Mirrors api/_iso.js basisProblem (D46–D48) so the screen explains itself; the server still decides.
  function basisProblemLocal(r) {
    const cs = r.compliance_status || 'not_assessed';
    if (cs === 'not_assessed' || cs === 'out_of_scope') return null;
    if (r.derived_from_id) return 'Derived from a related clause — confirm it first.';
    if (cs !== 'not_applicable' && !String(r.current_system || '').trim()) return 'Basis missing — write the current system (what you saw) first.';
    if (cs !== 'not_applicable' && root.IsoChecks && !root.IsoChecks.hasOwnText(r.current_system, confirmItemsLocal(r.id))) return 'Basis missing — the ticked checks are in; add what you saw.';
    if (isGapStatus(cs) && !r.gap_reason) return 'Gap reason missing — pick why it falls short.';
    return null;
  }
  // The clause's cheat-sheet CONFIRM points (requirement.guidance), the tick boxes under Assessment.
  function confirmItemsLocal(id) {
    const g = (_req.guidance || {})[id];
    return (g && g.cheatSheet && g.cheatSheet.confirm) || [];
  }
  // A clause needs an action when it falls short, or carries an OFI (D44).
  function needsAction(r) { return isGapStatus(r.compliance_status) || (r.compliance_status === 'compliant' && !!r.ofi); }
  function statusText(r) { const cs = r.compliance_status || 'not_assessed'; return complianceLabel(cs) + (r.ofi && (cs === 'compliant' || cs === 'partially_compliant') ? ' · OFI' : ''); }
  // The approval mark (P7): a status is proposed by whoever set it, approved or returned by the
  // Lead Auditor. null until a status exists — nothing to approve yet.
  const APPROVAL_STATE_LABEL = { proposed: 'Awaiting Lead approval', approved: 'Approved', returned: 'Returned' };
  const APPROVAL_STATE_COLOR = { proposed: '#b45309', approved: '#0d6e4e', returned: '#b91c1c' };
  function complianceColor(s) { return COMPLIANCE_STATUS_COLOR[s] || '#94a3b8'; }
  function complianceLabel(s) { return COMPLIANCE_STATUS_LABEL[s] || s; }
  const VISIBILITY_LABEL = { internal: 'Internal', client_selected: 'Selected clients', client_all: 'All client members' };
  // R3 (D35 P2/P3): the register is no longer a grid — a column menu has nothing left to configure.
  // Each clause is one inline-expanding row (reqRowHtml, below): status pill, a doc-count placeholder
  // (real counts arrive with R4's Documents view), related-clause dots and the approval pill, in a
  // fixed order every row shares. Opening a row expands it in place instead of opening the drawer.

  // D35/R2 (P2): "A status filter replaces the quick views: Not assessed · Needs action · Awaiting
  // approval · Returned." Client-visible and Evidence to review are independent of the status model
  // and stay as they were.
  const QUICK_VIEWS = [
    { id: 'all', label: 'All requirements', where: [] },
    { id: 'not_assessed', label: 'Not assessed', where: [{ field: 'compliance_status', op: 'in', value: ['not_assessed'] }] },
    { id: 'needs_action', label: 'Needs action', where: [{ field: '_needsAction', op: 'in', value: [true] }] },
    // D46: assessed, but the basis or gap reason is still missing (derived rows have their own mark).
    { id: 'needs_basis', label: 'Needs basis', where: [{ field: '_needsBasis', op: 'in', value: [true] }] },
    { id: 'client_visible', label: 'Client-visible', where: [{ field: 'visibility', op: 'in', value: ['client_selected', 'client_all'] }] },
    // 8b.5: a pending evidence suggestion, or a link still waiting for a reviewer's verdict.
    { id: 'evidence_review', label: 'Evidence to review', where: [{ field: '_evdReview', op: 'in', value: [true] }] },
    { id: 'approval_awaiting', label: 'Awaiting approval', where: [{ field: 'approval_state', op: 'in', value: ['proposed'] }] },
    { id: 'returned', label: 'Returned', where: [{ field: 'approval_state', op: 'in', value: ['returned'] }] },
    // B4.3: on a maintenance / follow-up board, clauses whose result moved since the last audit.
    { id: 'changed_since', label: 'Changed since last audit', where: [{ field: '_changedSince', op: 'in', value: [true] }] },
  ];

  // ── D32 senior review ────────────────────────────────────────────────────────────────────────
  // The senior reviewer's verdict, suggested from the assessor's Result. Mirrors api/_iso.js
  // (canSeniorReview = canVerifyAction; seniorVerdictBlocker) so the controls explain themselves;
  // the server still decides.
  const SR_VERDICTS = ['compliant', 'partially_compliant', 'non_compliant', 'na_confirmed'];
  const SR_LABEL = { pending: 'Awaiting senior review', redo: 'Sent back for redo', compliant: 'Compliant', partially_compliant: 'Partially compliant', non_compliant: 'Non-compliant', na_confirmed: 'N/A confirmed' };
  const SR_SHORT = Object.assign({}, SR_LABEL, { pending: 'To review', redo: 'Redo' });
  const SR_COLOR = { pending: '#64748b', redo: '#7c3aed', compliant: '#0d6e4e', partially_compliant: '#b45309', non_compliant: '#b91c1c', na_confirmed: '#475569' };
  const SR_ICON = { pending: '○', redo: '↺', compliant: '✓', partially_compliant: '◐', non_compliant: '✕', na_confirmed: '✓' };
  const SR_FROM_RESULT = { implemented_effective: 'compliant', partially_implemented: 'partially_compliant', implemented_ineffective: 'partially_compliant', not_implemented: 'non_compliant', no_evidence_provided: 'non_compliant' };
  function srStatus(row) { return (row && row.senior_review_status) || 'pending'; }
  function srReady(row) { return row.assessment_result != null || row.applicability === 'not_applicable'; }
  function srSuggested(row) { return row.applicability === 'not_applicable' ? 'na_confirmed' : (SR_FROM_RESULT[row.assessment_result] || null); }
  function srIsMine(uid) { const me = (_cu() || {}).id; return !!uid && !!me && (uid === me || uid === 'offline:' + me); }
  function srBlocker(row) {
    if (srIsMine(row.assessed_by)) return 'You recorded this assessment — another senior reviewer must give the verdict.';
    if (!srReady(row)) return 'Nothing to review yet — record a result (or mark it Not applicable) first.';
    return null;
  }
  function srByLine(row) {
    const who = _uidName(row.senior_reviewed_by) || 'a senior reviewer';
    return row.senior_reviewed_at ? `${who}, ${fmtTs(row.senior_reviewed_at)}` : who;
  }
  function srPillHtml(row, cls) {
    const s = srStatus(row);
    return `<span class="${cls}" data-status="${s}" style="--c:${SR_COLOR[s]}"${s !== 'pending' ? ` title="${esc(srByLine(row))}"` : ''}><span class="iso-sr-tick" aria-hidden="true">${s === 'pending' ? '' : SR_ICON[s]}</span>${esc(cls === 'iso-sr-cell' ? SR_SHORT[s] : SR_LABEL[s])}</span>`;
  }
  // The choices a senior reviewer has on this row — the dropdown both the popup header and the
  // register cell open. N/A rows only confirm the N/A; others pick a level, the suggested one marked.
  function srSpec(row) {
    const s = srStatus(row), sug = srSuggested(row);
    const verdicts = row.applicability === 'not_applicable' ? ['na_confirmed'] : ['compliant', 'partially_compliant', 'non_compliant'];
    const opts = verdicts.map(v => ({ value: v, label: SR_LABEL[v] + (v === sug && s !== v ? ' · suggested' : ''), color: SR_COLOR[v] }));
    opts.push({ value: 'redo', label: 'Send back for redo…', color: SR_COLOR.redo });
    if (s !== 'pending') opts.push({ value: 'pending', label: 'Reset to awaiting', color: SR_COLOR.pending });
    return { type: 'select', label: 'Senior review', value: s, options: opts };
  }
  // The control beside the clause popup's ×: the verdict pill, and "Review ▾" for a senior reviewer.
  function reqSeniorHeaderHtml(row) {
    const pill = srPillHtml(row, 'iso-sr-pill');
    if (!canVerifyActionLocally()) return `<div class="iso-sr" role="group" aria-label="Senior review">${pill}</div>`;
    const block = srBlocker(row);
    const label = srStatus(row) === 'pending' ? 'Review' : 'Change';
    return `<div class="iso-sr" role="group" aria-label="Senior review">${pill}<button type="button" class="iso-sr-btn is-review" aria-haspopup="listbox" data-id="${esc(row.id)}"${block ? ` aria-disabled="true" title="${esc(block)}"` : ''} onclick="event.stopPropagation();ISO._reqSeniorPick(this)">${label} <span aria-hidden="true">▾</span></button></div>`;
  }
  // Shown at the top of the Assessment tab: what was sent back, or the verdict and who gave it.
  function reqSeniorNoteHtml(row) {
    const s = srStatus(row);
    if (s === 'redo') return `<div class="card iso-sr-note is-redo"><strong><span aria-hidden="true">↺</span> Sent back for redo</strong> by ${esc(srByLine(row))}<div class="iso-sr-note-body">${esc(row.senior_review_note || '')}</div></div>`;
    if (SR_VERDICTS.includes(s)) return `<div class="card iso-sr-note is-verdict" style="--c:${SR_COLOR[s]}"><strong><span aria-hidden="true">${SR_ICON[s]}</span> Senior verdict: ${esc(SR_LABEL[s])}</strong> by ${esc(srByLine(row))}${row.senior_review_note ? `<div class="iso-sr-note-body">${esc(row.senior_review_note)}</div>` : ''}</div>`;
    if (row.senior_review_note && row.senior_reviewed_by) return `<div class="card iso-sr-note is-again"><strong>Previously sent back</strong> by ${esc(srByLine(row))} — changed since, awaiting senior review again.<div class="iso-sr-note-body">${esc(row.senior_review_note)}</div></div>`;
    return '';
  }
  async function _reqSeniorApply(id, status) {
    const row = _req.requirements.find(r => r.id === id);
    if (!row) throw new Error('Requirement no longer loaded — refresh and try again.');
    let note = null;
    if (status === 'redo') {
      note = await _promptAsync('What needs redoing? The assessor sees this note.');
      if (!note || !note.trim()) return null; // cancelled — nothing changes
    }
    const updated = await mutate('requirement.seniorReview', { auditId: _req.auditId, id: id, status: status, note: note, expectedVersion: row.row_version });
    Object.assign(row, updated);
    return updated;
  }
  function _reqSeniorPick(btn) {
    if (btn.getAttribute('aria-disabled') === 'true') { root.showToast ? root.showToast(btn.title, true) : null; return; }
    const row = _req.requirements.find(r => r.id === btn.dataset.id);
    if (!row || !root._mtOpenDropdown) return;
    root._mtOpenDropdown(btn, srSpec(row), v => _reqSeniorDecide(row.id, v));
  }
  async function _reqSeniorDecide(id, status) {
    try {
      const updated = await _reqSeniorApply(id, status);
      if (!updated) return;
      const modal = document.getElementById('generic-modal');
      if (_openDrawerReqId === id && modal && !modal.classList.contains('hidden')) await openRequirementDrawer(_req.auditId, id, { keepTab: true });
      if (document.getElementById('iso-req-tab')) renderRequirementsTable(_req.auditId);
      const s = srStatus(updated);
      root.showToast ? root.showToast(SR_VERDICTS.includes(s) ? 'Senior verdict: ' + SR_LABEL[s] + '.' : SR_LABEL[s] + '.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not update the senior review: ' + e.message, true) : alert(e.message); }
  }

  // ── D35/R2 (P7): Lead Auditor approval — replaces the per-clause "Review ▾" above in the new
  // UI. Independent of D32/can_verify (Actions, untouched); mirrors api/_iso.js's own
  // isEffectiveLeadAuditor so the controls explain themselves — the server still decides.
  function _assessCapableMembersLocal() { return (_membersCache || []).filter(m => m.member_kind !== 'client' && ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(m.audit_role)); }
  function _isSoleAssessorLocal() {
    const a = _assessCapableMembersLocal(); const me = (_cu() || {}).id;
    return a.length === 1 && !!me && (a[0].user_uid === me || a[0].user_uid === 'offline:' + me);
  }
  function canApproveRequirementLocally() { const r = _myAuditRole(); return r === 'admin' || r === 'lead_auditor' || r === 'audit_manager' || _isSoleAssessorLocal(); }
  // The control beside the clause popup's ×: the approval pill, and Approve/Return for the Lead.
  function reqApprovalHeaderHtml(row) {
    const st = row.approval_state;
    const pill = st ? `<span class="iso-sr-pill" data-status="${st}" style="--c:${APPROVAL_STATE_COLOR[st]}" title="${st === 'approved' && row.approved_by ? esc(_uidName(row.approved_by) || '') : ''}">${esc(APPROVAL_STATE_LABEL[st] || st)}</span>` : (row.compliance_status === 'not_assessed' ? '' : `<span class="iso-sr-pill" data-status="proposed" style="--c:${APPROVAL_STATE_COLOR.proposed}">${esc(APPROVAL_STATE_LABEL.proposed)}</span>`);
    if (!canApproveRequirementLocally() || !row.compliance_status || row.compliance_status === 'not_assessed') return pill ? `<div class="iso-sr" role="group" aria-label="Approval">${pill}</div>` : '';
    if (st === 'approved') return `<div class="iso-sr" role="group" aria-label="Approval">${pill}</div>`;
    return `<div class="iso-sr" role="group" aria-label="Approval">${pill}<button type="button" class="iso-sr-btn is-review" data-id="${esc(row.id)}"${basisProblemLocal(row) ? ` disabled title="${esc(basisProblemLocal(row))}"` : ''} onclick="event.stopPropagation();ISO._reqApprove(this.dataset.id)">Approve</button><button type="button" class="iso-sr-btn" data-id="${esc(row.id)}" onclick="event.stopPropagation();ISO._reqReturn(this.dataset.id)">Return</button></div>`;
  }
  // Shown at the top of the Assessment tab: the return note, or who approved it and when.
  function reqApprovalNoteHtml(row) {
    if (row.approval_state === 'returned') return `<div class="card iso-sr-note is-redo"><strong><span aria-hidden="true">↺</span> Returned</strong> by ${esc(_uidName(row.approved_by || row.assessed_by) || 'the Lead Auditor')}<div class="iso-sr-note-body">${esc(row.return_note || '')}</div></div>`;
    if (row.approval_state === 'approved') return `<div class="card iso-sr-note is-verdict" style="--c:${APPROVAL_STATE_COLOR.approved}"><strong><span aria-hidden="true">✓</span> Approved</strong> by ${esc(_uidName(row.approved_by) || '')}${row.approved_at ? `, ${esc(fmtTs(row.approved_at))}` : ''}</div>`;
    return '';
  }
  async function _reqApprove(id) {
    const row = _req.requirements.find(r => r.id === id); if (!row) return;
    try {
      const updated = await mutate('requirement.approve', { auditId: _req.auditId, id: id, expectedVersion: row.row_version });
      Object.assign(row, updated);
      const modal = document.getElementById('generic-modal');
      if (_openDrawerReqId === id && modal && !modal.classList.contains('hidden')) await openRequirementDrawer(_req.auditId, id, { keepTab: true });
      if (document.getElementById('iso-req-tab')) renderRequirementsTable(_req.auditId);
      root.showToast ? root.showToast('Approved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not approve: ' + e.message, true) : alert(e.message); }
  }
  async function _reqReturn(id) {
    const row = _req.requirements.find(r => r.id === id); if (!row) return;
    const note = await _promptAsync('What should the auditor check? They see this note.');
    if (!note || !note.trim()) return;
    try {
      const updated = await mutate('requirement.return', { auditId: _req.auditId, id: id, note: note.trim(), expectedVersion: row.row_version });
      Object.assign(row, updated);
      const modal = document.getElementById('generic-modal');
      if (_openDrawerReqId === id && modal && !modal.classList.contains('hidden')) await openRequirementDrawer(_req.auditId, id, { keepTab: true });
      if (document.getElementById('iso-req-tab')) renderRequirementsTable(_req.auditId);
      root.showToast ? root.showToast('Returned.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not return: ' + e.message, true) : alert(e.message); }
  }
  // "Approve section"/"Approve all" — every proposed row in the current selection, in one request.
  async function _reqBulkApprove() {
    const ids = _reqSelectedIds();
    if (!ids.length) return;
    try {
      const r = await mutate('requirement.bulkApprove', { auditId: _req.auditId, ids: ids });
      if (root._mtStateFor) root._mtStateFor('iso:' + _req.auditId + ':requirements').selected.clear();
      await fillRequirementsTab({ id: _req.auditId });
      const msg = r.skipped && r.skipped.length ? `Approved ${r.updated}; ${r.skipped.length} skipped (already approved, returned, or not assessed).` : `Approved ${r.updated}.`;
      root.showToast ? root.showToast(msg, !r.updated && r.skipped.length > 0) : null;
    } catch (e) { root.showToast ? root.showToast('Could not approve: ' + e.message, true) : alert(e.message); }
  }

  let _req = { auditId: null, requirements: [], sections: [], view: 'all', savedViews: [], guidance: {}, relLibrary: {}, expanded: new Set(), relEdit: new Set(), applyPanel: null, evidenceByReq: {}, q: '' };

  function stateColor(s) { return (root.IsoCharts && root.IsoCharts.STATE_COLOR[s]) || '#64748b'; }
  function resultColor(r) { return (root.IsoCharts && root.IsoCharts.RESULT_COLOR[r]) || '#64748b'; }
  function reqPill(text, color) { return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;background:${color}18;color:${color};font-weight:600">${esc(text)}</span>`; }
  // The Clauses row's own status mark (wireframe P3): a dot + text, no filled background — quieter
  // than reqPill, which stays in use for the approval note/drawer and other registers.
  function reqStatusDotHtml(cs, row) {
    const color = complianceColor(cs);
    const text = row ? statusText(row) : complianceLabel(cs);
    return `<span class="iso-status-dot iso-pill${!cs || cs === 'not_assessed' ? ' is-na' : ''}${cs === 'out_of_scope' ? ' is-oos' : ''}" style="--c:${color}">${esc(text)}</span>`;
  }
  // Small marks after the clause name: derived, basis missing, consistency (B1.1/B1.5/B1.6). On the
  // Awaiting approval view the same facts become the risk reasons the Lead sorts by.
  function reqFlagsHtml(row) {
    if (_req.view === 'approval_awaiting') {
      const why = reqRiskReasons(row);
      return why.length ? `<span class="iso-flags">${why.map(w => `<span class="iso-why">${esc(w)}</span>`).join('')}</span>` : '';
    }
    const out = [];
    if (row.derived_from_id) out.push('<span class="iso-flag iso-derived-pill" title="Copied from a related clause — check it, then Confirm">Derived</span>');
    const cl = carryLabel(row); // B4.3
    if (cl) out.push(`<span class="iso-flag iso-carry iso-carry-${cl === 'Changed since last audit' ? 'changed' : cl === 'Reconfirmed' ? 'same' : 'other'}" title="Against the previous audit's result">${esc(cl)}</span>`);
    const bp = basisProblemLocal(row);
    if (bp && !row.derived_from_id) out.push(`<span class="iso-flag iso-basis-missing" title="${esc(bp)}">${/^Gap/.test(bp) ? 'Gap reason missing' : 'Basis missing'}</span>`);
    if (row._consistency && row._consistency.length) out.push(`<span class="iso-flag iso-consistency" title="${esc('Same documents as ' + row._consistency.join(', ') + ' but the opposite conclusion — check both')}">Check consistency</span>`);
    return out.length ? `<span class="iso-flags">${out.join('')}</span>` : '';
  }
  // B1.6: why a proposed clause matters to the Lead, most serious first.
  const RISK_WEIGHT = { 'Non-Compliant': 60, Derived: 50, 'Check consistency': 40, 'Changed since last audit': 30, 'Basis missing': 20, 'Gap reason missing': 20, 'No evidence': 15, 'Partially Compliant': 10 };
  function reqRiskReasons(row) {
    const cs = row.compliance_status;
    const out = [];
    if (cs === 'non_compliant') out.push('Non-Compliant');
    if (row.derived_from_id) out.push('Derived');
    if (row._consistency && row._consistency.length) out.push('Check consistency');
    if (row.baseline_at && (row.baseline_result || null) !== (row.assessment_result || null)) out.push('Changed since last audit');
    const bp = basisProblemLocal(row);
    if (bp && !row.derived_from_id) out.push(/^Gap/.test(bp) ? 'Gap reason missing' : 'Basis missing');
    const sum = (_req.evidenceSummary || {})[row.id];
    if ((cs === 'compliant' || cs === 'partially_compliant') && !(sum && ((sum.accepted || 0) + (sum.partial || 0) + (sum.toReview || 0)))) out.push('No evidence');
    if (cs === 'partially_compliant') out.push('Partially Compliant');
    return out;
  }
  function reqRiskScore(row) { const w = reqRiskReasons(row).map(x => RISK_WEIGHT[x] || 0); return (w.length ? Math.max(...w) : 0) + w.length; }
  // B1.6 consistency: a related clause sharing at least one provided document, with the opposite
  // conclusion (Compliant vs Non-Compliant). N/A is left out on purpose — it legitimately differs
  // between standards — recorded as a deviation from the plan's "N/A vs anything" wording.
  function reqComputeConsistency() {
    const docsByReq = new Map();
    for (const d of (_req.docs || [])) for (const c of d.clauses) if (c.provided) { if (!docsByReq.has(c.requirementId)) docsByReq.set(c.requirementId, new Set()); docsByReq.get(c.requirementId).add(d.name); }
    const byId = new Map(_req.requirements.map(r => [r.id, r]));
    for (const r of _req.requirements) {
      r._consistency = [];
      if (r.compliance_status !== 'compliant' && r.compliance_status !== 'non_compliant') continue;
      const mine = docsByReq.get(r.id); if (!mine) continue;
      for (const x of ((_req.relLibrary || {})[r.id] || [])) {
        if (x.rejected) continue;
        const o = byId.get(x.requirementId); if (!o) continue;
        const opposite = (r.compliance_status === 'compliant' && o.compliance_status === 'non_compliant') || (r.compliance_status === 'non_compliant' && o.compliance_status === 'compliant');
        const theirs = docsByReq.get(o.id);
        if (opposite && theirs && [...mine].some(n => theirs.has(n))) r._consistency.push(o.standard_code + ' ' + o.clause);
      }
    }
  }
  function reqOwnerName(uid) { const u = (_DB().users || []).find(x => x.id === uid); return u ? u.name : ''; }

  // ── R3 (D35 P3/P6): the inline-expanding row's own rendering ──────────────────────────────────
  function reqDocCountHtml(row) {
    const sum = (_req.evidenceSummary || {})[row.id];
    // Linked = provided (D35: the auditor's confirmation is the review) — only an Insufficient verdict drops out.
    const n = sum ? (sum.accepted || 0) + (sum.partial || 0) + (sum.toReview || 0) : 0;
    // Real per-document names/links show in the expanded row's own Documents list (below) — this
    // stays a count-only glance, same idea as the wireframe's row-level doc icon + number.
    return `<span class="iso-clause-docs${n ? '' : ' zero'}" title="${n} document${n === 1 ? '' : 's'} provided">${icoDoc()}${n}</span>`;
  }
  // Minimal inline icon glyphs — the module uses plain characters elsewhere (ⓘ, ⟳, ✓, ✕), not an
  // SVG sprite, so these follow the same convention rather than importing one just for this screen.
  function icoDoc() { return '<svg class="iso-svg" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'; }
  function icoChev() { return '<svg class="iso-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'; }
  const APPROVAL_ICON = { approved: '✓', proposed: '◴', returned: '↺' };
  // Who last set the status, as the wireframe's row-level avatar — a quiet circle with initials,
  // readable without opening the row.
  function _initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  }
  function reqAvatarHtml(row) {
    if (!row.assessed_by) return '<span class="iso-avatar is-empty" aria-hidden="true"></span>';
    const name = _uidName(row.assessed_by) || '';
    return `<span class="iso-avatar" title="Set by ${esc(name)}">${esc(_initials(name).toUpperCase())}</span>`;
  }
  function reqApprovalIconHtml(row) {
    if (!row.approval_state || row.compliance_status === 'not_applicable') return '<span class="iso-ap-ico" aria-hidden="true"></span>';
    const icon = APPROVAL_ICON[row.approval_state] || '';
    const label = APPROVAL_STATE_LABEL[row.approval_state] || row.approval_state;
    return `<span class="iso-ap-ico is-${esc(row.approval_state)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</span>`;
  }
  function reqCheatSheetHtml(g) {
    const cs = g && g.cheatSheet;
    const sec = (label, items) => (items && items.length) ? `<div class="iso-cheat-sec"><div class="iso-cheat-sec-label">${esc(label)}</div><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';
    const body = cs ? sec('Look for', cs.lookFor) + sec('Confirm', cs.confirm) + sec('Watch for', cs.watchFor) : '';
    return body || '<div class="muted iso-cheat-empty">No audit cheat sheet for this clause.</div>';
  }
  // The ⓘ next to every clause name (P3): hover shows it, a click/tap pins it (closed by the next
  // outside click) — so it reads on a collapsed row without opening anything.
  function reqCheatSheetBtnHtml(row) {
    const g = (_req.guidance || {})[row.id];
    return `<span class="iso-cheat" onclick="event.stopPropagation()">
      <button type="button" class="iso-cheat-btn" aria-label="Audit cheat sheet for ${esc(row.clause)}" onclick="ISO._reqToggleCheat(this)">ⓘ</button>
      <span class="iso-cheat-card" role="note">${reqCheatSheetHtml(g)}</span>
    </span>`;
  }
  let _cheatOutsideBound = false;
  function _reqToggleCheat(btn) {
    const wrap = btn.closest('.iso-cheat');
    const wasOpen = wrap.classList.contains('is-pinned');
    document.querySelectorAll('.iso-cheat.is-pinned').forEach(w => w.classList.remove('is-pinned'));
    if (!wasOpen) wrap.classList.add('is-pinned');
    if (!_cheatOutsideBound) {
      _cheatOutsideBound = true;
      document.addEventListener('click', e => { if (!e.target.closest('.iso-cheat')) document.querySelectorAll('.iso-cheat.is-pinned').forEach(w => w.classList.remove('is-pinned')); });
    }
  }
  // Column P's library relationships (relationship.library) as chips, each with the peer's own
  // status dot (P6). Rejected pairs stay hidden unless Edit mode is on for this row.
  function reqRelatedDotsHtml(row) {
    const shown = ((_req.relLibrary || {})[row.id] || []).filter(x => !x.rejected);
    if (!shown.length) return '';
    return `<span class="iso-clause-related-dots" title="${shown.length} related clause${shown.length === 1 ? '' : 's'}: ${esc(shown.map(x => x.standardCode + ' ' + x.clause).join(', '))}">${shown.slice(0, 3).map(x => `<span class="iso-rel-pair"><span class="iso-tag iso-tag-xs" style="--std:${STANDARD_COLOR[x.standardCode] || '#6b8399'}">${esc(STANDARD_BADGE[x.standardCode] || '•')}</span><span class="iso-rel-dot" style="--c:${complianceColor(x.complianceStatus)}"></span></span>`).join('')}</span>`;
  }
  function _reqRelEditSet() { return _req.relEdit || (_req.relEdit = new Set()); }
  function reqRelatedColHtml(row) {
    const related = (_req.relLibrary || {})[row.id] || [];
    const editMode = _reqRelEditSet().has(row.id);
    const shown = editMode ? related : related.filter(x => !x.rejected);
    const applicable = related.filter(x => !x.rejected);
    const chip = x => `<span class="iso-rel-chip${x.rejected ? ' is-rejected' : ''}" title="${esc(x.standardCode + ' ' + x.clause + ' ' + (x.clauseName || '') + ' — ' + complianceLabel(x.complianceStatus))}">
        <span class="iso-tag iso-tag-xs" style="--std:${STANDARD_COLOR[x.standardCode] || '#6b8399'}" aria-label="ISO ${esc(x.standardCode)}">${esc(STANDARD_BADGE[x.standardCode] || '•')}</span><span class="iso-rel-dot" style="--c:${complianceColor(x.complianceStatus)}"></span>${esc(x.clause)}
        ${editMode ? (x.rejected
          ? `<button type="button" class="iso-rel-x" title="Show this link again" data-from="${esc(row.id)}" data-to="${esc(x.requirementId)}" onclick="ISO._reqUnrejectRelated(this)">↺</button>`
          : `<button type="button" class="iso-rel-x" title="Not equivalent here" data-from="${esc(row.id)}" data-to="${esc(x.requirementId)}" onclick="ISO._reqRejectRelated(this)">✕</button>`) : ''}
      </span>`;
    return `<div class="iso-clause-col">
      <div class="iso-clause-col-head">
        <span class="iso-clause-col-label">Related clauses${related.length ? ' ' + related.length : ''}</span>
        <span class="iso-clause-col-actions">
          ${related.length ? `<button type="button" class="linkbtn" onclick="ISO._reqToggleRelEdit('${esc(row.id)}')">${editMode ? 'Done' : 'Edit'}</button>` : ''}
          <button type="button" class="btn btn-sm ${applicable.length ? 'btn-primary' : 'btn-ghost'}" onclick="ISO._reqOpenApplyPanel('${esc(row.id)}')"${applicable.length ? '' : ' disabled title="No related clauses to apply to"'}>Apply to related</button>
        </span>
      </div>
      ${related.length ? `<div class="iso-rel-chips">${shown.map(chip).join('')}</div>` : '<div class="muted">No related clauses in the register for this one.</div>'}
      ${_req.applyPanel === row.id ? reqApplyPanelHtml(row, applicable) : ''}
    </div>`;
  }
  function reqApplyPanelHtml(row, applicable) {
    const docs = ((_req.evidenceByReq || {})[row.id] || []).filter(d => !['rejected', 'superseded', 'insufficient'].includes(d.reviewStatus));
    const what = [statusText(row), row.current_system ? 'basis' : '', row.gap_reason ? 'gap reason' : '', row.recommended_action ? 'planned action' : '', docs.length ? `+${docs.length} document${docs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    const byId = new Map(_req.requirements.map(r => [r.id, r]));
    const ref = r => `${STANDARD_BADGE[r.standard_code] || ''} ${r.clause} ${r.clause_name || ''}`;
    return `<div class="card iso-apply-panel">
      <div class="iso-apply-panel-title">Propose for related clauses: ${esc(what)}</div>
      <div class="iso-apply-panel-sub">Each ticked clause gets this as a proposal marked "Derived" — check it on that clause, then confirm (D47).</div>
      ${applicable.map(x => { const t = byId.get(x.requirementId); return `<div class="iso-apply-row"><label class="iso-apply-item"><input type="checkbox" checked value="${esc(x.requirementId)}"/> ${esc(x.standardCode)} ${esc(x.clause)} ${esc(x.clauseName || '')} <span class="muted">(currently ${esc(complianceLabel(x.complianceStatus))})</span></label>
        <details class="iso-apply-compare"><summary>Compare wording</summary><div class="iso-apply-texts"><div><b>${esc(ref(row))}</b><p>${esc(row.requirement_text || '')}</p></div><div><b>${esc(t ? ref(t) : x.standardCode + ' ' + x.clause)}</b><p>${esc(t ? t.requirement_text || '' : '')}</p></div></div></details></div>`; }).join('')}
      <div class="iso-apply-panel-actions">
        <button type="button" class="btn btn-teal btn-sm" data-id="${esc(row.id)}" onclick="ISO._reqApplyToRelated(this)">Apply</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ISO._reqCloseApplyPanel()">Cancel</button>
      </div>
    </div>`;
  }
  function _reqToggleRelEdit(id) { const s = _reqRelEditSet(); if (s.has(id)) s.delete(id); else s.add(id); renderRequirementsTable(_req.auditId); }
  function _reqOpenApplyPanel(id) { _req.applyPanel = id; renderRequirementsTable(_req.auditId); }
  function _reqCloseApplyPanel() { _req.applyPanel = null; renderRequirementsTable(_req.auditId); }
  async function _reqRefreshRelLibrary() { try { _req.relLibrary = await api('relationship.library', { auditId: _req.auditId }); } catch (e) {} }
  async function _reqApplyToRelated(btn) {
    const fromId = btn.dataset.id;
    const panel = btn.closest('.iso-apply-panel');
    const toIds = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
    const offeredIds = [...panel.querySelectorAll('input[type=checkbox]')].map(cb => cb.value);
    if (!toIds.length) return;
    try {
      const r = await mutate('relationship.applyToRelated', { auditId: _req.auditId, fromId: fromId, toIds: toIds, offeredIds: offeredIds });
      _req.applyPanel = null;
      toIds.forEach(id => { if (_req.evidenceByReq) delete _req.evidenceByReq[id]; });
      await fillRequirementsTab({ id: _req.auditId });
      root.showToast ? root.showToast(`Proposed for ${r.applied.length} clause${r.applied.length === 1 ? '' : 's'} — confirm each one there.`) : null;
    } catch (e) { root.showToast ? root.showToast('Could not apply: ' + e.message, true) : alert(e.message); }
  }
  async function _reqRejectRelated(btn) {
    try { await mutate('relationship.rejectLibrary', { auditId: _req.auditId, fromId: btn.dataset.from, toId: btn.dataset.to }); await _reqRefreshRelLibrary(); renderRequirementsTable(_req.auditId); }
    catch (e) { root.showToast ? root.showToast('Could not hide that link: ' + e.message, true) : alert(e.message); }
  }
  async function _reqUnrejectRelated(btn) {
    try { await mutate('relationship.unrejectLibrary', { auditId: _req.auditId, fromId: btn.dataset.from, toId: btn.dataset.to }); await _reqRefreshRelLibrary(); renderRequirementsTable(_req.auditId); }
    catch (e) { root.showToast ? root.showToast('Could not restore that link: ' + e.message, true) : alert(e.message); }
  }
  // Status buttons (P3/P4): one click sets the status, no editor popup, no Save button.
  // The same five buttons as the wireframe (D44: OFI = Compliant + OFI). N/A ▾ opens a small menu with
  // Not applicable and Outside this audit's scope (D45).
  function reqStatusBarHtml(row) {
    const cs = row.compliance_status || 'not_assessed';
    const ofi = !!row.ofi;
    const btn = (key, label, on, color, handler) => `<button type="button" role="radio" class="iso-status-btn${on ? ' is-active' : ''}" style="--c:${color}" aria-checked="${on}" data-id="${esc(row.id)}" data-status="${key}" onclick="${handler || 'ISO._reqSetStatus(this.dataset.id,this.dataset.status)'}">${esc(label)}</button>`;
    const naOn = cs === 'not_applicable' || cs === 'out_of_scope';
    return `<div class="iso-clause-statusbar" role="radiogroup" aria-label="Status">
      ${btn('compliant', 'Compliant', cs === 'compliant' && !ofi, complianceColor('compliant'))}
      ${btn('partially_compliant', 'Partially Compliant', cs === 'partially_compliant', complianceColor('partially_compliant'))}
      ${btn('non_compliant', 'Non-Compliant', cs === 'non_compliant', complianceColor('non_compliant'))}
      ${btn('ofi', 'OFI', cs === 'compliant' && ofi, complianceColor('ofi'))}
      ${btn('na', cs === 'out_of_scope' ? 'Out of scope ▾' : 'N/A ▾', naOn, complianceColor(cs === 'out_of_scope' ? 'out_of_scope' : 'not_applicable'), 'ISO._reqOpenScopeMenu(this.dataset.id)')}
    </div>${_req.scopeMenu === row.id ? `<div class="iso-na-menu" role="menu"><button type="button" role="menuitem" data-id="${esc(row.id)}" onclick="ISO._reqSetStatus(this.dataset.id,'not_applicable')">Not applicable</button><button type="button" role="menuitem" data-id="${esc(row.id)}" onclick="ISO._reqSetStatus(this.dataset.id,'out_of_scope')">Outside this audit's scope</button></div>` : ''}${reqGapAndOfiHtml(row)}`;
  }
  function reqGapAndOfiHtml(row) {
    const cs = row.compliance_status;
    if (!isGapStatus(cs)) return '';
    return `<div class="iso-gap-row">
      <div class="iso-gap-reason" role="radiogroup" aria-label="Why it falls short"><span class="iso-gap-label">Why it falls short</span>${Object.keys(GAP_REASON_LABEL).map(g => `<button type="button" role="radio" class="iso-gap-btn${row.gap_reason === g ? ' is-active' : ''}" aria-checked="${row.gap_reason === g}" data-id="${esc(row.id)}" data-gap="${g}" onclick="ISO._reqSetGap(this.dataset.id,this.dataset.gap)">${esc(GAP_REASON_LABEL[g])}</button>`).join('')}</div>
      ${cs === 'partially_compliant' ? `<button type="button" class="iso-ofi-toggle${row.ofi ? ' is-on' : ''}" aria-pressed="${!!row.ofi}" data-id="${esc(row.id)}" onclick="ISO._reqToggleOfi(this.dataset.id)">${row.ofi ? 'OFI ✓' : '+ OFI'}</button>` : ''}
    </div>`;
  }
  function _reqOpenScopeMenu(id) { _req.scopeMenu = _req.scopeMenu === id ? null : id; renderRequirementsTable(_req.auditId); }
  async function _reqSetGap(id, gap) {
    try { await saveRequirementField(_req.auditId, id, 'gap_reason', gap); renderRequirementsTable(_req.auditId); }
    catch (e) { if (root.showToast) root.showToast('Could not save: ' + e.message, true); }
  }
  async function _reqToggleOfi(id) {
    const row = _req.requirements.find(r => r.id === id); if (!row) return;
    try { await saveRequirementField(_req.auditId, id, 'ofi', !row.ofi); renderRequirementsTable(_req.auditId); }
    catch (e) { if (root.showToast) root.showToast('Could not save: ' + e.message, true); }
  }
  async function _reqConfirmDerived(id) {
    try { await mutate('requirement.confirmDerived', { auditId: _req.auditId, ids: [id] }); await fillRequirementsTab({ id: _req.auditId }); if (root.showToast) root.showToast('Confirmed.'); }
    catch (e) { if (root.showToast) root.showToast('Could not confirm: ' + e.message, true); }
  }
  function reqDerivedBannerHtml(row) {
    const src = _req.requirements.find(r => r.id === row.derived_from_id);
    const ref = src ? `${STANDARD_BADGE[src.standard_code] || ''} ${src.clause} ${src.clause_name || ''}` : 'a related clause';
    return `<div class="iso-derived-banner" role="status"><span><b>Derived from ${esc(ref)}</b> — the status, basis and plan were copied from it. Check they hold for this clause, then confirm.</span><button type="button" class="btn btn-teal btn-sm iso-derived-confirm" data-id="${esc(row.id)}" onclick="ISO._reqConfirmDerived(this.dataset.id)">Confirm</button></div>`;
  }
  async function _reqSetStatus(id, status) {
    const row = _req.requirements.find(r => r.id === id);
    if (!row) return;
    _req.scopeMenu = null;
    const patch = status === 'ofi' ? { compliance_status: 'compliant', ofi: true } : status === 'compliant' ? { compliance_status: 'compliant', ofi: false } : { compliance_status: status };
    if (status === 'not_applicable') {
      let reason = row.na_justification;
      if (!(reason && reason.trim())) {
        reason = await _promptAsync('Why is this clause not applicable? The Lead Auditor sees this.');
        if (!reason || !reason.trim()) return;
      }
      patch.na_justification = reason;
    }
    try {
      const updated = await mutate('requirement.update', { auditId: _req.auditId, id: id, patch: patch, expectedVersion: row.row_version });
      Object.assign(row, updated);
      renderRequirementsTable(_req.auditId);
      root.showToast ? root.showToast('Status: ' + statusText(row) + '.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not update the status: ' + e.message, true) : alert(e.message); }
  }
  function _looseEq(a, b) { return (a || '') === (b || ''); }
  // One save at a time per clause: ticking a check blurs the basis box, so its own save and the
  // tick's save would otherwise race on the same row version.
  const _reqSaveChain = {};
  function _reqSaveFieldGeneric(id, field, value) {
    const run = async () => {
      const row = _req.requirements.find(r => r.id === id);
      if (!row || _looseEq(row[field], value)) return;
      try { const updated = await saveRequirementField(_req.auditId, id, field, value); Object.assign(row, updated); renderRequirementsTable(_req.auditId); }
      catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
    };
    return (_reqSaveChain[id] = (_reqSaveChain[id] || Promise.resolve()).then(run, run));
  }
  // Ticking a CONFIRM point rewrites only the "Confirmed that …" sentence at the top of the basis
  // (iso-checks.js); whatever the auditor typed underneath, saved or not yet, is kept.
  function _reqToggleCheck(el) {
    const id = el.dataset.id, items = confirmItemsLocal(id), item = items[Number(el.dataset.i)];
    const row = _req.requirements.find(r => r.id === id);
    if (!row || !item || !root.IsoChecks) return;
    const ta = document.querySelector(`textarea[data-field="current_system"][data-id="${CSS.escape(id)}"]`);
    const next = root.IsoChecks.toggle(ta ? ta.value : row.current_system, items, item, el.checked);
    if (ta) ta.value = next;
    _reqSaveFieldGeneric(id, 'current_system', next);
  }
  // Tall enough for what's there plus a free line to add to (the ticked sentence alone can fill 3 rows).
  function basisRows(text) {
    const lines = String(text || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 72)), 0);
    return Math.min(12, Math.max(3, lines + 1));
  }
  function reqChecksHtml(row) {
    const items = confirmItemsLocal(row.id);
    if (!items.length || !root.IsoChecks || ['not_applicable', 'out_of_scope'].includes(row.compliance_status)) return '';
    const ticked = new Set(root.IsoChecks.split(row.current_system, items).ticked);
    return `<fieldset class="iso-checks"><legend class="iso-checks-h">Confirm <span class="muted">— each tick adds a line to the basis; add what you saw underneath</span></legend>
      ${items.map((it, i) => `<label class="iso-check"><input type="checkbox" data-id="${esc(row.id)}" data-i="${i}"${ticked.has(String(it).trim().replace(/\.+$/, '')) ? ' checked' : ''} onchange="ISO._reqToggleCheck(this)"><span>${esc(it)}</span></label>`).join('')}
    </fieldset>`;
  }
  function _reqSaveField(el) { _reqSaveFieldGeneric(el.dataset.id, el.dataset.field, el.value); }
  function _reqSaveFieldSelect(el) { _reqSaveFieldGeneric(el.dataset.id, el.dataset.field, el.value || null); }
  // Release-1 B2.1: Track › under a clause's plan, or the action that already tracks it.
  function reqTrackHtml(row) {
    if (!String(row.recommended_action || '').trim()) return '';
    const a = trackedActionFor(row, _req.actions);
    if (a) return `<div class="iso-tracked"><span class="iso-tracked-k">Tracked</span><button type="button" class="iso-tracked-ref" data-id="${esc(a.id)}" onclick="ISO._reqOpenTracked(this.dataset.id)">${esc(a.ref || 'Action')}</button><span class="muted">${esc(actionStateText(a.status, a.verification_status))}</span></div>`;
    if (!canManageFindingLocally()) return '';
    return `<button type="button" class="iso-mini-btn iso-track-btn" data-ids="${esc(row.id)}" data-src="req" onclick="ISO._trackOpen(this.dataset.ids,this.dataset.src)">Track ›</button>`;
  }
  function reqAssessmentColHtml(row) {
    const cs = row.compliance_status;
    const showPlan = needsAction(row);
    const basisMissing = !row.derived_from_id && /^Basis missing/.test(basisProblemLocal(row) || '');
    const staffOptions = (_DB().users || []).filter(u => u.role !== 'client');
    return `<div class="iso-clause-col">
      <div class="iso-clause-col-label">Assessment</div>
      <label class="iso-clause-field iso-clause-field-bare"><span class="sr">Basis — current system</span><textarea class="form-input${basisMissing ? ' is-missing' : ''}" rows="${basisRows(row.current_system)}" placeholder="Basis — the current system: what you saw and checked (needed before approval)" data-id="${esc(row.id)}" data-field="current_system" onblur="ISO._reqSaveField(this)">${esc(row.current_system || '')}</textarea></label>
      ${reqChecksHtml(row)}
      ${cs === 'not_applicable' ? `<label class="iso-clause-field">Why not applicable<textarea class="form-input" rows="2" data-id="${esc(row.id)}" data-field="na_justification" onblur="ISO._reqSaveField(this)">${esc(row.na_justification || '')}</textarea></label>` : ''}
      ${cs === 'out_of_scope' ? `<label class="iso-clause-field">Why outside this audit's scope <span class="muted">(optional)</span><textarea class="form-input" rows="2" data-id="${esc(row.id)}" data-field="na_justification" onblur="ISO._reqSaveField(this)">${esc(row.na_justification || '')}</textarea></label>` : ''}
      ${showPlan ? `<label class="iso-clause-field">Planned action<textarea class="form-input" rows="2" data-id="${esc(row.id)}" data-field="recommended_action" onblur="ISO._reqSaveField(this)">${esc(row.recommended_action || '')}</textarea></label>
        <div class="iso-clause-row2">
          <label class="iso-clause-field">Owner<select class="form-input" data-id="${esc(row.id)}" data-field="responsible_uid" onchange="ISO._reqSaveFieldSelect(this)"><option value="">Unassigned</option>${staffOptions.map(u => `<option value="${esc(u.id)}"${row.responsible_uid === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          <label class="iso-clause-field">Due<input type="date" class="form-input" data-id="${esc(row.id)}" data-field="target_date" value="${esc(row.target_date || '')}" onchange="ISO._reqSaveFieldSelect(this)"/></label>
        </div>${reqTrackHtml(row)}` : ''}
    </div>`;
  }
  // A real, minimal documents list (P3's right column) — not R4's full add-any-document chooser,
  // just what this clause already has (evidence.list, fetched once per row the first time it's
  // expanded and cached) and a way to add more via the existing evidence modal. "+ Add document"
  // reopens the full drawer on the Evidence tab after saving (A49's reopen-to-refetch discipline,
  // unchanged) — this row's own copy of the list is invalidated at the same time, so it catches up
  // once that modal closes.
  function reqDocumentsColHtml(row) {
    const cache = _req.evidenceByReq || (_req.evidenceByReq = {});
    const items = cache[row.id];
    if (items === undefined) {
      cache[row.id] = null; // loading sentinel — avoids a refetch storm while the request is in flight
      api('evidence.list', { auditId: _req.auditId, targetType: 'requirement', targetId: row.id }).then(list => {
        cache[row.id] = list || [];
        if (_reqExpandedSet().has(row.id)) renderRequirementsTable(_req.auditId);
      }).catch(() => { cache[row.id] = []; });
    }
    const list = (items || []).filter(d => !['rejected', 'superseded'].includes(d.reviewStatus));
    const okCount = list.filter(d => d.reviewStatus !== 'insufficient').length; // B1.7: insufficient ≠ provided
    // Wireframe: "Documents 2 of 3" — ✓ what is linked, then dashed ○ the register's (Column P)
    // suggestions for this clause that are not here yet, each with Generator (when a template has
    // it) and + Add. Names travel in data-doc (A81).
    const have = new Set(list.map(d => String(d.title || '').trim().toLowerCase()));
    const suggested = items === null ? [] : (((_req.guidance || {})[row.id] || {}).documents || []).filter(n => !have.has(String(n).toLowerCase()));
    const SUFF = { partially_sufficient: 'Partial', insufficient: 'Insufficient' };
    const sample = d => d.kind === 'sample' && (d.sampleSize != null || d.samplePopulation != null) ? `${d.sampleSize != null ? d.sampleSize : '?'} of ${d.samplePopulation != null ? d.samplePopulation : '?'} sampled${d.sampleExceptions ? ' · ' + d.sampleExceptions : ''}` : null;
    const linkedLi = list.map(d => `<li class="iso-doc-item is-ok${d.reviewStatus === 'insufficient' ? ' is-insufficient' : ''}"><span class="iso-doc-check" aria-hidden="true">${d.reviewStatus === 'insufficient' ? '✕' : '✓'}</span><span class="iso-doc-name">${esc(d.title)}</span>${SUFF[d.reviewStatus] ? `<span class="iso-doc-suff">${SUFF[d.reviewStatus]}</span>` : ''}<span class="iso-doc-meta">${[d.versionLabel, d.evidenceDate ? fmtDate(d.evidenceDate) : null, sample(d)].filter(Boolean).map(esc).join(' · ')}</span>${d.uploadedVia === 'client' ? '' : `<button type="button" class="iso-mini-btn iso-doc-suff-btn" title="Is this enough evidence?" data-req="${esc(row.id)}" data-link="${esc(d.linkId)}" onclick="ISO._reqOpenSuffMenu(this)">⋯</button>`}</li>${_req.suffMenu === d.linkId ? `<li class="iso-suff-menu" role="menu"><span class="muted">This document is</span>${[['', 'Sufficient'], ['partial', 'Partly sufficient'], ['insufficient', 'Insufficient']].map(([v, l]) => `<button type="button" role="menuitem" data-req="${esc(row.id)}" data-link="${esc(d.linkId)}" data-v="${v}" onclick="ISO._reqSetSufficiency(this)">${l}</button>`).join('')}</li>` : ''}`).join('');
    const sugLi = suggested.map(n => { const t = docTemplateFor(n); return `<li class="iso-doc-item is-sug"><span class="iso-doc-ring" aria-hidden="true"></span><span class="iso-doc-name">${esc(n)}</span><span class="iso-doc-acts">${t ? `<button type="button" class="iso-mini-btn iso-doc-gen" data-doc="${esc(n)}" data-req="${esc(row.id)}" onclick="ISO._reqDocGenerator(this)">Generator</button>` : ''}<button type="button" class="iso-mini-btn iso-doc-sug-add" data-doc="${esc(n)}" data-req="${esc(row.id)}" onclick="ISO._reqDocAdd(this)">+ Add</button></span></li>`; }).join('');
    const total = list.length + suggested.length;
    const body = items === null ? '<div class="muted">Loading…</div>'
      : total ? `<ul class="iso-doc-list">${linkedLi}${sugLi}</ul>`
      : '<div class="muted">No documents linked yet.</div>';
    return `<div class="iso-clause-col">
      <div class="iso-clause-col-head"><span class="iso-clause-col-label">Documents${total ? ` <b class="muted">${okCount} of ${total}</b>` : ''}</span><button type="button" class="linkbtn" onclick="ISO._reqAddDocument('${esc(row.id)}')">+ Add document</button></div>
      ${body}
      <div class="iso-doc-quick"><span class="muted">Add a note:</span>${[['interview', 'Interview'], ['observation', 'Observation'], ['sample', 'Sample']].map(([k, l]) => `<button type="button" class="linkbtn" data-req="${esc(row.id)}" data-kind="${k}" onclick="ISO._reqQuickNote(this)">${l}</button>`).join('')}</div>
    </div>`;
  }
  function _reqOpenSuffMenu(el) { _req.suffMenu = _req.suffMenu === el.dataset.link ? null : el.dataset.link; renderRequirementsTable(_req.auditId); }
  async function _reqSetSufficiency(el) {
    const reqId = el.dataset.req, linkId = el.dataset.link;
    const d = ((_req.evidenceByReq || {})[reqId] || []).find(x => x.linkId === linkId);
    if (!d) return;
    try {
      await mutate('evidence.setSufficiency', { auditId: _req.auditId, linkId: linkId, sufficiency: el.dataset.v || null, expectedVersion: d.linkRowVersion });
      _req.suffMenu = null;
      delete _req.evidenceByReq[reqId];
      _req.docs = await api('document.list', { auditId: _req.auditId }).catch(() => _req.docs);
      renderRequirementsTable(_req.auditId);
    } catch (e) { if (root.showToast) root.showToast('Could not save: ' + e.message, true); }
  }
  // B1.7: interview / observation / sample notes are evidence too — quick add from the clause.
  function _reqQuickNote(el) {
    const kind = el.dataset.kind, reqId = el.dataset.req;
    const label = { interview: 'Interview', observation: 'Observation', sample: 'Sample' }[kind];
    root.openGenericModal(label + ' note', `<div class="iso-da">
        <label class="iso-clause-field">Title<input class="form-input" id="qn-title" placeholder="${kind === 'interview' ? 'e.g. Interview — HSE Manager' : kind === 'sample' ? 'e.g. Competency files' : 'e.g. Toolbox talk observed'}"/></label>
        <label class="iso-clause-field">Note<textarea class="form-input" id="qn-note" rows="3"></textarea></label>
        ${kind === 'sample' ? `<div class="iso-field-grid"><label>Population<input type="number" min="0" class="form-input" id="qn-pop"/></label><label>Sample size<input type="number" min="0" class="form-input" id="qn-size"/></label><label style="grid-column:1/-1">Exceptions found<input class="form-input" id="qn-exc" placeholder="e.g. 2 lacked authorisation"/></label></div>` : ''}
        <div class="iso-da-foot"><span class="muted"></span><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('generic-modal').classList.add('hidden')">Cancel</button><button type="button" class="btn btn-teal btn-sm" data-req="${esc(reqId)}" data-kind="${kind}" onclick="ISO._reqQuickNoteSave(this)">Save</button></div>
      </div>`, '520px');
  }
  async function _reqQuickNoteSave(el) {
    const v = id => (document.getElementById(id) || {}).value || '';
    const title = v('qn-title').trim();
    if (!title) { if (root.showToast) root.showToast('Give it a title.', true); return; }
    const payload = { auditId: _req.auditId, targetType: 'requirement', targetId: el.dataset.req, kind: el.dataset.kind, title: title, description: v('qn-note').trim() || undefined };
    if (el.dataset.kind === 'sample') Object.assign(payload, { samplePopulation: v('qn-pop') || undefined, sampleSize: v('qn-size') || undefined, sampleExceptions: v('qn-exc').trim() || undefined });
    try {
      await mutate('evidence.addLink', payload);
      document.getElementById('generic-modal').classList.add('hidden');
      delete _req.evidenceByReq[el.dataset.req];
      renderRequirementsTable(_req.auditId);
    } catch (e) { if (root.showToast) root.showToast('Could not save: ' + e.message, true); }
  }
  // "+ Add document" on a clause opens the one document chooser (P5 round 3), in this clause's context.
  function _reqAddDocument(id) { _docOpenChooser(id); }
  function _reqDocAdd(el) { _docOpenForm(el.dataset.doc, false, el.dataset.req); }
  function _reqDocGenerator(el) { const t = docTemplateFor(el.dataset.doc); if (t) _openPromptDialog(_req.auditId, el.dataset.req, t.templateId); }
  // _reqOpenMore stays the plain, unopinionated "open the full drawer" call (same default as
  // ever — Assessment first) so every existing drawer entry point keeps behaving exactly as
  // before. The row's own footer link jumps straight to Evidence instead (R3: status/current
  // system/planned action/owner/due now live on the row — Assessment is redundant for them,
  // though not removed, since Relationships-detail/Findings still only exist there until R6).
  function _reqOpenMore(id) { openRequirementDrawer(_req.auditId, id); }
  function _reqOpenEvidence(id) { openRequirementDrawer(_req.auditId, id, { tab: 'evidence' }); }
  // The footer matches the wireframe's single line: a Saved/Not-assessed-yet mark and who/approval
  // state on the left, Approve/Return (reused from the header control, unchanged) and the
  // Comments · History link on the right.
  function reqPanelFootHtml(row) {
    const cs = row.compliance_status;
    const left = !cs || cs === 'not_assessed' ? '<span class="iso-pfoot-empty">Not assessed yet</span>'
      : `<span class="iso-pfoot-saved">${icoCheck()}Saved</span>${row.assessed_by ? `<span>Set by ${esc(_uidName(row.assessed_by) || '')}</span>` : ''}`;
    return `<div class="iso-clause-foot">
      <div class="iso-pfoot-left">${left}</div>
      <div class="iso-pfoot-right">${reqApprovalHeaderHtml(row)}<button type="button" class="linkbtn" onclick="ISO._reqOpenEvidence('${esc(row.id)}')">Comments · History</button></div>
    </div>`;
  }
  function icoCheck() { return '<span class="iso-ico" aria-hidden="true">✓</span>'; }
  function reqExpandedBodyHtml(row) {
    return `<div class="iso-clause-body">
      ${row.approval_state === 'returned' ? reqApprovalNoteHtml(row) : ''}
      ${row.derived_from_id ? reqDerivedBannerHtml(row) : ''}
      <div class="iso-clause-reqtext">${esc(row.requirement_text || '')}</div>
      ${reqStatusBarHtml(row)}
      <div class="iso-clause-cols">
        ${reqAssessmentColHtml(row)}
        <div class="iso-clause-col-stack">${reqDocumentsColHtml(row)}${reqRelatedColHtml(row)}</div>
      </div>
      ${reqPanelFootHtml(row)}
    </div>`;
  }
  function _reqExpandedSet() { return _req.expanded || (_req.expanded = new Set()); }
  function _reqToggleExpand(id) {
    const s = _reqExpandedSet();
    if (s.has(id)) s.delete(id); else { s.add(id); _req.applyPanel = null; }
    renderRequirementsTable(_req.auditId);
  }
  function reqRowHtml(row, st) {
    const expanded = _reqExpandedSet().has(row.id);
    const selected = st.selected.has(row.id);
    const cs = row.compliance_status || 'not_assessed';
    const sum = (_req.evidenceSummary || {})[row.id];
    const suggested = !!(sum && sum.suggested);
    // Order matches the approved wireframe's row: standard tag, clause + name, cheat sheet, status,
    // doc count, related dots, who set it, approval mark, chevron last. The bulk-select checkbox
    // isn't in the mock at all (it predates the redesign, kept for the bulk bar — P7's "Bulk: set
    // status · set owner · approve" survives) so it sits quietly before the tag, out of that flow.
    return `<div class="iso-clause-row${expanded ? ' is-open' : ''}" data-ireq="${esc(row.id)}" data-evd-suggested="${suggested ? '1' : '0'}">
      <div class="iso-clause-head" role="button" tabindex="0" aria-expanded="${expanded}" onclick="ISO._reqToggleExpand('${esc(row.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ISO._reqToggleExpand('${esc(row.id)}')}">
        <span class="iso-tag" style="--std:${STANDARD_COLOR[row.standard_code] || '#6b8399'}" title="${esc(stdLabel(row.standard_code))}">${esc(STANDARD_BADGE[row.standard_code] || '•')}</span>
        <span class="iso-clause-num">${esc(row.clause)}</span>
        <span class="iso-clause-name">${esc(row.clause_name || '')}</span>
        ${reqCheatSheetBtnHtml(row)}
        ${reqFlagsHtml(row)}
        <span class="iso-clause-meta">
          ${reqStatusDotHtml(cs, row)}
          ${reqDocCountHtml(row)}
          ${reqRelatedDotsHtml(row)}
          ${reqAvatarHtml(row)}
          ${reqApprovalIconHtml(row)}
        </span>
        ${suggested ? `<span class="iso-evd-sugg-badge"><span aria-hidden="true">⟳</span> Evidence suggested</span>` : ''}
        <span class="iso-clause-chev" aria-hidden="true">${icoChev()}</span>
      </div>
      ${expanded ? reqExpandedBodyHtml(row) : ''}
    </div>`;
  }
  function reqApproveSectionBtnHtml(sec) {
    // Wireframe: only while the Lead is on Awaiting approval — never a standing button on every section.
    if (!canApproveRequirementLocally() || _isSoleAssessorLocal() || _req.view !== 'approval_awaiting') return '';
    const proposed = (sec.rows || []).filter(r => r.approval_state === 'proposed');
    if (!proposed.length) return '';
    return `<button type="button" class="btn btn-teal btn-sm" data-ids="${esc(JSON.stringify(proposed.map(r => r.id)))}" onclick="event.stopPropagation();ISO._reqApproveIds(this.dataset.ids)">Approve section (${proposed.length})</button>`;
  }
  async function _reqApproveIds(idsJson) {
    let ids; try { ids = JSON.parse(idsJson); } catch (e) { return; }
    if (!ids.length) return;
    try {
      const r = await mutate('requirement.bulkApprove', { auditId: _req.auditId, ids: ids });
      await fillRequirementsTab({ id: _req.auditId });
      root.showToast ? root.showToast(`Approved ${r.updated}.`) : null;
    } catch (e) { root.showToast ? root.showToast('Could not approve: ' + e.message, true) : alert(e.message); }
  }
  function _reqApproveAll() {
    const ids = reqVisibleRows().filter(r => r.approval_state === 'proposed').map(r => r.id);
    _reqApproveIds(JSON.stringify(ids));
  }
  function reqSectionsListHtml(ctx) {
    const st = root._mtStateFor(ctx.key);
    const sections = ctx.sections();
    if (!sections.length || sections.every(s => !(s.rows || []).length)) return `<div class="card" style="padding:24px;text-align:center;color:#c8d4e0">No requirements match the current filter.</div>`;
    const allIds = sections.flatMap(s => (s.rows || []).map(r => r.id));
    const allSelected = allIds.length > 0 && allIds.every(id => st.selected.has(id));
    // B1.6: on Awaiting approval, the riskiest clauses first — sections by their riskiest row, rows by risk.
    const byRisk = _req.view === 'approval_awaiting';
    const ordered = byRisk ? sections.map(sec => ({ sec, top: Math.max(0, ...(sec.rows || []).map(reqRiskScore)) })).sort((a, b) => b.top - a.top).map(x => x.sec) : sections;
    return `<div class="iso-clause-list">
      ${ordered.map(sec => {
        const rows = byRisk ? (sec.rows || []).slice().sort((a, b) => reqRiskScore(b) - reqRiskScore(a)) : (sec.rows || []);
        const assessed = rows.filter(r => r.compliance_status && r.compliance_status !== 'not_assessed').length;
        return `<div class="iso-clause-section">
          <div class="iso-clause-section-hdr" onclick="_mtToggleSection(${JSON.stringify(sec.id)})" role="button" tabindex="0">
            <span class="iso-clause-section-chev" aria-hidden="true">${st.collapsed.has(sec.id) ? '▶' : '▼'}</span>
            <span class="iso-clause-section-label">${esc(sec.label || '')}</span>
            <span class="iso-clause-section-count">${assessed} of ${rows.length} assessed</span>
            ${reqApproveSectionBtnHtml(sec)}
          </div>
          ${st.collapsed.has(sec.id) ? '' : rows.map(r => reqRowHtml(r, st)).join('')}
        </div>`;
      }).join('')}
    </div>`;
  }

  function clauseOfSectionId(sectionId) { if (!sectionId) return null; const idx = sectionId.indexOf(':'); return idx === -1 ? sectionId : sectionId.slice(idx + 1); }

  // The "Evidence to review" view filters on this flag, so it must be set BEFORE any filtering — it was
  // set at the end of buildRequirementSections, which left the view empty on a freshly loaded register.
  function reqSetEvidenceFlags() { for (const r of _req.requirements) { const sum = (_req.evidenceSummary || {})[r.id]; r._evdReview = !!(sum && (sum.suggested || sum.toReview)); r._srAwaiting = srStatus(r) === 'pending' && srReady(r); r._needsAction = needsAction(r); r._needsBasis = !r.derived_from_id && !!basisProblemLocal(r); r._changedSince = carryLabel(r) === 'Changed since last audit'; } }
  // While filtered from the dashboard, _req.requirements IS already exactly the server-filtered set —
  // a stale _req.view (left over from before navigating away) on top could silently drop rows the
  // banner said were there, so only the view the dashboard itself asked for (dashView) applies.
  function reqMatchesQuery(r, q) { return !q || (r.clause + ' ' + (r.clause_name || '') + ' ' + (r.requirement_text || '')).toLowerCase().includes(q.toLowerCase()); }
  function reqVisibleRows() {
    reqSetEvidenceFlags();
    const std = boardStd();
    let rows = applyQuickView(_req.requirements, _req.dashFilter ? (_req.dashView || 'all') : _req.view);
    if (std) rows = rows.filter(r => r.standard_code === std);
    if (_req.q) rows = rows.filter(r => reqMatchesQuery(r, _req.q));
    return rows;
  }
  // Matches the wireframe's own clause-family sections (title case-agnostic across standards, e.g.
  // one "4 Context of the organization" section holding 9001/14001/45001's 4.x rows together — the
  // row's own standard tag is what tells them apart now, not a separate section per standard). Titles
  // mirror the v3 register's own top-level section names (identical across all three standards except
  // 45001's clause 5, "Leadership and worker participation" — shown only while filtered to 45001
  // alone, same as the wireframe's own secName()). clause_family is already computed server-side
  // (requirement.list, R2/9.6) — a plain top-level clause number, so a custom requirement's own
  // non-numeric clause (rare) still groups sensibly under "Other" rather than crashing.
  const CLAUSE_FAMILY_TITLE = { 4: 'Context of the organization', 5: 'Leadership', 6: 'Planning', 7: 'Support', 8: 'Operation', 9: 'Performance evaluation', 10: 'Improvement' };
  function reqClauseCompare(a, b) {
    const x = String(a.clause).split('.'), y = String(b.clause).split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i], q = y[i];
      if (p === q) continue;
      if (p == null) return -1; if (q == null) return 1;
      const pn = Number(p), qn = Number(q);
      if (!isNaN(pn) && !isNaN(qn) && pn !== qn) return pn - qn;
      if (isNaN(pn) || isNaN(qn)) return String(p).localeCompare(String(q));
    }
    return STANDARD_ORDER.indexOf(a.standard_code) - STANDARD_ORDER.indexOf(b.standard_code);
  }
  function buildRequirementSections() {
    const filtered = reqVisibleRows();
    const std = boardStd();
    const groups = new Map();
    for (const r of filtered) {
      const fam = r.clause_family || String(r.clause).split('.')[0] || 'other';
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam).push(r);
    }
    const out = [];
    for (const [fam, rows] of groups) {
      const title = (String(fam) === '5' && std === '45001') ? 'Leadership and worker participation' : (CLAUSE_FAMILY_TITLE[fam] || 'Other');
      rows.sort(reqClauseCompare);
      const famNum = Number(fam);
      out.push({ id: 'fam:' + fam, label: fam + ' ' + title, rows, _sortKey: isNaN(famNum) ? 999 : famNum });
    }
    out.sort((a, b) => a._sortKey - b._sortKey || a.label.localeCompare(b.label));
    for (const r of filtered) r.name = r.clause + (r.clause_name ? ' ' + r.clause_name : '');
    return out;
  }
  function applyQuickView(rows, viewId) {
    const view = QUICK_VIEWS.find(v => v.id === viewId);
    if (!view || !view.where.length) return rows;
    return rows.filter(r => view.where.every(w => {
      const val = r[w.field];
      if (w.op === 'in') return (w.value || []).includes(val);
      if (w.op === 'isnull') return val === null || val === undefined;
      if (w.op === 'notnull') return val !== null && val !== undefined;
      return true;
    }));
  }

  async function saveRequirementField(auditId, id, fieldKey, value) {
    const row = _req.requirements.find(r => r.id === id);
    if (!row) throw new Error('Requirement no longer loaded — refresh and try again.');
    const updated = await mutate('requirement.update', { auditId: auditId, id: id, patch: { [fieldKey]: value }, expectedVersion: row.row_version });
    Object.assign(row, updated);
    return updated;
  }

  // R3: the ctx only needs what the kept generic selection/collapse helpers in index.html
  // (_mtToggleRowSelect, _mtToggleAllSelect, _mtToggleSection, _mtStateFor) actually read —
  // columns/cell/editor/nameHtml existed only for _mtRenderGeneric, which this view no longer calls.
  function buildRequirementsCtx(auditId) {
    return {
      key: 'iso:' + auditId + ':requirements',
      columns() { return []; },
      sections() { return buildRequirementSections(); },
      rowId(row) { return row.id; },
      rowAttrs(row) { const sum = (_req.evidenceSummary || {})[row.id]; return { 'data-ireq': row.id, 'data-evd-suggested': sum && sum.suggested ? '1' : '0' }; },
      open(rowId) { _reqToggleExpand(rowId); },
      rerender() { renderRequirementsTable(auditId); },
    };
  }

  // Each chip's own count, independent of whichever view is active right now (wireframe's own
  // filterChips does the same) — scoped to the board-header standard filter, never the search box
  // (search is a second, independent layer on top, same as the mock).
  function reqQuickViewCount(viewId) {
    const std = boardStd();
    const rows = std ? _req.requirements.filter(r => r.standard_code === std) : _req.requirements;
    return applyQuickView(rows, viewId).length;
  }
  function reqToolbarHtml(auditId) {
    const isManager = canAssessLocally();
    const sole = _isSoleAssessorLocal();
    // A sole auditor's statuses are final on entry (D41) — Awaiting approval/Returned can never
    // hold a row, so those two quick views are hidden rather than shown permanently empty (P2).
    // Exactly the wireframe's own toolbar: search + five filter chips (the last two hidden for a sole
    // auditor). Client-visible and Evidence to review stay as views a dashboard click can land on,
    // just not as chips. "Approve all" shows only while the Lead is on Awaiting approval.
    const lead = canApproveRequirementLocally();
    const showBasis = reqQuickViewCount('needs_basis') > 0 || _req.view === 'needs_basis';
    const showChanged = reqQuickViewCount('changed_since') > 0 || _req.view === 'changed_since'; // B4.3
    const chipIds = ['all', 'not_assessed', 'needs_action'].concat(showBasis ? ['needs_basis'] : []).concat(sole ? [] : ['approval_awaiting', 'returned']).concat(showChanged ? ['changed_since'] : []);
    const chipLabel = { all: 'All', approval_awaiting: lead ? 'Awaiting your approval' : 'Awaiting approval' };
    const views = chipIds.map(id => QUICK_VIEWS.find(v => v.id === id)).filter(Boolean);
    const approveAllCount = lead && !sole && _req.view === 'approval_awaiting' ? reqVisibleRows().filter(r => r.approval_state === 'proposed').length : 0;
    return `<div class="iso-toolbar iso-clause-toolbar">
      <label class="iso-search"><span class="sr">Search clauses</span><input type="search" class="form-input" placeholder="Search clause, name or text" value="${esc(_req.q || '')}" oninput="ISO._reqSetQuery(this.value)"/></label>
      <div class="iso-qv-track">${_req.dashFilter ? '' : views.map(v => `<button type="button" class="iso-fchip${_req.view === v.id ? ' is-on' : ''}" aria-pressed="${_req.view === v.id}" onclick="ISO._reqSetView('${v.id}')">${esc(chipLabel[v.id] || v.label)} <b>${reqQuickViewCount(v.id)}</b></button>`).join('')}</div>
      ${approveAllCount ? `<span class="iso-tb-spacer"></span><button type="button" class="btn btn-teal btn-sm" onclick="ISO._reqApproveAll()">✓ Approve all ${approveAllCount}</button>` : '<span class="iso-tb-spacer"></span>'}
      <button type="button" class="btn btn-ghost btn-sm iso-csv" title="Download this view as CSV" onclick="ISO._exportClausesCsv()">Export CSV<span class="sr"> — clauses</span></button>
      <button type="button" class="btn btn-ghost btn-sm iso-xlsx" title="Download a branded Excel copy — presentable to send to a client" onclick="ISO._exportClausesXlsx()">Export Excel<span class="sr"> — clauses</span></button>
    </div>`;
  }
  function _reqSetQuery(q) { _req.q = q; renderRequirementsTable(_req.auditId); }
  function canAssessLocally() {
    const u = _cu(); if (!u) return false;
    if (u.role === 'admin') return true;
    const m = (_membersCache || []).find(x => x.user_uid === u.id);
    return !!m && ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(m.audit_role);
  }
  function canAddCustom() {
    const u = _cu(); if (!u) return false;
    if (u.role === 'admin') return true;
    const m = (_membersCache || []).find(x => x.user_uid === u.id);
    return !!m && ['lead_auditor', 'audit_manager', 'auditor'].includes(m.audit_role);
  }

  function renderRequirementsTable(auditId) {
    const host = document.getElementById('iso-req-tab');
    if (!host) return;
    const ctx = buildRequirementsCtx(auditId);
    root._isoSetMtCtx(ctx);
    reqSetEvidenceFlags();
    reqComputeConsistency();
    // Redesign: no selection bar — the wireframe has no row checkboxes; bulk sign-off is Approve
    // section / Approve all, shown on the Awaiting approval chip.
    host.innerHTML = _dashFilterBannerHtml(_req, _req.dashFilter ? reqVisibleRows().length : 0, '_reqClearDashFilter') + reqToolbarHtml(auditId) + reqSectionsListHtml(ctx);
  }

  async function fillRequirementsTab(audit) {
    const host = document.getElementById('iso-req-tab');
    if (!host) return;
    // A persisted filter only survives a re-render of the SAME board; switching boards drops it.
    // A fresh dashboard click (_pendingDashNav) then unconditionally overrides that — it must win
    // even though _req.auditId is still the PREVIOUS board's id at this point, not yet this one's.
    const same = _req.auditId === audit.id;
    let dashFilter = same ? _req.dashFilter : null, dashView = same ? (_req.dashView || null) : null, dashLabel = same ? (_req.dashLabel || '') : '';
    let chipView = null;
    if (_pendingDashNav && _pendingDashNav.tab === 'requirements') { ({ filter: dashFilter, view: dashView, label: dashLabel } = _pendingDashNav); _pendingDashNav = null; }
    // An Overview link that only names a quick view (no conditions — Awaiting your approval, Not
    // assessed, Needs action) simply selects that chip: the real view, with its own Approve buttons.
    if (dashFilter && !(dashFilter.where || []).length && dashView && QUICK_VIEWS.some(v => v.id === dashView)) { chipView = dashView; dashFilter = null; dashView = null; dashLabel = ''; }
    try {
      const [requirements, sections, savedViews, evidenceSummary, guidance, relLibrary, docList, reqActions] = await Promise.all([
        dashFilter ? api('requirement.list', { auditId: audit.id, filter: dashFilter }) : api('requirement.list', { auditId: audit.id }),
        api('section.list', { auditId: audit.id }),
        api('view.list', { auditId: audit.id }).catch(() => []),
        api('evidence.summary', { auditId: audit.id }).catch(() => ({})), // 8b.5: Evidence column + markers
        api('guidance.list', { auditId: audit.id }).catch(() => ({})), // Column O cheat sheet (R3)
        api('relationship.library', { auditId: audit.id }).catch(() => ({})), // Column P related clauses (R3)
        api('document.list', { auditId: audit.id }).catch(() => []), // open row's suggested documents + the add-document chooser
        api('action.list', { auditId: audit.id }).catch(() => []), // B2.1: which clauses are already tracked
        _promptTemplates ? Promise.resolve(_promptTemplates) : api('promptTemplate.list').then(t => (_promptTemplates = t || [])).catch(() => []),
      ]);
      _req = {
        auditId: audit.id, requirements: requirements, sections: sections, view: chipView || (_req.auditId === audit.id ? _req.view : 'all'),
        savedViews: (savedViews || []).filter(v => v.entity === 'requirement'), evidenceSummary: evidenceSummary || {},
        guidance: guidance || {}, relLibrary: relLibrary || {}, docs: docList || [], actions: reqActions || [],
        expanded: same ? (_req.expanded || new Set()) : new Set(), relEdit: same ? (_req.relEdit || new Set()) : new Set(), applyPanel: null,
        evidenceByReq: same ? (_req.evidenceByReq || {}) : {}, q: same ? (_req.q || '') : '',
        dashFilter: dashFilter, dashView: dashFilter ? dashView : null, dashLabel: dashFilter ? dashLabel : '',
      };
      // Keeps the drawer's own guidance cache (8b.3) in step, so "Comments · History · Evidence" never
      // re-fetches guidance this tab already has.
      _reqGuidance = { auditId: audit.id, map: guidance || {} };
      if (_reqPendingJump && requirements.some(r => r.id === _reqPendingJump)) { _req.expanded.add(_reqPendingJump); _req.q = ''; _req.view = 'all'; }
    } catch (e) {
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load requirements: ${esc(e.message)}</div>`;
      return;
    }
    renderRequirementsTable(audit.id);
    if (_reqPendingJump) {
      const el = host.querySelector(`[data-ireq="${CSS.escape(_reqPendingJump)}"]`);
      _reqPendingJump = null;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
  }

  function _reqSetView(v) { _req.view = v; renderRequirementsTable(_req.auditId); }
  function _reqClearDashFilter() { _req.dashFilter = null; _req.dashView = null; _req.dashLabel = ''; fillRequirementsTab(_auditCache); }
  async function _reqSaveView() {
    // The app's own non-blocking prompt, never the native window.prompt (A49/A52's own fix, applied
    // here too — this call site was missed at the time; found while reviewing this file for 9.6).
    const name = await _promptAsync('Name this view?');
    if (!name || !name.trim()) return;
    const view = QUICK_VIEWS.find(v => v.id === _req.view);
    try {
      await api('view.save', { auditId: _req.auditId, entity: 'requirement', name: name.trim(), config: { quickView: _req.view, where: view ? view.where : [] } });
      const views = await api('view.list', { auditId: _req.auditId });
      _req.savedViews = (views || []).filter(v => v.entity === 'requirement');
      renderRequirementsTable(_req.auditId);
      root.showToast ? root.showToast('View saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save view: ' + e.message, true) : alert(e.message); }
  }
  function _reqLoadSavedView(viewId) {
    const v = _req.savedViews.find(x => x.id === viewId);
    if (!v) return;
    _req.view = (v.config && v.config.quickView) || 'all';
    renderRequirementsTable(_req.auditId);
  }
  // Retired (R3, D35 P6): Column P's relationships ship with the library and are computed live
  // (relationship.library) — there is nothing left to "suggest" per board. The op itself
  // (relationship.suggest) and the old per-board iso_relationships suggest/decide flow stay in
  // api/_iso.js untouched (relationship.add's manual kind still uses that same table), just with
  // no remaining UI entry point.
  async function _reqSuggestRelationships() {
    try {
      const r = await mutate('relationship.suggest', { auditId: _req.auditId });
      root.showToast ? root.showToast(`${r.created} new relationship suggestion${r.created === 1 ? '' : 's'} found.`) : null;
    } catch (e) { root.showToast ? root.showToast('Could not generate suggestions: ' + e.message, true) : alert(e.message); }
  }

  // ── Bulk changes from the selection bar (plan 6.4; simplified R3 per P7's remove/merge list) ────
  const REQ_BULK_FIELDS = [
    { key: 'compliance_status', label: 'Status' }, { key: 'responsible_uid', label: 'Owner' },
  ];
  function _reqSelectedIds() { return [...(root._mtStateFor ? root._mtStateFor('iso:' + _req.auditId + ':requirements').selected : [])]; }
  function _reqBulkSpec(field, n) {
    const label = `${REQ_BULK_FIELDS.find(f => f.key === field).label} for ${n} selected`;
    // Not Applicable needs its own reason per clause — the server already refuses it in bulk (P4);
    // left out of the options here too, so there is nothing to pick that would just fail.
    if (field === 'compliance_status') return { type: 'select', label, value: null, options: COMPLIANCE_STATUSES.filter(s => s !== 'not_applicable').map(s => ({ value: s, label: complianceLabel(s), color: complianceColor(s) })) };
    return { type: 'select', label, value: null, options: [{ value: '', label: 'Unassigned' }].concat((_DB().users || []).filter(u => u.role !== 'client').map(u => ({ value: u.id, label: u.name }))) };
  }
  function _reqBulkPick(btn) {
    const field = btn.dataset.field, ids = _reqSelectedIds();
    if (!ids.length || !root._mtOpenDropdown) return;
    root._mtOpenDropdown(btn, _reqBulkSpec(field, ids.length), v => _reqBulkApply(field, v === '' ? null : v));
  }
  async function _reqBulkApply(field, value) {
    const ids = _reqSelectedIds();
    if (!ids.length) return;
    try {
      const r = await mutate('requirement.bulkUpdate', { auditId: _req.auditId, ids: ids, patch: { [field]: value } });
      root._mtStateFor('iso:' + _req.auditId + ':requirements').selected.clear();
      await fillRequirementsTab({ id: _req.auditId });
      root.showToast ? root.showToast(`${r.updated} requirement${r.updated === 1 ? '' : 's'} updated.`) : null;
    } catch (e) { root.showToast ? root.showToast('Could not bulk update: ' + e.message, true) : alert(e.message); }
  }
  function _reqBulkSeniorPick(btn) {
    const ids = _reqSelectedIds();
    if (!ids.length || !root._mtOpenDropdown) return;
    root._mtOpenDropdown(btn, { type: 'select', label: `Senior review for ${ids.length} selected`, value: null, options: [
      { value: 'suggested', label: 'Accept suggested verdicts', color: SR_COLOR.compliant }, { value: 'pending', label: 'Reset to awaiting', color: SR_COLOR.pending },
    ] }, v => _reqBulkSeniorApply(v));
  }
  async function _reqBulkSeniorApply(status) {
    const ids = _reqSelectedIds();
    if (!ids.length) return;
    try {
      const r = await mutate('requirement.bulkSeniorReview', { auditId: _req.auditId, ids: ids, status: status });
      root._mtStateFor('iso:' + _req.auditId + ':requirements').selected.clear();
      await fillRequirementsTab({ id: _req.auditId });
      const own = r.skipped.filter(s => /another senior reviewer/.test(s.reason)).length, early = r.skipped.length - own;
      const parts = [`${r.updated} ${status === 'suggested' ? 'given their suggested verdict' : 'reset'}`];
      if (own) parts.push(`${own} skipped — you assessed them`);
      if (early) parts.push(`${early} skipped — no result yet`);
      root.showToast ? root.showToast(parts.join(' · ') + '.', !r.updated && r.skipped.length > 0) : null;
    } catch (e) { root.showToast ? root.showToast('Could not update the senior review: ' + e.message, true) : alert(e.message); }
  }
  function _reqBulkClear() {
    if (root._mtStateFor) root._mtStateFor('iso:' + _req.auditId + ':requirements').selected.clear();
    renderRequirementsTable(_req.auditId);
  }

  // ── Add custom requirement (plan 6.3b) ──────────────────────────────────────────────────────────
  function _openAddRequirement() {
    const standards = (_auditCache && _auditCache.standards) || [...new Set(_req.requirements.map(r => r.standard_code))];
    root.openGenericModal('Add requirement', `
      <div class="iso-field-grid">
        <label>Standard<select class="form-input" id="ar-std">${standards.map(s => `<option value="${s}">ISO ${s}</option>`).join('')}</select></label>
        <label>Clause<input class="form-input" id="ar-clause" placeholder="e.g. 8.1.1"/></label>
        <label>Clause name<input class="form-input" id="ar-clausename" placeholder="e.g. Contractual requirement"/></label>
        <label>Origin<select class="form-input" id="ar-origin"><option value="client_specific">Client-specific</option><option value="contractual">Contractual</option><option value="regulatory_legal">Regulatory / legal</option></select></label>
        <label style="grid-column:1/-1">Requirement text<textarea class="form-input" id="ar-text" style="min-height:80px"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._addRequirementApply()">Add</button>
    `, '560px');
  }
  async function _addRequirementApply() {
    const payload = {
      auditId: (_auditCache && _auditCache.id) || _req.auditId, standardCode: document.getElementById('ar-std').value,
      clause: document.getElementById('ar-clause').value.trim(), clauseName: document.getElementById('ar-clausename').value.trim(),
      requirementText: document.getElementById('ar-text').value.trim(), origin: document.getElementById('ar-origin').value,
    };
    try {
      await mutate('requirement.addCustom', payload);
      document.getElementById('generic-modal').classList.add('hidden');
      if (document.getElementById('iso-req-tab')) await fillRequirementsTab({ id: payload.auditId });
      root.showToast ? root.showToast('Requirement added.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not add requirement: ' + e.message, true) : alert(e.message); }
  }

  // ── Requirement drawer (plan 6.2) ───────────────────────────────────────────────────────────────
  let _openDrawerReqId = null;
  // Plan 8b.2: the requirement drawer is tabbed. Switching tabs only shows/hides panels (no re-render),
  // and unsaved Assessment edits live in _reqDraft so a refresh after an action (evidence added,
  // relationship decided, comment posted) can't drop them either; a successful save clears it.
  let _reqDrawerTab = 'assessment';
  let _reqGuidance = { auditId: null, map: {} };
  // Plan 8b.3 (D25): approved internal guidance (labelled as not replacing the standard) and the
  // workbook's evidence examples (labelled guidance only). Nothing known → no card at all.
  const CHANGE_KIND_LABEL = { added: 'Added', changed: 'Changed', unchanged: 'Unchanged' };
  // 4b.2: what this edition changed for the clause, each with its source (copyable, never a link).
  function reqChangesHtml(g, spaced) {
    const changes = (g && g.changes) || [];
    if (!changes.length && !(g && g.newInEdition)) return '';
    return `<div class="iso-guidance-changes"${spaced ? ' style="margin-top:10px"' : ''}><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">What changed in ${esc(stdLabelFor(g.standardCode, { [g.standardCode]: g.edition }))}</div>
      ${g.newInEdition ? '<div class="iso-guidance-new" style="font-size:11px;font-weight:700;color:#0d6e4e;margin-bottom:4px">New in this edition — drafted by Etcher from the sources below; check the wording against the licensed standard.</div>' : ''}
      ${changes.map(c => `<div class="iso-guidance-change" style="font-size:12px;color:#0d1c33;line-height:1.6;margin-bottom:6px"><span style="font-size:10px;font-weight:700;border:1px solid #cbd5e1;border-radius:4px;padding:0 5px;margin-right:6px">${esc(CHANGE_KIND_LABEL[c.kind] || c.kind)} · ${esc(c.clause)}</span>${esc(c.summary)}
        ${(c.sources || []).map(s => `<div class="iso-guidance-source" style="font-size:11px;color:#6b8399;display:flex;gap:6px;align-items:center;flex-wrap:wrap">Source: ${esc(s.title)}${s.how && /extract/.test(s.how) ? ' (' + esc(s.how) + ')' : ''} <button type="button" class="btn btn-ghost btn-sm" style="font-size:10px;padding:0 6px" data-url="${esc(s.url)}" onclick="ISO._evdCopyLink(this.dataset.url)">Copy link</button></div>`).join('')}</div>`).join('')}
    </div>`;
  }
  function reqGuidanceHtml(g) {
    if (!g || (!g.evidenceExamples && !g.clause && !g.requirement && !(g.changes && g.changes.length) && !g.newInEdition)) return '';
    const internal = [g.clause, g.requirement].filter(Boolean);
    return `<div class="card iso-guidance" style="padding:14px 16px;margin-bottom:12px;background:#f8fafc">
      ${internal.length ? `<div class="iso-guidance-internal"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Internal guidance — does not replace the standard requirement</div>
        ${internal.map(x => `${x.explanation ? `<div style="font-size:12px;color:#0d1c33;line-height:1.6;margin-bottom:6px">${esc(x.explanation)}</div>` : ''}${x.auditorLooksFor ? `<div style="font-size:12px;color:#4a5568;line-height:1.6;margin-bottom:6px"><strong>What the auditor may look for:</strong> ${esc(x.auditorLooksFor)}</div>` : ''}`).join('')}</div>` : ''}
      ${g.evidenceExamples ? `<div class="iso-guidance-examples"${internal.length ? ' style="margin-top:10px"' : ''}><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">Suggested evidence (from the workbook)</div>
        <div style="font-size:12px;color:#0d1c33;white-space:pre-wrap;line-height:1.6">${esc(g.evidenceExamples)}</div>
        <div style="font-size:11px;color:#8da2b2;margin-top:6px">Guidance only. Suggested evidence is non-mandatory and non-exhaustive.</div></div>` : ''}
      ${reqChangesHtml(g, internal.length || g.evidenceExamples)}
    </div>`;
  }
  let _reqDraft = null; // { reqId, fields: { <row key>: value } }
  const REQ_DRAFT_FIELDS = { 'dr-state': 'assessment_state', 'dr-result': 'assessment_result', 'dr-applic': 'applicability', 'dr-naj': 'na_justification', 'dr-owner': 'responsible_uid', 'dr-date': 'target_date', 'dr-eff': 'effectiveness', 'dr-risk': 'risk_severity', 'dr-cursys': 'current_system', 'dr-gap': 'gap_description', 'dr-rec': 'recommended_action', 'dr-cvc': 'client_visible_comment' };
  function _reqDraftCapture() {
    if (!_openDrawerReqId) return;
    const fields = {};
    for (const [elId, key] of Object.entries(REQ_DRAFT_FIELDS)) { const el = document.getElementById(elId); if (el) fields[key] = el.value; }
    _reqDraft = { reqId: _openDrawerReqId, fields: fields };
  }
  function _reqDrawerSetTab(tabId) {
    const body = document.getElementById('iso-drawer-body');
    if (!body) return;
    const tabs = [...body.querySelectorAll('[role="tab"]')];
    if (!tabs.some(t => t.dataset.tab === tabId)) return;
    _reqDrawerTab = tabId;
    tabs.forEach(t => { const on = t.dataset.tab === tabId; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; t.classList.toggle('active', on); });
    body.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = p.dataset.tab !== tabId; });
  }
  // WAI-ARIA tabs keyboard model: Left/Right move (wrapping), Home/End jump; selection follows focus.
  function _reqDrawerTabKey(e) {
    const tabs = [...document.querySelectorAll('#iso-drawer-body [role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    _reqDrawerSetTab(tabs[j].dataset.tab);
    tabs[j].focus();
  }
  async function openRequirementDrawer(auditId, id, opts) {
    const row = _req.requirements.find(r => r.id === id);
    if (!row) return;
    // A refresh after an action stays on (or goes to) its tab; a fresh open starts on Assessment.
    const drawerTab = (opts && opts.tab) || (opts && opts.keepTab && _openDrawerReqId === id ? _reqDrawerTab : 'assessment');
    if (_reqDraft && _reqDraft.reqId !== id) _reqDraft = null;
    _openDrawerReqId = id;
    // openGenericModal sets the title with textContent, so it gets plain text — esc() here showed a
    // literal "&amp;" for any title containing "&".
    root.openGenericModal(`${stdLabel(row.standard_code)} ${row.clause} ${row.clause_name || ''}`, `<div id="iso-drawer-body">${skeletonFor('drawer')}</div>`, '1040px', reqApprovalHeaderHtml(row));
    let relationships = [], comments = [], activity = [], findings = [], actions = [], evidence = [], guidanceMap = {}, templates = [], suggestions = [];
    try {
      [relationships, comments, activity, findings, actions, evidence, guidanceMap, templates, suggestions] = await Promise.all([
        api('relationship.list', { auditId: auditId }),
        api('comment.list', { auditId: auditId }),
        api('activity.list', { auditId: auditId }),
        api('finding.list', { auditId: auditId }),
        api('action.list', { auditId: auditId }),
        api('evidence.list', { auditId: auditId, targetType: 'requirement', targetId: id }),
        // Guidance is library content — fixed for a board, so fetched once per board and cached (8b.3).
        (_reqGuidance.auditId === auditId ? Promise.resolve(_reqGuidance.map) : api('guidance.list', { auditId: auditId }).then(m => { _reqGuidance = { auditId: auditId, map: m || {} }; return _reqGuidance.map; })),
        // Prompt templates are reviewed seed files, fixed for the session (8c.4).
        (_promptTemplates ? Promise.resolve(_promptTemplates) : api('promptTemplate.list').then(t => (_promptTemplates = t || [])).catch(() => [])),
        api('evidence.suggestions', { auditId: auditId, targetId: id }).catch(() => []), // 8b.5 (derived, D21)
      ]);
    } catch (e) {}
    const body = document.getElementById('iso-drawer-body');
    if (!body) return; // modal was closed before the fetch resolved
    const myRelationships = relationships.filter(r => r.from_id === id || r.to_id === id);
    const myComments = comments.filter(c => c.entity_type === 'requirement' && c.entity_id === id);
    const myActivity = activity.filter(a => a.entity_type === 'requirement' && a.entity_id === id).slice(0, 30);
    // Traceability panels (Phase 7.4): a finding always has exactly one source requirement
    // (finding.list's own requirement_id, attached server-side — see that op's comment); an
    // action can be linked to several findings/requirements (action.list's own links array).
    // _fnd.requirements was missing here — _openAddFinding's "Source requirement" dropdown reads
    // it directly, so on a cold session (Findings tab never visited, _fnd.requirements still its
    // initial []) the drawer's own "+ New finding" shortcut rendered an EMPTY dropdown, submitting
    // requirementId:'' and failing finding.create with no visible crash, just a toast — found
    // running the real offline demo end to end (STOP 2 review, 2026-10-01), not by a synthetic
    // test (iso-ui-test.cjs always visits the Findings tab, which populates this correctly, before
    // ever exercising "+ New finding", so it never hit the cold-state path this shortcut has).
    _fnd.findings = findings; _fnd.requirements = _req.requirements; _fnd.auditId = auditId; // shares
    // the Findings tab's own cache so _openAddFinding's dropdown and any later Findings-tab visit stay in sync.
    _act.actions = actions; _act.findings = findings; _act.requirements = _req.requirements; _act.auditId = auditId;
    const myFindings = findings.filter(f => f.requirement_id === id);
    const myActions = actions.filter(a => (a.links || []).some(l => l.target_type === 'requirement' && l.target_id === id));
    const isManager = canAssessLocally();
    // Unsaved edits win over the stored row for this one requirement (see _reqDraft above).
    const v = k => (_reqDraft && _reqDraft.reqId === id && k in _reqDraft.fields) ? _reqDraft.fields[k] : row[k];
    const tabs = [
      { id: 'assessment', label: 'Assessment' },
      { id: 'evidence', label: `Evidence (${evidence.length})${suggestions.length ? ` · ⟳ ${suggestions.length} suggested` : ''}` },
      { id: 'relationships', label: `Relationships (${myRelationships.length})` },
      { id: 'links', label: `Findings and actions (${myFindings.length + myActions.length})` },
      { id: 'comments', label: `Comments (${myComments.length})` },
      { id: 'activity', label: 'Activity' },
    ];
    const active = tabs.some(t => t.id === drawerTab) ? drawerTab : 'assessment';
    _reqDrawerTab = active;
    const panel = (tabId, html) => `<div class="iso-drawer-panel" role="tabpanel" id="iso-rdp-${tabId}" aria-labelledby="iso-rdt-${tabId}" data-tab="${tabId}"${tabId === active ? '' : ' hidden'}>${html}</div>`;
    body.innerHTML = `
      <div class="card iso-drawer-header" style="padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#6b8399">${esc(stdLabel(row.standard_code))}</span>
          <span style="font-size:15px;font-weight:700;color:#0d1c33">${esc(row.clause)} ${esc(row.clause_name || '')}</span>
        </div>
        <div class="iso-req-wording-label" style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Requirement (Etcher wording) · ${esc(stdLabel(row.standard_code))} ${esc(row.clause)}</div>
        <div style="font-size:13px;color:#0d1c33;line-height:1.6;white-space:pre-wrap">${esc(row.requirement_text)}</div>
        <div style="font-size:11px;color:#8da2b2;margin-top:6px">Check the licensed standard for the authoritative text.</div>
      </div>
      ${row.source_changed ? `<div class="card" style="padding:8px 12px;margin-bottom:10px;background:#fff7ed;color:#92400e;font-size:12px">The source workbook changed after this was assessed — review before relying on the imported text below.</div>` : ''}
      ${row.missing_from_source ? `<div class="card" style="padding:8px 12px;margin-bottom:10px;background:#fef2f2;color:#991b1b;font-size:12px">No longer in the workbook (kept, not deleted).</div>` : ''}
      <div role="tablist" aria-label="Requirement sections" class="iso-drawer-tabs" onkeydown="ISO._reqDrawerTabKey(event)">
        ${tabs.map(t => `<button type="button" role="tab" id="iso-rdt-${t.id}" data-tab="${t.id}" aria-controls="iso-rdp-${t.id}" aria-selected="${t.id === active ? 'true' : 'false'}" tabindex="${t.id === active ? 0 : -1}" class="iso-drawer-tab${t.id === active ? ' active' : ''}" onclick="ISO._reqDrawerSetTab('${t.id}')">${esc(t.label)}</button>`).join('')}
      </div>
      ${panel('assessment', `
      ${reqApprovalNoteHtml(row)}
      ${reqGuidanceHtml(guidanceMap[id])}
      <div class="card" style="padding:16px;margin-bottom:12px" oninput="ISO._reqDraftCapture()" onchange="ISO._reqDraftCapture()">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Assessment</div>
        <div class="iso-field-grid">
          <label style="grid-column:1/-1">Status<select class="form-input" id="dr-status" ${isManager ? '' : 'disabled'}>${COMPLIANCE_STATUSES.map(s => `<option value="${s}"${(v('compliance_status') || 'not_assessed') === s ? ' selected' : ''}>${esc(COMPLIANCE_STATUS_FULL[s] ? `${complianceLabel(s)} — ${COMPLIANCE_STATUS_FULL[s]}` : complianceLabel(s))}</option>`).join('')}</select></label>
          <label style="grid-column:1/-1">Why it doesn't apply <span style="font-weight:400;color:#6b8399">(required for N/A)</span><input class="form-input" id="dr-naj" value="${esc(v('na_justification') || '')}" ${isManager ? '' : 'disabled'}/></label>
          <label>Owner<select class="form-input" id="dr-owner" ${isManager ? '' : 'disabled'}><option value="">Unassigned</option>${(_DB().users || []).filter(u => u.role !== 'client').map(u => `<option value="${u.id}"${v('responsible_uid') === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          <label>Due<input type="date" class="form-input" id="dr-date" value="${esc(v('target_date') || '')}" ${isManager ? '' : 'disabled'}/></label>
          <label style="grid-column:1/-1">Current system<textarea class="form-input" id="dr-cursys" ${isManager ? '' : 'disabled'}>${esc(v('current_system') || '')}</textarea></label>
          <label style="grid-column:1/-1">Planned action<textarea class="form-input" id="dr-rec" ${isManager ? '' : 'disabled'}>${esc(v('recommended_action') || '')}</textarea></label>
          <label style="grid-column:1/-1">Client-visible comment<textarea class="form-input" id="dr-cvc" ${isManager ? '' : 'disabled'}>${esc(v('client_visible_comment') || '')}</textarea></label>
        </div>
        ${isManager ? `<button class="btn btn-teal btn-sm" style="margin-top:12px" onclick="ISO._drawerSave('${esc(id)}',${row.row_version})">Save</button>` : ''}
        ${_reqDraft && _reqDraft.reqId === id ? `<span class="iso-draft-note" style="font-size:11px;color:#b45309;margin-left:10px">Unsaved changes</span>` : ''}
      </div>
      ${row.imported ? `<details class="card" style="padding:12px 16px;margin-bottom:12px"><summary style="cursor:pointer;font-size:11px;color:#6b8399">Original workbook text</summary>
        <div style="font-size:12px;color:#4a5568;margin-top:6px;white-space:pre-wrap">Current system: ${esc(row.imported.currentSystem || '—')}\nStatus: ${esc(row.imported.complianceStatus || '—')}\nPlanned action: ${esc(row.imported.plannedAction || '—')}\nEvidence: ${esc(row.imported.evidenceExamples || '—')}</div>
      </details>` : ''}`)}
      ${panel('evidence', reqSuggestionsHtml(suggestions, row, auditId, isManager) + _evdPanelHtml('requirement', id, auditId, evidence, isManager) + reqSuggestedDocsHtml(templates, row, auditId, guidanceMap[id]))}
      ${panel('relationships', `
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:12px;flex:1">Related requirements (${myRelationships.length})</div>${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._openAddRelationship('${esc(id)}')">+ Add relationship</button>` : ''}</div>
        ${myRelationships.length ? groupByStandardHtml(myRelationships, r => { const o = r.from_id === id ? r.to : r.from; return o && o.standard_code; }, r => reqRelationshipRowHtml(r, id, isManager), 'No longer on this board') : '<div style="color:#8da2b2;font-size:12px">None yet — use "Suggest relationships" on the register.</div>'}
      </div>`)}
      ${panel('links', `
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:12px;flex:1">Findings raised from this requirement (${myFindings.length})</div>${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._openAddFinding('${esc(id)}')">+ New finding</button>` : ''}</div>
        ${myFindings.length ? myFindings.map(f => `<div style="padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="ISO.openFindingDrawer('${esc(auditId)}','${esc(f.id)}')">
          <span style="flex:1">${esc(f.ref)} — ${esc(f.title)}</span>
          ${fndPill(FINDING_CLASSIFICATION_LABEL[f.classification] || f.classification, fndClassColor(f.classification))}
          ${fndPill(FINDING_STATUS_LABEL[f.status] || f.status, fndStatusColor(f.status))}
        </div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No findings raised from this requirement yet.</div>'}
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:12px;flex:1">Actions linked to this requirement (${myActions.length})</div>${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._openAddAction('requirement','${esc(id)}')">+ New action</button>` : ''}</div>
        ${myActions.length ? myActions.map(a => `<div style="padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="ISO.openActionDrawer('${esc(auditId)}','${esc(a.id)}')">
          <span style="flex:1">${esc(a.ref)} — ${esc(a.title)}</span>
          ${actPill(ACTION_STATUS_LABEL[a.status] || a.status, actStatusColor(a.status))}
        </div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No actions linked to this requirement yet.</div>'}
      </div>`)}
      ${panel('comments', reqCommentsHtml(myComments, id))}
      ${panel('activity', `
      <div class="card" style="padding:16px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Activity</div>
        ${myActivity.length ? myActivity.map(a => `<div style="padding:4px 0;font-size:11px;color:#4a5568">${esc(fmtTs(a.at))} — ${esc(REQ_ACTIVITY_LABEL[a.action] || a.action)}${a.action === 'senior_review_redo' && a.reason ? ': ' + esc(a.reason) : ''}${a.actor_uid ? ' · ' + esc(_uidName(a.actor_uid) || '') : ''}</div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No activity recorded yet.</div>'}
      </div>`)}`;
  }
  const REQ_ACTIVITY_LABEL = { updated: 'Updated', bulk_updated: 'Updated in bulk', commented: 'Comment added', senior_review_compliant: 'Senior verdict: Compliant', senior_review_partially_compliant: 'Senior verdict: Partially compliant', senior_review_non_compliant: 'Senior verdict: Non-compliant', senior_review_na_confirmed: 'Senior verdict: N/A confirmed', senior_review_redo: 'Sent back for redo', senior_review_pending: 'Senior review reset to awaiting' };
  // D33: the staff conversation about this clause. Staff comments are always stored internal
  // (comment.add sets it server-side) and comment.list never returns them to a client — this tab
  // only ever renders inside the staff drawer.
  function reqCommentsHtml(comments, id) {
    const sorted = comments.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const nameOf = c => c.author_name || _uidName(c.author_uid) || String(c.author_uid || '').replace(/^offline:/, '') || 'Someone';
    const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
    return `<div class="card iso-cmt" style="padding:16px;margin-bottom:12px">
      <div class="iso-cmt-h"><span class="iso-cmt-title">Staff discussion</span><span class="iso-cmt-private"><span aria-hidden="true">🔒</span> Staff only — never shown to the client</span></div>
      <div class="iso-cmt-list" role="log" aria-label="Comments">${sorted.length ? sorted.map(c => { const n = nameOf(c); const mine = srIsMine(c.author_uid); return `<div class="iso-cmt-item${mine ? ' is-mine' : ''}">
        <span class="iso-cmt-av" aria-hidden="true">${esc(initials(n))}</span>
        <div class="iso-cmt-bubble"><div class="iso-cmt-meta"><strong>${esc(mine ? 'You' : n)}</strong><span>${esc(fmtTs(c.created_at))}</span>${c.visibility === 'client_all' ? '<span class="iso-cmt-client">From the client</span>' : ''}</div><div class="iso-cmt-body">${esc(c.body)}</div></div>
      </div>`; }).join('') : '<div class="iso-cmt-empty">No comments yet — start the conversation for the team.</div>'}</div>
      <div class="iso-cmt-compose"><label for="dr-comment" class="sr-only">Write a comment</label><textarea class="form-input" id="dr-comment" rows="2" placeholder="Write to the team… (Ctrl+Enter to post)" data-id="${esc(id)}" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();ISO._drawerAddComment(this.dataset.id)}"></textarea><button class="btn btn-teal btn-sm" data-id="${esc(id)}" onclick="ISO._drawerAddComment(this.dataset.id)">Post</button></div>
    </div>`;
  }
  // Plan 8b.1 (R11): the relationship's kind, reason and whether a person made it, so an auditor can
  // judge it before confirming. `mapping` is rule-made only (the cross-standard mapping table).
  const REL_KIND_LABEL = { same_requirement: 'Equivalent requirement', integrated_topic: 'Shared integrated control', mapping: 'Linked through a shared action', shared_evidence: 'Shared evidence', supporting: 'Supporting' };
  const REL_MANUAL_KINDS = ['same_requirement', 'integrated_topic', 'shared_evidence', 'supporting'];
  function reqRelationshipRowHtml(rel, thisId, isManager) {
    // relationship.list carries both ends' clause and wording — never look the other side up in the
    // register's loaded rows, which may be filtered to one standard (that showed raw ids).
    const other = rel.from_id === thisId ? rel.to : rel.from;
    const stateColor = rel.state === 'confirmed' ? '#0d6e4e' : rel.state === 'rejected' ? '#b91c1c' : '#b45309';
    const label = other
      ? `<strong>${esc(other.clause)} ${esc(other.clause_name || '')}</strong><span class="iso-rel-text"> — ${esc((other.requirement_text || '').slice(0, 90))}</span>`
      : '<span style="color:#8da2b2">A requirement no longer on this board</span>';
    return `<div class="iso-rel-row" style="padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1">${label}</span>
        ${reqPill(rel.state, stateColor)}
        ${isManager && rel.state === 'suggested' ? `<button class="btn btn-ghost btn-sm" onclick="ISO._relationshipDecide('${esc(rel.id)}','confirmed')">Confirm</button><button class="btn btn-ghost btn-sm" onclick="ISO._relationshipDecide('${esc(rel.id)}','rejected')">Reject</button>` : ''}
      </div>
      <div style="font-size:11px;color:#6b8399;margin-top:2px">${esc(REL_KIND_LABEL[rel.kind] || rel.kind)}${rel.source === 'manual' ? ' · user-defined' : ''}${rel.reason_text ? ' — ' + esc(rel.reason_text) : ''}</div>
    </div>`;
  }
  async function _openAddRelationship(fromId) {
    // The whole board, not the register's loaded rows — those may be filtered to one standard (9.5),
    // and a relationship is most often with another standard's requirement.
    let all = _req.requirements;
    if (_req.dashFilter) { try { all = await api('requirement.list', { auditId: _req.auditId }); } catch (e) {} }
    const from = all.find(r => r.id === fromId);
    if (!from) return;
    const opts = all.filter(r => r.id !== fromId)
      .map(r => `<option value="${esc(r.id)}">${esc(stdLabel(r.standard_code) + ' ' + r.clause + ' — ' + (r.requirement_text || '').slice(0, 70))}</option>`).join('');
    root.openGenericModal('Add relationship', `
      <div style="font-size:12px;color:#6b8399;margin-bottom:10px">From ${esc(stdLabel(from.standard_code) + ' ' + from.clause)} — ${esc((from.requirement_text || '').slice(0, 90))}</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <label>Related requirement<select class="form-input" id="rel-add-target"><option value="">Choose…</option>${opts}</select></label>
        <label>Type<select class="form-input" id="rel-add-kind">${REL_MANUAL_KINDS.map(k => `<option value="${k}">${esc(REL_KIND_LABEL[k])}</option>`).join('')}</select></label>
        <label>Reason (required)<textarea class="form-input" id="rel-add-reason" placeholder="Why these two requirements belong together"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:16px" onclick="ISO._relAddApply('${esc(fromId)}')">Add relationship</button>
    `, '560px');
  }
  async function _relAddApply(fromId) {
    const toId = document.getElementById('rel-add-target').value;
    const kind = document.getElementById('rel-add-kind').value;
    const reasonText = document.getElementById('rel-add-reason').value.trim();
    if (!toId || !reasonText) { root.showToast ? root.showToast('Pick a requirement and give a reason.', true) : null; return; }
    try {
      await mutate('relationship.add', { auditId: _req.auditId, fromId: fromId, toId: toId, kind: kind, reasonText: reasonText });
      root.showToast ? root.showToast('Relationship added.') : null;
      await openRequirementDrawer(_req.auditId, fromId, { tab: 'relationships' });
      _reqRefreshEvidence(_req.auditId);
    } catch (e) { root.showToast ? root.showToast('Could not add the relationship: ' + e.message, true) : alert(e.message); }
  }
  async function _relationshipDecide(id, decision) {
    try {
      await mutate('relationship.decide', { auditId: _req.auditId, id: id, decision: decision });
      if (_openDrawerReqId) await openRequirementDrawer(_req.auditId, _openDrawerReqId, { keepTab: true }); // refresh in place
      _reqRefreshEvidence(_req.auditId); // a confirmed relationship can create evidence suggestions (D21)
      root.showToast ? root.showToast('Updated.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not update: ' + e.message, true) : alert(e.message); }
  }
  async function _drawerSave(id, expectedVersion) {
    const patch = {
      compliance_status: document.getElementById('dr-status').value,
      na_justification: document.getElementById('dr-naj').value || null,
      responsible_uid: document.getElementById('dr-owner').value || null,
      target_date: document.getElementById('dr-date').value || null,
      current_system: document.getElementById('dr-cursys').value,
      recommended_action: document.getElementById('dr-rec').value,
      client_visible_comment: document.getElementById('dr-cvc').value,
    };
    try {
      await mutate('requirement.update', { auditId: _req.auditId, id: id, patch: patch, expectedVersion: expectedVersion });
      _reqDraft = null; // saved — the server copy is the truth again (8b.2)
      document.getElementById('generic-modal').classList.add('hidden');
      await fillRequirementsTab({ id: _req.auditId });
      root.showToast ? root.showToast('Saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }
  async function _drawerAddComment(id) {
    const input = document.getElementById('dr-comment');
    const bodyText = input && input.value.trim();
    if (!bodyText) return;
    try {
      await mutate('comment.add', { auditId: _req.auditId, body: bodyText, entityType: 'requirement', entityId: id });
      await openRequirementDrawer(_req.auditId, id, { tab: 'comments' });
      const list = document.querySelector('#iso-rdp-comments .iso-cmt-list'); if (list) list.scrollTop = list.scrollHeight;
      document.getElementById('dr-comment')?.focus();
    } catch (e) { root.showToast ? root.showToast('Could not post comment: ' + e.message, true) : alert(e.message); }
  }

  // ── Reason-required retry (Phase 7.4 is the first UI to reach any op guarded by
  // api/_iso.js's requireReason — classification downgrade, visibility-after-release, an
  // overdue due-date change) — a plain badRequest with no reason ever surfaced no way to supply
  // one. Detected by message text (requireReason's own, exact and stable: "A reason is required
  // to <what>.") since no separate error code exists for it; retries the identical call once
  // with the collected reason, never silently drops the attempt.
  // Uses the app's own callback-based showPrompt (index.html), never the native window.prompt —
  // a native dialog blocks the whole page's JS thread until dismissed, which a headless/automated
  // session (or a Puppeteer test with no dialog handler) can never do; found by iso-ui-test.cjs
  // hanging indefinitely on exactly this call, confirmed by adding a temporary page.on('dialog')
  // listener and reading its message back before fixing this to the callback form. ────────────────
  function _promptAsync(question) {
    return new Promise(resolve => {
      if (root.showPrompt) root.showPrompt(question, '', val => resolve(val));
      else resolve(null); // no prompt UI available at all — fail closed, never block
    });
  }
  async function mutateReasoned(op, payload) {
    try { return await mutate(op, payload); }
    catch (e) {
      if (!/reason is required/i.test(e.message)) throw e;
      const reason = await _promptAsync(e.message.replace(/\.$/, '?'));
      if (!reason || !reason.trim()) throw e;
      return await mutate(op, Object.assign({}, payload, { reason: reason.trim() }));
    }
  }

  // ── Findings register (plan Phase 7.4) — same generic Main Table ctx as Requirements (Phase
  // 6), grouped by classification instead of standard/clause since a finding isn't tied to one
  // section the way a requirement is. A finding always originates from a requirement
  // (finding.create requires requirementId, plan §6.2) — "+ New finding" here picks one from a
  // dropdown of this audit's requirements rather than assuming the user came from that drawer. ────
  const FINDING_CLASSIFICATION_LABEL = { major_nc: 'Major NC', minor_nc: 'Minor NC', observation: 'Observation', ofi: 'OFI' };
  const FINDING_STATUS_LABEL = { draft: 'Draft', released_for_review: 'Released for review', final: 'Final', closed: 'Closed', withdrawn: 'Withdrawn', reopened: 'Reopened' };
  // Findings/actions share this 5-value visibility set (009's own check constraint) — wider than
  // requirements' 3-value one (VISIBILITY_LABEL above), so kept separate rather than reused.
  const FA_VISIBILITY_LABEL = { internal: 'Internal', client_selected: 'Selected clients', client_all: 'All client members', after_approval: 'After approval', report_only: 'Report only' };
  const FINDING_QUICK_VIEWS = [
    { id: 'all', label: 'All findings', test: () => true },
    { id: 'open', label: 'Open', test: r => r.status === 'draft' || r.status === 'released_for_review' || r.status === 'reopened' },
    { id: 'major_nc', label: 'Major NC', test: r => r.classification === 'major_nc' },
    { id: 'client_visible', label: 'Client-visible', test: r => r.visibility === 'client_selected' || r.visibility === 'client_all' },
  ];
  let _fnd = { auditId: null, findings: [], requirements: [], view: 'all' };

  function fndPill(text, color) { return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;background:${color}18;color:${color};font-weight:600">${esc(text)}</span>`; }
  function fndClassColor(c) { return c === 'major_nc' ? '#b91c1c' : c === 'minor_nc' ? '#b45309' : '#4a5568'; }
  function fndStatusColor(s) { return s === 'closed' ? '#0d6e4e' : s === 'withdrawn' ? '#8da2b2' : s === 'final' ? '#1d6fb8' : s === 'reopened' ? '#b91c1c' : '#b45309'; }
  // Release-1 B2.4 / B2.5: "Reopened" (with the last reason) and "Repeat" (seen on an earlier board).
  function fndBadgesHtml(row) {
    let out = '';
    if (row.reopened_count) {
      const parts = String(row.reopen_reason || '').split(': ');
      const why = row.reopen_reason ? (ACTION_REOPEN_REASON_LABEL[parts[0]] || parts[0]) + (parts.length > 1 ? ' — ' + parts.slice(1).join(': ') : '') : '';
      out += ` <span class="iso-fnd-badge is-reopened" title="${esc(why ? 'Last reopened: ' + why : 'Reopened')}">Reopened${row.reopened_count > 1 ? ' ×' + row.reopened_count : ''}</span>`;
    }
    if (row.repeat_of_ref) out += ` <span class="iso-fnd-badge is-repeat" title="${esc('Also found on an earlier board: ' + row.repeat_of_ref)}">Repeat</span>`;
    return out;
  }
  function fndCellHtml(row, fieldKey) {
    if (fieldKey === 'status') return { html: fndPill(FINDING_STATUS_LABEL[row.status] || row.status, fndStatusColor(row.status)) + fndBadgesHtml(row) };
    if (fieldKey === 'visibility') return { html: esc(FA_VISIBILITY_LABEL[row.visibility] || row.visibility) };
    if (fieldKey === 'released_at') return { html: row.released_at ? esc(fmtTs(row.released_at)) : '<span style="color:#c8d4e0">—</span>' };
    return { html: '' };
  }
  function fndEditorSpec(row, fieldKey) {
    // status is not a plain editable cell — it moves through findingTransitionOp verbs, each
    // gated by canProgressFinding and shown as buttons in the drawer, not a free-choice select
    // (mirrors this file's own action-status pattern below).
    if (fieldKey === 'visibility') return { type: 'select', label: 'Visibility', value: row.visibility, options: Object.keys(FA_VISIBILITY_LABEL).map(k => ({ value: k, label: FA_VISIBILITY_LABEL[k] })) };
    return null;
  }
  async function saveFindingField(auditId, id, fieldKey, value) {
    const row = _fnd.findings.find(r => r.id === id);
    if (!row) throw new Error('Finding no longer loaded — refresh and try again.');
    const updated = await mutateReasoned('finding.update', { auditId: auditId, id: id, patch: { [fieldKey]: value }, expectedVersion: row.row_version });
    Object.assign(row, updated);
    return updated;
  }
  function buildFindingSections() {
    // Same reasoning as the requirements register: a dashboard filter's rows must never be
    // narrowed again by a stale local quick-view — FINDING_QUICK_VIEWS[0] ('all') passes everything.
    const view = _fnd.dashFilter ? FINDING_QUICK_VIEWS[0] : (FINDING_QUICK_VIEWS.find(v => v.id === _fnd.view) || FINDING_QUICK_VIEWS[0]);
    const std = boardStd();
    const filtered = _fnd.findings.filter(view.test).filter(f => !std || f.standard_code === std);
    const order = ['major_nc', 'minor_nc', 'observation', 'ofi'];
    const groups = new Map();
    for (const r of filtered) { if (!groups.has(r.classification)) groups.set(r.classification, []); groups.get(r.classification).push(r); }
    for (const r of filtered) r.name = r.ref + ' — ' + r.title;
    return order.filter(k => groups.has(k)).map(k => ({
      id: k, label: FINDING_CLASSIFICATION_LABEL[k] || k, color: fndClassColor(k),
      rows: groups.get(k).sort((a, b) => (a.ref || '').localeCompare(b.ref || '')),
    }));
  }
  function buildFindingsCtx(auditId) {
    return {
      key: 'iso:' + auditId + ':findings',
      columns() { return [{ key: 'status', label: 'Status', width: '160px' }, { key: 'visibility', label: 'Visibility', width: '150px' }, { key: 'released_at', label: 'Released', width: '110px' }]; },
      sections() { return buildFindingSections(); },
      rowId(row) { return row.id; },
      rowAttrs(row) { return { 'data-ifnd': row.id }; },
      cell(row, fieldKey) { return fndCellHtml(row, fieldKey); },
      editor(row, fieldKey) { return fndEditorSpec(row, fieldKey); },
      save(rowId, fieldKey, value) { return saveFindingField(auditId, rowId, fieldKey, value); },
      open(rowId) { openFindingDrawer(auditId, rowId); },
      rerender() { renderFindingsTable(auditId); },
      emptyHtml() { return 'No findings match the current filter.'; },
      canDragRows() { return false; },
      fixedColumns: true, // set widths, no drag-resize; the name column takes the remaining space
    };
  }
  function fndToolbarHtml(auditId) {
    return `<div class="card iso-toolbar">
      <div class="iso-qv-track">${_fnd.dashFilter ? '' : FINDING_QUICK_VIEWS.map(v => `<button type="button" class="iso-qv${_fnd.view === v.id ? ' is-on' : ''}" aria-pressed="${_fnd.view === v.id}" onclick="ISO._fndSetView('${v.id}')">${esc(v.label)}</button>`).join('')}</div>
      <div class="iso-toolbar-actions">${canManageFindingLocally() ? `<button class="btn btn-teal btn-sm" onclick="ISO._openAddFinding()">+ New finding</button>` : ''}</div>
    </div>`;
  }
  // Mirrors api/_iso.js's canManageFinding/canProgressFinding exactly (audit_manager/auditor/
  // contributor may draft; audit_manager/auditor may progress the lifecycle) — the server is
  // still the real gate; this only decides whether to show the button at all.
  function _myAuditRole() {
    const u = _cu(); if (!u) return null;
    if (u.role === 'admin') return 'admin';
    const m = (_membersCache || []).find(x => x.user_uid === u.id);
    return m ? m.audit_role : null;
  }
  function canManageFindingLocally() { const r = _myAuditRole(); return r === 'admin' || ['lead_auditor', 'audit_manager', 'auditor', 'contributor'].includes(r); }
  function canProgressFindingLocally() { const r = _myAuditRole(); return r === 'admin' || ['lead_auditor', 'audit_manager', 'auditor'].includes(r); }

  function renderFindingsTable(auditId) {
    const host = document.getElementById('iso-fnd-tab');
    if (!host) return;
    const ctx = buildFindingsCtx(auditId);
    root._isoSetMtCtx(ctx);
    host.innerHTML = _dashFilterBannerHtml(_fnd, (_fnd.findings || []).length, '_fndClearDashFilter') + fndToolbarHtml(auditId) + root._mtRenderGeneric(ctx);
  }
  async function fillFindingsTab(audit) {
    const host = document.getElementById('iso-fnd-tab');
    if (!host) return;
    let dashFilter = _fnd.auditId === audit.id ? _fnd.dashFilter : null, dashLabel = _fnd.auditId === audit.id ? (_fnd.dashLabel || '') : '';
    if (_pendingDashNav && _pendingDashNav.tab === 'findings') { dashFilter = _pendingDashNav.filter; dashLabel = _pendingDashNav.label || ''; _pendingDashNav = null; }
    try {
      const [findings, requirements] = await Promise.all([
        dashFilter ? api('finding.list', { auditId: audit.id, filter: dashFilter }) : api('finding.list', { auditId: audit.id }),
        api('requirement.list', { auditId: audit.id }),
      ]);
      _fnd = { auditId: audit.id, findings: findings, requirements: requirements, view: _fnd.auditId === audit.id ? _fnd.view : 'all', dashFilter: dashFilter, dashLabel: dashFilter ? dashLabel : '' };
    } catch (e) {
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load findings: ${esc(e.message)}</div>`;
      return;
    }
    renderFindingsTable(audit.id);
  }
  function _fndSetView(v) { _fnd.view = v; renderFindingsTable(_fnd.auditId); }
  function _fndClearDashFilter() { _fnd.dashFilter = null; _fnd.dashLabel = ''; fillFindingsTab(_auditCache); }

  // ── Add finding (plan §6.2: always created from a requirement) ────────────────────────────────
  function _openAddFinding(preselectRequirementId) {
    const reqOptions = _fnd.requirements.map(r => `<option value="${esc(r.id)}"${r.id === preselectRequirementId ? ' selected' : ''}>${esc('ISO ' + r.standard_code + ' ' + r.clause + ' — ' + (r.requirement_text || '').slice(0, 70))}</option>`).join('');
    root.openGenericModal('New finding', `
      <div class="iso-field-grid">
        <label style="grid-column:1/-1">Source requirement<select class="form-input" id="af-req">${reqOptions}</select></label>
        <label>Classification<select class="form-input" id="af-class">${Object.keys(FINDING_CLASSIFICATION_LABEL).map(k => `<option value="${k}">${esc(FINDING_CLASSIFICATION_LABEL[k])}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Title<input class="form-input" id="af-title" placeholder="Short summary of the finding"/></label>
        <label style="grid-column:1/-1">Statement<textarea class="form-input" id="af-statement" placeholder="What was found"></textarea></label>
        <label style="grid-column:1/-1">Criteria<textarea class="form-input" id="af-criteria" placeholder="The requirement/clause it fails against"></textarea></label>
        <label style="grid-column:1/-1">Evidence<textarea class="form-input" id="af-evidence" placeholder="What evidence supports this"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._addFindingApply()">Create finding</button>
    `, '560px');
  }
  async function _addFindingApply() {
    const title = document.getElementById('af-title').value.trim();
    if (!title) { root.showToast ? root.showToast('A title is required.', true) : alert('A title is required.'); return; }
    const payload = {
      auditId: _fnd.auditId, requirementId: document.getElementById('af-req').value,
      classification: document.getElementById('af-class').value, title: title,
      statement: document.getElementById('af-statement').value.trim() || null,
      criteria: document.getElementById('af-criteria').value.trim() || null,
      evidenceBasis: document.getElementById('af-evidence').value.trim() || null,
    };
    try {
      const finding = await mutate('finding.create', payload);
      document.getElementById('generic-modal').classList.add('hidden');
      await fillFindingsTab({ id: _fnd.auditId });
      root.showToast ? root.showToast('Finding created.') : null;
      openFindingDrawer(_fnd.auditId, finding.id);
    } catch (e) { root.showToast ? root.showToast('Could not create finding: ' + e.message, true) : alert(e.message); }
  }

  // ── Finding drawer ──────────────────────────────────────────────────────────────────────────────
  let _openDrawerFndId = null;
  function fndTransitionButtons(row) {
    if (!canProgressFindingLocally()) return '';
    const btn = (label, op, to) => `<button class="btn btn-ghost btn-sm" onclick="ISO._fndTransition('${esc(row.id)}','${op}',${row.row_version})">${esc(label)}</button>`;
    if (row.status === 'draft') return btn('Release for review', 'finding.release', 'released_for_review') + ' ' + btn('Withdraw', 'finding.withdraw', 'withdrawn');
    if (row.status === 'released_for_review') return btn('Finalize', 'finding.finalize', 'final') + ' ' + btn('Withdraw', 'finding.withdraw', 'withdrawn');
    if (row.status === 'final' || row.status === 'reopened') return btn('Close', 'finding.close', 'closed');
    // B2.4: only the Lead (or an admin) reopens a closed finding, with a reason.
    if (row.status === 'closed' && ['lead_auditor', 'admin'].includes(_myAuditRole())) return `<button class="btn btn-ghost btn-sm" data-id="${esc(row.id)}" onclick="ISO._fndOpenReopen(this.dataset.id,${Number(row.row_version)})">Reopen</button>`;
    return '';
  }
  async function _fndTransition(id, op, expectedVersion) {
    try {
      const updated = await mutateReasoned(op, { auditId: _fnd.auditId, id: id, expectedVersion: expectedVersion });
      // Without this, _fnd.findings kept the pre-transition row (in particular its stale
      // row_version) — reopening the drawer showed the OLD status, and any save after this one
      // (visibility, another transition, …) sent that stale expectedVersion and got refused as a
      // version conflict against the row this very transition had just moved on. Same fix shape
      // as saveFindingField's own Object.assign after a plain finding.update.
      const row = _fnd.findings.find(r => r.id === id);
      if (row) Object.assign(row, updated);
      if (_openDrawerFndId) await openFindingDrawer(_fnd.auditId, _openDrawerFndId);
      // A drawer-only refresh leaves the Findings register showing the pre-transition status/
      // released_at until the tab is next visited — the same class of gap the Actions drawer's
      // own mutations had (see their own comment above _actUpdateStatus for the full story).
      renderFindingsTable(_fnd.auditId);
      root.showToast ? root.showToast('Updated.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not update: ' + e.message, true) : alert(e.message); }
  }
  function _fndOpenReopen(id, expectedVersion) {
    root.openGenericModal('Reopen finding', `
      <div class="iso-field-grid">
        <label>Reason<select class="form-input" id="rf-reason">${Object.keys(ACTION_REOPEN_REASON_LABEL).map(k => `<option value="${k}">${esc(ACTION_REOPEN_REASON_LABEL[k])}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Details (optional)<textarea class="form-input" id="rf-text"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" data-id="${esc(id)}" onclick="ISO._fndReopenApply(this.dataset.id,${Number(expectedVersion)})">Reopen</button>
    `, '460px');
  }
  async function _fndReopenApply(id, expectedVersion) {
    try {
      const updated = await mutate('finding.reopen', { auditId: _fnd.auditId, id: id, reasonCode: document.getElementById('rf-reason').value, reasonText: document.getElementById('rf-text').value.trim() || null, expectedVersion: expectedVersion });
      const row = _fnd.findings.find(r => r.id === id); if (row) Object.assign(row, updated);
      document.getElementById('generic-modal').classList.add('hidden');
      openFindingDrawer(_fnd.auditId, id);
      renderFindingsTable(_fnd.auditId);
      if (root.showToast) root.showToast('Finding reopened.');
    } catch (e) { if (root.showToast) root.showToast('Could not reopen: ' + e.message, true); }
  }
  async function openFindingDrawer(auditId, id) {
    const row = _fnd.findings.find(r => r.id === id);
    if (!row) return;
    _openDrawerFndId = id;
    root.openGenericModal(`${row.ref} — ${row.title}`, `<div id="iso-drawer-body">${skeletonFor('drawer')}</div>`, '780px');
    let comments = [], activity = [], evidence = [];
    try { [comments, activity, evidence] = await Promise.all([api('comment.list', { auditId: auditId }), api('activity.list', { auditId: auditId }), api('evidence.list', { auditId: auditId, targetType: 'finding', targetId: id })]); } catch (e) {}
    const body = document.getElementById('iso-drawer-body');
    if (!body) return;
    const myComments = comments.filter(c => c.entity_type === 'finding' && c.entity_id === id);
    const myActivity = activity.filter(a => a.entity_type === 'finding' && a.entity_id === id).slice(0, 30);
    const isManager = canManageFindingLocally();
    body.innerHTML = `
      <div class="card" style="padding:16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${fndPill(FINDING_CLASSIFICATION_LABEL[row.classification] || row.classification, fndClassColor(row.classification))}
        ${fndPill(FINDING_STATUS_LABEL[row.status] || row.status, fndStatusColor(row.status))}${fndBadgesHtml(row)}
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${fndTransitionButtons(row)}${_auditCache && _auditCache.stage === 'closed' && !_auditCache.successor && ['lead_auditor', 'audit_manager', 'admin'].includes(_myAuditRole()) && !['closed', 'withdrawn'].includes(row.status) ? `<button class="btn btn-ghost btn-sm" data-id="${esc(row.id)}" data-audit="${esc(auditId)}" onclick="ISO._openStartNext(this.dataset.audit,{type:'follow_up',findingIds:[this.dataset.id]})">Schedule follow-up</button>` : ''}</div>
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div class="iso-field-grid">
          <label>Classification<select class="form-input" id="fd-class" ${isManager ? '' : 'disabled'}>${Object.keys(FINDING_CLASSIFICATION_LABEL).map(k => `<option value="${k}"${row.classification === k ? ' selected' : ''}>${esc(FINDING_CLASSIFICATION_LABEL[k])}</option>`).join('')}</select></label>
          <label>Visibility<select class="form-input" id="fd-vis" ${isManager ? '' : 'disabled'}>${Object.keys(FA_VISIBILITY_LABEL).map(k => `<option value="${k}"${row.visibility === k ? ' selected' : ''}>${esc(FA_VISIBILITY_LABEL[k])}</option>`).join('')}</select></label>
          <label style="grid-column:1/-1">Title<input class="form-input" id="fd-title" value="${esc(row.title)}" ${isManager ? '' : 'disabled'}/></label>
          <label style="grid-column:1/-1">Statement<textarea class="form-input" id="fd-statement" ${isManager ? '' : 'disabled'}>${esc(row.statement || '')}</textarea></label>
          <label style="grid-column:1/-1">Criteria<textarea class="form-input" id="fd-criteria" ${isManager ? '' : 'disabled'}>${esc(row.criteria || '')}</textarea></label>
          <label style="grid-column:1/-1">Evidence<textarea class="form-input" id="fd-evidence" ${isManager ? '' : 'disabled'}>${esc(row.evidence_basis || '')}</textarea></label>
        </div>
        ${isManager ? `<button class="btn btn-teal btn-sm" style="margin-top:12px" onclick="ISO._fndDrawerSave('${esc(id)}',${row.row_version})">Save</button>` : ''}
      </div>
      ${_evdPanelHtml('finding', id, auditId, evidence, isManager)}
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Comments</div>
        ${myComments.map(c => `<div style="padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px"><strong>${esc(c.author_name || c.author_uid)}</strong> <span style="color:#8da2b2">${esc(fmtTs(c.created_at))}</span><div>${esc(c.body)}</div></div>`).join('') || '<div style="color:#8da2b2;font-size:12px">No comments yet.</div>'}
        <div style="display:flex;gap:8px;margin-top:10px"><input class="form-input" id="fd-comment" placeholder="Add a comment…"/><button class="btn btn-ghost btn-sm" onclick="ISO._fndAddComment('${esc(id)}')">Post</button></div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Activity</div>
        ${myActivity.length ? myActivity.map(a => `<div style="padding:4px 0;font-size:11px;color:#4a5568">${esc(fmtTs(a.at))} — ${esc(a.action)}</div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No activity recorded yet.</div>'}
      </div>`;
  }
  async function _fndDrawerSave(id, expectedVersion) {
    const patch = {
      classification: document.getElementById('fd-class').value,
      visibility: document.getElementById('fd-vis').value,
      title: document.getElementById('fd-title').value.trim(),
      statement: document.getElementById('fd-statement').value.trim() || null,
      criteria: document.getElementById('fd-criteria').value.trim() || null,
      evidence_basis: document.getElementById('fd-evidence').value.trim() || null,
    };
    try {
      await mutateReasoned('finding.update', { auditId: _fnd.auditId, id: id, patch: patch, expectedVersion: expectedVersion });
      document.getElementById('generic-modal').classList.add('hidden');
      await fillFindingsTab({ id: _fnd.auditId });
      root.showToast ? root.showToast('Saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }
  async function _fndAddComment(id) {
    const input = document.getElementById('fd-comment');
    const bodyText = input && input.value.trim();
    if (!bodyText) return;
    try {
      await mutate('comment.add', { auditId: _fnd.auditId, body: bodyText, entityType: 'finding', entityId: id });
      openFindingDrawer(_fnd.auditId, id);
    } catch (e) { root.showToast ? root.showToast('Could not post comment: ' + e.message, true) : alert(e.message); }
  }

  // ── Actions register (plan Phase 7.4) — same generic ctx pattern as Findings/Requirements.
  // CAPA: correction/containment/corrective_action/preventive_action/effectiveness fields are
  // plain textareas; the four guided root-cause editors are now real (see the "Guided root-cause
  // editors" block below this ctx: 5 Whys, fishbone and the cause-and-effect tree each get their
  // own interactive widget over the real five_whys/fishbone/cause_tree JSONB columns; cause
  // categories was always a plain flat tag list, not a hierarchy, so the checkbox set built with
  // this slice already was the real, final UI for it, never an interim). Status workflow incl. the
  // on_hold pause/resume, verify/reopen, submit-for-review/decide-review, extension request/decide,
  // and a plain subtask checklist in the drawer (subtask.*) are all real and complete. Subtasks now
  // ALSO render as real indented Main Table child rows (see buildActionsCtx's children()/the
  // "Subtasks as real Main Table child rows" block below) — the drawer checklist stays as a
  // convenience view, kept in sync with the register via renderActionsTable() on every mutation.
  // Still explicitly NOT built, named here and in RESUME HERE: the action Gantt (Workboards' Gantt
  // is a bespoke, hardcoded renderer with no ctx-generic abstraction, unlike the Main Table's). ───
  const ACTION_STATUS_LABEL = {
    draft: 'Draft', assigned: 'Assigned', in_progress: 'In progress', awaiting_evidence: 'Awaiting evidence',
    submitted_for_review: 'Submitted for review', more_info_required: 'More info required',
    ready_for_verification: 'Ready for verification', on_hold: 'On hold', verified: 'Verified', closed: 'Closed',
  };
  const ACTION_STATUS_ORDER = ['draft', 'assigned', 'in_progress', 'awaiting_evidence', 'submitted_for_review', 'more_info_required', 'ready_for_verification', 'on_hold', 'verified', 'closed'];
  // Mirrors api/_iso.js's own ACTION_TRANSITIONS table exactly, minus the on_hold pair (handled as
  // its own Pause/Resume affordance below, not a generic destination button) — see that file's own
  // comment for why on_hold can't be a plain destination in a table like this (A40/A48).
  const ACTION_TRANSITIONS_UI = {
    draft: ['assigned'], assigned: ['in_progress'], in_progress: ['awaiting_evidence', 'submitted_for_review'],
    awaiting_evidence: ['submitted_for_review'], submitted_for_review: ['more_info_required', 'ready_for_verification'],
    more_info_required: ['submitted_for_review'], ready_for_verification: ['verified'], verified: ['closed'], closed: [],
  };
  const ACTION_PRIORITY_LABEL = { low: 'Low', med: 'Medium', high: 'High', crit: 'Critical' };
  const ACTION_RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  const ROOT_CAUSE_METHOD_LABEL = { none: 'Not set', five_whys: '5 Whys', fishbone: 'Fishbone', cause_tree: 'Cause tree', other: 'Other' };
  // No server config exists for this list (unlike finding_classifications) — a plain, reasonable
  // default set, editable in the DB directly if a real audit needs different categories; not a
  // guided taxonomy, matching this slice's own plain-CAPA-fields scope note above.
  const CAUSE_CATEGORY_OPTIONS = ['process_failure', 'training_gap', 'equipment_failure', 'communication_breakdown', 'resource_constraint', 'procedure_inadequate', 'systemic_human_error', 'other'];
  const ACTION_REOPEN_REASON_LABEL = { evidence_invalid: 'Evidence invalid', ineffective: 'Fix proved ineffective', recurred: 'Issue recurred', connected_requirement_changed: 'Connected requirement changed', later_audit_found: 'Found by a later audit', closed_in_error: 'Closed in error', other: 'Other' };
  const REVIEW_DECISION_LABEL = { accepted: 'Accepted', rejected: 'Rejected', more_info: 'More info needed' };
  const ACTION_CLOSED_STATUSES_UI = ['verified', 'closed']; // mirrors api/_iso.js's own ACTION_CLOSED_STATUSES
  const ACTION_QUICK_VIEWS = [
    { id: 'all', label: 'All actions', test: () => true },
    { id: 'open', label: 'Open', test: r => !['verified', 'closed'].includes(r.status) },
    { id: 'overdue', label: 'Overdue', test: r => r.due_date && r.due_date < toIsoDateOnly(new Date()) && !['verified', 'closed'].includes(r.status) },
    { id: 'closed', label: 'Verified & closed', test: r => ['verified', 'closed'].includes(r.status) },
    // One fix covering clauses of two or more standards (action.list's is_shared, 9.7).
    { id: 'shared', label: 'Shared', test: r => !!r.is_shared },
  ];
  function toIsoDateOnly(d) { return d.toISOString().slice(0, 10); }
  let _act = { auditId: null, actions: [], findings: [], requirements: [], subtasks: [], view: 'open' };

  function actPill(text, color) { return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;background:${color}18;color:${color};font-weight:600">${esc(text)}</span>`; }
  function actStatusColor(s) { return s === 'verified' || s === 'closed' ? '#0d6e4e' : s === 'on_hold' ? '#8da2b2' : s === 'more_info_required' ? '#b91c1c' : '#b45309'; }
  function actPriorityColor(p) { return p === 'crit' ? '#b91c1c' : p === 'high' ? '#b45309' : p === 'med' ? '#1d6fb8' : '#4a5568'; }
  function actOwnerName(uid) { const u = (_DB().users || []).find(x => x.id === uid); return u ? u.name : ''; }
  // Phase 7b.2/7.5 (D12): hours are ordinary Task Hub time entries logged against the ISO board
  // (never a linked task — that design was replaced, see the plan's own 7.5 note), so "hours
  // logged" on an action is just a live sum, not a stored field of its own; read-only, staff
  // only (the client portal never reaches this drawer), never exposed through any ISO op.
  function _actHoursLogged(actionId) { const sum = (_DB().timeEntries || []).filter(e => !e.deletedAt && e.isoActionId === actionId).reduce((s, e) => s + (e.hours || 0), 0); return Number(sum.toFixed(2)); }
  function actCellHtml(row, fieldKey) {
    // The standards an action covers, as the same coloured Q/E/S chips used everywhere else.
    if (fieldKey === 'standard_codes') return { html: (row.standard_codes || []).slice().sort((x, y) => STANDARD_ORDER.indexOf(x) - STANDARD_ORDER.indexOf(y)).map(c => `<span class="iso-std-chip iso-dash-mini-chip" style="--std:${STANDARD_COLOR[c] || '#6b8399'}" title="${esc(stdLabel(c))}">${esc(STANDARD_BADGE[c] || '•')}</span>`).join(' ') || '<span class="iso-cell-default">—</span>' };
    if (fieldKey === 'status') return { html: actPill(ACTION_STATUS_LABEL[row.status] || row.status, actStatusColor(row.status)) };
    if (fieldKey === 'priority') return row.priority ? { html: actPill(ACTION_PRIORITY_LABEL[row.priority] || row.priority, actPriorityColor(row.priority)) } : { html: '<span style="color:#c8d4e0">—</span>' };
    if (fieldKey === 'due_date') {
      if (!row.due_date) return { html: '<span style="color:#c8d4e0">—</span>' };
      const overdue = row.due_date < toIsoDateOnly(new Date()) && !['verified', 'closed'].includes(row.status);
      return { html: `<span style="font-size:11px;color:${overdue ? '#b91c1c' : '#6b8399'}">${esc(fmtDate(row.due_date))}</span>` };
    }
    if (fieldKey === 'owner_uid') return row.owner_uid ? { html: esc(actOwnerName(row.owner_uid)) } : { html: '<span style="color:#c8d4e0">Unassigned</span>' };
    return { html: '' };
  }
  function actEditorSpec(row, fieldKey) {
    if (fieldKey === 'priority') return { type: 'select', label: 'Priority', value: row.priority || '', allowBlank: true, options: Object.keys(ACTION_PRIORITY_LABEL).map(k => ({ value: k, label: ACTION_PRIORITY_LABEL[k] })) };
    if (fieldKey === 'due_date') return { type: 'date', label: 'Due date', value: row.due_date || '' };
    if (fieldKey === 'owner_uid') return { type: 'select', label: 'Owner', value: row.owner_uid || '', allowBlank: true, options: (_DB().users || []).filter(u => u.role !== 'client').map(u => ({ value: u.id, label: u.name })) };
    return null; // status moves through workflow buttons in the drawer, not a free-choice cell
  }
  async function saveActionField(auditId, id, fieldKey, value) {
    const row = _act.actions.find(r => r.id === id);
    if (!row) throw new Error('Action no longer loaded — refresh and try again.');
    const updated = await mutateReasoned('action.update', { auditId: auditId, id: id, patch: { [fieldKey]: value }, expectedVersion: row.row_version });
    Object.assign(row, updated);
    return updated;
  }
  // ── Subtasks as real Main Table child rows (plan §5) — the register shares its column set with
  // both actions and their subtasks; a subtask row is told apart by carrying an action_id (an
  // action never does). Reuses the exact same status/priority/due/owner columns rather than a
  // second, subtask-only table shape, since the generic renderer has one <thead> for the whole
  // ctx regardless of depth. ──────────────────────────────────────────────────────────────────────
  function _isSubtaskRow(row) { return !!(row && row.action_id != null); }
  function subCellHtml(row, fieldKey) {
    if (fieldKey === 'status') return { html: `<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" ${row.done ? 'checked' : ''} onchange="event.stopPropagation();ISO._subtaskToggle('${esc(row.id)}',${row.row_version},this.checked)" style="cursor:pointer;accent-color:#97bcbd"/><span style="font-size:11px;color:${row.done ? '#0d6e4e' : '#6b8399'}">${row.done ? 'Done' : 'Open'}</span></label>` };
    if (fieldKey === 'priority') return { html: '<span style="color:#c8d4e0">—</span>' }; // subtasks have no priority of their own
    if (fieldKey === 'due_date') {
      if (!row.due_date) return { html: '<span style="color:#c8d4e0">—</span>' };
      const overdue = row.due_date < toIsoDateOnly(new Date()) && !row.done;
      return { html: `<span style="font-size:11px;color:${overdue ? '#b91c1c' : '#6b8399'}">${esc(fmtDate(row.due_date))}</span>` };
    }
    if (fieldKey === 'owner_uid') return row.owner_uid ? { html: esc(actOwnerName(row.owner_uid)) } : { html: '<span style="color:#c8d4e0">Unassigned</span>' };
    return { html: '' };
  }
  function subEditorSpec(row, fieldKey) {
    // status has its own checkbox (subCellHtml above) that stops propagation before this would
    // ever fire — never a free-choice editor, same reasoning as an action's own status column.
    if (fieldKey === 'due_date') return { type: 'date', label: 'Due date', value: row.due_date || '' };
    if (fieldKey === 'owner_uid') return { type: 'select', label: 'Owner', value: row.owner_uid || '', allowBlank: true, options: (_DB().users || []).filter(u => u.role !== 'client').map(u => ({ value: u.id, label: u.name })) };
    return null;
  }
  async function saveSubtaskField(auditId, id, fieldKey, value) {
    const row = _act.subtasks.find(r => r.id === id);
    if (!row) throw new Error('Subtask no longer loaded — refresh and try again.');
    const updated = await mutate('subtask.update', { auditId: auditId, id: id, patch: { [fieldKey]: value }, expectedVersion: row.row_version });
    Object.assign(row, updated);
    return updated;
  }
  function buildActionSections() {
    // Same reasoning as the requirements register and findings: ACTION_QUICK_VIEWS[0] ('all')
    // passes everything through rather than re-narrowing an already dashboard-filtered set.
    const view = _act.dashFilter ? ACTION_QUICK_VIEWS[0] : (ACTION_QUICK_VIEWS.find(v => v.id === _act.view) || ACTION_QUICK_VIEWS[0]);
    const std = boardStd();
    const filtered = _act.actions.filter(view.test).filter(a => !std || (a.standard_codes || []).includes(std));
    const groups = new Map();
    for (const r of filtered) { if (!groups.has(r.status)) groups.set(r.status, []); groups.get(r.status).push(r); }
    for (const r of filtered) r.name = r.ref + ' — ' + r.title;
    return ACTION_STATUS_ORDER.filter(s => groups.has(s)).map(s => ({
      id: s, label: ACTION_STATUS_LABEL[s] || s, color: actStatusColor(s),
      rows: groups.get(s).sort((a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99')),
    }));
  }
  function buildActionsCtx(auditId) {
    return {
      key: 'iso:' + auditId + ':actions',
      columns() { return [{ key: 'status', label: 'Status', width: '160px' }, { key: 'standard_codes', label: 'Standards', width: '100px' }, { key: 'priority', label: 'Priority', width: '110px' }, { key: 'due_date', label: 'Due', width: '110px' }, { key: 'owner_uid', label: 'Owner', width: '130px' }]; },
      sections() { return buildActionSections(); },
      // Subtasks render as real, indented Main Table child rows under their parent action — the
      // generic renderer (index.html's _mtRenderGeneric/_mtRowsHtml) already supported a depth
      // param from Phase 1 on with nothing to drive it; this is the first ctx to implement
      // children() at all. A subtask never has children of its own.
      children(row) { return _isSubtaskRow(row) ? null : _act.subtasks.filter(s => s.action_id === row.id).sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0)); },
      rowId(row) { return row.id; },
      rowAttrs(row) { return _isSubtaskRow(row) ? { 'data-isub': row.id } : { 'data-iact': row.id }; },
      cell(row, fieldKey) { return _isSubtaskRow(row) ? subCellHtml(row, fieldKey) : actCellHtml(row, fieldKey); },
      editor(row, fieldKey) { return _isSubtaskRow(row) ? subEditorSpec(row, fieldKey) : actEditorSpec(row, fieldKey); },
      save(rowId, fieldKey, value) {
        const subRow = _act.subtasks.find(s => s.id === rowId);
        return subRow ? saveSubtaskField(auditId, rowId, fieldKey, value) : saveActionField(auditId, rowId, fieldKey, value);
      },
      // Clicking a subtask's name has nowhere of its own to go (no subtask drawer exists) — opens
      // the parent action's drawer instead of doing nothing, so it is never a dead click.
      open(rowId) {
        const subRow = _act.subtasks.find(s => s.id === rowId);
        openActionDrawer(auditId, subRow ? subRow.action_id : rowId);
      },
      rerender() { renderActionsTable(auditId); },
      emptyHtml() { return 'No actions match the current filter.'; },
      canDragRows() { return false; },
      fixedColumns: true, // set widths, no drag-resize; the name column takes the remaining space
    };
  }
  function actToolbarHtml(auditId) {
    return `<div class="card iso-toolbar">
      <div class="iso-qv-track">${_act.dashFilter ? '' : ACTION_QUICK_VIEWS.map(v => `<button type="button" class="iso-qv${_act.view === v.id ? ' is-on' : ''}" aria-pressed="${_act.view === v.id}" onclick="ISO._actSetView('${v.id}')">${esc(v.label)}</button>`).join('')}</div>
      <div class="iso-toolbar-actions">${canManageFindingLocally() ? `<button class="btn btn-teal btn-sm" onclick="ISO._openAddAction()">+ New action</button>` : ''}</div>
    </div>`;
  }
  function canVerifyActionLocally() {
    const r = _myAuditRole(); if (r === 'admin') return true;
    const m = (_membersCache || []).find(x => x.user_uid === (_cu() || {}).id);
    return !!m && (['lead_auditor', 'audit_manager'].includes(m.audit_role) || (m.audit_role === 'auditor' && !!m.can_verify));
  }
  // action.* and finding.* share the exact same day-to-day management tier (audit_manager/
  // auditor/contributor) per api/_iso.js's own canManageAction/canManageFinding — one local check
  // instead of a byte-for-byte duplicate of canManageFindingLocally.
  function canManageActionLocally() { return canManageFindingLocally(); }

  function renderActionsTable(auditId) {
    const host = document.getElementById('iso-act-tab');
    if (!host) return;
    const ctx = buildActionsCtx(auditId);
    root._isoSetMtCtx(ctx);
    host.innerHTML = _dashFilterBannerHtml(_act, (_act.actions || []).length, '_actClearDashFilter') + actToolbarHtml(auditId) + root._mtRenderGeneric(ctx);
  }
  async function fillActionsTab(audit) {
    const host = document.getElementById('iso-act-tab');
    if (!host) return;
    let dashFilter = _act.auditId === audit.id ? _act.dashFilter : null, dashLabel = _act.auditId === audit.id ? (_act.dashLabel || '') : '';
    if (_pendingDashNav && _pendingDashNav.tab === 'actions') { dashFilter = _pendingDashNav.filter; dashLabel = _pendingDashNav.label || ''; _pendingDashNav = null; }
    try {
      const [actions, findings, requirements, subtasks] = await Promise.all([
        dashFilter ? api('action.list', { auditId: audit.id, filter: dashFilter }) : api('action.list', { auditId: audit.id }),
        api('finding.list', { auditId: audit.id }),
        api('requirement.list', { auditId: audit.id }),
        api('subtask.list', { auditId: audit.id }),
      ]);
      _act = { auditId: audit.id, actions: actions, findings: findings, requirements: requirements, subtasks: subtasks, view: _act.auditId === audit.id ? _act.view : 'open', dashFilter: dashFilter, dashLabel: dashFilter ? dashLabel : '' };
    } catch (e) {
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load actions: ${esc(e.message)}</div>`;
      return;
    }
    renderActionsTable(audit.id);
  }
  function _actSetView(v) { _act.view = v; renderActionsTable(_act.auditId); }
  function _actClearDashFilter() { _act.dashFilter = null; _act.dashLabel = ''; fillActionsTab(_auditCache); }

  // ── Action plan Gantt (plan §7.4: "actions by start→due grouped by standard / owner / finding;
  // overdue emphasised; drag updates dates through action.update with reason prompt when the
  // action is overdue") — the first real consumer of index.html's generic Gantt renderer
  // (_ganttRenderGeneric/_ganttCommitDrag), built in Phase 2 specifically for this and unused
  // until now (see that function's own comment). Shares `_act.actions/findings/requirements` with
  // the Actions register tab rather than fetching its own copy when that data is already fresh. ──
  const ACTIONPLAN_GROUPBY_LABEL = { standard: 'Standard', owner: 'Owner', finding: 'Finding' };
  let _actPlan = { groupBy: 'standard' };
  // An action always carries exactly one link at creation (action.create inserts one
  // iso_action_links row, finding XOR requirement — A50's sibling fact for actions) though
  // action.link can add more later; "the" source for grouping purposes is the first of each kind.
  function _actLinkedFindingId(action) {
    const link = (action.links || []).find(l => l.target_type === 'finding');
    return link ? link.target_id : null;
  }
  function _actLinkedRequirementId(action) {
    const fid = _actLinkedFindingId(action);
    if (fid) { const f = _act.findings.find(x => x.id === fid); return f ? f.requirement_id : null; }
    const link = (action.links || []).find(l => l.target_type === 'requirement');
    return link ? link.target_id : null;
  }
  function _actStandardCodeFor(action) {
    const reqId = _actLinkedRequirementId(action);
    if (!reqId) return null;
    const req = _act.requirements.find(r => r.id === reqId);
    return req ? req.standard_code : null;
  }
  function _actPlanGroupKey(action) {
    if (_actPlan.groupBy === 'owner') return action.owner_uid || '__none';
    if (_actPlan.groupBy === 'finding') return _actLinkedFindingId(action) || '__none';
    return _actStandardCodeFor(action) || '__none';
  }
  function _actPlanGroupLabel(key) {
    if (_actPlan.groupBy === 'owner') return key === '__none' ? 'Unassigned' : (actOwnerName(key) || 'Unassigned');
    if (_actPlan.groupBy === 'finding') {
      if (key === '__none') return 'Not linked to a finding';
      const f = _act.findings.find(x => x.id === key);
      return f ? (f.ref + ' — ' + f.title) : key;
    }
    return key === '__none' ? 'No standard' : ('ISO ' + key);
  }
  // STANDARD_COLOR is the Requirements register's own map (§6.1) — reused as-is rather than a
  // second copy, so a standard's colour matches everywhere it appears in the app.
  function _actPlanGroupColor(key) { return _actPlan.groupBy === 'standard' ? (STANDARD_COLOR[key] || '#8da2b2') : '#8da2b2'; }
  function _actPlanSetGroupBy(g) { _actPlan.groupBy = g; renderActionPlanTab(_act.auditId); }
  function buildActionPlanModel(auditId) {
    const todayStr = toIsoDateOnly(new Date());
    const dated = (_act.actions || []).filter(a => a.start_date || a.due_date);
    const groups = new Map();
    dated.forEach(a => { const k = _actPlanGroupKey(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    const sections = [...groups.entries()].map(([k, actions]) => ({
      id: k, label: _actPlanGroupLabel(k), color: _actPlanGroupColor(k),
      rows: actions.map(a => {
        const overdue = a.due_date && a.due_date < todayStr && !ACTION_CLOSED_STATUSES_UI.includes(a.status);
        return {
          key: a.id, id: a.id, name: a.ref + ' — ' + a.title, start: a.start_date, end: a.due_date,
          color: overdue ? '#b91c1c' : actStatusColor(a.status), depth: 0,
          canDrag: !ACTION_CLOSED_STATUSES_UI.includes(a.status),
        };
      }),
    })).filter(s => s.rows.length);
    return { key: 'iso:' + auditId + ':actionplan:' + _actPlan.groupBy, sections };
  }
  function buildActionPlanHandlers(auditId) {
    return {
      open(id) { openActionDrawer(auditId, id); },
      beforeCommit() { return true; },
      async commitMove(id, start, end) {
        const row = _act.actions.find(r => r.id === id);
        if (!row) throw new Error('Action no longer loaded — refresh and try again.');
        // A milestone bar (only one of start_date/due_date set) only ever shifts whichever date it
        // actually has — _ganttGenericOnUp (index.html) leaves the other one as JS `undefined`, not
        // a real date, so it must be left out of the patch entirely rather than sent as `undefined`
        // (which a plain object literal would still include as a key, just with no value — correct
        // over JSON, since JSON.stringify drops it, but wrong as a matter of writing what's true).
        const patch = {};
        if (start !== undefined) patch.start_date = start;
        if (end !== undefined) patch.due_date = end;
        // mutateReasoned, not a plain mutate: api/_iso.js's action.update already requires (and
        // prompts for, via the app's own showPrompt, never a native dialog — A49) a reason when a
        // drag changes the due date on an overdue, still-open action (§6.3a rule 4) — the exact
        // same helper saveActionField's register cell-edit already uses for this.
        const updated = await mutateReasoned('action.update', { auditId: auditId, id: id, patch: patch, expectedVersion: row.row_version });
        Object.assign(row, updated);
        return updated;
      },
      toggle() {},
      rerender() { renderActionPlanTab(auditId); },
      linkDeps: false,
    };
  }
  function renderActionPlanTab(auditId) {
    const host = document.getElementById('iso-ganttact-tab');
    if (!host) return;
    const model = buildActionPlanModel(auditId);
    const handlers = buildActionPlanHandlers(auditId);
    const groupBtns = Object.keys(ACTIONPLAN_GROUPBY_LABEL).map(g =>
      `<button class="btn btn-sm ${_actPlan.groupBy === g ? 'btn-teal' : 'btn-ghost'}" onclick="ISO._actPlanSetGroupBy('${g}')">${esc(ACTIONPLAN_GROUPBY_LABEL[g])}</button>`
    ).join('');
    const toolbar = `<div class="card" style="padding:8px 12px;margin-top:12px;display:flex;gap:6px;align-items:center">
      <span style="font-size:11px;color:#8da2b2;font-weight:600;margin-right:4px">Group by</span>${groupBtns}
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="ISO._openGanttExport('${esc(auditId)}')">Export PDF</button>
    </div>`;
    if (!model.sections.length) {
      host.innerHTML = toolbar + `<div class="card" style="margin-top:12px"><p style="color:#8da2b2;text-align:center;padding:40px">No actions with dates to display yet. Add a start or due date to an action to see it here.</p></div>`;
      return;
    }
    host.innerHTML = toolbar + `<div class="card" style="margin-top:12px;overflow:auto;padding:0">${root._ganttRenderGeneric(model, handlers)}</div>`;
  }
  async function fillActionPlanTab(audit) {
    const host = document.getElementById('iso-ganttact-tab');
    if (!host) return;
    try {
      const [actions, findings, requirements] = await Promise.all([
        api('action.list', { auditId: audit.id }),
        api('finding.list', { auditId: audit.id }),
        api('requirement.list', { auditId: audit.id }),
      ]);
      _act.actions = actions; _act.findings = findings; _act.requirements = requirements; _act.auditId = audit.id;
    } catch (e) {
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load the action plan: ${esc(e.message)}</div>`;
      return;
    }
    renderActionPlanTab(audit.id);
  }

  // Phase 7b.6 (D14): "Export PDF" — a small modal (Client version default on, per the plan's own
  // wording) then a single export.gantt call that does ALL the safety-critical work (which
  // actions appear, how they're grouped) server-side; this file's only job is to hand the
  // server's own response straight to _ganttPdf (index.html) in the exact model shape it expects.
  function _openGanttExport(auditId) {
    root.openGenericModal('Export Action Plan PDF', `
      <div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="gantt-pdf-version" value="client" checked/> Client version — only client-visible actions, owners as names, no internal text</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="gantt-pdf-version" value="internal"/> Internal version — every action on this board</label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:16px" onclick="ISO._ganttExportApply('${esc(auditId)}')">Download PDF</button>
    `, '480px');
  }
  async function _ganttExportApply(auditId) {
    const clientVersion = document.querySelector('input[name="gantt-pdf-version"]:checked')?.value !== 'internal';
    const btn = document.querySelector('#generic-modal-body button.btn-teal');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const data = await api('export.gantt', { auditId: auditId, clientVersion: clientVersion, groupBy: _actPlan.groupBy });
      document.getElementById('generic-modal')?.classList.add('hidden');
      root._ganttPdf({ sections: data.sections }, {
        clientName: data.clientName, ref: data.ref, title: data.title, dataAsAt: data.dataAsAt,
        clientVersion: data.clientVersion, filename: `${data.ref}_Action_Plan_${new Date().toISOString().slice(0, 10)}${data.clientVersion ? '_client' : ''}.pdf`,
      });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Download PDF'; }
      root.showToast ? root.showToast('Could not build the PDF: ' + e.message, true) : alert(e.message);
    }
  }

  // ── Add action (plan §5.4: created from a finding or a requirement) ────────────────────────────
  function _openAddAction(presetTargetType, presetTargetId) {
    const targetOptions = (type) => (type === 'finding' ? _act.findings : _act.requirements)
      .map(r => `<option value="${esc(r.id)}">${type === 'finding' ? esc(r.ref + ' — ' + r.title) : esc('ISO ' + r.standard_code + ' ' + r.clause + ' — ' + (r.requirement_text || '').slice(0, 60))}</option>`).join('');
    root.openGenericModal('New action', `
      <div class="iso-field-grid">
        <label>Source type<select class="form-input" id="aa-type" onchange="ISO._actRefreshTargetOptions()">
          <option value="finding"${presetTargetType === 'finding' ? ' selected' : ''}>Finding</option>
          <option value="requirement"${presetTargetType === 'requirement' ? ' selected' : ''}>Requirement</option>
        </select></label>
        <label>Source<select class="form-input" id="aa-target">${targetOptions(presetTargetType || 'finding')}</select></label>
        <label style="grid-column:1/-1">Title<input class="form-input" id="aa-title" placeholder="What needs to happen"/></label>
        <label style="grid-column:1/-1">Description<textarea class="form-input" id="aa-desc"></textarea></label>
        <label>Owner<select class="form-input" id="aa-owner"><option value="">— Unassigned —</option>${(_DB().users || []).filter(u => u.role !== 'client').map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
        <label>Priority<select class="form-input" id="aa-priority"><option value="">—</option>${Object.keys(ACTION_PRIORITY_LABEL).map(k => `<option value="${k}">${esc(ACTION_PRIORITY_LABEL[k])}</option>`).join('')}</select></label>
        <label>Due date<input type="date" class="form-input" id="aa-due"/></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._addActionApply()">Create action</button>
    `, '560px');
    if (presetTargetId) setTimeout(() => { const el = document.getElementById('aa-target'); if (el) el.value = presetTargetId; }, 30);
  }
  function _actRefreshTargetOptions() {
    const type = document.getElementById('aa-type').value;
    const target = document.getElementById('aa-target');
    target.innerHTML = (type === 'finding' ? _act.findings : _act.requirements)
      .map(r => `<option value="${esc(r.id)}">${type === 'finding' ? esc(r.ref + ' — ' + r.title) : esc('ISO ' + r.standard_code + ' ' + r.clause + ' — ' + (r.requirement_text || '').slice(0, 60))}</option>`).join('');
  }
  async function _addActionApply() {
    const title = document.getElementById('aa-title').value.trim();
    if (!title) { root.showToast ? root.showToast('A title is required.', true) : alert('A title is required.'); return; }
    const payload = {
      auditId: _act.auditId, targetType: document.getElementById('aa-type').value, targetId: document.getElementById('aa-target').value,
      title: title, description: document.getElementById('aa-desc').value.trim() || null,
      ownerUid: document.getElementById('aa-owner').value || null, priority: document.getElementById('aa-priority').value || null,
      dueDate: document.getElementById('aa-due').value || null,
    };
    try {
      const action = await mutate('action.create', payload);
      document.getElementById('generic-modal').classList.add('hidden');
      await fillActionsTab({ id: _act.auditId });
      root.showToast ? root.showToast('Action created.') : null;
      openActionDrawer(_act.auditId, action.id);
    } catch (e) { root.showToast ? root.showToast('Could not create action: ' + e.message, true) : alert(e.message); }
  }

  // ── Action drawer ───────────────────────────────────────────────────────────────────────────────
  let _openDrawerActId = null;
  // Guided root-cause editors (plan §14/Phase 7.4's own remaining item) — an in-memory draft of
  // the three JSONB shapes (five_whys/fishbone/cause_tree), edited locally via add/remove buttons
  // that only re-render this one card (not the whole drawer) and persisted together with the rest
  // of the CAPA card on "Save CAPA". Reset whenever a different action's drawer opens.
  let _capaDraft = { actionId: null, five_whys: [], fishbone: {}, cause_tree: [] };
  const FISHBONE_CATEGORIES = ['method', 'machine', 'material', 'manpower', 'measurement', 'environment'];
  const FISHBONE_CATEGORY_LABEL = { method: 'Method', machine: 'Machine', material: 'Material', manpower: 'Manpower', measurement: 'Measurement', environment: 'Environment' };
  function actTransitionButtons(row) {
    const canManage = canManageActionLocally(), canVerify = canVerifyActionLocally();
    const btn = (label, onclick) => `<button class="btn btn-ghost btn-sm" onclick="${onclick}">${esc(label)}</button>`;
    const out = [];
    if (row.status === 'on_hold') {
      if (canManage) out.push(btn('Resume (' + (ACTION_STATUS_LABEL[row.on_hold_from_status] || 'previous status') + ')', `ISO._actUpdateStatus('${esc(row.id)}','${esc(row.on_hold_from_status)}',${row.row_version})`));
      return out.join(' ');
    }
    if (row.status === 'closed') return '';
    if (row.status === 'verified') {
      if (canVerify) out.push(btn('Close', `ISO._actUpdateStatus('${esc(row.id)}','closed',${row.row_version})`));
      if (canVerify) out.push(btn('Reopen', `ISO._openReopenAction('${esc(row.id)}',${row.row_version})`));
      return out.join(' ');
    }
    if (canManage) (ACTION_TRANSITIONS_UI[row.status] || []).filter(to => to !== 'verified').forEach(to => {
      // Plan §5's real submit-for-review op (action.submitForReview) also creates a numbered
      // iso_action_reviews row — routed here instead of the generic updateStatus every other
      // destination uses, so the Reviews panel below actually has a resubmission cycle to show.
      if (to === 'submitted_for_review') out.push(btn('Submit for review', `ISO._openSubmitForReview('${esc(row.id)}',${row.row_version})`));
      else out.push(btn('Move to ' + (ACTION_STATUS_LABEL[to] || to), `ISO._actUpdateStatus('${esc(row.id)}','${to}',${row.row_version})`));
    });
    if (row.status === 'ready_for_verification' && canVerify) {
      out.push(btn('Verify: Effective', `ISO._actVerify('${esc(row.id)}','effective',${row.row_version})`));
      out.push(btn('Verify: Ineffective', `ISO._actVerify('${esc(row.id)}','ineffective',${row.row_version})`));
      if (row.verification_status !== 'not_verified') out.push(btn('Mark Verified', `ISO._actUpdateStatus('${esc(row.id)}','verified',${row.row_version})`));
    }
    if (canManage) out.push(btn('Pause', `ISO._actUpdateStatus('${esc(row.id)}','on_hold',${row.row_version})`));
    return out.join(' ');
  }
  // Every mutation below that changes row_version updates _act.actions in place before
  // re-rendering — A49's own lesson from the Findings slice (a stale cached row_version silently
  // breaks the NEXT save on the same record with a version conflict, not just a stale display).
  // renderActionsTable no-ops harmlessly if the Actions tab isn't the one on screen right now
  // (its own host-element guard) — calling it unconditionally after every mutation below is what
  // keeps the register from showing stale data the next time it IS looked at, without needing a
  // full refetch. Found missing here the same way A49 found the row_version cache gap: a register
  // cell (due_date) still showed the pre-mutation value after a drawer-only update.
  async function _actUpdateStatus(id, to, expectedVersion) {
    try {
      const updated = await mutateReasoned('action.updateStatus', { auditId: _act.auditId, id: id, to: to, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, updated);
      if (_openDrawerActId) await openActionDrawer(_act.auditId, _openDrawerActId);
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Updated.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not update: ' + e.message, true) : alert(e.message); }
  }
  async function _actVerify(id, result, expectedVersion) {
    try {
      const updated = await mutate('action.verify', { auditId: _act.auditId, id: id, result: result, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, updated);
      if (_openDrawerActId) await openActionDrawer(_act.auditId, _openDrawerActId);
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Recorded.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not verify: ' + e.message, true) : alert(e.message); }
  }
  function _openReopenAction(id, expectedVersion) {
    root.openGenericModal('Reopen action', `
      <div class="iso-field-grid">
        <label>Reason<select class="form-input" id="ra-reason">${Object.keys(ACTION_REOPEN_REASON_LABEL).map(k => `<option value="${k}">${esc(ACTION_REOPEN_REASON_LABEL[k])}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Details (optional)<textarea class="form-input" id="ra-text"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._reopenActionApply('${esc(id)}',${expectedVersion})">Reopen</button>
    `, '460px');
  }
  async function _reopenActionApply(id, expectedVersion) {
    try {
      const updated = await mutate('action.reopen', { auditId: _act.auditId, id: id, reasonCode: document.getElementById('ra-reason').value, reasonText: document.getElementById('ra-text').value.trim() || null, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, updated);
      document.getElementById('generic-modal').classList.add('hidden');
      openActionDrawer(_act.auditId, id);
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Action reopened.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not reopen: ' + e.message, true) : alert(e.message); }
  }
  // ── Submit for review / decide review (plan §5, iso_action_reviews) ────────────────────────────
  function _openSubmitForReview(id, expectedVersion) {
    root.openGenericModal('Submit for review', `
      <label style="display:block;font-size:12px;font-weight:700;color:#6b8399;margin-bottom:6px">Submission note (optional)</label>
      <textarea class="form-input" id="sr-note" placeholder="What's ready for review…"></textarea>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._submitForReviewApply('${esc(id)}',${expectedVersion})">Submit</button>
    `, '460px');
  }
  async function _submitForReviewApply(id, expectedVersion) {
    try {
      const result = await mutate('action.submitForReview', { auditId: _act.auditId, id: id, submissionNote: document.getElementById('sr-note').value.trim() || null, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, result.action);
      document.getElementById('generic-modal').classList.add('hidden');
      openActionDrawer(_act.auditId, id);
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Submitted for review.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not submit: ' + e.message, true) : alert(e.message); }
  }
  function reviewRowHtml(r, isVerifier) {
    const decColor = r.decision === 'accepted' ? '#0d6e4e' : r.decision === 'rejected' ? '#b91c1c' : r.decision === 'more_info' ? '#b45309' : '#8da2b2';
    return `<div style="padding:8px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-weight:600">Submission #${r.submission_no}</span>
        ${actPill(r.decision ? REVIEW_DECISION_LABEL[r.decision] || r.decision : 'Pending', decColor)}
      </div>
      ${r.submission_note ? `<div style="color:#4a5568;margin-top:4px">${esc(r.submission_note)}</div>` : ''}
      ${r.decision_note ? `<div style="color:#4a5568;margin-top:4px"><em>Decision note:</em> ${esc(r.decision_note)}</div>` : ''}
      ${!r.decision && isVerifier ? `<div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" onclick="ISO._reviewDecide('${esc(r.id)}','accepted')">Accept</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO._reviewDecide('${esc(r.id)}','more_info')">Needs more info</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO._reviewDecide('${esc(r.id)}','rejected')">Reject</button>
      </div>` : ''}
    </div>`;
  }
  async function _reviewDecide(id, decision) {
    try {
      await mutate('action.decideReview', { auditId: _act.auditId, id: id, decision: decision });
      if (_openDrawerActId) {
        const updated = await api('action.list', { auditId: _act.auditId }); // decideReview can move the action's own status (A45) — refetch rather than guess the new row_version
        const fresh = updated.find(a => a.id === _openDrawerActId);
        if (fresh) { const row = _act.actions.find(r => r.id === _openDrawerActId); if (row) Object.assign(row, fresh); }
        await openActionDrawer(_act.auditId, _openDrawerActId);
      }
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Review decided.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not decide: ' + e.message, true) : alert(e.message); }
  }

  // ── Extension request / decide (plan §5, iso_action_extensions) ────────────────────────────────
  function _openRequestExtension(id, currentDue) {
    root.openGenericModal('Request an extension', `
      <div class="iso-field-grid">
        <label>Current due date<input class="form-input" value="${esc(currentDue || '')}" disabled/></label>
        <label>New requested due date<input type="date" class="form-input" id="ex-due" value="${esc(currentDue || '')}"/></label>
        <label style="grid-column:1/-1">Reason<textarea class="form-input" id="ex-reason" placeholder="Why more time is needed"></textarea></label>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:14px" onclick="ISO._requestExtensionApply('${esc(id)}')">Request</button>
    `, '460px');
  }
  async function _requestExtensionApply(id) {
    const requestedDue = document.getElementById('ex-due').value;
    const reason = document.getElementById('ex-reason').value.trim();
    if (!requestedDue || !reason) { root.showToast ? root.showToast('A new due date and a reason are both required.', true) : alert('A new due date and a reason are both required.'); return; }
    try {
      await mutate('extension.request', { auditId: _act.auditId, actionId: id, requestedDue: requestedDue, reason: reason });
      document.getElementById('generic-modal').classList.add('hidden');
      openActionDrawer(_act.auditId, id);
      root.showToast ? root.showToast('Extension requested.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not request extension: ' + e.message, true) : alert(e.message); }
  }
  function extensionRowHtml(x, isVerifier) {
    const decColor = x.decision === 'approved' ? '#0d6e4e' : x.decision === 'rejected' ? '#b91c1c' : '#8da2b2';
    return `<div style="padding:8px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1">${esc(x.current_due)} → ${esc(x.requested_due)}</span>
        ${actPill(x.decision === 'pending' ? 'Pending' : x.decision === 'approved' ? 'Approved' : 'Rejected', decColor)}
      </div>
      <div style="color:#4a5568;margin-top:4px">${esc(x.reason)}</div>
      ${x.decision_note ? `<div style="color:#4a5568;margin-top:4px"><em>Decision note:</em> ${esc(x.decision_note)}</div>` : ''}
      ${x.decision === 'pending' && isVerifier ? `<div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" onclick="ISO._extensionDecide('${esc(x.id)}','${esc(x.action_id)}','approved')">Approve</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO._extensionDecide('${esc(x.id)}','${esc(x.action_id)}','rejected')">Reject</button>
      </div>` : ''}
    </div>`;
  }
  async function _extensionDecide(id, actionId, decision) {
    try {
      await mutate('extension.decide', { auditId: _act.auditId, id: id, decision: decision });
      if (decision === 'approved') {
        // extension.decide('approved') moves the action's own due_date server-side (A46) — refetch
        // rather than guess the new row_version, same reasoning as _reviewDecide above.
        const updated = await api('action.list', { auditId: _act.auditId });
        const fresh = updated.find(a => a.id === actionId);
        if (fresh) { const row = _act.actions.find(r => r.id === actionId); if (row) Object.assign(row, fresh); }
        renderActionsTable(_act.auditId);
      }
      if (_openDrawerActId) await openActionDrawer(_act.auditId, _openDrawerActId);
      root.showToast ? root.showToast('Extension decided.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not decide: ' + e.message, true) : alert(e.message); }
  }

  function actCauseCategoryCheckboxes(row, isManager) {
    const cur = new Set(row.cause_categories || []);
    return CAUSE_CATEGORY_OPTIONS.map(c => `<label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" class="ad-cause-cat" value="${c}" ${cur.has(c) ? 'checked' : ''} ${isManager ? '' : 'disabled'}/> ${esc(c.replace(/_/g, ' '))}</label>`).join('');
  }

  // ── Guided root-cause editors (5 Whys / fishbone / cause-and-effect tree) — plan §14, real UI
  // over the already-working five_whys/fishbone/cause_tree JSONB columns (api/_iso.js's own
  // action.update validation already enforces their shapes: five_whys <=5 pairs, cause_tree no
  // cycle). Only the editor matching the currently-selected root_cause_method renders, so a user
  // is never filling in three unrelated structures at once. Edits mutate the local _capaDraft and
  // re-render just this one card (_renderGuidedRC) — no server round-trip until "Save CAPA", which
  // reads _capaDraft directly rather than re-scraping generated DOM. ─────────────────────────────
  function _rcNodeId() { return 'ctn_' + Math.random().toString(36).slice(2, 10); }
  function _renderGuidedRC() {
    const method = document.getElementById('ad-rcmethod') ? document.getElementById('ad-rcmethod').value : 'none';
    const host = document.getElementById('ad-guided-rc');
    if (!host) return;
    const isManager = canManageActionLocally();
    if (method === 'five_whys') {
      host.innerHTML = `<div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">5 Whys</div>` +
        _capaDraft.five_whys.map((w, i) => `<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
          <span style="font-size:11px;color:#8da2b2;flex-shrink:0;width:14px">${i + 1}.</span>
          <input class="form-input" placeholder="Why did this happen?" value="${esc(w.why || '')}" oninput="ISO._rcFiveWhysEdit(${i},'why',this.value)" style="flex:1;font-size:12px" ${isManager ? '' : 'disabled'}/>
          <input class="form-input" placeholder="Because…" value="${esc(w.answer || '')}" oninput="ISO._rcFiveWhysEdit(${i},'answer',this.value)" style="flex:1;font-size:12px" ${isManager ? '' : 'disabled'}/>
          ${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._rcFiveWhysRemove(${i})">✕</button>` : ''}
        </div>`).join('') +
        (isManager && _capaDraft.five_whys.length < 5 ? `<button class="btn btn-ghost btn-sm" onclick="ISO._rcFiveWhysAdd()">+ Add why</button>` : '');
    } else if (method === 'fishbone') {
      host.innerHTML = `<div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Fishbone</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">` +
        FISHBONE_CATEGORIES.map(cat => `<div>
          <div style="font-size:11px;font-weight:700;color:#4a5568;margin-bottom:4px">${esc(FISHBONE_CATEGORY_LABEL[cat])}</div>
          ${(_capaDraft.fishbone[cat] || []).map((c, i) => `<div style="display:flex;gap:4px;margin-bottom:4px">
            <input class="form-input" value="${esc(c)}" oninput="ISO._rcFishboneEdit('${cat}',${i},this.value)" style="flex:1;font-size:12px" ${isManager ? '' : 'disabled'}/>
            ${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._rcFishboneRemove('${cat}',${i})">✕</button>` : ''}
          </div>`).join('')}
          ${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._rcFishboneAdd('${cat}')">+ Add cause</button>` : ''}
        </div>`).join('') + `</div>`;
    } else if (method === 'cause_tree') {
      host.innerHTML = `<div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Cause-and-effect tree</div>` +
        _renderCauseTreeNodes(null, 0, isManager) +
        (isManager ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="ISO._rcTreeAddRoot()">+ Add root cause</button>` : '');
    } else {
      host.innerHTML = '';
    }
  }
  function _renderCauseTreeNodes(parentId, depth, isManager) {
    return _capaDraft.cause_tree.filter(n => (n.parentId || null) === parentId).map(n => `
      <div style="margin-left:${depth * 20}px;display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input class="form-input" value="${esc(n.text || '')}" data-node="${esc(n.id)}" oninput="ISO._rcTreeEdit(this.dataset.node,this.value)" style="flex:1;font-size:12px" ${isManager ? '' : 'disabled'}/>
        ${isManager ? `<button class="btn btn-ghost btn-sm" data-node="${esc(n.id)}" onclick="ISO._rcTreeAddChild(this.dataset.node)">+ Child</button><button class="btn btn-ghost btn-sm" data-node="${esc(n.id)}" onclick="ISO._rcTreeRemove(this.dataset.node)">✕</button>` : ''}
      </div>
      ${_renderCauseTreeNodes(n.id, depth + 1, isManager)}
    `).join('');
  }
  function _rcFiveWhysAdd() { if (_capaDraft.five_whys.length < 5) { _capaDraft.five_whys.push({ why: '', answer: '' }); _renderGuidedRC(); } }
  function _rcFiveWhysRemove(i) { _capaDraft.five_whys.splice(i, 1); _renderGuidedRC(); }
  function _rcFiveWhysEdit(i, field, value) { _capaDraft.five_whys[i][field] = value; } // no re-render needed — the input already shows what was typed
  function _rcFishboneAdd(cat) { if (!_capaDraft.fishbone[cat]) _capaDraft.fishbone[cat] = []; _capaDraft.fishbone[cat].push(''); _renderGuidedRC(); }
  function _rcFishboneRemove(cat, i) { _capaDraft.fishbone[cat].splice(i, 1); _renderGuidedRC(); }
  function _rcFishboneEdit(cat, i, value) { _capaDraft.fishbone[cat][i] = value; }
  function _rcTreeAddRoot() { _capaDraft.cause_tree.push({ id: _rcNodeId(), parentId: null, text: '' }); _renderGuidedRC(); }
  function _rcTreeAddChild(parentId) { _capaDraft.cause_tree.push({ id: _rcNodeId(), parentId: parentId, text: '' }); _renderGuidedRC(); }
  function _rcTreeRemove(id) {
    // Removing a node must also remove its whole subtree — otherwise an orphaned child (parentId
    // pointing at a now-deleted node) would violate the server's own causeTreeHasCycle assumption
    // that every non-root parentId resolves to a real node, and would simply vanish from view with
    // no way to reach or delete it again (its parent no longer renders it, but the node still exists).
    const toRemove = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const n of _capaDraft.cause_tree) if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) { toRemove.add(n.id); grew = true; } }
    _capaDraft.cause_tree = _capaDraft.cause_tree.filter(n => !toRemove.has(n.id));
    _renderGuidedRC();
  }
  function _rcTreeEdit(id, value) { const n = _capaDraft.cause_tree.find(x => x.id === id); if (n) n.text = value; }
  // ── Coverage: what one action fixes, across standards (the old app's shared-action panel) ─────
  // Every clause the action covers — linked directly, or through a linked finding's source clause —
  // grouped by standard. Built from _act.requirements/_act.findings (the Actions tab's own load).
  function actCoveredClauses(row) {
    const reqById = new Map((_act.requirements || []).map(r => [r.id, r]));
    const fndById = new Map((_act.findings || []).map(f => [f.id, f]));
    const out = [], seen = new Set();
    for (const l of row.links || []) {
      const f = l.target_type === 'finding' ? fndById.get(l.target_id) : null;
      const r = l.target_type === 'requirement' ? reqById.get(l.target_id) : (f ? reqById.get(f.requirement_id) : null);
      if (!r || seen.has(r.id + '|' + l.id)) continue;
      seen.add(r.id + '|' + l.id);
      out.push({ req: r, via: f, linkId: l.id || null });
    }
    return out;
  }
  function actCoverHtml(row, isManager) {
    const clauses = actCoveredClauses(row);
    const stds = [...new Set(clauses.map(c => c.req.standard_code))];
    const pct = Math.max(0, Math.min(100, Number(row.progress) || 0));
    const overdue = !!(row.due_date && row.due_date < toIsoDateOnly(new Date()) && !['verified', 'closed'].includes(row.status));
    const clauseRow = c => `<div class="iso-act-clause">
      <span class="iso-act-clause-c">${esc(c.req.clause)}</span>
      <span class="iso-act-clause-n" title="${esc(c.req.requirement_text || '')}">${esc(c.req.clause_name || String(c.req.requirement_text || '').slice(0, 80))}</span>
      ${c.via ? `<button type="button" class="iso-act-clause-via" data-id="${esc(c.via.id)}" title="Open this finding" onclick="ISO._actOpenFinding(this.dataset.id)">via ${esc(c.via.ref || 'finding')}</button>${fndBadgesHtml(c.via)}` : ''}
      ${isManager && c.linkId ? `<button type="button" class="iso-act-clause-x" data-link="${esc(c.linkId)}" data-act="${esc(row.id)}" title="${c.via ? 'Unlink finding ' + esc(c.via.ref || '') : 'Remove this clause'}" onclick="ISO._actUnlink(this)">Remove</button>` : ''}
    </div>`;
    return `<div class="card iso-act-cover">
      <div class="iso-act-cover-tiles">
        <div class="iso-act-tile"><span class="iso-act-tile-l">Progress</span><span class="iso-act-tile-v">${pct}%</span><span class="iso-act-bar" aria-hidden="true"><span style="transform:scaleX(${pct / 100})"></span></span></div>
        <div class="iso-act-tile"><span class="iso-act-tile-l">Clauses covered</span><span class="iso-act-tile-v">${clauses.length}</span><span class="iso-act-tile-s">${stds.length > 1 ? `Shared across ${stds.length} standards` : stds.length ? '1 standard' : 'Not linked yet'}</span></div>
        <div class="iso-act-tile${overdue ? ' is-late' : ''}"><span class="iso-act-tile-l">Due</span><span class="iso-act-tile-v">${row.due_date ? esc(fmtDate(row.due_date)) : '—'}</span><span class="iso-act-tile-s">${overdue ? 'Overdue' : row.due_date ? 'On track' : 'No due date'}</span></div>
      </div>
      <div class="iso-act-cover-h"><span>Linked clauses</span>${isManager ? `<button type="button" class="iso-tb-btn" data-act="${esc(row.id)}" onclick="ISO._actLinkClause(this.dataset.act)">+ Link a clause</button>` : ''}</div>
      ${clauses.length ? groupByStandardHtml(clauses, c => c.req.standard_code, clauseRow, 'Other') : '<div class="iso-attn-empty">No clause linked yet — link the clauses this one fix covers, in any standard.</div>'}
    </div>`;
  }
  // Re-read the actions (links and standards change) and reopen the drawer in place.
  async function _actReloadAndReopen(actionId) {
    const actions = await api('action.list', _act.dashFilter ? { auditId: _act.auditId, filter: _act.dashFilter } : { auditId: _act.auditId });
    _act.actions = actions;
    if (document.getElementById('iso-act-tab')) renderActionsTable(_act.auditId);
    if (_act.actions.some(a => a.id === actionId)) await openActionDrawer(_act.auditId, actionId);
  }
  function _actLinkClause(actionId) {
    const row = _act.actions.find(a => a.id === actionId);
    if (!row) return;
    const linked = new Set(actCoveredClauses(row).filter(c => !c.via).map(c => c.req.id));
    const groups = new Map();
    for (const r of (_act.requirements || [])) { if (linked.has(r.id) || r.applicability === 'not_applicable') continue; if (!groups.has(r.standard_code)) groups.set(r.standard_code, []); groups.get(r.standard_code).push(r); }
    const opts = [...groups.keys()].sort((a, b) => STANDARD_ORDER.indexOf(a) - STANDARD_ORDER.indexOf(b)).map(code => `<optgroup label="${esc(stdLabel(code))}">${groups.get(code).map(r => `<option value="${esc(r.id)}">${esc(r.clause + ' ' + (r.clause_name || '') + ' — ' + String(r.requirement_text || '').slice(0, 60))}</option>`).join('')}</optgroup>`).join('');
    root.openGenericModal('Link a clause', `
      <div style="font-size:12px;color:#6b8399;margin-bottom:10px">${esc(row.ref)} — ${esc(row.title)}. Link every clause this one fix covers, in any standard on the board.</div>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:#6b8399">Clause<select class="form-input" id="act-link-target"><option value="">Choose…</option>${opts}</select></label>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-teal btn-sm" data-act="${esc(actionId)}" onclick="ISO._actLinkApply(this.dataset.act)">Link clause</button></div>`, '560px');
  }
  async function _actLinkApply(actionId) {
    const targetId = document.getElementById('act-link-target') && document.getElementById('act-link-target').value;
    if (!targetId) { root.showToast ? root.showToast('Choose a clause first.', true) : null; return; }
    try {
      await mutate('action.link', { auditId: _act.auditId, actionId: actionId, targetType: 'requirement', targetId: targetId });
      await _actReloadAndReopen(actionId); // reopening the drawer by its title steps back over this dialog
      root.showToast ? root.showToast('Clause linked.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not link the clause: ' + e.message, true) : alert(e.message); }
  }
  async function _actUnlink(btn) {
    try {
      await mutate('action.unlink', { auditId: _act.auditId, linkId: btn.dataset.link });
      await _actReloadAndReopen(btn.dataset.act);
      root.showToast ? root.showToast('Link removed.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not remove the link: ' + e.message, true) : alert(e.message); }
  }

  async function openActionDrawer(auditId, id) {
    const row = _act.actions.find(r => r.id === id);
    if (!row) return;
    _openDrawerActId = id;
    // A fresh draft only when a DIFFERENT action's drawer opens — reopening the SAME action's
    // drawer (every refresh after a status move, review decide, etc.) must keep whatever the user
    // was mid-editing in the guided root-cause card, not discard it on every re-render.
    if (_capaDraft.actionId !== id) {
      _capaDraft = { actionId: id, five_whys: JSON.parse(JSON.stringify(row.five_whys || [])), fishbone: JSON.parse(JSON.stringify(row.fishbone || {})), cause_tree: JSON.parse(JSON.stringify(row.cause_tree || [])) };
    }
    root.openGenericModal(`${row.ref} — ${row.title}`, `<div id="iso-drawer-body">${skeletonFor('drawer')}</div>`, '860px');
    let comments = [], activity = [], reviews = [], extensions = [], evidence = [];
    try {
      // review.list/extension.list are scoped per-action (neither table has an audit-wide list op
      // the way subtasks does), so these are fetched fresh per drawer-open, same as comments/activity.
      [comments, activity, reviews, extensions, evidence] = await Promise.all([
        api('comment.list', { auditId: auditId }), api('activity.list', { auditId: auditId }),
        api('review.list', { auditId: auditId, actionId: id }), api('extension.list', { auditId: auditId, actionId: id }),
        api('evidence.list', { auditId: auditId, targetType: 'action', targetId: id }),
      ]);
    } catch (e) {}
    const body = document.getElementById('iso-drawer-body');
    if (!body) return;
    const myComments = comments.filter(c => c.entity_type === 'action' && c.entity_id === id);
    const myActivity = activity.filter(a => a.entity_type === 'action' && a.entity_id === id).slice(0, 30);
    const mySubtasks = _act.subtasks.filter(s => s.action_id === id).sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0));
    const isManager = canManageActionLocally(), isVerifier = canVerifyActionLocally();
    reviews.sort((a, b) => b.submission_no - a.submission_no);
    extensions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    body.innerHTML = `
      <div class="card" style="padding:16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${actPill(ACTION_STATUS_LABEL[row.status] || row.status, actStatusColor(row.status))}
        ${row.priority ? actPill(ACTION_PRIORITY_LABEL[row.priority], actPriorityColor(row.priority)) : ''}
        ${row.verification_status !== 'not_verified' ? actPill('Verify: ' + row.verification_status, row.verification_status === 'effective' ? '#0d6e4e' : '#b91c1c') : ''}
        ${row.carried_from_ref ? `<span class="iso-carried-tag" title="Open last year — carried over to this maintenance audit"><span aria-hidden="true">↻</span> Carried over from ${esc(row.carried_from_ref)}</span>` : ''}
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${actTransitionButtons(row)}</div>
      </div>
      ${actCoverHtml(row, isManager)}
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Details</div>
        <div class="iso-field-grid">
          <label style="grid-column:1/-1">Title<input class="form-input" id="ad-title" value="${esc(row.title)}" ${isManager ? '' : 'disabled'}/></label>
          <label style="grid-column:1/-1">Description<textarea class="form-input" id="ad-desc" ${isManager ? '' : 'disabled'}>${esc(row.description || '')}</textarea></label>
          <label>Owner<select class="form-input" id="ad-owner" ${isManager ? '' : 'disabled'}><option value="">Unassigned</option>${(_DB().users || []).filter(u => u.role !== 'client').map(u => `<option value="${u.id}"${row.owner_uid === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          <label>Priority<select class="form-input" id="ad-priority" ${isManager ? '' : 'disabled'}><option value="">—</option>${Object.keys(ACTION_PRIORITY_LABEL).map(k => `<option value="${k}"${row.priority === k ? ' selected' : ''}>${esc(ACTION_PRIORITY_LABEL[k])}</option>`).join('')}</select></label>
          <label>Risk<select class="form-input" id="ad-risk" ${isManager ? '' : 'disabled'}><option value="">—</option>${Object.keys(ACTION_RISK_LABEL).map(k => `<option value="${k}"${row.risk_rating === k ? ' selected' : ''}>${esc(ACTION_RISK_LABEL[k])}</option>`).join('')}</select></label>
          <label>Start date<input type="date" class="form-input" id="ad-start" value="${esc(row.start_date || '')}" ${isManager ? '' : 'disabled'}/></label>
          <label>Due date<input type="date" class="form-input" id="ad-due" value="${esc(row.due_date || '')}" ${isManager ? '' : 'disabled'}/></label>
          <label>Visibility<select class="form-input" id="ad-vis" ${isManager ? '' : 'disabled'}>${Object.keys(FA_VISIBILITY_LABEL).map(k => `<option value="${k}"${row.visibility === k ? ' selected' : ''}>${esc(FA_VISIBILITY_LABEL[k])}</option>`).join('')}</select></label>
        </div>
        ${isManager ? `<button class="btn btn-teal btn-sm" style="margin-top:12px" onclick="ISO._adSaveDetails('${esc(id)}',${row.row_version})">Save details</button>` : ''}
        ${_cu() && _cu().role !== 'client' ? `<div style="margin-top:12px;font-size:12px;color:#6b8399">Hours logged: <strong style="color:#0d1c33">${_actHoursLogged(id)}h</strong></div>` : ''}
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Corrective &amp; preventive action</div>
        <div class="iso-field-grid">
          <label style="grid-column:1/-1">Correction (immediate fix)<textarea class="form-input" id="ad-correction" ${isManager ? '' : 'disabled'}>${esc(row.correction || '')}</textarea></label>
          <label style="grid-column:1/-1">Containment<textarea class="form-input" id="ad-containment" ${isManager ? '' : 'disabled'}>${esc(row.containment || '')}</textarea></label>
          <label>Root cause method<select class="form-input" id="ad-rcmethod" onchange="ISO._renderGuidedRC()" ${isManager ? '' : 'disabled'}>${Object.keys(ROOT_CAUSE_METHOD_LABEL).map(k => `<option value="${k}"${row.root_cause_method === k ? ' selected' : ''}>${esc(ROOT_CAUSE_METHOD_LABEL[k])}</option>`).join('')}</select></label>
          <div></div>
          <div style="grid-column:1/-1" id="ad-guided-rc"></div>
          <label style="grid-column:1/-1">Root cause summary<textarea class="form-input" id="ad-rcsummary" ${isManager ? '' : 'disabled'}>${esc(row.root_cause_summary || '')}</textarea></label>
          <div style="grid-column:1/-1"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Cause categories</div><div style="display:flex;flex-wrap:wrap;gap:10px">${actCauseCategoryCheckboxes(row, isManager)}</div></div>
          <label style="grid-column:1/-1">Corrective action (fixes this instance)<textarea class="form-input" id="ad-corractn" ${isManager ? '' : 'disabled'}>${esc(row.corrective_action || '')}</textarea></label>
          <label style="grid-column:1/-1">Preventive action (stops recurrence)<textarea class="form-input" id="ad-prevactn" ${isManager ? '' : 'disabled'}>${esc(row.preventive_action || '')}</textarea></label>
          <label style="grid-column:1/-1">Effectiveness check<textarea class="form-input" id="ad-effcheck" ${isManager ? '' : 'disabled'}>${esc(row.effectiveness_check || '')}</textarea></label>
          <label>Effectiveness review date<input type="date" class="form-input" id="ad-effdate" value="${esc(row.effectiveness_review_date || '')}" ${isManager ? '' : 'disabled'}/></label>
        </div>
        ${isManager ? `<button class="btn btn-teal btn-sm" style="margin-top:12px" onclick="ISO._adSaveCapa('${esc(id)}',${row.row_version})">Save CAPA</button>` : ''}
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Subtasks (${mySubtasks.length})</div>
        ${mySubtasks.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">
          <input type="checkbox" ${s.done ? 'checked' : ''} ${isManager ? '' : 'disabled'} onchange="ISO._subtaskToggle('${esc(s.id)}',${s.row_version},this.checked)"/>
          <span style="flex:1;${s.done ? 'text-decoration:line-through;color:#8da2b2' : ''}">${esc(s.title)}</span>
        </div>`).join('') || '<div style="color:#8da2b2;font-size:12px">No subtasks yet.</div>'}
        ${isManager ? `<div style="display:flex;gap:8px;margin-top:10px"><input class="form-input" id="ad-subtask" placeholder="Add a subtask…"/><button class="btn btn-ghost btn-sm" onclick="ISO._subtaskAdd('${esc(id)}')">Add</button></div>` : ''}
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Review history (${reviews.length})</div>
        ${reviews.length ? reviews.map(r => reviewRowHtml(r, isVerifier)).join('') : '<div style="color:#8da2b2;font-size:12px">Not submitted for review yet.</div>'}
      </div>
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:12px;flex:1">Due-date extensions (${extensions.length})</div>${isManager && row.due_date && !ACTION_CLOSED_STATUSES_UI.includes(row.status) ? `<button class="btn btn-ghost btn-sm" data-due="${esc(row.due_date)}" onclick="ISO._openRequestExtension('${esc(id)}',this.dataset.due)">Request extension</button>` : ''}</div>
        ${extensions.length ? extensions.map(x => extensionRowHtml(x, isVerifier)).join('') : '<div style="color:#8da2b2;font-size:12px">No extension requests.</div>'}
      </div>
      ${_evdPanelHtml('action', id, auditId, evidence, isManager)}
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Comments</div>
        ${myComments.map(c => `<div style="padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px"><strong>${esc(c.author_name || c.author_uid)}</strong> <span style="color:#8da2b2">${esc(fmtTs(c.created_at))}</span><div>${esc(c.body)}</div></div>`).join('') || '<div style="color:#8da2b2;font-size:12px">No comments yet.</div>'}
        <div style="display:flex;gap:8px;margin-top:10px"><input class="form-input" id="ad-comment" placeholder="Add a comment…"/><button class="btn btn-ghost btn-sm" onclick="ISO._actAddComment('${esc(id)}')">Post</button></div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-weight:700;font-size:12px;margin-bottom:10px">Activity</div>
        ${myActivity.length ? myActivity.map(a => `<div style="padding:4px 0;font-size:11px;color:#4a5568">${esc(fmtTs(a.at))} — ${esc(a.action)}</div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No activity recorded yet.</div>'}
      </div>`;
    _renderGuidedRC(); // the #ad-guided-rc container only just landed in the DOM above
  }
  async function _adSaveDetails(id, expectedVersion) {
    const patch = {
      title: document.getElementById('ad-title').value.trim(),
      description: document.getElementById('ad-desc').value.trim() || null,
      owner_uid: document.getElementById('ad-owner').value || null,
      priority: document.getElementById('ad-priority').value || null,
      risk_rating: document.getElementById('ad-risk').value || null,
      start_date: document.getElementById('ad-start').value || null,
      due_date: document.getElementById('ad-due').value || null,
      visibility: document.getElementById('ad-vis').value,
    };
    try {
      const updated = await mutateReasoned('action.update', { auditId: _act.auditId, id: id, patch: patch, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, updated);
      document.getElementById('generic-modal').classList.add('hidden');
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('Saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }
  async function _adSaveCapa(id, expectedVersion) {
    // The guided editors' current state lives in _capaDraft (edited locally, no round-trip per
    // keystroke) — read from there, not by re-scraping generated DOM, and only for whichever
    // method is actually selected (saving all three regardless of the active method would silently
    // persist stale data from a method the user isn't using right now).
    const method = document.getElementById('ad-rcmethod').value;
    const patch = {
      correction: document.getElementById('ad-correction').value.trim() || null,
      containment: document.getElementById('ad-containment').value.trim() || null,
      root_cause_method: method,
      root_cause_summary: document.getElementById('ad-rcsummary').value.trim() || null,
      cause_categories: [...document.querySelectorAll('.ad-cause-cat:checked')].map(el => el.value),
      corrective_action: document.getElementById('ad-corractn').value.trim() || null,
      preventive_action: document.getElementById('ad-prevactn').value.trim() || null,
      effectiveness_check: document.getElementById('ad-effcheck').value.trim() || null,
      effectiveness_review_date: document.getElementById('ad-effdate').value || null,
    };
    if (method === 'five_whys') patch.five_whys = _capaDraft.five_whys.filter(w => (w.why || '').trim() || (w.answer || '').trim());
    else if (method === 'fishbone') {
      const fb = {};
      for (const cat of FISHBONE_CATEGORIES) { const causes = (_capaDraft.fishbone[cat] || []).map(c => c.trim()).filter(Boolean); if (causes.length) fb[cat] = causes; }
      patch.fishbone = fb;
    } else if (method === 'cause_tree') {
      // Never filter out a blank-text node here the way five_whys/fishbone entries are — a node
      // with empty text but real children would orphan those children's parentId, silently
      // truncating that whole branch from the tree. Save every node as-is; an empty label is the
      // user's own business to fill in or delete via the ✕ button (which removes its subtree too).
      patch.cause_tree = _capaDraft.cause_tree;
    }
    try {
      const updated = await mutateReasoned('action.update', { auditId: _act.auditId, id: id, patch: patch, expectedVersion: expectedVersion });
      const row = _act.actions.find(r => r.id === id); if (row) Object.assign(row, updated);
      // Resync the draft from the server's own authoritative response, not just what was sent —
      // without this, _capaDraft kept showing whatever was typed even if the save had silently
      // failed or been partially rejected, since the draft is never otherwise touched by a save.
      // Found by this slice's own adversarial check (hard rule 7): forcing the sent five_whys to
      // empty still left the *drawer* showing the typed values afterward, because they'd never
      // left the untouched draft — a real gap, the same class of "client cache vs. server truth"
      // bug as A49's row_version fix and the register-refresh fix, just one layer further in.
      _capaDraft = { actionId: id, five_whys: JSON.parse(JSON.stringify(updated.five_whys || [])), fishbone: JSON.parse(JSON.stringify(updated.fishbone || {})), cause_tree: JSON.parse(JSON.stringify(updated.cause_tree || [])) };
      document.getElementById('generic-modal').classList.add('hidden');
      // Was missing — every other action-mutating save in this file calls this (_adSaveDetails
      // right above, _subtaskAdd/_subtaskToggle, every status transition — A49's own register-
      // refresh rule). No CAPA field is a register column today, so this had no visible symptom
      // yet, but found live: the hidden-not-removed drawer behind this modal still carried the
      // PRE-save row_version in its (now stale, invisible) transition buttons, and a reopened
      // drawer wasn't the only path back to them in that moment — real offline demo, STOP 2
      // review, 2026-10-01.
      renderActionsTable(_act.auditId);
      root.showToast ? root.showToast('CAPA saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }
  // ── Evidence panel (Phase 8.1/8.2a, D18) — a minimal links-first panel shared by the
  // requirement, finding and action drawers. File upload (8.2) and the full per-link review
  // history/preview (8.3, the real Evidence tab) are a later phase, not this one — this panel only
  // ever shows selectable text + Copy link (hard rule 13: never a clickable anchor the app itself
  // renders for an external URL) and the "+ Add evidence" link-only form.
  // D20: one reviewer verdict per link; `submitted` is shown as "Not reviewed".
  const EVD_REVIEW_LABEL = { submitted: 'Not reviewed', under_review: 'Under review', more_info_required: 'More info needed', accepted: 'Accepted — sufficient', partially_sufficient: 'Partially sufficient', insufficient: 'Insufficient', rejected: 'Rejected — not relevant', superseded: 'Superseded' };
  const EVD_REVIEW_COLOR = { submitted: '#475569', under_review: '#92400e', more_info_required: '#92400e', accepted: '#0d6e4e', partially_sufficient: '#92400e', insufficient: '#b91c1c', rejected: '#b91c1c', superseded: '#6b8399' };
  function _evdPanelHtml(targetType, targetId, auditId, items, isManager) {
    return `<div class="card" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:12px;flex:1">Evidence (${items.length})</div>${isManager ? `<button class="btn btn-ghost btn-sm" onclick="ISO._openAddEvidence('${esc(targetType)}','${esc(targetId)}','${esc(auditId)}')">+ Add evidence</button>` : ''}</div>
      ${items.length ? items.map(e => `<div style="padding:8px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600">${esc(e.title)}</span>
          ${e.confidentiality === 'restricted' ? `<span style="font-size:10px;font-weight:700;color:#b91c1c;border:1px solid #fecaca;border-radius:4px;padding:1px 6px">RESTRICTED</span>` : ''}
          <span class="iso-evd-verdict-tag" style="font-size:10px;font-weight:700;color:${EVD_REVIEW_COLOR[e.reviewStatus] || '#6b8399'};border:1px solid currentColor;border-radius:4px;padding:1px 6px"><span aria-hidden="true">${EVD_VERDICT_ICON[e.reviewStatus] || ''}</span> ${esc(EVD_REVIEW_LABEL[e.reviewStatus] || e.reviewStatus)}</span>
          <span class="iso-evd-role-tag" style="font-size:10px;color:#6b8399">${e.role === 'supporting' ? 'Supporting' : 'Primary'}${!e.url ? ' · ' + esc(EVD_KIND_LABEL[e.kind] || e.kind) : ''}${e.versionLabel ? ' · rev ' + esc(e.versionLabel) : ''}</span>
        </div>
        ${e.relevanceNote ? `<div class="iso-evd-relevance" style="color:#4a5568;margin-top:4px">Why it's relevant: ${esc(e.relevanceNote)}</div>` : ''}
        ${e.url ? `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4a5568;user-select:all">${esc(e.url)}</span>
          <button class="btn btn-ghost btn-sm" style="font-size:11px" data-url="${esc(e.url)}" onclick="ISO._evdCopyLink(this.dataset.url)">Copy link</button>
        </div>` : ''}
        ${_evdFileLineHtml(e, auditId)}
        ${e.description ? `<div style="color:#6b8399;margin-top:4px">${esc(e.description)}</div>` : ''}
        ${e.reviewComment && e.reviewStatus !== 'submitted' ? `<div class="iso-evd-review-note" style="color:#4a5568;margin-top:4px">Reviewer: ${esc(e.reviewComment)}${e.reviewedVersionLabel ? ' (rev ' + esc(e.reviewedVersionLabel) + ')' : ''}</div>` : ''}
        ${_evdReviewControlsHtml(e, targetType, targetId, auditId)}
      </div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No evidence attached yet.</div>'}
    </div>`;
  }
  function _evdCopyLink(url) {
    navigator.clipboard?.writeText(url).then(() => root.showToast ? root.showToast('Link copied to clipboard', 'success', 2500) : null)
      .catch(() => root.showToast ? root.showToast('Could not copy — please select and copy the text manually.', true) : null);
  }
  // Plan 8b.4 (R11, D19): "+ Add evidence" is a searchable multi-select over this board's evidence,
  // grouped (examples, used on related requirements, recently used, this board) plus an "Other"
  // form for something new. One record can serve many requirements across standards — reuse links
  // it (evidence.link), it is never copied. The new-evidence form renders straight away; the lists
  // fill in once evidence.search answers. Selecting evidence never changes the assessment.
  const EVD_KIND_LABEL = { link: 'Web link', sharepoint: 'SharePoint link', note: 'Note', meeting_note: 'Meeting note', interview: 'Interview', sample: 'Sample', policy_ref: 'Policy reference', procedure_ref: 'Procedure reference', file: 'File', photo: 'Photo' };
  const EVD_NO_URL_KINDS = ['note', 'meeting_note', 'interview', 'sample', 'policy_ref', 'procedure_ref'];
  let _evdSel = null; // { targetType, targetId, auditId }
  function _evdPickRowHtml(e) {
    const label = `${e.ref} — ${e.title}`;
    const meta = [EVD_KIND_LABEL[e.kind] || e.kind, e.versionLabel ? 'rev ' + e.versionLabel : '', e.linkCount ? `used ${e.linkCount}×` : ''].filter(Boolean).join(' · ');
    // 8b.6: a superseded record stays visible (it may be what someone searches for) but can't be linked.
    const locked = e.linkedToTarget || !!e.supersededBy;
    return `<div class="iso-evd-pick" data-search="${esc((label + ' ' + (e.url || '') + ' ' + (e.versionLabel || '')).toLowerCase())}" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
      <input type="checkbox" class="iso-evd-check" value="${esc(e.id)}" id="iso-evd-chk-${esc(e.id)}" ${locked ? 'disabled' : ''} aria-label="${esc('Select ' + label)}"/>
      <label for="iso-evd-chk-${esc(e.id)}" style="flex:1;cursor:pointer">${esc(label)}<span style="color:#8da2b2"> · ${esc(meta)}</span>${e.linkedToTarget ? ' <span style="color:#0d6e4e">(already linked)</span>' : e.supersededBy ? ' <span style="color:#6b8399">(superseded — link the current revision)</span>' : ''}</label>
      ${locked ? '' : `<select class="form-input iso-evd-role" data-evd="${esc(e.id)}" style="width:auto;height:28px;font-size:11px" aria-label="${esc('Role of ' + label)}"><option value="primary">Primary</option><option value="supporting">Supporting</option></select>`}
    </div>`;
  }
  function _evdGroupHtml(title, rows, extraClass) {
    if (!rows.length) return '';
    return `<div class="iso-evd-group ${extraClass || ''}" style="margin-bottom:10px"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">${esc(title)} (${rows.length})</div>${rows.map(_evdPickRowHtml).join('')}</div>`;
  }
  function _evdFilter(q) {
    q = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#iso-evd-lists .iso-evd-pick').forEach(el => { el.style.display = !q || el.dataset.search.includes(q) ? '' : 'none'; });
  }
  function _evdUseExample(text) {
    const t = document.getElementById('evd-title');
    if (t) { t.value = text; t.focus(); }
  }
  // ── Plan 8.2: "Upload a file instead" — links stay the default (D18); a file is the exception ──
  // The server re-checks every one of these; the early checks here only save a round trip.
  const EVD_UPLOAD_EXT_MIME = {
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    msg: 'application/vnd.ms-outlook', eml: 'message/rfc822', zip: 'application/zip',
  };
  const EVD_UPLOAD_ACCEPT = Object.keys(EVD_UPLOAD_EXT_MIME).map(x => '.' + x).join(',');
  const EVD_DOC_STATUS_LABEL = { draft: 'Draft', approved: 'Approved', superseded: 'Superseded', obsolete: 'Obsolete' };
  function _fmtBytes(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  // Owner / approver pickers (8c.5): staff, as the new-board wizard lists them.
  function _evdStaffOptions(selected) {
    return (_DB().users || []).filter(u => u.role !== 'client' && u.active !== false)
      .map(u => `<option value="${esc(u.id)}"${selected && (selected === u.id || selected === 'offline:' + u.id) ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
  }
  function _evdToggleUpload() {
    if (!_evdSel) return;
    _evdSel.upload = !_evdSel.upload;
    const on = _evdSel.upload;
    const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
    show('evd-file-row', on); show('evd-doc-row', on); show('evd-kind-row', !on); show('evd-url-row', !on);
    const h = document.getElementById('evd-new-heading');
    if (h) h.textContent = on ? 'Other evidence (new) — upload a file' : 'Other evidence (new) — paste a SharePoint or web link, or describe it';
    const b = document.getElementById('evd-upload-toggle');
    if (b) b.textContent = on ? 'Paste a link instead' : 'Upload a file instead';
    if (on) { const f = document.getElementById('evd-file'); if (f) f.focus(); }
  }
  function _evdFileChosen() {
    const input = document.getElementById('evd-file');
    const file = input && input.files && input.files[0];
    const t = document.getElementById('evd-title');
    if (file && t && !t.value.trim()) t.value = file.name.replace(/\.[A-Za-z0-9]{1,10}$/, '');
  }
  function _fileToBase64(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('the file could not be read')); r.readAsDataURL(file); });
  }
  // Reserve → send the bytes (the one signed URL online; offlinePut on the dev server) → register.
  async function _evdUploadFile(file, targetType, targetId, auditId, fields) {
    const ext = ((file.name.match(/\.([A-Za-z0-9]{1,10})$/) || [])[1] || '').toLowerCase();
    if (!EVD_UPLOAD_EXT_MIME[ext]) throw new Error('that file type isn\'t accepted — paste a SharePoint link instead');
    const mime = String(file.type || '').toLowerCase() || EVD_UPLOAD_EXT_MIME[ext];
    const res = await api('evidence.uploadUrl', Object.assign({ auditId: auditId, targetType: targetType, targetId: targetId, filename: file.name, size: file.size, mime: mime }, fields));
    if (res.offline) await api('evidence.offlinePut', { auditId: auditId, evidenceId: res.evidenceId, dataBase64: await _fileToBase64(file) });
    else {
      const put = await fetch(res.signedUrl, { method: 'PUT', headers: { 'Content-Type': res.mime }, body: file });
      if (!put.ok) throw new Error('the file could not be sent (' + put.status + ')');
    }
    return mutate('evidence.register', { auditId: auditId, evidenceId: res.evidenceId });
  }
  // The bytes, through evidence.downloadUrl only (it reads the record's own storage path).
  async function _evdFetchFile(auditId, evidenceId) {
    const d = await api('evidence.downloadUrl', { auditId: auditId, evidenceId: evidenceId });
    let blob;
    if (d.url) {
      const r = await fetch(d.url);
      if (!r.ok) throw new Error('the file could not be fetched (' + r.status + ')');
      blob = await r.blob();
    } else {
      const bin = atob(d.dataBase64 || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: d.mime || 'application/octet-stream' });
    }
    return { blob: blob, filename: d.filename || 'evidence', mime: d.mime || blob.type || 'application/octet-stream' };
  }
  // Saved through a Blob and <a download> — the page never navigates and no tab opens (hard rule 13).
  async function _evdDownload(auditId, evidenceId) {
    try {
      const f = await _evdFetchFile(auditId, evidenceId);
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement('a');
      a.href = url; a.download = f.filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { if (root.showToast) root.showToast('Could not download: ' + e.message, true); }
  }
  // In-page preview through Workboards' own viewers (index.html _previewFileData), with SVG never
  // rendered inline (plan §5.4).
  async function _evdPreview(auditId, evidenceId) {
    try {
      const f = await _evdFetchFile(auditId, evidenceId);
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('the file could not be read')); r.readAsDataURL(f.blob); });
      if (typeof root._previewFileData !== 'function') throw new Error('the viewer is not available');
      root._previewFileData(dataUrl, f.filename, f.mime, { allowSvg: false });
    } catch (e) { if (root.showToast) root.showToast('Could not preview: ' + e.message, true); }
  }
  function _evdFileLineHtml(e, auditId) {
    if (!e.hasFile) return '';
    return `<div class="iso-evd-file" style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
      <span style="color:#4a5568">File: ${esc(e.originalFilename || 'evidence')} · ${esc(_fmtBytes(e.sizeBytes))} · <span class="iso-evd-docstatus">${esc(EVD_DOC_STATUS_LABEL[e.documentStatus] || 'Draft')}</span></span>
      <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" data-audit="${esc(auditId)}" data-evd="${esc(e.id)}" onclick="ISO._evdPreview(this.dataset.audit,this.dataset.evd)">Preview</button>
      <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" data-audit="${esc(auditId)}" data-evd="${esc(e.id)}" onclick="ISO._evdDownload(this.dataset.audit,this.dataset.evd)">Download</button>
    </div>`;
  }
  function _evdKindChanged() {
    const kind = document.getElementById('evd-kind').value;
    const hint = document.getElementById('evd-url-hint');
    if (hint) hint.textContent = EVD_NO_URL_KINDS.includes(kind) ? 'Optional for this type.' : 'Required for a link — a sharepoint.com address is recognised automatically.';
  }
  // opts (8c.5): {upload: true, title} opens straight on "Upload a file" — the Suggested documents
  // card's "Upload document", with the document type as the title.
  function _openAddEvidence(targetType, targetId, auditId, opts) {
    _evdSel = { targetType: targetType, targetId: targetId, auditId: auditId };
    const g = targetType === 'requirement' ? (_reqGuidance.auditId === auditId ? _reqGuidance.map[targetId] : null) : null;
    const examples = g && g.evidenceExamples ? g.evidenceExamples.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12) : [];
    root.openGenericModal('Add evidence', `
      <div style="display:flex;flex-direction:column;gap:10px">
        <input class="form-input" id="evd-search" placeholder="Search this board's evidence…" oninput="ISO._evdFilter(this.value)" aria-label="Search this board's evidence"/>
        ${examples.length ? `<div class="iso-evd-examples"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">Suggested examples — guidance only; picking one fills in a new record's title</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${examples.map(x => `<button type="button" class="btn btn-ghost btn-sm iso-evd-example" style="font-size:11px" onclick="ISO._evdUseExample(this.dataset.text)" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>` : ''}
        <div id="iso-evd-lists" style="max-height:260px;overflow:auto">${skeletonRows(2)}</div>
        <div class="card" style="padding:12px 14px;background:#f8fafc">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div id="evd-new-heading" style="font-size:11px;font-weight:700;color:#6b8399;flex:1">Other evidence (new) — paste a SharePoint or web link, or describe it</div><button type="button" class="btn btn-ghost btn-sm" id="evd-upload-toggle" style="font-size:11px" onclick="ISO._evdToggleUpload()">Upload a file instead</button></div>
          <div class="iso-field-grid">
            <label id="evd-file-row" style="grid-column:1/-1;display:none">File<input type="file" class="form-input" id="evd-file" accept="${EVD_UPLOAD_ACCEPT}" onchange="ISO._evdFileChosen()"/><span style="font-size:10px;color:#8da2b2">PDF, Word, Excel, PowerPoint, CSV, text, images, Outlook or email files, zip — up to the upload limit (10 MB unless an admin changed it). A SharePoint link is preferred: links use no storage.</span></label>
            <div id="evd-doc-row" style="grid-column:1/-1;display:none"><div class="iso-field-grid">
              <label>Document status<select class="form-input" id="evd-docstatus">${Object.keys(EVD_DOC_STATUS_LABEL).map(k => `<option value="${k}"${k === 'draft' ? ' selected' : ''}>${esc(EVD_DOC_STATUS_LABEL[k])}</option>`).join('')}</select></label>
              <label>Owner<select class="form-input" id="evd-owner"><option value="">Me</option>${_evdStaffOptions()}</select></label>
              <label>Approver (where applicable)<select class="form-input" id="evd-approver"><option value="">—</option>${_evdStaffOptions()}</select></label>
              <label>Effective date<input type="date" class="form-input" id="evd-effective"/></label>
            </div></div>
            <label id="evd-kind-row">Type<select class="form-input" id="evd-kind" onchange="ISO._evdKindChanged()">
              <option value="link">Link (web or SharePoint)</option>${EVD_NO_URL_KINDS.map(k => `<option value="${k}">${esc(EVD_KIND_LABEL[k])}</option>`).join('')}
            </select></label>
            <label id="evd-url-row">Reference or link<input class="form-input" id="evd-url" placeholder="https://…"/><span id="evd-url-hint" style="font-size:10px;color:#8da2b2">Required for a link — a sharepoint.com address is recognised automatically.</span></label>
            <label style="grid-column:1/-1">Title<input class="form-input" id="evd-title"/></label>
            <label style="grid-column:1/-1">Description<textarea class="form-input" id="evd-desc"></textarea></label>
            <label>Revision<input class="form-input" id="evd-version"/></label>
            <label>Evidence date<input type="date" class="form-input" id="evd-date"/></label>
            <label>Confidentiality<select class="form-input" id="evd-conf"><option value="normal">Normal</option><option value="restricted">Restricted</option></select></label>
            <label>Role<select class="form-input" id="evd-role"><option value="primary">Primary</option><option value="supporting">Supporting</option></select></label>
            <label style="grid-column:1/-1">Why it's relevant (optional)<textarea class="form-input" id="evd-relevance"></textarea></label>
            ${targetType === 'requirement' ? `<label style="grid-column:1/-1;display:flex;align-items:center;gap:8px"><input type="checkbox" id="evd-only-here"/> Use for this requirement only (never suggested for related requirements)</label>` : ''}
          </div>
        </div>
      </div>
      <button class="btn btn-teal btn-sm" id="evd-save" style="margin-top:16px" onclick="ISO._evdAddApply('${esc(targetType)}','${esc(targetId)}','${esc(auditId)}')">Save evidence</button>
    `, '640px');
    if (opts && opts.upload) {
      _evdToggleUpload();
      if (opts.title) { const t = document.getElementById('evd-title'); if (t) t.value = opts.title; }
    } else setTimeout(() => { const s = document.getElementById('evd-search'); if (s) s.focus(); }, 0);
    api('evidence.search', { auditId: auditId, targetType: targetType, targetId: targetId }).then(res => {
      const host = document.getElementById('iso-evd-lists');
      if (!host || !_evdSel || _evdSel.targetId !== targetId) return; // modal closed or reopened for another target
      const byId = Object.fromEntries(res.items.map(e => [e.id, e]));
      const shown = new Set();
      const take = ids => ids.map(id => byId[id]).filter(e => e && !shown.has(e.id) && shown.add(e.id));
      const related = take(res.relatedIds || []);
      const recent = take(res.recentIds || []);
      const rest = take(res.items.map(e => e.id));
      host.innerHTML = _evdGroupHtml('Used on related requirements', related, 'iso-evd-group-related')
        + _evdGroupHtml('Recently used', recent, 'iso-evd-group-recent')
        + _evdGroupHtml("This board's evidence", rest, 'iso-evd-group-board')
        || '<div style="color:#8da2b2;font-size:12px">No evidence on this board yet — add one below.</div>';
    }).catch(e => { const host = document.getElementById('iso-evd-lists'); if (host) host.innerHTML = `<div style="color:#b91c1c;font-size:12px">Could not load this board's evidence: ${esc(e.message)}</div>`; });
  }
  async function _evdAddApply(targetType, targetId, auditId) {
    const picked = [...document.querySelectorAll('#iso-evd-lists .iso-evd-check:checked')].map(el => el.value);
    const roles = {};
    for (const id of picked) { const sel = document.querySelector(`#iso-evd-lists .iso-evd-role[data-evd="${CSS.escape(id)}"]`); roles[id] = sel ? sel.value : 'primary'; }
    const title = document.getElementById('evd-title').value.trim();
    const url = document.getElementById('evd-url').value.trim();
    const kind = (document.getElementById('evd-kind') || {}).value || 'link';
    const upload = !!(_evdSel && _evdSel.upload);
    const fileInput = document.getElementById('evd-file');
    const file = upload && fileInput && fileInput.files ? fileInput.files[0] : null;
    if (!picked.length && !title && !file) { root.showToast ? root.showToast('Pick evidence from the list or fill in a new one.', true) : null; return; }
    if (upload && title && !file) { root.showToast ? root.showToast('Choose the file to upload — or switch back to a link.', true) : null; return; }
    if (!upload && title && !url && !EVD_NO_URL_KINDS.includes(kind)) { root.showToast ? root.showToast('A link needs its address — or choose a type that has none, such as a note.', true) : null; return; }
    const btn = document.getElementById('evd-save');
    if (btn) btn.disabled = true;
    try {
      if (picked.length) await api('evidence.link', { auditId: auditId, targetType: targetType, targetId: targetId, evidenceIds: picked, roles: roles, linkSource: 'search' });
      if (file) {
        const onlyHere = document.getElementById('evd-only-here');
        await _evdUploadFile(file, targetType, targetId, auditId, {
          title: title || null, description: document.getElementById('evd-desc').value.trim() || null,
          versionLabel: document.getElementById('evd-version').value.trim() || null, evidenceDate: document.getElementById('evd-date').value || null,
          confidentiality: document.getElementById('evd-conf').value, role: (document.getElementById('evd-role') || {}).value || 'primary',
          relevanceNote: (document.getElementById('evd-relevance') || {}).value ? document.getElementById('evd-relevance').value.trim() : null,
          suggestRelated: !(onlyHere && onlyHere.checked),
          documentStatus: (document.getElementById('evd-docstatus') || {}).value || 'draft', ownerUid: (document.getElementById('evd-owner') || {}).value || null,
          approverUid: (document.getElementById('evd-approver') || {}).value || null, effectiveDate: (document.getElementById('evd-effective') || {}).value || null,
        });
      } else if (title) {
        const onlyHere = document.getElementById('evd-only-here');
        await api('evidence.addLink', {
          auditId: auditId, targetType: targetType, targetId: targetId, title: title, url: url || null, kind: kind, linkSource: 'custom',
          description: document.getElementById('evd-desc').value.trim() || null,
          versionLabel: document.getElementById('evd-version').value.trim() || null,
          evidenceDate: document.getElementById('evd-date').value || null,
          confidentiality: document.getElementById('evd-conf').value,
          role: (document.getElementById('evd-role') || {}).value || 'primary',
          relevanceNote: (document.getElementById('evd-relevance') || {}).value ? document.getElementById('evd-relevance').value.trim() : null,
          suggestRelated: !(onlyHere && onlyHere.checked),
        });
      }
      root.showToast ? root.showToast('Evidence saved.') : null;
      if (_req.evidenceByReq) delete _req.evidenceByReq[targetId]; // R3: force the row's own Documents list to refetch
      _reqRefreshEvidence(auditId);
      // Reopen the owning drawer so its panel re-fetches from the server (A49's discipline).
      if (targetType === 'requirement') openRequirementDrawer(auditId, targetId, { tab: 'evidence' });
      else if (targetType === 'finding') openFindingDrawer(auditId, targetId);
      else openActionDrawer(auditId, targetId);
    } catch (e) {
      if (btn) btn.disabled = false;
      root.showToast ? root.showToast('Could not save evidence: ' + e.message, true) : alert(e.message);
    }
  }
  // ── Suggested documents + "Download generator prompt" (plan 8c.4, R12, D22) ─────────────────────
  // No AI anywhere: the dialog asks the server to assemble a predefined prompt (prompt.build), then
  // lets the user copy it or download it as a TXT file to paste into an external tool of their choice.
  // Copy and download are logged with exactly which sensitive profile sections went out.
  let _promptTemplates = null;
  let _pd = null; // { auditId, requirementId, templateKey, template, answersVersion, schema, last }
  const PD_STATUS = { complete: { icon: '✓', label: 'Complete', color: '#0d6e4e' }, partial: { icon: '◐', label: 'Partial', color: '#b45309' }, missing: { icon: '✕', label: 'Missing', color: '#b91c1c' }, withheld: { icon: '⊘', label: 'Not included', color: '#6b8399' } };
  // D40: re-keyed from stableKey (2015 workbook, never matches a v3 row) to v3 document names —
  // a template is suggested here when one of its documents is also one Column P suggests for this
  // clause (guidance.list's own `documents`, R4). The 2 templates with no clean v3 match (Q5) carry
  // an empty `documents` list, so they never appear here — reachable from the Documents tab (R4b)
  // instead, not built yet.
  function reqSuggestedDocsHtml(templates, row, auditId, guidance) {
    const clauseDocs = new Set((guidance && guidance.documents) || []);
    const mine = (templates || []).filter(t => (t.documents || []).some(d => clauseDocs.has(d)));
    if (!mine.length) return '';
    return `<div class="card iso-suggested-docs" style="padding:16px;margin-bottom:12px">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px">Suggested documents (${mine.length})</div>
      <div style="font-size:11px;color:#6b8399;margin-bottom:8px">Document types the workbook names as example evidence for this requirement — suggestions only.</div>
      ${mine.map(t => `<div class="iso-suggested-doc" data-template="${esc(t.templateId)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f4f6fa;font-size:12px;flex-wrap:wrap">
        <span style="flex:1;min-width:180px">${esc(t.title)}${t.reviewStatus !== 'approved' ? ' <span class="iso-draft-tpl" style="font-size:10px;font-weight:700;color:#b45309;border:1px solid #fcd34d;border-radius:4px;padding:1px 5px">DRAFT TEMPLATE</span>' : ''}</span>
        <button class="btn btn-ghost btn-sm" onclick="ISO._openAddEvidence('requirement','${esc(row.id)}','${esc(auditId)}')">Select existing</button>
        <button class="btn btn-ghost btn-sm iso-sd-upload" data-title="${esc(t.title)}" onclick="ISO._openAddEvidence('requirement','${esc(row.id)}','${esc(auditId)}',{upload:true,title:this.dataset.title})">Upload document</button>
        <button class="btn btn-teal btn-sm iso-pd-open" onclick="ISO._openPromptDialog('${esc(auditId)}','${esc(row.id)}','${esc(t.templateId)}')">Download generator prompt</button>
      </div>`).join('')}
    </div>`;
  }
  function _pdCompletenessHtml(built) {
    const rows = (built.completeness || []).map(c => { const st = PD_STATUS[c.status] || PD_STATUS.missing; return `<tr><td style="padding:3px 8px 3px 0">${esc(c.label)}</td><td style="color:${st.color};font-weight:600" data-status="${esc(c.status)}"><span aria-hidden="true">${st.icon}</span> ${esc(st.label)}</td></tr>`; }).join('');
    const missing = built.missing && built.missing.length ? `<ul style="margin:4px 0 0 18px;padding:0">${built.missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '<div>None — every required field is confirmed.</div>';
    return `<div style="display:flex;gap:20px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">Company-profile completeness</div><table style="font-size:12px;border-collapse:collapse">${rows}</table></div>
      <div style="flex:1;min-width:220px"><div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">Required information that is missing</div><div style="font-size:12px">${missing}</div>
      <div style="font-size:11px;color:#8da2b2;margin-top:6px">Anything missing appears in the prompt as [INFORMATION REQUIRED: …]. Confirm it in Settings → Client profile to use it as fact.</div></div>
    </div>`;
  }
  function _pdQuestionHtml(q, value) {
    const id = 'iso-pd-q-' + q.id;
    // 8c.6: a source-backed checklist — ticked items become confirmed answers; nothing unticked is sent.
    if (q.kind === 'checklist') {
      let v = {}; try { v = JSON.parse(value || '{}') || {}; } catch (e) { v = {}; }
      const ticked = new Set(Array.isArray(v.items) ? v.items : []);
      return `<fieldset class="iso-pd-checklist" data-q="${esc(q.id)}" style="border:1px solid #e2eaf2;border-radius:6px;padding:8px 10px;margin:0 0 8px"><legend style="font-size:12px;padding:0 4px">${esc(q.text)}</legend>
        <div style="font-size:11px;color:#6b8399;margin-bottom:6px">Tick only what applies to this organisation. Ticked items go into the prompt as confirmed, with their source; nothing unticked does.</div>
        ${(q.items || []).map(it => `<label style="display:flex;gap:6px;align-items:flex-start;font-size:12px;margin-bottom:3px"><input type="checkbox" class="iso-pd-check" data-q="${esc(q.id)}" value="${esc(it.id)}"${ticked.has(it.id) ? ' checked' : ''}/><span>${esc(it.label)}${it.note ? `<span style="color:#8da2b2"> — ${esc(it.note)}</span>` : ''}</span></label>`).join('')}
        ${q.allowOther ? `<label style="display:block;font-size:12px;margin-top:4px">Other (one per line)<textarea class="form-input iso-pd-check-other" data-q="${esc(q.id)}" rows="2">${esc(v.other || '')}</textarea></label>` : ''}
      </fieldset>`;
    }
    if (q.kind === 'choice') {
      return `<label style="display:block;margin-bottom:8px;font-size:12px">${esc(q.text)}<select class="form-input iso-pd-answer" data-q="${esc(q.id)}" id="${esc(id)}"><option value="">— choose —</option>${(q.options || []).map(o => `<option value="${esc(o)}"${value === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}${value && !(q.options || []).includes(value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}</select></label>`;
    }
    return `<label style="display:block;margin-bottom:8px;font-size:12px">${esc(q.text)}<textarea class="form-input iso-pd-answer" data-q="${esc(q.id)}" id="${esc(id)}" rows="2">${esc(value || '')}</textarea></label>`;
  }
  async function _openPromptDialog(auditId, requirementId, templateKey) {
    const t = (_promptTemplates || []).find(x => x.templateId === templateKey);
    if (!t) return;
    _pd = { auditId: auditId, requirementId: requirementId, templateKey: templateKey, template: t, answersVersion: 0, schema: [], last: null };
    root.openGenericModal('Download generator prompt', `<div id="iso-pd-body">${skeletonRows(4)}</div>`, '940px');
    let saved, built, prof;
    try {
      [saved, built, prof] = await Promise.all([
        api('prompt.getAnswers', { auditId: auditId, requirementId: requirementId, templateKey: templateKey }),
        api('prompt.build', { auditId: auditId, requirementId: requirementId, templateKey: templateKey, mode: 'quick' }),
        api('profile.get', { clientId: _auditCache.client_id }),
      ]);
    } catch (e) {
      const b = document.getElementById('iso-pd-body');
      if (b) b.innerHTML = `<div style="color:#b91c1c;font-size:12px">Could not prepare the prompt: ${esc(e.message)}</div>`;
      return;
    }
    const body = document.getElementById('iso-pd-body');
    if (!body || !_pd || _pd.templateKey !== templateKey) return;
    _pd.answersVersion = saved.rowVersion; _pd.schema = prof.schema; _pd.last = built;
    const supported = (_req.requirements || []).filter(r => (t.supportsStableKeys || []).includes(r.stable_key));
    const sensitive = prof.schema.filter(f => f.sensitive);
    const client = (_DB().clients || []).find(c => c.id === _auditCache.client_id);
    const clientName = client ? (root.clientDisplayTitle ? root.clientDisplayTitle(client) : client.name) : 'this client';
    body.innerHTML = `
      <div class="iso-pd-type" style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:#6b8399">Document type</div>
        <div style="font-size:15px;font-weight:700;color:#0d1c33">${esc(t.title)} ${t.reviewStatus !== 'approved' ? '<span class="iso-draft-tpl" style="font-size:10px;font-weight:700;color:#b45309;border:1px solid #fcd34d;border-radius:4px;padding:1px 5px">DRAFT TEMPLATE — not yet approved by Etcher</span>' : ''}</div>
        <div style="font-size:12px;color:#4a5568;margin-top:2px"><strong>Purpose:</strong> ${esc(t.purpose)}</div>
      </div>
      <div class="iso-pd-supported" style="font-size:12px;margin-bottom:12px"><strong>Requirements potentially supported:</strong> ${supported.length} on this board (potential coverage only — the organisation confirms it)
        <div style="color:#6b8399">${supported.slice(0, 6).map(r => esc(stdLabel(r.standard_code) + ' ' + r.clause)).join(' · ')}${supported.length > 6 ? ` · and ${supported.length - 6} more` : ''}</div></div>
      <div class="card iso-pd-completeness" id="iso-pd-completeness" style="padding:12px 14px;margin-bottom:12px">${_pdCompletenessHtml(built)}</div>
      <fieldset class="iso-pd-mode" style="border:none;padding:0;margin:0 0 10px">
        <legend style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:4px">Mode</legend>
        <label style="display:block;font-size:12px"><input type="radio" name="iso-pd-mode" value="quick" checked onchange="ISO._pdSetMode('quick')"/> Quick prompt — uses confirmed company information and marks everything else as a placeholder</label>
        <label style="display:block;font-size:12px"><input type="radio" name="iso-pd-mode" value="guided" onchange="ISO._pdSetMode('guided')"/> Guided prompt — answer the document-specific questions first</label>
      </fieldset>
      <div id="iso-pd-qsummary" style="font-size:12px;color:#6b8399;margin-bottom:10px">Document-specific questions: ${(t.questions || []).length} — switch to Guided to answer them${Object.keys(saved.answers || {}).length ? ` (${Object.keys(saved.answers).length} saved)` : ''}.</div>
      <div id="iso-pd-questions" class="card" style="padding:12px 14px;margin-bottom:12px" hidden>
        <div style="font-size:11px;font-weight:700;color:#6b8399;margin-bottom:6px">Document-specific questions — your answers are used as fact</div>
        ${(t.questions || []).map(q => _pdQuestionHtml(q, saved.answers[q.id])).join('')}
        <button type="button" class="btn btn-ghost btn-sm" onclick="ISO._pdSaveAnswers()">Save answers</button>
      </div>
      <details class="card" style="padding:12px 14px;margin-bottom:12px"><summary style="cursor:pointer;font-size:12px;font-weight:600">Branding and document control</summary>
        <div class="iso-field-grid" style="margin-top:8px">
          <label>Document number<input class="form-input" id="iso-pd-docno" placeholder="e.g. IMS-REG-004"/></label>
          <label>Document owner (role)<input class="form-input" id="iso-pd-owner"/></label>
          <label>Approved by (role)<input class="form-input" id="iso-pd-approver"/></label>
          <label style="grid-column:1/-1">Branding notes<textarea class="form-input" id="iso-pd-branding" rows="2" placeholder="Anything about layout, fonts or the logo the drafter should know"></textarea></label>
        </div>
      </details>
      <div class="card iso-pd-notice" role="note" style="padding:12px 14px;margin-bottom:12px;background:#fffbeb;border-color:#fcd34d">
        <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">Before you copy or download</div>
        <div style="font-size:12px;color:#92400e">This prompt contains information about ${esc(clientName)}. You will paste it into an external AI tool of your choice, which Task Hub does not control — check that tool's data handling first. Client-internal sections are included only while switched on:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:6px">${sensitive.map(f => `<label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" class="iso-pd-sensitive" data-key="${esc(f.key)}" ${built.sensitiveIncluded.includes(f.key) ? 'checked' : ''} onchange="ISO._pdRefresh()"/> ${esc(f.label)}</label>`).join('')}</div>
      </div>
      <label style="display:block;font-size:11px;font-weight:700;color:#6b8399">Prompt preview
        <textarea id="iso-pd-preview" class="form-input" readonly rows="12" style="font-family:monospace;font-size:11px;white-space:pre">${esc(built.text)}</textarea></label>
      <div class="iso-pd-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" onclick="ISO._pdDownloadNow()">Download now with placeholders</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ISO._pdSetMode('guided', true)">Complete guided questions</button>
        <button type="button" class="btn btn-ghost btn-sm" id="iso-pd-copy" onclick="ISO._pdCopy()">Copy prompt</button>
        <button type="button" class="btn btn-teal btn-sm" id="iso-pd-download" onclick="ISO._pdDownload()">Download TXT</button>
      </div>
      <div id="iso-pd-filename" style="font-size:11px;color:#8da2b2;margin-top:6px">${esc(built.filename)}</div>`;
    body.querySelectorAll('#iso-pd-questions .iso-pd-answer, #iso-pd-questions .iso-pd-check, #iso-pd-questions .iso-pd-check-other, #iso-pd-docno, #iso-pd-owner, #iso-pd-approver, #iso-pd-branding').forEach(el => el.addEventListener('change', () => _pdRefresh()));
  }
  function _pdMode() { const r = document.querySelector('input[name="iso-pd-mode"]:checked'); return r ? r.value : 'quick'; }
  function _pdCollect() {
    const answers = {};
    document.querySelectorAll('#iso-pd-questions .iso-pd-answer').forEach(el => { if (el.value.trim()) answers[el.dataset.q] = el.value.trim(); });
    document.querySelectorAll('#iso-pd-questions .iso-pd-checklist').forEach(fs => {
      const items = [...fs.querySelectorAll('.iso-pd-check:checked')].map(c => c.value);
      const o = fs.querySelector('.iso-pd-check-other'); const other = o ? o.value.trim() : '';
      if (items.length || other) answers[fs.dataset.q] = JSON.stringify({ items: items, other: other });
    });
    const includeSensitive = {};
    document.querySelectorAll('#iso-pd-body .iso-pd-sensitive').forEach(el => { includeSensitive[el.dataset.key] = el.checked; });
    const val = id => (document.getElementById(id) || {}).value || '';
    return { mode: _pdMode(), answers: answers, options: { includeSensitive: includeSensitive, docControl: { documentNumber: val('iso-pd-docno'), ownerRole: val('iso-pd-owner'), approverRole: val('iso-pd-approver') }, brandingNotes: val('iso-pd-branding') } };
  }
  // Several quick changes start several refreshes; their answers can come back in any order. Only the
  // newest one may update the preview — an older, slower one must never overwrite it with stale text.
  // Each caller still gets its own result back (Copy and Download use theirs).
  let _pdSeq = 0;
  async function _pdRefresh() {
    if (!_pd) return null;
    const c = _pdCollect();
    const seq = ++_pdSeq;
    const built = await api('prompt.build', { auditId: _pd.auditId, requirementId: _pd.requirementId, templateKey: _pd.templateKey, mode: c.mode, answers: c.answers, options: c.options });
    if (seq !== _pdSeq) return built;
    _pd.last = built;
    const pv = document.getElementById('iso-pd-preview'); if (pv) pv.value = built.text;
    const cp = document.getElementById('iso-pd-completeness'); if (cp) cp.innerHTML = _pdCompletenessHtml(built);
    const fn = document.getElementById('iso-pd-filename'); if (fn) fn.textContent = built.filename;
    return built;
  }
  function _pdSetMode(mode, focusFirst) {
    const r = document.querySelector(`input[name="iso-pd-mode"][value="${mode}"]`); if (r) r.checked = true;
    const qs = document.getElementById('iso-pd-questions'); if (qs) qs.hidden = mode !== 'guided';
    const qsum = document.getElementById('iso-pd-qsummary'); if (qsum) qsum.hidden = mode === 'guided';
    if (focusFirst && qs) { const first = qs.querySelector('.iso-pd-answer'); if (first) first.focus(); }
    _pdRefresh();
  }
  async function _pdSaveAnswers() {
    if (!_pd) return;
    try {
      const res = await mutate('prompt.saveAnswers', { auditId: _pd.auditId, requirementId: _pd.requirementId, templateKey: _pd.templateKey, answers: _pdCollect().answers, expectedVersion: _pd.answersVersion });
      _pd.answersVersion = res.rowVersion;
      root.showToast ? root.showToast('Answers saved.') : null;
    } catch (e) { root.showToast ? root.showToast('Could not save the answers: ' + e.message, true) : alert(e.message); }
  }
  function _pdLog(kind, built) {
    return api('prompt.logExport', { auditId: _pd.auditId, requirementId: _pd.requirementId, templateKey: _pd.templateKey, kind: kind, filename: built.filename, sensitiveIncluded: built.sensitiveIncluded }).catch(() => {});
  }
  // A download, never a new tab (hard rule 13): a Blob behind a temporary <a download>.
  function _pdSaveFile(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function _pdDownload() {
    try { const built = await _pdRefresh(); _pdSaveFile(built.text, built.filename); await _pdLog('download', built); root.showToast ? root.showToast('Prompt downloaded.') : null; }
    catch (e) { root.showToast ? root.showToast('Could not prepare the prompt: ' + e.message, true) : alert(e.message); }
  }
  async function _pdDownloadNow() { _pdSetMode('quick'); await _pdDownload(); }
  async function _pdCopy() {
    try {
      const built = await _pdRefresh();
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) { try { await navigator.clipboard.writeText(built.text); copied = true; } catch (e) {} }
      if (!copied) {
        const pv = document.getElementById('iso-pd-preview');
        if (pv) { pv.focus(); pv.select(); }
        root.showToast ? root.showToast('Press Ctrl+C to copy the selected prompt.') : null;
      } else root.showToast ? root.showToast('Prompt copied.') : null;
      await _pdLog('copy', built);
    } catch (e) { root.showToast ? root.showToast('Could not prepare the prompt: ' + e.message, true) : alert(e.message); }
  }

  // ── 8b.5: evidence suggestions and per-link review (D20, D21) ───────────────────────────────────
  // Verdicts and the register's evidence status are shown as text + icon, never colour alone, and
  // kept visually apart from the assessment state and result pills.
  const EVD_VERDICT_ICON = { submitted: '○', under_review: '◔', more_info_required: '?', accepted: '✓', partially_sufficient: '◐', insufficient: '✕', rejected: '⊘', superseded: '↻' };
  const EVD_VERDICT_OPTIONS = [['accepted', 'Accept — sufficient'], ['partially_sufficient', 'Partially sufficient'], ['insufficient', 'Insufficient'], ['more_info_required', 'More info needed'], ['under_review', 'Under review'], ['rejected', 'Reject — not relevant']];
  // afterEvidenceId: rendered inside the evidence drawer (8b.6) — the verdict returns there.
  function _evdReviewControlsHtml(e, targetType, targetId, auditId, afterEvidenceId) {
    const me = _cu();
    const mine = me && (e.createdBy === 'offline:' + me.id || e.createdBy === me.id);
    if (mine) return `<div class="iso-evd-review-own" style="font-size:11px;color:#8da2b2;margin-top:4px">You added this here — another reviewer records the verdict.</div>`;
    if (!canVerifyActionLocally()) return '';
    return `<div class="iso-evd-review" data-link="${esc(e.linkId)}" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">
      <select class="form-input iso-evd-verdict" style="width:auto;height:28px;font-size:11px" aria-label="Verdict">${EVD_VERDICT_OPTIONS.map(([v, l]) => `<option value="${v}"${e.reviewStatus === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <input class="form-input iso-evd-review-comment" style="flex:1;min-width:160px;height:28px;font-size:11px" placeholder="Comment (required to send it back or reject)" aria-label="Review comment" value="${esc(e.reviewComment || '')}"/>
      <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._evdReview('${esc(targetType)}','${esc(targetId)}','${esc(auditId)}','${esc(e.linkId)}',${Number(e.linkRowVersion) || 1},'${esc(afterEvidenceId || '')}')">Record verdict</button>
    </div>`;
  }
  async function _evdReview(targetType, targetId, auditId, linkId, expectedVersion, afterEvidenceId) {
    const box = document.querySelector(`.iso-evd-review[data-link="${CSS.escape(linkId)}"]`);
    if (!box) return;
    try {
      await mutate('evidence.review', { auditId: auditId, linkId: linkId, verdict: box.querySelector('.iso-evd-verdict').value, comment: box.querySelector('.iso-evd-review-comment').value.trim() || null, expectedVersion: expectedVersion });
      root.showToast ? root.showToast('Verdict recorded.') : null;
      _reqRefreshEvidence(auditId);
      if (afterEvidenceId) { _evtRefresh(auditId); openEvidenceDrawer(auditId, afterEvidenceId); }
      else if (targetType === 'requirement') openRequirementDrawer(auditId, targetId, { tab: 'evidence' });
      else if (targetType === 'finding') openFindingDrawer(auditId, targetId);
      else openActionDrawer(auditId, targetId);
    } catch (e) { root.showToast ? root.showToast('Could not record the verdict: ' + e.message, true) : alert(e.message); }
  }
  function reqSuggestionsHtml(suggestions, row, auditId, isManager) {
    if (!suggestions || !suggestions.length) return '';
    return `<div class="card iso-evd-suggestions" style="padding:16px;margin-bottom:12px;border-left:3px solid #93c5fd">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px"><span aria-hidden="true">⟳</span> Evidence suggested (${suggestions.length})</div>
      <div style="font-size:11px;color:#6b8399;margin-bottom:8px">Used on a confirmed related requirement, or accepted for this clause in the last audit. Nothing is attached until you confirm it here; the assessment never changes by itself.</div>
      ${suggestions.map(s => `<div class="iso-evd-sugg" data-evidence="${esc(s.evidenceId)}" style="padding:8px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
        <div><strong>${esc(s.evidence.ref)} — ${esc(s.evidence.title)}</strong>${s.evidence.versionLabel ? ` · rev ${esc(s.evidence.versionLabel)}` : ''}${s.evidence.evidenceDate ? ` · ${esc(fmtDate(s.evidence.evidenceDate))}` : ''}</div>
        ${s.source ? `<div style="color:#4a5568;margin-top:2px">From ${esc(stdLabel(s.source.standard_code))} ${esc(s.source.clause)} — ${esc((s.source.requirement_text || '').slice(0, 90))}</div>` : `<div class="iso-carried-tag" style="margin-top:4px"><span aria-hidden="true">↻</span> Carried over — last audit's accepted evidence</div>`}
        <div style="color:#6b8399">${esc(s.relationshipKindLabel)}${s.relationshipReason ? ' — ' + esc(s.relationshipReason) : ''}</div>
        ${isManager ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">
          <select class="form-input iso-sugg-role" style="width:auto;height:28px;font-size:11px" aria-label="Role"><option value="primary">Confirm as primary</option><option value="supporting">Confirm as supporting</option></select>
          <input class="form-input iso-sugg-comment" style="flex:1;min-width:160px;height:28px;font-size:11px" placeholder="Comment (optional)" aria-label="Comment"/>
          <button type="button" class="btn btn-teal btn-sm" style="font-size:11px" onclick="ISO._suggDecide('${esc(auditId)}','${esc(row.id)}','${esc(s.evidenceId)}','confirm')">Confirm</button>
          <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._suggDecide('${esc(auditId)}','${esc(row.id)}','${esc(s.evidenceId)}','reject')">Reject — not relevant</button>
          <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._openAddEvidence('requirement','${esc(row.id)}','${esc(auditId)}')">Select different evidence</button>
        </div>` : ''}
      </div>`).join('')}
    </div>`;
  }
  async function _suggDecide(auditId, reqId, evidenceId, decision) {
    const box = document.querySelector(`.iso-evd-sugg[data-evidence="${CSS.escape(evidenceId)}"]`);
    try {
      await mutate('evidence.decideSuggestion', { auditId: auditId, evidenceId: evidenceId, targetId: reqId, decision: decision, role: box ? box.querySelector('.iso-sugg-role').value : 'primary', comment: box ? (box.querySelector('.iso-sugg-comment').value.trim() || null) : null });
      root.showToast ? root.showToast(decision === 'confirm' ? 'Evidence linked.' : 'Suggestion rejected — it won\'t be suggested again.') : null;
      _reqRefreshEvidence(auditId);
      openRequirementDrawer(auditId, reqId, { tab: 'evidence' });
    } catch (e) { root.showToast ? root.showToast('Could not record the decision: ' + e.message, true) : alert(e.message); }
  }
  // Register: the Evidence column (optional, Columns menu) shows counts — no rule needed to merge
  // several links into one status — and the name cell carries an "Evidence suggested" marker.
  // A49: an evidence or relationship change alters the register's Evidence column and "Evidence
  // suggested" markers too — re-fetch the summary and re-render the register, not just the drawer.
  function _reqRefreshEvidence(auditId) {
    if (!auditId || _req.auditId !== auditId) return;
    api('evidence.summary', { auditId: auditId }).then(sum => { _req.evidenceSummary = sum || {}; renderRequirementsTable(auditId); }).catch(() => {});
  }
  function reqEvidenceCellHtml(sum) {
    if (!sum || (!sum.accepted && !sum.partial && !sum.insufficient && !sum.toReview && !sum.suggested)) return '<span class="iso-evd-none" style="color:#8da2b2">No evidence</span>';
    const parts = [];
    if (sum.accepted) parts.push(`<span style="color:#0d6e4e">✓ ${sum.accepted} confirmed</span>`);
    if (sum.toReview) parts.push(`<span style="color:#475569">○ ${sum.toReview} to review</span>`);
    if (sum.partial) parts.push(`<span style="color:#92400e">◐ ${sum.partial} partial</span>`);
    if (sum.insufficient) parts.push(`<span style="color:#b91c1c">✕ ${sum.insufficient} insufficient</span>`);
    if (sum.suggested) parts.push(`<span style="color:#3b5bdb">⟳ ${sum.suggested} suggested</span>`);
    return `<span class="iso-evd-cell" style="font-size:11px">${parts.join(' · ')}</span>`;
  }

  // ── 8b.6: the board's Evidence tab (register + "Evidence to review" queue) and evidence drawer ──
  let _evt = { auditId: null, items: [], suggestions: [], view: 'register' };
  // Same words and icons as the register's Evidence column (8b.5), plus the two end states.
  const EVD_LINK_SUMMARY_ORDER = [['accepted', '✓', 'confirmed'], ['toReview', '○', 'to review'], ['partially_sufficient', '◐', 'partial'], ['insufficient', '✕', 'insufficient'], ['rejected', '⊘', 'rejected'], ['superseded', '↻', 'superseded']];
  function _evdLinkSummaryText(sum) {
    const parts = EVD_LINK_SUMMARY_ORDER.filter(([k]) => sum && sum[k]).map(([k, icon, label]) => `${icon} ${sum[k]} ${label}`);
    return parts.length ? parts.join(' · ') : 'Not linked';
  }
  function _uidName(uid) { const u = (_DB().users || []).find(x => 'offline:' + x.id === uid || x.id === uid); return u ? u.name : ''; }
  function buildEvidenceCtx(auditId) {
    const none = '<span style="color:#c8d4e0">—</span>';
    return {
      key: 'iso:' + auditId + ':evidence',
      columns() { return [{ key: 'kind', label: 'Type', width: '140px' }, { key: 'versionLabel', label: 'Revision', width: '90px' }, { key: 'evidenceDate', label: 'Date', width: '110px' }, { key: 'confidentiality', label: 'Confidentiality', width: '120px' }, { key: 'review', label: 'Review status', width: '300px' }]; },
      sections() {
        const rows = _evt.items.map(e => Object.assign(e, { name: `${e.ref} — ${e.title}${e.supersededBy ? ' (superseded)' : ''}` }));
        return rows.length ? [{ id: 'evidence', label: 'Evidence on this board', color: '#97bcbd', rows }] : [];
      },
      rowId(row) { return row.id; },
      rowAttrs(row) { return { 'data-ievd': row.id, 'data-superseded': row.supersededBy ? '1' : '0' }; },
      cell(row, fieldKey) {
        if (fieldKey === 'kind') return { html: esc(EVD_KIND_LABEL[row.kind] || row.kind) };
        if (fieldKey === 'versionLabel') return { html: row.versionLabel ? esc(row.versionLabel) : none };
        if (fieldKey === 'evidenceDate') return { html: row.evidenceDate ? esc(fmtDate(row.evidenceDate)) : none };
        if (fieldKey === 'confidentiality') return { html: row.confidentiality === 'restricted' ? '<span style="color:#b91c1c;font-weight:700;font-size:11px">RESTRICTED</span>' : 'Normal' };
        if (fieldKey === 'review') return { html: `<span class="iso-evd-linksum" style="font-size:11px">${esc(_evdLinkSummaryText(row.linkSummary))}</span>` };
        return { html: '' };
      },
      editor() { return null; },
      save() { return Promise.resolve(); },
      open(rowId) { openEvidenceDrawer(auditId, rowId); },
      rerender() { renderEvidenceTab(auditId); },
      emptyHtml() { return 'No evidence on this board yet — add it from a requirement, finding or action.'; },
      canDragRows() { return false; },
      fixedColumns: true, // set widths, no drag-resize; the name column takes the remaining space
    };
  }
  async function fillEvidenceTab(audit) {
    const host = document.getElementById('iso-evd-tab');
    if (!host) return;
    try {
      const [res, suggestions] = await Promise.all([api('evidence.search', { auditId: audit.id }), api('evidence.suggestions', { auditId: audit.id })]);
      _evt = { auditId: audit.id, items: res.items || [], suggestions: suggestions || [], view: _evt.auditId === audit.id ? _evt.view : 'register' };
    } catch (e) { host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load evidence: ${esc(e.message)}</div>`; return; }
    renderEvidenceTab(audit.id);
  }
  // A49: anything that changes evidence re-fetches this tab from the server, never patches it locally.
  function _evtRefresh(auditId) { if (auditId && _evt.auditId === auditId && document.getElementById('iso-evd-tab')) return fillEvidenceTab({ id: auditId }); }
  function _evtSetView(v) { _evt.view = v; renderEvidenceTab(_evt.auditId); }
  function renderEvidenceTab(auditId) {
    const host = document.getElementById('iso-evd-tab');
    if (!host) return;
    const on = v => _evt.view === v ? 'background:rgba(151,188,189,0.18);color:#0d1c33;border-color:#97bcbd' : '';
    const tb = `<div class="card" style="padding:10px 14px;margin-top:16px;margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm iso-evt-view" data-view="register" style="${on('register')}" onclick="ISO._evtSetView('register')">Evidence register (${_evt.items.length})</button>
      <button class="btn btn-ghost btn-sm iso-evt-view" data-view="queue" style="${on('queue')}" onclick="ISO._evtSetView('queue')"><span aria-hidden="true">⟳</span> Evidence to review (${_evt.suggestions.length})</button>
    </div>`;
    if (_evt.view === 'queue') { host.innerHTML = tb + _evtQueueHtml(auditId); return; }
    const ctx = buildEvidenceCtx(auditId);
    root._isoSetMtCtx(ctx);
    host.innerHTML = tb + root._mtRenderGeneric(ctx);
  }
  // The board-wide queue: every pending suggestion (evidence.suggestions, D21). Batch decisions are
  // allowed, but each requirement still gets its own recorded decision — one decideSuggestion each.
  function _evtQueueHtml(auditId) {
    if (!_evt.suggestions.length) return '<div class="card iso-evt-queue" style="padding:16px;color:#8da2b2;font-size:12px">Nothing to review — no evidence is suggested for any requirement on this board.</div>';
    const isManager = canManageActionLocally();
    const reqName = r => r ? `${stdLabel(r.standard_code)} ${r.clause}` : '—';
    return `<div class="card iso-evt-queue" style="padding:14px 16px">
      <div style="font-size:11px;color:#6b8399;margin-bottom:8px">Evidence already linked to one requirement, suggested for a requirement it has a confirmed relationship with. Nothing is attached until it is confirmed here; the assessment never changes by itself.</div>
      ${isManager ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="iso-evtq-all" onchange="ISO._evtQueueSelectAll(this.checked)"/> Select all</label>
        <select class="form-input" id="iso-evtq-role" style="width:auto;height:28px;font-size:11px" aria-label="Role for confirmed evidence"><option value="primary">Confirm as primary</option><option value="supporting">Confirm as supporting</option></select>
        <input class="form-input" id="iso-evtq-comment" style="flex:1;min-width:180px;height:28px;font-size:11px" placeholder="Comment for these decisions (optional)" aria-label="Comment"/>
        <button class="btn btn-teal btn-sm" onclick="ISO._evtQueueDecide('confirm')">Confirm selected</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO._evtQueueDecide('reject')">Reject selected</button>
      </div>` : ''}
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;color:#6b8399;font-size:11px">${isManager ? '<th style="padding:4px 6px"></th>' : ''}<th style="padding:4px 6px">Evidence</th><th style="padding:4px 6px">Source requirement</th><th style="padding:4px 6px">Suggested for</th><th style="padding:4px 6px">Relationship</th><th style="padding:4px 6px">Suggested</th>${isManager ? '<th style="padding:4px 6px"></th>' : ''}</tr></thead>
        <tbody>${_evt.suggestions.map(s => `<tr class="iso-evtq-row" data-evidence="${esc(s.evidenceId)}" data-target-id="${esc(s.targetId)}" style="border-top:1px solid #f4f6fa;vertical-align:top">
          ${isManager ? `<td style="padding:6px"><input type="checkbox" class="iso-evtq-check" aria-label="${esc('Select ' + s.evidence.ref + ' for ' + reqName(s.target))}"/></td>` : ''}
          <td style="padding:6px"><strong>${esc(s.evidence.ref)}</strong> — ${esc(s.evidence.title)}${s.evidence.versionLabel ? ` · rev ${esc(s.evidence.versionLabel)}` : ''}</td>
          <td style="padding:6px">${esc(reqName(s.source))}</td>
          <td style="padding:6px"><span style="font-weight:600">${esc(reqName(s.target))}</span><div style="color:#6b8399">${esc(((s.target && s.target.requirement_text) || '').slice(0, 90))}</div></td>
          <td style="padding:6px">${esc(s.relationshipKindLabel)}${s.relationshipReason ? `<div style="color:#6b8399">${esc(s.relationshipReason)}</div>` : ''}</td>
          <td style="padding:6px;white-space:nowrap">${s.suggestedAt ? esc(fmtTs(s.suggestedAt)) : '—'}</td>
          ${isManager ? `<td style="padding:6px;white-space:nowrap"><button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._evtQueueDecideOne('${esc(s.evidenceId)}','${esc(s.targetId)}','confirm')">Confirm</button> <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ISO._evtQueueDecideOne('${esc(s.evidenceId)}','${esc(s.targetId)}','reject')">Reject</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }
  function _evtQueueSelectAll(checked) { document.querySelectorAll('.iso-evtq-check').forEach(c => { c.checked = !!checked; }); }
  async function _evtQueueRun(picked, decision) {
    const role = (document.getElementById('iso-evtq-role') || {}).value || 'primary';
    const comment = ((document.getElementById('iso-evtq-comment') || {}).value || '').trim() || null;
    const auditId = _evt.auditId;
    let done = 0;
    for (const p of picked) {
      try { await mutate('evidence.decideSuggestion', { auditId: auditId, evidenceId: p.evidenceId, targetId: p.targetId, decision: decision, role: role, comment: comment }); done++; }
      catch (e) { if (root.showToast) root.showToast('Could not record one decision: ' + e.message, true); }
    }
    if (done && root.showToast) root.showToast(`${done} decision${done === 1 ? '' : 's'} recorded — one for each requirement.`);
    await fillEvidenceTab({ id: auditId });
    _reqRefreshEvidence(auditId);
  }
  function _evtQueueDecide(decision) {
    const picked = [...document.querySelectorAll('.iso-evtq-row')].filter(tr => tr.querySelector('.iso-evtq-check') && tr.querySelector('.iso-evtq-check').checked).map(tr => ({ evidenceId: tr.dataset.evidence, targetId: tr.dataset.targetId }));
    if (!picked.length) { if (root.showToast) root.showToast('Select at least one suggestion first.', true); return; }
    return _evtQueueRun(picked, decision);
  }
  function _evtQueueDecideOne(evidenceId, targetId, decision) { return _evtQueueRun([{ evidenceId: evidenceId, targetId: targetId }], decision); }
  async function openEvidenceDrawer(auditId, evidenceId) {
    root.openGenericModal('Evidence', `<div id="iso-evd-drawer">${skeletonFor('drawer')}</div>`, '900px');
    let e, search;
    try { [e, search] = await Promise.all([api('evidence.get', { auditId: auditId, evidenceId: evidenceId }), api('evidence.search', { auditId: auditId })]); }
    catch (err) { const b = document.getElementById('iso-evd-drawer'); if (b) b.innerHTML = `<div style="color:#b91c1c;font-size:12px">Could not open this evidence: ${esc(err.message)}</div>`; return; }
    const body = document.getElementById('iso-evd-drawer');
    if (!body) return;
    document.getElementById('generic-modal-title').textContent = `${e.ref} — ${e.title}`;
    const by = k => e.links.filter(l => (Array.isArray(k) ? k : [k]).includes(l.reviewStatus));
    const shortOf = l => l.targetStandard ? String(l.targetShort || '').replace(/^ISO \S+ /, '') : l.targetShort;
    const line = (k, label) => { const ls = by(k); return ls.length ? `<div class="iso-evd-sum-line"><strong>${label}:</strong> ${stdChipsInline(ls, l => l.targetStandard, shortOf)}</div>` : ''; };
    const others = (search.items || []).filter(x => x.id !== e.id && !x.supersededBy);
    const isManager = canManageActionLocally();
    const field = (label, html) => `<div><div style="color:#6b8399;font-size:11px">${label}</div><div>${html}</div></div>`;
    body.innerHTML = `
      ${e.supersededBy ? `<div class="card iso-evd-superseded" style="padding:8px 12px;margin-bottom:10px;background:#f1f5f9;font-size:12px"><span aria-hidden="true">↻</span> Superseded by <strong>${esc(e.supersededByRef || e.supersededBy)}</strong> — kept for the record; it is no longer suggested or offered for new links.</div>` : ''}
      <div class="card" style="padding:14px 16px;margin-bottom:12px;font-size:12px">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
          ${field('Type', esc(EVD_KIND_LABEL[e.kind] || e.kind))}
          ${field('Revision', esc(e.versionLabel || '—'))}
          ${field('Evidence date', e.evidenceDate ? esc(fmtDate(e.evidenceDate)) : '—')}
          ${field('Added', e.createdAt ? esc(fmtTs(e.createdAt)) : '—')}
          ${field('Owner', esc(_uidName(e.ownerUid) || '—'))}
          ${field('Confidentiality', e.confidentiality === 'restricted' ? '<span style="color:#b91c1c;font-weight:700">RESTRICTED</span>' : 'Normal')}
          ${field('Visibility', esc(e.visibility || 'internal'))}
        </div>
        ${e.url ? `<div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;color:#4a5568">${esc(e.url)}</span><button class="btn btn-ghost btn-sm" style="font-size:11px" data-url="${esc(e.url)}" onclick="ISO._evdCopyLink(this.dataset.url)">Copy link</button></div>` : ''}
        ${_evdFileLineHtml(e, auditId)}
        ${e.description ? `<div style="color:#4a5568;margin-top:8px">${esc(e.description)}</div>` : ''}
      </div>
      <div class="card iso-evd-verdict-summary" style="padding:12px 16px;margin-bottom:12px;font-size:12px;line-height:1.7">
        ${line('accepted', '✓ Accepted for')}${line(['submitted', 'under_review', 'more_info_required'], '○ Awaiting review for')}${line('partially_sufficient', '◐ Partially sufficient for')}${line('insufficient', '✕ Insufficient for')}${line('rejected', '⊘ Rejected for')}${line('superseded', '↻ Superseded on')}
        ${!e.links.length ? '<div style="color:#8da2b2">Not linked to anything yet.</div>' : ''}
      </div>
      <div class="card iso-evd-links" style="padding:14px 16px;margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;margin-bottom:6px">Used on (${e.links.length})</div>
        ${groupByStandardHtml(e.links, l => l.targetStandard, l => `<div class="iso-evd-link" data-target-id="${esc(l.targetId)}" style="padding:8px 0;border-bottom:1px solid #f4f6fa;font-size:12px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:200px">${esc(l.targetLabel)}</span>
            <span class="iso-evd-link-verdict" style="font-size:10px;font-weight:700;color:${EVD_REVIEW_COLOR[l.reviewStatus] || '#6b8399'};border:1px solid currentColor;border-radius:4px;padding:1px 6px"><span aria-hidden="true">${EVD_VERDICT_ICON[l.reviewStatus] || ''}</span> ${esc(EVD_REVIEW_LABEL[l.reviewStatus] || l.reviewStatus)}</span>
            <span style="font-size:10px;color:#6b8399">${l.role === 'supporting' ? 'Supporting' : 'Primary'}</span></div>
          ${l.relevanceNote ? `<div style="color:#4a5568;margin-top:2px">Why: ${esc(l.relevanceNote)}</div>` : ''}
          ${l.reviewComment ? `<div style="color:#4a5568;margin-top:2px">Reviewer: ${esc(l.reviewComment)}${l.reviewedVersionLabel ? ' (rev ' + esc(l.reviewedVersionLabel) + ')' : ''}</div>` : ''}
          ${['superseded', 'rejected'].includes(l.reviewStatus) || e.supersededBy ? '' : _evdReviewControlsHtml(l, l.targetType, l.targetId, auditId, e.id)}
        </div>`, 'Findings & actions')}
      </div>
      ${isManager && e.hasFile && !e.supersededBy ? `<div class="card iso-evd-docctl" style="padding:12px 16px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px">
        <label for="iso-evd-docstatus">Document status</label>
        <select class="form-input" id="iso-evd-docstatus" style="width:auto;height:28px;font-size:11px">${Object.keys(EVD_DOC_STATUS_LABEL).map(k => `<option value="${k}"${k === (e.documentStatus || 'draft') ? ' selected' : ''}>${esc(EVD_DOC_STATUS_LABEL[k])}</option>`).join('')}</select>
        <label for="iso-evd-approver">Approver</label>
        <select class="form-input" id="iso-evd-approver" style="width:auto;height:28px;font-size:11px"><option value="">—</option>${_evdStaffOptions(e.approverUid)}</select>
        <label for="iso-evd-effective">Effective</label>
        <input type="date" class="form-input" id="iso-evd-effective" style="width:auto;height:28px;font-size:11px" value="${esc(e.effectiveDate || '')}"/>
        <button class="btn btn-ghost btn-sm" data-audit="${esc(auditId)}" data-evd="${esc(e.id)}" data-version="${Number(e.rowVersion) || 1}" onclick="ISO._evdSetDocStatus(this.dataset.audit,this.dataset.evd,Number(this.dataset.version))">Save document status</button>
        <div style="flex-basis:100%;font-size:11px;color:#6b8399">The document's own status, as stated on it — separate from the reviewer's verdict on each link.</div>
      </div>` : ''}
      ${isManager && !e.supersededBy && others.length ? `<div class="card iso-evd-supersede" style="padding:12px 16px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label for="iso-evd-supersede" style="font-size:12px">Superseded by a newer record</label>
        <select class="form-input" id="iso-evd-supersede" style="width:auto;max-width:360px;height:28px;font-size:11px">${others.map(o => `<option value="${esc(o.id)}">${esc(o.ref + ' — ' + o.title + (o.versionLabel ? ' (rev ' + o.versionLabel + ')' : ''))}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" onclick="ISO._evdSupersede('${esc(auditId)}','${esc(e.id)}',${Number(e.rowVersion) || 1})">Mark superseded</button>
        <div style="flex-basis:100%;font-size:11px;color:#6b8399">Its links move to the newer record as "Not reviewed"; this record keeps its history.</div>
      </div>` : ''}
      <div class="card iso-evd-history" style="padding:12px 16px"><div style="font-weight:700;font-size:12px;margin-bottom:6px">History</div>
        ${e.history.length ? e.history.map(h => `<div style="font-size:11px;color:#4a5568;padding:2px 0">${esc(fmtTs(h.at))} — ${esc(String(h.action || '').replace(/_/g, ' '))}${_uidName(h.actorUid) ? ' · ' + esc(_uidName(h.actorUid)) : ''}</div>`).join('') : '<div style="color:#8da2b2;font-size:12px">No history yet.</div>'}
      </div>`;
  }
  async function _evdSetDocStatus(auditId, evidenceId, expectedVersion) {
    const v = id => (document.getElementById(id) || {}).value || null;
    try {
      await mutate('evidence.setDocumentStatus', { auditId: auditId, evidenceId: evidenceId, documentStatus: v('iso-evd-docstatus') || 'draft', approverUid: v('iso-evd-approver'), effectiveDate: v('iso-evd-effective'), expectedVersion: expectedVersion });
      if (root.showToast) root.showToast('Document status saved.');
      _evtRefresh(auditId);
      _reqRefreshEvidence(auditId);
      openEvidenceDrawer(auditId, evidenceId);
    } catch (e) { if (root.showToast) root.showToast('Could not save the document status: ' + e.message, true); }
  }
  async function _evdSupersede(auditId, evidenceId, expectedVersion) {
    const by = (document.getElementById('iso-evd-supersede') || {}).value;
    if (!by) return;
    try {
      const res = await mutate('evidence.supersede', { auditId: auditId, evidenceId: evidenceId, byEvidenceId: by, expectedVersion: expectedVersion });
      if (root.showToast) root.showToast(`Superseded — ${res.linksCarriedOver} link${res.linksCarriedOver === 1 ? '' : 's'} moved to the newer record as "Not reviewed".`);
      _evtRefresh(auditId);
      _reqRefreshEvidence(auditId);
      openEvidenceDrawer(auditId, evidenceId);
    } catch (e) { if (root.showToast) root.showToast('Could not supersede: ' + e.message, true); }
  }

  // ── Dashboard tab (plan 9.2/9.3; reworked as stage 1 of 9.5 — D26–D29) ──────────────────────────────
  // One ISO board = one client's audit, so this is that client's dashboard (D26); dashboard.audit
  // refuses client callers, so it is staff-only until Phase 13. Every number is exactly a field of
  // dashboard.audit's output (api/_isoCalc.js's buildDashboard): this file never recomputes a count, it
  // renders what the server decided with the filter the server attached.
  let _dash = { auditId: null, data: null, mode: 'overview' };
  let _dashSeq = 0; // only the newest request may render — a slower, older answer never overwrites it
  const AUDIT_TYPE_LABEL = { internal: 'Internal audit', gap_analysis: 'Gap analysis', certification_prep: 'Certification preparation', surveillance: 'Surveillance audit', recertification: 'Recertification audit', supplier: 'Supplier audit', custom: 'Custom audit', follow_up: 'Follow-up audit' };
  const STAGE_LABEL = { planning: 'Planning', fieldwork: 'Fieldwork', reporting: 'Reporting', capa: 'Corrective actions', closed: 'Closed' };

  // Only what the board's top strip doesn't already show (it has ref · title, editions, Private).
  function _dashHeaderHtml(audit, d) {
    const client = currentClient();
    const clientName = client ? (root.clientDisplayTitle ? root.clientDisplayTitle(client) : client.name) : 'Client not found';
    const type = audit.audit_type === 'custom' && audit.custom_type_label ? audit.custom_type_label : (AUDIT_TYPE_LABEL[audit.audit_type] || audit.audit_type || '—');
    const dates = audit.planned_start || audit.planned_end ? `${fmtDate(audit.planned_start)} – ${fmtDate(audit.planned_end)}` : 'Not set';
    const item = (label, value) => `<div class="iso-dash-hdr-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    // The board header right above already shows client, ref and title, so the heading stays for
    // screen readers only; what shows is the way back to the compact Overview.
    return `<section class="iso-dash-header" aria-labelledby="iso-dash-h">
      <h2 id="iso-dash-h" class="iso-dash-title iso-visually-hidden">${esc(clientName)}<span class="iso-dash-title-sub">${esc(audit.ref)} · ${esc(audit.title)}</span></h2>
      <button type="button" class="iso-back iso-dash-back" onclick="ISO._ovShowOverview()"><span aria-hidden="true">‹</span> Overview</button>
      <dl class="iso-dash-hdr">
        ${item('Audit type', type)}
        ${item('Stage', STAGE_LABEL[audit.stage] || audit.stage || '—')}
        ${item('Planned dates', dates)}
        ${item('Report due', audit.report_due ? fmtDate(audit.report_due) : 'Not set')}
        ${audit.previous ? item('Maintenance audit of', audit.previous.ref) : ''}
        ${audit.stage === 'closed' && audit.maintenance_due ? item('Maintenance due', fmtDate(audit.maintenance_due)) : ''}
        ${item('Last update', d.last_update_at ? fmtTs(d.last_update_at) : 'No changes yet')}
      </dl>
      ${_exportRowHtml(audit)}
    </section>`;
  }
  // Release-1 B3.5: Overview (compact and full) offers the workbook per standard — staff only.
  function _exportRowHtml(audit) {
    return audit && _cu() && _cu().role !== 'client' && (audit.standards || []).length ? `<div class="iso-dash-export"><span class="iso-dash-export-k">Export to Excel</span>${(audit.standards || []).map(code => `<button type="button" class="btn btn-ghost btn-sm iso-export-xlsx" data-std="${esc(code)}" title="Gap-analysis workbook for ISO ${esc(code)}" onclick="ISO._exportGapAnalysis(this.dataset.std, this)">ISO ${esc(code)}</button>`).join('')}<button type="button" class="btn btn-ghost btn-sm iso-audit-pack" onclick="ISO._openAuditPack()">On-site audit pack (PDF)</button><button type="button" class="btn btn-teal btn-sm iso-report-open" onclick="ISO._openReport()">Report…</button></div>` : '';
  }
  // Release-1 B3.5: the gap-analysis workbook for one standard, built server-side from the template.
  async function _exportGapAnalysis(std, btn) {
    const audit = _auditCache;
    if (!audit || !std) return;
    if (btn) btn.disabled = true;
    try {
      const res = await api('export.gapAnalysis', { auditId: audit.id, standard: std });
      const bin = atob(res.base64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = res.filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (root.showToast) root.showToast(`Exported ${res.filename} (${res.rows} clauses).`);
    } catch (e) { if (root.showToast) root.showToast('Could not export: ' + e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  // D29: standard only, for now. The code travels in data-std (A81: nothing put into an inline handler).
  function _dashFilterBarHtml(audit, std) {
    const codes = audit.standards || [];
    if (codes.length < 2) return '';
    const btn = (code, label) => `<button type="button" class="iso-dash-std${(std || '') === (code || '') ? ' is-on' : ''}" aria-pressed="${(std || '') === (code || '')}" data-std="${esc(code || '')}"${code ? ` style="--std:${STANDARD_COLOR[code] || '#97bcbd'}"` : ''} onclick="ISO._dashSetStandard(this.dataset.std)">${code ? `<span class="iso-dash-std-dot" aria-hidden="true"></span>` : ''}${esc(label)}</button>`;
    // The standard buttons live in the board header now (one strip for every tab); this only says
    // which one is showing, with a way back to all.
    if (!std) return '';
    return `<div class="iso-dash-filters" role="status">
      ${std ? `<span class="iso-dash-chip">Showing ${esc(stdLabel(std))} only <button type="button" class="iso-dash-chip-x" data-std="" onclick="ISO._dashSetStandard(this.dataset.std)">Clear filter</button></span>` : ''}
    </div>`;
  }
  // Each figure is a real button: keyboard-reachable, and it opens exactly the records it counted. Its
  // name is label + number + detail; the formula is its description, kept outside the button so a
  // screen reader doesn't read the whole sentence as the button's name.
  function _dashKpiHtml(k, stdText) {
    return `<button type="button" class="iso-dash-kpi${k.value === 0 ? ' is-zero' : ''}" data-key="${esc(k.key)}" data-filter="${esc(JSON.stringify(k.filter))}"${k.view ? ` data-view="${esc(k.view)}"` : ''} data-label="${esc(k.label + (stdText ? ' · ' + stdText : ''))}" aria-describedby="iso-dash-kpi-d-${esc(k.key)}" title="${esc(k.formula)}" onclick="ISO._dashOpenFiltered(this)">
      <span class="iso-dash-kpi-label">${esc(k.label)}</span>
      <span class="iso-dash-kpi-value">${esc(k.value == null ? '—' : k.display)}</span>
      ${k.detail ? `<span class="iso-dash-kpi-detail">${esc(k.detail)}</span>` : ''}
    </button>`;
  }
  const KPI_GROUPS = [{ id: 'assessment', label: 'Assessment' }, { id: 'follow_up', label: 'Follow-up work' }];
  function _dashKpiGroupsHtml(kpis, stdText) {
    return KPI_GROUPS.map(g => {
      const items = kpis.filter(k => k.group === g.id);
      return items.length ? `<div class="iso-dash-kpi-group" role="group" aria-label="${esc(g.label)}">
        <div class="iso-dash-kpi-group-h" aria-hidden="true">${esc(g.label)}</div>
        <div class="iso-dash-kpis">${items.map(k => _dashKpiHtml(k, stdText)).join('')}</div>
      </div>` : '';
    }).join('') + `<div class="iso-visually-hidden">${kpis.map(k => `<span id="iso-dash-kpi-d-${esc(k.key)}">${esc(k.formula)} Opens the matching records.</span>`).join('')}</div>`;
  }
  // The formulas, readable without hovering (D28) — the same sentences the tiles carry as descriptions.
  function _dashFormulasHtml(kpis) {
    return `<details class="iso-dash-howto"><summary>How these numbers are calculated</summary>
      <dl>${kpis.map(k => `<div><dt>${esc(k.label)}</dt><dd>${esc(k.formula)}</dd></div>`).join('')}</dl>
    </details>`;
  }
  // ── Assessment results summary (9.6) — promoted out of the small Charts grid below: the brief's own
  // "prominent assessment-results panel", full labels (never truncated the way the 120px-label small
  // charts below must), a bigger bar per result. Reuses req_by_result's own segments/filters — never a
  // second definition of the same numbers, and removed from _dashChartsHtml so it isn't shown twice.
  // Best to worst, then unassessed last — req_by_result's own key order follows row-insertion order
  // (whichever result a scan happens to meet first), which read as a shuffled list in the first visual
  // review; every result display (here and each card's strip) now sorts by this one fixed order.
  const RESULT_DISPLAY_ORDER = ['implemented_effective', 'partially_implemented', 'implemented_ineffective', 'no_evidence_provided', 'not_implemented', 'unassessed'];
  function sortResultSegments(segments) {
    return (segments || []).slice().sort((a, b) => RESULT_DISPLAY_ORDER.indexOf(a.key) - RESULT_DISPLAY_ORDER.indexOf(b.key));
  }
  function _dashResultsSummaryHtml(segments, dataAsAt) {
    const IC = root.IsoCharts;
    const rows = sortResultSegments(segments).filter(s => s.value > 0);
    if (!rows.length) return `<div class="card" style="padding:16px;color:#6b8399;font-size:12px">Not enough assessed requirements yet.</div>`;
    const total = rows.reduce((s, x) => s + x.value, 0);
    const label = key => (IC && IC.labelFor ? IC.labelFor(key) : key);
    const color = key => (IC && IC.RESULT_COLOR && IC.RESULT_COLOR[key]) || '#6b8399';
    const ariaLabel = 'Results by assessment result: ' + rows.map(s => `${label(s.key)} ${s.value}`).join(', ');
    return `<figure class="iso-dash-results" role="img" aria-label="${esc(ariaLabel)}">
      ${rows.map(s => `<button type="button" class="iso-dash-result-row" data-filter="${esc(JSON.stringify(s.filter))}" data-label="${esc(label(s.key))}" onclick="ISO._dashOpenFiltered(this)">
        <span class="iso-dash-result-label">${esc(label(s.key))}</span>
        <span class="iso-dash-result-bar"><span style="width:${Math.round(s.value / total * 100)}%;background:${color(s.key)}"></span></span>
        <span class="iso-dash-result-value">${esc(String(s.value))}</span>
      </button>`).join('')}
      <figcaption class="iso-dash-figcaption">As at ${esc(fmtTs(dataAsAt))}</figcaption>
    </figure>`;
  }

  // ── Standard cards (9.6) — one per board standard, ALWAYS, independent of the top standard filter:
  // these exist specifically for the side-by-side comparison a single-standard view would remove. Each
  // number is one of that standard's own `card.kpis` (dashboard.audit's `cards`, built by calling the
  // exact same buildDashboard scoped to that standard — proven in iso-dashboard-test to equal what the
  // overview shows if that standard were selected there), so a card can never disagree with the band
  // above it. One standard: no card (it would just repeat the KPI band with nothing to compare).
  function _dashCardStatHtml(k, stdText) {
    if (!k || k.value == null) return '';
    return `<button type="button" class="iso-dash-card-stat" data-filter="${esc(JSON.stringify(k.filter))}"${k.view ? ` data-view="${esc(k.view)}"` : ''} data-label="${esc(k.label + (stdText ? ' · ' + stdText : ''))}" title="${esc(k.formula)}" onclick="ISO._dashOpenFiltered(this)">
      <span class="iso-dash-card-stat-label">${esc(k.label)}</span>
      <span class="iso-dash-card-stat-value">${esc(k.display)}</span>
    </button>`;
  }
  function _dashCardResultStripHtml(segments) {
    const IC = root.IsoCharts;
    const rows = sortResultSegments(segments).filter(s => s.value > 0);
    if (!rows.length) return '<div class="iso-dash-card-empty">No results recorded yet.</div>';
    const total = rows.reduce((s, x) => s + x.value, 0);
    const label = key => (IC && IC.labelFor ? IC.labelFor(key) : key);
    const color = key => (IC && IC.RESULT_COLOR && IC.RESULT_COLOR[key]) || '#6b8399';
    return `<div class="iso-dash-card-strip" role="img" aria-label="${esc('Results: ' + rows.map(s => `${label(s.key)} ${s.value}`).join(', '))}">
      <div class="iso-dash-card-strip-bar">${rows.map(s => `<span style="width:${Math.round(s.value / total * 100)}%;background:${color(s.key)}"></span>`).join('')}</div>
      <div class="iso-dash-card-strip-legend">${rows.map(s => `<button type="button" class="iso-dash-card-legend-item" data-filter="${esc(JSON.stringify(s.filter))}" data-label="${esc(label(s.key))}" onclick="ISO._dashOpenFiltered(this)"><span class="iso-dash-card-legend-dot" style="background:${color(s.key)}" aria-hidden="true"></span>${esc(label(s.key))} ${esc(String(s.value))}</button>`).join('')}</div>
    </div>`;
  }
  function _dashCardHtml(card) {
    const code = card.standard, stdText = stdLabel(code);
    const kpi = key => card.kpis.find(k => k.key === key);
    const boardFilter = { entity: 'requirement', where: [{ field: 'standard_code', op: 'eq', value: code }] };
    const base = card.charts.baseline_vs_current && card.charts.baseline_vs_current.data;
    const baseLine = base
      ? `Workbook baseline: ${base.baseline.implemented_effective || 0} of ${base.total} conforming → now ${base.current.implemented_effective || 0} of ${base.total}`
      : 'No workbook baseline for this standard.';
    const section = (title, keys, extra) => `<div class="iso-dash-card-section"><div class="iso-dash-card-section-h">${esc(title)}</div>${extra || ''}<div class="iso-dash-card-stats">${keys.map(k => _dashCardStatHtml(kpi(k), stdText)).join('')}</div></div>`;
    return `<article class="iso-dash-card" style="--std:${STANDARD_COLOR[code] || '#97bcbd'}" aria-labelledby="iso-dash-card-h-${esc(code)}">
      <header class="iso-dash-card-head">
        <span class="iso-dash-card-dot" aria-hidden="true"></span>
        <h4 id="iso-dash-card-h-${esc(code)}">${esc(stdText)}</h4>
        <button type="button" class="btn btn-ghost btn-sm iso-dash-card-open" data-filter="${esc(JSON.stringify(boardFilter))}" data-label="${esc(stdText + ' register')}" onclick="ISO._dashOpenFiltered(this)">Open register</button>
      </header>
      ${section('Coverage', ['req_applicable', 'req_assessed', 'req_not_assessed'])}
      ${section('Results', ['req_conforming', 'req_gaps'], _dashCardResultStripHtml((card.charts.req_by_result && card.charts.req_by_result.segments) || []))}
      ${section('Evidence review', ['req_evidence_to_review'])}
      ${section('Findings & actions', ['findings_open', 'actions_open', 'actions_overdue'])}
      <div class="iso-dash-card-baseline">${esc(baseLine)}</div>
    </article>`;
  }
  function _dashCardsHtml(cards) {
    if (!cards || cards.length < 2) return '';
    return `<section class="iso-dash-section" aria-labelledby="iso-dash-cards-h">
      <h3 id="iso-dash-cards-h" class="iso-dash-section-h">Standards</h3>
      <div class="iso-dash-cards">${cards.map(_dashCardHtml).join('')}</div>
    </section>`;
  }

  // ── Standard × clause matrix (9.6) — always every board standard (same reasoning as the cards above).
  // A derived `clause_family` on every requirement row (requirement.list) lets each cell's filter stay
  // a plain `eq` — the filter schema has no prefix op, and this way it never needs one (A88/A89's note).
  const CLAUSE_FAMILY_LABEL = { '4': 'Context of the organisation', '5': 'Leadership', '6': 'Planning', '7': 'Support', '8': 'Operation', '9': 'Performance evaluation', '10': 'Improvement' };
  const CLAUSE_FAMILIES = ['4', '5', '6', '7', '8', '9', '10'];
  function _dashMatrixCellHtml(cell, code, fam) {
    if (!cell || !cell.total) return '<span class="iso-dash-matrix-empty" aria-hidden="true">—</span>';
    const subParts = [];
    if (cell.gaps) subParts.push(`${cell.gaps} gap${cell.gaps === 1 ? '' : 's'}`);
    if (cell.evidenceToReview) subParts.push(`${cell.evidenceToReview} evidence review`);
    const label = `${stdLabel(code)}, Clause ${fam} (${CLAUSE_FAMILY_LABEL[fam] || ''}): ${cell.assessed} of ${cell.total} assessed` + (subParts.length ? ', ' + subParts.join(', ') : '');
    return `<button type="button" class="iso-dash-matrix-cell" data-filter="${esc(JSON.stringify(cell.filter))}" data-label="${esc(label)}" title="${esc(label)}" onclick="ISO._dashOpenFiltered(this)">
      <span class="iso-dash-matrix-main">${esc(cell.assessed)} of ${esc(cell.total)}</span>
      ${subParts.length ? `<span class="iso-dash-matrix-sub">${esc(subParts.join(' · '))}</span>` : ''}
    </button>`;
  }
  function _dashClauseMatrixHtml(matrix, standards) {
    const codes = (standards || []).filter(c => matrix[c]);
    if (!codes.length) return '<div class="card" style="padding:16px;color:#6b8399;font-size:12px">No clause data yet.</div>';
    return `<div class="iso-dash-matrix-wrap"><table class="iso-dash-matrix" aria-label="Requirements assessed, gaps and evidence to review, by standard and clause">
      <thead><tr><th scope="col">Clause</th>${codes.map(c => `<th scope="col"><span class="iso-dash-matrix-std-dot" style="background:${STANDARD_COLOR[c] || '#97bcbd'}" aria-hidden="true"></span>${esc(stdLabel(c))}</th>`).join('')}</tr></thead>
      <tbody>${CLAUSE_FAMILIES.map(fam => `<tr><th scope="row">Clause ${esc(fam)}<span class="iso-dash-matrix-row-sub">${esc(CLAUSE_FAMILY_LABEL[fam])}</span></th>${codes.map(c => `<td>${_dashMatrixCellHtml((matrix[c] || {})[fam], c, fam)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function _dashChartsHtml(charts, dataAsAt) {
    const IC = root.IsoCharts;
    if (!IC) return '<div class="card" style="padding:16px;color:#b91c1c">The chart library did not load.</div>';
    const bar = (key, title, palette, emptyMessage) => IC.barChart((charts[key] && charts[key].segments) || [], { title: title, dataAsAt: dataAsAt, palette: palette, onClickOp: 'ISO._dashOpenFiltered', emptyMessage: emptyMessage });
    const stacked = (dataMap, title) => IC.stackedBarChart(Object.entries(dataMap || {}).map(([key, segments]) => ({ key, segments })), { title: title, dataAsAt: dataAsAt, palette: IC.RESULT_COLOR });
    const owner = charts.actions_by_owner.data || { etcher: {}, client: {} };
    const ownerGroups = [{ key: 'Etcher', segments: owner.etcher || {} }, { key: 'Client', segments: owner.client || {} }];
    const unitRows = Object.keys(Object.assign({}, charts.progress_by_unit.data, charts.findings_by_unit.data, charts.overdue_by_unit.data));
    const unitName = id => { const u = (charts.progress_by_unit.units || []).find(x => x.id === id); return u ? `${u.name} (${u.kind})` : id; };
    // The whole board's (or, with a standard selected, that standard's) original assessment against
    // today (9.4). Kept here even though 9.6's cards show the same comparison per standard too — a
    // single-standard board has no cards at all, and this is the only place it would otherwise appear.
    const base = charts.baseline_vs_current && charts.baseline_vs_current.data;
    const baselineChart = IC.stackedBarChart(base ? [{ key: (_auditCache && _auditCache.previous_audit_id) ? 'Last audit' : 'Workbook baseline', segments: base.baseline }, { key: 'Now', segments: base.current }] : [], { title: (_auditCache && _auditCache.previous_audit_id) ? 'Last audit vs now' : 'Workbook baseline vs now', dataAsAt: dataAsAt, palette: IC.RESULT_COLOR, emptyMessage: 'No workbook was imported on this board, so there is no baseline to compare.' });
    // req_by_result is promoted to its own prominent section above (9.6) — not repeated here.
    return `<div class="iso-dash-charts">
      ${baselineChart}
      ${bar('req_by_state', 'Assessment status distribution', IC.STATE_COLOR)}
      ${stacked(charts.req_by_result_by_standard.data, 'Results by standard')}
      ${stacked(charts.req_by_result_by_clause.data, 'Results by clause')}
      ${bar('findings_by_classification', 'Findings by classification', IC.CLASS_COLOR, 'No findings raised on this board yet')}
      ${bar('actions_by_status', 'Actions by status', IC.ACTION_STATUS_COLOR, 'No actions created on this board yet')}
      ${IC.stackedBarChart(ownerGroups, { title: 'Actions by owner (open)', dataAsAt: dataAsAt })}
      ${IC.heatGrid(Object.keys(charts.risk_distribution.data || {}), [...new Set(Object.values(charts.risk_distribution.data || {}).flatMap(m => Object.keys(m)))], (r, c) => ((charts.risk_distribution.data || {})[r] || {})[c], { title: 'Risk heat map (severity × finding type)', dataAsAt: dataAsAt, rowPalette: IC.RISK_COLOR })}
      ${IC.barChart(unitRows.map(id => ({ key: id, label: unitName(id), value: (charts.progress_by_unit.data[id] || {}).pct || 0 })), { title: 'Progress by site / department / process (%)', dataAsAt: dataAsAt, emptyMessage: 'No units defined for this audit yet' })}
      ${IC.barChart(Object.entries(charts.progress_by_owner.data || {}).map(([uid, v]) => ({ key: uid, label: reqOwnerName(uid) || uid, value: v.pct })), { title: 'Progress by owner (%)', dataAsAt: dataAsAt, emptyMessage: 'No requirements have an assigned owner yet' })}
      ${IC.barChart(unitRows.map(id => ({ key: id, label: unitName(id), value: charts.overdue_by_unit.data[id] || 0 })), { title: 'Overdue actions by unit', dataAsAt: dataAsAt, emptyMessage: 'No overdue actions' })}
      ${IC.barChart(unitRows.map(id => ({ key: id, label: unitName(id), value: charts.findings_by_unit.data[id] || 0 })), { title: 'Findings by unit', dataAsAt: dataAsAt, emptyMessage: 'No findings attributed to a unit yet' })}
      ${IC.progressLine((charts.progress_over_time.data || []).map(p => ({ day: p.day, value: p.conforming })), { title: 'Conforming requirements over time', dataAsAt: dataAsAt })}
    </div>`;
  }
  function _dashUpcomingHtml(deadlines, dataAsAt) {
    if (!deadlines || !deadlines.length) return `<div class="card iso-dash-upcoming" style="padding:12px 16px;color:#6b8399;font-size:12px">No upcoming action deadlines.</div>`;
    return `<div class="card iso-dash-upcoming" style="padding:14px 16px">
      <h3 class="iso-dash-section-h" style="margin:0 0 8px">Upcoming deadlines</h3>
      ${deadlines.map(d => `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #f4f6fa;font-size:12px"><span>${esc(d.ref)} — ${esc(d.title)}</span><span style="color:#5a7186;white-space:nowrap">${esc(fmtDate(d.due_date))}</span></div>`).join('')}
      <div style="font-size:10px;color:#6b8399;margin-top:8px">As at ${esc(fmtTs(dataAsAt))}</div>
    </div>`;
  }
  // ── 9.7: dashboard stage 3 panels ───────────────────────────────────────────────────────────
  // A filter for exactly one record — an item inside a panel opens just that row in its register.
  const _dashOneFilter = it => JSON.stringify({ entity: it.entity, where: [{ field: 'id', op: 'eq', value: it.id }] });
  const _dashStdChip = code => code ? `<span class="iso-std-chip iso-dash-mini-chip" style="--std:${STANDARD_COLOR[code] || '#6b8399'}" title="${esc(stdLabel(code))}">${esc(STANDARD_BADGE[code] || '•')}</span>` : '';
  // D31: on a maintenance board, one line on what came over — so nobody mistakes it for new work.
  function _dashCarriedHtml(c) {
    if (!c) return '';
    return `<div class="iso-dash-carried" role="note"><span aria-hidden="true">↻</span> Maintenance audit of <strong>${esc(c.previous || 'the previous board')}</strong> — last audit's results are this board's baseline (${esc(c.baseline)} clauses); ${esc(c.findings)} open finding${c.findings === 1 ? '' : 's'} and ${esc(c.actions)} open action${c.actions === 1 ? '' : 's'} carried over; ${esc(c.evidence)} accepted evidence record${c.evidence === 1 ? '' : 's'} offered as suggestions.</div>`;
  }
  function _dashAttentionHtml(p) {
    const cats = (p && p.attention) || [];
    if (!cats.length) return `<section class="iso-dash-section" aria-labelledby="iso-dash-attn-h"><h3 id="iso-dash-attn-h" class="iso-dash-section-h">Needs attention</h3><div class="iso-attn-empty">Nothing needs attention right now.</div></section>`;
    return `<section class="iso-dash-section" aria-labelledby="iso-dash-attn-h">
      <h3 id="iso-dash-attn-h" class="iso-dash-section-h">Needs attention</h3>
      <ul class="iso-attn-list">${cats.map(c => `<li class="iso-attn-row" data-key="${esc(c.key)}">
        <button type="button" class="iso-attn-head" data-filter="${esc(JSON.stringify(c.filter))}"${c.view ? ` data-view="${esc(c.view)}"` : ''} data-label="${esc(c.label)}" onclick="ISO._dashOpenFiltered(this)">
          <span class="iso-attn-count">${esc(c.count)}</span><span class="iso-attn-label">${esc(c.label)}</span><span class="iso-attn-go" aria-hidden="true">›</span>
        </button>
        <div class="iso-attn-items">${c.items.map(it => `<button type="button" class="iso-attn-item" data-filter="${esc(_dashOneFilter(it))}" data-label="${esc(it.label)}" onclick="ISO._dashOpenFiltered(this)">${_dashStdChip(it.standard_code)}<span>${esc(it.label)}</span>${it.due_date ? `<span class="iso-attn-meta">due ${esc(fmtDate(it.due_date))}</span>` : ''}</button>`).join('')}${c.count > c.items.length ? `<span class="iso-attn-more">+${c.count - c.items.length} more</span>` : ''}</div>
      </li>`).join('')}</ul>
    </section>`;
  }
  const _dashTilesHtml = (tiles, noun) => `<div class="iso-panel-tiles">${tiles.map(t => `<button type="button" class="iso-panel-tile${t.value ? '' : ' is-zero'}" data-key="${esc(t.key)}" data-filter="${esc(JSON.stringify(t.filter))}" data-label="${esc(t.label + ' ' + noun)}" onclick="ISO._dashOpenFiltered(this)"><span class="iso-panel-tile-v">${esc(t.value)}</span><span class="iso-panel-tile-l">${esc(t.label)}</span></button>`).join('')}</div>`;
  function _dashWorkPanelsHtml(p) {
    if (!p) return '';
    return `<section class="iso-dash-section iso-panels" aria-label="Findings and actions">
      <div class="iso-panel iso-panel-findings"><h3 class="iso-dash-section-h">Findings</h3>${_dashTilesHtml(p.findings_panel, 'findings')}</div>
      <div class="iso-panel iso-panel-actions"><h3 class="iso-dash-section-h">Actions</h3>${_dashTilesHtml(p.actions_panel, 'actions')}</div>
    </section>`;
  }
  function _dashSharedHtml(p) {
    const sh = p && p.shared_actions;
    if (!sh) return '';
    const head = `<div class="iso-dash-section-row"><h3 id="iso-dash-shared-h" class="iso-dash-section-h">Shared actions <span class="iso-dash-count">${esc(sh.total)}</span></h3>${sh.total ? `<button type="button" class="iso-tb-btn iso-shared-all" data-filter="${esc(JSON.stringify(sh.filter))}" data-label="Shared actions" onclick="ISO._dashOpenFiltered(this)">View all</button>` : ''}</div>`;
    if (!sh.total) return `<section class="iso-dash-section" aria-labelledby="iso-dash-shared-h">${head}<div class="iso-attn-empty">No action covers more than one standard yet — one fix for several standards shows up here.</div></section>`;
    const byStd = reqs => { const g = new Map(); for (const r of reqs) { if (!g.has(r.standard_code)) g.set(r.standard_code, []); g.get(r.standard_code).push(r.clause); } return [...g.entries()].map(([c, cl]) => `<span class="iso-shared-std" style="--std:${STANDARD_COLOR[c] || '#6b8399'}">${_dashStdChip(c)}${esc(cl.join(', '))}</span>`).join(''); };
    return `<section class="iso-dash-section" aria-labelledby="iso-dash-shared-h">${head}
      <div class="iso-shared-wrap"><table class="iso-shared-table"><thead><tr><th scope="col">Action</th><th scope="col">Clauses covered</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
      <tbody>${sh.rows.map(r => `<tr class="iso-shared-row${r.overdue ? ' is-overdue' : ''}" data-iact="${esc(r.id)}">
        <td><button type="button" class="iso-shared-open" data-filter="${esc(_dashOneFilter({ entity: 'action', id: r.id }))}" data-label="${esc((r.ref ? r.ref + ' — ' : '') + r.title)}" onclick="ISO._dashOpenFiltered(this)"><strong>${esc(r.ref || '')}</strong> ${esc(r.title)}</button></td>
        <td class="iso-shared-clauses">${byStd(r.requirements)}</td>
        <td>${r.owner_uid ? esc(reqOwnerName(r.owner_uid) || _uidName(r.owner_uid) || '—') : '<span class="iso-cell-default">Unassigned</span>'}</td>
        <td>${r.due_date ? `<span${r.overdue ? ' class="iso-shared-late"' : ''}>${esc(fmtDate(r.due_date))}</span>` : '<span class="iso-cell-default">—</span>'}</td>
        <td>${actPill(ACTION_STATUS_LABEL[r.status] || r.status, actStatusColor(r.status))}</td>
      </tr>`).join('')}</tbody></table></div>
      ${sh.total > sh.rows.length ? `<div class="iso-attn-more">Showing ${sh.rows.length} of ${sh.total} — View all for the rest.</div>` : ''}
    </section>`;
  }
  // Evidence: the figures, and one way into the Evidence tab's queue — the decisions stay there.
  function _dashEvidencePanelHtml(charts) {
    const e = (charts && charts.evidence_status && charts.evidence_status.data) || {};
    const fig = (k, label) => `<div class="iso-evd-fig${e[k] ? '' : ' is-zero'}" data-key="${k}"><span class="iso-panel-tile-v">${esc(e[k] || 0)}</span><span class="iso-panel-tile-l">${esc(label)}</span></div>`;
    return `<section class="iso-dash-section" aria-labelledby="iso-dash-evd-h">
      <div class="iso-dash-section-row"><h3 id="iso-dash-evd-h" class="iso-dash-section-h">Evidence</h3><button type="button" class="iso-tb-btn iso-evd-queue" onclick="ISO.setTab('evidence')">Open the evidence queue ›</button></div>
      <div class="iso-panel-tiles">${fig('to_review', 'To review')}${fig('suggested', 'Suggested')}${fig('accepted', 'Accepted')}${fig('partial', 'Partially sufficient')}${fig('insufficient', 'Insufficient')}</div>
    </section>`;
  }
  const DASH_ACTIVITY_LABEL = { created: 'created', updated: 'updated', bulk_updated: 'updated in bulk', commented: 'commented on', senior_review_compliant: 'gave Compliant to', senior_review_partially_compliant: 'gave Partially compliant to', senior_review_non_compliant: 'gave Non-compliant to', senior_review_na_confirmed: 'confirmed N/A for', senior_review_redo: 'sent back', senior_review_pending: 'reset the senior review of', evidence_linked: 'linked evidence to', evidence_reviewed: 'reviewed evidence for', linked: 'linked', unlinked: 'unlinked' };
  function _dashActivityHtml(p) {
    const rows = (p && p.recent_activity) || [];
    return `<section class="iso-dash-section" aria-labelledby="iso-dash-act-h">
      <h3 id="iso-dash-act-h" class="iso-dash-section-h">Recent activity</h3>
      ${rows.length ? `<ol class="iso-activity-list">${rows.map(a => {
        const who = a.actor_kind === 'system' ? 'System' : (_uidName(a.actor_uid) || (a.actor_kind === 'client' ? 'Client' : 'Someone'));
        const what = DASH_ACTIVITY_LABEL[a.action] || String(a.action || '').replace(/_/g, ' ');
        const ref = a.entity_ref || a.entity_type || '';
        return `<li class="iso-activity-row"><span class="iso-activity-time">${esc(fmtTs(a.at))}</span><span class="iso-activity-text"><strong>${esc(who)}</strong> ${esc(what)} <span class="iso-activity-ref">${esc(ref)}</span></span></li>`;
      }).join('')}</ol>` : '<div class="iso-attn-empty">Nothing has changed on this board yet.</div>'}
    </section>`;
  }

  // ── R5: Overview — the new simple landing page (wireframe's own), now what the "Dashboard" tab
  // opens on by default. The old multi-section dashboard (renderDashboardTab/fillDashboardTab,
  // directly below, entirely untouched) stays exactly as it was, one click away behind "Full
  // dashboard" — same tab, same route.tab value ('dashboard'), just a client-side mode toggle
  // (_dash.mode), so no routing/URL/session-storage shape changes at all. Reuses the existing
  // dashboard.audit op's own `cards` (one per standard, already computed) and `panels` (Actions due
  // soon) wholesale — nothing here adds a new metric to _isoCalc.js. document.list (R4) powers
  // "Collect next"; requirement.list's own compliance_status/approval_state power "Needs attention"
  // and the sign-off banner with categories the old dashboard's own attention panel doesn't carry
  // (Non-Compliant, Missing a planned action — new-model concepts, R2).
  let _ov = { auditId: null, dash: null, reqs: null, docs: null };
  function _ovShowFull() { _dash.mode = 'full'; if (_auditCache) fillDashboardTab(_auditCache); }
  function _ovShowOverview() { _dash.mode = 'overview'; if (_auditCache) fillOverviewTab(_auditCache); }
  async function fillOverviewTab(audit) {
    const host = document.getElementById('iso-dash-tab');
    if (!host) return;
    let dash, reqs, docs;
    try {
      [dash, reqs, docs] = await Promise.all([
        api('dashboard.audit', { auditId: audit.id }),
        api('requirement.list', { auditId: audit.id }),
        api('document.list', { auditId: audit.id }).catch(() => []),
      ]);
    } catch (e) {
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load the overview: ${esc(e.message)}</div>`;
      return;
    }
    _ov = { auditId: audit.id, dash: dash, reqs: reqs || [], docs: docs || [] };
    renderOverviewTab(audit.id);
  }
  function renderOverviewTab(auditId) {
    const host = document.getElementById('iso-dash-tab');
    if (!host || _ov.auditId !== auditId || !_auditCache) return;
    const { dash, reqs, docs } = _ov;
    host.innerHTML = ovSignoffHtml(reqs)
      + ovProgressHtml(dash.cards, reqs.length, reqs)
      + `<div class="iso-ov-two">${ovAttentionHtml(reqs, dash)}${ovCollectHtml(docs)}</div>`
      + ovDeliverHtml(_auditCache)
      + `<button type="button" class="iso-ov-fulldash" onclick="ISO._ovShowFull()"><span><b>Full dashboard</b> — KPIs, charts, clause matrix and activity</span><span aria-hidden="true">›</span></button>`;
  }
  // What goes to the client, as three tiles with a line on what each is (2026-10-14) — replaces the
  // loose button row that sat under the Full dashboard link. Staff only, like the row it replaces.
  function ovDeliverHtml(audit) {
    if (!audit || !_cu() || _cu().role === 'client' || !(audit.standards || []).length) return '';
    const ic = d => `<span class="iso-ov-dv-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;
    const DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>';
    const GRID = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>';
    const CLIP = '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10l1.5 1.5L13 9M9 15h6"/>';
    return `<section class="iso-ov-section iso-ov-deliver" aria-labelledby="iso-ov-deliver-h">
      <h2 class="iso-ov-h2" id="iso-ov-deliver-h">Reports and exports <span class="muted">what goes to the client</span></h2>
      <div class="iso-ov-dv-grid">
        <div class="iso-ov-dv">
          <div class="iso-ov-dv-top">${ic(DOC)}<div><div class="iso-ov-dv-t">Audit report</div><div class="iso-ov-dv-s">Etcher-branded PDF — issue, reissue and record the client's acknowledgement.</div></div></div>
          <div class="iso-ov-dv-acts"><button type="button" class="btn btn-teal btn-sm iso-report-open" onclick="ISO._openReport()">Open report</button></div>
        </div>
        <div class="iso-ov-dv">
          <div class="iso-ov-dv-top">${ic(GRID)}<div><div class="iso-ov-dv-t">Gap-analysis workbook</div><div class="iso-ov-dv-s">Excel on the Etcher template, one per standard.</div></div></div>
          <div class="iso-ov-dv-acts iso-dash-export">${(audit.standards || []).map(code => `<button type="button" class="btn btn-ghost btn-sm iso-export-xlsx" data-std="${esc(code)}" title="Gap-analysis workbook for ISO ${esc(code)}" onclick="ISO._exportGapAnalysis(this.dataset.std, this)">ISO ${esc(code)}</button>`).join('')}</div>
        </div>
        <div class="iso-ov-dv">
          <div class="iso-ov-dv-top">${ic(CLIP)}<div><div class="iso-ov-dv-t">On-site audit pack</div><div class="iso-ov-dv-s">Printable PDF to take on site for interviews and sampling.</div></div></div>
          <div class="iso-ov-dv-acts"><button type="button" class="btn btn-ghost btn-sm iso-audit-pack" onclick="ISO._openAuditPack()">Download PDF</button></div>
        </div>
      </div>
    </section>`;
  }
  function _ovFilterBtn(cls, filter, view, label, inner) {
    return `<button type="button" class="${cls}" data-filter="${esc(JSON.stringify(filter))}"${view ? ` data-view="${esc(view)}"` : ''} data-label="${esc(label)}" onclick="ISO._dashOpenFiltered(this)">${inner}</button>`;
  }
  function ovSignoffHtml(reqs) {
    if (_isSoleAssessorLocal()) return ''; // D41: a sole auditor's statuses are final on entry — nothing to sign off
    const lead = canApproveRequirementLocally();
    if (lead) {
      const proposed = reqs.filter(r => r.approval_state === 'proposed');
      if (!proposed.length) return `<div class="card iso-ov-signoff is-quiet"><div class="iso-ov-signoff-txt"><strong>Everything proposed is signed off.</strong>New proposals from other auditors appear here.</div></div>`;
      const byStd = {};
      for (const r of proposed) byStd[r.standard_code] = (byStd[r.standard_code] || 0) + 1;
      const who = [...new Set(proposed.map(r => _uidName(r.assessed_by)).filter(Boolean))];
      const whoText = who.length === 1 ? `Proposed by ${who[0]}` : who.length ? `Proposed by ${who.length} auditors` : 'Proposed';
      const perStd = STANDARD_ORDER.filter(s => byStd[s]).map(s => `${stdLabel(s)} ${byStd[s]}`).join(' · ');
      return `<div class="card iso-ov-signoff">
        <div class="iso-ov-signoff-txt"><strong>${esc(proposed.length)} status${proposed.length === 1 ? '' : 'es'} ready for your sign-off</strong>${esc(whoText)}${perStd ? ' · ' + esc(perStd) : ''}</div>
        ${_ovFilterBtn('btn btn-teal iso-ov-signoff-btn', { entity: 'requirement', where: [] }, 'approval_awaiting', 'Awaiting your approval', 'Review and sign off ›')}
      </div>`;
    }
    const me = (_cu() || {}).id;
    const mine = r => srIsMine(r.assessed_by);
    const returned = reqs.filter(r => r.approval_state === 'returned' && mine(r));
    const proposedMine = reqs.filter(r => r.approval_state === 'proposed' && mine(r)).length;
    if (!returned.length) return `<div class="card iso-ov-signoff is-quiet"><div class="iso-ov-signoff-txt"><strong>Nothing returned to you.</strong>${esc(proposedMine)} of your statuses ${proposedMine === 1 ? 'is' : 'are'} waiting for the Lead Auditor's sign-off.</div></div>`;
    return `<div class="card iso-ov-signoff">
      <div class="iso-ov-signoff-txt"><strong>${esc(returned.length)} returned to you</strong>${esc(proposedMine)} of your statuses are waiting for the Lead Auditor's sign-off.</div>
      ${_ovFilterBtn('btn btn-teal iso-ov-signoff-btn', { entity: 'requirement', where: [] }, 'returned', 'Returned', 'See returned ›')}
    </div>`;
  }
  // Wireframe std-col: the five clause statuses (not the old workbook result labels) — an 8px stacked
  // bar and a legend, counted from the clauses themselves.
  function ovStatusStripHtml(rows) {
    const n = rows.length || 1, cnt = {};
    rows.forEach(r => { const st = r.compliance_status || 'not_assessed'; cnt[st] = (cnt[st] || 0) + 1; });
    const order = COMPLIANCE_STATUSES.filter(st => st !== 'not_assessed');
    const bar = order.filter(st => cnt[st]).map(st => `<i style="width:${cnt[st] / n * 100}%;background:${complianceColor(st)}"></i>`).join('');
    const ofiN = rows.filter(r => r.ofi && (r.compliance_status === 'compliant' || r.compliance_status === 'partially_compliant')).length; // D44: OFI is counted from the flag
    const legend = order.filter(st => cnt[st]).map(st => `<span><i class="iso-ov-ldot" style="--c:${complianceColor(st)}"></i>${esc(complianceLabel(st))} ${cnt[st]}</span>`).join('')
      + (ofiN ? `<span><i class="iso-ov-ldot" style="--c:${complianceColor('ofi')}"></i>OFI ${ofiN}</span>` : '')
      + (cnt.not_assessed ? `<span><i class="iso-ov-ldot is-na"></i>Not assessed ${cnt.not_assessed}</span>` : '');
    return `<span class="iso-stack iso-ov-stack" aria-hidden="true">${bar}</span><span class="iso-ov-legend">${legend}</span>`;
  }
  function ovProgressHtml(cards, totalReqs, reqs) {
    const std = boardStd();
    const shown = (cards || []).filter(c => !std || c.standard === std);
    if (!shown.length) return '';
    const cols = shown.map(card => {
      const code = card.standard;
      const kpi = k => (card.kpis || []).find(x => x.key === k);
      const assessed = kpi('req_assessed'), total = kpi('req_applicable');
      const boardFilter = { entity: 'requirement', where: [{ field: 'standard_code', op: 'eq', value: code }] };
      return `<div class="iso-ov-stdcol" style="--std:${STANDARD_COLOR[code] || '#97bcbd'}">
        ${_ovFilterBtn('iso-ov-stdcol-open', boardFilter, null, stdLabel(code) + ' register', `<span class="iso-ov-stdcol-top"><span class="iso-tag" style="--std:${STANDARD_COLOR[code] || '#97bcbd'}">${esc(STANDARD_BADGE[code] || '•')}</span><h3>${esc(stdLabel(code))}</h3></span><span class="iso-ov-stdcol-big">${esc(assessed ? assessed.value : 0)}<small>of ${esc(total ? total.value : 0)} assessed</small></span>`)}
        ${ovStatusStripHtml((reqs || []).filter(r => r.standard_code === code))}
      </div>`;
    }).join('');
    return `<div class="iso-ov-section"><h2 class="iso-ov-h2">Progress ${shown.length > 1 ? `<span class="muted">${esc(totalReqs)} clauses across ${shown.length} standards</span>` : ''}</h2><div class="iso-ov-stdband">${cols}</div></div>`;
  }
  function ovAttentionHtml(reqs, dash) {
    const nc = reqs.filter(r => r.compliance_status === 'non_compliant');
    const missingPlan = reqs.filter(r => needsAction(r) && !(r.recommended_action || '').trim());
    const dueSoonTile = ((dash.panels && dash.panels.actions_panel) || []).find(t => t.key === 'due_soon');
    const notAssessed = reqs.filter(r => !r.compliance_status || r.compliance_status === 'not_assessed');
    const items = [];
    if (nc.length) items.push({ label: 'Non-Compliant clauses', sub: 'Each needs a planned action', n: nc.length, filter: { entity: 'requirement', where: [{ field: 'compliance_status', op: 'eq', value: 'non_compliant' }] }, view: null });
    if (missingPlan.length) items.push({ label: 'Missing a planned action', sub: 'Partial, Non-Compliant or OFI without one', n: missingPlan.length, filter: { entity: 'requirement', where: [] }, view: 'needs_action' });
    if (dueSoonTile && dueSoonTile.value) items.push({ label: `Actions due in ${(dash.panels && dash.panels.due_soon_days) || 14} days`, sub: 'Across all standards', n: dueSoonTile.value, filter: dueSoonTile.filter, view: null, entity: 'action' });
    if (notAssessed.length) items.push({ label: 'Not assessed yet', sub: 'Start with the documents below — each one covers many clauses', n: notAssessed.length, filter: { entity: 'requirement', where: [] }, view: 'not_assessed' });
    if (!items.length) return `<div class="iso-ov-col"><h2 class="iso-ov-h2">Needs attention</h2><div class="iso-ov-empty">Nothing needs attention right now.</div></div>`;
    return `<div class="iso-ov-col"><h2 class="iso-ov-h2">Needs attention</h2><div class="iso-ov-list">${items.map(it => _ovFilterBtn('iso-ov-li', it.filter, it.view, it.label, `<span class="iso-ov-li-txt"><span class="iso-ov-li-t">${esc(it.label)}</span><span class="iso-ov-li-s">${esc(it.sub)}</span></span><span class="iso-ov-li-go">${esc(it.n)} ›</span>`)).join('')}</div></div>`;
  }
  function ovCollectHtml(docs) {
    const missing = (docs || []).filter(d => d.providedCount === 0).slice(0, 5);
    if (!missing.length) return '<div class="iso-ov-col"><h2 class="iso-ov-h2">Collect next</h2><div class="iso-ov-empty">Every suggested document has at least one copy on this board.</div></div>';
    const serves = d => {
      const byStd = {};
      for (const c of d.clauses) byStd[c.standardCode] = (byStd[c.standardCode] || 0) + 1;
      return STANDARD_ORDER.filter(s => byStd[s]).map(s => `<span class="iso-ov-serve"><span class="iso-tag" style="--std:${STANDARD_COLOR[s] || '#97bcbd'}">${esc(STANDARD_BADGE[s] || '•')}</span>${byStd[s]}</span>`).join('');
    };
    return `<div class="iso-ov-col"><h2 class="iso-ov-h2">Collect next <span class="muted">most clauses per document</span></h2><div class="iso-ov-list">${missing.map(d => `
      <div class="iso-ov-li iso-ov-li-doc">
        <span class="iso-ov-li-txt"><span class="iso-ov-li-t">${esc(d.name)}</span><span class="iso-ov-li-s">Covers ${esc(d.totalCount)} clause${d.totalCount === 1 ? '' : 's'} ${serves(d)}</span></span>
        <button type="button" class="btn btn-sm btn-ghost" data-doc="${esc(d.name)}" onclick="ISO._docOpenAdd(this)">+ Add</button>
      </div>`).join('')}</div></div>`;
  }
  // ── Add a document / Edit links (wireframe's side sheet, one form for Overview and Documents) ─────
  // Document → its clauses arrive pre-ticked from Column P → untick exceptions → one call (P5). A
  // document already on the board opens as "Edit links": its linked clauses stay ticked (there is no
  // evidence unlink op — removing a link stays the Evidence tab's own Reject), new ticks link the same
  // evidence record (evidence.link), so one document is never collected twice. The document's name
  // travels in data-doc, never inside an inline handler (A81).
  let _da = null; // { name, custom, doc, extra: Set(requirementId), q }
  function _docFind(name) {
    const pools = [(_docs && _docs.docs) || [], (_ov && _ov.docs) || [], (_req && _req.docs) || []];
    for (const p of pools) { const d = p.find(x => x.name === name); if (d) return d; }
    return null;
  }
  function _docReqs() {
    if (_docs && _docs.reqs && _docs.reqs.length) return _docs.reqs;
    if (_ov && _ov.reqs && _ov.reqs.length) return _ov.reqs;
    return (_req && _req.requirements) || [];
  }
  function _docAuditId() { return _auditCache ? _auditCache.id : (_docs.auditId || _ov.auditId); }
  function _docOpenAdd(el) { _docOpenForm(el.dataset.doc, false); }
  function _ovOpenDocAdd(name) { _docOpenForm(name, false); } // kept: older callers/tests
  function _docOpenForm(name, custom, ctxReqId) {
    const doc = _docFind(name);
    _da = { name: name, custom: !!(custom || (doc && doc.custom) || !doc), doc: doc, extra: new Set(), sug: new Set(), on: new Set(), q: '', ctx: ctxReqId || null };
    // Opened from a clause: that clause is ticked whatever the document; a custom document also lists
    // the clause's related clauses (Column P), unticked — "related clauses are suggested".
    if (ctxReqId) {
      _da.on.add(ctxReqId);
      if (!(doc && doc.clauses.some(c => c.requirementId === ctxReqId))) _da.extra.add(ctxReqId);
      if (_da.custom) ((_req.relLibrary || {})[ctxReqId] || []).filter(x => !x.rejected).forEach(x => { _da.extra.add(x.requirementId); _da.sug.add(x.requirementId); });
    }
    const editing = !!(doc && doc.latest);
    root.openGenericModal(editing ? 'Edit links' : 'Add document', `
      <div class="iso-da">
        <p class="iso-da-doc"><b>${esc(name)}</b><span class="iso-keyflag">${_da.custom ? 'Custom document' : 'From the register'}</span></p>
        ${editing ? `<p class="muted iso-da-rev">On this board: ${esc([doc.latest.versionLabel, doc.latest.evidenceDate ? fmtDate(doc.latest.evidenceDate) : null].filter(Boolean).join(' · ') || 'provided')}</p>` : `
        <div class="iso-field-grid">
          <input type="hidden" id="ovda-title" value="${esc(name)}"/>
          <label style="grid-column:1/-1">File or link<input class="form-input" id="ovda-url" placeholder="Paste a SharePoint or https:// link"/></label>
          <label>Revision<input class="form-input" id="ovda-version" placeholder="e.g. Rev 3"/></label>
          <label>Date<input type="date" class="form-input" id="ovda-date"/></label>
        </div>`}
        <div class="iso-da-ckhead"><span class="iso-clause-col-label">Clauses it supports</span><span class="muted">${_da.custom ? 'Pick the clauses this document supports.' : 'Pre-ticked from the register — untick any that don\'t apply.'}</span></div>
        <div class="iso-ov-doc-clauses" id="iso-da-groups"></div>
        <label class="iso-search iso-da-addcl"><span aria-hidden="true">+</span><input type="search" id="iso-da-cq" placeholder="Add another clause — number or name" autocomplete="off" oninput="ISO._docAddClauseSearch(this.value)"/></label>
        <div id="iso-da-hits"></div>
        <p class="iso-da-warn" id="iso-da-warn" role="alert" hidden></p>
        <div class="iso-da-foot"><span class="muted" id="iso-da-sum"></span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('generic-modal').classList.add('hidden')">Cancel</button>
          <button type="button" class="btn btn-teal btn-sm iso-da-save" onclick="ISO._ovDocAddApply()">${editing ? 'Save links' : 'Link'}</button></div>
      </div>`, '600px');
    _docRenderGroups();
  }
  function _docFormRows() {
    const base = (_da.doc && _da.doc.clauses) || [];
    const seen = new Set(base.map(c => c.requirementId));
    const extra = _docReqs().filter(r => _da.extra.has(r.id) && !seen.has(r.id)).map(r => ({ requirementId: r.id, standardCode: r.standard_code, clause: r.clause, clauseName: r.clause_name, provided: false, added: true }));
    return base.concat(extra);
  }
  function _docRenderGroups() {
    const host = document.getElementById('iso-da-groups');
    if (!host || !_da) return;
    const rows = _docFormRows();
    // Ticks survive a re-render (adding a clause re-draws the groups).
    const prev = new Map([...host.querySelectorAll('input[type=checkbox]')].map(cb => [cb.value, cb.checked]));
    host.innerHTML = STANDARD_ORDER.map(s => {
      const g = rows.filter(c => c.standardCode === s).sort((a, b) => reqClauseCompare({ clause: a.clause }, { clause: b.clause }));
      if (!g.length) return '';
      return `<div class="iso-da-group"><div class="iso-da-gh"><span class="iso-tag" style="--std:${STANDARD_COLOR[s] || '#97bcbd'}">${esc(STANDARD_BADGE[s] || '•')}</span><b>${esc(stdLabel(s))}</b><button type="button" class="linkbtn" data-std="${esc(s)}" onclick="ISO._docTickAll(this.dataset.std)">Tick all</button></div>
        ${g.map(c => { const on = c.provided || (prev.has(c.requirementId) ? prev.get(c.requirementId) : (_da.on.has(c.requirementId) || (_da.sug.has(c.requirementId) ? false : (c.added || (!_da.custom && !(_da.doc && _da.doc.latest)))))); return `<div class="iso-da-row">${_docStatusPickHtml(c)}<label class="iso-apply-item"><input type="checkbox" data-std="${esc(c.standardCode)}" value="${esc(c.requirementId)}" ${on ? 'checked' : ''} ${c.provided ? 'data-linked="1"' : ''} onchange="ISO._docUpdateSum()"/> ${esc(c.clause)} ${esc(c.clauseName || '')}${c.provided ? ' <span class="muted">(linked)</span>' : _da.sug.has(c.requirementId) ? ' <span class="muted">Related — may also apply</span>' : ''}</label></div>`; }).join('')}</div>`;
    }).join('') || '<p class="muted">No clauses yet — search below to add the ones it supports.</p>';
    _docUpdateSum();
  }
  // B1.8: conclude while linking. Compliant · Partial · Non-Compliant · OFI per clause (N/A needs a
  // written reason, so it stays on the clause itself). The clause's current status shows as chosen.
  const DA_STATUSES = [['compliant', 'C', 'Compliant'], ['partially_compliant', 'PC', 'Partially Compliant'], ['non_compliant', 'NC', 'Non-Compliant'], ['ofi', 'OFI', 'Compliant · OFI']];
  function _docCurrentStatus(id) {
    const r = _docReqs().find(x => x.id === id);
    if (!r) return null;
    return r.compliance_status === 'compliant' && r.ofi ? 'ofi' : r.compliance_status;
  }
  function _docStatusPickHtml(c) {
    const chosen = (_da.st && _da.st[c.requirementId]) || _docCurrentStatus(c.requirementId);
    const g = (_req.auditId === _docAuditId() && _req.guidance) ? _req.guidance[c.requirementId] : null;
    return `<span class="iso-da-st" role="radiogroup" aria-label="Status for ${esc(c.clause)}">${g ? reqCheatSheetBtnHtml({ id: c.requirementId, clause: c.clause }) : ''}${DA_STATUSES.map(([v, short, full]) => `<button type="button" role="radio" class="iso-da-st-btn${chosen === v ? ' is-active' : ''}" aria-checked="${chosen === v}" title="${esc(full)}" style="--c:${complianceColor(v)}" data-id="${esc(c.requirementId)}" data-v="${v}" onclick="ISO._docPickStatus(this)">${short}</button>`).join('')}</span>`;
  }
  function _docPickStatus(el) {
    if (!_da) return;
    _da.st = _da.st || {};
    _da.st[el.dataset.id] = el.dataset.v;
    el.parentElement.querySelectorAll('.iso-da-st-btn').forEach(b => { const on = b === el; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', String(on)); });
  }
  function _docTickAll(std) {
    const boxes = [...document.querySelectorAll(`#iso-da-groups input[type=checkbox][data-std="${std}"]:not([disabled])`)];
    const all = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !all; });
    _docUpdateSum();
  }
  function _docNewTicks() { return [...document.querySelectorAll('#iso-da-groups input[type=checkbox]:checked:not([data-linked])')].map(cb => cb.value); }
  // Edit links: a linked clause the user unticked — the document comes off that clause on save.
  function _docRemovals() { return [...document.querySelectorAll('#iso-da-groups input[type=checkbox][data-linked]:not(:checked)')].map(cb => cb.value); }
  function _docUpdateSum() {
    const el = document.getElementById('iso-da-sum');
    if (!el) return;
    const n = _docNewTicks().length, r = _docRemovals().length;
    el.textContent = [n || !r ? `${n} clause${n === 1 ? '' : 's'} to link` : '', r ? `${r} to remove` : ''].filter(Boolean).join(' · ');
    const warn = document.getElementById('iso-da-warn');
    if (warn) {
      warn.hidden = !r;
      warn.textContent = r ? `Removing this document from ${r} clause${r === 1 ? '' : 's'}. ${r === 1 ? 'That clause loses' : 'Those clauses lose'} it as evidence; the document itself stays on the board and on its other clauses.` : '';
    }
  }
  function _docAddClauseSearch(q) {
    const host = document.getElementById('iso-da-hits');
    if (!host || !_da) return;
    const ql = String(q || '').trim().toLowerCase();
    const have = new Set(_docFormRows().map(c => c.requirementId));
    const hits = ql ? _docReqs().filter(r => !have.has(r.id) && (String(r.clause).startsWith(ql) || String(r.clause_name || '').toLowerCase().includes(ql))).sort(reqClauseCompare).slice(0, 6) : [];
    host.innerHTML = hits.map(r => `<button type="button" class="iso-pick" data-id="${esc(r.id)}" onclick="ISO._docAddClause(this.dataset.id)"><span class="iso-tag" style="--std:${STANDARD_COLOR[r.standard_code] || '#97bcbd'}">${esc(STANDARD_BADGE[r.standard_code] || '•')}</span><span class="iso-pick-n">${esc(r.clause)} ${esc(r.clause_name || '')}</span></button>`).join('');
  }
  function _docAddClause(id) {
    if (!_da) return;
    _da.extra.add(id); _da.on.add(id); _da.sug.delete(id);
    const cq = document.getElementById('iso-da-cq'); if (cq) cq.value = '';
    _docAddClauseSearch('');
    _docRenderGroups();
  }
  async function _ovDocAddApply(confirmed) {
    if (!_da) return;
    const requirementIds = _docNewTicks();
    const removals = _docRemovals();
    const toast = (m, bad) => { if (root.showToast) root.showToast(m, bad); };
    if (!removals.length && _da.ctx && _da.doc && _da.doc.latest && _da.doc.clauses.some(c => c.requirementId === _da.ctx && c.provided) && !requirementIds.length && !Object.keys(_da.st || {}).length) { toast('Already linked to this clause.'); return; }
    const anyStatus = Object.keys((_da && _da.st) || {}).some(id => _da.st[id] !== _docCurrentStatus(id));
    if (!requirementIds.length && !removals.length && !anyStatus) { toast('Tick at least one clause.', true); return; }
    if (removals.length && confirmed !== true) {
      const names = removals.map(id => { const r = _docReqs().find(x => x.id === id); return r ? (STANDARD_BADGE[r.standard_code] || '') + ' ' + r.clause : ''; }).filter(Boolean).join(', ');
      if (root.openConfirm) root.openConfirm('Remove from ' + removals.length + ' clause' + (removals.length === 1 ? '' : 's') + '?',
        `"${_da.name}" will no longer be evidence for ${names}. The document stays on the board and on its other clauses. You can tick a clause again later to put it back.`,
        'Remove', () => { if (root.closeConfirm) root.closeConfirm(); _ovDocAddApply(true); }, true);
      return;
    }
    const auditId = _docAuditId();
    const linkSource = (!_da.doc || _da.doc.custom) ? 'custom' : 'register_suggestion'; // B3.4 signal
    try {
      if (removals.length) await mutate('evidence.unlinkDocument', { auditId: auditId, title: _da.name, requirementIds: removals });
      if (!requirementIds.length) {
        // removals only
      } else if (_da.doc && _da.doc.latest) {
        for (const id of requirementIds) await mutate('evidence.link', { auditId: auditId, targetType: 'requirement', targetId: id, evidenceIds: [_da.doc.latest.evidenceId], linkSource: linkSource });
      } else {
        const url = document.getElementById('ovda-url').value.trim();
        if (!url) { toast('Add a file or link first.', true); return; }
        const first = requirementIds.slice(0, 50), rest = requirementIds.slice(50);
        const r = await mutate('evidence.addLinkBulk', {
          auditId: auditId, title: _da.name, url: url,
          versionLabel: document.getElementById('ovda-version').value.trim() || undefined, evidenceDate: document.getElementById('ovda-date').value || undefined,
          requirementIds: first, linkSource: linkSource,
        });
        for (const id of rest) await mutate('evidence.link', { auditId: auditId, targetType: 'requirement', targetId: id, evidenceIds: [r.evidence.id], linkSource: linkSource });
      }
      const statusChanges = Object.entries((_da && _da.st) || {}).filter(([id, v]) => v !== _docCurrentStatus(id) && (requirementIds.includes(id) || ((_da.doc && _da.doc.clauses) || []).some(c => c.requirementId === id && c.provided)));
      if (statusChanges.length) {
        const latest = _da.doc && _da.doc.latest;
        const rev = latest ? latest.versionLabel : (document.getElementById('ovda-version') || {}).value;
        const date = latest ? latest.evidenceDate : (document.getElementById('ovda-date') || {}).value;
        const note = `Evidence — ${_da.name}${rev ? ', ' + rev : ''}${date ? ' · ' + fmtDate(date) : ''}`;
        const fresh = await api('requirement.list', { auditId: auditId });
        for (const [id, v] of statusChanges) {
          const row = fresh.find(r => r.id === id); if (!row) continue;
          const patch = v === 'ofi' ? { compliance_status: 'compliant', ofi: true } : v === 'compliant' ? { compliance_status: 'compliant', ofi: false } : { compliance_status: v };
          if (!String(row.current_system || '').trim()) patch.current_system = note;
          await mutate('requirement.update', { auditId: auditId, id: id, patch: patch, expectedVersion: row.row_version });
        }
      }
      document.getElementById('generic-modal').classList.add('hidden');
      toast([requirementIds.length ? `Linked to ${requirementIds.length} clause${requirementIds.length === 1 ? '' : 's'}` : '', removals.length ? `removed from ${removals.length}` : '', statusChanges.length ? `${statusChanges.length} status${statusChanges.length === 1 ? '' : 'es'} set` : ''].filter(Boolean).join(', ').replace(/^r/, 'R') + '.');
      _da = null;
      requirementIds.push(...removals); // refresh those clauses' document lists too
      if (!_auditCache) return;
      if (route.tab === 'documents') fillDocumentsTab(_auditCache);
      else if (route.tab === 'dashboard') fillOverviewTab(_auditCache);
      else if (route.tab === 'requirements' && document.getElementById('iso-req-tab')) { requirementIds.forEach(id => { if (_req.evidenceByReq) delete _req.evidenceByReq[id]; }); fillRequirementsTab(_auditCache); }
      fillBoardHeaderStats(_auditCache);
    } catch (e) { toast('Could not add the document: ' + e.message, true); }
  }

  // ── Documents tab (R4b, wireframe renderDocuments) ─────────────────────────────────────────────
  // Document-first: every register document this board's clauses name, how many clauses it covers per
  // standard, whether it is on the board yet. "Key documents" is a greedy set cover — the fewest
  // documents that together touch every clause — so the first thing to collect is obvious.
  let _docs = { auditId: null, docs: [], reqs: [], filter: 'key', q: '' };
  async function fillDocumentsTab(audit) {
    const host = document.getElementById('iso-doc-tab');
    if (!host) return;
    let docs, reqs;
    try {
      [docs, reqs] = await Promise.all([
        api('document.list', { auditId: audit.id }),
        api('requirement.list', { auditId: audit.id }),
        _promptTemplates ? Promise.resolve(_promptTemplates) : api('promptTemplate.list').then(t => (_promptTemplates = t || [])).catch(() => []),
      ]);
    } catch (e) {
      host.innerHTML = `<div class="iso-empty" style="color:#b91c1c">Could not load documents: ${esc(e.message)}</div>`;
      return;
    }
    const same = _docs.auditId === audit.id;
    _docs = { auditId: audit.id, docs: docs || [], reqs: reqs || [], filter: same ? _docs.filter : 'key', q: same ? _docs.q : '' };
    renderDocumentsTab(audit.id);
  }
  function docKeySet(docs, reqIds) {
    const left = new Set(reqIds), out = [];
    const pool = docs.filter(d => !d.custom);
    while (left.size) {
      let best = null, bn = 0;
      for (const d of pool) { if (out.includes(d)) continue; const n = d.clauses.filter(c => left.has(c.requirementId)).length; if (n > bn) { bn = n; best = d; } }
      if (!best) break;
      out.push(best); best.clauses.forEach(c => left.delete(c.requirementId));
    }
    return out;
  }
  function docTemplateFor(name) { return (_promptTemplates || []).find(t => (t.documents || []).includes(name)) || null; }
  function _docServesHtml(clauses) {
    const byStd = {};
    for (const c of clauses) byStd[c.standardCode] = (byStd[c.standardCode] || 0) + 1;
    return STANDARD_ORDER.filter(s => byStd[s]).map(s => `<span class="iso-ov-serve"><span class="iso-tag" style="--std:${STANDARD_COLOR[s] || '#97bcbd'}">${esc(STANDARD_BADGE[s] || '•')}</span>${byStd[s]}</span>`).join('');
  }
  function renderDocumentsTab(auditId) {
    const host = document.getElementById('iso-doc-tab');
    if (!host || _docs.auditId !== auditId) return;
    const std = boardStd();
    const reqs = _docs.reqs.filter(r => !std || r.standard_code === std);
    const scoped = _docs.docs.map(d => Object.assign({}, d, { clauses: d.clauses.filter(c => !std || c.standardCode === std) })).filter(d => d.clauses.length);
    const isProv = d => d.clauses.some(c => c.provided);
    const covered = new Set();
    scoped.forEach(d => d.clauses.forEach(c => { if (c.provided) covered.add(c.requirementId); }));
    const key = docKeySet(scoped, reqs.map(r => r.id));
    const keyNames = new Set(key.map(d => d.name));
    const provN = scoped.filter(isProv).length;
    let list = _docs.filter === 'key' ? key.slice() : scoped.slice().sort((a, b) => b.clauses.length - a.clauses.length || a.name.localeCompare(b.name));
    if (_docs.filter === 'missing') list = list.filter(d => !isProv(d));
    if (_docs.filter === 'provided') list = list.filter(isProv);
    const q = _docs.q.trim().toLowerCase();
    if (q) list = list.filter(d => d.name.toLowerCase().includes(q));
    const chips = [['key', 'Key documents', key.length], ['missing', 'Not provided', scoped.filter(d => !isProv(d)).length], ['provided', 'Provided', provN], ['all', 'All', scoped.length]];
    const row = d => {
      const p = isProv(d) ? d.latest : null;
      const tpl = !p && !d.custom ? docTemplateFor(d.name) : null;
      return `<div class="iso-doc-row" data-doc-row="${esc(d.name)}">
        <span class="iso-doc-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg></span>
        <span class="iso-doc-dn">${esc(d.name)}${_docs.filter !== 'key' && keyNames.has(d.name) ? '<span class="iso-keyflag">Key</span>' : ''}${d.custom ? '<span class="iso-keyflag">Custom</span>' : ''}</span>
        <span class="iso-doc-sv"><b>${d.clauses.length} clause${d.clauses.length === 1 ? '' : 's'}</b>${_docServesHtml(d.clauses)}</span>
        <span class="iso-doc-ds ${p ? 'is-ok' : 'is-miss'}">${p ? `<span aria-hidden="true">✓</span>${esc([p.versionLabel, p.evidenceDate ? fmtDate(p.evidenceDate) : null].filter(Boolean).join(' · ') || 'Provided')}` : (d.requestedAt ? `Requested ${esc(fmtTs(d.requestedAt))}` : 'Not provided')}</span>
        <span class="iso-doc-btns">${tpl ? `<button type="button" class="iso-mini-btn iso-doc-gen" data-doc="${esc(d.name)}" title="Build a prompt from the Company Profile to draft it" onclick="ISO._docOpenGenerator(this)"><svg class="iso-svg" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5M19 8v3"/><path d="m16 15 1.5-3 1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5z"/></svg>Generator</button>` : ''}<button type="button" class="btn btn-sm ${p ? 'btn-ghost' : 'btn-primary iso-btn-dark'} iso-doc-add" data-doc="${esc(d.name)}" onclick="ISO._docOpenAdd(this)">${p ? 'Edit links' : '+ Add'}</button></span>
      </div>`;
    };
    host.innerHTML = `<div class="iso-docs-sum"><span class="iso-docs-big">${covered.size} <small>of ${reqs.length} clauses have evidence</small></span>
        <p>${provN} document${provN === 1 ? '' : 's'} provided. ${_docs.filter === 'key' ? `These ${key.length} documents together touch every clause — collect them first.` : 'Each document lists the clauses the register says it supports.'}</p></div>
      <div class="iso-toolbar iso-doc-toolbar">
        <label class="iso-search"><span class="sr-only">Search documents</span><input type="search" id="iso-doc-q" value="${esc(_docs.q)}" placeholder="Search documents" oninput="ISO._docSetQuery(this.value)"/></label>
        <div class="iso-fchips">${chips.map(([f, l, n]) => `<button type="button" class="iso-fchip${_docs.filter === f ? ' is-on' : ''}" aria-pressed="${_docs.filter === f}" data-f="${f}" onclick="ISO._docSetFilter(this.dataset.f)">${esc(l)} <b>${n}</b></button>`).join('')}</div>
        <span class="iso-tb-spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm iso-csv" title="Download this view as CSV" onclick="ISO._exportDocumentsCsv()">Export CSV<span class="sr"> — documents</span></button>
        <button type="button" class="btn btn-ghost btn-sm iso-xlsx" title="Download a branded Excel copy — presentable to send to a client" onclick="ISO._exportDocumentsXlsx()">Export Excel<span class="sr"> — documents</span></button>
        <button type="button" class="btn btn-ghost iso-doc-request" onclick="ISO._docOpenRequest()">Request from client</button>
        <button type="button" class="btn btn-ghost iso-doc-new" onclick="ISO._docOpenChooser(null)"><span aria-hidden="true">+</span> Add other document</button>
      </div>
      <div class="iso-doc-list-wrap">${list.length ? list.map(row).join('') : '<div class="iso-empty"><strong>No documents match.</strong></div>'}</div>`;
  }
  function _docSetFilter(f) { _docs.filter = f; renderDocumentsTab(_docs.auditId); }
  function _docSetQuery(q) {
    _docs.q = q; renderDocumentsTab(_docs.auditId);
    const el = document.getElementById('iso-doc-q'); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
  }
  function _docOpenGenerator(el) {
    const d = _docFind(el.dataset.doc);
    const t = d && docTemplateFor(d.name);
    if (!d || !t || !d.clauses.length) return;
    _openPromptDialog(_docAuditId(), d.clauses[0].requirementId, t.templateId);
  }
  // "+ Add other document": any of the register's documents, or a new custom one (audit-only — the
  // shared Etcher library of custom documents D40 mentions is not built; flagged in the plan).
  let _dcCtx = null;
  function _docOpenChooser(ctxReqId) {
    _dcCtx = typeof ctxReqId === 'string' ? ctxReqId : null;
    const r = _dcCtx ? _docReqs().find(x => x.id === _dcCtx) : null;
    root.openGenericModal('Add a document', `<div class="iso-da">
        <p class="muted">${r ? `For ${esc(STANDARD_BADGE[r.standard_code] || '')} ${esc(r.clause)} ${esc(r.clause_name || '')}. A suggestion, something already provided, or any other document.` : "Any of the register's documents, or your own."}</p>
        <label class="iso-search iso-da-find"><input type="search" id="iso-da-find" placeholder="Search register documents, or type a new name" autocomplete="off" oninput="ISO._docChooserSearch(this.value)"/></label>
        <div id="iso-da-picks"></div></div>`, '560px');
    _docChooserSearch('');
    setTimeout(() => { const el = document.getElementById('iso-da-find'); if (el) el.focus(); }, 0);
  }
  function _docChooserSearch(q) {
    const host = document.getElementById('iso-da-picks');
    if (!host) return;
    const ql = String(q || '').trim().toLowerCase();
    const all = (_docs.docs.length && _docs.auditId === _docAuditId() ? _docs.docs : (_req.docs && _req.docs.length && _req.auditId === _docAuditId() ? _req.docs : _ov.docs || []));
    const pick = d => `<button type="button" class="iso-pick" data-doc="${esc(d.name)}" onclick="ISO._docPick(this)"><span class="iso-pick-n">${esc(d.name)}</span><span class="iso-pick-t">${[d.latest ? 'Provided' : '', d.custom ? 'Custom' : '', `${d.clauses.length} clause${d.clauses.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></button>`;
    if (!ql) {
      if (_dcCtx) {
        const r = _docReqs().find(x => x.id === _dcCtx);
        const on = d => d.clauses.some(c => c.requirementId === _dcCtx && c.provided);
        const sug = (((_req.guidance || {})[_dcCtx] || {}).documents || []).map(n => all.find(d => d.name === n)).filter(d => d && !on(d));
        const prov = all.filter(d => d.latest && !on(d) && !sug.includes(d)).sort((a, b) => a.name.localeCompare(b.name));
        host.innerHTML = (sug.length ? `<div class="iso-pick-g"><span class="iso-clause-col-label">Suggested for ${esc(STANDARD_BADGE[r ? r.standard_code : ''] || '')} ${esc(r ? r.clause : '')}</span>${sug.map(pick).join('')}</div>` : '')
          + (prov.length ? `<div class="iso-pick-g"><span class="iso-clause-col-label">Already provided — link it to this clause</span>${prov.slice(0, 8).map(pick).join('')}${prov.length > 8 ? `<p class="muted">${prov.length - 8} more — search to find them.</p>` : ''}</div>` : '');
        return;
      }
      const missing = all.filter(d => !d.latest && !d.custom).slice(0, 6);
      host.innerHTML = missing.length ? `<div class="iso-pick-g"><span class="iso-clause-col-label">Not provided yet</span>${missing.map(pick).join('')}</div>` : '';
      return;
    }
    const hits = all.filter(d => d.name.toLowerCase().includes(ql)).slice(0, 10);
    const exact = all.some(d => d.name.toLowerCase() === ql);
    host.innerHTML = (hits.length ? `<div class="iso-pick-g"><span class="iso-clause-col-label">${hits.length} match${hits.length === 1 ? '' : 'es'}</span>${hits.map(pick).join('')}</div>` : '')
      + (exact ? '' : `<div class="iso-pick-g"><button type="button" class="iso-pick is-new" data-doc="${esc(String(q).trim())}" data-custom="1" onclick="ISO._docPick(this)"><span class="iso-pick-n">Add “${esc(String(q).trim())}” as a new document</span><span class="iso-pick-t">Not in the register — you choose its clauses</span></button></div>`);
  }
  function _docPick(el) { _docOpenForm(el.dataset.doc, el.dataset.custom === '1', _dcCtx); }

  // ── Actions tab (R6, wireframe renderActions) ──────────────────────────────────────────────────
  // One list. A Partial / Non-Compliant / OFI clause with a planned action IS the finding and the
  // action; the same planned text on several clauses becomes one shared action covering all of them.
  // Actions already raised the old way (iso_actions) stay listed, with the clauses they're linked to.
  const WL_PRIO = { 3: 'High', 2: 'Medium', 1: 'Low' };
  const WL_ACTION_PRIO = { crit: 3, high: 3, med: 2, low: 1 };
  const WL_DONE = ['verified', 'closed'];
  function worklistItemsFrom(reqs, actions) {
    const m = new Map();
    for (const r of reqs || []) {
      const st = r.compliance_status;
      if (!needsAction(r)) continue;
      if (trackedActionFor(r, actions)) continue; // B2.1: its tracked action is listed instead — never two
      const plan = String(r.recommended_action || '').trim();
      if (!plan) continue;
      const k = plan.toLowerCase();
      if (!m.has(k)) m.set(k, { kind: 'plan', title: plan, reqIds: [], owner: r.responsible_uid || null, due: null, p: 0 });
      const x = m.get(k);
      x.reqIds.push(r.id);
      x.p = Math.max(x.p, st === 'non_compliant' ? 3 : st === 'partially_compliant' ? 2 : 1);
      if (!x.owner && r.responsible_uid) x.owner = r.responsible_uid;
      if (r.target_date && (!x.due || r.target_date < x.due)) x.due = r.target_date;
    }
    const out = [...m.values()];
    const reqIdSet = new Set((reqs || []).map(r => r.id));
    for (const a of actions || []) {
      if (WL_DONE.includes(a.status)) continue;
      const linked = (a.links || []).filter(l => l.target_type === 'requirement').map(l => l.target_id);
      if (linked.length && !linked.some(id => reqIdSet.has(id))) continue; // other standard (scoped)
      out.push({ kind: 'action', id: a.id, ref: a.ref || '', status: a.status, verification: a.verification_status, title: a.title, reqIds: linked.filter(id => reqIdSet.has(id)), owner: a.owner_uid || null, due: a.due_date || null, p: WL_ACTION_PRIO[a.priority] || 2 });
    }
    return out.sort((a, b) => b.p - a.p || (a.due || '9').localeCompare(b.due || '9'));
  }
  // Release-1 B2.1: the action tracking a clause — an open one linked to it, or a finished one whose
  // title is still the clause's plan (so a closed record never brings the derived row back).
  function trackedActionFor(r, actions) {
    const plan = String(r.recommended_action || '').trim().toLowerCase();
    let done = null;
    for (const a of actions || []) {
      if (!(a.links || []).some(l => l.target_type === 'requirement' && l.target_id === r.id)) continue;
      if (!WL_DONE.includes(a.status)) return a;
      if (plan && String(a.title || '').trim().toLowerCase() === plan) done = a;
    }
    return done;
  }
  function actionStateText(status, verification) {
    const v = verification === 'effective' ? ' · verified effective' : verification === 'ineffective' ? ' · verified ineffective' : '';
    return (ACTION_STATUS_LABEL[status] || status || '') + v;
  }
  function wlStateHtml(x) {
    if (x.kind === 'action') return `<span class="iso-wl-state">${x.ref ? esc(x.ref) + ' · ' : ''}${esc(actionStateText(x.status, x.verification))}</span>`;
    return canManageFindingLocally() ? `<button type="button" class="iso-mini-btn iso-track-btn" data-ids="${esc(x.reqIds.join(','))}" data-src="wl" onclick="ISO._trackOpen(this.dataset.ids,this.dataset.src)">Track ›</button>` : '';
  }
  let _wl = { auditId: null, reqs: [], actions: [], mode: 'list' };
  async function fillWorklistTab(audit) {
    const host = document.getElementById('iso-wl-tab');
    if (!host) return;
    let reqs, actions;
    try {
      [reqs, actions] = await Promise.all([api('requirement.list', { auditId: audit.id }), api('action.list', { auditId: audit.id }).catch(() => [])]);
    } catch (e) {
      host.innerHTML = `<div class="iso-empty" style="color:#b91c1c">Could not load actions: ${esc(e.message)}</div>`;
      return;
    }
    _wl = { auditId: audit.id, reqs: reqs || [], actions: actions || [], mode: _wl.auditId === audit.id ? _wl.mode : 'list' };
    renderWorklistTab(audit.id);
  }
  function renderWorklistTab(auditId) {
    const host = document.getElementById('iso-wl-tab');
    if (!host || _wl.auditId !== auditId) return;
    const std = boardStd();
    const reqs = _wl.reqs.filter(r => !std || r.standard_code === std);
    const byId = new Map(_wl.reqs.map(r => [r.id, r]));
    const items = worklistItemsFrom(reqs, _wl.actions);
    const shared = items.filter(x => x.reqIds.length > 1).length;
    const tb = `<div class="iso-toolbar iso-wl-toolbar"><div class="iso-fchips">
        <button type="button" class="iso-fchip${_wl.mode === 'list' ? ' is-on' : ''}" aria-pressed="${_wl.mode === 'list'}" data-m="list" onclick="ISO._wlSetMode(this.dataset.m)">List</button>
        <button type="button" class="iso-fchip${_wl.mode === 'timeline' ? ' is-on' : ''}" aria-pressed="${_wl.mode === 'timeline'}" data-m="timeline" onclick="ISO._wlSetMode(this.dataset.m)">Timeline</button></div>
        <span class="muted iso-wl-count">${items.length} action${items.length === 1 ? '' : 's'} · ${shared} shared across clauses</span><span class="iso-tb-spacer"></span><button type="button" class="btn btn-ghost btn-sm iso-csv" title="Download this view as CSV" onclick="ISO._exportActionsCsv()">Export CSV<span class="sr"> — actions</span></button><button type="button" class="btn btn-ghost btn-sm iso-xlsx" title="Download a branded Excel copy — presentable to send to a client" onclick="ISO._exportActionsXlsx()">Export Excel<span class="sr"> — actions</span></button></div>`;
    if (!items.length) { host.innerHTML = tb + '<div class="iso-empty"><strong>No actions.</strong><span>Mark a clause Partial, Non-Compliant or OFI and write a planned action.</span></div>'; return; }
    const titleHtml = x => x.kind === 'action' ? `<button type="button" class="iso-wl-plan is-link" data-id="${esc(x.id)}" onclick="ISO._wlOpenAction(this.dataset.id)">${esc(x.title)}</button>` : `<span class="iso-wl-plan">${esc(x.title)}</span>`;
    if (_wl.mode === 'timeline') {
      const today = new Date(); today.setDate(1); today.setHours(0, 0, 0, 0);
      const lastDue = items.map(x => x.due).filter(Boolean).sort().pop();
      const end = new Date(today); end.setMonth(end.getMonth() + 5);
      if (lastDue) { const ld = new Date(lastDue + 'T00:00:00'); while (end <= ld) end.setMonth(end.getMonth() + 1); }
      const months = []; for (const d = new Date(today); d < end; d.setMonth(d.getMonth() + 1)) months.push(d.toLocaleDateString('en-AU', { month: 'short' }));
      const span = end - today;
      host.innerHTML = tb + `<div class="iso-tl"><div class="iso-tl-head"><span></span><div class="iso-tl-months" style="grid-template-columns:repeat(${months.length},1fr)">${months.map(m => `<span>${esc(m)}</span>`).join('')}</div></div>
        ${items.map(x => { const w = x.due ? Math.max(3, Math.min(100, (new Date(x.due + 'T00:00:00') - today) / span * 100)) : 100; return `<div class="iso-tl-row"><span class="iso-tl-t" title="${esc(x.title)}">${esc(x.title)}</span><div class="iso-tl-track" style="--n:${months.length}"><span class="iso-tl-bar p${x.p}${x.due ? '' : ' is-nodue'}" style="width:${w}%" title="${x.due ? 'Due ' + esc(fmtDate(x.due)) : 'No due date'}"></span></div></div>`; }).join('')}</div>`;
      return;
    }
    host.innerHTML = tb + items.map(x => `<div class="iso-wl-row">
        <span class="iso-prio p${x.p}"><i class="iso-prio-dot" aria-hidden="true"></i>${WL_PRIO[x.p]}</span>
        <span class="iso-wl-main">${titleHtml(x)}${wlStateHtml(x)}</span>
        <span class="iso-covers">${x.reqIds.map(id => byId.get(id)).filter(Boolean).sort(reqClauseCompare).map(r => `<button type="button" class="iso-cv" data-id="${esc(r.id)}" title="${esc(r.clause_name || '')}" onclick="ISO._reqJumpTo(this.dataset.id)"><span class="iso-tag" style="--std:${STANDARD_COLOR[r.standard_code] || '#97bcbd'}">${esc(STANDARD_BADGE[r.standard_code] || '•')}</span>${esc(r.clause)}</button>`).join('')}</span>
        <span class="iso-wl-own">${esc((x.owner && _uidName(x.owner)) || '—')}</span>
        <span class="iso-wl-due">${esc(fmtDate(x.due))}</span>
      </div>`).join('');
  }
  function _wlSetMode(m) { _wl.mode = m === 'timeline' ? 'timeline' : 'list'; renderWorklistTab(_wl.auditId); }
  function _wlAuditId() { return _wl.auditId; }
  // The action drawer reads the Actions register's own state (_act) — fill it for this board first,
  // the same shape fillActionsTab builds, so a legacy action opens from the merged list.
  async function _wlOpenAction(id, auditIdArg) {
    const auditId = auditIdArg || _wl.auditId;
    if (_act.auditId !== auditId || !(_act.actions || []).some(a => a.id === id)) {
      try {
        const [actions, findings, requirements, subtasks] = await Promise.all([api('action.list', { auditId: auditId }), api('finding.list', { auditId: auditId }), api('requirement.list', { auditId: auditId }), api('subtask.list', { auditId: auditId })]);
        _act = { auditId: auditId, actions: actions, findings: findings, requirements: requirements, subtasks: subtasks, view: 'open', dashFilter: null, dashLabel: '' };
      } catch (e) { if (root.showToast) root.showToast('Could not open the action: ' + e.message, true); return; }
    }
    openActionDrawer(auditId, id);
  }
  function _reqOpenTracked(id) { return _wlOpenAction(id, _req.auditId); }

  // ── Release-1 B2.1: Track this action ─────────────────────────────────────────────────────────
  // One small panel: the clauses (a shared plan pre-ticks every open clause with that plan), owner,
  // due, priority (from the worst status) and — on a formal audit type only — the finding
  // classification. action.trackPlan does the rest in one call.
  const FORMAL_AUDIT_TYPES = ['internal', 'surveillance', 'recertification', 'certification_prep', 'follow_up'];
  let _trk = null;
  function _trackOpen(idsCsv, src) {
    const pool = src === 'wl' ? { auditId: _wl.auditId, reqs: _wl.reqs, actions: _wl.actions } : { auditId: _req.auditId, reqs: _req.requirements, actions: _req.actions || [] };
    const byId = new Map((pool.reqs || []).map(r => [r.id, r]));
    const start = String(idsCsv || '').split(',').map(id => byId.get(id)).filter(Boolean);
    if (!start.length) return;
    const plan = String(start[0].recommended_action || '').trim();
    const key = plan.toLowerCase();
    const rows = pool.reqs.filter(r => needsAction(r) && String(r.recommended_action || '').trim().toLowerCase() === key && !trackedActionFor(r, pool.actions)).sort(reqClauseCompare);
    for (const r of start) if (!rows.includes(r)) rows.unshift(r);
    const worst = rows.some(r => r.compliance_status === 'non_compliant') ? 'non_compliant' : rows.some(r => r.compliance_status === 'partially_compliant') ? 'partially_compliant' : 'ofi';
    const formal = FORMAL_AUDIT_TYPES.includes((_auditCache || {}).audit_type);
    const owner = (rows.find(r => r.responsible_uid) || {}).responsible_uid || '';
    const due = rows.map(r => r.target_date).filter(Boolean).sort()[0] || '';
    const prio = { non_compliant: 'high', partially_compliant: 'med', ofi: 'low' }[worst];
    const cls = { non_compliant: 'minor_nc', partially_compliant: 'minor_nc', ofi: 'ofi' }[worst];
    const staff = (_DB().users || []).filter(u => u.role !== 'client');
    _trk = { auditId: pool.auditId };
    root.openGenericModal('Track this action', `<div class="iso-track">
      <p class="iso-track-plan">${esc(plan)}</p>
      <fieldset class="iso-track-clauses"><legend>Clauses${rows.length > 1 ? ` <span class="muted">· shared plan, ${rows.length} clauses</span>` : ''}</legend>
        ${rows.map(r => `<label class="iso-track-clause"><input type="checkbox" class="iso-trk-cb" value="${esc(r.id)}" checked/><span class="iso-tag" style="--std:${STANDARD_COLOR[r.standard_code] || '#97bcbd'}">${esc(STANDARD_BADGE[r.standard_code] || '•')}</span><b>${esc(r.clause)}</b><span class="muted">${esc(r.clause_name || '')} · ${esc(statusText(r))}</span></label>`).join('')}
      </fieldset>
      <div class="iso-field-grid">
        <label>Owner<select class="form-input" id="trk-owner"><option value="">Unassigned</option>${staff.map(u => `<option value="${esc(u.id)}"${u.id === owner ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label>Due<input type="date" class="form-input" id="trk-due" value="${esc(due)}"/></label>
        <label>Priority<select class="form-input" id="trk-prio">${Object.keys(ACTION_PRIORITY_LABEL).map(k => `<option value="${k}"${k === prio ? ' selected' : ''}>${esc(ACTION_PRIORITY_LABEL[k])}</option>`).join('')}</select></label>
        ${formal ? `<label>Finding classification<select class="form-input" id="trk-class">${Object.keys(FINDING_CLASSIFICATION_LABEL).map(k => `<option value="${k}"${k === cls ? ' selected' : ''}>${esc(FINDING_CLASSIFICATION_LABEL[k])}</option>`).join('')}</select></label>` : ''}
      </div>
      <p class="muted iso-track-note">${formal ? 'One action for the ticked clauses, and a finding for each — its statement from the basis, its evidence from the linked documents.' : 'One action for the ticked clauses. A gap analysis records actions only — no findings.'}</p>
      <div class="iso-track-btns"><button type="button" class="btn btn-teal btn-sm" id="trk-go" onclick="ISO._trackApply()">Track</button></div>
    </div>`, '560px');
  }
  async function _trackApply() {
    if (!_trk) return;
    const ids = [...document.querySelectorAll('.iso-trk-cb')].filter(c => c.checked).map(c => c.value);
    if (!ids.length) { if (root.showToast) root.showToast('Tick at least one clause.', true); return; }
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const payload = { auditId: _trk.auditId, requirementIds: ids, ownerUid: v('trk-owner') || null, dueDate: v('trk-due') || null, priority: v('trk-prio') || null };
    if (document.getElementById('trk-class')) payload.classification = v('trk-class');
    const btn = document.getElementById('trk-go'); if (btn) btn.disabled = true;
    try {
      const res = await mutate('action.trackPlan', payload);
      const findings = res.findings || [];
      const tracked = Object.assign({}, res.action, { links: ids.map(id => ({ target_type: 'requirement', target_id: id })).concat(findings.map(f => ({ target_type: 'finding', target_id: f.id }))) });
      for (const st of [_wl, _req]) if (st.auditId === _trk.auditId) st.actions = (st.actions || []).concat([tracked]);
      document.getElementById('generic-modal').classList.add('hidden');
      renderWorklistTab(_trk.auditId);
      renderRequirementsTable(_trk.auditId);
      if (root.showToast) root.showToast(`Tracked as ${res.action.ref}${findings.length ? ` with ${findings.length} finding${findings.length === 1 ? '' : 's'}` : ''}.`);
    } catch (e) {
      if (btn) btn.disabled = false;
      if (root.showToast) root.showToast('Could not track: ' + e.message, true);
    }
  }
  // The action drawer's "via F-…" chip opens that finding (close / reopen live there).
  async function _actOpenFinding(id) {
    const auditId = _act.auditId;
    if (_fnd.auditId !== auditId || !(_fnd.findings || []).some(f => f.id === id)) {
      try {
        const [findings, requirements] = await Promise.all([api('finding.list', { auditId: auditId }), api('requirement.list', { auditId: auditId })]);
        _fnd = { auditId: auditId, findings: findings, requirements: requirements, view: 'all', dashFilter: null, dashLabel: '' };
      } catch (e) { if (root.showToast) root.showToast('Could not open the finding: ' + e.message, true); return; }
    }
    openFindingDrawer(auditId, id);
  }

  // ── Release-1 B4.3: carry-forward labels (worked out, no new state) ──────────────────────────
  // On a maintenance / follow-up board a clause with a baseline says how it stands against last time.
  // Previous conclusions never count as current — statuses reset on the new board; this only labels.
  function carryLabel(r) {
    if (!r || !r.baseline_at || !(_auditCache && _auditCache.previous_audit_id)) return null;
    const cs = r.compliance_status || 'not_assessed';
    if (cs === 'out_of_scope') return 'Out of scope';
    if (cs === 'not_applicable') return r.baseline_result ? 'No longer applicable' : null;
    if (!r.assessment_result) return 'Carried, not yet verified';
    return (r.baseline_result || null) === (r.assessment_result || null) ? 'Reconfirmed' : 'Changed since last audit';
  }

  // ── Release-1 B4.1: audit setup card (Settings) ──────────────────────────────────────────────
  function auditSetupCardHtml(audit, isManager) {
    const s = audit.setup || {};
    const dis = isManager ? '' : 'disabled';
    const meet = (k, label) => { const m = s[k] || {}; return `<fieldset class="iso-setup-meet"><legend>${label}</legend>
        <label>Date<input type="date" class="form-input" id="iso-su-${k}-date" value="${esc(m.date || '')}" ${dis}/></label>
        <label>Attendees<input class="form-input" id="iso-su-${k}-att" value="${esc(m.attendees || '')}" ${dis}/></label>
        <label class="iso-setup-wide">Notes<textarea class="form-input" id="iso-su-${k}-notes" rows="2" ${dis}>${esc(m.notes || '')}</textarea></label></fieldset>`; };
    return `<div class="card iso-setup-card" style="padding:20px;margin-top:16px;max-width:720px">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">Audit setup</div>
      <div class="muted" style="font-size:12px;margin-bottom:12px">Feeds the reports. Standards, editions and the team come from the board itself.</div>
      <div class="iso-field-grid">
        <label class="iso-setup-wide">Objective<textarea class="form-input" id="iso-su-objective" rows="2" ${dis}>${esc(s.objective || '')}</textarea></label>
        <label class="iso-setup-wide">Scope statement<textarea class="form-input" id="iso-su-scope" rows="2" ${dis}>${esc(s.scope || '')}</textarea></label>
        <label class="iso-setup-wide">Criteria <span class="muted">(besides ${esc((audit.standards || []).map(c => 'ISO ' + c).join(', ') || 'the board\'s standards')})</span><textarea class="form-input" id="iso-su-criteria" rows="2" ${dis}>${esc(s.criteria || '')}</textarea></label>
        <div class="iso-setup-wide"><div class="iso-setup-k">Sites</div><div id="iso-su-sites" class="iso-setup-sites muted">Loading sites…</div></div>
        <label class="iso-setup-wide">Limitations<textarea class="form-input" id="iso-su-limitations" rows="2" ${dis}>${esc(s.limitations || '')}</textarea></label>
      </div>
      <div class="iso-setup-meets">${meet('opening', 'Opening meeting')}${meet('closing', 'Closing meeting')}</div>
      ${isManager ? `<button type="button" class="btn btn-teal btn-sm" style="margin-top:14px" data-id="${esc(audit.id)}" onclick="ISO._saveAuditSetup(this.dataset.id)">Save setup</button>` : ''}
    </div>`;
  }
  async function _fillSetupSites(audit, isManager) {
    const host = document.getElementById('iso-su-sites');
    if (!host) return;
    let units = [];
    try { units = (await api('unit.list', { auditId: audit.id })) || []; } catch (e) {}
    const on = new Set((audit.setup && audit.setup.sites) || []);
    host.classList.toggle('muted', !units.length);
    host.innerHTML = units.length ? units.map(u => `<label class="iso-setup-site"><input type="checkbox" class="iso-su-site" value="${esc(u.id)}"${on.has(u.id) ? ' checked' : ''}${isManager ? '' : ' disabled'}/> ${esc(u.name)}</label>`).join('')
      : 'No sites on this board yet — add them under Access.';
  }
  async function _saveAuditSetup(auditId) {
    const v = id => (document.getElementById(id) || {}).value || '';
    const meet = k => ({ date: v(`iso-su-${k}-date`) || null, attendees: v(`iso-su-${k}-att`), notes: v(`iso-su-${k}-notes`) });
    const setup = { objective: v('iso-su-objective'), scope: v('iso-su-scope'), criteria: v('iso-su-criteria'), limitations: v('iso-su-limitations'),
      sites: [...document.querySelectorAll('.iso-su-site')].filter(c => c.checked).map(c => c.value), opening: meet('opening'), closing: meet('closing') };
    try {
      const a = await api('audit.get', { auditId: auditId });
      await mutate('audit.update', { auditId: auditId, patch: { setup: setup }, expectedVersion: (a.audit || a).row_version });
      if (root.showToast) root.showToast('Audit setup saved.');
      root.renderView('iso');
    } catch (e) { if (root.showToast) root.showToast('Could not save the setup: ' + e.message, true); }
  }

  // ── Release-1 B4.2: one dialog to start a follow-up or the maintenance audit (Q9) ─────────────
  let _sn = null;
  async function _openStartNext(auditId, preset) {
    preset = preset || {};
    let reqs = [], findings = [], actions = [];
    try { [reqs, findings, actions] = await Promise.all([api('requirement.list', { auditId: auditId }), api('finding.list', { auditId: auditId }), api('action.list', { auditId: auditId })]); }
    catch (e) { if (root.showToast) root.showToast('Could not load the board: ' + e.message, true); return; }
    const openF = findings.filter(f => !['closed', 'withdrawn'].includes(f.status));
    const openA = actions.filter(a => !['verified', 'closed'].includes(a.status));
    const gaps = reqs.filter(r => ['partially_compliant', 'non_compliant'].includes(r.compliance_status)).sort(reqClauseCompare);
    const others = reqs.filter(r => !gaps.includes(r)).sort(reqClauseCompare);
    const pre = (list, ids) => ids ? new Set(ids) : new Set(list.map(x => x.id));
    const preF = pre(openF, preset.findingIds), preA = pre(openA, preset.findingIds ? [] : null), preR = pre(gaps, preset.findingIds ? [] : null);
    _sn = { auditId: auditId };
    const staff = (_DB().users || []).filter(u => u.role !== 'client');
    const me = _cu() ? _cu().id : '';
    const box = (cls, x, on, label) => `<label class="iso-sn-item"><input type="checkbox" class="${cls}" value="${esc(x.id)}"${on ? ' checked' : ''}/> ${label}</label>`;
    const reqLabel = r => `<span class="iso-tag" style="--std:${STANDARD_COLOR[r.standard_code] || '#97bcbd'}">${esc(STANDARD_BADGE[r.standard_code] || '•')}</span><b>${esc(r.clause)}</b> <span class="muted">${esc(r.clause_name || '')} · ${esc(statusText(r))}</span>`;
    const type = preset.type || 'follow_up';
    root.openGenericModal('Start a follow-up or maintenance audit', `<div class="iso-sn">
      <div class="iso-sn-types" role="radiogroup" aria-label="Audit type">
        <label class="iso-sn-type"><input type="radio" name="iso-sn-type" value="follow_up"${type === 'follow_up' ? ' checked' : ''} onchange="ISO._snType(this.value)"/> <b>Follow-up</b> <span class="muted">— only the findings, actions and clauses you pick; every other clause is Out of scope</span></label>
        <label class="iso-sn-type"><input type="radio" name="iso-sn-type" value="maintenance"${type === 'maintenance' ? ' checked' : ''} onchange="ISO._snType(this.value)"/> <b>Maintenance</b> <span class="muted">— every clause again, last results as the baseline</span></label>
      </div>
      <div id="iso-sn-scope"${type === 'maintenance' ? ' hidden' : ''}>
        <fieldset class="iso-sn-group"><legend>Open findings <span class="muted">${openF.length}</span></legend>${openF.map(f => box('iso-sn-f', f, preF.has(f.id), `<b>${esc(f.ref)}</b> ${esc(f.title)}`)).join('') || '<span class="muted">None open.</span>'}</fieldset>
        <fieldset class="iso-sn-group"><legend>Open actions <span class="muted">${openA.length}</span></legend>${openA.map(a => box('iso-sn-a', a, preA.has(a.id), `<b>${esc(a.ref)}</b> ${esc(a.title)}`)).join('') || '<span class="muted">None open.</span>'}</fieldset>
        <fieldset class="iso-sn-group"><legend>Partial / Non-Compliant clauses <span class="muted">${gaps.length}</span></legend>${gaps.map(r => box('iso-sn-r', r, preR.has(r.id), reqLabel(r))).join('') || '<span class="muted">None.</span>'}</fieldset>
        <details class="iso-sn-more"><summary>Other clauses (${others.length})</summary>${others.map(r => box('iso-sn-r', r, false, reqLabel(r))).join('')}</details>
      </div>
      <div class="iso-field-grid">
        <label>Planned date<input type="date" class="form-input" id="iso-sn-date"/></label>
        <label>Lead Auditor<select class="form-input" id="iso-sn-lead"><option value="">Keep the current team</option>${staff.map(u => `<option value="${esc(_uidFor(u))}"${u.id === me ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      </div>
      <p class="muted iso-sn-note">The team comes across from this board. Each carried finding and action says where it came from; accepted evidence is offered as suggestions.</p>
      <div class="iso-track-btns"><button type="button" class="btn btn-teal btn-sm" id="iso-sn-go" onclick="ISO._snApply()">Start</button></div>
    </div>`, '640px');
  }
  // The uid a staff user has on ISO boards (the offline dev server prefixes "offline:").
  function _uidFor(u) { const sample = (_membersCache || []).find(m => m.member_kind === 'staff'); return sample && /^offline:/.test(sample.user_uid) && !/^offline:/.test(u.id) ? 'offline:' + u.id : u.id; }
  function _snType(v) { const s = document.getElementById('iso-sn-scope'); if (s) s.hidden = v !== 'follow_up'; }
  async function _snApply() {
    if (!_sn) return;
    const type = (document.querySelector('input[name="iso-sn-type"]:checked') || {}).value || 'follow_up';
    const ids = cls => [...document.querySelectorAll('.' + cls)].filter(c => c.checked).map(c => c.value);
    const payload = { auditId: _sn.auditId, type: type, plannedStart: (document.getElementById('iso-sn-date') || {}).value || null, leadUid: (document.getElementById('iso-sn-lead') || {}).value || null };
    if (type === 'follow_up') {
      payload.scope = { findingIds: ids('iso-sn-f'), actionIds: ids('iso-sn-a'), requirementIds: ids('iso-sn-r') };
      if (!payload.scope.findingIds.length && !payload.scope.actionIds.length && !payload.scope.requirementIds.length) { if (root.showToast) root.showToast('Pick at least one finding, action or clause.', true); return; }
    }
    const btn = document.getElementById('iso-sn-go'); if (btn) btn.disabled = true;
    try {
      const r = await mutate('audit.startFollowUp', payload);
      document.getElementById('generic-modal').classList.add('hidden');
      const su = r.summary || {};
      if (root.showToast) root.showToast(`${r.audit.ref} started — ${su.findings || 0} findings and ${su.actions || 0} actions carried over${type === 'follow_up' ? `, ${su.outOfScope || 0} clauses out of scope` : ''}.`);
      openBoard(r.audit.id);
    } catch (e) { if (btn) btn.disabled = false; if (root.showToast) root.showToast('Could not start: ' + e.message, true); }
  }

  // ── Release-1 B4.4 / B4.5: the client programme page (Q8) ──────────────────────────────────────
  // The client's chain of boards — timeline, next audit due, what needs attention — and the client
  // settings (next due, frequency, industry, notes). Reached from the landing's client heading.
  const PROG_FREQ = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', six_monthly: 'Every 6 months', annual: 'Annual', custom: 'Custom' };
  const PROG_INDUSTRY = { mining_resources: 'Mining & resources', construction: 'Construction', manufacturing: 'Manufacturing', transport_logistics: 'Transport & logistics', professional_services: 'Professional services', government: 'Government', other: 'Other' };
  let _prog = null;
  function openProgramme(clientId) { route = { auditId: null, tab: 'dashboard', programmeClientId: clientId }; saveRoute(); root.navigate('iso'); }
  async function fillProgramme() {
    const vc = document.getElementById('view-container');
    if (!vc) return;
    let data;
    try { data = await api('programme.get', { clientId: route.programmeClientId }); }
    catch (e) { vc.innerHTML = `<div class="card" style="padding:20px;color:#b91c1c">Could not load the programme: ${esc(e.message)}</div>`; return; }
    _prog = { data: data, tile: _prog && _prog.data && _prog.data.client.id === data.client.id ? _prog.tile : null };
    renderProgramme();
  }
  function renderProgramme() {
    const vc = document.getElementById('view-container');
    if (!vc || !_prog) return;
    const d = _prog.data, s = d.settings || {};
    const t = d.tiles || {};
    const classCount = Object.values(t.openFindingsByClass || {}).reduce((n, l) => n + l.length, 0);
    const tiles = [
      ['findings', 'Open findings', classCount, Object.entries(t.openFindingsByClass || {}).map(([k, l]) => `${FINDING_CLASSIFICATION_LABEL[k] || k} ${l.length}`).join(' · ') || 'none'],
      ['overdueActions', 'Overdue actions', (t.overdueActions || []).length, ''],
      ['effectivenessDue', 'Effectiveness reviews due', (t.effectivenessDue || []).length, 'next 30 days'],
      ['repeatFindings', 'Repeat findings', (t.repeatFindings || []).length, 'open'],
      ['reopenedFindings', 'Reopened findings', (t.reopenedFindings || []).length, ''],
      ['documentsDue', 'Documents due for review', (t.documentsDue || []).length, 'next 30 days'],
      ['followUpsDue', 'Follow-ups / maintenance due', (t.followUpsDue || []).length, 'next 60 days'],
    ];
    const tileItems = key => key === 'findings' ? [].concat(...Object.values(t.openFindingsByClass || {})) : (t[key] || []);
    const shown = _prog.tile ? tileItems(_prog.tile) : null;
    const latestClosed = d.timeline.filter(a => a.stage === 'closed' && !a.hasSuccessor).slice(-1)[0];
    const latest = d.timeline.slice(-1)[0];
    vc.innerHTML = `<div class="iso-prog">
      <div class="iso-prog-head">
        <button type="button" class="iso-tb-btn" onclick="ISO.openLanding()">‹ ISO</button>
        <h2 class="iso-prog-title">${esc(d.client.name)}</h2>
        <div class="muted iso-prog-sub">${esc(d.standards.map(c => 'ISO ' + c).join(' · ') || 'No standards yet')}${d.sites.length ? ' · Sites: ' + esc(d.sites.join(', ')) : ''}</div>
        <div class="iso-prog-actions">
          ${latestClosed ? `<button type="button" class="btn btn-teal btn-sm" data-id="${esc(latestClosed.id)}" onclick="ISO._openStartNext(this.dataset.id)">Start follow-up / maintenance</button>` : ''}
          ${latest ? `<button type="button" class="btn btn-ghost btn-sm" data-id="${esc(latest.id)}" onclick="ISO.openBoard(this.dataset.id)">Open ${esc(latest.ref)}</button>` : ''}
        </div>
      </div>
      <section class="card iso-prog-card" aria-labelledby="iso-prog-tl-h"><h3 id="iso-prog-tl-h" class="iso-dash-section-h">Timeline</h3>
        <ol class="iso-prog-tl">${d.timeline.map(a => `<li class="iso-prog-tl-item${a.stage === 'closed' ? ' is-closed' : ''}"><button type="button" class="iso-prog-tl-btn" data-id="${esc(a.id)}" onclick="ISO.openBoard(this.dataset.id)"><b>${esc(a.ref)}</b> ${esc(AUDIT_TYPE_LABEL[a.auditType] || a.auditType || '')}</button>
          <span class="muted">${esc(STAGE_LABEL[a.stage] || a.stage)}${a.plannedStart ? ' · ' + esc(fmtDate(a.plannedStart)) : ''}${a.completedAt ? ' · completed ' + esc(fmtTs(a.completedAt)) : ''}${a.maintenanceDue && !a.hasSuccessor ? ' · next due ' + esc(fmtDate(a.maintenanceDue)) : ''}</span></li>`).join('') || '<li class="muted">No boards yet.</li>'}</ol>
      </section>
      <section class="card iso-prog-card" aria-labelledby="iso-prog-next-h"><h3 id="iso-prog-next-h" class="iso-dash-section-h">Next audit</h3>
        <div class="iso-prog-next"><span class="iso-prog-big">${d.nextAuditDue ? esc(fmtDate(d.nextAuditDue)) : 'Not set'}</span><span class="muted">${s.frequency ? esc(PROG_FREQ[s.frequency] + (s.frequency === 'custom' && s.custom_months ? ` (${s.custom_months} months)` : '')) : 'No frequency set'}${s.industry ? ' · ' + esc(PROG_INDUSTRY[s.industry]) : ''}</span></div>
        <div class="iso-field-grid iso-prog-settings">
          <label>Next audit due<input type="date" class="form-input" id="iso-cs-next" value="${esc(s.next_audit_due || '')}"/></label>
          <label>Frequency<select class="form-input" id="iso-cs-freq"><option value="">—</option>${Object.entries(PROG_FREQ).map(([k, l]) => `<option value="${k}"${s.frequency === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label>Custom months<input type="number" min="1" max="60" class="form-input" id="iso-cs-months" value="${esc(s.custom_months || '')}"/></label>
          <label>Industry<select class="form-input" id="iso-cs-ind"><option value="">—</option>${Object.entries(PROG_INDUSTRY).map(([k, l]) => `<option value="${k}"${s.industry === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="iso-setup-wide">Notes<textarea class="form-input" id="iso-cs-notes" rows="2">${esc(s.notes || '')}</textarea></label>
        </div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Reminders come from these dates. A frequency never creates boards on its own.</p>
        <button type="button" class="btn btn-teal btn-sm" style="margin-top:10px" onclick="ISO._progSaveSettings()">Save</button>
      </section>
      <section aria-labelledby="iso-prog-tiles-h"><h3 id="iso-prog-tiles-h" class="iso-dash-section-h">Needs attention</h3>
        <div class="iso-prog-tiles">${tiles.map(([k, l, n, sub]) => `<button type="button" class="iso-prog-tile${_prog.tile === k ? ' is-on' : ''}" aria-pressed="${_prog.tile === k}" data-k="${k}" onclick="ISO._progTile(this.dataset.k)"><span class="iso-prog-n">${n}</span><span class="iso-prog-l">${esc(l)}</span>${sub ? `<span class="muted iso-prog-s">${esc(sub)}</span>` : ''}</button>`).join('')}</div>
        ${shown ? `<div class="card iso-prog-list">${shown.length ? shown.map(x => `<button type="button" class="iso-prog-row" data-id="${esc(x.auditId)}" onclick="ISO.openBoard(this.dataset.id)"><b>${esc(x.auditRef || '')}</b> ${esc(x.ref ? x.ref + ' — ' : '')}${esc(x.title || '')}${x.due ? ` <span class="muted">· due ${esc(fmtDate(x.due))}</span>` : ''}${x.repeatOf ? ` <span class="iso-fnd-badge is-repeat">Repeat</span>` : ''}</button>`).join('') : '<div class="muted" style="padding:10px">Nothing here.</div>'}</div>` : ''}
      </section>
    </div>`;
  }
  function _progTile(k) { if (!_prog) return; _prog.tile = _prog.tile === k ? null : k; renderProgramme(); }
  async function _progSaveSettings() {
    if (!_prog) return;
    const v = id => (document.getElementById(id) || {}).value || '';
    const s = _prog.data.settings || {};
    const patch = { next_audit_due: v('iso-cs-next') || null, frequency: v('iso-cs-freq') || null, industry: v('iso-cs-ind') || null, notes: v('iso-cs-notes') || null,
      custom_months: v('iso-cs-freq') === 'custom' && v('iso-cs-months') ? Number(v('iso-cs-months')) : null };
    try {
      await mutate('clientSettings.update', { clientId: _prog.data.client.id, patch: patch, expectedVersion: s.row_version || 0 });
      if (root.showToast) root.showToast('Client settings saved.');
      fillProgramme();
    } catch (e) { if (root.showToast) root.showToast('Could not save: ' + e.message, true); }
  }

  // ── Release-1 B4.6: Request from client (Documents tab) ────────────────────────────────────────
  // The documents not yet provided (key ones pre-ticked), grouped by owner; creates request rows and
  // gives a letter to copy or download. Email and the portal come later.
  let _er = null;
  function _docOpenRequest() {
    const std = boardStd();
    const reqs = _docs.reqs.filter(r => !std || r.standard_code === std);
    const scoped = _docs.docs.map(d => Object.assign({}, d, { clauses: d.clauses.filter(c => !std || c.standardCode === std) })).filter(d => d.clauses.length);
    const missing = scoped.filter(d => !d.clauses.some(c => c.provided));
    if (!missing.length) { if (root.showToast) root.showToast('Every document is provided already.'); return; }
    const keyNames = new Set(docKeySet(scoped, reqs.map(r => r.id)).map(d => d.name));
    const byId = new Map(reqs.map(r => [r.id, r]));
    const ownerOf = d => { const r = d.clauses.map(c => byId.get(c.requirementId)).find(x => x && x.responsible_uid); return r ? r.responsible_uid : ''; };
    const groups = new Map();
    for (const d of missing.sort((a, b) => b.clauses.length - a.clauses.length || a.name.localeCompare(b.name))) { const o = ownerOf(d); if (!groups.has(o)) groups.set(o, []); groups.get(o).push(d); }
    _er = { auditId: _docs.auditId, docs: missing };
    root.openGenericModal('Request documents from the client', `<div class="iso-er">
      ${[...groups].map(([o, list]) => `<fieldset class="iso-sn-group"><legend>${esc(o ? (_uidName(o) || 'Owner') : 'No owner yet')}</legend>
        ${list.map(d => `<label class="iso-sn-item"><input type="checkbox" class="iso-er-doc" value="${esc(d.name)}" data-owner="${esc(o)}"${keyNames.has(d.name) ? ' checked' : ''}/> ${esc(d.name)} <span class="muted">· ${d.clauses.length} clause${d.clauses.length === 1 ? '' : 's'}${d.requestedAt ? ' · requested ' + esc(fmtTs(d.requestedAt)) : ''}</span>${keyNames.has(d.name) ? '<span class="iso-keyflag">Key</span>' : ''}</label>`).join('')}</fieldset>`).join('')}
      <label class="iso-clause-field">Due by<input type="date" class="form-input" id="iso-er-due"/></label>
      <div class="iso-track-btns"><button type="button" class="btn btn-teal btn-sm" id="iso-er-go" onclick="ISO._docRequestApply()">Create request</button></div>
    </div>`, '600px');
  }
  async function _docRequestApply() {
    if (!_er) return;
    const picked = [...document.querySelectorAll('.iso-er-doc')].filter(c => c.checked);
    if (!picked.length) { if (root.showToast) root.showToast('Tick at least one document.', true); return; }
    const due = (document.getElementById('iso-er-due') || {}).value || null;
    const items = picked.map(c => { const d = _er.docs.find(x => x.name === c.value); return { documentName: d.name, requirementIds: d.clauses.map(x => x.requirementId), requestedFromUid: c.dataset.owner || null, dueDate: due }; });
    try {
      await mutate('evidenceRequest.create', { auditId: _er.auditId, items: items });
      const audit = _auditCache || {};
      const byId = new Map(_docs.reqs.map(r => [r.id, r]));
      const lines = items.map(it => `• ${it.documentName} — for ${it.requirementIds.map(id => byId.get(id)).filter(Boolean).map(r => 'ISO ' + r.standard_code + ' ' + r.clause).join(', ')}`);
      const text = `Hello,\n\nFor ${audit.title || 'the audit'} (${audit.ref || ''}), please send us the documents below${due ? ' by ' + fmtDate(due) : ''}. A current version of each is enough; tell us if one doesn't exist yet.\n\n${lines.join('\n')}\n\nThank you,\nEtcher Solutions`;
      _er.text = text;
      root.openGenericModal('Request created', `<div class="iso-er"><p class="muted" style="margin:0 0 8px">Copy this into an email, or download it.</p>
        <textarea class="form-input iso-er-text" id="iso-er-text" rows="12" readonly aria-label="Request letter">${esc(text)}</textarea>
        <div class="iso-track-btns" style="gap:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="ISO._docRequestCopy()">Copy</button><button type="button" class="btn btn-teal btn-sm" onclick="ISO._docRequestDownload()">Download</button></div></div>`, '600px');
      fillDocumentsTab(audit);
    } catch (e) { if (root.showToast) root.showToast('Could not create the request: ' + e.message, true); }
  }
  function _docRequestCopy() { if (!_er || !_er.text) return; (navigator.clipboard ? navigator.clipboard.writeText(_er.text) : Promise.reject()).then(() => { if (root.showToast) root.showToast('Copied.'); }).catch(() => { const t = document.getElementById('iso-er-text'); if (t) { t.select(); } }); }
  function _docRequestDownload() { if (!_er || !_er.text) return; _pdSaveFile(_er.text, `${(_auditCache && _auditCache.ref) || 'ISO'}_Document_Request.txt`); }

  // ── Release-1 B4.7: on-site audit pack (PDF, no AI) ────────────────────────────────────────────
  // A checklist of the chosen clauses, grouped by clause family or by site: Look for / Confirm /
  // Watch for, the expected documents, and blank lines for notes. Downloads with a file name.
  function _openAuditPack() {
    const audit = _auditCache; if (!audit) return;
    root.openGenericModal('On-site audit pack', `<div class="iso-er">
      <fieldset class="iso-sn-group"><legend>Clauses</legend>
        <label class="iso-sn-item"><input type="radio" name="iso-ap-which" value="open" checked/> Not yet concluded</label>
        <label class="iso-sn-item"><input type="radio" name="iso-ap-which" value="all"/> Every clause</label></fieldset>
      <fieldset class="iso-sn-group"><legend>Group by</legend>
        <label class="iso-sn-item"><input type="radio" name="iso-ap-group" value="family" checked/> Clause family</label>
        <label class="iso-sn-item"><input type="radio" name="iso-ap-group" value="site"/> Site</label></fieldset>
      <div class="iso-track-btns"><button type="button" class="btn btn-teal btn-sm" id="iso-ap-go" onclick="ISO._auditPackApply()">Download PDF</button></div>
    </div>`, '460px');
  }
  async function _auditPackApply() {
    const audit = _auditCache; if (!audit) return;
    const which = (document.querySelector('input[name="iso-ap-which"]:checked') || {}).value || 'open';
    const group = (document.querySelector('input[name="iso-ap-group"]:checked') || {}).value || 'family';
    const btn = document.getElementById('iso-ap-go'); if (btn) btn.disabled = true;
    let reqs, guidance, units = [];
    try { [reqs, guidance, units] = await Promise.all([api('requirement.list', { auditId: audit.id }), api('guidance.list', { auditId: audit.id }), api('unit.list', { auditId: audit.id }).catch(() => [])]); }
    catch (e) { if (btn) btn.disabled = false; if (root.showToast) root.showToast('Could not build the pack: ' + e.message, true); return; }
    let rows = reqs.filter(r => !['not_applicable', 'out_of_scope'].includes(r.compliance_status));
    if (which === 'open') rows = rows.filter(r => !r.compliance_status || r.compliance_status === 'not_assessed');
    rows.sort(reqClauseCompare);
    const unitName = new Map((units || []).map(u => [u.id, u.name]));
    const groups = new Map();
    for (const r of rows) {
      const keys = group === 'site' ? ((r.unit_ids || []).map(id => unitName.get(id)).filter(Boolean).length ? (r.unit_ids || []).map(id => unitName.get(id)).filter(Boolean) : ['All sites']) : [`Clause ${String(r.clause).split('.')[0]}`];
      for (const k of keys) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    }
    const build = () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
      let y = M;
      const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
      const text = (s, size, opts) => { doc.setFontSize(size); doc.setFont('helvetica', (opts && opts.bold) ? 'bold' : 'normal'); const lines = doc.splitTextToSize(String(s || ''), W - 2 * M - ((opts && opts.indent) || 0)); need(lines.length * size * 1.25); doc.text(lines, M + ((opts && opts.indent) || 0), y + size); y += lines.length * size * 1.25 + ((opts && opts.after) || 2); };
      text(`${audit.ref} — On-site audit pack`, 16, { bold: true, after: 4 });
      text(`${audit.title || ''} · ${(audit.standards || []).map(c => 'ISO ' + c).join(', ')} · ${rows.length} clauses · printed ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`, 9, { after: 12 });
      for (const [g, list] of groups) {
        need(30); text(g, 13, { bold: true, after: 6 });
        for (const r of list) {
          const gd = (guidance || {})[r.id] || {};
          const cs = gd.cheatSheet || {};
          need(60);
          text(`ISO ${r.standard_code} ${r.clause}  ${r.clause_name || ''}`, 11, { bold: true, after: 2 });
          if (r.requirement_text) text(r.requirement_text, 9, { after: 4 });
          for (const [label, items] of [['Look for', cs.lookFor], ['Confirm', cs.confirm], ['Watch for', cs.watchFor]]) if (items && items.length) text(`${label}: ${items.join('; ')}`, 9, { indent: 10 });
          if ((gd.documents || []).length) text(`Expected documents: ${gd.documents.join('; ')}`, 9, { indent: 10, after: 4 });
          need(54); doc.setDrawColor(190); for (let i = 0; i < 3; i++) { doc.line(M, y + 14, W - M, y + 14); y += 16; } y += 8;
        }
      }
      doc.save(`${audit.ref}_Onsite_Audit_Pack.pdf`);
      document.getElementById('generic-modal').classList.add('hidden');
      if (root.showToast) root.showToast(`Audit pack downloaded (${rows.length} clauses).`);
    };
    const fail = () => { if (btn) btn.disabled = false; if (root.showToast) root.showToast('Could not load the PDF tools — check the connection.', true); };
    try { if (root._ensureJsPdf) root._ensureJsPdf(() => { try { build(); } catch (e) { fail(); } }, fail); else if (window.jspdf) build(); else fail(); }
    catch (e) { fail(); }
  }

  // ── Release-1 B5.1: ISO items in Task Hub's bell (plan 7.6) ────────────────────────────────────
  // A cache filled from notification.list every 60 s and on window focus; index.html's
  // renderNotifications / updateNotifBadge merge it (the 7.6 hook). Clicking jumps to the record.
  const ISO_NOTIF_META = {
    awaiting_approval: { label: 'ISO · Sign-off', color: '#31585a', icon: '✓' }, returned: { label: 'ISO · Returned', color: '#b45309', icon: '↩' },
    derived_awaiting: { label: 'ISO · Derived', color: '#45579a', icon: '⇄' }, evidence_submitted: { label: 'ISO · Evidence', color: '#31585a', icon: '📄' },
    finding_reopened: { label: 'ISO · Reopened', color: '#a8362d', icon: '↺' }, action_assigned: { label: 'ISO · Action', color: '#31585a', icon: '→' },
    action_due: { label: 'ISO · Due', color: '#b45309', icon: '⏰' }, action_overdue: { label: 'ISO · Overdue', color: '#a8362d', icon: '⏰' },
    effectiveness_due: { label: 'ISO · Review due', color: '#b45309', icon: '⏰' }, follow_up_due: { label: 'ISO · Follow-up due', color: '#b45309', icon: '⏰' },
    report_due: { label: 'ISO · Report due', color: '#b45309', icon: '⏰' },
  };
  let _notif = { items: [], unread: 0, at: 0, busy: false };
  async function refreshNotifs() {
    if (_notif.busy || !root._isoEnabled || !_cu() || _cu().role === 'client') return;
    _notif.busy = true;
    try { const r = await api('notification.list', {}); _notif = { items: r.items || [], unread: r.unread || 0, at: Date.now(), busy: false }; if (root.updateNotifBadge) root.updateNotifBadge(); }
    catch (e) { _notif.busy = false; }
  }
  if (typeof setInterval === 'function') setInterval(refreshNotifs, 60000);
  if (root.addEventListener) root.addEventListener('focus', refreshNotifs);
  setTimeout(refreshNotifs, 3000);
  function notifUnread() { return _notif.unread || 0; }
  function notifItems() {
    if (Date.now() - _notif.at > 30000) refreshNotifs();
    const rel = ts => (root._relativeTime ? root._relativeTime(ts) : fmtTs(ts));
    return (_notif.items || []).map(n => {
      const meta = ISO_NOTIF_META[n.type] || { label: 'ISO', color: '#8da2b2', icon: '●' };
      const unread = !n.due && !n.read_at;
      const at = Date.parse(n.created_at || '') || 0;
      return { at: n.due ? Date.now() + 1 : at, html: `<div class="iso-notif-row" style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid #f0f4f8;background:${unread ? '#f8fbff' : ''};align-items:flex-start;cursor:pointer" data-iso-notif="${esc(n.due ? '' : n.id)}" data-iso-audit="${esc(n.audit_id || '')}" data-iso-entity="${esc(n.entity_type)}" data-iso-id="${esc(n.entity_id)}" onclick="ISO.onNotifClick(this)" role="button" tabindex="0">
        <div style="width:32px;height:32px;border-radius:8px;background:${meta.color}18;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;color:${meta.color}" aria-hidden="true">${meta.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${meta.color}">${esc(meta.label)}</span>${unread ? `<div style="width:7px;height:7px;border-radius:50%;background:${meta.color};flex-shrink:0"></div>` : ''}<span style="font-size:10px;color:#8da2b2;margin-left:auto">${n.due ? 'Due' : esc(rel(n.created_at))}</span></div>
          <div style="font-size:13px;font-weight:${unread ? 600 : 500};color:#1a2940;line-height:1.4">${esc(n.message)}</div>
        </div>
        ${n.due ? '' : `<button type="button" class="iso-notif-x" aria-label="Dismiss" data-id="${esc(n.id)}" onclick="event.stopPropagation();ISO.notifDismiss(this.dataset.id)" style="background:none;border:none;color:#8da2b2;cursor:pointer;font-size:13px;flex-shrink:0;padding:2px 4px;border-radius:4px">✕</button>`}
      </div>` };
    });
  }
  async function onNotifClick(el) {
    const id = el.dataset.isoNotif;
    if (id) { const n = _notif.items.find(x => x.id === id); if (n && !n.read_at) { n.read_at = new Date().toISOString(); _notif.unread = Math.max(0, _notif.unread - 1); if (root.updateNotifBadge) root.updateNotifBadge(); api('notification.markRead', { ids: [id] }).catch(() => {}); } }
    openRecord(el.dataset.isoEntity, el.dataset.isoId, el.dataset.isoAudit);
  }
  async function notifDismiss(id) {
    const n = _notif.items.find(x => x.id === id);
    _notif.items = _notif.items.filter(x => x.id !== id);
    if (n && !n.read_at) _notif.unread = Math.max(0, _notif.unread - 1);
    if (root.updateNotifBadge) root.updateNotifBadge();
    if (root.renderView) root.renderView('notifications');
    api('notification.dismiss', { ids: [id] }).catch(() => {});
  }
  // Task Hub's Mark all read / Clear all reach ISO's stored items too (due reminders stay — they are worked out).
  function notifMarkAllRead() {
    const ids = _notif.items.filter(n => !n.due && !n.read_at).map(n => n.id);
    const nowIso = new Date().toISOString();
    _notif.items.forEach(n => { if (!n.due) n.read_at = n.read_at || nowIso; }); _notif.unread = 0;
    if (ids.length) api('notification.markRead', { ids: ids }).catch(() => {});
  }
  function notifClearAll() {
    const ids = _notif.items.filter(n => !n.due).map(n => n.id);
    _notif.items = _notif.items.filter(n => n.due); _notif.unread = 0;
    if (ids.length) api('notification.dismiss', { ids: ids }).catch(() => {});
  }
  // Opens the ISO record a notification is about: board → tab → the row or drawer.
  async function openRecord(entityType, entityId, auditId) {
    if (!auditId) return;
    try { await api('audit.get', { auditId: auditId }); }
    catch (e) { if (root.showToast) root.showToast('You no longer have access to this ISO board.', true); return; }
    if (entityType === 'requirement') { _reqPendingJump = entityId; openBoard(auditId, 'requirements'); return; }
    if (entityType === 'finding') { openBoard(auditId, 'findings'); setTimeout(() => { if (_fnd.auditId === auditId) openFindingDrawer(auditId, entityId); }, 1800); return; }
    if (entityType === 'action') { openBoard(auditId, 'worklist'); setTimeout(() => _wlOpenAction(entityId, auditId), 1800); return; }
    openBoard(auditId, 'dashboard');
  }

  // ── Release-1 B5.3: CSV export of the on-screen view (staff only) ───────────────────────────────
  function _csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // formula-injection guard
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function _csvDownload(filename, header, rows) {
    const csv = [header].concat(rows).map(r => r.map(_csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function _csvName(what) { return `${(_auditCache && _auditCache.ref) || 'ISO'}_${what}_${new Date().toISOString().slice(0, 10)}.csv`; }
  // Shared between the three views below — the same row data as their CSV siblings, each kept in
  // its own function so a tab's own export never needs to know the other two exist.
  function _clausesExportRows() {
    const ids = [...document.querySelectorAll('#iso-req-tab [data-ireq]')].map(x => x.dataset.ireq);
    const byId = new Map((_req.requirements || []).map(r => [r.id, r]));
    const rows = (ids.length ? ids.map(id => byId.get(id)).filter(Boolean) : _req.requirements || []);
    return rows.map(r => [`ISO ${r.standard_code}`, r.clause, r.clause_name || '', statusText(r), r.ofi ? 'Yes' : '', GAP_REASON_LABEL[r.gap_reason] || '', r.current_system || '', r.recommended_action || '', _uidName(r.responsible_uid) || '', r.target_date || '', r.approval_state || '']);
  }
  function _actionsExportRows() {
    const std = boardStd();
    const reqs = _wl.reqs.filter(r => !std || r.standard_code === std);
    const byId = new Map(_wl.reqs.map(r => [r.id, r]));
    const items = worklistItemsFrom(reqs, _wl.actions);
    return items.map(x => [WL_PRIO[x.p], x.title, x.ref || '', x.kind === 'action' ? actionStateText(x.status, x.verification) : 'Not tracked yet', x.reqIds.map(id => byId.get(id)).filter(Boolean).map(r => `ISO ${r.standard_code} ${r.clause}`).join('; '), (x.owner && _uidName(x.owner)) || '', x.due || '']);
  }
  function _documentsExportRows() {
    const std = boardStd();
    const docs = _docs.docs.map(d => Object.assign({}, d, { clauses: d.clauses.filter(c => !std || c.standardCode === std) })).filter(d => d.clauses.length);
    return docs.map(d => [d.name, d.clauses.map(c => `ISO ${c.standardCode} ${c.clause}`).join('; '), d.clauses.some(c => c.provided) ? 'Yes' : 'No', (d.latest && d.latest.versionLabel) || '', (d.latest && d.latest.evidenceDate) || '', d.requestedAt ? d.requestedAt.slice(0, 10) : '']);
  }
  const EXPORT_HEADERS = {
    Clauses: ['Standard', 'Clause', 'Clause name', 'Status', 'OFI', 'Gap reason', 'Basis', 'Planned action', 'Owner', 'Due', 'Approval'],
    Actions: ['Priority', 'Action', 'Reference', 'State', 'Clauses', 'Owner', 'Due'],
    Documents: ['Document', 'Clauses', 'Provided', 'Revision', 'Date', 'Requested'],
  };
  function _exportClausesCsv() { _csvDownload(_csvName('Clauses'), EXPORT_HEADERS.Clauses, _clausesExportRows()); }
  function _exportActionsCsv() { _csvDownload(_csvName('Actions'), EXPORT_HEADERS.Actions, _actionsExportRows()); }
  function _exportDocumentsCsv() { _csvDownload(_csvName('Documents'), EXPORT_HEADERS.Documents, _documentsExportRows()); }

  // ── Branded Excel export (same views, same rows — presentable enough to forward to a client) ──
  // Reuses index.html's own ExcelJS helpers (_ensureExcelJs/_xlWrite), the same ones the ISO Audits
  // report export already uses for its navy header row — same look, nothing new invented.
  function _xlsxName(what) { return `${(_auditCache && _auditCache.ref) || 'ISO'}_${what}_${new Date().toISOString().slice(0, 10)}.xlsx`; }
  function _xlsxDownload(filename, sheetName, header, rows) {
    if (!root._ensureExcelJs) { if (root.showToast) root.showToast('The spreadsheet writer is not available here.', true); return; }
    root._ensureExcelJs(() => {
      try {
        const wbk = new root.ExcelJS.Workbook();
        wbk.creator = 'Etcher Task Hub'; wbk.created = new Date();
        const ws = wbk.addWorksheet(sheetName, { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] });
        root._xlWrite(ws, 1, 1, header.map(h => ({ v: h, bold: true, bg: '0d1c33', fg: 'ffffff' })));
        rows.forEach((r, i) => root._xlWrite(ws, i + 2, 1, r.map(v => ({ v: v == null ? '' : v, wrap: typeof v === 'string' && v.length > 60 }))));
        ws.columns.forEach((c, i) => { c.width = Math.max(14, Math.min(44, header[i].length + 6)); });
        wbk.xlsx.writeBuffer().then(buf => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
          a.download = filename; a.style.display = 'none';
          document.body.appendChild(a); a.click(); a.remove();
        });
      } catch (e) { if (root.showToast) root.showToast('Could not build the Excel file: ' + e.message, true); }
    }, () => { if (root.showToast) root.showToast('The spreadsheet writer could not be loaded — check the connection.', true); });
  }
  function _exportClausesXlsx() { _xlsxDownload(_xlsxName('Clauses'), 'Clauses', EXPORT_HEADERS.Clauses, _clausesExportRows()); }
  function _exportActionsXlsx() { _xlsxDownload(_xlsxName('Actions'), 'Actions', EXPORT_HEADERS.Actions, _actionsExportRows()); }
  function _exportDocumentsXlsx() { _xlsxDownload(_xlsxName('Documents'), 'Documents', EXPORT_HEADERS.Documents, _documentsExportRows()); }

  // ── Release-1 B5.2: formal report (Overview → Report) ──────────────────────────────────────────
  const REPORT_SECTION_LABEL = { executiveSummary: 'Executive summary', method: 'Method', objectivesAchieved: 'Objectives achieved', goodPractice: 'Good practice', conclusion: 'Conclusion' };
  const REPORT_SECTION_HINT = { executiveSummary: 'Two or three sentences a director can read on its own.', method: 'e.g. Document review, interviews and site observation against the clauses in scope; sampling as noted per clause.', objectivesAchieved: 'Was the audit objective met? Anything that limited it?', goodPractice: 'What the client does well.', conclusion: 'The overall conclusion.' };
  let _rep = null;
  async function _openReport() {
    const audit = _auditCache; if (!audit) return;
    let data;
    try { data = await api('report.get', { auditId: audit.id }); } catch (e) { if (root.showToast) root.showToast('Could not open the report: ' + e.message, true); return; }
    _rep = { auditId: audit.id, data: data };
    const d = data, rd = d.readiness, sec = (d.draft && d.draft.config && d.draft.config.sections) || {};
    const blockers = rd.blockers.filter(b => b.items.length);
    root.openGenericModal(`${d.title} — ${audit.ref}`, `<div class="iso-rep">
      <section class="iso-rep-ready ${rd.ready ? 'is-ready' : 'is-blocked'}" aria-label="Ready to report">
        <strong>${rd.ready ? 'Ready to report.' : 'Not ready to report yet.'}</strong>
        ${blockers.map(b => `<div class="iso-rep-blocker">${esc(b.label)} — ${b.items.length}: <span class="muted">${esc(b.items.slice(0, 8).join(', '))}${b.items.length > 8 ? ', …' : ''}</span></div>`).join('')}
        ${rd.notAssessed ? `<div class="muted iso-rep-note">${rd.notAssessed} clause${rd.notAssessed === 1 ? ' is' : 's are'} not assessed — the report will say so.</div>` : ''}
      </section>
      ${Object.keys(REPORT_SECTION_LABEL).map(k => `<label class="iso-clause-field">${esc(REPORT_SECTION_LABEL[k])}<textarea class="form-input iso-rep-sec" data-k="${k}" rows="${k === 'executiveSummary' ? 4 : 3}" placeholder="${esc(REPORT_SECTION_HINT[k])}">${esc(sec[k] || '')}</textarea></label>`).join('')}
      <p class="muted iso-rep-note">Scope, criteria, dates, team, limitations, findings, coverage, the evidence index and unverified carried-forward items come from the board and the audit setup.</p>
      ${d.versions.length ? `<label class="iso-clause-field">Why reissue? <span class="muted">(needed for a new version)</span><input class="form-input" id="iso-rep-reason"/></label>` : ''}
      <div class="iso-track-btns" style="gap:8px">
        <button type="button" class="btn btn-ghost btn-sm" onclick="ISO._repSave()">Save draft</button>
        <button type="button" class="btn btn-teal btn-sm" id="iso-rep-issue" onclick="ISO._repIssue()"${rd.ready ? '' : ' disabled title="Clear the items above first"'}>${d.versions.length ? 'Reissue as version ' + (d.versions.length + 1) : 'Issue'} and download PDF</button>
      </div>
      ${d.versions.length ? `<section class="iso-rep-versions"><h4>Issued versions</h4>${d.versions.slice().reverse().map(v => `<div class="iso-rep-v">
        <div><b>Version ${v.version_no}</b> <span class="muted">· ${esc(fmtTs(v.issued_at))}${v.supersede_reason ? ' · ' + esc(v.supersede_reason) : ''}</span></div>
        <div class="muted">${v.acknowledgements.length ? v.acknowledgements.map(a => `${esc(a.wording)} by ${esc(a.name)}${a.role ? ', ' + esc(a.role) : ''} on ${esc(fmtDate(a.acknowledged_on))}`).join('; ') : 'Not acknowledged yet.'}</div>
        <div class="iso-rep-v-btns"><button type="button" class="btn btn-ghost btn-sm" data-id="${esc(v.id)}" onclick="ISO._repDownload(this.dataset.id)">Download PDF</button>
          <button type="button" class="btn btn-ghost btn-sm" data-id="${esc(v.id)}" onclick="ISO._repAckForm(this.dataset.id)">Record acknowledgement</button></div>
        <div class="iso-rep-ack" id="iso-rep-ack-${esc(v.id)}" hidden></div></div>`).join('')}</section>` : ''}
    </div>`, '760px');
  }
  function _repSections() { const o = {}; document.querySelectorAll('.iso-rep-sec').forEach(t => { o[t.dataset.k] = t.value; }); return o; }
  async function _repSave(quiet) {
    if (!_rep) return null;
    try {
      const d = _rep.data.draft;
      const saved = await mutate('report.saveDraft', d ? { auditId: _rep.auditId, sections: _repSections(), expectedVersion: d.row_version } : { auditId: _rep.auditId, sections: _repSections() });
      _rep.data.draft = saved;
      if (!quiet && root.showToast) root.showToast('Report draft saved.');
      return saved;
    } catch (e) { if (root.showToast) root.showToast('Could not save the draft: ' + e.message, true); return null; }
  }
  async function _repIssue() {
    if (!_rep) return;
    const btn = document.getElementById('iso-rep-issue'); if (btn) btn.disabled = true;
    if (!(await _repSave(true))) { if (btn) btn.disabled = false; return; }
    try {
      const reason = (document.getElementById('iso-rep-reason') || {}).value || undefined;
      const v = await mutate('report.issue', { auditId: _rep.auditId, reason: reason });
      _repPdf(v);
      if (root.showToast) root.showToast(`Version ${v.version_no} issued.`);
      _openReport();
    } catch (e) { if (btn) btn.disabled = false; if (root.showToast) root.showToast('Could not issue: ' + e.message, true); }
  }
  async function _repDownload(versionId) {
    try { const list = await api('report.list', { auditId: _rep.auditId }); const v = list.find(x => x.id === versionId); if (v) _repPdf(v); }
    catch (e) { if (root.showToast) root.showToast('Could not download: ' + e.message, true); }
  }
  function _repAckForm(versionId) {
    const host = document.getElementById('iso-rep-ack-' + versionId); if (!host) return;
    host.hidden = false;
    host.innerHTML = `<div class="iso-field-grid"><label>Name<input class="form-input" id="iso-ack-name-${esc(versionId)}"/></label><label>Role<input class="form-input" id="iso-ack-role-${esc(versionId)}"/></label><label>Date<input type="date" class="form-input" id="iso-ack-date-${esc(versionId)}" value="${new Date().toISOString().slice(0, 10)}"/></label></div>
      <p class="muted iso-rep-note">Recorded as "Received and discussed" — acknowledgement, not agreement.</p>
      <button type="button" class="btn btn-teal btn-sm" data-id="${esc(versionId)}" onclick="ISO._repAck(this.dataset.id)">Record</button>`;
  }
  async function _repAck(versionId) {
    const v = id => (document.getElementById(id + versionId) || {}).value || '';
    try {
      await mutate('report.acknowledge', { auditId: _rep.auditId, versionId: versionId, name: v('iso-ack-name-'), role: v('iso-ack-role-') || null, date: v('iso-ack-date-') });
      if (root.showToast) root.showToast('Acknowledgement recorded.');
      _openReport();
    } catch (e) { if (root.showToast) root.showToast('Could not record it: ' + e.message, true); }
  }
  // The PDF, drawn only from the frozen version (never from live data). Etcher-branded and ready to
  // send to the client (2026-10-14): a navy cover with the white logo, then pages with the navy logo
  // in a running header, numbered sections, tables for the gaps, actions and evidence, and the
  // sign-off and acknowledgement blocks. Logos are scaled down once per visit so the file stays small.
  const _repLogoCache = {};
  function _repLogo(file, toWhite) {
    const key = file + (toWhite ? '|white' : '');
    if (_repLogoCache[key] !== undefined) return Promise.resolve(_repLogoCache[key]);
    return new Promise(resolve => {
      const done = v => { _repLogoCache[key] = v; resolve(v); };
      const img = new Image();
      img.onload = () => {
        try {
          const w = 600, h = Math.round(img.naturalHeight * w / img.naturalWidth);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const g = cv.getContext('2d');
          g.drawImage(img, 0, 0, w, h);
          // The white logo file is only ~88% opaque, which reads as grey on the navy cover: make it
          // pure white and scale its opacity so the letters are solid (edges stay smooth).
          if (toWhite) { const px = g.getImageData(0, 0, w, h), d = px.data; for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, Math.round(d[i + 3] * 255 / 220)); } g.putImageData(px, 0, 0); }
          done({ data: cv.toDataURL('image/png'), ratio: h / w, alias: key });
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = '/' + encodeURIComponent(file);
    });
  }
  const REP_GAP_REASON = { not_implemented: 'Not implemented', ineffective: 'Not effective', no_evidence: 'No evidence' };
  const REP_STATUS = { compliant: 'Compliant', partially_compliant: 'Partially compliant', non_compliant: 'Non-compliant', not_assessed: 'Not assessed', not_applicable: 'Not applicable', out_of_scope: 'Outside scope' };
  function _repPdfBuild(v, logoWhite, logoNavy) {
    const { jsPDF } = window.jspdf;
    const c = v.content || {}, snap = c.snapshot || {}, a = c.audit || {}, s = c.sections || {}, setup = c.setup || {};
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50, CW = W - 2 * M;
    const NAVY = [13, 28, 51], TEAL = [151, 188, 189], TEAL_D = [49, 88, 90], INK = [13, 28, 51], INK2 = [67, 83, 105], INK3 = [92, 107, 128], LINE = [226, 231, 234], PAPER = [243, 246, 247], WHITE = [255, 255, 255];
    const hex = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16));
    const stColor = k => hex(COMPLIANCE_STATUS_COLOR[k] || '#7a8799');
    const font = (style, size, color) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...(color || INK)); };
    const fmtD = d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set';
    const clauses = snap.clauses || [];
    const count = st => clauses.filter(x => x.status === st).length;
    const inScope = clauses.filter(x => x.status !== 'out_of_scope');
    const assessed = inScope.filter(x => x.status !== 'not_assessed');
    const client = a.clientName || 'Client';
    const title = v.title || 'Audit report';
    const stdList = (c.standards || []).map(x => 'ISO ' + x.code + (x.edition ? ':' + x.edition : ''));
    const lead = c.signedBy || '';
    const roleText = r => { const t = String(r || '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

    // ── Cover ───────────────────────────────────────────────────────────────────────────────────
    const coverH = Math.round(H * 0.58);
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, coverH, 'F');
    doc.setFillColor(...TEAL); doc.rect(0, coverH, W, 5, 'F');
    if (logoWhite) doc.addImage(logoWhite.data, 'PNG', M - 6, 46, 160, 160 * logoWhite.ratio, logoWhite.alias, 'FAST');
    else { font('bold', 24, WHITE); doc.text('ETCHER', M, 84); font('normal', 8, TEAL); doc.text('SOLUTIONS', M, 98, { charSpace: 3 }); }
    font('bold', 7.5, TEAL); doc.text('ISO AUDIT REPORT', W - M, 66, { align: 'right', charSpace: 1.4 });
    let y = coverH - 136;
    font('bold', 34, WHITE); doc.text(title, M, y);
    y += 32; font('normal', 19, TEAL);
    const clientLines = doc.splitTextToSize(client, CW); doc.text(clientLines, M, y); y += 22 * clientLines.length;
    font('normal', 10.5, [190, 205, 218]); doc.text(`${a.ref || ''}   ·   Version ${v.version_no}   ·   Issued ${fmtD(v.issued_at)}`, M, y + 4);
    const meta = [
      ['Prepared for', client], ['Prepared by', 'Etcher Solutions' + (lead ? '\nLead Auditor: ' + lead : '')],
      ['Audit dates', a.plannedStart || a.plannedEnd ? `${fmtD(a.plannedStart)} to ${fmtD(a.plannedEnd)}` : 'Not set'], ['Audit type', AUDIT_TYPE_LABEL[a.auditType] || roleText(a.auditType) || 'Audit'],
      ['Standards', stdList.join('\n') || '—'], ['Report version', `Version ${v.version_no}${v.supersede_reason ? ' (reissued: ' + v.supersede_reason + ')' : ''}`],
    ];
    const colW = (CW - 24) / 2;
    let my = coverH + 52;
    for (let i = 0; i < meta.length; i += 2) {
      let rowH = 0;
      for (let j = 0; j < 2 && i + j < meta.length; j++) {
        const [k, val] = meta[i + j], x = M + j * (colW + 24);
        font('bold', 7, TEAL_D); doc.text(k.toUpperCase(), x, my, { charSpace: 0.9 });
        font('normal', 10.5, INK); const lines = doc.splitTextToSize(val, colW); doc.text(lines, x, my + 15);
        rowH = Math.max(rowH, 15 + lines.length * 13);
      }
      my += rowH + 18;
    }
    font('normal', 7.5, INK3);
    doc.text(doc.splitTextToSize(`Confidential. Prepared by Etcher Solutions for ${client}.`, CW), M, H - 44);

    // ── Body pages ──────────────────────────────────────────────────────────────────────────────
    const TOP = 88, BOTTOM = H - 58;
    const newPage = () => { doc.addPage(); y = TOP; };
    newPage();
    const need = h => { if (y + h > BOTTOM) newPage(); };
    let secNo = 0;
    // `room` keeps a heading with the start of what follows (a table needs its head and a row or two).
    const section = (t, room) => {
      need(room || 64); if (y > TOP + 1) y += 16;
      secNo++;
      font('bold', 15, TEAL_D); doc.text(String(secNo), M, y + 14);
      font('bold', 15, NAVY); doc.text(t, M + 22, y + 14);
      y += 24; doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 14;
    };
    const para = (str, o) => {
      o = o || {}; const size = o.size || 10, lh = size * 1.55;
      font(o.bold ? 'bold' : 'normal', size, o.color || INK2);
      for (const block of String(str == null || str === '' ? '—' : str).split('\n')) {
        for (const ln of doc.splitTextToSize(block || ' ', CW - (o.indent || 0))) { need(lh); doc.text(ln, M + (o.indent || 0), y + size); y += lh; }
      }
      y += o.after != null ? o.after : 6;
    };
    const sub = t => { need(34); font('bold', 10.5, NAVY); doc.text(t, M, y + 10); y += 20; };
    const table = (head, body, opts) => {
      doc.autoTable(Object.assign({
        head: [head], body, startY: y, theme: 'grid', margin: { left: M, right: M, top: TOP, bottom: H - BOTTOM },
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, right: 6, bottom: 5, left: 6 }, textColor: INK2, lineColor: LINE, lineWidth: 0.5, valign: 'top', overflow: 'linebreak' },
        headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 251] },
      }, opts || {}));
      y = doc.lastAutoTable.finalY + 18;
    };
    // A status cell takes its colour from the board's own status palette.
    const statusCell = col => ({ didParseCell: d => { if (d.section === 'body' && d.column.index === col && d.cell.raw && d.cell.raw._st) { d.cell.styles.textColor = stColor(d.cell.raw._st); d.cell.styles.fontStyle = 'bold'; } } });
    const stCell = (st, extra) => ({ content: REP_STATUS[st] + (extra ? '\n' + extra : ''), _st: st });

    // 1 At a glance
    section('At a glance');
    const tiles = [['In scope', inScope.length, NAVY], ['Assessed', assessed.length, NAVY], ['Compliant', count('compliant'), stColor('compliant')],
      ['Partially compliant', count('partially_compliant'), stColor('partially_compliant')], ['Non-compliant', count('non_compliant'), stColor('non_compliant')], ['OFIs', clauses.filter(x => x.ofi).length, stColor('ofi')]];
    const tw = (CW - 5 * 8) / 6;
    need(70);
    tiles.forEach(([label, n, col], i) => {
      const x = M + i * (tw + 8);
      doc.setFillColor(...PAPER); doc.roundedRect(x, y, tw, 58, 5, 5, 'F');
      font('bold', 21, col); doc.text(String(n), x + 10, y + 28);
      font('bold', 6.5, INK3); doc.text(doc.splitTextToSize(label.toUpperCase(), tw - 16), x + 10, y + 42, { charSpace: 0.4 });
    });
    y += 74;
    const segs = ['compliant', 'partially_compliant', 'non_compliant', 'not_applicable', 'not_assessed'].map(k => ({ k, n: count(k) })).filter(x => x.n);
    const total = segs.reduce((t, x) => t + x.n, 0);
    if (total) {
      need(46);
      let bx = M;
      segs.forEach(sg => { const w = CW * sg.n / total; doc.setFillColor(...stColor(sg.k)); doc.rect(bx, y, w, 10, 'F'); bx += w; });
      y += 24; let lx = M;
      segs.forEach(sg => {
        const label = `${REP_STATUS[sg.k]} ${sg.n}`;
        font('normal', 8.5, INK2);
        const w = doc.getTextWidth(label) + 22;
        if (lx + w > W - M) { lx = M; y += 14; }
        doc.setFillColor(...stColor(sg.k)); doc.rect(lx, y - 7, 8, 8, 'F'); doc.text(label, lx + 12, y); lx += w;
      });
      y += 22;
    }
    const byStd = (c.standards || []).map(sd => {
      const xs = clauses.filter(x => x.standard === sd.code), n = st => xs.filter(x => x.status === st).length;
      return ['ISO ' + sd.code + (sd.edition ? ':' + sd.edition : ''), xs.length, n('compliant'), n('partially_compliant'), n('non_compliant'), n('not_applicable'), n('not_assessed')];
    });
    if (byStd.length) table(['Standard', 'Clauses', 'Compliant', 'Partially', 'Non-compliant', 'N/A', 'Not assessed'], byStd, { columnStyles: { 0: { fontStyle: 'bold', textColor: INK, cellWidth: 150 } } });

    // 2 Executive summary
    section('Executive summary');
    para(s.executiveSummary);

    // 3 Audit details
    section('Audit details', 130);
    const team = (c.team || []).map(m => `${m.name} (${roleText(m.role)})`).join('\n');
    const details = [
      ['Objective', setup.objective], ['Scope', setup.scope || a.title], ['Criteria', stdList.join(', ') + (setup.criteria ? '\n' + setup.criteria : '')],
      ['Dates', `${fmtD(a.plannedStart)} to ${fmtD(a.plannedEnd)}${a.completedAt ? '; completed ' + fmtD(a.completedAt) : ''}`], ['Audit team', team || '—'],
      ['Method', s.method || 'Document review, interviews and observation against the clauses in scope.'], ['Limitations', setup.limitations || 'None recorded.'],
      ['Objectives achieved', s.objectivesAchieved], ['Coverage', `${clauses.length} clauses: ${count('compliant')} compliant, ${count('partially_compliant')} partially compliant, ${count('non_compliant')} non-compliant, ${count('not_assessed')} not assessed, ${count('not_applicable')} not applicable${count('out_of_scope') ? ', ' + count('out_of_scope') + ' outside this audit\'s scope' : ''}.`],
    ].filter(r => r[1]);
    table(['', ''], details, { showHead: false, columnStyles: { 0: { cellWidth: 118, fontStyle: 'bold', textColor: INK, fillColor: PAPER } }, alternateRowStyles: {} });

    // 4 Findings (formal audits raise them; a gap analysis usually doesn't)
    const findings = c.findings || [];
    if (findings.length) {
      section('Findings', 130);
      const CLASS = { major_nc: 'Major non-conformity', minor_nc: 'Minor non-conformity', observation: 'Observation', ofi: 'Opportunity for improvement' };
      table(['Ref', 'Classification', 'Finding', 'Status'], findings.map(f => [f.ref, CLASS[f.classification] || roleText(f.classification), [f.title, f.statement, f.criteria ? 'Criteria: ' + f.criteria : null, f.repeatOf ? 'Repeat of ' + f.repeatOf : null].filter(Boolean).join('\n'), roleText(f.status)]),
        { columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold', textColor: INK }, 1: { cellWidth: 100 }, 3: { cellWidth: 64 } } });
    }

    // 5 Non-conformities and gaps
    section('Non-conformities and gaps', 130);
    const gaps = clauses.filter(x => x.status === 'non_compliant' || x.status === 'partially_compliant').sort((p, q) => (p.status === 'non_compliant' ? 0 : 1) - (q.status === 'non_compliant' ? 0 : 1));
    if (gaps.length) table(['Clause', 'Requirement', 'Status', 'What we found', 'Planned action'],
      gaps.map(x => [`${x.standard} ${x.clause}`, x.clauseName, stCell(x.status, REP_GAP_REASON[x.gapReason]), x.basis || '—', x.plannedAction || '—']),
      Object.assign({ columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: INK }, 1: { cellWidth: 86 }, 2: { cellWidth: 82 }, 4: { cellWidth: 100 } } }, statusCell(2)));
    else para('No non-conformities or gaps recorded.');

    // 6 OFIs and good practice
    section('Opportunities for improvement and good practice', 130);
    const ofi = clauses.filter(x => x.ofi);
    if (ofi.length) table(['Clause', 'Requirement', 'Observation'], ofi.map(x => [`${x.standard} ${x.clause}`, x.clauseName, x.basis || '—']), { columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: INK }, 1: { cellWidth: 130 } } });
    else para('No opportunities for improvement recorded.');
    if (s.goodPractice) { sub('Good practice'); para(s.goodPractice); }

    // 7 Actions
    const actions = c.actions || [];
    if (actions.length) {
      section('Agreed actions', 130);
      table(['Ref', 'Action', 'Due', 'Status'], actions.map(x => [x.ref || '', x.title, x.due ? fmtD(x.due) : '—', ACTION_STATUS_LABEL[x.status] || roleText(x.status)]),
        { columnStyles: { 0: { cellWidth: 82, fontStyle: 'bold', textColor: INK }, 2: { cellWidth: 92 }, 3: { cellWidth: 92 } } });
    }

    // 8 Carried forward
    const carried = findings.filter(f => f.carriedFrom && f.status !== 'closed').map(f => [f.ref, f.title, f.carriedFrom])
      .concat(actions.filter(x => x.carriedFrom && !['verified', 'closed'].includes(x.status)).map(x => [x.ref, x.title, x.carriedFrom]));
    if (carried.length) { section('Carried forward, not yet verified', 130); table(['Ref', 'Item', 'From'], carried, { columnStyles: { 0: { cellWidth: 82, fontStyle: 'bold' }, 2: { cellWidth: 90 } } }); }

    // 9 Evidence index — one row per document, with every clause it supports
    section('Evidence index', 130);
    const docs = new Map();
    for (const x of clauses) for (const d of (x.documents || [])) {
      const k = [d.title, d.revision || '', d.date || ''].join('|');
      if (!docs.has(k)) docs.set(k, { d, refs: [] });
      docs.get(k).refs.push(`${x.standard} ${x.clause}`);
    }
    if (docs.size) table(['Document', 'Revision', 'Date', 'Supports'], [...docs.values()].sort((p, q) => q.refs.length - p.refs.length).map(({ d, refs }) => [d.title + (d.sha256 ? '\nSHA-256 ' + d.sha256.slice(0, 16) + '…' : ''), d.revision || '—', d.date ? fmtD(d.date) : '—', refs.join(', ')]),
      { columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold', textColor: INK }, 1: { cellWidth: 52 }, 2: { cellWidth: 78 } } });
    else para('No documents linked.');

    // 10 Conclusion
    if (s.conclusion) { section('Conclusion'); para(s.conclusion); }

    // 11 Sign-off and acknowledgement
    section('Sign-off', 210);
    const bw = (CW - 16) / 2, bh = 160;
    const box = (x, head, rows) => {
      doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.setFillColor(...WHITE); doc.roundedRect(x, y, bw, bh, 6, 6, 'FD');
      font('bold', 7, TEAL_D); doc.text(head.toUpperCase(), x + 14, y + 20, { charSpace: 0.9 });
      let ry = y + 44;
      rows.forEach(([k, val]) => {
        font('normal', 8, INK3); doc.text(k, x + 14, ry);
        if (val) { font('bold', 9.5, INK); doc.text(val, x + 84, ry); }
        else { doc.setDrawColor(...[176, 188, 198]); doc.setLineWidth(0.6); doc.line(x + 84, ry + 2, x + bw - 14, ry + 2); }
        ry += 22;
      });
    };
    box(M, 'Lead Auditor — Etcher Solutions', [['Name', lead], ['Signature', null], ['Date', fmtD(v.issued_at)]]);
    box(M + bw + 16, 'Client acknowledgement', [['Recorded as', c.ackWording || 'Received and discussed'], ['Name', null], ['Role', null], ['Signature', null], ['Date', null]]);
    y += bh + 14;
    para(`Acknowledgement records that this report was received and discussed; it is not agreement with every conclusion.`, { size: 8, color: INK3, after: 14 });
    para(`Library release ${c.libraryRelease || 'v3'} · calculation ${c.calcVersion || ''}`, { size: 7.5, color: INK3, after: 2 });
    para(c.disclaimer || '', { size: 7.5, color: INK3 });

    // Running header and footer on every page after the cover.
    const pages = doc.internal.getNumberOfPages();
    for (let p = 2; p <= pages; p++) {
      doc.setPage(p);
      // One alias, so the logo is stored once in the file, not once per page.
      if (logoNavy) doc.addImage(logoNavy.data, 'PNG', M - 4, 18, 76, 76 * logoNavy.ratio, logoNavy.alias, 'FAST');
      else { font('bold', 12, NAVY); doc.text('ETCHER', M, 44); }
      font('normal', 8, INK3); doc.text(`${title}  ·  ${client}  ·  ${a.ref || ''}`, W - M, 46, { align: 'right' });
      doc.setDrawColor(...TEAL); doc.setLineWidth(1.4); doc.line(M, 62, W - M, 62);
      doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(M, H - 42, W - M, H - 42);
      font('normal', 7.5, INK3); doc.text(`Etcher Solutions  ·  Confidential — prepared for ${client}`, M, H - 28);
      doc.text(`Page ${p - 1} of ${pages - 1}`, W - M, H - 28, { align: 'right' });
    }
    return doc;
  }
  function _repPdf(v) {
    const fail = msg => { if (root.showToast) root.showToast(msg || 'Could not load the PDF tools — check the connection.', true); };
    const start = () => Promise.all([_repLogo('Etcher White Logo.png', true), _repLogo('Etcher_Logo_2026.png')]).then(([w, n]) => {
      let doc;
      try { doc = _repPdfBuild(v, w, n); } catch (e) { console.error(e); fail('Could not build the PDF: ' + e.message); return; }
      const a = (v.content && v.content.audit) || {};
      doc.save(`${a.ref || 'ISO'}_${String(v.title || 'Report').replace(/\s+/g, '_')}_v${v.version_no}.pdf`);
    });
    try { if (root._ensureJsPdf) root._ensureJsPdf(start, () => fail()); else if (window.jspdf) start(); else fail(); } catch (e) { fail(); }
  }

  // A clause chip anywhere (Actions) opens Clauses with that clause expanded and in view.
  let _reqPendingJump = null;
  function _reqJumpTo(id) { _reqPendingJump = id; setTab('requirements'); }

  function renderDashboardTab(auditId) {
    const host = document.getElementById('iso-dash-tab');
    if (!host || !_dash.data || !_auditCache || _dash.auditId !== auditId) return;
    const d = _dash.data, audit = _auditCache;
    const stdText = d.standard ? stdLabel(d.standard) : '';
    host.innerHTML = `
      ${_dashHeaderHtml(audit, d)}
      ${_dashFilterBarHtml(audit, d.standard)}
      ${_dashCarriedHtml(d.carried)}
      ${_dashAttentionHtml(d.panels)}
      <section class="iso-dash-section" aria-labelledby="iso-dash-kpi-h">
        <h3 id="iso-dash-kpi-h" class="iso-dash-section-h">Key figures${stdText ? ' — ' + esc(stdText) : ''}</h3>
        ${_dashKpiGroupsHtml(d.kpis, stdText)}
        ${_dashFormulasHtml(d.kpis)}
      </section>
      <section class="iso-dash-section" aria-labelledby="iso-dash-results-h">
        <h3 id="iso-dash-results-h" class="iso-dash-section-h">Assessment results${stdText ? ' — ' + esc(stdText) : ''}</h3>
        ${_dashResultsSummaryHtml(d.charts.req_by_result.segments, d.data_as_at)}
      </section>
      ${_dashWorkPanelsHtml(d.panels)}
      ${_dashSharedHtml(d.panels)}
      ${_dashEvidencePanelHtml(d.charts)}
      ${_dashCardsHtml(d.cards)}
      <section class="iso-dash-section" aria-labelledby="iso-dash-matrix-h">
        <h3 id="iso-dash-matrix-h" class="iso-dash-section-h">Clause matrix</h3>
        <div class="iso-dash-section-note">Every standard, every clause — not affected by the standard filter above.</div>
        ${_dashClauseMatrixHtml(d.clause_matrix, audit.standards)}
      </section>
      ${_dashActivityHtml(d.panels)}
      <section class="iso-dash-section" aria-labelledby="iso-dash-charts-h">
        <h3 id="iso-dash-charts-h" class="iso-dash-section-h">Charts${stdText ? ' — ' + esc(stdText) : ''}</h3>
        ${_dashChartsHtml(d.charts, d.data_as_at)}
      </section>`;
  }
  async function fillDashboardTab(audit) {
    const host = document.getElementById('iso-dash-tab');
    if (!host) return;
    // The route's standard only applies while it is one of this board's own (D29).
    const standard = route.dashStd && (audit.standards || []).includes(route.dashStd) ? route.dashStd : null;
    const seq = ++_dashSeq;
    let data;
    try {
      data = await api('dashboard.audit', standard ? { auditId: audit.id, standard: standard } : { auditId: audit.id });
    } catch (e) {
      if (seq !== _dashSeq) return;
      host.innerHTML = `<div class="card" style="padding:16px;color:#b91c1c;margin-top:16px">Could not load the dashboard: ${esc(e.message)}</div>`;
      return;
    }
    if (seq !== _dashSeq) return;
    _dash = { auditId: audit.id, data: data, mode: 'full' };
    renderDashboardTab(audit.id);
  }
  // Kept as its own name for the dashboard's "Showing … only" clear button — delegates to
  // _boardSetStandard so the header strip (now the one place the standard buttons live) always
  // stays in sync, however the change was triggered.
  function _dashSetStandard(code) { _boardSetStandard(code); }

  async function _subtaskAdd(actionId) {
    const input = document.getElementById('ad-subtask');
    const title = input && input.value.trim();
    if (!title) return;
    try {
      const created = await mutate('subtask.add', { auditId: _act.auditId, actionId: actionId, title: title });
      _act.subtasks.push(created);
      openActionDrawer(_act.auditId, actionId);
      renderActionsTable(_act.auditId);
    } catch (e) { root.showToast ? root.showToast('Could not add subtask: ' + e.message, true) : alert(e.message); }
  }
  async function _subtaskToggle(id, expectedVersion, done) {
    try {
      const updated = await mutate('subtask.update', { auditId: _act.auditId, id: id, patch: { done: done }, expectedVersion: expectedVersion });
      const s = _act.subtasks.find(x => x.id === id); if (s) Object.assign(s, updated);
      renderActionsTable(_act.auditId);
    } catch (e) {
      root.showToast ? root.showToast('Could not update subtask: ' + e.message, true) : alert(e.message);
      if (_openDrawerActId) openActionDrawer(_act.auditId, _openDrawerActId); // revert the checkbox to the real state
    }
  }
  async function _actAddComment(id) {
    const input = document.getElementById('ad-comment');
    const bodyText = input && input.value.trim();
    if (!bodyText) return;
    try {
      await mutate('comment.add', { auditId: _act.auditId, body: bodyText, entityType: 'action', entityId: id });
      openActionDrawer(_act.auditId, id);
    } catch (e) { root.showToast ? root.showToast('Could not post comment: ' + e.message, true) : alert(e.message); }
  }

  function renderAdmin(vc) {
    setTimeout(fillAdmin, 0);
    return `<div>${skeletonRows(4)}</div>`;
  }
  async function fillAdmin() {
    const vc = document.getElementById('view-container');
    if (!vc) return;
    let versions, config, seeds, usage;
    try { [versions, config, seeds, usage] = await Promise.all([api('library.versions'), api('config.get'), api('library.seeds'), api('evidence.storageUsage').catch(() => null)]); }
    catch (e) { vc.innerHTML = `<div class="card" style="padding:20px;color:#b91c1c">Could not load the ISO library: ${esc(e.message)}</div>`; return; }
    const rows = versions.map(v => `<tr>
      <td>${esc(v.standard_code)}</td><td>${esc(v.edition || '—')}</td><td>${esc(v.label)}</td><td>${esc(v.status)}</td>
      <td>${v.status === 'draft' ? `<button class="btn btn-teal btn-sm" data-label="${esc(v.label)}" onclick="ISO._approveVersion('${esc(v.id)}',this.dataset.label)">Approve</button>
          <button class="btn btn-ghost btn-sm" data-label="${esc(v.label)}" onclick="ISO._retireVersion('${esc(v.id)}',this.dataset.label,false)">Discard draft</button>`
        : v.status === 'approved' ? `<button class="btn btn-ghost btn-sm" data-label="${esc(v.label)}" onclick="ISO._retireVersion('${esc(v.id)}',this.dataset.label,true)">Retire</button>`
        : '—'}</td>
    </tr>`).join('');
    // Plan 4b.1 (R13, D24): the reviewed built-in library — one click instead of a workbook upload.
    const isAdmin = _cu() && _cu().role === 'admin';
    // "Load all" = the reviewed seeds; a drafted edition (4b.2) loads on its own, for review.
    const unloaded = seeds.filter(s => !s.loadedVersionId && s.seedStatus === 'approved');
    const seedRows = seeds.map(s => `<tr data-seed="${esc(s.seedKey)}" data-seed-status="${esc(s.seedStatus)}" style="vertical-align:top">
      <td>${esc(s.label)}</td><td>${s.requirementCount}</td>
      <td>${s.loadedVersionId ? `Loaded (${esc(s.loadedStatus)})` : (isAdmin ? `<button class="btn ${s.seedStatus === 'approved' ? 'btn-teal' : 'btn-ghost'} btn-sm" onclick="ISO._loadLibrarySeed('${esc(s.seedKey)}')">${s.seedStatus === 'approved' ? 'Load' : 'Load draft for review'}</button>` : 'Not loaded')}</td>
      <td style="color:#8da2b2">${esc(s.scopeNote || '')}
        ${(s.changes || []).length ? `<details class="iso-seed-changes" style="margin-top:4px;color:#4a5568"><summary style="cursor:pointer;color:#0d1c33">What changed (${s.changes.length})${s.basedOn ? ' — compared with ' + esc(s.basedOn) : ''}</summary>
          <ul style="margin:6px 0 0 16px;padding:0">${s.changes.map(c => `<li style="margin-bottom:4px"><strong>${esc(CHANGE_KIND_LABEL[c.kind] || c.kind)} · ${esc(c.clause)}</strong> — ${esc(c.summary)}<div style="color:#8da2b2">${(c.sources || []).map(x => esc(x.title)).join('; ')}</div></li>`).join('')}</ul></details>` : ''}</td>
    </tr>`).join('');
    vc.innerHTML = `<h2>ISO library</h2>
      <div class="card" id="iso-admin-seeds" style="padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;margin-bottom:6px"><div style="font-weight:700;flex:1">Built-in library</div>
          ${isAdmin && unloaded.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="ISO._loadLibrarySeed(null)">Load all</button>` : ''}</div>
        <div style="font-size:12px;color:#6b8399;margin-bottom:10px">Etcher's own wording of each requirement, reviewed in the code — no upload needed. Not ISO text: check the licensed standard for the authoritative wording.</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#6b8399"><th>Edition</th><th>Requirements</th><th>Status</th><th>Note</th></tr></thead><tbody>${seedRows}</tbody></table>
      </div>
      <div class="card" style="padding:16px;margin-bottom:16px">
        <div style="font-weight:700;margin-bottom:10px">Library versions</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#6b8399"><th>Standard</th><th>Edition</th><th>Label</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="color:#8da2b2">None loaded yet.</td></tr>'}</tbody></table>
        <div style="font-size:12px;color:#6b8399;margin-top:14px">Or import a workbook into the library (optional):</div>
        <div id="iso-admin-import" style="margin-top:8px"></div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-weight:700;margin-bottom:10px">Config</div>
        <div style="font-size:12px;color:#4a5568">evidence_max_upload_mb: <input id="iso-cfg-upload-mb" type="number" min="1" max="25" class="form-input" style="width:80px;display:inline-block" value="${esc((config && config.evidence_max_upload_mb) || 10)}"/>
        <button class="btn btn-ghost btn-sm" onclick="ISO._saveUploadCap()">Save</button></div>
        ${isAdmin ? `<div style="display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12px;color:#4a5568"><span style="flex:1">Learning signals — what the app records about suggestions you accept or skip (no UI of its own yet).</span><button class="btn btn-ghost btn-sm" id="iso-export-signals" onclick="ISO._exportSignals()">Export signals</button></div>` : ''}
        ${usage ? `<div class="iso-storage-used" style="font-size:12px;color:#4a5568;margin-top:8px">Evidence storage used: <strong>${esc(_fmtBytes(usage.bytes))}</strong> in ${usage.files} file${usage.files === 1 ? '' : 's'} — links use none.</div>` : ''}
      </div>`;
    const importHost = document.getElementById('iso-admin-import');
    if (importHost && root.ISO && root.ISO.import) root.ISO.import.openImport ? root.ISO.import.openImport('library', importHost) : null;
  }
  // Release-1 B3.4: the captured learning signals as a JSON file (admin only; a download, never a tab).
  async function _exportSignals() {
    try {
      const data = await api('signal.export', {});
      _pdSaveFile(JSON.stringify(data, null, 2), `ISO_learning_signals_${new Date().toISOString().slice(0, 10)}.json`);
      if (root.showToast) root.showToast(`Exported ${data.count} signal${data.count === 1 ? '' : 's'}.`);
    } catch (e) { if (root.showToast) root.showToast('Could not export: ' + e.message, true); }
  }
  // Approving a library version has no undo, so it asks first (in the app's own modal) — and for a
  // drafted edition (4b.2) repeats the one check that matters: every row against the licensed standard.
  function _approveVersion(id, label) {
    root.openGenericModal('Approve library version', `<div style="font-size:13px;color:#4a5568;line-height:1.6">
      <p style="margin:0 0 10px"><strong>${esc(label || 'This version')}</strong> will be offered to new boards. Approval cannot be undone.</p>
      <p style="margin:0 0 14px">If it is a drafted edition, approve it only after checking every requirement against the licensed standard.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="closeGenericModal()">Cancel</button><button class="btn btn-teal btn-sm" id="iso-approve-confirm" data-id="${esc(id)}" onclick="ISO._approveVersionConfirmed(this.dataset.id)">Approve</button></div></div>`, '520px');
  }
  async function _approveVersionConfirmed(id) {
    try { await mutate('library.approve', { id: id }); if (root.closeGenericModal) root.closeGenericModal(); root.renderView('iso-admin'); }
    catch (e) { root.showToast ? root.showToast('Could not approve: ' + e.message, true) : null; }
  }
  // Retiring (or discarding a never-used draft) has no undo either — never a real delete (library
  // records are kept forever, same as everywhere else in ISO), just marked so it stops being
  // offered. A retired edition's existing boards are completely unaffected; the modal says so.
  function _retireVersion(id, label, wasApproved) {
    const verb = wasApproved ? 'Retire' : 'Discard draft';
    root.openGenericModal(verb + ' library version', `<div style="font-size:13px;color:#4a5568;line-height:1.6">
      <p style="margin:0 0 10px"><strong>${esc(label || 'This version')}</strong> will ${wasApproved ? 'no longer be offered to new boards' : 'be discarded — it was never offered to any board'}. This cannot be undone.</p>
      <p style="margin:0 0 14px">${wasApproved ? 'Boards already created on this edition keep working exactly as before.' : 'Nothing else is affected.'}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="closeGenericModal()">Cancel</button><button class="btn btn-teal btn-sm" id="iso-retire-confirm" data-id="${esc(id)}" onclick="ISO._retireVersionConfirmed(this.dataset.id)">${esc(verb)}</button></div></div>`, '520px');
  }
  async function _retireVersionConfirmed(id) {
    try { await mutate('library.retire', { id: id }); if (root.closeGenericModal) root.closeGenericModal(); root.renderView('iso-admin'); }
    catch (e) { root.showToast ? root.showToast('Could not retire: ' + e.message, true) : null; }
  }
  async function _loadLibrarySeed(seedKey) {
    try {
      const results = await mutate('library.loadSeed', seedKey ? { seedKey: seedKey } : {});
      const loaded = results.filter(r => !r.skipped).length;
      root.showToast ? root.showToast(loaded ? `Loaded ${loaded} built-in librar${loaded === 1 ? 'y' : 'ies'}.` : 'Already loaded.') : null;
      root.renderView('iso-admin');
    } catch (e) { root.showToast ? root.showToast('Could not load the built-in library: ' + e.message, true) : alert(e.message); }
  }
  async function _saveUploadCap() {
    const v = Number(document.getElementById('iso-cfg-upload-mb').value);
    try { await mutate('config.set', { key: 'evidence_max_upload_mb', value: v }); root.showToast ? root.showToast('Saved.') : null; }
    catch (e) { root.showToast ? root.showToast('Could not save: ' + e.message, true) : alert(e.message); }
  }

  // ── Import workbook entry point (delegates to iso/iso-import.js's openImport; the sidebar's
  // "Import workbook…" instead runs the new-board wizard with thenImport:true, since creating the
  // audit from a client/access pick is a prerequisite the import itself doesn't do — plan 4.6/5.1) ─
  function openImport(kind, opts) {
    opts = opts || {};
    root.openGenericModal(kind === 'library' ? 'Import ISO library workbook' : 'Import workbook into this ISO board', '', '640px');
    const body = document.getElementById('generic-modal-body');
    if (root.ISO && root.ISO.import && root.ISO.import.openImport) {
      root.ISO.import.openImport(kind, body, { targetAuditId: opts.targetAuditId, onApplied: () => { document.getElementById('generic-modal').classList.add('hidden'); invalidate(); root.renderView('iso'); } });
    } else {
      body.innerHTML = '<div style="color:#b91c1c">The import module failed to load.</div>';
    }
  }
  function openImportFromMenu() { openNewBoard({ thenImport: true }); }

  // ── Phase 7b.3 (D13): the Task Hub Reports page's third tab, "ISO audits" — one row per board
  // the caller can see, combining audit.list, one metric.audit call per board, and this device's
  // own DB.timeEntries (hours are plain Task Hub data, never round-tripped through an ISO op —
  // same reasoning Phase 7b.2's "Hours logged" on the action drawer already used). ───────────────
  let _isoRpt = { from: '', to: '' };
  function _isoRptSetRange(which, val) { _isoRpt[which] = val; fillReportsTab(); }
  function _isoRptHoursFor(auditId) {
    const entries = (_DB().timeEntries || []).filter(e => !e.deletedAt && e.isoAuditId === auditId
      && (!_isoRpt.from || e.date >= _isoRpt.from) && (!_isoRpt.to || e.date <= _isoRpt.to));
    const total = entries.reduce((s, e) => s + (e.hours || 0), 0);
    const approved = entries.filter(e => e.status === 'approved').reduce((s, e) => s + (e.hours || 0), 0);
    const billable = entries.filter(e => e.billable !== false).reduce((s, e) => s + (e.hours || 0), 0);
    return { total, approved, billable };
  }
  async function _isoRptRows() {
    const audits = await api('audit.list');
    const rows = await Promise.all(audits.map(async a => {
      let m;
      try { m = await api('metric.audit', { auditId: a.id }); } catch (e) { m = null; }
      const hrs = _isoRptHoursFor(a.id);
      const client = (_DB().clients || []).find(c => c.id === a.client_id);
      return {
        auditId: a.id, ref: a.ref, title: a.title, clientName: client ? client.name : a.client_id,
        standards: (a.standards || []).join('/'), stage: a.stage,
        assessmentPct: m ? m.assessment_completion_pct : 0, conformancePct: m ? m.conformance_pct : 0,
        findingsOpen: m ? m.findings_open : 0, actionsOverdue: m ? m.actions_overdue : 0,
        hoursTotal: hrs.total, hoursApproved: hrs.approved, hoursBillable: hrs.billable,
      };
    }));
    return rows;
  }
  function _isoRptTableHtml(rows) {
    const th = 'font-size:10px;font-weight:700;color:#8da2b2;text-transform:uppercase;letter-spacing:0.06em;padding:8px 10px;text-align:left;background:#f8fbff;border-bottom:2px solid #e4ecf4;white-space:nowrap';
    const td = 'padding:8px 10px;font-size:12px;border-bottom:1px solid #f4f6fa;vertical-align:middle;white-space:nowrap';
    if (!rows.length) return '<div class="card" style="padding:40px;text-align:center;color:#8da2b2">No ISO audits visible yet.</div>';
    const trs = rows.map(r => `<tr onclick="ISO.openBoard('${esc(r.auditId)}')" style="cursor:pointer" onmouseenter="this.style.background='#f8fbff'" onmouseleave="this.style.background=''">
      <td style="${td};font-weight:600;color:#0d1c33">${esc(r.clientName)}</td>
      <td style="${td}">${esc(r.ref)}</td>
      <td style="${td}">${esc(r.standards)}</td>
      <td style="${td}">${esc(r.stage)}</td>
      <td style="${td};text-align:right">${r.assessmentPct}%</td>
      <td style="${td};text-align:right">${r.conformancePct}%</td>
      <td style="${td};text-align:right">${r.findingsOpen}</td>
      <td style="${td};text-align:right;color:${r.actionsOverdue ? '#b91c1c' : '#0d1c33'}">${r.actionsOverdue}</td>
      <td style="${td};text-align:right">${r.hoursTotal.toFixed(1)}h</td>
      <td style="${td};text-align:right">${r.hoursApproved.toFixed(1)}h</td>
      <td style="${td};text-align:right">${r.hoursBillable.toFixed(1)}h</td>
    </tr>`).join('');
    return `<div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${th}">Client</th><th style="${th}">Ref</th><th style="${th}">Standards</th><th style="${th}">Stage</th>
          <th style="${th}">Assessed</th><th style="${th}">Conformant</th><th style="${th}">Open findings</th><th style="${th}">Overdue actions</th>
          <th style="${th}">Hours</th><th style="${th}">Approved</th><th style="${th}">Billable</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
    </div>`;
  }
  async function fillReportsTab() {
    const host = document.getElementById('rpt-iso-body');
    if (!host) return;
    const toolbar = `<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div><label style="font-size:10px;font-weight:700;color:#8da2b2;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:4px">Hours from</label>
        <input type="date" class="form-input" value="${esc(_isoRpt.from)}" onchange="ISO._rptSetRange('from',this.value)" style="height:30px"/></div>
      <div><label style="font-size:10px;font-weight:700;color:#8da2b2;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:4px">Hours to</label>
        <input type="date" class="form-input" value="${esc(_isoRpt.to)}" onchange="ISO._rptSetRange('to',this.value)" style="height:30px"/></div>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="ISO._rptExportCsv()">↓ CSV</button>
        <button class="btn btn-ghost btn-sm" onclick="ISO._rptExportXlsx()">↓ Excel</button>
      </div>
    </div>`;
    host.innerHTML = toolbar + '<div class="card" style="padding:40px;text-align:center;color:#8da2b2">Loading…</div>';
    let rows;
    try { rows = await _isoRptRows(); } catch (e) { host.innerHTML = toolbar + `<div class="card" style="padding:20px;color:#b91c1c">Could not load ISO audits: ${esc(e.message)}</div>`; return; }
    _isoRptLastRows = rows;
    const hostNow = document.getElementById('rpt-iso-body');
    if (hostNow) hostNow.innerHTML = toolbar + _isoRptTableHtml(rows);
  }
  let _isoRptLastRows = [];
  function _isoRptExportCsv() {
    const rows = [['Client', 'Ref', 'Title', 'Standards', 'Stage', 'Assessed %', 'Conformant %', 'Open findings', 'Overdue actions', 'Hours', 'Approved hours', 'Billable hours']];
    _isoRptLastRows.forEach(r => rows.push([r.clientName, r.ref, r.title, r.standards, r.stage, r.assessmentPct, r.conformancePct, r.findingsOpen, r.actionsOverdue, r.hoursTotal, r.hoursApproved, r.hoursBillable]));
    const csv = rows.map(r => r.map(root._csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `ISO_Audits_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }
  function _isoRptExportXlsx() {
    root._ensureExcelJs(() => {
      try {
        const wbk = new root.ExcelJS.Workbook();
        wbk.creator = 'Etcher Task Hub'; wbk.created = new Date();
        const ws = wbk.addWorksheet('ISO Audits', { views: [{ showGridLines: false }] });
        const headers = ['Client', 'Ref', 'Title', 'Standards', 'Stage', 'Assessed %', 'Conformant %', 'Open findings', 'Overdue actions', 'Hours', 'Approved hours', 'Billable hours'];
        root._xlWrite(ws, 1, 1, headers.map(h => ({ v: h, bold: true, bg: '0d1c33', fg: 'ffffff' })));
        _isoRptLastRows.forEach((r, i) => {
          root._xlWrite(ws, i + 2, 1, [
            { v: r.clientName }, { v: r.ref }, { v: r.title }, { v: r.standards }, { v: r.stage },
            { v: r.assessmentPct / 100, pct: true, center: true }, { v: r.conformancePct / 100, pct: true, center: true },
            { v: r.findingsOpen, center: true }, { v: r.actionsOverdue, center: true },
            { v: r.hoursTotal, numFmt: '0.##', center: true }, { v: r.hoursApproved, numFmt: '0.##', center: true }, { v: r.hoursBillable, numFmt: '0.##', center: true },
          ]);
        });
        ws.columns.forEach(c => { c.width = 16; });
        wbk.xlsx.writeBuffer().then(buf => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
          a.download = `ISO_Audits_${new Date().toISOString().slice(0, 10)}.xlsx`;
          a.click();
        });
      } catch (e) { root.showToast ? root.showToast('Could not build the Excel file: ' + e.message, true) : alert(e.message); }
    }, () => root.showToast ? root.showToast('The spreadsheet writer could not be loaded.', true) : alert('Could not load the spreadsheet writer.'));
  }

  root.ISO = {
    api: api, invalidate: invalidate, timeTargets: timeTargets, digestItems: digestItems,
    // Shared with iso/iso-import.js's openImport, which fetches /api/iso directly (never through
    // this file's own api()/mutate() wrappers) — see that file's own _authHeaders comment.
    _isoAuthHeaders: _isoAuthHeaders,
    render: render, renderAdmin: renderAdmin, renderSidebar: renderSidebar,
    openLanding: openLanding, _landSetFilter: _landSetFilter, _landSetQuery: _landSetQuery, openBoard: openBoard, setTab: setTab, currentClient: currentClient,
    toggleClientExpanded: toggleClientExpanded,
    openNewBoard: openNewBoard, _wizNext: _wizNext, _wizBack: _wizBack, _wizCreate: _wizCreate,
    _wizPickClient: _wizPickClient, _wizFilterClients: _wizFilterClients,
    _wizToggleStandard: _wizToggleStandard, _wizAllStandards: _wizAllStandards, _wizSetEdition: _wizSetEdition,
    _wizSetVis: _wizSetVis, _wizAddMember: _wizAddMember, _wizSetRole: _wizSetRole, _wizRemoveMember: _wizRemoveMember,
    openAccessModal: openAccessModal, _saveAccess: _saveAccess,
    saveSettings: saveSettings, _saveAsTemplate: _saveAsTemplate, _archiveBoard: _archiveBoard, fillArchiveCard: fillArchiveCard, _restoreBoard: _restoreBoard, _removeFromBin: _removeFromBin, _profAddItem: _profAddItem, _profSave: _profSave,
    openImport: openImportFromMenu, _approveVersion: _approveVersion, _approveVersionConfirmed: _approveVersionConfirmed,
    _retireVersion: _retireVersion, _retireVersionConfirmed: _retireVersionConfirmed, _loadLibrarySeed: _loadLibrarySeed, _saveUploadCap: _saveUploadCap,
    fillReportsTab: fillReportsTab, _rptSetRange: _isoRptSetRange, _rptExportCsv: _isoRptExportCsv, _rptExportXlsx: _isoRptExportXlsx,
    _openGanttExport: _openGanttExport, _ganttExportApply: _ganttExportApply,
    _reqSetView: _reqSetView,
    _reqSaveView: _reqSaveView, _reqLoadSavedView: _reqLoadSavedView, _reqSuggestRelationships: _reqSuggestRelationships,
    _reqBulkPick: _reqBulkPick, _reqBulkClear: _reqBulkClear,
    _openAddRequirement: _openAddRequirement, _addRequirementApply: _addRequirementApply,
    openRequirementDrawer: openRequirementDrawer, _reqSeniorPick: _reqSeniorPick, _reqApprove: _reqApprove, _reqReturn: _reqReturn, _reqBulkApprove: _reqBulkApprove, _reqApproveIds: _reqApproveIds, _reqApproveAll: _reqApproveAll, _setStageChanged: _setStageChanged, _startMaintenance: _startMaintenance, _actLinkClause: _actLinkClause, _actLinkApply: _actLinkApply, _actUnlink: _actUnlink, _wizSetVerify: _wizSetVerify, _reqBulkSeniorPick: _reqBulkSeniorPick, _reqDrawerSetTab: _reqDrawerSetTab, _reqDrawerTabKey: _reqDrawerTabKey, _reqDraftCapture: _reqDraftCapture, _relationshipDecide: _relationshipDecide, _openAddRelationship: _openAddRelationship, _relAddApply: _relAddApply,
    _reqToggleExpand: _reqToggleExpand, _reqSetStatus: _reqSetStatus, _reqSaveField: _reqSaveField, _reqToggleCheck: _reqToggleCheck, _repPdfBuild: _repPdfBuild, _repLogo: _repLogo, _reqSaveFieldSelect: _reqSaveFieldSelect,
    _reqToggleCheat: _reqToggleCheat, _reqToggleRelEdit: _reqToggleRelEdit, _reqOpenApplyPanel: _reqOpenApplyPanel, _reqCloseApplyPanel: _reqCloseApplyPanel,
    _reqApplyToRelated: _reqApplyToRelated, _reqRejectRelated: _reqRejectRelated, _reqUnrejectRelated: _reqUnrejectRelated, _reqOpenMore: _reqOpenMore, _reqOpenEvidence: _reqOpenEvidence,
    _reqSetQuery: _reqSetQuery, _reqAddDocument: _reqAddDocument,
    _drawerSave: _drawerSave, _drawerAddComment: _drawerAddComment,
    _fndSetView: _fndSetView, _openAddFinding: _openAddFinding, _addFindingApply: _addFindingApply,
    _fndTransition: _fndTransition, openFindingDrawer: openFindingDrawer,
    _fndDrawerSave: _fndDrawerSave, _fndAddComment: _fndAddComment,
    _actSetView: _actSetView, _actPlanSetGroupBy: _actPlanSetGroupBy, _openAddAction: _openAddAction, _actRefreshTargetOptions: _actRefreshTargetOptions,
    _addActionApply: _addActionApply, openActionDrawer: openActionDrawer, _actUpdateStatus: _actUpdateStatus,
    _actVerify: _actVerify, _openReopenAction: _openReopenAction, _reopenActionApply: _reopenActionApply,
    _adSaveDetails: _adSaveDetails, _adSaveCapa: _adSaveCapa, _subtaskAdd: _subtaskAdd, _subtaskToggle: _subtaskToggle,
    _actAddComment: _actAddComment,
    _openSubmitForReview: _openSubmitForReview, _submitForReviewApply: _submitForReviewApply, _reviewDecide: _reviewDecide,
    _openRequestExtension: _openRequestExtension, _requestExtensionApply: _requestExtensionApply, _extensionDecide: _extensionDecide,
    _renderGuidedRC: _renderGuidedRC, _rcFiveWhysAdd: _rcFiveWhysAdd, _rcFiveWhysRemove: _rcFiveWhysRemove, _rcFiveWhysEdit: _rcFiveWhysEdit,
    _rcFishboneAdd: _rcFishboneAdd, _rcFishboneRemove: _rcFishboneRemove, _rcFishboneEdit: _rcFishboneEdit,
    _rcTreeAddRoot: _rcTreeAddRoot, _rcTreeAddChild: _rcTreeAddChild, _rcTreeRemove: _rcTreeRemove, _rcTreeEdit: _rcTreeEdit,
    _evdReview: _evdReview, _suggDecide: _suggDecide,
    fillEvidenceTab: fillEvidenceTab, openEvidenceDrawer: openEvidenceDrawer, _evtSetView: _evtSetView, _evtQueueDecide: _evtQueueDecide, _evtQueueDecideOne: _evtQueueDecideOne, _evtQueueSelectAll: _evtQueueSelectAll, _evdSupersede: _evdSupersede,
    _openPromptDialog: _openPromptDialog, _pdSetMode: _pdSetMode, _pdRefresh: _pdRefresh, _pdSaveAnswers: _pdSaveAnswers, _pdCopy: _pdCopy, _pdDownload: _pdDownload, _pdDownloadNow: _pdDownloadNow,
    _evdToggleUpload: _evdToggleUpload, _evdFileChosen: _evdFileChosen, _evdPreview: _evdPreview, _evdDownload: _evdDownload, _evdSetDocStatus: _evdSetDocStatus,
    fillDashboardTab: fillDashboardTab, _dashOpenFiltered: _dashOpenFiltered, _dashSetStandard: _dashSetStandard, _boardSetStandard: _boardSetStandard,
    fillOverviewTab: fillOverviewTab, _ovShowFull: _ovShowFull, _ovShowOverview: _ovShowOverview, _ovOpenDocAdd: _ovOpenDocAdd, _ovDocAddApply: _ovDocAddApply,
    _docOpenAdd: _docOpenAdd, _reqDocAdd: _reqDocAdd, _docPickStatus: _docPickStatus, notifItems: notifItems, notifUnread: notifUnread, onNotifClick: onNotifClick, notifDismiss: notifDismiss, notifMarkAllRead: notifMarkAllRead, notifClearAll: notifClearAll, openRecord: openRecord, refreshNotifs: refreshNotifs, _csvCell: _csvCell, _exportClausesCsv: _exportClausesCsv, _exportActionsCsv: _exportActionsCsv, _exportDocumentsCsv: _exportDocumentsCsv, _exportClausesXlsx: _exportClausesXlsx, _exportActionsXlsx: _exportActionsXlsx, _exportDocumentsXlsx: _exportDocumentsXlsx,_openReport: _openReport, _repSave: _repSave, _repIssue: _repIssue, _repDownload: _repDownload, _repAckForm: _repAckForm, _repAck: _repAck, carryLabel: carryLabel, _saveAuditSetup: _saveAuditSetup, _openStartNext: _openStartNext, _snType: _snType, _snApply: _snApply, openProgramme: openProgramme, _progTile: _progTile, _progSaveSettings: _progSaveSettings, _docOpenRequest: _docOpenRequest, _docRequestApply: _docRequestApply, _docRequestCopy: _docRequestCopy, _docRequestDownload: _docRequestDownload, _openAuditPack: _openAuditPack, _auditPackApply: _auditPackApply, _exportGapAnalysis: _exportGapAnalysis, _exportSignals: _exportSignals, _trackOpen: _trackOpen, _trackApply: _trackApply, _reqOpenTracked: _reqOpenTracked, _actOpenFinding: _actOpenFinding, _fndOpenReopen: _fndOpenReopen, _fndReopenApply: _fndReopenApply, trackedActionFor: trackedActionFor, _reqSetGap: _reqSetGap, _reqToggleOfi: _reqToggleOfi, _reqOpenScopeMenu: _reqOpenScopeMenu, _reqConfirmDerived: _reqConfirmDerived, _reqOpenSuffMenu: _reqOpenSuffMenu, _reqSetSufficiency: _reqSetSufficiency, _reqQuickNote: _reqQuickNote, _reqQuickNoteSave: _reqQuickNoteSave, _docRemovals: _docRemovals, _reqDocGenerator: _reqDocGenerator, _docTickAll: _docTickAll, _docUpdateSum: _docUpdateSum, _docAddClauseSearch: _docAddClauseSearch, _docAddClause: _docAddClause,
    fillDocumentsTab: fillDocumentsTab, renderDocumentsTab: renderDocumentsTab, _docSetFilter: _docSetFilter, _docSetQuery: _docSetQuery,
    _docOpenGenerator: _docOpenGenerator, _docOpenChooser: _docOpenChooser, _docChooserSearch: _docChooserSearch, _docPick: _docPick, docKeySet: docKeySet,
    fillWorklistTab: fillWorklistTab, renderWorklistTab: renderWorklistTab, worklistItemsFrom: worklistItemsFrom, _wlSetMode: _wlSetMode, _wlAuditId: _wlAuditId, _wlOpenAction: _wlOpenAction, _reqJumpTo: _reqJumpTo,
    _reqClearDashFilter: _reqClearDashFilter, _fndClearDashFilter: _fndClearDashFilter, _actClearDashFilter: _actClearDashFilter,
    _openAddEvidence: _openAddEvidence, _evdAddApply: _evdAddApply, _evdCopyLink: _evdCopyLink, _evdFilter: _evdFilter, _evdUseExample: _evdUseExample, _evdKindChanged: _evdKindChanged,
    import: (root.ISO && root.ISO.import) || null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
