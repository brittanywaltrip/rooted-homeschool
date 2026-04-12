"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function UnsubscribeInner() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleUnsubscribe() {
    if (!email) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <span className="text-4xl block mb-4">🌿</span>
          <h1 className="text-xl text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
            You&apos;ve been unsubscribed
          </h1>
          <p className="text-sm text-[#7a6f65] leading-relaxed mb-6">
            You won&apos;t receive any more marketing emails from Rooted. Your account and memories are still safe.
          </p>
          <Link href="/" className="text-sm font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors">
            Back to Rooted →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="text-4xl block mb-4">🌿</span>
        <h1 className="text-xl text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
          Unsubscribe from Rooted emails
        </h1>
        {email ? (
          <>
            <p className="text-sm text-[#7a6f65] leading-relaxed mb-6">
              Click below to stop receiving marketing emails at <strong>{email}</strong>. Your account won&apos;t be affected.
            </p>
            <button
              onClick={handleUnsubscribe}
              disabled={status === "loading"}
              className="bg-[#2d2926] hover:bg-[#1a1a1a] disabled:opacity-50 text-white font-medium px-6 py-3 rounded-xl transition-colors"
            >
              {status === "loading" ? "Unsubscribing..." : "Unsubscribe"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-600 mt-4">Something went wrong. Please try again or email hello@rootedhomeschoolapp.com</p>
            )}
          </>
        ) : (
          <p className="text-sm text-[#7a6f65]">
            Missing email address. Please use the unsubscribe link from your email, or contact hello@rootedhomeschoolapp.com
          </p>
        )}
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
