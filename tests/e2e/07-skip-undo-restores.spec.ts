import { test, expect } from "./fixtures";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("skip → undo restores the lesson's scheduled_date", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  const today = todayStr();
  const marker = `E2E skip-undo ${Date.now()}`;

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

    await page.getByRole("button", { name: /skip this lesson/i }).click();

    const undo = page.getByRole("button", { name: /^undo$/i });
    await undo.waitFor({ state: "visible", timeout: 5_000 });
    await undo.click();

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
        { timeout: 10_000, message: "scheduled_date did not restore" }
      )
      .toBe(today);
  } finally {
    await supabaseAdmin.from("lessons").delete().eq("id", lessonId);
  }
});
