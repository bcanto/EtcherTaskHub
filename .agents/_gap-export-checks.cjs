// Release-1 B3.5 (plan 10.2) checks for iso-export-test: export.dataset + the filled gap-analysis
// workbook for 9001, 14001 and 45001 from one offline demo board. The three files are also written
// to .agents/shots/ (gitignored) for the user's STOP 2b review in Excel.
const fs = require('fs');
const path = require('path');
const H = require('./_iso-harness.cjs');
const { readZip, getPart } = require(path.join(__dirname, '..', 'api', '_isoZip.js'));
const TEMPLATE = path.join(__dirname, '..', 'iso', 'templates', 'gap-analysis-template.xlsx');

function decode(s) {
  return String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
// {ref: {text, num, formula}} for one sheet's cells (inline strings and numbers; shared strings by index).
function cells(xml, shared) {
  const out = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, inner = ''] = m;
    const t = (/ t="(\w+)"/.exec(attrs) || [])[1];
    const f = (/<f[^>]*>([\s\S]*?)<\/f>/.exec(inner) || [])[1];
    const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
    let text = '';
    if (t === 'inlineStr') text = decode((/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner) || [, ''])[1]);
    else if (t === 's' && v != null) text = shared[Number(v)] || '';
    out[ref] = { text, num: t !== 's' && t !== 'inlineStr' && v != null ? Number(v) : null, formula: f != null ? decode(f) : null };
  }
  return out;
}

module.exports = async function gapExportChecks(ok) {
  const srv = await H.startOffline(3170);
  const A = H.ADMIN;
  try {
    const b = await srv.board({ standards: ['9001', '14001', '45001'], title: 'Gap analysis demo' });
    const basis = 'Seen the procedure and two signed records.';
    const set = (k, p) => srv.set(b, k, p);
    await set('9001 4.1', { compliance_status: 'compliant', ofi: true, ofi_note: 'Automate the reminder', current_system: basis, interview_notes: 'SECRET-INTERVIEW-NOTE', internal_notes: 'SECRET-INTERNAL-NOTE', auditor_observations: 'SECRET-OBSERVATION' });
    await set('9001 4.2', { compliance_status: 'partially_compliant', gap_reason: 'ineffective', current_system: basis, recommended_action: 'Sign every record' });
    await set('9001 4.3', { compliance_status: 'non_compliant', gap_reason: 'not_implemented', current_system: '=HYPERLINK("http://evil.example","click")', recommended_action: '@SUM(1+1)' });
    await set('9001 4.4', { compliance_status: 'not_applicable', na_justification: 'No design activity' });
    await set('9001 5.1.1', { compliance_status: 'out_of_scope' });
    await set('9001 5.2.1', { compliance_status: 'compliant', current_system: '+cmd|calc seen on site', responsible_uid: 'u1', target_date: '2027-03-31' });
    await set('14001 4.1', { compliance_status: 'compliant', current_system: basis });
    await set('45001 4.1', { compliance_status: 'non_compliant', gap_reason: 'no_evidence', current_system: basis, recommended_action: 'Consult workers' });
    // One internal action (must not be listed) and one client-visible action (listed) on 9001 4.2.
    const internal = await srv.must(A, { op: 'action.create', auditId: b.id, title: 'SECRET-INTERNAL-ACTION', targetType: 'requirement', targetId: b.key('9001 4.2').id, priority: 'high' });
    const shared = await srv.must(A, { op: 'action.create', auditId: b.id, title: 'Retrain the records team', targetType: 'requirement', targetId: b.key('9001 4.2').id, priority: 'med', visibility: 'client_all' });
    await srv.must(A, { op: 'action.updateStatus', auditId: b.id, id: shared.id, to: 'assigned', expectedVersion: shared.row_version });
    ok(internal && shared, 'fixture actions created');

    const ds = await srv.must(A, { op: 'export.dataset', auditId: b.id, standard: '9001' });
    const dsText = JSON.stringify(ds);
    ok(!/ireq_|iaud_|iact_|ievi_|offline:|stable_key|storage_path|SECRET-/.test(dsText), 'export.dataset carries no record ids, uids, stable keys, storage paths or internal-only text');
    ok(ds.rows.every(r => Object.keys(r).every(k => ['clause', 'clauseName', 'requirement', 'currentSystem', 'plannedAction', 'complianceStatus', 'originalStatus', 'workStatus', 'priority', 'owner', 'dueDate', 'progress', 'linkedActions', 'sourceData'].includes(k))), 'every row is projected through EXPORT_FIELDS');
    ok((await srv.call(H.CLIENT('cu1', 'c1'), { op: 'export.dataset', auditId: b.id, standard: '9001' })).status === 403, 'a client cannot export');
    ok((await srv.call(A, { op: 'export.gapAnalysis', auditId: b.id, standard: '27001' })).status === 400, 'a standard that is not on the board is refused');

    const reqs = await srv.must(A, { op: 'requirement.list', auditId: b.id });
    const tpl = readZip(fs.readFileSync(TEMPLATE));
    const tplReg = getPart(tpl, 'xl/worksheets/sheet2.xml');
    const between = (s, a, z) => { const i = s.indexOf(a); return i < 0 ? null : s.slice(i, s.indexOf(z, i) + z.length); };
    for (const code of ['9001', '14001', '45001']) {
      const res = await srv.must(A, { op: 'export.gapAnalysis', auditId: b.id, standard: code });
      ok(res.filename === `${b.ref}_ISO${code}_Gap_Analysis.xlsx`, `${code}: file named <REF>_ISO<code>_Gap_Analysis.xlsx (got ${res.filename})`);
      const buf = Buffer.from(res.base64, 'base64');
      fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'shots', res.filename), buf);
      const z = readZip(buf);
      const shared = [...getPart(z, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode(m[1].replace(/<[^>]+>/g, '')));
      const wb = getPart(z, 'xl/workbook.xml');
      const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
      ok(JSON.stringify(names) === JSON.stringify(['Summary', `ISO ${code} Register`, 'Source Data']), `${code}: three sheets — Summary, ISO ${code} Register, Source Data (got ${JSON.stringify(names)})`);
      ok(/fullCalcOnLoad="1"/.test(wb), `${code}: Excel recalculates on open`);
      const regXml = getPart(z, 'xl/worksheets/sheet2.xml'), sumXml = getPart(z, 'xl/worksheets/sheet1.xml'), srcXml = getPart(z, 'xl/worksheets/sheet3.xml');
      const reg = cells(regXml, shared), sum = cells(sumXml, shared), src = cells(srcXml, shared);
      const sys = { '9001': 'Quality Management System', '14001': 'Environmental Management System', '45001': 'Occupational Health and Safety Management System' }[code];
      ok(reg.C1.text === `ISO ${code} Gap Analysis & Action Register` && reg.C2.text === `${sys}  ·  Etcher Solutions` && /^Data as at \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(reg.M2.text), `${code}: Register title, subtitle and data-as-at (got ${reg.C1.text} / ${reg.C2.text} / ${reg.M2.text})`);
      ok(sum.D1.text === `ISO ${code} Gap Analysis — Summary` && sum.D2.text.startsWith(sys), `${code}: Summary title and subtitle per standard`);
      ok(regXml.includes(`ISO ${code} Gap Analysis&amp;R`) && (code === '9001' || !regXml.includes('ISO 9001 Gap Analysis')), `${code}: the footer names the standard`);
      const stdReqs = reqs.filter(r => r.standard_code === code);
      const rowsA = Object.entries(reg).filter(([ref]) => /^A\d+$/.test(ref) && Number(ref.slice(1)) >= 6);
      const sections = rowsA.filter(([, c]) => /^\d+ {3}[A-Z]/.test(c.text));
      const dataRows = rowsA.filter(([, c]) => /^\d+(\.\d+)+$/.test(c.text) || /^\d+\.\d+$/.test(c.text));
      ok(sections.length === 7 && sections.map(([, c]) => c.text.split(' ')[0]).join(',') === '4,5,6,7,8,9,10', `${code}: one section row per clause 4–10 (got ${sections.map(([, c]) => c.text.split(' ')[0]).join(',')})`);
      ok(dataRows.length === stdReqs.length, `${code}: one data row per requirement (${dataRows.length} vs ${stdReqs.length})`);
      if (code === '45001') ok(sections.some(([, c]) => c.text === '5   LEADERSHIP AND WORKER PARTICIPATION') && sum.C13.text === 'Leadership and worker participation', '45001: clause 5 is "Leadership and worker participation"');
      const last = Math.max(...Object.keys(reg).filter(r => /^A\d+$/.test(r)).map(r => Number(r.slice(1))));
      ok(new RegExp(`<autoFilter ref="A5:M${last}">`).test(regXml) && new RegExp(`Register&apos;!\\$A\\$1:\\$M\\$${last}<`).test(wb), `${code}: autofilter and print area end at the last row (${last})`);
      // Template parts kept: validations, conditional formats, data bar (x14), frozen pane, drawing/logo.
      ok(between(regXml, '<dataValidations', '</dataValidations>') === between(tplReg, '<dataValidations', '</dataValidations>'), `${code}: the five data validations are exactly the template's`);
      ok((regXml.match(/<conditionalFormatting /g) || []).length === (tplReg.match(/<conditionalFormatting /g) || []).length && between(regXml, '<extLst>', '</extLst>') === between(tplReg, '<extLst>', '</extLst>'), `${code}: conditional formats and the x14 data bar are intact`);
      ok(regXml.includes('<pane xSplit="2" ySplit="5" topLeftCell="C6" activePane="bottomRight" state="frozen"/>') && regXml.includes('<drawing r:id="rId1"/>'), `${code}: frozen pane and the logo drawing are intact`);
      ok(getPart(z, 'xl/styles.xml') === getPart(tpl, 'xl/styles.xml') && getPart(z, 'xl/drawings/drawing2.xml') === getPart(tpl, 'xl/drawings/drawing2.xml'), `${code}: styles and drawings byte-identical to the template`);
      // Summary formulas: every one points at this standard's Register; cached values = the board.
      const formulas = Object.values(sum).filter(c => c.formula);
      ok(formulas.length >= 60 && formulas.every(c => !/Register/.test(c.formula) || c.formula.includes(`'ISO ${code} Register'!`)) && (code === '9001' || !sumXml.includes('ISO 9001 Register')), `${code}: every Summary formula references 'ISO ${code} Register' (${formulas.length} formulas)`);
      const count = s => stdReqs.filter(r => (r.compliance_status || 'not_assessed') === s).length;
      ok(sum.D7.num === stdReqs.length && sum.E7.num === count('compliant') && sum.F7.num === count('partially_compliant') && sum.G7.num === count('non_compliant') && sum.H7.num === count('not_assessed'),
        `${code}: cached counts equal the board (D7 ${sum.D7.num}/${stdReqs.length}, E7 ${sum.E7.num}/${count('compliant')}, F7 ${sum.F7.num}, G7 ${sum.G7.num}, H7 ${sum.H7.num}/${count('not_assessed')})`);
      const m = await srv.must(A, { op: 'dashboard.audit', auditId: b.id, standard: code });
      const conf = (m.kpis || []).find(k => k.key === 'req_conforming');
      const confPct = conf && conf.detail ? Number((/(\d+)%/.exec(conf.detail) || [])[1]) : null;
      ok(confPct != null && Math.round(sum.I7.num * 100) === confPct, `${code}: overall conformance equals the board's conformance_pct (${Math.round(sum.I7.num * 100)}% vs ${confPct}%)`);
      // Exactly, not just after rounding: conforming ÷ applicable (N/A and out of scope excluded).
      const [, xOf, yOf] = /(\d+) of (\d+)/.exec(String(conf && conf.display)) || [];
      ok(xOf != null && Math.abs(sum.I7.num - Number(xOf) / Number(yOf)) < 1e-9, `${code}: overall conformance is exactly ${xOf} of ${yOf} (got ${sum.I7.num})`);
      const famSum = [12, 13, 14, 15, 16, 17, 18].reduce((s, r) => s + sum['D' + r].num, 0);
      ok(famSum === sum.D19.num && sum.D19.num === stdReqs.length, `${code}: the section rows add up to the total (${famSum})`);
      ok(src.A1.text === 'standard' && Object.keys(src).filter(r => /^A\d+$/.test(r)).length === stdReqs.length + 1, `${code}: Source Data has its header and one row per requirement`);
      ok(!/<f[ >]/.test(regXml) && !/<f[ >]/.test(srcXml), `${code}: no formula anywhere in the Register or Source Data (user text is never a formula)`);
      const all = z.map(e => e.name).filter(n => /\.xml$/.test(n)).map(n => getPart(z, n)).join('\n');
      ok(!/SECRET-|ireq_|iaud_|iact_|offline:/.test(all), `${code}: no internal-only text, record id or uid in any part of the file`);
      if (code === '9001') {
        const rowOf = clause => Number(dataRows.find(([, c]) => c.text === clause)[0].slice(1));
        const r41 = rowOf('4.1'), r42 = rowOf('4.2'), r43 = rowOf('4.3'), r44 = rowOf('4.4'), r511 = rowOf('5.1.1'), r521 = rowOf('5.2.1');
        ok(reg['F' + r41].text === 'Fully conforming' && reg['D' + r41].text === `OFI: Automate the reminder — ${basis}`, `Compliant + OFI → Fully conforming with "OFI:" before the basis (got ${reg['F' + r41].text} / ${reg['D' + r41].text})`);
        ok(reg['F' + r42].text === 'Partially conforming' && reg['D' + r42].text === `Gap reason: Implemented but ineffective. ${basis}` && reg['E' + r42].text === 'Sign every record', 'Partial → Partially conforming, gap reason before the basis, planned action');
        ok(reg['F' + r43].text === 'Not conforming' && reg['D' + r43].text === 'Gap reason: Not implemented. =HYPERLINK("http://evil.example","click")' && reg['E' + r43].text === "'@SUM(1+1)" && reg['D' + r521].text === "'+cmd|calc seen on site", `Non-Compliant → Not conforming; text starting = + - @ is written with a leading ' (got ${reg['E' + r43].text} / ${reg['D' + r521].text})`);
        ok(reg['F' + r44].text === 'Not applicable' && reg['D' + r44].text === 'Not applicable — No design activity', 'Not applicable → the template\'s "Not applicable", reason in Current System');
        ok(!reg['F' + r511].text && reg['D' + r511].text === "Outside this audit's scope", 'Out of scope → blank status, "Outside this audit\'s scope"');
        const notAssessed = dataRows.find(([ref, c]) => !stdReqs.find(r => r.clause === c.text).compliance_status || stdReqs.find(r => r.clause === c.text).compliance_status === 'not_assessed');
        ok(notAssessed && reg['F' + notAssessed[0].slice(1)].text === 'To be updated', 'Not assessed → To be updated');
        ok(reg['J' + r521].text && reg['K' + r521].num === 46477, `Owner as a display name and Due Date as an Excel date (got ${reg['J' + r521].text} / ${reg['K' + r521].num})`);
        ok(reg['M' + r42].text.includes('Retrain the records team') && !reg['M' + r42].text.includes('SECRET'), `Linked Actions lists the client-visible action only (got "${reg['M' + r42].text}")`);
        ok(reg['H' + r42].text === 'Planned' && reg['I' + r42].text === 'High' && reg['H' + r41].text === 'Not started', `Work status and priority roll up the linked actions (got ${reg['H' + r42].text} / ${reg['I' + r42].text})`);
        ok(!reg['G' + r41].text, 'Original Status is blank on a board with no previous audit');
      }
    }
  } finally { srv.stop(); }
};
