// Shared helper for sending Resend template emails

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

export async function sendResendTemplate(
  to: string,
  templateId: string,
  variables: Record<string, string>,
  from?: string,
  subject?: string,
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    from: from ?? FROM,
    to,
    template_id: templateId,
    template_variables: variables,
  }
  if (subject) payload.subject = subject

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
    return { ok: false, error: err.message ?? JSON.stringify(err) }
  }
  return { ok: true }
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
  // Year in Review (May annual)
  yearInReview: '993681cb-6432-4f62-8843-afdca205af22',
} as const
