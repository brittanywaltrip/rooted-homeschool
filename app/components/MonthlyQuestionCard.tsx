"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { monthKey, questionForMonth, monthLabel } from "@/lib/monthly-questions";

// One Question a Month — a gentle, dismissible Today-page card. Shows the current
// month's question once, until it's answered or dismissed; re-surfaces next month
// with the next question. Never nags. NO AI: the answer is the family's own words.
export default function MonthlyQuestionCard({ userId }: { userId: string | null | undefined }) {
  const [month] = useState(() => monthKey(new Date()));
  const [show, setShow] = useState(false);
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const question = questionForMonth(month);
  const dismissKey = `oqam_dismissed_${month}`;

  useEffect(() => {
    if (!userId) return;
    if (typeof window !== "undefined" && localStorage.getItem(dismissKey) === "1") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("monthly_reflections")
        .select("answer")
        .eq("user_id", userId)
        .eq("month", month)
        .maybeSingle();
      if (cancelled) return;
      if (data && ((data as { answer?: string }).answer ?? "").trim()) return; // already answered
      setShow(true);
    })();
    return () => { cancelled = true; };
  }, [userId, month, dismissKey]);

  if (!show) return null;

  const onSave = async () => {
    if (!userId || !answer.trim() || saving) return;
    setSaving(true);
    await supabase.from("monthly_reflections").upsert(
      { user_id: userId, month, question, answer: answer.trim(), updated_at: new Date().toISOString() },
      { onConflict: "user_id,month" },
    );
    setSaving(false);
    setSaved(true);
    setTimeout(() => setShow(false), 1400);
  };

  const onDismiss = () => {
    if (typeof window !== "undefined") localStorage.setItem(dismissKey, "1");
    setShow(false);
  };

  return (
    <div className="bg-[#fefcf9] rounded-2xl border border-[#e8e2d9] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5c7f63]">
          This month · {monthLabel(month)}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Maybe later"
          className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none -mt-1 -mr-1 px-1"
        >
          ×
        </button>
      </div>
      <p className="text-[15px] text-[#2d2926] mt-1.5" style={{ fontFamily: "var(--font-display)" }}>
        {question}
      </p>
      {saved ? (
        <p className="text-[12px] text-[#5c7f63] mt-3">Saved. See you next month 🌿</p>
      ) : (
        <>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="A sentence or two, in your own words."
            className="w-full mt-2.5 min-h-[64px] text-[14px] text-[#2d2926] bg-white border border-[#e8e2d9] rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-[#5c7f63] resize-y"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <div className="flex items-center justify-end gap-3 mt-2">
            <button type="button" onClick={onDismiss} className="text-[12px] text-[#7a6f65] px-2 py-1.5">
              Maybe later
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!answer.trim() || saving}
              className="text-[13px] bg-[#2d5a3d] text-white px-4 py-2 rounded-xl font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
