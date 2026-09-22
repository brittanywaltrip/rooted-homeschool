"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Printer, Calendar, Clock, BookOpen, CheckSquare, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { canExport } from "@/lib/user-access";
import { schoolNameFor } from "@/lib/school-name";
import { mergeBookRecords, bookBelongsToChild, bookCover, bookHowLabel, ratingLeaves, isFinishedBook, isReadingBook, BOOK_HOW_LABELS, LEGACY_BOOK_EVENT_TYPES, type MemoryRecord } from "@/lib/memory-leaves";
import SignedImage from "@/components/SignedImage";
import ExportGateModal from "@/app/components/ExportGateModal";
import { attendancePresentDates, lessonReportSubject } from "@/lib/progress-report-rows";
import {
  selectActivitySessions, summarizeActivitySessions, groupActivitySessions,
  activityChildLabel, formatSessionDuration,
  type ActivityDefinition, type ActivityLogRow,
} from "@/lib/activity-sessions";
import { selectAllRowsResult } from "@/lib/supabase-all-rows";
import { fallbackSchoolYear, getCurrentSchoolYear, todayLocalYmd } from "@/app/lib/school-year";
import { selectReportPhotos, type ReportPhoto } from "@/lib/report-evidence";
import { buildActivityLog, selectReportAppointments } from "@/lib/report-activity-log";
import { dayOffLength, selectReportDaysOff, type ReportBreak } from "@/lib/report-days-off";
import { resyncGoalsForParent, PARENT_RESPREAD_SOURCE, COMPLETION_RESPREAD_FAILED_NOTE } from "@/app/lib/scheduler";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child    = { id: string; name: string };
type Lesson   = {
  id: string; child_id: string;
  curriculum_goal_id: string | null;
  curriculum_goals: { subject_label: string | null } | null;
  title: string; date: string | null; scheduled_date: string | null;
  completed: boolean;
  minutes_spent: number | null;
  notes: string | null;
};
/**
 * A book read, from `memories` (type 'book') merged with the pre-March
 * `app_events` rows. See lib/memory-leaves.ts — books moved tables in March
 * 2026 and this page used to read the legacy table alone.
 */
type BookRecord = MemoryRecord;
type MemoryActivity = { child_id: string | null; type: string; date: string; duration_minutes: number | null };
type ReportAppointment = {
  id: string;
  title: string;
  emoji: string;
  date: string;
  duration_minutes: number | null;
  location: string | null;
  child_ids: string[];
  is_school_activity: boolean;
};
type ReportRecordPatch = { date: string; minutes: number | null; notes: string | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
/**
 * The first paint's "This Year" start, before the family's school year has
 * loaded: the August 1 fallback from app/lib/school-year.ts. The page swaps in
 * the real start (the active school year) as soon as it arrives.
 */
function fallbackYearStart() {
  return fallbackSchoolYear(todayLocalYmd()).start;
}

/** Every column this page reads off a lesson row. Shared by both reads. */
const LESSON_COLUMNS =
  "id, child_id, curriculum_goal_id, curriculum_goals(subject_label), title, date, scheduled_date, completed, minutes_spent, notes";

/**
 * The window the UNCOMPLETED half of the lesson read covers.
 *
 * Completed lessons are fetched with no date filter at all, because hours and
 * attendance have to be right for whatever range the family picks, including
 * a range from three years ago. Uncompleted lessons are different: they carry
 * no hours and no attendance, so they only matter inside a range that is on
 * screen. This window runs from the August 1 fallback start of the current
 * school year (the first paint's default dateFrom) through today (the default
 * dateTo).
 *
 * Bounding it, rather than reading uncompleted rows unfiltered, is what keeps
 * the fix from costing more than the bug. The family this was found on has
 * 1,950 uncompleted lessons scheduled out across the coming year and 12 inside
 * this window; the rest are a future schedule no report renders. Fixing it
 * off the pickers rather than off dateFrom/dateTo also keeps typing in a date
 * field from re-running all eight of this page's queries.
 *
 * A hand-typed dateTo in the future can therefore reach past this window, and
 * that is deliberate: nothing on this page reads an uncompleted lesson today.
 * If that changes, widen this and page it, do not drop the bound.
 */
function openLessonWindow(): { from: string; to: string } {
  // The August 1 fallback, not the family's own start: nothing here reads an
  // uncompleted lesson (see above), so this bound is only about read size, and
  // keying it off a value that loads later would run every query twice.
  return { from: fallbackYearStart(), to: toDateStr(new Date()) };
}

// ─── Reading log helpers ──────────────────────────────────────────────────────

/**
 * A book's caption is written by the Today book modal as
 * "Author: X | Pages: N", where either half may be absent. Rows predating that
 * format hold free text, and nothing stops a family from editing a caption by
 * hand in Memories, so this parser treats the structured shape as a lucky case
 * rather than a guarantee.
 *
 * Structured halves are extracted only when they actually match. Anything else
 * is returned whole as `freeText`, which the UI shows in the author slot and
 * counts as zero pages. Never throws.
 */
type ParsedCaption = { author: string | null; pages: number | null; freeText: string | null };

function parseBookCaption(caption: string | null | undefined): ParsedCaption {
  const empty: ParsedCaption = { author: null, pages: null, freeText: null };
  if (typeof caption !== "string") return empty;
  const trimmed = caption.trim();
  if (!trimmed) return empty;

  let author: string | null = null;
  let pages: number | null = null;

  for (const part of trimmed.split("|")) {
    const seg = part.trim();
    if (!seg) continue;
    const authorMatch = /^author\s*:\s*(.+)$/i.exec(seg);
    if (authorMatch) {
      const value = authorMatch[1].trim();
      if (value) author = value;
      continue;
    }
    const pagesMatch = /^pages\s*:\s*(\d{1,6})\b/i.exec(seg);
    if (pagesMatch) {
      const n = Number.parseInt(pagesMatch[1], 10);
      // A page count of 0 is not a reading record, and six digits is already
      // far past any real book — either way, count nothing rather than put a
      // nonsense total on a document going into a state portfolio.
      if (Number.isFinite(n) && n > 0) pages = n;
      continue;
    }
  }

  // Neither half matched: keep the caption intact rather than discarding what
  // the family wrote.
  if (author === null && pages === null) return { author: null, pages: null, freeText: trimmed };
  return { author, pages, freeText: null };
}

/** A book plus its parsed caption, ready to render or print. */
type ReadingLogEntry = BookRecord & ParsedCaption;

function buildReadingLog(
  books: BookRecord[],
  childId: string,
  dateFrom: string,
  dateTo: string,
): ReadingLogEntry[] {
  return books
    .filter((b) => {
      // A book still being read is not a book read. It lives on the shelf
      // above until it is finished; see isFinishedBook.
      if (!isFinishedBook(b)) return false;
      const d = b.date ?? "";
      if (!d || d < dateFrom || d > dateTo) return false;
      // Attribution lives in one place (lib/memory-leaves.ts): a book counts
      // for a child when book_child_ids names them, or when the array is unset
      // and the legacy child_id rules say so. A book read to Ada and Bea never
      // reaches Cal's log.
      return bookBelongsToChild(b, childId);
    })
    .map((b) => {
      // Structured columns win; the caption parse is the fallback for legacy
      // app_events books and for anything the August 2026 backfill could not
      // make sense of. Both agree on every backfilled row, so this changes no
      // existing output — it just stops new books depending on a string.
      const parsed = parseBookCaption(b.caption);
      const author = b.book_author ?? parsed.author;
      return {
        ...b,
        author,
        pages: b.book_pages ?? parsed.pages,
        // Only surface raw caption text when there is no author to show;
        // otherwise a free-text caption would shove the author aside.
        freeText: author ? null : parsed.freeText,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function formatLogDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Print Report Component ───────────────────────────────────────────────────

function PrintReport({
  child, allChildren: allKids, dateFrom, dateTo, lessons, books, activities, appointments,
  activityLogs, activityDefs, photos, includePhotos, breaks, canEdit,
  onUpdateLesson, onDeleteLesson, onUpdateActivity, onDeleteActivity,
}: {
  child: Child | null;
  allChildren: Child[];
  dateFrom: string; dateTo: string;
  lessons: Lesson[];
  books: BookRecord[];
  /** TIMED MEMORIES, not recurring activities. See lib/activity-sessions.ts. */
  activities: MemoryActivity[];
  appointments: ReportAppointment[];
  /** Completed occurrences of a recurring activity. */
  activityLogs: ActivityLogRow[];
  /** Their definitions, INCLUDING retired ones. */
  activityDefs: ActivityDefinition[];
  photos: ReportPhoto[];
  /** The "Include photos" choice. Off leaves photos out of this document only. */
  includePhotos: boolean;
  /** Breaks from Plan (vacation_blocks). Listed as Days Off; never change Days Present. */
  breaks: ReportBreak[];
  canEdit: boolean;
  onUpdateLesson: (lessonId: string, patch: ReportRecordPatch) => Promise<boolean>;
  onDeleteLesson: (lessonId: string) => Promise<boolean>;
  onUpdateActivity: (logId: string, patch: ReportRecordPatch) => Promise<boolean>;
  onDeleteActivity: (logId: string) => Promise<boolean>;
}) {
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [detailText, setDetailText] = useState("");
  const [recordDate, setRecordDate] = useState("");
  const [recordMinutes, setRecordMinutes] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const filteredLessons = lessons.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    if (!d) return false;
    if (child && l.child_id !== child.id) return false;
    return d >= dateFrom && d <= dateTo;
  });
  // Same attribution rule as the Reading Log — see bookBelongsToChild.
  const filteredBooks = books.filter((b) => {
    if (!isFinishedBook(b)) return false;
    if (!bookBelongsToChild(b, child ? child.id : null)) return false;
    const d = b.date ?? "";
    return d >= dateFrom && d <= dateTo;
  });

  const completedLessons = filteredLessons.filter((l) => l.completed);
  const lessonDetails = completedLessons.slice().sort((a, b) => {
    const ad = a.date ?? a.scheduled_date ?? "";
    const bd = b.date ?? b.scheduled_date ?? "";
    return ad.localeCompare(bd) || a.title.localeCompare(b.title);
  });
  const filteredActivities = activities.filter((a) => {
    if (child && a.child_id !== child.id) return false;
    return a.date >= dateFrom && a.date <= dateTo && a.duration_minutes;
  });
  const lessonHours = completedLessons.reduce((sum, l) => sum + ((l.minutes_spent ?? 30) / 60), 0);
  const memoryHours = filteredActivities.reduce((sum, a) => sum + ((a.duration_minutes ?? 0) / 60), 0);

  // Completed recurring-activity sessions: a FOURTH source, distinct from the
  // timed memories above. They come from activity_logs, which this page did not
  // read at all, so a family recording her out-of-curriculum time as recurring
  // activities saw none of it here while the Progress Report showed all of it.
  //
  // No double counting: these are activity_logs rows, `filteredActivities` are
  // memories rows, and nothing writes one when the other is created.
  const activitySessions = selectActivitySessions(activityLogs, activityDefs, {
    childId: child ? child.id : null, dateFrom, dateTo,
  });
  const activitySummary = summarizeActivitySessions(activitySessions);
  const activityGroups = groupActivitySessions(activitySessions);

  const filteredPhotos = selectReportPhotos(photos, child?.id ?? null, dateFrom, dateTo, includePhotos);

  function patchFromEditor(): ReportRecordPatch | null {
    const minutes = recordMinutes.trim() === "" ? null : Number(recordMinutes);
    if (!recordDate || (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440))) {
      setDetailError("Choose a date and enter minutes from 0 to 1440.");
      return null;
    }
    return { date: recordDate, minutes, notes: detailText.trim() || null };
  }

  async function saveLessonDetail(lessonId: string) {
    const patch = patchFromEditor();
    if (!patch) return;
    setDetailSaving(true);
    const ok = await onUpdateLesson(lessonId, patch);
    setDetailSaving(false);
    if (ok) { setEditingLessonId(null); setDetailText(""); setDeleteConfirm(null); setDetailError(null); }
    else setDetailError("That didn't save. Please try again.");
  }

  async function saveActivityDetail(logId: string) {
    const patch = patchFromEditor();
    if (!patch) return;
    setDetailSaving(true);
    const ok = await onUpdateActivity(logId, patch);
    setDetailSaving(false);
    if (ok) { setEditingActivityId(null); setDetailText(""); setDeleteConfirm(null); setDetailError(null); }
    else setDetailError("That didn't save. Please try again.");
  }

  async function deleteLesson(lessonId: string) {
    setDetailSaving(true);
    const ok = await onDeleteLesson(lessonId);
    setDetailSaving(false);
    if (ok) { setEditingLessonId(null); setDeleteConfirm(null); setDetailError(null); }
    else setDetailError("That didn't delete. Please try again.");
  }

  async function deleteActivity(logId: string) {
    setDetailSaving(true);
    const ok = await onDeleteActivity(logId);
    setDetailSaving(false);
    if (ok) { setEditingActivityId(null); setDeleteConfirm(null); setDetailError(null); }
    else setDetailError("That didn't delete. Please try again.");
  }

  const totalHours = lessonHours + memoryHours + activitySummary.hours;

  const subjectMap: Record<string, { name: string; color: string | null; count: number; hours: number }> = {};
  completedLessons.forEach((l) => {
    // Same resolution the Progress Report uses, so the two documents cannot
    // disagree about what a lesson's subject is. "Unassigned" is this page's
    // wording for the same last resort.
    const name = lessonReportSubject(l, "Unassigned");
    // Standalone logs used to collapse into ONE "uncat" bucket, so a family
    // whose extra logs span Music, Math and Writing saw a single "Unassigned"
    // line. With a real subject per row they group by that instead, which is
    // the whole point of resolving it.
    const key = l.curriculum_goal_id ?? `uncat:${name}`;
    if (!subjectMap[key]) {
      subjectMap[key] = { name, color: null, count: 0, hours: 0 };
    }
    subjectMap[key].count++;
    subjectMap[key].hours += (l.minutes_spent ?? 30) / 60;
  });

  // For a single-child report, whole-family appointments (empty child_ids)
  // are counted toward that child; appointments explicitly tagged to other
  // kids are excluded. "All Children" includes everything.
  const filteredAppointments: ReportAppointment[] = selectReportAppointments(appointments, child?.id ?? null, dateFrom, dateTo);

  // Sessions and appointments printed as ONE dated list. A plain union of two
  // tables that never write to each other: every record appears once. Only
  // session minutes count toward Hours Logged, as before; appointment time is
  // shown on its row and has never been part of that total.
  const activityLog = buildActivityLog(activitySessions, filteredAppointments);

  // Days Present unions completed-lesson dates with completed-appointment
  // dates so co-op or activity days without a curriculum lesson still count.
  // Dates appearing in both contribute once. The rule, and why it reads the
  // lesson's own day, lives in attendancePresentDates.
  const presentDates = attendancePresentDates(completedLessons, filteredAppointments.map((a) => a.date));
  const daysOff = selectReportDaysOff(breaks, dateFrom, dateTo);

  const fromLabel = new Date(dateFrom + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const toLabel   = new Date(dateTo   + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="print-content hours-report-print-sheet bg-white p-6 rounded-2xl border border-[#e8e2d9] space-y-6">
      {/* Report header */}
      <div className="flex items-start justify-between border-b border-[#e8e2d9] pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🌿</span>
            <span className="font-bold text-[#5c7f63]">Rooted</span>
          </div>
          <h2 className="text-xl font-bold text-[#2d2926]">
            {child ? `${child.name}'s ` : ""}Hours &amp; Attendance Log
          </h2>
          <p className="text-sm text-[#7a6f65]">{fromLabel} – {toLabel}</p>
        </div>
        <p className="text-xs text-[#b5aca4] text-right">
          Generated {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Summary stats */}
      {/* Five tiles. sm:grid-cols-3 then lg:grid-cols-5, never 4, because 5
          across a 4-column grid leaves the last tile alone on its own row at
          normal desktop widths. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { icon: CheckSquare, label: "Lessons Completed", value: completedLessons.length, color: "#5c7f63" },
          // Sessions, not activity types: 8 activities producing 20 sessions is
          // 20 here. Both numbers appear in the Activities section below.
          { icon: Sparkles,    label: "Activity Sessions",  value: activitySummary.sessions, color: "#7a6f9a" },
          { icon: Clock,       label: "Hours Logged",      value: `${totalHours.toFixed(1)}h`, color: "#8b6f47" },
          { icon: Calendar,    label: "Days Present",      value: presentDates.size, color: "#4a7a8a" },
          { icon: BookOpen,    label: "Books Read",        value: filteredBooks.length, color: "#7a4a8a" },
        ].map(({ icon: Icon, label, value, color }, i, arr) => (
          // Five tiles in a two-column phone grid leave the fifth alone on a
          // half-empty row. The odd one out spans both columns there; at sm and
          // above the grid divides evenly and it goes back to one cell.
          <div
            key={label}
            className={`rounded-xl border border-[#e8e2d9] p-3 text-center${
              i === arr.length - 1 && arr.length % 2 === 1 ? " col-span-2 sm:col-span-1" : ""
            }`}
          >
            <Icon size={16} className="mx-auto mb-1" style={{ color }} />
            <p className="text-xl font-bold text-[#2d2926]">{value}</p>
            <p className="text-[10px] text-[#7a6f65] leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Subjects covered */}
      {Object.values(subjectMap).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Subjects Covered
          </h3>
          <div className="space-y-2">
            {Object.values(subjectMap)
              .sort((a, b) => b.count - a.count)
              .map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color ?? "#5c7f63" }}
                  />
                  <span className="text-sm text-[#2d2926] flex-1">{s.name}</span>
                  <span className="text-xs text-[#7a6f65]">{s.count} lessons</span>
                  {s.hours > 0 && (
                    <span className="text-xs text-[#b5aca4]">{s.hours.toFixed(1)}h</span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* A legal/portfolio record needs the work itself, not only aggregate
          counts. Notes are the family's own description and are never
          synthesized. The edit control is screen-only; the saved words are
          part of the printed row. */}
      {lessonDetails.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Completed Lessons ({lessonDetails.length})
          </h3>
          <table className="w-full text-sm border-t border-[#e8e2d9]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-[#b5aca4]">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Subject</th>
                <th className="py-2 pr-3 font-medium">Lesson and details</th>
                <th className="py-2 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {lessonDetails.map((lesson) => {
                const date = lesson.date ?? lesson.scheduled_date;
                const minutes = lesson.minutes_spent ?? 30;
                return (
                  <tr key={lesson.id} className="border-t border-[#f2ede6]">
                    <td className="py-2 pr-3 align-top text-[#7a6f65] whitespace-nowrap">{formatLogDate(date)}</td>
                    <td className="py-2 pr-3 align-top text-[#7a6f65]">{lessonReportSubject(lesson, "Unassigned")}</td>
                    <td className="py-2 pr-3 align-top text-[#2d2926]">
                      <span className="font-medium">{lesson.title}</span>
                      {lesson.notes && <span className="block mt-0.5 text-[#6b6560] whitespace-pre-wrap">{lesson.notes}</span>}
                      {canEdit && editingLessonId === lesson.id ? (
                        <div className="no-print mt-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-[#7a6f65]">Date
                              <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)}
                                className="mt-1 block w-full rounded-lg border border-[#d8d0c6] bg-white px-2 py-1.5 text-sm text-[#2d2926]" />
                            </label>
                            <label className="text-[11px] text-[#7a6f65]">Minutes
                              <input type="number" min="0" max="1440" value={recordMinutes} onChange={(e) => setRecordMinutes(e.target.value)}
                                className="mt-1 block w-full rounded-lg border border-[#d8d0c6] bg-white px-2 py-1.5 text-sm text-[#2d2926]" />
                            </label>
                          </div>
                          <textarea value={detailText} onChange={(e) => setDetailText(e.target.value)}
                            placeholder="What was covered? Add the details you want in the report."
                            className="w-full min-h-20 rounded-xl border border-[#d8d0c6] bg-white p-2.5 text-sm text-[#2d2926]" />
                          {detailError && <p className="text-xs text-red-600">{detailError}</p>}
                          <div className="flex gap-2">
                            <button type="button" disabled={detailSaving} onClick={() => saveLessonDetail(lesson.id)}
                              className="rounded-lg bg-[#5c7f63] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                              {detailSaving ? "Saving..." : "Save details"}
                            </button>
                            <button type="button" onClick={() => { setEditingLessonId(null); setDetailText(""); }}
                              className="px-2 py-1.5 text-xs font-medium text-[#7a6f65]">Cancel</button>
                            {deleteConfirm === lesson.id ? (
                              <button type="button" disabled={detailSaving} onClick={() => deleteLesson(lesson.id)}
                                className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm delete</button>
                            ) : (
                              <button type="button" onClick={() => setDeleteConfirm(lesson.id)}
                                className="ml-auto px-2 py-1.5 text-xs font-medium text-red-600">Delete record</button>
                            )}
                          </div>
                          {deleteConfirm === lesson.id && <p className="text-[11px] text-red-700">This removes the completed record and its attached photos. Later curriculum lesson numbers will close the gap.</p>}
                        </div>
                      ) : canEdit ? (
                        <button type="button" className="no-print block mt-1 text-xs font-medium text-[#5c7f63]"
                          onClick={() => { setEditingActivityId(null); setEditingLessonId(lesson.id); setRecordDate(date ?? ""); setRecordMinutes(String(lesson.minutes_spent ?? 30)); setDetailText(lesson.notes ?? ""); setDeleteConfirm(null); setDetailError(null); }}>
                          Edit record
                        </button>
                      ) : null}
                    </td>
                    <td className="py-2 align-top text-right text-[#7a6f65] whitespace-nowrap">{formatSessionDuration(minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Books read */}
      {filteredBooks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Books Read
          </h3>
          <div className="space-y-1">
            {filteredBooks.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-[#5c7f63]">📖</span>
                <span className="text-[#2d2926]">{b.title ?? "Untitled"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* One Activities section: completed recurring-activity sessions and
           completed school appointments, which used to print as two sections.
           Each rollup line is a definition; the count beside it is completed
           sessions, not definitions. Appointments are listed in the dated
           table below and, as before, do not add to Hours Logged. */}
      {activityLog.rows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Activities ({[
              activityLog.sessions > 0
                ? `${activityLog.sessions} ${activityLog.sessions === 1 ? "session" : "sessions"}, ${activitySummary.hours.toFixed(1)}h`
                : null,
              activityLog.appointments > 0
                ? `${activityLog.appointments} ${activityLog.appointments === 1 ? "appointment" : "appointments"}`
                : null,
            ].filter(Boolean).join(", ")})
          </h3>
          <div className="space-y-1">
            {activityGroups.map((g) => (
              <div key={g.activityId} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span>{g.emoji ?? "\u2728"}</span>
                  <span className="text-[#2d2926]">{g.name}</span>
                  {/* A retired activity keeps its history and says so, rather
                      than vanishing from a document a family may need to file. */}
                  {g.retired && (
                    <span className="text-[10px] uppercase tracking-wide text-[#b5aca4] whitespace-nowrap">no longer scheduled</span>
                  )}
                </span>
                <span className="text-[#7a6f65]">
                  {g.sessions} {g.sessions === 1 ? "session" : "sessions"} · {(g.minutes / 60).toFixed(1)}h
                </span>
              </div>
            ))}
          </div>

          {/* One row per completed session or appointment, in date order. The
              grouped totals above answer "how much"; this answers "when", which
              is what a family is asked for when she has to show her work. Same
              filters as the totals: every session here is in them, and each
              record appears once (lib/report-activity-log.ts). */}
          <table className="w-full mt-4 text-sm border-t border-[#e8e2d9]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-[#b5aca4]">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Activity</th>
                <th className="py-2 pr-3 font-medium">For</th>
                <th className="py-2 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {activityLog.rows.map((row) => {
                if (row.kind === "appointment") {
                  const a = row.appointment;
                  const kidLabel = a.child_ids.length === 0
                    ? "Whole family"
                    : a.child_ids
                        .map((id) => allKids.find((c) => c.id === id)?.name)
                        .filter((n): n is string => !!n)
                        .join(", ");
                  return (
                    <tr key={row.key} className="border-t border-[#f2ede6]">
                      <td className="py-1.5 pr-3 align-top text-[#7a6f65] whitespace-nowrap">{formatLogDate(row.date)}</td>
                      <td className="py-1.5 pr-3 align-top text-[#2d2926]">
                        <span className="mr-1">{a.emoji || "\u{1F4CD}"}</span>
                        {a.title}
                        <span className="block text-[10px] uppercase tracking-wide text-[#b5aca4]">appointment</span>
                      </td>
                      <td className="py-1.5 pr-3 align-top text-[#7a6f65]">{kidLabel || "\u2014"}</td>
                      <td className="py-1.5 align-top text-[#7a6f65] text-right whitespace-nowrap">
                        {formatSessionDuration(row.minutes)}
                      </td>
                    </tr>
                  );
                }
                const s = row.session;
                const who = activityChildLabel(s, (id) => allKids.find((k) => k.id === id)?.name);
                return (
                  <tr key={row.key} className="border-t border-[#f2ede6]">
                    <td className="py-1.5 pr-3 align-top text-[#7a6f65] whitespace-nowrap">{formatLogDate(s.date)}</td>
                    <td className="py-1.5 pr-3 align-top text-[#2d2926]">
                      <span className="mr-1">{s.emoji ?? "\u2728"}</span>
                      {s.name}
                      {/* On its own line under the name. Inline, the marker
                          widened the Activity column past a phone and pushed the
                          Time column off the screen entirely. */}
                      {s.definitionMissing ? (
                        <span className="block text-[10px] uppercase tracking-wide text-[#b5aca4]">past activity</span>
                      ) : !s.definitionIsActive ? (
                        <span className="block text-[10px] uppercase tracking-wide text-[#b5aca4]">no longer scheduled</span>
                      ) : null}
                      {s.notes && <span className="block mt-0.5 text-[#6b6560] whitespace-pre-wrap">{s.notes}</span>}
                      {canEdit && s.logId && (editingActivityId === s.logId ? (
                        <div className="no-print mt-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-[#7a6f65]">Date
                              <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)}
                                className="mt-1 block w-full rounded-lg border border-[#d8d0c6] bg-white px-2 py-1.5 text-sm text-[#2d2926]" />
                            </label>
                            <label className="text-[11px] text-[#7a6f65]">Minutes
                              <input type="number" min="0" max="1440" value={recordMinutes} onChange={(e) => setRecordMinutes(e.target.value)}
                                className="mt-1 block w-full rounded-lg border border-[#d8d0c6] bg-white px-2 py-1.5 text-sm text-[#2d2926]" />
                            </label>
                          </div>
                          <textarea value={detailText} onChange={(e) => setDetailText(e.target.value)}
                            placeholder="What did you work on during this activity?"
                            className="w-full min-h-20 rounded-xl border border-[#d8d0c6] bg-white p-2.5 text-sm text-[#2d2926]" />
                          {detailError && <p className="text-xs text-red-600">{detailError}</p>}
                          <div className="flex gap-2">
                            <button type="button" disabled={detailSaving} onClick={() => saveActivityDetail(s.logId!)}
                              className="rounded-lg bg-[#5c7f63] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                              {detailSaving ? "Saving..." : "Save details"}
                            </button>
                            <button type="button" onClick={() => { setEditingActivityId(null); setDetailText(""); }}
                              className="px-2 py-1.5 text-xs font-medium text-[#7a6f65]">Cancel</button>
                            {deleteConfirm === s.logId ? (
                              <button type="button" disabled={detailSaving} onClick={() => deleteActivity(s.logId!)}
                                className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm delete</button>
                            ) : (
                              <button type="button" onClick={() => setDeleteConfirm(s.logId!)}
                                className="ml-auto px-2 py-1.5 text-xs font-medium text-red-600">Delete record</button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="no-print block mt-1 text-xs font-medium text-[#5c7f63]"
                          onClick={() => { setEditingLessonId(null); setEditingActivityId(s.logId); setRecordDate(s.date); setRecordMinutes(String(s.minutes)); setDetailText(s.notes ?? ""); setDeleteConfirm(null); setDetailError(null); }}>
                          Edit record
                        </button>
                      ))}
                    </td>
                    {/* Blank rather than a guess: a missing definition carries
                        no child_ids, so whose session it was is not known. */}
                    {/* Wraps rather than nowrap: "Whole family" held on one line made the
                        table wider than a phone and pushed the Time column out of
                        sight entirely. align-top keeps a wrapped name lined up with
                        its date, which was the actual complaint. */}
                    <td className="py-1.5 pr-3 align-top text-[#7a6f65]">{who ?? "\u2014"}</td>
                    <td className="py-1.5 align-top text-[#7a6f65] text-right whitespace-nowrap">
                      {formatSessionDuration(s.minutes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filteredPhotos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Photo Documentation ({filteredPhotos.length})
          </h3>
          <p className="no-print -mt-1 mb-3 text-xs text-[#7a6f65]">
            Need to change a caption? Open <Link href="/dashboard/memories" className="font-semibold text-[#5c7f63] underline underline-offset-2">Memories</Link>, select the photo, and choose Edit.
          </p>
          <div className="grid grid-cols-2 gap-4 report-photo-grid">
            {filteredPhotos.map((photo) => {
              const childName = photo.child_id ? allKids.find((kid) => kid.id === photo.child_id)?.name : null;
              // Only print words the family actually supplied. A neutral alt
              // label is accessibility metadata, not evidence on the page.
              const caption = photo.caption?.trim() || photo.title?.trim() || null;
              return (
                <figure key={photo.id} data-report-photo className="break-inside-avoid rounded-xl border border-[#e8e2d9] overflow-hidden bg-white">
                  <SignedImage src={photo.photo_url} bucket="memory-photos" alt={caption ?? "Photo documentation"}
                    className="block w-full aspect-[4/3] object-contain bg-[#f5f0e8]" />
                  <figcaption className="p-3">
                    {caption && <p className="text-sm text-[#2d2926] whitespace-pre-wrap">{caption}</p>}
                    <p className={`${caption ? "mt-1 " : ""}text-[11px] text-[#8a8078]`}>
                      {formatLogDate(photo.date)}{childName ? ` · ${childName}` : " · Whole family"}
                    </p>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      )}

      {/* Attendance list */}
      {presentDates.size > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Attendance ({presentDates.size} days)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {[...presentDates].sort().map((d) => (
              <span key={d} className="text-[10px] bg-[#e8f0e9] text-[var(--g-deep)] px-2 py-1 rounded-lg">
                {new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Days off: breaks recorded in Plan, such as a sick day. A record only;
          they do not add to or remove from Days Present. A break has no child,
          so every entry says "Whole family" rather than implying one child. */}
      {daysOff.length > 0 && (
        <div data-report-days-off>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Days Off ({daysOff.length})
          </h3>
          <ul className="space-y-1">
            {daysOff.map((d) => {
              const days = dayOffLength(d);
              return (
                <li key={d.id} className="text-sm text-[#2d2926] break-inside-avoid">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-[#8a8078]">
                    {" · "}
                    {d.start === d.end ? formatLogDate(d.start) : `${formatLogDate(d.start)} to ${formatLogDate(d.end)}`}
                    {days > 1 ? ` (${days} days)` : ""}
                    {" · Whole family"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-[#e8e2d9] pt-4 text-center">
        <p className="text-xs text-[#b5aca4]">
          Generated by Rooted · This report documents home education activities for record-keeping purposes.
        </p>
      </div>
    </div>
  );
}

// ─── Reading Log print sheet ──────────────────────────────────────────────────

/**
 * The portfolio document. Pennsylvania requires a printed list of reading
 * materials and other portfolio states ask for the same, so this sheet is the
 * product: plain table, real dates, no decoration competing with the data.
 *
 * Rendered off-screen and revealed only during its own print job — see the
 * print-mode-reading-log rules in the page's <style> block.
 */
function ReadingLogPrintSheet({
  entries, inProgress, schoolName, childName, dateFrom, dateTo, mode,
}: {
  entries: ReadingLogEntry[];
  /** In-progress books, listed on the detailed sheet only. */
  inProgress: ReadingLogEntry[];
  schoolName: string;
  childName: string;
  dateFrom: string;
  dateTo: string;
  /**
   * 'simple' prints only what a portfolio reviewer asks for: date and title.
   * 'detailed' adds author, pages, how it was read, the rating and the notes.
   * A reviewer who wanted a bare list should not have to explain away a column
   * of leaf emoji, which is why simple is the default and is genuinely bare.
   */
  mode: "simple" | "detailed";
}) {
  const detailed = mode === "detailed";
  const totalPages = entries.reduce((sum, e) => sum + (e.pages ?? 0), 0);
  const fromLabel = formatLogDate(dateFrom);
  const toLabel = formatLogDate(dateTo);

  const columns = detailed
    ? [
        { label: "Date",   width: "14%", align: "left"  as const },
        { label: "Title",  width: "30%", align: "left"  as const },
        { label: "Author", width: "22%", align: "left"  as const },
        { label: "Pages",  width: "10%", align: "right" as const },
        { label: "How",    width: "14%", align: "left"  as const },
        { label: "Rating", width: "10%", align: "left"  as const },
      ]
    : [
        { label: "Date",  width: "22%", align: "left" as const },
        { label: "Title", width: "78%", align: "left" as const },
      ];

  return (
    <div className="reading-log-print-sheet" style={{ background: "#ffffff", color: "#000000", padding: 24 }}>
      <div style={{ borderBottom: "1px solid #333", paddingBottom: 10, marginBottom: 14 }}>
        {schoolName ? (
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{schoolName}</p>
        ) : null}
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: "4px 0 0" }}>Reading Log</h2>
        <p style={{ fontSize: 12, margin: "3px 0 0" }}>{childName}</p>
        <p style={{ fontSize: 12, margin: "2px 0 0" }}>{fromLabel} – {toLabel}</p>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: 12 }}>No books recorded for this period.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.label}
                  style={{
                    width: col.width, textAlign: col.align, padding: "6px 4px",
                    borderBottom: "1px solid #333", fontWeight: 700,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const cell = { padding: "5px 4px", borderBottom: "1px solid #ddd", verticalAlign: "top" as const };
              // Notes get their own full-width row beneath the entry rather
              // than a cramped column, and only in detailed mode. Without the
              // bottom border on the row above, the pair reads as one record.
              const notes = detailed ? (e.book_notes ?? "").trim() : "";
              const noNextBorder = notes ? { ...cell, borderBottom: "none" } : cell;
              return (
                <Fragment key={e.id ?? `book-${i}`}>
                  <tr style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <td style={noNextBorder}>{formatLogDate(e.date)}</td>
                    <td style={noNextBorder}>{e.title ?? "Untitled"}</td>
                    {detailed && (
                      <>
                        <td style={noNextBorder}>{e.author ?? e.freeText ?? ""}</td>
                        <td style={{ ...noNextBorder, textAlign: "right" }}>{e.pages ?? ""}</td>
                        <td style={noNextBorder}>{bookHowLabel(e.book_how) ?? ""}</td>
                        <td style={noNextBorder}>{ratingLeaves(e.book_rating)}</td>
                      </>
                    )}
                  </tr>
                  {notes && (
                    <tr style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                      <td />
                      <td
                        colSpan={columns.length - 1}
                        style={{ ...cell, fontStyle: "italic", color: "#444", paddingTop: 0 }}
                      >
                        {notes}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: 12, fontWeight: 700, marginTop: 12 }}>
        Total: {entries.length} book{entries.length !== 1 ? "s" : ""}
        {totalPages > 0 ? ` · ${totalPages.toLocaleString()} pages` : ""}
      </p>

      {detailed && inProgress.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>In progress</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {[
                  { label: "Started", width: "22%" },
                  { label: "Title", width: "48%" },
                  { label: "Author", width: "30%" },
                ].map((col) => (
                  <th key={col.label} style={{ width: col.width, textAlign: "left", padding: "5px 4px", borderBottom: "1px solid #333", fontWeight: 700 }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inProgress.map((e, i) => (
                <tr key={e.id ?? `wip-${i}`} style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                  <td style={{ padding: "5px 4px", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                    {formatLogDate(e.book_started_date ?? e.date)}
                  </td>
                  <td style={{ padding: "5px 4px", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                    {e.title ?? "Untitled"}
                  </td>
                  <td style={{ padding: "5px 4px", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                    {e.author ?? e.freeText ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ borderTop: "1px solid #ccc", marginTop: 16, paddingTop: 8, textAlign: "center" }}>
        <p style={{ fontSize: 10, color: "#555", margin: 0 }}>
          Generated by Rooted · This report documents home education activities for record-keeping purposes.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { effectiveUserId, isPartner } = usePartner();
  // Archived years become presets, so a year a family filed after the fact
  // ("Add a past year") is one tap away. Completed lessons are read with no
  // date filter, so those rows are already in the data; this only points the
  // range at them.
  const [archivedYears, setArchivedYears] = useState<{ id: string; name: string; start_date: string; end_date: string }[]>([]);
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    supabase
      .from("school_years")
      .select("id, name, start_date, end_date")
      .eq("user_id", effectiveUserId)
      .eq("status", "archived")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setArchivedYears((data ?? []) as { id: string; name: string; start_date: string; end_date: string }[]);
      });
    return () => { cancelled = true; };
  }, [effectiveUserId]);
  // "This Year" is the family's current school year, the same window the
  // Garden, Today and the yearbook read. Until it loads, the August 1 fallback.
  const [yearStart, setYearStart] = useState(fallbackYearStart);
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    getCurrentSchoolYear(supabase, effectiveUserId).then((schoolYear) => {
      if (cancelled) return;
      setYearStart(schoolYear.start);
      // Move the default range with it, unless the family has already picked one.
      setDateFrom((prev) => (prev === fallbackYearStart() ? schoolYear.start : prev));
    });
    return () => { cancelled = true; };
  }, [effectiveUserId]);
  const [children,   setChildren]   = useState<Child[]>([]);
  const [lessons,    setLessons]    = useState<Lesson[]>([]);
  const [books,      setBooks]      = useState<BookRecord[]>([]);
  const [activities, setActivities] = useState<MemoryActivity[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);
  const [activityDefs, setActivityDefs] = useState<ActivityDefinition[]>([]);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [appointments, setAppointments] = useState<ReportAppointment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [isPro,      setIsPro]      = useState<boolean | null>(null);

  const [selectedChild, setSelectedChild] = useState<string>("all");
  const [dateFrom,      setDateFrom]      = useState(fallbackYearStart);
  const [dateTo,        setDateTo]        = useState(toDateStr(new Date()));
  const [showPreview,   setShowPreview]   = useState(false);
  const [showExportGate, setShowExportGate] = useState(false);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);
  // Rendered verbatim on the print sheet. See lib/school-name.ts — no
  // " Academy" suffix is ever appended, same as printables.
  const [schoolName, setSchoolName] = useState("");
  // Simple is the default because it is what portfolio law actually asks for:
  // dates and titles. Detailed is for families who want the fuller record.
  const [printMode, setPrintMode] = useState<"simple" | "detailed">("simple");
  // On by default, which is what the report did before this choice existed.
  // Off only changes this document: photos stay in Memories, untouched.
  const [includePhotos, setIncludePhotos] = useState(true);
  const [breaks, setBreaks] = useState<ReportBreak[]>([]);

  // ── Book sheet ─────────────────────────────────────────────────────────────
  // One bottom sheet serves both variants. An in-progress book leads with
  // "Finished!"; a finished book shows its details as editable fields. Both
  // carry a quiet delete.
  const [sheetBook, setSheetBook] = useState<ReadingLogEntry | null>(null);
  const [sheetTitle, setSheetTitle] = useState("");
  const [sheetAuthor, setSheetAuthor] = useState("");
  const [sheetPages, setSheetPages] = useState("");
  const [sheetChildIds, setSheetChildIds] = useState<string[]>([]);
  const [sheetHow, setSheetHow] = useState<string | null>(null);
  const [sheetRating, setSheetRating] = useState<number | null>(null);
  const [sheetNotes, setSheetNotes] = useState("");
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetDeleting, setSheetDeleting] = useState(false);
  const [sheetDeleteConfirm, setSheetDeleteConfirm] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [bookToast, setBookToast] = useState<string | null>(null);

  function openBookSheet(entry: ReadingLogEntry) {
    setSheetBook(entry);
    setSheetTitle(entry.title ?? "");
    setSheetAuthor(entry.author ?? "");
    setSheetPages(entry.pages != null ? String(entry.pages) : "");
    setSheetChildIds(entry.book_child_ids ?? (entry.child_id ? [entry.child_id] : []));
    setSheetHow(entry.book_how);
    setSheetRating(entry.book_rating);
    setSheetNotes(entry.book_notes ?? "");
    setSheetDeleteConfirm(false);
    setSheetError(null);
  }

  function closeBookSheet() {
    setSheetBook(null);
    setSheetDeleteConfirm(false);
    setSheetError(null);
  }

  function showBookToast(message: string) {
    setBookToast(message);
    setTimeout(() => setBookToast(null), 2600);
  }

  /**
   * Everything the sheet writes goes through here. `extra` carries whatever
   * the specific action changes on top of the editable fields.
   *
   * A legacy app_events book has no memories row to update, so the sheet's
   * write actions are hidden for those; this is defensive.
   */
  async function writeBookSheet(extra: Record<string, unknown>, toast: string) {
    if (!sheetBook?.id) return;
    setSheetSaving(true);
    setSheetError(null);
    try {
      const ids = sheetChildIds.filter((id) => children.some((c) => c.id === id));
      const pagesTrimmed = sheetPages.trim();
      const pagesParsed = /^\d{1,6}$/.test(pagesTrimmed) ? Number.parseInt(pagesTrimmed, 10) : NaN;
      const pagesValue = Number.isFinite(pagesParsed) && pagesParsed > 0 ? pagesParsed : null;

      // The caption is rewritten in the legacy "Author: X | Pages: N" shape so
      // readers that predate the structured columns stay consistent with them.
      const captionParts: string[] = [];
      if (sheetAuthor.trim()) captionParts.push(`Author: ${sheetAuthor.trim()}`);
      if (pagesValue !== null) captionParts.push(`Pages: ${pagesValue}`);

      const { error } = await supabase
        .from("memories")
        .update({
          title: sheetTitle.trim() || null,
          caption: captionParts.length > 0 ? captionParts.join(" | ") : null,
          book_author: sheetAuthor.trim() || null,
          book_pages: pagesValue,
          book_child_ids: ids.length > 0 ? ids : null,
          child_id: ids.length === 1 ? ids[0] : null,
          book_how: sheetHow,
          book_rating: sheetRating,
          book_notes: sheetNotes.trim() || null,
          updated_at: new Date().toISOString(),
          ...extra,
        })
        .eq("id", sheetBook.id);
      if (error) throw error;

      closeBookSheet();
      showBookToast(toast);
      // Reload this page's data, and tell any other open surface a memory
      // changed. The Memories grid listens for this; Today re-reads on its own
      // next mount.
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("rooted:memory-saved", { detail: { type: "book" } }));
      }
    } catch (err) {
      console.error("[reading-log] book sheet save failed", err);
      setSheetError("That didn't save. Try again?");
    } finally {
      setSheetSaving(false);
    }
  }

  /** Finish an in-progress book: status flips and `date` becomes today. */
  async function finishBook() {
    if (!sheetBook) return;
    const title = sheetTitle.trim() || sheetBook.title || "your book";
    await writeBookSheet(
      { book_status: "finished", date: toDateStr(new Date()) },
      `🌿 Finished ${title}!`,
    );
    posthog.capture('book_finished', { user_plan: isPro ? 'paid' : 'free', has_rating: sheetRating !== null });
  }

  async function saveBookSheet() {
    await writeBookSheet({}, "🌿 Saved");
    posthog.capture('book_edited', { user_plan: isPro ? 'paid' : 'free' });
  }

  async function deleteBookSheet() {
    if (!sheetBook?.id) return;
    setSheetDeleting(true);
    setSheetError(null);
    try {
      const { error } = await supabase.from("memories").delete().eq("id", sheetBook.id);
      if (error) throw error;
      closeBookSheet();
      showBookToast("Book removed");
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("rooted:memory-saved", { detail: { type: "book" } }));
      }
      posthog.capture('book_deleted', { user_plan: isPro ? 'paid' : 'free' });
    } catch (err) {
      console.error("[reading-log] book delete failed", err);
      setSheetError("That didn't delete. Try again?");
    } finally {
      setSheetDeleting(false);
    }
  }

  useEffect(() => { document.title = "Hours & Attendance Log \u00b7 Rooted"; localStorage.setItem("rooted_visited_reports", "1"); posthog.capture('page_viewed', { page: 'reports' }); }, []);

  // Extracted from the mount effect into a callback so the book sheet can
  // re-run it after a finish, an edit or a delete. Every mutation there ends
  // with load(), which is what keeps the shelf, the list and the tiles honest
  // without a page reload.
  const load = useCallback(async () => {
    if (!effectiveUserId) return;
    {
      const { from: openFrom, to: openTo } = openLessonWindow();
      const [
        { data: kids },
        { data: doneLessons },
        { data: openLessons },
        { data: bookMemories },
        { data: bookEvts },
        { data: memActivities },
        { data: photoRows },
        { data: actLogRows },
        { data: actDefRows },
        { data: profile },
        { data: oneTimeAppts },
        { data: exceptionAppts },
        { data: breakRows },
      ] = await Promise.all([
        supabase.from("children").select("id, name").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        // PostgREST caps a response at 1,000 rows and says nothing about the
        // rest, so the old single unranged read lost every lesson past that
        // for the 45 families who have more. One of them saw zero hours and
        // zero courses for a child whose nine completed lessons were real.
        // See lib/supabase-all-rows.ts.
        //
        // Completed rows come back in full, whatever their date: they are the
        // hours and the attendance. Uncompleted rows are bounded to
        // openLessonWindow() and mirror this page's own `date ?? scheduled_date`
        // rule, so a row dated inside the window counts even when its
        // scheduled_date sits outside it.
        selectAllRowsResult<Lesson>((from, to) =>
          supabase.from("lessons").select(LESSON_COLUMNS)
            .eq("user_id", effectiveUserId).eq("completed", true)
            .order("id").range(from, to)),
        selectAllRowsResult<Lesson>((from, to) =>
          supabase.from("lessons").select(LESSON_COLUMNS)
            .eq("user_id", effectiveUserId).eq("completed", false)
            .or(`and(date.gte.${openFrom},date.lte.${openTo}),and(date.is.null,scheduled_date.gte.${openFrom},scheduled_date.lte.${openTo})`)
            .order("id").range(from, to)),
        // Books live in `memories` (type 'book') since March 2026. The legacy
        // app_events read below is kept so pre-March books still count.
        // id / caption / photo_url ride along for the Reading Log: a render
        // key, the "Author: X | Pages: N" caption it parses, and the cover.
        supabase.from("memories").select("id, child_id, type, title, caption, photo_url, date, book_child_ids, book_author, book_pages, book_cover_url, book_how, book_rating, book_notes, book_status, book_started_date").eq("user_id", effectiveUserId).eq("type", "book"),
        supabase.from("app_events").select("id, type, payload").eq("user_id", effectiveUserId).in("type", [...LEGACY_BOOK_EVENT_TYPES]),
        supabase.from("memories").select("child_id, type, date, duration_minutes").eq("user_id", effectiveUserId).not("duration_minutes", "is", null).in("type", ["field_trip", "project", "activity", "win"]),
        // The legal/portfolio report carries the family's actual visual
        // evidence, not only a count of it. Books are excluded because their
        // photo_url is a cover, not documentation of completed work.
        selectAllRowsResult<ReportPhoto>((from, to) =>
          supabase.from("memories")
            .select("id, child_id, type, title, caption, photo_url, date, lesson_id")
            .eq("user_id", effectiveUserId).not("photo_url", "is", null).neq("type", "book")
            .order("id").range(from, to)),
        // Completed recurring-activity sessions and their definitions. PAGED:
        // a PostgREST select caps at 1000 rows, and a family several years in
        // passes that, at which point the report would quietly under-report
        // rather than fail. Definitions are fetched WITHOUT an is_active filter
        // so a retired activity's historical sessions keep their name.
        selectAllRowsResult<ActivityLogRow>((from, to) =>
          supabase.from("activity_logs")
            .select("id, activity_id, date, minutes_spent, completed, notes")
            .eq("user_id", effectiveUserId).eq("completed", true)
            .order("date").range(from, to)),
        selectAllRowsResult<ActivityDefinition>((from, to) =>
          supabase.from("activities")
            .select("id, name, emoji, child_ids, is_active")
            .eq("user_id", effectiveUserId)
            .order("id").range(from, to)),
        supabase.from("profiles").select("is_pro, trial_started_at, display_name, last_name").eq("id", effectiveUserId).single(),
        // One-time completed appointments: completion lives on the base row.
        supabase
          .from("appointments")
          .select("id, title, emoji, date, duration_minutes, location, child_ids, is_school_activity")
          .eq("user_id", effectiveUserId)
          .eq("is_recurring", false)
          .eq("completed", true)
          .eq("is_school_activity", true),
        // Per-occurrence completions for recurring appointments live on
        // appointment_exceptions; join the parent for display fields.
        supabase
          .from("appointment_exceptions")
          .select("exception_date, appointments!inner(id, title, emoji, duration_minutes, location, child_ids, user_id, is_school_activity)")
          .eq("completed", true)
          .eq("appointments.user_id", effectiveUserId)
          .eq("appointments.is_school_activity", true),
        // Breaks from Plan, printed as Days Off (a sick day, a holiday).
        supabase.from("vacation_blocks").select("id, name, start_date, end_date").eq("user_id", effectiveUserId),
      ]);

      setChildren(capitalizeChildNames(kids ?? []));
      setLessons([...(doneLessons ?? []), ...(openLessons ?? [])]);
      setBooks(mergeBookRecords(bookMemories ?? [], (bookEvts as unknown as { id?: string; type: string; payload: { title?: string; caption?: string; photo_url?: string; child_id?: string; date?: string } | null }[]) ?? []));
      setActivities((memActivities as unknown as MemoryActivity[]) ?? []);
      setPhotos(photoRows ?? []);
      setActivityLogs(actLogRows ?? []);
      setActivityDefs(actDefRows ?? []);
      setBreaks((breakRows as ReportBreak[] | null) ?? []);

      type OneTimeRow = { id: string; title: string; emoji: string | null; date: string; duration_minutes: number | null; location: string | null; child_ids: string[] | null; is_school_activity: boolean };
      type ExceptionRow = {
        exception_date: string;
        appointments: {
          id: string;
          title: string;
          emoji: string | null;
          duration_minutes: number | null;
          location: string | null;
          child_ids: string[] | null;
          user_id: string;
          is_school_activity: boolean;
        } | null;
      };
      const merged: ReportAppointment[] = [
        ...((oneTimeAppts ?? []) as OneTimeRow[]).map((r) => ({
          id: r.id,
          title: r.title,
          emoji: r.emoji ?? "",
          date: r.date,
          duration_minutes: r.duration_minutes,
          location: r.location,
          child_ids: r.child_ids ?? [],
          is_school_activity: r.is_school_activity,
        })),
        ...(((exceptionAppts ?? []) as unknown as ExceptionRow[])
          .filter((r) => r.appointments !== null)
          .map((r) => {
            const a = r.appointments!;
            return {
              id: a.id,
              title: a.title,
              emoji: a.emoji ?? "",
              date: r.exception_date,
              duration_minutes: a.duration_minutes,
              location: a.location,
              child_ids: a.child_ids ?? [],
              is_school_activity: a.is_school_activity,
            };
          })),
      ];
      setAppointments(merged);

      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
      setTrialStartedAt((profile as { trial_started_at?: string | null } | null)?.trial_started_at ?? null);
      setSchoolName(schoolNameFor(
        (profile as { display_name?: string } | null)?.display_name || "",
        (profile as { last_name?: string } | null)?.last_name || "",
      ));
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => { load(); }, [load]);

  async function updateLessonRecord(lessonId: string, patch: ReportRecordPatch): Promise<boolean> {
    if (!effectiveUserId || isPartner) return false;
    const { data, error } = await supabase.rpc("update_report_lesson_record", {
      p_lesson_id: lessonId,
      p_date: patch.date,
      p_minutes_spent: patch.minutes,
      p_notes: patch.notes,
    });
    if (error || data !== true) {
      console.error("[hours-report] lesson record save failed", error);
      return false;
    }
    const goalId = lessons.find((row) => row.id === lessonId)?.curriculum_goal_id ?? null;
    setLessons((rows) => rows.map((row) => row.id === lessonId ? {
      ...row, date: patch.date, scheduled_date: patch.date,
      minutes_spent: patch.minutes, notes: patch.notes,
    } : row));
    // Moving a completion onto or off today changes how many lessons Today
    // counts as done today, which moves its projection. Re-date that
    // curriculum so Plan follows. The record edit itself already saved.
    await redateAfterRecordChange(goalId, "completion");
    return true;
  }

  async function deleteLessonRecord(lessonId: string): Promise<boolean> {
    if (!effectiveUserId || isPartner) return false;
    const goalId = lessons.find((row) => row.id === lessonId)?.curriculum_goal_id ?? null;
    const { data, error } = await supabase.rpc("delete_report_lesson_record", { p_lesson_id: lessonId });
    if (error || data !== true) {
      console.error("[hours-report] lesson record delete failed", error);
      return false;
    }
    // Removing a completion moves the pointer back (the RPC recomputes it and
    // compacts later queue slots): re-date that curriculum so Plan matches Today.
    await redateAfterRecordChange(goalId, "uncompletion");
    // Deleting a curriculum completion compacts every later visible Lesson N.
    // Reload rather than guessing those server-owned sequence changes locally.
    await load();
    return true;
  }

  async function redateAfterRecordChange(goalId: string | null, kind: "completion" | "uncompletion") {
    if (!goalId || !effectiveUserId) return;
    const res = await resyncGoalsForParent(supabase, effectiveUserId, [goalId], PARENT_RESPREAD_SOURCE[kind]);
    if (!res.ok) showBookToast(COMPLETION_RESPREAD_FAILED_NOTE);
  }

  async function updateActivityRecord(logId: string, patch: ReportRecordPatch): Promise<boolean> {
    if (!effectiveUserId || isPartner) return false;
    const { data, error } = await supabase.rpc("update_report_activity_record", {
      p_log_id: logId,
      p_date: patch.date,
      p_minutes_spent: patch.minutes,
      p_notes: patch.notes,
    });
    if (error || data !== true) {
      console.error("[hours-report] activity record save failed", error);
      return false;
    }
    setActivityLogs((rows) => rows.map((row) => row.id === logId ? {
      ...row, date: patch.date, minutes_spent: patch.minutes, notes: patch.notes,
    } : row));
    return true;
  }

  async function deleteActivityRecord(logId: string): Promise<boolean> {
    if (!effectiveUserId || isPartner) return false;
    const { data, error } = await supabase.rpc("delete_report_activity_record", { p_log_id: logId });
    if (error || data !== true) {
      console.error("[hours-report] activity record delete failed", error);
      return false;
    }
    setActivityLogs((rows) => rows.filter((row) => row.id !== logId));
    return true;
  }

  const activeChild = selectedChild === "all" ? null : (children.find((c) => c.id === selectedChild) ?? null);

  // Quick stats for the controls card
  const filteredLessons  = lessons.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    return d && d >= dateFrom && d <= dateTo && (selectedChild === "all" || l.child_id === selectedChild);
  });
  const completedFiltered   = filteredLessons.filter((l) => l.completed);
  const completedCount      = completedFiltered.length;
  const lessonHoursQuick    = completedFiltered.reduce((s, l) => s + ((l.minutes_spent ?? 30) / 60), 0);
  const activityHoursQuick  = activities.filter((a) => {
    if (selectedChild !== "all" && a.child_id !== selectedChild) return false;
    return a.date >= dateFrom && a.date <= dateTo;
  }).reduce((s, a) => s + ((a.duration_minutes ?? 0) / 60), 0);
  // The panel above the Preview button must agree with the document below it.
  // Adding activity sessions to the report alone left this tile reading 106.3h
  // while the report it generates read 125.8h -- the same page contradicting
  // itself, which is how a family stops trusting either number. Same helper,
  // same filters.
  const activitySessionHoursQuick = summarizeActivitySessions(
    selectActivitySessions(activityLogs, activityDefs, {
      childId: selectedChild === "all" ? null : selectedChild,
      dateFrom, dateTo,
    }),
  ).hours;
  const totalHours          = lessonHoursQuick + activityHoursQuick + activitySessionHoursQuick;
  const subjectsCount       = new Set(
    completedFiltered.map((l) => l.curriculum_goal_id).filter((id): id is string => id !== null)
  ).size;
  const filteredBooksCount  = books.filter((b) => {
    if (!isFinishedBook(b)) return false;
    const d = b.date ?? "";
    if (!d || d < dateFrom || d > dateTo) return false;
    return bookBelongsToChild(b, selectedChild);
  }).length;

  // ── Reading log (shares the child + date range chosen above) ───────────────
  const readingLog = buildReadingLog(books, selectedChild, dateFrom, dateTo);
  const readingLogPages = readingLog.reduce((sum, e) => sum + (e.pages ?? 0), 0);
  // Pages always renders, even at zero. A blank where a number should be reads
  // as broken; a 0 with a line explaining how to fill it reads as an invitation.
  const readingLogHasPages = readingLog.some((e) => e.pages !== null);
  const readingLogChildName = activeChild ? activeChild.name : "All Children";

  // ── Currently reading shelf ────────────────────────────────────────────────
  // Scoped by CHILD only, deliberately not by the date range. "What we are
  // reading" is a present-tense fact; a book started in June should not vanish
  // from the shelf because the report is set to August. Newest start first.
  const readingShelf = books
    .filter((b) => isReadingBook(b) && bookBelongsToChild(b, selectedChild))
    .map((b) => {
      const parsed = parseBookCaption(b.caption);
      const author = b.book_author ?? parsed.author;
      return { ...b, author, pages: b.book_pages ?? parsed.pages, freeText: author ? null : parsed.freeText };
    })
    .sort((a, b) => (b.book_started_date ?? b.date ?? "").localeCompare(a.book_started_date ?? a.date ?? ""));

  /** Names of the children a book is attributed to, for the shelf line. */
  function attributionLabel(b: BookRecord): string {
    if (b.book_child_ids && b.book_child_ids.length > 0) {
      const names = b.book_child_ids
        .map((id) => children.find((c) => c.id === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length > 0) return names.join(" & ");
    }
    if (b.child_id) return children.find((c) => c.id === b.child_id)?.name ?? "";
    return "Whole family";
  }

  const readingLogTiles: { label: string; value: string | number }[] = [
    { label: "Books", value: readingLog.length },
    { label: "Pages", value: readingLogPages.toLocaleString() },
  ];

  /**
   * Print only the Hours & Attendance document.
   *
   * The former button toggled React state and guessed that 300ms was enough
   * before calling print. Leslie's desktop opened an eleven-page job with no
   * ink. This path waits for the report DOM, fonts, and already-selected photo
   * evidence, then gives this document its own print mode. Conflicting Rooted
   * print modes are removed first so a stale yearbook or Plan class cannot
   * hide this report.
   */
  async function printHoursReport() {
    if (!canExport({ is_pro: isPro, trial_started_at: trialStartedAt })) {
      setShowExportGate(true);
      return;
    }
    setPreparingPrint(true);
    setPrintError(null);
    posthog.capture("plan_pdf_downloaded", { user_plan: isPro ? "paid" : "free" });
    setShowPreview(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const report = document.querySelector<HTMLElement>(".hours-report-print-sheet");
      if (!report) throw new Error("Hours report did not render");

      if (document.fonts?.ready) await document.fonts.ready;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const frames = [...report.querySelectorAll<HTMLElement>("[data-report-photo]")];
        const ready = frames.every((frame) => {
          const image = frame.querySelector<HTMLImageElement>("img");
          return !!image && image.complete;
        });
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const body = document.body;
      for (const cls of [
        "print-mode-yearbook", "print-mode-reading-log", "print-mode-daily",
        "print-mode-weekly", "print-mode-monthly",
      ]) body.classList.remove(cls);
      body.classList.add("print-mode-hours-report");
      const cleanup = () => {
        body.classList.remove("print-mode-hours-report");
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      setPreparingPrint(false);
      window.print();
      // Some Safari versions omit afterprint. Screen layout is unaffected by
      // this class, but clear it eventually so a later Cmd+P cannot inherit it.
      setTimeout(cleanup, 60_000);
    } catch (err) {
      console.error("[hours-report] print preparation failed", err);
      setPreparingPrint(false);
      setPrintError("The report could not open. Please try again.");
    }
  }

  /**
   * Print only the reading-log sheet. The page's other cards stay on screen
   * but out of the print job — a portfolio document should not arrive with a
   * date picker printed on it.
   */
  function printReadingLog() {
    if (!canExport({ is_pro: isPro, trial_started_at: trialStartedAt })) {
      setShowExportGate(true);
      return;
    }
    posthog.capture('reading_log_printed', { user_plan: isPro ? 'paid' : 'free', mode: printMode });
    const body = document.body;
    body.classList.add("print-mode-reading-log");
    const cleanup = () => {
      body.classList.remove("print-mode-reading-log");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => {
      window.print();
      // Safari fires afterprint unreliably; this is the belt to its braces so
      // the page can never be left stuck in print mode.
      setTimeout(cleanup, 1000);
    }, 100);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="text-2xl animate-pulse">📋</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl px-4 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          For Your Family Records
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Hours &amp; Attendance Log 📋</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Hours logged · Subjects covered · Days completed
        </p>
      </div>

      {/* Report config card */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold text-[#2d2926] text-sm">Configure Report</h2>

        {/* Child selector */}
        <div>
          <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedChild("all")}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedChild === "all"
                  ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                  : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
              }`}
            >
              All Children
            </button>
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedChild(c.id)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedChild === c.id
                    ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                    : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
            />
          </div>
        </div>

        {/* Quick preset buttons */}
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "this-year", label: "This Year",  from: yearStart,                                 to: toDateStr(new Date()) },
            { key: "this-month", label: "This Month", from: toDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: toDateStr(new Date()) },
            { key: "last-30", label: "Last 30 days", from: toDateStr(new Date(Date.now() - 30 * 86400000)), to: toDateStr(new Date()) },
            // Keyed by id: two filed years may share a name.
            ...archivedYears.map((y) => ({ key: `year:${y.id}`, label: y.name, from: y.start_date, to: y.end_date })),
          ].map((p) => (
            <button
              key={p.key}
              onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
              className="text-xs px-3 py-1.5 bg-[#f0ede8] text-[#7a6f65] rounded-lg hover:bg-[#e8e2d9] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-[#dfe9e1] bg-[#f4f8f4] px-3.5 py-3">
          <p className="text-xs font-semibold text-[#2D5A3D]">Complete documentation is included</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#6b756d]">
            {includePhotos
              ? "Your report includes each completed lesson, saved lesson and activity details, and dated photos with their captions."
              : "Your report includes each completed lesson and saved lesson and activity details. Photos are left out of this report and stay safe in Memories."}
          </p>
          <label className="mt-2.5 flex items-center gap-2 text-sm text-[#2d2926]">
            <input
              type="checkbox"
              checked={includePhotos}
              onChange={(e) => setIncludePhotos(e.target.checked)}
              className="h-4 w-4 accent-[#5c7f63]"
            />
            Include photos
          </label>
        </div>

        {/* Quick stats preview */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {[
            { label: "Lessons",  value: completedCount },
            { label: "Hours",    value: `${totalHours.toFixed(1)}h` },
            { label: "Books",    value: filteredBooksCount },
            { label: "Subjects", value: subjectsCount },
          ].map(({ label, value }) => (
            <div key={label} className="text-center bg-[#f8f5f0] rounded-xl py-2.5">
              <p className="text-lg font-bold text-[#2d2926]">{value}</p>
              <p className="text-[10px] text-[#7a6f65]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex-1 flex items-center justify-center gap-2 bg-[#fefcf9] border border-[#e8e2d9] hover:border-[#5c7f63] text-[#2d2926] text-sm font-medium py-3 rounded-xl transition-colors"
        >
          <FileText size={16} className="text-[#5c7f63]" />
          {showPreview ? "Hide Preview" : "Preview Log"}
        </button>
        <button
          onClick={printHoursReport}
          disabled={preparingPrint}
          className="flex-1 flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white text-sm font-medium py-3 rounded-xl transition-colors"
        >
          <Printer size={16} />
          {preparingPrint ? "Preparing report..." : "Print / Save PDF"}
        </button>
      </div>
      {printError && <p className="text-sm text-red-600">{printError}</p>}

      {/* Report preview */}
      {showPreview && (
        <PrintReport
          child={activeChild}
          allChildren={children}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lessons={lessons}
          books={books}
          activities={activities}
          activityLogs={activityLogs}
          activityDefs={activityDefs}
          photos={photos}
          includePhotos={includePhotos}
          breaks={breaks}
          appointments={appointments}
          canEdit={!isPartner}
          onUpdateLesson={updateLessonRecord}
          onDeleteLesson={deleteLessonRecord}
          onUpdateActivity={updateActivityRecord}
          onDeleteActivity={deleteActivityRecord}
        />
      )}

      {/* ── Reading Log ──────────────────────────────────────────
          Shares the child + date range chosen in the report card above
          rather than duplicating the pickers. In Pennsylvania a printed
          list of reading materials is a required portfolio document, so
          the print sheet is the point of this card. */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-2">
          <BookOpen size={16} className="text-[#7a4a8a] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-semibold text-[#2d2926] text-sm">Reading Log</h2>
            <p className="text-xs text-[#7a6f65] mt-0.5">
              {readingLogChildName} · {formatLogDate(dateFrom)} – {formatLogDate(dateTo)}
            </p>
          </div>
        </div>

        {/* ── Currently reading ────────────────────────────────
            Deliberately spare: cover, title, who. No duration, no "started
            N days ago", nothing that could read as a nag. A book may sit
            here indefinitely and the app will never mention it. */}
        {readingShelf.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2">
              Currently reading
            </p>
            <div className="flex flex-col gap-1.5">
              {readingShelf.map((b, i) => {
                const cover = bookCover(b);
                return (
                  <button
                    key={b.id ?? `reading-${i}`}
                    type="button"
                    onClick={() => openBookSheet(b)}
                    className="flex items-center gap-3 bg-white border border-[#e8e2d9] rounded-xl px-3 py-2 text-left hover:border-[#5c7f63] transition-colors"
                  >
                    {cover?.kind === "photo" ? (
                      <SignedImage src={cover.src} bucket="memory-photos" alt=""
                        className="w-7 h-10 rounded object-cover shrink-0 bg-[#f0ede8]" />
                    ) : cover?.kind === "external" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.src} alt="" loading="lazy"
                        className="w-7 h-10 rounded object-cover shrink-0 bg-[#f0ede8]" />
                    ) : (
                      <div className="w-7 h-10 rounded shrink-0 bg-[#f3ece6] flex items-center justify-center text-xs" aria-hidden>📖</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#2d2926] truncate">{b.title ?? "Untitled"}</p>
                      <p className="text-[11px] text-[#7a6f65] truncate">{attributionLabel(b)}</p>
                    </div>
                    <span className="text-[#c8bfb5] text-xs shrink-0" aria-hidden>›</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {readingLog.length === 0 ? (
          /* Most families have not logged a book yet. Say what to do, warmly,
             instead of leaving a blank card that looks broken. */
          <div className="bg-white border border-[#e8e2d9] rounded-xl px-4 py-6 text-center">
            <span className="text-2xl" aria-hidden>📖</span>
            <p className="text-sm font-medium text-[#2d2926] mt-2">No books in this date range yet</p>
            <p className="text-xs text-[#7a6f65] mt-1 leading-relaxed max-w-[320px] mx-auto">
              Books you log from the Today screen show up here, ready to print for your records.
            </p>
            <p className="text-xs text-[#7a6f65] mt-2">
              Tap the capture button on Today, then choose <span className="font-medium text-[#2d2926]">Book</span>.
            </p>
          </div>
        ) : (
          <>
            {/* Summary tiles */}
            <div>
              <div className="grid gap-2 grid-cols-2">
                {readingLogTiles.map(({ label, value }) => (
                  <div key={label} className="text-center bg-[#f8f5f0] rounded-xl py-2.5">
                    <p className="text-lg font-bold text-[#2d2926]">{value}</p>
                    <p className="text-[10px] text-[#7a6f65]">{label}</p>
                  </div>
                ))}
              </div>
              {!readingLogHasPages && (
                <p className="text-[11px] text-[#b5aca4] mt-1.5 text-center">
                  Add page counts when you log a book and they&apos;ll total here.
                </p>
              )}
            </div>

            {/* Chronological list, newest first */}
            <div className="divide-y divide-[#f0ede8] border-t border-[#f0ede8]">
              {readingLog.map((e, i) => {
                // photo_url (the family's own photo) beats the Open Library
                // cover beats the placeholder. The two live in different
                // worlds — a storage path needing a signed URL versus an
                // absolute https URL — so they cannot share one <img>.
                const cover = bookCover(e);
                const howLabel = bookHowLabel(e.book_how);
                const rating = ratingLeaves(e.book_rating);
                const notes = (e.book_notes ?? "").trim();
                return (
                <button
                  key={e.id ?? `book-${i}`}
                  type="button"
                  onClick={() => openBookSheet(e)}
                  className="w-full flex items-start gap-3 py-2.5 text-left hover:bg-[#faf8f5] transition-colors"
                >
                  {cover?.kind === "photo" ? (
                    <SignedImage
                      src={cover.src}
                      bucket="memory-photos"
                      alt=""
                      className="w-9 h-12 rounded-md object-cover shrink-0 bg-[#f0ede8]"
                    />
                  ) : cover?.kind === "external" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover.src}
                      alt=""
                      loading="lazy"
                      className="w-9 h-12 rounded-md object-cover shrink-0 bg-[#f0ede8]"
                    />
                  ) : (
                    <div className="w-9 h-12 rounded-md shrink-0 bg-[#f3ece6] flex items-center justify-center text-base" aria-hidden>
                      📖
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm text-[#2d2926] truncate">{e.title ?? "Untitled"}</p>
                      {rating && (
                        <span
                          className="text-[11px] shrink-0 leading-none"
                          title={`${e.book_rating} out of 5`}
                          aria-label={`Rated ${e.book_rating} out of 5`}
                        >
                          {rating}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#7a6f65] truncate">
                      {[e.author ?? e.freeText, formatLogDate(e.date)].filter(Boolean).join(" · ")}
                    </p>
                    {howLabel && (
                      <span className="inline-block text-[10px] text-[#8a8078] bg-[#f4f1ec] rounded px-1.5 py-0.5 mt-1">
                        {howLabel}
                      </span>
                    )}
                    {notes && (
                      <p className="text-xs text-[#8a8078] italic mt-1 leading-snug">{notes}</p>
                    )}
                  </div>
                  {e.pages !== null && (
                    <span className="text-xs text-[#7a6f65] shrink-0 tabular-nums self-start mt-0.5">{e.pages} pp</span>
                  )}
                </button>
                );
              })}
            </div>

            {/* Print detail. Simple is the default: date and title is what a
                portfolio reviewer asks for, and anything extra is something
                they have to read past. */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#7a6f65]">Print detail</span>
                <div className="flex rounded-lg border border-[#e8e2d9] overflow-hidden">
                  {([
                    ["simple",   "Simple"],
                    ["detailed", "Detailed"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPrintMode(value)}
                      aria-pressed={printMode === value}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        printMode === value
                          ? "bg-[#5c7f63] text-white"
                          : "bg-white text-[#7a6f65] hover:bg-[#f4f1ec]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-[#b5aca4] mt-1.5">
                {printMode === "simple"
                  ? "Dates and titles only."
                  : "Adds author, pages, how it was read, rating and notes."}
              </p>
            </div>

            <button
              onClick={printReadingLog}
              className="w-full flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-medium py-3 rounded-xl transition-colors"
            >
              <Printer size={16} />
              Print Reading Log
            </button>
          </>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-[#f5ede0] border border-[#c4956a]/30 rounded-2xl p-4">
        <p className="text-xs font-semibold text-[#8b6f47] mb-1">📌 Know Your State</p>
        <p className="text-xs text-[#7a6f65] leading-relaxed">
          This report documents your home education activities. Check the Resources tab for your
          state&apos;s homeschool information, some states request annual portfolios, others may ask for
          standardized test results. Keep copies of this report for your family records.
        </p>
      </div>

      <div className="h-4" />

      {showExportGate && (
        <ExportGateModal
          title="Save your progress"
          body="Download a polished summary of your homeschool plan and progress. Progress reports are part of Rooted+."
          cta="Upgrade to download"
          onClose={() => setShowExportGate(false)}
        />
      )}

      {/* ── Book sheet ───────────────────────────────────────────
          One sheet, two shapes. In progress leads with Finished!; finished
          shows editable details. Delete is present on both, quietly, with
          neutral copy — removing a book is a normal thing to do, not a
          failure. */}
      {sheetBook && (() => {
        const inProgress = isReadingBook(sheetBook);
        const canWrite = !!sheetBook.id;
        return (
          <>
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={closeBookSheet} />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto max-h-[88vh] flex flex-col"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              <div className="flex justify-center pt-3 pb-2 shrink-0"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
              <div className="px-5 pb-5 space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-[#2d2926]">
                    {inProgress ? "📖 Still reading" : "📖 Book details"}
                  </h2>
                  <button onClick={closeBookSheet} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
                </div>

                {!canWrite && (
                  <p className="text-xs text-[#8a8078] bg-[#f4f1ec] rounded-lg px-3 py-2">
                    This one was logged in an older version of Rooted, so it can be viewed but not edited here.
                  </p>
                )}

                {/* Title */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Title</label>
                  <input value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} disabled={!canWrite}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] disabled:opacity-60" />
                </div>

                {/* Author + pages */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Author</label>
                    <input value={sheetAuthor} onChange={(e) => setSheetAuthor(e.target.value)} disabled={!canWrite}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Pages</label>
                    <input value={sheetPages} onChange={(e) => setSheetPages(e.target.value)} type="number" min="1" disabled={!canWrite}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] disabled:opacity-60" />
                  </div>
                </div>

                {/* Who read it */}
                {children.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who read it?</label>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" disabled={!canWrite} onClick={() => setSheetChildIds([])}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${
                          sheetChildIds.length === 0 ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"
                        }`}>
                        Whole family
                      </button>
                      {children.map((c) => {
                        const on = sheetChildIds.includes(c.id);
                        return (
                          <button key={c.id} type="button" disabled={!canWrite}
                            onClick={() => setSheetChildIds((prev) =>
                              prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id])}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${on ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}>
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* How */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">How was it read?</label>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(BOOK_HOW_LABELS).map(([value, label]) => (
                      <button key={value} type="button" disabled={!canWrite}
                        onClick={() => setSheetHow((prev) => (prev === value ? null : value))}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${
                          sheetHow === value ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rating.
                    Each leaf is a 44x44 tap target — the glyph is small, the
                    button is not. It was previously 26x20 with a 4px gap,
                    about a third of the 44px minimum every touch guideline
                    asks for, which on a phone means a missed tap lands in the
                    gap and looks exactly like a dead control. The opacity and
                    grayscale live on the glyph rather than the button so the
                    hit area is never what is being dimmed. */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Their rating</label>
                  <div className="flex items-center -ml-2">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const lit = sheetRating !== null && n <= sheetRating;
                      return (
                        <button key={n} type="button" disabled={!canWrite}
                          onClick={() => setSheetRating((prev) => (prev === n ? null : n))}
                          aria-label={`${n} out of 5`}
                          aria-pressed={lit}
                          className="w-11 h-11 flex items-center justify-center text-xl leading-none transition-transform active:scale-90 disabled:opacity-60">
                          <span style={{ opacity: lit ? 1 : 0.25, filter: lit ? "none" : "grayscale(1)" }}>🌿</span>
                        </button>
                      );
                    })}
                    {sheetRating !== null && canWrite && (
                      <button type="button" onClick={() => setSheetRating(null)}
                        className="text-[11px] text-[#b5aca4] hover:text-[#7a6f65] ml-1.5 px-2 py-2 transition-colors">Clear</button>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Notes</label>
                  <textarea value={sheetNotes} onChange={(e) => setSheetNotes(e.target.value)} rows={2} disabled={!canWrite}
                    placeholder="Favorite characters, what they thought..."
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] resize-none disabled:opacity-60" />
                </div>

                {sheetError && <p className="text-xs text-red-400">{sheetError}</p>}

                {canWrite && (
                  <button
                    onClick={inProgress ? finishBook : saveBookSheet}
                    disabled={sheetSaving || sheetDeleting}
                    className="w-full py-3.5 rounded-xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-semibold transition-colors"
                  >
                    {sheetSaving ? "Saving…" : inProgress ? "Finished! 🌿" : "Save changes"}
                  </button>
                )}

                {canWrite && (!sheetDeleteConfirm ? (
                  <button type="button" onClick={() => setSheetDeleteConfirm(true)}
                    className="w-full text-center text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors py-1">
                    Delete book
                  </button>
                ) : (
                  <div className="bg-[#faf8f4] border border-[#e8e2d9] rounded-xl p-3 space-y-2">
                    <p className="text-sm text-[#2d2926] text-center">Remove this book from your log?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setSheetDeleteConfirm(false)} disabled={sheetDeleting}
                        className="flex-1 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                        Keep it
                      </button>
                      <button onClick={deleteBookSheet} disabled={sheetDeleting}
                        className="flex-1 py-2 rounded-xl bg-[#7a6f65] hover:bg-[#5c5248] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                        {sheetDeleting ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {bookToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg">
            {bookToast}
          </div>
        </div>
      )}

      {/* ── Reading Log print host ───────────────────────────────
          Off-screen until its own print job. Same isolation pattern the Plan
          print sheets use in globals.css, scoped to this page so printing the
          reading log cannot pull the config card or the Hours report along
          with it. */}
      <style>{`
        .reading-log-print-host { display: none; }
        @media print {
          body.print-mode-hours-report { background: #ffffff !important; }
          body.print-mode-hours-report * { visibility: hidden !important; }
          body.print-mode-hours-report .hours-report-print-sheet,
          body.print-mode-hours-report .hours-report-print-sheet * { visibility: visible !important; }
          body.print-mode-hours-report .hours-report-print-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          body.print-mode-hours-report [data-report-photo] {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          body.print-mode-reading-log { background: #ffffff !important; }
          body.print-mode-reading-log .reading-log-print-host { display: block; }
          body.print-mode-reading-log * { visibility: hidden !important; }
          body.print-mode-reading-log .reading-log-print-sheet,
          body.print-mode-reading-log .reading-log-print-sheet * { visibility: visible !important; }
          body.print-mode-reading-log .reading-log-print-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          body.print-mode-reading-log .reading-log-print-sheet table { page-break-inside: auto; }
          body.print-mode-reading-log .reading-log-print-sheet thead { display: table-header-group; }
        }
      `}</style>
      <div className="reading-log-print-host" aria-hidden>
        <ReadingLogPrintSheet
          entries={readingLog}
          inProgress={readingShelf}
          schoolName={schoolName}
          childName={readingLogChildName}
          dateFrom={dateFrom}
          dateTo={dateTo}
          mode={printMode}
        />
      </div>
    </div>
  );
}
