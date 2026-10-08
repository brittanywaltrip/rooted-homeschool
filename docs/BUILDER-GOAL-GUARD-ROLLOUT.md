# Builder goal guard — local preparation, not release authorization

Migration: `20261008000000_apply_builder_rebuild_goal_guard.sql`.
Base: PR146 head `8c07248861fc822064b7564629f0c36d5367a5f7`, including its atomic settings, work, and unslotted-date protections. Do not transplant this onto unchanged main without resolving those dependencies.

**Material rollout change: old clients fail closed for fresh rebuilds. Preserving signatures is NOT behavioral backward compatibility.** Migration first, compatible client second; the interval can temporarily block Builder saves. External application requires separate approval and independent review.

## Contract and lock

Both existing signatures remain `public.apply_builder_rebuild(uuid,date,jsonb,jsonb)` and `public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb) RETURNS jsonb`. The four-argument wrapper delegates with null settings. Security definer, restricted search_path, authentication/ownership checks and authenticated-only execution grants remain intact.

`p_expected.builder_guard_version` must be numeric 1. `p_expected.goal` contains the existing seven scheduling fields plus seven explicit dependencies (nulls included): archived, completed_at, child_id, curriculum_name, subject_label, default_minutes, scheduled_start_time. Builder builds these from the planning snapshot and its own confirmed metadata patch; it does not adopt a conflicting final read. Time values sent as HH:MM are normalized to HH:MM:SS.

The function retains goal FOR UPDATE followed by existing lesson locks. After owner-scoped committed-request replay, but before new settings or lesson writes, it requires the contract, independently requires an active/uncompleted goal, and compares the full expected goal with the locked record. Existing row, pointer, work, unslotted and capacity guards remain. A change winning the lock first makes the plan stale; a change arriving after Builder acquired the lock waits until Builder commits. This is serialization, not cancellation of later valid edits.

## Compatibility matrix

| Client / request | Previous PR146 RPC | Guarded RPC | Safe-pause RPC |
| --- | --- | --- | --- |
| Old client, fresh request | Prior behavior; known late lifecycle/metadata race | `invalid/client_upgrade_required`; no rebuild writes | `refused/builder_paused`; no rebuild writes |
| New guarded client, fresh request | `stale/goal` because extra expected-goal keys fail the old exact comparison; no rebuild writes | Applied only if active lifecycle and all existing/new expectations match under lock | `refused/builder_paused`; no rebuild writes |
| Valid owned/goal-matched previously committed request, either contract | Recorded `applied`, `replayed:true` | Recorded `applied`, `replayed:true`, before new lifecycle/contract rejection | Recorded `applied`, `replayed:true` |
| New client, missing required RPC overload | `unavailable` via existing missing-function handling; no fallback | Not applicable | Not applicable |

All replay behavior retains existing authentication, ownership, request shape, local-day and log-retention constraints. It is not an unlimited replay guarantee. No client strips the new contract or falls back to the unsafe old protocol.

New-client conflict/upgrade notices explicitly say Reload and review edits; pause says try later. They warn other settings may already have saved and advise keeping a copy before reloading. They do not say the entire Builder save changed nothing. Old cached clients cannot display copy introduced in new code: they may show their existing generic failure/support notice on `invalid`; they must reload to receive the new client. Deploy coordination and support messaging must account for that limitation. A new client against an old server remains blocked until the server migration is installed, even after reload.

If both responses to an issued request are lost, the outer retry replays the exact same arguments/request ID before executing another client guard. Further response loss remains uncertain; a later rename/archive cannot turn that uncertainty into a claim that nothing applied. This retained replay closure is scoped to the current save invocation. Reload/manual new invocations review current state rather than promising durable client-side request retention.

## Simpler compatibility option evaluated

An unconditional active-goal check and matching inserted child IDs to the locked goal would accept more old clients and protect those particular writes. It cannot compare original metadata omitted by those clients, nor identify reassignment on a no-insert rebuild. Reconstructing all plan-dependent fields from the locked record changes planning semantics and broadens this fix. Therefore this preparation requires the complete expected-state contract and explicitly accepts the refresh requirement. The existing child-match trigger remains defense in depth; a trigger rejection is a rolled-back failed save, not evidence of child-record corruption.

## Rollback: two deliberately different artifacts

Neither artifact is auto-applied.

1. `supabase/rollbacks/apply_builder_rebuild_goal_guard_PAUSE.sql` is the safe operational pause. It replaces only the five-argument function; the wrapper delegates to it. It preserves owner-scoped committed replay and refuses all fresh rebuilds. It preserves data, commit logs, grants and the unslotted cleanup function. Resume by separately approving and reapplying the guarded migration.
2. `supabase/rollbacks/apply_builder_rebuild_goal_guard_RESTORE_KNOWN_RACE.sql` restores the exact previous five-argument definition. **This reintroduces the known race.** It is not the default response to rollout trouble and requires explicit approval, with Builder writes otherwise paused. It preserves existing data/logs and does not reverse the PR146 cleanup trigger. Old clients resume prior behavior; new clients remain fail-closed against its old expectation comparison.

Neither rollback undoes already committed family edits or removes schema/data. Any later rollback decision must review the actual deployed function to avoid overwriting intervening migrations.

## Local verification and limits

The native harness creates a fresh private PostgreSQL cluster, disables TCP, checks exact data-directory/database/user identity, uses a private Unix socket and clears connection/credential configuration. It loads a minimal synthetic schema, the repository trigger subset, the real child-match trigger and RPC migrations. Scoped synthetic rows only; dangerous unscoped fixture runners are not executed.

Coverage includes both overloads; late archive/completion/child/metadata/settings writes held behind real locks; reverse lock ordering; child-trigger rollback; old/new client combinations; missing keys; successful own metadata; ownership; committed replay after archive/rename; safe pause/resume; exact prior-definition restore and reproduction of its race; guard reapplication. Client tests execute actual extracted commit, assertion and notice closures plus the real retry helper, including lost responses followed by rename/archive.

This is not a complete hosted-schema, PostgREST/authentication or two-browser end-to-end certification. Whole-Builder atomicity, vacation-table concurrency, historical disappearing lessons and final-row SQL validation remain outside the guarantee. Phase-one metadata and other curricula can commit independently. No shared staging/production application, push, merge or release is authorized by this document.
