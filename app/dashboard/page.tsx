"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = {
  id: string;
  name: string;
  color: string | null;
};

type Lesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string;
  hours: number | null;
  subjects: { name: string; color: string | null } | null;
};

type BookLog = {
  id: string;
  payload: { title: string; child_id?: string; date: string };
};

type Subject = {
  id: string;
  name: string;
  color: string | null;
};

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

const STAGES = [
  { name: "Seed",     min: 0,   max: 9,   desc: "Just beginning",      color: "#c4956a" },
  { name: "Sprout",   min: 10,  max: 24,  desc: "Taking root",         color: "#7a9e7e" },
  { name: "Sapling",  min: 25,  max: 49,  desc: "Growing strong",      color: "#5c7f63" },
  { name: "Growing",  min: 50,  max: 99,  desc: "Reaching upward",     color: "#3d5c42" },
  { name: "Thriving", min: 100, max: Infinity, desc: "Fully flourishing", color: "#2d5c38" },
];

function getStage(leaves: number) {
  return STAGES.find((s) => leaves >= s.min && leaves <= s.max) ?? STAGES[0];
}

function getStageIndex(leaves: number) {
  return STAGES.findIndex((s) => leaves >= s.min && leaves <= s.max);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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

// ─── Tree SVG ─────────────────────────────────────────────────────────────────

function TreeIllustration({ stageIndex }: { stageIndex: number }) {
  const stage = stageIndex + 1; // 1–5
  return (
    <svg viewBox="0 0 100 110" className="w-full h-full" aria-hidden>
      {/* Ground */}
      <ellipse cx="50" cy="98" rx="28" ry="5" fill="#d4b896" opacity="0.4" />

      {/* Stage 1 — Seed */}
      {stage >= 1 && stage < 2 && (
        <g>
          <path
            d="M44 86 Q50 76 56 86 Q50 96 44 86"
            fill="#8b6f47"
          />
          <path
            d="M50 78 Q53 70 50 64"
            stroke="#7a9e7e"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Stage 2 — Sprout */}
      {stage >= 2 && (
        <g>
          <rect x="48" y="66" width="4" height="32" rx="2" fill="#8b6f47" />
          <path d="M50 75 Q34 64 39 50 Q50 60 50 75" fill="#7a9e7e" />
          <path d="M50 75 Q66 64 61 50 Q50 60 50 75" fill="#5c7f63" />
        </g>
      )}

      {/* Stage 3 — Sapling */}
      {stage >= 3 && (
        <g>
          <rect x="47" y="54" width="6" height="14" rx="3" fill="#8b6f47" />
          <path d="M50 67 Q30 55 36 38 Q48 50 50 67" fill="#5c7f63" />
          <path d="M50 67 Q70 55 64 38 Q52 50 50 67" fill="#7a9e7e" />
          <circle cx="50" cy="36" r="16" fill="#5c7f63" opacity="0.9" />
          <circle cx="50" cy="26" r="11" fill="#3d5c42" />
        </g>
      )}

      {/* Stage 4 — Growing */}
      {stage >= 4 && (
        <g>
          <rect x="46" y="54" width="8" height="14" rx="4" fill="#8b6f47" />
          <path d="M50 68 Q24 54 30 34 Q46 48 50 68" fill="#5c7f63" />
          <path d="M50 68 Q76 54 70 34 Q54 48 50 68" fill="#7a9e7e" />
          <circle cx="34" cy="42" r="16" fill="#7a9e7e" opacity="0.95" />
          <circle cx="66" cy="42" r="16" fill="#7a9e7e" opacity="0.95" />
          <circle cx="50" cy="32" r="19" fill="#5c7f63" />
          <circle cx="50" cy="20" r="13" fill="#3d5c42" />
        </g>
      )}

      {/* Stage 5 — Thriving */}
      {stage >= 5 && (
        <g>
          <rect x="45" y="56" width="10" height="14" rx="5" fill="#8b6f47" />
          <path d="M50 70 Q18 55 26 28 Q44 46 50 70" fill="#5c7f63" />
          <path d="M50 70 Q82 55 74 28 Q56 46 50 70" fill="#7a9e7e" />
          <circle cx="28" cy="48" r="18" fill="#7a9e7e" />
          <circle cx="72" cy="48" r="18" fill="#7a9e7e" />
          <circle cx="40" cy="60" r="13" fill="#5c7f63" opacity="0.9" />
          <circle cx="60" cy="60" r="13" fill="#5c7f63" opacity="0.9" />
          <circle cx="50" cy="32" r="22" fill="#5c7f63" />
          <circle cx="50" cy="16" r="15" fill="#3d5c42" />
          <circle cx="36" cy="26" r="10" fill="#3d5c42" opacity="0.85" />
          <circle cx="64" cy="26" r="10" fill="#3d5c42" opacity="0.85" />
        </g>
      )}
    </svg>
  );
}

// ─── Growth Tree Card ──────────────────────────────────────────────────────────

function GrowthTreeCard({
  leaves,
  childName,
}: {
  leaves: number;
  childName: string;
}) {
  const stageIdx = getStageIndex(leaves);
  const stage = STAGES[stageIdx];
  const nextStage = STAGES[stageIdx + 1];
  const progress = nextStage
    ? ((leaves - stage.min) / (nextStage.min - stage.min)) * 100
    : 100;

  return (
    <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5 flex gap-5 items-center">
      {/* Tree illustration */}
      <div className="w-24 h-24 shrink-0"  >
        <TreeIllustration stageIndex={stageIdx} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-widest text-[#5c7f63] mb-0.5">
          {childName}
        </p>
        <h3 className="text-xl font-bold text-[#2d2926] leading-tight">
          {stage.name}
        </h3>
        <p className="text-sm text-[#5c7f63] mb-3">{stage.desc}</p>

        {/* Leaf count */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">🍃</span>
          <span className="text-sm font-semibold text-[#2d2926]">
            {leaves} {leaves === 1 ? "leaf" : "leaves"}
          </span>
          {nextStage && (
            <span className="text-xs text-[#7a6f65]">
              · {nextStage.min - leaves} to {nextStage.name}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor: stage.color,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Lesson Row ───────────────────────────────────────────────────────────────

function LessonRow({
  lesson,
  onToggle,
}: {
  lesson: Lesson;
  onToggle: (id: string, current: boolean) => void;
}) {
  const subjectColor = lesson.subjects?.color ?? "#7a9e7e";

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
        lesson.completed
          ? "bg-[#f0f7f1] border-[#c2dbc5]"
          : "bg-[#fefcf9] border-[#e8e2d9]"
      }`}
    >
      <button
        onClick={() => onToggle(lesson.id, lesson.completed)}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          lesson.completed
            ? "bg-[#5c7f63] border-[#5c7f63]"
            : "border-[#c8bfb5] hover:border-[#5c7f63]"
        }`}
        aria-label={lesson.completed ? "Mark incomplete" : "Mark complete"}
      >
        {lesson.completed && (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-white">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium truncate ${
            lesson.completed ? "text-[#7a9e7e] line-through" : "text-[#2d2926]"
          }`}
        >
          {lesson.title}
        </p>
        {lesson.subjects && (
          <p className="text-xs mt-0.5" style={{ color: subjectColor }}>
            {lesson.subjects.name}
          </p>
        )}
      </div>

      {lesson.hours != null && lesson.hours > 0 && (
        <span className="text-xs text-[#b5aca4] shrink-0">
          {lesson.hours}h
        </span>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const today = new Date().toISOString().split("T")[0];
  const quote = QUOTES[new Date().getDay() % QUOTES.length];
  const { isPartner, effectiveUserId } = usePartner();

  const [familyName, setFamilyName] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [selectedChildId, setSelectedChildId] = useState<string>("all");
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionExists, setReflectionExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);

  // Books
  const [todayBooks, setTodayBooks] = useState<BookLog[]>([]);
  const [showBookModal, setShowBookModal] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [bookChild, setBookChild] = useState("");
  const [savingBook, setSavingBook] = useState(false);

  // Lessons modal
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [lessonChildId, setLessonChildId] = useState("");
  const [lessonSubject, setLessonSubject] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonHours, setLessonHours] = useState("");
  const [savingLesson, setSavingLesson] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    // Profile / family name
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", effectiveUserId)
      .maybeSingle();
    setFamilyName(profile?.display_name || "");

    // Children
    const { data: childrenData } = await supabase
      .from("children")
      .select("id, name, color")
      .eq("user_id", effectiveUserId)
      .eq("archived", false)
      .order("sort_order");
    setChildren(childrenData ?? []);

    // Today's lessons
    const { data: lessonsData } = await supabase
      .from("lessons")
      .select("id, title, completed, child_id, hours, subjects(name, color)")
      .eq("user_id", effectiveUserId)
      .or(`date.eq.${today},scheduled_date.eq.${today}`);
    setLessons((lessonsData as unknown as Lesson[]) ?? []);

    // All completed lessons + book events (for leaf counts)
    const [{ data: completed }, { data: bookEvents }] = await Promise.all([
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
    ]);

    const counts: Record<string, number> = {};
    completed?.forEach((l) => {
      counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
    });
    bookEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    setLeafCounts(counts);

    // Today's books
    const { data: todayBooksData } = await supabase
      .from("app_events")
      .select("id, payload")
      .eq("user_id", effectiveUserId)
      .eq("type", "book_read")
      .filter("payload->>date", "eq", today);
    setTodayBooks((todayBooksData as unknown as BookLog[]) ?? []);

    // Subjects for autocomplete
    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name, color")
      .eq("user_id", effectiveUserId)
      .order("name");
    setSubjects((subjectsData as Subject[]) ?? []);

    // Today's reflection
    const { data: reflectionData } = await supabase
      .from("daily_reflections")
      .select("reflection")
      .eq("user_id", effectiveUserId)
      .eq("date", today)
      .maybeSingle();
    if (reflectionData) {
      setReflectionText(reflectionData.reflection ?? "");
      setReflectionExists(true);
    }

    setLoading(false);
  }, [today, effectiveUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) =>
      prev.map((l) => (l.id === id ? { ...l, completed: !current } : l))
    );
    await supabase
      .from("lessons")
      .update({ completed: !current })
      .eq("id", id);

    // Refresh leaf counts
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: completed } = await supabase
      .from("lessons")
      .select("child_id")
      .eq("user_id", user.id)
      .eq("completed", true);
    const counts: Record<string, number> = {};
    completed?.forEach((l) => {
      counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
    });
    setLeafCounts(counts);
  }

  async function saveBook() {
    if (!bookTitle.trim()) return;
    setSavingBook(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingBook(false); return; }

    const payload = { title: bookTitle.trim(), child_id: bookChild || undefined, date: today };
    const { data } = await supabase
      .from("app_events")
      .insert({ user_id: user.id, type: "book_read", payload })
      .select("id, payload")
      .single();

    if (data) {
      setTodayBooks((prev) => [...prev, data as unknown as BookLog]);
      // +1 leaf for the child if assigned
      if (bookChild) {
        setLeafCounts((prev) => ({ ...prev, [bookChild]: (prev[bookChild] ?? 0) + 1 }));
      }
    }
    setBookTitle(""); setBookChild(""); setSavingBook(false); setShowBookModal(false);
  }

  function openLessonModal() {
    setLessonChildId(children.length === 1 ? children[0].id : "");
    setLessonSubject("");
    setLessonTitle("");
    setLessonHours("");
    setShowLessonModal(true);
  }

  async function saveLesson() {
    if (!lessonTitle.trim()) return;
    setSavingLesson(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingLesson(false); return; }

    // Find or create subject
    let subjectId: string | null = null;
    if (lessonSubject.trim()) {
      const existing = subjects.find(
        (s) => s.name.toLowerCase() === lessonSubject.trim().toLowerCase()
      );
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSubject } = await supabase
          .from("subjects")
          .insert({ user_id: user.id, name: lessonSubject.trim() })
          .select("id, name, color")
          .single();
        if (newSubject) {
          setSubjects((prev) => [...prev, newSubject as Subject]);
          subjectId = newSubject.id;
        }
      }
    }

    // Insert lesson
    const { data: newLesson } = await supabase
      .from("lessons")
      .insert({
        user_id: user.id,
        child_id: lessonChildId || null,
        subject_id: subjectId,
        title: lessonTitle.trim(),
        hours: lessonHours ? parseFloat(lessonHours) : null,
        completed: true,
        date: today,
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

  async function saveReflection() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("daily_reflections").upsert(
      {
        user_id: user.id,
        date: today,
        reflection: reflectionText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" }
    );

    setSaving(false);
    setReflectionExists(true);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  // Derived: filtered lessons + growth tree data
  const filteredLessons =
    selectedChildId === "all"
      ? lessons
      : lessons.filter((l) => l.child_id === selectedChildId);

  const treeLeaves =
    selectedChildId === "all"
      ? Object.values(leafCounts).reduce((a, b) => a + b, 0)
      : leafCounts[selectedChildId] ?? 0;

  const treeLabel =
    selectedChildId === "all"
      ? familyName ? `${familyName} Family` : "Your Family"
      : children.find((c) => c.id === selectedChildId)?.name ?? "";

  const completedToday = filteredLessons.filter((l) => l.completed).length;
  const totalToday = filteredLessons.length;

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
      {/* ── Date & Greeting ──────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          {formatDate(new Date())}
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">
          {getGreeting()}
          {familyName ? `, ${familyName}` : ""}! 👋
        </h1>
        {totalToday > 0 && (
          <p className="text-sm text-[#7a6f65] mt-1">
            {completedToday} of {totalToday} lessons done today
          </p>
        )}
      </div>

      {/* ── Motivational Quote ───────────────────────────── */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">
          Today&apos;s Thought
        </p>
        <p className="text-sm text-[#5c7f63] italic leading-relaxed">
          &ldquo;{quote}&rdquo;
        </p>
      </div>

      {/* ── Child Filter Tabs ─────────────────────────────── */}
      {children.length > 0 && (
        <div className="flex gap-2 flex-wrap">
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
              style={
                selectedChildId === child.id
                  ? { backgroundColor: child.color ?? "#5c7f63" }
                  : {}
              }
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Growth Tree Card ──────────────────────────────── */}
      <GrowthTreeCard leaves={treeLeaves} childName={treeLabel} />

      {/* ── Today's Lessons ───────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">
            Today&apos;s Lessons
          </h2>
          <div className="flex items-center gap-2">
            {totalToday > 0 && (
              <span className="text-xs text-[#5c7f63] font-medium bg-[#e8f0e9] px-2 py-0.5 rounded-full">
                {completedToday}/{totalToday} done
              </span>
            )}
            {!isPartner && (
              <button
                onClick={openLessonModal}
                className="text-xs font-medium text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1 rounded-full transition-colors"
              >
                + Add Lesson
              </button>
            )}
          </div>
        </div>

        {filteredLessons.length > 0 ? (
          <div className="space-y-2">
            {filteredLessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onToggle={toggleLesson}
              />
            ))}
          </div>
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
            <span className="text-3xl mb-2">📖</span>
            <p className="text-sm font-medium text-[#2d2926] mb-1">
              No lessons scheduled today
            </p>
            <p className="text-xs text-[#b5aca4]">
              Head to Plan to add lessons to your day.
            </p>
          </div>
        )}
      </div>

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

      {/* Book modal */}
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
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                placeholder="e.g. Charlotte's Web"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who read it?</label>
                <select
                  value={bookChild}
                  onChange={(e) => setBookChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                >
                  <option value="">Everyone / unassigned</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
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

      {/* Lesson modal */}
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
                <select
                  value={lessonChildId}
                  onChange={(e) => setLessonChildId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                >
                  <option value="">All / unassigned</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input
                value={lessonSubject}
                onChange={(e) => setLessonSubject(e.target.value)}
                list="subjects-list"
                placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
              <datalist id="subjects-list">
                {subjects.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Lesson title *</label>
              <input
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="e.g. Chapter 4 reading"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Hours spent (optional)</label>
              <input
                value={lessonHours}
                onChange={(e) => setLessonHours(e.target.value)}
                type="number"
                min="0"
                max="24"
                step="0.5"
                placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
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

      {/* ── Daily Reflection ──────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">
            Daily Reflection
          </h2>
          {reflectionExists && (
            <span className="text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">
              saved
            </span>
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
              {reflectionText.length > 0
                ? `${reflectionText.length} characters`
                : "Your thoughts are safe here"}
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

      {/* Bottom padding */}
      <div className="h-4" />

      <FloatingLeaves active={celebrating} />
    </div>
  );
}
