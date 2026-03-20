import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

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

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: "Rooted <hello@rootedhomeschoolapp.com>",
    to: ADMIN_EMAIL,
    subject: "✅ Rooted test email",
    text: `This is a test email from the Rooted admin panel.\n\nIf you're reading this, Resend is working correctly.\n\nSent at: ${new Date().toISOString()}`,
  });

  return NextResponse.json({ result });
}
