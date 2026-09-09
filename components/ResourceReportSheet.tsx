"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { REPORT_REASONS } from "@/lib/mail-adventures";

/** The longest note the sheet accepts, matching the copy under the box. */
const MAX_NOTE = 300;

export type ReportTarget =
  | { kind: "mailbox"; listingId: string; title: string }
  | { kind: "resource"; resourceId: string; title: string };

type Props = {
  target: ReportTarget;
  /** Preselects a reason. The empty-state link uses "other". */
  initialReason?: string;
  onClose: () => void;
  /** Fired after the row lands, so the page can show its own toast. */
  onSent: (message: string) => void;
};

/**
 * "This didn't work for us", shared by the Resources page and Mail Adventures.
 *
 * One component for both tables. resource_reports carries a check constraint
 * that exactly one of resource_id / mailbox_listing_id is set, so the target
 * discriminant here maps straight onto it and neither side can write a row the
 * database will refuse.
 *
 * No email is sent. Reports collect on the founder desk, which is the point:
 * the automated link checker cannot tell a dead link from a government site
 * refusing a bot, and a family saying "this never arrived" is the better signal.
 */
export default function ResourceReportSheet({ target, initialReason, onClose, onSent }: Props) {
  const [reason, setReason] = useState(initialReason ?? "");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes, matching every other sheet in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("You're not signed in.");
        return;
      }

      const row =
        target.kind === "mailbox"
          ? { user_id: user.id, mailbox_listing_id: target.listingId, resource_id: null, reason, note: note.trim() || null }
          : { user_id: user.id, resource_id: target.resourceId, mailbox_listing_id: null, reason, note: note.trim() || null };

      const { error: insErr } = await supabase.from("resource_reports").insert(row);
      if (insErr) throw insErr;

      posthog.capture("resource_reported", { kind: target.kind, reason });
      onSent("Thanks, I'll check this one.");
      onClose();
    } catch {
      // Kept on the sheet rather than closed behind a toast, so the note the
      // family just typed is still there to send again.
      setError("Couldn't send that just now. Try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
        <div
          className="bg-[#fefcf9] rounded-t-3xl sm:rounded-3xl shadow-xl border border-[#e8e2d9] w-full sm:max-w-sm p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Report a problem with this resource"
        >
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-base font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
              This didn&apos;t work for us
            </h2>
            <button onClick={onClose} aria-label="Close" className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-[#7a6f65] mb-4 leading-relaxed">{target.title}</p>

          <fieldset className="space-y-1 mb-4">
            <legend className="text-xs font-semibold text-[#5c7f63] mb-2">What happened?</legend>
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl cursor-pointer hover:bg-[#f5f2ec] transition-colors"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="w-4 h-4 accent-[#5c7f63]"
                />
                <span className="text-sm text-[#2d2926]">{r.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="block text-xs font-semibold text-[#5c7f63] mb-2" htmlFor="report-note">
            Anything else? (optional)
          </label>
          <textarea
            id="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            rows={3}
            maxLength={MAX_NOTE}
            placeholder="What you saw when you tried"
            className="w-full rounded-xl border border-[#e8e2d9] bg-white px-3 py-2 text-sm text-[#2d2926] placeholder:text-[#b5aca4] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/30 resize-none"
          />
          <p className="text-[11px] text-[#b5aca4] mt-1 text-right">{note.length}/{MAX_NOTE}</p>

          {error && <p className="text-xs text-[#c0392b] mt-3">{error}</p>}

          <button
            onClick={send}
            disabled={!reason || sending}
            className="mt-4 w-full py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#4a6650] disabled:bg-[#c9d4c9] disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}
