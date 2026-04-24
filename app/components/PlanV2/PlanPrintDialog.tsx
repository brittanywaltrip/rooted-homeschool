"use client";

import { Lock, X } from "lucide-react";
import Link from "next/link";
import { InlineLeaf } from "./print-decorations";

/* ============================================================================
 * PlanPrintDialog — three-tile picker for the Plan toolbar Print button.
 *
 * Daily is free for everyone. Week + Month are paywalled. The dialog only
 * collects the user's choice; the parent owns the actual `window.print()`
 * call + body-class toggle (since the print sheets live in PlanV2's tree).
 * ==========================================================================*/

export type PlanPrintMode = "daily" | "weekly" | "monthly";

export interface PlanPrintDialogProps {
  isOpen: boolean;
  canPrintPaid: boolean; // false for free; true for trial / pro
  onClose: () => void;
  onPick: (mode: PlanPrintMode) => void;
}

export default function PlanPrintDialog(props: PlanPrintDialogProps) {
  const { isOpen, canPrintPaid, onClose, onPick } = props;
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">Print your plan</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">A warm, hand-drawn paper-planner page.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-3 pt-1 space-y-2">
            <PrintTile
              icon="📋"
              title="Today"
              blurb="Lessons + appointments + notes lines, portrait."
              free
              onClick={() => onPick("daily")}
            />
            <PrintTile
              icon="🗓️"
              title="This Week"
              blurb="7-day teacher-book layout, landscape."
              free={false}
              canAccess={canPrintPaid}
              onClick={() => onPick("weekly")}
            />
            <PrintTile
              icon="📅"
              title="This Month"
              blurb="6-week calendar grid with color-coded lessons, landscape."
              free={false}
              canAccess={canPrintPaid}
              onClick={() => onPick("monthly")}
            />
          </div>

          <div className="px-5 pb-5 pt-1 border-t border-[#f0ede8] mt-1">
            <Link
              href="/dashboard/printables/year-planner"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#2D5A3D] hover:underline"
              onClick={onClose}
            >
              <InlineLeaf size={12} />
              Year Planner →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function PrintTile({
  icon, title, blurb, free, canAccess, onClick,
}: {
  icon: string;
  title: string;
  blurb: string;
  free: boolean;
  canAccess?: boolean;
  onClick: () => void;
}) {
  const locked = !free && !canAccess;
  if (locked) {
    return (
      <Link
        href="/upgrade"
        title="Founding Family"
        className="w-full flex items-start gap-3 bg-white border border-[#e8e2d9] rounded-xl px-3.5 py-3 hover:border-[#C4962A] transition-colors"
      >
        <span aria-hidden className="text-[22px] leading-none mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-[#2d2926]">{title}</p>
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[#a07000] bg-[#fef9e8] border border-[#f0dda8] rounded-full px-1.5 py-0.5">
              <Lock size={9} /> Founding Family
            </span>
          </div>
          <p className="text-[11px] text-[#7a6f65] leading-relaxed mt-0.5">{blurb}</p>
        </div>
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 bg-white border border-[#e8e2d9] rounded-xl px-3.5 py-3 hover:border-[#2D5A3D] hover:shadow-sm transition-all"
    >
      <span aria-hidden className="text-[22px] leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#2d2926]">{title}</p>
        <p className="text-[11px] text-[#7a6f65] leading-relaxed mt-0.5">{blurb}</p>
      </div>
    </button>
  );
}
