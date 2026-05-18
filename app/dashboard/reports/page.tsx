"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Printer, Calendar, Clock, BookOpen, CheckSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { canExport } from "@/lib/user-access";
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
type BookEvent  = { payload: { title?: string; child_id?: string; date?: string } };
type MemoryActivity = { child_id: string | null; type: string; date: string; duration_minutes: number | null };
type ReportAppointment = {
  id: string;
  title: string;
  emoji: string;
  date: string;
  duration_minutes: number | null;
  location: string | null;
  child_ids: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function schoolYearStart() {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

// ─── Print Report Component ───────────────────────────────────────────────────

function PrintReport({
  child, children: allKids, dateFrom, dateTo, lessons, books, activities, appointments, includeAppointments,
}: {
  child: Child | null;
  children: Child[];
  dateFrom: string; dateTo: string;
  lessons: Lesson[];
  books: BookEvent[];
  activities: MemoryActivity[];
  appointments: ReportAppointment[];
  includeAppointments: boolean;
}) {
  const filteredLessons = lessons.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    if (!d) return false;
    if (child && l.child_id !== child.id) return false;
    return d >= dateFrom && d <= dateTo;
  });
  const filteredBooks = books.filter((b) => {
    if (child && b.payload.child_id && b.payload.child_id !== child.id) return false;
    const d = b.payload.date ?? "";
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

  // Appointments included in the report only when the toggle is on. For a
  // single-child report, whole-family appointments (empty child_ids) are
  // counted toward that child; appointments explicitly tagged to other kids
  // are excluded. "All Children" includes everything.
  const filteredAppointments: ReportAppointment[] = !includeAppointments
    ? []
    : appointments.filter((a) => {
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
      {includeAppointments && filteredAppointments.length > 0 && (
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
                <span className="text-[#2d2926]">{b.payload.title ?? "Untitled"}</span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { effectiveUserId } = usePartner();
  const [children,   setChildren]   = useState<Child[]>([]);
  const [lessons,    setLessons]    = useState<Lesson[]>([]);
  const [books,      setBooks]      = useState<BookEvent[]>([]);
  const [activities, setActivities] = useState<MemoryActivity[]>([]);
  const [appointments, setAppointments] = useState<ReportAppointment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [isPro,      setIsPro]      = useState<boolean | null>(null);

  const [selectedChild, setSelectedChild] = useState<string>("all");
  const [dateFrom,      setDateFrom]      = useState(schoolYearStart());
  const [dateTo,        setDateTo]        = useState(toDateStr(new Date()));
  const [includeAppointments, setIncludeAppointments] = useState(true);
  const [showPreview,   setShowPreview]   = useState(false);
  const [showExportGate, setShowExportGate] = useState(false);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);

  useEffect(() => { document.title = "Hours & Attendance Log \u00b7 Rooted"; localStorage.setItem("rooted_visited_reports", "1"); posthog.capture('page_viewed', { page: 'reports' }); }, []);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const [
        { data: kids },
        { data: lessons_ },
        { data: bookEvts },
        { data: memActivities },
        { data: profile },
        { data: oneTimeAppts },
        { data: exceptionAppts },
      ] = await Promise.all([
        supabase.from("children").select("id, name").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("lessons").select("id, child_id, curriculum_goal_id, curriculum_goals(subject_label), title, date, scheduled_date, completed, completed_at, minutes_spent").eq("user_id", effectiveUserId),
        supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
        supabase.from("memories").select("child_id, type, date, duration_minutes").eq("user_id", effectiveUserId).not("duration_minutes", "is", null).in("type", ["field_trip", "project", "activity", "win"]),
        supabase.from("profiles").select("is_pro, trial_started_at").eq("id", effectiveUserId).single(),
        // One-time completed appointments: completion lives on the base row.
        supabase
          .from("appointments")
          .select("id, title, emoji, date, duration_minutes, location, child_ids")
          .eq("user_id", effectiveUserId)
          .eq("is_recurring", false)
          .eq("completed", true),
        // Per-occurrence completions for recurring appointments live on
        // appointment_exceptions; join the parent for display fields.
        supabase
          .from("appointment_exceptions")
          .select("exception_date, appointments!inner(id, title, emoji, duration_minutes, location, child_ids, user_id)")
          .eq("completed", true)
          .eq("appointments.user_id", effectiveUserId),
      ]);

      setChildren(capitalizeChildNames(kids ?? []));
      setLessons((lessons_ as unknown as Lesson[]) ?? []);
      setBooks((bookEvts as unknown as BookEvent[]) ?? []);
      setActivities((memActivities as unknown as MemoryActivity[]) ?? []);

      type OneTimeRow = { id: string; title: string; emoji: string | null; date: string; duration_minutes: number | null; location: string | null; child_ids: string[] | null };
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
            };
          })),
      ];
      setAppointments(merged);

      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
      setTrialStartedAt((profile as any)?.trial_started_at ?? null);
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
    const d = b.payload.date ?? "";
    if (!d || d < dateFrom || d > dateTo) return false;
    if (selectedChild !== "all" && b.payload.child_id && b.payload.child_id !== selectedChild) return false;
    return true;
  }).length;

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

        {/* Include activities and appointments */}
        <div className="flex items-center gap-2">
          <input
            id="include-appts"
            type="checkbox"
            checked={includeAppointments}
            onChange={(e) => setIncludeAppointments(e.target.checked)}
            className="w-4 h-4 accent-[#5c7f63] cursor-pointer"
          />
          <label htmlFor="include-appts" className="text-sm text-[#2d2926] cursor-pointer select-none">
            Include activities and appointments
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
          includeAppointments={includeAppointments}
        />
      )}

      {/* Info banner */}
      <div className="bg-[#f5ede0] border border-[#c4956a]/30 rounded-2xl p-4">
        <p className="text-xs font-semibold text-[#8b6f47] mb-1">📌 Know Your State</p>
        <p className="text-xs text-[#7a6f65] leading-relaxed">
          This report documents your home education activities. Check the Resources tab for your
          state&apos;s homeschool information — some states request annual portfolios, others may ask for
          standardized test results. Keep copies of this report for your family records.
        </p>
      </div>

      <div className="h-4" />

      {showExportGate && (
        <ExportGateModal
          title="Save your progress"
          body="Download a polished summary of your homeschool plan and progress."
          cta="Download Report"
          onClose={() => setShowExportGate(false)}
        />
      )}
    </div>
  );
}
