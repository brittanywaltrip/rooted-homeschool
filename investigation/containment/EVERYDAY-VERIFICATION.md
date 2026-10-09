# Local compatibility checkpoint verification

Based on `4859cf80bf7efe5f00f65468fbdd9b705b11650a`; see `EVERYDAY-COMPATIBILITY-PLAN.md` for scope and unresolved acceptance criteria. No customer activation or release is authorized by these results.

Generated containment migration SHA-256: `ff446634c3e3a51a4c8291bd06d70d5219bcc728258eeed2eb22828890a1887f`.

## Observed local checks

Synthetic evidence resides in the sibling `synthetic-runtime` directory under task-6. Private login/environment files are deliberately excluded from this repository.

| Check | Result | Evidence |
| --- | --- | --- |
| Same-course edit, exact Undo, stale/retry/work preservation | 9 passed | `everyday-edit-results.json` |
| Add/extra log, Undo, explicit delete, delayed-delete stale work, metadata | 11 passed | `everyday-add-delete-results.json` |
| Course Stop/Delete, receipt replay after deletion, profile stale-state | 5 passed | `everyday-retire-results.json` |
| Independent-family writes during held calendar transaction | 10 passed | `everyday-owner-lock-results.json` |
| Selected placement forward/backward, replay, Undo, duplicate membership, ordinary single move | 8 passed | `everyday-placement-results.json` |
| Real sign-in / Plan Edit / Undo / reload | passed; zero background failures | `everyday-browser-evidence/edit-result.json` |
| Real sign-in / Plan Add and Log extra / Undo / reload | passed; zero background failures | `everyday-browser-evidence/add-result.json` |
| TypeScript | passed | `/tmp/kandl-everyday-typecheck.txt` |
| New helper/test ESLint | passed | `/tmp/kandl-everyday-new-eslint.txt` |
| Full unit suite | 2,309 passed, 8 skipped, 0 failed | `/tmp/kandl-everyday-unit-tests-final.txt` |

The database tests ran only on disposable synthetic owners in loopback Supabase. They are not evidence of the customer's exact affected records. The lifecycle test intentionally deleted the independent fixture's Shift course; do not rerun fixture-dependent scripts without a fresh fixture.

## Migration installation and catalog comparison

A distinct empty database `rooted_everyday_rehearsal` was created. The saved schema-only containment catalog was restored, its old containment wrappers were removed with `containment-restore-empty-baseline.sql`, and its leftover proposed recalibration function was removed. The new complete containment migration then installed successfully. Baseline function fingerprint preflights passed. Users, lessons and protected modes all remained zero.

Read-only comparison against the API/browser test runtime passed for 47 relevant functions: bodies, security-definer flags, search paths and ACLs. All four private tables' RLS and ACL definitions also matched. This is a containment-install rehearsal against a reconciled reviewed catalog, not proof that both migrations apply to any hosted database. The first reset attempt used a newer reset script and rolled back on a missing function; the evidence log preserves that setup failure.

## Verification limits and findings

- A full unit run initially had three source-shape tests referring to the old direct deletion/legacy extra-log path. They were updated to retain checked-delete and completion-respread coverage for both protected and legacy paths. New behavioral tests cover uncertain retries, definitive stale responses and pre-delay deletion snapshots.
- API/browser testing caught JSON numeric precision in duration hours; conversion now round-trips through JavaScript without false stale snapshots.
- The browser Add run caught an import placed before `use client`; that compile failure was fixed. Its successful rerun is the reported result.
- Same-family direct row writes may wait before reaching a trigger. The contention test explicitly uses bounded lock/statement timeouts; only guarded API calls are claimed to return promptly as busy.
- Browser deletion/lifecycle/bulk placement, preserved/completed single-move edge cases, durable recovery across reload and remaining cross-course/calendar writer compatibility are not claimed verified. Broader regression, final independent review and destination-specific checks remain required.
- Prior reports in this directory describe the earlier baseline. Where scope conflicts, this checkpoint's two EVERYDAY documents describe the new changes; no earlier broad acceptance claim carries over automatically.
