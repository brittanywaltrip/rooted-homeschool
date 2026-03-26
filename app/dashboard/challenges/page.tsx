"use client";

import { useEffect } from "react";

const CHALLENGE_IDEAS = [
  { emoji: "📖", title: "Read 10 Books", desc: "Track a reading challenge this month" },
  { emoji: "🧮", title: "Math Facts Mastery", desc: "Practice multiplication tables daily" },
  { emoji: "✍️", title: "Daily Journaling", desc: "Write one page every school day" },
  { emoji: "🌿", title: "Nature Study", desc: "Observe and sketch one plant or animal a week" },
];

export default function ChallengesPage() {
  useEffect(() => { document.title = "Challenges \u00b7 Rooted"; }, []);

  return (
    <div className="px-4 pt-8 pb-4 space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Goals & Growth
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Challenges ⚡</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Small, meaningful goals that stretch your learners.
        </p>
      </div>

      {/* Active challenges empty state */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest">
            Active Challenges
          </h2>
          <span className="text-xs font-medium text-[#b5aca4] bg-[#f0ede8] px-2 py-0.5 rounded-full">
            0 active
          </span>
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">🏁</span>
          <p className="font-medium text-[#2d2926] mb-1">No active challenges</p>
          <p className="text-sm text-[#7a6f65]">
            Set a challenge to give your learners something exciting to work toward.
          </p>
        </div>
      </div>

      {/* Challenge ideas */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Challenge Ideas
        </h2>
        <div className="space-y-2">
          {CHALLENGE_IDEAS.map((idea) => (
            <div
              key={idea.title}
              className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3.5 flex items-center gap-4"
            >
              <span className="text-2xl">{idea.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-[#2d2926]">{idea.title}</p>
                <p className="text-xs text-[#7a6f65]">{idea.desc}</p>
              </div>
              <button className="text-xs font-medium text-[#5c7f63] border border-[#5c7f63] px-3 py-1 rounded-lg hover:bg-[#e8f0e9] transition-colors shrink-0">
                Add
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Custom challenge */}
      <button className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-medium py-3 rounded-xl transition-colors">
        + Create Custom Challenge
      </button>
    </div>
  );
}
