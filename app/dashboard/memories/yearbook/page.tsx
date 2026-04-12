"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
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
    setChildren(childList);

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
      <PageHero
        overline={`${yearLabel} School Year`}
        title={`Your ${yearLabel} Yearbook 📖`}
        subtitle={memories.length === 0
          ? "Your pages are waiting"
          : `${memories.length} memor${memories.length === 1 ? "y" : "ies"} curated`}
      >
        <Link
          href="/dashboard/memories/yearbook/read"
          className={`mt-4 block w-full text-center text-[15px] font-semibold px-5 py-3.5 rounded-xl ${
            memories.length === 0
              ? "opacity-50 pointer-events-none bg-white/80 text-[var(--g-deep)]"
              : "bg-white text-[var(--g-deep)] active:scale-[0.98] transition-transform"
          }`}
        >
          📖 Read Your Yearbook
        </Link>
      </PageHero>

      <div className="max-w-3xl mx-auto px-4 pt-5 pb-20">

        {/* ── Free user banner ────────────────────────────────── */}
        {!isPro && !isPartner && (
          <div className="bg-[#faf6ec] border border-[#c0dd97] rounded-2xl p-4 mb-4 flex items-start gap-3">
            <span className="text-[24px]">📖</span>
            <div>
              <p className="text-[13px] font-semibold text-[#2d2926]">Your yearbook shows the last 30 days</p>
              <p className="text-[12px] text-[#7a6f65] mt-1 leading-relaxed">
                You&apos;re on the free plan. Upgrade to capture your whole school year — every win, photo, and memory, from August through June.
              </p>
              <Link
                href="/dashboard/settings?tab=billing"
                className="mt-2 inline-block text-[12px] font-semibold text-[var(--g-deep)] underline underline-offset-2"
              >
                Unlock your full yearbook →
              </Link>
            </div>
          </div>
        )}

        {/* ── Edit link ────────────────────────────────────────── */}
        <div className="flex justify-end mb-4">
          <Link
            href="/dashboard/memories/yearbook/edit"
            className="relative text-[13px] font-medium text-[var(--g-deep)] underline underline-offset-2"
          >
            ✏️ Edit memories
            {progressPct < 100 && (
              <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-[rgba(254, 252, 249, 0.55)] align-middle" />
            )}
          </Link>
        </div>

        {/* ── Cover card ──────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden border border-[#c0dd97]" style={{ background: "#faf6f0" }}>
          {/* Top strip */}
          <div className="relative overflow-hidden px-4 py-3" style={{ background: "var(--g-deep)" }}>
            <span className="absolute top-1 right-2 text-[72px] leading-none opacity-[0.06] select-none pointer-events-none">🌿</span>
            <span className="absolute -bottom-2 left-1 text-[56px] leading-none opacity-[0.05] select-none pointer-events-none">🌱</span>
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <p className="text-[18px] font-bold text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
                  {familyName}
                </p>
                <p className="text-[10px] text-[rgba(254, 252, 249, 0.55)] uppercase tracking-wider mt-0.5">
                  {yearLabel} school year
                </p>
              </div>
              <span className="bg-white/[0.12] text-[9px] text-[#c8e6c4] px-3 py-1 rounded-full mt-1">
                {memories.length} memories
              </span>
            </div>
          </div>

          {/* Bottom strip — stats */}
          <div className="px-4 py-3 flex items-center justify-between">
            {[
              { label: "Photos", count: photoCount },
              { label: "Books", count: bookCount },
              { label: "Wins", count: winCount },
              { label: "Quotes", count: quoteCount },
            ].map((stat, i) => (
              <div key={stat.label} className="flex-1 text-center relative">
                {i > 0 && <div className="absolute left-0 top-1 bottom-1 w-px bg-[#e8e2d9]" />}
                <p className="text-[18px] font-bold text-[var(--g-deep)]">{stat.count}</p>
                <p className="text-[10px] text-[#9a8f85]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Progress bar ────────────────────────────────────── */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-[#9a8f85]">Pages filling up</span>
            <span className="text-[11px] text-[#9a8f85]">{filledCount} of {totalCount} sections complete</span>
          </div>
          <div className="h-[5px] bg-[#e8e3dc] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--g-deep)] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* ── Empty state ─────────────────────────────────────── */}
        {memories.length === 0 && (
          <div className="mt-6">
            <div className="bg-[#fefcf9] border border-[#e8e0d9] rounded-2xl p-6 text-center">
              <span className="text-4xl block mb-3">🔖</span>
              <h3 className="text-base font-bold text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                Your yearbook starts here
              </h3>
              <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto mb-5">
                Tap the bookmark on any memory to add it. Wins, books, and quotes are added automatically — photos need a tap.
              </p>
              <Link
                href="/dashboard/memories"
                className="inline-block text-sm font-medium text-[var(--g-deep)] border border-[var(--g-deep)] rounded-xl px-5 py-2.5 hover:bg-[#f0ede8] transition-colors"
              >
                ← Back to Memories
              </Link>
            </div>
          </div>
        )}

        {/* ── Chapter grid ────────────────────────────────────── */}
        {memories.length > 0 && (
          <div className="space-y-8 mt-6">
            {/* Family chapter */}
            {familyMemories.length > 0 && (
              <Chapter title="Our Family" mems={familyMemories} />
            )}

            {/* Per-child chapters */}
            {childChapters.map(({ child, mems }) => (
              mems.length > 0 ? (
                <Chapter
                  key={child.id}
                  title={`${child.name}\u2019s Year`}
                  color={child.color ?? "#5c7f63"}
                  mems={mems}
                />
              ) : (
                <div key={child.id} className="bg-[#faf8f3] rounded-xl p-4 border border-dashed border-[#d4cfc8]">
                  <p className="text-[12px] text-[#9a8f85] italic">
                    {child.name}&apos;s chapter is empty — log a win, quote, or book for{" "}
                    {child.name} and it&apos;ll appear here automatically.
                  </p>
                </div>
              )
            ))}

            {/* ── Print CTA ───────────────────────────────────── */}
            <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6 text-center">
              <p className="text-lg font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                Ready to print? 📚
              </p>
              <p className="text-sm text-[var(--g-deep)] mb-4 max-w-sm mx-auto">
                Your memories are beautifully arranged and ready to become a keepsake.
              </p>
              <button
                disabled
                className="inline-flex items-center gap-1.5 bg-[#5c7f63] text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-sm opacity-50 cursor-not-allowed"
              >
                🖨️ Print Yearbook · Coming Soon
              </button>
              <p className="text-xs text-[#7a6f65] mt-2">Print orders coming soon — we&apos;re working on something beautiful.</p>
            </div>
          </div>
        )}

        {/* ── Archived yearbooks note ─────────────────────────── */}
        <p className="text-[11px] text-center text-[#b5aca4] py-2">
          📖 Your archived yearbooks are yours forever — always readable, even if your plan changes.
        </p>
      </div>
    </>
  );
}
