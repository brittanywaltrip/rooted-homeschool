"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Legacy curriculum-setup modal replaced by /dashboard/plan/schedule
// (Schedule Builder, May 2026). This wrapper exists only as a safety net
// for any caller that still imports and mounts <CurriculumWizard> — deep
// links, third-party tabs, future regressions — and bounces them to the
// new builder. The original 2400-line implementation lives in git
// history at commit c6687c9.
export default function CurriculumWizard() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/plan/schedule");
  }, [router]);
  return null;
}
