"use client";

// TODO(cleanup): Delete stale test lessons for admin account:
// DELETE FROM lessons WHERE title ILIKE '%test%' AND user_id = 'd18ca881-a776-4e82-b145-832adc88a88a';

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { checkAndAwardBadges } from "@/lib/badges";
// PageHero removed — replaced by Book Cover Card

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

const INSPIRATION_PROMPTS = [
  "What did you learn today? 🌱",
  "What made you laugh today? 😊",
  "What's something new you tried this week? 🌿",
  "What was the best part of your morning? ☀️",
  "What book are you loving right now? 📖",
  "What's something kind someone did today? 💛",
  "What would you teach someone else? 🌟",
  "What surprised you today? ✨",
  "What are you most proud of this week? 🏆",
  "What memory do you want to hold onto? 🕰️",
];

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

/** Local-time YYYY-MM-DD — avoids the UTC shift that toISOString causes. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHero(date: Date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const rest    = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  return `${weekday} · ${rest}`;
}

function buildGreeting(firstName: string, opts: { allDone?: boolean; isSchoolDay?: boolean; streak?: number } = {}): string {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const name = firstName || "";

  // Time-based greeting prefix
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // All done state
  if (opts.allDone) {
    if (day === 5) return `You finished the week${name ? `, ${name}` : ""}! 🎉`;
    return `You did it${name ? `, ${name}` : ""}! 🎉`;
  }

  // Weekend / non-school day — handled separately in the UI
  if (!opts.isSchoolDay || day === 0 || day === 6) {
    return `${timeGreeting}${name ? `, ${name}` : ""} 🌿`;
  }

  // Monday
  if (day === 1) {
    if (hour < 12) return `Ready for the week${name ? `, ${name}` : ""}? 🌱`;
    if (hour < 17) return `Great start to the week${name ? `, ${name}` : ""} 🌱`;
    return `${timeGreeting}${name ? `, ${name}` : ""} 🌿`;
  }

  // Tue–Thu
  if (day >= 2 && day <= 4) {
    if (hour < 12) return `${timeGreeting}${name ? `, ${name}` : ""} 🌿`;
    if (hour < 17) return `Keep it going${name ? `, ${name}` : ""} 🌱`;
    return `${timeGreeting}${name ? `, ${name}` : ""} 🌿`;
  }

  // Friday
  if (day === 5) {
    if (hour < 12) return `Last day of the week — finish strong${name ? `, ${name}` : ""}! 🌟`;
    if (hour < 17) return `Almost there${name ? `, ${name}` : ""} 🌱`;
    return `What a week${name ? `, ${name}` : ""} 🌿`;
  }

  return `${timeGreeting}${name ? `, ${name}` : ""} 🌿`;
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
  const today = localDateStr(new Date());
  const start = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86400000);
  const [factIndex, setFactIndex] = useState(dayOfYear % DID_YOU_KNOW.length);
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
  const [loadError,       setLoadError]       = useState(false);
  const [celebrating,     setCelebrating]     = useState(false);
  const [childDoneToast,    setChildDoneToast]    = useState<string | null>(null);
  const [childDoneToastOut, setChildDoneToastOut] = useState(false);
  const [allDoneBanner,     setAllDoneBanner]     = useState(false);
  const childDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [todayMemoryEvents, setTodayMemoryEvents] = useState<TodayEvent[]>([]);
  const [todayBooks,        setTodayBooks]        = useState<BookLog[]>([]);
  const [showBookModal,     setShowBookModal]     = useState(false);
  const [showLogModal,      setShowLogModal]      = useState(false);
  const [bookTitle,         setBookTitle]         = useState("");
  const [bookChild,         setBookChild]         = useState("");
  const [savingBook,        setSavingBook]        = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => { document.title = "Today \u00b7 Rooted"; }, []);

  useEffect(() => {
    if (sessionStorage.getItem("setup-banner-dismissed") === "1") setBannerDismissed(true);
  }, []);

  const [nudgeDismissed,   setNudgeDismissed]   = useState(false);
  const [isPro,            setIsPro]            = useState(false);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("rooted_setup_nudge_dismissed") === "1") setNudgeDismissed(true);
    const udDate = localStorage.getItem("rooted_upgrade_dismissed");
    if (udDate === localDateStr(new Date())) setUpgradeDismissed(true);
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

  const [savedMemoryToast,       setSavedMemoryToast]       = useState(false);
  const [gardenToast,            setGardenToast]            = useState<{ name: string; leaves: number } | null>(null);
  const [activeVacation,         setActiveVacation]         = useState<{ name: string; end_date: string } | null>(null);
  const [isSchoolDay,            setIsSchoolDay]            = useState(true);
  const [schoolDaysArr,          setSchoolDaysArr]          = useState<string[]>([]);
  // memoryMoment removed — replaced by onThisDayMemory and lastPhoto
  const [lightboxMemory, setLightboxMemory] = useState<{ id: string; title: string; photo_url: string | null; date: string; type: string } | null>(null);
  const [streak,                 setStreak]                 = useState(0);
  const [weekDots,               setWeekDots]               = useState<("done" | "partial" | "off" | "future")[]>([]);
  const [showFamilyUpdate,       setShowFamilyUpdate]       = useState(false);
  const [daysLearning,           setDaysLearning]           = useState<number | null>(null);
  const [familyPhotoUrl,         setFamilyPhotoUrl]         = useState<string | null>(null);
  const [allVacationBlocks,      setAllVacationBlocks]      = useState<{ name: string; start_date: string; end_date: string }[]>([]);
  const [totalMemories, setTotalMemories] = useState(0);
  const [activeDaysThisMonth, setActiveDaysThisMonth] = useState(0);
  const [lastPhoto, setLastPhoto] = useState<{ id: string; title: string; photo_url: string; date: string; child_id: string | null } | null>(null);
  const [onThisDayMemory, setOnThisDayMemory] = useState<{ id: string; title: string; date: string; child_id: string | null; photo_url: string | null } | null>(null);
  const [onThisDayTier, setOnThisDayTier] = useState<1 | 2 | 3>(3);
  const [showWinSheet, setShowWinSheet] = useState(false);
  const [showDrawingSheet, setShowDrawingSheet] = useState(false);
  const [drawingTitle, setDrawingTitle] = useState("");
  const [drawingChild, setDrawingChild] = useState("");
  const [savingDrawing, setSavingDrawing] = useState(false);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [drawingPreview, setDrawingPreview] = useState<string | null>(null);
  const drawingFileRef = useRef<HTMLInputElement>(null);
  const [showCaptureMenu, setShowCaptureMenu] = useState(false);
  const [showFieldTripSheet, setShowFieldTripSheet] = useState(false);
  const [ftTitle, setFtTitle] = useState("");
  const [ftNote, setFtNote] = useState("");
  const [ftChild, setFtChild] = useState("");
  const [ftType, setFtType] = useState<"field_trip" | "project" | "activity">("field_trip");
  const [ftSaving, setFtSaving] = useState(false);
  const captureFileRef = useRef<HTMLInputElement>(null);
  const captureTypeRef = useRef<"photo" | "drawing">("photo");
  const [todayStory, setTodayStory] = useState<{ id: string; type: string; title: string | null; caption: string | null; child_id: string | null; photo_url: string | null; include_in_book: boolean; created_at: string }[]>([]);
  const [captureToast, setCaptureToast] = useState<{ message: string; memoryId: string | null } | null>(null);
  const [editSheet, setEditSheet] = useState<{ id: string; title: string; caption: string; child_id: string; type: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editDeleting, setEditDeleting] = useState(false);
  const [editDeleteConfirm, setEditDeleteConfirm] = useState(false);
  const [winText, setWinText] = useState("");
  const [winType, setWinType] = useState<"win" | "quote">("win");
  const [winChild, setWinChild] = useState("");
  const [savingWin, setSavingWin] = useState(false);
  const [isListening, setIsListening] = useState(false);
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
    try {

    const [{ data: profile }, { data: { user: authUser } }, { data: profileData }] = await Promise.all([
      supabase.from("profiles").select("display_name, onboarded, school_days, school_year_start, family_photo_url").eq("id", effectiveUserId).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("profiles").select("is_pro").eq("id", effectiveUserId).single(),
    ]);
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setFirstName(authUser?.user_metadata?.first_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);
    setIsPro((profileData as { is_pro?: boolean } | null)?.is_pro ?? false);
    setFamilyPhotoUrl((profile as { family_photo_url?: string } | null)?.family_photo_url ?? null);

    // Check if today is a school day
    const schoolDays: string[] = (profile as { school_days?: string[] } | null)?.school_days ?? [];
    setSchoolDaysArr(schoolDays);
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
    const thirtyDaysAgoStr = localDateStr(thirtyDaysAgo);
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
      const dateStr = localDateStr(cursor);
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
      const dateStr = localDateStr(d);
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
      const { data: prevMonthData } = await supabase
        .from("lessons")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .gte("date", prevStart)
        .lte("date", prevEnd);
      if ((prevMonthData?.length ?? 0) > 0) setShowFamilyUpdate(true);
    }

    const { data: childrenData } = await supabase
      .from("children").select("id, name, color, birthday")
      .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order");
    setChildren(childrenData ?? []);

    const [{ data: lessonsData }, { data: allLessonsData }] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, hours, subjects(name, color), curriculum_goal_id, lesson_number, goal_id")
        .eq("user_id", effectiveUserId)
        .or(`date.eq.${today},scheduled_date.eq.${today}`),
      supabase.from("lessons").select("id").eq("user_id", effectiveUserId),
    ]);
    const loadedLessons = (lessonsData as unknown as Lesson[]) ?? [];
    setLessons(loadedLessons);
    setHasAnyLessons((allLessonsData?.length ?? 0) > 0);
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

    // ── Book Cover: total memories this school year ────────────────────
    const schoolYearStartMonth = 7; // August (0-indexed July = school year start)
    const nowForSY = new Date();
    const syYear = nowForSY.getMonth() >= schoolYearStartMonth ? nowForSY.getFullYear() : nowForSY.getFullYear() - 1;
    const syStart = `${syYear}-08-01`;
    const { data: memCountData } = await supabase
      .from("memories")
      .select("id")
      .eq("user_id", effectiveUserId)
      .gte("date", syStart);
    setTotalMemories(memCountData?.length ?? 0);

    // ── Active days this month ─────────────────────────────────────────
    const monthStart = `${nowForSY.getFullYear()}-${String(nowForSY.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = localDateStr(nowForSY);
    const [{ data: monthLessons }, { data: monthMemories }] = await Promise.all([
      supabase.from("lessons").select("date, scheduled_date").eq("user_id", effectiveUserId).eq("completed", true).gte("scheduled_date", monthStart).lte("scheduled_date", monthEnd),
      supabase.from("memories").select("date").eq("user_id", effectiveUserId).gte("date", monthStart).lte("date", monthEnd),
    ]);
    const activeDates = new Set<string>();
    (monthLessons ?? []).forEach((l: { date?: string; scheduled_date?: string }) => {
      const d = l.date ?? l.scheduled_date;
      if (d) activeDates.add(d);
    });
    (monthMemories ?? []).forEach((m: { date: string }) => { if (m.date) activeDates.add(m.date); });
    setActiveDaysThisMonth(activeDates.size);

    // ── Last captured photo ────────────────────────────────────────────
    const { data: lastPhotoData } = await supabase
      .from("memories")
      .select("id, title, photo_url, date, child_id")
      .eq("user_id", effectiveUserId)
      .not("photo_url", "is", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastPhoto(lastPhotoData as typeof lastPhoto);

    // ── On This Day — 3-tier system ─────────────────────────────────────
    const otdNow = new Date();
    const lastYear = otdNow.getFullYear() - 1;

    // Tier 1: ±3 days of today last year
    const otdStart = new Date(lastYear, otdNow.getMonth(), otdNow.getDate() - 3);
    const otdEnd = new Date(lastYear, otdNow.getMonth(), otdNow.getDate() + 3);
    const { data: tier1Data } = await supabase
      .from("memories")
      .select("id, title, date, child_id, photo_url")
      .eq("user_id", effectiveUserId)
      .gte("date", localDateStr(otdStart))
      .lte("date", localDateStr(otdEnd))
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tier1Data) {
      setOnThisDayMemory(tier1Data as typeof onThisDayMemory);
      setOnThisDayTier(1);
      // Award full_circle badge on Tier 1 match
      checkAndAwardBadges(effectiveUserId);
    } else {
      // Tier 2: same month last year
      const tier2Start = new Date(lastYear, otdNow.getMonth(), 1);
      const tier2End = new Date(lastYear, otdNow.getMonth() + 1, 0); // last day of month
      const { data: tier2Data } = await supabase
        .from("memories")
        .select("id, title, date, child_id, photo_url")
        .eq("user_id", effectiveUserId)
        .gte("date", localDateStr(tier2Start))
        .lte("date", localDateStr(tier2End))
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tier2Data) {
        setOnThisDayMemory(tier2Data as typeof onThisDayMemory);
        setOnThisDayTier(2);
      } else {
        // Tier 3: brand new user — show inspiration prompt
        setOnThisDayMemory(null);
        setOnThisDayTier(3);
      }
    }

    // ── Today's story ──────────────────────────────────────────────────
    const { data: storyData } = await supabase
      .from("memories")
      .select("id, type, title, caption, child_id, photo_url, include_in_book, created_at")
      .eq("user_id", effectiveUserId)
      .eq("date", today)
      .order("created_at", { ascending: false });
    setTodayStory((storyData ?? []) as typeof todayStory);

    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [today, effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function refreshTodayStory() {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("memories")
      .select("id, type, title, caption, child_id, photo_url, include_in_book, created_at")
      .eq("user_id", effectiveUserId)
      .eq("date", today)
      .order("created_at", { ascending: false });
    setTodayStory((data ?? []) as typeof todayStory);
  }

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
          .from("curriculum_goals")
          .select("current_lesson, total_lessons, curriculum_name, child_id")
          .eq("id", lesson.curriculum_goal_id)
          .single();

        if (goalRow) {
          if (goalRow.current_lesson < goalRow.total_lessons) {
            const newLessonNum = goalRow.current_lesson + 1;

            await supabase
              .from("curriculum_goals")
              .update({ current_lesson: newLessonNum })
              .eq("id", lesson.curriculum_goal_id);

            // Find next school day
            const days = schoolDaysArr.length > 0
              ? schoolDaysArr
              : ["monday", "tuesday", "wednesday", "thursday", "friday"];
            const nextDate = new Date(today + "T12:00:00");
            for (let i = 0; i < 14; i++) {
              nextDate.setDate(nextDate.getDate() + 1);
              const dayName = nextDate.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
              if (days.includes(dayName)) break;
            }
            const nextDateStr = localDateStr(nextDate);

            await supabase.from("lessons").insert({
              user_id: effectiveUserId,
              child_id: goalRow.child_id,
              curriculum_goal_id: lesson.curriculum_goal_id,
              title: `${goalRow.curriculum_name} — Lesson ${newLessonNum}`,
              lesson_number: newLessonNum,
              scheduled_date: nextDateStr,
              completed: false,
              created_at: new Date().toISOString(),
            });
          } else if (goalRow.current_lesson === goalRow.total_lessons) {
            await supabase
              .from("curriculum_goals")
              .update({ completed: true })
              .eq("id", lesson.curriculum_goal_id);
          }
        }

        // Refresh today's lessons so the UI stays current
        await loadData();
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

    // Check for new activity badges (fire-and-forget, notification via global listener)
    if (!current) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) checkAndAwardBadges(user.id);
    }
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
    const { data: inserted } = await supabase.from("memories").insert({
      user_id: user.id, type: "book", title: bookTitle.trim(),
      child_id: bookChild || null, date: today, include_in_book: true,
    }).select("id").single();
    if (bookChild) setLeafCounts((prev) => ({ ...prev, [bookChild]: (prev[bookChild] ?? 0) + 1 }));
    setBookTitle(""); setBookChild(""); setSavingBook(false); setShowBookModal(false);
    showCaptureToast("📖 Added to your story 🌿", (inserted as { id: string } | null)?.id ?? null);
    // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
    loadData(); refreshTodayStory();
    checkAndAwardBadges(user.id);
  }

  async function saveDrawing() {
    if (!drawingTitle.trim()) return;
    setSavingDrawing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingDrawing(false); return; }
    let photoUrl: string | null = null;
    if (drawingFile) {
      const path = `${user.id}/${Date.now()}-${drawingFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, drawingFile, { contentType: drawingFile.type, upsert: false });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }
    }
    const { data: inserted } = await supabase.from("memories").insert({
      user_id: user.id, type: "drawing", title: drawingTitle.trim(),
      photo_url: photoUrl, child_id: drawingChild || null, date: today, include_in_book: true,
    }).select("id").single();
    setDrawingTitle(""); setDrawingChild(""); setDrawingFile(null); setDrawingPreview(null);
    setSavingDrawing(false); setShowDrawingSheet(false);
    showCaptureToast("🎨 Drawing saved 🌿", (inserted as { id: string } | null)?.id ?? null);
    // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
    loadData(); refreshTodayStory();
    checkAndAwardBadges(user.id);
  }

  // ── Capture toast + edit sheet helpers ────────────────────────────────────

  function showCaptureToast(message: string, memoryId: string | null) {
    setCaptureToast({ message, memoryId });
    setTimeout(() => setCaptureToast(null), 4000);
  }

  function openEditSheet(id: string, title: string, caption: string, childId: string, type: string) {
    setEditSheet({ id, title, caption, child_id: childId, type });
    setEditDeleteConfirm(false);
    setCaptureToast(null);
  }

  async function saveEditSheet() {
    if (!editSheet) return;
    setEditSaving(true);
    await supabase.from("memories").update({
      title: editSheet.title.trim() || null,
      caption: editSheet.caption.trim() || null,
      child_id: editSheet.child_id || null,
      updated_at: new Date().toISOString(),
    }).eq("id", editSheet.id);
    setEditSaving(false); setEditSheet(null);
    showCaptureToast("✏️ Updated 🌿", null);
    // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
    loadData(); refreshTodayStory();
  }

  async function deleteFromEditSheet() {
    if (!editSheet) return;
    setEditDeleting(true);
    await supabase.from("memories").delete().eq("id", editSheet.id);
    setEditDeleting(false); setEditSheet(null);
    showCaptureToast("🗑️ Deleted", null);
    // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
    loadData(); refreshTodayStory();
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
      <>
        {/* Skeleton: Book Cover Card */}
        <div className="mx-5 mt-5 rounded-2xl p-4 space-y-3" style={{ background: "#2d5a3d" }}>
          <div className="w-24 h-2 rounded bg-white/10 animate-pulse" />
          <div className="w-16 h-8 rounded bg-white/15 animate-pulse" />
          <div className="w-40 h-3 rounded bg-white/10 animate-pulse" />
        </div>
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-7 space-y-4">
          {/* Skeleton: Capture button */}
          <div className="w-full h-12 rounded-xl bg-[#e8e2d9] animate-pulse" />
          {/* Skeleton: Greeting */}
          <div className="space-y-2">
            <div className="w-32 h-3 rounded bg-[#e8e2d9] animate-pulse" />
            <div className="w-56 h-5 rounded bg-[#e8e2d9] animate-pulse" />
          </div>
          {/* Skeleton: Lesson rows */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-5 h-5 rounded-md bg-[#e8e2d9] animate-pulse shrink-0" />
                <div className="h-3 rounded bg-[#e8e2d9] animate-pulse flex-1" />
                <div className="w-10 h-2.5 rounded bg-[#e8e2d9] animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 p-8 text-center">
        <span className="text-3xl mb-3">🌿</span>
        <p className="text-sm font-medium text-[#2d2926] mb-1">Something went wrong loading your day</p>
        <p className="text-xs text-[#7a6f65] mb-4">Pull to refresh or try again.</p>
        <button
          onClick={() => { setLoadError(false); setLoading(true); loadData(); }}
          className="px-4 py-2 rounded-xl bg-[#5c7f63] text-white text-sm font-medium hover:bg-[#3d5c42] transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ── Book Cover Card ──────────────────────────────────── */}
      <div className="mx-5 mt-5 rounded-2xl p-4 relative overflow-hidden" style={{ background: "#2d5a3d" }}>
        <div className="absolute top-2 right-3 text-[80px] leading-none select-none pointer-events-none" style={{ opacity: 0.06 }} aria-hidden>🌿</div>
        <p className="text-[9px] font-medium tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>
          {(() => {
            const n = new Date();
            const syY = n.getMonth() >= 7 ? n.getFullYear() : n.getFullYear() - 1;
            return `${syY}–${syY + 1}`;
          })()} · {familyName || "My Family"}
        </p>
        {totalMemories > 0 ? (
          <>
            <p className="text-[32px] font-bold text-white leading-tight mt-1">{totalMemories} 🌿</p>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>memories in your story</p>
            {activeDaysThisMonth > 0 && (
              <div className="inline-block mt-2.5 px-2.5 py-1 rounded-full text-[10px] font-medium" style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>
                {activeDaysThisMonth} day{activeDaysThisMonth !== 1 ? "s" : ""} active in {new Date().toLocaleDateString("en-US", { month: "long" })}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-[20px] text-white font-bold leading-snug mt-2 mb-2" style={{ fontFamily: "Georgia, serif" }}>
              Your homeschool story starts here 🌿
            </p>
            <p className="text-[12px] mb-3" style={{ color: "rgba(255,255,255,0.6)" }}>
              Capture anything — big milestones or small everyday moments.
            </p>
            <div className="space-y-1.5 mb-3">
              {[
                ["📸", "Photos & drawings"],
                ["✍️", "Wins & moments"],
                ["📖", "Books they're reading"],
                ["🗺️", "Field trips & projects"],
              ].map(([icon, label]) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="text-sm">{icon}</span>
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] italic" style={{ color: "rgba(255,255,255,0.45)" }}>
              Tap the button below to add your first memory.
            </p>
          </>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-5 pb-7 space-y-6">

      {/* ── Daily inspiration prompt (active users) ──────────── */}
      {!isPartner && totalMemories > 0 && (() => {
        const prompts = [
          "Did they build or create something today? Log it. 🎨",
          "Read anything good this week? Add it to their story. 📖",
          "Did they go somewhere new? Log the field trip. 🗺️",
          "Something funny or sweet happened — write it down. ✍️",
          "A drawing worth keeping? Snap it before it gets lost. 📸",
          "What did they figure out today? That's a win. 🏆",
          "An ordinary moment you'll want to remember someday. 📸",
        ];
        return (
          <div className="rounded-xl px-3.5 py-2.5" style={{ background: "#2d5a3d" }}>
            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.75)" }}>
              {prompts[new Date().getDay()]}
            </p>
          </div>
        );
      })()}

      {/* ── Capture buttons ──────────────────────────────────── */}
      {!isPartner && (
        <>
          <div className="space-y-2">
            <button
              onClick={() => { captureTypeRef.current = "photo"; captureFileRef.current?.click(); }}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: "#2d5a3d" }}
            >
              📸 Capture a photo
            </button>
            <button
              onClick={() => setShowCaptureMenu(true)}
              className="w-full text-center text-sm text-[#9a8f85] hover:text-[#7a6f65] transition-colors py-1"
            >
              Or log a win, book, drawing, field trip →
            </button>
          </div>
          <input
            ref={captureFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (e.target) e.target.value = "";
              if (!file) return;
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
              const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, file, { contentType: file.type, upsert: false });
              if (upErr) return;
              const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
              const memType = captureTypeRef.current;
              const { data: ins } = await supabase.from("memories").insert({
                user_id: user.id, type: memType, title: null,
                photo_url: urlData.publicUrl, child_id: null,
                date: today, include_in_book: false,
              }).select("id").single();
              const toastMsg = memType === "drawing" ? "🎨 Drawing saved 🌿" : "📸 Memory saved 🌿";
              showCaptureToast(toastMsg, (ins as { id: string } | null)?.id ?? null);
              captureTypeRef.current = "photo"; // reset
              // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
              loadData(); refreshTodayStory();
              checkAndAwardBadges(user.id);
            }}
          />
        </>
      )}

      {/* ── Today's Story ────────────────────────────────────── */}
      {todayStory.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-[#9a8f85] mb-2 px-0.5">TODAY&apos;S STORY</p>
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {todayStory.map((m) => {
              const icons: Record<string, string> = { photo: "📸", drawing: "🎨", win: "🏆", quote: "🗒️", book: "📖", field_trip: "🗺️", project: "🔬", activity: "🎵" };
              const icon = icons[m.type] ?? "🌿";
              const child = m.child_id ? children.find((c) => c.id === m.child_id) : null;
              const ago = (() => {
                const diff = Math.round((Date.now() - new Date(m.created_at).getTime()) / 60000);
                if (diff < 1) return "just now";
                if (diff < 60) return `${diff}m ago`;
                const hrs = Math.round(diff / 60);
                return `${hrs}h ago`;
              })();
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={async () => {
                    const { data } = await supabase.from("memories").select("id, title, caption, child_id, type").eq("id", m.id).single();
                    if (data) {
                      const d = data as { id: string; title: string | null; caption: string | null; child_id: string | null; type: string };
                      openEditSheet(d.id, d.title ?? "", d.caption ?? "", d.child_id ?? "", d.type);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#faf8f5] transition-colors"
                >
                  <span className="text-lg shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-[#2d2926] truncate">
                        {m.title || (m.type === "photo" ? "Photo" : m.type.charAt(0).toUpperCase() + m.type.slice(1).replace("_", " "))}
                      </p>
                      {m.include_in_book && <span className="text-[10px] shrink-0">🔖</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {child && (
                        <>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: child.color ?? "#5c7f63" }} />
                          <span className="text-[11px] text-[#7a6f65]">{child.name}</span>
                          <span className="text-[11px] text-[#c8bfb5]">·</span>
                        </>
                      )}
                      <span className="text-[11px] text-[#c8bfb5]">{ago}</span>
                    </div>
                  </div>
                  <span className="text-[#c8bfb5] text-sm shrink-0">›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        {allDoneBanner && lessons.length > 0 && lessons.every(l => l.completed) && (
          <>
            <div className="mb-4 bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4 text-center">
              <p className="text-lg font-bold text-[#2d2926]">🎉 Amazing day!</p>
              <p className="text-sm text-[#5c7f63] mt-0.5">You earned {completedToday} {completedToday === 1 ? "leaf" : "leaves"} today 🍃</p>
            </div>
            <button
              onClick={() => setShowLogModal(true)}
              className="mb-4 w-full bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-[#5c7f63] hover:bg-[#faf8f5] transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-[#f0ede8] flex items-center justify-center shrink-0 text-lg">📸</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#2d2926]">Capture today&apos;s memory</p>
                <p className="text-xs text-[#7a6f65]">What did you do today? Add a photo, book, or note.</p>
              </div>
              <span className="text-[#c8bfb5] text-lg">›</span>
            </button>
          </>

        )}
        {(() => {
          const childIds = new Set(children.map((c) => c.id));
          const unassignedLessons = lessons.filter((l) => !l.child_id || !childIds.has(l.child_id));
          const hasAnyContent     = childrenWithLessons.length > 0 || unassignedLessons.length > 0;

          if (!hasAnyContent) {
            // Priority: vacation > non-school-day > no content
            if (activeVacation) return (
              <div className="rounded-2xl px-4 py-3" style={{ background: "#fef9e8", border: "1.5px solid #f0dda8" }}>
                <p className="text-sm font-semibold text-[#7a4a1a]">🌴 <strong>{activeVacation.name}</strong> · No lessons today — enjoy your time off!</p>
              </div>
            );
            if (!isSchoolDay) {
              const dow = new Date().getDay();
              const isWeekend = dow === 0 || dow === 6;

              // Find the next school day name from the profile's school_days
              const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
              let resumeDay = "";
              if (schoolDaysArr.length > 0) {
                for (let offset = 1; offset <= 7; offset++) {
                  const checkDay = dayNames[(dow + offset) % 7];
                  if (schoolDaysArr.includes(checkDay)) {
                    resumeDay = checkDay.charAt(0).toUpperCase() + checkDay.slice(1);
                    break;
                  }
                }
              }

              return (
                <div className="py-8 flex flex-col items-center text-center">
                  {/* Leaf illustration */}
                  <svg width="64" height="64" viewBox="0 0 64 64" className="mb-3 opacity-30">
                    <path d="M32 8 C16 20, 8 36, 16 52 C24 48, 28 40, 32 32 C36 40, 40 48, 48 52 C56 36, 48 20, 32 8Z" fill="#5c7f63" />
                    <line x1="32" y1="12" x2="32" y2="56" stroke="#3d5c42" strokeWidth="1.5" opacity="0.5" />
                  </svg>
                  <p className="text-[20px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                    {isWeekend ? "Enjoy your weekend! 🌿" : "No school today"}
                  </p>
                  <p className="text-[13px] text-[#9e958d] mt-1 mb-5 px-4 max-w-xs">
                    School resumes {resumeDay || "Monday"}.
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
            return (
              <div className="py-8 flex flex-col items-center text-center">
                <span className="text-[40px] block mb-2">📋</span>
                <p className="text-[17px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  No lessons scheduled today
                </p>
                <p className="text-[13px] text-[#9e958d] mt-1 mb-5 px-4 max-w-xs">
                  Set up your curriculum to get daily lessons here automatically.
                </p>
                <Link href="/dashboard/plan?openWizard=true" className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                  Set Up Your Curriculum →
                </Link>
              </div>
            );
          }

          // Card-per-child system
          const activeChild = selectedChild ? children.find(c => c.id === selectedChild) : childrenWithLessons[0];
          if (!activeChild) return (
            <div className="py-8 flex flex-col items-center text-center">
              <span className="text-[40px] block mb-2">📋</span>
              <p className="text-[17px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                No lessons scheduled today
              </p>
              <p className="text-[13px] text-[#9e958d] mt-1 mb-5 px-4 max-w-xs">
                Set up your curriculum to get daily lessons here automatically.
              </p>
              <Link href="/dashboard/plan?openWizard=true" className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                Set Up Your Curriculum →
              </Link>
            </div>
          );

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

      {/* ── On This Day — 3-tier system ─────────────────────── */}
      {onThisDayMemory && onThisDayTier === 1 && (
        <Link href="/dashboard/memories" className="block rounded-2xl overflow-hidden" style={{ background: "#f5f0fa", border: "1.5px solid #d9bee8" }}>
          {onThisDayMemory.photo_url && (
            <img
              src={onThisDayMemory.photo_url}
              alt={onThisDayMemory.title || "Memory from last year"}
              className="w-full h-44 object-cover"
            />
          )}
          <div className="px-4 py-3.5">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full mb-2" style={{ background: "#ede4f5", color: "#7a4a9e" }}>
              🕰️ On This Day last year...
            </span>
            <p className="text-sm font-medium text-[#2d2926]">{onThisDayMemory.title}</p>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-[#7a6f65]">
                {(() => {
                  const child = children.find(c => c.id === onThisDayMemory.child_id);
                  const dateLabel = new Date(onThisDayMemory.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return child ? `${child.name} · ${dateLabel}` : dateLabel;
                })()}
              </span>
              <span className="text-xs font-medium" style={{ color: "#7a4a9e" }}>See the memory →</span>
            </div>
          </div>
        </Link>
      )}
      {onThisDayMemory && onThisDayTier === 2 && (
        <Link href="/dashboard/memories" className="block rounded-2xl px-4 py-3.5" style={{ background: "#faf8fc", border: "1.5px solid #e4d8ee" }}>
          <span className="inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full mb-2" style={{ background: "#f0eaf5", color: "#9a7ab8" }}>
            A memory from {new Date(onThisDayMemory.date + "T12:00:00").toLocaleString("default", { month: "long" })} last year
          </span>
          <p className="text-sm font-medium text-[#2d2926]">{onThisDayMemory.title}</p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-[#7a6f65]">
              {(() => {
                const child = children.find(c => c.id === onThisDayMemory.child_id);
                const dateLabel = new Date(onThisDayMemory.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return child ? `${child.name} · ${dateLabel}` : dateLabel;
              })()}
            </span>
            <span className="text-xs font-medium" style={{ color: "#9a7ab8" }}>See the memory →</span>
          </div>
        </Link>
      )}
      {!onThisDayMemory && onThisDayTier === 3 && (
        <div className="rounded-2xl px-4 py-3.5" style={{ background: "#fefcf9", border: "1.5px solid #e8e2d9" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#7a6f65" }}>Daily prompt</p>
          <p className="text-sm text-[#5c5248] leading-relaxed">
            {INSPIRATION_PROMPTS[Math.floor((Date.now() / 86400000)) % INSPIRATION_PROMPTS.length]}
          </p>
        </div>
      )}


      {/* ── Did You Know card (school days only) ────────── */}
      {isSchoolDay && !activeVacation && (
        <button
          onClick={() => setFactIndex((factIndex + 1) % DID_YOU_KNOW.length)}
          className="w-full bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 text-left hover:bg-[#faf8f5] transition-colors"
        >
          <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">Did you know?</p>
          <p className="text-[13px] text-[#5c5248] leading-relaxed border-l-2 border-[#3d5c42] pl-3">
            {DID_YOU_KNOW[factIndex]}
          </p>
        </button>
      )}

      <div className="h-4" />

      {/* Floating log button removed — replaced by persistent camera FAB in layout */}

      {/* ── Inline lightbox ──────────────────────────────── */}
      {lightboxMemory && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxMemory(null)}
        >
          <button
            onClick={() => setLightboxMemory(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            aria-label="Close"
          >
            ✕
          </button>

          <div className="flex-1 flex items-center justify-center w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            {lightboxMemory.photo_url ? (
              <img
                src={lightboxMemory.photo_url}
                alt={lightboxMemory.title || "Memory"}
                loading="eager"
                className="max-h-[70vh] w-full object-contain rounded-xl bg-[#1a2e1f]"
              />
            ) : (
              <div className="w-full aspect-square max-w-xs bg-[#1a2e1f] rounded-xl flex items-center justify-center text-7xl">
                📸
              </div>
            )}
          </div>

          <div className="w-full max-w-lg mt-4 text-center" onClick={(e) => e.stopPropagation()}>
            {lightboxMemory.title && (
              <p className="text-white text-base font-semibold mb-1">{lightboxMemory.title}</p>
            )}
            <p className="text-white/60 text-xs">
              {new Date(lightboxMemory.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
            <Link
              href={`/dashboard/memories?open=${lightboxMemory.id}`}
              className="inline-block mt-3 text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              Open in Memories →
            </Link>
          </div>
        </div>
      )}

      {/* ── Capture menu bottom sheet ───────────────────── */}
      {showCaptureMenu && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowCaptureMenu(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="flex items-center justify-between px-5 pb-2">
              <h2 className="font-bold text-[#2d2926] text-sm">Capture a memory</h2>
              <button onClick={() => setShowCaptureMenu(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            <div className="px-4 pb-6 space-y-1">
              <button
                onClick={() => { setShowCaptureMenu(false); captureTypeRef.current = "photo"; captureFileRef.current?.click(); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-[#f0ede8] transition-colors text-left"
              >
                <span className="text-2xl">📸</span>
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Photo</p>
                  <p className="text-xs text-[#7a6f65]">Snap something to remember</p>
                </div>
              </button>
              <button
                onClick={() => { setShowCaptureMenu(false); setShowDrawingSheet(true); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-[#f0ede8] transition-colors text-left"
              >
                <span className="text-2xl">🎨</span>
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Drawing or artwork</p>
                  <p className="text-xs text-[#7a6f65]">Keep one before it gets lost</p>
                </div>
              </button>
              <button
                onClick={() => { setShowCaptureMenu(false); setShowWinSheet(true); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-[#f0ede8] transition-colors text-left"
              >
                <span className="text-2xl">✍️</span>
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Win or moment</p>
                  <p className="text-xs text-[#7a6f65]">Type or speak it out loud</p>
                </div>
              </button>
              <button
                onClick={() => { setShowCaptureMenu(false); setShowBookModal(true); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-[#f0ede8] transition-colors text-left"
              >
                <span className="text-2xl">📖</span>
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Book</p>
                  <p className="text-xs text-[#7a6f65]">Log what they&apos;re reading</p>
                </div>
              </button>
              <button
                onClick={() => { setShowCaptureMenu(false); setShowFieldTripSheet(true); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-[#f0ede8] transition-colors text-left"
              >
                <span className="text-2xl">🌿</span>
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Field trip or project</p>
                  <p className="text-xs text-[#7a6f65]">Document something they did</p>
                </div>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Field trip / project sheet ────────────────────── */}
      {showFieldTripSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => { setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild(""); }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">🌿 Log an Activity</h2>
              <button onClick={() => { setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild(""); }} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What did they do?</label>
              <input value={ftTitle} onChange={(e) => setFtTitle(e.target.value)} placeholder="e.g. Visited the science museum" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Note (optional)</label>
              <input value={ftNote} onChange={(e) => setFtNote(e.target.value)} placeholder="Any details worth remembering"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Type</label>
              <div className="flex gap-2">
                {([["field_trip", "🗺️ Field trip"], ["project", "🔬 Project"], ["activity", "🎵 Activity"]] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setFtType(val)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${ftType === val ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {children.length > 1 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setFtChild("")}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!ftChild ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}>
                    Everyone
                  </button>
                  {children.map((c) => (
                    <button key={c.id} type="button" onClick={() => setFtChild(c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${ftChild === c.id ? "text-white border-transparent" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}
                      style={ftChild === c.id ? { backgroundColor: c.color ?? "#5c7f63" } : {}}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild(""); }}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button
                disabled={ftSaving || !ftTitle.trim()}
                onClick={async () => {
                  setFtSaving(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    const { data: ins } = await supabase.from("memories").insert({
                      user_id: user.id, type: ftType, title: ftTitle.trim(),
                      caption: ftNote.trim() || null, child_id: ftChild || null,
                      date: today, include_in_book: false,
                    }).select("id").single();
                    const toastMap: Record<string, string> = { field_trip: "🗺️ Field trip logged 🌿", project: "🔬 Project logged 🌿", activity: "🎨 Activity logged 🌿" };
                    showCaptureToast(toastMap[ftType] ?? "🌿 Saved!", (ins as { id: string } | null)?.id ?? null);
                    checkAndAwardBadges(user.id);
                  }
                  setFtSaving(false); setShowFieldTripSheet(false);
                  setFtTitle(""); setFtNote(""); setFtChild("");
                  // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
                  loadData(); refreshTodayStory();
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {ftSaving ? "Saving…" : "Save"}
              </button>
            </div>
            </div>
          </div>
        </>
      )}

      {/* ── Book sheet ────────────────────────────────────── */}
      {showBookModal && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowBookModal(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
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
                🍃 This book will add a leaf to {bookChild ? children.find((c) => c.id === bookChild)?.name + "&apos;s" : "the"} garden tree.
              </p>
              <button onClick={saveBook} disabled={savingBook || !bookTitle.trim()}
                className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {savingBook ? "Saving…" : "Log Book 🍃"}
              </button>
            </div>
          </div>
        </>
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

      {/* ── Log a Win Sheet ──────────────────────────────────── */}
      {showWinSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowWinSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#2d2926]">✍️ Log a Win</h2>
                <button onClick={() => setShowWinSheet(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
              </div>

              {/* Type pills */}
              <div className="flex gap-2">
                <button onClick={() => setWinType("win")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "win" ? "bg-[#2d5a3d] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  🏆 Win
                </button>
                <button onClick={() => setWinType("quote")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "quote" ? "bg-[#2d5a3d] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  ✍️ Moment
                </button>
              </div>

              {/* Text input + mic */}
              <div className="relative">
                <textarea
                  value={winText}
                  onChange={(e) => setWinText(e.target.value)}
                  placeholder={winType === "win" ? "What went great today?" : "Something they said or did..."}
                  rows={3}
                  className="w-full px-3 py-2.5 pr-12 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                />
                <button
                  onClick={() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
                    if (!SR) return;
                    if (isListening) return;
                    const recognition = new SR();
                    recognition.lang = "en-US";
                    recognition.interimResults = false;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    recognition.onresult = (e: any) => {
                      const transcript = e.results[0]?.[0]?.transcript ?? "";
                      setWinText((prev: string) => (prev ? prev + " " : "") + transcript);
                    };
                    recognition.onend = () => setIsListening(false);
                    recognition.onerror = () => setIsListening(false);
                    setIsListening(true);
                    recognition.start();
                  }}
                  className={`absolute right-2 top-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isListening ? "bg-red-100 text-red-500" : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"}`}
                  aria-label="Voice input"
                >
                  🎤
                </button>
              </div>

              {/* Child selector */}
              {children.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {children.map(c => (
                    <button key={c.id} onClick={() => setWinChild(winChild === c.id ? "" : c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${winChild === c.id ? "text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}
                      style={winChild === c.id ? { backgroundColor: c.color ?? "#5c7f63" } : undefined}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Save button */}
              <button
                onClick={async () => {
                  if (!winText.trim()) return;
                  setSavingWin(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    const { data: ins } = await supabase.from("memories").insert({
                      user_id: user.id,
                      child_id: winChild || null,
                      date: localDateStr(new Date()),
                      type: winType,
                      title: winText.trim(),
                      include_in_book: true,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    }).select("id").single();
                    setTotalMemories(prev => prev + 1);
                    const msg = winType === "win" ? "🏆 Win captured! 🌿" : "✍️ Moment saved 🌿";
                    showCaptureToast(msg, (ins as { id: string } | null)?.id ?? null);
                    checkAndAwardBadges(user.id);
                  }
                  setSavingWin(false);
                  setWinText("");
                  setWinChild("");
                  setShowWinSheet(false);
                  // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
                  loadData(); refreshTodayStory();
                }}
                disabled={savingWin || !winText.trim()}
                className="w-full py-3 rounded-xl bg-[#2d5a3d] hover:bg-[#1e3d29] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {savingWin ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Log a Drawing Sheet ──────────────────────────── */}
      {showDrawingSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => { setShowDrawingSheet(false); setDrawingFile(null); setDrawingPreview(null); }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#2d2926]">🎨 Log a Drawing</h2>
                <button onClick={() => { setShowDrawingSheet(false); setDrawingFile(null); setDrawingPreview(null); }} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What did they draw? *</label>
                <input value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)} placeholder="e.g. A rainbow butterfly" autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Photo of the drawing (optional)</label>
                <input ref={drawingFileRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setDrawingFile(file);
                    const reader = new FileReader();
                    reader.onload = () => setDrawingPreview(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                />
                {drawingPreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={drawingPreview} alt="Drawing preview" className="w-full h-40 object-cover rounded-xl border border-[#e8e2d9]" />
                    <button onClick={() => { setDrawingFile(null); setDrawingPreview(null); if (drawingFileRef.current) drawingFileRef.current.value = ""; }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center text-sm hover:bg-black/70 transition-colors">
                      ×
                    </button>
                  </div>
                ) : (
                  <button onClick={() => drawingFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-4 rounded-xl border-2 border-dashed border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors">
                    <span className="text-lg">📸</span>
                    <span className="text-sm">Snap a photo of the drawing</span>
                  </button>
                )}
              </div>
              {children.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who made it?</label>
                  <select value={drawingChild} onChange={(e) => setDrawingChild(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                    <option value="">Everyone / unassigned</option>
                    {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <button onClick={saveDrawing} disabled={savingDrawing || !drawingTitle.trim()}
                className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {savingDrawing ? "Saving…" : "Save Drawing 🎨"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Capture toast with Edit shortcut ──────────────── */}
      {captureToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[#2d5a3d] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap flex items-center gap-3">
            <span>{captureToast.message}</span>
            {captureToast.memoryId && (
              <button
                onClick={async () => {
                  const { data } = await supabase.from("memories").select("id, title, caption, child_id, type").eq("id", captureToast.memoryId!).single();
                  if (data) {
                    const m = data as { id: string; title: string | null; caption: string | null; child_id: string | null; type: string };
                    openEditSheet(m.id, m.title ?? "", m.caption ?? "", m.child_id ?? "", m.type);
                  }
                }}
                className="text-white/70 hover:text-white text-xs font-medium transition-colors"
              >
                Edit →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Edit sheet ────────────────────────────────────── */}
      {editSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setEditSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#2d2926]">Edit Memory</h2>
                <button onClick={() => setEditSheet(null)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Title</label>
                <input value={editSheet.title} onChange={(e) => setEditSheet({ ...editSheet, title: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Note</label>
                <input value={editSheet.caption} onChange={(e) => setEditSheet({ ...editSheet, caption: e.target.value })} placeholder="Optional note"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]" />
              </div>
              {children.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => setEditSheet({ ...editSheet, child_id: "" })}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!editSheet.child_id ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}>
                      Everyone
                    </button>
                    {children.map((c) => (
                      <button key={c.id} type="button" onClick={() => setEditSheet({ ...editSheet, child_id: c.id })}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${editSheet.child_id === c.id ? "text-white border-transparent" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}
                        style={editSheet.child_id === c.id ? { backgroundColor: c.color ?? "#5c7f63" } : {}}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={saveEditSheet} disabled={editSaving}
                className="w-full py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {editSaving ? "Saving…" : "Save changes"}
              </button>
              {!editDeleteConfirm ? (
                <button onClick={() => setEditDeleteConfirm(true)}
                  className="w-full text-center text-sm text-red-400 hover:text-red-500 transition-colors py-1">
                  Delete
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-sm text-[#2d2926] text-center">Delete this memory? This can&apos;t be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setEditDeleteConfirm(false)}
                      className="flex-1 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
                    <button onClick={deleteFromEditSheet} disabled={editDeleting}
                      className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                      {editDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
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

      {/* ── Log a Win Sheet (outside content wrapper to avoid fixed positioning issues) */}
      {showWinSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => { setShowWinSheet(false); setWinText(""); setWinChild(""); }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#2d2926]">✍️ Log a Win</h2>
                <button onClick={() => { setShowWinSheet(false); setWinText(""); setWinChild(""); }} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
              </div>

              {/* Type pills */}
              <div className="flex gap-2">
                <button onClick={() => setWinType("win")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "win" ? "bg-[#2d5a3d] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  🏆 Win
                </button>
                <button onClick={() => setWinType("quote")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "quote" ? "bg-[#2d5a3d] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  ✍️ Moment
                </button>
              </div>

              {/* Text input + mic */}
              <div className="relative">
                <textarea
                  value={winText}
                  onChange={(e) => setWinText(e.target.value)}
                  placeholder={winType === "win" ? "What went great today?" : "Something they said or did..."}
                  rows={3}
                  className="w-full px-3 py-2.5 pr-12 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                />
                <button
                  onClick={() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
                    if (!SR) return;
                    if (isListening) return;
                    const recognition = new SR();
                    recognition.lang = "en-US";
                    recognition.interimResults = false;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    recognition.onresult = (e: any) => {
                      const transcript = e.results[0]?.[0]?.transcript ?? "";
                      setWinText((prev: string) => (prev ? prev + " " : "") + transcript);
                    };
                    recognition.onend = () => setIsListening(false);
                    recognition.onerror = () => setIsListening(false);
                    setIsListening(true);
                    recognition.start();
                  }}
                  className={`absolute right-2 top-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isListening ? "bg-red-100 text-red-500" : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"}`}
                  aria-label="Voice input"
                >
                  🎤
                </button>
              </div>

              {/* Child selector */}
              {children.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {children.map(c => (
                    <button key={c.id} onClick={() => setWinChild(winChild === c.id ? "" : c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${winChild === c.id ? "text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}
                      style={winChild === c.id ? { backgroundColor: c.color ?? "#5c7f63" } : undefined}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Save button */}
              <button
                onClick={async () => {
                  if (!winText.trim()) return;
                  setSavingWin(true);
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) { setSavingWin(false); return; }
                    console.log("[Win save] user:", user.id, "winText:", winText.trim(), "winType:", winType, "childId:", winChild);
                    const { data: ins, error } = await supabase.from("memories").insert({
                      user_id: user.id,
                      child_id: winChild || null,
                      date: today,
                      type: winType,
                      title: winText.trim(),
                      include_in_book: false,
                    }).select("id").single();
                    console.log("[Win save] result:", { data: ins, error });
                    if (error) {
                      console.error("[Win save] FAILED:", error.message, error.code, error.details, error.hint);
                      setSavingWin(false);
                      return;
                    }
                    if (!ins) {
                      console.error("[Win save] No data returned — likely RLS policy blocking insert. Check that 'Users can insert own memories' policy exists on memories table.");
                      setSavingWin(false);
                      return;
                    }
                    console.log("[Win save] Success — id:", (ins as { id: string }).id, "type:", winType);
                    setTotalMemories(prev => prev + 1);
                    const msg = winType === "win" ? "🏆 Win captured! 🌿" : "✍️ Moment saved 🌿";
                    showCaptureToast(msg, (ins as { id: string } | null)?.id ?? null);
                    checkAndAwardBadges(user.id);
                    setSavingWin(false);
                    setWinText("");
                    setWinChild("");
                    setShowWinSheet(false);
                    // REGRESSION: must await refreshTodayStory() then await loadData() after every save — do not remove or make fire-and-forget
                    loadData();
                    refreshTodayStory();
                  } catch (err) {
                    console.error("Win save error:", err);
                    setSavingWin(false);
                  }
                }}
                disabled={savingWin || !winText.trim()}
                className="w-full py-3 rounded-xl bg-[#2d5a3d] hover:bg-[#1e3d29] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {savingWin ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
