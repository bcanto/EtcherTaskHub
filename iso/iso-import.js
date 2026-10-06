// ISO workbook import — browser parser (plan Phase 4.2/4.7). Ports workboard/ISO Audit/lib/
// importer.mjs's parseSheet/parseWorkbook logic 1:1 (read-only reference — never imported, never
// modified) so it runs in the page with the already-vendored SheetJS instead of Node's require().
// Sends the parsed rows to api/_isoImport.js via /api/iso (plan §3.4) — this file never computes a
// diff or writes anything itself, it only parses and renders.
//
// Environment-agnostic on purpose: parseWorkbook/buildImportPayload take an injected XLSX handle
// and digest function, so .agents/iso-import-test.cjs can exercise the exact same parsing code in
// Node (against the real workbook) that the browser runs, without a DOM.
(function (root) {
  'use strict';

  const SHEET_STANDARD = { 'ISO 9001': '9001', 'ISO 14001': '14001', 'ISO 45001': '45001' };
  const RECOGNISED_STATUSES = ['Not conforming', 'Partially conforming', 'Fully conforming', 'To be updated'];
  const TOP_LEVEL_RE = /^Clauses?\s+(\d+)\b/i;
  const TODO_MARKER_RE = /^to\s*do\s*list:?$/i;
  const COL = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 };

  function normaliseText(v) { return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim(); }

  // "4.1 Understanding the organization and its context" -> {number:"4.1", name:"Understanding..."}
  function parseClauseLabel(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
    if (m) return { number: m[1], name: m[2].trim() };
    return { number: null, name: s };
  }

  // Ported byte-for-byte from workboard/ISO Audit/lib/model.mjs's requirementMatchHash — a 32-bit
  // rolling hash, NOT sha1 (the plan's own prose says sha1; the prototype's actual, tested code
  // does not — docs/iso-audit-integration-plan.md §14 A22). Kept identical to the prototype so a
  // side-by-side re-import against prototype data would still match.
  function requirementMatchHash(standard, clause, requirementText, occurrence) {
    const norm = normaliseText(requirementText).toLowerCase().replace(/\s+/g, ' ');
    let h = 0;
    for (let i = 0; i < norm.length; i++) { h = (h * 31 + norm.charCodeAt(i)) >>> 0; }
    return standard + '|' + clause + '|' + h.toString(16) + '|' + occurrence;
  }

  function cell(row, idx) { return row[idx] === undefined ? '' : String(row[idx]); }

  // Map<bottomRowExcel, topRowExcel> for every multi-row merge whose range is column G — SheetJS
  // only populates the top-left cell of a merge, so every row below is legitimately blank.
  function findGMerges(ws) {
    const map = new Map();
    for (const m of (ws['!merges'] || [])) {
      if (m.s.c === COL.G && m.e.c === COL.G && m.e.r > m.s.r) {
        const top = m.s.r + 1;
        for (let r = m.s.r + 2; r <= m.e.r + 1; r++) map.set(r, top);
      }
    }
    return map;
  }

  function parseSheet(XLSX, ws, sheetName, standard, warnings) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '' });
    const gMerges = findGMerges(ws);
    const sections = [];
    const items = [];
    const todoRows = [];
    let currentTop = null, currentSub = null, inTodoBlock = false;
    const occurrenceCounts = new Map();

    for (let i = 1; i < rows.length; i++) {
      const rowNum = i + 1;
      const r = rows[i];
      const a = normaliseText(cell(r, COL.A));
      const b = normaliseText(cell(r, COL.B));
      const c = normaliseText(cell(r, COL.C));
      const d = normaliseText(cell(r, COL.D));
      const e = normaliseText(cell(r, COL.E));
      const f = normaliseText(cell(r, COL.F));
      const g = normaliseText(cell(r, COL.G));
      if (!a && !b && !c && !d && !e && !f && !g) continue; // blank row

      if (inTodoBlock) {
        // Every non-blank row from the "To Do List:" marker onward is a shared-action seed row —
        // detected structurally, not by hardcoded row numbers (survives the list growing/shrinking).
        todoRows.push({ row: rowNum, sheet: sheetName, title: a || b || c });
        continue;
      }
      if (TODO_MARKER_RE.test(a) || TODO_MARKER_RE.test(b)) { inTodoBlock = true; continue; }

      if (c) {
        // ── Requirement row: col C non-empty ──────────────────────────────────────────────────
        const parsed = parseClauseLabel(b || a);
        const clause = parsed.number || (b || a);
        const key = clause + '||' + c.toLowerCase().replace(/\s+/g, ' ');
        const occurrence = occurrenceCounts.get(key) || 0;
        occurrenceCounts.set(key, occurrence + 1);

        let complianceStatus = 'Not assessed';
        if (e) {
          complianceStatus = e;
          if (!RECOGNISED_STATUSES.includes(e)) warnings.push(sheetName + ' row ' + rowNum + ': unrecognised STATUS "' + e + '" kept verbatim');
        }
        let evidenceExamples = g, evidenceMergedFromRow = null;
        if (gMerges.has(rowNum)) { evidenceMergedFromRow = gMerges.get(rowNum); evidenceExamples = ''; }

        items.push({
          standard, clause, clauseName: parsed.name,
          sectionId: currentTop, subSectionId: currentSub, requirement: c,
          source: { sheet: sheetName, row: rowNum, matchKey: requirementMatchHash(standard, clause, c, occurrence) },
          imported: { currentSystem: d, complianceStatus, plannedAction: f, evidenceExamples, evidenceMergedFromRow },
        });
        continue;
      }

      // ── Non-requirement row: section heading, or a stray blank/decorative row ────────────────
      const headingSource = a || b;
      const topMatch = headingSource.match(TOP_LEVEL_RE);
      if (topMatch) {
        const num = topMatch[1];
        const title = headingSource.replace(TOP_LEVEL_RE, '').trim() || headingSource;
        sections.push({ id: standard + ':' + num, standard, clause: num, title, level: 1, source: { sheet: sheetName, row: rowNum }, sourceStatus: e || null });
        currentTop = standard + ':' + num; currentSub = null;
        continue;
      }
      const subParsed = parseClauseLabel(headingSource);
      if (subParsed.number) {
        sections.push({ id: standard + ':' + subParsed.number, standard, clause: subParsed.number, title: subParsed.name, level: 2, source: { sheet: sheetName, row: rowNum }, sourceStatus: e || null });
        currentSub = standard + ':' + subParsed.number;
        continue;
      }
      // Otherwise: genuinely blank/decorative — matches the prototype's report.otherSkipped, not
      // surfaced to the user.
    }
    return { sections, items, todoRows };
  }

  function parseWorkbook(XLSX, buffer) {
    const wb = XLSX.read(buffer, { type: 'array' });
    const warnings = [];
    const sections = [], items = [], todoRows = [];
    for (const sheetName of wb.SheetNames) {
      const standard = SHEET_STANDARD[sheetName];
      if (!standard) { warnings.push('Unknown worksheet "' + sheetName + '" — skipped entirely'); continue; }
      const parsed = parseSheet(XLSX, wb.Sheets[sheetName], sheetName, standard, warnings);
      sections.push.apply(sections, parsed.sections);
      items.push.apply(items, parsed.items);
      todoRows.push.apply(todoRows, parsed.todoRows);
    }
    return { sections, items, todoRows, warnings };
  }

  async function sha256Hex(buffer, digestFn) {
    const hashBuffer = await digestFn(buffer);
    const bytes = new Uint8Array(hashBuffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  // Full pipeline: an ArrayBuffer -> the exact wire payload api/_isoImport.js's validateCandidates
  // expects (plan 4.2 "producing normalised rows... Compute sha256 with crypto.subtle").
  async function buildImportPayload(opts) {
    const XLSX = opts.XLSX, arrayBuffer = opts.arrayBuffer, sourceFilename = opts.sourceFilename, digestFn = opts.digestFn;
    const sha256 = await sha256Hex(arrayBuffer, digestFn);
    const parsed = parseWorkbook(XLSX, arrayBuffer);
    return { sha256, sourceFilename, sections: parsed.sections, items: parsed.items, todoRows: parsed.todoRows, warnings: parsed.warnings };
  }

  // Was `root._adminApiAuthHeaders()` directly — correct in production (Supabase mode) but wrong
  // offline: that function knows nothing about api/_isoAuth.js's own X-ISO-Offline-User header, so
  // every offline import attempt failed with "Missing or invalid X-ISO-Offline-User header" (found
  // running the real offline import end to end — STOP 2 review, 2026-10-01 — not by a synthetic
  // test, since iso-ui-test.cjs's own setup bypasses this UI path by seeding the DB directly).
  // iso-core.js's own `_isoAuthHeaders` already gets this right for every other ISO request
  // (api()/mutate()); this file never goes through those wrappers, so it reuses that same logic
  // via root.ISO's own export instead of duplicating the offline-vs-Supabase branch a second time.
  async function _authHeaders() {
    if (root.ISO && typeof root.ISO._isoAuthHeaders === 'function') return root.ISO._isoAuthHeaders();
    return root._adminApiAuthHeaders ? root._adminApiAuthHeaders() : {};
  }

  // ── UI shell (plan 4.7) — upload -> preview (counts, per-standard diff, warnings) -> Apply /
  // Cancel. There is no ISO menu yet in Phase 4 (mounted in Phase 5), so this is real, working code
  // with nothing to call it from the running app yet — hard rule 6b ("implemented now, not
  // stubbed"). Deliberately plain DOM (createElement/addEventListener), matching this codebase's
  // zero-npm-deps convention; no styling opinions beyond what a bare summary needs.
  function openImport(kind, container, opts) {
    opts = opts || {};
    const targetAuditId = opts.targetAuditId || null;
    container.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    const status = document.createElement('div');
    const previewBox = document.createElement('div');
    container.appendChild(input);
    container.appendChild(status);
    container.appendChild(previewBox);

    let lastPayload = null, lastRunId = null;

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      status.textContent = 'Reading ' + file.name + '…';
      previewBox.innerHTML = '';
      try {
        // SheetJS isn't loaded until something actually needs it — index.html's own
        // _ensureDocViewer lazy-loader, shared with the file-preview feature, which is the only
        // thing that has ever triggered it before this. A session that opens the ISO import
        // dialog without first previewing some other .xlsx file elsewhere hit `root.XLSX` as
        // undefined here, failing inside parseWorkbook with an opaque "Cannot read properties of
        // undefined (reading 'read')" — found running the real offline import end to end (STOP 2
        // review, 2026-10-01), not by a synthetic test.
        await new Promise((resolve, reject) => root._ensureDocViewer('xlsx', resolve, () => reject(new Error('Could not load the spreadsheet reader. Check your connection and try again.'))));
        const arrayBuffer = await file.arrayBuffer();
        const payload = await buildImportPayload({
          XLSX: root.XLSX, arrayBuffer, sourceFilename: file.name,
          digestFn: (buf) => root.crypto.subtle.digest('SHA-256', buf),
        });
        lastPayload = payload;
        status.textContent = 'Previewing…';
        const body = Object.assign({ op: 'import.preview', kind }, payload);
        if (targetAuditId) body.targetAuditId = targetAuditId;
        const res = await root.fetch('/api/iso', {
          method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, await _authHeaders()),
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error((json && json.error) || 'Preview failed.');
        lastRunId = json.data.runId;
        renderPreview(json.data);
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      }
    });

    function renderPreview(data) {
      status.textContent = '';
      const summary = data.summary;
      const lines = [];
      if (summary.kind === 'library') {
        for (const p of summary.perStandard) {
          lines.push('ISO ' + p.standard + ' (' + p.versionLabel + '): ' + p.summary.requirements.created + ' new, '
            + p.summary.requirements.updated + ' updated, ' + p.summary.requirements.unchanged + ' unchanged requirements; '
            + p.summary.sections.created + ' new sections.');
        }
      } else {
        const r = summary.requirements, a = summary.actions;
        lines.push(r.created + ' new, ' + r.updated + ' updated (' + r.conflicts.length + ' need review), '
          + r.unchanged + ' unchanged, ' + r.missingNow + ' no longer in the workbook.');
        lines.push(a.created + ' actions from the to-do list' + (a.seedApplied ? ' (' + a.linksAdded + ' suggested links applied)' : ' (no suggested links — see warnings)') + '.');
      }
      if (data.duplicateOf) lines.push('This exact file was already applied on ' + data.duplicateOf.at + ' by ' + data.duplicateOf.performedBy + '.');
      for (const w of summary.warnings || []) lines.push('Warning: ' + w);
      previewBox.innerHTML = '';
      const ul = document.createElement('ul');
      for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
      previewBox.appendChild(ul);

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        status.textContent = 'Applying…';
        try {
          const body = Object.assign({ op: 'import.apply', runId: lastRunId }, lastPayload);
          if (data.duplicateOf) body.confirmDuplicate = true;
          const res = await root.fetch('/api/iso', {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, await _authHeaders()),
            body: JSON.stringify(body),
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error((json && json.error) || 'Apply failed.');
          status.textContent = 'Applied.';
          previewBox.innerHTML = '';
          if (typeof opts.onApplied === 'function') opts.onApplied(json.data);
        } catch (e) {
          status.textContent = 'Error: ' + e.message;
          applyBtn.disabled = false;
        }
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { previewBox.innerHTML = ''; status.textContent = ''; lastPayload = null; lastRunId = null; input.value = ''; });
      previewBox.appendChild(applyBtn);
      previewBox.appendChild(cancelBtn);
    }
  }

  const api = {
    normaliseText, parseClauseLabel, requirementMatchHash, findGMerges, parseSheet, parseWorkbook,
    sha256Hex, buildImportPayload, openImport,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ISO = root.ISO || {};
    root.ISO.import = Object.assign(root.ISO.import || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
