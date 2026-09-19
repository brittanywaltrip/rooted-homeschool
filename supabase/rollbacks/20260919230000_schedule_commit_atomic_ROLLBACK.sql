-- Rolls back the EXPAND migration by removing what it added. Nothing else.
--
-- It used to also `grant delete on public.lessons` to authenticated AND anon,
-- and `grant insert` to anon -- left over from when the revoke lived in the
-- forward migration. The revoke now lives in 20260920000000, so restoring
-- grants here would have handed anon write privileges as a side effect of an
-- unrelated rollback, with nothing in the diff to say so.
--
-- Privileges are changed only by the migration whose subject is privileges.
drop function if exists public.schedule_commit(uuid, jsonb, uuid[], uuid[], jsonb, jsonb, text);
drop function if exists public.delete_lesson(uuid);
