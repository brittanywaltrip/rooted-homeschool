# Approved policy implementation — local, not released

Branch `fix/cascade-preserved-work`, parent `b5bf1cb4617650679d4b35ba7e63200c12eaf076`. Reviewed `58c7439` and `b5bf1cb` checkouts remain unchanged. No remote database, family data, deployment, staging, PR, access setting or installation changed. No HTTP 403 retry.

## Behavior and representation

The exact confirmed selected queue suffix moves. Earlier unfinished dated rows receive a separate `queue_preserved` marker; their existing date fields, notes, durations, source, queue position and pin do not change. This is a new approved scheduling-scope decision, not reconstruction of a lost historical pin. It changes the marker and updated_at, so do not describe those rows as byte-for-byte unchanged. Completed prefix rows remain entirely untouched.

The marker is a normalized durable placement constraint, independent of completion provenance. Shared projection emits earlier work on its stored date even after the pointer passes it; it is excluded from the rolling active sequence. The ordinary unpinned suffix still rolls forward. Repeated shifts retain prior earlier work and preserve any newly excluded prefix. Earlier rows are never counted among the preview's moved lessons. The dialog also discloses newly preserved earlier work.

The same `Still unfinished` component is mounted in Today and Plan. Its owner-scoped, paginated query has no age, current-pointer or any-completion threshold. It links to the stored Plan date and refreshes after lesson changes. The new marker does not invent a completion, skip, backfill, missed-work answer or reportable study time.

SQL proposals extend atomic commit/Undo postconditions to the marker, validate exact preserved-prefix membership separately from moved suffix membership, and teach the server projector the same rule. The daily RPC compares preserved placement state; old daily payloads lacking it refuse. Pointer cleanup excludes preserved rows. A trigger refuses unaware date/order changes or deletion of unresolved preserved work, rather than allowing an old rebuild to erase it.

## Deliberate scope limits

- Arbitrary unpinned gaps remain unsupported; they refuse. Existing pinned gaps, holidays and variable-day capacity use the shared projector. This is not the previously proposed general relative-gap engine.
- An already manually reordered/non-book-order queue refuses. Existing legacy date-based preview semantics do not conclusively choose book order versus intentional manual order; enabling those cases still needs a clear scope rule. This implementation never widens them silently.
- An explicit general reschedule/release flow for a preserved row is not fully integrated with every old writer. Unaware edits/rebuilds are conservatively blocked by the new guard. Completion through existing explicit user paths remains allowed. This limitation must be resolved/reviewed before production activation.
- Prefix protection and the daily payload guard do not establish safety for every older open browser bundle or legacy tail writer. Full old-client transition remains a release blocker.
- The reviewer subsequently reproduced an invalid 48-hour completion-window bypass in parent b5bf1cb. **This policy branch inherits that finding.** A separate timezone-boundary correction is required; do not call this SQL safe for release yet.

## Evidence matrix

| Case | Status | Actual evidence / limit |
| --- | --- | --- |
| Preview versus committed scope, appended/replaced rows, settings/date/pin/note changes | PASS | Inherited executable coordinator/SQL regressions; complete retained snapshot equality |
| Double request, lost-response retry, concurrent same-snapshot operations | PASS | Synthetic coordinator and real PostgreSQL idempotency/serialization |
| Concurrent completion/note edit; Undo after later work | PASS | Full snapshot refusal and rollback; no overwritten later work |
| Silent immediate/deferred trigger changes; Undo prevention | PASS | Five independent review probes rerun on this branch; actual complete readback |
| Sunday/Tuesday, existing pinned gaps, holidays, variable capacity | PASS (bounded) | Pure tests plus 64 SQL/TS differential/mutated-date checks; not exhaustive calendars |
| Unpinned gap | SAFE REFUSAL | TS planner and direct-owner SQL reject, no writes; successful support is not implemented |
| Earlier dates/content, repeated suffix shifts | PASS | New policy tests; SQL prefix marker and exact Undo checks |
| Pointer advance after later completion; ordinary tail rolls | PASS | Shared projection and actual SQL completion/cleanup/daily RPC; earlier row remains unfinished |
| Five-day course, completed lessons 1–11, selected 12 | PASS | Generic legacy reorder model reproduces swapped 12/13 collision; new shift moves 12 onward correctly; completed prefix unchanged |
| Today/Plan unresolved visibility | PASS at component/query level | Both mount shared panel; no age/pointer filter; actual component markup rendered in browser with fixture hook state and inspected screenshot |
| Today/Plan full signed-in navigation/reload/completion UI | NEVER RUN | Local shell/adapter and component tests do not replace authenticated full-app E2E |
| Old daily RPC payload / implicit prefix rewrite / rebuild deletion | PASS (bounded) | Real SQL refusal; prefix snapshot unchanged |
| Every stale open client / legacy tail RPC | NEVER RUN / RELEASE BLOCKER | Not implied by the narrower guards above |
| False 48-hour completion window | KNOWN FAILED in parent | Independent review reproduced; separate fix pending |
| Full deployed schema, all triggers/RLS/PostgREST, lock ordering, PR146 integration | NEVER RUN | Minimal disposable schema plus explicitly loaded cleanup/daily proposals only |
| Hash-verified customer inventory on Mac / actual repair | BLOCKED / NEVER RUN | Prior Library HTTP 403; no retry or bypass |

Latest full unit run: **2,121 total, 2,113 passed, 8 skipped, 0 failed**. TypeScript clean. New helper/component lint clean. Combined changed-file lint includes the same 3 existing Today `react/no-children-prop` errors and existing warnings; the preceding commit's Today file independently reproduces those 3 errors. Do not call repository lint clean.

Disposable PostgreSQL run: 20 reported scenarios, including 64 parity checks grouped in one scenario and local callback/coordinator/SQL browser shift+Undo. Separate five review probes pass. New policy suite: five cases, including a generic five-day legacy fingerprint and completed-prefix preservation. The new panel screenshot is `../investigation-evidence/preserved-browser/unfinished-panel.png`; it uses actual component markup and stubbed hook state, not live app authentication. Other evidence uses `preserved-*` filenames.

## Customer evidence and repair boundary

Parent independently verified the 103-row original inventory in the cloud against its hash: 99 tail date changes (both date fields), four queue-field corrections across two adjacent inversions, 101 distinct changed rows; selected dates/pins/sources unchanged; the two earlier rows unchanged in that numerical proposal; no invented Tuesday lesson 1. This is supporting evidence received from the parent, not a claim of local inventory bytes or an executed repair.

Applying this new policy alongside that future repair would additionally record two preservation markers. That is a separately disclosed new-state change; it must not be smuggled into the claimed 101-row historical numerical diff. Produce an exact combined expected-state manifest after supported inventory access and complete-schema rehearsal. Save a pre-repair rollback of that actual approved transaction, not a claimed exact historical Undo. No repair script or live mutation was performed here.

Observed cascade usage (165 events, 16 users, 73 goals) is not an affected-account count. The additional five-day match is unreported by its customer and outside any repair scope.
