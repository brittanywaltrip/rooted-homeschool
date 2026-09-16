/**
 * Sharing a resource: its public link, the line that goes with it, the public
 * page's lookup and metadata, and the signup handoff from that page.
 *
 * A resource's link is https://rootedhomeschoolapp.com/r/<slug>, where the slug
 * is `metadata.slug` when an admin set one and the row's id otherwise, so every
 * resource is shareable from the day it is added.
 *
 * Pure: no React, no Supabase, no "@/" imports, so node --test runs it directly
 * and the card, the admin form, the public page and signup share one rule.
 */

export const RESOURCE_SHARE_ORIGIN = "https://rootedhomeschoolapp.com";
export const RESOURCE_SLUG_MIN = 3;
export const RESOURCE_SLUG_MAX = 40;

const SLUG_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Why a typed slug is not usable, or null when it is (including empty, since
 * the slug is optional). A uuid-shaped slug is refused: /r/<uuid> means "the
 * row with that id", and a slug that looked like one could shadow a real row.
 */
export function validateResourceSlug(value: string): string | null {
  const s = value.trim();
  if (s.length === 0) return null;
  if (s.length < RESOURCE_SLUG_MIN || s.length > RESOURCE_SLUG_MAX) {
    return `Use ${RESOURCE_SLUG_MIN} to ${RESOURCE_SLUG_MAX} characters.`;
  }
  if (!SLUG_RE.test(s)) return "Use lowercase letters, numbers and hyphens only.";
  if (isUuid(s)) return "That looks like an id. Pick a word or two instead.";
  return null;
}

/** The stored slug, or null when there is none or it is not a valid one. */
export function resourceSlug(metadata: unknown): string | null {
  const raw = (metadata as { slug?: unknown } | null | undefined)?.slug;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || validateResourceSlug(s) !== null) return null;
  return s;
}

/** What goes after /r/: the slug when set, the id otherwise. */
export function resourceShareKey(r: { id: string; metadata?: unknown }): string {
  return resourceSlug(r.metadata) ?? r.id;
}

export function resourceShareUrl(key: string): string {
  return `${RESOURCE_SHARE_ORIGIN}/r/${encodeURIComponent(key)}`;
}

/** The line a family sends. Rooted's name is in it on purpose. */
export function resourceShareText(title: string): string {
  return `${title}, free from Rooted Homeschool App`;
}

/** What goes on the clipboard when the device cannot open a share sheet. */
export function resourceCopyText(title: string, key: string): string {
  return `${resourceShareText(title)} ${resourceShareUrl(key)}`;
}

type SlugRow = { id: string; active?: boolean | null; metadata?: unknown };

/**
 * The active resource that already uses this slug, other than `selfId`, or
 * null. Only active rows count: a retired pack keeps its slugs in the column,
 * and a new pack should be able to reuse them.
 */
export function findSlugConflict(slug: string, rows: SlugRow[], selfId: string | null): SlugRow | null {
  const want = slug.trim();
  if (!want) return null;
  return (
    rows.find((r) => r.id !== selfId && r.active !== false && resourceSlug(r.metadata) === want) ?? null
  );
}

// ─── The public page ──────────────────────────────────────────────────────────

export type SharedResource = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  grade_level: string | null;
  metadata: unknown;
  active: boolean | null;
};

/**
 * Resolve /r/<param>: by slug first, then by id when the param is a uuid.
 * Inactive rows are refused here as well as in the query, because a signed-in
 * reader's RLS lets them see inactive rows and the page must not depend on who
 * is looking.
 */
export async function findSharedResource(
  param: string,
  lookup: {
    bySlug: (slug: string) => Promise<SharedResource | null>;
    byId: (id: string) => Promise<SharedResource | null>;
  },
): Promise<SharedResource | null> {
  const key = decodeSafe(param).trim();
  if (!key) return null;
  if (validateResourceSlug(key) === null) {
    const row = await lookup.bySlug(key);
    if (row && row.active === true) return row;
  }
  if (isUuid(key)) {
    const row = await lookup.byId(key.toLowerCase());
    if (row && row.active === true) return row;
  }
  return null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** An internal link ("/dashboard/..."), which a logged-out friend cannot open directly. */
export function isInternalResourceUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

/**
 * A same-site path, or null. Used for the `next` a shared page hands to signup:
 * anything that could leave the site (a scheme, "//host", a backslash trick) or
 * carries control characters is refused.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return null;
  if (s.length > 300) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  // Resolve against a throwaway origin and make sure it stayed there.
  try {
    const u = new URL(s, "https://rooted.invalid");
    if (u.origin !== "https://rooted.invalid") return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export function landingSignupHref(key: string, next?: string | null): string {
  const p = new URLSearchParams({ from: "share", r: key });
  const safe = safeNextPath(next ?? null);
  if (safe) p.set("next", safe);
  return `/signup?${p.toString()}`;
}

/** The share card for a resource: its own picture when it has one, else the generated one. */
export function resourceOgImage(r: { title: string; subject: string | null; image: string | null }): string {
  if (r.image) return r.image;
  const p = new URLSearchParams({ kind: "resource", title: r.title });
  if (r.subject) p.set("subject", r.subject);
  return `/api/og?${p.toString()}`;
}

/** The page's <head>. Absolute title: the root layout's template would add the suffix a second time. */
export function resourcePageMetadata(r: { title: string; description: string | null; subject: string | null; image: string | null }) {
  const title = `${r.title} | Rooted Homeschool App`;
  const description = r.description?.trim() || resourceShareText(r.title);
  const image = resourceOgImage(r);
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, type: "website" as const, siteName: "Rooted Homeschool App", images: [image] },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] },
  };
}

// ─── The signup handoff ───────────────────────────────────────────────────────

export const SHARE_SOURCE_STORAGE_KEY = "rooted_share_source";

export type ShareSource = { from: string; r: string | null; next: string | null };

/**
 * `?from=share&r=leaf-hunt&next=/dashboard/...` on /signup, checked. Null when
 * there is no `from`. `r` must be a slug or an id; `next` a same-site path.
 */
export function parseShareSource(params: { get: (k: string) => string | null }): ShareSource | null {
  const from = (params.get("from") ?? "").trim();
  if (!/^[a-z_]{1,24}$/.test(from)) return null;
  const rRaw = (params.get("r") ?? "").trim();
  const r = rRaw && (validateResourceSlug(rRaw) === null || isUuid(rRaw)) ? rRaw : null;
  return { from, r, next: safeNextPath(params.get("next")) };
}

/** The properties the signup event carries. Empty when the family did not come from a share. */
export function shareSourceEventProps(source: ShareSource | null): { from?: string; r?: string } {
  if (!source) return {};
  return { from: source.from, ...(source.r ? { r: source.r } : {}) };
}

/** Read back what signup stored, defensively (it came out of localStorage). */
export function readShareSource(raw: string | null): ShareSource | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const get = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
    return parseShareSource({ get });
  } catch {
    return null;
  }
}
