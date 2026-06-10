"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { capitalizeName } from "@/lib/utils";
import { normalizeAffiliateCode } from "@/lib/referrals";
import { posthog } from "@/lib/posthog";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHILD_COLORS = [
  "#5c7f63", "#7a9e7e", "#4a7a8a",
  "#5a5c8a", "#c4956a", "#c4697a",
];

const GRADES = [
  "Preschool", "Kindergarten", "1st", "2nd", "3rd", "4th", "5th", "6th",
  "7th", "8th", "9th", "10th", "11th", "12th",
];

// Southern-hemisphere school years run Feb–Dec within one calendar year.
const SOUTHERN_HEMISPHERE = new Set([
  "Australia", "New Zealand", "South Africa", "Argentina", "Chile", "Uruguay", "Brazil",
]);

const DAYS = [
  { label: "Mon", value: "monday" },
  { label: "Tue", value: "tuesday" },
  { label: "Wed", value: "wednesday" },
  { label: "Thu", value: "thursday" },
  { label: "Fri", value: "friday" },
  { label: "Sat", value: "saturday" },
  { label: "Sun", value: "sunday" },
];

// Smart default school-year window. Southern hemisphere: Feb 1 to Dec 15 of the
// current cycle. Everyone else: Aug 15 to May 30 of the next upcoming cycle (once
// past May 30, roll forward to this August through next May).
function defaultSchoolYear(country: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (SOUTHERN_HEMISPHERE.has(country)) {
    const cycleYear = now > new Date(y, 11, 15) ? y + 1 : y;
    return { start: `${cycleYear}-02-01`, end: `${cycleYear}-12-15` };
  }
  const startYear = now > new Date(y, 4, 30) ? y : y - 1;
  return { start: `${startYear}-08-15`, end: `${startYear + 1}-05-30` };
}

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

const COUNTRIES = [
  "United States",
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba",
  "Cyprus","Czechia","Democratic Republic of the Congo","Denmark","Djibouti",
  "Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea",
  "Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon",
  "Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea",
  "Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia",
  "Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan",
  "Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon",
  "Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar",
  "Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania",
  "Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro",
  "Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands",
  "New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway",
  "Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru",
  "Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa",
  "San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles",
  "Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia",
  "South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname",
  "Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand",
  "Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan",
  "Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","Uruguay",
  "Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia",
  "Zimbabwe","Other",
];

// ─── Shared UI ────────────────────────────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2.5 mb-10">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
            i < current ? "bg-white" : i === current ? "bg-white animate-pulse" : "bg-white/30"
          }`}
        />
      ))}
    </div>
  );
}

function StepShell({
  children,
  green = true,
}: {
  children: React.ReactNode;
  green?: boolean;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12 transition-colors duration-500"
      style={{ background: green ? "var(--g-brand)" : "#FEFCF9" }}
    >
      {green && (
        <img
          src="/rooted-logo-white.png"
          alt="Rooted"
          className="w-40 h-auto mb-10 opacity-90"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/rooted-logo-nav.png";
            (e.target as HTMLImageElement).className = "w-40 h-auto mb-10 opacity-90 brightness-0 invert";
          }}
        />
      )}
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

// ─── Celebration ──────────────────────────────────────────────────────────────

function CelebrationStep({
  displayName,
  childNames,
  goals,
  onNavigate,
}: {
  displayName: string;
  childNames: string[];
  goals: string[];
  onNavigate: (href: string) => void;
}) {
  const confettiFired = useRef(false);

  // Direct the family to their first meaningful action. Planning takes
  // precedence (covers "both/all"); memories-only routes to quick capture.
  const includesPlanning = goals.includes("planning");
  const primaryLabel = includesPlanning || !goals.includes("memories")
    ? "Add your first curriculum →"
    : "Capture your first memory →";
  const primaryHref = includesPlanning || !goals.includes("memories")
    ? "/dashboard/plan"
    : "/dashboard?capture=1";

  useEffect(() => {
    if (confettiFired.current) return;
    confettiFired.current = true;
    const timer = setTimeout(async () => {
      const confetti = (await import("canvas-confetti")).default;
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.4 },
        colors: ["#ffffff", "#c9a96e", "#e8f0e9", "#5c8a4f", "#a7c4aa"],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#3e6643] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="mb-12">
          <img src="/rooted-logo-white.png" alt="rooted." className="h-28 mx-auto mb-2 opacity-90" />
          <p className="text-[13px] tracking-[3px] uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>
            capture. plan. remember.
          </p>
        </div>

        <p className="text-[20px] tracking-wide mb-1" style={{ fontFamily: "var(--font-display)", color: "rgba(255,255,255,0.75)" }}>Welcome to Rooted</p>
        <h2
          className="text-white font-bold mb-2"
          style={{ fontFamily: "var(--font-display)", fontSize: "38px", lineHeight: "1.15" }}
        >
          {displayName ? `${displayName}!` : "Your family!"}
        </h2>
        <p className="text-[18px] mb-12" style={{ color: "rgba(255,255,255,0.65)" }}>Your garden is ready.</p>

        {childNames.length > 0 && (
          <div className="flex flex-wrap justify-center gap-9 mb-14">
            {childNames.map((name) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <span className="text-[32px]">🌱</span>
                <span className="text-[12px] font-semibold uppercase tracking-[2px]" style={{ color: "rgba(255,255,255,0.8)" }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="w-9 h-px bg-white/15 mx-auto my-6" />

        <button
          onClick={() => onNavigate(primaryHref)}
          className="bg-white text-[#2D5A3D] font-semibold rounded-2xl text-[18px] py-[18px] px-12 shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
        >
          {primaryLabel}
        </button>

        <button
          onClick={() => onNavigate("/dashboard")}
          className="mt-5 text-[15px] text-white/55 hover:text-white/80 transition-colors"
        >
          I&apos;ll explore on my own
        </button>

        <div className="mt-12 flex flex-col items-center">
          <p className="text-[12px] tracking-[2px] uppercase mb-4" style={{ color: "rgba(255,255,255,0.45)" }}>
            Take Rooted with you
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="https://apps.apple.com/app/id6769627145"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download on the App Store"
            >
              <img
                src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                alt="Download on the App Store"
                style={{ height: "36px", width: "auto" }}
              />
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.rootedhomeschoolapp.app"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Get it on Google Play"
            >
              <img
                src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
                alt="Get it on Google Play"
                style={{ height: "44px", width: "auto" }}
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── About your homeschool ──────────────────────────────────────────────────

const EXPERIENCE_OPTIONS = [
  { label: "Just starting", value: "just_starting" },
  { label: "1-2 years", value: "1_2_years" },
  { label: "3+ years", value: "3_plus_years" },
];

const GOAL_OPTIONS = [
  { label: "Planning our days", value: "planning" },
  { label: "Keeping memories", value: "memories" },
  { label: "Records and reports", value: "records" },
];

function ChoiceCard({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-2xl border transition-all active:scale-[0.99] ${
        selected
          ? "bg-white text-[var(--g-brand)] border-white font-semibold"
          : "bg-white/10 text-white border-white/20 hover:bg-white/15"
      }`}
    >
      <span className="flex items-center justify-between">
        <span className="text-base">{label}</span>
        {selected && <Check size={18} strokeWidth={3} />}
      </span>
    </button>
  );
}

function AboutStep({
  experience,
  onSelectExperience,
  goals,
  onToggleGoal,
  onContinue,
  onBack,
  saving,
  current,
  total,
}: {
  experience: string;
  onSelectExperience: (value: string) => void;
  goals: string[];
  onToggleGoal: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  saving: boolean;
  current: number;
  total: number;
}) {
  const canContinue = experience !== "" && goals.length > 0;
  return (
    <StepShell>
      <ProgressDots current={current} total={total} />
      <h1
        className="text-3xl font-bold text-white text-center mb-3 leading-snug"
        style={{ fontFamily: "var(--font-display)" }}
      >
        About your homeschool
      </h1>
      <p className="text-white/60 text-center text-sm mb-8">
        A couple quick questions so Rooted fits the way you teach.
      </p>

      <p className="text-white/80 text-sm font-medium mb-3">
        How long have you been homeschooling?
      </p>
      <div className="space-y-2.5 mb-8">
        {EXPERIENCE_OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            label={o.label}
            selected={experience === o.value}
            onClick={() => onSelectExperience(o.value)}
          />
        ))}
      </div>

      <p className="text-white/80 text-sm font-medium mb-1">
        What brings you to Rooted?
      </p>
      <p className="text-white/40 text-xs mb-3">Choose all that apply.</p>
      <div className="space-y-2.5 mb-8">
        {GOAL_OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            label={o.label}
            selected={goals.includes(o.value)}
            onClick={() => onToggleGoal(o.value)}
          />
        ))}
      </div>

      <button
        onClick={onContinue}
        disabled={saving || !canContinue}
        className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-40 mb-3"
      >
        {saving ? "Saving..." : "Continue →"}
      </button>

      <button onClick={onBack} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
        ← Back
      </button>
    </StepShell>
  );
}

// ─── School year ────────────────────────────────────────────────────────────

function SchoolYearStep({
  startDate,
  endDate,
  onStart,
  onEnd,
  schoolDays,
  onToggleDay,
  onContinue,
  onBack,
  saving,
  error,
  current,
  total,
}: {
  startDate: string;
  endDate: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  schoolDays: string[];
  onToggleDay: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  saving: boolean;
  error: string;
  current: number;
  total: number;
}) {
  return (
    <StepShell>
      <ProgressDots current={current} total={total} />
      <h1
        className="text-3xl font-bold text-white text-center mb-3 leading-snug"
        style={{ fontFamily: "var(--font-display)" }}
      >
        When does your school year run?
      </h1>
      <p className="text-white/60 text-center text-sm mb-8">
        We will set up your year so your days and reports stay on track.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <div>
          <label className="text-white/70 text-xs font-medium block mb-1.5 px-1">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStart(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl bg-white/15 border border-white/20 text-white text-sm focus:outline-none focus:border-white/50 focus:bg-white/20 transition"
          />
        </div>
        <div>
          <label className="text-white/70 text-xs font-medium block mb-1.5 px-1">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEnd(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl bg-white/15 border border-white/20 text-white text-sm focus:outline-none focus:border-white/50 focus:bg-white/20 transition"
          />
        </div>
      </div>

      <p className="text-white/80 text-sm font-medium mb-3">Which days do you do school?</p>
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {DAYS.map((d) => {
          const selected = schoolDays.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => onToggleDay(d.value)}
              className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                selected
                  ? "bg-white text-[var(--g-brand)]"
                  : "bg-white/10 text-white/70 border border-white/20 hover:bg-white/15"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

      <button
        onClick={onContinue}
        disabled={saving}
        className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-3"
      >
        {saving ? "Saving..." : "Continue →"}
      </button>

      <button onClick={onBack} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
        ← Back
      </button>
    </StepShell>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [animate, setAnimate] = useState(true);

  // Profile data
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("United States");
  const [selectedState, setSelectedState] = useState("");
  const [experience, setExperience] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [schoolYearStart, setSchoolYearStart] = useState("");
  const [schoolYearEnd, setSchoolYearEnd] = useState("");
  const [schoolDays, setSchoolDays] = useState<string[]>(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  const datesTouchedRef = useRef(false);
  const schoolYearSavedRef = useRef(false);
  const schoolYearIdRef = useRef<string | null>(null);
  const [childRows, setChildRows] = useState([{ name: "", color: CHILD_COLORS[0], grade: "" }]);
  const [celebrationReady, setCelebrationReady] = useState(false);
  const celebrationReadyRef = useRef(false);
  const authCheckDone = useRef(false);

  // ── Auth + profile check ────────────────────────────────────────────────

  useEffect(() => {
    if (authCheckDone.current) return;
    authCheckDone.current = true;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const [{ data: profile }, { data: existingChildren }] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, first_name, last_name, onboarded, state, family_photo_url")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("children")
          .select("id")
          .eq("user_id", user.id)
          .eq("archived", false)
          .limit(1),
      ]);

      if ((profile as { onboarded?: boolean | null } | null)?.onboarded === true && !celebrationReadyRef.current) {
        router.replace("/dashboard");
        return;
      }

      setUserId(user.id);

      const fn = profile?.first_name || user.user_metadata?.first_name || "";
      const ln = profile?.last_name || user.user_metadata?.last_name || "";
      const dn = profile?.display_name || "";

      setFirstName(fn);
      setLastName(ln);
      // Family name is auto-derived from the last name (no dedicated step now).
      const effectiveDn = dn || (ln ? `The ${ln.charAt(0).toUpperCase() + ln.slice(1)} Family` : "");
      setDisplayName(effectiveDn);
      if (profile?.state) setSelectedState(profile.state);
      const savedCountry = (profile as { country?: string } | null)?.country;
      if (savedCountry) setCountry(savedCountry);

      // New flow is a fixed six-step sequence; everyone starts at the top.
      setStep(0);

      setReady(true);
    });
  }, [router]);

  // ── Step transition ────────────────────────────────────────────────────

  function goTo(next: number) {
    setAnimate(false);
    setError("");
    setTimeout(() => { setStep(next); setAnimate(true); }, 150);
  }

  // Default the school-year window from the chosen country until the user edits
  // the dates themselves. Recomputes if they change country first.
  useEffect(() => {
    if (datesTouchedRef.current) return;
    const { start, end } = defaultSchoolYear(country);
    setSchoolYearStart(start);
    setSchoolYearEnd(end);
  }, [country]);

  // ── Step indicator: fixed six-step flow ────────────────────────────────

  const totalDots = 6;
  const currentDot = step;

  // ── Step handlers ──────────────────────────────────────────────────────

  async function saveStep1() {
    if (!firstName.trim()) { setError("Please enter your first name to continue"); return; }
    setSaving(true);
    const derivedName = displayName.trim()
      || (lastName.trim() ? `The ${lastName.trim().charAt(0).toUpperCase() + lastName.trim().slice(1)} Family` : "");
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        first_name: firstName.trim(),
        ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
        ...(derivedName ? { display_name: derivedName } : {}),
      }),
    });
    if (derivedName) setDisplayName(derivedName);
    setSaving(false);
    goTo(1);
  }

  async function saveLocation() {
    const isUS = country === "United States";
    setSaving(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ country, state: isUS ? (selectedState || null) : null }),
    });
    setSaving(false);
    goTo(2);
  }

  function toggleGoal(value: string) {
    setGoals((prev) => (prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value]));
  }

  async function saveAbout() {
    if (!experience || goals.length === 0) { setError("Please answer both questions to continue"); return; }
    setSaving(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ homeschool_experience: experience, primary_goal: goals }),
    });
    setSaving(false);
    goTo(3);
  }

  function toggleDay(value: string) {
    setSchoolDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));
  }

  async function saveSchoolYear() {
    if (!schoolYearStart || !schoolYearEnd) { setError("Please choose start and end dates to continue"); return; }
    if (schoolYearEnd <= schoolYearStart) { setError("Your end date needs to come after your start date"); return; }
    if (schoolDays.length === 0) { setError("Please choose at least one school day"); return; }
    setSaving(true);
    const startY = schoolYearStart.slice(0, 4);
    const endY = schoolYearEnd.slice(0, 4);
    const yearName = startY === endY ? startY : `${startY}–${endY}`;
    try {
      if (!schoolYearSavedRef.current) {
        const { data, error: insertErr } = await supabase
          .from("school_years")
          .insert({ user_id: userId, name: yearName, start_date: schoolYearStart, end_date: schoolYearEnd, status: "active" })
          .select("id")
          .single();
        if (insertErr) { setError("Something went wrong saving your school year. Please try again."); setSaving(false); return; }
        schoolYearSavedRef.current = true;
        schoolYearIdRef.current = (data as { id?: string } | null)?.id ?? null;
      } else if (schoolYearIdRef.current) {
        await supabase
          .from("school_years")
          .update({ name: yearName, start_date: schoolYearStart, end_date: schoolYearEnd })
          .eq("id", schoolYearIdRef.current);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
      return;
    }
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school_days: schoolDays, school_year_start: schoolYearStart, school_year_end: schoolYearEnd }),
    });
    setSaving(false);
    goTo(5);
  }

  async function saveStep4() {
    const filled = childRows.filter(r => r.name.trim());
    if (filled.length === 0) { setError("Please add your child's name to continue"); return; }
    setSaving(true);
    for (let i = 0; i < filled.length; i++) {
      const { error: childErr } = await supabase
        .from("children")
        .insert({
          user_id: userId,
          name: capitalizeName(filled[i].name),
          color: filled[i].color,
          sort_order: i + 1,
          archived: false,
          name_key: filled[i].name.trim().toLowerCase().replace(/\s+/g, "_"),
          grade_level: filled[i].grade || null,
        });
      if (childErr) {
        setError("Something went wrong. Please try again.");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    goTo(4);
  }

  const completeCalled = useRef(false);
  const completeOnboarding = useCallback(async () => {
    if (completeCalled.current) return;
    completeCalled.current = true;
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";

    let referredBy: string | undefined;
    try {
      // Apply legacy alias (e.g. MILKELYS → MICKEY) when reading the
      // stored referral so a code that was set before the rename still
      // attributes to the partner's current account.
      const ref = localStorage.getItem("rooted_referral_code") || localStorage.getItem("rooted_ref");
      const normalized = normalizeAffiliateCode(ref);
      if (normalized) referredBy = normalized;
    } catch {}

    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        onboarded: true,
        onboarded_at: new Date().toISOString(),
        ...(referredBy ? { referred_by: referredBy } : {}),
      }),
    });

    // Clear referral codes after successful save
    try {
      localStorage.removeItem("rooted_referral_code");
      localStorage.removeItem("rooted_ref");
    } catch {}

    // Track signup conversion
    posthog.capture('user_signed_up', {
      referred_by: referredBy ?? null,
      has_referral: !!referredBy,
    });
  }, []);

  // ── Complete onboarding when celebration step renders ────────────────

  useEffect(() => {
    if (step === 5 && !celebrationReady) {
      celebrationReadyRef.current = true;
      setCelebrationReady(true);
      completeOnboarding();
      posthog.capture('onboarding_completed', {
        country,
        homeschool_experience: experience,
        primary_goal: goals,
        child_count: childRows.filter((r) => r.name.trim()).length,
        has_school_year: true,
      });
    }
  }, [step, celebrationReady, completeOnboarding, country, experience, goals, childRows]);

  // ── Analytics: fire on every step view (mount, not Next click) ────────

  useEffect(() => {
    if (!ready) return;
    const stepNames: Record<number, string> = {
      0: 'name',
      1: 'location',
      2: 'about_homeschool',
      3: 'kids',
      4: 'school_year',
      5: 'celebration',
    };
    const stepName = stepNames[step];
    if (!stepName) return;
    posthog.capture('onboarding_step_viewed', {
      step: step + 1,
      step_name: stepName,
    });
  }, [step, ready]);

  // ── Render ──────────────────────���─────────────────────────────────────���

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--g-brand)" }}>
        <span className="text-4xl animate-pulse">🌱</span>
      </div>
    );
  }

  const fadeClass = `transition-opacity duration-300 ${animate ? "opacity-100" : "opacity-0"}`;

  // ─── STEP 1 - Name ────────────────────────────────────────────────────

  if (step === 0) {
    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />
          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            First, what&apos;s your name?
          </h1>
          <p className="text-white/60 text-center text-sm mb-10">
            We&apos;ll use this to personalize your experience.
          </p>

          <input
            type="text"
            value={firstName}
            onChange={(e) => { setFirstName(e.target.value); setError(""); }}
            placeholder="First name"
            autoFocus
            className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-lg placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-3"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name (optional)"
            className="w-full px-5 py-3.5 rounded-2xl bg-white/10 border border-white/15 text-white text-base placeholder-white/30 focus:outline-none focus:border-white/40 focus:bg-white/15 transition mb-6"
          />

          {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

          <button
            onClick={saveStep1}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>
        </div>
      </StepShell>
    );
  }

  // ─── STEP 2 - Location ────────────────────────────────────────────────

  if (step === 1) {
    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />

          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Where are you homeschooling?
          </h1>
          <p className="text-white/60 text-center text-sm mb-10">
            Homeschooling looks different everywhere, this helps us personalize Rooted for your family.
          </p>

          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-base focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-4 appearance-none"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 16px center",
            }}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c} className="text-[#2d2926]">{c}</option>
            ))}
          </select>

          {country === "United States" && (
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-base focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-6 appearance-none"
              style={{
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 16px center",
              }}
            >
              <option value="" className="text-[#2d2926]">Select your state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s} className="text-[#2d2926]">{s}</option>
              ))}
            </select>
          )}

          <button
            onClick={saveLocation}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-3 mt-2"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>

          <button onClick={() => goTo(0)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
            ← Back
          </button>
        </div>
      </StepShell>
    );
  }

  // ─── STEP 3 - About your homeschool ───────────────────────────────────

  if (step === 2) {
    return (
      <AboutStep
        experience={experience}
        onSelectExperience={setExperience}
        goals={goals}
        onToggleGoal={toggleGoal}
        onContinue={saveAbout}
        onBack={() => goTo(1)}
        saving={saving}
        current={currentDot}
        total={totalDots}
      />
    );
  }

  // ─── STEP 4 - Kids ─────────────────────────────────────────────────────

  if (step === 3) {
    function updateRow(idx: number, patch: Partial<{ name: string; color: string; grade: string }>) {
      setChildRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
      setError("");
    }

    function addRow() {
      const usedColors = childRows.map(r => r.color);
      const nextColor = CHILD_COLORS.find(c => !usedColors.includes(c)) ?? CHILD_COLORS[childRows.length % CHILD_COLORS.length];
      setChildRows(prev => [...prev, { name: "", color: nextColor, grade: "" }]);
    }

    function removeRow(idx: number) {
      setChildRows(prev => prev.filter((_, i) => i !== idx));
    }

    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />
          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Add your children 🌱
          </h1>
          <p className="text-white/60 text-center text-sm mb-8">
            Every child gets their own growing tree in your garden.
          </p>

          <div className="space-y-4 mb-4">
            {childRows.map((row, idx) => (
              <div key={idx} className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(idx, { name: e.target.value })}
                    placeholder={idx === 0 ? "Child's name" : "Another child's name"}
                    autoFocus={idx === 0}
                    className="flex-1 px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-lg placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20 transition"
                  />
                  {childRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/50 hover:text-white transition-colors shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-center gap-2.5">
                  {CHILD_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateRow(idx, { color: c })}
                      className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
                      style={{
                        backgroundColor: c,
                        borderColor: row.color === c ? "white" : "transparent",
                      }}
                    >
                      {row.color === c && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
                <select
                  value={row.grade}
                  onChange={(e) => updateRow(idx, { grade: e.target.value })}
                  className="w-full px-5 py-3 rounded-2xl bg-white/15 border border-white/20 text-white text-sm focus:outline-none focus:border-white/50 focus:bg-white/20 transition appearance-none"
                  style={{
                    backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 16px center",
                  }}
                >
                  <option value="" className="text-[#2d2926]">Grade (optional)</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g} className="text-[#2d2926]">{g}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {childRows.length < 8 && (
            <button
              type="button"
              onClick={addRow}
              className="w-full text-center text-base font-medium mb-6 py-3 border border-white/20 rounded-2xl transition-colors text-white/70 hover:text-white hover:bg-white/10"
            >
              + Add another child
            </button>
          )}

          {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

          <button
            onClick={saveStep4}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-4"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>

          <button onClick={() => goTo(2)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
            ← Back
          </button>
        </div>
      </StepShell>
    );
  }

  // ─── STEP 5 - School year ─────────────────────────────────────────────

  if (step === 4) {
    return (
      <SchoolYearStep
        startDate={schoolYearStart}
        endDate={schoolYearEnd}
        onStart={(v) => { datesTouchedRef.current = true; setSchoolYearStart(v); setError(""); }}
        onEnd={(v) => { datesTouchedRef.current = true; setSchoolYearEnd(v); setError(""); }}
        schoolDays={schoolDays}
        onToggleDay={toggleDay}
        onContinue={saveSchoolYear}
        onBack={() => goTo(3)}
        saving={saving}
        error={error}
        current={currentDot}
        total={totalDots}
      />
    );
  }

  // ─── STEP 6 - Celebration ─────────────────────────────────────────────

  if (step === 5) {
    return (
      <CelebrationStep
        displayName={displayName}
        childNames={childRows.filter(r => r.name.trim()).map(r => r.name.trim())}
        goals={goals}
        onNavigate={(href) => router.push(href)}
      />
    );
  }

  return null;
}
