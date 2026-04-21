import { test, expect } from "./fixtures";

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The 5-option reschedule sheet labelled "Move to a specific day" lives on
// the Today page. The Plan page's sheet uses "Pick a day myself" instead,
// so we drive this through /dashboard to match the canonical copy.
test("reschedule a lesson to a specific day updates scheduled_date", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  const today = addDays(0);
  const target = addDays(3);
  const marker = `E2E reschedule ${Date.now()}`;

  const { data: inserted, error } = await supabaseAdmin
    .from("lessons")
    .insert({
      user_id: testUserId,
      title: marker,
      scheduled_date: today,
      date: today,
      completed: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed failed: ${error.message}`);
  const lessonId = (inserted as { id: string }).id;

  try {
    await page.goto("/dashboard");

    const row = page.getByText(marker).first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.keyboard.press("Escape");

    const rescheduleBtn = page.getByRole("button", {
      name: /reschedule this lesson/i,
    });
    await rescheduleBtn.waitFor({ state: "visible", timeout: 5_000 });
    await rescheduleBtn.click();

    await page.getByRole("button", { name: /move to a specific day/i }).click();
    await page.locator('input[type="date"]').fill(target);
    await page.getByRole("button", { name: /^move$/i }).click();

    await expect
      .poll(
        async () => {
          const { data } = await supabaseAdmin
            .from("lessons")
            .select("scheduled_date")
            .eq("id", lessonId)
            .single();
          return data?.scheduled_date ?? null;
        },
        { timeout: 10_000, message: "scheduled_date did not update to target" }
      )
      .toBe(target);
  } finally {
    await supabaseAdmin.from("lessons").delete().eq("id", lessonId);
  }
});
