"use client";

import { useEffect, useRef } from "react";

/**
 * The dark-green full-screen moment, extracted so there is exactly one of it.
 *
 * Onboarding's CelebrationStep owned this look: the #3e6643 ground, the white
 * logo, the display-font heading, the confetti burst. The Schedule Builder now
 * needs the same moment when a family finishes setting up their year, and a
 * second copy would drift the way two copies always do. Onboarding renders its
 * own content inside this shell, so its wording and its app-store badges are
 * unchanged.
 *
 * Everything specific to a screen (heading, body, buttons) is `children`. This
 * component owns only the ground, the lockup, the confetti and the spacing.
 */
export default function RootedCelebration(props: {
  /** Small line above the heading. Optional. */
  overline?: string;
  /** The heading itself, already in the words the screen wants. */
  heading: string;
  children?: React.ReactNode;
  /** Skip the burst (a screen that is re-entered, say). Defaults to firing. */
  confetti?: boolean;
}) {
  const fired = useRef(false);
  const wantsConfetti = props.confetti !== false;

  useEffect(() => {
    if (!wantsConfetti || fired.current) return;
    fired.current = true;
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
  }, [wantsConfetti]);

  return (
    <div className="min-h-screen bg-[#3e6643] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="mb-12">
          {/* The logo artwork already carries "capture. plan. remember.", so the
              text line that used to sit under it printed the tagline twice. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rooted-logo-white.png" alt="rooted. capture. plan. remember." className="h-28 mx-auto opacity-90" />
        </div>

        {props.overline ? (
          <p
            className="text-[20px] tracking-wide mb-1"
            style={{ fontFamily: "var(--font-display)", color: "rgba(255,255,255,0.75)" }}
          >
            {props.overline}
          </p>
        ) : null}

        <h2
          className="text-white font-bold mb-2"
          style={{ fontFamily: "var(--font-display)", fontSize: "38px", lineHeight: "1.15" }}
        >
          {props.heading}
        </h2>

        {props.children}
      </div>
    </div>
  );
}
