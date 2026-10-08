import { test, expect } from "@playwright/test";
import { TOUR_FEATURES } from "./features";

// Run with: npx playwright test --config playwright.tour.config.ts
// No sign-in, real family data, analytics, or deployment writes.
test.beforeEach(async ({ context, baseURL }) => {
  if (baseURL !== "http://127.0.0.1:3100") {
    throw new Error("The public tour checks may only run against their local server.");
  }
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL || /^\/(api|ingest|monitoring)(\/|$)/.test(url.pathname)) {
      return route.abort();
    }
    return route.continue();
  });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`all feature previews work without horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tour");
    await expect(page.getByRole("heading", { name: "See Rooted in action" })).toBeVisible();
    const panel = page.locator("#tour-feature");
    for (const feature of TOUR_FEATURES) {
      const button = page.getByRole("button", { name: `${feature.emoji} ${feature.label}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(panel.getByRole("heading", { name: feature.headline, exact: true })).toBeVisible();
      await expect(panel.locator("figcaption")).toContainText("Illustrative preview with fictional details");
      await expect(panel).toContainText(feature.location);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("previous, next, keyboard, repeated selection, and anchor navigation work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tour");
  await page.getByRole("link", { name: "Explore features" }).click();
  await expect(page).toHaveURL(/\/tour#walkthrough$/);
  const panel = page.locator("#tour-feature");
  await page.getByRole("button", { name: "Previous", exact: true }).filter({ visible: true }).click();
  await expect(panel).toContainText(TOUR_FEATURES[TOUR_FEATURES.length - 1].headline);
  await page.getByRole("button", { name: "Next", exact: true }).filter({ visible: true }).click();
  await expect(panel).toContainText(TOUR_FEATURES[0].headline);
  const garden = page.getByRole("button", { name: "🌳 Garden", exact: true });
  await garden.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toContainText("Bearing Fruit");
  await garden.click();
  await expect(garden).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(5_200);
  await expect(panel).toContainText("Watch their year take root");
  await page.getByRole("button", { name: "Go to Reports", exact: true }).click();
  await expect(panel).toContainText("Hours & Attendance Log");
  await page.goBack();
  await expect(page).toHaveURL(/\/tour$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/tour#walkthrough$/);
  await expect(panel).toContainText("Hours & Attendance Log");
  await expect(page.locator("header").getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/login");
  await expect(panel.getByRole("link", { name: "Start your free trial" })).toHaveAttribute("href", "/signup");
});
