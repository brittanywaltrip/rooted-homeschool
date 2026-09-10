// Unit tests for the catch-up loader. Run with:
//   node --test app/components/PlanV2/loadCatchUpLessons.test.ts
//
// What these guard: the flows used to read the family's uncompleted lessons
// in one unranged request, which PostgREST caps at 1,000 rows without saying
// so. A family with 1,950 scheduled rows got the earliest 1,000 and every
// goal whose open rows fall late in the year vanished from the affected set.
// The loader now pages, and a page that fails is a null, never a short list.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadCatchUpRows,
  archivedGoalFilter,
  type CatchUpClient,
  type CatchUpFilter,
} from "./loadCatchUpLessons.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-09-10";

type Row = {
  id: string;
  user_id: string;
  title: string | null;
  lesson_number: number | null;
  scheduled_date: string | null;
  date: string | null;
  child_id: string | null;
  curriculum_goal_id: string | null;
  completed: boolean;
  queue_pinned: boolean;
};

type Goal = { id: string; user_id: string; archived: boolean };

/** 2,350 uncompleted scheduled rows across 12 goals, spanning the year. */
function bigFamily(): Row[] {
  const rows: Row[] = [];
  const goals = Array.from({ length: 12 }, (_, i) => `goal-${String(i + 1).padStart(2, "0")}`);
  for (let i = 0; i < 2350; i++) {
    // Goals 1-6 hold the early rows and goals 7-12 only the late ones, the
    // shape that made a capped read drop half the curricula.
    const goal = i < 1175 ? goals[i % 6] : goals[6 + (i % 6)];
    const day = new Date(Date.UTC(2026, 7, 1) + i * 6 * 60 * 60 * 1000); // Aug 1 onward, 4 a day
    rows.push({
      id: `l-${i}`,
      user_id: USER,
      title: `Lesson ${i}`,
      lesson_number: i,
      scheduled_date: day.toISOString().slice(0, 10),
      date: null,
      child_id: "kid-1",
      curriculum_goal_id: goal,
      completed: false,
      queue_pinned: false,
    });
  }
  return rows;
}

type FakeOpts = {
  lessons: Row[];
  goals?: Goal[];
  /** Zero-based page index whose range() call errors. */
  failOnPage?: number;
  /** Every page's from/to, for asserting paging happened. */
  ranges?: [number, number][];
};

/**
 * A fake supabase-js client: an in-memory filter over `lessons` and
 * `curriculum_goals` that honours the calls the loader makes, including
 * `.or()` with the archived exclusion and, crucially, `.range()`.
 */
function fakeClient(opts: FakeOpts): CatchUpClient {
  function filterFor(table: string): CatchUpFilter {
    let rows: Record<string, unknown>[] =
      table === "lessons" ? [...opts.lessons] : [...(opts.goals ?? [])];
    const self: CatchUpFilter = {
      eq(col, v) { rows = rows.filter((r) => r[col] === v); return self; },
      not(col, op, v) {
        assert.equal(op, "is"); assert.equal(v, null);
        rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
        return self;
      },
      lt(col, v) { rows = rows.filter((r) => (r[col] as string) < (v as string)); return self; },
      gte(col, v) { rows = rows.filter((r) => (r[col] as string) >= (v as string)); return self; },
      or(filters) {
        const m = filters.match(/^curriculum_goal_id\.is\.null,curriculum_goal_id\.not\.in\.\((.*)\)$/);
        assert.ok(m, `unexpected or() filter: ${filters}`);
        const excluded = new Set(m![1].split(","));
        rows = rows.filter((r) => r.curriculum_goal_id === null || !excluded.has(r.curriculum_goal_id as string));
        return self;
      },
      order(col, o) {
        const asc = o?.ascending !== false;
        rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
        return self;
      },
      range(from, to) {
        opts.ranges?.push([from, to]);
        const page = Math.floor(from / (to - from + 1));
        if (opts.failOnPage === page) {
          return Promise.resolve({ data: null, error: { message: `page ${page} timed out` } });
        }
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      then(onFulfilled, onRejected) {
        // An unranged await: the whole set, the way a real client answers.
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return self;
  }
  return { from: (table) => ({ select: () => filterFor(table) }) };
}

test("2,350 rows across three pages: future holds every goal id in the source", async () => {
  const lessons = bigFamily();
  const ranges: [number, number][] = [];
  const sets = await loadCatchUpRows(fakeClient({ lessons, ranges }), { userId: USER, todayStr: TODAY });
  assert.ok(sets, "the load succeeds");

  const sourceFuture = lessons.filter((r) => r.scheduled_date! >= TODAY);
  const sourceMissed = lessons.filter((r) => r.scheduled_date! < TODAY);
  assert.equal(sets.future.length, sourceFuture.length, "no row past 1,000 is dropped");
  assert.equal(sets.missed.length, sourceMissed.length);
  assert.equal(sets.future.length + sets.missed.length, 2350);

  const wantGoals = new Set(sourceFuture.map((r) => r.curriculum_goal_id));
  const gotGoals = new Set(sets.future.map((r) => r.curriculum_goal_id));
  assert.deepEqual([...gotGoals].sort(), [...wantGoals].sort(), "every goal with an open row is affected");
  assert.ok(gotGoals.has("goal-12"), "the goal whose rows all fall late in the year is present");

  // The future half really was paged: three full pages of 1,000 plus the
  // short page that ends the walk.
  const futurePages = ranges.filter(([from]) => from === 0).length;
  assert.ok(futurePages >= 2, "both halves start at offset 0");
  assert.ok(ranges.some(([from]) => from === 1000), "a second page was requested");
  assert.ok(ranges.some(([from]) => from === 2000), "a third page was requested");
});

test("a page that errors makes the whole load null, never a short list", async () => {
  const lessons = bigFamily();
  const sets = await loadCatchUpRows(fakeClient({ lessons, failOnPage: 1 }), { userId: USER, todayStr: TODAY });
  assert.equal(sets, null);
});

test("an archived goal's rows stay out, a standalone lesson stays in", async () => {
  const lessons = bigFamily().slice(0, 30);
  lessons.push({
    ...lessons[0],
    id: "standalone",
    curriculum_goal_id: null,
    scheduled_date: "2026-09-20",
  });
  const goals: Goal[] = [
    { id: "goal-01", user_id: USER, archived: true },
    { id: "goal-02", user_id: USER, archived: false },
  ];
  const sets = await loadCatchUpRows(fakeClient({ lessons, goals }), { userId: USER, todayStr: TODAY });
  assert.ok(sets);
  const all = [...sets.missed, ...sets.future];
  assert.ok(all.every((r) => r.curriculum_goal_id !== "goal-01"), "archived goal excluded");
  assert.ok(all.some((r) => r.id === "standalone"), "no-goal lesson kept");
});

test("the split is at today: missed strictly before, future today or later", async () => {
  const lessons = bigFamily().slice(0, 12).map((r, i) => ({
    ...r,
    scheduled_date: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"][i % 4],
  }));
  const sets = await loadCatchUpRows(fakeClient({ lessons }), { userId: USER, todayStr: TODAY });
  assert.ok(sets);
  assert.ok(sets.missed.every((r) => r.scheduled_date! < TODAY));
  assert.ok(sets.future.every((r) => r.scheduled_date! >= TODAY));
  assert.equal(sets.missed.length, 6);
  assert.equal(sets.future.length, 6);
});

test("archivedGoalFilter keeps the IS NULL branch so standalone lessons survive", () => {
  assert.equal(archivedGoalFilter([]), null);
  assert.equal(
    archivedGoalFilter(["a", "b"]),
    "curriculum_goal_id.is.null,curriculum_goal_id.not.in.(a,b)",
  );
});
