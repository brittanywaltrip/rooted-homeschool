"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { compressImage } from "@/lib/compress-image";
import Link from "next/link";
import PageHero from "@/app/components/PageHero";

function safeParseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const iso = d.slice(0, 10);
  const dt = new Date(iso + "T12:00:00");
  return isNaN(dt.getTime()) ? null : dt;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type MemoryRow = {
  id: string;
  child_id: string | null;
  date: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
};

type YearbookContentRow = {
  content_type: string;
  child_id: string | null;
  question_key: string | null;
  content: string;
  updated_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVIEW_QUESTIONS = [
  { key: "q_loved_learning", label: "What did you love learning about this year?" },
  { key: "q_favorite_book", label: "What book did you love most?" },
  { key: "q_got_easier", label: "What got easier this year?" },
  { key: "q_learn_next_year", label: "What do you want to learn next year?" },
  { key: "q_favorite_adventure", label: "What was your favorite adventure?" },
  { key: "q_surprised_you", label: "What surprised you this year?" },
] as const;

// ─── Autosave Hook ────────────────────────────────────────────────────────────

function useAutosave(
  value: string,
  saveFn: (val: string) => Promise<void>,
  delay = 800
): "idle" | "saving" | "saved" | "error" {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const prevRef = useRef(value);
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (value === prevRef.current) return;
    prevRef.current = value;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    setStatus("saving");
    timerRef.current = setTimeout(async () => {
      try {
        await saveFn(value);
        setStatus("saved");
        savedTimerRef.current = setTimeout(() => setStatus("idle"), 3000);
      } catch {
        setStatus("error");
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [value, saveFn, delay]);

  return status;
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  return (
    <span className={`text-[10px] mt-1 block ${
      status === "saving" ? "text-[#9a8f85]"
        : status === "saved" ? "text-[#5c7f63]"
        : "text-red-500"
    }`}>
      {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save failed"}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function YearbookEditPage() {
  const { effectiveUserId, isPartner } = usePartner();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [yearbookKey, setYearbookKey] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [updatedMap, setUpdatedMap] = useState<Record<string, string>>({});
  const [bookmarkedMemories, setBookmarkedMemories] = useState<MemoryRow[]>([]);
  const [quoteMemories, setQuoteMemories] = useState<MemoryRow[]>([]);

  // Cover / meta state
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverSaved, setCoverSaved] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [familyNameSaved, setFamilyNameSaved] = useState(false);
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolYearSaved, setSchoolYearSaved] = useState(false);

  // Letter state
  const [letter, setLetter] = useState("");
  const [favMemoryId, setFavMemoryId] = useState("");
  const [favCaption, setFavCaption] = useState("");
  const [favQuote, setFavQuote] = useState("");
  const [quoteMode, setQuoteMode] = useState<"pick" | "type">("pick");
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);
  const [showQuotePicker, setShowQuotePicker] = useState(false);

  // Per-child state
  const [childAnswers, setChildAnswers] = useState<Record<string, Record<string, string>>>({});
  const [childNotes, setChildNotes] = useState<Record<string, string>>({});
  const [activeField, setActiveField] = useState<string | null>(null);
  const [saveAllStatus, setSaveAllStatus] = useState<"idle" | "saving" | "saved">("idle");

  // ── Content key helper ──────────────────────────────────────────────────────

  function ck(contentType: string, childId?: string | null, questionKey?: string | null) {
    return `${contentType}:${childId ?? "null"}:${questionKey ?? "null"}`;
  }

  // ── Save function ───────────────────────────────────────────────────────────

  const saveContent = useCallback(async (
    contentType: string,
    content: string,
    childId?: string,
    questionKey?: string
  ) => {
    if (isReadOnly || !effectiveUserId || !yearbookKey) return;
    await supabase.from("yearbook_content").upsert({
      user_id: effectiveUserId,
      yearbook_key: yearbookKey,
      content_type: contentType,
      child_id: childId ?? null,
      question_key: questionKey ?? null,
      content,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,yearbook_key,content_type,child_id,question_key" });
  }, [effectiveUserId, yearbookKey, isReadOnly]);

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("yearbook_opened_at, yearbook_closed_at, display_name")
        .eq("id", effectiveUserId)
        .single();

      let openedAt = profile?.yearbook_opened_at;
      if (!openedAt) {
        const now = new Date().toISOString();
        await supabase.from("profiles").update({ yearbook_opened_at: now }).eq("id", effectiveUserId);
        openedAt = now;
      }

      const closedAt = profile?.yearbook_closed_at;
      setIsReadOnly(!!closedAt);

      const m = new Date(openedAt).getMonth();
      const y = new Date(openedAt).getFullYear();
      const startYear = m >= 7 ? y : y - 1;
      const key = `${startYear}-${String(startYear + 1).slice(2)}`;
      setYearbookKey(key);

      const [{ data: kids }, { data: ybRows }, { data: quotes }, { data: bookmarked }] = await Promise.all([
        supabase.from("children").select("id, name, color")
          .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("yearbook_content").select("content_type, child_id, question_key, content, updated_at")
          .eq("user_id", effectiveUserId).eq("yearbook_key", key),
        supabase.from("memories").select("id, child_id, date, type, title, caption, photo_url")
          .eq("user_id", effectiveUserId).eq("type", "quote").order("date", { ascending: false }),
        supabase.from("memories").select("id, child_id, date, type, title, caption, photo_url")
          .eq("user_id", effectiveUserId).eq("include_in_book", true).order("date", { ascending: false }),
      ]);

      const childList = (kids ?? []) as Child[];
      setChildren(childList);
      setQuoteMemories((quotes ?? []) as MemoryRow[]);
      setBookmarkedMemories((bookmarked ?? []) as MemoryRow[]);

      // Build content map
      const rows = (ybRows ?? []) as YearbookContentRow[];
      const cMap: Record<string, string> = {};
      const uMap: Record<string, string> = {};
      for (const r of rows) {
        const k = ck(r.content_type, r.child_id, r.question_key);
        cMap[k] = r.content;
        uMap[k] = r.updated_at;
      }
      setContentMap(cMap);
      setUpdatedMap(uMap);

      // Hydrate state
      setCoverPhotoUrl(cMap[ck("cover_photo")] ?? "");
      setFamilyName(cMap[ck("family_name")] ?? "");
      setSchoolYear(cMap[ck("school_year")] ?? "");
      setLetter(cMap[ck("letter_from_home")] ?? "");
      setFavMemoryId(cMap[ck("letter_favorite_memory_id")] ?? "");
      setFavCaption(cMap[ck("letter_favorite_caption")] ?? "");
      const fq = cMap[ck("letter_favorite_quote")] ?? "";
      setFavQuote(fq);
      setQuoteMode(fq.startsWith("text:") ? "type" : "pick");

      // Per-child
      const answers: Record<string, Record<string, string>> = {};
      const notes: Record<string, string> = {};
      for (const child of childList) {
        answers[child.id] = {};
        for (const q of INTERVIEW_QUESTIONS) {
          answers[child.id][q.key] = cMap[ck("child_interview", child.id, q.key)] ?? "";
        }
        notes[child.id] = cMap[ck("child_future_note", child.id)] ?? "";
      }
      setChildAnswers(answers);
      setChildNotes(notes);

      setLoading(false);
    })();
  }, [effectiveUserId]);

  // ── Progress ────────────────────────────────────────────────────────────────

  const totalCount = 6 + children.length * 7;
  const filledCount = [
    coverPhotoUrl ? 1 : 0,
    familyName.trim() ? 1 : 0,
    schoolYear.trim() ? 1 : 0,
    letter.trim() ? 1 : 0,
    favMemoryId ? 1 : 0,
    favQuote ? 1 : 0,
    ...children.flatMap((c) => [
      ...INTERVIEW_QUESTIONS.map((q) => (childAnswers[c.id]?.[q.key]?.trim() ? 1 : 0) as number),
      childNotes[c.id]?.trim() ? 1 : 0,
    ]),
  ].reduce((a, b) => a + b, 0);
  const progressPct = totalCount > 0 ? Math.min(100, Math.round((filledCount / totalCount) * 100)) : 0;

  const yearLabel = yearbookKey
    ? `${yearbookKey.split("-")[0]}\u201320${yearbookKey.split("-")[1]}`
    : "";

  // ── Autosave wrappers ──────────────────────────────────────────────────────

  const letterStatus = useAutosave(letter, useCallback((v: string) => saveContent("letter_from_home", v), [saveContent]));
  const captionStatus = useAutosave(favCaption, useCallback((v: string) => saveContent("letter_favorite_caption", v), [saveContent]));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">✏️</span>
          <p className="text-sm text-[#7a6f65]">Loading editor...</p>
        </div>
      </div>
    );
  }

  // ── Favorite memory lookup ──────────────────────────────────────────────────

  const favMemory = favMemoryId ? bookmarkedMemories.find((m) => m.id === favMemoryId) : null;
  const favQuoteMemory = favQuote && !favQuote.startsWith("text:") ? quoteMemories.find((m) => m.id === favQuote) : null;

  return (
    <>
      <PageHero
        overline={`${yearLabel} School Year`}
        title="Edit your book ✏️"
        subtitle={isReadOnly ? "This yearbook is closed — read only" : `${filledCount} of ${totalCount} sections complete`}
      />

      <div className="max-w-3xl mx-auto px-4 pt-5 pb-20 space-y-4">
        <Link href="/dashboard/memories/yearbook" className="inline-flex items-center gap-1.5 text-sm text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors">
          ← Back to yearbook
        </Link>

        {isReadOnly && (
          <div className="bg-[#faeeda] text-[#854F0B] rounded-xl p-4 text-sm">
            This yearbook is closed. You can still read it but not edit it.
          </div>
        )}

        {/* ── Progress bar ────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-[#9a8f85]">Pages filling up</span>
            <span className="text-[11px] text-[#9a8f85]">{filledCount} of {totalCount} sections complete</span>
          </div>
          <div className="h-[5px] bg-[#e8e3dc] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--g-deep)] rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* ── Cover photo ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <p className="text-[13px] font-semibold text-[#2d2926]">Cover photo</p>
          <p className="text-[11px] text-[#9a8f85] italic mt-0.5 mb-3">
            Upload a family photo for the front of your yearbook.
          </p>
          {coverPhotoUrl ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverPhotoUrl} alt="Cover" className="h-[100px] w-auto rounded-lg object-cover border border-[#e8e3dc]" />
              {!isReadOnly && (
                <label className="text-[11px] text-[#5c7f63] font-medium cursor-pointer">
                  Change
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !effectiveUserId) return;
                      setCoverUploading(true);
                      setCoverSaved(false);
                      try {
                        const compressed = await compressImage(file);
                        const path = `${effectiveUserId}/cover.jpg`;
                        const { error: upErr } = await supabase.storage.from("yearbook-covers").upload(path, compressed, { contentType: "image/jpeg", upsert: true });
                        if (upErr) throw upErr;
                        const { data: urlData } = supabase.storage.from("yearbook-covers").getPublicUrl(path);
                        const url = urlData.publicUrl + "?t=" + Date.now();
                        setCoverPhotoUrl(url);
                        await saveContent("cover_photo", url);
                        setCoverSaved(true);
                        setTimeout(() => setCoverSaved(false), 3000);
                      } catch (err) {
                        console.error("Cover upload error:", err);
                      } finally {
                        setCoverUploading(false);
                      }
                    }}
                  />
                </label>
              )}
            </div>
          ) : (
            !isReadOnly && (
              <label className="flex items-center justify-center w-full py-6 rounded-lg border-2 border-dashed border-[#d4cfc8] text-[12px] text-[#9a8f85] hover:border-[#5c7f63] transition-colors cursor-pointer">
                {coverUploading ? "Uploading…" : "Upload cover photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={coverUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !effectiveUserId) return;
                    setCoverUploading(true);
                    setCoverSaved(false);
                    try {
                      const compressed = await compressImage(file);
                      const path = `${effectiveUserId}/cover.jpg`;
                      const { error: upErr } = await supabase.storage.from("yearbook-covers").upload(path, compressed, { contentType: "image/jpeg", upsert: true });
                      if (upErr) throw upErr;
                      const { data: urlData } = supabase.storage.from("yearbook-covers").getPublicUrl(path);
                      const url = urlData.publicUrl + "?t=" + Date.now();
                      setCoverPhotoUrl(url);
                      await saveContent("cover_photo", url);
                      setCoverSaved(true);
                      setTimeout(() => setCoverSaved(false), 3000);
                    } catch (err) {
                      console.error("Cover upload error:", err);
                    } finally {
                      setCoverUploading(false);
                    }
                  }}
                />
              </label>
            )
          )}
          {coverSaved && <span className="text-[10px] text-[#5c7f63] mt-1 block">Saved ✓</span>}
        </div>

        {/* ── Family name ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <label className="text-[13px] font-semibold text-[#2d2926] block mb-2">Family name</label>
          <input
            value={familyName}
            onChange={(e) => { setFamilyName(e.target.value); setFamilyNameSaved(false); }}
            onBlur={async () => {
              if (isReadOnly || !effectiveUserId || !yearbookKey) return;
              await saveContent("family_name", familyName);
              setFamilyNameSaved(true);
              setTimeout(() => setFamilyNameSaved(false), 3000);
            }}
            disabled={isReadOnly}
            placeholder="The Waltrip Family"
            className="w-full px-3 py-2 text-[14px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] disabled:opacity-60"
          />
          {familyNameSaved && <span className="text-[10px] text-[#5c7f63] mt-1 block">Saved ✓</span>}
        </div>

        {/* ── School year ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <label className="text-[13px] font-semibold text-[#2d2926] block mb-2">School year</label>
          <input
            value={schoolYear}
            onChange={(e) => { setSchoolYear(e.target.value); setSchoolYearSaved(false); }}
            onBlur={async () => {
              if (isReadOnly || !effectiveUserId || !yearbookKey) return;
              await saveContent("school_year", schoolYear);
              setSchoolYearSaved(true);
              setTimeout(() => setSchoolYearSaved(false), 3000);
            }}
            disabled={isReadOnly}
            placeholder="2025–2026"
            className="w-full px-3 py-2 text-[14px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] disabled:opacity-60"
          />
          {schoolYearSaved && <span className="text-[10px] text-[#5c7f63] mt-1 block">Saved ✓</span>}
        </div>

        {/* ── Letter from home ────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <p className="text-[13px] font-semibold text-[#2d2926]">Letter from home</p>
          <p className="text-[11px] text-[#9a8f85] italic mt-0.5 mb-3">
            Write a letter to your family about this year — what you noticed,
            what you&apos;re proud of, what you want to remember.
          </p>
          <textarea
            value={letter}
            onChange={(e) => setLetter(e.target.value)}
            disabled={isReadOnly}
            placeholder="Dear family…"
            className="w-full min-h-[140px] text-[14px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] resize-y disabled:opacity-60"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <SaveStatus status={letterStatus} />
        </div>

        {/* ── Favorite moment picker ──────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <p className="text-[13px] font-semibold text-[#2d2926] mb-2">Favorite moment this year</p>
          {favMemory ? (
            <div className="flex items-center gap-3 bg-[#fefcf9] rounded-lg p-3 border border-[#e8e3dc]">
              {favMemory.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={favMemory.photo_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[#2d2926] truncate">{favMemory.title ?? "Memory"}</p>
                <p className="text-[10px] text-[#9a8f85]">{safeParseDateStr(favMemory.date)?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) ?? "Unknown date"}</p>
              </div>
              {!isReadOnly && (
                <button onClick={() => setShowMemoryPicker(true)} className="text-[11px] text-[#5c7f63] font-medium shrink-0">
                  Change
                </button>
              )}
            </div>
          ) : (
            !isReadOnly && (
              <button
                onClick={() => setShowMemoryPicker(true)}
                className="w-full py-4 rounded-lg border-2 border-dashed border-[#d4cfc8] text-[12px] text-[#9a8f85] hover:border-[#5c7f63] transition-colors"
              >
                Choose a favorite moment
              </button>
            )
          )}

          {/* Caption for favorite moment */}
          {favMemoryId && (
            <div className="mt-3">
              <label className="text-[11px] text-[#9a8f85]">Caption for this moment</label>
              <input
                value={favCaption}
                onChange={(e) => setFavCaption(e.target.value)}
                disabled={isReadOnly}
                placeholder="Why this moment matters…"
                className="w-full mt-1 px-3 py-2 text-[13px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] disabled:opacity-60"
                style={{ fontFamily: "Georgia, serif" }}
              />
              <SaveStatus status={captionStatus} />
            </div>
          )}
        </div>

        {/* ── Memory picker modal ─────────────────────────────── */}
        {showMemoryPicker && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowMemoryPicker(false)}>
            <div className="bg-[#fefcf9] rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-[#2d2926]">Choose a memory</p>
                <button onClick={() => setShowMemoryPicker(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg">×</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {bookmarkedMemories.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      setFavMemoryId(m.id);
                      setShowMemoryPicker(false);
                      await saveContent("letter_favorite_memory_id", m.id);
                    }}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                      m.id === favMemoryId ? "border-[var(--g-deep)]" : "border-transparent"
                    }`}
                  >
                    {m.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[#eaf3de] flex flex-col items-center justify-center p-1">
                        <span className="text-2xl">{m.type === "win" ? "🏆" : m.type === "book" ? "📖" : "🗒️"}</span>
                        <p className="text-[8px] text-[var(--g-deep)] text-center line-clamp-2 mt-0.5">{m.title}</p>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              {bookmarkedMemories.length === 0 && (
                <p className="text-center text-[12px] text-[#9a8f85] py-8">
                  No bookmarked memories yet. Tap 🔖 on a memory to bookmark it.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Favorite quote picker ───────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-5">
          <p className="text-[13px] font-semibold text-[#2d2926] mb-2">Favorite quote this year</p>

          {quoteMode === "pick" && favQuoteMemory ? (
            <div className="bg-[#fefcf9] rounded-lg p-3 border border-[#e8e3dc]">
              <p className="italic text-[13px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
                &ldquo;{favQuoteMemory.title}&rdquo;
              </p>
              {favQuoteMemory.child_id && (
                <p className="text-[10px] text-[#9a8f85] mt-1">
                  — {children.find((c) => c.id === favQuoteMemory.child_id)?.name ?? ""}
                </p>
              )}
              {!isReadOnly && (
                <button onClick={() => setShowQuotePicker(true)} className="text-[11px] text-[#5c7f63] font-medium mt-2">
                  Change
                </button>
              )}
            </div>
          ) : quoteMode === "type" && favQuote.startsWith("text:") ? (
            <div>
              <input
                value={favQuote.replace(/^text:/, "")}
                onChange={(e) => {
                  const v = `text:${e.target.value}`;
                  setFavQuote(v);
                  saveContent("letter_favorite_quote", v);
                }}
                disabled={isReadOnly}
                placeholder="Type your favorite quote…"
                className="w-full px-3 py-2 text-[13px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] italic disabled:opacity-60"
                style={{ fontFamily: "Georgia, serif" }}
              />
            </div>
          ) : (
            !isReadOnly && (
              <button
                onClick={() => setShowQuotePicker(true)}
                className="w-full py-4 rounded-lg border-2 border-dashed border-[#d4cfc8] text-[12px] text-[#9a8f85] hover:border-[#5c7f63] transition-colors"
              >
                Choose a quote
              </button>
            )
          )}

          {!isReadOnly && (
            <button
              onClick={() => {
                if (quoteMode === "pick") {
                  setQuoteMode("type");
                  if (!favQuote.startsWith("text:")) {
                    setFavQuote("text:");
                  }
                } else {
                  setQuoteMode("pick");
                  setFavQuote("");
                }
              }}
              className="text-[11px] text-[#5c7f63] font-medium mt-2"
            >
              {quoteMode === "pick" ? "Or type your own" : "Or pick from quotes"}
            </button>
          )}
        </div>

        {/* ── Quote picker modal ──────────────────────────────── */}
        {showQuotePicker && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowQuotePicker(false)}>
            <div className="bg-[#fefcf9] rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-[#2d2926]">Choose a quote</p>
                <button onClick={() => setShowQuotePicker(false)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg">×</button>
              </div>
              <div className="space-y-2">
                {quoteMemories.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      setFavQuote(m.id);
                      setQuoteMode("pick");
                      setShowQuotePicker(false);
                      await saveContent("letter_favorite_quote", m.id);
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      m.id === favQuote ? "border-[var(--g-deep)] bg-[#eaf3de]" : "border-[#e8e3dc] hover:bg-[#faf8f4]"
                    }`}
                  >
                    <p className="italic text-[12px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
                      &ldquo;{m.title}&rdquo;
                    </p>
                    {m.child_id && (
                      <p className="text-[10px] text-[#9a8f85] mt-1">
                        — {children.find((c) => c.id === m.child_id)?.name ?? ""}
                      </p>
                    )}
                  </button>
                ))}
              </div>
              {quoteMemories.length === 0 && (
                <p className="text-center text-[12px] text-[#9a8f85] py-8">
                  No quotes saved yet. Log a quote from the Today page.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Per-child sections ───────────────────────────────── */}
        {children.map((child) => {
          const answers = childAnswers[child.id] ?? {};
          const answeredCount = INTERVIEW_QUESTIONS.filter((q) => answers[q.key]?.trim()).length;

          return (
            <div key={child.id} className="bg-white rounded-xl border border-[#e8e3dc] p-5">
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-5 h-5 rounded-full" style={{ backgroundColor: child.color ?? "#5c7f63" }} />
                <p className="text-[15px] font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                  {child.name}
                </p>
                <span className="text-[11px] text-[#9a8f85] bg-[#f0ede5] px-2 py-0.5 rounded-full">
                  {answeredCount}/6 answered
                </span>
              </div>

              {/* Interview questions */}
              <div className="space-y-4">
                {INTERVIEW_QUESTIONS.map((q) => {
                  const fieldKey = `${child.id}:${q.key}`;
                  const val = answers[q.key] ?? "";
                  const isActive = activeField === fieldKey || val.trim().length > 0;
                  const updKey = ck("child_interview", child.id, q.key);

                  return (
                    <div key={q.key}>
                      <p className="text-[11px] text-[#9a8f85] italic mb-1">{q.label}</p>
                      {isActive ? (
                        <>
                          <textarea
                            value={val}
                            onChange={(e) => {
                              const v = e.target.value;
                              setChildAnswers((prev) => ({
                                ...prev,
                                [child.id]: { ...prev[child.id], [q.key]: v },
                              }));
                              // Debounced save inline
                              clearTimeout((window as unknown as Record<string, NodeJS.Timeout | undefined>)[`_ybsave_${fieldKey}`]);
                              (window as unknown as Record<string, NodeJS.Timeout | undefined>)[`_ybsave_${fieldKey}`] = setTimeout(() => {
                                saveContent("child_interview", v, child.id, q.key);
                              }, 800);
                            }}
                            autoFocus={activeField === fieldKey}
                            disabled={isReadOnly}
                            className="w-full min-h-[60px] text-[13px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] resize-y disabled:opacity-60"
                            style={{ fontFamily: "Georgia, serif" }}
                          />
                          {val.trim() && updatedMap[updKey] && (
                            <p className="text-[9px] text-[rgba(254, 252, 249, 0.55)] mt-0.5">
                              ✓ Saved {new Date(updatedMap[updKey]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => setActiveField(fieldKey)}
                          className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-[#d4cfc8] text-[12px] text-[#c4b89a] italic hover:border-[#5c7f63] transition-colors"
                        >
                          Tap to add {child.name}&apos;s answer…
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Future note */}
              <div className="mt-5 pt-4 border-t border-[#e8e3dc]">
                <p className="text-[13px] font-semibold text-[#2d2926] mb-0.5">A note to future {child.name}</p>
                <p className="text-[11px] text-[#9a8f85] italic mb-2">
                  {child.name} dictates, you type — or let them type it themselves!
                </p>
                <textarea
                  value={childNotes[child.id] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setChildNotes((prev) => ({ ...prev, [child.id]: v }));
                    clearTimeout((window as unknown as Record<string, NodeJS.Timeout | undefined>)[`_ybsave_note_${child.id}`]);
                    (window as unknown as Record<string, NodeJS.Timeout | undefined>)[`_ybsave_note_${child.id}`] = setTimeout(() => {
                      saveContent("child_future_note", v, child.id);
                    }, 800);
                  }}
                  disabled={isReadOnly}
                  placeholder={`Dear future ${child.name}…`}
                  className="w-full min-h-[80px] text-[13px] text-[#2d2926] bg-[#fefcf9] border border-[#c0dd97] rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-[var(--g-deep)] resize-y disabled:opacity-60"
                  style={{ fontFamily: "Georgia, serif" }}
                />
              </div>
            </div>
          );
        })}

        {/* ── Save all button ─────────────────────────────────── */}
        {!isReadOnly && (
          <button
            onClick={async () => {
              setSaveAllStatus("saving");
              try {
                await saveContent("cover_photo", coverPhotoUrl);
                await saveContent("family_name", familyName);
                await saveContent("school_year", schoolYear);
                await saveContent("letter_from_home", letter);
                if (favMemoryId) await saveContent("letter_favorite_memory_id", favMemoryId);
                if (favCaption) await saveContent("letter_favorite_caption", favCaption);
                if (favQuote) await saveContent("letter_favorite_quote", favQuote);
                for (const child of children) {
                  for (const q of INTERVIEW_QUESTIONS) {
                    const val = childAnswers[child.id]?.[q.key] ?? "";
                    if (val.trim()) await saveContent("child_interview", val, child.id, q.key);
                  }
                  const note = childNotes[child.id] ?? "";
                  if (note.trim()) await saveContent("child_future_note", note, child.id);
                }
                setSaveAllStatus("saved");
                setTimeout(() => setSaveAllStatus("idle"), 4000);
              } catch {
                setSaveAllStatus("idle");
              }
            }}
            disabled={saveAllStatus === "saving"}
            className="w-full py-3 rounded-xl text-sm font-medium transition-colors bg-[#2d5a3d] hover:bg-[#3d5c42] text-white disabled:opacity-60"
          >
            {saveAllStatus === "saving" ? "Saving…" : saveAllStatus === "saved" ? "All changes saved ✓" : "Save all changes"}
          </button>
        )}
      </div>
    </>
  );
}
