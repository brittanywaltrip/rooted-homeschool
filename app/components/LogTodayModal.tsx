"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type Mode = null | "book" | "field_trip" | "project" | "activity" | "photo" | "reflection";

interface LogTodayModalProps {
  children: Child[];
  subjects: Subject[];
  today: string;
  selectedDate?: string;
  onClose: () => void;
  onSaved: (type: string, childId?: string) => void;
}

// ─── Mode definitions ─────────────────────────────────────────────────────────

const MODES: { mode: Mode; emoji: string; label: string }[] = [
  { mode: "book",       emoji: "📖", label: "Book"       },
  { mode: "field_trip", emoji: "🗺️",  label: "Field Trip" },
  { mode: "project",    emoji: "🔬", label: "Project"    },
  { mode: "activity",   emoji: "🎵", label: "Activity"   },
  { mode: "photo",      emoji: "📷", label: "Photo"      },
  { mode: "reflection", emoji: "💭", label: "Reflection" },
];

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

// ─── Subject pill selector ────────────────────────────────────────────────────

function SubjectPills({
  subjects, value, onChange,
}: { subjects: Subject[]; value: string; onChange: (name: string) => void }) {
  if (subjects.length === 0) return null;
  return (
    <div>
      <label className="text-xs font-medium text-[#7a6f65] block mb-2">Subject (optional)</label>
      <div className="flex flex-wrap gap-2">
        {subjects.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(value === s.name ? "" : s.name)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              value === s.name
                ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
            }`}
          >
            {s.name}
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
  const [mode,    setMode]    = useState<Mode>(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [isPro,   setIsPro]   = useState<boolean | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("is_pro")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          setIsPro((data as { is_pro?: boolean } | null)?.is_pro ?? false);
        });
    });
  }, []);

  // Book fields
  const [bookTitle,  setBookTitle]  = useState("");
  const [bookChild,  setBookChild]  = useState(children.length === 1 ? children[0].id : "");

  // Field Trip fields
  const [fieldTripTitle, setFieldTripTitle] = useState("");
  const [fieldTripChild, setFieldTripChild] = useState(children.length === 1 ? children[0].id : "");

  // Project fields
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDesc,  setProjectDesc]  = useState("");
  const [projectChild, setProjectChild] = useState(children.length === 1 ? children[0].id : "");

  // Activity fields
  const [activityTitle, setActivityTitle] = useState("");
  const [activityChild, setActivityChild] = useState(children.length === 1 ? children[0].id : "");

  // Photo fields
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoChild, setPhotoChild] = useState(children.length === 1 ? children[0].id : "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Reflection fields
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionPrivate, setReflectionPrivate] = useState(false);

  // Date override for non-reflection modes
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  function selectMode(m: Mode) {
    setMode(m);
    setError("");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not logged in."); setSaving(false); return; }

      if (mode === "book") {
        if (!bookTitle.trim()) { setError("Please enter a book title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_book",
          payload: { title: bookTitle.trim(), date: dateOverride || saveDate, child_id: bookChild || undefined },
        });
        onSaved("book", bookChild || undefined);

      } else if (mode === "field_trip") {
        if (!fieldTripTitle.trim()) { setError("Please enter a title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_field_trip",
          payload: { title: fieldTripTitle.trim(), date: dateOverride || saveDate, child_id: fieldTripChild || undefined },
        });
        onSaved("field_trip", fieldTripChild || undefined);

      } else if (mode === "project") {
        if (!projectTitle.trim()) { setError("Please enter a title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_project",
          payload: {
            title: projectTitle.trim(),
            description: projectDesc.trim() || undefined,
            date: dateOverride || saveDate,
            child_id: projectChild || undefined,
          },
        });
        onSaved("project", projectChild || undefined);

      } else if (mode === "activity") {
        if (!activityTitle.trim()) { setError("Please enter a title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_activity",
          payload: { title: activityTitle.trim(), date: dateOverride || saveDate, child_id: activityChild || undefined },
        });
        onSaved("activity", activityChild || undefined);

      } else if (mode === "photo") {
        if (!photoFile) { setError("Please select a photo."); setSaving(false); return; }

        // Check photo limit for free users
        if (!isPro) {
          const { data: countProfile } = await supabase
            .from("profiles")
            .select("photo_count")
            .eq("id", user.id)
            .single();

          if ((countProfile?.photo_count ?? 0) >= 50) {
            setUploadError(
              "You've reached the 50-photo limit on the free plan. Upgrade to upload unlimited photos."
            );
            setSaving(false);
            return;
          }
        }

        // Upload photo to Supabase Storage
        const ext = photoFile.name.split(".").pop() ?? "jpg";
        const path = `${user.id}/${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error: uploadErr } = await supabase.storage
          .from("memory-photos")
          .upload(path, photoFile, { contentType: photoFile.type, upsert: false });

        if (uploadErr) {
          console.error("[LogTodayModal] Photo upload error:", uploadErr);
          setError(
            uploadErr.message.includes("Bucket not found")
              ? "Storage bucket 'memory-photos' not found. Create it in Supabase."
              : `Upload failed: ${uploadErr.message}`
          );
          setSaving(false);
          return;
        }

        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        const publicUrl = urlData.publicUrl;

        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_photo",
          payload: {
            title: photoTitle.trim() || "Photo",
            photo_url: publicUrl,
            date: dateOverride || saveDate,
            child_id: photoChild || undefined,
          },
        });

        // Increment photo count for free users
        if (!isPro) {
          await supabase.rpc("increment_photo_count", { p_user_id: user.id });
        }

        onSaved("photo", photoChild || undefined);

      } else if (mode === "reflection") {
        if (!reflectionText.trim()) { setError("Please write something first."); setSaving(false); return; }
        await supabase.from("daily_reflections").upsert(
          { user_id: user.id, date: saveDate, reflection: reflectionText.trim(), is_private: reflectionPrivate, updated_at: new Date().toISOString() },
          { onConflict: "user_id,date" }
        );
        onSaved("reflection");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && (
    (mode === "book"        && bookTitle.trim().length > 0) ||
    (mode === "field_trip"  && fieldTripTitle.trim().length > 0) ||
    (mode === "project"     && projectTitle.trim().length > 0) ||
    (mode === "activity"    && activityTitle.trim().length > 0) ||
    (mode === "photo"       && !!photoFile) ||
    (mode === "reflection"  && reflectionText.trim().length > 0)
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center md:inset-0 md:items-center">
        <div
          className="bg-[#fefcf9] rounded-t-3xl md:rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 md:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <div className="flex items-center gap-2">
              {mode !== null && (
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="text-[#7a6f65] hover:text-[#2d2926] text-sm font-medium transition-colors"
                >
                  ← Back
                </button>
              )}
              {mode === null && (
                <h2 className="text-lg font-bold text-[#2d2926]">What happened?</h2>
              )}
              {mode !== null && (
                <h2 className="text-base font-bold text-[#2d2926]">
                  {MODES.find((m) => m.mode === mode)?.emoji}{" "}
                  {MODES.find((m) => m.mode === mode)?.label}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-8">

            {/* ── Step 1: Mode picker ── */}
            {mode === null && (
              <>
                <p className="text-sm text-[#7a6f65] mb-5">Log today or something from last week.</p>
                <div className="grid grid-cols-2 gap-3">
                  {MODES.map(({ mode: m, emoji, label }) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectMode(m)}
                      className="flex flex-col items-start gap-1 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#fafdf8] active:scale-95 rounded-2xl p-4 text-left transition-all min-h-[80px]"
                    >
                      <span className="text-3xl mb-0.5">{emoji}</span>
                      <span className="text-sm font-semibold text-[#2d2926]">{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Step 2: Forms ── */}

            {mode === "book" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Book title *</label>
                  <input
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="e.g. Charlotte&apos;s Web"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <ChildPills children={children} value={bookChild} onChange={setBookChild} />
              </div>
            )}

            {mode === "field_trip" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Where did you go? *</label>
                  <input
                    value={fieldTripTitle}
                    onChange={(e) => setFieldTripTitle(e.target.value)}
                    placeholder="e.g. Natural History Museum, Farm visit"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <ChildPills children={children} value={fieldTripChild} onChange={setFieldTripChild} />
              </div>
            )}

            {mode === "project" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What did you make or explore? *</label>
                  <input
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    placeholder="e.g. Built a model volcano"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Tell us more... (optional)</label>
                  <textarea
                    value={projectDesc}
                    onChange={(e) => setProjectDesc(e.target.value)}
                    placeholder="What did they discover? How did it go?"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                  />
                </div>
                <ChildPills children={children} value={projectChild} onChange={setProjectChild} />
              </div>
            )}

            {mode === "activity" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What activity did you do? *</label>
                  <input
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                    placeholder="e.g. Piano practice, Soccer, Art class"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <ChildPills children={children} value={activityChild} onChange={setActivityChild} />
              </div>
            )}

            {mode === "photo" && (
              <div className="space-y-4 mt-4">
                {/* Photo upload */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Photo *</label>
                  {photoPreview ? (
                    <div className="relative">
                      <img src={photoPreview} alt="Preview" className="w-full h-48 object-cover rounded-xl border border-[#e8e2d9]" />
                      <button
                        type="button"
                        onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center text-sm hover:bg-black/70 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-2 py-8 rounded-xl border-2 border-dashed border-[#e8e2d9] bg-[#f8f7f4] hover:border-[#5c7f63] hover:bg-[#f0f7f0] transition-colors"
                    >
                      <span className="text-2xl">📷</span>
                      <span className="text-sm font-medium text-[#7a6f65]">Tap to choose a photo</span>
                      <span className="text-[11px] text-[#b5aca4]">JPG or PNG</span>
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
                      if (file) {
                        setPhotoFile(file);
                        setPhotoPreview(URL.createObjectURL(file));
                      }
                    }}
                  />
                </div>

                {/* Caption */}
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Caption (optional)</label>
                  <input
                    value={photoTitle}
                    onChange={(e) => setPhotoTitle(e.target.value)}
                    placeholder="e.g. Art project, Science experiment"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>

                <ChildPills children={children} value={photoChild} onChange={setPhotoChild} />

                {uploadError && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <span className="text-sm shrink-0">⚠️</span>
                    <p className="text-xs text-amber-800">{uploadError}
                      <Link href="/dashboard/pricing" className="ml-1 underline font-semibold">Upgrade →</Link>
                    </p>
                  </div>
                )}
              </div>
            )}

            {mode === "reflection" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">How did today go? What went well? *</label>
                  <textarea
                    value={reflectionText}
                    onChange={(e) => setReflectionText(e.target.value)}
                    placeholder="Your thoughts are safe here..."
                    rows={5}
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setReflectionPrivate(v => !v)}
                  className="flex items-center gap-2 text-xs text-[#7a6f65]"
                >
                  <div className={`w-8 h-[18px] rounded-full transition-colors relative ${reflectionPrivate ? "bg-[#5c7f63]" : "bg-[#e8e2d9]"}`}>
                    <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${reflectionPrivate ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
                  </div>
                  <span>{reflectionPrivate ? "🔒 Private — only you can see this" : "👀 Visible in Kid Mode"}</span>
                </button>
              </div>
            )}

            {/* Date picker — for non-reflection modes */}
            {mode !== null && mode !== "reflection" && (
              <div className="mt-4">
                <label className="text-xs font-medium text-[#7a6f65] block mb-2">When?</label>
                <div className="flex gap-2">
                  {[
                    { label: "Today", value: new Date().toISOString().split("T")[0] },
                    { label: "Yesterday", value: new Date(Date.now() - 86400000).toISOString().split("T")[0] },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setDateOverride(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        (dateOverride || new Date().toISOString().split("T")[0]) === opt.value
                          ? "bg-[#eef5ee] border-[#5c7f63] text-[#3d5c42] font-semibold"
                          : "bg-white border-[#e8e2d9] text-[#7a6f65]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <input
                    type="date"
                    value={dateOverride || new Date().toISOString().split("T")[0]}
                    onChange={e => setDateOverride(e.target.value)}
                    className="px-2 py-1.5 rounded-full text-xs border border-[#e8e2d9] text-[#7a6f65] bg-white"
                  />
                </div>
              </div>
            )}

            {/* Save button */}
            {mode !== null && (
              <>
                {error && (
                  <p className="mt-3 text-xs text-red-500 text-center">{error}</p>
                )}
                {uploadError && (
                  <div className="mt-3 rounded-xl border border-[#e8e2d9] bg-[#fefcf9] p-4 text-center">
                    <p className="mb-2 text-sm text-[#2d2926]">{uploadError}</p>
                    <Link
                      href="/dashboard/pricing"
                      className="text-sm font-semibold text-[#5c7f63] underline underline-offset-2"
                    >
                      Upgrade to Pro
                    </Link>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="mt-5 w-full py-3 rounded-xl bg-[#3d5c42] hover:bg-[#2d4a32] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
                >
                  {saving ? "Saving…" : "Save 🌿"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
