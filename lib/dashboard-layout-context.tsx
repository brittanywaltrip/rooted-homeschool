"use client";

import { createContext, useContext, useState, useCallback } from "react";

type DashboardLayoutContextType = {
  hideFab: boolean;
  setHideFab: (v: boolean) => void;
};

const DashboardLayoutContext = createContext<DashboardLayoutContextType>({
  hideFab: false,
  setHideFab: () => {},
});

export function DashboardLayoutProvider({ children }: { children: React.ReactNode }) {
  const [hideFab, setHideFabRaw] = useState(false);
  const setHideFab = useCallback((v: boolean) => setHideFabRaw(v), []);
  return (
    <DashboardLayoutContext.Provider value={{ hideFab, setHideFab }}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout() {
  return useContext(DashboardLayoutContext);
}
