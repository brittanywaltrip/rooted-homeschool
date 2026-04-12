import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { backfillMissingProfiles } from "../../../../scripts/backfill-missing-profiles";

const ADMIN_EMAILS = [
  "garfieldbrittany@gmail.com",
  "christopherwaltrip@gmail.com",
  "hello@rootedhomeschoolapp.com",
];

export async function POST(req: Request) {
  try {
    // Auth check — same pattern as other admin routes
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await backfillMissingProfiles();

    return NextResponse.json({
      message: `Backfill complete. Created ${result.created} profiles.`,
      ...result,
    });
  } catch (err: unknown) {
    console.error("[backfill-profiles] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
