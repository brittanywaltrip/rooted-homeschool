"use client";

export default function ProgressPage() {
  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Learning Over Time
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Progress 📈</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Watch your children's knowledge grow, subject by subject.
        </p>
      </div>

      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
        <span className="text-5xl mb-4">🌱</span>
        <p className="font-semibold text-[#2d2926] mb-2">Progress tracking coming soon</p>
        <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
          Subject-by-subject progress charts, goal completion rates, and
          attendance records will live here.
        </p>
      </div>
    </div>
  );
}
