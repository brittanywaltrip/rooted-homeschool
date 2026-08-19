"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ReprojectGoalPreview } from "./ShiftForwardModal";

/* ============================================================================
 * PushBackModal: pause the schedule for N school days.
 *
 * PURELY PRESENTATIONAL. It used to compute a per-lesson from -> to mapping
 * itself and hand the parent two move lists, which the parent then wrote
 * directly while pinning every moved row. That is the defect class documented
 * in 04fa1eb: pins written without a queue_position are invisible to the
 * reconciler's pin set but skipped by its writer, so the projector double-books
 * their dates, and pins written WITH a slot freeze the goal's auto-roll until
 * every lesson is complete.
 *
 * Now the parent re-projects each affected goal from its own resume date and
 * hands us back the summary. No date math lives here, so the preview and the
 * write cannot disagree.
 * ==========================================================================*/

export interface PushBackModalProps {
  isOpen: boolean;
  /** True while the parent is still loading goals + building the projection. */
  loading?: boolean;
  /** How many school days the family is pausing for. Owned by the parent so
   *  the per-goal preview below is computed with the same projector call the
   *  write uses. */
  shiftDays: number;
  onShiftDaysChange: (days: number) => void;
  /** One row per affected curriculum, already projected for `shiftDays`. */
  goals: ReprojectGoalPreview[];
  /** How many lessons the family is currently behind. Drives the copy only. */
  missedCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export default function PushBackModal(props: PushBackModalProps) {
  const {
    isOpen, loading = false, shiftDays, onShiftDaysChange, goals, missedCount, onClose, onConfirm,
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
      setError(e instanceof Error ? e.message : "Couldn't push schedule back");
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
              <h2 className="text-base font-bold text-[#2d2926]">Push schedule back</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">Shift upcoming lessons to fit missed ones in.</p>
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

          <div className="px-5 pb-4 pt-1 space-y-3 overflow-y-auto">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                School days to shift
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                value={shiftDays}
                disabled={loading}
                onChange={(e) => {
                  const n = parseInt(e.target.value || "0", 10);
                  onShiftDaysChange(Number.isFinite(n) ? Math.max(1, Math.min(90, n)) : 1);
                }}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 disabled:opacity-50"
              />
            </label>

            {loading ? (
              <p className="text-[12px] text-[#7a6f65] leading-relaxed">
                Checking your whole schedule, one moment…
              </p>
            ) : goals.length === 0 ? (
              <p className="text-[12px] text-[#9a8e84] leading-relaxed">
                Nothing to push back right now.
              </p>
            ) : (
              <>
                {/* Honest about scope: this re-spreads what is left of each
                    curriculum from the day it resumes, rather than promising a
                    per-lesson mapping the projector may not reproduce. */}
                <p className="text-[12px] text-[#7a6f65] leading-relaxed">
                  Everything still to come pauses for{" "}
                  <span className="font-semibold text-[#2d2926]">{shiftDays}</span> school day
                  {shiftDays === 1 ? "" : "s"}, then picks up again in lesson order on each
                  curriculum&apos;s own school days.
                  {missedCount > 0 ? (
                    <> Your {missedCount} missed lesson{missedCount === 1 ? "" : "s"} come along with it.</>
                  ) : null}
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
                        {g.lessonCount} lesson{g.lessonCount === 1 ? "" : "s"}
                        {g.firstDate ? (
                          <>
                            {" resume "}
                            <span className="font-semibold text-[#2D5A3D] tabular-nums">
                              {formatDate(g.firstDate)}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}
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
              disabled={submitting || loading || goals.length === 0}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? "Pushing back…"
                : loading
                  ? "Loading…"
                  : `Push back ${totalLessons} lesson${totalLessons === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
