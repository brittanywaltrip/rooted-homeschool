# Marked synthetic browser validation — October 9

The authorized 12-table extension is installed only in the verified local Colima Supabase stack. Real Today/Plan loading, a Sunday suffix shift, atomic Undo, a preserved lesson completion, and refreshes now have real-browser plus database-readback evidence. The marked fixture did not reproduce the unmarked control's 101 reconciliation writes. Full application/release validation remains incomplete because badge tables and the Builder RPC are absent locally, and the date-rollover check advanced only the browser clock.

## Installation and access verification

Brittany explicitly approved the reviewed extension. The previously rejected command was retried once, unchanged, and succeeded. Its wrapper first asserted the isolated Docker socket, container health, single rooted-isolated-loopback network, and database port bound only to127.0.0.1:54322. The new readback matches all12 table owners/ACLs/RLS flags,135 columns and182 definition records exactly. This resolves the review concern about unexpected default grants for these tables. No hosted DDL, customer rows or hosted writes were used. The user-reported Rosetta update was noted; this test never switched runtimes or presumed Docker Desktop health.

The extension contains empty application tables only. Metadata equivalence is scoped to the recorded catalog slice; it is not full managed Auth/platform equivalence.

## Real browser evidence

One isolated synthetic account, actual local Auth, actual Next routes and actual PostgREST/RPC responses were used. Browser requests were restricted to the two exact loopback origins; external analytics were blocked. No successful responses were fabricated.

The prepared104-lesson fixture restores the invented corrected queue/date state, sets four earlier unfinished preservation markers and two selected anchors, and removes two synthetic daily-log rows to allow a genuine reconciliation attempt. Its setup generated99 date-audit records; this explicit fixture reset is separate from browser effects. The seven original unmarked-control files remain byte-identical in unmarked-browser-control with hashes.

| Flow | Observed result |
|---|---|
| Marked Today, initial Plan and Today refresh | No failed application requests. All lesson/goal state retained; zero reconciliation date writes. Client projection found no changes to submit; this is not evidence of a nonempty daily RPC commit. |
| Sunday slot3 shifted Oct11 to Oct18 | Actual read_cascade_snapshot and commit_cascade_shift;50 selected/suffix rows each advance7days. Earlier prefix and other courses unchanged; notes, pins, queue positions and completion fields retained. |
| Undo | Actual undo_cascade_shift returns undone. Complete lesson/goal business before-image restored; updated_at and retained audit history appropriately differ. Subsequent refresh leaves the restored state exact. Two shift/Undo runs produced200 date-audit records total. |
| Preserved Sunday lesson1 completion | Actual Today card, duration confirmation, then explicit original planned-day choice. Completed on2026-09-20 at local noon, source completion_planned, recorded duration7minutes, backfill true; course pointer0→1. Other lessons and other goals unchanged. Refresh preserves exact post-completion state. |
| Badge side effects | FAILED: public.user_badges and public.badges absent (404/PGRST205). Core completion succeeded; badge success is not claimed. |
| Browser next-day rendering | Browser clock advanced to Oct10 and UI displayed Saturday, October10. Full synthetic lesson/goal/audit state unchanged. Database clock remained actual Oct9; this is client rollover coverage, not a real synchronized next-day backend test. |
| Repeated Builder save | Real Builder/preview and two Save actions. Requests fail404/PGRST202 because apply_builder_rebuild(p_expected,p_goal_id,p_local_day,p_plan) is absent. Eight RPC attempts reflect app retry/compatibility behavior. No core lesson/goal state change observed after either Save or final readback. No successful-save containment claim. |

The Builder reports settings saved but lesson generation incomplete. Since the unchanged form produced no observable core state change, the UI wording is not evidence of committed metadata changes. Builder preview also showed Sunday lesson2 on Oct18 despite its preserved Sep27 date; a complete Builder integration investigation remains required once its real RPC dependencies are installed.

Exploratory harness corrections are retained transparently: the first Reschedule lookup used button instead of menuitem; the first completion script missed the duration confirmation; the first Undo readback ran before its asynchronous RPC finished. The final Undo proof waits for the RPC response. These were test-harness errors, not application pass results. Archived scripts and failed run records remain in synthetic-runtime; no credentials or browser session state are saved there except the separately restricted preexisting private configuration files, which are excluded from evidence manifests.

## New correction from browser testing

The Plan catch-up banner displayed preserved Sunday lessons on Sep27/Oct4 while Still unfinished correctly showed Sep20/Sep27. Historical gap projection ignores pins and floors its start to14days ago. Shared computeMissedWork forwarded those fabricated dates into catch-up entries, whose completion action could use them.

The local fix filters explicitly preserved slots after historical gap projection. Their authoritative Still unfinished list and original-date completion remain available. Ordinary catch-up slots retain their historical dates, ordinary pins retain legacy behavior, and the global projector/database logic is unchanged. Filtering after projection avoids shifting another catch-up slot into the removed slot's date.

Changed application files: app/lib/missed-work.ts, app/lib/missed-work.test.ts and docs/CURRICULUM-SCHEDULING.md. Independent read-only review found no blocker. Added tests cover Sunday/Tuesday reproduction, ordinary pins with absent/false preservation, mixed skipped/preserved/ordinary work and Today/Plan parity. Corrected real Plan rendering retains Still unfinished and removes fabricated catch-up entries.

## Final checks

- Aggregate:2230 passed,8 skipped,0 failed. Skips remain two compression, five next-school-day, one unresolved save-day-disappearance case.
- TypeScript:pass; changed-file ESLint:pass.
- Existing PR146 compatibility matrix:all11 invocations pass, using separate disposable PostgreSQL instances. These include actual Builder RPC coverage in that smaller harness, not in the signed-in Supabase stack.
- Database evidence assertion script:pass for exact shift delta/scope, Undo, original-date completion, pointer change, refresh, client rollover and failed-save state retention.
- Existing Today/Plan/Builder lint baseline remains4 errors and51 warnings; those files were not edited. No overall lint-pass claim.

## Deliverables and remaining boundary

- KANDL-MARKED-BROWSER-VALIDATION.md (this report)
- synthetic-runtime/extension-catalog-verification.json
- synthetic-runtime/marked-browser-assertions.json and assert-marked-evidence.py
- synthetic-runtime/marked-verified-results.json (shift/Undo response evidence; its later first completion selector attempt is explicitly blocked)
- synthetic-runtime/marked-complete-results.json (successful core completion plus badge failures and first Builder locator timeout)
- synthetic-runtime/marked-rollover-builder-results.json (client rollover and missing-RPC failures)
- synthetic-runtime/marked-fixed-plan.png and marked-fixed-plan-text.txt
- synthetic-runtime/marked-final-runtime.json (104 lessons,3 goals,4958 audit records,0 intents,0 blocked rows)
- synthetic-runtime/browser-final-aggregate.txt, browser-final-typecheck.txt, browser-final-lint.txt, browser-final-compat-results.json
- synthetic-runtime/browser-harness-history/ (exploratory browser harness sources, run originally from the isolated checkout)

Remaining local extension scope: verified badges/user_badges schema plus access/dependency closure; actual apply_builder_rebuild and dependencies. The latter's six candidate migrations are already exercised by the native compatibility harness but have NOT been applied to this Supabase stack. The12-table approval was not broadened to install these. Successful repeated-save/Builder containment, full badge flow, true server-day rollover and comprehensive old-client behavior remain release gates.

Proposed release path remains separate: finish the missing local dependencies and full relevant browser tests; resolve preserved-work release/Builder behavior; independently review the exact candidate and schema order; obtain explicit release and customer-repair approval with verified live version and field-level customer intent. Then use an approved environment with backup/readback/rollback checks. No push, merge, deployment, remote migration, customer-record repair or email occurred in this phase.
