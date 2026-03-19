"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, ChevronDown, MapPin } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type GradeTag = "All Ages" | "K–2" | "3–5" | "6–8" | "9–12";
const GRADE_TAGS: GradeTag[] = ["All Ages", "K–2", "3–5", "6–8", "9–12"];
type RegLevel = "none" | "low" | "moderate" | "high";

type DbResource = {
  id: string; category: string; title: string; description: string;
  url: string; grade_level: string; badge_text: string;
  metadata: Record<string, unknown>;
};
type FreshDrop = { name: string; desc: string; type: string; grade: GradeTag; url: string; emoji: string; };
type EasyWin   = { emoji: string; title: string; desc: string; time: string; grade: string; };

// ─── State Requirements (all 50 states) ──────────────────────────────────────

const LEVEL_LABELS: Record<RegLevel, { label: string; color: string; bg: string }> = {
  none:     { label: "No notice required", color: "#2d5c38", bg: "#e4f0e6" },
  low:      { label: "Low regulation",     color: "#5c6420", bg: "#f0f4d8" },
  moderate: { label: "Moderate",           color: "#7a5020", bg: "#f5e8d8" },
  high:     { label: "High regulation",    color: "#7a2020", bg: "#f5e0e0" },
};

const STATE_REQS: Record<string, { level: RegLevel; summary: string }> = {
  "Alabama":        { level: "low",      summary: "File a church school notice with the local church school. Teach required subjects. No testing required." },
  "Alaska":         { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Arizona":        { level: "low",      summary: "File affidavit with county school superintendent annually. Must teach required subjects." },
  "Arkansas":       { level: "moderate", summary: "File notice of intent with local superintendent. Annual standardized testing required in grades 5, 7, 10." },
  "California":     { level: "low",      summary: "File Private School Affidavit annually. Required subjects: English, math, social science, science, art, music, PE, health." },
  "Colorado":       { level: "low",      summary: "File notice of intent with local school district. Annual assessment required." },
  "Connecticut":    { level: "none",     summary: "No notice required. Must provide instruction in equivalent subjects to public school." },
  "Delaware":       { level: "moderate", summary: "File with local school district. 180 days required. Must follow state curriculum guidelines." },
  "Florida":        { level: "low",      summary: "File notice with county superintendent. Annual evaluation by a Florida-certified teacher or standardized test." },
  "Georgia":        { level: "low",      summary: "File Declaration of Intent with local school superintendent. Keep annual attendance records." },
  "Hawaii":         { level: "moderate", summary: "Register with Department of Education. Submit curriculum. Annual assessment required." },
  "Idaho":          { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Illinois":       { level: "none",     summary: "No notice required. Must provide instruction in state subjects." },
  "Indiana":        { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Iowa":           { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Kansas":         { level: "none",     summary: "No notice required. Must teach required subjects in English." },
  "Kentucky":       { level: "low",      summary: "Notify local superintendent. Attend 185 days per year. Keep attendance records." },
  "Louisiana":      { level: "low",      summary: "Submit letter of intent to local school board. Teach required subjects." },
  "Maine":          { level: "moderate", summary: "File annual approval with local superintendent. Submit curriculum and annual assessment plan." },
  "Maryland":       { level: "moderate", summary: "File notification with local superintendent. Annual portfolio review or standardized test." },
  "Massachusetts":  { level: "high",     summary: "Get annual approval from local school committee. Submit curriculum. Must demonstrate instruction in required subjects and hours." },
  "Michigan":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Minnesota":      { level: "moderate", summary: "File annual assessment report with local district. Required subjects must be taught." },
  "Mississippi":    { level: "low",      summary: "File notice of intent with local superintendent. Attend 180 days per year." },
  "Missouri":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Montana":        { level: "low",      summary: "File notice with county superintendent. Teach required subjects 180 days per year." },
  "Nebraska":       { level: "moderate", summary: "Notify superintendent. Provide equivalent instruction in required subjects. Record-keeping recommended." },
  "Nevada":         { level: "low",      summary: "File notification with school district. Teach required subjects, 180 school days." },
  "New Hampshire":  { level: "moderate", summary: "File annual notice. Annual assessment or portfolio review required." },
  "New Jersey":     { level: "none",     summary: "No notice required. Must cover required subjects." },
  "New Mexico":     { level: "low",      summary: "File with public school district. Must teach required subjects." },
  "New York":       { level: "high",     summary: "Submit Individualized Home Instruction Plan (IHIP). Quarterly reports and annual assessments required." },
  "North Carolina": { level: "moderate", summary: "File notice of intent. Maintain attendance records. Annual standardized test required." },
  "North Dakota":   { level: "high",     summary: "Parent must have a teaching certificate, or use an accredited correspondence program, or pass a teacher competency test." },
  "Ohio":           { level: "moderate", summary: "File notice with local superintendent. Required subjects must be taught. Annual assessment." },
  "Oklahoma":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Oregon":         { level: "moderate", summary: "File notice with ESD. Annual assessment for students in grades 3, 5, 8, and 10." },
  "Pennsylvania":   { level: "high",     summary: "File annual affidavit. 180 days instruction. Portfolio review by a licensed supervisor or notarized test results." },
  "Rhode Island":   { level: "moderate", summary: "File notice and curriculum with local school committee. Annual approval required." },
  "South Carolina": { level: "moderate", summary: "Choose from 3 accountability options. Most require membership in an approved home school association." },
  "South Dakota":   { level: "low",      summary: "File annual notice of intent with local superintendent." },
  "Tennessee":      { level: "low",      summary: "File notice with local superintendent. Annual assessment required. Parent must have high school diploma." },
  "Texas":          { level: "none",     summary: "No notice required. Instruction must include required subjects in a bona fide manner." },
  "Utah":           { level: "low",      summary: "File an affidavit with the local school board. Teach required subjects." },
  "Vermont":        { level: "high",     summary: "Enroll with state. Annual assessment. Must cover specific subjects and hours." },
  "Virginia":       { level: "moderate", summary: "File notice of intent with division superintendent. Annual assessment or portfolio review required." },
  "Washington":     { level: "moderate", summary: "File annual Declaration of Intent. Annual assessment required in grades 4, 8, and 11." },
  "West Virginia":  { level: "high",     summary: "Notify county superintendent. Annual assessment. Parent must hold a high school diploma or higher." },
  "Wisconsin":      { level: "none",     summary: "No notice required. Must provide equivalent instruction in required subjects." },
  "Wyoming":        { level: "low",      summary: "Notify local board of trustees. Teach required subjects 175 days per year." },
};

// ─── Fresh Drops Pool ─────────────────────────────────────────────────────────

const FRESH_DROPS_POOL: FreshDrop[] = [
  { emoji: "🔭", name: "NASA Virtual Tours",            type: "Field Trip",  grade: "6–8",      url: "https://www.nasa.gov/learning-resources/virtual-tours",                   desc: "Tour Kennedy Space Center and the ISS in 360° — totally free." },
  { emoji: "📖", name: "Khan Academy",                  type: "Free Tools",  grade: "All Ages", url: "https://www.khanacademy.org",                                             desc: "100% free, world-class education for any age or subject." },
  { emoji: "🎨", name: "Google Arts & Culture",         type: "Field Trip",  grade: "All Ages", url: "https://artsandculture.google.com",                                       desc: "Virtual museum tours from hundreds of the world's greatest institutions." },
  { emoji: "🧪", name: "Crystal Growing",               type: "Science",     grade: "3–5",      url: "https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p015/chemistry/crystal-growing", desc: "Grow stunning crystals at home — a perfect multi-day science project." },
  { emoji: "🌿", name: "Starfall",                      type: "Printables",  grade: "K–2",      url: "https://www.starfall.com",                                                desc: "Free phonics, early reading games, and printables for young learners." },
  { emoji: "🦒", name: "San Diego Zoo Virtual Safari",  type: "Field Trip",  grade: "K–2",      url: "https://zoo.sandiegozoo.org/virtual-field-trips",                         desc: "Live cams and virtual field trips featuring giraffes, pandas, and more." },
  { emoji: "📐", name: "Math-Drills.com",               type: "Printables",  grade: "3–5",      url: "https://www.math-drills.com",                                             desc: "Thousands of free, no-login math worksheets from arithmetic to algebra." },
  { emoji: "🌋", name: "Baking Soda Volcano",           type: "Science",     grade: "K–2",      url: "https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p10/chemistry/baking-soda-vinegar-volcano", desc: "The classic acid-base eruption — add dish soap for dramatic foam." },
  { emoji: "🌊", name: "Monterey Bay Aquarium",         type: "Field Trip",  grade: "All Ages", url: "https://www.montereybayaquarium.org/animals/live-cams",                   desc: "Watch sharks, otters, and jellyfish live 24/7. Lesson plans included." },
  { emoji: "📚", name: "ReadWorks",                     type: "Printables",  grade: "3–5",      url: "https://www.readworks.org",                                               desc: "Free reading comprehension passages with question sets for K–12." },
  { emoji: "🏔️", name: "Yellowstone National Park",    type: "Field Trip",  grade: "3–5",      url: "https://www.nps.gov/yell/learn/photosmultimedia/virtualtours.htm",         desc: "Ranger-led virtual tours, live geyser cams, and downloadable field journals." },
  { emoji: "⚡", name: "Homemade Electromagnet",        type: "Science",     grade: "6–8",      url: "https://www.sciencebuddies.org/science-fair-projects/project-ideas/Elec_p014", desc: "A nail + copper wire + 9V battery = a working magnet. Teaches electromagnetism." },
  { emoji: "📖", name: "CK-12",                         type: "Printables",  grade: "6–8",      url: "https://www.ck12.org",                                                    desc: "Free, customizable digital textbooks and simulations for every subject." },
  { emoji: "🌍", name: "National Geographic Classroom", type: "Field Trip",  grade: "6–8",      url: "https://www.nationalgeographic.org/education/classroom-resources",        desc: "Short docs, photo essays, and interactives on science, culture, and nature." },
  { emoji: "🎭", name: "Teachers Pay Teachers (Free)",  type: "Printables",  grade: "All Ages", url: "https://www.teacherspayteachers.com/Browse/Price-Range/Free",             desc: "Thousands of free units and lesson plans made by real educators." },
];

// ─── Easy Wins ────────────────────────────────────────────────────────────────

const EASY_WINS: EasyWin[] = [
  { emoji: "🎨", title: "Salt Tray Writing",          desc: "Pour salt in a tray, practice spelling words or letters with a finger.",                  time: "5 min",    grade: "K–2"      },
  { emoji: "🔭", title: "Shadow Tracing",             desc: "Trace your shadow at different times of day. Watch it move and discuss why.",              time: "10 min",   grade: "All Ages" },
  { emoji: "📚", title: "Audiobook Hour",             desc: "Put on a great audiobook and do a puzzle together. Zero prep, total engagement.",          time: "0 min prep", grade: "All Ages" },
  { emoji: "🌿", title: "Nature Alphabet Hunt",       desc: "Go outside and find something in nature for each letter of the alphabet.",                 time: "15 min",   grade: "K–5"      },
  { emoji: "🍳", title: "Kitchen Math",               desc: "Double a recipe together. Real fractions, real reward, and everyone eats the results.",   time: "20 min",   grade: "3–8"      },
  { emoji: "🎭", title: "History Podcast",            desc: "Put on a 'Stuff You Missed in History Class' episode during lunch or craft time.",         time: "0 min prep", grade: "All Ages" },
];

const EASY_WIN_COLORS = [
  { bg: "#fffbec", border: "#f0e0a8" },
  { bg: "#ecf8ff", border: "#a8d8f0" },
  { bg: "#f0faec", border: "#b4dca8" },
  { bg: "#fdf0fa", border: "#dca8d8" },
  { bg: "#fff5ec", border: "#f0c8a8" },
  { bg: "#ecf0fa", border: "#a8b4dc" },
];

const PICK_CARD_COLORS = [
  { bg: "#eef5ec", accent: "#3d7045" },
  { bg: "#fef5e4", accent: "#8b6820" },
  { bg: "#e4f2fb", accent: "#1a5c80" },
  { bg: "#fae4ee", accent: "#801a3c" },
  { bg: "#eee4fa", accent: "#4a1a80" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function getFreshDrops(): FreshDrop[] {
  const week = getISOWeekNumber(new Date());
  const n = FRESH_DROPS_POOL.length;
  return [FRESH_DROPS_POOL[week % n], FRESH_DROPS_POOL[(week + 5) % n], FRESH_DROPS_POOL[(week + 10) % n]];
}

function dropId(name: string): string {
  return `drop-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function getDiscountEmoji(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("curriculum") || t.includes("book") || t.includes("read")) return "📚";
  if (t.includes("art") || t.includes("craft"))   return "🎨";
  if (t.includes("music"))                         return "🎵";
  if (t.includes("science") || t.includes("lab"))  return "🔬";
  if (t.includes("sport") || t.includes("gym"))    return "⚽";
  if (t.includes("tech") || t.includes("code"))    return "💻";
  if (t.includes("museum") || t.includes("zoo"))   return "🏛️";
  if (t.includes("online") || t.includes("digital")) return "🖥️";
  return "🏷️";
}

function getTripEmoji(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("space") || t.includes("nasa") || t.includes("star")) return "🚀";
  if (t.includes("ocean") || t.includes("aquarium") || t.includes("sea") || t.includes("bay")) return "🌊";
  if (t.includes("zoo") || t.includes("animal") || t.includes("safari")) return "🦁";
  if (t.includes("museum") || t.includes("history") || t.includes("smithsonian")) return "🏛️";
  if (t.includes("art") || t.includes("culture")) return "🎨";
  if (t.includes("national") || t.includes("park") || t.includes("yellowstone")) return "🌲";
  if (t.includes("science") || t.includes("geographic")) return "🔬";
  return "🌍";
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const CONTENT_TABS = [
  { id: "discounts",  label: "💰 Discounts"  },
  { id: "trips",      label: "🌍 Field Trips" },
  { id: "printables", label: "🖨️ Printables" },
  { id: "science",    label: "🔬 Science"    },
  { id: "states",     label: "🗺️ By State"  },
  { id: "saved",      label: "🔖 Saved"      },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-5 animate-pulse shadow-sm">
          <div className="h-4 bg-gray-200 rounded-full w-3/4 mb-3" />
          <div className="h-3 bg-gray-100 rounded-full w-full mb-2" />
          <div className="h-3 bg-gray-100 rounded-full w-1/2 mb-3" />
          <div className="flex gap-2">
            <div className="h-5 w-14 bg-gray-100 rounded-full" />
            <div className="h-5 w-20 bg-gray-100 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BookmarkBtn({ id, savedMap, onToggle }: { id: string; savedMap: Record<string, string>; onToggle: (id: string) => void }) {
  const saved = Boolean(savedMap[id]);
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(id); }}
      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        saved ? "bg-[#e4f0e6] text-[#4a7c59] hover:bg-[#d4e8d6]" : "bg-[#f5f3f0] text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#ede8e2]"
      }`}
      title={saved ? "Remove bookmark" : "Save resource"}
    >
      {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
    </button>
  );
}

function GradePill({ grade }: { grade: string }) {
  return (
    <span className="bg-[#e8f0e9] text-[#3d5c42] rounded-full px-2 py-0.5 text-xs font-semibold">
      {grade}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { effectiveUserId } = usePartner();

  const [activeTab,     setActiveTab]     = useState("discounts");
  const [gradeFilter,   setGradeFilter]   = useState<GradeTag | "">("");
  const [stateSearch,   setStateSearch]   = useState("");
  const [selectedLevel, setSelectedLevel] = useState<RegLevel | "all">("all");
  const [expandedState, setExpandedState] = useState<string | null>(null);
  const [savedMap,      setSavedMap]      = useState<Record<string, string>>({});
  const [loadingSaved,  setLoadingSaved]  = useState(true);
  const [dbResources,   setDbResources]   = useState<DbResource[]>([]);
  const [dbLoading,     setDbLoading]     = useState(true);
  const [userState,     setUserState]     = useState<string | null>(null);
  const [stateLoaded,   setStateLoaded]   = useState(false);

  const stateRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Load DB resources
  useEffect(() => {
    supabase
      .from("resources")
      .select("id, category, title, description, url, grade_level, badge_text, metadata")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setDbResources(data as DbResource[]);
        setDbLoading(false);
      });
  }, []);

  // Load user state from profile
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("profiles")
      .select("state")
      .eq("id", effectiveUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error) {
          setUserState((data as { state?: string } | null)?.state ?? null);
        }
        setStateLoaded(true);
      });
  }, [effectiveUserId]);

  // Load saved resources
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("app_events")
      .select("id, payload")
      .eq("user_id", effectiveUserId)
      .eq("type", "saved_resource")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        data?.forEach((e) => { if (e.payload?.resource_id) map[e.payload.resource_id] = e.id; });
        setSavedMap(map);
        setLoadingSaved(false);
      });
  }, [effectiveUserId]);

  // Auto-scroll to user's state when switching to states tab
  useEffect(() => {
    if (activeTab === "states" && userState && stateRefs.current[userState]) {
      setTimeout(() => stateRefs.current[userState!]?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    }
  }, [activeTab, userState]);

  const toggleSave = useCallback(async (resourceId: string) => {
    if (!effectiveUserId) return;
    if (savedMap[resourceId]) {
      const eventId = savedMap[resourceId];
      setSavedMap((prev) => { const n = { ...prev }; delete n[resourceId]; return n; });
      await supabase.from("app_events").delete().eq("id", eventId);
    } else {
      const { data } = await supabase
        .from("app_events")
        .insert({ user_id: effectiveUserId, type: "saved_resource", payload: { resource_id: resourceId } })
        .select("id").single();
      if (data) setSavedMap((prev) => ({ ...prev, [resourceId]: data.id }));
    }
  }, [effectiveUserId, savedMap]);

  const freshDrops = getFreshDrops();
  const weekNum    = getISOWeekNumber(new Date());
  const dayIdx     = new Date().getDay();

  const todayWin1 = EASY_WINS[dayIdx % 6];
  const todayWin2 = EASY_WINS[(dayIdx + 1) % 6];
  const restWins  = EASY_WINS.filter((_, i) => i !== dayIdx % 6 && i !== (dayIdx + 1) % 6);

  function matchesGrade(grade: string) {
    return !gradeFilter || grade === gradeFilter || grade === "All Ages";
  }

  const filteredDiscounts  = dbResources.filter((r) => r.category === "discounts"   && matchesGrade(r.grade_level));
  const filteredTrips      = dbResources.filter((r) => r.category === "field_trips" && matchesGrade(r.grade_level));
  const filteredPrintables = dbResources.filter((r) => r.category === "printables"  && matchesGrade(r.grade_level));
  const filteredScience    = dbResources.filter((r) => r.category === "science"     && matchesGrade(r.grade_level));
  const filteredFreshDrops = freshDrops.filter((f) => matchesGrade(f.grade));

  const filteredStates = Object.entries(STATE_REQS).filter(([name, { level }]) =>
    name.toLowerCase().includes(stateSearch.toLowerCase()) &&
    (selectedLevel === "all" || level === selectedLevel)
  );

  const savedItems = [
    ...dbResources.filter((r) => savedMap[r.id]).map((r) => ({
      id: r.id, name: r.title, desc: r.description, url: r.url,
      type: r.category === "discounts" ? "Discount" : r.category === "field_trips" ? "Field Trip" : r.category === "printables" ? "Printables" : "Science",
      emoji: r.category === "discounts" ? "💰" : r.category === "field_trips" ? "🌍" : r.category === "printables" ? "🖨️" : "🔬",
    })),
    ...FRESH_DROPS_POOL.filter((f) => savedMap[dropId(f.name)]).map((f) => ({
      id: dropId(f.name), name: f.name, desc: f.desc, url: f.url, type: f.type, emoji: f.emoji,
    })),
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl px-4 py-8 space-y-8" style={{ background: "#faf9f6" }}>

      {/* ── 1. Header ──────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">
          Curated for Homeschool Families
        </p>
        <h1 className="text-3xl font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
          Resources 📚
        </h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Deals, freebies, field trips & more — all in one place.
        </p>
      </div>

      {/* ── 2. Personalized State Banner ───────────────────────── */}
      {stateLoaded && userState && userState !== "Outside the US" && STATE_REQS[userState] ? (
        <div className="rounded-2xl p-6 border border-[#b8d4be]" style={{ background: "linear-gradient(135deg, #eef5ec 0%, #f5fbf0 100%)" }}>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#4a7c59] flex items-center justify-center shrink-0">
              <MapPin size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold tracking-widest uppercase text-[#4a7c59] mb-1">
                Showing resources for {userState}
              </p>
              <p className="text-base font-bold text-[#2d2926] mb-2">
                Resources &amp; requirements for {userState} homeschool families
              </p>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: LEVEL_LABELS[STATE_REQS[userState].level].bg, color: LEVEL_LABELS[STATE_REQS[userState].level].color }}
                >
                  {LEVEL_LABELS[STATE_REQS[userState].level].label}
                </span>
              </div>
              <p className="text-sm text-[#5c7a62] leading-relaxed">{STATE_REQS[userState].summary}</p>
              <p className="text-[10px] text-[#8aaa90] mt-2">
                Always verify with your state homeschool association or{" "}
                <a href="https://hslda.org" target="_blank" rel="noopener noreferrer" className="underline">HSLDA.org</a>.
              </p>
            </div>
          </div>
        </div>
      ) : stateLoaded && userState === "Outside the US" ? (
        <div className="rounded-2xl p-4 border border-[#e0dbd4] bg-[#fefcf9] flex items-center gap-3">
          <MapPin size={16} className="text-[#b5aca4]" />
          <p className="text-sm text-[#7a6f65]">
            You&apos;re homeschooling outside the US — check your local education authority for requirements.
          </p>
        </div>
      ) : stateLoaded ? (
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-3 rounded-2xl p-4 border border-dashed border-[#c8ddb8] bg-[#f5fbf2] hover:bg-[#eef7ea] transition-colors group"
        >
          <MapPin size={16} className="text-[#7aaa78]" />
          <p className="text-sm text-[#5c7a62]">
            Add your state in Settings to see personalized resources
            <span className="ml-1 text-[#4a7c59] group-hover:underline">→</span>
          </p>
        </Link>
      ) : null}

      {/* ── 3. This Week's Free Picks ───────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
                This Week&apos;s Free Picks ⭐
              </h2>
              <span className="text-[10px] font-semibold bg-[#fef5e4] text-[#8b6820] px-2 py-0.5 rounded-full border border-[#f0dda8]">
                Week {weekNum}
              </span>
            </div>
            <p className="text-xs text-[#7a6f65]">Exclusive finds — updated every week</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {filteredFreshDrops.map((drop, i) => {
            const col = PICK_CARD_COLORS[i % PICK_CARD_COLORS.length];
            const id  = dropId(drop.name);
            return (
              <div
                key={drop.name}
                className="rounded-2xl overflow-hidden border border-white/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                style={{ background: col.bg }}
              >
                <a href={drop.url} target="_blank" rel="noopener noreferrer" className="block p-5">
                  <div className="text-5xl mb-3">{drop.emoji}</div>
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <p className="text-sm font-bold text-[#2d2926] leading-snug hover:underline">{drop.name} ↗</p>
                    <BookmarkBtn id={id} savedMap={savedMap} onToggle={toggleSave} />
                  </div>
                  <p className="text-[11px] text-[#5c5550] leading-snug mb-3">{drop.desc}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    <GradePill grade={drop.grade} />
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${col.accent}22`, color: col.accent }}>
                      {drop.type}
                    </span>
                  </div>
                </a>
              </div>
            );
          })}
          {filteredFreshDrops.length === 0 && (
            <p className="col-span-3 text-sm text-[#b5aca4] text-center py-6">No picks match that grade filter.</p>
          )}
        </div>
      </div>

      {/* ── 4. Easy Win Today ───────────────────────────────────── */}
      <div className="rounded-2xl p-6" style={{ background: "linear-gradient(135deg, #fef9e8 0%, #fef3d0 100%)" }}>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
            Easy Win Today ⚡
          </h2>
          <p className="text-sm text-[#7a6f65]">Zero prep. Right now. You&apos;ve got this.</p>
        </div>

        {/* Today's 2 featured activities */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {[todayWin1, todayWin2].map((win, i) => {
            const col = EASY_WIN_COLORS[(dayIdx + i) % EASY_WIN_COLORS.length];
            return (
              <div
                key={win.title}
                className="rounded-2xl p-5 border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                style={{ background: col.bg, borderColor: col.border }}
              >
                <div className="text-4xl mb-3">{win.emoji}</div>
                <p className="font-bold text-[#2d2926] text-sm mb-1">{win.title}</p>
                <p className="text-xs text-[#5c5550] leading-relaxed mb-3">{win.desc}</p>
                <div className="flex gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/70 text-[#7a6f65] border border-white">
                    ⏱ {win.time}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/70 text-[#7a6f65] border border-white">
                    {win.grade}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Rest of activities — smaller */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {restWins.map((win, i) => {
            const col = EASY_WIN_COLORS[(dayIdx + i + 2) % EASY_WIN_COLORS.length];
            return (
              <div
                key={win.title}
                className="rounded-xl p-3.5 border transition-all hover:shadow-sm"
                style={{ background: col.bg, borderColor: col.border }}
              >
                <div className="text-2xl mb-2">{win.emoji}</div>
                <p className="font-semibold text-[#2d2926] text-xs mb-1 leading-snug">{win.title}</p>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/70 text-[#7a6f65]">
                  ⏱ {win.time}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-[#b5aca4] mt-4 text-center italic">
          Some days just showing up is the lesson. You&apos;re doing great. 🌿
        </p>
      </div>

      {/* ── 5. Category Tabs ────────────────────────────────────── */}

      {/* Grade Filter */}
      {activeTab !== "states" && activeTab !== "saved" && (
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mr-1">Grade:</span>
          <button
            onClick={() => setGradeFilter("")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${gradeFilter === "" ? "bg-[#4a7c59] text-white" : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59]"}`}
          >
            All Grades
          </button>
          {GRADE_TAGS.map((g) => (
            <button
              key={g}
              onClick={() => setGradeFilter(gradeFilter === g ? "" : g)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${gradeFilter === g ? "bg-[#4a7c59] text-white" : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59]"}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-2 flex-wrap">
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all relative ${
              activeTab === tab.id
                ? "bg-[#4a7c59] text-white shadow-sm"
                : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59] hover:text-[#2d2926]"
            }`}
          >
            {tab.label}
            {tab.id === "saved" && Object.keys(savedMap).length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-white/30 px-1.5 py-0.5 rounded-full">
                {Object.keys(savedMap).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Discounts ─────────────────────────────────────────── */}
      {activeTab === "discounts" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            Always ask about homeschool educator discounts — many stores honor them even if not advertised.
          </p>
          <p className="text-[11px] italic text-[#b5aca4]">
            Rooted is not affiliated with any listed brands. Offers are curated for informational purposes and may change — always verify with the retailer.
          </p>
          {dbLoading ? <LoadingSkeleton /> : filteredDiscounts.length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-10">No discounts match that grade filter.</p>
          ) : (
            filteredDiscounts.map((d) => {
              const tags = (d.metadata?.tags as string[] | undefined) ?? [];
              return (
                <div key={d.id} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-[#c4956a] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 min-h-[3rem]">
                  <div className="flex items-start gap-3">
                    <div className="bg-[#fef5e4] rounded-xl w-12 h-12 flex items-center justify-center shrink-0">
                      <span className="text-3xl">{getDiscountEmoji(d.title)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <a href={d.url} target="_blank" rel="noopener noreferrer"
                          className="font-bold text-[#2d2926] text-sm hover:text-[#4a7c59] hover:underline transition-colors leading-snug">
                          {d.title} ↗
                        </a>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {d.badge_text && (
                            <span className="text-xs font-bold text-[#4a7c59] bg-[#e4f0e6] px-2 py-0.5 rounded-full">{d.badge_text}</span>
                          )}
                          <BookmarkBtn id={d.id} savedMap={savedMap} onToggle={toggleSave} />
                        </div>
                      </div>
                      <p className="text-xs text-[#7a6f65] leading-relaxed mb-2.5">{d.description}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <GradePill grade={d.grade_level} />
                        {tags.map((t) => (
                          <span key={t} className="text-[10px] bg-[#f5f3f0] text-[#7a6f65] px-2 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Field Trips ───────────────────────────────────────── */}
      {activeTab === "trips" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">All are free or freely accessible. Click any title to visit the official page.</p>
          {dbLoading ? <LoadingSkeleton /> : filteredTrips.length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-10">No field trips match that grade filter.</p>
          ) : (
            filteredTrips.map((t) => (
              <div key={t.id} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-[#3d7080] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 min-h-[3rem]">
                <div className="flex items-start gap-3">
                  <div className="bg-[#e4f2fb] rounded-xl w-12 h-12 flex items-center justify-center shrink-0">
                    <span className="text-3xl">{getTripEmoji(t.title)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="font-bold text-[#2d2926] text-sm leading-snug">{t.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <GradePill grade={t.grade_level} />
                        <BookmarkBtn id={t.id} savedMap={savedMap} onToggle={toggleSave} />
                      </div>
                    </div>
                    <p className="text-xs text-[#7a6f65] leading-relaxed mb-3">{t.description}</p>
                    <a href={t.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#4a7c59] hover:bg-[#3a6048] px-3 py-1.5 rounded-lg transition-colors">
                      Visit ↗
                    </a>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Printables ────────────────────────────────────────── */}
      {activeTab === "printables" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">All sources are either fully free or have a generous free tier.</p>
          {dbLoading ? <LoadingSkeleton /> : filteredPrintables.length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-10">No printables match that grade filter.</p>
          ) : (
            filteredPrintables.map((p) => {
              const subjects = (p.metadata?.subjects as string[] | undefined) ?? [];
              return (
                <div key={p.id} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-[#5c7f63] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 min-h-[3rem]">
                  <div className="flex items-start gap-3">
                    <div className="bg-[#e8f0e9] rounded-xl w-12 h-12 flex items-center justify-center shrink-0">
                      <span className="text-3xl">🖨️</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                          className="font-bold text-[#2d2926] text-sm hover:text-[#4a7c59] hover:underline transition-colors leading-snug">
                          {p.title} ↗
                        </a>
                        <BookmarkBtn id={p.id} savedMap={savedMap} onToggle={toggleSave} />
                      </div>
                      <p className="text-xs text-[#7a6f65] leading-relaxed mb-2.5">{p.description}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <GradePill grade={p.grade_level} />
                        {subjects.map((s) => (
                          <span key={s} className="text-[10px] bg-[#e4f0e6] text-[#3d6044] px-2 py-0.5 rounded-full">{s}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Science ───────────────────────────────────────────── */}
      {activeTab === "science" && (
        <div className="space-y-3">
          {dbLoading ? <LoadingSkeleton /> : filteredScience.length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-10">No science projects match that grade filter.</p>
          ) : (
            filteredScience.map((p) => {
              const time      = (p.metadata?.time as string | undefined) ?? "";
              const materials = (p.metadata?.materials as string | undefined) ?? "";
              return (
                <div key={p.id} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-[#7a5020] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 min-h-[3rem]">
                  <div className="flex items-start gap-3">
                    <div className="bg-[#f5e8d8] rounded-xl w-12 h-12 flex items-center justify-center shrink-0">
                      <span className="text-3xl">🔬</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                          className="font-bold text-[#2d2926] text-sm hover:text-[#4a7c59] hover:underline transition-colors leading-snug">
                          {p.title} ↗
                        </a>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.badge_text && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.badge_text === "Easy" ? "bg-[#e4f0e6] text-[#2d5c38]" : "bg-[#f5e8d8] text-[#7a5020]"}`}>
                              {p.badge_text}
                            </span>
                          )}
                          <BookmarkBtn id={p.id} savedMap={savedMap} onToggle={toggleSave} />
                        </div>
                      </div>
                      <p className="text-xs text-[#7a6f65] leading-relaxed mb-2.5">{p.description}</p>
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <GradePill grade={p.grade_level} />
                        {time && <span className="text-[10px] bg-[#f5f3f0] text-[#7a6f65] px-2 py-0.5 rounded-full">⏱ {time}</span>}
                        {materials && <span className="text-[10px] text-[#b5aca4]"><span className="font-medium text-[#7a6f65]">Materials: </span>{materials}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── By State ──────────────────────────────────────────── */}
      {activeTab === "states" && (
        <div className="space-y-4">
          <p className="text-xs text-[#7a6f65]">
            Requirements vary widely. Always verify with your state homeschool association or{" "}
            <a href="https://hslda.org" target="_blank" rel="noopener noreferrer" className="text-[#4a7c59] hover:underline">HSLDA.org</a>.
          </p>
          <p className="text-[11px] italic text-[#b5aca4]">
            State requirements are for informational purposes only and may not reflect current law. Always verify with your state&apos;s department of education.
          </p>

          {/* Search + level filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="text"
              placeholder="Search state…"
              value={stateSearch}
              onChange={(e) => setStateSearch(e.target.value)}
              className="flex-1 min-w-32 px-3.5 py-2 text-sm rounded-xl border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#4a7c59] focus:ring-1 focus:ring-[#4a7c59]/30"
            />
            {(["all", "none", "low", "moderate", "high"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLevel(l)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${selectedLevel === l ? "bg-[#4a7c59] text-white" : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59]"}`}
              >
                {l === "all" ? "All" : LEVEL_LABELS[l as RegLevel].label}
              </button>
            ))}
          </div>

          {/* State cards */}
          <div className="space-y-2">
            {filteredStates.length === 0 && (
              <p className="text-sm text-[#b5aca4] text-center py-8">No states match your search.</p>
            )}
            {filteredStates.map(([name, { level, summary }]) => {
              const lInfo    = LEVEL_LABELS[level];
              const isExpanded = expandedState === name;
              const isYours  = userState === name;
              return (
                <div
                  key={name}
                  ref={(el) => { stateRefs.current[name] = el; }}
                  className={`bg-white rounded-2xl border transition-all overflow-hidden ${isYours ? "border-[#4a7c59] ring-1 ring-[#4a7c59]/20" : "border-gray-100 hover:border-[#c8d8cc]"}`}
                >
                  <button
                    onClick={() => setExpandedState(isExpanded ? null : name)}
                    className="w-full flex items-center justify-between px-5 py-3.5 text-left"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-sm text-[#2d2926]">{name}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: lInfo.bg, color: lInfo.color }}>
                        {lInfo.label}
                      </span>
                      {isYours && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e4f0e6] text-[#4a7c59]">
                          📍 Your State
                        </span>
                      )}
                    </div>
                    <ChevronDown size={14} className={`text-[#b5aca4] transition-transform shrink-0 ml-2 ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                  {isExpanded && (
                    <div className="px-5 pb-4 border-t border-gray-50">
                      <p className="text-xs text-[#5c5550] leading-relaxed pt-3">{summary}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Saved ─────────────────────────────────────────────── */}
      {activeTab === "saved" && (
        <div className="space-y-3">
          {loadingSaved ? (
            <LoadingSkeleton />
          ) : savedItems.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-12 flex flex-col items-center text-center shadow-sm">
              <div className="text-5xl mb-4">🔖</div>
              <p className="font-semibold text-[#2d2926] mb-2" style={{ fontFamily: "Georgia, serif" }}>
                Save resources you love
              </p>
              <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
                Tap the bookmark icon on any resource card to find it here instantly.
              </p>
            </div>
          ) : (
            savedItems.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-[#5c7f63] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 min-h-[3rem]">
                <div className="flex items-start gap-3">
                  <div className="bg-[#e8f0e9] rounded-xl w-12 h-12 flex items-center justify-center shrink-0">
                    <span className="text-3xl">{item.emoji}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="font-bold text-[#2d2926] text-sm hover:text-[#4a7c59] hover:underline transition-colors leading-snug">
                        {item.name} ↗
                      </a>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-[#7a6f65] bg-[#f5f3f0] px-2 py-0.5 rounded-full">{item.type}</span>
                        <BookmarkBtn id={item.id} savedMap={savedMap} onToggle={toggleSave} />
                      </div>
                    </div>
                    <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
