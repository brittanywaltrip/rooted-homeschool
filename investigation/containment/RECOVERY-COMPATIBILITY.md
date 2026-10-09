# Catch-up and prior-history compatibility follow-up

`recovery-inserts.sql` replaces only the fixed history/healing RPC after the base containment installation. The insert endpoint now accepts the parent's explicit `planned`, `picked`, or `today` choice. Existing callers that omit choice retain `picked`. The server validates the choice, derives `completion_*` source, noon UTC for a past date, and the matching pin/backfill fields. `today` must name the authoritative local day. Future historical inserts remain refused. A fixed `prior_card` origin retains that surface's existing zero-time and course-title semantics; arbitrary origin/source/row contents are not accepted.

`answerMissedYes` now uses this fixed endpoint for a missing protected row. It resolves ambiguous insert receipts before looking up existing slots, and resolves an ambiguous existing completion receipt even if its row is now visibly complete. Already-completed rows without pending attempts remain untouched. Existing partial-count reporting remains: completion and the following parent re-spread are separate transactions, and a re-spread refusal cannot undo a confirmed completion. Retries preserve recorded completions and retry only unresolved work.

The parent's new `commit_scheduler_respread` route supplies the supported protected tail step; this supersedes the direct-tail limitation recorded in the initial writer inventory for these paths. Normal Yes with a missing row was exercised through actual TypeScript and PostgREST, including two lost responses, exact receipt replay, one completion event, and canonical re-spread of the next row. The bridge also repeats the loss/replay test for an existing lesson completion and compares its full recorded row before/after retry.

Today prior-card missing-row insertion uses the same contract. Existing completed rows are not completed again; incomplete existing rows use `onlyIfIncomplete`. Normal Today completion now presents the contained helper's specific refusal/uncertainty message and retains the original date/choice/minutes in a persistent **Check saved completion** control for unknown/busy results. That button calls the same completion helper with the original arguments; the helper retains its operation UUID/preimage. Its actual browser interaction still requires the parent's browser verification; it has passed TypeScript and source inspection here.

Validation:

- Six named real local API checks: offered planned/picked/today semantics, prior-card zero-time shape, invalid source/origin/day refusal, and the actual Yes bridge covering missing and existing row replay plus protected re-spread.
- 17 recovery/history unit tests pass, including paused refusal with no direct insert fallback and protected re-spread routing with no direct tail PATCH.
- 10 prior-card source/behavior contracts pass. Goal existence still precedes all writes; both date columns and completion state remain selected; no-overwrite and retained-insert guards are asserted.
- TypeScript and changed library lint pass.

All API cases used disposable UUID goals on the isolated loopback Colima backend and cleaned only their own records. No global fixture equality assertions were made while other agents had disjoint fixtures active. No hosted changes or activation occurred.
