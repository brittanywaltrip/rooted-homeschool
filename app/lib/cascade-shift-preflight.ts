import {
  computeNextLessonsForGoal,
  normalizeSchoolDays,
  projectionOverCap,
  schoolDayDelta,
  skippedSlotsFromRows,
  type CurriculumGoalConfig,
  type VacationBlock,
} from './scheduler.ts';
import { nthSchoolDay } from '../../lib/school-days.ts';

export type CascadeSnapshotRow = {
  id: string;
  scheduled_date: string | null;
  queue_position?: number | null;
  queue_pinned: boolean | null;
  completed?: boolean | null;
  skipped?: boolean | null;
  is_backfill?: boolean | null;
};

/**
 * Before any cascade write, prove the existing re-spread can honor the
 * dialog's literal date shift. A projection that compresses stored gaps or
 * touches an earlier lesson is not the shift the parent accepted.
 *
 * This is containment, not a new scheduler or a transaction: the existing
 * projector still decides dates, and the existing write path still commits
 * them. Unsupported plans are left alone instead of silently rebuilt.
 */
export function checkCascadeShift(
  goal: CurriculumGoalConfig,
  rows: readonly CascadeSnapshotRow[],
  vacations: VacationBlock[],
  choice: { lessonId: string; fromDateStr: string; toDateStr: string; shiftDays: number },
  from: Date,
): { ok: true } | { ok: false; reason: 'changed' | 'spacing' } {
  const moved = rows.find(r => r.id === choice.lessonId);
  const days = normalizeSchoolDays(goal.school_days);
  const delta = schoolDayDelta(choice.fromDateStr, choice.toDateStr, days,
    vacations.map(v => ({ start: v.start_date, end: v.end_date })));
  if (!moved || moved.completed || moved.skipped || moved.is_backfill ||
      moved.scheduled_date !== choice.fromDateStr || moved.queue_position == null ||
      moved.queue_position <= goal.current_lesson || moved.queue_position > goal.total_lessons ||
      delta <= 0 || delta !== choice.shiftDays) {
    return { ok: false, reason: 'changed' };
  }

  const holds = [...skippedSlotsFromRows([...rows]), { slot: moved.queue_position, date: choice.toDateStr }];
  const projected = computeNextLessonsForGoal(goal, from, 3650, vacations, 0, holds);
  if (projectionOverCap(projected, goal, holds)) return { ok: false, reason: 'spacing' };
  const dateBySlot = new Map(projected.map(p => [p.lesson_number, p.date]));
  if (dateBySlot.get(moved.queue_position) !== choice.toDateStr) return { ok: false, reason: 'spacing' };

  for (const row of rows) {
    if (row.id === moved.id || row.completed) continue;
    const later = row.scheduled_date != null && row.scheduled_date > choice.fromDateStr;
    const expected = later && !row.skipped && !row.is_backfill
      ? nthSchoolDay(row.scheduled_date!, days, delta, vacations)
      : row.scheduled_date;
    const projectedDate = !row.is_backfill && !row.skipped && row.queue_position != null
      ? dateBySlot.get(row.queue_position)
      : undefined;
    const actual = projectedDate ?? row.scheduled_date;
    // Earlier placements, skipped lessons and history are outside the
    // promised tail, including their pin state, not only their date.
    if (actual !== expected || ((!later || row.skipped || row.is_backfill) && row.queue_pinned)) {
      return { ok: false, reason: 'spacing' };
    }
  }
  return { ok: true };
}
