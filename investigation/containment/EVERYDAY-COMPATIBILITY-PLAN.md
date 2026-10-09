# Everyday compatibility continuation from 4859cf80

Status: local review checkpoint, not an activation or release candidate. Customer activation with ordinary-workflow regressions remains unacceptable. Existing evidence supports two intended forward shifts; no new customer questions or account writes are needed for this code work. Exact customer row inventory is still unavailable locally; the prior 403 has not been retried or bypassed.

## Scope and corrected inventory

Separate worktree `rooted-everyday-compat`, branch `fix/kandl-everyday-compat`, based on `4859cf80bf7efe5f00f65468fbdd9b705b11650a`. The original release-package checkout remains untouched.

The initial inventory incorrectly treated Today’s old single-move/missed-day sheets as active. They are hard-disabled in the current page. The attempted wiring was removed. The remaining Today change is its active deferred Delete path. No claim is made that a disabled sheet was restored.

This continuation addresses the independently reproduced retained-ambiguous-attempt defect, family-wide calendar locking, active Plan same-course Edit/Add/Log extra/placement, explicit lesson deletion, and course lifecycle/settings compatibility. It does not replace the underlying scheduler.

## Implemented contracts

- Definitive stale responses after receipt lookup retire an ambiguous operation in respread, completion, history healing and bulk completion. The next explicit attempt can read fresh state. Busy, unknown and unrecognized responses retain the operation.
- Ordinary mutations take a shared owner advisory barrier; calendar/profile membership changes take the owner’s exclusive barrier. Legacy/content-only writes also participate. No global vacation-table lock remains in generated containment functions.
- Plan same-course Edit combines allowed content/date fields in one owned, snapshot-checked transaction with exact receipt Undo. Numeric duration conversion is JavaScript-round-trip-safe.
- Plan Add and Log extra use a fixed field contract, server-chosen queue slot and exact insert capability. Existing placeholders can be reused only when untouched. A new row has receipt Undo; reused placeholders retain existing no-Undo behavior. Completed additions and tail respread commit together.
- Explicit selected Delete uses a snapshot captured before the existing Undo delay. Undo cancels the pending write; subsequent work makes deletion stale. All groups are prepared first; partial multi-course outcomes are reported honestly. Single Plan deletion retains its existing immediate semantics.
- Plan bulk placement uses one protected transaction per course, preserves every unselected row and offers receipt Undo. Multi-course operations remain separate transactions.
- Course Stop/Delete preserves completed rows and unfinished notes/time/start markers. Delete detaches retained history through the existing foreign key. Archive/unit wording remain normal metadata writes. Profile calendar changes are serialized and included in expected state so stale requests refuse.

## Acceptance still outstanding

Do not activate the customer or propose a restricted pilot. This checkpoint still needs independent review of its exact commit, broader regression/adversarial coverage and remaining active-writer audit. In particular:

- Durable tail-refresh recovery across a full page reload is not implemented here. In-memory definitive-stale recovery is fixed; do not describe it as durable operation persistence.
- Cross-course lesson reassignment and preserved-row calendar-shift behavior need explicit verification/compatibility resolution. Do not claim every Edit/settings combination works.
- Newly allowed preserved/completed single moves need focused semantic and preservation tests; ordinary single move and bulk placement have tests, but those edge cases do not.
- Browser coverage for deletion, course lifecycle and bulk placement remains incomplete. SQL/API tests do not substitute for it.
- Installation was rehearsed against a reconciled empty copy of the reviewed pre-containment catalog. Both migrations from a destination’s actual prerequisite stack, release identity, receipt maintenance and deploy ordering still require destination-specific verification.

No external write, hosted migration, customer repair, push, merge, deployment or email has occurred. The existing shared staging reservation is unchanged.
