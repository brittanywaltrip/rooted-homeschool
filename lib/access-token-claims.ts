// Who a bearer token belongs to, from verified claims. Pure; the verification
// itself is in lib/access-token.ts.

export type ClaimsResult = {
  data: { claims: { sub?: unknown; role?: unknown } } | null;
  error: { message?: string } | null;
};

/** The token after "Bearer ", or null when the header is missing or malformed. */
export function bearerToken(req: { headers: { get(name: string): string | null } }): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/**
 * The user id in a verified token, or null. Only a signed-in family's token
 * counts: the anon key is also a JWT, with role "anon" and no sub, and must
 * never reach a user-scoped query.
 */
export function userIdFromClaims(result: ClaimsResult): string | null {
  if (result.error || !result.data?.claims) return null;
  const { sub, role } = result.data.claims;
  if (role !== "authenticated") return null;
  if (typeof sub !== "string" || sub.length === 0) return null;
  return sub;
}
