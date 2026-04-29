"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type View = "login" | "forgot" | "forgot-sent";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view,     setView]     = useState<View>(searchParams.get("reset") === "true" ? "forgot" : "login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [error,    setError]    = useState(searchParams.get("error") || "");
  const [loading,  setLoading]  = useState(false);
  const passwordReset = searchParams.get("passwordReset") === "true";

  // OTP fallback for the recovery email — Microsoft Defender Safe Links
  // and similar scanners pre-click the magic link and consume the token,
  // so we expose the 6-digit code Supabase emits via {{.Token}} as a
  // scanner-immune alternative.
  const [otp, setOtp] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded")
      .eq("id", data.user.id)
      .maybeSingle();

    // onboarded === false means new user who hasn't completed setup
    router.push(profile?.onboarded === false ? "/onboarding" : "/dashboard");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: 'https://www.rootedhomeschoolapp.com/reset-password',
    });
    setLoading(false);
    if (error) setError(error.message);
    else { setOtp(""); setOtpError(""); setView("forgot-sent"); }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError("");
    setOtpVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email: resetEmail,
      token: otp.trim(),
      type: 'recovery',
    });
    setOtpVerifying(false);
    if (error) { setOtpError(error.message); return; }
    // Recovery session is now in cookies — /reset-password's existing
    // "session exists" branch picks it up and shows the set-new-password form.
    router.push('/reset-password');
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
      <div className="hidden lg:flex lg:w-1/2 bg-[var(--g-brand)] flex-col justify-center px-14 py-16">
        <Link href="/" className="inline-block mb-12">
          <img src="/rooted-logo-nav.png" alt="Rooted" className="h-9 w-auto brightness-0 invert" />
        </Link>

        <h2 className="text-3xl font-bold text-white leading-snug mb-8" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
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
          <Link href="/" className="inline-block mb-3">
            <img src="/rooted-logo-nav.png" alt="Rooted" className="h-8 w-auto" />
          </Link>
          <p className="text-sm text-[#7a6f65]">Every lesson. Every memory. Every milestone.</p>
        </div>

        <div className="w-full max-w-sm bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl shadow-sm p-8">

          {/* ── Login form ─────────────────────────────────────────────── */}
          {view === "login" && (
            <>
              {passwordReset && (
                <div className="bg-[#e8f0e9] border border-[#c8ddb8] rounded-xl px-4 py-3 mb-5 text-center">
                  <p className="text-sm font-medium text-[#2d5a3d]">Password updated! Log in with your new password.</p>
                </div>
              )}
              <h1 className="text-2xl font-bold font-serif text-[#2d2926] mb-1">Welcome back</h1>
              <p className="text-sm text-[#7a6f65] mb-5">Good to see you again.</p>

              <button
                type="button"
                onClick={async () => {
                  const browserClient = createSupabaseBrowserClient();
                  await browserClient.auth.signInWithOAuth({
                    provider: "google",
                    options: {
                      redirectTo: `${window.location.origin}/auth/callback`,
                      queryParams: { prompt: 'select_account' },
                    },
                  });
                }}
                className="w-full flex items-center justify-center gap-3 bg-white border border-[#e8e2d9] hover:bg-[#f8f7f4] text-[#2d2926] font-medium py-3 rounded-xl transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.01 24.01 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-[#e8e2d9]" />
                <span className="text-xs text-[#b5aca4]">or</span>
                <div className="flex-1 h-px bg-[#e8e2d9]" />
              </div>

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
                  className="w-full bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors mt-1"
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
              <h1 className="text-2xl font-bold font-serif text-[#2d2926] mb-1">Reset your password</h1>
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
                  className="w-full bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors"
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
              <h1 className="text-xl font-bold font-serif text-[#2d2926] mb-2">Check your email</h1>
              <p className="text-sm text-[#7a6f65] leading-relaxed mb-1">
                We sent a password reset link to
              </p>
              <p className="text-sm font-semibold text-[#2d2926] mb-6">{resetEmail}</p>
              <p className="text-xs text-[#b5aca4] mb-5">
                Didn&apos;t get it? Check your spam folder or{" "}
                <button
                  onClick={() => { setError(""); setView("forgot"); }}
                  className="text-[#5c7f63] hover:underline"
                >
                  try again
                </button>
                .
              </p>

              {/* OTP fallback — for users whose corporate email scanner */}
              {/* pre-clicks the magic link and burns the token. */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-px bg-[#e8e2d9]" />
                <span className="text-xs text-[#b5aca4]">or</span>
                <div className="flex-1 h-px bg-[#e8e2d9]" />
              </div>
              <p className="text-xs text-[#7a6f65] mb-2">
                Enter the 6-digit code from the email
              </p>
              <form onSubmit={handleVerifyOtp} className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  className="flex-1 px-3 py-2.5 text-center font-mono text-base tracking-widest rounded-xl border border-[#e8e2d9] bg-white text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                />
                <button
                  type="submit"
                  disabled={otpVerifying}
                  className="px-4 py-2.5 text-sm font-medium border border-[#e8e2d9] hover:bg-[#f0ede8] disabled:opacity-50 text-[#2d2926] rounded-xl transition-colors shrink-0"
                >
                  {otpVerifying ? "Verifying…" : "Verify Code"}
                </button>
              </form>
              {otpError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2 text-left">
                  {otpError}
                </p>
              )}

              <button
                onClick={() => { setError(""); setView("login"); }}
                className="w-full border border-[#e8e2d9] hover:bg-[#f0ede8] text-[#7a6f65] font-medium py-2.5 rounded-xl transition-colors text-sm mt-5"
              >
                ← Back to login
              </button>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
