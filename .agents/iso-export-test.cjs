// Phase 10 acceptance. 10.1's own check runs first and stands alone: every string left in
// iso/templates/gap-analysis-template.xlsx must be on this explicit allowlist (headers, section
// titles, the instruction line, dropdown/validation values, Summary labels, Source Data's import
// field-key headers) — never a client's finding text. Run this before every `git add` of that file;
// a real client's gap-analysis workbook sat in the repo root while this template was built from it
// (Etcher_ISO9001_Gap_Analysis.xlsx — a real company's candid self-assessment notes), so a silent
// regression here is a real leak, not a cosmetic one. 10.2 (export.dataset + the XML filler) adds its
// own sections below once built.
const fs = require('fs');
const path = require('path');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const { readZip, getPart } = require(path.join(__dirname, '..', 'api', '_isoZip.js'));
const TEMPLATE = path.join(__dirname, '..', 'iso', 'templates', 'gap-analysis-template.xlsx');

function decodeXml(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// ── The allowlist (10.1) — every string the template may contain, exactly. Grouped as the plan's own
// wording groups them; the grouping is documentation, the check itself is one flat Set. ───────────
const HEADERS = [
  // Register row 5 (column headers) and the title/subtitle row.
  'Clause', 'Clause Name', 'Requirement', 'Current System', 'Planned Action', 'Compliance Status',
  'Original Status', 'Work Status', 'Priority', 'Owner', 'Due Date', 'Progress', 'Linked Actions',
  'ISO 9001 Gap Analysis & Action Register', 'Quality Management System  ·  Etcher Solutions', 'Data as at 28 Sep 2026',
  // Summary sheet's own column headers (rows 6, 11, 22) and title row.
  'ISO 9001 Gap Analysis — Summary', 'Quality Management System  ·  Data as at 28 Sep 2026',
  'Requirements', 'Fully conforming', 'Partially conforming', 'Not conforming', 'To be updated', 'Overall conformance',
  'Section', '% Fully conforming', 'Work status', 'Share',
  // Source Data row 1 — the import field keys api/_isoImport.js maps a re-uploaded workbook by.
  'standard', 'clause', 'clauseName', 'requirement', 'currentSystem', 'plannedAction', 'complianceStatus',
  'originalComplianceStatus', 'workStatus', 'priority', 'owner', 'dueDate', 'progressPercent', 'evidenceCount',
  'notesCount', 'subtaskCount', 'sharedActions', 'sourceSheet', 'sourceRow', 'sourceChanged', 'missingFromSource',
  'manual', 'archived', 'updatedAt',
];
const SECTION_TITLES = [
  'Compliance overview', 'Status by clause section', 'Action progress',
  'Context of the organization', 'Leadership', 'Planning', 'Support', 'Operation',
  'Performance evaluation', 'Improvement', 'Total', 'Average progress',
  '4   CONTEXT OF THE ORGANIZATION', // the one kept section-header row, a style exemplar (10.1)
];
const INSTRUCTION_LINE = [
  'Compliance Status, Work Status and Priority have dropdowns  ·  Owner, Due Date (dd/mm/yyyy) and Progress (%) are for the team to complete  ·  Overdue dates turn red',
  'Counts update automatically\nfrom the ISO 9001 Register tab.',
];
const VALIDATION_LISTS = [
  // Compliance/work status and priority dropdown options — reused by Summary's own COUNTIF labels too.
  'Not started', 'Planned', 'In progress', 'Complete', 'On hold', 'Not set', 'High', 'Medium', 'Low',
];
const SUMMARY_LABELS = ['clause requirements', 'fully conforming'];
// The one kept data row (row 7) — a style exemplar, D/E/M (its own client-finding columns) blanked.
// Its A/B/C are the ISO 9001 standard's own clause number/title/requirement wording — not Etcher's.
const EXEMPLAR_DATA_ROW = [
  '4.1', 'Understanding the organization and its context',
  "Determine what factors may affect the organization's strategy and its ability to achieve intended results",
];
const ALLOWED = new Set([...HEADERS, ...SECTION_TITLES, ...INSTRUCTION_LINE, ...VALIDATION_LISTS, ...SUMMARY_LABELS, ...EXEMPLAR_DATA_ROW]);

(() => {
  if (!fs.existsSync(TEMPLATE)) { fail.push(`iso/templates/gap-analysis-template.xlsx does not exist — run the Phase 10.1 build script first (see docs/iso-audit-integration-plan.md A95).`); return report(); }
  const entries = readZip(fs.readFileSync(TEMPLATE));
  ok(entries.length > 0, 'the template is a readable zip');

  // Every shared string, decoded, must be empty (an orphaned/blanked entry) or on the allowlist.
  const ss = getPart(entries, 'xl/sharedStrings.xml');
  const raw = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const nonEmpty = raw.filter(s => s.length > 0);
  ok(nonEmpty.length > 0, `the template has some real text left (${nonEmpty.length} non-empty strings) — not an all-blank file`);
  const notAllowed = nonEmpty.filter(s => !ALLOWED.has(s));
  ok(notAllowed.length === 0, `every non-empty string in the template is on the explicit allowlist (${notAllowed.length} were not: ${JSON.stringify(notAllowed.slice(0, 5))})`);
  // The reverse direction too: the allowlist should not quietly rot to include strings the template
  // no longer has (a sign something upstream changed and this list was not revisited).
  const unused = [...ALLOWED].filter(s => !nonEmpty.includes(s));
  ok(unused.length === 0, `every allowlisted string is actually present in the template (${unused.length} were not: ${JSON.stringify(unused.slice(0, 5))})`);

  // No inline strings anywhere (a <c t="inlineStr"> bypasses the shared-string table and this check).
  let inlineCount = 0;
  for (const e of entries.filter(x => /xl\/worksheets\/sheet\d+\.xml$/.test(x.name))) {
    const xml = (e.method === 0 ? Buffer.from(e.rawData) : require('zlib').inflateRawSync(e.rawData)).toString('utf8');
    inlineCount += (xml.match(/t="inlineStr"/g) || []).length;
  }
  ok(inlineCount === 0, `no inline strings anywhere (they would bypass this check entirely; found ${inlineCount})`);

  // No comments or externalLinks parts (10.1's explicit rule — the source workbook has none either,
  // so this also catches a future source file that does).
  const forbidden = entries.filter(e => /comment|externalLink/i.test(e.name));
  ok(forbidden.length === 0, `no comments or externalLinks parts (found: ${JSON.stringify(forbidden.map(e => e.name))})`);

  // docProps: title/subject/creator all blank.
  const core = getPart(entries, 'docProps/core.xml');
  ok(/<dc:title\s*\/>|<dc:title><\/dc:title>/.test(core), 'docProps/core.xml title is blank');
  ok(/<dc:subject\s*\/>|<dc:subject><\/dc:subject>/.test(core), 'docProps/core.xml subject is blank');
  ok(/<dc:creator\s*\/>|<dc:creator><\/dc:creator>/.test(core), 'docProps/core.xml creator is blank');

  // Source Data keeps only its header row (10.1's explicit rule).
  const sheet3 = getPart(entries, 'xl/worksheets/sheet3.xml');
  const rows3 = (sheet3.match(/<row r="\d+"/g) || []).length;
  ok(rows3 === 1, `Source Data has only its header row (got ${rows3})`);

  // The Register keeps exactly its chrome + one section header + one data row (10.1's exemplars).
  const sheet2 = getPart(entries, 'xl/worksheets/sheet2.xml');
  const rows2 = [...sheet2.matchAll(/<row r="(\d+)"/g)].map(m => Number(m[1]));
  ok(JSON.stringify(rows2) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), `the Register has exactly rows 1-7 (got ${JSON.stringify(rows2)})`);
  ok(!/<c r="D7"[^>]*t="s"/.test(sheet2) && !/<c r="E7"[^>]*t="s"/.test(sheet2) && !/<c r="M7"[^>]*t="s"/.test(sheet2), 'the kept data row\'s own client-finding columns (D, E, M) carry no string reference');

  report();
})();

function report() {
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
}
