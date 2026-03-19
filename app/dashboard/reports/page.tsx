"use client";

import { useEffect, useState } from "react";
import { FileText, Printer, Calendar, Clock, BookOpen, CheckSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PaywallCard from "@/components/PaywallCard";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child    = { id: string; name: string };
type Subject  = { id: string; name: string; color: string | null };
type Lesson   = {
  id: string; child_id: string; subject_id: string | null;
  title: string; date: string | null; scheduled_date: string | null;
  completed: boolean; hours: number | null;
};
type Attendance = { id: string; child_id: string; day: string; present: boolean };
type BookEvent  = { payload: { title?: string; child_id?: string; date?: string } };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return d.toISOString().split("T")[0]; }
function schoolYearStart() {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

// ─── Print Report Component ───────────────────────────────────────────────────

function PrintReport({
  child, dateFrom, dateTo, lessons, attendance, books, subjects,
}: {
  child: Child | null;
  dateFrom: string; dateTo: string;
  lessons: Lesson[]; attendance: Attendance[];
  books: BookEvent[]; subjects: Subject[];
}) {
  const filteredLessons = lessons.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    if (!d) return false;
    if (child && l.child_id !== child.id) return false;
    return d >= dateFrom && d <= dateTo;
  });
  const filteredAttendance = attendance.filter((a) => {
    if (child && a.child_id !== child.id) return false;
    return a.day >= dateFrom && a.day <= dateTo && a.present;
  });
  const filteredBooks = books.filter((b) => {
    if (child && b.payload.child_id && b.payload.child_id !== child.id) return false;
    const d = b.payload.date ?? "";
    return d >= dateFrom && d <= dateTo;
  });

  const completedLessons = filteredLessons.filter((l) => l.completed);
  const totalHours = completedLessons.reduce((sum, l) => sum + (l.hours ?? 0), 0);

  // Group by subject
  const subjectMap: Record<string, { name: string; color: string | null; count: number; hours: number }> = {};
  completedLessons.forEach((l) => {
    const subj = subjects.find((s) => s.id === l.subject_id);
    const key  = l.subject_id ?? "uncat";
    if (!subjectMap[key]) {
      subjectMap[key] = { name: subj?.name ?? "Unassigned", color: subj?.color ?? null, count: 0, hours: 0 };
    }
    subjectMap[key].count++;
    subjectMap[key].hours += l.hours ?? 0;
  });

  // Build attendance calendar (unique dates)
  const presentDates = new Set(filteredAttendance.map((a) => a.day));

  const fromLabel = new Date(dateFrom + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const toLabel   = new Date(dateTo   + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="print-content bg-white p-6 rounded-2xl border border-[#e8e2d9] space-y-6">
      {/* Report header */}
      <div className="flex items-start justify-between border-b border-[#e8e2d9] pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🌿</span>
            <span className="font-bold text-[#5c7f63]">Rooted Homeschool</span>
          </div>
          <h2 className="text-xl font-bold text-[#2d2926]">
            {child ? `${child.name}'s ` : ""}Progress Report
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
              <span key={d} className="text-[10px] bg-[#e8f0e9] text-[#3d5c42] px-2 py-1 rounded-lg">
                {new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-[#e8e2d9] pt-4 text-center">
        <p className="text-xs text-[#b5aca4]">
          Generated by Rooted Homeschool · This report documents home education activities for record-keeping purposes.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { effectiveUserId } = usePartner();
  const [children,   setChildren]   = useState<Child[]>([]);
  const [subjects,   setSubjects]   = useState<Subject[]>([]);
  const [lessons,    setLessons]    = useState<Lesson[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [books,      setBooks]      = useState<BookEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [isPro,      setIsPro]      = useState<boolean | null>(null);

  const [selectedChild, setSelectedChild] = useState<string>("all");
  const [dateFrom,      setDateFrom]      = useState(schoolYearStart());
  const [dateTo,        setDateTo]        = useState(toDateStr(new Date()));
  const [showPreview,   setShowPreview]   = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const [
        { data: kids },
        { data: subjs },
        { data: lessons_ },
        { data: att },
        { data: bookEvts },
        { data: profile },
      ] = await Promise.all([
        supabase.from("children").select("id, name").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId),
        supabase.from("lessons").select("id, child_id, subject_id, title, date, scheduled_date, completed, hours").eq("user_id", effectiveUserId),
        supabase.from("attendance").select("id, child_id, day, present").eq("user_id", effectiveUserId),
        supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
        supabase.from("profiles").select("is_pro").eq("id", effectiveUserId).single(),
      ]);

      setChildren(kids ?? []);
      setSubjects(subjs ?? []);
      setLessons((lessons_ as unknown as Lesson[]) ?? []);
      setAttendance((att as unknown as Attendance[]) ?? []);
      setBooks((bookEvts as unknown as BookEvent[]) ?? []);
      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
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
  const completedCount      = filteredLessons.filter((l) => l.completed).length;
  const totalHours          = filteredLessons.filter((l) => l.completed).reduce((s, l) => s + (l.hours ?? 0), 0);
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

  if (isPro === false) {
    return (
      <PaywallCard
        feature="Compliance Reports"
        description="Generate print-ready PDF progress reports for states that require homeschool documentation."
      />
    );
  }

  return (
    <div className="max-w-3xl px-4 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          For State Compliance
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Reports 📋</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Professional, printable reports for states that require homeschool documentation.
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
            { label: "Subjects", value: subjects.length },
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
          {showPreview ? "Hide Preview" : "Preview Report"}
        </button>
        <button
          onClick={() => { setShowPreview(true); setTimeout(() => window.print(), 300); }}
          className="flex-1 flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium py-3 rounded-xl transition-colors"
        >
          <Printer size={16} />
          Print / Save PDF
        </button>
      </div>

      {/* Report preview */}
      {showPreview && (
        <PrintReport
          child={activeChild}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lessons={lessons}
          attendance={attendance}
          books={books}
          subjects={subjects}
        />
      )}

      {/* Info banner */}
      <div className="bg-[#f5ede0] border border-[#c4956a]/30 rounded-2xl p-4">
        <p className="text-xs font-semibold text-[#8b6f47] mb-1">📌 Note on State Requirements</p>
        <p className="text-xs text-[#7a6f65] leading-relaxed">
          This report documents your home education activities. Check the Resources tab for your
          state&apos;s specific requirements — some states require annual portfolios, others need
          standardized test results. Keep copies of this report for your records.
        </p>
      </div>

      <div className="h-4" />
    </div>
  );
}
