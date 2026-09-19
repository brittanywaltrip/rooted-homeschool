# Rollout — expand, deploy, revoke

Three stages, in this order. The order is not a preference: applying the revoke
before the callers ship breaks every delete in the deployed bundle, and shipping
the callers before the functions exist calls things that are not there.

**Nothing here has been run. Production is unchanged.**

## Stage 1 — EXPAND (database only, additive)

**APPLIED to rooted-staging 2026-09-19.** The ledger versions below are the ones
`apply_migration` assigned; the repo filenames were renamed to match, per
CLAUDE.md's rule for migrations from 2026-09-18 onward.

Apply, in order, with `apply_migration` (migrations do not run on deploy in this
repo; see CLAUDE.md):

| # | migration | adds |
|---|---|---|
| 1 | `20260919231657_schedule_commit_atomic` (ledger 20260919231657) | `delete_lesson`, first `schedule_commit` |
| 2 | `20260919231716_schedule_state_version_title` | `title` + `hours` in the digest |
| 3 | `20260919231737_delete_lessons_rpcs` | `delete_lessons`, `delete_year_lessons`, `delete_goal_pending_lessons` |
| 4 | `20260919231840_schedule_commit_lesson_updates` | `schedule_commit` with lesson updates, locks, guards |
| 5 | `20260919231848_schedule_commit_status` | `schedule_commit_status` |

**One behaviour change to know about before stage 1.** `schedule_commit` locks
the account's `auth.users` row **first**, before the proposal, goal, lesson and
vacation locks. It is the parent a vacation INSERT must key-share, and
`FOR UPDATE` cannot lock a vacation row that does not exist yet.

What is **demonstrated** by the two-session tests: for the length of a save —
validate, write, commit — a concurrent INSERT into a table whose `user_id`
references `auth.users(id)` for *that* account waits and then completes; and
another account is unaffected, because it is one row. Taking this lock first is
what avoids a deadlock: with it taken last, the probe in `deadlock.sh` produces
`deadlock detected`.

What is **not** demonstrated, and so is not claimed: whether an ordinary
Supabase Auth token refresh writes to `auth.users`. An earlier draft of this
document asserted that it does. It may, and if it does that write would wait
too — but the package proves the FK key-share behaviour and the vacation race,
not Auth's internals. **Worth observing during stage 2** on staging: sign in,
leave a session open across a save, and confirm nothing about auth stalls.

Every one only adds functions or redefines `schedule_state_version`. **No
privilege changes.** The currently deployed app keeps working throughout,
because it still holds DELETE and does not call any of these.

After applying, read back each recorded version and rename the repo files to
match the ledger, per CLAUDE.md's rule for new migrations.

**Reversible:** each has an executable rollback in `supabase/rollbacks/`.
Rolling back #2 re-opens the silent loss of a concurrent rename; that is the
decision it represents.

### Stage 1b — search_path hardening (applied 2026-09-19)

`20260919232901_harden_scheduler_search_paths` puts `pg_temp` LAST on all 13
privileged functions in the scheduling chain that lacked it. Without it,
PostgreSQL searches the caller's TEMPORARY schema first for relation names, so
any authenticated caller can shadow a table a SECURITY DEFINER body reads.
Demonstrated in both directions by `harness/shadowing.sh`.

Bodies are untouched: `ALTER FUNCTION ... SET`, so behaviour, owner and grants
are unchanged. Executable rollback restores each previous path exactly.

Also see `STAGING-LEDGER-REPAIR.md` — a staging-only prerequisite repair,
**not** to be applied to production.

## Stage 2 — DEPLOY the app, and verify

Merge the branch to `staging`, let it deploy, and run the browser tests in
`STAGING-TESTS.md` against rooted-staging. The app now calls the RPCs; it also
still holds DELETE, so a failure at this stage is recoverable by reverting the
deploy alone, with no database change.

Do not proceed until every test in that file has been observed passing **in a
browser**, not by proxy.

## Stage 3 — CONTRACT (the revoke)

Apply `20260920000000_contract_revoke_client_delete`.

This is the step that contains the bug for already-loaded tabs, and the step
with user-visible consequences:

| already-loaded tab does | what the parent sees |
|---|---|
| Builder save | fails, loudly. **Nothing destroyed** — the containment working |
| "Add a past year" undo | fails loudly; broken until reload |
| Plan bulk delete | fails loudly |
| Single-lesson delete | fails loudly **on the new bundle**; on an old one the row returns on reload |
| Teardown bulk delete | quiet, logged, reconciled on next load |

Pick a low-traffic window. The rollback (`..._ROLLBACK.sql`) restores
`authenticated`'s DELETE immediately and does **not** restore anon's grants,
which were dead weight closed by RLS.

## Not covered by this plan

Phase 1 of `handleSave` — goal inserts/updates, activities, archive changes and
the reconciliation sweep — still writes through separate calls. This rollout
makes the **Phase 2 lesson rewrite** atomic. Whole-builder atomicity is a larger
design and is not in scope here.
