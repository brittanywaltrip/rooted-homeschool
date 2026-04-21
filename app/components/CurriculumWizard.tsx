"use client";

import { useState, useEffect } from "react";
import { X, BookOpen } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { posthog } from "@/lib/posthog";
import { onLogAction } from "@/app/lib/onLogAction";
import { recomputeCurrentLesson, healGoalIntegrity } from "@/app/lib/scheduler";

function titleCase(str: string): string {
  return str.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

export type CurriculumWizardEditData = {
  goalId?: string;           // undefined = create new goal for existing curriculum
  childId: string;
  curricName: string;
  subjectLabel: string | null;
  totalLessons: number;
  currentLesson: number;
  targetDate: string;
  schoolDays: string[];      // ['Mon', 'Tue', ...]
  isBackfilled?: boolean;
  startAtLesson?: number;
  lessonStartTime?: string | null;
  lessonsPerDay?: number;
};

interface Props {
  mode: "create" | "edit";
  editData?: CurriculumWizardEditData;
  initialChildId?: string;
  schoolYearId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  showToast?: (msg: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function guessEmoji(name: string): string {
  const n = name.toLowerCase();
  if (/math|algebra|geometry|calculus/.test(n)) return "📐";
  if (/language art|english|reading|writing|grammar|spelling|phonics|literature/.test(n)) return "📖";
  if (/science|biology|chemistry|physics|nature/.test(n)) return "🔬";
  if (/history|social stud|geography|civics|government/.test(n)) return "🌍";
  if (/\bart\b|drawing|painting|craft/.test(n)) return "🎨";
  if (/music|piano|guitar|violin|instrument/.test(n)) return "🎵";
  if (/\bpe\b|physical ed|sport|gym/.test(n)) return "⚽";
  if (/spanish|french|latin|german|foreign|language$/.test(n)) return "🗣️";
  if (/bible|religion|faith|theology/.test(n)) return "✝️";
  if (/computer|coding|tech|programming/.test(n)) return "💻";
  return "📚";
}

const SUBJECT_CHIPS = [
  { label: "Math",          bg: "#e4f0f4", text: "#1a4a5a" },
  { label: "Reading",       bg: "#f0e8f4", text: "#4a2a5a" },
  { label: "Language Arts", bg: "#ede8f4", text: "#3a2a6a" },
  { label: "Science",       bg: "#e8f0e9", text: "var(--g-deep)" },
  { label: "History",       bg: "#fef0e4", text: "#7a4a1a" },
  { label: "Art",           bg: "#fce8ec", text: "#7a2a36" },
  { label: "Other",         bg: "#f0ede8", text: "#5c5248" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isDateInBlocks(dateStr: string, blocks: { start_date: string; end_date: string }[]): boolean {
  return blocks.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
}

function daysToBoolean(days: string[]): boolean[] {
  return DAY_LABELS.map((d) => days.includes(d));
}

function booleanToDays(bools: boolean[]): string[] {
  const days = DAY_LABELS.filter((_, i) => bools[i]);
  return days.length > 0 ? days : ["Mon", "Tue", "Wed", "Thu", "Fri"];
}

/** Count school days between two dates (inclusive start, exclusive end). schoolDays uses DAY_LABELS Mon=0..Sun=6 index. */
function countSchoolDaysBetween(startDate: Date, endDate: Date, schoolDaysBool: boolean[]): number {
  let count = 0;
  const cursor = new Date(startDate);
  let safety = 0;
  while (cursor < endDate && safety < 3650) {
    const dayIdx = (cursor.getDay() + 6) % 7; // Mon=0..Sun=6
    if (schoolDaysBool[dayIdx]) count++;
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return count;
}

/** Get school year start (August 15). If today is before Aug 15, use previous year. */
function getSchoolYearStart(): string {
  const now = new Date();
  const year = now.getMonth() < 7 || (now.getMonth() === 7 && now.getDate() < 15)
    ? now.getFullYear() - 1
    : now.getFullYear();
  return `${year}-08-15`;
}

// ─── WizardProgress ───────────────────────────────────────────────────────────

function WizardProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 justify-center mb-2">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
            i + 1 <= step ? "bg-[#5c7f63] w-8" : "bg-[#e8e2d9] w-4"
          }`} />
        ))}
      </div>
      <p className="text-center text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4]">
        Step {step} of {total}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CurriculumWizard({
  mode,
  editData,
  initialChildId,
  schoolYearId,
  onClose,
  onSaved,
  showToast,
}: Props) {
  const { effectiveUserId } = usePartner();
  const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  // ── Children ──────────────────────────────────────────────────────────────
  const [children, setChildren] = useState<Child[]>([]);

  useEffect(() => { posthog.capture('curriculum_wizard_opened', { mode }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("children")
      .select("id, name, color")
      .eq("user_id", effectiveUserId)
      .eq("archived", false)
      .order("sort_order")
      .then(({ data }) => {
        const kids = (data as Child[]) ?? [];
        setChildren(kids);
        // Auto-advance past step 1 for single-child create
        if (mode === "create" && !initialChildId && !editData?.childId && kids.length === 1) {
          setChildId(kids[0].id);
          setStep(2);
        }
      });
  }, [effectiveUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(() => {
    if (mode === "edit") return 2;
    if (initialChildId || editData?.childId) return 2;
    return 1;
  });

  const [childId, setChildId] = useState(editData?.childId ?? initialChildId ?? "");

  const [curricName, setCurricName] = useState(editData?.curricName ?? "");

  const [subject, setSubject] = useState(() => {
    if (!editData?.subjectLabel) return "";
    const found = SUBJECT_CHIPS.find((c) => c.label === editData.subjectLabel);
    return found ? found.label : "Other";
  });

  const [customSubject, setCustomSubject] = useState(() => {
    if (!editData?.subjectLabel) return "";
    const found = SUBJECT_CHIPS.find((c) => c.label === editData.subjectLabel);
    return found ? "" : (editData.subjectLabel ?? "");
  });

  const [totalLessons, setTotalLessons] = useState(
    editData?.totalLessons ? String(editData.totalLessons) : ""
  );

  const [startLesson, setStartLesson] = useState(
    mode === "edit"
      ? String(editData?.currentLesson ?? "0")
      : "1"
  );

  const [schoolDays, setSchoolDays] = useState<boolean[]>(
    editData?.schoolDays?.length
      ? daysToBoolean(editData.schoolDays)
      : [true, true, true, true, true, false, false]
  );

  const [lessonsPerDay, setLessonsPerDay] = useState(
    editData?.lessonsPerDay ? String(editData.lessonsPerDay) : "1"
  );
  const [defaultMinutes, setDefaultMinutes] = useState("30");
  const [isCustomMinutes, setIsCustomMinutes] = useState(false);
  const [targetDate, setTargetDate] = useState(editData?.targetDate ?? "");
  const [startDate, setStartDate] = useState(() => toDateStr(new Date()));
  const [lessonStartTime, setLessonStartTime] = useState(editData?.lessonStartTime ?? "");
  const [defaultNotes, setDefaultNotes] = useState("");

  // Track curricula saved so far for the current child (for "Added so far" pills)
  const [savedForThisChild, setSavedForThisChild] = useState<Array<{ name: string; lessons: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [genCount, setGenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<"future" | "full" | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Backfill state
  const [backfillEnabled, setBackfillEnabled] = useState(false);
  const [backfillMode, setBackfillMode] = useState<"per_lesson" | "total_hours">("per_lesson");
  const [backfillLessonsDone, setBackfillLessonsDone] = useState("");
  const [backfillTotalHours, setBackfillTotalHours] = useState("");
  const [backfillStartPeriod, setBackfillStartPeriod] = useState<"1m" | "3m" | "6m" | "school_year" | "custom">("3m");
  const [backfillCustomDate, setBackfillCustomDate] = useState("");
  const [editBackfillCount, setEditBackfillCount] = useState(0);
  const [backfillRemoveConfirm, setBackfillRemoveConfirm] = useState(false);
  const [backfillShowDetails, setBackfillShowDetails] = useState(false);

  // Transcript fields (only shown if child has transcript set up)
  const [childHasTranscript, setChildHasTranscript] = useState(false);
  const [courseLevel, setCourseLevel] = useState<string>("standard");
  const [creditsValue, setCreditsValue] = useState<string>("");

  useEffect(() => {
    if (!childId) { setChildHasTranscript(false); return; }
    supabase
      .from("transcript_settings")
      .select("id")
      .eq("child_id", childId)
      .maybeSingle()
      .then(({ data }) => setChildHasTranscript(!!data));
  }, [childId]);

  // Pre-fill backfill lessons from start_at_lesson
  useEffect(() => {
    if (mode === "edit") return; // edit mode fills from DB
    const num = parseInt(startLesson);
    if (num > 1 && !backfillLessonsDone) {
      setBackfillLessonsDone(String(num - 1));
    }
  }, [startLesson]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch is_backfilled for edit mode
  useEffect(() => {
    if (mode !== "edit" || !editData?.goalId) return;
    supabase
      .from("curriculum_goals")
      .select("is_backfilled, start_at_lesson, scheduled_start_time, course_level, credits_value, lessons_per_day")
      .eq("id", editData.goalId)
      .single()
      .then(({ data }) => {
        if (data?.scheduled_start_time && !lessonStartTime) {
          setLessonStartTime(data.scheduled_start_time);
        }
        if (data?.is_backfilled) {
          setBackfillEnabled(true);
          // Count existing backfill entries
          supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .eq("curriculum_goal_id", editData.goalId!)
            .eq("is_backfill", true)
            .then(({ count }) => setEditBackfillCount(count ?? 0));
        }
        if (data?.start_at_lesson && data.start_at_lesson > 1) {
          setBackfillLessonsDone(String(data.start_at_lesson - 1));
        }
        if (data?.course_level) setCourseLevel(data.course_level);
        if (data?.credits_value != null) setCreditsValue(String(data.credits_value));
        if (data?.lessons_per_day) setLessonsPerDay(String(data.lessons_per_day));
      });
  }, [mode, editData?.goalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────
  const childObj         = children.find((c) => c.id === childId);
  const effectiveSub     = subject === "Other" ? customSubject.trim() : subject;
  const totalNum         = parseInt(totalLessons) || 0;
  const startNum         = parseInt(startLesson) || 1;
  const remaining        = Math.max(0, totalNum - startNum + 1);
  const selectedDayNames = DAY_LABELS.filter((_, i) => schoolDays[i]).join(", ");
  const perDayNum        = parseInt(lessonsPerDay) || 1;
  const otherSubjValid   = subject !== "Other" || customSubject.trim().length > 0;
  const step2Valid       = curricName.trim().length > 0 && totalLessons.trim().length > 0 && totalNum > 0 && otherSubjValid;
  const step3Valid       = schoolDays.some(Boolean) && perDayNum > 0 && !!startDate;

  // Dynamic total steps: 4 normally, 5 when backfill is enabled
  const totalSteps       = backfillEnabled ? 5 : 4;
  const confirmStep      = backfillEnabled ? 5 : 4;
  const backfillStep     = 4; // only used when backfillEnabled

  // Backfill derived values
  const backfillLessonsNum = parseInt(backfillLessonsDone) || 0;
  const backfillHoursNum   = parseFloat(backfillTotalHours) || 0;

  const backfillStartDate = (() => {
    const now = new Date();
    if (backfillStartPeriod === "1m") {
      const d = new Date(now); d.setMonth(d.getMonth() - 1); return toDateStr(d);
    }
    if (backfillStartPeriod === "3m") {
      const d = new Date(now); d.setMonth(d.getMonth() - 3); return toDateStr(d);
    }
    if (backfillStartPeriod === "6m") {
      const d = new Date(now); d.setMonth(d.getMonth() - 6); return toDateStr(d);
    }
    if (backfillStartPeriod === "school_year") return getSchoolYearStart();
    return backfillCustomDate;
  })();

  const backfillStartDateObj = (() => {
    if (!backfillStartDate) return new Date();
    const [y, m, d] = backfillStartDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();

  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d; })();
  const availableSchoolDays = countSchoolDaysBetween(backfillStartDateObj, new Date(), schoolDays);
  const backfillOverflow = backfillLessonsNum > availableSchoolDays && availableSchoolDays > 0;
  const backfillStepValid = backfillLessonsNum > 0 && !!backfillStartDate && (backfillMode === "per_lesson" || backfillHoursNum > 0);

  // Parse start date using local parts to avoid timezone shift
  const startDateObj = (() => {
    if (!startDate) return todayMidnight;
    const [y, m, d] = startDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();

  function calcFinishDate(perDay?: number): string {
    const pd = perDay ?? perDayNum;
    if (remaining === 0 || pd <= 0 || !schoolDays.some(Boolean)) return "";
    const daysNeeded = Math.ceil(remaining / pd);
    let cnt = 0;
    const cursor = new Date(startDateObj);
    let safety = 0;
    while (cnt < daysNeeded && safety < 3650) {
      const dayIdx = (cursor.getDay() + 6) % 7;
      if (schoolDays[dayIdx]) cnt++;
      if (cnt < daysNeeded) cursor.setDate(cursor.getDate() + 1);
      safety++;
    }
    return cursor.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  function calcRequiredPerDay(): number | null {
    if (!targetDate || !schoolDays.some(Boolean)) return null;
    const goal = new Date(targetDate + "T00:00:00");
    if (isNaN(goal.getTime()) || goal < startDateObj) return null;
    if (remaining === 0) return null;
    let schoolDayCount = 0;
    const cursor = new Date(startDateObj);
    let safety = 0;
    while (cursor <= goal && safety < 3650) {
      const dayIdx = (cursor.getDay() + 6) % 7;
      if (schoolDays[dayIdx]) schoolDayCount++;
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }
    return schoolDayCount > 0 ? Math.ceil(remaining / schoolDayCount) : null;
  }

  const finishDate     = calcFinishDate();
  const requiredPerDay = calcRequiredPerDay();

  // ── CREATE: generate lessons ───────────────────────────────────────────────
  async function generate() {
    setGenerating(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGenerating(false); setError("Not logged in."); return; }

    // Resolve subject
    let subjectId: string | null = null;
    if (effectiveSub) {
      const { data: existing } = await supabase
        .from("subjects")
        .select("id")
        .eq("user_id", user.id)
        .ilike("name", effectiveSub)
        .maybeSingle();
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: ns, error: subErr } = await supabase
          .from("subjects")
          .insert({ user_id: user.id, name: effectiveSub })
          .select("id")
          .single();
        if (subErr) { setGenerating(false); setError(`Could not create subject: ${subErr.message}`); return; }
        if (ns) subjectId = ns.id;
      }
    }

    // Save curriculum_goal. current_lesson is derived from rows later — start at 0
    // so a failed lesson-insert doesn't leave an orphaned goal claiming progress
    // that doesn't exist (Bug 3: progress mismatch).
    const saveName = titleCase(curricName);
    const { data: goalData, error: goalErr } = await supabase
      .from("curriculum_goals")
      .insert({
        user_id: user.id,
        child_id: childId || null,
        curriculum_name: saveName,
        subject_label: effectiveSub || null,
        total_lessons: totalNum,
        current_lesson: 0,
        start_at_lesson: startNum,
        target_date: targetDate || null,
        start_date: startDate || null,
        school_days: booleanToDays(schoolDays),
        default_minutes: parseInt(defaultMinutes) || 30,
        lessons_per_day: parseInt(lessonsPerDay) || 1,
        scheduled_start_time: lessonStartTime || null,
        school_year_id: schoolYearId || null,
        icon_emoji: guessEmoji(saveName),
        course_level: childHasTranscript ? courseLevel : null,
        credits_value: childHasTranscript && creditsValue ? parseFloat(creditsValue) : null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (goalErr) { console.error("curriculum_goals insert failed:", goalErr); setGenerating(false); setError(`Could not save goal: ${goalErr.message}`); return; }
    const goalId = goalData?.id;

    // Fetch vacation blocks
    const { data: vacBlocks } = await supabase
      .from("vacation_blocks")
      .select("start_date, end_date")
      .eq("user_id", user.id);
    const vacBlockList = (vacBlocks ?? []) as { start_date: string; end_date: string }[];

    // Build schedule from user-selected start date
    const rows: { date: string; n: number }[] = [];
    let lessonNum = startNum;
    const cursor = new Date(startDateObj);
    let safety = 0;
    while (lessonNum <= totalNum && safety < 3650) {
      const dayIdx = (cursor.getDay() + 6) % 7;
      const dateStr = toDateStr(cursor);
      if (schoolDays[dayIdx] && !isDateInBlocks(dateStr, vacBlockList)) {
        for (let i = 0; i < perDayNum && lessonNum <= totalNum; i++, lessonNum++) {
          rows.push({ date: dateStr, n: lessonNum });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }

    if (rows.length === 0) {
      setGenerating(false);
      setError("No lessons to schedule. Check your start/total lesson numbers.");
      return;
    }

    // Dedup guard — remove uncompleted lessons with same name pattern
    let dedupQ = supabase
      .from("lessons")
      .delete()
      .eq("user_id", user.id)
      .ilike("title", `${saveName} — Lesson%`)
      .eq("completed", false);
    if (childId) dedupQ = dedupQ.eq("child_id", childId);
    else dedupQ = dedupQ.is("child_id", null);
    const { error: dedupErr } = await dedupQ;
    if (dedupErr) console.error("[CurriculumWizard] dedup guard failed:", dedupErr);

    if (!subjectId && effectiveSub) {
      console.warn(`[CurriculumWizard] subject "${effectiveSub}" selected but subject_id is null — badges won't show`);
    }

    const trimmedNotes = defaultNotes.trim() || null;
    const inserts = rows.map(({ date, n }) => ({
      user_id: user.id,
      child_id: childId || null,
      subject_id: subjectId,
      title: `${saveName} — Lesson ${n}`,
      date,
      scheduled_date: date,
      completed: false,
      hours: 0,
      curriculum_goal_id: goalId,
      lesson_number: n,
      school_year_id: schoolYearId || null,
      notes: trimmedNotes,
    }));

    let totalInserted = 0;
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100);
      const { error: insertErr } = await supabase.from("lessons").insert(batch);
      if (insertErr) {
        console.error(`[CurriculumWizard] lesson insert batch ${i}-${i + batch.length} failed:`, insertErr);
        // Rollback: delete any rows we already inserted plus the goal. Prevents
        // Bug 3 (goal with current_lesson > 0 but zero lesson rows).
        if (goalId) {
          await supabase.from("lessons").delete().eq("curriculum_goal_id", goalId);
          await supabase.from("curriculum_goals").delete().eq("id", goalId);
        }
        setGenerating(false);
        setError(`Failed to save lessons (batch ${Math.floor(i / 100) + 1}): ${insertErr.message}`);
        return;
      }
      totalInserted += batch.length;
    }

    // Verify lessons actually saved
    const { count: savedCount } = await supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_goal_id", goalId);

    const actual = savedCount ?? 0;
    console.log(`[CurriculumWizard] ${actual}/${rows.length} lessons verified for goal ${goalId} (subject_id: ${subjectId ?? "none"})`);

    if (actual === 0) {
      // Rollback the goal row — no lessons, no goal.
      if (goalId) await supabase.from("curriculum_goals").delete().eq("id", goalId);
      setGenerating(false);
      setError("Something went wrong saving your lessons. Please try again.");
      return;
    }

    if (actual < rows.length) {
      console.warn(`[CurriculumWizard] partial save: only ${actual}/${rows.length} lessons for goal ${goalId}`);
    }

    // ── Backfill entries ─────────────────────────────────────────────────────
    // Two entry conditions funnel through the same distributed path:
    //   • Explicit: user toggled backfillEnabled and picked a range + mode.
    //   • Implicit: user said "I'm on lesson N" (startNum > 1) without toggling
    //     backfill. Default the range to "today minus (startNum - 1) school
    //     days" so every backfilled lesson lands on a distinct prior school day
    //     instead of stacking on yesterday.
    const implicitBackfill = !backfillEnabled && startNum > 1;
    const effectiveBackfillLessonsNum = backfillEnabled ? backfillLessonsNum : (implicitBackfill ? startNum - 1 : 0);
    const effectiveBackfillStartDate = (() => {
      if (backfillEnabled) return backfillStartDate;
      if (!implicitBackfill) return "";
      const target = startNum - 1;
      const cursor = new Date(); cursor.setDate(cursor.getDate() - 1); cursor.setHours(0, 0, 0, 0);
      let found = 0;
      let safety = 0;
      while (found < target && safety < 3650) {
        const idx = (cursor.getDay() + 6) % 7;
        if (schoolDays[idx]) found++;
        if (found < target) cursor.setDate(cursor.getDate() - 1);
        safety++;
      }
      return toDateStr(cursor);
    })();

    let backfillInserted = 0;
    if (goalId && effectiveBackfillLessonsNum > 0 && effectiveBackfillStartDate) {
      const bfStartObj = (() => {
        const [y, m, d] = effectiveBackfillStartDate.split("-").map(Number);
        return new Date(y, m - 1, d);
      })();
      const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1); yesterdayDate.setHours(0,0,0,0);

      // Collect school days between start and yesterday
      const schoolDayDates: string[] = [];
      const bfCursor = new Date(bfStartObj);
      let bfSafety = 0;
      while (bfCursor <= yesterdayDate && bfSafety < 3650) {
        const dayIdx = (bfCursor.getDay() + 6) % 7;
        if (schoolDays[dayIdx]) schoolDayDates.push(toDateStr(bfCursor));
        bfCursor.setDate(bfCursor.getDate() + 1);
        bfSafety++;
      }

      if (schoolDayDates.length > 0) {
        // Implicit backfill doesn't know real per-lesson time — record 0 rather
        // than claim estimated minutes the user didn't enter.
        const perDayMinutes = backfillEnabled
          ? (backfillMode === "per_lesson"
              ? (parseInt(defaultMinutes) || 30)
              : Math.round((backfillHoursNum * 60) / effectiveBackfillLessonsNum))
          : 0;
        const perDayHours = perDayMinutes / 60;

        // Distribute lessons across school days
        const bfInserts: Array<Record<string, unknown>> = [];
        let lessonIdx = 0;
        if (effectiveBackfillLessonsNum <= schoolDayDates.length) {
          // 1 per day, fill forward
          for (let i = 0; i < effectiveBackfillLessonsNum; i++) {
            const dateStr = schoolDayDates[i];
            bfInserts.push({
              user_id: user.id,
              child_id: childId || null,
              subject_id: subjectId,
              title: `${saveName} — Lesson ${i + 1}`,
              date: dateStr,
              scheduled_date: dateStr,
              completed: true,
              completed_at: `${dateStr}T12:00:00Z`,
              is_backfill: true,
              hours: perDayHours,
              minutes_spent: perDayMinutes || null,
              curriculum_goal_id: goalId,
              lesson_number: i + 1,
              school_year_id: schoolYearId || null,
            });
          }
        } else {
          // More lessons than days: distribute evenly
          const perDay = Math.ceil(effectiveBackfillLessonsNum / schoolDayDates.length);
          for (const dateStr of schoolDayDates) {
            for (let j = 0; j < perDay && lessonIdx < effectiveBackfillLessonsNum; j++, lessonIdx++) {
              bfInserts.push({
                user_id: user.id,
                child_id: childId || null,
                subject_id: subjectId,
                title: `${saveName} — Lesson ${lessonIdx + 1}`,
                date: dateStr,
                scheduled_date: dateStr,
                completed: true,
                completed_at: `${dateStr}T12:00:00Z`,
                is_backfill: true,
                hours: perDayHours,
                minutes_spent: perDayMinutes || null,
                curriculum_goal_id: goalId,
                lesson_number: lessonIdx + 1,
                school_year_id: schoolYearId || null,
              });
            }
          }
        }

        for (let i = 0; i < bfInserts.length; i += 100) {
          const batch = bfInserts.slice(i, i + 100);
          const { error: bfErr } = await supabase.from("lessons").insert(batch);
          if (bfErr) {
            console.error(`[CurriculumWizard] backfill batch failed:`, bfErr);
          } else {
            backfillInserted += batch.length;
          }
        }

        // Mark goal as backfilled
        if (backfillInserted > 0) {
          await supabase.from("curriculum_goals").update({
            is_backfilled: true,
            start_at_lesson: startNum,
          }).eq("id", goalId);
        }
      }
    }

    // Recompute current_lesson from actual completed rows so the goal's
    // progress counter can never drift above the real max(lesson_number) of
    // completed rows (Bug 3).
    if (goalId) await recomputeCurrentLesson(supabase, goalId);

    posthog.capture('curriculum_created', { lessons: actual, backfilled: backfillInserted, curriculum: saveName });
    setGenCount(actual + backfillInserted);

    // Fire streak + badge check once for the whole batch (fire-and-forget)
    if (backfillInserted > 0 || actual > 0) {
      onLogAction({ userId: user.id, childId: childId || undefined, actionType: "lesson" });
    }

    setGenerating(false);
    setDone(true);
    onSaved();
  }

  // ── EDIT: update goal + reschedule ─────────────────────────────────────────
  async function saveEdit() {
    if (!editData) return;
    setGenerating(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGenerating(false); setError("Not logged in."); return; }

    const todayStr = toDateStr(todayMidnight);
    let activeGoalId = editData.goalId;

    // Capture the goal's pre-update lessons_per_day so we can detect a change
    // after the update and regenerate future lessons at the new cadence.
    let originalLessonsPerDay: number | null = null;
    if (activeGoalId) {
      const { data: origGoal } = await supabase
        .from("curriculum_goals")
        .select("lessons_per_day")
        .eq("id", activeGoalId)
        .maybeSingle();
      originalLessonsPerDay = origGoal?.lessons_per_day ?? null;
    }

    const saveName = titleCase(curricName);
    // start_at_lesson is derived from the user's "Lessons done" input plus 1.
    // current_lesson is NEVER written from user input here — it's recomputed
    // from actual rows at the end (Bug 3).
    const startAtLesson = Math.max(1, (parseInt(startLesson) || 0) + 1);
    if (activeGoalId) {
      // Update existing goal
      const updatePayload = {
        curriculum_name: saveName,
        subject_label: effectiveSub || null,
        total_lessons: totalNum,
        start_at_lesson: startAtLesson,
        target_date: targetDate || null,
        start_date: startDate || null,
        school_days: booleanToDays(schoolDays),
        default_minutes: parseInt(defaultMinutes) || 30,
        lessons_per_day: parseInt(lessonsPerDay) || 1,
        scheduled_start_time: lessonStartTime || null,
        icon_emoji: guessEmoji(saveName),
        course_level: childHasTranscript ? courseLevel : null,
        credits_value: childHasTranscript && creditsValue ? parseFloat(creditsValue) : null,
        updated_at: new Date().toISOString(),
      };
      const { error: updateErr } = await supabase
        .from("curriculum_goals")
        .update(updatePayload)
        .eq("id", activeGoalId)
        .select();
      if (updateErr) { console.error("curriculum_goals update failed:", updateErr); setGenerating(false); setError(`Could not update goal: ${updateErr.message}`); return; }
    } else {
      // Create new goal for existing curriculum
      const { data: newGoal, error: insertErr } = await supabase
        .from("curriculum_goals")
        .insert({
          user_id: user.id,
          child_id: editData.childId || null,
          curriculum_name: saveName,
          subject_label: effectiveSub || null,
          total_lessons: totalNum,
          current_lesson: 0,
          start_at_lesson: startAtLesson,
          target_date: targetDate || null,
          start_date: startDate || null,
          school_days: booleanToDays(schoolDays),
          default_minutes: parseInt(defaultMinutes) || 30,
          lessons_per_day: parseInt(lessonsPerDay) || 1,
          scheduled_start_time: lessonStartTime || null,
          school_year_id: schoolYearId || null,
          icon_emoji: guessEmoji(saveName),
          course_level: childHasTranscript ? courseLevel : null,
          credits_value: childHasTranscript && creditsValue ? parseFloat(creditsValue) : null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertErr) { console.error("curriculum_goals insert failed:", insertErr); setGenerating(false); setError(`Could not save goal: ${insertErr.message}`); return; }
      activeGoalId = newGoal?.id;

      // Link existing lessons to new goal
      if (activeGoalId) {
        let linkQ = supabase
          .from("lessons")
          .update({ curriculum_goal_id: activeGoalId })
          .eq("user_id", user.id)
          .ilike("title", `${editData.curricName} — Lesson%`);
        if (editData.childId) linkQ = linkQ.eq("child_id", editData.childId);
        await linkQ;
      }
    }

    // Rename lesson titles if curriculum name changed
    const oldName = editData.curricName;
    const newName = curricName.trim();
    if (oldName !== newName && activeGoalId) {
      // Fetch all lessons linked to this goal (by goal_id or title pattern)
      let renameQ = supabase
        .from("lessons")
        .select("id, title")
        .eq("user_id", user.id)
        .ilike("title", `${oldName} — Lesson%`);
      if (editData.childId) renameQ = renameQ.eq("child_id", editData.childId);
      const { data: toRename } = await renameQ;
      if (toRename && toRename.length > 0) {
        const renameBatch = toRename.map((l: { id: string; title: string }) => {
          const updated = l.title.replace(oldName, newName);
          return supabase.from("lessons").update({ title: updated }).eq("id", l.id);
        });
        for (let i = 0; i < renameBatch.length; i += 20) {
          await Promise.all(renameBatch.slice(i, i + 20));
        }
      }
    }

    // If lessons_per_day changed, the existing future lesson rows won't match
    // the new cadence (too few for a 1→2 change, too many for 2→1). Delete
    // future incomplete rows and regenerate them fresh. Past/completed rows
    // are left untouched.
    let regeneratedLessons = false;
    if (
      activeGoalId &&
      originalLessonsPerDay !== null &&
      (parseInt(lessonsPerDay) || 1) !== originalLessonsPerDay
    ) {
      const { error: delErr } = await supabase
        .from("lessons")
        .delete()
        .eq("curriculum_goal_id", activeGoalId)
        .eq("completed", false)
        .gte("scheduled_date", todayStr);
      if (delErr) {
        console.error("[CurriculumWizard] future-lesson delete failed:", delErr);
        setGenerating(false);
        setError(`Could not clear old lessons: ${delErr.message}`);
        return;
      }

      // Determine next lesson number from remaining (past/completed) rows
      const { data: maxRow } = await supabase
        .from("lessons")
        .select("lesson_number")
        .eq("curriculum_goal_id", activeGoalId)
        .order("lesson_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextLessonNum = Math.max((maxRow?.lesson_number ?? 0) + 1, 1);

      // Resolve subject_id for the new rows
      let regenSubjectId: string | null = null;
      if (effectiveSub) {
        const { data: existingSub } = await supabase
          .from("subjects")
          .select("id")
          .eq("user_id", user.id)
          .ilike("name", effectiveSub)
          .maybeSingle();
        regenSubjectId = existingSub?.id ?? null;
      }

      // Fetch vacation blocks
      const { data: vacBlocks } = await supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", user.id);
      const vacBlockList = (vacBlocks ?? []) as { start_date: string; end_date: string }[];

      // Regenerate starting from today (or user-selected start date if later)
      const regenStart = startDateObj > todayMidnight ? new Date(startDateObj) : new Date(todayMidnight);
      const regenRows: { date: string; n: number }[] = [];
      let ln = nextLessonNum;
      const rcursor = new Date(regenStart);
      let rsafety = 0;
      while (ln <= totalNum && rsafety < 3650) {
        const dayIdx = (rcursor.getDay() + 6) % 7;
        const dateStr = toDateStr(rcursor);
        if (schoolDays[dayIdx] && !isDateInBlocks(dateStr, vacBlockList)) {
          for (let i = 0; i < perDayNum && ln <= totalNum; i++, ln++) {
            regenRows.push({ date: dateStr, n: ln });
          }
        }
        rcursor.setDate(rcursor.getDate() + 1);
        rsafety++;
      }

      const trimmedNotes = defaultNotes.trim() || null;
      const regenInserts = regenRows.map(({ date, n }) => ({
        user_id: user.id,
        child_id: editData.childId || null,
        subject_id: regenSubjectId,
        title: `${saveName} — Lesson ${n}`,
        date,
        scheduled_date: date,
        completed: false,
        hours: 0,
        curriculum_goal_id: activeGoalId,
        lesson_number: n,
        school_year_id: schoolYearId || null,
        notes: trimmedNotes,
      }));

      for (let i = 0; i < regenInserts.length; i += 100) {
        const batch = regenInserts.slice(i, i + 100);
        const { error: insErr } = await supabase.from("lessons").insert(batch);
        if (insErr) {
          console.error("[CurriculumWizard] regenerate lesson insert failed:", insErr);
          setGenerating(false);
          setError(`Could not regenerate lessons: ${insErr.message}`);
          return;
        }
      }

      regeneratedLessons = true;
    }

    // Reschedule incomplete future lessons (skip when we just regenerated —
    // those rows are already placed at the correct dates/cadence).
    if (!regeneratedLessons) {
      let futureLessons: { id: string; scheduled_date: string | null; date: string | null }[] = [];

      if (activeGoalId) {
        const { data } = await supabase
          .from("lessons")
          .select("id, scheduled_date, date")
          .eq("curriculum_goal_id", activeGoalId)
          .eq("completed", false)
          .gte("scheduled_date", todayStr);
        futureLessons = (data ?? []) as typeof futureLessons;
      }

      // Fallback: title pattern if no results via goal_id
      if (futureLessons.length === 0) {
        let q = supabase
          .from("lessons")
          .select("id, scheduled_date, date")
          .eq("user_id", user.id)
          .eq("completed", false)
          .ilike("title", `${editData.curricName} — Lesson%`)
          .gte("scheduled_date", todayStr);
        if (editData.childId) q = q.eq("child_id", editData.childId);
        const { data } = await q;
        futureLessons = (data ?? []) as typeof futureLessons;
      }

      futureLessons.sort((a, b) =>
        (a.scheduled_date ?? a.date ?? "").localeCompare(b.scheduled_date ?? b.date ?? "")
      );

      if (futureLessons.length > 0) {
        // Pack `perDayNum` lessons onto each school day. The old version
        // advanced the cursor after a single lesson regardless of perDayNum,
        // producing 1-per-day density and triggering Bug 6. Also honor
        // vacation blocks and the goal's actual school_days (Bug 4).
        const { data: vacBlocksForReschedule } = await supabase
          .from("vacation_blocks")
          .select("start_date, end_date")
          .eq("user_id", user.id);
        const vacList = (vacBlocksForReschedule ?? []) as { start_date: string; end_date: string }[];

        const updates: { id: string; date: string }[] = [];
        const cursor = new Date(startDateObj);
        let placedToday = 0;
        let safety = 0;
        for (const lesson of futureLessons) {
          while (safety < 3650) {
            const dayIdx = (cursor.getDay() + 6) % 7;
            const dateStr = toDateStr(cursor);
            const inVac = vacList.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
            if (schoolDays[dayIdx] && !inVac && placedToday < perDayNum) {
              updates.push({ id: lesson.id, date: dateStr });
              placedToday++;
              break;
            }
            cursor.setDate(cursor.getDate() + 1);
            placedToday = 0;
            safety++;
          }
        }
        for (let i = 0; i < updates.length; i += 20) {
          await Promise.all(
            updates.slice(i, i + 20).map(({ id, date }) =>
              supabase.from("lessons").update({ scheduled_date: date, date }).eq("id", id)
            )
          );
        }
      }
    }

    // ── Backfill entries (edit mode) ──────────────────────────────────────────
    if (backfillEnabled && backfillLessonsNum > 0 && backfillStartDate && activeGoalId && editBackfillCount === 0) {
      const bfStartObj = (() => {
        const [y, m, d] = backfillStartDate.split("-").map(Number);
        return new Date(y, m - 1, d);
      })();
      const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1); yesterdayDate.setHours(0,0,0,0);

      // Resolve subject for backfill
      let bfSubjectId: string | null = null;
      if (effectiveSub) {
        const { data: existing } = await supabase
          .from("subjects").select("id").eq("user_id", user.id).ilike("name", effectiveSub).maybeSingle();
        bfSubjectId = existing?.id ?? null;
      }

      const schoolDayDates: string[] = [];
      const bfCursor = new Date(bfStartObj);
      let bfSafety = 0;
      while (bfCursor <= yesterdayDate && bfSafety < 3650) {
        const dayIdx = (bfCursor.getDay() + 6) % 7;
        if (schoolDays[dayIdx]) schoolDayDates.push(toDateStr(bfCursor));
        bfCursor.setDate(bfCursor.getDate() + 1);
        bfSafety++;
      }

      if (schoolDayDates.length > 0) {
        const saveName = titleCase(curricName);
        const perDayMinutes = backfillMode === "per_lesson"
          ? (parseInt(defaultMinutes) || 30)
          : Math.round((backfillHoursNum * 60) / backfillLessonsNum);
        const perDayHours = perDayMinutes / 60;

        const bfInserts: Array<Record<string, unknown>> = [];
        let lessonIdx = 0;
        if (backfillLessonsNum <= schoolDayDates.length) {
          for (let i = 0; i < backfillLessonsNum; i++) {
            const dateStr = schoolDayDates[i];
            bfInserts.push({
              user_id: user.id, child_id: editData.childId || null, subject_id: bfSubjectId,
              title: `${saveName} — Lesson ${i + 1}`, date: dateStr, scheduled_date: dateStr,
              completed: true, completed_at: `${dateStr}T12:00:00Z`, is_backfill: true,
              hours: perDayHours, minutes_spent: perDayMinutes,
              curriculum_goal_id: activeGoalId, lesson_number: i + 1,
              school_year_id: schoolYearId || null,
            });
          }
        } else {
          const perDay = Math.ceil(backfillLessonsNum / schoolDayDates.length);
          for (const dateStr of schoolDayDates) {
            for (let j = 0; j < perDay && lessonIdx < backfillLessonsNum; j++, lessonIdx++) {
              bfInserts.push({
                user_id: user.id, child_id: editData.childId || null, subject_id: bfSubjectId,
                title: `${saveName} — Lesson ${lessonIdx + 1}`, date: dateStr, scheduled_date: dateStr,
                completed: true, completed_at: `${dateStr}T12:00:00Z`, is_backfill: true,
                hours: perDayHours, minutes_spent: perDayMinutes,
                curriculum_goal_id: activeGoalId, lesson_number: lessonIdx + 1,
                school_year_id: schoolYearId || null,
              });
            }
          }
        }

        for (let i = 0; i < bfInserts.length; i += 100) {
          const batch = bfInserts.slice(i, i + 100);
          await supabase.from("lessons").insert(batch);
        }

        await supabase.from("curriculum_goals").update({
          is_backfilled: true,
          start_at_lesson: parseInt(startLesson) || 1,
        }).eq("id", activeGoalId);

        // Fire streak + badge check once for the backfill batch
        onLogAction({ userId: user.id, childId: editData.childId || undefined, actionType: "lesson" });
      }
    }

    // ── Heal + recompute ──────────────────────────────────────────────────────
    // Regardless of which branch we took, repair any pre-existing broken state
    // (ghost completions, incomplete dupes) and then gap-fill missing lesson
    // numbers before recomputing current_lesson. Regenerate MUST NOT inherit
    // broken state from before the edit (Bugs 1, 2, 5).
    if (activeGoalId) {
      await healGoalIntegrity(supabase, activeGoalId);

      // Gap-fill: find missing lesson_numbers in [1..totalNum] and schedule
      // them forward on school days. This catches legacy gaps from older
      // generate() flows.
      const { data: existingRows } = await supabase
        .from("lessons")
        .select("lesson_number")
        .eq("curriculum_goal_id", activeGoalId)
        .not("lesson_number", "is", null);
      const existingNums = new Set<number>(
        ((existingRows ?? []) as { lesson_number: number }[]).map((r) => r.lesson_number),
      );
      const missing: number[] = [];
      for (let n = 1; n <= totalNum; n++) {
        if (!existingNums.has(n)) missing.push(n);
      }
      if (missing.length > 0) {
        // Resolve subject_id for healed rows.
        let healSubjectId: string | null = null;
        if (effectiveSub) {
          const { data: existingSub } = await supabase
            .from("subjects").select("id").eq("user_id", user.id).ilike("name", effectiveSub).maybeSingle();
          healSubjectId = existingSub?.id ?? null;
        }
        const { data: vacBlocks } = await supabase
          .from("vacation_blocks")
          .select("start_date, end_date")
          .eq("user_id", user.id);
        const vacList = (vacBlocks ?? []) as { start_date: string; end_date: string }[];

        // Partition: numbers < startAtLesson get is_backfill rows distributed
        // across the most-recent prior school days (oldest lesson_number → oldest
        // date). Numbers >= startAtLesson get real schedule dates on future
        // school days.
        const pastMissing = missing.filter((n) => n < startAtLesson);
        const futureMissing = missing.filter((n) => n >= startAtLesson);

        const healInserts: Array<Record<string, unknown>> = [];

        if (pastMissing.length > 0) {
          // Walk backward from yesterday, collecting pastMissing.length school
          // days. unshift() keeps the array in oldest-first order so index i
          // aligns with the i-th smallest missing lesson_number.
          const priorSchoolDays: string[] = [];
          const backCursor = new Date(); backCursor.setDate(backCursor.getDate() - 1); backCursor.setHours(0, 0, 0, 0);
          let backSafety = 0;
          while (priorSchoolDays.length < pastMissing.length && backSafety < 3650) {
            const idx = (backCursor.getDay() + 6) % 7;
            if (schoolDays[idx]) priorSchoolDays.unshift(toDateStr(backCursor));
            backCursor.setDate(backCursor.getDate() - 1);
            backSafety++;
          }
          const pastSorted = [...pastMissing].sort((a, b) => a - b);
          for (let i = 0; i < pastSorted.length; i++) {
            const n = pastSorted[i];
            const dateStr = priorSchoolDays[i] ?? priorSchoolDays[priorSchoolDays.length - 1];
            healInserts.push({
              user_id: user.id,
              child_id: editData.childId || null,
              subject_id: healSubjectId,
              title: `${saveName} — Lesson ${n}`,
              date: dateStr,
              scheduled_date: dateStr,
              completed: true,
              completed_at: `${dateStr}T12:00:00Z`,
              is_backfill: true,
              hours: 0,
              curriculum_goal_id: activeGoalId,
              lesson_number: n,
              school_year_id: schoolYearId || null,
            });
          }
        }

        if (futureMissing.length > 0) {
          // Place future-missing rows on upcoming school days from today,
          // packed perDayNum/day and skipping vacations.
          const startCursor = startDateObj > todayMidnight ? new Date(startDateObj) : new Date(todayMidnight);
          const futureSorted = [...futureMissing].sort((a, b) => a - b);
          let placed = 0;
          const cursor = new Date(startCursor);
          let placedToday = 0;
          let safety = 0;
          while (placed < futureSorted.length && safety < 3650) {
            const dayIdx = (cursor.getDay() + 6) % 7;
            const dateStr = toDateStr(cursor);
            const inVac = vacList.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
            if (schoolDays[dayIdx] && !inVac) {
              while (placedToday < perDayNum && placed < futureSorted.length) {
                healInserts.push({
                  user_id: user.id,
                  child_id: editData.childId || null,
                  subject_id: healSubjectId,
                  title: `${saveName} — Lesson ${futureSorted[placed]}`,
                  date: dateStr,
                  scheduled_date: dateStr,
                  completed: false,
                  hours: 0,
                  curriculum_goal_id: activeGoalId,
                  lesson_number: futureSorted[placed],
                  school_year_id: schoolYearId || null,
                });
                placed++;
                placedToday++;
              }
            }
            cursor.setDate(cursor.getDate() + 1);
            placedToday = 0;
            safety++;
          }
        }

        for (let i = 0; i < healInserts.length; i += 100) {
          const batch = healInserts.slice(i, i + 100);
          const { error: healErr } = await supabase.from("lessons").insert(batch);
          if (healErr) console.error("[CurriculumWizard] heal-gap insert failed:", healErr);
        }
      }

      await recomputeCurrentLesson(supabase, activeGoalId);
    }

    setGenerating(false);
    setDone(true);
    showToast?.("✓ Curriculum updated!");
    onSaved();
  }

  // ── DELETE: future lessons only ─────────────────────────────────────────
  async function deleteFutureLessons() {
    if (!editData) return;
    setDeleting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setDeleting(false); return; }

    // Find incomplete lessons by goal_id or title pattern
    let ids: string[] = [];
    if (editData.goalId) {
      const { data } = await supabase
        .from("lessons")
        .select("id")
        .eq("curriculum_goal_id", editData.goalId)
        .eq("completed", false);
      ids = (data ?? []).map((l: { id: string }) => l.id);
    }
    if (ids.length === 0) {
      let q = supabase
        .from("lessons")
        .select("id")
        .eq("user_id", user.id)
        .eq("completed", false)
        .ilike("title", `${editData.curricName} — Lesson%`);
      if (editData.childId) q = q.eq("child_id", editData.childId);
      const { data } = await q;
      ids = (data ?? []).map((l: { id: string }) => l.id);
    }

    for (let i = 0; i < ids.length; i += 100) {
      await supabase.from("lessons").delete().in("id", ids.slice(i, i + 100));
    }

    setDeleting(false);
    setDeleteConfirm(null);
    showToast?.("Future lessons deleted");
    onSaved();
    onClose();
  }

  // ── DELETE: entire curriculum ──────────────────────────────────────────
  async function deleteEntireCurriculum() {
    if (!editData) return;
    setDeleting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setDeleting(false); return; }

    // Find ALL lessons (completed + incomplete) by goal_id or title pattern
    let ids: string[] = [];
    if (editData.goalId) {
      const { data } = await supabase
        .from("lessons")
        .select("id")
        .eq("curriculum_goal_id", editData.goalId);
      ids = (data ?? []).map((l: { id: string }) => l.id);
    }
    if (ids.length === 0) {
      let q = supabase
        .from("lessons")
        .select("id")
        .eq("user_id", user.id)
        .ilike("title", `${editData.curricName} — Lesson%`);
      if (editData.childId) q = q.eq("child_id", editData.childId);
      const { data } = await q;
      ids = (data ?? []).map((l: { id: string }) => l.id);
    }

    for (let i = 0; i < ids.length; i += 100) {
      await supabase.from("lessons").delete().in("id", ids.slice(i, i + 100));
    }

    // Delete the curriculum goal itself
    if (editData.goalId) {
      await supabase.from("curriculum_goals").delete().eq("id", editData.goalId);
    }

    setDeleting(false);
    setDeleteConfirm(null);
    showToast?.("Curriculum deleted");
    onSaved();
    onClose();
  }

  function resetForAnotherCurriculum() {
    const savedChildId = childId;
    // Track what was just saved for the "Added so far" pills
    const subjectLabel = subject === "Other" ? customSubject : subject;
    setSavedForThisChild(prev => [...prev, { name: curricName || subjectLabel || "Curriculum", lessons: totalLessons }]);
    setCurricName(""); setSubject(""); setCustomSubject("");
    setTotalLessons(""); setStartLesson("1");
    setSchoolDays([true, true, true, true, true, false, false]);
    setLessonsPerDay("1"); setTargetDate("");
    setBackfillEnabled(false); setBackfillMode("per_lesson");
    setBackfillLessonsDone(""); setBackfillTotalHours("");
    setBackfillStartPeriod("3m"); setBackfillCustomDate("");
    setLessonStartTime("");
    setGenerating(false); setDone(false); setGenCount(0); setError(null);
    setChildId(savedChildId); setStep(2);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">

        <div className="flex justify-end mb-1">
          <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors">
            <X size={18} />
          </button>
        </div>

        <WizardProgress step={step} total={totalSteps} />

        {/* ── STEP 1: Child ────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                Which child is this for?
              </h2>
              <p className="text-sm text-[#7a6f65]">Select a child to assign this curriculum to.</p>
            </div>

            {children.length === 0 ? (
              <div className="bg-[#f8faf8] border border-[#d4ead6] rounded-2xl p-6 text-center space-y-4">
                <div className="text-4xl">🌱</div>
                <div>
                  <p className="text-base font-semibold text-[#2d2926] mb-1">No children added yet</p>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    Head to Settings to add your children first, then come back to set up your curriculum.
                  </p>
                </div>
                <Link href="/dashboard/settings?section=children" onClick={onClose}
                  className="inline-block px-5 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors">
                  Go to Settings →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {children.map((child) => (
                  <button key={child.id} onClick={() => { setChildId(child.id); setSavedForThisChild([]); }}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                      childId === child.id ? "border-[#5c7f63] bg-[#f2f9f3] shadow-sm" : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
                    }`}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-lg"
                      style={{ backgroundColor: child.color ?? "#5c7f63" }}>
                      {child.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold text-[#2d2926] text-base">{child.name}</span>
                    {childId === child.id && <span className="ml-auto text-[#5c7f63] text-lg">✓</span>}
                  </button>
                ))}
              </div>
            )}

            {children.length > 0 && (
              <button onClick={() => setStep(2)} disabled={!childId}
                className="w-full py-3 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                Next →
              </button>
            )}
          </div>
        )}

        {/* ── STEP 2: Curriculum info ───────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                {mode === "edit" ? "Edit curriculum" : "Tell us about this curriculum"}
              </h2>
              <p className="text-sm text-[#7a6f65]">
                {mode === "edit"
                  ? "Update the details below."
                  : "We'll use this to name each lesson automatically."}
              </p>
            </div>

            {/* Child display for edit mode */}
            {mode === "edit" && childObj && (
              <div className="flex items-center gap-3 bg-[#f8f7f4] border border-[#e8e2d9] rounded-xl px-4 py-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
                  style={{ backgroundColor: childObj.color ?? "#5c7f63" }}>
                  {childObj.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-[#2d2926]">{childObj.name}</span>
              </div>
            )}

            {mode === "create" && savedForThisChild.length === 0 && (
              <div className="bg-[#f8f7f4] border border-[#e8e2d9] rounded-xl px-3 py-2.5 text-xs text-[#7a6f65] leading-relaxed">
                💡 Run this wizard multiple times to add multiple curricula for the same child — e.g. Math + Language Arts separately.
              </div>
            )}

            {savedForThisChild.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-2">
                  Added so far
                </p>
                <div className="flex flex-wrap gap-2">
                  {savedForThisChild.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 bg-[#eef5ee] border border-[#b8d9bc] rounded-full px-3 py-1.5"
                    >
                      <span className="text-[var(--g-deep)] text-xs">✓</span>
                      <span className="text-xs font-semibold text-[#2d2926]">{item.name}</span>
                      <span className="text-[10px] text-[#7a6f65]">· {item.lessons} lessons</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Curriculum name *</label>
              <input type="text" value={curricName} onChange={(e) => setCurricName(e.target.value)}
                placeholder="e.g. Saxon Math 5/4, All About Reading Level 3"
                autoFocus={mode === "create"}
                style={{ textTransform: "capitalize" }}
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Subject</label>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_CHIPS.map((chip) => (
                  <button key={chip.label}
                    onClick={() => setSubject(subject === chip.label ? "" : chip.label)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                      subject === chip.label ? "border-transparent shadow-sm scale-105" : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
                    }`}
                    style={subject === chip.label ? { backgroundColor: chip.bg, color: chip.text } : {}}>
                    {chip.label}
                  </button>
                ))}
              </div>
              {subject === "Other" && (
                <input type="text" value={customSubject} onChange={(e) => setCustomSubject(e.target.value)}
                  placeholder="Enter subject name" autoFocus
                  style={{ textTransform: "capitalize" }}
                  className="mt-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              )}
            </div>

            {/* Transcript info — only for kids with transcripts */}
            {childHasTranscript && (
              <div className="mt-4 p-3 rounded-xl bg-[#f0f7f1] border border-[#d5e8d8]">
                <p className="text-[11px] font-semibold text-[#2D5A3D] mb-2 uppercase tracking-wide">
                  Transcript Info <span className="font-normal normal-case tracking-normal text-[#6b8f72]">· optional</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#5c7f63] mb-1">Course Level</label>
                    <select
                      value={courseLevel}
                      onChange={e => setCourseLevel(e.target.value)}
                      className="w-full border border-[#d5e8d8] rounded-lg px-2.5 py-2 text-[13px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20"
                    >
                      <option value="standard">Standard</option>
                      <option value="honors">Honors</option>
                      <option value="ap">AP</option>
                      <option value="dual_enrollment">Dual Enrollment</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#5c7f63] mb-1">Credits</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="10"
                      placeholder="1.0"
                      value={creditsValue}
                      onChange={e => setCreditsValue(e.target.value)}
                      className="w-full border border-[#d5e8d8] rounded-lg px-2.5 py-2 text-[13px] text-[#3c3a37] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/20"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Total lessons *</label>
                <input value={totalLessons} onChange={(e) => setTotalLessons(e.target.value)}
                  type="number" min="1" max="999" placeholder="e.g. 170"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                  {mode === "edit" ? "Lessons done" : "Start at lesson"}
                </label>
                <input value={startLesson} onChange={(e) => setStartLesson(e.target.value)}
                  type="number" min="0" placeholder={mode === "edit" ? "0" : "1"}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
                <p className={`mt-1 ${mode === "edit" ? "text-[10px] text-[#b5aca4]" : "text-xs text-[#b5aca4]"}`}>
                  {mode === "edit" ? "Completed so far" : "Starting mid-curriculum? Enter the lesson number to begin at."}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Minutes per lesson</label>
              <div className="flex flex-wrap gap-2">
                {[15, 30, 45, 60, 90].map((m) => (
                  <button key={m} type="button"
                    onClick={() => { setDefaultMinutes(String(m)); setIsCustomMinutes(false); }}
                    className={`rounded-[10px] px-4 py-2.5 text-sm font-medium border transition-colors ${
                      !isCustomMinutes && defaultMinutes === String(m)
                        ? "bg-[#2D5A3D] text-white border-[#2D5A3D]"
                        : "bg-white border-[#e0ddd8] text-[#5c6b62]"
                    }`}
                  >{m}</button>
                ))}
                <button type="button"
                  onClick={() => { setIsCustomMinutes(true); setDefaultMinutes(""); }}
                  className={`rounded-[10px] px-4 py-2.5 text-sm font-medium transition-colors ${
                    isCustomMinutes
                      ? "border border-solid bg-[#2D5A3D] text-white"
                      : "border border-dashed border-[#e0ddd8] text-[#7a6f65]"
                  }`}
                >Custom</button>
              </div>
              {isCustomMinutes && (
                <input value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)}
                  type="number" min="1" max="300" placeholder="Type minutes"
                  className="mt-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              )}
              <p className="text-xs text-[#5c7f63] mt-1">This is your default — you can adjust the actual time for each lesson when you check it off.</p>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Lesson notes <span className="normal-case font-normal">(optional)</span></label>
              <textarea
                value={defaultNotes}
                onChange={(e) => setDefaultNotes(e.target.value)}
                placeholder="e.g. Use the blue workbook, skip review sections, do odd problems only..."
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] resize-none focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
              <p className="text-xs text-[#b5aca4] mt-1">Added to every lesson so you remember your plan. You can edit per-lesson later.</p>
            </div>

            <div className="flex gap-2">
              {mode === "create" && (
                <button onClick={() => setStep(1)}
                  className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
              )}
              <button onClick={() => setStep(3)} disabled={!step2Valid}
                className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                Next →
              </button>
            </div>

            {/* ── Delete options (edit mode only) ──────────────── */}
            {mode === "edit" && (
              <>
                <div className="border-t border-[#e8e2d9] mt-2 pt-4 space-y-2">
                  <button
                    onClick={() => setDeleteConfirm("future")}
                    className="w-full py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                  >
                    Delete future lessons only
                  </button>
                  <button
                    onClick={() => setDeleteConfirm("full")}
                    className="w-full py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Delete this curriculum entirely
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Delete confirmation modal ────────────────────── */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
              {deleteConfirm === "future" ? (
                <>
                  <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                    Delete future lessons?
                  </h2>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    This will delete all unfinished future lessons for <strong>{editData?.curricName}</strong>.
                    Your completed lessons and progress will be kept. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deleting}
                      className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteFutureLessons}
                      disabled={deleting}
                      className="flex-[2] py-2.5 rounded-xl bg-[#7a6f65] hover:bg-[#5c5248] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {deleting ? "Deleting…" : "Yes, delete future lessons"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                    Delete this curriculum?
                  </h2>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    This will permanently delete <strong>{editData?.curricName}</strong> and <strong>all</strong> its
                    lessons — including completed ones. Your progress data will also be removed. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deleting}
                      className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteEntireCurriculum}
                      disabled={deleting}
                      className="flex-[2] py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {deleting ? "Deleting…" : "Yes, delete everything"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Schedule ──────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>Pick your school days</h2>
              <p className="text-sm text-[#7a6f65]">
                {mode === "edit"
                  ? "Remaining lessons will be rescheduled on these days."
                  : "We'll schedule lessons only on the days you choose."}
              </p>
            </div>

            <div className="flex gap-1.5 justify-center flex-wrap">
              {DAY_LABELS.map((label, i) => (
                <button key={label}
                  onClick={() => setSchoolDays((p) => p.map((v, j) => j === i ? !v : v))}
                  className={`w-11 h-11 rounded-xl text-xs font-bold transition-all ${
                    schoolDays[i] ? "bg-[#5c7f63] text-white shadow-sm" : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                Start date
              </label>
              <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date"
                max={toDateStr((() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d; })())}
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                Lessons per school day <span className="normal-case font-normal text-[#b5aca4]">(default: 1)</span>
              </label>
              <input value={lessonsPerDay} onChange={(e) => setLessonsPerDay(e.target.value)}
                type="number" min="1" max="10" placeholder="1"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                Lesson time <span className="normal-case font-normal text-[#b5aca4]">(optional)</span>
              </label>
              <input value={lessonStartTime} onChange={(e) => setLessonStartTime(e.target.value)} type="time"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <p className="text-[11px] text-[#8B7E74] mt-1">When does this subject usually happen? Shows on your daily schedule.</p>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                Finish Line Date <span className="normal-case font-normal text-[#b5aca4]">(optional)</span>
              </label>
              <input value={targetDate} onChange={(e) => setTargetDate(e.target.value)} type="date"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>

            {/* Smart live preview (create mode) */}
            {step3Valid && remaining > 0 && (
              <div className="space-y-2">
                {finishDate && (
                  <div className="bg-[#f2f9f3] border border-[#c8ddb8] rounded-2xl px-4 py-3 text-center">
                    <p className="text-sm text-[var(--g-deep)] leading-relaxed">
                      📅 At <strong>{lessonsPerDay}</strong> lesson{perDayNum !== 1 ? "s" : ""}/day on{" "}
                      <strong>{selectedDayNames || "your school days"}</strong>,
                      <br />you&apos;ll finish <strong>{remaining} lesson{remaining !== 1 ? "s" : ""}</strong> by{" "}
                      <strong>{finishDate}</strong>.
                    </p>
                  </div>
                )}
                {targetDate && requiredPerDay !== null && requiredPerDay > perDayNum && (
                  <div className="bg-[#fef9e8] border border-[#f0dda8] rounded-2xl px-4 py-3">
                    <p className="text-sm text-[#7a4a1a] leading-relaxed">
                      ⚠️ To finish by{" "}
                      <strong>{new Date(targetDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong>,
                      you&apos;ll need <strong>{requiredPerDay} lessons/day</strong>.
                    </p>
                    <button onClick={() => setLessonsPerDay(String(requiredPerDay))}
                      className="mt-2 text-xs font-semibold text-[#7a4a1a] bg-[#f5e8d0] hover:bg-[#f0dda8] px-3 py-1.5 rounded-lg transition-colors">
                      Use {requiredPerDay} lessons/day →
                    </button>
                  </div>
                )}
                {targetDate && requiredPerDay !== null && requiredPerDay <= perDayNum && (
                  <div className="bg-[#f2f9f3] border border-[#c8ddb8] rounded-2xl px-4 py-2.5 text-center">
                    <p className="text-sm text-[var(--g-deep)] font-semibold">✓ You&apos;re on track to meet your goal!</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Backfill checkbox ──────────────────────────── */}
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  if (backfillEnabled && mode === "edit" && editBackfillCount > 0) {
                    setBackfillRemoveConfirm(true);
                  } else {
                    setBackfillEnabled(!backfillEnabled);
                  }
                }}
                className="shrink-0 mt-0.5 w-5 h-5 rounded border-[1.5px] flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: backfillEnabled ? "#2D5A3D" : "transparent",
                  borderColor: backfillEnabled ? "#2D5A3D" : "#e8e5e0",
                }}
              >
                {backfillEnabled && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <label className="text-[13px] text-[#5C5346] cursor-pointer" onClick={() => {
                  if (backfillEnabled && mode === "edit" && editBackfillCount > 0) {
                    setBackfillRemoveConfirm(true);
                  } else {
                    setBackfillEnabled(!backfillEnabled);
                  }
                }}>
                  I&apos;ve already started this curriculum (log my completed lessons too)
                </label>
                {backfillEnabled && (
                  <p className="text-[11px] text-[#8B7E74] mt-1">
                    {mode === "edit" && editBackfillCount > 0
                      ? `Pre-Rooted data already imported (${editBackfillCount} entries). Uncheck to remove it.`
                      : "We\u2019ll ask about your progress on the next step"}
                  </p>
                )}
              </div>
            </div>

            {/* Backfill remove confirmation */}
            {backfillRemoveConfirm && (
              <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
                  <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                    Remove pre-Rooted data?
                  </h2>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    This will remove {editBackfillCount} pre-Rooted lesson {editBackfillCount === 1 ? "entry" : "entries"}. Are you sure?
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setBackfillRemoveConfirm(false)}
                      className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!editData?.goalId) return;
                        setDeleting(true);
                        await supabase.from("lessons").delete()
                          .eq("curriculum_goal_id", editData.goalId)
                          .eq("is_backfill", true);
                        await supabase.from("curriculum_goals").update({ is_backfilled: false })
                          .eq("id", editData.goalId);
                        setBackfillEnabled(false);
                        setEditBackfillCount(0);
                        setBackfillRemoveConfirm(false);
                        setDeleting(false);
                        showToast?.("Pre-Rooted data removed");
                        onSaved();
                      }}
                      disabled={deleting}
                      className="flex-[2] py-2.5 rounded-xl bg-[#7a6f65] hover:bg-[#5c5248] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {deleting ? "Removing…" : "Yes, remove"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
              <button onClick={() => setStep((backfillEnabled ? backfillStep : confirmStep) as 4 | 5)} disabled={!step3Valid}
                className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                {mode === "edit" ? (backfillEnabled ? "Next →" : "Review Changes →") : (backfillEnabled ? "Next →" : "Generate My Schedule →")}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Backfill (when enabled) — simplified ── */}
        {step === 4 && backfillEnabled && (() => {
          const hoursPerLesson = ((parseInt(defaultMinutes) || 30) / 60).toFixed(1);
          const confirmed = backfillLessonsNum > 0 && backfillStartDate;

          return (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-xl font-bold text-[#2D2A26] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  Log your pre-Rooted lessons
                </h2>
                <p className="text-sm text-[#5C5346]">
                  We&apos;ll add these to your progress report so it tells the whole story.
                </p>
              </div>

              {/* Curriculum card */}
              <div className="bg-white border border-[#e8e5e0] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">📖</span>
                  <p className="text-[15px] font-semibold text-[#2D2A26]">{curricName || "Curriculum"}</p>
                </div>
                <p className="text-[13px] text-[#8B7E74] mb-4">
                  {startNum > 1
                    ? `You're currently on Lesson ${startNum}`
                    : "Log your pre-Rooted lessons?"}
                </p>

                {!confirmed ? (
                  <>
                    <p className="text-[13px] text-[#5C5346] mb-4">Log your pre-Rooted lessons?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const count = startNum > 1 ? startNum - 1 : 1;
                          setBackfillLessonsDone(String(count));
                          setBackfillMode("per_lesson");
                          // Auto-set start period to school year
                          setBackfillStartPeriod("school_year");
                        }}
                        className="flex-1 py-3 rounded-xl bg-[#2D5A3D] text-white font-semibold text-sm hover:opacity-90 transition-colors"
                      >
                        Yes, log them
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBackfillLessonsDone("0");
                          setBackfillEnabled(false);
                          setStep(confirmStep as 5);
                        }}
                        className="flex-1 py-3 rounded-xl border border-[#e8e5e0] text-[#5C5346] font-medium text-sm hover:bg-[#faf9f7] transition-colors"
                      >
                        No thanks
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-[#f2f9f3] border border-[#c8ddb8] rounded-xl px-4 py-3 mb-3">
                      <p className="text-sm text-[#2D5A3D] font-medium">
                        ✓ We&apos;ll log lessons 1–{backfillLessonsNum} on your school days
                      </p>
                    </div>

                    {/* Adjust details toggle */}
                    <button
                      type="button"
                      onClick={() => setBackfillShowDetails(!backfillShowDetails)}
                      className="text-[13px] text-[#8B7E74] hover:text-[#5C5346] flex items-center gap-1 transition-colors"
                    >
                      <span className="text-xs">{backfillShowDetails ? "▾" : "▸"}</span>
                      Adjust details
                    </button>

                    {backfillShowDetails && (
                      <div className="mt-3 space-y-3 pl-1">
                        <div>
                          <label className="text-xs text-[#8B7E74] block mb-1">Lessons to log</label>
                          <input
                            value={backfillLessonsDone}
                            onChange={(e) => setBackfillLessonsDone(e.target.value)}
                            type="number" min="1" max={totalNum}
                            className="w-32 px-3 py-2 rounded-xl border border-[#e8e5e0] bg-white text-sm text-[#2D2A26] focus:outline-none focus:border-[#5c7f63]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[#8B7E74] block mb-1">Hours per lesson</label>
                          <input
                            value={backfillTotalHours || hoursPerLesson}
                            onChange={(e) => setBackfillTotalHours(e.target.value)}
                            type="number" min="0.25" step="0.25"
                            className="w-32 px-3 py-2 rounded-xl border border-[#e8e5e0] bg-white text-sm text-[#2D2A26] focus:outline-none focus:border-[#5c7f63]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Option to decline after confirming */}
                    <button
                      type="button"
                      onClick={() => {
                        setBackfillLessonsDone("0");
                        setBackfillEnabled(false);
                        setStep(confirmStep as 5);
                      }}
                      className="mt-3 text-[12px] text-[#8B7E74] hover:text-[#5C5346] transition-colors"
                    >
                      No thanks, start fresh instead
                    </button>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep(3)}
                  className="flex-1 py-2.5 rounded-xl border border-[#e8e5e0] text-sm font-medium text-[#8B7E74] hover:bg-[#f0ede8] transition-colors">← Back</button>
                <button onClick={() => setStep(confirmStep as 5)} disabled={!confirmed}
                  className="flex-[2] py-2.5 rounded-2xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                  {mode === "edit" ? "Review Changes →" : "Generate My Schedule →"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── CONFIRM & GENERATE (Step 4 or 5) ────────────────── */}
        {step === confirmStep && (
          <div className="space-y-5">
            {!done && !generating && !error && (
              <>
                <div className="text-center">
                  <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                    {mode === "edit"
                      ? `Here's ${childObj?.name ?? "your"}'s schedule`
                      : `Here's ${childObj?.name ? `${childObj.name}'s` : "your"} plan`}
                  </h2>
                  <p className="text-sm text-[#7a6f65]">
                    {mode === "edit"
                      ? "Save to update the goal and reschedule lessons."
                      : "Looks good? We'll create all the lessons for you."}
                  </p>
                </div>

                <div className="bg-[#f8f7f4] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
                  {[
                    { label: "Curriculum",  value: curricName },
                    { label: "Subject",     value: effectiveSub || "Not specified" },
                    ...(mode === "create"
                      ? [{ label: "Lessons", value: `${startLesson} to ${totalLessons} (${remaining} to create)` }]
                      : [
                          { label: "Total lessons",   value: totalLessons },
                          { label: "Lessons done",    value: startLesson },
                        ]
                    ),
                    { label: "School days", value: selectedDayNames || "—" },
                    { label: "Per day",     value: `${lessonsPerDay} lesson${perDayNum !== 1 ? "s" : ""}` },
                    ...(finishDate && mode === "create" ? [{ label: "Finishes around", value: finishDate }] : []),
                    ...(targetDate ? [{ label: "Finish line date", value: new Date(targetDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) }] : []),
                    ...(lessonStartTime ? [{ label: "Lesson time", value: (() => { const [h, m] = lessonStartTime.split(":").map(Number); const ampm = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`; })() }] : []),
                    ...(defaultNotes.trim() ? [{ label: "Lesson notes", value: defaultNotes.trim() }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#b5aca4] shrink-0">{label}</span>
                      <span className="text-sm font-medium text-[#2d2926] text-right">{value}</span>
                    </div>
                  ))}

                  {childHasTranscript && (courseLevel !== "standard" || creditsValue) && (
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="text-[#8a8580]">Transcript:</span>
                      <span className="text-[#3c3a37] font-medium">
                        {courseLevel !== "standard" && (
                          <span className="mr-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e8f0e9] text-[#2D5A3D]">
                            {courseLevel === "ap" ? "AP" : courseLevel === "honors" ? "Honors" : "DE"}
                          </span>
                        )}
                        {creditsValue && `${creditsValue} credits`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Backfill summary card */}
                {backfillEnabled && backfillLessonsNum > 0 && (
                  <div className="bg-[#fdf8ef] border border-[#f0e6d0] rounded-2xl p-4 space-y-2 relative">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-[#2d2926]">📦 Pre-Rooted Import</p>
                      <button
                        type="button"
                        onClick={() => {
                          setBackfillEnabled(false);
                          setBackfillLessonsDone("0");
                        }}
                        className="text-[14px] text-[#8B7E74] hover:text-[#5C5346] transition-colors leading-none"
                        title="Remove backfill"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-1">
                      {[
                        { label: "Total hours", value: backfillMode === "per_lesson"
                          ? `${((backfillLessonsNum * (parseInt(defaultMinutes) || 30)) / 60).toFixed(1)} hrs`
                          : `${backfillHoursNum} hrs` },
                        { label: "Lessons", value: `${backfillLessonsNum}` },
                        { label: "Date range", value: `${new Date(backfillStartDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – yesterday` },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-baseline justify-between gap-3">
                          <span className="text-xs text-[#b5aca4]">{label}</span>
                          <span className="text-xs font-medium text-[#2d2926]">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {backfillEnabled && backfillLessonsNum > 0 && mode === "create" && (
                  <p className="text-xs text-[#7a6f65] text-center">
                    This will create {remaining} future lessons + {backfillLessonsNum} backfilled {backfillLessonsNum === 1 ? "entry" : "entries"}
                  </p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setStep(backfillEnabled ? backfillStep as 4 : 3)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
                  <button onClick={mode === "edit" ? saveEdit : generate}
                    className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white font-semibold text-sm transition-colors">
                    {mode === "edit" ? "Save Changes ✓" : `Create ${remaining + (backfillEnabled ? backfillLessonsNum : 0)} Lessons ✓`}
                  </button>
                </div>
              </>
            )}

            {error && !generating && !done && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 space-y-2">
                <p className="text-sm font-semibold text-red-700">Something went wrong</p>
                <p className="text-xs text-red-600">{error}</p>
                <button onClick={() => setError(null)}
                  className="text-xs font-semibold text-red-700 underline">Try again</button>
              </div>
            )}

            {generating && (
              <div className="text-center py-10 space-y-4">
                <div className="text-4xl animate-spin inline-block">🌿</div>
                <p className="font-semibold text-[#2d2926]">
                  {mode === "edit" ? "Saving changes…" : "Building your schedule…"}
                </p>
                {mode === "create" && (
                  <p className="text-sm text-[#7a6f65]">Creating {remaining} lessons across your school days.</p>
                )}
              </div>
            )}

            {done && (
              <div className="text-center py-6 space-y-4">
                <div className="text-5xl">🌿</div>
                <div>
                  <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                    {mode === "edit" ? "Curriculum updated!" : `${genCount} lessons scheduled!`}
                  </h2>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    {mode === "edit"
                      ? "Your changes have been saved and lessons rescheduled."
                      : "Your plan is ready. Each lesson is on your calendar — just check them off as you go."}
                  </p>
                </div>

                {mode === "create" && (
                  <div className="flex flex-col gap-2 items-center">
                    <button onClick={resetForAnotherCurriculum}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border-2 border-[#5c7f63] text-[var(--g-deep)] text-sm font-semibold hover:bg-[#e8f0e9] transition-colors">
                      <BookOpen size={14} />+ New Curriculum for {childObj?.name ?? "this child"}
                    </button>
                    <button onClick={onClose}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors shadow-sm">
                      View my plan →
                    </button>
                  </div>
                )}

                {mode === "edit" && (
                  <button onClick={onClose}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors shadow-sm">
                    Done →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
