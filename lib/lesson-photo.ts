import { supabase } from "@/lib/supabase";
import { uploadMemoryPhoto } from "@/lib/photo-pipeline";
import { getRemainingPhotoSlots } from "@/app/lib/integrity-checks";
import { posthog } from "@/lib/posthog";

// Window event the Today page listens for so it can re-run refreshTodayStory()
// + loadData() after a lesson photo is saved (regression guard). The Plan page
// doesn't render Today's Story, so its lesson card just refreshes its own
// thumbnails — no listener needed there.
export const LESSON_PHOTO_SAVED_EVENT = "rooted:lesson-photo-saved";

export type LessonPhoto = { id: string; photo_url: string | null };

/** Thrown when a free user hits the 50-photo cap — surfaced as a soft message. */
export class PhotoLimitError extends Error {}

/** Memories linked to a lesson, oldest first (a lesson may have several). */
export async function fetchLessonPhotos(lessonId: string): Promise<LessonPhoto[]> {
  const { data } = await supabase
    .from("memories")
    .select("id, photo_url")
    .eq("lesson_id", lessonId)
    .order("created_at", { ascending: true });
  return (data as LessonPhoto[] | null) ?? [];
}

/**
 * Attach a photo to a lesson: it becomes a memory (type "project") linked via
 * memories.lesson_id, so it shows in Memories and the yearbook automatically.
 * Reuses the shared capture primitive (uploadMemoryPhoto in lib/photo-pipeline)
 * plus a memories insert. The memory inherits the lesson's child, date, and
 * title (the title is used as the caption).
 */
export async function saveLessonPhoto(lessonId: string, file: File): Promise<{ id: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You're not signed in.");

  // The memory inherits the lesson's child / date / title.
  const { data: lesson, error: lessonErr } = await supabase
    .from("lessons")
    .select("id, child_id, date, title")
    .eq("id", lessonId)
    .eq("user_id", user.id)
    .single();
  if (lessonErr || !lesson) throw new Error("Couldn't find that lesson.");

  // Same free 50-photo cap the other capture paths enforce.
  const { data: profile } = await supabase.from("profiles").select("is_pro").eq("id", user.id).maybeSingle();
  const isPro = (profile as { is_pro?: boolean } | null)?.is_pro ?? false;
  if ((await getRemainingPhotoSlots(user.id, !isPro)) <= 0) {
    throw new PhotoLimitError("You've reached your memory limit 🤍 Upgrade to keep saving photos.");
  }

  const { photoUrl, width, height } = await uploadMemoryPhoto(supabase, user.id, file);

  const now = new Date().toISOString();
  const { data: ins, error: insErr } = await supabase
    .from("memories")
    .insert({
      user_id: user.id,
      type: "project",
      title: lesson.title ?? "",
      caption: lesson.title ?? null,
      photo_url: photoUrl,
      photo_width: width,
      photo_height: height,
      child_id: lesson.child_id,
      date: lesson.date,
      lesson_id: lessonId,
      include_in_book: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insErr || !ins) throw new Error(`Save failed: ${insErr?.message ?? "unknown error"}`);

  posthog.capture("lesson_photo_added", { lesson_id: lessonId, user_plan: isPro ? "paid" : "free" });
  return { id: (ins as { id: string }).id };
}
