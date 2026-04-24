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
 * ShiftForwardModal — preview + confirm for catch-up shift.
 *
 * Assigns each missed lesson (in their existing scheduled_date order) to
 * the next available teaching day starting from today. The assignment is
 * pure (no DB writes here); the parent handler receives the target-date
 * mapping and runs the batch UPDATE + audit event + undo.
 *
 * If the user has no school_days configured, we fall back to Mon-Fri via
 * the helper's DEFAULT_SCHOOL_DAYS constant at the call site.
 * ==========================================================================*/

export type ShiftMove = {
  lesson: PlanV2Lesson;
  fromDate: string;
  toDate: string;
};

export interface ShiftForwardModalProps {
  isOpen: boolean;
  missed: PlanV2Lesson[];
  schoolDays: string[];
  vacationBlocks: VacationRange[];
  onClose: () => void;
  onConfirm: (moves: ShiftMove[]) => Promise<void>;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export default function ShiftForwardModal(props: ShiftForwardModalProps) {
  const { isOpen, missed, schoolDays, vacationBlocks, onClose, onConfirm } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the from→to preview. Sort by existing scheduled_date so the
  // earliest missed lesson lands on the earliest vacant teaching day.
  const moves = useMemo<ShiftMove[]>(() => {
    if (!isOpen || missed.length === 0) return [];
    const sorted = [...missed].sort((a, b) => {
      const da = a.scheduled_date ?? a.date ?? "";
      const db = b.scheduled_date ?? b.date ?? "";
      return da.localeCompare(db);
    });
    const today = todayDateStr();
    return sorted.map((lesson, idx) => {
      const fromDate = lesson.scheduled_date ?? lesson.date ?? today;
      const toDate = nthSchoolDay(today, schoolDays, idx + 1, vacationBlocks);
      return { lesson, fromDate, toDate };
    });
  }, [isOpen, missed, schoolDays, vacationBlocks]);

  if (!isOpen) return null;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(moves);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't shift lessons");
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
                Shifting {moves.length} missed lesson{moves.length === 1 ? "" : "s"} to the next school day
                {moves.length === 1 ? "" : "s"}.
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
            {moves.length === 0 ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">Nothing to shift right now.</p>
            ) : (
              <ul className="space-y-1">
                {moves.slice(0, 20).map((m) => {
                  const title =
                    m.lesson.title && m.lesson.title.trim().length > 0
                      ? m.lesson.title
                      : m.lesson.lesson_number
                        ? `Lesson ${m.lesson.lesson_number}`
                        : "Lesson";
                  return (
                    <li
                      key={m.lesson.id}
                      className="flex items-center justify-between gap-2 text-[12px] text-[#2d2926]"
                      style={{
                        background: "white",
                        border: "0.5px solid #e8e2d9",
                        borderRadius: 10,
                        padding: "6px 10px",
                      }}
                    >
                      <span className="truncate">{title}</span>
                      <span className="shrink-0 tabular-nums text-[#7a6f65]">
                        {formatDate(m.fromDate)} → <span className="font-semibold text-[#2D5A3D]">{formatDate(m.toDate)}</span>
                      </span>
                    </li>
                  );
                })}
                {moves.length > 20 ? (
                  <li className="text-[11px] text-[#9a8e84] text-center pt-1">+ {moves.length - 20} more</li>
                ) : null}
              </ul>
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
              disabled={moves.length === 0 || submitting}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Shifting…" : "Shift forward"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
