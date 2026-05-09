"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/* ============================================================================
 * VacationBlockModal — create / edit / delete a vacation block, with the
 * "shift lessons forward" option mirrored from the legacy flow.
 *
 * Semantics:
 *   - Create + shift:  INSERT the block, then UPDATE every incomplete lesson
 *                      in-range to move forward by `shiftDays` teaching days.
 *   - Create + leave:  INSERT only; lessons stay put (parent can hide them
 *                      in-view via the vacation overlay).
 *   - Edit:            pre-filled, optional Delete. Currently we don't
 *                      re-run the shift on edit — a block's shift applies
 *                      at creation time; changing dates later doesn't move
 *                      lessons back or forward. A UX refinement worth doing
 *                      later if partners ask for it.
 *   - Delete + shift-back: offered only if the block was originally created
 *                      with shift_applied=true. Presented as a small toggle
 *                      on the confirm step.
 *
 * Submission is a single callback for create/save, and a separate one for
 * delete — keeps parent handlers focused.
 * ==========================================================================*/

export type VacationBlockExisting = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  /** From the audit-log row at creation time. Optional because older
   * blocks pre-date the flag; when missing we assume false + skip the
   * offer-to-shift-back affordance. */
  shift_applied?: boolean;
};

export type VacationBlockSave = {
  name: string;
  start_date: string;
  end_date: string;
  apply_shift: boolean;
};

export interface VacationBlockModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialStartDate?: string;
  existing?: VacationBlockExisting | null;
  onClose: () => void;
  onSave: (values: VacationBlockSave) => Promise<void>;
  /** `shiftBack` is only meaningful when the existing block had
   *  shift_applied=true at creation; parent should ignore it otherwise. */
  onDelete?: (shiftBack: boolean) => Promise<void>;
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function labelDate(s: string): string {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

export default function VacationBlockModal(props: VacationBlockModalProps) {
  const { isOpen, mode, initialStartDate, existing, onClose, onSave, onDelete } = props;

  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [applyShift, setApplyShift] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteShiftBack, setDeleteShiftBack] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && existing) {
      setName(existing.name ?? "");
      setStart(existing.start_date);
      setEnd(existing.end_date);
      setApplyShift(false); // not meaningful on edit (see file doc)
    } else {
      setName("");
      const startDefault = initialStartDate ?? isoToday();
      setStart(startDefault);
      setEnd(startDefault);
      setApplyShift(true);
    }
    setSubmitting(false);
    setError(null);
    setConfirmDelete(false);
    setDeleteShiftBack(false);
    setTimeout(() => nameInputRef.current?.focus(), 20);
  }, [isOpen, mode, existing, initialStartDate]);

  if (!isOpen) return null;

  const canSave = name.trim().length > 0 && !!start && !!end && start <= end;

  async function handleSave() {
    if (!canSave || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        start_date: start,
        end_date: end,
        apply_shift: mode === "create" ? applyShift : false,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save break");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDelete(deleteShiftBack);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete break");
    } finally {
      setSubmitting(false);
    }
  }

  const rangeLabel =
    start && end
      ? start === end
        ? labelDate(start)
        : `${labelDate(start)} – ${labelDate(end)}`
      : "";

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
              <h2 className="text-base font-bold text-[#2d2926]">
                {mode === "edit" ? "Edit break" : "Add a break"}
              </h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">
                {rangeLabel || "Mark a span of days off."}
              </p>
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

          {confirmDelete ? (
            <>
              <div className="px-5 pb-4 pt-1 space-y-3 overflow-y-auto">
                <p className="text-sm text-[#2d2926]">
                  Delete <span className="font-semibold">{existing?.name || "this break"}</span>
                  {rangeLabel ? ` (${rangeLabel})` : ""}?
                </p>
                {existing?.shift_applied ? (
                  <label className="flex items-center gap-2 text-[12px] text-[#2d2926] bg-[#fef9e8] border border-[#f0dda8] rounded-lg px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteShiftBack}
                      onChange={(e) => setDeleteShiftBack(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[#5c7f63]"
                    />
                    <span>Shift lessons back into the freed days</span>
                  </label>
                ) : null}
                {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}
              </div>
              <div className="flex items-center gap-2 px-5 pb-5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#b91c1c] rounded-xl hover:bg-[#991b1b] transition-colors disabled:opacity-50"
                >
                  {submitting ? "Deleting…" : "Delete break"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="px-5 pb-4 pt-1 space-y-3 overflow-y-auto">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                    Name
                  </span>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Spring break"
                    className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                      Start
                    </span>
                    <input
                      type="date"
                      value={start}
                      onChange={(e) => {
                        setStart(e.target.value);
                        if (end && e.target.value > end) setEnd(e.target.value);
                      }}
                      className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                      End
                    </span>
                    <input
                      type="date"
                      value={end}
                      min={start || undefined}
                      onChange={(e) => setEnd(e.target.value)}
                      className="mt-1 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
                    />
                  </label>
                </div>

                {mode === "create" ? (
                  <fieldset className="space-y-1.5">
                    <legend className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-1">
                      What about lessons in this range?
                    </legend>
                    <label
                      className="flex items-center gap-2 text-[12px] text-[#2d2926] rounded-lg px-3 py-2 cursor-pointer border"
                      style={{
                        background: applyShift ? "#f2f9f3" : "#ffffff",
                        borderColor: applyShift ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      <input
                        type="radio"
                        name="vac-reschedule"
                        checked={applyShift}
                        onChange={() => setApplyShift(true)}
                        className="w-3.5 h-3.5 accent-[#5c7f63]"
                      />
                      <span>Shift them forward to after the break</span>
                    </label>
                    <label
                      className="flex items-center gap-2 text-[12px] text-[#2d2926] rounded-lg px-3 py-2 cursor-pointer border"
                      style={{
                        background: !applyShift ? "#f2f9f3" : "#ffffff",
                        borderColor: !applyShift ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      <input
                        type="radio"
                        name="vac-reschedule"
                        checked={!applyShift}
                        onChange={() => setApplyShift(false)}
                        className="w-3.5 h-3.5 accent-[#5c7f63]"
                      />
                      <span>Leave them — I&apos;ll skip them manually</span>
                    </label>
                  </fieldset>
                ) : null}

                {error ? <p className="text-[11px] text-[#b91c1c]">{error}</p> : null}
              </div>

              <div className="flex items-center gap-2 px-5 pb-5 shrink-0">
                {mode === "edit" && onDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={submitting}
                    className="min-h-[44px] text-sm font-semibold text-[#b91c1c] bg-transparent hover:bg-[#fef2f2] rounded-xl px-3 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                ) : null}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl px-4 hover:bg-[#e8e2d9] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave || submitting}
                  className="min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl px-4 hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add break"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
