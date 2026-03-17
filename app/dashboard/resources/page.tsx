"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type GradeTag = "All Ages" | "K–2" | "3–5" | "6–8" | "9–12";

const GRADE_TAGS: GradeTag[] = ["All Ages", "K–2", "3–5", "6–8", "9–12"];

type RegLevel = "none" | "low" | "moderate" | "high";

type DbResource = {
  id: string;
  category: string;
  title: string;
  description: string;
  url: string;
  grade_level: string;
  badge_text: string;
  metadata: Record<string, unknown>;
};

const STATE_REQS: Record<string, { level: RegLevel; summary: string }> = {
  "Alaska":        { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Connecticut":   { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Idaho":         { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Illinois":      { level: "none",     summary: "No notice required. Must provide instruction in state subjects." },
  "Indiana":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Iowa":          { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Michigan":      { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Missouri":      { level: "none",     summary: "No notice required. No testing or assessment required." },
  "New Jersey":    { level: "none",     summary: "No notice required. Must cover required subjects." },
  "Oklahoma":      { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Texas":         { level: "none",     summary: "No notice required. Instruction must include required subjects." },
  "California":    { level: "low",      summary: "File a Private School Affidavit annually. Subjects: English, math, social science, science, art, music, PE, health." },
  "Florida":       { level: "low",      summary: "File a notice of intent with county superintendent. Annual evaluation by a Florida-certified teacher or standardized test." },
  "Georgia":       { level: "low",      summary: "File Declaration of Intent with local school superintendent. Keep annual attendance records." },
  "Kentucky":      { level: "low",      summary: "Notify local superintendent. Attend 185 days per year. Keep attendance records." },
  "Washington":    { level: "moderate", summary: "File annual Declaration of Intent. Annual assessment by certified teacher or standardized test in grades 4, 8, 11." },
  "New York":      { level: "high",     summary: "Submit Individualized Home Instruction Plan (IHIP). Quarterly reports and annual assessments required." },
  "Pennsylvania":  { level: "high",     summary: "File annual affidavit with objectives, 180 days instruction. Portfolio review by a licensed supervisor or notarized results." },
  "Massachusetts": { level: "high",     summary: "Annual approval by local school committee. Subjects, hours, and curriculum review required." },
  "Vermont":       { level: "high",     summary: "Enroll with state. Annual assessment. Must cover specific subjects and hours." },
};

const LEVEL_LABELS: Record<RegLevel, { label: string; color: string; bg: string }> = {
  none:     { label: "No notice required", color: "#3d5c42", bg: "#e8f0e9" },
  low:      { label: "Low regulation",     color: "#5c6f3d", bg: "#f0f4e0" },
  moderate: { label: "Moderate",           color: "#8b6f47", bg: "#f5ede0" },
  high:     { label: "High regulation",    color: "#7a3d3d", bg: "#f5e0e0" },
};

// ─── Fresh Drops Pool (15 items) ──────────────────────────────────────────────

type FreshDrop = {
  name: string;
  desc: string;
  type: string;
  grade: GradeTag;
  url: string;
  emoji: string;
};

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
  { emoji: "🎭", name: "Teachers Pay Teachers (Free)", type: "Printables",   grade: "All Ages", url: "https://www.teacherspayteachers.com/Browse/Price-Range/Free",             desc: "Thousands of free units and lesson plans made by real educators." },
];

function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  );
}

function getFreshDrops(): FreshDrop[] {
  const week = getISOWeekNumber(new Date());
  const n = FRESH_DROPS_POOL.length;
  return [
    FRESH_DROPS_POOL[week % n],
    FRESH_DROPS_POOL[(week + 5) % n],
    FRESH_DROPS_POOL[(week + 10) % n],
  ];
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const CONTENT_TABS = [
  { id: "discounts",  label: "💰 Discounts"   },
  { id: "trips",      label: "🌍 Field Trips"  },
  { id: "printables", label: "🖨️ Printables"  },
  { id: "science",    label: "🔬 Science"      },
  { id: "states",     label: "🗺️ By State"     },
  { id: "saved",      label: "🔖 Saved"        },
];

// ─── Bookmark Button ──────────────────────────────────────────────────────────

function BookmarkButton({
  resourceId,
  savedMap,
  onToggle,
}: {
  resourceId: string;
  savedMap: Record<string, string>;
  onToggle: (resourceId: string) => void;
}) {
  const isSaved = Boolean(savedMap[resourceId]);
  return (
    <button
      onClick={(e) => { e.preventDefault(); onToggle(resourceId); }}
      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
        isSaved
          ? "bg-[#e8f0e9] text-[#5c7f63] hover:bg-[#d4ead4]"
          : "bg-[#f0ede8] text-[#b5aca4] hover:bg-[#e8e2d9] hover:text-[#7a6f65]"
      }`}
      title={isSaved ? "Remove bookmark" : "Save resource"}
      aria-label={isSaved ? "Remove bookmark" : "Save resource"}
    >
      {isSaved ? "🔖" : "🔖"}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { effectiveUserId } = usePartner();

  const [activeTab,      setActiveTab]      = useState("discounts");
  const [gradeFilter,    setGradeFilter]    = useState<GradeTag | "">("");
  const [stateSearch,    setStateSearch]    = useState("");
  const [selectedLevel,  setSelectedLevel]  = useState<RegLevel | "all">("all");
  const [savedMap,       setSavedMap]       = useState<Record<string, string>>({});
  const [loadingSaved,   setLoadingSaved]   = useState(true);
  const [dbResources,    setDbResources]    = useState<DbResource[]>([]);

  // Load DB resources
  useEffect(() => {
    supabase
      .from("resources")
      .select("id, category, title, description, url, grade_level, badge_text, metadata")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setDbResources(data as DbResource[]);
      });
  }, []);

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
        data?.forEach((e) => {
          if (e.payload?.resource_id) map[e.payload.resource_id] = e.id;
        });
        setSavedMap(map);
        setLoadingSaved(false);
      });
  }, [effectiveUserId]);

  // Toggle save/unsave a resource
  const toggleSave = useCallback(async (resourceId: string) => {
    if (!effectiveUserId) return;

    if (savedMap[resourceId]) {
      // Unsave
      const eventId = savedMap[resourceId];
      setSavedMap((prev) => { const n = { ...prev }; delete n[resourceId]; return n; });
      await supabase.from("app_events").delete().eq("id", eventId);
    } else {
      // Save
      const { data } = await supabase
        .from("app_events")
        .insert({ user_id: effectiveUserId, type: "saved_resource", payload: { resource_id: resourceId } })
        .select("id")
        .single();
      if (data) {
        setSavedMap((prev) => ({ ...prev, [resourceId]: data.id }));
      }
    }
  }, [effectiveUserId, savedMap]);

  const freshDrops = getFreshDrops();

  // Grade filtering helpers
  function matchesGrade(grade: string) {
    return !gradeFilter || grade === gradeFilter;
  }

  // DB-backed resource lists by category
  const filteredDiscounts  = dbResources.filter((r) => r.category === "discounts"   && matchesGrade(r.grade_level));
  const filteredTrips      = dbResources.filter((r) => r.category === "field_trips" && matchesGrade(r.grade_level));
  const filteredPrintables = dbResources.filter((r) => r.category === "printables"  && matchesGrade(r.grade_level));
  const filteredScience    = dbResources.filter((r) => r.category === "science"     && matchesGrade(r.grade_level));

  // Saved items from DB resources + fresh drops pool
  const savedItems = [
    ...dbResources.filter((r) => savedMap[r.id]).map((r) => ({
      id: r.id, name: r.title, desc: r.description, url: r.url,
      type: r.category === "discounts" ? "Discount" : r.category === "field_trips" ? "Field Trip" : r.category === "printables" ? "Printables" : "Science",
      emoji: r.category === "discounts" ? "💰" : r.category === "field_trips" ? "🌍" : r.category === "printables" ? "🖨️" : "🔬",
    })),
    ...FRESH_DROPS_POOL.filter((f) => savedMap[f.name]).map((f) => ({
      id: f.name, name: f.name, desc: f.desc, url: f.url, type: f.type, emoji: f.emoji,
    })),
  ];

  const filteredStates = Object.entries(STATE_REQS).filter(([name, { level }]) => {
    const matchesName  = name.toLowerCase().includes(stateSearch.toLowerCase());
    const matchesLevel = selectedLevel === "all" || level === selectedLevel;
    return matchesName && matchesLevel;
  });

  return (
    <div className="max-w-3xl px-4 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Curated for Homeschool Families
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Resources 📚</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Discounts, field trips, printables, science projects, and state requirements — all in one place.
        </p>
      </div>

      {/* ── Weekly Fresh Drops ─────────────────────────────── */}
      <div className="bg-gradient-to-br from-[#e8f5ea] to-[#f0f4d8] border border-[#b8d9bc] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">✨</span>
          <h2 className="text-sm font-bold text-[#2d2926]">Fresh Drops This Week</h2>
          <span className="text-[10px] font-medium text-[#5c7f63] bg-[#d4ead4] px-2 py-0.5 rounded-full ml-auto">
            Week {getISOWeekNumber(new Date())}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {freshDrops.map((drop) => (
            <a
              key={drop.name}
              href={drop.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white/80 border border-[#d4ead4] rounded-xl p-3 hover:shadow-sm hover:border-[#5c7f63] transition-all group block"
            >
              <div className="flex items-start justify-between gap-1 mb-1.5">
                <span className="text-xl">{drop.emoji}</span>
                <span className="text-[10px] font-medium text-[#8b6f47] bg-[#f5ede0] px-1.5 py-0.5 rounded-full shrink-0">
                  {drop.grade}
                </span>
              </div>
              <p className="text-xs font-semibold text-[#2d2926] group-hover:text-[#3d5c42] leading-snug mb-1">
                {drop.name} ↗
              </p>
              <p className="text-[10px] text-[#7a6f65] leading-snug">{drop.desc}</p>
              <span className="inline-block mt-1.5 text-[10px] text-[#b5aca4]">{drop.type}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── Grade Filter ───────────────────────────────────── */}
      {activeTab !== "states" && activeTab !== "saved" && (
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mr-1">Grade:</span>
          <button
            onClick={() => setGradeFilter("")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              gradeFilter === ""
                ? "bg-[#5c7f63] text-white"
                : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
            }`}
          >
            All Grades
          </button>
          {GRADE_TAGS.map((g) => (
            <button
              key={g}
              onClick={() => setGradeFilter(gradeFilter === g ? "" : g)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                gradeFilter === g
                  ? "bg-[#5c7f63] text-white"
                  : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "bg-[#5c7f63] text-white"
                : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#2d2926]"
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

      {/* ── Discounts ──────────────────────────────────────── */}
      {activeTab === "discounts" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            Always ask about homeschool educator discounts — many stores honor them even if not advertised.
          </p>
          {filteredDiscounts.length === 0 && (
            <p className="text-sm text-[#b5aca4] text-center py-8">No resources match that grade filter.</p>
          )}
          {filteredDiscounts.map((d) => {
            const tags = (d.metadata?.tags as string[] | undefined) ?? [];
            return (
              <div key={d.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <a href={d.url} target="_blank" rel="noopener noreferrer"
                    className="font-semibold text-[#2d2926] text-sm hover:text-[#3d5c42] hover:underline transition-colors">
                    {d.title} ↗
                  </a>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {d.badge_text && (
                      <span className="text-xs font-bold text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">
                        {d.badge_text}
                      </span>
                    )}
                    <BookmarkButton resourceId={d.id} savedMap={savedMap} onToggle={toggleSave} />
                  </div>
                </div>
                <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{d.description}</p>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] font-medium text-[#8b6f47] bg-[#f5ede0] px-2 py-0.5 rounded-full">
                    {d.grade_level}
                  </span>
                  {tags.map((t) => (
                    <span key={t} className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Virtual Field Trips ────────────────────────────── */}
      {activeTab === "trips" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            All are free or freely accessible. Click any title to visit the official page.
          </p>
          {filteredTrips.length === 0 && (
            <p className="text-sm text-[#b5aca4] text-center py-8">No resources match that grade filter.</p>
          )}
          {filteredTrips.map((t) => (
            <div key={t.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-1">
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-[#2d2926] text-sm hover:text-[#3d5c42] hover:underline transition-colors">
                  {t.title} ↗
                </a>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-[#8b6f47] bg-[#f5ede0] px-2 py-0.5 rounded-full">
                    {t.grade_level}
                  </span>
                  <BookmarkButton resourceId={t.id} savedMap={savedMap} onToggle={toggleSave} />
                </div>
              </div>
              <p className="text-xs text-[#7a6f65] leading-relaxed">{t.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Free Printables ────────────────────────────────── */}
      {activeTab === "printables" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            All sources are either fully free or have a generous free tier.
          </p>
          {filteredPrintables.length === 0 && (
            <p className="text-sm text-[#b5aca4] text-center py-8">No resources match that grade filter.</p>
          )}
          {filteredPrintables.map((p) => {
            const subjects = (p.metadata?.subjects as string[] | undefined) ?? [];
            return (
              <div key={p.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                    className="font-semibold text-[#2d2926] text-sm hover:text-[#3d5c42] hover:underline transition-colors">
                    {p.title} ↗
                  </a>
                  <BookmarkButton resourceId={p.id} savedMap={savedMap} onToggle={toggleSave} />
                </div>
                <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{p.description}</p>
                <div className="flex gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium text-[#8b6f47] bg-[#f5ede0] px-2 py-0.5 rounded-full">
                    {p.grade_level}
                  </span>
                  {subjects.map((s) => (
                    <span key={s} className="text-[10px] bg-[#e8f0e9] text-[#5c7f63] px-2 py-0.5 rounded-full">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Science Projects ───────────────────────────────── */}
      {activeTab === "science" && (
        <div className="space-y-3">
          {filteredScience.length === 0 && (
            <p className="text-sm text-[#b5aca4] text-center py-8">No resources match that grade filter.</p>
          )}
          {filteredScience.map((p) => {
            const difficulty = p.badge_text;
            const time = (p.metadata?.time as string | undefined) ?? "";
            const materials = (p.metadata?.materials as string | undefined) ?? "";
            return (
              <div key={p.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                    className="font-semibold text-[#2d2926] text-sm hover:text-[#3d5c42] hover:underline transition-colors">
                    {p.title} ↗
                  </a>
                  <div className="flex gap-1.5 shrink-0 items-center">
                    {difficulty && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        difficulty === "Easy"
                          ? "bg-[#e8f0e9] text-[#3d5c42]"
                          : "bg-[#f5ede0] text-[#8b6f47]"
                      }`}>
                        {difficulty}
                      </span>
                    )}
                    {time && (
                      <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                        {time}
                      </span>
                    )}
                    <BookmarkButton resourceId={p.id} savedMap={savedMap} onToggle={toggleSave} />
                  </div>
                </div>
                <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{p.description}</p>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] font-medium text-[#8b6f47] bg-[#f5ede0] px-2 py-0.5 rounded-full">
                    {p.grade_level}
                  </span>
                  {materials && (
                    <p className="text-[10px] text-[#b5aca4]">
                      <span className="font-medium text-[#7a6f65]">Materials: </span>
                      {materials}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── State Requirements ─────────────────────────────── */}
      {activeTab === "states" && (
        <div className="space-y-4">
          <p className="text-xs text-[#7a6f65]">
            Requirements vary widely by state. Always verify with your state homeschool association or HSLDA for the most current information.
          </p>

          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="text"
              placeholder="Search state…"
              value={stateSearch}
              onChange={(e) => setStateSearch(e.target.value)}
              className="flex-1 min-w-32 px-3 py-2 text-sm rounded-xl border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/30"
            />
            {(["all", "none", "low", "moderate", "high"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLevel(l)}
                className={`text-xs px-3 py-1.5 rounded-xl transition-colors ${
                  selectedLevel === l
                    ? "bg-[#5c7f63] text-white"
                    : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
                }`}
              >
                {l === "all" ? "All" : LEVEL_LABELS[l as RegLevel].label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {(["none", "low", "moderate", "high"] as const).map((l) => (
              <span
                key={l}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: LEVEL_LABELS[l].bg, color: LEVEL_LABELS[l].color }}
              >
                {LEVEL_LABELS[l].label}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {filteredStates.length === 0 && (
              <p className="text-sm text-[#b5aca4] text-center py-8">No states match your search.</p>
            )}
            {filteredStates.map(([name, { level, summary }]) => {
              const lInfo = LEVEL_LABELS[level];
              return (
                <div key={name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3.5">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm text-[#2d2926]">{name}</h3>
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: lInfo.bg, color: lInfo.color }}
                    >
                      {lInfo.label}
                    </span>
                  </div>
                  <p className="text-xs text-[#7a6f65] leading-relaxed">{summary}</p>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-[#b5aca4] text-center pt-2">
            Only selected states shown. If yours isn&apos;t listed, check{" "}
            <a href="https://hslda.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#7a6f65]">
              HSLDA.org
            </a>{" "}
            for full details.
          </p>
        </div>
      )}

      {/* ── Saved ──────────────────────────────────────────── */}
      {activeTab === "saved" && (
        <div className="space-y-3">
          {loadingSaved ? (
            <div className="flex justify-center py-10">
              <span className="text-2xl animate-pulse">🔖</span>
            </div>
          ) : savedItems.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
              <span className="text-4xl mb-3">🔖</span>
              <p className="font-medium text-[#2d2926] mb-2">No saved resources yet</p>
              <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
                Tap the bookmark icon on any resource card to save it here for easy access.
              </p>
            </div>
          ) : (
            savedItems.map((item) => (
              <div key={item.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="font-semibold text-[#2d2926] text-sm hover:text-[#3d5c42] hover:underline transition-colors">
                      {item.name} ↗
                    </a>
                  ) : (
                    <h3 className="font-semibold text-[#2d2926] text-sm">{item.name}</h3>
                  )}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-[#7a6f65] bg-[#f0ede8] px-2 py-0.5 rounded-full">
                      {item.type}
                    </span>
                    <BookmarkButton
                      resourceId={item.id}
                      savedMap={savedMap}
                      onToggle={toggleSave}
                    />
                  </div>
                </div>
                <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
