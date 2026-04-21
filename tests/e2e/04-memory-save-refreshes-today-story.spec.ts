import { test, expect } from "./fixtures";

// REGRESSION GUARD: every memory save in the dashboard must call
// refreshTodayStory() + loadData() so Today's Story refreshes without a
// page reload. This test drives the Win save path (text-only memory) and
// asserts the new entry shows up in Today's Story before any navigation.

test("saving a Win refreshes Today's Story without a page reload", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  const winText = `E2E win ${Date.now()}`;

  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/);

  const captureBtn = page.getByRole("button", { name: /capture a memory/i });
  await captureBtn.waitFor({ state: "visible", timeout: 15_000 });
  await captureBtn.click();

  await page.getByRole("button", { name: /^🏆\s*Win/ }).click();

  const textarea = page.locator('textarea[placeholder*="accomplish"]').first();
  await textarea.waitFor({ state: "visible", timeout: 5_000 });
  await textarea.fill(winText);

  await page.getByRole("button", { name: /save win/i }).click();

  try {
    await expect(page.getByText(winText).first()).toBeVisible({
      timeout: 20_000,
    });

    const { data } = await supabaseAdmin
      .from("memories")
      .select("id, type, title")
      .eq("user_id", testUserId)
      .eq("title", winText)
      .maybeSingle();
    expect(data?.title).toBe(winText);
  } finally {
    await supabaseAdmin
      .from("memories")
      .delete()
      .eq("user_id", testUserId)
      .eq("title", winText);
  }
});
