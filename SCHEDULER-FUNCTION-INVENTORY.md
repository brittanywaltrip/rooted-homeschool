# Scheduling call chain — function inventory (Stage 1b)

Read back from rooted-staging `cvgqovweybggrqakhdtd` **after** applying
`20260919232901_harden_scheduler_search_paths`. Every row is from
`pg_proc` / `information_schema.role_routine_grants`, not from the repo.

`owner` is `postgres` for all 21. `dynamic SQL` is **false** for all 21 — no
function in the chain uses `EXECUTE format(...)` or any string-built statement,
so SQL injection through an identifier is not a live concern here.

## The chain

| function | sec | search_path | execute | `auth.uid()` |
|---|---|---|---|---|
| `schedule_preview(text, jsonb)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `schedule_canonicalize_proposal(text, uuid[], jsonb, bool, bool)` | **INVOKER** | `public, pg_temp` † | authenticated, service_role | n/a ‡ |
| `schedule_seal_proposal(text, uuid[], jsonb, bool, bool)` | DEFINER | `public, extensions, pg_temp` | authenticated, service_role | yes |
| `schedule_commit_dry_run(uuid, text, uuid[], jsonb, bool, bool, text)` | DEFINER | `public, extensions, pg_temp` | authenticated, service_role | yes |
| `schedule_state_version(uuid[])` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `schedule_commit(uuid, jsonb, jsonb, uuid[], jsonb, jsonb, text)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `schedule_commit_status(text)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |

† `schedule_canonicalize_proposal` had **no `search_path` at all** before Stage 1b.
It was the one function the Supabase security advisor flagged as
`function_search_path_mutable`; that finding is now gone.

‡ It is SECURITY INVOKER and pure: it normalizes a proposal envelope and returns
it. It reads no tables, so it has no ownership check to make — RLS applies
normally to whatever the caller does with the result. It is in this table
because it is in the call chain, not because it is privileged.

## Replacement delete RPCs (Stage 1, same chain)

| function | sec | search_path | execute | `auth.uid()` |
|---|---|---|---|---|
| `delete_lesson(uuid)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `delete_lessons(uuid[])` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `delete_year_lessons(uuid)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `delete_goal_pending_lessons(uuid)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |

## Functions the chain fires into (triggers and helpers)

| function | sec | search_path | execute | `auth.uid()` |
|---|---|---|---|---|
| `move_lesson_to_date(uuid, date)` | DEFINER | `public, pg_temp` | authenticated, service_role | yes |
| `recompute_curriculum_current_lesson(uuid)` | DEFINER | `public, pg_temp` | **service_role only** | no — locked down instead |
| `lessons_recompute_current_lesson_trg()` | DEFINER | `public, pg_temp` | service_role | no — trigger |
| `curriculum_goals_cleanup_orphans_trg()` | DEFINER | `public, pg_temp` | service_role | no — trigger |
| `lessons_fill_child_id_from_goal()` | DEFINER | `public, pg_temp` | service_role | no — trigger |
| `block_lesson_goal_detach()` | DEFINER | `public, pg_temp` | service_role | no — trigger |
| `lessons_block_server_side_completion()` | INVOKER | `public, pg_temp` | service_role | no — trigger |
| `enforce_curriculum_school_days_nonempty()` | INVOKER | `public, pg_catalog, pg_temp` | PUBLIC | no — trigger |
| `set_lessons_updated_at()` | INVOKER | `public, pg_catalog, pg_temp` | PUBLIC | no — trigger |

A trigger function's EXECUTE grant does not matter the way an RPC's does: a
trigger fires on the table's behalf regardless. The `service_role`-only grants
here also mean `authenticated` cannot call them directly over PostgREST.

## Why `pg_temp` LAST, not merely present

When `pg_temp` is not in a function's `search_path`, PostgreSQL still searches
the session's temporary schema **first** for relation names. Any
`authenticated` caller can `create temp table lessons (...)`. A SECURITY
DEFINER body that then says `from lessons` reads the caller's table while
holding `postgres`'s privileges.

Listing `pg_temp` explicitly is what lets you choose the position, and it must
be last so real tables win. Putting it first is as bad as omitting it — proved,
not assumed: see `harness/shadowing.sh`, which asserts both directions.

## One function deliberately left alone

`public.guard_profile_entitlement()` (the `profiles` entitlement trigger, from
security fix 1) still has `search_path = public` with no `pg_temp`. It is
**not** in the scheduling chain and it is **not** shadowable: the body reads no
relations at all, only `NEW`/`OLD` fields and `current_user`. There is nothing
for a temp object to shadow, so hardening it would be diff noise, not security.
Recorded here so the next reader does not have to re-derive it.

## Advisor state after Stage 1b

- `function_search_path_mutable` — **gone** (was `schedule_canonicalize_proposal`).
- `authenticated_security_definer_function_executable` ×13 — WARN, by design.
  These functions exist to be called over PostgREST by a signed-in parent, and
  each re-establishes ownership internally against `auth.uid()`. The advisor
  cannot see that, so the warning stays.
- `rls_enabled_no_policy` ×3, `auth_leaked_password_protection` — pre-existing,
  unrelated to this work.
