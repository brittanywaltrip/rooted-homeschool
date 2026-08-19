# Curriculum Scheduling — Invariants & Tests

*The rules the scheduler must follow. Read this BEFORE touching `app/lib/scheduler.ts`, `app/components/CurriculumWizard.tsx`, the catch-up modal, or anything that writes to the `lessons` table.*

*Last updated: July 30, 2026 — adds Invariant 12 (pinned manual placements, including the Schedule Builder phase-2 exception) and Invariant 13 (trigger-completed rows hold no future date cache). See those sections plus "Queue position" below.*

**This is the single source of truth.** It lives in the repo at `docs/CURRICULUM-SCHEDULING.md`. The companion test file is `app/lib/scheduler.test.ts`. The companion CI workflow is `.github/workflows/scheduler-tests.yml`. CI will block any PR that touches scheduler-related code if the tests fail.

---

## Why this document exists

On April 28, 2026, a curriculum-wizard scheduling bug hit 11 real users (14 goals, ~1,067 misplaced lessons). Kendra Poole's Today page bloated to 29 items. lhawkinsrn went silent for 5 days. The fix was 1 helper function and 4 cursor sites — small code, big damage.

These rules exist so that bug pattern, and patterns like it, can never re-enter the codebase without someone breaking a documented invariant.

---

## The Invariants

These rules are LAWS. The scheduler must obey them. Every test in `app/lib/scheduler.test.ts` exists to enforce one of these. If you change scheduler logic, the corresponding test must still pass.

### Invariant 1 — No today-cramming on curriculum CREATION

When a user creates a brand-new curriculum, **no forward-scheduled lesson may be dated on or before today**, regardless of historical backfill, regardless of the user's chosen `startDate`.

The first forward lesson goes to **the next calendar day strictly after today**, then the day-by-day walk skips non-school days and vacations from there.

**Why:** users actively using the app today should never see their Today page suddenly bloat by a day's worth of lessons just because they created a new curriculum. Their schedule for today was already what they planned.

**Enforced by:** `forwardScheduleStart(userPickedStart, today)` in `app/lib/scheduler.ts`.

**Test case:** "Kendra-shaped repro" in `scheduler.test.ts` — given 62 lessons, 3/day Mon-Fri, 15 backfilled through Feb 17, today=Tue Apr 28 → first forward lesson lands on Wed Apr 29, no date holds more than 3 lessons.

### Invariant 2 — Lessons per day is a HARD ceiling

Within any single calendar date, the total number of incomplete lessons for one curriculum_goal must be **less than or equal to** that goal's `lessons_per_day` value. No exceptions.

**Why:** users explicitly tell us how much daily work they want. Cramming more violates trust.

**Enforced by:** the day-by-day cursor walk in `CurriculumWizard.tsx` increments correctly per `lessons_per_day` and never doubles up.

**Test case:** every test in `scheduler.test.ts` should assert `max(lessons per date) <= lessons_per_day`.

### Invariant 3 — Historical backfill stays put

Lessons explicitly marked as historical/backfilled by the user (dated in the past) must NOT be re-dated by the wizard.

**Why:** the user is asserting "we already did this." Moving those dates loses their record.

**Enforced by:** the wizard treats backfill ranges separately from forward generation. The `forwardScheduleStart` helper only affects forward lessons.

**Test case:** "backfill stays put" — given backfilled lessons 1-15 on dates Jan 28 → Feb 17, after wizard save those exact dates remain on those lessons.

### Invariant 4 — School-days are respected

Lessons must only land on dates whose day-of-week is in the goal's `school_days` array (or the user's vacation blocks). Saturday/Sunday lessons should never appear unless the user explicitly chose weekend school days.

**Why:** scheduling work on a Saturday when the family said Mon-Fri is gaslighting.

**Enforced by:** the day-by-day cursor walk skips dates where `to_char(date, 'Dy')` is not in `school_days`.

**Test case:** "school days respected" — given school_days = [Mon, Wed, Fri], no lesson lands on Tue, Thu, Sat, Sun.

### Invariant 5 — `school_days` is never empty

The `curriculum_goals.school_days` column must never be `null` or `{}`. If a user submits an empty value, fall back to `{Mon, Tue, Wed, Thu, Fri}`.

**Why:** an empty school_days means "no day is a school day" → infinite loop in the scheduler.

**Enforced by:** CurriculumWizard validation + database NOT NULL constraint.

**Test case:** "empty school_days falls back to weekdays" — given input `[]`, schedule uses Mon-Fri.

### Invariant 6 — `completed_at` on goals is monotonic

Once a `curriculum_goals.completed_at` is set, it must NOT be cleared by any subsequent edit. Going backwards (uncomplete a lesson) keeps the historical "first finished" timestamp.

**Why:** users who finished a curriculum and saw the celebration should keep that record even if they later add more lessons.

**Enforced by:** `recomputeCurrentLesson` in `app/lib/scheduler.ts` — only sets `completed_at` when transitioning from null to a valid value, never clears it.

**Test case:** "completed_at preserved on edit-back" — given a goal with completed_at set, marking the last lesson incomplete does NOT clear completed_at.

### Invariant 7 — Lesson completion never reschedules OTHER lessons

Marking a lesson `completed = true` must NEVER reschedule any other lessons. The lesson being marked complete may itself have its `scheduled_date` (and `date`) pinned to today so it doesn't ghost on its original calendar slot — that's a same-row pin, not a cross-row reschedule. Beyond that, only the goal's `current_lesson` counter and (potentially) `completed_at` may change.

**Why:** users expect "tap to mark done" to be safe. Side effects on OTHER lessons would be terrifying. Pinning the just-completed lesson's own scheduled_date to today is the opposite — it makes the calendar honest about when the work actually happened, instead of leaving a future-dated ghost behind.

**Enforced by:** the toggle-lesson code path calls `recomputeCurrentLesson(goal)` only — never bulk-update on lessons table. The `scheduled_date = today` pin is scoped via `.eq("id", lesson.id)` so by construction no sibling row can be touched.

**Test case:** "marking complete touches only one lesson" — given a goal with N lessons, mark lesson K complete, lesson K's `scheduled_date` is pinned to today and all other lessons' dates are unchanged.

### Invariant 8 — One shared `pickNextAvailableDate` helper

Every code path that picks a date for an incomplete lesson must call the same helper. There must be exactly one definition of "next school day with capacity" in the codebase.

**Why:** the May 3 regression was caused by a second copy of the cursor-walk logic ("Path A: queue-based scheduling") that disagreed with the first. Two copies will always drift.

**Enforced by:** `pickNextAvailableDate(args)` in `app/lib/scheduler.ts` is the only function in the codebase that walks days. Wizard create, wizard saveEdit, vacation-block insert, and catch-up accept all call it. Search the repo for any direct day-walk loop and delete it.

**Test case:** grep test in CI — the only file allowed to contain a day-walk loop is `app/lib/scheduler.ts`. Any other file matching the pattern fails CI.

### Invariant 9 — Every "today" is in the user's timezone

The scheduler may NEVER use the server's clock to compute "today." Every place that asks "what is today" must take a timezone argument and use it.

**Why:** a user in Pacific time at 11:30pm sees the next day's date if the server (UTC) thinks it's tomorrow. That bunches lessons onto the wrong dates.

**Enforced by:** `profiles.timezone` (IANA string, e.g. `America/Los_Angeles`). Default `America/New_York` for existing users; backfill new users from the browser via `Intl.DateTimeFormat().resolvedOptions().timeZone` on first save. `pickNextAvailableDate` accepts a `timezone` argument and uses it when computing `today`.

**Test case:** "TZ-aware today" — same scheduler call from a user in Pacific and a user in Eastern at the same UTC instant produces different "today" dates if it's late evening Pacific.

### Invariant 10 — `scheduled_source` is set on every lesson write

Every UPDATE or INSERT to `lessons.date` must set `lessons.scheduled_source` to one of:
- `'wizard_create'` — initial curriculum creation (including its backfill rows)
- `'wizard_edit'` — user edits goal in wizard (regenerate, reshuffle, or backfill)
- `'vacation_resched'` — vacation block insert/edit
- `'catchup_resched'` — catch-up modal accepted
- `'skip_today'` — "skip rest of today" pushed today's incompletes forward
- `'plan_move'` — user dragged or rescheduled a single lesson on the Plan page (queue reorder)
- `'queue_resync'` — Plan / Today data loader aligned the cached scheduled_date with the queue projector's output (no user-visible change, just keeps the cache honest after current_lesson advances or a `plan_move` shifts siblings without re-dating them)
- `'recalibrate_estimate'` — synthesized completion date written by the "I'm actually on lesson X" recalibration gap-fill. Lessons stamped with this source have completed_at + scheduled_date evenly distributed across the window between the goal's last real completion (or start_date / created_at) and yesterday. The Plan calendar lesson card surfaces an "Estimated date · tap to move." hint for these rows; moving the lesson via `move_lesson_to_date` overwrites the source with `'plan_move'`.
- `'cleanup_sql'` — manual cleanup via SQL

**Why:** the May 3 investigation took 90 minutes because every affected lesson row had `scheduled_source = NULL`. Future bugs will be identified in 5 minutes if this is populated.

**Enforced by:** every code path that writes `lessons.date` must also write `lessons.scheduled_source`. CI grep test enforces this — any UPDATE or INSERT statement in app code that targets `lessons.date` without also setting `lessons.scheduled_source` fails CI.

**Test case:** integration test — wizard create writes lessons with `scheduled_source = 'wizard_create'`; vacation-block insert writes `'vacation_resched'`; catch-up accept writes `'catchup_resched'`.

### Invariant 11 — Cache-sync writes the FULL incomplete tail of a goal, not a window

Every caller of `syncProjectedScheduledDates` must build `projDateByKey` from a projection that covers every remaining incomplete lesson of the goal. A fixed-day window is not allowed.

**Why:** the May 26, 2026 audit caught 77 bunched goals (whitley.t2212 + 12 others, 674 misplaced lessons). The dashboard's 7-day cache-warm projection wrote projector dates for in-window lessons onto dates that out-of-window lessons (still carrying their wizard_create cache) already occupied. The collision pair `{queue_resync, wizard_create}` was the dominant fingerprint. The sync skips rows whose key is absent from `projDateByKey`, so any out-of-window incomplete lesson keeps its stale cache while in-window lessons get rewritten on top of it.

**Enforced by:** `app/dashboard/page.tsx` passes `daysAhead=3650` (the projector's safety bound, also matched by the Schedule Builder's create path) so the projection naturally stops at `total_lessons` and emits one entry per remaining incomplete lesson. `app/lib/recalibrate.ts` already does this with `daysAhead=1500`. No caller may pass a small fixed window like 7 or 14.

**Test case:** `Invariant 11 (whitley)` tests in `scheduler.test.ts` — given lpd=1, school_days=[Mon,Wed,Fri], 5 incomplete lessons whose stale cache overlaps today's projector output, a full-tail projection results in 5 distinct dates and no collisions. A companion test pins the bug shape: a 7-day projection over the same goal config reproduces the lesson 84 / lesson 85 collision on 2026-06-01.

### Invariant 12 — A manual placement is never re-dated by the system

When the user places a lesson on a date by hand, `lessons.queue_pinned` is set
and that row's `scheduled_date` becomes authoritative. The projector emits
pinned slots at their stored date; the reconciler never rewrites them.

**Why:** before pins, `scheduled_date` was a pure cache of the projection, so
`reconcileGoalScheduleCache` rewrote every manually-moved row on the next Today
load and stamped it `queue_resync`. Manual moves reverted within a second. A
partly-rewritten tail was worse than a full revert: luvmywk's lessons 17-37 kept
their moved dates while 38+ resynced, so Sep 7 held both lesson 36 and lesson 38
and the numbers ran out of order.

**This is the documented exception to "scheduled_date is only a cache."** For a
pinned row it is the source of truth. Invariant 11's full-tail rule still
applies to the unpinned remainder.

**Enforced by:** `queue_pinned` (migration `20260730000000`), set by
`move_lesson_to_date` and by the PlanV2 manual flows (cascade shift-all-forward,
push-back, shift-forward, bulk move). System writes — vacation re-spread,
`queue_resync` — must NOT pin. `computeNextLessonsForGoal` takes a `pins`
argument; `pinsFromRows` / `loadPinsByGoal` are the single derivation used by
every projecting surface so no two can disagree. Empty pins reproduces the
pre-pin projection exactly.

**Unpin:** completing a pinned lesson retires its pin (completed rows are never
re-dated, and `pinsFromRows` skips them). Undo of a manual flow restores each
row's prior pin state.

**The one exception — Schedule Builder phase 2.** Phase 2 re-spreads EVERY
curriculum row in the builder on every save, not just the one the user edited,
and its floor-anchored delete removes incomplete rows above the completed floor.
Until July 30 2026 that delete took pinned rows with it, so **saving any one
curriculum destroyed manual moves on all the others**. Proven on the test
account: sibling goal `4193f9b3`'s pinned lesson 30 was deleted and re-created
unpinned at `05:06:23` when an e2e spec saved a different curriculum, while the
rows below it still dated from Jul 9.

**Verified against production, 2026-07-30 05:46 UTC.** Goal `4193f9b3` had
lesson 40 (`35d7f2ab`) seeded as an incomplete pinned row at 05:41:40, dated
Sunday 2026-08-16 with `plan_move` — above the goal's completed floor of 32, so a
genuine deletion candidate. A save of a DIFFERENT curriculum then ran phase 2
over it as a sibling: lessons 33 and 41 came back with fresh `created_at`
05:46:44 and `wizard_create`, proving the floor delete ran and swept past 40 in
both directions, while lesson 40 kept its id, `created_at`, date, source and pin,
with an `updated_at` of 05:45:26 that predates the save entirely. Aug 16 is a
Sunday on a Mon-Fri goal, a date the projector could not have produced — so the
survival cannot be explained by re-projection landing on the same day.

The rule now, in `scheduleFieldsChangedForRow`
(`app/dashboard/plan/schedule/page.tsx`):

- **Schedule fields changed on that goal** (`school_days`, per-day counts /
  overrides, `total_lessons`, `start_date`) → **its pins are released.** The user
  redefined the grid the pins sat on; honoring stale pins would produce a
  schedule matching neither the old plan nor the new settings — lessons stranded
  on days that are no longer school days, or past a reduced `total_lessons`. The
  pins are cleared explicitly (`queue_pinned = false`), not merely ignored, so
  the rows do not freeze at their new projector dates.
- **Schedule fields unchanged** (a cosmetic edit, or a sibling goal along for the
  ride) → **its pins are respected.** They are excluded from the floor delete and
  fed to the projector as date-occupying inputs, so re-projection fills around
  them instead of stacking on their days.

The gate reuses `hasScheduleFieldsChanged`, the same whitelist the wizard's
reshuffle uses, so there is one definition of "the schedule changed". The
per-day overrides map is compared alongside it because that helper predates it.

Pinned rows above a reduced `total_lessons` are still deleted by the
end-of-phase-2 cleanup: a pin says where a lesson belongs, not that it exists
once the curriculum has been shortened past it.

**A pin never counts as an overcapacity violation (August 2026).** Every per-day
guard measures scheduler-placed lessons only. Three of them used to count pins
and each one misread the Invariant 2 carve-out as corruption:

- **The Schedule Builder's pre-write guard** seeded its day-counts from the
  surviving pins, so two legitimate pins on one date read as `2 > 1` and the
  save was refused. Goal `503610a9` has lessons 8 and 18 both pinned to
  2026-09-02 on a 1/day goal, put there by bulk-move-to-one-day.
- **Its post-write guard** counted pinned rows straight out of the database and
  threw on the same shape.
- **`reconcileGoalScheduleCache`** counted pinned slots in the projection, hit
  the cap, and returned early — so the goal's `scheduled_date` cache was never
  reconciled again. Stale dates on Today and Plan permanently, plus one Sentry
  event per page load (`ROOTED-HOMESCHOOL-A`).

Stacked pins are now reported once, from the save, as a Sentry **warning** with
the dates attached. They are never thrown on. The projector already reserves a
pinned date's capacity before it places anything unpinned, so a scheduler-placed
lesson can still never stack on a full pinned day.

**`isPinProjectable(pin, goal)` is the one definition of which pins hold a
slot** — slot > `current_lesson` and <= `total_lessons`. A pin outside that range
is stale: the projector emits nothing for it and reserves no capacity. The
Schedule Builder's guard used to count those anyway, so a stale pin's date was
tallied twice, once from the pin and once from the fresh lesson the projector
had legitimately placed there. One goal reported 49 overcapacity dates that way,
and 45 goals across 12 families still hold a pin in that shape. The projector and
the guard now call the same helper. Do not write a fourth copy of the rule.

**Assertions run before the delete.** Phase 2's floor delete used to run first
and the capacity assertion several statements later, with no transaction between
them. When the assertion threw, the delete had already committed and the family
lost every future lesson that was not pinned or completed, with nothing
re-inserted — deterministically, so the retry could not help. The save now plans
the whole batch against a simulated post-delete row set and runs every assertion
against it; the first destructive call happens only after they all pass. See the
PLAN / COMMIT markers in `applyPhase2ForGoal`.

**Test case:** the PINS block in `scheduler.test.ts` — pin honored and filled
around in order, capacity never exceeded, fully pinned tail emitted verbatim,
reconciler skips pinned rows, cascade+reconcile round-trip with zero writes. The
phase-2 block adds: a sibling save changes no schedule field (pins respected),
editing the grid does (pins released), and a surviving pin holds its day while
the re-projected tail fills around it. End to end, FLOW 4 in
`e2e/smoke/flows.spec.ts` moves a lesson, loads Today, returns to Plan and
asserts the lesson is still on its target day — the guard for both the
reconciler revert and the phase-2 wipe.

### Invariant 13 — A trigger-completed row holds no future calendar slot

When `curriculum_goals_cleanup_orphans_trg` auto-completes orphan rows, it must
also clear their date caches: `scheduled_date = NULL` and
`date = (NOW() - interval '1 day')::date`, the same synthetic day as the
`completed_at` it stamps.

**Why:** kierrak745 created a curriculum with starting position 8 and a future
start_date of Aug 10. Rows 1-100 went in as incomplete dated rows from lesson 1.
When `current_lesson` advanced to 8 the trigger completed rows 1-7 but left their
caches on Aug 10-18 — the days the queue had given lessons 9-15. MonthGrid reads
`scheduled_date ?? date`, so she saw two lessons per day for seven school days.
The daily integrity check reports this as drift B (overcapacity).

**A completed row with no queue slot has no business owning a calendar day.**
Its `completed_at` is what carries it into transcripts and progress reports.

**Enforced by:** migration `20260730100000`. Note the earlier
`20260520180000_orphan_cleanup_sync_scheduled_date.sql` attempted the same fix
and was **never applied** — it is absent from
`supabase_migrations.schema_migrations`, which is why the bug survived two more
months. Verify a trigger change against `pg_get_functiondef` on the live
database, not against the repo file.

**Companion guard:** the Schedule Builder create flow asserts pre-INSERT that no
batch contains a `completed = false` row with `lesson_number <= current_lesson`,
so a regression that schedules below the starting position fails loudly per goal
instead of silently doubling a calendar.

**Test case:** "starting position" tests in `scheduler.test.ts` — future
start_date with position N emits nothing at or below N, and simulated
orphan-completed rows carry no future `scheduled_date` / `date`.

---

## Bug patterns to NEVER reintroduce

These are real bugs that have happened or are easy to happen. If you see code that looks like one of these, stop and rewrite it.

### Anti-pattern A — `cursor = startDate || today`

The exact bug we just fixed. Initializing the forward cursor to "today" causes Invariant 1 to fail. Use `forwardScheduleStart()` instead.

### Anti-pattern B — `if (cursor <= today) cursor = today`

The two saveEdit guards in `CurriculumWizard.tsx` had this — they let the cursor float UP to today rather than past it. Replace any "max(cursor, today)" with "next school day strictly after today."

### Anti-pattern C — Catch-up logic that crams missed dates onto today

Any algorithm that says "if there's a gap between historical end-date and today, distribute lessons to fill the gap" violates Invariant 1. Long gaps are intentional — the user paused. Don't try to be clever.

### Anti-pattern D — Bulk-update lessons table on a non-creation event

If anything other than the curriculum creation flow writes multiple rows to `lessons` table for one goal, suspect a bug. Lesson completion, lesson editing, vacation blocks — none of these should mass-rewrite dates.

### Anti-pattern E — `school_days = []` accepted

If user input arrives as empty, the wizard must apply the Mon-Fri fallback BEFORE generating dates. An empty array passed to the day-walker creates an infinite loop.

### Anti-pattern F — A new "scheduling path" parallel to the existing one

The May 3 regression was caused by a second scheduling implementation ("Path A: queue-based scheduling") shipped via migration `20260501064729`. Don't do this. There is one scheduler. If you need different behavior for a new feature, modify the existing code path; do not fork it.

### Anti-pattern G — Server clock used for "today"

`new Date()` and `now()` (in SQL) return the server's UTC time. Using either to compute a user-facing date violates Invariant 9. Always pass a timezone in.

### Anti-pattern H — Bulk lesson UPDATE in a SQL migration

Migrations are environment-shared. A migration that bulk-updates `lessons` will run against every environment (staging AND production) at deploy time and rewrite real users' schedules without warning. If you need to fix data, write a one-off script with a backup table, dry run, and explicit Brittany sign-off — not a migration.

### Anti-pattern J — Trusting a migration file as evidence the database changed

`20260520180000_orphan_cleanup_sync_scheduled_date.sql` sat in the repo for two
months looking like a shipped fix. It was never applied, the live trigger never
had the line, and kierrak745 hit the bug it was written to prevent. A file in
`supabase/migrations/` proves someone wrote SQL, not that the database ran it.
Before trusting any function or trigger, read it back with
`pg_get_functiondef` and check `supabase_migrations.schema_migrations`.

### Anti-pattern I — Fixed-day projection window feeding the cache sync

Any caller of `syncProjectedScheduledDates` that builds `projDateByKey` from a small fixed window (e.g. 7 days, 14 days) is broken by construction. The sync skips rows whose key is absent from the map, so in-window writes can land on dates that out-of-window rows still occupy in their stale cache. Always project until `total_lessons` is reached. See Invariant 11.

---

## Required test cases (`app/lib/scheduler.test.ts`)

These tests MUST pass on `staging`, `main`, and `feat/plan-redesign`. Add new ones whenever a new bug is found.

| # | Test name | Asserts |
|---|-----------|---------|
| 1 | Kendra-shaped repro | First forward lesson is the next school day strictly after today. No date holds > lessons_per_day. |
| 2 | No backfill — pure forward | First lesson is tomorrow's school day. |
| 3 | Backfill ending today | First forward lesson is tomorrow's school day, NOT today. |
| 4 | Backfill ending months ago | First forward lesson is tomorrow's school day, NOT yesterday or today. |
| 5 | School-days respected | No lesson on a non-school day. |
| 6 | school_days fallback | Empty input falls back to Mon-Fri. |
| 7 | Future startDate honored | If user picks startDate >= 2 days from today, schedule begins on that day. |
| 8 | completed_at preserved | After clearing a completion flag, goal.completed_at stays set. |
| 9 | Toggle lesson complete is local | Other lessons' dates unchanged. |
| 10 | Bulk Mark all done | Updates current_lesson + completed_at across all lessons in one call. |
| 11 | Queue scheduler honors lessons_per_day with future start_date | total_lessons=160, lpd=1, school_days=Mon-Thu, start_date=2026-08-05, today=2026-05-01 → first lesson lands on the start_date (or next school day on/after), max(per-date) = 1. |
| 12 | Vacation block insert re-spreads without bunching | 30 incomplete forward lessons, lpd=2, school_days=[Mon,Wed], insert vacation covering 4 weeks → max(per-date) = 2, no lessons inside vacation, completed lessons untouched. |
| 13 | Catch-up accept handles 5 missed days | lpd=1, school_days=Mon-Fri, today=Mon, 5 missed lessons last week → land on this week's school days, max(per-date) = 1, future lessons untouched. |
| 14 | Catch-up DISMISS does not write to lessons | Dismissing the catch-up modal updates `last_catchup_dismissed_at` only. Zero rows touched in `lessons` table. |
| 15 | TZ-aware today | Same call from Pacific user and Eastern user at the same UTC instant late-evening Pacific produces different "today" dates. |
| 16 | scheduled_source populated | After any code path runs, the lessons it touched have a non-NULL `scheduled_source` matching the originating action. |
| 17 | queue_resync full-tail (whitley) | With lpd=1, school_days=[Mon,Wed,Fri], and 5 incomplete lessons whose stale cache overlaps today's projector output, a full-tail projection yields 5 distinct dates. Companion test pins the 7-day collision bug. |
| 18 | Pins (Invariant 12) | Pin honored and unpinned slots filled around it in date order; pinned date consumes capacity; fully pinned tail emitted verbatim; reconciler skips pinned rows; cascade + reconcile round-trip writes nothing; empty pins projects identically to no pins. |
| 19 | Starting position (Invariant 13) | Future start_date with starting position N projects nothing at or below N; the create batch contains no incomplete row at or below the floor; orphan-completed rows carry no future scheduled_date / date. |

---

## Pre-merge checklist for ANY change to scheduling code

Before merging staging → main, OR feat/plan-redesign → main, when the diff touches `scheduler.ts` or `CurriculumWizard.tsx`:

- [ ] All 10 test cases in `scheduler.test.ts` pass
- [ ] Manual smoke test on the staging URL: create a NEW curriculum with backfill ending more than a week ago. Confirm the first forward lesson is tomorrow or later — NOT today.
- [ ] Manual smoke test: create a NEW curriculum with NO backfill. Confirm the first lesson is tomorrow's first school day.
- [ ] Manual smoke test: create a NEW curriculum with school_days = [Mon, Wed, Fri] only. Confirm no Tuesday/Thursday lessons appear.
- [ ] Run the daily audit query manually before merging — confirm 0 affected goals exist.
- [ ] After merge, the next morning's automated audit (8:07 AM) shows 0 affected goals.

---

## How to debug a curriculum scheduling bug

If a user reports a wonky schedule:

**Step 1 — Reproduce.** Find their account in Supabase, look at the affected `curriculum_goals` row + its lessons. Is there cramming? Wrong day-of-week? Lessons on past dates?

**Step 2 — Match against the invariants above.** Which one is violated?

**Step 3 — Check the audit.** Did this morning's `~/Desktop/Curriculum Audits/audit-*.md` flag this user? If not, the bug is escaping the audit — strengthen the audit query.

**Step 4 — Find the regression.** `git log` on `app/lib/scheduler.ts` and `app/components/CurriculumWizard.tsx` since the last all-clear day. Look for changes that might have re-introduced an anti-pattern.

**Step 5 — Fix and add a test.** Whatever the bug was, the fix should add a new test case to `scheduler.test.ts` so this exact scenario never regresses again.

**Step 6 — Run the Kendra-style cleanup SQL** for the affected user(s) (see `~/Desktop/CC Prompts/Pending/CC-prompt-fix-curriculum-scheduling-bug.md` for the pattern).

---

## When in doubt — three rules of thumb

1. **The wizard is a write operation. Be timid.** Every line that modifies `lessons` or `curriculum_goals` should make you nervous. Read it twice.
2. **Today is sacred.** Adding work to today is something the USER does, not the system. The system should never auto-add lessons to a day the user is currently looking at.
3. **Long gaps are intentional.** If a user backfilled lessons through February and is creating a curriculum in April, that's a 6-week pause. Respect it.

---

## Queue position

Added May 18, 2026 to close Ivy's bug: moving a lesson on the Plan page didn't reflect on Today because the queue projector read `current_lesson` while the move only updated `lessons.scheduled_date` (a cache).

`lessons.queue_position` (nullable integer) is the source of truth for "where this lesson sits in the goal's queue." Initialized to `lesson_number` at curriculum creation. A user move on the Plan page rewrites it. A partial unique index `lessons_goal_queue_position_uniq` enforces no duplicates per goal (NULL allowed for one-off non-curriculum lessons).

### Reading rules

- `recomputeCurrentLesson` takes `MAX(queue_position)` over completed rows (not `lesson_number`).
- The Today projector emits queue slots; the page looks up actual rows by `(curriculum_goal_id, queue_position)`.
- `lesson_number` stays pinned to the canonical curriculum index (e.g. "Lesson 12: Long Division"). It drives display, Past tab grouping, and lesson titles. Do not reorder by `lesson_number` after creation.

### Writing rules — manual moves + orphan cleanup

The `move_lesson_to_date(p_lesson_id, p_target_date)` Postgres function is the primary path that writes `queue_position` after creation. The orphan-cleanup trigger `trg_curriculum_goals_cleanup_orphans` (migration `20260519180000`) nulls `queue_position` on rows it marks complete; nulling keeps `recompute_curriculum_current_lesson` from re-counting cleaned-up rows in its `MAX(queue_position)` formula and so prevents a re-entry loop. No other code path may write `queue_position`.

`move_lesson_to_date` is atomic:

1. Reads the moving lesson's `(curriculum_goal_id, queue_position, scheduled_date)`.
2. Finds the highest `queue_position` already scheduled on the target date for the same goal (or, if none, the highest predecessor). Adds 1 to get the moved lesson's new rank — "end of the day's existing slots for that goal."
3. Shifts siblings between the old and new positions by ±1 (using a negation trick so the unique index is satisfied at every intermediate step).
4. Sets the moving lesson's `queue_position`, `scheduled_date`, `date`, and `scheduled_source = 'plan_move'`.

The pure JS mirror `planQueueMove` in `scheduler.ts` exists for unit tests and any future optimistic UI; the RPC is what production runs.

Catch-up and vacation handlers re-date lessons via the existing `planRescheduleLessons` path. Those re-spreads do **not** touch `queue_position` — they preserve queue order and just shift dates. Only an explicit user reorder rewrites `queue_position`.

### Invariant 2 carve-out for manual moves

`lessons_per_day` remains a hard ceiling for the **scheduler-driven** day walk (wizard create, vacation re-spread, catch-up). For an explicit user move on the Plan page, the ceiling is downgraded to a soft warning toast. If the user drags two lessons onto the same Friday for a 1/day goal, the move succeeds; the toast says "That day now has 2 lessons for this goal (planned 1/day)." The user opted in.

Auto-scheduling never bunches; only the user can.

### What this PR did NOT change

- Bulk move handlers in PlanV2 (`performBulkMove`, catch-up shift confirm) still write `scheduled_date` directly without touching `queue_position`. They are scheduler-driven paths, not user reorders. If a future PR makes them user-explicit reorders, route them through `move_lesson_to_date`.

  **Superseded for three of them (August 2026).** Writing a date directly is
  fine; writing `queue_pinned` alongside it is not. `batchUpdateScheduledDates
  (pairs, "plan_move", true)` sets the pin flag but never the slot, and
  `reconcileGoalScheduleCache` derives its pin set FROM `queue_position`. A
  pinned row with a null slot is therefore invisible to the pin set (so the
  projector double-books its date) while still being skipped by the writer; a
  pinned row WITH a slot freezes the tail, because pins only retire on
  completion and the documented auto-roll stops until every lesson is done.

  The catch-up shift-forward flow shed this in `04fa1eb`, and push-back plus
  the cascade shift followed. All three now use one shape: snapshot the goal's
  incomplete rows, clear `queue_pinned`, and let `reconcileGoalScheduleCache`
  re-project the tail. Undo restores the snapshot. The only path that may pin
  is `move_lesson_to_date`, which writes the slot and the flag in the same
  statement. **If you are about to write `queue_pinned: true` anywhere else,
  you are reintroducing this bug.**
- `lesson_number` semantics are unchanged everywhere. Display, Past-tab grouping, and lesson titles all still read `lesson_number`.

---

*This doc is alive. When you find a new bug pattern, add it. When you write a new test, add it. When you discover a new invariant, document it. Keep it next to the code.*
