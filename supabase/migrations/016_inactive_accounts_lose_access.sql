-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — an inactive account loses all database access
-- Migration: 016_inactive_accounts_lose_access.sql
--
-- WRITTEN, NEVER APPLIED. You apply it (Supabase → SQL editor), after the app release that switches a
-- login off when a staff member is removed (audit C2, 2026-10-17).
--
-- Why: public.auth_user_role() and public.is_internal() looked only at profiles.role. A staff member who
-- was removed (profiles.active = false, login banned) but still held a valid session could keep reading
-- and writing the shared company record, files and everything else behind those two functions until the
-- session token expired (up to an hour), and a deactivated profile that was somehow still signed in was
-- never refused. Now an inactive profile has no role at all: auth_user_role() returns NULL and
-- is_internal() returns false, so every policy that uses either (app_state, storage, tables) refuses it.
-- A profile can still read its own row, which is how the app tells a person "this account is switched off".
--
-- Nothing else changes: same names, same arguments, same return types, so no policy is touched.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- Returns the role of the currently authenticated user, or NULL when the account is switched off.
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND active
$$;

-- True for an active internal staff member (admin, pm, staff). Clients and inactive accounts are false.
CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE((SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid() AND active), false)
$$;

-- ── Check (read-only) — run these and look at the results ─────────────────────
-- a) both functions now mention "active":
--      select proname, prosrc from pg_proc where proname in ('auth_user_role', 'is_internal');
-- b) who is switched off right now (they should be people you removed):
--      select email, role, active from public.profiles where not active;
-- c) as a signed-in person you can test it with:  select public.is_internal(), public.auth_user_role();
--    (an active staff member sees  true | staff   — a switched-off account sees  false | null)
--
-- Roll back (restores the previous behaviour):
--   CREATE OR REPLACE FUNCTION public.auth_user_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path = public AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
--   CREATE OR REPLACE FUNCTION public.is_internal() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path = public AS $$ SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid() $$;
