"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ChevronLeft, ChevronDown, ChevronUp, X, Check, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHero from "@/app/components/PageHero";
import { SUBJECT_CATEGORIES, GRADE_OPTIONS, SEMESTERS, getSchoolYearOptions } from "@/lib/transcript/constants";
import { calculateGPA, getCreditsBySubject, COLLEGE_READY_TARGETS, GRADE_POINTS } from "@/lib/transcript/gpa";
import { STATE_REQUIREMENTS, resolveStateCode } from "@/lib/transcript/state-requirements";
import { getUserAccess, canExport } from "@/lib/user-access";
import PreviewWatermark from "@/app/components/PreviewWatermark";
import ExportGateModal from "@/app/components/ExportGateModal";
import { jsPDF } from "jspdf";

// ─── Types ──────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday: string | null };

type Settings = {
  id?: string;
  school_name: string | null;
  state: string | null;
  graduation_year: number | null;
  use_weighted_gpa: boolean;
  principal_name: string | null;
  include_notary: boolean;
  show_institution_per_row: boolean;
};

type Course = {
  id: string;
  school_year: string;
  grade_level: string | null;
  course_name: string;
  subject_category: string;
  credit_type: string;
  course_level: string;
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

type CurriculumGoal = { id: string; curriculum_name: string; icon_emoji: string | null; subject_label: string | null; school_year: string | null; default_minutes: number; course_level: string | null; credits_value: number | null };

type Tab = "courses" | "transcript" | "gpa";

const EMPTY_COURSE: Omit<Course, "id"> = {
  school_year: "",
  grade_level: null,
  course_name: "",
  subject_category: "other",
  credit_type: "standard",
  course_level: "standard",
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
  const [settings, setSettings] = useState<Settings>({ school_name: null, state: null, graduation_year: null, use_weighted_gpa: false, principal_name: null, include_notary: false, show_institution_per_row: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [stateAutoDetected, setStateAutoDetected] = useState(false);
  const [showExportGate, setShowExportGate] = useState(false);
  const [profileAccess, setProfileAccess] = useState<{ is_pro?: boolean | null; trial_started_at?: string | null }>({});
  const [lastName, setLastName] = useState<string>("");

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

  function exportTranscriptPDF() {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 50;
    const contentW = pageW - margin * 2;
    let y = 50;

    const green = [45, 90, 61] as const;   // #2D5A3D
    const dark = [45, 41, 38] as const;     // #2d2926
    const muted = [138, 133, 128] as const; // #8a8580
    const lineColor = [232, 226, 217] as const; // #e8e2d9

    function checkPage(needed: number) {
      if (y + needed > doc.internal.pageSize.getHeight() - 50) {
        doc.addPage();
        y = 50;
      }
    }

    // ── Header ──────────────────────────────────────────────
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...dark);
    doc.text(settings.school_name || "Home School", pageW / 2, y, { align: "center" });
    y += 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...muted);
    doc.text("Official Transcript", pageW / 2, y, { align: "center" });
    y += 12;

    // Divider line
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 20;

    // ── Student info ────────────────────────────────────────
    doc.setFontSize(10);
    const infoLeft: [string, string][] = [];
    infoLeft.push(["Student:", [child?.name, lastName].filter(Boolean).join(" ") || ""]);
    if ((child as any)?.birthday) {
      const bday = new Date((child as any).birthday + "T00:00:00");
      infoLeft.push(["Date of Birth:", bday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
    }
    if (settings.state) {
      const stateName = STATE_REQUIREMENTS[settings.state]?.name || settings.state;
      infoLeft.push(["State:", stateName]);
    }
    const infoRight: [string, string][] = [];
    if (settings.graduation_year) infoRight.push(["Graduation:", String(settings.graduation_year)]);
    infoRight.push(["Date Issued:", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
    if (settings.principal_name) infoRight.push(["Administrator:", settings.principal_name]);

    const infoRowH = 14;
    const maxRows = Math.max(infoLeft.length, infoRight.length);
    for (let i = 0; i < maxRows; i++) {
      if (infoLeft[i]) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...muted);
        doc.text(infoLeft[i][0], margin, y);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...dark);
        doc.text(infoLeft[i][1], margin + 60, y);
      }
      if (infoRight[i]) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...muted);
        doc.text(infoRight[i][0], pageW / 2 + 20, y);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...dark);
        doc.text(infoRight[i][1], pageW / 2 + 95, y);
      }
      y += infoRowH;
    }
    y += 10;

    // ── Courses by year ─────────────────────────────────────
    const colX = {
      course: margin,
      category: margin + contentW * 0.32,
      credits: margin + contentW * 0.68,
      grade: margin + contentW * 0.85,
    };
    const rowH = 16;

    for (const year of gradedSortedYears) {
      const yc = gradedByYear[year];
      const gradeLevel = yc.find((c: Course) => c.grade_level)?.grade_level;
      const yearLabel = year + (gradeLevel ? ` — Grade ${gradeLevel}` : "");

      // Check if we need a new page (header + at least 2 rows)
      checkPage(rowH * (yc.length + 3));

      // Year header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...green);
      doc.text(yearLabel, margin, y);
      y += 16;

      // Table header
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...muted);
      doc.setFillColor(250, 248, 244);
      doc.rect(margin, y - 10, contentW, rowH, "F");
      doc.text("Course", colX.course, y);
      doc.text("Category", colX.category, y);
      doc.text("Credits", colX.credits + 30, y, { align: "right" });
      doc.text("Grade", colX.grade + 30, y, { align: "right" });
      y += rowH;

      // Rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const c of yc) {
        const institutionToShow = settings.show_institution_per_row
          ? (c.external_provider || settings.school_name || null)
          : (c.external_provider || null);
        const providerExtra = institutionToShow ? 10 : 0;
        checkPage(rowH + 4 + providerExtra);

        // Light border line
        doc.setDrawColor(...lineColor);
        doc.setLineWidth(0.3);
        doc.line(margin, y - 10, margin + contentW, y - 10);

        doc.setTextColor(...dark);
        // Truncate long course names
        const courseName = c.course_name.length > 28 ? c.course_name.slice(0, 26) + "…" : c.course_name;
        doc.text(courseName, colX.course, y);

        // Course level label
        const level = (c as any).course_level || "standard";
        if (level !== "standard") {
          const levelLabels: Record<string, string> = {
            honors: "H",
            ap: "AP",
            dual_enrollment: "DE",
          };
          const badge = levelLabels[level] || "";
          if (badge) {
            const nameWidth = doc.getTextWidth(courseName);
            doc.setFontSize(7);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(...green);
            doc.text(badge, colX.course + nameWidth + 4, y);
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
          }
        }

        doc.setTextColor(107, 101, 96); // #6b6560
        const catLabel = subjectLabel(c.subject_category);
        const catTrunc = catLabel.length > 30 ? catLabel.slice(0, 28) + "…" : catLabel;
        doc.text(catTrunc, colX.category, y);

        doc.setTextColor(...dark);
        doc.text(String(c.credits_earned), colX.credits + 30, y, { align: "right" });
        doc.setFont("helvetica", "bold");
        doc.text(c.grade_letter || "—", colX.grade + 30, y, { align: "right" });
        doc.setFont("helvetica", "normal");

        // Optional institution sub-line: italic, one size smaller than course name
        if (institutionToShow) {
          const provider = institutionToShow.length > 45 ? institutionToShow.slice(0, 43) + "…" : institutionToShow;
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(provider, colX.course, y + 10);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
        }
        y += rowH + providerExtra;
      }
      y += 12;
    }

    // ── GPA & Credits summary ───────────────────────────────
    checkPage(60);
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 20;

    doc.setFontSize(10);
    doc.setTextColor(...muted);
    doc.text("Cumulative GPA:", margin, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    const gpaStr = unweightedGPA?.toFixed(2) ?? "—";
    doc.text(gpaStr, margin + 90, y);
    if (settings.use_weighted_gpa && weightedGPA) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      doc.text(`(Weighted: ${weightedGPA.toFixed(2)})`, margin + 120, y);
    }

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...muted);
    doc.text("Total credits:", pageW / 2 + 20, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text(String(gradedTotalCredits), pageW / 2 + 90, y);
    y += 40;

    // ── Grading Scale Key ───────────────────────────────────
    checkPage(50);
    y += 5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...muted);
    doc.text("Grading Scale:", margin, y);
    doc.setFont("helvetica", "normal");
    const scaleText = "A = 4.0   B = 3.0   C = 2.0   D = 1.0   F = 0.0";
    doc.text(scaleText, margin + 65, y);
    if (settings.use_weighted_gpa) {
      y += 11;
      doc.text("Weighted: Honors +0.5   AP/Dual Enrollment +1.0", margin + 65, y);
    }
    y += 15;

    // ── Signature lines ─────────────────────────────────────
    checkPage(80);
    doc.setDrawColor(200, 191, 181); // #c8bfb5
    doc.setLineWidth(0.5);
    const sigW = contentW * 0.4;

    // Left signature
    doc.line(margin, y, margin + sigW, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(`${settings.principal_name || "Administrator"}, Administrator`, margin, y);

    // Right signature
    const rightSigX = pageW - margin - sigW;
    doc.line(rightSigX, y - 12, pageW - margin, y - 12);
    doc.text("Date", rightSigX, y);

    // ── Notary block (optional) ─────────────────────────────
    if (settings.include_notary) {
      y += 30;
      checkPage(120);

      // Notary header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.text("Notary Certification", margin, y);
      y += 16;

      // Notary text
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      const notaryText = `I certify that ${settings.principal_name || "the administrator"} personally appeared before me and affirmed that the information contained in this transcript is true and accurate to the best of their knowledge.`;
      const notaryLines = doc.splitTextToSize(notaryText, contentW);
      doc.text(notaryLines, margin, y);
      y += notaryLines.length * 12 + 20;

      // Notary signature line
      doc.setDrawColor(200, 191, 181);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + sigW, y);
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...muted);
      doc.text("Notary Public Signature", margin, y);

      // Commission expiration
      const rightX = pageW - margin - sigW;
      doc.line(rightX, y - 12, pageW - margin, y - 12);
      doc.text("Commission Expiration Date", rightX, y);

      y += 25;

      // Seal area
      doc.setDrawColor(200, 191, 181);
      doc.setLineWidth(0.3);
      const sealSize = 60;
      const sealX = margin;
      doc.rect(sealX, y, sealSize, sealSize);
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("(Notary Seal)", sealX + sealSize / 2, y + sealSize / 2 + 3, { align: "center" });

      // State and county lines next to seal
      const labelX = sealX + sealSize + 20;
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      doc.setFont("helvetica", "normal");
      doc.text("State of: _______________________", labelX, y + 15);
      doc.text("County of: ______________________", labelX, y + 30);
      doc.text("Date: ___________________________", labelX, y + 45);

      y += sealSize + 10;
    }

    // ── Footer ──────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(
        `Generated by Rooted • rootedhomeschoolapp.com`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 25,
        { align: "center" }
      );
    }

    // ── Save ────────────────────────────────────────────────
    const safeName = ([child?.name, lastName].filter(Boolean).join(" ") || "student").replace(/[^a-zA-Z0-9]/g, "_");
    doc.save(`${safeName}_transcript.pdf`);
  }

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
        credit_type: goal.course_level && goal.course_level !== "standard" ? goal.course_level : "standard",
        course_level: goal.course_level || "standard",
        credits_earned: goal.credits_value != null ? goal.credits_value : credits,
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
    // Re-fetch goals so wizard-edited course_level / credits_value show up
    const { data: freshGoals } = await supabase
      .from("curriculum_goals")
      .select("id, curriculum_name, icon_emoji, subject_label, school_year, default_minutes, course_level, credits_value")
      .eq("user_id", userId)
      .eq("child_id", childId);
    const goalsList = (freshGoals ?? []) as CurriculumGoal[];
    setGoals(goalsList);
    const count = await syncCoursesFromPlan(userId, childId, courses, goalsList);
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
      supabase.from("children").select("id, name, color, birthday").eq("id", childId).maybeSingle(),
      supabase.from("transcript_settings").select("*").eq("user_id", user.id).eq("child_id", childId).maybeSingle(),
      supabase.from("transcript_courses").select("*").eq("user_id", user.id).eq("child_id", childId).order("school_year", { ascending: false }).order("course_name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, icon_emoji, subject_label, school_year, default_minutes, course_level, credits_value").eq("user_id", user.id).eq("child_id", childId),
      supabase.from("profiles").select("display_name, first_name, last_name, state, is_pro, trial_started_at").eq("id", user.id).maybeSingle(),
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

    // Always set profile access (controls watermark + export gate)
    setProfileAccess({ is_pro: (profile as any)?.is_pro, trial_started_at: (profile as any)?.trial_started_at });
    setLastName(((profile as any)?.last_name ?? "") as string);

    if (settingsData) {
      setSettings({
        id: settingsData.id,
        school_name: settingsData.school_name,
        state: settingsData.state,
        graduation_year: settingsData.graduation_year,
        use_weighted_gpa: settingsData.use_weighted_gpa ?? false,
        principal_name: settingsData.principal_name,
        include_notary: settingsData.include_notary ?? false,
        show_institution_per_row: (settingsData as any).show_institution_per_row ?? false,
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
  useEffect(() => {
    if (!child) return;
    const full = [child.name, lastName].filter(Boolean).join(" ");
    document.title = `${full}'s Transcript · Rooted`;
  }, [child, lastName]);

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
      include_notary: settings.include_notary,
      show_institution_per_row: settings.show_institution_per_row,
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
    setForm({ ...course, course_level: course.course_level || "standard" });
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

    const derivedCreditType = (() => {
      switch (form.course_level) {
        case "honors": return "honors";
        case "ap": return "ap";
        case "dual_enrollment": return "dual_enrollment";
        default: return "standard";
      }
    })();

    const payload = {
      user_id: userId,
      child_id: childId,
      school_year: form.school_year,
      grade_level: form.grade_level || null,
      course_name: form.course_name.trim(),
      subject_category: form.subject_category,
      credit_type: derivedCreditType,
      course_level: form.course_level || "standard",
      credits_earned: form.credits_earned,
      hours_logged: form.hours_logged,
      grade_letter: form.grade_letter || null,
      grade_points: form.grade_points,
      semester: form.semester,
      course_description: form.course_description?.trim() || null,
      curriculum_goal_id: form.curriculum_goal_id || null,
      is_external: !!form.external_provider?.trim(),
      external_provider: form.external_provider?.trim() || null,
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

  // Graded subset — used by the Transcript tab and PDF export
  const gradedCourses = courses.filter(c => !!c.grade_letter);
  const inProgressCount = courses.length - gradedCourses.length;
  const gradedByYear = gradedCourses.reduce<Record<string, Course[]>>((acc, c) => {
    (acc[c.school_year] = acc[c.school_year] || []).push(c);
    return acc;
  }, {});
  const gradedSortedYears = Object.keys(gradedByYear).sort();
  const gradedTotalCredits = gradedCourses.reduce((sum, c) => sum + (c.credits_earned || 0), 0);

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
    { key: "transcript", label: "Transcript" },
    { key: "gpa", label: "GPA" },
  ];

  return (
    <>
      <PageHero overline="Transcripts" title={`${[child.name, lastName].filter(Boolean).join(" ")}'s Transcript`} subtitle={settings.school_name || undefined} />

      <div className="max-w-2xl mx-auto px-5 pt-4 pb-10">
        {/* Back link + settings gear */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/dashboard/transcript" className="inline-flex items-center gap-1 text-[13px] text-[#8a8580] hover:text-[#3c3a37] transition-colors">
            <ChevronLeft size={14} /> All transcripts
          </Link>
          <button type="button" onClick={() => setSettingsOpen(!settingsOpen)}
            className="inline-flex items-center gap-1.5 text-[13px] text-[#8a8580] hover:text-[#3c3a37] transition-colors"
            aria-label="Transcript settings">
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </div>

        {/* Settings panel (gear-triggered) */}
        {settingsOpen && (
          <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div className="px-5 py-5 space-y-3">
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

              {/* Notary block */}
              <div className="flex items-center justify-between py-3 border-t border-[#e8e2d9]">
                <div>
                  <p className="text-[13px] font-medium text-[#3c3a37]">Include notary block</p>
                  <p className="text-[11px] text-[#8a8580]">Adds a notary certification section to the PDF — useful for college applications</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettings(prev => ({ ...prev, include_notary: !prev.include_notary }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.include_notary ? "bg-[#2D5A3D]" : "bg-[#d5d0ca]"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    settings.include_notary ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`} />
                </button>
              </div>

              {/* Show institution on every course */}
              <div className="flex items-center justify-between py-3 border-t border-[#e8e2d9]">
                <div>
                  <p className="text-[13px] font-medium text-[#3c3a37]">Show institution on every course</p>
                  <p className="text-[11px] text-[#8a8580]">Helpful for transcripts with mixed home and outside courses — labels every row instead of only exceptions.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettings(prev => ({ ...prev, show_institution_per_row: !prev.show_institution_per_row }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settings.show_institution_per_row ? "bg-[#2D5A3D]" : "bg-[#d5d0ca]"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    settings.show_institution_per_row ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`} />
                </button>
              </div>

              <button type="button" onClick={saveSettings} disabled={settingsSaving}
                className="bg-[#2D5A3D] text-white text-[13px] font-medium px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60">
                {settingsSaving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </div>
        )}

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
                            const isFromPlan = !!course.curriculum_goal_id;
                            const inProgress = !course.grade_letter;
                            return (
                              <button key={course.id} type="button" onClick={() => openEditCourse(course)}
                                className="w-full text-left flex items-center gap-2 px-3.5 py-2.5 hover:bg-[#faf8f4] transition-colors rounded-xl border border-[#f0ece6]">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[14px] font-medium text-[#3c3a37] truncate">{course.course_name}</span>
                                    {course.course_level && course.course_level !== "standard" && (
                                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e8f0e9] text-[#2D5A3D]">
                                        {course.course_level === "ap" ? "AP" : course.course_level === "honors" ? "Honors" : "DE"}
                                      </span>
                                    )}
                                    {inProgress && (
                                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fef9ec] text-[#b58a30]">In Progress</span>
                                    )}
                                    {isFromPlan && (
                                      <span className="text-[10px] text-[#8b8680] bg-[#f5f3f0] rounded px-1.5 py-0.5">From Plan</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[#8a8580] mt-0.5 truncate">{subjectLabel(course.subject_category)}</div>
                                  {(() => {
                                    const inst = settings.show_institution_per_row
                                      ? (course.external_provider || settings.school_name || null)
                                      : (course.external_provider || null);
                                    return inst ? (
                                      <div className="text-[11px] text-[#8a8580] mt-0.5 truncate">📍 {inst}</div>
                                    ) : null;
                                  })()}
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-[13px] font-medium text-[#3c3a37]">{course.grade_letter || "—"}</div>
                                  <div className="text-[10px] text-[#8a8580]">{course.credits_earned} cr</div>
                                </div>
                                <span className="text-[#c8bfb5] text-[14px] shrink-0">›</span>
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

          {/* ─── Tab: Transcript ────────────────────────────────────────── */}
          {tab === "transcript" && (
            <div className="p-4">
              {gradedCourses.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[15px] font-medium text-[#3c3a37] mb-1">No graded courses yet</p>
                  <p className="text-[13px] text-[#8a8580]">
                    {courses.length === 0
                      ? "Add courses and grade them to see your transcript."
                      : `${inProgressCount} course${inProgressCount === 1 ? "" : "s"} in progress. Grade them on the Courses tab to see them here.`}
                  </p>
                </div>
              ) : (
                <>
                  {/* Print-ready layout */}
                  <div className="border border-[#e8e2d9] rounded-xl p-6 bg-white text-[#3c3a37] relative">
                    {getUserAccess(profileAccess) === 'free' && <PreviewWatermark />}
                    <div className="text-center mb-5 pb-4 border-b border-[#e8e2d9]">
                      <p className="text-[18px] font-bold" style={{ fontFamily: "var(--font-display)" }}>{settings.school_name || "Home School"}</p>
                      <p className="text-[13px] text-[#6b6560] mt-0.5">Official Transcript</p>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] mb-5">
                      <div><span className="text-[#8a8580]">Student:</span> <span className="font-medium">{[child.name, lastName].filter(Boolean).join(" ")}</span></div>
                      {child.birthday && (
                        <div><span className="text-[#8a8580]">Date of Birth:</span> <span className="font-medium">{new Date(child.birthday + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
                      )}
                      {settings.graduation_year && <div><span className="text-[#8a8580]">Graduation:</span> <span className="font-medium">{settings.graduation_year}</span></div>}
                      <div><span className="text-[#8a8580]">Date Issued:</span> <span className="font-medium">{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
                      {settings.state && <div><span className="text-[#8a8580]">State:</span> <span className="font-medium">{STATE_REQUIREMENTS[settings.state]?.name}</span></div>}
                      {settings.principal_name && <div><span className="text-[#8a8580]">Administrator:</span> <span className="font-medium">{settings.principal_name}</span></div>}
                    </div>

                    {gradedSortedYears.map(year => {
                      const yc = gradedByYear[year];
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
                              <div key={c.id} className="grid grid-cols-12 gap-1 px-3 py-1.5 border-t border-[#f0ece6] items-start">
                                <div className="col-span-5 min-w-0">
                                  <div className="truncate">
                                    {c.course_name}
                                    {(() => {
                                      const level = (c as any).course_level || "standard";
                                      if (level === "standard") return null;
                                      const labels: Record<string, string> = { honors: "H", ap: "AP", dual_enrollment: "DE" };
                                      return <span className="ml-1 text-[10px] font-bold text-white bg-[#2D5A3D] rounded px-1 py-0.5 inline-block leading-none">{labels[level] || ""}</span>;
                                    })()}
                                  </div>
                                  {(() => {
                                    const inst = settings.show_institution_per_row
                                      ? (c.external_provider || settings.school_name || null)
                                      : (c.external_provider || null);
                                    return inst ? (
                                      <div className="text-[10px] italic text-[#8a8580] truncate mt-0.5">{inst}</div>
                                    ) : null;
                                  })()}
                                </div>
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
                      <div><span className="text-[#8a8580]">Total credits:</span> <span className="font-bold ml-1">{gradedTotalCredits}</span></div>
                    </div>

                    <div className="text-[11px] text-[#8a8580] mb-8">
                      <span className="font-medium">Grading Scale:</span>{" "}
                      A = 4.0 &nbsp; B = 3.0 &nbsp; C = 2.0 &nbsp; D = 1.0 &nbsp; F = 0.0
                      {settings.use_weighted_gpa && (
                        <span className="ml-3">| Weighted: Honors +0.5, AP/DE +1.0</span>
                      )}
                    </div>

                    <div className="mt-12 pt-4 border-t border-[#e8e2d9] grid grid-cols-2 gap-8 text-[11px] text-[#8a8580]">
                      <div>
                        <div className="border-b border-[#c8bfb5] mb-1 pb-6" />
                        <p>{settings.principal_name || "Administrator"}, Administrator</p>
                      </div>
                      <div>
                        <div className="border-b border-[#c8bfb5] mb-1 pb-6" />
                        <p>Date</p>
                      </div>
                    </div>

                    {settings.include_notary && (
                      <div className="mt-6 pt-4 border-t border-[#e8e2d9] text-[11px] text-[#8a8580]">
                        <p className="font-medium text-[#3c3a37] mb-2">Notary Certification</p>
                        <p className="mb-4">State of __________ &nbsp; County of __________</p>
                        <p className="mb-4">Subscribed and sworn to before me this ______ day of ____________, 20____.</p>
                        <div className="mt-6">
                          <div className="border-b border-[#c8bfb5] mb-1 pb-6 w-2/3" />
                          <p>Notary Public &nbsp;&nbsp; My commission expires: __________</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {inProgressCount > 0 && (
                    <div className="mt-3 px-4 py-2.5 rounded-xl bg-[#fef9ec] border border-[#f5ecd0] text-[12px] text-[#8a7a50]">
                      {inProgressCount} course{inProgressCount === 1 ? "" : "s"} in progress — {inProgressCount === 1 ? "it" : "they"}&apos;ll appear here once graded.
                    </div>
                  )}

                  <button type="button" onClick={() => {
                    if (!canExport(profileAccess)) { setShowExportGate(true); return; }
                    exportTranscriptPDF();
                  }}
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

                {/* Institution (optional — leave blank for home school) */}
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Institution</label>
                  <input type="text" value={form.external_provider || ""} onChange={e => updateForm("external_provider", e.target.value)}
                    placeholder="e.g. Riverside High School — leave blank if home school"
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]" />
                  <p className="text-[11px] text-[#8a8580] mt-1">Use this for courses taken at a different school, co-op, or online provider. The homeschool name on your transcript is used when this is blank.</p>
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

                {/* Subject category */}
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Subject category</label>
                  <select value={form.subject_category} onChange={e => updateForm("subject_category", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                    {SUBJECT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                {/* Course level */}
                <div>
                  <label className="text-[12px] font-medium text-[#6b6560] block mb-1">Course level</label>
                  <select value={form.course_level || "standard"} onChange={e => updateForm("course_level", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] text-[14px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20 focus:border-[#2D5A3D]">
                    <option value="standard">Standard</option>
                    <option value="honors">Honors</option>
                    <option value="ap">AP (Advanced Placement)</option>
                    <option value="dual_enrollment">Dual Enrollment</option>
                  </select>
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

      {showExportGate && (
        <ExportGateModal
          title="Your transcript is ready"
          body="You've already done the hard part. Get a clean, official copy for your records."
          cta="Get My Transcript"
          onClose={() => setShowExportGate(false)}
        />
      )}
    </>
  );
}
