import { test, expect, type ConsoleMessage } from '@playwright/test';

test.describe('Dashboard — signed in', () => {
  test('today page renders core UI without unhandled errors', async ({ page }) => {
    // Capture browser console output BEFORE navigating so nothing slips through.
    // We only fail on real crashes — matches "Unhandled" or "TypeError" in the
    // message text, ignoring the sea of console.log breadcrumbs the dashboard
    // emits during normal load.
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/Unhandled|TypeError/.test(text)) errors.push(text);
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/dashboard');

    // The Today header renders inside an <h1> with the time-of-day greeting
    // ("Good morning|afternoon|evening, ..."). Use the eyebrow line that
    // sits directly above the greeting and is stable across all states.
    await expect(page.getByText(/Good morning|Good afternoon|Good evening/i).first()).toBeVisible({ timeout: 15_000 });

    // The mobile bottom nav has "Today" as a label. We're in chromium
    // desktop default which shows the sidebar; the sidebar nav items
    // include Today, Plan, Garden, Memories, Printables, Resources.
    for (const label of ['Plan', 'Garden', 'Memories', 'Printables', 'Resources']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label}$`) }).first()).toBeVisible();
    }

    // Today's Schedule is only present when there are lessons/activities/
    // appointments — it's the "TodaySchedule" card under the hero. For a
    // free test user without curriculum it may not render; the assertion
    // we do enforce is that some Today-page surface (greeting OR getting
    // started card OR capture button) is visible. The greeting check
    // above already covers this.

    // Final gate: no Unhandled / TypeError lines in the console.
    expect(errors, `console errors during /dashboard load:\n${errors.join('\n')}`).toEqual([]);
  });
});
