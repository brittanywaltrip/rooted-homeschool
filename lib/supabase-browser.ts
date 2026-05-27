import { createBrowserClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
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

function isDeletionWrite(value: string, options?: CookieOptions): boolean {
  if (value === '') return true
  if (options?.maxAge === 0) return true
  if (options?.expires instanceof Date && options.expires.getTime() <= Date.now()) return true
  return false
}

/**
 * Minimal cookie serializer for the dual-write adapter. Mirrors the
 * subset of options Supabase actually sets on auth cookies (path,
 * domain, maxAge, expires, secure, sameSite) and URL-encodes the value
 * so the round-trip through document.cookie matches what the cookie
 * package would produce by default. httpOnly is not settable from JS
 * and is intentionally ignored.
 */
function serializeCookie(name: string, value: string, options?: CookieOptions): string {
  let s = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
  if (options?.maxAge != null) s += `; Max-Age=${Math.floor(options.maxAge)}`
  if (options?.expires instanceof Date) s += `; Expires=${options.expires.toUTCString()}`
  s += `; Path=${options?.path ?? '/'}`
  if (options?.domain) s += `; Domain=${options.domain}`
  if (options?.secure) s += `; Secure`
  if (options?.sameSite) {
    const raw = options.sameSite === true ? 'Strict' : String(options.sameSite)
    s += `; SameSite=${raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()}`
  }
  return s
}

function deletionCookie(name: string, options?: CookieOptions): string {
  return serializeCookie(name, '', {
    ...(options ?? {}),
    maxAge: 0,
    expires: new Date(0),
  })
}

function parseDocumentCookiesByName(): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof document === 'undefined' || !document.cookie) return out
  for (const pair of document.cookie.split('; ')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawName = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    try {
      out.set(decodeURIComponent(rawName), decodeURIComponent(rawValue))
    } catch {
      out.set(rawName, rawValue)
    }
  }
  return out
}

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
  // The adapter writes session data to BOTH stores so:
  //   - Cookies stay populated during the OAuth round-trip, so the
  //     server-side PKCE callback (app/auth/callback/route.ts) can still
  //     read the verifier from request cookies.
  //   - localStorage retains the session after a force-quit, so a cold
  //     start in the iOS shell can restore it without re-auth.
  // Reads merge both stores; localStorage wins on conflict because it is
  // the only store that survives a cold start. document.cookie still
  // contributes any keys localStorage does not have yet (notably the
  // server-set session immediately after the OAuth callback redirects
  // to /dashboard, before the browser client has refreshed and mirrored
  // those values back into localStorage).
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll() {
          const merged = new Map<string, string>()
          try {
            for (const [name, value] of parseDocumentCookiesByName()) {
              if (!name.startsWith('sb-')) continue
              merged.set(name, value)
            }
          } catch (err) {
            console.warn('[supabase-browser] document.cookie getAll failed', err)
          }
          try {
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i)
              if (!key || !key.startsWith('sb-')) continue
              const value = window.localStorage.getItem(key)
              if (value == null) continue
              merged.set(key, value)
            }
          } catch (err) {
            console.warn('[supabase-browser] localStorage getAll failed', err)
          }
          return Array.from(merged.entries()).map(([name, value]) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            const deleting = isDeletionWrite(value, options)
            try {
              if (deleting) window.localStorage.removeItem(name)
              else window.localStorage.setItem(name, value)
            } catch (err) {
              console.warn('[supabase-browser] localStorage setAll failed', err)
            }
            try {
              if (typeof document !== 'undefined') {
                document.cookie = deleting
                  ? deletionCookie(name, options)
                  : serializeCookie(name, value, options)
              }
            } catch (err) {
              console.warn('[supabase-browser] document.cookie setAll failed', err)
            }
          }
        },
      },
    },
  )
}
