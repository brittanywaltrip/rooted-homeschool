import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { DISCOVERY_SOURCES } from '@/lib/signup-upgrade-insights';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { source?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid answer' }, { status: 400 }); }
  if (!body || typeof body.source !== 'string' || !Object.hasOwn(DISCOVERY_SOURCES, body.source)) {
    return NextResponse.json({ error: 'Choose a listed source' }, { status: 400 });
  }
  // Self-reported marketing information only. Never used for authorization,
  // referral commissions or entitlement. Identity always comes from Auth.
  const result = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: { rooted_discovery_source: body.source },
  });
  if (result.error) return NextResponse.json({ error: 'Could not save your answer' }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
