"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Camera, BookOpen, FolderOpen, Sparkles, Download, X, ImageIcon, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import PaywallCard from "@/components/PaywallCard";

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

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMORY_TYPES = [
  { id: "all",     label: "All",      emoji: "✨" },
  { id: "photo",   label: "Photos",   emoji: "📷" },
  { id: "project", label: "Projects", emoji: "📁" },
  { id: "book",    label: "Books",    emoji: "📖" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MemoriesPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const [memories,    setMemories]    = useState<Memory[]>([]);
  const [children,    setChildren]    = useState<Child[]>([]);
  const [activeType,  setActiveType]  = useState("all");
  const [loading,     setLoading]     = useState(true);
  const [isPro,       setIsPro]       = useState<boolean | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [modalType,   setModalType]   = useState<"photo" | "project" | "book">("photo");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Form state
  const [formTitle,   setFormTitle]   = useState("");
  const [formDesc,    setFormDesc]    = useState("");
  const [formChild,   setFormChild]   = useState("");
  const [formDate,    setFormDate]    = useState(new Date().toISOString().split("T")[0]);
  const [formAuthor,  setFormAuthor]  = useState("");
  const [formFile,    setFormFile]    = useState<File | null>(null);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: kids }, { data: events }, { data: profile }] = await Promise.all([
      supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order"),
      supabase
        .from("app_events")
        .select("id, type, payload, created_at")
        .eq("user_id", effectiveUserId)
        .in("type", ["memory_photo", "memory_project", "memory_book"])
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("is_pro").eq("id", effectiveUserId).single(),
    ]);

    setChildren(kids ?? []);
    setMemories((events as unknown as Memory[]) ?? []);
    setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { load(); }, [load]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const childName = (id?: string) =>
    id ? (children.find((c) => c.id === id)?.name ?? "") : "";

  const childColor = (id?: string) =>
    id ? (children.find((c) => c.id === id)?.color ?? "#5c7f63") : "#5c7f63";

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadError(null);
  }

  function openModal(type: "photo" | "project" | "book") {
    setModalType(type);
    setFormTitle(""); setFormDesc(""); setFormChild(""); setFormAuthor("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormFile(null); setPreviewUrl(null); setUploadError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setFormFile(null);
    setPreviewUrl(null);
    setUploadError(null);
  }

  // ── Save memory ─────────────────────────────────────────────────────────────

  async function saveMemory() {
    if (!formTitle.trim() && modalType !== "photo") return;
    if (modalType === "photo" && !formFile && !formTitle.trim()) return;

    setSaving(true);
    setUploadError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    // Upload photo if provided
    let photoUrl: string | undefined;
    if (modalType === "photo" && formFile) {
      const ext = formFile.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("memories")
        .upload(path, formFile, { contentType: formFile.type, upsert: false });

      if (uploadErr) {
        setUploadError(
          uploadErr.message.includes("Bucket not found")
            ? "Storage not set up yet. Create a public bucket named 'memories' in your Supabase dashboard."
            : `Upload failed: ${uploadErr.message}`
        );
        setSaving(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("memories").getPublicUrl(path);
      photoUrl = urlData.publicUrl;
    }

    const payload: Memory["payload"] = {
      title:     formTitle.trim() || (formFile?.name ?? "Photo"),
      date:      formDate,
      child_id:  formChild || undefined,
      photo_url: photoUrl,
    };
    if (formDesc)   payload.description = formDesc;
    if (formAuthor) payload.author      = formAuthor;

    const { data } = await supabase
      .from("app_events")
      .insert({ user_id: user.id, type: `memory_${modalType}`, payload })
      .select()
      .single();

    if (data) setMemories((prev) => [data as unknown as Memory, ...prev]);

    setSaving(false);
    closeModal();
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const filteredMemories = memories.filter((m) =>
    activeType === "all" ? true : m.type === `memory_${activeType}`
  );

  const gridPhotos = filteredMemories.filter(
    (m) => m.type === "memory_photo" && m.payload.photo_url
  );
  const listItems = filteredMemories.filter(
    (m) => !(m.type === "memory_photo" && m.payload.photo_url)
  );

  // ── Render ───────────────────────────────────────────────────────────────────

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
      {!isPartner && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { type: "photo"   as const, icon: Camera,     label: "Add Photo",   color: "#5c7f63" },
            { type: "project" as const, icon: FolderOpen,  label: "Log Project", color: "#8b6f47" },
            { type: "book"    as const, icon: BookOpen,   label: "Log Book",    color: "#4a7a8a" },
          ].map(({ type, icon: Icon, label, color }) => (
            <button
              key={type}
              onClick={() => openModal(type)}
              className="flex flex-col items-center gap-2 bg-[#fefcf9] border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#f8f5f0] rounded-2xl p-4 transition-colors"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: color + "20" }}
              >
                <Icon size={18} style={{ color }} strokeWidth={1.8} />
              </div>
              <span className="text-xs font-medium text-[#2d2926]">{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* AI Year in Review — live feature */}
      <Link
        href="/dashboard/year-in-review"
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
              Open Year in Review <ArrowRight size={10} />
            </span>
          </div>
          <Download size={16} className="text-[#5c7f63] shrink-0 mt-0.5" />
        </div>
      </Link>


      {/* Type filter tabs */}
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

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12">
          <span className="text-3xl animate-pulse">📷</span>
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
        <div className="space-y-6">

          {/* Photo grid */}
          {gridPhotos.length > 0 && (
            <div>
              {activeType === "all" && (
                <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
                  Photos
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {gridPhotos.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setLightboxUrl(m.payload.photo_url!)}
                    className="group relative rounded-2xl overflow-hidden aspect-square bg-[#f0ede8] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]"
                  >
                    {/* Photo */}
                    <img
                      src={m.payload.photo_url}
                      alt={m.payload.title ?? "Memory photo"}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    {/* Caption on hover */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200">
                      {m.payload.title && (
                        <p className="text-white text-xs font-semibold leading-snug line-clamp-2">
                          {m.payload.title}
                        </p>
                      )}
                      {m.payload.child_id && (
                        <span
                          className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: childColor(m.payload.child_id) + "cc" }}
                        >
                          {childName(m.payload.child_id)}
                        </span>
                      )}
                    </div>
                    {/* Date badge */}
                    {m.payload.date && (
                      <div className="absolute top-2 right-2 bg-black/40 text-white text-[10px] px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(m.payload.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* List items (projects, books, photos without url) */}
          {listItems.length > 0 && (
            <div>
              {activeType === "all" && gridPhotos.length > 0 && (
                <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
                  Projects &amp; Books
                </p>
              )}
              <div className="space-y-2.5">
                {listItems.map((m) => {
                  const isPhoto   = m.type === "memory_photo";
                  const isProject = m.type === "memory_project";
                  const isBook    = m.type === "memory_book";
                  const emoji = isPhoto ? "📷" : isProject ? "📁" : "📖";
                  const bg    = isPhoto ? "#f0f4ff" : isProject ? "#f5ede0" : "#e8f0e9";
                  const label = isPhoto ? "Photo" : isProject ? "Project" : "Book";
                  const p = m.payload;
                  return (
                    <div
                      key={m.id}
                      className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 flex gap-3"
                    >
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
                            {p.date
                              ? new Date(p.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                              : new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                        {p.description && (
                          <p className="text-xs text-[#7a6f65] mt-0.5 line-clamp-2">{p.description}</p>
                        )}
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                            {label}
                          </span>
                          {p.child_id && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full text-white"
                              style={{ backgroundColor: childColor(p.child_id) }}
                            >
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
            </div>
          )}
        </div>
      )}

      {/* ── Lightbox ────────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/85 z-[60] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
            aria-label="Close"
          >
            <X size={28} />
          </button>
          <img
            src={lightboxUrl}
            alt="Memory"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Add Memory Modal ─────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">
                {modalType === "photo"   && "📷 Add Photo Memory"}
                {modalType === "project" && "📁 Log a Project"}
                {modalType === "book"    && "📖 Log a Book"}
              </h2>
              <button onClick={closeModal} className="text-[#b5aca4] hover:text-[#7a6f65]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">

              {/* Photo upload zone */}
              {modalType === "photo" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Photo</label>
                  {previewUrl ? (
                    <div className="relative rounded-2xl overflow-hidden bg-[#f0ede8]">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full max-h-48 object-cover"
                      />
                      <button
                        onClick={() => { setFormFile(null); setPreviewUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
                        aria-label="Remove photo"
                      >
                        <X size={14} />
                      </button>
                      <div className="absolute bottom-2 left-2 bg-black/40 text-white text-[10px] px-2 py-0.5 rounded-full">
                        {formFile?.name}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-[#e8e2d9] hover:border-[#5c7f63] rounded-2xl p-8 text-center cursor-pointer transition-colors group"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#e8f0e9] flex items-center justify-center mx-auto mb-2 group-hover:bg-[#d4ead4] transition-colors">
                        <ImageIcon size={20} className="text-[#5c7f63]" />
                      </div>
                      <p className="text-sm font-medium text-[#2d2926] mb-0.5">
                        Click to choose a photo
                      </p>
                      <p className="text-xs text-[#b5aca4]">JPG, PNG, HEIC up to 10 MB</p>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  {uploadError && (
                    <p className="text-xs text-red-500 mt-1.5 bg-red-50 rounded-xl px-3 py-2">
                      {uploadError}
                    </p>
                  )}
                </div>
              )}

              {/* Caption / Title */}
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                  {modalType === "photo" ? "Caption" : modalType === "book" ? "Book title *" : "Title *"}
                </label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={
                    modalType === "photo"   ? "e.g. First day of nature study" :
                    modalType === "book"    ? "e.g. Charlotte's Web" :
                                             "e.g. Volcano Science Project"
                  }
                  autoFocus={modalType !== "photo"}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>

              {/* Book author */}
              {modalType === "book" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Author</label>
                  <input
                    value={formAuthor}
                    onChange={(e) => setFormAuthor(e.target.value)}
                    placeholder="e.g. E.B. White"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
              )}

              {/* Description */}
              {modalType !== "book" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                    {modalType === "photo" ? "Notes (optional)" : "Description"}
                  </label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder={modalType === "photo" ? "What was happening in this photo?" : "What did you do? What was learned?"}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                  />
                </div>
              )}

              {/* Date + Child row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Date</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  />
                </div>
                {children.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
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
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveMemory}
                disabled={
                  saving ||
                  (modalType === "photo"   && !formFile && !formTitle.trim()) ||
                  (modalType !== "photo"   && !formTitle.trim())
                }
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving
                  ? (modalType === "photo" && formFile ? "Uploading…" : "Saving…")
                  : "Save Memory"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
