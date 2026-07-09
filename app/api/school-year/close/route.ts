import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deriveEndYear } from "@/lib/school-year-name";

export const dynamic = "force-dynamic";

const GRADE_ADVANCEMENT: Record<string, string> = {
  "Preschool": "Pre-K",
  "Pre-K": "Kindergarten",
  "Kindergarten": "1st Grade",
  "1st Grade": "2nd Grade",
  "2nd Grade": "3rd Grade",
  "3rd Grade": "4th Grade",
  "4th Grade": "5th Grade",
  "5th Grade": "6th Grade",
  "6th Grade": "7th Grade",
  "7th Grade": "8th Grade",
  "8th Grade": "9th Grade",
  "9th Grade": "10th Grade",
  "10th Grade": "11th Grade",
  "11th Grade": "12th Grade",
  "12th Grade": "Graduated",
};

function fail(message: string, detail?: unknown) {
  const err = detail instanceof Error ? detail.message : detail ? String(detail) : null;
  const full = err ? `${message}: ${err}` : message;
  console.error("[school-year/close]", full);
  // This bug sat invisible from June 19 because handled 500s never reached
  // Sentry. Every fatal exit now creates a Sentry issue so a stranded user
  // shows up in alerting instead of only in the browser network tab.
  Sentry.captureException(detail instanceof Error ? detail : new Error(full), {
    tags: { route: "school-year/close" },
    extra: { message },
  });
  return NextResponse.json({ error: full }, { status: 500 });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;
  const todayDate = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // Step 1: Find active school year
  const { data: activeYear, error: activeErr } = await supabaseAdmin
    .from("school_years")
    .select("id, name, start_date, end_date, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeErr) return fail("Failed to load active school year", activeErr);
  if (!activeYear) {
    return NextResponse.json({ error: "No active school year found" }, { status: 404 });
  }

  const yearId = activeYear.id as string;
  const yearStart = activeYear.start_date as string;

  // ── INVARIANT ────────────────────────────────────────────────────────────
  // At EVERY exit point below, the user is left in exactly one of two states:
  //   (a) they have exactly one active school year — the freshly created next
  //       year — with the old year archived, or
  //   (b) their original state is fully intact (old year still active).
  // The only irreversible pairing (archive old year + create new year) runs
  // back-to-back with a compensating revert, and every cosmetic step after it
  // (stats snapshot, certificates, grade advancement, goal/activity archiving)
  // is non-fatal — it records a warning and continues rather than returning a
  // 500 mid-flow. Losing a snapshot is cosmetic; losing the active year bricks
  // the account. This ordering exists because on June 19 the old flow archived
  // the year, then crashed on the snapshot insert, stranding a real user.
  const warnings: string[] = [];
  const warn = (step: string, detail: unknown) => {
    const msg = detail instanceof Error ? detail.message : String(detail);
    console.error(`[school-year/close] non-fatal ${step}:`, msg);
    Sentry.captureException(detail instanceof Error ? detail : new Error(`${step}: ${msg}`), {
      tags: { route: "school-year/close", step, fatal: "false" },
      extra: { userId, yearId },
    });
    warnings.push(step);
  };

  // Step 2: Stats snapshot (non-fatal — a flaky count must not block the close)
  const [
    lessonsCompletedRes,
    totalLessonsRes,
    memoriesCountRes,
    photosCountRes,
    booksCountRes,
    fieldTripsCountRes,
    winsCountRes,
    badgesCountRes,
    hoursRowsRes,
  ] = await Promise.all([
    supabaseAdmin.from("lessons").select("id", { count: "exact", head: true })
      .eq("school_year_id", yearId).eq("completed", true),
    supabaseAdmin.from("lessons").select("id", { count: "exact", head: true })
      .eq("school_year_id", yearId),
    supabaseAdmin.from("memories").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("date", yearStart).lte("date", todayDate),
    supabaseAdmin.from("memories").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "photo").gte("date", yearStart).lte("date", todayDate),
    supabaseAdmin.from("memories").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "book").gte("date", yearStart).lte("date", todayDate),
    supabaseAdmin.from("memories").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "field_trip").gte("date", yearStart).lte("date", todayDate),
    supabaseAdmin.from("memories").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "win").gte("date", yearStart).lte("date", todayDate),
    supabaseAdmin.from("badges").select("id", { count: "exact", head: true })
      .eq("school_year_id", yearId),
    supabaseAdmin.from("lessons").select("minutes_spent")
      .eq("school_year_id", yearId).eq("completed", true),
  ]);

  // Any failed count degrades to 0 (via the `?? 0` defaults below) rather than
  // aborting the close. The snapshot is a keepsake, not a gate.
  if (lessonsCompletedRes.error) warn("stats: lessons_completed", lessonsCompletedRes.error);
  if (totalLessonsRes.error) warn("stats: total_lessons", totalLessonsRes.error);
  if (memoriesCountRes.error) warn("stats: memories_count", memoriesCountRes.error);
  if (photosCountRes.error) warn("stats: photos_count", photosCountRes.error);
  if (booksCountRes.error) warn("stats: books_count", booksCountRes.error);
  if (fieldTripsCountRes.error) warn("stats: field_trips_count", fieldTripsCountRes.error);
  if (winsCountRes.error) warn("stats: wins_count", winsCountRes.error);
  if (badgesCountRes.error) warn("stats: badges_count", badgesCountRes.error);
  if (hoursRowsRes.error) warn("stats: hours_logged", hoursRowsRes.error);

  const totalMinutes = (hoursRowsRes.data ?? []).reduce((sum: number, row: { minutes_spent?: number | null }) => {
    return sum + (typeof row.minutes_spent === "number" ? row.minutes_spent : 0);
  }, 0);
  const hoursLogged = Math.round((totalMinutes / 60) * 10) / 10;

  const stats = {
    lessons_completed: lessonsCompletedRes.count ?? 0,
    total_lessons: totalLessonsRes.count ?? 0,
    memories_count: memoriesCountRes.count ?? 0,
    photos_count: photosCountRes.count ?? 0,
    books_count: booksCountRes.count ?? 0,
    field_trips_count: fieldTripsCountRes.count ?? 0,
    wins_count: winsCountRes.count ?? 0,
    badges_count: badgesCountRes.count ?? 0,
    hours_logged: hoursLogged,
  };

  // Step 3: Per-child data
  const { data: children, error: childrenErr } = await supabaseAdmin
    .from("children")
    .select("id, name, grade_level, archived, graduated_at, sort_order")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("sort_order", { ascending: true });
  if (childrenErr) warn("Failed to load children", childrenErr);

  const childList = children ?? [];

  const perChildResult = await Promise.all(
    childList.map(async (child) => {
      const [lessonsRes, badgesRes, goalsRes] = await Promise.all([
        supabaseAdmin.from("lessons").select("id", { count: "exact", head: true })
          .eq("school_year_id", yearId).eq("child_id", child.id).eq("completed", true),
        supabaseAdmin.from("badges").select("id", { count: "exact", head: true })
          .eq("school_year_id", yearId).eq("child_id", child.id),
        supabaseAdmin.from("curriculum_goals").select("id", { count: "exact", head: true })
          .eq("school_year_id", yearId).eq("child_id", child.id),
      ]);
      if (lessonsRes.error) throw new Error(`per-child lessons (${child.id}): ${lessonsRes.error.message}`);
      if (badgesRes.error) throw new Error(`per-child badges (${child.id}): ${badgesRes.error.message}`);
      if (goalsRes.error) throw new Error(`per-child goals (${child.id}): ${goalsRes.error.message}`);
      return {
        child_id: child.id as string,
        child_name: child.name as string,
        grade_level: (child.grade_level as string | null) ?? null,
        lessons_completed: lessonsRes.count ?? 0,
        badges_count: badgesRes.count ?? 0,
        goals_count: goalsRes.count ?? 0,
      };
    }),
  ).catch((e) => e as Error);

  if (perChildResult instanceof Error) warn("Failed to gather per-child data", perChildResult);
  const perChildBase = perChildResult instanceof Error ? [] : perChildResult;

  // Step 4: Garden snapshot
  const { data: goals, error: goalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("id, curriculum_name, subject_label, icon_emoji, child_id, current_lesson, total_lessons")
    .eq("user_id", userId)
    .eq("school_year_id", yearId)
    .eq("archived", false);
  if (goalsErr) warn("Failed to load curriculum goals for snapshot", goalsErr);

  const gardenSnapshot = (goals ?? []).map((g) => {
    const current = typeof g.current_lesson === "number" ? g.current_lesson : 0;
    const total = typeof g.total_lessons === "number" ? g.total_lessons : 0;
    const pct = total > 0 ? Math.round((current / total) * 1000) / 1000 : 0;
    return {
      goal_id: g.id,
      curriculum_name: g.curriculum_name,
      subject_label: g.subject_label,
      icon_emoji: g.icon_emoji,
      child_id: g.child_id,
      current_lesson: current,
      total_lessons: total,
      completion_pct: pct,
    };
  });

  // ── IRREVERSIBLE CORE ──────────────────────────────────────────────────
  // The old flow archived the year (step 9) then ran four fallible steps
  // before creating the new year (step 13); a crash in between stranded the
  // user with an archived year and no active year. The archive + create are
  // now back-to-back and the ONLY fatal writes: if the create fails, we
  // revert the archive so the account is never left without an active year.

  // Step 5: Archive the school year.
  const { error: archiveYearErr } = await supabaseAdmin
    .from("school_years")
    .update({ status: "archived", end_date: todayDate, updated_at: nowIso })
    .eq("id", yearId);
  if (archiveYearErr) return fail("Failed to archive school year", archiveYearErr);
  // INVARIANT CHECKPOINT: old year archived, no new year yet. The very next
  // write MUST create the new active year or revert this archive.

  // Step 6: Create the new active school year. Parse the end year with a
  // digits regex (not split("-")) so en-dash names like "2025–2026" roll
  // forward to 2026-2027 instead of collapsing back to 2025-2026.
  const endYear = deriveEndYear(activeYear.name as string, new Date().getFullYear());
  const newYearName = `${endYear}-${endYear + 1}`;
  const newYearEnd = `${endYear + 1}-05-31`;

  const { data: newYear, error: newYearErr } = await supabaseAdmin
    .from("school_years")
    .insert({
      user_id: userId,
      name: newYearName,
      start_date: todayDate,
      end_date: newYearEnd,
      status: "active",
    })
    .select("id")
    .single();

  if (newYearErr || !newYear) {
    // Compensate: restore the old year to active so the user is never
    // stranded. Now the invariant holds via branch (b): original state intact.
    await supabaseAdmin
      .from("school_years")
      .update({ status: "active", end_date: activeYear.end_date, updated_at: nowIso })
      .eq("id", yearId);
    return fail("Failed to create new school year; restored the previous year to active", newYearErr);
  }
  // INVARIANT HOLDS (branch a): exactly one active year (the new one), old
  // year archived. Everything below is cosmetic and must never throw a 500.

  const newYearId = newYear.id as string;

  // ── NON-FATAL ENRICHMENT ───────────────────────────────────────────────
  // Grade advancement, snapshots, certificates, and goal/activity archiving.
  // Each records a warning and continues on failure; the account already has
  // its active year, so none of these can strand the user.

  // Step 7: Auto-advance grades.
  const gradesAdvanced: { child_id: string; from: string | null; to: string | null }[] = [];
  for (const child of childList) {
    const fromGrade = (child.grade_level as string | null) ?? null;
    if (!fromGrade || !(fromGrade in GRADE_ADVANCEMENT)) {
      gradesAdvanced.push({ child_id: child.id as string, from: fromGrade, to: fromGrade });
      continue;
    }
    const toGrade = GRADE_ADVANCEMENT[fromGrade];
    const updates: Record<string, unknown> = { grade_level: toGrade };
    if (toGrade === "Graduated") updates.graduated_at = todayDate;
    const { error: childUpdateErr } = await supabaseAdmin
      .from("children")
      .update(updates)
      .eq("id", child.id)
      .eq("user_id", userId);
    if (childUpdateErr) {
      warn(`advance grade for child ${child.id}`, childUpdateErr);
      gradesAdvanced.push({ child_id: child.id as string, from: fromGrade, to: fromGrade });
      continue;
    }
    gradesAdvanced.push({ child_id: child.id as string, from: fromGrade, to: toGrade });
  }

  // Step 8: Archive incomplete curriculum goals.
  const { error: archiveGoalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .update({ archived: true, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("school_year_id", yearId)
    .eq("archived", false)
    .is("completed_at", null);
  if (archiveGoalsErr) warn("Failed to archive curriculum goals", archiveGoalsErr);

  // Step 9: Archive activities.
  const { error: archiveActivitiesErr } = await supabaseAdmin
    .from("activities")
    .update({ is_active: false, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`school_year_id.eq.${yearId},school_year_id.is.null`);
  if (archiveActivitiesErr) warn("Failed to archive activities", archiveActivitiesErr);

  // Step 10: Tag yearbook content with this school_year_id.
  const { error: tagYearbookErr } = await supabaseAdmin
    .from("yearbook_content")
    .update({ school_year_id: yearId })
    .eq("user_id", userId)
    .is("school_year_id", null);
  if (tagYearbookErr) warn("Failed to tag yearbook content", tagYearbookErr);

  // Step 11: Stamp badges without school_year_id.
  const { error: stampBadgesErr } = await supabaseAdmin
    .from("badges")
    .update({ school_year_id: yearId })
    .eq("user_id", userId)
    .is("school_year_id", null)
    .gte("earned_at", `${yearStart}T00:00:00.000Z`);
  if (stampBadgesErr) warn("Failed to stamp badges", stampBadgesErr);

  // Step 12: Year archive snapshot (the June 19 crash point — now non-fatal).
  const perChildMerged = perChildBase.map((row) => {
    const advance = gradesAdvanced.find((g) => g.child_id === row.child_id);
    return {
      ...row,
      grade_from: advance?.from ?? row.grade_level,
      grade_to: advance?.to ?? row.grade_level,
    };
  });

  const { error: insertArchiveErr } = await supabaseAdmin
    .from("school_year_archives")
    .insert({
      user_id: userId,
      school_year_id: yearId,
      year_name: activeYear.name,
      start_date: yearStart,
      end_date: todayDate,
      stats,
      per_child_data: perChildMerged,
      garden_snapshot: gardenSnapshot,
    });
  if (insertArchiveErr) warn("Failed to create year archive", insertArchiveErr);

  // Step 13: Year archive certificates.
  const certificateRows = childList
    .filter((child) => {
      const fromGrade = (child.grade_level as string | null) ?? null;
      return fromGrade !== "Graduated";
    })
    .map((child) => {
      const advance = gradesAdvanced.find((g) => g.child_id === child.id);
      const fromGrade = advance?.from ?? (child.grade_level as string | null);
      const toGrade = advance?.to ?? null;
      return {
        user_id: userId,
        school_year_id: yearId,
        child_id: child.id as string,
        child_name: child.name as string,
        grade_completed: fromGrade ?? "",
        grade_advancing_to: toGrade,
        school_name: null as string | null,
        completion_date: todayDate,
        certificate_url: null as string | null,
      };
    });

  if (certificateRows.length > 0) {
    const { error: certErr } = await supabaseAdmin
      .from("year_archive_certificates")
      .upsert(certificateRows, { onConflict: "school_year_id,child_id", ignoreDuplicates: true });
    if (certErr) warn("Failed to create certificates", certErr);
  }

  // Step 14: Return success. INVARIANT HOLDS (branch a): one active year, old
  // year archived. `warnings` lists any cosmetic step that was skipped.
  return NextResponse.json({
    success: true,
    archivedYearId: yearId,
    newYearId,
    yearName: activeYear.name,
    stats,
    gradesAdvanced,
    warnings,
  });
}
