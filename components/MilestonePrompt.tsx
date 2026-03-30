"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Link from "next/link";

interface MilestonePromptProps {
  milestone: string;
  message: string;
  badgeEmoji: string;
  onDismiss: () => void;
}

export default function MilestonePrompt({
  milestone,
  message,
  badgeEmoji,
  onDismiss,
}: MilestonePromptProps) {
  const [copied, setCopied] = useState(false);

  const ref = typeof window !== "undefined" ? localStorage.getItem("rooted_ref") : null;
  const upgradeHref = ref ? `/upgrade?ref=${ref}` : "/upgrade";

  async function handleShare() {
    const shareUrl = ref
      ? `https://www.rootedhomeschoolapp.com/upgrade?ref=${ref}`
      : "https://www.rootedhomeschoolapp.com/upgrade";

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Rooted",
          text: "Check out Rooted — a beautiful way to plan your homeschool and capture memories.",
          url: shareUrl,
        });
      } catch {
        // user cancelled share
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={onDismiss} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[#e8e2d9]" />
        </div>

        {/* Header */}
        <div className="rounded-2xl mx-5 px-5 py-6 text-center" style={{ background: "linear-gradient(135deg, #2d5a3d 0%, #3d7a50 100%)" }}>
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-colors"
          >
            <X size={16} />
          </button>
          <div className="text-5xl mb-3">{badgeEmoji}</div>
          <p className="text-white text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
            {milestone}
          </p>
          <p className="text-white/70 text-sm mt-2 leading-relaxed max-w-xs mx-auto">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          <Link
            href={upgradeHref}
            className="block w-full py-3 rounded-xl text-sm font-bold text-white text-center transition-all shadow-sm"
            style={{ backgroundColor: "#2d5a3d" }}
          >
            Upgrade — $39/yr →
          </Link>
          <button
            onClick={handleShare}
            className="w-full py-3 rounded-xl text-sm font-medium text-[#5c7f63] border border-[#e8e2d9] bg-white hover:bg-[#f0ede8] transition-colors"
          >
            {copied ? "Link copied!" : "Share with a friend →"}
          </button>
        </div>
      </div>
    </>
  );
}
