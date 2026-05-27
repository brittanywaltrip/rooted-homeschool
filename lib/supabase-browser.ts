import { createBrowserClient } from '@supabase/ssr'
import { getCookieDomain } from '@/lib/cookie-domain'

/**
 * True only when the page is running inside a Capacitor native shell.
 * SSR-safe: returns false if window or window.Capacitor is undefined.
 * The optional chains on isNativePlatform also tolerate a Capacitor
 * global that exists but lacks the method (web preview builds).
 */
const isCapacitor = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.()

export function createSupabaseBrowserClient() {
  const cookieOptions = (() => {
    const domain = getCookieDomain()
    return domain ? { domain } : {}
  })()

  if (!isCapacitor()) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions },
    )
  }

  // WKWebView drops cookies across app launches but persists localStorage.
  // Route Supabase session storage through localStorage when running
  // inside Capacitor so a force-quit + reopen does not require re-auth.
  // localStorage keys match the existing Supabase cookie names exactly
  // (sb-*) so the same chunked-token convention works without changes
  // on the read side and existing sessions are not orphaned.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll() {
          try {
            const out: { name: string; value: string }[] = []
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i)
              if (!key || !key.startsWith('sb-')) continue
              const value = window.localStorage.getItem(key)
              if (value == null) continue
              out.push({ name: key, value })
            }
            return out
          } catch (err) {
            console.warn(
              '[supabase-browser] localStorage getAll failed, returning empty',
              err,
            )
            return []
          }
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              const expiresAt =
                options?.expires instanceof Date
                  ? options.expires.getTime()
                  : null
              const isDelete =
                value === '' ||
                options?.maxAge === 0 ||
                (expiresAt !== null && expiresAt <= Date.now())
              if (isDelete) {
                window.localStorage.removeItem(name)
              } else {
                window.localStorage.setItem(name, value)
              }
            }
          } catch (err) {
            console.warn('[supabase-browser] localStorage setAll failed', err)
          }
        },
      },
    },
  )
}
