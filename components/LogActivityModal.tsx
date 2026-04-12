"use client";

import { useState, useRef } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Child = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };

interface LogActivityModalProps {
  children: Child[];
  subjects: Subject[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
  initialChildId?: string;
}

type Mode = "lesson" | "book" | "project" | "photo" | "reflection" | "break" | null;

const OPTIONS = [
  { mode: "lesson"     as Mode, emoji: "✅", title: "Log a lesson",      sub: "Free-form, marks complete" },
  { mode: "book"       as Mode, emoji: "📖", title: "Log a book",        sub: "Saves to Memories" },
  { mode: "project"    as Mode, emoji: "🔬", title: "Log a project",     sub: "Saves to Memories" },
  { mode: "photo"      as Mode, emoji: "📷", title: "Add a photo",       sub: "Photo memory" },
  { mode: "reflection" as Mode, emoji: "💭", title: "Write a reflection", sub: "Daily notes" },
  { mode: "break"      as Mode, emoji: "🌴", title: "Add a break",       sub: "Day off / holiday" },
];

export default function LogActivityModal({
  children,
  subjects,
  today,
  onClose,
  onSaved,
  initialChildId,
}: LogActivityModalProps) {
  const defaultChild = initialChildId ?? (children.length === 1 ? children[0].id : "");

  const [mode,           setMode]           = useState<Mode>(null);
  const [title,          setTitle]          = useState("");
  const [childId,        setChildId]        = useState(defaultChild);
  const [notes,          setNotes]          = useState("");
  const [subjectName,    setSubjectName]    = useState("");
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState("");
  const [reflectionText, setReflectionText] = useState("");
  const [file,           setFile]           = useState<File | null>(null);
  const [previewUrl,     setPreviewUrl]     = useState<string | null>(null);
  const [breakName,      setBreakName]      = useState("");
  const [breakStart,     setBreakStart]     = useState(today);
  const [breakEnd,       setBreakEnd]       = useState(today);

  const fileRef = useRef<HTMLInputElement>(null);

  function selectMode(m: Mode) {
    setTitle(""); setChildId(defaultChild); setNotes(""); setSubjectName(""); setError("");
    setReflectionText(""); setFile(null); setPreviewUrl(null);
    setBreakName(""); setBreakStart(today); setBreakEnd(today);
    setMode(m);
  }

  const canSave =
    mode === "reflection" ? reflectionText.trim().length > 0
    : mode === "break"    ? breakName.trim().length > 0
    : mode === "photo"    ? !!(file || title.trim())
    : title.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      if (mode === "lesson") {
        let subjectId: string | null = null;
        if (subjectName.trim()) {
          const existing = subjects.find(
            (s) => s.name.toLowerCase() === subjectName.trim().toLowerCase()
          );
          if (existing) {
            subjectId = existing.id;
          } else {
            const { data: ns } = await supabase
              .from("subjects")
              .insert({ user_id: user.id, name: subjectName.trim() })
              .select("id")
              .single();
            if (ns) subjectId = ns.id;
          }
        }
        const { error: err } = await supabase.from("lessons").insert({
          user_id:    user.id,
          child_id:   childId || null,
          subject_id: subjectId,
          title:      title.trim(),
          completed:  true,
          date:       today,
        });
        if (err) throw err;

      } else if (mode === "book") {
        const { error: err } = await supabase.from("app_events").insert({
          user_id: user.id,
          type:    "memory_book",
          payload: {
            title:       title.trim(),
            child_id:    childId || undefined,
            date:        today,
            description: notes.trim() || undefined,
          },
        });
        if (err) throw err;

      } else if (mode === "project") {
        const { error: err } = await supabase.from("app_events").insert({
          user_id: user.id,
          type:    "memory_project",
          payload: {
            title:       title.trim(),
            child_id:    childId || undefined,
            date:        today,
            description: notes.trim() || undefined,
          },
        });
        if (err) throw err;

      } else if (mode === "photo") {
        let photoUrl: string | undefined;
        if (file) {
          const ext  = file.name.split(".").pop() ?? "jpg";
          const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from("memories")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (uploadErr) throw uploadErr;
          const { data: urlData } = supabase.storage.from("memories").getPublicUrl(path);
          photoUrl = urlData.publicUrl;
        }
        const { error: err } = await supabase.from("app_events").insert({
          user_id: user.id,
          type:    "memory_photo",
          payload: {
            title:       title.trim() || "Photo",
            child_id:    childId || undefined,
            date:        today,
            photo_url:   photoUrl,
            description: notes.trim() || undefined,
          },
        });
        if (err) throw err;

      } else if (mode === "reflection") {
        const { error: err } = await supabase.from("daily_reflections").upsert(
          {
            user_id:    user.id,
            date:       today,
            reflection: reflectionText.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,date" }
        );
        if (err) throw err;

      } else if (mode === "break") {
        const { error: err } = await supabase.from("vacation_blocks").insert({
          user_id:    user.id,
          name:       breakName.trim(),
          start_date: breakStart,
          end_date:   breakEnd,
        });
        if (err) throw err;
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  const saveLabel =
    saving              ? "Saving…"
    : mode === "reflection" ? "Save Reflection 💭"
    : mode === "break"      ? "Add Break 🌴"
    : "Save 🍃";

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[#fefcf9] rounded-t-3xl shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3 mb-1" />

        {mode === null ? (
          /* ── Option picker ──────────────────────── */
          <div className="px-5 pt-3 pb-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-[#2d2926]">What happened today? 🌿</h2>
                <p className="text-sm text-[#7a6f65]">Log it here — takes just a second.</p>
              </div>
              <button
                onClick={onClose}
                className="text-[#b5aca4] hover:text-[#7a6f65] p-1 transition-colors mt-0.5"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {OPTIONS.map(({ mode: m, emoji, title: t, sub }) => (
                <button
                  key={m}
                  onClick={() => selectMode(m)}
                  className="flex flex-col items-start gap-1 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#fafdf8] active:scale-95 rounded-2xl p-4 text-left transition-all"
                >
                  <span className="text-2xl mb-0.5">{emoji}</span>
                  <span className="text-sm font-semibold text-[#2d2926] leading-tight">{t}</span>
                  <span className="text-[10px] text-[#7a6f65]">{sub}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Sub-form ───────────────────────────── */
          <div className="px-5 pt-4 pb-8">
            <div className="flex items-center gap-3 mb-5">
              <button
                onClick={() => setMode(null)}
                className="text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors"
              >
                ← Back
              </button>
              <h2 className="text-base font-bold text-[#2d2926] flex-1">
                {OPTIONS.find((o) => o.mode === mode)?.emoji}{" "}
                {OPTIONS.find((o) => o.mode === mode)?.title}
              </h2>
              <button
                onClick={onClose}
                className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">

              {/* ── Reflection ── */}
              {mode === "reflection" && (
                <textarea
                  value={reflectionText}
                  onChange={(e) => setReflectionText(e.target.value)}
                  placeholder="How did today's learning go? What went well? What would you do differently?"
                  rows={5}
                  autoFocus
                  className="w-full px-3 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 resize-none"
                />
              )}

              {/* ── Break ── */}
              {mode === "break" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                      Break name *
                    </label>
                    <input
                      value={breakName}
                      onChange={(e) => setBreakName(e.target.value)}
                      placeholder="e.g. Spring Break, Sick Day"
                      autoFocus
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Start</label>
                      <input
                        type="date"
                        value={breakStart}
                        onChange={(e) => setBreakStart(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">End</label>
                      <input
                        type="date"
                        value={breakEnd}
                        min={breakStart}
                        onChange={(e) => setBreakEnd(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ── Photo ── */}
              {mode === "photo" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Photo</label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-[#e8e2d9] rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-[#5c7f63] transition-colors"
                    >
                      {previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewUrl}
                          alt="Preview"
                          className="max-h-32 rounded-lg object-contain"
                        />
                      ) : (
                        <>
                          <span className="text-3xl mb-2">📷</span>
                          <span className="text-sm text-[#7a6f65]">Tap to choose a photo</span>
                        </>
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setFile(f); setPreviewUrl(URL.createObjectURL(f)); }
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                      Caption (optional)
                    </label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="What's this photo of?"
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    />
                  </div>
                </>
              )}

              {/* ── Lesson / Book / Project title ── */}
              {(mode === "lesson" || mode === "book" || mode === "project") && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                    {mode === "lesson"  ? "What did you cover? *"
                     : mode === "book" ? "Book title *"
                                       : "What did you do? *"}
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                    placeholder={
                      mode === "lesson"  ? "e.g. Chapter 5 — Fractions"
                      : mode === "book" ? "e.g. Charlotte's Web"
                                         : "e.g. Volcano experiment"
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
              )}

              {/* ── Subject (lesson, project) ── */}
              {(mode === "lesson" || mode === "project") && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                    Subject (optional)
                  </label>
                  <input
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    list="log-modal-subjects"
                    placeholder="e.g. Math, Science, Art"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                  <datalist id="log-modal-subjects">
                    {subjects.map((s) => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>
              )}

              {/* ── Notes (book, project) ── */}
              {(mode === "book" || mode === "project") && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                    Notes (optional)
                  </label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      mode === "book" ? "What did they think of it?"
                                      : "Any notes about this project?"
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
              )}

              {/* ── Child picker (all except reflection, break) ── */}
              {children.length > 0 && mode !== "reflection" && mode !== "break" && (
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Which child?</label>
                  <select
                    value={childId}
                    onChange={(e) => setChildId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  >
                    <option value="">All / unassigned</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500 font-medium">{error}</p>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="mt-5 w-full py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saveLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
