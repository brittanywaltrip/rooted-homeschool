/**
 * Returns the appropriate cookie domain for the current runtime.
 * On production (rootedhomeschoolapp.com), use the apex wildcard so
 * cookies cross between www.*, auth.*, and any other subdomain.
 * On staging Vercel preview URLs or localhost, return undefined so
 * browsers scope cookies to the exact host.
 */
export function getCookieDomain(hostname?: string): string | undefined {
  const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (host.endsWith('rootedhomeschoolapp.com')) {
    return '.rootedhomeschoolapp.com'
  }
  return undefined
}
