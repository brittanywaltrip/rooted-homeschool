"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import FamilyFeed from "@/components/family/FamilyFeed";
import type {
  FamilyChild,
  FamilyComment,
  FamilyData,
  FamilyMemory,
  ReactionCount,
} from "@/lib/family-feed";

/* ─── Local helpers ─────────────────────────────────────────────────────── */

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
  const [childrenList, setChildrenList] = useState<FamilyChild[]>([]);
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionCount[]>>({});
  const [comments, setComments] = useState<Record<string, FamilyComment[]>>({});
  const [viewerNameFromServer, setViewerNameFromServer] = useState<string | null>(null);
  const [giftSuccess, setGiftSuccess] = useState(false);

  // Name prompt
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestKey, setGuestKey] = useState("");

  // Comment send-in-flight flag (draft text lives inside FamilyFeed)
  const [sendingComment, setSendingComment] = useState(false);

  // Track user's own reactions
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());

  // Gift
  const [giftLoading, setGiftLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoReactDone = useRef(false);

  /* ─── Init ──────────────────────────────────────────────────────────── */

  // Hydrate guestName/guestKey from localStorage on mount. We don't decide
  // whether to show the name prompt here — that's deferred until fetchData
  // returns so we can pre-seed the name from the invite's viewer_name when
  // mom already set it, sparing first-time visitors the "Who are you?" popup.
  useEffect(() => {
    const name = getLocalName();
    const key = getLocalKey();
    setGuestName(name);
    setGuestKey(key);
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
      setViewerNameFromServer(data.viewerName);

      // Decide on the name prompt now that we know the invite's viewer_name.
      const existingName = getLocalName();
      if (data.viewerName && data.viewerName.trim()) {
        // Always seed from the invite's viewer_name — the token is person-specific,
        // so the server-side name wins over any stale localStorage value from a
        // previous visit (e.g. a different family member's link opened on same device).
        const seeded = data.viewerName.trim();
        localStorage.setItem("rooted_family_name", seeded);
        setGuestName(seeded);
      } else if (!existingName) {
        // No viewer_name set on the invite and nothing in localStorage → ask who they are.
        setShowNamePrompt(true);
      }

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

  function openNamePromptForChange() {
    setNameInput(guestName);
    setShowNamePrompt(true);
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

    // Undo the optimistic reaction and re-sync counts from the server. Runs on
    // BOTH a thrown fetch (network) AND a non-ok response (e.g. the API 400s a
    // rejected emoji). Without the res.ok check, a rejected reaction looked
    // saved and silently was not, the original bug.
    const rollback = () => {
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (alreadyReacted) next.add(reactionKey); else next.delete(reactionKey);
        return next;
      });
      fetchData();
    };

    try {
      const res = await fetch(`/api/family/${token}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory_id: memoryId, emoji, reactor_key: key, reactor_name: name }),
      });
      if (!res.ok) rollback();
    } catch {
      rollback();
    }
  }

  function handleReact(memoryId: string, emoji: string) {
    if (!guestName) { setShowNamePrompt(true); return; }
    handleReactInner(memoryId, emoji, guestName, guestKey);
  }

  /* ─── Comment ───────────────────────────────────────────────────────── */

  async function handleComment(memoryId: string, text: string) {
    const body = text.trim();
    if (!body) return;
    if (!guestName) { setShowNamePrompt(true); return; }
    setSendingComment(true);

    const optimistic: FamilyComment = {
      id: `temp-${Date.now()}`, name: guestName, text: body, created_at: new Date().toISOString(),
    };
    setComments((prev) => ({ ...prev, [memoryId]: [...(prev[memoryId] ?? []), optimistic] }));

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

  /* ─── Loading ───────────────────────────────────────────────────────── */

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
                style={{ backgroundColor: "var(--g-brand)" }}
              >
                Let&apos;s go →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Gift success toast ────────────────────────────────────────── */}
      {giftSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[var(--g-brand)] text-white px-5 py-3 rounded-2xl shadow-lg text-sm font-medium animate-[toast-slide-up_0.3s_ease-out]">
          🎁 Gift sent! They&apos;ll be so happy.
        </div>
      )}

      {/* ─── Shared feed (header + cards + lightbox) ───────────────────── */}
      <FamilyFeed
        familyName={familyName}
        childrenList={childrenList}
        memories={memories}
        reactions={reactions}
        comments={comments}
        guestName={guestName}
        myReactions={myReactions}
        sendingComment={sendingComment}
        onReact={handleReact}
        onComment={handleComment}
        onChangeName={openNamePromptForChange}
      />

      {/* ─── Sticky Footer ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#fefcf9] border-t border-[#e8e2d9] py-2.5 px-4 z-30" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-[480px] mx-auto text-center">
          <p className="text-xs text-[#7a6f65]">
            You&apos;re following {familyName}&apos;s journey 🌿
          </p>
        </div>
      </div>

      {/* ─── Gift nudge (always visible) ─────────────────────────────── */}
      <div className="mx-4 mt-8 bg-[#fefcf9] border border-[#e8e2d9] border-l-[3px] border-l-[rgba(254, 252, 249, 0.55)] rounded-2xl px-5 py-4">
        <p className="text-[13px] font-medium text-[#2d2926] mb-1">Love following along? 🎁</p>
        <p className="text-[12px] text-[#7a6f65] leading-relaxed mb-3">
          You can gift {familyName} a full year of Rooted so they never stop capturing these moments.
        </p>
        <button
          onClick={handleGift}
          disabled={giftLoading}
          className="text-xs font-medium text-white bg-[#3d6b47] hover:bg-[var(--g-brand)] px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
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
