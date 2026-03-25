"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import LogTodayModal from "@/app/components/LogTodayModal";
import PageHero from "@/app/components/PageHero";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

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

const DID_YOU_KNOW = [
  "Homeschool students score 15–30% higher on standardized tests on average 📚",
  "Kids retain 90% more when they teach what they've learned to someone else 🌱",
  "There are over 3.3 million homeschool students in the US — and growing 🌿",
  "The average homeschool family spends just 3–4 hours a day on structured learning 🕐",
  "Homeschool graduates are more likely to be civically engaged as adults 🗳️",
  "Kids who learn at their own pace show stronger long-term retention 📖",
  "Many colleges actively recruit homeschool graduates for their self-motivation 🎓",
  "Reading aloud to children of any age strengthens vocabulary and comprehension 📗",
  "Nature-based learning improves focus and reduces anxiety in children 🌲",
  "Children learn best when they feel emotionally safe and unhurried 🏡",
  "Asking 'what do you think?' develops critical thinking more than giving answers 💬",
  "Music education strengthens math skills — even informally 🎵",
  "Siblings who learn together develop stronger communication and empathy 👫",
  "Hands-on projects create memories that reinforce learning for years 🔬",
  "The best curriculum is the one your child will actually engage with 🌟",
  "You don't have to do it all. Consistency beats perfection every time 🌱",
  "Octopuses have three hearts, blue blood, and can open jars. They'd ace science 🐙",
  "A group of flamingos is called a 'flamboyance.' You're welcome 🦩",
  "Honey never expires — archaeologists found 3,000-year-old honey in Egypt still good 🍯",
  "The shortest war in history lasted 38–45 minutes. Someone surrendered fast ⚔️",
  "Bananas are technically berries. Strawberries are not. Botany is wild 🍌",
  "The entire internet weighs about the same as a strawberry — in electrons 🍓",
  "A day on Venus is longer than a year on Venus. Time is a construct 🪐",
  "Wombats produce cube-shaped poop. Scientists are genuinely studying why 🐨",
  "Cleopatra lived closer in time to the Moon landing than to the pyramids being built 🏛️",
  "The word 'nerd' was first used by Dr. Seuss in 1950. He invented the nerd 🤓",
  "Crows can recognize human faces and hold grudges for years 🐦‍⬛",
  "Nintendo was founded in 1889. They started as a playing card company 🃏",
  "Scotland's national animal is the unicorn 🦄",
  "There are more possible games of chess than atoms in the observable universe ♟️",
  "A bolt of lightning is five times hotter than the surface of the sun ⚡",
  "Sloths can hold their breath longer than dolphins — up to 40 minutes 🦥",
  "The smell of rain has a name: petrichor. One of the best words in English 🌧️",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateHero(date: Date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const rest    = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  return `${weekday} · ${rest}`;
}

function buildGreeting(firstName: string, opts: { allDone?: boolean; isSchoolDay?: boolean; streak?: number } = {}): string {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const name = firstName || "";

  // All done state
  if (opts.allDone) {
    if (day === 5) return `You finished the week${name ? `, ${name}` : ""}! 🎉`;
    return `You did it${name ? `, ${name}` : ""}! 🎉`;
  }

  // Weekend / non-school day
  if (!opts.isSchoolDay || day === 0 || day === 6) {
    return `Enjoy the rest${name ? `, ${name}` : ""} 🌿`;
  }

  // Monday
  if (day === 1) {
    if (hour < 12) return `Ready for the week${name ? `, ${name}` : ""}? 🌱`;
    if (hour < 17) return `Great start to the week${name ? `, ${name}` : ""} 🌱`;
    return `You showed up today${name ? `, ${name}` : ""} 🌿`;
  }

  // Tue–Thu
  if (day >= 2 && day <= 4) {
    if (hour < 12) return `Good morning${name ? `, ${name}` : ""} 🌿`;
    if (hour < 17) return `Keep it going${name ? `, ${name}` : ""} 🌱`;
    return `Good evening${name ? `, ${name}` : ""} 🌿`;
  }

  // Friday
  if (day === 5) {
    if (hour < 12) return `Last day of the week — finish strong${name ? `, ${name}` : ""}! 🌟`;
    if (hour < 17) return `Almost there${name ? `, ${name}` : ""} 🌱`;
    return `What a week${name ? `, ${name}` : ""} 🌿`;
  }

  return `Good day${name ? `, ${name}` : ""} 🌿`;
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
  const [factIndex, setFactIndex] = useState(dayOfYear % DID_YOU_KNOW.length);
  const [factFade, setFactFade] = useState(true);
  const { isPartner, effectiveUserId } = usePartner();

  const [familyName,      setFamilyName]      = useState("");
  const [firstName,       setFirstName]       = useState("");
  const [onboarded,       setOnboarded]       = useState<boolean | null>(null);
  const [children,        setChildren]        = useState<Child[]>([]);
  const [selectedChild,   setSelectedChild]   = useState<string | null>(null);
  const [lessons,         setLessons]         = useState<Lesson[]>([]);
  const [hasAnyLessons,   setHasAnyLessons]   = useState(false);
  const [leafCounts,      setLeafCounts]      = useState<Record<string, number>>({});
  const [loading,         setLoading]         = useState(true);
  const [celebrating,     setCelebrating]     = useState(false);
  const [childDoneToast,    setChildDoneToast]    = useState<string | null>(null);
  const [childDoneToastOut, setChildDoneToastOut] = useState(false);
  const [allDoneBanner,     setAllDoneBanner]     = useState(false);
  const childDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo pill
  const [undoPill, setUndoPill] = useState<{ lessonId: string; subjectName: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Uncheck confirm
  const [uncheckConfirm, setUncheckConfirm] = useState<{ lessonId: string; subjectName: string } | null>(null);

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
  const [planType,         setPlanType]         = useState<string | null>(null);
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
  const [memoryMoment,           setMemoryMoment]           = useState<{
    kind: "on_this_day" | "recent" | "empty";
    memory?: { id: string; title: string; photo_url: string | null; date: string; type: string };
    yearsAgo?: number;
  } | null>(null);
  const [gardenToast,            setGardenToast]            = useState<{ name: string; leaves: number } | null>(null);
  const [activeVacation,         setActiveVacation]         = useState<{ name: string; end_date: string } | null>(null);
  const [isSchoolDay,            setIsSchoolDay]            = useState(true);
  const [streak,                 setStreak]                 = useState(0);
  const [weekDots,               setWeekDots]               = useState<("done" | "partial" | "off" | "future")[]>([]);
  const [showFamilyUpdate,       setShowFamilyUpdate]       = useState(false);
  const [daysLearning,           setDaysLearning]           = useState<number | null>(null);
  const [familyPhotoUrl,         setFamilyPhotoUrl]         = useState<string | null>(null);
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
      supabase.from("profiles").select("display_name, onboarded, school_days, school_year_start, family_photo_url").eq("id", effectiveUserId).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("profiles").select("is_pro, plan_type").eq("id", effectiveUserId).single(),
    ]);
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setFirstName(authUser?.user_metadata?.first_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);
    setIsPro((profileData as { is_pro?: boolean } | null)?.is_pro ?? false);
    setPlanType((profileData as { plan_type?: string } | null)?.plan_type ?? null);
    setFamilyPhotoUrl((profile as { family_photo_url?: string } | null)?.family_photo_url ?? null);

    // Check if today is a school day
    const schoolDays: string[] = (profile as { school_days?: string[] } | null)?.school_days ?? [];
    if (schoolDays.length > 0) {
      const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      setIsSchoolDay(schoolDays.includes(todayDayName));
    }

    // "Days learning together" milestone — 1st school day of each month
    const schoolYearStart = (profile as { school_year_start?: string } | null)?.school_year_start;
    if (schoolYearStart) {
      const now = new Date();
      const milestoneKey = `milestone_shown_${now.getFullYear()}_${now.getMonth()}`;
      if (!localStorage.getItem(milestoneKey)) {
        const startDate = new Date(schoolYearStart + "T00:00:00");
        const diffDays = Math.floor((now.getTime() - startDate.getTime()) / 86400000);
        if (diffDays > 0) {
          setDaysLearning(diffDays);
          localStorage.setItem(milestoneKey, "1");
        }
      }
    }

    // Streak + week dots: fetch recent completed lesson dates
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];
    const { data: recentLessons } = await supabase
      .from("lessons")
      .select("date, scheduled_date, completed")
      .eq("user_id", effectiveUserId)
      .gte("scheduled_date", thirtyDaysAgoStr);

    // Build sets of dates with any lessons and dates with all complete
    const lessonsByDate = new Map<string, { total: number; done: number }>();
    for (const l of recentLessons ?? []) {
      const d = l.date ?? l.scheduled_date ?? "";
      if (!d) continue;
      const entry = lessonsByDate.get(d) ?? { total: 0, done: 0 };
      entry.total++;
      if (l.completed) entry.done++;
      lessonsByDate.set(d, entry);
    }

    // Calculate streak: consecutive school days going back from yesterday with at least 1 completed lesson
    let currentStreak = 0;
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 1); // start from yesterday
    for (let i = 0; i < 60; i++) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dayName = cursor.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (schoolDays.length > 0 && !schoolDays.includes(dayName)) {
        cursor.setDate(cursor.getDate() - 1);
        continue; // skip non-school days
      }
      const entry = lessonsByDate.get(dateStr);
      if (entry && entry.done > 0) {
        currentStreak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    // If today has completions, count today too
    const todayEntry = lessonsByDate.get(today);
    if (todayEntry && todayEntry.done > 0) currentStreak++;
    setStreak(currentStreak);

    // Week dots: Mon–Fri of current week
    const nowDate = new Date();
    const currentDow = nowDate.getDay(); // 0=Sun
    const monday = new Date(nowDate);
    monday.setDate(monday.getDate() - ((currentDow === 0 ? 7 : currentDow) - 1));
    const dots: ("done" | "partial" | "off" | "future")[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (dateStr > today) {
        dots.push("future");
      } else if (schoolDays.length > 0 && !schoolDays.includes(dayName)) {
        dots.push("off");
      } else {
        const entry = lessonsByDate.get(dateStr);
        if (!entry || entry.total === 0) dots.push("off");
        else if (entry.done === entry.total) dots.push("done");
        else dots.push("partial");
      }
    }
    setWeekDots(dots);

    // Check if we should show the family update prompt
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthKey = `family_update_seen_${prevMonthYear}_${prevMonth}`;
    const alreadySeen = localStorage.getItem(monthKey) === "1";
    if (!alreadySeen && now.getDate() <= 15) {
      // Check if user had lessons last month
      const prevStart = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, "0")}-01`;
      const prevEnd = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, "0")}-31`;
      const { count: prevMonthLessons } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .gte("date", prevStart)
        .lte("date", prevEnd);
      if ((prevMonthLessons ?? 0) > 0) setShowFamilyUpdate(true);
    }

    const { data: childrenData } = await supabase
      .from("children").select("id, name, color, birthday")
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

    // Auto-select first incomplete child
    const kids = childrenData ?? [];
    const kidsWithLessons = kids.filter((c: Child) => loadedLessons.some(l => l.child_id === c.id));
    if (kidsWithLessons.length > 0) {
      const firstIncomplete = kidsWithLessons.find((c: Child) => !loadedLessons.filter(l => l.child_id === c.id).every(l => l.completed));
      setSelectedChild((firstIncomplete ?? kidsWithLessons[0]).id);
    }

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

  // ── Auto-rotate Did You Know quotes ─────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setFactFade(false);
      setTimeout(() => {
        setFactIndex((prev) => (prev + 1) % DID_YOU_KNOW.length);
        setFactFade(true);
      }, 300);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // ── Lesson actions ────────────────────────────────────────────────────────

  function triggerGardenAnimation(childId?: string) {
    const child = children.find((c) => c.id === childId);
    const newLeaves = (leafCounts[childId ?? ""] ?? 0) + 1;
    setGardenToast({ name: child?.name ?? "Your garden", leaves: newLeaves });
    setTimeout(() => setGardenToast(null), 2500);
  }

  async function toggleLesson(id: string, current: boolean) {
    const lesson = lessons.find((l) => l.id === id);
    const subjectName = lesson?.subjects?.name ?? lesson?.title ?? "Lesson";

    // Unchecking a previously-completed lesson → show confirm
    if (current) {
      setUncheckConfirm({ lessonId: id, subjectName });
      return;
    }

    // Checking complete → apply immediately + show undo pill
    completeLesson(id, lesson);
  }

  async function completeLesson(id: string, lesson: Lesson | undefined) {
    const subjectName = lesson?.subjects?.name ?? lesson?.title ?? "Lesson";
    const updatedLessons = lessons.map(l => l.id === id ? { ...l, completed: true } : l);
    setLessons(updatedLessons);
    await supabase.from("lessons").update({ completed: true }).eq("id", id);

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

    await refreshLeafCounts();

    // Show undo pill with 5-second timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoPill({ lessonId: id, subjectName });
    undoTimerRef.current = setTimeout(() => setUndoPill(null), 5000);
  }

  async function undoComplete(lessonId: string) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoPill(null);
    setLessons((prev) => prev.map(l => l.id === lessonId ? { ...l, completed: false } : l));
    await supabase.from("lessons").update({ completed: false }).eq("id", lessonId);
    setAllDoneBanner(false);
    await refreshLeafCounts();
  }

  async function confirmUncheck(lessonId: string) {
    setUncheckConfirm(null);
    setLessons((prev) => prev.map(l => l.id === lessonId ? { ...l, completed: false } : l));
    await supabase.from("lessons").update({ completed: false }).eq("id", lessonId);
    setAllDoneBanner(false);
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
  const pendingLessons = totalToday > 0 && !allDone;
  const showUpcoming   = !activeVacation && isSchoolDay && subjects.length > 0 && !pendingLessons && !!upcomingDay;

  const childrenWithLessons = children.filter(c => lessons.some(l => l.child_id === c.id));

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
        title={activeVacation
          ? `${familyName ? `The ${familyName.replace(/^The\s+/i, "").replace(/\s+family$/i, "")} Family is` : "You're"} on ${activeVacation.name} 🌴`
          : buildGreeting(firstName || familyName, { allDone, isSchoolDay: isSchoolDay && !activeVacation, streak })}
        subtitle={activeVacation ? `Back ${new Date(activeVacation.end_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}` : undefined}
        bgColor={activeVacation ? "#1a6b8a" : undefined}
        photoUrl={familyPhotoUrl}
      >
        {totalToday > 0 && isSchoolDay && !activeVacation && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mt-3" style={{ background: "rgba(255,255,255,0.10)" }}>
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.70)" }}>Today&apos;s lessons</span>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.20)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: "#a8d4aa" }} />
            </div>
            <span className="text-[12px] font-semibold text-white">{completedToday} / {totalToday}</span>
          </div>
        )}

        {/* Streak */}
        {streak >= 2 && isSchoolDay && !activeVacation && (
          <p className="text-[11px] mt-2 text-center" style={{ color: "rgba(255,255,255,0.6)" }}>
            🌱 {streak} day streak
          </p>
        )}

        {/* Founding Member badge */}
        {planType === "founding_family" && (
          <p className="mt-2 text-center">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)" }}>
              {"\uD83C\uDF31"} Founding Member
            </span>
          </p>
        )}

        {/* Days learning milestone — shows once per month */}
        {daysLearning && !activeVacation && (
          <p className="text-[11px] mt-1 text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
            {familyName ? `The ${familyName.replace(/^The\s+/i, "").replace(/\s+family$/i, "")} family has` : "You've"} been learning together for {daysLearning} days 🌱
          </p>
        )}
      </PageHero>

      <div className="max-w-2xl mx-auto px-5 pt-5 pb-7 space-y-6">

      {/* ── AI Family Update Prompt ────────────────────────────── */}
      {showFamilyUpdate && (
        <div className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: "#fef9e8", border: "1.5px solid #f0dda8" }}>
          <Link href="/dashboard/family-update" onClick={() => {
            const now = new Date();
            const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
            const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            localStorage.setItem(`family_update_seen_${prevMonthYear}_${prevMonth}`, "1");
            setShowFamilyUpdate(false);
          }} className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-xl shrink-0">✨</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#7a4a1a]">
                Your {new Date(new Date().getFullYear(), new Date().getMonth() - 1).toLocaleDateString("en-US", { month: "long" })} family update is ready
              </p>
              <p className="text-xs text-[#a68a50]">See what your family accomplished this month →</p>
            </div>
          </Link>
          <button
            onClick={() => {
              const now = new Date();
              const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
              const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
              localStorage.setItem(`family_update_seen_${prevMonthYear}_${prevMonth}`, "1");
              setShowFamilyUpdate(false);
            }}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#a68a50] hover:bg-[#f0dda8]/50 transition-colors text-lg leading-none"
          >×</button>
        </div>
      )}

      {/* ── Setup Banner — only after data is loaded and user genuinely has 0 children ── */}
      {!loading && children.length === 0 && !bannerDismissed && (
        <div className="relative flex items-center justify-between gap-4 bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4">
          <p className="text-sm text-[#2d2926] font-medium leading-snug">
            🌱 Add your children to get started with Rooted.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/dashboard/settings?section=children" className="bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
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

      {/* ── Child Pills + Card Stack (only when children exist) ── */}
      {children.length > 0 && <>
      {lessons.length > 0 && !activeVacation && isSchoolDay && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 px-4">
          {children.map((child) => {
            const childLessons = lessons.filter(l => l.child_id === child.id);
            if (childLessons.length === 0) return null;
            const childDone = childLessons.every(l => l.completed);
            const isActive = selectedChild === child.id;
            return (
              <button
                key={child.id}
                onClick={() => setSelectedChild(child.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold shrink-0 transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[#3d5c42] text-white'
                    : childDone
                    ? 'bg-[#e8f5ea] border border-[#b8d9bc] text-[#3d5c42]'
                    : 'bg-white border border-[#e8e2d9] text-[#7a6f65]'
                }`}>
                {child.name}
                {childDone && <span className="text-[11px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Today's Sections ─────────────────────────────── */}
      <div>
        {allDoneBanner && (
          <>
            <div className="mb-4 bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4 text-center">
              <p className="text-lg font-bold text-[#2d2926]">🎉 Amazing day!</p>
              <p className="text-sm text-[#5c7f63] mt-0.5">You earned {completedToday} {completedToday === 1 ? "leaf" : "leaves"} today 🍃</p>
            </div>
            {/* Capture card removed — replaced by floating camera FAB on Memories page */}
          </>
        )}
        {(() => {
          const childIds = new Set(children.map((c) => c.id));
          const unassignedLessons = lessons.filter((l) => !l.child_id || !childIds.has(l.child_id));
          const hasAnyContent     = childrenWithLessons.length > 0 || unassignedLessons.length > 0;

          if (!hasAnyContent) {
            // Priority: vacation (banner already shown above) > non-school-day > no content
            if (activeVacation) return null;
            if (!isSchoolDay) {
              const dow = new Date().getDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <div className="py-8 flex flex-col items-center text-center">
                  {/* Leaf illustration */}
                  <svg width="64" height="64" viewBox="0 0 64 64" className="mb-3 opacity-30">
                    <path d="M32 8 C16 20, 8 36, 16 52 C24 48, 28 40, 32 32 C36 40, 40 48, 48 52 C56 36, 48 20, 32 8Z" fill="#5c7f63" />
                    <line x1="32" y1="12" x2="32" y2="56" stroke="#3d5c42" strokeWidth="1.5" opacity="0.5" />
                  </svg>
                  <p className="text-[20px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                    {isWeekend ? "Rest day 🌿" : "No school today"}
                  </p>
                  <p className="text-[13px] text-[#9e958d] mt-1 mb-5 px-4 max-w-xs">
                    {isWeekend ? "Your garden is still growing" : "Enjoy the slow morning"}
                  </p>

                  {/* Log memory prompt */}
                  <button
                    onClick={() => setShowLogModal(true)}
                    className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-[#5c7f63] hover:bg-[#faf8f5] transition-colors text-left mb-5"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#f0ede8] flex items-center justify-center shrink-0 text-lg">📸</div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#2d2926]">Days off make the best memories</p>
                      <p className="text-xs text-[#7a6f65]">Field trips, books, nature walks — log it →</p>
                    </div>
                  </button>

                  {upcomingDay && (
                    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 w-full max-w-sm text-left">
                      <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-widest mb-2">
                        Coming up {new Date(upcomingDay.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}
                      </p>
                      <div className="space-y-1.5">
                        {upcomingDay.lessons.slice(0, 4).map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5c7f63] shrink-0" />
                            <span className="text-[#2d2926] truncate">{l.title}</span>
                          </div>
                        ))}
                        {upcomingDay.lessons.length > 4 && (
                          <p className="text-xs text-[#b5aca4]">+{upcomingDay.lessons.length - 4} more</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }
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

          // Card-per-child system
          const activeChild = selectedChild ? children.find(c => c.id === selectedChild) : childrenWithLessons[0];
          if (!activeChild) return <p className="text-sm text-[#b5aca4] text-center py-6">No lessons scheduled today</p>;

          // Large family summary mode (4+ kids, no child selected via pill)
          if (childrenWithLessons.length >= 4 && !selectedChild) {
            return (
              <div className="space-y-2">
                {childrenWithLessons.map(child => {
                  const cl = lessons.filter(l => l.child_id === child.id);
                  const d = cl.filter(l => l.completed).length;
                  const t = cl.length;
                  const done = t > 0 && d === t;
                  return (
                    <button key={child.id} onClick={() => setSelectedChild(child.id)}
                      className="w-full flex items-center gap-3 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3.5 hover:border-[#5c7f63] transition-colors text-left">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                        style={{ backgroundColor: child.color ?? "#5c7f63" }}>
                        {child.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 text-sm font-medium text-[#2d2926]">{toTitleCase(child.name)}</span>
                      <span className={`text-sm font-semibold ${done ? "text-[#3d5c42]" : "text-[#7a6f65]"}`}>
                        {done ? "✓" : `${d}/${t}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          }

          // Single child card view
          const childLessons = lessons.filter(l => l.child_id === activeChild.id);
          const childBooks = todayBooks.filter(b => b.payload.child_id === activeChild.id);
          const childMems = todayMemoryEvents.filter(e => e.payload.child_id === activeChild.id);
          const done = childLessons.filter(l => l.completed).length;
          const total = childLessons.length;
          const childAllDone = total > 0 && done === total;

          // Find next incomplete child for "Next" button
          const nextChild = childrenWithLessons.find(c =>
            c.id !== activeChild.id && !lessons.filter(l => l.child_id === c.id).every(l => l.completed)
          );

          return (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
              {/* Card header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f0ede8]">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                  style={{ backgroundColor: activeChild.color ?? "#5c7f63" }}>
                  {activeChild.name.charAt(0).toUpperCase()}
                </div>
                <span className="flex-1 text-sm font-semibold text-[#2d2926]">
                  {toTitleCase(activeChild.name)}
                  {activeChild.birthday && (() => {
                    const bd = new Date(activeChild.birthday + "T12:00:00");
                    const now = new Date();
                    return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate() ? " 🎂" : "";
                  })()}
                </span>
                <span className={`text-sm font-semibold ${childAllDone ? "text-[#3d5c42]" : "text-[#7a6f65]"}`}>
                  {childAllDone ? "✓ Done" : `${done}/${total}`}
                </span>
              </div>

              {/* Lessons */}
              <div className="p-3 space-y-2">
                {childLessons.map(lesson => (
                  <TodayLessonCard key={lesson.id} lesson={lesson} childObj={activeChild}
                    onToggle={toggleLesson} onEdit={openEdit} onDelete={deleteLesson} isPartner={isPartner} />
                ))}
                {childBooks.map(b => (
                  <button key={b.id}
                    onClick={() => !isPartner && openActivityEdit({ type: "book", id: b.id, title: b.payload.title, childId: b.payload.child_id ?? "" })}
                    className="w-full flex items-center gap-3 bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                    <span className="text-lg shrink-0">📖</span>
                    <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{b.payload.title}</p>
                    <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full shrink-0">Book</span>
                  </button>
                ))}
                {childMems.map(e => (
                  <button key={e.id}
                    onClick={() => !isPartner && openActivityEdit({ type: "memory", id: e.id, title: e.payload.title ?? "Memory", childId: e.payload.child_id ?? "", memoryType: e.type })}
                    className="w-full flex items-center gap-3 bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors">
                    <span className="text-lg shrink-0">{e.type === "memory_book" ? "📖" : e.type === "memory_project" ? "🔬" : "📷"}</span>
                    <p className="flex-1 text-sm font-medium text-[#2d2926] truncate">{e.payload.title ?? "Memory"}</p>
                  </button>
                ))}
              </div>

              {/* Next child button */}
              {childAllDone && nextChild && (
                <button
                  onClick={() => setSelectedChild(nextChild.id)}
                  className="w-full px-4 py-3 border-t border-[#e8e2d9] bg-[#e8f5ea] text-sm font-semibold text-[#3d5c42] hover:bg-[#d4ead4] transition-colors"
                >
                  Next: {toTitleCase(nextChild.name)} →
                </button>
              )}

              {/* Unassigned lessons */}
              {unassignedLessons.length > 0 && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-widest px-1">Unassigned</p>
                  {unassignedLessons.map(lesson => (
                    <TodayLessonCard key={lesson.id} lesson={lesson} childObj={undefined}
                      onToggle={toggleLesson} onEdit={openEdit} onDelete={deleteLesson} isPartner={isPartner} />
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
      </>}

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
        const headerLabel  = daysFromNow === 1 ? "Tomorrow 🌱" : `Next school day · ${dayName} 🌱`;

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
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#b5aca4] mb-2.5">
              {headerLabel}
            </p>
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
            <p className="text-[11px] text-[#b5aca4] mt-2">
              {upcomingDay.lessons.length} lesson{upcomingDay.lessons.length !== 1 ? "s" : ""} across {byChild.size} kid{byChild.size !== 1 ? "s" : ""}
            </p>
          </div>
        );
      })()}

      {/* ── Did You Know card (school days only) ────────── */}
      {isSchoolDay && !activeVacation && (
        <button
          onClick={() => {
            setFactFade(false);
            setTimeout(() => {
              setFactIndex((prev) => (prev + 1) % DID_YOU_KNOW.length);
              setFactFade(true);
            }, 200);
          }}
          className="w-full bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 text-left hover:bg-[#faf8f5] transition-colors"
        >
          <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">Did you know?</p>
          <p
            className="text-[13px] text-[#5c5248] leading-relaxed border-l-2 border-[#3d5c42] pl-3 transition-opacity duration-300"
            style={{ opacity: factFade ? 1 : 0 }}
          >
            {DID_YOU_KNOW[factIndex]}
          </p>
        </button>
      )}

      <div className="h-4" />

      {/* Floating log button removed — logging happens on Memories page */}

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

      {/* ── Undo pill ───────────────────────────────────────── */}
      {undoPill && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[80] animate-[fadeUp_0.25s_ease-out]">
          <div className="bg-[#2d2926] rounded-2xl shadow-lg overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3">
              <span className="text-sm text-white">
                <span className="font-semibold">{undoPill.subjectName}</span> marked done
              </span>
              <button
                onClick={() => undoComplete(undoPill.lessonId)}
                className="text-sm font-bold text-[#86efac] hover:text-white transition-colors"
              >
                Undo
              </button>
            </div>
            {/* 5-second countdown bar */}
            <div className="h-0.5 bg-white/10">
              <div
                className="h-full bg-[#86efac]/60"
                style={{ animation: "undoShrink 5s linear forwards" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Uncheck confirm ─────────────────────────────────── */}
      {uncheckConfirm && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4 text-center">
            <p className="text-sm font-semibold text-[#2d2926]">
              Mark <span className="text-[#5c7f63]">{uncheckConfirm.subjectName}</span> incomplete?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setUncheckConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmUncheck(uncheckConfirm.lessonId)}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes undoShrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>

      </div>
    </>
  );
}
