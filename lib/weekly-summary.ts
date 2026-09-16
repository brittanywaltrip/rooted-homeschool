// The Monday email's three sentences.
//
// The old one sampled: it took the TITLE of the first completed lesson per
// child and read "Last week: Zoe finished The Good and the Beautiful Math 3 -
// Lesson 43 and 2 photos saved." A family that did 18 lessons was told about
// one of them, and a family that did none was told it had been a great week.
// These count the same rows instead.
//
// Pure on purpose: no Supabase, no clock of their own, no "@/" imports, so
// node --test runs them directly and the wording is checked without a database.
// app/api/cron/weekly-summary/route.ts does the reading.

import { getGrowthStage, getGrowthStageIndex, GROWTH_STAGES } from "../app/lib/garden-stages.ts";
import { joinNames, possessive } from "../app/lib/garden-config.ts";

// www, not the apex: the apex 308-redirects, and a redirect on an email click
// is a hop that some clients handle worse than others.
export const WEEKLY_TODAY_URL = "https://www.rootedhomeschoolapp.com/dashboard";
/** The quiet email's subject. The route sends it; the template carries a copy. */
export const WEEKLY_QUIET_SUBJECT = "A quiet week is still a week";
export const WEEKLY_EMAIL_TYPE = "weekly_summary";
export const WINBACK_EMAIL_TYPE = "winback";
/** A family who got a win-back this many days ago is left alone this Monday. */
export const WINBACK_QUIET_DAYS = 7;
export const MAX_WEEKLY_SENDS_PER_RUN = 300;
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

/** A timezone Intl will accept, or US Pacific. */
export function safeTimeZone(tz: string | null | undefined): string {
  const name = (tz ?? "").trim();
  if (!name) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name }).format(new Date());
    return name;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a timezone. */
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 1 = Monday .. 7 = Sunday, for a YYYY-MM-DD. */
function isoWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/**
 * The week the email is about: the seven days Monday to Sunday BEFORE the send,
 * in the family's own timezone. Sent on a Monday, that is the week just ended.
 * Sent on any other day (a manual run), it is still the last whole Mon to Sun.
 */
export function weekWindow(now: Date, timeZone: string): { start: string; end: string } {
  const today = dateInZone(now, timeZone);
  const thisMonday = addDaysYmd(today, -(isoWeekday(today) - 1));
  const end = addDaysYmd(thisMonday, -1);
  return { start: addDaysYmd(end, -6), end };
}

/** The Monday of the ISO week an instant falls in, for the once-a-week dedup. */
export function isoWeekStart(now: Date, timeZone: string): string {
  const today = dateInZone(now, timeZone);
  return addDaysYmd(today, -(isoWeekday(today) - 1));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type ChildLessonCount = { name: string; count: number };

/**
 * "Last week Zoe finished 9 lessons and Emma finished 8."
 *
 * Children with nothing are left out. Lessons with no child of their own are
 * "your family", and only when no named child did anything, so a family who
 * logs some lessons against a child and some against nobody reads about the
 * child rather than about both.
 */
export function lessonsLine(
  perChild: readonly ChildLessonCount[],
  unassigned = 0,
): string {
  const named = perChild.filter((c) => c.count > 0 && c.name.trim().length > 0);
  // A child row with a blank name cannot be read out, but its lessons still
  // happened: they join the unattributed pile rather than disappearing.
  const nameless = perChild
    .filter((c) => c.count > 0 && c.name.trim().length === 0)
    .reduce((sum, c) => sum + c.count, 0);
  if (named.length === 0) {
    const total = Math.max(0, unassigned) + nameless;
    if (total <= 0) return "";
    return `Last week your family finished ${plural(total, "lesson")}.`;
  }
  const clauses = named.map((c) => `${c.name.trim()} finished ${plural(c.count, "lesson")}`);
  return `Last week ${joinNames(clauses)}.`;
}

/** memories.type values that get their own word, in the order they are read out. */
const MEMORY_WORDS: { match: (type: string) => boolean; one: string }[] = [
  { match: (t) => t === "photo", one: "photo" },
  { match: (t) => t === "win" || t === "moment", one: "win" },
  { match: (t) => t === "book", one: "book" },
  { match: (t) => t === "drawing", one: "drawing" },
];

/**
 * "You captured 2 photos and 1 win."
 *
 * Photos, wins, books, drawings, then everything else counted together as
 * "memories". Empty string when the week held none, which the caller turns into
 * an empty template variable (see memoriesVariable).
 */
export function memoriesLine(byType: Readonly<Record<string, number>>): string {
  const parts: string[] = [];
  let other = 0;
  for (const [type, count] of Object.entries(byType)) {
    if (!count || count <= 0) continue;
    if (!MEMORY_WORDS.some((w) => w.match(type))) other += count;
  }
  for (const word of MEMORY_WORDS) {
    let n = 0;
    for (const [type, count] of Object.entries(byType)) {
      if (count > 0 && word.match(type)) n += count;
    }
    if (n > 0) parts.push(plural(n, word.one));
  }
  if (other > 0) parts.push(plural(other, "memory", "memories"));
  if (parts.length === 0) return "";
  return `You captured ${joinNames(parts)}.`;
}

/**
 * The memories sentence as the template wants it: with the space that separates
 * it from the lessons sentence, and nothing at all when there is nothing to say.
 *
 * The space lives here rather than in the template so a blank variable leaves no
 * trailing space in the paragraph and no line ending in a space in the text
 * part. When the lessons sentence is empty (a week of memories and no lessons),
 * the memories sentence opens the paragraph and takes no leading space.
 */
export function memoriesVariable(memories: string, lessons: string): string {
  if (!memories) return "";
  return lessons ? ` ${memories}` : memories;
}

/**
 * The article before a growth stage name. Written out rather than derived,
 * because "a Growing" and "Bearing Fruit's tree" are both wrong and a rule
 * guessed from the first letter gets one of them.
 */
const STAGE_ARTICLE: Record<string, string> = {
  Seed: "a ",
  Sprouting: "",
  Seedling: "a ",
  Growing: "",
  "Young Tree": "a ",
  Flourishing: "",
  Blossoming: "",
  "Bearing Fruit": "",
};

export type ChildLeaves = { name: string; leaves: number };

/**
 * "Zoe's tree is Growing, 4 leaves from Young Tree. Emma's tree is a Seedling,
 * 12 leaves from Growing."
 *
 * Leaves are countLeaves for the current school year, the same number the
 * Garden page shows, so the email and the app never disagree. At the top stage
 * there is nothing to count down to: "Zoe's tree is Bearing Fruit."
 */
export function gardenLine(children: readonly ChildLeaves[]): string {
  const named = children.filter((c) => c.name.trim().length > 0);
  if (named.length === 0) return "";
  return named
    .map((c) => {
      const leaves = Math.max(0, c.leaves);
      const index = getGrowthStageIndex(leaves);
      const stage = getGrowthStage(leaves);
      const whose = `${possessive(c.name.trim())} tree`;
      const next = GROWTH_STAGES[index + 1];
      if (!next) return `${whose} is ${STAGE_ARTICLE[stage.name] ?? ""}${stage.name}.`;
      const toGo = Math.max(0, next.min - leaves);
      return `${whose} is ${STAGE_ARTICLE[stage.name] ?? ""}${stage.name}, ${plural(toGo, "leaf", "leaves")} from ${next.name}.`;
    })
    .join(" ");
}

/**
 * "Your week with Rooted: 9 lessons, 3 memories". A half that is zero is left
 * out entirely: the full email goes out for lessons OR memories, so a week of
 * two photos and no lessons must not be announced as "0 lessons, 2 memories".
 */
export function weeklySubject(lessons: number, memories: number): string {
  const parts: string[] = [];
  if (lessons > 0) parts.push(plural(lessons, "lesson"));
  if (memories > 0) parts.push(plural(memories, "memory", "memories"));
  if (parts.length === 0) return "Your week with Rooted";
  return `Your week with Rooted: ${parts.join(", ")}`;
}

/** How many days of quiet still count as an audience for the Monday email. */
export const WEEKLY_AUDIENCE_DAYS = 30;

export type WeeklyVerdict = "full" | "quiet" | "too_stale" | "recent_winback" | "already_sent";

/**
 * What this family gets on Monday, and why.
 *
 * The audience used to be 14 days, which meant a family who took a fortnight
 * off stopped hearing from Rooted entirely: the win-back email only starts at
 * day 14 and goes once, ever. Thirty days keeps the Monday note going through a
 * normal break. A family who got a win-back in the last week is left alone, so
 * the two never land together.
 */
export function classifyWeeklyRecipient(args: {
  /** Newest activity date (a memory's date or a completed lesson's scheduled_date). */
  lastActiveDate: string | null;
  now: Date;
  timeZone: string;
  weekLessons: number;
  weekMemories: number;
  recentWinback: boolean;
  sentThisWeek: boolean;
  audienceDays?: number;
}): WeeklyVerdict {
  if (args.recentWinback) return "recent_winback";
  if (args.sentThisWeek) return "already_sent";
  const days = args.audienceDays ?? WEEKLY_AUDIENCE_DAYS;
  const today = dateInZone(args.now, args.timeZone);
  const cutoff = addDaysYmd(today, -days);
  if (!args.lastActiveDate || args.lastActiveDate < cutoff) return "too_stale";
  return hadAQuietWeek(args.weekLessons, args.weekMemories) ? "quiet" : "full";
}

/** Did this family do anything in the week? Decides full email or quiet one. */
export function hadAQuietWeek(lessons: number, memories: number): boolean {
  return lessons <= 0 && memories <= 0;
}
