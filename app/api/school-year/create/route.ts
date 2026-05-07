import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SubjectInput = {
  childId: string | null;
  subjectLabel: string | null;
  curriculumName: string;
  iconEmoji: string | null;
  schoolDays: string[];
  defaultMinutes: number;
  totalLessons: number;
  courseLevel: string | null;
  creditsValue: number | null;
  startDate: string | null;
};

type CreateBody = {
  name: string;
  startDate: string;
  endDate: string;
  subjects: SubjectInput[];
};

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body || !body.name || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "name, startDate, endDate are required" }, { status: 400 });
  }

  const userId = user.id;
  const today = new Date().toISOString().slice(0, 10);
  const status = body.startDate <= today ? "active" : "upcoming";

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("school_years")
    .insert({
      user_id: userId,
      name: body.name,
      start_date: body.startDate,
      end_date: body.endDate,
      status,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    return NextResponse.json({ error: insertErr?.message || "Failed to create school year" }, { status: 500 });
  }

  const newSchoolYearId = created.id;
  const subjects = Array.isArray(body.subjects) ? body.subjects : [];

  if (subjects.length > 0) {
    const goalRows = subjects.map((s) => ({
      user_id: userId,
      school_year_id: newSchoolYearId,
      child_id: s.childId,
      subject_label: s.subjectLabel,
      curriculum_name: s.curriculumName,
      icon_emoji: s.iconEmoji,
      school_days: s.schoolDays,
      default_minutes: s.defaultMinutes,
      total_lessons: s.totalLessons,
      course_level: s.courseLevel,
      credits_value: s.creditsValue,
      start_date: s.startDate,
      current_lesson: 0,
    }));

    const { error: goalsErr } = await supabaseAdmin
      .from("curriculum_goals")
      .insert(goalRows);

    if (goalsErr) {
      return NextResponse.json({ error: goalsErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, schoolYearId: newSchoolYearId });
}
