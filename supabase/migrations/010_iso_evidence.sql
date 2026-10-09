-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO Audit evidence schema
-- Migration: 010_iso_evidence.sql (plan §5.4, Phase 8)
--
-- WRITTEN, NEVER APPLIED (hard rule 1 — no SQL is ever run directly against Supabase from this
-- session). Extends 009_iso_core.sql with the three evidence tables, the upload reservations
-- (plan 8.2) and their own numbered-create function, following every convention 009 already established: RLS enabled with zero policies
-- plus an explicit revoke (service role only, bypasses RLS), no-hard-delete via trigger, append-
-- only activity logging through the existing iso_log()/iso_next_number()/iso_pad_number() helpers
-- (009, section 5/6 — not redefined here).
--
-- Safe to run more than once (every CREATE is IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tables (plan §5.4) ────────────────────────────────────────────────────

create table if not exists iso_evidence (
  id                     text primary key,
  ref                    text not null,                        -- '<audit ref>-E001'
  audit_id               text not null references iso_audits(id),
  client_id              text not null,
  kind                   text not null check (kind in
                           ('file','link','sharepoint','photo','meeting_note','interview','observation','sample',
                            'policy_ref','procedure_ref','note')),
  title                  text not null,
  description            text,
  -- Release-1 B1.7 (2026-10-06): what a 'sample' note sampled.
  sample_population      integer check (sample_population >= 0),
  sample_size            integer check (sample_size >= 0),
  sample_exceptions      text,
  -- File fields (Phase 8.2, unused by 8.2a's link-only flow — all nullable, populated together).
  storage_path           text,
  original_filename      text,
  mime                    text,
  size_bytes             bigint,
  -- Link/SharePoint fields (Phase 8.2a). normalizeLinkUrl + a credentials check (api/_iso.js) gate
  -- what ever reaches this column — see A59.
  url                    text,
  -- No FK in 010 — iso_documents arrives in migration 012, which adds this constraint `not valid`
  -- (plan §5.4's own note) so a 012 rollout never has to repair historic rows retroactively.
  document_id            text,
  version_label          text,
  evidence_date          date,
  owner_uid              text,
  confidentiality        text not null default 'normal' check (confidentiality in ('normal','restricted')),
  visibility             text not null default 'internal' check (visibility in
                           ('internal','client_selected','client_all','after_approval','report_only')),
  visible_to_uids        text[] not null default '{}',
  superseded_by          text references iso_evidence(id),
  review_or_expiry_date  date,
  -- Plan 8b.4 (D21): false = "use for this requirement only" — never offered as a suggestion for
  -- related requirements.
  suggest_related        boolean not null default true,
  -- Plan 8.2 / 8c.5 (D22): an uploaded document's own status. Draft by default — an upload never
  -- implies approval; a later change to it is a logged edit (iso_update_row's iso_evidence case).
  document_status        text not null default 'draft' check (document_status in ('draft','approved','superseded','obsolete')),
  approver_uid           text,
  effective_date         date,
  uploaded_by            text,
  uploaded_via           text not null default 'staff' check (uploaded_via in ('staff','portal','import')),
  -- Phase 9b (D31): last year's accepted evidence, copied to the maintenance board unlinked and offered
  -- as a suggestion for the clauses it was accepted for (carry_target_ids) — never auto-accepted.
  carried_from_ref       text,
  carry_target_ids       text[] not null default '{}',
  row_version            int not null default 1,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  created_by             text,
  updated_at             timestamptz not null default now(),
  updated_by             text,
  unique (audit_id, ref),
  -- A link/SharePoint/note-kind record carries no file bytes; a file/photo-kind record must have
  -- a real storage_path. Mirrors the app-level distinction D18 draws between the two flows.
  constraint iso_evidence_link_kinds_no_storage_ck check (
    kind not in ('link','sharepoint','meeting_note','interview','sample','policy_ref','procedure_ref','note')
    or storage_path is null
  )
);

-- Acceptance is per link (plan §5.4): one file can be accepted for one requirement and still
-- under review for another, so review state lives here, not on iso_evidence itself.
create table if not exists iso_evidence_links (
  id                      text primary key,
  evidence_id             text not null references iso_evidence(id),
  audit_id                text not null references iso_audits(id),
  client_id               text not null,
  target_type             text not null check (target_type in ('requirement','finding','action')),
  target_id               text not null,
  -- Plan 8b.4 (D20): what this evidence does for THIS target, and why it was linked.
  role                    text not null default 'primary' check (role in ('primary','supporting')),
  relevance_note          text,
  -- Plan 8b.5 (D20): one reviewer verdict per link. `submitted` = "Not reviewed". `requested` was
  -- dropped (evidence requests have their own table); partially_sufficient / insufficient folded in
  -- from the brief's separate "sufficiency" field so a link can never be accepted AND insufficient.
  review_status           text not null default 'submitted' check (review_status in
                            ('submitted','under_review','more_info_required','accepted',
                             'partially_sufficient','insufficient','rejected','superseded')),
  reviewed_by             text,
  reviewed_at             timestamptz,
  reviewed_version_label  text,
  review_comment          text,
  row_version             int not null default 1,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  created_by              text,
  updated_at              timestamptz not null default now(),
  updated_by              text,
  unique (evidence_id, target_type, target_id)
);

create table if not exists iso_evidence_requests (
  id                 text primary key,
  audit_id           text not null references iso_audits(id),
  client_id          text not null,
  target_type        text not null check (target_type in ('requirement','finding','action')),
  target_id          text not null,
  description        text,
  requested_from_uid text,
  due_date           date,
  status             text not null default 'open' check (status in ('open','submitted','closed')),
  row_version        int not null default 1,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

-- Plan 8.2: an upload reservation. evidence.uploadUrl writes one — the evidence id and the storage
-- path are chosen here, never by the client — and evidence.register consumes it. A reservation is
-- closed (closed_at + close_reason) rather than deleted: registered, refused (the object failed the
-- size/type checks and was removed) or expired (2 hours; removed on the caller's next uploadUrl).
-- `details` holds the form's fields (title, revision, date, confidentiality, role, note, only-here)
-- so register needs nothing but the evidence id.
create table if not exists iso_evidence_uploads (
  id                 text primary key,
  evidence_id        text not null unique,
  audit_id           text not null references iso_audits(id),
  client_id          text not null,
  target_type        text not null check (target_type in ('requirement','finding','action')),
  target_id          text not null,
  storage_path       text not null unique,          -- <client>/<audit>/<evidence>/<random16>.<ext>
  original_filename  text not null check (char_length(original_filename) <= 200),
  ext                text not null,
  declared_mime      text not null,
  declared_size      bigint not null check (declared_size > 0 and declared_size <= 26214400),
  details            jsonb not null default '{}',
  reserved_by        text not null,
  expires_at         timestamptz not null,
  closed_at          timestamptz,
  close_reason       text check (close_reason in ('registered','refused','expired')),
  created_at         timestamptz not null default now()
);

-- ── 2. Indexes (plan §5, mirrors 009's own findings/actions indexes) ────────────

create index if not exists iso_evidence_client_audit_idx      on iso_evidence(client_id, audit_id);
create index if not exists iso_evidence_audit_archived_idx    on iso_evidence(audit_id, archived_at);
create index if not exists iso_evidence_visibility_idx        on iso_evidence(visibility);
create index if not exists iso_evidence_links_evidence_idx    on iso_evidence_links(evidence_id);
create index if not exists iso_evidence_links_target_idx      on iso_evidence_links(target_type, target_id);
create index if not exists iso_evidence_links_review_idx      on iso_evidence_links(review_status);
create index if not exists iso_evidence_requests_audit_idx    on iso_evidence_requests(audit_id, status);
create index if not exists iso_evidence_requests_target_idx   on iso_evidence_requests(target_type, target_id);
create index if not exists iso_evidence_uploads_open_idx      on iso_evidence_uploads(reserved_by) where closed_at is null;
create index if not exists iso_evidence_uploads_audit_idx     on iso_evidence_uploads(audit_id);

-- ── 3. RLS: enabled, zero policies, explicit revoke (plan §4.4, same as 009 section 3) ──────────

do $$
declare t text;
begin
  for t in
    select unnest(array['iso_evidence','iso_evidence_links','iso_evidence_requests','iso_evidence_uploads'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- ── 4. No-hard-delete (plan §5.4: "Evidence is never hard-deleted in release 1") ────────────────
-- iso_no_hard_delete() is defined in 009 (section 4) and reused here unchanged. All three tables
-- have a real `id` primary key, unlike 009's join tables, so the generic trigger applies cleanly
-- to all of them, including iso_evidence_requests (a request being closed/superseded is a status
-- change, not a deletion — kept consistent with every other audit-trail-bearing table here).
-- iso_evidence_uploads is deliberately NOT here: plan §4.4 lists upload reservations among the
-- tables that may be cleaned up, and nothing in the audit trail points at one.

do $$
declare t text;
begin
  for t in
    select unnest(array['iso_evidence','iso_evidence_links','iso_evidence_requests'])
  loop
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function iso_no_hard_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- ── 5. Numbered create function (plan §4.1a/§8, mirrors 009's iso_create_finding/iso_create_action) ──

-- Plan 8.2: the file columns and (8c.5, D22) the document fields come in as optional parameters,
-- so a link keeps the short call. Dropped first so an older signature can never sit beside this
-- one as an ambiguous overload (same as A80's iso_update_row).
drop function if exists iso_create_evidence(text,text,text,text,text,text,text,text,date,text,text,text,text,text,text,boolean);
create or replace function iso_create_evidence(
  p_id text, p_audit_id text, p_client_id text, p_kind text, p_title text, p_description text,
  p_url text, p_version_label text, p_evidence_date date, p_owner_uid text, p_confidentiality text,
  p_visibility text, p_uploaded_by text, p_uploaded_via text, p_actor_uid text,
  p_suggest_related boolean default true,
  p_storage_path text default null, p_original_filename text default null, p_mime text default null, p_size_bytes bigint default null,
  p_document_status text default null, p_approver_uid text default null, p_effective_date date default null
) returns iso_evidence
language plpgsql security invoker set search_path = public as $$
declare v_ref text; v_audit_ref text; v_row iso_evidence;
begin
  select ref into v_audit_ref from iso_audits where id = p_audit_id;
  if v_audit_ref is null then raise exception 'unknown audit %', p_audit_id; end if;
  v_ref := v_audit_ref || '-E' || iso_pad_number(iso_next_number(p_audit_id || ':E'));
  insert into iso_evidence(id, ref, audit_id, client_id, kind, title, description, url, version_label,
    evidence_date, owner_uid, confidentiality, visibility, uploaded_by, uploaded_via, suggest_related,
    storage_path, original_filename, mime, size_bytes, document_status, approver_uid, effective_date, created_by, updated_by)
  values (p_id, v_ref, p_audit_id, p_client_id, p_kind, p_title, p_description, p_url, p_version_label,
    p_evidence_date, p_owner_uid, coalesce(p_confidentiality, 'normal'), coalesce(p_visibility, 'internal'),
    coalesce(p_uploaded_by, p_actor_uid), coalesce(p_uploaded_via, 'staff'), coalesce(p_suggest_related, true),
    p_storage_path, p_original_filename, p_mime, p_size_bytes, coalesce(p_document_status, 'draft'), p_approver_uid, p_effective_date,
    p_actor_uid, p_actor_uid)
  returning * into v_row;
  perform iso_log(p_audit_id, p_client_id, 'evidence', v_row.id, v_row.ref, 'created', null, null,
    to_jsonb(v_row), null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- ── 6. Function lockdown (same as 009's: service role only) ─────────────────────────────────
revoke execute on function iso_create_evidence(text,text,text,text,text,text,text,text,date,text,text,text,text,text,text,boolean,text,text,text,bigint,text,text,date) from public, anon, authenticated;
grant execute on function iso_create_evidence(text,text,text,text,text,text,text,text,date,text,text,text,text,text,text,boolean,text,text,text,bigint,text,text,date) to service_role;

-- ── 7. Storage bucket (plan §5.4, 8.2) — notes, run by hand in the same change window ────────
-- Private bucket, 25 MB hard limit (the app enforces iso_config.evidence_max_upload_mb, default
-- 10, below it), only the allowed types. No storage policies for anon/authenticated: every read
-- and write goes through api/iso.js with the service role, by signed URL (upload: one-time, no
-- upsert; download: 120 s, as an attachment). No virus scanning exists — a known limitation.
--
-- insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- values ('iso-evidence', 'iso-evidence', false, 26214400, array[
--   'application/pdf',
--   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
--   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
--   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
--   'text/csv', 'application/vnd.ms-excel', 'text/plain',
--   'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
--   'application/vnd.ms-outlook', 'message/rfc822', 'application/zip', 'application/x-zip-compressed'])
-- on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
--   allowed_mime_types = excluded.allowed_mime_types;
