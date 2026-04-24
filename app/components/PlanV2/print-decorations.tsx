"use client";

/* ============================================================================
 * print-decorations — small SVG flourishes for the Plan print sheets.
 *
 * Goal: paper-planner feel. Slightly irregular strokes, no fills, brand
 * green/gold lines. Components stay small and lightweight so they don't
 * blow up the printed PDF size — every shape is a hand-tuned path with no
 * runtime randomness (deterministic output is important for a print
 * preview that should look identical every time).
 * ==========================================================================*/

const BRAND = "#3d5c42"; // matches --g-deep
const GOLD = "#C4962A";  // matches --g-gold

export function CornerLeaves({
  position,
  color = BRAND,
}: {
  position: "top-right" | "bottom-left" | "top-left" | "bottom-right";
  color?: string;
}) {
  // One source SVG; we flip via CSS transforms per corner so we ship one path
  // instead of four. The shape is a small leafy vine — three leaves on a
  // gentle stem. Stroke widths vary slightly so it reads as drawn-by-hand.
  const transform =
    position === "top-right" ? "scale(-1, 1)" :
    position === "bottom-left" ? "scale(1, -1)" :
    position === "bottom-right" ? "scale(-1, -1)" :
    undefined;

  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    width: 96,
    height: 96,
    pointerEvents: "none",
    ...(position === "top-right" && { top: 8, right: 8 }),
    ...(position === "top-left" && { top: 8, left: 8 }),
    ...(position === "bottom-right" && { bottom: 8, right: 8 }),
    ...(position === "bottom-left" && { bottom: 8, left: 8 }),
  };

  return (
    <div aria-hidden style={wrapperStyle}>
      <svg viewBox="0 0 96 96" width="96" height="96" style={{ transform }}>
        {/* Stem */}
        <path
          d="M 8 8 C 22 22, 32 38, 40 56 C 44 66, 50 78, 60 88"
          stroke={color}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        {/* Leaf 1 */}
        <path
          d="M 22 22 C 16 18, 10 22, 12 30 C 18 30, 24 28, 22 22 Z"
          stroke={color}
          strokeWidth="1.1"
          fill="none"
          strokeLinejoin="round"
        />
        {/* Leaf 2 */}
        <path
          d="M 36 46 C 30 44, 24 50, 28 58 C 36 56, 42 50, 36 46 Z"
          stroke={color}
          strokeWidth="1"
          fill="none"
          strokeLinejoin="round"
        />
        {/* Leaf 3 */}
        <path
          d="M 50 70 C 44 70, 40 78, 46 84 C 54 82, 58 76, 50 70 Z"
          stroke={color}
          strokeWidth="1.15"
          fill="none"
          strokeLinejoin="round"
        />
        {/* Tiny berry */}
        <circle cx="14" cy="14" r="1.5" fill={color} opacity="0.6" />
      </svg>
    </div>
  );
}

export function DateCircle({
  dateNumber,
  size = 80,
  color = BRAND,
}: {
  dateNumber: number;
  size?: number;
  color?: string;
}) {
  // Irregular oval — three control points off-true to look hand-drawn.
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg viewBox="0 0 80 80" width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        <path
          d="M 40 6 C 60 8, 76 22, 74 42 C 72 62, 56 76, 36 74 C 16 72, 4 56, 8 36 C 12 18, 22 6, 40 6 Z"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
      <span
        className="font-handwritten"
        style={{
          position: "relative",
          fontSize: Math.round(size * 0.5),
          lineHeight: 1,
          color,
          fontWeight: 600,
        }}
      >
        {dateNumber}
      </span>
    </div>
  );
}

export function CheckCircle({
  filled = false,
  size = 18,
  color = BRAND,
}: {
  filled?: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
    >
      <path
        d="M 10 2 C 14 2.5, 18 6, 17.5 11 C 17 16, 12.5 18.5, 7.5 17.5 C 3 16.5, 1 12, 2.5 7.5 C 4 4, 7 2, 10 2 Z"
        stroke={color}
        strokeWidth="1.3"
        fill={filled ? color : "none"}
      />
      {filled ? (
        <path
          d="M 6 10 L 9 13 L 14 7"
          stroke="#ffffff"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export function SectionDivider({ color = GOLD }: { color?: string }) {
  // Dashed line with a small leaf at the center — section break that doesn't
  // shout. Width follows the parent at 100%.
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "10px 0",
        color,
      }}
    >
      <svg viewBox="0 0 200 6" preserveAspectRatio="none" style={{ flex: 1, height: 6 }}>
        <line
          x1="0" y1="3" x2="200" y2="3"
          stroke={color}
          strokeWidth="0.8"
          strokeDasharray="3 4"
        />
      </svg>
      <svg viewBox="0 0 14 14" width="14" height="14" style={{ flexShrink: 0 }}>
        <path
          d="M 7 1 C 11 3, 13 7, 11 11 C 8 13, 4 11, 3 7 C 4 4, 5 2, 7 1 Z"
          stroke={color}
          strokeWidth="1"
          fill="none"
        />
        <path d="M 7 1 L 7 13" stroke={color} strokeWidth="0.8" />
      </svg>
      <svg viewBox="0 0 200 6" preserveAspectRatio="none" style={{ flex: 1, height: 6 }}>
        <line
          x1="0" y1="3" x2="200" y2="3"
          stroke={color}
          strokeWidth="0.8"
          strokeDasharray="3 4"
        />
      </svg>
    </div>
  );
}

/** Small inline leaf — used next to section labels ("Today's Lessons" etc.). */
export function InlineLeaf({ color = BRAND, size = 14 }: { color?: string; size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 14 14" width={size} height={size}>
      <path
        d="M 7 1 C 11 3, 13 7, 11 11 C 8 13, 4 11, 3 7 C 4 4, 5 2, 7 1 Z"
        stroke={color}
        strokeWidth="1.1"
        fill="none"
      />
      <path d="M 7 1 L 7 12" stroke={color} strokeWidth="0.8" />
    </svg>
  );
}
