"use client";

import type { PlanV2Appointment } from "./types";

/* Appointment chip. Distinct visual from lessons so the eye separates
 * appointments from schoolwork: white fill, dashed border, 📍 prefix. */

interface Props {
  appt: PlanV2Appointment;
  onClick?: () => void;
}

function formatTimeShort(t: string | null): string | null {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const hour12 = ((h + 11) % 12) + 1;
  const suffix = h >= 12 ? "p" : "a";
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

export default function AppointmentPill({ appt, onClick }: Props) {
  const time = formatTimeShort(appt.time);
  const done = appt.completed;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Appointment: ${appt.title}${time ? ` at ${time}` : ""}${done ? ", completed" : ""}`}
      className="w-full text-left rounded-md px-1.5 py-[3px] text-[10px] font-medium bg-white transition-colors hover:bg-[#faf8f4] flex items-center gap-1 min-w-0"
      style={{
        border: "1px dashed #c4b5d8",
        opacity: done ? 0.55 : 1,
      }}
    >
      <span aria-hidden className="shrink-0 text-[9px]">📍</span>
      {time ? (
        <span className="shrink-0 text-[9px] font-semibold" style={{ color: "#5c7f63" }}>
          {time}
        </span>
      ) : null}
      <span
        className="min-w-0 flex-1 truncate leading-tight"
        style={{ color: "#2d2926", textDecoration: done ? "line-through" : "none" }}
      >
        {appt.title}
      </span>
    </button>
  );
}
