"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
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
        data: { family_name: familyName },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/onboarding");
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-8">
        <span className="text-2xl">🌿</span>
        <span className="text-xl font-semibold text-[#5c7f63]">Rooted Homeschool</span>
      </Link>

      <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Create your account</h1>
        <p className="text-sm text-[#7a6f65] mb-7">Start your family's learning journey.</p>

        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
              Family name
            </label>
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="e.g. The Waltrip Family"
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
  );
}
