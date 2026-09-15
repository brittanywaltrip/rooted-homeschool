// The database half of a filed past year's day count: counting what a year
// archive holds, and re-spreading a filed year when the family changes how
// many days they schooled. The arithmetic is pure and tested in
// past-year-dates.ts; this file only reads, writes and undoes.
//
// Everything runs from the browser under the family's session, like the add
// flow (app/dashboard/years/add/page.tsx). No lesson is completed or
// uncompleted here: only the day a filed lesson is dated on moves.

import type { SupabaseClient } from "@supabase/supabase-js";
import { schoolDaysBetween } from "./scheduler.ts";
import { selectAllRows } from "../../lib/supabase-all-rows.ts";
import {
  DEFAULT_SCHOOL_DAYS,
  PAST_YEAR_SOURCE,
  buildPastYearArchive,
  daysAttendedProblem,
  pickAttendedDays,
  planPastYearRespread,
  type DateWrite,
  type RespreadLesson,
  type YearMemoryCounts,
} from "./past-year-dates.ts";

/** The memory counts for a year's dates, the five the close route snapshots. */
export async function countYearMemories(
  supabase: SupabaseClient,
  userId: string,
  start: string,
  end: string,
): Promise<YearMemoryCounts> {
  const head = { count: "exact" as const, head: true };
  const base = () => supabase.from("memories").select("id", head).eq("user_id", userId).gte("date", start).lte("date", end);
  const [all, photos, books, trips, wins] = await Promise.all([
    base(),
    base().eq("type", "photo"),
    base().eq("type", "book"),
    base().eq("type", "field_trip"),
    base().eq("type", "win"),
  ]);
  for (const r of [all, photos, books, trips, wins]) if (r.error) throw r.error;
  return {
    memories: all.count ?? 0,
    photos: photos.count ?? 0,
    books: books.count ?? 0,
    fieldTrips: trips.count ?? 0,
    wins: wins.count ?? 0,
  };
}

const IDS_PER_WRITE = 100;
const PARALLEL_WRITES = 8;

async function applyDateWrites(supabase: SupabaseClient, userId: string, writes: readonly DateWrite[]): Promise<void> {
  const jobs: (() => PromiseLike<{ error: unknown }>)[] = [];
  for (const w of writes) {
    for (let i = 0; i < w.ids.length; i += IDS_PER_WRITE) {
      const ids = w.ids.slice(i, i + IDS_PER_WRITE);
      jobs.push(() =>
        supabase
          .from("lessons")
          .update({ date: w.date, scheduled_date: w.scheduled_date, completed_at: w.completed_at })
          .eq("user_id", userId)
          .in("id", ids),
      );
    }
  }
  for (let i = 0; i < jobs.length; i += PARALLEL_WRITES) {
    const results = await Promise.all(jobs.slice(i, i + PARALLEL_WRITES).map((j) => j()));
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
  }
}

export type FiledYear = { id: string; name: string; start_date: string; end_date: string };

export class RespreadRefused extends Error {}

/**
 * Re-date a filed year's lessons over `requestedDays` school days and store the
 * day count. Returns the days the lessons now fill, which is what Reports will
 * count and what is stored.
 *
 * All or nothing, like the add flow: the lesson dates, school_years.days_attended
 * and the archive's stats either all land, or every lesson is put back on its
 * old day and days_attended is restored. A year holding any lesson that was
 * not filed through Add a past year is refused before anything is written: a
 * year the family lived in Rooted keeps its real days.
 */
export async function respreadPastYear(
  supabase: SupabaseClient,
  userId: string,
  year: FiledYear,
  requestedDays: number,
): Promise<number> {
  const [{ data: goals, error: goalsErr }, { data: yearRow, error: yearErr }] = await Promise.all([
    supabase
      .from("curriculum_goals")
      .select("id, child_id, curriculum_name, subject_label, current_lesson, total_lessons, school_days")
      .eq("user_id", userId)
      .eq("school_year_id", year.id),
    supabase.from("school_years").select("days_attended").eq("user_id", userId).eq("id", year.id).single(),
  ]);
  if (goalsErr) throw goalsErr;
  if (yearErr) throw yearErr;
  const goalRows = (goals ?? []) as {
    id: string; child_id: string; curriculum_name: string; subject_label: string | null;
    current_lesson: number; total_lessons: number; school_days: string[] | null;
  }[];

  const lessons = await selectAllRows<RespreadLesson & { scheduled_source: string | null; child_id: string; minutes_spent: number | null }>((from, to) =>
    supabase
      .from("lessons")
      .select("id, curriculum_goal_id, lesson_number, date, scheduled_date, completed_at, scheduled_source, child_id, minutes_spent")
      .eq("user_id", userId)
      .eq("school_year_id", year.id)
      .order("id")
      .range(from, to),
  );
  if (lessons.length === 0) throw new RespreadRefused("This year has no lessons to move.");
  if (lessons.some((l) => l.scheduled_source !== PAST_YEAR_SOURCE)) {
    throw new RespreadRefused("This year was lived in Rooted, so its days are the ones you logged.");
  }

  const schoolDays = goalRows.find((g) => g.school_days && g.school_days.length > 0)?.school_days ?? DEFAULT_SCHOOL_DAYS;
  const days = schoolDaysBetween(year.start_date, year.end_date, schoolDays);
  const problem = daysAttendedProblem(String(requestedDays), days.length);
  if (problem) throw new RespreadRefused(problem);

  const plan = planPastYearRespread(lessons, pickAttendedDays(days, requestedDays));
  const priorDays = (yearRow as { days_attended: number | null } | null)?.days_attended ?? null;

  let daysWritten = false;
  try {
    await applyDateWrites(supabase, userId, plan.writes);

    const { error: daysErr } = await supabase
      .from("school_years")
      .update({ days_attended: plan.filledDays, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", year.id);
    if (daysErr) throw daysErr;
    daysWritten = true;

    const { data: archive, error: archiveReadErr } = await supabase
      .from("school_year_archives")
      .select("id, stats")
      .eq("user_id", userId)
      .eq("school_year_id", year.id)
      .maybeSingle();
    if (archiveReadErr) throw archiveReadErr;
    if (archive) {
      const stats = { ...((archive as { stats: Record<string, unknown> | null }).stats ?? {}), days_attended: plan.filledDays };
      const { error } = await supabase.from("school_year_archives").update({ stats }).eq("id", (archive as { id: string }).id);
      if (error) throw error;
    } else {
      // A year filed before archives were written for filed years.
      const { data: kids, error: kidsErr } = await supabase.from("children").select("id, name").eq("user_id", userId);
      if (kidsErr) throw kidsErr;
      const memories = await countYearMemories(supabase, userId, year.start_date, year.end_date);
      const row = buildPastYearArchive({
        userId,
        schoolYearId: year.id,
        yearName: year.name,
        start: year.start_date,
        end: year.end_date,
        daysAttended: plan.filledDays,
        goals: goalRows,
        lessons,
        childNames: Object.fromEntries(((kids ?? []) as { id: string; name: string }[]).map((k) => [k.id, k.name])),
        memories,
      });
      const { error } = await supabase.from("school_year_archives").insert(row);
      if (error) throw error;
    }
    return plan.filledDays;
  } catch (err) {
    // Put everything back. If this fails too, the caller says so plainly.
    if (daysWritten) {
      const { error } = await supabase.from("school_years").update({ days_attended: priorDays }).eq("user_id", userId).eq("id", year.id);
      if (error) throw new RespreadUndoFailed(err);
    }
    // Always: a date batch that failed halfway may still have moved some rows,
    // and writing a row back to the day it already has changes nothing.
    try {
      await applyDateWrites(supabase, userId, plan.restore);
    } catch {
      throw new RespreadUndoFailed(err);
    }
    throw err;
  }
}

/** The change failed and could not be fully undone. */
export class RespreadUndoFailed extends Error {
  readonly original: unknown;
  constructor(original: unknown) {
    super("A filed year's re-spread failed and could not be fully undone");
    this.original = original;
  }
}
