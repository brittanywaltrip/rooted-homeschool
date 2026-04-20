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

export const supabase = createSupabaseBrowserClient()
