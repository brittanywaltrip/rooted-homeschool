"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type Child = { id: string; name: string };

type EditableSubject = {
  tempId: string;
  childId: string;
  subjectLabel: string;
  curriculumName: string;
  iconEmoji: string;
  schoolDays: string[];
  defaultMinutes: number | "";
  totalLessons: number | "";
  courseLevel: string;
  creditsValue: number | null;
  startDate: string;
  showCredits: boolean;
};

type SourceGoal = {
  id: string;
  child_id: string | null;
  subject_label: string | null;
  curriculum_name: string;
  icon_emoji: string | null;
  school_days: string[] | null;
  default_minutes: number | null;
  total_lessons: number | null;
  course_level: string | null;
  credits_value: number | null;
};

function parseYearName(name: string): { startYear: number; endYear: number } | null {
  const m = name.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (!m) return null;
  return { startYear: parseInt(m[1], 10), endYear: parseInt(m[2], 10) };
}

function nextYearName(oldName: string): string {
  const parsed = parseYearName(oldName);
  if (!parsed) {
    const nowYear = new Date().getFullYear();
    return `${nowYear}-${nowYear + 1}`;
  }
  return `${parsed.startYear + 1}-${parsed.endYear + 1}`;
}

function defaultStartDate(oldName: string): string {
  const parsed = parseYearName(oldName);
  const startYear = parsed ? parsed.endYear : new Date().getFullYear();
  return `${startYear}-08-01`;
}

function defaultEndDate(oldName: string): string {
  const parsed = parseYearName(oldName);
  const endYear = parsed ? parsed.endYear + 1 : new Date().getFullYear() + 1;
  return `${endYear}-05-31`;
}

function makeBlankSubject(childId: string, startDate: string): EditableSubject {
  return {
    tempId: crypto.randomUUID(),
    childId,
    subjectLabel: "",
    curriculumName: "",
    iconEmoji: "📚",
    schoolDays: [...DEFAULT_DAYS],
    defaultMinutes: 30,
    totalLessons: "",
    courseLevel: "standard",
    creditsValue: null,
    startDate,
    showCredits: false,
  };
}

export default function NewYearPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromYearId = searchParams.get("from");
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [yearName, setYearName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [subjects, setSubjects] = useState<EditableSubject[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!fromYearId) {
        setLoadError("Missing source year.");
        setLoading(false);
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) { setLoadError("Please sign in to continue."); setLoading(false); }
          return;
        }

        const [oldYearRes, oldGoalsRes, kidsRes] = await Promise.all([
          supabase
            .from("school_years")
            .select("name, start_date, end_date")
            .eq("id", fromYearId)
            .maybeSingle(),
          supabase
            .from("curriculum_goals")
            .select("id, child_id, subject_label, curriculum_name, icon_emoji, school_days, default_minutes, total_lessons, course_level, credits_value")
            .eq("school_year_id", fromYearId)
            .order("subject_label", { ascending: true }),
          supabase
            .from("children")
            .select("id, name")
            .eq("user_id", user.id)
            .order("name", { ascending: true }),
        ]);

        if (cancelled) return;

        const oldYear = oldYearRes.data as { name: string } | null;
        const newName = oldYear ? nextYearName(oldYear.name) : "";
        const newStart = oldYear ? defaultStartDate(oldYear.name) : "";
        const newEnd = oldYear ? defaultEndDate(oldYear.name) : "";
        setYearName(newName);
        setStartDate(newStart);
        setEndDate(newEnd);

        const kids = (kidsRes.data ?? []) as Child[];
        setChildren(kids);

        const goals = (oldGoalsRes.data ?? []) as SourceGoal[];
        const mapped: EditableSubject[] = goals.map((g) => ({
          tempId: crypto.randomUUID(),
          childId: g.child_id ?? "",
          subjectLabel: g.subject_label ?? "",
          curriculumName: g.curriculum_name ?? "",
          iconEmoji: g.icon_emoji ?? "📚",
          schoolDays: g.school_days && g.school_days.length > 0 ? g.school_days : [...DEFAULT_DAYS],
          defaultMinutes: g.default_minutes ?? 30,
          totalLessons: "",
          courseLevel: g.course_level ?? "standard",
          creditsValue: g.credits_value,
          startDate: newStart,
          showCredits: g.credits_value != null,
        }));
        setSubjects(mapped);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fromYearId, supabase]);

  function updateSubject(tempId: string, patch: Partial<EditableSubject>) {
    setSubjects((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s)));
  }

  function removeSubject(tempId: string) {
    setSubjects((prev) => prev.filter((s) => s.tempId !== tempId));
  }

  function addSubjectForChild(childId: string) {
    setSubjects((prev) => [...prev, makeBlankSubject(childId, startDate)]);
  }

  function toggleSchoolDay(tempId: string, day: string) {
    setSubjects((prev) =>
      prev.map((s) => {
        if (s.tempId !== tempId) return s;
        const has = s.schoolDays.includes(day);
        return { ...s, schoolDays: has ? s.schoolDays.filter((d) => d !== day) : [...s.schoolDays, day] };
      })
    );
  }

  const grouped = useMemo(() => {
    const map = new Map<string, EditableSubject[]>();
    for (const s of subjects) {
      const key = s.childId || "__unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [subjects]);

  const childById = useMemo(() => {
    const m = new Map<string, Child>();
    for (const c of children) m.set(c.id, c);
    return m;
  }, [children]);

  const allLessonCountsFilled = subjects.every((s) => s.totalLessons !== "" && Number(s.totalLessons) > 0);
  const submitDisabled = saving || subjects.length === 0 || !allLessonCountsFilled || !yearName.trim() || !startDate || !endDate;

  async function handleSubmit() {
    setSubmitAttempted(true);
    setError("");
    if (!allLessonCountsFilled) {
      setError("Please fill in the lesson count for every subject.");
      return;
    }
    if (!yearName.trim() || !startDate || !endDate) {
      setError("Please fill in the year name and dates.");
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please sign in to continue.");

      const payload = {
        name: yearName.trim(),
        startDate,
        endDate,
        subjects: subjects.map((s) => ({
          childId: s.childId || null,
          subjectLabel: s.subjectLabel.trim() || null,
          curriculumName: s.curriculumName.trim(),
          iconEmoji: s.iconEmoji.trim() || null,
          schoolDays: s.schoolDays,
          defaultMinutes: typeof s.defaultMinutes === "number" ? s.defaultMinutes : Number(s.defaultMinutes) || 30,
          totalLessons: typeof s.totalLessons === "number" ? s.totalLessons : Number(s.totalLessons),
          courseLevel: s.courseLevel.trim() || null,
          creditsValue: s.showCredits ? s.creditsValue : null,
          startDate: s.startDate,
        })),
      };

      const res = await fetch("/api/school-year/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        throw new Error(j.error || "Failed to create school year.");
      }
      router.push("/dashboard/plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create school year.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p style={{ color: "var(--g-deep)" }}>Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center px-4">
        <p style={{ color: "var(--g-deep)" }}>{loadError}</p>
      </div>
    );
  }

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20";
  const labelClass = "text-xs font-medium text-[#7a6f65] block mb-1";

  const renderSubjectCard = (s: EditableSubject) => {
    const showCountError = submitAttempted && s.totalLessons === "";
    return (
      <div
        key={s.tempId}
        className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-3 relative"
      >
        <button
          type="button"
          onClick={() => removeSubject(s.tempId)}
          aria-label="Remove subject"
          className="absolute top-3 right-3 w-7 h-7 rounded-full text-[#9a8e84] hover:text-[#2d2926] hover:bg-[#f0ede8] flex items-center justify-center text-base leading-none"
        >
          ×
        </button>

        <div className="flex gap-2 items-end pr-8">
          <div className="w-14">
            <label className={labelClass}>Icon</label>
            <input
              type="text"
              value={s.iconEmoji}
              onChange={(e) => updateSubject(s.tempId, { iconEmoji: e.target.value })}
              className={`${inputClass} text-center`}
              maxLength={4}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Subject</label>
            <input
              type="text"
              value={s.subjectLabel}
              onChange={(e) => updateSubject(s.tempId, { subjectLabel: e.target.value })}
              placeholder="e.g. Math"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Curriculum / Book</label>
          <input
            type="text"
            value={s.curriculumName}
            onChange={(e) => updateSubject(s.tempId, { curriculumName: e.target.value })}
            placeholder="e.g. Saxon Math 8"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              Total lessons <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              value={s.totalLessons}
              onChange={(e) => {
                const v = e.target.value;
                updateSubject(s.tempId, { totalLessons: v === "" ? "" : Number(v) });
              }}
              placeholder="e.g. 120"
              className={`${inputClass} ${showCountError ? "border-red-400 focus:border-red-400 focus:ring-red-400/20" : ""}`}
            />
          </div>
          <div>
            <label className={labelClass}>Minutes per lesson</label>
            <input
              type="number"
              min={1}
              value={s.defaultMinutes}
              onChange={(e) => {
                const v = e.target.value;
                updateSubject(s.tempId, { defaultMinutes: v === "" ? "" : Number(v) });
              }}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>School days</label>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((d) => {
              const on = s.schoolDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleSchoolDay(s.tempId, d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    on
                      ? "bg-[var(--g-brand)] text-white border-[var(--g-brand)]"
                      : "bg-white text-[#5c6b62] border-[#e0ddd8]"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Subject start date</label>
            <input
              type="date"
              value={s.startDate}
              onChange={(e) => updateSubject(s.tempId, { startDate: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Course level</label>
            <input
              type="text"
              value={s.courseLevel}
              onChange={(e) => updateSubject(s.tempId, { courseLevel: e.target.value })}
              placeholder="standard / honors / AP"
              className={inputClass}
            />
          </div>
        </div>

        {s.showCredits && (
          <div>
            <label className={labelClass}>Credits</label>
            <input
              type="number"
              step="0.25"
              min={0}
              value={s.creditsValue ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                updateSubject(s.tempId, { creditsValue: v === "" ? null : Number(v) });
              }}
              className={inputClass}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <Link
            href={fromYearId ? `/dashboard/year-end/${fromYearId}` : "/dashboard/plan"}
            className="text-sm"
            style={{ color: "var(--g-accent)" }}
          >
            ← Back to Year Summary
          </Link>
          <h1
            className="text-2xl sm:text-3xl mt-3 mb-1"
            style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
          >
            Set Up Next Year
          </h1>
          <p className="text-sm" style={{ color: "#7a6f65" }}>
            Your subjects are pre-filled from last year. Enter the lesson count for each one and update anything that&apos;s changed.
          </p>
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
          <div>
            <label className={labelClass}>Year name</label>
            <input
              type="text"
              value={yearName}
              onChange={(e) => setYearName(e.target.value)}
              placeholder="e.g. 2026-2027"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {children.map((child) => {
            const childSubjects = grouped.get(child.id) ?? [];
            return (
              <div key={child.id} className="space-y-3">
                <h2
                  className="text-base"
                  style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
                >
                  {child.name}
                </h2>
                {childSubjects.length === 0 ? (
                  <p className="text-xs" style={{ color: "#7a6f65" }}>
                    No subjects yet for {child.name}.
                  </p>
                ) : (
                  childSubjects.map((s) => renderSubjectCard(s))
                )}
                <button
                  type="button"
                  onClick={() => addSubjectForChild(child.id)}
                  className="text-sm"
                  style={{ color: "var(--g-accent)" }}
                >
                  + Add subject for {child.name}
                </button>
              </div>
            );
          })}

          {grouped.has("__unassigned") && (
            <div className="space-y-3">
              <h2
                className="text-base"
                style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
              >
                Unassigned
              </h2>
              {grouped.get("__unassigned")!.map((s) => renderSubjectCard(s))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="block w-full text-white rounded-xl py-3 font-medium text-center disabled:opacity-50"
          style={{ background: "var(--g-brand)" }}
        >
          {saving ? "Creating…" : `Create ${yearName || "Next Year"} →`}
        </button>
      </div>
    </div>
  );
}
