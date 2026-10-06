// Run with: npm test
//
// Guards the auth client upgrade that removed the dashboard's
// "Lock broken by another request with the 'steal' option" AbortError.
//
// On @supabase/auth-js 2.99.2 every browser tab serialised refreshes through a
// Navigator lock. A tab waiting longer than lockAcquireTimeout stole the lock,
// and the auto-refresh tick that held it (acquireTimeout 0) rethrew the raw
// AbortError from setInterval as an unhandled rejection. Reproduced in two
// Chromium tabs on rooted-staging, 2026-10-06 (see
// docs/AUTH-LOCK-INVESTIGATION-2026-10-06.md).
//
// From 2.107 the client coordinates refreshes without a lock. 2.117.1 is the
// first release where a tab that loses a concurrent refresh keeps the stored
// session instead of reading as signed out for one call (supabase-js #2698),
// so anything older than that is not a safe target either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AuthClient,
  NavigatorLockAcquireTimeoutError,
  navigatorLock,
} from "@supabase/supabase-js";

test("the installed auth client is at least 2.117.1", () => {
  const { version } = JSON.parse(
    readFileSync(new URL("../node_modules/@supabase/auth-js/package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const [major, minor, patch] = version.split(".").map(Number);
  assert.equal(major, 2);
  assert.ok(minor > 117 || (minor === 117 && patch >= 1), `auth-js ${version} predates the cross-tab refresh fix`);
});

test("the default auth client takes no lock, so it can never have one stolen", () => {
  const auth = new AuthClient({ url: "http://127.0.0.1:1/auth/v1", persistSession: false, autoRefreshToken: false });
  assert.equal((auth as unknown as { lock: unknown }).lock, null);
});

test("a stolen zero-timeout lock surfaces as a typed acquire timeout, not a raw AbortError", async () => {
  // Only reached if a custom `lock` is ever passed again (supabase-js #2616).
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let requests = 0;
  let calls = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: async () => {
          requests++;
          throw new DOMException("Lock broken by another request with the 'steal' option.", "AbortError");
        },
      },
    },
  });
  try {
    await assert.rejects(
      navigatorLock("rooted-test", 0, async () => {
        calls++;
      }),
      (e: unknown) => e instanceof NavigatorLockAcquireTimeoutError && (e as { isAcquireTimeout?: boolean }).isAcquireTimeout === true,
    );
    assert.equal(requests, 1, "must not steal the lock back");
    assert.equal(calls, 0, "must not run the callback");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
});
