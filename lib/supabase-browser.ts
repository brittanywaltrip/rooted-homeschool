import { createBrowserClient } from '@supabase/ssr'
import { getCookieDomain } from '@/lib/cookie-domain'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: (() => {
        const domain = getCookieDomain()
        return domain ? { domain } : {}
      })(),
    }
  )
}
