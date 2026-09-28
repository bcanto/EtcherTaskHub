-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Close the remaining direct-database gaps for client logins
-- Migration: 007_lock_profiles_for_clients.sql
--
-- Found 2026-09-28 by probing the live project with a client login (read-only):
--   1. "profiles: client read internal staff names" let any client read the FULL profile row
--      of every active staff member — including their email address, role and capacity.
--      RLS cannot limit columns, and the portal no longer reads profiles directly (everything
--      comes from /api/portal-data), so the policy is simply dropped.
--   2. "profiles: own update" let a user change anything on their own row except role and
--      client_id — so a deactivated user could set active=true again, change their email, or
--      store an unbounded name. It now allows only name (≤100 chars), initials and colour.
-- Everything else on app_state / tables / storage was already closed (see 005, 006).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles: client read internal staff names" ON public.profiles;

DROP POLICY IF EXISTS "profiles: own update" ON public.profiles;
CREATE POLICY "profiles: own update" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role      =                    (SELECT p.role      FROM public.profiles p WHERE p.id = auth.uid())
    AND client_id IS NOT DISTINCT FROM (SELECT p.client_id FROM public.profiles p WHERE p.id = auth.uid())
    AND active    IS NOT DISTINCT FROM (SELECT p.active    FROM public.profiles p WHERE p.id = auth.uid())
    AND email     IS NOT DISTINCT FROM (SELECT p.email     FROM public.profiles p WHERE p.id = auth.uid())
    AND char_length(coalesce(name, '')) <= 100
  );

-- ── Check (read-only) — run these and look at the results ─────────────────────
-- a) policies now on profiles (the "client read internal staff names" row must be gone):
--      select policyname, cmd from pg_policies where tablename = 'profiles' order by 1;
-- b) anything that creates a profile automatically when someone signs up? (should be none,
--    or one that never gives a staff role):
--      select tgname, pg_get_triggerdef(oid) from pg_trigger
--      where tgrelid = 'auth.users'::regclass and not tgisinternal;
