// The one filter evaluator (plan §7) — used by api/_isoCalc.js and every `<entity>.list {filter}`
// op, so a saved view, a dashboard link and a metric always mean the same thing when they say
// "the same filter". Leading underscore = shared module, not a Vercel route.
//
// Filter schema: {entity, where:[{field, op, value}], group, sort}. Supported ops: eq, in, lt,
// lte, gt, isnull, notnull, contains (the row's field is an array holding `value` — an action's
// `standard_codes`), has_link. Date tokens $today / $today+N / $today-N resolve against
// `now` (an argument, not Date.now(), so tests can pin it) in iso_config.timezone (default
// Australia/Perth — Vercel runs in UTC).

// Which link/target table a has_link check reads, keyed by the linked entity name a filter names.
// Link-state column differs per table (evidence review status vs. a plain confirm/reject state).
const LINK_TABLES = {
  action: { table: 'iso_action_links', targetIdField: 'target_id', stateField: 'link_state', foreignField: 'action_id' },
  finding: { table: 'iso_finding_requirements', targetIdField: 'requirement_id', stateField: null, foreignField: 'finding_id' },
  evidence_link: { table: 'iso_evidence_links', targetIdField: 'target_id', stateField: 'review_status', foreignField: 'evidence_id' },
  evidence_request: { table: 'iso_evidence_requests', targetIdField: 'target_id', stateField: 'status', foreignField: 'id' },
  client_response: { table: 'iso_client_responses', targetIdField: 'finding_id', stateField: 'status', foreignField: 'id' },
};

function resolveDateToken(token, now, timezone) {
  if (typeof token !== 'string' || !token.startsWith('$today')) return token;
  const m = /^\$today([+-]\d+)?$/.exec(token);
  if (!m) return token;
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Australia/Perth' }).format(now);
  if (!m[1]) return todayStr;
  const d = new Date(todayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + parseInt(m[1], 10));
  return d.toISOString().slice(0, 10);
}
function _resolveValue(value, now, timezone) {
  if (Array.isArray(value)) return value.map(v => _resolveValue(v, now, timezone));
  return resolveDateToken(value, now, timezone);
}

// db: an _isoDb adapter instance (offline or Supabase); now: a Date; timezone: iso_config.timezone.
async function matchesHasLink(row, predicate, ctx) {
  const spec = predicate.value || {};
  const linkDef = LINK_TABLES[spec.entity];
  if (!linkDef) throw new Error('has_link: unknown linked entity ' + spec.entity);
  const linkState = spec.linkState || 'confirmed';
  const linkRows = await ctx.db.list(linkDef.table, { where: [{ field: linkDef.targetIdField, op: 'eq', value: row.id }] });
  const matchingLinks = linkDef.stateField ? linkRows.filter(l => l[linkDef.stateField] === linkState) : linkRows;
  if (!matchingLinks.length) return false;
  if (!spec.where || !spec.where.length) return true;
  // Nested predicates run against the linked row itself (e.g. an action's own status).
  for (const link of matchingLinks) {
    const linked = await ctx.db.get(spec.entity === 'evidence_link' ? 'iso_evidence' : spec.entity === 'action' ? 'iso_actions' : spec.entity, link[linkDef.foreignField] || link.id);
    if (linked && await evaluateFilter([linked], { where: spec.where }, ctx).then(r => r.length)) return true;
  }
  return false;
}

async function matchesWhere(row, predicate, ctx) {
  if (predicate.op === 'has_link') return matchesHasLink(row, predicate, ctx);
  const val = row[predicate.field];
  const cmp = _resolveValue(predicate.value, ctx.now, ctx.timezone);
  switch (predicate.op) {
    case 'eq': return val === cmp;
    case 'in': return Array.isArray(cmp) && cmp.includes(val);
    case 'lt': return val != null && val < cmp;
    case 'lte': return val != null && val <= cmp;
    case 'gt': return val != null && val > cmp;
    case 'isnull': return val === null || val === undefined;
    case 'notnull': return val !== null && val !== undefined;
    case 'contains': return Array.isArray(val) && val.includes(cmp);
    default: throw new Error('unknown filter op ' + predicate.op);
  }
}

// rows: already scope-resolved (client/audit) — this never re-checks scope, only the filter.
async function evaluateFilter(rows, filter, ctx) {
  if (!filter || !filter.where || !filter.where.length) return rows;
  const out = [];
  for (const row of rows) {
    let ok = true;
    for (const w of filter.where) {
      if (!(await matchesWhere(row, w, ctx))) { ok = false; break; }
    }
    if (ok) out.push(row);
  }
  return out;
}

module.exports = { resolveDateToken, evaluateFilter, matchesWhere };
