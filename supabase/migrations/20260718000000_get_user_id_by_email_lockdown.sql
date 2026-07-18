-- Lock down public.get_user_id_by_email(text) to service_role only.
--
-- This SECURITY DEFINER function queries auth.users, so any role that can
-- execute it can enumerate whether an email has a Rooted account. The only
-- caller is app/api/gift/route.ts, which uses the SUPABASE_SERVICE_ROLE_KEY,
-- so no anon or authenticated access is needed. Revoking execute from public,
-- anon, and authenticated closes the user-enumeration surface entirely.
--
-- This tightens the prior policy (which granted authenticated) down to
-- service_role only, matching actual usage.
--
-- NOTE: Already applied to the live DB on 2026-07-18. This file is a record of
-- that change for migration history; it was not run via this migration.
revoke execute on function public.get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;
