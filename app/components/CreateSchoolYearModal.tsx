"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  userId: string;
  activeYearName?: string;
  onClose: () => void;
  onCreated: () => void;
}

function suggestNextYear(currentName?: string): { name: string; start: string; end: string } {
  const now = new Date();
  let nextStartYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();

  if (currentName) {
    const match = currentName.match(/(\d{4})/);
    if (match) {
      const yr = parseInt(match[1], 10);
      nextStartYear = yr + 1;
    }
  }

  return {
    name: `${nextStartYear}\u2013${nextStartYear + 1}`,
    start: `${nextStartYear}-08-01`,
    end: `${nextStartYear + 1}-05-31`,
  };
}

export default function CreateSchoolYearModal({ userId, activeYearName, onClose, onCreated }: Props) {
  const suggested = suggestNextYear(activeYearName);
  const [name, setName] = useState(suggested.name);
  const [startDate, setStartDate] = useState(suggested.start);
  const [endDate, setEndDate] = useState(suggested.end);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim() || !startDate || !endDate) {
      setError("Please fill in all fields.");
      return;
    }
    if (endDate <= startDate) {
      setError("End date must be after start date.");
      return;
    }
    setSaving(true);
    setError("");

    const { error: insertErr } = await supabase.from("school_years").insert({
      user_id: userId,
      name: name.trim(),
      start_date: startDate,
      end_date: endDate,
      status: "upcoming",
    });

    if (insertErr) {
      setError(insertErr.message.includes("idx_school_years_upcoming")
        ? "You already have an upcoming school year."
        : insertErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl shadow-2xl" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="px-6 pb-8 pt-6">
          {/* Handle bar */}
          <div className="w-9 h-1 rounded-full bg-[#d5d0ca] mx-auto mb-5" />

          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-[#2D2A26]" style={{ fontFamily: "var(--font-display)" }}>
              Plan Next Year
            </h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#8B7E74] hover:bg-[#f0ede8] transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-[#8B7E74] font-medium block mb-1.5">
                What should we call next year?
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. 2026–2027"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8e5e0] bg-white text-sm text-[#2D2A26] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#8B7E74] font-medium block mb-1.5">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8e5e0] bg-white text-sm text-[#2D2A26] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>
              <div>
                <label className="text-xs text-[#8B7E74] font-medium block mb-1.5">End date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8e5e0] bg-white text-sm text-[#2D2A26] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="w-full py-3.5 rounded-xl bg-[#2D5A3D] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Creating…" : "Create School Year"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
