import { NextResponse } from "next/server";
import { publicEnvIdentity } from "@/lib/env-identity";

export const dynamic = "force-dynamic";

/**
 * Which environment and which database is this deployment actually using?
 *
 * Until 2026-09-19 nobody could answer that without reading Vercel settings,
 * which is why staging pointed at the production Supabase project unnoticed.
 *
 * Returns ROOTED_ENV and the non-secret project ref, and NOTHING else. A
 * project ref is a public identifier that appears in every client-side
 * Supabase URL; keys never appear here.
 */
export async function GET() {
  const identity = publicEnvIdentity({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    rootedEnv: process.env.ROOTED_ENV,
    expectedRef: process.env.ROOTED_EXPECTED_SUPABASE_REF,
  });

  // 200 even when misconfigured: this endpoint exists to REPORT the problem,
  // so it must stay reachable when the problem is present.
  return NextResponse.json(
    { env: identity.env, projectRef: identity.projectRef, identityOk: identity.ok, error: identity.error ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
