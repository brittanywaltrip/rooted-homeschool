"use client";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  memoryId: string;
  initialValue: boolean;
  onChange?: (val: boolean) => void;
  size?: "sm" | "md";
  showLabel?: boolean;
}

export default function YearbookBookmark({ memoryId, initialValue, onChange, size = "md", showLabel = false }: Props) {
  const [inBook, setInBook] = useState(initialValue);
  const [error, setError] = useState(false);
  const [pulse, setPulse] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isSm = size === "sm";
  const svgW = isSm ? 14 : 16;
  const svgH = isSm ? 17 : 20;
  const btnSize = isSm ? 28 : 36;

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const next = !inBook;
    setInBook(next);
    setError(false);

    // Pulse animation
    setPulse(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setPulse(false), 200);

    const { error: err } = await supabase
      .from("memories")
      .update({ include_in_book: next, updated_at: new Date().toISOString() })
      .eq("id", memoryId);

    if (err) {
      setInBook(!next); // revert
      setError(true);
      setTimeout(() => setError(false), 2000);
      return;
    }

    onChange?.(next);
  }

  return (
    <button
      onClick={toggle}
      className={showLabel
        ? "flex items-center gap-1.5 rounded-xl px-3 py-2 border border-[#e8e2d9] hover:bg-[#f0ede8] transition"
        : "flex items-center justify-center rounded-full bg-transparent hover:bg-black/5 transition"}
      style={showLabel ? undefined : { width: btnSize, height: btnSize }}
      aria-label={inBook ? "Remove from yearbook" : "Add to yearbook"}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox="0 0 20 22"
        className="shrink-0"
        style={{
          color: inBook ? "var(--g-deep)" : "#c4b89a",
          transform: pulse ? "scale(1.25)" : "scale(1)",
          transition: "transform 200ms ease",
        }}
      >
        {inBook ? (
          <path d="M5 1h10a1 1 0 0 1 1 1v18l-6-4-6 4V2a1 1 0 0 1 1-1z" fill="currentColor" />
        ) : (
          <path d="M5 1h10a1 1 0 0 1 1 1v18l-6-4-6 4V2a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {showLabel && (
        <span className="text-sm font-medium" style={{ color: inBook ? "var(--g-deep)" : "#7a6f65" }}>
          {inBook ? "In Yearbook" : "Add to Yearbook"}
        </span>
      )}
      {error && (
        <span className="absolute mt-10 text-[9px] text-red-500 whitespace-nowrap">
          Couldn&apos;t save
        </span>
      )}
    </button>
  );
}
