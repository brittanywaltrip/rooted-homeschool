"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RootedCelebration from "@/app/components/RootedCelebration";
import { posthog } from "@/lib/posthog";
import { takeYearClosed, yearClosedMessage, type YearClosedData } from "@/app/lib/year-closed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "You finished a year." A moment between closing a year and its report.
 *
 * Closing used to drop the family straight onto the year-end report, whose
 * "Set Up Next Year" button promised to copy their subjects and then went to
 * the Plan page, which copies nothing. A family rebuilt both children's
 * schedules from scratch because of it. This screen says the year is saved,
 * and its primary button goes to /dashboard/plan/new-year, the page that
 * actually pre-fills last year's subjects.
 *
 * Full-bleed, so it lives outside app/dashboard, the same as /curriculum-ready.
 * The names come from the close response via sessionStorage (see
 * app/lib/year-closed.ts). Nothing to show means the moment has passed (a
 * refresh, a direct visit), and the year's report is where they should be.
 */
export default function YearClosedPage() {
  const router = useRouter();
  // Read during the first render (lazily, client only), as /curriculum-ready does.
  const [state] = useState<{ data: YearClosedData | null; yearId: string | null }>(() => {
    if (typeof window === "undefined") return { data: null, yearId: null };
    const q = new URLSearchParams(window.location.search).get("year");
    const yearId = q && UUID.test(q) ? q : null;
    const data = takeYearClosed();
    // A payload for some other close is not this screen's to show.
    return { data: data && (!yearId || data.archivedYearId === yearId) ? data : null, yearId };
  });

  useEffect(() => {
    if (state.data) return;
    router.replace(state.yearId ? `/dashboard/year-end/${state.yearId}` : "/dashboard/years");
  }, [state, router]);

  if (!state.data) return null;
  return <YearClosed data={state.data} onNavigate={(href, choice) => {
    posthog.capture("year_closed_next_step", { choice });
    router.push(href);
  }} />;
}

function YearClosed(props: { data: YearClosedData; onNavigate: (href: string, choice: string) => void }) {
  const { data } = props;

  useEffect(() => {
    posthog.capture("year_closed_celebrated", { children: data.childNames.length });
    // Fires once for the screen, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yearId = encodeURIComponent(data.archivedYearId);

  return (
    <RootedCelebration heading="You finished a year.">
      <p className="text-[17px] leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.8)" }}>
        {yearClosedMessage(data)}
      </p>

      <p className="text-[15px] leading-relaxed mb-10" style={{ color: "rgba(255,255,255,0.6)" }}>
        Fresh soil, fresh seeds. Ready for next year?
      </p>

      <button
        onClick={() => props.onNavigate(`/dashboard/plan/new-year?from=${yearId}`, "set_up_next_year")}
        className="w-full bg-white text-[#2D5A3D] font-medium rounded-2xl text-[17px] py-[18px] px-8 shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        Set up {data.newYearName}
      </button>

      <button
        onClick={() => props.onNavigate(`/dashboard/year-end/${yearId}`, "maybe_later")}
        className="mt-6 text-[15px] text-white/55 hover:text-white/80 transition-colors"
      >
        Maybe later
      </button>
    </RootedCelebration>
  );
}
