"use client";

const CATEGORIES = [
  { emoji: "🔤", label: "Language Arts" },
  { emoji: "🔢", label: "Mathematics" },
  { emoji: "🔬", label: "Science" },
  { emoji: "🌍", label: "History" },
  { emoji: "🎨", label: "Arts & Music" },
  { emoji: "📖", label: "Reading" },
];

export default function ResourcesPage() {
  return (
    <div className="px-4 pt-8 pb-4 space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Your Library
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Resources 📚</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Everything your family needs, in one place.
        </p>
      </div>

      {/* Search bar (decorative placeholder) */}
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#b5aca4] text-base">🔍</span>
        <input
          type="text"
          placeholder="Search resources…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition text-sm"
        />
      </div>

      {/* Subject categories */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Browse by Subject
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              className="bg-[#fefcf9] border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#e8f0e9] rounded-xl p-3.5 flex flex-col items-center gap-1.5 transition-colors"
            >
              <span className="text-2xl">{cat.emoji}</span>
              <span className="text-xs font-medium text-[#2d2926] text-center leading-tight">
                {cat.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
          Saved Resources
        </h2>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">🔖</span>
          <p className="font-medium text-[#2d2926] mb-1">No saved resources yet</p>
          <p className="text-sm text-[#7a6f65]">
            Add curriculum links, book lists, and favorite websites here.
          </p>
        </div>
      </div>

      {/* Add resource button */}
      <button className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-medium py-3 rounded-xl transition-colors">
        + Add a Resource
      </button>
    </div>
  );
}
