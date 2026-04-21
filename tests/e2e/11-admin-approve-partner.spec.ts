import { test, expect } from "./fixtures";

// Same reasoning as 10: test user is not in the admin allowlist, so the
// partner-action endpoint returns 403. We assert that contract; swap for
// the happy-path approve flow once the test user is promoted or once we
// stand up a dedicated admin fixture user.

test("admin-only /api/admin/partner-action rejects the test user", async ({
  page,
}) => {
  const resp = await page.request.post("/api/admin/partner-action", {
    data: {
      action: "approve",
      applicationId: "00000000-0000-0000-0000-000000000000",
      name: "E2E",
      contactEmail: "never-used@example.com",
      rootedAccountEmail: "",
      paypalEmail: "",
      code: "E2ETEST",
      stripeCouponId: "dummy",
      stripeApiId: "",
      commissionRate: 20,
    },
  });
  expect(resp.status()).toBe(403);
});
