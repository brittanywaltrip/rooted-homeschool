import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeNextLessonsForGoal,
  doneTodayHolds,
  finishDateFromNextLesson,
  normalizeDoneToday,
  splitDoneToday,
  type CurriculumGoalConfig,
} from "./scheduler.ts";
import { completeLessonOnDate, completesInPlace, completionTimeFields, inPlaceCompletedAt } from "./completeLessonOnDate.ts";
import { validatePhase2End, type Phase2EndRow } from "./phase2-commit.ts";

// Lessons with no queue slot that hold one of today's lessons are shown on
// Today, completed and reopened in place, and counted the same way by the
// projector, the Builder's pre-save check and the database.

const TODAY = new Date(2026, 9, 5);
const ymd = (offset: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("done today splits into queue lessons (the rewind) and unslotted ones (holds on today)", () => {
  assert.deepEqual(splitDoneToday([{ queue_position: 3 }, { queue_position: null }, { queue_position: null }]), { slotted: 1, unslotted: 2 });
  assert.deepEqual(splitDoneToday([{}]), { slotted: 1, unslotted: 0 }, "a row read without queue_position keeps the old meaning");
  assert.deepEqual(normalizeDoneToday(4), { slotted: 4, unslotted: 0 });
  assert.deepEqual(normalizeDoneToday(undefined), { slotted: 0, unslotted: 0 });
  assert.deepEqual(doneTodayHolds(2, ymd(0)), [{ date: ymd(0), occupies: true }, { date: ymd(0), occupies: true }]);
});

test("finishing an unslotted lesson today never shows an earlier lesson as done today, and today keeps the same room", () => {
  // Two a day; lessons 1 to 3 done, lesson 3 today; an unslotted lesson also finished today.
  const goal: CurriculumGoalConfig = { id: "g", school_days: ALL_DAYS, lessons_per_day: 2, lessons_per_day_overrides: null, current_lesson: 3, total_lessons: 10, start_date: null };
  const before = computeNextLessonsForGoal(goal, TODAY, 30, [], 2).filter((p) => p.date === ymd(0)).map((p) => p.lesson_number);
  assert.deepEqual(before, [2, 3], "the old count rewound onto lesson 2, which was not done today");
  const after = computeNextLessonsForGoal(goal, TODAY, 30, [], 1, doneTodayHolds(1, ymd(0)));
  assert.deepEqual(after.filter((p) => p.date === ymd(0)).map((p) => p.lesson_number), [3], "only the lesson really done today is shown back");
  assert.equal(after.find((p) => p.lesson_number === 4)?.date, ymd(1), "today is full: the next lesson is tomorrow, as before");
  // The pre-save check (and the database) subtract every completion today: no room left today either.
  const end: Phase2EndRow[] = [{ id: "l4", lesson_number: 4, queue_position: 4, completed: false, queue_pinned: false, skipped: false, scheduled_date: ymd(0), notes: null, minutes_spent: null, placed: true, inserted: false }];
  const v = validatePhase2End({ beforeRows: [], endRows: end, todayYmd: ymd(0), doneToday: 2, currentLesson: 3, perDayAllowed: () => 2,
    plan: { unpin_ids: [], makeup_ids: [], delete_ids: [], inserts: [], redates: [], retire_above: null, retire_keep_ids: [] } });
  assert.deepEqual(v.overCapacity, [{ date: ymd(0), placed: 1, room: 0 }], "placing lesson 4 today would be refused, and the projector does not");
});

test("in place: a curriculum lesson with no queue slot and a date", () => {
  assert.equal(completesInPlace({ curriculum_goal_id: "g", queue_position: null, scheduled_date: ymd(0) }), true);
  assert.equal(completesInPlace({ curriculum_goal_id: "g", queue_position: 4, scheduled_date: ymd(0) }), false);
  assert.equal(completesInPlace({ curriculum_goal_id: null, queue_position: null, scheduled_date: ymd(0) }), false, "a one-off keeps the ordinary rule");
  assert.equal(completesInPlace({ curriculum_goal_id: "g", scheduled_date: ymd(0) }), false, "an unread queue_position is not assumed empty");
  assert.equal(completesInPlace({ curriculum_goal_id: "g", queue_position: null, scheduled_date: null }), false);
  const now = new Date("2026-10-05T18:00:00Z");
  assert.equal(inPlaceCompletedAt("2026-10-05", "2026-10-05", now), now.toISOString());
  assert.equal(inPlaceCompletedAt("2026-10-03", "2026-10-05", now), "2026-10-03T12:00:00Z");
});

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
function fakeClient(stored: Record<string, unknown> | null, writtenRows: unknown[] = [{ id: "x" }]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const q: Call = { table, ops: [] };
      const api = {
        select(c: string) { q.ops.push(["select", c]); return api; },
        update(v: unknown) { q.ops.push(["update", v]); return api; },
        eq(k: string, v: unknown) { q.ops.push(["eq", k, v]); return api; },
        is(k: string, v: unknown) { q.ops.push(["is", k, v]); return api; },
        maybeSingle() { calls.push(q); return Promise.resolve({ data: stored, error: null }); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          calls.push(q);
          const selected = q.ops.some((o) => o[0] === "select");
          return Promise.resolve({ data: selected ? writtenRows : null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
  return { calls, client: client as never };
}

const UNSLOTTED = { curriculum_goal_id: "g", queue_position: null, scheduled_date: "2026-10-05", queue_pinned: true, skipped: false };
const QUEUED = { curriculum_goal_id: "g", queue_position: 4, scheduled_date: "2026-10-05", queue_pinned: false, skipped: false };
const filters = (c: Call) => c.ops.filter((o) => o[0] === "is" || o[0] === "eq");

test("completeLessonOnDate writes only the completion for an unslotted lesson, conditioned on its whole placement", async () => {
  const events: unknown[] = [];
  const f = fakeClient(UNSLOTTED);
  const r = await completeLessonOnDate(f.client, {
    lessonId: "l2", dateStr: "2026-10-09", choice: "picked", todayStr: "2026-10-05", surface: "today",
    extra: { minutes_spent: 20, hours: 20 / 60 }, now: new Date("2026-10-05T18:00:00Z"), track: (e) => events.push(e),
  });
  assert.equal(r.error, null);
  assert.equal(r.inPlace, true);
  assert.equal(r.filedDate, "2026-10-05", "filed under its own day whatever day was passed in");
  const write = f.calls[1];
  assert.deepEqual(write.ops.find((o) => o[0] === "update")?.[1], { minutes_spent: 20, hours: 20 / 60, completed: true, completed_at: "2026-10-05T18:00:00.000Z" },
    "no date, no source, no pin, no backfill flag, never a queue slot");
  assert.deepEqual(filters(write), [["eq", "id", "l2"], ["eq", "curriculum_goal_id", "g"], ["is", "queue_position", null], ["eq", "scheduled_date", "2026-10-05"], ["eq", "queue_pinned", true], ["eq", "skipped", false]]);
  assert.deepEqual(write.ops.find((o) => o[0] === "select"), ["select", "id"], "the write reports what it updated");
  assert.deepEqual(events, [{ lesson_number: null, subject_label: null, lesson_date: "2026-10-05", date_choice: "today", surface: "today" }]);
});

test("completeLessonOnDate: only minutes_spent and hours ever travel with a completion", async () => {
  const stray = { minutes_spent: 15, hours: 0.25, notes: "x", scheduled_date: "2026-12-25", queue_position: 9, queue_pinned: false, scheduled_source: "evil", completed: false } as never;
  for (const stored of [UNSLOTTED, QUEUED]) {
    const f = fakeClient(stored);
    await completeLessonOnDate(f.client, { lessonId: "l", dateStr: "2026-10-05", choice: "today", todayStr: "2026-10-05", surface: "today", extra: stray, now: new Date("2026-10-05T18:00:00Z") });
    const payload = f.calls[1].ops.find((o) => o[0] === "update")?.[1] as Record<string, unknown>;
    assert.equal(payload.minutes_spent, 15);
    assert.equal(payload.hours, 0.25);
    assert.equal("notes" in payload, false);
    assert.equal(payload.completed, true, "the completion itself always wins");
    if (stored === UNSLOTTED) assert.deepEqual(Object.keys(payload).sort(), ["completed", "completed_at", "hours", "minutes_spent"]);
    else assert.equal(payload.scheduled_date, "2026-10-05", "a queue lesson takes the date rule, never a passed-in date");
  }
  assert.deepEqual(completionTimeFields({ minutes_spent: "30", hours: null, notes: "x" }), { hours: null }, "wrong types are dropped too");
  assert.deepEqual(completionTimeFields(undefined), {});
});

test("completeLessonOnDate: a missing lesson is refused before anything is written", async () => {
  const events: unknown[] = [];
  const f = fakeClient(null);
  const r = await completeLessonOnDate(f.client, { lessonId: "gone", dateStr: "2026-10-05", choice: "today", todayStr: "2026-10-05", surface: "plan", track: (e) => events.push(e) });
  assert.equal(r.error?.code, "not_found");
  assert.equal(f.calls.length, 1, "only the read ran");
  assert.deepEqual(events, []);
});

test("completeLessonOnDate: a placement change between read and write refuses either path, and nothing is tracked", async () => {
  for (const stored of [UNSLOTTED, QUEUED]) {
    const events: unknown[] = [];
    const f = fakeClient(stored, []);
    const r = await completeLessonOnDate(f.client, { lessonId: "l", dateStr: "2026-10-05", choice: "today", todayStr: "2026-10-05", surface: "today", track: (e) => events.push(e) });
    assert.equal(r.error?.code, "placement_changed");
    assert.deepEqual(events, []);
  }
  // More than one row reported is not "exactly one" either.
  const f = fakeClient(QUEUED, [{ id: "a" }, { id: "b" }]);
  const r = await completeLessonOnDate(f.client, { lessonId: "l", dateStr: "2026-10-05", choice: "today", todayStr: "2026-10-05", surface: "today" });
  assert.equal(r.error?.code, "placement_changed");
});

test("completeLessonOnDate: a queue lesson keeps the ordinary payload, conditioned on the placement it was read with", async () => {
  const f = fakeClient(QUEUED);
  const r = await completeLessonOnDate(f.client, { lessonId: "l4", dateStr: "2026-10-05", choice: "today", todayStr: "2026-10-05", surface: "today", now: new Date("2026-10-05T18:00:00Z") });
  assert.equal(r.inPlace, false);
  assert.equal(r.error, null);
  const write = f.calls[1];
  const payload = write.ops.find((o) => o[0] === "update")?.[1] as Record<string, unknown>;
  assert.equal(payload.scheduled_source, "completion_today");
  assert.equal(payload.date, "2026-10-05");
  assert.deepEqual(filters(write), [["eq", "id", "l4"], ["eq", "curriculum_goal_id", "g"], ["eq", "queue_position", 4], ["eq", "scheduled_date", "2026-10-05"], ["eq", "queue_pinned", false], ["eq", "skipped", false]]);
});

test("Builder finish estimate counts the days unslotted lessons hold", () => {
  const base = { schoolDays: ALL_DAYS, lessonsPerDay: 1, currentLesson: 0, totalLessons: 5, fromYmd: ymd(0) };
  const plain = finishDateFromNextLesson(base);
  const held = finishDateFromNextLesson({ ...base, dayHolds: [{ date: ymd(1), occupies: true }, { date: ymd(2), occupies: true }] });
  assert.ok(plain && held);
  assert.equal(Math.round((held.getTime() - plain.getTime()) / 864e5), 2, "two held days push the last lesson two days out");
});

test("Today, Plan and the Builder are wired to the same rules", () => {
  const today = read("../dashboard/page.tsx");
  assert.match(today, /\.is\("queue_position", null\)\s*\.or\(`and\(completed\.eq\.false,scheduled_date\.eq\.\$\{today\}\),and\(completed\.eq\.true,completed_at\.gte\."\$\{todayStartIso\}",completed_at\.lt\."\$\{tomorrowStartIso\}"\)`\)/, "Today loads the unslotted lessons that hold today");
  assert.match(today, /\.\.\.\(\(unslottedTodayResult\.data \?\? \[\]\)/, "and lists them with the other lessons that have no slot");
  assert.match(today, /pinsByGoal\.set\(gid, \[\.\.\.\(pinsByGoal\.get\(gid\) \?\? \[\]\), \.\.\.doneTodayHolds\(n, today\)\]\);/, "finished-today unslotted lessons hold today in every Today projection");
  assert.match(today, /if \(completesInPlace\(args\.lesson\) && args\.lesson\.scheduled_date\) \{/, "no date chooser for a lesson completed in place");
  assert.match(today, /\{!completionToast\.inPlace && \(/, "no Change for a lesson completed in place");
  assert.match(today, /if \(error\.code === "placement_changed" \|\| error\.code === "not_found"\) await loadData\(\);/, "Today reloads after a refused completion");
  const plan = read("../components/PlanV2/usePlanLessonActions.ts");
  assert.match(plan, /completesInPlace\(lesson as/);
  assert.match(plan, /if \(error\.code === "placement_changed" \|\| error\.code === "not_found"\) onScheduleRedated\?\.\(\);/, "Plan reloads after a refused completion");
  assert.match(read("../components/PlanV2/usePlanV2Data.ts"), /lesson_number, queue_position, completed/, "Plan reads queue_position");
  const builder = read("../dashboard/plan/schedule/page.tsx");
  assert.match(builder, /\.select\("curriculum_goal_id, queue_position"\)/, "the preview splits today's completions");
  assert.match(read("./daily-reconcile.ts"), /done_today: doneToday\.slotted \+ doneToday\.unslotted,/, "the daily reconcile's stale check still counts every completion");
});
