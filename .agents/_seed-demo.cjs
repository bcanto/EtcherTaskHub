// Seeds a realistic, part-finished ISO demo board so the system can be seen in use (2026-10-14).
// Daltech, ISO 9001 + 14001 + 45001, Sam Wignall as Lead Auditor and Bruna Canto as auditor:
//   - clauses 4–7 assessed by Bruna, approved by Sam, actions tracked, an interim report issued
//     (version 1) and acknowledged — so the branded report PDF has real content;
//   - clause 8 in progress: some approved, some awaiting Sam, some returned with notes, one resubmitted;
//   - documents linked (a few marked partly sufficient / insufficient), documents requested from the
//     client (one submitted), comments between Sam and Bruna, actions moving through their states.
// Everything goes through /api/iso as the real users, so approvals, returns, notifications and the
// activity history are written by the app's own rules — nothing is poked into the store directly.
//
//   node .agents/_seed-demo.cjs [port]      default 3001 — the user's own offline server
// Refuses anything that is not an offline server (hard rule 1). On the user's own store it copies
// .iso-offline/store.json to .iso-offline/backups/ first, and it refuses to make a second demo board.
const fs = require('fs');
const path = require('path');
const Checks = require('../iso/iso-checks.js');
const SEEDS = ['9001-2026', '14001-2026', '45001-2018-a1'].map(f => require(`../iso/seed/library/${f}.json`));

const PORT = Number(process.argv[2] || 3001);
const BASE = `http://127.0.0.1:${PORT}`;
const TITLE = 'Demo — gap analysis (sample data)';
const CLIENT = 'c2'; // Daltech in the offline fixtures
const SAM = { id: 'u2', role: 'staff', name: 'Sam Wignall' };
const BRUNA = { id: 'u1', role: 'staff', name: 'Bruna Canto' }; // acting as an auditor, so her work goes to Sam
const ADMIN = { id: 'u1', role: 'admin', name: 'Bruna Canto' };

async function call(user, body) {
  const r = await fetch(`${BASE}/api/iso`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, data: j && j.data, error: j && j.error };
}
async function must(user, body) {
  const r = await call(user, body);
  if (r.status !== 200) throw new Error(`${body.op} → ${r.status} ${JSON.stringify(r.error)}`);
  return r.data;
}
const soft = async (label, fn) => { try { return await fn(); } catch (e) { console.log(`  (skipped ${label}: ${e.message.slice(0, 140)})`); return null; } };

// Deterministic "random" so a re-run on a fresh store gives the same board.
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const pick = (arr, key) => arr[Math.floor(hash(key) * arr.length) % arr.length];
const confirmFor = r => { const sd = SEEDS.find(x => x.standardCode === r.standard_code); const it = sd && sd.items.find(i => i.source.matchKey === r.stable_key); return (it && it.imported.cheatSheet && it.imported.cheatSheet.confirm) || []; };
const fam = r => String(r.clause).split('.')[0];
const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

(async () => {
  const cfg = await (await fetch(`${BASE}/api/config`)).json();
  if (cfg.supabaseUrl) throw new Error('This server is not offline — refusing to seed (hard rule 1).');

  const audits = await must(ADMIN, { op: 'audit.list' }).catch(() => []);
  if ((audits || []).some(x => x.title === TITLE && !x.archived_at)) { console.log(`A board called "${TITLE}" already exists — nothing done. Archive it first to re-seed.`); return; }
  if (PORT === 3001) {
    const store = path.join(__dirname, '..', '.iso-offline', 'store.json');
    if (fs.existsSync(store)) {
      const dir = path.join(__dirname, '..', '.iso-offline', 'backups'); fs.mkdirSync(dir, { recursive: true });
      const to = path.join(dir, `store-before-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.copyFileSync(store, to); console.log('Backed up the store to', path.relative(path.join(__dirname, '..'), to));
    }
  }

  // ── Board, team, setup ────────────────────────────────────────────────────────────────────────
  let audit = (await call(SAM, { op: 'audit.create', clientId: CLIENT, standards: ['9001', '14001', '45001'], title: TITLE })).data;
  if (!audit) { await must(ADMIN, { op: 'library.loadSeed' }); audit = await must(SAM, { op: 'audit.create', clientId: CLIENT, standards: ['9001', '14001', '45001'], title: TITLE }); }
  const A = audit.id;
  console.log('Board', audit.ref, A);
  await must(SAM, { op: 'member.add', auditId: A, uid: 'offline:u1', auditRole: 'auditor' });
  await must(SAM, { op: 'member.update', auditId: A, uid: 'offline:u2', auditRole: 'lead_auditor' });
  const cur = async () => (await must(SAM, { op: 'audit.get', auditId: A }));
  await must(SAM, { op: 'audit.update', auditId: A, expectedVersion: (await cur()).row_version, patch: {
    planned_start: '2026-09-21', planned_end: '2026-10-30', report_due: '2026-11-06', stage: 'fieldwork', lead_auditor_uid: 'offline:u2',
    setup: {
      objective: 'Establish how far the integrated management system meets ISO 9001, ISO 14001 and ISO 45001, and agree a prioritised plan to close the gaps before the certification audit.',
      scope: 'Head office and workshop operations, including project delivery, procurement, maintenance and site services.',
      criteria: 'The organisation\'s own policies, procedures and legal obligations.',
      limitations: 'Site services were sampled on two jobs only. Clauses 8 to 10 are still being assessed and will follow in the next report.',
      opening: { date: '2026-09-21', attendees: 'Sam Wignall, Bruna Canto (Etcher); General Manager, Operations Manager, HSEQ Coordinator (client)', notes: 'Scope, timetable and document access agreed. Client to share the SharePoint document library.' },
    },
  } });

  // ── Documents: link the most useful ones, leave the rest to request ─────────────────────────
  const docs = await must(SAM, { op: 'document.list', auditId: A });
  const ranked = docs.slice().sort((p, q) => q.clauses.length - p.clauses.length);
  const linked = ranked.slice(0, 16), requested = ranked.slice(16, 21);
  const docsByReq = new Map();
  const revs = ['Rev 2', 'Rev 3', 'Rev 4', 'Issue 5', 'Rev 1'];
  let dayN = 2;
  for (const d of linked) {
    const ids = d.clauses.map(c => c.requirementId).slice(0, 50);
    const rev = pick(revs, d.name), date = `2026-0${dayN < 10 ? 8 : 9}-${String((dayN % 27) + 1).padStart(2, '0')}`; dayN += 3;
    await must(BRUNA, { op: 'evidence.addLinkBulk', auditId: A, title: d.name, url: 'https://example.com/daltech/' + encodeURIComponent(d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')), versionLabel: rev, evidenceDate: date, requirementIds: ids });
    for (const id of ids) { if (!docsByReq.has(id)) docsByReq.set(id, []); docsByReq.get(id).push({ name: d.name, rev, date }); }
  }
  console.log(`Linked ${linked.length} documents`);

  // ── Assessments ───────────────────────────────────────────────────────────────────────────────
  let reqs = await must(SAM, { op: 'requirement.list', auditId: A });
  const byKey = new Map(reqs.map(r => [r.standard_code + ' ' + r.clause, r]));
  const NA = new Set(['9001 8.3', '9001 8.3.1', '9001 8.3.2', '9001 8.3.3', '9001 8.3.4', '9001 8.3.5', '9001 8.3.6', '9001 7.1.5.2']);
  const batch1 = reqs.filter(r => ['4', '5', '6', '7'].includes(fam(r)));
  const fam8 = reqs.filter(r => fam(r) === '8');
  const batch2 = fam8.slice(0, Math.ceil(fam8.length * 0.6));
  const people = ['the Operations Manager', 'the HSEQ Coordinator', 'the General Manager', 'the Workshop Supervisor', 'the Procurement Officer', 'two workshop technicians'];
  const shortfall = {
    partially_compliant: ['but the last documented review was in 2024 and does not reflect the new workshop layout', 'but records are kept for employees only — subcontractors are not covered', 'but it is not yet communicated to site crews; only office staff had seen it', 'but the method exists only in one person\'s spreadsheet and is not controlled', 'but follow-up of overdue items is informal and not recorded'],
    non_compliant: ['No documented process was found, and the people interviewed described it differently.', 'The last record seen was from 2023; nothing shows it has been done since.', 'Nothing was available to show this is planned, done or checked.'],
  };
  const actionText = {
    partially_compliant: ['Review and reissue the document, then brief the people affected', 'Extend the records to cover subcontractors and check them at induction', 'Communicate it at toolbox meetings and keep the attendance record', 'Move the method into the controlled document system', 'Add an owner and due date to every item and review overdue items monthly'],
    non_compliant: ['Write and approve the procedure, then train the people who use it', 'Plan the activity for the year and record each time it is done', 'Bring the records up to date and set a review date', 'Assign an owner and add it to the monthly management meeting agenda'],
  };
  const statusFor = r => {
    const k = r.standard_code + ' ' + r.clause;
    if (NA.has(k)) return 'not_applicable';
    const x = hash(k + 'status');
    return x < 0.64 ? 'compliant' : x < 0.86 ? 'partially_compliant' : 'non_compliant';
  };
  const patchFor = (r, status) => {
    const k = r.standard_code + ' ' + r.clause;
    if (status === 'not_applicable') return { compliance_status: status, na_justification: 'Daltech does not design products — it fabricates and maintains to the client\'s design. Recorded as a scope exclusion.' };
    const items = confirmFor(r);
    let text = '';
    items.slice(0, hash(k + 'n') < 0.5 ? 1 : 2).forEach(it => { text = Checks.toggle(text, items, it, true); });
    const ds = docsByReq.get(r.id) || [];
    const seen = ds.length ? `Seen: ${ds.slice(0, 2).map(d => `${d.name} (${d.rev}, ${fmt(d.date)})`).join('; ')}; discussed with ${pick(people, k)}.` : `Discussed with ${pick(people, k)} and walked through the process.`;
    const p = { compliance_status: status };
    if (status === 'compliant') {
      p.current_system = text + seen;
      if (hash(k + 'ofi') < 0.12) { p.ofi = true; p.recommended_action = 'Consider adding a simple trend chart to the monthly management report'; p.target_date = '2026-12-15'; p.responsible_uid = 'u2'; }
    } else {
      const why = pick(shortfall[status], k);
      p.current_system = status === 'partially_compliant' ? `${text}${seen.replace(/\.$/, '')} — ${why}.` : `${seen} ${why}`;
      p.gap_reason = status === 'non_compliant' ? pick(['not_implemented', 'no_evidence'], k + 'g') : pick(['ineffective', 'no_evidence'], k + 'g');
      p.recommended_action = pick(actionText[status], k + 'a');
      p.responsible_uid = hash(k + 'o') < 0.5 ? 'u1' : 'u2';
      p.target_date = status === 'non_compliant' ? '2026-11-20' : pick(['2026-12-05', '2026-12-12', '2027-01-30'], k + 'd');
    }
    return p;
  };
  const setReq = async (user, r, patch) => {
    const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === r.id);
    return must(user, { op: 'requirement.update', auditId: A, id: r.id, expectedVersion: row.row_version, patch });
  };
  const approve = async r => { const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === r.id); return must(SAM, { op: 'requirement.approve', auditId: A, id: r.id, expectedVersion: row.row_version }); };
  const giveBack = async (r, note) => { const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === r.id); return must(SAM, { op: 'requirement.return', auditId: A, id: r.id, expectedVersion: row.row_version, note }); };

  for (const r of batch1) await setReq(BRUNA, r, patchFor(r, statusFor(r)));
  console.log(`Bruna assessed ${batch1.length} clauses (clauses 4–7)`);

  // A few documents judged not quite enough.
  const suff = [['partial', 0], ['partial', 5], ['insufficient', 9]];
  for (const [verdict, i] of suff) {
    const r = batch1[i * 3 % batch1.length];
    const ev = (await must(SAM, { op: 'evidence.list', auditId: A, targetType: 'requirement', targetId: r.id }))[0];
    if (ev) await soft('sufficiency', () => must(BRUNA, { op: 'evidence.setSufficiency', auditId: A, linkId: ev.linkId, sufficiency: verdict, expectedVersion: ev.linkRowVersion }));
  }

  // Sam reviews clauses 4–7: two go back first, Bruna fixes them, then everything is approved.
  const b1gaps = batch1.filter(r => ['partially_compliant', 'non_compliant'].includes(statusFor(r)));
  const firstReturns = [b1gaps[0], b1gaps[3]].filter(Boolean);
  await giveBack(firstReturns[0], 'The basis says the register exists, but not when it was last reviewed. Add the review date you saw, please.');
  if (firstReturns[1]) await giveBack(firstReturns[1], 'Is this really partial? The training matrix looked complete for the workshop. Check the subcontractor records and confirm.');
  await must(BRUNA, { op: 'comment.add', auditId: A, entityType: 'requirement', entityId: firstReturns[0].id, body: 'Last review was 14 March 2024 — added to the basis. Nothing since the workshop move, so I\'ve kept it as partial.' });
  for (const r of firstReturns) { const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === r.id); await setReq(BRUNA, r, { current_system: row.current_system + ' Last documented review: 14 Mar 2024.' }); }
  for (const r of batch1) { const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === r.id); if (row.approval_state !== 'approved') await approve(r); }
  console.log('Sam approved clauses 4–7 (two after a return)');

  // Actions: one per gap, shared across standards when the same clause falls short in more than one.
  const groups = new Map();
  for (const r of b1gaps) { if (!groups.has(r.clause)) groups.set(r.clause, []); groups.get(r.clause).push(r); }
  const actions = [];
  for (const [clause, rs] of groups) {
    const a = await soft('track ' + clause, () => must(SAM, { op: 'action.trackPlan', auditId: A, requirementIds: rs.map(r => r.id), priority: rs.some(r => statusFor(r) === 'non_compliant') ? 'high' : 'med' }));
    if (a) actions.push(a.action || a);
  }
  console.log(`Tracked ${actions.length} actions (${[...groups.values()].filter(x => x.length > 1).length} shared across standards)`);
  const moveAction = async (a, to) => { const all = await must(SAM, { op: 'action.list', auditId: A }); const row = all.find(x => x.id === a.id); if (row) await soft('action ' + to, () => must(BRUNA, { op: 'action.updateStatus', auditId: A, id: row.id, to, expectedVersion: row.row_version })); };
  for (const [i, a] of actions.entries()) { if (!a || !a.id) continue; if (i % 3 === 0) await moveAction(a, 'assigned'); if (i % 3 === 1) { await moveAction(a, 'assigned'); await moveAction(a, 'in_progress'); } }

  // Interim report on clauses 4–7, issued by Sam and acknowledged by the client.
  await must(SAM, { op: 'report.saveDraft', auditId: A, title: 'Audit report (sample)', sections: {
    executiveSummary: 'Etcher Solutions is carrying out a gap analysis of Daltech\'s integrated management system against ISO 9001, ISO 14001 and ISO 45001. This interim report covers clauses 4 to 7 — context, leadership, planning and support — which were assessed first.\n\nMost of the system is in place and working. Leadership is visibly involved, the policies are current and the document library is well organised. The main gaps are the legal and other requirements register, competence records for subcontractors, and getting the environmental and safety messages to site crews as well as office staff. Each gap has an agreed action, owner and due date. Clauses 8 to 10 will follow in the next report.',
    method: 'Document review on the client\'s SharePoint library, interviews with the General Manager, Operations Manager, HSEQ Coordinator and workshop staff, and observation in the workshop. Records were sampled where a process produces them.',
    objectivesAchieved: 'Yes for clauses 4 to 7. Clauses 8 to 10 are still being assessed, as agreed at the opening meeting.',
    goodPractice: 'The monthly management meeting pack brings quality, environment and safety into one agenda with clear owners — a strong base for the management review. Toolbox talks in the workshop are well attended and recorded.',
    conclusion: 'Daltech is well placed to reach certification readiness once the agreed actions are closed. We recommend closing the non-conformity actions first, then the communication actions, ahead of the planned certification audit.',
  } });
  const ver = await must(SAM, { op: 'report.issue', auditId: A });
  await must(SAM, { op: 'report.acknowledge', auditId: A, versionId: ver.id, name: 'Alex Morgan', role: 'Operations Manager, Daltech', date: '2026-10-09' });
  console.log('Issued and acknowledged report version', ver.version_no);

  // ── Clause 8, in progress ─────────────────────────────────────────────────────────────────────
  for (const r of batch2) await setReq(BRUNA, r, patchFor(r, statusFor(r)));
  const b2 = batch2.filter(r => statusFor(r) !== 'not_applicable');
  const returned = [b2[1], b2[4], b2[7]].filter(Boolean);
  const notes = ['Which jobs did you sample? Name the two job packs in the basis so the client can find them.', 'This reads as non-compliant to me — there is no evidence the supplier evaluation happened this year. Have another look.', 'Add what you saw on site, not just the procedure — the procedure alone isn\'t enough here.'];
  for (const [i, r] of returned.entries()) await giveBack(r, notes[i]);
  const approved2 = b2.filter(r => !returned.includes(r)).slice(0, Math.floor(b2.length * 0.45));
  for (const r of approved2) await approve(r);
  // Bruna answers one return and resubmits it; the rest of clause 8 waits for Sam.
  const fix = returned[0];
  if (fix) {
    await must(BRUNA, { op: 'comment.add', auditId: A, entityType: 'requirement', entityId: fix.id, body: 'Sampled job packs DT-2291 (pressure vessel repair) and DT-2304 (conveyor guarding). Added both to the basis.' });
    const row = (await must(SAM, { op: 'requirement.list', auditId: A })).find(x => x.id === fix.id);
    await setReq(BRUNA, fix, { current_system: row.current_system + ' Job packs sampled: DT-2291 and DT-2304.' });
  }
  console.log(`Clause 8: ${batch2.length} assessed — ${approved2.length} approved, ${returned.length} returned (1 resubmitted), the rest awaiting Sam`);

  // Conversation on the board.
  const talk = [
    [SAM, b2[2], 'Good basis. Did the client confirm the calibration supplier is still the same one?'],
    [BRUNA, b2[2], 'Yes — same supplier, certificate dated 3 Sep 2026. I\'ll link it once they upload it.'],
    [SAM, batch1[2], 'Worth checking the climate change question with the GM at the closing meeting — the register mentions it but nothing flows into objectives.'],
    [BRUNA, batch1[2], 'Noted. Added to the closing meeting agenda.'],
    [SAM, b1gaps[1], 'Let\'s make this one a priority — it affects 14001 and 45001 too.'],
  ];
  for (const [u, r, body] of talk) if (r) await must(u, { op: 'comment.add', auditId: A, entityType: 'requirement', entityId: r.id, body });

  // Documents requested from the client.
  const items = requested.map((d, i) => ({ documentName: d.name, requirementIds: d.clauses.map(c => c.requirementId).slice(0, 20), dueDate: ['2026-10-20', '2026-10-22', '2026-10-24', '2026-10-27', '2026-10-31'][i] }));
  if (items.length) {
    const made = await must(BRUNA, { op: 'evidenceRequest.create', auditId: A, items });
    const first = made.rows && made.rows[0];
    if (first) await soft('request submitted', () => must(BRUNA, { op: 'evidenceRequest.update', auditId: A, id: first.id, status: 'submitted', expectedVersion: first.row_version }));
    console.log(`Requested ${items.length} documents from the client (${made.created} clause requests)`);
  }

  reqs = await must(SAM, { op: 'requirement.list', auditId: A });
  const assessedN = reqs.filter(r => r.compliance_status && r.compliance_status !== 'not_assessed').length;
  const by = st => reqs.filter(r => r.approval_state === st).length;
  console.log(`Done: ${assessedN} of ${reqs.length} clauses assessed (${Math.round(assessedN / reqs.length * 100)}%) · approved ${by('approved')} · awaiting Sam ${by('proposed')} · returned ${by('returned')}`);
  console.log(`Open the board: ${audit.ref} — "${TITLE}" under Daltech.`);
})().catch(e => { console.error('Seeding stopped:', e.message); process.exit(1); });
