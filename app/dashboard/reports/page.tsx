"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Printer, Calendar, Clock, BookOpen, CheckSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { canExport } from "@/lib/user-access";
import { schoolNameFor } from "@/lib/school-name";
import { mergeBookRecords, bookBelongsToChild, bookCover, bookHowLabel, ratingLeaves, LEGACY_BOOK_EVENT_TYPES, type MemoryRecord } from "@/lib/memory-leaves";
import SignedImage from "@/components/SignedImage";
import ExportGateModal from "@/app/components/ExportGateModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child    = { id: string; name: string };
type Lesson   = {
  id: string; child_id: string;
  curriculum_goal_id: string | null;
  curriculum_goals: { subject_label: string | null } | null;
  title: string; date: string | null; scheduled_date: string | null;
  completed: boolean; completed_at: string | null;
  minutes_spent: number | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function schoolYearStart() {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
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
  child, children: allKids, dateFrom, dateTo, lessons, books, activities, appointments,
}: {
  child: Child | null;
  children: Child[];
  dateFrom: string; dateTo: string;
  lessons: Lesson[];
  books: BookRecord[];
  activities: MemoryActivity[];
  appointments: ReportAppointment[];
}) {
  const filteredLessons = lessons.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    if (!d) return false;
    if (child && l.child_id !== child.id) return false;
    return d >= dateFrom && d <= dateTo;
  });
  // Same attribution rule as the Reading Log — see bookBelongsToChild.
  const filteredBooks = books.filter((b) => {
    if (!bookBelongsToChild(b, child ? child.id : null)) return false;
    const d = b.date ?? "";
    return d >= dateFrom && d <= dateTo;
  });

  const completedLessons = filteredLessons.filter((l) => l.completed);
  const filteredActivities = activities.filter((a) => {
    if (child && a.child_id !== child.id) return false;
    return a.date >= dateFrom && a.date <= dateTo && a.duration_minutes;
  });
  const lessonHours = completedLessons.reduce((sum, l) => sum + ((l.minutes_spent ?? 30) / 60), 0);
  const activityHours = filteredActivities.reduce((sum, a) => sum + ((a.duration_minutes ?? 0) / 60), 0);
  const totalHours = lessonHours + activityHours;

  const subjectMap: Record<string, { name: string; color: string | null; count: number; hours: number }> = {};
  completedLessons.forEach((l) => {
    const key = l.curriculum_goal_id ?? "uncat";
    const name = l.curriculum_goals?.subject_label ?? "Unassigned";
    if (!subjectMap[key]) {
      subjectMap[key] = { name, color: null, count: 0, hours: 0 };
    }
    subjectMap[key].count++;
    subjectMap[key].hours += (l.minutes_spent ?? 30) / 60;
  });

  // For a single-child report, whole-family appointments (empty child_ids)
  // are counted toward that child; appointments explicitly tagged to other
  // kids are excluded. "All Children" includes everything.
  const filteredAppointments: ReportAppointment[] = appointments.filter((a) => {
    if (child && a.child_ids.length > 0 && !a.child_ids.includes(child.id)) return false;
    return a.date >= dateFrom && a.date <= dateTo;
  });

  // Days Present unions completed-lesson dates with completed-appointment
  // dates so co-op or activity days without a curriculum lesson still count.
  // Dates appearing in both contribute once (Set dedupes).
  const presentDates = new Set<string>();
  for (const l of completedLessons) {
    if (l.completed_at) presentDates.add(l.completed_at.slice(0, 10));
  }
  for (const a of filteredAppointments) {
    presentDates.add(a.date);
  }

  const fromLabel = new Date(dateFrom + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const toLabel   = new Date(dateTo   + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="print-content bg-white p-6 rounded-2xl border border-[#e8e2d9] space-y-6">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: CheckSquare, label: "Lessons Completed", value: completedLessons.length, color: "#5c7f63" },
          { icon: Clock,       label: "Hours Logged",      value: `${totalHours.toFixed(1)}h`, color: "#8b6f47" },
          { icon: Calendar,    label: "Days Present",      value: presentDates.size, color: "#4a7a8a" },
          { icon: BookOpen,    label: "Books Read",        value: filteredBooks.length, color: "#7a4a8a" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="rounded-xl border border-[#e8e2d9] p-3 text-center">
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

      {/* Activities and appointments */}
      {filteredAppointments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
            Activities and Appointments
          </h3>
          <div className="space-y-2">
            {filteredAppointments
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((a) => {
                const dateLabel = new Date(a.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const dur = a.duration_minutes;
                const durLabel = dur && dur > 0
                  ? (dur >= 60 ? `${(dur / 60).toFixed(1)}h` : `${dur}m`)
                  : null;
                const kidLabel = a.child_ids.length === 0
                  ? "All children"
                  : a.child_ids
                      .map((id) => allKids.find((c) => c.id === id)?.name)
                      .filter((n): n is string => !!n)
                      .join(", ");
                return (
                  <div key={`${a.id}-${a.date}`} className="flex items-center gap-3">
                    <span aria-hidden className="shrink-0">{a.emoji || "📍"}</span>
                    <span className="text-sm text-[#2d2926] flex-1 min-w-0 truncate">{a.title}</span>
                    <span className="text-xs text-[#7a6f65] shrink-0">{dateLabel}</span>
                    {durLabel ? (
                      <span className="text-xs text-[#b5aca4] shrink-0">{durLabel}</span>
                    ) : null}
                    {kidLabel ? (
                      <span className="text-xs text-[#b5aca4] shrink-0">{kidLabel}</span>
                    ) : null}
                  </div>
                );
              })}
          </div>
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
  entries, schoolName, childName, dateFrom, dateTo, mode,
}: {
  entries: ReadingLogEntry[];
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
  const { effectiveUserId } = usePartner();
  const [children,   setChildren]   = useState<Child[]>([]);
  const [lessons,    setLessons]    = useState<Lesson[]>([]);
  const [books,      setBooks]      = useState<BookRecord[]>([]);
  const [activities, setActivities] = useState<MemoryActivity[]>([]);
  const [appointments, setAppointments] = useState<ReportAppointment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [isPro,      setIsPro]      = useState<boolean | null>(null);

  const [selectedChild, setSelectedChild] = useState<string>("all");
  const [dateFrom,      setDateFrom]      = useState(schoolYearStart());
  const [dateTo,        setDateTo]        = useState(toDateStr(new Date()));
  const [showPreview,   setShowPreview]   = useState(false);
  const [showExportGate, setShowExportGate] = useState(false);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);
  // Rendered verbatim on the print sheet. See lib/school-name.ts — no
  // " Academy" suffix is ever appended, same as printables.
  const [schoolName, setSchoolName] = useState("");
  // Simple is the default because it is what portfolio law actually asks for:
  // dates and titles. Detailed is for families who want the fuller record.
  const [printMode, setPrintMode] = useState<"simple" | "detailed">("simple");

  useEffect(() => { document.title = "Hours & Attendance Log \u00b7 Rooted"; localStorage.setItem("rooted_visited_reports", "1"); posthog.capture('page_viewed', { page: 'reports' }); }, []);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const [
        { data: kids },
        { data: lessons_ },
        { data: bookMemories },
        { data: bookEvts },
        { data: memActivities },
        { data: profile },
        { data: oneTimeAppts },
        { data: exceptionAppts },
      ] = await Promise.all([
        supabase.from("children").select("id, name").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("lessons").select("id, child_id, curriculum_goal_id, curriculum_goals(subject_label), title, date, scheduled_date, completed, completed_at, minutes_spent").eq("user_id", effectiveUserId),
        // Books live in `memories` (type 'book') since March 2026. The legacy
        // app_events read below is kept so pre-March books still count.
        // id / caption / photo_url ride along for the Reading Log: a render
        // key, the "Author: X | Pages: N" caption it parses, and the cover.
        supabase.from("memories").select("id, child_id, type, title, caption, photo_url, date, book_child_ids, book_author, book_pages, book_cover_url, book_how, book_rating, book_notes").eq("user_id", effectiveUserId).eq("type", "book"),
        supabase.from("app_events").select("id, type, payload").eq("user_id", effectiveUserId).in("type", [...LEGACY_BOOK_EVENT_TYPES]),
        supabase.from("memories").select("child_id, type, date, duration_minutes").eq("user_id", effectiveUserId).not("duration_minutes", "is", null).in("type", ["field_trip", "project", "activity", "win"]),
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
      ]);

      setChildren(capitalizeChildNames(kids ?? []));
      setLessons((lessons_ as unknown as Lesson[]) ?? []);
      setBooks(mergeBookRecords(bookMemories ?? [], (bookEvts as unknown as { id?: string; type: string; payload: { title?: string; caption?: string; photo_url?: string; child_id?: string; date?: string } | null }[]) ?? []));
      setActivities((memActivities as unknown as MemoryActivity[]) ?? []);

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
      setTrialStartedAt((profile as any)?.trial_started_at ?? null);
      setSchoolName(schoolNameFor(
        (profile as { display_name?: string } | null)?.display_name || "",
        (profile as { last_name?: string } | null)?.last_name || "",
      ));
      setLoading(false);
    }
    load();
  }, [effectiveUserId]);

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
  const totalHours          = lessonHoursQuick + activityHoursQuick;
  const subjectsCount       = new Set(
    completedFiltered.map((l) => l.curriculum_goal_id).filter((id): id is string => id !== null)
  ).size;
  const filteredBooksCount  = books.filter((b) => {
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

  const readingLogTiles: { label: string; value: string | number }[] = [
    { label: "Books", value: readingLog.length },
    { label: "Pages", value: readingLogPages.toLocaleString() },
  ];

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
            { label: "This Year",  from: schoolYearStart(),                         to: toDateStr(new Date()) },
            { label: "This Month", from: toDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: toDateStr(new Date()) },
            { label: "Last 30 days", from: toDateStr(new Date(Date.now() - 30 * 86400000)), to: toDateStr(new Date()) },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
              className="text-xs px-3 py-1.5 bg-[#f0ede8] text-[#7a6f65] rounded-lg hover:bg-[#e8e2d9] transition-colors"
            >
              {p.label}
            </button>
          ))}
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
          onClick={() => {
            if (!canExport({ is_pro: isPro, trial_started_at: trialStartedAt })) { setShowExportGate(true); return; }
            posthog.capture('plan_pdf_downloaded', { user_plan: isPro ? 'paid' : 'free' }); setShowPreview(true); setTimeout(() => window.print(), 300);
          }}
          className="flex-1 flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-medium py-3 rounded-xl transition-colors"
        >
          <Printer size={16} />
          Print / Save PDF
        </button>
      </div>

      {/* Report preview */}
      {showPreview && (
        <PrintReport
          child={activeChild}
          children={children}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lessons={lessons}
          books={books}
          activities={activities}
          appointments={appointments}
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
                <div key={e.id ?? `book-${i}`} className="flex items-start gap-3 py-2.5">
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
                </div>
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

      {/* ── Reading Log print host ───────────────────────────────
          Off-screen until its own print job. Same isolation pattern the Plan
          print sheets use in globals.css, scoped to this page so printing the
          reading log cannot pull the config card or the Hours report along
          with it. */}
      <style>{`
        .reading-log-print-host { display: none; }
        @media print {
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
