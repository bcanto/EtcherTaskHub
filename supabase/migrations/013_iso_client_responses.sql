-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO client responses (release-1 B7, plan Phase 13 / §5.6)
-- Migration: 013_iso_client_responses.sql
--
-- WRITTEN, NEVER APPLIED (hard rule 1). Depends on 009. Same conventions as 009–015: RLS enabled
-- with zero policies plus an explicit revoke (service role only), no hard delete, every write
-- logged to iso_activity by the app.
--
--   iso_client_responses — what a client sends back from the portal. B7 uses it per issued report
--   (the approved portal concept: "It is accurate" or "Something needs correcting", plus an
--   optional management response). The per-finding columns of §5.6 are here too, unused for now,
--   so per-finding responses need no second migration. The auditor decides each one (accepted or
--   rejected, with a note the client sees); the client never changes a conclusion.
--
-- Safe to run more than once (every CREATE is IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists iso_client_responses (
  id                         text primary key,
  audit_id                   text not null references iso_audits(id),
  client_id                  text not null,
  report_version_id          text,                 -- B7: the issued report version answered
  finding_id                 text,                 -- §5.6: a per-finding response (later)
  respondent_uid             text not null,
  respondent_name            text,
  -- factual accuracy
  factual_status             text check (factual_status in ('confirmed','disputed')),
  factual_comment            text,
  suggested_corrections      text,
  -- management response
  position                   text check (position in ('accepted','disputed')),
  management_response        text,
  proposed_correction        text,
  proposed_root_cause        text,
  proposed_corrective_action text,
  responsible_manager        text,
  proposed_due_date          date,
  resources_required         text,
  extension_requested_due    date,
  extension_reason           text,
  -- the auditor's decision
  status                     text not null default 'submitted' check (status in ('submitted','under_review','accepted','rejected')),
  auditor_decision           text,
  auditor_decision_note      text,
  decided_by                 text,
  decided_at                 timestamptz,
  original_wording           text,
  final_wording              text,
  row_version                int not null default 1,
  archived_at                timestamptz,
  created_at                 timestamptz not null default now()
);
create index if not exists iso_client_responses_audit_idx on iso_client_responses(audit_id, created_at);

alter table iso_client_responses enable row level security;
revoke all on table iso_client_responses from anon, authenticated;

-- Archived, never deleted (009's iso_no_hard_delete).
drop trigger if exists iso_client_responses_no_delete on iso_client_responses;
create trigger iso_client_responses_no_delete before delete on iso_client_responses
  for each row execute function iso_no_hard_delete();

-- ── Check (read-only) ──────────────────────────────────────────────────────────
-- select relrowsecurity from pg_class where relname = 'iso_client_responses';   -- expect true
-- select count(*) from pg_policies where tablename = 'iso_client_responses';     -- expect 0
