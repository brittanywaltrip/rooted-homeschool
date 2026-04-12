"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Feature comparison data ──────────────────────────────────────────────────

type FeatureRow = { label: string; free: string; founding: string; standard: string; foundingOnly?: boolean };

const features: FeatureRow[] = [
  { label: "Daily lesson logging",           free: "✓",              founding: "✓",            standard: "✓"           },
  { label: "Garden & growing trees",         free: "✓",              founding: "✓",            standard: "✓"           },
  { label: "Unlimited children",             free: "✓",              founding: "✓",            standard: "✓"           },
  { label: "Photo memories & book log",      free: "50 photos · 30 days", founding: "✓ Unlimited", standard: "✓ Unlimited" },
  { label: "Full memory history",            free: "—",              founding: "✓",            standard: "✓"           },
  { label: "AI Year in Review",              free: "1 / year",       founding: "✓ Unlimited",  standard: "✓ Unlimited" },
  { label: "Progress reports",   free: "—",              founding: "✓",            standard: "✓"           },
  { label: "Finish Line curriculum pacing",  free: "—",              founding: "✓",            standard: "✓"           },
  { label: "Priority support",               free: "—",              founding: "✓",            standard: "—"           },
  { label: "Founding price locked forever",  free: "—",              founding: "Forever 🎁",   standard: "—",          foundingOnly: true },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Cell({ value, highlight }: { value: string; highlight?: boolean }) {
  const isCheck = value === "✓";
  const isDash = value === "—";
  return (
    <td className={`py-3 px-4 text-center text-xs font-medium ${highlight ? "bg-[#f0f7f0]" : ""}`}>
      {isCheck ? (
        <Check size={15} strokeWidth={2.5} className="inline text-[#5c7f63]" />
      ) : isDash ? (
        <Minus size={14} strokeWidth={2} className="inline text-[#d4cfc9]" />
      ) : (
        <span className={highlight ? "text-[#3d5c42]" : "text-[#7a6f65]"}>{value}</span>
      )}
    </td>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPricingPage() {
  const [isPro, setIsPro] = useState<boolean | null>(null);

  useEffect(() => { document.title = "Pricing \u00b7 Rooted"; }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setIsPro(false); return; }
      const { data } = await supabase
        .from("profiles")
        .select("subscription_status")
        .eq("id", user.id)
        .maybeSingle();
      setIsPro((data as { subscription_status?: string } | null)?.subscription_status === "active");
    });
  }, []);

  const loaded = isPro !== null;

  return (
    <div className="max-w-4xl px-5 py-8 space-y-10">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Plans &amp; Pricing
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Choose your plan 🌿</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Rooted is free to start. Upgrade for AI features and curriculum pacing.
        </p>
      </div>

      {/* Pro active banner */}
      {loaded && isPro && (
        <div className="flex items-center gap-3 bg-[#e8f5ea] border border-[#b8d9bc] rounded-2xl px-5 py-3.5">
          <span className="text-lg">✨</span>
          <div>
            <p className="text-sm font-semibold text-[#3d5c42]">You&apos;re on Rooted Pro</p>
            <p className="text-xs text-[#5c7f63]">You have full access to all features below.</p>
          </div>
        </div>
      )}

      {/* Founding spots counter */}
      <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 w-fit">
        <span className="text-base">⏳</span>
        <p className="text-xs font-medium text-amber-800">
          Founding Family pricing · Lock in $39/yr before it ends
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Free Forever */}
        <div className={`relative bg-[#fefcf9] border-2 rounded-2xl p-5 flex flex-col ${
          loaded && !isPro ? "border-[#5c7f63]" : "border-[#e8e2d9]"
        }`}>
          {loaded && !isPro && (
            <span className="absolute -top-3 left-4 text-[10px] font-bold bg-[#5c7f63] text-white px-2.5 py-1 rounded-full uppercase tracking-wide">
              Your current plan
            </span>
          )}
          <div className="mb-4">
            <p className="text-base font-bold text-[#2d2926] mb-1">Free Forever</p>
            <p className="text-xs text-[#7a6f65] leading-relaxed">Lesson logging, garden, reports, and unlimited children — always free.</p>
          </div>
          <div className="mb-5">
            <span className="text-3xl font-bold text-[#2d2926]">$0</span>
          </div>
          <div className="space-y-1.5 mb-6 flex-1">
            {["Lesson logging", "Garden", "Unlimited children", "50 photos", "Memories — last 30 days", "1 AI Year in Review / year"].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-[#5c5248]">
                <Check size={12} strokeWidth={2.5} className="text-[#5c7f63] shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <div className="mt-auto">
            {loaded && !isPro ? (
              <div className="w-full text-center py-2.5 rounded-xl bg-[#f0ede8] text-xs font-medium text-[#7a6f65]">
                Current plan
              </div>
            ) : (
              <div className="w-full text-center py-2.5 rounded-xl bg-[#f0ede8] text-xs font-medium text-[#b5aca4]">
                Free plan
              </div>
            )}
          </div>
        </div>

        {/* Founding Family */}
        <div className={`relative bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border-2 rounded-2xl p-5 flex flex-col ${
          loaded && isPro ? "border-[#5c7f63]" : "border-[#5c7f63]"
        }`}>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-base font-bold text-[#2d2926]">Founding Family</p>
            <span className="text-[9px] font-bold bg-[#5c7f63] text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">
              Limited
            </span>
          </div>
          {loaded && isPro && (
            <span className="inline-block mb-2 text-[10px] font-bold bg-[#5c7f63] text-white px-2.5 py-1 rounded-full uppercase tracking-wide w-fit">
              Your current plan
            </span>
          )}
          <p className="text-xs text-[#5c7f63] mb-4 leading-relaxed">Lock in forever — price never increases for you.</p>
          <div className="mb-5">
            <span className="text-3xl font-bold text-[#2d2926]">$39</span>
            <span className="text-sm text-[#7a6f65]">/yr</span>
            <p className="text-[10px] text-[#5c7f63] mt-0.5">≈ $3.25/month</p>
          </div>
          <div className="space-y-1.5 mb-6 flex-1">
            {["Everything in Free", "Unlimited photos", "Full memory history", "Unlimited AI Year in Review", "Finish Line pacing", "Priority support", "Price locked forever ✦"].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-[#3d5c42]">
                <Check size={12} strokeWidth={2.5} className="text-[#5c7f63] shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <div className="mt-auto">
            {loaded && isPro ? (
              <div className="w-full text-center py-2.5 rounded-xl bg-[#5c7f63]/20 text-xs font-semibold text-[#3d5c42]">
                ✓ Active
              </div>
            ) : (
              <Link
                href="/upgrade"
                className="block w-full text-center py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-xs font-bold transition-colors shadow-sm"
              >
                Subscribe — $39/yr →
              </Link>
            )}
          </div>
        </div>

        {/* Standard */}
        <div className="relative bg-[#fefcf9] border-2 border-[#e8e2d9] rounded-2xl p-5 flex flex-col">
          <p className="text-base font-bold text-[#2d2926] mb-1">Standard</p>
          <p className="text-xs text-[#7a6f65] mb-4 leading-relaxed">Full access, billed annually.</p>
          <div className="mb-5">
            <span className="text-3xl font-bold text-[#2d2926]">$59</span>
            <span className="text-sm text-[#7a6f65]">/yr</span>
            <p className="text-[10px] text-[#b5aca4] mt-0.5">≈ $4.92/month</p>
          </div>
          <div className="space-y-1.5 mb-6 flex-1">
            {["Everything in Free", "Unlimited photos", "Full memory history", "Unlimited AI Year in Review", "Finish Line pacing"].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-[#5c5248]">
                <Check size={12} strokeWidth={2.5} className="text-[#5c7f63] shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <div className="mt-auto">
            {loaded && isPro ? (
              <div className="w-full text-center py-2.5 rounded-xl bg-[#f0ede8] text-xs font-medium text-[#b5aca4]">
                Standard plan
              </div>
            ) : (
              <Link
                href="/upgrade"
                className="block w-full text-center py-2.5 rounded-xl bg-[#2d2926] hover:bg-[#1a1714] text-white text-xs font-bold transition-colors"
              >
                Subscribe — $59/yr →
              </Link>
            )}
          </div>
        </div>

        {/* Monthly */}
        <div className="relative bg-[#fefcf9] border-2 border-[#e8e2d9] rounded-2xl p-5 flex flex-col">
          <p className="text-base font-bold text-[#2d2926] mb-1">Monthly</p>
          <p className="text-xs text-[#7a6f65] mb-4 leading-relaxed">Most flexible — cancel anytime</p>
          <div className="mb-5">
            <span className="text-3xl font-bold text-[#2d2926]">$6.99</span>
            <span className="text-sm text-[#7a6f65]">/mo</span>
            <p className="text-[10px] text-[#b5aca4] mt-0.5">$6.99/mo · $83.88/yr</p>
          </div>
          <div className="space-y-1.5 mb-6 flex-1">
            {["Everything in Free", "Unlimited photos", "Full memory history", "Unlimited AI Year in Review", "Finish Line pacing"].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-[#5c5248]">
                <Check size={12} strokeWidth={2.5} className="text-[#5c7f63] shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <div className="mt-auto">
            {loaded && isPro ? (
              <div className="w-full text-center py-2.5 rounded-xl bg-[#f0ede8] text-xs font-medium text-[#b5aca4]">
                Monthly plan
              </div>
            ) : (
              <Link
                href="/upgrade"
                className="block w-full text-center py-2.5 rounded-xl border border-[#e8e2d9] text-[#7a6f65] hover:bg-[#f0ede8] text-xs font-bold transition-colors"
              >
                Subscribe — $6.99/mo →
              </Link>
            )}
          </div>
        </div>

      </div>

      {/* Feature comparison table */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Full feature comparison</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e8e2d9] bg-[#f8f5f0]">
                <th className="py-3 px-4 text-left text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">
                  Feature
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">
                  Free
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-[#5c7f63] uppercase tracking-wide">
                  Founding
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">
                  Standard
                </th>
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr
                  key={f.label}
                  className={`border-b border-[#f0ede8] last:border-0 ${i % 2 === 0 ? "" : "bg-[#faf8f5]"}`}
                >
                  <td className="py-3 px-4 text-xs text-[#5c5248] font-medium">
                    {f.label}
                    {f.foundingOnly && (
                      <span className="ml-1.5 text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full uppercase">
                        Founding only
                      </span>
                    )}
                  </td>
                  <Cell value={f.free} />
                  <Cell value={f.founding} highlight />
                  <Cell value={f.standard} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer note */}
      {loaded && !isPro && (
        <div className="text-center pb-4">
          <Link
            href="/upgrade"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <span>✨</span>
            Upgrade to Pro — $39/yr
          </Link>
          <p className="text-xs text-[#b5aca4] mt-2">
            Secure checkout via Stripe · Cancel anytime
          </p>
        </div>
      )}

      <div className="h-2" />
    </div>
  );
}
