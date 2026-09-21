import { projectRefFromSupabaseUrl } from '../lib/env-identity.ts';

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

/**
 * The one account the suite may drive, PER SUPABASE PROJECT.
 *
 * Hardcoded, for the reason in the header: there is deliberately no env var,
 * because an env-configurable allowlist would reintroduce the hole this file
 * closes. The project ref below is not configuration either — it is read from
 * the Supabase URL the client is actually connected to, so it can only ever
 * make this guard REFUSE (unknown project, or the other project's account).
 * Nothing in the environment can add an account or relax a check.
 *
 * A project absent from this map has no test account and the suite refuses to
 * run against it. New projects are not implicitly trusted.
 */
export const E2E_ACCOUNTS: Record<string, { id: string; email: string }> = {
  // Production project. "Rooted E2E", free tier, one child.
  // UNCHANGED from the original single pin.
  gvkbegvvmhcrmxdorctk: {
    id: 'a7011926-149e-42d1-9dde-e55b16059859',
    email: 'rooted.e2e@rootedhomeschoolapp.com',
  },
  // rooted-staging. Synthetic project, catalog-cloned 2026-09; it has never
  // held a real family.
  //
  // Provisioned 2026-09-20 as a DEDICATED account rather than reusing one of
  // the seeded @rooted-staging.test families. family-a in particular carries
  // the Leslie-shaped report fixture, and a suite that re-spreads curricula
  // would quietly rewrite the fixture other work reads.
  //
  // It carries the SAME address as the production account above, deliberately.
  // The address is therefore NOT what tells the two projects apart: the project
  // ref is, and that is read from the connection target rather than from
  // configuration. A run pointed at the wrong project fails on the id.
  cvgqovweybggrqakhdtd: {
    id: '1954d827-ac7d-41e8-aeef-f8e07d4337a4',
    email: 'rooted.e2e@rootedhomeschoolapp.com',
  },
};

/** The production pin, still exported so existing importers keep their meaning. */
export const E2E_USER_ID = E2E_ACCOUNTS.gvkbegvvmhcrmxdorctk.id;

export const E2E_EMAIL = E2E_ACCOUNTS.gvkbegvvmhcrmxdorctk.email;

/**
 * Which project is this process actually talking to?
 *
 * Derived from the connection target, not from a setting that names an
 * allowlist entry. If it cannot be resolved, callers refuse: "we do not know
 * which database this is" is exactly when a destructive suite must stop.
 */
export function currentProjectRef(): string | null {
  return projectRefFromSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  );
}

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
export function assertIsTestAccount(
  userId: string | null | undefined,
  context: string,
  opts?: { projectRef?: string | null; email?: string | null },
): void {
  const projectRef = opts?.projectRef ?? currentProjectRef();

  if (!projectRef) {
    throw new Error(
      `[${context}] REFUSING TO RUN: could not determine which Supabase project this is. ` +
        'Fail-closed by design: an unidentified database may be production.',
    );
  }

  const account = Object.prototype.hasOwnProperty.call(E2E_ACCOUNTS, projectRef)
    ? E2E_ACCOUNTS[projectRef]
    : undefined;
  if (!account) {
    throw new Error(
      `[${context}] REFUSING TO RUN: project ${projectRef} has no designated e2e account. ` +
        `Known projects: ${Object.keys(E2E_ACCOUNTS).join(', ')}. ` +
        'A project is never implicitly trusted; add it to E2E_ACCOUNTS deliberately.',
    );
  }

  if (!userId) {
    throw new Error(
      `[${context}] REFUSING TO RUN: could not resolve the signed-in user id. ` +
        `The e2e suite only runs as ${account.email} (${account.id}) on project ${projectRef}. ` +
        'Fail-closed by design: an unidentified account may be a real family.',
    );
  }

  if (userId !== account.id) {
    const known = NEVER_TOUCH_USER_IDS[userId];
    // Name the cross-project case explicitly: the other project's test account
    // is the most plausible wrong id, and "not the e2e test account" reads as
    // nonsense when it plainly IS an e2e test account, just the wrong one.
    const otherProject = Object.entries(E2E_ACCOUNTS).find(
      ([ref, a]) => ref !== projectRef && a.id === userId,
    );
    throw new Error(
      `[${context}] REFUSING TO RUN: signed in as ${userId}, which is not the e2e test account.\n` +
        (known ? `  That id is: ${known}\n` : '') +
        (otherProject
          ? `  That id is the e2e account for project ${otherProject[0]}, not ${projectRef}.\n`
          : '') +
        `  Expected ${account.id} (${account.email}) on project ${projectRef}.\n` +
        '  These specs create, re-spread and DELETE curriculum data. Point PLAYWRIGHT_EMAIL /\n' +
        '  PLAYWRIGHT_PASSWORD at the test account, or update E2E_ACCOUNTS in e2e/test-account.ts\n' +
        '  if the test account itself was rotated.',
    );
  }

  // The id is right. If an email was resolved too, it must agree: an id that
  // matches while the email does not means the two came from different places.
  if (opts?.email != null && opts.email.toLowerCase() !== account.email.toLowerCase()) {
    throw new Error(
      `[${context}] REFUSING TO RUN: signed in as ${opts.email}, but project ${projectRef}'s ` +
        `e2e account is ${account.email}. The id matched and the email did not, which means ` +
        'they were resolved from different sources. Refusing rather than guessing which is right.',
    );
  }
}
