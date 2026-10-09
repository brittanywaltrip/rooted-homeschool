# Local release package

This packages the four reviewed SQL proposals from a10838ae366b33eee0060be694e47d947d9dc5c2 into one CLI-named transactional migration. It does not change application behavior beyond those already tested definitions and does not implement the old-client design. Nothing has been pushed or applied to a hosted database.

`20261009174245_kandl_preserved_cascade_and_completion_locks.sql` was created by installed Supabase CLI 2.117.0 `migration new`; CLI telemetry was disabled and its per-command home isolated under /tmp. No linked project or hosted migration command was used. `assemble.py` deterministically fills that existing file from the checked-in proposals and `baseline.json`; `manifest.json` pins all source hashes and the generated migration hash.

## Preconditions and order

Requires the reconciled PR146 Builder atomic-settings/work/unslotted stack, goal-guard migration, existing daily switch/log schema and the reviewed completion/move functions. The migration checks exact prosrc hashes for the helper, both Builder overloads and four existing completion/move implementations. It refuses missing/drifted dependencies and any already-present preservation column/receipt table. Do not loosen these checks to force a target to match; reconcile actual target metadata and regenerate/review a new package.

One transaction adds preservation state and cascade snapshot/commit/Undo definitions, replaces cleanup/guard and daily reconciliation, then installs final NOWAIT completion/move/Builder definitions. Historical cleanup or Builder definitions must not be replayed afterward. Five-second lock acquisition and 60-second statement limits bound migration blocking; exceeding them is a rollback and investigation, not permission to raise limits blindly. Private-receipt access and required column/trigger shape are checked before commit.

No customer-specific data repair or activation is included. Existing lesson columns and goals are preserved; the new marker defaults false. No badge table recreation, local fixture identity, local PostgREST reload, switch toggle or migration-ledger fabrication belongs in the generated SQL.

## Rehearsal

`PR146_COMPAT=1 RELEASE_PACKAGE=1 node investigation/atomic-db-rehearsal.mjs` uses only fresh disposable native PostgreSQL clusters. `legacy-baseline-fixture.sql` contains metadata-only reference definitions necessary to represent the expected pre-state; it is not a deployment installer. Tests alter a prerequisite helper to prove atomic drift refusal, install the package once, prove duplicate refusal, preserve a preexisting synthetic work row, and exercise the existing cascade/Undo/preservation cases. The package was also run through the 11-case compatibility driver; the separate calendar case is unchanged code. Exact catalog comparison against the original proposal sequence covers 23 functions and matches bodies, security-definer flags, search paths and ACLs.

The native cluster is not the complete hosted catalog. Actual target ledger, schema, triggers, ownership/ACL, deployment/backend identity and production build remain freshness/release gates. Full suite/source checks on a108 are retained; package changes are SQL assembly and test/docs only. Old-client containment, receipt minimization/retention and vacation-lock load review remain locally actionable before activation.

## Backup and rollback boundary

Before any later approved hosted application, export the exact prior function definitions/owners/ACLs, schema/trigger/ledger state and verified consistent data backup/PITR checkpoint. Rehearse restore separately. On failure before commit, this migration rolls back atomically. After committed family edits, do not drop the marker/receipts or restore old unguarded writers. Prefer a reviewed scoped safe pause retaining owned replay and all data. The existing Builder pause artifact covers Builder only; a full capability-aware pause/resume package is part of the unfinished old-client work. There is deliberately no misleading universal down migration.

Source: official CLI migration documentation https://supabase.com/docs/reference/cli/supabase-migration-new. The current Supabase changelog was inspected; no platform credential/security change was made. Native 17.11 versus prior hosted 17.6 remains a compatibility limit to verify against the current target.
