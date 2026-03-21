"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type Mode = null | "lesson" | "book" | "project" | "photo" | "reflection" | "break";

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
  { mode: "lesson",     emoji: "✅", label: "Lesson"     },
  { mode: "book",       emoji: "📖", label: "Book"       },
  { mode: "project",    emoji: "🔬", label: "Project"    },
  { mode: "photo",      emoji: "📷", label: "Photo"      },
  { mode: "reflection", emoji: "💭", label: "Reflection" },
  { mode: "break",      emoji: "🌴", label: "Break"      },
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

  // Lesson fields
  const [lessonTitle,   setLessonTitle]   = useState("");
  const [lessonChild,   setLessonChild]   = useState(children.length === 1 ? children[0].id : "");
  const [lessonSubject, setLessonSubject] = useState("");

  // Book fields
  const [bookTitle,  setBookTitle]  = useState("");
  const [bookChild,  setBookChild]  = useState(children.length === 1 ? children[0].id : "");

  // Project fields
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDesc,  setProjectDesc]  = useState("");
  const [projectChild, setProjectChild] = useState(children.length === 1 ? children[0].id : "");

  // Photo fields
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoChild, setPhotoChild] = useState(children.length === 1 ? children[0].id : "");

  // Reflection fields
  const [reflectionText, setReflectionText] = useState("");

  // Break fields
  const [breakStart, setBreakStart] = useState(today);
  const [breakEnd,   setBreakEnd]   = useState(today);
  const [breakLabel, setBreakLabel] = useState("");

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

      if (mode === "lesson") {
        if (!lessonTitle.trim()) { setError("Please enter a lesson title."); setSaving(false); return; }
        let subjectId: string | null = null;
        if (lessonSubject) {
          const sub = subjects.find((s) => s.name === lessonSubject);
          subjectId = sub?.id ?? null;
        }
        await supabase.from("lessons").insert({
          user_id: user.id,
          child_id: lessonChild || null,
          subject_id: subjectId,
          title: lessonTitle.trim(),
          completed: true,
          date: saveDate,
        });
        onSaved("lesson", lessonChild || undefined);

      } else if (mode === "book") {
        if (!bookTitle.trim()) { setError("Please enter a book title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_book",
          payload: { title: bookTitle.trim(), date: saveDate, child_id: bookChild || undefined },
        });
        onSaved("book", bookChild || undefined);

      } else if (mode === "project") {
        if (!projectTitle.trim()) { setError("Please enter a title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_project",
          payload: {
            title: projectTitle.trim(),
            description: projectDesc.trim() || undefined,
            date: saveDate,
            child_id: projectChild || undefined,
          },
        });
        onSaved("project", projectChild || undefined);

      } else if (mode === "photo") {
        if (!photoTitle.trim()) { setError("Please enter a title."); setSaving(false); return; }
        await supabase.from("app_events").insert({
          user_id: user.id,
          type: "memory_photo",
          payload: { title: photoTitle.trim(), date: saveDate, child_id: photoChild || undefined },
        });
        onSaved("photo", photoChild || undefined);

      } else if (mode === "reflection") {
        if (!reflectionText.trim()) { setError("Please write something first."); setSaving(false); return; }
        await supabase.from("daily_reflections").upsert(
          { user_id: user.id, date: saveDate, reflection: reflectionText.trim(), updated_at: new Date().toISOString() },
          { onConflict: "user_id,date" }
        );
        onSaved("reflection");

      } else if (mode === "break") {
        if (!breakStart || !breakEnd || breakEnd < breakStart) {
          setError("Please set valid start and end dates.");
          setSaving(false);
          return;
        }
        await supabase.from("vacation_blocks").insert({
          user_id: user.id,
          name: breakLabel.trim() || "Break",
          start_date: breakStart,
          end_date: breakEnd,
        });
        onSaved("break");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && (
    (mode === "lesson"     && lessonTitle.trim().length > 0) ||
    (mode === "book"       && bookTitle.trim().length > 0) ||
    (mode === "project"    && projectTitle.trim().length > 0) ||
    (mode === "photo"      && photoTitle.trim().length > 0) ||
    (mode === "reflection" && reflectionText.trim().length > 0) ||
    (mode === "break"      && !!breakStart && !!breakEnd && breakEnd >= breakStart)
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center">
        <div
          className="bg-[#fefcf9] rounded-t-3xl shadow-xl w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 bg-[#e8e2d9] rounded-full mx-auto mt-3" />

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
                <h2 className="text-lg font-bold text-[#2d2926]">What happened today? 🌿</h2>
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
                <p className="text-sm text-[#7a6f65] mb-5">Log something great. It only takes a second.</p>
                <div className="grid grid-cols-2 gap-3">
                  {MODES.map(({ mode: m, emoji, label }) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectMode(m)}
                      className="flex flex-col items-start gap-1 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] hover:bg-[#fafdf8] active:scale-95 rounded-2xl p-4 text-left transition-all"
                    >
                      <span className="text-3xl mb-0.5">{emoji}</span>
                      <span className="text-sm font-semibold text-[#2d2926]">{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Step 2: Forms ── */}

            {mode === "lesson" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What did you learn today? *</label>
                  <input
                    value={lessonTitle}
                    onChange={(e) => setLessonTitle(e.target.value)}
                    placeholder="e.g. Chapter 4 reading, Long division practice"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <ChildPills children={children} value={lessonChild} onChange={setLessonChild} />
                <SubjectPills subjects={subjects} value={lessonSubject} onChange={setLessonSubject} />
              </div>
            )}

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

            {mode === "photo" && (
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">What&apos;s this a photo of? *</label>
                  <input
                    value={photoTitle}
                    onChange={(e) => setPhotoTitle(e.target.value)}
                    placeholder="e.g. Art project, Science experiment"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>
                <ChildPills children={children} value={photoChild} onChange={setPhotoChild} />
                <p className="text-xs text-[#b5aca4]">📷 This logs the memory title — you can add the actual photo in Memories.</p>
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
              </div>
            )}

            {mode === "break" && (
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Start date</label>
                    <input
                      type="date"
                      value={breakStart}
                      onChange={(e) => setBreakStart(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">End date</label>
                    <input
                      type="date"
                      value={breakEnd}
                      onChange={(e) => setBreakEnd(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Label (optional)</label>
                  <input
                    value={breakLabel}
                    onChange={(e) => setBreakLabel(e.target.value)}
                    placeholder="Spring Break, Sick Day, Family Trip..."
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
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
