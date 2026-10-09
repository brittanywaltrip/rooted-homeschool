/** A form baseline is distinct from the stored baseline: e.g. next lesson
 * displays current_lesson + 1, while start_at_lesson may still be 1. */
export type EditBaseline = { stored: Record<string, unknown>; form: Record<string, unknown> };

function canonical(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function sameSetting(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Three-way merge. Never infer intent by comparing the form to a fresh read.
 * A convergent edit is safe (also covers retry after a lost save response). */
export function resolveBuilderEdits(baseline: EditBaseline | undefined, form: Record<string, unknown>, current: Record<string, unknown>) {
  if (!baseline) throw new Error("This draft needs to be reopened before saving. Keep a copy of your edits, discard the saved draft, then reopen the Builder.");
  const patch: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of Object.keys(form)) {
    if (sameSetting(form[key], baseline.form[key])) continue;
    if (!sameSetting(current[key], baseline.stored[key]) && !sameSetting(current[key], form[key])) conflicts.push(key);
    else if (!sameSetting(current[key], form[key])) patch[key] = form[key];
  }
  // Flat pace and its override map are one control. Merging half of each
  // tab's pace would persist a setting different from either family's edit.
  const pace = ["lessons_per_day", "lessons_per_day_overrides"];
  if (pace.some(k => !sameSetting(form[k], baseline.form[k])) &&
      pace.some(k => !sameSetting(current[k], baseline.stored[k])) &&
      pace.some(k => !sameSetting(current[k], form[k]))) conflicts.push("lessons per day");
  if (conflicts.length) {
    const labels: Record<string, string> = {
      child_id: "child", curriculum_name: "name", subject_label: "subject",
      total_lessons: "total lessons", start_date: "start date", start_at_lesson: "starting lesson",
      lessons_per_day: "lessons per day", lessons_per_day_overrides: "lessons per day",
      school_days: "school days", default_minutes: "lesson length", scheduled_start_time: "lesson time",
    };
    const fields = [...new Set(conflicts.map(key => labels[key] ?? key))];
    throw new Error(`These settings changed in another tab: ${fields.join(", ")}. Reload the Builder and review your edits before saving.`);
  }
  return { patch, merged: { ...current, ...patch } };
}

/** Client guard only: the RPC must validate these under its lock to close the
 * interval AFTER this read. Include our own metadata patch in planned. */
export function builderPlanDependenciesMatch(planned: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return !current.archived && current.completed_at == null &&
    ["child_id", "curriculum_name", "subject_label", "default_minutes"].every(key => sameSetting(planned[key], current[key])) &&
    sameSetting(databaseTime(planned.scheduled_start_time), databaseTime(current.scheduled_start_time));
}

// PostgreSQL returns seconds for time columns; the form may send only HH:MM.
function databaseTime(value: unknown): unknown {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}
