# Logging a day that already passed

*Written 2026-09-02 after a user reported that lessons completed Tuesday could not be
logged on Wednesday: "none of our typical lesson logs are there."*

## The shape of the problem

Rooted schedules by **queue, not calendar**. `reconcileGoalScheduleCache` runs on every
Today and Plan load, re-projects each goal's incomplete tail from *today* forward, and
rewrites `scheduled_date` / `date` on every incomplete, non-backfill, non-pinned row
(`scheduled_source = 'queue_resync'`).

That is the right behavior: a family can never fall behind, because the plan reshapes
around them. But it means a school day that passes without being checked off is not
marked missed. Its rows move to today, and its calendar cell goes **empty**. There was
no way left to say "we did this, on that day."

Attendance in `app/dashboard/reports/page.tsx` buckets on `completed_at.slice(0, 10)`,
so catching up the next morning also stamped the wrong day present.

## Three defects, and what shipped

**1. No per-day catch-up surface.**
Fixed. Opening a past day on the Plan page now asks the projector what *would* have been
due there and offers those queue slots as a checklist: "Did you do any of this on Tue,
Sep 1?" Checking rows writes them complete on that date. Per lesson, repeatable, no
session gate, no typing lesson numbers.

- `app/lib/logPastDayLessons.ts` — the write. Stamps noon UTC on the day chosen, never
  `now()`, and routes through `buildPastDateCompletionPayload` so the projector never
  re-spreads the row back onto today (Invariant 3). Never throws; counts failures.
- `app/components/PlanV2/DayDetailPanel.tsx` — `catchUpEntries` + `onLogCatchUp` props,
  both optional, so the Today page's inline variant is untouched. Hidden for partners.
- `app/components/PlanV2/index.tsx` — computes the day's entries with
  `computeGapLessonsForGoal` over a one-day window, honors the child-filter chips, and
  drops slots already recorded on that date so re-opening a day cannot double-log.

**2. The catch-up gap was anchored globally and went silent on same-day work.**
Fixed in `app/dashboard/page.tsx`. `gapStart` came from the single most recent
`completed_at` across *all* goals. Logging even one lesson today collapsed the window to
zero days, `computeGapLessonsForGoal` returned `[]` for every goal, and the prompt never
appeared while the rest of yesterday was silently absorbed. A subject untouched for a
week was likewise invisible if a different subject had been done yesterday. Each goal now
anchors to its own last completion, falling back to the goal's `start_date`, clamped to
14 days so a family returning from a long break gets two weeks and not a 200-item modal.

**3. Answering the modal hid the only way back.**
Fixed. `missedRecoveryDismissed` gated both the modal and the "{n} lessons from earlier"
link. The session flag still hides the modal; the link now always renders while
`overdueLessonCount > 0`, because it is the last remaining path into the catch-up flow.

## Still open

The Today page's Missed Lesson Recovery modal is still binary Yes/No across every goal:
Yes over-credits subjects the family did not do, No records nothing. Making it per-lesson
and pointing it at `logPastDayLessons` would leave exactly one write path for "log a past
day" in the codebase. Worth doing; not in this change.
