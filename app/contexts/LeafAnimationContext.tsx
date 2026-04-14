"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useLeafAnimation } from "@/app/hooks/useLeafAnimation";
import LeafToast from "@/app/components/LeafToast";

type LeafAnimationContextType = {
  earnLeaf: (originElement?: HTMLElement | null, count?: number) => void;
};

const LeafAnimationContext = createContext<LeafAnimationContextType>({
  earnLeaf: () => {},
});

export function useLeafAnimationContext() {
  return useContext(LeafAnimationContext);
}

export function LeafAnimationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { triggerLeafBurst } = useLeafAnimation();
  const [toast, setToast] = useState<{ count: number; key: number } | null>(
    null,
  );

  const earnLeaf = useCallback(
    (originElement?: HTMLElement | null, count = 1) => {
      triggerLeafBurst(originElement, count);
      setToast({ count, key: Date.now() });
    },
    [triggerLeafBurst],
  );

  return (
    <LeafAnimationContext.Provider value={{ earnLeaf }}>
      {children}
      {toast && (
        <LeafToast
          key={toast.key}
          count={toast.count}
          onDone={() => setToast(null)}
        />
      )}
    </LeafAnimationContext.Provider>
  );
}
