"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Does this browser have a live Rooted session?
 *
 * For marketing pages that a signed-in family can reach from inside the app:
 * /faq, /contact, /privacy, /terms. Their "← Back to Rooted" link points at
 * "/", which for a signed-in family is the marketing homepage they have no use
 * for. The middleware bounces "/" to /dashboard now, so nobody is stranded
 * there, but pointing the link at the dashboard in the first place saves the
 * round trip.
 *
 * No server call and no network. `getSession()` reads the cookie locally, so
 * this is safe on a bad connection and costs nothing on a marketing page.
 *
 * Starts false and never blocks a render. Signed-out visitors therefore see
 * exactly what they see today, and a signed-in family who taps in the one
 * frame before the check resolves lands on "/" and gets redirected anyway.
 */
export function useHasSession(): boolean {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const client = createSupabaseBrowserClient();
        const { data, error } = await client.auth.getSession();
        if (cancelled) return;
        setHasSession(!error && !!data?.session);
      } catch {
        // A marketing page must never fail on account of this.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return hasSession;
}
