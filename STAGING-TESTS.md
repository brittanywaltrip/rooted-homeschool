# Browser-level staging tests — required before the revoke

Run against **rooted-staging** with synthetic data, in a real browser. Each has
a stated observation; "it seemed fine" is not one of them.

## 1. Ordinary builder saves

- [ ] Plain save of one curriculum. Lessons land; the schedule looks right.
- [ ] **Shortened curriculum**: reduce `total_lessons` below existing rows.
      Rows past the ceiling go; rows past it that hold **notes, minutes or
      hours** are *unscheduled and kept*, and their text is still there.
- [ ] **Pins**: a pinned row past the ceiling IS removed (a pin says where a
      lesson sits, not that it still exists); a pinned row inside the ceiling
      keeps its day.
- [ ] **Skips**: a skipped row is never re-dated.
- [ ] **Continuations**: a lesson continuing from another saves without
      silently removing its partner.
- [ ] Sibling curricula the save did not touch are **not** re-spread.

## 2. Injected insert failure

Force a failure inside the commit (e.g. temporarily add a conflicting row).

- [ ] The save fails with a clear message.
- [ ] Lessons, **goal fields, and the pointer** are all unchanged — check
      `current_lesson` explicitly; it was the one that used to move.
- [ ] The UI reflects the unchanged state after a reload.

## 3. Lost response after a commit

Commit, then drop the response (devtools offline, or kill the tab mid-request).

- [ ] The parent is told we **couldn't confirm**, not that nothing changed.
- [ ] Reconciliation with the same key finds the committed save.
- [ ] The replay reports a **nonzero** insert count and the builder does **not**
      throw its count assertion.

## 4. Two-session concurrency, during the RPC

Two browsers, same account.

- [ ] B edits a lesson **title** while A's save is in flight: A either commits
      with B's edit intact, or refuses. B's words are never lost.
- [ ] Same for **hours**.
- [ ] Same for a **pin** and a **skip**.

## 5. Oversized input

- [ ] A save exceeding 5000 inserted rows is refused, with **zero** product-data
      change.

## 6. Every user-facing delete flow

- [ ] Single lesson from Plan and from Today.
- [ ] Bulk delete from Plan.
- [ ] "Stop this curriculum": pending rows go, **completed history stays**.
- [ ] "Add a past year" undo.
- [ ] For each: force a failure and confirm the optimistically removed row
      **comes back** and a message appears. No vanish-and-reappear.

## 7. After the revoke — an old bundle

Load the builder, apply the revoke, then act in the **already-open** tab.

- [ ] Its direct delete is refused and **nothing is destroyed**.
- [ ] A current tab continues to work normally.
- [ ] Confirm the wording an old tab shows, and whether reload recovers it, for
      each flow in §6. Do not assume reload fixes all of them.
