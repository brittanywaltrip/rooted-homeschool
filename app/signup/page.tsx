"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          family_name: familyName,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/onboarding");
    }
  }

  const bullets = [
    "Plan your week in minutes",
    "Watch their tree grow with every lesson",
    "Capture memories automatically",
    "Look back on everything they've learned this year",
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── Left panel — desktop only ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#5c7f63] flex-col justify-center px-14 py-16">
        <Link href="/" className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">🌿</div>
          <span className="text-xl font-bold text-white">Rooted Homeschool</span>
        </Link>

        <h2 className="text-3xl font-bold text-white leading-snug mb-8">
          Every lesson.<br />Every memory.<br />Every milestone.
        </h2>

        <ul className="space-y-4">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-white/90 text-sm font-medium">{b}</span>
            </li>
          ))}
        </ul>

        <p className="mt-12 text-white/50 text-xs">Free to start · No credit card needed</p>
      </div>

      {/* ── Right panel — form ────────────────────────────────────────────── */}
      <div className="flex-1 bg-[#f8f7f4] flex flex-col items-center justify-center px-6 py-12">

        {/* Mobile logo + tagline */}
        <div className="lg:hidden text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-3">
            <span className="text-2xl">🌿</span>
            <span className="text-xl font-semibold text-[#5c7f63]">Rooted Homeschool</span>
          </Link>
          <p className="text-sm text-[#7a6f65]">Every lesson. Every memory. Every milestone.</p>
        </div>

        <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Create your account</h1>
          <p className="text-sm text-[#7a6f65] mb-7">Start your family&apos;s learning journey.</p>

          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {/* First + Last name — side by side on desktop */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                  First name
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                  Last name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                Family name
              </label>
              <input
                type="text"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="e.g. The Smith Family"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
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
              className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors mt-1"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <p className="text-center text-sm text-[#7a6f65] mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-[#5c7f63] font-medium hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>

    </div>
  );
}
