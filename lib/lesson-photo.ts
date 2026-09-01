import { supabase } from "@/lib/supabase";
import { uploadMemoryPhoto } from "@/lib/photo-pipeline";
import { signedPhotoUrls } from "@/lib/photo-url";
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

/** Storage bucket every lesson photo lives in. Private: see signedPhotoUrls. */
const MEMORY_PHOTOS_BUCKET = "memory-photos";

/** How many photos a single lesson may print. */
export const PRINT_PHOTOS_PER_LESSON = 3;

/**
 * Six hours. The print sheet holds these URLs for as long as the browser's
 * print dialog stays open, and a family who opens the preview and then goes to
 * find paper can leave it sitting there. The default hour was long enough to
 * sign and short enough to expire mid-print.
 */
const PRINT_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Wait for one image to be decoded and paintable, or give up on it.
 *
 * Resolves true only when the bytes actually arrived, so a photo that 404s, a
 * URL that could not be signed, or a printer dialog opened over a dead network
 * costs the print nothing: the caller drops it and prints the rest. Never
 * rejects, and never hangs, which is the whole point.
 */
function preloadPrintImage(url: string, timeoutMs = 15000): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new window.Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => {
      // decode() is what guarantees the frame is paintable rather than merely
      // fetched. Not every browser has it, and a decode failure on an image
      // that DID load is not worth dropping the photo over.
      if (typeof img.decode === "function") {
        img.decode().then(() => finish(true), () => finish(true));
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = url;
  });
}

/**
 * Signed, decoded, ready-to-print photo URLs for a set of lessons.
 *
 * Three round trips total, no matter how many lessons: one SELECT for every
 * lesson's photo rows, one batched createSignedUrls, and then the image
 * fetches themselves (which are what the browser would issue anyway). Calling
 * fetchLessonPhotos in a loop would have fired one SELECT per lesson.
 *
 * Everything is resolved BEFORE this returns, because the caller triggers
 * window.print() on the result. SignedImage resolves its URL in a useEffect,
 * so a sheet built out of SignedImage would print grey placeholder boxes: the
 * print dialog snapshots the DOM long before that effect settles.
 *
 * A photo that cannot be signed or cannot be loaded is dropped silently. It
 * never blocks the print and never reaches paper as a broken-image icon.
 */
export async function loadLessonPhotosForPrint(
  lessonIds: string[],
): Promise<Map<string, string[]>> {
  const byLesson = new Map<string, string[]>();
  const ids = Array.from(new Set(lessonIds.filter(Boolean)));
  if (ids.length === 0) return byLesson;

  // ONE query for every lesson in range. created_at orders it so the cap below
  // always keeps the same three photos; it is ordered on but not selected.
  const { data, error } = await supabase
    .from("memories")
    .select("id, lesson_id, photo_url")
    .in("lesson_id", ids)
    .order("created_at", { ascending: true });
  if (error || !data) return byLesson;

  type Row = { id: string; lesson_id: string | null; photo_url: string | null };
  const rows = (data as Row[]).filter(
    (r): r is Row & { lesson_id: string; photo_url: string } =>
      !!r.lesson_id && !!r.photo_url && r.photo_url.trim().length > 0,
  );

  // Group and cap before signing, so the cap decides how much work we do.
  const capped: { lessonId: string; raw: string }[] = [];
  const perLesson = new Map<string, number>();
  for (const r of rows) {
    const n = perLesson.get(r.lesson_id) ?? 0;
    if (n >= PRINT_PHOTOS_PER_LESSON) continue;
    perLesson.set(r.lesson_id, n + 1);
    capped.push({ lessonId: r.lesson_id, raw: r.photo_url });
  }
  if (capped.length === 0) return byLesson;

  // One batched signing call for the whole sheet.
  const signed = await signedPhotoUrls(
    supabase,
    MEMORY_PHOTOS_BUCKET,
    capped.map((c) => c.raw),
    PRINT_URL_TTL_SECONDS,
  );

  // Decode every one of them before returning. allSettled, not all: one bad
  // photo must not reject the batch and cancel the print.
  const settled = await Promise.allSettled(
    signed.map((url) => (url ? preloadPrintImage(url) : Promise.resolve(false))),
  );

  capped.forEach((c, i) => {
    const url = signed[i];
    const outcome = settled[i];
    const ok = url && outcome.status === "fulfilled" && outcome.value === true;
    if (!ok) return;
    const arr = byLesson.get(c.lessonId) ?? [];
    arr.push(url);
    byLesson.set(c.lessonId, arr);
  });

  return byLesson;
}

/**
 * Attach a photo to a lesson: it becomes a memory (type "project") linked via
 * memories.lesson_id, so it shows in Memories.
 *
 * It stays OUT of the yearbook's photo pages, on purpose, which is why the
 * insert below sets include_in_book: false explicitly. A lesson photo inherits
 * the lesson's title, and a lesson title is an auto-generated curriculum label
 * ("Lesson 42", "Unit 3: Fractions"). Printed under a photograph in a keepsake
 * those read as mechanical, which is the opposite of what the book is for.
 * They are earmarked for the Record section instead, where a curriculum label
 * is the right register.
 *
 * The docstring used to claim these showed "in Memories and the yearbook
 * automatically". They never did: the insert has always set false.
 *
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
