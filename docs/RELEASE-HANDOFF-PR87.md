# Release handoff: PR #87 (builder rebuild in one transaction, make-ups)

Status at the end of 2026-09-22: **production on hold. Paused for the night.**
Nothing from #87 is applied, merged or deployed to production. #87 is a draft.
Production runs 978d7c6 (`dpl_9ZuwGDP9HSZoTggh6gt38H3UR8LQ`); its ledger ends
at 20260921210815 (115 rows).

**Verified code commit: acfa76573079fe5b94b2d3f8076ace93fbf875f1 (acfa765).**
This is the commit every check below ran against. Any later commit on the
branch that changes only this document leaves the code identical to acfa765,
so `git diff acfa765 -- . ':!docs/RELEASE-HANDOFF-PR87.md'` must be empty. If it
is not, the evidence below no longer applies and the checks must be re-run.

Evidence on acfa765:

- **CI:** scheduler invariant tests, the Vercel build and smoke all pass.
- **Smoke:** GitHub run 35687826500 against the rooted-staging deployment
  `dpl_8LMBCig1KraVGzNVSPMhGKouifoK`. 26 passed, 0 failed, 9 skipped, no retries.
- **The two browser regressions** (section 1b) both passed in that run.
- **Afterwards:** the test goals were deleted (0 left), and staging was restored
  to #84 (section 2).

The smoke job needs a rooted-staging deployment of the exact PR head. So a
docs-only head shows smoke pending or failed until one is deployed. That says
nothing about the code.

Standalone #87 verification is COMPLETE. What is left:

- **Before final review:** Brittany's code review. The two doc corrections from
  the 2026-09-22 session are made in this document: the named skip list
  (section 1) and the function-body comparison (section 4, step 3).
- **Before release (on hold):** both migrations to production before the app.
  The app has no fallback.
- **Waits for #84 to merge** (section 3a): the combined release-candidate checks.
- **First thing next session:** report #84's remaining release blockers, for
  the merge decision. Do not merge #84 or any PR without that review.

## 1. The 9 skipped smoke tests (named)

Smoke now runs with the list and JSON reporters. `scripts/smoke-skips.mjs`
writes every skipped test and its reason to the log and to the job summary.
From run 35687826500 on acfa765, all 9 are named, with the reason each test
gave:

| # | Project | Test | Reason it gave |
|---|---------|------|----------------|
| 1 | curriculum-writes | critical-paths: curriculum edit | static skip (edit selectors) |
| 2 | curriculum-writes | critical-paths: curriculum delete | static skip (delete trigger) |
| 3 | chromium | Lesson completion (V2) | no lessons in the current week for the test account |
| 4 | chromium | Close year flow | opt-in, `CLOSE_YEAR_SPEC` unset |
| 5 | chromium | FLOW 3, next-week Plan | no lessons in the next-week view |
| 6 | chromium | FLOW 7, Guitar Lessons | no "Guitar Lessons" recurring appointment |
| 7 | chromium | FLOW 8, completed curriculum | none on the account |
| 8 | chromium | Plan progress-report paywall | no school year |
| 9 | chromium | shared resource `/r/<id>` | no active resource |

Correction: the earlier version of this section, written from skip conditions
alone, guessed FLOW 4 and FLOW 5 as possibilities for the last two. The named
run shows they are #3 and #5 above.

None of the 9 covers a path #87 changes.

What smoke covers of the changed paths:

- **Builder save through `apply_builder_rebuild`:** the create save, the
  backfill save and the links-active-year save, plus the 1Q re-save regression
  (1b).
- **Un-tick through `reopen_lesson`:**
  - FLOW 2 unticks a lesson ahead of the pointer, which is `requeued`, not a
    make-up.
  - The Today un-tick regression (1b) unticks one behind the pointer, which is
    `made_up`.
- **Plan's un-tick:** there is no browser test. Unit tests cover it, and so do
  the manual staging walkthroughs on 503810c and the integration build 17fa5f6.

## 1b. Browser regressions (e2e/smoke/critical-paths.spec.ts)

These are tagged `@curriculum-writes`, so they run in the teardown project,
after every Today load.

The seed is the rows the builder writes for a family that started at lesson 11,
nine days ago, one lesson a day, every day. It is inserted as service_role and
scoped to the test account.

- **1Q re-save:**
  - Lesson 10 is left as the old app's un-tick left it: incomplete, unpinned,
    behind the pointer, on today, with a note and 45 minutes.
  - The untouched curriculum is re-saved through the builder.
- **Today un-tick:** lesson 10 is recorded as done today and is unticked on Today.

Both then assert:

- lesson 10 is a `reopened` make-up pinned on today, not completed, with its
  note and minutes kept;
- lesson 11 is tomorrow, and 11 to 30 run one a day;
- no day holds more than one lesson;
- `start_at_lesson` stays 11 and the pointer stays 10;
- after fresh loads, Today shows lesson 10 to do (and not lesson 11) and Plan's
  today row shows it to do.

Not proven: that these fail against 978d7c6. They were never run against the
old app.

Side effect on the shared account: a builder save re-saves every curriculum on
the account. The chromium project leaves the "E2E Seeded Curriculum" with
lessons 4 to 6 incomplete behind the pointer (FLOW 4 moves completed lesson 1
to queue 6). The re-save made those three rows make-ups on their own days
(Sep 23 to 25). That is the designed rule. There was no stacking, and the seed
rewrites that goal at the start of every run.

## 2. Staging is back on #84

rooted-staging runs `dpl_38ak5VnGATspSFjk7t3rELpQuwdS`, a fresh build of #84
at 4615e3e made when the acfa765 run finished (`dpl_snzNXWYkuTQDTywCAKnViGGRmTms`
is an older build of the same commit).

The report session then used a slot for #85 (faa12a2, its own smoke run) and
restored the alias to that same build.

Checked independently at the end of the session, `/api/health` reports:

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

## 3a. Combined release-candidate checks (wait for #84 to merge)

#84 was still an open draft at 4615e3e when the session ended. Nothing below
can run until #84 has merged and #87 has been updated from main.

`integration/pr84-pr87` is at 8e38552. It includes acfa765, merged cleanly,
and the full unit suite passes there (1791 pass, 0 fail, 8 skipped).

1. Update #87 from main using the section 3 resolution. If #84's head moved
   past 4615e3e, redo the merge by those rules. Recheck the two #84 expectations
   that move a day earlier.
2. Run the full unit suite, `tsc --noEmit`, and CI on that exact commit.
3. Coordinate a rooted-staging slot. The report session uses it for #85/#86.
   Deploy that exact commit to the rooted-staging custom environment.
4. Run smoke there. It must include the two 1b regressions and the named skip
   list. Record the commit, the deployment id, the run id and the results.
5. Walk through the un-tick order on the real merged code, with daily
   reconciliation OFF:
   - the pointer recomputes, then the make-up pin is written, then #84's re-date
     runs;
   - Today and Plan agree after reload;
   - a forced failure of the make-up write changes nothing.
6. Restore rooted-staging to the agreed build, and confirm the `/api/health`
   commit.
7. Mark #87 ready only after Brittany's final review.

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
   - The function bodies match. Careful: this is NOT a plain md5 of the file.
     The copies applied to rooted-staging were issued WITHOUT the whole-line
     `--` comments that the file's function bodies contain. So on staging:
     - `lesson_carries_work` matches the file exactly
       (md5 `df8372242d67b3020f3777ac5e8e9c45`);
     - `apply_builder_rebuild` (`0866e412d76dd6a4c469bc0049e44e2e`) and
       `reopen_lesson` (`e05d09fd5bcd02db83090df996e98429`) match the file only
       once comment lines are removed.

     Verified 2026-09-22 by stripping lines that start with `--` from each body
     taken from the LAST `create or replace` in the work-guard file, then
     comparing hashes. The only difference is comments; the code is identical.
     For production:
     - apply the file as-is, and compare production's `prosrc` md5 with the
       file's body verbatim;
     - compare with staging only after stripping comment lines from both.

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
