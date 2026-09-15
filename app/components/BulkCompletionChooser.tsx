"use client";

import { useEffect, useRef } from "react";
import type { BulkCompletionChoice } from "@/app/lib/completeLessonOnDate";
import { labelDate } from "@/app/components/CompletionDateChooser";

/* ============================================================================
 * BulkCompletionChooser — "Mark these N done on:"
 *
 * The bulk twin of CompletionDateChooser (Invariant 16), asked once for a
 * whole selection before anything is written. Each lesson is then filed
 * through completeLessonOnDate exactly as a single check-off with the same
 * answer would file it (planBulkCompletion). Cancel writes nothing.
 * ==========================================================================*/

export interface BulkCompletionChooserProps {
  count: number;
  /** YYYY-MM-DD in the family's timezone. */
  today: string;
  onChoose: (choice: BulkCompletionChoice) => void;
  onCancel: () => void;
}

export default function BulkCompletionChooser({ count, today, onChoose, onCancel }: BulkCompletionChooserProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  const noun = count === 1 ? "this lesson" : `these ${count} lessons`;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[85]" onClick={onCancel} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Which day did you do ${noun}?`}
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
          <h2 className="text-[17px] font-medium text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
            Mark {noun} done on:
          </h2>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onChoose("planned")}
              className="w-full min-h-[52px] px-4 py-3 rounded-2xl text-left text-[15px] font-medium
                         text-white bg-[#2D5A3D] hover:opacity-90 transition-opacity"
            >
              {count === 1 ? "The day it was planned" : "The day each was planned"}
            </button>
            <button
              type="button"
              onClick={() => onChoose("today")}
              className="w-full min-h-[52px] px-4 py-3 rounded-2xl text-left text-[15px] font-medium
                         text-[#2d2926] bg-white border border-[#e8e2d9] hover:bg-[#faf8f4] transition-colors"
            >
              Today, {labelDate(today)}
            </button>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-center text-[13px] text-[#b5aca4] hover:text-[#7a6f65] py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
