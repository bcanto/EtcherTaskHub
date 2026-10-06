// Relationship suggestions (plan 6.5). Pure functions — no ctx.db calls, no I/O — so
// relationship.suggest's op just fetches the inputs and hands them here. Leading underscore =
// shared module, not a Vercel route.
//
// Three suggestion rules, each producing candidate {fromId, toId, kind, reasonCode, reasonText}
// pairs (fromId < toId lexically, so a pair is always represented once):
//   (a) same clause + normalised text across standards -> kind 'same_requirement'. Ports the
//       prototype's crossStandardRefs() heuristic (workboard/ISO Audit/lib/model.mjs, read-only
//       reference) verbatim, including its QMS/EMS/OHSMS and quality/environmental/OH&S synonym
//       folding — clause numbering is shared across ISO 9001/14001/45001 (Annex SL), but each
//       standard's own wording differs just enough (system name, topic name) that a literal string
//       match would miss nearly every real pair.
//   (b) the integrated-topic map (iso/seed/topic-map.json) -> kind 'integrated_topic'.
//   (c) two requirements sharing a confirmed/suggested action link (iso_action_links) -> kind
//       'mapping'.
// A pair already covered by an earlier rule, or already the subject of any relationship row
// (suggested, confirmed or rejected), is never suggested again by a later rule or a later run —
// "rejected suggestions are never re-suggested" (plan §6.2, applies here too).

function normaliseText(v) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
}

// Ported from workboard/ISO Audit/lib/model.mjs's crossStandardRefs() normaliser.
function crossStandardNorm(s) {
  return normaliseText(s).toLowerCase().replace(/\s+/g, ' ')
    .replace(/\b(qms|ems|ohsms)\b/g, 'system')
    .replace(/\b(quality|environmental|oh&s|ohs)\b/g, 'topic');
}

function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

function ruleSameRequirement(requirements) {
  const byClauseNorm = new Map(); // "clause||normtext" -> [requirement, ...]
  for (const r of requirements) {
    const key = r.clause + '||' + crossStandardNorm(r.requirement_text);
    if (!byClauseNorm.has(key)) byClauseNorm.set(key, []);
    byClauseNorm.get(key).push(r);
  }
  const out = [];
  for (const group of byClauseNorm.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].standard_code === group[j].standard_code) continue; // same-standard duplicates aren't cross-standard refs
        out.push({ fromId: group[i].id, toId: group[j].id, kind: 'same_requirement', reasonCode: 'same_clause_text', reasonText: `Same clause ${group[i].clause}, equivalent wording across ISO ${group[i].standard_code} and ${group[j].standard_code}.` });
      }
    }
  }
  return out;
}

function topicForClause(topicMap, standardCode, clause) {
  for (const topic of Object.keys(topicMap)) {
    const spec = topicMap[topic];
    const clauses = Array.isArray(spec) ? spec : (spec[standardCode] || []);
    if (clauses.includes(clause)) return topic;
  }
  return null;
}

function ruleIntegratedTopic(requirements, topicMap) {
  const byTopic = new Map();
  for (const r of requirements) {
    const topic = topicForClause(topicMap, r.standard_code, r.clause);
    if (!topic) continue;
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(r);
  }
  const out = [];
  for (const [topic, group] of byTopic) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].standard_code === group[j].standard_code) continue;
        out.push({ fromId: group[i].id, toId: group[j].id, kind: 'integrated_topic', reasonCode: 'topic_map', reasonText: `Both cover "${topic}" (${group[i].clause} / ${group[j].clause}).` });
      }
    }
  }
  return out;
}

// actionLinks: rows from iso_action_links where target_type='requirement', link_state in
// ('suggested','confirmed') — a rejected link is not evidence of a real connection.
function ruleSharedAction(requirements, actionLinks) {
  const reqIds = new Set(requirements.map(r => r.id));
  const byAction = new Map();
  for (const l of actionLinks) {
    if (!reqIds.has(l.target_id)) continue;
    if (!byAction.has(l.action_id)) byAction.set(l.action_id, []);
    byAction.get(l.action_id).push(l.target_id);
  }
  const byId = new Map(requirements.map(r => [r.id, r]));
  const out = [];
  for (const ids of byAction.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = byId.get(ids[i]), b = byId.get(ids[j]);
        if (!a || !b) continue;
        out.push({ fromId: a.id, toId: b.id, kind: 'mapping', reasonCode: 'shared_action', reasonText: 'Both are linked to the same action.' });
      }
    }
  }
  return out;
}

// existingPairKeys: Set of pairKey(from_id,to_id) for every iso_relationships row that already
// exists for this audit, any state. Returns only genuinely new candidates, each pair at most once
// (rule (a) wins over (b) over (c) when more than one rule would suggest the same pair).
function suggestRelationships({ requirements, topicMap, actionLinks, existingPairKeys }) {
  const seen = new Set(existingPairKeys || []);
  const candidates = [
    ...ruleSameRequirement(requirements),
    ...ruleIntegratedTopic(requirements, topicMap || {}),
    ...ruleSharedAction(requirements, actionLinks || []),
  ];
  const out = [];
  for (const c of candidates) {
    const key = pairKey(c.fromId, c.toId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

module.exports = { suggestRelationships, crossStandardNorm, topicForClause, pairKey };
