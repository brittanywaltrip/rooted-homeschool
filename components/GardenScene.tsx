"use client";

// ─── Stage constants ────────────────────────────────────────────────────────────

export const LEAF_THRESHOLDS = [0, 5, 10, 20, 35, 50, 70, 90, 110, 135];

export const STAGE_INFO = [
  { name: "Seed",       desc: "Just beginning",       color: "#c4956a" },
  { name: "Seedling",   desc: "First leaves unfurl",  color: "#8ab85a" },
  { name: "Sprout",     desc: "Growing roots",        color: "#7ab85a" },
  { name: "Sapling",    desc: "Taking shape",         color: "#6aaa4a" },
  { name: "Young Tree", desc: "Reaching skyward",     color: "#5a9a3a" },
  { name: "Blooming",   desc: "In full bloom",        color: "#5c7f63" },
  { name: "Fruiting",   desc: "Bearing fruit",        color: "#4a8a2a" },
  { name: "Harvest",    desc: "Ripe with knowledge",  color: "#3a7a1a" },
  { name: "Autumn",     desc: "Seasons of wisdom",    color: "#c47a2a" },
  { name: "Thriving",   desc: "Fully flourishing",    color: "#2d5c38" },
];

export function getStageFromLeaves(leafCount: number): number {
  let stage = 1;
  for (let i = 0; i < LEAF_THRESHOLDS.length; i++) {
    if (leafCount >= LEAF_THRESHOLDS[i]) stage = i + 1;
  }
  return Math.min(stage, 10);
}

export function getNextThreshold(leafCount: number): number | null {
  return LEAF_THRESHOLDS.find((t) => t > leafCount) ?? null;
}

// ─── Holiday detection ──────────────────────────────────────────────────────────

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getMothersDay(year: number): Date {
  const may1 = new Date(year, 4, 1);
  const firstSunday = (7 - may1.getDay()) % 7;
  return new Date(year, 4, 1 + firstSunday + 7);
}

type OverlayType = "snow" | "hearts" | "clovers" | "confetti" | "bats" | "falling-leaves" | "stars" | "eggs";

type HolidayTheme = {
  name: string;
  skyTint?: string;
  overlay?: OverlayType;
};

function getHolidayTheme(): HolidayTheme | null {
  const now = new Date();
  const m = now.getMonth() + 1; // 1–12
  const d = now.getDate();
  const y = now.getFullYear();

  // Christmas (Dec 15–25)
  if (m === 12 && d >= 15 && d <= 25) return { name: "Christmas", skyTint: "rgba(200,230,255,0.25)", overlay: "snow" };
  // Winter (Dec 26–Jan 1)
  if ((m === 12 && d >= 26) || (m === 1 && d <= 1)) return { name: "Winter", skyTint: "rgba(200,220,255,0.2)", overlay: "snow" };
  // New Year (Jan 2–7)
  if (m === 1 && d >= 2 && d <= 7) return { name: "New Year", overlay: "confetti" };
  // Valentine's (Feb 10–14)
  if (m === 2 && d >= 10 && d <= 14) return { name: "Valentine's", skyTint: "rgba(255,180,200,0.15)", overlay: "hearts" };
  // St. Patrick's (Mar 15–17)
  if (m === 3 && d >= 15 && d <= 17) return { name: "St. Patrick's", skyTint: "rgba(100,200,100,0.1)", overlay: "clovers" };
  // Easter (±2 days)
  const easter = getEasterDate(y);
  const easterDiff = Math.floor((now.getTime() - easter.getTime()) / 86400000);
  if (easterDiff >= -2 && easterDiff <= 2) return { name: "Easter", overlay: "eggs" };
  // Mother's Day (2nd Sunday of May)
  const mothersDay = getMothersDay(y);
  const mothersDiff = Math.floor((now.getTime() - mothersDay.getTime()) / 86400000);
  if (mothersDiff >= 0 && mothersDiff <= 1) return { name: "Mother's Day", overlay: "hearts" };
  // July 4
  if (m === 7 && d >= 1 && d <= 7) return { name: "Independence Day", overlay: "stars" };
  // Back to School (Aug 15–Sep 5)
  if ((m === 8 && d >= 15) || (m === 9 && d <= 5)) return { name: "Back to School", overlay: "confetti" };
  // Halloween (Oct 25–31)
  if (m === 10 && d >= 25) return { name: "Halloween", skyTint: "rgba(40,20,0,0.25)", overlay: "bats" };
  // Thanksgiving (November)
  if (m === 11) return { name: "Thanksgiving", overlay: "falling-leaves" };

  return null;
}

// ─── Seasonal sky ───────────────────────────────────────────────────────────────

function getSeasonalSky(): string {
  const m = new Date().getMonth() + 1;
  if (m === 12 || m <= 2)
    return "linear-gradient(180deg, #8ca8c8 0%, #aec4da 35%, #ccdaec 65%, #e0eae0 82%, #6a9a5a 100%)";
  if (m <= 5)
    return "linear-gradient(180deg, #87ceeb 0%, #aad4f0 35%, #cce4f5 65%, #e4f0e4 82%, #7ab87a 100%)";
  if (m <= 8)
    return "linear-gradient(180deg, #5ba3d4 0%, #85c4e8 35%, #b8daf4 65%, #daecea 82%, #6aaa5a 100%)";
  return "linear-gradient(180deg, #b08850 0%, #c8a070 30%, #ddb880 58%, #eacc90 76%, #8aaa5a 100%)";
}

// ─── Tree SVG (10 stages, viewBox 0 0 120 140, ground at y=120) ────────────────

export function GardenTreeSVG({ leafCount, className }: { leafCount: number; className?: string }) {
  const stage = getStageFromLeaves(leafCount);

  return (
    <svg
      viewBox="0 0 120 140"
      className={className ?? "w-full h-full"}
      aria-hidden
      overflow="visible"
    >
      {/* Ground shadow */}
      <ellipse cx="60" cy="123" rx={stage <= 3 ? 14 : stage <= 5 ? 22 : 30} ry="4" fill="rgba(0,0,0,0.08)" />

      {/* ── Stage 1: Seed ── */}
      {stage === 1 && (
        <g>
          <ellipse cx="60" cy="117" rx="9" ry="6.5" fill="#9b7a50" />
          <ellipse cx="60" cy="115" rx="6.5" ry="4.5" fill="#b8956a" />
          <ellipse cx="57" cy="114" rx="2" ry="1.2" fill="#c8a878" opacity="0.6" />
          <line x1="60" y1="111" x2="60" y2="105" stroke="#6a9a50" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 60,107 Q 55,103 54,99 Q 58,97 60,101" fill="#8ab85a" opacity="0.9" />
          <path d="M 60,107 Q 65,103 66,99 Q 62,97 60,101" fill="#6aaa3a" opacity="0.9" />
        </g>
      )}

      {/* ── Stage 2: Seedling ── */}
      {stage === 2 && (
        <g>
          {/* Grass tufts */}
          <path d="M 44,120 Q 45,115 46,118 Q 47,114 48,120" fill="#5a8a3a" />
          <path d="M 72,120 Q 73,115 74,118 Q 75,114 76,120" fill="#5a8a3a" />
          {/* Stem */}
          <line x1="60" y1="120" x2="60" y2="100" stroke="#5a8a3a" strokeWidth="2.5" strokeLinecap="round" />
          {/* Cotyledons */}
          <path d="M 60,112 Q 48,107 45,101 Q 50,96 60,103" fill="#8ab85a" className="leaf-shimmer" />
          <path d="M 60,112 Q 72,107 75,101 Q 70,96 60,103" fill="#6aaa3a" className="leaf-shimmer" />
          {/* Tip bud */}
          <ellipse cx="60" cy="98" rx="4" ry="3" fill="#5a9a2a" />
        </g>
      )}

      {/* ── Stage 3: Sprout ── */}
      {stage === 3 && (
        <g>
          {/* Grass tufts */}
          <path d="M 42,120 Q 43,114 44,117 Q 45,113 46,120" fill="#4a8a2a" />
          <path d="M 74,120 Q 75,114 76,117 Q 77,113 78,120" fill="#4a8a2a" />
          {/* Stem */}
          <line x1="60" y1="120" x2="60" y2="93" stroke="#5a8a3a" strokeWidth="3" strokeLinecap="round" />
          {/* Lower leaves */}
          <path d="M 60,114 Q 43,108 40,100 Q 47,95 60,104" fill="#8ab85a" className="leaf-shimmer" />
          <path d="M 60,114 Q 77,108 80,100 Q 73,95 60,104" fill="#6aaa3a" className="leaf-shimmer" />
          {/* Upper leaves */}
          <path d="M 60,104 Q 47,97 45,90 Q 51,86 60,93" fill="#7ab04a" className="leaf-shimmer" style={{ animationDelay: "0.5s" }} />
          <path d="M 60,104 Q 73,97 75,90 Q 69,86 60,93" fill="#5a9a2a" className="leaf-shimmer" style={{ animationDelay: "0.5s" }} />
          {/* Top cluster */}
          <circle cx="60" cy="88" r="9" fill="#4a8a20" />
          <circle cx="60" cy="80" r="7" fill="#3a7818" />
        </g>
      )}

      {/* ── Stage 4: Sapling ── */}
      {stage === 4 && (
        <g>
          {/* Grass tufts */}
          <path d="M 40,120 Q 41,113 42,116 Q 43,112 44,120" fill="#4a8a2a" />
          <path d="M 76,120 Q 77,113 78,116 Q 79,112 80,120" fill="#4a8a2a" />
          {/* Trunk */}
          <path d="M 57,120 C 56,112 56,102 57,90 L 63,90 C 64,102 64,112 63,120 Z" fill="#9b7a50" />
          <path d="M 57,112 Q 60,110 63,112" stroke="#7a5a30" strokeWidth="0.6" fill="none" opacity="0.5" />
          <path d="M 57,102 Q 60,100 63,102" stroke="#7a5a30" strokeWidth="0.6" fill="none" opacity="0.5" />
          {/* Branches */}
          <path d="M 58,95 Q 43,87 36,76" stroke="#8b6a40" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 62,93 Q 77,85 84,74" stroke="#8b6a40" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* Canopy */}
          <circle cx="38" cy="72" r="13" fill="#7ab85a" opacity="0.9" />
          <circle cx="82" cy="70" r="13" fill="#7ab85a" opacity="0.9" />
          <circle cx="56" cy="76" r="16" fill="#6aaa4a" />
          <circle cx="64" cy="76" r="16" fill="#6aaa4a" />
          <circle cx="60" cy="62" r="17" fill="#5a9a3a" />
          <circle cx="60" cy="48" r="13" fill="#4a8a2a" />
        </g>
      )}

      {/* ── Stage 5: Young Tree ── */}
      {stage === 5 && (
        <g>
          {/* Grass tufts */}
          <path d="M 38,120 Q 39,112 40,116 Q 41,111 42,120" fill="#4a8a2a" />
          <path d="M 78,120 Q 79,112 80,116 Q 81,111 82,120" fill="#4a8a2a" />
          {/* Trunk */}
          <path d="M 56,120 C 55,110 54,98 55,84 L 65,84 C 66,98 65,110 64,120 Z" fill="#9b7a50" />
          <path d="M 56,114 Q 60,112 64,114" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          <path d="M 56,104 Q 60,102 64,104" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          <path d="M 56,94 Q 60,92 64,94" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          {/* Branches */}
          <path d="M 57,90 Q 40,83 32,70" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M 63,88 Q 80,81 88,68" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Canopy layers */}
          <circle cx="34" cy="66" r="15" fill="#7ab85a" />
          <circle cx="86" cy="64" r="15" fill="#7ab85a" />
          <circle cx="50" cy="75" r="17" fill="#6aaa4a" />
          <circle cx="70" cy="75" r="17" fill="#6aaa4a" />
          <circle cx="60" cy="60" r="21" fill="#5a9a3a" />
          <circle cx="48" cy="50" r="14" fill="#4a8a2a" />
          <circle cx="72" cy="48" r="14" fill="#4a8a2a" />
          <circle cx="60" cy="40" r="15" fill="#3a7818" />
          {/* Highlight dots */}
          <circle cx="44" cy="56" r="2" fill="#8ac85a" opacity="0.6" />
          <circle cx="76" cy="58" r="2" fill="#8ac85a" opacity="0.6" />
        </g>
      )}

      {/* ── Stage 6: Blooming ── */}
      {stage === 6 && (
        <g>
          {/* Grass tufts */}
          <path d="M 34,120 Q 35,112 36,116 Q 37,111 38,120" fill="#4a8a2a" />
          <path d="M 82,120 Q 83,112 84,116 Q 85,111 86,120" fill="#4a8a2a" />
          {/* Trunk (wider) */}
          <path d="M 55,120 C 54,108 53,94 54,78 L 66,78 C 67,94 66,108 65,120 Z" fill="#9b7a50" />
          <path d="M 55,113 Q 60,111 65,113" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          <path d="M 55,103 Q 60,101 65,103" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          <path d="M 55,93 Q 60,91 65,93" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.5" />
          <path d="M 55,83 Q 60,81 65,83" stroke="#7a5a30" strokeWidth="0.6" fill="none" opacity="0.4" />
          {/* Branches */}
          <path d="M 56,85 Q 36,76 26,62" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 64,83 Q 84,74 94,60" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 58,80 Q 52,68 48,58" stroke="#8b6a40" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 62,80 Q 68,68 72,58" stroke="#8b6a40" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* Canopy — deep layers */}
          <circle cx="28" cy="60" r="16" fill="#7ab85a" />
          <circle cx="92" cy="58" r="16" fill="#7ab85a" />
          <circle cx="44" cy="73" r="18" fill="#6aaa4a" />
          <circle cx="76" cy="73" r="18" fill="#6aaa4a" />
          <circle cx="60" cy="66" r="23" fill="#5a9a3a" />
          <circle cx="44" cy="54" r="16" fill="#4a8a2a" />
          <circle cx="76" cy="52" r="16" fill="#4a8a2a" />
          <circle cx="60" cy="44" r="19" fill="#3a7818" />
          <circle cx="60" cy="28" r="14" fill="#2e6612" />
          {/* Pink blossoms */}
          <circle cx="36" cy="54" r="3.5" fill="#ffb8d0" opacity="0.9" />
          <circle cx="84" cy="50" r="3.5" fill="#ffb8d0" opacity="0.9" />
          <circle cx="52" cy="44" r="3" fill="#ffc8e0" opacity="0.85" />
          <circle cx="68" cy="42" r="3" fill="#ffc8e0" opacity="0.85" />
          <circle cx="60" cy="32" r="3" fill="#ffb0c8" opacity="0.8" />
          <circle cx="46" cy="64" r="2.5" fill="#ffd0e8" opacity="0.8" />
          <circle cx="74" cy="62" r="2.5" fill="#ffd0e8" opacity="0.8" />
        </g>
      )}

      {/* ── Stage 7: Fruiting (green fruits) ── */}
      {stage === 7 && (
        <g>
          {/* Grass tufts */}
          <path d="M 32,120 Q 33,111 34,115 Q 35,110 36,120" fill="#3a8020" />
          <path d="M 84,120 Q 85,111 86,115 Q 87,110 88,120" fill="#3a8020" />
          {/* Trunk */}
          <path d="M 54,120 C 53,107 52,92 53,74 L 67,74 C 68,92 67,107 66,120 Z" fill="#9b7a50" />
          <path d="M 54,112 Q 60,110 66,112" stroke="#7a5a30" strokeWidth="0.8" fill="none" opacity="0.5" />
          <path d="M 54,100 Q 60,98 66,100" stroke="#7a5a30" strokeWidth="0.8" fill="none" opacity="0.5" />
          <path d="M 54,88 Q 60,86 66,88" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.4" />
          {/* Branches */}
          <path d="M 55,80 Q 32,70 22,56" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 65,78 Q 88,68 98,54" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 57,77 Q 50,64 46,52" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M 63,77 Q 70,64 74,52" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Canopy */}
          <circle cx="24" cy="54" r="17" fill="#7ab85a" />
          <circle cx="96" cy="52" r="17" fill="#7ab85a" />
          <circle cx="40" cy="70" r="20" fill="#6aaa4a" />
          <circle cx="80" cy="68" r="20" fill="#6aaa4a" />
          <circle cx="60" cy="63" r="25" fill="#5a9a3a" />
          <circle cx="40" cy="50" r="18" fill="#4a8a2a" />
          <circle cx="80" cy="48" r="18" fill="#4a8a2a" />
          <circle cx="60" cy="40" r="21" fill="#3a7818" />
          <circle cx="60" cy="24" r="15" fill="#2e6612" />
          {/* Green fruits */}
          <circle cx="32" cy="58" r="4" fill="#70c040" /><circle cx="32" cy="58" r="2" fill="#90d860" opacity="0.5" />
          <circle cx="88" cy="56" r="4" fill="#70c040" /><circle cx="88" cy="56" r="2" fill="#90d860" opacity="0.5" />
          <circle cx="46" cy="48" r="4" fill="#68b838" /><circle cx="46" cy="48" r="2" fill="#88d058" opacity="0.5" />
          <circle cx="74" cy="46" r="4" fill="#68b838" /><circle cx="74" cy="46" r="2" fill="#88d058" opacity="0.5" />
          <circle cx="60" cy="32" r="3.5" fill="#70c040" /><circle cx="60" cy="32" r="1.5" fill="#90d860" opacity="0.5" />
        </g>
      )}

      {/* ── Stage 8: Harvest (red/orange fruits) ── */}
      {stage === 8 && (
        <g>
          {/* Grass tufts */}
          <path d="M 30,120 Q 31,110 32,114 Q 33,109 34,120" fill="#3a8020" />
          <path d="M 86,120 Q 87,110 88,114 Q 89,109 90,120" fill="#3a8020" />
          {/* Trunk */}
          <path d="M 53,120 C 52,106 51,90 52,72 L 68,72 C 69,90 68,106 67,120 Z" fill="#9b7a50" />
          <path d="M 53,112 Q 60,110 67,112" stroke="#7a5a30" strokeWidth="0.8" fill="none" opacity="0.5" />
          <path d="M 53,100 Q 60,98 67,100" stroke="#7a5a30" strokeWidth="0.8" fill="none" opacity="0.4" />
          {/* Branches */}
          <path d="M 54,78 Q 30,68 20,52" stroke="#8b6a40" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 66,76 Q 90,66 100,50" stroke="#8b6a40" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 56,74 Q 48,60 44,48" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M 64,74 Q 72,60 76,48" stroke="#8b6a40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Canopy (lush) */}
          <circle cx="22" cy="50" r="18" fill="#7ab85a" />
          <circle cx="98" cy="48" r="18" fill="#7ab85a" />
          <circle cx="36" cy="68" r="22" fill="#6aaa4a" />
          <circle cx="84" cy="66" r="22" fill="#6aaa4a" />
          <circle cx="60" cy="62" r="27" fill="#5a9a3a" />
          <circle cx="38" cy="48" r="19" fill="#4a8a2a" />
          <circle cx="82" cy="46" r="19" fill="#4a8a2a" />
          <circle cx="60" cy="38" r="23" fill="#3a7818" />
          <circle cx="60" cy="20" r="16" fill="#2e6612" />
          {/* Red/orange apples */}
          <circle cx="26" cy="48" r="4.5" fill="#e84030" /><circle cx="25" cy="46" r="1.5" fill="#ff8070" opacity="0.6" />
          <circle cx="94" cy="46" r="4.5" fill="#e84030" /><circle cx="93" cy="44" r="1.5" fill="#ff8070" opacity="0.6" />
          <circle cx="40" cy="56" r="4.5" fill="#e05828" /><circle cx="39" cy="54" r="1.5" fill="#ff8060" opacity="0.6" />
          <circle cx="80" cy="54" r="4.5" fill="#e05828" /><circle cx="79" cy="52" r="1.5" fill="#ff8060" opacity="0.6" />
          <circle cx="46" cy="44" r="4" fill="#e84030" /><circle cx="45" cy="42" r="1.5" fill="#ff7060" opacity="0.6" />
          <circle cx="74" cy="42" r="4" fill="#e84030" /><circle cx="73" cy="40" r="1.5" fill="#ff7060" opacity="0.6" />
          <circle cx="60" cy="30" r="4" fill="#e05828" /><circle cx="59" cy="28" r="1.5" fill="#ff8060" opacity="0.5" />
          {/* Stem on fruit */}
          <line x1="26" y1="44" x2="26" y2="41" stroke="#3a6010" strokeWidth="1" strokeLinecap="round" />
          <line x1="46" y1="40" x2="46" y2="37" stroke="#3a6010" strokeWidth="1" strokeLinecap="round" />
          <line x1="74" y1="38" x2="74" y2="35" stroke="#3a6010" strokeWidth="1" strokeLinecap="round" />
        </g>
      )}

      {/* ── Stage 9: Autumn (orange/red/yellow foliage) ── */}
      {stage === 9 && (
        <g>
          {/* Grass tufts (dried) */}
          <path d="M 28,120 Q 29,109 30,113 Q 31,108 32,120" fill="#8a7020" />
          <path d="M 88,120 Q 89,109 90,113 Q 91,108 92,120" fill="#8a7020" />
          {/* Trunk */}
          <path d="M 53,120 C 52,106 51,90 52,72 L 68,72 C 69,90 68,106 67,120 Z" fill="#8b6040" />
          <path d="M 53,112 Q 60,110 67,112" stroke="#6a4820" strokeWidth="0.8" fill="none" opacity="0.6" />
          <path d="M 53,100 Q 60,98 67,100" stroke="#6a4820" strokeWidth="0.8" fill="none" opacity="0.6" />
          <path d="M 53,88 Q 60,86 67,88" stroke="#6a4820" strokeWidth="0.7" fill="none" opacity="0.5" />
          {/* Branches */}
          <path d="M 54,78 Q 30,68 20,52" stroke="#7a5030" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 66,76 Q 90,66 100,50" stroke="#7a5030" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 56,74 Q 48,60 44,48" stroke="#7a5030" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M 64,74 Q 72,60 76,48" stroke="#7a5030" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Autumn canopy — warm colors */}
          <circle cx="22" cy="50" r="18" fill="#d4802a" />
          <circle cx="98" cy="48" r="18" fill="#d08028" />
          <circle cx="36" cy="68" r="22" fill="#c87030" />
          <circle cx="84" cy="66" r="22" fill="#cc7828" />
          <circle cx="60" cy="62" r="27" fill="#c86828" />
          <circle cx="38" cy="48" r="19" fill="#e09030" />
          <circle cx="82" cy="46" r="19" fill="#d88028" />
          <circle cx="60" cy="38" r="23" fill="#c05820" />
          <circle cx="60" cy="20" r="16" fill="#b04818" />
          {/* Color variation patches */}
          <circle cx="30" cy="55" r="10" fill="#e8a830" opacity="0.7" />
          <circle cx="90" cy="53" r="10" fill="#e8a028" opacity="0.7" />
          <circle cx="52" cy="44" r="10" fill="#d04818" opacity="0.6" />
          <circle cx="68" cy="42" r="10" fill="#d05020" opacity="0.6" />
          <circle cx="60" cy="26" r="8" fill="#e8b028" opacity="0.65" />
          {/* Sparkle shimmer */}
          <circle cx="22" cy="44" r="2" fill="#f8d080" className="sparkle" style={{ animationDelay: "0.4s" }} />
          <circle cx="98" cy="42" r="2" fill="#f8c860" className="sparkle" style={{ animationDelay: "1.1s" }} />
          <circle cx="60" cy="16" r="1.5" fill="#ffd080" className="sparkle" style={{ animationDelay: "1.8s" }} />
        </g>
      )}

      {/* ── Stage 10: Thriving (majestic, glowing) ── */}
      {stage === 10 && (
        <g>
          {/* Lush grass tufts */}
          <path d="M 26,120 Q 27,109 28,113 Q 29,108 30,120" fill="#3a8a20" />
          <path d="M 32,120 Q 33,110 34,114 Q 35,109 36,120" fill="#4a9a28" />
          <path d="M 84,120 Q 85,110 86,114 Q 87,109 88,120" fill="#4a9a28" />
          <path d="M 90,120 Q 91,109 92,113 Q 93,108 94,120" fill="#3a8a20" />
          {/* Trunk (wide, majestic) */}
          <path d="M 52,120 C 50,105 49,88 50,68 L 70,68 C 71,88 70,105 68,120 Z" fill="#9b7a50" />
          <path d="M 52,114 Q 60,112 68,114" stroke="#7a5a30" strokeWidth="0.9" fill="none" opacity="0.5" />
          <path d="M 52,104 Q 60,102 68,104" stroke="#7a5a30" strokeWidth="0.9" fill="none" opacity="0.5" />
          <path d="M 52,94 Q 60,92 68,94" stroke="#7a5a30" strokeWidth="0.8" fill="none" opacity="0.4" />
          <path d="M 52,84 Q 60,82 68,84" stroke="#7a5a30" strokeWidth="0.7" fill="none" opacity="0.35" />
          {/* Major branches */}
          <path d="M 52,74 Q 26,62 14,46" stroke="#8b6a40" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 68,72 Q 94,60 106,44" stroke="#8b6a40" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 55,72 Q 46,58 42,44" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 65,72 Q 74,58 78,44" stroke="#8b6a40" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* Canopy — massive, deep, lush */}
          <circle cx="16" cy="44" r="19" fill="#7ab85a" />
          <circle cx="104" cy="42" r="19" fill="#7ab85a" />
          <circle cx="30" cy="64" r="24" fill="#6aaa4a" />
          <circle cx="90" cy="62" r="24" fill="#6aaa4a" />
          <circle cx="60" cy="60" r="30" fill="#5a9a3a" />
          <circle cx="34" cy="44" r="21" fill="#4a8a2a" />
          <circle cx="86" cy="42" r="21" fill="#4a8a2a" />
          <circle cx="60" cy="36" r="25" fill="#3a7818" />
          <circle cx="42" cy="26" r="16" fill="#2e6612" />
          <circle cx="78" cy="24" r="16" fill="#2e6612" />
          <circle cx="60" cy="16" r="18" fill="#24580c" />
          {/* Glow / shimmer overlay */}
          <circle cx="60" cy="38" r="28" fill="rgba(120,200,80,0.15)" className="leaf-shimmer" />
          {/* Sparkle dots */}
          <circle cx="20" cy="40" r="2.5" fill="#b0f080" className="sparkle" style={{ animationDelay: "0.2s" }} />
          <circle cx="100" cy="38" r="2.5" fill="#a8e870" className="sparkle" style={{ animationDelay: "0.8s" }} />
          <circle cx="40" cy="22" r="2" fill="#b8f090" className="sparkle" style={{ animationDelay: "1.4s" }} />
          <circle cx="80" cy="20" r="2" fill="#a8f078" className="sparkle" style={{ animationDelay: "0.5s" }} />
          <circle cx="60" cy="8" r="2" fill="#c8f8a0" className="sparkle" style={{ animationDelay: "1.9s" }} />
          <circle cx="50" cy="52" r="1.5" fill="#d0f0a8" className="sparkle" style={{ animationDelay: "1.1s" }} />
          <circle cx="70" cy="50" r="1.5" fill="#c8f098" className="sparkle" style={{ animationDelay: "0.3s" }} />
        </g>
      )}
    </svg>
  );
}

// ─── Scene decoration components ────────────────────────────────────────────────

function SceneSun() {
  return (
    <div className="absolute top-4 right-5 sun-glow" style={{ width: 52, height: 52 }}>
      <svg viewBox="0 0 56 56" className="w-full h-full" overflow="visible">
        <circle cx="28" cy="28" r="30" fill="#fff3a0" opacity="0.3" />
        <g className="sun-rays-spin" style={{ transformOrigin: "28px 28px" }}>
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1="28" y1="6" x2="28" y2="1" stroke="#ffc93d" strokeWidth="2.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} opacity="0.8" />
          ))}
          {[22.5, 67.5, 112.5, 157.5].map((a) => (
            <line key={a} x1="28" y1="7.5" x2="28" y2="3" stroke="#ffd86b" strokeWidth="1.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} opacity="0.8" />
          ))}
        </g>
        <circle cx="28" cy="28" r="13" fill="#ffd84d" />
        <circle cx="28" cy="28" r="9" fill="#ffe680" opacity="0.9" />
        <circle cx="24" cy="24" r="2" fill="#fff5a0" opacity="0.6" />
      </svg>
    </div>
  );
}

function SceneCloud({ x, y, scale = 1, delay = 0, alt = false }: {
  x: number; y: number; scale?: number; delay?: number; alt?: boolean;
}) {
  return (
    <div
      className={alt ? "cloud-drift-slow" : "cloud-drift"}
      style={{ position: "absolute", left: `${x}%`, top: `${y}%`,
        transform: `scale(${scale})`, transformOrigin: "left center", animationDelay: `${delay}s` }}
    >
      <svg viewBox="0 0 80 38" width="80" height="38">
        <ellipse cx="40" cy="28" rx="38" ry="11" fill="#ffffff" opacity="0.9" />
        <ellipse cx="24" cy="24" rx="18" ry="15" fill="#ffffff" opacity="0.9" />
        <ellipse cx="54" cy="22" rx="16" ry="16" fill="#ffffff" opacity="0.9" />
        <ellipse cx="40" cy="18" rx="25" ry="16" fill="#ffffff" opacity="0.9" />
        <ellipse cx="40" cy="28" rx="38" ry="11" fill="rgba(200,230,255,0.12)" />
      </svg>
    </div>
  );
}

function SceneButterfly({ x, y, delay = 0, color = "#f9a8d4" }: {
  x: number; y: number; delay?: number; color?: string;
}) {
  return (
    <div className="absolute butterfly" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
      <svg viewBox="0 0 28 20" width="24" height="17">
        <path d="M14 10 Q8 3 3 5 Q0 9 3 12 Q7 15 12 12 Q13 11 14 10" fill={color} opacity="0.9" />
        <path d="M14 10 Q20 3 25 5 Q28 9 25 12 Q21 15 16 12 Q15 11 14 10" fill={color} opacity="0.9" />
        <path d="M14 11 Q10 14 8 17 Q11 19 13 17 Q14 15 14 11" fill={color} opacity="0.75" />
        <path d="M14 11 Q18 14 20 17 Q17 19 15 17 Q14 15 14 11" fill={color} opacity="0.75" />
        <circle cx="6" cy="9" r="1.5" fill="rgba(255,255,255,0.4)" />
        <circle cx="22" cy="9" r="1.5" fill="rgba(255,255,255,0.4)" />
        <ellipse cx="14" cy="11" rx="1" ry="4" fill="#5a4a3a" />
        <path d="M13.4 7.5 Q11.5 4 10 2" stroke="#5a4a3a" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <path d="M14.6 7.5 Q16.5 4 18 2" stroke="#5a4a3a" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function SceneFlower({ x, color = "#ff9ec4" }: { x: number; color?: string }) {
  return (
    <div className="absolute" style={{ bottom: "28%", left: `${x}%` }}>
      <svg viewBox="0 0 16 22" width="11" height="15">
        <line x1="8" y1="22" x2="8" y2="11" stroke="#5c7f63" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="3" fill={color} opacity="0.9" />
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="8" cy="8" rx="1.8" ry="3.5" fill={color} opacity="0.65"
            transform={`rotate(${a} 8 8)`} />
        ))}
        <circle cx="8" cy="8" r="1.8" fill="#ffd84d" />
      </svg>
    </div>
  );
}

// ─── Holiday overlays ────────────────────────────────────────────────────────────

function SnowOverlay() {
  const flakes = [
    { x: 10, delay: "0s", size: 5, dx: 8 }, { x: 25, delay: "1.2s", size: 4, dx: -6 },
    { x: 45, delay: "0.4s", size: 6, dx: 10 }, { x: 62, delay: "2.1s", size: 4, dx: -8 },
    { x: 78, delay: "0.9s", size: 5, dx: 6 }, { x: 90, delay: "1.7s", size: 3, dx: -5 },
    { x: 15, delay: "3.1s", size: 3, dx: 7 }, { x: 55, delay: "2.8s", size: 5, dx: -9 },
  ];
  return (
    <>
      {flakes.map((f, i) => (
        <div key={i} className="absolute pointer-events-none snow-drift"
          style={{ left: `${f.x}%`, top: "-8px", animationDelay: f.delay,
            ["--dx" as string]: `${f.dx}px` }}>
          <svg width={f.size + 2} height={f.size + 2} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill="white" opacity="0.85" />
          </svg>
        </div>
      ))}
    </>
  );
}

function HeartsOverlay() {
  const hearts = [
    { x: 8, delay: "0s" }, { x: 28, delay: "0.8s" }, { x: 50, delay: "1.6s" },
    { x: 70, delay: "0.4s" }, { x: 88, delay: "2.2s" },
  ];
  return (
    <>
      {hearts.map((h, i) => (
        <div key={i} className="absolute pointer-events-none heart-float"
          style={{ left: `${h.x}%`, bottom: "30%", animationDelay: h.delay }}>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M7 12 Q1 7 1 4 A3 3 0 0 1 7 4 A3 3 0 0 1 13 4 Q13 7 7 12Z" fill="#ff6090" opacity="0.85" />
          </svg>
        </div>
      ))}
    </>
  );
}

function BatsOverlay() {
  const bats = [
    { x: 12, y: 25, delay: "0s" }, { x: 70, y: 18, delay: "1.4s" }, { x: 40, y: 35, delay: "2.6s" },
  ];
  return (
    <>
      {bats.map((b, i) => (
        <div key={i} className="absolute pointer-events-none butterfly"
          style={{ left: `${b.x}%`, top: `${b.y}%`, animationDelay: b.delay }}>
          <svg width="22" height="14" viewBox="0 0 22 14">
            <path d="M11 7 Q5 1 1 3 Q0 7 4 9 Q7 10 10 8" fill="#3a2040" opacity="0.85" />
            <path d="M11 7 Q17 1 21 3 Q22 7 18 9 Q15 10 12 8" fill="#3a2040" opacity="0.85" />
            <ellipse cx="11" cy="8" rx="1" ry="3" fill="#2a1030" />
          </svg>
        </div>
      ))}
    </>
  );
}

function CloversOverlay() {
  const spots = [{ x: 8, y: 70 }, { x: 88, y: 72 }, { x: 18, y: 65 }, { x: 80, y: 68 }];
  return (
    <>
      {spots.map((s, i) => (
        <div key={i} className="absolute pointer-events-none" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="5" r="3.5" fill="#40a840" opacity="0.85" />
            <circle cx="5" cy="8" r="3.5" fill="#3a9838" opacity="0.85" />
            <circle cx="9" cy="8" r="3.5" fill="#44b040" opacity="0.85" />
            <line x1="7" y1="11" x2="7" y2="14" stroke="#3a8020" strokeWidth="1.5" />
          </svg>
        </div>
      ))}
    </>
  );
}

function StarsOverlay() {
  const stars = [
    { x: 10, y: 10, delay: "0s" }, { x: 30, y: 20, delay: "0.6s" },
    { x: 55, y: 8, delay: "1.2s" }, { x: 75, y: 18, delay: "0.3s" }, { x: 92, y: 12, delay: "1.8s" },
  ];
  return (
    <>
      {stars.map((s, i) => (
        <div key={i} className="absolute pointer-events-none sparkle"
          style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: s.delay }}>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M7 1 L8.2 5 L12 5 L9 8 L10 12 L7 9.5 L4 12 L5 8 L2 5 L5.8 5 Z"
              fill="#ffd030" opacity="0.9" />
          </svg>
        </div>
      ))}
    </>
  );
}

function FallingLeavesOverlay() {
  const leaves = [
    { x: 15, delay: "0s", color: "#d06020" }, { x: 35, delay: "1.3s", color: "#e08828" },
    { x: 60, delay: "0.5s", color: "#c05018" }, { x: 80, delay: "2.1s", color: "#d87020" },
    { x: 48, delay: "1.8s", color: "#e8a030" },
  ];
  return (
    <>
      {leaves.map((l, i) => (
        <div key={i} className="absolute pointer-events-none falling-leaf"
          style={{ left: `${l.x}%`, top: "-5%", animationDelay: l.delay }}>
          <svg width="10" height="12" viewBox="0 0 10 12">
            <path d="M5 1 Q9 4 8 8 Q5 11 2 8 Q1 4 5 1Z" fill={l.color} opacity="0.85" />
            <line x1="5" y1="1" x2="5" y2="10" stroke="rgba(0,0,0,0.15)" strokeWidth="0.7" />
          </svg>
        </div>
      ))}
    </>
  );
}

function EggsOverlay() {
  const eggs = [
    { x: 8, y: 68, color: "#f08090" }, { x: 88, y: 70, color: "#80c0f0" },
    { x: 18, y: 64, color: "#a0e080" }, { x: 78, y: 66, color: "#f0c050" },
  ];
  return (
    <>
      {eggs.map((e, i) => (
        <div key={i} className="absolute pointer-events-none" style={{ left: `${e.x}%`, top: `${e.y}%` }}>
          <svg width="12" height="14" viewBox="0 0 12 14">
            <ellipse cx="6" cy="8" rx="5" ry="6" fill={e.color} opacity="0.9" />
            <ellipse cx="5" cy="6" rx="1.5" ry="2" fill="rgba(255,255,255,0.3)" />
          </svg>
        </div>
      ))}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────

export interface GardenSceneProps {
  leafCount: number;
  childName?: string;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function GardenScene({
  leafCount,
  childName,
  compact = false,
  showLabel = false,
  className = "",
  style,
}: GardenSceneProps) {
  const stage = getStageFromLeaves(leafCount);

  if (compact) {
    return (
      <div className={`w-full h-full ${className}`} style={style}>
        <GardenTreeSVG leafCount={leafCount} className="w-full h-full" />
      </div>
    );
  }

  const sky = getSeasonalSky();
  const holiday = getHolidayTheme();
  const skyTint = holiday?.skyTint;

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{
        background: sky,
        ...(skyTint ? { boxShadow: `inset 0 0 0 9999px ${skyTint}` } : {}),
        aspectRatio: "16/9",
        minHeight: 180,
        ...style,
      }}
    >
      {/* Sun */}
      <SceneSun />

      {/* Clouds */}
      <SceneCloud x={8}  y={8}  scale={1.0} delay={0} />
      <SceneCloud x={30} y={14} scale={0.7} delay={-5} alt />
      <SceneCloud x={56} y={6}  scale={0.85} delay={-2} />

      {/* Butterflies at stage 6+ */}
      {stage >= 6 && (
        <>
          <SceneButterfly x={12} y={32} delay={0}   color="#f9a8d4" />
          <SceneButterfly x={72} y={26} delay={1.8} color="#fbbf24" />
          {stage >= 8 && <SceneButterfly x={45} y={40} delay={3.2} color="#86efac" />}
        </>
      )}

      {/* Holiday overlays */}
      {holiday?.overlay === "snow"          && <SnowOverlay />}
      {holiday?.overlay === "hearts"        && <HeartsOverlay />}
      {holiday?.overlay === "bats"          && <BatsOverlay />}
      {holiday?.overlay === "clovers"       && <CloversOverlay />}
      {holiday?.overlay === "stars"         && <StarsOverlay />}
      {holiday?.overlay === "falling-leaves" && <FallingLeavesOverlay />}
      {holiday?.overlay === "eggs"          && <EggsOverlay />}
      {holiday?.overlay === "confetti"      && <StarsOverlay />}

      {/* Autumn falling leaves at stage 9 */}
      {stage === 9 && !holiday && <FallingLeavesOverlay />}

      {/* Ground */}
      <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: "32%" }}>
        <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
          <path d="M0 55 Q80 32 160 50 Q240 68 320 44 Q380 28 400 48 L400 100 L0 100 Z"
            fill="#8aba6a" opacity="0.6" />
          <path d="M0 65 Q100 48 200 62 Q300 76 400 58 L400 100 L0 100 Z"
            fill="#5c8a47" />
          <path d="M0 65 Q100 48 200 62 Q300 76 400 58" fill="none"
            stroke="#6aa050" strokeWidth="1.5" opacity="0.8" />
          <path d="M0 75 Q100 68 200 73 Q300 78 400 70 L400 100 L0 100 Z"
            fill="#3d6030" />
        </svg>
      </div>

      {/* Decorative flowers */}
      <SceneFlower x={3}  color="#e8758a" />
      <SceneFlower x={6}  color="#f5e070" />
      <SceneFlower x={88} color="#e8758a" />
      <SceneFlower x={92} color="#f5e070" />
      <SceneFlower x={95} color="#e8758a" />

      {/* Centered tree */}
      <div
        className="absolute garden-sway"
        style={{
          bottom: "28%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "clamp(60px, 18%, 110px)",
          transformOrigin: "center bottom",
        }}
      >
        <GardenTreeSVG leafCount={leafCount} className="w-full h-auto" />
      </div>

      {/* Child name label */}
      {showLabel && childName && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
          <span className="text-[10px] font-semibold bg-white/75 backdrop-blur-sm text-[#2d2926] px-2.5 py-0.5 rounded-full shadow-sm">
            {childName}
          </span>
        </div>
      )}

      {/* Holiday badge */}
      {holiday && (
        <div className="absolute top-2 left-2 pointer-events-none">
          <span className="text-[9px] font-medium bg-white/60 text-[#2d2926] px-1.5 py-0.5 rounded-full">
            {holiday.name}
          </span>
        </div>
      )}
    </div>
  );
}
