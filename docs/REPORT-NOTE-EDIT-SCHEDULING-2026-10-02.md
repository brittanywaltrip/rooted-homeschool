# Reports note-only edit scheduling review

Status: reproduced locally October 2; app and migration correction prepared and tested locally October 5. No remote database accessed by this rehearsal. Review is against main 55689d02 plus the local Reports time-label branch, not CC's current release branch.

## Finding

Every successful updateLessonRecord in app/dashboard/reports/page.tsx calls redateAfterRecordChange(goalId, "completion"), including notes-only and minutes-only edits. That calls resyncGoalsForParent, which can write the curriculum's schedule. Its completed-today allowance is computed from completed_at, not the displayed report date.

The committed update_report_lesson_record function also unconditionally sets completed_at to noon UTC on p_date, queue_pinned=true, scheduled_source=report_correction, and both stored dates to p_date. Thus merely guarding the frontend resync on a changed displayed date is insufficient: an unchanged-date save can change the actual completion day used by Today.

## Local reproduction

Extended scripts/verify-report-time-edits.mjs, running the committed SQL function in isolated PGlite, with a lesson planned for Sep 30 but completed Oct 2 at 15:00 UTC. Save only a note, retaining Sep 30 and 25 minutes.

Observed:
- stored date and 25 minutes remain unchanged;
- completed_at becomes Sep 30 at 12:00 UTC;
- queue_pinned changes false to true;
- scheduled_source changes parent_done to report_correction.

All 83 assertions pass: the prior 77 time/editor/ownership checks plus 6 checks reproducing this existing behavior. Passing reproduction checks do not mean the placement behavior is desirable. This fixture has no production triggers or real Auth session. No claim is made that this caused Cowork's flagged rows, or that every note save moves other lessons.

## Proposed fix and verification boundary

Prepare a separate change: the server should detect date changes against a locked live row. An unchanged-date notes/minutes correction should preserve completion timestamp, dates, pin and source; a deliberate date correction should retain the existing placement semantics. The client should reschedule only when the authoritative save result says scheduling-relevant data changed. Avoid deciding solely from potentially stale client state.

Rehearse same-date notes and minutes, a planned-date/completion-day mismatch, an actual date correction onto/off today, another-tab date edits, permission refusals, and parent work preservation. Verify Today and Plan against the installed function and exact app commit before release. Do not remove the existing resync for genuine date corrections or record deletion.

CC owns the current shared staging session. This investigation made no shared staging or production changes. The estimate-label/editor patch remains a separate prepared change.

## October 5 correction

The CLI-created migration `20261005161936_preserve_report_note_placement.sql` adds `update_report_lesson_record_v2` with an expected displayed date. It locks the owned completed lesson and rejects a stale displayed date. Same-date edits write only minutes, notes and updated_at, preserving both stored dates, completion timestamp, slot, pin and source. A deliberate date correction retains the existing noon-UTC completion/date/pin semantics.

The result reports whether scheduling changed and supplies the saved lesson's curriculum id. Reports uses that result to request a resync only for date corrections, then reloads server records. It does not fall back to the old RPC when v2 is missing. Delete behavior is unchanged. An old-client boolean wrapper remains; same-date saves preserve placement there too, although installed old clients still make their redundant resync call.

Validation: 122 local SQL/editor assertions, including the original reproduction, same-date note/minutes/null/zero cases, a real date correction, scheduled_date fallback, stale-date refusal, ownership and unauthenticated refusals, invalid-minute refusals, function grants, old-client compatibility and the rollback script. Full suite: 1,975 passed, 0 failed, 8 skipped. TypeScript, changed-file lint and diff checks pass. The fixture does not reproduce production triggers, HTTP/Auth sessions or native concurrent transactions; these remain staging gates. This prevents another tab's date edit being overwritten; it does not add whole-row optimistic concurrency for simultaneous notes/minutes edits.

Release order: migration first, client second. Roll back the client before `supabase/rollbacks/20261005161936_preserve_report_note_placement_ROLLBACK.sql`. Rehearse on a production-shaped staging fixture with actual triggers, multiple sessions and real Reports/Today/Plan before release. Cover a planned-date/completion-day mismatch, pinned and unslotted records, true date edits onto/off today, stale-tab refusal and unchanged parent work. No production migration or release is approved by this document.


## Integrated production-base review — October 5 afternoon

Merged current production b9904b6fa60223e9d183a64e3db898c0a1f286d7 into this local branch without conflicts. Integrated code commit: 668728a7. No remote deployment or database change. The partner and identity releases remain intact.

Validation against that integrated tree: 122 disposable PGlite SQL/editor assertions passed; full suite 2,051 passed, zero failed, eight skipped (2,059 total); TypeScript, changed-file ESLint and diff checks passed. The two adjusted existing tests still assert the shared arithmetic and that only a server-confirmed date change requests a resync. These results do not substitute for real staging triggers or HTTP sessions.

Staging gate, after coordinating access with CC:

| Case | Required observation |
| --- | --- |
| Planned date differs from actual completion day; save only a note | Only notes and updated_at change. Dates, completed_at, slot, pin, source, minutes and hours remain identical; Today/Plan remain unchanged. |
| Edit minutes only; blank, explicit zero and positive recorded values | Only the requested time/note fields change. Blank stays null and estimated; zero stays recorded zero. No scheduling call. |
| Unslotted and pinned completed records | Note/time edits preserve their full placement, including pin and source. |
| Deliberate date correction onto/off today | Existing date-correction semantics retained, server returns scheduling_changed=true, relevant curriculum resync completes, Today and Plan agree. |
| Another tab changed the displayed date | Old tab's save refused; every row identical before/after the refused call. Reload shows current record. |
| Other family, signed-out and missing migration | No writes. Client reports failed save rather than falling back to the old function. |
| Activity/memory time, child/date filters and PDF | Totals unchanged by labels; estimated portion/count matches eligible lessons; estimates are disclosed in screen, print and downloaded PDF. |
| Old installed client | Boolean contract still works; same-date row placement preserved. Its redundant resync remains a documented limitation until client rollout. |

Snapshot the synthetic curricula and all their lessons before each case, compare every column afterwards, and confirm genuine parent completions, notes and time outside the intended edit are unchanged. Run smoke on the exact integrated deployment. Use synthetic accounts only and present scoped fixture cleanup before deleting shared staging fixtures under the current cleanup hold.

Release remains migration first, client second; rollback client first, then the committed rollback SQL. No release approval is implied by local validation. The prepared admin-auth callback fix is separate and is not included in this Reports branch.
