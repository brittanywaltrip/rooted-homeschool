// Claim-first deduplication for one-per-key emails.
//
// Every other sender in Rooted (lib/winback.ts, lib/trial-ending.ts) is
// send-then-log: it checks email_log, sends, then writes the row. Each of those
// carries a logWriteFailures counter because a send whose row did not land gets
// repeated on the next run. That is tolerable for a daily cron with a multi-day
// window. It is NOT tolerable for a webhook: Stripe delivers the same event
// concurrently and retries it for three days, so a check-then-send race sends
// the same family the same notice several times.
//
// So the row is written FIRST and the unique index decides the winner:
//
//   1. claim    INSERT (user_id, email_type, sent_at = NULL)
//                 → 23505 means somebody else already owns this key. Send
//                   nothing and report success, which stops Stripe retrying.
//   2. send
//   3. confirm  UPDATE sent_at = now()
//   4. release  DELETE ... WHERE sent_at IS NULL, on a RETRYABLE failure only
//
// The `sent_at IS NULL` predicate in the release is load-bearing. Without it a
// late release could delete a row that another delivery had already confirmed,
// which re-opens the key and lets the next webhook retry send a duplicate.
//
// WHY A 4xx IS NOT RELEASED: a 4xx is Resend refusing this exact payload
// (invalid address, rejected content). Releasing would let every Stripe retry
// for the next three days re-enter and fail the same way. The claim is kept,
// the row stays sent_at NULL, and that unconfirmed row IS the record that a
// send was attempted and never landed. Only 5xx and transport errors, which a
// retry can genuinely fix, release the claim.
//
// This relies on the live unique index email_log_user_type_idx on
// (user_id, email_type). Note Postgres treats NULLs as distinct, so a null
// user_id would not dedupe: callers must resolve a real profile first.

/** A send outcome the caller classifies for us, so this module stays transport agnostic. */
export type SendOutcome =
  | { ok: true }
  /** Resend refused this payload. Keep the claim: a retry would fail identically. */
  | { ok: false; retryable: false; status?: number; error?: string }
  /** Resend was unreachable or 5xx. Release the claim so a webhook retry can try again. */
  | { ok: false; retryable: true; status?: number; error?: string };

export type ClaimedSendResult =
  | { status: "sent" }
  | { status: "already_claimed" }
  | { status: "claim_failed"; error: string }
  /** Sent nothing; the claim was released and a webhook retry may try again. */
  | { status: "released"; status_code?: number; error?: string }
  /** Sent nothing; the claim was deliberately kept so retries cannot loop. */
  | { status: "kept"; status_code?: number; error?: string }
  /** The send landed but the confirm write did not. Never re-sends: the claim still exists. */
  | { status: "sent_unconfirmed" };

export interface EmailClaimStore {
  /**
   * INSERT the claim row with sent_at NULL.
   * `duplicate` must be true for a unique-violation (23505) and ONLY for that.
   * Any other failure is an error: we must not treat an unknown write failure
   * as "somebody else has it", or a real notice would be silently dropped.
   */
  claim(userId: string, emailType: string): Promise<{ ok: boolean; duplicate: boolean; error?: string }>;
  /** UPDATE sent_at = now(). */
  confirm(userId: string, emailType: string): Promise<boolean>;
  /** DELETE ... AND sent_at IS NULL. */
  release(userId: string, emailType: string): Promise<boolean>;
}

/**
 * Claim the key, send, then confirm or release.
 *
 * The send is only ever attempted by the delivery that won the claim, so
 * concurrent duplicate webhook deliveries cannot double-send even when they
 * race inside the same millisecond: the unique index serialises them.
 */
export async function sendOnceClaimed(args: {
  store: EmailClaimStore;
  userId: string;
  emailType: string;
  send: () => Promise<SendOutcome>;
  log?: (line: string) => void;
}): Promise<ClaimedSendResult> {
  const { store, userId, emailType, send } = args;
  const log = args.log ?? (() => {});

  const claimed = await store.claim(userId, emailType);
  if (!claimed.ok) {
    if (claimed.duplicate) {
      log(`[email-claim] ${emailType} already claimed, sending nothing`);
      return { status: "already_claimed" };
    }
    // Unknown write failure. Send nothing: without a claim we cannot promise
    // "exactly once", and sending anyway is the one mistake with no undo.
    log(`[email-claim] ${emailType} claim failed, sending nothing: ${claimed.error ?? "unknown"}`);
    return { status: "claim_failed", error: claimed.error ?? "unknown" };
  }

  const outcome = await send();

  if (outcome.ok) {
    const confirmed = await store.confirm(userId, emailType);
    if (!confirmed) {
      // The mail went out. The claim row still exists, so nothing re-sends.
      // It simply stays unconfirmed, which is the honest record.
      log(`[email-claim] ${emailType} SENT but confirm write failed`);
      return { status: "sent_unconfirmed" };
    }
    return { status: "sent" };
  }

  if (outcome.retryable) {
    await store.release(userId, emailType);
    log(`[email-claim] ${emailType} send failed (retryable), claim released`);
    return { status: "released", status_code: outcome.status, error: outcome.error };
  }

  log(`[email-claim] ${emailType} send refused (${outcome.status ?? "n/a"}), claim kept`);
  return { status: "kept", status_code: outcome.status, error: outcome.error };
}

/** The email_log key for the one first-failure notice per invoice. */
export function firstFailureKey(invoiceId: string): string {
  return `payment_failed:${invoiceId}`;
}

/** The email_log key for the one final notice per invoice. */
export function finalFailureKey(invoiceId: string): string {
  return `payment_failed_final:${invoiceId}`;
}
