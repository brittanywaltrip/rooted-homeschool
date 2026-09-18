-- ROLLBACK for 20260917000000_security_fix_1_profiles_entitlement_guard.sql
--
-- Restores public.profiles to exactly its 2026-09-17 pre-fix state: `authenticated`
-- holding a table-level UPDATE grant on all columns, `anon` holding table-level
-- INSERT and UPDATE, and no guard trigger.
--
-- WARNING: running this REOPENS the entitlement self-write hole. Any signed-in
-- user can then set their own is_pro / plan_type / subscription_status / Stripe
-- ids through a PostgREST PATCH. Only run it if the fix has broken a legitimate
-- write path, and re-apply a corrected version the same day.
--
-- Takes under ten seconds. Touches no row data, so nothing needs restoring after.
--
-- Run as `postgres` (Supabase dashboard SQL editor).

begin;

drop trigger if exists profiles_guard_entitlement on public.profiles;
drop function if exists public.guard_profile_entitlement();

-- Clear the column allowlist, then restore the blanket table grants.
revoke update on public.profiles from authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.profiles to anon;

commit;

-- Verify (expect 44, 44, 0):
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='profiles'
--      and grantee='authenticated' and privilege_type='UPDATE';
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='profiles'
--      and grantee='anon' and privilege_type='UPDATE';
--   select count(*) from pg_trigger
--    where tgrelid='public.profiles'::regclass and not tgisinternal;
