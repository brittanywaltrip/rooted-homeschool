"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getUserAccess, getTrialDaysLeft } from "@/lib/user-access";

export default function UpgradeBanner() {
  const [bannerState, setBannerState] = useState<"hidden" | "trial" | "upgrade">("hidden");
  const [daysLeft, setDaysLeft] = useState(0);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("rooted_banner_dismissed") === "1"
  );

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_pro, trial_started_at, created_at")
        .eq("id", session.user.id)
        .single();
      if (!profile) return;

      const access = getUserAccess({
        is_pro: (profile as any).is_pro,
        trial_started_at: (profile as any).trial_started_at,
      });

      if (access === "pro") return; // paying user — no banner

      if (access === "trial") {
        const left = getTrialDaysLeft((profile as any).trial_started_at);
        setDaysLeft(left);
        // Only show trial banner in the last 8 days
        if (left <= 8) setBannerState("trial");
        return;
      }

      // Free user (trial expired) — show upgrade banner
      // But only if account is 48+ hours old (don't nag brand new users)
      const accountAge = Date.now() - new Date((profile as any).created_at).getTime();
      if (accountAge > 48 * 60 * 60 * 1000) {
        setBannerState("upgrade");
      }
    });
  }, []);

  if (bannerState === "hidden" || dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-[var(--g-deep)] to-[#5c7f63] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-lg shrink-0">🌿</span>
        <div>
          {bannerState === "trial" ? (
            <>
              <p className="text-white text-xs font-semibold leading-tight">
                {daysLeft <= 1
                  ? "Your Rooted+ trial ends today"
                  : `Your Rooted+ trial ends in ${daysLeft} days`}
              </p>
              <p className="text-white/70 text-[11px] leading-tight mt-0.5">
                {daysLeft <= 1
                  ? "Upgrade now to keep unlimited photos, exports, and family sharing."
                  : daysLeft <= 3
                  ? "Don't lose your exports, unlimited photos, and family sharing."
                  : "Keep unlimited photos, exports, and family sharing."}
              </p>
            </>
          ) : (
            <>
              <p className="text-white text-xs font-semibold leading-tight">
                Keep everything you&apos;ve built — upgrade to Rooted+
              </p>
              <p className="text-white/70 text-[11px] leading-tight mt-0.5">
                Unlimited photos, PDF exports, and family sharing · $39/yr
              </p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/upgrade"
          className="bg-white text-[var(--g-deep)] text-xs font-bold px-4 py-1.5 rounded-full hover:bg-[#f0f9f1] transition-colors whitespace-nowrap"
        >
          {bannerState === "trial" ? "Upgrade now →" : "Get Rooted+ →"}
        </Link>
        <button
          onClick={() => { sessionStorage.setItem("rooted_banner_dismissed", "1"); setDismissed(true); }}
          className="text-white/50 hover:text-white text-lg leading-none transition-colors"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
