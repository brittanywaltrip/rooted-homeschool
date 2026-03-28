"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Memory = {
  id: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  child_id: string | null;
  child_name: string | null;
  child_color: string | null;
};

type ReactionCount = { emoji: string; count: number };
type Comment = {
  id: string;
  name: string;
  text: string;
  created_at: string;
};

type FamilyData = {
  familyName: string;
  memories: Memory[];
  reactions: Record<string, ReactionCount[]>;
  comments: Record<string, Comment[]>;
};

/* ─── Constants ─────────────────────────────────────────────────────────── */

const REACTION_EMOJIS = ["❤️", "😂", "😮", "🥹", "👏"];

const TYPE_EMOJI: Record<string, string> = {
  photo: "📷",
  drawing: "🎨",
  book: "📖",
  win: "🏆",
  quote: "🗒️",
  project: "🔬",
  field_trip: "🗺️",
  activity: "🎵",
  moment: "✨",
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

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" }
  );
}

function getLocalKey(): string {
  if (typeof window === "undefined") return "";
  let key = localStorage.getItem("rooted_family_key");
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem("rooted_family_key", key);
  }
  return key;
}

function getLocalName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("rooted_family_name") || "";
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function FamilyViewPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [reactions, setReactions] = useState<
    Record<string, ReactionCount[]>
  >({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);

  // Name prompt
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestKey, setGuestKey] = useState("");

  // Comment input per detail sheet
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  // Track which reactions the current user has toggled (optimistic)
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ─── Init localStorage values ──────────────────────────────────────── */

  useEffect(() => {
    const name = getLocalName();
    const key = getLocalKey();
    setGuestName(name);
    setGuestKey(key);
    if (!name) {
      setShowNamePrompt(true);
    }
  }, []);

  /* ─── Fetch data ────────────────────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/family/${token}`);
      if (!res.ok) {
        if (res.status === 404) setNotFound(true);
        setLoading(false);
        return;
      }
      const data: FamilyData = await res.json();
      setFamilyName(data.familyName);
      setMemories(data.memories);
      setReactions(data.reactions);
      setComments(data.comments);
      setLoading(false);
    } catch {
      setNotFound(true);
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll every 30s
  useEffect(() => {
    pollRef.current = setInterval(fetchData, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  /* ─── Name submit ───────────────────────────────────────────────────── */

  function handleNameSubmit() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("rooted_family_name", trimmed);
    setGuestName(trimmed);
    setShowNamePrompt(false);
  }

  /* ─── React to memory ──────────────────────────────────────────────── */

  async function handleReact(memoryId: string, emoji: string) {
    if (!guestName) {
      setShowNamePrompt(true);
      return;
    }

    const reactionKey = `${memoryId}:${emoji}`;
    const alreadyReacted = myReactions.has(reactionKey);

    // Optimistic update
    setMyReactions((prev) => {
      const next = new Set(prev);
      if (alreadyReacted) next.delete(reactionKey);
      else next.add(reactionKey);
      return next;
    });

    setReactions((prev) => {
      const updated = { ...prev };
      const memReactions = [...(updated[memoryId] ?? [])];
      const idx = memReactions.findIndex((r) => r.emoji === emoji);

      if (alreadyReacted) {
        if (idx >= 0) {
          memReactions[idx] = {
            ...memReactions[idx],
            count: Math.max(0, memReactions[idx].count - 1),
          };
          if (memReactions[idx].count === 0)
            memReactions.splice(idx, 1);
        }
      } else {
        if (idx >= 0) {
          memReactions[idx] = {
            ...memReactions[idx],
            count: memReactions[idx].count + 1,
          };
        } else {
          memReactions.push({ emoji, count: 1 });
        }
      }

      updated[memoryId] = memReactions;
      return updated;
    });

    try {
      await fetch(`/api/family/${token}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memory_id: memoryId,
          reaction_type: emoji,
          reactor_key: guestKey,
          reactor_name: guestName,
        }),
      });
    } catch {
      // Revert on error
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (alreadyReacted) next.add(reactionKey);
        else next.delete(reactionKey);
        return next;
      });
      fetchData();
    }
  }

  /* ─── Comment ───────────────────────────────────────────────────────── */

  async function handleComment(memoryId: string) {
    if (!commentText.trim() || !guestName) return;
    setSendingComment(true);

    const optimisticComment: Comment = {
      id: `temp-${Date.now()}`,
      name: guestName,
      text: commentText.trim(),
      created_at: new Date().toISOString(),
    };

    setComments((prev) => ({
      ...prev,
      [memoryId]: [...(prev[memoryId] ?? []), optimisticComment],
    }));
    setCommentText("");

    try {
      const res = await fetch(`/api/family/${token}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memory_id: memoryId,
          commenter_key: guestKey,
          commenter_name: guestName,
          comment_text: optimisticComment.text,
        }),
      });
      const data = await res.json();
      if (data.comment) {
        // Replace optimistic with real
        setComments((prev) => ({
          ...prev,
          [memoryId]: (prev[memoryId] ?? []).map((c) =>
            c.id === optimisticComment.id
              ? {
                  id: data.comment.id,
                  name: data.comment.commenter_name,
                  text: data.comment.comment_text,
                  created_at: data.comment.created_at,
                }
              : c
          ),
        }));
      }
    } catch {
      // Revert on error
      setComments((prev) => ({
        ...prev,
        [memoryId]: (prev[memoryId] ?? []).filter(
          (c) => c.id !== optimisticComment.id
        ),
      }));
    } finally {
      setSendingComment(false);
    }
  }

  /* ─── Helpers ───────────────────────────────────────────────────────── */

  function getTopReaction(
    memoryId: string
  ): { emoji: string; count: number } | null {
    const rxns = reactions[memoryId];
    if (!rxns || rxns.length === 0) return null;
    const total = rxns.reduce((sum, r) => sum + r.count, 0);
    if (total === 0) return null;
    return { emoji: rxns[0].emoji, count: total };
  }

  function getReactionCount(memoryId: string, emoji: string): number {
    const rxns = reactions[memoryId];
    if (!rxns) return 0;
    return rxns.find((r) => r.emoji === emoji)?.count ?? 0;
  }

  /* ─── Loading state ─────────────────────────────────────────────────── */

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8f7f4]">
        {/* Skeleton header */}
        <div className="w-full px-5 pt-6 pb-8" style={{ backgroundColor: "#2D5a1B" }}>
          <div className="h-3 w-16 bg-white/20 rounded mb-3 animate-pulse" />
          <div className="h-7 w-56 bg-white/20 rounded mb-2 animate-pulse" />
          <div className="h-4 w-44 bg-white/10 rounded animate-pulse" />
        </div>
        {/* Skeleton grid */}
        <div className="max-w-3xl mx-auto px-4 pt-6">
          <div className="h-4 w-32 bg-[#e8e2d9] rounded mb-3 animate-pulse" />
          <div className="grid grid-cols-3 gap-[2px] rounded-2xl overflow-hidden">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square bg-[#e8e2d9] animate-pulse"
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  /* ─── 404 state ─────────────────────────────────────────────────────── */

  if (notFound) {
    return (
      <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🌿</div>
          <h1
            className="text-xl font-medium text-[#2d2926] mb-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            This link has expired or doesn&apos;t exist
          </h1>
          <p className="text-sm text-[#7a6f65] mb-8">
            Ask your family to send you a new link
          </p>
          <div className="pt-6 border-t border-[#e8e2d9]">
            <a
              href="https://www.rootedhomeschoolapp.com"
              className="text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
            >
              🌿 Rooted — the homeschool memory book
            </a>
          </div>
        </div>
      </main>
    );
  }

  /* ─── Group memories by month ───────────────────────────────────────── */

  const byMonth = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = m.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(m);
  }

  /* ─── Render ────────────────────────────────────────────────────────── */

  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      {/* ─── Name Prompt Modal ─────────────────────────────────────────── */}
      {showNamePrompt && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
            onClick={() => {}}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div className="bg-[#fefcf9] rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-5">
              <div className="text-center">
                <p className="text-3xl mb-2">👋</p>
                <h2
                  className="text-xl font-medium text-[#2d2926]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Who are you?
                </h2>
                <p className="text-sm text-[#7a6f65] mt-1">
                  So the family knows who&apos;s reacting!
                </p>
              </div>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Grandma, Uncle Mike, etc."
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSubmit();
                }}
              />
              <button
                onClick={handleNameSubmit}
                disabled={!nameInput.trim()}
                className="w-full py-3 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition-all"
                style={{ backgroundColor: "#2D5a1B" }}
              >
                Let&apos;s go →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Page Header ───────────────────────────────────────────────── */}
      <header
        className="w-full"
        style={{ backgroundColor: "#2D5a1B", padding: "24px 20px" }}
      >
        <a
          href="https://www.rootedhomeschoolapp.com"
          className="text-xs text-white/50 hover:text-white/70 transition-colors"
        >
          🌿 Rooted
        </a>
        <h1
          className="text-2xl text-white mt-3 leading-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          The {familyName}&apos;s Memories
        </h1>
        <p className="text-sm text-white/50 mt-1 italic">
          A peek into their homeschool journey
        </p>
        <div className="inline-block mt-3 px-3 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Shared with ❤️
        </div>
      </header>

      {/* ─── Memory Grid ───────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-12">
        {memories.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm text-[#7a6f65]">
              No memories shared yet. Check back soon!
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {[...byMonth.entries()].map(([month, monthMems]) => (
              <div key={month}>
                <p className="text-xs font-medium uppercase tracking-widest text-[#7a6f65] mb-2 px-1">
                  {formatMonth(monthMems[0].date)}
                </p>
                <div className="grid grid-cols-3 gap-[2px] rounded-2xl overflow-hidden">
                  {monthMems.map((mem) => {
                    const topRxn = getTopReaction(mem.id);
                    return (
                      <button
                        key={mem.id}
                        className="relative aspect-square overflow-hidden focus:outline-none"
                        onClick={() => {
                          setSelectedMemory(mem);
                          setCommentText("");
                        }}
                      >
                        {mem.photo_url ? (
                          <img
                            src={mem.photo_url}
                            alt={mem.title ?? "Memory"}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="w-full h-full flex flex-col items-center justify-center px-2 relative"
                            style={{
                              background:
                                TYPE_GRADIENT[mem.type] ??
                                "linear-gradient(135deg, #e8f0e9, #b8d4ba)",
                              backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.04) 0.5px, transparent 0.5px), ${TYPE_GRADIENT[mem.type] ?? "linear-gradient(135deg, #e8f0e9, #b8d4ba)"}`,
                              backgroundSize: "8px 8px, 100% 100%",
                            }}
                          >
                            <span className="text-3xl mb-1">
                              {TYPE_EMOJI[mem.type] ?? "📷"}
                            </span>
                            {mem.title && (
                              <p className="text-[10px] text-[#5a4a3a] text-center leading-tight line-clamp-2 font-medium">
                                {mem.title}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Date label — bottom-left */}
                        <span
                          className="absolute bottom-1 left-1.5 text-white text-[9px] font-medium drop-shadow-sm"
                          style={{
                            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                          }}
                        >
                          {formatDate(mem.date)}
                        </span>

                        {/* Reaction pill — bottom-right */}
                        {topRxn && (
                          <span
                            className="absolute bottom-1 right-1.5 flex items-center gap-0.5 text-white"
                            style={{
                              fontSize: "9px",
                              background: "rgba(0,0,0,0.4)",
                              borderRadius: "8px",
                              padding: "2px 5px",
                            }}
                          >
                            {topRxn.emoji} {topRxn.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Detail Sheet ──────────────────────────────────────────────── */}
      {selectedMemory && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
            onClick={() => setSelectedMemory(null)}
          />

          {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="bg-[#fefcf9] w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setSelectedMemory(null)}
                className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/40 transition-colors text-lg"
              >
                ×
              </button>

              {/* Hero */}
              {selectedMemory.photo_url ? (
                <div className="aspect-square w-full overflow-hidden rounded-t-3xl sm:rounded-t-3xl">
                  <img
                    src={selectedMemory.photo_url}
                    alt={selectedMemory.title ?? "Memory"}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="aspect-square w-full flex items-center justify-center rounded-t-3xl sm:rounded-t-3xl"
                  style={{
                    background:
                      TYPE_GRADIENT[selectedMemory.type] ??
                      "linear-gradient(135deg, #e8f0e9, #b8d4ba)",
                    backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.04) 0.5px, transparent 0.5px), ${TYPE_GRADIENT[selectedMemory.type] ?? "linear-gradient(135deg, #e8f0e9, #b8d4ba)"}`,
                    backgroundSize: "8px 8px, 100% 100%",
                  }}
                >
                  <span className="text-7xl">
                    {TYPE_EMOJI[selectedMemory.type] ?? "📷"}
                  </span>
                </div>
              )}

              {/* Content */}
              <div className="px-5 py-4 space-y-4">
                {/* Child + date */}
                <div className="flex items-center gap-2 text-sm text-[#7a6f65]">
                  {selectedMemory.child_color && (
                    <span
                      className="w-3 h-3 rounded-full border border-white shadow-sm"
                      style={{
                        backgroundColor: selectedMemory.child_color,
                      }}
                    />
                  )}
                  {selectedMemory.child_name && (
                    <span className="font-medium text-[#2d2926]">
                      {selectedMemory.child_name}
                    </span>
                  )}
                  <span>·</span>
                  <span>{formatDate(selectedMemory.date)}</span>
                </div>

                {/* Title */}
                {selectedMemory.title && (
                  <h2
                    className="text-lg text-[#2d2926]"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 500,
                    }}
                  >
                    {selectedMemory.title}
                  </h2>
                )}

                {/* Caption */}
                {selectedMemory.caption && (
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    {selectedMemory.caption}
                  </p>
                )}

                {/* ── Reaction Row ──────────────────────────────────── */}
                <div className="flex items-center gap-2 pt-1">
                  {REACTION_EMOJIS.map((emoji) => {
                    const count = getReactionCount(
                      selectedMemory.id,
                      emoji
                    );
                    const isSelected = myReactions.has(
                      `${selectedMemory.id}:${emoji}`
                    );
                    return (
                      <button
                        key={emoji}
                        onClick={() =>
                          handleReact(selectedMemory.id, emoji)
                        }
                        className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all"
                        style={{
                          backgroundColor: isSelected
                            ? "#e8f0e9"
                            : "#f5f3f0",
                          border: isSelected
                            ? "2px solid #5c7f63"
                            : "2px solid transparent",
                        }}
                      >
                        <span className="text-xl">{emoji}</span>
                        {count > 0 && (
                          <span className="text-[10px] text-[#7a6f65] font-medium">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ── Comments Section ──────────────────────────────── */}
                <div className="border-t border-[#e8e2d9] pt-4 space-y-3">
                  {(comments[selectedMemory.id] ?? []).length > 0 && (
                    <div className="space-y-2">
                      {(comments[selectedMemory.id] ?? []).map((c) => (
                        <div key={c.id} className="text-sm">
                          <span className="font-medium text-[#2d2926]">
                            {c.name}
                          </span>
                          <span className="text-[#7a6f65] ml-1.5">
                            {c.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Comment input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Leave a comment..."
                      className="flex-1 px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !sendingComment) {
                          if (!guestName) {
                            setShowNamePrompt(true);
                            return;
                          }
                          handleComment(selectedMemory.id);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (!guestName) {
                          setShowNamePrompt(true);
                          return;
                        }
                        handleComment(selectedMemory.id);
                      }}
                      disabled={
                        !commentText.trim() || sendingComment
                      }
                      className="px-3 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition-all"
                      style={{ backgroundColor: "#2D5a1B" }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className="text-center pb-8 pt-4">
        <p className="text-xs text-[#b5aca4]">
          Made with 🌿{" "}
          <a
            href="https://www.rootedhomeschoolapp.com"
            className="underline hover:text-[#7a6f65] transition-colors"
          >
            Rooted
          </a>{" "}
          — help your family capture every moment
        </p>
      </footer>
    </main>
  );
}
