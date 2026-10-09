# Independent review blockers: local follow-up

Separate branch `fix/cascade-correctness`, based on frozen `58c7439ddbcb54e6471d118b7a2cde93bec6e76a`. The reviewed checkout was not modified. This commit addresses correctness blockers only; the newly approved preserved-earlier-work policy is for a separate follow-up. No deployment, remote SQL or family record writes.

## Fixes

1. **Preview/confirmation binding.** The full owner-scoped snapshot and pure plan are now read before displaying the choice. Count, teaching-day delta and finish date derive from that exact plan, including subsequent queue slots sharing a date. The choice retains the snapshot. Confirmation compares a fresh read with it in full, refuses any changed membership/settings/dates/notes/pins/breaks, and submits that same expected state to SQL for the later race. It never silently expands to the new suffix. Unsupported or unreadable cascade previews disable only the cascade option; “Move just this lesson” remains available. No automatic wider move occurs.
2. **Exact readback.** Commit and Undo compare the complete actual state against the intended four-field changes. Unchanged rows, goal settings, breaks, membership and all protected row fields must match; only targeted rows' updated_at may change besides their requested scheduling fields. Immediate and deferred constraint triggers run before the checks. Any mismatch raises inside the subtransaction and rolls back every row and receipt effect.
3. **Server projection validation.** A private SQL validator independently checks the actual post-state against the shared projector's rules, including pin reservations, skips, make-ups, completed-today rewind, variable capacity, breaks and bounded date traversal. Unsafe unpinned gaps therefore roll back even when an authenticated owner calls the RPC directly, bypassing the TypeScript planner. This does not implement a new unfinished-work policy or repair old queues.

## Red/green evidence

The newly written preview-membership regression failed against the prior implementation (confirmation accepted expanded scope). SQL probes reproduced `applied` on an unrepresented gap, silent trigger date prevention, trigger alteration of protected notes, and `undone` despite a trigger preventing the requested restoration. Their prior failures are recorded in `../investigation-evidence/correctness-*-red.txt`.

All corresponding green probes now pass, asserting complete stored snapshot equality after rejection, not merely returned status. An additional deferred constraint-trigger regression passes. Run each with `CASCADE_REVIEW_CASE=gap|silent|undo|protected|deferred node investigation/atomic-db-rehearsal.mjs` (one value per run). No test connects to Supabase or loads credentials.

- Full suite: **2,116 tests, 2,108 passed, 8 skipped, zero failures**.
- TypeScript: clean (the final two additions are runtime tests only; prior full typecheck recorded).
- Changed files ESLint: zero errors, 12 existing Plan warnings.
- Disposable real PostgreSQL: existing 15 cases, **64 SQL/TypeScript differential checks** grouped as one scenario, and browser callback/coordinator/SQL shift+Undo: 17 reported scenarios. Separate five review probes also pass. The parity cases cover 32 settings/row combinations and a deliberately mutated date in each.
- Browser result and screenshots under `../investigation-evidence/correctness-browser/`; database results `correctness-db-results.json`. Full logs use the `correctness-` prefix and do not claim results for another commit.

## Remaining limits

This remains a local SQL proposal using a minimal disposable schema. The SQL projector counterpart creates a maintenance obligation: keep differential tests aligned whenever TypeScript rules change, and independently review this new validator. Full-schema/authenticated PostgREST rehearsal, legacy-client protections, receipt retention/content minimization and the global vacation-table lock review remain required before release. Passing these regressions does not approve deployment or a customer repair.

The private inventory download returned HTTP 403 in the reviewer task. It has not been retried or bypassed here. No tool output supplied a specific authorized access remedy; restoring authorized Library delivery requires that service/access issue to be resolved before another supported transfer. Python is already installed by the reviewer; no duplicate installation was attempted. Customer-specific byte-level rehearsal remains blocked, and all new cases use synthetic rows.
