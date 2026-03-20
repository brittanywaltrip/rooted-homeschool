import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "garfieldbrittany@gmail.com";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Auth users
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const allUsers = authData?.users ?? [];

  const totalUsers   = allUsers.length;
  const todaySignups = allUsers.filter(u => new Date(u.created_at) >= todayStart).length;
  const weekSignups  = allUsers.filter(u => new Date(u.created_at) >= weekAgo).length;

  // Profiles
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, plan_type, is_pro, partner_email, created_at");

  const proUsers         = profiles?.filter(p => p.is_pro).length ?? 0;
  const freeUsers        = (profiles?.length ?? 0) - proUsers;
  const foundingFamilies = profiles?.filter(p => p.plan_type === "founding_family").length ?? 0;
  const standardSubs     = profiles?.filter(p => p.plan_type === "standard").length ?? 0;
  const coTeachers       = profiles?.filter(p => p.partner_email).length ?? 0;

  // Lessons
  const [
    { count: totalLessons },
    { count: lessonsToday },
    { count: totalCurricula },
  ] = await Promise.all([
    supabaseAdmin.from("lessons").select("*", { count: "exact", head: true }).eq("completed", true),
    supabaseAdmin.from("lessons").select("*", { count: "exact", head: true })
      .eq("completed", true)
      .gte("completed_at", todayStart.toISOString()),
    supabaseAdmin.from("curriculum_goals").select("*", { count: "exact", head: true }),
  ]);

  // Children
  const { data: childrenRows } = await supabaseAdmin.from("children").select("user_id");
  const totalChildren = childrenRows?.length ?? 0;
  const childrenByUser = new Map<string, number>();
  for (const c of childrenRows ?? []) {
    childrenByUser.set(c.user_id, (childrenByUser.get(c.user_id) ?? 0) + 1);
  }
  const avgChildrenPerFamily = totalUsers > 0 ? (totalChildren / totalUsers).toFixed(1) : "0.0";

  // Features
  const [
    { count: vacationBlocks },
    { count: booksLogged },
    { count: memoriesCreated },
  ] = await Promise.all([
    supabaseAdmin.from("vacation_blocks").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("app_events").select("*", { count: "exact", head: true }).eq("type", "book_read"),
    supabaseAdmin.from("app_events").select("*", { count: "exact", head: true })
      .in("type", ["memory_photo", "memory_project", "memory_book"]),
  ]);

  // Recent signups — last 20, with display_name + lesson/child counts
  const { data: lessonsByUserRows } = await supabaseAdmin
    .from("lessons")
    .select("user_id")
    .eq("completed", true);

  const lessonsByUser = new Map<string, number>();
  for (const l of lessonsByUserRows ?? []) {
    lessonsByUser.set(l.user_id, (lessonsByUser.get(l.user_id) ?? 0) + 1);
  }

  const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? []);
  const authEmailMap = new Map(allUsers.map(u => [u.id, u.email ?? "—"]));

  const TEST_EMAILS = ["test@", "example.com", ADMIN_EMAIL];

  const recentSignups = allUsers
    .filter(u => !TEST_EMAILS.some(t => (u.email ?? "").includes(t)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(u => {
      const profile = profileMap.get(u.id);
      const planType = profile?.plan_type ?? null;
      return {
        id:              u.id,
        email:           u.email ?? "—",
        family_name:     profile?.display_name ?? null,
        plan:            planType === "founding_family" ? "Founding" : planType === "standard" ? "Standard" : "Free",
        children_count:  childrenByUser.get(u.id) ?? 0,
        lessons_done:    lessonsByUser.get(u.id) ?? 0,
        joined:          u.created_at,
      };
    });

  // Revenue estimate
  const estAnnualRevenue = foundingFamilies * 39 + standardSubs * 59;

  return NextResponse.json({
    // Growth
    totalUsers,
    weekSignups,
    todaySignups,
    proUsers,
    foundingFamilies,
    standardSubs,
    freeUsers,
    // Kids & Learning
    totalChildren,
    avgChildrenPerFamily,
    totalLessons:    totalLessons    ?? 0,
    lessonsToday:    lessonsToday    ?? 0,
    totalCurricula:  totalCurricula  ?? 0,
    // Features
    vacationBlocks:  vacationBlocks  ?? 0,
    booksLogged:     booksLogged     ?? 0,
    memoriesCreated: memoriesCreated ?? 0,
    coTeachers,
    // Revenue
    estAnnualRevenue,
    // Recent signups
    recentSignups,
  });
}
