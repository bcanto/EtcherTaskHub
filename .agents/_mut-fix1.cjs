// Can-fail mutations for the release-1 fix (2026-10-12): insertNumbered() p_extra, so a Supabase
// create no longer silently drops fields a JS call site's row object carries beyond the fixed
// params. Run: node .agents/_canfail.cjs .agents/_mut-fix1.cjs --green
const S = 'iso-dbsb-unit-test';
module.exports = [
  { id: 'fix1-no-extra', suite: S, file: 'api/_isoDbSupabase.js', note: 'insertNumbered stops sending p_extra at all — every carried/derived field silently dropped again',
    find: '  body.p_extra = extra;\n', replace: '' },
  { id: 'fix1-audit-allowlist', suite: S, file: 'supabase/migrations/009_iso_core.sql', note: 'iso_create_audit forgets previous_audit_id — a maintenance/follow-up board would lose its chain link',
    find: "'default_visibility','previous_audit_id','completed_at','maintenance_due','library_release',", replace: "'default_visibility','completed_at','maintenance_due','library_release'," },
  { id: 'fix1-finding-allowlist', suite: S, file: 'supabase/migrations/009_iso_core.sql', note: 'iso_create_finding forgets carried_meta',
    find: "'root_cause_required','carried_from_ref','carried_meta','repeat_of_ref'];", replace: "'root_cause_required','carried_from_ref','repeat_of_ref'];" },
  { id: 'fix1-action-allowlist', suite: S, file: 'supabase/migrations/009_iso_core.sql', note: 'iso_create_action forgets the CAPA root_cause_summary column',
    find: "'corrective_action','preventive_action','effectiveness_check','effectiveness_review_date','visibility',", replace: "'corrective_action','preventive_action','effectiveness_review_date','visibility'," },
  { id: 'fix1-evidence-allowlist', suite: S, file: 'supabase/migrations/010_iso_evidence.sql', note: 'iso_create_evidence forgets the sample_* columns',
    find: "'carry_target_ids','sample_population','sample_size','sample_exceptions'];", replace: "'carry_target_ids'];" },
  { id: 'fix1-created-by-leak', suite: S, file: 'api/_isoDbSupabase.js', note: 'created_by/updated_by leak into p_extra, duplicating p_actor_uid',
    find: "if (!core.includes(k) && k !== 'created_by' && k !== 'updated_by' && row[k] !== undefined) extra[k] = row[k];", replace: 'if (!core.includes(k) && row[k] !== undefined) extra[k] = row[k];' },
  { id: 'fix1-reports-allowlist', suite: S, file: 'supabase/migrations/009_iso_core.sql', note: 'iso_update_row forgets iso_reports can write current_version — a re-issue would silently keep the old version number',
    find: "when 'iso_reports' then array['title','config','status','current_version']", replace: "when 'iso_reports' then array['title','config','status']" },
  { id: 'fix1-meta-coverage', suite: S, file: '.agents/iso-dbsb-unit-test.cjs', note: 'a table written through ctx.db.update loses its static-guard row and nothing notices',
    find: "      ['iso_evidence_links', ['review_status', 'review_comment', 'reviewed_by', 'reviewed_at', 'reviewed_version_label', 'role']],\n    ];", replace: '    ];' },
];
