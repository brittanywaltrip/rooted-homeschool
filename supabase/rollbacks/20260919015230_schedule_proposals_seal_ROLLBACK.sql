-- Rollback for 20260919015230 + 20260919015417.
--
-- Safe at any time: schedule_proposals is operational metadata, no scheduler
-- path reads it, and dropping it cannot change any family's schedule. Any
-- open confirmation dialogs simply fail to commit and re-preview.

drop function if exists public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean);
drop function if exists public.schedule_canonicalize_proposal(text, uuid[], jsonb, boolean, boolean);
drop table if exists public.schedule_proposals;
