import { countSchoolDaysInRange, nthSchoolDay, nthSchoolDayBefore, type VacationRange } from "../../../lib/school-days.ts";

export type PlannedLesson = {
  id: string;
  scheduled_date: string | null;
  date: string | null;
  completed: boolean;
  curriculum_goal_id: string | null;
};

/** Shift the parent's unfinished one-off plan while keeping each day's spacing. */
export function shiftManualPlan(
  rows: readonly PlannedLesson[],
  from: string,
  to: string,
  schoolDays: string[],
  breaks: VacationRange[],
): { id: string; from: string; date: string }[] {
  if (from === to || schoolDays.length === 0) return [];
  const forward = to > from;
  const steps = forward
    ? countSchoolDaysInRange(from, to, schoolDays, breaks) - countSchoolDaysInRange(from, from, schoolDays, breaks)
    : countSchoolDaysInRange(to, from, schoolDays, breaks) - countSchoolDaysInRange(from, from, schoolDays, breaks);
  if (steps <= 0) return [];
  return rows.flatMap((row) => {
    const oldDate = row.scheduled_date ?? row.date;
    if (row.completed || row.curriculum_goal_id || !oldDate || oldDate < from) return [];
    const date = oldDate === from ? to : forward
      ? nthSchoolDay(oldDate, schoolDays, steps, breaks)
      : nthSchoolDayBefore(oldDate, schoolDays, steps, breaks);
    return date === oldDate ? [] : [{ id: row.id, from: oldDate, date }];
  });
}
