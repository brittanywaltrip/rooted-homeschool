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
  hours: number | null;
  minutes_spent: number | null;
  notes: string | null;
};

export type PlanV2Appointment = {
  id: string;
  title: string;
  emoji: string | null;
  date: string;
  time: string | null;
  duration_minutes: number;
  location: string | null;
  child_ids: string[];
  is_recurring: boolean;
  completed: boolean;
  /** Present on expanded recurring instances from GET /api/appointments. */
  instance_date: string;
};

export type PlanV2Vacation = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};
