# Release handoff: PR #87 (builder rebuild in one transaction, make-ups)

Status on 2026-09-22: **production on hold.** #87 is a draft at 503810c, and
nothing from it is applied, merged or deployed to production. Production runs
978d7c6 (`dpl_9ZuwGDP9HSZoTggh6gt38H3UR8LQ`). Its ledger ends at
20260921210815 (115 rows).

## 1. The 9 skipped smoke tests

The smoke run on 503810c (the rooted-staging deployment of that SHA) had
24 passed, 9 skipped and 0 failed. The dot reporter does not name skipped
tests, and a green run keeps no artifact, so these were worked out from the
skip conditions in `e2e/` against the staging e2e account (`1954d827`).

That account has 1 goal, no completed goals, 0 resources, 0 school years,
no Guitar activity, 5 lessons this week and 7 next week.

Seven skips are certain:

| # | Test | Why it skips |
|---|------|--------------|
| 1 | critical-paths: curriculum edit | unconditional `test.skip` |
| 2 | critical-paths: curriculum delete | unconditional `test.skip` |
| 3 | close-year spec | `CLOSE_YEAR_SPEC` is unset (opt-in by design) |
| 4 | FLOW 7, Guitar Lessons | no Guitar activity on the account |
| 5 | FLOW 8, completed curriculum | no completed goal |
| 6 | shared resource `/r/<id>` | 0 resources |
| 7 | Plan "Download Progress Report" paywall | no school year |

The other two cannot be named from this run. The candidates are FLOW 4 move
("Move here" count 0), FLOW 5 Win tile, critical-paths school-year creation,
and onboarding. Running the suite with `--reporter=list` against the same
deployment would name them. Nothing is lost by leaving them unnamed, because
none of the four touches the changed paths.

What smoke covers of the changed paths:

- **Builder save through `apply_builder_rebuild`:** covered for create, the
  backfill save (`previewAndSave`) and the links-active-year save.
- **Un-tick through `reopen_lesson`:** covered only for a lesson ahead of the
  pointer (FLOW 2 ticks and then unticks). That un-tick returns `requeued`,
  not a make-up, and FLOW 2's restore is best effort.
- **Not covered by smoke:** re-saving an existing goal (the 1Q path; skips 1
  and 2 are exactly the edit/delete specs), and a make-up un-tick. Both are
  covered by the unit tests (`phase2-commit.test.ts`, `reopen-lesson.test.ts`),
  the SQL rehearsal (T1 to T22), and the rooted-staging walkthroughs on
  503810c and on the integration build 17fa5f6.

## 2. Staging is back on #84

rooted-staging runs `dpl_snzNXWYkuTQDTywCAKnViGGRmTms` (#84 at 4615e3e,
READY), and nothing has been deployed there since. The alias's `/api/health`
reports:

`{"env":"staging","projectRef":"cvgqovweybggrqakhdtd","identityOk":true,"commit":"4615e3e1a6dc71a511ac556e7206876af246ad9d"}`

The walkthrough account family-c is re-locked, its sessions are deleted, and
no test trigger is left behind.

The rooted-staging DATABASE still has both #87 migrations. That is harmless
while #84 is deployed there, because #84's app never calls them.

## 3. Merge order and conflict resolution

**Why the order matters.** After an un-tick, #84 re-dates the rest of the
curriculum (`resyncGoalsForParent`). That re-date treats pinned rows as holds,
so it only projects around a make-up if the pin already exists when it runs.
The order must be:

1. un-complete, and the pointer recomputes (the lessons trigger)
2. make-up pin
3. re-date

Steps 1 and 2 are one transaction, `reopen_lesson`. Step 3 runs in the `after`
callback of `untickLessonThen`, which is called only when that transaction
succeeded. Re-dating before the pin puts the next lesson on the make-up's day.
Both orders are pinned by tests: `reopen-lesson.test.ts`, "real re-date
BEFORE/AFTER the make-up pin".

**Reference resolution.** Branch `integration/pr84-pr87` at 17fa5f6 is #84 at
4615e3e merged with #87 at 503810c. The full suite passes there (1789 pass,
0 fail), and the combined staging walkthrough ran on it. If #84's head moves
past 4615e3e, redo the merge with the rules below instead of copying files
across.

The files that conflict, and how to resolve each one:

- **`app/dashboard/page.tsx` (Today `toggleLesson`, uncomplete branch):**
  - Take #87's `untickLessonThen(supabase, { lessonId: id, localDay: today }, after)`.
  - Put #84's `redateAfterCompletionChange([lesson.curriculum_goal_id], "uncompletion")`
    INSIDE `after`.
  - Delete #84's client `.update({ completed: false, ... })`, the
    `recomputeCurrentLesson` call, and the re-date that followed them.
    `reopen_lesson` does that write, with the same columns.
- **`app/components/PlanV2/usePlanLessonActions.ts` (Plan `toggleLesson`):**
  the same rule.
  - `after` first patches the local make-up date and pin.
  - Then it runs `await redateAfter(lesson?.curriculum_goal_id, "uncompletion")`.
  - On failure it reverts the tick and throws.
- **`app/components/PlanV2/index.tsx`:** both PRs add the same
  `toggleLessonReported` wrapper. Keep one copy. `toggleLessonWithLog` and
  both `onToggleLessonDone` call sites use it.
- **`app/lib/scheduler.ts`:** the two PRs change different regions, so it
  auto-merges.
  - #84 changes `PARENT_RESPREAD_SOURCE` and the code after `resyncGoalsForParent`.
  - #87 changes the projector, the make-up helpers, `projectionOverCap` and
    `planPhase2Rows`.
- **`app/lib/completion-respread.test.ts` (#84's test file):**
  - Replace the `.select("id")` uncheck assertions with `assertRedateAfterUntick`.
    It asserts the re-date sits inside `untickLessonThen`'s `after`.
  - Move two expectations one school day earlier, as described below.

**Changed over-pace expectations for #84.** #87 keeps a card that was done
today on today. The old projector let it spill onto tomorrow's capacity. So
when a family finishes more than the day's pace, the next lesson is tomorrow,
not the day after:

| #84 test | Before | After #87 |
|----------|--------|-----------|
| "finishing ahead" | lesson 5 at `plus(2)` | lesson 5 at `plus(1)` |
| "several completions" | lesson 6 at `plus(2)` | lesson 6 at `plus(1)` |

The new dates match what Today shows tomorrow. The old ones left an empty
school day, and the staging walkthrough confirmed the new behaviour. No other
#84 expectation changes.

**Recommended order:**

1. Apply both #87 migrations to production (section 4). They are safe under
   978d7c6 and under #84.
2. Merge #84 as its owner decides. #84 works without #87 and does not need
   these functions.
3. Update #87 from main using the resolution above, confirm the suite passes,
   and push. CI plus smoke must pass on a rooted-staging deployment of that
   exact head.
4. Mark #87 ready, review, merge, and deploy production.

If #87 is merged first instead, #84 gets the same resolution when it updates
from main, with the same two moved expectations.

Either way, the #87 app must not reach production before both migrations are
live there. The app has no fallback. Without the functions, every builder
save and every un-tick fails: nothing is written, but the family sees an error.

## 4. Migration compatibility with the deployed app (978d7c6)

Checked read-only against production on 2026-09-22:

- **Nothing existing changes.** Neither migration alters a table, column,
  trigger, policy or existing function.
  - They create `public.apply_builder_rebuild`, `public.reopen_lesson` and
    `rooted_private.lesson_carries_work`.
  - Production has none of the three (no name clash).
  - 978d7c6 calls none of them. Its builder still does its client-side
    DELETE+INSERT, and its un-tick still does its client-side update. Both
    behave exactly as today.
- **Prerequisites match rooted-staging exactly.** The same md5 on each of these:
  - the `lessons` and `curriculum_goals` columns (types and nullability)
  - every trigger definition on both tables, including
    `trg_lessons_recompute_current_lesson`, `lessons_block_stale_resync` and
    `trg_lessons_block_server_side_completion`
  - every trigger function body
  - `recompute_curriculum_current_lesson`

  The CHECK constraints on `lessons` are also identical. So the rehearsal and
  the staging runs apply to production as-is.
- **The `rooted_private` schema exists on production.**
- **`scheduled_source = 'reopened'` needs no schema change.** The column is
  free text with no CHECK constraint. The 978d7c6 code treats an unknown source
  as hand-placed (`isProjectorPlacedSource` is false), which is correct for a pin.
- **Function permissions:**
  - Production's default privileges in `public` grant EXECUTE on new functions
    to `anon`, `authenticated` and `service_role`. Staging's are the same.
    So the explicit `revoke all ... from public, anon` in both files is
    required.
  - Result on rooted-staging after applying:
    `apply_builder_rebuild` and `reopen_lesson` = `postgres, authenticated,
    service_role`, both SECURITY DEFINER with a pinned `search_path`, and no
    `anon`.
  - `lesson_carries_work` = `postgres` only. It is not in `public`, so no
    default grant applies, and it is revoked from `public, anon, authenticated`
    as well.
  - It is reached only from inside the SECURITY DEFINER functions, which run as
    their owner, so clients need no USAGE on `rooted_private`.
  - Production will come out the same, because `apply_migration` runs as
    `postgres` under the same default ACL.
- **PostgREST.** Production has the `pgrst_ddl_watch` event trigger enabled,
  so the schema cache reloads on CREATE FUNCTION. Run
  `notify pgrst, 'reload schema';` anyway.

**Production apply steps (for when the hold lifts):**

1. `apply_migration` with name `apply_builder_rebuild`, using the body of
   `20260922021607_apply_builder_rebuild.sql`. Then `apply_builder_rebuild_work_guard`
   with `20260922025647_...`. Order matters: the second replaces the first's
   function body.
2. Read back both versions:
   `select version, name from supabase_migrations.schema_migrations where name like 'apply_builder_rebuild%';`
3. Verify, all expected values from staging:
   - The md5 of each function's `prosrc` matches the staging md5 and the file.
     `lesson_carries_work` uses `chr()`; see the file header for why.
   - The ACLs are as listed above.
   - `select has_function_privilege('anon', 'public.reopen_lesson(uuid,date)', 'execute');`
     returns false.
4. Rename both repo files and both rollback files to the PRODUCTION versions,
   and record the staging versions (20260922021607, 20260922025647) in a ledger
   note, as `docs/MIGRATION-LEDGER-CONTAINMENT.md` did.

## 5. Rollback

**Order: app first, database last (if ever).**

1. **Roll the app back** in Vercel: instant rollback to the production
   deployment before #87.
   - If #87 ships straight onto 978d7c6, that is `dpl_9ZuwGDP9HSZoTggh6gt38H3UR8LQ`.
   - If #84 went first, it is #84's production deployment.
   - No migration needs to be reverted for this. The older apps ignore all
     three functions.
2. **Keep all three functions in place.** Tabs that are already open keep
   running the #87 bundle until they reload, and families leave the dashboard
   open for days. Those tabs call `apply_builder_rebuild` for every builder
   save and `reopen_lesson` for every un-tick, with no fallback.
   - `public.apply_builder_rebuild(uuid, date, jsonb, jsonb)` must stay, with
     EXECUTE for `authenticated`.
   - `public.reopen_lesson(uuid, date)` must stay, with EXECUTE for `authenticated`.
   - `rooted_private.lesson_carries_work(text, integer)` must stay while the
     work-guard body of `apply_builder_rebuild` is installed, because that
     body calls it. `reopen_lesson` does not.

   Dropping any of them turns those tabs' saves and un-ticks into visible
   errors. Nothing is written, so no data is lost, but it is noise for no gain.
   Leaving them installed costs nothing, because nothing else calls them.
3. **Only if a function itself is at fault**, and only after the app rollback:
   - First, the work-guard rollback,
     `supabase/rollbacks/20260922025647_apply_builder_rebuild_work_guard_ROLLBACK.sql`.
     It has a manual middle step, so work through it by hand:
     1. `drop function public.reopen_lesson(uuid, date)`
     2. Re-run the whole of `20260922021607_apply_builder_rebuild.sql`. That
        restores the base `apply_builder_rebuild` body, which does not call
        the helper, and restores its grants.
     3. `drop function rooted_private.lesson_carries_work(text, integer)`

     Dropping the helper before step 2 would break every builder save that is
     still running the work-guard body.
   - Then, only if the builder function itself has to go, run
     `supabase/rollbacks/20260922021607_apply_builder_rebuild_ROLLBACK.sql`.
     It drops `apply_builder_rebuild`.
   - Never run them the other way round. The work-guard rollback re-creates
     `apply_builder_rebuild` in its step 2.
   - Run `notify pgrst, 'reload schema';` after each.

**What data the new app leaves behind, and how the older app treats it.**

- **Make-up rows** (`queue_pinned = true`, `scheduled_source = 'reopened'`,
  behind the pointer). These are valid rows. Notes and minutes are kept.
  - 978d7c6's `isPinProjectable` ignores pins at or below `current_lesson`, so
    after a rollback those lessons stop showing on Today and Plan. That is
    today's pre-fix behaviour, not new damage.
  - A builder re-save of such a goal on the old app can hit 1Q again.
  - Count them before and after a rollback:
    `select count(*) from lessons where scheduled_source = 'reopened' and not completed;`
  - Re-shipping #87 makes them visible again, with no repair needed.
- **Builder saves** written by `apply_builder_rebuild` are ordinary lesson rows
  (`wizard_create`), the same shape the old client path writes.

Nothing in the rollback touches customer rows.
