import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  // Step 2: Stats snapshot
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

  if (lessonsCompletedRes.error) return fail("stats: lessons_completed", lessonsCompletedRes.error);
  if (totalLessonsRes.error) return fail("stats: total_lessons", totalLessonsRes.error);
  if (memoriesCountRes.error) return fail("stats: memories_count", memoriesCountRes.error);
  if (photosCountRes.error) return fail("stats: photos_count", photosCountRes.error);
  if (booksCountRes.error) return fail("stats: books_count", booksCountRes.error);
  if (fieldTripsCountRes.error) return fail("stats: field_trips_count", fieldTripsCountRes.error);
  if (winsCountRes.error) return fail("stats: wins_count", winsCountRes.error);
  if (badgesCountRes.error) return fail("stats: badges_count", badgesCountRes.error);
  if (hoursRowsRes.error) return fail("stats: hours_logged", hoursRowsRes.error);

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
  if (childrenErr) return fail("Failed to load children", childrenErr);

  const childList = children ?? [];

  const perChildBase = await Promise.all(
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

  if (perChildBase instanceof Error) return fail("Failed to gather per-child data", perChildBase);

  // Step 4: Garden snapshot
  const { data: goals, error: goalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("id, curriculum_name, subject_label, icon_emoji, child_id, current_lesson, total_lessons")
    .eq("user_id", userId)
    .eq("school_year_id", yearId)
    .eq("archived", false);
  if (goalsErr) return fail("Failed to load curriculum goals for snapshot", goalsErr);

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

  // Step 5: Archive incomplete curriculum goals
  const { error: archiveGoalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .update({ archived: true, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("school_year_id", yearId)
    .eq("archived", false)
    .is("completed_at", null);
  if (archiveGoalsErr) return fail("Failed to archive curriculum goals", archiveGoalsErr);

  // Step 6: Archive activities
  const { error: archiveActivitiesErr } = await supabaseAdmin
    .from("activities")
    .update({ is_active: false, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`school_year_id.eq.${yearId},school_year_id.is.null`);
  if (archiveActivitiesErr) return fail("Failed to archive activities", archiveActivitiesErr);

  // Step 7: Tag yearbook content with this school_year_id
  const { error: tagYearbookErr } = await supabaseAdmin
    .from("yearbook_content")
    .update({ school_year_id: yearId })
    .eq("user_id", userId)
    .is("school_year_id", null);
  if (tagYearbookErr) return fail("Failed to tag yearbook content", tagYearbookErr);

  // Step 8: Stamp badges without school_year_id
  const { error: stampBadgesErr } = await supabaseAdmin
    .from("badges")
    .update({ school_year_id: yearId })
    .eq("user_id", userId)
    .is("school_year_id", null)
    .gte("earned_at", `${yearStart}T00:00:00.000Z`);
  if (stampBadgesErr) return fail("Failed to stamp badges", stampBadgesErr);

  // Step 9: Archive the school year
  const { error: archiveYearErr } = await supabaseAdmin
    .from("school_years")
    .update({ status: "archived", end_date: todayDate, updated_at: nowIso })
    .eq("id", yearId);
  if (archiveYearErr) return fail("Failed to archive school year", archiveYearErr);

  // Step 10: Auto-advance grades
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
    if (childUpdateErr) return fail(`Failed to advance grade for child ${child.id}`, childUpdateErr);
    gradesAdvanced.push({ child_id: child.id as string, from: fromGrade, to: toGrade });
  }

  // Step 11: Year archive snapshot
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
  if (insertArchiveErr) return fail("Failed to create year archive", insertArchiveErr);

  // Step 12: Year archive certificates
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
    if (certErr) return fail("Failed to create certificates", certErr);
  }

  // Step 13: Create new active school year
  const nameParts = (activeYear.name as string).split("-");
  const endYear = parseInt(nameParts[nameParts.length - 1], 10);
  if (!Number.isFinite(endYear)) {
    return fail(`Could not parse end year from name "${activeYear.name}"`);
  }
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
  if (newYearErr || !newYear) return fail("Failed to create new school year", newYearErr);

  // Step 14: Return success
  return NextResponse.json({
    success: true,
    archivedYearId: yearId,
    newYearId: newYear.id,
    yearName: activeYear.name,
    stats,
    gradesAdvanced,
  });
}
