import type { AddLessonSubmit } from "./AddLessonModal";

/** One independent lesson per child; reports and completion remain per child. */
export function oneOffLessonRows(userId: string, childIds: string[], values: AddLessonSubmit, completed: boolean) {
  if (values.curriculum_goal_id) throw new Error("Shared lessons cannot be linked to a curriculum.");
  return childIds.map((child_id) => ({
    user_id: userId,
    child_id,
    curriculum_goal_id: null,
    title: values.title,
    lesson_number: completed ? null : values.lesson_number,
    minutes_spent: values.minutes_spent,
    hours: values.minutes_spent != null ? values.minutes_spent / 60 : 0,
    scheduled_date: values.scheduled_date,
    date: values.scheduled_date,
    notes: values.notes,
    completed,
    completed_at: completed ? `${values.scheduled_date}T12:00:00Z` : null,
    scheduled_source: completed ? "extra_log" : "plan_move",
    ...(completed ? { is_backfill: false, queue_position: null } : {}),
  }));
}
