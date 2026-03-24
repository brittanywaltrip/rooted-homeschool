"use client";

// ─── Stage constants ────────────────────────────────────────────────────────────

export const LEAF_THRESHOLDS = [0, 1, 3, 6, 11, 21, 41, 70, 100, 135];

export const STAGE_INFO = [
  { name: "Seed",       desc: "Just planted",          color: "#c4956a" },
  { name: "Sprouting",  desc: "A tiny shoot appears",  color: "#8ab85a" },
  { name: "Seedling",   desc: "First leaves unfurl",   color: "#7ab85a" },
  { name: "Young Plant",desc: "Getting taller",        color: "#6aaa4a" },
  { name: "Growing",    desc: "Taking shape",          color: "#5a9a3a" },
  { name: "Thriving",   desc: "Full and lush",         color: "#5c7f63" },
  { name: "Full Tree",  desc: "Strong and tall",       color: "#4a8a2a" },
  { name: "Blooming",   desc: "In full bloom",         color: "#3a7a1a" },
  { name: "Fruiting",   desc: "Bearing fruit",         color: "#c47a2a" },
  { name: "Majestic",   desc: "Fully flourishing",     color: "#2d5c38" },
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
  // Spring Mar–May
  if (m >= 3 && m <= 5)
    return "linear-gradient(180deg, #87CEEB 0%, #C8E8F8 60%, #dff0e8 82%, #7ab87a 100%)";
  // Summer Jun–Aug
  if (m >= 6 && m <= 8)
    return "linear-gradient(180deg, #1E90FF 0%, #87CEEB 60%, #d4ecea 82%, #6aaa5a 100%)";
  // Autumn Sep–Nov
  if (m >= 9 && m <= 11)
    return "linear-gradient(180deg, #C0392B 0%, #E8A040 55%, #f0d090 78%, #8aaa5a 100%)";
  // Winter Dec–Feb
  return "linear-gradient(180deg, #4A6FA5 0%, #B8D0E8 60%, #d8e8f4 82%, #6a9a8a 100%)";
}

// ─── Emoji tree (10 stages) ─────────────────────────────────────────────────────

type TreeConfig = { emoji: string; size: number; overlay?: string };

function getTreeConfig(stage: number): TreeConfig {
  switch (stage) {
    case 1:  return { emoji: "🟤", size: 48 };   // bare soil/seed
    case 2:  return { emoji: "🌱", size: 60 };   // tiny sprout
    case 3:  return { emoji: "🌿", size: 72 };   // seedling
    case 4:  return { emoji: "🪴", size: 84 };   // young plant
    case 5:  return { emoji: "🌳", size: 96 };   // growing
    case 6:  return { emoji: "🌲", size: 104 };  // thriving
    case 7:  return { emoji: "🌳", size: 108 };  // full tree
    case 8:  return { emoji: "🌸", size: 108 };  // blooming
    case 9:  return { emoji: "🌳", size: 108, overlay: "🍎" };  // fruiting
    case 10: return { emoji: "🌳", size: 112, overlay: "✨" };  // majestic
    default: return { emoji: "🟤", size: 48 };
  }
}

export function GardenTreeSVG({
  leafCount,
  className,
  sizeOverride,
  style,
}: {
  leafCount: number;
  className?: string;
  sizeOverride?: number;
  style?: React.CSSProperties;
}) {
  const stage = getStageFromLeaves(leafCount);
  const config = getTreeConfig(stage);
  const size = sizeOverride ?? config.size;

  return (
    <div
      className={`relative flex items-end justify-center ${className ?? ""}`}
      style={style}
    >
      <span
        style={{
          fontSize: size,
          lineHeight: 1,
          filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.2))",
          display: "block",
          userSelect: "none",
        }}
        aria-hidden
      >
        {config.emoji}
      </span>
      {config.overlay && (
        <span
          style={{
            fontSize: Math.round(size * 0.36),
            position: "absolute",
            bottom: 0,
            right: -6,
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))",
            userSelect: "none",
          }}
          aria-hidden
        >
          {config.overlay}
        </span>
      )}
    </div>
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
  childColor?: string;
  isBirthday?: boolean;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function GardenScene({
  leafCount,
  childName,
  childColor,
  isBirthday = false,
  compact = false,
  showLabel = false,
  className = "",
  style,
}: GardenSceneProps) {
  const stage = getStageFromLeaves(leafCount);

  if (compact) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${className}`} style={style}>
        <GardenTreeSVG leafCount={leafCount} sizeOverride={64} />
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

      {/* Seasonal elements — one subtle touch per season */}
      {!holiday && (() => {
        const m = new Date().getMonth() + 1;
        // Autumn: amber leaf drifts
        if (m >= 9 && m <= 11 && stage < 9) return (
          <span className="absolute text-lg pointer-events-none select-none" style={{
            top: "15%", left: "35%",
            animation: "seasonal-leaf 8s ease-in-out infinite",
            opacity: 0.4,
          }}>🍂</span>
        );
        // Winter: dusting
        if (m === 12 || m <= 2) return (
          <div className="absolute top-0 left-0 right-0 h-8 pointer-events-none" style={{
            background: "linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, transparent 100%)",
          }} />
        );
        // Spring: blossom
        if (m >= 3 && m <= 5 && stage >= 3) return (
          <span className="absolute text-sm pointer-events-none select-none" style={{
            bottom: "38%", left: "48%", opacity: 0.5,
          }}>🌸</span>
        );
        // Summer: bigger sun + extra butterfly
        if (m >= 6 && m <= 8) return (
          <SceneButterfly x={38} y={18} delay={2.5} color="#87ceeb" />
        );
        return null;
      })()}

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
          bottom: "26%",
          left: "50%",
          transform: "translateX(-50%)",
          transformOrigin: "center bottom",
        }}
      >
        <GardenTreeSVG leafCount={leafCount} />
      </div>

      {/* Child name label + birthday pennant */}
      {showLabel && childName && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center items-center gap-1 pointer-events-none">
          {isBirthday && (
            <svg width="14" height="16" viewBox="0 0 14 16" className="shrink-0">
              <polygon points="2,0 14,4 2,8" fill={childColor || "#5c7f63"} />
              <line x1="2" y1="0" x2="2" y2="16" stroke={childColor || "#5c7f63"} strokeWidth="1.5" />
              <polygon points="5,3 8,4 5,5" fill="#fef9c3" opacity="0.8" />
            </svg>
          )}
          <span className="text-[10px] font-semibold bg-white/75 backdrop-blur-sm text-[#2d2926] px-2.5 py-0.5 rounded-full shadow-sm">
            {childName}{isBirthday ? " 🎂" : ""}
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
