# Containment migrations: filename to ledger map

These five migrations were applied by hand through the Supabase MCP
(`apply_migration`), staging first and production second, so each has TWO
ledger versions. Per CLAUDE.md ("Filenames do not match the migration ledger"),
the repo filename carries the PRODUCTION version. Every file's first line says
ALREADY APPLIED. None may be re-run, and `supabase db push` /
`supabase migration up` stay banned: against staging they would see these five
filenames as unapplied and run them again.

| Order | Name (ledger `name`) | Production `gvkbegvvmhcrmxdorctk` | Staging `cvgqovweybggrqakhdtd` | Rollback file |
|---|---|---|---|---|
| 1 | `rooted_private_schema_prerequisite` | `20260921200005` | `20260921194104` | `supabase/rollbacks/20260921200005_rooted_private_schema_prerequisite_ROLLBACK.sql` |
| 2 | `lesson_date_change_audit` | `20260921200028` | `20260921174245` | `supabase/rollbacks/20260921200028_lesson_date_change_audit_ROLLBACK.sql` |
| 3 | `lessons_block_stale_resync` | `20260921210738` | `20260921172242` | `supabase/rollbacks/20260921210738_lessons_block_stale_resync_ROLLBACK.sql` |
| 4 | `lessons_resync_parent_intent_window` | `20260921210801` | `20260921174221` | `supabase/rollbacks/20260921210801_lessons_resync_parent_intent_window_ROLLBACK.sql` |
| 5 | `lessons_resync_intent_session_scope` | `20260921210815` | `20260921183953` | `supabase/rollbacks/20260921210815_lessons_resync_intent_session_scope_ROLLBACK.sql` |

Staging applied them in the order 3, 4, 2, 5, 1 (1 was a no-op there).
Production applied them in the order 1 to 5 above, which is the only order
that works on a database without the `rooted_private` schema; rehearsed by
`supabase/tests/containment-rehearsal/run.sh`.

The function bodies were compared after the production apply: all eight
(`lessons_block_stale_resync`, `lessons_note_schedule_intent`,
`curriculum_goals_note_schedule_intent`, `lessons_audit_date_change`,
`rooted_private.record_blocked_resync`, `rooted_private.note_schedule_intent`,
`rooted_private.has_recent_schedule_intent`,
`rooted_private.record_lesson_date_change`) are identical on both projects.

To check a ledger before touching any of these:

    select version, name from supabase_migrations.schema_migrations
     where name in ('rooted_private_schema_prerequisite', 'lesson_date_change_audit',
                    'lessons_block_stale_resync', 'lessons_resync_parent_intent_window',
                    'lessons_resync_intent_session_scope')
     order by version;

Fast rollbacks (take one piece out of the write path, no DDL on functions):

    ALTER TABLE public.lessons DISABLE TRIGGER lessons_audit_date_change;          -- audit
    ALTER TABLE public.lessons DISABLE TRIGGER lessons_block_stale_resync;         -- block, or any intent-CHECK failure
    ALTER TABLE public.lessons DISABLE TRIGGER lessons_note_schedule_intent;       -- intent signals
    ALTER TABLE public.curriculum_goals DISABLE TRIGGER curriculum_goals_note_schedule_intent;
