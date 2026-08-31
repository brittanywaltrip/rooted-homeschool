"use client";

/**
 * When did this happen?
 *
 * Today and Yesterday chips plus a bare date input, so a family can date a
 * memory to the day it happened while they are logging it, instead of saving
 * it as today and going to Memories afterwards to edit the date.
 *
 * Both strings are built in LOCAL time, the same way localDateStr on the Today
 * page and the FAB's own date string already do. toISOString would shift the
 * date backwards for every family west of UTC after their evening, which is
 * exactly when a homeschool day gets logged.
 *
 * Presentational. The caller owns the state and decides which insert the value
 * reaches, so a date chosen in one sheet can never leak into another.
 */

/** Local-time YYYY-MM-DD. Shared by every caller's "reset to today". */
export function todayLocalDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function WhenPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (d: string) => void;
}) {
  const now = new Date();
  const todayStr = todayLocalDateStr(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = todayLocalDateStr(yesterday);

  return (
    <div>
      <label className="text-xs font-medium text-[#7a6f65] block mb-2">When?</label>
      <div className="flex gap-2">
        {[
          { label: "Today", value: todayStr },
          { label: "Yesterday", value: yesterdayStr },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              value === opt.value
                ? "bg-[#eef5ee] border-[#5c7f63] text-[var(--g-deep)] font-semibold"
                : "bg-white border-[#e8e2d9] text-[#7a6f65]"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="px-2 py-1.5 rounded-full text-xs border border-[#e8e2d9] text-[#7a6f65] bg-white"
        />
      </div>
    </div>
  );
}
