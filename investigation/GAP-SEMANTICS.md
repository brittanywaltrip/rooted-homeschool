# Cascade gap semantics — original analysis

> Superseded follow-up: do not ask the customer questions. See FOLLOWUP-HANDOFF.md for the browser reproduction, isolated candidate, and latest constraints.

The reviewed checkout `../rooted-kandl` remains frozen at **beb53fa9479dc63ed723a519637a6d7eafcf947d**. This checkout is `rooted-gap-analysis`, branch `investigate/cascade-gap-semantics`, based on that exact commit. Only this investigation document and a disposable in-memory characterization test are added. No production implementation is changed.

## Conclusion

The current cascade has a real mismatch between its confirmation and its write. For a one-session-per-week course with intentionally spaced lessons, “N later lessons shift by 1 school day” and a finish date calculated by moving the old finish one weekly session imply preserving that spacing. The code instead discards every pin except the trigger and rebuilds the incomplete queue consecutively. A success toast changes vocabulary to “re-spread” only after the write. That is not advance consent to compress gaps.

We do not need a customer decision to identify this contradiction or the earlier-row scope mismatch. We do need the family to say what her intended next dates are before interpreting already-overlapping records or deciding which blank weeks were deliberate. No account's desired schedule can be inferred from these synthetic tests.

## What each surface promises

| Surface | Before-action promise | Actual behavior |
| --- | --- | --- |
| Reschedule one curriculum lesson → cascade dialog | “What about the lessons after it?”; “Shift all remaining lessons forward”; “N later lessons shift by X school days”; explicitly named new finish date | Keep trigger slot, pin trigger date, unpin/reproject the entire goal's incomplete set from today |
| Cascade success toast | Appears only afterward | “Moved the lesson and re-spread the rest of [curriculum]” |
| Move just this lesson | “Only this lesson moves. Lessons after it stay on their dates.” | Separate keep-slot path with `holdBetween:true`; this is not a whole-tail remedy |
| Move planned work (manually planned one-offs) | “Their spacing follows your school days and skips breaks”; automatic curriculum scheduling stays as it is | `shiftManualPlan` shifts each original date by the same teaching-day offset; distinct no-goal rows |
| Schedule Builder | Editing a curriculum's pace/days is an explicit grid change | Documented intentional re-spread, with different pin-release rules |

References on the analysis branch:
- `app/components/PlanV2/index.tsx`: picker lines 6390–6466, callback around 4678–4828, dialog around 7580–7650, manual-plan dialog around 6540.
- `app/lib/scheduler.ts`: `schoolDayDelta` documents applying the same delta to every later incomplete lesson (around 1054); `reprojectGoalForParent` (814 onward) does not consume the delta at all.
- `docs/CURRICULUM-SCHEDULING.md`: Invariant 24 says the cascade lands the promised number of school days later; “Parent re-spreads” later explains clearing pins and forbids pinning the whole tail.

The code history explains the divergence: `414c1c1611355fc5344312e6d3f926f62f730dea` (August 19) switched cascade from hand-placed dates to re-projection to avoid frozen/invisible pins. The confirmation retained literal-shift language. September 24's keep-slot change fixed queue reordering, but did not change this gap behavior.

## Reproduction and coverage gap

Run `node --test investigation/cascade-gap-characterization.test.ts` in this checkout. Six tests pass, all invoking the real `reprojectGoalForParent` against disposable memory. They characterize current behavior; they deliberately are not placed in the normal app test glob or labeled as desired behavior.

1. Tuesday-only gap, later lessons pinned: after L1 moves Sep 22 → Sep 29, L2/L3 formerly Oct 13/20 move backward to Oct 6/13. The advertised shift instead implies Oct 20/27.
2. Same Tuesday gap without pins: same outcome. It is the stored spacing being ignored, not only pin release.
3. Sunday-only counterpart: after L1 moves Sep 20 → Sep 27, Oct 11/18 become Oct 4/11.
4. Regular Tuesday queue: correctly moves one weekly session. This is why the existing regular-grid tests pass.
5. Scope: an earlier unfinished pinned L1 on Sep 27 moves back to Sep 20 when later L2 is shifted Oct 4 → Oct 11. The preview counts dates strictly after the selected origin; the write selects every incomplete row of the goal.
6. Uneven capacity: a 2-on-Monday / 1-on-Thursday curriculum cannot move every Monday lesson one school day onto Thursday without exceeding the cap. The projector respects capacity but the literal same-delta promise cannot hold. Therefore naïvely shifting every stored date is not a safe universal implementation.

Existing `move-keep-slot.test.ts` asserts same-delta movement only on contiguous equal-capacity grids. `parent-respread.test.ts` explicitly tests pin release and fitting around the trigger; it never compares a gapped plan to the confirmation's implied dates. Both suites can be green while these contradictions remain.

## Smallest safe correction proposal

The smallest defensible immediate change is **preflight containment**, not a new date writer:

1. Before moving the trigger, read the complete, stable goal/lesson inputs and compute the exact proposed projection as if the keep-slot move had succeeded. Reuse the existing projector; do not create another day walker.
2. Build the advertised affected set and expected dates from the same snapshot, using the shared school-day offset helper. Compare every proposed changed row, not just the finish date. Earlier rows must remain unchanged; later rows must match what the dialog promised; skips/history/makeups must be accounted for explicitly; capacity and unchanged occupants must be checked.
3. If the proposed write cannot fulfill that promise, refuse before ANY mutation with a clear explanation. Do not move only the selected lesson and then discover the tail cannot follow. Example: “This shift would change the spacing of lessons already on your plan, so nothing moved.” A one-off “move only this lesson” remains a separate deliberate choice.
4. The preview and write must share the computed plan. At minimum revalidate inputs immediately before mutation and preserve existing failure handling; full concurrency/partial-write guarantees require an atomic checked commit, which the current two-stage cascade lacks. A preflight-only frontend change is containment, not a complete transaction guarantee.

This preserves regular weekly cases and stops known counterexamples without releasing or repinning more rows. It does not deliver the requested gapped shift; that limitation must be stated to the family. This proposal is not implemented in either checkout and is separate from the reviewed fallback patch.

## Full correction direction and decisions

A complete shift must preserve the dates the user consented to across Plan, Today, reload, completion and later auto-roll. Writing only date caches fails that test. Pinning every row also fails the documented auto-roll requirement. Clearing all pins is the present defect.

For **existing explicit manual pins**, shifting those anchor dates by the chosen offset while preserving earlier anchors and then projecting unpinned work around them is a plausible narrower design. It must be validated against the advertised whole-tail dates; it does not solve unpinned gaps, inherited collisions or uneven capacities. It needs atomic update/rollback of multiple anchors and trigger before it can safely ship. Do not treat it as an already-proven fix.

For **unpinned gaps**, product needs a durable representation of whether the gap is an intentional planning constraint or a stale cache. That cannot be inferred merely from the date. Preserving all stored spacing means recording new scheduling intent; compressing it means an explicit “rebuild from this lesson using my normal schedule” action with a genuine before/after preview and different copy. Renaming the existing button alone would abandon its current promise and Kandl's request.

The family question can stay concrete: “For [course], after moving lesson X from A to B, should the next lesson be on C, keeping the gap already on your plan, or on D, the next usual weekly session?” Supply C/D only after she identifies a real example. Ask separately if she means multiple subjects: this cascade is scoped to one curriculum goal.

No whole-account repair, schedule rewrite, automatic book-order restoration, production migration or deployment is justified by this analysis. Existing collisions require their own approved before/after reconstruction.

## Verification and handoff

- Six investigation cases passed, zero failures/skips.
- No app/SQL implementation changed in this branch.
- Frozen safeguard commit remains `beb53fa9479dc63ed723a519637a6d7eafcf947d` in `/Users/brittanywaltrip/Documents/Codex/2026-10-08/task-6/rooted-kandl`.
- Analysis checkout: `/Users/brittanywaltrip/Documents/Codex/2026-10-08/task-6/rooted-gap-analysis`.
- Evidence log: `../investigation-evidence/gap-characterization.txt`.
