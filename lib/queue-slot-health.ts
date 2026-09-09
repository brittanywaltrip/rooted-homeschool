// Shared vocabulary for the queue-slot repair scripts and the health check.
//
// Two things live here, both of which used to be copied per script and drifted:
// which accounts are not families, and what counts as a hole.
//
// Pure by design. No supabase import, no env read, no I/O — the repair scripts
// run under `node --env-file`, the tests run under `node --test`'s strip-only
// loader, and neither can afford this file to pull a client in.

/**
 * Accounts that are not families. Their goals are deliberately in odd states
 * and must never be repaired, counted, or alerted on alongside real data.
 *
 * ONE list, imported by all four consumers. Before 2026-09-09 each repair
 * script declared `EXCLUDED_EMAIL = 'garfieldbrittany+test1@gmail.com'` on its
 * own and none of them knew about the other three accounts. The cost was not
 * hypothetical: the first run of the health check reported "8 goals blank
 * within 2 slots, 1 blank RIGHT NOW" and every one of the eight belonged to
 * test@rootedhomeschoolapp.com. A check that cries wolf gets ignored, and then
 * it is worse than not having one.
 */
export const NON_FAMILY_EMAILS: readonly string[] = [
  // The demo/screenshot account. 8 goals, 36 lesson rows against totals of 30
  // to 180, so nearly every goal is a stub with an ungenerated tail.
  'test@rootedhomeschoolapp.com',
  // The Playwright account, seeded and torn down by the e2e suite.
  // See e2e/test-account.ts.
  'rooted.e2e@rootedhomeschoolapp.com',
  // Brittany's throwaway test account, reset by hand during releases. This is
  // the one the three repair scripts already excluded.
  'garfieldbrittany+test1@gmail.com',
  // Brittany's own account, which carries hand-built fixtures.
  'brittanywaltrip20@gmail.com',
]

/** Case-insensitive, because auth.users stores what the user typed. */
export function isNonFamilyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return NON_FAMILY_EMAILS.some((x) => x === e);
}

export interface GoalSlotHealth {
  /**
   * Slots between the pointer and the last one the goal actually reaches that
   * hold no row. THIS is the defect: the family works up to it and hits a blank
   * subject card with lessons sitting on the far side of it.
   */
  interiorHoles: number[];
  /**
   * How many slots past max(queue_position) were never generated. NOT the same
   * defect and deliberately not counted as one. Plenty of healthy goals hold
   * fewer rows than total_lessons -- the Schedule Builder writes from the
   * pointer forward and the next save extends it, so a tail fills in on its own
   * as the family moves. The 8 goals that made the first version of the health
   * check scream were all tail and no hole.
   */
  missingTail: number;
  /**
   * Slots the family gets through before the first INTERIOR hole; null when
   * there is none. 0 means they are looking at a blank card right now.
   */
  slotsUntilBlank: number | null;
}

/**
 * Classify one goal's queue.
 *
 * `heldSlots` is every queue_position the goal's rows occupy. `maxHeld` is
 * taken from that set rather than from total_lessons, which is what separates
 * "there is a gap in the middle of what exists" from "it has not been written
 * out that far yet".
 */
export function classifyGoalSlots(
  currentLesson: number,
  totalLessons: number,
  heldSlots: ReadonlySet<number>,
): GoalSlotHealth {
  const empty: GoalSlotHealth = { interiorHoles: [], missingTail: 0, slotsUntilBlank: null };
  if (!Number.isInteger(totalLessons) || totalLessons <= 0) return empty;
  const from = Math.max(0, currentLesson) + 1;
  if (from > totalLessons) return empty;  // finished; nothing left to project

  let maxHeld = 0;
  for (const s of heldSlots) if (s > maxHeld) maxHeld = s;

  // A goal with no rows at all has no interior to speak of: every slot ahead of
  // it is tail. It is still a problem, but it is the EMPTY problem, which
  // healEmptyGoal and repair-empty-goals own.
  const interiorEnd = Math.min(totalLessons, maxHeld);

  const interiorHoles: number[] = [];
  for (let s = from; s <= interiorEnd; s++) {
    if (!heldSlots.has(s)) interiorHoles.push(s);
  }
  const tailStart = Math.max(from, maxHeld + 1);
  const missingTail = Math.max(0, totalLessons - tailStart + 1);

  return {
    interiorHoles,
    missingTail,
    slotsUntilBlank: interiorHoles.length > 0 ? interiorHoles[0] - from : null,
  };
}
