"use client";

// Catch-up modal — shown on Today after a 5+ day gap with no completed
// lessons. Lists what would have been due on each missed school day so
// mom can check off what she actually did. Submit advances current_lesson
// per goal; dismiss leaves the queue alone (Today renders the next-in-
// queue lesson, effectively block-shifting the schedule forward).
//
// Path A queue-based scheduling, 2026-05. See app/lib/scheduler.ts and
// supabase/migrations/20260501100000_queue_based_scheduling.sql.

import { useMemo, useState } from "react";

export type CatchUpGoal = {
  id: string;
  curriculum_name: string;
  subject_label: string | null;
  child_id: string | null;
  child_name: string | null;
};

export type CatchUpEntry = {
  goal_id: string;
  lesson_number: number;
  date: string; // YYYY-MM-DD, the school day this lesson would have been done
};

export type CatchUpSubmission = {
  // Map of goal_id → array of {lesson_number, completed_on_date} that mom checked off.
  done: { goal_id: string; lesson_number: number; date: string }[];
};

type Props = {
  // Most recent completion across all goals, formatted YYYY-MM-DD.
  // Null means the family hasn't completed anything yet — modal uses
  // "since you started" copy in that case.
  lastCompletionDate: string | null;
  // Pre-grouped catch-up entries per goal. Caller (dashboard/page.tsx)
  // computed these via computeGapLessonsForGoal at modal-open time so
  // the modal stays presentational.
  goals: CatchUpGoal[];
  entriesByGoal: Map<string, CatchUpEntry[]>;
  onSubmit: (submission: CatchUpSubmission) => Promise<void>;
  onDismiss: () => Promise<void>;
};

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function formatLastCompletion(lastCompletionDate: string | null): string {
  if (!lastCompletionDate) return "you started";
  const d = new Date(lastCompletionDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default function CatchUpModal({ lastCompletionDate, goals, entriesByGoal, onSubmit, onDismiss }: Props) {
  // Map of `${goal_id}|${lesson_number}` → date checked.
  const [checked, setChecked] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const goalsWithEntries = useMemo(() => {
    return goals.filter((g) => (entriesByGoal.get(g.id) ?? []).length > 0);
  }, [goals, entriesByGoal]);

  if (goalsWithEntries.length === 0) return null;

  function toggle(goalId: string, lessonNumber: number, date: string) {
    setChecked((prev) => {
      const next = new Map(prev);
      const k = `${goalId}|${lessonNumber}`;
      if (next.has(k)) next.delete(k);
      else next.set(k, date);
      return next;
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    const done = Array.from(checked.entries()).map(([k, date]) => {
      const [goal_id, lessonStr] = k.split("|");
      return { goal_id, lesson_number: parseInt(lessonStr, 10), date };
    });
    await onSubmit({ done });
    // Parent owns dismissal + close on success.
  }

  async function handleDismiss() {
    if (submitting) return;
    setSubmitting(true);
    await onDismiss();
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-[80]"
        onClick={() => { if (!submitting) handleDismiss(); }}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catchup-title"
      >
        <div className="p-5">
          <h3
            id="catchup-title"
            className="text-base font-medium text-[var(--g-deep)] mb-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Welcome back. Looks like it has been a few days.
          </h3>
          <p className="text-sm text-[#5C5346] mb-4">
            Did you do any lessons since {formatLastCompletion(lastCompletionDate)}?
            <br />
            <span className="text-[13px] text-[#7a6f65]">
              Check off whatever you actually did. We will pick up from there.
            </span>
          </p>

          <div className="space-y-4">
            {goalsWithEntries.map((goal) => {
              const entries = entriesByGoal.get(goal.id) ?? [];
              // Group by date for display.
              const byDate = new Map<string, CatchUpEntry[]>();
              for (const e of entries) {
                if (!byDate.has(e.date)) byDate.set(e.date, []);
                byDate.get(e.date)!.push(e);
              }
              const orderedDates = Array.from(byDate.keys()).sort();
              const goalDisplay = [goal.subject_label, goal.curriculum_name].filter(Boolean).join(" · ");
              const childTag = goal.child_name ? ` (${goal.child_name})` : "";

              return (
                <div key={goal.id} className="bg-white rounded-xl border border-[#e8e2d9] p-3">
                  <p className="text-[13px] font-medium text-[#2d2926] mb-2">
                    {goalDisplay || goal.curriculum_name}{childTag}
                  </p>
                  <div className="space-y-2">
                    {orderedDates.map((dateStr) => {
                      const items = byDate.get(dateStr)!;
                      return (
                        <div key={dateStr}>
                          <p className="text-[11px] uppercase tracking-wider text-[#8a8580] mb-1">
                            {formatDateLabel(dateStr)}
                          </p>
                          <div className="space-y-1">
                            {items.map((it) => {
                              const k = `${it.goal_id}|${it.lesson_number}`;
                              const isChecked = checked.has(k);
                              return (
                                <label
                                  key={k}
                                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[#f8f6f1]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggle(it.goal_id, it.lesson_number, it.date)}
                                    className="w-4 h-4 rounded border-[#cfc9c0]"
                                  />
                                  <span className="text-[13px] text-[#2d2926]">
                                    Lesson {it.lesson_number}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 mt-5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-[#2D5A3D] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 disabled:pointer-events-none"
            >
              {submitting ? "Saving..." : "Save what I did"}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={submitting}
              className="w-full py-2.5 text-sm font-medium text-[#7a6f65] hover:text-[#2d2926] transition-colors disabled:opacity-60 disabled:pointer-events-none"
            >
              I did not do any of these
            </button>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </>
  );
}
