import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const schoolYearId = body?.schoolYearId as string | undefined;
  if (!schoolYearId) {
    return NextResponse.json({ error: "schoolYearId is required" }, { status: 400 });
  }

  const userId = user.id;

  const { data: schoolYear, error: syErr } = await supabaseAdmin
    .from("school_years")
    .select("id, start_date, end_date, user_id")
    .eq("id", schoolYearId)
    .eq("user_id", userId)
    .single();

  if (syErr || !schoolYear) {
    return NextResponse.json({ error: "School year not found" }, { status: 404 });
  }

  const { error: updErr } = await supabaseAdmin
    .from("school_years")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", schoolYearId)
    .eq("user_id", userId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const endInclusive = `${schoolYear.end_date}T23:59:59.999Z`;
  const { error: badgeErr } = await supabaseAdmin
    .from("badges")
    .update({ school_year_id: schoolYearId })
    .eq("user_id", userId)
    .is("school_year_id", null)
    .gte("earned_at", schoolYear.start_date)
    .lte("earned_at", endInclusive);

  if (badgeErr) {
    return NextResponse.json({ error: badgeErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, schoolYearId });
}
