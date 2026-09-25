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
  // Both name each lesson through the one formatter, in the curriculum's own
  // words ("Lesson 3", or "Week 1.3" for a curriculum that counts in weeks).
  assert.match(read("app/components/PlanV2/MissedLessonsBanner.tsx"), /formatLessonLabel\(e\.lesson_number, unitFor\(e\.goal_id\)\)/);
  assert.match(modal, /formatLessonLabel\(e\.lesson_number, unitFor\(g\.id\)\)/);
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

test("a kept lesson whose curriculum is gone shows its saved title, never 'Lesson · Lesson 12'", () => {
  // No subject, no live curriculum, removal not established.
  assert.equal(
    lessonRowTitle({ lessonNumber: 12, title: "Happy Cheetah — Lesson 12", subject: null, curriculumName: null, completed: true }),
    "Happy Cheetah — Lesson 12",
  );
  // No saved title either: an honest fallback, never the word "Lesson" twice.
  assert.equal(lessonRowTitle({ lessonNumber: 12, title: "  ", subject: null, curriculumName: null, completed: true }), "Completed lesson 12");
  assert.equal(lessonRowTitle({ lessonNumber: null, title: null, subject: null, curriculumName: null, completed: true }), "Completed lesson");
});

test("a removed curriculum is named only when the caller has established it, and never as a subject", () => {
  assert.equal(
    lessonRowTitle({ lessonNumber: 12, title: "Happy Cheetah — Lesson 12", subject: null, curriculumName: null, removedCurriculum: "Happy Cheetah", completed: true }),
    "Happy Cheetah (removed curriculum) · Lesson 12",
  );
  // The family's own subject still wins: "Math · Lesson 12".
  assert.equal(
    lessonRowTitle({ lessonNumber: 12, title: "Happy Cheetah — Lesson 12", subject: "Math", curriculumName: null, removedCurriculum: "Happy Cheetah" }),
    "Math · Lesson 12",
  );
  // A live curriculum is unchanged.
  assert.equal(
    lessonRowTitle({ lessonNumber: 3, title: "X — Lesson 3", subject: null, curriculumName: "Happy Cheetah" }),
    "Happy Cheetah · Lesson 3",
  );
});

test("Plan passes the established-removal name, not a title prefix, to the title helper", () => {
  const week = readFileSync(resolve(import.meta.dirname, "WeekListView.tsx"), "utf8");
  assert.match(week, /removedCurriculum: removedCurriculumName\(l, removal\)/);
  const card = readFileSync(resolve(import.meta.dirname, "..", "TodayLessonCard.tsx"), "utf8");
  assert.match(card, /removedCurriculum: lesson\.removed_curriculum_name \?\? null/);
  const plan = readFileSync(resolve(import.meta.dirname, "index.tsx"), "utf8");
  assert.match(plan, /removed_curriculum_name: removedCurriculumName\(l, removal\)/);
  assert.match(plan, /from\("app_events"\)\.select\("payload"\)\.eq\("user_id", effectiveUserId\)\.eq\("type", "curriculum_goal\.deleted"\)/);
});

test("a curriculum's unit wording leads the row, and the default is unchanged", async () => {
  const { lessonUnitFromGoal } = await import("../../../lib/lesson-label.ts");
  const unit = lessonUnitFromGoal({ lesson_unit_label: "week", lessons_per_unit: 4 });
  const base = { lessonNumber: 47, title: "Math with Confidence — Lesson 47", subject: "Math", curriculumName: "Math with Confidence" };
  assert.equal(lessonRowTitle({ ...base, unit }), "Math · Week 12.3");
  assert.equal(lessonRowTitle({ ...base, unit: null }), "Math · Lesson 47");
  assert.equal(lessonRowTitle(base), "Math · Lesson 47");
  assert.equal(lessonRowSubtitle({ ...base, unit }), "Math with Confidence");
});
