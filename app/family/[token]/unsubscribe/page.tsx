"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function UnsubscribePage() {
  const params = useParams();
  const token = params.token as string;

  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [familyName, setFamilyName] = useState("");

  useEffect(() => {
    async function unsubscribe() {
      try {
        const res = await fetch(`/api/family/${token}/unsubscribe`, {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          setFamilyName(data.familyName ?? "this family");
          setStatus("done");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    }
    unsubscribe();
  }, [token]);

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        {status === "loading" && (
          <span className="text-3xl animate-pulse">🌿</span>
        )}

        {status === "done" && (
          <>
            <div className="text-4xl mb-4">🌿</div>
            <h1
              className="text-lg font-medium text-[#2d2926] mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              You&apos;ve been unsubscribed
            </h1>
            <p className="text-sm text-[#7a6f65] leading-relaxed">
              You won&apos;t receive weekly updates from {familyName}&apos;s family page anymore.
              You can still visit their family page anytime using your original link.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-4xl mb-4">🌿</div>
            <h1
              className="text-lg font-medium text-[#2d2926] mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Something went wrong
            </h1>
            <p className="text-sm text-[#7a6f65]">
              We couldn&apos;t process your unsubscribe request. Please try again later.
            </p>
          </>
        )}

        <div className="mt-8 pt-6 border-t border-[#e8e2d9]">
          <a
            href="https://www.rootedhomeschoolapp.com"
            className="text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
          >
            🌿 Rooted — the homeschool memory book
          </a>
        </div>
      </div>
    </main>
  );
}
