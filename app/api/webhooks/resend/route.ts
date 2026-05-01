import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resendSuppress } from "@/lib/email/resend-suppression";

export const dynamic = "force-dynamic";

type ResendEventBase = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
  };
};

/**
 * Resend signs webhook payloads using Svix's signing scheme:
 *   - svix-id, svix-timestamp, svix-signature headers
 *   - signed payload = `${id}.${timestamp}.${rawBody}`
 *   - signature = base64(HMAC-SHA256(secretBytes, signedPayload))
 *   - secret is `whsec_<base64>`; the bytes after the prefix are the key
 *   - svix-signature can list multiple "v1,sig" entries during rotation
 */
function verifyResendSignature(secret: string, headers: Headers, rawBody: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !timestamp || !sigHeader) return false;

  const cleanSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleanSecret, "base64");
  } catch {
    return false;
  }

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedPayload)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  const candidates = sigHeader
    .split(" ")
    .map((entry) => entry.split(",")[1])
    .filter((s): s is string => !!s);

  for (const cand of candidates) {
    const candBuf = Buffer.from(cand);
    if (candBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(candBuf, expectedBuf)) return true;
  }
  return false;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const lower = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    for (const u of data.users) {
      if (u.email?.toLowerCase() === lower) return u.id;
    }
    if (data.users.length < perPage) return null;
    page++;
  }
  return null;
}

async function suppressEmail(email: string, reason: "hard_bounce" | "spam_complaint", source: string) {
  const userId = await findUserIdByEmail(email);
  if (userId) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ email_unsubscribed: true })
      .eq("id", userId);
    if (error) console.error(`[webhook/resend] profile update failed for ${email}:`, error.message);
  }
  await supabaseAdmin.from("email_suppressions").insert({ email, reason, source });
  await resendSuppress(email);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook/resend] RESEND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifyResendSignature(secret, req.headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: ResendEventBase;
  try {
    event = JSON.parse(rawBody) as ResendEventBase;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const recipients = Array.isArray(event.data?.to)
    ? event.data?.to ?? []
    : event.data?.to
      ? [event.data.to]
      : [];

  switch (event.type) {
    case "email.bounced": {
      for (const email of recipients) {
        if (email) await suppressEmail(email, "hard_bounce", "resend_webhook");
      }
      break;
    }
    case "email.complained": {
      for (const email of recipients) {
        if (email) await suppressEmail(email, "spam_complaint", "resend_webhook");
      }
      break;
    }
    case "email.delivered":
      // No-op for now. Delivery tracking would require widening email_log;
      // not worth a schema change until we have a use for it.
      break;
    default:
      // email.opened / email.clicked / unknown — no-op.
      break;
  }

  return NextResponse.json({ ok: true });
}
