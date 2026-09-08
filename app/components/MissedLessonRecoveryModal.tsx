"use client";

// Missed Lesson Recovery modal. Shown on Today when overdueLessonCount > 0
// under Path A queue scheduling.
//
// This prompt is about to write a completion date for every lesson it lists, so
// it SHOWS every one of those dates first (Invariant 16, extended to the bulk
// paths). It used to render one line per goal — "Zoe · Math: 9 lessons (Lesson
// 15 through Lesson 23)" — and a single Yes stamped nine rows across nine days
// the family never saw. That is the shape behind the September 2 support case:
// 21 lessons written in 72 seconds, none on a day the family did the work.
//
// Every row starts checked, so an honest yes is still one tap. Anything the
// family unchecks is not written and not rescheduled either; it stays exactly
// as it was.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import CompletionDateChooser, { labelDate } from "@/app/components/CompletionDateChooser";
import {
  COLLAPSE_OVER,
  buildRecoveryRows,
  entryKey as rowKey,
  initialCheckedKeys,
  isOverCap,
  schoolDaySpan,
  type MissedEntry,
  type RecoveryRow,
} from "@/app/lib/recoverySelection";

export type { MissedEntry, RecoveryRow };

export type MissedGoal = {
  id: string;
  curriculum_name: string;
  subject_label: string | null;
  child_id: string | null;
  child_name: string | null;
};

type Props = {
  goals: MissedGoal[];
  entriesByGoal: Map<string, MissedEntry[]>;
  onYes: (rows: RecoveryRow[]) => Promise<void>;
  onNo: () => Promise<void>;
  // Dismiss without changing any lesson. Leaves every lesson exactly as is.
  onDismiss: () => void;
  /** YYYY-MM-DD in the family's timezone, for the date chooser. */
  today: string;
  /** Fired once when the prompt is shown. */
  onShown?: (info: { goals: number; entries: number; entries_over_cap: number }) => void;
};

export default function MissedLessonRecoveryModal({
  goals,
  entriesByGoal,
  onYes,
  onNo,
  onDismiss,
  today,
  onShown,
}: Props) {
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);

  const goalsWithEntries = useMemo(
    () => goals.filter((g) => (entriesByGoal.get(g.id) ?? []).length > 0),
    [goals, entriesByGoal],
  );

  const allEntries = useMemo(
    () => goalsWithEntries.flatMap((g) => entriesByGoal.get(g.id) ?? []),
    [goalsWithEntries, entriesByGoal],
  );

  // Checked by default, except under an over-cap goal (see RECOVERY_SPAN_CAP).
  const [checked, setChecked] = useState<Set<string>>(() =>
    initialCheckedKeys(entriesByGoal, goalsWithEntries.map((g) => g.id)),
  );

  // Dates the family changed. Absent means "the gap day we proposed".
  const [editedDates, setEditedDates] = useState<Record<string, string>>({});

  // Long prompts collapse so nobody is one tap from writing dates they have
  // not scrolled to. The dates are in the collapsed summary line as well.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (allEntries.length <= COLLAPSE_OVER) return new Set(goalsWithEntries.map((g) => g.id));
    return new Set();
  });

  const [choosingFor, setChoosingFor] = useState<
    { entry: MissedEntry; label: string } | null
  >(null);

  useEffect(() => {
    if (goalsWithEntries.length === 0) return;
    onShown?.({
      goals: goalsWithEntries.length,
      entries: allEntries.length,
      entries_over_cap: goalsWithEntries
        .filter((g) => isOverCap(entriesByGoal.get(g.id) ?? []))
        .reduce((n, g) => n + (entriesByGoal.get(g.id) ?? []).length, 0),
    });
    // Once per mount: this is an impression, not a state mirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (goalsWithEntries.length === 0) return null;

  const dateFor = (e: MissedEntry) => editedDates[rowKey(e)] ?? e.date;
  const checkedCount = checked.size;

  function toggleRow(e: MissedEntry) {
    const key = rowKey(e);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGoal(goalId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }

  async function handleYes() {
    if (submitting || checkedCount === 0) return;
    // Only what the family left checked, each carrying the date on screen.
    const rows: RecoveryRow[] = buildRecoveryRows({
      entriesByGoal,
      goalIds: goalsWithEntries.map((g) => g.id),
      checked,
      editedDates,
    });
    setSubmitting("yes");
    try {
      await onYes(rows);
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
        <button
          type="button"
          onClick={onDismiss}
          disabled={submitting !== null}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors disabled:opacity-60 disabled:pointer-events-none"
        >
          <X size={18} />
        </button>
        <div className="p-5">
          <h3
            id="missed-recovery-title"
            className="text-base font-medium text-[var(--g-deep)] mb-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            You have lessons from earlier
          </h3>
          <p className="text-[12px] text-[#7a6f65] leading-snug mb-3">
            These are the days Rooted thinks each lesson was due. Uncheck anything you
            did not do, or tap a date to change it.
          </p>

          <div className="space-y-2 mb-4">
            {goalsWithEntries.map((g) => {
              const entries = entriesByGoal.get(g.id) ?? [];
              const subject = g.subject_label ?? g.curriculum_name;
              const prefix = g.child_name ? `${g.child_name} · ${subject}` : subject;
              const isOpen = expanded.has(g.id);
              const overCap = isOverCap(entries);
              const span = schoolDaySpan(entries);
              const firstDate = entries[0]?.date;
              const lastDate = entries[entries.length - 1]?.date;
              const lessonWord = entries.length === 1 ? "lesson" : "lessons";

              return (
                <div
                  key={g.id}
                  className="bg-white border border-[#e8e2d9] rounded-xl overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleGoal(g.id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[#faf8f4] transition-colors"
                  >
                    <span className="mt-0.5 shrink-0 text-[#7a6f65]">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[#2d2926]">
                        {prefix}
                      </span>
                      {/* The dates are in the collapsed line too: nobody should
                          be one tap from writing days they have not seen. */}
                      <span className="block text-[12px] text-[#7a6f65]">
                        {entries.length} {lessonWord}
                        {firstDate ? `, ${labelDate(firstDate)}` : ""}
                        {lastDate && lastDate !== firstDate ? ` to ${labelDate(lastDate)}` : ""}
                      </span>
                    </span>
                  </button>

                  {overCap && (
                    <p className="mx-3 mb-2 text-[12px] text-[#7a4a1a] bg-[#fdf6e8] border border-[#e8d9a8] rounded-lg px-2.5 py-2 leading-snug">
                      That&apos;s {span} school days. If you took a break, add it under
                      Plan and these will move on their own.
                    </p>
                  )}

                  {isOpen && (
                    <ul className="border-t border-[#f0ede8]">
                      {entries.map((e) => {
                        const key = rowKey(e);
                        const on = checked.has(key);
                        const shown = dateFor(e);
                        const changed = shown !== e.date;
                        return (
                          <li
                            key={key}
                            className="flex items-center gap-2.5 px-3 py-2 border-b border-[#f6f3ee] last:border-b-0"
                          >
                            <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={submitting !== null}
                                onChange={() => toggleRow(e)}
                                className="w-4 h-4 shrink-0 accent-[#5c7f63] cursor-pointer"
                              />
                              <span className="text-[13px] text-[#2d2926] shrink-0">
                                Lesson {e.lesson_number}
                              </span>
                            </label>
                            <button
                              type="button"
                              disabled={submitting !== null}
                              onClick={() =>
                                setChoosingFor({ entry: e, label: `Lesson ${e.lesson_number}` })
                              }
                              aria-label={`Change the date for lesson ${e.lesson_number}, currently ${labelDate(shown)}`}
                              className={`shrink-0 text-[12px] min-h-[32px] px-2.5 rounded-lg border transition-colors ${
                                changed
                                  ? "text-[#2D5A3D] border-[#c5dbc9] bg-[#f0f7f2] font-medium"
                                  : "text-[#7a6f65] border-[#e8e2d9] bg-white hover:bg-[#faf8f4]"
                              }`}
                            >
                              {labelDate(shown)}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleYes}
              disabled={submitting !== null || checkedCount === 0}
              className="w-full py-3 rounded-xl bg-[#2D5A3D] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
            >
              {submitting === "yes"
                ? "Marking done..."
                : checkedCount === 0
                  ? "Nothing selected"
                  : `Mark ${checkedCount} done on these days`}
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

      {choosingFor && (
        <CompletionDateChooser
          lessonTitle={choosingFor.label}
          plannedDate={choosingFor.entry.date}
          today={today}
          onCancel={() => setChoosingFor(null)}
          onChoose={(dateStr) => {
            const key = rowKey(choosingFor.entry);
            setEditedDates((prev) => ({ ...prev, [key]: dateStr }));
            // Changing a date is a statement that this one happened, so it
            // comes back checked if it had been unchecked.
            setChecked((prev) => new Set(prev).add(key));
            setChoosingFor(null);
          }}
        />
      )}
    </>
  );
}
