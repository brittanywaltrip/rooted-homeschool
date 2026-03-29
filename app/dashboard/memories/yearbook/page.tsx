"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  child_id: string | null;
  date: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  include_in_book: boolean;
};

type Child = { id: string; name: string; color: string | null };

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_EMOJI: Record<string, string> = {
  photo: "📷", drawing: "🎨", book: "📖", win: "🏆",
  quote: "🗒️", project: "🔬", field_trip: "🗺️", activity: "🎵",
};

const TYPE_LABEL: Record<string, string> = {
  photo: "Photo", drawing: "Drawing", book: "Book", win: "Win",
  quote: "Moment", project: "Project", field_trip: "Field Trip", activity: "Activity",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function YearbookPage() {
  const { effectiveUserId, isPartner } = usePartner();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => { document.title = "Yearbook \u00b7 Rooted"; }, []);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    const [{ data: mems }, { data: kids }] = await Promise.all([
      supabase
        .from("memories")
        .select("id, child_id, date, type, title, caption, photo_url, include_in_book")
        .eq("user_id", effectiveUserId)
        .eq("include_in_book", true)
        .order("date", { ascending: true }),
      supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order"),
    ]);
    setMemories((mems ?? []) as MemoryRow[]);
    setChildren((kids ?? []) as Child[]);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  const childName = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.name ?? "") : "";
  const childColor = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.color ?? "#5c7f63") : "#5c7f63";

  async function removeFromYearbook(id: string) {
    setRemoving(id);
    await supabase.from("memories").update({ include_in_book: false }).eq("id", id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setRemoving(null);
    setConfirmId(null);
  }

  // ── Group into chapters ──────────────────────────────────────────────────

  const familyMemories = memories.filter((m) => !m.child_id);
  const childChapters = children
    .map((c) => ({ child: c, mems: memories.filter((m) => m.child_id === c.id) }))
    .filter((ch) => ch.mems.length > 0);

  // School year label
  const now = new Date();
  const syYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const yearLabel = `${syYear}\u2013${syYear + 1}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">📖</span>
          <p className="text-sm text-[#7a6f65]">Loading your yearbook...</p>
        </div>
      </div>
    );
  }

  // ── Tile renderer ────────────────────────────────────────────────────────

  function MemoryTile({ m }: { m: MemoryRow }) {
    return (
      <div className="group relative aspect-square bg-[#f0ede8] overflow-hidden rounded-lg">
        {m.photo_url ? (
          <img src={m.photo_url} alt={m.title ?? "Memory"} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center px-2 ${
            m.type === "book" ? "bg-[#FDF3E3]"
              : m.type === "quote" ? "bg-[#F5EFF8]"
              : "bg-[#EAF6EE]"
          }`}>
            {m.type === "book" ? (
              <>
                <span className="text-4xl mb-1">📖</span>
                <p className="text-[11px] font-semibold text-[#7a4f1a] text-center line-clamp-2">{m.title ?? "Book"}</p>
                {m.caption && <p className="text-[10px] italic text-[#c8a96e] text-center line-clamp-1 mt-0.5">{m.caption}</p>}
              </>
            ) : m.type === "quote" ? (
              <>
                <span className="text-5xl leading-none font-serif text-[#c49edd]">&ldquo;</span>
                <p className="text-[10px] italic text-[#4a2d6a] text-center line-clamp-3">{m.title ?? "Quote"}</p>
                {m.child_id && <p className="text-[9px] text-[#a07ab8] mt-1">{childName(m.child_id)}</p>}
              </>
            ) : (
              <>
                <span className="text-4xl mb-1">{TYPE_EMOJI[m.type] ?? "📷"}</span>
                <p className="text-[11px] font-semibold text-[#1a4d2e] text-center line-clamp-2">{m.title ?? TYPE_LABEL[m.type] ?? "Memory"}</p>
                <p className="text-[9px] italic text-[#4a8c65] mt-0.5">{TYPE_LABEL[m.type] ?? "Memory"}</p>
              </>
            )}
          </div>
        )}

        {/* Child color dot */}
        <div
          className="absolute top-1.5 left-1.5 w-3.5 h-3.5 rounded-full border-[1.5px] border-white shadow-sm flex items-center justify-center"
          style={{ backgroundColor: m.child_id ? childColor(m.child_id) : "transparent" }}
        >
          {!m.child_id && <span className="text-[6px] leading-none">👨‍👩‍👧‍👦</span>}
        </div>

        {/* Bookmark remove button */}
        {!isPartner && (
          <>
            {confirmId === m.id ? (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-10">
                <p className="text-white text-xs font-medium text-center px-2">Remove from yearbook?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmId(null)}
                    className="px-3 py-1 rounded-lg bg-white/20 text-white text-xs font-medium hover:bg-white/30 transition-colors"
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => removeFromYearbook(m.id)}
                    disabled={removing === m.id}
                    className="px-3 py-1 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {removing === m.id ? "..." : "Remove"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(m.id)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove from yearbook"
              >
                <span className="text-[12px]">🔖</span>
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Chapter renderer ─────────────────────────────────────────────────────

  function Chapter({ title, color, mems }: { title: string; color?: string; mems: MemoryRow[] }) {
    return (
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          {color && (
            <div className="w-6 h-6 rounded-full shrink-0" style={{ backgroundColor: color }} />
          )}
          <h2 className="text-base font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </h2>
          <span className="text-xs text-[#b5aca4]">{mems.length}</span>
        </div>
        <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden">
          {mems.map((m) => <MemoryTile key={m.id} m={m} />)}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHero
        overline={`${yearLabel} School Year`}
        title={`Your ${yearLabel} Yearbook 📖`}
        subtitle={`${memories.length} memor${memories.length === 1 ? "y" : "ies"} curated`}
      />

      <div className="max-w-3xl mx-auto px-4 pt-5 pb-7 space-y-8">

        {/* Back link */}
        <Link href="/dashboard/memories" className="inline-flex items-center gap-1.5 text-sm text-[#5c7f63] hover:text-[#3d5c42] transition-colors">
          ← Back to Memories
        </Link>

        {/* ── Empty state ──────────────────────────────────────── */}
        {memories.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center">
            <span className="text-[52px] block mb-3">📖</span>
            <p className="text-lg font-bold text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
              Your yearbook is empty
            </p>
            <p className="text-sm text-[#7a6f65] mb-5 max-w-xs">
              Tap 🔖 on any memory to add it to your yearbook.
            </p>
            <Link
              href="/dashboard/memories"
              className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Browse Memories →
            </Link>
          </div>
        ) : (
          <>
            {/* ── Family chapter ────────────────────────────────── */}
            {familyMemories.length > 0 && (
              <Chapter title="Our Family" mems={familyMemories} />
            )}

            {/* ── Per-child chapters ───────────────────────────── */}
            {childChapters.map(({ child, mems }) => (
              <Chapter
                key={child.id}
                title={`${child.name}\u2019s Year`}
                color={child.color ?? "#5c7f63"}
                mems={mems}
              />
            ))}

            {/* ── Print CTA ────────────────────────────────────── */}
            <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6 text-center">
              <p className="text-lg font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                Ready to print? 📚
              </p>
              <p className="text-sm text-[#3d5c42] mb-4 max-w-sm mx-auto">
                Your memories are beautifully arranged and ready to become a keepsake.
              </p>
              <button
                disabled
                className="inline-flex items-center gap-1.5 bg-[#5c7f63] text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-sm opacity-50 cursor-not-allowed"
              >
                🖨️ Print Yearbook · Coming Soon
              </button>
              <p className="text-xs text-[#7a6f65] mt-2">Print orders coming soon — we're working on something beautiful.</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
