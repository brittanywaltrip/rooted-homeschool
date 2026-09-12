"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RootedCelebration from "@/app/components/RootedCelebration";
import { posthog } from "@/lib/posthog";
import { formatWeekdayLong } from "@/app/lib/scheduler";
import { GARDEN_PER_YEAR, gardenLine, gardenButtonLabel, joinNames, possessive } from "@/app/lib/garden-config";
import {
  takeSetupCelebration,
  type SetupCelebrationData,
} from "@/app/lib/setup-celebration";

/**
 * "You're Rooted." lives on its own route for one reason: it has to be
 * full-bleed.
 *
 * `app/dashboard/layout.tsx` wraps everything beneath it in the sidebar, the
 * header and the mobile bottom nav, so the first cut of this screen rendered
 * the green ground inside a content column with the nav still on top of it.
 * Onboarding's celebration is full-bleed because it sits outside
 * `app/dashboard`, and this is the same trick rather than a second one.
 *
 * The builder writes the family's names and dates to sessionStorage and
 * navigates here. Nothing to show means the moment has passed (a refresh, a
 * direct visit), and Today is where they should be by then.
 */
export default function CurriculumReadyPage() {
  const router = useRouter();
  // Read during the first render, not in an effect. sessionStorage is only
  // there on the client, so the initialiser is lazy and the server render is a
  // no-op; doing it in an effect would set state synchronously on mount, which
  // is the cascading-render pattern the lint rule is about.
  const [data] = useState<SetupCelebrationData | null>(() =>
    typeof window === "undefined" ? null : takeSetupCelebration(),
  );

  useEffect(() => {
    // Nothing to show means the moment has passed: a refresh (the payload is
    // read once and cleared) or a direct visit. Today is where they should be.
    if (!data) router.replace("/dashboard");
  }, [data, router]);

  if (!data) return null;

  return (
    <SetupCelebration
      childNames={data.childNames}
      subjects={data.subjects}
      firstLessonDate={data.firstLessonDate}
      curriculaCount={data.curriculaCount}
      onNavigate={(href, choice) => {
        posthog.capture("curriculum_setup_next_step", { choice });
        router.push(href);
      }}
    />
  );
}

/**
 * The screen a family lands on when their year is planned.
 *
 * It replaces `router.push("/dashboard/plan?saved=1")`, which dropped them on
 * the Plan page with a banner: no confirmation of what they had just set up and
 * no next step, at the end of the hardest screen in the app.
 *
 * The three actions are deliberately ordered. Families who capture a memory in
 * their first session convert at 11%; schedule-only families convert at 0%. So
 * the photo is the primary button and stays the primary button.
 */
function SetupCelebration(props: {
  childNames: string[];
  subjects: string[];
  firstLessonDate: string | null;
  curriculaCount: number;
  onNavigate: (href: string, choice: string) => void;
}) {
  useEffect(() => {
    posthog.capture("curriculum_setup_celebrated", {
      children: props.childNames.length,
      curricula: props.curriculaCount,
      first_lesson_date: props.firstLessonDate,
    });
    // Fires once for the screen, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = joinNames(props.childNames);
  const whose = possessive(names) || "Your family's";
  const subjectList = joinNames(props.subjects);
  const when = props.firstLessonDate ? formatWeekdayLong(props.firstLessonDate) : null;

  return (
    <RootedCelebration heading="You're Rooted.">
      <p className="text-[17px] leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.8)" }}>
        {whose} year is planned.
        {subjectList ? ` ${subjectList}` : ""}
        {when ? `, starting ${when}.` : "."}
      </p>

      <p className="text-[15px] leading-relaxed mb-10" style={{ color: "rgba(255,255,255,0.6)" }}>
        {gardenLine(props.childNames.length, GARDEN_PER_YEAR)} Every lesson they finish, every photo
        you snap, every book you read together is a leaf. By spring you&apos;ll look back and see the
        whole tree.
      </p>

      <p
        className="text-[13px] tracking-[2px] uppercase mb-4"
        style={{ color: "rgba(255,255,255,0.45)" }}
      >
        Here&apos;s what to do with today
      </p>

      <button
        onClick={() => props.onNavigate("/dashboard?capture=1", "photo")}
        className="w-full bg-white text-[#2D5A3D] font-semibold rounded-2xl text-[17px] py-[18px] px-8 shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        Snap a first-day photo
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard/garden", "garden")}
        className="mt-3 w-full rounded-2xl border border-white/25 text-white text-[15px] py-[14px] px-8 transition-colors hover:bg-white/10"
      >
        {gardenButtonLabel(props.childNames.length, GARDEN_PER_YEAR)}
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard/resources", "resources")}
        className="mt-3 w-full rounded-2xl border border-white/25 text-white text-[15px] py-[14px] px-8 transition-colors hover:bg-white/10"
      >
        Browse this week&apos;s Resources
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard", "today")}
        className="mt-6 text-[15px] text-white/55 hover:text-white/80 transition-colors"
      >
        or Go to Today
      </button>
    </RootedCelebration>
  );
}
