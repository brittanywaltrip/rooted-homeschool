"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Memory = {
  id: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  child_id: string | null;
};

type Child = { id: string; name: string; color: string | null };

const TYPE_EMOJI: Record<string, string> = {
  photo: "📷", drawing: "🎨", book: "📖", win: "🏆",
  quote: "🗒️", project: "🔬", field_trip: "🗺️", activity: "🎵", moment: "✨",
};

const TYPE_GRADIENT: Record<string, string> = {
  book: "linear-gradient(135deg, #F5E6C8, #E8C87A)",
  win: "linear-gradient(135deg, #FDE8A0, #F5C842)",
  drawing: "linear-gradient(135deg, #E8D5F5, #C9A8E8)",
  quote: "linear-gradient(135deg, #F0E4F8, #D4B8E8)",
  project: "linear-gradient(135deg, #C8E6C8, #7BAE7F)",
  field_trip: "linear-gradient(135deg, #C8E6C8, #7BAE7F)",
  activity: "linear-gradient(135deg, #C8E6C8, #7BAE7F)",
  moment: "linear-gradient(135deg, #e8f0e9, #b8d4ba)",
};

const REACTION_EMOJIS = ["🥹", "❤️", "😂", "🙌", "😍"];

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
    "en-US", { month: "long", day: "numeric" }
  );
}

export default function FamilyPreviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [{ data: profile }, { data: kids }, { data: mems }] = await Promise.all([
        supabase.from("profiles").select("display_name, family_photo_url").eq("id", user.id).single(),
        supabase.from("children").select("id, name, color").eq("user_id", user.id).eq("archived", false).order("sort_order"),
        supabase.from("memories")
          .select("id, type, title, caption, photo_url, date, child_id")
          .eq("user_id", user.id)
          .eq("family_visible", true)
          .order("date", { ascending: false })
          .limit(50),
      ]);

      setFamilyName(profile?.display_name ?? "Our Family");
      setChildren((kids ?? []) as Child[]);
      setMemories((mems ?? []) as Memory[]);
      setLoading(false);
    })();
  }, [router]);

  const childName = (id: string | null) =>
    id ? children.find((c) => c.id === id)?.name ?? "" : "";

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8f7f4]">
        <div className="w-full px-5 pt-8 pb-6" style={{ backgroundColor: "var(--g-brand)" }}>
          <div className="max-w-[480px] mx-auto">
            <div className="h-7 w-56 bg-white/20 rounded mb-2 animate-pulse" />
            <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-[480px] mx-auto px-4 pt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[#e8e2d9] rounded-2xl h-72 animate-pulse" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4] pb-24">
      {/* ── Preview banner ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-[var(--g-deep)] text-white text-sm py-3 px-5 flex items-center justify-between">
        <Link href="/dashboard/settings" className="text-white/80 hover:text-white text-sm shrink-0">
          ← Back to Settings
        </Link>
        <span className="text-xs text-white/70 text-center flex-1 px-2">
          👁 Preview — this is what your family sees
        </span>
        <div className="w-20 shrink-0" />
      </div>

      {/* ── Header (same as real portal) ────────────────────────────── */}
      <header className="w-full" style={{ backgroundColor: "var(--g-brand)", padding: "32px 20px 24px" }}>
        <div className="max-w-[480px] mx-auto">
          <h1 className="text-2xl text-white leading-tight" style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
            {familyName} 🌿
          </h1>
          {children.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {children.map((c) => (
                <span key={c.id} className="px-2.5 py-0.5 rounded-full text-xs text-white/80 bg-white/15">
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ── Memory Feed ─────────────────────────────────────────────── */}
      <div className="max-w-[480px] mx-auto px-4 pt-5 space-y-4">
        {memories.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm text-[#7a6f65]">No family-visible memories yet.</p>
            <p className="text-xs text-[#b5aca4] mt-1">Memories are visible by default — check your privacy settings.</p>
          </div>
        ) : (
          memories.map((mem) => (
            <div key={mem.id} className="bg-[#fefcf9] rounded-2xl border border-[#e8e2d9] overflow-hidden shadow-sm">
              {/* Photo or type tile */}
              {mem.photo_url ? (
                <button className="w-full" onClick={() => setLightboxUrl(mem.photo_url)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mem.photo_url} alt={mem.title ?? "Memory"} className="w-full object-cover" loading="lazy" style={{ maxHeight: 400 }} />
                </button>
              ) : (
                <div
                  className="w-full flex flex-col items-center justify-center py-12 relative"
                  style={{
                    background: TYPE_GRADIENT[mem.type] ?? TYPE_GRADIENT.moment,
                    backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.04) 0.5px, transparent 0.5px), ${TYPE_GRADIENT[mem.type] ?? TYPE_GRADIENT.moment}`,
                    backgroundSize: "8px 8px, 100% 100%",
                  }}
                >
                  <span className="text-5xl mb-2">{TYPE_EMOJI[mem.type] ?? "📷"}</span>
                  {mem.title && (
                    <p className="text-sm font-medium text-[#2d2926] text-center px-4">{mem.title}</p>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="px-4 py-3 space-y-2">
                <p className="text-xs text-[#7a6f65]">
                  {childName(mem.child_id) && <><span className="font-medium text-[#2d2926]">{childName(mem.child_id)}</span> · </>}
                  {formatDate(mem.date)}
                </p>

                {mem.caption && <p className="text-sm text-[#2d2926] leading-relaxed">{mem.caption}</p>}

                {/* Reaction bar — visible but disabled */}
                <div className="flex items-center gap-1.5 pt-1 opacity-60 pointer-events-none">
                  {REACTION_EMOJIS.map((emoji) => (
                    <span
                      key={emoji}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm"
                      style={{ backgroundColor: "#f5f3f0", border: "1.5px solid transparent" }}
                    >
                      {emoji}
                    </span>
                  ))}
                </div>

                {/* Comment input — visible but disabled */}
                <div className="flex gap-2 pt-1 opacity-60 pointer-events-none">
                  <input
                    type="text" readOnly placeholder="Leave a comment..."
                    className="flex-1 px-3 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-xs text-[#2d2926] placeholder:text-[#c8bfb5]"
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl z-10" onClick={() => setLightboxUrl(null)}>×</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-w-full max-h-[90vh] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#fefcf9] border-t border-[#e8e2d9] py-2.5 px-4 z-30" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-[480px] mx-auto text-center">
          <p className="text-xs text-[#7a6f65]">
            You&apos;re previewing {familyName}&apos;s family view 🌿
          </p>
        </div>
      </div>
    </main>
  );
}
