# Additional field plan — review only, no customer execution

The approved narrow historical repair and the candidate's future scheduling representation are separate decisions. Customer inventory is unavailable locally. No customer row IDs, selected positions, historical pins or counts can be inferred from this synthetic exercise.

| Row scope | Field-level proposal | Existing column or schema requirement |
|---|---|---|
| Earlier unfinished, non-skipped, non-backfill, non-continuation dated queue rows before the confirmed selection | `queue_preserved: false -> true` only where not already preserved. Keep both dates, queue position, existing pin/source, notes and minutes unchanged. No completion or skip. | New proposed `lessons.queue_preserved boolean NOT NULL DEFAULT false`; schema installation is a separate release decision. |
| Selected lesson | Existing `queue_pinned` must be true on the intended target date. If already true, no pin change is needed; otherwise record the new placement decision explicitly. `queue_preserved` becomes false if it was previously preserved. | `queue_pinned`, `date`, `scheduled_date` already exist; preservation column is new. |
| Selected lesson during a new cascade action | Both dates become its confirmed target; `scheduled_source='plan_move'`. | Existing fields. Historical repair provenance must be explicitly chosen, not mislabeled as a new parent action. |
| Following eligible queue rows | Both dates follow the confirmed teaching-session offset; retain each existing pin rather than pinning the whole tail; `queue_preserved=false`. A new cascade sets `scheduled_source='plan_cascade_shift'`. | Existing date/pin/source columns; new preservation column. |
| Queue inversion corrections, if separately approved | Change only the exact named `queue_position` fields using collision-safe transactional ordering. | Existing column and immediate uniqueness constraint. The normal cascade refuses a reordered queue; it does not silently normalize it. |
| Protected rows and fields | Completed/skipped/backfill/continuation rows remain outside cascade writes. No repair-generated completion, pointer, lesson number, title, notes, minutes or ownership changes. | Existing fields. |
| Transaction side effects | Disclose affected rows' `updated_at`, retained date-audit rows and candidate operation receipt. Reversal adds audit history and does not restore old timestamps. | Existing timestamp/audit machinery; proposed receipt table and RPCs. |

The exact combined customer plan must contain full expected before-images and explicit after-values for every changed field, exact row membership/cardinality, owner/course scope and preserved-prefix membership. The selected anchor might already exist; only fresh authorized inventory can settle that. No pin is reconstructed from a guess about history. A new marker is a current scheduling decision, not proof of a historical pin.

The illustrative artifact `synthetic-runtime/synthetic-additional-fields.json` names six extra decisions in the invented fixture: four prefix markers and two selected pins, choosing slot 3 in each course. Its first two rows per course are earlier work. This differs from any parent-supplied customer counts and must not be substituted for that manifest.

Schema dependencies requiring a separately reviewed migration/release plan:

1. Add preservation column; install private receipt table, exact snapshot/window/projection validators and owner-scoped read/commit/Undo RPCs from the proposal.
2. Replace cleanup so pointer advancement excludes preserved work, retaining PR146's unslotted protection; install the preserved-work guard.
3. Install the preservation-aware daily RPC and its prerequisite switch/log schema if absent. Verify actual target catalog; the bounded local slice cannot establish remote dependency presence.
4. Include the reviewed NOWAIT correction in shift, Undo and daily RPC definitions. No data rewrite belongs in these schema migrations.
5. Order against PR146 Builder definitions and cleanup changes; complete the explicit preserved-work release UX and older-client strategy before activation.

The local proposal files are not migration-ledger entries. Nothing here authorizes creating remote migration history, applying SQL remotely, or repairing customer records.
