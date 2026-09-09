"use client";

import Link from "next/link";
import { useHasSession } from "@/app/hooks/useHasSession";

/**
 * The "← Back to Rooted" link at the top of /faq, /contact, /privacy and
 * /terms.
 *
 * These four pages are reachable from inside the iOS app, where "back to
 * Rooted" means the app, not the marketing site. A signed-out visitor gets the
 * link exactly as it has always been.
 */
export function MarketingBackLink() {
  const hasSession = useHasSession();
  return (
    <Link
      href={hasSession ? "/dashboard" : "/"}
      className="text-sm text-[#5c7f63] hover:underline"
    >
      ← Back to Rooted
    </Link>
  );
}

/**
 * The wordmark under it. Plain artwork for a signed-out visitor, which is what
 * it has always been; a way home for a family who is signed in.
 */
export function MarketingLogo() {
  const hasSession = useHasSession();
  const img = (
    <img
      src="/rooted-logo-nav.png"
      alt="Rooted"
      style={{ height: "36px", width: "auto" }}
    />
  );
  if (!hasSession) return img;
  return (
    <Link href="/dashboard" className="inline-flex items-center">
      {img}
    </Link>
  );
}

/**
 * The right-hand nav action on the marketing homepage. A signed-in family
 * reaching "/" got here with a query string on the URL (an affiliate or
 * campaign link, which the middleware deliberately does not redirect), so the
 * one thing they might want from this page is a way into the app.
 */
export function MarketingSignInLink({ className }: { className: string }) {
  const hasSession = useHasSession();
  return (
    <Link href={hasSession ? "/dashboard" : "/login"} className={className}>
      {hasSession ? "Open Rooted" : "Log In"}
    </Link>
  );
}
