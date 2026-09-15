// "Your Rooted+ trial ends Sunday": one note, six days before a family's 30 days
// of Rooted+ run out.
//
// Nothing warned them. On day 31 the Memories page hides everything older than
// 30 days, photos cap at 50, the yearbook locks to four spreads, and exports,
// transcripts and family sharing switch off. The app shows a banner in the last
// 8 days, but only to a mom who opens it, and the only "trial ending" email in
// the code is for family-portal viewers and is disabled.
//
// WHO, all of these:
//   - trial_started_at 23 to 25 days ago, by calendar date in the family's own
//     timezone. The three-day width is the catch-up margin: a run that is
//     missed or budget-capped still reaches them the next day, and the
//     email_log dedup keeps it to one.
//   - still on trial right now (stillOnTrial, the rule getUserAccess applies),
//     so a family who already upgraded hears nothing
//   - onboarding finished
//   - no email_log 'trial_ending' row, not suppressed, not an internal account
//
// It is an account notice, not marketing: canSendMarketingEmail blocks it on
// email_unsubscribed only. A mom who turned off nurture emails still deserves
// to know her plan is changing.
//
// Everything with a side effect is passed in, so node --test runs the whole
// decision with fakes. app/api/cron/trial-ending/route.ts wires the real ones.

import { TRIAL_DAYS } from "./user-access.ts";
import { sanitizeSubjectText } from "./resend-template.ts";

export const TRIAL_ENDING_EMAIL_TYPE = "trial_ending";
export const TRIAL_ENDING_UPGRADE_URL = "https://rootedhomeschoolapp.com/upgrade";
export const MAX_TRIAL_ENDING_SENDS_PER_RUN = 100;
/** Days since trial_started_at that get the email: day 24 of the trial, six days out. */
export const TRIAL_ENDING_MIN_DAYS = 23;
export const TRIAL_ENDING_MAX_DAYS = 25;
/** Fallback when a profile's timezone is missing or unusable. */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export type TrialProfile = {
  id: string;
  first_name: string | null;
  trial_started_at: string | null;
  is_pro: boolean | null;
  onboarded: boolean | null;
  timezone: string | null;
};

/**
 * A timezone Intl will accept, or US Pacific.
 *
 * Narrow on purpose: profiles.timezone is NOT NULL with a format CHECK and a
 * default of America/New_York (migration 20260503000000), so a legacy row that
 * never self-healed carries a VALID but wrong zone and passes straight through
 * here. This only catches empty or unparseable values. The residue is an
 * end-date label a day off for a legacy family whose trial ends in the small
 * hours; the app's own gate uses the same instant either way.
 */
export function safeTimeZone(tz: string | null | undefined): string {
  const name = (tz ?? "").trim();
  if (!name) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name }).format(new Date());
    return name;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a timezone. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}

/** Whole days between two calendar dates, by date arithmetic and never by hours. */
export function daysBetweenDates(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** How many days into the trial the family is, by their own calendar. */
export function trialDaysElapsed(trialStartedAt: string, now: Date, timeZone: string): number {
  return daysBetweenDates(dateInZone(new Date(trialStartedAt), timeZone), dateInZone(now, timeZone));
}

/**
 * The instant the trial ends: start + TRIAL_DAYS, exactly as getUserAccess
 * computes it, so the email can never name a day the app disagrees with.
 */
export function trialEndInstant(trialStartedAt: string): Date {
  const end = new Date(trialStartedAt);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}

/** "Sunday, September 27" in the family's timezone. */
export function trialEndLabel(trialStartedAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(trialEndInstant(trialStartedAt));
}

/** The subject the route sends. endDate is sanitized because it lands in a header. */
export function trialEndingSubject(endDate: string): string {
  return `Your Rooted+ trial ends ${sanitizeSubjectText(endDate)}`;
}

/** The first child's name, or "your family" when there is none. */
export function trialEndingWho(firstChildName: string | null | undefined): string {
  const name = (firstChildName ?? "").replace(/\s+/g, " ").trim();
  return name || "your family";
}

/** The app's trial rule, against a clock the caller controls. Mirrors getUserAccess. */
export function stillOnTrial(profile: { is_pro: boolean | null; trial_started_at: string | null }, now: Date): boolean {
  if (profile.is_pro === true) return false;
  if (!profile.trial_started_at) return false;
  return trialEndInstant(profile.trial_started_at) > now;
}

/**
 * Is this family due the email? Pure: the caller hands in the clock and whether
 * a row was already logged.
 *
 * "Still on trial" is the same rule getUserAccess applies (not pro, and
 * start + TRIAL_DAYS still ahead), restated here so it answers from the clock
 * the caller handed in. stillOnTrial below is checked against getUserAccess in
 * the tests, so the two can never drift.
 */
export function isTrialEndingCandidate(args: {
  profile: TrialProfile;
  now: Date;
  alreadySent: boolean;
}): boolean {
  const { profile, now } = args;
  if (args.alreadySent) return false;
  if (profile.onboarded !== true) return false;
  if (!profile.trial_started_at) return false;
  // The same question getUserAccess answers, against the clock the caller
  // passed. getUserAccess reads new Date() internally, so calling it here would
  // answer from a different instant than the day window below whenever the
  // clock is injected (a replay, a backfill, a fixed-clock test).
  if (!stillOnTrial(profile, now)) return false;
  const elapsed = trialDaysElapsed(profile.trial_started_at, now, safeTimeZone(profile.timezone));
  return elapsed >= TRIAL_ENDING_MIN_DAYS && elapsed <= TRIAL_ENDING_MAX_DAYS;
}

export interface TrialEndingDeps {
  now?: Date;
  /** Compute and count, send nothing, write nothing. */
  dry?: boolean;
  maxSends?: number;
  /**
   * Profiles whose trial_started_at falls in the coarse timestamp range, which
   * is a day wider each side than the day window so no timezone can fall out of
   * it. Null when the read failed.
   */
  loadProfiles: (fromIso: string, toIso: string) => Promise<TrialProfile[] | null>;
  /** Which of these ids already have a trial_ending row. Null when the read failed. */
  loadAlreadySent: (userIds: string[]) => Promise<Set<string> | null>;
  /** Authoritative per-family check, immediately before each send. True when the read fails. */
  alreadySent: (userId: string) => Promise<boolean>;
  gate: (userId: string) => Promise<{ allowed: boolean; reason?: string; headers: Record<string, string> }>;
  getUser: (userId: string) => Promise<{ email: string | null; firstName: string } | null>;
  isInternalEmail: (email: string) => boolean;
  suppressed: ReadonlySet<string>;
  firstChildName: (userId: string) => Promise<string | null>;
  send: (args: {
    to: string;
    subject: string;
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

export type TrialEndingResult = {
  candidates: number;
  sent: number;
  skipped: number;
  errors: number;
  dry: boolean;
  /** Sends that went out with no email_log row: tomorrow's run would repeat them. */
  logWriteFailures: number;
  /**
   * Candidates the send budget left for another day. The window is only three
   * days wide, so a backlog that outlives it loses those families for good:
   * the route alerts on any of these.
   */
  deferred: number;
  failures: { userId: string; status?: number; error?: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runTrialEnding(deps: TrialEndingDeps): Promise<TrialEndingResult> {
  const now = deps.now ?? new Date();
  const max = deps.maxSends ?? MAX_TRIAL_ENDING_SENDS_PER_RUN;
  const result: TrialEndingResult = {
    candidates: 0, sent: 0, skipped: 0, errors: 0, dry: !!deps.dry, logWriteFailures: 0, deferred: 0, failures: [],
  };

  // One day of slack each side of the day window, so a family east or west of
  // the server's clock is still in the coarse read; the exact decision is the
  // date arithmetic in isTrialEndingCandidate.
  const from = new Date(now.getTime() - (TRIAL_ENDING_MAX_DAYS + 1) * DAY_MS).toISOString();
  const to = new Date(now.getTime() - (TRIAL_ENDING_MIN_DAYS - 1) * DAY_MS).toISOString();
  const profiles = await deps.loadProfiles(from, to);
  if (!profiles) {
    result.errors++;
    deps.log("[cron/trial-ending] profile read failed, nothing sent");
    return result;
  }

  const sentBefore = await deps.loadAlreadySent(profiles.map((p) => p.id));
  if (!sentBefore) {
    result.errors++;
    deps.log("[cron/trial-ending] email_log read failed, nothing sent");
    return result;
  }

  const candidates = profiles
    .filter((profile) => isTrialEndingCandidate({ profile, now, alreadySent: sentBefore.has(profile.id) }))
    // Closest to the end of their trial first, so a budget-capped run reaches
    // the family with the least time left.
    .sort((a, b) => (a.trial_started_at ?? "").localeCompare(b.trial_started_at ?? ""));
  result.candidates = candidates.length;

  for (const [index, profile] of candidates.entries()) {
    if (result.sent >= max) {
      result.deferred = candidates.length - index;
      deps.log(`[cron/trial-ending] budget reached, ${result.deferred} candidate(s) left for the next run`);
      break;
    }

    const gate = await deps.gate(profile.id);
    if (!gate.allowed) { result.skipped++; continue; }
    if (await deps.alreadySent(profile.id)) { result.skipped++; continue; }

    const user = await deps.getUser(profile.id);
    const email = user?.email ?? null;
    if (!user || !email) { result.skipped++; continue; }
    if (deps.isInternalEmail(email)) { result.skipped++; continue; }
    if (deps.suppressed.has(email.toLowerCase())) { result.skipped++; continue; }

    const endDate = trialEndLabel(profile.trial_started_at!, safeTimeZone(profile.timezone));
    const variables = {
      firstName: user.firstName,
      endDate,
      who: trialEndingWho(await deps.firstChildName(profile.id)),
      upgradeUrl: TRIAL_ENDING_UPGRADE_URL,
      email: deps.encodeEmailVariable ? encodeURIComponent(email) : email,
    };

    if (result.sent >= max) {
      result.deferred = candidates.length - index;
      break;
    }
    if (deps.dry) {
      result.sent++;
      deps.log(`[cron/trial-ending] DRY would send to user ${profile.id}, trial ends ${endDate}`);
      continue;
    }

    const res = await deps.send({
      to: email,
      subject: trialEndingSubject(endDate),
      variables,
      headers: gate.headers,
    });
    if (!res.ok) {
      result.errors++;
      result.failures.push({ userId: profile.id, status: res.status, error: res.error });
      deps.log(`[cron/trial-ending] send failed for user ${profile.id}: ${res.status ?? "n/a"}`);
      continue;
    }
    result.sent++;
    if (!(await deps.logSent(profile.id))) {
      result.errors++;
      result.logWriteFailures++;
      result.failures.push({ userId: profile.id, error: "sent, but the email_log row did not save" });
      deps.log(`[cron/trial-ending] sent to user ${profile.id}, email_log write FAILED`);
      continue;
    }
    deps.log(`[cron/trial-ending] sent to user ${profile.id}`);
  }

  return result;
}
