/**
 * The one rule for a third-party credential this environment may not carry.
 *
 * Deliberately free of SDK imports so `node --test` can exercise it directly:
 * see lib/api-keys.test.ts. The clients that use it live in lib/api-clients.ts.
 */

/** Thrown when a route needs a credential this deployment does not carry. */
export class MissingApiKeyError extends Error {
  /** The environment variable that would have supplied the credential. */
  readonly envVar: string;

  constructor(envVar: string) {
    super(
      `${envVar} is not set, so this route cannot run in this environment. ` +
        `Set ${envVar} for this deployment, or call this route from an ` +
        `environment that carries it.`,
    );
    this.name = "MissingApiKeyError";
    this.envVar = envVar;
  }
}

/**
 * Return the credential, or fail with a message that names it.
 *
 * Handing an unset value straight to an SDK constructor produces the SDK's own
 * message instead. Stripe's is "Neither apiKey nor config.authenticator
 * provided", which names neither the variable nor the route that wanted it.
 * And when the constructor ran at module scope, it surfaced during `next
 * build` rather than on a request, so the message reached a build log instead
 * of whoever called the route.
 */
export function requireApiKey(envVar: string, value: string | undefined | null): string {
  const key = value?.trim();
  if (!key) throw new MissingApiKeyError(envVar);
  return key;
}
