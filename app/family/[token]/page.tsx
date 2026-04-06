"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";

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
  created_at: string;
};

type ReactionCount = { emoji: string; count: number };
type Comment = {
  id: string;
  name: string;
  text: string;
  created_at: string;
};

type ChildInfo = { id: string; name: string; color: string };

type FamilyData = {
  familyName: string;
  children: ChildInfo[];
  memories: Memory[];
  reactions: Record<string, ReactionCount[]>;
  comments: Record<string, Comment[]>;
  trialEnded: boolean;
  momPaid: boolean;
  trialActive?: boolean;
  trialEndsAt: string | null;
  viewerName: string | null;
};

/* ─── Constants ─────────────────────────────────────────────────────────── */

const REACTION_EMOJIS = ["🥹", "❤️", "😂", "🙌", "😍"];

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

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
    "en-US", { month: "long", day: "numeric" }
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
  const searchParams = useSearchParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [childrenList, setChildrenList] = useState<ChildInfo[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionCount[]>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [trialEnded, setTrialEnded] = useState(false);
  const [momPaid, setMomPaid] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [viewerNameFromServer, setViewerNameFromServer] = useState<string | null>(null);
  const [giftSuccess, setGiftSuccess] = useState(false);

  // Lightbox image viewer
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Name prompt
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestKey, setGuestKey] = useState("");

  // Comment
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  // Track user's own reactions
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());

  // Gift
  const [giftLoading, setGiftLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoReactDone = useRef(false);

  /* ─── Init ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const name = getLocalName();
    const key = getLocalKey();
    setGuestName(name);
    setGuestKey(key);
    if (!name) setShowNamePrompt(true);
    if (searchParams.get("gift") === "success") setGiftSuccess(true);
  }, [searchParams]);

  /* ─── Fetch ─────────────────────────────────────────────────────────── */

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
      setChildrenList(data.children);
      setMemories(data.memories);
      setReactions(data.reactions);
      setComments(data.comments);
      setTrialEnded(data.trialEnded);
      setMomPaid(data.momPaid);
      setTrialEndsAt(data.trialEndsAt);
      setViewerNameFromServer(data.viewerName);
      setLoading(false);

      // Auto-react from URL params (once)
      if (!autoReactDone.current) {
        autoReactDone.current = true;
        const reactEmoji = searchParams.get("react");
        const reactMemId = searchParams.get("memory_id");
        if (reactEmoji && reactMemId) {
          const name = getLocalName();
          const key = getLocalKey();
          if (name && key) {
            // Strip params from URL
            window.history.replaceState({}, "", `/family/${token}`);
            // Fire reaction
            handleReactInner(reactMemId, reactEmoji, name, key);
          }
        }
      }
    } catch {
      setNotFound(true);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, searchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    pollRef.current = setInterval(fetchData, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  /* ─── Name submit ───────────────────────────────────────────────────── */

  function handleNameSubmit() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("rooted_family_name", trimmed);
    setGuestName(trimmed);
    setShowNamePrompt(false);
  }

  /* ─── React ─────────────────────────────────────────────────────────── */

  async function handleReactInner(memoryId: string, emoji: string, name: string, key: string) {
    const reactionKey = `${memoryId}:${emoji}`;
    const alreadyReacted = myReactions.has(reactionKey);

    setMyReactions((prev) => {
      const next = new Set(prev);
      if (alreadyReacted) next.delete(reactionKey); else next.add(reactionKey);
      return next;
    });

    setReactions((prev) => {
      const updated = { ...prev };
      const memRxns = [...(updated[memoryId] ?? [])];
      const idx = memRxns.findIndex((r) => r.emoji === emoji);
      if (alreadyReacted) {
        if (idx >= 0) {
          memRxns[idx] = { ...memRxns[idx], count: Math.max(0, memRxns[idx].count - 1) };
          if (memRxns[idx].count === 0) memRxns.splice(idx, 1);
        }
      } else {
        if (idx >= 0) memRxns[idx] = { ...memRxns[idx], count: memRxns[idx].count + 1 };
        else memRxns.push({ emoji, count: 1 });
      }
      updated[memoryId] = memRxns;
      return updated;
    });

    try {
      await fetch(`/api/family/${token}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory_id: memoryId, emoji, reactor_key: key, reactor_name: name }),
      });
    } catch {
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (alreadyReacted) next.add(reactionKey); else next.delete(reactionKey);
        return next;
      });
      fetchData();
    }
  }

  function handleReact(memoryId: string, emoji: string) {
    if (!guestName) { setShowNamePrompt(true); return; }
    handleReactInner(memoryId, emoji, guestName, guestKey);
  }

  /* ─── Comment ───────────────────────────────────────────────────────── */

  async function handleComment(memoryId: string) {
    if (!commentText.trim() || !guestName) return;
    setSendingComment(true);

    const optimistic: Comment = {
      id: `temp-${Date.now()}`, name: guestName, text: commentText.trim(), created_at: new Date().toISOString(),
    };
    setComments((prev) => ({ ...prev, [memoryId]: [...(prev[memoryId] ?? []), optimistic] }));
    setCommentText("");

    try {
      const res = await fetch(`/api/family/${token}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory_id: memoryId, commenter_key: guestKey, commenter_name: guestName, body: optimistic.text }),
      });
      const data = await res.json();
      if (data.comment) {
        setComments((prev) => ({
          ...prev,
          [memoryId]: (prev[memoryId] ?? []).map((c) =>
            c.id === optimistic.id ? { id: data.comment.id, name: data.comment.commenter_name, text: data.comment.body, created_at: data.comment.created_at } : c
          ),
        }));
      }
    } catch {
      setComments((prev) => ({ ...prev, [memoryId]: (prev[memoryId] ?? []).filter((c) => c.id !== optimistic.id) }));
    } finally {
      setSendingComment(false);
    }
  }

  /* ─── Gift ──────────────────────────────────────────────────────────── */

  async function handleGift() {
    setGiftLoading(true);
    try {
      const res = await fetch("/api/family/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, viewer_name: guestName || viewerNameFromServer }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setGiftLoading(false);
    } catch {
      setGiftLoading(false);
    }
  }

  function copyGiftLink() {
    navigator.clipboard.writeText(`https://www.rootedhomeschoolapp.com/family/${token}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  /* ─── Helpers ───────────────────────────────────────────────────────── */

  function getTopReaction(memoryId: string): { emoji: string; count: number } | null {
    const rxns = reactions[memoryId];
    if (!rxns || rxns.length === 0) return null;
    const total = rxns.reduce((sum, r) => sum + r.count, 0);
    if (total === 0) return null;
    return { emoji: rxns[0].emoji, count: total };
  }

  function getReactionCount(memoryId: string, emoji: string): number {
    return reactions[memoryId]?.find((r) => r.emoji === emoji)?.count ?? 0;
  }

  /* ─── Loading ───────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8f7f4]">
        <div className="w-full px-5 pt-8 pb-6" style={{ backgroundColor: "#2d5a3d" }}>
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

  /* ─── 404 / Inactive ────────────────────────────────────────────────── */

  if (notFound) {
    return (
      <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🌿</div>
          <h1 className="text-lg font-medium text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
            This link is no longer active
          </h1>
          <p className="text-sm text-[#7a6f65] leading-relaxed">
            If you think this is a mistake, reach out to the family directly.
          </p>
          <div className="mt-8 pt-6 border-t border-[#e8e2d9]">
            <span className="text-xs text-[#b5aca4]">🌿 Rooted</span>
          </div>
        </div>
      </main>
    );
  }

  /* ─── Child names string ────────────────────────────────────────────── */

  const childPills = childrenList.map((c) => c.name);
  const trialEndFormatted = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : null;

  /* ─── Render ────────────────────────────────────────────────────────── */

  return (
    <main className="min-h-screen bg-[#f8f7f4] pb-24">
      {/* ─── Name Prompt ───────────────────────────────────────────────── */}
      {showNamePrompt && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div className="bg-[#fefcf9] rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-5">
              <div className="text-center">
                <p className="text-3xl mb-2">👋</p>
                <h2 className="text-xl font-medium text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                  Who are you?
                </h2>
                <p className="text-sm text-[#7a6f65] mt-1">So the family knows who&apos;s reacting!</p>
              </div>
              <input
                type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                placeholder="Grandma, Uncle Mike, etc." autoFocus
                className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                onKeyDown={(e) => { if (e.key === "Enter") handleNameSubmit(); }}
              />
              <button
                onClick={handleNameSubmit} disabled={!nameInput.trim()}
                className="w-full py-3 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition-all"
                style={{ backgroundColor: "#2d5a3d" }}
              >
                Let&apos;s go →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Gift success toast ────────────────────────────────────────── */}
      {giftSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#2d5a3d] text-white px-5 py-3 rounded-2xl shadow-lg text-sm font-medium animate-[toast-slide-up_0.3s_ease-out]">
          🎁 Gift sent! They&apos;ll be so happy.
        </div>
      )}

      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header className="w-full" style={{ backgroundColor: "#2d5a3d", padding: "32px 20px 24px" }}>
        <div className="max-w-[480px] mx-auto">
          <h1 className="text-2xl text-white leading-tight" style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
            {familyName} 🌿
          </h1>
          {childPills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {childPills.map((name) => (
                <span key={name} className="px-2.5 py-0.5 rounded-full text-xs text-white/80 bg-white/15">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ─── Trial-ended overlay ───────────────────────────────────────── */}
      {trialEnded && !momPaid && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          {/* Blurred memories behind */}
          <div className="absolute inset-0 bg-[#f8f7f4]" style={{ filter: "blur(8px)", opacity: 0.7 }} />
          <div className="relative z-10 bg-[#fefcf9] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-3xl">🌿</p>
              <h2 className="text-lg font-medium text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                Your free preview of {familyName}&apos;s journey has ended.
              </h2>
              {childPills.length > 0 && (
                <p className="text-sm text-[#7a6f65]">
                  Want to keep following {childPills.join(" and ")}&apos;s story? You can gift them a full year of Rooted.
                </p>
              )}
            </div>
            <button
              onClick={handleGift} disabled={giftLoading}
              className="w-full py-3.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-all"
              style={{ backgroundColor: "#2d5a3d" }}
            >
              {giftLoading ? "Loading..." : "Gift them a year — $59 →"}
            </button>
            <div className="text-center">
              <p className="text-xs text-[#7a6f65] mb-1">Or share this page with someone who&apos;d love to give this gift.</p>
              <button onClick={copyGiftLink} className="text-xs text-[#5c7f63] font-medium underline">
                {copiedLink ? "Copied!" : "Copy link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Memory Feed ───────────────────────────────────────────────── */}
      <div className="max-w-[480px] mx-auto px-4 pt-5 space-y-4">
        {memories.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm text-[#7a6f65]">No memories shared yet. Check back soon!</p>
          </div>
        ) : (
          memories.map((mem) => {
            const topRxn = getTopReaction(mem.id);
            const memComments = comments[mem.id] ?? [];
            return (
              <div key={mem.id} className="bg-[#fefcf9] rounded-2xl border border-[#e8e2d9] overflow-hidden shadow-sm">
                {/* Photo or type tile */}
                {mem.photo_url ? (
                  <button className="w-full" onClick={() => setLightboxUrl(mem.photo_url)}>
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
                  {/* Child + date */}
                  <p className="text-xs text-[#7a6f65]">
                    {mem.child_name && <><span className="font-medium text-[#2d2926]">{mem.child_name}</span> · </>}
                    {formatDate(mem.date)}
                  </p>

                  {/* Caption */}
                  {mem.caption && <p className="text-sm text-[#2d2926] leading-relaxed">{mem.caption}</p>}

                  {/* Reaction bar */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {REACTION_EMOJIS.map((emoji) => {
                      const count = getReactionCount(mem.id, emoji);
                      const isSelected = myReactions.has(`${mem.id}:${emoji}`);
                      return (
                        <button
                          key={emoji} onClick={() => handleReact(mem.id, emoji)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg transition-all text-sm"
                          style={{
                            backgroundColor: isSelected ? "#e8f0e9" : "#f5f3f0",
                            border: isSelected ? "1.5px solid #5c7f63" : "1.5px solid transparent",
                          }}
                        >
                          <span>{emoji}</span>
                          {count > 0 && <span className="text-[10px] text-[#7a6f65] font-medium">{count}</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Comments */}
                  {memComments.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {memComments.map((c) => (
                        <p key={c.id} className="text-xs text-[#7a6f65]">
                          <span className="font-medium text-[#2d2926]">{c.name}</span>{" "}
                          {c.text}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Comment input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text" value={selectedMemory?.id === mem.id ? commentText : ""}
                      onFocus={() => { setSelectedMemory(mem); setCommentText(""); }}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Leave a comment..."
                      className="flex-1 px-3 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-xs text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !sendingComment) {
                          if (!guestName) { setShowNamePrompt(true); return; }
                          handleComment(mem.id);
                        }
                      }}
                    />
                    {selectedMemory?.id === mem.id && commentText.trim() && (
                      <button
                        onClick={() => {
                          if (!guestName) { setShowNamePrompt(true); return; }
                          handleComment(mem.id);
                        }}
                        disabled={sendingComment}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: "#2d5a3d" }}
                      >
                        Send
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── Inline Lightbox ───────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl z-10" onClick={() => setLightboxUrl(null)}>×</button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-[90vh] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* ─── Sticky Footer ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#fefcf9] border-t border-[#e8e2d9] py-2.5 px-4 z-30" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-[480px] mx-auto text-center">
          <p className="text-xs text-[#7a6f65]">
            You&apos;re following {familyName}&apos;s journey 🌿
          </p>
          {!trialEnded && !momPaid && trialEndFormatted && (
            <p className="text-[10px] text-[#b5aca4] mt-0.5">
              Free preview · through {trialEndFormatted}
            </p>
          )}
        </div>
      </div>

      {/* ─── Gift nudge (always visible) ─────────────────────────────── */}
      <div className="mx-4 mt-8 bg-[#fefcf9] border border-[#e8e2d9] border-l-[3px] border-l-[#8cba8e] rounded-2xl px-5 py-4">
        <p className="text-[13px] font-medium text-[#2d2926] mb-1">Love following along? 🎁</p>
        <p className="text-[12px] text-[#7a6f65] leading-relaxed mb-3">
          You can gift {familyName} a full year of Rooted so they never stop capturing these moments.
        </p>
        <button
          onClick={handleGift}
          disabled={giftLoading}
          className="text-xs font-medium text-white bg-[#3d6b47] hover:bg-[#2d5a3d] px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {giftLoading ? "Loading..." : "Gift them a year →"}
        </button>
      </div>

      {/* ─── Subtle Rooted footer ──────────────────────────────────────── */}
      <div className="text-center pt-8 pb-4">
        <a href="https://www.rootedhomeschoolapp.com" className="text-[10px] text-[#b5aca4] hover:text-[#7a6f65]">
          🌿 Rooted
        </a>
      </div>
    </main>
  );
}
