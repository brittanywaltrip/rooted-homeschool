"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

type Child = { id: string; name: string; color: string | null };
type PhotoEvent = { id: string; payload: { photo_url?: string; title?: string; date?: string } };

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function YearbookPage() {
  const { effectiveUserId } = usePartner();
  const router = useRouter();

  const [children, setChildren]   = useState<Child[]>([]);
  const [photos, setPhotos]       = useState<PhotoEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const currentYear = new Date().getFullYear();
  const [bookTitle, setBookTitle] = useState(`${currentYear - 1}–${currentYear} School Year`);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [bookType, setBookType]   = useState<"family" | "individual">("family");
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySaved, setNotifySaved] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const [{ data: profile }, { data: kids }, { data: memPhotos }] = await Promise.all([
        supabase.from("profiles").select("school_year_start, school_year_end, email").eq("id", effectiveUserId).maybeSingle(),
        supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("app_events").select("id, payload").eq("user_id", effectiveUserId).eq("type", "memory_photo").order("created_at", { ascending: false }).limit(12),
      ]);

      const p = profile as { school_year_start?: string; school_year_end?: string; email?: string } | null;
      const defaultStart = p?.school_year_start ?? `${new Date().getMonth() >= 7 ? currentYear : currentYear - 1}-08-01`;
      const defaultEnd = p?.school_year_end ?? toDateStr(new Date());
      setStartDate(defaultStart);
      setEndDate(defaultEnd);

      const childList = (kids ?? []) as Child[];
      setChildren(childList);
      setSelectedChildren(new Set(childList.map((c) => c.id)));

      setPhotos((memPhotos ?? []) as PhotoEvent[]);
      setLoading(false);
    }
    load();
  }, [effectiveUserId, currentYear]);

  function toggleChild(id: string) {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleNotify() {
    if (!notifyEmail.trim() || !effectiveUserId) return;
    await supabase.from("profiles").update({ yearbook_notify_email: notifyEmail.trim() }).eq("id", effectiveUserId);
    setNotifySaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-3xl animate-pulse">{"\uD83D\uDCD6"}</span>
      </div>
    );
  }

  // ── Submitted state — preview placeholder ─────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-6">
        <div className="text-5xl">{"\u2728"}</div>
        <h1 className="text-2xl font-bold text-[#2d2926]">Your yearbook is being prepared...</h1>

        {/* Mock book preview */}
        <div className="mx-auto w-56 h-72 rounded-2xl shadow-xl overflow-hidden border border-[#e8e2d9] relative" style={{ background: "linear-gradient(135deg, #3d5c42 0%, #5c7f63 100%)" }}>
          {coverPhotoUrl && (
            <img src={coverPhotoUrl} alt="Cover" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="text-3xl mb-3">{"\uD83C\uDF31"}</div>
            <p className="text-sm font-bold leading-tight">{bookTitle}</p>
            <p className="text-[10px] mt-1 opacity-70">Rooted Homeschool</p>
          </div>
        </div>

        <div className="bg-[#fef9e8] border border-[#f0dda8] rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold text-[#7a4a1a]">Full yearbook generator coming soon!</p>
          <p className="text-xs text-[#a08040]">You&apos;ll be notified when it&apos;s ready to download and share.</p>

          {notifySaved ? (
            <p className="text-sm text-[#5c7f63] font-medium">{"\u2713"} We&apos;ll notify you at {notifyEmail}</p>
          ) : (
            <div className="flex gap-2">
              <input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="Your email"
                className="flex-1 px-3 py-2 rounded-xl border border-[#f0dda8] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
              />
              <button
                onClick={handleNotify}
                disabled={!notifyEmail.trim()}
                className="px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                Notify me
              </button>
            </div>
          )}
        </div>

        <Link href="/dashboard/memories" className="inline-block text-sm text-[#5c7f63] font-medium hover:underline">
          {"\u2190"} Back to Memories
        </Link>
      </div>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890] mb-1">Create</p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Your Family Yearbook {"\uD83D\uDCD6"}</h1>
        <p className="text-sm text-[#7a6f65] mt-1">Turn this year&apos;s memories into a keepsake</p>
      </div>

      {/* Book title */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7a6f65]">Book title</label>
        <input
          value={bookTitle}
          onChange={(e) => setBookTitle(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
        />
      </div>

      {/* Date range */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7a6f65]">Date range</label>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
        </div>
      </div>

      {/* Book type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7a6f65]">Book type</label>
        <div className="grid grid-cols-2 gap-3">
          {([
            { id: "family" as const, emoji: "\uD83D\uDCD6", label: "Family Book", desc: "One book, everyone together" },
            { id: "individual" as const, emoji: "\uD83D\uDC67", label: "Individual Books", desc: "One book per child" },
          ]).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setBookType(opt.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                bookType === opt.id
                  ? "border-[#5c7f63] bg-[#f2f9f3]"
                  : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
              }`}
            >
              <span className="text-xl">{opt.emoji}</span>
              <p className="text-sm font-semibold text-[#2d2926] mt-1">{opt.label}</p>
              <p className="text-[10px] text-[#7a6f65] mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Include children */}
      {children.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7a6f65]">Include children</label>
          <div className="flex flex-wrap gap-2">
            {children.map((child) => {
              const selected = selectedChildren.has(child.id);
              return (
                <button
                  key={child.id}
                  onClick={() => toggleChild(child.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all ${
                    selected
                      ? "border-[#5c7f63] bg-[#f2f9f3]"
                      : "border-[#e8e2d9] bg-white opacity-50"
                  }`}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ backgroundColor: child.color ?? "#5c7f63" }}
                  >
                    {child.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-[#2d2926]">{child.name}</span>
                  {selected && <Check size={14} className="text-[#5c7f63]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cover photo picker */}
      {photos.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7a6f65]">Cover photo</label>
          <p className="text-[10px] text-[#b5aca4] mb-2">Tap a photo to use as the cover</p>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((p) => {
              const url = p.payload?.photo_url;
              if (!url) return null;
              const isSelected = coverPhotoUrl === url;
              return (
                <button
                  key={p.id}
                  onClick={() => setCoverPhotoUrl(isSelected ? null : url)}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                    isSelected ? "border-[#5c7f63] ring-2 ring-[#5c7f63]/30" : "border-transparent hover:border-[#e8e2d9]"
                  }`}
                >
                  <img src={url} alt={p.payload?.title ?? "Memory"} className="w-full h-full object-cover" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-[#3d5c42]/40 flex items-center justify-center">
                      <Check size={24} className="text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview button */}
      <button
        onClick={() => setSubmitted(true)}
        disabled={selectedChildren.size === 0}
        className="w-full py-3.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-semibold transition-colors shadow-sm"
      >
        Preview My Yearbook {"\u2192"}
      </button>

      <p className="text-[10px] text-[#b5aca4] text-center">
        Your data stays private. The yearbook is generated just for you.
      </p>
    </div>
  );
}
