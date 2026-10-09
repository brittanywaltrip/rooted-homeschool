/** Translate containment refusals at the UI boundary, without hiding other errors. */
export function schedulerErrorMessage(error: unknown, fallback = "Couldn't save. Reload and review the plan."): string {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
    : fallback;
  if (!/\bscheduler_[a-z0-9_]+\b/i.test(message)) return message;
  // A handler may already have saved metadata before its scheduling write was
  // refused. Never promise that the entire multi-step form was rolled back.
  return "This action is currently unavailable for this protected curriculum. Your saved work is kept. Reload and review the plan; earlier changes may already have saved. If it remains unavailable, contact support.";
}
