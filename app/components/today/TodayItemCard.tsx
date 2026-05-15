"use client";

// Shared card primitive for the Today page. Renders one lesson, one
// appointment, or one activity with the same time | status | content
// skeleton. Kind-tagged switch inside drives:
//   - status icon (checkbox for lessons; bullet for appts/activities)
//   - expanded state contents (lesson actions vs appointment actions vs
//     activity quick-info)
//   - secondary line text
//
// Background and text colors are computed by the caller and passed in,
// so this component knows nothing about kid-color tinting vs Everyone's
// neutral gray. Border style is also caller-controlled.
//
// Note saving uses the parent's saveNote handler (with its
// idle/saving/saved/error feedback), NOT a direct supabase write.

import { useState, useRef } from "react";
import { Pencil, Trash2, Calendar, X } from "lucide-react";
import type { TodayItem } from "./groupItems";
import { resolveLessonSubject } from "@/lib/lesson-subject";

export type CardSkin = {
  /** Card background. Caller computes this (kid tint or neutral). */
  background: string;
  /** Border CSS, e.g. "1px dashed #888780" or "none". */
  border: string;
  /** Title text color (computed for AA contrast on background). */
  titleColor: string;
  /** Secondary text color (subject sub-label, duration). */
  subtitleColor: string;
  /** Used for the empty-checkbox border and the filled checkbox bg. */
  accentColor: string;
};

export type CardHandlers = {
  // Lessons
  onToggleLesson?: (id: string, current: boolean) => void;
  onEditLesson?: (id: string) => void;
  onRescheduleLesson?: (id: string) => void;
  onSkipLesson?: (id: string) => void;
  onDeleteLesson?: (id: string) => void;
  // Notes use the parent's saveNote so the existing UI feedback state
  // (idle/saving/saved/error) keeps working.
  onStartEditingNote?: (lessonId: string, currentNotes: string | null | undefined) => void;
  // Activities
  onToggleActivity?: (raw: unknown) => void;
  // Appointments — toggle complete + open edit (which routes to the
  // existing manage modal).
  onToggleAppointment?: (id: string, current: boolean) => void;
  onManageAppointment?: () => void;
};

type Props = {
  item: TodayItem;
  skin: CardSkin;
  handlers: CardHandlers;
  isPartner: boolean;
  childrenLookup: Map<string, { id: string; name: string; color: string | null }>;
  /** Note editor state owned by parent so feedback persists across re-renders. */
  noteEditor: {
    editingNoteId: string | null;
    editingNoteText: string;
    noteSaveState: "idle" | "saving" | "saved" | "error";
    onNoteTextChange: (text: string) => void;
    onSaveNote: (lessonId: string) => void;
    onCancelEditingNote: () => void;
  };
  /** Time format. "24h" for school-day lessons, "12h" for appts/activities. */
  timeFormat: "24h" | "12h";
};

function formatTime12h(t: string | null): string {
  if (!t) return "";
  const parts = t.split(":");
  if (parts.length < 2) return "";
  const h24 = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return m > 0 ? `${h}:${String(m).padStart(2, "0")} ${ampm}` : `${h} ${ampm}`;
}

function formatTime24h(t: string | null): string {
  if (!t) return "";
  const parts = t.split(":");
  if (parts.length < 2) return "";
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDuration(mins: number | null): string {
  if (mins == null) return "";
  if (mins < 60) return `${mins} min`;
  if (mins % 60 === 0) return `${mins / 60} hr`;
  return `${(mins / 60).toFixed(1)} hr`;
}

export default function TodayItemCard({
  item,
  skin,
  handlers,
  isPartner,
  childrenLookup,
  noteEditor,
  timeFormat,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const timeLabel = item.time ? (timeFormat === "24h" ? formatTime24h(item.time) : formatTime12h(item.time)) : "";

  const handleToggle = () => {
    if (isPartner) return;
    if (item.kind === "lesson" && handlers.onToggleLesson) {
      handlers.onToggleLesson(item.id, item.completed);
    } else if (item.kind === "activity" && handlers.onToggleActivity) {
      handlers.onToggleActivity(item.raw);
    } else if (item.kind === "appointment" && handlers.onToggleAppointment) {
      handlers.onToggleAppointment(item.id, item.completed);
    }
  };

  const handleStartEditingNote = (currentNotes: string | null | undefined) => {
    if (!handlers.onStartEditingNote) return;
    handlers.onStartEditingNote(item.id, currentNotes);
    setTimeout(() => noteTextareaRef.current?.focus(), 0);
  };

  // Resolve raw shapes for fields not normalized into TodayItem.
  type RawLesson = { notes?: string | null; subjects?: { name: string } | null; curriculum_goals?: { subject_label: string | null } | null; child_id?: string };
  type RawAppointment = { notes?: string | null; location?: string | null; emoji?: string | null };
  type RawActivity = { emoji?: string | null };

  const lessonRaw: RawLesson | null = item.kind === "lesson" ? (item.raw as RawLesson) : null;
  const apptRaw: RawAppointment | null = item.kind === "appointment" ? (item.raw as RawAppointment) : null;
  const activityRaw: RawActivity | null = item.kind === "activity" ? (item.raw as RawActivity) : null;

  // Status icon column.
  const renderStatusIcon = () => {
    if (item.kind === "lesson") {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          aria-label={item.completed ? "Mark lesson incomplete" : "Mark lesson complete"}
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-all"
          style={{
            border: item.completed ? "none" : `2px solid ${skin.accentColor}`,
            background: item.completed ? skin.accentColor : "white",
            cursor: isPartner ? "default" : "pointer",
          }}
        >
          {item.completed && <span className="text-white text-[12px] font-medium">{"✓"}</span>}
        </button>
      );
    }
    // Appointments + activities: solid bullet (taps still toggle complete).
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        aria-label={item.completed ? "Mark incomplete" : "Mark complete"}
        className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
        style={{
          background: item.completed ? skin.accentColor : "transparent",
          border: `1.5px solid ${skin.accentColor}`,
          cursor: isPartner ? "default" : "pointer",
        }}
      >
        {item.completed ? (
          <span className="text-white text-[12px] font-medium">{"✓"}</span>
        ) : (
          <span style={{ color: skin.accentColor, fontSize: "14px", lineHeight: 1 }}>{"•"}</span>
        )}
      </button>
    );
  };

  // Secondary line below the title.
  const renderSubtitle = () => {
    if (item.kind === "lesson") {
      const subj = resolveLessonSubject(lessonRaw?.subjects?.name, lessonRaw?.curriculum_goals?.subject_label);
      // Child name appears only for multi-child families — adds no info
      // when there's just one kid. Mirrors the Plan page subtitle pattern.
      const childName = childrenLookup.size > 1 && lessonRaw?.child_id
        ? (childrenLookup.get(lessonRaw.child_id)?.name ?? null)
        : null;
      const parts = [subj, childName].filter(Boolean) as string[];
      return parts.length > 0 ? (
        <span className="text-[10px]" style={{ color: skin.subtitleColor }}>{parts.join(" · ")}</span>
      ) : null;
    }
    if (item.kind === "activity") {
      const dur = formatDuration(item.duration_minutes);
      return dur ? <span className="text-[10px]" style={{ color: skin.subtitleColor }}>{dur}</span> : null;
    }
    // Appointment.
    const dur = formatDuration(item.duration_minutes);
    const loc = apptRaw?.location;
    const bits = [dur, loc ? `\u{1F4CD} ${loc}` : null].filter(Boolean);
    return bits.length > 0 ? (
      <span className="text-[10px]" style={{ color: skin.subtitleColor }}>{bits.join(" · ")}</span>
    ) : null;
  };

  // Expanded action row for lessons.
  const renderLessonActions = () => {
    const { onEditLesson, onRescheduleLesson, onSkipLesson, onDeleteLesson } = handlers;
    if (isPartner) return null;
    if (!onEditLesson && !onRescheduleLesson && !onSkipLesson && !onDeleteLesson) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap mt-2">
        {onEditLesson && (
          <button
            type="button"
            onClick={() => onEditLesson(item.id)}
            aria-label="Edit this lesson"
            className="flex items-center gap-1 min-h-[44px] min-w-[44px] -ml-1 px-2 text-[13px] font-medium hover:opacity-80 transition-opacity"
            style={{ color: skin.accentColor }}
          >
            <Pencil size={14} /> Edit
          </button>
        )}
        {onRescheduleLesson && (
          <>
            {onEditLesson && <span aria-hidden="true" className="text-[#cfc9c0] select-none">·</span>}
            <button
              type="button"
              onClick={() => onRescheduleLesson(item.id)}
              aria-label="Reschedule this lesson"
              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] font-medium hover:opacity-80 transition-opacity"
              style={{ color: skin.accentColor }}
            >
              <Calendar size={14} /> Reschedule
            </button>
          </>
        )}
        {onSkipLesson && (
          <>
            {(onEditLesson || onRescheduleLesson) && <span aria-hidden="true" className="text-[#cfc9c0] select-none">·</span>}
            <button
              type="button"
              onClick={() => onSkipLesson(item.id)}
              aria-label="Skip this lesson"
              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] font-medium hover:opacity-80 transition-opacity"
              style={{ color: skin.subtitleColor }}
            >
              <X size={14} /> Skip
            </button>
          </>
        )}
        {onDeleteLesson && (
          <>
            {(onEditLesson || onRescheduleLesson || onSkipLesson) && <span aria-hidden="true" className="text-[#cfc9c0] select-none">·</span>}
            <button
              type="button"
              onClick={() => onDeleteLesson(item.id)}
              aria-label="Delete this lesson"
              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#d14a3a] font-medium hover:text-red-600 transition-colors"
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        )}
      </div>
    );
  };

  // Note editor (lessons only).
  const renderNoteEditor = () => {
    if (item.kind !== "lesson" || isPartner) return null;
    const isEditing = noteEditor.editingNoteId === item.id;
    const notes = lessonRaw?.notes;

    if (isEditing) {
      return (
        <div className="mt-2">
          <textarea
            ref={noteTextareaRef}
            value={noteEditor.editingNoteText}
            onChange={(e) => noteEditor.onNoteTextChange(e.target.value)}
            placeholder="Prep items, extra activities, reminders..."
            className="w-full min-h-[60px] max-h-[120px] rounded-lg border bg-white p-2.5 text-[13px] text-[#3c3a37] resize-none focus:outline-none"
            style={{ borderColor: skin.accentColor }}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => noteEditor.onSaveNote(item.id)}
              disabled={noteEditor.noteSaveState === "saving"}
              className="text-white text-[12px] font-semibold px-3 py-1 rounded-lg disabled:opacity-60"
              style={{ background: skin.accentColor }}
            >
              {noteEditor.noteSaveState === "saving" ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={noteEditor.onCancelEditingNote} className="text-[12px] text-[#8a8580] font-medium">
              Cancel
            </button>
            {noteEditor.noteSaveState === "saved" && <span className="text-[11px] text-[#5c7f63]">Saved ✓</span>}
            {noteEditor.noteSaveState === "error" && <span className="text-[11px] text-[#d14a3a]">Save failed. Try again.</span>}
          </div>
        </div>
      );
    }

    if (notes) {
      return (
        <div className="mt-2">
          <div className="bg-white/50 rounded-lg p-2.5" style={{ borderLeft: `2px solid ${skin.accentColor}` }}>
            <p className="text-[13px] text-[#6b6560] italic">{notes}</p>
          </div>
          <button
            type="button"
            onClick={() => handleStartEditingNote(notes)}
            className="text-[12px] font-medium mt-1.5"
            style={{ color: skin.accentColor }}
          >
            {"✏️"} Edit note
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => handleStartEditingNote(null)}
        className="text-[12px] font-medium mt-2"
        style={{ color: skin.accentColor }}
      >
        {"\u{1F4DD}"} Add a note...
      </button>
    );
  };

  // Expanded state for appointments.
  const renderAppointmentExpanded = () => {
    if (item.kind !== "appointment") return null;
    const time = formatTime12h(item.time);
    const dur = formatDuration(item.duration_minutes);
    const loc = apptRaw?.location;
    const notes = apptRaw?.notes;
    const childPills = (item.child_ids ?? [])
      .map((id) => childrenLookup.get(id))
      .filter((c): c is { id: string; name: string; color: string | null } => Boolean(c));

    return (
      <>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-2">
          {time && <span className="font-semibold" style={{ color: skin.accentColor }}>{time}</span>}
          {dur && <span style={{ color: skin.subtitleColor }}>{dur}</span>}
          {loc && <span style={{ color: skin.subtitleColor }}>{"\u{1F4CD}"} {loc}</span>}
        </div>
        {childPills.length > 0 && (
          <div className="flex gap-1.5 mb-2">
            {childPills.map((c) => (
              <span
                key={c.id}
                className="text-[11px] font-medium px-2 py-0.5 rounded-lg"
                style={{ color: c.color ?? "#7a6f65", background: "white" }}
              >
                {c.name}
              </span>
            ))}
          </div>
        )}
        {notes && (
          <div className="bg-white/50 rounded-lg p-2.5 mt-2" style={{ borderLeft: `2px solid ${skin.accentColor}` }}>
            <p className="text-[13px] text-[#6b6560] italic">{notes}</p>
          </div>
        )}
        {!isPartner && handlers.onManageAppointment && (
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={handlers.onManageAppointment}
              className="text-[12px] font-medium"
              style={{ color: skin.accentColor }}
            >
              {"✏️"} Edit
            </button>
          </div>
        )}
      </>
    );
  };

  // Expanded state for activities.
  const renderActivityExpanded = () => {
    if (item.kind !== "activity") return null;
    const dur = formatDuration(item.duration_minutes);
    const childPills = (item.child_ids ?? [])
      .map((id) => childrenLookup.get(id))
      .filter((c): c is { id: string; name: string; color: string | null } => Boolean(c));
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-1">
        {dur && <span style={{ color: skin.subtitleColor }}>{dur}</span>}
        {childPills.length > 0 && (
          <span style={{ color: skin.subtitleColor }}>{childPills.map((c) => c.name).join(", ")}</span>
        )}
      </div>
    );
  };

  // Optional emoji glyph from the source row (lesson icon, appt emoji,
  // activity emoji). Falls back per kind.
  const emoji =
    lessonRaw && "icon_emoji" in (lessonRaw as Record<string, unknown>)
      ? ((lessonRaw as { icon_emoji?: string }).icon_emoji ?? "\u{1F4DA}")
      : apptRaw?.emoji ?? activityRaw?.emoji ?? null;

  return (
    <div
      className="rounded-[8px] mb-1.5 transition-all duration-200"
      style={{
        background: skin.background,
        border: skin.border,
        opacity: item.completed ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Time column — right-aligned, 44px min-width, collapses if no time. */}
        {timeLabel ? (
          <span className="text-[11px] font-medium text-right shrink-0" style={{ minWidth: 44, color: skin.titleColor }}>
            {timeLabel}
          </span>
        ) : null}
        {renderStatusIcon()}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          {emoji && <span className="text-base shrink-0">{emoji}</span>}
          <div className="flex-1 min-w-0">
            <span
              className={`text-[13px] font-medium break-words block ${item.completed ? "line-through" : ""}`}
              style={{ color: skin.titleColor }}
            >
              {item.title}
            </span>
            {!expanded && renderSubtitle()}
            {!expanded && item.kind === "lesson" && lessonRaw?.notes && (
              <p className="line-clamp-1 text-[11px] italic mt-0.5" style={{ color: skin.subtitleColor }}>
                {lessonRaw.notes}
              </p>
            )}
          </div>
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          <div className="pt-2 border-t" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
            {item.kind === "lesson" && (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-1">
                  {(() => {
                    const subj = resolveLessonSubject(lessonRaw?.subjects?.name, lessonRaw?.curriculum_goals?.subject_label);
                    return subj ? <span className="font-medium" style={{ color: skin.titleColor }}>{subj}</span> : null;
                  })()}
                  {lessonRaw?.child_id && childrenLookup.get(lessonRaw.child_id) && (
                    <span style={{ color: skin.subtitleColor }}>{childrenLookup.get(lessonRaw.child_id)!.name}</span>
                  )}
                </div>
                {renderNoteEditor()}
                {renderLessonActions()}
              </>
            )}
            {item.kind === "appointment" && renderAppointmentExpanded()}
            {item.kind === "activity" && renderActivityExpanded()}
          </div>
        </div>
      )}
    </div>
  );
}
