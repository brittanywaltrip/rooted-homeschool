"use client";

import { useMemo, useState } from "react";
import type { PlanV2Lesson } from "./types";
import { isSchoolDayDate, isInVacation, type VacationRange } from "@/lib/school-days";

/* ============================================================================
 * BackfillPanel — "log past hours" sub-panel for a curriculum goal.
 *
 * Surfaces past school days (past 30 days, limited to teaching days) that
 * don't already have a lesson logged for this goal. For each row the
 * parent can enter minutes + optional notes; Save writes a lesson row per
 * filled-in day with is_backfill=true, completed=true, completed_at=that
 * date, scheduled_date=that date, curriculum_goal_id=goalId.
 *
 * The parent owns the DB write + audit logging (lesson.created with
 * actor='backfill'); this component only collects input and hands back a
 * normalized payload.
 * ==========================================================================*/

export type BackfillEntry = {
  date: string;
  minutes: number;
  notes: string | null;
};

export interface BackfillPanelProps {
  /** The goal's id — used by the parent to tag inserted rows. */
  goalId: string;
  /** Default minutes per lesson from the goal (usually goal.default_minutes). */
  defaultMinutes: number;
  /** Every lesson already tied to this goal so we can omit days that are
   *  already covered. */
  goalLessons: PlanV2Lesson[];
  schoolDays: string[];
  vacationBlocks: VacationRange[];
  onSubmit: (entries: BackfillEntry[]) => Promise<void>;
  onClose: () => void;
}

const LOOKBACK_DAYS = 30;

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function BackfillPanel(props: BackfillPanelProps) {
  const { defaultMinutes, goalLessons, schoolDays, vacationBlocks, onSubmit, onClose } = props;
  const [values, setValues] = useState<Record<string, { minutes: string; notes: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Days already covered by a lesson for this goal (regardless of completion).
  const coveredDays = useMemo(() => {
    const s = new Set<string>();
    for (const l of goalLessons) {
      const d = l.scheduled_date ?? l.date;
      if (d) s.add(d);
    }
    return s;
  }, [goalLessons]);

  const candidateDates = useMemo(() => {
    const out: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - LOOKBACK_DAYS);
    while (cursor < today) {
      const s = toDateStr(cursor);
      if (isSchoolDayDate(s, schoolDays) && !isInVacation(s, vacationBlocks) && !coveredDays.has(s)) {
        out.push(s);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return out.reverse();
  }, [schoolDays, vacationBlocks, coveredDays]);

  function setField(date: string, field: "minutes" | "notes", v: string) {
    setValues((prev) => ({ ...prev, [date]: { ...(prev[date] ?? { minutes: "", notes: "" }), [field]: v } }));
  }

  async function handleSubmit() {
    if (submitting) return;
    const entries: BackfillEntry[] = [];
    for (const date of candidateDates) {
      const v = values[date];
      if (!v) continue;
      const minsStr = v.minutes.trim();
      if (minsStr.length === 0) continue;
      const mins = parseInt(minsStr, 10);
      if (!Number.isFinite(mins) || mins <= 0) continue;
      entries.push({ date, minutes: mins, notes: v.notes.trim().length > 0 ? v.notes.trim() : null });
    }
    if (entries.length === 0) {
      setError("Enter minutes for at least one day to save.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(entries);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save backfill");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] font-semibold text-[#7a4a1a]">
          Log past hours · last {LOOKBACK_DAYS} school days
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-[#7a6f65] hover:text-[#2d2926]"
        >
          Close
        </button>
      </div>

      {candidateDates.length === 0 ? (
        <p className="text-[11px] text-[#9a8e84] italic">
          Nothing to log — the last {LOOKBACK_DAYS} school days are already covered.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {candidateDates.slice(0, 30).map((date) => {
              const v = values[date] ?? { minutes: "", notes: "" };
              return (
                <li key={date} className="flex items-center gap-2 bg-white border border-[#f0dda8] rounded-lg px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-[#2d2926] min-w-[110px] tabular-nums">
                    {formatDate(date)}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder={`${defaultMinutes}`}
                    value={v.minutes}
                    onChange={(e) => setField(date, "minutes", e.target.value)}
                    aria-label={`Minutes on ${formatDate(date)}`}
                    className="w-[68px] text-[11px] border border-[#e8e2d9] rounded-md bg-white px-2 py-1 focus:outline-none focus:border-[#5c7f63]"
                  />
                  <span className="text-[10px] text-[#9a8e84]">min</span>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={v.notes}
                    onChange={(e) => setField(date, "notes", e.target.value)}
                    aria-label={`Notes on ${formatDate(date)}`}
                    className="flex-1 min-w-0 text-[11px] border border-[#e8e2d9] rounded-md bg-white px-2 py-1 focus:outline-none focus:border-[#5c7f63]"
                  />
                </li>
              );
            })}
          </ul>
          {candidateDates.length > 30 ? (
            <p className="text-[10px] text-[#9a8e84] text-center">
              + {candidateDates.length - 30} more days — save these first, then open again.
            </p>
          ) : null}

          {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-[11px] font-semibold text-[#7a6f65] px-3 py-1.5 rounded-lg hover:bg-[#f0ede8] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="text-[11px] font-bold text-white bg-[#2D5A3D] hover:bg-[var(--g-deep)] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save logs"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
