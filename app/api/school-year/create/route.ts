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
  // When the caller already has a year to fill in (the close route creates
  // one before the wizard runs), pass its id here. The route updates that
  // year in place instead of inserting a second one.
  existingSchoolYearId?: string | null;
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
  const existingId = typeof body.existingSchoolYearId === "string" ? body.existingSchoolYearId.trim() : "";

  let newSchoolYearId: string;

  if (existingId) {
    // Fill in the year the close route already created. Verify ownership
    // first. An id from another account must never be writable here.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("school_years")
      .select("id, user_id")
      .eq("id", existingId)
      .maybeSingle();

    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 });
    }
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: "That school year could not be found." }, { status: 404 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("school_years")
      .update({
        name: body.name,
        start_date: body.startDate,
        end_date: body.endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId)
      .eq("user_id", userId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    newSchoolYearId = existingId;
  } else {
    // No target year given. If one is already running, creating another would
    // leave the family with two years and their subjects split across both,
    // the duplicate-year bug. Send the caller back with the id to reuse.
    const { data: activeYear, error: activeErr } = await supabaseAdmin
      .from("school_years")
      .select("id, name, start_date")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeErr) {
      return NextResponse.json({ error: activeErr.message }, { status: 500 });
    }
    if (activeYear && (activeYear.start_date as string) <= today) {
      return NextResponse.json(
        {
          error: `You already have a school year running (${activeYear.name}). Edit that year instead of starting a second one.`,
          existingSchoolYearId: activeYear.id,
        },
        { status: 409 },
      );
    }

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

    newSchoolYearId = created.id as string;
  }

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
