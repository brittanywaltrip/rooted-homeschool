"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PlanV2Child, PlanV2Lesson } from "./types";

/* ============================================================================
 * EditLessonModal — change the editable fields on an existing lesson.
 *
 * We surface the fields a parent most often wants to adjust mid-year:
 * title, subject (free-text, decorative), lesson_number, minutes_spent,
 * scheduled_date, curriculum_goal, child. Delete/skip/complete stay on
 * their own action surfaces (kebab menu, day panel buttons).
 *
 * The subject column in the DB is looked up via subject_id FK; rather
 * than reshape that, we split/merge subject out of `title` using a
 * " · " separator — matching LessonPill's display convention. Any
 * lesson whose title already contains that separator will be parsed
 * back into { subject, title } on open.
 * ========================================================================== */

export type EditLessonGoalOption = {
  id: string;
  curriculum_name: string;
  child_id: string | null;
};

/** Only the fields that actually changed are present. The parent uses
 * Object.keys(changes) to build the lesson.updated audit payload. */
export type EditLessonChanges = {
  title?: string;
  lesson_number?: number | null;
  minutes_spent?: number | null;
  scheduled_date?: string;
  curriculum_goal_id?: string | null;
  child_id?: string;
};

export interface EditLessonModalProps {
  isOpen: boolean;
  lesson: PlanV2Lesson | null;
  childrenList: PlanV2Child[];
  goals: EditLessonGoalOption[];
  onClose: () => void;
  onSubmit: (lessonId: string, changes: EditLessonChanges, originalValues: EditLessonChanges) => Promise<void>;
}

function splitTitle(raw: string | null): { subject: string; title: string } {
  if (!raw) return { subject: "", title: "" };
  const idx = raw.indexOf(" · ");
  if (idx === -1) return { subject: "", title: raw };
  return { subject: raw.slice(0, idx), title: raw.slice(idx + 3) };
}

function mergeTitle(subject: string, title: string): string {
  const s = subject.trim();
  const t = title.trim();
  if (s && t) return `${s} · ${t}`;
  if (s) return s;
  return t || "Lesson";
}

export default function EditLessonModal(props: EditLessonModalProps) {
  const { isOpen, lesson, childrenList: kids, goals, onClose, onSubmit } = props;

  const [childId, setChildId] = useState<string>("");
  const [goalId, setGoalId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [lessonNumber, setLessonNumber] = useState<string>("");
  const [minutes, setMinutes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !lesson) return;
    const { subject: s, title: t } = splitTitle(lesson.title);
    setSubject(s);
    setTitle(t);
    setChildId(lesson.child_id ?? "");
    setGoalId(lesson.curriculum_goal_id ?? "");
    setDate(lesson.scheduled_date ?? lesson.date ?? "");
    setLessonNumber(lesson.lesson_number != null ? String(lesson.lesson_number) : "");
    setMinutes(lesson.minutes_spent != null ? String(lesson.minutes_spent) : "");
    setError(null);
    setSubmitting(false);
    setTimeout(() => titleInputRef.current?.focus(), 20);
  }, [isOpen, lesson]);

  if (!isOpen || !lesson) return null;

  const goalsForChild = goals.filter((g) => !g.child_id || g.child_id === childId);

  const parsedLessonNumber = lessonNumber.trim().length > 0 ? parseInt(lessonNumber, 10) : null;
  const parsedMinutes = minutes.trim().length > 0 ? parseInt(minutes, 10) : null;

  const canSubmit = !!childId && !!date;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting || !lesson) return;

    const nextTitle = mergeTitle(subject, title);
    const origTitle = lesson.title ?? "";
    const origDate = lesson.scheduled_date ?? lesson.date ?? "";
    const origLessonNum = lesson.lesson_number ?? null;
    const origMinutes = lesson.minutes_spent ?? null;
    const origGoal = lesson.curriculum_goal_id ?? null;
    const origChild = lesson.child_id ?? "";

    const changes: EditLessonChanges = {};
    const originals: EditLessonChanges = {};

    if (nextTitle !== origTitle) {
      changes.title = nextTitle;
      originals.title = origTitle;
    }
    if (parsedLessonNumber !== origLessonNum && (parsedLessonNumber === null || (Number.isFinite(parsedLessonNumber) && parsedLessonNumber > 0))) {
      changes.lesson_number = parsedLessonNumber;
      originals.lesson_number = origLessonNum;
    }
    if (parsedMinutes !== origMinutes && (parsedMinutes === null || (Number.isFinite(parsedMinutes) && parsedMinutes > 0))) {
      changes.minutes_spent = parsedMinutes;
      originals.minutes_spent = origMinutes;
    }
    if (date !== origDate) {
      changes.scheduled_date = date;
      originals.scheduled_date = origDate;
    }
    const nextGoalId = goalId || null;
    if (nextGoalId !== origGoal) {
      changes.curriculum_goal_id = nextGoalId;
      originals.curriculum_goal_id = origGoal;
    }
    if (childId !== origChild) {
      changes.child_id = childId;
      originals.child_id = origChild;
    }

    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(lesson.id, changes, originals);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes");
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
              <h2 className="text-base font-bold text-[#2d2926]">Edit lesson</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">Changes save when you press Save.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel edit"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-4 pt-2 space-y-3 overflow-y-auto">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Child</span>
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

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Curriculum goal</span>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Subject</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Math"
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Title</span>
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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block col-span-2 sm:col-span-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Scheduled date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Lesson #</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={lessonNumber}
                  onChange={(e) => setLessonNumber(e.target.value)}
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Minutes</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                />
              </label>
            </div>

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
              type="submit"
              disabled={!canSubmit || submitting}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
