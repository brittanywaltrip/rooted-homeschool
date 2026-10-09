# Explicit preserved-lesson resume

Brittany approved resuming the selected preserved unfinished lesson through “I'm actually on…”. This change releases only its preserved marker and pin, retains its unfinished status and recorded work, and projects eligible following lessons. The form explains replacement of the old planned date. Other preserved work and genuine completion history remain intact. Existing explicit book-order restoration can still change queue positions.

The protected command validates the full snapshot and selected queue position before writes. Unslotted, skipped, backfill or mismatched preserved selections refuse. Legacy scheduling refuses preserved resume before any book-order or pointer writes. This is a bounded edge-case limitation, not a claim that arbitrary damaged queues can resume automatically.

Undo uses a dedicated authenticated endpoint and minimal placement/completion/pointer before-fields. It retains the existing ten-minute window, checks the complete after-state, and refuses after later work or course deletion. Generic Undo cannot consume this receipt. Exact replay after Undo returns already_undone. Successful recalibration keeps only a compact local receipt descriptor for reload Undo; this does not implement longer server retention or older move correction.

## Verification

- Focused client coverage: selected-only release, other preserved history exclusion, immutable projection input, prewrite queue refusal, replay after Undo, legacy preflight and compact reload Undo.
- Full suite: 2,334 passed, 8 existing skips, zero failures before this documentation commit.
- Real loopback API: history Yes/No, other preserved and completed rows, exact Undo/repeated Undo, generic endpoint refusal, later notes, aged synthetic receipt (no clock change), deleted course, commit replay before/after Undo.
- Actual browser: notice, Save, full reload and Undo; two lost acknowledgements, reload, Check saved changes, same receipt and Undo. No browser errors in successful runs.
- A first browser harness assertion lost its response body during navigation; capture moved before navigation and the corrected run passed. No product fix was attributed to that harness failure.

Evidence is in the task workspace `synthetic-runtime/resume-api-results.json` and `resume-browser-evidence/`. Fixtures are disposable local families only. No hosted data or deployment changed. Exact-commit independent review, final compiler/catalog checks and final ordinary UI matrix are tracked separately.

## Bounded save-day and weekly results

On clean 7fd898a, two actual browser sessions passed: Today around Builder commit/ack, lost Builder response with same-operation replay, simultaneous Builders (one applies, the other refuses stale), held genuine stale Today proposals, and a fresh 52-insert plan including lesson 1 on the real save day. Every expected row survived both reloads. Historical missing-row skip stays open: the original September prerequisite/writer has not been identified.

Chronological versus out-of-order explicit historical completions converge through current authenticated APIs, retaining identities, chosen work dates, notes, minutes/hours and preserved unfinished work. No implied completion or duplicate retry was observed. Logging a later slot first clears scheduled_date of earlier empty unpreserved rows; it does not delete their rows or date field. Actual UI testing and wider weekly scenarios are reported separately; this result does not claim a multi-day clock simulation.
