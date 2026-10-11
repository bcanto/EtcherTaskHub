// Release-1 B3.5 (plan 10.2, D36): fill the gap-analysis template for one standard.
// Pure: takes the template's bytes and an export dataset (built server-side by export.dataset in
// api/_iso.js, already projected through EXPORT_FIELDS) and returns the filled .xlsx bytes. Direct
// XML filling through api/_isoZip.js (A94 — ExcelJS loses template parts): only the three sheet
// parts and workbook.xml are rewritten; styles, theme, drawings/logo, data validations, conditional
// formats and data bars stay byte-for-byte as the template has them.
//
// User text is only ever written as an XML-escaped inline string, never as a formula; text that
// starts with = + - @ tab or CR gets a leading ' (formula-injection guard). Every Summary formula is
// kept (sheet name swapped) with a cached value computed here exactly as Excel would, so the numbers
// are right before recalculation and in viewers that don't calculate; fullCalcOnLoad makes Excel
// recalculate on open anyway.
const { readZip, writeZip, getPart, setPart } = require('./_isoZip.js');

const TEMPLATE_SHEET = 'ISO 9001 Register'; // the template's own Register name, swapped per standard
const SYSTEM_TITLE = { '9001': 'Quality Management System', '14001': 'Environmental Management System', '45001': 'Occupational Health and Safety Management System' };
// Plan §11: level-1 section titles (Annex SL), identical except clause 5 of 45001.
const SECTION_TITLES = { 4: 'Context of the organization', 5: 'Leadership', 6: 'Planning', 7: 'Support', 8: 'Operation', 9: 'Performance evaluation', 10: 'Improvement' };
function sectionTitle(code, n) { return code === '45001' && Number(n) === 5 ? 'Leadership and worker participation' : (SECTION_TITLES[n] || `Clause ${n}`); }
const STATUS = { full: 'Fully conforming', partial: 'Partially conforming', not: 'Not conforming', tbu: 'To be updated', na: 'Not applicable' };
const WORK_LABELS = ['Not started', 'Planned', 'In progress', 'Complete', 'On hold'];
const PRIORITY_LABELS = ['High', 'Medium', 'Low'];
const SOURCE_COLUMNS = ['standard', 'clause', 'clauseName', 'requirement', 'currentSystem', 'plannedAction', 'complianceStatus', 'originalComplianceStatus', 'workStatus', 'priority',
  'owner', 'dueDate', 'progressPercent', 'evidenceCount', 'notesCount', 'subtaskCount', 'sharedActions', 'sourceSheet', 'sourceRow', 'sourceChanged', 'missingFromSource', 'manual', 'archived', 'updatedAt'];

function xmlEsc(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function guard(s) { const t = String(s == null ? '' : s); return /^[=+\-@\t\r]/.test(t) ? "'" + t : t; }
function col(n) { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
function strCell(ref, style, text) {
  const st = style != null ? ` s="${style}"` : '';
  const t = guard(text);
  return t === '' ? `<c r="${ref}"${st}/>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`;
}
function numCell(ref, style, n) { const st = style != null ? ` s="${style}"` : ''; return n == null || n === '' ? `<c r="${ref}"${st}/>` : `<c r="${ref}"${st} t="n"><v>${Number(n)}</v></c>`; }
function excelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null;
}
function fmtLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}`;
}
// Row height for wrapped text: the longest of the text columns, by its width (template widths).
function rowHeight(r) {
  const widths = { clauseName: 24, requirement: 38, currentSystem: 46, plannedAction: 50, linkedActions: 34 };
  let lines = 1;
  for (const [k, w] of Object.entries(widths)) {
    const text = String(r[k] || '');
    const per = Math.max(10, Math.floor(w * 1.15));
    const n = text.split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / per)), 0);
    lines = Math.max(lines, n);
  }
  return Math.min(409, Math.max(45, lines * 12 + 9));
}
// Replace one cell (by reference) in a sheet's XML; `make(attrs, inner)` returns the new cell.
function swapCell(xml, ref, make) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`template cell ${ref} not found`);
  return xml.slice(0, m.index) + make(m[1], m[2] || '') + xml.slice(m.index + m[0].length);
}
const styleOf = attrs => { const m = / s="(\d+)"/.exec(attrs); return m ? m[1] : null; };
function setCached(xml, ref, value, formula) {
  return swapCell(xml, ref, (attrs, inner) => {
    const f = formula != null ? `<f aca="false">${formula}</f>` : (/<f[^>]*>[\s\S]*?<\/f>/.exec(inner) || [''])[0];
    return `<c r="${ref}"${attrs.replace(/ t="\w+"/, '')} t="n">${f}<v>${value}</v></c>`;
  });
}

// The numbers each Summary formula yields over the filled Register — exactly Excel's semantics.
function summaryValues(rows) {
  const data = rows.filter(r => String(r.requirement || '') !== '');
  const D7 = data.length;
  const n = s => data.filter(r => r.complianceStatus === s).length;
  const isNa = r => r.complianceStatus === STATUS.na || r.complianceStatus === '';
  const v = { D7, E7: n(STATUS.full), F7: n(STATUS.partial), G7: n(STATUS.not), H7: n(STATUS.tbu) };
  const naAll = data.filter(isNa).length;
  v.I7 = D7 - naAll === 0 ? 0 : v.E7 / (D7 - naAll);
  for (const k of ['E', 'F', 'G', 'H']) v[k + '8'] = D7 === 0 ? 0 : v[k + '7'] / D7;
  const sums = { D: 0, E: 0, F: 0, G: 0, H: 0 }; let naSections = 0;
  for (let i = 0; i < 7; i++) {
    const row = 12 + i, fam = String(4 + i);
    const inFam = data.filter(r => String(r.clause).startsWith(fam + '.'));
    const c = s => inFam.filter(r => r.complianceStatus === s).length;
    const na = inFam.filter(isNa).length; naSections += na;
    v['D' + row] = inFam.length; v['E' + row] = c(STATUS.full); v['F' + row] = c(STATUS.partial); v['G' + row] = c(STATUS.not); v['H' + row] = c(STATUS.tbu);
    v['I' + row] = inFam.length - na === 0 ? 0 : v['E' + row] / (inFam.length - na);
    for (const k of Object.keys(sums)) sums[k] += v[k + row];
  }
  for (const k of Object.keys(sums)) v[k + '19'] = sums[k];
  v.I19 = v.D19 - naSections === 0 ? 0 : v.E19 / (v.D19 - naSections);
  WORK_LABELS.forEach((label, i) => { const c = data.filter(r => r.workStatus === label).length; v['D' + (23 + i)] = c; v['E' + (23 + i)] = D7 === 0 ? 0 : c / D7; });
  let prSum = 0;
  PRIORITY_LABELS.forEach((label, i) => { const c = data.filter(r => r.priority === label).length; prSum += c; v['H' + (23 + i)] = c; v['I' + (23 + i)] = D7 === 0 ? 0 : c / D7; });
  v.H26 = D7 - prSum; v.I26 = D7 === 0 ? 0 : v.H26 / D7;
  const prog = data.map(r => Number(r.progress)).filter(x => Number.isFinite(x));
  v.D28 = prog.length ? prog.reduce((a, b) => a + b, 0) / prog.length : 0;
  return v;
}

function fillGapAnalysis(templateBuf, ds) {
  const code = String(ds.standard);
  const sheetName = `ISO ${code} Register`;
  const sys = SYSTEM_TITLE[code] || `ISO ${code}`;
  const asAt = fmtLongDate(ds.dataAsAt);
  const entries = readZip(templateBuf);
  const qName = `&apos;${sheetName}&apos;`;

  // ── Register ──
  let reg = getPart(entries, 'xl/worksheets/sheet2.xml');
  const sdStart = reg.indexOf('<sheetData>') + '<sheetData>'.length, sdEnd = reg.indexOf('</sheetData>');
  const sd = reg.slice(sdStart, sdEnd);
  let head = sd.slice(0, sd.indexOf('<row r="6"'));
  head = swapCell(head, 'C1', a => strCell('C1', styleOf(a), `ISO ${code} Gap Analysis & Action Register`));
  head = swapCell(head, 'C2', a => strCell('C2', styleOf(a), `${sys}  ·  Etcher Solutions`));
  head = swapCell(head, 'M2', a => strCell('M2', styleOf(a), `Data as at ${asAt}`));
  const families = [...new Set(ds.rows.map(r => Number(String(r.clause).split('.')[0])))].sort((a, b) => a - b);
  let out = '', rn = 6;
  const rowAttrs = ht => ` customFormat="false" ht="${ht}" hidden="false" customHeight="true" outlineLevel="0" collapsed="false"`;
  for (const fam of families) {
    out += `<row r="${rn}"${rowAttrs(21.75)}>${strCell('A' + rn, 38, `${fam}   ${sectionTitle(code, fam).toUpperCase()}`)}${'BCDEFGHIJKLM'.split('').map(c => `<c r="${c}${rn}" s="39"/>`).join('')}</row>`;
    rn++;
    for (const r of ds.rows.filter(x => Number(String(x.clause).split('.')[0]) === fam)) {
      out += `<row r="${rn}"${rowAttrs(rowHeight(r))}>`
        + strCell('A' + rn, 40, r.clause) + strCell('B' + rn, 41, r.clauseName) + strCell('C' + rn, 42, r.requirement)
        + strCell('D' + rn, 42, r.currentSystem) + strCell('E' + rn, 42, r.plannedAction)
        + strCell('F' + rn, 43, r.complianceStatus) + strCell('G' + rn, 44, r.originalStatus) + strCell('H' + rn, 45, r.workStatus)
        + strCell('I' + rn, 45, r.priority) + strCell('J' + rn, 45, r.owner) + numCell('K' + rn, 46, excelSerial(r.dueDate))
        + numCell('L' + rn, 47, Number(r.progress) || 0) + strCell('M' + rn, 42, r.linkedActions) + '</row>';
      rn++;
    }
  }
  const last = Math.max(rn - 1, 6);
  reg = reg.slice(0, sdStart) + head + out + reg.slice(sdEnd);
  reg = reg.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:M${last}"/>`)
    .replace(/<autoFilter ref="A5:M\d+">/, `<autoFilter ref="A5:M${last}">`)
    .split('ISO 9001 Gap Analysis').join(`ISO ${code} Gap Analysis`);
  setPart(entries, 'xl/worksheets/sheet2.xml', reg);

  // ── Summary ──
  let sum = getPart(entries, 'xl/worksheets/sheet1.xml').split(TEMPLATE_SHEET).join(sheetName).split('ISO 9001 Gap Analysis').join(`ISO ${code} Gap Analysis`);
  sum = swapCell(sum, 'D1', a => strCell('D1', styleOf(a), `ISO ${code} Gap Analysis — Summary`));
  sum = swapCell(sum, 'D2', a => strCell('D2', styleOf(a), `${sys}  ·  Data as at ${asAt}`));
  sum = swapCell(sum, 'B7', a => strCell('B7', styleOf(a), `Counts update automatically\nfrom the ${sheetName} tab.`));
  for (let i = 0; i < 7; i++) sum = swapCell(sum, 'C' + (12 + i), a => strCell('C' + (12 + i), styleOf(a), sectionTitle(code, 4 + i)));
  // D6 / B3.5: conformance excludes Not applicable and out-of-scope (blank status) rows, so the
  // workbook's figure equals the board's conformance_pct.
  const C = `${qName}!$C$6:$C$110`, F = `${qName}!$F$6:$F$110`, Acol = `${qName}!$A$6:$A$110`;
  const naAll = `(COUNTIF(${F},&quot;Not applicable&quot;)+COUNTIFS(${C},&quot;&lt;&gt;&quot;,${F},&quot;&quot;))`;
  const naSec = row => `(COUNTIFS(${Acol},$B${row}&amp;&quot;.*&quot;,${F},&quot;Not applicable&quot;)+COUNTIFS(${Acol},$B${row}&amp;&quot;.*&quot;,${C},&quot;&lt;&gt;&quot;,${F},&quot;&quot;))`;
  const naSecAll = `(COUNTIFS(${Acol},&quot;?*.*&quot;,${F},&quot;Not applicable&quot;)+COUNTIFS(${Acol},&quot;?*.*&quot;,${C},&quot;&lt;&gt;&quot;,${F},&quot;&quot;))`;
  const formulas = { I7: `IF(($D$7-${naAll})=0,0,E7/($D$7-${naAll}))`, I19: `IF((D19-${naSecAll})=0,0,E19/(D19-${naSecAll}))` };
  for (let i = 0; i < 7; i++) { const row = 12 + i; formulas['I' + row] = `IF((D${row}-${naSec(row)})=0,0,E${row}/(D${row}-${naSec(row)}))`; }
  const vals = summaryValues(ds.rows);
  for (const [ref, value] of Object.entries(vals)) sum = setCached(sum, ref, value, formulas[ref] || null);
  setPart(entries, 'xl/worksheets/sheet1.xml', sum);

  // ── Source Data: every requirement row, full fidelity (no internal-only field) ──
  let src = getPart(entries, 'xl/worksheets/sheet3.xml');
  const s3Start = src.indexOf('<sheetData>') + '<sheetData>'.length, s3End = src.indexOf('</sheetData>');
  const s3head = src.slice(s3Start, s3End);
  let body = '';
  ds.rows.forEach((r, i) => {
    const rr = i + 2, d = r.sourceData || {};
    body += `<row r="${rr}">` + SOURCE_COLUMNS.map((k, ci) => {
      const v = d[k];
      return typeof v === 'number' ? numCell(col(ci) + rr, null, v) : strCell(col(ci) + rr, null, v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v);
    }).join('') + '</row>';
  });
  const srcLast = ds.rows.length + 1;
  src = src.slice(0, s3Start) + s3head + body + src.slice(s3End);
  src = src.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:X${srcLast}"/>`).replace(/<autoFilter ref="A1:X\d+">/, `<autoFilter ref="A1:X${srcLast}">`);
  setPart(entries, 'xl/worksheets/sheet3.xml', src);

  // ── Workbook: the Register's name, print area / filter to the last row, recalculate on open ──
  let wb = getPart(entries, 'xl/workbook.xml').split(TEMPLATE_SHEET).join(sheetName);
  wb = wb.replace(new RegExp(`(${qName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}!\\$A\\$(?:1|5):\\$M\\$)110`, 'g'), `$1${last}`)
    .replace(/(&apos;Source Data&apos;!\$A\$1:\$X\$)\d+/, `$1${srcLast}`)
    .replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ');
  setPart(entries, 'xl/workbook.xml', wb);
  return { buffer: writeZip(entries), lastRow: last, values: vals };
}

module.exports = { fillGapAnalysis, summaryValues, sectionTitle, SYSTEM_TITLE, STATUS, WORK_LABELS, SOURCE_COLUMNS, guard, excelSerial };
