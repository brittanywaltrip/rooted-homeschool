"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function GiftPageInner() {
  const searchParams = useSearchParams();
  const isSuccess = searchParams.get("success") === "true";
  const [email, setEmail] = useState("");
  const [gifterName, setGifterName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), gifterName: gifterName.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setLoading(false);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Could not create checkout. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <span className="text-5xl block mb-4">🎁</span>
          <h1 className="text-2xl text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
            Your gift is on its way!
          </h1>
          <p className="text-sm text-[#7a6f65] leading-relaxed mb-6">
            They&apos;ll be notified that someone special gifted them a year of Rooted.
            What a beautiful thing to give.
          </p>
          <Link href="/" className="text-sm font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors">
            Back to Rooted →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      {/* Header */}
      <div className="bg-[var(--g-deep)] px-6 py-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-1">
          <span className="text-2xl">🌿</span>
          <span className="text-xl font-bold text-white">Rooted</span>
        </Link>
      </div>

      <div className="max-w-md mx-auto px-6 py-12">
        {/* Headline */}
        <h1 className="text-3xl text-[#2d2926] text-center mb-3" style={{ fontFamily: "var(--font-display)" }}>
          Give the gift of memories.
        </h1>
        <p className="text-sm text-[#7a6f65] text-center leading-relaxed mb-10">
          The homeschool years go fast. Give a family the gift of holding onto them forever.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#2d2926] mb-1.5">Family&apos;s email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mom@example.com"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#2d2926] mb-1.5">Your name <span className="text-[#b5aca4] font-normal">(optional)</span></label>
            <input
              type="text"
              value={gifterName}
              onChange={(e) => setGifterName(e.target.value)}
              placeholder="Grandma"
              className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#3d6b47] hover:bg-[var(--g-brand)] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {loading ? "Loading..." : "Gift a year of Rooted — $59 →"}
          </button>
        </form>

        {/* Trust bullets */}
        <div className="mt-6 space-y-2 text-center">
          <p className="text-xs text-[#9a8f85]">🔒 Secure checkout via Stripe</p>
          <p className="text-xs text-[#9a8f85]">🎁 They&apos;ll be notified instantly</p>
          <p className="text-xs text-[#9a8f85]">🌿 Full year of unlimited memories, yearbook & more</p>
        </div>

        <p className="text-xs text-[#b5aca4] text-center mt-6">
          Already have their family link? You can gift directly from there too.
        </p>
      </div>
    </main>
  );
}

export default function GiftPage() {
  return (
    <Suspense fallback={null}>
      <GiftPageInner />
    </Suspense>
  );
}
