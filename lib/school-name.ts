/**
 * The name that appears at the top of a family's printables.
 *
 * SOURCE OF TRUTH: profiles.display_name, saved from the "Family name" field
 * in Settings. Families type a complete name there ("The Waltrip Family",
 * "Oak & Acorn Schoolhouse"), so it is rendered VERBATIM. Nothing is appended,
 * prepended, or title-cased.
 *
 * Printables used to render `${display_name} Academy`, which turned
 * "The Waltrip Family" into "The Waltrip Family Academy" on every ID card and
 * certificate. Do not reintroduce a suffix here or at any call site.
 *
 * When display_name is empty the fallback is "The {last_name} Family", never
 * "{last_name} Academy". With no last name either, this returns "" and the
 * caller is expected to omit the line entirely rather than print a placeholder.
 */
export function schoolNameFor(
  displayName?: string | null,
  lastName?: string | null,
): string {
  const name = (displayName ?? "").trim();
  if (name) return name;

  const last = (lastName ?? "").trim();
  if (last) return `The ${last} Family`;

  return "";
}
