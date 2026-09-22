import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lessonRowSubtitle, lessonRowTitle } from "./lessonTitle.ts";

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

test("the week rows title through lessonRowTitle; the missed banner labels curricula as the prompt does", () => {
  const read = (f: string) => readFileSync(resolve(import.meta.dirname, "..", "..", "..", f), "utf8");
  assert.match(read("app/components/PlanV2/WeekListView.tsx"), /lessonRowTitle\(/);
  // The banner lists the same lessons Today's prompt asks about, grouped the
  // way the prompt groups them: "Maya · Math", then "Lesson 3".
  const plan = read("app/components/PlanV2/index.tsx");
  const modal = read("app/components/MissedLessonRecoveryModal.tsx");
  assert.match(plan, /g\.child_name \? `\$\{g\.child_name\} · \$\{subject\}` : subject/);
  assert.match(modal, /g\.child_name \? `\$\{g\.child_name\} · \$\{subject\}` : subject/);
  assert.match(read("app/components/PlanV2/MissedLessonsBanner.tsx"), /Lesson \{e\.lesson_number\}/);
});

test("the muted line says what the title does not: the curriculum under a numbered lesson", () => {
  const numbered = { lessonNumber: 44, title: "The Good and the Beautiful Math 3 — Lesson 44", subject: "Math", curriculumName: "The Good and the Beautiful Math 3" };
  assert.equal(lessonRowTitle(numbered), "Math · Lesson 44");
  assert.equal(lessonRowSubtitle(numbered), "The Good and the Beautiful Math 3");
  // A one-off keeps its title and shows its subject beneath.
  assert.equal(lessonRowSubtitle({ lessonNumber: null, title: "Nature walk", subject: "Science", curriculumName: null }), "Science");
  // Never a line that only repeats the title.
  assert.equal(lessonRowSubtitle({ lessonNumber: null, title: " ", subject: "Science", curriculumName: null }), null);
  assert.equal(lessonRowSubtitle({ lessonNumber: 3, title: null, subject: null, curriculumName: "Happy Cheetah" }), null);
});

test("Today's Upcoming and Past cards and the day panel's lesson card use the same title", () => {
  for (const f of ["app/components/today/InlineScheduleTabs.tsx", "app/components/TodayLessonCard.tsx"]) {
    const src = readFileSync(resolve(import.meta.dirname, "..", "..", "..", f), "utf8");
    assert.match(src, /lessonRowTitle\(/, `${f} titles its lessons through lessonRowTitle`);
    assert.match(src, /lessonRowSubtitle\(/, `${f} takes its muted line from lessonRowSubtitle`);
    assert.doesNotMatch(src, /\{l\.title\}/, `${f} never renders the stored title raw`);
  }
});
