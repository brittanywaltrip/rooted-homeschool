"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Camera, ChevronRight, Check, BookOpen, Users } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import { posthog } from "@/lib/posthog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };
type Memory = {
  id: string;
  type: string;
  payload: {
    title?: string;
    description?: string;
    photo_url?: string;
    child_id?: string;
    date?: string;
  };
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function schoolYearLabel(startStr: string | null, endStr: string | null): string {
  if (startStr && endStr) {
    const sy = new Date(startStr + "T12:00:00").getFullYear();
    const ey = new Date(endStr + "T12:00:00").getFullYear();
    if (sy !== ey) return `${sy}–${ey}`;
    return String(sy);
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return m >= 7 ? `${y}–${y + 1}` : `${y - 1}–${y}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function YearbookPage() {
  const { isPartner, effectiveUserId } = usePartner();

  useEffect(() => { document.title = "Yearbook \u00b7 Rooted"; }, []);

  // Data
  const [children, setChildren] = useState<Child[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile
  const [profileStart, setProfileStart] = useState<string | null>(null);
  const [profileEnd, setProfileEnd] = useState<string | null>(null);
  const [planType, setPlanType] = useState<string | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);
  const previewFree = typeof window !== 'undefined' && window.location.search.includes('previewFree=true');
  const isFreeUser = planLoaded && (!planType || planType === "free") || previewFree;

  // Form state
  const [yearTitle, setYearTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);

  // Submitted state
  const [submitted, setSubmitted] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: profile }, { data: kids }, { data: events }] = await Promise.all([
      supabase
        .from("profiles")
        .select("school_year_start, school_year_end, plan_type")
        .eq("id", effectiveUserId)
        .maybeSingle(),
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
        .in("type", ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"])
        .order("created_at", { ascending: false }),
    ]);

    const p = profile as { school_year_start?: string; school_year_end?: string; plan_type?: string } | null;
    const syStart = p?.school_year_start ?? null;
    const syEnd = p?.school_year_end ?? null;
    setPlanType(p?.plan_type ?? null);
    setPlanLoaded(true);

    setProfileStart(syStart);
    setProfileEnd(syEnd);
    setYearTitle(schoolYearLabel(syStart, syEnd));
    setStartDate(syStart ?? "");
    setEndDate(syEnd ?? "");

    const kidList = (kids ?? []) as Child[];
    setChildren(kidList);
    setSelectedChildren(new Set(kidList.map((c) => c.id)));

    setMemories(((events as unknown as Memory[]) ?? []).filter((m) => m.payload?.photo_url));
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { load(); }, [load]);

  // ── Free user gate tracking (must be before any conditional returns) ──────
  const gateTracked = useRef(false);
  useEffect(() => {
    if (!loading && isFreeUser && !gateTracked.current) {
      gateTracked.current = true;
      posthog.capture('upgrade_page_viewed', { source: 'yearbook_gate' });
    }
  }, [loading, isFreeUser]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const photoMemories = memories;
  const coverPhoto = coverPhotoId ? photoMemories.find((m) => m.id === coverPhotoId) : null;

  const toggleChild = (id: string) => {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = yearTitle.trim() && selectedChildren.size > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <PageHero overline="Yearbook" title="Your Yearbook" />
        <div className="flex items-center justify-center py-20">
          <span className="text-4xl animate-pulse">📖</span>
        </div>
      </>
    );
  }

  // Free users can access the yearbook setup (reader enforces preview limit)

  // ── Submitted: preparation screen ─────────────────────────────────────────

  if (submitted) {
    return (
      <>
        <PageHero overline="Yearbook" title="Your Yearbook" subtitle="A keepsake of your learning journey" />
        <div className="px-5 pt-6 pb-10 space-y-6 max-w-2xl">

          {/* Preparing message */}
          <div className="bg-white border border-[#e8e2d9] rounded-2xl p-8 text-center space-y-4">
            <p className="text-4xl">✨</p>
            <h2 className="text-xl font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
              Your yearbook is being prepared...
            </h2>
            <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto">
              We&apos;re gathering your memories, photos, and milestones from this school year to create something beautiful.
            </p>
            <div className="flex items-center justify-center gap-1.5 pt-2">
              <div className="w-2 h-2 rounded-full bg-[#5c7f63] animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#5c7f63] animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#5c7f63] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>

          {/* Static book mockup preview */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">Preview</p>

            {/* Book cover mockup */}
            <div
              className="relative rounded-2xl overflow-hidden shadow-lg"
              style={{ aspectRatio: "3/4", maxWidth: "320px", margin: "0 auto" }}
            >
              {/* Cover image or gradient */}
              {coverPhoto?.payload?.photo_url ? (
                <img
                  src={coverPhoto.payload.photo_url}
                  alt="Yearbook cover"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#3d5c42] via-[#5c7f63] to-[#7a9e7e]" />
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

              {/* Title content */}
              <div className="absolute inset-0 flex flex-col items-center justify-end p-8 pb-12 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60 mb-2">
                  Our Homeschool Year
                </p>
                <h3
                  className="text-2xl font-bold text-white leading-tight mb-3"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {yearTitle}
                </h3>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {children
                    .filter((c) => selectedChildren.has(c.id))
                    .map((c) => (
                      <span
                        key={c.id}
                        className="text-xs font-medium text-white/90 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full"
                      >
                        {c.name}
                      </span>
                    ))}
                </div>
              </div>

              {/* Decorative spine */}
              <div className="absolute left-0 inset-y-0 w-3 bg-black/10" />
            </div>

            {/* Page preview strips */}
            <div className="flex gap-2 justify-center pt-2">
              {["Memories", "Milestones", "Growth", "Gallery"].map((section) => (
                <div
                  key={section}
                  className="bg-white border border-[#e8e2d9] rounded-xl px-3 py-2 text-center"
                  style={{ minWidth: "72px" }}
                >
                  <p className="text-[9px] font-semibold text-[#b5aca4] uppercase tracking-wider">{section}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="bg-[#e8f0e9] border border-[#c8dcc9] rounded-2xl p-4 text-center">
            <p className="text-sm text-[#3d5c42] font-medium">
              We&apos;ll notify you when your yearbook preview is ready to view and customize.
            </p>
          </div>

          {/* Back button */}
          <button
            onClick={() => setSubmitted(false)}
            className="text-sm font-semibold text-[#5c7f63] hover:text-[#3d5c42] transition-colors"
          >
            ← Back to setup
          </button>
        </div>
      </>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────

  return (
    <>
      <PageHero overline="Yearbook" title="Create Your Yearbook" subtitle="Turn this year's memories into a keepsake" />
      <div className="px-5 pt-6 pb-10 space-y-6 max-w-2xl">

        {/* 1. School year title */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">
            School Year Title
          </label>
          <input
            type="text"
            value={yearTitle}
            onChange={(e) => setYearTitle(e.target.value)}
            placeholder="2025–2026"
            className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] font-semibold focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition-colors"
          />
        </div>

        {/* 2. Date pickers */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition-colors"
            />
          </div>
        </div>

        {/* 3. Children checkboxes */}
        {children.length > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">
              Include Children
            </label>
            <div className="space-y-2">
              {children.map((child) => {
                const isSelected = selectedChildren.has(child.id);
                return (
                  <button
                    key={child.id}
                    onClick={() => toggleChild(child.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? "border-[#5c7f63] bg-[#e8f0e9]"
                        : "border-[#e8e2d9] bg-white hover:border-[#c8bfb5]"
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
                      style={{ backgroundColor: child.color ?? "#5c7f63" }}
                    >
                      {child.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm font-semibold text-[#2d2926]">{child.name}</span>
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-[#5c7f63] border-[#5c7f63]"
                          : "border-[#c8bfb5] bg-white"
                      }`}
                    >
                      {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Cover photo picker */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">
            Cover Photo
          </label>
          {coverPhoto?.payload?.photo_url ? (
            <div className="relative">
              <img
                src={coverPhoto.payload.photo_url}
                alt="Selected cover"
                className="w-full h-48 object-cover rounded-xl border border-[#e8e2d9]"
              />
              <div className="absolute bottom-3 right-3 flex gap-2">
                <button
                  onClick={() => setShowPhotoPicker(true)}
                  className="bg-white/90 backdrop-blur-sm text-[#2d2926] text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm hover:bg-white transition-colors"
                >
                  Change
                </button>
                <button
                  onClick={() => setCoverPhotoId(null)}
                  className="bg-white/90 backdrop-blur-sm text-red-500 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm hover:bg-white transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowPhotoPicker(true)}
              className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-[#d8d2c9] bg-[#faf9f7] hover:border-[#5c7f63] hover:bg-[#f0f7f1] transition-colors"
            >
              <Camera size={24} className="text-[#b5aca4]" />
              <span className="text-sm font-medium text-[#7a6f65]">
                {photoMemories.length > 0 ? "Choose from your memories" : "No photos yet — add some memories first!"}
              </span>
            </button>
          )}
        </div>

        {/* Photo picker modal */}
        {showPhotoPicker && photoMemories.length > 0 && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowPhotoPicker(false)} />
            <div className="fixed inset-x-4 top-[10%] bottom-[10%] z-50 bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden max-w-lg mx-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
                <h3 className="text-base font-bold text-[#2d2926]">Choose Cover Photo</h3>
                <button
                  onClick={() => setShowPhotoPicker(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-3 gap-2">
                  {photoMemories.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setCoverPhotoId(m.id); setShowPhotoPicker(false); }}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                        coverPhotoId === m.id ? "border-[#5c7f63] ring-2 ring-[#5c7f63]/30" : "border-transparent hover:border-[#c8bfb5]"
                      }`}
                    >
                      <img
                        src={m.payload.photo_url!}
                        alt={m.payload.title ?? "Memory photo"}
                        className="w-full h-full object-cover"
                      />
                      {coverPhotoId === m.id && (
                        <div className="absolute inset-0 bg-[#5c7f63]/20 flex items-center justify-center">
                          <Check size={24} className="text-white drop-shadow-lg" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                {photoMemories.length === 0 && (
                  <p className="text-sm text-[#7a6f65] text-center py-8">No photos found in your memories.</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Summary card */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">Summary</p>
          <div className="flex items-center gap-2 text-sm text-[#2d2926]">
            <BookOpen size={14} className="text-[#5c7f63]" />
            <span className="font-semibold">{yearTitle || "Untitled"}</span>
            <span className="text-[#b5aca4]">·</span>
            <span className="text-[#7a6f65]">Family Book</span>
          </div>
          <p className="text-xs text-[#7a6f65]">
            {photoMemories.length} {photoMemories.length === 1 ? "photo" : "photos"} available
            {selectedChildren.size > 0 && (
              <> · {children.filter((c) => selectedChildren.has(c.id)).map((c) => c.name).join(", ")}</>
            )}
          </p>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-all shadow-sm ${
            canSubmit
              ? "bg-[#5c7f63] hover:bg-[#3d5c42] text-white"
              : "bg-[#e8e2d9] text-[#b5aca4] cursor-not-allowed"
          }`}
        >
          Preview My Book
          <ChevronRight size={16} />
        </button>

        {selectedChildren.size === 0 && children.length > 0 && (
          <p className="text-xs text-center text-[#c4697a]">Select at least one child to continue</p>
        )}
      </div>
    </>
  );
}
