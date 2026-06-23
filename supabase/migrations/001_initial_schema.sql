-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Initial Schema
-- Migration: 001_initial_schema.sql
--
-- Run once against a fresh Supabase project.
-- Supabase Auth (auth.users) is managed by the platform — we extend it
-- via the profiles table.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'pm', 'staff', 'client');
CREATE TYPE board_visibility AS ENUM ('all_internal', 'members_only', 'private');
CREATE TYPE task_status AS ENUM (
  'todo', 'in-progress', 'waiting-client', 'review',
  'blocked', 'ready-approval', 'done', 'cancelled'
);
CREATE TYPE task_priority AS ENUM ('low', 'med', 'high', 'crit');
CREATE TYPE currently_with_type AS ENUM ('none', 'staff', 'client', 'approver');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'changes_requested');
CREATE TYPE wr_status AS ENUM ('pending', 'reviewing', 'approved', 'rejected', 'in_progress', 'completed');
CREATE TYPE comment_visibility AS ENUM ('internal', 'client_visible');

-- ════════════════════════════════════════════════════════════════════════════
-- PROFILES
-- Extends auth.users. One row per authenticated user.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.profiles (
  id                    UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email                 TEXT          NOT NULL CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  role                  user_role     NOT NULL DEFAULT 'staff',
  client_id             UUID,         -- FK to clients added after clients table exists
  display_color         TEXT          NOT NULL DEFAULT '#64748b' CHECK (display_color ~* '^#[0-9a-f]{6}$'),
  initials              TEXT          CHECK (char_length(initials) <= 3),
  capacity_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (capacity_hours_per_day >= 0 AND capacity_hours_per_day <= 24),
  active                BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENTS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.clients (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  short_code      TEXT        CHECK (char_length(short_code) <= 10),
  color           TEXT        DEFAULT '#64748b' CHECK (color ~* '^#[0-9a-f]{6}$'),
  contact_name    TEXT        CHECK (char_length(contact_name) <= 120),
  contact_email   TEXT        CHECK (contact_email ~* '^[^@]+@[^@]+\.[^@]+$' OR contact_email IS NULL),
  portal_enabled  BOOLEAN     NOT NULL DEFAULT false,
  archived        BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Now add the FK from profiles → clients
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- WORKBOARDS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.workboards (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT              NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT              CHECK (char_length(description) <= 2000),
  client_id   UUID              REFERENCES public.clients(id) ON DELETE SET NULL,
  owner_id    UUID              NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  visibility  board_visibility  NOT NULL DEFAULT 'all_internal',
  archived    BOOLEAN           NOT NULL DEFAULT false,
  display_order INTEGER         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  created_by  UUID              REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ── Board member shares (for members_only boards) ─────────────────────────
CREATE TABLE public.board_shares (
  board_id    UUID        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- GROUPS (sections within a workboard)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.groups (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  client_id     UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  color         TEXT        NOT NULL DEFAULT '#64748b' CHECK (color ~* '^#[0-9a-f]{6}$'),
  collapsed     BOOLEAN     NOT NULL DEFAULT false,
  display_order INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TASKS (and subtasks via parent_task_id self-reference)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.tasks (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id              UUID              NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  group_id              UUID              REFERENCES public.groups(id) ON DELETE SET NULL,
  parent_task_id        UUID              REFERENCES public.tasks(id) ON DELETE CASCADE,
  client_id             UUID              REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Core fields
  name                  TEXT              NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  description           TEXT              CHECK (char_length(description) <= 10000),
  client_description    TEXT              CHECK (char_length(client_description) <= 10000),
  status                task_status       NOT NULL DEFAULT 'todo',
  priority              task_priority     NOT NULL DEFAULT 'med',

  -- Ownership & routing
  owner_id              UUID              REFERENCES public.profiles(id) ON DELETE SET NULL,
  currently_with_type   currently_with_type NOT NULL DEFAULT 'none',
  currently_with_user_id UUID             REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Timeline
  start_date            DATE,
  end_date              DATE,
  locked_dates          BOOLEAN           NOT NULL DEFAULT false,

  -- Progress
  percent_complete      INTEGER           NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  percent_mode          TEXT              NOT NULL DEFAULT 'manual' CHECK (percent_mode IN ('manual', 'auto')),
  hour_budget           NUMERIC(8,2)      NOT NULL DEFAULT 0 CHECK (hour_budget >= 0),

  -- Client portal flags
  awaiting_client       BOOLEAN           NOT NULL DEFAULT false,

  -- Tags (validated: lowercase alphanumeric + hyphen, max 20 chars each, max 20 tags)
  tags                  TEXT[]            NOT NULL DEFAULT '{}'
                          CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 20),

  -- Soft delete
  archived              BOOLEAN           NOT NULL DEFAULT false,
  completed_at          TIMESTAMPTZ,

  -- Ordering
  display_order         INTEGER           NOT NULL DEFAULT 0,

  -- Audit
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  created_by            UUID              REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Prevent circular parent references (task cannot be its own parent)
ALTER TABLE public.tasks ADD CONSTRAINT tasks_no_self_parent
  CHECK (parent_task_id IS DISTINCT FROM id);

-- ── Client approval state ─────────────────────────────────────────────────
-- One approval record per task (upserted on each approval action)
CREATE TABLE public.task_approvals (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID            NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE CASCADE,
  status          approval_status NOT NULL,
  note            TEXT            CHECK (char_length(note) <= 2000),
  approved_by     UUID            REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- Visibility: internal (staff only) or client_visible.
-- Default is INTERNAL — client-visible must be explicit.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.comments (
  id          UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID               NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id   UUID               NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body        TEXT               NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  visibility  comment_visibility NOT NULL DEFAULT 'internal',
  edited      BOOLEAN            NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TASK FILES (metadata only — binary data lives in Supabase Storage)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.task_files (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

  -- Storage reference — the actual path inside the Supabase Storage bucket
  -- Format: {bucket}/{client_id}/{board_id}/{task_id}/{uuid}/{filename}
  storage_path    TEXT        NOT NULL,

  -- Metadata
  name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type       TEXT        CHECK (char_length(mime_type) <= 100),
  size_bytes      INTEGER     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800), -- 50MB max

  -- Visibility: internal by default
  internal_only   BOOLEAN     NOT NULL DEFAULT true,

  -- Audit
  uploaded_by     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TIME ENTRIES
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.time_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  hours           NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  date            DATE        NOT NULL,
  note            TEXT        CHECK (char_length(note) <= 500),
  billable        BOOLEAN     NOT NULL DEFAULT true,
  billing_type    TEXT        NOT NULL DEFAULT 'project' CHECK (billing_type IN ('project', 'support', 'admin', 'travel')),
  client_rate     NUMERIC(10,2) CHECK (client_rate >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TASK DEPENDENCIES (DAG — enforced at application layer for cycle detection)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.task_dependencies (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_task_id   UUID    NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependent_task_id     UUID    NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  lag_days              INTEGER NOT NULL DEFAULT 0 CHECK (lag_days >= 0),
  UNIQUE (predecessor_task_id, dependent_task_id),
  CHECK (predecessor_task_id <> dependent_task_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id         UUID        REFERENCES public.tasks(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL CHECK (char_length(type) <= 60),
  message         TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  read            BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT LOG (append-only — no UPDATE or DELETE policies for any role)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT        NOT NULL CHECK (char_length(entity_type) <= 60),
  entity_id       UUID,
  actor_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action          TEXT        NOT NULL CHECK (char_length(action) <= 120),
  before_value    JSONB,
  after_value     JSONB,
  ip_address      INET,
  user_agent      TEXT        CHECK (char_length(user_agent) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT WORK REQUESTS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.client_work_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submitted_by    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title           TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description     TEXT        CHECK (char_length(description) <= 5000),
  priority        task_priority NOT NULL DEFAULT 'med',
  status          wr_status   NOT NULL DEFAULT 'pending',
  linked_task_id  UUID        REFERENCES public.tasks(id) ON DELETE SET NULL,
  linked_board_id UUID        REFERENCES public.workboards(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Files attached to work requests (stored in Supabase Storage)
CREATE TABLE public.work_request_files (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID        NOT NULL REFERENCES public.client_work_requests(id) ON DELETE CASCADE,
  storage_path    TEXT        NOT NULL,
  name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type       TEXT,
  size_bytes      INTEGER     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760), -- 10MB max
  uploaded_by     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULE EVENTS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.schedule_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT        CHECK (char_length(description) <= 2000),
  start_date  DATE        NOT NULL,
  end_date    DATE,
  event_type  TEXT        NOT NULL DEFAULT 'event' CHECK (event_type IN ('event', 'leave', 'holiday', 'block')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOM COLUMNS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.custom_columns (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  col_type    TEXT        NOT NULL DEFAULT 'text' CHECK (col_type IN ('text', 'number', 'date', 'select', 'checkbox')),
  display_order INTEGER   NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.custom_column_values (
  column_id   UUID        NOT NULL REFERENCES public.custom_columns(id) ON DELETE CASCADE,
  task_id     UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  value       TEXT        CHECK (char_length(value) <= 1000),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (column_id, task_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PERSONAL CHECKLIST (per-user)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.personal_checklist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  done        BOOLEAN     NOT NULL DEFAULT false,
  display_order INTEGER   NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- LABEL CONFIGURATION (custom status/priority labels per board or global)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.label_config (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID        REFERENCES public.workboards(id) ON DELETE CASCADE, -- NULL = global
  field_type  TEXT        NOT NULL CHECK (field_type IN ('status', 'priority')),
  key         TEXT        NOT NULL CHECK (char_length(key) <= 60),
  label       TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  color       TEXT        NOT NULL CHECK (color ~* '^#[0-9a-f]{6}$'),
  icon        TEXT        CHECK (char_length(icon) <= 10),
  UNIQUE (board_id, field_type, key)
);

-- ════════════════════════════════════════════════════════════════════════════
-- INDEXES (performance + common query patterns)
-- ════════════════════════════════════════════════════════════════════════════
CREATE INDEX idx_tasks_board_id        ON public.tasks(board_id)         WHERE NOT archived;
CREATE INDEX idx_tasks_group_id        ON public.tasks(group_id)         WHERE NOT archived;
CREATE INDEX idx_tasks_client_id       ON public.tasks(client_id)        WHERE NOT archived;
CREATE INDEX idx_tasks_owner_id        ON public.tasks(owner_id)         WHERE NOT archived;
CREATE INDEX idx_tasks_parent          ON public.tasks(parent_task_id)   WHERE parent_task_id IS NOT NULL;
CREATE INDEX idx_tasks_status          ON public.tasks(status)           WHERE NOT archived;
CREATE INDEX idx_tasks_end_date        ON public.tasks(end_date)         WHERE NOT archived AND end_date IS NOT NULL;
CREATE INDEX idx_comments_task_id      ON public.comments(task_id);
CREATE INDEX idx_task_files_task_id    ON public.task_files(task_id);
CREATE INDEX idx_time_entries_task_id  ON public.time_entries(task_id);
CREATE INDEX idx_time_entries_user_id  ON public.time_entries(user_id);
CREATE INDEX idx_time_entries_date     ON public.time_entries(date);
CREATE INDEX idx_notifications_recip   ON public.notifications(recipient_id, read);
CREATE INDEX idx_audit_log_entity      ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_actor       ON public.audit_log(actor_id);
CREATE INDEX idx_audit_log_created     ON public.audit_log(created_at DESC);
CREATE INDEX idx_work_requests_client  ON public.client_work_requests(client_id);
CREATE INDEX idx_groups_board_id       ON public.groups(board_id);
CREATE INDEX idx_board_shares_user     ON public.board_shares(user_id);
CREATE INDEX idx_profiles_role         ON public.profiles(role);
CREATE INDEX idx_profiles_client_id    ON public.profiles(client_id) WHERE client_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- AUTO-UPDATE updated_at trigger
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at       BEFORE UPDATE ON public.profiles        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_clients_updated_at        BEFORE UPDATE ON public.clients         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workboards_updated_at     BEFORE UPDATE ON public.workboards      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_groups_updated_at         BEFORE UPDATE ON public.groups          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tasks_updated_at          BEFORE UPDATE ON public.tasks           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_task_approvals_updated_at BEFORE UPDATE ON public.task_approvals  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_comments_updated_at       BEFORE UPDATE ON public.comments        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_time_entries_updated_at   BEFORE UPDATE ON public.time_entries    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_work_requests_updated_at  BEFORE UPDATE ON public.client_work_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_label_config_updated_at   BEFORE UPDATE ON public.label_config    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- AUTO-CREATE PROFILE on auth.users INSERT
-- When Supabase Auth creates a user, mirror them in profiles.
-- Role defaults to 'staff' — must be explicitly set by an admin after creation.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'staff'   -- safe default: no privilege until an admin promotes them
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
