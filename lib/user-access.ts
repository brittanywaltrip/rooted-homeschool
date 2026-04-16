/**
 * Rooted user access levels:
 * - 'pro'   → paying subscriber (is_pro = true)
 * - 'trial' → within 30-day trial (has full pro access)
 * - 'free'  → trial expired, not paying
 */
export type AccessLevel = 'pro' | 'trial' | 'free';

export const TRIAL_DAYS = 30;

export function getUserAccess(profile: {
  is_pro?: boolean | null;
  trial_started_at?: string | null;
}): AccessLevel {
  // Paying user always gets pro
  if (profile.is_pro) return 'pro';

  // Check trial
  if (profile.trial_started_at) {
    const trialStart = new Date(profile.trial_started_at);
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
    if (new Date() < trialEnd) return 'trial';
  }

  return 'free';
}

export function getTrialDaysLeft(trialStartedAt: string | null | undefined): number {
  if (!trialStartedAt) return 0;
  const trialStart = new Date(trialStartedAt);
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
  const diff = trialEnd.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Quick boolean checks */
export function canExport(profile: { is_pro?: boolean | null; trial_started_at?: string | null }): boolean {
  return getUserAccess(profile) !== 'free';
}

export function canShareFamily(profile: { is_pro?: boolean | null; trial_started_at?: string | null }): boolean {
  return getUserAccess(profile) !== 'free';
}

export function canUploadUnlimitedPhotos(profile: { is_pro?: boolean | null; trial_started_at?: string | null }): boolean {
  return getUserAccess(profile) !== 'free';
}
