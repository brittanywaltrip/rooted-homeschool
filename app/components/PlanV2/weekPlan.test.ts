import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  WEEK_PLAN_SOURCE,
  dayLabel,
  numberedTitles,
  weekDates,
  weekPlanDays,
  weekPlanProblem,
  weekPlanRows,
  weekPlanSummary,
  weekPlanTitle,
  type WeekPlanInput,
} from "./weekPlan.ts";
import { lessonMinutes, sumLessonMinutes } from "../../../lib/lesson-minutes.ts";

// Plan's week starts on Monday. Monday 2026-09-28.
const MON = new Date(2026, 8, 28);
const TODAY = "2026-09-29"; // Tuesday

test("the week is the seven days from Plan's Monday", () => {
  assert.deepEqual(weekDates(MON), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
  assert.deepEqual(weekDates(MON).map(dayLabel), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
});

test("the sheet starts on the family's school days from today on, never a past day or a break", () => {
  const days = weekPlanDays({
    weekStart: MON,
    today: TODAY,
    schoolDays: ["Mon", "Tue", "Wed", "Thu"],
    breaks: [{ start_date: "2026-10-01", end_date: "2026-10-01" }],
  });
  assert.deepEqual(days.filter((d) => d.defaultChosen).map((d) => dayLabel(d.date)), ["Tue", "Wed"]);
  assert.equal(days[0].past, true, "Monday has passed");
  assert.equal(days[3].onBreak, true, "Thursday is a break");
  assert.equal(days[4].defaultChosen, false, "Friday is not a school day for this family");
});

test("an empty school-day setting falls back to Monday to Friday", () => {
  const days = weekPlanDays({ weekStart: MON, today: "2026-09-28", schoolDays: [], breaks: [] });
  assert.deepEqual(days.filter((d) => d.defaultChosen).map((d) => dayLabel(d.date)), ["Mon", "Tue", "Wed", "Thu", "Fri"]);
});

test("titles count up from the first one the parent typed", () => {
  assert.deepEqual(numberedTitles("Week 12.1", 4), ["Week 12.1", "Week 12.2", "Week 12.3", "Week 12.4"]);
  assert.deepEqual(numberedTitles("Chapter 9", 3), ["Chapter 9", "Chapter 10", "Chapter 11"]);
  assert.deepEqual(numberedTitles("Day 08 review", 3), ["Day 08 review", "Day 09 review", "Day 10 review"]);
  assert.deepEqual(numberedTitles("Nature walk", 2), ["Nature walk", "Nature walk"], "no number: the title repeats");
});

test("a lesson reads 'Subject · Title', the same shape as Add a lesson", () => {
  assert.equal(weekPlanTitle("Unit study", "Week 12.1"), "Unit study · Week 12.1");
  assert.equal(weekPlanTitle("  Unit study ", ""), "Unit study");
  assert.equal(weekPlanTitle("", "Week 12.1"), "Week 12.1");
});

const plan: WeekPlanInput = {
  childIds: ["zoe", "emma"],
  subject: "Unit study",
  minutes: 45,
  notes: null,
  days: [
    { date: "2026-09-30", title: "Week 12.2" },
    { date: "2026-09-29", title: "Week 12.1" },
  ],
};

test("each child gets their own lesson on each chosen day, with the planned minutes", () => {
  const rows = weekPlanRows("family", plan, TODAY);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.scheduled_date, r.child_id, r.title]), [
    ["2026-09-29", "zoe", "Unit study · Week 12.1"],
    ["2026-09-29", "emma", "Unit study · Week 12.1"],
    ["2026-09-30", "zoe", "Unit study · Week 12.2"],
    ["2026-09-30", "emma", "Unit study · Week 12.2"],
  ]);
  for (const r of rows) {
    assert.equal(r.minutes_spent, 45);
    assert.equal(r.hours, 0.75);
    assert.equal(r.user_id, "family");
    assert.equal(r.date, r.scheduled_date);
  }
});

test("planned lessons are open one-offs: no curriculum, no queue slot, no number, nothing done", () => {
  for (const r of weekPlanRows("family", plan, TODAY)) {
    assert.equal(r.curriculum_goal_id, null, "the curriculum scheduler never reads a lesson with no goal");
    assert.equal(r.lesson_number, null);
    assert.equal("queue_position" in r ? r.queue_position : null, null);
    assert.equal(r.completed, false, "only a person completes a lesson (Invariant 15)");
    assert.equal(r.completed_at, null);
    assert.equal(r.scheduled_source, WEEK_PLAN_SOURCE, "Invariant 10: every lesson write names its source");
  }
});

test("a plan the sheet would refuse is refused by the row builder too, before any row exists", () => {
  const cases: Array<[Partial<WeekPlanInput>, RegExp]> = [
    [{ childIds: [] }, /at least one child/],
    [{ days: [] }, /at least one day/],
    [{ days: [{ date: "2026-09-29", title: "a" }, { date: "2026-09-29", title: "b" }] }, /once/],
    [{ days: [{ date: "2026-09-28", title: "a" }] }, /passed/],
    [{ subject: "", days: [{ date: "2026-09-29", title: " " }] }, /Give Tue a title/],
    [{ minutes: 0 }, /Minutes/],
    [{ minutes: 12.5 }, /Minutes/],
  ];
  for (const [change, message] of cases) {
    const input = { ...plan, ...change };
    assert.match(weekPlanProblem(input, TODAY) ?? "", message);
    assert.throws(() => weekPlanRows("family", input, TODAY), message);
  }
  assert.equal(weekPlanProblem(plan, TODAY), null);
});

test("a child chosen twice still gets one lesson a day", () => {
  assert.equal(weekPlanRows("family", { ...plan, childIds: ["zoe", "zoe"] }, TODAY).length, 2);
});

test("the sentence above Save says exactly what Save adds", () => {
  assert.equal(weekPlanSummary(4, ["Zoe", "Emma"]), "Adds 8 lessons: 4 days each for Zoe and Emma. Each child checks off their own, and it counts on their own report.");
  assert.equal(weekPlanSummary(1, ["Zoe"]), "Adds 1 lesson for Zoe, 1 day.");
  assert.equal(weekPlanSummary(3, ["A", "B", "C"]).startsWith("Adds 9 lessons: 3 days each for A, B and C."), true);
  assert.equal(weekPlanSummary(0, ["Zoe"]), "Choose the days and children to plan.");
});

test("the planner reuses the shared one-off builder rather than a copy of it", () => {
  const src = readFileSync(new URL("./weekPlan.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ oneOffLessonRows \} from "\.\/oneOffLessonRows\.ts"/);
  assert.doesNotMatch(src, /\.from\("lessons"\)/, "the pure module never writes");
});

test("a completed planned lesson counts by the shared lesson-minutes rule (#96), per child", () => {
  // Planned with minutes: recorded, exactly as planned.
  const withMinutes = weekPlanRows("family", plan, TODAY);
  assert.deepEqual(lessonMinutes(withMinutes[0]), { minutes: 45, source: "recorded", estimated: false });
  // Planned without minutes: the 30-minute estimate, flagged. The builder
  // writes hours: 0, which the rule does not read as a recorded zero.
  const noMinutes = weekPlanRows("family", { ...plan, minutes: null }, TODAY);
  assert.equal(noMinutes[0].minutes_spent, null);
  assert.equal(noMinutes[0].hours, 0);
  assert.deepEqual(lessonMinutes(noMinutes[0]), { minutes: 30, source: "estimated", estimated: true });
  // Each child's row is their own: one child finishing counts once, for them.
  const zoeDone = withMinutes.filter((r) => r.child_id === "zoe").slice(0, 1).map((r) => ({ ...r, completed: true }));
  assert.equal(sumLessonMinutes(zoeDone).minutes, 45);
  assert.equal(withMinutes.filter((r) => r.child_id === "emma" && r.completed).length, 0);
});
