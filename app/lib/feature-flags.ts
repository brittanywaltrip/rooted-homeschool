"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/* ============================================================================
 * Feature flags — lightweight, two-layer resolution.
 *
 *   1. Env var default     NEXT_PUBLIC_<FLAG_NAME> = "true" | "1"
 *   2. Per-user override   user_feature_flags(user_id, flag_name, enabled)
 *
 * Env var sets the baseline for everyone; per-user rows flip it for specific
 * accounts. When no row exists for a user, env var wins. When no env var is
 * set, the default is false.
 *
 * Render path:
 *   - first paint uses sessionStorage cache (fast, no flicker on re-visit)
 *   - falls back to env var if cache is empty
 *   - then async-fetches overrides for the signed-in user and updates state
 *
 * All failures swallow to false — a broken flag must never block the UI.
 * ==========================================================================*/

export type FlagName = "new_plan_view";

type Overrides = Record<string, boolean>;

const ENV_VAR_MAP: Record<FlagName, string | undefined> = {
  new_plan_view: process.env.NEXT_PUBLIC_NEW_PLAN_VIEW,
};

const CACHE_KEY = "rooted_feature_flags_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

function envValue(flag: FlagName): boolean {
  const raw = ENV_VAR_MAP[flag];
  return raw === "true" || raw === "1";
}

function readCache(): Overrides | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; overrides: Overrides };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.overrides;
  } catch {
    return null;
  }
}

function writeCache(overrides: Overrides): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: Date.now(), overrides }),
    );
  } catch {
    /* quota exceeded or similar — non-fatal */
  }
}

async function loadOverrides(): Promise<Overrides> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return {};
    const { data, error } = await supabase
      .from("user_feature_flags")
      .select("flag_name, enabled")
      .eq("user_id", user.id);
    if (error || !data) return {};
    const out: Overrides = {};
    for (const row of data as { flag_name: string; enabled: boolean }[]) {
      out[row.flag_name] = row.enabled;
    }
    return out;
  } catch {
    return {};
  }
}

export function useFeatureFlag(flag: FlagName): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const cached = readCache();
    if (cached && flag in cached) return cached[flag];
    return envValue(flag);
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const overrides = await loadOverrides();
      if (cancelled) return;
      writeCache(overrides);
      setEnabled(flag in overrides ? overrides[flag] : envValue(flag));
    })();
    return () => { cancelled = true; };
  }, [flag]);

  return enabled;
}
