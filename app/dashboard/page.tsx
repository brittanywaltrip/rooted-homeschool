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
import { recomputeCurrentLesson, toDateStr, buildLessonDateSnapshot, createInFlightGate, computeTodayLessons, computeGapLessonsForGoal, computeNextLessonsForGoal, planRescheduleLessons, isQueueEnabled, syncProjectedScheduledDates, type LessonDateSnapshot, type InFlightGate, type CurriculumGoalConfig, type ProjectedLesson, type VacationBlock as SchedVacationBlock } from "@/app/lib/scheduler";
import { todayInTz, addDays as addDaysYmd, startOfDayInTzAsUtc } from "@/app/lib/timezone";
// TODO: remove after queue scheduling verified in production. Old pinned-date
// reschedule planners — only consumed by dead functions kept for rollback.
import { planAddToNextSchoolDays as libPlanAddToNextSchoolDays, planPushBackNDays as libPlanPushBackNDays } from "@/app/lib/scheduler";
import { buildPushBackMessage } from "@/app/lib/pushback-message";
import { recomputeStaleStreak } from "@/app/lib/streaks";
import { compressImage } from "@/lib/compress-image";
import { signedPhotoUrl } from "@/lib/photo-url";
import SignedImage from "@/components/SignedImage";
import { useDashboardLayout } from "@/lib/dashboard-layout-context";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { useLeafAnimationContext } from "@/app/contexts/LeafAnimationContext";
import ListsSection from "@/app/components/ListsSection";
import AppointmentWizard from "@/app/components/AppointmentWizard";
import ManageScheduleModal from "@/app/components/ManageScheduleModal";
import TodaySchedule from "@/app/components/today/TodaySchedule";
import MissedLessonRecoveryModal, { type MissedEntry, type MissedGoal } from "@/app/components/MissedLessonRecoveryModal";
import TodayKidSection from "@/app/components/today/TodayKidSection";
import InlineScheduleTabs from "@/app/components/today/InlineScheduleTabs";
import { groupItems } from "@/app/components/today/groupItems";
import { tintFromHex, darkenHex } from "@/lib/color-tint";
import { resolveLessonSubject } from "@/lib/lesson-subject";
import { getUserAccess, getTrialDaysLeft } from "@/lib/user-access";
import { useIsNativeApp } from "@/lib/platform";
import LogSomethingModal from "@/app/components/LogSomethingModal";
import GettingStartedCard from "@/app/components/GettingStartedCard";
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
  // Fallback subject source — populated even on goals whose lessons have
  // subject_id = NULL. Loaders join curriculum_goals(subject_label) so
  // every consumer can pass both into resolveLessonSubject().
  curriculum_goals?: { subject_label: string | null } | null;
  curriculum_goal_id?: string | null;
  lesson_number?: number | null;
  goal_id?: string | null;
  icon_emoji?: string | null;
  notes?: string | null;
  scheduled_date?: string | null;
  date?: string | null;
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
  const isNativeApp = useIsNativeApp();
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
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null);
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
  const [trialStartedAt,   setTrialStartedAt]   = useState<string | null>(null);
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
    const dismissed   = localStorage.getItem("pwa-banner-dismissed") === "true";
    const standalone  = window.matchMedia("(display-mode: standalone)").matches;
    const isCapacitor = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (!dismissed && !standalone && !isCapacitor) setShowPwaBanner(true);
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
  // Toast for any reschedule action. Snapshot contains the full prior state
  // of every row touched by the action (id + both date columns) — undo
  // performs a literal restore, never a recomputation. The same snapshot is
  // mirrored to a ref so the click handler reads a stable value even if a
  // re-render races with the tap.
  type RescheduleUndoToast = { message: string; snapshot: LessonDateSnapshot[] };
  const [rescheduleUndoToast,    setRescheduleUndoToast]    = useState<RescheduleUndoToast | null>(null);
  const rescheduleUndoSnapshotRef = useRef<RescheduleUndoToast | null>(null);
  const rescheduleUndoTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Idempotency gate: a single user click sometimes produced 2–4 firings of
  // the reschedule handler on production (root cause unconfirmed — possibly
  // mobile touch + click double-dispatch or a synthetic re-fire). Each
  // re-fire shifts dates further because each call reads the now-mutated
  // state. The gate makes every reschedule handler a strict one-shot until
  // a 1.5s cool-down elapses post-completion.
  const reschedulingGateRef = useRef<InFlightGate>(createInFlightGate());
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [pendingDelete,          setPendingDelete]          = useState<{ lesson: Lesson } | null>(null);
  const pendingDeleteTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lesson note editing (ported from Plan page for parity)
  const [editingNoteId,          setEditingNoteId]          = useState<string | null>(null);
  const [editingNoteText,        setEditingNoteText]        = useState("");
  const [noteSaveState,          setNoteSaveState]          = useState<"idle" | "saving" | "saved" | "error">("idle");
  const noteSaveTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTextareaRef          = useRef<HTMLTextAreaElement>(null);
  const [activeVacation,         setActiveVacation]         = useState<{ name: string; end_date: string } | null>(null);
  const [isSchoolDay,            setIsSchoolDay]            = useState(true);
  const [schoolDaysArr,          setSchoolDaysArr]          = useState<string[]>([]);
  const [schoolStartTime,        setSchoolStartTime]        = useState<string | null>(null);
  // memoryMoment removed — replaced by onThisDayMemory and lastMemory
  const [lightboxMemory, setLightboxMemory] = useState<{ id: string; title: string; photo_url: string | null; date: string; type: string } | null>(null);
  const [streak,                 setStreak]                 = useState(0);
  const [weekDots,               setWeekDots]               = useState<("done" | "partial" | "off" | "future")[]>([]);
  const [daysLearning,           setDaysLearning]           = useState<number | null>(null);
  const [familyPhotoUrl,         setFamilyPhotoUrl]         = useState<string | null>(null);
  const [allVacationBlocks,      setAllVacationBlocks]      = useState<{ name: string; start_date: string; end_date: string }[]>([]);
  const [totalMemories, setTotalMemories] = useState(0);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [curriculumGoalsCount, setCurriculumGoalsCount] = useState(0);
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
  const [showPhotoLimitModal, setShowPhotoLimitModal] = useState(false);
  type UpcomingLesson = { id: string; title: string; child_id: string; scheduled_date: string; curriculum_goal_id: string | null; lesson_number?: number | null; subjects: { name: string; color: string | null } | null; curriculum_goals?: { subject_label: string | null } | null };
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
  type ApptRow = { id: string; title: string; emoji: string; date: string; time: string | null; duration_minutes: number; location: string | null; child_ids: string[]; completed: boolean; instance_date: string; is_recurring: boolean };
  const [todayAppointments, setTodayAppointments] = useState<ApptRow[]>([]);
  const [showApptWizard, setShowApptWizard] = useState(false);
  const [showManageSchedule, setShowManageSchedule] = useState(false);
  const [allDoneCelebration, setAllDoneCelebration] = useState(false);
  // Recurring-occurrence completion confirmation. One-time appointments use
  // the existing PATCH /api/appointments toggle; recurring instances route
  // through this modal so the user explicitly opts into "just this date,
  // not the whole series" semantics.
  const [confirmCompleteAppt, setConfirmCompleteAppt] = useState<{ id: string; title: string; instance_date: string } | null>(null);

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

  // ── Missed lessons (incomplete, scheduled before today) ──────────────────
  // Past-dated incomplete rows are shown in a "From earlier" section above
  // today's schedule so mom can see what got missed. Reschedule actions are
  // always user-initiated (no silent rescheduling — see CC #1 redesign).
  type MissedLesson = Lesson & { scheduled_date: string | null; date: string | null };
  const [missedLessons, setMissedLessons] = useState<MissedLesson[]>([]);
  // school_days per goal id, used to pick the right calendar for each lesson
  // when the user opens "Reschedule these → Add to my next school day(s)".
  const [goalSchoolDaysMap, setGoalSchoolDaysMap] = useState<Map<string, string[]>>(new Map());
  // Per-goal count of lessons completed today (local-day window). Powers
  // the queue projector's "stable today slot" logic; consumers include
  // computeTodayLessons in loadData and the InlineScheduleTabs Upcoming
  // tab so tomorrow's projection starts at the correct lesson_number.
  const [completedTodayPerGoal, setCompletedTodayPerGoal] = useState<Map<string, number>>(new Map());
  // User's IANA timezone (e.g., "America/Los_Angeles") from profiles.timezone.
  // Falls back to America/New_York via the helpers when null. Set during
  // loadData so openExtraLessons + any other event handler can reuse it
  // without refetching the profile row.
  const [userTz, setUserTz] = useState<string | null>(null);
  const [showMissedSheet, setShowMissedSheet] = useState(false);
  const [missedSheetSubmitting, setMissedSheetSubmitting] = useState(false);

  // ── Missed Lesson Recovery modal (Path A queue scheduling) ────────────────
  // Shown on Today when overdueLessonCount > 0 and the sessionStorage flag
  // `rooted_missed_lesson_prompt_shown` is not set. Binary YES/NO: mark
  // missed lessons done on their gap dates, or leave them and let the queue
  // projector absorb them going forward from today.
  const [showMissedRecovery, setShowMissedRecovery] = useState(false);
  const [missedGoals, setMissedGoals] = useState<MissedGoal[]>([]);
  const [missedEntriesByGoal, setMissedEntriesByGoal] = useState<Map<string, MissedEntry[]>>(new Map());
  // Tracks whether the user has already seen / acted on the modal this
  // session. Gates both the modal and the "X lessons from earlier" banner.
  const [missedRecoveryDismissed, setMissedRecoveryDismissed] = useState(false);
  // Overdue lesson count for the Today-page indicator. Computed from the
  // queue-model gap between last completion and today; matches the catch-up
  // modal's per-goal projection but renders even when gap < 5 days. Stays 0
  // for brand-new users who have never completed a lesson so we don't
  // discourage them on day one.
  const [overdueLessonCount, setOverdueLessonCount] = useState(0);

  // Unconfirmed-prior-lesson prompts. A goal lands here when
  // current_lesson > 0 but the lesson row at queue_position = current_lesson
  // is missing or not flagged completed=true. Caused most often when the
  // Schedule Builder advances start_at_lesson without backfilling the
  // earlier slots (pre-2026-05-19 fix) or when the queue advances by some
  // path that does not stamp the row. Computed off the critical-path so
  // Today still renders normally for users with no unconfirmed work.
  type UnconfirmedGoal = {
    goal_id: string;
    curriculum_name: string;
    subject_label: string | null;
    current_lesson: number;
    child_id: string | null;
  };
  const [needsConfirmation, setNeedsConfirmation] = useState<UnconfirmedGoal[]>([]);
  const [confirmingGoalIds, setConfirmingGoalIds] = useState<Set<string>>(() => new Set());

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
    // activities.days is stored with Mon=0..Sun=6 (ActivitySetupModal convention).
    // JS getDay() returns Sun=0..Sat=6. Convert before comparing.
    const toMon0 = (jsDow: number) => (jsDow === 0 ? 6 : jsDow - 1);
    const todayDow = toMon0(new Date().getDay());
    const { data: actData } = await supabase
      .from("activities")
      .select("id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids, created_at, start_date, end_date")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true);
    if (!actData || actData.length === 0) { setTodayActivities([]); return; }

    const now = new Date();
    const filtered = (actData as { id: string; name: string; emoji: string; frequency: string; days: number[]; duration_minutes: number; scheduled_start_time: string | null; child_ids: string[]; created_at: string; start_date: string | null; end_date: string | null }[]).filter((a) => {
      if (a.start_date && today < a.start_date) return false;
      if (a.end_date && today > a.end_date) return false;
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
        const cursor = new Date(firstDay);
        while (cursor.getMonth() === now.getMonth()) {
          if (toMon0(cursor.getDay()) === todayDow) {
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

    // Belt and suspenders: reset profiles.current_streak_days to 0 when
    // last_logged_date is older than the previous school day. Fire-and-forget
    // — the Today UI computes its own live streak; this keeps the Garden
    // page and badge checker honest. longest_streak_days is untouched.
    recomputeStaleStreak(effectiveUserId);

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
    // Browser TZ is the ground truth for the user's actual location.
    // profiles.timezone was added 2026-05-03 with a DEFAULT of
    // America/New_York for all 1,747 existing rows and has never been
    // self-updated, so reading it as the source of truth is wrong for
    // anyone outside NY. Use the browser detection here, then self-heal
    // the stored column in the background once we know what it should
    // be.
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserTz(browserTz);

    // Profile fetched up front so the rest of loadData can read its
    // fields and so we can compare its stored timezone against the
    // browser-detected value for the self-heal write below.
    const profileResult = await supabase
      .from("profiles")
      .select("display_name, onboarded, school_days, school_year_start, family_photo_url, school_start_time, is_pro, plan_type, trial_started_at, created_at, timezone")
      .eq("id", effectiveUserId)
      .maybeSingle();
    const tzFromProfile = (profileResult.data as { timezone?: string | null } | null)?.timezone ?? null;

    // Self-heal: if profiles.timezone disagrees with the browser-detected
    // TZ, push an update in the background. Fire-and-forget so first paint
    // is never blocked. The constraint at profiles_timezone_format accepts
    // standard IANA strings; unusual values (e.g. "Etc/GMT+5") may bounce
    // — silently ignored, browserTz is still used in-page.
    if (browserTz && tzFromProfile !== browserTz) {
      void supabase
        .from("profiles")
        .update({ timezone: browserTz })
        .eq("id", effectiveUserId)
        .then(() => {}, () => {});
    }

    // Local-day window for today's per-goal completion counts. Computed
    // in the browser's TZ so a Pacific-time mom's late-night completions
    // don't roll into "today" the next morning UTC. The queue projector
    // subtracts these from today's slot allocation so marking complete
    // doesn't pull a fresh lesson onto today.
    const todayInUserTz = todayInTz(browserTz);
    const todayStartIso = startOfDayInTzAsUtc(todayInUserTz, browserTz).toISOString();
    const tomorrowStartIso = startOfDayInTzAsUtc(addDaysYmd(todayInUserTz, 1), browserTz).toISOString();
    const [
      authResult,
      childrenResult,
      _todayLessonsResult,
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
      curriculumGoalsResult,
      completedTodayResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("children").select("id, name, color, birthday").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      // TODO: remove after queue scheduling verified in production. Old
      // pinned-date Today loader. Replaced by queue projection: see Phase 1.5
      // below where curriculumGoalsResult feeds computeTodayLessons() and
      // we then fetch matching rows by (curriculum_goal_id, lesson_number).
      // Kept as a tombstone (resolves to null data) so the destructure
      // index slot stays stable for one-line rollback.
      Promise.resolve({ data: null, error: null }),
      supabase.from("lessons").select("id").eq("user_id", effectiveUserId),
      supabase.from("lessons").select("date, scheduled_date, completed").eq("user_id", effectiveUserId).gte("scheduled_date", localDateStr(thirtyDaysAgo)),
      supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_field_trip"]),
      supabase.from("app_events").select("id, payload").eq("user_id", effectiveUserId).eq("type", "book_read").filter("payload->>date", "eq", today),
      supabase.from("app_events").select("id, type, payload").eq("user_id", effectiveUserId).in("type", ["memory_book", "memory_project", "memory_photo"]).filter("payload->>date", "eq", today),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("vacation_blocks").select("name, end_date, start_date").eq("user_id", effectiveUserId),
      supabase.from("lessons").select("title, scheduled_date, child_id, subjects(name), curriculum_goals(subject_label)").eq("user_id", effectiveUserId).eq("completed", false).gte("scheduled_date", localDateStr(tomorrow)).lte("scheduled_date", localDateStr(twoWeeks)).order("scheduled_date"),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).gte("date", syStart),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).in("type", ["photo", "drawing"]),
      supabase.from("memories").select("id").eq("user_id", effectiveUserId).eq("include_in_book", true).gte("date", syStart),
      supabase.from("lessons").select("date, scheduled_date").eq("user_id", effectiveUserId).eq("completed", true).gte("scheduled_date", monthStartStr).lte("scheduled_date", monthEndStr),
      supabase.from("memories").select("date").eq("user_id", effectiveUserId).gte("date", monthStartStr).lte("date", monthEndStr),
      supabase.from("memories").select("id, type, title, date, child_id, photo_url").eq("user_id", effectiveUserId).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("memories").select("id, title, date, child_id, photo_url").eq("user_id", effectiveUserId).gte("date", localDateStr(otdStart)).lte("date", localDateStr(otdEnd)).order("date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("memories").select("id, type, title, caption, child_id, photo_url, include_in_book, created_at").eq("user_id", effectiveUserId).eq("date", today).order("created_at", { ascending: false }),
      // Curriculum goals — full config for queue-based scheduling. The same
      // query also feeds the icon emoji + per-goal school_days lookups that
      // used to be its only purpose.
      supabase.from("curriculum_goals").select("id, icon_emoji, school_days, current_lesson, total_lessons, lessons_per_day, child_id, subject_label, curriculum_name, default_minutes, scheduled_start_time, start_date").eq("user_id", effectiveUserId).eq("archived", false),
      // Lessons completed today per goal (local-day window). The queue
      // projector subtracts these from today's slot allocation so that
      // marking complete keeps today's slot count stable instead of
      // pulling the next lesson into today.
      supabase
        .from("lessons")
        .select("curriculum_goal_id")
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .gte("completed_at", todayStartIso)
        .lt("completed_at", tomorrowStartIso)
        .not("curriculum_goal_id", "is", null),
    ]);

    // TODO: remove after queue scheduling verified in production. The
    // missed-lesson concept does not exist under queue projection — when
    // mom misses a day, current_lesson does not advance and tomorrow shows
    // the same lesson. Kept as an empty-array tombstone so downstream
    // setMissedLessons([]) keeps the existing prop chain intact for one-
    // line rollback.
    const missedResult = { data: [] as MissedLesson[] };

    // ── Phase 2: Process all results (no awaits) ────────────────────────

    // Profile
    const profile = profileResult.data;
    const authUser = authResult.data?.user;
    setFamilyName(profile?.display_name || authUser?.user_metadata?.family_name || "");
    setFirstName(authUser?.user_metadata?.first_name || "");
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? null);
    setProfileCreatedAt((profile as { created_at?: string | null } | null)?.created_at ?? null);
    setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
    setTrialStartedAt((profile as any)?.trial_started_at ?? null);
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

    // Children
    const childrenData = childrenResult.data;
    setChildren(capitalizeChildNames(childrenData ?? []));

    // Today's lessons — projected from curriculum goal queue position.
    // Source of truth is curriculum_goals.current_lesson + lessons_per_day +
    // school_days. We project today's lessons via computeTodayLessons, then
    // fetch matching rows by (curriculum_goal_id, lesson_number) for the
    // display fields (notes, subject, etc). scheduled_date is no longer
    // read for projection; it remains in the rows as a cache.
    type GoalRow = {
      id: string;
      icon_emoji: string | null;
      school_days: string[] | null;
      current_lesson: number;
      total_lessons: number;
      lessons_per_day: number;
      child_id: string | null;
      subject_label: string | null;
      curriculum_name: string;
      default_minutes: number;
      scheduled_start_time: string | null;
      start_date: string | null;
    };
    const goalRows = (curriculumGoalsResult.data ?? []) as GoalRow[];
    const emojiMap = new Map<string, string>();
    const schoolDaysMap = new Map<string, string[]>();
    const goalById = new Map<string, GoalRow>();
    for (const g of goalRows) {
      if (g.icon_emoji) emojiMap.set(g.id, g.icon_emoji);
      if (g.school_days && g.school_days.length > 0) schoolDaysMap.set(g.id, g.school_days);
      goalById.set(g.id, g);
    }
    setCurriculumGoalsCount(goalRows.length);
    setGoalSchoolDaysMap(schoolDaysMap);

    // Vacation blocks for the queue projector. The system never
    // schedules onto a break day; mom can still manually log lessons
    // there (mark-complete bypasses the projector). Loaded in Phase 1
    // alongside goals so this is the same round trip.
    const vacationBlocks: SchedVacationBlock[] = ((vacBlocksResult.data ?? []) as { start_date: string; end_date: string }[])
      .map((b) => ({ start_date: b.start_date, end_date: b.end_date }));

    // Project today's lessons across all active goals.
    const goalConfigs: CurriculumGoalConfig[] = goalRows.map((g) => ({
      id: g.id,
      total_lessons: g.total_lessons,
      lessons_per_day: g.lessons_per_day,
      school_days: g.school_days,
      current_lesson: g.current_lesson,
      start_date: g.start_date,
    }));
    // Per-goal count of lessons whose completed_at falls in today's
    // local-day window. Anchors today's slots to (current_lesson -
    // completedToday + 1) so completed cards stay visible and the queue
    // doesn't roll a new lesson onto today every time mom marks one
    // complete.
    const completedTodayPerGoal = new Map<string, number>();
    for (const row of (completedTodayResult.data ?? []) as { curriculum_goal_id: string | null }[]) {
      const gid = row.curriculum_goal_id;
      if (!gid) continue;
      completedTodayPerGoal.set(gid, (completedTodayPerGoal.get(gid) ?? 0) + 1);
    }
    setCompletedTodayPerGoal(completedTodayPerGoal);
    const projected: ProjectedLesson[] = computeTodayLessons(goalConfigs, new Date(), vacationBlocks, completedTodayPerGoal);

    // Project a 7-day window for cache warming. Today's loader only displays
    // today's slot, but if a user never opens Plan their upcoming rows'
    // scheduled_date cache stays stale for weeks (wizard-assigned future
    // dates never get re-aligned to the projector's truth). Projecting a
    // week here lets syncProjectedScheduledDates write through the next
    // few days too, so when the user finally opens Plan or moves through
    // the week, the calendar shows correct dates without a self-heal pass.
    // Display still uses `projected` (today only); `weekProjected` only
    // widens the fetch.
    const weekProjected: ProjectedLesson[] = goalConfigs.flatMap((goal) => {
      const completed = completedTodayPerGoal.get(goal.id) ?? 0;
      return computeNextLessonsForGoal(goal, new Date(), 7, vacationBlocks, completed);
    });

    // Fetch the lesson rows matching the projection so we can hydrate
    // display fields (title, notes, completion state, subject join). We
    // also fetch any one-off lessons (no curriculum_goal_id) that mom
    // manually pinned to today — those still live by date.
    type LoadedLessonRow = {
      id: string;
      title: string;
      completed: boolean;
      child_id: string;
      hours: number | null;
      minutes_spent: number | null;
      subjects: { name: string; color: string | null } | null;
      curriculum_goals: { subject_label: string | null } | null;
      curriculum_goal_id: string | null;
      lesson_number: number | null;
      queue_position: number | null;
      goal_id: string | null;
      notes: string | null;
      scheduled_date: string | null;
      is_backfill: boolean | null;
    };
    // Projection emits a queue slot index (the field is named lesson_number
    // for backward compat — see ProjectedLesson in scheduler.ts). The DB
    // column we match against is `queue_position`, which equals lesson_number
    // at curriculum creation and may diverge after a user manual move on
    // the Plan page (move_lesson_to_date).
    const projectedGoalIds = Array.from(new Set(projected.map((p) => p.goal_id)));
    const projectedSlots = Array.from(new Set(projected.map((p) => p.lesson_number)));
    // Union the today-only slots with the 7-day window so the helper sees
    // every row that might need cache alignment. The IN clause widens past
    // the cartesian product anyway; the client-side narrowing below picks
    // out just today's display rows.
    const fetchGoalIds = Array.from(new Set([
      ...projectedGoalIds,
      ...weekProjected.map((p) => p.goal_id),
    ]));
    const fetchSlots = Array.from(new Set([
      ...projectedSlots,
      ...weekProjected.map((p) => p.lesson_number),
    ]));
    const [projectedRowsResult, oneOffRowsResult] = await Promise.all([
      fetchGoalIds.length > 0
        ? supabase
            .from("lessons")
            .select("id, title, completed, child_id, hours, minutes_spent, subjects(name, color), curriculum_goals(subject_label), curriculum_goal_id, lesson_number, queue_position, goal_id, notes, scheduled_date, is_backfill")
            .eq("user_id", effectiveUserId)
            .in("curriculum_goal_id", fetchGoalIds)
            .in("queue_position", fetchSlots)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, hours, minutes_spent, subjects(name, color), curriculum_goals(subject_label), curriculum_goal_id, lesson_number, queue_position, goal_id, notes")
        .eq("user_id", effectiveUserId)
        .is("curriculum_goal_id", null)
        .or(`date.eq.${today},scheduled_date.eq.${today}`),
    ]);
    // Align the cached scheduled_date with the projector's truth before
    // we apply the future-date filter below. Without this, a row at
    // today's queue slot whose stale cache points at a future date
    // (e.g. wizard's original schedule, never overwritten after
    // current_lesson advanced) gets dropped, while Plan rewrites the
    // date in-memory and renders it. Fire-and-forget DB write; the
    // local map below is what powers this render.
    //
    // The map covers the 7-day window so the helper can warm the cache
    // for rows that won't display today but will display when the
    // user opens Plan or completes today's lesson and re-renders. The
    // display path (the narrower projected map below) is unchanged.
    const projDateByKey = new Map<string, string>(
      weekProjected.map((p) => [`${p.goal_id}|${p.lesson_number}`, p.date]),
    );
    const todayProjDateByKey = new Map<string, string>(
      projected.map((p) => [`${p.goal_id}|${p.lesson_number}`, p.date]),
    );
    const projectedRowsRaw = (projectedRowsResult.data ?? []) as unknown as LoadedLessonRow[];
    void syncProjectedScheduledDates(
      supabase,
      projectedRowsRaw,
      projDateByKey,
      (r) => (r.curriculum_goal_id && r.queue_position != null)
        ? `${r.curriculum_goal_id}|${r.queue_position}`
        : null,
    );
    const projectedRows = projectedRowsRaw
      // Only keep rows that match a projected (goal_id, queue_position) pair —
      // the IN/IN filter widens past the cartesian product so we narrow client-side.
      .filter((r) =>
        projected.some((p) => p.goal_id === r.curriculum_goal_id && p.lesson_number === r.queue_position)
      )
      // Override the in-memory scheduled_date with the projector's date
      // so the future-date filter below operates on aligned data instead
      // of a stale cache. Uses today's narrower map because only today's
      // rows are displayed; the wider 7-day map above is only for the
      // DB write-through helper.
      .map((r) => {
        const projDate = todayProjDateByKey.get(`${r.curriculum_goal_id}|${r.queue_position}`);
        return projDate ? { ...r, scheduled_date: projDate } : r;
      })
      // Defensive: drops a row whose aligned date still ends up in the
      // future (shouldn't happen for projected today-slot rows; the
      // projector emits today's date for today's slot). Kept so an
      // unexpected drift surfaces as a missing row rather than a wrong
      // one.
      .filter((r) => !(r.scheduled_date && r.scheduled_date > today));
    const oneOffRows = (oneOffRowsResult.data ?? []) as unknown as LoadedLessonRow[];

    // Order the projected rows to match the projection sequence (queue
    // order). One-off lessons are appended in their existing date order.
    const rowKey = (r: LoadedLessonRow) => `${r.curriculum_goal_id}|${r.queue_position}`;
    const projectedRowMap = new Map(projectedRows.map((r) => [rowKey(r), r]));
    const orderedProjectedRows: LoadedLessonRow[] = [];
    for (const p of projected) {
      const r = projectedRowMap.get(`${p.goal_id}|${p.lesson_number}`);
      if (r) orderedProjectedRows.push(r);
      // If a projection has no matching row, the lesson hasn't been pre-
      // generated. Skip silently — recomputeCurrentLesson on completion
      // will still advance the queue from whatever exists. Pre-generation
      // by CurriculumWizard means this case is rare; logging here would
      // spam in normal use.
    }

    const loadedLessons = [...orderedProjectedRows, ...oneOffRows].map((l) => ({
      ...(l as unknown as Lesson),
      icon_emoji: l.curriculum_goal_id ? (emojiMap.get(l.curriculum_goal_id) ?? "📚") : null,
    }));
    setLessons(loadedLessons);

    // TODO: remove after queue scheduling verified in production. Missed
    // lessons no longer exist under queue projection — see comment above
    // missedResult tombstone. Kept as setMissedLessons([]) so the rest of
    // the UI tree (collapsed under feature-gate) doesn't break during the
    // transition.
    setMissedLessons([]);
    setHasAnyLessons((allLessonsResult.data?.length ?? 0) > 0);
    setAllDoneBanner(loadedLessons.length > 0 && loadedLessons.every((l: Lesson) => l.completed));

    // ── Missed-lesson eligibility (Path A queue scheduling) ──────────────
    // Computes overdueLessonCount for the banner and decides whether to
    // open the Missed Lesson Recovery modal. The modal opens whenever
    // there is at least one overdue entry and the per-session
    // `rooted_missed_lesson_prompt_shown` flag is not set. Brand-new
    // families with zero completions are skipped (no gap to show).
    void (async () => {
      const activeGoals = goalRows.filter((g) => g.current_lesson < g.total_lessons);
      if (activeGoals.length === 0) {
        setShowMissedRecovery(false);
        setOverdueLessonCount(0);
        return;
      }

      const { data: lastCompRows } = await supabase
        .from("lessons")
        .select("completed_at")
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1);
      const lastCompletedAtIso = (lastCompRows?.[0] as { completed_at: string | null } | undefined)?.completed_at ?? null;
      const lastCompletedAt = lastCompletedAtIso ? new Date(lastCompletedAtIso) : null;

      const todayMid = new Date(today + "T00:00:00");
      const gapStart = lastCompletedAt
        ? (() => { const d = new Date(lastCompletedAt); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d; })()
        : todayMid; // never completed → no gap to show

      // Skip first-time families. The wizard owns their welcome moment;
      // we do not want to nag empty accounts.
      if (!lastCompletedAt) {
        setShowMissedRecovery(false);
        setOverdueLessonCount(0);
        return;
      }

      // Compute per-goal entries. Vacation blocks exclude break days so
      // the modal never asks about lessons during a vacation. If the
      // entire gap sits inside a break the modal does not appear
      // (entriesByGoal stays empty).
      const entriesByGoal = new Map<string, MissedEntry[]>();
      let overdueTotal = 0;
      for (const goal of activeGoals) {
        const cfg: CurriculumGoalConfig = {
          id: goal.id,
          total_lessons: goal.total_lessons,
          lessons_per_day: goal.lessons_per_day,
          school_days: goal.school_days,
          current_lesson: goal.current_lesson,
          start_date: goal.start_date,
        };
        const entries = computeGapLessonsForGoal(cfg, gapStart, todayMid, vacationBlocks);
        overdueTotal += entries.length;
        if (entries.length > 0) entriesByGoal.set(goal.id, entries);
      }
      setOverdueLessonCount(overdueTotal);

      if (entriesByGoal.size === 0) { setShowMissedRecovery(false); return; }

      // Build display goal list with child names.
      const childById = new Map((childrenData ?? []).map((c: Child) => [c.id, c]));
      const displayGoals: MissedGoal[] = activeGoals
        .filter((g) => entriesByGoal.has(g.id))
        .map((g) => ({
          id: g.id,
          curriculum_name: g.curriculum_name,
          subject_label: g.subject_label,
          child_id: g.child_id,
          child_name: g.child_id ? (childById.get(g.child_id)?.name ?? null) : null,
        }));

      setMissedGoals(displayGoals);
      setMissedEntriesByGoal(entriesByGoal);

      // Session gating. Once the user has seen / acted on the modal in
      // this tab session we do not re-prompt, and the banner is hidden
      // until the next session (read by the banner JSX below).
      const alreadyShown =
        typeof window !== "undefined" &&
        window.sessionStorage.getItem("rooted_missed_lesson_prompt_shown") === "1";
      if (alreadyShown) {
        setMissedRecoveryDismissed(true);
        setShowMissedRecovery(false);
        return;
      }
      setShowMissedRecovery(true);
    })();

    // ── Unconfirmed-prior-lesson check (Path A queue scheduling) ──────────
    // For each active goal, see whether the queue slot at queue_position =
    // current_lesson has actually been recorded as completed. If not, the
    // queue advanced (via Schedule Builder starting-position bump, manual
    // SQL, or a missed mark-complete) without an audit trail. We surface a
    // one-tap inline prompt above today's lesson list so the family can
    // confirm or push the lesson back to today. Runs fire-and-forget so a
    // slow round trip never blocks Today's main render.
    void (async () => {
      // Skip the same-day-as-creation case: a goal created today with
      // start_at_lesson > 1 (the Schedule Builder's past-start UX) would
      // otherwise prompt on the same page-load that created it.
      const candidates = goalRows.filter(
        (g) => g.current_lesson > 0 && g.start_date !== today,
      );
      if (candidates.length === 0) {
        setNeedsConfirmation([]);
        return;
      }

      // One SELECT covers every candidate. We match against lesson_number
      // (the canonical curriculum index that stays pinned per
      // docs/CURRICULUM-SCHEDULING.md) rather than queue_position, which
      // gets nulled by trg_curriculum_goals_cleanup_orphans whenever
      // current_lesson advances. Without this, the trigger would null
      // queue_position on the row we just marked complete and the next
      // load would re-flag the goal as unconfirmed.
      //
      // The check distinguishes "row missing entirely" from "row exists
      // but not yet marked done." Only the missing-row case triggers the
      // prompt:
      //
      //   * Pre-2026-05-19 Schedule Builder advanced current_lesson via
      //     start_at_lesson without writing backfill rows; the slot at
      //     lesson_number = current_lesson is silently empty and the
      //     family has no audit trail of those completions.
      //
      //   * A normal forward lesson at lesson_number = current_lesson
      //     (row present, completed=false) is just today's lesson sitting
      //     unfinished. The Yes-handler advances current_lesson by 1, so
      //     re-prompting on every completed=false row would chain a fresh
      //     prompt after every Yes click. Suppress it.
      //
      // Failure is silent: a transient query error leaves
      // needsConfirmation untouched rather than showing a stale prompt or
      // erasing a real one.
      const { data: presentRows, error: presentErr } = await supabase
        .from("lessons")
        .select("curriculum_goal_id, lesson_number")
        .eq("user_id", effectiveUserId)
        .in("curriculum_goal_id", candidates.map((g) => g.id))
        .not("lesson_number", "is", null);
      if (presentErr) return;
      const presentSet = new Set(
        ((presentRows ?? []) as { curriculum_goal_id: string; lesson_number: number }[])
          .map((r) => `${r.curriculum_goal_id}|${r.lesson_number}`),
      );

      const unconfirmed = candidates
        .filter((g) => !presentSet.has(`${g.id}|${g.current_lesson}`))
        // Session dismissal: localStorage key scoped to (goal_id, today)
        // so a "No, show it today" press hides the prompt for the rest of
        // the day but reappears tomorrow if still unresolved.
        .filter((g) => {
          if (typeof window === "undefined") return true;
          const key = `rooted_dismissed_confirmation_${g.id}_${today}`;
          return window.localStorage.getItem(key) !== "1";
        })
        .map((g) => ({
          goal_id: g.id,
          curriculum_name: g.curriculum_name,
          subject_label: g.subject_label,
          current_lesson: g.current_lesson,
          child_id: g.child_id,
        }));
      setNeedsConfirmation(unconfirmed);
    })();

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
    type UpRow = { title: string; scheduled_date: string | null; child_id: string | null; subjects: { name: string } | null; curriculum_goals?: { subject_label: string | null } | null };
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
          subjectName: resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label),
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
        // Using `read` column to stay aligned with supabase/migrations schema.
        // The `read_at` column exists in production but was added outside of
        // migrations — it will be reconciled in a follow-up cleanup pass.
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(3);
      setFamilyNotifs(data ?? []);
    })();
  }, [effectiveUserId, isPartner]);

  async function dismissFamilyNotifs() {
    setFamilyNotifsDismissed(true);
    const ids = familyNotifs.map((n) => n.id);
    if (ids.length > 0 && effectiveUserId) {
      await supabase
        .from("family_notifications")
        .update({ read: true, read_at: new Date().toISOString() })
        .in("id", ids)
        .eq("user_id", effectiveUserId);
    }
  }

  // Poll for new memories (e.g. FAB photo saved from layout). 5 min
  // cadence: loadData also pulls /api/appointments + /api/lists, and a
  // 15s tick on those endpoints tripped a Vercel function-invocation
  // usage anomaly. User-initiated edits don't wait on this — Settings
  // (children), Plan (lessons), and the FAB all dispatch the
  // rooted:* window events above for immediate refresh; this poll is
  // the fallback for changes that arrive without an event.
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 300000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when children are edited in Settings
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener("rooted:children-updated", handler);
    return () => window.removeEventListener("rooted:children-updated", handler);
  }, [loadData]);

  // Re-fetch when a lesson is rescheduled/moved on the Plan page so the
  // Today schedule reflects the new date without a manual page reload.
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener("rooted:lessons-updated", handler);
    return () => window.removeEventListener("rooted:lessons-updated", handler);
  }, [loadData]);

  // Open the photo-limit modal when the FAB (in layout.tsx) hits the cap.
  useEffect(() => {
    const handler = () => setShowPhotoLimitModal(true);
    window.addEventListener("rooted:photo-limit-reached", handler);
    return () => window.removeEventListener("rooted:photo-limit-reached", handler);
  }, []);

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

  // ── Catch-up modal handlers (queue-based scheduling) ──────────────────
  // Success toast after the Missed Lesson Recovery YES path lands.
  const [recoveryToast, setRecoveryToast] = useState(false);

  function markMissedRecoveryShown() {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("rooted_missed_lesson_prompt_shown", "1");
  }

  async function handleMissedRecoveryYes() {
    if (!effectiveUserId) return;
    markMissedRecoveryShown();
    setMissedRecoveryDismissed(true);
    setShowMissedRecovery(false);

    // Flatten all entries across goals — YES means "mark every missed
    // lesson done on the gap day it would have been due."
    const allEntries: MissedEntry[] = [];
    for (const entries of missedEntriesByGoal.values()) {
      allEntries.push(...entries);
    }
    const goalIds = Array.from(new Set(allEntries.map((e) => e.goal_id)));

    // For each entry, update the existing row by (curriculum_goal_id,
    // queue_position). The projection emits queue slot indices (see
    // ProjectedLesson docstring); queue_position is the column the Today
    // page already matches projection slots against, so it is the correct
    // field here too. CurriculumWizard pre-generates rows at creation;
    // missing rows fall through to an insert keyed on the same pair.
    for (const entry of allEntries) {
      const completedAtIso = `${entry.date}T12:00:00Z`;
      const { data: existing } = await supabase
        .from("lessons")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("curriculum_goal_id", entry.goal_id)
        .eq("queue_position", entry.lesson_number)
        .maybeSingle();
      if (existing) {
        await supabase.from("lessons").update({
          completed: true,
          completed_at: completedAtIso,
          date: entry.date,
          scheduled_date: entry.date,
          scheduled_source: "catchup_resched",
        }).eq("id", (existing as { id: string }).id);
      } else {
        const goal = missedGoals.find((g) => g.id === entry.goal_id);
        const goalRow = await supabase
          .from("curriculum_goals")
          .select("child_id, subject_label, default_minutes, subject_id")
          .eq("id", entry.goal_id)
          .maybeSingle();
        const childId = (goalRow.data as { child_id?: string | null })?.child_id ?? null;
        const subjectId = (goalRow.data as { subject_id?: string | null })?.subject_id ?? null;
        const defaultMinutes = (goalRow.data as { default_minutes?: number | null })?.default_minutes ?? 30;
        await supabase.from("lessons").insert({
          user_id: effectiveUserId,
          curriculum_goal_id: entry.goal_id,
          lesson_number: entry.lesson_number,
          queue_position: entry.lesson_number,
          title: `${goal?.subject_label ?? goal?.curriculum_name ?? "Lesson"}: Lesson ${entry.lesson_number}`,
          completed: true,
          completed_at: completedAtIso,
          date: entry.date,
          scheduled_date: entry.date,
          scheduled_source: "catchup_resched",
          child_id: childId,
          subject_id: subjectId,
          minutes_spent: defaultMinutes,
          hours: defaultMinutes / 60,
          is_backfill: true,
        });
      }
    }

    for (const goalId of goalIds) {
      await recomputeCurrentLesson(supabase, goalId);
    }

    setRecoveryToast(true);
    setTimeout(() => setRecoveryToast(false), 2500);

    // Regression guard: loadData first, then refreshTodayStory.
    await loadData();
    await refreshTodayStory();
  }

  async function handleMissedRecoveryNo() {
    markMissedRecoveryShown();
    setMissedRecoveryDismissed(true);
    setShowMissedRecovery(false);
    // No DB writes — under Path A the queue projector already absorbs
    // missed lessons into the upcoming schedule going forward from today
    // (computeTodayLessons projects from current_lesson without
    // referencing the missed dates). Still refresh both surfaces so the
    // dashboard re-renders cleanly without the banner.
    await loadData();
    await refreshTodayStory();
  }

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
    return runReschedule(async () => {
      // Push today's uncompleted lessons to the next available school day.
      // Routes through the shared `planRescheduleLessons` helper (Invariant 8)
      // and writes `scheduled_source='skip_today'` (Invariant 10). Honors
      // user vacation blocks and per-goal lessons_per_day capacity, fixing
      // the pre-May-3 per-row cursor reset that bunched every uncompleted
      // lesson onto the same next-school-day.
      const uncompleted = lessons.filter(l => !l.completed);
      if (uncompleted.length === 0) return;
      if (!effectiveUserId) return;

      // Kill switch: skip the re-spread without touching the lessons table.
      if (!isQueueEnabled()) return;

      // Snapshot the rows BEFORE writing so undo restores precise prior state.
      const { data: priorRows } = await supabase
        .from("lessons")
        .select("id, date, scheduled_date")
        .in("id", uncompleted.map(l => l.id));
      const snapshot = buildLessonDateSnapshot(
        (priorRows ?? []) as { id: string; date: string | null; scheduled_date: string | null }[],
      );

      // Per-goal config (school_days + lessons_per_day) for the planner.
      const goalIds = [...new Set(uncompleted.map(l => l.curriculum_goal_id).filter(Boolean))] as string[];
      const { data: goalsData } = goalIds.length > 0
        ? await supabase.from("curriculum_goals").select("id, school_days, lessons_per_day").in("id", goalIds)
        : { data: [] };
      const goalConfigs = new Map<string, { school_days: string[] | null; lessons_per_day: number }>();
      for (const g of (goalsData ?? []) as { id: string; school_days: string[] | null; lessons_per_day: number | null }[]) {
        goalConfigs.set(g.id, { school_days: g.school_days, lessons_per_day: g.lessons_per_day ?? 1 });
      }
      // Synthetic bucket for one-off lessons (no curriculum_goal_id) so they
      // route through the same planner. school_days=null falls back to
      // Mon-Fri inside the planner — matches the original `defaultDays`.
      const NO_GOAL_KEY = "__no_goal__";
      goalConfigs.set(NO_GOAL_KEY, { school_days: null, lessons_per_day: 1 });

      // User's vacation blocks — never push a moved lesson onto a break.
      const { data: vacRaw } = await supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", effectiveUserId);
      const vacRanges = ((vacRaw ?? []) as { start_date: string; end_date: string }[])
        .map(v => ({ start: v.start_date, end: v.end_date }));

      // Forward-dated incompletes that AREN'T being skipped — seeds occupancy
      // so we don't bunch a moved lesson onto a date already at capacity.
      const skippedIds = new Set(uncompleted.map(l => l.id));
      const { data: stayingRows } = await supabase
        .from("lessons")
        .select("id, scheduled_date, curriculum_goal_id, lesson_number, is_backfill")
        .eq("user_id", effectiveUserId)
        .eq("completed", false)
        .gt("scheduled_date", today);
      const staying = ((stayingRows ?? []) as { id: string; scheduled_date: string | null; curriculum_goal_id: string | null; lesson_number: number | null; is_backfill: boolean | null }[])
        .filter(r => r.scheduled_date && r.is_backfill !== true && !skippedIds.has(r.id))
        .map(r => ({
          curriculum_goal_id: r.curriculum_goal_id ?? NO_GOAL_KEY,
          date: r.scheduled_date!,
          lesson_number: r.lesson_number,
        }));

      const { updates } = planRescheduleLessons({
        toReshuffle: uncompleted.map(l => ({
          id: l.id,
          curriculum_goal_id: l.curriculum_goal_id ?? NO_GOAL_KEY,
          lesson_number: l.lesson_number ?? null,
        })),
        staying,
        goalConfigs,
        startAfterDate: today,
        vacations: vacRanges,
      });

      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(({ id, newDate }) =>
            supabase.from("lessons").update({
              scheduled_date: newDate,
              date: newDate,
              scheduled_source: "skip_today",
            }).eq("id", id)
          )
        );
      }
      setLessons(prev => prev.filter(l => l.completed));
      showRescheduleUndo(`${uncompleted.length} lesson${uncompleted.length !== 1 ? "s" : ""} moved to next school day! Undo?`, snapshot);
    });
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
    // Save minutes_spent and hours alongside completion. completed_at must be
    // set whenever completed=true (Bug 2 invariant). scheduled_date / date
    // are pinned to today so a future-scheduled row doesn't ghost back onto
    // its original calendar slot after this write.
    await supabase.from("lessons").update({
      completed: true,
      completed_at: new Date().toISOString(),
      minutes_spent: minutes,
      hours: minutes / 60.0,
      scheduled_date: today,
      date: today,
    }).eq("id", lesson.id);
    // Update local state
    setLessons(prev => prev.map(l => l.id === lesson.id ? { ...l, completed: true, minutes_spent: minutes, hours: minutes / 60.0 } : l));
    // Run all the post-completion effects (celebrations, toasts, goal advancement)
    posthog.capture('lesson_completed', {
      lesson_number: lesson.lesson_number ?? null,
      lesson_date: today,
      subject_label: lesson.curriculum_goals?.subject_label ?? null,
      days_late: 0,
    });
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

    // Advance curriculum goal — recompute from actual rows so current_lesson
    // never drifts past max(lesson_number) of completed rows (Bug 3).
    if (lesson.curriculum_goal_id) {
      await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
    }

    checkAndAwardBadges(effectiveUserId);
    onLogAction({ userId: effectiveUserId, childId: lesson.child_id ?? undefined, actionType: "lesson" });
  }

  function closeCheckOffModal() {
    setCheckOffVisible(false);
    setTimeout(() => setCheckOffLesson(null), 300);
  }

  // ── Lesson note helpers (parity with Plan page) ───────────────────────────
  function startEditingNote(lessonId: string, currentNotes: string | null | undefined) {
    setEditingNoteId(lessonId);
    setEditingNoteText(currentNotes ?? "");
    setNoteSaveState("idle");
    if (noteSaveTimerRef.current) { clearTimeout(noteSaveTimerRef.current); noteSaveTimerRef.current = null; }
    setTimeout(() => noteTextareaRef.current?.focus(), 0);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
    setNoteSaveState("idle");
    if (noteSaveTimerRef.current) { clearTimeout(noteSaveTimerRef.current); noteSaveTimerRef.current = null; }
  }

  async function saveNote(lessonId: string) {
    if (noteSaveState === "saving") return;
    const trimmed = editingNoteText.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    setNoteSaveState("saving");
    const { error } = await supabase.from("lessons").update({ notes: value }).eq("id", lessonId);
    if (error) {
      setNoteSaveState("error");
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = setTimeout(() => setNoteSaveState("idle"), 2500);
      return;
    }
    setLessons(prev => prev.map(l => l.id === lessonId ? { ...l, notes: value } : l));
    setNoteSaveState("saved");
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    noteSaveTimerRef.current = setTimeout(() => {
      setEditingNoteId(null);
      setEditingNoteText("");
      setNoteSaveState("idle");
      noteSaveTimerRef.current = null;
    }, 1500);
  }

  // ── Skip lesson (parity with Plan page: clear scheduled date, undo restores)
  async function skipLesson(lesson: Lesson) {
    return runReschedule(async () => {
      // Capture both date columns before clearing — undo can't recompute them.
      const { data: priorRow } = await supabase
        .from("lessons")
        .select("id, date, scheduled_date")
        .eq("id", lesson.id)
        .maybeSingle();
      const snapshot = priorRow
        ? buildLessonDateSnapshot([priorRow as { id: string; date: string | null; scheduled_date: string | null }])
        : buildLessonDateSnapshot([{ id: lesson.id, date: today, scheduled_date: today }]);
      setLessons(prev => prev.filter(l => l.id !== lesson.id));
      await supabase.from("lessons").update({ scheduled_date: null, date: null }).eq("id", lesson.id);
      showRescheduleUndo("Lesson skipped", snapshot);
    });
  }

  async function toggleLesson(id: string, current: boolean) {
    const lesson = lessons.find((l) => l.id === id);
    // Pin date+scheduled_date to today on the complete direction so the
    // completed history reflects when the work actually happened — even
    // when the original scheduled_date sits in the past (missed) or matches
    // today. Without this universal pin, past-dated rows kept ghosting on
    // the missed-lessons surface and future-dated rows kept ghosting on
    // future calendar days. Uncomplete still leaves dates untouched (the
    // user might be undoing a misclick on a real future lesson).
    // lesson_number is left alone — queue position is governed by
    // current_lesson, not date (Invariant 7).
    const todayStr = toDateStr(new Date());
    const pinDateToToday = !current && !!lesson;
    const updatedLessons = lessons.map(l =>
      l.id === id
        ? (pinDateToToday
          ? { ...l, completed: !current, scheduled_date: todayStr, date: todayStr }
          : { ...l, completed: !current })
        : l
    );
    setLessons(updatedLessons);
    // Keep completed ↔ completed_at invariant (Bug 2): set timestamp on
    // complete, clear it on uncomplete.
    const update: Record<string, unknown> = {
      completed: !current,
      completed_at: !current ? new Date().toISOString() : null,
    };
    if (pinDateToToday) {
      update.scheduled_date = todayStr;
      update.date = todayStr;
    }
    await supabase.from("lessons").update(update).eq("id", id);

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
      posthog.capture('lesson_completed', {
        lesson_number: lesson?.lesson_number ?? null,
        lesson_date: today,
        subject_label: lesson?.curriculum_goals?.subject_label ?? null,
        days_late: 0,
      });
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

      if (lesson?.curriculum_goal_id) {
        // Recompute current_lesson from actual rows instead of blindly
        // incrementing (Bug 3). Modern goals pre-generate all rows 1..total
        // during wizard save, so no auto-insert is needed here — the old code
        // was creating duplicate lesson_number rows on top of pre-generated
        // ones (Bug 5) and scheduling them on non-goal school days (Bug 4).
        await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
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

    // Queue-based "next batch" picker (Path A). Today's allocation
    // (current_lesson + 1 .. current_lesson + lessons_per_day) is
    // already on the Today schedule and must NOT appear here. The
    // modal projects the BATCH AFTER today onto upcoming school days,
    // skipping vacation blocks, and shows lessons grouped by kid then
    // subject in ascending lesson_number order.
    //
    // The completedToday window is bounded in the browser's TZ (the
    // ground truth for the user's actual location). Derived inline so
    // this handler doesn't depend on loadData having populated userTz
    // state first.
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayUserTz = todayInTz(browserTz);
    const todayStartIso = startOfDayInTzAsUtc(todayUserTz, browserTz).toISOString();
    const tomorrowStartIso = startOfDayInTzAsUtc(addDaysYmd(todayUserTz, 1), browserTz).toISOString();
    const [{ data: goalsRaw }, { data: vacsRaw }, { data: completedTodayRaw }] = await Promise.all([
      supabase
        .from("curriculum_goals")
        .select("id, total_lessons, lessons_per_day, school_days, current_lesson, child_id, subject_label, start_date")
        .eq("user_id", effectiveUserId)
        .eq("archived", false),
      supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", effectiveUserId),
      supabase
        .from("lessons")
        .select("curriculum_goal_id")
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .gte("completed_at", todayStartIso)
        .lt("completed_at", tomorrowStartIso)
        .not("curriculum_goal_id", "is", null),
    ]);
    const goals = (goalsRaw ?? []) as { id: string; total_lessons: number | null; lessons_per_day: number | null; school_days: string[] | null; current_lesson: number | null; child_id: string | null; subject_label: string | null; start_date: string | null }[];
    const vacationBlocks: SchedVacationBlock[] = ((vacsRaw ?? []) as { start_date: string; end_date: string }[])
      .map((b) => ({ start_date: b.start_date, end_date: b.end_date }));
    // Today's per-goal completion count anchors today's projected slots
    // so the future pool starts at the correct lesson_number. Without
    // this, "Log extras" would offer current_lesson + 2 onwards (the
    // un-fixed projection) and skip a lesson the user hasn't done.
    const completedTodayPerGoal = new Map<string, number>();
    for (const row of (completedTodayRaw ?? []) as { curriculum_goal_id: string | null }[]) {
      const gid = row.curriculum_goal_id;
      if (!gid) continue;
      completedTodayPerGoal.set(gid, (completedTodayPerGoal.get(gid) ?? 0) + 1);
    }

    // Build per-goal "future pool" of lessons that aren't part of
    // today's allocation. Approach: project from the real
    // current_lesson starting TODAY, then drop any entries whose
    // projected date == today (those ARE today's allocation and live
    // on the Today schedule). Whatever's left is the future pool the
    // modal can offer.
    //
    // Why not just `current_lesson + lessons_per_day` and project from
    // tomorrow? Because if today is a break day or a non-school day,
    // today consumed zero allocation — the offset would skip real
    // lessons that mom never got.
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    const todayKey = `${todayMid.getFullYear()}-${String(todayMid.getMonth() + 1).padStart(2, "0")}-${String(todayMid.getDate()).padStart(2, "0")}`;
    type Proj = { goal_id: string; lesson_number: number; date: string };
    const allProjected: Proj[] = [];
    for (const g of goals) {
      const total = g.total_lessons ?? 0;
      const cur = g.current_lesson ?? 0;
      const perDay = Math.max(1, g.lessons_per_day ?? 1);
      if (total <= 0 || cur >= total) continue;
      const cfg: CurriculumGoalConfig = {
        id: g.id,
        total_lessons: total,
        lessons_per_day: perDay,
        school_days: g.school_days,
        current_lesson: cur,
        start_date: g.start_date,
      };
      // 22 days ahead = today + 21 forward. Drop today's slots (those
      // are the current allocation already on the Today schedule).
      const completed = completedTodayPerGoal.get(g.id) ?? 0;
      const projected = computeNextLessonsForGoal(cfg, todayMid, 22, vacationBlocks, completed)
        .filter((p) => p.date !== todayKey);
      allProjected.push(...projected);
    }

    // Hydrate display fields from real lesson rows.
    const projGoalIds = Array.from(new Set(allProjected.map((p) => p.goal_id)));
    const projNumbers = Array.from(new Set(allProjected.map((p) => p.lesson_number)));
    const { data: rowData } = projGoalIds.length > 0
      ? await supabase
          .from("lessons")
          .select("id, title, child_id, scheduled_date, curriculum_goal_id, lesson_number, subjects(name, color), curriculum_goals(subject_label)")
          .eq("user_id", effectiveUserId)
          .eq("completed", false)
          .in("curriculum_goal_id", projGoalIds)
          .in("lesson_number", projNumbers)
      : { data: [] as unknown[] };
    type RowLite = { id: string; title: string; child_id: string | null; scheduled_date: string | null; curriculum_goal_id: string | null; lesson_number: number | null; subjects: { name: string; color: string | null } | null; curriculum_goals?: { subject_label: string | null } | null };
    const rowMap = new Map<string, RowLite>();
    for (const r of (rowData ?? []) as RowLite[]) {
      rowMap.set(`${r.curriculum_goal_id}|${r.lesson_number}`, r);
    }

    // Sort: kid → subject → lesson_number ascending. Override
    // scheduled_date with the projected date so the modal renders the
    // queue position, not the stale cache.
    const out: UpcomingLesson[] = [];
    for (const p of allProjected) {
      const r = rowMap.get(`${p.goal_id}|${p.lesson_number}`);
      if (!r) continue; // missing row — skip silently (wizard pre-generates)
      out.push({
        id: r.id,
        title: r.title,
        child_id: r.child_id ?? "",
        scheduled_date: p.date,
        curriculum_goal_id: r.curriculum_goal_id,
        lesson_number: r.lesson_number,
        subjects: r.subjects,
        curriculum_goals: r.curriculum_goals,
      } as UpcomingLesson);
    }

    // Stable order: child_id (matches Today layout), then
    // subject_label, then lesson_number ascending. The group renderer
    // walks this in-order so each subject is a clean numerical run.
    out.sort((a, b) => {
      const aCid = a.child_id ?? "";
      const bCid = b.child_id ?? "";
      if (aCid !== bCid) return aCid.localeCompare(bCid);
      const aSubj = resolveLessonSubject(a.subjects?.name, a.curriculum_goals?.subject_label) ?? "";
      const bSubj = resolveLessonSubject(b.subjects?.name, b.curriculum_goals?.subject_label) ?? "";
      if (aSubj !== bSubj) return aSubj.localeCompare(bSubj);
      const aN = a.lesson_number ?? 0;
      const bN = b.lesson_number ?? 0;
      return aN - bN;
    });

    setUpcomingLessons(out);
    setExtraChecked(new Set());
    setShowExtraLessons(true);
    posthog.capture('log_extra_lessons_opened', { user_plan: isPro ? 'paid' : 'free' });
  }

  async function confirmExtraLessons() {
    if (extraChecked.size === 0) return;
    setSavingExtra(true);

    const goalMinutes = new Map<string, number>();
    const currentPerGoal = new Map<string, number>();
    const checkedLessons = upcomingLessons.filter(l => extraChecked.has(l.id));
    const uniqueGoalIds = Array.from(new Set(checkedLessons.map(l => l.curriculum_goal_id).filter(Boolean) as string[]));
    if (uniqueGoalIds.length > 0) {
      const { data: goalRows } = await supabase
        .from("curriculum_goals")
        .select("id, default_minutes, current_lesson")
        .in("id", uniqueGoalIds);
      for (const g of (goalRows ?? []) as { id: string; default_minutes?: number; current_lesson: number | null }[]) {
        goalMinutes.set(g.id, g.default_minutes ?? 30);
        currentPerGoal.set(g.id, g.current_lesson ?? 0);
      }
    }

    // Per-goal highest lesson_number the user picked. Any incomplete row in
    // (current_lesson, maxChecked] for that goal must also be marked complete
    // so the queue pointer never skips a lesson (recomputeCurrentLesson takes
    // MAX of completed rows, so without this backfill an intermediate lesson
    // would stay incomplete while current_lesson jumped past it).
    const maxCheckedPerGoal = new Map<string, number>();
    for (const l of checkedLessons) {
      if (!l.curriculum_goal_id || l.lesson_number == null) continue;
      const prev = maxCheckedPerGoal.get(l.curriculum_goal_id) ?? 0;
      if (l.lesson_number > prev) maxCheckedPerGoal.set(l.curriculum_goal_id, l.lesson_number);
    }
    const intermediateIds = new Set<string>();
    for (const goalId of uniqueGoalIds) {
      const maxChecked = maxCheckedPerGoal.get(goalId) ?? 0;
      const cur = currentPerGoal.get(goalId) ?? 0;
      if (maxChecked <= cur + 1) continue;
      const { data: gapRows } = await supabase
        .from("lessons")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("curriculum_goal_id", goalId)
        .eq("completed", false)
        .gt("lesson_number", cur)
        .lt("lesson_number", maxChecked);
      for (const r of (gapRows ?? []) as { id: string }[]) {
        intermediateIds.add(r.id);
      }
    }

    const lessonIds = Array.from(new Set([
      ...checkedLessons.map(l => l.id),
      ...intermediateIds,
    ]));
    const { error: batchError } = await supabase.from("lessons").update({
      completed: true,
      completed_at: new Date().toISOString(),
      date: today,
      scheduled_date: today,
    }).in("id", lessonIds);
    if (batchError) {
      console.error("Failed to save extra lessons:", batchError);
      setSavingExtra(false);
      showCaptureToast("Something went wrong. Please try again.", null);
      return;
    }

    // Advance current_lesson per affected goal. Without this, the
    // queue projector would still include these lessons on the next
    // render and Today would show them again on Monday.
    const affectedGoalIds = new Set<string>();
    for (const lessonId of extraChecked) {
      const lesson = upcomingLessons.find((l) => l.id === lessonId);
      if (lesson?.curriculum_goal_id) affectedGoalIds.add(lesson.curriculum_goal_id);
    }
    for (const goalId of affectedGoalIds) {
      await recomputeCurrentLesson(supabase, goalId);
    }

    setSavingExtra(false);
    setExtraChecked(new Set());
    setShowExtraLessons(false);
    // Fire one streak update for the whole batch (per-user, not per-lesson).
    if (extraChecked.size > 0) {
      onLogAction({ userId: effectiveUserId, actionType: "lesson" });
    }
    // Force unlock loadDataBusy so this refresh always runs even if a
    // background load was in flight when the user tapped "Log".
    loadDataBusy.current = false;
    await loadData();
    await refreshTodayStory();
    // Notify InlineScheduleTabs (Upcoming/Past tabs) — its internal load
    // runs on mount only, so without this event the Upcoming list keeps
    // showing the just-completed lesson until a hard refresh.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("rooted:lessons-updated"));
    }
  }

  function openEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    setEditTitle(lesson.title);
    setEditSubject(resolveLessonSubject(lesson.subjects?.name, lesson.curriculum_goals?.subject_label) ?? "");
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
    // If a previous delete is still pending its undo window, commit it now
    // before starting a new one (only one delete can be undoable at a time).
    if (pendingDelete && pendingDeleteTimer.current) {
      clearTimeout(pendingDeleteTimer.current);
      pendingDeleteTimer.current = null;
      const prevId = pendingDelete.lesson.id;
      await supabase.from("lessons").delete().eq("id", prevId);
    }
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;
    setLessons((prev) => prev.filter((l) => l.id !== id));
    setPendingDelete({ lesson });
    pendingDeleteTimer.current = setTimeout(async () => {
      await supabase.from("lessons").delete().eq("id", id);
      await refreshLeafCounts();
      setPendingDelete(null);
      pendingDeleteTimer.current = null;
    }, 5000);
  }

  function undoDelete() {
    if (!pendingDelete) return;
    if (pendingDeleteTimer.current) {
      clearTimeout(pendingDeleteTimer.current);
      pendingDeleteTimer.current = null;
    }
    const restored = pendingDelete.lesson;
    setLessons((prev) => prev.some((l) => l.id === restored.id) ? prev : [...prev, restored]);
    setPendingDelete(null);
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
      .eq("child_id", childId)
      .eq("archived", false);
    const activeGoals = (goals ?? []).filter(
      (g: { current_lesson: number; total_lessons: number }) => g.current_lesson < g.total_lessons
    );
    if (activeGoals.length === 0) { setExtraLessonLoading(null); return; }

    // Find the next uncompleted lesson across all goals, preferring earliest lesson_number
    type NextLessonRow = { id: string; title: string; curriculum_goal_id: string; lesson_number: number; queue_position: number | null; child_id: string };
    let nextLesson: NextLessonRow | null = null;

    for (const goal of activeGoals) {
      // "Next" follows queue order, not the static lesson_number sequence —
      // a manually-moved lesson should still surface in its new spot.
      const { data: upcoming } = await supabase
        .from("lessons")
        .select("id, title, curriculum_goal_id, lesson_number, queue_position, child_id")
        .eq("curriculum_goal_id", goal.id)
        .eq("completed", false)
        .not("queue_position", "is", null)
        .order("queue_position", { ascending: true })
        .limit(1);
      if (upcoming && upcoming.length > 0) {
        const candidate = upcoming[0] as NextLessonRow;
        if (
          !nextLesson ||
          (candidate.queue_position ?? Number.POSITIVE_INFINITY) <
            (nextLesson.queue_position ?? Number.POSITIVE_INFINITY)
        ) {
          nextLesson = candidate;
        }
      }
    }

    if (!nextLesson) { setExtraLessonLoading(null); return; }

    // Mark the lesson as completed with today's date and default minutes
    const goalForLesson = activeGoals.find((g: { id: string }) => g.id === nextLesson!.curriculum_goal_id);
    const mins = (goalForLesson as { default_minutes?: number })?.default_minutes ?? 30;

    // Set completed_at to keep the invariant (Bug 2).
    await supabase.from("lessons").update({
      completed: true,
      completed_at: new Date().toISOString(),
      date: today,
      scheduled_date: today,
      minutes_spent: mins,
    }).eq("id", nextLesson.id);

    // Recompute current_lesson from actual rows (Bug 3). No auto-insert of
    // the "next" lesson — modern goals pre-generate all rows 1..total, so
    // inserting here would create duplicate lesson_numbers (Bug 5) or place
    // rows on non-goal school days (Bug 4).
    if (goalForLesson) {
      await recomputeCurrentLesson(supabase, nextLesson.curriculum_goal_id);
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

    // No silent reschedule (CC: stop auto-bunching). The "finish a school
    // day earlier?" prompt was deferred to the Plan redesign.

    // Toast
    showCaptureToast("Extra lesson logged! 🌱", null);
    setExtraLessonLoading(null);
    onLogAction({ userId: user.id, childId: childId || undefined, actionType: "lesson" });
  }

  // ── Reschedule lesson functions ──────────────────────────────────────────────

  function openReschedule(lesson: Lesson) {
    setRescheduleLesson(lesson);
    setReschedulePicker(false);
    setReschedulePickerDate("");
  }

  // ── Missed lessons (past-dated incomplete) — actions ─────────────────────

  function getSchoolDaysForLesson(lesson: { curriculum_goal_id?: string | null }): string[] {
    if (lesson.curriculum_goal_id) {
      const days = goalSchoolDaysMap.get(lesson.curriculum_goal_id);
      if (days && days.length > 0) return days;
    }
    return schoolDaysArr.length > 0 ? schoolDaysArr : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  }

  async function markMissedComplete(lesson: MissedLesson) {
    const completedAt = new Date().toISOString();
    let mins: number | null = null;
    if (lesson.curriculum_goal_id) {
      const { data: goalRow } = await supabase
        .from("curriculum_goals")
        .select("default_minutes")
        .eq("id", lesson.curriculum_goal_id)
        .single();
      mins = (goalRow as { default_minutes?: number } | null)?.default_minutes ?? 30;
    }
    // Pin scheduled_date / date to today so the missed row's original
    // past slot doesn't keep flagging it as missed after the write.
    await supabase.from("lessons").update({
      completed: true,
      completed_at: completedAt,
      minutes_spent: mins,
      hours: mins != null ? mins / 60.0 : null,
      scheduled_date: today,
      date: today,
    }).eq("id", lesson.id);
    setMissedLessons(prev => prev.filter(l => l.id !== lesson.id));
    if (lesson.curriculum_goal_id) {
      await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
    }
    const missedLessonDate = lesson.scheduled_date ?? lesson.date;
    const missedDaysLate = missedLessonDate
      ? Math.max(0, Math.floor((new Date(today + "T00:00:00").getTime() - new Date(missedLessonDate + "T00:00:00").getTime()) / 86400000))
      : null;
    posthog.capture('lesson_completed_missed', {
      lesson_number: lesson.lesson_number ?? null,
      lesson_date: missedLessonDate,
      subject_label: lesson.curriculum_goals?.subject_label ?? null,
      days_late: missedDaysLate,
    });
    triggerGardenAnimation(lesson.child_id ?? undefined);
    earnLeaf();
    await refreshLeafCounts();
    if (effectiveUserId) {
      checkAndAwardBadges(effectiveUserId);
      onLogAction({ userId: effectiveUserId, childId: lesson.child_id ?? undefined, actionType: "lesson" });
    }
  }

  async function skipMissedLesson(lesson: MissedLesson) {
    return runReschedule(async () => {
      const originalDate = lesson.scheduled_date ?? lesson.date;
      if (!originalDate) return;
      const snapshot = buildLessonDateSnapshot([{ id: lesson.id, date: lesson.date, scheduled_date: lesson.scheduled_date }]);
      setMissedLessons(prev => prev.filter(l => l.id !== lesson.id));
      await supabase.from("lessons").update({ scheduled_date: null, date: null }).eq("id", lesson.id);
      showRescheduleUndo("Lesson skipped", snapshot);
    });
  }

  // ── Unconfirmed-prior-lesson prompt handlers ───────────────────────────
  // The prompt above today's lesson list asks "Did you finish [Subject] -
  // Lesson [current_lesson]?". Yes records the completion + advances the
  // queue by one; No drops a localStorage flag so the prompt stays hidden
  // for the rest of the calendar day. Both paths leave Today's main
  // render path untouched so a failed write does not strand the user on
  // a half-loaded page.

  async function confirmPriorLessonComplete(g: UnconfirmedGoal) {
    if (!effectiveUserId) return;
    if (confirmingGoalIds.has(g.goal_id)) return;
    setConfirmingGoalIds((prev) => {
      const next = new Set(prev);
      next.add(g.goal_id);
      return next;
    });
    try {
      const completedAtIso = new Date().toISOString();
      // Look up an existing row at the canonical lesson_number so we
      // UPDATE the row when it exists (preserves notes, title, minutes)
      // and INSERT only when no row was ever pre-generated for this
      // slot. lesson_number is the stable curriculum index; queue_position
      // gets nulled by the orphan-cleanup trigger and is not safe to key
      // on across the current_lesson advance below. Both rows get
      // is_backfill=true so the queue projector never re-spreads them
      // (Invariant 3) and the Today projector's `is_backfill !== true`
      // filter keeps them out of the daily list.
      const { data: existing } = await supabase
        .from("lessons")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("curriculum_goal_id", g.goal_id)
        .eq("lesson_number", g.current_lesson)
        .maybeSingle();

      if (existing && (existing as { id: string }).id) {
        const { error } = await supabase
          .from("lessons")
          .update({
            completed: true,
            completed_at: completedAtIso,
            // Pair the INSERT branch below: pin scheduled_date / date to
            // today so the existing row's stale future scheduled_date
            // doesn't ghost it back onto a future calendar day.
            scheduled_date: today,
            date: today,
            is_backfill: true,
            // Invariant 10: every lesson write stamps a scheduled_source.
            // 'wizard_create' is the closest existing tag for a confirmed
            // historical completion seeded from the queue position.
            scheduled_source: "wizard_create",
          })
          .eq("id", (existing as { id: string }).id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("lessons").insert({
          user_id: effectiveUserId,
          child_id: g.child_id,
          curriculum_goal_id: g.goal_id,
          lesson_number: g.current_lesson,
          queue_position: g.current_lesson,
          title: `${g.curriculum_name} — Lesson ${g.current_lesson}`,
          scheduled_date: today,
          date: today,
          completed: true,
          completed_at: completedAtIso,
          is_backfill: true,
          scheduled_source: "wizard_create",
          hours: 0,
        });
        if (error) throw error;
      }

      // Advance the queue pointer by one. Per spec: do not call
      // recomputeCurrentLesson here. Its formula would clamp
      // current_lesson back to max(queue_position) of completed rows,
      // which equals the value we just confirmed (no advance). The
      // confirmation prompt's contract is that Yes moves the family
      // forward by one lesson.
      await supabase
        .from("curriculum_goals")
        .update({ current_lesson: g.current_lesson + 1 })
        .eq("id", g.goal_id);

      // Hide the prompt locally before the reload lands so the card
      // disappears immediately.
      setNeedsConfirmation((prev) => prev.filter((u) => u.goal_id !== g.goal_id));
      // Pull Today's data again so the projector emits the next slot
      // (current_lesson + 1) as today's lesson.
      await loadData();
    } finally {
      setConfirmingGoalIds((prev) => {
        const next = new Set(prev);
        next.delete(g.goal_id);
        return next;
      });
    }
  }

  function dismissPriorLessonPrompt(g: UnconfirmedGoal) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        `rooted_dismissed_confirmation_${g.goal_id}_${today}`,
        "1",
      );
    }
    setNeedsConfirmation((prev) => prev.filter((u) => u.goal_id !== g.goal_id));
  }

  async function runMissedAddToNextDays() {
    return runReschedule(async () => {
      if (missedSheetSubmitting || missedLessons.length === 0) return;
      setMissedSheetSubmitting(true);
      // Snapshot uses missedLessons directly — those rows already carry both
      // date columns (loadData fetches them). Undo will restore each missed
      // lesson to its actual prior date, not "today".
      const snapshot = buildLessonDateSnapshot(missedLessons);

      // Density-aware date picking: fetch lessons_per_day per affected goal
      // and the existing forward-scheduled incomplete rows, so the planner
      // can skip dates that are already at capacity for the goal. Without
      // this the planner stacks missed lessons on top of forward-scheduled
      // ones (audited 2026-04-30 — see scheduler.ts:planAddToNextSchoolDays).
      const goalIds = [
        ...new Set(missedLessons.map((l) => l.curriculum_goal_id).filter(Boolean) as string[]),
      ];
      const perDayMap = new Map<string, number>();
      const density = new Map<string, number>();
      if (goalIds.length > 0) {
        const [{ data: goalRows }, { data: existingRows }] = await Promise.all([
          supabase.from("curriculum_goals").select("id, lessons_per_day").in("id", goalIds),
          supabase
            .from("lessons")
            .select("id, scheduled_date, date, curriculum_goal_id")
            .in("curriculum_goal_id", goalIds)
            .eq("completed", false),
        ]);
        for (const g of (goalRows ?? []) as { id: string; lessons_per_day: number | null }[]) {
          perDayMap.set(g.id, g.lessons_per_day ?? 1);
        }
        const missedIds = new Set(missedLessons.map((l) => l.id));
        for (const r of (existingRows ?? []) as { id: string; scheduled_date: string | null; date: string | null; curriculum_goal_id: string | null }[]) {
          if (missedIds.has(r.id)) continue;
          const d = r.scheduled_date ?? r.date;
          if (!d || !r.curriculum_goal_id) continue;
          const key = `${r.curriculum_goal_id}|${d}`;
          density.set(key, (density.get(key) ?? 0) + 1);
        }
      }
      const getLessonsPerDay = (l: { curriculum_goal_id?: string | null }) =>
        (l.curriculum_goal_id && perDayMap.get(l.curriculum_goal_id)) || 1;

      const { updates } = libPlanAddToNextSchoolDays(
        missedLessons,
        getSchoolDaysForLesson,
        today,
        density,
        getLessonsPerDay,
      );
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(({ id, newDate }) =>
            supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", id)
          )
        );
      }
      setMissedLessons([]);
      setShowMissedSheet(false);
      setMissedSheetSubmitting(false);
      const n = updates.length;
      showRescheduleUndo(`${n} lesson${n !== 1 ? "s" : ""} added to upcoming school days! Undo?`, snapshot);
      await loadData();
    });
  }

  async function runMissedPushBackNDays() {
    return runReschedule(async () => {
      if (missedSheetSubmitting || missedLessons.length === 0) return;
      setMissedSheetSubmitting(true);
      const { data: futureRows } = await supabase
        .from("lessons")
        .select("id, scheduled_date, date, curriculum_goal_id")
        .eq("user_id", effectiveUserId!)
        .eq("completed", false)
        .gte("scheduled_date", today)
        .order("scheduled_date", { ascending: true });
      const futureLessons = (futureRows ?? []) as { id: string; scheduled_date: string | null; date: string | null; curriculum_goal_id: string | null }[];
      // Snapshot covers BOTH the missed rows being filled in AND the future
      // rows being pushed back — undo restores the entire state.
      const snapshot = buildLessonDateSnapshot([...missedLessons, ...futureLessons]);
      const { updates } = libPlanPushBackNDays(missedLessons, futureLessons, getSchoolDaysForLesson, today);
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(({ id, newDate }) =>
            supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", id)
          )
        );
      }
      setMissedLessons([]);
      setShowMissedSheet(false);
      setMissedSheetSubmitting(false);
      const n = missedLessons.length;
      // Build a date-aware diff message that names which dates lost
      // lessons and where they landed. Snapshot covers both the missed
      // rows being filled in (no prior date → not counted as a "shift")
      // and the future rows being pushed forward.
      const oldByLessonId = new Map<string, string>();
      for (const s of snapshot) {
        const old = s.scheduled_date ?? s.date;
        if (old) oldByLessonId.set(s.id, old);
      }
      const message = buildPushBackMessage(oldByLessonId, updates, n);
      showRescheduleUndo(message, snapshot);
      await loadData();
    });
  }

  function showRescheduleUndo(message: string, snapshot: LessonDateSnapshot[]) {
    if (rescheduleUndoTimer.current) clearTimeout(rescheduleUndoTimer.current);
    const next = { message, snapshot };
    rescheduleUndoSnapshotRef.current = next;
    setRescheduleUndoToast(next);
    rescheduleUndoTimer.current = setTimeout(() => {
      rescheduleUndoSnapshotRef.current = null;
      setRescheduleUndoToast(null);
    }, 8000);
  }

  /**
   * Run a reschedule action through the idempotency gate. If the gate is
   * already busy, the second/third/fourth invocation is silently dropped.
   * The gate releases 1.5s after the action completes so a deliberate
   * second attempt is still possible without permanently disabling the UI.
   *
   * NOTE: undoReschedule deliberately does NOT go through this gate so the
   * user can always tap Undo, even if a stray re-fire of the original
   * action is still settling in the background.
   */
  async function runReschedule(fn: () => Promise<void>) {
    if (!reschedulingGateRef.current.tryEnter()) return;
    setRescheduleBusy(true);
    try {
      await fn();
    } finally {
      setTimeout(() => {
        reschedulingGateRef.current.exit();
        setRescheduleBusy(false);
      }, 1500);
    }
  }

  async function undoReschedule() {
    // Read from the ref — the ref is the single source of truth at click
    // time and never goes stale on re-render. Bail out if there's nothing
    // captured (button got tapped after auto-dismiss) or if the snapshot is
    // empty (defensive).
    const live = rescheduleUndoSnapshotRef.current;
    if (!live || live.snapshot.length === 0) return;
    const { snapshot } = live;
    // Literal restore — write both columns back to their captured values.
    // Failures bubble out; we don't swallow.
    for (let i = 0; i < snapshot.length; i += 20) {
      await Promise.all(
        snapshot.slice(i, i + 20).map((s) =>
          supabase.from("lessons").update({ date: s.date, scheduled_date: s.scheduled_date }).eq("id", s.id)
        )
      );
    }
    rescheduleUndoSnapshotRef.current = null;
    setRescheduleUndoToast(null);
    if (rescheduleUndoTimer.current) clearTimeout(rescheduleUndoTimer.current);
    // Refetch so Today's lessons + missed-lesson section reflect the undo.
    // Order matters for the regression guard: loadData first, then the story
    // refresh, so the user sees both lists update without a page reload.
    await loadData();
    await refreshTodayStory();
    showCaptureToast("Undo complete", null);
  }

  async function rescheduleMoveTo(targetDate: string) {
    return runReschedule(async () => {
      if (!rescheduleLesson) return;
      // Snapshot before write — capture both date columns so undo restores
      // exactly. Cover the case where the action started from a "From earlier"
      // row whose date is in the past.
      const { data: priorRow } = await supabase
        .from("lessons")
        .select("id, date, scheduled_date")
        .eq("id", rescheduleLesson.id)
        .maybeSingle();
      const snapshot = priorRow
        ? buildLessonDateSnapshot([priorRow as { id: string; date: string | null; scheduled_date: string | null }])
        : buildLessonDateSnapshot([{ id: rescheduleLesson.id, date: today, scheduled_date: today }]);
      await supabase.from("lessons").update({ scheduled_date: targetDate, date: targetDate }).eq("id", rescheduleLesson.id);
      setLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
      setMissedLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
      setRescheduleLesson(null);
      const priorDates = priorRow as { scheduled_date: string | null; date: string | null } | null;
      posthog.capture('lesson_rescheduled', {
        user_plan: isPro ? 'paid' : 'free',
        lesson_number: rescheduleLesson.lesson_number ?? null,
        old_date: priorDates?.scheduled_date ?? priorDates?.date ?? null,
        new_date: targetDate,
        curriculum_goal_id: rescheduleLesson.curriculum_goal_id ?? null,
      });
      const label = targetDate === localDateStr(new Date(new Date().setDate(new Date().getDate() + 1))) ? "Moved to tomorrow" : "Lesson rescheduled";
      showRescheduleUndo(`${label}! Undo?`, snapshot);
    });
  }

  async function reschedulePushAll() {
    return runReschedule(async () => {
      if (!rescheduleLesson?.curriculum_goal_id) return;
      const goalId = rescheduleLesson.curriculum_goal_id;

      // Get school_days for this goal
      const { data: goalRow } = await supabase.from("curriculum_goals")
        .select("school_days").eq("id", goalId).single();
      const schoolDays = (goalRow as { school_days?: string[] } | null)?.school_days ?? [];
      const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const activeDays = schoolDays.length > 0 ? new Set(schoolDays.map(d => dayMap[d] ?? -1)) : null;

      // Fetch all uncompleted future lessons for this goal — pull both date
      // columns so the snapshot can restore the exact prior state.
      const { data: futureLessons } = await supabase.from("lessons")
        .select("id, date, scheduled_date")
        .eq("curriculum_goal_id", goalId)
        .eq("completed", false)
        .gte("scheduled_date", today)
        .order("scheduled_date", { ascending: true });
      if (!futureLessons || futureLessons.length === 0) { setRescheduleLesson(null); return; }
      const futureRows = futureLessons as { id: string; date: string | null; scheduled_date: string | null }[];

      const snapshot = buildLessonDateSnapshot(futureRows);

      // Push each lesson to the next school day after its current date
      const updates: { id: string; newDate: string }[] = [];
      for (const lesson of futureRows) {
        if (!lesson.scheduled_date) continue;
        const cur = new Date(lesson.scheduled_date + "T12:00:00");
        let safety = 0;
        while (safety < 365) {
          cur.setDate(cur.getDate() + 1);
          const dayIdx = (cur.getDay() + 6) % 7;
          if (!activeDays || activeDays.has(dayIdx)) {
            updates.push({ id: lesson.id, newDate: localDateStr(cur) });
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
      // Date-aware diff message. Snapshot has both `date` and
      // `scheduled_date`; the original date is `scheduled_date ?? date`.
      // This action is "push by 1 school day" so daysPushed = 1.
      const oldByLessonId = new Map<string, string>();
      for (const s of snapshot) {
        const old = s.scheduled_date ?? s.date;
        if (old) oldByLessonId.set(s.id, old);
      }
      const message = buildPushBackMessage(oldByLessonId, updates, 1);
      showRescheduleUndo(message, snapshot);
    });
  }

  async function rescheduleDoubleUp() {
    return runReschedule(async () => {
      if (!rescheduleLesson?.curriculum_goal_id) return;
      const { data: priorRow } = await supabase
        .from("lessons")
        .select("id, date, scheduled_date")
        .eq("id", rescheduleLesson.id)
        .maybeSingle();
      const snapshot = priorRow
        ? buildLessonDateSnapshot([priorRow as { id: string; date: string | null; scheduled_date: string | null }])
        : buildLessonDateSnapshot([{ id: rescheduleLesson.id, date: today, scheduled_date: today }]);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = localDateStr(tomorrow);

      await supabase.from("lessons").update({ scheduled_date: tomorrowStr, date: tomorrowStr }).eq("id", rescheduleLesson.id);
      setLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
      setMissedLessons(prev => prev.filter(l => l.id !== rescheduleLesson.id));
      setRescheduleLesson(null);
      showRescheduleUndo("Doubled up tomorrow! Undo?", snapshot);
    });
  }

  async function rescheduleMissedDay() {
    return runReschedule(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Find ALL lessons scheduled for today (including completed — mom may want to undo a checked-off day)
    const todaysLessons = [...lessons];
    if (todaysLessons.length === 0) { setRescheduleLesson(null); return; }

    // Snapshot the full prior state of every targeted row.
    const { data: priorRows } = await supabase
      .from("lessons")
      .select("id, date, scheduled_date")
      .in("id", todaysLessons.map(l => l.id));
    const snapshot = buildLessonDateSnapshot((priorRows ?? []) as { id: string; date: string | null; scheduled_date: string | null }[]);

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
          supabase.from("lessons").update({
            scheduled_date: newDate,
            date: newDate,
            completed: false,
            completed_at: null,
            minutes_spent: null,
          }).eq("id", id)
        )
      );
    }

    // Lessons here got un-completed (completed: false, completed_at: null), so
    // current_lesson on every affected goal must be recomputed from actual
    // rows. Without this the cache stays at the pre-uncomplete max and the
    // queue projector keeps lessons hidden.
    for (const goalId of goalIds) {
      await recomputeCurrentLesson(supabase, goalId);
    }

    setLessons([]);
    setRescheduleLesson(null);
    showRescheduleUndo("All of today's lessons rescheduled! Undo?", snapshot);
    });
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
        const signed = await signedPhotoUrl(supabase, "memory-photos", path);
        photoUrl = signed ?? path;
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
    loadDataBusy.current = false;
    await loadData();
    await refreshTodayStory();
    checkAndAwardBadges(user.id);
    onLogAction({ userId: user.id, childId: bookChild || undefined, actionType: "book" });
  }

  async function saveDrawing() {
    if (!drawingTitle.trim()) return;
    const accessLevel = getUserAccess({ is_pro: isPro, trial_started_at: trialStartedAt });
    if (accessLevel === 'free' && totalPhotos >= 50) {
      setShowPhotoLimitModal(true);
      setSavingDrawing(false);
      return;
    }
    setSavingDrawing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingDrawing(false); return; }
    let photoUrl: string | null = null;
    if (drawingFile) {
      const compressed = await compressImage(drawingFile);
      const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (!upErr) {
        const signed = await signedPhotoUrl(supabase, "memory-photos", path);
        photoUrl = signed ?? path;
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
    loadDataBusy.current = false;
    await loadData();
    await refreshTodayStory();
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
    loadDataBusy.current = false;
    await loadData();
    await refreshTodayStory();
  }

  async function deleteFromEditSheet() {
    if (!editSheet) return;
    setEditDeleting(true);
    await supabase.from("memories").delete().eq("id", editSheet.id);
    setEditDeleting(false); setEditSheet(null);
    showCaptureToast("🗑️ Deleted", null);
    loadDataBusy.current = false;
    await loadData();
    await refreshTodayStory();
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

        {/* Lesson progress counter */}
        {totalToday > 0 && (
          <p className="text-[13px] mt-1" style={{ color: "rgba(255,255,255,0.82)" }}>
            {completedToday} of {totalToday} lesson{totalToday !== 1 ? "s" : ""} done
          </p>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-4 pb-7 space-y-5">

      {/* ═══════════════════════════════════════════════════════════
          VACATION BANNER — when today is inside an active vacation
          block. Lessons still render below; this just sets the tone.
          STEP 1 (vacation_blocks fetch) and STEP 2 (activeVacation
          state) live in loadData; banner only reads activeVacation.
         ═══════════════════════════════════════════════════════════ */}
      {!loading && activeVacation && (() => {
        // Resume date = end_date + 1 calendar day. We don't try to
        // walk to the next school_days entry — Brittany's spec
        // explicitly allowed the simple +1 approximation.
        const resumeDate = new Date(activeVacation.end_date + "T00:00:00");
        resumeDate.setDate(resumeDate.getDate() + 1);
        const resumeLabel = resumeDate.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        return (
          <div
            className="rounded-2xl px-4 py-3.5 flex items-start gap-3"
            style={{
              background: "#faf6f0",
              boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
            }}
          >
            <span className="text-xl shrink-0 leading-none mt-0.5" aria-hidden>☀️</span>
            <div className="flex-1 min-w-0">
              <p
                className="text-[15px] font-medium text-[#2d2926] leading-snug"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {activeVacation.name}
              </p>
              <p className="text-[12px] text-[#7a6f65] mt-0.5 leading-snug">
                Enjoy your break — school resumes {resumeLabel}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Getting Started — first 30 days, until both curriculum + memory exist */}
      {!loading && (() => {
        const hasCurriculum = curriculumGoalsCount > 0;
        const hasMemory = totalMemories > 0;
        const accountAgeDays = profileCreatedAt
          ? (Date.now() - new Date(profileCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
          : 0;
        const showGettingStarted = accountAgeDays < 30 && (!hasCurriculum || !hasMemory);
        if (!showGettingStarted) return null;
        return (
          <GettingStartedCard
            firstName={firstName || null}
            hasCurriculum={hasCurriculum}
            hasMemory={hasMemory}
            onAddCurriculum={() => router.push("/dashboard/plan")}
            onCaptureMemory={() => setShowMemoryPicker(true)}
          />
        );
      })()}

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

      {/* Trial badge — subtle info during first 22 days, UpgradeBanner handles last 8 */}
      {(() => {
        const access = getUserAccess({ is_pro: isPro, trial_started_at: trialStartedAt });
        if (access !== 'trial') return null;
        const left = getTrialDaysLeft(trialStartedAt);
        if (left <= 8) return null;
        if (isNativeApp) {
          return (
            <div className="flex items-center gap-2 bg-[#f0f7f0] border border-[#c8dfc8] rounded-xl px-3 py-2 mb-3">
              <span className="text-sm">🌿</span>
              <p className="text-[11px] text-[#5c7f63] font-medium flex-1">
                You&apos;re on your free Rooted+ trial · {left} day{left !== 1 ? 's' : ''} left
              </p>
              <span className="text-[11px] text-[#7a6f65] whitespace-nowrap">
                rootedhomeschoolapp.com
              </span>
            </div>
          );
        }
        return (
          <Link
            href="/upgrade"
            className="flex items-center gap-2 bg-[#f0f7f0] border border-[#c8dfc8] rounded-xl px-3 py-2 mb-3 hover:bg-[#e6f0e6] hover:border-[#a8cfa8] transition-colors group"
          >
            <span className="text-sm">🌿</span>
            <p className="text-[11px] text-[#5c7f63] font-medium flex-1">
              You&apos;re on your free Rooted+ trial · {left} day{left !== 1 ? 's' : ''} left
            </p>
            <span className="text-[11px] text-[#2d5a3d] font-semibold whitespace-nowrap group-hover:translate-x-0.5 transition-transform">
              Upgrade →
            </span>
          </Link>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          FROM EARLIER — past-dated incomplete lessons. Mom decides what
          to do with them: mark complete, skip, reschedule individually,
          or open the bulk reschedule sheet. Nothing moves silently.
         ═══════════════════════════════════════════════════════════ */}
      {/* TODO: remove after queue scheduling verified in production.
          "From earlier" missed-lesson section. Under queue scheduling
          there are no missed lessons. current_lesson stays put and the
          same lesson re-appears on Today next school day. Replaced by
          the Missed Lesson Recovery modal below which triggers whenever
          overdueLessonCount > 0 (once per tab session). */}
      {false && !loading && missedLessons.length > 0 && (() => {
        const missedItems = missedLessons.map((l) => ({
          id: l.id,
          kind: "lesson" as const,
          child_ids: [l.child_id],
          time: null,
          duration_minutes: l.minutes_spent,
          title: l.title,
          subject_label: resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label),
          lesson_number: l.lesson_number ?? null,
          completed: l.completed,
          raw: l,
        }));
        const grouped = groupItems(missedItems, children);
        const childrenLookup = new Map(children.map((c) => [c.id, { id: c.id, name: c.name, color: c.color }]));
        const onlyKid = children.length === 1;

        return (
          <div>
            <div className="flex items-center justify-between px-0.5 -mb-1">
              <p className="text-[13px] font-medium uppercase tracking-[0.8px] text-[#8a8580]">From earlier</p>
              <span className="text-[12px] text-[#b5aca4]">
                {missedLessons.length} lesson{missedLessons.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="bg-white rounded-2xl overflow-hidden mt-2" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="px-3 py-3">
                {grouped.kids.map((kidSection) => (
                  <TodayKidSection
                    key={kidSection.child.id}
                    section={kidSection}
                    onlyKid={onlyKid}
                    isPartner={isPartner}
                    childrenLookup={childrenLookup}
                    noteEditor={{
                      editingNoteId,
                      editingNoteText,
                      noteSaveState,
                      onNoteTextChange: setEditingNoteText,
                      onSaveNote: saveNote,
                      onCancelEditingNote: cancelEditingNote,
                    }}
                    handlers={{
                      onToggleLesson: (id) => {
                        if (isPartner) return;
                        const m = missedLessons.find((x) => x.id === id);
                        if (m) markMissedComplete(m);
                      },
                      onRescheduleLesson: (id) => {
                        const m = missedLessons.find((x) => x.id === id);
                        if (m) openReschedule(m);
                      },
                      onSkipLesson: (id) => {
                        const m = missedLessons.find((x) => x.id === id);
                        if (m) skipMissedLesson(m);
                      },
                      onStartEditingNote: (lessonId, currentNotes) => startEditingNote(lessonId, currentNotes),
                    }}
                  />
                ))}
                {!isPartner && (
                  <div className="pt-2 mt-1 border-t border-[#f0ece6]">
                    <button
                      type="button"
                      onClick={() => setShowMissedSheet(true)}
                      className="w-full text-left text-[13px] font-medium text-[#2D5A3D] hover:text-[var(--g-deep)] transition-colors py-1.5"
                    >
                      Reschedule these →
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          LESSONS FROM EARLIER — quiet notice for past-dated incomplete
          lessons under the queue model. No auto-reschedule, no alarm.
          Hidden on pace, hidden for brand-new users with no completions.
          Also hidden once the user has seen / acted on the Missed Lesson
          Recovery modal this session (gated on missedRecoveryDismissed).
         ═══════════════════════════════════════════════════════════ */}
      {!loading && overdueLessonCount > 0 && !missedRecoveryDismissed && (
        <Link
          href="/dashboard/plan"
          className="block px-3.5 py-2.5 rounded-xl bg-[#faf8f4] border border-[#e8e2d9] hover:bg-[#f4f0e8] transition-colors"
        >
          <p className="text-[12px] text-[#7a6f65]">
            {overdueLessonCount} lesson{overdueLessonCount !== 1 ? "s" : ""} from earlier
            <span className="text-[#5c7f63] font-medium ml-1">View in Plan →</span>
          </p>
        </Link>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TODAY SCHEDULE — grouped by kid + subject, kid color tints
         ═══════════════════════════════════════════════════════════ */}
      {!loading && (hasAnyLessons || todayActivities.length > 0 || todayAppointments.length > 0 || needsConfirmation.length > 0) && (
        <div>
          {activeVacation && (
            <p className="text-[11px] text-[#9a8f85] mb-2 px-0.5">
              Logging is optional today
            </p>
          )}
          {/* Unconfirmed-prior-lesson prompts. One card per affected goal,
              rendered at the very top of Today's lesson list so the
              question is the first thing mom sees on open. Hidden for
              partners (read-only context) since they cannot record
              completions on someone else's behalf. */}
          {!isPartner && needsConfirmation.length > 0 ? (
            <div className="space-y-2 mb-3">
              {needsConfirmation.map((g) => {
                const subjectLabel = (g.subject_label && g.subject_label.trim().length > 0)
                  ? g.subject_label
                  : g.curriculum_name;
                const busy = confirmingGoalIds.has(g.goal_id);
                return (
                  <div
                    key={g.goal_id}
                    className="rounded-2xl border border-[#e5dec5] bg-[#fdfaef] px-3.5 py-3"
                  >
                    <p className="text-[13px] text-[#5c4a1a] leading-snug">
                      Did you finish <span className="font-semibold">{subjectLabel}</span>
                      {" "}Lesson {g.current_lesson}?
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { void confirmPriorLessonComplete(g); }}
                        disabled={busy}
                        className="text-[12px] font-semibold text-white bg-[#2D5A3D] hover:opacity-90 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
                      >
                        {busy ? "Saving…" : "Yes, mark it done"}
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissPriorLessonPrompt(g)}
                        disabled={busy}
                        className="text-[12px] font-semibold text-[#5c4a1a] bg-white border border-[#e5dec5] hover:bg-[#f8f2e0] disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
                      >
                        No, show it today
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {/* Standalone "Log extra lessons" entry — quiet sage link sitting
              above the schedule card so families who blow past today's
              allocation can pull from the upcoming queue without hunting
              for the action. Hidden for partners (read-only) and when
              there are no curriculum lessons to log against. */}
          {hasAnyLessons && !isPartner ? (
            <button
              type="button"
              onClick={openExtraLessons}
              className="text-[12px] font-medium text-[#5c7f63] hover:text-[var(--g-deep)] mb-2 px-0.5 transition-colors"
            >
              + Log extra lessons
            </button>
          ) : null}
          <TodaySchedule
            lessons={lessons as never}
            activities={todayActivities as never}
            appointments={todayAppointments as never}
            children={children}
            isPartner={isPartner}
            isSchoolDay={isSchoolDay}
            handlers={{
              onToggleLesson: (id, completed) => { if (!isPartner) openCheckOffModal(id, completed); },
              onToggleActivity: (raw) => { if (!isPartner) toggleActivity(raw as TodayActivity); },
              onToggleAppointment: async (id, completed) => {
                if (isPartner) return;
                const appt = todayAppointments.find((a) => a.id === id);
                if (!appt) return;
                // Recurring series: don't toggle the base row (that would mark
                // every occurrence). Route through the confirmation modal,
                // which writes a per-date exception row. Already-completed
                // recurring instances are a no-op on re-tap.
                if (appt.is_recurring) {
                  if (completed) return;
                  setConfirmCompleteAppt({ id, title: appt.title, instance_date: appt.instance_date });
                  return;
                }
                const token = await getToken();
                if (!token) return;
                await fetch("/api/appointments", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, completed: !completed }) });
                loadData();
              },
              onEditLesson: (id) => { const l = lessons.find(x => x.id === id); if (l) openEdit(l); },
              // TODO: remove after queue scheduling verified in production.
              // Per-lesson reschedule + skip are pinned-date interventions
              // that the queue model replaces with auto-shift. Manual queue
              // reordering is a separate future PR.
              // onRescheduleLesson: (id) => { const l = lessons.find(x => x.id === id); if (l) openReschedule(l); },
              // onSkipLesson: (id) => { const l = lessons.find(x => x.id === id); if (l) skipLesson(l); },
              onDeleteLesson: deleteLesson,
              onStartEditingNote: (lessonId, currentNotes) => startEditingNote(lessonId, currentNotes),
              onManageAppointment: () => setShowManageSchedule(true),
              onLogExtra: openExtraLessons,
              onManage: () => setShowManageSchedule(true),
              onAddAppt: () => setShowApptWizard(true),
              onRunningLate: () => setShowRunningLate(true),
            }}
            noteEditor={{
              editingNoteId,
              editingNoteText,
              noteSaveState,
              onNoteTextChange: setEditingNoteText,
              onSaveNote: saveNote,
              onCancelEditingNote: cancelEditingNote,
            }}
          />
          <div className="bg-white rounded-2xl overflow-hidden mt-2" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)" }}>
            <InlineScheduleTabs
              children={children}
              onManage={() => setShowManageSchedule(true)}
              isPartner={isPartner}
            />
          </div>
        </div>
      )}


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
        if (isNativeApp) {
          return (
            <div className="block bg-[#faf6f0] border border-[#e8e2d9] rounded-xl px-4 py-3 text-sm text-[#7a6f65]">
              You have {50 - totalPhotos} photo{50 - totalPhotos !== 1 ? "s" : ""} left before new memories stop saving. Keep everything with Rooted+ at rootedhomeschoolapp.com.
            </div>
          );
        }
        return (
          <Link
            href="/upgrade"
            className="block bg-[#faf6f0] border border-[#e8e2d9] rounded-xl px-4 py-3 text-sm text-[#7a6f65] hover:bg-[#f5f0e8] transition-colors"
          >
            You have {50 - totalPhotos} photo{50 - totalPhotos !== 1 ? "s" : ""} left before new memories stop saving. Keep everything with Rooted+ →
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
          TODAY'S STORY — all memories logged today (only when non-empty)
         ═══════════════════════════════════════════════════════════ */}
      {todayStory.length > 0 && (
        <div className="today-story-section">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-2 px-0.5">Today&apos;s Story</p>

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
                    <SignedImage src={m.photo_url} bucket="memory-photos" alt="" className="w-[42px] h-[42px] rounded-lg object-cover shrink-0" />
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
          <Link href="/dashboard/memories" className="block text-center text-xs text-[#5c7f63] font-medium mt-2 hover:underline">
            See all memories →
          </Link>
        </div>
      )}

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
              const accessLevel = getUserAccess({ is_pro: isPro, trial_started_at: trialStartedAt });
              if (accessLevel === 'free' && totalPhotos >= 50) {
                setShowPhotoLimitModal(true);
                if (e.target) e.target.value = "";
                return;
              }
              setShowCaptureMenu(false);
              setShowMemoryPicker(false);
              try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) { console.error("[Photo capture] No user session"); return; }
                const compressed = await compressImage(file);
                const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
                const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
                if (upErr) { console.error("[Photo capture] Upload failed:", upErr.message); showCaptureToast("Upload failed — try again", null); return; }
                const signed = await signedPhotoUrl(supabase, "memory-photos", path);
                const photoUrl = signed ?? path;
                const memType = captureTypeRef.current;
                const now = new Date().toISOString();
                const { data: ins, error: insErr } = await supabase.from("memories").insert({
                  user_id: user.id, type: memType, title: '',
                  photo_url: photoUrl, child_id: null,
                  date: today, include_in_book: false,
                  created_at: now, updated_at: now,
                }).select("id").single();
                if (insErr) { console.error("[Photo capture] Insert failed:", insErr.message, insErr.code, insErr.details); showCaptureToast("Save failed — try again", null); return; }
                console.log("[Rooted] Saved:", memType, ins);
                const toastMsg = memType === "drawing" ? "🎨 Drawing saved 🌿" : "📸 Memory saved 🌿";
                showCaptureToast(toastMsg, (ins as { id: string } | null)?.id ?? null, memType, null);
                captureTypeRef.current = "photo"; // reset
                setTotalMemories(prev => prev + 1);
                loadDataBusy.current = false;
                await loadData();
                await refreshTodayStory();
                checkAndAwardBadges(user.id);
                onLogAction({ userId: user.id, actionType: memType === "drawing" ? "drawing" : "memory" });
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

      {/* ── Mark recurring occurrence done ────────────────── */}
      {confirmCompleteAppt && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-base font-bold text-[#2d2926]">
                Mark {confirmCompleteAppt.title} as done for today?
              </h2>
            </div>
            <div className="flex items-center gap-2 px-6 pb-6 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCompleteAppt(null)}
                className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmCompleteAppt;
                  setConfirmCompleteAppt(null);
                  const token = await getToken();
                  if (!token) return;
                  await fetch("/api/appointments/complete-occurrence", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ id: target.id, instance_date: target.instance_date }),
                  });
                  loadData();
                }}
                className="flex-1 min-h-[44px] text-sm font-bold text-white rounded-xl transition-colors"
                style={{ backgroundColor: "#2D5A3D" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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
                // Group by child → subject. Lessons within each subject
                // already arrive in lesson_number ascending order from
                // openExtraLessons (queue projection sort). Brittany:
                // "everything should be in numerical order unless a mom
                // needs a particular lesson moved out of order."
                const byChild = new Map<string, UpcomingLesson[]>();
                for (const l of upcomingLessons) {
                  const key = l.child_id ?? "__none__";
                  if (!byChild.has(key)) byChild.set(key, []);
                  byChild.get(key)!.push(l);
                }
                return Array.from(byChild.entries()).map(([childId, childLessons]) => {
                  const child = children.find(c => c.id === childId);
                  const kidColor = child?.color ?? "#7a6f65";
                  const kidTint = tintFromHex(kidColor, 0.25);
                  const kidDark = darkenHex(kidColor, 0.45);
                  // Sub-group within child: subject_label → lessons.
                  const bySubject = new Map<string, UpcomingLesson[]>();
                  for (const l of childLessons) {
                    const subj = resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label) ?? "Other";
                    if (!bySubject.has(subj)) bySubject.set(subj, []);
                    bySubject.get(subj)!.push(l);
                  }
                  return (
                    <div key={childId} className="mb-5">
                      {child && <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: kidDark }}>{child.name}</p>}
                      {Array.from(bySubject.entries()).map(([subject, subjectLessons]) => {
                        const subjColor = subjectLessons[0]?.subjects?.color ?? null;
                        return (
                          <div key={subject} className="mb-3 last:mb-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: subjColor ?? "#7a6f65" }}>
                              {subject}
                            </p>
                            <div className="space-y-1">
                              {subjectLessons.map(l => {
                                const isChecked = extraChecked.has(l.id);
                                return (
                                  <button
                                    key={l.id}
                                    type="button"
                                    onClick={() => setExtraChecked(prev => { const n = new Set(prev); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                                    style={{
                                      background: isChecked ? kidTint : "white",
                                      border: `1px solid ${isChecked ? kidColor : "#f0ede8"}`,
                                    }}
                                  >
                                    <div
                                      className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
                                      style={{
                                        background: isChecked ? kidColor : "transparent",
                                        borderColor: isChecked ? kidColor : "#c8bfb5",
                                      }}
                                    >
                                      {isChecked && <span className="text-white text-[10px] font-bold">✓</span>}
                                    </div>
                                    <span className="flex-1 min-w-0 text-sm text-[#2d2926]">{l.title}</span>
                                    <span className="text-[10px] text-[#b5aca4] shrink-0">
                                      {new Date(l.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
            <div className="px-5 py-4 border-t border-[#f0ede8]">
              {/* Out-of-order selection warning. Derives the next-expected
                  lesson per goal directly from upcomingLessons (the lowest
                  lesson_number for each goal_id IS what mom would log next),
                  so we don't depend on a separate current_lesson state map
                  that may not be populated on first render. Informational
                  only; the save path is unchanged. */}
              {(() => {
                const skippedNums = new Set<number>();

                for (const lesson of upcomingLessons) {
                  if (!extraChecked.has(lesson.id)) continue;
                  if (!lesson.curriculum_goal_id || lesson.lesson_number == null) continue;

                  // Find the lowest lesson_number for this goal = next expected lesson
                  const lowestForGoal = upcomingLessons
                    .filter(l => l.curriculum_goal_id === lesson.curriculum_goal_id && l.lesson_number != null)
                    .reduce((min, l) => (l.lesson_number! < min ? l.lesson_number! : min), lesson.lesson_number!);

                  // If selected lesson is not the next expected, everything between is skipped
                  if (lesson.lesson_number > lowestForGoal) {
                    for (let n = lowestForGoal; n < lesson.lesson_number; n++) {
                      skippedNums.add(n);
                    }
                  }
                }

                // Remove lesson numbers the user is actually logging — they're not skipped
                for (const l of upcomingLessons) {
                  if (extraChecked.has(l.id) && l.lesson_number != null) {
                    skippedNums.delete(l.lesson_number);
                  }
                }

                if (skippedNums.size === 0) return null;

                const sorted = Array.from(skippedNums).sort((a, b) => a - b);
                const lo = sorted[0];
                const hi = sorted[sorted.length - 1];
                const message =
                  sorted.length === 1
                    ? `Heads up, this skips lesson ${lo}. It won't appear as completed in your plan.`
                    : `Heads up, this skips lessons ${lo} through ${hi}. They won't appear as completed in your plan.`;

                return (
                  <p className="text-[12px] text-[#a06b00] bg-[#fef9e8] border border-[#f0dda8] rounded-lg px-3 py-2 mb-3 leading-snug">
                    {message}
                  </p>
                );
              })()}
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
                  loadDataBusy.current = false;
                  await loadData();
                  await refreshTodayStory();
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
      {/* TODO: remove after queue scheduling verified in production.
          Per-lesson reschedule modal — pinned-date manipulation that
          the queue model auto-handles. Gate is `rescheduleLesson && false`
          so TS narrowing still applies inside the IIFE. */}
      {rescheduleLesson && false && (() => {
        // Narrow to non-null inside the IIFE — TS doesn't carry the
        // outer && narrowing across the closure boundary.
        const rl = rescheduleLesson!;
        const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
        const tmrwStr = localDateStr(tmrw);
        const tmrwLabel = tmrw.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
        const curricName = rl.title?.replace(/ — Lesson.*$/, "") ?? "";
        return (
          <>
            <div className="fixed inset-0 bg-black/30 z-[80]" onClick={() => setRescheduleLesson(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto">
              <div className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-[var(--g-deep)]" style={{ fontFamily: "var(--font-display)" }}>
                    Reschedule {rl.title || "this lesson"}
                  </h3>
                  <button onClick={() => setRescheduleLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none p-1">✕</button>
                </div>
                {/* Options */}
                <div className="space-y-3">
                  {/* Move to tomorrow */}
                  <button
                    onClick={() => rescheduleMoveTo(tmrwStr)}
                    disabled={rescheduleBusy}
                    className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
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
                          disabled={!reschedulePickerDate || reschedulePickerDate < today || rescheduleBusy}
                          className="px-5 py-2.5 bg-[#5c7f63] text-white text-sm font-medium rounded-xl disabled:opacity-40 disabled:pointer-events-none hover:bg-[var(--g-deep)] transition-colors"
                        >
                          Move
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Curriculum-specific options */}
                  {rl.curriculum_goal_id && (
                    <>
                      {/* Push all remaining */}
                      <button
                        onClick={() => reschedulePushAll()}
                        disabled={rescheduleBusy}
                        className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
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
                        disabled={rescheduleBusy}
                        className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
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
                      disabled={rescheduleBusy}
                      className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
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

      {/* ── Missed-lesson reschedule sheet ──────────────────── */}
      {/* TODO: remove after queue scheduling verified in production.
          The "Add to next school day" / "Push back N days" actions are
          pinned-date reshuffles. Queue model removes the missed concept. */}
      {false && showMissedSheet && missedLessons.length > 0 && (() => {
        const n = missedLessons.length;
        return (
          <>
            <div className="fixed inset-0 bg-black/30 z-[80]" onClick={() => { if (!missedSheetSubmitting) setShowMissedSheet(false); }} />
            <div className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto">
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-[var(--g-deep)]" style={{ fontFamily: "var(--font-display)" }}>
                    Reschedule {n} missed lesson{n !== 1 ? "s" : ""}
                  </h3>
                  <button
                    onClick={() => { if (!missedSheetSubmitting) setShowMissedSheet(false); }}
                    className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none p-1"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={missedSheetSubmitting || rescheduleBusy}
                    onClick={() => runMissedAddToNextDays()}
                    className="w-full flex items-center gap-3 p-4 rounded-xl shadow-sm text-left transition-colors hover:bg-[#f0f7f1] disabled:opacity-50 disabled:pointer-events-none"
                    style={{ background: "#f8fdf9", border: "1.5px solid #b8d89a" }}
                  >
                    <span className="text-lg shrink-0">📅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2d3a2e]">Add to my next school day{n === 1 ? "" : "s"}</p>
                      <p className="text-xs text-[#9a8e84] mt-0.5">
                        Place {n === 1 ? "this lesson" : `these ${n} lessons`} on the next available school day{n === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="text-[#b8d89a] text-base shrink-0">›</span>
                  </button>
                  <button
                    type="button"
                    disabled={missedSheetSubmitting || rescheduleBusy}
                    onClick={() => runMissedPushBackNDays()}
                    className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <span className="text-lg shrink-0">⏭</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2d3a2e]">Push my schedule back {n} school day{n !== 1 ? "s" : ""}</p>
                      <p className="text-xs text-[#9a8e84] mt-0.5">
                        Shifts upcoming lessons back {n} school day{n !== 1 ? "s" : ""} and fits {n === 1 ? "the missed lesson" : `the ${n} missed lessons`} in
                      </p>
                    </div>
                    <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                  </button>
                </div>
              </div>
              <div className="h-6" />
            </div>
          </>
        );
      })()}

      {/* ── Missed Lesson Recovery modal (Path A queue scheduling) ──
           Trigger logic in loadData. YES marks missed rows complete on
           their gap dates and recomputes current_lesson per goal; NO is
           a no-op write but still refreshes Today + Memories. Session-
           storage flag `rooted_missed_lesson_prompt_shown` gates re-show. */}
      {showMissedRecovery && (
        <MissedLessonRecoveryModal
          goals={missedGoals}
          entriesByGoal={missedEntriesByGoal}
          onYes={handleMissedRecoveryYes}
          onNo={handleMissedRecoveryNo}
        />
      )}
      {recoveryToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg">
            Got it. Today is updated.
          </div>
        </div>
      )}

      {/* ── Reschedule undo toast ────────────────────────────
           The whole pill is the tap target — the bare "Undo" word was a
           ~30px hit area on a phone, easy to miss. Now any tap on the
           toast triggers the restore.
        ──────────────────────────────────────────────────── */}
      {rescheduleUndoToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <button
            type="button"
            onClick={() => undoReschedule()}
            aria-label={`${rescheduleUndoToast.message} Tap to undo.`}
            className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg flex items-center gap-3 min-h-[44px] active:opacity-90 transition-opacity"
          >
            <span>{rescheduleUndoToast.message}</span>
            <span className="text-white font-semibold underline text-sm">
              Undo
            </span>
          </button>
        </div>
      )}

      {/* ── Delete undo toast (5s window before DB delete) ──── */}
      {pendingDelete && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-lg flex items-center gap-3">
            <span>Lesson deleted</span>
            <button
              onClick={() => undoDelete()}
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
                    loadDataBusy.current = false;
                    await loadData();
                    await refreshTodayStory();
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

      {showPhotoLimitModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPhotoLimitModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-3xl mb-3">📷</div>
            <h2 className="text-lg font-bold text-[#2d2926] mb-2">You&apos;ve reached 50 photos</h2>
            <p className="text-sm text-[#7a6f65] mb-5">Upgrade to Rooted+ to keep saving photos and drawings. Your other memories — wins, books, field trips — are always unlimited.</p>
            <a href="/dashboard/settings?tab=account" className="block w-full py-3 rounded-xl text-white font-semibold text-sm bg-[#2D5A3D] hover:opacity-90 transition-opacity">
              Upgrade to Rooted+
            </a>
            <button onClick={() => setShowPhotoLimitModal(false)} className="mt-3 text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors">
              Maybe later
            </button>
          </div>
        </div>
      )}

      </div>
    </>
  );
}
