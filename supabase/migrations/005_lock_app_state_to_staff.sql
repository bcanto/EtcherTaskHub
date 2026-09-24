-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Lock app_state to internal staff
-- Migration: 005_lock_app_state_to_staff.sql
--
-- ⚠ RUN ONLY AFTER the client-portal server mode is DEPLOYED (index.html + api/portal-data.js,
--   api/portal-action.js, api/share-view.js, api/_portal.js, api/_blob.js, api/_email.js,
--   api/_authAdmin.js). Before that, the live portal and share pages still read app_state
--   directly and would break the moment this runs.
--
-- What it does: app_state (the single row holding all company data) becomes readable and
-- writable ONLY by internal users (profiles.role admin / pm / staff, via public.is_internal()).
-- Client-portal sessions lose all direct access — they already use /api/portal-data and
-- /api/portal-action, which run with the service role key and validate every action. Anonymous
-- access stays denied, as it already is. The service role (upload-state.js and the portal/share
-- endpoints) bypasses RLS and is unaffected.
--
-- Verified 2026-09-24 before writing this: a client session (test login brncanto+3) could read
-- the entire blob — 408 other clients' tasks, time entries, rates, invoices, client notes — and
-- the live blob contains a client-written comment, i.e. clients could write it too.
-- See .agents/PLAN-server-enforcement.md.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Step 0 (run this SELECT first, on its own, and keep the output) ────────────────────
-- The current app_state policies are not in the repo. Save what's there before replacing it:
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'app_state';

-- ── The lock ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;

-- Replace whatever policies exist today (their names aren't known from the repo).
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_state' LOOP
    EXECUTE format('DROP POLICY %I ON public.app_state', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "app_state: internal read" ON public.app_state
  FOR SELECT TO authenticated USING (public.is_internal());

-- The browser sync uses both UPDATE (compare-and-swap) and upsert (INSERT … ON CONFLICT),
-- so internal users need both. No DELETE policy for anyone.
CREATE POLICY "app_state: internal update" ON public.app_state
  FOR UPDATE TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "app_state: internal insert" ON public.app_state
  FOR INSERT TO authenticated WITH CHECK (public.is_internal());

-- ── Check it (optional, read-only) ─────────────────────────────────────────────────────
--   select policyname, cmd, roles, qual from pg_policies where tablename = 'app_state';
-- Then, from the app: log in as a client (portal must still work — it no longer touches
-- app_state), log in as staff (everything must work), open a share link logged out.

-- ── Rollback (only if something breaks) ────────────────────────────────────────────────
-- Restores "any signed-in user can read and write", which is the behaviour observed before
-- this migration (anonymous stays denied). Better: recreate the exact policies saved in Step 0.
--
--   DROP POLICY IF EXISTS "app_state: internal read"   ON public.app_state;
--   DROP POLICY IF EXISTS "app_state: internal update" ON public.app_state;
--   DROP POLICY IF EXISTS "app_state: internal insert" ON public.app_state;
--   CREATE POLICY "app_state: authenticated all" ON public.app_state
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
