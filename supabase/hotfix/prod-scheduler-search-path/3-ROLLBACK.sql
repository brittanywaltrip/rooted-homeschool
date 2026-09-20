-- EXECUTABLE ROLLBACK. Restores each previous search_path EXACTLY.
--
-- READ THIS FIRST: rolling back REOPENS the temp-object shadowing hole on all
-- four functions. It is here because a rollback that does not exist is not a
-- plan, not because reverting is expected. Prefer diagnosing forward.
--
-- Values below are the ones read from production on 2026-09-19 by 1-PREFLIGHT.sql:
--   schedule_preview           search_path=public
--   schedule_state_version     search_path=public
--   schedule_seal_proposal     search_path=public, extensions
--   schedule_commit_dry_run    search_path=public, extensions

begin;

alter function public.schedule_preview(text, jsonb)
  set search_path = public;

alter function public.schedule_state_version(uuid[])
  set search_path = public;

alter function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean)
  set search_path = public, extensions;

alter function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text)
  set search_path = public, extensions;

commit;
