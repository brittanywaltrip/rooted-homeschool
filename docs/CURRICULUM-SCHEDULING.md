# Curriculum Scheduling — Invariants & Tests

*The rules the scheduler must follow. Read this BEFORE touching `app/lib/scheduler.ts`, `app/components/CurriculumWizard.tsx`, the catch-up modal, or anything that writes to the `lessons` table.*

*Last updated: May 3, 2026 — after the queue-based scheduling regression (Path A, migration `20260501064729`). Adds Invariants 8–10.*

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

### Invariant 7 — Lesson completion never triggers rescheduling

Marking a lesson `completed = true` must NEVER reschedule any other lessons. Only the goal's `current_lesson` counter and (potentially) `completed_at` may change.

**Why:** users expect "tap to mark done" to be safe. Side effects on other lessons would be terrifying.

**Enforced by:** the toggle-lesson code path calls `recomputeCurrentLesson(goal)` only — never bulk-update on lessons table.

**Test case:** "marking complete touches only one lesson" — given a goal with N lessons, mark lesson K complete, all other lessons' dates are unchanged.

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
- `'wizard_create'` — initial curriculum creation
- `'wizard_edit'` — user edits goal in wizard
- `'vacation_resched'` — vacation block insert/edit
- `'catchup_resched'` — catch-up modal accepted
- `'cleanup_sql'` — manual cleanup via SQL

**Why:** the May 3 investigation took 90 minutes because every affected lesson row had `scheduled_source = NULL`. Future bugs will be identified in 5 minutes if this is populated.

**Enforced by:** every code path that writes `lessons.date` must also write `lessons.scheduled_source`. CI grep test enforces this — any UPDATE or INSERT statement in app code that targets `lessons.date` without also setting `lessons.scheduled_source` fails CI.

**Test case:** integration test — wizard create writes lessons with `scheduled_source = 'wizard_create'`; vacation-block insert writes `'vacation_resched'`; catch-up accept writes `'catchup_resched'`.

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

*This doc is alive. When you find a new bug pattern, add it. When you write a new test, add it. When you discover a new invariant, document it. Keep it next to the code.*
