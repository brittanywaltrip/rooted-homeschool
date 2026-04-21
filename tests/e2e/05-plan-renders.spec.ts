import { test, expect } from "@playwright/test";

test("plan page renders week strip and add-curriculum button", async ({ page }) => {
  await page.goto("/dashboard/plan");
  await page.waitForURL(/\/dashboard\/plan/, { timeout: 15_000 });

  await expect(
    page.getByRole("button", { name: /\+?\s*add curriculum/i }).first()
  ).toBeVisible({ timeout: 15_000 });
});
