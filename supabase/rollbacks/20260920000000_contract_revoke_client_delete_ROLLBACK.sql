-- Restores the client's direct DELETE on lessons. This REOPENS the unfinished
-- DELETE/INSERT window that loses lessons; it is for a broken legitimate write
-- path, not for convenience.
grant delete on public.lessons to authenticated;

-- DELIBERATELY NOT RESTORED: `grant delete on public.lessons to anon` and
-- `grant insert on public.lessons to anon`.
--
-- Those grants existed but were closed by RLS, so nothing depended on them and
-- restoring them would quietly re-add anonymous write privileges as a side
-- effect of an unrelated rollback. If they are genuinely wanted back, grant
-- them in their own reviewed migration where that is the visible intent.
