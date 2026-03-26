"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, Download, X, ArrowRight, MoreHorizontal, Trash2, Pencil, Heart, Search, Mic, BookmarkCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import PageHero from "@/app/components/PageHero";
import UpgradePrompt from "@/components/UpgradePrompt";
import MilestonePrompt from "@/components/MilestonePrompt";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  user_id: string;
  child_id: string | null;
  date: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  include_in_book: boolean;
  favorite: boolean;
  page_order: number | null;
  created_at: string;
  updated_at: string;
};

type LegacyEvent = {
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

type Reflection = {
  id: string;
  date: string;
  reflection: string;
  is_private: boolean;
  updated_at: string;
};

type Child = { id: string; name: string; color: string | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function legacyToMemory(e: LegacyEvent): MemoryRow {
  const typeMap: Record<string, string> = {
    memory_photo: "photo",
    memory_book: "book",
    book_read: "book",
    memory_project: "project",
    memory_field_trip: "field_trip",
    memory_activity: "activity",
  };
  return {
    id: e.id,
    user_id: "",
    child_id: e.payload.child_id ?? null,
    date: e.payload.date ?? e.created_at.split("T")[0],
    type: typeMap[e.type] ?? "photo",
    title: e.payload.title ?? null,
    caption: e.payload.description ?? (e.payload.author ? `by ${e.payload.author}` : null),
    photo_url: e.payload.photo_url ?? null,
    include_in_book: false,
    favorite: false,
    page_order: null,
    created_at: e.created_at,
    updated_at: e.created_at,
  };
}

const TYPE_EMOJI: Record<string, string> = {
  photo: "📷",
  drawing: "🎨",
  book: "📖",
  win: "🏆",
  quote: "🗒️",
  project: "🔬",
  field_trip: "🗺️",
  activity: "🎵",
};

const TYPE_LABEL: Record<string, string> = {
  photo: "Photo",
  drawing: "Drawing",
  book: "Book",
  win: "Win",
  quote: "Moment",
  project: "Project",
  field_trip: "Field Trip",
  activity: "Activity",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MemoriesPage() {
  const searchParams = useSearchParams();
  const { isPartner, effectiveUserId } = usePartner();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  // Filter: "all" | "family" | "favorites" | child id
  const [filter, setFilter] = useState("all");

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Detail / lightbox
  const [selectedMemory, setSelectedMemory] = useState<MemoryRow | null>(null);
  const [hearted, setHearted] = useState<Set<string>>(new Set());

  // Lightbox inline delete confirm
  const [lightboxDeleteConfirm, setLightboxDeleteConfirm] = useState(false);

  // Menu
  const [menuId, setMenuId] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState<MemoryRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editChild, setEditChild] = useState("");
  const [editInBook, setEditInBook] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Milestone prompt
  const [milestonePrompt, setMilestonePrompt] = useState<{ milestone: string; message: string; badgeEmoji: string } | null>(null);

  // Reflection view
  const [viewingReflection, setViewingReflection] = useState<Reflection | null>(null);
  const [editingReflection, setEditingReflection] = useState(false);
  const [reflectionEditText, setReflectionEditText] = useState("");
  const [reflectionDeleteConfirm, setReflectionDeleteConfirm] = useState(false);
  const [savingReflection, setSavingReflection] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!effectiveUserId) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro")
      .eq("id", effectiveUserId)
      .single();
    const userIsPro = (profile as { is_pro?: boolean } | null)?.is_pro ?? false;
    setIsPro(userIsPro);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const dateFloor = userIsPro ? "2020-01-01" : thirtyDaysAgo;

    const [{ data: kids }, { data: memRows }, { data: reflData }] = await Promise.all([
      supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order"),
      supabase
        .from("memories")
        .select("*")
        .eq("user_id", effectiveUserId)
        .gte("created_at", dateFloor)
        .order("date", { ascending: false }),
      supabase
        .from("daily_reflections")
        .select("id, date, reflection, is_private, updated_at")
        .eq("user_id", effectiveUserId)
        .order("date", { ascending: false }),
    ]);

    setChildren(kids ?? []);
    setReflections((reflData as unknown as Reflection[]) ?? []);

    // If memories table has data, use it. Otherwise fall back to app_events.
    if (memRows && memRows.length > 0) {
      setMemories(memRows as MemoryRow[]);
    } else {
      const { data: events } = await supabase
        .from("app_events")
        .select("id, type, payload, created_at")
        .eq("user_id", effectiveUserId)
        .in("type", ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"])
        .gte("created_at", dateFloor)
        .order("created_at", { ascending: false });
      setMemories((events ?? []).map((e) => legacyToMemory(e as unknown as LegacyEvent)));
    }

    setLoading(false);
  }, [effectiveUserId]);

  // ── Open lightbox from ?open= URL param ──────────────────────────────────────
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || loading || memories.length === 0) return;
    const match = memories.find((m) => m.id === openId);
    if (match) setSelectedMemory(match);
  }, [searchParams, loading, memories]);

  // ── Milestone prompt for free users ─────────────────────────────────────────
  useEffect(() => {
    if (isPro !== false || memories.length === 0) return;
    const shown: string[] = JSON.parse(localStorage.getItem("rooted_milestones_shown") || "[]");
    const milestones: { at: number; milestone: string; message: string; badgeEmoji: string }[] = [
      { at: 10, milestone: "10 memories captured", badgeEmoji: "\uD83C\uDF3F", message: "Your family\u2019s story is growing. Upgrade to keep every memory forever." },
      { at: 25, milestone: "25 memories \u2014 you\u2019re really doing this", badgeEmoji: "\uD83C\uDF1F", message: "Most families never get this far. Lock in the founding price before it\u2019s gone." },
      { at: 50, milestone: "50 memories. This is something special.", badgeEmoji: "\uD83C\uDF3B", message: "Half a hundred moments saved. Imagine looking back on these in ten years." },
    ];
    const hit = milestones.filter((m) => memories.length >= m.at && !shown.includes(String(m.at)));
    if (hit.length > 0) {
      const m = hit[hit.length - 1];
      setMilestonePrompt({ milestone: m.milestone, message: m.message, badgeEmoji: m.badgeEmoji });
      localStorage.setItem("rooted_milestones_shown", JSON.stringify([...shown, String(m.at)]));
    }
  }, [memories, isPro]);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const childName = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.name ?? "") : "";
  const childColor = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.color ?? "#5c7f63") : "#5c7f63";

  const formatDate = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const formatMonth = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function toggleHeart(id: string) {
    setHearted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Toggle favorite in DB ─────────────────────────────────────────────────

  async function toggleFavorite(m: MemoryRow, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    const newVal = !m.favorite;
    setMemories((prev) => prev.map((mem) => (mem.id === m.id ? { ...mem, favorite: newVal } : mem)));
    if (selectedMemory?.id === m.id) setSelectedMemory({ ...m, favorite: newVal });
    await supabase.from("memories").update({ favorite: newVal }).eq("id", m.id);
  }

  // ── Toggle yearbook in DB ─────────────────────────────────────────────────

  async function toggleYearbook(m: MemoryRow) {
    const newVal = !m.include_in_book;
    setMemories((prev) => prev.map((mem) => (mem.id === m.id ? { ...mem, include_in_book: newVal } : mem)));
    if (selectedMemory?.id === m.id) setSelectedMemory({ ...m, include_in_book: newVal });
    await supabase.from("memories").update({ include_in_book: newVal, updated_at: new Date().toISOString() }).eq("id", m.id);
  }

  // ── Filter + Search ──────────────────────────────────────────────────────

  const filtered = memories.filter((m) => {
    // Filter by child / family / favorites
    if (filter === "favorites" && !m.favorite) return false;
    if (filter === "family" && m.child_id) return false;
    if (filter !== "all" && filter !== "family" && filter !== "favorites" && m.child_id !== filter) return false;

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const title = (m.title ?? "").toLowerCase();
      const caption = (m.caption ?? "").toLowerCase();
      const child = childName(m.child_id).toLowerCase();
      if (!title.includes(q) && !caption.includes(q) && !child.includes(q)) return false;
    }

    return true;
  });

  // ── Voice search (Web Speech API) ─────────────────────────────────────────

  function startVoiceSearch() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    const SpeechRecognition = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Voice search is not supported in this browser."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      searchRef.current?.focus();
    };
    recognition.start();
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────

  function openEdit(m: MemoryRow) {
    setEditing(m);
    setEditTitle(m.title ?? "");
    setEditCaption(m.caption ?? "");
    setEditDate(m.date);
    setEditChild(m.child_id ?? "");
    setEditInBook(m.include_in_book);
    setMenuId(null);
    setSelectedMemory(null);
    setLightboxDeleteConfirm(false);
  }

  async function saveEdit() {
    if (!editing) return;
    setEditSaving(true);
    const updates = {
      title: editTitle.trim() || null,
      caption: editCaption.trim() || null,
      date: editDate,
      child_id: editChild || null,
      include_in_book: editInBook,
      updated_at: new Date().toISOString(),
    };
    const { data } = await supabase
      .from("memories")
      .update(updates)
      .eq("id", editing.id)
      .select()
      .single();
    if (data) {
      setMemories((prev) => prev.map((m) => (m.id === editing.id ? (data as MemoryRow) : m)));
    }
    setEditSaving(false);
    setEditing(null);
  }

  // ── Delete handlers ────────────────────────────────────────────────────────

  function openDelete(m: MemoryRow) {
    setDeleteTarget(m);
    setMenuId(null);
    setSelectedMemory(null);
    setLightboxDeleteConfirm(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    // Delete photo from storage if exists
    if (deleteTarget.photo_url) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const url = deleteTarget.photo_url;
        const buckets = ["memories", "memory-photos"];
        for (const bucket of buckets) {
          const marker = `/storage/v1/object/public/${bucket}/`;
          const idx = url.indexOf(marker);
          if (idx !== -1) {
            const path = url.slice(idx + marker.length);
            await supabase.storage.from(bucket).remove([path]);
            break;
          }
        }
      }
    }

    await supabase.from("memories").delete().eq("id", deleteTarget.id);
    setMemories((prev) => prev.filter((m) => m.id !== deleteTarget.id));
    setDeleting(false);
    setDeleteTarget(null);
  }

  // Delete from lightbox
  async function confirmLightboxDelete() {
    if (!selectedMemory) return;
    setDeleting(true);

    if (selectedMemory.photo_url) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const url = selectedMemory.photo_url;
        const buckets = ["memories", "memory-photos"];
        for (const bucket of buckets) {
          const marker = `/storage/v1/object/public/${bucket}/`;
          const idx = url.indexOf(marker);
          if (idx !== -1) {
            const path = url.slice(idx + marker.length);
            await supabase.storage.from(bucket).remove([path]);
            break;
          }
        }
      }
    }

    await supabase.from("memories").delete().eq("id", selectedMemory.id);
    setMemories((prev) => prev.filter((m) => m.id !== selectedMemory.id));
    setDeleting(false);
    setSelectedMemory(null);
    setLightboxDeleteConfirm(false);
  }

  // ── Reflection handlers ────────────────────────────────────────────────────

  function openReflection(r: Reflection) {
    setViewingReflection(r);
    setEditingReflection(false);
    setReflectionDeleteConfirm(false);
  }

  function closeReflection() {
    setViewingReflection(null);
    setEditingReflection(false);
    setReflectionDeleteConfirm(false);
  }

  async function saveReflectionEdit() {
    if (!viewingReflection || !reflectionEditText.trim()) return;
    setSavingReflection(true);
    const { data } = await supabase
      .from("daily_reflections")
      .update({ reflection: reflectionEditText.trim(), is_private: viewingReflection.is_private })
      .eq("id", viewingReflection.id)
      .select("id, date, reflection, is_private, updated_at")
      .single();
    if (data) {
      const updated = data as Reflection;
      setReflections((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setViewingReflection(updated);
    }
    setSavingReflection(false);
    setEditingReflection(false);
  }

  async function deleteReflection() {
    if (!viewingReflection) return;
    await supabase.from("daily_reflections").delete().eq("id", viewingReflection.id);
    setReflections((prev) => prev.filter((r) => r.id !== viewingReflection.id));
    closeReflection();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
    <PageHero overline="Your Family Story" title="Memories 📸" subtitle="Capture photos, projects, and books." />
    <div className="max-w-3xl px-4 pt-5 pb-7 space-y-5">

      {/* Header link */}
      <div className="flex justify-end -mt-2 mb--1">
        <button
          type="button"
          onClick={() => alert("More memory types coming soon")}
          className="text-sm text-[#5c7f63] cursor-pointer"
        >
          + Add memory
        </button>
      </div>

      {/* AI Year in Review */}
      <Link
        href={isPro ? "/dashboard/year-in-review" : "/dashboard/pricing"}
        className="block bg-gradient-to-br from-[#e8f0e9] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5 hover:from-[#ddeade] hover:to-[#c5e0c8] transition-colors group"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#5c7f63] flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[#2d2926] text-sm mb-0.5">AI Year in Review ✨</h3>
            <p className="text-xs text-[#5c6e5d] leading-relaxed">
              See your family&apos;s stats, read an AI-written story of your homeschool year, and
              print a beautiful keepsake to share with grandparents.
            </p>
            <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold text-[#5c7f63] bg-white/70 px-2.5 py-1 rounded-full group-hover:bg-white transition-colors">
              {isPro ? (<>Open Year in Review <ArrowRight size={10} /></>) : "🔒 Pro Feature"}
            </span>
          </div>
          <Download size={16} className="text-[#5c7f63] shrink-0 mt-0.5" />
        </div>
      </Link>

      {/* Family Update CTA */}
      <Link
        href="/dashboard/family-update"
        className="flex items-center justify-between bg-[#eef5ee] border border-[#b8d9bc] rounded-2xl px-4 py-4 hover:bg-[#e4f0e4] transition-colors"
      >
        <div>
          <p className="text-sm font-semibold text-[#2d2926]">Generate your family update ✨</p>
          <p className="text-xs text-[#7a6f65] mt-0.5">An AI-written summary to share with grandparents</p>
        </div>
        <span className="text-[#5c7f63] text-lg shrink-0">→</span>
      </Link>

      {/* ── Child filter bar ─────────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-[#5c7f63] text-white"
              : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter("favorites")}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
            filter === "favorites"
              ? "bg-[#5c7f63] text-white"
              : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
          }`}
        >
          <Heart size={13} className={filter === "favorites" ? "fill-white" : ""} /> Favorites
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold text-white transition-all ${
              filter === c.id ? "ring-2 ring-offset-2 ring-[#5c7f63]" : "opacity-70 hover:opacity-100"
            }`}
            style={{ backgroundColor: c.color ?? "#5c7f63" }}
            title={c.name}
          >
            {c.name.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#b5aca4] pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memories..."
          className="w-full pl-9 pr-16 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); searchRef.current?.focus(); }}
              className="p-1 rounded-full hover:bg-[#f0ede8] text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={startVoiceSearch}
            className="p-1 rounded-full hover:bg-[#f0ede8] text-[#b5aca4] hover:text-[#5c7f63] transition-colors"
            aria-label="Voice search"
          >
            <Mic size={14} />
          </button>
        </div>
      </div>

      {/* Free user upgrade banner */}
      {!isPro && !loading && (
        <UpgradePrompt
          inline
          feature="Full Memory History"
          valueProp="You're seeing your last 30 days. Upgrade to keep every photo, book, and milestone — your full family story, always."
        />
      )}

      {/* ── Reflections section (when filter = all, show recent) ── */}
      {filter === "all" && !searchQuery && reflections.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-2">📝 Reflections</p>
          <div className="space-y-2">
            {reflections.slice(0, 3).map((r) => (
              <button
                key={r.id}
                onClick={() => openReflection(r)}
                className="w-full bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-3.5 text-left hover:bg-[#faf8f5] transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-[#5c7f63]">
                    {new Date(r.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  {r.is_private && <span className="text-[10px] text-[#b5aca4]">🔒</span>}
                </div>
                <p className="text-sm text-[#2d2926] leading-relaxed line-clamp-2">{r.reflection}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Memory grid ──────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-16">
          <span className="text-3xl animate-pulse">📷</span>
        </div>
      ) : filtered.length === 0 ? (
        searchQuery.trim() ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">📸</span>
            <p className="font-medium text-[#2d2926] mb-1">No memories found for &lsquo;{searchQuery}&rsquo;</p>
            <p className="text-sm text-[#7a6f65] max-w-xs mb-4">
              Try a different search or capture a new memory.
            </p>
            <button
              onClick={() => alert("More memory types coming soon")}
              className="px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
            >
              Capture a memory
            </button>
          </div>
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">🌸</span>
            <p className="font-medium text-[#2d2926] mb-1">No memories yet</p>
            <p className="text-sm text-[#7a6f65] max-w-xs">
              Start logging photos, projects, and books to build your family&apos;s story.
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-3 gap-[2px] rounded-2xl overflow-hidden">
          {(() => {
            let lastMonth = "";
            return filtered.map((m) => {
              const month = m.date.slice(0, 7); // "YYYY-MM"
              const showHeader = month !== lastMonth;
              lastMonth = month;
              return (
                <>{showHeader && (
                  <div key={`h-${month}`} className="col-span-3 bg-[#faf8f4] py-2 px-1">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">{formatMonth(m.date)}</p>
                  </div>
                )}
                <button
                  key={m.id}
                  className="group relative aspect-square bg-[#f0ede8] focus:outline-none text-left overflow-hidden"
                  onClick={() => { setSelectedMemory(m); setLightboxDeleteConfirm(false); }}
                >
                  {/* Photo or type tile */}
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

                  {/* Top-right icons: favorite + yearbook */}
                  <div className="absolute top-1 right-1 flex items-center gap-0.5">
                    {!isPartner && (
                      <button
                        onClick={(e) => toggleFavorite(m, e)}
                        className="w-5 h-5 rounded-full bg-black/30 flex items-center justify-center transition-opacity"
                        aria-label={m.favorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Heart size={10} className={m.favorite ? "text-red-400 fill-red-400" : "text-white"} />
                      </button>
                    )}
                    {m.include_in_book && (
                      <div className="w-5 h-5 rounded-full bg-black/30 flex items-center justify-center">
                        <BookmarkCheck size={10} className="text-[#5c7f63]" />
                      </div>
                    )}
                  </div>

                  {/* ··· menu button */}
                  {!isPartner && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuId(menuId === m.id ? null : m.id); }}
                      className="absolute top-7 right-1.5 w-5 h-5 rounded-full bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
                      aria-label="More options"
                    >
                      <MoreHorizontal size={12} className="text-white" />
                    </button>
                  )}

                  {/* Dropdown menu */}
                  {menuId === m.id && (
                    <div
                      className="absolute top-[52px] right-1.5 bg-white rounded-xl shadow-lg border border-[#e8e2d9] z-20 overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => openEdit(m)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#2d2926] hover:bg-[#f8f6f3] transition-colors">
                        <Pencil size={12} className="text-[#7a6f65]" /> Edit
                      </button>
                      <button onClick={() => openDelete(m)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}

                  {/* Date label at bottom */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 pb-1.5 pt-5">
                    <p className="text-[10px] text-white/90 font-medium">{formatDate(m.date)}</p>
                  </div>
                </button></>
              );
            });
          })()}
        </div>
      )}

      {/* ── Detail / Lightbox Modal ────────────────────────── */}
      {selectedMemory && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => { setSelectedMemory(null); setMenuId(null); setLightboxDeleteConfirm(false); }}
        >
          <div
            className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Hero: photo or styled tile */}
            {selectedMemory.photo_url ? (
              <img
                src={selectedMemory.photo_url}
                alt={selectedMemory.title ?? "Memory"}
                className="w-full rounded-t-3xl object-cover max-h-[50vh]"
              />
            ) : (
              <div className={`w-full h-48 rounded-t-3xl flex flex-col items-center justify-center ${
                selectedMemory.type === "book" ? "bg-[#FDF3E3]"
                  : selectedMemory.type === "quote" ? "bg-[#F5EFF8]"
                  : "bg-[#EAF6EE]"
              }`}>
                {selectedMemory.type === "book" ? (
                  <span className="text-6xl">📖</span>
                ) : selectedMemory.type === "quote" ? (
                  <span className="text-7xl font-serif text-[#c49edd] leading-none">&ldquo;</span>
                ) : (
                  <span className="text-6xl">{TYPE_EMOJI[selectedMemory.type] ?? "📷"}</span>
                )}
              </div>
            )}

            <div className="p-5 space-y-3">
              {/* Child avatar + name + date row */}
              <div className="flex items-center gap-2.5">
                {selectedMemory.child_id ? (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                    style={{ backgroundColor: childColor(selectedMemory.child_id) }}
                  >
                    {childName(selectedMemory.child_id).charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#f0ede8] flex items-center justify-center text-xs shrink-0">👨‍👩‍👧‍👦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#2d2926]">
                    {selectedMemory.child_id ? childName(selectedMemory.child_id) : "Everyone"}
                  </p>
                  <p className="text-[11px] text-[#b5aca4]">{formatDate(selectedMemory.date)}</p>
                </div>
                <button
                  onClick={() => toggleFavorite(selectedMemory)}
                  className="shrink-0 p-1"
                  aria-label={selectedMemory.favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart size={20} className={selectedMemory.favorite ? "text-red-400 fill-red-400" : "text-[#c8bfb5]"} />
                </button>
                <button
                  onClick={() => { setSelectedMemory(null); setMenuId(null); setLightboxDeleteConfirm(false); }}
                  className="text-[#b5aca4] hover:text-[#7a6f65] shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Title */}
              {selectedMemory.title && (
                <p className="font-semibold text-[#2d2926] text-base">{selectedMemory.title}</p>
              )}

              {/* Caption */}
              {selectedMemory.caption && (
                <p className="text-sm text-[#7a6f65] leading-relaxed">{selectedMemory.caption}</p>
              )}

              {/* Heart + share teaser */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => toggleHeart(selectedMemory.id)}
                  className="flex items-center gap-1.5 text-sm transition-colors"
                >
                  <Heart
                    size={18}
                    className={hearted.has(selectedMemory.id) ? "text-red-400 fill-red-400" : "text-[#c8bfb5]"}
                  />
                  <span className={`text-xs font-medium ${hearted.has(selectedMemory.id) ? "text-red-400" : "text-[#b5aca4]"}`}>
                    {hearted.has(selectedMemory.id) ? "1" : "Be the first"}
                  </span>
                </button>
                <span className="text-[10px] text-[#b5aca4]">Share with family — coming soon</span>
              </div>

              {selectedMemory.include_in_book && (
                <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#e8f0e9] text-[#5c7f63]">
                  ☑ In yearbook
                </span>
              )}

              {/* ── Action buttons: Edit, Yearbook, Delete ── */}
              {!isPartner && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => openEdit(selectedMemory)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    onClick={() => toggleYearbook(selectedMemory)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      selectedMemory.include_in_book
                        ? "border-[#5c7f63] bg-[#e8f0e9] text-[#5c7f63]"
                        : "border-[#e8e2d9] text-[#7a6f65] hover:bg-[#f0ede8]"
                    }`}
                  >
                    <BookmarkCheck size={14} /> Yearbook
                  </button>
                  {!lightboxDeleteConfirm ? (
                    <button
                      onClick={() => setLightboxDeleteConfirm(true)}
                      className="flex-1 py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  ) : (
                    <button
                      onClick={confirmLightboxDelete}
                      disabled={deleting}
                      className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={14} /> {deleting ? "Deleting…" : "Confirm?"}
                    </button>
                  )}
                </div>
              )}

              {lightboxDeleteConfirm && !deleting && (
                <p className="text-xs text-red-400 text-center">Delete this memory? This can&apos;t be undone.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">Edit Memory</h2>
              <button onClick={() => setEditing(null)} className="text-[#b5aca4] hover:text-[#7a6f65]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Caption</label>
                <textarea
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Date</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                  <select
                    value={editChild}
                    onChange={(e) => setEditChild(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  >
                    <option value="">Everyone</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Include in yearbook toggle */}
              <button
                onClick={() => setEditInBook(!editInBook)}
                className="flex items-center gap-2.5 w-full"
                type="button"
              >
                <div className={`w-9 h-5 rounded-full transition-colors relative ${editInBook ? "bg-[#5c7f63]" : "bg-[#e8e2d9]"}`}>
                  <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${editInBook ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
                </div>
                <span className="text-sm text-[#2d2926]">Include in yearbook</span>
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
              <Trash2 size={24} className="text-red-400" />
            </div>
            <div>
              <p className="font-bold text-[#2d2926] mb-1">Delete this memory?</p>
              <p className="text-sm text-[#7a6f65]">
                {deleteTarget.title ? `"${deleteTarget.title}" will` : "This will"} be permanently removed
                {deleteTarget.photo_url ? " along with its photo" : ""}.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reflection View Modal ──────────────────────────── */}
      {viewingReflection && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#5c7f63] mb-0.5">
                  {new Date(viewingReflection.date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric",
                  })}
                </p>
                <h2 className="font-bold text-[#2d2926]">📝 Reflection</h2>
              </div>
              <button onClick={closeReflection} className="text-[#b5aca4] hover:text-[#7a6f65]">
                <X size={18} />
              </button>
            </div>

            <button
              onClick={async () => {
                const newVal = !viewingReflection.is_private;
                await supabase.from("daily_reflections").update({ is_private: newVal }).eq("id", viewingReflection.id);
                const updated = { ...viewingReflection, is_private: newVal };
                setViewingReflection(updated);
                setReflections((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
              }}
              className="flex items-center gap-2 text-xs text-[#7a6f65]"
            >
              <div className={`w-8 h-[18px] rounded-full transition-colors relative ${viewingReflection.is_private ? "bg-[#5c7f63]" : "bg-[#e8e2d9]"}`}>
                <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${viewingReflection.is_private ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
              </div>
              <span>{viewingReflection.is_private ? "🔒 Private — hidden in Kid Mode" : "👀 Visible in Kid Mode"}</span>
            </button>

            {editingReflection ? (
              <>
                <textarea
                  value={reflectionEditText}
                  onChange={(e) => setReflectionEditText(e.target.value)}
                  rows={8}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none leading-relaxed"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingReflection(false)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveReflectionEdit}
                    disabled={savingReflection || !reflectionEditText.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {savingReflection ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[#2d2926] leading-relaxed whitespace-pre-wrap">
                  {viewingReflection.reflection}
                </p>
                <button
                  onClick={() => { setEditingReflection(true); setReflectionEditText(viewingReflection.reflection); }}
                  className="w-full py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                >
                  ✏️ Edit
                </button>
                {!reflectionDeleteConfirm ? (
                  <button
                    onClick={() => setReflectionDeleteConfirm(true)}
                    className="w-full py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-center text-[#2d2926] font-medium">Are you sure?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReflectionDeleteConfirm(false)}
                        className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={deleteReflection}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="h-4" />
    </div>

    {milestonePrompt && (
      <MilestonePrompt
        milestone={milestonePrompt.milestone}
        message={milestonePrompt.message}
        badgeEmoji={milestonePrompt.badgeEmoji}
        onDismiss={() => setMilestonePrompt(null)}
      />
    )}

    </>
  );
}
