"use client";

import { useState } from "react";
import { X } from "lucide-react";

/* ============================================================================
 * ShiftForwardModal: preview + confirm for the catch-up re-projection.
 *
 * PURELY PRESENTATIONAL. It used to compute the target dates itself, with a
 * single global counter: sorted.map((lesson, idx) => nthSchoolDay(today,
 * profileSchoolDays, idx + 1)). That handed out one lesson per school day
 * across EVERY goal and EVERY child, off the profile's school_days, ignoring
 * each goal's own school_days, lessons_per_day and per-weekday overrides. A
 * missed Spelling lesson and a missed Math lesson competed for the same day,
 * so subjects leapfrogged each other by weeks and lesson N could land after
 * lesson N+1 inside one goal. 70 goals across 34 families were left with
 * backwards-running dates (August 2026). docs/CURRICULUM-SCHEDULING.md
 * Anti-pattern C is this exact failure.
 *
 * The projector already knows how to spread a goal's remaining tail over that
 * goal's own school days, so the parent now runs computeNextLessonsForGoal per
 * goal and hands us the summary. No date math lives here any more, and there is
 * only one definition of "where does this lesson go" (Invariant 8).
 * ==========================================================================*/

/** One goal's projected outcome, computed by the parent at open time. */
export type ReprojectGoalPreview = {
  goalId: string;
  curriculumName: string;
  /** How many remaining lessons the projector placed for this goal. */
  lessonCount: number;
  /** First projected date (YYYY-MM-DD), or null if nothing was placed. */
  firstDate: string | null;
};

export interface ShiftForwardModalProps {
  isOpen: boolean;
  /** True while the parent is still loading goals + building the projection. */
  loading?: boolean;
  goals: ReprojectGoalPreview[];
  /** Missed lessons with no curriculum attached. They are NOT re-projected:
   *  a one-off lesson has no queue to spread. Surfaced so the family is told
   *  rather than left wondering why those rows did not move. */
  unlinkedMissedCount?: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export default function ShiftForwardModal(props: ShiftForwardModalProps) {
  const {
    isOpen,
    loading = false,
    goals,
    unlinkedMissedCount = 0,
    onClose,
    onConfirm,
  } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalLessons = goals.reduce((sum, g) => sum + g.lessonCount, 0);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't re-spread your schedule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">Catch up</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">
                {loading
                  ? "Checking your whole schedule, one moment…"
                  : goals.length === 0
                    ? "Nothing to re-spread right now."
                    : "Here's where everything lands."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-4 pt-1 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">Working out your new dates…</p>
            ) : goals.length === 0 ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">Nothing to re-spread right now.</p>
            ) : (
              <>
                {/* Honest about scope. The old copy said "shifting N missed
                    lessons", which described a fraction of what happened. */}
                <p className="text-[12px] text-[#7a6f65] mb-2.5 leading-relaxed">
                  This spreads every lesson you have left in{" "}
                  {goals.length === 1 ? "this curriculum" : "these curriculums"} out again,
                  starting today, in lesson order, on each one&apos;s own school days. Lessons you
                  moved by hand will be given new dates too.
                </p>

                <ul className="space-y-1">
                  {goals.map((g) => (
                    <li
                      key={g.goalId}
                      className="text-[12px] text-[#2d2926]"
                      style={{
                        background: "white",
                        border: "0.5px solid #e8e2d9",
                        borderRadius: 10,
                        padding: "6px 10px",
                      }}
                    >
                      <span className="font-semibold">{g.curriculumName}</span>
                      {": "}
                      <span className="text-[#7a6f65]">
                        {g.lessonCount} lesson{g.lessonCount === 1 ? "" : "s"} re-spread
                        {g.firstDate ? (
                          <>
                            {" starting "}
                            <span className="font-semibold text-[#2D5A3D] tabular-nums">
                              {formatDate(g.firstDate)}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                {unlinkedMissedCount > 0 ? (
                  <p className="text-[11px] text-[#9a8e84] mt-2">
                    {unlinkedMissedCount} one-off lesson
                    {unlinkedMissedCount === 1 ? "" : "s"} without a curriculum will stay where
                    {unlinkedMissedCount === 1 ? " it is" : " they are"}. Move
                    {unlinkedMissedCount === 1 ? " it" : " them"} from the calendar.
                  </p>
                ) : null}
              </>
            )}

            {error ? <p className="text-[11px] text-[#b91c1c] mt-2">{error}</p> : null}
          </div>

          <div className="flex items-center gap-2 px-5 pb-5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading || goals.length === 0 || submitting}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? "Re-spreading…"
                : loading
                  ? "Loading…"
                  : `Re-spread ${totalLessons} lesson${totalLessons === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
