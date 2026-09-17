/**
 * A small client for Resend's contacts API, for the audience sync
 * (app/api/cron/sync-audience). Never sends an email.
 *
 * The API as checked on 2026-09-16 (docs, and the resend@6.28.1 SDK source):
 *   - Audiences are now "segments", and an audience id is a segment id: the
 *     SDK sends `audienceId` to the same /segments/{id}/contacts path.
 *   - Contacts are global to the account. `unsubscribed` is the contact's
 *     GLOBAL broadcast status ("unsubscribed from all Broadcasts").
 *   - GET  /contacts                          every contact, paged
 *   - GET  /segments/{id}/contacts            the contacts in one segment, paged
 *       paging: `limit` (max 100) and `after` (an id), response
 *       { object: "list", has_more, data: [{ id, email, first_name, last_name,
 *       created_at, unsubscribed }] }
 *   - POST /contacts                          { email, first_name, last_name,
 *                                             unsubscribed, segments: [{ id }] }
 *   - PATCH /contacts/{id or email}           { first_name, last_name, unsubscribed }
 *   - POST   /contacts/{id or email}/segments/{segment_id}   add to a segment
 *   - DELETE /contacts/{id or email}/segments/{segment_id}   remove from it
 *       (the contact itself is kept)
 *
 * A 429 is retried with backoff (Retry-After when Resend sends one) instead of
 * failing the run, and every call is paced, since Resend limits per second.
 *
 * Pure apart from the injected fetch: no "@/" imports, so node --test runs it.
 */

export const RESEND_API = "https://api.resend.com";
export const CONTACTS_PAGE_SIZE = 100;

export type ResendContact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
};

export type ResendResult = { ok: boolean; status: number; json: unknown; error?: string };

export interface ResendContactsOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts for a 429 before giving up on that one call. */
  maxAttempts?: number;
  /** Minimum gap between calls, in ms. */
  paceMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createResendContactsClient(opts: ResendContactsOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const maxAttempts = opts.maxAttempts ?? 6;
  const paceMs = opts.paceMs ?? 150;
  let lastCall = 0;

  async function request(method: string, path: string, body?: unknown): Promise<ResendResult> {
    for (let attempt = 1; ; attempt++) {
      const wait = lastCall + paceMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();

      let res: Response;
      try {
        res = await doFetch(`${RESEND_API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        return { ok: false, status: 0, json: null, error: err instanceof Error ? err.message : String(err) };
      }

      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** (attempt - 1), 16_000);
        await sleep(backoff);
        continue;
      }

      const text = await res.text().catch(() => "");
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!res.ok) {
        const message = (json as { message?: string } | null)?.message ?? text.slice(0, 200);
        return { ok: false, status: res.status, json, error: message };
      }
      return { ok: true, status: res.status, json };
    }
  }

  /** Every page of a list endpoint. Null when any page fails: half a list is not a list. */
  async function listAll(basePath: string): Promise<ResendContact[] | null> {
    const out: ResendContact[] = [];
    let after: string | null = null;
    for (;;) {
      const q = new URLSearchParams({ limit: String(CONTACTS_PAGE_SIZE) });
      if (after) q.set("after", after);
      const res = await request("GET", `${basePath}?${q.toString()}`);
      if (!res.ok) return null;
      const page = res.json as { data?: ResendContact[]; has_more?: boolean } | null;
      const rows = page?.data ?? [];
      out.push(...rows);
      if (!page?.has_more || rows.length === 0) break;
      after = rows[rows.length - 1].id;
    }
    return out;
  }

  const enc = encodeURIComponent;

  return {
    request,
    /** Every contact on the account. */
    listContacts: () => listAll("/contacts"),
    /** The contacts in one segment (what the dashboard still calls an audience). */
    listSegmentContacts: (segmentId: string) => listAll(`/segments/${enc(segmentId)}/contacts`),
    /** A new contact, subscribed, in the segment. */
    createContact: (args: { email: string; firstName: string; segmentId: string }) =>
      request("POST", "/contacts", {
        email: args.email,
        first_name: args.firstName,
        unsubscribed: false,
        segments: [{ id: args.segmentId }],
      }),
    /**
     * Update a contact. `unsubscribed` can only be set to true here, never back
     * to false: opting out is one-way, and the only place a contact is created
     * subscribed is createContact, for an address Resend has never seen.
     */
    updateContact: (idOrEmail: string, patch: { firstName?: string; unsubscribed?: true }) =>
      request("PATCH", `/contacts/${enc(idOrEmail)}`, {
        ...(patch.firstName !== undefined ? { first_name: patch.firstName } : {}),
        ...(patch.unsubscribed ? { unsubscribed: true } : {}),
      }),
    addToSegment: (idOrEmail: string, segmentId: string) =>
      request("POST", `/contacts/${enc(idOrEmail)}/segments/${enc(segmentId)}`),
    /** Takes the contact out of the segment. The contact and its history stay. */
    removeFromSegment: (idOrEmail: string, segmentId: string) =>
      request("DELETE", `/contacts/${enc(idOrEmail)}/segments/${enc(segmentId)}`),
  };
}

export type ResendContactsClient = ReturnType<typeof createResendContactsClient>;
