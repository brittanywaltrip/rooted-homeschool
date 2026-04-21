import { test, expect } from "./fixtures";

// The /api/admin/create-affiliate route admits only the three hard-coded
// admin emails (garfieldbrittany, christopherwaltrip, hello@rooted...).
// The Playwright user (brittanywaltrip20) is not on that list, so the
// endpoint returns 401 for them by design. This test asserts the
// 401-for-non-admin contract — if the test user is ever promoted to admin,
// swap this for a full happy-path flow.

test("admin-only /api/admin/create-affiliate rejects the test user", async ({
  page,
}) => {
  const resp = await page.request.post("/api/admin/create-affiliate", {
    data: {
      email: "never-used@example.com",
      name: "E2E",
      code: "E2ETEST",
      stripe_coupon_id: "dummy",
    },
  });
  expect(resp.status()).toBe(401);
});
