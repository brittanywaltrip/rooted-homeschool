"use client";

// PlanV2 — new Plan page composition. Assembled in later steps.
// In Step 2 this is a placeholder so the flag gate in plan/page.tsx has
// something to render when new_plan_view is enabled. The placeholder renders
// a visible banner so it's obvious the flag is ON — no silent blank page.

export default function PlanV2() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8B7E74]">
          Plan V2 · preview
        </p>
        <p className="text-sm text-[#2d2926] mt-2">
          New Plan view scaffold is wired up. Month grid, pills, drag, multi-select,
          and recurring appointment support land in the next phases.
        </p>
      </div>
    </div>
  );
}
