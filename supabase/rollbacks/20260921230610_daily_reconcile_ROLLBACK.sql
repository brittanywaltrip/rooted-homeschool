-- Rollback for daily_reconcile. Staging first.
--
-- FAST PATH (no DDL, stops every tab at its next call):
--   update rooted_private.app_switches set enabled = false, updated_at = now() where name = 'daily_reconcile';
--
-- FULL REMOVAL. The log is KEPT as evidence of what ran; drop it by hand after
-- exporting it. Rows already re-dated keep their dates (source
-- 'daily_reconcile'); the next parent action or re-date moves them again.
begin;
revoke all on function public.apply_daily_reconcile(uuid, date, jsonb, jsonb) from authenticated;
drop function if exists public.apply_daily_reconcile(uuid, date, jsonb, jsonb);
delete from rooted_private.app_switches where name = 'daily_reconcile';
commit;
