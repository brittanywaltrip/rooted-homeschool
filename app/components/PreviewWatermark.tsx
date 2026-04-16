"use client";

export default function PreviewWatermark() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {/* Repeating diagonal watermark pattern */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-16"
        style={{ transform: "rotate(-25deg)", transformOrigin: "center center" }}
      >
        {[-3, -2, -1, 0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-12 whitespace-nowrap">
            <span
              className="text-[#c9bfb0] text-[15px] font-semibold uppercase tracking-[6px] select-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Created with Rooted · Preview
            </span>
            <span
              className="text-[#c9bfb0] text-[15px] font-semibold uppercase tracking-[6px] select-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Created with Rooted · Preview
            </span>
          </div>
        ))}
      </div>
      {/* Bottom banner strip */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#f5f0e8] border-t border-[#e0d8cc] py-2 px-4 text-center">
        <p className="text-[#8b7e6e] text-xs font-medium tracking-wide">
          PREVIEW — Upgrade to Rooted+ for a clean, official version
        </p>
      </div>
    </div>
  );
}
