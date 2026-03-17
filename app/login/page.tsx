"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type View = "login" | "forgot" | "forgot-sent";

export default function LoginPage() {
  const router = useRouter();
  const [view,     setView]     = useState<View>("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else router.push("/dashboard");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setView("forgot-sent");
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-8">
        <span className="text-2xl">🌿</span>
        <span className="text-xl font-semibold text-[#5c7f63]">Rooted Homeschool</span>
      </Link>

      <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">

        {/* ── Login form ─────────────────────────────────────────────── */}
        {view === "login" && (
          <>
            <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Welcome back</h1>
            <p className="text-sm text-[#7a6f65] mb-7">Good to see you again.</p>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-[#2d2926]">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setError(""); setResetEmail(email); setView("forgot"); }}
                    className="text-xs text-[#5c7f63] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
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
                {loading ? "Logging in…" : "Log In"}
              </button>
            </form>

            <p className="text-center text-sm text-[#7a6f65] mt-6">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-[#5c7f63] font-medium hover:underline">
                Create one
              </Link>
            </p>
          </>
        )}

        {/* ── Forgot password form ───────────────────────────────────── */}
        {view === "forgot" && (
          <>
            <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Reset your password</h1>
            <p className="text-sm text-[#7a6f65] mb-7">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>

            <form onSubmit={handleForgot} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
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
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>

            <button
              onClick={() => { setError(""); setView("login"); }}
              className="w-full text-center text-sm text-[#7a6f65] hover:text-[#2d2926] mt-5 transition-colors"
            >
              ← Back to login
            </button>
          </>
        )}

        {/* ── Confirmation ───────────────────────────────────────────── */}
        {view === "forgot-sent" && (
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-[#e8f0e9] flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📬</span>
            </div>
            <h1 className="text-xl font-bold text-[#2d2926] mb-2">Check your email</h1>
            <p className="text-sm text-[#7a6f65] leading-relaxed mb-1">
              We sent a password reset link to
            </p>
            <p className="text-sm font-semibold text-[#2d2926] mb-6">{resetEmail}</p>
            <p className="text-xs text-[#b5aca4] mb-6">
              Didn&apos;t get it? Check your spam folder or{" "}
              <button
                onClick={() => { setError(""); setView("forgot"); }}
                className="text-[#5c7f63] hover:underline"
              >
                try again
              </button>
              .
            </p>
            <button
              onClick={() => { setError(""); setView("login"); }}
              className="w-full border border-[#e8e2d9] hover:bg-[#f0ede8] text-[#7a6f65] font-medium py-2.5 rounded-xl transition-colors text-sm"
            >
              ← Back to login
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
