import test from "node:test";
import assert from "node:assert/strict";
import {
  builderNextLesson,
  computeNextLessonsForGoal,
  isSkippedSlot,
  loadPinsByGoal,
  loadReservationRows,
  phase2RedateTargets,
  planPhase2LessonInserts,
  planPhase2Rows,
  queueHoldsFromRows,
  reservedSlotsFromRows,
  type CurriculumGoalConfig,
  type Phase2PlanRow,
  type QueueHold,
} from "./scheduler.ts";

// A lesson with no queue slot keeps its lesson NUMBER. Phase 2 used to zip the
// missing lesson numbers onto the free projected slots in order, and the
// unslotted lesson's own slot counted as free while its number did not, so
// every later lesson slid down one slot on any save that rebuilt the goal,
// even with no edits. "What lesson are you on next?" names a slot, so after
// that it picked the lesson after the one the family typed, and the lesson
// they typed became a make-up (rooted-staging, 2026-10-06, family-c).
//
// The rule now: an unslotted lesson's own slot is reserved while no row holds
// it, above the pointer only. Every projector steps over it as it steps over a
// skip, so lesson N stays in slot N and the unslotted lesson is never given a
// slot.

const TODAY = new Date(2026, 9, 5); // Mon 2026-10-05, local
const ymd = (offset: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const G = "goal-1";

type Row = Phase2PlanRow & { curriculum_goal_id: string; scheduled_source: string; is_backfill: boolean };
type Goal = { total_lessons: number; start_at_lesson: number; current_lesson: number; lessons_per_day: number };

let nextId = 0;
const id = () => `r${++nextId}`;

/** A healthy goal: lesson N in slot N, 1..done completed, the rest dated forward one a day from today. */
function goalRows(total: number, done: number): Row[] {
  const rows: Row[] = [];
  for (let n = 1; n <= total; n++) {
    const completed = n <= done;
    rows.push({
      id: id(), curriculum_goal_id: G, lesson_number: n, queue_position: n, completed,
      queue_pinned: false, skipped: false, notes: null, minutes_spent: completed ? 30 : null,
      scheduled_date: completed ? ymd(n - done - 1) : ymd(n - done - 1), date: completed ? ymd(n - done - 1) : ymd(n - done - 1),
      title: `Lesson ${n}`, scheduled_source: "wizard_create", is_backfill: false,
    });
  }
  return rows;
}

/** The database's pointer rule (recompute_curriculum_current_lesson). */
function pointer(goal: Goal, rows: Row[]): number {
  const maxDone = rows.reduce((m, r) => (r.completed && r.queue_position != null ? Math.max(m, r.queue_position) : m), 0);
  return Math.min(Math.max(goal.start_at_lesson - 1, maxDone), goal.total_lessons);
}

/** trg_curriculum_goals_cleanup_orphans as 20261005000000 leaves it: slotted rows only. */
function cleanup(rows: Row[], from: number, to: number): Row[] {
  if (to <= from) return rows;
  return rows.map((r) =>
    !r.completed && r.scheduled_date != null && r.queue_position != null && !r.queue_pinned &&
    r.lesson_number != null && r.lesson_number <= to && !r.notes
      ? { ...r, scheduled_date: null }
      : r);
}

function config(goal: Goal): CurriculumGoalConfig {
  return { id: G, school_days: ALL_DAYS, lessons_per_day: goal.lessons_per_day, lessons_per_day_overrides: null, current_lesson: goal.current_lesson, total_lessons: goal.total_lessons, start_date: null };
}

/** Every projecting surface's holds: pins, skips, day holds and reserved slots, from the goal's rows. */
function surfaceHolds(goal: Goal, rows: Row[]): QueueHold[] {
  return [...queueHoldsFromRows(rows, G), ...reservedSlotsFromRows(rows, goal.current_lesson, G)];
}

/**
 * One Schedule Builder save of one goal, as handleSave runs it: settings and
 * the pointer they imply, the cleanup that pointer move fires, planPhase2Rows,
 * the projection, planPhase2LessonInserts, re-dates for held work rows, and
 * make-up conversions. Returns the goal and rows as committed.
 */
function save(goal: Goal, rows: Row[], edit: Partial<Pick<Goal, "start_at_lesson" | "lessons_per_day">> = {}): { goal: Goal; rows: Row[] } {
  const next: Goal = { ...goal, ...edit };
  const changed = Object.keys(edit).length > 0;
  next.current_lesson = pointer(next, rows);
  let before = cleanup(rows, goal.current_lesson, next.current_lesson);
  const plan = planPhase2Rows({ beforeRows: before, goalId: G, clearPins: changed, currentLesson: next.current_lesson, totalLessons: next.total_lessons, todayYmd: ymd(0) });
  const upcoming = computeNextLessonsForGoal(config(next), TODAY, 3650, [], 0, plan.holds);
  const projDateBySlot = new Map(upcoming.map((p) => [p.lesson_number, p.date]));
  const existingNums = new Set<number>();
  const existingSlots = new Set<number>();
  for (const r of plan.survivors) {
    if (r.queue_position != null) existingSlots.add(r.queue_position);
    if (r.lesson_number != null) existingNums.add(r.lesson_number);
  }
  const inserts = planPhase2LessonInserts({ upcoming, existingLessonNumbers: existingNums, existingQueuePositions: existingSlots, skippedSlots: plan.projectableSkippedSlots });
  const redates = new Map(phase2RedateTargets({ beforeRows: before, workRowIds: plan.workRowIds, projDateBySlot }).map((t) => [t.id, t.date]));
  before = plan.survivors.map((r) => {
    let out = r as Row;
    if (redates.has(r.id)) out = { ...out, scheduled_date: redates.get(r.id)!, date: redates.get(r.id)! };
    if (plan.makeUpIds.has(r.id)) out = { ...out, queue_pinned: true, scheduled_source: "reopened" };
    return out;
  });
  const inserted: Row[] = inserts.map((p) => ({
    id: id(), curriculum_goal_id: G, lesson_number: p.lesson_number, queue_position: p.queue_position, completed: false,
    queue_pinned: false, skipped: false, notes: null, minutes_spent: null, scheduled_date: p.date, date: p.date,
    title: `Lesson ${p.lesson_number}`, scheduled_source: "wizard_create", is_backfill: false,
  }));
  return { goal: next, rows: [...before, ...inserted] };
}

/** What Today puts on today, by lesson number, from the committed rows. */
function todayLessons(goal: Goal, rows: Row[]): number[] {
  const out = computeNextLessonsForGoal(config(goal), TODAY, 1, [], 0, surfaceHolds(goal, rows));
  const bySlot = new Map(rows.filter((r) => r.queue_position != null).map((r) => [r.queue_position!, r]));
  return out.filter((p) => p.date === ymd(0)).map((p) => bySlot.get(p.lesson_number)?.lesson_number ?? -p.lesson_number);
}

/** What the Builder preview names as next for a typed start (rowScheduleFor). */
function previewNext(goal: Goal, rows: Row[], typed: number): number {
  const reserved = reservedSlotsFromRows(rows, typed - 1, G).map((h) => h.slot);
  const skipped = queueHoldsFromRows(rows, G).filter(isSkippedSlot).map((h) => h.slot);
  return builderNextLesson(typed, [...skipped, ...reserved], goal.total_lessons);
}

const slotOf = (rows: Row[], n: number) => rows.find((r) => r.lesson_number === n)?.queue_position;
const byNumber = (rows: Row[]) => [...rows].sort((a, b) => (a.lesson_number ?? 0) - (b.lesson_number ?? 0));
/** Rows without their ids, which a re-created lesson gets fresh. */
const stable = (rows: Row[]) => byNumber(rows).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id")));

function assertWhole(rows: Row[], total: number) {
  const numbers = rows.map((r) => r.lesson_number).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(numbers, Array.from({ length: total }, (_, i) => i + 1), "every lesson exists exactly once");
  const slots = rows.filter((r) => r.queue_position != null).map((r) => r.queue_position);
  assert.equal(new Set(slots).size, slots.length, "no two rows share a slot");
}

/** A dated, unpinned, note-free lesson with no slot: what an orphan strip leaves. */
function unslot(rows: Row[], n: number, patch: Partial<Row> = {}): Row[] {
  return rows.map((r) => (r.lesson_number === n ? { ...r, queue_position: null, ...patch } : r));
}

test("no-edit save: lessons after an unslotted lesson keep their own slots", () => {
  const goal: Goal = { total_lessons: 20, start_at_lesson: 3, current_lesson: 2, lessons_per_day: 1 };
  const rows = unslot(goalRows(20, 2), 12);
  const out = save(goal, rows);
  for (const r of out.rows) if (r.queue_position != null) assert.equal(r.queue_position, r.lesson_number, `lesson ${r.lesson_number} slot`);
  assert.equal(slotOf(out.rows, 12), null, "the unslotted lesson is never given a slot");
  assert.deepEqual(out.rows.find((r) => r.lesson_number === 12), rows.find((r) => r.lesson_number === 12), "the unslotted lesson is untouched");
  assertWhole(out.rows, 20);
});

test("repeated saves: no cumulative slot shift, and a settled goal stays settled", () => {
  const goal: Goal = { total_lessons: 20, start_at_lesson: 3, current_lesson: 2, lessons_per_day: 1 };
  let state = { goal, rows: unslot(unslot(goalRows(20, 2), 9), 12) };
  const first = save(state.goal, state.rows);
  state = first;
  for (let i = 0; i < 4; i++) {
    state = save(state.goal, state.rows);
    assert.deepEqual(stable(state.rows), stable(first.rows), `save ${i + 2} is identical to the first`);
  }
  for (const r of state.rows) if (r.queue_position != null) assert.equal(r.queue_position, r.lesson_number);
});

test("changing the next lesson picks the lesson the family typed, in preview, commit and Today", () => {
  // The staging failure: lesson 14 unslotted and ahead of the pointer, then
  // "What lesson are you on next?" raised from 11 to 16.
  const goal: Goal = { total_lessons: 42, start_at_lesson: 11, current_lesson: 10, lessons_per_day: 1 };
  let state = save(goal, unslot(goalRows(42, 10), 14));
  assert.equal(previewNext(state.goal, state.rows, 16), 16, "preview names lesson 16");
  state = save(state.goal, state.rows, { start_at_lesson: 16 });
  assert.equal(state.goal.current_lesson, 15, "the database pointer is 15");
  assert.deepEqual(todayLessons(state.goal, state.rows), [16], "Today shows lesson 16");
  const l16 = state.rows.find((r) => r.lesson_number === 16)!;
  assert.equal(l16.queue_pinned, false, "lesson 16 is not turned into a make-up");
  assert.equal(l16.queue_position, 16);
  assert.equal(state.rows.find((r) => r.lesson_number === 14)!.scheduled_date, ymd(3), "the unslotted lesson keeps its date");
  assertWhole(state.rows, 42);
  // Typing the unslotted lesson's own number names the next lesson the queue
  // will actually date, everywhere: the unslotted one stays on its own day.
  const at14 = save(goal, unslot(goalRows(42, 10), 14), { start_at_lesson: 14 });
  assert.equal(previewNext(at14.goal, at14.rows, 14), 15);
});

test("an unslotted lesson AHEAD of a new, later start: preview, commit and Today agree", () => {
  const goal: Goal = { total_lessons: 30, start_at_lesson: 11, current_lesson: 10, lessons_per_day: 1 };
  const state = save(goal, unslot(goalRows(30, 10), 18), { start_at_lesson: 16 });
  assert.equal(previewNext(goal, unslot(goalRows(30, 10), 18), 16), 16);
  assert.deepEqual(todayLessons(state.goal, state.rows), [16]);
  for (const r of state.rows) if (r.queue_position != null) assert.equal(r.queue_position, r.lesson_number);
  // Lesson 18 is held off the queue; 17 and 19 sit either side of it in their own slots.
  assert.equal(slotOf(state.rows, 17), 17);
  assert.equal(slotOf(state.rows, 19), 19);
});

test("multiple unslotted lessons, at two paces, settle with every slotted lesson in its own slot", () => {
  for (const lpd of [1, 2]) {
    const goal: Goal = { total_lessons: 24, start_at_lesson: 4, current_lesson: 3, lessons_per_day: lpd };
    let rows = goalRows(24, 3);
    rows = unslot(rows, 6);
    rows = unslot(rows, 7, { queue_pinned: true });
    rows = unslot(rows, 15, { scheduled_date: null, date: null });
    rows = unslot(rows, 20, { completed: true, minutes_spent: 25 });
    const out = save(goal, rows);
    for (const r of out.rows) if (r.queue_position != null) assert.equal(r.queue_position, r.lesson_number, `pace ${lpd}, lesson ${r.lesson_number}`);
    for (const n of [6, 7, 15, 20]) assert.deepEqual(out.rows.find((r) => r.lesson_number === n), rows.find((r) => r.lesson_number === n), `unslotted ${n} untouched`);
    assertWhole(out.rows, 24);
    const again = save(out.goal, out.rows);
    assert.deepEqual(stable(again.rows), stable(out.rows), `pace ${lpd}: a second save changes nothing`);
  }
});

test("a reordered queue: a slot held by another lesson is never reserved, and book order is kept", () => {
  // The family moved lesson 15 up into slot 12 (move_lesson rewrites the slot
  // and keeps the number), then lesson 12 lost its slot.
  const goal: Goal = { total_lessons: 20, start_at_lesson: 6, current_lesson: 5, lessons_per_day: 1 };
  let rows = goalRows(20, 5);
  rows = rows.map((r) => (r.lesson_number === 15 ? { ...r, queue_position: 12, queue_pinned: true, scheduled_date: ymd(2), date: ymd(2) } : r));
  rows = unslot(rows, 12);
  assert.deepEqual(reservedSlotsFromRows(rows, 5, G), [], "slot 12 is occupied by lesson 15, so nothing is reserved");
  const out = save(goal, rows);
  assertWhole(out.rows, 20);
  assert.equal(slotOf(out.rows, 15), 12, "the family's move stands");
  assert.equal(slotOf(out.rows, 12), null);
  const slotted = out.rows.filter((r) => r.queue_position != null && !r.queue_pinned && !r.completed).sort((a, b) => a.queue_position! - b.queue_position!);
  const numbers = slotted.map((r) => r.lesson_number!);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), "unpinned lessons stay in book order");
  const again = save(out.goal, out.rows);
  assert.deepEqual(stable(again.rows), stable(out.rows), "and a second save changes nothing");
});

test("parent completions, notes, time, pins and dates survive every save", () => {
  const goal: Goal = { total_lessons: 20, start_at_lesson: 4, current_lesson: 3, lessons_per_day: 1 };
  let rows = goalRows(20, 3);
  rows = unslot(rows, 8, { queue_pinned: true, notes: "museum day", scheduled_date: ymd(9), date: ymd(9), scheduled_source: "plan_move" });
  rows = unslot(rows, 10, { minutes_spent: 40 });
  rows = rows.map((r) => (r.lesson_number === 13 ? { ...r, notes: "half done", minutes_spent: 15 } : r));
  rows = rows.map((r) => (r.lesson_number === 16 ? { ...r, queue_pinned: true, scheduled_date: ymd(20), date: ymd(20) } : r));
  const keep = (rs: Row[]) => rs.filter((r) => r.completed || r.notes || r.minutes_spent != null || r.queue_pinned || r.queue_position == null);
  const before = keep(rows);
  let state = save(goal, rows);
  state = save(state.goal, state.rows);
  for (const b of before) {
    const a = state.rows.find((r) => r.id === b.id);
    assert.ok(a, `row for lesson ${b.lesson_number} still exists`);
    assert.equal(a!.completed, b.completed);
    assert.equal(a!.notes, b.notes);
    assert.equal(a!.minutes_spent, b.minutes_spent);
    assert.equal(a!.queue_pinned, b.queue_pinned, `pin on lesson ${b.lesson_number}`);
    if (b.queue_pinned || b.queue_position == null || b.completed) assert.equal(a!.scheduled_date, b.scheduled_date, `date on lesson ${b.lesson_number}`);
  }
  assertWhole(state.rows, 20);
  // A pace change releases pins (Invariant 12) but still keeps every number in its slot.
  const paced = save(state.goal, state.rows, { lessons_per_day: 2 });
  for (const r of paced.rows) if (r.queue_position != null && !r.queue_pinned) assert.equal(r.queue_position, r.lesson_number);
  for (const n of [8, 10]) assert.deepEqual(paced.rows.find((r) => r.lesson_number === n), state.rows.find((r) => r.lesson_number === n), `unslotted ${n} untouched by a pace change`);
});

test("reserved slots: only above the pointer, only when no row holds the slot", () => {
  const rows = [
    { curriculum_goal_id: G, lesson_number: 3, queue_position: null, completed: false },
    { curriculum_goal_id: G, lesson_number: 7, queue_position: null, completed: true },
    { curriculum_goal_id: G, lesson_number: 9, queue_position: null, completed: false },
    { curriculum_goal_id: G, lesson_number: 11, queue_position: 9, completed: false },
    { curriculum_goal_id: G, lesson_number: 12, queue_position: null, completed: false, skipped: true },
    { curriculum_goal_id: "other", lesson_number: 14, queue_position: null, completed: false },
    { curriculum_goal_id: G, lesson_number: null, queue_position: null, completed: false },
  ];
  assert.deepEqual(reservedSlotsFromRows(rows, 5, G).map((h) => h.slot), [7, 12], "3 is behind the pointer, 9 is held by lesson 11");
  for (const h of reservedSlotsFromRows(rows, 5, G)) assert.ok(isSkippedSlot(h), "the projector steps over a reserved slot as it does a skip");
  // The projector ignores a reserved slot at or below the pointer, so a stale
  // reservation can never hide a lesson the queue has not reached.
  const goal: CurriculumGoalConfig = { id: G, school_days: ALL_DAYS, lessons_per_day: 1, lessons_per_day_overrides: null, current_lesson: 5, total_lessons: 10, start_date: null };
  const out = computeNextLessonsForGoal(goal, TODAY, 30, [], 0, [{ slot: 4, skipped: true, reserved: true }, { slot: 7, skipped: true, reserved: true }]);
  assert.deepEqual(out.map((p) => p.lesson_number), [6, 8, 9, 10]);
  assert.deepEqual(out.map((p) => p.date), [ymd(0), ymd(1), ymd(2), ymd(3)], "a reserved slot takes no day");
});

// A chainable stand-in for the supabase client: records each query's filters
// and answers from `respond`.
type Query = { table: string; filters: Array<[string, unknown[]]> };
function fakeClient(respond: (q: Query) => { data: unknown; error: unknown }) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const q: Query = { table, filters: [] };
      queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "in", "or", "order", "limit"]) {
        chain[m] = (...args: unknown[]) => { q.filters.push([m, args]); return chain; };
      }
      chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(respond(q)).then(ok, bad);
      return chain;
    },
  };
  return { client: client as never, queries };
}
const isSlotRead = (q: Query) => q.filters.some(([m]) => m === "in");

test("loadReservationRows: the unslotted rows and their slot holders, and nothing on any doubt", async () => {
  const open = [{ curriculum_goal_id: G, lesson_number: 12, queue_position: null }];
  const holder = [{ curriculum_goal_id: "other", lesson_number: 30, queue_position: 12 }];
  const ok = fakeClient((q) => ({ data: isSlotRead(q) ? holder : open, error: null }));
  assert.deepEqual(await loadReservationRows(ok.client, { userId: "u" }), [...open, ...holder]);
  assert.deepEqual(ok.queries[1].filters.find(([m]) => m === "in")?.[1], ["queue_position", [12]]);
  // No unslotted rows: one read, nothing reserved.
  const none = fakeClient(() => ({ data: [], error: null }));
  assert.deepEqual(await loadReservationRows(none.client, { goalId: G }), []);
  assert.equal(none.queries.length, 1);
  // A failed read or a page that may be truncated reserves NOTHING.
  assert.equal(await loadReservationRows(fakeClient((q) => ({ data: null, error: isSlotRead(q) ? { message: "x" } : null })).client, { userId: "u" }), null);
  assert.equal(await loadReservationRows(fakeClient((q) => (isSlotRead(q) ? { data: null, error: { message: "x" } } : { data: open, error: null })).client, { userId: "u" }), null);
  const full = Array.from({ length: 1000 }, (_, i) => ({ curriculum_goal_id: G, lesson_number: i + 1, queue_position: null }));
  assert.equal(await loadReservationRows(fakeClient(() => ({ data: full, error: null })).client, { userId: "u" }), null);
  const fullHolders = Array.from({ length: 1000 }, (_, i) => ({ curriculum_goal_id: G, lesson_number: i + 100, queue_position: 12 }));
  assert.equal(await loadReservationRows(fakeClient((q) => ({ data: isSlotRead(q) ? fullHolders : open, error: null })).client, { userId: "u" }), null);
});

test("loadPinsByGoal: reserved slots ride with the skips, judged against each goal's own pointer", async () => {
  const lessons = [
    { curriculum_goal_id: G, lesson_number: 12, queue_position: null },
    { curriculum_goal_id: G, lesson_number: 4, queue_position: null },
    { curriculum_goal_id: "g2", lesson_number: 7, queue_position: null },
  ];
  const { client } = fakeClient((q) => {
    if (q.table === "curriculum_goals") return { data: [{ id: G, current_lesson: 10 }, { id: "g2", current_lesson: 2 }], error: null };
    if (q.filters.some(([m]) => m === "or")) return { data: [], error: null };
    if (isSlotRead(q)) return { data: [{ curriculum_goal_id: "g2", lesson_number: 9, queue_position: 7 }], error: null };
    return { data: lessons, error: null };
  });
  const map = await loadPinsByGoal(client, "u");
  assert.deepEqual(map.get(G), [{ slot: 12, skipped: true, reserved: true }], "4 is behind goal 1's pointer");
  assert.equal(map.get("g2"), undefined, "g2's slot 7 is held by another lesson");
  // A failed pointer read reserves nothing and keeps the pins.
  const failed = fakeClient((q) => {
    if (q.table === "curriculum_goals") return { data: null, error: { message: "down" } };
    if (q.filters.some(([m]) => m === "or")) return { data: [], error: null };
    return { data: isSlotRead(q) ? [] : lessons, error: null };
  });
  assert.equal((await loadPinsByGoal(failed.client, "u")).size, 0);
});
