"use client";

import PlanV2 from "@/app/components/PlanV2";
import { LessonUnitsProvider } from "@/lib/lesson-units-context";

export default function PlanPage() {
  return (
    <LessonUnitsProvider>
      <PlanV2 />
    </LessonUnitsProvider>
  );
}
