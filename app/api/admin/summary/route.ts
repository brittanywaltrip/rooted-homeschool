import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { buildExclusions, isTestEmail } from "@/lib/admin/excluded-user-ids";

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
  type Profile = { id: string; display_name: string | null; first_name: string | null; last_name: string | null; plan_type: string | null; subscription_status: string | null; is_pro: boolean; partner_email: string | null; stripe_subscription_id: string | null; created_at: string; re_engagement_sent: boolean | null };

  const PAGE_SIZE = 1000;
  const FETCH_CONCURRENCY = 10;

  // Fetch every row of a table using count-first parallel pagination.
  // Previously each table was walked page-by-page in a sequential loop,
  // so big tables (lessons is ~96k rows) cost dozens of serial round
  // trips and pushed this route toward its timeout. Now: one COUNT
  // query, then all pages fetched concurrently (bounded), order kept.
  async function fetchAllRows<T>(
    table: string,
    select: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modify?: (q: any) => any
  ): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let countQuery: any = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
    if (modify) countQuery = modify(countQuery);
    const { count } = await countQuery;
    const total = count ?? 0;
    if (total === 0) return [];

    const ranges: { from: number; to: number }[] = [];
    for (let from = 0; from < total; from += PAGE_SIZE) {
      ranges.push({ from, to: Math.min(from + PAGE_SIZE, total) - 1 });
    }

    const pages: T[][] = new Array(ranges.length);
    let next = 0;
    async function worker() {
      while (next < ranges.length) {
        const i = next++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = supabaseAdmin.from(table).select(select);
        if (modify) q = modify(q);
        // Stable order is required for correct parallel pagination:
        // without it Postgres gives no row-order guarantee, so pages
        // could overlap or miss rows. Every table here has an id PK.
        const { data } = await q.order("id", { ascending: true }).range(ranges[i].from, ranges[i].to);
        pages[i] = (data ?? []) as T[];
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, ranges.length) }, () => worker())
    );
    return pages.flat();
  }

  // All independent data fetches run in parallel, dramatically faster than sequential awaits
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
  ] = await Promise.all([
    // Auth users: listUsers has no count-first equivalent; ~3 pages, sequential is fine
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
    fetchAllRows<Profile>(
      "profiles",
      "id, display_name, first_name, last_name, plan_type, subscription_status, is_pro, partner_email, stripe_subscription_id, created_at, re_engagement_sent"
    ),
    // Affiliates
    supabaseAdmin.from("affiliates").select("user_id, is_active, was_comped"),
    // Completed lessons
    fetchAllRows<{ user_id: string; completed_at: string | null; date: string | null }>(
      "lessons",
      "user_id, completed_at, date",
      q => q.not("completed_at", "is", null)
    ),
    // Children
    fetchAllRows<{ user_id: string }>("children", "user_id"),
    // Curricula
    fetchAllRows<{ user_id: string }>("curriculum_goals", "user_id"),
    // App events
    fetchAllRows<{ user_id: string; created_at: string | null }>("app_events", "user_id, created_at"),
    // Memories (user_id + created_at for adoption + activity chart; type for the near-gate photo count)
    fetchAllRows<{ user_id: string; created_at: string; type: string | null }>("memories", "user_id, created_at, type"),
    // Vacation blocks (user_id only — for adoption)
    fetchAllRows<{ user_id: string }>("vacation_blocks", "user_id"),
    // Count queries
    supabaseAdmin.from("vacation_blocks").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }).eq("type", "book"),
    supabaseAdmin.from("memories").select("*", { count: "exact", head: true }),
  ]);

  const affiliateRows = affiliateResult.data;
  const vacationBlocks = vacationBlocksResult.count;
  const booksLogged = booksLoggedResult.count;
  const memoriesCreated = memoriesCreatedResult.count;

  // ── Centralized exclusions ────────────────────────────────────────────
  // Every "real families" / signup / activity tile must filter through
  // these sets. See lib/admin/excluded-user-ids.ts for what each
  // exclusion class represents and why.
  //
  // Affiliates: ONLY comped partners (was_comped=true AND is_active=true)
  // are excluded from Paying Customers — they redeem the legacy 100% off
  // founding coupon, so Stripe shows them as active subs but they pay $0.
  // Non-comped partners (post-April-2026 signups like Blair) pay for
  // Rooted+ like any other customer and MUST count toward Paying
  // Customers. Membership in the affiliates table alone does not exclude.
  const compedAffiliateUserIds = (affiliateRows ?? [])
    .filter(a => a.was_comped === true && a.is_active === true)
    .map(a => a.user_id)
    .filter((id): id is string => Boolean(id));

  const exclusions = buildExclusions({
    authUsers: allUsers.map(u => ({ id: u.id, email: u.email ?? null })),
    profileIds: profiles.map(p => p.id),
    affiliateUserIds: compedAffiliateUserIds,
  });

  // "Comped Partners" tile counts only was_comped+active rows so the
  // legacy 9 founding partners are surfaced separately from new paying
  // partners. activeAffiliateCount remains the full count of active
  // partners (comped + paying).
  const compedPartnersCount = compedAffiliateUserIds.length;
  const activeAffiliateCount = affiliateRows?.filter(a => a.is_active).length ?? 0;

  // Derived counts from allUsers
  const totalUsers = allUsers.length;
  const realFamiliesCount = allUsers.filter(u => !exclusions.excludedFromRealFamilies.has(u.id)).length;

  const last24hSignups = allUsers.filter(u =>
    new Date(u.created_at) >= todayMidnight &&
    !exclusions.excludedFromRealFamilies.has(u.id)
  ).length;
  const yesterdaySignups = allUsers.filter(u => {
    const d = new Date(u.created_at);
    return d >= yesterdayMidnight && d < todayMidnight && !exclusions.excludedFromRealFamilies.has(u.id);
  }).length;

  // Backward-compat alias used by some downstream code.
  const affiliateUserIds = exclusions.affiliateIds;

  // Memories today — count only from real families. Excludes test
  // accounts, whitelisted founders, and incomplete signups, so this
  // tile reflects actual customer activity rather than Brittany's
  // QA-day captures.
  const todayStartIso = todayStart.toISOString();
  const memoriesTodayCount = memoryUserRows.filter(m =>
    m.created_at >= todayStartIso &&
    !exclusions.excludedFromRealFamilies.has(m.user_id)
  ).length;

  // Lessons today — same exclusions.
  const lessonsTodayCount = lessonsByUserRows.filter(l => {
    const d = (l.completed_at ?? l.date ?? "").split("T")[0];
    if (d < todayStart.toISOString().split("T")[0]) return false;
    return !exclusions.excludedFromRealFamilies.has(l.user_id);
  }).length;

  // Profile-derived counts
  const proUsers         = profiles.filter(p => p.is_pro).length;
  const freeUsers        = profiles.filter(p => !p.is_pro && !affiliateUserIds.has(p.id)).length;
  const foundingFamilies = profiles.filter(
    p => p.plan_type === "founding_family" && p.subscription_status === "active"
  ).length;
  const standardSubs = profiles.filter(p => p.plan_type === "standard").length;
  const monthlySubs  = profiles.filter(p => p.plan_type === "monthly").length;
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
  const lessonsToday  = lessonsTodayCount;

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

  // ── Near freemium gate + Re-engagement backlog ───────────────────────
  // Both tiles used to be computed in the browser with the anon key. RLS
  // limited that client to Brittany's own rows, the Near Gate query also
  // selected a non-existent profiles.email column, and supabase-js capped
  // un-ranged selects at 1000 rows, so the tiles never showed real data.
  // Computed here instead, server-side, over every row.
  const authEmailById = new Map(allUsers.map(u => [u.id, u.email ?? ""]));

  // Photo counts per user. The free plan caps PHOTOS at 50 (other memory
  // types are unlimited), so the gate counts type='photo' only, not all
  // memory types, which is what the old client code got wrong.
  const photoCountByUser = new Map<string, number>();
  for (const m of memoryUserRows) {
    if (m.type !== "photo") continue;
    photoCountByUser.set(m.user_id, (photoCountByUser.get(m.user_id) ?? 0) + 1);
  }

  // Not-paying mirrors the freeUsers definition: plan_type not in the paid
  // set (a missing profile is treated as free).
  const PAID_PLAN_TYPES = new Set(["founding_family", "standard", "monthly"]);
  const nearGate: { name: string; email: string; count: number }[] = [];
  for (const [userId, count] of photoCountByUser) {
    if (count < 40) continue;
    const profile = profileMap.get(userId);
    if (profile && PAID_PLAN_TYPES.has(profile.plan_type ?? "")) continue;
    nearGate.push({
      name: profile?.display_name || profile?.first_name || "Unknown",
      email: authEmailById.get(userId) ?? "",
      count,
    });
  }
  nearGate.sort((a, b) => b.count - a.count);

  // Re-engagement backlog: real families that were never sent the
  // re-engagement email, signed up 3+ days ago, and have logged zero
  // memories. Excludes test/whitelist/incomplete accounts so the count
  // reflects genuinely dormant families.
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  const reengageCount = profiles.filter(p =>
    (p.re_engagement_sent === false || p.re_engagement_sent == null) &&
    new Date(p.created_at).getTime() <= threeDaysAgo.getTime() &&
    !memoryByUser.has(p.id) &&
    !exclusions.excludedFromRealFamilies.has(p.id)
  ).length;

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

    // Unique-user counts. children + vacation_blocks rows are already in
    // memory from the main fetch above, so reuse them instead of re-querying.
    // The rest go through the shared parallel fetcher (user_id column only).
    async function countUniqueUsers(table: string): Promise<number> {
      const rows = await fetchAllRows<{ user_id: string }>(table, "user_id");
      return new Set(rows.map(r => r.user_id)).size;
    }

    const [loggedLesson, addedSubject, createdReflection] = await Promise.all([
      countUniqueUsers('lessons'),
      countUniqueUsers('subjects'),
      countUniqueUsers('daily_reflections'),
    ]);
    const addedChild = childrenByUser.size;
    const usedVacation = vacationByUser.size;
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

  // Revenue — live from Stripe; also sets plan on signups
  let stripeFoundingCount    = 0;
  let stripeStandardCount    = 0;
  let stripeMonthlyCount     = 0;
  let cancelledFoundingCount = 0;
  let cancelledStandardCount = 0;
  let cancelledMonthlyCount  = 0;
  let upgradesToday          = 0;
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
      else if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID)     stripeMonthlyCount++;
    }
    for (const sub of cancelledSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID)  cancelledFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID)    cancelledStandardCount++;
      else if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID)     cancelledMonthlyCount++;
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
        : priceId === process.env.STRIPE_STANDARD_PRICE_ID ? "Rooted+"
        : priceId === process.env.STRIPE_MONTHLY_PRICE_ID ? "Rooted+ Monthly" : null;
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
            : planType === "monthly"         ? "Rooted+ Monthly"
            : "Rooted",
      };
    });
    stripeFoundingCount = foundingFamilies;
    stripeStandardCount = standardSubs;
    stripeMonthlyCount  = monthlySubs;
  }

  // Upgrades today = profiles that became paid today, minus exclusions.
  // We define "upgrade" as: profile is currently is_pro=true with an active
  // sub, and its subscription_end_date / created_at falls within today's
  // window. We approximate by created_at since DB lacks a true "upgraded_at".
  // Exclusions remove comped partners + whitelist + tests so the tile
  // reflects genuine new revenue, not Brittany re-creating a test profile.
  upgradesToday = profiles.filter(p =>
    p.is_pro === true &&
    !!p.stripe_subscription_id &&
    (p.plan_type === "founding_family" || p.plan_type === "standard" || p.plan_type === "monthly") &&
    p.subscription_status === "active" &&
    new Date(p.created_at) >= todayStart &&
    !exclusions.excludedFromPaying.has(p.id)
  ).length;

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

  // ── Paying customers (the source-of-truth tile) ──────────────────────
  // Count from profiles (NOT Stripe), filtered to:
  //   plan_type='founding_family' AND is_pro=true
  //   AND stripe_subscription_id IS NOT NULL
  //   AND user_id NOT IN (comped affiliates)
  //   AND id NOT IN (whitelisted founder/test UUIDs)
  // This is what "real $39 paying Founding members" actually means.
  const payingFoundingCount = profiles.filter(p =>
    p.plan_type === "founding_family" &&
    p.is_pro === true &&
    !!p.stripe_subscription_id &&
    !exclusions.excludedFromPaying.has(p.id)
  ).length;

  const payingStandardCount = profiles.filter(p =>
    p.plan_type === "standard" &&
    p.is_pro === true &&
    !!p.stripe_subscription_id &&
    !exclusions.excludedFromPaying.has(p.id)
  ).length;

  const payingMonthlyCount = profiles.filter(p =>
    p.plan_type === "monthly" &&
    p.is_pro === true &&
    !!p.stripe_subscription_id &&
    !exclusions.excludedFromPaying.has(p.id)
  ).length;

  const stripeActiveTotal = stripeFoundingCount + stripeStandardCount + stripeMonthlyCount;
  // Monthly annualized at its run-rate: 12 x $9.99 = $119.88 per subscriber.
  const estAnnualRevenue  = Math.max(0, payingFoundingCount) * 39 + payingStandardCount * 59 + payingMonthlyCount * 119.88;

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

  // 30-day signup trend — bucket real users (no test/whitelist/incomplete) by day
  const realUsers = allUsers.filter(u => !exclusions.excludedFromRealFamilies.has(u.id));
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
    .filter(p => p.is_pro && !exclusions.excludedFromPaying.has(p.id))
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
    // New, accurate field set — every count below has the centralized
    // exclusion list applied. See lib/admin/excluded-user-ids.ts.
    realFamiliesCount,
    payingCustomersCount: payingFoundingCount + payingStandardCount + payingMonthlyCount,
    payingFoundingCount: Math.max(0, payingFoundingCount),
    payingStandardCount: Math.max(0, payingStandardCount),
    payingMonthlyCount: Math.max(0, payingMonthlyCount),
    compedPartnersCount,
    testAccountsHidden:       exclusions.testAccountsHidden,
    whitelistedHidden:        exclusions.whitelistedHidden,
    incompleteSignupsHidden:  exclusions.incompleteSignupsHidden,
    realFamiliesHiddenCount:  exclusions.realFamiliesHiddenCount,
    asOfISO: new Date().toISOString(),
    // Existing fields (now filtered through exclusions where relevant).
    last24hSignups,
    yesterdaySignups,
    proUsers,
    foundingFamilies: stripeFoundingCount,
    standardSubs:     stripeStandardCount,
    monthlySubs:      stripeMonthlyCount,
    freeUsers,
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
    stripeMonthlyCount,
    stripeActiveTotal,
    cancelledFoundingCount,
    cancelledStandardCount,
    cancelledMonthlyCount,
    funnel,
    recentSignups,
    memoriesToday: memoriesTodayCount ?? 0,
    upgradesToday,
    featureAdoption,
    signupTrend,
    churnRisk,
    newUserHealth,
    activityChart14,
    nearGate,
    reengageCount,
  });
}
