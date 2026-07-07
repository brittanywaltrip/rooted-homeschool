/* Shared types for PlanV2. Kept deliberately lighter than the legacy page's
 * `Lesson` so components can be swapped in isolation. */

export type PlanV2Child = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
};

export type PlanV2Subject = { name: string; color: string | null } | null;

export type PlanV2Lesson = {
  id: string;
  title: string | null;
  lesson_number: number | null;
  completed: boolean;
  child_id: string | null;
  scheduled_date: string | null;
  date: string | null;
  curriculum_goal_id: string | null;
  subjects: PlanV2Subject;
  curriculum_goals?: { subject_label: string | null } | null;
  hours: number | null;
  minutes_spent: number | null;
  notes: string | null;
  scheduled_source: string | null;
  completed_at: string | null;
};

export type PlanV2Appointment = {
  id: string;
  title: string;
  emoji: string | null;
  date: string;
  time: string | null;
  duration_minutes: number;
  location: string | null;
  notes?: string | null;
  child_ids: string[];
  is_recurring: boolean;
  recurrence_rule: { frequency: string; days: number[]; end_date?: string } | null;
  completed: boolean;
  is_school_activity?: boolean;
  /** Present on expanded recurring instances from GET /api/appointments. */
  instance_date: string;
  /** Set when an exception row was merged into this instance (phase 8). */
  exception_id?: string | null;
};

export type PlanV2Vacation = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  /** True when creating this break pushed lessons forward. Read back so the
   *  delete flow can offer to move them back. Defaults false for older rows. */
  shift_applied?: boolean;
};

/* A recurring activity (extracurricular / co-op / lessons-outside-curriculum).
 *
 * IMPORTANT day-of-week convention: `days` is stored Mon=0..Sun=6 (the
 * ActivitySetupModal convention — DAY_LABELS = ["M","T","W","Th","F","Sa","Su"]),
 * which is NOT the same as JS Date.getDay() (Sun=0..Sat=6). Convert with
 * `(jsDow + 6) % 7` before comparing. See activityOccurrences.ts and the
 * Today read-path in app/dashboard/page.tsx, which use the same convention.
 *
 * `created_at` is carried because it is the anchor for biweekly cadence —
 * the Today page anchors "every other week" on created_at, and the calendar
 * mirrors that so both surfaces agree on which weeks an activity lands. */
export type PlanV2Activity = {
  id: string;
  name: string;
  emoji: string | null;
  frequency: "weekly" | "biweekly" | "monthly";
  days: number[]; // Mon=0..Sun=6 (NOT JS getDay order)
  start_date: string | null;
  end_date: string | null;
  duration_minutes: number | null;
  child_ids: string[] | null;
  location: string | null;
  created_at: string | null;
};
