import { supabaseAdmin } from "../lib/supabase-admin";

export async function backfillMissingProfiles(): Promise<{ created: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];

  // 1. Fetch all auth users (paginated)
  const allAuthUsers: { id: string; email?: string }[] = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) { errors.push(`Failed to list auth users page ${page}: ${error.message}`); break; }
    if (!users || users.length === 0) break;
    allAuthUsers.push(...users.map(u => ({ id: u.id, email: u.email })));
    if (users.length < perPage) break;
    page++;
  }

  console.log(`[backfill] Found ${allAuthUsers.length} auth users`);

  // 2. Fetch all existing profile IDs
  const { data: profiles, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id");

  if (profileErr) {
    errors.push(`Failed to fetch profiles: ${profileErr.message}`);
    return { created: 0, skipped: allAuthUsers.length, errors };
  }

  const existingIds = new Set((profiles ?? []).map(p => p.id));
  console.log(`[backfill] Found ${existingIds.size} existing profiles`);

  // 3. Find auth users missing a profile
  const missing = allAuthUsers.filter(u => !existingIds.has(u.id));
  console.log(`[backfill] ${missing.length} auth users have no profile`);

  if (missing.length === 0) {
    return { created: 0, skipped: 0, errors };
  }

  // 4. Upsert minimal profile rows (batch in chunks of 50)
  let created = 0;
  const chunkSize = 50;

  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const rows = chunk.map(u => ({ id: u.id }));

    const { error: upsertErr, count } = await supabaseAdmin
      .from("profiles")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
      .select();

    if (upsertErr) {
      errors.push(`Upsert error at chunk ${i}: ${upsertErr.message}`);
    } else {
      // count may be null depending on Supabase version, fall back to chunk length
      created += count ?? chunk.length;
    }
  }

  console.log(`[backfill] Created ${created} profiles. Errors: ${errors.length}`);
  return { created, skipped: existingIds.size, errors };
}
