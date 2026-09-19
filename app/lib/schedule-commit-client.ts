/**
 * The builder's save, as one server-side transaction.
 *
 * Before this, a save was a sequence of separate PostgREST calls: release
 * pins, delete the re-spread band, insert history, insert forward, unschedule
 * the over-ceiling rows that carry the parent's words, delete the rest of that
 * band, re-date the held-back rows, move the pointer. Each one committed on its
 * own. A save that died in the middle left the goal half-written, and if it
 * died after the delete and before the inserts the lessons were simply gone.
 *
 * Every one of those writes is now arguments to a single RPC.
 *
 * Dependency-injected on purpose: the tests drive it with a recording fake, so
 * they need no Supabase client and no network.
 */

export type ScheduleCommitClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error: { message: string; code?: string } | null }>;
};

export type LessonUpdate = {
  lesson_id: string;
  scheduled_date?: string | null;
  date?: string | null;
  queue_position?: number | null;
  queue_pinned?: boolean;
  scheduled_source?: string | null;
};

export type GoalSaveRequest = {
  goalId: string;
  goalUpdates?: Record<string, unknown> | null;
  lessonUpdates?: LessonUpdate[];
  deleteIds?: string[];
  insertRows?: Record<string, unknown>[];
  pointer?: number | null;
  /** Stable per attempt, so a retry after a lost response is not a second save. */
  idempotencyKey: string;
};

export type GoalSaveResult = {
  status: "committed" | "already_committed";
  deleted: number;
  inserted: number;
  updated: number;
  transactionId: string;
  afterVersion: string;
};

/** 40001 covers the refusals that mean "re-plan and try again". */
const SERIALIZATION = "40001";
const PERMISSION_DENIED = "42501";
/** 22023 is invalid_parameter_value: the payload was rejected before any write. */
const INVALID_PARAMETER = "22023";

/**
 * Do we know the transaction did NOT commit?
 *
 * The whole save is one function call, so if PostgreSQL raised, it rolled
 * back. Receiving a SQLSTATE therefore means the server processed the request
 * and aborted it -- that includes constraint violations like 23505, which an
 * earlier version of this list wrongly treated as unknown.
 *
 * What is genuinely unknown is everything where PostgreSQL may have committed
 * and the ANSWER went missing:
 *
 *   - no code at all: a transport failure, a timeout, a dropped connection
 *   - class 08, connection exception
 *   - 57014 / 57P01, cancelled or shut down, which can land after the commit
 *
 * Only the first group may be reported to the parent as "nothing changed".
 */
const UNKNOWN_OUTCOME_CODES = new Set(["57014", "57P01", "57P02", "57P03"]);

export function outcomeIsKnown(code: string | undefined): boolean {
  if (!code) return false;
  if (code.startsWith("08")) return false;
  if (UNKNOWN_OUTCOME_CODES.has(code)) return false;
  // A SQLSTATE is five characters. Anything else did not come from PostgreSQL.
  return /^[0-9A-Za-z]{5}$/.test(code);
}

export class ScheduleSaveError extends Error {
  readonly code: string | undefined;
  /** The schedule moved under us, or the proposal was consumed or expired. */
  readonly retryable: boolean;
  /** This tab predates the change and no longer has the privilege it used. */
  readonly staleClient: boolean;
  /**
   * False when we cannot say whether the transaction committed -- a lost
   * response, a timeout, an unrecognised code. The UI must not claim a
   * rollback in that case.
   */
  readonly outcomeKnown: boolean;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "ScheduleSaveError";
    this.code = code;
    this.retryable = code === SERIALIZATION;
    this.staleClient = code === PERMISSION_DENIED;
    this.outcomeKnown = outcomeIsKnown(code);
  }
}

export function saveMessageFor(err: { message: string; code?: string }): string {
  if (err.code === SERIALIZATION) {
    return "Your schedule changed while this was open, so nothing was saved. Your settings are still here — try saving again.";
  }
  if (err.code === PERMISSION_DENIED) {
    return "We couldn't save this schedule. This page may be out of date — reload and try again. Nothing was changed.";
  }
  if (outcomeIsKnown(err.code)) {
    // PostgreSQL raised, so the transaction rolled back. Safe to promise.
    return "We couldn't save this schedule — something about it didn't add up, so nothing was changed. Your settings are still here.";
  }
  // UNKNOWN OUTCOME. The request may have committed and its response been
  // lost. Saying "nothing was changed" here would be a guess, and the previous
  // wording made that guess for every unclassified failure. Say what is true:
  // we do not know yet, and we are finding out.
  return "We couldn't confirm whether your schedule saved. Your settings are still here — reopen the page to see where it got to before saving again.";
}

/**
 * Seal a proposal for this goal, then commit the whole save against it.
 *
 * The proposal is sealed with NO placements. schedule_seal_proposal requires
 * every placement to reference an EXISTING lesson, and a rebuild's rows do not
 * exist yet.
 *
 * SO BE CLEAR ABOUT WHAT THE SEAL DOES AND DOES NOT DO HERE. It establishes
 * the owner, the goal scope, an expiry, a state version, and a token that can
 * be consumed exactly once. It does NOT bind the operation: the payload is
 * supplied afterwards, on the commit call, and the seal never saw it. The
 * commit re-validates every id in that payload against the owner and the
 * proposal's goals, so nothing is trusted on the seal's word -- but a reader
 * should not imagine the sealed hash covers the rows being written, because it
 * does not. Binding a digest of the intended payload at seal time would close
 * that gap and is the obvious next step if this contract needs to be stronger.
 */
export async function commitGoalSave(
  client: ScheduleCommitClient,
  req: GoalSaveRequest,
): Promise<GoalSaveResult> {
  const sealed = await client.rpc("schedule_seal_proposal", {
    p_action: "rebuild",
    p_goal_ids: [req.goalId],
    p_placements: [],
  });
  if (sealed.error) throw new ScheduleSaveError(saveMessageFor(sealed.error), sealed.error.code);

  // The seal returns `preview_id`, not `proposal_id`. The name is the sealed
  // proposal's row id in schedule_proposals -- the thing schedule_commit
  // consumes -- and reading the wrong key here silently committed against
  // `undefined`. Found by running it, not by reading it; the other two spellings
  // are accepted so a future rename does not break this quietly.
  const sealedData = (typeof sealed.data === "object" && sealed.data !== null
    ? sealed.data : {}) as Record<string, unknown>;
  const proposalId =
    (sealedData.preview_id as string | undefined) ??
    (sealedData.proposal_id as string | undefined) ??
    (sealedData.id as string | undefined);
  if (!proposalId) {
    throw new ScheduleSaveError("The server did not return a proposal to save against.", undefined);
  }

  const committed = await client.rpc("schedule_commit", {
    p_proposal_id: proposalId,
    p_goal_updates: req.goalUpdates ? { [req.goalId]: req.goalUpdates } : {},
    p_lesson_updates: req.lessonUpdates ?? [],
    p_delete_ids: req.deleteIds ?? [],
    p_insert_rows: req.insertRows ?? [],
    p_pointers: req.pointer == null ? {} : { [req.goalId]: req.pointer },
    p_idempotency_key: req.idempotencyKey,
  });
  if (committed.error) {
    throw new ScheduleSaveError(saveMessageFor(committed.error), committed.error.code);
  }

  return readResult(committed.data);
}

/**
 * Normalise a commit result.
 *
 * A REPLAY used to carry its counts only inside `impact`, so reading
 * data.inserted gave 0 -- and the builder then compared 0 against its planned
 * count and told the parent nothing was saved, after the save had committed.
 * The SQL now lifts the counts to the top level; this reads `impact` as well,
 * so an older function or a future shape change cannot reintroduce the bug
 * silently.
 */
export function readResult(data: unknown): GoalSaveResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const impact = (d.impact ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? impact[k] ?? 0);
  return {
    status: d.status === "already_committed" ? "already_committed" : "committed",
    deleted: n("deleted"),
    inserted: n("inserted"),
    updated: n("updated"),
    transactionId: String(d.transaction_id ?? ""),
    afterVersion: String(d.after_version ?? ""),
  };
}

/**
 * After an unknown outcome, ask whether the save landed.
 *
 * Returns the committed result if a transaction carrying this key exists, or
 * null if none does. Null is NOT "nothing was saved": a request still in
 * flight looks the same, which is why the caller retries the exact payload
 * under the exact key rather than concluding anything from it.
 */
export async function reconcileGoalSave(
  client: ScheduleCommitClient,
  idempotencyKey: string,
): Promise<GoalSaveResult | null> {
  const { data, error } = await client.rpc("schedule_commit_status", {
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new ScheduleSaveError(saveMessageFor(error), error.code);
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.status !== "committed") return null;
  return readResult({ ...d, status: "already_committed" });
}
