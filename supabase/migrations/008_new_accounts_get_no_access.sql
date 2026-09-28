-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — New accounts get no access until invited
-- Migration: 008_new_accounts_get_no_access.sql
--
-- CRITICAL, found 2026-09-28. The auth trigger from 001 (handle_new_auth_user) gave every new
-- account the role 'staff', and profiles.role defaulted to 'staff'. 'staff' is internal
-- (public.is_internal() = admin/pm/staff), so with public sign-up switched on in Supabase Auth,
-- anyone on the internet could sign up, confirm an email, and read and overwrite app_state —
-- the whole company database — plus every stored file.
--
-- Fix: a new account starts as role 'client' with NO client_id. That matches no RLS policy
-- (client policies need auth_user_client_id()), is refused by /api/portal-* (requireClientCaller
-- needs a client_id) and is not internal. Invites are unaffected: api/invite-user.js always sets
-- the real role (and client_id) through upsert_profile straight after creating the user — which
-- is how invited clients already got 'client' over the old 'staff' default.
--
-- Also switch off public sign-up: Supabase → Authentication → Sign In / Providers →
-- "Allow new users to sign up" = off. Invites keep working.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'client';

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, client_id)
  VALUES (
    NEW.id,
    left(COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), 100),
    NEW.email,
    'client',   -- no access: not internal, and no client_id so no client data either
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── Check (read-only) ─────────────────────────────────────────────────────────
--   select column_default from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name='role';   -- 'client'::user_role
--   select pg_get_functiondef('public.handle_new_auth_user'::regproc);             -- shows 'client'
