# Bounded completion and catch-up follow-up

Normal completion, catch-up and protected bulk completion no longer fail on a legacy direct tail write. This follow-up addresses the local compatibility gates from cbf46d530ac630d47cc8a1e877dafac69c0fa5d2. No hosted action or customer repair occurred.

## Implementation

`resyncGoalForParent` routes protected goals to a fixed server-derived projection. Its full snapshot, profile/local day, completion counts, vacations and row memberships are checked under locks. It supports reserved sparse slots, unslotted capacity, pins, preservation, skips and pace overrides. It never accepts arbitrary caller dates. Explicit dates and recorded content remain intact. Lost replies retain the original operation until a receipt resolves it.

Missing catch-up records use the fixed history endpoint while preserving offered today/planned/picked semantics. Existing completed work is not rewritten; pending insertion/completion receipts resolve before fresh lookups. Plan bulk completion applies up to 100 selected lessons plus their tail in one transaction per goal. Silent trigger suppression and stale local days refuse atomically. Receipt Undo restores the exact prior schedule if no later work changed; it does not reinterpret Undo as reopen.

Today and Plan expose explicit completion/bulk retry actions. A failed separate tail refresh has a dashboard **Refresh upcoming lessons** action, retaining the original pending request without repeating completion. Successful recovery reloads Plan lessons/pins/goals and Today data. Containment-specific failures use clear review/reload copy rather than raw scheduler codes.

## Verification

| Gate | Result |
| --- | --- |
| Aggregate | 2,295 passed, 8 existing skips, 0 failures; exact-commit rerun recorded with final build evidence |
| TypeScript / selected changed-code lint | Pass; broader inherited lint remains outside a clean-lint claim |
| Server/client projection parity | 262/262 scenarios: sparse/unslotted reservations, done-unslotted holds, pin/preserve/skip, overrides including zero, vacations, future starts and day windows |
| New recovery API | 6 real Colima scenarios including actual catch-up helper after lost insert and completion replies |
| New bulk API | 8 checks: exact Undo, work/prefix preservation, two lost replies, silent suppression rollback, later note, stale day, calendar-table contention and cleanup |
| Original containment regression | 25 checks pass again after integrated changes |
| Browser | Nine final phases pass, zero final HTTP/page errors: actual sign-in, selected-and-following shift+prefix preservation/reload, normal completion+tail, historical catch-up, explicit completion retry, bulk+exact Undo, unknown-outcome reload, Today tail recovery, Plan tail recovery with observed data refetch |
| Realistic local contention | Two 500-row courses succeed concurrently (~161/~152ms); same-course race returns applied/busy; table conflict and last-row lock refuse in ~29ms; partial locks released while refusing transaction remains open. All 1,000 row contents and pin/preserved rows retained |
| Retention | Earlier 8 bounded/lock tests plus operator rehearsal: exit 2 signals remaining backlog; next bounded run drains it; compact proof retained; synthetic receipts cleaned. No hosted schedule installed |
| Full installation | Final assembled migration installs in empty isolated Colima; deliberate drift refuses with no partial objects. Tested runtime matches 44 function bodies/security/search-path/ACLs and 4 private table RLS/ACLs |
| Cleanup | No synthetic protected cohorts/capabilities remain. Browser owner and every owned row removed; test server closed |

Browser evidence was collected incrementally against the working tree later committed, using real local Auth/PostgREST. It was not an exact-commit production-server browser run. Two harness attempts were corrected: one asynchronous receipt wait and one accessible-name locator. Their original outputs remain recorded; all final phases pass. Existing twelve-table extension definitions were already installed from screened metadata and catalog-verified artifacts; no permissive browser stubs were invented in this follow-up.

Exact-commit production build is performed after committing this source, with results under `synthetic-runtime/exact-build-<SHA>/`. Its qualifications remain test-font CSS, existing copied dependencies/no clean registry install, skipped hosted identity preflight, and OS-enforced external-egress denial. No hosted deployment or load-test SLA is implied by the local results.

## Remaining decisions and release path

This validates the bounded scheduling flows above. It does not convert every legacy Add/Edit placement, lifecycle deletion, old Today move variant or settings field; see the current `REMAINING-WRITER-INVENTORY.md` for explicit unavailable actions and recovery. Supporting those additional surfaces requires separate bounded implementation or an explicitly accepted protected-cohort support policy. Single completion then refresh and multi-course work remain separately committed operations with visible partial results; only per-goal bulk is one atomic transaction.

A full reload restores authoritative data but does not persist the client's in-memory pending request token. Calendar-wide table locks can still refuse unrelated-family work; the local 500-row test is meaningful contention evidence, not internet-scale throughput certification. Inherited cascade receipt storage is outside the new action/calendar scrubber.

Before any hosted activation, approve the supported-action scope and a privileged maintenance cadence/monitoring owner. The checked-in local operator runner rehearses bounded batches, latency and backlog signaling only; it cannot connect to a hosted target and installs no scheduler. New payloads expire for Undo after 10 minutes; physical scrubbing depends on the approved cadence and backlog. Never drop replay proofs or disable protection to resume an old writer.

Next external steps require separate authorization: verify fresh target identity/schema/ledger, use a genuinely isolated synthetic deployment instead of PR146's shared staging, install reviewed dependency-ordered migrations, then validate and approve exact cohort activation. Publishing a branch/PR may itself trigger Preview and credentialed smoke actions. Customer-record repair remains a separate exact-before/expected-after plan and approval.
