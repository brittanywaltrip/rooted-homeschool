// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  augustYearOf,
  chooseYearbookKey,
  currentKeyLast,
  yearbookKeyCandidates,
  fallbackSchoolYear,
  getCurrentSchoolYear,
  isInSchoolYear,
  resolveSchoolYear,
  schoolYearQuarters,
  quarterLabel,
  schoolYearWindowForRow,
  yearbookContentYearFilter,
  type SchoolYearWindow,
} from "./school-year.ts";

/**
 * A stand-in for the one read getCurrentSchoolYear makes. It records the
 * filters so the test can see the query asks for the newest ACTIVE row of THIS
 * user, and hands back whatever row the case wants.
 */
function fakeClient(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const calls: { table?: string; filters: [string, unknown][]; order?: [string, unknown] } = { filters: [] };
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { calls.filters.push([col, val]); return chain; },
    order: (col: string, opts: unknown) => { calls.order = [col, opts]; return chain; },
    limit: () => chain,
    maybeSingle: async () => ({ data: row, error }),
  };
  const client = { from: (table: string) => { calls.table = table; return chain; } };
  // The helper only touches the query builder, so the cast is safe here.
  return { client: client as unknown as Parameters<typeof getCurrentSchoolYear>[0], calls };
}

const ACTIVE = {
  id: "sy-2026",
  name: "2026-2027",
  start_date: "2026-09-11",
  end_date: "2027-05-31",
  created_at: null,
};

test("the active row wins", async () => {
  const { client, calls } = fakeClient(ACTIVE);
  const y = await getCurrentSchoolYear(client, "user-1", "2026-09-13");
  assert.deepEqual(y, { id: "sy-2026", name: "2026-2027", start: "2026-09-11", end: "2027-05-31" });
  assert.equal(calls.table, "school_years");
  assert.deepEqual(calls.filters, [["user_id", "user-1"], ["status", "active"]]);
  assert.deepEqual(calls.order, ["created_at", { ascending: false }], "newest active row first");
});

test("no active row falls back to August 1", async () => {
  const { client } = fakeClient(null);
  assert.deepEqual(await getCurrentSchoolYear(client, "user-1", "2026-09-13"), {
    id: null, name: "2026-2027", start: "2026-08-01", end: "2027-07-31",
  });
  // Before August the school year is still last year's.
  assert.deepEqual(await getCurrentSchoolYear(client, "user-1", "2026-07-31"), {
    id: null, name: "2025-2026", start: "2025-08-01", end: "2026-07-31",
  });
});

test("a failed read falls back rather than showing nothing", async () => {
  const { client } = fakeClient(null, { message: "boom" });
  assert.equal((await getCurrentSchoolYear(client, "user-1", "2026-09-13")).start, "2026-08-01");
});

test("a date on the start day and on the end day are in; the day after the end is out", () => {
  const y: SchoolYearWindow = { id: "sy", name: "2026-2027", start: "2026-09-11", end: "2027-05-31" };
  assert.equal(isInSchoolYear("2026-09-11", y), true, "start day");
  assert.equal(isInSchoolYear("2027-05-31", y), true, "end day");
  assert.equal(isInSchoolYear("2027-06-01", y), false, "day after the end");
  assert.equal(isInSchoolYear("2026-09-10", y), false, "day before the start");
  assert.equal(isInSchoolYear("2026-10-01T15:00:00Z", y), true, "a timestamp is judged by its date part");
  assert.equal(isInSchoolYear("", y), false);
});

test("the fallback matches the old hardcoded August 1 on every month boundary", () => {
  assert.equal(augustYearOf("2026-08-01"), 2026);
  assert.equal(augustYearOf("2026-07-31"), 2025);
  assert.equal(augustYearOf("2027-01-15"), 2026);
  assert.equal(fallbackSchoolYear("2026-12-31").start, "2026-08-01");
  assert.equal(fallbackSchoolYear("2026-12-31").name, "2026-2027", "hyphen, never an en dash");
});

test("a memory from the day a year was created is in it, even before its start date", () => {
  // Closing on Aug 20 with a new year starting Sep 1, or onboarding in August
  // with a September start: the photo taken that day belongs to this year.
  const y = resolveSchoolYear({
    active: { ...ACTIVE, start_date: "2026-09-01" },
    createdYmd: "2026-08-20",
    today: "2026-08-25",
  });
  assert.equal(y.start, "2026-08-20");
  assert.equal(isInSchoolYear("2026-08-20", y), true);
  assert.equal(isInSchoolYear("2026-08-19", y), false, "the day before the close is last year's");
});

test("a close on the start day does not reach back into last year", () => {
  const y = resolveSchoolYear({ active: ACTIVE, createdYmd: "2026-09-11", today: "2026-09-13" });
  assert.equal(y.start, "2026-09-11");
  // A backfilled row created after its start date keeps its start date.
  assert.equal(resolveSchoolYear({ active: ACTIVE, createdYmd: "2026-09-14", today: "2026-09-14" }).start, "2026-09-11");
});

test("the year runs until the family closes it, not until its end_date", () => {
  const y = resolveSchoolYear({ active: ACTIVE, createdYmd: null, today: "2027-06-20" });
  assert.equal(y.end, "2027-06-20", "a June memory in a year that said May 31 is still this year's");
  assert.equal(isInSchoolYear("2027-06-20", y), true);
  assert.equal(isInSchoolYear("2027-06-21", y), false);
});

test("yearbook content for this year is unstamped rows plus this year's own", () => {
  assert.equal(yearbookContentYearFilter({ id: "abc" }), "school_year_id.is.null,school_year_id.eq.abc");
  assert.equal(yearbookContentYearFilter({ id: null }), "school_year_id.is.null");
});

test("there is one definition of this year: no hardcoded August 1 school-year math left", () => {
  // Each of these computed its own August 1. They read app/lib/school-year.ts now.
  const files = [
    "app/dashboard/page.tsx",
    "app/dashboard/memories/yearbook/read/page.tsx",
    "app/dashboard/reports/page.tsx",
    "app/dashboard/printables/page.tsx",
    "app/components/printables/FirstDayFrameEditor.tsx",
    "lib/progress-report.ts",
    "lib/award-unlocks.ts",
  ];
  for (const f of files) {
    const src = readFileSync(resolve(import.meta.dirname, "..", "..", f), "utf8");
    assert.ok(!/schoolYearStartMonth/.test(src), `${f} still defines schoolYearStartMonth`);
    assert.ok(!/-08-01`/.test(src), `${f} still builds an August 1 date`);
    assert.ok(!/getMonth\(\)\s*(>=|<)\s*[67]\b/.test(src), `${f} still decides the school year by month`);
  }
});

test("the yearbook key stays put until a close has stamped it, then moves to this year's", () => {
  const schoolYear = { start: "2026-08-16" };
  // Never closed: the opened_at key, exactly as before.
  assert.equal(chooseYearbookKey({ openedAt: "2025-10-02T14:00:00+00:00", schoolYear, closedKeys: new Set() }), "2025-26");
  // Closed: last year's rows are stamped, so this year's book gets its own key
  // instead of the editor overwriting them.
  assert.equal(chooseYearbookKey({ openedAt: "2025-10-02T14:00:00+00:00", schoolYear, closedKeys: new Set(["2025-26"]) }), "2026-27");
  // Never opened: keyed from the school year's start.
  assert.equal(chooseYearbookKey({ openedAt: null, schoolYear, closedKeys: new Set() }), "2026-27");
  assert.deepEqual(yearbookKeyCandidates("2025-10-02T14:00:00+00:00", schoolYear), ["2025-26", "2026-27"]);
});

test("after a key move, this year's rows win over text carried from the old key", () => {
  const rows = [
    { yearbook_key: "2026-27", content_type: "family_name", content: "The Waltrips" },
    { yearbook_key: "2025-26", content_type: "family_name", content: "Waltrip" },
    { yearbook_key: "2025-26", content_type: "letter_from_home", content: "Dear kids" },
  ];
  const map: Record<string, string> = {};
  for (const r of currentKeyLast(rows, "2026-27")) map[r.content_type] = r.content;
  assert.deepEqual(map, { family_name: "The Waltrips", letter_from_home: "Dear kids" });
});

test("the reader, the editor and Today share one yearbook key rule", () => {
  for (const f of ["app/dashboard/page.tsx", "app/dashboard/memories/yearbook/read/page.tsx", "app/dashboard/memories/yearbook/edit/page.tsx"]) {
    const src = readFileSync(resolve(import.meta.dirname, "..", "..", f), "utf8");
    assert.match(src, /resolveYearbookKey\(/, `${f} resolves the key through the shared rule`);
    assert.ok(!/startYear = m >= 7/.test(src) && !/ybOpenedMonth >= 7/.test(src), `${f} still derives its own key`);
  }
});

// ── Progress report quarters: four equal slices of the family's own year ──────

function everyDay(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (;;) {
    const ymd = d.toISOString().slice(0, 10);
    if (ymd > end) break;
    out.push(ymd);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function coveredOnce(start: string, end: string) {
  const quarters = schoolYearQuarters({ start, end });
  assert.equal(quarters.length, 4);
  assert.equal(quarters[0].start, start, "Q1 starts on the year's first day");
  assert.equal(quarters[3].end, end, "Q4 ends on the year's last day");
  for (let i = 1; i < 4; i++) {
    const prevEnd = new Date(`${quarters[i - 1].end}T12:00:00Z`);
    prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
    assert.equal(quarters[i].start, prevEnd.toISOString().slice(0, 10), `Q${i + 1} starts the day after Q${i} ends`);
  }
  for (const day of everyDay(start, end)) {
    const hits = quarters.filter((q) => day >= q.start && day <= q.end).length;
    assert.equal(hits, 1, `${day} is in exactly one quarter`);
  }
  return quarters;
}

test("a Sep 1 to May 29 year gives four quarters covering every day exactly once", () => {
  const q = coveredOnce("2025-09-01", "2026-05-29");
  // 271 days: 67, 67, 67 and the remainder, 70.
  assert.deepEqual(q, [
    { start: "2025-09-01", end: "2025-11-06" },
    { start: "2025-11-07", end: "2026-01-12" },
    { start: "2026-01-13", end: "2026-03-20" },
    { start: "2026-03-21", end: "2026-05-29" },
  ]);
  assert.equal(quarterLabel(1, q[1]), "Q2 · Nov 7 to Jan 12");
  assert.ok(!/[–—]/.test(quarterLabel(1, q[1])), "no dashes in the label");
});

test("a year containing Feb 29 includes it, in exactly one quarter", () => {
  const q = coveredOnce("2027-08-16", "2028-06-02");
  assert.equal(q.filter((x) => "2028-02-29" >= x.start && "2028-02-29" <= x.end).length, 1);
});

test("the report dialog and the report cut quarters from the same window", () => {
  const row = { id: "y", name: "2025-2026", start_date: "2025-09-01", end_date: "2026-05-29", created_at: "2025-08-20T15:00:00Z" };
  const w = schoolYearWindowForRow(row, "2025-10-01");
  assert.equal(w.id, "y");
  assert.equal(w.end, "2026-05-29");
  const report = readFileSync(resolve(import.meta.dirname, "..", "..", "lib/progress-report.ts"), "utf8");
  assert.match(report, /schoolYearQuarters\(schoolYear\)\[quarterIndex\]/);
  assert.ok(!report.includes("-02-28"), "no hardcoded February end");
  const dialog = readFileSync(resolve(import.meta.dirname, "..", "components/PlanV2/ProgressReportDialog.tsx"), "utf8");
  assert.match(dialog, /quarterLabel\(i, q\)/);
  const plan = readFileSync(resolve(import.meta.dirname, "..", "components/PlanV2/index.tsx"), "utf8");
  assert.match(plan, /schoolYear=\{schoolYearWindowForRow\(schoolYears\.active\)\}/);
});
