import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SubjectStat = {
  id: string;
  subject_label: string | null;
  icon_emoji: string | null;
  total_lessons: number;
  default_minutes: number;
  credits_value: number | null;
  course_level: string | null;
  completed_lessons: number;
  total_minutes: number;
};

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

  const { data: goals, error: goalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("id, subject_label, icon_emoji, total_lessons, default_minutes, credits_value, course_level")
    .eq("school_year_id", schoolYearId)
    .eq("user_id", userId)
    .order("subject_label", { ascending: true });

  if (goalsErr) {
    return NextResponse.json({ error: goalsErr.message }, { status: 500 });
  }

  const goalIds = (goals ?? []).map((g) => g.id);
  let lessonsByGoal = new Map<string, { completed: number; minutes: number }>();

  if (goalIds.length > 0) {
    const { data: lessons, error: lessonsErr } = await supabaseAdmin
      .from("lessons")
      .select("curriculum_goal_id, completed, minutes_spent")
      .in("curriculum_goal_id", goalIds)
      .eq("user_id", userId);

    if (lessonsErr) {
      return NextResponse.json({ error: lessonsErr.message }, { status: 500 });
    }

    for (const l of lessons ?? []) {
      if (!l.completed || !l.curriculum_goal_id) continue;
      const cur = lessonsByGoal.get(l.curriculum_goal_id) ?? { completed: 0, minutes: 0 };
      cur.completed += 1;
      cur.minutes += l.minutes_spent ?? 0;
      lessonsByGoal.set(l.curriculum_goal_id, cur);
    }
  }

  const subjects: SubjectStat[] = (goals ?? []).map((g) => {
    const stats = lessonsByGoal.get(g.id) ?? { completed: 0, minutes: 0 };
    return {
      id: g.id,
      subject_label: g.subject_label,
      icon_emoji: g.icon_emoji,
      total_lessons: g.total_lessons ?? 0,
      default_minutes: g.default_minutes ?? 0,
      credits_value: (g as { credits_value?: number | null }).credits_value ?? null,
      course_level: (g as { course_level?: string | null }).course_level ?? null,
      completed_lessons: stats.completed,
      total_minutes: stats.minutes,
    };
  });

  const totalLessonsCompleted = subjects.reduce((sum, s) => sum + s.completed_lessons, 0);
  const totalLessonsPlanned = subjects.reduce((sum, s) => sum + s.total_lessons, 0);
  const totalMinutes = subjects.reduce((sum, s) => sum + s.total_minutes, 0);

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
    subjects,
    totalLessonsCompleted,
    totalLessonsPlanned,
    totalMinutes,
    memories,
    badges: badges ?? [],
  });
}
