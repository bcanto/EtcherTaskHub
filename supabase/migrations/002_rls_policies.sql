-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Row Level Security Policies
-- Migration: 002_rls_policies.sql
--
-- ALL authorization is enforced here in the database, not in the frontend.
-- The frontend's role checks are UX only — these policies are the real gate.
--
-- Security model:
--   admin  → full access to everything in the organisation
--   pm     → same as admin except cannot manage users/billing
--   staff  → boards/tasks/files/time they are permitted to access
--   client → only their own client's data, portal_enabled required,
--             never sees internal comments, internal files, or staff details
--
-- Safe defaults enforced:
--   • RLS is ENABLED on every table
--   • No policy = no access (deny-by-default)
--   • Audit log is append-only (no UPDATE/DELETE policies exist)
--   • Comments default to internal — client_visible must be explicit
--   • Files default to internal_only = true
-- ════════════════════════════════════════════════════════════════════════════

-- ── Enable RLS on every table ─────────────────────────────────────────────
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
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

-- ════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- SECURITY DEFINER: run with definer's privileges, not caller's.
-- This prevents RLS policies from recursively triggering themselves when
-- checking the profiles table inside another table's policy.
-- ════════════════════════════════════════════════════════════════════════════

-- Returns the role of the currently authenticated user.
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- Returns the client_id of the currently authenticated user (for client accounts).
CREATE OR REPLACE FUNCTION public.auth_user_client_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Returns true if the current user is an internal staff member (admin, pm, staff).
-- Clients return false.
CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid()
$$;

-- Returns true if the current user can read the given workboard.
-- Encapsulates board visibility logic so it is consistent across all policies.
CREATE OR REPLACE FUNCTION public.can_read_board(p_board_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.workboards w
    WHERE  w.id = p_board_id
      AND  NOT w.archived
      AND  (
        -- Admins and PMs see all non-archived boards
        public.auth_user_role() IN ('admin', 'pm')
        OR
        -- Staff see all_internal boards
        (public.auth_user_role() = 'staff' AND w.visibility = 'all_internal')
        OR
        -- The board owner always has access
        w.owner_id = auth.uid()
        OR
        -- Explicit member share (members_only boards)
        EXISTS (
          SELECT 1 FROM public.board_shares bs
          WHERE  bs.board_id = w.id AND bs.user_id = auth.uid()
        )
      )
  )
$$;

-- Returns true if the current user can write to (mutate tasks/comments/etc on) a board.
-- Clients can never write to internal boards, only submit work requests.
CREATE OR REPLACE FUNCTION public.can_write_board(p_board_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.is_internal() AND public.can_read_board(p_board_id)
$$;

-- Returns true if a client user can access the given client_id through the portal.
CREATE OR REPLACE FUNCTION public.client_can_access(p_client_id UUID)
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
-- PROFILES POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Every user can read their own profile
CREATE POLICY "profiles: own row" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- Internal staff can read all active profiles (needed for assignment dropdowns, etc.)
CREATE POLICY "profiles: internal read all" ON public.profiles
  FOR SELECT USING (public.is_internal());

-- Clients can read profiles of users in their organisation (e.g. to show assigned names)
-- They only see name, initials, display_color — no email, no role
-- NOTE: field-level restriction is handled in the application layer (SELECT list),
-- RLS only controls row access.
CREATE POLICY "profiles: client read internal staff names" ON public.profiles
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND role IN ('admin', 'pm', 'staff')
    AND active = true
  );

-- Users can update their own profile (name, display_color, initials only)
-- Role changes require admin action — enforced via separate admin policy.
CREATE POLICY "profiles: own update" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-role-escalation: role must match existing value
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    -- Prevent self-client_id change
    AND client_id IS NOT DISTINCT FROM (SELECT client_id FROM public.profiles WHERE id = auth.uid())
  );

-- Admins can INSERT, UPDATE, DELETE profiles (user management)
CREATE POLICY "profiles: admin manage" ON public.profiles
  FOR ALL USING (public.auth_user_role() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENTS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal staff can read all clients
CREATE POLICY "clients: internal read" ON public.clients
  FOR SELECT USING (public.is_internal());

-- Client users can read only their own client record
CREATE POLICY "clients: own read" ON public.clients
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND id = public.auth_user_client_id()
    AND portal_enabled = true
    AND archived = false
  );

-- Only admins and PMs can create/update/delete clients
CREATE POLICY "clients: admin pm manage" ON public.clients
  FOR ALL USING (public.auth_user_role() IN ('admin', 'pm'));

-- ════════════════════════════════════════════════════════════════════════════
-- WORKBOARDS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users see boards they are permitted to access
CREATE POLICY "workboards: internal read" ON public.workboards
  FOR SELECT USING (public.can_read_board(id));

-- Clients cannot read workboards directly — they access data via portal views
-- (no client SELECT policy = clients cannot see workboards at all)

-- Admins and PMs can create boards
CREATE POLICY "workboards: admin pm create" ON public.workboards
  FOR INSERT WITH CHECK (public.auth_user_role() IN ('admin', 'pm'));

-- Admins, PMs, and board owners can update
CREATE POLICY "workboards: admin pm owner update" ON public.workboards
  FOR UPDATE USING (
    public.auth_user_role() IN ('admin', 'pm') OR owner_id = auth.uid()
  );

-- Only admins can delete boards
CREATE POLICY "workboards: admin delete" ON public.workboards
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- BOARD SHARES POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can see who has access to a board (if they can see the board)
CREATE POLICY "board_shares: internal read" ON public.board_shares
  FOR SELECT USING (public.can_read_board(board_id));

-- Only admins, PMs, and board owners can grant/revoke shares
CREATE POLICY "board_shares: admin pm owner manage" ON public.board_shares
  FOR ALL USING (
    public.auth_user_role() IN ('admin', 'pm')
    OR EXISTS (
      SELECT 1 FROM public.workboards w
      WHERE w.id = board_id AND w.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- GROUPS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read groups on accessible boards
CREATE POLICY "groups: internal read" ON public.groups
  FOR SELECT USING (public.can_read_board(board_id));

-- Client users cannot read groups directly

-- Internal users can manage groups on boards they can write to
CREATE POLICY "groups: internal write" ON public.groups
  FOR ALL USING (public.can_write_board(board_id));

-- ════════════════════════════════════════════════════════════════════════════
-- TASKS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read tasks on accessible boards
CREATE POLICY "tasks: internal read" ON public.tasks
  FOR SELECT USING (public.can_read_board(board_id));

-- Client users can read tasks ONLY when:
--   1. The task belongs to their client
--   2. Their client has portal_enabled = true
--   3. The task is not archived
--   4. The board belongs to their client
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

-- Internal users can INSERT tasks on boards they can write to
CREATE POLICY "tasks: internal create" ON public.tasks
  FOR INSERT WITH CHECK (public.can_write_board(board_id));

-- Internal users can UPDATE tasks on accessible boards
-- Clients cannot update internal task fields — approval actions go through task_approvals
CREATE POLICY "tasks: internal update" ON public.tasks
  FOR UPDATE USING (public.can_write_board(board_id))
  WITH CHECK (public.can_write_board(board_id));

-- Only admins can hard-delete tasks; everyone else should archive
CREATE POLICY "tasks: admin delete" ON public.tasks
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- TASK APPROVALS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read all task approvals for tasks they can access
CREATE POLICY "task_approvals: internal read" ON public.task_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );

-- Client users can read approvals on their own tasks
CREATE POLICY "task_approvals: client read own" ON public.task_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
    )
  );

-- Clients can INSERT/UPDATE approvals ONLY on tasks awaiting_client = true
-- and only for their client's tasks.
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
    -- Clients can only set approved_by to themselves
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

-- Internal users can manage approvals (clear, audit)
CREATE POLICY "task_approvals: internal manage" ON public.task_approvals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- COMMENTS POLICIES
-- visibility = 'internal'      → staff and admin only
-- visibility = 'client_visible' → client can also read (own tasks only)
-- Default is 'internal' — this is the safe default.
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read all comments on tasks they have board access to
CREATE POLICY "comments: internal read" ON public.comments
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );

-- Client users can ONLY read client_visible comments on their own tasks
-- They NEVER see internal comments regardless of any other flag
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

-- Internal users can insert comments (defaulting to internal)
CREATE POLICY "comments: internal create" ON public.comments
  FOR INSERT WITH CHECK (
    public.is_internal()
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );

-- Authors can update their own comments
CREATE POLICY "comments: author update own" ON public.comments
  FOR UPDATE USING (author_id = auth.uid() AND public.is_internal())
  WITH CHECK (author_id = auth.uid());

-- Authors and admins can delete comments
CREATE POLICY "comments: author admin delete" ON public.comments
  FOR DELETE USING (
    author_id = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- TASK FILES POLICIES
-- internal_only = true (default) → internal staff only
-- internal_only = false          → clients can also see (their tasks only)
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read files on tasks they can access
CREATE POLICY "task_files: internal read" ON public.task_files
  FOR SELECT USING (
    public.is_internal()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_read_board(t.board_id)
    )
  );

-- Client users ONLY see files that are explicitly not internal_only,
-- on their own tasks, with portal enabled
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

-- Internal users can upload files (uploaded_by must be themselves)
CREATE POLICY "task_files: internal upload" ON public.task_files
  FOR INSERT WITH CHECK (
    public.is_internal()
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id AND public.can_write_board(t.board_id)
    )
  );

-- Clients can upload files to tasks awaiting their input (non-internal by default)
CREATE POLICY "task_files: client upload awaiting" ON public.task_files
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND uploaded_by = auth.uid()
    AND internal_only = false        -- clients cannot create internal files
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE  t.id = task_id
        AND  t.awaiting_client = true
        AND  t.client_id = public.auth_user_client_id()
        AND  public.client_can_access(t.client_id)
        AND  NOT t.archived
    )
  );

-- Only the uploader or admins can delete files
CREATE POLICY "task_files: uploader admin delete" ON public.task_files
  FOR DELETE USING (
    uploaded_by = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- TIME ENTRIES POLICIES
-- Clients never see time entries (billable rates, hours, notes are internal)
-- ════════════════════════════════════════════════════════════════════════════

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

-- Admins can insert for any user (for corrections/imports)
CREATE POLICY "time_entries: admin insert any" ON public.time_entries
  FOR INSERT WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "time_entries: own update" ON public.time_entries
  FOR UPDATE USING (user_id = auth.uid() AND public.is_internal());

CREATE POLICY "time_entries: admin delete" ON public.time_entries
  FOR DELETE USING (
    user_id = auth.uid() OR public.auth_user_role() = 'admin'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- TASK DEPENDENCIES POLICIES
-- ════════════════════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS POLICIES
-- Users can only read their own notifications. Period.
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "notifications: own read" ON public.notifications
  FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "notifications: own update read flag" ON public.notifications
  FOR UPDATE USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Internal backend/triggers can insert notifications (service role bypasses RLS)
-- Direct inserts by authenticated users only allowed if they are sending to themselves
-- (system uses service role key for cross-user notifications)
CREATE POLICY "notifications: self insert" ON public.notifications
  FOR INSERT WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "notifications: own delete" ON public.notifications
  FOR DELETE USING (recipient_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT LOG POLICIES
-- APPEND-ONLY — no UPDATE or DELETE policies exist for any role.
-- Admins and PMs can read audit logs.
-- The audit write is performed server-side via Edge Functions (service role).
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "audit_log: admin pm read" ON public.audit_log
  FOR SELECT USING (public.auth_user_role() IN ('admin', 'pm'));

-- No INSERT policy for regular users — writes come from Edge Functions using
-- the service role key (which bypasses RLS entirely).
-- If you need direct INSERT from the client temporarily during migration:
-- CREATE POLICY "audit_log: internal insert" ON public.audit_log
--   FOR INSERT WITH CHECK (public.is_internal() AND actor_id = auth.uid());

-- NO UPDATE policy
-- NO DELETE policy
-- This makes audit_log effectively tamper-proof from the application layer.

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT WORK REQUESTS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Clients can create work requests for their own client
CREATE POLICY "work_requests: client create" ON public.client_work_requests
  FOR INSERT WITH CHECK (
    public.auth_user_role() = 'client'
    AND submitted_by = auth.uid()
    AND client_id = public.auth_user_client_id()
    AND public.client_can_access(client_id)
  );

-- Clients can read their own work requests
CREATE POLICY "work_requests: client read own" ON public.client_work_requests
  FOR SELECT USING (
    public.auth_user_role() = 'client'
    AND client_id = public.auth_user_client_id()
    AND public.client_can_access(client_id)
  );

-- Internal users can read all work requests
CREATE POLICY "work_requests: internal read" ON public.client_work_requests
  FOR SELECT USING (public.is_internal());

-- Only internal users can update work request status (approve/reject/link task)
CREATE POLICY "work_requests: internal update" ON public.client_work_requests
  FOR UPDATE USING (public.is_internal());

-- Only admins can delete work requests
CREATE POLICY "work_requests: admin delete" ON public.client_work_requests
  FOR DELETE USING (public.auth_user_role() = 'admin');

-- ── Work request files ────────────────────────────────────────────────────
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

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULE EVENTS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can read all schedule events (capacity planning)
CREATE POLICY "schedule_events: internal read" ON public.schedule_events
  FOR SELECT USING (public.is_internal());

-- Users manage their own events
CREATE POLICY "schedule_events: own manage" ON public.schedule_events
  FOR ALL USING (user_id = auth.uid() AND public.is_internal());

-- Admins can manage all events
CREATE POLICY "schedule_events: admin manage" ON public.schedule_events
  FOR ALL USING (public.auth_user_role() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOM COLUMNS POLICIES
-- ════════════════════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════════════════════
-- PERSONAL CHECKLIST POLICIES
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "personal_checklist: own" ON public.personal_checklist
  FOR ALL USING (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- LABEL CONFIG POLICIES
-- ════════════════════════════════════════════════════════════════════════════

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
