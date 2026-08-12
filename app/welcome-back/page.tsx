"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Where a family lands when they sign in to an account that was deleted.
 *
 * Account deletion can leave the auth.users row behind while wiping every
 * public table (see app/api/account/delete/route.ts). The person can still
 * sign in, has no profile row, and used to be dropped straight into
 * onboarding as if they were brand new: no memories, no children, no
 * explanation. A paying family hit exactly that on August 12, 2026.
 *
 * This page is the explanation. It never pretends the data is recoverable,
 * because it isn't, and it gives a real support address for anyone who
 * didn't expect to be here.
 */

type Status = {
  wasDeleted: boolean;
  deletedAt: string | null;
  firstName: string | null;
  wasPaid: boolean;
  hasProfile: boolean;
};

function formatDeletedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function WelcomeBackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }
      const res = await fetch("/api/account/deleted-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        setLoading(false);
        setError("We couldn't load your account. Please try again.");
        return;
      }
      const body = (await res.json()) as Status;
      if (cancelled) return;
      // Anyone who reaches this URL without a matching deletion (a stale
      // link, a bookmark, a family who already started fresh) belongs on
      // the normal path, not on an explanation for something that didn't
      // happen to them.
      if (!body.wasDeleted || body.hasProfile) {
        router.replace(body.hasProfile ? "/dashboard" : "/onboarding");
        return;
      }
      setStatus(body);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function startFresh() {
    if (starting) return;
    setStarting(true);
    setError(null);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }
    const res = await fetch("/api/account/deleted-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong. Please try again.");
      setStarting(false);
      return;
    }
    router.push("/onboarding");
  }

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--g-deep, #1a2c22)" }}
      >
        <p className="text-sm text-white/70">Loading...</p>
      </div>
    );
  }

  const when = formatDeletedAt(status?.deletedAt ?? null);
  const name = status?.firstName?.trim();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: "var(--g-deep, #1a2c22)" }}
    >
      <Link href="/" className="inline-block mb-10">
        <img src="/rooted-logo-white.png" alt="Rooted" className="h-10 w-auto" />
      </Link>

      <div className="w-full max-w-md bg-[#fefcf9] border border-[#e8e2d9] rounded-3xl shadow-xl px-8 py-10 sm:px-10 text-center">
        <h1 className="text-3xl font-medium font-serif text-[#2d2926] mb-4">
          {name ? `Welcome back, ${name}` : "Welcome back"}
        </h1>

        <p className="text-sm text-[#2d2926] leading-relaxed mb-4">
          {when
            ? `Your Rooted account was deleted on ${when}, so there's nothing here to sign back in to.`
            : "Your Rooted account was deleted, so there's nothing here to sign back in to."}{" "}
          Your memories, photos, lessons, and your children&apos;s information were
          permanently removed at that point, and we can&apos;t bring them back.
        </p>

        {status?.wasPaid && (
          <p className="text-sm text-[#7a6f65] leading-relaxed mb-4">
            Your Rooted+ subscription was cancelled at the same time, so you
            haven&apos;t been charged since.
          </p>
        )}

        <p className="text-sm text-[#7a6f65] leading-relaxed mb-8">
          You&apos;re welcome to start a new family from scratch whenever
          you&apos;re ready. If you didn&apos;t delete this account, or something
          here looks wrong, please email us at{" "}
          <a
            href="mailto:hello@rootedhomeschoolapp.com"
            className="text-[#5c7f63] underline underline-offset-2"
          >
            hello@rootedhomeschoolapp.com
          </a>{" "}
          before you go any further and we&apos;ll look into it with you.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 border border-[#e8c8c8] bg-[#fdf4f4] rounded-xl px-4 py-3"
          >
            <p className="text-sm text-[#9a3a3a]">{error}</p>
          </div>
        )}

        <button
          onClick={startFresh}
          disabled={starting}
          className="w-full px-5 py-3.5 rounded-full text-white text-sm font-medium shadow-sm transition-colors disabled:opacity-40 hover:brightness-110"
          style={{ background: "var(--g-brand, #2d5a3d)" }}
        >
          {starting ? "Setting things up..." : "Start a new family"}
        </button>

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = "/";
          }}
          className="w-full mt-4 py-2 text-sm text-[#7a6f65] hover:text-[#2d2926] underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>

      <p className="mt-8 text-sm font-serif italic text-white/70">
        Cheering you on, Brittany
      </p>
    </div>
  );
}
