"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { uploadMemoryPhoto, PhotoReadError } from "@/lib/photo-pipeline";
import { captureSupabaseError } from "@/lib/sentry-error";
import { onLogAction } from "@/app/lib/onLogAction";
import { getRemainingPhotoSlots } from "@/app/lib/integrity-checks";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type Category = "book" | "field_trip" | "project" | "activity" | "photo" | "reflection";

interface LogTodayModalProps {
  children: Child[];
  subjects: Subject[];
  today: string;
  selectedDate?: string;
  onClose: () => void;
  onSaved: (type: string, childId?: string) => void;
}

// ─── Category chips ───────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; emoji: string; label: string; keywords: string[] }[] = [
  { id: "book",       emoji: "\uD83D\uDCD6", label: "Book",       keywords: ["read", "book", "chapter", "story", "novel", "library"] },
  { id: "field_trip", emoji: "\uD83D\uDDFA\uFE0F", label: "Field Trip", keywords: ["trip", "visit", "museum", "zoo", "park", "farm", "tour", "hike"] },
  { id: "project",    emoji: "\uD83D\uDD2C", label: "Project",    keywords: ["project", "experiment", "build", "made", "created", "craft", "science"] },
  { id: "activity",   emoji: "\uD83C\uDFB5", label: "Activity",   keywords: ["practice", "piano", "soccer", "art", "class", "lesson", "sport", "music", "dance"] },
  { id: "photo",      emoji: "\uD83D\uDCF7", label: "Photo",      keywords: ["photo", "picture", "snap", "image"] },
  { id: "reflection", emoji: "\uD83D\uDCAD", label: "Reflection", keywords: ["reflect", "journal", "thought", "felt", "feeling"] },
];

function suggestCategory(text: string): Category {
  const lower = text.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => lower.includes(kw))) return cat.id;
  }
  return "activity"; // default
}

// ─── Child pill selector ──────────────────────────────────────────────────────

function ChildPills({
  children, value, onChange,
}: { children: Child[]; value: string; onChange: (id: string) => void }) {
  if (children.length === 0) return null;
  return (
    <div>
      <label className="text-xs font-medium text-[#7a6f65] block mb-2">Who?</label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange("")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            value === "" ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
          }`}
        >
          Everyone
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
            style={
              value === c.id
                ? { backgroundColor: c.color ?? "#5c7f63", borderColor: c.color ?? "#5c7f63", color: "white" }
                : { backgroundColor: "white", color: "#7a6f65", borderColor: "#e8e2d9" }
            }
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LogTodayModal({
  children, subjects, today, selectedDate, onClose, onSaved,
}: LogTodayModalProps) {
  const saveDate = selectedDate ?? today;
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [isPro,   setIsPro]   = useState<boolean | null>(null);
  // uploadError is the CAP only, and its block carries an upgrade link.
  // photoError is a decode or upload failure: same styling, no pricing link.
  // Routing every photo failure through uploadError showed an Android family
  // HEIC camera advice with "Upgrade to Pro" under it, which reads as a
  // shakedown for a problem that has nothing to do with their plan.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Set once the entry has actually been written. The photo-failure path leaves
  // the sheet open so the family can read what happened; this stops a second
  // Save press from inserting the same entry twice.
  const [entrySaved, setEntrySaved] = useState(false);
  // The category the saved row was written under, so the close path reports the
  // same one even if a chip is tapped afterwards.
  const savedCategoryRef = useRef<string | null>(null);

  // Unified form fields
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [childId,     setChildId]     = useState(children.length === 1 ? children[0].id : "");
  const [category,    setCategory]    = useState<Category>("activity");
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  // Photo
  const [photoFile,    setPhotoFile]    = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Reflection toggle
  const [isReflection,     setIsReflection]     = useState(false);
  const [reflectionPrivate, setReflectionPrivate] = useState(false);

  // Auto-suggest category as user types
  useEffect(() => {
    if (title.length >= 3) {
      setCategory(suggestCategory(title));
    }
  }, [title]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("profiles").select("is_pro").eq("id", user.id).single()
        .then(({ data }) => setIsPro((data as { is_pro?: boolean } | null)?.is_pro ?? false));
    });
  }, []);

  const _now = new Date();
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  const _yd = new Date(_now); _yd.setDate(_yd.getDate() - 1);
  const yesterdayStr = `${_yd.getFullYear()}-${String(_yd.getMonth() + 1).padStart(2, "0")}-${String(_yd.getDate()).padStart(2, "0")}`;
  const effectiveDate = dateOverride || saveDate;

  async function handleSave() {
    setSaving(true);
    setError("");
    setUploadError(null);
    setPhotoError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not logged in."); setSaving(false); return; }

      // Reflection mode — save to daily_reflections
      if (isReflection) {
        if (!title.trim()) { setError("Please write something."); setSaving(false); return; }
        await supabase.from("daily_reflections").upsert(
          { user_id: user.id, date: effectiveDate, reflection: title.trim(), is_private: reflectionPrivate, updated_at: new Date().toISOString() },
          { onConflict: "user_id,date" }
        );
        // Reflections count as daily engagement — keep the streak.
        onLogAction({ userId: user.id, actionType: "memory" });
        onSaved("reflection");
        return;
      }

      // Photo upload if attached. Neither the cap nor a failed upload may
      // discard what the family typed, so both record the cause and fall
      // through to the insert with photoUrl left undefined.
      //
      // The CAUSE is kept separate from the "what was saved" preamble, because
      // the blank-entry branch below saves nothing and must not claim it did.
      let photoUrl: string | undefined;
      let photoFailure: { message: string; isCap: boolean } | null = null;
      if (photoFile) {
        // getRemainingPhotoSlots is the one definition of how many photos a
        // family has, shared with the FAB, Today and the lesson-photo path.
        const remaining = await getRemainingPhotoSlots(user.id, !isPro);
        if (remaining <= 0) {
          photoFailure = { message: "New photo memories need a Rooted+ plan.", isCap: true };
        } else {
          // Scoped to the upload alone so it cannot reach the outer catch,
          // which abandons the entry.
          try {
            const uploaded = await uploadMemoryPhoto(supabase, user.id, photoFile);
            photoUrl = uploaded.photoUrl;
          } catch (err) {
            captureSupabaseError("log today photo", err);
            photoFailure = {
              message: err instanceof PhotoReadError
                ? err.userMessage
                : "The photo didn't upload, you can add it from Memories.",
              isCap: false,
            };
          }
        }
      }

      // Nothing typed and no photo landed: there is no entry worth writing, so
      // show what went wrong with the photo instead of inserting a blank row.
      if (!title.trim() && !description.trim() && !photoUrl) {
        if (photoFailure?.isCap) {
          setUploadError("You've reached your memory limit 🤍 New photo memories won't be saved until you upgrade.");
        } else if (photoFailure) {
          setPhotoError(photoFailure.message);
        } else {
          setError("Please describe what you want to remember.");
        }
        setSaving(false);
        return;
      }

      // Typed from whether a photo actually landed, not from whether one was
      // picked. A row with no photo must never be typed "memory_photo".
      const eventType = photoUrl ? "memory_photo" : `memory_${category}`;

      const payload: Record<string, unknown> = {
        title: title.trim() || (photoUrl ? "Photo" : "Note"),
        date: effectiveDate,
        child_id: childId || undefined,
      };
      if (description.trim()) payload.description = description.trim();
      if (photoUrl) payload.photo_url = photoUrl;

      await supabase.from("app_events").insert({
        user_id: user.id,
        type: eventType,
        payload,
      });

      // Fire streak + badge check (fire-and-forget)
      const actionMap: Record<string, "memory" | "book" | "field_trip" | "project" | "activity"> = {
        book: "book", field_trip: "field_trip", project: "project", activity: "activity", photo: "memory",
      };
      onLogAction({ userId: user.id, childId: childId || undefined, actionType: actionMap[category] ?? "memory" });

      if (photoFailure) {
        // The entry is saved. onSaved would close this sheet, and the family
        // would never learn the photo did not attach, so hold it open and let
        // them close it themselves. The close path reports to the parent (see
        // handleClose) so the saved entry still appears on the day.
        setEntrySaved(true);
        savedCategoryRef.current = category;
        // Lead with what WAS saved, then what wasn't. The cap keeps its upgrade
        // link; a decode or upload failure gets the same block without one.
        const note = `Your note was saved. ${photoFailure.message}`;
        if (photoFailure.isCap) setUploadError(note);
        else setPhotoError(note);
        // Listeners (the Memories grid) still refresh without this sheet
        // closing, so the saved entry is not stranded behind a stale list.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("rooted:memory-saved", { detail: { type: category } }));
        }
        return;
      }

      onSaved(category, childId || undefined);
    } catch (e) {
      // PhotoReadError carries copy written for a family (undecodable HEIC, a
      // zero-byte pick from the Android cloud picker); show it verbatim.
      if (e instanceof PhotoReadError) setError(e.userMessage);
      else setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Close the sheet.
   *
   * When an entry was already written and the sheet was held open to explain a
   * photo failure, the parent has to be told. DayDetailPanel learns about a
   * save ONLY through onSaved: it does not listen for rooted:memory-saved. A
   * plain onClose left the family looking at a day with no entry on it, so they
   * logged it again, and because the modal remounts (resetting entrySaved,
   * which guards a second press, not a second mount) a duplicate row was
   * written. Reporting on close makes the parent refresh exactly as it does on
   * a normal save.
   */
  function handleClose() {
    if (entrySaved) onSaved(savedCategoryRef.current ?? category, childId || undefined);
    onClose();
  }

  const canSave = !saving && !entrySaved && (title.trim().length > 0 || !!photoFile || (isReflection && title.trim().length > 0));

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={handleClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center md:inset-0 md:items-center">
        <div
          className="bg-[#fefcf9] rounded-t-3xl md:rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 md:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <h2 className="text-lg font-bold text-[#2d2926]">Log a Memory</h2>
            <button type="button" onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-8 space-y-4">

            {/* Step 1 — What happened? */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What do you want to remember?</label>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="We visited the science museum and saw real dinosaur fossils..."
                rows={3}
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
              />
            </div>

            {/* Step 2 — Add a photo */}
            {!isReflection && (
              <div>
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="Preview" className="w-full h-40 object-cover rounded-xl border border-[#e8e2d9]" />
                    <button
                      type="button"
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full flex items-center gap-3 py-3 px-4 rounded-xl border border-dashed border-[#e8e2d9] bg-[#f8f7f4] hover:border-[#5c7f63] hover:bg-[#f0f7f0] transition-colors"
                  >
                    <span className="text-xl">{"\uD83D\uDCF8"}</span>
                    <span className="text-sm font-medium text-[#7a6f65]">Add a photo</span>
                    <span className="ml-auto text-[10px] text-[#b5aca4]">optional</span>
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) { setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); }
                  }}
                />
              </div>
            )}

            {/* Step 3 — Who + When */}
            <ChildPills children={children} value={childId} onChange={setChildId} />

            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-2">When?</label>
              <div className="flex gap-2">
                {[
                  { label: "Today", value: todayStr },
                  { label: "Yesterday", value: yesterdayStr },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setDateOverride(opt.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      effectiveDate === opt.value
                        ? "bg-[#eef5ee] border-[#5c7f63] text-[var(--g-deep)] font-semibold"
                        : "bg-white border-[#e8e2d9] text-[#7a6f65]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setDateOverride(e.target.value)}
                  className="px-2 py-1.5 rounded-full text-xs border border-[#e8e2d9] text-[#7a6f65] bg-white"
                />
              </div>
            </div>

            {/* Step 4 — Category chips (auto-suggested) */}
            {!isReflection && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-2">Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.filter((c) => c.id !== "reflection").map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        category === cat.id
                          ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                          : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
                      }`}
                    >
                      {cat.emoji} {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reflection toggle */}
            <button
              type="button"
              onClick={() => setIsReflection(!isReflection)}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs border transition-colors ${
                isReflection
                  ? "bg-[#f0e8f4] border-[#c8b8d8] text-[#5a3a7a]"
                  : "bg-[#f8f7f4] border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
              }`}
            >
              {"\uD83D\uDCAD"} {isReflection ? "Writing a reflection, this saves to your journal" : "Or write a private reflection instead"}
            </button>

            {isReflection && (
              <button
                type="button"
                onClick={() => setReflectionPrivate((v) => !v)}
                className="flex items-center gap-2 text-xs text-[#7a6f65]"
              >
                <div className={`w-8 h-[18px] rounded-full transition-colors relative ${reflectionPrivate ? "bg-[#5c7f63]" : "bg-[#e8e2d9]"}`}>
                  <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${reflectionPrivate ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
                </div>
                <span>{reflectionPrivate ? "\uD83D\uDD12 Private" : "\uD83D\uDC41 Visible in Kid Mode"}</span>
              </button>
            )}

            {/* Errors */}
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            {uploadError && (
              <div className="rounded-xl border border-[#e8e2d9] bg-[#fefcf9] p-4 text-center">
                <p className="mb-2 text-sm text-[#2d2926]">{uploadError}</p>
                <Link href="/dashboard/pricing" className="text-sm font-semibold text-[#5c7f63] underline">Upgrade to Pro</Link>
              </div>
            )}
            {photoError && (
              <div className="rounded-xl border border-[#e8e2d9] bg-[#fefcf9] p-4 text-center">
                <p className="text-sm text-[#2d2926]">{photoError}</p>
              </div>
            )}

            {/* Save */}
            {!isReflection && (
              <p className="text-xs text-[#5c7f63] italic text-center">
                🌿 Earn a leaf for your garden!
              </p>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="w-full py-3 rounded-xl bg-[var(--g-deep)] hover:bg-[#2d4a32] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Saving\u2026" : "Save \uD83C\uDF3F"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
