// Verify a family's access token on the server without a round trip.
//
// API routes that take `Authorization: Bearer <access token>` used to call
// supabaseAdmin.auth.getUser(token), which asks the auth server to validate
// the token on every request: about 160 ms from Vercel to Supabase before the
// route's own query could start. /api/lists and /api/appointments each paid
// it on every dashboard load.
//
// The project signs tokens with ES256 and publishes the public key at
// /auth/v1/.well-known/jwks.json, so auth-js can verify signature and expiry
// locally. getClaims fetches the key set once per client (the admin client is
// a module singleton, so once per warm instance) and then verifies in about a
// millisecond. It falls back to the auth server by itself if a token ever
// arrives signed with the legacy HS256 secret, so nothing here assumes the
// key type.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { bearerToken, userIdFromClaims, type ClaimsResult } from "@/lib/access-token-claims";

/** The signed-in user's id from the request's bearer token, or null. */
export async function userIdFromRequest(req: { headers: { get(name: string): string | null } }): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const result = await supabaseAdmin.auth.getClaims(token);
    return userIdFromClaims(result as unknown as ClaimsResult);
  } catch {
    return null;
  }
}
