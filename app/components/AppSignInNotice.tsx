"use client";

/**
 * Shown in place of the Google / Apple buttons inside the iOS app and the
 * home-screen PWA, where an OAuth round trip cannot come back to us. See
 * useIsOAuthHandoffContext in lib/platform.ts for the mechanism.
 *
 * The login wording matters: a family who originally joined with Google has
 * no password at all, so "just use your password" would strand them. Tapping
 * "Forgot password" sends a recovery email and lets them set one, which
 * works even on an account created through Google or Apple.
 */
export default function AppSignInNotice({ signup = false }: { signup?: boolean }) {
  return (
    <div className="rounded-xl border border-[#e8e2d9] bg-[#faf8f4] px-4 py-3 mb-1">
      <p className="text-[13px] text-[#2d2926] font-medium mb-1">
        {signup ? "Create your account with email" : "Sign in with your email"}
      </p>
      <p className="text-[12px] text-[#7a6f65] leading-relaxed">
        {signup
          ? "Email and a password is the quickest way in on the app, and it keeps you signed in."
          : (
            <>
              If you first joined Rooted with Google or Apple, tap{" "}
              <span className="font-medium">Forgot password</span> below once
              to set a password. After that it is the quickest way in.
            </>
          )}
      </p>
    </div>
  );
}
