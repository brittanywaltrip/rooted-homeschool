# Narrow history, healing and continuation writers

`commit_scheduler_history_heal` accepts four fixed intents. It does not accept row patches, client-supplied ownership, titles, minutes, notes or capability flags. It locks the owned goal, all existing rows, profile and calendar before comparing the full schedule snapshot, then derives exact insert shapes from the locked goal/root. Only authenticated owners can execute it. A private receipt resolves ambiguous retries; an operation UUID cannot be reused for another request.

- `history_insert`: insert one missing queue slot on a parent-selected historical date, with the shared picked-completion shape and noon UTC for a past day. Existing historical rows go through `completeLessonOnDate` with `onlyIfIncomplete`, never this insert. A postcondition preserves every preexisting row carrying work, manual pins or preservation markers.
- `heal_next`: insert the next non-skipped slot only, when other rows exist and no later completed slot makes it historical. The database verifies the resulting projection; a wrong proposed date rolls the whole insert back.
- `heal_empty`: rebuild only an old, exactly empty goal. Every slot after the current pointer through the configured end must occur exactly once and pass projection validation. More than 3,650 slots, unsupported projection shapes or inconsistent existing data refuse without partial recovery.
- `continue`: resolve the original root within the same owner and goal, create one unslotted unfinished continuation from its metadata, and prove the entire preexisting schedule stayed identical. Existing pending continuation rows prevent duplicate inserts. The Plan client handles moving an existing continuation separately.

`undo_scheduler_continuation` deletes only the exact untouched created row, within ten minutes, after checking the complete expected-after state. New notes, time, completion, schedule/calendar edits or an expired receipt refuse Undo. There is no general delete or arbitrary insert capability.

The public history helper resumes a pending insert receipt **before** reading an existing slot. Otherwise an insert that committed before a lost response could become a second completion on retry. The real-client bridge checks identical UUID/preimage, unchanged completion timestamps and exactly one completion event. After a browser restart, an already-completed row refuses another catch-up completion rather than guessing the earlier operation outcome.

Tests use the isolated Colima loopback backend and disposable synthetic goals. `history-healing-postgrest.py` reads only the task's local synthetic credential file; it never prints credentials and cleans only its own fixture IDs. Two bridges exercise actual TypeScript helpers through PostgREST with deliberately lost responses. Run these after installing the reviewed containment and recovery functions locally. External network access, hosted installation and activation are not part of these tests.

No protected insert path falls back to a direct insert after RPC failure. Legacy mode retains the prior paths. Auto-healing still uses its existing failed/zero return contract; it has not acquired interactive refusal UI. The calendar/Builder/Plan owners provide user-facing refusal handling for their own operations.

Receipt maintenance must scrub the continuation result's full row after the ten-minute Undo window while retaining an operation tombstone and insertion identity for replay. This module does not schedule or grant a maintenance job. The shared release retention/pause policy owns that step.
