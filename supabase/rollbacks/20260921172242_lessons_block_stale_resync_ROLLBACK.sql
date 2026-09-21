-- Rollback for 20260921172242_lessons_block_stale_resync.
--
-- READ FIRST: removing this re-permits the unwanted writes IMMEDIATELY. Any
-- browser tab still running a bundle built before fix/scheduler-containment,
-- with NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED inlined as true, resumes rewriting
-- lesson dates as 'queue_resync' on its next load.
--
-- It does not replay blocked attempts, does not reverse legitimate edits made
-- while it was on, and does not repair any earlier batch.
--
-- LEVEL 1, fastest, no DDL on the function or table:
--   ALTER TABLE public.lessons DISABLE TRIGGER lessons_block_stale_resync;
-- Re-arm with:
--   ALTER TABLE public.lessons ENABLE TRIGGER lessons_block_stale_resync;
--
-- LEVEL 2, full removal. The audit table is KEPT: it is the only record of
-- what was refused while containment was on. Drop it separately, later, and
-- only after exporting it.

begin;
drop trigger if exists lessons_block_stale_resync on public.lessons;
drop function if exists public.lessons_block_stale_resync();
drop function if exists rooted_private.record_blocked_resync(uuid, date, date, text);
-- public.lessons_resync_blocked is intentionally left in place.
-- rooted_private is left in place; it is empty once the helper is gone.
commit;
