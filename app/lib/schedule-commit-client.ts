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

export class ScheduleSaveError extends Error {
  readonly code: string | undefined;
  /** The schedule moved under us, or the proposal was consumed or expired. */
  readonly retryable: boolean;
  /** This tab predates the change and no longer has the privilege it used. */
  readonly staleClient: boolean;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "ScheduleSaveError";
    this.code = code;
    this.retryable = code === SERIALIZATION;
    this.staleClient = code === PERMISSION_DENIED;
  }
}

export function saveMessageFor(err: { message: string; code?: string }): string {
  if (err.code === SERIALIZATION) {
    return "Your schedule changed while this was open, so nothing was saved. Your settings are still here — try saving again.";
  }
  if (err.code === PERMISSION_DENIED) {
    return "We couldn't save this schedule. This page may be out of date — reload and try again. Nothing was changed.";
  }
  return "We couldn't save this schedule. Nothing was changed — please try again.";
}

/**
 * Seal a proposal for this goal, then commit the whole save against it.
 *
 * The proposal is sealed with NO placements. schedule_seal_proposal requires
 * every placement to reference an EXISTING lesson, and a rebuild's rows do not
 * exist yet. What the seal is doing here is capturing the state version,
 * proving ownership and scope, and giving the commit something that can only
 * be consumed once.
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

  const d = (committed.data ?? {}) as Record<string, unknown>;
  return {
    status: d.status === "already_committed" ? "already_committed" : "committed",
    deleted: Number(d.deleted ?? 0),
    inserted: Number(d.inserted ?? 0),
    updated: Number(d.updated ?? 0),
    transactionId: String(d.transaction_id ?? ""),
    afterVersion: String(d.after_version ?? ""),
  };
}
