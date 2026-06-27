-- 004_email_intake.sql
-- Email Intake schema for Etcher Task Hub
-- Run in Supabase SQL Editor after 001, 002, 003 migrations.
-- This table stores parsed emails staged for routing into tasks.

-- ── email_intake table ────────────────────────────────────────────────────────
create table if not exists public.email_intake (
  id                  text        primary key,
  status              text        not null default 'pending'
                        check (status in ('pending', 'routed', 'discarded')),

  -- Sender info
  "from"              text        not null,
  from_name           text,

  -- Email content
  subject             text,
  body                text,
  snippet             text,
  attachments         jsonb       not null default '[]',

  -- Timestamps
  received_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  -- Heuristic suggestions (populated by email-intake.mjs parser)
  suggested_title       text,
  suggested_description text,
  suggested_board_id    uuid        references public.workboards(id) on delete set null,
  suggested_group_id    uuid        references public.groups(id)     on delete set null,
  suggested_due_date    date,
  extracted_dates       jsonb       not null default '[]',
  action_items          jsonb       not null default '[]',

  -- After routing
  routed_to_task_id   uuid        references public.tasks(id) on delete set null,
  routed_at           timestamptz,
  routed_by           uuid        references public.profiles(id) on delete set null,

  -- After discarding
  discarded_at        timestamptz,
  discarded_by        uuid        references public.profiles(id) on delete set null,

  -- Original email metadata (Graph message ID etc.)
  original_email_id   text,
  email_headers       jsonb       not null default '{}',
  is_test             boolean     not null default false
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists email_intake_status_idx       on public.email_intake (status);
create index if not exists email_intake_received_at_idx  on public.email_intake (received_at desc);
create index if not exists email_intake_original_id_idx  on public.email_intake (original_email_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.email_intake enable row level security;

-- Admin: full access
create policy "admin_full_access" on public.email_intake
  for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Staff: can read and update (route/discard), cannot delete
create policy "staff_read" on public.email_intake
  for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','staff'))
  );

create policy "staff_update" on public.email_intake
  for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','staff'))
  );

-- Service role (email-intake.mjs via service key): insert only
-- This is handled by bypassing RLS with the service role key — no policy needed.

-- ── Helper view: pending count ────────────────────────────────────────────────
create or replace view public.email_intake_pending_count as
select count(*) as pending
from   public.email_intake
where  status = 'pending';
