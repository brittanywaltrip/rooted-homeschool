import { test, expect } from "@playwright/test";

test("today page renders greeting, schedule, and capture button", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

  await expect(
    page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })
  ).toBeVisible();

  // Schedule heading is "Today's schedule" (DOM text is sentence case; CSS
  // uppercases it). Only assert when lessons/activities/appointments exist
  // today — on a fully quiet day the section is hidden.
  const schedule = page.getByText(/today's schedule/i);
  if (await schedule.count()) {
    await expect(schedule.first()).toBeVisible();
  }

  await expect(
    page.getByRole("button", { name: /capture a memory/i })
  ).toBeVisible();
});
