// Every screen that shows a curriculum lesson's number shows it through
// lib/lesson-label.ts, so a curriculum that counts in weeks reads "Week 12.3"
// everywhere and a new screen cannot quietly print "Lesson 47" again.
//
// And the release rule: the two new columns are named only in the one
// fail-soft read (lib/lesson-units-context.tsx) and the builder's separate
// write. Naming them inside an existing lesson or curriculum select would make
// that whole query fail on a database without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const CONVERTED = [
  "app/components/today/TodaySchedule.tsx",
  "app/components/today/InlineScheduleTabs.tsx",
  "app/components/MissedLessonRecoveryModal.tsx",
  "app/components/PlanV2/MissedLessonsBanner.tsx",
  "app/components/PlanV2/DayDetailPanel.tsx",
  "app/components/PlanV2/LessonPill.tsx",
  "app/components/PlanV2/LessonSearchModal.tsx",
  "app/components/PlanV2/WeekListView.tsx",
  "app/components/PlanV2/DailyPrintSheet.tsx",
  "app/components/PlanV2/WeeklyPrintSheet.tsx",
  "app/components/PlanV2/DailyPrintPDF.tsx",
  "app/components/PlanV2/CurriculumGroupsPanel.tsx",
  "app/components/PlanV2/lessonTitle.ts",
  "app/components/TodayLessonCard.tsx",
];

test("converted screens never print a lesson number as a bare 'Lesson N'", () => {
  for (const f of CONVERTED) {
    const src = read(f);
    assert.doesNotMatch(src, /Lesson \$\{[a-zA-Z]/, `${f} builds "Lesson \${n}" itself; use formatLessonLabel`);
    assert.doesNotMatch(src, /Lesson \{[a-zA-Z]/, `${f} renders "Lesson {n}" itself; use formatLessonLabel`);
  }
});

test("Today's visible lesson text goes through the formatter; stored text stays raw", () => {
  const today = read("app/dashboard/page.tsx");
  assert.match(today, /formatLessonLabel\(g\.current_lesson, unitFor\(g\.goal_id\)\)/, "the did-you-finish card");
  assert.match(today, /displayLessonTitle\(lesson\.title, lesson\.lesson_number, unitFor\(lesson\.curriculum_goal_id\)\)/, "the check-off sheet");
  // The stored title a prior-lesson card writes is the parseable one.
  assert.match(today, /title: `\$\{g\.curriculum_name\} — Lesson \$\{g\.current_lesson\}`/);
});

test("the new columns are named only in the fail-soft read and the builder's own write", () => {
  const hits = execSync(`grep -rlE "lesson_unit_label|lessons_per_unit" app lib --include=*.ts --include=*.tsx --exclude=*.test.ts`, {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  }).trim().split("\n").sort();
  assert.deepEqual(hits, [
    "app/dashboard/plan/schedule/page.tsx",
    "lib/lesson-label.ts",
    "lib/lesson-units-context.tsx",
  ]);
  const builder = read("app/dashboard/plan/schedule/page.tsx");
  // In the builder they appear only as row fields and in the separate write,
  // never in a select string.
  assert.doesNotMatch(builder, /select\([^)]*lesson_unit_label/);
  assert.match(builder, /update\(w\.cols\)\.eq\("id", w\.id\)\.select\("id"\)/);
});
