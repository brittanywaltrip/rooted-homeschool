/**
 * The first name Rooted hands to its Resend audience, for a broadcast's
 * "Hi {{first_name}}".
 *
 * profiles.first_name holds whatever a family typed at signup, and that is not
 * always a first name: "The", "Mrs", "our family", a single initial. A greeting
 * built on those reads "Hi The," which is worse than no name at all. So a value
 * that is not usable becomes "there", and the greeting reads "Hi there".
 *
 * Not usable: empty or whitespace, shorter than three characters, an email
 * address, or a first word on the stop list (the, mrs, mr, ms, and, our, my,
 * family), case-insensitive and ignoring a trailing period. The display name's
 * first word is tried before giving up.
 *
 * A real first name is left alone even when it is probably the other parent's:
 * that is what the account says, and guessing is worse.
 *
 * Pure: no "@/" imports, so node --test runs it directly.
 */

export const AUDIENCE_NAME_FALLBACK = "there";
const MIN_LENGTH = 3;
const MAX_LENGTH = 50;
const STOP_WORDS = new Set(["the", "mrs", "mr", "ms", "and", "our", "my", "family"]);

function clean(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s\u2028\u2029]+/g, " ").trim();
}

function firstWord(s: string): string {
  return s.split(" ")[0] ?? "";
}

function usable(candidate: string): boolean {
  if (candidate.length < MIN_LENGTH || candidate.length > MAX_LENGTH) return false;
  if (candidate.includes("@")) return false;
  const lead = firstWord(candidate).replace(/[.,]+$/, "").toLowerCase();
  return !STOP_WORDS.has(lead);
}

export function audienceFirstName(
  firstName: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const first = clean(firstName);
  if (usable(first)) return first;
  const fromDisplay = firstWord(clean(displayName)).replace(/[.,]+$/, "");
  if (usable(fromDisplay)) return fromDisplay;
  return AUDIENCE_NAME_FALLBACK;
}
