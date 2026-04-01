"use client";

import { useState, useEffect } from "react";
import { X, BookOpen } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

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
};

interface Props {
  mode: "create" | "edit";
  editData?: CurriculumWizardEditData;
  initialChildId?: string;
  onClose: () => void;
  onSaved: () => void;
  showToast?: (msg: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SUBJECT_CHIPS = [
  { label: "Math",          bg: "#e4f0f4", text: "#1a4a5a" },
  { label: "Reading",       bg: "#f0e8f4", text: "#4a2a5a" },
  { label: "Language Arts", bg: "#ede8f4", text: "#3a2a6a" },
  { label: "Science",       bg: "#e8f0e9", text: "#3d5c42" },
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
  return DAY_LABELS.filter((_, i) => bools[i]);
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
  onClose,
  onSaved,
  showToast,
}: Props) {
  const { effectiveUserId } = usePartner();
  const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  // ── Children ──────────────────────────────────────────────────────────────
  const [children, setChildren] = useState<Child[]>([]);

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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => {
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

  const [lessonsPerDay, setLessonsPerDay] = useState("1");
  const [defaultMinutes, setDefaultMinutes] = useState("30");
  const [targetDate, setTargetDate] = useState(editData?.targetDate ?? "");

  // Track curricula saved so far for the current child (for "Added so far" pills)
  const [savedForThisChild, setSavedForThisChild] = useState<Array<{ name: string; lessons: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [genCount, setGenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
  const step3Valid       = schoolDays.some(Boolean) && perDayNum > 0;

  function calcFinishDate(perDay?: number): string {
    const pd = perDay ?? perDayNum;
    if (remaining === 0 || pd <= 0 || !schoolDays.some(Boolean)) return "";
    const daysNeeded = Math.ceil(remaining / pd);
    let cnt = 0;
    const cursor = new Date(todayMidnight);
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
    if (isNaN(goal.getTime()) || goal < todayMidnight) return null;
    if (remaining === 0) return null;
    let schoolDayCount = 0;
    const cursor = new Date(todayMidnight);
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

    // Save curriculum_goal
    const { data: goalData, error: goalErr } = await supabase
      .from("curriculum_goals")
      .insert({
        user_id: user.id,
        child_id: childId || null,
        curriculum_name: curricName.trim(),
        subject_label: effectiveSub || null,
        total_lessons: totalNum,
        current_lesson: startNum - 1,
        target_date: targetDate || null,
        school_days: booleanToDays(schoolDays),
        default_minutes: parseInt(defaultMinutes) || 30,
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

    // Build schedule
    const rows: { date: string; n: number }[] = [];
    let lessonNum = startNum;
    const cursor = new Date(todayMidnight);
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

    // Dedup guard
    await supabase
      .from("lessons")
      .delete()
      .eq("user_id", user.id)
      .eq("child_id", childId || null)
      .ilike("title", `${curricName.trim()} — Lesson%`)
      .eq("completed", false);

    const inserts = rows.map(({ date, n }) => ({
      user_id: user.id,
      child_id: childId || null,
      subject_id: subjectId,
      title: `${curricName.trim()} — Lesson ${n}`,
      date,
      scheduled_date: date,
      completed: false,
      hours: 0,
      curriculum_goal_id: goalId,
      lesson_number: n,
    }));

    for (let i = 0; i < inserts.length; i += 100) {
      const { error: insertErr } = await supabase.from("lessons").insert(inserts.slice(i, i + 100));
      if (insertErr) {
        setGenerating(false);
        setError(`Failed to save lessons: ${insertErr.message}`);
        return;
      }
    }

    setGenCount(rows.length);
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

    if (activeGoalId) {
      // Update existing goal
      const updatePayload = {
        curriculum_name: curricName.trim(),
        subject_label: effectiveSub || null,
        total_lessons: totalNum,
        current_lesson: parseInt(startLesson) || 0,
        target_date: targetDate || null,
        school_days: booleanToDays(schoolDays),
        default_minutes: parseInt(defaultMinutes) || 30,
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
          curriculum_name: curricName.trim(),
          subject_label: effectiveSub || null,
          total_lessons: totalNum,
          current_lesson: parseInt(startLesson) || 0,
          target_date: targetDate || null,
          school_days: booleanToDays(schoolDays),
          default_minutes: parseInt(defaultMinutes) || 30,
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

    // Reschedule incomplete future lessons
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
      const updates: { id: string; date: string }[] = [];
      const cursor = new Date(todayMidnight);
      for (const lesson of futureLessons) {
        let safety = 0;
        while (safety < 3650) {
          const dayIdx = (cursor.getDay() + 6) % 7;
          if (schoolDays[dayIdx]) {
            for (let i = 0; i < perDayNum; i++) {
              updates.push({ id: lesson.id, date: toDateStr(cursor) });
              break;
            }
            cursor.setDate(cursor.getDate() + 1);
            break;
          }
          cursor.setDate(cursor.getDate() + 1);
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

    setGenerating(false);
    setDone(true);
    showToast?.("✓ Curriculum updated!");
    onSaved();
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

        <WizardProgress step={step} total={4} />

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
                  className="inline-block px-5 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors">
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
                className="w-full py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
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
                      <span className="text-[#3d5c42] text-xs">✓</span>
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
                <p className="text-[10px] text-[#b5aca4] mt-1">
                  {mode === "edit" ? "Completed so far" : "Mid-curriculum? e.g. 45"}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Minutes per lesson</label>
              <input value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)}
                type="number" min="5" max="300" placeholder="30"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <p className="text-[10px] text-[#b5aca4] mt-1">Used to calculate your total hours</p>
            </div>

            <div className="flex gap-2">
              {mode === "create" && (
                <button onClick={() => setStep(1)}
                  className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
              )}
              <button onClick={() => setStep(3)} disabled={!step2Valid}
                className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                Next →
              </button>
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
                Lessons per school day <span className="normal-case font-normal text-[#b5aca4]">(default: 1)</span>
              </label>
              <input value={lessonsPerDay} onChange={(e) => setLessonsPerDay(e.target.value)}
                type="number" min="1" max="10" placeholder="1"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
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
                    <p className="text-sm text-[#3d5c42] leading-relaxed">
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
                    <p className="text-sm text-[#3d5c42] font-semibold">✓ You&apos;re on track to meet your goal!</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
              <button onClick={() => setStep(4)} disabled={!step3Valid}
                className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                {mode === "edit" ? "Review Changes →" : "Generate My Schedule →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Confirm & Generate ────────────────────── */}
        {step === 4 && (
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
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#b5aca4] shrink-0">{label}</span>
                      <span className="text-sm font-medium text-[#2d2926] text-right">{value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setStep(3)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">← Back</button>
                  <button onClick={mode === "edit" ? saveEdit : generate}
                    className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-sm transition-colors">
                    {mode === "edit" ? "Save Changes ✓" : `Create ${remaining} Lessons ✓`}
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
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border-2 border-[#5c7f63] text-[#3d5c42] text-sm font-semibold hover:bg-[#e8f0e9] transition-colors">
                      <BookOpen size={14} />+ New Curriculum for {childObj?.name ?? "this child"}
                    </button>
                    <button onClick={onClose}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors shadow-sm">
                      View my plan →
                    </button>
                  </div>
                )}

                {mode === "edit" && (
                  <button onClick={onClose}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors shadow-sm">
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
