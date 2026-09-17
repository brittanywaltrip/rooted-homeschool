/**
 * Keep the Resend audience that on-purpose emails (Resend Broadcasts) go to
 * matching Rooted's own records. app/api/cron/sync-audience/route.ts wires the
 * real reads and writes; everything with a side effect is passed in, so
 * node --test runs the whole decision with fakes.
 *
 * Three steps, in this order, and the order matters:
 *
 * 1. PULL, the safety direction. Every Resend contact with unsubscribed: true
 *    whose address belongs to a Rooted family sets that family's
 *    profiles.email_unsubscribed to true. That is how a click on a broadcast's
 *    unsubscribe footer becomes a fact the whole app respects (the weekly
 *    summary, the win-back, everything behind canSendMarketingEmail).
 *
 *    NEVER THE REVERSE. A contact that is subscribed in Resend must never clear
 *    email_unsubscribed on a profile, and this job never sets a Resend contact
 *    back to subscribed either. Opting out is one-way, in both systems. If you
 *    are here to "resync" someone who wants email again: that is the family's
 *    choice to make in the app, not this job's.
 *
 * 2. PUSH. The eligible families (onboarded, active in the weekly summary's
 *    sense, not unsubscribed, marketing not turned off, not suppressed, not an
 *    internal account) are put in the audience with a usable first name. A new
 *    address is created subscribed; an existing contact is only added to the
 *    segment and has its name corrected. An existing contact that is already
 *    unsubscribed is left exactly as it is.
 *
 * 3. CLOSE THE GAP. A contact in the audience who is no longer eligible is
 *    taken OUT OF THE SEGMENT. It is not deleted (that would lose the record of
 *    who opted out, and a later re-add would quietly resubscribe them) and it
 *    is not marked unsubscribed: Resend's `unsubscribed` is global, so marking
 *    a family who merely went quiet would come back through step 1 the next
 *    day as an opt-out and switch off every email Rooted sends them. Keeping
 *    `unsubscribed: true` for real opt-outs only is what makes step 1 safe.
 *
 * Every read fails closed: a list that did not load means nothing is written.
 */

import { audienceFirstName } from "./audience-name.ts";
import type { ResendContact, ResendResult } from "./resend-contacts.ts";
import { WEEKLY_AUDIENCE_DAYS } from "./weekly-summary.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const AUDIENCE_ENV_VAR = "RESEND_ACTIVE_AUDIENCE_ID";
/** Additions and name fixes per run. Removals are not budgeted: they are the safety step. */
export const MAX_AUDIENCE_WRITES_PER_RUN = 1000;
/** Refuse to empty most of a real audience in one run; a bad read looks exactly like that. */
export const MAX_REMOVAL_FRACTION = 0.5;
export const REMOVAL_GUARD_MIN_AUDIENCE = 20;

// ─── "Active", exactly as the weekly summary means it ─────────────────────────

/**
 * The first date that counts as active: WEEKLY_AUDIENCE_DAYS back, as the
 * yyyy-mm-dd string app/api/cron/weekly-summary/route.ts compares against.
 */
export function audienceSince(now: Date): string {
  return new Date(now.getTime() - WEEKLY_AUDIENCE_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The weekly summary's audience rule: a completed lesson with a scheduled_date,
 * or a memory with a date, on or after `since` (the reads filter the dates; a
 * row missing either field does not count).
 */
export function activeUserIdsFrom(
  lessons: readonly { user_id: string | null; scheduled_date: string | null }[],
  memories: readonly { user_id: string | null; date: string | null }[],
): Set<string> {
  const out = new Set<string>();
  for (const l of lessons) if (l.user_id && l.scheduled_date) out.add(l.user_id);
  for (const m of memories) if (m.user_id && m.date) out.add(m.user_id);
  return out;
}

// ─── The sync ─────────────────────────────────────────────────────────────────

export type AudienceFamily = {
  userId: string;
  email: string;
  firstName: string | null;
  displayName: string | null;
  onboarded: boolean | null;
  emailUnsubscribed: boolean | null;
  emailMarketing: boolean | null;
};

export interface AudienceSyncDeps {
  dry?: boolean;
  segmentId: string;
  maxWrites?: number;
  listAllContacts: () => Promise<ResendContact[] | null>;
  listSegmentContacts: (segmentId: string) => Promise<ResendContact[] | null>;
  /** Every family with a login email and its profile flags. Null when a read failed. */
  loadFamilies: () => Promise<AudienceFamily[] | null>;
  /** activeUserIdsFrom over the weekly summary's two reads. Null when a read failed. */
  loadActiveUserIds: () => Promise<Set<string> | null>;
  suppressed: ReadonlySet<string>;
  isInternalEmail: (email: string) => boolean;
  /** Set email_unsubscribed = true for these families (never false). False when the write failed. */
  markUnsubscribed: (families: AudienceFamily[]) => Promise<boolean>;
  createContact: (args: { email: string; firstName: string; segmentId: string }) => Promise<ResendResult>;
  updateContactName: (contactId: string, firstName: string) => Promise<ResendResult>;
  addToSegment: (contactId: string, segmentId: string) => Promise<ResendResult>;
  removeFromSegment: (contactId: string, segmentId: string) => Promise<ResendResult>;
  log: (line: string) => void;
}

export type AudienceSyncResult = {
  audienceSize: number;
  pulledUnsubscribes: number;
  pushedNew: number;
  pushedUpdated: number;
  markedIneligible: number;
  errors: number;
  dry: boolean;
  /** Eligible in Rooted, but already unsubscribed in Resend: left alone. */
  skippedOptedOut: number;
  /** Eligible families not reached this run because the write budget ran out. */
  deferred: number;
  /** The removal guard tripped and no one was taken out of the audience. */
  removalGuardTripped: boolean;
  failures: { userId?: string; step: string; status?: number; error?: string }[];
};

const lower = (s: string) => s.trim().toLowerCase();

export function isEligible(
  f: AudienceFamily,
  active: ReadonlySet<string>,
  suppressed: ReadonlySet<string>,
  isInternalEmail: (email: string) => boolean,
): boolean {
  return (
    f.onboarded === true &&
    active.has(f.userId) &&
    f.emailUnsubscribed !== true &&
    f.emailMarketing !== false &&
    !suppressed.has(lower(f.email)) &&
    !isInternalEmail(f.email)
  );
}

export async function runAudienceSync(deps: AudienceSyncDeps): Promise<AudienceSyncResult> {
  const dry = !!deps.dry;
  const maxWrites = deps.maxWrites ?? MAX_AUDIENCE_WRITES_PER_RUN;
  const result: AudienceSyncResult = {
    audienceSize: 0, pulledUnsubscribes: 0, pushedNew: 0, pushedUpdated: 0, markedIneligible: 0,
    errors: 0, dry, skippedOptedOut: 0, deferred: 0, removalGuardTripped: false, failures: [],
  };
  const fail = (step: string, extra: { userId?: string; status?: number; error?: string } = {}) => {
    result.errors++;
    result.failures.push({ step, ...extra });
  };

  const [allContacts, segment, loadedFamilies, active] = await Promise.all([
    deps.listAllContacts(),
    deps.listSegmentContacts(deps.segmentId),
    deps.loadFamilies(),
    deps.loadActiveUserIds(),
  ]);
  if (!allContacts || !segment || !loadedFamilies || !active) {
    fail("read", { error: "a list did not load; nothing was changed" });
    deps.log("[cron/sync-audience] read failed, nothing changed");
    return result;
  }
  result.audienceSize = segment.length;

  // Copies: a dry run applies step 1 to these in memory only.
  const families = loadedFamilies.map((f) => ({ ...f }));
  const familyByEmail = new Map<string, AudienceFamily>();
  for (const f of families) familyByEmail.set(lower(f.email), f);
  const contactByEmail = new Map<string, ResendContact>();
  for (const c of allContacts) if (c.email) contactByEmail.set(lower(c.email), c);

  // ── 1. Pull. Only ever true. ───────────────────────────────────────────────
  const toMark: AudienceFamily[] = [];
  for (const c of allContacts) {
    if (c.unsubscribed !== true || !c.email) continue;
    const f = familyByEmail.get(lower(c.email));
    // A subscribed contact is skipped above, deliberately: it never clears a
    // profile's email_unsubscribed. Opting out is one-way.
    if (f && f.emailUnsubscribed !== true) toMark.push(f);
  }
  result.pulledUnsubscribes = toMark.length;
  if (toMark.length > 0) {
    if (dry) {
      for (const f of toMark) deps.log(`[cron/sync-audience] DRY would mark user ${f.userId} unsubscribed`);
    } else if (!(await deps.markUnsubscribed(toMark))) {
      // Stop before pushing: an opt-out that did not save must not be followed
      // by anything that could reach that family.
      fail("pull", { error: "profile write failed; push and gap skipped" });
      deps.log("[cron/sync-audience] unsubscribe write failed, push and gap skipped");
      return result;
    } else {
      for (const f of toMark) deps.log(`[cron/sync-audience] marked user ${f.userId} unsubscribed (from Resend)`);
    }
    for (const f of toMark) f.emailUnsubscribed = true;
  }

  // ── 2. Push. ───────────────────────────────────────────────────────────────
  const eligible = families
    .filter((f) => isEligible(f, active, deps.suppressed, deps.isInternalEmail))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const eligibleEmails = new Set(eligible.map((f) => lower(f.email)));
  const inSegment = new Set(segment.filter((c) => c.email).map((c) => lower(c.email)));

  let writes = 0;
  let joined = 0;
  for (const f of eligible) {
    const email = lower(f.email);
    const name = audienceFirstName(f.firstName, f.displayName);
    const existing = contactByEmail.get(email);

    if (existing?.unsubscribed === true) {
      // Never resubscribe. This is a real opt-out that step 1 could not tie to
      // this family (it would otherwise not be eligible).
      result.skippedOptedOut++;
      continue;
    }

    const needsJoin = !existing || !inSegment.has(email);
    const needsName = !!existing && (existing.first_name ?? "") !== name;
    const cost = (needsJoin ? 1 : 0) + (needsName ? 1 : 0);
    if (cost === 0) continue;
    if (writes + cost > maxWrites) { result.deferred++; continue; }
    writes += cost;

    if (dry) {
      if (needsJoin) { result.pushedNew++; joined++; }
      if (needsName) result.pushedUpdated++;
      deps.log(`[cron/sync-audience] DRY would ${needsJoin ? "add" : "rename"} user ${f.userId}`);
      continue;
    }

    if (!existing) {
      const res = await deps.createContact({ email, firstName: name, segmentId: deps.segmentId });
      if (res.ok) { result.pushedNew++; joined++; } else fail("create", { userId: f.userId, status: res.status, error: res.error });
      continue;
    }
    if (needsJoin) {
      const res = await deps.addToSegment(existing.id, deps.segmentId);
      if (res.ok) { result.pushedNew++; joined++; } else fail("add", { userId: f.userId, status: res.status, error: res.error });
    }
    if (needsName) {
      const res = await deps.updateContactName(existing.id, name);
      if (res.ok) result.pushedUpdated++; else fail("rename", { userId: f.userId, status: res.status, error: res.error });
    }
  }

  // ── 3. Close the gap: out of the segment, never deleted, never unsubscribed. ─
  const leaving = segment.filter((c) => !c.email || !eligibleEmails.has(lower(c.email)));
  if (
    segment.length >= REMOVAL_GUARD_MIN_AUDIENCE &&
    leaving.length > segment.length * MAX_REMOVAL_FRACTION
  ) {
    result.removalGuardTripped = true;
    fail("gap", { error: `would remove ${leaving.length} of ${segment.length}; refused` });
    deps.log(`[cron/sync-audience] removal guard: ${leaving.length} of ${segment.length} would leave, none removed`);
  } else {
    for (const c of leaving) {
      const userId = c.email ? familyByEmail.get(lower(c.email))?.userId : undefined;
      if (dry) {
        result.markedIneligible++;
        deps.log(`[cron/sync-audience] DRY would remove ${userId ? `user ${userId}` : `contact ${c.id}`} from the audience`);
        continue;
      }
      const res = await deps.removeFromSegment(c.id, deps.segmentId);
      if (res.ok) result.markedIneligible++;
      else fail("remove", { userId, status: res.status, error: res.error });
    }
  }

  result.audienceSize = segment.length + joined - result.markedIneligible;
  return result;
}
