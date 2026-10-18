-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — upsert_profile: recorded, and only the server can run it
-- Migration: 019_upsert_profile_server_only.sql
--
-- Audit M5 (2026-10-16): public.upsert_profile saves the profile of every new login (api/invite-user.js calls it), but
-- it was created by hand in the dashboard and never kept in a migration, so a new or rebuilt database could not create
-- logins. This file records it exactly as it is live (definition read from production on 18 October 2026) with two
-- changes, found while recording it:
--
-- 1. Only the server can run it. The function is SECURITY DEFINER (it runs with full rights and skips the access rules
--    on profiles) and checks nothing about who calls it, while Supabase lets the browser roles (anon, authenticated)
--    run new functions in the public schema by default. Unless that was taken away by hand, any signed-in person, a
--    client portal login included, could call it through the API and give themselves the admin role. The app never
--    calls it from the browser; only api/invite-user.js does, with the service-role key. So: revoke from public, anon
--    and authenticated; grant to service_role.
-- 2. A fixed search_path, like every other SECURITY DEFINER function in these migrations, so the function cannot be
--    pointed at a look-alike table or type.
--
-- Nothing else changes: same name, same arguments, same behaviour for the server, so adding staff and portal logins
-- keeps working. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_profile(p_id uuid, p_name text, p_email text, p_role text, p_display_color text, p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, display_color, client_id)
  VALUES (p_id, p_name, p_email, p_role::user_role, p_display_color, p_client_id)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, email = EXCLUDED.email,
    role = EXCLUDED.role, display_color = EXCLUDED.display_color,
    client_id = EXCLUDED.client_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_profile(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_profile(uuid, text, text, text, text, text) TO service_role;

-- ── Check (read-only) ─────────────────────────────────────────────────────────
-- Who can run it. Before this file, anon and authenticated may show true; after it, only service_role is true.
--   select r.rolname,
--          has_function_privilege(r.rolname, 'public.upsert_profile(uuid,text,text,text,text,text)', 'EXECUTE') as can_run
--   from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
--
-- ── If adding a person stops working afterwards ───────────────────────────────
-- The server must be calling without the service-role key: check SUPABASE_SERVICE_ROLE_KEY in Vercel. Do not give the
-- function back to anon or authenticated; that reopens the hole described above.
