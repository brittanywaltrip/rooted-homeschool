"use client";

// The family's profile row, read once per dashboard load by the layout and
// shared with every page and component under it.
//
// Before 2026-09-09 four components each fetched profiles on a dashboard
// load: the layout (gate + avatar), this context (name + photo), the Today
// page (its whole first wave waited on it) and UpgradeBanner. One read now
// covers all of them. The layout owns the fetch and provides this context;
// this file is the type, the context and the hook.
//
// A partner (view-only co-teacher) sees the OWNER's data on the Today page,
// so that page still reads the owner's row itself when isPartner is set.
// This context always holds the signed-in user's own row.

import { createContext, useContext } from "react";

/** Every profile column any dashboard load-path consumer reads. */
export const DASHBOARD_PROFILE_COLUMNS =
  "display_name, first_name, last_name, subscription_status, family_photo_url, onboarded, is_pro, plan_type, trial_started_at, created_at, school_days, school_year_start, school_start_time, timezone, yearbook_opened_at, yearbook_closed_at, yearbook_settings";

export type DashboardProfile = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  subscription_status: string | null;
  family_photo_url: string | null;
  onboarded: boolean | null;
  is_pro: boolean | null;
  plan_type: string | null;
  trial_started_at: string | null;
  created_at: string | null;
  school_days: string[] | null;
  school_year_start: string | null;
  school_start_time: string | null;
  timezone: string | null;
  yearbook_opened_at: string | null;
  yearbook_closed_at: string | null;
  yearbook_settings: Record<string, boolean> | null;
};

export type ProfileContextType = {
  /** The signed-in user's row; null until the first read lands or when there is no row. */
  profile: DashboardProfile | null;
  /** True once the first read has answered, whether or not it found a row. */
  ready: boolean;
  displayName: string;
  familyPhotoUrl: string | null;
  /**
   * The row, without a second request when the layout's read is in flight
   * or landed within maxAgeMs. Older than that (a page remounted after
   * navigating around, where another page may have written the row) and it
   * re-reads. The Today page's first wave calls this instead of fetching.
   */
  getProfile: (maxAgeMs?: number) => Promise<DashboardProfile | null>;
  /** Re-read after a write (Settings saves, plan changes). */
  refreshProfile: () => Promise<void>;
};

export const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  ready: false,
  displayName: "",
  familyPhotoUrl: null,
  getProfile: async () => null,
  refreshProfile: async () => {},
});

export function useProfile() {
  return useContext(ProfileContext);
}
