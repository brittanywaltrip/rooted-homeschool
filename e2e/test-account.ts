/* ============================================================================
 * The one account the e2e suite is allowed to touch.
 *
 * WHY THIS FILE EXISTS
 * Until 2026-08-03 the suite authenticated as brittanywaltrip20@gmail.com,
 * which is not a test account at all: it is the founder's real family
 * ("The Waltrip Family", user 033760b9…, one child, a live Good and the
 * Beautiful Math 3 curriculum). The heavy Schedule Builder specs save through
 * phase 2, which re-spreads EVERY curriculum row in the builder, so each run
 * deleted and re-created the forward half of a real family's schedule. On
 * 2026-08-03 that happened repeatedly in one afternoon: 87 of the 120 lesson
 * rows on goal 4193f9b3 were re-created in a single day.
 *
 * The credentials live in env, so a stale .env.local, a wrong CI secret, or a
 * copy-pasted shell export could point the suite back at a real family without
 * anyone noticing until their calendar moved. Env alone cannot be the safety
 * mechanism. This module is the mechanism: global-setup resolves the id of
 * whoever actually logged in and aborts the entire run unless it is exactly
 * E2E_USER_ID.
 *
 * TO ROTATE THE TEST ACCOUNT: provision the new one, then change E2E_USER_ID
 * here in the same commit as the env change. There is deliberately no env var
 * for it — an env-configurable allowlist would reintroduce the hole this
 * closes.
 * ==========================================================================*/

/** rooted.e2e@rootedhomeschoolapp.com — "Rooted E2E", free tier, one child. */
export const E2E_USER_ID = 'a7011926-149e-42d1-9dde-e55b16059859';

export const E2E_EMAIL = 'rooted.e2e@rootedhomeschoolapp.com';

/**
 * Accounts that must NEVER be driven by the suite, named explicitly so the
 * failure message can say what went wrong instead of just "wrong id". The
 * E2E_USER_ID equality check above already excludes these; this list exists
 * to make the common accident legible, and to keep the historical incident
 * attached to the id it happened to.
 */
export const NEVER_TOUCH_USER_IDS: Record<string, string> = {
  '033760b9-51fc-4db2-b34a-2fafd6501be2':
    "Brittany's real family account (The Waltrip Family, brittanywaltrip20@gmail.com). " +
    'The suite ran as this account until 2026-08-03 and re-flowed its live Math 3 schedule.',
  'd18ca881-a776-4e82-b145-832adc88a88a': 'Brittany (founder/admin account).',
  'b21d333a-17ec-4fd7-b1a6-00878f5894f5': 'Chris (founder/admin account).',
  'a182a9bc-e4dd-4523-a85b-0f7718be026b': 'Sarah Parker internal account.',
};

/**
 * Throw unless `userId` is the designated test account. Fail-closed: a null or
 * unresolvable id aborts too, because "we could not tell whose account this is"
 * is exactly when a destructive suite must not proceed.
 */
export function assertIsTestAccount(userId: string | null | undefined, context: string): void {
  if (!userId) {
    throw new Error(
      `[${context}] REFUSING TO RUN: could not resolve the signed-in user id. ` +
        `The e2e suite only runs as ${E2E_EMAIL} (${E2E_USER_ID}). ` +
        'Fail-closed by design: an unidentified account may be a real family.',
    );
  }
  if (userId === E2E_USER_ID) return;

  const known = NEVER_TOUCH_USER_IDS[userId];
  throw new Error(
    `[${context}] REFUSING TO RUN: signed in as ${userId}, which is not the e2e test account.\n` +
      (known ? `  That id is: ${known}\n` : '') +
      `  Expected ${E2E_USER_ID} (${E2E_EMAIL}).\n` +
      '  These specs create, re-spread and DELETE curriculum data. Point PLAYWRIGHT_EMAIL /\n' +
      '  PLAYWRIGHT_PASSWORD at the test account, or update E2E_USER_ID in e2e/test-account.ts\n' +
      '  if the test account itself was rotated.',
  );
}
