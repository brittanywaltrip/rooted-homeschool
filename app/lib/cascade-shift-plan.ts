import {
  computeNextLessonsForGoal, lessonsPerDayForDate, normalizeSchoolDays,
  queueHoldsFromRows, schoolDayDelta,
  type CurriculumGoalConfig, type VacationBlock,
} from './scheduler.ts';
import { countDoneToday } from './phase2-commit.ts';
import { isTeachingDay, nthSchoolDay } from '../../lib/school-days.ts';
import { queueOutOfBookOrder } from './move-keep-slot.ts';

/** Full rows: caller must supply a complete, owner-scoped snapshot. */
export type CascadeRow = {
  id: string; user_id: string; curriculum_goal_id: string;
  lesson_number: number | null; queue_position: number | null;
  scheduled_date: string | null; date: string;
  queue_pinned: boolean; scheduled_source: string | null;
  completed: boolean; completed_at: string | null; skipped: boolean;
  is_backfill: boolean; continues_lesson_id: string | null;
  notes: string | null; minutes_spent: number | null; hours: number | null;
  updated_at: string;
  queue_preserved?: boolean;
};
export type CascadeSnapshot = {
  userId: string;
  goal: CurriculumGoalConfig & { user_id: string };
  rows: CascadeRow[];
  rowCount: number;
  vacations: VacationBlock[];
  localDay: string;
  dayStartIso: string;
  dayEndIso: string;
};
export type CascadeDateState = Pick<CascadeRow, 'scheduled_date' | 'date' | 'queue_pinned' | 'scheduled_source' | 'queue_preserved'>;
export type CascadeWrite = { id: string; before: CascadeDateState; after: CascadeDateState };
export type CascadePlan = { expected: CascadeSnapshot; writes: CascadeWrite[]; preserved: CascadeWrite[]; days: number };
export type CascadePlanResult =
  | { ok: true; plan: CascadePlan }
  | { ok: false; reason: 'snapshot' | 'selection' | 'queue_order' | 'capacity' | 'unrepresented_gap' };
const dateState = (r: CascadeRow): CascadeDateState => ({
  scheduled_date: r.scheduled_date, date: r.date,
  queue_pinned: r.queue_pinned, scheduled_source: r.scheduled_source, queue_preserved: !!r.queue_preserved,
});
const queueWork = (r: CascadeRow) => !r.completed && !r.skipped && !r.is_backfill &&
  !r.continues_lesson_id && r.queue_position != null;

/**
 * Preserve the current plan's teaching-day spacing, using existing pins as
 * anchors. Only the selected row gains a pin. Existing later anchors move
 * with the tail and keep their pin; no other pin is added or released.
 *
 * The existing projector must reproduce every live queue date afterwards.
 * An unpinned gap that it cannot express is refused, never silently removed
 * or converted into a newly pinned tail. This is a pure plan, not a writer.
 */
export function planAnchoredCascade(snapshot: CascadeSnapshot, choice: {
  lessonId: string; from: string; to: string;
}): CascadePlanResult {
  const { rows, goal, vacations } = snapshot;
  if (snapshot.rowCount !== rows.length || rows.length !== new Set(rows.map(r => r.id)).size ||
      goal.user_id !== snapshot.userId || rows.some(r => r.user_id !== snapshot.userId || r.curriculum_goal_id !== goal.id)) {
    return { ok: false, reason: 'snapshot' };
  }
  const moved = rows.find(r => r.id === choice.lessonId);
  const days = normalizeSchoolDays(goal.school_days);
  const delta = schoolDayDelta(choice.from, choice.to, days, vacations.map(v => ({ start: v.start_date, end: v.end_date })));
  if (!moved || !queueWork(moved) || moved.scheduled_date !== choice.from ||
      moved.queue_position! <= goal.current_lesson || choice.to < snapshot.localDay ||
      !isTeachingDay(choice.to, days, vacations) || delta <= 0) {
    return { ok: false, reason: 'selection' };
  }
  const slotted = rows.filter(r => r.queue_position != null);
  if (new Set(slotted.map(r => r.queue_position)).size !== slotted.length || queueOutOfBookOrder(slotted)) {
    return { ok: false, reason: 'queue_order' };
  }
  const ordered = rows.filter(r => queueWork(r) && r.queue_position! > goal.current_lesson)
    .sort((a,b) => a.queue_position! - b.queue_position!);
  if (ordered.some((r,i) => !r.scheduled_date || (i > 0 && r.scheduled_date! < ordered[i - 1].scheduled_date!))) {
    return { ok: false, reason: 'queue_order' };
  }
  const affected = new Set(ordered.filter(r => r.queue_position! >= moved.queue_position!).map(r => r.id));
  const next = rows.map(r => {
    if (!affected.has(r.id)) return { ...r, queue_preserved: r.queue_preserved || (queueWork(r) && r.queue_position! < moved.queue_position! && !!r.scheduled_date) };
    const date = r.id === moved.id ? choice.to : nthSchoolDay(r.scheduled_date!, days, delta, vacations);
    return { ...r, date, scheduled_date: date, queue_pinned: r.id === moved.id || r.queue_pinned,
      scheduled_source: r.id === moved.id ? 'plan_move' : 'plan_cascade_shift', queue_preserved: false };
  });
  // Only changed destinations are judged. An unrelated historical/manual
  // overload is not permission to introduce a new one or to rewrite it.
  const destinations = new Set(next.filter(r => affected.has(r.id)).map(r => r.scheduled_date!));
  for (const date of destinations) {
    const count = next.filter(r => !r.skipped && r.scheduled_date === date).length;
    if (count > lessonsPerDayForDate(date, goal)) return { ok: false, reason: 'capacity' };
  }
  const projection = computeNextLessonsForGoal(goal, new Date(`${snapshot.localDay}T00:00:00`), 3650,
    vacations, countDoneToday(rows, snapshot.dayStartIso, snapshot.dayEndIso), queueHoldsFromRows(next, goal.id));
  const bySlot = new Map(projection.map(p => [p.lesson_number, p.date]));
  for (const r of next) {
    if (!queueWork(r) || r.queue_position! <= goal.current_lesson) continue;
    if (bySlot.get(r.queue_position!) !== r.scheduled_date) return { ok: false, reason: 'unrepresented_gap' };
  }
  return { ok: true, plan: { expected: structuredClone(snapshot), days: delta,
    preserved: next.filter(r=>!affected.has(r.id) && r.queue_preserved && !rows.find(old=>old.id===r.id)!.queue_preserved).map(r=>({id:r.id,before:dateState(rows.find(old=>old.id===r.id)!),after:dateState(r)})),
    writes: next.filter(r => affected.has(r.id)).map(r => ({ id: r.id,
      before: dateState(rows.find(old => old.id === r.id)!), after: dateState(r) })) } };
}

/** Canonical comparison for a future server transaction and its local model.
 * Full snapshot includes protected work, row membership, settings and breaks.
 * Do not send this to analytics; it can contain family notes.
 */
export function sameCascadeSnapshot(a: CascadeSnapshot, b: CascadeSnapshot): boolean {
  const sort = (s: CascadeSnapshot) => ({ ...s,
    rows: [...s.rows].sort((x,y) => x.id.localeCompare(y.id)),
    vacations: [...s.vacations].sort((x,y) => x.start_date.localeCompare(y.start_date) || x.end_date.localeCompare(y.end_date)),
  });
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value);
  };
  return canonical(sort(a)) === canonical(sort(b));
}
