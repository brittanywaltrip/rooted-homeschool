// A tap that cannot proceed has to say why, on the phone, where the thumb is.
//
// WHY THESE ARE SOURCE CHECKS.
//
// The behaviour is "the family can tell the tap registered", which lives
// entirely in rendered DOM and in what happens on the frame after a press.
// This repo has no React or DOM test tooling at all, so there is nothing to
// mount and nothing to press. Extracting the logic into a pure function would
// not help either: the mistake being guarded against is not arithmetic, it is
// a primary button quietly gaining a second `disabled` condition, or a new
// validation branch that returns without moving the family to the field it is
// complaining about. Both of those live at the call site.
//
// So this sweeps the two files instead, the same approach as
// lib/memory-insert-guard.test.ts and app/components/updaterPurity.test.ts.
//
// THE RULES:
//   1. No primary button in onboarding or the Schedule Builder is disabled for
//      any reason other than a save already being in flight.
//   2. A validation branch that sets an error also moves the family to the
//      first thing that needs fixing.
//   3. The message that explains a blocked tap is announced, which means it
//      enters the document at the moment of the tap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ONBOARDING = "app/onboarding/page.tsx";
const BUILDER = "app/dashboard/plan/schedule/page.tsx";

/** Strip comments so prose about a rule cannot satisfy the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// ── Onboarding ─────────────────────────────────────────────────────────────

test("onboarding renders its blocked reason as an alert", () => {
  const src = stripComments(read(ONBOARDING));
  assert.match(src, /function StepError\(/, "StepError is gone");
  assert.match(
    src,
    /role="alert"/,
    "the step error must announce itself, not just appear",
  );
  // Every step routes through the one component. A step that hand-rolls its
  // own <p> gets a silent message again.
  assert.doesNotMatch(
    src,
    /\{error && <p /,
    "a step is rendering its error inline instead of through StepError",
  );
  const uses = src.match(/<StepError message=\{error\} \/>/g) ?? [];
  assert.equal(uses.length, 4, `expected 4 steps to render StepError, found ${uses.length}`);
});

test("no onboarding Continue is disabled for anything but saving", () => {
  const src = stripComments(read(ONBOARDING));
  // The About step used to be disabled until both questions were answered,
  // which on a phone is a tap that produces nothing at all.
  assert.doesNotMatch(
    src,
    /canContinue/,
    "a step is gating its Continue on a computed condition again",
  );
  for (const m of src.matchAll(/disabled=\{([^}]*)\}/g)) {
    const condition = m[1].trim();
    assert.equal(
      condition,
      "saving",
      `a button in onboarding is disabled by \`${condition}\`, not just by a save in flight`,
    );
  }
});

test("every onboarding validation moves the family to what needs fixing", () => {
  const src = stripComments(read(ONBOARDING));
  let branches = 0;
  for (const m of src.matchAll(/setError\("([^"]+)"\)/g)) {
    const message = m[1];
    // Blank clears, and network failures have no field to point at.
    if (message === "") continue;
    if (/Something went wrong/.test(message)) continue;
    branches += 1;
    const branch = src.slice(m.index, m.index + 220);
    assert.match(
      branch,
      /focusFirstInvalid\(/,
      `"${message}" is set without moving the family to the field it means`,
    );
  }
  assert.ok(branches >= 5, `expected at least 5 validation branches, found ${branches}`);
});

test("focusFirstInvalid both scrolls and focuses", () => {
  const src = stripComments(read(ONBOARDING));
  const body = src.slice(src.indexOf("function focusFirstInvalid("));
  assert.match(body.slice(0, 700), /scrollIntoView\(/);
  assert.match(body.slice(0, 700), /\.focus\(\{ preventScroll: true \}\)/);
});

test("an empty school-year date looks empty on iPhone", () => {
  const src = read(ONBOARDING);
  assert.match(src, /function DateField\(/, "DateField is gone");
  assert.match(src, /Pick a date/, "the empty state label is gone");
  // A bare <input type="date"> is what reads as already filled in on iOS.
  const stripped = stripComments(src);
  const bare = stripped.match(/<input\s+[^>]*type="date"/g) ?? [];
  assert.equal(
    bare.length,
    1,
    "the only <input type=\"date\"> in onboarding should be the one inside DateField",
  );
  // Both dates on the school-year step go through it.
  assert.match(stripped, /<DateField id="onb-start-date"/);
  assert.match(stripped, /<DateField id="onb-end-date"/);
});

// ── Schedule Builder ───────────────────────────────────────────────────────

test("a blocked Preview schedule tap is heard", () => {
  const src = stripComments(read(BUILDER));
  // A disabled control dispatches no pointer events, and the event does not
  // reach an ancestor either, so the button has to stop swallowing the tap.
  assert.match(
    src,
    /disabled:pointer-events-none/,
    "the disabled Preview button is swallowing its own taps again",
  );
  assert.match(src, /onClick=\{handleBlockedPreviewTap\}/);
  assert.match(src, /function handleBlockedPreviewTap\(/);
});

test("a blocked tap announces the reason and points at the row", () => {
  const src = stripComments(read(BUILDER));
  const body = src.slice(
    src.indexOf("function handleBlockedPreviewTap("),
    src.indexOf("function handleBlockedPreviewTap(") + 900,
  );
  assert.match(body, /previewBlockedReason/, "the existing reason text is what should be shown");
  assert.match(body, /!rowIsValid\(r\)/, "it must find the first incomplete row");
  assert.match(body, /revealRow\(/, "it must scroll to that row");

  // role="alert" only announces on a node that has just entered the document,
  // which is why the hint and the alert are different element types.
  assert.match(src, /previewNudge \? \(\s*<div\s+id="preview-blocked-reason"\s+role="alert"/);
  assert.match(src, /<p\s+id="preview-blocked-reason"/);
});

test("adding a row scrolls to it and opens the keyboard on its name", () => {
  const src = stripComments(read(BUILDER));
  const addRow = src.slice(src.indexOf("function addRow("), src.indexOf("function deleteRow("));
  assert.match(
    addRow,
    /revealRow\(row\.localId, \{ focus: true \}\)/,
    "a new row that lands below the fold produces no visible response",
  );
  // The row must build outside the updater or its localId is unknowable here,
  // and reading state inside an updater is banned anyway.
  assert.match(addRow, /const row = blankRow\(/);

  const reveal = src.slice(src.indexOf("function revealRow("), src.indexOf("function rowIsValid("));
  assert.match(reveal, /\[data-local-id="\$\{localId\}"\]/);
  assert.match(reveal, /\[data-row-first-input\]/);
  assert.match(reveal, /scrollIntoView\(/);
  assert.match(reveal, /\.focus\(\{ preventScroll: true \}\)/);

  // The two handles revealRow needs have to exist on the rendered row.
  assert.match(src, /data-local-id=\{row\.localId\}/);
  assert.match(src, /data-row-first-input=""/);
});

test("the builder does not sit through Safari's double-tap wait", () => {
  const src = read(BUILDER);
  assert.match(src, /className="space-y-5 touch-manipulation"/);
});
