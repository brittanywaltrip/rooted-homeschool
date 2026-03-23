"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import LogTodayModal from "@/app/components/LogTodayModal";
import PageHero from "@/app/components/PageHero";

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
  goal_id?: string | null;
};

type TodayEvent = {
  id: string;
  type: string;
  payload: { title?: string; date?: string; child_id?: string };
};

type BookLog = {
  id: string;
  payload: { title: string; child_id?: string; date: string };
};

type Subject = { id: string; name: string; color: string | null };

type ActivityItem = {
  type: "lesson" | "book" | "memory";
  id: string;
  title: string;
  childId: string;
  subjectName?: string;
  memoryType?: string;
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
  "Every child is an artist. The problem is how to remain an artist once we grow up.",
  "Wonder is the beginning of wisdom.",
  "The mind is not a vessel to be filled, but a fire to be kindled.",
  "Children are not things to be molded, but people to be unfolded.",
  "To teach is to learn twice.",
  "Curiosity is the wick in the candle of learning.",
  "The whole art of teaching is only the art of awakening the natural curiosity of young minds.",
  "Children learn as they play. Most importantly, in play children learn how to learn.",
  "It is easier to build strong children than to repair broken adults.",
  "Tell me and I forget. Teach me and I remember. Involve me and I learn.",
  "A child who reads will be an adult who thinks.",
  "The greatest gifts you can give your children are the roots of responsibility and the wings of independence.",
  "Education is not preparation for life; education is life itself.",
  "What we want is to see the child in pursuit of knowledge, not knowledge in pursuit of the child.",
  "The more that you read, the more things you will know.",
  "Learning is a treasure that will follow its owner everywhere.",
  "Children need the freedom and time to play. Play is not a luxury. Play is a necessity.",
  "A book is a gift you can open again and again.",
  "The joy of learning is as indispensable in life as eating and breathing.",
  "Nothing in life is to be feared, only to be understood.",
  "Every student can learn, just not on the same day or in the same way.",
  "It's not what you teach, it's what you ignite.",
  "Home is where the learning is.",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateHero(date: Date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const rest    = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  return `${weekday} · ${rest}`;
}

function buildGreeting(familyName: string): string {
  const now  = new Date();
  const h    = now.getHours();
  const dow  = now.getDay(); // 0=Sun … 6=Sat
  const name = familyName
    ? `, ${familyName.replace(/^The\s+/i, "").trim() || familyName}`
    : "";
  if (dow === 6) return `Happy Saturday, ${name}! 🌿`;
  if (dow === 0) return `Happy Sunday,${name}! 🌿`;
  const base   = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const suffix = dow === 1 ? " Ready for the week?" : dow === 3 ? " Halfway there" : dow === 5 ? " Happy Friday" : "";
  return `${base}${name}!${suffix} 🌿`;
}

function toTitleCase(name: string) {
  return name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
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

// ─── Today Lesson Card ────────────────────────────────────────────────────────

type Particle = { id: number; x: number; y: number; color: string; delay: number };

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLeaf, setShowLeaf] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const prevCompleted = useRef(lesson.completed);

  useEffect(() => {
    if (!prevCompleted.current && lesson.completed) {
      setShowLeaf(true);
      const t = setTimeout(() => setShowLeaf(false), 1300);
      prevCompleted.current = true;

      // Tier 1: particle burst from checkbox
      const colors = ['#5c7f63', '#7a9e7e', '#a8d4aa', '#f0d090', '#d4b896'];
      const newParticles: Particle[] = Array.from({ length: 10 }, (_, i) => {
        const angle = (i * 36 + Math.random() * 20 - 10) * (Math.PI / 180);
        const dist  = 60 + Math.random() * 20;
        return {
          id:    i,
          x:     Math.cos(angle) * dist,
          y:     Math.sin(angle) * dist,
          color: colors[i % colors.length],
          delay: Math.round(Math.random() * 40),
        };
      });
      setParticles(newParticles);
      const pt = setTimeout(() => setParticles([]), 500);

      return () => { clearTimeout(t); clearTimeout(pt); };
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
      {/* Circular checkbox */}
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
          {lesson.title || (lesson.lesson_number ? `Lesson ${lesson.lesson_number}` : "Untitled")}
        </p>
        {lesson.hours != null && lesson.hours > 0 && (
          <p className="text-xs text-[#b5aca4] mt-0.5">{lesson.hours}h</p>
        )}
      </div>

      {/* Child bubble */}
      {childObj && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
          style={{ backgroundColor: childObj.color ?? "#5c7f63" }}
          data-no-toggle
        >
          {childObj.name.charAt(0).toUpperCase()}
        </div>
      )}

      {/* Leaf pop animation */}
      {showLeaf && (
        <span
          className="leaf-card-pop absolute text-xl"
          style={{ right: "48px", top: "4px" }}
        >
          🍃
        </span>
      )}

      {/* Tier 1: Particle burst */}
      {particles.map(p => (
        <span
          key={p.id}
          className="particle-burst absolute rounded-full"
          style={{
            width: 7,
            height: 7,
            left: 29,
            top: 25,
            backgroundColor: p.color,
            animationDelay: `${p.delay}ms`,
            '--px': `${p.x}px`,
            '--py': `${p.y}px`,
          } as React.CSSProperties}
        />
      ))}

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
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86400000);
  const quote = QUOTES[dayOfYear % QUOTES.length];
  const { isPartner, effectiveUserId } = usePartner();

  const [familyName,      setFamilyName]      = useState("");
  const [firstName,       setFirstName]       = useState("");
  const [onboarded,       setOnboarded]       = useState<boolean | null>(null);
  const [children,        setChildren]        = useState<Child[]>([]);
  const [lessons,         setLessons]         = useState<Lesson[]>([]);
  const [hasAnyLessons,   setHasAnyLessons]   = useState(false);
  const [leafCounts,      setLeafCounts]      = useState<Record<string, number>>({});
  const [loading,         setLoading]         = useState(true);
  const [celebrating,     setCelebrating]     = useState(false);
  const [childDoneToast,    setChildDoneToast]    = useState<string | null>(null);
  const [childDoneToastOut, setChildDoneToastOut] = useState(false);
  const [allDoneBanner,     setAllDoneBanner]     = useState(false);
  const childDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [todayMemoryEvents, setTodayMemoryEvents] = useState<TodayEvent[]>([]);
  const [todayBooks,        setTodayBooks]        = useState<BookLog[]>([]);
  const [showBookModal,     setShowBookModal]     = useState(false);
  const [bookTitle,         setBookTitle]         = useState("");
  const [bookChild,         setBookChild]         = useState("");
  const [savingBook,        setSavingBook]        = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("setup-banner-dismissed") === "1") setBannerDismissed(true);
  }, []);

  const [nudgeDismissed,   setNudgeDismissed]   = useState(false);
  const [isPro,            setIsPro]            = useState(false);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("rooted_setup_nudge_dismissed") === "1") setNudgeDismissed(true);
    const udDate = localStorage.getItem("rooted_upgrade_dismissed");
    if (udDate === new Date().toISOString().split("T")[0]) setUpgradeDismissed(true);
  }, []);

  const [showPwaBanner, setShowPwaBanner] = useState(false);
  const [showPwaModal,  setShowPwaModal]  = useState(false);
  useEffect(() => {
    const dismissed  = localStorage.getItem("pwa-banner-dismissed") === "true";
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!dismissed && !standalone) setShowPwaBanner(true);
  }, []);

  const [subjects,     setSubjects]     = useState<Subject[]>([]);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editSubject,   setEditSubject]   = useState("");
  const [editHours,     setEditHours]     = useState("");
  const [editChildId,   setEditChildId]   = useState("");
  const [savingEdit,    setSavingEdit]    = useState(false);

  const [editingActivity,       setEditingActivity]       = useState<ActivityItem | null>(null);
  const [activityEditTitle,     setActivityEditTitle]     = useState("");
  const [activityEditChild,     setActivityEditChild]     = useState("");
  const [activityDeleteConfirm, setActivityDeleteConfirm] = useState(false);
  const [savingActivityEdit,    setSavingActivityEdit]    = useState(false);

  const [showLogModal,           setShowLogModal]           = useState(false);
  const [savedMemoryToast,       setSavedMemoryToast]       = useState(false);
  const [gardenToast,            setGardenToast]            = useState<{ name: string; leaves: number } | null>(null);
  const [activeVacation,         setActiveVacation]         = useState<{ name: string; end_date: string } | null>(null);
  const [allVacationBlocks,      setAllVacationBlocks]      = useState<{ name: string; start_date: string; end_date: string }[]>([]);
  const [upcomingDay,            setUpcomingDay]            = useState<{
    date: string;
    lessons: { title: string; childId: string | null; subjectName: string | null }[];
  } | null>(null);

  // ── Leaf count refresh ────────────────────────────────────────────────────

  const refreshLeafCounts = useCallback(async () => {
    if (!effectiveUserId) return;
    const [{ data: completed }, { data: bookEvents }, { data: memEvents }] = await Promise.all([
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
    ]);
    const counts: Record<string, number> = {};
    completed?.forEach((l) => { if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
    bookEvents?.forEach((e) => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    memEvents?.forEach((e)  => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    setLeafCounts(counts);
  }, [effectiveUserId]);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: profile }, { data: { user: authUser } }, { data: profileData }] = await Promise.all([
      supabase.from("profiles").select("display_name, onboarded").eq("id", effectiveUserId).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("profiles").select("is_pro").eq("id", effectiveUserId).single(),
    ]);
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setFirstName(authUser?.user_metadata?.first_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);
    setIsPro((profileData as { is_pro?: boolean } | null)?.is_pro ?? false);

    const { data: childrenData } = await supabase
      .from("children").select("id, name, color")
      .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order");
    setChildren(childrenData ?? []);

    const [{ data: lessonsData }, { count: totalLessons }] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, hours, subjects(name, color), curriculum_goal_id, lesson_number, goal_id")
        .eq("user_id", effectiveUserId)
        .or(`date.eq.${today},scheduled_date.eq.${today}`),
      supabase.from("lessons").select("id", { count: "exact", head: true }).eq("user_id", effectiveUserId),
    ]);
    const loadedLessons = (lessonsData as unknown as Lesson[]) ?? [];
    setLessons(loadedLessons);
    setHasAnyLessons((totalLessons ?? 0) > 0);
    setAllDoneBanner(loadedLessons.length > 0 && loadedLessons.every((l: Lesson) => l.completed));

    const [{ data: completed }, { data: bookEvents }, { data: memEvents }] = await Promise.all([
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
    ]);
    const counts: Record<string, number> = {};
    completed?.forEach((l) => { if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
    bookEvents?.forEach((e) => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    memEvents?.forEach((e)  => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    setLeafCounts(counts);

    const { data: todayBooksData } = await supabase
      .from("app_events").select("id, payload")
      .eq("user_id", effectiveUserId).eq("type", "book_read")
      .filter("payload->>date", "eq", today);
    setTodayBooks((todayBooksData as unknown as BookLog[]) ?? []);

    const { data: todayMemData } = await supabase
      .from("app_events").select("id, type, payload")
      .eq("user_id", effectiveUserId)
      .in("type", ["memory_book", "memory_project", "memory_photo"])
      .filter("payload->>date", "eq", today);
    setTodayMemoryEvents((todayMemData as unknown as TodayEvent[]) ?? []);

    const { data: subjectsData } = await supabase
      .from("subjects").select("id, name, color")
      .eq("user_id", effectiveUserId).order("name");
    setSubjects((subjectsData as Subject[]) ?? []);

    const { data: vacBlocks } = await supabase
      .from("vacation_blocks").select("name, end_date, start_date")
      .eq("user_id", effectiveUserId);
    const currentVac = (vacBlocks ?? []).find(
      (b: { start_date: string; end_date: string; name: string }) => today >= b.start_date && today <= b.end_date
    );
    setActiveVacation(currentVac ? { name: currentVac.name, end_date: currentVac.end_date } : null);
    setAllVacationBlocks((vacBlocks ?? []) as { name: string; start_date: string; end_date: string }[]);

    // Upcoming lessons — first school day after today with scheduled lessons
    const nextDates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const { data: upcomingData } = await supabase
      .from("lessons")
      .select("title, scheduled_date, child_id, subjects(name)")
      .eq("user_id", effectiveUserId)
      .eq("completed", false)
      .gte("scheduled_date", nextDates[0])
      .lte("scheduled_date", nextDates[13])
      .order("scheduled_date");
    type UpRow = { title: string; scheduled_date: string | null; child_id: string | null; subjects: { name: string } | null };
    if (upcomingData && upcomingData.length > 0) {
      const rows = upcomingData as unknown as UpRow[];
      const firstDate = rows[0].scheduled_date ?? "";
      const dayRows = rows.filter((l) => l.scheduled_date === firstDate);
      setUpcomingDay({
        date: firstDate,
        lessons: dayRows.map((l) => ({
          title:       l.title,
          childId:     l.child_id,
          subjectName: l.subjects?.name ?? null,
        })),
      });
    } else {
      setUpcomingDay(null);
    }

    setLoading(false);
  }, [today, effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Lesson actions ────────────────────────────────────────────────────────

  function triggerGardenAnimation(childId?: string) {
    const child = children.find((c) => c.id === childId);
    const newLeaves = (leafCounts[childId ?? ""] ?? 0) + 1;
    setGardenToast({ name: child?.name ?? "Your garden", leaves: newLeaves });
    setTimeout(() => setGardenToast(null), 2500);
  }

  async function toggleLesson(id: string, current: boolean) {
    const lesson = lessons.find((l) => l.id === id);
    const updatedLessons = lessons.map(l => l.id === id ? { ...l, completed: !current } : l);
    setLessons(updatedLessons);
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);

    if (!current) {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1600);
      triggerGardenAnimation(lesson?.child_id ?? undefined);

      // Tier 2: child done toast at 300ms
      const childId = lesson?.child_id;
      if (childId) {
        const childLessons = updatedLessons.filter(l => l.child_id === childId);
        const childAllDone = childLessons.length > 0 && childLessons.every(l => l.completed);
        if (childAllDone) {
          const childName = children.find(c => c.id === childId)?.name;
          if (childName) {
            setTimeout(() => {
              if (childDoneTimerRef.current) clearTimeout(childDoneTimerRef.current);
              setChildDoneToastOut(false);
              setChildDoneToast(childName);
              childDoneTimerRef.current = setTimeout(() => {
                setChildDoneToastOut(true);
                setTimeout(() => { setChildDoneToast(null); setChildDoneToastOut(false); }, 300);
              }, 2500);
            }, 300);
          }
        }
      }

      // Tier 3: all done banner at 800ms
      const allNowDone = updatedLessons.length > 0 && updatedLessons.every(l => l.completed);
      if (allNowDone) {
        setTimeout(() => setAllDoneBanner(true), 800);
      }

      if (lesson?.curriculum_goal_id && lesson?.lesson_number) {
        const { data: goalRow } = await supabase
          .from("curriculum_goals").select("current_lesson")
          .eq("id", lesson.curriculum_goal_id).single();
        if (goalRow && lesson.lesson_number > goalRow.current_lesson) {
          await supabase.from("curriculum_goals")
            .update({ current_lesson: lesson.lesson_number })
            .eq("id", lesson.curriculum_goal_id);
        }
      }

      if (lesson?.goal_id) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("app_events").insert({
            user_id: user.id,
            type: "lesson_goal_complete",
            payload: { title: lesson.title, goal_id: lesson.goal_id, date: today },
          });
        }
      }
    } else {
      // Unchecking — immediately hide the all done banner
      setAllDoneBanner(false);
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
      const existing = subjects.find((s) => s.name.toLowerCase() === editSubject.trim().toLowerCase());
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase
          .from("subjects").insert({ user_id: user.id, name: editSubject.trim() })
          .select("id, name, color").single();
        if (newSub) { setSubjects((prev) => [...prev, newSub as Subject]); subjectId = newSub.id; }
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
      return {
        ...l,
        title:    editTitle.trim(),
        subjects: editSubject.trim() ? { name: editSubject.trim(), color: l.subjects?.color ?? null } : null,
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
      if (bookChild) setLeafCounts((prev) => ({ ...prev, [bookChild]: (prev[bookChild] ?? 0) + 1 }));
    }
    setBookTitle(""); setBookChild(""); setSavingBook(false); setShowBookModal(false);
  }

  function handleLogSaved(type: string, childId?: string) {
    setShowLogModal(false);
    if (type === "lesson") {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1600);
      if (childId) setLeafCounts((prev) => ({ ...prev, [childId]: (prev[childId] ?? 0) + 1 }));
      triggerGardenAnimation(childId);
    } else if (type === "field_trip" || type === "activity") {
      setSavedMemoryToast(true);
      setTimeout(() => setSavedMemoryToast(false), 2500);
    }
    loadData();
  }

  // ── Activity edit/delete ──────────────────────────────────────────────────

  function openActivityEdit(item: ActivityItem) {
    setEditingActivity(item);
    setActivityEditTitle(item.title);
    setActivityEditChild(item.childId);
    setActivityDeleteConfirm(false);
  }

  async function saveActivityEdit() {
    if (!editingActivity || !activityEditTitle.trim()) return;
    setSavingActivityEdit(true);

    if (editingActivity.type === "lesson") {
      await supabase.from("lessons").update({
        title:    activityEditTitle.trim(),
        child_id: activityEditChild || null,
      }).eq("id", editingActivity.id);
      setLessons((prev) => prev.map((l) => l.id !== editingActivity.id ? l : {
        ...l, title: activityEditTitle.trim(), child_id: activityEditChild || l.child_id,
      }));
    } else if (editingActivity.type === "book") {
      const row = todayBooks.find((b) => b.id === editingActivity.id);
      if (row) {
        const newPayload = { ...row.payload, title: activityEditTitle.trim(), child_id: activityEditChild || undefined };
        await supabase.from("app_events").update({ payload: newPayload }).eq("id", editingActivity.id);
        setTodayBooks((prev) => prev.map((b) => b.id !== editingActivity.id ? b : { ...b, payload: newPayload }));
      }
    } else {
      const row = todayMemoryEvents.find((e) => e.id === editingActivity.id);
      if (row) {
        const newPayload = { ...row.payload, title: activityEditTitle.trim(), child_id: activityEditChild || undefined };
        await supabase.from("app_events").update({ payload: newPayload }).eq("id", editingActivity.id);
        setTodayMemoryEvents((prev) => prev.map((e) => e.id !== editingActivity.id ? e : { ...e, payload: newPayload }));
      }
    }

    setSavingActivityEdit(false);
    setEditingActivity(null);
  }

  async function deleteActivityItem() {
    if (!editingActivity) return;
    if (editingActivity.type === "lesson") {
      await deleteLesson(editingActivity.id);
    } else {
      await supabase.from("app_events").delete().eq("id", editingActivity.id);
      if (editingActivity.type === "book") {
        setTodayBooks((prev) => prev.filter((b) => b.id !== editingActivity.id));
      } else {
        setTodayMemoryEvents((prev) => prev.filter((e) => e.id !== editingActivity.id));
      }
    }
    setEditingActivity(null);
    setActivityDeleteConfirm(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const completedToday = lessons.filter((l) => l.completed).length;
  const totalToday     = lessons.length;
  const progressPct    = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;
  const allDone        = totalToday > 0 && completedToday === totalToday;
  const isWeekend      = [0, 6].includes(new Date().getDay());
  const pendingLessons = totalToday > 0 && !allDone;
  const showUpcoming   = !activeVacation && subjects.length > 0 && !pendingLessons && !!upcomingDay;

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
    <>
      {/* ── Hero Header ──────────────────────────────────────── */}
      <PageHero
        overline={formatDateHero(new Date())}
        title={buildGreeting(familyName)}
      >
        {totalToday > 0 && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mt-3" style={{ background: "rgba(255,255,255,0.10)" }}>
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.70)" }}>Today&apos;s lessons</span>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.20)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: "#a8d4aa" }} />
            </div>
            <span className="text-[12px] font-semibold text-white">{completedToday} / {totalToday}</span>
          </div>
        )}
      </PageHero>

      <div className="max-w-2xl mx-auto px-5 pt-5 pb-7 space-y-6">

      {/* ── Setup Banner ─────────────────────────────────────── */}
      {onboarded === true && children.length === 0 && !bannerDismissed && (
        <div className="relative flex items-center justify-between gap-4 bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4">
          <p className="text-sm text-[#2d2926] font-medium leading-snug">
            🌱 Finish setting up your homeschool — you haven&apos;t added any children yet.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/onboarding" className="bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
              Add a Child →
            </Link>
            <button
              onClick={() => { sessionStorage.setItem("setup-banner-dismissed", "1"); setBannerDismissed(true); }}
              aria-label="Dismiss"
              className="w-7 h-7 flex items-center justify-center rounded-full text-[#5c7f63] hover:bg-[#b8d9bc]/50 transition-colors text-lg leading-none"
            >×</button>
          </div>
        </div>
      )}

      {/* ── Welcome Banner ─────────────────────────────────── */}
      {children.length === 0 && onboarded !== true && !bannerDismissed && (
        <div className="relative bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5">
          <button
            onClick={() => { sessionStorage.setItem("setup-banner-dismissed", "1"); setBannerDismissed(true); }}
            aria-label="Dismiss"
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-[#5c7f63] hover:bg-[#b8d9bc]/50 transition-colors text-lg leading-none"
          >×</button>
          <h2 className="text-lg font-bold text-[#2d2926] mb-1">Welcome to Rooted! 🌿</h2>
          <p className="text-sm text-[#5c7f63] mb-4">Let&apos;s get your family set up in 3 easy steps</p>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            {[
              { step: "1", label: "Add a child",                dest: "Onboarding", href: "/onboarding" },
              { step: "2", label: "Add your curriculum",        dest: "Plan",        href: "/dashboard/plan" },
              { step: "3", label: "Check off your first lesson", dest: "Today",      href: "#" },
            ].map(({ step, label, dest, href }) => (
              <Link key={step} href={href} className="flex-1 flex items-center gap-2.5 bg-white/70 hover:bg-white border border-[#b8d9bc] rounded-xl px-3.5 py-3 transition-colors">
                <div className="w-7 h-7 rounded-full bg-[#5c7f63] text-white text-xs font-bold flex items-center justify-center shrink-0">{step}</div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#2d2926] leading-tight">{label}</p>
                  <p className="text-[10px] text-[#7a6f65]">→ {dest}</p>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/onboarding" className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm">
            Add your first child →
          </Link>
        </div>
      )}

      {/* ── Vacation Banner ──────────────────────────────── */}
      {activeVacation && (() => {
        const backDate = new Date(activeVacation.end_date + "T00:00:00");
        backDate.setDate(backDate.getDate() + 1);
        const backLabel = backDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        return (
          <div className="rounded-2xl px-4 py-3" style={{ background: "#fef9e8", border: "1.5px solid #f0dda8" }}>
            <p className="text-sm font-semibold text-[#7a4a1a]">🌴 {activeVacation.name} — no lessons today! Back on {backLabel}.</p>
          </div>
        );
      })()}

            {/* ── Curriculum setup nudge ───────────────────────── */}
      {!isPartner && !nudgeDismissed && children.length > 0 && subjects.length === 0 && (
        <div className="flex items-start justify-between gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3.5">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-xl shrink-0 mt-0.5">👋</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#2d2926] leading-snug">Welcome to Rooted! Set up your curriculum to start seeing lessons here.</p>
              <Link href="/dashboard/plan" className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-white bg-[#5c7f63] hover:bg-[#3d5c42] px-3 py-1.5 rounded-lg transition-colors">
                Get started →
              </Link>
            </div>
          </div>
          <button
            onClick={() => { localStorage.setItem("rooted_setup_nudge_dismissed", "1"); setNudgeDismissed(true); }}
            aria-label="Dismiss"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors text-lg leading-none mt-0.5"
          >×</button>
        </div>
      )}

      {/* ── Today's Sections ─────────────────────────────── */}
      <div>
        {allDoneBanner && (
          <div className="mb-4 bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4 text-center">
            <p className="text-lg font-bold text-[#2d2926]">🎉 Amazing day!</p>
            <p className="text-sm text-[#5c7f63] mt-0.5">You earned {completedToday} {completedToday === 1 ? "leaf" : "leaves"} today 🍃</p>
          </div>
        )}
        {(() => {
          const childIds = new Set(children.map((c) => c.id));
          const sectionsWithContent = children.filter((child) =>
            lessons.some((l) => l.child_id === child.id) ||
            todayBooks.some((b) => b.payload.child_id === child.id) ||
            todayMemoryEvents.some((e) => e.payload.child_id === child.id)
          );
          const unassignedLessons = lessons.filter((l) => !l.child_id || !childIds.has(l.child_id));
          const unassignedBooks   = todayBooks.filter((b) => !b.payload.child_id || !childIds.has(b.payload.child_id ?? ""));
          const unassignedMems    = todayMemoryEvents.filter((e) => !e.payload.child_id || !childIds.has(e.payload.child_id ?? ""));
          const hasAnyContent     = sectionsWithContent.length > 0 || unassignedLessons.length > 0 || unassignedBooks.length > 0 || unassignedMems.length > 0;

          if (!hasAnyContent) {
            if (activeVacation) return (
              <div className="rounded-2xl px-4 py-3" style={{ background: "#fef9e8", border: "1.5px solid #f0dda8" }}>
                <p className="text-sm font-semibold text-[#7a4a1a]">🌴 <strong>{activeVacation.name}</strong> · No lessons today — enjoy your time off!</p>
              </div>
            );
            if (subjects.length === 0) return (
              <div className="py-8 flex flex-col items-center text-center">
                <span className="text-[52px] block mb-2">🌿</span>
                <p className="text-[20px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  {firstName ? `Ready to start, ${firstName}?` : "Ready to start?"}
                </p>
                <p className="text-[13px] text-[#9e958d] mt-1 mb-5 px-4 max-w-xs">Set up your curriculum and your first lessons will appear right here.</p>
                <Link href="/dashboard/plan?openWizard=true" className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                  Set Up Curriculum →
                </Link>
              </div>
            );
            return <p className="text-sm text-[#b5aca4] text-center py-6">No lessons scheduled today</p>;
          }

          return (
            <div className="space-y-5">
              {sectionsWithContent.map((child) => {
                const childLessons = lessons.filter((l) => l.child_id === child.id);
                const childBooks   = todayBooks.filter((b) => b.payload.child_id === child.id);
                const childMems    = todayMemoryEvents.filter((e) => e.payload.child_id === child.id);
                const done  = childLessons.filter((l) => l.completed).length;
                const total = childLessons.length;
                return (
                  <div key={child.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold text-white"
                        style={{ backgroundColor: child.color ?? "#5c7f63" }}
                      >
                        {child.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-bold tracking-widest uppercase" style={{ color: child.color ?? "#5c7f63" }}>
                        {toTitleCase(child.name)}
                      </span>
                      {total > 0 && <span className="text-[10px] text-[#b5aca4]">{done}/{total}</span>}
                    </div>
                    <div className="space-y-2">
                      {childLessons.map((lesson) => (
                        <TodayLessonCard key={lesson.id} lesson={lesson} childObj={child}
                          onToggle={toggleLesson} onEdit={openEdit} onDelete={deleteLesson} isPartner={isPartner} />
                      ))}
                      {childBooks.map((b) => (
                        <button key={b.id}
                          onClick={() => !isPartner && openActivityEdit({ type: "book", id: b.id, title: b.payload.title, childId: b.payload.child_id ?? "" })}
                          className="w-full flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                          <span className="text-lg shrink-0">📖</span>
                          <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{b.payload.title}</p>
                          <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full shrink-0">Book</span>
                        </button>
                      ))}
                      {childMems.map((e) => (
                        <button key={e.id}
                          onClick={() => !isPartner && openActivityEdit({ type: "memory", id: e.id, title: e.payload.title ?? "Memory", childId: e.payload.child_id ?? "", memoryType: e.type })}
                          className="w-full flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                          <span className="text-lg shrink-0">{e.type === "memory_book" ? "📖" : e.type === "memory_project" ? "🔬" : "📷"}</span>
                          <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{e.payload.title ?? "Memory"}</p>
                          <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full shrink-0">
                            {e.type === "memory_book" ? "Book" : e.type === "memory_project" ? "Project" : "Photo"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {(unassignedLessons.length > 0 || unassignedBooks.length > 0 || unassignedMems.length > 0) && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold text-white bg-[#c8bfb5]">?</div>
                    <span className="text-xs font-bold tracking-widest uppercase text-[#9e958d]">Unassigned</span>
                  </div>
                  <div className="space-y-2">
                    {unassignedLessons.map((lesson) => (
                      <TodayLessonCard key={lesson.id} lesson={lesson} childObj={undefined}
                        onToggle={toggleLesson} onEdit={openEdit} onDelete={deleteLesson} isPartner={isPartner} />
                    ))}
                    {unassignedBooks.map((b) => (
                      <button key={b.id}
                        onClick={() => !isPartner && openActivityEdit({ type: "book", id: b.id, title: b.payload.title, childId: "" })}
                        className="w-full flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                        <span className="text-lg shrink-0">📖</span>
                        <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{b.payload.title}</p>
                        <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full shrink-0">Book</span>
                      </button>
                    ))}
                    {unassignedMems.map((e) => (
                      <button key={e.id}
                        onClick={() => !isPartner && openActivityEdit({ type: "memory", id: e.id, title: e.payload.title ?? "Memory", childId: "", memoryType: e.type })}
                        className="w-full flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                        <span className="text-lg shrink-0">{e.type === "memory_book" ? "📖" : e.type === "memory_project" ? "🔬" : "📷"}</span>
                        <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{e.payload.title ?? "Memory"}</p>
                        <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full shrink-0">
                          {e.type === "memory_book" ? "Book" : e.type === "memory_project" ? "Project" : "Photo"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Welcome prompt (new users with children but no lessons ever) ─── */}
      {children.length > 0 && !hasAnyLessons && Object.values(leafCounts).reduce((a, b) => a + b, 0) === 0 && (
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <span className="text-3xl">🌱</span>
            <div className="flex-1">
              <h3 className="font-bold text-[#2d2926] mb-1">Welcome to Rooted{familyName ? `, ${familyName}` : ""}! Here&apos;s where to start:</h3>
              <p className="text-sm text-[#5c7f63] mb-3 leading-relaxed">Your garden is planted and ready to grow. Every lesson you log earns a leaf 🍃</p>
              <ol className="text-sm text-[#3d5c42] space-y-1.5">
                <li className="flex items-start gap-2"><span>1️⃣</span><span><strong>Log today&apos;s lessons</strong> — tap a lesson card to check it off and earn your first leaf</span></li>
                <li className="flex items-start gap-2"><span>2️⃣</span><span><strong>Set a Finish Line goal</strong> — track if you&apos;re on pace to finish your curriculum on time 🎯</span></li>
                <li className="flex items-start gap-2"><span>3️⃣</span><span><strong>Explore Resources</strong> — free field trips, discounts, and printables curated for homeschoolers 📚</span></li>
              </ol>
            </div>
          </div>
        </div>
      )}


      {/* ── Coming Up ──────────────────────────────────────── */}
      {showUpcoming && upcomingDay && (() => {
        const upcomingDate = new Date(upcomingDay.date + "T00:00:00");
        const dayName      = upcomingDate.toLocaleDateString("en-US", { weekday: "long" });
        const fullLabel    = upcomingDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        const msFromNow    = upcomingDate.getTime() - new Date().setHours(0, 0, 0, 0);
        const daysFromNow  = Math.round(msFromNow / 86400000);
        const relLabel     = daysFromNow === 1 ? "tomorrow" : `in ${daysFromNow} days`;

        // Check if a vacation block starts on the upcoming day
        const vacOnDay = allVacationBlocks.find(
          (b) => upcomingDay.date >= b.start_date && upcomingDay.date <= b.end_date
        );
        if (vacOnDay) {
          return (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#b5aca4] mb-2">
                Coming Up · {dayName.toUpperCase()}
              </p>
              <p className="text-sm text-[#7a4a1a]">🌴 {vacOnDay.name} starts {fullLabel}</p>
            </div>
          );
        }

        // Group lessons by child, collect subject names per child
        const byChild = new Map<string, { childId: string | null; subjects: Set<string> }>();
        for (const l of upcomingDay.lessons) {
          const key = l.childId ?? "__unassigned__";
          if (!byChild.has(key)) byChild.set(key, { childId: l.childId, subjects: new Set() });
          if (l.subjectName) byChild.get(key)!.subjects.add(l.subjectName);
        }

        return (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#b5aca4]">
                Coming Up · {dayName.toUpperCase()}
              </p>
              <p className="text-[10px] text-[#c8bfb5]">{relLabel}</p>
            </div>
            <div className="space-y-2">
              {Array.from(byChild.values()).map(({ childId, subjects }) => {
                const child    = children.find((c) => c.id === childId);
                const subList  = Array.from(subjects).join(", ");
                return (
                  <div key={childId ?? "__unassigned__"} className="flex items-center gap-2.5">
                    {child ? (
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
                        style={{ backgroundColor: child.color ?? "#5c7f63" }}
                      >
                        {child.name.charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#e8e2d9] flex items-center justify-center shrink-0 text-[10px] font-bold text-[#7a6f65]">?</div>
                    )}
                    <span className="text-sm text-[#2d2926] truncate">
                      {child ? toTitleCase(child.name) : "Unassigned"}
                      {subList && <span className="text-[#7a6f65]"> · {subList}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Daily Quote ───────────────────────────────────── */}
      <div className="bg-[#f5f2ec] rounded-xl px-4 py-3">
        <p className="text-[13px] italic leading-relaxed border-l-2 border-[#e8e2d9] pl-3" style={{ color: "#9e958d" }}>&ldquo;{quote}&rdquo;</p>
      </div>


      <div className="h-4" />

      {/* ── Floating Log Today Button ─────────────────────── */}
      {!isPartner && !showLogModal && (
        <button
          onClick={() => setShowLogModal(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 rounded-full bg-[#5c7f63] hover:bg-[#3d5c42] active:scale-95 text-white shadow-lg flex items-center gap-2 px-4 py-3 transition-all"
          aria-label="Log today"
        >
          <span className="text-2xl font-light leading-none">+</span>
          <span className="text-sm font-semibold">Capture Today</span>
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
              <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="e.g. Charlotte's Web" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who read it?</label>
                <select value={bookChild} onChange={(e) => setBookChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">Everyone / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <p className="text-xs text-[#7a6f65] bg-[#e8f0e9] rounded-xl px-3 py-2">
              🍃 This book will add a leaf to {bookChild ? children.find((c) => c.id === bookChild)?.name + "'s" : "the"} garden tree.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowBookModal(false)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button onClick={saveBook} disabled={savingBook || !bookTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingBook ? "Saving…" : "Log Book 🍃"}
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
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Lesson title" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Hours spent (optional)</label>
              <input value={editHours} onChange={(e) => setEditHours(e.target.value)} type="number" min="0" max="24" step="0.5" placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingLesson(null)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Activity modal ───────────────────────────── */}
      {editingActivity && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">✏️ Edit</h2>
              <button
                onClick={() => { setEditingActivity(null); setActivityDeleteConfirm(false); }}
                className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none"
              >×</button>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Title *</label>
              <input value={activityEditTitle} onChange={(e) => setActivityEditTitle(e.target.value)} autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select value={activityEditChild} onChange={(e) => setActivityEditChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">Unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={saveActivityEdit} disabled={savingActivityEdit || !activityEditTitle.trim()}
              className="w-full py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
              {savingActivityEdit ? "Saving…" : "Save"}
            </button>
            {!activityDeleteConfirm ? (
              <button onClick={() => setActivityDeleteConfirm(true)}
                className="w-full py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors">
                Delete
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-center text-[#2d2926] font-medium">Are you sure?</p>
                <div className="flex gap-2">
                  <button onClick={() => setActivityDeleteConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
                  <button onClick={deleteActivityItem}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors">Delete</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Log Today Modal ───────────────────────────────── */}
      {showLogModal && (
        <LogTodayModal
          children={children}
          subjects={subjects}
          today={today}
          onClose={() => setShowLogModal(false)}
          onSaved={handleLogSaved}
        />
      )}

      {/* ── Saved to Memories toast ──────────────────────── */}
      {savedMemoryToast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[70] pointer-events-none toast-slide-up">
          <div className="bg-[#3d5c42] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">
            Saved to Memories 🌱
          </div>
        </div>
      )}

      {/* ── Garden growth toast ───────────────────────────── */}
      {gardenToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <div className="bg-[#3d5c42] text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 whitespace-nowrap animate-bounce-once">
            <span>🌿</span>
            <span>{gardenToast.name} earned a leaf! {gardenToast.leaves} total</span>
          </div>
        </div>
      )}

      {/* ── PWA Install Banner ────────────────────────────── */}
      {showPwaBanner && (
        <div className="sm:hidden fixed bottom-20 left-4 right-4 z-50 bg-[#2d2926] text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xl shrink-0">🌿</span>
          <p className="flex-1 text-sm font-medium leading-tight">Add Rooted to your home screen</p>
          <button onClick={() => setShowPwaModal(true)} className="shrink-0 text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors">How?</button>
          <button onClick={() => { localStorage.setItem("pwa-banner-dismissed", "true"); setShowPwaBanner(false); }} aria-label="Dismiss" className="shrink-0 text-white/60 hover:text-white text-lg leading-none transition-colors">×</button>
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
            <button onClick={() => setShowPwaModal(false)} className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors">Got it!</button>
          </div>
        </div>
      )}

      <FloatingLeaves active={celebrating} />

      {/* ── Tier 2: Child done toast ──────────────────────── */}
      {childDoneToast && (
        <div
          className={`fixed bottom-24 left-1/2 z-[70] pointer-events-none ${childDoneToastOut ? 'child-toast-out' : 'child-toast-in'}`}
        >
          <div className="bg-[#2d2926] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">
            🌟 {childDoneToast}&apos;s done for today!
          </div>
        </div>
      )}

      </div>
    </>
  );
}
