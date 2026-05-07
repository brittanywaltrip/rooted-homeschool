import { test, expect } from '@playwright/test';

test.describe('Schedule Builder — z-index regression', () => {
  test('mobile sticky bar is not occluded by the bottom nav', async ({ browser }) => {
    // Force a mobile viewport so the bottom nav (md:hidden) renders.
    // Desktop default would skip this rendering and the regression we're
    // trying to catch only manifests on phones.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone 14 portrait
      // Reuse the global storageState so the page renders signed-in.
      storageState: 'e2e/.auth/user.json',
    });
    const page = await context.newPage();

    try {
      await page.goto('/dashboard/plan/schedule');
      // Builder renders the cancel button inside the sticky bar.
      const cancelBtn = page.getByRole('button', { name: /^Cancel$/ });
      await expect(cancelBtn).toBeVisible({ timeout: 15_000 });

      // Occlusion check. Take the center point of the cancel button and
      // ask the browser which element is topmost there. If the topmost
      // element is the mobile bottom nav (or one of its children), the
      // bar is hidden behind the nav — the exact bug we just fixed.
      const occlusion = await cancelBtn.evaluate((btn) => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const top = document.elementFromPoint(cx, cy);
        if (!top) return { ok: false, reason: 'nothing at center point' };
        const isInsideButton = btn.contains(top) || top === btn;
        // Walk ancestors for a <nav> tag — the mobile bottom nav is the
        // only fixed-bottom <nav> in the dashboard tree.
        let cursor: Element | null = top;
        let occluderTag = '';
        while (cursor) {
          if (cursor.tagName === 'NAV') { occluderTag = 'NAV'; break; }
          cursor = cursor.parentElement;
        }
        return { ok: isInsideButton, occluderTag, topTag: top.tagName, topClass: top.className };
      });

      expect(
        occlusion.ok,
        `Cancel button is occluded by ${occlusion.occluderTag || occlusion.topTag} (${occlusion.topClass}). The mobile bottom nav is on top of the Schedule Builder sticky bar — z-index regression.`,
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});
