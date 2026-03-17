"use client";

import { useState } from "react";

// ─── Data ─────────────────────────────────────────────────────────────────────

const TEACHER_DISCOUNTS = [
  { name: "Barnes & Noble Educator Program", savings: "20% off", desc: "Educators and homeschool parents get 20% off in-store and online purchases. Bring proof of homeschool enrollment.", tags: ["Books", "Supplies"] },
  { name: "Office Depot / OfficeMax Teacher Rewards", savings: "Up to 10%", desc: "Free membership gives 5–10% back in rewards on eligible purchases. Valid for homeschool families.", tags: ["Supplies", "Tech"] },
  { name: "JoAnn Fabrics Teacher Discount", savings: "15% off", desc: "15% teacher discount every day for educators and homeschool parents. Show a homeschool ID or letter at checkout.", tags: ["Art", "Crafts"] },
  { name: "Apple Teacher", savings: "Free resources", desc: "Free Apple Teacher certification and educational resources, lesson ideas, and professional learning for educators.", tags: ["Tech", "Digital"] },
  { name: "Staples Teacher Rewards", savings: "5% back", desc: "Free program offering 5% back in rewards plus back-to-school savings events throughout the year.", tags: ["Supplies", "Tech"] },
  { name: "Discount School Supply", savings: "Ongoing sales", desc: "Dedicated to homeschool and classroom supplies. Check their educator section for deep discounts on bulk supplies.", tags: ["Supplies", "Art"] },
  { name: "Khan Academy", savings: "100% free", desc: "Completely free, world-class education for anyone. Math, science, history, and more — including SAT prep.", tags: ["Digital", "All subjects"] },
  { name: "Amazon Homeschool Discounts", savings: "Varies", desc: "Search for educator and homeschool bundles. Amazon Smile also donates 0.5% of purchases to a homeschool organization of your choice.", tags: ["Books", "Supplies"] },
];

const VIRTUAL_FIELD_TRIPS = [
  { name: "Smithsonian National Museum of Natural History", desc: "Explore virtual tours of dinosaurs, ocean life, human origins, and gem collections — all from home.", grade: "All ages" },
  { name: "Google Arts & Culture", desc: "Virtual museum tours from the Louvre, MoMA, the Vatican Museums, and hundreds more. Also includes street-level art walks.", grade: "All ages" },
  { name: "NASA Virtual Tours", desc: "Tour the Kennedy Space Center, Jet Propulsion Lab, and explore the International Space Station in 360°.", grade: "5–12" },
  { name: "San Diego Zoo Virtual Safari", desc: "Live animal cams, educational videos, and virtual field trips for giraffes, pandas, and more.", grade: "PreK–8" },
  { name: "Monterey Bay Aquarium Live Cams", desc: "Watch sharks, jellyfish, sea otters, and kelp forests live 24/7. Lesson plans available on their educator site.", grade: "All ages" },
  { name: "The Louvre Museum, Paris", desc: "Explore collections with guided virtual tours, artwork close-ups, and curatorial commentary. No French required!", grade: "6–12" },
  { name: "Yellowstone National Park", desc: "Ranger-led virtual programs, live webcams of geysers and wildlife, and downloadable field journals for kids.", grade: "3–10" },
  { name: "Cincinnati Zoo Home Safari", desc: "Daily live streams featuring animals and zookeepers. Archive of past safaris available for on-demand viewing.", grade: "PreK–6" },
  { name: "National Geographic Classroom", desc: "Short documentary videos, photo essays, and interactives on geography, science, culture, and nature.", grade: "3–12" },
];

const FREE_PRINTABLES = [
  { name: "Khan Academy", desc: "Printable math worksheets that align with their video lessons, from kindergarten through high school.", subjects: ["Math"] },
  { name: "Education.com", desc: "Thousands of worksheets, games, and lesson plans organized by grade and subject. Free tier is generous.", subjects: ["All subjects"] },
  { name: "Math-Drills.com", desc: "Thousands of free math worksheets covering arithmetic, algebra, geometry, and more. No account needed.", subjects: ["Math"] },
  { name: "ReadWorks", desc: "Free reading comprehension passages and question sets for K–12. Scientifically-based literacy resources.", subjects: ["Reading", "ELA"] },
  { name: "Teachers Pay Teachers (Free Section)", desc: "Filter for free resources — thousands of units, lesson plans, and printables created by educators.", subjects: ["All subjects"] },
  { name: "Worksheet Works", desc: "Customizable math and language arts worksheets you can tailor to your child's level and preferences.", subjects: ["Math", "ELA"] },
  { name: "Starfall", desc: "Free phonics and early reading activities, games, and printables for ages 3–8.", subjects: ["Reading", "Phonics"] },
  { name: "CK-12", desc: "Free, customizable digital textbooks, practice problems, and simulations for every grade and subject.", subjects: ["All subjects", "STEM"] },
];

const SCIENCE_PROJECTS = [
  { title: "Baking Soda Volcano", difficulty: "Easy", time: "30 min", materials: "Baking soda, vinegar, dish soap, food coloring", desc: "A classic chemical reaction that demonstrates acid-base chemistry. Add dish soap to make a dramatic foam eruption." },
  { title: "Crystal Growing", difficulty: "Medium", time: "3–7 days", materials: "Borax or table salt, string, hot water, jar", desc: "Create beautiful crystals by supersaturating a water solution. Different salts create different crystal shapes — great for a science project." },
  { title: "Water Filtration System", difficulty: "Medium", time: "1 hour", materials: "Plastic bottles, sand, gravel, cotton balls, muddy water", desc: "Build a multi-layer filter to clean muddy water. Teaches environmental science and engineering design." },
  { title: "Egg Float / Sink Experiment", difficulty: "Easy", time: "20 min", materials: "Eggs, water, salt, two containers", desc: "Explore density by dissolving different amounts of salt in water. An egg floats in salty water but sinks in fresh water." },
  { title: "Chromatography Art", difficulty: "Easy", time: "30 min", materials: "Coffee filters, washable markers, water, pencil", desc: "Separate ink colors using water absorption. Produces beautiful art while teaching about chemical separation." },
  { title: "Homemade Electromagnet", difficulty: "Medium", time: "45 min", materials: "Iron nail, copper wire, 9V battery, paper clips", desc: "Wrap copper wire around an iron nail, connect to a battery, and pick up paper clips. Teaches electromagnetism." },
  { title: "Bean in a Bag Germination", difficulty: "Easy", time: "5–10 days", materials: "Ziplock bag, bean seeds, damp paper towel, tape", desc: "Tape a damp paper towel with a bean seed inside a sunny window. Watch the root and shoot emerge over several days." },
  { title: "Homemade Slime (Non-Newtonian Fluid)", difficulty: "Easy", time: "20 min", materials: "Elmer's glue, baking soda, contact lens solution", desc: "Create a substance that acts like both a liquid and a solid. Teaches chemistry and the properties of polymers." },
];

type RegLevel = "none" | "low" | "moderate" | "high";
const STATE_REQS: Record<string, { level: RegLevel; summary: string }> = {
  "Alaska":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Connecticut":  { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Idaho":        { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Illinois":     { level: "none",     summary: "No notice required. Must provide instruction in state subjects." },
  "Indiana":      { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Iowa":         { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Michigan":     { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Missouri":     { level: "none",     summary: "No notice required. No testing or assessment required." },
  "New Jersey":   { level: "none",     summary: "No notice required. Must cover required subjects." },
  "Oklahoma":     { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Texas":        { level: "none",     summary: "No notice required. Instruction must include required subjects." },
  "California":   { level: "low",      summary: "File a Private School Affidavit annually. Subjects: English, math, social science, science, art, music, PE, health." },
  "Florida":      { level: "low",      summary: "File a notice of intent with county superintendent. Annual evaluation by a Florida-certified teacher or standardized test." },
  "Georgia":      { level: "low",      summary: "File Declaration of Intent with local school superintendent. Keep annual attendance records." },
  "Kentucky":     { level: "low",      summary: "Notify local superintendent. Attend 185 days per year. Keep attendance records." },
  "Washington":   { level: "moderate", summary: "File annual Declaration of Intent. Annual assessment by certified teacher or standardized test in grades 4, 8, 11." },
  "New York":     { level: "high",     summary: "Submit Individualized Home Instruction Plan (IHIP). Quarterly reports and annual assessments required." },
  "Pennsylvania": { level: "high",     summary: "File annual affidavit with objectives, 180 days instruction. Portfolio review by a licensed supervisor or notarized results." },
  "Massachusetts":{ level: "high",     summary: "Annual approval by local school committee. Subjects, hours, and curriculum review required." },
  "Vermont":      { level: "high",     summary: "Enroll with state. Annual assessment. Must cover specific subjects and hours." },
};

const LEVEL_LABELS: Record<RegLevel, { label: string; color: string; bg: string }> = {
  none:     { label: "No notice required", color: "#3d5c42", bg: "#e8f0e9" },
  low:      { label: "Low regulation",     color: "#5c6f3d", bg: "#f0f4e0" },
  moderate: { label: "Moderate",           color: "#8b6f47", bg: "#f5ede0" },
  high:     { label: "High regulation",    color: "#7a3d3d", bg: "#f5e0e0" },
};

const TABS = [
  { id: "discounts",  label: "💰 Discounts",      emoji: "💰" },
  { id: "trips",      label: "🌍 Field Trips",     emoji: "🌍" },
  { id: "printables", label: "🖨️ Printables",     emoji: "🖨️" },
  { id: "science",    label: "🔬 Science",         emoji: "🔬" },
  { id: "states",     label: "🗺️ By State",        emoji: "🗺️" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const [activeTab, setActiveTab] = useState("discounts");
  const [stateSearch, setStateSearch] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<RegLevel | "all">("all");

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
          Everything you need — discounts, trips, printables, science, and state requirements.
          No Facebook group required.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-[#5c7f63] text-white"
                : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#2d2926]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Discounts ──────────────────────────────────────── */}
      {activeTab === "discounts" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            Always ask about homeschool educator discounts — many stores honor them even if not advertised.
          </p>
          {TEACHER_DISCOUNTS.map((d) => (
            <div key={d.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <h3 className="font-semibold text-[#2d2926] text-sm">{d.name}</h3>
                <span className="text-xs font-bold text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full shrink-0">
                  {d.savings}
                </span>
              </div>
              <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{d.desc}</p>
              <div className="flex gap-1.5 flex-wrap">
                {d.tags.map((t) => (
                  <span key={t} className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Virtual Field Trips ────────────────────────────── */}
      {activeTab === "trips" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            Search each name to find their official virtual tour page. All are free or freely accessible.
          </p>
          {VIRTUAL_FIELD_TRIPS.map((t) => (
            <div key={t.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="font-semibold text-[#2d2926] text-sm">{t.name}</h3>
                <span className="text-[10px] text-[#8b6f47] bg-[#f5ede0] px-2 py-0.5 rounded-full shrink-0">
                  {t.grade}
                </span>
              </div>
              <p className="text-xs text-[#7a6f65] leading-relaxed">{t.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Free Printables ────────────────────────────────── */}
      {activeTab === "printables" && (
        <div className="space-y-3">
          <p className="text-xs text-[#7a6f65]">
            All sources below are either fully free or have a generous free tier with no login required.
          </p>
          {FREE_PRINTABLES.map((p) => (
            <div key={p.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
              <h3 className="font-semibold text-[#2d2926] text-sm mb-1">{p.name}</h3>
              <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{p.desc}</p>
              <div className="flex gap-1.5 flex-wrap">
                {p.subjects.map((s) => (
                  <span key={s} className="text-[10px] bg-[#e8f0e9] text-[#5c7f63] px-2 py-0.5 rounded-full">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Science Projects ───────────────────────────────── */}
      {activeTab === "science" && (
        <div className="space-y-3">
          {SCIENCE_PROJECTS.map((p) => (
            <div key={p.title} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-semibold text-[#2d2926] text-sm">{p.title}</h3>
                <div className="flex gap-1.5 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    p.difficulty === "Easy"
                      ? "bg-[#e8f0e9] text-[#3d5c42]"
                      : "bg-[#f5ede0] text-[#8b6f47]"
                  }`}>
                    {p.difficulty}
                  </span>
                  <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                    {p.time}
                  </span>
                </div>
              </div>
              <p className="text-xs text-[#7a6f65] leading-relaxed mb-2">{p.desc}</p>
              <p className="text-[10px] text-[#b5aca4]">
                <span className="font-medium text-[#7a6f65]">Materials: </span>
                {p.materials}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── State Requirements ─────────────────────────────── */}
      {activeTab === "states" && (
        <div className="space-y-4">
          <p className="text-xs text-[#7a6f65]">
            Requirements vary widely by state. Always verify with your state homeschool association or HSLDA for the most current information.
          </p>

          {/* Filters */}
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

          {/* Legend */}
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

          {/* State cards */}
          <div className="space-y-2">
            {filteredStates.length === 0 && (
              <p className="text-sm text-[#b5aca4] text-center py-8">No states match your search.</p>
            )}
            {filteredStates.map(([name, { level, summary }]) => {
              const lInfo = LEVEL_LABELS[level];
              return (
                <div key={name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3.5 flex gap-3">
                  <div className="flex-1">
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
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-[#b5aca4] text-center pt-2">
            Only selected states shown. Search for your state — if not listed, check HSLDA.org for full details.
          </p>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
