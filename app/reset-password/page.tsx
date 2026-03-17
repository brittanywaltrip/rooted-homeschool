"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type View = "form" | "success" | "invalid";

export default function ResetPasswordPage() {
  const router  = useRouter();
  const [view,     setView]     = useState<View>("form");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [ready,    setReady]    = useState(false); // session established from link

  // Supabase appends #access_token=...&type=recovery to the URL.
  // The client SDK picks this up automatically on load.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // If already in a recovery session (e.g. page reload), check now
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) setError(error.message);
    else setView("success");
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <span className="text-2xl">🌿</span>
        <span className="text-xl font-semibold text-[#5c7f63]">Rooted Homeschool</span>
      </Link>

      <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">

        {/* ── Success ──────────────────────────────────────────────────── */}
        {view === "success" && (
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-[#e8f0e9] flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✅</span>
            </div>
            <h1 className="text-xl font-bold text-[#2d2926] mb-2">Password updated!</h1>
            <p className="text-sm text-[#7a6f65] mb-6">
              Your password has been changed. You can now log in with your new password.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-medium py-3 rounded-xl transition-colors text-sm"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {/* ── Set new password form ─────────────────────────────────────── */}
        {view === "form" && (
          <>
            <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Set new password</h1>
            <p className="text-sm text-[#7a6f65] mb-7">
              Choose a strong password for your account.
            </p>

            {!ready && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                <p className="text-sm text-amber-700">
                  Waiting for the reset link to authenticate… if this persists, go back to your
                  email and click the link again.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2d2926] mb-1.5">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
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
                disabled={loading || !ready}
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors mt-1"
              >
                {loading ? "Saving…" : "Update Password"}
              </button>
            </form>

            <p className="text-center text-sm text-[#7a6f65] mt-5">
              <Link href="/login" className="text-[#5c7f63] hover:underline">
                ← Back to login
              </Link>
            </p>
          </>
        )}

      </div>
    </div>
  );
}
