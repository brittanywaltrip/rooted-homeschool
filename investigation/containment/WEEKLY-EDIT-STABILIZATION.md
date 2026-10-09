# Bounded weekly logging and recovered Edit stabilization

Base: reviewed d65b93f665a26d67e50f9af02abb3b5cc5b27ada. These changes are a separate local continuation, not a production release.

Unfinished course lessons with no scheduled date now remain available in the curriculum list, with a "Not scheduled · ready to log" label. Supplementary rows stay outside calendar/Today inputs and are refreshed after completion, including a zero-write tail refresh. Initial stale check-offs refuse an existing completion. The explicit Change action captures completion timestamp and planned date, which are checked again during placement; it still permits intentional correction.

Date/number Edit now canonicalizes the eligible tail within the same locked transaction before recording its receipt. Recovery therefore observes the final state and exact Undo can restore the original full snapshot after reload. The new edit_respread source is internal only; untouched placeholders remain reusable by Add/Log extra, while existing work and preservation guards remain enforced. No Undo retention or stale-state guard was relaxed.

Focused verification, 2026-10-09:
- TypeScript: pass. Targeted ESLint: zero errors, 13 existing warnings. git diff --check: pass.
- Completion/version, completion-respread, Today unslotted, missed-work and scheduler-contained suites: 63 passed, zero failed/skipped.
- Actual browser: recovered Edit after two lost responses, reload, recovery, Undo and reload passed.
- Actual browser: weekly lesson 5 then 1,4,3 on chosen historical dates; earlier unfinished lesson remained visible after reload in another tab; original IDs and unfinished lesson 2 preserved.
- Actual two tabs: stale initial completion refused, with the entire winning row unchanged. Explicit Change-date browser flow passed.
- API: nine Edit groups passed, including full snapshot restoration, replay/repeated Undo, invalid form refusal, later-note stale refusal and old direct-writer blocking.
- API: Edit-derived untouched tail reused by Log extra with its original ID; tail with later notes refused unchanged.
- Independent read-only reviews found no remaining blocker in these bounded UI and SQL changes; one discovered placeholder-source compatibility issue was corrected and retested. Reviewers did not independently run the runtime tests.

Synthetic evidence is retained outside the repository under ../synthetic-runtime/stabilize-*. Both disposable owners were removed with zero remaining owned rows. The owned app server stopped. Runtime restored 72 saved definitions, removed seven candidate-only functions and the extra capability column; exact catalog/ACL checks passed with zero protected cohorts/capabilities. No hosted resources or real family data were changed.

Qualifications: the full 2334-test suite and exact export compilation passed on d65b93f, not this continuation; they were not rerun in this bounded pass. A fresh whole-migration rehearsal, dedicated injected Edit tail-failure rollback test and actual two-tab stale intentional-correction test were not run in this pass (stale correction/reopen checks have focused unit coverage). One initial positive-correction harness assumed a date chooser for a same-day lesson; the actual UI immediately logged today, so the harness was corrected to exercise the explicit Change action. Progress remains queue-pointer based, not actual completed count. The supplementary query follows the prior unpaginated query pattern and may hit service row limits for very large families. The historical missing-row cause remains unproved. These results do not authorize production installation or customer repair.
