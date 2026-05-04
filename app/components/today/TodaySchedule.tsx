"use client";

// Top-level Today schedule container — replaces UnifiedTimeline.
//
// Responsibilities:
//   - Take the flat lessons / appointments / activities arrays the parent
//     loads via loadData / loadTodayActivities / /api/appointments and
//     normalize each into a TodayItem (kind-tagged shape used by groupItems).
//   - Group via groupItems() into Everyone + per-kid sections.
//   - Render the schedule header (title + done count + Manage button), the
//     +Appt / +Log extra lesson buttons row, then Everyone first then each
//     kid's section in sort_order.
//   - Empty-day warm message when nothing is scheduled.
//
// Note: this is a UI redesign. All handlers come straight from the parent
// (page.tsx) and are not modified here. The note editor STATE lives in the
// parent so the existing idle/saving/saved/error UI feedback persists.

import TodayEveryoneSection from "./TodayEveryoneSection";
import TodayKidSection from "./TodayKidSection";
import { groupItems, type TodayItem, type Child } from "./groupItems";
import type { CardHandlers } from "./TodayItemCard";
import { resolveLessonSubject } from "@/lib/lesson-subject";

// ─── Source-row shapes the page already loads (mirror dashboard/page.tsx) ──

type LessonRow = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string;
  hours: number | null;
  minutes_spent: number | null;
  subjects: { name: string; color: string | null } | null;
  // Joined fallback for lessons whose subject_id is null. Loaders include
  // curriculum_goals(subject_label) in every lesson SELECT so the subject
  // grouping ("Math" vs the dreaded "Untitled" bucket) resolves correctly.
  curriculum_goals?: { subject_label: string | null } | null;
  curriculum_goal_id: string | null;
  lesson_number?: number | null;
  goal_id?: string | null;
  notes?: string | null;
  icon_emoji?: string | null;
  scheduled_start_time?: string | null;
};

type ActivityRow = {
  id: string;
  name: string;
  emoji: string;
  duration_minutes: number;
  scheduled_start_time: string | null;
  child_ids: string[];
  completed: boolean;
  log_id?: string | null;
};

type AppointmentRow = {
  id: string;
  title: string;
  emoji: string;
  time: string | null;
  duration_minutes: number;
  location: string | null;
  notes?: string | null;
  child_ids: string[];
  completed: boolean;
  instance_date: string;
};

type Props = {
  lessons: LessonRow[];
  activities: ActivityRow[];
  appointments: AppointmentRow[];
  children: Child[];
  handlers: CardHandlers & {
    onLogExtra: () => void;
    onAddAppt: () => void;
    onManage: () => void;
    // Optional. When provided AND there's at least one incomplete lesson
    // today, render a "Running late?" pill that opens the page-owned
    // Running Late modal. The modal exposes the "Skip the rest of today"
    // button that pushes incomplete lessons to the next school day —
    // dead code on staging until this trigger landed (Bug C, 2026-05-03).
    onRunningLate?: () => void;
  };
  isPartner: boolean;
  isSchoolDay?: boolean;
  noteEditor: {
    editingNoteId: string | null;
    editingNoteText: string;
    noteSaveState: "idle" | "saving" | "saved" | "error";
    onNoteTextChange: (text: string) => void;
    onSaveNote: (lessonId: string) => void;
    onCancelEditingNote: () => void;
  };
};

// Goal-level scheduled_start_time is preferred; lesson row may carry its
// own override. If both are absent, the item has no time and floats to the
// "anytime" portion of its subject group.
function lessonTime(l: LessonRow): string | null {
  return l.scheduled_start_time ?? null;
}

function toItems(
  lessons: LessonRow[],
  activities: ActivityRow[],
  appointments: AppointmentRow[],
): TodayItem[] {
  const out: TodayItem[] = [];
  for (const l of lessons) {
    out.push({
      id: l.id,
      kind: "lesson",
      child_ids: [l.child_id],
      time: lessonTime(l),
      duration_minutes: l.minutes_spent,
      title: l.title,
      subject_label: resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label),
      lesson_number: l.lesson_number ?? null,
      completed: l.completed,
      raw: l,
    });
  }
  for (const a of activities) {
    out.push({
      id: a.id,
      kind: "activity",
      child_ids: a.child_ids ?? [],
      time: a.scheduled_start_time,
      duration_minutes: a.duration_minutes,
      title: a.name,
      subject_label: null,
      lesson_number: null,
      completed: a.completed,
      raw: a,
    });
  }
  for (const ap of appointments) {
    out.push({
      id: ap.id,
      kind: "appointment",
      child_ids: ap.child_ids ?? [],
      time: ap.time,
      duration_minutes: ap.duration_minutes,
      title: ap.title,
      subject_label: null,
      lesson_number: null,
      completed: ap.completed,
      raw: ap,
    });
  }
  return out;
}

export default function TodaySchedule({
  lessons,
  activities,
  appointments,
  children,
  handlers,
  isPartner,
  isSchoolDay = true,
  noteEditor,
}: Props) {
  const items = toItems(lessons, activities, appointments);
  const grouped = groupItems(items, children);
  const totalItems = items.length;
  const doneItems = items.filter((i) => i.completed).length;
  const hasIncompleteLessonToday = lessons.some((l) => !l.completed);

  const childrenLookup = new Map<string, { id: string; name: string; color: string | null }>(
    children.map((c) => [c.id, { id: c.id, name: c.name, color: c.color }]),
  );
  const onlyKid = children.length === 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-0.5 -mb-1">
        <p className="text-[13px] font-medium uppercase tracking-[0.8px] text-[#8a8580]">Today&apos;s schedule</p>
        <div className="flex items-center gap-2">
          {totalItems > 0 && (
            <span className="text-[12px] text-[#b5aca4]">
              {doneItems} of {totalItems} done
            </span>
          )}
          {!isPartner && handlers.onRunningLate && hasIncompleteLessonToday && (
            <button
              type="button"
              onClick={handlers.onRunningLate}
              className="text-[12px] font-medium rounded-full px-3 py-1.5 transition-colors hover:bg-[#f0ede8]"
              style={{ background: "transparent", color: "#7a6f65", border: "1px solid #e8e3dc" }}
            >
              Running late?
            </button>
          )}
          <button
            type="button"
            onClick={handlers.onManage}
            className="flex items-center gap-1 text-[12px] font-medium text-white rounded-full px-3.5 py-1.5 transition-opacity hover:opacity-80"
            style={{ background: "#2D5A3D" }}
          >
            📅 Manage
          </button>
        </div>
      </div>

      {/* Card */}
      <div
        className="bg-white rounded-2xl overflow-hidden mt-2"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)" }}
      >
        {/* Action buttons row — single set, top of schedule */}
        <div className="px-[18px] pt-4 pb-3 border-b border-[#f0ece6]">
          {!isPartner && (
            <div className="flex items-center gap-2">
              {/* Both pills are global actions, not kid-specific. Neutral
                  warm-beige pair so they read as a matched action set,
                  visually distinct from the dark-green Manage button. */}
              <button
                type="button"
                onClick={handlers.onAddAppt}
                className="text-[12px] font-medium rounded-full px-3.5 py-1.5"
                style={{ background: "#f0ede8", color: "var(--g-deep)", border: "1px solid #e8e3dc" }}
              >
                + Appt
              </button>
              <button
                type="button"
                onClick={handlers.onLogExtra}
                className="text-[12px] font-medium rounded-full px-3.5 py-1.5"
                style={{ background: "#f0ede8", color: "var(--g-deep)", border: "1px solid #e8e3dc" }}
              >
                + Log an extra lesson
              </button>
            </div>
          )}
        </div>

        {/* Sections */}
        <div className="px-3 py-3">
          {totalItems === 0 ? (
            <div className="py-7 px-6 text-center">
              <div className="text-[28px] mb-2">{isSchoolDay ? "🌿" : "☀️"}</div>
              <p
                className="text-[14px]"
                style={{ color: "var(--color-text-secondary, #5C5248)" }}
              >
                You have nothing scheduled today. Please enjoy your day!
              </p>
            </div>
          ) : (
            <>
              <TodayEveryoneSection
                items={grouped.everyone}
                children={children.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
                childrenLookup={childrenLookup}
                handlers={handlers}
                isPartner={isPartner}
                noteEditor={noteEditor}
              />
              {grouped.kids.map((kidSection) => (
                <TodayKidSection
                  key={kidSection.child.id}
                  section={kidSection}
                  onlyKid={onlyKid}
                  handlers={handlers}
                  isPartner={isPartner}
                  childrenLookup={childrenLookup}
                  noteEditor={noteEditor}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
