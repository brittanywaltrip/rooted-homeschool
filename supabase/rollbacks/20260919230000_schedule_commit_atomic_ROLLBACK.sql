-- Restores the pre-change state: the client regains DELETE on lessons and the
-- two functions are removed. This REOPENS the unfinished DELETE/INSERT window;
-- only for a broken legitimate write path.
drop function if exists public.schedule_commit(uuid, jsonb, uuid[], uuid[], jsonb, jsonb, text);
drop function if exists public.delete_lesson(uuid);
grant delete on public.lessons to authenticated;
grant delete on public.lessons to anon;
grant insert on public.lessons to anon;
