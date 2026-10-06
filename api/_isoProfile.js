// Company profile — plan 8c.1 (R12, D23). One profile per client, shared by all of that client's ISO
// boards. Pure: the field list and the rules for turning an edit into stored values. Used by the
// profile.* ops (api/_iso.js) and by the prompt builder (api/_isoPrompt.js), so both read one list.
//
// Every single value and every list item carries its own confirmation. Only confirmed values are
// ever presented as fact in a generator prompt; anything else becomes [INFORMATION REQUIRED: …].
const crypto = require('crypto');

// `sensitive` marks client-internal information (issues, risks, hazards, obligations): the prompt
// dialog's data notice lists these and they leave the app only when the user keeps them switched on.
const PROFILE_FIELDS = [
  { key: 'legal_name', label: 'Legal company name', kind: 'text' },
  { key: 'trading_name', label: 'Trading name', kind: 'text' },
  { key: 'abn', label: 'ABN (optional)', kind: 'text' },
  { key: 'logo_ref', label: 'Logo reference (link)', kind: 'text' },
  { key: 'brand_primary', label: 'Primary brand colour', kind: 'color' },
  { key: 'brand_secondary', label: 'Secondary brand colour', kind: 'color' },
  { key: 'address', label: 'Address', kind: 'text' },
  { key: 'jurisdiction', label: 'State or territory', kind: 'text' },
  { key: 'operating_locations', label: 'Operating locations', kind: 'list' },
  { key: 'business_activities', label: 'Business activities', kind: 'list' },
  { key: 'products_services', label: 'Products and services', kind: 'list' },
  { key: 'main_processes', label: 'Main processes', kind: 'list' },
  { key: 'ims_scope', label: 'Management-system scope', kind: 'text' },
  { key: 'standards_in_scope', label: 'Standards and editions in scope', kind: 'list' },
  { key: 'org_roles', label: 'Organisational roles', kind: 'list' },
  { key: 'approval_roles', label: 'Approval roles', kind: 'list' },
  { key: 'numbering_convention', label: 'Document numbering convention', kind: 'text' },
  { key: 'revision_convention', label: 'Revision convention', kind: 'text' },
  { key: 'review_frequency', label: 'Default review frequency', kind: 'text' },
  { key: 'terminology', label: 'Preferred terminology', kind: 'text' },
  { key: 'interested_parties', label: 'Interested parties', kind: 'list', sensitive: true },
  { key: 'internal_issues', label: 'Internal issues', kind: 'list', sensitive: true },
  { key: 'external_issues', label: 'External issues', kind: 'list', sensitive: true },
  { key: 'quality_considerations', label: 'Quality considerations', kind: 'list', sensitive: true },
  { key: 'environmental_aspects', label: 'Environmental aspects', kind: 'list', sensitive: true },
  { key: 'whs_hazards', label: 'WHS hazards and risks', kind: 'list', sensitive: true },
  { key: 'legal_obligations', label: 'Applicable legal and other obligations', kind: 'list', sensitive: true },
];
const FIELD_BY_KEY = Object.fromEntries(PROFILE_FIELDS.map(f => [f.key, f]));
const MAX_TEXT = 2000, MAX_ITEM = 1000, MAX_ITEMS = 200;
const ITEM_ID_RE = /^pi_[a-f0-9]{8,32}$/;

class ProfileError extends Error {}
const bad = msg => new ProfileError(msg);

// Confirmation stamps: kept when a confirmed value is saved again unchanged; re-stamped when a
// confirmed value changes (whoever saves the new wording is confirming it); cleared when unticked.
function stamp(confirmed, changed, prev, actorUid, nowIso) {
  if (!confirmed) return { confirmed: false, confirmed_by: null, confirmed_at: null };
  if (!changed && prev && prev.confirmed) return { confirmed: true, confirmed_by: prev.confirmed_by || null, confirmed_at: prev.confirmed_at || null };
  return { confirmed: true, confirmed_by: actorUid, confirmed_at: nowIso };
}

// input: text/color -> {value, confirmed}; list -> [{id?, text, confirmed}]. Returns the stored shape.
function normaliseProfileValue(key, input, prevStored, actorUid, nowIso) {
  const field = FIELD_BY_KEY[key];
  if (!field) throw bad(`Unknown profile field "${key}".`);
  if (field.kind === 'list') {
    if (!Array.isArray(input)) throw bad(`${field.label}: expected a list.`);
    if (input.length > MAX_ITEMS) throw bad(`${field.label}: at most ${MAX_ITEMS} items.`);
    const prevById = new Map((Array.isArray(prevStored) ? prevStored : []).map(i => [i.id, i]));
    const seen = new Set();
    const out = [];
    for (const it of input) {
      const text = String((it && it.text) || '').trim();
      if (!text) continue; // an emptied row is a removal, not an error
      if (text.length > MAX_ITEM) throw bad(`${field.label}: an item is too long.`);
      let id = it && typeof it.id === 'string' && ITEM_ID_RE.test(it.id) && !seen.has(it.id) ? it.id : null;
      if (!id) { do { id = 'pi_' + crypto.randomBytes(6).toString('hex'); } while (seen.has(id)); }
      seen.add(id);
      const prev = prevById.get(id);
      out.push({ id, text, ...stamp(!!(it && it.confirmed), !prev || prev.text !== text, prev, actorUid, nowIso) });
    }
    return out;
  }
  const raw = input && typeof input === 'object' ? input.value : input;
  const value = raw == null ? '' : String(raw).trim();
  if (value.length > MAX_TEXT) throw bad(`${field.label}: too long.`);
  if (field.kind === 'color' && value && !/^#[0-9a-f]{6}$/i.test(value)) throw bad(`${field.label}: use a #RRGGBB colour.`);
  const confirmed = !!(input && typeof input === 'object' && input.confirmed) && value !== '';
  const prev = prevStored && typeof prevStored === 'object' ? prevStored : null;
  return { value, ...stamp(confirmed, !prev || prev.value !== value, prev, actorUid, nowIso) };
}

// Applies a batch of edits to a stored `fields` object. Returns the new object and the keys whose
// stored value actually changed (so the activity log records real changes only).
function applyProfileChanges(storedFields, changes, actorUid, nowIso) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw bad('Nothing to save.');
  const next = { ...(storedFields || {}) };
  const changedKeys = [];
  for (const [key, input] of Object.entries(changes)) {
    const normalised = normaliseProfileValue(key, input, next[key], actorUid, nowIso);
    if (JSON.stringify(normalised) !== JSON.stringify(next[key] === undefined ? null : next[key])) {
      next[key] = normalised;
      changedKeys.push(key);
    }
  }
  return { fields: next, changedKeys };
}

// Completeness of one field for the prompt dialog: Complete (confirmed value / every item
// confirmed), Partial (something there, not all confirmed), Missing (nothing confirmed or nothing).
function fieldCompleteness(key, stored) {
  const field = FIELD_BY_KEY[key];
  if (!field) return 'missing';
  if (field.kind === 'list') {
    const items = Array.isArray(stored) ? stored : [];
    if (!items.length) return 'missing';
    const c = items.filter(i => i.confirmed).length;
    return c === items.length ? 'complete' : c ? 'partial' : 'missing';
  }
  if (!stored || !stored.value) return 'missing';
  return stored.confirmed ? 'complete' : 'partial';
}

module.exports = { PROFILE_FIELDS, FIELD_BY_KEY, ProfileError, normaliseProfileValue, applyProfileChanges, fieldCompleteness };
