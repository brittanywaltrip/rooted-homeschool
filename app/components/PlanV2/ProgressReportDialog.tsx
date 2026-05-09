"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { PlanV2Child } from "./types";
import type { ReportRangePreset } from "@/lib/progress-report";

/* ============================================================================
 * ProgressReportDialog — collects the scope selections for a PDF export
 * (child, date range, activities toggle). Invokes the parent's generator
 * callback on confirm. The PDF itself is built by downloadProgressReport
 * in lib/progress-report.ts.
 *
 * Matches the legacy dialog's options one-for-one so output byte-equivalent
 * behavior is easy to reason about across the flag flip.
 * ==========================================================================*/

export interface ProgressReportDialogProps {
  isOpen: boolean;
  kids: PlanV2Child[];
  onClose: () => void;
  onGenerate: (opts: {
    childId: string | null;
    range: ReportRangePreset;
    customStart?: string;
    customEnd?: string;
    includeActivities: boolean;
  }) => Promise<void>;
}

const RANGE_OPTIONS: { value: ReportRangePreset; label: string }[] = [
  { value: "q1", label: "Q1 (Sep – Nov)" },
  { value: "q2", label: "Q2 (Dec – Feb)" },
  { value: "q3", label: "Q3 (Mar – May)" },
  { value: "q4", label: "Q4 (Jun – Aug)" },
  { value: "full", label: "Full year" },
  { value: "custom", label: "Custom…" },
];

export default function ProgressReportDialog(props: ProgressReportDialogProps) {
  const { isOpen, kids, onClose, onGenerate } = props;
  const [childId, setChildId] = useState<string>("");
  const [range, setRange] = useState<ReportRangePreset>("full");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [includeActivities, setIncludeActivities] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canGenerate =
    (range !== "custom" || (customStart && customEnd && customStart <= customEnd)) &&
    !submitting;

  async function handleGenerate() {
    if (!canGenerate) return;
    setSubmitting(true);
    setError(null);
    try {
      await onGenerate({
        childId: childId || null,
        range,
        customStart: range === "custom" ? customStart : undefined,
        customEnd: range === "custom" ? customEnd : undefined,
        includeActivities,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">Download progress report</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">PDF of lessons, hours, subjects, books, and field trips.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-4 pt-1 space-y-3 overflow-y-auto">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Child</span>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              >
                <option value="">All children</option>
                {kids.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-1">
                Date range
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {RANGE_OPTIONS.map((r) => {
                  const active = range === r.value;
                  return (
                    <label
                      key={r.value}
                      className="flex items-center gap-2 text-[12px] rounded-lg px-3 py-2 cursor-pointer border"
                      style={{
                        background: active ? "#f2f9f3" : "white",
                        borderColor: active ? "#5c7f63" : "#e8e2d9",
                        color: "#2d2926",
                      }}
                    >
                      <input
                        type="radio"
                        name="report-range"
                        checked={active}
                        onChange={() => setRange(r.value)}
                        className="w-3.5 h-3.5 accent-[#5c7f63]"
                      />
                      <span>{r.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {range === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">From</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => {
                      setCustomStart(e.target.value);
                      if (customEnd && e.target.value > customEnd) setCustomEnd(e.target.value);
                    }}
                    className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">To</span>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                  />
                </label>
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-[12px] text-[#2d2926] bg-[#fefcf9] border border-[#e8e2d9] rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeActivities}
                onChange={(e) => setIncludeActivities(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#5c7f63]"
              />
              <span className="font-medium">Include activities</span>
            </label>

            {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}
          </div>

          <div className="flex items-center gap-2 px-5 pb-5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
