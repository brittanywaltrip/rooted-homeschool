"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/* TodayLessonCard — lesson row with inline check-off, particle burst on
 * completion, minutes editor, notes editor, and a 3-dot menu.
 *
 * Extracted from app/dashboard/page.tsx without behaviour change. Props are
 * the exact set the page was passing (editing-note state is lifted to the
 * page so multiple cards can coordinate through a single editor). The minimal
 * Lesson / Child shapes below are a structural subset of the page's own
 * Lesson / Child types; any page-defined object satisfies them. */

type Particle = { id: number; x: number; y: number; color: string; delay: number };

export type TodayLessonCardLesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string;
  hours: number | null;
  minutes_spent: number | null;
  subjects: { name: string; color: string | null } | null;
  lesson_number?: number | null;
  curriculum_goal_id?: string | null;
  goal_id?: string | null;
  icon_emoji?: string | null;
  notes?: string | null;
};

export type TodayLessonCardChild = {
  id: string;
  name: string;
  color: string | null;
};

export function getSubjectStyle(subjectName: string | undefined): { bg: string; text: string } {
  if (!subjectName) return { bg: "#f0ede8", text: "#5c5248" };
  const n = subjectName.toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry") || n.includes("calculus"))
    return { bg: "#e4f0f4", text: "#1a4a5a" };
  if (n.includes("read") || n.includes("language") || n.includes("english") || n.includes("writing") || n.includes("grammar") || n.includes("lit") || n.includes("spelling") || n.includes("phonics"))
    return { bg: "#f0e8f4", text: "#4a2a5a" };
  if (n.includes("science") || n.includes("biology") || n.includes("chemistry") || n.includes("physics") || n.includes("nature"))
    return { bg: "#e8f0e9", text: "var(--g-deep)" };
  if (n.includes("history") || n.includes("social") || n.includes("geography") || n.includes("civics") || n.includes("government"))
    return { bg: "#fef0e4", text: "#7a4a1a" };
  if (n.includes("art") || n.includes("music") || n.includes("drama") || n.includes("theater") || n.includes("craft") || n.includes("draw"))
    return { bg: "#fce8ec", text: "#7a2a36" };
  return { bg: "#f0ede8", text: "#5c5248" };
}

export interface TodayLessonCardProps {
  lesson: TodayLessonCardLesson;
  childObj: TodayLessonCardChild | undefined;
  onToggle: (id: string, current: boolean) => void;
  onEdit: (lesson: TodayLessonCardLesson) => void;
  onDelete: (id: string) => void;
  onReschedule: (lesson: TodayLessonCardLesson) => void;
  onSkip: (lesson: TodayLessonCardLesson) => void;
  onStartEditingNote: (lessonId: string, currentNotes: string | null | undefined) => void;
  onMinutesUpdate: (id: string, minutes: number) => void;
  isPartner: boolean;
  editingNoteId: string | null;
  editingNoteText: string;
  noteSaveState: "idle" | "saving" | "saved" | "error";
  noteTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onNoteTextChange: (text: string) => void;
  onSaveNote: (lessonId: string) => void;
  onCancelEditingNote: () => void;
}

export default function TodayLessonCard({
  lesson, childObj, onToggle, onEdit, onDelete, onReschedule, onSkip, onStartEditingNote, onMinutesUpdate, isPartner,
  editingNoteId, editingNoteText, noteSaveState, noteTextareaRef, onNoteTextChange, onSaveNote, onCancelEditingNote,
}: TodayLessonCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLeaf, setShowLeaf] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const prevCompleted = useRef(lesson.completed);

  useEffect(() => {
    if (!prevCompleted.current && lesson.completed) {
      setShowLeaf(true);
      const t = setTimeout(() => setShowLeaf(false), 1300);
      prevCompleted.current = true;

      // Tier 1: particle burst from checkbox
      const colors = ['#5c7f63', '#7a9e7e', '#a8d4aa', '#f0d090', '#d4b896'];
      const newParticles: Particle[] = Array.from({ length: 10 }, (_, i) => {
        const angle = (i * 36 + Math.random() * 20 - 10) * (Math.PI / 180);
        const dist  = 60 + Math.random() * 20;
        return {
          id:    i,
          x:     Math.cos(angle) * dist,
          y:     Math.sin(angle) * dist,
          color: colors[i % colors.length],
          delay: Math.round(Math.random() * 40),
        };
      });
      setParticles(newParticles);
      const pt = setTimeout(() => setParticles([]), 500);

      return () => { clearTimeout(t); clearTimeout(pt); };
    }
    prevCompleted.current = lesson.completed;
  }, [lesson.completed]);

  const subStyle    = getSubjectStyle(lesson.subjects?.name);
  const borderColor = childObj?.color ?? subStyle.text;

  function handleClick(e: React.MouseEvent) {
    if ((e.target as Element).closest("[data-no-toggle]")) return;
    onToggle(lesson.id, lesson.completed);
  }

  const isEditingNote = editingNoteId === lesson.id;

  return (
    <div>
    <div
      className={`relative flex items-center gap-3 px-4 border transition-all cursor-pointer select-none ${
        isEditingNote ? "rounded-t-2xl border-b-0" : "rounded-2xl"
      } ${
        lesson.completed
          ? "bg-[#f0f7f1] border-[#c2dbc5]"
          : "bg-[#fefcf9] border-[#e8e2d9] active:bg-[#f0f7f1]"
      }`}
      style={{ minHeight: "56px", borderLeftWidth: "4px", borderLeftColor: borderColor }}
      onClick={handleClick}
    >
      {/* Circular checkbox */}
      <div
        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
          lesson.completed ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5]"
        }`}
      >
        {lesson.completed && (
          <svg viewBox="0 0 10 8" className="w-3.5 h-2.5 fill-none">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-3.5">
        {lesson.subjects && (
          <span
            className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: subStyle.bg, color: subStyle.text }}
          >
            {lesson.subjects.name}
          </span>
        )}
        <div className="flex items-baseline gap-1.5">
          <p className={`text-sm font-medium leading-snug ${
            lesson.completed ? "line-through text-[#9a948e]" : "text-[#2d2926]"
          }`}>
            {lesson.title || (lesson.lesson_number ? `Lesson ${lesson.lesson_number}` : "Untitled")}
          </p>
          {lesson.completed && (() => {
            const mins = lesson.minutes_spent ?? (lesson.hours != null && lesson.hours > 0 ? Math.round(lesson.hours * 60) : null);
            return (
              <button
                type="button"
                data-no-toggle
                onClick={(e) => {
                  e.stopPropagation();
                  const input = e.currentTarget.nextElementSibling as HTMLInputElement | null;
                  if (input) { input.style.display = "inline-block"; input.focus(); e.currentTarget.style.display = "none"; }
                }}
                className="text-[11px] text-[#b5aca4] hover:text-[#5c7f63] transition-colors shrink-0"
              >
                · {mins != null ? `${mins} min` : "add time"}
              </button>
            );
          })()}
          {lesson.completed && (
            <input
              type="number"
              data-no-toggle
              defaultValue={lesson.minutes_spent ?? (lesson.hours != null && lesson.hours > 0 ? Math.round(lesson.hours * 60) : "")}
              placeholder="min"
              min="0"
              max="480"
              style={{ display: "none" }}
              className="w-14 text-[11px] text-[#2d2926] bg-[#f0ede8] border border-[#e8e2d9] rounded-lg px-1.5 py-0.5 text-center focus:outline-none focus:border-[#5c7f63] shrink-0"
              onClick={(e) => e.stopPropagation()}
              onBlur={async (e) => {
                const val = parseInt(e.target.value) || 0;
                e.target.style.display = "none";
                const btn = e.target.previousElementSibling as HTMLElement | null;
                if (btn) btn.style.display = "";
                if (val > 0) {
                  await supabase.from("lessons").update({ minutes_spent: val }).eq("id", lesson.id);
                  onMinutesUpdate(lesson.id, val);
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          )}
        </div>
        {/* Note preview (collapsed) */}
        {!isEditingNote && lesson.notes && (
          <p className="text-[11px] text-[#6b6560] italic mt-1 line-clamp-1">{lesson.notes}</p>
        )}
      </div>

      {/* Child bubble */}
      {childObj && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
          style={{ backgroundColor: childObj.color ?? "#5c7f63" }}
          data-no-toggle
        >
          {childObj.name.charAt(0).toUpperCase()}
        </div>
      )}

      {/* Leaf pop animation */}
      {showLeaf && (
        <span
          className="leaf-card-pop absolute text-xl"
          style={{ right: "48px", top: "4px" }}
        >
          🍃
        </span>
      )}

      {/* Tier 1: Particle burst */}
      {particles.map(p => (
        <span
          key={p.id}
          className="particle-burst absolute rounded-full"
          style={{
            width: 7,
            height: 7,
            left: 29,
            top: 25,
            backgroundColor: p.color,
            animationDelay: `${p.delay}ms`,
            '--px': `${p.x}px`,
            '--py': `${p.y}px`,
          } as React.CSSProperties}
        />
      ))}

      {/* 3-dot menu */}
      {!isPartner && (
        <div className="relative shrink-0" data-no-toggle>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
            aria-label="Lesson options"
            data-no-toggle
          >
            <span className="text-base leading-none">···</span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
              <div className="absolute right-0 top-9 bg-white border border-[#e8e2d9] rounded-xl shadow-lg z-30 overflow-hidden min-w-[140px]">
                <button
                  onClick={(e) => { e.stopPropagation(); onStartEditingNote(lesson.id, lesson.notes); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  {lesson.notes ? "📝 Edit note" : "➕ Add a note"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(lesson); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onReschedule(lesson); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  ⏭ Reschedule
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSkip(lesson); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  ⏩ Skip
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(lesson.id); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                  data-no-toggle
                >
                  🗑 Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
    {/* Inline note editor (parity with Plan page) */}
    {isEditingNote && (
      <div
        className={`px-4 pb-3 pt-1 border border-t-0 rounded-b-2xl ${
          lesson.completed ? "bg-[#f0f7f1] border-[#c2dbc5]" : "bg-[#fefcf9] border-[#e8e2d9]"
        }`}
        style={{ borderLeftWidth: "4px", borderLeftColor: borderColor }}
      >
        <textarea
          ref={noteTextareaRef}
          value={editingNoteText}
          onChange={(e) => onNoteTextChange(e.target.value)}
          placeholder="Prep items, extra activities, reminders..."
          className="w-full min-h-[52px] max-h-[100px] rounded-lg border border-[#e8e2d9] bg-white p-2 text-[12px] text-[#3c3a37] resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/30"
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => onSaveNote(lesson.id)}
            disabled={noteSaveState === "saving" || noteSaveState === "saved"}
            aria-live="polite"
            className={`min-h-[44px] min-w-[88px] text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors ${
              noteSaveState === "saved" ? "bg-[#5c7f63]" :
              noteSaveState === "error" ? "bg-[#b91c1c]" :
              noteSaveState === "saving" ? "bg-[#2D5A3D] opacity-70" :
              "bg-[#2D5A3D] hover:bg-[var(--g-deep)]"
            }`}
          >
            {noteSaveState === "saving" ? "Saving…" :
             noteSaveState === "saved" ? "Saved ✓" :
             noteSaveState === "error" ? "Try again" :
             "Save"}
          </button>
          <button
            onClick={onCancelEditingNote}
            disabled={noteSaveState === "saving"}
            className="min-h-[44px] text-[13px] text-[#8a8580] font-medium px-3 disabled:opacity-50"
          >
            Cancel
          </button>
          {noteSaveState === "error" && (
            <span className="text-[11px] text-[#b91c1c]">Couldn&apos;t save — try again</span>
          )}
        </div>
      </div>
    )}
    </div>
  );
}
