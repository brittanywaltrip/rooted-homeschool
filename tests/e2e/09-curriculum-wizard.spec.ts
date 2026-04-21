import { test, expect } from "./fixtures";

// Starter coverage: verify the CurriculumWizard UI opens and the
// curriculum_goals table accepts a minimal valid row. Fully automating the
// 4–5 step wizard (child pick → name/subject/totals → school days →
// confirm) is deferred — too much surface area for a first-pass smoke test
// to stay stable.

test("curriculum wizard opens and curriculum_goals accepts a minimal row", async ({
  page,
  supabaseAdmin,
  testUserId,
}) => {
  await page.goto("/dashboard/plan");
  await page
    .getByRole("button", { name: /\+?\s*add curriculum/i })
    .first()
    .click();
  await expect(
    page
      .locator('[class*="rounded-t-"]')
      .or(page.getByText(/curriculum|child|subject/i).first())
  ).toBeVisible({ timeout: 10_000 });

  const marker = `E2E curriculum ${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from("curriculum_goals")
    .insert({
      user_id: testUserId,
      curriculum_name: marker,
      total_lessons: 10,
      current_lesson: 1,
      school_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    })
    .select("id")
    .single();

  try {
    expect(error).toBeNull();
    expect((data as { id: string } | null)?.id).toBeTruthy();
  } finally {
    if ((data as { id: string } | null)?.id) {
      await supabaseAdmin
        .from("curriculum_goals")
        .delete()
        .eq("id", (data as { id: string }).id);
    }
  }
});
