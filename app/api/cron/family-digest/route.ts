import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signedPhotoUrlsAdmin } from "@/lib/photo-url";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";
import { canSendMarketingEmail } from "@/lib/email/can-send";
import { buildFamilyListUnsubscribeHeaders } from "@/lib/email/list-unsubscribe";
import { familyDigestMode, runFamilyDigest, type DigestClient } from "@/lib/family-digest";

export const dynamic = "force-dynamic";

// Scheduled Sundays at 15:00 UTC (vercel.json). DRY unless FAMILY_DIGEST_MODE
// is "live": see lib/family-digest.ts. The founder decides when to flip it; the
// env var is deliberately not set anywhere by default.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runFamilyDigest({
    client: supabaseAdmin as unknown as DigestClient,
    mode: familyDigestMode(process.env.FAMILY_DIGEST_MODE),
    canSend: (userId) => canSendMarketingEmail(userId, "family_digest", supabaseAdmin as SupabaseClient),
    signPhotos: (paths) => signedPhotoUrlsAdmin("memory-photos", paths, 7 * 24 * 3600),
    send: ({ to, variables, headers }) =>
      sendResendTemplate(to, TEMPLATES.familyDigest, variables, "Rooted <hello@rootedhomeschoolapp.com>", undefined, headers),
    unsubscribeHeaders: buildFamilyListUnsubscribeHeaders,
    log: (line) => console.log(line),
  });

  return NextResponse.json(result);
}
