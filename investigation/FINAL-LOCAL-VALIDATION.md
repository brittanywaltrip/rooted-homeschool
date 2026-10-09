# Final isolated candidate validation

The local correction is integrated with the reviewed loopback identity guard. Aggregate tests, TypeScript and the complete existing PR146 compatibility matrix pass. Real password sign-in and Today rendering pass, but full signed-in scheduling E2E is blocked by missing application schema. Loading Today also performed 101 real daily-reconciliation date writes on the unmarked synthetic baseline. Do not claim that browser load was write-free or that the narrow date/queue repair is contained.

## Candidate identity and contents

Checkout: `rooted-recurrence-local`, branch `fix/synthetic-recurrence`, based on `3ad1d0f6c856a204edc2f89a11d536a977270c33`. The final commit is recorded in `synthetic-runtime/final-candidate-identity.json`.

Application changes: nested NOWAIT goal/lesson acquisition in shift, Undo and daily reconciliation; reviewed loopback identity/account guard from `29377c8c3951e72c8cc879350f56c1470158ffd6`. No projector algorithm changes. Rehearsal changes add separate evidence destinations and real local browser/characterization harnesses. No branch merge, push, publication, deployment or remote SQL occurred.

## Validation matrix

| Stage | Result | Precise coverage |
|---|---|---|
| Aggregate unit suite | PASS: 2,227 passed, 8 skipped, 0 failed | Final application code including local identity guard. Skips: two compression, five add-to-next-school-day, one explicitly unresolved save-day disappearance. |
| TypeScript | PASS | `tsc --noEmit --incremental false`. |
| Changed-file ESLint | PASS | Guard code/tests and changed/new JS harnesses; final hydration-gate edit linted separately. SQL exercised through actual PostgreSQL. |
| Relevant Today/Plan/Builder ESLint | FAIL, inherited | 4 `react/no-children-prop` errors (Today lines4970/5078/5852; Builder4551), 51 warnings. These files equal the base blobs. Not an overall lint pass. |
| PR146 base compatibility | PASS | 21 reported scenarios, including 64 SQL/TypeScript parity/mutation checks and the explicitly limited callback/coordinator browser rehearsal. |
| PR146 additional matrix | PASS | Builder actual guarded RPC; unslotted projection refusal; unslotted cleanup; daily completion-window refusal; gap/silent/Undo/protected/deferred review probes; timezone/DST window suite. All11 runner invocations exit0. |
| Faithful scheduling slice | PASS | Eight serial actual RPC scenarios across Sunday/Tuesday, completion with blank-note prefix preservation, missing-preservation daily payload rejection, exact projected daily writes, later legitimate suffix edits. Enclosing transactions roll back. |
| Completion lock contention | PASS red/green | All3 original RPC lock paths reproduce deadlock; corrected calls refuse busy, release goal/lesson locks and allow completion while the refusing outer transaction remains open. Own-transaction state and receipt/day-log readback show no refusal writes. |
| Actual committed retry/recovery | PASS | Busy writes nothing; a parent note then commits; old expected state refuses unchanged; fresh expected state applies; exact request replay writes nothing; separately committed Undo restores the fresh before-image including the newer note. Four audit records remain. |
| Real local password sign-in | PASS | Real application login route and isolated Auth. No session mocks or fabricated API responses. |
| Real Today | PARTIAL / containment failure on unmarked baseline | Actual page rendered and screenshot inspected. Missing tables produce404/PGRST205 and appointments/lists500. Actual daily RPCs write51+50dates on load. |
| Real signed-in Plan/shift/Undo/completion/reload/busy-retry | NEVER RUN | Stopped at the first confirmed broken app/data boundary. RPC tests and the smaller callback shell are not substitutes. |
| Production build/deployment, remote migration, customer repair | NEVER RUN | Not authorized here. |

The real-browser harness initially submitted before React hydration. The corrected run waits for network idle and attached React state before filling/submitting, then signs in successfully. The premature submission put the disposable credential in a local Next request log; the saved log was sanitized and the local runner now redacts it. Credentials and authenticated storage are excluded from shareable evidence. Browser routing blocks remote destinations, including Google/Vercel analytics; there are no mocked successful responses.

## Browser schema blocker: smallest observed next slice

Today directly requested these absent public tables: `family_notifications`, `app_events`, `memories`, `monthly_reflections`, `activities`, `activity_logs`, `yearbook_content`, `appointments`, `appointment_exceptions`, `earned_awards`. Its `/api/lists` handler additionally requires `lists` and `list_items`; `/api/appointments` requires the two appointment tables.

These twelve tables plus their actual columns/defaults/constraints/FKs/indexes, RLS, grants, triggers/functions and required dependency closure are the smallest observed extension for the broken Today boundary. Acquire reviewed schema-only definitions; do not invent permissive stubs or assume CREATE files represent current hosted schema. Seed no customer data. Storage is not needed merely to render empty synthetic photo collections; upload flows would be a separate scope.

This is an observed lower bound, not a claim that twelve tables complete the entire app. Plan and later actions may expose further RPC/table dependencies after Today is repaired. The existing10-table scheduling slice plus candidate additions is not full application equivalence.

## Real browser write evidence and final runtime state

`post-browser-audit.json` and `post-browser-daily-log.json` establish101 writes tagged `daily_reconcile`, with51 Sunday and50 Tuesday rows, on the initial unmarked/inverted synthetic baseline. This is not a marked candidate shift and not a copied customer repair. It independently demonstrates why dates/queues alone cannot provide recurrence containment.

Audit total:4,659 = previous4,554 + four committed retry/Undo records +101 browser reconciliation records. One synthetic Auth account,104 lessons,three goals remain; intent/blocked tables are empty. The temporary retry course was removed after explicit synthetic cleanup; its audit history remains. The101 browser date changes and two daily-log rows are intentionally retained as evidence. This final state is not the original synthetic baseline.

The isolated database retains candidate preservation/daily proposals and the lock correction. The local Next server was stopped after validation; Colima/Supabase remains available. Original production-derived schema files and frozen application checkouts remain untouched.

## Additional fields and approval boundary

See `KANDL-ADDITIONAL-FIELD-PLAN.md` and `synthetic-additional-fields.json`. Prefix preservation requires a new proposed boolean column and supporting RPC/trigger changes. The selected anchor uses existing `queue_pinned`; if already true it requires no new pin write. The illustrative experiment adds four prefix markers and two selected pins to invented rows, which must not be substituted for unknown customer intent or counts. A live cascade also writes existing scheduling source/date fields; a historical repair needs explicitly approved provenance.

Customer execution remains blocked on exact supported inventory, combined field-level intent, verified target schema/deployment, full relevant browser/old-client coverage, explicit preserved-work release UX, calendar/other-lock review, recovery/backup readiness and approval. No blanket prohibition on legitimate future parent edits is proposed. Full recurrence containment beyond the tested candidate states remains unproven.

Independent final follow-up review found no new code blocker and corroborated the aggregate/compatibility results, committed retry/Undo evidence,101 browser writes and additional-field scope. The earlier report was explicitly marked historical and superseded by this final-phase report. Review was read-only, without a separate runtime rerun.
