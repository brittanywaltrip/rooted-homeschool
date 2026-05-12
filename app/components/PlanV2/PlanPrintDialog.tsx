"use client";

import { useState } from "react";
import { Calendar, CalendarDays, CalendarRange, Lock, X } from "lucide-react";
import Link from "next/link";

/* PlanPrintDialog. Mode picker for the toolbar Print button. Daily is free
 * for everyone; Week + Month are paywalled (locked tiles route to /upgrade).
 * The dialog only collects a choice; the parent owns window.print() and
 * the body-class toggle that flips the matching print sheet visible. */

export type PlanPrintMode = "daily" | "weekly" | "monthly";

export interface PlanPrintDialogProps {
  isOpen: boolean;
  canPrintPaid: boolean; // false for free; true for trial / pro
  onClose: () => void;
  onPick: (mode: PlanPrintMode) => void;
}

const MODES: {
  mode: PlanPrintMode;
  label: string;
  blurb: string;
  Icon: typeof Calendar;
  free: boolean;
}[] = [
  { mode: "daily",   label: "Daily",   blurb: "Today's lessons for all kids",     Icon: CalendarDays,  free: true  },
  { mode: "weekly",  label: "Weekly",  blurb: "This week, day by day",            Icon: CalendarRange, free: false },
  { mode: "monthly", label: "Monthly", blurb: "The full month at a glance",       Icon: Calendar,      free: false },
];

export default function PlanPrintDialog(props: PlanPrintDialogProps) {
  const { isOpen, canPrintPaid, onClose, onPick } = props;
  const [selected, setSelected] = useState<PlanPrintMode>("daily");

  if (!isOpen) return null;

  const selectedMode = MODES.find((m) => m.mode === selected);
  const selectedLocked = !!selectedMode && !selectedMode.free && !canPrintPaid;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-xl w-full max-w-md pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-base font-bold text-[#1a2c22]">Print your plan</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pt-2 pb-3 grid grid-cols-3 gap-2">
            {MODES.map(({ mode, label, blurb, Icon, free }) => {
              const locked = !free && !canPrintPaid;
              const active = selected === mode;
              const baseStyle = "relative flex flex-col items-center text-center gap-1.5 rounded-xl border px-2.5 py-3 transition-colors";
              const stateStyle = active
                ? "border-[#2D5A3D] bg-[#f2f8f0]"
                : "border-[#e8e2d9] bg-white hover:border-[#c5dbc9]";
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelected(mode)}
                  aria-pressed={active}
                  className={`${baseStyle} ${stateStyle}`}
                >
                  {locked ? (
                    <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#fef9e8] border border-[#f0dda8] text-[#a07000]">
                      <Lock size={10} />
                    </span>
                  ) : null}
                  <Icon size={22} className={active ? "text-[#2D5A3D]" : "text-[#5c7f63]"} />
                  <span className={`text-[12px] font-semibold ${active ? "text-[#2D5A3D]" : "text-[#1a2c22]"}`}>
                    {label}
                  </span>
                  <span className="text-[10px] text-[#7a6f65] leading-snug">
                    {blurb}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedLocked ? (
            <div className="px-5 pt-1 pb-2">
              <Link
                href="/upgrade"
                onClick={onClose}
                className="block w-full text-center text-[12px] font-semibold text-[#a07000] bg-[#fef9e8] border border-[#f0dda8] rounded-xl py-2.5 hover:bg-[#fef0d6] transition-colors"
              >
                Founding Family unlocks weekly + monthly prints
              </Link>
            </div>
          ) : null}

          <div className="px-5 pb-5 pt-2">
            <button
              type="button"
              disabled={selectedLocked}
              onClick={() => onPick(selected)}
              className="w-full bg-[#2D5A3D] hover:bg-[#244830] text-white text-[14px] font-semibold rounded-xl py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Print
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
