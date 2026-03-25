"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import LogTodayModal from "@/app/components/LogTodayModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type Memory = {
  id: string;
  type: string;
  payload: {
    title?: string;
    description?: string;
    photo_url?: string;
    child_id?: string;
    date?: string;
    author?: string;
  };
  created_at: string;
};

type Child = { id: string; name: string; color: string | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMemoryDate(m: Memory): string {
  return m.payload?.date ?? m.created_at.slice(0, 10);
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getTypeShort(type: string): string {
  return type.replace("memory_", "");
}

const TYPE_STYLES: Record<string, { bg: string; emoji: string }> = {
  photo:      { bg: "#f0ede8", emoji: "\uD83D\uDCF7" },
  book:       { bg: "#fef5e4", emoji: "\uD83D\uDCD6" },
  field_trip: { bg: "#e4f2fb", emoji: "\uD83D\uDDFA\uFE0F" },
  project:    { bg: "#e8f0e9", emoji: "\uD83D\uDD2C" },
  activity:   { bg: "#fce8f4", emoji: "\uD83C\uDFB5" },
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MemoriesPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const [memories,    setMemories]    = useState<Memory[]>([]);
  const [children,    setChildren]    = useState<Child[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [isPro,       setIsPro]       = useState(false);
  const [familyName,  setFamilyName]  = useState("");
  const [showLogModal, setShowLogModal] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Filters
  const [filterChild, setFilterChild] = useState<string | null>(null);
  const [filterType,  setFilterType]  = useState<string | null>(null);

  // Quick photo capture
  const [showQuickPhoto, setShowQuickPhoto] = useState(false);
  const quickPhotoRef = useRef<HTMLInputElement>(null);

  // ── Load data ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: profile }, { data: kids }, { data: events }] = await Promise.all([
      supabase.from("profiles").select("is_pro, display_name, first_name, last_name").eq("id", effectiveUserId).maybeSingle(),
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("app_events").select("id, type, payload, created_at")
        .eq("user_id", effectiveUserId)
        .in("type", ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"])
        .order("created_at", { ascending: false }),
    ]);

    const p = profile as { is_pro?: boolean; display_name?: string; first_name?: string; last_name?: string } | null;
    setIsPro(p?.is_pro ?? false);
    setFamilyName(p?.display_name ?? (p?.first_name ? `${p.first_name}${p.last_name ? ` ${p.last_name}` : ""}` : ""));
    setChildren(kids ?? []);
    setMemories((events as unknown as Memory[]) ?? []);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const stats = {
    total: memories.length,
    photos: memories.filter((m) => m.type === "memory_photo").length,
    books: memories.filter((m) => m.type === "memory_book").length,
    trips: memories.filter((m) => m.type === "memory_field_trip").length,
  };

  const filtered = memories.filter((m) => {
    if (filterChild && m.payload?.child_id !== filterChild) return false;
    if (filterType && getTypeShort(m.type) !== filterType) return false;
    return true;
  });

  // Group by month
  const byMonth = new Map<string, Memory[]>();
  for (const m of filtered) {
    const key = getMonthKey(getMemoryDate(m));
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(m);
  }
  const sortedMonths = [...byMonth.keys()].sort().reverse();

  const displayName = familyName
    ? (familyName.toLowerCase().endsWith("family") ? familyName : `The ${familyName} Family`)
    : "Your Family";

  // ── Quick photo save ──────────────────────────────────────────────────────

  async function handleQuickPhoto(file: File) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error } = await supabase.storage.from("memory-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (error) { console.error("Quick photo upload error:", error); return; }
    const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
    await supabase.from("app_events").insert({
      user_id: user.id,
      type: "memory_photo",
      payload: { title: "Photo", photo_url: urlData.publicUrl, date: new Date().toISOString().split("T")[0] },
    });
    load();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-3xl animate-pulse">{"\uD83D\uDCF8"}</span>
      </div>
    );
  }

  return (
    <>
    <div className="pb-24">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden" style={{ background: "#2d5a3d" }}>
        <div className="absolute top-2 right-3 text-[100px] leading-none select-none pointer-events-none" style={{ opacity: 0.06 }} aria-hidden>{"\uD83C\uDF3F"}</div>
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: "#8cba8e" }}>
          {displayName}
        </p>
        <h1 className="text-[24px] font-bold leading-tight" style={{ color: "#fefcf9", fontFamily: "var(--font-display)" }}>
          Your Story {"\uD83D\uDCD6"}
        </h1>
        <p className="text-[13px] mt-1 italic" style={{ color: "rgba(255,255,255,0.6)" }}>
          Every moment, beautifully kept.
        </p>

        {/* Stats row */}
        <div className="flex gap-3 mt-4">
          {[
            { n: stats.total, label: "Memories" },
            { n: stats.photos, label: "Photos" },
            { n: stats.books, label: "Books" },
            { n: stats.trips, label: "Field Trips" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">{s.n}</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 overflow-x-auto">
        <div className="flex gap-1.5 w-max">
          {/* All */}
          <button
            onClick={() => { setFilterChild(null); setFilterType(null); }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              !filterChild && !filterType
                ? "bg-[#3d5c42] text-white"
                : "bg-white text-[#7a6f65] border border-[#e8e2d9] hover:bg-[#f0ede8]"
            }`}
          >
            All
          </button>
          {/* Family */}
          <button
            onClick={() => { setFilterChild("__family__"); setFilterType(null); }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filterChild === "__family__"
                ? "bg-[#3d5c42] text-white"
                : "bg-white text-[#7a6f65] border border-[#e8e2d9] hover:bg-[#f0ede8]"
            }`}
          >
            {"\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"} Family
          </button>
          {/* Children */}
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => { setFilterChild(filterChild === c.id ? null : c.id); setFilterType(null); }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filterChild === c.id ? "text-white" : "bg-white border border-[#e8e2d9] hover:bg-[#f0ede8]"
              }`}
              style={filterChild === c.id ? { backgroundColor: c.color ?? "#5c7f63" } : { color: c.color ?? "#5c7f63" }}
            >
              {c.name}
            </button>
          ))}
          {/* Type filters */}
          {[
            { id: "photo", emoji: "\uD83D\uDCF7", label: "Photos" },
            { id: "book", emoji: "\uD83D\uDCD6", label: "Books" },
            { id: "field_trip", emoji: "\uD83D\uDDFA\uFE0F", label: "Trips" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => { setFilterType(filterType === t.id ? null : t.id); setFilterChild(null); }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filterType === t.id
                  ? "bg-[#3d5c42] text-white"
                  : "bg-white text-[#7a6f65] border border-[#e8e2d9] hover:bg-[#f0ede8]"
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── AI Family Update CTA ─────────────────────────── */}
      {memories.length >= 3 && (
        <div className="px-4 pt-2">
          <Link
            href="/dashboard/family-update"
            className="block bg-gradient-to-br from-[#e8f0e9] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-4 py-3.5 hover:from-[#ddeade] hover:to-[#c5e0c8] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#5c7f63] flex items-center justify-center shrink-0 text-white text-base">{"\u2728"}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2d2926]">Your family&apos;s story, beautifully written</p>
                <p className="text-[11px] text-[#5c7f63]">AI-generated update from your memories {"\u2192"}</p>
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* ── Photo grid by month ───────────────────────────── */}
      <div className="px-4 space-y-4">
        {sortedMonths.length === 0 && (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">{"\uD83D\uDCF8"}</div>
            <p className="text-sm text-[#7a6f65]">No memories yet. Tap the camera button to capture your first moment.</p>
          </div>
        )}

        {sortedMonths.map((monthKey) => {
          const monthMemories = byMonth.get(monthKey)!;
          return (
            <div key={monthKey}>
              {/* Month divider */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890] mb-2 mt-2">
                {formatMonthLabel(monthKey)}
              </p>

              {/* 2-column grid */}
              <div className="grid grid-cols-2 gap-1.5">
                {monthMemories.map((m) => {
                  const isPhoto = m.type === "memory_photo" && m.payload?.photo_url;
                  const typeShort = getTypeShort(m.type);
                  const style = TYPE_STYLES[typeShort] ?? TYPE_STYLES.activity;
                  const childId = m.payload?.child_id;
                  const child = childId ? children.find((c) => c.id === childId) : null;
                  const date = getMemoryDate(m);
                  const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

                  return (
                    <button
                      key={m.id}
                      className="relative aspect-square rounded-xl overflow-hidden group"
                      onClick={() => isPhoto ? setLightboxUrl(m.payload.photo_url!) : undefined}
                    >
                      {isPhoto ? (
                        <img src={m.payload.photo_url!} alt={m.payload.title ?? ""} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: style.bg }}>
                          <span className="text-4xl">{style.emoji}</span>
                        </div>
                      )}

                      {/* Child dot */}
                      <div className="absolute top-2 left-2">
                        {child ? (
                          <div className="w-[10px] h-[10px] rounded-full border border-white shadow-sm" style={{ backgroundColor: child.color ?? "#5c7f63" }} />
                        ) : (
                          <span className="text-[8px]">{"\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"}</span>
                        )}
                      </div>

                      {/* Bottom overlay */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6">
                        <p className="text-[11px] font-semibold text-white leading-tight truncate">
                          {m.payload?.title || typeShort}
                        </p>
                        <p className="text-[9px] text-white/60">{dateLabel}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ── Yearbook card ───────────────────────────────── */}
        {memories.length > 0 && (
          <Link
            href="/dashboard/yearbook"
            className="block rounded-2xl p-5 mt-4" style={{ background: "linear-gradient(135deg, #2d5a3d 0%, #3d7a50 100%)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{"\uD83D\uDCD2"}</span>
              <div>
                <p className="text-sm font-bold text-white">Create your yearbook</p>
                <p className="text-xs text-white/60">Turn this year into a keepsake {"\u2192"}</p>
              </div>
            </div>
          </Link>
        )}
      </div>
    </div>

    {/* ── Floating camera button ──────────────────────────── */}
    {!isPartner && (
      <button
        onClick={() => setShowLogModal(true)}
        className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-[#3d5c42] hover:bg-[#2d4a32] text-white shadow-lg flex items-center justify-center transition-colors"
        aria-label="Log a memory"
      >
        <span className="text-xl">{"\uD83D\uDCF8"}</span>
      </button>
    )}

    {/* ── Lightbox ────────────────────────────────────────── */}
    {lightboxUrl && (
      <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
        <button className="absolute top-4 right-4 text-white/70 hover:text-white" onClick={() => setLightboxUrl(null)}>
          <X size={24} />
        </button>
        <img src={lightboxUrl} alt="" className="max-w-full max-h-[85vh] rounded-xl object-contain" />
      </div>
    )}

    {/* ── Log modal ───────────────────────────────────────── */}
    {showLogModal && (
      <LogTodayModal
        children={children}
        subjects={[]}
        today={new Date().toISOString().split("T")[0]}
        onClose={() => setShowLogModal(false)}
        onSaved={() => { setShowLogModal(false); load(); }}
      />
    )}

    {/* Hidden quick photo input */}
    <input
      ref={quickPhotoRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) handleQuickPhoto(file);
      }}
    />
    </>
  );
}
