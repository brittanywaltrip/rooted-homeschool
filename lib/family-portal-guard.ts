// Guards for the two public, token-only family portal write routes:
// app/api/family/[token]/comment and app/api/family/[token]/react.
//
// WHAT THESE CLOSE
//
// A safety audit on 2026-09-09 came back clean on everything structural: RLS on
// every table, private storage buckets scoped to the owner's folder, the
// service role key server-only, photos as one-hour signed URLs, and family
// links as revocable random UUID tokens. Two small things were left, both in
// these routes, and both are here:
//
//   1. OWNERSHIP. Both routes validated the token and then trusted the
//      memory_id the caller sent with it. A viewer holding any valid link who
//      knew another family's memory UUID could hang a comment or a reaction on
//      it. Nobody has: at the time of writing, production holds 0 comments and
//      0 reactions whose memory belongs to a different family than the token
//      used to write them. It is one query to make that stay true.
//
//   2. VOLUME. Both routes are public and unauthenticated apart from the
//      token, and every comment and reaction sends the mother a notification
//      row AND an email. A link that leaks, or one viewer behaving badly, could
//      fill her inbox. Nothing rate-limited them.
//
// Everything here takes the client as an argument rather than importing
// supabaseAdmin, which is what makes it testable: `node --test` cannot load the
// route modules themselves (they import `next/server` and use the `@/` alias,
// neither of which Node's resolver handles), so the decisions have to live
// somewhere Node can reach. See lib/family-portal-guard.test.ts.

// The Supabase surface these guards actually use.
//
// Declared as interfaces rather than type aliases on purpose. The real client
// is SupabaseClient<Database>, whose query builder is generic over every table
// and column in lib/database.types.ts; checking that against a self-referential
// type alias (eq returns the same type, which returns the same type) makes
// tsc give up with "Type instantiation is excessively deep". Interfaces are
// resolved lazily and the same shape checks fine.

export interface QueryOutcome {
  data?: unknown;
  count?: number | null;
  error?: { message?: string } | null;
}

export interface FamilyPortalQuery extends PromiseLike<QueryOutcome> {
  eq(column: string, value: unknown): FamilyPortalQuery;
  gt(column: string, value: unknown): FamilyPortalQuery;
  maybeSingle(): PromiseLike<QueryOutcome>;
}

interface FamilyPortalTable {
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): FamilyPortalQuery;
}

export interface FamilyPortalClient {
  from(table: string): FamilyPortalTable;
}

/**
 * Hand supabaseAdmin to the guards below.
 *
 * It satisfies FamilyPortalClient at runtime, but not to tsc's satisfaction:
 * SupabaseClient's query builder is generic over every table and column in the
 * schema, and checking that against the minimal shape above makes the checker
 * give up with TS2589, "Type instantiation is excessively deep and possibly
 * infinite". One documented adapter beats a cast at every call site, and it
 * keeps the shape above real enough that the test fake is checked against it.
 */
export function asFamilyPortalClient(client: unknown): FamilyPortalClient {
  return client as FamilyPortalClient;
}

export type MemoryOwnershipRow = {
  id: string;
  user_id: string | null;
  family_visible: boolean | null;
};

/** The two tables a family viewer can write to. */
export type FamilyActionTable = "memory_comments" | "memory_reactions";

/**
 * The memory this action names, but only if the invite's owner is allowed to
 * be acted on through it. Null means "answer 404 and write nothing".
 *
 * Two conditions, both required:
 *
 *   user_id === ownerUserId    the memory belongs to the family whose link
 *                              this is. This is the ownership hole.
 *
 *   family_visible === true    the memory is actually in the portal feed.
 *                              lib/family-feed.ts selects `.eq("family_visible",
 *                              true)`, so a row that is false, or NULL, is not
 *                              something the viewer can see and therefore not
 *                              something they can have meant to react to. Note
 *                              this is deliberately stricter than mom's own
 *                              Memories page, which reads `!== false` when it
 *                              labels a memory visible. The feed is the right
 *                              reference here because the feed is what the
 *                              viewer is looking at. As of 2026-09-09 every one
 *                              of the 1,681 production memories is true, so
 *                              this changes nothing for anybody today.
 *
 * A query error also returns null. Failing closed on a route that writes to
 * someone else's account is the only safe direction.
 */
export async function assertMemoryBelongsToInvite(
  client: FamilyPortalClient,
  memoryId: string,
  ownerUserId: string,
): Promise<MemoryOwnershipRow | null> {
  const result = await client
    .from("memories")
    .select("id, user_id, family_visible")
    .eq("id", memoryId)
    .maybeSingle();

  if (result.error) return null;
  const row = result.data as MemoryOwnershipRow | null | undefined;
  if (!row) return null;
  if (row.user_id !== ownerUserId) return null;
  if (row.family_visible !== true) return null;
  return row;
}

/**
 * Would this write take the token past `max` rows in `table` in the last
 * `windowMinutes`?
 *
 * Scoped to the token rather than to the family, so one viewer who misbehaves
 * cannot silence the grandparent reading the same feed on another link.
 *
 * A query error returns false, not true. This limiter protects an inbox, not
 * an account, and a database hiccup must not take the family portal down for
 * everybody; the ownership check above is the one that fails closed.
 *
 * Real production volume for context, measured 2026-09-09 over every comment
 * and reaction ever written: the busiest ten minutes on any single token was 3
 * comments and 15 reactions.
 */
export async function tooManyFamilyActions(
  client: FamilyPortalClient,
  token: string,
  table: FamilyActionTable,
  windowMinutes: number,
  max: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const result = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("family_token", token)
    .gt("created_at", since);

  if (result.error) return false;
  // >= because `max` is how many are ALLOWED in the window and the count
  // is taken BEFORE the write: 20 rows already there means this one would be
  // the 21st, which is the one to refuse.
  return (result.count ?? 0) >= max;
}

/**
 * Would this write take one memory past `max` notifications of this type in
 * the last `windowMinutes`?
 *
 * NOT in the original brief, and here because without it the reaction limiter
 * above does not do the job it was asked to do.
 *
 * The react route toggles: a tap on an emoji you already used DELETES the row
 * and returns, and the next tap inserts it again and emails the mother again.
 * So tapping one heart on and off forever sends an email every second tap while
 * `memory_reactions` never holds more than a single row for that viewer, and a
 * limiter that counts rows in a window sees 1 and waves it through. That is the
 * cheapest version of exactly the flood the brief set out to stop.
 *
 * Counting `family_notifications` instead is not bypassable that way, because a
 * notification row is written on every email and nothing deletes it. Scoped per
 * memory so a tap loop on one memory cannot mute reactions on the rest of the
 * feed. Busiest real ten minutes on a single memory, measured 2026-09-09: 4
 * comments and 2 reactions. There are 5 allowed emojis, so even a whole family
 * of viewers exhausting every one of them on one memory stays far under.
 */
export async function tooManyNotificationsForMemory(
  client: FamilyPortalClient,
  memoryId: string,
  type: "comment" | "reaction",
  windowMinutes: number,
  max: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const result = await client
    .from("family_notifications")
    .select("id", { count: "exact", head: true })
    .eq("memory_id", memoryId)
    .eq("type", type)
    .gt("created_at", since);

  if (result.error) return false;
  // >= because `max` is how many are ALLOWED in the window and the count
  // is taken BEFORE the write: 20 rows already there means this one would be
  // the 21st, which is the one to refuse.
  return (result.count ?? 0) >= max;
}

/** Longest a viewer may call themselves. Longest real one on 2026-09-09: 28. */
export const MAX_VIEWER_NAME_LENGTH = 60;

/** True when a submitted commenter_name / reactor_name is too long to accept. */
export function viewerNameTooLong(name: unknown): boolean {
  return typeof name === "string" && name.trim().length > MAX_VIEWER_NAME_LENGTH;
}
