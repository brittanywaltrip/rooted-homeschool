"use client";

import { useEffect, useRef, useState } from "react";
import type { CompletionChoice } from "@/app/lib/completeLessonOnDate";

/* ============================================================================
 * CompletionDateChooser — "which day did you do this?"
 *
 * Shown before a completion is written, and only when the date is not today
 * (see needsDateChoice). Nothing is stored until the family answers, so Cancel
 * costs them nothing.
 *
 * One component for every surface — Today's list, the Plan calendar, the day
 * sheet — because the whole point of Invariant 16 is that the same question
 * gets the same answer wherever it is asked.
 * ==========================================================================*/

/** "Wed, Sep 2". Parsed from the parts so a YYYY-MM-DD never shifts a day. */
function labelDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface CompletionDateChooserProps {
  lessonTitle: string;
  /** The day the lesson sits on. Null when it has none. */
  plannedDate: string | null;
  /** YYYY-MM-DD in the family's timezone. */
  today: string;
  onChoose: (dateStr: string, choice: CompletionChoice) => void;
  onCancel: () => void;
}

export default function CompletionDateChooser({
  lessonTitle,
  plannedDate,
  today,
  onChoose,
  onCancel,
}: CompletionDateChooserProps) {
  const [picking, setPicking] = useState(false);
  const [pickedDate, setPickedDate] = useState(plannedDate ?? today);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes without writing, same as Cancel and the backdrop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // A planned day that IS today collapses the two primaries into one: there is
  // no second option to offer, and showing "Today" twice in different words
  // would read as a trick question.
  const hasDistinctPlanned = !!plannedDate && plannedDate !== today;
  const plannedIsFuture = !!plannedDate && plannedDate > today;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[85]"
        onClick={onCancel}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Which day did you do this lesson?"
        tabIndex={-1}
        className="fixed z-[86] bg-[#fefcf9] shadow-2xl outline-none
                   inset-x-0 bottom-0 rounded-t-3xl
                   sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2
                   sm:-translate-x-1/2 sm:-translate-y-1/2
                   sm:w-full sm:max-w-sm sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex justify-center pt-3 pb-2 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-[#e8e2d9]" />
        </div>

        <div className="px-5 pb-5 pt-2 sm:pt-5 space-y-4">
          <div>
            <h2
              className="text-[17px] font-medium text-[#2d2926]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Which day did you do this?
            </h2>
            <p className="text-[13px] text-[#7a6f65] mt-1 leading-snug break-words">
              {lessonTitle}
            </p>
          </div>

          {!picking ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onChoose(today, "today")}
                className="w-full min-h-[52px] px-4 py-3 rounded-2xl text-left text-[15px] font-medium
                           text-white bg-[#2D5A3D] hover:opacity-90 transition-opacity"
              >
                Today, {labelDate(today)}
              </button>

              {hasDistinctPlanned && (
                <button
                  type="button"
                  onClick={() => onChoose(plannedDate!, "planned")}
                  className="w-full min-h-[52px] px-4 py-3 rounded-2xl text-left text-[15px] font-medium
                             text-[#2d2926] bg-white border border-[#e8e2d9]
                             hover:bg-[#faf8f4] transition-colors"
                >
                  {plannedIsFuture
                    ? `Keep it on ${labelDate(plannedDate!)}`
                    : `The day it was planned, ${labelDate(plannedDate!)}`}
                </button>
              )}

              <button
                type="button"
                onClick={() => setPicking(true)}
                className="self-start text-[13px] text-[#5c7f63] font-medium py-2 px-1
                           hover:text-[var(--g-deep)] transition-colors"
              >
                Pick another day
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1.5">
                  Day
                </span>
                <input
                  type="date"
                  value={pickedDate}
                  autoFocus
                  onChange={(e) => setPickedDate(e.target.value)}
                  className="w-full min-h-[48px] px-3 py-2.5 rounded-xl border border-[#e8e2d9]
                             bg-white text-[15px] text-[#2d2926]
                             focus:outline-none focus:border-[#5c7f63]"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="flex-1 min-h-[48px] rounded-xl border border-[#e8e2d9]
                             text-[14px] font-medium text-[#7a6f65]
                             hover:bg-[#f0ede8] transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!pickedDate}
                  onClick={() => onChoose(pickedDate, "picked")}
                  className="flex-1 min-h-[48px] rounded-xl text-[14px] font-semibold text-white
                             bg-[#2D5A3D] hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  Log it
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="w-full text-center text-[13px] text-[#b5aca4]
                       hover:text-[#7a6f65] py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

export { labelDate };
