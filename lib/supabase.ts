// Unified Supabase browser client.
//
// Any code importing { supabase } from "@/lib/supabase" gets the same
// PKCE-flow client as imports from "@/lib/supabase-browser". This prevents
// the class of bug where one part of the app reads sessions from localStorage
// while the rest reads from cookies.
//
// For server-side code (API routes, server components), use createServerClient
// from @supabase/ssr directly — NOT this singleton.

import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { installSessionLifeboat } from '@/lib/session-lifeboat'

export const supabase = createSupabaseBrowserClient()

// Keep a durable backup of the session tokens in localStorage. Cookies remain
// the source of truth; this only exists because WKWebView loses cookie writes
// when iOS kills the suspended app. See lib/session-lifeboat.ts for the full
// diagnosis. Installed here, at module scope, so exactly one listener exists
// per bundle no matter how many components import this singleton.
installSessionLifeboat(supabase)
