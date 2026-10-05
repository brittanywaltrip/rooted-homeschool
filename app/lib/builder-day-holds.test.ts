import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeNextLessonsForGoal,
  dayHoldsFromRows,
  isDayHold,
  isPinnedSlot,
  planPhase2Rows,
  queueHoldsFromRows,
  type CurriculumGoalConfig,
  type QueueHold,
} from "./scheduler.ts";
import { validatePhase2End, type Phase2EndRow } from "./phase2-commit.ts";

// A dated lesson with no queue slot holds one of its day's lessons. The
// database (apply_builder_rebuild) and the Builder's pre-save check
// (validatePhase2End) always counted it; the projector did not, so a pace
// change or a raised starting lesson packed new lessons onto that day and the
// save was refused. These tests hold all three to one rule.

const TODAY = new Date(2026, 9, 5); // Mon 2026-10-05, local
const ymd = (offset: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

test("day holds: dated, unfinished, unskipped curriculum lessons with no slot, pinned or not", () => {
  const g = "goal-a";
  const rows = [
    { curriculum_goal_id: g, queue_position: null, scheduled_date: ymd(1), date: ymd(1), completed: false, queue_pinned: false, skipped: false },
    { curriculum_goal_id: g, queue_position: null, scheduled_date: ymd(2), date: ymd(2), completed: false, queue_pinned: true, skipped: false },
    { curriculum_goal_id: g, queue_position: 4, scheduled_date: ymd(3), date: ymd(3), completed: false, queue_pinned: false, skipped: false },
    { curriculum_goal_id: g, queue_position: null, scheduled_date: ymd(4), date: ymd(4), completed: true, queue_pinned: false, skipped: false },
    { curriculum_goal_id: g, queue_position: null, scheduled_date: ymd(5), date: ymd(5), completed: false, queue_pinned: false, skipped: true },
    { curriculum_goal_id: g, queue_position: null, scheduled_date: null, date: ymd(6), completed: false, queue_pinned: false, skipped: false },
    { curriculum_goal_id: null, queue_position: null, scheduled_date: ymd(7), date: ymd(7), completed: false, queue_pinned: false, skipped: false },
    { curriculum_goal_id: "goal-b", queue_position: null, scheduled_date: ymd(8), date: ymd(8), completed: false, queue_pinned: false, skipped: false },
  ];
  assert.deepEqual(dayHoldsFromRows(rows, g).map((h) => h.date), [ymd(1), ymd(2)]);
  assert.deepEqual(dayHoldsFromRows(rows).map((h) => h.date), [ymd(1), ymd(2), ymd(8)], "unscoped: every curriculum, never a one-off");
  // A caller that did not select queue_position must not read every row as unslotted.
  assert.deepEqual(dayHoldsFromRows([{ scheduled_date: ymd(1), completed: false }]), []);
  // A caller scoped to one curriculum without selecting curriculum_goal_id still gets its holds.
  assert.deepEqual(dayHoldsFromRows([{ queue_position: null, scheduled_date: ymd(1), completed: false }]).map((h) => h.date), [ymd(1)]);
  // The shared shape every projecting surface passes includes them, next to pins and skips.
  const holds = queueHoldsFromRows(rows, g);
  assert.equal(holds.filter(isDayHold).length, 2);
  assert.equal(holds.filter(isPinnedSlot).length, 0, "an unslotted pinned row is a day hold, never a slot pin");
});

test("projector: a day hold takes room on its day, is never emitted, and pins still stack", () => {
  const goal: CurriculumGoalConfig = { id: "g", school_days: ALL_DAYS, lessons_per_day: 2, lessons_per_day_overrides: null, current_lesson: 0, total_lessons: 10, start_date: null };
  const plain = computeNextLessonsForGoal(goal, TODAY, 30);
  assert.deepEqual(plain.slice(0, 4).map((p) => p.date), [ymd(0), ymd(0), ymd(1), ymd(1)]);
  const held: QueueHold[] = [{ date: ymd(1), occupies: true }, { date: ymd(1), occupies: true }, { date: ymd(2), occupies: true }];
  const out = computeNextLessonsForGoal(goal, TODAY, 30, [], 0, held);
  assert.deepEqual(out.slice(0, 5).map((p) => [p.lesson_number, p.date]), [[1, ymd(0)], [2, ymd(0)], [3, ymd(2)], [4, ymd(3)], [5, ymd(3)]],
    "tomorrow is full, the day after has one place left");
  assert.equal(out.length, 10, "every slot is still placed; nothing is emitted for a hold");
  assert.equal(new Set(out.map((p) => p.lesson_number)).size, 10);
  // Outside the window it changes nothing.
  assert.deepEqual(computeNextLessonsForGoal(goal, TODAY, 30, [], 0, [{ date: ymd(-1), occupies: true }]), plain);
  // A pin on a held day still lands there: pins are the family's and may stack.
  const withPin = computeNextLessonsForGoal(goal, TODAY, 30, [], 0, [...held, { slot: 3, date: ymd(1) }]);
  assert.deepEqual(withPin.find((p) => p.lesson_number === 3)?.date, ymd(1));
});

test("planner and pre-save check agree on capacity for every shape (pace changes, raised starts, pinned and unpinned unslotted lessons, overloaded days)", () => {
  let seed = 145;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let shapes = 0, oldRuleRefusals = 0;
  for (let i = 0; i < 400; i++) {
    const lpd = 1 + rand(3);
    const days = rand(2) === 0 ? ALL_DAYS : ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const done = rand(4);
    // A raised start moves the pointer past lessons the family has not done.
    const current = done + rand(3);
    const total = 25;
    const goal: CurriculumGoalConfig = { id: "g", school_days: days, lessons_per_day: lpd, lessons_per_day_overrides: null, current_lesson: current, total_lessons: total, start_date: null };
    const rows: Array<Parameters<typeof planPhase2Rows>[0]["beforeRows"][number]> = [];
    for (let n = 1; n <= done; n++) rows.push({ id: `done-${n}`, lesson_number: n, queue_position: n, completed: true, queue_pinned: false, skipped: false, scheduled_date: ymd(-10 + n), date: ymd(-10 + n), notes: null, minutes_spent: 30 });
    // Unslotted lessons: pinned or not, some with minutes, some piled on one day past its pace.
    const unslotted = rand(5);
    const pile = rand(6);
    for (let k = 0; k < unslotted; k++) {
      const day = rand(3) === 0 ? pile : rand(12);
      rows.push({ id: `un-${k}`, lesson_number: 200 + k, queue_position: null, completed: false, queue_pinned: rand(2) === 0, skipped: false, scheduled_date: ymd(day), date: ymd(day), notes: null, minutes_spent: rand(2) === 0 ? 20 : null });
    }
    // Sometimes a live pin on a slot ahead of the pointer.
    if (rand(3) === 0) {
      const slot = current + 2 + rand(5), day = rand(10);
      rows.push({ id: `pin-${slot}`, lesson_number: slot, queue_position: slot, completed: false, queue_pinned: true, skipped: false, scheduled_date: ymd(day), date: ymd(day), notes: null, minutes_spent: null });
    }
    const plan = planPhase2Rows({ beforeRows: rows, goalId: "g", clearPins: false, currentLesson: current, totalLessons: total, todayYmd: ymd(0) });
    const check = (holds: readonly QueueHold[]) => {
      const projected = computeNextLessonsForGoal(goal, TODAY, 90, [], 0, holds);
      const pinnedSlots = new Set(holds.filter(isPinnedSlot).map((h) => h.slot));
      const end: Phase2EndRow[] = [];
      for (const p of projected) {
        if (p.lesson_number <= current) continue;
        end.push({ id: `slot-${p.lesson_number}`, lesson_number: p.lesson_number, queue_position: p.lesson_number, completed: false, queue_pinned: pinnedSlots.has(p.lesson_number), skipped: false, scheduled_date: p.date, notes: null, minutes_spent: null, placed: !pinnedSlots.has(p.lesson_number), inserted: false });
      }
      for (const r of rows.filter((r) => !r.completed && r.queue_position === null)) {
        end.push({ id: r.id, lesson_number: r.lesson_number, queue_position: null, completed: false, queue_pinned: !!r.queue_pinned, skipped: false, scheduled_date: r.scheduled_date, notes: null, minutes_spent: r.minutes_spent, placed: false, inserted: false });
      }
      return validatePhase2End({
        beforeRows: [], endRows: end, todayYmd: ymd(0), doneToday: 0, currentLesson: current, perDayAllowed: () => lpd,
        plan: { unpin_ids: [], makeup_ids: [], delete_ids: [], inserts: [], redates: [], retire_above: null, retire_keep_ids: [] },
      }).overCapacity;
    };
    assert.deepEqual(check(plan.holds), [], `shape ${i}: the planner placed a lesson the pre-save check refuses`);
    // Negative control: the projector without day holds is what used to be refused.
    if (check(plan.holds.filter((h) => !isDayHold(h))).length > 0) oldRuleRefusals++;
    shapes++;
  }
  assert.equal(shapes, 400);
  assert.ok(oldRuleRefusals > 50, `the check must be able to see the old disagreement (saw ${oldRuleRefusals})`);
});

test("every projecting surface reads the same rule", () => {
  const src = readFileSync(new URL("./scheduler.ts", import.meta.url), "utf8");
  assert.match(src, /\.or\("queue_pinned\.eq\.true,skipped\.eq\.true,and\(queue_position\.is\.null,scheduled_date\.not\.is\.null\)"\)/, "loadPinsByGoal reads unslotted dated rows");
  assert.match(src, /const pins: QueueHold\[\] = \[\s*\.\.\.skippedSlotsFromRows\(rows\),\s*\.\.\.dayHoldsFromRows\(rows, goal\.id\),\s*\.\.\.doneTodayHolds\(done\.unslotted, toDateStr\(today\)\),\s*\];/, "the page-load reconciler leaves room for them, and for unslotted lessons finished today");
  assert.match(src, /const holds: QueueHold\[\] = \[\.\.\.skippedSlotsFromRows\(rows\), \.\.\.dayHoldsFromRows\(rows, goal\.id\)\];/, "the parent re-spread leaves room for them");
  assert.match(src, /const holds: QueueHold\[\] = \[\.\.\.pins, \.\.\.skippedSlots, \.\.\.dayHolds\];/, "the Builder plans around them");
});

test("the post-save monitor counts an unslotted lesson as room taken, never as a scheduler placement", () => {
  const page = readFileSync(new URL("../dashboard/plan/schedule/page.tsx", import.meta.url), "utf8");
  assert.match(page, /placed: !\(r\.queue_pinned \?\? false\) && r\.queue_position != null,/);
  // Two family-placed unslotted lessons on a one-a-day day: no breach under that rule.
  const day = ymd(3);
  const end: Phase2EndRow[] = ["a", "b"].map((id) => ({ id, lesson_number: null, queue_position: null, completed: false, queue_pinned: false, skipped: false, scheduled_date: day, notes: null, minutes_spent: null, placed: false, inserted: false }));
  const seen = validatePhase2End({ beforeRows: [], endRows: end, todayYmd: ymd(0), doneToday: 0, currentLesson: 0, perDayAllowed: () => 1,
    plan: { unpin_ids: [], makeup_ids: [], delete_ids: [], inserts: [], redates: [], retire_above: null, retire_keep_ids: [] } });
  assert.deepEqual(seen.overCapacity, []);
});

test("no-op check: family-placed unslotted lessons alone never force a rebuild; a queue lesson on their full day does", async () => {
  const { isPhase2NoOp } = await import("./scheduler.ts");
  const row = (id: string, n: number | null, slot: number | null, day: number, extra: Record<string, unknown> = {}) =>
    ({ id, lesson_number: n, queue_position: slot, completed: false, queue_pinned: false, skipped: false, scheduled_date: ymd(day), date: ymd(day), ...extra });
  const base = { deletedIds: new Set<string>(), workRowIds: new Set<string>(), toInsert: [], histToInsertCount: 0, projDateBySlot: new Map<number, string>(), releasesPins: false, totalLessons: 20, todayYmd: ymd(0), perDayAllowed: () => 1 };
  // Two unslotted lessons the family put on one one-a-day day, queue lessons elsewhere.
  const familyOverload = [row("u1", 5, null, 3), row("u2", 6, null, 3, { notes: "" }), row("q7", 7, 7, 0), row("q8", 8, 8, 4)];
  assert.equal(isPhase2NoOp({ ...base, beforeRows: familyOverload }).noop, true);
  // A queue lesson stored on a day an unslotted lesson already fills is the scheduler's overfill.
  const stacked = [row("u1", 5, null, 1), row("q7", 7, 7, 1)];
  assert.deepEqual(isPhase2NoOp({ ...base, beforeRows: stacked }), { noop: false, reason: `${ymd(1)} holds 2 lessons` });
});
