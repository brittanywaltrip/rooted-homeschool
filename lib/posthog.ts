// PostHog analytics — initialized client-side only
import posthog from 'posthog-js'

let initialized = false

export function initPostHog() {
  if (typeof window === 'undefined') return
  if (initialized) return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = '/ingest'

  if (!key || key.trim() === '') {
    console.warn('[PostHog] NEXT_PUBLIC_POSTHOG_KEY is not set — skipping init')
    return
  }

  try {
    posthog.init(key, {
      api_host: host,
      ui_host: 'https://us.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false, // manual capture for Next.js SPA routing
      capture_pageleave: true,
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') ph.debug()
      },
    })
    initialized = true
  } catch (err) {
    console.error('[PostHog] init failed:', err)
  }
}

export { posthog }
