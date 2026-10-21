# Recorded and estimated report time

The Reports page currently calls its combined recorded-plus-estimated total “Hours Logged” and displays an estimated lesson's 30 minutes without an estimate label. Its record editor also pre-fills that estimated time as if the parent recorded it. Saving only a note/date consequently submits 30 recorded minutes instead of retaining missing time. The progress-report PDF's note describes curriculum defaults even though the shared rule uses 30 minutes.

This patch renames the tile “Total Hours,” shows the estimate portion and affected lesson count for the selected child/date range, labels each estimated lesson row, and explains how to enter actual minutes or an explicit zero. The editor leaves estimated time blank; saved minutes, explicit zero and legacy positive hours remain populated. The existing blank-to-null save behavior keeps notes-only edits estimated. The PDF note now states the actual fallback and that totals include estimates, using the shared constant and darker muted text.

No arithmetic, fallback value, eligibility, stored record or database function is changed by this patch. No completed lesson, recovery classification, pointer or transcript is written. A parent can still deliberately enter time. Blank time is still an estimate; zero is still recorded zero. Legacy saved positive hours retain their existing conversion to whole minutes.

## Verification

- Full suite: 1,975 passed, 0 failed, 8 skipped (1,983 total). Six new tests exercise estimated notes-only save round-trips, explicit zero, recorded/legacy time and deliberate replacement.
- Updated one existing source-wiring assertion to follow the shared time summary rather than the old inline expression; it still verifies the completed-lesson total uses the shared rule.
- Typecheck and lint pass for the changed report page and libraries/tests.
- Generated a two-page synthetic progress-report PDF through the actual jsPDF generator and inspected the rasterized summary. Both the initial and final darker-note renders were inspected; the estimate note is readable and fits inside the page.
- Follow-up verification on October 1: 77 assertions passed in isolated PGlite 0.5.8, using the committed update RPC body and its permission grants. The actual editor helper and blank-to-null parser fed real SQL calls. Covered estimated/null time, explicit zero, saved minutes, legacy positive hours, deliberate actual time, other-user refusal, unauthenticated refusal, invalid minutes and anonymous execute permissions. Fixture fields outside the expected edit remained unchanged.
- Reproduce with `PGLITE_MODULE=/path/to/temporary/node_modules/@electric-sql/pglite node scripts/verify-report-time-edits.mjs`. PGlite is a temporary verification dependency, not an app dependency. The database is in memory and closed afterward; the script uses no app credentials or remote connection.
- This local fixture does not reproduce production triggers, real Auth sessions or browser behavior. Keep draft until exact-commit staging checks pass.

## Staging handoff

Use an isolated synthetic family after CC's current staging work, with completed lessons containing null minutes, explicit zero, positive recorded minutes, legacy positive hours and blank minutes/zero legacy hours, plus recorded activity and memory time.

1. Verify child/date filters produce unchanged totals and the correct estimated portion/count. With no estimated lessons, no estimate explanation should appear. Lesson rows and subject totals should agree.
2. Edit only a note and then only a date on an estimated lesson. Confirm minutes remain null in the database and the row remains labeled Estimated after reload. Verify explicit zero remains zero, recorded values remain recorded, and entering actual minutes replaces the estimate.
3. Print the Hours & Attendance Log and download the progress-report PDF. Confirm readable estimate explanations and unchanged totals; inspect phone and desktop layouts.
4. Run normal smoke against the exact deployed commit; clean up the synthetic family and verify removal.

No production apply, release, customer message or integrity-routine restart is part of this handoff. This work is separate from CC's Builder and partner branches.
