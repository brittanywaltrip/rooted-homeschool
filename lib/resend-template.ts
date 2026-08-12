// Shared helper for sending Resend template emails

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

/** Email subjects are a single header line, so 150 chars is already generous. */
const SUBJECT_MAX_LENGTH = 150

/**
 * Make a string safe to interpolate into an email subject.
 *
 * Resend rejects the whole send with a 422, "The \n is not allowed in the
 * subject field", if a newline reaches the subject. That is a hard failure:
 * the email is never delivered.
 *
 * The trap is that the subject is not always built here. Several Resend
 * templates interpolate variables into their OWN hosted subject line, so a
 * newline inside an ordinary template variable becomes a newline in the
 * subject without any code in this repo ever concatenating it. That is what
 * killed the reaction email on August 12, 2026: a family titled a memory
 * "Started a new skill\nBoxBollen", and reactionNotification's subject is
 * `{{{reactorName}}} reacted to "{{{memoryTitle}}}" {{{reactionEmoji}}}`.
 *
 * So call this on any value that reaches a subject, whether it is passed as
 * the `subject` argument or as a variable the template puts in its subject.
 * Check the template's real subject before deciding: variables that only
 * appear in the BODY must not be passed through here, or legitimate
 * multi-line content (a comment, a digest list) gets flattened.
 *
 * Collapses every run of whitespace, including newlines, tabs, and Unicode
 * line separators, to a single space, then trims and truncates.
 */
export function sanitizeSubjectText(
  value: string,
  maxLength: number = SUBJECT_MAX_LENGTH,
): string {
  const collapsed = value
    // \s covers \n, \r, \t and friends; \u2028 and \u2029 are the Unicode
    // line and paragraph separators. They are written as escapes on purpose:
    // a raw U+2028 in source is itself a line terminator and breaks the parse.
    .replace(/[\s\u2028\u2029]+/g, ' ')
    .trim()
  if (collapsed.length <= maxLength) return collapsed
  // Trim back to a word boundary when there is one nearby, so the subject
  // does not end mid-word. Falls back to a hard cut.
  const hardCut = collapsed.slice(0, maxLength - 1)
  const lastSpace = hardCut.lastIndexOf(' ')
  const body = lastSpace > maxLength - 25 ? hardCut.slice(0, lastSpace) : hardCut
  return `${body.trimEnd()}…`
}

export async function sendResendTemplate(
  to: string,
  templateId: string,
  variables: Record<string, string>,
  from?: string,
  subject?: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload: Record<string, unknown> = {
    from: from ?? FROM,
    to,
    // Resend's /emails API requires the nested `template: { id, variables }`
    // shape. A flat `template_id` + `template_variables` returns a 422
    // "Missing html or text" (this regression silently killed the
    // re-engagement drip from April to June 2026). Do not flatten this.
    template: {
      id: templateId,
      variables,
    },
  }
  // Defence in depth for callers that build their own subject. Variables the
  // hosted templates drop into their own subject line still have to be
  // sanitized at the call site, since only the caller knows which ones those
  // are (see sanitizeSubjectText).
  if (subject) payload.subject = sanitizeSubjectText(subject)
  if (headers && Object.keys(headers).length > 0) payload.headers = headers

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Unknown error' }))
      console.error('Resend template error:', err)
      return { ok: false, status: res.status, error: err.message ?? JSON.stringify(err) }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

// All Resend template IDs
export const TEMPLATES = {
  // Welcome
  welcomeFree: '39cf0f8b-4316-4afb-a46f-a3d28a6241ef',
  welcomeFounding: 'bb1f8cd9-e823-4061-a128-63341d5e86ff',
  welcomeStandard: 'd326289b-fd9a-4778-9d5a-6fdefc020488',
  // Re-engagement (with unsubscribe links)
  reengagement1: '6bcd32eb-1b86-4a96-8457-384554013b3f',
  reengagement2: 'c5f091f4-3381-47d1-b286-93349803f41b',
  reengagement3: '3f2c5bb5-e7f9-4c07-bad3-25b59219dd26',
  reengagement4: '5d26f9fd-92fb-47fd-af36-ad33d0632dda',
  // Winback (with unsubscribe link)
  winback: '1bcd1b2e-3c08-40fd-bed1-05c01c2bf8f9',
  // Weekly summary
  weeklySummary: 'c3fff265-4d07-4062-b78a-d16626af9c7f',
  // Family
  familyDigest: '1d5d5a36-453f-4f39-b62c-3cdaf59ed7f8',
  trialWarning: '5bf4459b-40bc-4767-92e8-07cb452f2deb',
  familyInvite: '8972ae72-582d-42bf-951c-92d24a6568cc',
  commentNotification: '83c2da26-e476-4de4-9f3c-d79811ff7d9e',
  reactionNotification: 'f3c6c94e-1fae-4afd-bd33-c2f5ead9d2b0',
  // Partner/Affiliate
  affiliateWelcome: '5d4ca0c9-5d93-4002-813d-dd8387310395',
  partnerApplication: '3f6f4123-3875-405f-8bac-0cc873ee06d5',
  // Gifts
  giftReceived: '90e75658-0bc3-4f92-87dc-b18c98207d33',
  giftSent: 'b1b443ce-d51d-415d-bcbe-7a2f63b86323',
} as const
