import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { sentryEnvironment } from "./lib/sentry-environment";

const nextConfig: NextConfig = {
  // Sentry environment for the browser bundle. The Vercel system env vars are
  // available at build time but not to client code, so the value is computed
  // here and inlined. Server and edge read the same helper at runtime.
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment(process.env),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "gvkbegvvmhcrmxdorctk.supabase.co",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      {
        source: "/more/faq",
        destination: "/faq",
        permanent: true,
      },
      {
        source: "/partner",
        destination: "/partners",
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "rooted-homeschool",
  project: "rooted-homeschool",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
  automaticVercelMonitors: true,
  tunnelRoute: "/monitoring",
});
