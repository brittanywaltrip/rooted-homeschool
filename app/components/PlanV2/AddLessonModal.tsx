"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PlanV2Child } from "./types";

/* ============================================================================
 * AddLessonModal — single-lesson insert from the Plan toolbar or day context
 * menu. Minimal form: the common homeschool case is "add one more thing to
 * Tuesday." Curriculum goal is optional so one-off lessons don't need setup.
 *
 * Subject is a free-text field; we don't look it up in the subjects table
 * (that'd require upsert logic tangled with the current subject-goals wiring).
 * When provided, it's prepended to the title as "Subject · Title" so it
 * reads naturally in LessonPill's existing `${subject} · ${label}` display.
 *
 * Presentational + submit. The parent owns the actual DB write + optimistic
 * state + audit event (for the full add-with-undo path); this modal just
 * collects input and yields a normalized submission payload.
 * ========================================================================== */

export type AddLessonGoalOption = {
  id: string;
  curriculum_name: string;
  child_id: string | null;
};

export type AddLessonSubmit = {
  child_id: string;
  curriculum_goal_id: string | null;
  title: string;
  lesson_number: number | null;
  minutes_spent: number | null;
  scheduled_date: string;
  notes: string | null;
};

export interface AddLessonModalProps {
  isOpen: boolean;
  initialDate: string;
  childrenList: PlanV2Child[];
  goals: AddLessonGoalOption[];
  onClose: () => void;
  /** Resolves when the insert commits — parent awaits so we can show the
   *  "Adding…" / "Couldn't save" state accurately. */
  onSubmit: (values: AddLessonSubmit) => Promise<void>;
}

export default function AddLessonModal(props: AddLessonModalProps) {
  const { isOpen, initialDate, childrenList: kids, goals, onClose, onSubmit } = props;

  const [childId, setChildId] = useState<string>("");
  const [goalId, setGoalId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(initialDate);
  const [lessonNumber, setLessonNumber] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Reset when the modal reopens so a prior entry doesn't leak into the next.
  useEffect(() => {
    if (!isOpen) return;
    setChildId(kids[0]?.id ?? "");
    setGoalId("");
    setTitle("");
    setSubject("");
    setDate(initialDate);
    setLessonNumber("");
    setMinutes("");
    setNotes("");
    setError(null);
    setSubmitting(false);
    // Focus the title field once the modal content mounts.
    setTimeout(() => titleInputRef.current?.focus(), 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Scope goal dropdown to the picked child (goals are per-child). When a
  // child with no goals is selected, the dropdown just shows "(no goal)".
  const goalsForChild = goals.filter((g) => !g.child_id || g.child_id === childId);

  if (!isOpen) return null;

  const canSubmit = !!childId && !!date && (title.trim().length > 0 || subject.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const rawTitle = title.trim();
    const subj = subject.trim();
    const finalTitle = subj
      ? `${subj}${rawTitle ? ` · ${rawTitle}` : ""}`
      : rawTitle || "Lesson";
    const parsedLessonNumber = lessonNumber.trim().length > 0 ? parseInt(lessonNumber, 10) : NaN;
    const parsedMinutes = minutes.trim().length > 0 ? parseInt(minutes, 10) : NaN;

    try {
      await onSubmit({
        child_id: childId,
        curriculum_goal_id: goalId || null,
        title: finalTitle,
        lesson_number: Number.isFinite(parsedLessonNumber) && parsedLessonNumber > 0 ? parsedLessonNumber : null,
        minutes_spent: Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : null,
        scheduled_date: date,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add lesson");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <form
          onSubmit={handleSubmit}
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">Add a lesson</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">One-off or tied to a curriculum goal.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel add lesson"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-4 pt-2 space-y-3 overflow-y-auto">
            {/* Child */}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                Child
              </span>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              >
                {kids.length === 0 ? <option value="">(no children)</option> : null}
                {kids.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            {/* Curriculum goal (optional) */}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                Curriculum goal
              </span>
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              >
                <option value="">(no goal — one-off lesson)</option>
                {goalsForChild.map((g) => (
                  <option key={g.id} value={g.id}>{g.curriculum_name}</option>
                ))}
              </select>
            </label>

            {/* Subject + Title side by side on sm+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                  Subject
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Math"
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                  Title
                </span>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Fractions"
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
            </div>

            {/* Date + Lesson number + Minutes */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block col-span-2 sm:col-span-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                  Date
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                  Lesson #
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={lessonNumber}
                  onChange={(e) => setLessonNumber(e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                  Minutes
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
            </div>

            {/* Notes */}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                Notes
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Prep items, extra activities, reminders…"
                rows={2}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] resize-none focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              />
            </label>

            {error ? (
              <p className="text-[11px] text-[#b91c1c]">{error}</p>
            ) : null}
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
              type="submit"
              disabled={!canSubmit || submitting}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding…" : "Add lesson"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
