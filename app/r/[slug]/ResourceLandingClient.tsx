"use client";

import { useEffect, useRef } from "react";
import { posthog } from "@/lib/posthog";

/** Counts the landing once per mount. The page itself stays a server component. */
export default function ResourceLandingTracker({ resourceId, slug }: { resourceId: string; slug: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    posthog.capture("resource_landing_viewed", {
      resource_id: resourceId,
      slug,
      referrer: document.referrer || null,
    });
  }, [resourceId, slug]);
  return null;
}

/**
 * The page's main button. An external printable opens in a new tab; an
 * internal link (a Rooted tool) goes to signup in the same tab.
 */
export function ResourceLandingButton({
  href,
  label,
  resourceId,
  slug,
  external,
}: {
  href: string;
  label: string;
  resourceId: string;
  slug: string;
  external: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={() => posthog.capture("resource_landing_clicked", { resource_id: resourceId, slug })}
      className="flex items-center justify-center w-full py-3.5 rounded-xl bg-[#2d5a3d] hover:bg-[#3d5c42] text-white font-semibold text-base transition-colors"
    >
      {label}
    </a>
  );
}
