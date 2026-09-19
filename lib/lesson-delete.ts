/**
 * The one way the app deletes a lesson.
 *
 * WHY THIS EXISTS
 *
 * supabase-js RESOLVES on a failed request instead of throwing. Sixteen call
 * sites deleted lessons directly and fourteen of them never looked at the
 * returned `error`, so two shapes of bug were possible and both happened:
 *
 *   try { await supabase.from("lessons").delete().eq("id", id); }
 *   catch { /* best-effort *\/ }        // the catch can never fire
 *
 *   setLessons(prev => prev.filter(...));
 *   await supabase.from("lessons").delete().eq("id", id);   // result dropped
 *
 * Once `authenticated` loses DELETE on lessons, those sites stop deleting and
 * say nothing: the row vanishes from the screen, stays in the database, and
 * reappears on the next load with no error in between. Routing every delete
 * through here makes the failure impossible to drop on the floor.
 */

export class LessonDeleteError extends Error {
  readonly code: string | undefined;
  /** True when the server refused because this tab predates the change. */
  readonly staleClient: boolean;
  constructor(message: string, code: string | undefined, staleClient: boolean) {
    super(message);
    this.name = "LessonDeleteError";
    this.code = code;
    this.staleClient = staleClient;
  }
}

/**
 * The narrow slice of the Supabase client this needs, so it is testable.
 *
 * PromiseLike, not Promise: supabase-js's rpc() returns a PostgrestFilterBuilder,
 * which is thenable but has no catch/finally. Typing this as Promise compiled
 * against a hand-written fake and failed against the real client.
 */
export type LessonDeleteClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string; code?: string } | null; data?: unknown }>;
};

/**
 * 42501 is insufficient_privilege. After the DELETE grant is removed it is
 * what an old bundle gets for a direct delete, and what anyone gets for a
 * lesson that is not theirs. The two are deliberately not distinguished to the
 * caller by the server -- "not found" and "not yours" are the same answer --
 * so the wording here covers both without asserting which.
 */
const PERMISSION_DENIED = "42501";

export function messageFor(err: { message: string; code?: string }): string {
  if (err.code === PERMISSION_DENIED) {
    return "We couldn't remove that lesson. This page may be out of date — reload and try again.";
  }
  return "We couldn't remove that lesson. Please try again.";
}

/**
 * Several lessons at once. All-or-nothing: the server refuses the whole call if
 * any id is not the caller's, so a partial delete cannot happen.
 * Returns the number of rows the DATABASE removed, not the number asked for.
 */
export async function deleteLessonsByIds(
  client: LessonDeleteClient,
  lessonIds: readonly string[],
): Promise<number> {
  const ids = lessonIds.filter(Boolean);
  if (ids.length === 0) return 0;
  const { error, data } = await client.rpc("delete_lessons", { p_lesson_ids: ids });
  if (error) {
    throw new LessonDeleteError(messageFor(error), error.code, error.code === PERMISSION_DENIED);
  }
  return typeof data === "number" ? data : ids.length;
}

/** Every lesson in one school year. Used only by the "add a past year" undo. */
export async function deleteYearLessons(
  client: LessonDeleteClient,
  schoolYearId: string,
): Promise<number> {
  if (!schoolYearId) throw new LessonDeleteError("No school year id given.", undefined, false);
  const { error, data } = await client.rpc("delete_year_lessons", {
    p_school_year_id: schoolYearId,
  });
  if (error) {
    throw new LessonDeleteError(messageFor(error), error.code, error.code === PERMISSION_DENIED);
  }
  return typeof data === "number" ? data : 0;
}

/** Every PENDING lesson of one curriculum. Completed history is never touched. */
export async function deleteGoalPendingLessons(
  client: LessonDeleteClient,
  goalId: string,
): Promise<number> {
  if (!goalId) throw new LessonDeleteError("No curriculum id given.", undefined, false);
  const { error, data } = await client.rpc("delete_goal_pending_lessons", { p_goal_id: goalId });
  if (error) {
    throw new LessonDeleteError(messageFor(error), error.code, error.code === PERMISSION_DENIED);
  }
  return typeof data === "number" ? data : 0;
}

export async function deleteLessonById(
  client: LessonDeleteClient,
  lessonId: string,
): Promise<void> {
  if (!lessonId) throw new LessonDeleteError("No lesson id given.", undefined, false);
  const { error } = await client.rpc("delete_lesson", { p_lesson_id: lessonId });
  if (error) {
    throw new LessonDeleteError(messageFor(error), error.code, error.code === PERMISSION_DENIED);
  }
}
