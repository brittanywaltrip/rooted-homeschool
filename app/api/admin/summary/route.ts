import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Manual SQL fix 2026-03-21: amannda86@yahoo.com + dward67@yahoo.com
// updated to founding_family via Supabase SQL.
// garfieldbrittany@gmail.com founding membership was a test/refunded —
// update plan_type to 'refunded', subscription_status to 'refunded'.
// Webhook handles all future paying members automatically.

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const TEST_EMAIL_PATTERNS = ["rooted.", "test", "finalpass", "mobiletest", "finaltest"];
const TEST_EMAILS_EXACT = [
  "garfieldbrittany@gmail.com",
  "zoereywaltrip@gmail.com",
  "brittanywaltrip20@gmail.com",
  "het787@gmail.com",
  "wovapi4416@lxbeta.com",
];

function isTestEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (TEST_EMAILS_EXACT.includes(lower)) return true;
  return TEST_EMAIL_PATTERNS.some(p => lower.includes(p));
}

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

  // Auth users — paginate to get ALL users
  type AuthUser = Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>['data']['users'][number];
  let allUsers: AuthUser[] = [];
  {
    let page = 1;
    const PER_PAGE = 1000;
    while (true) {
      const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
      const users = authData?.users ?? [];
      allUsers = [...allUsers, ...users];
      if (users.length < PER_PAGE) break;
      page++;
    }
  }

  const totalUsers = allUsers.length;
  const last24hSignups  = allUsers.filter(u => new Date(u.created_at) >= todayMidnight).length;
  const yesterdaySignups = allUsers.filter(u => {
    const d = new Date(u.created_at);
    return d >= yesterdayMidnight && d < todayMidnight;
  }).length;

  // Profiles — paginate (approaching 1000 row cap)
  let profiles: { id: string; display_name: string | null; first_name: string | null; last_name: string | null; plan_type: string | null; subscription_status: string | null; is_pro: boolean; partner_email: string | null; created_at: string }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name, first_name, last_name, plan_type, subscription_status, is_pro, partner_email, created_at")
        .range(from, from + PAGE - 1);
      const rows = (data ?? []) as typeof profiles;
      profiles = profiles.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  // Affiliates — load early so we can exclude from free user count
  const { data: affiliateRows } = await supabaseAdmin
    .from("affiliates")
    .select("user_id, is_active");
  const affiliateUserIds = new Set(affiliateRows?.map(a => a.user_id) ?? []);
  const activeAffiliateCount = affiliateRows?.filter(a => a.is_active).length ?? 0;

  const proUsers         = profiles.filter(p => p.is_pro).length;
  const freeUsers        = profiles.filter(p => !p.is_pro && !affiliateUserIds.has(p.id)).length;
  const foundingFamilies = profiles.filter(
    p => p.plan_type === "founding_family" && p.subscription_status === "active"
  ).length;
  const standardSubs = profiles.filter(p => p.plan_type === "standard").length;
  const coTeachers   = profiles.filter(p => p.partner_email).length;

  // Completed lessons — paginate to get all rows
  let lessonsByUserRows: { user_id: string; completed_at: string | null; date: string | null }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin
        .from("lessons")
        .select("user_id, completed_at, date")
        .not("completed_at", "is", null)
        .range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string; completed_at: string | null; date: string | null }[];
      lessonsByUserRows = lessonsByUserRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  // Build lesson count per user + last lesson date per user
  const lessonsByUser    = new Map<string, number>();
  const lastLessonDate   = new Map<string, string>();
  for (const l of lessonsByUserRows) {
    lessonsByUser.set(l.user_id, (lessonsByUser.get(l.user_id) ?? 0) + 1);
    const dateStr = l.completed_at ?? l.date ?? null;
    if (dateStr) {
      const current = lastLessonDate.get(l.user_id);
      if (!current || dateStr > current) lastLessonDate.set(l.user_id, dateStr);
    }
  }

  const totalLessons  = lessonsByUserRows.length;
  const lessonsToday  = lessonsByUserRows.filter(l => {
    const d = l.completed_at ?? l.date ?? "";
    return d >= todayStart.toISOString().split("T")[0];
  }).length;

  // Children — paginate to get all rows
  let childrenRows: { user_id: string }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin.from("children").select("user_id").range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string }[];
      childrenRows = childrenRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const totalChildren = childrenRows.length;
  const childrenByUser = new Map<string, number>();
  for (const c of childrenRows) {
    childrenByUser.set(c.user_id, (childrenByUser.get(c.user_id) ?? 0) + 1);
  }
  const familiesWithChildren = childrenByUser.size;
  const avgChildrenPerFamily = familiesWithChildren > 0 ? (totalChildren / familiesWithChildren).toFixed(1) : "0.0";

  // Curricula — paginate
  let curriculaUserRows: { user_id: string }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin.from("curriculum_goals").select("user_id").range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string }[];
      curriculaUserRows = curriculaUserRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const totalCurricula = curriculaUserRows.length;
  const curriculaByUser = new Map<string, number>();
  for (const c of curriculaUserRows) {
    curriculaByUser.set(c.user_id, (curriculaByUser.get(c.user_id) ?? 0) + 1);
  }

  // App events — paginate (can grow large)
  let appEventRows: { user_id: string; created_at: string | null }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin.from("app_events").select("user_id, created_at").range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string; created_at: string | null }[];
      appEventRows = appEventRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const lastEventDate = new Map<string, string>();
  for (const e of appEventRows) {
    if (!e.created_at) continue;
    const current = lastEventDate.get(e.user_id);
    if (!current || e.created_at > current) lastEventDate.set(e.user_id, e.created_at);
  }

  // Memories — paginate with user_id + created_at for adoption + activity chart
  let memoryUserRows: { user_id: string; created_at: string }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin.from("memories").select("user_id, created_at").range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string; created_at: string }[];
      memoryUserRows = memoryUserRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const memoryByUser = new Map<string, number>();
  for (const m of memoryUserRows) {
    memoryByUser.set(m.user_id, (memoryByUser.get(m.user_id) ?? 0) + 1);
  }

  // Vacation blocks — paginate unique user_ids for adoption
  let vacationUserRows: { user_id: string }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabaseAdmin.from("vacation_blocks").select("user_id").range(from, from + PAGE - 1);
      const rows = (data ?? []) as { user_id: string }[];
      vacationUserRows = vacationUserRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const vacationByUser = new Set(vacationUserRows.map(r => r.user_id));

  // Features — use proper count queries
  const [
    { count: vacationBlocks },
    { count: booksLogged },
    { count: memoriesCreated },
    { count: memoriesTodayCount },
  ] = await Promise.all([
    supabaseAdmin.from("vacation_blocks").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }).eq("type", "book"),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
  ]);

  const profileMap    = new Map(profiles.map(p => [p.id, p]));
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

  // User funnel — paginate tables that exceed 1000 rows
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
    // Use count queries for simple totals
    const [
      { count: totalSignups },
      { count: completedOnboarding },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('onboarded', true),
    ]);

    // For unique user counts, paginate tables that might exceed 1000 rows
    async function fetchUniqueUserIds(table: string): Promise<number> {
      const userIds = new Set<string>();
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data } = await supabaseAdmin.from(table).select('user_id').range(from, from + PAGE - 1);
        const rows = (data ?? []) as { user_id: string }[];
        for (const r of rows) userIds.add(r.user_id);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return userIds.size;
    }

    const [addedChild, loggedLesson, addedSubject, createdReflection, usedVacation] = await Promise.all([
      fetchUniqueUserIds('children'),
      fetchUniqueUserIds('lessons'),
      fetchUniqueUserIds('subjects'),
      fetchUniqueUserIds('daily_reflections'),
      fetchUniqueUserIds('vacation_blocks'),
    ]);
    const addedResource = 0; // resources table is admin-managed links, has no user_id

    funnel = {
      totalSignups: totalSignups ?? 0,
      completedOnboarding: completedOnboarding ?? 0,
      addedChild,
      loggedLesson,
      addedSubject,
      addedResource,
      createdReflection,
      usedVacation,
    };
  } catch {
    funnel = null;
  }

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
      const plan    = priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID ? "Rooted+ Founding"
        : priceId === process.env.STRIPE_STANDARD_PRICE_ID ? "Rooted+" : null;
      if (plan) payingEmails.set(email, plan);
    }

    // Set plan from Stripe active subs
    recentSignups = recentSignups.map(signup => ({
      ...signup,
      plan: payingEmails.get(signup.email.toLowerCase()) ?? "Rooted",
    }));
  } catch {
    // Stripe unavailable — fall back to DB plan_type
    recentSignups = recentSignups.map(signup => {
      const profile = profileMap.get(signup.id);
      const planType = profile?.plan_type ?? null;
      return {
        ...signup,
        plan: planType === "founding_family" ? "Rooted+ Founding"
            : planType === "standard"        ? "Rooted+"
            : "Rooted",
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

  // ── New analytics fields ──

  // Today's Pulse — upgrades today (memoriesToday + lessonsToday + last24hSignups already exist)
  const upgradesToday = profiles.filter(p =>
    (p.plan_type === "founding_family" || p.plan_type === "standard") &&
    p.subscription_status === "active" &&
    new Date(p.created_at) >= todayStart
  ).length;

  // Feature adoption rates — % of all profiles using each feature
  const totalProfiles = profiles.length;
  const featureAdoption = {
    createdMemory:  totalProfiles > 0 ? Math.round((memoryByUser.size   / totalProfiles) * 100) : 0,
    loggedLesson:   totalProfiles > 0 ? Math.round((lessonsByUser.size  / totalProfiles) * 100) : 0,
    addedChild:     totalProfiles > 0 ? Math.round((childrenByUser.size / totalProfiles) * 100) : 0,
    setCurriculum:  totalProfiles > 0 ? Math.round((curriculaByUser.size / totalProfiles) * 100) : 0,
    sharedFamily:   totalProfiles > 0 ? Math.round((coTeachers           / totalProfiles) * 100) : 0,
    usedVacation:   totalProfiles > 0 ? Math.round((vacationByUser.size  / totalProfiles) * 100) : 0,
  };

  // 30-day signup trend — bucket real users (no test accounts) by day
  const realUsers = allUsers.filter(u => !isTestEmail(u.email ?? ""));
  const signupTrend: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    const count = realUsers.filter(u => u.created_at.startsWith(ds)).length;
    signupTrend.push({ date: ds, count });
  }

  // Churn risk — paid users inactive 7+ days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString();

  const churnRisk = profiles
    .filter(p => p.is_pro)
    .map(p => {
      const lastActive = getLastActive(p.id);
      const email = allUsers.find(u => u.id === p.id)?.email ?? "";
      return {
        name: p.display_name || p.first_name || "Unknown",
        email,
        lastActive,
        plan: p.plan_type === "founding_family" ? "Founding" : "Standard",
      };
    })
    .filter(u => !u.lastActive || u.lastActive < sevenDaysAgoStr)
    .filter(u => !isTestEmail(u.email))
    .sort((a, b) => (a.lastActive ?? "").localeCompare(b.lastActive ?? ""));

  // New user first-week health — signups in last 7 days
  const newUserIds = new Set(
    allUsers
      .filter(u => new Date(u.created_at) >= sevenDaysAgo)
      .map(u => u.id)
  );
  const newUserHealth = {
    total:         newUserIds.size,
    addedChild:    [...newUserIds].filter(id => childrenByUser.has(id)).length,
    loggedLesson:  [...newUserIds].filter(id => lessonsByUser.has(id)).length,
    createdMemory: [...newUserIds].filter(id => memoryByUser.has(id)).length,
    setCurriculum: [...newUserIds].filter(id => curriculaByUser.has(id)).length,
  };

  // 14-day active users — unique users with a memory OR lesson on each day
  const activityChart14: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    const activeUsers = new Set<string>();
    for (const m of memoryUserRows) {
      if (m.created_at?.startsWith(ds)) activeUsers.add(m.user_id);
    }
    for (const l of lessonsByUserRows) {
      const dateStr = (l.completed_at ?? l.date ?? "").split("T")[0];
      if (dateStr === ds) activeUsers.add(l.user_id);
    }
    activityChart14.push({ date: ds, count: activeUsers.size });
  }

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
    // New analytics fields
    memoriesToday: memoriesTodayCount ?? 0,
    upgradesToday,
    featureAdoption,
    signupTrend,
    churnRisk,
    newUserHealth,
    activityChart14,
  });
}
