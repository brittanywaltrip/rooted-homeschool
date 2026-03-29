"use client";

import { useState } from "react";
import Link from "next/link";

const AUDIENCE_RANGES = [
  "Under 1,000",
  "1,000–5,000",
  "5,000–20,000",
  "20,000+",
];

export default function PartnersPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformLinks, setPlatformLinks] = useState<Record<string, string>>({});
  const [platformSizes, setPlatformSizes] = useState<Record<string, string>>({});
  const [story, setStory] = useState("");
  const [whatToShare, setWhatToShare] = useState("");
  const [usedRooted, setUsedRooted] = useState("");
  const [postFrequency, setPostFrequency] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (selectedPlatforms.length === 0) {
      setError("Please select at least one platform.");
      setSubmitting(false);
      return;
    }

    const hasAtLeastOneLink = selectedPlatforms.some(p => platformLinks[p]?.trim());
    if (!hasAtLeastOneLink) {
      setError("Please provide at least one profile link.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/partners/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          platforms: selectedPlatforms,
          platformLinks,
          platformSizes,
          story,
          whatToShare,
          usedRooted,
          postFrequency,
          paypalEmail,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4]">

      {/* ── SECTION 1 — Hero (same as homepage) ────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center text-center px-6 py-28 min-h-[60vh] overflow-hidden"
        style={{
          background:
            "linear-gradient(175deg, #0d2818 0%, #1a4a28 20%, #3d7a4a 45%, #4a8a55 65%, #2d5c35 85%, #1a3a22 100%)",
        }}
      >
        {/* Forest background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          {/* Fireflies */}
          {[
            { top: "15%", left: "8%", size: 2.5 },
            { top: "25%", left: "18%", size: 1.5 },
            { top: "10%", left: "35%", size: 2 },
            { top: "20%", left: "55%", size: 1.5 },
            { top: "12%", left: "72%", size: 2.5 },
            { top: "30%", left: "88%", size: 1.5 },
            { top: "8%", left: "92%", size: 2 },
          ].map((s, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                top: s.top,
                left: s.left,
                width: s.size,
                height: s.size,
                opacity: 0.25,
                animation: `pulse ${2 + i * 0.3}s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}

          {/* Left large pine */}
          <svg className="absolute bottom-0 left-[-2%] h-[90%] w-auto opacity-40" viewBox="0 0 160 500" fill="none">
            <rect x="72" y="400" width="16" height="100" fill="#3d2010" />
            <polygon points="80,20 20,180 140,180" fill="#1a4a20" />
            <polygon points="80,80 15,240 145,240" fill="#1e5a25" />
            <polygon points="80,150 10,300 150,300" fill="#245e2a" />
            <polygon points="80,220 5,360 155,360" fill="#2a6830" />
            <polygon points="80,300 0,420 160,420" fill="#306838" />
          </svg>

          {/* Right large pine */}
          <svg className="absolute bottom-0 right-[-2%] h-[80%] w-auto opacity-35" viewBox="0 0 140 500" fill="none">
            <rect x="62" y="400" width="16" height="100" fill="#3d2010" />
            <polygon points="70,30 18,170 122,170" fill="#0d2818" />
            <polygon points="70,90 12,230 128,230" fill="#162a1e" />
            <polygon points="70,160 8,285 132,285" fill="#1e3828" />
            <polygon points="70,230 4,340 136,340" fill="#243e2e" />
            <polygon points="70,305 0,400 140,400" fill="#2a4835" />
          </svg>

          {/* Left mid pine */}
          <svg className="absolute bottom-0 left-[12%] h-[60%] w-auto opacity-30" viewBox="0 0 100 400" fill="none">
            <rect x="45" y="320" width="10" height="80" fill="#3d2010" />
            <polygon points="50,30 10,150 90,150" fill="#1a4a20" />
            <polygon points="50,90 5,200 95,200" fill="#1e5225" />
            <polygon points="50,155 0,265 100,265" fill="#245228" />
            <polygon points="50,225 0,330 100,330" fill="#2a5c2e" />
          </svg>

          {/* Right mid pine */}
          <svg className="absolute bottom-0 right-[14%] h-[55%] w-auto opacity-25" viewBox="0 0 100 400" fill="none">
            <rect x="45" y="320" width="10" height="80" fill="#3d2010" />
            <polygon points="50,40 12,155 88,155" fill="#122038" />
            <polygon points="50,100 8,210 92,210" fill="#162840" />
            <polygon points="50,165 4,270 96,270" fill="#1a3048" />
            <polygon points="50,235 0,335 100,335" fill="#1e3850" />
          </svg>

          {/* Moonlight glow */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] opacity-25 rounded-full"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(180,220,160,0.5) 0%, transparent 70%)",
            }}
          />

          {/* Ground fog */}
          <div
            className="absolute bottom-0 left-0 right-0 h-32"
            style={{
              background:
                "linear-gradient(to top, rgba(45,100,50,0.4) 0%, transparent 100%)",
            }}
          />

          {/* Forest floor */}
          <div
            className="absolute bottom-0 left-0 right-0 h-16"
            style={{
              background: "linear-gradient(to top, #0d2010 0%, transparent 100%)",
            }}
          />
        </div>

        {/* Vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.35) 100%)",
          }}
          aria-hidden="true"
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          <div className="text-5xl mb-5">🤝</div>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] mb-6 text-white"
            style={{
              fontFamily: "var(--font-display)",
              textShadow: "0 2px 32px rgba(0,0,0,0.4)",
              letterSpacing: "-0.02em",
            }}
          >
            Partner with{" "}
            <em className="not-italic" style={{ color: "#86c98a" }}>
              Rooted
            </em>
          </h1>
          <p
            className="text-lg sm:text-xl text-white/80 mb-10 leading-relaxed max-w-[36rem]"
            style={{
              textShadow: "0 1px 12px rgba(0,0,0,0.3)",
              letterSpacing: "0.01em",
            }}
          >
            Share something you actually believe in. Get a free subscription, a
            personal discount code, and earn commission on every family you
            refer.
          </p>
          <a
            href="#apply"
            className="inline-flex items-center justify-center gap-2 bg-white text-[#3d5c42] hover:bg-[#f0f9f1] font-bold px-8 py-4 rounded-xl transition-all text-base"
            style={{
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.35), 0 0 48px rgba(134,201,138,0.12)",
            }}
          >
            Apply Now →
          </a>
        </div>
      </section>

      {/* ── SECTION 2 — What you get ───────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 bg-[#f8f7f4]">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-[0.2em] mb-3 text-center">
            What you get
          </p>
          <h2
            className="text-2xl sm:text-3xl font-bold text-[#2d2926] text-center mb-12"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Everything you need to share Rooted with confidence.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                emoji: "⭐",
                title: "Free Founding Membership",
                body: "Your subscription is on us — forever. You get full access to every feature so your content is always real and firsthand. No expiry, no strings.",
              },
              {
                emoji: "🔗",
                title: "Your Personal Code & Link",
                body: "You'll get a discount code your followers use at checkout (15% off) and a referral link that applies the discount automatically. The easier it is for them, the more who convert.",
              },
              {
                emoji: "💰",
                title: "20% Commission",
                body: "Earn 20% on every new paying subscriber who uses your code — paid monthly. See your real-time stats right inside the Rooted app on your own ambassador dashboard.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6"
              >
                <div className="text-3xl mb-3">{card.emoji}</div>
                <h3
                  className="text-base font-bold text-[#2d2926] mb-2"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {card.title}
                </h3>
                <p className="text-sm text-[#7a6f65] leading-relaxed">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 2b — What your followers get ──────────────────────── */}
      <section className="px-6 sm:px-8 py-12 bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border-t border-b border-[#b8d9bc]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold text-[#3d5c42] uppercase tracking-[0.2em] mb-3">What your followers get</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
            Founding Family — $39/yr, locked forever
          </h2>
          <p className="text-sm text-[#3d5c42] leading-relaxed mb-4 max-w-lg mx-auto">
            Your code gives them 15% off the Founding Family plan — $39/yr locked in forever, no matter how much Rooted grows. This offer ends April 30.
          </p>
          <div className="inline-flex items-center gap-2 bg-white/70 border border-[#b8d9bc] rounded-xl px-4 py-2 text-sm text-[#2d2926] font-medium">
            {"\uD83C\uDF81"} Your code: 15% off {"\u00B7"} Their price: locked forever
          </div>
        </div>
      </section>

      {/* ── SECTION 3 — How it works ───────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 bg-[#fefcf9] border-t border-b border-[#e8e2d9]">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-[0.2em] mb-3 text-center">
            How it works
          </p>
          <h2
            className="text-2xl sm:text-3xl font-bold text-[#2d2926] text-center mb-12"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Three steps. That&apos;s it.
          </h2>

          <div className="space-y-10">
            {[
              {
                step: "1",
                title: "Apply below",
                body: "Tell us a little about yourself and your audience. We review every application personally.",
              },
              {
                step: "2",
                title: "Get set up",
                body: "We'll send you your code, your referral link, and your welcome package. Your ambassador dashboard goes live inside the app.",
              },
              {
                step: "3",
                title: "Share honestly",
                body: "Post when it feels right. No quotas, no deadlines. Your followers trust you — we just want you to share your real experience.",
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-[#3d5c42]">
                    {s.step}
                  </span>
                </div>
                <div>
                  <h3
                    className="text-base font-bold text-[#2d2926] mb-1"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {s.title}
                  </h3>
                  <p className="text-sm text-[#7a6f65] leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4 — Who we're looking for ──────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 bg-[#f8f7f4]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-[0.2em] mb-3">
            Who we&apos;re looking for
          </p>
          <h2
            className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-10"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Real homeschool voices.
          </h2>

          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {[
              { emoji: "📱", label: "Social media creators (Instagram, TikTok, YouTube)" },
              { emoji: "👥", label: "Facebook group leaders" },
              { emoji: "🎙️", label: "Podcast hosts & bloggers" },
            ].map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-2 bg-[#fefcf9] border border-[#e8e2d9] rounded-full px-4 py-2 text-sm text-[#2d2926]"
              >
                <span>{p.emoji}</span> {p.label}
              </span>
            ))}
          </div>

          <div className="text-left max-w-xl mx-auto space-y-4">
            <p className="text-sm text-[#5c5248] leading-relaxed">
              We&apos;re not looking for the biggest following — we&apos;re
              looking for the most trusted voice. If your audience listens to you
              about homeschooling, we want to talk.
            </p>
            <p className="text-sm text-[#5c5248] leading-relaxed">
              We currently work with a small, curated group of partners. Every
              application is reviewed personally by Brittany.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION 5 — FTC Disclosure ─────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-10 bg-[#f8f7f4]">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-6 py-5">
            <p className="text-xs text-[#7a6f65] leading-relaxed">
              Rooted partners are required to disclose their relationship with
              Rooted in all content featuring our app, per FTC guidelines.
              Commissions are calculated solely on verified Stripe transactions
              using your personal code. Earnings are not guaranteed and depend
              entirely on your audience&apos;s conversions. Either party may end
              the partnership at any time.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION 6 — Application form ───────────────────────────────── */}
      <section id="apply" className="px-6 sm:px-8 py-20 bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="max-w-xl mx-auto">
          <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-[0.2em] mb-3 text-center">
            Apply to partner
          </p>
          <h2
            className="text-2xl sm:text-3xl font-bold text-[#2d2926] text-center mb-10"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Let&apos;s grow together. 🌱
          </h2>

          {submitted ? (
            /* ── SECTION 7 — Success state ──────────────────────────────── */
            <div className="text-center py-12">
              <div className="text-6xl mb-5">🌱</div>
              <h3
                className="text-2xl font-bold text-[#2d2926] mb-4"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Application received!
              </h3>
              <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto mb-6">
                Thank you for applying to become a Rooted Partner. We review
                every application personally and will be in touch within 3–5
                business days.
              </p>
              <p className="text-sm text-[#5c7f63] font-medium">
                — Brittany, Founder of Rooted
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">
                    First name *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-[#f8f7f4] text-sm text-[#2d2926] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">
                    Last name *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-[#f8f7f4] text-sm text-[#2d2926] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">
                  Email address *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-[#f8f7f4] text-sm text-[#2d2926] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                />
              </div>

              {/* Platform checkboxes */}
              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">
                  Your platforms <span className="text-[#3d5c42]">*</span>
                </label>
                <p className="text-xs text-[#7a6f65] mb-3">Select all that apply</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { id: "instagram", label: "📸 Instagram" },
                    { id: "tiktok", label: "🎵 TikTok" },
                    { id: "youtube", label: "▶️ YouTube" },
                    { id: "facebook", label: "👥 Facebook Group" },
                    { id: "blog", label: "✍️ Blog" },
                    { id: "podcast", label: "🎙️ Podcast" },
                    { id: "pinterest", label: "📌 Pinterest" },
                    { id: "other", label: "🌐 Other" },
                  ].map(({ id, label }) => (
                    <label
                      key={id}
                      className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                        selectedPlatforms.includes(id)
                          ? "border-[#3d5c42] bg-[#f0f7f0]"
                          : "border-[#e8e2d9] bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlatforms.includes(id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPlatforms((prev) => [...prev, id]);
                          } else {
                            setSelectedPlatforms((prev) => prev.filter((p) => p !== id));
                            setPlatformLinks((prev) => {
                              const updated = { ...prev };
                              delete updated[id];
                              return updated;
                            });
                            setPlatformSizes((prev) => {
                              const updated = { ...prev };
                              delete updated[id];
                              return updated;
                            });
                          }
                        }}
                        className="accent-[#3d5c42]"
                      />
                      <span className="text-sm text-[#2d2926]">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Dynamic link + audience size per platform */}
                {selectedPlatforms.length > 0 && (
                  <div className="space-y-4">
                    <p className="text-xs font-semibold text-[#7a6f65] uppercase tracking-widest">
                      Your links &amp; audience
                    </p>
                    {selectedPlatforms.map((platformId) => {
                      const linkLabels: Record<string, string> = {
                        instagram: "Instagram profile URL",
                        tiktok: "TikTok profile URL",
                        youtube: "YouTube channel URL",
                        facebook: "Facebook group URL",
                        blog: "Blog URL",
                        podcast: "Podcast URL or show name",
                        pinterest: "Pinterest profile URL",
                        other: "Link or description",
                      };
                      const sizeLabel = platformId === "facebook" ? "members" : "followers";
                      return (
                        <div key={platformId} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-4 space-y-3">
                          <p className="text-xs font-semibold text-[#2d2926] capitalize">{linkLabels[platformId]?.split(" ")[0]}</p>
                          <input
                            type="text"
                            value={platformLinks[platformId] || ""}
                            onChange={(e) =>
                              setPlatformLinks((prev) => ({
                                ...prev,
                                [platformId]: e.target.value,
                              }))
                            }
                            placeholder={
                              platformId === "podcast"
                                ? "https://... or show name"
                                : "https://..."
                            }
                            className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                          />
                          <select
                            value={platformSizes[platformId] || ""}
                            onChange={(e) =>
                              setPlatformSizes((prev) => ({
                                ...prev,
                                [platformId]: e.target.value,
                              }))
                            }
                            className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                          >
                            <option value="">Approximate {sizeLabel}</option>
                            {AUDIENCE_RANGES.map((s) => (
                              <option key={s} value={s}>
                                {s} {sizeLabel}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">
                  Tell us about your homeschool journey *
                </label>
                <textarea
                  required
                  rows={4}
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  placeholder="Tell us about your family, what you homeschool, and why Rooted resonates with you..."
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-[#f8f7f4] text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-1.5">
                  What would you love to share about Rooted?
                </label>
                <textarea
                  rows={3}
                  value={whatToShare}
                  onChange={(e) => setWhatToShare(e.target.value)}
                  placeholder="Reels, stories, a blog post, a TikTok series, a group recommendation..."
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-[#f8f7f4] text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-2">
                  Have you used Rooted?
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Yes", "No", "I just signed up"].map((opt) => (
                    <label
                      key={opt}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm cursor-pointer transition-colors ${
                        usedRooted === opt
                          ? "bg-[#e8f0e9] border-[#5c7f63] text-[#3d5c42] font-semibold"
                          : "bg-[#f8f7f4] border-[#e8e2d9] text-[#7a6f65] hover:border-[#c8bfb5]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="usedRooted"
                        value={opt}
                        checked={usedRooted === opt}
                        onChange={(e) => setUsedRooted(e.target.value)}
                        className="sr-only"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-2">
                  How often do you post?
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Daily", "A few times a week", "Weekly", "A few times a month"].map((opt) => (
                    <label
                      key={opt}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm cursor-pointer transition-colors ${
                        postFrequency === opt
                          ? "bg-[#e8f0e9] border-[#5c7f63] text-[#3d5c42] font-semibold"
                          : "bg-[#f8f7f4] border-[#e8e2d9] text-[#7a6f65] hover:border-[#c8bfb5]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="postFrequency"
                        value={opt}
                        checked={postFrequency === opt}
                        onChange={(e) => setPostFrequency(e.target.value)}
                        className="sr-only"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-2">
                  PayPal email
                  <span className="text-[#7a6f65] font-normal normal-case tracking-normal ml-1">
                    (for monthly commission payouts — optional for now)
                  </span>
                </label>
                <input
                  type="email"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63] focus:border-transparent"
                />
                <p className="text-xs text-[#7a6f65] mt-2">
                  Commissions are paid on the 1st of each month for the previous month&apos;s verified conversions.
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[#3d5c42] hover:bg-[#2d4a32] disabled:opacity-60 text-white font-bold py-4 rounded-xl transition-colors text-base"
              >
                {submitting ? "Submitting..." : "Submit Application →"}
              </button>

              <p className="text-xs text-[#b5aca4] text-center">
                We review every application personally and respond within 3–5
                business days.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ── SECTION 8 — Bottom CTA ─────────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 bg-[#f8f7f4]">
        <div
          className="max-w-2xl mx-auto rounded-3xl px-8 py-14 sm:px-14 text-center relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, #d0ebd4 0%, #e0f2e4 35%, #c8e8cf 70%, #b8dfc0 100%)",
            border: "1px solid #aed4b5",
          }}
        >
          <span
            className="absolute top-5 left-5 text-[5rem] opacity-[0.10] select-none pointer-events-none leading-none"
            aria-hidden="true"
          >
            🌿
          </span>
          <span
            className="absolute bottom-5 right-6 text-[4.5rem] opacity-[0.10] select-none pointer-events-none leading-none"
            style={{ transform: "scaleX(-1) rotate(20deg)" }}
            aria-hidden="true"
          >
            🌿
          </span>

          <div className="relative z-10">
            <div className="text-5xl mb-5">🌱</div>
            <h2
              className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ready to share something you already love?
            </h2>
            <p className="text-[#3d5c42] font-medium mb-8 leading-relaxed max-w-sm mx-auto">
              Join our curated group of homeschool creators. No pressure, no
              quotas — just an honest partnership.
            </p>
            <a
              href="#apply"
              className="inline-block bg-[#5c7f63] hover:bg-[#4a6b50] text-white font-semibold px-8 py-3 rounded-full transition-colors"
            >
              Apply to Partner →
            </a>
          </div>
        </div>
      </section>

      {/* ── Personal note from Brittany ─────────────────────────────── */}
      <section className="px-6 sm:px-8 py-12 bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="max-w-xl mx-auto text-center">
          <div className="w-12 h-12 rounded-full bg-[#5c7f63] flex items-center justify-center text-white font-bold text-lg mx-auto mb-4">B</div>
          <p className="text-sm text-[#5c5248] leading-relaxed italic mb-4">
            &ldquo;I review every partner application personally. This isn&apos;t about big numbers — it&apos;s about real homeschool families helping other families find something that works. If that sounds like you, I&apos;d love to hear from you.&rdquo;
          </p>
          <p className="text-sm font-semibold text-[#3d5c42]">— Brittany, Founder</p>
          <p className="text-xs text-[#7a6f65] mt-2">
            Questions? Email{' '}
            <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-start">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">
                  🌿
                </div>
                <span
                  className="font-bold text-[#2d2926] text-base"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Rooted
                </span>
              </div>
              <p className="text-xs text-[#b5aca4] leading-relaxed">
                A calm companion for intentional families.
              </p>
              <p className="text-[11px] text-[#c8bfb5]">
                rootedhomeschoolapp.com
              </p>
            </div>

            <div className="flex items-center justify-center gap-5 flex-wrap">
              <Link href="/login" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Log In</Link>
              <Link href="/signup" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Sign Up</Link>
              <Link href="/privacy" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Privacy</Link>
              <Link href="/terms" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Terms</Link>
              <Link href="/faq" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">FAQ</Link>
              <Link href="/contact" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Contact</Link>
              <Link href="/partners" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Partners</Link>
            </div>

            <div className="text-center sm:text-right space-y-1">
              <p className="text-xs text-[#b5aca4]">
                © {new Date().getFullYear()} Rooted
              </p>
              <p className="text-xs text-[#c8bfb5]">
                Made with care for learning families
              </p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
