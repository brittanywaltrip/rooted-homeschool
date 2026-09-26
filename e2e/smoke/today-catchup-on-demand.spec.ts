import { expect, test } from '@playwright/test';

import { adminClient, requireTestUserId } from '../admin';
import { addDays } from '../../app/lib/timezone';

// Today must let the family finish its daily tasks before opening a question
// about earlier lessons. This fixture is isolated to one staging test goal.
test.describe('Today catch-up opens when asked', { tag: '@curriculum-writes' }, () => {
  test('loading Today leaves the review closed; tapping the notice opens it', async ({ page }) => {
    test.setTimeout(120_000);
    const sb = adminClient();
    test.skip(!sb, 'Requires the guarded staging test account');
    const userId = await requireTestUserId('Today catch-up smoke');
    const { data: children, error: childrenError } = await sb!.from('children')
      .select('id').eq('user_id', userId).eq('archived', false).limit(1);
    expect(childrenError).toBeNull();
    const childId = children?.[0]?.id as string | undefined;
    test.skip(!childId, 'Test account needs a child');

    // The dashboard uses the browser's local day, not the CI host's UTC day.
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const name = `QA Catchup ${Date.now()}`;
    let goalId: string | null = null;
    try {
      const { data: goal, error: goalError } = await sb!.from('curriculum_goals')
        .insert({
          user_id: userId, child_id: childId, curriculum_name: name, subject_label: name,
          total_lessons: 6, current_lesson: 1, start_at_lesson: 1,
          start_date: addDays(today, -3), lessons_per_day: 1,
          school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          default_minutes: 30, archived: false,
        }).select('id').single();
      if (goalError || !goal) throw new Error(`Catch-up fixture goal: ${goalError?.message}`);
      goalId = goal.id;

      const { error: lessonsError } = await sb!.from('lessons').insert(
        Array.from({ length: 6 }, (_, i) => {
          const n = i + 1;
          const day = addDays(today, n - 4);
          return {
            user_id: userId, child_id: childId, curriculum_goal_id: goalId,
            title: `${name} — Lesson ${n}`, lesson_number: n, queue_position: n,
            scheduled_date: day, date: day, scheduled_source: 'wizard_create',
            completed: n === 1, completed_at: n === 1 ? `${day}T12:00:00Z` : null,
            minutes_spent: n === 1 ? 30 : null, hours: n === 1 ? 0.5 : 0,
            is_backfill: false, queue_pinned: false, skipped: false,
          };
        }),
      );
      if (lessonsError) throw new Error(`Catch-up fixture lessons: ${lessonsError.message}`);

      await page.goto('/dashboard');
      const notice = page.getByRole('button', { name: /review \d+ lessons? from earlier/i });
      const review = page.getByRole('dialog', { name: 'You have lessons from earlier' });
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(review).toHaveCount(0);

      await notice.click();
      await expect(review).toBeVisible();
      await expect(review.getByRole('button', { name: new RegExp(name) })).toBeVisible();
      await review.getByRole('button', { name: 'Close' }).click();
      await expect(review).toHaveCount(0);
      await expect(notice).toBeVisible();

      const { data: savedGoal, error: readGoalError } = await sb!.from('curriculum_goals')
        .select('catchup_answered_on').eq('user_id', userId).eq('id', goalId).single();
      if (readGoalError) throw readGoalError;
      expect(savedGoal.catchup_answered_on).toBeNull();
      const { data: savedLessons, error: readLessonsError } = await sb!.from('lessons')
        .select('lesson_number, completed').eq('user_id', userId).eq('curriculum_goal_id', goalId);
      if (readLessonsError) throw readLessonsError;
      expect(savedLessons?.filter((row) => row.completed).map((row) => row.lesson_number)).toEqual([1]);
    } finally {
      if (goalId) {
        const { error: deleteLessonsError } = await sb!.from('lessons').delete()
          .eq('user_id', userId).eq('curriculum_goal_id', goalId);
        if (deleteLessonsError) throw deleteLessonsError;
        const { error: deleteGoalError } = await sb!.from('curriculum_goals').delete()
          .eq('user_id', userId).eq('id', goalId);
        if (deleteGoalError) throw deleteGoalError;
      }
    }
  });
});
