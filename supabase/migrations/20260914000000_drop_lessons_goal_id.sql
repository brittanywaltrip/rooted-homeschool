-- ============================================================
-- NOT APPLIED. Written 2026-09-14; apply by hand (Supabase MCP apply_migration
-- or the SQL editor) after reading the live checks below. Migrations never run
-- on deploy (CLAUDE.md, "Migrations are applied by hand").
--
-- 1. Drop lessons.goal_id.
--    A leftover from before curriculum_goal_id. Verified live 2026-09-14:
--    0 of all lesson rows hold a value, no index, constraint, view or policy
--    references it, and no function reads it (_cleanup_respread_preview has a
--    RETURNS TABLE column named goal_id, which is unrelated). The app's last
--    readers were Today's three lesson selects and an `if (lesson.goal_id)`
--    branch that could never run; both are removed in the same commit as this
--    file.
--
-- 2. Drop the constraint lessons_goal_lesson_unique.
--    UNIQUE (curriculum_goal_id, lesson_number), non-partial, in no migration in
--    the repo. The partial unique index lessons_goal_lesson_number_unique
--    (WHERE curriculum_goal_id IS NOT NULL AND lesson_number IS NOT NULL)
--    enforces exactly the same thing, because a plain UNIQUE never treats NULLs
--    as equal. Checked before dropping it: nothing upserts on
--    (curriculum_goal_id, lesson_number). No app code passes that onConflict,
--    and no live function has an ON CONFLICT against lessons. A partial index
--    cannot be a PostgREST upsert target, so if that ever changes this drop is
--    what would break it. Error handling keys on SQLSTATE 23505, never on the
--    index name.
--
-- 3. The index ux_lessons_goal_lesson_number, exactly as
--    20260419000000_lessons_scheduler_integrity.sql defines it.
--    It is absent by that NAME on the live database, but the live database
--    already has an index with the identical definition under the name
--    lessons_goal_lesson_number_unique. Creating a second copy would add a
--    duplicate unique index to the busiest write table in the app. So the
--    CREATE is guarded: it runs only where no equivalent partial unique index
--    exists (a database rebuilt from the repo), and is a no-op on production.
--    The ordering matters: the guarantee is in place before step 2 removes
--    the older constraint.
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'lessons'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ~* '\(curriculum_goal_id, lesson_number\) WHERE \(\(curriculum_goal_id IS NOT NULL\) AND \(lesson_number IS NOT NULL\)\)'
  ) then
    create unique index if not exists ux_lessons_goal_lesson_number
      on public.lessons (curriculum_goal_id, lesson_number)
      where curriculum_goal_id is not null and lesson_number is not null;
  end if;
end $$;

alter table public.lessons drop constraint if exists lessons_goal_lesson_unique;

alter table public.lessons drop column if exists goal_id;
