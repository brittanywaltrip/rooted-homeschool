"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  const todayStr = new Date().toISOString().split("T")[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const effectiveDate = dateOverride || saveDate;

  async function handleSave() {
    setSaving(true);
    setError("");
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
        onSaved("reflection");
        return;
      }

      // Photo upload if attached
      let photoUrl: string | undefined;
      if (photoFile) {
        if (!isPro) {
          const { data: countProfile } = await supabase.from("profiles").select("photo_count").eq("id", user.id).single();
          if ((countProfile?.photo_count ?? 0) >= 50) {
            setUploadError("You've reached the 50-photo limit on the free plan. Upgrade to upload unlimited photos.");
            setSaving(false);
            return;
          }
        }
        const path = `${user.id}/${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error: uploadErr } = await supabase.storage.from("memory-photos").upload(path, photoFile, { contentType: photoFile.type, upsert: false });
        if (uploadErr) {
          setError(uploadErr.message.includes("Bucket not found")
            ? "Storage bucket 'memory-photos' not found. Create it in Supabase."
            : `Upload failed: ${uploadErr.message}`);
          setSaving(false);
          return;
        }
        const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
        if (!isPro) {
          await supabase.rpc("increment_photo_count", { p_user_id: user.id });
        }
      }

      // Determine event type
      const eventType = photoFile ? "memory_photo" : `memory_${category}`;

      if (!title.trim() && !photoFile) {
        setError("Please describe what you want to remember.");
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        title: title.trim() || "Photo",
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

      onSaved(category, childId || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && (title.trim().length > 0 || !!photoFile || (isReflection && title.trim().length > 0));

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center md:inset-0 md:items-center">
        <div
          className="bg-[#fefcf9] rounded-t-3xl md:rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 md:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <h2 className="text-lg font-bold text-[#2d2926]">Log a Memory</h2>
            <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors">
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
                        ? "bg-[#eef5ee] border-[#5c7f63] text-[#3d5c42] font-semibold"
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
              {"\uD83D\uDCAD"} {isReflection ? "Writing a reflection — this saves to your journal" : "Or write a private reflection instead"}
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

            {/* Save */}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="w-full py-3 rounded-xl bg-[#3d5c42] hover:bg-[#2d4a32] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Saving\u2026" : "Save \uD83C\uDF3F"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
