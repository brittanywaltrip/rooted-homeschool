"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PlanV2Lesson } from "./types";
import {
  nthSchoolDay,
  todayDateStr,
  type VacationRange,
} from "@/lib/school-days";

/* ============================================================================
 * PushBackModal — shift the whole future schedule forward by N school days,
 * then drop the missed lessons into the now-vacated near-term slots.
 *
 * Algorithm (implemented at the parent via the two move lists we emit):
 *   1. For every lesson with scheduled_date > today and completed=false,
 *      set new date = nthSchoolDay(original, schoolDays, N, vacations).
 *      This preserves relative order because nthSchoolDay is monotonic.
 *   2. For every missed lesson (scheduled_date <= today, incomplete), in
 *      original-date order, assign it to nthSchoolDay(today, schoolDays, i+1).
 *      Since step 1 vacated the first N teaching days, the mapping is
 *      collision-free against the future set (no double-booking).
 *
 * We emit the two mapping arrays; parent runs the UPDATE batches + records
 * two distinct audit events so the Recent Changes card can summarize each
 * half of the rebalance separately.
 * ==========================================================================*/

export type PushBackMove = {
  lesson: PlanV2Lesson;
  fromDate: string;
  toDate: string;
};

export interface PushBackModalProps {
  isOpen: boolean;
  missed: PlanV2Lesson[];
  futureLessons: PlanV2Lesson[];
  schoolDays: string[];
  vacationBlocks: VacationRange[];
  onClose: () => void;
  onConfirm: (args: {
    futureMoves: PushBackMove[];
    missedMoves: PushBackMove[];
    shiftDays: number;
  }) => Promise<void>;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export default function PushBackModal(props: PushBackModalProps) {
  const {
    isOpen, missed, futureLessons, schoolDays, vacationBlocks, onClose, onConfirm,
  } = props;
  const defaultShift = Math.max(1, missed.length);
  const [shift, setShift] = useState<number>(defaultShift);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recompute default whenever the modal opens with a new missed count.
  useMemo(() => {
    if (isOpen) setShift(defaultShift);
  }, [isOpen, defaultShift]);

  const futureMoves = useMemo<PushBackMove[]>(() => {
    if (!isOpen || shift <= 0) return [];
    return futureLessons.map((lesson) => {
      const from = lesson.scheduled_date ?? lesson.date ?? todayDateStr();
      const to = nthSchoolDay(from, schoolDays, shift, vacationBlocks);
      return { lesson, fromDate: from, toDate: to };
    });
  }, [isOpen, shift, futureLessons, schoolDays, vacationBlocks]);

  const missedMoves = useMemo<PushBackMove[]>(() => {
    if (!isOpen || shift <= 0 || missed.length === 0) return [];
    const sorted = [...missed].sort((a, b) => {
      const da = a.scheduled_date ?? a.date ?? "";
      const db = b.scheduled_date ?? b.date ?? "";
      return da.localeCompare(db);
    });
    const today = todayDateStr();
    // Only the first `shift` missed lessons are guaranteed to fit into the
    // vacated near-term slots. Anything beyond would collide with what we
    // just pushed forward — assign them too but the parent can still audit
    // the mismatch if relevant.
    return sorted.map((lesson, idx) => {
      const from = lesson.scheduled_date ?? lesson.date ?? today;
      const to = nthSchoolDay(today, schoolDays, idx + 1, vacationBlocks);
      return { lesson, fromDate: from, toDate: to };
    });
  }, [isOpen, shift, missed, schoolDays, vacationBlocks]);

  if (!isOpen) return null;

  const firstVacated = missedMoves[0]?.toDate;
  const lastVacated = missedMoves[missedMoves.length - 1]?.toDate;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ futureMoves, missedMoves, shiftDays: shift });
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
                value={shift}
                onChange={(e) => {
                  const n = parseInt(e.target.value || "0", 10);
                  setShift(Number.isFinite(n) ? Math.max(1, Math.min(90, n)) : 1);
                }}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              />
            </label>

            <p className="text-[12px] text-[#2d2926] leading-relaxed">
              <span className="font-semibold">{futureMoves.length}</span> future lesson{futureMoves.length === 1 ? "" : "s"} will move forward by <span className="font-semibold">{shift}</span> school day{shift === 1 ? "" : "s"}.
              {missed.length > 0 && firstVacated ? (
                <>
                  <br />
                  Your missed <span className="font-semibold">{missed.length}</span> lesson{missed.length === 1 ? "" : "s"} will fit into{" "}
                  <span className="font-semibold text-[#2D5A3D]">
                    {formatDate(firstVacated)}
                    {lastVacated && lastVacated !== firstVacated ? ` → ${formatDate(lastVacated)}` : ""}
                  </span>.
                </>
              ) : null}
            </p>

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
              disabled={submitting || (futureMoves.length === 0 && missedMoves.length === 0)}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Pushing back…" : "Push schedule back"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
