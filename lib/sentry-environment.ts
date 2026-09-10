// Which deployment a Sentry event came from.
//
// Every event used to report environment "production", because the three
// Sentry configs read NODE_ENV, and NODE_ENV is "production" for every Vercel
// build, preview and staging included. Of the 103 "Today projection missing
// lesson rows" events in the week before 2026-09-09, 46 came from HeadlessChrome
// on the staging URL, and nothing in Sentry could tell them from a family.
//
// Pure by design: next.config.ts computes the client value at build time from
// the Vercel system env vars, and the server/edge configs call it at runtime.
// No env read inside, so the tests can hand it any combination.

export type VercelEnvLike = {
  VERCEL_ENV?: string | undefined;
  VERCEL_GIT_COMMIT_REF?: string | undefined;
  // process.env has an index signature and no named keys, so accept one here
  // or TS refuses the call on "no properties in common".
  [key: string]: string | undefined;
};

/**
 * "production" on production, "preview:<branch>" on a preview deploy (so
 * staging shows as "preview:staging"), "development" everywhere else, which
 * includes local dev where VERCEL_ENV is unset.
 */
export function sentryEnvironment(env: VercelEnvLike): string {
  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") {
    const branch = env.VERCEL_GIT_COMMIT_REF?.trim();
    return branch ? `preview:${branch}` : "preview";
  }
  return "development";
}
