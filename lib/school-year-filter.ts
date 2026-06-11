// Shared, NULL-safe school-year membership test.
//
// curriculum_goals.school_year_id links a goal to a school_years row. Goals
// created before the link existed — or by any code path that forgets to set
// it — carry NULL. Every place that scopes goals to "the active year" MUST
// treat NULL as belonging to the active year, otherwise unlinked goals
// silently vanish from the Plan page (the 2026-06 unlinked-goals bug: a
// brand-new user who built their first schedule saw an empty plan).
//
// The Schedule Builder now stamps school_year_id on create so new goals are
// linked, but this guard is the defensive backstop: even if a NULL slips
// through again, the goal stays visible under the active-year view.
//
// Pass activeYearId = null when the user has no active year; in that case
// nothing is scoped out (every goal is "in view").
export function goalBelongsToActiveYear(
  goalSchoolYearId: string | null | undefined,
  activeYearId: string | null | undefined,
): boolean {
  // No active year to scope against → show everything.
  if (!activeYearId) return true;
  // Unlinked goal (NULL) → treated as the active year so it never vanishes.
  if (goalSchoolYearId == null) return true;
  return goalSchoolYearId === activeYearId;
}
