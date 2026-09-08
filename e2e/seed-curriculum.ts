/* ============================================================================
 * Seed the e2e account with a curriculum the completion flows can actually use.
 *
 * WHY THIS EXISTS. The suite was reporting green while skipping nine tests,
 * including every one that completes a lesson: FLOW 2 (mark complete on
 * Today), FLOW 4 (move a lesson on Plan), Lesson completion V2. They skip on
 * "No incomplete lessons on Today for the test account", and the account had
 * zero active curriculum goals, so the paths Invariant 16 governs were never
 * exercised. Playwright counts a skip as a non-failure, so the gap was
 * invisible in the summary line.
 *
 * WHY IT RUNS EVERY TIME. A one-shot seed cannot hold: FLOW 2 completes the
 * lesson it needs, so the next run finds nothing incomplete and skips again.
 * This re-establishes the shape on every run — find-or-create the goal, then
 * rewrite its lessons — which makes the suite self-sufficient rather than
 * dependent on someone remembering to reseed.
 *
 * WHAT IT DELIBERATELY AVOIDS. Two prompts on Today render as full-screen
 * overlays (z-[81]) and would block the very clicks these flows need:
 *
 *   - The Missed Lesson Recovery modal fires when a goal has gap entries
 *     between its last completion and today. The seed includes a lesson
 *     completed YESTERDAY, so the gap is zero days wide and the modal stays
 *     shut.
 *   - The prior-lesson confirmation card fires when no row exists at
 *     lesson_number = current_lesson. The seed writes that row, so it does not.
 *
 * Seeding without those two considerations would have traded nine skips for
 * several failures.
 *
 * SAFETY. Every write is scoped by user_id, and the user id is re-checked
 * through assertIsTestAccount before anything is written. This runs as
 * service_role against the shared database, where RLS protects nobody.
 * ==========================================================================*/

import type { SupabaseClient } from '@supabase/supabase-js';

import { assertIsTestAccount } from './test-account';

/** Stable name, so the seed finds its own goal instead of making a new one. */
export const SEED_GOAL_NAME = 'E2E Seeded Curriculum';
export const SEED_SUBJECT = 'E2E Math';

/** YYYY-MM-DD, local, matching the app's own localDateStr. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

export type SeedResult = {
  goalId: string;
  todayDate: string;
  pastDate: string;
  completedDate: string;
};

/**
 * Ensure the account holds one active curriculum with:
 *   - a lesson completed yesterday   (keeps the recovery modal shut)
 *   - an incomplete lesson due TODAY (the silent "today" completion path)
 *   - an incomplete lesson PINNED to a past school day (the date chooser path)
 *
 * The pinned row is how a past-dated incomplete lesson survives at all:
 * reconcileGoalScheduleCache rolls unpinned incomplete rows forward onto the
 * queue's dates on every Today load, so an unpinned past date would be gone
 * before the first spec ran. A pin is the family saying "this one belongs
 * here" (Invariant 12), which is exactly the state we want to test against.
 *
 * school_days covers all seven days so the seed is deterministic whatever day
 * the suite runs on. A Saturday run must not skip for want of a school day.
 */
export async function seedE2ECurriculum(
  sb: SupabaseClient,
  userId: string,
): Promise<SeedResult | null> {
  // Re-assert here rather than trusting the caller. This function deletes.
  assertIsTestAccount(userId, 'seed-curriculum');

  const { data: kids, error: kidsErr } = await sb
    .from('children')
    .select('id')
    .eq('user_id', userId)
    .eq('archived', false)
    .order('sort_order')
    .limit(1);
  if (kidsErr) throw new Error(`[seed] children read failed: ${kidsErr.message}`);
  const childId = (kids ?? [])[0]?.id as string | undefined;
  if (!childId) {
    console.warn('[seed] test account has no active child; skipping curriculum seed');
    return null;
  }

  const today = new Date();
  const todayDate = ymd(today);
  const completedDate = ymd(addDays(today, -1));
  const pastDate = ymd(addDays(today, -4));
  const startDate = ymd(addDays(today, -14));

  const SCHOOL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TOTAL = 20;

  // ── Find or create the goal ─────────────────────────────────────────────
  const { data: existingGoal, error: findErr } = await sb
    .from('curriculum_goals')
    .select('id')
    .eq('user_id', userId)
    .eq('curriculum_name', SEED_GOAL_NAME)
    .maybeSingle();
  if (findErr) throw new Error(`[seed] goal lookup failed: ${findErr.message}`);

  const goalPayload = {
    user_id: userId,
    child_id: childId,
    curriculum_name: SEED_GOAL_NAME,
    subject_label: SEED_SUBJECT,
    total_lessons: TOTAL,
    // Slot 1 is completed below, so the pointer sits at 1 and the projector
    // emits slot 2 as today's lesson.
    current_lesson: 1,
    start_at_lesson: 1,
    lessons_per_day: 1,
    lessons_per_day_overrides: null,
    school_days: SCHOOL_DAYS,
    start_date: startDate,
    default_minutes: 30,
    archived: false,
    completed_at: null,
  };

  let goalId: string;
  if (existingGoal) {
    goalId = (existingGoal as { id: string }).id;
    const { error } = await sb.from('curriculum_goals').update(goalPayload).eq('id', goalId);
    if (error) throw new Error(`[seed] goal update failed: ${error.message}`);
  } else {
    const { data: inserted, error } = await sb
      .from('curriculum_goals')
      .insert(goalPayload)
      .select('id')
      .single();
    if (error || !inserted) throw new Error(`[seed] goal insert failed: ${error?.message}`);
    goalId = (inserted as { id: string }).id;
  }

  // ── Rewrite its lessons ─────────────────────────────────────────────────
  // Scoped to this goal only. Other goals on the account, and every other
  // account, are untouched.
  const { error: delErr } = await sb.from('lessons').delete().eq('curriculum_goal_id', goalId);
  if (delErr) throw new Error(`[seed] lesson wipe failed: ${delErr.message}`);

  const base = {
    user_id: userId,
    child_id: childId,
    curriculum_goal_id: goalId,
    hours: 0,
  };

  const rows = [
    {
      ...base,
      title: `${SEED_SUBJECT} — Lesson 1`,
      lesson_number: 1,
      queue_position: 1,
      scheduled_date: completedDate,
      date: completedDate,
      completed: true,
      // Noon UTC, the convention every synthetic completion stamp uses.
      completed_at: `${completedDate}T12:00:00Z`,
      scheduled_source: 'completion_today',
      minutes_spent: 30,
      queue_pinned: false,
    },
    {
      ...base,
      title: `${SEED_SUBJECT} — Lesson 2`,
      lesson_number: 2,
      queue_position: 2,
      scheduled_date: todayDate,
      date: todayDate,
      completed: false,
      scheduled_source: 'wizard_create',
      queue_pinned: false,
    },
    {
      ...base,
      title: `${SEED_SUBJECT} — Lesson 3`,
      lesson_number: 3,
      queue_position: 3,
      scheduled_date: pastDate,
      date: pastDate,
      completed: false,
      scheduled_source: 'plan_move',
      // Pinned, or the reconciler rolls it onto today and the past-dated
      // state this exists to provide is gone on the first page load.
      queue_pinned: true,
    },
    // A little runway so Plan's week view and the move flow have somewhere to
    // put things.
    ...[4, 5, 6].map((n) => ({
      ...base,
      title: `${SEED_SUBJECT} — Lesson ${n}`,
      lesson_number: n,
      queue_position: n,
      scheduled_date: ymd(addDays(today, n - 3)),
      date: ymd(addDays(today, n - 3)),
      completed: false,
      scheduled_source: 'wizard_create',
      queue_pinned: false,
    })),
  ];

  const { error: insErr } = await sb.from('lessons').insert(rows);
  if (insErr) throw new Error(`[seed] lesson insert failed: ${insErr.message}`);

  return { goalId, todayDate, pastDate, completedDate };
}
