/**
 * Vacation shift-forward date mapper.
 *
 * Given a lesson's original scheduled date, the boundaries of a newly
 * inserted vacation block, the user's school_days, and the full set of
 * vacation blocks (including the new one), return the date the lesson
 * should land on after the shift.
 *
 * The straight-line "everyone shifts forward by N teaching days" approach
 * (a single `nthSchoolDay(orig, schoolDays, shiftDays, blocksIncludingNew)`
 * call) is correct for lessons that were already AFTER the new break, but
 * collapses every break-day origin onto the same first-real-day-after-break
 * because the break days are skipped from the count. So Mon/Tue/Wed/Thu/Fri
 * inside a Mon-Fri break all converge on the Mon after the break + shiftDays
 * more teaching days, producing the May 2026 t.ferrebee / 052526 stacking
 * report on staging.
 *
 * The fix: a lesson INSIDE the break maps to its ordinal position
 * AFTER the break end. The Nth teaching day of the break becomes the
 * Nth teaching day after the break. Lessons after the break keep the
 * straight-line shift, which is already correct.
 */

// Relative import (not "@/lib/...") so the helper resolves under both the
// Next.js bundler and the raw `node --test` runner used by the unit tests.
import { countSchoolDaysInRange, nthSchoolDay, type VacationRange } from "../../../lib/school-days.ts";

export function mapLessonDateAcrossVacation(
  origDate: string,
  vacStart: string,
  vacEnd: string,
  schoolDays: string[],
  shiftDays: number,
  blocksIncludingNew: VacationRange[],
): string {
  if (origDate >= vacStart && origDate <= vacEnd) {
    // Lesson is inside the new break. Find its ordinal teaching-day
    // position within the break range (1-indexed). Pass [] for blocks
    // because we want every teaching day in the range counted; the
    // new block itself shouldn't exclude its own interior here.
    const ordinalWithinBreak = countSchoolDaysInRange(
      vacStart,
      origDate,
      schoolDays,
      [],
    );
    if (ordinalWithinBreak <= 0) {
      // Defensive: lesson sits on a non-teaching day inside the break
      // (e.g. user scheduled work on a Saturday in their Mon-Fri profile,
      // or there's a nested vacation overlap). Fall back to the standard
      // straight-line shift so the row still moves forward.
      return nthSchoolDay(origDate, schoolDays, shiftDays, blocksIncludingNew);
    }
    // Walk forward from the break's end_date by ordinalWithinBreak teaching
    // days. nthSchoolDay starts STRICTLY after its first arg, skipping any
    // other vacation blocks. The new block is also in blocksIncludingNew
    // but since we're walking forward from end_date the new block is
    // already behind us, so it has no effect.
    return nthSchoolDay(vacEnd, schoolDays, ordinalWithinBreak, blocksIncludingNew);
  }
  // Lesson is after the break (the SELECT filter on scheduled_date >=
  // vacStart guarantees we never see pre-break rows here). Standard shift.
  return nthSchoolDay(origDate, schoolDays, shiftDays, blocksIncludingNew);
}
