# Preserve unslotted lessons during Builder saves

## Problem and behavior

The remaining nine Builder-risk recovery lessons would become unfinished with no queue slot after completion-only recovery. The current Builder can delete such rows on a schedule-changing save if they have no notes or minutes and sit above the highest completed lesson number. Clearing their completion before fixing that path would expose their original lesson rows to deletion.

This patch preserves every existing unfinished unslotted lesson. An ordinary save, schedule change, or curriculum shortening keeps its identity, completion state, null slot, pin, date, notes and minutes. It does not infer a queue slot or turn it into completed history. Existing slotted lessons still rebuild, release live-queue pins, and retire under the previous work-preservation rules.

The planner excludes unslotted pins from the release list and holds their rows back from deletion. The atomic database RPC independently refuses an unslotted row in delete, unpin or redate lists. Retirement only affects slotted rows. Under the existing curriculum/lesson locks, the RPC snapshots every unfinished unslotted row in full and verifies it afterward. A trigger side effect, including a changed timestamp, rolls the entire write block back. Existing owner checks, restricted search path, credential-independent database authorization, work guard, stale-plan checks and capacity checks remain.

If a preserved future date conflicts with the new projection, the save refuses instead of moving or deleting that lesson. This is deliberate preservation, not a solution for displaying an unslotted lesson on Today. Family P's Oct 2 lesson remains a separate hold. Completion-only recovery of any remaining row is not authorized by this PR.

## Local validation

- 23 added planner/commit tests cover all nine synthetic recovery shapes with clear-pins both off and on, hidden and pinned variants, shortening, forged writes, ordinary forward scheduling, and an unslotted future lesson whose slot must not be invented.
- Targeted scheduler/commit suite: 511 passed, 0 failed, 8 skipped.
- Full application suite: 1,992 passed, 0 failed, 8 skipped.
- TypeScript passes. Focused lint has no errors; its existing `_d` unused-variable warning remains. Diff whitespace check passes.
- SQL compiles with the preceding migrations on a local PostgreSQL 18.3 engine (PGlite 0.5.8). All 30 SQL assertions pass: clean rebuilding, exact whole-row preservation, pointer and parent-work preservation, stale/forged requests, shortening, concurrent-drag snapshot refusal, capacity rollback and injected trigger-side-effect rollback. Four additional checks pass for authenticated ownership, cross-family refusal, anonymous execute denial and retained search path/privilege model.
- This is a minimal synthetic schema, not the complete production schema. The native throwaway-cluster script's existing 22 cases were not rerun here because server binaries were unavailable. PGlite does not establish multi-session lock behavior or staging trigger compatibility. Those require the staging rehearsal below.

The CLI generated `supabase/migrations/20260930200903_apply_builder_rebuild_unslotted_guard.sql`. Historical migrations are unchanged. The preceding RPC body is preserved in `supabase/rollbacks/apply_builder_rebuild_unslotted_guard.sql`; using it after recovery would remove protection, so rollback requires reviewing the affected unfinished rows first.

## Repeat the local SQL check

Install the test engine outside the app repository, with the exact version:

```sh
npm install --prefix /tmp/rooted-pglite --no-audit --no-fund @electric-sql/pglite@0.5.8
node supabase/tests/builder-rebuild/run-unslotted.mjs /tmp/rooted-pglite/node_modules/@electric-sql/pglite/dist/index.js
```

No app dependency was added. The harness creates only an in-memory database. It loads the normal minimal fixture unchanged except for omitting `CREATE EXTENSION pgcrypto`, since its only required function, `gen_random_uuid`, is built into the engine. The SQL assertion file also runs through the existing native `run.sh` rehearsal when PostgreSQL binaries are available.

## CC staging handoff and release gates

1. Keep the integrity routine paused and all eleven remaining recovery rows untouched. Use rooted-staging only, with its canonical staging database ref verified through health and test-write guards.
2. Apply the new migration on staging and deploy the exact app commit. Verify the installed RPC body against the committed migration. No production migration or deployment yet.
3. Build synthetic versions of all nine recovery shapes, undo their completions only in those fixtures, and save through the actual Builder. Exercise ordinary saves, changed school days/pace/start dates, and shortening. Verify unslotted rows in every column and ordinary forward lessons, genuine completions, pointers, pins and notes/minutes.
4. Send old-client delete/unpin/redate plans and confirm refusal without writes. Test concurrent drag and completion in a second session. Inject a temporary trigger side effect and confirm complete rollback, then remove it. Verify any future-date collision refuses without moving the preserved lesson.
5. Run the exact deployment's smoke suite and review Plan/Today on synthetic accounts. Family P's future lesson must not be presented as solved: no slot still means it is absent from Today. Remove every fixture, login and test trigger.
6. After staging evidence and release approval, deploy the migration before the client. Old-client destructive plans then refuse safely. Verify production's installed RPC body and normal Builder behavior before changing any recovery eligibility guard.
7. Only then prepare a fresh completion-only preview for the remaining risk lessons, with separate decisions for the Oct 2 lesson and Option B. Rehearse that recovery script and re-freeze immediately before any approved apply.

No production database change, customer contact, routine enablement, or recovery apply was made while preparing this patch.
