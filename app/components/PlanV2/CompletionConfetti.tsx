"use client";

import { useEffect, useState } from "react";

type Props = {
  childName: string;
  curriculumName: string;
  onDismiss?: () => void;
  /** ms to display before auto-fading. Default 3000. */
  duration?: number;
};

/**
 * CompletionConfetti — soft sage celebration toast that appears the
 * moment a curriculum's last lesson is marked complete. Auto-dismisses
 * after `duration` ms, with a 400ms fade-out at the end.
 *
 * Uses Rooted brand tokens (sage greens, warm off-white). No gold —
 * gold is reserved for paid/Founding Family indicators only.
 *
 * Standalone — wire into the Plan page in a later integration prompt.
 */
export default function CompletionConfetti({
  childName,
  curriculumName,
  onDismiss,
  duration = 3000,
}: Props) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeAt = duration - 400;
    const fadeTimer = setTimeout(() => setFading(true), fadeAt);
    const dismissTimer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, duration);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: "linear-gradient(135deg, #f3f7f1 0%, #e8efe7 100%)",
        border: "1px solid #cdd9cb",
        borderRadius: "16px",
        padding: "20px 28px",
        boxShadow: "0 12px 40px rgba(26, 44, 34, 0.18)",
        maxWidth: "min(420px, calc(100vw - 32px))",
        textAlign: "center",
        opacity: fading ? 0 : 1,
        transition: "opacity 400ms ease-out",
      }}
    >
      {/* Decorative leaves */}
      <span style={leafStyle("12px", "16px", "-15deg")}>🍃</span>
      <span style={leafStyle("12px", undefined, "20deg", "16px")}>🌿</span>
      <span style={leafStyle(undefined, "20px", "35deg", undefined, "10px")}>🌱</span>
      <span style={leafStyle(undefined, undefined, "-20deg", "16px", "12px")}>🍃</span>

      <div
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "22px",
          fontWeight: 500,
          color: "#1a2c22",
          lineHeight: 1.2,
        }}
      >
        You did it, {childName}! 🎉
      </div>
      <div
        style={{
          fontSize: "13px",
          color: "#3d5c48",
          marginTop: "4px",
        }}
      >
        {curriculumName}, complete
      </div>
    </div>
  );
}

function leafStyle(
  top?: string,
  left?: string,
  rotate?: string,
  right?: string,
  bottom?: string
): React.CSSProperties {
  return {
    position: "absolute",
    fontSize: "16px",
    opacity: 0.5,
    pointerEvents: "none",
    top,
    left,
    right,
    bottom,
    transform: rotate ? `rotate(${rotate})` : undefined,
  };
}
