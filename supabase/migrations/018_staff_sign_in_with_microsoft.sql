-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — staff sign in with Microsoft only (SSO + HTTPS plan, phase B2)
-- Migration: 018_staff_sign_in_with_microsoft.sql
--
-- WRITTEN, NOT APPLIED. You apply it in the Supabase SQL editor, on the dev project first. Applying it changes nothing
-- by itself: the switch it adds starts OFF. Turn it on only after "Sign in with Microsoft" works for every staff member
-- (plan phase A) and the break-glass admin is listed below.
--
-- What it does, once switched on: a staff session (admin, pm, staff) that was NOT made through Microsoft gets no access
-- to anything behind public.is_internal() or public.auth_user_role() — the company record (app_state), files, tables —
-- unless the account is on the break-glass list. Clients are never affected. The app and the server ask the same
-- question (public.session_allowed()) so they refuse such a session with a clear message instead of showing an empty app.
--
-- It includes migration 016's rule (an inactive account has no access), so it is correct whether or not 016 was applied.
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- The switch. One row. No policies: only the SQL editor (or the service role) reads or changes it.
CREATE TABLE IF NOT EXISTS public.security_settings (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  staff_microsoft_only  BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;

-- Accounts that may still sign in with a password while the switch is on (keep this to one or two people). Each must
-- have set up two-step sign-in (authenticator app, plan phase C) and give its code: without it, a break-glass password
-- session is refused. Emails in lower case. No policies, as above.
CREATE TABLE IF NOT EXISTS public.break_glass_accounts (
  email       TEXT PRIMARY KEY CHECK (email = lower(email)),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.break_glass_accounts ENABLE ROW LEVEL SECURITY;

-- Does the current session meet the sign-in rules?
-- 1. Two-step sign-in (plan phase C), always: anyone who has set up an authenticator app must have given its code this
--    session (the token's "aal" claim is "aal2"). People who never set one up are not affected.
-- 2. Microsoft only for staff, when the switch is on: true for anyone who is not internal staff, for a break-glass
--    account that gave its authenticator code, and for a session made through Microsoft (Supabase records how a session
--    was made in the token's "amr" claim: method "oauth" for Microsoft; "password" for the password form).
CREATE OR REPLACE FUNCTION public.session_allowed()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    (NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified')
      OR COALESCE(auth.jwt() ->> 'aal', '') = 'aal2')
    AND CASE
      WHEN NOT COALESCE((SELECT staff_microsoft_only FROM public.security_settings WHERE id = 1), false) THEN true
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'pm', 'staff')) THEN true
      WHEN lower(COALESCE(auth.jwt() ->> 'email', '')) IN (SELECT email FROM public.break_glass_accounts)
        THEN COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
      ELSE EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS m(entry)
        WHERE m.entry ->> 'method' IN ('oauth', 'sso/saml')
      )
    END
$$;
REVOKE ALL ON FUNCTION public.session_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_allowed() TO authenticated;

-- The two helpers every policy already uses. Same names, arguments and return types, so no policy is touched.
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND active AND public.session_allowed()
$$;

CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE((SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid() AND active), false)
     AND public.session_allowed()
$$;

-- ── Check (read-only) ─────────────────────────────────────────────────────────
--   select * from public.security_settings;            -- staff_microsoft_only = false until you switch it on
--   select * from public.break_glass_accounts;          -- empty until you add the break-glass admin
--   select proname, prosrc from pg_proc where proname in ('session_allowed','auth_user_role','is_internal');
--
-- ── Before switching on (dev first) ───────────────────────────────────────────
-- 1. Sign in to Task Hub with Microsoft as a staff member. In the browser console run:
--      JSON.parse(atob((await window._supabase.auth.getSession()).data.session.access_token.split('.')[1])).amr
--    It must list {"method":"oauth", ...}. (If it shows another method name, tell Claude before going further.)
-- 2. The break-glass admin signs in with their password and sets up two-step sign-in (the "Two-step sign-in" button,
--    with TWO_STEP_SIGNIN=1), signs out, and checks that signing in now asks for the code. Then add them:
--      insert into public.break_glass_accounts (email, note) values ('director@etchersolutions.com', 'break-glass');
-- 3. Switch on:                   update public.security_settings set staff_microsoft_only = true, updated_at = now() where id = 1;
-- 4. Test: a staff password sign-in is refused with "Staff accounts sign in with Microsoft"; Microsoft sign-in works;
--    the break-glass admin can still use the password plus their code; a client login is unaffected (a client who set
--    up two-step sign-in is asked for their code, as before the switch).
--
-- ── Switch off (immediate, no code change) ────────────────────────────────────
--   update public.security_settings set staff_microsoft_only = false, updated_at = now() where id = 1;
--
-- ── Roll back completely (restores migration 016's helpers) ───────────────────
--   CREATE OR REPLACE FUNCTION public.auth_user_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path = public AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() AND active $$;
--   CREATE OR REPLACE FUNCTION public.is_internal() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path = public AS $$ SELECT COALESCE((SELECT role IN ('admin', 'pm', 'staff') FROM public.profiles WHERE id = auth.uid() AND active), false) $$;
--   DROP FUNCTION public.session_allowed();
--   DROP TABLE public.break_glass_accounts;
--   DROP TABLE public.security_settings;
