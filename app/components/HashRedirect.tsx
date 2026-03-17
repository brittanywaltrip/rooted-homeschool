"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Placed on the homepage to catch Supabase auth hash fragments
 * (e.g. password reset links) that land on the root URL instead
 * of the intended redirect target.
 */
export default function HashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.slice(1); // strip leading #
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const type   = params.get("type");

    if (type === "recovery") {
      // Preserve the full hash so reset-password page can read the tokens
      router.replace("/reset-password" + window.location.hash);
    }
  }, [router]);

  return null;
}
