// Phase 3 acceptance: stubs global.fetch and asserts the exact PostgREST URL, headers and RPC
// body for every _isoDbSupabase.js method — no network, so this can't hide a stub until a real
// dev project exists (Phase 15's iso-db-verify.cjs runs the same contract suite for real).
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
delete globalThis.__TASKHUB_SERVE_OFFLINE;
delete process.env.ISO_OFFLINE;

const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

let calls = [];
const allCalls = [];
const realFetch = global.fetch;
function stubFetch(responseBody, status) {
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    allCalls.push({ url, opts });
    return {
      ok: (status || 200) < 400,
      status: status || 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
}

const db = require('../api/_isoDbSupabase.js');

(async () => {
  // ── get() ────────────────────────────────────────────────────────────────────────────────────
  calls = []; stubFetch([{ id: 'x1', title: 'Hi' }]);
  await db.get('iso_audits', 'x1');
  ok(calls.length === 1, 'get() makes exactly one fetch call');
  ok(calls[0].url === 'https://fake-project.supabase.co/rest/v1/iso_audits?id=eq.x1&select=*&limit=1', `get() builds the exact expected URL (got ${calls[0].url})`);
  ok(calls[0].opts.headers.apikey === 'fake-service-role-key' && calls[0].opts.headers.Authorization === 'Bearer fake-service-role-key', 'get() sends the service role key as both apikey and Bearer token');

  // ── list() with scope + where + order + limit ──────────────────────────────────────────────
  calls = []; stubFetch([]);
  await db.list('iso_audits', { scope: { client_id: 'c1' }, where: [{ field: 'archived_at', op: 'isnull' }], order: 'report_due desc', limit: 10 });
  const listUrl = new URL(calls[0].url);
  ok(listUrl.pathname === '/rest/v1/iso_audits', 'list() targets the right table path');
  ok(listUrl.searchParams.get('client_id') === 'eq.c1', 'list() applies the scope filter as a top-level eq param');
  ok(listUrl.searchParams.get('archived_at') === 'is.null', 'list() translates isnull to PostgREST is.null');
  ok(listUrl.searchParams.get('order') === 'report_due.desc', 'list() builds the order param correctly');
  ok(listUrl.searchParams.get('limit') === '10', 'list() sends the limit param');

  // list() rejects a non-allowlisted filter column (plan §4.2 "filter and sort columns come only
  // from a per-entity allowlist").
  let rejected = false;
  try { await db.list('iso_audits', { where: [{ field: 'internal_notes', op: 'eq', value: 'x' }] }); }
  catch (e) { rejected = /not a filterable column/.test(e.message); }
  ok(rejected, 'list() refuses to filter on a column outside the per-entity allowlist');

  // ── insertNumbered() calls the dedicated RPC, never a raw table POST ───────────────────────
  calls = []; stubFetch({ id: 'iaud_1', ref: 'AUD-2026-001' });
  await db.insertNumbered('iso_audits', 'audit', 'AUD-2026', { id: 'iaud_1', client_id: 'c1', title: 'T', owner_uid: 'u1', visibility: 'all_internal' }, { actor_uid: 'u1' });
  ok(calls[0].url === 'https://fake-project.supabase.co/rest/v1/rpc/iso_create_audit', `insertNumbered(audit) calls iso_create_audit via RPC (got ${calls[0].url})`);
  const body1 = JSON.parse(calls[0].opts.body);
  ok(body1.p_id === 'iaud_1' && body1.p_client_id === 'c1' && body1.p_actor_uid === 'u1', `insertNumbered(audit) sends the right RPC params (got ${JSON.stringify(body1)})`);

  calls = []; stubFetch({ id: 'ifnd_1', ref: 'AUD-2026-001-F001' });
  await db.insertNumbered('iso_findings', 'child', 'iaud_1:F', { id: 'ifnd_1', audit_id: 'iaud_1', client_id: 'c1', title: 'F', classification: 'minor_nc' }, { actor_uid: 'u1' });
  ok(calls[0].url.endsWith('/rpc/iso_create_finding'), `insertNumbered(finding) calls iso_create_finding (got ${calls[0].url})`);
  ok(JSON.parse(calls[0].opts.body).p_extra && Object.keys(JSON.parse(calls[0].opts.body).p_extra).length === 0, 'insertNumbered() sends an empty p_extra when the row has nothing beyond the fixed params');

  // ── Fix (2026-10-12): every insertNumbered() row field beyond the fixed/core params rides along
  // as p_extra, so a field a batch adds to a call site's row object reaches Supabase — three real
  // gaps were found this way (B1's statement/criteria/evidence_basis, B2/B4's carried_from_ref/
  // carried_meta/repeat_of_ref, and the original audit.startMaintenance's previous_audit_id/
  // scope_text/library_release/follow_up_scope, none caught before because every ISO suite runs
  // offline only). Each block below shapes `row` exactly like a real api/_iso.js call site, checks
  // insertNumbered() sends every extra field, AND that the matching SQL create function's own
  // v_allowed array (009/010) accepts every one of those same keys — so the two sides can't drift
  // apart silently again.
  {
    const fs = require('fs'), path = require('path');
    const sql009 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '009_iso_core.sql'), 'utf8');
    const sql010 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '010_iso_evidence.sql'), 'utf8');
    const fnBody = (text, name) => { const s = text.indexOf('create or replace function ' + name + '('); if (s < 0) return null; const e = text.indexOf('\n$$;', s); return e < 0 ? null : text.slice(s, e); };
    const allowedOf = (text, name) => { const b = fnBody(text, name); const m = b && /v_allowed := array\[([\s\S]*?)\];/.exec(b); return m ? (m[1].match(/'([a-z_]+)'/g) || []).map(x => x.slice(1, -1)) : null; };
    const check = async (table, fn, row, expectExtraKeys) => {
      calls = []; stubFetch({ id: row.id });
      await db.insertNumbered(table, 'child', 'scope', row, { actor_uid: 'u1' });
      const body = JSON.parse(calls[0].opts.body);
      const got = Object.keys(body.p_extra || {}).sort();
      const want = expectExtraKeys.slice().sort();
      ok(JSON.stringify(got) === JSON.stringify(want), `insertNumbered(${table}) sends exactly the expected p_extra keys for this row shape (got ${JSON.stringify(got)}, expected ${JSON.stringify(want)})`);
      ok(!('created_by' in body.p_extra) && !('updated_by' in body.p_extra), `insertNumbered(${table}) never duplicates created_by/updated_by into p_extra (they ride on p_actor_uid)`);
      const allowed = allowedOf(table === 'iso_evidence' ? sql010 : sql009, fn);
      const missing = expectExtraKeys.filter(k => !(allowed || []).includes(k));
      ok(allowed && allowed.length > 0 && missing.length === 0, `every key insertNumbered(${table}) can send is in ${fn}'s own v_allowed array${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
    };
    // Shaped like audit.startMaintenance / audit.startFollowUp's row (api/_iso.js).
    await check('iso_audits', 'iso_create_audit', {
      id: 'iaud_2', client_id: 'c1', title: 'Maintenance audit of AUD-2026-001', audit_type: 'internal', stage: 'planning',
      visibility: 'all_internal', planned_start: '2027-01-15', follow_up_scope: null, owner_uid: 'u1',
      client_portal_enabled: false, default_visibility: 'internal', scope_text: 'Head office', exclusions_text: null,
      previous_audit_id: 'iaud_1', library_release: 'v3', created_by: 'u1', updated_by: 'u1',
    }, ['stage', 'planned_start', 'follow_up_scope', 'client_portal_enabled', 'default_visibility', 'scope_text', 'exclusions_text', 'previous_audit_id', 'library_release']);
    // Shaped like the maintenance carry-forward's finding row (carried_from_ref/carried_meta).
    await check('iso_findings', 'iso_create_finding', {
      id: 'ifnd_2', audit_id: 'iaud_2', client_id: 'c1', classification: 'minor_nc', title: 'Not conforming',
      statement: 'Seen the register.', criteria: 'ISO 9001 4.1', evidence_basis: 'Records register', status: 'draft',
      visibility: 'internal', visible_to_uids: [], root_cause_required: false,
      carried_from_ref: 'AUD-2026-001 / AUD-2026-001-F001', carried_meta: { auditRef: 'AUD-2026-001', ref: 'AUD-2026-001-F001', status: 'draft', by: 'u1', at: '2026-10-01T00:00:00Z' },
      repeat_of_ref: null, created_by: 'u1', updated_by: 'u1',
    }, ['statement', 'criteria', 'evidence_basis', 'status', 'visibility', 'visible_to_uids', 'root_cause_required', 'carried_from_ref', 'carried_meta', 'repeat_of_ref']);
    // Shaped like the maintenance carry-forward's action row (the full CAPA field set).
    await check('iso_actions', 'iso_create_action', {
      id: 'iact_2', audit_id: 'iaud_2', client_id: 'c1', title: 'Fix it', owner_kind: 'etcher',
      verification_status: 'not_verified', reopened_count: 0, carried_from_ref: 'AUD-2026-001 / AUD-2026-001-A001',
      carried_meta: { auditRef: 'AUD-2026-001', ref: 'AUD-2026-001-A001', status: 'in_progress', by: 'u1', at: '2026-10-01T00:00:00Z' },
      description: 'Retrain the team', owner_uid: 'u1', start_date: '2026-11-01', due_date: '2027-01-15', priority: 'high',
      risk_rating: 'medium', progress: 40, status: 'in_progress', verification_requirements: 'Re-sample next audit',
      correction: 'Retrained', containment: 'Procedure reissued', root_cause_method: 'five_whys',
      five_whys: [{ why: 'Why?', answer: 'Because.' }], fishbone: { People: ['Training gap'] }, cause_tree: [{ id: '1', parentId: null, text: 'Root' }],
      contributing_factors: [{ text: 'Turnover', category: 'People' }], cause_categories: ['people'], root_cause_summary: 'Staff turnover meant the procedure was never trained.',
      corrective_action: 'Retrain', preventive_action: 'Add to induction', effectiveness_check: 'Resample in 90 days',
      effectiveness_review_date: '2027-02-01', visibility: 'internal', visible_to_uids: [], created_by: 'u1', updated_by: 'u1',
    }, ['verification_status', 'reopened_count', 'carried_from_ref', 'carried_meta', 'description', 'owner_uid', 'start_date', 'due_date', 'priority', 'risk_rating', 'progress', 'status', 'verification_requirements', 'correction', 'containment', 'root_cause_method', 'five_whys', 'fishbone', 'cause_tree', 'contributing_factors', 'cause_categories', 'root_cause_summary', 'corrective_action', 'preventive_action', 'effectiveness_check', 'effectiveness_review_date', 'visibility', 'visible_to_uids']);
    // Shaped like the maintenance carry-forward's evidence row, plus a 'sample' kind's columns.
    await check('iso_evidence', 'iso_create_evidence', {
      id: 'ievi_2', audit_id: 'iaud_2', client_id: 'c1', kind: 'sample', title: 'Competency files',
      suggest_related: true, uploaded_by: 'u1', uploaded_via: 'staff', carried_from_ref: 'AUD-2026-001 / AUD-2026-001-E001',
      carry_target_ids: ['ireq_1'], document_id: 'idoc_1', visible_to_uids: [], review_or_expiry_date: '2027-06-01',
      sample_population: 42, sample_size: 5, sample_exceptions: '2 lacked authorisation', created_by: 'u1', updated_by: 'u1',
    }, ['carried_from_ref', 'carry_target_ids', 'document_id', 'visible_to_uids', 'review_or_expiry_date', 'sample_population', 'sample_size', 'sample_exceptions']);
  }

  // ── transition() dispatches to the ONE dedicated RPC each (table,column,to) maps to — never
  // the generic iso_update_row (plan §4.4, Phase 7.2) ─────────────────────────────────────────
  calls = []; stubFetch({ id: 'ifnd_1', status: 'released_for_review' });
  await db.transition('iso_findings', 'ifnd_1', 'status', 'draft', 'released_for_review', { actor_uid: 'u1' }, { expectedVersion: 1 });
  ok(calls[0].url.endsWith('/rpc/iso_release_finding'), `transition(finding -> released_for_review) calls iso_release_finding (got ${calls[0].url})`);
  ok(JSON.parse(calls[0].opts.body).p_expected_version === 1, 'transition() passes expectedVersion through as p_expected_version');

  calls = []; stubFetch({ id: 'ifnd_1', status: 'final' });
  await db.transition('iso_findings', 'ifnd_1', 'status', 'released_for_review', 'final', { actor_uid: 'u1' }, { expectedVersion: 2 });
  ok(calls[0].url.endsWith('/rpc/iso_finalize_finding'), `transition(finding -> final) calls iso_finalize_finding (got ${calls[0].url})`);

  calls = []; stubFetch({ id: 'ifnd_1', status: 'closed' });
  await db.transition('iso_findings', 'ifnd_1', 'status', 'final', 'closed', { actor_uid: 'u1' }, { expectedVersion: 3 });
  ok(calls[0].url.endsWith('/rpc/iso_close_finding'), `transition(finding -> closed) calls iso_close_finding (got ${calls[0].url})`);

  calls = []; stubFetch({ id: 'ifnd_1', status: 'withdrawn' });
  await db.transition('iso_findings', 'ifnd_1', 'status', 'draft', 'withdrawn', { actor_uid: 'u1' }, { expectedVersion: 1 });
  ok(calls[0].url.endsWith('/rpc/iso_withdraw_finding'), `transition(finding -> withdrawn) calls iso_withdraw_finding (got ${calls[0].url})`);

  calls = []; stubFetch({ id: 'iact_1', status: 'assigned' });
  await db.transition('iso_actions', 'iact_1', 'status', 'draft', 'assigned', { actor_uid: 'u1', actor_kind: 'staff', reason: null }, { expectedVersion: 1 });
  ok(calls[0].url.endsWith('/rpc/iso_transition_action'), `transition(action -> assigned) calls iso_transition_action (got ${calls[0].url})`);
  const bodyT = JSON.parse(calls[0].opts.body);
  ok(bodyT.p_to === 'assigned' && bodyT.p_expected_version === 1, `transition(action) sends p_to and p_expected_version (got ${JSON.stringify(bodyT)})`);

  let noRpc = false;
  try { await db.transition('iso_requirements', 'ireq_1', 'assessment_state', 'not_started', 'in_progress', {}, {}); }
  catch (e) { noRpc = /no dedicated RPC/.test(e.message); }
  ok(noRpc, 'transition() refuses a (table, column) pair with no dedicated RPC, rather than silently falling through to something generic');

  // ── verifyAction() / reopenAction() (Phase 7.3 slice 2, A41) — dedicated methods, not transition() ─
  calls = []; stubFetch({ id: 'iact_1', verification_status: 'effective', status: 'ready_for_verification' });
  await db.verifyAction('iact_1', 'effective', 'Looks good.', 3, { actor_uid: 'u1' });
  ok(calls[0].url.endsWith('/rpc/iso_verify_action'), `verifyAction() calls iso_verify_action via RPC (got ${calls[0].url})`);
  const bodyV = JSON.parse(calls[0].opts.body);
  ok(bodyV.p_id === 'iact_1' && bodyV.p_result === 'effective' && bodyV.p_notes === 'Looks good.' && bodyV.p_expected_version === 3 && bodyV.p_actor_uid === 'u1',
    `verifyAction() sends the exact RPC params (got ${JSON.stringify(bodyV)})`);

  calls = []; stubFetch({ id: 'iact_1', reopened_count: 1, status: 'in_progress' });
  await db.reopenAction('iact_1', 'recurred', 'Failed again.', 4, { actor_uid: 'u1' });
  ok(calls[0].url.endsWith('/rpc/iso_reopen_action'), `reopenAction() calls iso_reopen_action via RPC (got ${calls[0].url})`);
  const bodyR = JSON.parse(calls[0].opts.body);
  ok(bodyR.p_id === 'iact_1' && bodyR.p_reason_code === 'recurred' && bodyR.p_reason_text === 'Failed again.' && bodyR.p_expected_version === 4 && bodyR.p_actor_uid === 'u1',
    `reopenAction() sends the exact RPC params (got ${JSON.stringify(bodyR)})`);

  // ── update() calls iso_update_row, and surfaces a 40001 as version_conflict ────────────────
  calls = []; stubFetch({ id: 'iaud_1', title: 'New', row_version: 2 });
  await db.update('iso_audits', 'iaud_1', { title: 'New' }, 1, { actor_uid: 'u1', actor_kind: 'staff' });
  ok(calls[0].url.endsWith('/rpc/iso_update_row'), `update() calls iso_update_row via RPC (got ${calls[0].url})`);
  const body2 = JSON.parse(calls[0].opts.body);
  ok(body2.p_table === 'iso_audits' && body2.p_id === 'iaud_1' && body2.p_expected_version === 1, `update() sends the right RPC params (got ${JSON.stringify(body2)})`);

  // A80: the op's own activity description travels with the update (offline/Supabase parity).
  calls = []; stubFetch({ id: 'ireq_1', row_version: 3 });
  await db.update('iso_requirements', 'ireq_1', { applicability: 'not_applicable' }, 2, { audit_id: 'iaud_1', client_id: 'c1', entity_type: 'requirement', entity_id: 'ireq_1', entity_ref: '9001 4.1', action: 'updated', field: 'applicability', reason: 'Out of scope at this site', source: 'user', actor_uid: 'u1', actor_kind: 'staff' });
  const body3 = JSON.parse(calls[0].opts.body);
  ok(body3.p_entity_type === 'requirement' && body3.p_entity_id === 'ireq_1' && body3.p_entity_ref === '9001 4.1' && body3.p_action === 'updated' && body3.p_field === 'applicability' && body3.p_reason === 'Out of scope at this site' && body3.p_source === 'user',
    `update() passes the op's own activity description — entity, ref, action, field, reason, source (got ${JSON.stringify(body3)})`);
  const sql009 = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '009_iso_core.sql'), 'utf8');
  const fnStart = sql009.indexOf('create or replace function iso_update_row(');
  const fn009 = sql009.slice(fnStart, sql009.indexOf('$$;', fnStart));
  ok(/p_reason text default null/.test(fn009) && /coalesce\(p_entity_type, p_table\)/.test(fn009) && /coalesce\(p_entity_id, p_id\)/.test(fn009) && /coalesce\(p_action, 'updated'\)/.test(fn009) && /p_field, v_before, v_after, p_reason/.test(fn009),
    "009's iso_update_row logs the entity, action, field and reason it is given (the old fixed values only as a fallback)");
  ok(sql009.includes("'iso_update_row(text,text,jsonb,int,text,text,text,text,text,text,text,text,text)'") && !sql009.includes("'iso_update_row(text,text,jsonb,int,text,text)'"),
    'and its grant/revoke names the new 13-argument signature');

  // Plan 8.2: an uploaded file's columns and document status reach iso_create_evidence; a link's are null.
  calls = []; stubFetch({ id: 'ievi_1', ref: 'AUD-2026-001-E001' });
  await db.insertNumbered('iso_evidence', 'child', 'iaud_1:E', { id: 'ievi_1', audit_id: 'iaud_1', client_id: 'c1', kind: 'file', title: 'Plan', storage_path: 'c1/iaud_1/ievi_1/ab.pdf', original_filename: 'Plan.pdf', mime: 'application/pdf', size_bytes: 1234, document_status: 'draft', suggest_related: true }, { actor_uid: 'u1' });
  const bodyE = JSON.parse(calls[0].opts.body);
  ok(calls[0].url.endsWith('/rpc/iso_create_evidence') && bodyE.p_storage_path === 'c1/iaud_1/ievi_1/ab.pdf' && bodyE.p_original_filename === 'Plan.pdf' && bodyE.p_mime === 'application/pdf' && bodyE.p_size_bytes === 1234 && bodyE.p_document_status === 'draft',
    `insertNumbered(iso_evidence) sends the file columns and document status (got ${JSON.stringify(bodyE)})`);
  calls = []; stubFetch({ id: 'ievi_2' });
  await db.insertNumbered('iso_evidence', 'child', 'iaud_1:E', { id: 'ievi_2', audit_id: 'iaud_1', client_id: 'c1', kind: 'link', title: 'Link', url: 'https://x.test/' }, { actor_uid: 'u1' });
  const bodyL = JSON.parse(calls[0].opts.body);
  ok(bodyL.p_storage_path === null && bodyL.p_size_bytes === null && bodyL.p_document_status === null, 'a link sends no file columns (the function defaults document status to draft)');
  calls = []; stubFetch({ size: 321, content_type: 'application/pdf' });
  const h1 = await db.storageHead('c1/a/e/x.pdf');
  calls = []; stubFetch({ metadata: { size: 9, mimetype: 'image/png' } });
  const h2 = await db.storageHead('c1/a/e/y.png');
  ok(h1.exists && h1.size === 321 && h1.mime === 'application/pdf' && h2.size === 9 && h2.mime === 'image/png', `storageHead() reads size and type from either object-info shape (got ${JSON.stringify([h1, h2])})`);

  calls = []; stubFetch({ error: 'version_conflict' }, 400);
  let conflictSeen = false;
  try { await db.update('iso_audits', 'iaud_1', { title: 'stale' }, 1, null); }
  catch (e) { conflictSeen = e.code === 'version_conflict'; }
  ok(conflictSeen, 'update() surfaces a 40001/version_conflict response as e.code === "version_conflict"');

  // ── counterNext() / log() / importApply() hit the right RPCs ───────────────────────────────
  calls = []; stubFetch(5);
  await db.counterNext('AUD-2026');
  ok(calls[0].url.endsWith('/rpc/iso_next_number') && JSON.parse(calls[0].opts.body).p_scope === 'AUD-2026', 'counterNext() calls iso_next_number with the right scope');

  calls = []; stubFetch({ id: 1 });
  await db.log({ entity_type: 'audit', entity_id: 'x', action: 'created', actor_uid: 'u1', actor_kind: 'staff' });
  ok(calls[0].url.endsWith('/rpc/iso_log'), 'log() calls iso_log via RPC');

  calls = []; stubFetch(null);
  await db.importApply('irun_1', [{ table: 'iso_clause_sections', id: 'x', patch: {} }]);
  ok(calls[0].url.endsWith('/rpc/iso_import_apply') && JSON.parse(calls[0].opts.body).p_run_id === 'irun_1', 'importApply() calls iso_import_apply with the run id');

  // ── updateMember() / removeMember() use composite PostgREST filters, not the id-based RPC ──
  calls = []; stubFetch([{ audit_id: 'a1', user_uid: 'u2', audit_role: 'auditor' }]);
  await db.updateMember('a1', 'u2', { audit_role: 'auditor' }, null);
  const memberUrl = new URL(calls[0].url);
  ok(calls[0].opts.method === 'PATCH', 'updateMember() issues a PATCH, not a POST/RPC');
  ok(memberUrl.searchParams.get('audit_id') === 'eq.a1' && memberUrl.searchParams.get('user_uid') === 'eq.u2', 'updateMember() filters by the composite key (audit_id, user_uid), not a single id');

  calls = []; stubFetch(null);
  await db.removeMember('a1', 'u2', null);
  ok(calls[0].opts.method === 'DELETE', 'removeMember() issues a DELETE');

  // ── getConfig() / upsertConfig() key by `key`, not `id` ─────────────────────────────────────
  calls = []; stubFetch([{ key: 'timezone', value: 'Australia/Perth' }]);
  await db.getConfig('timezone');
  ok(calls[0].url.includes('key=eq.timezone'), `getConfig() filters by key, not id (got ${calls[0].url})`);

  calls = []; stubFetch([{ key: 'timezone', value: 'Australia/Sydney' }]);
  await db.upsertConfig('timezone', 'Australia/Sydney', 'u1', null);
  ok(calls[0].opts.headers.Prefer && /merge-duplicates/.test(calls[0].opts.headers.Prefer), 'upsertConfig() uses an upsert (merge-duplicates), never a plain insert that could 409 on an existing key');

  // ── every request made in this whole run authenticates with the service role key ───────────
  ok(allCalls.length > 10 && allCalls.every(c => c.opts.headers && c.opts.headers.apikey === 'fake-service-role-key'),
    `every one of the ${allCalls.length} calls made in this run used the service role key, never a bare/anon request`);

  // ── static guard: what the server writes through iso_update_row is all in 009's allowlist ─────
  // Two such gaps were found by reading (iso_requirements' assessment columns; iso_actions'
  // auditor_review_note/visibility) — this pins every list so the next one fails here, not in production.
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', '_iso.js'), 'utf8');
    const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '009_iso_core.sql'), 'utf8');
    const arr = text => (text.match(/'([a-z_]+)'/g) || []).map(x => x.slice(1, -1));
    const jsList = name => { const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(src); return m ? arr(m[1]) : null; };
    const allow = table => { const m = new RegExp("when '" + table + "' then array\\[([\\s\\S]*?)\\]").exec(sql); return m ? arr(m[1]) : null; };
    const auditAllowed = (() => { const m = /'audit\.update'[\s\S]*?const allowed = \[([\s\S]*?)\];/.exec(src); return m ? arr(m[1]) : null; })();
    const checks = [
      ['iso_requirements', [...(jsList('REQUIREMENT_WRITABLE_FIELDS') || []), 'assessed_at', 'assessed_by', 'senior_review_status', 'senior_review_note', 'senior_reviewed_by', 'senior_reviewed_at']],
      ['iso_findings', jsList('FINDING_WRITABLE_FIELDS') || []],
      ['iso_actions', jsList('ACTION_WRITABLE_FIELDS') || []],
      ['iso_action_subtasks', jsList('SUBTASK_WRITABLE_FIELDS') || []],
      ['iso_audits', [...(auditAllowed || []), 'completed_at', 'visibility', 'archived_at']],
      // Release-1 additions (B4.5, B5.2, B4.6) — no dedicated *_WRITABLE_FIELDS const for the latter
      // two (their ops write a small, fixed inline patch), so those two are named here by hand.
      ['iso_client_settings', jsList('CLIENT_SETTINGS_FIELDS') || []],
      ['iso_reports', ['title', 'config', 'status', 'current_version']],
      ['iso_evidence_requests', ['status']],
    ];
    ok(jsList('REQUIREMENT_WRITABLE_FIELDS') && jsList('ACTION_WRITABLE_FIELDS') && jsList('CLIENT_SETTINGS_FIELDS') && auditAllowed, 'the static guard found every writable-field list it checks');
    for (const [table, fields] of checks) {
      const al = allow(table) || [];
      const missing = fields.filter(f => !al.includes(f));
      ok(fields.length > 0 && missing.length === 0, `every field api/_iso.js writes to ${table} is in 009's iso_update_row allowlist${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
    }
  }

  global.fetch = realFetch;
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { global.fetch = realFetch; console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.stack); process.exit(1); });
