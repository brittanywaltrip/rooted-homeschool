import { test, expect } from "./fixtures";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("mark a lesson done — UI strike-through + DB completed", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  const today = todayStr();
  const marker = `E2E mark-done ${Date.now()}`;

  const { data: inserted, error: insertErr } = await supabaseAdmin
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
  if (insertErr) throw new Error(`seed failed: ${insertErr.message}`);
  const lessonId = (inserted as { id: string }).id;

  try {
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard/);

    const lessonItem = page.getByText(marker).first();
    await lessonItem.waitFor({ state: "visible", timeout: 15_000 });
    await lessonItem.click();

    await page.getByRole("button", { name: /log it/i }).click();

    await expect
      .poll(
        async () => {
          const { data } = await supabaseAdmin
            .from("lessons")
            .select("completed, completed_at")
            .eq("id", lessonId)
            .single();
          return data;
        },
        { timeout: 10_000, message: "lesson never marked completed in DB" }
      )
      .toMatchObject({ completed: true });

    const { data: final } = await supabaseAdmin
      .from("lessons")
      .select("completed, completed_at")
      .eq("id", lessonId)
      .single();
    expect(final?.completed).toBe(true);
    expect(final?.completed_at).toBeTruthy();
  } finally {
    await supabaseAdmin.from("lessons").delete().eq("id", lessonId);
  }
});
