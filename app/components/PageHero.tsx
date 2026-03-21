"use client";

import React from "react";

interface PageHeroProps {
  overline: string;
  title: string;
  subtitle?: string;
  /** Extra JSX rendered inside the hero (e.g. progress strip) */
  children?: React.ReactNode;
  /** Breakout class to escape container padding, e.g. "-mx-5" or "-mx-4" */
  className?: string;
}

export default function PageHero({
  overline,
  title,
  subtitle,
  children,
  className = "",
}: PageHeroProps) {
  return (
    <div
      className={`rounded-b-[24px] px-6 pt-7 pb-8 ${className}`}
      style={{ background: "#3d5c42" }}
    >
      <p
        className="text-[11px] font-semibold tracking-widest uppercase mb-1"
        style={{ color: "#8cba8e" }}
      >
        {overline}
      </p>
      <h1
        className="text-[26px] font-bold leading-tight"
        style={{ color: "#fefcf9", fontFamily: "Georgia, serif" }}
      >
        {title}
      </h1>
      {subtitle && (
        <p className="text-[14px] mt-1" style={{ color: "rgba(255,255,255,0.70)" }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}
