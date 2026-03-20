"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function UpgradeBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase
        .from("profiles")
        .select("is_pro")
        .eq("id", session.user.id)
        .single();
      if (data && !data.is_pro) setShow(true);
    });
  }, []);

  // Calculate days until April 30 2026
  const daysLeft = Math.max(0, Math.ceil(
    (new Date("2026-04-30").getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  ));

  if (!show || dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-[#3d5c42] to-[#5c7f63] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-lg shrink-0">🌱</span>
        <div>
          <p className="text-white text-xs font-semibold leading-tight">
            Founding Family pricing ends in {daysLeft} day{daysLeft !== 1 ? "s" : ""} — lock in $39/yr forever
          </p>
          <p className="text-white/70 text-[11px] leading-tight mt-0.5">
            Memories, insights, transcripts & more. First 200 families only.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/upgrade"
          className="bg-white text-[#3d5c42] text-xs font-bold px-4 py-1.5 rounded-full hover:bg-[#f0f9f1] transition-colors whitespace-nowrap"
        >
          Claim your spot →
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="text-white/50 hover:text-white text-lg leading-none transition-colors"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
