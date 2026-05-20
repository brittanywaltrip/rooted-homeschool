"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Hand, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { PlanV2Child, PlanV2Lesson } from "./types";
import { resolveChildColor } from "./colors";
import { isSchoolDayDate, isInVacation, type VacationRange } from "@/lib/school-days";
import { computeFinishDate, type VacationBlock as SchedulerVacationBlock } from "@/app/lib/scheduler";

/* ============================================================================
 * CurriculumGroupsPanel — curriculum goal list with pace + progress + per-
 * goal actions. Appears below the calendar card and above RecentChanges.
 *
 * Each group shows:
 *   - color dot · subject · curriculum_name · "Lesson N of M"
 *   - pace pill (on-pace / behind / past-deadline / complete)
 *   - progress bar (completed / total lessons for that goal)
 *   - Edit goal + Delete goal + "Log past hours" (backfill)
 *   - Expand → month-grouped lesson list with toggle + per-row edit /
 *     reschedule / skip / delete
 *
 * Pure presentational. Parent owns DB mutations + audit logging. The
 * parent passes wire-up callbacks for every action; this component just
 * asks the right questions at the right moments.
 * ==========================================================================*/

export type CurriculumGoal = {
  id: string;
  child_id: string | null;
  curriculum_name: string;
  subject_label: string | null;
  total_lessons: number;
  current_lesson: number;
  lessons_per_day: number;
  target_date: string | null;
  school_days: string[] | null;
  /** YYYY-MM-DD. When set and > today, the goal renders in the "Upcoming"
   *  pending section below the active goals — no schedule is projected
   *  yet, the pace pill is replaced by a "Starts {date}" badge. */
  start_date?: string | null;
};

export type PaceStatus = {
  kind: "on_pace" | "behind" | "past_deadline" | "complete" | "no_target";
  label: string;
  color: string;
  bg: string;
};

function computePaceStatus(
  remainingCount: number,
  goal: CurriculumGoal,
  vacationBlocks: VacationRange[],
): PaceStatus {
  const targetDate = goal.target_date;
  const schoolDays = goal.school_days;
  if (remainingCount === 0) {
    return { kind: "complete", label: "✓ Finished!", color: "#7a6f65", bg: "#f0ede8" };
  }
  if (!targetDate) {
    // No user-set target. The queue projector can still compute a finish
    // date from current_lesson + lessons_per_day + school_days — show that
    // as a soft "Projected" pill instead of the bare "No target" fallback.
    if (schoolDays && schoolDays.length > 0 && goal.lessons_per_day > 0) {
      const projected = computeFinishDate(
        {
          id: goal.id,
          total_lessons: goal.total_lessons,
          lessons_per_day: goal.lessons_per_day,
          school_days: goal.school_days,
          current_lesson: goal.current_lesson,
          start_date: goal.start_date ?? null,
        },
        new Date(),
        vacationBlocks as SchedulerVacationBlock[],
      );
      if (projected) {
        const label = projected.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return { kind: "no_target", label: `Projected ${label}`, color: "#5c7f63", bg: "#f0f7f1" };
      }
    }
    return { kind: "no_target", label: "No target", color: "#9a8e84", bg: "#f4f0e8" };
  }
  if (!schoolDays || schoolDays.length === 0) {
    return { kind: "no_target", label: "No target", color: "#9a8e84", bg: "#f4f0e8" };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${targetDate}T00:00:00`);
  if (target < today) {
    const label = new Date(`${targetDate}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return { kind: "past_deadline", label: `⚠ Target was ${label}`, color: "#b91c1c", bg: "#fef2f2" };
  }
  // Count teaching days from today through target (inclusive) — this is
  // how many slots the parent has before the deadline.
  const cursor = new Date(today);
  let availableDays = 0;
  let safety = 0;
  while (cursor <= target && safety < 1000) {
    const s = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (isSchoolDayDate(s, schoolDays) && !isInVacation(s, vacationBlocks)) availableDays++;
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  if (availableDays >= remainingCount) {
    return { kind: "on_pace", label: "✓ On pace", color: "var(--g-deep)", bg: "#e8f0e9" };
  }
  const lessonsBehind = remainingCount - availableDays;
  return {
    kind: "behind",
    label: `⚠ ${lessonsBehind} lesson${lessonsBehind === 1 ? "" : "s"} behind`,
    color: "#7a4a1a",
    bg: "#fef9e8",
  };
}

function monthKey(dateStr: string | null): string {
  if (!dateStr) return "Unscheduled";
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return "Unscheduled";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface CurriculumGroupsPanelProps {
  goals: CurriculumGoal[];
  lessons: PlanV2Lesson[];
  kids: PlanV2Child[];
  vacationBlocks: VacationRange[];
  onCreate: () => void;
  onEdit: (goal: CurriculumGoal) => void;
  onDelete: (goal: CurriculumGoal, lessonCount: number) => void;
  /** "Stop this curriculum" — caps the goal at its current_lesson and
   *  clears uncompleted lessons. Distinct from Delete: completed history
   *  is preserved and the goal stays in the DB. Only wired for active
   *  goals (pending goals haven't started, so stopping is meaningless). */
  onStop: (goal: CurriculumGoal) => void;
  /** "Mark as finished" — sets archived=true on curriculum_goals so the
   *  goal drops off Today + Plan immediately. Does NOT touch lesson rows;
   *  history stays intact and Transcript still surfaces the goal. */
  onMarkFinished: (goal: CurriculumGoal) => void;
  onToggleLesson: (lessonId: string, current: boolean) => void;
  onEditLesson: (lesson: PlanV2Lesson) => void;
  onRescheduleLesson: (lesson: PlanV2Lesson) => void;
  onSkipLesson: (lesson: PlanV2Lesson) => void;
  onDeleteLesson: (lesson: PlanV2Lesson) => void;
  /** Clicking "Log past hours" toggles a sub-panel below the goal header. */
  onOpenBackfill: (goal: CurriculumGoal) => void;
  openBackfillGoalId: string | null;
  /** Backfill sub-panel JSX rendered inline, driven by the parent so the
   *  lesson-insert logic stays centralized. */
  renderBackfillPanel?: (goal: CurriculumGoal) => React.ReactNode;
  /** "I'm actually on lesson X" quick recalibration. Toggles a small
   *  inline form below the goal header. */
  onOpenRecalibrate: (goal: CurriculumGoal) => void;
  recalibratingGoalId: string | null;
  /** Receives the new value mom typed. Parent runs the curriculum_goals
   *  UPDATE (current_lesson + start_at_lesson) and reloads. */
  onRecalibrate: (goal: CurriculumGoal, newCurrentLesson: number) => Promise<void>;
  /** Cancels an in-progress recalibration without saving. */
  onCloseRecalibrate: () => void;
}

export default function CurriculumGroupsPanel(props: CurriculumGroupsPanelProps) {
  const {
    goals, lessons, kids, vacationBlocks,
    onCreate, onEdit, onDelete, onStop, onMarkFinished,
    onToggleLesson, onEditLesson, onRescheduleLesson, onSkipLesson, onDeleteLesson,
    onOpenBackfill, openBackfillGoalId, renderBackfillPanel,
    onOpenRecalibrate, recalibratingGoalId, onRecalibrate, onCloseRecalibrate,
  } = props;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const lessonsByGoal = useMemo(() => {
    const m = new Map<string, PlanV2Lesson[]>();
    for (const l of lessons) {
      if (!l.curriculum_goal_id) continue;
      const bucket = m.get(l.curriculum_goal_id);
      if (bucket) bucket.push(l);
      else m.set(l.curriculum_goal_id, [l]);
    }
    return m;
  }, [lessons]);

  const kidsById = useMemo(() => {
    const m = new Map<string, { child: PlanV2Child; index: number }>();
    kids.forEach((c, i) => m.set(c.id, { child: c, index: i }));
    return m;
  }, [kids]);

  function toggleExpanded(goalId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }

  // Split into active vs pending. Goals with start_date > today's local
  // YYYY-MM-DD render below in a muted "Upcoming" section. start_date
  // values are stored as YYYY-MM-DD strings, so a lexical compare is
  // sufficient — no Date math needed.
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const activeGoals: CurriculumGoal[] = [];
  const pendingGoals: CurriculumGoal[] = [];
  for (const g of goals) {
    const sd = g.start_date && g.start_date.trim().length > 0 ? g.start_date : null;
    if (sd && sd > todayStr) pendingGoals.push(g);
    else activeGoals.push(g);
  }

  return (
    <section className="bg-white border border-[#e8e5e0] rounded-2xl overflow-visible">
      <header className="flex items-start gap-2 px-4 py-3 border-b border-[#f0ede8]">
        <span aria-hidden className="text-base leading-none mt-0.5">📚</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold text-[#2d2926]">Curriculum</h2>
          <p className="text-[11px] text-[#7a6f65] mt-0.5">
            Your subjects for the year. Pacing and progress.
          </p>
        </div>
        {/* Create curriculum lives in the unified "+" sheet in the Plan hero. */}
      </header>

      {goals.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[13px] text-[#7a6f65] leading-relaxed">
            No curriculum set up yet. Use the + button above to add your first subject.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#f0ede8]">
          {activeGoals.map((goal) => {
            const goalLessons = (lessonsByGoal.get(goal.id) ?? []).sort((a, b) => {
              const da = a.scheduled_date ?? a.date ?? "";
              const db = b.scheduled_date ?? b.date ?? "";
              return da.localeCompare(db);
            });
            const totalInView = goalLessons.length;
            const completedCount = goal.current_lesson ?? 0;
            const remaining = Math.max(0, goal.total_lessons - completedCount);
            const pace = computePaceStatus(remaining, goal, vacationBlocks);
            const childMeta = goal.child_id ? kidsById.get(goal.child_id) : undefined;
            const color = resolveChildColor(childMeta?.child ?? null, childMeta?.index ?? 0);
            const pctComplete = goal.total_lessons > 0
              ? Math.min(100, Math.round((completedCount / goal.total_lessons) * 100))
              : 0;
            const isExpanded = expanded.has(goal.id);
            const isBackfillOpen = openBackfillGoalId === goal.id;

            return (
              <li key={goal.id}>
                <div className="px-4 py-3">
                  {/* Row header */}
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(goal.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${goal.curriculum_name}`}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <span
                      aria-hidden
                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {childMeta?.child?.name.charAt(0).toUpperCase() ?? "·"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#2d2926] leading-tight break-words">
                        {goal.subject_label ? <span className="text-[#7a6f65]">{goal.subject_label} · </span> : null}
                        {goal.curriculum_name}
                      </p>
                      <p className="text-[11px] text-[#9a8e84] mt-0.5 tabular-nums">
                        Lesson {Math.min(completedCount + 1, goal.total_lessons)} of {goal.total_lessons}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
                      style={{ color: pace.color, background: pace.bg }}
                    >
                      {pace.label}
                    </span>
                    {/* Per-card overflow menu — replaces the previous inline
                        Edit / Log past hours / Stop / Delete row. Same
                        handlers; only the trigger UI changed. */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setMenuOpenId((id) => (id === goal.id ? null : goal.id))}
                        aria-label={`More actions for ${goal.curriculum_name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === goal.id}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-[#7a6f65] hover:text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
                      >
                        <MoreVertical size={15} />
                      </button>
                      {menuOpenId === goal.id ? (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setMenuOpenId(null)}
                            aria-hidden
                          />
                          <div
                            role="menu"
                            className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-[#e8e2d9] overflow-hidden min-w-[170px]"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setMenuOpenId(null); onEdit(goal); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                            >
                              <Pencil size={14} className="text-[#5c7f63]" /> Edit pacing
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setMenuOpenId(null); onOpenBackfill(goal); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                            >
                              <span aria-hidden className="text-[14px] leading-none">📥</span> Log past hours
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setMenuOpenId(null); onOpenRecalibrate(goal); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                            >
                              <span aria-hidden className="text-[14px] leading-none">🎯</span> I&apos;m actually on...
                            </button>
                            {(goal.current_lesson ?? 0) > 0 ? (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setMenuOpenId(null); onStop(goal); }}
                                className="w-full px-3 py-2 text-left text-[13px] text-[#a07000] hover:bg-[#fef9e8] flex items-center gap-2"
                              >
                                <Hand size={14} /> Stop
                              </button>
                            ) : null}
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setMenuOpenId(null); onMarkFinished(goal); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                            >
                              <span aria-hidden className="text-[14px] leading-none">✅</span> Mark as finished
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setMenuOpenId(null); onDelete(goal, totalInView); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-[#b91c1c] hover:bg-[#fef2f2] flex items-center gap-2"
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${pctComplete}%`, backgroundColor: color }}
                    />
                  </div>
                </div>

                {isBackfillOpen && renderBackfillPanel ? (
                  <div className="px-4 pb-3 bg-[#fffbf0] border-t border-[#f0dda8]">
                    {renderBackfillPanel(goal)}
                  </div>
                ) : null}

                {recalibratingGoalId === goal.id ? (
                  <div className="px-4 pb-3 bg-[#f0f7f1] border-t border-[#c5dbc9]">
                    <RecalibrateForm
                      goal={goal}
                      onSubmit={(newValue) => onRecalibrate(goal, newValue)}
                      onClose={onCloseRecalibrate}
                    />
                  </div>
                ) : null}

                {isExpanded ? (
                  <LessonList
                    lessons={goalLessons}
                    onToggleLesson={onToggleLesson}
                    onEditLesson={onEditLesson}
                    onRescheduleLesson={onRescheduleLesson}
                    onSkipLesson={onSkipLesson}
                    onDeleteLesson={onDeleteLesson}
                  />
                ) : null}
              </li>
            );
          })}

          {pendingGoals.length > 0 ? (
            <>
              <li className="px-4 py-2 bg-[#faf8f4]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a8e84]">
                  Upcoming
                </p>
              </li>
              {pendingGoals.map((goal) => {
                const childMeta = goal.child_id ? kidsById.get(goal.child_id) : undefined;
                const color = resolveChildColor(childMeta?.child ?? null, childMeta?.index ?? 0);
                const startsLabel = goal.start_date
                  ? new Date(`${goal.start_date}T00:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "";
                return (
                  <li key={goal.id}>
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Width-matched spacer for the missing expand toggle so
                            the title column lines up with active rows. */}
                        <div aria-hidden className="shrink-0 w-6 h-6" />
                        <span
                          aria-hidden
                          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white opacity-50 pointer-events-none"
                          style={{ backgroundColor: color }}
                        >
                          {childMeta?.child?.name.charAt(0).toUpperCase() ?? "·"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold leading-tight break-words" style={{ color: "#9a8e84" }}>
                            {goal.subject_label ? <span>{goal.subject_label} · </span> : null}
                            {goal.curriculum_name}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: "#9a8e84" }}>
                            {childMeta?.child?.name ?? "Unassigned"}
                          </p>
                        </div>
                        <span
                          className="shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
                          style={{ color: "#9a8e84", background: "#f0ede8" }}
                        >
                          Starts {startsLabel}
                        </span>
                      </div>

                      {/* Empty progress bar — pending goals have no completion
                          to render. opacity-50 + pointer-events-none mute it. */}
                      <div className="mt-2 h-1.5 bg-[#f0ede8] rounded-full overflow-hidden opacity-50 pointer-events-none" />

                      {/* Edit + Delete only — Log past hours doesn't apply to a
                          goal that hasn't started. Reduced-opacity row keeps
                          the actions reachable per spec. */}
                      <div className="mt-2 flex items-center gap-2 flex-wrap opacity-60">
                        <button
                          type="button"
                          onClick={() => onEdit(goal)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[#5c7f63] hover:text-[var(--g-deep)] px-2 py-1 rounded-lg hover:bg-[#e8f0e9] transition-colors"
                        >
                          <Pencil size={11} /> Edit goal
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(goal, 0)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[#b91c1c] hover:text-[#991b1b] px-2 py-1 rounded-lg hover:bg-[#fef2f2] transition-colors"
                        >
                          <Trash2 size={11} /> Delete goal
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function RecalibrateForm(props: {
  goal: CurriculumGoal;
  onSubmit: (newCurrentLesson: number) => Promise<void>;
  onClose: () => void;
}) {
  const { goal, onSubmit, onClose } = props;
  // The field reflects mom's "I'm actually on lesson X" mental model:
  // the lesson currently in progress, which is one slot beyond the count
  // stored in current_lesson. handleRecalibrateGoal converts back when it
  // writes to the DB, so the round trip is idempotent (re-opening the
  // form after a save shows the value mom just entered).
  const defaultDisplayValue = Math.max(1, (goal.current_lesson ?? 0) + 1);
  const cap = goal.total_lessons > 0 ? goal.total_lessons : undefined;
  const clampedDefault = cap != null ? Math.min(cap, defaultDisplayValue) : defaultDisplayValue;
  const [value, setValue] = useState<string>(String(clampedDefault));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (submitting) return;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      setError("Enter a whole number.");
      return;
    }
    if (n < 1) {
      setError("Lesson must be at least 1.");
      return;
    }
    if (goal.total_lessons > 0 && n > goal.total_lessons) {
      setError(`Lesson must be at most ${goal.total_lessons}.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(n);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the schedule.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] font-semibold text-[#2d4a36]">
          Which lesson are you actually on?
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-[#5c7f63] hover:text-[#2d4a36]"
        >
          Close
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={goal.total_lessons > 0 ? goal.total_lessons : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Current lesson"
          className="w-[88px] text-[14px] font-semibold text-[#2D5A3D] border border-[#c5dbc9] rounded-md bg-white px-2.5 py-1.5 focus:outline-none focus:border-[#2D5A3D]"
        />
        <span className="text-[11px] text-[#5c7f63]">of {goal.total_lessons}</span>
      </div>
      <p className="text-[11px] text-[#5c7f63] leading-relaxed">
        This resets your position in the queue. Lessons you&apos;ve already logged stay in your history.
      </p>
      {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="text-[11px] font-semibold text-[#5c7f63] px-3 py-1.5 rounded-lg hover:bg-[#e8f0e9] transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting}
          className="text-[11px] font-bold text-white bg-[#2D5A3D] hover:bg-[var(--g-deep)] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function LessonList(props: {
  lessons: PlanV2Lesson[];
  onToggleLesson: (lessonId: string, current: boolean) => void;
  onEditLesson: (lesson: PlanV2Lesson) => void;
  onRescheduleLesson: (lesson: PlanV2Lesson) => void;
  onSkipLesson: (lesson: PlanV2Lesson) => void;
  onDeleteLesson: (lesson: PlanV2Lesson) => void;
}) {
  const { lessons, onToggleLesson, onEditLesson, onRescheduleLesson, onSkipLesson, onDeleteLesson } = props;
  const grouped = useMemo(() => {
    const groups: { key: string; rows: PlanV2Lesson[] }[] = [];
    let current: { key: string; rows: PlanV2Lesson[] } | null = null;
    for (const l of lessons) {
      const key = monthKey(l.scheduled_date ?? l.date);
      if (!current || current.key !== key) {
        current = { key, rows: [] };
        groups.push(current);
      }
      current.rows.push(l);
    }
    return groups;
  }, [lessons]);

  if (lessons.length === 0) {
    return (
      <p className="px-4 pb-3 text-[12px] text-[#9a8e84]">
        No lessons in view yet — they&apos;ll appear here once scheduled.
      </p>
    );
  }

  return (
    <div className="px-4 pb-3 border-t border-[#f0ede8] bg-[#faf8f4]">
      {grouped.map((g) => (
        <div key={g.key} className="mt-2 first:mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-1.5">
            {g.key}
          </p>
          <ul className="space-y-1">
            {g.rows.map((l) => {
              const title =
                l.title && l.title.trim().length > 0
                  ? l.title
                  : l.lesson_number
                    ? `Lesson ${l.lesson_number}`
                    : "Lesson";
              const dateLabel = formatDate(l.scheduled_date ?? l.date);
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-lg px-2.5 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => onToggleLesson(l.id, l.completed)}
                    aria-label={l.completed ? `Mark ${title} incomplete` : `Mark ${title} complete`}
                    className="shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                    style={{
                      borderColor: l.completed ? "#5c7f63" : "#c8bfb5",
                      backgroundColor: l.completed ? "#5c7f63" : "transparent",
                    }}
                  >
                    {l.completed ? (
                      <svg viewBox="0 0 8 7" width="7" height="6" fill="none">
                        <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[12px] font-medium leading-tight truncate"
                      style={{
                        color: "#2d2926",
                        textDecoration: l.completed ? "line-through" : "none",
                      }}
                    >
                      {title}
                    </p>
                    {dateLabel ? (
                      <p className="text-[10px] text-[#9a8e84] tabular-nums mt-0.5">{dateLabel}</p>
                    ) : null}
                  </div>
                  <LessonActionMenu
                    lesson={l}
                    onEditLesson={onEditLesson}
                    onRescheduleLesson={onRescheduleLesson}
                    onSkipLesson={onSkipLesson}
                    onDeleteLesson={onDeleteLesson}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LessonActionMenu(props: {
  lesson: PlanV2Lesson;
  onEditLesson: (lesson: PlanV2Lesson) => void;
  onRescheduleLesson: (lesson: PlanV2Lesson) => void;
  onSkipLesson: (lesson: PlanV2Lesson) => void;
  onDeleteLesson: (lesson: PlanV2Lesson) => void;
}) {
  const { lesson, onEditLesson, onRescheduleLesson, onSkipLesson, onDeleteLesson } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        className="w-6 h-6 flex items-center justify-center rounded-full text-[#9a8e84] hover:bg-[#f0ede8] transition-colors"
      >
        <span aria-hidden className="text-[13px] leading-none">⋯</span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[50]" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-[51] bg-white border border-[#e8e2d9] rounded-xl shadow-lg overflow-hidden w-[140px]"
          >
            <ActionMenuItem label="Edit" icon="✏️" onClick={() => { setOpen(false); onEditLesson(lesson); }} />
            <ActionMenuItem label="Reschedule" icon="📅" onClick={() => { setOpen(false); onRescheduleLesson(lesson); }} />
            <ActionMenuItem label="Skip" icon="⏩" onClick={() => { setOpen(false); onSkipLesson(lesson); }} />
            <ActionMenuItem label="Delete" icon="🗑" destructive onClick={() => { setOpen(false); onDeleteLesson(lesson); }} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function ActionMenuItem({
  label, icon, destructive, onClick,
}: {
  label: string;
  icon: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-[#f8f7f4] transition-colors"
      style={{ color: destructive ? "#b91c1c" : "#2d2926" }}
    >
      <span aria-hidden>{icon}</span> {label}
    </button>
  );
}
