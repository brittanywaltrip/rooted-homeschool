// The Monday email's sentences.
//
// Run with: node --test lib/weekly-summary.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { GROWTH_STAGES } from "../app/lib/garden-stages.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifyWeeklyRecipient,
  dateInZone,
  gardenLine,
  hadAQuietWeek,
  isoWeekStart,
  lessonsLine,
  memoriesLine,
  memoriesVariable,
  safeTimeZone,
  weeklySubject,
  weekWindow,
  WINBACK_QUIET_DAYS,
} from "./weekly-summary.ts";

test("lessons: one child, two children, three children", () => {
  assert.equal(lessonsLine([{ name: "Zoe", count: 9 }]), "Last week Zoe finished 9 lessons.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 9 }, { name: "Emma", count: 8 }]),
    "Last week Zoe finished 9 lessons and Emma finished 8 lessons.",
  );
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 9 }, { name: "Emma", count: 8 }, { name: "Sam", count: 3 }]),
    "Last week Zoe finished 9 lessons, Emma finished 8 lessons, and Sam finished 3 lessons.",
  );
});

test("lessons: one lesson is singular, and a child with none is left out", () => {
  assert.equal(lessonsLine([{ name: "Zoe", count: 1 }]), "Last week Zoe finished 1 lesson.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 4 }, { name: "Emma", count: 0 }]),
    "Last week Zoe finished 4 lessons.",
  );
  assert.equal(lessonsLine([{ name: "  ", count: 4 }]), "Last week your family finished 4 lessons.");
});

test("lessons: unassigned lessons are 'your family' only when no child has any", () => {
  assert.equal(lessonsLine([], 6), "Last week your family finished 6 lessons.");
  assert.equal(lessonsLine([], 1), "Last week your family finished 1 lesson.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 2 }], 6),
    "Last week Zoe finished 2 lessons.",
    "the child is the story; the unattributed rows are not a second clause",
  );
  assert.equal(lessonsLine([], 0), "");
  assert.equal(lessonsLine([{ name: "Zoe", count: 0 }], 0), "");
});

test("memories: order is photos, wins, books, drawings, then everything else", () => {
  assert.equal(memoriesLine({ photo: 2, win: 1 }), "You captured 2 photos and 1 win.");
  assert.equal(memoriesLine({ drawing: 1, book: 2, photo: 3 }), "You captured 3 photos, 2 books, and 1 drawing.");
  assert.equal(memoriesLine({ moment: 2 }), "You captured 2 wins.", "'moment' is a win by another name");
  assert.equal(
    memoriesLine({ photo: 1, project: 1, field_trip: 2 }),
    "You captured 1 photo and 3 memories.",
    "types with no word of their own are counted together",
  );
  assert.equal(memoriesLine({ project: 1 }), "You captured 1 memory.");
});

test("memories: no memories is an empty string, and no stray space either way", () => {
  assert.equal(memoriesLine({}), "");
  assert.equal(memoriesLine({ photo: 0, win: 0 }), "");
  const lessons = "Last week Zoe finished 9 lessons.";
  assert.equal(memoriesVariable("", lessons), "");
  assert.equal(memoriesVariable("You captured 2 photos.", lessons), " You captured 2 photos.");
  assert.equal(
    memoriesVariable("You captured 2 photos.", ""),
    "You captured 2 photos.",
    "with no lessons sentence it opens the paragraph and takes no leading space",
  );
});

test("garden: the article table, stage by stage", () => {
  // Written out, not derived: "a Growing" and "a Flourishing" are both wrong.
  const expected: Record<string, string> = {
    Seed: "a Seed",
    Sprouting: "Sprouting",
    Seedling: "a Seedling",
    Growing: "Growing",
    "Young Tree": "a Young Tree",
    Flourishing: "Flourishing",
    Blossoming: "Blossoming",
    "Bearing Fruit": "Bearing Fruit",
  };
  for (const stage of GROWTH_STAGES) {
    const line = gardenLine([{ name: "Zoe", leaves: stage.min }]);
    assert.ok(
      line.startsWith(`Zoe's tree is ${expected[stage.name]}`),
      `${stage.name}: got ${JSON.stringify(line)}`,
    );
  }
});

test("garden: the countdown to the next stage, and none at the top", () => {
  assert.equal(gardenLine([{ name: "Zoe", leaves: 46 }]), "Zoe's tree is Growing, 4 leaves from Young Tree.");
  assert.equal(gardenLine([{ name: "Emma", leaves: 13 }]), "Emma's tree is a Seedling, 12 leaves from Growing.");
  assert.equal(gardenLine([{ name: "Sam", leaves: 49 }]), "Sam's tree is Growing, 1 leaf from Young Tree.");
  assert.equal(gardenLine([{ name: "Zoe", leaves: 500 }]), "Zoe's tree is Bearing Fruit.");
  assert.equal(gardenLine([{ name: "Zoe", leaves: 900 }]), "Zoe's tree is Bearing Fruit.");
});

test("garden: several children, a name ending in s, and no children at all", () => {
  assert.equal(
    gardenLine([{ name: "Zoe", leaves: 46 }, { name: "Emma", leaves: 13 }]),
    "Zoe's tree is Growing, 4 leaves from Young Tree. Emma's tree is a Seedling, 12 leaves from Growing.",
  );
  assert.equal(gardenLine([{ name: "Wells", leaves: 0 }]), "Wells' tree is a Seed, 1 leaf from Sprouting.");
  assert.equal(gardenLine([]), "");
  assert.equal(gardenLine([{ name: "   ", leaves: 5 }]), "");
});

test("subject: counts, singulars, and no memories half at zero", () => {
  assert.equal(weeklySubject(9, 3), "Your week with Rooted: 9 lessons, 3 memories");
  assert.equal(weeklySubject(1, 1), "Your week with Rooted: 1 lesson, 1 memory");
  assert.equal(weeklySubject(4, 0), "Your week with Rooted: 4 lessons");
  assert.equal(
    weeklySubject(0, 2),
    "Your week with Rooted: 2 memories",
    "the full email goes out for lessons OR memories, so a zero half is left out",
  );
  assert.equal(weeklySubject(0, 0), "Your week with Rooted");
});

test("the week is the Monday to Sunday before the send, in her timezone", () => {
  // Monday 2026-09-21, 15:00 UTC: the send. In Chicago it is still Monday.
  const send = new Date("2026-09-21T15:00:00Z");
  assert.deepEqual(weekWindow(send, "America/Chicago"), { start: "2026-09-14", end: "2026-09-20" });
  assert.deepEqual(weekWindow(send, "America/Los_Angeles"), { start: "2026-09-14", end: "2026-09-20" });
  // Auckland is already Tuesday, and the week just ended is still the same one.
  assert.equal(dateInZone(send, "Pacific/Auckland"), "2026-09-22");
  assert.deepEqual(weekWindow(send, "Pacific/Auckland"), { start: "2026-09-14", end: "2026-09-20" });
  // A manual run mid-week still reports the last whole week.
  assert.deepEqual(weekWindow(new Date("2026-09-24T12:00:00Z"), "America/Chicago"), {
    start: "2026-09-14",
    end: "2026-09-20",
  });
});

test("the dedup key is the Monday of the send's own week", () => {
  assert.equal(isoWeekStart(new Date("2026-09-21T15:00:00Z"), "America/Chicago"), "2026-09-21");
  assert.equal(isoWeekStart(new Date("2026-09-24T12:00:00Z"), "America/Chicago"), "2026-09-21");
  assert.equal(isoWeekStart(new Date("2026-09-28T15:00:00Z"), "America/Chicago"), "2026-09-28");
});

test("a broken timezone falls back to US Pacific, and a quiet week is lessons and memories both zero", () => {
  assert.equal(safeTimeZone("Mars/Olympus"), "America/Los_Angeles");
  assert.equal(safeTimeZone(null), "America/Los_Angeles");
  assert.equal(safeTimeZone("Pacific/Auckland"), "Pacific/Auckland");
  assert.equal(hadAQuietWeek(0, 0), true);
  assert.equal(hadAQuietWeek(1, 0), false);
  assert.equal(hadAQuietWeek(0, 1), false);
});

/* ── Who gets Monday's email ───────────────────────────────────────────────
 * The audience was 14 days, so a family who took a fortnight off stopped
 * hearing from Rooted at all: the win-back only starts at day 14 and goes once,
 * ever. Thirty days covers a normal break.
 * ─────────────────────────────────────────────────────────────────────── */

const SEND = new Date("2026-09-21T15:00:00Z"); // Monday
const ZONE = "America/Chicago";
const daysBefore = (n: number) =>
  new Date(Date.UTC(2026, 8, 21) - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function verdict(over: Partial<Parameters<typeof classifyWeeklyRecipient>[0]> = {}) {
  return classifyWeeklyRecipient({
    lastActiveDate: daysBefore(2),
    now: SEND,
    timeZone: ZONE,
    weekLessons: 0,
    weekMemories: 0,
    recentWinback: false,
    sentThisWeek: false,
    ...over,
  });
}

test("audience: active this week is full, active 20 days ago with a quiet week is quiet", () => {
  assert.equal(verdict({ lastActiveDate: daysBefore(2), weekLessons: 9, weekMemories: 2 }), "full");
  assert.equal(verdict({ lastActiveDate: daysBefore(2), weekLessons: 0, weekMemories: 1 }), "full");
  assert.equal(verdict({ lastActiveDate: daysBefore(20), weekLessons: 0, weekMemories: 0 }), "quiet");
});

test("audience: 35 days quiet gets neither, and 30 days is still in", () => {
  assert.equal(verdict({ lastActiveDate: daysBefore(35) }), "too_stale");
  assert.equal(verdict({ lastActiveDate: daysBefore(30) }), "quiet", "the 30th day is inside the window");
  assert.equal(verdict({ lastActiveDate: daysBefore(31) }), "too_stale");
  assert.equal(verdict({ lastActiveDate: null }), "too_stale");
});

test("audience: a win-back in the last 7 days wins, an older one does not", () => {
  // The route reads email_log for the last WINBACK_QUIET_DAYS and passes the
  // answer in; three days ago is inside that read, ten days ago is not.
  assert.equal(verdict({ recentWinback: true, weekLessons: 5 }), "recent_winback");
  assert.equal(verdict({ recentWinback: false, weekLessons: 5 }), "full", "a win-back 10 days ago is not in the way");
  assert.equal(WINBACK_QUIET_DAYS, 7);
});

test("audience: one Monday email per family per week", () => {
  assert.equal(verdict({ sentThisWeek: true, weekLessons: 5 }), "already_sent");
  assert.equal(verdict({ sentThisWeek: true, recentWinback: true }), "recent_winback", "the win-back reason comes first");
});

test("the route sends the quiet template on a quiet week and logs user ids only", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/weekly-summary/route.ts"), "utf8");
  assert.match(route, /authorization'\) !== `Bearer \$\{process\.env\.CRON_SECRET\}`/);
  assert.match(route, /TEMPLATES\.weeklySummaryQuiet/);
  assert.match(route, /TEMPLATES\.weeklySummary,/);
  assert.match(route, /canSendMarketingEmail\(userId, 'weekly_summary', supabase\)/);
  assert.match(route, /skippedRecentWinback/);
  assert.match(route, /eq\('email_type', WINBACK_EMAIL_TYPE\)/);
  assert.ok(!/\$\{email\}/.test(route.replace(/encodeURIComponent\(email\)/g, "")), "no address in a log line");
  assert.ok(!/testOnly/.test(route), "the unused test POST is retired");
});

test("route: every bulk read fails closed, and nothing is dropped in silence", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/weekly-summary/route.ts"), "utf8");
  // A read that failed is not a read that found nothing.
  assert.match(route, /if \(error\) return readFailed\('profiles'\)/);
  assert.match(route, /if \(error\) return readFailed\('auth users'\)/);
  assert.match(route, /if \(weeklyErr \|\| winsErr\) return readFailed\('email_log'\)/);
  assert.match(route, /if \(!lessons \|\| !memories\) return readFailed\('activity'\)/);
  // A family left behind by the budget never catches up: this send is weekly.
  assert.match(route, /\{ deferred\+\+; return \}/);
  assert.match(route, /has4xx \|\| logWriteFailures > 0 \|\| deferred > 0/);
  // One family's throw is not the whole Monday.
  assert.match(route, /await sendOne\(userId\)\s*\} catch/);
  // The week's rows are bucketed once, not re-scanned per family.
  assert.match(route, /const lessonsByUser = new Map<string, LessonRow\[\]>\(\)/);
  assert.match(route, /\(lessonsByUser\.get\(userId\) \?\? \[\]\)\.filter/);
  // An archived child still did last week's lessons.
  assert.match(route, /const perChild = allChildren\.map/);
  assert.match(route, /!knownChildIds\.has\(l\.child_id\)/);
  // One definition of the quiet subject, shared with the template script.
  assert.match(route, /WEEKLY_QUIET_SUBJECT,/);
});
