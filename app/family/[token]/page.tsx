"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Memory = {
  id: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  child_id: string | null;
};

type Reaction = { memory_id: string; count: number };

const TYPE_EMOJI: Record<string, string> = {
  photo: "📷", drawing: "🎨", book: "📖", win: "🏆",
  quote: "🗒️", project: "🔬", field_trip: "🗺️", activity: "🎵",
  moment: "✨",
};

const TYPE_BG: Record<string, string> = {
  book: "#fef5e4", win: "#e8f0e9", quote: "#f0ede8", drawing: "#fce8f4",
  project: "#e4f2fb", field_trip: "#e8f0e9", activity: "#fce8f4", moment: "#f0ede8",
};

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function FamilyViewPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [reactions, setReactions] = useState<Map<string, number>>(new Map());
  const [reactorName, setReactorName] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("rooted_reactor_name") || "";
    return "";
  });
  const [namePrompt, setNamePrompt] = useState<string | null>(null);
  const [hearted, setHearted] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<Memory | null>(null);

  useEffect(() => {
    async function load() {
      // Verify token
      const { data: invite } = await supabase
        .from("family_invites")
        .select("owner_user_id, accepted")
        .eq("token", token)
        .single();

      if (!invite) {
        setError("This invite link is invalid or has expired.");
        setLoading(false);
        return;
      }

      // Mark as accepted
      if (!invite.accepted) {
        await supabase.from("family_invites").update({ accepted: true }).eq("token", token);
      }

      // Fetch family name
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, first_name")
        .eq("id", invite.owner_user_id)
        .single();

      const name = profile?.display_name || profile?.first_name || "This family";
      setFamilyName(name.toLowerCase().endsWith("family") ? name : `The ${name} Family`);

      // Fetch shareable memories
      const { data: mems } = await supabase
        .from("memories")
        .select("id, type, title, caption, photo_url, date, child_id")
        .eq("user_id", invite.owner_user_id)
        .or("include_in_book.eq.true,type.eq.photo")
        .order("date", { ascending: false });

      setMemories((mems as Memory[]) ?? []);

      // Fetch reaction counts
      const memIds = (mems ?? []).map((m: { id: string }) => m.id);
      if (memIds.length > 0) {
        const { data: rxns } = await supabase
          .from("memory_reactions")
          .select("memory_id")
          .in("memory_id", memIds);

        const counts = new Map<string, number>();
        (rxns ?? []).forEach((r: { memory_id: string }) => {
          counts.set(r.memory_id, (counts.get(r.memory_id) ?? 0) + 1);
        });
        setReactions(counts);
      }

      setLoading(false);
    }
    load();
  }, [token]);

  async function handleHeart(memoryId: string) {
    if (!reactorName.trim()) {
      setNamePrompt(memoryId);
      return;
    }
    doHeart(memoryId);
  }

  async function doHeart(memoryId: string) {
    if (hearted.has(memoryId)) return;
    setHearted((prev) => new Set(prev).add(memoryId));
    setReactions((prev) => {
      const next = new Map(prev);
      next.set(memoryId, (next.get(memoryId) ?? 0) + 1);
      return next;
    });

    await supabase.from("memory_reactions").upsert(
      { memory_id: memoryId, reactor_email: `guest_${reactorName.trim().toLowerCase().replace(/\s+/g, "_")}`, reactor_name: reactorName.trim() },
      { onConflict: "memory_id,reactor_email" }
    );
  }

  function submitName(memoryId: string) {
    if (!reactorName.trim()) return;
    localStorage.setItem("rooted_reactor_name", reactorName.trim());
    setNamePrompt(null);
    doHeart(memoryId);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8f7f4]">
        <span className="text-3xl animate-pulse">🌿</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8f7f4] px-6">
        <div className="text-center">
          <div className="text-4xl mb-4">🌿</div>
          <p className="text-lg font-medium text-[#2d2926] mb-2">Hmm, something&apos;s not right</p>
          <p className="text-sm text-[#7a6f65]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      {/* Hero */}
      <div
        className="relative w-full px-6 pt-10 pb-8 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #2d5a3d 0%, #3d7a50 100%)" }}
      >
        <div className="absolute top-2 right-3 text-[100px] leading-none select-none pointer-events-none" style={{ opacity: 0.06 }} aria-hidden>🌿</div>
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: "#8cba8e" }}>
          Shared with you
        </p>
        <h1 className="text-[24px] font-bold leading-tight text-white" style={{ fontFamily: "var(--font-display)" }}>
          {familyName}&apos;s Story 🌿
        </h1>
        <p className="text-[13px] mt-1 italic" style={{ color: "rgba(255,255,255,0.6)" }}>
          {memories.length} {memories.length === 1 ? "memory" : "memories"} shared with love.
        </p>
      </div>

      {/* Grid */}
      <div className="max-w-3xl mx-auto px-4 pt-5 pb-12">
        {memories.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm text-[#7a6f65]">No memories shared yet. Check back soon!</p>
          </div>
        ) : (
          (() => {
            // Group by month
            const byMonth = new Map<string, Memory[]>();
            for (const m of memories) {
              const key = m.date.slice(0, 7);
              if (!byMonth.has(key)) byMonth.set(key, []);
              byMonth.get(key)!.push(m);
            }
            return (
              <div className="space-y-4">
                {[...byMonth.entries()].map(([month, monthMems]) => (
                  <div key={month}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-2 px-1">
                      {formatMonth(monthMems[0].date)}
                    </p>
                    <div className="grid grid-cols-3 gap-[2px] rounded-2xl overflow-hidden">
                      {monthMems.map((mem) => {
                        const hc = reactions.get(mem.id) ?? 0;
                        return (
                          <div key={mem.id} className="relative aspect-square bg-[#f0ede8] overflow-hidden group">
                            {mem.photo_url ? (
                              <button className="w-full h-full" onClick={() => setLightbox(mem)}>
                                <img src={mem.photo_url} alt={mem.title ?? "Memory"} className="w-full h-full object-cover" />
                              </button>
                            ) : (
                              <button
                                className="w-full h-full flex flex-col items-center justify-center px-2"
                                style={{ backgroundColor: TYPE_BG[mem.type] ?? "#f0ede8" }}
                                onClick={() => setLightbox(mem)}
                              >
                                <span className="text-3xl mb-1">{TYPE_EMOJI[mem.type] ?? "📷"}</span>
                                {mem.title && (
                                  <p className="text-[10px] text-[#7a6f65] text-center leading-tight line-clamp-2">{mem.title}</p>
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleHeart(mem.id)}
                              className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 bg-white/80 backdrop-blur-sm rounded-full px-1.5 py-0.5 text-xs shadow-sm hover:bg-white transition-colors"
                            >
                              <span className={hearted.has(mem.id) ? "text-red-500" : "text-[#c8bfb5]"}>❤️</span>
                              {hc > 0 && <span className="text-[10px] text-[#7a6f65] font-medium">{hc}</span>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl" onClick={() => setLightbox(null)}>×</button>
          <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            {lightbox.photo_url ? (
              <img src={lightbox.photo_url} alt={lightbox.title ?? ""} className="max-w-full max-h-[75vh] rounded-xl object-contain mx-auto" />
            ) : (
              <div className="bg-white rounded-xl p-8 text-center">
                <span className="text-6xl">{TYPE_EMOJI[lightbox.type] ?? "📷"}</span>
                {lightbox.title && <p className="text-lg font-medium text-[#2d2926] mt-4">{lightbox.title}</p>}
              </div>
            )}
            {(lightbox.title || lightbox.caption) && (
              <div className="mt-3 text-center">
                {lightbox.title && lightbox.photo_url && <p className="text-sm font-medium text-white">{lightbox.title}</p>}
                {lightbox.caption && <p className="text-xs text-white/60 mt-1">{lightbox.caption}</p>}
              </div>
            )}
            <div className="flex justify-center mt-4">
              <button
                onClick={() => handleHeart(lightbox.id)}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-4 py-2 transition-colors"
              >
                <span className={hearted.has(lightbox.id) ? "text-red-500" : "text-white/50"}>❤️</span>
                <span className="text-sm text-white">{(reactions.get(lightbox.id) ?? 0) > 0 ? `${reactions.get(lightbox.id)} hearts` : "Leave a heart"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Name prompt modal */}
      {namePrompt && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={() => setNamePrompt(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-4">
              <div className="text-center">
                <p className="text-lg font-bold text-[#2d2926]">What&apos;s your name?</p>
                <p className="text-xs text-[#7a6f65] mt-1">So the family knows who left a heart</p>
              </div>
              <input
                type="text"
                value={reactorName}
                onChange={(e) => setReactorName(e.target.value)}
                placeholder="Grandma, Uncle Mike, etc."
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                onKeyDown={(e) => { if (e.key === "Enter") submitName(namePrompt); }}
              />
              <button
                onClick={() => submitName(namePrompt)}
                disabled={!reactorName.trim()}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{ backgroundColor: "#2d5a3d" }}
              >
                Leave a heart ❤️
              </button>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="text-center pb-8">
        <p className="text-xs text-[#b5aca4]">
          Shared via <a href="https://www.rootedhomeschoolapp.com" className="underline hover:text-[#7a6f65]">Rooted</a> — the homeschool memory book
        </p>
      </div>
    </main>
  );
}
