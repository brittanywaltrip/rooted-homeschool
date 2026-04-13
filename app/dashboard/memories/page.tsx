"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { X, MoreHorizontal, Trash2, Pencil, Heart, Search, Mic, BookmarkCheck } from "lucide-react";
import YearbookBookmark from "@/app/components/YearbookBookmark";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import PageHero from "@/app/components/PageHero";
import UpgradePrompt from "@/components/UpgradePrompt";
import MilestonePrompt from "@/components/MilestonePrompt";
import { compressImage } from "@/lib/compress-image";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";

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
  family_visible: boolean;
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
    family_visible: true,
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
  const previewFree = typeof window !== 'undefined' && window.location.search.includes('previewFree=true');
  const { isPartner, effectiveUserId } = usePartner();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [planType, setPlanType] = useState<string | null>(null);
  // Filter: "all" | "family" | "favorites" | child id
  const [filter, setFilter] = useState("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Detail / lightbox
  const [selectedMemory, setSelectedMemory] = useState<MemoryRow | null>(null);
  const [hearted, setHearted] = useState<Set<string>>(new Set());

  // First-visit yearbook tooltip
  const [showYearbookTip, setShowYearbookTip] = useState(false);
  const [yearbookTipVisible, setYearbookTipVisible] = useState(false);
  const hasShownTipRef = useRef(false);

  // Lightbox inline delete confirm
  const [lightboxDeleteConfirm, setLightboxDeleteConfirm] = useState(false);

  // Lightbox reactions + comments
  const [lbReactions, setLbReactions] = useState<{ emoji: string; viewer_name: string }[]>([]);
  const [lbComments, setLbComments] = useState<{ id: string; viewer_name: string; body: string; created_at: string }[]>([]);

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
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const editPhotoRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Milestone prompt
  const [milestonePrompt, setMilestonePrompt] = useState<{ milestone: string; message: string; badgeEmoji: string } | null>(null);

  // Check localStorage for yearbook tip on mount
  useEffect(() => {
    if (!localStorage.getItem("rooted_yearbook_tip_seen")) {
      setShowYearbookTip(true);
    }
  }, []);

  // Show tooltip when lightbox first opens and tip hasn't been shown yet
  useEffect(() => {
    if (selectedMemory && showYearbookTip && !hasShownTipRef.current) {
      hasShownTipRef.current = true;
      setYearbookTipVisible(true);
      const timer = setTimeout(() => {
        setYearbookTipVisible(false);
        setShowYearbookTip(false);
        localStorage.setItem("rooted_yearbook_tip_seen", "1");
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [selectedMemory, showYearbookTip]);

  function dismissYearbookTip() {
    setYearbookTipVisible(false);
    setShowYearbookTip(false);
    localStorage.setItem("rooted_yearbook_tip_seen", "1");
  }

  // Highlight from notification deep link
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const h = searchParams.get("highlight");
    if (h) {
      setHighlightId(h);
      // Scroll to the element after a short delay for render
      setTimeout(() => {
        const el = document.querySelector(`[data-memory-id="${h}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 500);
      // Remove highlight after 3 seconds
      const timer = setTimeout(() => setHighlightId(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  // Fetch reactions + comments when lightbox opens
  useEffect(() => {
    if (!selectedMemory) {
      setLbReactions([]);
      setLbComments([]);
      return;
    }
    (async () => {
      const [{ data: rxns }, { data: cmts }] = await Promise.all([
        supabase
          .from("memory_reactions")
          .select("emoji, viewer_name")
          .eq("memory_id", selectedMemory.id),
        supabase
          .from("memory_comments")
          .select("id, viewer_name, body, created_at")
          .eq("memory_id", selectedMemory.id)
          .order("created_at", { ascending: true }),
      ]);
      setLbReactions((rxns ?? []) as { emoji: string; viewer_name: string }[]);
      setLbComments((cmts ?? []) as { id: string; viewer_name: string; body: string; created_at: string }[]);
    })();
  }, [selectedMemory?.id]);

  // Family reactions + notifications
  const [reactionCounts, setReactionCounts] = useState<Record<string, { emoji: string; count: number }>>({}); // memory_id -> { top emoji, total count }
  type FamilyNotif = { id: string; type: string; actor_name: string; emoji: string | null; preview: string | null; memory_id: string | null; created_at: string };
  const [familyNotifs, setFamilyNotifs] = useState<FamilyNotif[]>([]);
  const [showAllNotifs, setShowAllNotifs] = useState(false);
  const [notifsDismissed, setNotifsDismissed] = useState(false);

  // Reflection view
  const [viewingReflection, setViewingReflection] = useState<Reflection | null>(null);
  const [editingReflection, setEditingReflection] = useState(false);
  const [reflectionEditText, setReflectionEditText] = useState("");
  const [reflectionDeleteConfirm, setReflectionDeleteConfirm] = useState(false);
  const [savingReflection, setSavingReflection] = useState(false);

  useEffect(() => { document.title = "Memories \u00b7 Rooted"; posthog.capture('page_viewed', { page: 'memories' }); }, []);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!effectiveUserId) return;
    try {

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro, plan_type")
      .eq("id", effectiveUserId)
      .single();
    const userIsPro = (profile as { is_pro?: boolean } | null)?.is_pro ?? false;
    setIsPro(userIsPro);
    setPlanType((profile as { plan_type?: string } | null)?.plan_type ?? null);

    const dateFloor = "2020-01-01";

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
        .gte("date", dateFloor)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("daily_reflections")
        .select("id, date, reflection, is_private, updated_at")
        .eq("user_id", effectiveUserId)
        .order("date", { ascending: false }),
    ]);

    setChildren(capitalizeChildNames(kids ?? []));
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

    // Fetch reaction counts for all loaded memories
    const allMems = (memRows && memRows.length > 0) ? memRows : [];
    const memIds = allMems.map((m: any) => m.id);
    if (memIds.length > 0) {
      const { data: reactions } = await supabase
        .from("memory_reactions")
        .select("memory_id, emoji")
        .in("memory_id", memIds);
      if (reactions && reactions.length > 0) {
        const grouped: Record<string, Record<string, number>> = {};
        reactions.forEach((r: any) => {
          if (!grouped[r.memory_id]) grouped[r.memory_id] = {};
          grouped[r.memory_id][r.emoji] = (grouped[r.memory_id][r.emoji] ?? 0) + 1;
        });
        const counts: Record<string, { emoji: string; count: number }> = {};
        for (const [mid, emojis] of Object.entries(grouped)) {
          const total = Object.values(emojis).reduce((s, n) => s + n, 0);
          const topEmoji = Object.entries(emojis).sort((a, b) => b[1] - a[1])[0][0];
          counts[mid] = { emoji: topEmoji, count: total };
        }
        setReactionCounts(counts);
      }
    }

    // Fetch unread family notifications
    const { data: notifs } = await supabase
      .from("family_notifications")
      .select("id, type, actor_name, emoji, preview, memory_id, created_at")
      .eq("user_id", effectiveUserId)
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(20);
    setFamilyNotifs((notifs ?? []) as FamilyNotif[]);

    } catch (err) {
      console.error("Failed to load memories:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  // ── Open lightbox from ?open= URL param ──────────────────────────────────────
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || loading || memories.length === 0) return;
    const match = memories.find((m) => m.id === openId);
    if (match) setSelectedMemory(match);
  }, [searchParams, loading, memories]);

  async function dismissFamilyNotifs() {
    setNotifsDismissed(true);
    const ids = familyNotifs.map(n => n.id);
    if (ids.length > 0) {
      await supabase.from("family_notifications").update({ read: true }).in("id", ids);
    }
    setFamilyNotifs([]);
  }

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
    const onMemorySaved = () => load();
    window.addEventListener('rooted:memory-saved', onMemorySaved);
    const onChildrenUpdated = () => load();
    window.addEventListener('rooted:children-updated', onChildrenUpdated);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('rooted:memory-saved', onMemorySaved);
      window.removeEventListener('rooted:children-updated', onChildrenUpdated);
    };
  }, [load]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const childName = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.name ?? "") : "";
  const childColor = (id?: string | null) =>
    id ? (children.find((c) => c.id === id)?.color ?? "#5c7f63") : "#5c7f63";

  const safeParseDate = (d: string | null | undefined): Date | null => {
    if (!d) return null;
    const iso = d.slice(0, 10); // extract YYYY-MM-DD from any format
    const dt = new Date(iso + "T12:00:00");
    return isNaN(dt.getTime()) ? null : dt;
  };

  const formatDate = (d: string) => {
    const dt = safeParseDate(d);
    return dt ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Unknown date";
  };

  const formatMonth = (d: string) => {
    const dt = safeParseDate(d);
    return dt ? dt.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Unknown date";
  };

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

  async function toggleFamilyVisible(m: MemoryRow) {
    const newVal = !m.family_visible;
    setMemories((prev) => prev.map((mem) => (mem.id === m.id ? { ...mem, family_visible: newVal } : mem)));
    if (selectedMemory?.id === m.id) setSelectedMemory({ ...m, family_visible: newVal });
    await supabase.from("memories").update({ family_visible: newVal, updated_at: new Date().toISOString() }).eq("id", m.id);
  }

  // ── Filter + Search ──────────────────────────────────────────────────────

  const filtered = memories.filter((m) => {
    // Filter by child / family / favorites / yearbook / type
    if (filter === "favorites" && !m.favorite) return false;
    if (filter === "yearbook" && !m.include_in_book) return false;
    if (filter === "family" && m.child_id) return false;
    if (filter.startsWith("type:") && m.type !== filter.slice(5)) return false;
    if (filter !== "all" && filter !== "family" && filter !== "favorites" && filter !== "yearbook" && !filter.startsWith("type:") && m.child_id !== filter) return false;

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
    setEditDate(m.date?.slice(0, 10) ?? "");
    setEditChild(m.child_id ?? "");
    setEditInBook(m.include_in_book);
    setEditPhotoFile(null);
    setEditPhotoPreview(m.photo_url ?? null);
    setEditPhotoRemoved(false);
    setMenuId(null);
    setSelectedMemory(null);
    setLightboxDeleteConfirm(false);
  }

  async function saveEdit() {
    if (!editing) return;
    setEditSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setEditSaving(false); return; }

    let photoUrl: string | null | undefined = undefined;
    if (editPhotoFile) {
      const compressed = await compressImage(editPhotoFile);
      const path = `${user.id}/${Date.now()}-${compressed.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }
    } else if (editPhotoRemoved) {
      photoUrl = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      title: editTitle.trim() || null,
      caption: editCaption.trim() || null,
      date: editDate.slice(0, 10),
      child_id: editChild || null,
      include_in_book: editInBook,
      updated_at: new Date().toISOString(),
    };
    if (photoUrl !== undefined) updates.photo_url = photoUrl;

    const { data } = await supabase
      .from("memories")
      .update(updates)
      .eq("id", editing.id)
      .select()
      .single();
    setEditSaving(false);
    setEditing(null);
    if (data) {
      await load();
    }
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
    setDeleting(false);
    setDeleteTarget(null);
    await load();
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
    setDeleting(false);
    setSelectedMemory(null);
    setLightboxDeleteConfirm(false);
    await load();
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
    <PageHero overline="Your Family Story" title="Memories 📸" subtitle="Photos, drawings, wins, books, field trips — everything." />
    <div className="max-w-3xl px-4 pt-5 pb-7 space-y-5">

      {/* Header links */}
      <div className="flex justify-end gap-4 -mt-2 mb--1">
        <button
          type="button"
          onClick={() => {
            window.open('/family/preview', '_blank');
          }}
          className="text-sm text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors cursor-pointer"
        >
          👁 Preview family view
        </button>
        <button
          type="button"
          onClick={() => alert("More memory types coming soon")}
          className="text-sm text-[#5c7f63] cursor-pointer"
        >
          + Add memory
        </button>
      </div>

      {/* ── Yearbook card (hidden when 0 memories) ────────────────── */}
      {memories.length > 0 && (
        <Link
          href="/dashboard/memories/yearbook"
          className="bg-[#faf6f0] border border-[#c0dd97] rounded-2xl p-3 flex items-center gap-3 hover:border-[#5c7f63] transition-colors"
        >
          <span className="text-[20px]">📖</span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--g-deep)]">Your family yearbook →</p>
            <p className="text-[11px] text-[#9a8f85]">
              {memories.filter((m) => m.include_in_book).length} memories bookmarked this year
            </p>
          </div>
        </Link>
      )}

      {/* ── Filter pills ─────────────────────────────────────── */}
      {/* ROW 1: Primary filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ["all", "All"],
          ["type:photo", "📸 Photos"],
          ["favorites", "♡ Favorites"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === key
                ? "bg-[#5c7f63] text-white"
                : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setShowMoreFilters(!showMoreFilters)}
          className="px-3.5 py-1.5 rounded-full text-sm transition-colors"
          style={{ background: "#f4faf0", border: "1px solid #c0dea8", color: "var(--g-brand)", fontWeight: 500 }}
        >
          {showMoreFilters ? "Less ‹" : "More ›"}
        </button>
      </div>

      {/* Expanded tray */}
      {showMoreFilters && (
        <div className="flex flex-wrap gap-2" style={{ background: "#f9f6f0", borderRadius: 12, border: "0.5px solid #e8e0d4", padding: "8px 12px", marginTop: 4 }}>
          {([
            ["type:win", "⭐ Wins"],
            ["type:book", "📚 Books"],
            ["type:drawing", "🎨 Drawings"],
            ["type:field_trip", "🗺️ Trips"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-[#5c7f63] text-white"
                  : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ROW 2: Child avatars */}
      {children.length > 0 && (
        <div className="flex items-center gap-2">
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(filter === c.id ? "all" : c.id)}
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
      )}

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

      {/* ── Family notifications banner ──────────────────── */}
      {!notifsDismissed && familyNotifs.length > 0 && (
        <div style={{ background: "#fff8f0", border: "0.5px solid #f0c878", borderRadius: 12, padding: "10px 13px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🔔</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Most recent notification — clickable */}
              <button
                onClick={async () => {
                  const notif = familyNotifs[0];
                  // Mark as read via PATCH
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session) {
                      await fetch("/api/family/notifications", {
                        method: "PATCH",
                        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ ids: [notif.id] }),
                      });
                    }
                  } catch { /* ignore */ }
                  // Remove this notification from state
                  setFamilyNotifs((prev) => prev.filter((n) => n.id !== notif.id));
                  // Open lightbox if memory_id exists
                  if (notif.memory_id) {
                    const match = memories.find((m) => m.id === notif.memory_id);
                    if (match) { setSelectedMemory(match); return; }
                  }
                  // Fall back: no-op (banner disappears, user stays on page)
                }}
                style={{ fontSize: 12, fontWeight: 600, color: "#7a5000", margin: 0, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", width: "100%" }}
                className="hover:opacity-80 transition-opacity"
              >
                {familyNotifs[0].actor_name}{" "}
                {familyNotifs[0].type === "reaction"
                  ? `reacted ${familyNotifs[0].emoji ?? "❤️"}`
                  : "commented"}{" "}
                {familyNotifs[0].preview ? `"${familyNotifs[0].preview.slice(0, 40)}${familyNotifs[0].preview.length > 40 ? "…" : ""}"` : "on a memory"}
              </button>

              {/* Show all / collapse */}
              {familyNotifs.length > 1 && !showAllNotifs && (
                <button
                  onClick={() => setShowAllNotifs(true)}
                  style={{ fontSize: 11, color: "#a07000", marginTop: 4, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  See all {familyNotifs.length} →
                </button>
              )}
              {showAllNotifs && familyNotifs.slice(1).map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (session) {
                        await fetch("/api/family/notifications", {
                          method: "PATCH",
                          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ ids: [n.id] }),
                        });
                      }
                    } catch { /* ignore */ }
                    setFamilyNotifs((prev) => prev.filter((fn) => fn.id !== n.id));
                    if (n.memory_id) {
                      const match = memories.find((m) => m.id === n.memory_id);
                      if (match) { setSelectedMemory(match); return; }
                    }
                  }}
                  style={{ fontSize: 11, color: "#7a5000", margin: "4px 0 0", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", width: "100%", display: "block" }}
                  className="hover:opacity-80 transition-opacity"
                >
                  {n.actor_name} {n.type === "reaction" ? `reacted ${n.emoji ?? "❤️"}` : `commented: "${(n.preview ?? "").slice(0, 40)}"`}
                </button>
              ))}
            </div>
            <button
              onClick={dismissFamilyNotifs}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#c8bfb5", fontSize: 16, padding: 0, flexShrink: 0, lineHeight: 1 }}
              aria-label="Dismiss notifications"
            >
              ×
            </button>
          </div>
        </div>
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
                    {safeParseDate(r.date)?.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) ?? "Unknown date"}
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
      {loadError ? (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">🌿</span>
          <p className="font-medium text-[#2d2926] mb-1">Something went wrong loading your memories</p>
          <p className="text-sm text-[#7a6f65] max-w-xs mb-4">Pull to refresh or try again.</p>
          <button
            onClick={() => { setLoadError(false); setLoading(true); load(); }}
            className="px-4 py-2 rounded-xl bg-[#5c7f63] text-white text-sm font-medium hover:bg-[var(--g-deep)] transition-colors"
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="text-center py-16">
          <span className="text-3xl animate-pulse">📷</span>
        </div>
      ) : filtered.length === 0 ? (
        searchQuery.trim() ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">📸</span>
            <p className="font-medium text-[#2d2926] mb-1">No memories found for &lsquo;{searchQuery}&rsquo; 📸</p>
            <p className="text-sm text-[#7a6f65] max-w-xs mb-4">
              Try a different search or capture a new memory.
            </p>
            <Link
              href="/dashboard"
              className="px-5 py-2.5 rounded-xl bg-[var(--g-brand)] hover:bg-[#1e3d29] text-white text-sm font-semibold transition-colors"
            >
              Capture a memory →
            </Link>
          </div>
        ) : (filter !== "all" && memories.length > 0) ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">🔍</span>
            <p className="font-medium text-[#2d2926] mb-1">No memories match this filter</p>
            <button
              onClick={() => setFilter("all")}
              className="text-sm text-[#5c7f63] font-medium mt-2 hover:underline"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-6xl mb-5">🌿</span>
            <h2
              className="text-xl font-medium text-[#2d2926] mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Your family story starts here
            </h2>
            <p className="text-sm text-[#7a6f65] max-w-sm mb-8 leading-relaxed">
              Every photo, win, book read, and field trip lives here — and builds your yearbook automatically as you go.
            </p>
            <button
              onClick={() => {
                const fab = document.querySelector<HTMLButtonElement>('[data-fab-trigger]');
                if (fab) fab.click();
              }}
              className="w-full max-w-xs py-3.5 rounded-full bg-[var(--g-brand)] text-white font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] mb-3"
            >
              +  Capture your first memory
            </button>
            <Link
              href="/dashboard/memories/yearbook/read"
              className="w-full max-w-xs py-3 rounded-full border-2 border-[var(--g-brand)] text-[var(--g-brand)] font-medium text-sm text-center hover:bg-[#e8f0e9] transition-colors block"
            >
              Preview your yearbook →
            </Link>
          </div>
        )
      ) : (
        <div className="grid grid-cols-3 gap-[2px] rounded-2xl overflow-hidden">
          {(() => {
            let lastMonth = "";
            let photoIdx = 0;
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
                  data-memory-id={m.id}
                  className={`group relative aspect-square bg-[#f0ede8] focus:outline-none text-left overflow-hidden${highlightId === m.id ? " ring-2 ring-green-400 animate-pulse" : ""}`}
                  onClick={() => { setSelectedMemory(m); setLightboxDeleteConfirm(false); }}
                >
                  {/* Photo or type tile */}
                  {m.photo_url ? (
                    <img src={m.photo_url} alt={m.title ?? "Memory"} loading={photoIdx++ < 6 ? "eager" : "lazy"} className="w-full h-full object-cover" />
                  ) : (
                    (() => {
                      const tileConfig: Record<string, { gradient: string; textColor: string; subtextColor: string }> = {
                        book:       { gradient: "linear-gradient(135deg, #F5E6C8 0%, #E8C87A 100%)", textColor: "#4a2e0a", subtextColor: "#7a5c2e" },
                        win:        { gradient: "linear-gradient(135deg, #FDE8A0 0%, #F5C842 100%)", textColor: "#4a3200", subtextColor: "#7a5c1a" },
                        drawing:    { gradient: "linear-gradient(135deg, #E8D5F5 0%, #C9A8E8 100%)", textColor: "#3d1f5c", subtextColor: "#6b4a8a" },
                        quote:      { gradient: "linear-gradient(135deg, #F0E4F8 0%, #D4B8E8 100%)", textColor: "#3d1f5c", subtextColor: "#6b4a8a" },
                        project:    { gradient: "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)", textColor: "#1a3d1e", subtextColor: "#2d5a32" },
                        field_trip: { gradient: "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)", textColor: "#1a3d1e", subtextColor: "#2d5a32" },
                        activity:   { gradient: "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)", textColor: "#1a3d1e", subtextColor: "#2d5a32" },
                      };
                      const cfg = tileConfig[m.type] ?? tileConfig.project;
                      const emoji = TYPE_EMOJI[m.type] ?? "📷";
                      const title = m.title ?? TYPE_LABEL[m.type] ?? "Memory";
                      return (
                        <div className="w-full h-full relative overflow-hidden" style={{ background: cfg.gradient }}>
                          {/* Subtle dot texture */}
                          <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, currentColor 0.5px, transparent 0.5px)", backgroundSize: "8px 8px", opacity: 0.06 }} />
                          {/* Centered emoji */}
                          <div className="absolute inset-0 flex items-center justify-center pb-6">
                            <span className="text-5xl drop-shadow-sm">{emoji}</span>
                          </div>
                          {/* Bottom gradient overlay + text */}
                          <div className="absolute inset-x-0 bottom-0 h-[45%]" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 100%)" }}>
                            <div className="absolute bottom-0 inset-x-0 px-2 pb-2">
                              <p className="text-[11px] font-semibold text-white text-center line-clamp-2 drop-shadow-sm">{title}</p>
                              {m.caption && <p className="text-[10px] text-white/75 text-center line-clamp-1 mt-0.5">{m.caption}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {/* Camera icon for non-photo tiles without a photo */}
                  {m.type !== "photo" && !m.photo_url && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("rooted:open-fab")); }}
                      className="absolute bottom-1.5 right-1.5 flex items-center justify-center rounded-full z-10"
                      style={{ width: 22, height: 22, background: "rgba(0,0,0,0.35)" }}
                      aria-label="Add photo"
                    >
                      <span style={{ fontSize: 12, lineHeight: 1 }}>📷</span>
                    </button>
                  )}

                  {/* Subtle bottom gradient + date */}
                  <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "28%", background: "linear-gradient(transparent, rgba(0,0,0,0.28))" }} />
                  <span style={{ position: "absolute", bottom: 4, left: 5, fontSize: 9, color: "rgba(255,255,255,0.75)" }}>
                    {formatDate(m.date)}
                  </span>

                  {/* Yearbook bookmark */}
                  {!isPartner && (
                    <div
                      className={`absolute top-0.5 right-0.5 z-10 transition-opacity ${m.include_in_book ? "opacity-100" : "opacity-0 group-hover:opacity-60"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <YearbookBookmark
                        memoryId={m.id}
                        initialValue={m.include_in_book}
                        size="sm"
                        onChange={(val) => {
                          setMemories((prev) => prev.map((mem) => mem.id === m.id ? { ...mem, include_in_book: val } : mem));
                        }}
                      />
                    </div>
                  )}

                  {/* Reaction count pill */}
                  {reactionCounts[m.id] && reactionCounts[m.id].count > 0 && (
                    <span style={{
                      position: "absolute", bottom: 4, right: 5, fontSize: 9, color: "white",
                      background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: "2px 5px",
                      lineHeight: 1.2, pointerEvents: "none",
                    }}>
                      {reactionCounts[m.id].emoji} {reactionCounts[m.id].count}
                    </span>
                  )}
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
          onClick={() => { setSelectedMemory(null); setMenuId(null); setLightboxDeleteConfirm(false); if (yearbookTipVisible) dismissYearbookTip(); }}
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
                loading="eager"
                className="w-full rounded-t-3xl object-cover max-h-[50vh]"
              />
            ) : (
              (() => {
                const lbConfig: Record<string, string> = {
                  book:       "linear-gradient(135deg, #F5E6C8 0%, #E8C87A 100%)",
                  win:        "linear-gradient(135deg, #FDE8A0 0%, #F5C842 100%)",
                  drawing:    "linear-gradient(135deg, #E8D5F5 0%, #C9A8E8 100%)",
                  quote:      "linear-gradient(135deg, #F0E4F8 0%, #D4B8E8 100%)",
                  project:    "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)",
                  field_trip: "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)",
                  activity:   "linear-gradient(135deg, #C8E6C8 0%, #7BAE7F 100%)",
                };
                return (
                  <div className="w-full h-48 rounded-t-3xl relative overflow-hidden" style={{ background: lbConfig[selectedMemory.type] ?? lbConfig.project }}>
                    <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, currentColor 0.5px, transparent 0.5px)", backgroundSize: "10px 10px", opacity: 0.06 }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-6xl drop-shadow-sm">{TYPE_EMOJI[selectedMemory.type] ?? "📷"}</span>
                    </div>
                  </div>
                );
              })()
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
                {/* TODO: When share-with-family is built, show family reaction
                   count here (e.g. "♡ 3") only when reactions > 0.
                   Empty = no heart visible on grid tile. */}
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

              {/* Family reactions */}
              {lbReactions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {lbReactions.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-[#f0ede8] rounded-full px-2.5 py-1 text-[#5a5048]">
                      {r.emoji} {r.viewer_name}
                    </span>
                  ))}
                </div>
              )}

              {/* Family comments */}
              {lbComments.length > 0 && (
                <div className="space-y-2 pt-1">
                  {lbComments.map((c) => (
                    <div key={c.id} className="bg-[#f5f2ed] rounded-xl px-3 py-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-[#2d2926]">{c.viewer_name}</span>
                        <span className="text-[10px] text-[#b5aca4]">
                          {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <p className="text-sm text-[#5a5048] mt-0.5">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Heart */}
              {lbReactions.length === 0 && lbComments.length === 0 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Heart size={16} className="text-[#c8bfb5]" />
                  <span className="text-xs text-[#b5aca4]">No reactions yet</span>
                </div>
              )}

              {/* Visibility badges */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => toggleFamilyVisible(selectedMemory)}
                  className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                    selectedMemory.family_visible !== false
                      ? "bg-[#e8f0e9] text-[#5c7f63]"
                      : "bg-[#f0ede8] text-[#b5aca4]"
                  }`}
                >
                  {selectedMemory.family_visible !== false ? "👁 Visible to family" : "🔒 Private"}
                </button>
              </div>

              {/* ── Action buttons: Edit, Yearbook Bookmark, Delete ── */}
              {!isPartner && (
                <div className="flex gap-2 pt-1 items-center">
                  <button
                    onClick={() => openEdit(selectedMemory)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <div className="relative">
                    <YearbookBookmark
                      memoryId={selectedMemory.id}
                      initialValue={selectedMemory.include_in_book}
                      size="md"
                      showLabel
                      onChange={(val) => {
                        setMemories((prev) => prev.map((mem) => mem.id === selectedMemory.id ? { ...mem, include_in_book: val } : mem));
                        setSelectedMemory({ ...selectedMemory, include_in_book: val });
                      }}
                    />
                    {yearbookTipVisible && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap z-50"
                        onClick={dismissYearbookTip}
                      >
                        <div className="bg-[var(--g-deep)] text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
                          Tap to add this memory to your yearbook
                        </div>
                        <div className="w-2 h-2 bg-[var(--g-deep)] rotate-45 mx-auto -mt-1" />
                      </div>
                    )}
                  </div>
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

              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Photo</label>
                <input ref={editPhotoRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setEditPhotoFile(file);
                    setEditPhotoRemoved(false);
                    const reader = new FileReader();
                    reader.onload = () => setEditPhotoPreview(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                />
                {editPhotoPreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editPhotoPreview} alt="Memory photo" className="w-full h-32 object-cover rounded-xl border border-[#e8e2d9]" />
                    <button onClick={() => { setEditPhotoFile(null); setEditPhotoPreview(null); setEditPhotoRemoved(true); if (editPhotoRef.current) editPhotoRef.current.value = ""; }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center text-sm hover:bg-black/70 transition-colors">
                      ×
                    </button>
                    <button onClick={() => editPhotoRef.current?.click()}
                      className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-black/50 text-white text-xs hover:bg-black/70 transition-colors">
                      Change photo
                    </button>
                  </div>
                ) : (
                  <button onClick={() => editPhotoRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl border-2 border-dashed border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors">
                    <span className="text-lg">📸</span>
                    <span className="text-sm">Add a photo (optional)</span>
                  </button>
                )}
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

              {/* Yearbook bookmark row */}
              {!isPartner && (
                <button
                  onClick={() => setEditInBook(!editInBook)}
                  className="flex items-center gap-2.5 w-full"
                  type="button"
                >
                  <YearbookBookmark
                    memoryId={editing.id}
                    initialValue={editInBook}
                    size="md"
                    onChange={(val) => {
                      setEditInBook(val);
                      setMemories((prev) => prev.map((mem) => mem.id === editing.id ? { ...mem, include_in_book: val } : mem));
                    }}
                  />
                  <span className="text-sm text-[#2d2926]">
                    {editInBook ? "In your yearbook" : "Add to yearbook"}
                  </span>
                </button>
              )}
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
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-medium transition-colors"
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
                  {safeParseDate(viewingReflection.date)?.toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric",
                  }) ?? "Unknown date"}
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
                    className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-medium transition-colors"
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
