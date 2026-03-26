"use client";

import { useEffect, useState } from "react";
import type { BadgeDef } from "@/lib/badges";

interface BadgeNotificationProps {
  badge: BadgeDef;
  onDone: () => void;
}

export default function BadgeNotification({ badge, onDone }: BadgeNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Slide in
    const showTimer = setTimeout(() => setVisible(true), 50);
    // Start exit
    const exitTimer = setTimeout(() => setLeaving(true), 3600);
    // Clean up
    const doneTimer = setTimeout(onDone, 4000);
    return () => { clearTimeout(showTimer); clearTimeout(exitTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div
      className="fixed bottom-24 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      style={{
        transform: `translateX(-50%) translateY(${visible && !leaving ? "0" : "120%"})`,
        opacity: visible && !leaving ? 1 : 0,
        transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease",
      }}
    >
      <div
        className="rounded-2xl px-5 py-4 shadow-xl flex items-center gap-4"
        style={{ background: "linear-gradient(135deg, #2d5a3d 0%, #3d7a50 100%)" }}
      >
        <span className="text-4xl shrink-0">{badge.emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{badge.label}</p>
          <p className="text-xs text-white/70 leading-relaxed mt-0.5">{badge.message}</p>
        </div>
      </div>
    </div>
  );
}
