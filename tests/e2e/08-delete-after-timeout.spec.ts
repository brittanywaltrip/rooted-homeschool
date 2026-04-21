import { test, expect } from "./fixtures";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The Today page defers the DB delete by 5 seconds so Undo can restore the
// row. This test verifies the deferred delete actually commits once the
// window elapses.
test("deleting a lesson removes the DB row after the 5s undo window", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  const today = todayStr();
  const marker = `E2E delete ${Date.now()}`;

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

    await page.getByRole("button", { name: /delete this lesson/i }).click();

    await expect
      .poll(
        async () => {
          const { data } = await supabaseAdmin
            .from("lessons")
            .select("id")
            .eq("id", lessonId)
            .maybeSingle();
          return data;
        },
        { timeout: 12_000, intervals: [500, 1000, 1500], message: "row never deleted" }
      )
      .toBeNull();
  } catch (err) {
    await supabaseAdmin.from("lessons").delete().eq("id", lessonId);
    throw err;
  }
});
