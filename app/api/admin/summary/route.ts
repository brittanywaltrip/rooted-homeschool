import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Manual SQL fix 2026-03-21: amannda86@yahoo.com + dward67@yahoo.com
// updated to founding_family via Supabase SQL.
// garfieldbrittany@gmail.com founding membership was a test/refunded —
// update plan_type to 'refunded', subscription_status to 'refunded'.
// Webhook handles all future paying members automatically.

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const yesterdayMidnight = new Date(todayMidnight);
  yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

  // Auth users — no limit beyond perPage
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const allUsers = authData?.users ?? [];

  const totalUsers = allUsers.length;
  const last24hSignups  = allUsers.filter(u => new Date(u.created_at) >= todayMidnight).length;
  const yesterdaySignups = allUsers.filter(u => {
    const d = new Date(u.created_at);
    return d >= yesterdayMidnight && d < todayMidnight;
  }).length;

  // Profiles — all rows, no limit
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, first_name, last_name, plan_type, subscription_status, is_pro, partner_email, created_at");

  const proUsers         = profiles?.filter(p => p.is_pro).length ?? 0;
  const freeUsers        = (profiles?.length ?? 0) - proUsers;
  const foundingFamilies = profiles?.filter(
    p => p.plan_type === "founding_family" && p.subscription_status === "active"
  ).length ?? 0;
  const standardSubs = profiles?.filter(p => p.plan_type === "standard").length ?? 0;
  const coTeachers   = profiles?.filter(p => p.partner_email).length ?? 0;

  // Completed lessons — user_id + dates for count, last active, and today count
  const { data: lessonsByUserRows } = await supabaseAdmin
    .from("lessons")
    .select("user_id, completed_at, date")
    .not("completed_at", "is", null);

  // Build lesson count per user + last lesson date per user
  const lessonsByUser    = new Map<string, number>();
  const lastLessonDate   = new Map<string, string>();
  for (const l of lessonsByUserRows ?? []) {
    lessonsByUser.set(l.user_id, (lessonsByUser.get(l.user_id) ?? 0) + 1);
    const dateStr = l.completed_at ?? l.date ?? null;
    if (dateStr) {
      const current = lastLessonDate.get(l.user_id);
      if (!current || dateStr > current) lastLessonDate.set(l.user_id, dateStr);
    }
  }

  const totalLessons  = lessonsByUserRows?.length ?? 0;
  const lessonsToday  = lessonsByUserRows?.filter(l => {
    const d = l.completed_at ?? l.date ?? "";
    return d >= todayStart.toISOString().split("T")[0];
  }).length ?? 0;

  // Children
  const { data: childrenRows } = await supabaseAdmin.from("children").select("user_id");
  const totalChildren = childrenRows?.length ?? 0;
  const childrenByUser = new Map<string, number>();
  for (const c of childrenRows ?? []) {
    childrenByUser.set(c.user_id, (childrenByUser.get(c.user_id) ?? 0) + 1);
  }
  const avgChildrenPerFamily = totalUsers > 0 ? (totalChildren / totalUsers).toFixed(1) : "0.0";

  // Curricula per user
  const { data: curriculaUserRows } = await supabaseAdmin
    .from("curriculum_goals")
    .select("user_id");
  const totalCurricula = curriculaUserRows?.length ?? 0;
  const curriculaByUser = new Map<string, number>();
  for (const c of curriculaUserRows ?? []) {
    curriculaByUser.set(c.user_id, (curriculaByUser.get(c.user_id) ?? 0) + 1);
  }

  // App events — for last active date per user
  const { data: appEventRows } = await supabaseAdmin
    .from("app_events")
    .select("user_id, created_at");
  const lastEventDate = new Map<string, string>();
  for (const e of appEventRows ?? []) {
    if (!e.created_at) continue;
    const current = lastEventDate.get(e.user_id);
    if (!current || e.created_at > current) lastEventDate.set(e.user_id, e.created_at);
  }

  // Features
  const [
    { data: vacationData },
    { data: booksCountData },
    { data: memoriesCountData },
  ] = await Promise.all([
    supabaseAdmin.from("vacation_blocks").select("id"),
    supabaseAdmin.from("memories").select("id").eq("type", "book"),
    supabaseAdmin.from("memories").select("id"),
  ]);
  const vacationBlocks = vacationData?.length ?? 0;
  const booksLogged = booksCountData?.length ?? 0;
  const memoriesCreated = memoriesCountData?.length ?? 0;

  const profileMap    = new Map(profiles?.map(p => [p.id, p]) ?? []);
  const TEST_EMAILS   = ["test@", "example.com"];

  // Helper — compute last active from lesson and event dates
  function getLastActive(userId: string): string | null {
    const ld = lastLessonDate.get(userId) ?? null;
    const ed = lastEventDate.get(userId) ?? null;
    if (ld && ed) return ld > ed ? ld : ed;
    return ld ?? ed ?? null;
  }

  // Build signups — all users, newest first
  let recentSignups = allUsers
    .filter(u => !TEST_EMAILS.some(t => (u.email ?? "").includes(t)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(u => {
      const profile = profileMap.get(u.id);
      return {
        id:                  u.id,
        email:               u.email ?? "—",
        first_name:          profile?.first_name ?? null,
        last_name:           profile?.last_name ?? null,
        family_name:         profile?.display_name ?? null,
        plan:                "Free" as string,
        plan_type:           profile?.plan_type ?? null,
        subscription_status: profile?.subscription_status ?? null,
        children_count:      childrenByUser.get(u.id) ?? 0,
        lessons_done:        lessonsByUser.get(u.id) ?? 0,
        curricula_count:     curriculaByUser.get(u.id) ?? 0,
        joined:              u.created_at,
        last_active:         getLastActive(u.id),
      };
    });

  // User funnel
  let funnel: {
    totalSignups: number;
    completedOnboarding: number;
    addedChild: number;
    loggedLesson: number;
    addedSubject: number;
    addedResource: number;
    createdReflection: number;
    usedVacation: number;
  } | null = null;
  try {
    const tables = ['children', 'lessons', 'subjects', 'resources', 'daily_reflections', 'vacation_blocks'];
    const [
      { data: signupsData },
      { data: onboardedData },
      ...tableResults
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('id'),
      supabaseAdmin.from('profiles').select('id').eq('onboarded', true),
      ...tables.map(t => supabaseAdmin.from(t).select('user_id')),
    ]);
    const totalSignups = signupsData?.length ?? 0;
    const completedOnboarding = onboardedData?.length ?? 0;
    const [childRows, lessonRows, subjectRows, resourceRows, reflectionRows, vacationRows] = tableResults as { data: { user_id: string }[] | null }[];
    const uniq = (rows: { user_id: string }[] | null) => new Set(rows?.map(x => x.user_id) ?? []).size;
    funnel = {
      totalSignups,
      completedOnboarding,
      addedChild:          uniq(childRows.data),
      loggedLesson:        uniq(lessonRows.data),
      addedSubject:        uniq(subjectRows.data),
      addedResource:       uniq(resourceRows.data),
      createdReflection:   uniq(reflectionRows.data),
      usedVacation:        uniq(vacationRows.data),
    };
  } catch {
    funnel = null;
  }

  // Affiliates — for separating comped vs paying
  const { data: affiliateRows } = await supabaseAdmin
    .from("affiliates")
    .select("user_id, is_active");
  const affiliateUserIds = new Set(affiliateRows?.map(a => a.user_id) ?? []);
  const activeAffiliateCount = affiliateRows?.filter(a => a.is_active).length ?? 0;

  // Build set of affiliate emails for cross-referencing with Stripe
  const affiliateEmails = new Set(
    allUsers
      .filter(u => affiliateUserIds.has(u.id))
      .map(u => u.email?.toLowerCase())
      .filter(Boolean) as string[]
  );

  // Revenue — live from Stripe; also sets plan on signups
  let stripeFoundingCount    = 0;
  let stripeStandardCount    = 0;
  let cancelledFoundingCount = 0;
  let cancelledStandardCount = 0;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const [activeSubs, cancelledSubs] = await Promise.all([
      stripe.subscriptions.list({ status: "active",   limit: 100 }),
      stripe.subscriptions.list({ status: "canceled", limit: 100 }),
    ]);

    for (const sub of activeSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID)  stripeFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID)    stripeStandardCount++;
    }
    for (const sub of cancelledSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID)  cancelledFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID)    cancelledStandardCount++;
    }

    const customerObjects = await Promise.all(
      activeSubs.data.map(sub => stripe.customers.retrieve(sub.customer as string))
    );
    const payingEmails = new Map<string, string>();
    for (const sub of activeSubs.data) {
      const customer = customerObjects.find(c => !c.deleted && c.id === sub.customer);
      if (!customer || customer.deleted) continue;
      const email   = (customer as Stripe.Customer).email?.toLowerCase();
      if (!email) continue;
      const priceId = sub.items.data[0]?.price.id;
      const plan    = priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID ? "Founding"
        : priceId === process.env.STRIPE_STANDARD_PRICE_ID ? "Standard" : null;
      if (plan) payingEmails.set(email, plan);
    }

    // Set plan from Stripe active subs
    recentSignups = recentSignups.map(signup => ({
      ...signup,
      plan: payingEmails.get(signup.email.toLowerCase()) ?? "Free",
    }));
  } catch {
    // Stripe unavailable — fall back to DB plan_type
    recentSignups = recentSignups.map(signup => {
      const profile = profileMap.get(signup.id);
      const planType = profile?.plan_type ?? null;
      return {
        ...signup,
        plan: planType === "founding_family" ? "Founding"
            : planType === "standard"        ? "Standard"
            : "Free",
      };
    });
    stripeFoundingCount = foundingFamilies;
    stripeStandardCount = standardSubs;
  }

  // Override plan → "Refunded" for users with canceled/refunded status in DB
  // (applies in both Stripe-live and fallback paths)
  recentSignups = recentSignups.map(signup => {
    if (signup.plan === "Founding" || signup.plan === "Standard") return signup;
    const sub_status = signup.subscription_status;
    const plan_type  = signup.plan_type;
    if (
      sub_status === "refunded" || sub_status === "canceled" ||
      plan_type  === "refunded"
    ) {
      return { ...signup, plan: "Refunded" };
    }
    return signup;
  });

  // Split paying vs comped: exclude affiliate emails from paying counts
  const payingFoundingCount = stripeFoundingCount - [...affiliateEmails].filter(e => {
    const plan = recentSignups.find(s => s.email.toLowerCase() === e)?.plan;
    return plan === "Founding";
  }).length;
  const stripeActiveTotal = stripeFoundingCount + stripeStandardCount;
  const estAnnualRevenue  = Math.max(0, payingFoundingCount) * 39 + stripeStandardCount * 59;

  // Tag affiliate users as "Partner" plan
  recentSignups = recentSignups.map(signup => {
    if (affiliateUserIds.has(signup.id)) {
      return { ...signup, plan: "Partner" };
    }
    return signup;
  });

  return NextResponse.json({
    totalUsers,
    last24hSignups,
    yesterdaySignups,
    proUsers,
    foundingFamilies: stripeFoundingCount,
    standardSubs:     stripeStandardCount,
    freeUsers,
    payingFoundingCount: Math.max(0, payingFoundingCount),
    activeAffiliateCount,
    affiliateUserIds: [...affiliateUserIds],
    totalChildren,
    avgChildrenPerFamily,
    totalLessons,
    lessonsToday,
    totalCurricula,
    vacationBlocks:  vacationBlocks  ?? 0,
    booksLogged:     booksLogged     ?? 0,
    memoriesCreated: memoriesCreated ?? 0,
    coTeachers,
    estAnnualRevenue,
    stripeFoundingCount,
    stripeStandardCount,
    stripeActiveTotal,
    cancelledFoundingCount,
    cancelledStandardCount,
    funnel,
    recentSignups,
  });
}
