import type { SupabaseClient } from "@supabase/supabase-js";
import { rolloverYearName } from "../../lib/school-year-name.ts";

/**
 * The one definition of "this year".
 *
 * The Garden, Today's first-memory card and Your Book strip, the yearbook
 * reader, Reports and the progress report all ask the same question: which
 * dates belong to the school year the family is in right now? Each used to
 * answer it with its own hardcoded August 1, so a family who closed a year and
 * started the next one saw last year's trees, last year's page count, and a
 * "Capture your first memory" card, all on the same screen.
 *
 * The answer is the family's active school_years row. Dates are the contract,
 * not lessons.school_year_id: 81% of completed lesson rows have that column
 * NULL, so it cannot be the filter.
 *
 * Every comparison is between "YYYY-MM-DD" strings. No Date object does any
 * day math here, so no server clock or server timezone can move a boundary
 * (Invariant 9). The one place a clock is read is todayLocalYmd(), which runs
 * on the family's device.
 */

export type SchoolYearWindow = { id: string | null; name: string; start: string; end: string };

/** The active row as school_years stores it. */
export type ActiveSchoolYearRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  created_at?: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Today on this device's calendar, "YYYY-MM-DD". */
export function todayLocalYmd(now: Date = new Date()): string {
  return localYmd(now);
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The August-to-July year a date falls in, by its start year: 2026-09-13 and
 * 2027-07-31 are both 2026. The only place the August rule lives.
 */
export function augustYearOf(ymd: string): number {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return month >= 8 ? year : year - 1;
}

/**
 * The old rule, kept for a family with no active school year: August 1 of the
 * current school year through July 31. That family sees exactly what the
 * hardcoded August 1 showed them before this helper existed.
 */
export function fallbackSchoolYear(today: string): SchoolYearWindow {
  const y = augustYearOf(today);
  return {
    id: null,
    // Named the way the close route names a rolled-over year, hyphen and all.
    name: rolloverYearName(null, y),
    start: `${y}-08-01`,
    end: `${y + 1}-07-31`,
  };
}

/**
 * The window for a family, given their active row (or none) and today.
 *
 * Two widenings on top of the row's own dates, both so that a memory captured
 * inside the family's current year never lands in no year at all:
 *
 * - START: the earlier of start_date and the day the row was created. A close
 *   creates the next year on the day it runs, and onboarding creates a year at
 *   signup, both often with a start date a week or two later. A photo taken on
 *   that day is this year's, not nobody's. 90 of the 335 active years on
 *   2026-09-13 were created before their start date.
 * - END: the later of end_date and today. The year is not over until the
 *   family closes it, and the close route itself counts memories up to the day
 *   it runs. A June photo in a year whose end_date said May 31 is still this
 *   year's until they say otherwise.
 *
 * `createdYmd` is the local calendar day of created_at, already converted.
 */
export function resolveSchoolYear(args: {
  active: ActiveSchoolYearRow | null;
  createdYmd?: string | null;
  today: string;
}): SchoolYearWindow {
  const { active, today } = args;
  if (!active || !YMD.test(active.start_date ?? "") || !YMD.test(active.end_date ?? "")) {
    return fallbackSchoolYear(today);
  }
  const created = args.createdYmd && YMD.test(args.createdYmd) ? args.createdYmd : null;
  const start = created && created < active.start_date ? created : active.start_date;
  const end = today > active.end_date ? today : active.end_date;
  return { id: active.id, name: active.name, start, end };
}

/**
 * The family's current school year. Reads the newest active school_years row;
 * with none, the August 1 fallback. A failed read degrades to the fallback
 * too, because every caller would rather show this year by the old rule than
 * show nothing.
 */
export async function getCurrentSchoolYear(
  supabase: SupabaseClient,
  userId: string,
  today: string = todayLocalYmd(),
): Promise<SchoolYearWindow> {
  const { data, error } = await supabase
    .from("school_years")
    .select("id, name, start_date, end_date, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return fallbackSchoolYear(today);
  const row = data as ActiveSchoolYearRow;
  const createdYmd = row.created_at ? localYmd(new Date(row.created_at)) : null;
  return resolveSchoolYear({ active: row, createdYmd, today });
}

/**
 * PostgREST `or` filter for yearbook_content that belongs to this year's book:
 * rows not yet stamped with a year, plus rows stamped with this one. Closing a
 * year stamps every unstamped row with the closing year's id, so last year's
 * captions stop reaching this year's reader.
 */
export function yearbookContentYearFilter(y: Pick<SchoolYearWindow, "id">): string {
  return y.id ? `school_year_id.is.null,school_year_id.eq.${y.id}` : "school_year_id.is.null";
}

/** "2025-26" for the August year that starts in 2025. The yearbook_key format. */
export function yearbookKeyForAugustYear(y: number): string {
  return `${y}-${String(y + 1).slice(2)}`;
}

/**
 * Which yearbook_key this year's book reads and writes, given the keys a close
 * has already stamped onto an earlier year.
 *
 * The key has always come from profiles.yearbook_opened_at (the August year
 * the editor was first opened in), and nothing moves that when a year closes.
 * So after a close the editor kept writing under last year's key and, through
 * its upsert, over last year's stamped rows, while the reader (which only
 * reads unstamped rows and this year's) never showed the edit.
 *
 * The rule: the opened_at key while it still belongs to no closed year, which
 * keeps every family who has never closed exactly where they are. Once a close
 * has stamped it, the key of the August year this school year starts in.
 */
export function chooseYearbookKey(args: {
  openedAt: string | null | undefined;
  schoolYear: Pick<SchoolYearWindow, "start">;
  closedKeys: ReadonlySet<string>;
}): string {
  const opened = args.openedAt && YMD.test(args.openedAt.slice(0, 10)) ? args.openedAt.slice(0, 10) : args.schoolYear.start;
  // yearbook_opened_at is a timestamptz and PostgREST returns it in UTC, so
  // its date part is the UTC date the reader and Today always keyed from.
  const legacy = yearbookKeyForAugustYear(augustYearOf(opened));
  if (!args.closedKeys.has(legacy)) return legacy;
  return yearbookKeyForAugustYear(augustYearOf(args.schoolYear.start));
}

/** The candidate keys chooseYearbookKey may pick between. */
export function yearbookKeyCandidates(openedAt: string | null | undefined, schoolYear: Pick<SchoolYearWindow, "start">): string[] {
  const keys = [
    chooseYearbookKey({ openedAt, schoolYear, closedKeys: new Set() }),
    yearbookKeyForAugustYear(augustYearOf(schoolYear.start)),
  ];
  return [...new Set(keys)];
}

/**
 * The book's key, and every key its content is read from.
 *
 * When a close moves the book to a new key, rows the family wrote under the
 * old key AFTER that close (unstamped, so this year's) must not vanish with
 * the move. Those are read too, with the new key's rows winning: see
 * currentKeyLast. Saves always go to `key`.
 */
export type YearbookKeys = { key: string; readKeys: string[] };

/**
 * The yearbook keys for the current school year's book. Asks, per candidate
 * key, whether a close has stamped any of its rows onto a different year.
 * (Two closes inside one August year would stamp both candidates; the second
 * candidate is used anyway. No family has done that outside a test account.)
 * Shared by the reader, the editor and Today's page count, which must agree.
 */
export async function resolveYearbookKey(
  supabase: SupabaseClient,
  userId: string,
  openedAt: string | null | undefined,
  schoolYear: SchoolYearWindow,
): Promise<YearbookKeys> {
  // A family with no school_years row has never closed a year.
  if (!schoolYear.id) {
    const key = chooseYearbookKey({ openedAt, schoolYear, closedKeys: new Set() });
    return { key, readKeys: [key] };
  }
  const candidates = yearbookKeyCandidates(openedAt, schoolYear);
  const stamped = await Promise.all(
    candidates.map((key) =>
      supabase
        .from("yearbook_content")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("yearbook_key", key)
        .not("school_year_id", "is", null)
        .neq("school_year_id", schoolYear.id as string),
    ),
  );
  const closedKeys = new Set(candidates.filter((_, i) => (stamped[i].count ?? 0) > 0));
  const key = chooseYearbookKey({ openedAt, schoolYear, closedKeys });
  return { key, readKeys: [...new Set([...candidates.filter((c) => c !== key && closedKeys.has(c)), key])] };
}

/**
 * Rows read across readKeys, ordered so the book's own key comes last. Every
 * reader builds its content map last-write-wins, so this makes the current
 * key's value the one that shows.
 */
export function currentKeyLast<T extends { yearbook_key?: string | null }>(rows: readonly T[], key: string): T[] {
  return [...rows.filter((r) => r.yearbook_key !== key), ...rows.filter((r) => r.yearbook_key === key)];
}

/** Inclusive on both ends. A missing or malformed date is in no year. */
export function isInSchoolYear(dateYmd: string, y: SchoolYearWindow): boolean {
  const d = (dateYmd ?? "").slice(0, 10);
  if (!YMD.test(d)) return false;
  return d >= y.start && d <= y.end;
}
