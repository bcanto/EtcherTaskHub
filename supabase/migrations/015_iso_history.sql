-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO history foundation (release-1 B3)
-- Migration: 015_iso_history.sql
--
-- WRITTEN, NEVER APPLIED (hard rule 1). Depends on 009 and 010. Same conventions: RLS enabled with
-- zero policies plus an explicit revoke (service role only), every write logged by the app.
--
--   B3.1  iso_audits.library_release — the library release a board was created on; its
--         cross-standard links, document catalogue and cheat sheets resolve from that release.
--   B3.2  iso_audit_snapshots — one immutable row per board close (and, later, per issued report):
--         per clause its conclusion, baseline and approval; per linked document what was seen
--         (B3.3: title, revision, date, URL, who linked it and when, SHA-256 for an uploaded file).
--
-- Safe to run more than once (every CREATE is IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

-- B3.1: every board existing before this release was built on v3 (the only release then).
alter table iso_audits add column if not exists library_release text not null default 'v3';

-- B3.2: immutable snapshots. `data` is the JSON the app writes (api/_iso.js writeCloseSnapshot).
create table if not exists iso_audit_snapshots (
  id              text primary key,
  audit_id        text not null references iso_audits(id),
  client_id       text not null,
  kind            text not null check (kind in ('close','report')),
  library_release text not null,
  calc_version    text not null,
  data            jsonb not null,
  created_at      timestamptz not null default now(),
  created_by      text
);
create index if not exists iso_audit_snapshots_audit_idx on iso_audit_snapshots(audit_id, created_at);

alter table iso_audit_snapshots enable row level security;
revoke all on table iso_audit_snapshots from anon, authenticated;

-- Written once, never changed or removed (the app's adapters refuse too; this is the backstop).
create or replace function iso_snapshot_immutable() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  raise exception 'iso_audit_snapshots is immutable';
end;
$$;
drop trigger if exists iso_audit_snapshots_no_update_delete on iso_audit_snapshots;
create trigger iso_audit_snapshots_no_update_delete
  before update or delete on iso_audit_snapshots
  for each row execute function iso_snapshot_immutable();
drop trigger if exists iso_audit_snapshots_no_truncate on iso_audit_snapshots;
create trigger iso_audit_snapshots_no_truncate
  before truncate on iso_audit_snapshots
  for each statement execute function iso_snapshot_immutable();

-- Function lockdown (service role only), as 009's.
revoke execute on function iso_snapshot_immutable() from public, anon, authenticated;
grant execute on function iso_snapshot_immutable() to service_role;

-- ── Rollback ─────────────────────────────────────────────────────────────────────
--   drop table if exists iso_audit_snapshots cascade;
--   drop function if exists iso_snapshot_immutable cascade;
--   alter table iso_audits drop column if exists library_release;
