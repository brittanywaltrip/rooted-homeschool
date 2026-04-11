"use client";

import { useEffect } from "react";

const GROWTH_AREAS = [
  { emoji: "📐", label: "Math", color: "bg-blue-50 border-blue-100", progress: 0 },
  { emoji: "🔤", label: "Reading", color: "bg-purple-50 border-purple-100", progress: 0 },
  { emoji: "✍️", label: "Writing", color: "bg-pink-50 border-pink-100", progress: 0 },
  { emoji: "🔬", label: "Science", color: "bg-teal-50 border-teal-100", progress: 0 },
  { emoji: "🌍", label: "History", color: "bg-amber-50 border-amber-100", progress: 0 },
  { emoji: "🎨", label: "Arts", color: "bg-orange-50 border-orange-100", progress: 0 },
];

export default function GrowthPage() {
  useEffect(() => { document.title = "Growth \u00b7 Rooted"; }, []);

  return (
    <div className="px-4 pt-8 pb-4 space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Watch Them Bloom
        </p>
        <h1 className="text-2xl text-[#2d2926]" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 }}>Growth</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Track progress across every subject and skill.
        </p>
      </div>

      {/* Overall progress */}
      <div className="bg-gradient-to-br from-[#5c7f63] to-[#3d5c42] text-white rounded-2xl p-5">
        <p className="text-xs font-medium uppercase tracking-widest opacity-70 mb-3">
          Overall Progress
        </p>
        <div className="flex items-end gap-3">
          <span className="text-4xl font-bold">0%</span>
          <span className="text-sm opacity-80 mb-1">of this month&apos;s goals</span>
        </div>
        <div className="mt-4 w-full h-2 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full" style={{ width: "0%" }} />
        </div>
        <p className="text-xs opacity-70 mt-2">Start logging to see your family grow 🌿</p>
      </div>

      {/* Subject breakdown */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          By Subject
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {GROWTH_AREAS.map((area) => (
            <div
              key={area.label}
              className={`${area.color} border rounded-xl p-4 flex flex-col gap-2`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{area.emoji}</span>
                <span className="text-sm font-medium text-[#2d2926]">{area.label}</span>
              </div>
              <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#5c7f63] rounded-full"
                  style={{ width: `${area.progress}%` }}
                />
              </div>
              <span className="text-xs text-[#7a6f65]">{area.progress}% complete</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent wins empty state */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Recent Wins
        </h2>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">🏅</span>
          <p className="font-medium text-[#2d2926] mb-1">No wins recorded yet</p>
          <p className="text-sm text-[#7a6f65]">
            Completed lessons and achievements will show up here as celebrations.
          </p>
        </div>
      </div>
    </div>
  );
}
