-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO Audit core schema
-- Migration: 009_iso_core.sql
--
-- Everything ISO lives in these new `iso_*` tables, reached only through the service role from
-- api/iso.js — never from the browser directly, and never through the app_state blob (see
-- docs/iso-audit-integration-plan.md D1). Every table: RLS enabled with NO policies, plus an
-- explicit revoke, so even the anon/authenticated Postgres roles have zero access — only the
-- service role (which bypasses RLS) can touch them. This is defence in depth on top of
-- api/_iso.js's own permission checks, matching 005's "belt and braces" approach for app_state.
--
-- Numbering, optimistic concurrency, append-only history and no-hard-delete are enforced here at
-- the database layer (not just in application code), because the service role bypasses RLS and
-- would otherwise be trusted blindly. See plan §4.4 for the full guarantee list this migration
-- implements.
--
-- Safe to run more than once (every CREATE is IF NOT EXISTS / OR REPLACE; every seed INSERT is
-- ON CONFLICT DO NOTHING or DO UPDATE).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tables ──────────────────────────────────────────────────────────────────

-- Standard library (versioned; historic audits pin a version so they never move — plan §22).
create table if not exists iso_standards (
  code          text primary key,                       -- '9001' | '14001' | '45001'
  name          text not null,                           -- 'ISO 9001'
  title         text not null,                           -- 'Quality Management System'
  system_abbrev text not null,                            -- 'QMS'
  badge         text not null,                            -- 'Q'
  color         text not null default '#97bcbd',
  active        boolean not null default true
);

create table if not exists iso_standard_versions (
  id              text primary key,
  standard_code   text not null references iso_standards(code),
  label           text not null,
  -- Plan 4b.1 (R13, D24): the standard's edition year ('2015', '2026', …). Null only for a legacy
  -- workbook import that didn't say. Editions sit side by side (a board keeps the one it was created
  -- on); added before this migration was ever applied (A24 precedent).
  edition         text,
  status          text not null default 'draft' check (status in ('draft','approved','retired')),
  source_filename text,
  source_sha256   text,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  created_by      text
);

create table if not exists iso_clause_sections (
  id         text primary key,
  version_id text not null references iso_standard_versions(id),
  clause     text not null,                                -- '4', '5.1'
  title      text not null,
  level      int not null check (level in (1,2)),
  sort_key   int not null,
  source_row int
);

-- Never edited once its version is approved (trigger below enforces this).
create table if not exists iso_library_requirements (
  id                text primary key,
  version_id        text not null references iso_standard_versions(id),
  section_id        text not null references iso_clause_sections(id),
  clause            text not null,
  clause_name       text not null,
  requirement_text  text not null,
  evidence_guidance text,
  stable_key        text not null,                          -- standard + clause + sha1(normalised text) + occurrence
  source_sheet      text,
  source_row        int,
  sort_key          int not null
);
create unique index if not exists iso_library_requirements_stable_key_uk on iso_library_requirements(version_id, stable_key);
-- One version per (standard, edition): library.loadSeed's "already loaded?" check is backed here, so
-- two admins clicking Load at once can't create two 2015 libraries.
create unique index if not exists iso_standard_versions_edition_uk on iso_standard_versions(standard_code, edition) where edition is not null;

-- Config: finding_classifications, gap_categories, fishbone_categories, number_prefixes,
-- timezone, evidence_max_upload_mb. Deliberately plain text/jsonb, not a Postgres enum — these
-- are admin-configurable at runtime (plan §4.7 "Numbering: Server/DB only", D16 config).
create table if not exists iso_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists iso_counters (
  scope      text primary key,
  next_value int not null
);

create table if not exists iso_audits (
  id                     text primary key,
  ref                    text not null unique,                 -- 'AUD-2026-001'
  client_id              text not null,
  title                  text not null,
  audit_type             text not null default 'gap_analysis' check (audit_type in
                           ('internal','gap_analysis','certification_prep','surveillance','recertification','supplier','custom')),
  custom_type_label      text,
  stage                  text not null default 'planning' check (stage in ('planning','fieldwork','reporting','capa','closed')),
  scope_text             text,
  exclusions_text        text,
  planned_start          date,
  planned_end            date,
  report_due             date,
  certification_body     text,
  lead_auditor_uid       text,
  -- D11: who may open the board (staff), separate from default_visibility (client visibility below).
  visibility             text not null default 'all_internal' check (visibility in ('all_internal','private')),
  owner_uid              text not null,
  internal_notes         text,
  template_id            text,
  client_portal_enabled  boolean not null default false,
  default_visibility     text not null default 'internal' check (default_visibility in
                           ('internal','client_selected','client_all','after_approval','report_only')),
  -- D31 / Phase 9b: the yearly maintenance cycle. completed_at is set when the board moves to Closed;
  -- maintenance_due is asked for then (default 12 months on, editable later); previous_audit_id links a
  -- maintenance board to the board it follows (the only link — the previous board is never written to).
  completed_at           timestamptz,
  maintenance_due        date,
  previous_audit_id      text references iso_audits(id),
  row_version            int not null default 1,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  created_by             text,
  updated_at             timestamptz not null default now(),
  updated_by             text
);
create index if not exists iso_audits_previous_ix on iso_audits(previous_audit_id) where previous_audit_id is not null;

-- No client_id column (plan D17/§22): a template is reusable across clients and must never carry
-- one client's data. config is built only from an explicit whitelist in application code.
create table if not exists iso_templates (
  id           text primary key,
  name         text not null,
  description  text,
  audit_type   text,
  config       jsonb not null default '{}'::jsonb,
  row_version  int not null default 1,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create table if not exists iso_audit_standards (
  audit_id   text not null references iso_audits(id),
  version_id text not null references iso_standard_versions(id),
  primary key (audit_id, version_id)
);

create table if not exists iso_audit_units (
  id       text primary key,
  audit_id text not null references iso_audits(id),
  kind     text not null check (kind in ('site','department','process')),
  name     text not null,
  archived_at timestamptz
);

create table if not exists iso_audit_members (
  audit_id                text not null references iso_audits(id),
  user_uid                text not null,
  member_kind             text not null check (member_kind in ('staff','client')),
  audit_role              text not null check (audit_role in
                            ('audit_manager','auditor','contributor','reviewer','client_admin','client_contributor')),
  can_upload_evidence     boolean not null default false,
  can_respond             boolean not null default false,
  can_verify              boolean not null default false,
  can_manage_client_actions boolean not null default false,
  added_by                text,
  added_at                timestamptz not null default now(),
  primary key (audit_id, user_uid)
);

-- The audit requirement instance (plan §5.2). One row per requirement per audit, frozen from the
-- pinned library version at creation.
create table if not exists iso_requirements (
  id                        text primary key,
  audit_id                  text not null references iso_audits(id),
  client_id                 text not null,
  standard_code             text not null references iso_standards(code),
  library_requirement_id    text references iso_library_requirements(id),  -- null for custom rows
  section_id                text references iso_clause_sections(id),
  sort_key                  int not null default 0,
  origin                    text not null default 'library' check (origin in
                              ('library','client_specific','contractual','regulatory_legal')),
  -- Frozen copy from the pinned library version — never re-synced except by a deliberate re-import.
  clause                    text not null,
  clause_name               text not null,
  requirement_text          text not null,
  evidence_guidance         text,
  -- Applicability
  applicability             text not null default 'applicable' check (applicability in ('applicable','review','not_applicable','out_of_scope')),
  na_justification          text,
  unit_ids                  text[] not null default '{}',
  -- Assessment (staff)
  audit_question            text,
  current_system            text,
  evidence_expected         text,
  interview_notes           text,          -- internal only
  sampling_details          text,
  auditor_observations      text,          -- internal only
  assessment_state          text not null default 'not_started' check (assessment_state in
                              ('not_started','in_progress','awaiting_evidence','needs_follow_up','complete')),
  assessment_result         text check (assessment_result in
                              ('not_implemented','no_evidence_provided','partially_implemented','implemented_ineffective','implemented_effective','not_applicable')),
  implementation_level      int check (implementation_level between 0 and 4),
  effectiveness             text check (effectiveness in ('not_assessed','effective','partly_effective','ineffective')),
  gap_description           text,
  gap_category              text,          -- from iso_config.gap_categories
  current_controls          text,
  impact                    text,
  risk_severity             text check (risk_severity in ('low','medium','high','critical')),
  recommended_action        text,
  responsible_uid           text,
  target_date               date,
  verification_requirements text,
  internal_notes            text,
  assessed_at               timestamptz,
  assessed_by               text,
  -- D35/R2 (2026-10-05): one status field replaces applicability/assessment_state/assessment_result/
  -- effectiveness for everything that writes an assessment now (api/_iso.js derives those four from
  -- this on every write, so they stay real and correct for whatever still reads them — isoCalc.js,
  -- the dashboard — without any change there; see api/_iso.js's COMPLIANCE_DERIVED). The columns
  -- above are kept, not dropped — D35's "retiring" rule, same as R1's archived library seeds.
  compliance_status         text not null default 'not_assessed' check (compliance_status in
                              ('not_assessed','compliant','partially_compliant','non_compliant','not_applicable','out_of_scope')),
  -- Release-1 B1 (2026-10-06, D44–D48): OFI is a flag on Compliant / Partially Compliant, not a status;
  -- "Outside this audit's scope" (out_of_scope) is a status of its own; a gap reason says why a
  -- Partially Compliant / Non-Compliant clause falls short; derived_from_id marks a status proposed by
  -- "Apply to related" until someone confirms it on this clause.
  ofi                       boolean not null default false,
  ofi_note                  text,
  gap_reason                text check (gap_reason in ('not_implemented','ineffective','no_evidence')),
  derived_from_id           text references iso_requirements(id) on delete set null,
  derived_at                timestamptz,
  -- The Lead Auditor's review of compliance_status (P7) — proposed by whoever set it, approved or
  -- returned by the Lead; null until a real status exists. Independent of senior_review_* below,
  -- which stays exactly as D32 built it, untouched, still reachable through requirement.seniorReview.
  approval_state            text check (approval_state in ('proposed','approved','returned')),
  approved_by               text,
  approved_at               timestamptz,
  return_note               text,
  -- Senior review (D32): a second person's sign-off on the assessment. Set only through
  -- requirement.seniorReview; any later change to the assessment puts it back to 'pending'.
  senior_review_status      text not null default 'pending' check (senior_review_status in ('pending','redo','compliant','partially_compliant','non_compliant','na_confirmed')),
  senior_review_note        text,
  senior_reviewed_by        text,
  senior_reviewed_at        timestamptz,
  -- Client-facing
  client_visible_comment    text,
  visibility                text not null default 'internal' check (visibility in
                              ('internal','client_selected','client_all','after_approval','report_only')),
  visible_to_uids           text[] not null default '{}',
  -- Baseline and source
  baseline_result           text,
  baseline_state            text,
  baseline_at               timestamptz,
  imported                  jsonb,          -- read-only snapshot of workbook columns D/E/F/G
  source_sheet              text,
  source_row                int,
  stable_key                text,
  source_changed            boolean not null default false,
  missing_from_source       boolean not null default false,
  row_version               int not null default 1,
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  created_by                text,
  updated_at                timestamptz not null default now(),
  updated_by                text,
  -- after_approval is findings-only (plan §6.3) — never valid on a requirement.
  constraint iso_requirements_visibility_ck check (visibility <> 'after_approval'),
  -- Sending an assessment back for redo always says what needs redoing (D32).
  constraint iso_requirements_redo_note_ck check (
    senior_review_status <> 'redo' or (senior_review_note is not null and char_length(senior_review_note) > 0)
  ),
  -- not_applicable requires a justification (plan §6.1).
  constraint iso_requirements_na_justification_ck check (
    applicability <> 'not_applicable' or (na_justification is not null and char_length(na_justification) > 0)
  ),
  -- assessment_result may only be set once the workflow is complete or needs follow-up (plan §6.1).
  constraint iso_requirements_result_state_ck check (
    assessment_result is null or assessment_state in ('complete','needs_follow_up')
  ),
  -- D44 / D48: the OFI flag and the gap reason only live on the statuses they belong to.
  constraint iso_requirements_ofi_status_ck check (not ofi or compliance_status in ('compliant','partially_compliant')),
  constraint iso_requirements_gap_status_ck check (gap_reason is null or compliance_status in ('partially_compliant','non_compliant'))
);

create table if not exists iso_relationships (
  id          text primary key,
  audit_id    text not null references iso_audits(id),
  from_id     text not null references iso_requirements(id),
  to_id       text not null references iso_requirements(id),
  -- shared_evidence / supporting added for plan 8b.1 (R11, D21) before this migration was ever applied
  -- (A24 precedent); `supporting` never carries evidence suggestions.
  -- `library` kind/source added for the board redesign (R3, D35 P6): Column P's 407 pairs ship
  -- with the library and are computed live (relationship.library), so a row here only ever exists
  -- to record a per-board rejection of one pair — state 'confirmed' means a rejection was undone,
  -- not that a row was actively confirmed, since an un-rejected library pair never gets a row at all.
  kind        text not null check (kind in ('same_requirement','integrated_topic','mapping','shared_evidence','supporting','library')),
  state       text not null default 'suggested' check (state in ('suggested','confirmed','rejected')),
  reason_code text,
  reason_text text,
  source      text not null default 'rule' check (source in ('rule','mapping','manual','library')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists iso_comments (
  id          text primary key,
  audit_id    text not null references iso_audits(id),
  client_id   text not null,
  entity_type text not null,
  entity_id   text not null,
  body        text not null,
  visibility  text not null default 'internal' check (visibility in ('internal','client_all')),
  author_uid  text not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Append-only (trigger below). bigserial so `order by id` is always insertion order.
create table if not exists iso_activity (
  id          bigserial primary key,
  audit_id    text references iso_audits(id),
  client_id   text,
  entity_type text not null,
  entity_id   text not null,
  entity_ref  text,
  action      text not null,
  field       text,
  before      jsonb,
  after       jsonb,
  reason      text,
  source      text not null default 'user' check (source in ('user','import','automation','portal')),
  actor_uid   text,
  actor_kind  text check (actor_kind in ('staff','client','system')),
  at          timestamptz not null default now()
);

create table if not exists iso_saved_views (
  id         text primary key,
  owner_uid  text,                      -- null = shared
  audit_id   text references iso_audits(id),   -- null = any audit
  entity     text not null,
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists iso_notifications (
  id            text primary key,
  recipient_uid text not null,
  audit_id      text references iso_audits(id),
  entity_type   text not null,
  entity_id     text not null,
  type          text not null,
  message       text not null,          -- safe text only — never internal notes
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists iso_import_runs (
  id               text primary key,
  kind             text not null check (kind in ('library','audit')),
  source_filename  text,
  sha256           text,
  file_path        text,
  target_version_id text references iso_standard_versions(id),
  target_audit_id  text references iso_audits(id),
  dry_run          boolean not null default true,
  summary          jsonb,
  diff_sha256      text,
  backup           jsonb,               -- pre-apply values of every row/field the apply changes
  status           text not null default 'previewed' check (status in ('previewed','applied','failed')),
  performed_by     text,
  at               timestamptz not null default now()
);

create table if not exists iso_findings (
  id                 text primary key,
  ref                text not null,
  audit_id           text not null references iso_audits(id),
  client_id          text not null,
  classification     text not null,     -- from iso_config.finding_classifications
  title              text not null,
  statement          text,
  criteria           text,
  evidence_basis     text,
  -- 'reopened' (release-1 B2.4): a closed finding the Lead reopened with a reason (iso_reopen_finding).
  status             text not null default 'draft' check (status in ('draft','released_for_review','final','closed','withdrawn','reopened')),
  visibility         text not null default 'internal' check (visibility in
                       ('internal','client_selected','client_all','after_approval','report_only')),
  visible_to_uids    text[] not null default '{}',
  released_at        timestamptz,
  released_by        text,
  closed_at          timestamptz,
  closed_by          text,
  root_cause_required boolean not null default false,
  reopened_count     int not null default 0,
  -- Phase 9b (D31): carried over from the previous board's open record — "<audit ref> / <ref>".
  carried_from_ref       text,
  -- Release-1 B2: the last reopen's reason (reopened_count above counts them); repeat_of_ref is
  -- "<earlier board ref> / <finding ref | ISO std clause>" when the clause had a finding or a
  -- Non-Compliant status on an earlier board in the client's chain.
  reopen_reason      text,
  repeat_of_ref      text,
  row_version        int not null default 1,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text,
  updated_at         timestamptz not null default now(),
  updated_by         text,
  unique (audit_id, ref)
);

create table if not exists iso_finding_requirements (
  finding_id     text not null references iso_findings(id),
  requirement_id text not null references iso_requirements(id),
  primary key (finding_id, requirement_id)
);

create table if not exists iso_actions (
  id                      text primary key,
  ref                     text not null,
  audit_id                text not null references iso_audits(id),
  client_id               text not null,
  title                   text not null,
  description             text,
  owner_kind              text not null default 'etcher' check (owner_kind in ('etcher','client')),
  owner_uid               text,
  start_date              date,
  due_date                date,
  priority                text check (priority in ('low','med','high','crit')),
  risk_rating             text check (risk_rating in ('low','medium','high','critical')),
  progress                int not null default 0 check (progress between 0 and 100),
  status                  text not null default 'draft' check (status in
                            ('draft','assigned','in_progress','awaiting_evidence','submitted_for_review',
                             'more_info_required','ready_for_verification','verified','closed','on_hold')),
  -- A40: the status this action was paused FROM, set when entering on_hold and cleared on resume —
  -- on_hold has no fixed destination of its own (unlike every other transition here), so this is
  -- the only record of what "resume" should mean. See iso_transition_action below.
  on_hold_from_status     text check (on_hold_from_status in
                            ('draft','assigned','in_progress','awaiting_evidence','submitted_for_review',
                             'more_info_required','ready_for_verification')),
  verification_status     text not null default 'not_verified' check (verification_status in ('not_verified','effective','ineffective')),
  verification_requirements text,
  verification_notes      text,
  verified_by             text,
  verified_at             timestamptz,
  closure_decision        text,
  client_response         text,          -- client-visible; writable by the client owner/client_admin while assigned..more_info_required
  auditor_review_note     text,
  -- CAPA
  correction              text,
  containment             text,
  root_cause_method       text not null default 'none' check (root_cause_method in ('none','five_whys','fishbone','cause_tree','other')),
  five_whys               jsonb,          -- [{why,answer}], <=5
  fishbone                jsonb,          -- {"<category>": ["cause", ...]}
  cause_tree              jsonb,          -- [{id,parent_id,text,kind}]
  contributing_factors    jsonb,          -- [{text,category}]
  cause_categories        text[] not null default '{}',
  root_cause_summary      text,
  corrective_action       text,
  preventive_action       text,
  effectiveness_check     text,
  effectiveness_review_date date,
  visibility              text not null default 'internal' check (visibility in
                            ('internal','client_selected','client_all','after_approval','report_only')),
  visible_to_uids         text[] not null default '{}',
  reopened_count          int not null default 0,
  -- Set only for actions created from a workbook's "To Do List:" rows (plan Phase 4.6) — lets
  -- re-import match an existing action back to its source row idempotently, the same way
  -- iso_requirements.stable_key does for requirements. Gap found while building Phase 4's
  -- importer (plan §14 A24): not in the original 009 draft, added before this migration was ever
  -- applied, per task 4.1 ("no new migration... if you find a gap, add it to 009").
  import_source_row       int,
  -- Phase 9b (D31): carried over from the previous board's open record — "<audit ref> / <ref>".
  carried_from_ref       text,
  row_version             int not null default 1,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  created_by              text,
  updated_at              timestamptz not null default now(),
  updated_by              text,
  unique (audit_id, ref),
  -- after_approval is findings-only (plan §6.3).
  constraint iso_actions_visibility_ck check (visibility <> 'after_approval'),
  -- plan §6.2 major-NC rule's root_cause_summary length is enforced in api/_iso.js (the "generic
  -- cause" text check needs app-level string normalisation) — this is just the basic shape guard.
  constraint iso_actions_five_whys_len_ck check (five_whys is null or jsonb_array_length(five_whys) <= 5)
);

create table if not exists iso_action_subtasks (
  id          text primary key,
  action_id   text not null references iso_actions(id),
  audit_id    text not null references iso_audits(id),
  client_id   text not null,
  title       text not null,
  owner_uid   text,
  due_date    date,
  done        boolean not null default false,
  sort_key    int not null default 0,
  row_version int not null default 1,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists iso_action_reviews (
  id              text primary key,
  action_id       text not null references iso_actions(id),
  submission_no   int not null,
  submitted_by    text not null,
  submitted_at    timestamptz not null default now(),
  submission_note text,
  decision        text check (decision in ('accepted','rejected','more_info')),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text
);

create table if not exists iso_action_links (
  id          text primary key,
  action_id   text not null references iso_actions(id),
  target_type text not null check (target_type in ('finding','requirement')),
  target_id   text not null,
  link_state  text not null default 'suggested' check (link_state in ('suggested','confirmed','rejected')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists iso_action_extensions (
  id             text primary key,
  action_id      text not null references iso_actions(id),
  requested_by   text not null,
  current_due    date not null,
  requested_due  date not null,
  reason         text not null,
  decision       text not null default 'pending' check (decision in ('pending','approved','rejected')),
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);

-- ── 2. Indexes (plan §5, §29 of the brief) ──────────────────────────────────────
create index if not exists iso_requirements_client_audit_idx   on iso_requirements(client_id, audit_id);
create index if not exists iso_requirements_audit_archived_idx on iso_requirements(audit_id, archived_at);
create index if not exists iso_requirements_clause_idx         on iso_requirements(audit_id, standard_code, clause);
create index if not exists iso_requirements_state_idx          on iso_requirements(assessment_state);
create index if not exists iso_requirements_responsible_idx    on iso_requirements(responsible_uid);
create index if not exists iso_requirements_target_date_idx    on iso_requirements(target_date);
create index if not exists iso_requirements_visibility_idx     on iso_requirements(visibility);

create index if not exists iso_findings_client_audit_idx   on iso_findings(client_id, audit_id);
create index if not exists iso_findings_audit_archived_idx on iso_findings(audit_id, archived_at);
create index if not exists iso_findings_visibility_idx     on iso_findings(visibility);

create index if not exists iso_actions_client_audit_idx    on iso_actions(client_id, audit_id);
create index if not exists iso_actions_audit_archived_idx  on iso_actions(audit_id, archived_at);
create index if not exists iso_actions_status_idx          on iso_actions(status);
create index if not exists iso_actions_owner_idx           on iso_actions(owner_uid);
create index if not exists iso_actions_due_date_idx        on iso_actions(due_date);
create index if not exists iso_actions_visibility_idx      on iso_actions(visibility);

create index if not exists iso_audits_client_idx      on iso_audits(client_id);
create index if not exists iso_audits_visibility_idx  on iso_audits(visibility);
create index if not exists iso_audits_archived_idx    on iso_audits(archived_at);

create index if not exists iso_activity_audit_at_idx   on iso_activity(audit_id, at desc);
create index if not exists iso_activity_entity_idx     on iso_activity(entity_type, entity_id);

create index if not exists iso_relationships_from_idx  on iso_relationships(from_id);
create index if not exists iso_relationships_to_idx    on iso_relationships(to_id);
create index if not exists iso_finding_requirements_req_idx on iso_finding_requirements(requirement_id);
create index if not exists iso_action_links_target_idx on iso_action_links(target_type, target_id);
create index if not exists iso_action_subtasks_action_idx on iso_action_subtasks(action_id);
create index if not exists iso_comments_entity_idx on iso_comments(entity_type, entity_id);
create index if not exists iso_notifications_recipient_idx on iso_notifications(recipient_uid, read_at);
create index if not exists iso_audit_members_user_idx on iso_audit_members(user_uid);

-- ── 3. RLS: enabled, zero policies, explicit revoke (plan §4.4) ─────────────────
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'iso_standards','iso_standard_versions','iso_clause_sections','iso_library_requirements',
      'iso_config','iso_counters','iso_audits','iso_templates','iso_audit_standards','iso_audit_units',
      'iso_audit_members','iso_requirements','iso_relationships','iso_comments','iso_activity',
      'iso_saved_views','iso_notifications','iso_import_runs','iso_findings','iso_finding_requirements',
      'iso_actions','iso_action_subtasks','iso_action_reviews','iso_action_links','iso_action_extensions'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

revoke all on sequence iso_activity_id_seq from anon, authenticated;

-- ── 4. Append-only iso_activity, no-hard-delete everywhere else ────────────────
create or replace function iso_activity_append_only() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  raise exception 'iso_activity is append-only';
end;
$$;
drop trigger if exists iso_activity_no_update_delete on iso_activity;
create trigger iso_activity_no_update_delete
  before update or delete on iso_activity
  for each row execute function iso_activity_append_only();

drop trigger if exists iso_activity_no_truncate on iso_activity;
create trigger iso_activity_no_truncate
  before truncate on iso_activity
  for each statement execute function iso_activity_append_only();

create or replace function iso_no_hard_delete() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  raise exception 'ISO records are archived, never deleted (table %)', TG_TABLE_NAME;
end;
$$;
-- Every substantive audit-trail-bearing table except: iso_saved_views, iso_notifications (plan
-- §4.4's own exceptions), and the pure join/membership tables — iso_audit_standards,
-- iso_audit_members, iso_finding_requirements — whose whole purpose is to be added and removed
-- (member.remove, finding.unlinkRequirement are real ops) and which have a composite primary key
-- rather than an `id` column, so a generic "no.id" trigger cannot apply to them regardless.
-- iso_standards (keyed by `code`, seeded once, never deleted by the app) is excluded for the same
-- structural reason. iso_config/iso_counters are internal bookkeeping, not audit records.
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'iso_standard_versions','iso_clause_sections','iso_library_requirements',
      'iso_audits','iso_templates','iso_audit_units',
      'iso_requirements','iso_relationships','iso_comments','iso_import_runs','iso_findings',
      'iso_actions','iso_action_subtasks','iso_action_reviews',
      'iso_action_links','iso_action_extensions'
    ])
  loop
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function iso_no_hard_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- Immutable library: reject UPDATE on iso_library_requirements once its version is approved.
create or replace function iso_library_requirements_immutable() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_status text;
begin
  select status into v_status from iso_standard_versions where id = old.version_id;
  if v_status = 'approved' then
    raise exception 'cannot edit a library requirement whose version is approved';
  end if;
  return new;
end;
$$;
drop trigger if exists iso_library_requirements_immutable_trg on iso_library_requirements;
create trigger iso_library_requirements_immutable_trg
  before update on iso_library_requirements
  for each row execute function iso_library_requirements_immutable();

-- ── 5. Numbering (plan §8) ───────────────────────────────────────────────────────
create or replace function iso_next_number(p_scope text) returns int
language sql security invoker set search_path = public as $$
  insert into iso_counters(scope, next_value) values (p_scope, 2)
  on conflict (scope) do update set next_value = iso_counters.next_value + 1
  returning next_value - 1;
$$;

-- lpad(n::text, 3, '0') truncates n=1000 to '100' and collides — pad to at least 3 but never less
-- than the number's own width.
create or replace function iso_pad_number(n int, min_width int default 3) returns text
language sql immutable as $$
  select lpad(n::text, greatest(min_width, length(n::text)), '0');
$$;

create or replace function iso_config_timezone() returns text
language sql stable security invoker set search_path = public as $$
  select coalesce((select value #>> '{}' from iso_config where key = 'timezone'), 'Australia/Perth');
$$;

-- ── 6. Atomic create/update/transition functions (plan §4.4) ───────────────────
-- Every create/update/transition writes the row AND its iso_activity entry in one transaction.

create or replace function iso_log(
  p_audit_id text, p_client_id text, p_entity_type text, p_entity_id text, p_entity_ref text,
  p_action text, p_field text, p_before jsonb, p_after jsonb, p_reason text,
  p_source text, p_actor_uid text, p_actor_kind text
) returns bigint
language sql security invoker set search_path = public as $$
  insert into iso_activity(audit_id, client_id, entity_type, entity_id, entity_ref, action, field,
    before, after, reason, source, actor_uid, actor_kind)
  values (p_audit_id, p_client_id, p_entity_type, p_entity_id, p_entity_ref, p_action, p_field,
    p_before, p_after, p_reason, p_source, p_actor_uid, p_actor_kind)
  returning id;
$$;

create or replace function iso_create_audit(
  p_id text, p_client_id text, p_title text, p_audit_type text, p_owner_uid text,
  p_visibility text, p_actor_uid text
) returns iso_audits
language plpgsql security invoker set search_path = public as $$
declare v_ref text; v_year text; v_row iso_audits;
begin
  v_year := to_char((now() at time zone iso_config_timezone()), 'YYYY');
  v_ref := 'AUD-' || v_year || '-' || iso_pad_number(iso_next_number('AUD-' || v_year));
  insert into iso_audits(id, ref, client_id, title, audit_type, owner_uid, visibility, created_by, updated_by)
  values (p_id, v_ref, p_client_id, p_title, coalesce(p_audit_type, 'gap_analysis'), p_owner_uid,
    coalesce(p_visibility, 'all_internal'), p_actor_uid, p_actor_uid)
  returning * into v_row;
  perform iso_log(v_row.id, v_row.client_id, 'audit', v_row.id, v_row.ref, 'created', null, null,
    to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

create or replace function iso_create_finding(
  p_id text, p_audit_id text, p_client_id text, p_classification text, p_title text, p_actor_uid text
) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_ref text; v_audit_ref text; v_row iso_findings;
begin
  select ref into v_audit_ref from iso_audits where id = p_audit_id;
  if v_audit_ref is null then raise exception 'unknown audit %', p_audit_id; end if;
  v_ref := v_audit_ref || '-F' || iso_pad_number(iso_next_number(p_audit_id || ':F'));
  insert into iso_findings(id, ref, audit_id, client_id, classification, title, root_cause_required, created_by, updated_by)
  values (p_id, v_ref, p_audit_id, p_client_id, p_classification, p_title, p_classification = 'major_nc', p_actor_uid, p_actor_uid)
  returning * into v_row;
  perform iso_log(p_audit_id, p_client_id, 'finding', v_row.id, v_row.ref, 'created', null, null,
    to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

create or replace function iso_create_action(
  p_id text, p_audit_id text, p_client_id text, p_title text, p_owner_kind text, p_actor_uid text
) returns iso_actions
language plpgsql security invoker set search_path = public as $$
declare v_ref text; v_audit_ref text; v_row iso_actions;
begin
  select ref into v_audit_ref from iso_audits where id = p_audit_id;
  if v_audit_ref is null then raise exception 'unknown audit %', p_audit_id; end if;
  v_ref := v_audit_ref || '-A' || iso_pad_number(iso_next_number(p_audit_id || ':A'));
  insert into iso_actions(id, ref, audit_id, client_id, title, owner_kind, created_by, updated_by)
  values (p_id, v_ref, p_audit_id, p_client_id, p_title, coalesce(p_owner_kind, 'etcher'), p_actor_uid, p_actor_uid)
  returning * into v_row;
  perform iso_log(p_audit_id, p_client_id, 'action', v_row.id, v_row.ref, 'created', null, null,
    to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- Generic authenticated update with a hard-coded per-table column allowlist (plan §4.4). Never
-- allows id/audit_id/client_id/ref/created_*/row_version/standard_code/library_requirement_id/
-- the frozen requirement copy/storage_path/uploaded_by — status/verification/visibility columns
-- change only through the dedicated transition functions below.
-- A80: the op's own activity description (entity, ref, action, field, reason, source) comes in as
-- parameters and is logged as given. Before this, every generic update was logged as "<table name>
-- updated" with no field and no reason — so on Supabase a reason-required change (§6.3a) lost its
-- reason, and the drawers' Activity lists (which filter on entity_type requirement / finding /
-- action) never showed an update. The defaults keep the six-argument call working; the drop means an
-- older six-argument copy can never sit beside this one as an ambiguous overload.
drop function if exists iso_update_row(text, text, jsonb, int, text, text);
create or replace function iso_update_row(
  p_table text, p_id text, p_patch jsonb, p_expected_version int, p_actor_uid text, p_actor_kind text,
  p_entity_type text default null, p_entity_id text default null, p_entity_ref text default null,
  p_action text default null, p_field text default null, p_reason text default null, p_source text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_allowed text[];
  v_key text;
  v_cols text;
  v_before jsonb;
  v_after jsonb;
  v_audit_id text;
  v_client_id text;
  v_rows int;
begin
  v_allowed := case p_table
    -- A44: this switch had no case at all for iso_audits, even though audit.update/setAccess/
    -- archive (api/_iso.js, all written in Phase 3) all patch iso_audits through this exact
    -- generic path — every one of those three ops would have raised "no editable columns" the
    -- moment this migration ever ran for real. Never caught by iso-dbsb-unit-test since that
    -- suite mocks fetch and only checks the RPC call shape, never this function's own body; found
    -- by inspection while adding iso_action_subtasks' case below, not by any test failing.
    when 'iso_audits' then array['title','audit_type','custom_type_label','scope_text','exclusions_text',
      'planned_start','planned_end','report_due','certification_body','lead_auditor_uid','internal_notes',
      'stage','client_portal_enabled','default_visibility','visibility','archived_at',
      'completed_at','maintenance_due']
    -- visibility/visible_to_uids included here for both tables (plan §14 A37): the plan's own
    -- prose above says these change "only through the dedicated transition functions", but
    -- Phase 6 already shipped requirement.update patching them through this generic path (no
    -- per-record requirement-visibility transition function exists, and building one just to
    -- match the prose — for a value this migration itself has never been applied to verify —
    -- would be new, untested surface for no behavioural gain); Phase 7.2's finding.update follows
    -- the same already-established precedent rather than inventing a second pattern.
    -- The assessment columns themselves (state, result, level, effectiveness, assessed_at/by) were
    -- missing here, so once applied every requirement.update that recorded an assessment would have
    -- raised "column … is not editable" — found 2026-10-03 adding D32's senior-review columns, and now
    -- pinned by iso-dbsb-unit-test's static check against api/_iso.js's own writable-field lists.
    -- compliance_status/approval_state/approved_by/approved_at/return_note added D35/R2 (2026-10-05):
    -- one status field replaces applicability/assessment_state/assessment_result/effectiveness for
    -- the client-writable surface (those four stay below, retired — api/_iso.js derives them from
    -- compliance_status on every write so nothing that still reads them needs to change); the new
    -- approval_state/approved_by/approved_at/return_note sit alongside the untouched D32
    -- senior_review_* fields, a separate, independent mechanism.
    when 'iso_requirements' then array['applicability','na_justification','unit_ids','audit_question',
      'current_system','evidence_expected','interview_notes','sampling_details','auditor_observations',
      'assessment_state','assessment_result','implementation_level','effectiveness','assessed_at','assessed_by',
      'compliance_status','approval_state','approved_by','approved_at','return_note',
      'ofi','ofi_note','gap_reason','derived_from_id','derived_at',
      'gap_description','gap_category','current_controls','impact','risk_severity','recommended_action',
      'responsible_uid','target_date','verification_requirements','internal_notes','client_visible_comment',
      'sort_key','visibility','visible_to_uids',
      'senior_review_status','senior_review_note','senior_reviewed_by','senior_reviewed_at']
    when 'iso_findings' then array['title','statement','criteria','evidence_basis','classification','visibility','visible_to_uids']
    -- auditor_review_note, visibility and visible_to_uids added 2026-10-03: action.update writes all
    -- three (ACTION_WRITABLE_FIELDS) and they were missing, the same gap as iso_requirements above.
    when 'iso_actions' then array['title','description','owner_uid','start_date','due_date','priority',
      'risk_rating','progress','verification_requirements','client_response','auditor_review_note','correction','containment',
      'root_cause_method','five_whys','fishbone','cause_tree','contributing_factors','cause_categories',
      'root_cause_summary','corrective_action','preventive_action','effectiveness_check','effectiveness_review_date',
      'visibility','visible_to_uids']
    when 'iso_action_subtasks' then array['title','owner_uid','due_date','done','sort_key','archived_at']
    when 'iso_audit_units' then array['name']
    when 'iso_templates' then array['name','description','config']
    when 'iso_comments' then array['body']
    -- Plan 8b.5 (D20): a reviewer's verdict on one evidence link (table from migration 010; this
    -- function resolves the table name dynamically, so it may name a table created later).
    when 'iso_evidence_links' then array['review_status','role','reviewed_by','reviewed_at','reviewed_version_label','review_comment']
    -- Plan 8b.6: superseding a record, and editing its own descriptive fields.
    when 'iso_evidence' then array['superseded_by','title','description','version_label','evidence_date','owner_uid',
      'confidentiality','visibility','visible_to_uids','review_or_expiry_date','suggest_related',
      'document_status','approver_uid','effective_date']
    else array[]::text[]
  end;
  if array_length(v_allowed, 1) is null then
    raise exception 'iso_update_row: table % has no editable columns', p_table;
  end if;
  if p_expected_version is null then
    raise exception 'expected_version is required';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'column % is not editable on %', v_key, p_table;
    end if;
  end loop;

  select string_agg(quote_ident(k), ',') into v_cols from jsonb_object_keys(p_patch) k;
  if v_cols is null then
    raise exception 'empty patch';
  end if;

  execute format('select to_jsonb(t) from %I t where t.id = %L', p_table, p_id) into v_before;
  if v_before is null then
    raise exception 'not_found';
  end if;

  -- jsonb_populate_record does Postgres's own JSON->column-type casting (text, int, date,
  -- text[], jsonb, boolean, …) against the target row type — building the SET list by hand with
  -- `->` would hand every column a raw jsonb value, which does not implicitly cast to date/int/
  -- text[] and silently corrupts or errors depending on the column.
  execute format(
    'update %I t set (%s) = (select %s from jsonb_populate_record(null::%I, %L)), ' ||
    'updated_at = now(), updated_by = %L, row_version = row_version + 1 ' ||
    'where t.id = %L and t.row_version = %L',
    p_table, v_cols, v_cols, p_table, p_patch, p_actor_uid, p_id, p_expected_version
  );
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  execute format('select audit_id, client_id from %I where id = %L', p_table, p_id) into v_audit_id, v_client_id;
  execute format('select to_jsonb(t) from %I t where t.id = %L', p_table, p_id) into v_after;
  perform iso_log(v_audit_id, v_client_id, coalesce(p_entity_type, p_table), coalesce(p_entity_id, p_id), p_entity_ref,
    coalesce(p_action, 'updated'), p_field, v_before, v_after, p_reason, coalesce(p_source, 'user'), p_actor_uid, p_actor_kind);
  return v_after;
end;
$$;

-- Import apply: all-or-nothing. p_ops is [{table, id, patch}] built by api/_isoImport.js; on any
-- error the whole apply rolls back (a plpgsql function body is one transaction) and the run is
-- marked failed by the caller. p_backup is the pre-apply snapshot the caller already captured
-- (iso_import_runs.backup) — this function does not compute it, only applies and logs.
create or replace function iso_import_apply(
  p_run_id text, p_ops jsonb, p_actor_uid text
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_op jsonb; v_table text; v_id text; v_patch jsonb; v_before jsonb; v_after jsonb; v_cols text;
  v_has_versioning boolean;
  v_backup jsonb := '[]'::jsonb;
begin
  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_table := v_op ->> 'table';
    v_id := v_op ->> 'id';
    v_patch := v_op -> 'patch';
    if v_table is null or v_id is null or v_patch is null then
      raise exception 'malformed import op: %', v_op;
    end if;
    execute format('select to_jsonb(t) from %I t where t.id = %L', v_table, v_id) into v_before;
    if v_before is null then
      execute format(
        'insert into %I select * from jsonb_populate_record(null::%I, %L)', v_table, v_table, v_patch
      );
    else
      -- Not every imported table carries row_version/updated_at/updated_by (plan Phase 4 gap,
      -- §14 A25): iso_clause_sections and iso_action_links don't, so the version/timestamp bump
      -- only runs where the columns actually exist, checked once per op rather than hardcoded to
      -- the tables Phase 3 already knew about.
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = v_table and column_name = 'row_version'
      ) into v_has_versioning;
      v_cols := (select string_agg(quote_ident(k), ',') from jsonb_object_keys(v_patch) k);
      if v_has_versioning then
        execute format(
          'update %I set updated_at = now(), updated_by = %L, row_version = row_version + 1, (%s) = (select %s from jsonb_populate_record(null::%I, %L)) where id = %L',
          v_table, p_actor_uid, v_cols, v_cols, v_table, v_patch, v_id
        );
      else
        execute format(
          'update %I set (%s) = (select %s from jsonb_populate_record(null::%I, %L)) where id = %L',
          v_table, v_cols, v_cols, v_table, v_patch, v_id
        );
      end if;
    end if;
    execute format('select to_jsonb(t) from %I t where t.id = %L', v_table, v_id) into v_after;
    perform iso_log(v_after ->> 'audit_id', v_after ->> 'client_id', v_table, v_id, null, 'import_applied',
      null, v_before, v_after, null, 'import', p_actor_uid, 'staff');
    -- `backup` on the run row (plan §4.4 "backup makes a manual restore possible") — pre-apply
    -- values of every row this run touches, mirroring the offline adapter's own importApply.
    v_backup := v_backup || jsonb_build_object('table', v_table, 'id', v_id, 'before', v_before);
  end loop;
  update iso_import_runs set status = 'applied', performed_by = p_actor_uid, at = now(), backup = v_backup where id = p_run_id;
end;
$$;

-- ── 7. Transition functions (status/verification/release/close/visibility — plan §6.1-6.2) ─────
-- Allowed action-status transitions live here as data, so both this function and api/_iso.js's
-- own table can be checked against the same source of truth during review.
create or replace function iso_transition_action(
  p_id text, p_to text, p_expected_version int, p_reason text, p_actor_uid text, p_actor_kind text
) returns iso_actions
language plpgsql security invoker set search_path = public as $$
declare v_row iso_actions; v_before jsonb; v_allowed boolean;
begin
  select * into v_row from iso_actions where id = p_id;
  if v_row.id is null then raise exception 'unknown action %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  v_before := to_jsonb(v_row);
  v_allowed := (v_row.status, p_to) in (
    ('draft','assigned'), ('assigned','in_progress'), ('in_progress','awaiting_evidence'),
    ('in_progress','submitted_for_review'), ('awaiting_evidence','submitted_for_review'),
    ('submitted_for_review','more_info_required'), ('submitted_for_review','ready_for_verification'),
    ('more_info_required','submitted_for_review'), ('ready_for_verification','verified'),
    ('verified','closed'),
    (v_row.status,'on_hold')
  );
  -- A40: resuming from on_hold is only ever allowed back to the exact status it was paused from —
  -- v_row.status is 'on_hold' at this point, so a bare (v_row.status, p_to) pair can never encode
  -- this (that was the original bug: ('on_hold', v_row.status) always meant ('on_hold','on_hold')).
  if v_row.status = 'on_hold' and p_to = v_row.on_hold_from_status then
    v_allowed := true;
  end if;
  if not v_allowed then
    raise exception 'cannot move action from % to %', v_row.status, p_to;
  end if;
  -- Major-NC gate: cannot pass submitted_for_review without a real root cause (plan §6.2).
  if v_row.status = 'submitted_for_review' and p_to = 'ready_for_verification' then
    if exists (select 1 from iso_findings f join iso_finding_requirements fr on fr.finding_id = f.id
               join iso_action_links al on al.target_type = 'finding' and al.target_id = f.id
               where al.action_id = p_id and f.classification = 'major_nc')
      and (v_row.root_cause_summary is null or char_length(v_row.root_cause_summary) < 40 or v_row.root_cause_method = 'none'
           or v_row.cause_categories = '{}')
    then
      raise exception 'a major nonconformity needs a real root cause before verification';
    end if;
  end if;
  update iso_actions set status = p_to,
      on_hold_from_status = case when p_to = 'on_hold' then v_row.status else null end,
      updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'action', p_id, v_row.ref, 'status_changed', 'status',
    v_before, to_jsonb(v_row), p_reason, 'user', p_actor_uid, p_actor_kind);
  return v_row;
end;
$$;

create or replace function iso_verify_action(
  p_id text, p_result text, p_notes text, p_expected_version int, p_actor_uid text
) returns iso_actions
language plpgsql security invoker set search_path = public as $$
declare v_row iso_actions; v_before jsonb; v_new_status text;
begin
  select * into v_row from iso_actions where id = p_id;
  if v_row.id is null then raise exception 'unknown action %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if p_result not in ('effective','ineffective') then raise exception 'invalid verification result %', p_result; end if;
  v_before := to_jsonb(v_row);
  v_new_status := case when p_result = 'ineffective' then 'in_progress' else v_row.status end;
  update iso_actions set verification_status = p_result, verification_notes = p_notes, verified_by = p_actor_uid,
    verified_at = now(), status = v_new_status, updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'action', p_id, v_row.ref, 'verified', 'verification_status',
    v_before, to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- Reopen a verified/closed action (plan §6.2 — reason required, increments reopened_count).
create or replace function iso_reopen_action(
  p_id text, p_reason_code text, p_reason_text text, p_expected_version int, p_actor_uid text
) returns iso_actions
language plpgsql security invoker set search_path = public as $$
declare v_row iso_actions; v_before jsonb;
begin
  select * into v_row from iso_actions where id = p_id;
  if v_row.id is null then raise exception 'unknown action %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if v_row.status not in ('verified','closed') then raise exception 'only a verified or closed action can be reopened'; end if;
  if p_reason_code is null then raise exception 'a reason is required to reopen an action'; end if;
  v_before := to_jsonb(v_row);
  update iso_actions set status = 'in_progress', reopened_count = reopened_count + 1,
    updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'action', p_id, v_row.ref, 'reopened', 'status',
    v_before, to_jsonb(v_row), coalesce(p_reason_code,'') || case when p_reason_text is not null then ': ' || p_reason_text else '' end,
    'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

create or replace function iso_release_finding(p_id text, p_expected_version int, p_actor_uid text) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_row iso_findings; v_before jsonb;
begin
  select * into v_row from iso_findings where id = p_id;
  if v_row.id is null then raise exception 'unknown finding %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if v_row.status <> 'draft' then raise exception 'only a draft finding can be released for review'; end if;
  v_before := to_jsonb(v_row);
  update iso_findings set status = 'released_for_review', released_at = now(), released_by = p_actor_uid,
    updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'finding', p_id, v_row.ref, 'released', 'status',
    v_before, to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- iso_finalize_finding / iso_close_finding / iso_withdraw_finding (plan Phase 7.2) — the same
-- one-function-per-verb shape as iso_release_finding above (not a generic iso_transition_finding):
-- release/close each set their own extra timestamp+actor columns, so folding all four into one
-- parameterised function would need the same to-state branch this file's own iso_transition_action
-- already avoids by being action-status-specific. Written and reviewed by hand, never applied or
-- run against a real Postgres instance (plan hard rule 1 / STOP 1's standing caveat) — same as
-- everything else in this migration.
create or replace function iso_finalize_finding(p_id text, p_expected_version int, p_actor_uid text) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_row iso_findings; v_before jsonb;
begin
  select * into v_row from iso_findings where id = p_id;
  if v_row.id is null then raise exception 'unknown finding %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if v_row.status <> 'released_for_review' then raise exception 'only a released-for-review finding can be finalised'; end if;
  v_before := to_jsonb(v_row);
  update iso_findings set status = 'final', updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'finding', p_id, v_row.ref, 'final', 'status',
    v_before, to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

create or replace function iso_close_finding(p_id text, p_expected_version int, p_actor_uid text) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_row iso_findings; v_before jsonb;
begin
  select * into v_row from iso_findings where id = p_id;
  if v_row.id is null then raise exception 'unknown finding %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  -- B2.3: the app checks first that every linked action is closed and verified effective (D50).
  if v_row.status not in ('final','reopened') then raise exception 'only a finalised or reopened finding can be closed'; end if;
  v_before := to_jsonb(v_row);
  update iso_findings set status = 'closed', closed_at = now(), closed_by = p_actor_uid,
    updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'finding', p_id, v_row.ref, 'closed', 'status',
    v_before, to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- Release-1 B2.4: the Lead reopens a closed finding with a reason (the action reopen reasons).
create or replace function iso_reopen_finding(
  p_id text, p_reason_code text, p_reason_text text, p_expected_version int, p_actor_uid text
) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_row iso_findings; v_before jsonb;
begin
  select * into v_row from iso_findings where id = p_id;
  if v_row.id is null then raise exception 'unknown finding %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if v_row.status <> 'closed' then raise exception 'only a closed finding can be reopened'; end if;
  if p_reason_code is null then raise exception 'a reason is required to reopen a finding'; end if;
  v_before := to_jsonb(v_row);
  update iso_findings set status = 'reopened', reopened_count = reopened_count + 1,
    reopen_reason = p_reason_code || case when p_reason_text is not null then ': ' || p_reason_text else '' end,
    closed_at = null, closed_by = null, updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'finding', p_id, v_row.ref, 'reopened', 'status',
    v_before, to_jsonb(v_row), v_row.reopen_reason, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- Withdrawable from draft or released_for_review only — a finalised or closed finding needs its
-- own reopen-style mechanism instead (plan §14 A38), not silently allowed here.
create or replace function iso_withdraw_finding(p_id text, p_expected_version int, p_actor_uid text) returns iso_findings
language plpgsql security invoker set search_path = public as $$
declare v_row iso_findings; v_before jsonb;
begin
  select * into v_row from iso_findings where id = p_id;
  if v_row.id is null then raise exception 'unknown finding %', p_id; end if;
  if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  if v_row.status not in ('draft', 'released_for_review') then raise exception 'only a draft or released-for-review finding can be withdrawn'; end if;
  v_before := to_jsonb(v_row);
  update iso_findings set status = 'withdrawn', updated_at = now(), updated_by = p_actor_uid, row_version = row_version + 1
    where id = p_id returning * into v_row;
  perform iso_log(v_row.audit_id, v_row.client_id, 'finding', p_id, v_row.ref, 'withdrawn', 'status',
    v_before, to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- ── 8. Function lockdown (plan §4.4) ────────────────────────────────────────────
do $$
declare sig text;
begin
  for sig in select unnest(array[
    'iso_activity_append_only()', 'iso_no_hard_delete()', 'iso_library_requirements_immutable()',
    'iso_next_number(text)', 'iso_pad_number(int,int)', 'iso_config_timezone()',
    'iso_log(text,text,text,text,text,text,text,jsonb,jsonb,text,text,text,text)',
    'iso_create_audit(text,text,text,text,text,text,text)',
    'iso_create_finding(text,text,text,text,text,text)',
    'iso_create_action(text,text,text,text,text,text)',
    'iso_update_row(text,text,jsonb,int,text,text,text,text,text,text,text,text,text)',
    'iso_import_apply(text,jsonb,text)',
    'iso_transition_action(text,text,int,text,text,text)',
    'iso_verify_action(text,text,text,int,text)',
    'iso_reopen_action(text,text,text,int,text)',
    'iso_release_finding(text,int,text)',
    'iso_finalize_finding(text,int,text)',
    'iso_close_finding(text,int,text)',
    'iso_withdraw_finding(text,int,text)',
    'iso_reopen_finding(text,text,text,int,text)'
  ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

-- ── 9. Seed data ─────────────────────────────────────────────────────────────────
insert into iso_standards (code, name, title, system_abbrev, badge, color, active) values
  ('9001',  'ISO 9001',  'Quality Management System',                       'QMS', 'Q', '#1d6fb8', true),
  ('14001', 'ISO 14001', 'Environmental Management System',                 'EMS', 'E', '#0d6e4e', true),
  ('45001', 'ISO 45001', 'Occupational Health and Safety Management System','OHS', 'S', '#b45309', true)
on conflict (code) do nothing;

insert into iso_config (key, value) values
  ('finding_classifications', '["major_nc","minor_nc","observation","ofi"]'::jsonb),
  ('gap_categories', '["documentation","implementation","effectiveness","evidence","competence_awareness","resources","other"]'::jsonb),
  ('fishbone_categories', '["People","Method","Machine/Equipment","Materials","Measurement","Environment"]'::jsonb),
  ('number_prefixes', '{"audit":"AUD","finding":"F","action":"A","evidence":"E","report":"R"}'::jsonb),
  ('timezone', '"Australia/Perth"'::jsonb),
  ('evidence_max_upload_mb', '10'::jsonb)
on conflict (key) do nothing;

-- ── 10. Storage (informational — the bucket itself is created in 010_iso_evidence.sql) ─────────
-- Evidence uploads (plan D18, §4.7, §5.4) go to a private bucket `iso-evidence`, separate from
-- `task-files`. Not created here: evidence.uploadUrl doesn't exist until Phase 8, and creating an
-- unused bucket now would be dead infrastructure. See 010_iso_evidence.sql.

-- ── Check (read-only) ────────────────────────────────────────────────────────────
--   a) every iso_* table has RLS on and no policies:
--        select relname, relrowsecurity from pg_class
--        where relname like 'iso_%' and relkind = 'r' order by 1;
--        select tablename, count(*) from pg_policies where tablename like 'iso_%' group by 1;
--        -- (should be zero rows from the second query)
--   b) anon/authenticated have no table privileges:
--        select table_name, grantee, privilege_type from information_schema.role_table_grants
--        where table_name like 'iso_%' and grantee in ('anon','authenticated');
--        -- (should be zero rows)
--   c) no iso_* function is executable by anon/authenticated:
--        select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--               has_function_privilege('anon', p.oid, 'execute') as anon_exec
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and p.proname like 'iso_%';
--        -- (auth_exec and anon_exec must be false for every row)
--   d) seed rows present:
--        select code, name from iso_standards order by code;
--        select key from iso_config order by key;
--   e) append-only / no-hard-delete actually raise:
--        (run as service role) delete from iso_activity where id = -1;  -- expect "append-only" error
--        (run as service role) delete from iso_audits where id = 'does-not-exist';  -- expect "archived, never deleted" error (0 rows affected either way, but the trigger only fires on an actual matched row — test against a real seeded row in a throwaway transaction, then rollback)

-- ── Rollback ─────────────────────────────────────────────────────────────────────
--   drop table if exists iso_action_extensions, iso_action_links, iso_action_reviews,
--     iso_action_subtasks, iso_actions, iso_finding_requirements, iso_findings, iso_import_runs,
--     iso_notifications, iso_saved_views, iso_activity, iso_comments, iso_relationships,
--     iso_requirements, iso_audit_members, iso_audit_units, iso_audit_standards, iso_templates,
--     iso_audits, iso_counters, iso_config, iso_library_requirements, iso_clause_sections,
--     iso_standard_versions, iso_standards cascade;
--   drop function if exists iso_release_finding, iso_reopen_finding, iso_reopen_action, iso_verify_action,
--     iso_transition_action, iso_import_apply, iso_update_row, iso_create_action,
--     iso_create_finding, iso_create_audit, iso_log, iso_config_timezone, iso_pad_number,
--     iso_next_number, iso_library_requirements_immutable, iso_no_hard_delete,
--     iso_activity_append_only cascade;
