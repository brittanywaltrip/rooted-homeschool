const ADMIN_EMAILS = new Set([
  'garfieldbrittany@gmail.com',
  'christopherwaltrip@gmail.com',
  'hello@rootedhomeschoolapp.com',
])

export function canReadAffiliateStats(
  user: { id: string; email?: string | null },
  affiliateOwnerId: string | null,
): boolean {
  return (affiliateOwnerId !== null && user.id === affiliateOwnerId) || ADMIN_EMAILS.has(user.email ?? '')
}
