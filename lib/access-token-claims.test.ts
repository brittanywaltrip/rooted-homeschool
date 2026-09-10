// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken, userIdFromClaims } from "./access-token-claims.ts";

const req = (auth: string | null) => ({ headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? auth : null) } });

test("bearerToken reads the token and rejects other shapes", () => {
  assert.equal(bearerToken(req("Bearer abc.def.ghi")), "abc.def.ghi");
  assert.equal(bearerToken(req("bearer abc")), "abc");
  assert.equal(bearerToken(req(null)), null);
  assert.equal(bearerToken(req("Basic abc")), null);
  assert.equal(bearerToken(req("Bearer")), null);
  assert.equal(bearerToken(req("Bearer a b")), null);
});

test("userIdFromClaims accepts only a verified authenticated user", () => {
  assert.equal(userIdFromClaims({ data: { claims: { sub: "u1", role: "authenticated" } }, error: null }), "u1");
  assert.equal(userIdFromClaims({ data: { claims: { sub: "u1", role: "anon" } }, error: null }), null);
  assert.equal(userIdFromClaims({ data: { claims: { role: "authenticated" } }, error: null }), null);
  assert.equal(userIdFromClaims({ data: { claims: { sub: "", role: "authenticated" } }, error: null }), null);
  assert.equal(userIdFromClaims({ data: { claims: { sub: "u1", role: "authenticated" } }, error: { message: "expired" } }), null);
  assert.equal(userIdFromClaims({ data: null, error: null }), null);
});
