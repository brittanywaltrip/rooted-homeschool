"use client";

import { useEffect } from "react";

export default function JourneyPage() {
  useEffect(() => { document.title = "Journey \u00b7 Rooted"; }, []);
  const milestones = [
    { emoji: "🌱", title: "Account Created", desc: "You started your Rooted journey", done: true },
    { emoji: "📖", title: "First Lesson Added", desc: "Add your first lesson plan", done: false },
    { emoji: "✅", title: "First Day Completed", desc: "Complete a full school day", done: false },
    { emoji: "📅", title: "One Week In", desc: "Log 5 consecutive school days", done: false },
    { emoji: "🏆", title: "First Month", desc: "Complete your first full month", done: false },
  ];

  return (
    <div className="px-4 pt-8 pb-4 space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Your Progress
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">The Journey 🗺️</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Every step forward is worth celebrating.
        </p>
      </div>

      {/* Progress bar */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-[#2d2926]">Milestone Progress</span>
          <span className="text-xs font-medium text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">
            1 of {milestones.length}
          </span>
        </div>
        <div className="w-full h-2 bg-[#e8e2d9] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5c7f63] rounded-full transition-all"
            style={{ width: `${(1 / milestones.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Milestones */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Milestones
        </h2>
        <div className="space-y-2">
          {milestones.map((m, i) => (
            <div
              key={i}
              className={`flex items-center gap-4 rounded-xl px-4 py-3.5 border transition-colors ${
                m.done
                  ? "bg-[#e8f0e9] border-[#5c7f63]/30"
                  : "bg-[#fefcf9] border-[#e8e2d9]"
              }`}
            >
              <span className="text-2xl">{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className={`font-medium text-sm ${m.done ? "text-[#3d5c42]" : "text-[#2d2926]"}`}>
                  {m.title}
                </p>
                <p className="text-xs text-[#7a6f65]">{m.desc}</p>
              </div>
              {m.done && (
                <span className="text-[#5c7f63] text-lg">✓</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Learning log empty state */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Learning Log
        </h2>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">📒</span>
          <p className="font-medium text-[#2d2926] mb-1">No entries yet</p>
          <p className="text-sm text-[#7a6f65]">
            Your completed lessons and logged days will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
