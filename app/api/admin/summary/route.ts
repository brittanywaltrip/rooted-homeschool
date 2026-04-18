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
export const maxDuration = 60;

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  // Use Central Time so "today" resets at midnight CT, not midnight UTC.
  // Get today's date string in CT (YYYY-MM-DD), then figure out midnight CT in UTC.
  const ctDateStr = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // Determine if CT is currently CDT (UTC-5) or CST (UTC-6)
  const ctHourStr = now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false });
  const ctHour = parseInt(ctHourStr, 10);
  const utcHour = now.getUTCHours();
  const isDST = ((utcHour - ctHour + 24) % 24) === 5;
  const ctOffsetHours = isDST ? 5 : 6; // CDT = UTC-5, CST = UTC-6
  // Midnight CT in UTC = date + ctOffsetHours
  const [yy, mm, dd] = ctDateStr.split("-").map(Number);
  const todayMidnight = new Date(Date.UTC(yy, mm - 1, dd, ctOffsetHours, 0, 0, 0));
  const yesterdayMidnight = new Date(todayMidnight.getTime() - 86400000);
  const todayStart = todayMidnight;

  type AuthUser = Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>['data']['users'][number];
  type Profile = { id: string; display_name: string | null; first_name: string | null; last_name: string | null; plan_type: string | null; subscription_status: string | null; is_pro: boolean; partner_email: string | null; created_at: string };

  const PAGE_SIZE = 1000;

  // All independent data fetches run in parallel — dramatically faster than sequential awaits
  const [
    allUsers,
    profiles,
    affiliateResult,
    lessonsByUserRows,
    childrenRows,
    curriculaUserRows,
    appEventRows,
    memoryUserRows,
    vacationUserRows,
    vacationBlocksResult,
    booksLoggedResult,
    memoriesCreatedResult,
    memoriesTodayResult,
  ] = await Promise.all([
    // Auth users
    (async (): Promise<AuthUser[]> => {
      const users: AuthUser[] = [];
      let page = 1;
      while (true) {
        const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        const batch = data?.users ?? [];
        users.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        page++;
      }
      return users;
    })(),
    // Profiles
    (async (): Promise<Profile[]> => {
      const rows: Profile[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin
          .from("profiles")
          .select("id, display_name, first_name, last_name, plan_type, subscription_status, is_pro, partner_email, created_at")
          .range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as Profile[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Affiliates
    supabaseAdmin.from("affiliates").select("user_id, is_active"),
    // Completed lessons
    (async (): Promise<{ user_id: string; completed_at: string | null; date: string | null }[]> => {
      const rows: { user_id: string; completed_at: string | null; date: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin
          .from("lessons")
          .select("user_id, completed_at, date")
          .not("completed_at", "is", null)
          .range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as typeof rows;
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Children
    (async (): Promise<{ user_id: string }[]> => {
      const rows: { user_id: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin.from("children").select("user_id").range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as { user_id: string }[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Curricula
    (async (): Promise<{ user_id: string }[]> => {
      const rows: { user_id: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin.from("curriculum_goals").select("user_id").range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as { user_id: string }[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // App events
    (async (): Promise<{ user_id: string; created_at: string | null }[]> => {
      const rows: { user_id: string; created_at: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin.from("app_events").select("user_id, created_at").range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as { user_id: string; created_at: string | null }[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Memories (user_id + created_at for adoption + activity chart)
    (async (): Promise<{ user_id: string; created_at: string }[]> => {
      const rows: { user_id: string; created_at: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin.from("memories").select("user_id, created_at").range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as { user_id: string; created_at: string }[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Vacation blocks (user_id only — for adoption)
    (async (): Promise<{ user_id: string }[]> => {
      const rows: { user_id: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabaseAdmin.from("vacation_blocks").select("user_id").range(from, from + PAGE_SIZE - 1);
        const batch = (data ?? []) as { user_id: string }[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    })(),
    // Count queries
    supabaseAdmin.from("vacation_blocks").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }).eq("type", "book"),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
  ]);

  const affiliateRows = affiliateResult.data;
  const vacationBlocks = vacationBlocksResult.count;
  const booksLogged = booksLoggedResult.count;
  const memoriesCreated = memoriesCreatedResult.count;
  const memoriesTodayCount = memoriesTodayResult.count;

  // Derived counts from allUsers
  const totalUsers = allUsers.length;
  const last24hSignups  = allUsers.filter(u => new Date(u.created_at) >= todayMidnight).length;
  const yesterdaySignups = allUsers.filter(u => {
    const d = new Date(u.created_at);
    return d >= yesterdayMidnight && d < todayMidnight;
  }).length;

  // Affiliates
  const affiliateUserIds = new Set(affiliateRows?.map(a => a.user_id) ?? []);
  const activeAffiliateCount = affiliateRows?.filter(a => a.is_active).length ?? 0;

  // Profile-derived counts
  const proUsers         = profiles.filter(p => p.is_pro).length;
  const freeUsers        = profiles.filter(p => !p.is_pro && !affiliateUserIds.has(p.id)).length;
  const foundingFamilies = profiles.filter(
    p => p.plan_type === "founding_family" && p.subscription_status === "active"
  ).length;
  const standardSubs = profiles.filter(p => p.plan_type === "standard").length;
  const coTeachers   = profiles.filter(p => p.partner_email).length;

  // Lessons — build map + last-date + today count
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

  // Children
  const totalChildren = childrenRows.length;
  const childrenByUser = new Map<string, number>();
  for (const c of childrenRows) {
    childrenByUser.set(c.user_id, (childrenByUser.get(c.user_id) ?? 0) + 1);
  }
  const familiesWithChildren = childrenByUser.size;
  const avgChildrenPerFamily = familiesWithChildren > 0 ? (totalChildren / familiesWithChildren).toFixed(1) : "0.0";

  // Curricula
  const totalCurricula = curriculaUserRows.length;
  const curriculaByUser = new Map<string, number>();
  for (const c of curriculaUserRows) {
    curriculaByUser.set(c.user_id, (curriculaByUser.get(c.user_id) ?? 0) + 1);
  }

  // App events
  const lastEventDate = new Map<string, string>();
  for (const e of appEventRows) {
    if (!e.created_at) continue;
    const current = lastEventDate.get(e.user_id);
    if (!current || e.created_at > current) lastEventDate.set(e.user_id, e.created_at);
  }

  // Memories
  const memoryByUser = new Map<string, number>();
  for (const m of memoryUserRows) {
    memoryByUser.set(m.user_id, (memoryByUser.get(m.user_id) ?? 0) + 1);
  }

  // Vacation blocks
  const vacationByUser = new Set(vacationUserRows.map(r => r.user_id));

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
  let upgradesToday          = 0;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const [activeSubs, cancelledSubs] = await Promise.all([
      stripe.subscriptions.list({ status: "active",   limit: 100 }),
      stripe.subscriptions.list({ status: "canceled", limit: 100 }),
    ]);

    const todayStartSec = Math.floor(todayStart.getTime() / 1000);
    for (const sub of activeSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID)  stripeFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID)    stripeStandardCount++;
      if (sub.created >= todayStartSec) upgradesToday++;
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
    // Fallback: approximate upgradesToday from profile creation date
    upgradesToday = profiles.filter(p =>
      (p.plan_type === "founding_family" || p.plan_type === "standard") &&
      p.subscription_status === "active" &&
      new Date(p.created_at) >= todayStart
    ).length;
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
  // (upgradesToday is computed in the Stripe block above using sub.created)

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
