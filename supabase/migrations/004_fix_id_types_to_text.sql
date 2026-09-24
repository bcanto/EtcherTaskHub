-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Fix entity ids: UUID → TEXT
-- Migration: 004_fix_id_types_to_text.sql
--
-- WHY THIS EXISTS
-- 001_initial_schema.sql declared every id column as UUID. The live app has
-- never used UUIDs — every id everywhere (tasks, boards, clients, comments…)
-- is a plain app-generated string like 't1' or 'c1'. That mismatch already
-- broke real usage: profiles.client_id was hand-altered to TEXT at some point
-- to hold real client logins (e.g. 'c1'), but nothing else was updated to
-- match, so auth_user_client_id() (declared RETURNS UUID) started erroring
-- with "return type mismatch — actual return type is text" — which breaks
-- EVERY RLS policy on tasks/comments/task_files/client_work_requests that
-- calls it, for every client session.
--
-- SAFE TO RUN: every table this touches except `profiles` has 0 rows (verified
-- 2026-09-24 via the REST API with the service role key before writing this).
-- profiles has 13 real rows and is NOT dropped — only its client_id foreign
-- key is re-added (see below), and even that is added NOT VALID so the 6
-- existing client profiles (whose client_id values don't correspond to any
-- row in the still-empty `clients` table yet) don't block this migration.
-- Once real clients are migrated into `clients` with matching ids, run:
--   ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_client_id_fkey;
--
-- Auth-linked columns (profiles.id itself, and every *_by / *_id column that
-- is a foreigh key to profiles.id — owner_id, author_id, uploaded_by,
-- recipient_id, actor_id, submitted_by, approved_by, currently_with_user_id,
-- user_id, granted_by, created_by) are LEFT AS UUID — those really are
-- Supabase Auth user ids, not app-generated ids, and are untouched by this.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Drop every table except profiles (all confirmed empty) ───────────────────
-- CASCADE also drops: their own RLS policies, indexes, triggers, and — for
-- `clients` specifically — the profiles_client_id_fkey constraint that lives
-- on `profiles` but references it (re-added further down, correctly typed).
DROP TABLE IF EXISTS public.label_config           CASCADE;
DROP TABLE IF EXISTS public.personal_checklist     CASCADE;
DROP TABLE IF EXISTS public.custom_column_values   CASCADE;
DROP TABLE IF EXISTS public.custom_columns         CASCADE;
DROP TABLE IF EXISTS public.schedule_events        CASCADE;
DROP TABLE IF EXISTS public.work_request_files     CASCADE;
DROP TABLE IF EXISTS public.client_work_requests   CASCADE;
DROP TABLE IF EXISTS public.audit_log              CASCADE;
DROP TABLE IF EXISTS public.notifications          CASCADE;
DROP TABLE IF EXISTS public.task_dependencies      CASCADE;
DROP TABLE IF EXISTS public.time_entries           CASCADE;
DROP TABLE IF EXISTS public.task_files             CASCADE;
DROP TABLE IF EXISTS public.comments               CASCADE;
DROP TABLE IF EXISTS public.task_approvals         CASCADE;
DROP TABLE IF EXISTS public.tasks                  CASCADE;
DROP TABLE IF EXISTS public.groups                 CASCADE;
DROP TABLE IF EXISTS public.board_shares           CASCADE;
DROP TABLE IF EXISTS public.workboards             CASCADE;
DROP TABLE IF EXISTS public.clients                CASCADE;

-- Note: the 4 helper functions (auth_user_client_id, can_read_board,
-- can_write_board, client_can_access) are dropped and recreated further
-- below, AFTER the tables — their bodies reference public.workboards /
-- public.clients, and a LANGUAGE sql function is validated against those
-- tables at CREATE time, not just at first call. Creating them here (before
-- the tables exist again) fails with "relation ... does not exist".

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENTS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.clients (
  id              TEXT        PRIMARY KEY,
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

-- Re-add the FK from profiles → clients, correctly typed this time.
-- NOT VALID: skips checking the 6 existing client profiles' client_id values
-- against (currently empty) clients rows. Enforced for all NEW/changed rows
-- from this point on regardless; VALIDATE CONSTRAINT once real clients exist.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL
  NOT VALID;

-- ════════════════════════════════════════════════════════════════════════════
-- WORKBOARDS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.workboards (
  id          TEXT              PRIMARY KEY,
  name        TEXT              NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT              CHECK (char_length(description) <= 2000),
  client_id   TEXT              REFERENCES public.clients(id) ON DELETE SET NULL,
  owner_id    UUID              NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  visibility  board_visibility  NOT NULL DEFAULT 'all_internal',
  archived    BOOLEAN           NOT NULL DEFAULT false,
  display_order INTEGER         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  created_by  UUID              REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.board_shares (
  board_id    TEXT        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- GROUPS (sections within a workboard)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.groups (
  id            TEXT        PRIMARY KEY,
  board_id      TEXT        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  client_id     TEXT        REFERENCES public.clients(id) ON DELETE SET NULL,
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
  id                    TEXT              PRIMARY KEY,
  board_id              TEXT              NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  group_id              TEXT              REFERENCES public.groups(id) ON DELETE SET NULL,
  parent_task_id        TEXT              REFERENCES public.tasks(id) ON DELETE CASCADE,
  client_id             TEXT              REFERENCES public.clients(id) ON DELETE SET NULL,

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

ALTER TABLE public.tasks ADD CONSTRAINT tasks_no_self_parent
  CHECK (parent_task_id IS DISTINCT FROM id);

-- ── Client approval state ─────────────────────────────────────────────────
CREATE TABLE public.task_approvals (
  id              TEXT            PRIMARY KEY,
  task_id         TEXT            NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE CASCADE,
  status          approval_status NOT NULL,
  note            TEXT            CHECK (char_length(note) <= 2000),
  approved_by     UUID            REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.comments (
  id          TEXT               PRIMARY KEY,
  task_id     TEXT               NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
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
  id              TEXT        PRIMARY KEY,
  task_id         TEXT        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  storage_path    TEXT        NOT NULL,
  name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type       TEXT        CHECK (char_length(mime_type) <= 100),
  size_bytes      INTEGER     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800), -- 50MB max
  internal_only   BOOLEAN     NOT NULL DEFAULT true,
  uploaded_by     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TIME ENTRIES
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.time_entries (
  id              TEXT        PRIMARY KEY,
  task_id         TEXT        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
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
  id                    TEXT    PRIMARY KEY,
  predecessor_task_id   TEXT    NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependent_task_id     TEXT    NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  lag_days              INTEGER NOT NULL DEFAULT 0 CHECK (lag_days >= 0),
  UNIQUE (predecessor_task_id, dependent_task_id),
  CHECK (predecessor_task_id <> dependent_task_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.notifications (
  id              TEXT        PRIMARY KEY,
  recipient_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id         TEXT        REFERENCES public.tasks(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL CHECK (char_length(type) <= 60),
  message         TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  read            BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT LOG (append-only — no UPDATE or DELETE policies for any role)
-- entity_id is polymorphic (a Task id, a User/profile UUID, a Board id, …) —
-- TEXT so it can hold either shape; it was never a real foreign key.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.audit_log (
  id              TEXT        PRIMARY KEY,
  entity_type     TEXT        NOT NULL CHECK (char_length(entity_type) <= 60),
  entity_id       TEXT,
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
  id              TEXT        PRIMARY KEY,
  client_id       TEXT        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submitted_by    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title           TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description     TEXT        CHECK (char_length(description) <= 5000),
  priority        task_priority NOT NULL DEFAULT 'med',
  status          wr_status   NOT NULL DEFAULT 'pending',
  linked_task_id  TEXT        REFERENCES public.tasks(id) ON DELETE SET NULL,
  linked_board_id TEXT        REFERENCES public.workboards(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Files attached to work requests (stored in Supabase Storage)
CREATE TABLE public.work_request_files (
  id              TEXT        PRIMARY KEY,
  request_id      TEXT        NOT NULL REFERENCES public.client_work_requests(id) ON DELETE CASCADE,
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
  id          TEXT        PRIMARY KEY,
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
  id          TEXT        PRIMARY KEY,
  board_id    TEXT        NOT NULL REFERENCES public.workboards(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  col_type    TEXT        NOT NULL DEFAULT 'text' CHECK (col_type IN ('text', 'number', 'date', 'select', 'checkbox')),
  display_order INTEGER   NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.custom_column_values (
  column_id   TEXT        NOT NULL REFERENCES public.custom_columns(id) ON DELETE CASCADE,
  task_id     TEXT        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  value       TEXT        CHECK (char_length(value) <= 1000),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (column_id, task_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PERSONAL CHECKLIST (per-user)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.personal_checklist (
  id          TEXT        PRIMARY KEY,
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
  id          TEXT        PRIMARY KEY,
  board_id    TEXT        REFERENCES public.workboards(id) ON DELETE CASCADE, -- NULL = global
  field_type  TEXT        NOT NULL CHECK (field_type IN ('status', 'priority')),
  key         TEXT        NOT NULL CHECK (char_length(key) <= 60),
  label       TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  color       TEXT        NOT NULL CHECK (color ~* '^#[0-9a-f]{6}$'),
  icon        TEXT        CHECK (char_length(icon) <= 10),
  UNIQUE (board_id, field_type, key)
);

-- ════════════════════════════════════════════════════════════════════════════
-- INDEXES — identical to 001_initial_schema.sql, re-created because the
-- tables above were dropped and rebuilt fresh.
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
-- idx_profiles_role and idx_profiles_client_id are untouched — profiles was never dropped.

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers — re-created for the tables rebuilt above.
-- set_updated_at() itself is untouched (not dropped, doesn't reference ids).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TRIGGER trg_clients_updated_at        BEFORE UPDATE ON public.clients         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workboards_updated_at     BEFORE UPDATE ON public.workboards      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_groups_updated_at         BEFORE UPDATE ON public.groups          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tasks_updated_at          BEFORE UPDATE ON public.tasks           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_task_approvals_updated_at BEFORE UPDATE ON public.task_approvals  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_comments_updated_at       BEFORE UPDATE ON public.comments        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_time_entries_updated_at   BEFORE UPDATE ON public.time_entries    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_work_requests_updated_at  BEFORE UPDATE ON public.client_work_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_label_config_updated_at   BEFORE UPDATE ON public.label_config    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- trg_profiles_updated_at is untouched — profiles was never dropped.

-- ════════════════════════════════════════════════════════════════════════════
-- Drop + recreate the 4 helper functions, TEXT instead of UUID — done here,
-- now that clients/workboards/board_shares exist again (their bodies
-- reference those tables, and CREATE FUNCTION ... LANGUAGE sql validates the
-- body against real tables immediately, unlike plpgsql).
-- CREATE OR REPLACE cannot change a return type or an argument type in
-- Postgres (that's a different overload, not a replacement), so the old
-- UUID-typed versions are dropped first. CASCADE on each: can_write_board's
-- body calls can_read_board, a real dependency for a LANGUAGE sql function,
-- so dropping can_read_board alone (no CASCADE) would fail with "other
-- objects depend on it" — moot either way since all 4 are recreated
-- immediately below regardless of what CASCADE takes down with them.
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.auth_user_client_id() CASCADE;
DROP FUNCTION IF EXISTS public.can_read_board(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.can_write_board(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.client_can_access(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.auth_user_client_id()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.can_read_board(p_board_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.workboards w
    WHERE  w.id = p_board_id
      AND  NOT w.archived
      AND  (
        public.auth_user_role() IN ('admin', 'pm')
        OR
        (public.auth_user_role() = 'staff' AND w.visibility = 'all_internal')
        OR
        w.owner_id = auth.uid()
        OR
        EXISTS (
          SELECT 1 FROM public.board_shares bs
          WHERE  bs.board_id = w.id AND bs.user_id = auth.uid()
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_write_board(p_board_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.is_internal() AND public.can_read_board(p_board_id)
$$;

CREATE OR REPLACE FUNCTION public.client_can_access(p_client_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.clients c
    JOIN   public.profiles p ON p.id = auth.uid()
    WHERE  c.id = p_client_id
      AND  c.id = p.client_id
      AND  c.portal_enabled = true
      AND  c.archived = false
      AND  p.role = 'client'
      AND  p.active = true
  )
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — re-enable (a fresh table always starts with RLS OFF) and recreate
-- every policy exactly as in 002_rls_policies.sql. Only the 4 functions these
-- call have changed (TEXT instead of UUID) — no policy logic changes.
-- profiles' own RLS state and policies are untouched (never dropped).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workboards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_shares          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_work_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_request_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_columns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_column_values  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_checklist    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_config          ENABLE ROW LEVEL SECURITY;

-- CLIENTS
CREATE POLICY "clients: internal read" ON public.clients
  FOR SELECT USING (public.is_internal());
CREATE POLICY "clients: own read" ON public.clients
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND id = public.auth_user_client_id()
    AND portal_enabled = true
    AND archived = false
  );
CREATE POLICY "clients: admin pm manage" ON public.clients
  FOR ALL USING (public.auth_user_role() IN ('admin', 'pm'));

-- WORKBOARDS
CREATE POLICY "workboards: internal read" ON public.workboards
  FOR SELECT USING (public.can_read_board(id));
CREATE POLICY "workboards: admin pm create" ON public.workboards
  FOR INSERT WITH CHECK (public.auth_user_role() IN ('admin', 'pm'));
CREATE POLICY "workboards: admin pm owner update" ON public.workboards
  FOR UPDATE USING (
    public.auth_user_role() IN ('admin', 'pm') OR owner_id = auth.uid()
  );
CREATE POLICY "workboards: admin delete" ON public.workboards
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- BOARD SHARES
CREATE POLICY "board_shares: internal read" ON public.board_shares
  FOR SELECT USING (public.can_read_board(board_id));
CREATE POLICY "board_shares: admin pm owner manage" ON public.board_shares
  FOR ALL USING (
    public.auth_user_role() IN ('admin', 'pm')
    OR EXISTS (
      SELECT 1 FROM public.workboards w
      WHERE w.id = board_id AND w.owner_id = auth.uid()
    )
  );

-- GROUPS
CREATE POLICY "groups: internal read" ON public.groups
  FOR SELECT USING (public.can_read_board(board_id));
CREATE POLICY "groups: internal write" ON public.groups
  FOR ALL USING (public.can_write_board(board_id));

-- TASKS
CREATE POLICY "tasks: internal read" ON public.tasks
  FOR SELECT USING (public.can_read_board(board_id));
CREATE POLICY "tasks: client portal read" ON public.tasks
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND NOT archived
    AND client_id = public.auth_user_client_id()
    AND public.client_can_access(client_id)
    AND EXISTS (
      SELECT 1 FROM public.workboards w
      WHERE  w.id = board_id
        AND  w.client_id = public.auth_user_client_id()
        AND  NOT w.archived
    )
  );
CREATE POLICY "tasks: internal create" ON public.tasks
  FOR INSERT WITH CHECK (public.can_write_board(board_id));
CREATE POLICY "tasks: internal update" ON public.tasks
  FOR UPDATE USING (public.can_write_board(board_id))
  WITH CHECK (public.can_write_board(board_id));
CREATE POLICY "tasks: admin delete" ON public.tasks
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- TASK APPROVALS
CREATE POLICY "task_approvals: internal read" ON public.task_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );
CREATE POLICY "task_approvals: client read own" ON public.task_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
    )
  );
CREATE POLICY "task_approvals: client submit" ON public.task_approvals
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.awaiting_client = true
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
        AND  NOT t.archived
    )
    AND approved_by = auth.uid()
  );
CREATE POLICY "task_approvals: client update own" ON public.task_approvals
  FOR UPDATE USING (
    public.auth_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.awaiting_client = true
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
    )
  );
CREATE POLICY "task_approvals: internal manage" ON public.task_approvals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );

-- COMMENTS
CREATE POLICY "comments: internal read" ON public.comments
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );
CREATE POLICY "comments: client read client_visible only" ON public.comments
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND visibility = 'client_visible'
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
    )
  );
CREATE POLICY "comments: internal create" ON public.comments
  FOR INSERT WITH CHECK (
    public.is_internal()
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );
CREATE POLICY "comments: author update own" ON public.comments
  FOR UPDATE USING (author_id = auth.uid() AND public.is_internal())
  WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments: author admin delete" ON public.comments
  FOR DELETE USING (
    author_id = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- TASK FILES
CREATE POLICY "task_files: internal read" ON public.task_files
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );
CREATE POLICY "task_files: client read non-internal" ON public.task_files
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND NOT internal_only
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
    )
  );
CREATE POLICY "task_files: internal upload" ON public.task_files
  FOR INSERT WITH CHECK (
    public.is_internal()
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );
CREATE POLICY "task_files: client upload awaiting" ON public.task_files
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND uploaded_by = auth.uid()
    AND internal_only = false
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.awaiting_client = true
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
        AND  NOT t.archived
    )
  );
CREATE POLICY "task_files: uploader admin delete" ON public.task_files
  FOR DELETE USING (
    uploaded_by = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- TIME ENTRIES
CREATE POLICY "time_entries: internal read" ON public.time_entries
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );
CREATE POLICY "time_entries: internal create" ON public.time_entries
  FOR INSERT WITH CHECK (
    public.is_internal()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );
CREATE POLICY "time_entries: admin insert any" ON public.time_entries
  FOR INSERT WITH CHECK (public.auth_user_role() = 'admin');
CREATE POLICY "time_entries: own update" ON public.time_entries
  FOR UPDATE USING (user_id = auth.uid() AND public.is_internal());
CREATE POLICY "time_entries: admin delete" ON public.time_entries
  FOR DELETE USING (
    user_id = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- TASK DEPENDENCIES
CREATE POLICY "task_dependencies: internal read" ON public.task_dependencies
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = dependent_task_id AND public.can_read_board(t.board_id)
    )
  );
CREATE POLICY "task_dependencies: internal write" ON public.task_dependencies
  FOR ALL USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = dependent_task_id AND public.can_write_board(t.board_id)
    )
  );

-- NOTIFICATIONS
CREATE POLICY "notifications: own read" ON public.notifications
  FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY "notifications: own update read flag" ON public.notifications
  FOR UPDATE USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());
CREATE POLICY "notifications: self insert" ON public.notifications
  FOR INSERT WITH CHECK (recipient_id = auth.uid());
CREATE POLICY "notifications: own delete" ON public.notifications
  FOR DELETE USING (recipient_id = auth.uid());

-- AUDIT LOG (append-only — no UPDATE/DELETE policy, same as before)
CREATE POLICY "audit_log: admin pm read" ON public.audit_log
  FOR SELECT USING (public.auth_user_role() IN ('admin', 'pm'));

-- CLIENT WORK REQUESTS
CREATE POLICY "work_requests: client create" ON public.client_work_requests
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND submitted_by = auth.uid()
    AND client_id = public.auth_user_client_id()
    AND public.client_can_access(client_id)
  );
CREATE POLICY "work_requests: client read own" ON public.client_work_requests
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND client_id = public.auth_user_client_id()
    AND public.client_can_access(client_id)
  );
CREATE POLICY "work_requests: internal read" ON public.client_work_requests
  FOR SELECT USING (public.is_internal());
CREATE POLICY "work_requests: internal update" ON public.client_work_requests
  FOR UPDATE USING (public.is_internal());
CREATE POLICY "work_requests: admin delete" ON public.client_work_requests
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- WORK REQUEST FILES
CREATE POLICY "wr_files: client create" ON public.work_request_files
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.client_work_requests wr
      WHERE  wr.id = request_id
        AND  wr.client_id = public.auth_user_client_id()
        AND  public.client_can_access(wr.client_id)
    )
  );
CREATE POLICY "wr_files: client read own" ON public.work_request_files
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.client_work_requests wr
      WHERE  wr.id = request_id
        AND  wr.client_id = public.auth_user_client_id()
        AND  public.client_can_access(wr.client_id)
    )
  );
CREATE POLICY "wr_files: internal read" ON public.work_request_files
  FOR SELECT USING (public.is_internal());

-- SCHEDULE EVENTS
CREATE POLICY "schedule_events: internal read" ON public.schedule_events
  FOR SELECT USING (public.is_internal());
CREATE POLICY "schedule_events: own manage" ON public.schedule_events
  FOR ALL USING (user_id = auth.uid() AND public.is_internal());
CREATE POLICY "schedule_events: admin manage" ON public.schedule_events
  FOR ALL USING (public.auth_user_role() = 'admin');

-- CUSTOM COLUMNS
CREATE POLICY "custom_columns: internal read" ON public.custom_columns
  FOR SELECT USING (public.can_read_board(board_id));
CREATE POLICY "custom_columns: admin pm write" ON public.custom_columns
  FOR ALL USING (
    public.auth_user_role() IN ('admin', 'pm')
    AND public.can_write_board(board_id)
  );
CREATE POLICY "custom_column_values: internal read" ON public.custom_column_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.custom_columns cc
      WHERE  cc.id = column_id AND public.can_read_board(cc.board_id)
    )
  );
CREATE POLICY "custom_column_values: internal write" ON public.custom_column_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.custom_columns cc
      WHERE  cc.id = column_id AND public.can_write_board(cc.board_id)
    )
  );

-- PERSONAL CHECKLIST
CREATE POLICY "personal_checklist: own" ON public.personal_checklist
  FOR ALL USING (user_id = auth.uid());

-- LABEL CONFIG
CREATE POLICY "label_config: internal read" ON public.label_config
  FOR SELECT USING (
    public.is_internal()
    AND (board_id IS NULL OR public.can_read_board(board_id))
  );
CREATE POLICY "label_config: admin pm write" ON public.label_config
  FOR ALL USING (
    public.auth_user_role() IN ('admin', 'pm')
    AND (board_id IS NULL OR public.can_write_board(board_id))
  );
