"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import SignedImage from "@/components/SignedImage";
import {
  fetchLessonPhotos,
  saveLessonPhoto,
  PhotoLimitError,
  LESSON_PHOTO_SAVED_EVENT,
  type LessonPhoto,
} from "@/lib/lesson-photo";
import { PhotoReadError } from "@/lib/photo-pipeline";

/**
 * "Add a photo" affordance for a single lesson. Self-contained: it loads its
 * own linked memories (thumbnails + count) by lesson_id, and on save inserts a
 * lesson-linked memory then refreshes itself. After a save it dispatches
 * LESSON_PHOTO_SAVED_EVENT so the Today page can refresh Today's Story + the
 * memories grid. Used on both the Today lesson card and the Plan day-detail
 * lesson. Free feature — no export gate.
 *
 * "Add a photo" opens the same two-option action sheet the dashboard FAB uses
 * (take a photo / choose from library), backed by two hidden inputs. Keep the
 * two sheets in step: if one gains a capture option, so should the other.
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
  // Two file inputs, not one: the `capture` attribute suppresses the library
  // picker, so the camera input and the gallery input cannot be the same
  // element. Same split the dashboard FAB uses.
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
      // PhotoReadError explains WHY the file couldn't be read (HEIC, a
      // zero-byte cloud pick), which the generic line never could.
      if (e instanceof PhotoLimitError) setError(e.message);
      else if (e instanceof PhotoReadError) setError(e.userMessage);
      else setError("Couldn't add the photo. Please try again.");
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
            onClick={() => setSheetOpen(true)}
            disabled={saving}
            className="flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-lg border border-dashed border-[#c8bfb5] text-[12px] font-medium text-[#5c7f63] hover:border-[#5c7f63] hover:bg-[#f0f7f0] transition-colors disabled:opacity-50"
          >
            <span aria-hidden>📷</span>
            {saving ? "Adding…" : photos.length > 0 ? `Add a photo · ${photos.length}` : "Add a photo"}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {/* Library picker. Single-select, as it has always been here. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }}
      />
      {/* Camera: single shot, straight to the rear camera. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }}
      />

      {/* Action sheet: camera or library. Mirrors the dashboard FAB sheet. */}
      {sheetOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={() => setSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
            <div className="px-5 pb-5 space-y-2.5">
              <button type="button" onClick={() => { setSheetOpen(false); cameraRef.current?.click(); }}
                className="w-full py-3 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                style={{ backgroundColor: "var(--g-brand)" }}>
                <Camera size={16} strokeWidth={2.2} />
                Take a photo
              </button>
              <button type="button" onClick={() => { setSheetOpen(false); inputRef.current?.click(); }}
                className="w-full py-3 rounded-xl text-sm font-medium border border-[#e8e2d9] bg-white text-[#2d2926] transition-colors hover:border-[#5c7f63]">
                Choose from library
              </button>
              <button type="button" onClick={() => setSheetOpen(false)}
                className="w-full py-3 rounded-xl text-sm font-medium text-[#7a6f65] transition-colors hover:bg-[#f0ede8]">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
