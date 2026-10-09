# Completion locking and real midnight follow-up

Status: the six reproduced lock cycles are corrected and tested locally. Real midnight rollover, refusal, Undo and subsequent actions are validated. One cross-midnight Builder-tab check remains unproven after a harness timeout. This document supersedes the pending lock/midnight sections of APPROVED-BUNDLE-RESULTS.md; it is not release approval.

## Correction under test

The local proposal `supabase/proposals/remaining_completion_locks.sql` changes five implementations covering six entrypoints: Builder four/five arguments, reopen, keep-slot move, restore book order, and legacy move. The four-argument Builder remains an exact delegating wrapper.

Each implementation first obtains the owned goal and all of its lesson rows in deterministic ID order, using NOWAIT inside an exception subtransaction. Completed and unslotted rows are included because completion/cleanup triggers can touch them. On contention the JSON functions return stale/busy; the historical void mover raises SQLSTATE 55P03, rooted_schedule_busy. Lesson-targeted functions recheck owner and goal membership after locking. Business logic after acquisition, signatures, security-definer configuration, ownership and ACLs remain unchanged.

This addresses the six reproduced row-lock cycles. It does not claim to eliminate arbitrary concurrent insertion, unique-index waits, or locks a caller acquired before entering the RPC. The legacy reproduction involved a lesson-to-lesson/trigger cycle; it did not have an original upfront goal lock.

The guarded local installer pins all 36 previously installed function definitions before replacement and checks the six resulting bodies/ACLs before commit. There is no migration-ledger write. Release requires an independently approved production migration/deployment plan.

## Real midnight protocol

Only the synthetic account and Chromium context use Asia/Bangkok. System time and timezone are unchanged. The browser was ready at 16:43:46UTC, 16.23 minutes before the actual 17:00UTC midnight boundary on October 9. Today, Plan and a Builder preview remain open. All browser traffic is restricted to loopback app 3106/API 54321.

The existing three-row control was set to unpinned October 9/10/11 dates and Fri/Sat/Sun school days. The original 104-row cohort was unchanged at setup. A Tuesday cascade receipt committed at 16:58:30UTC, with a Sunday stale preview retained across midnight. At 17:01:15UTC the already-open Today page showed the new local day; its control dates were October 10/11/16. Reload made no further date writes. Old-preview refusal, cross-midnight Undo and a fresh cascade/Undo succeeded. Subsequent fresh-day Builder saving/repeat and completion of preserved Sunday lesson2 on its original September 27 date finished at 17:04:21UTC.

No lock installation or unrelated fixture mutation overlapped this observation. After the browser finished, the app was stopped, the guarded lock correction was installed, and contention/serial tests used separately generated disposable goals.

## Automated tests completed before runtime installation

- Aggregate: 2,239 passed, 8 skipped, 0 failed.
- TypeScript: no errors. Focused lint: no errors or warnings.
- Eleven compatibility invocations passed. The ten atomic/Builder/cascade runs include the new lock proposal; the separate calendar-window run covers unchanged calendar code.
- Five offline fidelity tests confirm unchanged business suffixes and ACL/security headers against the exact approved bundle.
- Six repository tests cover acquisition/refusal/security contracts and client handling. These structural tests do not prove PostgreSQL lock release; the live separate-transaction tests provide that evidence.

The existing eight skips remain seven obsolete pre-queue rollback specifications and one explicitly unresolved historical save-day loss placeholder. A separate current Builder/Today overlap regression passed in both transaction orders, including save-day insertion, full batch retention, replay and repeated daily reconciliation. This is current RPC-level containment evidence, not a causal reproduction or resolution of the historical report; the placeholder remains explicitly unresolved.

## Runtime evidence

The guarded installer succeeded. Catalog verification confirms exactly five implementation fingerprints changed; the other 31 functions, all signatures, owners, ACLs, security configuration, tables, RLS and triggers remain unchanged. Both Builder overloads retain their original contracts. Installer SHA256:694001ab72af768fb0a727c4409b2a6bac8f8fbaff0bc332fdd30c52c9cc050f.

All six real contention cases passed. Each holds a conflicting lesson lock, invokes the actual RPC, confirms refusal with no inside/outside writes or receipts, independently obtains the partially acquired goal/earlier-lesson locks, and commits authenticated completion while the refusing transaction remains open. JSON entrypoints returned stale/busy; legacy raised SQLSTATE 55P03 as expected. Calls returned in approximately 0.9–1.3 ms. Completion notes and minutes survived. Six completion-trigger cleanup audit records belong solely to generated disposable courses and were retained. An initial test assertion incorrectly expected completion itself to create no audit row; it was corrected to attribute and retain those legitimate records, not suppress them.

Serial tests passed for Builder 4/5, exact request replay, busy→old-guard stale refusal→fresh retry, reopen, keep-slot, legacy movement and actual inverted restore order. No-user and wrong-owner refusals passed across all six entrypoints with exact unchanged snapshots. Both real Builder/Today overlapping transaction orders retained all three inserted lessons, including the save-day lesson, and repeat/replay added no writes. These are actual RPC/transaction tests, not a browser-overlap or historical-causality claim.

The independent midnight validator passed 1,311 field/contract checks and reports PARTIAL for the specific old-tab gap. It verifies three automatic control date writes, one positive new-day receipt, no reload repetition, an exact write-free stale refusal snapshot, cross-midnight Undo, fresh cascade/Undo, original 104-row preservation, and authorized Sunday2 completion/pointer 2. All204 midnight-session date audits are attributable: 3 daily-control moves, 3 deliberate fresh Builder-control moves and 198 cascade/Undo entries. No prefix dates changed.

The original Builder tab's save timed out waiting for an RPC and has no successful-save proof. Preserve this as an unproven check, not an application defect or a pass. A fresh continuation initially found the date picker absent because the loaded form used its Already into it branch. It then explicitly selected Starting fresh for the disposable control and chose October 11; the real Builder RPC applied with local day October 10 and exact Bangkok window 17:00Z→17:00Z. Control dates became October 11/16/17. Its repeated save was a no-op. This fresh continuation does not substitute for proof of the original tab surviving midnight. Initial failed attempts and their output remain archived.

Final readback retains 107 lessons/four goals exactly matching the post-midnight fixture, no generated test courses,3 Builder receipts, 2 daily receipts and 2 synthetic badges. Date audit count 5,184 includes 9 additional legitimate disposable-test records after the midnight count 5,175. Intent and blocked counts remain unchanged. The synthetic profile remains Asia/Bangkok; the system timezone/clock were not changed. The app is stopped and isolated database retained.

Evidence in sibling `synthetic-runtime/`:remaining-locks-green-results.json; remaining-serial-access-results.json; remaining-save-day-overlap-results.json; remaining-locks-install-verification.json; real-midnight-offline-validation.json; real-rollover-final.json; real-midnight-browser-results.json; locks-final-state.json; locks-final-aggregate.txt; locks-final-typecheck.txt; locks-final-lint.txt; locks-final-compat-results.json. Supporting harnesses and original failed attempt logs are retained there. Repository structural tests are in app/lib/remaining-completion-locks.test.ts.

## Scope and release

No hosted/customer writes, production repairs, migrations, deployments, pushes, merges or emails. Shared PR146 staging and prior worktrees stay untouched. The candidate remains local and requires explicit release approval. Before proposing release, close or explicitly accept the original-open-Builder midnight coverage gap, reconcile against the intended release revision, and prepare the exact migration/deployment and rollback plan. The historical save-day placeholder is a separate unresolved limitation, not a proved regression in this candidate. Any customer repair additionally needs a reviewed account-specific before-image, proposed change set, concurrency refusal and rollback plan.
