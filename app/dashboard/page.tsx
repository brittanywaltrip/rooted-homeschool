"use client";

// TODO(cleanup): Delete stale test lessons for admin account:
// DELETE FROM lessons WHERE title ILIKE '%test%' AND user_id = 'd18ca881-a776-4e82-b145-832adc88a88a';

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { checkAndAwardBadges } from "@/lib/badges";
import { onLogAction } from "@/app/lib/onLogAction";
import { compressImage } from "@/lib/compress-image";
import { useDashboardLayout } from "@/lib/dashboard-layout-context";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { useLeafAnimationContext } from "@/app/contexts/LeafAnimationContext";
import ListsSection from "@/app/components/ListsSection";
import AppointmentWizard from "@/app/components/AppointmentWizard";
import ManageScheduleModal from "@/app/components/ManageScheduleModal";
import UnifiedTimeline from "@/app/components/UnifiedTimeline";
import LogSomethingModal from "@/app/components/LogSomethingModal";
// PageHero removed — replaced by Book Cover Card

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

type Lesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string;
  hours: number | null;
  minutes_spent: number | null;
  subjects: { name: string; color: string | null } | null;
  curriculum_goal_id?: string | null;
  lesson_number?: number | null;
  goal_id?: string | null;
  icon_emoji?: string | null;
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

type TodayActivity = {
  id: string;
  name: string;
  emoji: string;
  duration_minutes: number;
  scheduled_start_time: string | null;
  child_ids: string[];
  completed: boolean;
  log_id?: string;
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


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Local-time YYYY-MM-DD — avoids the UTC shift that toISOString causes. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeParseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const iso = d.slice(0, 10);
  const dt = new Date(iso + "T12:00:00");
  return isNaN(dt.getTime()) ? null : dt;
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
    return { bg: "#e8f0e9", text: "var(--g-deep)" };
  if (n.includes("history") || n.includes("social") || n.includes("geography") || n.includes("civics") || n.includes("government"))
    return { bg: "#fef0e4", text: "#7a4a1a" };
  if (n.includes("art") || n.includes("music") || n.includes("drama") || n.includes("theater") || n.includes("craft") || n.includes("draw"))
    return { bg: "#fce8ec", text: "#7a2a36" };
  return { bg: "#f0ede8", text: "#5c5248" };
}

/** Parse "HH:MM:SS" or "HH:MM" time string into total minutes from midnight */
function parseTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/** Format minutes-from-midnight into display time like "9:00" or "1:30" */
function formatTime(totalMinutes: number): string {
  let mins = ((totalMinutes % 1440) + 1440) % 1440; // wrap to 0-1439
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Format duration in minutes to human string like "30 min" or "1 hr" or "1.5 hr" */
function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins % 60 === 0) return `${mins / 60} hr`;
  return `${(mins / 60).toFixed(1)} hr`;
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
  lesson, childObj, onToggle, onEdit, onDelete, onReschedule, onMinutesUpdate, isPartner,
}: {
  lesson:    Lesson;
  childObj:  Child | undefined;
  onToggle:  (id: string, current: boolean) => void;
  onEdit:    (lesson: Lesson) => void;
  onDelete:  (id: string) => void;
  onReschedule: (lesson: Lesson) => void;
  onMinutesUpdate: (id: string, minutes: number) => void;
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
        <div className="flex items-baseline gap-1.5">
          <p className={`text-sm font-medium leading-snug ${
            lesson.completed ? "line-through text-[#9a948e]" : "text-[#2d2926]"
          }`}>
            {lesson.title || (lesson.lesson_number ? `Lesson ${lesson.lesson_number}` : "Untitled")}
          </p>
          {lesson.completed && (() => {
            const mins = lesson.minutes_spent ?? (lesson.hours != null && lesson.hours > 0 ? Math.round(lesson.hours * 60) : null);
            return (
              <button
                type="button"
                data-no-toggle
                onClick={(e) => {
                  e.stopPropagation();
                  const input = e.currentTarget.nextElementSibling as HTMLInputElement | null;
                  if (input) { input.style.display = "inline-block"; input.focus(); e.currentTarget.style.display = "none"; }
                }}
                className="text-[11px] text-[#b5aca4] hover:text-[#5c7f63] transition-colors shrink-0"
              >
                · {mins != null ? `${mins} min` : "add time"}
              </button>
            );
          })()}
          {lesson.completed && (
            <input
              type="number"
              data-no-toggle
              defaultValue={lesson.minutes_spent ?? (lesson.hours != null && lesson.hours > 0 ? Math.round(lesson.hours * 60) : "")}
              placeholder="min"
              min="0"
              max="480"
              style={{ display: "none" }}
              className="w-14 text-[11px] text-[#2d2926] bg-[#f0ede8] border border-[#e8e2d9] rounded-lg px-1.5 py-0.5 text-center focus:outline-none focus:border-[#5c7f63] shrink-0"
              onClick={(e) => e.stopPropagation()}
              onBlur={async (e) => {
                const val = parseInt(e.target.value) || 0;
                e.target.style.display = "none";
                const btn = e.target.previousElementSibling as HTMLElement | null;
                if (btn) btn.style.display = "";
                if (val > 0) {
                  await supabase.from("lessons").update({ minutes_spent: val }).eq("id", lesson.id);
                  onMinutesUpdate(lesson.id, val);
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          )}
        </div>
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
                  onClick={(e) => { e.stopPropagation(); onReschedule(lesson); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors"
                  data-no-toggle
                >
                  ⏭ Reschedule
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

type FamilyNotification = {
  id: string;
  memory_id: string | null;
  type: string;
  actor_name: string;
  emoji: string | null;
  created_at: string;
};

export default function TodayPage() {
  const today = localDateStr(new Date());
  const router = useRouter();
  const previewFree = typeof window !== 'undefined' && window.location.search.includes('previewFree=true');
  const { isPartner, effectiveUserId } = usePartner();
  const { setHideFab } = useDashboardLayout();
  const { earnLeaf } = useLeafAnimationContext();

  // Family activity notifications
  const [familyNotifs, setFamilyNotifs] = useState<FamilyNotification[]>([]);
  const [familyNotifsDismissed, setFamilyNotifsDismissed] = useState(false);

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
  const [bookAuthor,        setBookAuthor]        = useState("");
  const [bookPages,         setBookPages]         = useState("");
  const [bookPhotoFile,     setBookPhotoFile]     = useState<File | null>(null);
  const [bookPhotoPreview,  setBookPhotoPreview]  = useState<string | null>(null);
  const bookPhotoRef = useRef<HTMLInputElement>(null);
  const [savingBook,        setSavingBook]        = useState(false);

  const [isPro,            setIsPro]            = useState(false);
  const [planType,         setPlanType]         = useState<string | null>(null);
  const [yearbookCount,    setYearbookCount]    = useState(0);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => { document.title = "Today \u00b7 Rooted"; posthog.capture('page_viewed', { page: 'today', user_plan: isPro ? 'paid' : 'free' }); }, [isPro]);

  useEffect(() => {
    if (sessionStorage.getItem("setup-banner-dismissed") === "1") setBannerDismissed(true);
  }, []);

  const [nudgeTick,   setNudgeTick]   = useState(false);
  useEffect(() => {
    if (localStorage.getItem("rooted_setup_nudge_dismissed") === "1") setNudgeTick(true);
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
  const [extraLessonLoading,     setExtraLessonLoading]     = useState<string | null>(null); // child ID currently logging

  // Reschedule state
  const [rescheduleLesson,       setRescheduleLesson]       = useState<Lesson | null>(null);
  const [reschedulePicker,       setReschedulePicker]       = useState(false); // show date picker
  const [reschedulePickerDate,   setReschedulePickerDate]   = useState("");
  const [rescheduleUndoToast,    setRescheduleUndoToast]    = useState<{ message: string; undoData: { lessonId: string; date: string }[] } | null>(null);
  const rescheduleUndoTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aheadPromptChildren,    setAheadPromptChildren]    = useState<Set<string>>(new Set());
  const [dismissedAheadPrompts,  setDismissedAheadPrompts]  = useState<Set<string>>(new Set());
  const [activeVacation,         setActiveVacation]         = useState<{ name: string; end_date: string } | null>(null);
  const [isSchoolDay,            setIsSchoolDay]            = useState(true);
  const [schoolDaysArr,          setSchoolDaysArr]          = useState<string[]>([]);
  const [schoolStartTime,        setSchoolStartTime]        = useState<string | null>(null);
  // memoryMoment removed — replaced by onThisDayMemory and lastMemory
  const [lightboxMemory, setLightboxMemory] = useState<{ id: string; title: string; photo_url: string | null; date: string; type: string } | null>(null);
  const [streak,                 setStreak]                 = useState(0);
  const [weekDots,               setWeekDots]               = useState<("done" | "partial" | "off" | "future")[]>([]);
  const [showFamilyUpdate,       setShowFamilyUpdate]       = useState(false);
  const [daysLearning,           setDaysLearning]           = useState<number | null>(null);
  const [familyPhotoUrl,         setFamilyPhotoUrl]         = useState<string | null>(null);
  const [allVacationBlocks,      setAllVacationBlocks]      = useState<{ name: string; start_date: string; end_date: string }[]>([]);
  const [totalMemories, setTotalMemories] = useState(0);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [achievementBanner, setAchievementBanner] = useState<{ label: string; childName?: string; isEducator: boolean; extra: number } | null>(null);
  const [activeDaysThisMonth, setActiveDaysThisMonth] = useState(0);
  const [lastMemory, setLastMemory] = useState<{ id: string; type: string; title: string | null; date: string; child_id: string | null; photo_url: string | null } | null>(null);
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
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);
  const [showFieldTripSheet, setShowFieldTripSheet] = useState(false);
  const [showExtraLessons, setShowExtraLessons] = useState(false);
  type UpcomingLesson = { id: string; title: string; child_id: string; scheduled_date: string; curriculum_goal_id: string | null; subjects: { name: string; color: string | null } | null };
  const [upcomingLessons, setUpcomingLessons] = useState<UpcomingLesson[]>([]);
  const [extraChecked, setExtraChecked] = useState<Set<string>>(new Set());
  const [savingExtra, setSavingExtra] = useState(false);
  const [ftTitle, setFtTitle] = useState("");
  const [ftNote, setFtNote] = useState("");
  const [ftChild, setFtChild] = useState("");
  const [ftType, setFtType] = useState<"field_trip" | "project">("field_trip");
  const [ftSaving, setFtSaving] = useState(false);
  const captureFileRef = useRef<HTMLInputElement>(null);
  const captureTypeRef = useRef<"photo" | "drawing">("photo");
  const loadDataBusy = useRef(false);
  const [todayStory, setTodayStory] = useState<{ id: string; type: string; title: string | null; caption: string | null; child_id: string | null; photo_url: string | null; include_in_book: boolean; created_at: string }[]>([]);
  const [captureToast, setCaptureToast] = useState<{ message: string; memoryId: string | null } | null>(null);
  const [firstMemoryToast, setFirstMemoryToast] = useState<string | null>(null);
  const prevTotalMemoriesRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);
  const [editSheet, setEditSheet] = useState<{ id: string; title: string; caption: string; child_id: string; type: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editDeleting, setEditDeleting] = useState(false);
  const [editDeleteConfirm, setEditDeleteConfirm] = useState(false);
  const [winText, setWinText] = useState("");
  const [winType, setWinType] = useState<"win" | "quote">("win");
  const [winChild, setWinChild] = useState("");
  const [savingWin, setSavingWin] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [winMinutes, setWinMinutes] = useState("");
  const [ftMinutes, setFtMinutes] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState<(() => void) | null>(null);
  const [timePill, setTimePill] = useState<{ lessonId: string; minutes: number } | null>(null);
  const [timePillEdit, setTimePillEdit] = useState(false);
  const [timePillValue, setTimePillValue] = useState("");
  const timePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lists state
  type ListRow = { id: string; name: string; emoji: string; sort_order: number; archived: boolean; created_at: string };
  const [lists, setLists] = useState<ListRow[]>([]);

  // Appointments state
  type ApptRow = { id: string; title: string; emoji: string; date: string; time: string | null; duration_minutes: number; location: string | null; child_ids: string[]; completed: boolean; instance_date: string };
  const [todayAppointments, setTodayAppointments] = useState<ApptRow[]>([]);
  const [showApptWizard, setShowApptWizard] = useState(false);
  const [showManageSchedule, setShowManageSchedule] = useState(false);
  const [allDoneCelebration, setAllDoneCelebration] = useState(false);

  // Activities state
  const [todayActivities, setTodayActivities] = useState<TodayActivity[]>([]);
  const [showRunningLate, setShowRunningLate] = useState(false);
  const [shiftMinutes, setShiftMinutes] = useState(30);
  const [isCustomShift, setIsCustomShift] = useState(false);
  const [customShiftValue, setCustomShiftValue] = useState("");
  const [timeShiftOffset, setTimeShiftOffset] = useState(0); // local-only visual shift in minutes

  // Lesson check-off modal state
  const [checkOffLesson, setCheckOffLesson] = useState<{ lesson: Lesson; defaultMinutes: number } | null>(null);
  const [checkOffMinutes, setCheckOffMinutes] = useState(30);
  const [checkOffCustom, setCheckOffCustom] = useState("");
  const [checkOffShowCustom, setCheckOffShowCustom] = useState(false);
  const [checkOffVisible, setCheckOffVisible] = useState(false);
  const [upcomingDay,            setUpcomingDay]            = useState<{
    date: string;
    lessons: { title: string; childId: string | null; subjectName: string | null }[];
  } | null>(null);
  const [upcomingDays,           setUpcomingDays]           = useState<{ date: string; count: number }[]>([]);

  // ── Open capture menu from URL param (used by other pages) ─────────────────
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("capture=1")) {
      setShowMemoryPicker(true);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("capture");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  // ── Hide FAB when new-user empty state is showing ─────────────────────────
  useEffect(() => {
    setHideFab(!loading && totalMemories === 0);
    return () => setHideFab(false);
  }, [loading, totalMemories, setHideFab]);

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

  const loadTodayActivities = useCallback(async () => {
    if (!effectiveUserId) return;
    const todayDow = new Date().getDay(); // 0=Sun..6=Sat
    const { data: actData } = await supabase
      .from("activities")
      .select("id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids, created_at")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true);
    if (!actData || actData.length === 0) { setTodayActivities([]); return; }

    const now = new Date();
    const filtered = (actData as { id: string; name: string; emoji: string; frequency: string; days: number[]; duration_minutes: number; scheduled_start_time: string | null; child_ids: string[]; created_at: string }[]).filter((a) => {
      if (!a.days || !a.days.includes(todayDow)) return false;
      if (a.frequency === "weekly") return true;
      if (a.frequency === "biweekly") {
        const anchor = new Date(a.created_at);
        const diffWeeks = Math.floor((now.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
        return diffWeeks % 2 === 0;
      }
      if (a.frequency === "monthly") {
        // Show only on first occurrence of matching day this month
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        let cursor = new Date(firstDay);
        while (cursor.getMonth() === now.getMonth()) {
          if (cursor.getDay() === todayDow) {
            return cursor.getDate() === now.getDate();
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        return false;
      }
      return false;
    });

    // Check which activities have been logged today
    const actIds = filtered.map((a) => a.id);
    const { data: logData } = actIds.length > 0
      ? await supabase
          .from("activity_logs")
          .select("id, activity_id, completed")
          .eq("user_id", effectiveUserId)
          .eq("date", today)
          .in("activity_id", actIds)
      : { data: [] };
    const logMap = new Map((logData ?? []).map((l: { id: string; activity_id: string; completed: boolean }) => [l.activity_id, { log_id: l.id, completed: l.completed }]));

    setTodayActivities(filtered.map((a) => ({
      id: a.id,
      name: a.name,
      emoji: a.emoji ?? "📝",
      duration_minutes: a.duration_minutes ?? 60,
      scheduled_start_time: a.scheduled_start_time,
      child_ids: a.child_ids ?? [],
      completed: logMap.get(a.id)?.completed ?? false,
      log_id: logMap.get(a.id)?.log_id,
    })));
  }, [effectiveUserId, today]);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    if (loadDataBusy.current) return;
    loadDataBusy.current = true;
    try {

    // ── Phase 1: Fire all independent queries in parallel ────────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const twoWeeks = new Date(); twoWeeks.setDate(twoWeeks.getDate() + 14);
    const nowForSY = new Date();
    const schoolYearStartMonth = 7;
    const syYear = nowForSY.getMonth() >= schoolYearStartMonth ? nowForSY.getFullYear() : nowForSY.getFullYear() - 1;
    const syStart = `${syYear}-08-01`;
    const monthStartStr = `${nowForSY.getFullYear()}-${String(nowForSY.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEndStr = localDateStr(nowForSY);
    const otdNow = new Date();
    const lastYear = otdNow.getFullYear() - 1;
    const otdStart = new Date(lastYear, otdNow.getMonth(), otdNow.getDate() - 3);
    const otdEnd = new Date(lastYear, otdNow.getMonth(), otdNow.getDate() + 3);
    const prevMonth = nowForSY.getMonth() === 0 ? 11 : nowForSY.getMonth() - 1;
    const prevMonthYear = nowForSY.getMonth() === 0 ? nowForSY.getFullYear() - 1 : nowForSY.getFullYear();
    const prevStart = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, "0")}-01`;
    const prevEnd = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, "0")}-31`;

    const [
      profileResult,
      authResult,
      childrenResult,
      todayLessonsResult,
      allLessonsResult,
      recentLessonsResult,
      completedResult,
      bookEventsResult,
      memEventsResult,
      todayBooksResult,
      todayMemEventsResult,
      subjectsResult,
      vacBlocksResult,
      upcomingResult,
      memCountResult,
      photoCountResult,
      ybCountResult,
      monthLessonsResult,
      monthMemoriesResult,
      lastMemResult,
      tier1Result,
      todayStoryResult,
      prevMonthResult,
      goalEmojiResult,
    ] = await Promise.all([
      supabase.from("profiles").select("display_name, onboarded, school_days, school_year_start, family_photo_url, school_start_time, is_pro, plan_type").eq("id", effectiveUserId).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("children").select("id, name, color, birthday").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, subjects(name, color), curriculum_goal_id, lesson_number, goal_id").eq("user_id", effectiveUserId).or(`date.eq.${today},scheduled_date.eq.${today}`),
      supabase.from("lessons").select("id").eq("user_id", effectiveUserId),
      supabase.from("lessons").select("date, scheduled_date, completed").eq("user_id", effectiveUserId).gte("scheduled_date", localDateStr(thirtyDaysAgo)),
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
      supabase.from("app_events").select("id, payload").eq("user_id", effectiveUserId).eq("type", "book_read").filter("payload->>date", "eq", today),
      supabase.from("app_events").select("id, type, payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_photo"]).filter("payload->>date", "eq", today),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("vacation_blocks").select("name, end_date, start_date").eq("user_id", effectiveUserId),
      supabase.from("lessons").select("title, scheduled_date, child_id, subjects(name)").eq("user_id", effectiveUserId).eq("completed", false).gte("scheduled_date", localDateStr(tomorrow)).lte("scheduled_date", localDateStr(twoWeeks)).order("scheduled_date"),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).gte("date", syStart),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).in("type", ["photo", "drawing"]),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).eq("include_in_book", true).gte("date", syStart),
      supabase.from("lessons").select("date, scheduled_date").eq("user_id", effectiveUserId).eq("completed", true).gte("scheduled_date", monthStartStr).lte("scheduled_date", monthEndStr),
      supabase.from("memories").select("date").eq("user_id", effectiveUserId).gte("date", monthStartStr).lte("date", monthEndStr),
      supabase.from("memories").select("id, type, title, date, child_id, photo_url").eq("user_id", effectiveUserId).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("memories").select("id, title, date, child_id, photo_url").eq("user_id", effectiveUserId).gte("date", localDateStr(otdStart)).lte("date", localDateStr(otdEnd)).order("date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("memories").select("id, type, title, caption, child_id, photo_url, include_in_book, created_at").eq("user_id", effectiveUserId).eq("date", today).order("created_at", { ascending: false }),
      nowForSY.getDate() <= 15
        ? supabase.from("lessons").select("id").eq("user_id", effectiveUserId).eq("completed", true).gte("date", prevStart).lte("date", prevEnd)
        : Promise.resolve({ data: null }),
      supabase.from("curriculum_goals").select("id, icon_emoji").eq("user_id", effectiveUserId),
    ]);

    // ── Phase 2: Process all results (no awaits) ────────────────────────

    // Profile
    const profile = profileResult.data;
    const authUser = authResult.data?.user;
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setFirstName(authUser?.user_metadata?.first_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);
    setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
    const pt = (profile as { plan_type?: string } | null)?.plan_type ?? null;
    setPlanType(pt);
    const isFreeUser = !pt || pt === "free";
    const showTeaser = isFreeUser || previewFree;
    console.log('[YearbookTeaser] plan_type:', pt, 'showing teaser:', showTeaser, 'previewFree:', previewFree);
    setFamilyPhotoUrl((profile as { family_photo_url?: string } | null)?.family_photo_url ?? null);

    // School days
    const schoolDays: string[] = (profile as { school_days?: string[] } | null)?.school_days ?? [];
    setSchoolDaysArr(schoolDays);
    setSchoolStartTime((profile as { school_start_time?: string } | null)?.school_start_time ?? null);
    if (schoolDays.length > 0) {
      const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      setIsSchoolDay(schoolDays.includes(todayDayName));
    }

    // Milestone
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

    // Streak + week dots
    const recentLessons = recentLessonsResult.data;
    const lessonsByDate = new Map<string, { total: number; done: number }>();
    for (const l of recentLessons ?? []) {
      const d = l.date ?? l.scheduled_date ?? "";
      if (!d) continue;
      const entry = lessonsByDate.get(d) ?? { total: 0, done: 0 };
      entry.total++;
      if (l.completed) entry.done++;
      lessonsByDate.set(d, entry);
    }

    let currentStreak = 0;
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 60; i++) {
      const dateStr = localDateStr(cursor);
      const dayName = cursor.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (schoolDays.length > 0 && !schoolDays.includes(dayName)) {
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      const entry = lessonsByDate.get(dateStr);
      if (entry && entry.done > 0) {
        currentStreak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    const todayEntry = lessonsByDate.get(today);
    if (todayEntry && todayEntry.done > 0) currentStreak++;
    setStreak(currentStreak);

    // Week dots
    const nowDate = new Date();
    const currentDow = nowDate.getDay();
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

    // Family update prompt
    const now = new Date();
    if (now.getDate() <= 15) {
      const monthKey = `family_update_seen_${prevMonthYear}_${prevMonth}`;
      const alreadySeen = localStorage.getItem(monthKey) === "1";
      if (!alreadySeen && (prevMonthResult.data?.length ?? 0) > 0) {
        setShowFamilyUpdate(true);
      }
    }

    // Children
    const childrenData = childrenResult.data;
    setChildren(capitalizeChildNames(childrenData ?? []));

    // Today's lessons — enrich with curriculum emoji
    const lessonsData = todayLessonsResult.data;
    const emojiMap = new Map<string, string>();
    for (const g of (goalEmojiResult.data ?? []) as { id: string; icon_emoji: string | null }[]) {
      if (g.icon_emoji) emojiMap.set(g.id, g.icon_emoji);
    }
    const loadedLessons = ((lessonsData as unknown as Lesson[]) ?? []).map(l => ({
      ...l,
      icon_emoji: l.curriculum_goal_id ? (emojiMap.get(l.curriculum_goal_id) ?? "📚") : null,
    }));
    setLessons(loadedLessons);
    setHasAnyLessons((allLessonsResult.data?.length ?? 0) > 0);
    setAllDoneBanner(loadedLessons.length > 0 && loadedLessons.every((l: Lesson) => l.completed));

    // Auto-select first incomplete child
    const kids = childrenData ?? [];
    const kidsWithLessons = kids.filter((c: Child) => loadedLessons.some(l => l.child_id === c.id));
    if (kidsWithLessons.length > 0) {
      const firstIncomplete = kidsWithLessons.find((c: Child) => !loadedLessons.filter(l => l.child_id === c.id).every(l => l.completed));
      setSelectedChild((firstIncomplete ?? kidsWithLessons[0]).id);
    }

    // Leaf counts
    const completed = completedResult.data;
    const bookEvents = bookEventsResult.data;
    const memEvents = memEventsResult.data;
    const counts: Record<string, number> = {};
    completed?.forEach((l) => { if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
    bookEvents?.forEach((e) => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    memEvents?.forEach((e)  => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
    setLeafCounts(counts);

    // Today books + memory events
    setTodayBooks((todayBooksResult.data as unknown as BookLog[]) ?? []);
    setTodayMemoryEvents((todayMemEventsResult.data as unknown as TodayEvent[]) ?? []);

    // Subjects
    setSubjects((subjectsResult.data as Subject[]) ?? []);

    // Vacation blocks
    const vacBlocks = vacBlocksResult.data;
    const currentVac = (vacBlocks ?? []).find(
      (b: { start_date: string; end_date: string; name: string }) => today >= b.start_date && today <= b.end_date
    );
    setActiveVacation(currentVac ? { name: currentVac.name, end_date: currentVac.end_date } : null);
    setAllVacationBlocks((vacBlocks ?? []) as { name: string; start_date: string; end_date: string }[]);

    // Upcoming lessons
    type UpRow = { title: string; scheduled_date: string | null; child_id: string | null; subjects: { name: string } | null };
    const upcomingData = upcomingResult.data;
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
      const dayMap = new Map<string, number>();
      for (const r of rows) {
        const d = r.scheduled_date ?? "";
        if (d) dayMap.set(d, (dayMap.get(d) ?? 0) + 1);
      }
      setUpcomingDays(Array.from(dayMap.entries()).slice(0, 2).map(([date, count]) => ({ date, count })));
    } else {
      setUpcomingDay(null);
      setUpcomingDays([]);
    }

    // Memory counts
    setTotalMemories(memCountResult.data?.length ?? 0);
    setTotalPhotos(photoCountResult.data?.length ?? 0);
    setYearbookCount(ybCountResult.data?.length ?? 0);

    // Active days this month
    const activeDates = new Set<string>();
    (monthLessonsResult.data ?? []).forEach((l: { date?: string; scheduled_date?: string }) => {
      const d = l.date ?? l.scheduled_date;
      if (d) activeDates.add(d);
    });
    (monthMemoriesResult.data ?? []).forEach((m: { date: string }) => { if (m.date) activeDates.add(m.date); });
    setActiveDaysThisMonth(activeDates.size);

    // Last captured memory
    setLastMemory(lastMemResult.data as typeof lastMemory);

    // ── Phase 3: On This Day (one conditional query) ────────────────────
    if (tier1Result.data) {
      setOnThisDayMemory(tier1Result.data as typeof onThisDayMemory);
      setOnThisDayTier(1);
      checkAndAwardBadges(effectiveUserId);
    } else {
      const tier2Start = new Date(lastYear, otdNow.getMonth(), 1);
      const tier2End = new Date(lastYear, otdNow.getMonth() + 1, 0);
      const { data: tier2Data } = await supabase.from("memories")
        .select("id, title, date, child_id, photo_url")
        .eq("user_id", effectiveUserId)
        .gte("date", localDateStr(tier2Start)).lte("date", localDateStr(tier2End))
        .order("date", { ascending: false }).limit(1).maybeSingle();
      if (tier2Data) {
        setOnThisDayMemory(tier2Data as typeof onThisDayMemory);
        setOnThisDayTier(2);
      } else {
        setOnThisDayMemory(null);
        setOnThisDayTier(3);
      }
    }

    // Today's story
    setTodayStory((todayStoryResult.data ?? []) as typeof todayStory);

    // Lists + Appointments — fetch via API routes
    try {
      const { data: { session: apiSession } } = await supabase.auth.getSession();
      if (apiSession?.access_token) {
        const [listsRes, apptsRes] = await Promise.all([
          fetch("/api/lists", { headers: { Authorization: `Bearer ${apiSession.access_token}` } }),
          fetch(`/api/appointments?date=${today}`, { headers: { Authorization: `Bearer ${apiSession.access_token}` } }),
        ]);
        if (listsRes.ok) setLists(await listsRes.json());
        if (apptsRes.ok) setTodayAppointments(await apptsRes.json());
      }
    } catch { /* non-critical — will load on next poll */ }

    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
      loadDataBusy.current = false;
    }
  }, [today, effectiveUserId]);

  useEffect(() => { loadData(); loadTodayActivities(); }, [loadData, loadTodayActivities]);

  // PostHog identify
  useEffect(() => {
    if (!effectiveUserId || loading) return;
    posthog.identify(effectiveUserId, {
      plan: isPro ? 'pro' : 'free',
      is_pro: isPro,
    });
  }, [effectiveUserId, loading, isPro]);

  // Check for new achievement awards
  useEffect(() => {
    if (!effectiveUserId || loading) return;
    (async () => {
      try {
        const { checkAndGrantAwards } = await import("@/lib/award-unlocks");
        const { AWARD_META } = await import("@/lib/certificate-templates");
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [{ data: lessons }, { data: memories }, { data: prof }] = await Promise.all([
          supabase.from("lessons").select("child_id, date, scheduled_date").eq("user_id", effectiveUserId).eq("completed", true),
          supabase.from("memories").select("id, type, child_id, title, date").eq("user_id", effectiveUserId),
          supabase.from("profiles").select("display_name").eq("id", effectiveUserId).maybeSingle(),
        ]);
        const allDates = new Set<string>();
        for (const l of (lessons || []) as { date?: string }[]) { if (l.date) allDates.add(l.date); }
        const displayName = (prof as { display_name?: string } | null)?.display_name || "";
        const academy = displayName ? `${displayName} Academy` : "Family Academy";

        const appData = {
          children: children.map(c => ({ id: c.id, name: c.name })),
          completedLessons: (lessons || []) as { child_id: string; date: string; scheduled_date?: string }[],
          memories: (memories || []) as { id: string; type: string; child_id: string | null; title: string | null; date: string }[],
          totalSchoolDays: allDates.size,
          profile: { display_name: displayName, created_at: user.created_at },
          academyName: academy,
        };

        const newAwards = await checkAndGrantAwards(effectiveUserId, appData);

        // Suppress banner for brand-new users (< 5 min since account creation)
        // Awards still get granted silently — just don't flash the banner on first visit
        const accountAge = Date.now() - new Date(user.created_at).getTime();
        const FIVE_MINUTES = 5 * 60 * 1000;

        if (newAwards.length > 0 && accountAge > FIVE_MINUTES) {
          const first = newAwards[0];
          const meta = AWARD_META[first.award_type as keyof typeof AWARD_META];
          setAchievementBanner({
            label: meta?.label || first.award_type,
            childName: first.certificate_data?.childName,
            isEducator: first.isEducator,
            extra: newAwards.length - 1,
          });
          setTimeout(() => setAchievementBanner(null), 8000);
        }
      } catch (e) { console.error("[Achievement check]", e); }
    })();
  }, [effectiveUserId, loading, children]);

  // Load unread family notifications
  useEffect(() => {
    if (!effectiveUserId || isPartner) return;
    (async () => {
      const { data } = await supabase
        .from("family_notifications")
        .select("id, memory_id, type, actor_name, emoji, created_at")
        .eq("user_id", effectiveUserId)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(3);
      setFamilyNotifs(data ?? []);
    })();
  }, [effectiveUserId, isPartner]);

  async function dismissFamilyNotifs() {
    setFamilyNotifsDismissed(true);
    const ids = familyNotifs.map((n) => n.id);
    if (ids.length > 0) {
      await supabase
        .from("family_notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
    }
  }

  // Poll for new memories (e.g. FAB photo saved from layout)
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 15000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when children are edited in Settings
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener("rooted:children-updated", handler);
    return () => window.removeEventListener("rooted:children-updated", handler);
  }, [loadData]);

  // ── First memory magic moment ──────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    const prev = prevTotalMemoriesRef.current;
    prevTotalMemoriesRef.current = totalMemories;
    if (prev === 0 && totalMemories === 1 && !localStorage.getItem("rooted_first_memory_celebrated")) {
      localStorage.setItem("rooted_first_memory_celebrated", "1");
      const childName = children.length > 0 ? children[0].name : null;
      setFirstMemoryToast(
        childName ? `${childName}'s tree just grew its first leaf!` : "Your garden just grew its first leaf!"
      );
      setTimeout(() => setFirstMemoryToast(null), 4000);
    }
  }, [totalMemories, loading, children]);

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

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

  // ── Activity actions ──────────────────────────────────────────────────────

  async function toggleActivity(activity: TodayActivity) {
    const newCompleted = !activity.completed;
    // Optimistic update
    setTodayActivities(prev => prev.map(a => a.id === activity.id ? { ...a, completed: newCompleted } : a));

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (newCompleted) {
      if (activity.log_id) {
        await supabase.from("activity_logs").update({ completed: true, completed_at: new Date().toISOString() }).eq("id", activity.log_id);
      } else {
        const { data: logRow } = await supabase.from("activity_logs").insert({
          activity_id: activity.id,
          user_id: user.id,
          date: today,
          minutes_spent: activity.duration_minutes,
          completed: true,
          completed_at: new Date().toISOString(),
        }).select("id").single();
        if (logRow) {
          setTodayActivities(prev => prev.map(a => a.id === activity.id ? { ...a, log_id: (logRow as { id: string }).id } : a));
        }
      }
      earnLeaf();
      // Fire streak + badge check for activity completion
      const firstChildId = activity.child_ids?.[0];
      onLogAction({ userId: user.id, childId: firstChildId ?? undefined, actionType: "activity" });
    } else {
      if (activity.log_id) {
        await supabase.from("activity_logs").update({ completed: false, completed_at: null }).eq("id", activity.log_id);
      }
    }
  }

  async function skipRestOfToday() {
    // Push uncompleted lessons to next school day
    const uncompleted = lessons.filter(l => !l.completed);
    if (uncompleted.length === 0) return;

    const goalIds = [...new Set(uncompleted.map(l => l.curriculum_goal_id).filter(Boolean))] as string[];
    const goalSchoolDays = new Map<string, Set<number>>();
    if (goalIds.length > 0) {
      const { data: goals } = await supabase.from("curriculum_goals")
        .select("id, school_days").in("id", goalIds);
      const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      for (const g of (goals ?? [])) {
        const days = (g as { school_days?: string[] }).school_days ?? [];
        goalSchoolDays.set(g.id, days.length > 0 ? new Set(days.map((d: string) => dayMap[d] ?? -1)) : new Set([0, 1, 2, 3, 4]));
      }
    }
    const defaultDays = new Set([0, 1, 2, 3, 4]);

    const undoData: { lessonId: string; date: string }[] = [];
    for (const lesson of uncompleted) {
      const activeDays = (lesson.curriculum_goal_id && goalSchoolDays.has(lesson.curriculum_goal_id))
        ? goalSchoolDays.get(lesson.curriculum_goal_id)!
        : defaultDays;
      const cur = new Date(today + "T12:00:00");
      let safety = 0;
      while (safety < 365) {
        cur.setDate(cur.getDate() + 1);
        const dayIdx = (cur.getDay() + 6) % 7;
        if (activeDays.has(dayIdx)) {
          const newDate = localDateStr(cur);
          await supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", lesson.id);
          undoData.push({ lessonId: lesson.id, date: today });
          break;
        }
        safety++;
      }
    }
    setLessons(prev => prev.filter(l => l.completed));
    showRescheduleUndo(`${uncompleted.length} lesson${uncompleted.length !== 1 ? "s" : ""} moved to next school day! Undo?`, undoData);
  }

  // ── Lesson actions ────────────────────────────────────────────────────────

  function triggerGardenAnimation(childId?: string) {
    const child = children.find((c) => c.id === childId);
    const newLeaves = (leafCounts[childId ?? ""] ?? 0) + 1;
    setGardenToast({ name: child?.name ?? "Your garden", leaves: newLeaves });
    setTimeout(() => setGardenToast(null), 2500);
  }

  // Open time confirmation modal before completing a lesson
  async function openCheckOffModal(id: string, current: boolean) {
    // If unchecking (undoing), skip modal and toggle directly
    if (current) {
      toggleLesson(id, current);
      return;
    }
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) return;
    let defaultMins = 30;
    if (lesson.curriculum_goal_id) {
      const { data: goalRow } = await supabase
        .from("curriculum_goals")
        .select("default_minutes")
        .eq("id", lesson.curriculum_goal_id)
        .single();
      defaultMins = (goalRow as { default_minutes?: number } | null)?.default_minutes ?? 30;
    }
    const pills = [15, 30, 45, 60];
    const matchesPill = pills.includes(defaultMins);
    setCheckOffMinutes(defaultMins);
    setCheckOffCustom(matchesPill ? "" : String(defaultMins));
    setCheckOffShowCustom(!matchesPill);
    setCheckOffLesson({ lesson, defaultMinutes: defaultMins });
    // Animate in
    requestAnimationFrame(() => setCheckOffVisible(true));
  }

  async function confirmCheckOff(minutes: number) {
    if (!checkOffLesson) return;
    const { lesson } = checkOffLesson;
    // Close modal
    setCheckOffVisible(false);
    setTimeout(() => setCheckOffLesson(null), 300);
    // Save minutes_spent and hours alongside completion
    await supabase.from("lessons").update({
      completed: true,
      minutes_spent: minutes,
      hours: minutes / 60.0,
    }).eq("id", lesson.id);
    // Update local state
    setLessons(prev => prev.map(l => l.id === lesson.id ? { ...l, completed: true, minutes_spent: minutes, hours: minutes / 60.0 } : l));
    // Run all the post-completion effects (celebrations, toasts, goal advancement)
    posthog.capture('lesson_completed');
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 1600);
    triggerGardenAnimation(lesson.child_id ?? undefined);
    earnLeaf();

    // Child done toast
    const updatedLessons = lessons.map(l => l.id === lesson.id ? { ...l, completed: true } : l);
    if (lesson.child_id) {
      const childLessons = updatedLessons.filter(l => l.child_id === lesson.child_id);
      const childAllDone = childLessons.length > 0 && childLessons.every(l => l.completed);
      if (childAllDone) {
        const childName = children.find(c => c.id === lesson.child_id)?.name;
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

    // All done banner
    if (updatedLessons.length > 0 && updatedLessons.every(l => l.completed)) {
      setTimeout(() => setAllDoneBanner(true), 800);
    }

    // Advance curriculum goal
    if (lesson.curriculum_goal_id && lesson.lesson_number) {
      const { data: goalRow } = await supabase
        .from("curriculum_goals")
        .select("current_lesson, total_lessons, curriculum_name, child_id")
        .eq("id", lesson.curriculum_goal_id)
        .single();
      if (goalRow && goalRow.current_lesson < goalRow.total_lessons) {
        const newLessonNum = goalRow.current_lesson + 1;
        await supabase.from("curriculum_goals").update({ current_lesson: newLessonNum }).eq("id", lesson.curriculum_goal_id);
      }
    }

    checkAndAwardBadges(effectiveUserId);
    onLogAction({ userId: effectiveUserId, childId: lesson.child_id ?? undefined, actionType: "lesson" });
  }

  function closeCheckOffModal() {
    setCheckOffVisible(false);
    setTimeout(() => setCheckOffLesson(null), 300);
  }

  async function toggleLesson(id: string, current: boolean) {
    const lesson = lessons.find((l) => l.id === id);
    const updatedLessons = lessons.map(l => l.id === id ? { ...l, completed: !current } : l);
    setLessons(updatedLessons);
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);

    // Save minutes_spent when completing a lesson
    if (!current && lesson?.curriculum_goal_id) {
      const { data: goalRow } = await supabase
        .from("curriculum_goals")
        .select("default_minutes")
        .eq("id", lesson.curriculum_goal_id)
        .single();
      const mins = (goalRow as { default_minutes?: number } | null)?.default_minutes ?? 30;
      await supabase.from("lessons").update({ minutes_spent: mins }).eq("id", id);
      // Show dismissible time pill
      if (timePillTimer.current) clearTimeout(timePillTimer.current);
      setTimePill({ lessonId: id, minutes: mins });
      setTimePillEdit(false);
      setTimePillValue(String(mins));
      timePillTimer.current = setTimeout(() => setTimePill(null), 3000);
    }

    if (!current) {
      posthog.capture('lesson_completed');
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1600);
      triggerGardenAnimation(lesson?.child_id ?? undefined);
      earnLeaf();

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

    // Check for new activity badges + streaks + creative badges (fire-and-forget)
    if (!current) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        checkAndAwardBadges(user.id);
        onLogAction({ userId: user.id, childId: lesson?.child_id ?? undefined, actionType: "lesson" });
      }
    }
  }

  // ── Extra lessons (log ahead) ──────────────────────────────────────────────

  async function openExtraLessons() {
    if (!effectiveUserId) return;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const futureStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;
    const { data } = await supabase
      .from("lessons")
      .select("id, title, child_id, scheduled_date, curriculum_goal_id, subjects(name, color)")
      .eq("user_id", effectiveUserId)
      .eq("completed", false)
      .gt("scheduled_date", today)
      .lte("scheduled_date", futureStr)
      .order("scheduled_date");
    setUpcomingLessons((data as unknown as UpcomingLesson[]) ?? []);
    setExtraChecked(new Set());
    setShowExtraLessons(true);
    posthog.capture('log_extra_lessons_opened', { user_plan: isPro ? 'paid' : 'free' });
  }

  async function confirmExtraLessons() {
    if (extraChecked.size === 0) return;
    setSavingExtra(true);

    for (const lessonId of extraChecked) {
      const lesson = upcomingLessons.find(l => l.id === lessonId);
      if (!lesson) continue;

      // Get default minutes from curriculum goal
      let mins = 30;
      if (lesson.curriculum_goal_id) {
        const { data: goalRow } = await supabase
          .from("curriculum_goals")
          .select("default_minutes, school_days")
          .eq("id", lesson.curriculum_goal_id)
          .single();
        if (goalRow) mins = (goalRow as { default_minutes?: number }).default_minutes ?? 30;

        // Complete the lesson with today's date
        await supabase.from("lessons").update({
          completed: true,
          date: today,
          minutes_spent: mins,
        }).eq("id", lessonId);

        // Shift subsequent incomplete lessons back
        const schoolDaysArr = (goalRow as { school_days?: string[] })?.school_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const schoolDayNums = new Set(schoolDaysArr.map(d => dayMap[d]));

        const { data: remaining } = await supabase
          .from("lessons")
          .select("id, scheduled_date")
          .eq("curriculum_goal_id", lesson.curriculum_goal_id)
          .eq("completed", false)
          .gt("scheduled_date", today)
          .order("scheduled_date");

        if (remaining && remaining.length > 0) {
          // Calculate how many school days early this was done
          const scheduledDate = new Date(lesson.scheduled_date + "T12:00:00");
          const todayDate = new Date(today + "T12:00:00");
          let daysEarly = 0;
          const countCursor = new Date(todayDate);
          while (countCursor < scheduledDate) {
            countCursor.setDate(countCursor.getDate() + 1);
            if (schoolDayNums.has(countCursor.getDay())) daysEarly++;
          }

          if (daysEarly > 0) {
            for (const r of remaining as { id: string; scheduled_date: string }[]) {
              const orig = new Date(r.scheduled_date + "T12:00:00");
              let shifted = new Date(orig);
              let toShift = daysEarly;
              while (toShift > 0) {
                shifted.setDate(shifted.getDate() - 1);
                if (schoolDayNums.has(shifted.getDay())) toShift--;
              }
              const newDate = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
              await supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", r.id);
            }
          }
        }
      } else {
        // No curriculum goal — just mark complete with today's date
        await supabase.from("lessons").update({
          completed: true,
          date: today,
          minutes_spent: mins,
        }).eq("id", lessonId);
      }
    }

    setSavingExtra(false);
    setShowExtraLessons(false);
    loadData();
  }

  function openEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    setEditTitle(lesson.title);
    setEditSubject(lesson.subjects?.name ?? "");
    setEditHours(lesson.minutes_spent != null ? String(lesson.minutes_spent) : "");
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
      title:         editTitle.trim(),
      subject_id:    subjectId,
      minutes_spent: editHours ? parseInt(editHours) : null,
      child_id:      editChildId || null,
    }).eq("id", editingLesson.id);

    setLessons((prev) => prev.map((l) => {
      if (l.id !== editingLesson.id) return l;
      return {
        ...l,
        title:         editTitle.trim(),
        subjects:      editSubject.trim() ? { name: editSubject.trim(), color: l.subjects?.color ?? null } : null,
        minutes_spent: editHours ? parseInt(editHours) : null,
        child_id:      editChildId || l.child_id,
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

  // ── Extra lesson: log next lesson in sequence for a child's curriculum ────

  async function logExtraLesson(childId: string) {
    if (extraLessonLoading) return;
    setExtraLessonLoading(childId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setExtraLessonLoading(null); return; }

    // Find curriculum goals for this child that still have lessons remaining
    const { data: goals } = await supabase
      .from("curriculum_goals")
      .select("id, curriculum_name, current_lesson, total_lessons, child_id, default_minutes, school_days")
      .eq("user_id", user.id)
      .eq("child_id", childId);
    const activeGoals = (goals ?? []).filter(
      (g: { current_lesson: number; total_lessons: number }) => g.current_lesson < g.total_lessons
    );
    if (activeGoals.length === 0) { setExtraLessonLoading(null); return; }

    // Find the next uncompleted lesson across all goals, preferring earliest lesson_number
    type NextLessonRow = { id: string; title: string; curriculum_goal_id: string; lesson_number: number; child_id: string };
    let nextLesson: NextLessonRow | null = null;

    for (const goal of activeGoals) {
      const { data: upcoming } = await supabase
        .from("lessons")
        .select("id, title, curriculum_goal_id, lesson_number, child_id")
        .eq("curriculum_goal_id", goal.id)
        .eq("completed", false)
        .order("lesson_number", { ascending: true })
        .limit(1);
      if (upcoming && upcoming.length > 0) {
        const candidate = upcoming[0] as NextLessonRow;
        if (!nextLesson || candidate.lesson_number < nextLesson.lesson_number) {
          nextLesson = candidate;
        }
      }
    }

    if (!nextLesson) { setExtraLessonLoading(null); return; }

    // Mark the lesson as completed with today's date and default minutes
    const goalForLesson = activeGoals.find((g: { id: string }) => g.id === nextLesson!.curriculum_goal_id);
    const mins = (goalForLesson as { default_minutes?: number })?.default_minutes ?? 30;

    await supabase.from("lessons").update({
      completed: true,
      date: today,
      scheduled_date: today,
      minutes_spent: mins,
    }).eq("id", nextLesson.id);

    // Update curriculum_goal current_lesson
    if (goalForLesson) {
      const newCurrent = nextLesson.lesson_number;
      await supabase.from("curriculum_goals")
        .update({ current_lesson: newCurrent })
        .eq("id", nextLesson.curriculum_goal_id);

      // Auto-schedule the NEXT lesson (one beyond the one we just completed)
      if (newCurrent < (goalForLesson as { total_lessons: number }).total_lessons) {
        const nextNum = newCurrent + 1;
        const days = schoolDaysArr.length > 0
          ? schoolDaysArr
          : ["monday", "tuesday", "wednesday", "thursday", "friday"];
        const nextDate = new Date(today + "T12:00:00");
        for (let i = 0; i < 14; i++) {
          nextDate.setDate(nextDate.getDate() + 1);
          const dayName = nextDate.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
          if (days.includes(dayName)) break;
        }
        await supabase.from("lessons").insert({
          user_id: user.id,
          child_id: childId,
          curriculum_goal_id: nextLesson.curriculum_goal_id,
          title: `${(goalForLesson as { curriculum_name: string }).curriculum_name} — Lesson ${nextNum}`,
          lesson_number: nextNum,
          scheduled_date: localDateStr(nextDate),
          completed: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Add the completed lesson to Today's view
    const completedLesson: Lesson = {
      id: nextLesson.id,
      title: nextLesson.title,
      completed: true,
      child_id: childId,
      hours: null,
      minutes_spent: mins,
      subjects: null,
      curriculum_goal_id: nextLesson.curriculum_goal_id,
      lesson_number: nextLesson.lesson_number,
    };
    setLessons(prev => [...prev, completedLesson]);

    // Show ahead-of-schedule prompt
    setAheadPromptChildren(prev => new Set(prev).add(childId));

    // Toast
    showCaptureToast("Extra lesson logged! 🌱", null);
    setExtraLessonLoading(null);
  }

  async function rescheduleAfterExtra(childId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get all curriculum goals for this child
    const { data: goals } = await supabase
      .from("curriculum_goals")
      .select("id, school_days")
      .eq("user_id", user.id)
      .eq("child_id", childId);

    for (const goal of (goals ?? [])) {
      const schoolDays = (goal as { school_days?: string[] }).school_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const activeDays = new Set(schoolDays.map((d: string) => dayMap[d] ?? -1));

      const { data: futureLessons } = await supabase
        .from("lessons")
        .select("id, scheduled_date")
        .eq("curriculum_goal_id", goal.id)
        .eq("completed", false)
        .gte("scheduled_date", today)
        .order("scheduled_date", { ascending: true });

      if (!futureLessons || futureLessons.length === 0) continue;

      const cursor = new Date(today + "T12:00:00");
      const updates: { id: string; date: string }[] = [];
      for (const lesson of futureLessons) {
        let safety = 0;
        while (safety < 365) {
          cursor.setDate(cursor.getDate() + 1);
          const dayIdx = (cursor.getDay() + 6) % 7; // Mon=0 .. Sun=6
          if (activeDays.has(dayIdx)) {
            updates.push({ id: (lesson as { id: string }).id, date: localDateStr(cursor) });
            break;
          }
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

    setAheadPromptChildren(prev => {
      const next = new Set(prev);
      next.delete(childId);
      return next;
    });
    showCaptureToast("Schedule updated! 🌿", null);
  }

  // ── Reschedule lesson functions ──────────────────────────────────────────────

  function openReschedule(lesson: Lesson) {
    setRescheduleLesson(lesson);
    setReschedulePicker(false);
    setReschedulePickerDate("");
  }

  function showRescheduleUndo(message: string, undoData: { lessonId: string; date: string }[]) {
    if (rescheduleUndoTimer.current) clearTimeout(rescheduleUndoTimer.current);
    setRescheduleUndoToast({ message, undoData });
    rescheduleUndoTimer.current = setTimeout(() => setRescheduleUndoToast(null), 8000);
  }

  async function undoReschedule() {
    if (!rescheduleUndoToast) return;
    const { undoData } = rescheduleUndoToast;
    for (let i = 0; i < undoData.length; i += 20) {
      await Promise.all(
        undoData.slice(i, i + 20).map(({ lessonId, date }) =>
          supabase.from("lessons").update({ scheduled_date: date, date }).eq("id", lessonId)
        )
      );
    }
    // Restore lesson in Today view if it was moved away
    if (undoData.length === 1 && undoData[0].date === today) {
      const { data: restored } = await supabase.from("lessons")
        .select("id, title, completed, child_id, hours, minutes_spent, subjects(name, color), curriculum_goal_id, lesson_number, goal_id")
        .eq("id", undoData[0].lessonId).single();
      if (restored) setLessons(prev => prev.some(l => l.id === restored.id) ? prev : [...prev, restored as unknown as Lesson]);
    }
    setRescheduleUndoToast(null);
    if (rescheduleUndoTimer.current) clearTimeout(rescheduleUndoTimer.current);
    showCaptureToast("Undo complete", null);
  }

  async function rescheduleMoveTo(targetDate: string) {
    if (!rescheduleLesson) return;
    const originalDate = today;
    // Move in DB
    await supabase.from("lessons").update({ scheduled_date: targetDate, date: targetDate }).eq("id", rescheduleLesson.id);
    // Remove from Today view
    setLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
    setRescheduleLesson(null);
    posthog.capture('lesson_rescheduled', { user_plan: isPro ? 'paid' : 'free' });
    const label = targetDate === localDateStr(new Date(new Date().setDate(new Date().getDate() + 1))) ? "Moved to tomorrow" : "Lesson rescheduled";
    showRescheduleUndo(`${label}! Undo?`, [{ lessonId: rescheduleLesson.id, date: originalDate }]);
  }

  async function reschedulePushAll() {
    if (!rescheduleLesson?.curriculum_goal_id) return;
    const goalId = rescheduleLesson.curriculum_goal_id;

    // Get school_days for this goal
    const { data: goalRow } = await supabase.from("curriculum_goals")
      .select("school_days").eq("id", goalId).single();
    const schoolDays = (goalRow as { school_days?: string[] } | null)?.school_days ?? [];
    const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const activeDays = schoolDays.length > 0 ? new Set(schoolDays.map(d => dayMap[d] ?? -1)) : null;

    // Fetch all uncompleted future lessons for this goal
    const { data: futureLessons } = await supabase.from("lessons")
      .select("id, scheduled_date")
      .eq("curriculum_goal_id", goalId)
      .eq("completed", false)
      .gte("scheduled_date", today)
      .order("scheduled_date", { ascending: true });
    if (!futureLessons || futureLessons.length === 0) { setRescheduleLesson(null); return; }

    // Store undo data
    const undoData = futureLessons.map((l: { id: string; scheduled_date: string }) => ({ lessonId: l.id, date: l.scheduled_date }));

    // Push each lesson to the next school day after its current date
    const updates: { id: string; newDate: string }[] = [];
    for (const lesson of futureLessons) {
      const cur = new Date((lesson as { scheduled_date: string }).scheduled_date + "T12:00:00");
      let safety = 0;
      while (safety < 365) {
        cur.setDate(cur.getDate() + 1);
        const dayIdx = (cur.getDay() + 6) % 7;
        if (!activeDays || activeDays.has(dayIdx)) {
          updates.push({ id: (lesson as { id: string }).id, newDate: localDateStr(cur) });
          break;
        }
        safety++;
      }
    }

    for (let i = 0; i < updates.length; i += 20) {
      await Promise.all(
        updates.slice(i, i + 20).map(({ id, newDate }) =>
          supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", id)
        )
      );
    }

    // Remove the current lesson from Today view if it was pushed
    setLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
    setRescheduleLesson(null);
    showRescheduleUndo(`${undoData.length} lessons pushed back! Undo?`, undoData);
  }

  async function rescheduleDoubleUp() {
    if (!rescheduleLesson?.curriculum_goal_id) return;
    const originalDate = today;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = localDateStr(tomorrow);

    // Move today's lesson to tomorrow (it will share the day with tomorrow's scheduled lesson)
    await supabase.from("lessons").update({ scheduled_date: tomorrowStr, date: tomorrowStr }).eq("id", rescheduleLesson.id);
    setLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
    setRescheduleLesson(null);
    showRescheduleUndo("Doubled up tomorrow! Undo?", [{ lessonId: rescheduleLesson.id, date: originalDate }]);
  }

  async function rescheduleMissedDay() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Find ALL lessons scheduled for today (including completed — mom may want to undo a checked-off day)
    const todaysLessons = [...lessons];
    if (todaysLessons.length === 0) { setRescheduleLesson(null); return; }

    // Store undo data
    const undoData = todaysLessons.map(l => ({ lessonId: l.id, date: today }));

    // Group by curriculum_goal_id to respect each curriculum's school_days
    const goalIds = [...new Set(todaysLessons.map(l => l.curriculum_goal_id).filter(Boolean))] as string[];
    const goalSchoolDays = new Map<string, Set<number>>();
    if (goalIds.length > 0) {
      const { data: goals } = await supabase.from("curriculum_goals")
        .select("id, school_days").in("id", goalIds);
      const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      for (const g of (goals ?? [])) {
        const days = (g as { school_days?: string[] }).school_days ?? [];
        goalSchoolDays.set(g.id, days.length > 0 ? new Set(days.map((d: string) => dayMap[d] ?? -1)) : new Set([0, 1, 2, 3, 4]));
      }
    }
    const defaultDays = new Set([0, 1, 2, 3, 4]); // Mon-Fri

    // Move each lesson to its next valid school day
    const updates: { id: string; newDate: string }[] = [];
    for (const lesson of todaysLessons) {
      const activeDays = (lesson.curriculum_goal_id && goalSchoolDays.has(lesson.curriculum_goal_id))
        ? goalSchoolDays.get(lesson.curriculum_goal_id)!
        : defaultDays;
      const cur = new Date(today + "T12:00:00");
      let safety = 0;
      while (safety < 365) {
        cur.setDate(cur.getDate() + 1);
        const dayIdx = (cur.getDay() + 6) % 7;
        if (activeDays.has(dayIdx)) {
          updates.push({ id: lesson.id, newDate: localDateStr(cur) });
          break;
        }
        safety++;
      }
    }

    for (let i = 0; i < updates.length; i += 20) {
      await Promise.all(
        updates.slice(i, i + 20).map(({ id, newDate }) =>
          supabase.from("lessons").update({ scheduled_date: newDate, date: newDate, completed: false, minutes_spent: null }).eq("id", id)
        )
      );
    }

    setLessons([]);
    setRescheduleLesson(null);
    showRescheduleUndo("All of today's lessons rescheduled! Undo?", undoData);
  }

  async function saveBook() {
    if (!bookTitle.trim()) return;
    setSavingBook(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingBook(false); return; }

    // Upload cover photo if provided
    let photoUrl: string | null = null;
    if (bookPhotoFile) {
      const compressed = await compressImage(bookPhotoFile);
      const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }
    }

    // Build caption from author + pages
    const captionParts: string[] = [];
    if (bookAuthor.trim()) captionParts.push(`Author: ${bookAuthor.trim()}`);
    if (bookPages.trim()) captionParts.push(`Pages: ${bookPages.trim()}`);
    const caption = captionParts.length > 0 ? captionParts.join(" | ") : null;

    const nowB = new Date().toISOString();
    const { data: inserted, error: bookErr } = await supabase.from("memories").insert({
      user_id: user.id, type: "book", title: bookTitle.trim(),
      caption,
      photo_url: photoUrl,
      child_id: bookChild || null, date: today, include_in_book: true,
      created_at: nowB, updated_at: nowB,
    }).select("id").single();
    if (bookErr) { console.error("[Rooted] Book save failed:", bookErr.message); setSavingBook(false); showCaptureToast("Save failed — try again", null); return; }
    console.log("[Rooted] Saved:", "book", inserted);
    if (bookChild) setLeafCounts((prev) => ({ ...prev, [bookChild]: (prev[bookChild] ?? 0) + 1 }));
    setBookTitle(""); setBookChild(""); setBookAuthor(""); setBookPages("");
    setBookPhotoFile(null); setBookPhotoPreview(null);
    setSavingBook(false); setShowBookModal(false);
    posthog.capture('book_logged', { user_plan: isPro ? 'paid' : 'free' });
    showCaptureToast("📖 Added to your story 🌿", (inserted as { id: string } | null)?.id ?? null, "book", bookChild || null);
    await loadData();
    checkAndAwardBadges(user.id);
    onLogAction({ userId: user.id, childId: bookChild || undefined, actionType: "book" });
  }

  async function saveDrawing() {
    if (!drawingTitle.trim()) return;
    setSavingDrawing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingDrawing(false); return; }
    let photoUrl: string | null = null;
    if (drawingFile) {
      const compressed = await compressImage(drawingFile);
      const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }
    }
    const nowD = new Date().toISOString();
    const { data: inserted, error: drawErr } = await supabase.from("memories").insert({
      user_id: user.id, type: "drawing", title: drawingTitle.trim(),
      photo_url: photoUrl, child_id: drawingChild || null, date: today, include_in_book: true,
      created_at: nowD, updated_at: nowD,
    }).select("id").single();
    if (drawErr) { console.error("[Rooted] Drawing save failed:", drawErr.message); setSavingDrawing(false); showCaptureToast("Save failed — try again", null); return; }
    console.log("[Rooted] Saved:", "drawing", inserted);
    setDrawingTitle(""); setDrawingChild(""); setDrawingFile(null); setDrawingPreview(null);
    setSavingDrawing(false); setShowDrawingSheet(false);
    showCaptureToast("🎨 Drawing saved 🌿", (inserted as { id: string } | null)?.id ?? null, "drawing", drawingChild || null);
    await loadData();
    checkAndAwardBadges(user.id);
    onLogAction({ userId: user.id, childId: drawingChild || undefined, actionType: "drawing" });
  }

  // ── Capture toast + edit sheet helpers ────────────────────────────────────

  function showCaptureToast(message: string, memoryId: string | null, memoryType?: string, childId?: string | null) {
    setCaptureToast({ message, memoryId });
    setTimeout(() => setCaptureToast(null), 4000);
    if (memoryId) {
      posthog.capture('memory_captured', { type: memoryType ?? 'unknown' });
      triggerGardenAnimation(childId ?? undefined);
      earnLeaf();
    }
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
    await loadData();
  }

  async function deleteFromEditSheet() {
    if (!editSheet) return;
    setEditDeleting(true);
    await supabase.from("memories").delete().eq("id", editSheet.id);
    setEditDeleting(false); setEditSheet(null);
    showCaptureToast("🗑️ Deleted", null);
    await loadData();
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

  // Detect timeline mode: any item today has a scheduled_start_time
  const hasAnyStartTime = todayActivities.some(a => a.scheduled_start_time != null);
  // We check curriculum_goals for lessons too — but we don't have that joined here.
  // For simplicity, use activities' start times as the trigger (curriculum_goals.scheduled_start_time
  // would require an extra join). Timeline mode activates if ANY activity has a start time.
  const useTimeline = hasAnyStartTime;

  // Combined total for progress bar
  const totalItems = lessons.length + todayActivities.length;
  const doneItems = lessons.filter(l => l.completed).length + todayActivities.filter(a => a.completed).length;

  // Unified all-done (lessons + activities + appointments)
  const unifiedTotal = totalItems + todayAppointments.length;
  const unifiedDone = doneItems + todayAppointments.filter(a => a.completed).length;
  const unifiedAllDone = unifiedTotal > 0 && unifiedDone === unifiedTotal;
  const prevUnifiedDoneRef = useRef(0);
  useEffect(() => {
    if (!loading && unifiedAllDone && prevUnifiedDoneRef.current < unifiedTotal) {
      const todayKey = `rooted_alldone_${today}`;
      if (!localStorage.getItem(todayKey)) {
        localStorage.setItem(todayKey, "1");
        setAllDoneCelebration(true);
        setTimeout(() => setAllDoneCelebration(false), 3000);
      }
    }
    prevUnifiedDoneRef.current = unifiedDone;
  }, [unifiedAllDone, unifiedDone, unifiedTotal, loading, today]);

  // Expanded child panel for lesson swipe
  const [expandedChild, setExpandedChild] = useState<string | null>(null);

  if (loading) {
    return (
      <>
        {/* Skeleton: Book Cover Card */}
        <div className="mx-5 mt-5 rounded-2xl p-4 space-y-3" style={{ background: "var(--g-brand)" }}>
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
          className="px-4 py-2 rounded-xl bg-[#5c7f63] text-white text-sm font-medium hover:bg-[var(--g-deep)] transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          HEADER — matches PageHero layout exactly
         ═══════════════════════════════════════════════════════════ */}
      <div
        className="relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden"
        style={{ background: "var(--g-brand)" }}
      >
        {/* Decorative background leaves (same as PageHero) */}
        <div
          className="absolute top-2 right-3 text-[100px] leading-none select-none pointer-events-none"
          style={{ opacity: 0.06 }}
          aria-hidden
        >🌿</div>
        <div
          className="absolute -bottom-2 left-2 text-[80px] leading-none select-none pointer-events-none"
          style={{ opacity: 0.05 }}
          aria-hidden
        >🌱</div>

        {/* Eyebrow: family name */}
        <p
          className="text-[11px] font-semibold tracking-widest uppercase mb-1"
          style={{ color: "rgba(254, 252, 249, 0.55)" }}
        >
          {familyName || "Today"}
        </p>

        {/* Greeting */}
        <h1
          className="text-[22px] sm:text-[26px] font-bold leading-tight"
          style={{ color: "#fefcf9", fontFamily: "var(--font-display)" }}
        >
          {(() => {
            const h = new Date().getHours();
            const tod = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
            return firstName ? `${tod}, ${firstName}` : tod;
          })()}
        </h1>

        {/* Date + stats row */}
        <div className="flex items-center justify-between mt-1">
          <p className="text-[14px]" style={{ color: "rgba(255,255,255,0.70)" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          {totalMemories > 0 && (
            <p className="text-[14px]" style={{ color: "rgba(255,255,255,0.70)" }}>
              {totalMemories} memories{activeDaysThisMonth > 0 ? ` · ${activeDaysThisMonth} day${activeDaysThisMonth !== 1 ? "s" : ""} active` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-4 pb-7 space-y-5">

      {/* Achievement banner */}
      {achievementBanner && (
        <button onClick={() => { setAchievementBanner(null); window.location.href = "/dashboard/printables"; }}
          className="w-full rounded-2xl px-4 py-3 text-left transition-all hover:opacity-90"
          style={{ backgroundColor: "#2D5016", color: "white" }}>
          <p className="text-sm font-semibold">
            {achievementBanner.isEducator ? "\uD83D\uDC9B You earned a certificate!" : `\uD83C\uDF89 ${achievementBanner.childName || "Your child"} earned a certificate!`}
          </p>
          <p className="text-xs opacity-80 mt-0.5">
            {achievementBanner.label}
            {achievementBanner.extra > 0 ? ` + ${achievementBanner.extra} more in Printables \u2192` : " \u00b7 Download \u2192"}
          </p>
        </button>
      )}

      {/* ═══════════════════════════════════════════════════════════
          WHAT'S NEW — dismissible card for existing users
         ═══════════════════════════════════════════════════════════ */}
      {!loading && onboarded === true && (() => {
        if (typeof window === "undefined") return null;
        if (localStorage.getItem("rooted_whats_new_v1") === "1") return null;
        return (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 relative">
            <p className="text-[15px] font-medium text-[#2d2926] mb-2.5" style={{ fontFamily: "var(--font-display)" }}>
              New stuff just dropped
            </p>
            <div className="space-y-1.5 text-[13px] text-[#5C5346]">
              <p>📋 My Lists — to-do&apos;s, shopping lists, whatever you need</p>
              <p>📅 Appointments — track the dentist, co-op, guitar, all of it</p>
              <p>🧠 Smart schedule — your whole day in one spot with a vibe check</p>
              <p>🎉 Check something off — trust us, just try it</p>
            </div>
            <button
              type="button"
              onClick={() => { localStorage.setItem("rooted_whats_new_v1", "1"); forceUpdate(prev => prev + 1); }}
              className="mt-4 px-5 py-2 rounded-xl bg-[#2D5A3D] text-white text-sm font-medium hover:opacity-90 transition-colors"
            >
              Got it!
            </button>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          UNIFIED TIMELINE — lessons + activities + appointments
         ═══════════════════════════════════════════════════════════ */}
      {!loading && (hasAnyLessons || todayActivities.length > 0 || todayAppointments.length > 0) && (
        <UnifiedTimeline
          lessons={lessons as { id: string; title: string; completed: boolean; child_id: string; subjects: { name: string; color: string | null } | null; icon_emoji?: string | null }[]}
          activities={todayActivities}
          appointments={todayAppointments}
          children={children}
          onToggleLesson={(id, completed) => { if (!isPartner) openCheckOffModal(id, completed); }}
          onToggleActivity={(a) => { if (!isPartner) toggleActivity(a); }}
          onToggleAppointment={async (id, completed) => {
            const token = await getToken();
            if (!token) return;
            await fetch("/api/appointments", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, completed: !completed }) });
            loadData();
          }}
          onLogExtra={openExtraLessons}
          onManage={() => setShowManageSchedule(true)}
          onAddAppt={() => setShowApptWizard(true)}
          isPartner={isPartner}
          upcomingDays={upcomingDays}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════
          SCHEDULE CARD — detailed lesson management (child tabs, check-off, reschedule)
         ═══════════════════════════════════════════════════════════ */}
      {(hasAnyLessons || todayActivities.length > 0) && (() => {
        const totalLessons = lessons.length;
        const doneLessons = lessons.filter(l => l.completed).length;
        const doneActivities = todayActivities.filter(a => a.completed).length;
        const combinedTotal = totalLessons + todayActivities.length;
        const combinedDone = doneLessons + doneActivities;
        const combinedAllDone = combinedTotal > 0 && combinedDone === combinedTotal;
        const combinedPct = combinedTotal > 0 ? (combinedDone / combinedTotal) * 100 : 0;
        const uniqueChildIds = new Set([
          ...lessons.map(l => l.child_id).filter(Boolean),
          ...todayActivities.flatMap(a => a.child_ids),
        ]);

        // Build unified item list for both views
        type ScheduleItem = (
          | { kind: "lesson"; lesson: Lesson; startTime: number | null }
          | { kind: "activity"; activity: TodayActivity; startTime: number | null }
        );
        const items: ScheduleItem[] = [
          ...lessons.map(l => ({ kind: "lesson" as const, lesson: l, startTime: null as number | null })),
          ...todayActivities.map(a => ({ kind: "activity" as const, activity: a, startTime: parseTimeToMinutes(a.scheduled_start_time) })),
        ];

        // Sort: completed at bottom, then by start time (nulls last), then lessons before activities
        items.sort((a, b) => {
          const aDone = a.kind === "lesson" ? a.lesson.completed : a.activity.completed;
          const bDone = b.kind === "lesson" ? b.lesson.completed : b.activity.completed;
          if (aDone !== bDone) return aDone ? 1 : -1;
          const aTime = a.startTime ?? 9999;
          const bTime = b.startTime ?? 9999;
          if (aTime !== bTime) return aTime - bTime;
          return a.kind === "lesson" ? -1 : 1;
        });

        // For timeline view: separate timed vs flexible items
        const timedItems = items.filter(i => i.startTime != null);
        const flexibleItems = items.filter(i => i.startTime == null);

        // Apply shift offset for "Running late?" in timeline
        const getDisplayTime = (mins: number | null) => {
          if (mins == null) return null;
          const shifted = mins + timeShiftOffset;
          return shifted >= 1440 ? null : shifted; // past midnight → flexible
        };

        return (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-end px-5 pt-3 pb-2">
              <div className="flex items-center gap-2">
                {useTimeline && !isPartner && (
                  <button
                    type="button"
                    onClick={() => setShowRunningLate(true)}
                    className="text-xs text-[#5c7f63] font-semibold bg-[#eef3ef] border-none px-2.5 py-1.5 rounded-lg"
                  >
                    ⏩ Running late?
                  </button>
                )}
                {/* Duplicate removed — "+ Log an extra lesson" is in UnifiedTimeline header */}
              </div>
            </div>

            {/* ── TIMELINE VIEW ──────────────────────────────────── */}
            {useTimeline && combinedTotal > 0 && !combinedAllDone && (
              <div className="px-4 pb-3">
                {/* Timed items */}
                {timedItems.length > 0 && (
                  <div className="relative">
                    {/* Vertical connecting line */}
                    <div className="absolute left-[33px] top-[14px] bottom-[14px] w-[2px] bg-[#e8e5e0]" />
                    {timedItems.map((item, idx) => {
                      const isDone = item.kind === "lesson" ? item.lesson.completed : item.activity.completed;
                      const isFirst = !isDone && !timedItems.slice(0, idx).some(i =>
                        !(i.kind === "lesson" ? i.lesson.completed : i.activity.completed)
                      );
                      const displayMins = getDisplayTime(item.startTime);
                      if (displayMins == null) return null; // shifted past midnight

                      return (
                        <button
                          key={item.kind === "lesson" ? `l-${item.lesson.id}` : `a-${item.activity.id}`}
                          type="button"
                          onClick={() => {
                            if (isPartner) return;
                            if (item.kind === "lesson") openCheckOffModal(item.lesson.id, item.lesson.completed);
                            else toggleActivity(item.activity);
                          }}
                          className="relative w-full flex items-center gap-3 py-2.5 text-left"
                        >
                          {/* Time */}
                          <span className="text-xs font-semibold text-[#b5aca4] w-12 text-right shrink-0">
                            {formatTime(displayMins)}
                          </span>
                          {/* Dot */}
                          <div className={`relative z-10 flex items-center justify-center shrink-0 ${
                            isDone
                              ? "w-[18px] h-[18px] rounded-full bg-[#2D5A3D]"
                              : isFirst
                                ? "w-[18px] h-[18px] rounded-full border-2 border-[#2D5A3D] bg-[#e8f0e9] shadow-[0_0_0_3px_rgba(45,90,61,0.15)]"
                                : "w-[18px] h-[18px] rounded-full border-2 border-[#e0ddd8] bg-white"
                          }`}>
                            {isDone && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-[14px] font-medium truncate ${isDone ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                {item.kind === "activity" && <span className="mr-1">{item.activity.emoji}</span>}
                                {item.kind === "lesson" ? item.lesson.title : item.activity.name}
                              </p>
                              {item.kind === "activity" && (
                                <span className="bg-[#ede8f5] text-[#6b4f9e] text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0">Activity</span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#7a6f65] truncate">
                              {item.kind === "lesson"
                                ? [item.lesson.subjects?.name, children.find(c => c.id === item.lesson.child_id)?.name].filter(Boolean).join(" · ")
                                : [formatDuration(item.activity.duration_minutes), ...item.activity.child_ids.map(cid => children.find(c => c.id === cid)?.name).filter(Boolean)].join(" · ")
                              }
                            </p>
                          </div>
                          {/* Child tag */}
                          {item.kind === "lesson" && (() => {
                            const child = children.find(c => c.id === item.lesson.child_id);
                            return child && uniqueChildIds.size > 1 ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-[#f0ede8] text-[#7a6f65] shrink-0">{child.name}</span>
                            ) : null;
                          })()}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Flexible section (no times) */}
                {flexibleItems.length > 0 && (
                  <>
                    {timedItems.length > 0 && (
                      <div className="flex items-center gap-2 my-2 px-1">
                        <div className="flex-1 h-px bg-[#e8e5e0]" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#b5aca4]">Flexible</span>
                        <div className="flex-1 h-px bg-[#e8e5e0]" />
                      </div>
                    )}
                    {flexibleItems.map((item, idx) => {
                      const isDone = item.kind === "lesson" ? item.lesson.completed : item.activity.completed;
                      return (
                        <button
                          key={item.kind === "lesson" ? `l-${item.lesson.id}` : `a-${item.activity.id}`}
                          type="button"
                          onClick={() => {
                            if (isPartner) return;
                            if (item.kind === "lesson") openCheckOffModal(item.lesson.id, item.lesson.completed);
                            else toggleActivity(item.activity);
                          }}
                          className={`w-full flex items-center gap-3 py-3 px-1 text-left transition-colors ${idx < flexibleItems.length - 1 ? "border-b border-[#f5f3ef]" : ""}`}
                        >
                          <div className={`w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isDone ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#d4d0ca]"
                          }`}>
                            {isDone && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-[14px] font-medium truncate ${isDone ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                {item.kind === "activity" && <span className="mr-1">{item.activity.emoji}</span>}
                                {item.kind === "lesson" ? item.lesson.title : item.activity.name}
                              </p>
                              {item.kind === "activity" && (
                                <span className="bg-[#ede8f5] text-[#6b4f9e] text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0">Activity</span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#7a6f65] truncate">
                              {item.kind === "lesson"
                                ? item.lesson.subjects?.name || ""
                                : [formatDuration(item.activity.duration_minutes), ...item.activity.child_ids.map(cid => children.find(c => c.id === cid)?.name).filter(Boolean)].join(" · ")
                              }
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* ── CHECKLIST VIEW ─────────────────────────────────── */}
            {!useTimeline && combinedTotal > 0 && !combinedAllDone && (() => {
              // Auto-flow times when school_start_time is set
              const showTimes = !!schoolStartTime;
              let runningMins = 0;
              if (showTimes && schoolStartTime) {
                const [hh, mm] = schoolStartTime.split(":").map(Number);
                runningMins = (hh || 0) * 60 + (mm || 0);
              }
              const fmtTime = (mins: number) => {
                const h = Math.floor(mins / 60) % 12 || 12;
                const m = mins % 60;
                const ap = mins < 720 ? "am" : "pm";
                return m > 0 ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
              };

              return (
                <div className="px-4 pb-3">
                  {items.map((item, idx) => {
                    const isDone = item.kind === "lesson" ? item.lesson.completed : item.activity.completed;
                    const durMins = item.kind === "lesson"
                      ? (item.lesson.minutes_spent ?? 30)
                      : (item.activity.duration_minutes ?? 60);
                    const itemTime = showTimes ? fmtTime(runningMins) : null;
                    if (showTimes) runningMins += durMins;

                    return (
                      <button
                        key={item.kind === "lesson" ? `l-${item.lesson.id}` : `a-${item.activity.id}`}
                        type="button"
                        onClick={() => {
                          if (isPartner) return;
                          if (item.kind === "lesson") openCheckOffModal(item.lesson.id, item.lesson.completed);
                          else toggleActivity(item.activity);
                        }}
                        className={`w-full flex items-center gap-2 py-3 px-1 text-left transition-colors ${idx < items.length - 1 ? "border-b border-[#f5f3ef]" : ""}`}
                      >
                        {/* Time column */}
                        {showTimes && (
                          <span className="text-[#8B7E74] text-xs w-12 text-right shrink-0">{itemTime}</span>
                        )}
                        {/* Checkbox */}
                        <div
                          className={`w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isDone ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#d4d0ca]"
                          }`}
                        >
                          {isDone && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        {/* Item info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-[14px] font-medium truncate ${isDone ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                              {item.kind === "activity" && <span className="mr-1">{item.activity.emoji}</span>}
                              {item.kind === "lesson" ? item.lesson.title : item.activity.name}
                            </p>
                            {item.kind === "activity" && (
                              <span className="bg-[#ede8f5] text-[#6b4f9e] text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0">Activity</span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#7a6f65] truncate">
                            {item.kind === "lesson"
                              ? (item.lesson.subjects?.name || "")
                              : item.activity.child_ids.map(cid => children.find(c => c.id === cid)?.name).filter(Boolean).join(", ")
                            }
                          </p>
                        </div>
                        {/* Duration right-aligned */}
                        <span className="text-[11px] text-[#8B7E74] shrink-0">
                          {durMins >= 60 ? `${Math.floor(durMins / 60)} hr${durMins % 60 > 0 ? ` ${durMins % 60}m` : ""}` : `${durMins} min`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Redundant sections removed — covered by UnifiedTimeline status line + header counter */}
          </div>
        );
      })()}

      {/* Skip rest of today link */}
      {lessons.some(l => !l.completed) && !isPartner && (
        <button
          type="button"
          onClick={skipRestOfToday}
          className="w-full text-xs text-[#b8860b] font-medium text-center cursor-pointer py-1"
        >
          Rough day? Skip remaining → next school day
        </button>
      )}

      {/* ═══════════════════════════════════════════════════════════
          LESSON SWIPE — horizontal child cards + expandable panel (kept for multi-child detail)
         ═══════════════════════════════════════════════════════════ */}
      {hasAnyLessons && lessons.length > 0 && (() => {
        const childIds = new Set(children.map(c => c.id));
        const cardsToRender: { id: string; name: string; color: string | null; lessons: Lesson[] }[] = [];
        children.forEach(child => {
          const cl = lessons.filter(l => l.child_id === child.id);
          if (cl.length > 0) cardsToRender.push({ id: child.id, name: child.name, color: child.color, lessons: cl });
        });
        const unassigned = lessons.filter(l => !l.child_id || !childIds.has(l.child_id));
        if (unassigned.length > 0) cardsToRender.push({ id: "__unassigned", name: "Unassigned", color: "#9a8f85", lessons: unassigned });

        // Only show swipe cards for multi-child families
        if (cardsToRender.length <= 1) return null;

        return (
          <div>
            {/* Horizontal scrollable child cards */}
            <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}>
              <style>{`.flex::-webkit-scrollbar { display: none; }`}</style>
              {cardsToRender.map(card => {
                const done = card.lessons.filter(l => l.completed).length;
                const total = card.lessons.length;
                const cardAllDone = done === total;
                const noneStarted = done === 0;
                const isExpanded = expandedChild === card.id;

                const borderColor = cardAllDone ? "#b8d89a" : noneStarted ? "#e8d58a" : "#e8e2d9";
                const bgColor = cardAllDone ? "#f4faf0" : noneStarted ? "#fffcf5" : "#fff";

                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setExpandedChild(isExpanded ? null : card.id)}
                    className="shrink-0 text-left transition-all"
                    style={{
                      minWidth: 108, background: bgColor, borderRadius: 14,
                      border: `1px solid ${borderColor}`, padding: "10px 12px",
                      outline: isExpanded ? `2px solid var(--g-brand)` : "none",
                      outlineOffset: -1,
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: card.color ?? "#5c7f63" }}
                      >
                        {card.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-bold text-[#2d2926] truncate">{toTitleCase(card.name)}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-[3px] rounded-full mb-1.5" style={{ backgroundColor: "#ece8e0" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%`, backgroundColor: "var(--g-brand)" }} />
                    </div>
                    <p className={`text-[10px] font-semibold ${cardAllDone ? "text-[var(--g-deep)]" : "text-[#9a8f85]"}`}>
                      {cardAllDone ? "✓ All done" : `${done} of ${total} done`}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-[#c8bfb5] text-center mt-1.5">tap a card to see lessons · swipe for more kids</p>

            {/* Expanded inline lesson panel */}
            {expandedChild && (() => {
              const childObj = children.find(c => c.id === expandedChild);
              const cl = expandedChild === "__unassigned"
                ? lessons.filter(l => !l.child_id || !childIds.has(l.child_id))
                : lessons.filter(l => l.child_id === expandedChild);
              if (cl.length === 0) return null;
              const allChildDone = cl.length > 0 && cl.every(l => l.completed);
              const childName = childObj?.name ?? "your child";
              return (
                <div className="mt-2 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-2 space-y-1">
                  {cl.map(lesson => (
                    <TodayLessonCard
                      key={lesson.id} lesson={lesson}
                      childObj={expandedChild === "__unassigned" ? undefined : childObj}
                      onToggle={toggleLesson} onEdit={openEdit} onDelete={deleteLesson} onReschedule={openReschedule} onMinutesUpdate={(id, mins) => setLessons(prev => prev.map(l => l.id === id ? { ...l, minutes_spent: mins } : l))} isPartner={isPartner}
                    />
                  ))}
                  {/* Extra lesson button — only when all scheduled lessons done */}
                  {!isPartner && expandedChild !== "__unassigned" && allChildDone && (
                    <div style={{ position: "relative", zIndex: 10 }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); logExtraLesson(expandedChild); }}
                        disabled={extraLessonLoading === expandedChild}
                        style={{ minHeight: 44 }}
                        className="w-full text-center text-[12px] font-medium text-[#b5aca4] hover:text-[#7a6f65] py-2 transition-colors disabled:opacity-50"
                      >
                        {extraLessonLoading === expandedChild ? "Logging..." : `+ ${childName} did an extra lesson today`}
                      </button>
                    </div>
                  )}
                  {/* Ahead-of-schedule pill */}
                  {aheadPromptChildren.has(expandedChild) && !dismissedAheadPrompts.has(expandedChild) && (
                    <div className="flex items-center justify-between gap-2 bg-[#f4faf0] border border-[#d4e8c8] rounded-full px-3 py-1.5 mt-1">
                      <span className="text-[11px] text-[var(--g-deep)]">You&apos;re ahead of schedule — update your finish date?</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => rescheduleAfterExtra(expandedChild)}
                          className="text-[11px] font-semibold text-[var(--g-brand)] hover:underline"
                        >Update</button>
                        <button
                          onClick={() => setDismissedAheadPrompts(prev => new Set(prev).add(expandedChild))}
                          className="text-[#b5aca4] hover:text-[#7a6f65] text-xs leading-none"
                        >✕</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          SELFIE NUDGE — warm reminder for mom to get in the picture
         ═══════════════════════════════════════════════════════════ */}
      {!loading && !isPartner && totalMemories > 0 && (() => {
        if (typeof window === "undefined") return null;
        const dayNum = new Date().getDate();
        if (dayNum % 3 !== 0) return null;
        if (localStorage.getItem(`rooted_selfie_${today}`) === "1") return null;
        if (todayStory.some(m => m.type === "photo")) return null;
        const msgs = [
          "Hey mama \u2014 get in the picture today. Snap a selfie with your little besties. Messy bun and all. \u{1F49B}",
          "You\u2019re always behind the camera. Get in front of it today \u2014 they won\u2019t remember your hair, they\u2019ll remember you were there. \u{1F4F8}",
          "Quick \u2014 grab your phone and take a selfie with your kids right now. No filter needed. \u{1F49B}",
          "Future you will be so glad you did this. Take a pic with your babies today. \u{1F4F8}",
          "Messy house, no makeup, who cares. Snap a photo with your crew. These are the ones you\u2019ll treasure. \u{1F49B}",
          "Your kids don\u2019t see the mess. They see their mom. Get in the picture today. \u{1F4F8}",
        ];
        const msg = msgs[dayNum % msgs.length];
        return (
          <div className="relative rounded-2xl p-5 overflow-hidden" style={{ background: "linear-gradient(135deg, #fef2f2, #fce7f3, #fdf2f8)" }}>
            <button
              type="button"
              onClick={() => { localStorage.setItem(`rooted_selfie_${today}`, "1"); forceUpdate(prev => prev + 1); }}
              className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[#d4a0a0] hover:text-[#b07070] hover:bg-white/40 transition-colors text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
            <p className="text-[13px] text-[#6b4343] leading-relaxed pr-6">{msg}</p>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(`rooted_selfie_${today}`, "1");
                forceUpdate(prev => prev + 1);
                captureTypeRef.current = "photo";
                requestAnimationFrame(() => captureFileRef.current?.click());
              }}
              className="mt-3 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ background: "#c2616b" }}
            >
              📸 Take a selfie
            </button>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          CAPTURE BUTTON — compact for returning users, big for new
         ═══════════════════════════════════════════════════════════ */}
      {!loading && !isPartner && (
        totalMemories === 0 ? (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-[#e8f0e9] flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📸</span>
            </div>
            <h2 className="text-lg font-bold text-[#2D2A26] mb-1" style={{ fontFamily: "var(--font-display)" }}>
              Capture your first memory
            </h2>
            <p className="text-[13px] text-[#5C5346] max-w-[260px] mx-auto mb-5">
              A photo, a book they read, a win, a field trip — anything worth remembering.
            </p>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMemoryPicker(true); }}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-[#2D5A3D] hover:opacity-90 transition-colors"
            >
              ✚ Capture a memory
            </button>
            <p className="text-[11px] text-[#8B7E74] mt-3">
              This is how your garden, yearbook, and timeline all start growing.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMemoryPicker(true); }}
            className="w-full py-3 rounded-xl text-center font-medium text-white bg-[#2D5A3D] hover:opacity-90 transition-colors"
          >
            ✚ Capture a memory
          </button>
        )
      )}

      {/* ═══════════════════════════════════════════════════════════
          CONTEXTUAL ONBOARDING — one warm nudge card at a time
         ═══════════════════════════════════════════════════════════ */}
      {!loading && (() => {
        const ls = (k: string) => typeof window !== "undefined" && localStorage.getItem(k) === "1";
        const gardenVisited = ls("rooted_visited_garden");
        const yearbookVisited = ls("rooted_visited_yearbook");
        const curriculumDismissed = ls("rooted_dismissed_curriculum");
        const resourcesVisited = ls("rooted_visited_resources");
        const sharingVisited = ls("rooted_visited_sharing");
        const printablesVisited = ls("rooted_visited_printables");

        // Hide all nudges once user has 3+ memories and visited garden + yearbook
        if (totalMemories >= 3 && gardenVisited && yearbookVisited) return null;

        const childName = children.length > 0 ? children[0].name : null;

        type Nudge = { key: string; emoji: string; title: string; body: string; href: string; lsKey: string; dismiss?: { label: string; lsKey: string } };
        let nudge: Nudge | null = null;

        // Nudge 1 (memories === 0) is handled by the activation card above

        if (!nudge && totalMemories >= 1 && !gardenVisited) {
          nudge = {
            key: "garden", emoji: "🌳",
            title: childName ? `${childName}\u2019s tree just grew a leaf!` : "Your garden just grew a leaf!",
            body: "Go see your garden grow \u2192",
            href: "/dashboard/garden", lsKey: "rooted_visited_garden",
          };
        }
        if (!nudge && gardenVisited && !yearbookVisited) {
          nudge = {
            key: "yearbook", emoji: "📖",
            title: "Your yearbook already has something in it",
            body: `${totalMemories} memor${totalMemories === 1 ? "y is" : "ies are"} building your family book automatically. Preview it \u2192`,
            href: "/dashboard/memories/yearbook/read", lsKey: "rooted_visited_yearbook",
          };
        }
        if (!nudge && yearbookVisited && !hasAnyLessons && !curriculumDismissed) {
          nudge = {
            key: "curriculum", emoji: "📚",
            title: "Track your lessons in Plan",
            body: "Auto-schedule your curriculum and see your pace. Or skip \u2014 memories work great on their own.",
            href: "/dashboard/plan", lsKey: "rooted_dismissed_curriculum",
            dismiss: { label: "Not for us \u2192", lsKey: "rooted_dismissed_curriculum" },
          };
        }
        if (!nudge && yearbookVisited && (hasAnyLessons || curriculumDismissed) && !resourcesVisited) {
          nudge = {
            key: "resources", emoji: "🎁",
            title: "Explore free resources",
            body: "Deals, freebies, and field trips for homeschool families.",
            href: "/dashboard/resources", lsKey: "rooted_visited_resources",
          };
        }
        if (!nudge && resourcesVisited && !sharingVisited) {
          nudge = {
            key: "sharing", emoji: "👨\u200D👩\u200D👧",
            title: "Share with family",
            body: "Give loved ones a free portal to see your kids\u2019 memories and milestones.",
            href: "/dashboard/settings?tab=family", lsKey: "rooted_visited_sharing",
          };
        }
        if (!nudge && sharingVisited && !printablesVisited) {
          nudge = {
            key: "printables", emoji: "🖨️",
            title: "Print a certificate",
            body: "Certificates, ID cards, and lesson planners from your real data.",
            href: "/dashboard/printables", lsKey: "rooted_visited_printables",
          };
        }

        if (!nudge) return null;

        const n = nudge;
        return (
          <div key={n.key} className="bg-white border border-[#e8e2d9] rounded-2xl p-6 text-center relative">
            <button
              type="button"
              onClick={() => { localStorage.setItem(n.lsKey, "1"); forceUpdate(prev => prev + 1); }}
              className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[#d4d0ca] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
            <div className="w-14 h-14 rounded-full bg-[#e8f0e9] flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">{n.emoji}</span>
            </div>
            <p className="text-[18px] font-semibold text-[#1a2c22] mb-1" style={{ fontFamily: "var(--font-display)" }}>{n.title}</p>
            <p className="text-[13px] text-[#7a6f65] leading-relaxed max-w-[280px] mx-auto mb-5">{n.body}</p>
            <Link
              href={n.href}
              onClick={() => localStorage.setItem(n.lsKey, "1")}
              className="block w-full bg-[#2D5A3D] text-white rounded-xl py-3.5 font-semibold text-[15px] hover:opacity-90 transition-colors"
            >
              Let&apos;s go &rarr;
            </Link>
            {n.dismiss && (
              <button
                type="button"
                onClick={() => { localStorage.setItem(n.dismiss!.lsKey, "1"); forceUpdate(prev => prev + 1); }}
                className="text-[12px] text-[#b5aca4] hover:text-[#7a6f65] transition-colors mt-3"
              >
                {n.dismiss.label}
              </button>
            )}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          CAME BACK STATE — soft amber nudge if lessons unchecked after 2pm
         ═══════════════════════════════════════════════════════════ */}
      {hasAnyLessons && lessons.length > 0 && completedToday === 0 && new Date().getHours() >= 14 && isSchoolDay && !activeVacation && (
        <Link
          href="/dashboard/plan"
          className="flex items-center gap-3 px-4 py-3 rounded-[14px] transition-colors hover:opacity-90"
          style={{ backgroundColor: "#FFFBF0", border: "1px solid #E8D58A" }}
        >
          <span className="text-lg shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#7a4a1a]">{totalToday} lesson{totalToday !== 1 ? "s were" : " was"} scheduled today</p>
            <p className="text-[11px] text-[#b5944a]">No pressure — pick up in Plan →</p>
          </div>
        </Link>
      )}

      {/* ── Family Activity Banner ─────────────────────────────── */}
      {familyNotifs.length > 0 && !familyNotifsDismissed && (
        <div className="relative bg-[#e8f5ea] border border-[#b8d9bc] rounded-2xl px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={dismissFamilyNotifs}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/60 flex items-center justify-center text-[#7a6f65] hover:bg-white transition-colors text-xs"
            aria-label="Dismiss"
          >
            ✕
          </button>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--g-deep)] mb-1">Family Activity</p>
          {familyNotifs.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (n.memory_id) router.push(`/dashboard/memories?highlight=${n.memory_id}`);
              }}
              className="flex items-start gap-2 w-full text-left hover:bg-[#d4e8d4]/40 rounded-lg px-2 py-1.5 transition-colors"
            >
              <span className="text-sm shrink-0">{n.type === "reaction" ? (n.emoji ?? "❤️") : "💬"}</span>
              <span className="text-[13px] text-[#2d2926] leading-snug flex-1">{n.type === "reaction" ? `${n.actor_name} reacted ${n.emoji ?? "❤️"}` : `${n.actor_name} left a comment 💬`}</span>
              <span className="text-[#5c7f63] text-xs shrink-0">→</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Photo limit nudge — free users with 45+ photos, once per session ── */}
      {(!planType || planType === "free") && totalPhotos >= 45 && totalPhotos < 50 && (() => {
        if (typeof window !== "undefined" && sessionStorage.getItem("rooted_photo_limit_shown")) return null;
        if (typeof window !== "undefined") sessionStorage.setItem("rooted_photo_limit_shown", "1");
        return (
          <Link
            href="/upgrade"
            className="block bg-[#faf6f0] border border-[#e8e2d9] rounded-xl px-4 py-3 text-sm text-[#7a6f65] hover:bg-[#f5f0e8] transition-colors"
          >
            You&apos;re almost at your 50 photo limit — upgrade to keep capturing memories →
          </Link>
        );
      })()}

      {/* Appointments section removed — merged into unified timeline above */}

      {/* ═══════════════════════════════════════════════════════════
          MY LISTS — collapsible inline lists
         ═══════════════════════════════════════════════════════════ */}
      {!loading && lists.length > 0 && (
        <ListsSection lists={lists} onListsChanged={loadData} getToken={getToken} />
      )}

      {/* ═══════════════════════════════════════════════════════════
          TODAY'S STORY — all memories logged today
         ═══════════════════════════════════════════════════════════ */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2 px-0.5">Today&apos;s Story</p>

        {todayStory.length > 0 ? (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {todayStory.map((m) => {
              const typeIcons: Record<string, string> = { photo: "📸", drawing: "🎨", win: "🏆", quote: "🏆", book: "📖", field_trip: "🗺️", project: "🔬", activity: "🎵" };
              const typeBgs: Record<string, string> = { win: "#f0e8f4", quote: "#f0e8f4", book: "#fef8ee", drawing: "#e8f0f8", field_trip: "#e8f5ea", project: "#e8f5ea" };
              const icon = typeIcons[m.type] ?? "🌿";
              const child = m.child_id ? children.find((c) => c.id === m.child_id) : null;
              const ago = (() => {
                const diff = Math.round((Date.now() - new Date(m.created_at).getTime()) / 60000);
                if (diff < 1) return "just now";
                if (diff < 60) return `${diff}m ago`;
                const hrs = Math.round(diff / 60);
                return `${hrs}h ago`;
              })();
              const typeLabel = m.type === "field_trip" ? "Trip" : m.type === "quote" ? "Moment" : m.type.charAt(0).toUpperCase() + m.type.slice(1);

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
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#faf8f5] transition-colors"
                >
                  {/* Thumbnail */}
                  {m.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photo_url} alt="" className="w-[42px] h-[42px] rounded-lg object-cover shrink-0" />
                  ) : (
                    <div
                      className="w-[42px] h-[42px] rounded-lg flex items-center justify-center shrink-0 text-lg"
                      style={{ backgroundColor: typeBgs[m.type] ?? "#f0ede8" }}
                    >{icon}</div>
                  )}
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#2d2926] truncate">
                      {m.title || (m.type === "photo" ? "Photo" : typeLabel)}
                    </p>
                    <p className="text-[10px] text-[#9a8f85] truncate">{typeLabel}{child ? ` · ${child.name}` : ""}</p>
                  </div>
                  {/* Time */}
                  <span className="text-[10px] text-[#c8bfb5] shrink-0">{ago}</span>
                  {/* Favorite heart */}
                  <span className="text-[#e0dbd5] text-sm shrink-0 ml-1">♡</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl py-8 text-center">
            <span className="text-3xl">{totalMemories === 0 ? "📷" : "🌿"}</span>
            <p className="text-[13px] font-medium text-[#2d2926] mt-2">
              {totalMemories === 0 ? "Today\u2019s Story" : "Nothing captured yet today"}
            </p>
            <p className="text-[11px] text-[#9a8f85] mt-0.5 max-w-[260px] mx-auto">
              {totalMemories === 0
                ? "Capture a memory and it\u2019ll show up here \u2014 a photo, a win, a moment from your day."
                : "When you capture a memory, it shows up here as part of your day\u2019s story."}
            </p>
          </div>
        )}
        {todayStory.length > 0 && (
          <Link href="/dashboard/memories" className="block text-center text-xs text-[#5c7f63] font-medium mt-2 hover:underline">
            See all memories →
          </Link>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          YEARBOOK NUDGE — slim card, once per week
         ═══════════════════════════════════════════════════════════ */}
      {yearbookCount > 0 && (() => {
        const lastShown = typeof window !== "undefined" ? localStorage.getItem("yearbook_nudge_shown") : null;
        const now2 = new Date();
        const ws = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() - now2.getDay());
        const wk = ws.toISOString().slice(0, 10);
        if (lastShown === wk) return null;
        return (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2 px-0.5">Your Yearbook</p>
            <button
              onClick={() => { localStorage.setItem("yearbook_nudge_shown", wk); router.push("/dashboard/memories/yearbook"); }}
              className="w-full bg-white border border-[#e8e5e0] rounded-2xl p-4 flex items-center gap-3 text-left hover:bg-[#faf9f7] transition-colors"
            >
              <span className="text-xl">📗</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#2D2A26]">{yearbookCount} memor{yearbookCount === 1 ? "y" : "ies"} so far this year</p>
                <p className="text-[11px] text-[#8B7E74]">Tap to open your family yearbook →</p>
              </div>
              <span className="text-[#8B7E74] text-sm">›</span>
            </button>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          ON THIS DAY — purple card, show only for Tier 1 or 2 matches (1+ year)
         ═══════════════════════════════════════════════════════════ */}
      {onThisDayMemory && onThisDayTier <= 2 && (
        <div>
          <div
            className="overflow-hidden"
            style={{ backgroundColor: "#F0EAF8", border: "1px solid #D4B8E8", borderRadius: 14, padding: "14px 16px" }}
          >
            <p style={{ fontSize: 9, fontWeight: 700, color: "#8B6CAF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              ON THIS DAY · {onThisDayTier === 1 ? "1 YEAR AGO" : (safeParseDateStr(onThisDayMemory.date)?.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase() ?? "")}
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#4A2A6A", marginBottom: 8 }}>
              {onThisDayMemory.title ?? "A memory from this time last year"}
            </p>
            {onThisDayMemory.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={onThisDayMemory.photo_url} alt=""
                className="w-full object-cover rounded-lg mb-2"
                style={{ height: 68 }}
              />
            )}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: "#E0D0F0", color: "#6B4E8A" }}>
                🔄 Full circle
              </span>
              <button
                type="button"
                onClick={() => {
                  setLightboxMemory({
                    id: onThisDayMemory.id,
                    title: onThisDayMemory.title ?? "Memory",
                    photo_url: onThisDayMemory.photo_url,
                    date: onThisDayMemory.date,
                    type: "photo",
                  });
                }}
                className="text-[10px] font-semibold hover:underline"
                style={{ color: "#8B6CAF" }}
              >
                View memory →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          FILE INPUT — always rendered for capture flow
         ═══════════════════════════════════════════════════════════ */}
      {!isPartner && (
        <>
          <input
            ref={captureFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setShowCaptureMenu(false);
              setShowMemoryPicker(false);
              try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) { console.error("[Photo capture] No user session"); return; }
                const compressed = await compressImage(file);
                const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
                const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
                if (upErr) { console.error("[Photo capture] Upload failed:", upErr.message); showCaptureToast("Upload failed — try again", null); return; }
                const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
                const memType = captureTypeRef.current;
                const now = new Date().toISOString();
                const { data: ins, error: insErr } = await supabase.from("memories").insert({
                  user_id: user.id, type: memType, title: '',
                  photo_url: urlData.publicUrl, child_id: null,
                  date: today, include_in_book: false,
                  created_at: now, updated_at: now,
                }).select("id").single();
                if (insErr) { console.error("[Photo capture] Insert failed:", insErr.message, insErr.code, insErr.details); showCaptureToast("Save failed — try again", null); return; }
                console.log("[Rooted] Saved:", memType, ins);
                const toastMsg = memType === "drawing" ? "🎨 Drawing saved 🌿" : "📸 Memory saved 🌿";
                showCaptureToast(toastMsg, (ins as { id: string } | null)?.id ?? null, memType, null);
                captureTypeRef.current = "photo"; // reset
                setTotalMemories(prev => prev + 1);
                await loadData();
                checkAndAwardBadges(user.id);
              } finally {
                if (e.target) e.target.value = "";
              }
            }}
          />
        </>
      )}

      <div className="h-2" />

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
              {safeParseDateStr(lightboxMemory.date)?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) ?? "Unknown date"}
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

      {/* ── Discard confirmation ──────────────────────────── */}
      {discardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setDiscardConfirm(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-[#fefcf9] rounded-2xl p-6 mx-6 max-w-xs shadow-xl text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-medium text-[#2d2926] mb-1">Discard this memory?</p>
            <p className="text-sm text-[#7a6f65] mb-5">Your changes will be lost.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDiscardConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-[#e8e2d9] text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={discardConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lesson check-off time confirmation ────────────── */}
      {checkOffLesson && (() => {
        const { lesson, defaultMinutes } = checkOffLesson;
        const child = children.find(c => c.id === lesson.child_id);
        const pills = [15, 30, 45, 60];
        const selectedMins = checkOffShowCustom ? (parseInt(checkOffCustom, 10) || 0) : checkOffMinutes;
        return (
          <>
            <div
              className={`fixed inset-0 bg-black/30 z-50 transition-opacity duration-300 ${checkOffVisible ? "opacity-100" : "opacity-0"}`}
              onClick={closeCheckOffModal}
            />
            <div
              className={`fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl transition-transform duration-300 ${checkOffVisible ? "translate-y-0" : "translate-y-full"}`}
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              <div className="px-6 pb-9 pt-7">
                {/* Handle bar */}
                <div className="w-9 h-1 rounded-full bg-[#d5d0ca] mx-auto mb-5" />

                {/* Checkmark */}
                <p className="text-4xl text-center mb-3">✅</p>

                {/* Lesson title */}
                <p className="text-xl font-bold text-[#2d2926] text-center mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  {lesson.title}
                </p>

                {/* Child + date */}
                <p className="text-sm text-[#7a6f65] text-center mb-5">
                  {child?.name ?? ""}{child ? " · " : ""}{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>

                {/* Duration label */}
                <p className="text-xs uppercase tracking-wide text-[#7a6f65] font-semibold text-center mb-3">
                  How long did this actually take?
                </p>

                {/* Duration pills */}
                <div className="flex gap-2 justify-center mb-2">
                  {pills.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setCheckOffMinutes(m); setCheckOffShowCustom(false); }}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                        !checkOffShowCustom && checkOffMinutes === m
                          ? "bg-[#2D5A3D] text-white border-[#2D5A3D]"
                          : "bg-white text-[#2d2926] border-[#e0ddd8] hover:border-[#c8c4be]"
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setCheckOffShowCustom(true); if (!checkOffCustom) setCheckOffCustom(String(defaultMinutes)); }}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                      checkOffShowCustom
                        ? "bg-[#2D5A3D] text-white border-[#2D5A3D]"
                        : "bg-white text-[#2d2926] border-[#e0ddd8] hover:border-[#c8c4be]"
                    }`}
                  >
                    Other
                  </button>
                </div>

                {/* Custom input */}
                {checkOffShowCustom && (
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <input
                      type="number"
                      value={checkOffCustom}
                      onChange={e => setCheckOffCustom(e.target.value)}
                      placeholder="Minutes"
                      className="w-24 text-center px-3 py-2 rounded-xl border border-[#e0ddd8] text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                      autoFocus
                    />
                    <span className="text-sm text-[#7a6f65]">min</span>
                  </div>
                )}

                {/* Helper text */}
                <p className="text-xs text-[#5c7f63] text-center mb-5">
                  {defaultMinutes} min is your default — change it if today was different
                </p>

                {/* Log it button */}
                <button
                  type="button"
                  onClick={() => confirmCheckOff(selectedMins > 0 ? selectedMins : defaultMinutes)}
                  disabled={checkOffShowCustom && selectedMins <= 0}
                  className="w-full bg-[#2D5A3D] text-white rounded-xl py-3.5 font-semibold text-base transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  Log it ✓
                </button>

                {/* Quick check off */}
                <button
                  type="button"
                  onClick={() => confirmCheckOff(defaultMinutes)}
                  className="block w-full text-xs text-[#b5aca4] hover:text-[#7a6f65] text-center mt-3 transition-colors"
                >
                  Just check off (use default time)
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Log Something modal — replaces old capture menu ── */}
      {showCaptureMenu && (
        <LogSomethingModal
          onClose={() => setShowCaptureMenu(false)}
          onLogLesson={() => { setShowExtraLessons(true); posthog.capture('log_extra_lessons_opened', { source: 'log_modal', user_plan: isPro ? 'paid' : 'free' }); }}
          onLogActivity={() => { router.push("/dashboard/plan"); }}
          onAddAppointment={() => { setShowApptWizard(true); }}
          lists={lists}
          children={children}
          getToken={getToken}
          onListItemAdded={loadData}
        />
      )}

      {/* ── Memory Picker — direct capture bottom sheet ──── */}
      {showMemoryPicker && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowMemoryPicker(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl" style={{ maxWidth: 420, margin: "0 auto", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="flex items-center justify-between px-5 pb-2">
              <h2 className="text-[18px] font-medium text-[#2D2A26]">Capture a memory</h2>
              <button onClick={() => setShowMemoryPicker(false)} className="w-8 h-8 rounded-full bg-[#f2f0ec] flex items-center justify-center text-[#8B7E74] hover:bg-[#e8e5e0] text-sm transition-colors">✕</button>
            </div>
            <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center mx-4 mb-2">
              <span className="text-[12px] text-[#2D5A3D] font-medium">🌿 Every memory earns a leaf for your garden!</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5 px-4 pb-6">
              {([
                { emoji: "📸", label: "Photo",      sub: "Snap a moment",      action: () => { setShowMemoryPicker(false); captureTypeRef.current = "photo"; requestAnimationFrame(() => captureFileRef.current?.click()); } },
                { emoji: "🎨", label: "Drawing",    sub: "Save their art",     action: () => { setShowMemoryPicker(false); setShowDrawingSheet(true); } },
                { emoji: "🏆", label: "Win",        sub: "Celebrate a win",    action: () => { setShowMemoryPicker(false); setShowWinSheet(true); } },
                { emoji: "📖", label: "Book",       sub: "Log a read",         action: () => { setShowMemoryPicker(false); setShowBookModal(true); } },
                { emoji: "🗺️", label: "Field Trip", sub: "We went somewhere",  action: () => { setShowMemoryPicker(false); setFtType("field_trip"); setShowFieldTripSheet(true); } },
                { emoji: "🔨", label: "Project",    sub: "We made something",  action: () => { setShowMemoryPicker(false); setFtType("project"); setShowFieldTripSheet(true); } },
              ] as const).map(tile => (
                <button key={tile.label} onClick={tile.action}
                  className="flex flex-col items-center justify-center py-5 px-2.5 rounded-2xl border-[1.5px] border-[#e8e5e0] bg-[#fafaf8] hover:border-[#2D5A3D] hover:bg-[#f0f7f2] transition-colors text-center">
                  <span className="text-[28px] mb-1.5">{tile.emoji}</span>
                  <span className="text-[13px] font-medium text-[#2D2A26]">{tile.label}</span>
                  <span className="text-[10px] text-[#8B7E74]">{tile.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Appointment Wizard ────────────────────────────── */}
      <AppointmentWizard
        isOpen={showApptWizard}
        onClose={() => setShowApptWizard(false)}
        onSaved={loadData}
      />

      {/* ── Manage Schedule Modal ─────────────────────────── */}
      <ManageScheduleModal
        isOpen={showManageSchedule}
        onClose={() => setShowManageSchedule(false)}
        onAddAppt={() => setShowApptWizard(true)}
        onChanged={loadData}
        children={children}
      />

      {/* ── Extra lessons modal ────────────────────────────── */}
      {showExtraLessons && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowExtraLessons(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-[#fefcf9] rounded-t-2xl border-t border-[#e8e2d9] shadow-xl max-h-[75vh] flex flex-col" style={{ maxWidth: 480, margin: "0 auto" }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#f0ede8]">
              <h2 className="text-base font-bold text-[#2d2926]">Log extra lessons</h2>
              <button onClick={() => setShowExtraLessons(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {upcomingLessons.length === 0 ? (
                <p className="text-sm text-[#7a6f65] text-center py-8">No upcoming lessons in the next 14 days.</p>
              ) : (() => {
                // Group by child then show lessons
                const grouped = new Map<string, UpcomingLesson[]>();
                for (const l of upcomingLessons) {
                  const key = l.child_id ?? "__none__";
                  if (!grouped.has(key)) grouped.set(key, []);
                  grouped.get(key)!.push(l);
                }
                return Array.from(grouped.entries()).map(([childId, childLessons]) => {
                  const child = children.find(c => c.id === childId);
                  return (
                    <div key={childId} className="mb-5">
                      {child && <p className="text-xs font-semibold uppercase tracking-widest text-[#9a8f85] mb-2">{child.name}</p>}
                      <div className="space-y-1">
                        {childLessons.map(l => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => setExtraChecked(prev => { const n = new Set(prev); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                              extraChecked.has(l.id) ? "bg-[#e8f0e9] border border-[#c8ddb8]" : "bg-white border border-[#f0ede8] hover:border-[#e8e2d9]"
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                              extraChecked.has(l.id) ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5]"
                            }`}>
                              {extraChecked.has(l.id) && <span className="text-white text-[10px] font-bold">✓</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              {l.subjects && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mr-1" style={{ backgroundColor: l.subjects.color ? `${l.subjects.color}20` : "#e8f0e9", color: l.subjects.color ?? "#5c7f63" }}>
                                  {l.subjects.name}
                                </span>
                              )}
                              <span className="text-sm text-[#2d2926]">{l.title}</span>
                            </div>
                            <span className="text-[10px] text-[#b5aca4] shrink-0">
                              {new Date(l.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="px-5 py-4 border-t border-[#f0ede8]">
              <button
                onClick={confirmExtraLessons}
                disabled={extraChecked.size === 0 || savingExtra}
                className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {savingExtra ? "Saving..." : extraChecked.size === 0 ? "Select lessons to log" : `Log ${extraChecked.size} lesson${extraChecked.size !== 1 ? "s" : ""} as done`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Field trip / project sheet ────────────────────── */}
      {showFieldTripSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => {
            if (ftTitle.trim() || ftNote.trim()) { setDiscardConfirm(() => () => { setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild(""); setDiscardConfirm(null); }); return; }
            setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild("");
          }} />
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
                {([["field_trip", "🗺️ Field trip"], ["project", "🔬 Project"]] as const).map(([val, label]) => (
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
            {/* Time spent (optional) */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#7a6f65] shrink-0">Time spent — logged in your Hours &amp; Attendance Log</label>
              <input type="number" min="1" max="999" value={ftMinutes} onChange={(e) => setFtMinutes(e.target.value)}
                placeholder="e.g. 45"
                className="w-20 px-2.5 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] text-center" />
              <span className="text-xs text-[#b5aca4]">min</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowFieldTripSheet(false); setFtTitle(""); setFtNote(""); setFtChild(""); setFtMinutes(""); }}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button
                disabled={ftSaving || !ftTitle.trim()}
                onClick={async () => {
                  setFtSaving(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    const nowFt = new Date().toISOString();
                    const { data: ins, error: ftErr } = await supabase.from("memories").insert({
                      user_id: user.id, type: ftType, title: ftTitle.trim(),
                      caption: ftNote.trim() || null, child_id: ftChild || null,
                      date: today, include_in_book: false,
                      ...(ftMinutes ? { duration_minutes: parseInt(ftMinutes) } : {}),
                      created_at: nowFt, updated_at: nowFt,
                    }).select("id").single();
                    if (ftErr) { console.error("[Rooted] Field trip save failed:", ftErr.message); setFtSaving(false); showCaptureToast("Save failed — try again", null); return; }
                    console.log("[Rooted] Saved:", ftType, ins);
                    const toastMap: Record<string, string> = { field_trip: "🗺️ Field trip logged 🌿", project: "🔬 Project logged 🌿" };
                    posthog.capture('field_trip_logged', { type: ftType, user_plan: isPro ? 'paid' : 'free' });
                    showCaptureToast(toastMap[ftType] ?? "🌿 Saved!", (ins as { id: string } | null)?.id ?? null, ftType, ftChild || null);
                    checkAndAwardBadges(user.id);
                    onLogAction({ userId: user.id, childId: ftChild || undefined, actionType: ftType as "field_trip" | "project" });
                  }
                  setFtSaving(false); setShowFieldTripSheet(false);
                  setFtTitle(""); setFtNote(""); setFtChild(""); setFtMinutes("");
                  await loadData();
                }}
                className="flex-1 py-3.5 rounded-xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-semibold transition-colors">
                {ftSaving ? "Saving…" : ftType === "project" ? "Save Project 🌿" : "Save Field Trip 🌿"}
              </button>
            </div>
            {/* Leaf hint */}
            <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center mt-3">
              <span className="text-[12px] text-[#2D5A3D] font-medium">🌿 Earns a leaf for your garden!</span>
            </div>
            </div>
          </div>
        </>
      )}

      {/* ── Book sheet ────────────────────────────────────── */}
      {showBookModal && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => {
            if (bookTitle.trim() || bookAuthor.trim()) { setDiscardConfirm(() => () => { setShowBookModal(false); setBookTitle(""); setBookAuthor(""); setBookChild(""); setDiscardConfirm(null); }); return; }
            setShowBookModal(false); setBookTitle(""); setBookAuthor(""); setBookChild("");
          }} />
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
              {/* Author */}
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Author (optional)</label>
                <input value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} placeholder="e.g. E.B. White"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              </div>
              {/* Pages + Child in a row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Pages (optional)</label>
                  <input value={bookPages} onChange={(e) => setBookPages(e.target.value)} type="number" min="1" placeholder="e.g. 192"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
                </div>
                {children.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Who read it?</label>
                    <select value={bookChild} onChange={(e) => setBookChild(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                      <option value="">Everyone</option>
                      {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {/* Cover photo */}
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Cover photo (optional)</label>
                <input ref={bookPhotoRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (e.target) e.target.value = "";
                    if (f) { setBookPhotoFile(f); setBookPhotoPreview(URL.createObjectURL(f)); }
                  }}
                />
                {bookPhotoPreview ? (
                  <div className="relative w-20 h-28 rounded-xl overflow-hidden border border-[#e8e2d9]">
                    <img src={bookPhotoPreview} alt="Cover" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => { setBookPhotoFile(null); setBookPhotoPreview(null); }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/40 flex items-center justify-center text-white text-[10px]">✕</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => bookPhotoRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-[#d8d2c9] bg-[#faf9f7] hover:border-[#5c7f63] text-xs text-[#7a6f65] transition-colors">
                    📷 Add cover photo
                  </button>
                )}
              </div>
              <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center">
                <span className="text-[12px] text-[#2D5A3D] font-medium">🌿 Earns a leaf for your garden!</span>
              </div>
              <button onClick={saveBook} disabled={savingBook || !bookTitle.trim()}
                className="w-full py-3.5 rounded-xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-semibold transition-colors">
                {savingBook ? "Saving…" : "Log Book 🌿"}
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
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Minutes spent (optional)</label>
              <input value={editHours} onChange={(e) => setEditHours(e.target.value)} type="number" min="1" max="999" placeholder="e.g. 30"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingLesson(null)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-medium transition-colors">
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
              className="w-full py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
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
          <div className="bg-[var(--g-deep)] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">
            Saved to Memories 🌱
          </div>
        </div>
      )}

      {/* ── Garden growth toast ───────────────────────────── */}
      {gardenToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <div className="bg-[var(--g-deep)] text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 whitespace-nowrap animate-bounce-once">
            <span>🌿</span>
            <span>{gardenToast.name === "Your garden" ? "Your garden just grew a leaf!" : `${gardenToast.name}'s tree just grew a leaf!`}</span>
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
            <button onClick={() => setShowPwaModal(false)} className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors">Got it!</button>
          </div>
        </div>
      )}

      {/* ── Log a Win Sheet ──────────────────────────────────── */}
      {/* ── Log a Drawing Sheet ──────────────────────────── */}
      {showDrawingSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => {
            if (drawingTitle.trim() || drawingFile) { setDiscardConfirm(() => () => { setShowDrawingSheet(false); setDrawingFile(null); setDrawingPreview(null); setDrawingTitle(""); setDrawingChild(""); setDiscardConfirm(null); }); return; }
            setShowDrawingSheet(false); setDrawingFile(null); setDrawingPreview(null); setDrawingTitle(""); setDrawingChild("");
          }} />
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
                <input ref={drawingFileRef} type="file" accept="image/*" className="hidden"
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
              <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center">
                <span className="text-[12px] text-[#2D5A3D] font-medium">🌿 Earns a leaf for your garden!</span>
              </div>
              <button onClick={saveDrawing} disabled={savingDrawing || !drawingTitle.trim()}
                className="w-full py-3.5 rounded-xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-semibold transition-colors">
                {savingDrawing ? "Saving…" : "Save Drawing 🌿"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Capture toast with Edit shortcut ──────────────── */}
      {captureToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap flex items-center gap-3">
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

      {/* ── First memory magic moment toast ─────────────── */}
      {firstMemoryToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] toast-slide-up">
          <div className="bg-[var(--g-brand)] text-white px-6 py-3.5 rounded-full shadow-lg flex items-center gap-3">
            <span className="text-lg">🌿</span>
            <div>
              <p className="text-sm font-semibold">{firstMemoryToast}</p>
              <p className="text-xs text-white/70">Every memory and lesson grows it more.</p>
            </div>
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
                className="w-full py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-semibold transition-colors">
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

      {/* ── Reschedule bottom sheet ──────────────────────── */}
      {rescheduleLesson && (() => {
        const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
        const tmrwStr = localDateStr(tmrw);
        const tmrwLabel = tmrw.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
        const curricName = rescheduleLesson.title?.replace(/ — Lesson.*$/, "") ?? "";
        return (
          <>
            <div className="fixed inset-0 bg-black/30 z-[80]" onClick={() => setRescheduleLesson(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto">
              <div className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-[var(--g-deep)]" style={{ fontFamily: "var(--font-display)" }}>
                    Reschedule {rescheduleLesson.title || "this lesson"}
                  </h3>
                  <button onClick={() => setRescheduleLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none p-1">✕</button>
                </div>
                {/* Options */}
                <div className="space-y-3">
                  {/* Move to tomorrow */}
                  <button
                    onClick={() => rescheduleMoveTo(tmrwStr)}
                    className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                  >
                    <span className="text-lg shrink-0">📅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2d3a2e]">Move to tomorrow</p>
                      <p className="text-xs text-[#9a8e84] mt-0.5">Lesson moves to {tmrwLabel}</p>
                    </div>
                    <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                  </button>

                  {/* Move to specific day */}
                  <div>
                    <button
                      onClick={() => setReschedulePicker(v => !v)}
                      className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                    >
                      <span className="text-lg shrink-0">🗓</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2d3a2e]">Move to a specific day</p>
                        <p className="text-xs text-[#9a8e84] mt-0.5">Pick any date from the calendar</p>
                      </div>
                      <span className="text-[#c8bfb5] text-base shrink-0">{reschedulePicker ? "⌄" : "›"}</span>
                    </button>
                    {reschedulePicker && (
                      <div className="flex items-center gap-2 mt-2 px-1">
                        <input
                          type="date"
                          min={today}
                          value={reschedulePickerDate}
                          onChange={(e) => setReschedulePickerDate(e.target.value)}
                          className="flex-1 text-sm border border-[#e8e2d9] rounded-xl px-3 py-2.5 text-[#2d2926] bg-white"
                        />
                        <button
                          onClick={() => { if (reschedulePickerDate && reschedulePickerDate >= today) rescheduleMoveTo(reschedulePickerDate); }}
                          disabled={!reschedulePickerDate || reschedulePickerDate < today}
                          className="px-5 py-2.5 bg-[#5c7f63] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-[var(--g-deep)] transition-colors"
                        >
                          Move
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Curriculum-specific options */}
                  {rescheduleLesson.curriculum_goal_id && (
                    <>
                      {/* Push all remaining */}
                      <button
                        onClick={() => reschedulePushAll()}
                        className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                      >
                        <span className="text-lg shrink-0">⏭</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#2d3a2e]">Push all remaining lessons back one day</p>
                          <p className="text-xs text-[#9a8e84] mt-0.5">Shifts every upcoming {curricName || "curriculum"} lesson by one school day</p>
                        </div>
                        <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                      </button>

                      {/* Double up tomorrow */}
                      <button
                        onClick={() => rescheduleDoubleUp()}
                        className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                      >
                        <span className="text-lg shrink-0">2️⃣</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#2d3a2e]">Double up tomorrow</p>
                          <p className="text-xs text-[#9a8e84] mt-0.5">Do 2 lessons on {tmrwLabel.split(",")[0]} — stay on track</p>
                        </div>
                        <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                      </button>
                    </>
                  )}

                  {/* We missed a whole day — always show */}
                  {lessons.length > 0 && (
                    <button
                      onClick={() => rescheduleMissedDay()}
                      className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                    >
                      <span className="text-lg shrink-0">🏠</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2d3a2e]">We missed a whole day</p>
                        <p className="text-xs text-[#9a8e84] mt-0.5">Move ALL of today&apos;s lessons to the next school day for each curriculum</p>
                      </div>
                      <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                    </button>
                  )}
                </div>
              </div>
              {/* Bottom safe area */}
              <div className="h-6" />
            </div>
          </>
        );
      })()}

      {/* ── Reschedule undo toast ──────────────────────────── */}
      {rescheduleUndoToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-lg flex items-center gap-3">
            <span>{rescheduleUndoToast.message}</span>
            <button
              onClick={() => undoReschedule()}
              className="text-white font-semibold underline text-sm"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      <FloatingLeaves active={celebrating} />

      {/* All-done celebration overlay */}
      {allDoneCelebration && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setAllDoneCelebration(false)}>
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl max-w-xs mx-4">
            <span className="text-5xl block mb-3">🎉</span>
            <p className="text-lg font-medium text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
              {["You crushed today!", "Another day in the books!", "Homeschool hero!", "Amazing day, mama!"][Math.floor(Math.random() * 4)]}
            </p>
            <p className="text-sm text-[#7a6f65]">Everything done for the day</p>
          </div>
        </div>
      )}

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

      {/* ── Time pill toast ─────────────────────────── */}
      {timePill && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-lg flex items-center gap-2">
            {timePillEdit ? (
              <>
                <span className="text-xs text-white/70">Time spent:</span>
                <input
                  type="number" min="1" max="999" value={timePillValue}
                  onChange={(e) => setTimePillValue(e.target.value)}
                  className="w-14 px-2 py-0.5 rounded-lg bg-white/20 text-white text-sm text-center border-none focus:outline-none focus:ring-1 focus:ring-white/40"
                  autoFocus
                />
                <span className="text-xs text-white/70">min</span>
                <button
                  onClick={async () => {
                    const mins = parseInt(timePillValue) || timePill.minutes;
                    await supabase.from("lessons").update({ minutes_spent: mins }).eq("id", timePill.lessonId);
                    setTimePill(null);
                  }}
                  className="text-xs font-semibold bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-lg transition-colors"
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <span>{timePill.minutes} min logged</span>
                <button
                  onClick={() => { if (timePillTimer.current) clearTimeout(timePillTimer.current); setTimePillEdit(true); }}
                  className="text-xs text-white/70 hover:text-white transition-colors"
                >
                  · adjust ✏️
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Log a Win Sheet ──────────────────────────── */}
      {showWinSheet && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => {
            if (winText.trim()) { setDiscardConfirm(() => () => { setShowWinSheet(false); setWinText(""); setWinChild(""); setWinMinutes(""); setDiscardConfirm(null); }); return; }
            setShowWinSheet(false); setWinText(""); setWinChild(""); setWinMinutes("");
          }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[#2d2926]">{winType === "win" ? "🏆 Log a Win" : "💛 Capture a Moment"}</h2>
                <button onClick={() => { setShowWinSheet(false); setWinText(""); setWinChild(""); }} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
              </div>

              {/* Type pills */}
              <div className="flex gap-2">
                <button onClick={() => setWinType("win")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "win" ? "bg-[var(--g-brand)] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  🏆 Win
                </button>
                <button onClick={() => setWinType("quote")}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${winType === "quote" ? "bg-[var(--g-brand)] text-white" : "bg-[#f0ede8] text-[#7a6f65]"}`}>
                  ✍️ Moment
                </button>
              </div>

              {/* Text input + mic */}
              <div className="relative">
                <textarea
                  value={winText}
                  onChange={(e) => setWinText(e.target.value)}
                  placeholder={winType === "win" ? "What did they accomplish today?" : "What do you want to remember?"}
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

              {/* Time spent (optional) */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#7a6f65] shrink-0">Time spent — logged in your Hours &amp; Attendance Log</label>
                <input type="number" min="1" max="999" value={winMinutes} onChange={(e) => setWinMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  className="w-20 px-2.5 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] text-center" />
                <span className="text-xs text-[#b5aca4]">min</span>
              </div>

              {/* Save button */}
              <button
                onClick={async () => {
                  if (!winText.trim()) return;
                  setSavingWin(true);
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) { setSavingWin(false); return; }
                    console.log("[Win save] user:", user.id, "winText:", winText.trim(), "winType:", winType, "childId:", winChild);
                    const nowW = new Date().toISOString();
                    const { data: ins, error } = await supabase.from("memories").insert({
                      user_id: user.id,
                      child_id: winChild || null,
                      date: today,
                      type: winType,
                      title: winText.trim(),
                      ...(['win','quote'].includes(winType) ? { include_in_book: true } : { include_in_book: false }),
                      ...(winMinutes ? { duration_minutes: parseInt(winMinutes) } : {}),
                      created_at: nowW, updated_at: nowW,
                    }).select("id").single();
                    console.log("[Win save] result:", { data: ins, error });
                    if (error) {
                      console.error("[Win save] FAILED:", error.message, error.code, error.details, error.hint);
                      showCaptureToast("Save failed — try again", null);
                      setSavingWin(false);
                      return;
                    }
                    if (!ins) {
                      console.error("[Win save] No data returned — likely RLS policy blocking insert. Check that 'Users can insert own memories' policy exists on memories table.");
                      showCaptureToast("Save failed — try again", null);
                      setSavingWin(false);
                      return;
                    }
                    console.log("[Rooted] Saved:", winType, ins);
                    setTotalMemories(prev => prev + 1);
                    posthog.capture('win_logged', { type: winType, user_plan: isPro ? 'paid' : 'free' });
                    const msg = winType === "win" ? "🏆 Win captured! 🌿" : "✍️ Moment saved 🌿";
                    showCaptureToast(msg, (ins as { id: string } | null)?.id ?? null, winType, winChild || null);
                    checkAndAwardBadges(user.id);
                    onLogAction({ userId: user.id, childId: winChild || undefined, actionType: winType as "win" | "quote" });
                    setSavingWin(false);
                    setWinText("");
                    setWinChild("");
                    setWinMinutes("");
                    setShowWinSheet(false);
                    await loadData();
                  } catch (err) {
                    console.error("Win save error:", err);
                    showCaptureToast("Save failed — try again", null);
                    setSavingWin(false);
                  }
                }}
                disabled={savingWin || !winText.trim()}
                className="w-full py-3.5 rounded-xl bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 text-white text-[15px] font-semibold transition-colors"
              >
                {savingWin ? "Saving..." : "Save Win 🌿"}
              </button>
              <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center mt-3">
                <span className="text-[12px] text-[#2D5A3D] font-medium">🌿 Earns a leaf for your garden!</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Running Late modal ──────────────────────────────────── */}
      {showRunningLate && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setShowRunningLate(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>Running late?</h2>
                <p className="text-sm text-[#7a6f65] mt-1">Push remaining items forward. We&apos;ll adjust today&apos;s schedule.</p>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">Shift everything by</label>
                <div className="flex flex-wrap gap-2">
                  {[{ label: "15m", mins: 15 }, { label: "30m", mins: 30 }, { label: "1hr", mins: 60 }, { label: "2hr", mins: 120 }].map(({ label, mins }) => (
                    <button key={mins} type="button"
                      onClick={() => { setShiftMinutes(mins); setIsCustomShift(false); }}
                      className={`rounded-[10px] px-4 py-2.5 text-sm font-medium border transition-colors ${
                        !isCustomShift && shiftMinutes === mins
                          ? "bg-[#2D5A3D] text-white border-[#2D5A3D]"
                          : "bg-white border-[#e0ddd8] text-[#5c6b62]"
                      }`}
                    >{label}</button>
                  ))}
                  <button type="button"
                    onClick={() => { setIsCustomShift(true); setCustomShiftValue(""); }}
                    className={`rounded-[10px] px-4 py-2.5 text-sm font-medium transition-colors ${
                      isCustomShift
                        ? "border border-solid bg-[#2D5A3D] text-white"
                        : "border border-dashed border-[#e0ddd8] text-[#7a6f65]"
                    }`}
                  >Custom</button>
                </div>
                {isCustomShift && (
                  <input value={customShiftValue} onChange={(e) => { setCustomShiftValue(e.target.value); const v = parseInt(e.target.value); if (v > 0) setShiftMinutes(v); }}
                    type="number" min="1" max="480" placeholder="Minutes"
                    className="mt-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
                )}
              </div>

              {/* Preview */}
              <div className="bg-[#faf9f7] rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#b5aca4] mb-1">Preview</p>
                {todayActivities.filter(a => !a.completed && a.scheduled_start_time).slice(0, 3).map(a => {
                  const orig = parseTimeToMinutes(a.scheduled_start_time);
                  const shifted = orig != null ? orig + shiftMinutes : null;
                  return (
                    <div key={a.id} className="flex items-center gap-2 text-xs text-[#7a6f65]">
                      <span className="text-[#b5aca4]">{orig != null ? formatTime(orig) : "—"}</span>
                      <span>→</span>
                      <span className="text-[#2d2926] font-medium">{shifted != null && shifted < 1440 ? formatTime(shifted) : "Flexible"}</span>
                      <span className="truncate">{a.emoji} {a.name}</span>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setTimeShiftOffset(prev => prev + shiftMinutes);
                  setShowRunningLate(false);
                }}
                className="w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors"
              >
                Shift schedule →
              </button>

              <button
                type="button"
                onClick={() => { setShowRunningLate(false); skipRestOfToday(); }}
                className="w-full text-center"
              >
                <span className="text-xs text-[#b8860b] font-medium">Skip the rest of today</span>
                <span className="block text-[10px] text-[#b5aca4] mt-0.5">Undone items push to the next school day</span>
              </button>
            </div>
          </div>
        </>
      )}

      </div>
    </>
  );
}
