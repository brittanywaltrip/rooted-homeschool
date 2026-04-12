"use client";

import { useState } from "react";
import { X } from "lucide-react";
import LogTodayModal from "./LogTodayModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type Lesson  = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  hours: number | null;
  date: string | null;
  scheduled_date: string | null;
  subjects: { name: string; color: string | null } | null;
};

interface DayDetailPanelProps {
  date: Date;
  lessons: Lesson[];
  children: Child[];
  subjects: Subject[];
  onClose: () => void;
  onToggle: (id: string, current: boolean) => void;
  onSaved: (type: string, childId?: string) => void;
  isPartner?: boolean;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DayDetailPanel({
  date, lessons, children, subjects, onClose, onToggle, onSaved, isPartner,
}: DayDetailPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);

  const dateStr   = toDateStr(date);
  const dateLabel = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const done      = lessons.filter((l) => l.completed).length;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center">
        <div
          className="bg-[#fefcf9] rounded-t-3xl shadow-xl w-full max-w-lg flex flex-col"
          style={{ maxHeight: "80vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 shrink-0" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#f0ede8] shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">{dateLabel}</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">
                {lessons.length === 0
                  ? "Nothing scheduled"
                  : `${done} of ${lessons.length} complete`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Lessons list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {lessons.length === 0 ? (
              <p className="text-sm text-[#b5aca4] text-center py-8">
                Nothing scheduled for this day yet.
              </p>
            ) : (
              lessons.map((lesson) => {
                const child    = children.find((c) => c.id === lesson.child_id);
                const subColor = lesson.subjects?.color ?? "#c8bfb5";
                return (
                  <div
                    key={lesson.id}
                    className="flex items-center gap-3 bg-white border border-[#e8e2d9] rounded-xl px-3 py-2.5"
                    style={{ borderLeftWidth: 3, borderLeftColor: subColor }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => onToggle(lesson.id, lesson.completed)}
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        lesson.completed
                          ? "bg-[#5c7f63] border-[#5c7f63]"
                          : "border-[#c8bfb5] hover:border-[#5c7f63]"
                      }`}
                      aria-label={lesson.completed ? "Mark incomplete" : "Mark complete"}
                    >
                      {lesson.completed && (
                        <svg viewBox="0 0 8 7" className="w-2.5 h-2">
                          <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${
                        lesson.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"
                      }`}>
                        {lesson.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {lesson.subjects && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                            style={{
                              backgroundColor: subColor + "22",
                              color: subColor === "#c8bfb5" ? "#7a6f65" : subColor,
                            }}
                          >
                            {lesson.subjects.name}
                          </span>
                        )}
                        {child && (
                          <span
                            className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 leading-none"
                            style={{ backgroundColor: child.color ?? "#5c7f63" }}
                          >
                            {child.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Past-day explainer */}
          {dateStr < toDateStr(new Date()) && lessons.length > 0 && (
            <p className="px-5 pt-2 text-xs text-[#b5aca4] italic">
              Past lessons never expire — check off what you covered any time.
            </p>
          )}

          {/* Footer */}
          {!isPartner && (
            <div className="px-5 pb-8 pt-3 border-t border-[#f0ede8] shrink-0">
              <button
                onClick={() => setShowAddModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors"
              >
                + Add to this day
              </button>
            </div>
          )}
        </div>
      </div>

      {/* LogTodayModal pre-scoped to this date */}
      {showAddModal && (
        <LogTodayModal
          children={children}
          subjects={subjects}
          today={dateStr}
          selectedDate={dateStr}
          onClose={() => setShowAddModal(false)}
          onSaved={(type, childId) => {
            setShowAddModal(false);
            onSaved(type, childId);
          }}
        />
      )}
    </>
  );
}
