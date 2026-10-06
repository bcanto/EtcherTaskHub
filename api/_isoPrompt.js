// Document generator prompt builder — plan 8c.3 (R12, D22). Pure and deterministic: the same inputs
// always give byte-identical text. No AI service, no network, no clock (the prepared-on date is a
// parameter), no randomness. It only assembles an approved (or, for admins, a clearly marked draft)
// template, the client's CONFIRMED profile values, the requirement, its confirmed related
// requirements and the user's answers into a strict text prompt the user may copy or download.
const { PROFILE_FIELDS, FIELD_BY_KEY, fieldCompleteness } = require('./_isoProfile');

// The brief's mandatory safeguards, word for word. Always present, always in this order.
const MANDATORY_SAFEGUARDS = [
  'Do not invent company activities, locations, processes, risks, hazards, environmental aspects, interested parties, legal obligations, names, owners, approval authorities, dates or review frequencies.',
  'If necessary information is missing, insert: [INFORMATION REQUIRED: describe the missing information]',
  'Do not claim that the organisation is certified.',
  'Do not state that the generated document guarantees conformity.',
  'Do not state that the document alone satisfies an ISO requirement.',
  'Do not reproduce ISO requirements that were not supplied in the prompt.',
  'Clearly distinguish confirmed company information from placeholders.',
  'Produce an editable draft requiring organisational review and approval.',
  'Use practical organisation-specific wording rather than generic claims.',
  'Include a final list of all unresolved placeholders.',
];
const SAFEGUARDS_HEADING = 'MANDATORY SAFEGUARDS';
const IDENTITY_FIELDS = ['legal_name', 'trading_name', 'abn', 'address', 'jurisdiction'];
const BRAND_FIELDS = ['logo_ref', 'brand_primary', 'brand_secondary'];
const CONVENTION_FIELDS = ['numbering_convention', 'revision_convention', 'review_frequency', 'terminology'];

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function safeFilenamePart(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
}
function buildFilename(clientName, template) {
  const parts = [safeFilenamePart(clientName) || 'Client', safeFilenamePart(template.filenameStem) || 'Document', 'Generator_Prompt', 'v' + (safeFilenamePart(template.version) || '1')];
  if (template.reviewStatus !== 'approved') parts.push('DRAFT');
  let stem = parts.join('_').replace(/_+/g, '_').slice(0, 116).replace(/[_-]+$/, '');
  if (WINDOWS_RESERVED.test(stem.split('_')[0])) stem = 'File_' + stem;
  return (stem || 'Generator_Prompt') + '.txt';
}

const placeholderFor = what => `[INFORMATION REQUIRED: ${what}]`;
// A checklist answer is stored as JSON {items: [ids], other: text}. Pure and order-stable.
function checklistLines(q, raw, template) {
  let v = null;
  try { v = raw ? JSON.parse(String(raw)) : null; } catch (e) { v = null; }
  const ticked = new Set(v && Array.isArray(v.items) ? v.items.map(String) : []);
  const out = [];
  for (const it of q.items || []) {
    if (!ticked.has(it.id)) continue;
    const src = (template.sources || [])[it.source];
    out.push(it.label + (it.note ? ` (${it.note})` : '') + (src ? ` — source: ${src.title}` : ''));
  }
  const other = v && typeof v.other === 'string' ? v.other.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 20) : [];
  for (const o of other) out.push(`Other, entered by the user (not from the checklist): ${o.slice(0, 300)}`);
  return out;
}
function stdLabel(r) { return 'ISO ' + r.standard_code + (r.edition ? ':' + r.edition : ''); }

// One confirmed fact, or a placeholder (recorded so it can be listed again at the end).
function factLines(keys, fields, include, placeholders) {
  const lines = [];
  for (const key of keys) {
    const f = FIELD_BY_KEY[key];
    if (!f) continue;
    if (f.sensitive && include[key] === false) {
      const ph = placeholderFor(`${f.label} — not included in this prompt by the user; add it in the organisation's own copy`);
      placeholders.push(ph); lines.push(`- ${f.label}: ${ph}`);
      continue;
    }
    const stored = fields[key];
    if (f.kind === 'list') {
      const confirmed = (Array.isArray(stored) ? stored : []).filter(i => i.confirmed);
      const unconfirmed = (Array.isArray(stored) ? stored : []).length - confirmed.length;
      if (!confirmed.length) {
        const ph = placeholderFor(`${f.label} — none confirmed yet`);
        placeholders.push(ph); lines.push(`- ${f.label}: ${ph}`);
      } else {
        lines.push(`- ${f.label} (confirmed):`);
        for (const i of confirmed) lines.push(`    - ${i.text}`);
        if (unconfirmed) { const ph = placeholderFor(`${unconfirmed} further ${f.label.toLowerCase()} item(s) not yet confirmed — confirm or remove`); placeholders.push(ph); lines.push(`    - ${ph}`); }
      }
      continue;
    }
    if (stored && stored.confirmed && stored.value) lines.push(`- ${f.label} (confirmed): ${stored.value}`);
    else { const ph = placeholderFor(`${f.label} — not yet confirmed`); placeholders.push(ph); lines.push(`- ${f.label}: ${ph}`); }
  }
  return lines;
}

// template, fields (profile.fields), clientName, requirement {standard_code, edition, clause,
// clause_name, requirement_text, stable_key}, related [{standard_code, edition, clause, clause_name,
// requirement_text, kindLabel, reason}], boardRequirements (the board's rows, to resolve the
// template's mapping), guidance {clause, requirement} (approved only, or null), answers {qid: text},
// options {mode, includeSensitive: {key: bool}, docControl: {documentNumber, ownerRole,
// approverRole}, brandingNotes}, preparedOn 'YYYY-MM-DD'.
function buildPrompt(input) {
  const { template, clientName, requirement } = input;
  const fields = input.fields || {};
  const answers = (input.options && input.options.mode === 'guided' && input.answers) || {};
  const opts = input.options || {};
  const required = template.requiredProfileFields || [];
  // A sensitive field the template needs starts switched ON (the dialog shows it), any other
  // sensitive field starts OFF; the user's own switches always win.
  const include = {};
  for (const f of PROFILE_FIELDS) if (f.sensitive) include[f.key] = opts.includeSensitive && f.key in opts.includeSensitive ? !!opts.includeSensitive[f.key] : required.includes(f.key);
  const placeholders = [];
  const L = [];
  const draftTemplate = template.reviewStatus !== 'approved';

  L.push(`DOCUMENT GENERATOR PROMPT — ${template.title}`);
  L.push(`Prepared on ${input.preparedOn} with Etcher Task Hub. Template "${template.templateId}" version ${template.version}.`);
  if (draftTemplate) L.push('DRAFT TEMPLATE — this template\'s content has not yet been approved by Etcher. For review use only.');
  L.push('This prompt is not evidence, and neither is any document drafted from it until the organisation has reviewed and approved it.');
  L.push('');

  L.push('1. ROLE AND DRAFTING TASK');
  L.push(`You are drafting a "${template.title}" for the organisation described below. Draft an editable document that the organisation will review, complete and approve before use. Work only from the information in this prompt.`);
  L.push('');

  L.push('2. DOCUMENT TITLE AND PURPOSE');
  L.push(`Title: ${template.title}`);
  L.push(`Purpose: ${template.purpose}`);
  L.push('');

  L.push('3. COMPANY NAME AND CONFIRMED COMPANY INFORMATION');
  L.push('Only the lines marked "(confirmed)" are facts. Everything else is a placeholder to keep as it is.');
  const companyKeys = [...IDENTITY_FIELDS, ...required.filter(k => !IDENTITY_FIELDS.includes(k) && !BRAND_FIELDS.includes(k) && !CONVENTION_FIELDS.includes(k))];
  L.push(...factLines(companyKeys, fields, include, placeholders));
  L.push('Name legislation, regulators, codes of practice or standards only where they appear above as confirmed obligations or in the answers below; do not assume which apply in this jurisdiction.');
  L.push('');

  L.push('4. STANDARDS, EDITIONS, CLAUSES AND REQUIREMENT WORDING SUPPLIED BY THE APP');
  L.push(`Selected requirement: ${stdLabel(requirement)} clause ${requirement.clause}${requirement.clause_name ? ' — ' + requirement.clause_name : ''}`);
  L.push('Requirement wording (Etcher\'s own paraphrase, not the standard\'s text — the organisation should check its licensed copy of the standard):');
  L.push(`"${requirement.requirement_text}"`);
  L.push('');

  L.push('5. PLAIN-LANGUAGE INTENDED OUTCOMES');
  L.push(`- ${template.purpose}`);
  const g = input.guidance || {};
  for (const x of [g.clause, g.requirement].filter(Boolean)) if (x.explanation) L.push(`- ${x.explanation}`);
  L.push('');

  L.push('6. DOCUMENT-SPECIFIC QUESTIONNAIRE ANSWERS');
  for (const q of template.questions || []) {
    const a = answers[q.id];
    // 8c.6: a source-backed checklist. Only ticked items appear, each with its source, in the template's
    // own order — an unticked item is never mentioned (the A62 jurisdiction rule); unknown ids are ignored.
    if (q.kind === 'checklist') {
      const lines = checklistLines(q, a, template);
      if (lines.length) { L.push(`- ${q.text}\n  Confirmed by the user (ticked from a source-backed checklist; anything not ticked is deliberately left out):`); for (const x of lines) L.push(`  • ${x}`); }
      else { const ph = placeholderFor(q.text); placeholders.push(ph); L.push(`- ${q.text}\n  Answer: ${ph}`); }
      continue;
    }
    if (a != null && String(a).trim()) L.push(`- ${q.text}\n  Answer (confirmed by the user): ${String(a).trim()}`);
    else { const ph = placeholderFor(q.text); placeholders.push(ph); L.push(`- ${q.text}\n  Answer: ${ph}`); }
  }
  L.push('');

  L.push('7. REQUIRED DOCUMENT SECTIONS');
  (template.requiredSections || []).forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('');

  L.push('8. OPTIONAL SECTIONS (include only where relevant to the organisation)');
  (template.optionalSections || []).forEach(s => L.push(`- ${s}`));
  if (!(template.optionalSections || []).length) L.push('- None.');
  L.push('');

  L.push('9. EXPECTED SUPPORTING RECORDS');
  (template.expectedRecords || []).forEach(s => L.push(`- ${s}`));
  L.push('');

  L.push('10. DOCUMENT-CONTROL REQUIREMENTS');
  L.push('Start the document with a document-control block containing:');
  const dc = opts.docControl || {};
  const dcValue = (label, v) => { if (v && String(v).trim()) return `${label}: ${String(v).trim()}`; const ph = placeholderFor(label); placeholders.push(ph); return `${label}: ${ph}`; };
  for (const f of template.docControlFields || []) {
    if (/^Document number/i.test(f)) L.push('- ' + dcValue(f, dc.documentNumber));
    else if (/^Document owner/i.test(f)) L.push('- ' + dcValue(f, dc.ownerRole));
    else if (/^Approved by/i.test(f)) L.push('- ' + dcValue(f, dc.approverRole));
    else if (/^Revision$/i.test(f)) L.push('- Revision: 0 (draft)');
    else if (/^Effective date/i.test(f)) L.push(`- ${f}: leave blank until approved`);
    else L.push(`- ${f}`);
  }
  L.push('- Status: DRAFT — for organisational review and approval');
  L.push(...factLines(CONVENTION_FIELDS, fields, include, placeholders));
  L.push('');

  L.push('11. BRANDING INSTRUCTIONS');
  L.push(template.brandingInstructions || '');
  L.push(...factLines(BRAND_FIELDS, fields, include, placeholders));
  if (opts.brandingNotes && String(opts.brandingNotes).trim()) L.push(`- Further branding notes from the user: ${String(opts.brandingNotes).trim()}`);
  L.push('');

  L.push('12. STRICT MISSING-INFORMATION RULES');
  L.push(SAFEGUARDS_HEADING);
  MANDATORY_SAFEGUARDS.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('Keep every [INFORMATION REQUIRED: …] placeholder exactly as written in this prompt.');
  for (const r of template.draftingRules || []) L.push(`- ${r}`);
  L.push('');

  L.push('13. OUTPUT-FORMAT INSTRUCTIONS');
  L.push('- Produce one editable document in Markdown: a heading for each required section, tables as Markdown tables.');
  L.push('- Begin with the document-control block; mark the document DRAFT.');
  L.push('- Write in plain Australian English, in the organisation\'s own terms where given.');
  L.push('- End with a section headed "Unresolved placeholders" listing every [INFORMATION REQUIRED: …] still in the draft.');
  L.push('');

  L.push('14. POTENTIAL REQUIREMENTS COVERAGE MATRIX');
  L.push('Potential coverage only — to be confirmed by the organisation. Listing a requirement here does not mean the document meets it.');
  L.push('| Standard | Clause | Requirement (Etcher wording) | Why listed |');
  L.push('|---|---|---|---|');
  const rows = [], seen = new Set();
  const addRow = (r, why) => { const k = stdLabel(r) + '|' + r.clause + '|' + r.requirement_text; if (seen.has(k)) return; seen.add(k); rows.push({ r, why }); };
  addRow(requirement, 'The requirement this prompt was prepared from');
  for (const r of (input.related || []).slice().sort((a, b) => (stdLabel(a) + a.clause).localeCompare(stdLabel(b) + b.clause))) addRow(r, `Confirmed related requirement (${r.kindLabel || 'related'})${r.reason ? ': ' + r.reason : ''}`);
  const mappedKeys = new Set((template.supportsRequirements || []).map(m => m.stableKey));
  for (const r of (input.boardRequirements || []).filter(x => mappedKeys.has(x.stable_key)).sort((a, b) => (stdLabel(a) + a.clause).localeCompare(stdLabel(b) + b.clause, undefined, { numeric: true }))) addRow(r, 'The workbook names this document type as example evidence');
  for (const { r, why } of rows) L.push(`| ${stdLabel(r)} | ${r.clause} | ${String(r.requirement_text).replace(/\|/g, '/')} | ${why.replace(/\|/g, '/')} |`);
  L.push('');

  L.push('15. FINAL REVIEWER CHECKLIST (for the organisation, before approval)');
  for (const c of template.reviewerChecklist || []) L.push(`- [ ] ${c}`);
  L.push('- [ ] Every [INFORMATION REQUIRED: …] placeholder has been resolved or deliberately left for later');
  L.push('- [ ] Approved by the stated approval role before the DRAFT marking is removed');
  L.push('- [ ] Once approved, the finished document is added to the ISO board through the normal evidence workflow');
  L.push('');

  const unique = [...new Set(placeholders)];
  L.push('PLACEHOLDERS IN THIS PROMPT (keep each one until the organisation resolves it)');
  if (unique.length) unique.forEach(p => L.push(`- ${p}`)); else L.push('- None.');

  const completeness = required.map(k => ({ key: k, label: FIELD_BY_KEY[k] ? FIELD_BY_KEY[k].label : k, status: FIELD_BY_KEY[k] && FIELD_BY_KEY[k].sensitive && include[k] === false ? 'withheld' : fieldCompleteness(k, fields[k]) }));
  return {
    text: L.join('\n') + '\n',
    filename: buildFilename(clientName, template),
    completeness,
    missing: completeness.filter(c => c.status !== 'complete').map(c => c.label),
    placeholders: unique,
    sensitiveIncluded: Object.keys(include).filter(k => include[k]),
  };
}

module.exports = { buildPrompt, buildFilename, safeFilenamePart, MANDATORY_SAFEGUARDS, SAFEGUARDS_HEADING };
