"use client";

import { createContext, useContext } from "react";

export type PartnerContextType = {
  isPartner: boolean;
  effectiveUserId: string; // main parent's user_id (or own user_id if not a partner)
  ownerName: string;       // main parent's family name if in partner mode
};

export const PartnerContext = createContext<PartnerContextType>({
  isPartner: false,
  effectiveUserId: "",
  ownerName: "",
});

export function usePartner() {
  return useContext(PartnerContext);
}
