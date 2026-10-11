-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO formal reports (release-1 B5.2, plan Phase 11 / §5.5, Q11)
-- Migration: 011_iso_reports.sql
--
-- WRITTEN, NEVER APPLIED (hard rule 1). Depends on 009 and 015 (iso_audit_snapshots). Same
-- conventions: RLS enabled with zero policies plus an explicit revoke (service role only).
--
-- Release 1 simplifies §5.5: the PDF is drawn in the browser from the frozen version and downloaded
-- (no storage upload yet), so there is no file_path / file_sha256 step. A version is immutable from
-- the moment it is written; the client's acknowledgement ("received and discussed") is its own
-- insert-only row, so recording it never touches the version.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists iso_reports (
  id               text primary key,
  ref              text not null,                       -- '<board ref>-R001'
  audit_id         text not null references iso_audits(id),
  client_id        text not null,
  kind             text not null check (kind in ('audit','follow_up','maintenance')),
  title            text not null,
  status           text not null default 'draft' check (status in ('draft','issued')),
  config           jsonb not null default '{}'::jsonb,  -- the draft's narrative sections
  current_version  int not null default 0,
  row_version      int not null default 1,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique (audit_id, ref)
);

create table if not exists iso_report_versions (
  id                     text primary key,
  report_id              text not null references iso_reports(id),
  audit_id               text not null references iso_audits(id),
  client_id              text not null,
  version_no             int not null,
  kind                   text not null,
  title                  text not null,
  snapshot_id            text not null references iso_audit_snapshots(id),
  supersedes_version_id  text references iso_report_versions(id),
  supersede_reason       text,
  content                jsonb not null,                -- everything the PDF shows, frozen
  issued_at              timestamptz not null,
  issued_by              text not null,
  created_at             timestamptz not null default now(),
  unique (report_id, version_no)
);

create table if not exists iso_report_acknowledgements (
  id               text primary key,
  version_id       text not null references iso_report_versions(id),
  report_id        text not null references iso_reports(id),
  audit_id         text not null references iso_audits(id),
  client_id        text not null,
  name             text not null,
  role             text,
  acknowledged_on  date not null,
  wording          text not null check (wording = 'Received and discussed'),
  recorded_by      text not null,
  created_at       timestamptz not null default now()
);

do $$
declare t text;
begin
  for t in select unnest(array['iso_reports','iso_report_versions','iso_report_acknowledgements'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- Versions and acknowledgements are written once and never changed or removed.
create or replace function iso_report_version_immutable() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  raise exception '% is immutable', tg_table_name;
end;
$$;
drop trigger if exists iso_report_versions_no_change on iso_report_versions;
create trigger iso_report_versions_no_change before update or delete on iso_report_versions
  for each row execute function iso_report_version_immutable();
drop trigger if exists iso_report_acks_no_change on iso_report_acknowledgements;
create trigger iso_report_acks_no_change before update or delete on iso_report_acknowledgements
  for each row execute function iso_report_version_immutable();
drop trigger if exists iso_reports_no_delete on iso_reports;
create trigger iso_reports_no_delete before delete on iso_reports for each row execute function iso_no_hard_delete();

revoke execute on function iso_report_version_immutable() from public, anon, authenticated;
grant execute on function iso_report_version_immutable() to service_role;

-- ── Rollback ─────────────────────────────────────────────────────────────────────
--   drop table if exists iso_report_acknowledgements, iso_report_versions, iso_reports cascade;
--   drop function if exists iso_report_version_immutable cascade;
