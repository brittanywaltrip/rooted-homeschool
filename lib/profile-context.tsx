"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";

type ProfileContextType = {
  displayName: string;
  familyPhotoUrl: string | null;
  refreshProfile: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextType>({
  displayName: "",
  familyPhotoUrl: null,
  refreshProfile: async () => {},
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [displayName, setDisplayName] = useState("");
  const [familyPhotoUrl, setFamilyPhotoUrl] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    console.log("[ProfileContext] refreshProfile() called");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { console.log("[ProfileContext] no user, aborting"); return; }
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name, family_photo_url")
      .eq("id", user.id)
      .maybeSingle();
    console.log("[ProfileContext] fetched profile data:", data, "error:", error);
    if (data) {
      const name = (data as { display_name?: string }).display_name ?? "";
      const photo = (data as { family_photo_url?: string }).family_photo_url ?? null;
      console.log("[ProfileContext] setting displayName:", name, "familyPhotoUrl:", photo);
      setDisplayName(name);
      setFamilyPhotoUrl(photo);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  return (
    <ProfileContext.Provider value={{ displayName, familyPhotoUrl, refreshProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
