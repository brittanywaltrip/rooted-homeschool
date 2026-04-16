"use client";

export default function PreviewWatermark() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10 overflow-hidden">
      <p
        className="text-[#e8e2d9] text-[40px] font-bold uppercase tracking-[8px] rotate-[-20deg] select-none whitespace-nowrap opacity-40"
        style={{ fontFamily: "Georgia, serif" }}
      >
        Created with Rooted · Preview
      </p>
    </div>
  );
}
