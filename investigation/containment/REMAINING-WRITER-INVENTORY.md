# Current writer coverage and remaining scope

The completion/catch-up blockers from the initial containment audit are corrected in this follow-up. A protected goal is not a claim that every legacy editing surface has been converted.

| Path | Current protected behavior | Remaining scope |
| --- | --- | --- |
| Normal completion/uncompletion → parent tail refresh | Fixed server-derived projection preserves explicit placements and work. Each step reports its result; failed refresh has its own retry control, without repeating completion. | Two transactions for a single completion and refresh, not one atomic composite. UI preserves confirmed work and resolves unknown outcomes. |
| Catch-up Yes/No and missing historical row | Fixed recovery insert preserves the offered today/planned/picked semantics; existing completed work is not overwritten; original receipts resolve before lookup. Parent tail refresh is supported. | Multiple historical completions can independently succeed/fail; counts and recovery remain explicit. |
| Plan bulk completion and Undo | One atomic completion+projection transaction per protected goal; exact receipt Undo restores scheduling only if full afterstate is unchanged. | Maximum 100 lessons per goal; different goals are independently atomic. No silent chunking. |
| Ordinary notes/time/title edits | Owner-scoped edits remain available and make conflicting Undo stale. | Legacy error-only edit checks do not guarantee affected-row counts in every app surface. |
| Single move, skip/unskip, continuation, history/healing, recalibration, calendar | Reviewed fixed RPCs and their documented expected-state/receipt contracts. | Recalibration has deliberate shape/work restrictions; calendar has global membership-lock contention. See their contracts. |
| Plan Add/Edit placement and extra direct batch logging | Direct protected inserts/placement writes refuse; human-readable message keeps the modal/work review visible. Content-only edits remain available. | These are explicitly unavailable protected operations, not converted writers. Additional fixed contracts are outside this bounded completion/catch-up follow-up. |
| Plan stop/delete curriculum and bulk deletion | Preflight refusal occurs before optimistic or auxiliary metadata changes; resolved errors are checked; deferred failures prompt review. | Protected lifecycle deletion/retirement is unavailable. Do not disable the guard to permit it. |
| Today legacy move/push/double-up and Undo | All targeted goals are checked before first write; protected actions refuse with recovery guidance. | Use the supported Plan move/shift path. These older composite variants remain unavailable for protected goals. |
| Builder scheduling/settings | Existing atomic Builder endpoints remain wrapped and reviewed. Metadata can save separately. | Archive/type change, timezone/profile school days and separate lesson-wording changes can refuse. Do not claim all settings form fields are atomically supported. |

## Recovery and visibility

Today exposes **Check saved completion** for an ambiguous completion; Plan exposes **Check result** for unresolved bulk groups. Both retain the original request while the client remains alive. Protected tail-refresh failure exposes **Refresh upcoming lessons** in the dashboard layout. This retries the original pending respread and refreshes Today or Plan data after success. It never toggles completed work again. Plan's dedicated recovery listener reloads lessons, pins and goal settings. Containment-specific database messages are mapped to understandable review/reload guidance; other errors remain distinct.

A full page reload does not persist the in-memory request token. Browser tests verify authoritative saved state after a lost completion response and reload, without replaying completion or inventing a new receipt. This is not durable cross-reload request-storage certification.

Normal completion/catch-up and per-goal bulk completion are locally verified. Broader editing/lifecycle parity would require additional implementation or an explicitly accepted protected-cohort support policy. This inventory identifies those unavailable actions; it does not claim a whole-application compatibility certification or authorize activation.
