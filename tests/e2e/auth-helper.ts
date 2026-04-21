import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const TEST_USER_ID = "d18ca881-a776-4e82-b145-832adc88a88a";

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
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();

  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/dashboard/);
}
