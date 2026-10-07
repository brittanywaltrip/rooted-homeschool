import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildExclusions } from '@/lib/admin/excluded-user-ids';
import { daysToUpgrade, discoveryLabel, firstPayments } from '@/lib/signup-upgrade-insights';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const ADMINS = ['garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com'];
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user || !ADMINS.includes(user.email ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  }
  try {
    type User = { id: string; email?: string; created_at: string; user_metadata: Record<string, unknown> };
    type Profile = { id: string; stripe_customer_id: string | null };
    const users: User[] = [];
    for (let page = 1; ; page++) {
      const r = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (r.error) throw r.error;
      users.push(...r.data.users);
      if (r.data.users.length < 1000) break;
    }
    const profiles: Profile[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await supabaseAdmin.from('profiles').select('id, stripe_customer_id').order('id').range(offset, offset + 999);
      if (r.error) throw r.error;
      profiles.push(...r.data);
      if (r.data.length < 1000) break;
    }
    const affiliates: { user_id: string | null }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await supabaseAdmin.from('affiliates').select('user_id').eq('was_comped', true).eq('is_active', true).order('id').range(offset, offset + 999);
      if (r.error) throw r.error;
      affiliates.push(...r.data);
      if (r.data.length < 1000) break;
    }
    const exclusions = buildExclusions({ authUsers: users.map(u => ({ id: u.id, email: u.email ?? null })), profileIds: profiles.map(p => p.id), affiliateUserIds: affiliates.flatMap(a => a.user_id ? [a.user_id] : []) });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { timeout: 15000, maxNetworkRetries: 1 });
    const invoices: Stripe.Invoice[] = [];
    for await (const invoice of stripe.invoices.list({ status: 'paid', limit: 100 })) invoices.push(invoice);
    const payments = firstPayments(invoices);
    const customerCounts = new Map<string, number>();
    for (const p of profiles) if (p.stripe_customer_id) customerCounts.set(p.stripe_customer_id, (customerCounts.get(p.stripe_customer_id) ?? 0) + 1);
    const profilesById = new Map(profiles.map(p => [p.id, p]));
    const rows = users.filter(u => !exclusions.excludedFromRealFamilies.has(u.id) && !exclusions.excludedFromPaying.has(u.id)).flatMap(u => {
      const customer = profilesById.get(u.id)?.stripe_customer_id;
      if (!customer || customerCounts.get(customer) !== 1) return [];
      if (!payments.has(customer)) return [];
      const paid = payments.get(customer) ?? null;
      return [{ id: u.id, email: u.email ?? '', signupAt: u.created_at, firstPaidAt: paid === null ? null : new Date(paid * 1000).toISOString(), daysToUpgrade: daysToUpgrade(u.created_at, paid), discoverySource: discoveryLabel(u.user_metadata.rooted_discovery_source) }];
    }).sort((a, b) => (b.firstPaidAt ?? '').localeCompare(a.firstPaidAt ?? ''));
    const days = rows.flatMap(r => r.daysToUpgrade === null ? [] : [r.daysToUpgrade]).sort((a, b) => a - b);
    const middle = Math.floor(days.length / 2);
    const medianDays = days.length ? days.length % 2 ? days[middle] : (days[middle - 1] + days[middle]) / 2 : null;
    return NextResponse.json({ rows, medianDays, generatedAt: new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: 'Insights could not be loaded completely. Please try again.' }, { status: 503, headers });
  }
}
