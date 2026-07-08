"use client";

import { useEffect, useState } from "react";
import type {
  FamilyChild,
  FamilyComment,
  FamilyMemory,
  ReactionCount,
} from "@/lib/family-feed";
import { REACTION_EMOJIS } from "@/lib/family-reactions";

/* ─── Presentational constants ──────────────────────────────────────────── */

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

/* ─── Props ─────────────────────────────────────────────────────────────── */

type FamilyFeedProps = {
  familyName: string;
  childrenList: FamilyChild[];
  memories: FamilyMemory[];
  reactions: Record<string, ReactionCount[]>;
  comments: Record<string, FamilyComment[]>;

  /** When true, reactions + comment inputs render but are visually disabled and
   *  nothing is ever submitted. Used by the owner preview. */
  readOnly?: boolean;

  /* Interactive-only wiring (ignored when readOnly). */
  guestName?: string;
  myReactions?: Set<string>;
  sendingComment?: boolean;
  onReact?: (memoryId: string, emoji: string) => void;
  onComment?: (memoryId: string, text: string) => void;
  onChangeName?: () => void;
};

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function FamilyFeed({
  familyName,
  childrenList,
  memories,
  reactions,
  comments,
  readOnly = false,
  guestName = "",
  myReactions,
  sendingComment = false,
  onReact,
  onComment,
  onChangeName,
}: FamilyFeedProps) {
  // Local UI-only state: lightbox + the in-progress comment draft per card.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [activeMemoryId, setActiveMemoryId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  // The chip currently playing its tap "pop" (memoryId:emoji), cleared shortly after.
  const [poppedKey, setPoppedKey] = useState<string | null>(null);
  // One-time gentle nudge above the first memory. Never in readOnly (preview).
  const [showLoveHint, setShowLoveHint] = useState(false);

  // localStorage is client-only, so read the seen flag in an effect. Only for
  // interactive viewers; the owner preview (readOnly) never shows the hint.
  useEffect(() => {
    if (readOnly || typeof window === "undefined") return;
    if (localStorage.getItem("rooted_love_hint_seen")) return;
    // Client-only localStorage read on mount (SSR renders it hidden to avoid a
    // hydration mismatch); runs once, so no cascading-render concern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowLoveHint(true);
  }, [readOnly]);

  function dismissLoveHint() {
    setShowLoveHint(false);
    try { localStorage.setItem("rooted_love_hint_seen", "1"); } catch { /* ignore */ }
  }

  function handleReactTap(memoryId: string, emoji: string) {
    if (readOnly) return;
    const key = `${memoryId}:${emoji}`;
    setPoppedKey(key);
    setTimeout(() => setPoppedKey((cur) => (cur === key ? null : cur)), 200);
    if (showLoveHint) dismissLoveHint(); // reacting once retires the hint forever
    onReact?.(memoryId, emoji);
  }

  const reactionsOf = myReactions ?? new Set<string>();

  function getReactionCount(memoryId: string, emoji: string): number {
    return reactions[memoryId]?.find((r) => r.emoji === emoji)?.count ?? 0;
  }

  function submitComment(memoryId: string) {
    const text = commentDraft.trim();
    if (!text || readOnly || sendingComment) return;
    onComment?.(memoryId, text);
    setCommentDraft("");
  }

  return (
    <>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="w-full" style={{ backgroundColor: "var(--g-brand)", padding: "32px 20px 24px" }}>
        <div className="max-w-[480px] mx-auto">
          <h1 className="text-2xl text-white leading-tight" style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
            {familyName} 🌿
          </h1>
          {childrenList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {childrenList.map((c) => (
                <span key={c.id} className="px-2.5 py-0.5 rounded-full text-xs text-white/80 bg-white/15">
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ─── Memory Feed ─────────────────────────────────────────────────── */}
      <div className="max-w-[480px] mx-auto px-4 pt-5 space-y-4">
        {!readOnly && guestName && (
          <p className="text-xs text-[#7a6f65]">
            Hi, <span className="font-medium text-[#2d2926]">{guestName}</span> 👋{" "}
            {onChangeName && (
              <button
                type="button"
                onClick={onChangeName}
                className="text-[#b5aca4] hover:text-[#7a6f65] underline underline-offset-2"
              >
                (not you?)
              </button>
            )}
          </p>
        )}

        {memories.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📸</div>
            {readOnly ? (
              <>
                <p className="text-sm text-[#7a6f65]">No family-visible memories yet.</p>
                <p className="text-xs text-[#b5aca4] mt-1">Memories are visible by default — check your privacy settings.</p>
              </>
            ) : (
              <p className="text-sm text-[#7a6f65]">No memories shared yet. Check back soon!</p>
            )}
          </div>
        ) : (
          memories.map((mem, memIdx) => {
            const memComments = comments[mem.id] ?? [];
            return (
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
                  {/* Child + date */}
                  <p className="text-xs text-[#7a6f65]">
                    {mem.child_name && <><span className="font-medium text-[#2d2926]">{mem.child_name}</span> · </>}
                    {formatDate(mem.date)}
                  </p>

                  {/* Caption */}
                  {mem.caption && <p className="text-sm text-[#2d2926] leading-relaxed">{mem.caption}</p>}

                  {/* One-time gentle nudge, above the first memory's reactions only */}
                  {!readOnly && showLoveHint && memIdx === 0 && (
                    <div className="flex items-start gap-2 pt-1">
                      <p className="text-[12px] text-[#5c7f63] leading-snug flex-1">
                        Tap an emoji to send some love. {familyName} will see it.
                      </p>
                      <button
                        type="button"
                        onClick={dismissLoveHint}
                        aria-label="Dismiss"
                        className="shrink-0 text-[#b5aca4] hover:text-[#7a6f65] text-base leading-none px-1 -mt-0.5"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {/* Reaction bar */}
                  <div className={`flex items-center gap-1.5 pt-1${readOnly ? " opacity-60 pointer-events-none" : ""}`}>
                    {REACTION_EMOJIS.map((emoji) => {
                      const count = getReactionCount(mem.id, emoji);
                      const isSelected = !readOnly && reactionsOf.has(`${mem.id}:${emoji}`);
                      const isPopped = poppedKey === `${mem.id}:${emoji}`;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          disabled={readOnly}
                          onClick={readOnly ? undefined : () => handleReactTap(mem.id, emoji)}
                          className={`flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 rounded-xl transition-all${isPopped ? " react-pop" : ""}`}
                          style={{
                            backgroundColor: isSelected ? "#e8f0e9" : "#f5f3f0",
                            border: isSelected ? "1.5px solid #5c7f63" : "1.5px solid transparent",
                          }}
                        >
                          <span className="text-xl leading-none">{emoji}</span>
                          {count > 0 && <span className="text-[11px] text-[#7a6f65] font-medium">{count}</span>}
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
                  {readOnly ? (
                    <div className="flex gap-2 pt-1 opacity-60 pointer-events-none">
                      <input
                        type="text" readOnly placeholder="Leave a comment..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-xs text-[#2d2926] placeholder:text-[#c8bfb5]"
                      />
                    </div>
                  ) : (
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={activeMemoryId === mem.id ? commentDraft : ""}
                        onFocus={() => { setActiveMemoryId(mem.id); setCommentDraft(""); }}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        placeholder="Leave a comment..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-xs text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
                        onKeyDown={(e) => { if (e.key === "Enter") submitComment(mem.id); }}
                      />
                      {activeMemoryId === mem.id && commentDraft.trim() && (
                        <button
                          type="button"
                          onClick={() => submitComment(mem.id)}
                          disabled={sendingComment}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40"
                          style={{ backgroundColor: "var(--g-brand)" }}
                        >
                          Send
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── Lightbox ────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl z-10" onClick={() => setLightboxUrl(null)}>×</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-w-full max-h-[90vh] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
