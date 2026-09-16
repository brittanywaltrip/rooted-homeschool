/**
 * The optional extras a resource can carry in its existing `metadata` jsonb
 * column: a picture, and a subject tag.
 *
 * No new column, no bucket, no migration. `resources.metadata` has been there
 * all along and the dashboard already selects it; these two keys are the whole
 * contract:
 *
 *   {"image": "/resources/fall/leaf-hunt.webp", "subject": "Science"}
 *
 * Both are read defensively. Anything in a jsonb column can be anything (a
 * number, a nested object, an http:// URL somebody pasted), and a resource card
 * with a broken image or a paragraph where a pill should be is worse than a
 * card with neither, so a value that is not exactly what is expected is ignored
 * rather than rendered.
 *
 * Pure: no React, no Supabase, no "@/" imports, so node --test runs it directly
 * and both the dashboard card and the admin form validate against one rule.
 */

/** Where a resource image may live. Anything else, including an absolute URL, is ignored. */
export const RESOURCE_IMAGE_PREFIX = "/resources/";
// .jpeg included: it is what most photo exports produce, and rejecting it only
// teaches an admin to rename a file for no reason.
export const RESOURCE_IMAGE_EXTENSIONS = [".webp", ".png", ".jpg", ".jpeg"] as const;
export const RESOURCE_SUBJECT_MAX = 24;

/**
 * The image path to render, or null.
 *
 * Local paths only. An http:// URL would send next/image at a remote host that
 * is not in the image config (a runtime 400 on the page), and "..\/" would walk
 * out of public/, so the shape is checked rather than trusted.
 */
export function resourceImagePath(metadata: unknown): string | null {
  const raw = (metadata as { image?: unknown } | null | undefined)?.image;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith(RESOURCE_IMAGE_PREFIX)) return null;
  if (value.includes("..")) return null;
  const lower = value.toLowerCase();
  if (!RESOURCE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;
  return value;
}

/** The subject pill's text, or null. Display only: it filters nothing. */
export function resourceSubject(metadata: unknown): string | null {
  const raw = (metadata as { subject?: unknown } | null | undefined)?.subject;
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0 || value.length > RESOURCE_SUBJECT_MAX) return null;
  return value;
}

/**
 * What the admin form says about an image path as it is typed. Null when the
 * field is fine (including empty, since the picture is optional).
 */
export function validateResourceImagePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith(RESOURCE_IMAGE_PREFIX)) {
    return `Start the path with ${RESOURCE_IMAGE_PREFIX} (a file in public/resources).`;
  }
  if (trimmed.includes("..")) return "Leave out the dots: the path must stay inside public/resources.";
  const lower = trimmed.toLowerCase();
  if (!RESOURCE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `End the file in ${RESOURCE_IMAGE_EXTENSIONS.join(", ")}.`;
  }
  return null;
}

/** What the admin form says about a subject as it is typed. Null when it is fine. */
export function validateResourceSubject(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > RESOURCE_SUBJECT_MAX) {
    return `Keep it to ${RESOURCE_SUBJECT_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * The metadata object to save: whatever the row already had, with these two
 * keys set or removed. Other keys are carried through untouched, because this
 * column belongs to more than this form.
 */
export function withResourceMetadata(
  existing: unknown,
  next: { image?: string; subject?: string },
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  // A key that is not passed is LEFT ALONE. Passing "" is how a caller clears
  // one. The first cut treated "absent" and "empty" the same, so a future
  // caller writing only { subject } would have silently dropped the picture.
  if (next.image !== undefined) {
    const image = next.image.trim();
    if (image) base.image = image;
    else delete base.image;
  }
  if (next.subject !== undefined) {
    const subject = next.subject.trim().replace(/\s+/g, " ");
    if (subject) base.subject = subject;
    else delete base.subject;
  }
  return base;
}

/**
 * The card's outer classes, and its inner padding wrapper.
 *
 * Extracted so "a resource with no picture renders exactly what it always did"
 * is a claim a test can check. This repo has no jsdom, no testing-library and
 * no React test runner (see app/components/updaterPurity.test.ts on why that
 * trade has not been made), so a real DOM snapshot of ResourceCard is not
 * available; pinning the class strings is the honest half of it, and the
 * screenshot spec covers the rest by eye.
 *
 * Without an image the outer element keeps the padding it always had and the
 * inner wrapper adds nothing. With one, the padding moves inside so the picture
 * can run to the card's edges under its rounded top corners.
 */
export const RESOURCE_CARD_BASE_CLASS =
  "bg-white rounded-2xl border border-[#e8e5e0] hover:bg-[#faf9f7] transition-all";

export function resourceCardShellClass(hasImage: boolean): string {
  return `${RESOURCE_CARD_BASE_CLASS} ${hasImage ? "overflow-hidden" : "p-5"}`;
}

export function resourceCardBodyClass(hasImage: boolean): string {
  return hasImage ? "p-5" : "";
}
