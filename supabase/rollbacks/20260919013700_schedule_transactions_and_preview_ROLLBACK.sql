-- Rollback for 20260919013700 + 20260919013822.
--
-- Safe while schedule_transactions is empty and nothing calls the functions.
-- Check first:
--   select count(*) from schedule_transactions;

drop function if exists public.schedule_preview(text, jsonb);
drop function if exists public.schedule_state_version(uuid[]);
drop table if exists public.schedule_transactions;
