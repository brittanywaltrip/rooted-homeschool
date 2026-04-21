import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const TEST_USER_ID = "033760b9-51fc-4db2-b34a-2fafd6501be2";

export function getTestCredentials(): { email: string; password: string } {
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set PLAYWRIGHT_EMAIL + PLAYWRIGHT_PASSWORD in .env.local (or GitHub secrets)"
    );
  }
  return { email, password };
}

export async function loginAsTestUser(page: Page): Promise<void> {
  const { email, password } = getTestCredentials();

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/dashboard/);
}
