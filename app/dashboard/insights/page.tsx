"use client";

export default function InsightsPage() {
  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Patterns & Trends
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Insights 💡</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Discover what&apos;s working and where to focus next.
        </p>
      </div>

      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
        <span className="text-5xl mb-4">🔍</span>
        <p className="font-semibold text-[#2d2926] mb-2">Insights coming soon</p>
        <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
          Weekly summaries, learning streaks, your most productive days, and
          smart suggestions will appear here once you have some lessons logged.
        </p>
      </div>
    </div>
  );
}
