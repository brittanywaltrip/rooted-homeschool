"use client";

// The signed-in user, read once by the dashboard layout and handed down.
//
// Before 2026-09-09 a dashboard load called supabase.auth.getUser() four
// times, each a round trip to /auth/v1/user, from the layout, the profile
// context, the Today page's first wave and its achievement check. The layout
// is the one place that has to ask (it owns the redirect to /login), so it
// provides the answer here and everything under it reads this instead.
//
// Handlers that run later, on a tap, may still call getUser() themselves:
// they are not on the load path and a fresh read there is fine.

import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";

export const SessionContext = createContext<User | null>(null);

/** The signed-in user, or null until the layout's auth check has answered. */
export function useSessionUser(): User | null {
  return useContext(SessionContext);
}
