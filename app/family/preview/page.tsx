"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import FamilyFeed from "@/components/family/FamilyFeed";
import type {
  FamilyChild,
  FamilyComment,
  FamilyData,
  FamilyMemory,
  ReactionCount,
} from "@/lib/family-feed";

/* ── Public-demo placeholder data ───────────────────────────────────────────
   Rendered when the visitor is NOT signed in, so the URL is shareable to
   anyone who doesn't have a Rooted account. Logged-in users see their own real
   feed (fetched from /api/family/preview). Kept inline (no DB row, nothing to
   deactivate) so the demo can't be turned off by user action. */
const DEMO_FAMILY_NAME = "The Bennett Family";

const DEMO_CHILDREN: FamilyChild[] = [
  { id: "demo-kid-1", name: "Eleanor", color: "#7a4a7e" },
  { id: "demo-kid-2", name: "Henry",   color: "#c4863a" },
  { id: "demo-kid-3", name: "Wren",    color: "#a8576f" },
];

const DEMO_MEMORIES: FamilyMemory[] = [
  {
    id: "demo-mem-1",
    type: "book",
    title: "Charlotte's Web",
    caption: "Eleanor finished it in two evenings. \"The part about Fern made me cry, Mom.\"",
    photo_url: null,
    date: "2026-05-14",
    child_id: "demo-kid-1",
    child_name: "Eleanor",
    child_color: "#7a4a7e",
  },
  {
    id: "demo-mem-2",
    type: "win",
    title: "Wrote his name!",
    caption: "Henry held the pencil all by himself. Eleven tries, then he got it.",
    photo_url: null,
    date: "2026-05-13",
    child_id: "demo-kid-2",
    child_name: "Henry",
    child_color: "#c4863a",
  },
  {
    id: "demo-mem-3",
    type: "drawing",
    title: "Our backyard birds",
    caption: "Wren spent an hour on the cardinal. Insisted we caption it with the species names.",
    photo_url: null,
    date: "2026-05-11",
    child_id: "demo-kid-3",
    child_name: "Wren",
    child_color: "#a8576f",
  },
  {
    id: "demo-mem-4",
    type: "field_trip",
    title: "Tide pools at Asilomar",
    caption: "All three kids in the same tide pool counting hermit crabs. Worth the drive.",
    photo_url: null,
    date: "2026-05-09",
    child_id: null,
    child_name: null,
    child_color: null,
  },
  {
    id: "demo-mem-5",
    type: "project",
    title: "Volcano, take two",
    caption: "Eleanor wanted a retry because last week's lava \"didn't erupt enough.\" It erupted enough.",
    photo_url: null,
    date: "2026-05-07",
    child_id: "demo-kid-1",
    child_name: "Eleanor",
    child_color: "#7a4a7e",
  },
  {
    id: "demo-mem-6",
    type: "moment",
    title: null,
    caption: "Henry asking Wren if 4 is older than 6. They argued for ten minutes. I let them.",
    photo_url: null,
    date: "2026-05-05",
    child_id: null,
    child_name: null,
    child_color: null,
  },
];

export default function FamilyPreviewPage() {
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [childrenList, setChildrenList] = useState<FamilyChild[]>([]);
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionCount[]>>({});
  const [comments, setComments] = useState<Record<string, FamilyComment[]>>({});

  useEffect(() => {
    (async () => {
      // Ask the session-auth endpoint for the real feed. A 401 (no session)
      // means an anonymous visitor → show the shareable public demo. The
      // endpoint signs photo URLs and never records a visit or notification.
      try {
        const res = await fetch("/api/family/preview");
        if (res.ok) {
          const data: FamilyData = await res.json();
          setFamilyName(data.familyName);
          setChildrenList(data.children);
          setMemories(data.memories);
          setReactions(data.reactions);
          setComments(data.comments);
          setLoading(false);
          return;
        }
      } catch {
        // fall through to demo
      }

      setIsDemo(true);
      setFamilyName(DEMO_FAMILY_NAME);
      setChildrenList(DEMO_CHILDREN);
      setMemories(DEMO_MEMORIES);
      setLoading(false);
    })();
  }, []);

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
      {isDemo ? (
        <div className="sticky top-0 z-50 bg-[var(--g-deep)] text-white text-sm py-3 px-5 flex items-center justify-between">
          <Link href="/" className="text-white/80 hover:text-white text-sm shrink-0">
            ← Rooted
          </Link>
          <span className="text-xs text-white/70 text-center flex-1 px-2">
            A peek at what family members see
          </span>
          <Link href="/signup" className="text-white text-xs font-semibold shrink-0 hover:text-white/90">
            Try it free →
          </Link>
        </div>
      ) : (
        <div className="sticky top-0 z-50 bg-[var(--g-deep)] text-white text-sm py-3 px-5 flex items-center justify-between">
          <Link href="/dashboard/settings" className="text-white/80 hover:text-white text-sm shrink-0">
            ← Back to Settings
          </Link>
          <span className="text-xs text-white/70 text-center flex-1 px-2">
            👁 Preview — this is what your family sees
          </span>
          <div className="w-20 shrink-0" />
        </div>
      )}

      {/* ── Shared feed, read-only (header + cards + lightbox) ───────── */}
      <FamilyFeed
        familyName={familyName}
        childrenList={childrenList}
        memories={memories}
        reactions={reactions}
        comments={comments}
        readOnly
      />

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#fefcf9] border-t border-[#e8e2d9] py-2.5 px-4 z-30" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-[480px] mx-auto text-center">
          {isDemo ? (
            <p className="text-xs text-[#7a6f65]">
              Want this for your homeschool?{" "}
              <Link href="/signup" className="font-semibold text-[var(--g-deep)] hover:underline">
                Start free →
              </Link>
            </p>
          ) : (
            <p className="text-xs text-[#7a6f65]">
              Everyone you invite sees this same feed 🌿
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
