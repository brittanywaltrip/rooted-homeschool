import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;

  const { data: activeYear, error: findErr } = await supabaseAdmin
    .from("school_years")
    .select("id, name, start_date, end_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ ok: false, error: findErr.message }, { status: 500 });
  }
  if (!activeYear) {
    return NextResponse.json({ ok: false, error: "No active school year found" }, { status: 400 });
  }

  const { error: archiveErr } = await supabaseAdmin
    .from("school_years")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", activeYear.id)
    .eq("user_id", userId);

  if (archiveErr) {
    return NextResponse.json({ ok: false, error: archiveErr.message }, { status: 500 });
  }

  const endInclusive = `${activeYear.end_date}T23:59:59.999Z`;
  const { error: badgeErr } = await supabaseAdmin
    .from("badges")
    .update({ school_year_id: activeYear.id })
    .eq("user_id", userId)
    .is("school_year_id", null)
    .gte("earned_at", activeYear.start_date)
    .lte("earned_at", endInclusive);

  if (badgeErr) {
    return NextResponse.json({ ok: false, error: badgeErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, schoolYearId: activeYear.id });
}
