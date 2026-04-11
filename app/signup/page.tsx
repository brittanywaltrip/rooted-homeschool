"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function capitalize(str: string) {
    return str.trim()
      ? str.trim().charAt(0).toUpperCase() + str.trim().slice(1).toLowerCase()
      : null;
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Validate required name fields
    if (!firstName.trim()) {
      setError("Please enter your first name.");
      setLoading(false);
      return;
    }
    if (!lastName.trim()) {
      setError("Please enter your last name.");
      setLoading(false);
      return;
    }

    const capFirst = capitalize(firstName);
    const capLast = capitalize(lastName);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: capFirst,
          last_name: capLast,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Explicitly upsert name into profiles so Settings page can read it
    const userId = data?.user?.id;
    if (userId) {
      await supabase.from("profiles").upsert(
        {
          id: userId,
          first_name: capFirst,
          last_name: capLast,
        },
        { onConflict: "id" }
      );
    }

    router.push("/onboarding");
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
      <div className="hidden lg:flex lg:w-1/2 bg-[#3d5c42] flex-col justify-center px-14 py-16">
        <Link href="/" className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">🌿</div>
          <span className="text-xl font-bold text-white">Rooted</span>
        </Link>

        <h2 className="text-3xl font-bold font-serif text-white leading-snug mb-8">
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

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {/* Mobile brand header */}
        <div className="lg:hidden w-full bg-[#3d5c42] px-6 py-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 justify-center mb-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-lg">🌿</div>
            <span className="text-xl font-bold text-white">Rooted</span>
          </Link>
          <p className="text-white/70 text-sm mt-1">Every lesson. Every memory. Every milestone.</p>
        </div>

        {/* Form area */}
        <div className="flex-1 bg-[#f8f7f4] flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">
            <h1 className="text-2xl font-bold font-serif text-[#2d2926] mb-1">Create your account</h1>
            <p className="text-sm text-[#7a6f65] mb-5">Start your family&apos;s learning journey.</p>

            {/* Google sign-in */}
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: `${window.location.origin}/auth/callback` },
                });
              }}
              className="w-full flex items-center justify-center gap-3 bg-white border border-[#e8e2d9] hover:bg-[#f8f7f4] text-[#2d2926] font-medium py-3 rounded-xl transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.01 24.01 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-[#e8e2d9]" />
              <span className="text-xs text-[#b5aca4]">or</span>
              <div className="flex-1 h-px bg-[#e8e2d9]" />
            </div>

            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#2d2926] mb-1.5">First name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#2d2926] mb-1.5">Last name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">Email address</label>
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
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">Password</label>
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
    </div>
  );
}
