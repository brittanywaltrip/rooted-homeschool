"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { capitalizeChildNames } from "@/lib/utils";
import YearbookBookmark from "@/app/components/YearbookBookmark";

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

type YearbookContentRow = {
  content_type: string;
  child_id: string | null;
  question_key: string | null;
  content: string;
};

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
  const [yearbookKey, setYearbookKey] = useState("");
  const [filledCount, setFilledCount] = useState(0);
  const [familyName, setFamilyName] = useState("");
  const [isPro, setIsPro] = useState(true);

  useEffect(() => { document.title = "Yearbook · Rooted"; }, []);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    // 1. Fetch profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("yearbook_opened_at, yearbook_closed_at, display_name, is_pro")
      .eq("id", effectiveUserId)
      .single();

    // 2. Set yearbook_opened_at if null — use school year start, not today
    let openedAt = profile?.yearbook_opened_at;
    if (!openedAt) {
      const now = new Date();
      const schoolYearStartMonth = 7; // August = index 7
      const startYear = now.getMonth() >= schoolYearStartMonth ? now.getFullYear() : now.getFullYear() - 1;
      const schoolYearStart = new Date(startYear, schoolYearStartMonth, 1).toISOString();
      await supabase.from("profiles").update({ yearbook_opened_at: schoolYearStart }).eq("id", effectiveUserId);
      openedAt = schoolYearStart;
    }

    setFamilyName(profile?.display_name ?? "Our Family");
    setIsPro(profile?.is_pro ?? false);

    // 3. Compute yearbook_key (use UTC to avoid timezone shift)
    const m = new Date(openedAt).getUTCMonth();
    const y = new Date(openedAt).getUTCFullYear();
    const startYear = m >= 7 ? y : y - 1;
    const key = `${startYear}-${String(startYear + 1).slice(2)}`;
    setYearbookKey(key);

    // 4-6. Fetch memories, children, yearbook_content in parallel
    const closedAt = profile?.yearbook_closed_at;
    let memsQuery = supabase
      .from("memories")
      .select("id, child_id, date, type, title, caption, photo_url, include_in_book")
      .eq("user_id", effectiveUserId)
      .eq("include_in_book", true)
      .gte("date", openedAt.slice(0, 10))
      .order("date", { ascending: true });

    if (closedAt) {
      memsQuery = memsQuery.lte("date", closedAt.slice(0, 10));
    }

    const [{ data: mems }, { data: kids }, { data: ybContent }] = await Promise.all([
      memsQuery,
      supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order"),
      supabase
        .from("yearbook_content")
        .select("content_type, child_id, question_key, content")
        .eq("user_id", effectiveUserId)
        .eq("yearbook_key", key),
    ]);

    setMemories((mems ?? []) as MemoryRow[]);
    const childList = (kids ?? []) as Child[];
    setChildren(capitalizeChildNames(childList));

    // Compute filled count
    const rows = (ybContent ?? []) as YearbookContentRow[];
    const filled = rows.filter((r) => r.content.trim().length > 0).length;
    setFilledCount(filled);

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

  // ── Stats ───────────────────────────────────────────────────────────────────

  const photoCount = memories.filter((m) => m.type === "photo" || m.type === "drawing").length;
  const bookCount = memories.filter((m) => m.type === "book").length;
  const winCount = memories.filter((m) => m.type === "win").length;
  const quoteCount = memories.filter((m) => m.type === "quote").length;

  // totalCount for progress: 1 (letter) + 1 (fav moment) + 1 (fav quote) + children * 7
  const totalCount = 3 + children.length * 7;
  const progressPct = totalCount > 0 ? Math.min(100, Math.round((filledCount / totalCount) * 100)) : 0;

  // Display label derived from yearbookKey: "2025-26" → "2025–2026"
  const yearLabel = yearbookKey
    ? `${yearbookKey.split("-")[0]}\u201320${yearbookKey.split("-")[1]}`
    : "";

  // ── Group into chapters ─────────────────────────────────────────────────────

  const familyMemories = memories.filter((m) => !m.child_id);
  const childChapters = children.map((c) => ({
    child: c,
    mems: memories.filter((m) => m.child_id === c.id),
  }));

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

  // ── Tile renderer ───────────────────────────────────────────────────────────

  function MemoryTile({ m }: { m: MemoryRow }) {
    return (
      <div className="group relative aspect-square bg-[#f0ede8] overflow-hidden rounded-lg">
        {m.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
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

  // ── Chapter renderer ────────────────────────────────────────────────────────

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
      {/* ── Warm Hero ──────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-[#e4ddd0]"
        style={{ background: "linear-gradient(160deg, #faf6ef 0%, #f3ece0 50%, #ece4d4 100%)" }}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-100"
          style={{ background: "radial-gradient(circle, rgba(196,150,42,0.08) 0%, transparent 70%)" }} />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full opacity-100"
          style={{ background: "radial-gradient(circle, rgba(45,90,61,0.06) 0%, transparent 70%)" }} />
        <div className="relative z-10 text-center px-7 pt-9 pb-8">
          <p className="text-[12px] text-[#a89a88] font-medium mb-3">
            <Link href="/dashboard/memories" className="text-[#8B7E74] hover:underline">Memories</Link>
            {" \u203A "}Yearbook
          </p>
          <span className="text-[48px] block mb-2.5" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.08))" }}>📖</span>
          <h1 className="text-[28px] font-bold text-[#2D2A26] tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            Your Family Yearbook
          </h1>
          <p className="text-[14px] font-semibold text-[#C4962A] tracking-wide uppercase mt-1.5">
            {yearLabel}
          </p>
          <p className="text-[16px] text-[#7a6f65] italic mt-3" style={{ fontFamily: "var(--font-display)" }}>
            Your year, beautifully remembered.
          </p>
        </div>
      </div>

      <div className="max-w-[680px] mx-auto px-5 pb-20">

        {/* ── Value Card + CTA ─────────────────────────────── */}
        <div className="mt-7">
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-7 text-center shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <p className="text-[14px] text-[#7a6f65] leading-relaxed max-w-[480px] mx-auto mb-5">
              As you capture memories throughout the year, Rooted automatically turns them into a beautiful digital yearbook. Add personal touches like letters and quotes, or just let your photos and wins tell the story.
            </p>
            <Link
              href="/dashboard/memories/yearbook/read"
              className={`inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[16px] font-bold transition-all ${
                memories.length === 0
                  ? "opacity-50 pointer-events-none bg-[#e8e5e0] text-[#7a6f65]"
                  : "text-white shadow-[0_3px_12px_rgba(196,150,42,0.25)] hover:-translate-y-0.5 hover:shadow-[0_5px_20px_rgba(196,150,42,0.35)]"
              }`}
              style={memories.length > 0 ? { background: "linear-gradient(135deg, #C4962A, #b8882a)" } : {}}
            >
              Open Your Yearbook &rarr;
            </Link>
            <Link
              href="/dashboard/memories/yearbook/edit"
              className="inline-flex items-center gap-1.5 ml-3 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-[#8B7E74] border-[1.5px] border-[#ddd6cc] hover:border-[#b0a89e] hover:text-[#5c5248] transition-all"
            >
              ✏️ Edit Memories
            </Link>
          </div>

          {/* ── Stats Bar ──────────────────────────────────── */}
          <div className="flex mt-7 bg-[#faf8f4] border border-[#ece7de] rounded-xl p-3.5">
            {[
              { label: "Memories", count: memories.length },
              { label: "Photos", count: photoCount },
              { label: "Books", count: bookCount },
              { label: "Wins", count: winCount },
              { label: "Quotes", count: quoteCount },
            ].map((stat, i) => (
              <div key={stat.label} className="flex-1 text-center relative py-1">
                {i > 0 && <div className="absolute left-0 top-1 bottom-1 w-px bg-[#e4ddd2]" />}
                <p className="text-[22px] font-extrabold text-[#2D5A3D] leading-none mb-0.5">{stat.count}</p>
                <p className="text-[11px] font-medium text-[#a89a88] uppercase tracking-wide">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Features List ────────────────────────────────── */}
        <div className="mt-7">
          <h2 className="text-[16px] font-bold text-[#2D2A26] mb-3.5">What your yearbook includes</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { icon: "📅", name: "Month-by-month timeline", desc: "Memories auto-organized into monthly chapters" },
              { icon: "👨‍👩‍👧‍👦", name: "Family cover page", desc: "A dedicated page for your family\u2019s story" },
              { icon: "📸", name: "Photos & drawings", desc: "Every image beautifully laid out" },
              { icon: "🏆", name: "Wins & milestones", desc: "The breakthroughs you don\u2019t want to forget" },
              { icon: "📚", name: "Books read", desc: "A full reading log for the year" },
              { icon: "🗺️", name: "Field trips & adventures", desc: "The places you explored together" },
              { icon: "🗣️", name: "Quotes & funny moments", desc: "The things they said that made you laugh" },
              { icon: "💌", name: "Letter to your kids", desc: "A personal note to close out the year" },
            ].map((f) => (
              <div key={f.name} className="flex items-start gap-2.5 p-3.5 bg-white border border-[#ece7de] rounded-xl">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-[#f4f2ee] flex items-center justify-center text-[16px] shrink-0">
                  {f.icon}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#2D2A26] leading-tight">{f.name}</p>
                  <p className="text-[11px] text-[#a89a88] mt-0.5 leading-snug">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing / Member Banner ──────────────────────── */}
        {isPro ? (
          <div className="mt-8 flex items-center gap-3.5 rounded-2xl border-[1.5px] border-[#c0dcc6]"
            style={{ background: "linear-gradient(135deg, #f0f7f2, #e6f2e9)", padding: "18px 24px" }}>
            <div className="w-11 h-11 bg-white rounded-xl flex items-center justify-center text-[22px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] shrink-0">
              🌿
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-bold text-[#2D5A3D]">Founding Family Member</p>
              <p className="text-[12px] text-[#5c7f63] leading-snug">Unlimited memories in your yearbook — locked in at $39/year</p>
            </div>
            <span className="px-3 py-1.5 bg-[#2D5A3D] text-white text-[11px] font-bold rounded-lg tracking-wide shrink-0">
              Rooted+
            </span>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border-[1.5px] border-[#e4ddd0] p-6 text-center relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, #fdfbf7, #f7f0e4)" }}>
            <p className="text-[11px] font-bold uppercase tracking-[1.2px] text-[#C4962A] mb-2.5">
              Preview Mode
            </p>
            <p className="text-[15px] font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
              Your yearbook is something special 🌿
            </p>
            <p className="text-sm text-[#7a6f65] leading-relaxed mb-5">
              Upgrade to remove the watermark and download your yearbook forever.
            </p>
            <a
              href="/upgrade"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[10px] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(196,150,42,0.2)] hover:-translate-y-0.5 transition-all"
              style={{ background: "#C4962A" }}
            >
              Download My Yearbook →
            </a>
          </div>
        )}

        {/* ── Bottom CTA ───────────────────────────────────── */}
        <div className="text-center pt-9">
          <p className="text-[14px] text-[#8B7E74] italic mb-4">
            You&apos;re building something beautiful. Keep capturing — your yearbook grows with every memory.
          </p>
          <Link
            href="/dashboard/memories/yearbook/read"
            className={`inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[16px] font-bold transition-all ${
              memories.length === 0
                ? "opacity-50 pointer-events-none bg-[#e8e5e0] text-[#7a6f65]"
                : "text-white shadow-[0_3px_12px_rgba(196,150,42,0.25)] hover:-translate-y-0.5 hover:shadow-[0_5px_20px_rgba(196,150,42,0.35)]"
            }`}
            style={memories.length > 0 ? { background: "linear-gradient(135deg, #C4962A, #b8882a)" } : {}}
          >
            Open Your Yearbook &rarr;
          </Link>
        </div>

        {/* ── Archived yearbooks note ─────────────────────── */}
        <p className="text-[11px] text-center text-[#b5aca4] pt-6 pb-2">
          📖 Your archived yearbooks are yours forever — always readable, even if your plan changes.
        </p>
      </div>
    </>
  );
}
