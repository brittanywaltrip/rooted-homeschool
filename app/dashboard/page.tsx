"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import FinishLineSection from '@/components/FinishLineSection';
import GardenScene, { STAGE_INFO, LEAF_THRESHOLDS, getStageFromLeaves } from "@/components/GardenScene";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type Lesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string;
  hours: number | null;
  subjects: { name: string; color: string | null } | null;
  curriculum_goal_id?: string | null;
  lesson_number?: number | null;
};

type BookLog = {
  id: string;
  payload: { title: string; child_id?: string; date: string };
};

type Subject = { id: string; name: string; color: string | null };

// ─── Constants ────────────────────────────────────────────────────────────────

const QUOTES = [
  "Education is not the filling of a pail, but the lighting of a fire.",
  "Every child is a different kind of flower, and together they make this world a beautiful garden.",
  "The beautiful thing about learning is that no one can take it away from you.",
  "Children learn more from what you are than what you teach.",
  "The roots of education are bitter, but the fruit is sweet.",
  "Play is the highest form of research.",
  "It's not that I'm so smart. It's just that I stay with problems longer.",
];

const STAGES = STAGE_INFO.map((s, i) => ({
  name:  s.name,
  desc:  s.desc,
  color: s.color,
  min:   LEAF_THRESHOLDS[i],
  max:   LEAF_THRESHOLDS[i + 1] !== undefined ? LEAF_THRESHOLDS[i + 1] - 1 : Infinity,
}));

const ONBOARD_COLORS = [
  { label: "Green",  value: "#5c7f63" },
  { label: "Sage",   value: "#7a9e7e" },
  { label: "Blue",   value: "#4a7a8a" },
  { label: "Indigo", value: "#5a5c8a" },
  { label: "Purple", value: "#7a5c8a" },
  { label: "Orange", value: "#c4956a" },
  { label: "Pink",   value: "#c4697a" },
];


// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStageIndex(leaves: number) {
  return getStageFromLeaves(leaves) - 1;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getSubjectStyle(subjectName: string | undefined): { bg: string; text: string } {
  if (!subjectName) return { bg: "#f0ede8", text: "#5c5248" };
  const n = subjectName.toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry") || n.includes("calculus"))
    return { bg: "#e4f0f4", text: "#1a4a5a" };
  if (n.includes("read") || n.includes("language") || n.includes("english") || n.includes("writing") || n.includes("grammar") || n.includes("lit") || n.includes("spelling") || n.includes("phonics"))
    return { bg: "#f0e8f4", text: "#4a2a5a" };
  if (n.includes("science") || n.includes("biology") || n.includes("chemistry") || n.includes("physics") || n.includes("nature"))
    return { bg: "#e8f0e9", text: "#3d5c42" };
  if (n.includes("history") || n.includes("social") || n.includes("geography") || n.includes("civics") || n.includes("government"))
    return { bg: "#fef0e4", text: "#7a4a1a" };
  if (n.includes("art") || n.includes("music") || n.includes("drama") || n.includes("theater") || n.includes("craft") || n.includes("draw"))
    return { bg: "#fce8ec", text: "#7a2a36" };
  return { bg: "#f0ede8", text: "#5c5248" };
}

// ─── Floating Leaves Celebration ──────────────────────────────────────────────

function FloatingLeaves({ active }: { active: boolean }) {
  if (!active) return null;
  const items = [
    { emoji: "🍃", left: "28%", delay: "0s" },
    { emoji: "🌿", left: "40%", delay: "0.1s" },
    { emoji: "🍃", left: "52%", delay: "0.2s" },
    { emoji: "🌱", left: "35%", delay: "0.15s" },
    { emoji: "🍀", left: "60%", delay: "0.25s" },
    { emoji: "🍃", left: "47%", delay: "0.05s" },
    { emoji: "🌿", left: "65%", delay: "0.3s" },
    { emoji: "🌱", left: "22%", delay: "0.18s" },
  ];
  return (
    <div className="fixed inset-0 pointer-events-none z-[60]" aria-hidden>
      {items.map((item, i) => (
        <span
          key={i}
          className="leaf-float-up absolute text-2xl"
          style={{ left: item.left, bottom: "35%", animationDelay: item.delay }}
        >
          {item.emoji}
        </span>
      ))}
    </div>
  );
}

// ─── Growth Tree Card ──────────────────────────────────────────────────────────

function GrowthTreeCard({ leaves, childName }: { leaves: number; childName: string }) {
  const stageIdx  = getStageIndex(leaves);
  const stage     = STAGES[stageIdx];
  const nextStage = STAGES[stageIdx + 1];
  const progress  = nextStage ? ((leaves - stage.min) / (nextStage.min - stage.min)) * 100 : 100;

  return (
    <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5 flex gap-5 items-center">
      <div className="w-24 h-24 shrink-0">
        <GardenScene leafCount={leaves} compact />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-widest text-[#5c7f63] mb-0.5">{childName}</p>
        <h3 className="text-xl font-bold text-[#2d2926] leading-tight">{stage.name}</h3>
        <p className="text-sm text-[#5c7f63] mb-3">{stage.desc}</p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">🍃</span>
          <span className="text-sm font-semibold text-[#2d2926]">
            {leaves} {leaves === 1 ? "leaf" : "leaves"}
          </span>
          {nextStage && (
            <span className="text-xs text-[#7a6f65]">· {nextStage.min - leaves} to {nextStage.name}</span>
          )}
        </div>
        <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: stage.color }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Today Lesson Card ────────────────────────────────────────────────────────

function TodayLessonCard({
  lesson, childObj, onToggle, onEdit, onDelete, isPartner,
}: {
  lesson:    Lesson;
  childObj:  Child | undefined;
  onToggle:  (id: string, current: boolean) => void;
  onEdit:    (lesson: Lesson) => void;
  onDelete:  (id: string) => void;
  isPartner: boolean;
}) {
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [showLeaf,  setShowLeaf]  = useState(false);
  const prevCompleted = useRef(lesson.completed);

  useEffect(() => {
    if (!prevCompleted.current && lesson.completed) {
      setShowLeaf(true);
      const t = setTimeout(() => setShowLeaf(false), 1300);
      prevCompleted.current = true;
      return () => clearTimeout(t);
    }
    prevCompleted.current = lesson.completed;
  }, [lesson.completed]);

  const subStyle    = getSubjectStyle(lesson.subjects?.name);
  const borderColor = childObj?.color ?? subStyle.text;

  function handleClick(e: React.MouseEvent) {
    if ((e.target as Element).closest("[data-no-toggle]")) return;
    onToggle(lesson.id, lesson.completed);
  }

  return (
    <div
      className={`relative flex items-center gap-3 px-4 rounded-2xl border transition-all cursor-pointer select-none ${
        lesson.completed
          ? "bg-[#f0f7f1] border-[#c2dbc5]"
          : "bg-[#fefcf9] border-[#e8e2d9] active:bg-[#f0f7f1]"
      }`}
      style={{ minHeight: "56px", borderLeftWidth: "4px", borderLeftColor: borderColor }}
      onClick={handleClick}
    >
      {/* 32px circular checkbox */}
      <div
        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
          lesson.completed ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5]"
        }`}
      >
        {lesson.completed && (
          <svg viewBox="0 0 10 8" className="w-3.5 h-2.5 fill-none">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-3.5">
        {lesson.subjects && (
          <span
            className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: subStyle.bg, color: subStyle.text }}
          >
            {lesson.subjects.name}
          </span>
        )}
        <p className={`text-sm font-medium leading-snug ${
          lesson.completed ? "line-through text-[#9a948e]" : "text-[#2d2926]"
        }`}>
          {lesson.title}
        </p>
        {lesson.hours != null && lesson.hours > 0 && (
          <p className="text-xs text-[#b5aca4] mt-0.5">{lesson.hours}h</p>
        )}
      </div>

      {/* Leaf pop animation */}
      {showLeaf && (
        <span
          className="leaf-card-pop absolute text-xl"
          style={{ right: "48px", top: "4px" }}
        >
          🍃
        </span>
      )}

      {/* 3-dot menu */}
      {!isPartner && (
        <div className="relative shrink-0" data-no-toggle>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
            aria-label="Lesson options"
            data-no-toggle
          >
            <span className="text-base leading-none">···</span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
              <div className="absolute right-0 top-9 bg-white border border-[#e8e2d9] rounded-xl shadow-lg z-30 overflow-hidden min-w-[110px]">
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(lesson); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(lesson.id); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                  data-no-toggle
                >
                  🗑 Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const today = new Date().toISOString().split("T")[0];
  const quote = QUOTES[new Date().getDay() % QUOTES.length];
  const { isPartner, effectiveUserId } = usePartner();

  const [familyName,       setFamilyName]       = useState("");
  const [onboarded,        setOnboarded]        = useState<boolean | null>(null);
  const [children,         setChildren]         = useState<Child[]>([]);
  const [lessons,          setLessons]          = useState<Lesson[]>([]);
  const [leafCounts,       setLeafCounts]       = useState<Record<string, number>>({});
  const [selectedChildId,  setSelectedChildId]  = useState<string>("all");
  const [reflectionText,   setReflectionText]   = useState("");
  const [reflectionExists, setReflectionExists] = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [savedFlash,       setSavedFlash]       = useState(false);
  const [loading,          setLoading]          = useState(true);
  const [celebrating,      setCelebrating]      = useState(false);

  // Books
  const [todayBooks,    setTodayBooks]    = useState<BookLog[]>([]);
  const [showBookModal, setShowBookModal] = useState(false);
  const [bookTitle,     setBookTitle]     = useState("");
  const [bookChild,     setBookChild]     = useState("");
  const [savingBook,    setSavingBook]    = useState(false);

  // Banner dismiss state — shared by both the setup banner and welcome banner.
  // Backed by sessionStorage key "setup-banner-dismissed" so it persists across reloads.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("setup-banner-dismissed") === "1") {
      setBannerDismissed(true);
    }
  }, []);

  // PWA install banner
  const [showPwaBanner, setShowPwaBanner] = useState(false);
  const [showPwaModal,  setShowPwaModal]  = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem("pwa-banner-dismissed") === "true";
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!dismissed && !standalone) setShowPwaBanner(true);
  }, []);

  // Add lesson modal
  const [subjects,        setSubjects]        = useState<Subject[]>([]);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [lessonChildId,   setLessonChildId]   = useState("");
  const [lessonSubject,   setLessonSubject]   = useState("");
  const [lessonTitle,     setLessonTitle]     = useState("");
  const [lessonHours,     setLessonHours]     = useState("");
  const [savingLesson,    setSavingLesson]    = useState(false);

  // Edit lesson modal
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editSubject,   setEditSubject]   = useState("");
  const [editHours,     setEditHours]     = useState("");
  const [editChildId,   setEditChildId]   = useState("");
  const [savingEdit,    setSavingEdit]    = useState(false);

  // Quick log sheet
  const [showQuickLog,  setShowQuickLog]  = useState(false);
  const [qlMode,        setQlMode]        = useState<null | "book" | "project" | "field_trip" | "extra">(null);
  const [qlTitle,       setQlTitle]       = useState("");
  const [qlChild,       setQlChild]       = useState("");
  const [qlChildrenIds, setQlChildrenIds] = useState<string[]>([]);
  const [qlNotes,       setQlNotes]       = useState("");
  const [qlSubject,     setQlSubject]     = useState("");
  const [savingQL,      setSavingQL]      = useState(false);
  const [showToast,     setShowToast]     = useState(false);
  const [qlError,       setQlError]       = useState("");

  // ── Leaf count refresh ────────────────────────────────────────────────────

  const refreshLeafCounts = useCallback(async () => {
    if (!effectiveUserId) return;
    const [{ data: completed }, { data: bookEvents }, { data: memEvents }] = await Promise.all([
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
    ]);
    const counts: Record<string, number> = {};
    completed?.forEach((l) => {
      if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
    });
    bookEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    memEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    setLeafCounts(counts);
  }, [effectiveUserId]);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: profile }, { data: { user: authUser } }] = await Promise.all([
      supabase.from("profiles").select("display_name, onboarded").eq("id", effectiveUserId).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);

    const { data: childrenData } = await supabase
      .from("children").select("id, name, color")
      .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order");
    setChildren(childrenData ?? []);

    const { data: lessonsData } = await supabase
      .from("lessons")
      .select("id, title, completed, child_id, hours, subjects(name, color), curriculum_goal_id, lesson_number")
      .eq("user_id", effectiveUserId)
      .or(`date.eq.${today},scheduled_date.eq.${today}`);
    setLessons((lessonsData as unknown as Lesson[]) ?? []);

    const [{ data: completed }, { data: bookEvents }, { data: memEvents }] = await Promise.all([
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
    ]);

    const counts: Record<string, number> = {};
    completed?.forEach((l) => {
      if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
    });
    bookEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    memEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    setLeafCounts(counts);

    const { data: todayBooksData } = await supabase
      .from("app_events").select("id, payload")
      .eq("user_id", effectiveUserId).eq("type", "book_read")
      .filter("payload->>date", "eq", today);
    setTodayBooks((todayBooksData as unknown as BookLog[]) ?? []);

    const { data: subjectsData } = await supabase
      .from("subjects").select("id, name, color")
      .eq("user_id", effectiveUserId).order("name");
    setSubjects((subjectsData as Subject[]) ?? []);

    const { data: reflectionData } = await supabase
      .from("daily_reflections").select("reflection")
      .eq("user_id", effectiveUserId).eq("date", today).maybeSingle();
    if (reflectionData) {
      setReflectionText(reflectionData.reflection ?? "");
      setReflectionExists(true);
    }

    setLoading(false);
  }, [today, effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);


  // ── Lesson actions ────────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    const lesson = lessons.find((l) => l.id === id);
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, completed: !current } : l)));
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);

    if (!current) {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1600);

      if (lesson?.curriculum_goal_id && lesson?.lesson_number) {
        const { data: goalRow } = await supabase
          .from("curriculum_goals")
          .select("current_lesson")
          .eq("id", lesson.curriculum_goal_id)
          .single();
        if (goalRow && lesson.lesson_number > goalRow.current_lesson) {
          await supabase
            .from("curriculum_goals")
            .update({ current_lesson: lesson.lesson_number })
            .eq("id", lesson.curriculum_goal_id);
        }
      }
    }

    await refreshLeafCounts();
  }

  function openEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    setEditTitle(lesson.title);
    setEditSubject(lesson.subjects?.name ?? "");
    setEditHours(lesson.hours != null ? String(lesson.hours) : "");
    setEditChildId(lesson.child_id ?? "");
  }

  async function saveEdit() {
    if (!editingLesson || !editTitle.trim()) return;
    setSavingEdit(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingEdit(false); return; }

    let subjectId: string | null = null;
    if (editSubject.trim()) {
      const existing = subjects.find(
        (s) => s.name.toLowerCase() === editSubject.trim().toLowerCase()
      );
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase
          .from("subjects").insert({ user_id: user.id, name: editSubject.trim() })
          .select("id, name, color").single();
        if (newSub) {
          setSubjects((prev) => [...prev, newSub as Subject]);
          subjectId = newSub.id;
        }
      }
    }

    await supabase.from("lessons").update({
      title:      editTitle.trim(),
      subject_id: subjectId,
      hours:      editHours ? parseFloat(editHours) : null,
      child_id:   editChildId || null,
    }).eq("id", editingLesson.id);

    setLessons((prev) => prev.map((l) => {
      if (l.id !== editingLesson.id) return l;
      const subName = editSubject.trim();
      return {
        ...l,
        title:    editTitle.trim(),
        subjects: subName ? { name: subName, color: l.subjects?.color ?? null } : null,
        hours:    editHours ? parseFloat(editHours) : null,
        child_id: editChildId || l.child_id,
      };
    }));

    setSavingEdit(false);
    setEditingLesson(null);
  }

  async function deleteLesson(id: string) {
    setLessons((prev) => prev.filter((l) => l.id !== id));
    await supabase.from("lessons").delete().eq("id", id);
    await refreshLeafCounts();
  }

  // ── Add lesson ────────────────────────────────────────────────────────────

  async function saveBook() {
    if (!bookTitle.trim()) return;
    setSavingBook(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingBook(false); return; }

    const payload = { title: bookTitle.trim(), child_id: bookChild || undefined, date: today };
    const { data } = await supabase
      .from("app_events").insert({ user_id: user.id, type: "book_read", payload })
      .select("id, payload").single();

    if (data) {
      setTodayBooks((prev) => [...prev, data as unknown as BookLog]);
      if (bookChild) {
        setLeafCounts((prev) => ({ ...prev, [bookChild]: (prev[bookChild] ?? 0) + 1 }));
      }
    }
    setBookTitle(""); setBookChild(""); setSavingBook(false); setShowBookModal(false);
  }

  function openLessonModal() {
    setLessonChildId(children.length === 1 ? children[0].id : "");
    setLessonSubject(""); setLessonTitle(""); setLessonHours("");
    setShowLessonModal(true);
  }

  async function saveLesson() {
    if (!lessonTitle.trim()) return;
    setSavingLesson(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingLesson(false); return; }

    let subjectId: string | null = null;
    if (lessonSubject.trim()) {
      const existing = subjects.find(
        (s) => s.name.toLowerCase() === lessonSubject.trim().toLowerCase()
      );
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSubject } = await supabase
          .from("subjects").insert({ user_id: user.id, name: lessonSubject.trim() })
          .select("id, name, color").single();
        if (newSubject) {
          setSubjects((prev) => [...prev, newSubject as Subject]);
          subjectId = newSubject.id;
        }
      }
    }

    const { data: newLesson } = await supabase
      .from("lessons")
      .insert({
        user_id:    user.id,
        child_id:   lessonChildId || null,
        subject_id: subjectId,
        title:      lessonTitle.trim(),
        hours:      lessonHours ? parseFloat(lessonHours) : null,
        completed:  true,
        date:       today,
      })
      .select("id, title, completed, child_id, hours, subjects(name, color)")
      .single();

    if (newLesson) {
      setLessons((prev) => [...prev, newLesson as unknown as Lesson]);
      if (lessonChildId) {
        setLeafCounts((prev) => ({
          ...prev,
          [lessonChildId]: (prev[lessonChildId] ?? 0) + 1,
        }));
      }
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1600);
    }

    setSavingLesson(false);
    setShowLessonModal(false);
  }

  // ── Quick Log ─────────────────────────────────────────────────────────────

  function openQuickLog() {
    setQlMode(null);
    setQlTitle(""); setQlChild(""); setQlChildrenIds([]); setQlNotes(""); setQlSubject("");
    setShowQuickLog(true);
  }

  function closeQuickLog() {
    setShowQuickLog(false);
    setTimeout(() => setQlMode(null), 300);
  }

  async function saveQuickLog() {
    if (!qlTitle.trim()) return;
    setSavingQL(true);
    setQlError("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSavingQL(false); return; }

      if (qlMode === "book") {
        const payload = {
          title:       qlTitle.trim(),
          child_id:    qlChild || undefined,
          date:        today,
          description: qlNotes.trim() || undefined,
        };
        const { error } = await supabase.from("app_events").insert({ user_id: user.id, type: "memory_book", payload });
        if (error) throw error;

      } else if (qlMode === "project") {
        const payload = {
          title:       qlTitle.trim(),
          child_id:    qlChild || undefined,
          date:        today,
          description: qlNotes.trim() || undefined,
          subject:     qlSubject.trim() || undefined,
        };
        const { error } = await supabase.from("app_events").insert({ user_id: user.id, type: "memory_project", payload });
        if (error) throw error;

      } else if (qlMode === "field_trip") {
        const ids = qlChildrenIds.length > 0 ? qlChildrenIds : [qlChild || ""];
        const results = await Promise.all(ids.map((cid) => {
          const payload = {
            title:       qlTitle.trim(),
            child_id:    cid || undefined,
            date:        today,
            description: qlNotes.trim() || undefined,
          };
          return supabase.from("app_events").insert({ user_id: user.id, type: "memory_field_trip", payload });
        }));
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;

      } else if (qlMode === "extra") {
        let subjectId: string | null = null;
        if (qlSubject.trim()) {
          const existing = subjects.find((s) => s.name.toLowerCase() === qlSubject.trim().toLowerCase());
          if (existing) {
            subjectId = existing.id;
          } else {
            const { data: newSub } = await supabase
              .from("subjects").insert({ user_id: user.id, name: qlSubject.trim() })
              .select("id, name, color").single();
            if (newSub) {
              setSubjects((prev) => [...prev, newSub as Subject]);
              subjectId = newSub.id;
            }
          }
        }

        const { data: newLesson, error: lessonError } = await supabase.from("lessons").insert({
          user_id:    user.id,
          child_id:   qlChild || null,
          subject_id: subjectId,
          title:      qlTitle.trim(),
          completed:  true,
          date:       today,
        }).select("id, title, completed, child_id, hours, subjects(name, color)").single();

        if (lessonError) throw lessonError;

        if (newLesson) {
          setLessons((prev) => [...prev, newLesson as unknown as Lesson]);
          setCelebrating(true);
          setTimeout(() => setCelebrating(false), 1600);
        }

        // Also save as memory
        const { error: memError } = await supabase.from("app_events").insert({
          user_id: user.id,
          type:    "memory_project",
          payload: { title: qlTitle.trim(), child_id: qlChild || undefined, date: today, description: qlNotes.trim() || undefined },
        });
        if (memError) throw memError;
      }

      await refreshLeafCounts();
      setSavingQL(false);
      closeQuickLog();
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
    } catch (err) {
      setSavingQL(false);
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setQlError(msg);
      setTimeout(() => setQlError(""), 3500);
    }
  }

  async function saveReflection() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("daily_reflections").upsert(
      { user_id: user.id, date: today, reflection: reflectionText, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date" }
    );

    setSaving(false);
    setReflectionExists(true);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredLessons = selectedChildId === "all"
    ? lessons
    : lessons.filter((l) => l.child_id === selectedChildId);

  const treeLeaves = selectedChildId === "all"
    ? children.reduce((sum, c) => sum + (leafCounts[c.id] ?? 0), 0)
    : leafCounts[selectedChildId] ?? 0;

  const treeLabel = selectedChildId === "all"
    ? (familyName || "Your Family")
    : (children.find((c) => c.id === selectedChildId)?.name ?? "");

  const completedToday = filteredLessons.filter((l) => l.completed).length;
  const totalToday     = filteredLessons.length;
  const progressPct    = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;
  const allDone        = totalToday > 0 && completedToday === totalToday;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">🌿</span>
          <p className="text-sm text-[#7a6f65]">Tending your garden…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">

      {/* ── Setup Banner (skipped onboarding, no children) ─── */}
      {onboarded === true && children.length === 0 && !bannerDismissed && (
        <div className="relative flex items-center justify-between gap-4 bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4">
          <p className="text-sm text-[#2d2926] font-medium leading-snug">
            🌱 Finish setting up your homeschool — you haven&apos;t added any children yet.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/onboarding"
              className="bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
            >
              Add a Child →
            </Link>
            <button
              onClick={() => {
                sessionStorage.setItem("setup-banner-dismissed", "1");
                setBannerDismissed(true);
              }}
              aria-label="Dismiss"
              className="w-7 h-7 flex items-center justify-center rounded-full text-[#5c7f63] hover:bg-[#b8d9bc]/50 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Welcome Banner ─────────────────────────────────── */}
      {children.length === 0 && onboarded !== true && !bannerDismissed && (
        <div className="relative bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5">
          <button
            onClick={() => {
              sessionStorage.setItem("setup-banner-dismissed", "1");
              setBannerDismissed(true);
            }}
            aria-label="Dismiss"
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-[#5c7f63] hover:bg-[#b8d9bc]/50 transition-colors text-lg leading-none"
          >
            ×
          </button>
          <h2 className="text-lg font-bold text-[#2d2926] mb-1">Welcome to Rooted! 🌿</h2>
          <p className="text-sm text-[#5c7f63] mb-4">Let&apos;s get your family set up in 3 easy steps</p>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            {[
              { step: "1", label: "Add a child",                dest: "Onboarding", href: "/onboarding" },
              { step: "2", label: "Add your curriculum",        dest: "Plan",        href: "/dashboard/plan" },
              { step: "3", label: "Check off your first lesson", dest: "Today",      href: "#" },
            ].map(({ step, label, dest, href }) => (
              <Link
                key={step}
                href={href}
                className="flex-1 flex items-center gap-2.5 bg-white/70 hover:bg-white border border-[#b8d9bc] rounded-xl px-3.5 py-3 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-[#5c7f63] text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {step}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#2d2926] leading-tight">{label}</p>
                  <p className="text-[10px] text-[#7a6f65]">→ {dest}</p>
                </div>
              </Link>
            ))}
          </div>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            Add your first child →
          </Link>
        </div>
      )}

      {/* ── Date & Greeting ──────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          {formatDate(new Date())}
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">
          {getGreeting()}{familyName ? `, ${familyName.replace(/^The\s+/i, "").trim() || familyName}` : ""}! 👋
        </h1>
      </div>

      {/* ── Lesson Checklist ─────────────────────────────── */}
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">
            Today&apos;s Lessons
          </h2>
          {!isPartner && (
            <button
              onClick={openLessonModal}
              className="text-xs font-medium text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1 rounded-full transition-colors"
            >
              + Add Lesson
            </button>
          )}
        </div>

        {/* Progress bar */}
        {totalToday > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-[#7a6f65]">
                {completedToday} of {totalToday} lessons done today
              </span>
              <span className="text-sm font-semibold text-[#5c7f63]">{progressPct}%</span>
            </div>
            <div className="w-full h-1.5 bg-[#e8e2d9] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#5c7f63] rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Celebration banner */}
        {allDone && (
          <div className="mb-4 bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4 text-center">
            <p className="text-lg font-bold text-[#2d2926]">🎉 Amazing day!</p>
            <p className="text-sm text-[#5c7f63] mt-0.5">
              You earned {completedToday} {completedToday === 1 ? "leaf" : "leaves"} today 🍃
            </p>
          </div>
        )}

        {/* Child filter tabs */}
        {children.length > 1 && (
          <div className="flex gap-2 flex-wrap mb-3">
            <button
              onClick={() => setSelectedChildId("all")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedChildId === "all"
                  ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                  : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63]"
              }`}
            >
              All
            </button>
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(child.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedChildId === child.id
                    ? "text-white border-transparent"
                    : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:text-[#2d2926]"
                }`}
                style={selectedChildId === child.id ? { backgroundColor: child.color ?? "#5c7f63" } : {}}
              >
                {child.name}
              </button>
            ))}
          </div>
        )}

        {/* Lessons list */}
        {filteredLessons.length > 0 ? (
          <>
            {/* Multi-child grouped view */}
            {selectedChildId === "all" && children.length > 1 ? (
              <div className="space-y-4">
                {children.map((child) => {
                  const childLessons = filteredLessons.filter((l) => l.child_id === child.id);
                  if (childLessons.length === 0) return null;
                  return (
                    <div key={child.id}>
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: child.color ?? "#5c7f63" }}
                        />
                        <span
                          className="text-xs font-bold uppercase tracking-widest"
                          style={{ color: child.color ?? "#5c7f63" }}
                        >
                          {child.name}
                        </span>
                        <span className="text-[10px] text-[#b5aca4]">
                          {childLessons.filter((l) => l.completed).length}/{childLessons.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {childLessons.map((lesson) => (
                          <TodayLessonCard
                            key={lesson.id}
                            lesson={lesson}
                            childObj={child}
                            onToggle={toggleLesson}
                            onEdit={openEdit}
                            onDelete={deleteLesson}
                            isPartner={isPartner}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {/* Unassigned lessons */}
                {(() => {
                  const childIds = new Set(children.map((c) => c.id));
                  const unassigned = filteredLessons.filter((l) => !l.child_id || !childIds.has(l.child_id));
                  if (unassigned.length === 0) return null;
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#c8bfb5]" />
                        <span className="text-xs font-bold uppercase tracking-widest text-[#b5aca4]">Unassigned</span>
                      </div>
                      <div className="space-y-2">
                        {unassigned.map((lesson) => (
                          <TodayLessonCard
                            key={lesson.id}
                            lesson={lesson}
                            childObj={undefined}
                            onToggle={toggleLesson}
                            onEdit={openEdit}
                            onDelete={deleteLesson}
                            isPartner={isPartner}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* Flat list (single child or filtered) */
              <div className="space-y-2">
                {filteredLessons.map((lesson) => (
                  <TodayLessonCard
                    key={lesson.id}
                    lesson={lesson}
                    childObj={children.find((c) => c.id === lesson.child_id)}
                    onToggle={toggleLesson}
                    onEdit={openEdit}
                    onDelete={deleteLesson}
                    isPartner={isPartner}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* Empty state */
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">🌱</span>
            <p className="text-base font-semibold text-[#2d2926] mb-1.5">No lessons yet today</p>
            <p className="text-sm text-[#7a6f65] leading-relaxed max-w-xs mb-5">
              Your homeschool journey starts here. Set up your curriculum to have lessons scheduled automatically, or just log one you already did.
            </p>
            <div className="flex gap-2 flex-wrap justify-center mb-4">
              <Link
                href="/dashboard/plan"
                className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
              >
                Set Up Curriculum 📚
              </Link>
              {!isPartner && (
                <button
                  onClick={openQuickLog}
                  className="inline-flex items-center gap-1.5 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] text-[#5c7f63] text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                >
                  + Add a single lesson
                </button>
              )}
            </div>
            {children.length === 0 && (
              <p className="text-xs text-[#b5aca4]">Tip: add your children in Settings first if you haven&apos;t yet 🌱</p>
            )}
          </div>
        )}
      </div>

      {/* ── Growth Tree Card ──────────────────────────────── */}
      <GrowthTreeCard leaves={treeLeaves} childName={treeLabel} />

      {/* ── Motivational Quote ───────────────────────────── */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">
          Today&apos;s Thought
        </p>
        <p className="text-sm text-[#5c7f63] italic leading-relaxed">&ldquo;{quote}&rdquo;</p>
      </div>

      {children.length > 0 && Object.values(leafCounts).reduce((a, b) => a + b, 0) === 0 && (
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <span className="text-3xl">🌱</span>
            <div className="flex-1">
              <h3 className="font-bold text-[#2d2926] mb-1">
                Welcome to Rooted{familyName ? `, ${familyName}` : ""}! Here&apos;s where to start:
              </h3>
              <p className="text-sm text-[#5c7f63] mb-3 leading-relaxed">
                Your garden is planted and ready to grow. Every lesson you log earns a leaf 🍃
              </p>
              <ol className="text-sm text-[#3d5c42] space-y-1.5">
                <li className="flex items-start gap-2"><span>1️⃣</span><span><strong>Log today&apos;s lessons</strong> — tap a lesson card to check it off and earn your first leaf</span></li>
                <li className="flex items-start gap-2"><span>2️⃣</span><span><strong>Set a Finish Line goal</strong> — track if you&apos;re on pace to finish your curriculum on time 🎯</span></li>
                <li className="flex items-start gap-2"><span>3️⃣</span><span><strong>Explore Resources</strong> — free field trips, discounts, and printables curated for homeschoolers 📚</span></li>
              </ol>
            </div>
          </div>
        </div>
      )}

      <FinishLineSection />

      {/* ── Books Read Today ──────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">
            Books Read Today
          </h2>
          {!isPartner && (
            <button
              onClick={() => setShowBookModal(true)}
              className="text-xs font-medium text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1 rounded-full transition-colors"
            >
              + Log a Book
            </button>
          )}
        </div>

        {todayBooks.length > 0 ? (
          <div className="space-y-2">
            {todayBooks.map((b) => (
              <div key={b.id} className="flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3">
                <span className="text-lg">📖</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#2d2926] truncate">{b.payload.title}</p>
                  {b.payload.child_id && (
                    <p className="text-xs text-[#7a6f65]">
                      {children.find((c) => c.id === b.payload.child_id)?.name}
                    </p>
                  )}
                </div>
                <span className="text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">+1 🍃</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex items-center gap-3">
            <span className="text-2xl">📚</span>
            <div>
              <p className="text-sm font-medium text-[#2d2926]">No books logged yet today</p>
              <p className="text-xs text-[#b5aca4]">Each book earns a leaf on the garden tree.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Daily Reflection ──────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">
            Daily Reflection
          </h2>
          {reflectionExists && (
            <span className="text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">saved</span>
          )}
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden focus-within:border-[#5c7f63] focus-within:ring-2 focus-within:ring-[#5c7f63]/20 transition">
          <textarea
            value={reflectionText}
            onChange={(e) => setReflectionText(e.target.value)}
            placeholder="How did today's learning go? What went well? What would you do differently?"
            rows={4}
            className="w-full px-4 pt-4 pb-2 text-sm text-[#2d2926] placeholder-[#c8bfb5] bg-transparent resize-none focus:outline-none leading-relaxed"
          />
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#f0ede8]">
            <p className="text-xs text-[#c8bfb5]">
              {reflectionText.length > 0 ? `${reflectionText.length} characters` : "Your thoughts are safe here"}
            </p>
            <button
              onClick={saveReflection}
              disabled={saving || reflectionText.trim().length === 0}
              className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
                savedFlash
                  ? "bg-[#e8f0e9] text-[#3d5c42]"
                  : "bg-[#5c7f63] hover:bg-[#3d5c42] text-white disabled:opacity-40"
              }`}
            >
              {savedFlash ? "✓ Saved" : saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="h-4" />

      {/* More hint */}
      <p className="text-center text-xs text-[#b5aca4]">
        <Link href="/dashboard/more">📋 Reports · 🖨️ Printables — find them in ··· More</Link>
      </p>

      {/* ── Floating Quick Log Button ─────────────────────── */}
      {!isPartner && !showQuickLog && (
        <button
          onClick={openQuickLog}
          className="fixed bottom-20 right-4 z-50 rounded-full bg-[#5c7f63] hover:bg-[#3d5c42] active:scale-95 text-white shadow-lg flex items-center gap-2 px-4 py-3 transition-all"
          aria-label="Quick log"
        >
          <span className="text-2xl font-light leading-none">+</span>
          <span className="text-sm font-semibold">Log Lesson</span>
        </button>
      )}

      {/* ── Book modal ────────────────────────────────────── */}
      {showBookModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">📖 Log a Book</h2>
              <button onClick={() => setShowBookModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Book title *</label>
              <input
                value={bookTitle} onChange={(e) => setBookTitle(e.target.value)}
                placeholder="e.g. Charlotte's Web" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who read it?</label>
                <select
                  value={bookChild} onChange={(e) => setBookChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                >
                  <option value="">Everyone / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <p className="text-xs text-[#7a6f65] bg-[#e8f0e9] rounded-xl px-3 py-2">
              🍃 This book will add a leaf to {bookChild ? children.find((c) => c.id === bookChild)?.name + "'s" : "the"} garden tree.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowBookModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                Cancel
              </button>
              <button onClick={saveBook} disabled={savingBook || !bookTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingBook ? "Saving…" : "Log Book 🍃"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Lesson modal ──────────────────────────────── */}
      {showLessonModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">📚 Add a Lesson</h2>
              <button onClick={() => setShowLessonModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select value={lessonChildId} onChange={(e) => setLessonChildId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">All / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input value={lessonSubject} onChange={(e) => setLessonSubject(e.target.value)}
                list="subjects-list" placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <datalist id="subjects-list">
                {subjects.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Lesson title *</label>
              <input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="e.g. Chapter 4 reading" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Hours spent (optional)</label>
              <input value={lessonHours} onChange={(e) => setLessonHours(e.target.value)}
                type="number" min="0" max="24" step="0.5" placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowLessonModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                Cancel
              </button>
              <button onClick={saveLesson} disabled={savingLesson || !lessonTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingLesson ? "Saving…" : "Save Lesson 🍃"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Lesson modal ─────────────────────────────── */}
      {editingLesson && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">✏️ Edit Lesson</h2>
              <button onClick={() => setEditingLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select value={editChildId} onChange={(e) => setEditChildId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">All / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)}
                list="edit-subjects-list" placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <datalist id="edit-subjects-list">
                {subjects.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Lesson title *</label>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Lesson title" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Hours spent (optional)</label>
              <input value={editHours} onChange={(e) => setEditHours(e.target.value)}
                type="number" min="0" max="24" step="0.5" placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingLesson(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Log Sheet ───────────────────────────────── */}
      {showQuickLog && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end justify-center"
          onClick={closeQuickLog}
        >
          <div
            className="bg-[#fefcf9] rounded-t-3xl shadow-xl w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 mb-1" />

            {qlMode === null ? (
              /* 4-card picker */
              <div className="px-5 pt-4 pb-8">
                <h2 className="text-lg font-bold text-[#2d2926] mb-0.5">What happened today? 🌿</h2>
                <p className="text-sm text-[#7a6f65] mb-5">Log something great. It only takes a second.</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { mode: "book",       emoji: "📚", title: "Finished a book",     sub: "Earns a 🍃" },
                    { mode: "project",    emoji: "🌋", title: "Project or activity", sub: "Earns a 🍃" },
                    { mode: "field_trip", emoji: "🚌", title: "Field trip",          sub: "🍃 per child" },
                    { mode: "extra",      emoji: "➕", title: "Extra lesson",        sub: "Earns a 🍃" },
                  ].map(({ mode, emoji, title, sub }) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setQlMode(mode as "book" | "project" | "field_trip" | "extra");
                        if (children.length === 1) {
                          setQlChild(children[0].id);
                          if (mode === "field_trip") setQlChildrenIds([children[0].id]);
                        }
                      }}
                      className="flex flex-col items-start gap-1 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#fafdf8] active:scale-95 rounded-2xl p-4 text-left transition-all"
                    >
                      <span className="text-3xl mb-0.5">{emoji}</span>
                      <span className="text-sm font-semibold text-[#2d2926] leading-tight">{title}</span>
                      <span className="text-[10px] text-[#5c7f63] font-medium">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Sub-form */
              <div className="px-5 pt-4 pb-8">
                <div className="flex items-center gap-3 mb-5">
                  <button
                    onClick={() => setQlMode(null)}
                    className="text-[#7a6f65] hover:text-[#2d2926] text-sm transition-colors"
                  >
                    ← Back
                  </button>
                  <h2 className="text-base font-bold text-[#2d2926]">
                    {qlMode === "book"       ? "📚 Finished a book" :
                     qlMode === "project"    ? "🌋 Project or activity" :
                     qlMode === "field_trip" ? "🚌 Field trip" :
                     "➕ Extra lesson"}
                  </h2>
                </div>

                <div className="space-y-3">
                  {/* Title / main field */}
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                      {qlMode === "book"       ? "Book title *" :
                       qlMode === "project"    ? "What did you do? *" :
                       qlMode === "field_trip" ? "Where did you go? *" :
                       "What did you cover? *"}
                    </label>
                    <input
                      value={qlTitle}
                      onChange={(e) => setQlTitle(e.target.value)}
                      placeholder={
                        qlMode === "book"       ? "e.g. Charlotte's Web" :
                        qlMode === "project"    ? "e.g. Built a model volcano" :
                        qlMode === "field_trip" ? "e.g. Natural History Museum" :
                        "e.g. Chapter 7 reading"
                      }
                      autoFocus
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    />
                  </div>

                  {/* Subject (project + extra) */}
                  {(qlMode === "project" || qlMode === "extra") && (
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                        {qlMode === "extra" ? "Subject" : "Subject tag (optional)"}
                      </label>
                      <input
                        value={qlSubject}
                        onChange={(e) => setQlSubject(e.target.value)}
                        list="ql-subjects-list"
                        placeholder="e.g. Science, Art, History"
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                      />
                      <datalist id="ql-subjects-list">
                        {subjects.map((s) => <option key={s.id} value={s.name} />)}
                      </datalist>
                    </div>
                  )}

                  {/* Single child select (book, project, extra) */}
                  {children.length > 0 && qlMode !== "field_trip" && (
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Which child?</label>
                      <select
                        value={qlChild}
                        onChange={(e) => setQlChild(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                      >
                        <option value="">All / unassigned</option>
                        {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Multi-child select (field trip) */}
                  {qlMode === "field_trip" && children.length > 0 && (
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-2">Which child(ren)?</label>
                      <div className="flex flex-wrap gap-2">
                        {children.map((c) => (
                          <button
                            key={c.id}
                            onClick={() =>
                              setQlChildrenIds((prev) =>
                                prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                              )
                            }
                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                              qlChildrenIds.includes(c.id)
                                ? "text-white border-transparent"
                                : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
                            }`}
                            style={
                              qlChildrenIds.includes(c.id)
                                ? { backgroundColor: c.color ?? "#5c7f63", borderColor: c.color ?? "#5c7f63" }
                                : {}
                            }
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes (book) */}
                  {qlMode === "book" && (
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Notes (optional)</label>
                      <input
                        value={qlNotes}
                        onChange={(e) => setQlNotes(e.target.value)}
                        placeholder="What did they think of it?"
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                      />
                    </div>
                  )}

                  {/* Notes (field trip) */}
                  {qlMode === "field_trip" && (
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Notes (optional)</label>
                      <input
                        value={qlNotes}
                        onChange={(e) => setQlNotes(e.target.value)}
                        placeholder="What did you see or do?"
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                      />
                    </div>
                  )}
                </div>

                <button
                  onClick={saveQuickLog}
                  disabled={savingQL || !qlTitle.trim()}
                  className="mt-5 w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {savingQL ? "Saving…" : "Save 🍃"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────── */}
      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] toast-slide-up pointer-events-none">
          <div className="bg-[#2d2926] text-white text-sm font-medium px-5 py-3 rounded-full shadow-lg flex items-center gap-2 whitespace-nowrap">
            <span>🍃</span>
            <span>Saved to Memories!</span>
          </div>
        </div>
      )}

      {qlError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] toast-slide-up pointer-events-none">
          <div className="bg-[#c0392b] text-white text-sm font-medium px-5 py-3 rounded-full shadow-lg flex items-center gap-2 whitespace-nowrap max-w-[90vw] text-center">
            <span>⚠️</span>
            <span>Couldn&apos;t save — {qlError}</span>
          </div>
        </div>
      )}

      {/* ── PWA Install Banner ────────────────────────────── */}
      {showPwaBanner && (
        <div className="sm:hidden fixed bottom-20 left-4 right-4 z-50 bg-[#2d2926] text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xl shrink-0">🌿</span>
          <p className="flex-1 text-sm font-medium leading-tight">Add Rooted to your home screen</p>
          <button
            onClick={() => setShowPwaModal(true)}
            className="shrink-0 text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            How?
          </button>
          <button
            onClick={() => { localStorage.setItem("pwa-banner-dismissed", "true"); setShowPwaBanner(false); }}
            aria-label="Dismiss"
            className="shrink-0 text-white/60 hover:text-white text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* ── PWA Install Modal ─────────────────────────────── */}
      {showPwaModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">🌿 Add to Home Screen</h2>
              <button onClick={() => setShowPwaModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              <div className="bg-[#f8f5f0] rounded-xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#2d2926] uppercase tracking-wide">🍎 iPhone</p>
                <p className="text-sm text-[#5c5248] leading-relaxed">Safari → tap the <span className="font-semibold">Share</span> button → <span className="font-semibold">Add to Home Screen</span></p>
              </div>
              <div className="bg-[#f8f5f0] rounded-xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#2d2926] uppercase tracking-wide">🤖 Android</p>
                <p className="text-sm text-[#5c5248] leading-relaxed">Chrome → tap the <span className="font-semibold">Menu (⋮)</span> → <span className="font-semibold">Add to Home Screen</span></p>
              </div>
            </div>
            <button
              onClick={() => setShowPwaModal(false)}
              className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      <FloatingLeaves active={celebrating} />

    </div>
  );
}
