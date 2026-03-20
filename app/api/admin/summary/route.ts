import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

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
    .select("id, display_name, first_name, last_name, plan_type, is_pro, partner_email, created_at");

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

  // Build signups without plan first — plan will be overridden from Stripe below
  let recentSignups = allUsers
    .filter(u => !TEST_EMAILS.some(t => (u.email ?? "").includes(t)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(u => {
      const profile = profileMap.get(u.id);
      return {
        id:             u.id,
        email:          u.email ?? "—",
        first_name:     profile?.first_name ?? null,
        last_name:      profile?.last_name ?? null,
        family_name:    profile?.display_name ?? null,
        plan:           "Free" as string,
        children_count: childrenByUser.get(u.id) ?? 0,
        lessons_done:   lessonsByUser.get(u.id) ?? 0,
        joined:         u.created_at,
      };
    });

  // User funnel — unique user counts per table
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
      { count: totalSignups },
      { count: completedOnboarding },
      ...tableResults
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('onboarded', true),
      ...tables.map(t => supabaseAdmin.from(t).select('user_id')),
    ]);
    const [childRows, lessonRows, subjectRows, resourceRows, reflectionRows, vacationRows] = tableResults as { data: { user_id: string }[] | null }[];
    const uniq = (rows: { user_id: string }[] | null) => new Set(rows?.map(x => x.user_id) ?? []).size;
    funnel = {
      totalSignups:        totalSignups        ?? 0,
      completedOnboarding: completedOnboarding ?? 0,
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

  // Revenue — live from Stripe, also used to tag plan on signups
  let stripeFoundingCount = 0;
  let stripeStandardCount = 0;
  let cancelledFoundingCount = 0;
  let cancelledStandardCount = 0;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const [activeSubs, cancelledSubs] = await Promise.all([
      stripe.subscriptions.list({ status: "active", limit: 100 }),
      stripe.subscriptions.list({ status: "canceled", limit: 100 }),
    ]);

    // Count active by price
    for (const sub of activeSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID) stripeFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID) stripeStandardCount++;
    }

    // Count cancelled by price
    for (const sub of cancelledSubs.data) {
      const priceId = sub.items.data[0]?.price.id;
      if (priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID) cancelledFoundingCount++;
      else if (priceId === process.env.STRIPE_STANDARD_PRICE_ID) cancelledStandardCount++;
    }

    // Build email → plan map from active Stripe customers
    const customerObjects = await Promise.all(
      activeSubs.data.map(sub => stripe.customers.retrieve(sub.customer as string))
    );
    // Map: lowercase email → "Founding" | "Standard"
    const payingEmails = new Map<string, string>();
    for (const sub of activeSubs.data) {
      const customer = customerObjects.find(c => !c.deleted && c.id === sub.customer);
      if (!customer || customer.deleted) continue;
      const email = (customer as Stripe.Customer).email?.toLowerCase();
      if (!email) continue;
      const priceId = sub.items.data[0]?.price.id;
      const plan = priceId === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID
        ? "Founding"
        : priceId === process.env.STRIPE_STANDARD_PRICE_ID
        ? "Standard"
        : null;
      if (plan) payingEmails.set(email, plan);
    }

    // Override plan on signups using Stripe as source of truth
    recentSignups = recentSignups.map(signup => ({
      ...signup,
      plan: payingEmails.get(signup.email.toLowerCase()) ?? "Free",
    }));
  } catch {
    // Fall back to DB plan_type if Stripe is unavailable
    recentSignups = recentSignups.map(signup => {
      const profile = profileMap.get(signup.id);
      const planType = profile?.plan_type ?? null;
      return {
        ...signup,
        plan: planType === "founding_family" ? "Founding" : planType === "standard" ? "Standard" : "Free",
      };
    });
    stripeFoundingCount = foundingFamilies;
    stripeStandardCount = standardSubs;
  }
  const stripeActiveTotal = stripeFoundingCount + stripeStandardCount;
  const estAnnualRevenue = stripeFoundingCount * 39 + stripeStandardCount * 59;

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
    // Revenue (Stripe live counts)
    estAnnualRevenue,
    stripeFoundingCount,
    stripeStandardCount,
    stripeActiveTotal,
    cancelledFoundingCount,
    cancelledStandardCount,
    // Funnel
    funnel,
    // Recent signups
    recentSignups,
  });
}
