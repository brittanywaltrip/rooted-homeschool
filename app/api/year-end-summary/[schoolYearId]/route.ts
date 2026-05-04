import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ schoolYearId: string }> }
) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolYearId } = await params;
  const userId = user.id;

  const { data: schoolYear, error: syErr } = await supabaseAdmin
    .from("school_years")
    .select("id, name, start_date, end_date, status")
    .eq("id", schoolYearId)
    .eq("user_id", userId)
    .single();

  if (syErr || !schoolYear) {
    return NextResponse.json({ error: "School year not found" }, { status: 404 });
  }

  const { data: completedLessons, error: lessonsErr } = await supabaseAdmin
    .from("lessons")
    .select("minutes_spent")
    .eq("user_id", userId)
    .eq("school_year_id", schoolYearId)
    .eq("completed", true);

  if (lessonsErr) {
    return NextResponse.json({ error: lessonsErr.message }, { status: 500 });
  }

  const totalLessonsCompleted = completedLessons?.length ?? 0;
  const totalMinutes = (completedLessons ?? []).reduce(
    (sum, l) => sum + (l.minutes_spent ?? 0),
    0
  );

  const { data: goals, error: goalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("total_lessons")
    .eq("user_id", userId)
    .eq("school_year_id", schoolYearId);

  if (goalsErr) {
    return NextResponse.json({ error: goalsErr.message }, { status: 500 });
  }

  const totalLessonsPlanned = (goals ?? []).reduce(
    (sum, g) => sum + (g.total_lessons ?? 0),
    0
  );

  const { data: memoryRows, error: memErr } = await supabaseAdmin
    .from("memories")
    .select("type")
    .eq("user_id", userId)
    .gte("date", schoolYear.start_date)
    .lte("date", schoolYear.end_date);

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  const memoryCountMap = new Map<string, number>();
  for (const m of memoryRows ?? []) {
    memoryCountMap.set(m.type, (memoryCountMap.get(m.type) ?? 0) + 1);
  }
  const memories = Array.from(memoryCountMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const endDateInclusive = `${schoolYear.end_date}T23:59:59.999Z`;
  const { data: badges, error: badgesErr } = await supabaseAdmin
    .from("badges")
    .select("badge_type, tier, earned_at")
    .eq("user_id", userId)
    .gte("earned_at", schoolYear.start_date)
    .lte("earned_at", endDateInclusive)
    .order("earned_at", { ascending: false });

  if (badgesErr) {
    return NextResponse.json({ error: badgesErr.message }, { status: 500 });
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .single();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json({
    schoolYear,
    profile,
    totalLessonsCompleted,
    totalLessonsPlanned,
    totalMinutes,
    memories,
    badges: badges ?? [],
  });
}
