"use client";

// Missed Lesson Recovery modal. Shown on Today when overdueLessonCount > 0
// under Path A queue scheduling. Binary YES/NO: mark missed lessons done on
// their gap dates, or leave them and let the queue projector absorb them
// going forward from today. No close X — the user picks one. Caller
// (app/dashboard/page.tsx) is responsible for sessionStorage gating and
// data refresh after either choice.

import { useState } from "react";

export type MissedGoal = {
  id: string;
  curriculum_name: string;
  subject_label: string | null;
  child_id: string | null;
  child_name: string | null;
};

export type MissedEntry = {
  goal_id: string;
  // The "lesson_number" emitted by computeNextLessonsForGoal is actually a
  // queue slot index (current_lesson + N). Field name kept for parity with
  // ProjectedLesson + the existing CatchUpEntry shape. Under no-manual-move
  // it equals the canonical lesson_number; after a Plan move it diverges.
  lesson_number: number;
  date: string; // YYYY-MM-DD, the gap school day this lesson would have been due
};

type Props = {
  goals: MissedGoal[];
  entriesByGoal: Map<string, MissedEntry[]>;
  onYes: () => Promise<void>;
  onNo: () => Promise<void>;
};

export default function MissedLessonRecoveryModal({ goals, entriesByGoal, onYes, onNo }: Props) {
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);

  const goalsWithEntries = goals.filter((g) => (entriesByGoal.get(g.id) ?? []).length > 0);
  if (goalsWithEntries.length === 0) return null;

  async function handleYes() {
    if (submitting) return;
    setSubmitting("yes");
    try {
      await onYes();
    } finally {
      setSubmitting(null);
    }
  }

  async function handleNo() {
    if (submitting) return;
    setSubmitting("no");
    try {
      await onNo();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[80]" aria-hidden="true" />
      <div
        className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="missed-recovery-title"
      >
        <div className="p-5">
          <h3
            id="missed-recovery-title"
            className="text-base font-medium text-[var(--g-deep)] mb-3"
            style={{ fontFamily: "var(--font-display)" }}
          >
            You have lessons from earlier
          </h3>

          <div className="space-y-2 mb-5">
            {goalsWithEntries.map((g) => {
              const entries = entriesByGoal.get(g.id) ?? [];
              const first = entries[0].lesson_number;
              const last = entries[entries.length - 1].lesson_number;
              const subject = g.subject_label ?? g.curriculum_name;
              const prefix = g.child_name ? `${g.child_name} · ${subject}` : subject;
              const range = first === last ? `Lesson ${first}` : `Lesson ${first} through Lesson ${last}`;
              const lessonWord = entries.length === 1 ? "lesson" : "lessons";
              return (
                <div
                  key={g.id}
                  className="text-[13px] text-[#2d2926] bg-white border border-[#e8e2d9] rounded-xl px-3 py-2.5"
                >
                  <span className="font-medium">{prefix}</span>
                  <span className="text-[#7a6f65]">
                    : {entries.length} {lessonWord} ({range})
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleYes}
              disabled={submitting !== null}
              className="w-full py-3 rounded-xl bg-[#2D5A3D] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 disabled:pointer-events-none"
            >
              {submitting === "yes" ? "Marking done..." : "Yes, mark them done"}
            </button>
            <button
              type="button"
              onClick={handleNo}
              disabled={submitting !== null}
              className="w-full py-3 rounded-xl bg-white border border-[#cfc9c0] text-[#2d2926] text-sm font-medium hover:bg-[#f4f0e8] transition-colors disabled:opacity-60 disabled:pointer-events-none"
            >
              {submitting === "no" ? "Rescheduling..." : "No, reschedule them"}
            </button>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </>
  );
}
