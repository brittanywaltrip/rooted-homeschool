import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lessonRowTitle } from "./lessonTitle.ts";

test("a curriculum lesson leads with its subject, never the stored curriculum title", () => {
  assert.equal(
    lessonRowTitle({ lessonNumber: 8, title: "The Good and the Beautiful — Lesson 8", subject: "Math", curriculumName: "The Good and the Beautiful" }),
    "Math · Lesson 8",
  );
  // No subject: the curriculum stands in, still without the dash.
  assert.equal(
    lessonRowTitle({ lessonNumber: 3, title: "Happy Cheetah — Lesson 3", subject: null, curriculumName: "Happy Cheetah" }),
    "Happy Cheetah · Lesson 3",
  );
});

test("a one-off lesson keeps its own title", () => {
  assert.equal(lessonRowTitle({ lessonNumber: null, title: "Field trip to the zoo", subject: null, curriculumName: null }), "Field trip to the zoo");
  assert.equal(lessonRowTitle({ lessonNumber: null, title: " ", subject: "Science", curriculumName: null }), "Science");
});

test("the missed-lessons banner and the week rows use the same title", () => {
  for (const f of ["app/components/PlanV2/MissedLessonsBanner.tsx", "app/components/PlanV2/WeekListView.tsx"]) {
    const src = readFileSync(resolve(import.meta.dirname, "..", "..", "..", f), "utf8");
    assert.match(src, /lessonRowTitle\(/, `${f} titles its rows through lessonRowTitle`);
  }
});
