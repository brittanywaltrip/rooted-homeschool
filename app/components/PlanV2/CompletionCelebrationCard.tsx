"use client";

type Props = {
  childName: string;
  curriculumName: string;
  /** ISO date string of when the curriculum was started */
  startedDate: string;
  /** ISO date string of when the curriculum was completed */
  completedDate: string;
  lessonsCount: number;
  /** Total minutes logged (will be formatted as "Xh Ym") */
  minutesLogged: number;
  onSaveToMemories?: () => void;
  onAddToYearbook?: () => void;
  onPrintCertificate?: () => void;
  /** Fires when the user taps the X in the top-right corner of the card.
   *  Parent should flag the goal as celebrated so the card doesn't render
   *  on the next pass (the existing dismissCelebration helper does this). */
  onDismiss?: () => void;
};

/**
 * CompletionCelebrationCard — replaces a curriculum row's normal display
 * the moment its last lesson is marked complete. Shows the kid's win
 * with stats and one-tap actions to save the moment to Memories /
 * Yearbook / printable certificate.
 *
 * Uses Rooted brand tokens (sage greens, warm off-white). NO gold —
 * gold is reserved for paid/Founding Family indicators.
 *
 * Standalone — wire into the Plan page's curriculum section in a later
 * integration prompt.
 */
export default function CompletionCelebrationCard({
  childName,
  curriculumName,
  startedDate,
  completedDate,
  lessonsCount,
  minutesLogged,
  onSaveToMemories,
  onAddToYearbook,
  onPrintCertificate,
  onDismiss,
}: Props) {
  const duration = formatDurationSpan(startedDate, completedDate);
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f3f7f1 0%, #e8efe7 100%)",
        border: "1px solid #cdd9cb",
        borderRadius: "16px",
        padding: "28px 24px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span style={leafTopLeft}>🌿</span>
      <span style={leafTopRight}>🌿</span>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss completion card"
          style={dismissBtnStyle}
        >
          ×
        </button>
      )}

      <div style={eyebrowStyle}>Curriculum complete</div>
      <h3 style={titleStyle}>
        {childName} finished
        <br />
        {curriculumName}!
      </h3>
      <p style={subStyle}>
        Started {formatDate(startedDate)} · Finished {formatDate(completedDate)}
      </p>

      <div style={statsGridStyle}>
        <Stat num={lessonsCount.toString()} label="Lessons" />
        <Stat num={formatMinutes(minutesLogged)} label="Logged" />
        <Stat num={duration.num} label={duration.label} />
      </div>

      <div style={actionsStyle}>
        {onSaveToMemories && (
          <button onClick={onSaveToMemories} style={btnPrimary}>
            Save to Memories
          </button>
        )}
        {onAddToYearbook && (
          <button onClick={onAddToYearbook} style={btnSecondary}>
            Add to Yearbook
          </button>
        )}
        {onPrintCertificate && (
          <button onClick={onPrintCertificate} style={btnTertiary}>
            Print certificate
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.7)",
        borderRadius: "10px",
        padding: "10px 6px",
      }}
    >
      <div
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "22px",
          fontWeight: 600,
          color: "#2D5A3D",
          lineHeight: 1,
        }}
      >
        {num}
      </div>
      <div
        style={{
          fontSize: "10px",
          color: "#6b6b6b",
          marginTop: "4px",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDurationSpan(startISO: string, endISO: string): { num: string; label: string } {
  const start = new Date(startISO);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endISO);
  end.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const totalDays = Math.max(1, dayDiff + 1);
  if (totalDays < 7) {
    return { num: String(totalDays), label: totalDays === 1 ? "Day" : "Days" };
  }
  const weeks = Math.round(totalDays / 7);
  return { num: String(weeks), label: weeks === 1 ? "Week" : "Weeks" };
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: "11px",
  letterSpacing: "1.5px",
  color: "#5c7f63",
  textTransform: "uppercase",
  fontWeight: 600,
  marginBottom: "10px",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontSize: "28px",
  fontWeight: 500,
  color: "#1a2c22",
  margin: "0 0 6px",
  lineHeight: 1.2,
};

const subStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "#3d5c48",
  margin: "0 0 18px",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "10px",
  margin: "18px 0 22px",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  justifyContent: "center",
  flexWrap: "wrap",
};

const btnBase: React.CSSProperties = {
  borderRadius: "20px",
  padding: "9px 18px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "#2D5A3D",
  color: "white",
  border: "none",
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: "white",
  color: "#2D5A3D",
  borderColor: "#2D5A3D",
};

const btnTertiary: React.CSSProperties = {
  ...btnBase,
  background: "transparent",
  color: "#3d5c48",
  borderColor: "#E4E1D8",
};

const dismissBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: "8px",
  right: "8px",
  width: "28px",
  height: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "9999px",
  border: "none",
  background: "rgba(255,255,255,0.6)",
  color: "#5c5c5c",
  fontSize: "16px",
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  zIndex: 1,
};

const leafTopLeft: React.CSSProperties = {
  position: "absolute",
  top: "14px",
  left: "18px",
  fontSize: "22px",
  opacity: 0.6,
  pointerEvents: "none",
};

const leafTopRight: React.CSSProperties = {
  position: "absolute",
  top: "14px",
  right: "18px",
  fontSize: "22px",
  opacity: 0.6,
  transform: "scaleX(-1)",
  pointerEvents: "none",
};
