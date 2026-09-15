// The win-back email: one note, once per family, to a family who used Rooted
// and then went quiet.
//
// Before this, nobody heard from Rooted after they drifted. The never-started
// drip (reengagement 1 to 3) only goes to families with zero activity, and the
// weekly summary only goes to families active in the last 14 days. A family who
// checked off lessons for a month and stopped fell between the two, forever.
//
// WHO, all of these:
//   - onboarding finished (profiles.onboarded, the flag onboarding-reminder uses)
//   - last activity 14 to 21 days ago
//   - never sent a winback before (email_log, one per family, ever)
//   - the marketing gate allows it and the address is not suppressed
//   - not one of the internal accounts (NON_FAMILY_EMAILS, which includes the
//     e2e account)
//
// WHAT "ACTIVE" MEANS. Exactly what weekly-summary means by it, so the two
// emails can never disagree about a family: a memory's `date`, or a completed
// lesson's `scheduled_date`. A family is in the weekly summary while their
// newest such date is within 14 days, and becomes a win-back candidate the day
// it is not, for one week. Having any activity in that week is also the "has
// ever been active" test.
//
// Everything with a side effect is passed in, so node --test runs the whole
// decision with fakes. app/api/cron/winback/route.ts wires the real ones.

const DAY_MS = 24 * 60 * 60 * 1000;

export const WINBACK_EMAIL_TYPE = "winback";
export const WINBACK_SUBJECT = "Still here whenever you are";
export const WINBACK_DASHBOARD_URL = "https://rootedhomeschoolapp.com/dashboard";
export const MAX_WINBACK_SENDS_PER_RUN = 50;

/**
 * The window, as the date strings weekly-summary compares against.
 * `start` is inclusive (21 days ago), `end` is exclusive (14 days ago, which is
 * weekly-summary's own `since14`: a date on or after it is "active").
 */
export function winbackWindow(now: Date): { start: string; end: string } {
  const ymd = (ms: number) => new Date(ms).toISOString().split("T")[0];
  return { start: ymd(now.getTime() - 21 * DAY_MS), end: ymd(now.getTime() - 14 * DAY_MS) };
}

/** Newest activity date per family, from every activity row read since the window opened. */
export function lastActivityByUser(
  rows: readonly { user_id: string | null; date: string | null }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.user_id || !r.date) continue;
    const prev = out.get(r.user_id);
    if (!prev || r.date > prev) out.set(r.user_id, r.date);
  }
  return out;
}

/**
 * The families due a win-back, closest to leaving the window first so a run
 * that hits the send budget reaches them before they age out.
 *
 * Only a family whose NEWEST activity falls in [start, end) qualifies: newer
 * than that and they are still getting the weekly summary; older and they
 * never appear in `lastActive` at all, because it is built from rows dated on
 * or after `start`.
 */
export function pickWinbackCandidates(args: {
  lastActive: ReadonlyMap<string, string>;
  window: { start: string; end: string };
  onboarded: ReadonlySet<string>;
  alreadySent: ReadonlySet<string>;
}): string[] {
  const { start, end } = args.window;
  return [...args.lastActive]
    .filter(([id, d]) => d >= start && d < end && args.onboarded.has(id) && !args.alreadySent.has(id))
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] < b[1] ? -1 : 1))
    .map(([id]) => id);
}

/** The first child's name, or "your family" when there is none. */
export function winbackWho(firstChildName: string | null | undefined): string {
  const name = (firstChildName ?? "").replace(/\s+/g, " ").trim();
  return name || "your family";
}

/**
 * Same order as the reengagement cron's resolveFirstName: the profile, then the
 * auth metadata, then "there". Kept as its own copy so this job does not touch
 * the reengagement route.
 */
export function resolveFirstName(
  profileName: string | null | undefined,
  authUser: { user_metadata?: Record<string, string> } | null | undefined,
): string {
  return (
    profileName ||
    authUser?.user_metadata?.first_name ||
    authUser?.user_metadata?.full_name?.split(" ")[0] ||
    authUser?.user_metadata?.name?.split(" ")[0] ||
    "there"
  );
}

export interface WinbackDeps {
  now?: Date;
  /** Compute and count, send nothing, log nothing to email_log. */
  dry?: boolean;
  maxSends?: number;
  /** Every memory and completed-lesson activity date on or after `since`, all families. Null when the read failed. */
  loadActivitySince: (since: string) => Promise<{ user_id: string | null; date: string | null }[] | null>;
  /** Which of these ids have profiles.onboarded = true. Null when a read failed. */
  loadOnboarded: (userIds: string[]) => Promise<Set<string> | null>;
  /** Which of these ids already have a winback in email_log. Null when a read failed. */
  loadAlreadySent: (userIds: string[]) => Promise<Set<string> | null>;
  /**
   * Authoritative per-family email_log check, run immediately before each send.
   * Must answer true when the read fails: a family we cannot prove was never
   * sent is a family we skip, or "one per family, ever" breaks on a blip.
   */
  alreadySent: (userId: string) => Promise<boolean>;
  /** canSendMarketingEmail(userId, 'winback') plus the List-Unsubscribe headers. */
  gate: (userId: string) => Promise<{ allowed: boolean; reason?: string; headers: Record<string, string> }>;
  getUser: (userId: string) => Promise<{ email: string | null; firstName: string } | null>;
  isInternalEmail: (email: string) => boolean;
  suppressed: ReadonlySet<string>;
  firstChildName: (userId: string) => Promise<string | null>;
  send: (args: {
    to: string;
    variables: Record<string, string>;
    headers: Record<string, string>;
  }) => Promise<{ ok: boolean; status?: number; error?: string }>;
  /**
   * URL-encode the `email` variable before it goes to the template. It only
   * ever appears inside the footer's unsubscribe query string, and the
   * unsubscribe page decodes a raw "+" as a space.
   */
  encodeEmailVariable?: boolean;
  /** Write the email_log row. False when the write failed. */
  logSent: (userId: string) => Promise<boolean>;
  log: (line: string) => void;
}

export type WinbackResult = {
  candidates: number;
  sent: number;
  skipped: number;
  errors: number;
  dry: boolean;
  /**
   * Sends that went out but whose email_log row did not land. Each of those
   * families is still in the window with no record, so tomorrow's run would
   * send again: the route alerts on any of these.
   */
  logWriteFailures: number;
  failures: { userId: string; status?: number; error?: string }[];
};

export async function runWinback(deps: WinbackDeps): Promise<WinbackResult> {
  const now = deps.now ?? new Date();
  const max = deps.maxSends ?? MAX_WINBACK_SENDS_PER_RUN;
  const window = winbackWindow(now);
  const result: WinbackResult = {
    candidates: 0, sent: 0, skipped: 0, errors: 0, dry: !!deps.dry, logWriteFailures: 0, failures: [],
  };

  const rows = await deps.loadActivitySince(window.start);
  // A failed read cannot tell a quiet family from a busy one. Send nothing.
  if (!rows) {
    result.errors++;
    deps.log("[cron/winback] activity read failed, nothing sent");
    return result;
  }
  const lastActive = lastActivityByUser(rows);
  const inWindow = [...lastActive].filter(([, d]) => d >= window.start && d < window.end).map(([id]) => id);
  const [onboarded, sentBefore] = await Promise.all([
    deps.loadOnboarded(inWindow),
    deps.loadAlreadySent(inWindow),
  ]);
  // Same rule: an unanswered read could hide a family already sent. Send nothing.
  if (!onboarded || !sentBefore) {
    result.errors++;
    deps.log("[cron/winback] profile or email_log read failed, nothing sent");
    return result;
  }
  const candidates = pickWinbackCandidates({ lastActive, window, onboarded, alreadySent: sentBefore });
  result.candidates = candidates.length;

  for (const userId of candidates) {
    if (result.sent >= max) break;

    const gate = await deps.gate(userId);
    if (!gate.allowed) { result.skipped++; continue; }
    if (await deps.alreadySent(userId)) { result.skipped++; continue; }

    const user = await deps.getUser(userId);
    const email = user?.email ?? null;
    if (!user || !email) { result.skipped++; continue; }
    if (deps.isInternalEmail(email)) { result.skipped++; continue; }
    if (deps.suppressed.has(email.toLowerCase())) { result.skipped++; continue; }

    const variables = {
      firstName: user.firstName,
      who: winbackWho(await deps.firstChildName(userId)),
      dashboardUrl: WINBACK_DASHBOARD_URL,
      email: deps.encodeEmailVariable ? encodeURIComponent(email) : email,
    };

    if (result.sent >= max) break;
    if (deps.dry) {
      result.sent++;
      deps.log(`[cron/winback] DRY would send to user ${userId}`);
      continue;
    }

    const res = await deps.send({ to: email, variables, headers: gate.headers });
    if (!res.ok) {
      result.errors++;
      result.failures.push({ userId, status: res.status, error: res.error });
      deps.log(`[cron/winback] send failed for user ${userId}: ${res.status ?? "n/a"}`);
      continue;
    }
    result.sent++;
    if (!(await deps.logSent(userId))) {
      result.errors++;
      result.logWriteFailures++;
      result.failures.push({ userId, error: "sent, but the email_log row did not save" });
      deps.log(`[cron/winback] sent to user ${userId}, email_log write FAILED`);
      continue;
    }
    deps.log(`[cron/winback] sent to user ${userId}`);
  }

  return result;
}
