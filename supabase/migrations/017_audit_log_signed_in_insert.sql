-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — a permanent audit trail the app can write to
-- Migration: 017_audit_log_signed_in_insert.sql
--
-- WRITTEN, NOT APPLIED. Run it yourself in the Supabase SQL editor when you are ready; nothing in the app needs it
-- to keep working. Until it is applied the app keeps its own log inside the shared company record, as before.
--
-- Why (audit H8, 2026-10-17): the audit log in the company record can be rewritten by any staff login, keeps only the
-- last 1,000 events, and missed key actions. public.audit_log (migration 001, shaped by 004) is the right place: it has
-- NO update or delete rule for anyone, so a row written there stays. The server already writes to it with the service role
-- (logins made, password changes, access switched off or on, roles changed). This lets a signed-in staff member add rows
-- for what they do in the app (tasks and clients deleted, staff added or removed, hours edited, approved or rejected),
-- under their own id only, and always stamped with the database's own clock.
--
--   • INSERT: internal staff only (admin, pm, staff), and only with actor_id = their own login.
--   • SELECT: unchanged: admins and project managers read it (migration 004).
--   • UPDATE / DELETE: still no rule for anyone. That is the point.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "audit_log: internal insert" ON public.audit_log;
CREATE POLICY "audit_log: internal insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_internal() AND actor_id = auth.uid());

-- The time of an event is the database's, never the browser's: a row cannot be backdated.
CREATE OR REPLACE FUNCTION public.audit_log_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_stamp ON public.audit_log;
CREATE TRIGGER audit_log_stamp BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp();

-- ── Check (optional) ──────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies where tablename = 'audit_log';
--   -- expect: "audit_log: admin pm read" (SELECT) and "audit_log: internal insert" (INSERT), nothing else.
--
-- ── Rollback ──────────────────────────────────────────────────────────────────
--   DROP POLICY "audit_log: internal insert" ON public.audit_log;
--   DROP TRIGGER audit_log_stamp ON public.audit_log;
--   DROP FUNCTION public.audit_log_stamp();
