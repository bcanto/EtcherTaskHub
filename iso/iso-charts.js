// Plan 9.3 — SVG chart renderers. Pure, synchronous, no DB, no DOM reads: every function takes the
// data it needs (already fetched by iso-core.js from `dashboard.audit`) and returns an HTML string.
// Loaded before iso-core.js (same pattern as iso-import.js), attaching `root.IsoCharts`.
//
// Every chart follows the plan's own four rules:
//  - a data-as-at caption (the server's own `data_as_at`, never a client-side clock);
//  - text values alongside every shape — colour is decoration, never the only way to read a number;
//  - the outer wrapper carries role="img" and a real aria-label summarising the data in words;
//  - an honest empty state ("Not enough assessed requirements yet", or a chart-specific equivalent)
//    instead of an empty or misleading shape when there is nothing to plot.
// One fixed colour per status token (plan §7), defined once here and reused by every chart so a
// result/status never changes colour between two different charts on the same page.
(function (root) {
  function esc(s) { return root.escHtml ? root.escHtml(s) : String(s == null ? '' : s); }

  // ── Fixed colour tokens (plan §7: "one fixed colour per status token") ───────────────────────────
  const RESULT_COLOR = {
    implemented_effective: '#0d6e4e', partially_implemented: '#92400e', implemented_ineffective: '#b45309',
    not_implemented: '#b91c1c', no_evidence_provided: '#b91c1c', not_applicable: '#8da2b2', unassessed: '#94a3b8',
  };
  // Five clearly different hues (the register's State pills read these too, so a state is the same
  // colour everywhere); all dark enough for readable text on their own light tint.
  const STATE_COLOR = { complete: '#0d6e4e', in_progress: '#0e7490', awaiting_evidence: '#7c3aed', needs_follow_up: '#c2410c', not_started: '#64748b' };
  const CLASS_COLOR = { major_nc: '#b91c1c', minor_nc: '#b45309', observation: '#3b82f6', ofi: '#0d6e4e' };
  const ACTION_STATUS_COLOR = { draft: '#94a3b8', assigned: '#3b82f6', in_progress: '#3b82f6', awaiting_evidence: '#f59e0b', submitted_for_review: '#a855f7', more_info_required: '#f59e0b', ready_for_verification: '#a855f7', verified: '#0d6e4e', closed: '#0d6e4e', on_hold: '#ef4444' };
  const RISK_COLOR = { low: '#0d6e4e', medium: '#92400e', high: '#b45309', critical: '#b91c1c' };
  const DEFAULT_COLOR = '#6b8399';
  function colorFor(palette, key) { return palette[key] || DEFAULT_COLOR; }
  function labelFor(key) { return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

  // ── Shared wrapper: role=img, aria-label, a title, the data-as-at caption, an empty state ────────
  function wrap(title, ariaLabel, dataAsAt, bodyHtml) {
    return `<figure class="iso-chart" role="img" aria-label="${esc(ariaLabel)}" style="margin:0;padding:14px 16px;background:#fff;border:1px solid #e2eaf2;border-radius:8px">
      <div style="font-size:12px;font-weight:700;color:#0d1c33;margin-bottom:10px">${esc(title)}</div>
      ${bodyHtml}
      <figcaption style="font-size:10px;color:#8da2b2;margin-top:8px">As at ${esc(fmtAsAt(dataAsAt))}</figcaption>
    </figure>`;
  }
  function fmtAsAt(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; }
  }
  function emptyBody(message) {
    return `<div class="iso-chart-empty" style="padding:24px 8px;text-align:center;color:#8da2b2;font-size:12px">${esc(message || 'Not enough assessed requirements yet')}</div>`;
  }

  // ── Horizontal bar chart: segments = [{key, value, label?}] ─────────────────────────────────────
  // dataAttr/onClickOp let the caller make each bar a real link (plan: "every number is a link") —
  // onClickOp is a bare function-name string (e.g. 'ISO._dashOpenFiltered') invoked with this bar's
  // own `data-filter` JSON (never inlined into the onclick string itself — the same data-attribute
  // discipline A81 established, since a filter can carry arbitrary text values).
  function barChart(segments, opts) {
    opts = opts || {};
    const rows = (segments || []).filter(s => s.value > 0);
    if (!rows.length) return wrap(opts.title || 'Chart', (opts.ariaLabel || opts.title || 'Chart') + ': no data', opts.dataAsAt, emptyBody(opts.emptyMessage));
    const max = Math.max(...rows.map(s => s.value), 1);
    const bars = rows.map(s => {
      const pctWidth = Math.round((s.value / max) * 100);
      const color = colorFor(opts.palette || {}, s.key);
      const clickable = opts.onClickOp && s.filter;
      const attrs = clickable ? ` class="iso-chart-bar-row" style="cursor:pointer" tabindex="0" role="button" data-filter="${esc(JSON.stringify(s.filter))}" onclick="${opts.onClickOp}(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${opts.onClickOp}(this);}"` : '';
      return `<div${attrs} style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px">
        <div style="width:120px;flex-shrink:0;color:#4a5568;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.label || labelFor(s.key))}</div>
        <div style="flex:1;background:#f4f6fa;border-radius:3px;height:16px;position:relative;min-width:40px">
          <div style="width:${pctWidth}%;background:${color};height:100%;border-radius:3px"></div>
        </div>
        <div style="width:34px;flex-shrink:0;color:#0d1c33;font-weight:600">${esc(String(s.value))}</div>
      </div>`;
    }).join('');
    const ariaLabel = (opts.ariaLabel || opts.title || 'Chart') + ': ' + rows.map(s => `${s.label || labelFor(s.key)} ${s.value}`).join(', ');
    return wrap(opts.title || 'Chart', ariaLabel, opts.dataAsAt, bars);
  }

  // ── Stacked bar: groups = [{key, label?, segments:{resultKey: count}}] — for e.g. results by
  // standard/clause, actions by owner. No per-segment click-through in this first pass (a 2D
  // cross-tab cell's own filter would need two combined predicates — named, not built, see A88);
  // every segment still shows its own text value, satisfying "text, not colour alone". ────────────
  function stackedBarChart(groups, opts) {
    opts = opts || {};
    const rows = (groups || []).filter(g => Object.values(g.segments || {}).some(v => v > 0));
    if (!rows.length) return wrap(opts.title || 'Chart', (opts.ariaLabel || opts.title || 'Chart') + ': no data', opts.dataAsAt, emptyBody(opts.emptyMessage));
    const keys = [...new Set(rows.flatMap(g => Object.keys(g.segments || {})))];
    const body = rows.map(g => {
      const total = keys.reduce((s, k) => s + (g.segments[k] || 0), 0) || 1;
      const segs = keys.filter(k => g.segments[k] > 0).map(k => {
        const w = Math.round((g.segments[k] / total) * 100);
        return `<div title="${esc(labelFor(k))}: ${g.segments[k]}" style="width:${w}%;background:${colorFor(opts.palette || {}, k)};height:100%"></div>`;
      }).join('');
      const textParts = keys.filter(k => g.segments[k] > 0).map(k => `${labelFor(k)} ${g.segments[k]}`).join(' · ');
      return `<div style="margin-bottom:8px;font-size:11px">
        <div style="color:#4a5568;margin-bottom:2px">${esc(g.label || labelFor(g.key))}</div>
        <div style="display:flex;border-radius:3px;overflow:hidden;height:14px;background:#f4f6fa">${segs}</div>
        <div style="color:#6b8399;font-size:10px;margin-top:2px">${esc(textParts)}</div>
      </div>`;
    }).join('');
    const ariaLabel = (opts.ariaLabel || opts.title || 'Chart') + ': ' + rows.map(g => `${g.label || labelFor(g.key)} — ${keys.filter(k => g.segments[k] > 0).map(k => labelFor(k) + ' ' + g.segments[k]).join(', ')}`).join('; ');
    return wrap(opts.title || 'Chart', ariaLabel, opts.dataAsAt, body);
  }

  // ── Progress ring: wraps index.html's own cpProgressRing (bare SVG, no text/aria of its own) with
  // a centred text label and the shared accessible wrapper — reusing the shape, not its bare output. ─
  function progressRing(pctValue, opts) {
    opts = opts || {};
    const p = Math.max(0, Math.min(100, Math.round(pctValue || 0)));
    const size = opts.size || 96, color = opts.color || (p >= 80 ? '#0d6e4e' : p >= 50 ? '#92400e' : '#b91c1c');
    const ringSvg = root.cpProgressRing ? root.cpProgressRing(p, size, 10, color) : `<svg width="${size}" height="${size}"></svg>`;
    const body = `<div style="position:relative;width:${size}px;height:${size}px;margin:0 auto">
      ${ringSvg}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#0d1c33">${p}%</div>
    </div>`;
    return wrap(opts.title || 'Progress', (opts.ariaLabel || opts.title || 'Progress') + `: ${p} percent`, opts.dataAsAt, body);
  }

  // ── Heat grid: rows × cols, cellValue(rowKey,colKey) -> number|null. Used for risk_distribution
  // (risk_severity × finding classification). Colour intensity from rowPalette; the count is always
  // printed in the cell too. ──────────────────────────────────────────────────────────────────────
  function heatGrid(rowKeys, colKeys, cellValue, opts) {
    opts = opts || {};
    const hasAny = rowKeys.some(rk => colKeys.some(ck => (cellValue(rk, ck) || 0) > 0));
    if (!rowKeys.length || !hasAny) return wrap(opts.title || 'Heat map', (opts.ariaLabel || opts.title || 'Heat map') + ': no data', opts.dataAsAt, emptyBody(opts.emptyMessage));
    const palette = opts.rowPalette || {};
    const cells = rowKeys.map(rk => `<tr><td style="padding:3px 8px 3px 0;color:#4a5568;white-space:nowrap">${esc(labelFor(rk))}</td>${colKeys.map(ck => {
      const v = cellValue(rk, ck) || 0;
      const bg = v > 0 ? (palette[rk] || DEFAULT_COLOR) : '#f4f6fa';
      return `<td style="padding:4px;text-align:center"><div style="min-width:36px;padding:4px 0;border-radius:4px;background:${bg};color:${v > 0 ? '#fff' : '#c8d4e0'};font-weight:600;font-size:11px">${v}</div></td>`;
    }).join('')}</tr>`).join('');
    const body = `<table style="border-collapse:collapse;font-size:11px;width:100%"><thead><tr><th></th>${colKeys.map(ck => `<th style="font-weight:600;color:#6b8399;padding:3px 4px;text-align:center">${esc(labelFor(ck))}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table>`;
    const ariaLabel = (opts.ariaLabel || opts.title || 'Heat map') + ': ' + rowKeys.flatMap(rk => colKeys.map(ck => `${labelFor(rk)}/${labelFor(ck)} ${cellValue(rk, ck) || 0}`)).join(', ');
    return wrap(opts.title || 'Heat map', ariaLabel, opts.dataAsAt, body);
  }

  // ── Line chart: points = [{day:'YYYY-MM-DD', value}] — progress over time (plan 9.3, "rebuilt
  // from iso_activity result changes"). A COUNT line, not a percentage — see the calculation
  // dictionary for why. The end value is printed as text next to the line, not only plotted. ───────
  function progressLine(points, opts) {
    opts = opts || {};
    if (!points || points.length < 2) return wrap(opts.title || 'Progress over time', (opts.ariaLabel || opts.title || 'Progress over time') + ': no data', opts.dataAsAt, emptyBody(opts.emptyMessage || 'Not enough history yet — this needs at least two recorded result changes.'));
    const w = opts.width || 420, h = opts.height || 120, pad = 20;
    const values = points.map(p => p.value);
    const maxV = Math.max(...values, 1);
    const stepX = (w - pad * 2) / (points.length - 1);
    const coords = points.map((p, i) => [pad + i * stepX, h - pad - (p.value / maxV) * (h - pad * 2)]);
    const path = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
    const dots = coords.map((c, i) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="2.5" fill="#0d6e4e"><title>${esc(points[i].day)}: ${points[i].value}</title></circle>`).join('');
    const first = points[0], last = points[points.length - 1];
    const body = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e2eaf2" stroke-width="1"/>
        <path d="${path}" fill="none" stroke="#0d6e4e" stroke-width="2"/>
        ${dots}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b8399;margin-top:2px"><span>${esc(first.day)}: ${first.value}</span><span>${esc(last.day)}: ${last.value} conforming</span></div>`;
    return wrap(opts.title || 'Progress over time', (opts.ariaLabel || opts.title || 'Progress over time') + `: from ${first.value} on ${first.day} to ${last.value} on ${last.day}`, opts.dataAsAt, body);
  }

  root.IsoCharts = {
    RESULT_COLOR, STATE_COLOR, CLASS_COLOR, ACTION_STATUS_COLOR, RISK_COLOR,
    barChart, stackedBarChart, progressRing, heatGrid, progressLine, labelFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
