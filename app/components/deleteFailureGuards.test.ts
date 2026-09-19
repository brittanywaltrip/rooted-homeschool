// A delete that has already left the screen must land, or come back and say so.
//
// WHY THIS IS A SOURCE GUARD AND NOT A COMPONENT TEST.
//
// The behaviour is temporal and lives in JSX and timers: an optimistic
// setLessons, a setTimeout five seconds later, a rejection, a restore, a
// rendered notice. Reproducing that needs a rendered component and a fake
// clock, and this repo has no React/DOM test tooling at all -- no
// @testing-library, no jsdom, no happy-dom, no vitest, no jest. See the note
// at the top of updaterPurity.test.ts for the same reasoning.
//
// These guards exist because an earlier round of tests reproduced a SIMPLIFIED
// copy of the logic in the test file and asserted on that. They passed while
// the real component never rendered its failure message at all, and while a
// second bulk-delete timer still swallowed its error in silence. A test that
// re-implements the thing it is testing proves nothing. Every assertion below
// reads the shipped file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TODAY = "app/dashboard/page.tsx";
const PLAN = "app/components/PlanV2/index.tsx";

/** The body of the arrow/function that a marker sits inside, roughly. */
function windowAfter(src: string, marker: string, chars = 900): string {
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, `marker not found: ${marker}`);
  return src.slice(i, i + chars);
}

test("Today RENDERS its delete-failure message, it does not merely store one", () => {
  const src = repo(TODAY);
  assert.match(src, /const \[deleteFailedMsg,\s*setDeleteFailedMsg\]/,
    "the state exists");
  // The bug this catches: the state was created and populated, and no JSX ever
  // displayed it, so the parent saw nothing at all.
  assert.match(src, /\{deleteFailedMsg && \(/,
    "deleteFailedMsg must be rendered, not only assigned");
  assert.match(src, /\{deleteFailedMsg\}/,
    "and the message itself must appear in the markup");
  const render = windowAfter(src, "{deleteFailedMsg && (", 500);
  assert.match(render, /role="status"/,
    "announced to a screen reader rather than only drawn");
});

test("Today's deferred delete catches its own rejection and restores the row", () => {
  const src = repo(TODAY);
  // setTimeout DISCARDS the promise an async callback returns, so a rejection
  // inside one is unhandled and the row silently stays deleted on screen.
  assert.ok(!/setTimeout\(async \(\) => \{[\s\S]{0,400}deleteLessonById/.test(src),
    "the delete timer must not be an async callback");
  const timer = windowAfter(src, "pendingDeleteTimer.current = setTimeout(", 700);
  assert.match(timer, /void deleteLessonById\(/, "started with void, not awaited into nothing");
  assert.match(timer, /\.catch\(/, "the chain carries its own catch");
  assert.match(timer, /restoreFailedDelete\(/, "and the failure restores the row");
  const restore = windowAfter(src, "function restoreFailedDelete(", 600);
  assert.match(restore, /restoreRemovedRow\(/, "the row goes back into the list");
  assert.match(restore, /setDeleteFailedMsg\(/, "and a message is set");
});

test("Today's commit-the-previous-delete path is also guarded", () => {
  const src = repo(TODAY);
  const w = windowAfter(src, "if (pendingDelete && pendingDeleteTimer.current) {", 700);
  assert.match(w, /try \{/, "it awaits inside a try");
  assert.match(w, /restoreFailedDelete\(/, "and restores on failure");
});

test("BOTH Plan deferred bulk-delete USER paths restore every row and speak", () => {
  const src = repo(PLAN);

  // Path 1: the 5-second undo window on a bulk delete.
  assert.ok(!/setTimeout\(async \(\) => \{[\s\S]{0,300}deleteLessonsByIds/.test(src),
    "the bulk-delete timer must not be an async callback");
  // There are two `const timer = window.setTimeout(` in this file; anchor on
  // the one that owns the bulk delete, not merely the first.
  const timer = windowAfter(src, "pendingBulkDeleteRef.current = null;\n      void deleteLessonsByIds(", 900);
  assert.match(timer, /void deleteLessonsByIds\(/);
  assert.match(timer, /\.catch\(/, "its own catch");
  assert.match(timer, /rows\.reduce\(\(acc, r\) => restoreRemovedRow\(acc, r\), prev\)/,
    "EVERY removed row goes back, not just the first");
  assert.match(timer, /flashNotice\(/, "and the parent is told");
  assert.ok(!/silent — next reload reconciles/.test(src),
    "the old silent comment is gone with the behaviour it described");

  // Path 2: commitPendingBulkDelete, called from a user action and from unmount.
  const commit = windowAfter(src, "const commitPendingBulkDelete = useCallback(", 1200);
  assert.match(commit, /reason: "user" \| "teardown"/,
    "one function, two obligations, so it must know which it is");
  assert.match(commit, /rows\.reduce\(\(acc, r\) => restoreRemovedRow\(acc, r\), prev\)/);
  assert.match(commit, /flashNotice\(/);
  assert.match(commit, /if \(reason === "teardown"\)/,
    "teardown returns before the restore");
});

test("teardown stays logging-only: nothing to restore, nothing to say", () => {
  const src = repo(PLAN);
  const commit = windowAfter(src, "const commitPendingBulkDelete = useCallback(", 1200);
  const teardown = windowAfter(commit, 'if (reason === "teardown")', 300);
  assert.match(teardown, /console\.warn\(/, "the failure is observable");
  assert.ok(!/flashNotice\(/.test(teardown),
    "but nothing is flashed at a component that is going away");
  // The unmount effect is a separate, also-quiet path.
  const unmount = windowAfter(src, "// Capture the timer/rows at unmount time", 600);
  assert.match(unmount, /void deleteLessonsByIds\([\s\S]{0,200}\.catch\(/,
    "fire and forget, but with a catch so nothing is unhandled");
  assert.match(unmount, /console\.warn\(/);
});

test("no delete anywhere is started from an async setTimeout callback", () => {
  // One assertion for the whole class: it is the shape that turns a rejection
  // into an unhandled one.
  for (const f of [TODAY, PLAN]) {
    const src = repo(f);
    for (const m of src.matchAll(/setTimeout\(\s*async/g)) {
      const after = src.slice(m.index ?? 0, (m.index ?? 0) + 600);
      assert.ok(!/deleteLesson(ById|sByIds)\(/.test(after),
        `${f}: a delete is started inside an async setTimeout callback`);
    }
  }
});
