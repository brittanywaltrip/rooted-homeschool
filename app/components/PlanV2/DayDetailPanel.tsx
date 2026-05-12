"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import TodayLessonCard, {
  type TodayLessonCardLesson,
  type TodayLessonCardChild,
} from "@/app/components/TodayLessonCard";
import { resolveChildColor } from "./colors";
import type { PlanV2Appointment } from "./types";
import {
  formatEvent,
  relativeTimestamp,
  type PlanEventRow,
} from "@/lib/audit-log";

/* ============================================================================
 * DayDetailPanel v2 — shared day view.
 *
 * Two variants:
 *   - "inline"  content renders in place (used by the Today page when the
 *               new_plan_view flag is on)
 *   - "sheet"   content sits inside a bottom-sheet overlay with backdrop
 *               (used by PlanV2 when a month cell is tapped)
 *
 * Presentational — callers own data and mutation. Note-editor state lives
 * inside the panel so multiple TodayLessonCards can coordinate through one
 * editor; the DB write for notes happens here to keep the parent contract
 * small (caller only supplies an optional onLessonChanged for optimistic
 * parent syncing).
 * ==========================================================================*/

function formatTimeRange(time: string | null, durationMinutes: number): string | null {
  if (!time) return null;
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const start12 = ((h + 11) % 12) + 1;
  const startSuffix = h >= 12 ? "PM" : "AM";
  const endMinutes = h * 60 + m + durationMinutes;
  const eH = Math.floor((endMinutes / 60) % 24);
  const eM = endMinutes % 60;
  const end12 = ((eH + 11) % 12) + 1;
  const endSuffix = eH >= 12 ? "PM" : "AM";
  const fmt = (hh: number, mm: number, s: string) =>
    mm === 0 ? `${hh} ${s}` : `${hh}:${String(mm).padStart(2, "0")} ${s}`;
  return `${fmt(start12, m, startSuffix)} – ${fmt(end12, eM, endSuffix)}`;
}

function sortAppointments(appts: PlanV2Appointment[]): PlanV2Appointment[] {
  return [...appts].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.time === null && b.time !== null) return -1;
    if (a.time !== null && b.time === null) return 1;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return 0;
  });
}

export interface DayDetailPanelV2Props {
  date: Date;
  lessons: TodayLessonCardLesson[];
  appointments: PlanV2Appointment[];
  kids: TodayLessonCardChild[];
  isPartner: boolean;
  onToggleLesson: (id: string, current: boolean) => void;
  onEditLesson: (lesson: TodayLessonCardLesson) => void;
  onDeleteLesson: (id: string) => void;
  onRescheduleLesson: (lesson: TodayLessonCardLesson) => void;
  onSkipLesson: (lesson: TodayLessonCardLesson) => void;
  onMinutesUpdate: (id: string, mins: number) => void;
  onToggleAppointment?: (appt: PlanV2Appointment) => void;
  onEditAppointment?: (appt: PlanV2Appointment) => void;
  /** Called after a note is saved so the parent can sync local state. */
  onLessonChanged?: (lessonId: string, patch: Partial<TodayLessonCardLesson>) => void;
  /** Fires after a note save lands successfully (DB ack'd). `noteLength` is
   * the trimmed character count — the body itself is intentionally not
   * propagated so audit-log payloads stay PII-light. */
  onNotesUpdated?: (lessonId: string, noteLength: number) => void;
  /** Optional — audit-log rows whose payload touches this day. When omitted
   * or empty, the "Activity on this day" section is hidden, so the panel's
   * use on the Today page (which doesn't load Plan audit events) is
   * unaffected. */
  dayEvents?: PlanEventRow[];
  variant?: "inline" | "sheet";
  onClose?: () => void;
}

type NoteSaveState = "idle" | "saving" | "saved" | "error";

export default function DayDetailPanelV2(props: DayDetailPanelV2Props) {
  const {
    date, lessons, appointments, kids, isPartner,
    onToggleLesson, onEditLesson, onDeleteLesson, onRescheduleLesson,
    onSkipLesson, onMinutesUpdate, onToggleAppointment, onEditAppointment, onLessonChanged,
    onNotesUpdated,
    dayEvents,
    variant = "inline", onClose,
  } = props;

  // Per-day activity section expansion state. Defaults to collapsed — the
  // section is an "on-demand receipt", not primary content.
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [activityVisible, setActivityVisible] = useState(10);

  // ── Note editor state (internal to the panel) ──────────────────────────────
  // Auto-save pattern: 800ms debounce after last keystroke triggers a save;
  // the Save button stays as a manual retry path when auto-save fails (the
  // button label flips to "Try again" on error). Two separate timers:
  //   - autoSaveTimerRef  → the 800ms "user stopped typing" debounce
  //   - saveStateTimerRef → the brief "Saved ✓" visual indicator timeout
  // A text ref lets the debounced timer read the freshest value without
  // re-creating the timer on every keystroke.
  const AUTO_SAVE_DEBOUNCE_MS = 800;
  const SAVED_INDICATOR_MS = 1600;
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [noteSaveState, setNoteSaveState] = useState<NoteSaveState>("idle");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveStateTimerRef = useRef<number | null>(null);
  const editingNoteTextRef = useRef<string>("");
  const editingNoteIdRef = useRef<string | null>(null);
  // Snapshot of the note text when the editor opened. Used so we don't
  // auto-save (and spam audit events) when the editor is simply closed
  // without any edits.
  const noteBaselineRef = useRef<string>("");

  function clearAutoSaveTimer() {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }
  function clearSaveStateTimer() {
    if (saveStateTimerRef.current !== null) {
      window.clearTimeout(saveStateTimerRef.current);
      saveStateTimerRef.current = null;
    }
  }

  function startEditingNote(lessonId: string, currentNotes: string | null | undefined) {
    clearAutoSaveTimer();
    clearSaveStateTimer();
    const initial = currentNotes ?? "";
    setEditingNoteId(lessonId);
    setEditingNoteText(initial);
    setNoteSaveState("idle");
    editingNoteIdRef.current = lessonId;
    editingNoteTextRef.current = initial;
    noteBaselineRef.current = initial;
    setTimeout(() => noteTextareaRef.current?.focus(), 0);
  }

  function cancelEditingNote() {
    clearAutoSaveTimer();
    clearSaveStateTimer();
    setEditingNoteId(null);
    setEditingNoteText("");
    setNoteSaveState("idle");
    editingNoteIdRef.current = null;
    editingNoteTextRef.current = "";
  }

  async function performSave(lessonId: string, text: string) {
    const trimmed = text.trim();
    setNoteSaveState("saving");
    const { error } = await supabase
      .from("lessons")
      .update({ notes: trimmed.length === 0 ? null : trimmed })
      .eq("id", lessonId);
    // The user may have cancelled the editor mid-request — bail so we don't
    // flash the "Saved ✓" state on top of a closed editor.
    if (editingNoteIdRef.current !== lessonId) return;
    if (error) {
      setNoteSaveState("error");
      return;
    }
    onLessonChanged?.(lessonId, { notes: trimmed.length === 0 ? null : trimmed });
    onNotesUpdated?.(lessonId, trimmed.length);
    setNoteSaveState("saved");
    clearSaveStateTimer();
    saveStateTimerRef.current = window.setTimeout(() => {
      setNoteSaveState("idle");
      saveStateTimerRef.current = null;
    }, SAVED_INDICATOR_MS);
  }

  function handleNoteTextChange(text: string) {
    setEditingNoteText(text);
    editingNoteTextRef.current = text;
    // Skip auto-save if the user cleared their accidental edits back to the
    // baseline — no reason to hit the DB for a no-op.
    if (text === noteBaselineRef.current) {
      clearAutoSaveTimer();
      if (noteSaveState === "error") setNoteSaveState("idle");
      return;
    }
    // Any keystroke resets the debounce so the save fires 800ms after the
    // user actually STOPS typing, not 800ms after they started.
    clearAutoSaveTimer();
    // While pending, if we were showing "Saved ✓" or "Try again", step back
    // to a neutral idle so the user isn't looking at stale status.
    if (noteSaveState === "saved" || noteSaveState === "error") {
      setNoteSaveState("idle");
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      const lessonId = editingNoteIdRef.current;
      if (!lessonId) return;
      void performSave(lessonId, editingNoteTextRef.current);
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  function saveNote(lessonId: string) {
    // Manual trigger from the Save button. Cancels any in-flight debounce
    // and fires immediately — useful as the retry affordance after an error.
    clearAutoSaveTimer();
    void performSave(lessonId, editingNoteTextRef.current);
  }

  // Flush timers on unmount so a late setState never fires against a
  // torn-down component (and the pending auto-save, if any, doesn't get
  // dropped silently — it flushes synchronously if the user had edits).
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        const lessonId = editingNoteIdRef.current;
        if (lessonId && editingNoteTextRef.current !== noteBaselineRef.current) {
          // Fire-and-forget flush. No state updates — component is gone.
          void supabase
            .from("lessons")
            .update({
              notes:
                editingNoteTextRef.current.trim().length === 0
                  ? null
                  : editingNoteTextRef.current.trim(),
            })
            .eq("id", lessonId);
        }
      }
      if (saveStateTimerRef.current !== null) {
        window.clearTimeout(saveStateTimerRef.current);
        saveStateTimerRef.current = null;
      }
    };
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  const sortedAppts = sortAppointments(appointments);

  const lessonsByChild = new Map<string | null, TodayLessonCardLesson[]>();
  for (const l of lessons) {
    const key = l.child_id || null;
    const list = lessonsByChild.get(key) ?? [];
    list.push(l);
    lessonsByChild.set(key, list);
  }

  const totalItems = lessons.length + sortedAppts.length;
  const lessonsDone = lessons.filter((l) => l.completed).length;

  const kidsById = new Map<string, { child: TodayLessonCardChild; index: number }>();
  kids.forEach((c, i) => kidsById.set(c.id, { child: c, index: i }));

  // ── Content ────────────────────────────────────────────────────────────────
  const content = (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[#2d2926] leading-tight">{dateLabel}</h2>
          <p className="text-xs text-[#7a6f65] mt-0.5">
            {totalItems === 0
              ? "Nothing scheduled"
              : lessons.length === 0
                ? `${sortedAppts.length} appointment${sortedAppts.length === 1 ? "" : "s"}`
                : `${lessonsDone} of ${lessons.length} lesson${lessons.length === 1 ? "" : "s"} complete`}
          </p>
        </div>
        {variant === "sheet" && onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day detail"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {/* Appointments section */}
      {sortedAppts.length > 0 ? (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2">
            Appointments
          </p>
          <div className="space-y-1.5">
            {sortedAppts.map((a) => {
              const range = formatTimeRange(a.time, a.duration_minutes);
              return (
                <div
                  key={`${a.id}-${a.instance_date}`}
                  className="w-full bg-white rounded-xl px-3 py-2.5 flex items-start gap-2.5 transition-colors"
                  style={{ border: "1px dashed #c4b5d8", opacity: a.completed ? 0.6 : 1 }}
                >
                  <button
                    type="button"
                    onClick={() => onToggleAppointment?.(a)}
                    aria-label={a.completed ? "Mark appointment incomplete" : "Mark appointment complete"}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      a.completed ? "bg-[#7C3AED] border-[#7C3AED]" : "border-[#c4b5d8]"
                    }`}
                  >
                    {a.completed ? (
                      <svg viewBox="0 0 8 7" className="w-2.5 h-2">
                        <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleAppointment?.(a)}
                    className="flex-1 min-w-0 text-left hover:bg-[#faf8f4] -my-1.5 py-1.5 -mx-1.5 px-1.5 rounded-lg transition-colors"
                  >
                    <p
                      className="text-sm font-medium leading-snug"
                      style={{
                        color: "#2d2926",
                        textDecoration: a.completed ? "line-through" : "none",
                      }}
                    >
                      <span aria-hidden>📍 </span>
                      {a.title}
                      {a.is_recurring ? (
                        <span
                          className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#7C3AED] align-middle"
                          aria-label="recurring"
                        >
                          ↻
                        </span>
                      ) : null}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#7a6f65]">
                      {range ? <span className="font-semibold text-[#5c7f63]">{range}</span> : <span>All day</span>}
                      {a.location ? <span className="truncate">· {a.location}</span> : null}
                    </div>
                  </button>
                  {!isPartner && onEditAppointment ? (
                    <button
                      type="button"
                      onClick={() => onEditAppointment(a)}
                      aria-label={`Edit appointment: ${a.title}`}
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#b5aca4] hover:text-[#7C3AED] hover:bg-[#f5f0ff] transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Lessons by child */}
      {lessons.length > 0 ? (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2">
            Lessons
          </p>
          <div className="space-y-3">
            {Array.from(lessonsByChild.entries()).map(([childId, childLessons]) => {
              const meta = childId ? kidsById.get(childId) : undefined;
              const child = meta?.child;
              const colorIdx = meta?.index ?? 0;
              const color = resolveChildColor(child, colorIdx);
              const done = childLessons.filter((l) => l.completed).length;
              const name = child?.name ?? "Unassigned";
              return (
                <div key={childId ?? "__unassigned"} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    >
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs font-semibold text-[#2d2926]">{name}</span>
                    <span className="text-[11px] text-[#7a6f65]">
                      · {done} of {childLessons.length} done
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {childLessons.map((lesson) => (
                      <TodayLessonCard
                        key={lesson.id}
                        lesson={lesson}
                        childObj={child}
                        onToggle={onToggleLesson}
                        onEdit={onEditLesson}
                        onDelete={onDeleteLesson}
                        onReschedule={onRescheduleLesson}
                        onSkip={onSkipLesson}
                        onStartEditingNote={startEditingNote}
                        onMinutesUpdate={onMinutesUpdate}
                        isPartner={isPartner}
                        editingNoteId={editingNoteId}
                        editingNoteText={editingNoteText}
                        noteSaveState={noteSaveState}
                        noteTextareaRef={noteTextareaRef}
                        onNoteTextChange={handleNoteTextChange}
                        onSaveNote={saveNote}
                        onCancelEditingNote={cancelEditingNote}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Empty state */}
      {totalItems === 0 ? (
        <p className="text-sm text-[#b5aca4] text-center py-6">
          Nothing scheduled for this day.
        </p>
      ) : null}

      {/* Activity on this day — collapsible, only rendered when the parent
          passes a non-null dayEvents (PlanV2 does; Today page doesn't, so
          the panel's Today usage is unaffected). */}
      {dayEvents !== undefined ? (
        <section className="border-t border-[#f0ede8] pt-3">
          <button
            type="button"
            onClick={() => setActivityExpanded((v) => !v)}
            aria-expanded={activityExpanded}
            aria-controls="day-activity-body"
            className="w-full flex items-center gap-2 text-left hover:bg-[#faf8f4] -mx-2 px-2 py-1 rounded-lg transition-colors"
          >
            <span aria-hidden className="text-[13px] leading-none">🕒</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] flex-1">
              Activity on this day
              {dayEvents.length > 0 ? (
                <span className="ml-1.5 text-[10px] text-[#9a8e84] normal-case tracking-normal font-medium">
                  · {dayEvents.length}
                </span>
              ) : null}
            </span>
            {activityExpanded ? (
              <ChevronDown size={14} className="text-[#7a6f65]" />
            ) : (
              <ChevronRight size={14} className="text-[#7a6f65]" />
            )}
          </button>

          {activityExpanded ? (
            <div id="day-activity-body" className="mt-2">
              {dayEvents.length === 0 ? (
                <p className="text-xs text-[#9a8e84] py-2">
                  No changes recorded for this day.
                </p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {dayEvents.slice(0, activityVisible).map((row) => {
                      const f = formatEvent(row);
                      return (
                        <li
                          key={row.id}
                          className="flex items-start gap-2 text-[11px] text-[#2d2926] leading-snug"
                        >
                          <span aria-hidden className="mt-0.5">{f.icon}</span>
                          <span className="flex-1 min-w-0">{f.summary}</span>
                          <span
                            className="text-[10px] text-[#9a8e84] tabular-nums shrink-0"
                            title={new Date(row.created_at).toLocaleString()}
                          >
                            {relativeTimestamp(row.created_at)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {dayEvents.length > activityVisible ? (
                    <button
                      type="button"
                      onClick={() => setActivityVisible((v) => v + 10)}
                      className="mt-2 text-[11px] font-semibold text-[#5c7f63] hover:text-[var(--g-deep)]"
                    >
                      Show more
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  if (variant === "sheet") {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
          onClick={onClose}
          aria-hidden
        />
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div
            className="bg-[#fefcf9] rounded-t-3xl shadow-xl w-full max-w-lg flex flex-col pointer-events-auto"
            style={{ maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 shrink-0" aria-hidden />
            <div className="flex-1 overflow-y-auto px-5 py-4">{content}</div>
          </div>
        </div>
      </>
    );
  }

  return content;
}
