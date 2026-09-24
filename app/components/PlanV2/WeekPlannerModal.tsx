"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PlanV2Child } from "./types";
import { reusableOneOffLessons } from "./oneOffLessonChoices";
import {
  numberedTitles,
  weekPlanDays,
  weekPlanProblem,
  weekPlanSummary,
  type WeekPlanInput,
} from "./weekPlan";

/* ============================================================================
 * WeekPlannerModal: "Plan this week". The parent picks a subject, the
 * children doing it, the days, and a title for each day; Rooted adds one
 * lesson per child per day (weekPlanRows). Nothing is calculated or spread:
 * the lessons land on the days she chose and stay there.
 *
 * Presentational + submit, like AddLessonModal: the parent component owns the
 * insert, the undo and the audit event.
 * ========================================================================== */

type DayRow = { date: string; past: boolean; onBreak: boolean; chosen: boolean; title: string; edited: boolean };

const LABEL = "text-[12px] font-medium text-[#8B7E74]";
const INPUT =
  "w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20";

function dayHeading(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function WeekPlannerModal(props: {
  isOpen: boolean;
  weekStart: Date;
  today: string;
  childrenList: PlanV2Child[];
  schoolDays: string[];
  breaks: { start_date: string; end_date: string }[];
  userId: string | null;
  onClose: () => void;
  /** Resolves when every lesson is saved; rejects (and nothing is saved) otherwise. */
  onSubmit: (input: WeekPlanInput) => Promise<void>;
}) {
  const { isOpen, weekStart, today, childrenList: kids, schoolDays, breaks, userId, onClose, onSubmit } = props;

  const [subject, setSubject] = useState("");
  const [childIds, setChildIds] = useState<string[]>([]);
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [days, setDays] = useState<DayRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastSubjects, setPastSubjects] = useState<string[]>([]);

  // A fresh sheet every time it opens, for the week on screen.
  useEffect(() => {
    if (!isOpen) return;
    setSubject("");
    setChildIds(kids.map((k) => k.id));
    setMinutes("");
    setNotes("");
    setError(null);
    setSubmitting(false);
    setDays(
      weekPlanDays({ weekStart, today, schoolDays, breaks }).map((d) => ({
        date: d.date, past: d.past, onBreak: d.onBreak, chosen: d.defaultChosen, title: "", edited: false,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // The family's own one-off subjects, the same list Add a lesson offers.
  useEffect(() => {
    if (!isOpen || !userId) return;
    let cancelled = false;
    void supabase.from("lessons")
      .select("title")
      .eq("user_id", userId)
      .is("curriculum_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (cancelled) return;
        setPastSubjects([...new Set(reusableOneOffLessons(data ?? []).map((c) => c.subject).filter(Boolean))]);
      });
    return () => { cancelled = true; };
  }, [isOpen, userId]);

  const parsedMinutes = minutes.trim() === "" ? null : Number(minutes);
  const input: WeekPlanInput = useMemo(() => ({
    childIds,
    subject,
    minutes: parsedMinutes,
    notes: notes.trim() ? notes.trim() : null,
    days: days.filter((d) => d.chosen).map((d) => ({ date: d.date, title: d.title })),
  }), [childIds, subject, parsedMinutes, notes, days]);
  const problem = weekPlanProblem(input, today);
  const chosenNames = kids.filter((k) => childIds.includes(k.id)).map((k) => k.name);
  const summary = weekPlanSummary(input.days.length, chosenNames);

  if (!isOpen) return null;

  // Typing a title fills the later chosen days the parent has not typed in
  // yet, counting up: "Week 12.1" -> "Week 12.2", "Week 12.3".
  function setTitle(index: number, value: string) {
    setDays((prev) => {
      const next = prev.map((d, i) => (i === index ? { ...d, title: value, edited: value.trim() !== "" } : d));
      const later = next.map((d, i) => ({ d, i })).filter(({ d, i }) => i > index && d.chosen && !d.edited);
      const titles = numberedTitles(value.trim(), later.length + 1).slice(1);
      later.forEach(({ i }, k) => { next[i] = { ...next[i], title: value.trim() ? titles[k] : "" }; });
      return next;
    });
  }

  function toggleDay(index: number) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, chosen: !d.chosen } : d)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this week. Nothing was added.");
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
          aria-labelledby="week-planner-title"
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
            <div>
              <h2 id="week-planner-title" className="text-base font-medium text-[#2d2926]">Plan this week</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">
                Pick the days and name each lesson. They stay on the days you choose.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel plan this week"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-4 pt-2 space-y-3 overflow-y-auto">
            <label className="block">
              <span className={LABEL}>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                list="week-plan-subjects"
                maxLength={40}
                placeholder="e.g. Unit study"
                className={`mt-1 ${INPUT}`}
              />
              <datalist id="week-plan-subjects">
                {pastSubjects.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>

            <fieldset>
              <legend className={LABEL}>Children</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {kids.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-[#2d2926]">
                    <input
                      type="checkbox"
                      checked={childIds.includes(c.id)}
                      onChange={() => setChildIds((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]))}
                      className="accent-[#2D5A3D]"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              {kids.length === 0 ? <p className="text-xs text-[#b91c1c]">Add a child first.</p> : null}
            </fieldset>

            <fieldset>
              <legend className={LABEL}>Days and lessons</legend>
              <ul className="mt-1 space-y-1.5">
                {days.map((d, i) => (
                  <li key={d.date} className="flex items-center gap-2">
                    <label className={`flex items-center gap-2 w-[112px] shrink-0 text-sm ${d.past ? "text-[#c4bfb8]" : "text-[#2d2926]"}`}>
                      <input
                        type="checkbox"
                        checked={d.chosen}
                        disabled={d.past}
                        onChange={() => toggleDay(i)}
                        aria-label={`Plan ${dayHeading(d.date)}`}
                        className="accent-[#2D5A3D]"
                      />
                      {dayHeading(d.date)}
                    </label>
                    {d.chosen ? (
                      <input
                        type="text"
                        value={d.title}
                        onChange={(e) => setTitle(i, e.target.value)}
                        aria-label={`Lesson title for ${dayHeading(d.date)}`}
                        placeholder={i === days.findIndex((x) => x.chosen) ? "e.g. Week 12.1" : "Lesson title"}
                        className={INPUT}
                      />
                    ) : (
                      <span className="text-xs text-[#b5aca4]">{d.past ? "Passed" : d.onBreak ? "Break" : "Not planned"}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-[#7a6f65]">
                Type the first title and the next days count up from it. You can change any of them.
              </p>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={LABEL}>Minutes each</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="optional"
                  className={`mt-1 ${INPUT}`}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Notes</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="optional"
                  className={`mt-1 ${INPUT}`}
                />
              </label>
            </div>

            <p role="status" className="text-xs text-[#2d2926] bg-[#f4f8f2] border border-[#dfe9da] rounded-xl px-3 py-2">
              {problem && input.days.length > 0 && childIds.length > 0 ? problem : summary}
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
              type="submit"
              disabled={!!problem || submitting}
              className="flex-1 min-h-[44px] text-sm font-medium text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding…" : "Add to the week"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
