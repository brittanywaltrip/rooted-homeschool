"use client";

import { useEffect, useState, useRef } from "react";
import { Camera, BookOpen, FolderOpen, Sparkles, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

const MEMORY_TYPES = [
  { id: "all",     label: "All",      emoji: "✨" },
  { id: "photo",   label: "Photos",   emoji: "📷" },
  { id: "project", label: "Projects", emoji: "📁" },
  { id: "book",    label: "Books",    emoji: "📖" },
];

export default function MemoriesPage() {
  const [memories,   setMemories]   = useState<Memory[]>([]);
  const [children,   setChildren]   = useState<Child[]>([]);
  const [activeType, setActiveType] = useState("all");
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [modalType,  setModalType]  = useState<"photo" | "project" | "book">("photo");

  // New memory form state
  const [formTitle,  setFormTitle]  = useState("");
  const [formDesc,   setFormDesc]   = useState("");
  const [formChild,  setFormChild]  = useState("");
  const [formDate,   setFormDate]   = useState(new Date().toISOString().split("T")[0]);
  const [formAuthor, setFormAuthor] = useState("");
  const [saving,     setSaving]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: kids } = await supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("sort_order");
      setChildren(kids ?? []);

      // Load memories from app_events
      const { data: events } = await supabase
        .from("app_events")
        .select("id, type, payload, created_at")
        .eq("user_id", user.id)
        .in("type", ["memory_photo", "memory_project", "memory_book"])
        .order("created_at", { ascending: false });

      setMemories((events as unknown as Memory[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function saveMemory() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const type = `memory_${modalType}` as string;
    const payload: Memory["payload"] = {
      title:    formTitle,
      date:     formDate,
      child_id: formChild || undefined,
    };
    if (formDesc)   payload.description = formDesc;
    if (formAuthor) payload.author      = formAuthor;

    const { data } = await supabase
      .from("app_events")
      .insert({ user_id: user.id, type, payload })
      .select()
      .single();

    if (data) {
      setMemories((prev) => [data as unknown as Memory, ...prev]);
    }

    setFormTitle(""); setFormDesc(""); setFormChild("");
    setFormAuthor(""); setFormDate(new Date().toISOString().split("T")[0]);
    setSaving(false);
    setShowModal(false);
  }

  function openModal(type: "photo" | "project" | "book") {
    setModalType(type);
    setShowModal(true);
  }

  const filteredMemories = memories.filter((m) => {
    if (activeType === "all") return true;
    return m.type === `memory_${activeType}`;
  });

  const childName = (id?: string) =>
    id ? (children.find((c) => c.id === id)?.name ?? "") : "";

  const typeLabel = (type: string) => {
    if (type === "memory_photo")   return { emoji: "📷", label: "Photo",   bg: "#f0f4ff" };
    if (type === "memory_project") return { emoji: "📁", label: "Project", bg: "#f5ede0" };
    if (type === "memory_book")    return { emoji: "📖", label: "Book",    bg: "#e8f0e9" };
    return { emoji: "✨", label: "Memory", bg: "#fefcf9" };
  };

  return (
    <div className="max-w-3xl px-4 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Your Family Story
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Memories 📷</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Capture photos, projects, and books. Create a keepsake your family will treasure.
        </p>
      </div>

      {/* Add buttons */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { type: "photo"   as const, icon: Camera,    label: "Add Photo",   color: "#5c7f63" },
          { type: "project" as const, icon: FolderOpen, label: "Log Project", color: "#8b6f47" },
          { type: "book"    as const, icon: BookOpen,  label: "Log Book",    color: "#4a7a8a" },
        ].map(({ type, icon: Icon, label, color }) => (
          <button
            key={type}
            onClick={() => openModal(type)}
            className="flex flex-col items-center gap-2 bg-[#fefcf9] border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#f8f5f0] rounded-2xl p-4 transition-colors"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: color + "20" }}>
              <Icon size={18} style={{ color }} strokeWidth={1.8} />
            </div>
            <span className="text-xs font-medium text-[#2d2926]">{label}</span>
          </button>
        ))}
      </div>

      {/* AI Summary teaser */}
      <div className="bg-gradient-to-br from-[#e8f0e9] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#5c7f63] flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[#2d2926] text-sm mb-0.5">AI Year in Review</h3>
            <p className="text-xs text-[#7a6f65] leading-relaxed">
              Once you&apos;ve logged memories throughout the year, Rooted will automatically generate
              a beautiful Year in Review — with photos, stats, highlights, and a story of your family&apos;s journey.
            </p>
            <span className="inline-block mt-2 text-[10px] font-semibold text-[#5c7f63] bg-white/60 px-2.5 py-1 rounded-full">
              Coming soon
            </span>
          </div>
        </div>
      </div>

      {/* Export */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex items-center gap-4">
        <div className="w-9 h-9 rounded-xl bg-[#f5ede0] flex items-center justify-center shrink-0">
          <Download size={16} className="text-[#8b6f47]" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-[#2d2926] text-sm mb-0.5">Share with Grandparents</h3>
          <p className="text-xs text-[#7a6f65]">
            Export a beautiful PDF of your memories to share with family.
          </p>
          <span className="inline-block mt-1 text-[10px] font-semibold text-[#8b6f47] bg-[#f5ede0] px-2.5 py-1 rounded-full">
            Coming soon
          </span>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        {MEMORY_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveType(t.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeType === t.id
                ? "bg-[#5c7f63] text-white"
                : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Memory grid */}
      {loading ? (
        <div className="text-center py-8">
          <span className="text-2xl animate-pulse">📷</span>
        </div>
      ) : filteredMemories.length === 0 ? (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
          <span className="text-4xl mb-3">🌸</span>
          <p className="font-medium text-[#2d2926] mb-1">No memories yet</p>
          <p className="text-sm text-[#7a6f65] max-w-xs">
            Start logging photos, projects, and books to build your family&apos;s story.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMemories.map((m) => {
            const { emoji, label, bg } = typeLabel(m.type);
            const p = m.payload;
            return (
              <div key={m.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 flex gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ backgroundColor: bg }}
                >
                  {emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm text-[#2d2926] truncate">
                      {p.title ?? "Untitled"}
                    </p>
                    <span className="text-[10px] text-[#b5aca4] shrink-0">
                      {p.date ?? new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {p.description && (
                    <p className="text-xs text-[#7a6f65] mt-0.5 line-clamp-2">{p.description}</p>
                  )}
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                      {label}
                    </span>
                    {p.child_id && (
                      <span className="text-[10px] bg-[#e8f0e9] text-[#5c7f63] px-2 py-0.5 rounded-full">
                        {childName(p.child_id)}
                      </span>
                    )}
                    {p.author && (
                      <span className="text-[10px] text-[#b5aca4]">by {p.author}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Memory Modal ──────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">
                {modalType === "photo"   && "📷 Add Photo Memory"}
                {modalType === "project" && "📁 Log a Project"}
                {modalType === "book"    && "📖 Log a Book"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1">
                  {modalType === "book" ? "Book title *" : "Title *"}
                </label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={modalType === "book" ? "e.g. Charlotte's Web" : "e.g. Volcano Science Project"}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>

              {modalType === "book" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1">Author</label>
                  <input
                    value={formAuthor}
                    onChange={(e) => setFormAuthor(e.target.value)}
                    placeholder="e.g. E.B. White"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
              )}

              {modalType !== "book" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1">Description</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="What did you do? What was learned?"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1">Date</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  />
                </div>
                {children.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1">Child</label>
                    <select
                      value={formChild}
                      onChange={(e) => setFormChild(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                    >
                      <option value="">All children</option>
                      {children.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Photo upload (future) */}
              {modalType === "photo" && (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-[#e8e2d9] rounded-xl p-4 text-center cursor-pointer hover:border-[#5c7f63] transition-colors"
                >
                  <Camera size={20} className="mx-auto text-[#b5aca4] mb-1" />
                  <p className="text-xs text-[#b5aca4]">Tap to attach a photo</p>
                  <p className="text-[10px] text-[#c8bfb5] mt-0.5">Photo storage coming soon</p>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" />
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveMemory}
                disabled={saving || !formTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Save Memory"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
