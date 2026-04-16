"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ChevronLeft, ChevronDown, ChevronUp, X, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHero from "@/app/components/PageHero";
import { SUBJECT_CATEGORIES, CREDIT_TYPES, GRADE_OPTIONS, SEMESTERS, getSchoolYearOptions } from "@/lib/transcript/constants";
import { calculateGPA, getCreditsBySubject, COLLEGE_READY_TARGETS, GRADE_POINTS } from "@/lib/transcript/gpa";
import { STATE_REQUIREMENTS, resolveStateCode } from "@/lib/transcript/state-requirements";

// ─── Types ──────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type Settings = {
  id?: string;
  school_name: string | null;
  state: string | null;
  graduation_year: number | null;
  use_weighted_gpa: boolean;
  principal_name: string | null;
};

type Course = {
  id: string;
  school_year: string;
  grade_level: string | null;
  course_name: string;
  subject_category: string;
  credit_type: string;
  credits_earned: number;
  hours_logged: number | null;
  grade_letter: string | null;
  grade_points: number | null;
  semester: string;
  course_description: string | null;
  curriculum_goal_id: string | null;
  is_external: boolean;
  external_provider: string | null;
};

type CurriculumGoal = { id: string; curriculum_name: string; icon_emoji: string | null; subject_label: string | null; school_year: string | null; default_minutes: number };

type Tab = "courses" | "gpa" | "preview";

const EMPTY_COURSE: Omit<Course, "id"> = {
  school_year: "",
  grade_level: null,
  course_name: "",
  subject_category: "other",
  credit_type: "standard",
  credits_earned: 1.0,
  hours_logged: null,
  grade_letter: null,
  grade_points: null,
  semester: "full_year",
  course_description: null,
  curriculum_goal_id: null,
  is_external: false,
  external_provider: null,
};

const STATE_LIST = Object.entries(STATE_REQUIREMENTS).map(([code, s]) => ({ code, name: s.name })).sort((a, b) => a.name.localeCompare(b.name));

const SUBJECT_COLOR_MAP: Record<string, { bg: string; text: string }> = {
  english: { bg: "#eff6ff", text: "#1d4ed8" },
  math: { bg: "#fef2f2", text: "#b91c1c" },
  science: { bg: "#f0fdf4", text: "#15803d" },
  social_studies: { bg: "#fffbeb", text: "#b45309" },
  foreign_language: { bg: "#faf5ff", text: "#7e22ce" },
};
const DEFAULT_BADGE = { bg: "#f9fafb", text: "#374151" };

function subjectBadgeColor(cat: string) {
  return SUBJECT_COLOR_MAP[cat] || DEFAULT_BADGE;
}

function subjectLabel(val: string) {
  return SUBJECT_CATEGORIES.find(c => c.value === val)?.label ?? val;
}

// ─── Subject mapping ────────────────────────────────────────────────────────

const SUBJECT_NAME_MAP: Record<string, string> = {
  math: "math", mathematics: "math", algebra: "math", geometry: "math", calculus: "math",
  english: "english", "language arts": "english", "ela": "english", reading: "english", writing: "english", literature: "english", grammar: "english",
  science: "science", biology: "science", chemistry: "science", physics: "science",
  history: "social_studies", "social studies": "social_studies", geography: "social_studies", government: "social_studies", civics: "social_studies", economics: "social_studies",
  spanish: "foreign_language", french: "foreign_language", latin: "foreign_language", german: "foreign_language", "foreign language": "foreign_language",
  art: "arts", music: "arts", "fine arts": "arts", drama: "arts", theater: "arts",
  pe: "pe", "physical education": "pe", health: "pe", sports: "pe",
  bible: "bible", theology: "bible", religion: "bible",
  technology: "technology", "computer science": "technology", coding: "technology", programming: "technology",
};

function mapSubjectToCategory(label: string | null): string {
  if (!label) return "other";
  const lower = label.toLowerCase().trim();
  if (SUBJECT_NAME_MAP[lower]) return SUBJECT_NAME_MAP[lower];
  // Partial match
  for (const [key, value] of Object.entries(SUBJECT_NAME_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return value;
  }
  return "other";
}

function calculateCreditsFromHours(hours: number): number {
  if (hours <= 0) return 0.5;
  const raw = Math.round((hours / 120) * 2) / 2;
  return Math.max(0.5, raw);
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TranscriptBuilderPage() {
  const { childId } = useParams<{ childId: string }>();
  const router = useRouter();

  const [child, setChild] = useState<Child | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("courses");
  const [loading, setLoading] = useState(true);

  // Settings
  const [settings, setSettings] = useState<Settings>({ school_name: null, state: null, graduation_year: null, use_weighted_gpa: false, principal_name: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [stateAutoDetected, setStateAutoDetected] = useState(false);

  // Courses
  const [courses, setCourses] = useState<Course[]>([]);
  const [goals, setGoals] = useState<CurriculumGoal[]>([]);

  // Course modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [form, setForm] = useState<Omit<Course, "id">>(EMPTY_COURSE);
  const [formSaving, setFormSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncingInitial, setSyncingInitial] = useState(false);
  const hasSyncedRef = useRef(false);

  // ── Sync courses from Plan ────────────────────────────────────────────────

  async function syncCoursesFromPlan(uid: string, cId: string, existingCourses: Course[], allGoals: CurriculumGoal[]): Promise<number> {
    if (allGoals.length === 0) return 0;

    // Find which goals already have linked transcript courses
    const linkedGoalIds = new Set(existingCourses.filter(c => c.curriculum_goal_id).map(c => c.curriculum_goal_id));
    const newGoals = allGoals.filter(g => !linkedGoalIds.has(g.id));
    if (newGoals.length === 0) {
      // Still refresh hours for existing linked courses
      await refreshLinkedCourseHours(uid, existingCourses);
      return 0;
    }

    // Fetch lesson data for new goals in bulk
    const goalIds = newGoals.map(g => g.id);
    const { data: lessonData } = await supabase
      .from("lessons")
      .select("curriculum_goal_id, minutes_spent, completed")
      .in("curriculum_goal_id", goalIds)
      .eq("completed", true);

    // Group lessons by goal
    const lessonsByGoal: Record<string, { count: number; totalMinutes: number }> = {};
    for (const l of (lessonData ?? [])) {
      const gid = l.curriculum_goal_id;
      if (!gid) continue;
      if (!lessonsByGoal[gid]) lessonsByGoal[gid] = { count: 0, totalMinutes: 0 };
      lessonsByGoal[gid].count++;
      lessonsByGoal[gid].totalMinutes += (l.minutes_spent ?? 45);
    }

    const currentYear = getSchoolYearOptions()[3] || getSchoolYearOptions()[0];
    const inserts = newGoals.map(goal => {
      const lessons = lessonsByGoal[goal.id];
      const hours = lessons ? Math.round(lessons.totalMinutes / 60) : 0;
      const credits = lessons ? calculateCreditsFromHours(hours) : 1.0;

      return {
        user_id: uid,
        child_id: cId,
        course_name: goal.curriculum_name || goal.subject_label || "Untitled Course",
        subject_category: mapSubjectToCategory(goal.subject_label),
        credit_type: "standard" as const,
        credits_earned: credits,
        hours_logged: hours || null,
        grade_letter: null,
        grade_points: null,
        school_year: goal.school_year || currentYear,
        grade_level: null,
        semester: "full_year" as const,
        course_description: null,
        curriculum_goal_id: goal.id,
        is_external: false,
        external_provider: null,
      };
    });

    if (inserts.length > 0) {
      await supabase.from("transcript_courses").insert(inserts);
    }

    // Also refresh hours for existing linked courses
    await refreshLinkedCourseHours(uid, existingCourses);

    return inserts.length;
  }

  async function refreshLinkedCourseHours(uid: string, existingCourses: Course[]) {
    const linkedCourses = existingCourses.filter(c => c.curriculum_goal_id);
    if (linkedCourses.length === 0) return;

    const goalIds = linkedCourses.map(c => c.curriculum_goal_id!);
    const { data: lessonData } = await supabase
      .from("lessons")
      .select("curriculum_goal_id, minutes_spent, completed")
      .in("curriculum_goal_id", goalIds)
      .eq("completed", true);

    const lessonsByGoal: Record<string, number> = {};
    for (const l of (lessonData ?? [])) {
      const gid = l.curriculum_goal_id;
      if (!gid) continue;
      lessonsByGoal[gid] = (lessonsByGoal[gid] || 0) + (l.minutes_spent ?? 45);
    }

    for (const course of linkedCourses) {
      const totalMinutes = lessonsByGoal[course.curriculum_goal_id!] || 0;
      const newHours = Math.round(totalMinutes / 60);
      if (newHours === (course.hours_logged || 0)) continue;

      const newCredits = calculateCreditsFromHours(newHours);
      // Don't overwrite credits if mom has manually set them (heuristic: credits differ AND grade is assigned)
      const creditsManuallySet = course.grade_letter && course.credits_earned !== calculateCreditsFromHours(course.hours_logged || 0);

      const update: Record<string, unknown> = { hours_logged: newHours || null, updated_at: new Date().toISOString() };
      if (!creditsManuallySet) update.credits_earned = newCredits;

      await supabase.from("transcript_courses").update(update).eq("id", course.id);
    }
  }

  async function handleManualSync() {
    if (!userId || syncing) return;
    setSyncing(true);
    const count = await syncCoursesFromPlan(userId, childId, courses, goals);
    // Re-fetch courses after sync
    const { data: coursesData } = await supabase.from("transcript_courses").select("*").eq("user_id", userId).eq("child_id", childId).order("school_year", { ascending: false }).order("course_name");
    setCourses((coursesData ?? []) as Course[]);
    setSyncing(false);
    if (count > 0) {
      showToast(`${count} course${count > 1 ? "s" : ""} imported from Plan`);
    } else {
      showToast("Everything is up to date");
    }
  }

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: childData }, { data: settingsData }, { data: coursesData }, { data: goalsData }, { data: profile }] = await Promise.all([
      supabase.from("children").select("id, name, color").eq("id", childId).maybeSingle(),
      supabase.from("transcript_settings").select("*").eq("user_id", user.id).eq("child_id", childId).maybeSingle(),
      supabase.from("transcript_courses").select("*").eq("user_id", user.id).eq("child_id", childId).order("school_year", { ascending: false }).order("course_name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, icon_emoji, subject_label, school_year, default_minutes").eq("user_id", user.id).eq("child_id", childId),
      supabase.from("profiles").select("display_name, first_name, last_name, state").eq("id", user.id).maybeSingle(),
    ]);

    if (!childData) { router.replace("/dashboard/transcript"); return; }
    setChild(childData as Child);
    const loadedCourses = (coursesData ?? []) as Course[];
    const loadedGoals = (goalsData ?? []) as CurriculumGoal[];
    setCourses(loadedCourses);
    setGoals(loadedGoals);

    // Auto-sync from Plan on first load
    if (!hasSyncedRef.current && loadedGoals.length > 0) {
      hasSyncedRef.current = true;
      const needsInitialSync = loadedCourses.length === 0 && loadedGoals.length > 0;
      if (needsInitialSync) setSyncingInitial(true);

      const count = await syncCoursesFromPlan(user.id, childId, loadedCourses, loadedGoals);
      if (count > 0 || loadedCourses.some(c => c.curriculum_goal_id)) {
        // Re-fetch after sync/refresh
        const { data: refreshed } = await supabase.from("transcript_courses").select("*").eq("user_id", user.id).eq("child_id", childId).order("school_year", { ascending: false }).order("course_name");
        setCourses((refreshed ?? []) as Course[]);
      }
      setSyncingInitial(false);
    }

    if (settingsData) {
      setSettings({
        id: settingsData.id,
        school_name: settingsData.school_name,
        state: settingsData.state,
        graduation_year: settingsData.graduation_year,
        use_weighted_gpa: settingsData.use_weighted_gpa ?? false,
        principal_name: settingsData.principal_name,
      });
    } else {
      // Default settings from profile
      const lastName = (profile as any)?.last_name || (profile as any)?.display_name || "";
      const firstName = (profile as any)?.first_name || "";
      const profileStateRaw = (profile as any)?.state as string | null;
      const resolvedCode = resolveStateCode(profileStateRaw);
      if (resolvedCode) setStateAutoDetected(true);
      setSettings(prev => ({
        ...prev,
        school_name: lastName ? `${lastName} Home Academy` : null,
        principal_name: [firstName, lastName].filter(Boolean).join(" ") || null,
        state: resolvedCode,
      }));
      setSettingsOpen(true); // Show settings on first visit
    }

    setLoading(false);
  }, [childId, router]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (child) document.title = `${child.name}'s Transcript · Rooted`; }, [child]);

  // ── Settings save ─────────────────────────────────────────────────────────

  async function saveSettings() {
    if (!userId || settingsSaving) return;
    setSettingsSaving(true);

    const payload = {
      user_id: userId,
      child_id: childId,
      school_name: settings.school_name || null,
      state: settings.state || null,
      graduation_year: settings.graduation_year || null,
      use_weighted_gpa: settings.use_weighted_gpa,
      principal_name: settings.principal_name || null,
      updated_at: new Date().toISOString(),
    };

    if (settings.id) {
      await supabase.from("transcript_settings").update(payload).eq("id", settings.id);
    } else {
      const { data } = await supabase.from("transcript_settings").insert(payload).select("id").single();
      if (data) setSettings(prev => ({ ...prev, id: data.id }));
    }

    setSettingsSaving(false);
    setSettingsOpen(false);
    showToast("Settings saved");
  }

  // ── Course CRUD ───────────────────────────────────────────────────────────

  function openAddCourse() {
    const years = getSchoolYearOptions();
    setEditingCourse(null);
    setForm({ ...EMPTY_COURSE, school_year: years[3] || years[0] });
    setDeleteConfirm(false);
    setModalOpen(true);
  }

  function openEditCourse(course: Course) {
    setEditingCourse(course);
    setForm({ ...course });
    setDeleteConfirm(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingCourse(null);
    setDeleteConfirm(false);
  }

  function updateForm<K extends keyof Omit<Course, "id">>(key: K, value: Omit<Course, "id">[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Auto-fill grade points when grade letter changes
      if (key === "grade_letter") {
        const letter = value as string | null;
        next.grade_points = letter ? (GRADE_POINTS[letter] ?? null) : null;
      }
      return next;
    });
  }

  async function saveCourse() {
    if (!userId || formSaving || !form.course_name.trim()) return;
    setFormSaving(true);

    const payload = {
      user_id: userId,
      child_id: childId,
      school_year: form.school_year,
      grade_level: form.grade_level || null,
      course_name: form.course_name.trim(),
      subject_category: form.subject_category,
      credit_type: form.credit_type,
      credits_earned: form.credits_earned,
      hours_logged: form.hours_logged,
      grade_letter: form.grade_letter || null,
      grade_points: form.grade_points,
      semester: form.semester,
      course_description: form.course_description?.trim() || null,
      curriculum_goal_id: form.curriculum_goal_id || null,
      is_external: form.is_external,
      external_provider: form.is_external ? (form.external_provider?.trim() || null) : null,
      updated_at: new Date().toISOString(),
    };

    if (editingCourse) {
      await supabase.from("transcript_courses").update(payload).eq("id", editingCourse.id);
      setCourses(prev => prev.map(c => c.id === editingCourse.id ? { ...c, ...payload } : c));
    } else {
      const { data } = await supabase.from("transcript_courses").insert(payload).select("id").single();
      if (data) setCourses(prev => [{ id: data.id, ...payload } as Course, ...prev]);
    }

    setFormSaving(false);
    closeModal();
    showToast(editingCourse ? "Course updated" : "Course added");
  }

  async function deleteCourse() {
    if (!editingCourse) return;
    await supabase.from("transcript_courses").delete().eq("id", editingCourse.id);
    setCourses(prev => prev.filter(c => c.id !== editingCourse.id));
    closeModal();
    showToast("Course deleted");
  }

  // ── GPA calculations ──────────────────────────────────────────────────────

  const gpaData = courses.map(c => ({ grade_letter: c.grade_letter, credits_earned: c.credits_earned, credit_type: c.credit_type }));
  const unweightedGPA = calculateGPA(gpaData, false);
  const weightedGPA = calculateGPA(gpaData, true);
  const totalCredits = courses.reduce((sum, c) => sum + (c.credits_earned || 0), 0);

  const coursesByYear = courses.reduce<Record<string, Course[]>>((acc, c) => {
    (acc[c.school_year] = acc[c.school_year] || []).push(c);
    return acc;
  }, {});
  const sortedYears = Object.keys(coursesByYear).sort();

  const creditsBySubject = getCreditsBySubject(courses.map(c => ({ subject_category: c.subject_category, credits_earned: c.credits_earned })));

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading || !child) {
    return (
      <>
        <PageHero overline="Transcripts" title="Loading..." />
        <div className="max-w-2xl mx-auto px-5 pt-6">
          <div className="bg-white rounded-2xl p-6 animate-pulse space-y-4" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div className="w-40 h-5 bg-[#e8e2d9] rounded" />
            <div className="w-full h-20 bg-[#e8e2d9] rounded-xl" />
            <div className="w-full h-12 bg-[#e8e2d9] rounded-xl" />
          </div>
        </div>
      </>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "courses", label: "Courses" },
    { key: "gpa", label: "GPA & Summary" },
    { key: "preview", label: "Preview" },
  ];

  return (
    <>
      <PageHero overline="Transcripts" title={`${child.name}'s Transcript`} subtitle={settings.school_name || undefined} />

      <div className="max-w-2xl mx-auto px-5 pt-4 pb-10">
        {/* Back link */}
        <Link href="/dashboard/transcript" className="inline-flex items-center gap-1 text-[13px] text-[#8a8580] hover:text-[#3c3a37] mb-4 transition-colors">
          <ChevronLeft size={14} /> All transcripts
        </Link>

        {/* Settings banner */}
        <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          <button type="button" onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left">
            <div>
              <p className="text-[14px] font-medium text-[#3c3a37]">Transcript settings</p>
              <p className="text-[12px] text-[#8a8580]">
                {[settings.school_name, settings.state ? STATE_REQUIREMENTS[settings.state]?.name : null, settings.graduation_year ? `Class of ${settings.graduation_year}` : null].filter(Boolean).join(" · ") || "Set up your school info"}
              </p>
            </div>
            {settingsOpen ? <ChevronUp size={18} className="text-[#8a8580]" /> : <ChevronDown size={18} className="text-[#8a8580]" />}
          </button>

          {settingsOpen && (
            <div className="px-5 pb-5 border-t border-[#f0ece6] pt-4 space-y-3">
              <div>
                <label className="text-[12px] font-medium text-[#6b6560] block mb-1">School name</label>
                <input type="text" value={settings.school_name || ""} onChange={e => setSettings(s => ({ ...s, school_name: e.target.value }))}
                  placeholder="e.g. Smith Home Academy"
                  className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">State</label>
                  <select value={settings.state || ""} onChange={e => { setSettings(s => ({ ...s, state: e.target.value || null })); setStateAutoDetected(false); }}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                    <option value="">Select your state</option>
                    {STATE_LIST.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                  {stateAutoDetected && settings.state && <p className="text-[11px] text-[#8a8580] mt-0.5">Auto-detected from your profile</p>}
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Graduation year</label>
                  <input type="number" value={settings.graduation_year || ""} onChange={e => setSettings(s => ({ ...s, graduation_year: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="e.g. 2028"
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                </div>
              </div>
              <div>
                <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Principal / administrator name</label>
                <input type="text" value={settings.principal_name || ""} onChange={e => setSettings(s => ({ ...s, principal_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setSettings(s => ({ ...s, use_weighted_gpa: !s.use_weighted_gpa }))}
                  className={`w-10 h-6 rounded-full relative transition-colors ${settings.use_weighted_gpa ? "bg-[#2D5A3D]" : "bg-[#e8e2d9]"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.use_weighted_gpa ? "left-[18px]" : "left-0.5"}`} />
                </button>
                <span className="text-[13px] text-[#3c3a37]">Use weighted GPA (Honors +0.5, AP/Dual +1.0)</span>
              </div>
              <button type="button" onClick={saveSettings} disabled={settingsSaving}
                className="bg-[#2D5A3D] text-white text-[13px] font-medium px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60">
                {settingsSaving ? "Saving..." : "Save settings"}
              </button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          <div className="flex border-b border-[#f0ece6]">
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className="flex-1 py-3 text-center text-[12px] font-medium cursor-pointer transition-all"
                style={{ color: tab === t.key ? "#2D5A3D" : "#b5aca4", borderBottom: tab === t.key ? "2.5px solid #2D5A3D" : "2.5px solid transparent" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ─── Tab: Courses ────────────────────────────────────────────── */}
          {tab === "courses" && (
            <div className="p-4">
              {syncingInitial ? (
                <div className="text-center py-10">
                  <RefreshCw size={20} className="mx-auto mb-2 text-[#2D5A3D] animate-spin" />
                  <p className="text-[14px] font-medium text-[#3c3a37] mb-1">Setting up your transcript from your lesson plan...</p>
                  <p className="text-[13px] text-[#8a8580]">Importing courses and calculating hours.</p>
                </div>
              ) : courses.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[15px] font-medium text-[#3c3a37] mb-1">No courses yet</p>
                  <p className="text-[13px] text-[#8a8580] mb-4">
                    {goals.length > 0
                      ? "Your lesson plan courses will appear here automatically. Or add courses manually below."
                      : "Start by adding subjects in the Plan tab, and they'll automatically appear here. Or add courses manually below."}
                  </p>
                  <button type="button" onClick={openAddCourse}
                    className="inline-flex items-center gap-1.5 bg-[#2D5A3D] text-white text-[13px] font-medium px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity">
                    <Plus size={16} /> Add first course
                  </button>
                </div>
              ) : (
                <>
                  {/* Sync button */}
                  {goals.length > 0 && (
                    <div className="flex items-center justify-end mb-3">
                      <button type="button" onClick={handleManualSync} disabled={syncing}
                        className="inline-flex items-center gap-1.5 border border-[#cef0d4] text-[#2D5A3D] text-[13px] font-medium rounded-lg px-3 py-1.5 hover:bg-[#f0faf3] transition-colors disabled:opacity-60">
                        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                        {syncing ? "Syncing..." : "Sync from Plan"}
                      </button>
                    </div>
                  )}
                  {sortedYears.map(year => {
                    const yearCourses = coursesByYear[year];
                    const gradeLevel = yearCourses.find(c => c.grade_level)?.grade_level;
                    return (
                      <div key={year} className="mb-5 last:mb-0">
                        <p className="text-[13px] font-medium text-[#6b6560] mb-2">
                          {year}{gradeLevel ? ` · Grade ${gradeLevel}` : ""}
                        </p>
                        <div className="space-y-1.5">
                          {yearCourses.map(course => {
                            const badge = subjectBadgeColor(course.subject_category);
                            const isFromPlan = !!course.curriculum_goal_id;
                            const needsGrade = isFromPlan && !course.grade_letter;
                            return (
                              <button key={course.id} type="button" onClick={() => openEditCourse(course)}
                                className="w-full text-left rounded-xl px-3.5 py-2.5 hover:bg-[#faf8f4] transition-colors border border-[#f0ece6]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[14px] font-medium text-[#3c3a37] flex-1 min-w-0 truncate">{course.course_name}</span>
                                  {isFromPlan && (
                                    <span className="text-[10px] text-[#8b8680] bg-[#f5f3f0] rounded px-1.5 py-0.5 shrink-0">From Plan</span>
                                  )}
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-md shrink-0" style={{ background: badge.bg, color: badge.text }}>
                                    {subjectLabel(course.subject_category)}
                                  </span>
                                  {course.credit_type !== "standard" && (
                                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#fef3c7] text-[#92400e] shrink-0">
                                      {CREDIT_TYPES.find(t => t.value === course.credit_type)?.label}
                                    </span>
                                  )}
                                  <span className="text-[12px] text-[#8a8580] shrink-0 w-12 text-right">{course.credits_earned} cr</span>
                                  {needsGrade
                                    ? <span className="text-[11px] text-amber-600 font-medium shrink-0">Needs grade</span>
                                    : <span className="text-[13px] font-medium text-[#3c3a37] shrink-0 w-8 text-right">{course.grade_letter || "—"}</span>
                                  }
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" onClick={openAddCourse}
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#2D5A3D] hover:opacity-80 transition-opacity">
                    <Plus size={16} /> Add course
                  </button>
                </>
              )}
            </div>
          )}

          {/* ─── Tab: GPA & Summary ─────────────────────────────────────── */}
          {tab === "gpa" && (
            <div className="p-4">
              {courses.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[15px] font-medium text-[#3c3a37] mb-1">Add courses first</p>
                  <p className="text-[13px] text-[#8a8580]">GPA will calculate automatically once you add courses with grades.</p>
                </div>
              ) : (
                <>
                  {/* GPA cards */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="rounded-xl p-4 text-center" style={{ background: "linear-gradient(135deg, #f0faf3, #e8f5ec)", border: "1.5px solid #cef0d4" }}>
                      <p className="text-[11px] font-medium text-[#6b6560] uppercase tracking-wide mb-1">Unweighted GPA</p>
                      <p className="text-[28px] font-bold text-[#2D5A3D]">{unweightedGPA?.toFixed(2) ?? "—"}</p>
                    </div>
                    {settings.use_weighted_gpa && (
                      <div className="rounded-xl p-4 text-center" style={{ background: "linear-gradient(135deg, #f0faf3, #e8f5ec)", border: "1.5px solid #cef0d4" }}>
                        <p className="text-[11px] font-medium text-[#6b6560] uppercase tracking-wide mb-1">Weighted GPA</p>
                        <p className="text-[28px] font-bold text-[#2D5A3D]">{weightedGPA?.toFixed(2) ?? "—"}</p>
                      </div>
                    )}
                    <div className={`rounded-xl p-4 text-center ${settings.use_weighted_gpa ? "col-span-2" : ""}`} style={{ background: "#faf8f4", border: "1.5px solid #e8e2d9" }}>
                      <p className="text-[11px] font-medium text-[#6b6560] uppercase tracking-wide mb-1">Total credits</p>
                      <p className="text-[28px] font-bold text-[#3c3a37]">{totalCredits}</p>
                    </div>
                  </div>

                  {/* Yearly breakdown */}
                  <div className="mb-5">
                    <p className="text-[13px] font-medium text-[#6b6560] mb-2">Yearly breakdown</p>
                    <div className="rounded-xl border border-[#f0ece6] overflow-hidden">
                      <div className="grid grid-cols-4 gap-2 px-3.5 py-2 bg-[#faf8f4] text-[11px] font-medium text-[#8a8580] uppercase tracking-wide">
                        <span>Year</span>
                        <span className="text-right">Credits</span>
                        <span className="text-right">GPA</span>
                        {settings.use_weighted_gpa && <span className="text-right">Weighted</span>}
                      </div>
                      {sortedYears.map(year => {
                        const yc = coursesByYear[year];
                        const ycGpa = yc.map(c => ({ grade_letter: c.grade_letter, credits_earned: c.credits_earned, credit_type: c.credit_type }));
                        const yCreds = yc.reduce((s, c) => s + (c.credits_earned || 0), 0);
                        return (
                          <div key={year} className="grid grid-cols-4 gap-2 px-3.5 py-2.5 border-t border-[#f0ece6] text-[13px]">
                            <span className="text-[#3c3a37] font-medium">{year}</span>
                            <span className="text-right text-[#6b6560]">{yCreds}</span>
                            <span className="text-right text-[#3c3a37] font-medium">{calculateGPA(ycGpa, false)?.toFixed(2) ?? "—"}</span>
                            {settings.use_weighted_gpa && <span className="text-right text-[#3c3a37] font-medium">{calculateGPA(ycGpa, true)?.toFixed(2) ?? "—"}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Credits by subject */}
                  <div>
                    <p className="text-[13px] font-medium text-[#6b6560] mb-2">Credits by subject</p>
                    <div className="grid grid-cols-2 gap-2">
                      {SUBJECT_CATEGORIES.filter(cat => creditsBySubject[cat.value]).map(cat => {
                        const earned = creditsBySubject[cat.value] || 0;
                        const target = COLLEGE_READY_TARGETS[cat.value];
                        const met = target ? earned >= target : false;
                        const badge = subjectBadgeColor(cat.value);
                        return (
                          <div key={cat.value} className="flex items-center gap-2 rounded-lg px-3 py-2 border border-[#f0ece6]">
                            <span className="text-[12px] font-medium px-1.5 py-0.5 rounded" style={{ background: badge.bg, color: badge.text }}>{cat.label}</span>
                            <span className="text-[14px] font-medium text-[#3c3a37] ml-auto">{earned}</span>
                            {target && (
                              met
                                ? <Check size={14} className="text-[#2D5A3D]" />
                                : <span className="text-[10px] text-[#8a8580]">/{target}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Tab: Preview ───────────────────────────────────────────── */}
          {tab === "preview" && (
            <div className="p-4">
              {courses.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[15px] font-medium text-[#3c3a37] mb-1">Nothing to preview yet</p>
                  <p className="text-[13px] text-[#8a8580]">Add courses to see a transcript preview.</p>
                </div>
              ) : (
                <>
                  {/* Print-ready layout */}
                  <div className="border border-[#e8e2d9] rounded-xl p-6 bg-white text-[#3c3a37]">
                    <div className="text-center mb-5 pb-4 border-b border-[#e8e2d9]">
                      <p className="text-[18px] font-bold" style={{ fontFamily: "var(--font-display)" }}>{settings.school_name || "Home School"}</p>
                      <p className="text-[13px] text-[#6b6560] mt-0.5">Official Transcript</p>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] mb-5">
                      <div><span className="text-[#8a8580]">Student:</span> <span className="font-medium">{child.name}</span></div>
                      {settings.graduation_year && <div><span className="text-[#8a8580]">Graduation:</span> <span className="font-medium">{settings.graduation_year}</span></div>}
                      {settings.state && <div><span className="text-[#8a8580]">State:</span> <span className="font-medium">{STATE_REQUIREMENTS[settings.state]?.name}</span></div>}
                      {settings.principal_name && <div><span className="text-[#8a8580]">Administrator:</span> <span className="font-medium">{settings.principal_name}</span></div>}
                    </div>

                    {sortedYears.map(year => {
                      const yc = coursesByYear[year];
                      const gradeLevel = yc.find(c => c.grade_level)?.grade_level;
                      return (
                        <div key={year} className="mb-4">
                          <p className="text-[13px] font-bold text-[#2D5A3D] mb-1.5">{year}{gradeLevel ? ` — Grade ${gradeLevel}` : ""}</p>
                          <div className="rounded-lg border border-[#f0ece6] overflow-hidden text-[12px]">
                            <div className="grid grid-cols-12 gap-1 px-3 py-1.5 bg-[#faf8f4] font-medium text-[#8a8580]">
                              <span className="col-span-5">Course</span>
                              <span className="col-span-3">Category</span>
                              <span className="col-span-2 text-right">Credits</span>
                              <span className="col-span-2 text-right">Grade</span>
                            </div>
                            {yc.map(c => (
                              <div key={c.id} className="grid grid-cols-12 gap-1 px-3 py-1.5 border-t border-[#f0ece6]">
                                <span className="col-span-5 truncate">{c.course_name}</span>
                                <span className="col-span-3 text-[#6b6560] truncate">{subjectLabel(c.subject_category)}</span>
                                <span className="col-span-2 text-right">{c.credits_earned}</span>
                                <span className="col-span-2 text-right font-medium">{c.grade_letter || "—"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Footer */}
                    <div className="border-t border-[#e8e2d9] pt-4 mt-4 grid grid-cols-3 gap-4 text-[12px]">
                      <div>
                        <span className="text-[#8a8580]">Cumulative GPA:</span>
                        <span className="font-bold ml-1">{unweightedGPA?.toFixed(2) ?? "—"}</span>
                        {settings.use_weighted_gpa && weightedGPA && <span className="text-[#8a8580] ml-1">(W: {weightedGPA.toFixed(2)})</span>}
                      </div>
                      <div><span className="text-[#8a8580]">Total credits:</span> <span className="font-bold ml-1">{totalCredits}</span></div>
                    </div>

                    <div className="mt-8 pt-4 border-t border-[#e8e2d9] grid grid-cols-2 gap-8 text-[11px] text-[#8a8580]">
                      <div>
                        <div className="border-b border-[#c8bfb5] mb-1 pb-6" />
                        <p>{settings.principal_name || "Administrator"}, Administrator</p>
                      </div>
                      <div>
                        <div className="border-b border-[#c8bfb5] mb-1 pb-6" />
                        <p>Date</p>
                      </div>
                    </div>
                  </div>

                  <button type="button" onClick={() => showToast("PDF export coming soon!")}
                    className="mt-4 w-full bg-[#2D5A3D] text-white text-[13px] font-medium py-3 rounded-xl hover:opacity-90 transition-opacity">
                    Export PDF
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Course modal ──────────────────────────────────────────────────── */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={closeModal} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[16px] font-medium text-[#3c3a37]">{editingCourse ? "Edit course" : "Add course"}</h3>
                <button type="button" onClick={closeModal} className="w-8 h-8 rounded-full bg-[#f0ece6] flex items-center justify-center hover:bg-[#e8e2d9] transition-colors">
                  <X size={16} className="text-[#6b6560]" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Course name */}
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Course name *</label>
                  <input type="text" value={form.course_name} onChange={e => updateForm("course_name", e.target.value)}
                    placeholder="e.g. Algebra I"
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                </div>

                {/* Year + Grade level */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">School year</label>
                    <select value={form.school_year} onChange={e => updateForm("school_year", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      {getSchoolYearOptions().map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Grade level</label>
                    <select value={form.grade_level || ""} onChange={e => updateForm("grade_level", e.target.value || null)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      <option value="">—</option>
                      {["9", "10", "11", "12"].map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>

                {/* Subject + Credit type */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Subject category</label>
                    <select value={form.subject_category} onChange={e => updateForm("subject_category", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      {SUBJECT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Credit type</label>
                    <select value={form.credit_type} onChange={e => updateForm("credit_type", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      {CREDIT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Credits + Semester */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Credits earned</label>
                    <input type="number" step="0.5" min="0" max="10" value={form.credits_earned} onChange={e => updateForm("credits_earned", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Semester</label>
                    <select value={form.semester} onChange={e => updateForm("semester", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      {SEMESTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Grade letter */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Grade</label>
                    <select value={form.grade_letter || ""} onChange={e => updateForm("grade_letter", e.target.value || null)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      <option value="">No grade yet</option>
                      {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g} ({GRADE_POINTS[g]})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Hours logged</label>
                    <input type="number" min="0" value={form.hours_logged ?? ""} onChange={e => updateForm("hours_logged", e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                  </div>
                </div>

                {/* Link to curriculum goal */}
                {goals.length > 0 && (
                  <div>
                    <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Link to curriculum</label>
                    <select value={form.curriculum_goal_id || ""} onChange={e => updateForm("curriculum_goal_id", e.target.value || null)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                      <option value="">None</option>
                      {goals.map(g => <option key={g.id} value={g.id}>{g.icon_emoji ? `${g.icon_emoji} ` : ""}{g.curriculum_name}</option>)}
                    </select>
                    {form.curriculum_goal_id && <p className="text-[11px] text-[#8a8580] mt-1">Hours will auto-calculate from logged lessons</p>}
                  </div>
                )}

                {/* Course description */}
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Course description</label>
                  <textarea value={form.course_description || ""} onChange={e => updateForm("course_description", e.target.value)}
                    placeholder="Optional — helpful for college applications"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                </div>

                {/* External */}
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => updateForm("is_external", !form.is_external)}
                    className={`w-10 h-6 rounded-full relative transition-colors ${form.is_external ? "bg-[#2D5A3D]" : "bg-[#e8e2d9]"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.is_external ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                  <span className="text-[13px] text-[#3c3a37]">External course (co-op, online, etc.)</span>
                </div>
                {form.is_external && (
                  <input type="text" value={form.external_provider || ""} onChange={e => updateForm("external_provider", e.target.value)}
                    placeholder="Provider name (e.g. Khan Academy)"
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 mt-5">
                <button type="button" onClick={saveCourse} disabled={formSaving || !form.course_name.trim()}
                  className="flex-1 bg-[#2D5A3D] text-white text-[14px] font-medium py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60">
                  {formSaving ? "Saving..." : editingCourse ? "Update course" : "Add course"}
                </button>
                {editingCourse && (
                  deleteConfirm ? (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={deleteCourse} className="text-[12px] font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">Delete</button>
                      <button type="button" onClick={() => setDeleteConfirm(false)} className="text-[12px] text-[#6b6560] px-2 py-2">Cancel</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setDeleteConfirm(true)}
                      className="w-11 h-11 rounded-xl border border-red-200 flex items-center justify-center hover:bg-red-50 transition-colors">
                      <Trash2 size={16} className="text-red-400" />
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <div className="bg-[#1a2c22] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">{toast}</div>
        </div>
      )}
    </>
  );
}
