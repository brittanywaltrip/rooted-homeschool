"use client";

import React from "react";

interface PageHeroProps {
  overline: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Extra JSX rendered inside the hero (e.g. progress strip) */
  children?: React.ReactNode;
  /** Additional classes (no longer needed for -mx breakout, but kept for flexibility) */
  className?: string;
  /** Override background color (e.g. vacation blue) */
  bgColor?: string;
  /** Optional family photo URL — shows as small circle left of greeting */
  photoUrl?: string | null;
}

export default function PageHero({
  overline,
  title,
  subtitle,
  children,
  className = "",
  bgColor,
  photoUrl,
}: PageHeroProps) {
  return (
    <div
      className={`relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden ${className}`}
      style={{ background: bgColor || "#3d5c42" }}
    >
      {/* Decorative background leaves */}
      <div
        className="absolute top-2 right-3 text-[100px] leading-none select-none pointer-events-none"
        style={{ opacity: 0.06 }}
        aria-hidden
      >
        🌿
      </div>
      <div
        className="absolute -bottom-2 left-2 text-[80px] leading-none select-none pointer-events-none"
        style={{ opacity: 0.05 }}
        aria-hidden
      >
        🌱
      </div>

      <div className={photoUrl ? "flex items-center gap-3" : ""}>
        {photoUrl && (
          <img
            src={photoUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover border-2 border-white/80 shadow-md shrink-0 md:hidden"
          />
        )}
        <div>
          <p
            className="text-[11px] font-semibold tracking-widest uppercase mb-1"
            style={{ color: "#8cba8e" }}
          >
            {overline}
          </p>
          <h1
            className="text-[22px] sm:text-[26px] font-bold leading-tight"
            style={{ color: "#fefcf9", fontFamily: "var(--font-display)" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-[14px] mt-1" style={{ color: "rgba(255,255,255,0.70)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
