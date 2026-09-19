-- ============================================================================
-- CONTRACT STEP. Apply this LAST, and only after the callers are deployed.
-- ============================================================================
-- Expand -> deploy -> contract:
--
--   1. EXPAND   20260919230000, 233000, 234000, 235000 add the RPCs and the
--               state digest. They only add; the running app keeps working.
--   2. DEPLOY   ship the app that calls them, and verify it on staging.
--   3. CONTRACT this file removes the client's direct DELETE.
--
-- Applying this before step 2 breaks every delete in the deployed bundle.
-- Applying step 2 before step 1 calls functions that do not exist. The order
-- is not a preference.
--
-- A column-level revoke cannot subtract from a table-level grant, and DELETE
-- has no column form, so this is the whole privilege.
revoke delete on public.lessons from authenticated;
revoke delete on public.lessons from anon;

-- anon also held INSERT on lessons with no policy to match it. RLS closes it
-- today, which makes the grant dead weight that would come alive the moment a
-- permissive anon policy were added. Removed while we are here.
revoke insert on public.lessons from anon;
