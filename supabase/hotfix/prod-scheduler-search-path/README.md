# Production hotfix: scheduler search paths

**Status: PREPARED, NOT APPLIED. Do not apply with Stage 2, and do not apply
without a separate go-ahead.**

## What is wrong on production right now

Four functions are live on production (`gvkbegvvmhcrmxdorctk`), all
`SECURITY DEFINER`, all owned by `postgres`, none listing `pg_temp`:

| function | current search_path |
|---|---|
| `schedule_preview(text, jsonb)` | `public` |
| `schedule_state_version(uuid[])` | `public` |
| `schedule_seal_proposal(text, uuid[], jsonb, bool, bool)` | `public, extensions` |
| `schedule_commit_dry_run(uuid, text, uuid[], jsonb, bool, bool, text)` | `public, extensions` |

When `pg_temp` is absent, PostgreSQL searches the caller's temporary schema
FIRST for relation names. `authenticated` can create temp tables, so a signed-in
family can create `pg_temp.lessons` and these bodies will read it while running
as `postgres`.

## How bad, honestly

Bounded, and worth fixing anyway.

`schedule_commit` and the delete RPCs do **not** exist on production, so there
is no destructive consumer of a poisoned read: nothing here deletes or rewrites
lessons. The realistic impact is wrong answers from `schedule_preview`,
`schedule_state_version` and `schedule_commit_dry_run`, and `schedule_seal_proposal`
writing a `schedule_proposals` row derived from attacker-controlled input.

The reason it matters more than that sounds: `schedule_state_version` is the
optimistic-concurrency check the whole Stage 2 design rests on. If a caller can
influence what it hashes, they can make a stale proposal look fresh. That is
harmless while nothing consumes it and is a data-loss primitive the moment
`schedule_commit` lands. **This must be closed before Stage 2 ever reaches
production**, which is exactly why it is prepared separately and now.

A fifth function, `schedule_canonicalize_proposal`, has no `search_path` at all
but is `SECURITY INVOKER`: it runs with the caller's own privileges, so
shadowing gains them nothing they do not already have. It is out of scope here.
It is what the Supabase advisor flags as `function_search_path_mutable`, so that
finding will persist on production after this hotfix. That is expected.

## The rest of production, which this hotfix deliberately does not touch

Read from production 2026-09-19. Twelve `SECURITY DEFINER` functions in
`public` do not end their `search_path` with `pg_temp`. Four are in scope above.
Of the other eight:

| function | current path | note |
|---|---|---|
| `move_lesson_to_date(uuid, date)` | `public` | **callable by `authenticated`** — same exposure class as the four, and the one worth doing next |
| `increment_photo_count(uuid)` | `public` | callable path, writes a counter |
| `recompute_curriculum_current_lesson(uuid)` | `public` | `service_role`/trigger only; not reachable by a family |
| `block_lesson_goal_detach()` | `public` | trigger |
| `curriculum_goals_cleanup_orphans_trg()` | `public` | trigger |
| `lessons_fill_child_id_from_goal()` | `public` | trigger |
| `lessons_recompute_current_lesson_trg()` | `public` | trigger |
| `get_user_id_by_email(text)` | `""` | **not vulnerable** — an empty path resolves nothing unqualified, which is stricter than listing `pg_temp`. Do not change it. |

So the honest count is eleven genuinely unhardened, not twelve: the empty-path
one is a false positive of the "lacks pg_temp" test, and the preflight query
now excludes it.

They are left out because you scoped this hotfix to the four scheduler
functions and a hotfix that quietly grows is a hotfix nobody can review. Staging
has all of them hardened already, so the migration text exists if you want a
second, larger pass. `move_lesson_to_date` is the one I would not leave for
long.

## Order of operations

1. `1-PREFLIGHT.sql` — read-only. Confirms the cluster, prints the four current
   paths, lists any OTHER definer function lacking `pg_temp` (report, do not
   fix), records definition checksums, and checks nothing is mid-flight.
   **Expect exactly 4 rows in section 2. A different count means stop.**
2. `4-SHADOWING-TEST.sql` — run it BEFORE the fix. It should report
   `unhardened_sees = 2` and `VERDICT: VULNERABLE`. If it does not, the premise
   is wrong; stop and re-diagnose rather than applying a fix for a problem you
   have not reproduced.
3. `2-FORWARD.sql` — the four `ALTER FUNCTION ... SET search_path` statements,
   wrapped in a transaction with a check that refuses to commit unless all four
   end in `pg_temp`.
4. `4-SHADOWING-TEST.sql` again — must now report `SAFE` for all four.
5. `1-PREFLIGHT.sql` again — the definition checksums in section 4 will differ,
   because `pg_get_functiondef` includes the SET clause. The bodies have not
   changed; that is the only expected difference.

Rollback is `3-ROLLBACK.sql`, which restores each previous value exactly and
says plainly that doing so reopens the hole.

## What this is not

- Not a migration file. It carries no ledger version because it has not been
  applied. If it is applied through `apply_migration`, name the repo file
  `<assigned version>_harden_prod_scheduler_search_paths.sql` per the CLAUDE.md
  rule, and move it out of `hotfix/`.
- Not Stage 2. It adds no function, changes no grant, and revokes nothing.
- Not a substitute for the staging work. Staging already has all 13 functions
  hardened under ledger version `20260919232901`.
