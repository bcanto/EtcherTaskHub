-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO dev-project bootstrap (plan §15.3, dev/verification ONLY)
-- Migration: supabase/dev/000_dev_bootstrap.sql
--
-- Run this ONCE, against a brand-new, empty Supabase project created just for ISO
-- verification (suggested name: etcher-taskhub-dev) — NEVER against the production
-- project (wowwiafaqzovlfwzyktj). This is not part of the numbered production migration
-- sequence (001-013) and must never be applied there.
--
-- What this is: only the pieces of 001/002/004/007/008 that ISO's RLS functions and
-- iso-db-verify.cjs actually need to exist — auth.users -> profiles wiring, the 3 helper
-- functions ISO's own RLS/ops layer never uses directly but the *pattern* is verified
-- against (is_internal, auth_user_role, auth_user_client_id), and the "new accounts get
-- no access" default. It deliberately does NOT recreate the full production schema
-- (workboards/tasks/clients/etc.) — ISO never touches the blob or those tables, and a dev
-- project only needs enough to mint real Supabase-authenticated staff/client sessions.
--
-- Difference from production's 001: profiles.client_id is TEXT with NO foreign key (there
-- is no `clients` table in this dev project at all — ISO's client existence check reads
-- the app_state blob in production; iso-db-verify.cjs uses plain fixture client ids like
-- 'c1'/'c2' that don't need to exist anywhere else, matching how the offline store's own
-- OFFLINE_CLIENTS fixture works in api/iso.js).
--
-- After this: run 009_iso_core.sql (and later 010-013 as they're written) from
-- supabase/migrations/ against this same dev project, then `.agents/iso-db-verify.cjs`.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'pm', 'staff', 'client');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PROFILES — extends auth.users. client_id is TEXT, no FK (see header note).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id                    UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email                 TEXT          NOT NULL CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  role                  user_role     NOT NULL DEFAULT 'client',
  client_id             TEXT,
  display_color         TEXT          NOT NULL DEFAULT '#64748b' CHECK (display_color ~* '^#[0-9a-f]{6}$'),
  initials              TEXT          CHECK (char_length(initials) <= 3),
  capacity_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (capacity_hours_per_day >= 0 AND capacity_hours_per_day <= 24),
  active                BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_role      ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_client_id ON public.profiles(client_id) WHERE client_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- New accounts get NO access until explicitly promoted (plan/008's fix, applied here from
-- the start rather than retrofitted): role defaults to 'client' with no client_id, which
-- matches no RLS policy and no ISO membership. iso-db-verify.cjs promotes its 4 test
-- accounts itself, via the service role key, right after creating them.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, client_id)
  VALUES (
    NEW.id,
    left(COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), 100),
    NEW.email,
    'client',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS (plan §15.3: auth_user_role/is_internal from 002,
-- auth_user_client_id returning TEXT from 004)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_user_client_id()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid()
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS on profiles (007's final shape: no "client read internal staff names"
-- policy, and "own update" cannot change role/client_id/active/email)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: own row" ON public.profiles;
CREATE POLICY "profiles: own row" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles: internal read all" ON public.profiles;
CREATE POLICY "profiles: internal read all" ON public.profiles
  FOR SELECT USING (public.is_internal());

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

DROP POLICY IF EXISTS "profiles: admin manage" ON public.profiles;
CREATE POLICY "profiles: admin manage" ON public.profiles
  FOR ALL USING (public.auth_user_role() = 'admin');

-- Lock the function down the same way 009 locks down every iso_* function —
-- SECURITY DEFINER functions are still subject to EXECUTE grants, and Supabase
-- grants EXECUTE to PUBLIC on new functions by default.
REVOKE ALL ON FUNCTION public.auth_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.auth_user_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_client_id() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_internal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_internal() TO anon, authenticated, service_role;

-- ── Check (read-only) — run these and look at the results ─────────────────────
--   select column_default from information_schema.columns
--     where table_schema='public' and table_name='profiles' and column_name='role';  -- 'client'::user_role
--   select policyname, cmd from pg_policies where tablename='profiles' order by 1;    -- 4 rows, no "client read internal staff names"
--   select proname from pg_proc where proname in ('auth_user_role','auth_user_client_id','is_internal');  -- 3 rows
--
-- ── Rollback ──────────────────────────────────────────────────────────────────
--   Not meant to be rolled back piecemeal — this is a throwaway dev project.
--   To start over: delete the whole Supabase project and create a fresh one.
