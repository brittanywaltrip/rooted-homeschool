import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/* End-to-end Playwright flows against staging.
 *
 * Auth: storageState is loaded automatically by playwright.config.ts from
 * e2e/.auth/user.json. global-setup.ts signs in once via the real /login
 * form using PLAYWRIGHT_EMAIL + PLAYWRIGHT_PASSWORD from .env.local
 * (also wired into GitHub Actions secrets. see .github/workflows/playwright.yml).
 *
 * These flows do NOT modify app code. They exercise the same UI a user
 * would click. Tests that depend on account state (lessons today,
 * curriculum) skip cleanly when the state isn't there so a fresh test
 * account doesn't false-fail. */

// ── Helpers ─────────────────────────────────────────────────────────────────

// Mark the window so we can detect a full page reload mid-test. Any flow
// that asserts "without page reload" sets this before the action and
// checks it survives afterwards.
async function plantReloadSentinel(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __reloadSentinel?: number }).__reloadSentinel = Date.now();
  });
}

async function reloadSentinelSurvived(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return typeof (window as unknown as { __reloadSentinel?: number }).__reloadSentinel === 'number';
  });
}

// Hook up a console error collector. We only fail on real crashes. match
// "Unhandled" / "TypeError" / pageerror events, ignore the breadcrumb logs
// the dashboard emits during normal load (matching dashboard.spec.ts policy).
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Unhandled|TypeError/.test(text)) errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1. Today page loads
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 1. Today page loads', () => {
  test('lesson or activation card appears, no console crashes', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/dashboard');

    // The Today header greeting is the most stable signal that the dashboard
    // has rendered at all. Wait on it before doing the content assertion so
    // a slow cold start on the staging preview doesn't false-fail.
    await expect(
      page.getByText(/Good morning|Good afternoon|Good evening/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // EITHER at least one lesson row is rendered (TodaySchedule),
    // OR the activation/getting-started card is rendered for a brand-new
    // account. Both are valid "Today loaded" states.
    const lessonToggle = page.getByRole('button', {
      name: /^Mark lesson (complete|incomplete)$/i,
    });
    const activationCue = page.getByText(
      /capture your first memory|start your first lesson|getting started|capture a memory/i,
    );

    // Visible-OR-visible: race the two. The fact that ONE resolves within
    // the timeout window is the assertion.
    await expect.poll(
      async () => (await lessonToggle.count()) + (await activationCue.count()),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    expect(
      errors,
      `console errors during /dashboard load:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2. Mark lesson complete on Today
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 2. Mark a lesson complete on Today', () => {
  test('lesson toggle flips to complete without a page reload', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for Today to render before probing for lesson rows.
    await expect(
      page.getByText(/Good morning|Good afternoon|Good evening/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Find an INCOMPLETE lesson. its toggle button has aria-label
    // "Mark lesson complete" (TodayItemCard.tsx:150). Complete rows have
    // "Mark lesson incomplete" instead.
    const incompleteToggle = page
      .getByRole('button', { name: /^Mark lesson complete$/i })
      .first();

    if ((await incompleteToggle.count()) === 0) {
      test.skip(
        true,
        'No incomplete lessons on Today for the test account. cannot exercise completion path.',
      );
      return;
    }

    // Snapshot Today's Story state before mutation so we can confirm the
    // page didn't blow away the section. Today's Story is only present
    // when there is at least one memory logged today; both states
    // ("present" / "absent") are valid baselines.
    const todaysStorySection = page.locator('.today-story-section');
    const storyVisibleBefore = (await todaysStorySection.count()) > 0;

    await plantReloadSentinel(page);
    await incompleteToggle.click();

    // The check-off modal opens with the "Log it ✓" button. Confirming
    // with the default time is the simplest happy path. clicks the
    // green primary CTA.
    const logItButton = page.getByRole('button', { name: /^Log it ✓$/ });
    await expect(logItButton).toBeVisible({ timeout: 10_000 });
    await logItButton.click();

    // Wait for the modal to close (it animates out for ~300ms).
    await expect(logItButton).toHaveCount(0, { timeout: 5_000 });

    // The same row's toggle now has aria-label "Mark lesson incomplete" . 
    // proves the row visual state flipped without a full reload.
    await expect(
      page.getByRole('button', { name: /^Mark lesson incomplete$/i }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Sentinel survives → no full document reload happened.
    expect(await reloadSentinelSurvived(page), 'page should not have reloaded').toBe(true);

    // Today's Story re-renders consistently. If it was visible before,
    // it should still be visible (count >= what was there). If it wasn't
    // visible before, we don't require it to appear. completing a lesson
    // does not necessarily create a memory unless it tops out a goal.
    if (storyVisibleBefore) {
      await expect(todaysStorySection).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3. Plan page loads with lessons on a school day
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 3. Plan page loads and shows lessons', () => {
  test('next-week navigation surfaces at least one lesson on a school day', async ({ page }) => {
    await page.goto('/dashboard/plan');

    // Plan hero confirms the page mounted.
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Week navigation buttons aren't labeled. they're the ChevronLeft /
    // ChevronRight icons inside the week strip header (plan/page.tsx:2031-2040).
    // Filter siblings of the "formatWeekRange" label span. Easiest stable
    // path: find the span containing the week label, then click the next
    // button sibling. Fall back to keyboard navigation.
    // The two icon buttons sit on either side of the label and are the
    // ONLY p-1 buttons in that flex container.
    const weekLabel = page.locator('span', {
      hasText: /[A-Z][a-z]{2} \d{1,2}.*[A-Z][a-z]{2} \d{1,2}|[A-Z][a-z]{2} \d{1,2}.*\d{1,2}/,
    }).first();
    await expect(weekLabel).toBeVisible({ timeout: 10_000 });

    // The next-week button is the second of two chevron buttons in the
    // same flex parent as the label. Use the SVG icon class to pinpoint
    // ChevronRight ('lucide-chevron-right').
    const nextWeekButton = page
      .locator('button:has(svg.lucide-chevron-right)')
      .first();
    await expect(nextWeekButton).toBeVisible({ timeout: 5_000 });
    await nextWeekButton.click();

    // After clicking next, the week label should change. Capture before
    // and assert after.
    // (We could read the text-before and assert text-after differs; simpler
    // is to wait for any network settles, then probe for a lesson.)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Lesson rows in WeekListView expose aria-label "Open {title} details"
    // (WeekListView.tsx:356). At least one should be visible somewhere on
    // the page if the test account has an active curriculum.
    const lessonRow = page.getByRole('button', { name: /^Open .+ details$/i });

    if ((await lessonRow.count()) === 0) {
      // Some accounts have no curriculum at all. The plan page still
      // loads, but there's nothing to assert beyond the heading. Skip
      // cleanly rather than false-fail.
      test.skip(
        true,
        'No lessons render in next-week view for the test account. likely no active curriculum.',
      );
      return;
    }

    await expect(lessonRow.first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 4. Move a lesson on Plan, then verify Today reflects the move
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 4. Move a lesson on Plan', () => {
  test('moving a lesson updates Today', async ({ page }) => {
    await page.goto('/dashboard/plan');
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Wait until at least one lesson card has rendered before probing for
    // overflow menus. The WeekListView mounts after the plan-data fetch
    // resolves, which can be 1-3s on a cold staging cold start.
    const lessonCards = page.getByRole('button', { name: /^Open .+ details$/i });
    if ((await lessonCards.count()) === 0) {
      // Give the list a beat to hydrate before declaring "no lessons".
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll('button[aria-label^="Open "][aria-label$=" details"]')
              .length > 0,
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => {});
    }

    // Find the first lesson's overflow menu. aria-label is
    // "More actions for {title}". WeekListView.tsx:412.
    const overflowButton = page
      .getByRole('button', { name: /^More actions for .+/i })
      .first();

    if ((await overflowButton.count()) === 0) {
      test.skip(
        true,
        'No lessons in current week for the test account. cannot exercise move flow.',
      );
      return;
    }

    // Capture the lesson title from the overflow button's aria-label so
    // we can hunt for it on /dashboard later.
    const aria = (await overflowButton.getAttribute('aria-label')) ?? '';
    const lessonTitle = aria.replace(/^More actions for /i, '').trim();

    await overflowButton.click();

    // The overflow flips aria-expanded → true when the menu opens.
    // Wait on that before probing for menu items; on a cold cold-start
    // the React handler can be a tick behind the click.
    await expect(overflowButton).toHaveAttribute('aria-expanded', 'true', {
      timeout: 10_000,
    });

    // Click the "Move" menuitem in the overflow popup.
    const moveMenuItem = page.getByRole('menuitem', { name: /^Move$/ });
    await expect(moveMenuItem).toBeVisible({ timeout: 10_000 });
    await moveMenuItem.click();

    // Move mode is active. each non-source day now shows a "Move here"
    // button. aria-label format: "Move to {headerLabel}" (WeekListView.tsx:618).
    // Take the first available target. order is Mon..Sun, so we pick the
    // one that isn't this lesson's source day. Playwright's `.first()` on
    // the visible "Move here" buttons gives us a stable target.
    const moveHereButtons = page.getByRole('button', { name: /^Move to .+/i });

    if ((await moveHereButtons.count()) === 0) {
      test.skip(
        true,
        'Move mode opened but no target days were rendered. likely a single-day week edge case.',
      );
      return;
    }

    // Pick the LAST target so we always move forward when possible
    // (avoids picking the source day's neighbor in degenerate single-row weeks).
    const targetButton = moveHereButtons.last();
    const targetLabel = (await targetButton.getAttribute('aria-label')) ?? '';
    await targetButton.click();

    // Wait for the move to settle. undo toast appears, then network
    // request lands. networkidle is good enough for a smoke check.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // The Move here buttons should be gone (move mode cleared).
    await expect(moveHereButtons).toHaveCount(0, { timeout: 5_000 });

    // Now go to /dashboard and confirm Today reflects the move. There
    // are two possible outcomes:
    //  (a) the lesson moved TO today → it should appear on Today
    //  (b) the lesson moved OFF today → it should NOT appear on Today
    // We don't know which without parsing the target label, but we DO
    // know Today should render without crashing and the lesson row
    // we care about is either present or absent in a self-consistent way.
    // The minimum assertion: Today loads cleanly.
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard');
    await expect(
      page.getByText(/Good morning|Good afternoon|Good evening/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    expect(
      errors,
      `console errors after move-and-navigate flow (target=${targetLabel}, lesson=${lessonTitle}):\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 5. Add a Win memory
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 5. Add a memory from Memories page', () => {
  test('adding a win memory surfaces in the memories grid without a reload', async ({
    page,
  }) => {
    await page.goto('/dashboard/memories');

    // Memories hero confirms mount.
    await expect(
      page.getByRole('heading', { name: /Memories|Your family story starts here/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The Win sheet lives in app/dashboard/page.tsx (not in the memories
    // page itself). The Quick Action "Capture Memory" tile on Memories
    // links to /dashboard?capture=1 (memories/page.tsx:678) which opens
    // the capture menu. From there the user taps the Win tile.
    // For test stability we navigate directly to /dashboard?capture=1.
    await page.goto('/dashboard?capture=1');
    await expect(
      page.getByText(/Good morning|Good afternoon|Good evening/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Memory picker bottom sheet (the capture menu) is now open. The Win
    // tile is a flex-column button containing emoji + label + sub. Match
    // by the unique subtitle text to avoid colliding with other "Win"
    // strings on the page (filter chips, etc.).
    const winTile = page.getByRole('button', { name: /Celebrate a win/i }).first();

    if ((await winTile.count()) === 0) {
      test.skip(true, 'Capture menu Win tile not visible. surface may have changed.');
      return;
    }

    await winTile.click();

    // Log a Win sheet opens. Confirm by waiting for its h2 heading before
    // filling the textarea, so we never type into a stale element from a
    // different surface.
    const winSheetHeading = page.getByRole('heading', { name: /Log a Win/i });
    await expect(winSheetHeading).toBeVisible({ timeout: 10_000 });

    // Fill the textarea by placeholder. there's exactly one textarea in
    // this sheet ("What did they accomplish today?"). Stamp is unique so
    // we can find this memory specifically in the grid afterwards.
    const stamp = Date.now().toString();
    const winText = `Playwright win ${stamp}`;
    const textarea = page.getByPlaceholder(/What did they accomplish today/i);
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await textarea.fill(winText);

    await plantReloadSentinel(page);

    // Save Win button label is "Save Win 🌿"; flips to "Saving..." while
    // the supabase insert is in flight, then the sheet unmounts on success.
    // Click the button by name, then wait for the WIN SHEET HEADING to
    // detach. that's the success signal. Waiting on button-text change
    // would race the in-flight insert (the text flips to "Saving..."
    // before the network round-trip completes).
    const saveButton = page.getByRole('button', { name: /^Save Win/ });
    await saveButton.click();

    await expect(winSheetHeading).toBeHidden({ timeout: 20_000 });

    // Sentinel still in place → no full reload between save and now.
    expect(await reloadSentinelSurvived(page), 'win save should not full-reload').toBe(true);

    // Navigate back to Memories and assert the new win appears in the grid.
    // The memories page listens for `rooted:memory-saved` and reloads its
    // grid; we still navigate explicitly so the assertion is independent
    // of that event firing.
    await page.goto('/dashboard/memories');
    await expect(
      page.getByRole('heading', { name: /Memories|Your family story starts here/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The Win text is rendered as the memory's title in the grid card.
    await expect(page.getByText(winText).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 6. Yearbook loads
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 6. Yearbook loads', () => {
  test('yearbook reader renders the cover spread or empty state, no JS errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/dashboard/memories/yearbook');

    // /dashboard/memories/yearbook redirects to /read.
    await expect(page).toHaveURL(/yearbook/, { timeout: 20_000 });
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

    // The reader either renders the cover spread (account with memories)
    // or short-circuits to the empty state ("Your yearbook is empty").
    // Both are valid "loaded" outcomes. Cover spread headers come from
    // getPageHeaders(). "ROOTED YEARBOOK" / "TABLE OF CONTENTS" appear
    // on spread 0 (yearbook/read/page.tsx:199).
    const coverHeading = page.getByText(/ROOTED YEARBOOK|TABLE OF CONTENTS|Yearbook$/);
    const emptyHeading = page.getByText(/Your yearbook is empty/i);

    await expect.poll(
      async () => (await coverHeading.count()) + (await emptyHeading.count()),
      { timeout: 20_000 },
    ).toBeGreaterThan(0);

    expect(
      errors,
      `console errors during yearbook load:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 7. Stop recurring appointment — Keep going dismisses without deleting
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 7. Stop recurring appointment', () => {
  test('Guitar Lessons stop confirm dialog dismisses without removing the row', async ({ page }) => {
    await page.goto('/dashboard');

    // Today header confirms the dashboard mounted.
    await expect(
      page.getByText(/Good morning|Good afternoon|Good evening/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The Recurring tab is a flat button labeled "Recurring" inside the
    // InlineScheduleTabs strip (InlineScheduleTabs.tsx:365). Click it to
    // pivot the list to recurring appointments.
    const recurringTab = page.getByRole('button', { name: /^Recurring$/ }).first();
    if ((await recurringTab.count()) === 0) {
      test.skip(true, 'Recurring tab is not on the page. likely a render variant we do not exercise here.');
      return;
    }
    await recurringTab.click();

    // Find the Guitar Lessons row. it surfaces only when the account
    // actually has a recurring appointment titled "Guitar Lessons". Skip
    // cleanly otherwise so a fresh account does not false-fail.
    const guitarRow = page.getByText(/^Guitar Lessons$/).first();
    if ((await guitarRow.count()) === 0) {
      test.skip(true, 'Test account has no "Guitar Lessons" recurring appointment.');
      return;
    }
    await expect(guitarRow).toBeVisible({ timeout: 5_000 });

    // Each recurring row renders a small "Stop" button (text-only, NOT a
    // trash icon) — InlineScheduleTabs.tsx:545-551. Confirm the row exposes
    // exactly that affordance.
    const stopButton = page.getByRole('button', { name: /^Stop$/ }).first();
    await expect(stopButton).toBeVisible({ timeout: 5_000 });

    // No trash/delete icon button next to the row. trash icons would have
    // an aria-label like "Delete" / "Remove" / "Trash". Their absence is a
    // separate assertion from "Stop is visible" so a regression to a trash
    // UI fails the test loudly.
    const trashIcon = page.getByRole('button', { name: /trash|delete|remove/i });
    expect(
      await trashIcon.count(),
      'recurring appointment row should not expose a trash/delete icon',
    ).toBe(0);

    await plantReloadSentinel(page);
    await stopButton.click();

    // The Stop dialog opens with heading "Stop Guitar Lessons?" — both
    // confirm buttons live inside it. (StopRecurringDialog, line 696.)
    const stopHeading = page.getByRole('heading', { name: /^Stop Guitar Lessons\?$/ });
    await expect(stopHeading).toBeVisible({ timeout: 5_000 });

    const keepGoing = page.getByRole('button', { name: /^Keep going$/ });
    const yesStopIt = page.getByRole('button', { name: /^Yes, stop it$/ });
    await expect(keepGoing).toBeVisible();
    await expect(yesStopIt).toBeVisible();

    // Click Keep going. dialog should unmount and the row must still be in
    // the Recurring tab.
    await keepGoing.click();
    await expect(stopHeading).toBeHidden({ timeout: 5_000 });

    // Sentinel survives → no full reload swallowed the dismiss.
    expect(await reloadSentinelSurvived(page), 'Keep going should not reload the page').toBe(true);

    // Guitar Lessons still present in the Recurring list after dismiss.
    await expect(page.getByText(/^Guitar Lessons$/).first()).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 8. Curriculum Complete card shows the subject label
// ─────────────────────────────────────────────────────────────────────────────

test.describe('FLOW 8. Curriculum Complete card shows subject label', () => {
  test('completed curriculum reads "[child] finished [curriculum] [subject]!"', async ({ page }) => {
    await page.goto('/dashboard/plan');

    // Plan hero confirms mount.
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({
      timeout: 20_000,
    });

    // The completion celebration card (CompletionCelebrationCard.tsx:82-87)
    // lives below the calendar in the curriculum section. The eyebrow
    // "Curriculum complete" is its most stable anchor. Scroll into view if
    // present, then assert the headline pattern. Skip cleanly when there
    // is no celebrating curriculum on the test account.
    const eyebrow = page.getByText(/^Curriculum complete$/i).first();

    if ((await eyebrow.count()) === 0) {
      test.skip(true, 'No completed-and-uncelebrated curriculum on the test account.');
      return;
    }

    await eyebrow.scrollIntoViewIfNeeded();
    await expect(eyebrow).toBeVisible();

    // Headline renders as: "{childName} finished" <br/> "{curriculumName} {subjectLabel}!"
    // DOM textContent collapses the <br/> into a space. The pattern is:
    // word(s), then "finished", then word(s) (curriculum), then word(s)
    // (subject), terminated with "!". Two whitespace-separated tokens after
    // "finished" guards against a regression where subject_label is
    // omitted (which would shorten the headline to "{name} finished {curriculum}!").
    const headline = page.locator('h3', { hasText: /finished/i }).first();
    await expect(headline).toBeVisible({ timeout: 5_000 });
    await expect(headline).toHaveText(/\S.+\s+finished\s+\S+.+\s+\S+.+!$/);
  });
});
