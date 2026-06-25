"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignedImage from "@/components/SignedImage";
import {
  fetchLessonPhotos,
  saveLessonPhoto,
  PhotoLimitError,
  LESSON_PHOTO_SAVED_EVENT,
  type LessonPhoto,
} from "@/lib/lesson-photo";

/**
 * "Add a photo" affordance for a single lesson. Self-contained: it loads its
 * own linked memories (thumbnails + count) by lesson_id, and on save inserts a
 * lesson-linked memory then refreshes itself. After a save it dispatches
 * LESSON_PHOTO_SAVED_EVENT so the Today page can refresh Today's Story + the
 * memories grid. Used on both the Today lesson card and the Plan day-detail
 * lesson. Free feature — no export gate.
 */
export default function LessonPhotoButton({
  lessonId,
  isPartner = false,
}: {
  lessonId: string;
  isPartner?: boolean;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<LessonPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetchLessonPhotos(lessonId).then((p) => { if (active) setPhotos(p); });
    return () => { active = false; };
  }, [lessonId]);

  async function handleFile(file: File) {
    setSaving(true);
    setError(null);
    try {
      await saveLessonPhoto(lessonId, file);
      setPhotos(await fetchLessonPhotos(lessonId));
      window.dispatchEvent(new Event(LESSON_PHOTO_SAVED_EVENT));
    } catch (e) {
      setError(e instanceof PhotoLimitError ? e.message : "Couldn't add the photo. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Read-only partners with no photos: render nothing.
  if (isPartner && photos.length === 0) return null;

  return (
    <div className="mt-2" data-no-toggle onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 flex-wrap">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.push(`/dashboard/memories?highlight=${p.id}`)}
            className="w-10 h-10 rounded-lg overflow-hidden border border-[#e8e2d9] shrink-0 bg-[#f0ede8] flex items-center justify-center"
            aria-label="Open lesson photo"
          >
            {p.photo_url ? (
              <SignedImage src={p.photo_url} bucket="memory-photos" alt="Lesson photo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-base">📷</span>
            )}
          </button>
        ))}
        {!isPartner && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={saving}
            className="flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-lg border border-dashed border-[#c8bfb5] text-[12px] font-medium text-[#5c7f63] hover:border-[#5c7f63] hover:bg-[#f0f7f0] transition-colors disabled:opacity-50"
          >
            <span aria-hidden>📷</span>
            {saving ? "Adding…" : photos.length > 0 ? `Add a photo · ${photos.length}` : "Add a photo"}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }}
      />
    </div>
  );
}
