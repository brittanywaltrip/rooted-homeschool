import { test, expect } from "@playwright/test";

test("PKCE session cookie persists after navigating to /dashboard", async ({
  page,
  context,
}) => {
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

  const cookies = await context.cookies();
  const authCookie = cookies.find((c) =>
    /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name)
  );
  expect(
    authCookie,
    `Expected a sb-<ref>-auth-token cookie — got: ${cookies.map((c) => c.name).join(", ")}`
  ).toBeTruthy();
  expect(authCookie!.value.length).toBeGreaterThan(0);
});
